import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPackageToDirectory } from '../src/main/export-package';
import { createLogicalPages, movePanel, moveScene, splitScene, type LogicalPageDocument } from '../src/shared/logical-pages';
import type { ChapterMapping, MappingResult, PanelReferenceMapping } from '../src/shared/types';

const roots: string[] = [];
const uuids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
];
async function tempRoot() { const root = await mkdtemp(path.join(os.tmpdir(), 'panelvid-export-')); roots.push(root); return root; }
function reference(uuid: string, file: string): PanelReferenceMapping { return { referenceUuid: uuid, panelId: uuid, manifestFile: file, resolvedPath: path.resolve('/unused', file), imageStatus: 'found', status: 'mapped', sourceRegionsCount: 0, sourceFileIsNull: false }; }
function beat(id: string, text: string, panels: PanelReferenceMapping[]) { return { beatId: id, order: 1, narration: text, metadata: { emotion: 'calm', transition: 'cut' }, panels }; }
function chapter(chapterKey: string, number: number, beats: ChapterMapping['beats']): ChapterMapping { return { chapterKey, fileName: `${chapterKey}.json`, series: '漫画 σειρά', chapterNumber: number, chapterTitle: '章一', beats }; }
async function fixture(root: string) {
  const sourceRoot = path.join(root, 'source'); await mkdir(sourceRoot);
  const refs = new Map<string, PanelReferenceMapping>();
  for (const [index, uuid] of uuids.entries()) {
    const file = `第${index + 1}页/画像_${index + 1}.jpg`;
    const abs = path.join(sourceRoot, file); await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from([0xff, 0xd8, 0xff, index, 0xd9]));
    refs.set(uuid, { ...reference(uuid, file), resolvedPath: abs });
  }
  const chapters = [
    chapter('ch-one', 1, [
      beat('b1', 'Lời kể tiếng Việt — dòng một.\nDòng hai giữ nguyên.', [refs.get(uuids[0])!, refs.get(uuids[1])!, refs.get(uuids[2])!]),
      beat('b2', 'Narration lặp UUID được copy lần nữa.', [refs.get(uuids[0])!])
    ]),
    chapter('ch-two', 2, [beat('b1', '第二章のナレーション。', [refs.get(uuids[1])!])])
  ];
  const manifestPanels = [...refs.entries()].map(([uuid, ref]) => ({ entryKey: uuid, panelId: uuid, uuid, uuidStatus: 'valid' as const, manifestFile: ref.manifestFile, resolvedPath: ref.resolvedPath, imageStatus: 'found' as const, sourceRegionsCount: 0, sourceFileIsNull: false, used: true }));
  const mapping: MappingResult = { projectName: '漫畫測試', projectId: 'project-x', imageRoot: sourceRoot, chapters, manifestPanels, statistics: { totalPanels: 3, distinctUuidsUsed: 3, imagesFound: 3, imagesMissing: 0, imagesInvalid: 0, imagePathErrors: 0, invalidUuidReferences: 0, unknownUuidReferences: 0, invalidManifestUuids: 0, duplicateManifestUuidGroups: 0, unusedPanels: 0 } };
  return { mapping, sourceRoot, manifestPanels };
}

