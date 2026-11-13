import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSourceRegions, createProjectMetadata, makeMergeIdentityKey, makeSplitIdentityKeys, remapManifestPaths, sourceIdentityKey, splitSourceRegions, validateManifest } from '../src/manifest-core.js';

const region = (file, y, height, outputY = 0, outputHeight = 1, sourceHeight = 1200) => ({ source_page: 1, source_file: file, source_fingerprint: 'sha256-content-1', source_width: 800, source_height: sourceHeight, crop: { x: 0, y, width: 800, height }, output_y: outputY, output_height: outputHeight });

function assertSplitConserves(regions, ratio) {
  const [top, bottom] = splitSourceRegions(regions, ratio);
  for (const original of regions) {
    const a = top.filter(r => r.source_file === original.source_file);
    const b = bottom.filter(r => r.source_file === original.source_file);
    const all = [...a, ...b].sort((x,y) => x.crop.y - y.crop.y);
    assert.equal(all[0].crop.y, original.crop.y);
    assert.equal(all.at(-1).crop.y + all.at(-1).crop.height, original.crop.y + original.crop.height);
    for (let i=1;i<all.length;i++) assert.equal(all[i-1].crop.y + all[i-1].crop.height, all[i].crop.y);
    for (const part of [...a,...b]) assert.ok(part.crop.y + part.crop.height <= part.source_height);
  }
  return [top,bottom];
}

test('panel identity keys follow source crop, ignore reading order and filename', () => {
  const a = sourceIdentityKey([region('01.jpg', 0, 500)]);
  assert.equal(a, sourceIdentityKey([region('01.jpg', 0, 500)]));
  assert.equal(a, sourceIdentityKey([region('renamed-file.jpg', 0, 500)]));
  assert.notEqual(a, sourceIdentityKey([region('01.jpg', 1, 499)]));
});

test('split and merge operations produce distinct stable identity keys', () => {
  const split = makeSplitIdentityKeys('uuid-parent', 0.4);
  assert.equal(split.length, 2);
  assert.notEqual(split[0], split[1]);
  assert.notEqual(makeMergeIdentityKey(['b', 'a']), makeMergeIdentityKey(['a', 'b']));
});

test('source regions are proportionally traced through split and vertical merge', () => {
  const original = [region('01.jpg', 100, 800)];
  const [top, bottom] = splitSourceRegions(original, 0.25);
  assert.deepEqual(top[0].crop, { x: 0, y: 100, width: 800, height: 200 });
  assert.deepEqual(bottom[0].crop, { x: 0, y: 300, width: 800, height: 600 });
  const joined = combineSourceRegions(top, 200, bottom, 600);
  assert.equal(joined[0].output_y, 0);
  assert.equal(joined[1].output_y, 0.25);
  const multiSource = combineSourceRegions([region('01.jpg', 0, 400)], 400, [region('02.jpg', 10, 500)], 500);
  assert.deepEqual(multiSource.map(item => item.source_file), ['01.jpg', '02.jpg']);
  assert.equal(multiSource[1].output_y, 400/900);
});

test('split uses one integer source boundary for odd crop height and conserves all pixels', () => {
  const [top,bottom] = assertSplitConserves([region('odd.jpg',900,101,0,1,1001)],0.5);
  assert.equal(top[0].crop.y + top[0].crop.height,bottom[0].crop.y);
  assert.equal(top[0].crop.height + bottom[0].crop.height,101);
  assert.equal(bottom[0].crop.y + bottom[0].crop.height,1001);
});

test('split conserves even crops for half and non-half ratios with nonzero crop origin', () => {
  for (const ratio of [0.5,0.37,0.73]) {
    const [top,bottom] = assertSplitConserves([region(`even-${ratio}.jpg`,251,100,0,1,900)],ratio);
    assert.equal(top[0].crop.y + top[0].crop.height,bottom[0].crop.y);
    assert.equal(top[0].crop.height + bottom[0].crop.height,100);
  }
});

test('split handles source regions on both sides of a boundary between source images', () => {
  const regions = [region('first.jpg',400,100,0,0.5,800), region('second.jpg',0,200,0.5,0.5,1000)];
  const [top,bottom] = assertSplitConserves(regions,0.5);
  assert.deepEqual(top.map(r=>r.source_file),['first.jpg']);
  assert.deepEqual(bottom.map(r=>r.source_file),['second.jpg']);
  assert.equal(top[0].crop.y+top[0].crop.height,500);
  assert.equal(bottom[0].crop.y,0);
});

