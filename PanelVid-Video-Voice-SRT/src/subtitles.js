// subtitles.js — pure helpers cho PHỤ ĐỀ GHI LÊN VIDEO (v6i).
// Dựng items từ cues + cueStarts (timeline voice) và sinh file .ass 1920x1080.
// Không import CSS/DOM: dùng được cho cả renderer (vite), main (electron) và node --test.
import { stripPageMarker } from './voice.js';

export const SUB_FONT_SIZE_DEFAULT = 48;
export const SUB_FONT_COLOR_DEFAULT = '#FFD400';
export const SUB_OUTLINE_COLOR_DEFAULT = '#000000';

// Chuẩn hóa cỡ chữ phụ đề: 24..96, mặc định 48.
export function clampSubFontSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return SUB_FONT_SIZE_DEFAULT;
  return Math.min(96, Math.max(24, Math.round(n)));
}

// '#RRGGBB' -> '&HAABBGGRR' (định dạng màu ASS: alpha, blue, green, red; AA=00 = đặc).
// Hex sai -> dùng fallback (cũng ép qua cùng đường chuyển đổi).
export function assColor(hex, fallback = SUB_FONT_COLOR_DEFAULT) {
  const clean = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    return m ? m[1].toUpperCase() : null;
  };
  const h = clean(hex) || clean(fallback) || 'FFFFFF';
  const rr = h.slice(0, 2), gg = h.slice(2, 4), bb = h.slice(4, 6);
  return `&H00${bb}${gg}${rr}`;
}

// Độ dày viền ASS: ~fontSize/12, tối thiểu 2.
export function assOutlineWidth(fontSize) {
  return Math.max(2, Math.round(clampSubFontSize(fontSize) / 12));
}

// Giây -> 'H:MM:SS.cc' (định dạng thời gian ASS).
export function formatAssTime(sec) {
  const totalCs = Math.max(0, Math.round((Number(sec) || 0) * 100));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

// Escape text cho ASS: ngoặc nhọn là khối override nên phải thoát \{ \};
// xuống dòng -> \N (giữ xuống dòng cứng trong 1 cue).
export function escapeAssText(text) {
  return String(text || '')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N')
    .trim();
}

// Dựng danh sách dòng phụ đề từ cues + cueStarts (giây bắt đầu từng cue trên
// timeline voice do main trả về). end = start của cue sau, cue cuối = hết voice.
// Text bỏ mốc [TRANG n]; cue rỗng hoặc mốc thời gian hỏng -> bỏ qua.
export function buildSubtitleItems(cues, cueStarts, voiceDuration) {
  const items = [];
  if (!Array.isArray(cues) || !Array.isArray(cueStarts)) return items;
  const D = Number(voiceDuration) || 0;
  for (let i = 0; i < cues.length; i++) {
    const start = Number(cueStarts[i]);
    if (!Number.isFinite(start)) continue;
    let end = i + 1 < cueStarts.length ? Number(cueStarts[i + 1]) : D;
    if (!Number.isFinite(end) || end <= start) end = D;
    if (!(end > start)) continue;
    const text = stripPageMarker(String((cues[i] && cues[i].text) || ''))
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .trim();
    if (!text) continue;
    items.push({ start, end, text });
  }
  return items;
}

// Sinh toàn bộ nội dung file .ass (PlayRes 1920x1080, 1 style PanelSub,
// căn dưới giữa — Alignment=2, MarginV=44).
export function buildAssDocument(items, style = {}) {
  const fontSize = clampSubFontSize(style.fontSize);
  const primary = assColor(style.fontColor, SUB_FONT_COLOR_DEFAULT);
  const outline = assColor(style.outlineColor, SUB_OUTLINE_COLOR_DEFAULT);
  const outlineWidth = assOutlineWidth(fontSize);
  const lines = [
    '[Script Info]',
    'Title: PanelVid subtitles',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: PanelSub,Arial,${fontSize},${primary},&H000000FF,${outline},&H00000000,0,0,0,0,100,100,0,0,1,${outlineWidth},0,2,40,40,44,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  for (const it of (items || [])) {
    lines.push(`Dialogue: 0,${formatAssTime(it.start)},${formatAssTime(it.end)},PanelSub,,0,0,0,,${escapeAssText(it.text)}`);
  }
  lines.push('');
  return lines.join('\n');
}
