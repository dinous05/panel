import type { ChapterMapping, MappingResult, PanelReferenceMapping, VoiceBeatMapping } from './types';

export interface LogicalPanel {
  /** Stable occurrence identity, distinct even when a UUID is referenced more than once. */
  key: string;
  sourceIndex: number;
  reference: PanelReferenceMapping;
}
export interface LogicalScene { id: string; panels: LogicalPanel[] }
export interface LogicalPage {
  id: string;
  chapterKey: string;
  chapterLabel: string;
  chapterOrder: number;
  beatIndex: number;
  beat: VoiceBeatMapping;
  scenes: LogicalScene[];
}
export interface LogicalPageDocument { pages: LogicalPage[] }
export interface LogicalPageIssue { severity: 'error' | 'warning'; code: string; message: string; pageId?: string; panelKey?: string }

export function createLogicalPages(mapping: MappingResult): LogicalPageDocument {
  const pages: LogicalPage[] = [];
  mapping.chapters.forEach((chapter: ChapterMapping, chapterOrder) => {
    chapter.beats.forEach((beat, beatIndex) => {
      const pageId = `${chapter.chapterKey}::beat-${beatIndex}`;
      const panels = beat.panels.map((reference, sourceIndex) => ({ key: `${pageId}::panel-${sourceIndex}`, sourceIndex, reference }));
      pages.push({
        id: pageId, chapterKey: chapter.chapterKey,
        chapterLabel: `${chapter.series ?? 'Chapter'}${chapter.chapterNumber == null ? '' : ` ${chapter.chapterNumber}`}${chapter.chapterTitle ? ` · ${chapter.chapterTitle}` : ''}`,
        chapterOrder, beatIndex, beat,
        scenes: [{ id: `${pageId}::scene-0`, panels }]
      });
    });
  });
  return { pages };
}

function updatePage(doc: LogicalPageDocument, pageId: string, updater: (page: LogicalPage) => LogicalPage): LogicalPageDocument {
  return { pages: doc.pages.map(page => page.id === pageId ? updater(page) : page) };
}

export function moveScene(doc: LogicalPageDocument, pageId: string, sceneId: string, direction: -1 | 1): LogicalPageDocument {
  return updatePage(doc, pageId, page => {
    const from = page.scenes.findIndex(scene => scene.id === sceneId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= page.scenes.length) return page;
    const scenes = [...page.scenes];
    [scenes[from], scenes[to]] = [scenes[to], scenes[from]];
    return { ...page, scenes };
  });
}

export function movePanel(doc: LogicalPageDocument, pageId: string, sceneId: string, panelKey: string, direction: -1 | 1): LogicalPageDocument {
  return updatePage(doc, pageId, page => {
    if (!page.scenes.some(scene => scene.id === sceneId)) return page;
    const scenes = page.scenes.map(scene => ({ ...scene, panels: [...scene.panels] }));
    const flat = scenes.flatMap(scene => scene.panels);
    const from = flat.findIndex(panel => panel.key === panelKey);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= flat.length) return page;
    [flat[from], flat[to]] = [flat[to], flat[from]];
    let offset = 0;
    for (const scene of scenes) {
      scene.panels = flat.slice(offset, offset + scene.panels.length);
      offset += scene.panels.length;
    }
    return { ...page, scenes };
  });
}

export function splitScene(doc: LogicalPageDocument, pageId: string, sceneId: string, afterPanelKey: string): LogicalPageDocument {
  return updatePage(doc, pageId, page => {
    const index = page.scenes.findIndex(scene => scene.id === sceneId);
    if (index < 0) return page;
    const scene = page.scenes[index];
    const cut = scene.panels.findIndex(panel => panel.key === afterPanelKey) + 1;
    if (cut <= 0 || cut >= scene.panels.length) return page;
    const left = { ...scene, panels: scene.panels.slice(0, cut) };
    const right = { id: `${page.id}::scene-split-${afterPanelKey}`, panels: scene.panels.slice(cut) };
    const scenes = [...page.scenes];
    scenes.splice(index, 1, left, right);
    return { ...page, scenes };
  });
}

export function mergeSceneWithPrevious(doc: LogicalPageDocument, pageId: string, sceneId: string): LogicalPageDocument {
  return updatePage(doc, pageId, page => {
    const index = page.scenes.findIndex(scene => scene.id === sceneId);
    if (index <= 0) return page;
    const scenes = [...page.scenes];
    const previous = scenes[index - 1];
    const current = scenes[index];
    scenes.splice(index - 1, 2, { ...previous, panels: [...previous.panels, ...current.panels] });
    return { ...page, scenes };
  });
}

