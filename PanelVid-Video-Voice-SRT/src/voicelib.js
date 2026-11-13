// voicelib.js — logic thuần cho "Thư viện giọng" (v6d).
// Không import DOM/Node: dùng được cho cả renderer (vite), main process và node --test.
//
// Entry thư viện: { id, name, type: 'sample'|'test'|'full', path, duration,
//                   createdAt, lang, srtName, srtHash, cueCount, pageSegments, voiceId }

export const LIB_TYPES = ['sample', 'test', 'full'];

export const TYPE_LABELS = {
  sample: 'Giọng mẫu',
  test: 'Giọng thử',
  full: 'Voice chap',
};

// Hash djb2 nhẹ nội dung SRT (chuẩn hóa xuống dòng + trim) — để kiểm tra
// voice chap có đúng là tạo từ file SRT hiện tại hay không.
export function hashSrt(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Tên file an toàn trong thư viện: bỏ ký tự cấm của Windows, gộp khoảng trắng.
export function sanitizeLibFileName(name) {
  let s = String(name || '').trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = 'voice';
  return s.slice(0, 60);
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Tên gợi ý khi lưu giọng thử: giong-thu-<lang>-<yyyymmdd>-<hhmm>
export function suggestTestName(lang, date = new Date()) {
  const d = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const t = `${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  return `giong-thu-${String(lang || 'ja').toLowerCase()}-${d}-${t}`;
}

// Tên gợi ý khi lưu voice chap: <ten-srt>-voice
export function suggestFullName(srtName) {
  const base = String(srtName || 'voice').replace(/\.srt$/i, '').trim() || 'voice';
  return `${base}-voice`;
}

// Ngày tạo hiển thị: dd/mm/yyyy hh:mm
export function formatLibDate(ts) {
  const n = Number(ts);
  if (!n || Number.isNaN(n)) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Thời lượng hiển thị: dưới 1 phút "12.3s", trên 1 phút "3:05".
export function formatLibSeconds(sec) {
  const s = Number(sec) || 0;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}:${pad2(r)}`;
}

// Dựng entry đúng chuẩn từ dữ liệu thô (kèm meta tùy loại).
export function makeEntry({ id, name, type, file, duration, createdAt, meta = {} }) {
  const t = LIB_TYPES.includes(type) ? type : 'test';
  return {
    id: String(id || ''),
    name: String(name || 'Giọng không tên').trim() || 'Giọng không tên',
    type: t,
    path: String(file || ''),
    duration: Number(duration) || 0,
    createdAt: Number(createdAt) || Date.now(),
    lang: String(meta.lang || ''),
    srtName: String(meta.srtName || ''),
    srtHash: String(meta.srtHash || ''),
    cueCount: Number(meta.cueCount) || 0,
    pageSegments: meta.pageSegments && typeof meta.pageSegments === 'object' ? meta.pageSegments : {},
    cueStarts: Array.isArray(meta.cueStarts) ? meta.cueStarts.map(Number).filter(Number.isFinite) : [],
    voiceId: String(meta.voiceId || ''),
  };
}

// Kiểm tra entry có đủ trường bắt buộc không.
export function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.id || !entry.name || !entry.path) return false;
  if (!LIB_TYPES.includes(entry.type)) return false;
  return true;
}

// Dọn index: loại entry hỏng + entry mà file không còn tồn tại.
// existingPaths: Set các path còn tồn tại.
export function pruneEntries(entries, existingPaths) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.filter(e => {
    if (!validateEntry(e)) return false;
    if (existingPaths && !existingPaths.has(e.path)) return false;
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// "Dùng" entry có được không:
// - sample/test: luôn dùng được (làm giọng mẫu clone).
// - full: chỉ khi hash của SRT hiện tại khớp srtHash đã lưu.
export function canUseFullEntry(entry, currentSrtHash) {
  if (!entry || entry.type !== 'full') return true;
  if (!entry.srtHash || !currentSrtHash) return false;
  return entry.srtHash === currentSrtHash;
}

// Danh sách hiển thị: mới nhất lên đầu.
export function sortLibEntries(entries) {
  return [...(entries || [])].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}
