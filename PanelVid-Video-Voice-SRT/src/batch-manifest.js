const IMAGE_EXT = /\.(?:jpe?g|png|webp|bmp)$/i;
const SUB_EXT = /\.(?:txt|srt)$/i;
const GENERIC_DIR = /^(?:images?|panels?|pages?|output|export|assets?)$/i;

function pathParts(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
}
function fileStem(value) {
  const base = pathParts(value).at(-1) || String(value || '');
  return base.replace(/\.(?:txt|srt|jpe?g|png|webp|bmp)$/i, '');
}
function plain(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
export function batchNameKeys(value) {
  const raw = plain(fileStem(value));
  const compact = raw.replace(/[^a-z0-9]+/g, '');
  const variants = new Set([compact]);
  const prefixed = /^(?:chapter|chap|ch|episode|ep)(\d+)(.*)$/.exec(compact);
  if (prefixed) variants.add(`${String(Number(prefixed[1]))}${prefixed[2]}`);
  const digits = /^(?:chapter|chap|ch|episode|ep)?0*(\d+)$/.exec(compact);
  if (digits) variants.add(String(Number(digits[1])));
  return [...variants].filter(Boolean);
}
function isChapterLike(dir) {
  const s = plain(dir).replace(/[^a-z0-9]+/g, '');
  return /^(?:chapter|chap|ch|episode|ep)\d+/.test(s) || /^\d+$/.test(s);
}
function commonPrefixLength(arrays) {
  if (!arrays.length) return 0;
  let i = 0;
  while (arrays.every(parts => parts[i] != null && parts[i] === arrays[0][i])) i++;
  return i;
}

export function buildBatchManifest(imageItems, subtitleItems, naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })) {
  const images = (imageItems || []).filter(item => IMAGE_EXT.test(item.path || item.name || ''));
  const subtitles = (subtitleItems || []).filter(item => SUB_EXT.test(item.path || item.name || '')).map((item, index) => ({
    ...item,
    id: String(item.id ?? `${index}:${item.path || item.name}`),
    name: String(item.name || pathParts(item.path).at(-1) || `subtitle-${index + 1}`),
    type: /\.txt$/i.test(item.name || item.path || '') ? 'txt' : 'srt',
    keys: batchNameKeys(item.path || item.name),
  }));
  subtitles.sort((a, b) => naturalCompare(a.path || a.name, b.path || b.name));
  const subtitleByKey = new Map();
  for (const sub of subtitles) for (const key of sub.keys) {
    const entries = subtitleByKey.get(key) || [];
    entries.push(sub);
    subtitleByKey.set(key, entries);
  }
  const groups = new Map();
  const unmatched = [];
  const sortedImages = [...images].sort((a, b) => naturalCompare(a.path || a.name, b.path || b.name));

  for (const image of sortedImages) {
    const dirs = pathParts(image.path || image.name).slice(0, -1);
    let match = null, matchIndex = -1;
    for (let i = 0; i < dirs.length; i++) {
      const candidates = dirs[i] ? batchNameKeys(dirs[i]).flatMap(key => subtitleByKey.get(key) || []) : [];
      if (candidates.length) {
        const unique = [...new Map(candidates.map(sub => [sub.id, sub])).values()];
        unique.sort((a, b) => (a.type === 'txt' ? 0 : 1) - (b.type === 'txt' ? 0 : 1) || naturalCompare(a.name, b.name));
        match = unique[0]; matchIndex = i;
      }
    }
    if (match) {
      const folderParts = dirs.slice(0, matchIndex + 1);
      const key = `matched:${folderParts.join('/')}`;
      if (!groups.has(key)) groups.set(key, { key, folderPath: folderParts.join('/'), name: dirs[matchIndex], images: [], subtitleId: match.id, matchKind: 'name' });
      groups.get(key).images.push(image);
    } else unmatched.push({ image, dirs });
  }

  if (unmatched.length) {
    const dirLists = unmatched.map(row => row.dirs);
    const shared = commonPrefixLength(dirLists);
    const oneSubtitleAndNoMatchedGroup = subtitles.length === 1 && groups.size === 0;
    let fallbackDepth;
    if (oneSubtitleAndNoMatchedGroup) fallbackDepth = shared;
    else if (shared > 0 && (isChapterLike(dirLists[0][shared - 1]) || shared === Math.min(...dirLists.map(d => d.length)))) fallbackDepth = shared;
    else fallbackDepth = Math.min(shared + 1, Math.min(...dirLists.map(d => d.length)));
    fallbackDepth = Math.max(0, fallbackDepth);
    for (const { image, dirs } of unmatched) {
      const folderParts = dirs.slice(0, fallbackDepth);
      if (folderParts.length > 1 && GENERIC_DIR.test(folderParts.at(-1))) folderParts.pop();
      const fallbackParts = folderParts.length ? folderParts : dirs.slice(0, Math.max(0, dirs.length - 1));
      const name = fallbackParts.at(-1) || subtitles[0]?.name?.replace(/\.(txt|srt)$/i, '') || 'Chap';
      const key = `folder:${fallbackParts.join('/') || 'root'}`;
      if (!groups.has(key)) groups.set(key, { key, folderPath: fallbackParts.join('/'), name, images: [], subtitleId: null, matchKind: 'folder' });
      groups.get(key).images.push(image);
    }
  }

  const chapters = [...groups.values()].map(chapter => ({ ...chapter, images: chapter.images.sort((a, b) => naturalCompare(a.path || a.name, b.path || b.name)) }));
  chapters.sort((a, b) => naturalCompare(a.folderPath || a.name, b.folderPath || b.name));
  const usedIds = new Set(chapters.map(chapter => chapter.subtitleId).filter(Boolean));
  const matchedKeys = new Set(chapters.filter(chapter => chapter.subtitleId)
    .flatMap(chapter => batchNameKeys(chapter.name)));
  const remaining = subtitles.filter(sub => !usedIds.has(sub.id) && !sub.keys.some(key => matchedKeys.has(key)));
  let nextSubtitle = 0;
  for (const chapter of chapters) {
    if (chapter.subtitleId) continue;
    const subtitle = remaining[nextSubtitle++];
    if (!subtitle) continue;
    chapter.subtitleId = subtitle.id;
    chapter.matchKind = 'natural-order';
  }
  return { chapters, subtitles, imageCount: images.length };
}

export function validateBatchAssignments(chapters, subtitles) {
  const list = Array.isArray(chapters) ? chapters : [];
  const subs = Array.isArray(subtitles) ? subtitles : [];
  const used = new Map();
  const errors = new Map();
  for (const chapter of list) {
    const sub = subs.find(item => item.id === chapter.subtitleId);
    if (!chapter.images?.length) errors.set(chapter.key, 'Không có ảnh panel.');
    else if (!sub) errors.set(chapter.key, 'Chưa ghép file TXT/SRT.');
    else if (used.has(sub.id)) errors.set(chapter.key, `Subtitle đang được dùng cho chap “${used.get(sub.id)}”.`);
    else used.set(sub.id, chapter.name);
  }
  return { ready: list.length > 0 && errors.size === 0, errors };
}
