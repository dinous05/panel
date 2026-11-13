// tts-retry.js — logic retry/backoff + resume cho Edge TTS.
// Module thuần ESM, KHÔNG import electron: dùng được cho node --test.
import path from 'node:path';

export const RATE_LIMIT_RE = /429|rate.?limit|too many requests/i;

// Nghỉ giữa các lần thử lại: 5s -> 15s -> 30s -> 60s.
export const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];
export const MAX_TTS_ATTEMPTS = 4;
// Voice ID đặc biệt: dùng Chatterbox local clone giọng (v5).
export const CHATTERBOX_VOICE_ID = 'chatterbox-clone';
// Voice ID đặc biệt: dùng VieNeu-TTS local clone giọng TIẾNG VIỆT (v6o).
export const VIENEU_VOICE_ID = 'vieneu-clone';
export function selectTtsBackend(voiceId) {
  if (voiceId === CHATTERBOX_VOICE_ID) return 'chatterbox';
  if (voiceId === VIENEU_VOICE_ID) return 'vieneu';
  return 'edge';
}
// Validate trước khi spawn batch Chatterbox: thiếu file mẫu -> lỗi tiếng Việt rõ.
export function validateChatterboxArgs({ cloneRef }) {
  const ref = String(cloneRef || '').trim();
  if (!ref) throw new Error('Hãy chọn file giọng mẫu trước.');
  return ref;
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function cueMp3Path(tmp, i) {
  return path.join(tmp, `cue-${String(i).padStart(4, '0')}.mp3`);
}

// File wav từng cue cho backend Chatterbox local (v5).
export function cueWavPath(tmp, i) {
  return path.join(tmp, `cue-${String(i).padStart(4, '0')}.wav`);
}

// Trả về index cue đầu tiên chưa có file audio (để resume), hoặc count nếu đã đủ.
// pathFn: cueMp3Path (mặc định, Edge TTS) hoặc cueWavPath (Chatterbox).
export async function findResumeStart(tmp, count, existsFn, pathFn = cueMp3Path) {
  for (let i = 0; i < count; i++) {
    let ok = false;
    try { ok = await existsFn(pathFn(tmp, i)); } catch { ok = false; }
    if (!ok) return i;
  }
  return count;
}

// spawnOnce: () => Promise<{code: number, stderr: string}> — 1 lần gọi helper TTS.
// verify (tuỳ chọn): chạy sau 1 lần spawn thoát 0. Trả true = đạt; trả false hoặc
// 1 chuỗi = coi lần thử đó là hỏng (chuỗi được dùng làm ghi chú lỗi). Dùng để bắt
// ca helper thoát 0 nhưng không sinh file audio / file rỗng.
// Chính sách retry (v6n): thử lại với MỌI lần thử hỏng — không chỉ 429/rate limit
// mà cả rớt kết nối, NoAudioReceived, 5xx... — tối đa maxAttempts lần, nghỉ theo
// thang RETRY_DELAYS_MS giữa các lần, hết lượt mới ném Error. err.rateLimited vẫn
// được gắn theo lỗi cuối cùng (caller chỉ dùng để chọn câu chữ thông báo).
// onProgress nhận {done, total} khi xong, hoặc {done, total, retrying, attempt, maxAttempts} khi sắp thử lại.
export async function synthesizeWithRetry({
  spawnOnce,
  cueIndex,
  total,
  maxAttempts = MAX_TTS_ATTEMPTS,
  delays = RETRY_DELAYS_MS,
  sleepFn = sleep,
  onProgress,
  verify,
  shouldCancel = () => false,
}) {
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (shouldCancel()) { const err = new Error('Đã dừng tạo voice theo yêu cầu.'); err.code = 'CANCELLED'; throw err; }
    const { code, stderr } = await spawnOnce();
    if (shouldCancel()) { const err = new Error('Đã dừng tạo voice theo yêu cầu.'); err.code = 'CANCELLED'; throw err; }
    if (code === 0) {
      let verifyNote = null;
      if (verify) {
        let v;
        try { v = await verify(); } catch (e) { v = String((e && e.message) || e); }
        if (v !== true) verifyNote = (typeof v === 'string' && v) ? v : 'TTS không trả file audio (rỗng)';
      }
      if (!verifyNote) {
        if (onProgress) onProgress({ done: cueIndex + 1, total });
        return { attempts: attempt };
      }
      lastError = verifyNote;
    } else {
      lastError = String(stderr || `helper thoát với mã ${code}`).trim();
    }
    if (attempt < maxAttempts) {
      if (onProgress) onProgress({ done: cueIndex, total, retrying: cueIndex, attempt: attempt + 1, maxAttempts });
      if (shouldCancel()) { const err = new Error('Đã dừng tạo voice theo yêu cầu.'); err.code = 'CANCELLED'; throw err; }
      await sleepFn(delays[attempt - 1] ?? delays[delays.length - 1]);
    }
  }
  const err = new Error(lastError || 'Tạo voice thất bại (không rõ nguyên nhân).');
  err.rateLimited = RATE_LIMIT_RE.test(lastError);
  throw err;
}