const outputParent = async (root: string) => { const out = path.join(root, 'output'); await mkdir(out); return out; };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('PanelVid package exporter', () => {
  it('exports multiple chapters, multiple panels, repeated UUID occurrences, Unicode and original order into readable package/report', async () => {
    const root = await tempRoot(); const { mapping } = await fixture(root); const document = createLogicalPages(mapping);
    const firstPage = document.pages[0];
    const afterFirst = splitScene(document, firstPage.id, firstPage.scenes[0].id, firstPage.scenes[0].panels[0].key);
    const secondScene = afterFirst.pages[0].scenes[1];
    const reorderPanel = movePanel(afterFirst, firstPage.id, secondScene.id, secondScene.panels[1].key, -1);
    const movedScenes = moveScene(reorderPanel, firstPage.id, secondScene.id, -1);
    const parent = await outputParent(root);
    const result = await exportPackageToDirectory(mapping, movedScenes, parent);
    const report = JSON.parse(await readFile(path.join(result.outputPath, 'export_report.json'), 'utf8'));
    expect(report).toMatchObject({ project_id: 'project-x', total_chapters: 2, total_pages: 3, total_panels: 5, total_srt_cues: 3, export_status: 'success' });
    expect(report.chapter_results[0].panels.map((panel: { uuid: string }) => panel.uuid)).toEqual([uuids[2], uuids[1], uuids[0], uuids[0]]);
    expect(report.chapter_results[0].panels[3].export_filename).not.toBe(report.chapter_results[0].panels[0].export_filename);
    expect(report.chapter_results[0].panels[0]).toMatchObject({ scene_index: 1, panel_order: 1, logical_page_index: 1 });
    expect(await readFile(path.join(result.outputPath, 'Chapter_001', 'Page 001', 'Panel 001.jpg'))).toEqual(await readFile(path.join(mapping.imageRoot, '第3页', '画像_3.jpg')));
    const srt = await readFile(path.join(result.outputPath, 'Chapter_001', 'Chapter 001.srt'), 'utf8');
    expect(srt).toContain('[TRANG 1]\nLời kể tiếng Việt — dòng một.\nDòng hai giữ nguyên.');
    expect(srt).toContain('[TRANG 2]\nNarration lặp UUID được copy lần nữa.');
    expect(await readFile(path.join(result.outputPath, 'Chapter_002', 'Chapter 002.srt'), 'utf8')).toContain('[TRANG 1]\n第二章のナレーション。');
    expect(result.exportedFileCount).toBe(8);
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it('exports the minimal one-chapter, one-beat, one-panel package', async () => {
    const root = await tempRoot(); const { mapping } = await fixture(root);
    const oneBeat = { ...mapping.chapters[0].beats[0], panels: [mapping.chapters[0].beats[0].panels[0]] };
    const minimal: MappingResult = { ...mapping, chapters: [{ ...mapping.chapters[0], beats: [oneBeat] }], manifestPanels: [mapping.manifestPanels[0]] };
    const result = await exportPackageToDirectory(minimal, createLogicalPages(minimal), await outputParent(root));
    expect(result.exportedFileCount).toBe(3);
    expect(await readFile(path.join(result.outputPath, 'Chapter_001', 'Page 001', 'Panel 001.jpg'))).toBeDefined();
    expect(await readFile(path.join(result.outputPath, 'Chapter_001', 'Chapter 001.srt'), 'utf8')).toContain('[TRANG 1]');
    expect(result.report).toMatchObject({ total_chapters: 1, total_pages: 1, total_panels: 1, total_srt_cues: 1 });
  });

  it('fails before writing a package for unknown UUID, missing image, empty page or empty narration', async () => {
    const root = await tempRoot(); const { mapping } = await fixture(root); const document = createLogicalPages(mapping); const parent = await outputParent(root);
    const badUuidMapping = structuredClone(mapping);
    badUuidMapping.chapters[0].beats[0].panels[0].status = 'uuid-not-found';
    await expect(exportPackageToDirectory(badUuidMapping, createLogicalPages(badUuidMapping), parent)).rejects.toThrow(/validation/);
    const missingImageDoc = structuredClone(document);
    missingImageDoc.pages[0].scenes[0].panels[0].reference.imageStatus = 'missing';
    missingImageDoc.pages[0].scenes[0].panels[0].reference.status = 'image-missing';
    await expect(exportPackageToDirectory(mapping, missingImageDoc, parent)).rejects.toThrow(/validation/);
    const emptyPage: LogicalPageDocument = { pages: document.pages.map((page, index) => index === 0 ? { ...page, scenes: [] } : page) };
    await expect(exportPackageToDirectory(mapping, emptyPage, parent)).rejects.toThrow(/validation/);
    const emptyNarration: LogicalPageDocument = { pages: document.pages.map((page, index) => index === 0 ? { ...page, beat: { ...page.beat, narration: '' } } : page) };
    await expect(exportPackageToDirectory(mapping, emptyNarration, parent)).rejects.toThrow(/validation/);
    const shuffledPages: LogicalPageDocument = { pages: [...document.pages].reverse() };
    await expect(exportPackageToDirectory(mapping, shuffledPages, parent)).rejects.toThrow(/validation/);
    await expect(stat(path.join(parent, 'PanelVid_Output'))).rejects.toThrow();
  });

  it('does not overwrite an existing package and rolls back staging after a mid-export file failure', async () => {
    const root = await tempRoot(); const { mapping } = await fixture(root); const document = createLogicalPages(mapping); const parent = await outputParent(root);
    const target = path.join(parent, 'PanelVid_Output'); await mkdir(target); await writeFile(path.join(target, 'keep.txt'), 'keep');
    await expect(exportPackageToDirectory(mapping, document, parent)).rejects.toThrow(/đã tồn tại/);
    expect(await readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('keep');
    await rm(target, { recursive: true });
    await rm(path.join(mapping.imageRoot, '第3页', '画像_3.jpg'));
    await expect(exportPackageToDirectory(mapping, document, parent)).rejects.toThrow();
    expect(await readdir(parent)).toEqual([]);
  });

  it('rejects path traversal and unsafe output names without leaving partial files', async () => {
    const root = await tempRoot(); const { mapping } = await fixture(root); const document = createLogicalPages(mapping); const parent = await outputParent(root);
    const altered = structuredClone(document);
    altered.pages[0].scenes[0].panels[0].reference.manifestFile = '../outside.jpg';
    mapping.manifestPanels[0].manifestFile = '../outside.jpg';
    await expect(exportPackageToDirectory(mapping, altered, parent)).rejects.toThrow(/Unsafe relative/);
    expect(await readdir(parent)).toEqual([]);
  });
});
