import { describe, expect, it } from 'vitest';
import { createLogicalPages, mergeSceneWithPrevious, movePanel, moveScene, splitScene, validateLogicalPages } from '../src/shared/logical-pages';
import type { MappingResult, PanelReferenceMapping } from '../src/shared/types';

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';
function ref(uuid: string): PanelReferenceMapping {
  return { referenceUuid: uuid, panelId: uuid, manifestFile: `${uuid}.jpg`, resolvedPath: `/images/${uuid}.jpg`, imageStatus: 'found', status: 'mapped', sourceRegionsCount: 0, sourceFileIsNull: false };
}
function fixture(): MappingResult {
  const beat = (beatId: string, panels: PanelReferenceMapping[]) => ({ beatId, order: 1, narration: `Text ${beatId}`, metadata: { emotion: 'calm', transition: 'cut', extra: { keep: true } }, panels });
  return { projectName: 'test', projectId: 'project-1', imageRoot: '/images', manifestPanels: [], statistics: { totalPanels: 2, distinctUuidsUsed: 2, imagesFound: 2, imagesMissing: 0, imagesInvalid: 0, imagePathErrors: 0, invalidUuidReferences: 0, unknownUuidReferences: 0, invalidManifestUuids: 0, duplicateManifestUuidGroups: 0, unusedPanels: 0 }, chapters: [{ chapterKey: 'chapter-1', fileName: 'analysis.json', series: 'Series', chapterNumber: 1, chapterTitle: null, beats: [beat('b1', [ref(uuidA), ref(uuidB), ref(uuidA)]), beat('b2', [ref(uuidB)])] }] };
}

describe('Logical Page Grouper', () => {
  it('creates one page per beat and retains beat order, narration, metadata and repeated UUID occurrences', () => {
    const mapping = fixture();
    const doc = createLogicalPages(mapping);
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages.map(page => page.beat.beatId)).toEqual(['b1', 'b2']);
    expect(doc.pages[0].scenes).toHaveLength(1);
    expect(doc.pages[0].scenes[0].panels.map(panel => panel.reference.referenceUuid)).toEqual([uuidA, uuidB, uuidA]);
    expect(doc.pages[0].beat).toBe(mapping.chapters[0].beats[0]);
    expect(validateLogicalPages(doc, mapping)).toEqual([]);
  });

  it('reorders panels and splits/merges scenes without losing panel occurrence identity', () => {
    const mapping = fixture();
    const page = createLogicalPages(mapping).pages[0];
    const sceneId = page.scenes[0].id;
    let doc = movePanel(createLogicalPages(mapping), page.id, sceneId, page.scenes[0].panels[1].key, -1);
    expect(doc.pages[0].scenes[0].panels.map(panel => panel.reference.referenceUuid)).toEqual([uuidB, uuidA, uuidA]);
    const splitAt = page.scenes[0].panels[0].key;
    doc = splitScene(createLogicalPages(mapping), page.id, sceneId, splitAt);
    expect(doc.pages[0].scenes.map(scene => scene.panels.length)).toEqual([1, 2]);
    expect(validateLogicalPages(doc, mapping)).toEqual([]);
    doc = movePanel(doc, page.id, doc.pages[0].scenes[1].id, doc.pages[0].scenes[1].panels[0].key, -1);
    expect(doc.pages[0].scenes.map(scene => scene.panels.length)).toEqual([1, 2]);
    expect(doc.pages[0].scenes.flatMap(scene => scene.panels).map(panel => panel.reference.referenceUuid)).toEqual([uuidB, uuidA, uuidA]);
    expect(validateLogicalPages(doc, mapping)).toEqual([]);
    doc = splitScene(createLogicalPages(mapping), page.id, sceneId, splitAt);
    doc = mergeSceneWithPrevious(doc, page.id, doc.pages[0].scenes[1].id);
    expect(doc.pages[0].scenes).toHaveLength(1);
    expect(doc.pages[0].scenes[0].panels.map(panel => panel.key)).toEqual(page.scenes[0].panels.map(panel => panel.key));
    expect(validateLogicalPages(doc, mapping)).toEqual([]);
  });

  it('reports missing logical pages, empty beats and changed/lost panel references', () => {
    const mapping = fixture();
    const doc = createLogicalPages(mapping);
    const damaged = { pages: [{ ...doc.pages[0], scenes: [{ ...doc.pages[0].scenes[0], panels: [] }] }] };
    const codes = validateLogicalPages(damaged, mapping).map(issue => issue.code);
    expect(codes).toContain('empty-scene');
    expect(codes).toContain('panel-count-mismatch');
    expect(codes).toContain('missing-page');
  });

  it('reorders whole scenes while preserving panel order within each scene', () => {
    const mapping = fixture();
    const page = createLogicalPages(mapping).pages[0];
    let doc = splitScene(createLogicalPages(mapping), page.id, page.scenes[0].id, page.scenes[0].panels[0].key);
    const right = doc.pages[0].scenes[1];
    doc = moveScene(doc, page.id, right.id, -1);
    expect(doc.pages[0].scenes.map(scene => scene.panels.map(panel => panel.reference.referenceUuid))).toEqual([[uuidB, uuidA], [uuidA]]);
    expect(validateLogicalPages(doc, mapping)).toEqual([]);
    expect(moveScene(doc, page.id, doc.pages[0].scenes[0].id, -1)).toEqual(doc);
  });
});
