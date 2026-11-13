// pending.js — logic danh sách CHAP CHỜ (v6). Module thuần, test được bằng node --test.
// Park = lưu serialize state workspace vào bộ nhớ (in-memory), mở lại bất cứ lúc nào.
function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'park-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function nextParkName(seq) {
  return `Chap ${Math.max(1, Math.round(Number(seq) || 1))}`;
}

// pages: [{name, path, blob}] — blob giữ nguyên tham chiếu (in-memory).
export function serializePages(pages) {
  return (pages || []).map(p => ({ name: p.name, path: p.path, blob: p.blob, ...(Number.isInteger(p.pageGroupIndex) ? { pageGroupIndex: p.pageGroupIndex } : {}), ...(p.pageGroupName ? { pageGroupName: p.pageGroupName } : {}) }));
}

// scenes là plain object — JSON round-trip để bản park độc lập với workspace.
export function serializeScenes(scenes) {
  return JSON.parse(JSON.stringify(scenes || []));
}

export function createParkedChapter({ id, name, pages, scenes, voice, settings }) {
  // Snapshot độc lập ngay lúc park: blob ảnh giữ tham chiếu (in-memory), còn lại copy.
  return {
    id: id || newId(),
    name: String(name || 'Chap'),
    pages: serializePages(pages),
    scenes: serializeScenes(scenes),
    voice: voice ? { ...voice } : null,
    settings: settings ? { ...settings } : {},
  };
}

export function summarizeParked(item) {
  const v = item && item.voice;
  return {
    id: item.id,
    name: item.name,
    pageCount: new Set((item.scenes || []).map(scene => Number.isInteger(scene.groupIndex) ? scene.groupIndex : scene.pageIndex)).size || (item.pages || []).length,
    panelCount: (item.scenes || []).length,
    hasVoice: !!(v && v.path && v.duration),
    srtName: (v && v.srtName) || null,
  };
}

export function findParked(items, id) {
  return (items || []).find(i => i.id === id) || null;
}

// Trả về item đã xóa, hoặc null nếu không thấy.
export function removeParked(items, id) {
  const idx = (items || []).findIndex(i => i.id === id);
  if (idx < 0) return null;
  return items.splice(idx, 1)[0];
}

export function renameParked(items, id, name) {
  const item = findParked(items, id);
  if (!item) return false;
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return false;
  item.name = clean;
  return true;
}
