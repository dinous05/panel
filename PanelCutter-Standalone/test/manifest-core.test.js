import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSourceRegions, createProjectMetadata, makeMergeIdentityKey, makeSplitIdentityKeys, remapManifestPaths, sourceIdentityKey, splitSourceRegions, validateManifest } from '../src/manifest-core.js';

const region = (file, y, height, outputY = 0, outputHeight = 1) => ({ source_page: 1, source_file: file, source_fingerprint: 'sha256-content-1', source_width: 800, source_height: 1200, crop: { x: 0, y, width: 800, height }, output_y: outputY, output_height: outputHeight });

test('panel identity keys follow source crop and ignore reading order', () => {
  const a = sourceIdentityKey([region('01.jpg', 0, 500)]);
  const b = sourceIdentityKey([region('01.jpg', 0, 500)]);
  assert.equal(a, b);
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

test('manifest schema accepts valid records and rejects duplicate ids, orders and staging paths', () => {
  const base = createProjectMetadata({ projectId: 'project-uuid', projectName: 'Chapter_001', createdAt: '2026-01-01T00:00:00.000Z', exportedAt: '2026-01-01T00:01:00.000Z', sourceType: 'ZIP', sourceName: 'chapter.zip', readingDirection: 'rtl', comicType: 'manga' });
  const panel = (id, order, file) => ({ id, uuid: `${id}-uuid`, file, order, source_page: 1, source_file: '001.jpg', width: 800, height: 600, crop: { x: 0, y: 0, width: 800, height: 600 }, source_regions: [region('001.jpg', 0, 600)], decision: 'SHOW', review_required: false, edit_history: [], parent_ids: [] });
  const good = { ...base, panels: [panel('P000001', 1, '0001_001/panel_001.jpg')] };
  assert.deepEqual(validateManifest(good), { valid: true, errors: [] });
  assert.equal(validateManifest({ ...base, panels: [panel('P000001', 1, 'a.jpg'), panel('P000001', 1, 'b.jpg')] }).valid, false);
  assert.equal(validateManifest({ ...base, panels: [panel('P000001', 1, '../a.jpg')] }).valid, false);
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
