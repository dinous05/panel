import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPanelMapping, loadPanelImageData } from '../src/shared/panel-mapping';
import type { AnalysisDocument, ImportedAnalysis, ManifestDocument } from '../src/shared/types';

const roots: string[] = [];
const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
async function makeRoot() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'panelvid-mapping-'));
  roots.push(folder);
  return folder;
}
async function putImage(root: string, relative: string, bytes = jpegHeader) {
  const normalized = relative.replace(/\\/g, '/');
  const fullPath = path.join(root, ...normalized.split('/'));
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);
  return fullPath;
}
function panel(uuid: string | null, file: string, extra: Record<string, unknown> = {}) {
  return { id: `panel-${file}`, uuid, file, order: 999, source_file: 'unused-source-field.webp', ...extra };
}
function analysis(fileName: string, chapterNumber: number, beats: unknown[]): ImportedAnalysis {
  const data: AnalysisDocument = {
    chapter: { series: 'Test Series', number: chapterNumber },
    voice_beats: beats
  };
  return {
    path: fileName,
    fileName,
    series: 'Test Series',
    chapterNumber,
    chapterTitle: null,
    voiceBeatCount: beats.length,
    data
  };
}
async function map(root: string, panels: unknown[], analyses: ImportedAnalysis[]) {
  return buildPanelMapping({ project: { project_name: 'Mapping Test' }, panels } as ManifestDocument, analyses, root);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';
const uuidMissing = '99999999-9999-4999-8999-999999999999';

describe('UUID mapping and manifest-based image resolution', () => {
  it('joins by UUID, not manifest order or panel.order, and preserves beat and panel array order', async () => {
    const root = await makeRoot();
    const fileA = '卷一\\Chapter 01\\panel A.jpg';
    const fileB = '卷一/Chapter 02/panel B.jpg';
    const pathA = await putImage(root, fileA);
    const pathB = await putImage(root, fileB);
    const result = await map(root, [
      panel(uuidB, fileB, { id: 'B', order: 1 }),
      panel(uuidA, fileA, { id: 'A', order: 999 })
    ], [analysis('chapter-01.json', 1, [
      { beat_id: 'beat-array-first', order: 20, narration: 'First array entry', panel_uuids: [uuidA, uuidB] },
      { beat_id: 'beat-array-second', order: 1, narration: 'Second array entry', panel_uuids: [uuidB] }
    ])]);

    expect(result.chapters[0].beats.map(beat => beat.beatId)).toEqual(['beat-array-first', 'beat-array-second']);
    expect(result.chapters[0].beats[0].order).toBe(20);
    expect(result.chapters[0].beats[0].panels.map(ref => ref.referenceUuid)).toEqual([uuidA, uuidB]);
    expect(result.chapters[0].beats[0].panels.map(ref => ref.panelId)).toEqual(['A', 'B']);
    expect(result.chapters[0].beats[0].panels.map(ref => ref.resolvedPath)).toEqual([pathA, pathB]);
    expect(result.statistics.distinctUuidsUsed).toBe(2);
  });

  it('maps multiple chapters independently while retaining chapter input order', async () => {
    const root = await makeRoot();
    const chapterOneFile = 'Chapter 01/panel_0001.jpg';
    const chapterTwoFile = 'Chapter 02/panel_0001.jpg';
    await putImage(root, chapterOneFile);
    await putImage(root, chapterTwoFile);
    const result = await map(root, [
      panel(uuidA, chapterOneFile, { id: 'chapter-one-panel' }),
      panel(uuidB, chapterTwoFile, { id: 'chapter-two-panel' })
    ], [
      analysis('analysis-ch02.json', 2, [{ beat_id: 'ch02-b1', panel_uuids: [uuidB] }]),
      analysis('analysis-ch01.json', 1, [{ beat_id: 'ch01-b1', panel_uuids: [uuidA] }])
    ]);
    expect(result.chapters.map(chapter => chapter.chapterNumber)).toEqual([2, 1]);
    expect(result.chapters[0].beats[0].panels[0].panelId).toBe('chapter-two-panel');
    expect(result.chapters[1].beats[0].panels[0].panelId).toBe('chapter-one-panel');
  });

  it('distinguishes malformed UUIDs from well-formed UUIDs absent from the manifest', async () => {
    const root = await makeRoot();
    const result = await map(root, [], [analysis('chapter.json', 1, [{
      beat_id: 'bad-refs', panel_uuids: ['not-a-uuid', uuidMissing]
    }])]);
    expect(result.chapters[0].beats[0].panels.map(ref => ref.status)).toEqual(['invalid-uuid', 'uuid-not-found']);
    expect(result.statistics.invalidUuidReferences).toBe(1);
    expect(result.statistics.unknownUuidReferences).toBe(1);
  });

  it('reports a missing image without dropping the valid UUID mapping', async () => {
    const root = await makeRoot();
    const result = await map(root, [panel(uuidA, 'missing/deep/panel.jpg', { id: 'missing-panel' })],
      [analysis('chapter.json', 1, [{ beat_id: 'b1', panel_uuids: [uuidA] }])]);
    const ref = result.chapters[0].beats[0].panels[0];
    expect(ref).toMatchObject({ panelId: 'missing-panel', status: 'image-missing', imageStatus: 'missing' });
    expect(result.statistics.imagesMissing).toBe(1);
  });

  it('detects a non-image file even when its name ends in .jpg', async () => {
    const root = await makeRoot();
    await putImage(root, 'Chapter 01/fake.jpg', Buffer.from('plain text, not an image'));
    const result = await map(root, [panel(uuidA, 'Chapter 01/fake.jpg')],
      [analysis('chapter.json', 1, [{ beat_id: 'b1', panel_uuids: [uuidA] }])]);
    expect(result.chapters[0].beats[0].panels[0].status).toBe('image-invalid');
    expect(result.statistics.imagesInvalid).toBe(1);
  });

  it('accepts source_file null when panel.file exists and source_regions describe multiple sources', async () => {
    const root = await makeRoot();
    const relative = '章节一/合成 panel.jpg';
    const actualPath = await putImage(root, relative);
    const result = await map(root, [panel(uuidA, relative, {
      source_file: null,
      source_regions: [{ source_file: 'page-a.webp' }, { source_file: 'page-b.webp' }]
    })], [analysis('chapter.json', 1, [{ beat_id: 'b1', panel_uuids: [uuidA] }])]);
    expect(result.chapters[0].beats[0].panels[0]).toMatchObject({ status: 'mapped', imageStatus: 'found', resolvedPath: actualPath, sourceRegionsCount: 2, sourceFileIsNull: true });
    expect(result.statistics.imagesFound).toBe(1);
  });

  it('loads the exact Unicode relative Manifest file for the image preview and blocks traversal', async () => {
    const root = await makeRoot();
    const relative = '漫画/第１章/画像 01.jpg';
    const actualPath = await putImage(root, relative);
    const preview = await loadPanelImageData(root, relative);
    expect(preview).toMatchObject({ resolvedPath: actualPath });
    expect(preview.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    await expect(loadPanelImageData(root, '../outside.jpg')).rejects.toThrow(/Unsafe relative/);
  });

  it('allows a panel UUID to be reused across beats and counts it once as used', async () => {
    const root = await makeRoot();
    await putImage(root, 'Chapter 01/panel.jpg');
    const result = await map(root, [panel(uuidA, 'Chapter 01/panel.jpg')], [analysis('chapter.json', 1, [
      { beat_id: 'b1', panel_uuids: [uuidA] },
      { beat_id: 'b2', panel_uuids: [uuidA] }
    ])]);
    expect(result.chapters[0].beats[0].panels[0].status).toBe('mapped');
    expect(result.chapters[0].beats[1].panels[0].status).toBe('mapped');
    expect(result.statistics.distinctUuidsUsed).toBe(1);
    expect(result.statistics.invalidUuidReferences + result.statistics.unknownUuidReferences).toBe(0);
  });

  it('marks duplicate Manifest UUIDs ambiguous instead of choosing by position', async () => {
    const root = await makeRoot();
    await putImage(root, 'a.jpg');
    await putImage(root, 'b.jpg');
    const result = await map(root, [panel(uuidA, 'a.jpg', { id: 'A' }), panel(uuidA, 'b.jpg', { id: 'B' })],
      [analysis('chapter.json', 1, [{ beat_id: 'b1', panel_uuids: [uuidA] }])]);
    expect(result.chapters[0].beats[0].panels[0].status).toBe('duplicate-manifest-uuid');
    expect(result.statistics.duplicateManifestUuidGroups).toBe(1);
    expect(result.statistics.distinctUuidsUsed).toBe(0);
  });

  it('rejects traversal paths rather than resolving outside the selected image root', async () => {
    const root = await makeRoot();
    const result = await map(root, [panel(uuidA, '../outside.jpg')],
      [analysis('chapter.json', 1, [{ beat_id: 'b1', panel_uuids: [uuidA] }])]);
    expect(result.chapters[0].beats[0].panels[0].status).toBe('image-path-error');
    expect(result.statistics.imagePathErrors).toBe(1);
  });

  it('reports malformed Manifest UUIDs and unused valid panels separately', async () => {
    const root = await makeRoot();
    await putImage(root, 'unused.jpg');
    const result = await map(root, [panel('bad', 'unused.jpg')], [analysis('chapter.json', 1, [])]);
    expect(result.statistics.invalidManifestUuids).toBe(1);
    expect(result.statistics.unusedPanels).toBe(0);
    expect(result.statistics.totalPanels).toBe(1);
  });
});