test('split across multi-source regions clips each crop without gaps or overlap', () => {
  const regions = [region('first.jpg',100,100,0,0.4,500), region('second.jpg',200,101,0.4,0.6,1000)];
  const [top,bottom] = assertSplitConserves(regions,0.5);
  assert.equal(top.length,2);
  assert.equal(bottom.length,1);
  assert.equal(top[1].crop.y+top[1].crop.height,bottom[0].crop.y);
  assert.equal(bottom[0].crop.y+bottom[0].crop.height,301);
});

test('manifest schema accepts valid records and rejects duplicate ids, orders and traversal paths', () => {
  const base = createProjectMetadata({ projectId: 'project-uuid', projectName: 'Chapter_001', createdAt: '2026-01-01T00:00:00.000Z', exportedAt: '2026-01-01T00:01:00.000Z', sourceType: 'ZIP', sourceName: 'chapter.zip', readingDirection: 'rtl', comicType: 'manga' });
  const panel = (id, uuid, order, file) => ({ id, uuid, file, order, width: 800, height: 600, source_regions: [region('001.jpg',0,600)], decision: 'SHOW', review_required: false, edit_history: [], parent_ids: [] });
  const good = { ...base, panels: [panel('P000001','uuid-1',1,'0001_001/panel_001.jpg')] };
  assert.deepEqual(validateManifest(good), { valid: true, errors: [] });
  assert.equal(validateManifest({ ...base, panels: [panel('P000001','uuid-1',1,'a.jpg'), panel('P000001','uuid-2',2,'b.jpg')] }).valid, false);
  assert.equal(validateManifest({ ...base, panels: [panel('P000001','uuid-1',1,'a.jpg'), panel('P000002','uuid-2',1,'b.jpg')] }).valid, false);
  assert.equal(validateManifest({ ...base, panels: [panel('P000001','uuid-1',1,'../a.jpg')] }).valid, false);
});

test('manifest rejects duplicate UUIDs, blank UUIDs and UUIDs with non-string type', () => {
  const base = createProjectMetadata({ projectId:'p',projectName:'c',createdAt:'t',exportedAt:'t',sourceType:'FOLDER',sourceName:'c',comicType:'manga' });
  const panel=(id,uuid,order)=>({ id,uuid,order,file:`${order}.jpg`,width:800,height:600,source_regions:[region('a.jpg',0,100)],decision:'SHOW',review_required:false,edit_history:[] });
  assert.equal(validateManifest({...base,panels:[panel('P1','same',1),panel('P2','same',2)]}).errors.some(e=>e.includes('UUID panel bị trùng')),true);
  assert.equal(validateManifest({...base,panels:[panel('P1','  ',1)]}).valid,false);
  assert.equal(validateManifest({...base,panels:[panel('P1',42,1)]}).valid,false);
  assert.equal(validateManifest({...base,panels:[panel('P1','uuid-a',1),panel('P2','uuid-b',2)]}).valid,true);
});

test('manifest path remapping supports preserve and flat layouts and rejects missing exports', () => {
  const manifest = { schema_version: '1.0', panels: [{ file: 'chap/panel_001.jpg' }] };
  assert.equal(remapManifestPaths(manifest, new Map([['chap/panel_001.jpg', 'chap/panel_001.jpg']])).panels[0].file, 'chap/panel_001.jpg');
  assert.equal(remapManifestPaths(manifest, new Map([['chap/panel_001.jpg', '000001__chap__panel_001.jpg']])).panels[0].file, '000001__chap__panel_001.jpg');
  assert.throws(() => remapManifestPaths(manifest, new Map()), /không được xuất/);
});

test('manifest export tolerates missing source file/page attribution without blocking save', () => {
  const base = createProjectMetadata({ projectId: 'project-uuid', projectName: 'Chapter', createdAt: '2026-01-01T00:00:00.000Z', exportedAt: '2026-01-01T00:01:00.000Z', sourceType: 'FOLDER', sourceName: 'Chapter', comicType: 'manhwa' });
  const sourceRegion = { source_page: null, source_file: null, source_width: 800, source_height: 1200, crop: { x: 0, y: 0, width: 800, height: 600 }, output_y: 0, output_height: 1 };
  const manifest = { ...base, panels: [{ id: 'P000001', uuid: 'panel-uuid', file: 'panel_001.jpg', order: 1, width: 800, height: 600, source_regions: [sourceRegion], decision: 'SHOW', review_required: false, edit_history: [] }] };
  assert.deepEqual(validateManifest(manifest), { valid: true, errors: [] });
  assert.equal(validateManifest({ ...manifest, panels: [{ ...manifest.panels[0], source_regions: [{ ...sourceRegion, source_page: 0 }] }] }).valid, false);
});
