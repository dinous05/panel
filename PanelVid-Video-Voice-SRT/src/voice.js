// voice.js — pure helpers cho voice SRT + đồng bộ mốc trang.
// Không import CSS/DOM: dùng được cho cả renderer (vite) và node --test.
export const PAGE_MARK_RE = /^\[(?:TRANG|PAGE)\s+(\d+)\]/i;

export function parseSrtTime(t) {
  const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(String(t || '').trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

export function stripPageMarker(text) {
  return String(text || '').replace(PAGE_MARK_RE, '').trim();
}

// Dòng timestamp mở đầu một cue: "00:00:08,850 --> 00:00:17,350" (phần đuôi
// sau mốc kết thúc, kiểu cài đặt VTT, bị bỏ qua).
const SRT_TS_LINE_RE = /^(\d+:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})/;

// Parse SRT -> [{start, end, text, page}] với page = số trong mốc [TRANG n]/[PAGE n] ở ĐẦU cue (null nếu không có).
// v6v: tách cue theo RANH GIỚI TIMESTAMP, không dựa vào dòng trống nữa — file
// SRT không có dòng trống giữa các cue (một số tool xuất dạng này) trước đây
// bị gộp thành MỘT cue khổng lồ chứa nguyên số thứ tự + timestamp của mọi
// cue sau, và TTS đọc thành tiếng một đống số 0.
export function parseSRT(raw) {
  const cues = [];
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  let current = null;
  const flush = () => {
    if (!current) return;
    const rawText = current.textLines.filter(l => !l.includes('-->')).join('\n').trim();
    const { start, end } = current;
    current = null;
    if (!rawText) return;
    const mark = PAGE_MARK_RE.exec(rawText);
    cues.push({ start, end, text: stripPageMarker(rawText), page: mark ? Number(mark[1]) : null });
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const tm = SRT_TS_LINE_RE.exec(t);
    if (tm) {
      flush();
      const start = parseSrtTime(tm[1]), end = parseSrtTime(tm[2]);
      current = start != null && end != null && end > start ? { start, end, textLines: [] } : null;
      continue;
    }
    if (!current) continue;
    // Dòng toàn số đứng ngay trước một dòng timestamp = số thứ tự của cue kế
    // tiếp (chỉ xuất hiện khi file không có dòng trống) — không phải lời đọc.
    if (/^\d+$/.test(t) && SRT_TS_LINE_RE.test((lines[i + 1] || '').trim())) continue;
    current.textLines.push(lines[i]);
  }
  flush();
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// Dựng timeline voice: cue i bắt đầu tại max(srtStart_i, end cue trước theo audio thật).
// Trả về {starts, duration} với duration = D = end cue cuối.
export function buildVoiceTimeline(srtStarts, audioDurations) {
  const starts = [];
  let cursor = 0;
  for (let i = 0; i < srtStarts.length; i++) {
    const start = Math.max(Number(srtStarts[i]) || 0, cursor);
    starts.push(start);
    cursor = start + (Number(audioDurations[i]) || 0);
  }
  return { starts, duration: cursor };
}

export function shareFrames(totalFrames, count) {
  if (!count) return [];
  const base = Math.floor(totalFrames / count), remainder = totalFrames % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Chia totalFrames theo TRỌNG SỐ (v6r): mỗi phần >= 1 frame, tổng khớp đúng,
// phần dư phân theo phần lẻ lớn nhất. Trả null khi trọng số không dùng được
// (rỗng / có giá trị <= 0 / không đủ frame) -> caller lùi về shareFrames đều.
export function shareFramesWeighted(totalFrames, weights) {
  const total = Math.round(Number(totalFrames) || 0);
  if (!Array.isArray(weights) || !weights.length || total < weights.length) return null;
  if (weights.some(w => !Number.isFinite(Number(w)) || !(Number(w) > 0))) return null;
  const sum = weights.reduce((a, b) => a + Number(b), 0);
  const rest = total - weights.length;
  const raw = weights.map(w => rest * Number(w) / sum);
  const extra = raw.map(v => Math.floor(v));
  let used = extra.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; used < rest && k < order.length; k++, used++) extra[order[k][1]]++;
  return extra.map(v => v + 1);
}

// Kiểm tra mốc trang có khớp số trang ảnh không. pageSegments: {pageIndex 0-based: [start, end]}.
export function checkMarkerMatch(pageSegments, pageCount) {
  const idx = Object.keys(pageSegments || {}).map(Number).sort((a, b) => a - b);
  if (!idx.length) return { ok: false, reason: 'SRT không có mốc [TRANG n].' };
  if (idx.length !== pageCount || !idx.every((m, i) => m === i)) {
    return { ok: false, reason: `SRT có ${idx.length} mốc trang nhưng chap có ${pageCount} trang ảnh.` };
  }
  return { ok: true, reason: '' };
}

// Phân tích mốc trang (v6k) — triết lý: trang CÓ mốc [TRANG n] thì khớp tiếng,
// trang KHÔNG có mốc thì không xuất hiện trong video (trang bìa, trang quảng cáo,
// trang bị sub bỏ qua đều bị loại như nhau):
// - 'full':    mọi trang 1..pageCount đều có mốc.
// - 'partial': có >= 1 mốc và mọi mốc nằm trong 1..pageCount; droppedPageIndices =
//              mọi trang không có mốc (đầu chap / giữa chap / cuối chap như nhau).
// - 'none':    không có mốc nào.
// - 'invalid': có mốc nằm ngoài 1..pageCount — reason nêu mốc vi phạm.
export function analyzeMarkers(pageSegments, pageCount) {
  const pc = Math.max(0, Math.round(Number(pageCount) || 0));
  const idx = Object.keys(pageSegments || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!idx.length) return { mode: 'none', covered: 0, droppedPageIndices: [], extraPageIndices: [], reason: 'SRT không có mốc [TRANG n].' };
  const outOfRange = idx.filter(i => i < 0 || i >= pc);
  if (outOfRange.length) {
    const names = outOfRange.map(i => `[TRANG ${i + 1}]`).join(', ');
    return {
      mode: 'invalid', covered: idx.length - outOfRange.length, droppedPageIndices: [], extraPageIndices: [],
      reason: `Mốc ${names} vượt quá số trang của chap (${pc} trang).`,
    };
  }
  const marked = new Set(idx);
  const droppedPageIndices = [];
  for (let p = 0; p < pc; p++) if (!marked.has(p)) droppedPageIndices.push(p);
  if (!droppedPageIndices.length) {
    return { mode: 'full', covered: pc, droppedPageIndices: [], extraPageIndices: [], reason: '' };
  }
  return {
    mode: 'partial', covered: idx.length, droppedPageIndices, extraPageIndices: droppedPageIndices,
    reason: `SRT có mốc cho ${idx.length}/${pc} trang; ${droppedPageIndices.length} trang không có mốc.`,
  };
}

// Suy pageSegments từ mốc [TRANG n] trong cues (dùng khi chưa tạo voice — vd chốt
// chặn lúc đưa vào hàng đợi). Thời gian lấy theo mốc SRT: segment của 1 trang bắt
// đầu ở cue đầu tiên gắn mốc trang đó, kết thúc ở mốc trang kế tiếp / cue cuối.
export function markerSegmentsFromCues(cues) {
  const list = cues || [];
  const starts = new Map(), order = [];
  let lastEnd = 0;
  for (const cue of list) {
    lastEnd = Math.max(lastEnd, Number(cue.end) || 0);
    const pg = cue && cue.page;
    if (pg == null || starts.has(pg)) continue;
    starts.set(pg, Number(cue.start) || 0);
    order.push(pg);
  }
  const segments = {};
  order.forEach((pg, i) => {
    const end = i + 1 < order.length ? starts.get(order[i + 1]) : lastEnd;
    segments[pg - 1] = [starts.get(pg), end];
  });
  return segments;
}

// Tính panel.seconds ở chế độ voice. perScene chứa duration của các trang CÓ mốc,
// theo thứ tự trang tăng dần (panel trong trang giữ thứ tự).
// v6k: 'full' như cũ; 'partial' chỉ tính các trang có mốc và trả droppedPageIndices
// (caller PHẢI loại scene của các trang đó khỏi render và khỏi việc map perScene);
// 'none'/'invalid' -> chia đều + fallback:true.
// v6r: sceneWeightsPerPage (mảng theo trang -> mảng trọng số theo cảnh, từ
// scene.panWeight của dải dọc) -> trong trang chia theo trọng số lia thay vì
// chia đều, để tốc độ lia đồng đều giữa các cảnh; trang nào thiếu trọng số
// thì trang đó vẫn chia đều như cũ. sceneWeights (phẳng, theo thứ tự trang
// rồi cảnh) chỉ dùng cho nhánh fallback không mốc.
export function computeVoiceDurations({ pageCount, scenesPerPage, pageSegments, D, fps = 60, sceneWeightsPerPage = null, sceneWeights = null }) {
  const pc = Math.max(0, Math.round(Number(pageCount) || 0));
  const analysis = analyzeMarkers(pageSegments, pc);
  const perScene = [];
  if (analysis.mode === 'full' || analysis.mode === 'partial') {
    const dropped = new Set(analysis.droppedPageIndices);
    for (let p = 0; p < pc; p++) {
      if (dropped.has(p)) continue;
      const [s, e] = pageSegments[p];
      const frames = Math.max(scenesPerPage[p], Math.round((e - s) * fps));
      const w = sceneWeightsPerPage && sceneWeightsPerPage[p];
      const parts = (Array.isArray(w) && w.length === scenesPerPage[p]) ? shareFramesWeighted(frames, w) : null;
      for (const f of parts || shareFrames(frames, scenesPerPage[p])) perScene.push(f / fps);
    }
    return {
      perScene, fallback: false, reason: '', mode: analysis.mode,
      droppedPageIndices: analysis.droppedPageIndices,
    };
  }
  const total = scenesPerPage.reduce((a, b) => a + b, 0);
  const totalFrames = Math.max(total, Math.round(D * fps));
  const flat = (Array.isArray(sceneWeights) && sceneWeights.length === total) ? shareFramesWeighted(totalFrames, sceneWeights) : null;
  for (const f of flat || shareFrames(totalFrames, total)) perScene.push(f / fps);
  return {
    perScene, fallback: true, mode: analysis.mode, droppedPageIndices: [],
    reason: `${analysis.reason} Chia đều tổng thời lượng voice cho tất cả panel.`,
  };
}

// ===== Thẻ giọng đọc (v6): 2 lựa chọn Edge / clone =====
// kind: 'edge' | 'clone'. Trả về voice ID dùng để tạo voice.
export function resolveVoiceId(kind, selectValue, customId) {
  if (kind === 'clone') return 'chatterbox-clone';
  const sel = String(selectValue || '');
  if (sel === '__custom__') return String(customId || '').trim();
  return sel;
}

// Trả về thông báo lỗi nếu chưa có file giọng mẫu (thẻ clone), ngược lại null.
export function cloneRefError(refPath) {
  const r = String(refPath || '').trim();
  return r ? null : 'Hãy thả file .wav giọng mẫu vào trước.';
}

// (v6u) Bản sao text CHỈ gửi cho TTS Chatterbox — trị tận gốc cue vỡ tiếng:
// chữ TOÀN HOA ở các đoạn cảm xúc kích model clone "hét" cho tới khi tiếng
// vỡ hẳn (bản dựng Lazy Prince ch.1, cue ~12:20). Hàm này hạ chữ hoa trong
// BẢN ĐỌC; phụ đề vẫn dùng text gốc từ SRT, không qua đây.
// Chỉ biến đổi khi cue thật sự đang "hét": có >= 2 từ hoa dài (>= 4 chữ cái),
// hoặc chữ hoa chiếm > 55% cue, hoặc >= 3 từ hoa và chữ hoa > 50%. Ngưỡng
// này chừa cue bình thường có từ nhấn/viết tắt hoa (NO, CEO, FBI...) — các
// từ đó giữ nguyên từng chữ. Khi biến đổi: từ toàn-hoa hạ xuống thường, từ
// ở đầu câu (hoặc sau . ! ? …) viết hoa chữ cái đầu.
export function decapsForTts(text) {
  const src = String(text || '');
  const lettersOf = (w) => w.replace(/[^A-Za-zÀ-ỹ]/g, '');
  const isCapsWord = (w) => {
    const letters = lettersOf(w);
    return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  };
  const words = src.match(/\S+/g) || [];
  const capsWords = words.filter(isCapsWord);
  const longCaps = capsWords.filter((w) => lettersOf(w).length >= 4).length;
  const allLetters = (src.match(/[A-Za-zÀ-ỹ]/g) || []).length;
  const capsLetters = (src.match(/[A-ZÀ-Ỹ]/g) || []).length;
  const ratio = allLetters > 0 ? capsLetters / allLetters : 0;
  const shouting = longCaps >= 2 || ratio > 0.55 || (capsWords.length >= 3 && ratio > 0.5);
  if (!shouting) return src;
  let sentenceStart = true;
  return src.replace(/\S+/g, (tok) => {
    const start = sentenceStart;
    sentenceStart = /[.!?…]["'”’)]*$/.test(tok);
    if (!isCapsWord(tok)) return tok;
    const lower = tok.toLowerCase();
    return start ? lower.replace(/[a-zà-ỹ]/, (c) => c.toUpperCase()) : lower;
  });
}