export function validateLogicalPages(doc: LogicalPageDocument, mapping: MappingResult): LogicalPageIssue[] {
  const issues: LogicalPageIssue[] = [];
  const knownChapters = new Set(mapping.chapters.map(chapter => chapter.chapterKey));
  for (const chapter of mapping.chapters) {
    if (chapter.beats.length === 0) issues.push({ severity: 'error', code: 'empty-chapter', message: `Chapter ${chapter.fileName} không có Voice Beat/Logical Page.` });
  }
  const expected = new Map<string, number>();
  mapping.chapters.forEach(chapter => chapter.beats.forEach(beat => beat.panels.forEach(panel => {
    if (panel.status === 'invalid-uuid' || panel.status === 'uuid-not-found' || panel.status === 'duplicate-manifest-uuid') {
      issues.push({ severity: 'error', code: panel.status, message: `Beat “${beat.beatId ?? 'không có ID'}”: ${panel.referenceUuid || 'UUID rỗng'} không map được duy nhất.` });
    } else if (panel.status !== 'mapped') {
      issues.push({ severity: 'error', code: panel.status, message: `Beat “${beat.beatId ?? 'không có ID'}”: ${panel.referenceUuid} có trạng thái ảnh ${panel.status}.` });
    }
    expected.set(panel.referenceUuid, (expected.get(panel.referenceUuid) ?? 0) + 1);
  })));

  const seenOccurrences = new Set<string>();
  const actual = new Map<string, number>();
  const pagePositions = new Map<string, number>();
  for (const [index, page] of doc.pages.entries()) {
    if (!knownChapters.has(page.chapterKey)) issues.push({ severity: 'error', code: 'chapter-moved', message: 'Logical Page trỏ đến chapter không tồn tại.', pageId: page.id });
    const expectedPageId = `${page.chapterKey}::beat-${page.beatIndex}`;
    if (page.id !== expectedPageId || pagePositions.has(page.id)) issues.push({ severity: 'error', code: 'page-order', message: 'Logical Page bị trùng hoặc thứ tự/định danh beat không hợp lệ.', pageId: page.id });
    pagePositions.set(page.id, index);
    if (page.beat.panels.length === 0) issues.push({ severity: 'error', code: 'beat-empty', message: 'Voice Beat không có panel.', pageId: page.id });
    if (page.scenes.length === 0) issues.push({ severity: 'error', code: 'no-scenes', message: 'Logical Page không có Scene.', pageId: page.id });
    for (const scene of page.scenes) {
      if (scene.panels.length === 0) issues.push({ severity: 'error', code: 'empty-scene', message: 'Scene rỗng.', pageId: page.id });
      for (const panel of scene.panels) {
        if (seenOccurrences.has(panel.key)) issues.push({ severity: 'error', code: 'duplicate-panel-occurrence', message: 'Một panel occurrence bị lặp trong cấu trúc.', pageId: page.id, panelKey: panel.key });
        seenOccurrences.add(panel.key);
        if (!page.beat.panels[panel.sourceIndex] || page.beat.panels[panel.sourceIndex] !== panel.reference) {
          issues.push({ severity: 'error', code: 'unknown-panel-occurrence', message: 'Panel không thuộc beat gốc của Logical Page.', pageId: page.id, panelKey: panel.key });
        }
        actual.set(panel.reference.referenceUuid, (actual.get(panel.reference.referenceUuid) ?? 0) + 1);
      }
    }
  }
  for (const chapter of mapping.chapters) chapter.beats.forEach((beat, beatIndex) => {
    const id = `${chapter.chapterKey}::beat-${beatIndex}`;
    if (!doc.pages.some(page => page.id === id)) issues.push({ severity: 'error', code: 'missing-page', message: `Logical Page bị mất cho beat ${beat.beatId ?? beatIndex + 1}.`, pageId: id });
  });
  const expectedOrder = mapping.chapters.flatMap(chapter => chapter.beats.map((_, beatIndex) => `${chapter.chapterKey}::beat-${beatIndex}`));
  if (doc.pages.length !== expectedOrder.length || doc.pages.some((page, index) => page.id !== expectedOrder[index])) {
    issues.push({ severity: 'error', code: 'page-sequence', message: 'Thứ tự Chapter/Logical Page không còn khớp thứ tự Voice Beat đầu vào.' });
  }
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const uuid of keys) if (expected.get(uuid) !== actual.get(uuid)) issues.push({ severity: 'error', code: 'panel-count-mismatch', message: `Số lần xuất hiện UUID ${uuid} thay đổi (${expected.get(uuid) ?? 0} → ${actual.get(uuid) ?? 0}).` });
  return issues;
}
