// autoexport.js — pure helpers cho tính năng "Tự động tạo video MP4 ngay sau khi có voice" (v6e).
// Không import CSS/DOM: dùng được cho cả renderer (vite) và node --test.

// Quyết định có tự động export MP4 sau khi tạo voice thành công hay không.
// Trả về {ok:true} hoặc {ok:false, reason:'off'|'no-voice'|'busy'|'not-desktop'|'no-scenes'}.
export function autoExportDecision({ autoExportOn, hasVoice, busy, isDesktopEnv, sceneCount }) {
  if (!autoExportOn) return { ok: false, reason: 'off' };
  if (!hasVoice) return { ok: false, reason: 'no-voice' };
  if (busy) return { ok: false, reason: 'busy' };
  if (!isDesktopEnv) return { ok: false, reason: 'not-desktop' };
  if (!(Number(sceneCount) > 0)) return { ok: false, reason: 'no-scenes' };
  return { ok: true, reason: null };
}

export function shouldAutoExportMp4(input) {
  return autoExportDecision(input).ok;
}

export const AUTO_EXPORT_SKIP_MESSAGES = {
  busy: 'App đang bận nên bỏ qua tự động tạo video. Bấm "Tạo video MP4" khi rảnh.',
  'no-scenes': 'Voice xong nhưng chưa có cảnh nào để tạo video.',
  'not-desktop': 'Hãy mở PanelVid Offline trên Windows để tự động tạo video MP4.',
};
