// render.js — core dựng video MP4 bằng FFmpeg, tách từ app:export.
// Module thuần, KHÔNG import electron: dùng được cho cả main process và node --test.
// pages: [{states: ArrayBuffer[], panels: [{animatedImage, animatedWidth, animatedHeight,
//          centerX, centerY, startCenterX, seconds, fullFrame}]}]
// onProgress(percent 0..100) — optional.
// onCommand(args) — optional: nhận mảng args đầy đủ trước MỖI lần spawn ffmpeg
//   render (không gồm 2 lệnh dò NVENC) — debug + test hồi quy độ dài dòng lệnh.
// onSpawnEnd(args) — optional: gọi khi tiến trình ffmpeg của 1 lệnh render kết
//   thúc (đóng hoặc lỗi spawn) — cặp với onCommand để test tính song song.
// encoder: 'auto' | 'cpu' | 'gpu' (mặc định 'auto') — ưu tiên NVENC (GPU) nếu
//   dò thấy, tự lùi về libx264; kết quả thực dùng trả về ở { encoder }.
// workers: số luồng render trang song song trong 1 video (mặc định 2, kẹp 1..4).
//
// v6k: dựng TỪNG TRANG ra file MP4 tạm rồi ghép bằng concat demuxer. Bản cũ dựng
// cả chap trong MỘT lệnh ffmpeg: chế độ thẻ/full tốn ~3 input/panel nên chap lớn
// (vd 131 panel ≈ 390 input, đường dẫn %TEMP% dài) làm args vượt giới hạn
// CreateProcess 32767 ký tự của Windows -> spawn ENAMETOOLONG trước khi ffmpeg
// kịp chạy. Nay không lệnh nào mang quá 1 trang input.
//
// v6l: các trang độc lập nhau -> render SONG SONG bằng pool worker (mặc định 2)
// để rút ngắn thời gian dựng 1 video. Encoder vẫn chốt 1 lần cho cả lần render
// (cùng 1 bộ tham số cho mọi trang) nên bước ghép cuối vẫn copy stream được.
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { normalizeMangaTransition } from '../src/manga-transitions.js';
import { normalizeVoiceTiming, voiceTimingAudioFilter } from '../src/voice-timing.js';

export function sanitizeFileName(name) {
  const clean = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/\.+$/, '');
  return clean || 'video';
}

// Tham số encode video cho các file trang. Mọi trang trong 1 lần render dùng
// CHUNG 1 bộ tham số (cùng encoder) để bước ghép cuối copy stream được.
// - x264: như các bản trước (high -> superfast/crf 18, còn lại ultrafast/crf 21).
// - nvenc: preset p4 + VBR theo cq (high -> 19, còn lại 22). Preset p1-p7 cần
//   ffmpeg đóng kèm bản BtbN 8.1 (v6m thay bản 4.3 cũ — bản cũ không biết
//   preset p* và driver mới cũng từ chối preset legacy của nó).
export function videoEncodeArgs(encoderKind, quality) {
  if (encoderKind === 'nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', quality === 'high' ? '19' : '22', '-b:v', '0'];
  }
  return ['-c:v', 'libx264', '-preset', quality === 'high' ? 'superfast' : 'ultrafast', '-crf', quality === 'high' ? '18' : '21'];
}

export function webtoonStackCropFilter(advancePx, panelFrames, fps = 60) {
  const advance = Math.max(0, Number(advancePx) || 0);
  const frameCount = Math.max(1, Math.floor(Number(panelFrames) || 1));
  const rate = Math.max(1, Number(fps) || 60);
  const scrollSeconds = Math.max(1, frameCount - 1) / rate;
  const y = `${advance}*min(t/${scrollSeconds.toFixed(6)},1)`;
  // Crop native stack pixels directly; never scale the tall source to 1080px first.
  return `crop=1920:1080:0:'${y}':exact=1,setsar=1,format=yuv420p`;
}

// Chọn encoder thực dùng: 'cpu' -> luôn x264; 'auto'/'gpu' -> nvenc nếu dò thấy,
// không thì lùi về x264 (lặng lẽ, không báo lỗi).
export function pickEncoder(requested, nvencAvailable) {
  if (requested === 'cpu') return 'x264';
  return nvencAvailable ? 'nvenc' : 'x264';
}

// ===== Chuyển động DẢI DỌC (v6s: Manhwa) =====
// (v6s) Mọi đoạn đều là composite 1920x1080 (đoạn nguyên vẹn dạng thẻ trên
// nền mờ, dựng ở main.js) và chỉ có MỘT chuyển động: đẩy gần nhẹ (zoom)
// 1 -> zoomTo theo smoothstep. Bỏ hẳn lia dọc (pan): cửa sổ lia cắt ngang
// mặt nhân vật — các kênh recap mẫu (Hasbic Manhwa, Manhwa Fresh) luôn
// hiện nguyên panel, không cắt mất nét mặt.
// Toán ở đây là THUẦN (test được); biểu thức ffmpeg trong stripFilterFor áp
// đúng cùng công thức này bằng biến n của filter scale (eval=frame).
export function smoothstep01(t) {
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  return x * x * (3 - 2 * x);
}

// Zoom quanh tâm khung 1920x1080; hỗ trợ tiến gần hoặc lùi nhẹ giữa 2 scale.
export function stripZoomAt(t, zoomTo = 1.06, frameW = 1920, frameH = 1080, zoomFrom = 1) {
  const start = Math.max(1, Number(zoomFrom) || 1);
  const target = Math.max(1, Number(zoomTo) || 1);
  const z = start + (target - start) * smoothstep01(t);
  const w = frameW / z, h = frameH / z;
  return { z, x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
}

// Chuỗi zoom ĐỘNG dùng chung (v6w), tham số: k = zoomTo - 1, ease =
// biểu thức tiến độ 0->1 theo biến n (số frame). Các bước:
//   1) phóng composite lên 3840x2160 (supersample x2);
//   2) scale LẠI theo từng frame bằng eval=frame với hệ số z = 1 + k*ease
//      — nội dung được lấy mẫu lại PHÂN SỐ mỗi frame quanh góc trên-trái;
//   3) crop cửa sổ 3840x2160 với x/y cũng tính theo n: x = 1920*k*ease,
//      y = 1080*k*ease — đúng nửa phần kích thước tăng thêm, tức cửa sổ
//      trượt theo để zoom nở quanh TÂM khung;
//   4) hạ về 1920x1080 bằng lanczos;
//   5) tmix 3 frame trọng số 1-2-1: khử vệt giật còn sót.
// Vì sao bỏ zoompan: zoompan lượng tử hoá cửa sổ crop theo SỐ NGUYÊN —
// zoom chậm 1->1.06 khiến cửa sổ đứng yên nhiều frame rồi nhảy 1px, nét
// vẽ rung bậc thang. Supersample x2 (v6t) rồi x4 (v6v) chỉ giảm nhẹ:
// đo trên bản render THẬT của Hưng (23/10) viền thẻ vẫn giật lùi 6 lần
// trong 1 cảnh 3,8s, dwell tới 19 frame.
// Vì sao phải có bước 3 + 5: đo A/B cùng thẻ (theo vết viền thẻ 180
// frame) — scale động trần (crop x=0) cho quỹ đạo đơn điệu tuyệt đối
// (39 bước đều +1, rung sub-pixel 0,489px) nhưng zoom neo góc trên-trái,
// thẻ trôi chéo. Thêm crop x/y theo n thì căn giữa đúng (viền 645->626)
// nhưng độ lệch nguyên của x/y đánh nhau với lấy mẫu phân số: giật lùi
// 13 lần, RMS 0,649px. tmix 1-2-1 dập vệt đó: giật lùi 0, RMS 0,562px —
// mịn hơn cả zoompan x4 (0,616px) mà chuỗi chỉ x2 nên render nhẹ hơn
// hẳn. crop w/h KHÔNG nhận biểu thức theo n (đã đo: đứng yên) nên cửa
// sổ giữ cố định 3840x2160, chỉ x/y động. tmix giữ nguyên số frame.
export function animatedZoomChain(k, ease) {
  const kk = Number(k) || 0;
  const kx = (1920 * kk).toFixed(2);
  const ky = (1080 * kk).toFixed(2);
  const z = `1+${kk.toFixed(4)}*(${ease})`;
  return `scale=3840:2160:flags=lanczos,scale=w='3840*(${z})':h='2160*(${z})':eval=frame:flags=lanczos,crop=3840:2160:x='${kx}*(${ease})':y='${ky}*(${ease})',scale=1920:1080:flags=lanczos,tmix=frames=3:weights='1 2 1'`;
}

// Centered zoom between any two scales >= 1, including a subtle zoom-out.
export function animatedZoomBetweenChain(zoomFrom, zoomTo, ease) {
  const from = Math.max(1, Number(zoomFrom) || 1);
  const to = Math.max(1, Number(zoomTo) || 1);
  const z = `${from.toFixed(4)}+((${(to - from).toFixed(4)})*(${ease}))`;
  return `scale=3840:2160:flags=lanczos,scale=w='3840*(${z})':h='2160*(${z})':eval=frame:flags=lanczos,crop=3840:2160:x='1920*((${z})-1)':y='1080*((${z})-1)',scale=1920:1080:flags=lanczos,tmix=frames=3:weights='1 2 1'`;
}

// Chuỗi filter (phần sau trim/setpts) cho 1 panel dải dọc: đầu vào là
// composite 1920x1080, đẩy gần 1 -> zoomTo theo smoothstep của
// n/(frames-1), khớp stripZoomAt. Mọi giá trị motion cũ ('pan') cũng đi
// đường này — payload luôn được dựng lại bởi bản app hiện tại nên đầu vào
// luôn là composite.
export function stripFilterFor(panel, panelSeconds, panelFrames, fps = 60) {
  const zoomTo = Number(panel && panel.zoomTo) || 1.06;
  const denom = Math.max(1, (Number(panelFrames) || 1) - 1);
  const u = `min(n/${denom},1)`;
  const ez = `(${u})*(${u})*(3-2*(${u}))`;
  if (panel && panel.zoomFrom != null) return animatedZoomBetweenChain(panel.zoomFrom, zoomTo, ez);
  return animatedZoomChain(zoomTo - 1, ez);
}

// Số luồng render trang song song (v6l): mặc định 2, kẹp 1..4. workers=1 chạy
// tuần tự đúng như v6k.
export function clampWorkers(workers) {

  const n = Number(workers);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(4, Math.round(n)));
}

function spawnCapture(ffmpeg, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(ffmpeg, args, { windowsHide: true });
    } catch { resolve({ code: -1, out }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, out }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// Dò NVENC 1 lần/render: ffmpeg phải có h264_nvenc VÀ encode thử 1 frame phải
// thành công (bắt trường hợp có encoder nhưng máy không có GPU NVIDIA / driver
// quá cũ — khi đó encode thử thoát khác 0). Lệnh thử DỰNG TỪ videoEncodeArgs
// (chất lượng 'balanced') — đúng args của đường render thật, để probe và
// production không bao giờ lệch nhau (v6m; trước đây probe hardcode 1 bản sao).
export async function detectNvenc(ffmpeg) {
  const list = await spawnCapture(ffmpeg, ['-hide_banner', '-encoders']);
  if (list.code !== 0 || !/h264_nvenc/.test(list.out)) return false;
  const probe = await spawnCapture(ffmpeg, [
    '-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1',
    '-frames:v', '1', ...videoEncodeArgs('nvenc', 'balanced'),
    '-pix_fmt', 'yuv420p', '-f', 'null', '-',
  ]);
  return probe.code === 0;
}

// Chạy 1 lệnh ffmpeg có -progress pipe:1; onSeconds(giây đã xử lý trong lệnh này).
// onSpawnEnd(args): gọi đúng 1 lần khi tiến trình kết thúc (kể cả lỗi spawn).
// timeoutMs: watchdog chống treo (vd: ảnh hỏng + -loop 1) — hết giờ thì kill.
export function spawnFfmpeg(ffmpeg, args, { onCommand, onSeconds, onSpawnEnd, timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { const err = new Error('Đã dừng render theo yêu cầu.'); err.code = 'CANCELLED'; reject(err); return; }
    if (onCommand) { try { onCommand(args); } catch {} }
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (onSpawnEnd) { try { onSpawnEnd(args); } catch {} }
    };
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let cancelled = false;
    // Watchdog chống treo: ảnh hỏng không decode được + -loop 1 làm ffmpeg quay
    // vòng 100% CPU vô hạn (lỗi đã biết từ trước v6l). Hết timeoutMs thì kill và
    // báo lỗi để render dừng theo đúng quy tắc "1 trang lỗi -> hủy cả render".
    let watchdog = null;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      watchdog = setTimeout(() => {
        if (ended) return;
        try { child.kill('SIGKILL'); } catch {}
        end();
        reject(new Error('FFmpeg treo quá lâu không xong (có thể ảnh đầu vào bị hỏng, không decode được). Đã tự dừng để khỏi treo máy — kiểm tra lại ảnh của trang này rồi chạy lại.'));
      }, timeoutMs);
      if (watchdog.unref) watchdog.unref();
    }
    const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
    const onAbort = () => { cancelled = true; clearWatchdog(); try { child.kill('SIGKILL'); } catch {} };
    signal?.addEventListener('abort', onAbort, { once: true });
    let stderr = '';
    let stdoutBuffer = '';
    child.stdout.on('data', data => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match && onSeconds) {
          try { onSeconds(Number(match[1]) / 1_000_000); } catch {}
        }
      }
    });
    // Chỉ giữ đuôi log (phần dùng khi báo lỗi) — tránh tràn bộ nhớ khi ffmpeg log dài.
    child.stderr.on('data', data => { stderr += data.toString(); if (stderr.length > 262144) stderr = stderr.slice(-131072); });
    child.on('error', error => { clearWatchdog(); signal?.removeEventListener('abort', onAbort); end(); reject(cancelled ? Object.assign(new Error('Đã dừng render theo yêu cầu.'), { code: 'CANCELLED' }) : new Error(`Không thể chạy FFmpeg. ${error.message}`)); });
    child.on('close', code => {
      clearWatchdog();
      signal?.removeEventListener('abort', onAbort);
      end();
      if (cancelled || signal?.aborted) reject(Object.assign(new Error('Đã dừng render theo yêu cầu.'), { code: 'CANCELLED' }));
      else if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1800) || `FFmpeg thoát với mã ${code}`));
    });
  });
}

export async function renderChapter({
  ffmpeg, pages, quality = 'balanced', fps = 60, seconds = 4,
  audioPath = null, outputPath, onProgress, onCommand, onSpawnEnd, encoder = 'auto', workers = 2, signal,
  comicStyle = 'manga', mangaTransitionIn = 'none', mangaTransitionOut = 'slide-right',
  voiceTimingAnchor = 'start', voiceTimingOffsetSeconds = 0, audioDurationSeconds = 0,
}) {
  if (!ffmpeg) throw new Error('Thiếu đường dẫn FFmpeg.');
  if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => !Array.isArray(page.panels) || page.panels.length === 0 || !Array.isArray(page.states) || page.states.length !== page.panels.length + 1)) {
    throw new Error('Dữ liệu trang/panel không hợp lệ. Hãy nhập lại ảnh rồi thử xuất.');
  }
  if (!outputPath) throw new Error('Chưa có đường dẫn file xuất.');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelvid-'));
  let finalOutputStarted = false, renderCompleted = false;
  const throwIfCancelled = () => { if (signal?.aborted) { const err = new Error('Đã dừng render theo yêu cầu.'); err.code = 'CANCELLED'; throw err; } };
  const defaultSeconds = Math.min(8, Math.max(2.5, Number(seconds) || 4));
  fps = [30, 45, 60].includes(Number(fps)) ? Number(fps) : 60;
  mangaTransitionIn=normalizeMangaTransition(mangaTransitionIn,'none');
  mangaTransitionOut=normalizeMangaTransition(mangaTransitionOut,'slide-right');
  const voiceTiming=normalizeVoiceTiming(voiceTimingAnchor,voiceTimingOffsetSeconds);
  const visualLeadInSeconds=audioPath&&voiceTiming.anchor==='start'&&voiceTiming.offsetSeconds<0?-voiceTiming.offsetSeconds:0;
  const report = (pct) => { try { onProgress && onProgress(Math.max(0, Math.min(100, Math.round(pct)))); } catch {} };
  // Chọn encoder 1 lần cho cả lần render (dò NVENC 1 lần, cache trong biến này);
  // không đổi giữa các trang vì các file trang phải đồng nhất để ghép copy.
  const encoderKind = pickEncoder(encoder, encoder === 'cpu' ? false : await detectNvenc(ffmpeg));
  const encArgs = videoEncodeArgs(encoderKind, quality);
  // Pool render trang (v6l): encoder đã chốt ở trên dùng chung cho mọi worker.
  // Khi encode bằng x264 và chạy song song, mỗi ffmpeg x264 mặc định chiếm hết
  // luồng CPU (máy 12 luồng) -> 2-3 tiến trình tranh nhau còn chậm hơn; giới
  // hạn 6 luồng encode/tiến trình khi song song. NVENC encode ở GPU nên giữ
  // nguyên (không thêm -threads). Filter graph giữ mặc định của ffmpeg.
  const workerCount = clampWorkers(workers);
  const pageEncArgs = [...encArgs];
  if (encoderKind === 'x264' && workerCount > 1) {
    const cpuCount = Math.max(2, Number(os.cpus()?.length) || 2);
    const threadsPerWorker = Math.max(2, Math.floor(cpuCount / workerCount));
    pageEncArgs.push('-threads', String(threadsPerWorker));
  }
  // Tính trước số frame/thời lượng từng trang: vừa để dựng filter, vừa chia tiến
  // độ tổng theo trọng số giây của từng trang.
  const pagePlans = pages.map((page,index) => {
    const panelFrameCounts = page.panels.map(panel => Math.max(1, Math.round(Math.min(3600, Math.max(panel.exactVoiceDuration ? 1 / fps : 0.5, Number(panel.seconds) || defaultSeconds)) * fps)));
    const pageFrames = panelFrameCounts.reduce((sum, value) => sum + value, 0) + (index===0?Math.round(visualLeadInSeconds*fps):0);
    return { page, panelFrameCounts, pageSeconds: pageFrames / fps, visualLeadInSeconds:index===0?visualLeadInSeconds:0 };
  });
  const totalSeconds = pagePlans.reduce((sum, plan) => sum + plan.pageSeconds, 0);
  try {
    if (audioPath) {
      try { await fs.access(audioPath); } catch { throw new Error('Không tìm thấy file voice. Hãy tạo lại voice từ SRT.'); }
    }
    const pageFiles = new Array(pagePlans.length).fill(null);
    // Tiến độ gộp (v6l): mỗi trang đóng góp số giây đã xử lý (partial khi đang
    // chạy, đầy pageSeconds khi xong). Các worker chỉ ghi vào ô của trang mình
    // và tổng hợp qua reportProgress duy nhất -> tổng luôn đơn điệu 0..97%;
      // 3% cuối dành cho bước ghép các trang và mux audio.
    const pageDoneSeconds = new Array(pagePlans.length).fill(0);
    const reportProgress = () => {
      const sec = pageDoneSeconds.reduce((sum, v) => sum + v, 0);
      report(totalSeconds > 0 ? (sec / totalSeconds) * 97 : 0);
    };
    // Dựng 1 trang ra file MP4 tạm, trả về đường dẫn file. Mọi file tạm mang
    // tên theo pageIndex nên các worker chạy song song không đụng nhau.
    const renderPage = async (pageIndex) => {
      throwIfCancelled();
      const { page, panelFrameCounts, pageSeconds, visualLeadInSeconds:pageLeadIn } = pagePlans[pageIndex];
      const filterParts = [];
      const args = ['-hide_banner', '-y'];
      let inputIndex = 0;
      const addStillInput = (filePath, duration) => {
        args.push('-loop', '1', '-framerate', String(fps), '-t', String(duration), '-i', filePath);
        return inputIndex++;
      };

      const statePaths = [];
      for (let stateIndex = 0; stateIndex < page.states.length; stateIndex++) {
        const statePath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-state-${String(stateIndex).padStart(3, '0')}.jpg`);
        await fs.writeFile(statePath, Buffer.from(page.states[stateIndex]));
        statePaths.push(statePath);
      }

      const segmentLabels = [];
      for (let panelIndex = 0; panelIndex < page.panels.length; panelIndex++) {
        const panel = page.panels[panelIndex];
        const panelFrames = panelFrameCounts[panelIndex];
        const panelSeconds = panelFrames / fps;
        const isFullCover = panel.displayMode === 'full' && panel.fullImage;
        const canAnimate = !isFullCover && !panel.fullFrame && panel.animatedImage && panel.animatedWidth && panel.animatedHeight;

        if (isFullCover) {
          // Full màn hình: panel lấp kín 16:9 + camera lia nhẹ (pan dọc/ngang hoặc zoom nhẹ).
          const fullPath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-panel-${String(panelIndex).padStart(3, '0')}-full.png`);
          await fs.writeFile(fullPath, Buffer.from(panel.fullImage));
          args.push('-loop', '1', '-framerate', String(fps), '-t', String(panelSeconds), '-i', fullPath);
          const fullInput = inputIndex++;
          const aspect = Number(panel.cropAspect) || 1;
          const T = panelSeconds.toFixed(3);
          let vf;
          if (aspect < 1.70) {
            // Panel dọc: lấp kín chiều ngang, lia camera từ trên xuống dưới.
            vf = `scale=1920:-2,crop=1920:1080:0:y='(ih-1080)*t/${T}'`;
          } else if (aspect > 1.85) {
            // Panel ngang: lấp kín chiều dọc, lia camera từ trái sang phải.
            vf = `scale=-2:1080,crop=1920:1080:x='(iw-1920)*t/${T}':y=0`;
          } else {
            // Panel gần 16:9: zoom nhẹ tuyến tính 1.0 -> 1.06 bằng cùng
            // chuỗi scale động theo frame như dải dọc (v6w).
            const easeLin = `min(n/${Math.max(1, panelFrames - 1)},1)`;
            const fitScale = aspect < 16 / 9 ? 'scale=1920:-2' : 'scale=-2:1080';
            vf = `${fitScale},crop=1920:1080,${animatedZoomChain(0.06, easeLin)}`;
          }
          const seg = `[pg${pageIndex}_full${panelIndex}]`;
          filterParts.push(`[${fullInput}:v]trim=duration=${panelSeconds},setpts=PTS-STARTPTS,${vf},setsar=1,format=yuv420p${seg}`);
          segmentLabels.push(seg);
          continue;
        }

        const isWebtoonStack = panel.displayMode === 'webtoon-stack' && panel.stackImage;
        if (isWebtoonStack) {
          const stackPath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-panel-${String(panelIndex).padStart(3, '0')}-stack.jpg`);
          await fs.writeFile(stackPath, Buffer.from(panel.stackImage));
          args.push('-loop', '1', '-framerate', String(fps), '-t', String(panelSeconds), '-i', stackPath);
          const stackInput = inputIndex++;
          const seg = `[pg${pageIndex}_stack${panelIndex}]`;
          const scrollFilter = webtoonStackCropFilter(panel.stackAdvancePx, panelFrames, fps);
          filterParts.push(`[${stackInput}:v]trim=duration=${panelSeconds},setpts=PTS-STARTPTS,${scrollFilter}${seg}`);
          segmentLabels.push(seg);
          continue;
        }
        const isStrip = panel.displayMode === 'strip' && panel.stripImage;
        if (isStrip) {
          // Dải dọc (v6s: Manhwa): đầu vào luôn là composite
          // 1920x1080 — đoạn nguyên vẹn dạng thẻ trên nền mờ — và chỉ đẩy
          // gần nhẹ bằng scale động theo frame (v6w, xem stripFilterFor).
          // Chỉ dùng filter lâu đời: scale / crop / trim / setpts / setsar.
          const stripPath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-panel-${String(panelIndex).padStart(3, '0')}-strip.jpg`);
          await fs.writeFile(stripPath, Buffer.from(panel.stripImage));
          args.push('-loop', '1', '-framerate', String(fps), '-t', String(panelSeconds), '-i', stripPath);
          const stripInput = inputIndex++;
          const seg = `[pg${pageIndex}_strip${panelIndex}]`;
          filterParts.push(`[${stripInput}:v]trim=duration=${panelSeconds},setpts=PTS-STARTPTS,${stripFilterFor(panel, panelSeconds, panelFrames, fps)},setsar=1,format=yuv420p${seg}`);
          segmentLabels.push(seg);
          continue;
        }

        const isMosaic = panel.displayMode === 'mosaic' && panel.mosaicImage;
        if (isMosaic) {
          // Lấp khung (v6j, kiểu Genz): nền = ảnh "thế giới" trang 3840×2160 phủ kín
          // khung. zoompan (zoom cố định 1.5 -> cửa sổ 2560×1440) lia tâm cửa sổ từ
          // panel trước tới panel này bằng easing smoothstep trong khoảng enter;
          // pop (thẻ panel nền trong suốt) fade-in cùng nhịp và bám đúng vị trí của
          // panel trên trang theo cửa sổ đang lia. Chỉ dùng filter lâu đời:
          // zoompan / overlay / fade / trim / setpts / setsar / format.
          const mosaicPath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-panel-${String(panelIndex).padStart(3, '0')}-mosaic.jpg`);
          await fs.writeFile(mosaicPath, Buffer.from(panel.mosaicImage));
          args.push('-loop', '1', '-framerate', String(fps), '-t', String(panelSeconds), '-i', mosaicPath);
          const bgInput = inputIndex++;
          const enterFrames = Math.max(1, Math.min(panelFrames - 1, Math.round(Math.min(0.75, panelSeconds * 0.25) * fps)));
          const enterSeconds = enterFrames / fps;
          const f2 = (n) => Number(n || 0).toFixed(2);
          const fx = f2(panel.camFromX), fy = f2(panel.camFromY), tx = f2(panel.camToX), ty = f2(panel.camToY);
          const pcx = f2(panel.popCenterX), pcy = f2(panel.popCenterY);
          const uOn = `min(on/${enterFrames},1)`;
          const ezOn = `(${uOn})*(${uOn})*(3-2*(${uOn}))`;
          const winCxOn = `(${fx})+((${tx})-(${fx}))*(${ezOn})`;
          const winCyOn = `(${fy})+((${ty})-(${fy}))*(${ezOn})`;
          const uT = `min(max(t/${enterSeconds.toFixed(3)},0),1)`;
          const ezT = `(${uT})*(${uT})*(3-2*(${uT}))`;
          const winCxT = `(${fx})+((${tx})-(${fx}))*(${ezT})`;
          const winCyT = `(${fy})+((${ty})-(${fy}))*(${ezT})`;
          const bg = `[pg${pageIndex}_mosaicbg${panelIndex}]`;
          filterParts.push(`[${bgInput}:v]trim=duration=${panelSeconds},setpts=PTS-STARTPTS,zoompan=z='1.5':x='(${winCxOn})-(iw/zoom/2)':y='(${winCyOn})-(ih/zoom/2)':d=1:s=1920x1080:fps=${fps},setsar=1,format=rgba${bg}`);
          const seg = `[pg${pageIndex}_mosaic${panelIndex}]`;
          if (panel.popImage) {
            const popPath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-panel-${String(panelIndex).padStart(3, '0')}-pop.png`);
            await fs.writeFile(popPath, Buffer.from(panel.popImage));
            args.push('-loop', '1', '-framerate', String(fps), '-t', String(panelSeconds), '-i', popPath);
            const popInput = inputIndex++;
            const pop = `[pg${pageIndex}_mosaicpop${panelIndex}]`;
            filterParts.push(`[${popInput}:v]trim=duration=${panelSeconds},setpts=PTS-STARTPTS,format=rgba,fade=t=in:st=0:d=${enterSeconds.toFixed(3)}:alpha=1${pop}`);
            filterParts.push(`${bg}${pop}overlay=x='((${pcx})-((${winCxT})-1280))*0.75-overlay_w/2':y='((${pcy})-((${winCyT})-720))*0.75-overlay_h/2':eof_action=pass,trim=duration=${panelSeconds},setsar=1,format=yuv420p${seg}`);
          } else {
            filterParts.push(`${bg}trim=duration=${panelSeconds},setsar=1,format=yuv420p${seg}`);
          }
          segmentLabels.push(seg);
          continue;
        }

        const enterFrames = canAnimate
          ? Math.min(panelFrames - 1, Math.max(1, Math.round(Math.min(0.75, panelSeconds * 0.25) * fps)))
          : 0;
        const holdFrames = panelFrames - enterFrames;
        const enterSeconds = enterFrames / fps;
        const holdSeconds = holdFrames / fps;
        const centerX = Number(panel.centerX);
        const startCenterX = Number(panel.startCenterX);
        const centerY = Number(panel.centerY);

        if (canAnimate) {
          const animatedPath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-panel-${String(panelIndex).padStart(3, '0')}-animated.png`);
          await fs.writeFile(animatedPath, Buffer.from(panel.animatedImage));
          const baseInput = addStillInput(statePaths[panelIndex], enterSeconds);
          args.push('-loop', '1', '-framerate', String(fps), '-t', String(enterSeconds), '-i', animatedPath);
          const animatedInput = inputIndex++;
          const decayFrames = Math.max(1, enterFrames / 6);
          const zm = Number(panel.zoomMax) || 1.24;
          const zoomExpression = `1+${(zm - 1).toFixed(3)}*exp(-on/${decayFrames})`;
          const base = `[pg${pageIndex}_entrybase${panelIndex}]`;
          const animated = `[pg${pageIndex}_animated${panelIndex}]`;
          filterParts.push(`[${baseInput}:v]trim=duration=${enterSeconds},setpts=PTS-STARTPTS,setsar=1,format=yuv420p${base}`);
          filterParts.push(`[${animatedInput}:v]zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${panel.animatedWidth}x${panel.animatedHeight}:fps=${fps},format=rgba,setpts=PTS-STARTPTS${animated}`);
          const progress = `min(max(t/${enterSeconds},0),1)`;
          const eased = `${progress}*${progress}*(3-2*${progress})`;
          const xExpression = `${startCenterX}+(${centerX}-${startCenterX})*(${eased})-overlay_w/2`;
          const entry = `[pg${pageIndex}_entry${panelIndex}]`;
          filterParts.push(`${base}${animated}overlay=x='${xExpression}':y='${centerY}-overlay_h/2':eof_action=pass:shortest=1${entry}`);
          segmentLabels.push(entry);
        }

        const holdInput = addStillInput(statePaths[panelIndex + 1], holdSeconds);
        const hold = `[pg${pageIndex}_hold${panelIndex}]`;
        filterParts.push(`[${holdInput}:v]trim=duration=${holdSeconds},setpts=PTS-STARTPTS,setsar=1,format=yuv420p${hold}`);
        segmentLabels.push(hold);
      }

      // Normalize every visual segment before concat. Some zoompan/overlay
      // combinations inherit the tall source canvas (e.g. 1920x9191) rather
      // than the 16:9 viewport, which makes concat fail on mismatched sizes.
      const normalizedLabels = segmentLabels.map((label, index) => {
        const normalized = `[pg${pageIndex}_norm${index}]`;
        filterParts.push(`${label}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101014,setsar=1,format=yuv420p${normalized}`);
        return normalized;
      });
      let pageVideo = normalizedLabels[0];
      if (normalizedLabels.length > 1) {
        pageVideo = `[pg${pageIndex}_joined]`;
        filterParts.push(`${normalizedLabels.join('')}concat=n=${normalizedLabels.length}:v=1:a=0${pageVideo}`);
      }
      if(pageLeadIn>0){
        const heldPage=`[pg${pageIndex}_visualLead]`;
        filterParts.push(`${pageVideo}tpad=start_duration=${pageLeadIn.toFixed(3)}:start_mode=clone,setpts=PTS-STARTPTS${heldPage}`);
        pageVideo=heldPage;
      }
      const pageLabel = `[page${pageIndex}]`;
      const webtoonPage=page.panels.some(panel=>panel.displayMode==='webtoon-stack');
      if(webtoonPage){
        filterParts.push(`${pageVideo}setsar=1,format=yuv420p${pageLabel}`);
      }else{
        // Manga page-in and page-out effects are independently selected. Slide
        // transitions reveal a dark underlay; flash-white uses a white underlay.
        // The encoded page duration is unchanged, including the transition.
        const transitionSeconds=Math.min(0.45,Math.max(1/fps,pageSeconds));
        let current=pageVideo,sequence=0;
        const addFade=(direction,start,label)=>{
          filterParts.push(`${current}fade=t=${direction}:st=${start.toFixed(3)}:d=${transitionSeconds.toFixed(3)},setsar=1,format=yuv420p${label}`);
          current=label;
        };
        const addSlide=(effect,isIn,label)=>{
          const base=`[pg${pageIndex}_transitionbg${sequence++}]`;
          filterParts.push(`color=c=0x111117:s=1920x1080:r=${fps}:d=${pageSeconds},format=yuv420p${base}`);
          const offset=isIn?0:Math.max(0,pageSeconds-transitionSeconds);
          const progress=`min(max((t-${offset.toFixed(3)})/${transitionSeconds.toFixed(3)}\\,0)\\,1)`;
          let x='0',y='0';
          if(effect==='slide-left')x=isIn?`W*(1-${progress})`:`-W*${progress}`;
          if(effect==='slide-right')x=isIn?`-W*(1-${progress})`:`W*${progress}`;
          if(effect==='slide-up')y=isIn?`H*(1-${progress})`:`-H*${progress}`;
          if(effect==='slide-down')y=isIn?`-H*(1-${progress})`:`H*${progress}`;
          filterParts.push(`${base}${current}overlay=x='${x}':y='${y}':eof_action=pass:shortest=1,setsar=1,format=yuv420p${label}`);
          current=label;
        };
        const addZoom=(effect,isIn,label)=>{
          const startFrame=isIn?0:Math.max(0,Math.round((pageSeconds-transitionSeconds)*fps));
          const transitionFrames=Math.max(1,Math.round(transitionSeconds*fps));
          const progress=`min(max((on-${startFrame})/${transitionFrames},0),1)`;
          const zoom=effect==='zoom-in'
            ?(isIn?`1.12-0.12*${progress}`:`1+0.12*${progress}`)
            :(isIn?`1+0.12*${progress}`:`1.12-0.12*${progress}`);
          filterParts.push(`${current}zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${fps},trim=duration=${pageSeconds},setpts=PTS-STARTPTS,setsar=1,format=yuv420p${label}`);
          current=label;
        };
        const addFlash=(isIn,label)=>{
          const white=`[pg${pageIndex}_white${sequence++}]`,alpha=`[pg${pageIndex}_flashalpha${sequence++}]`;
          const start=isIn?0:Math.max(0,pageSeconds-transitionSeconds);
          filterParts.push(`color=c=white:s=1920x1080:r=${fps}:d=${pageSeconds},format=yuv420p${white}`);
          filterParts.push(`${current}format=yuva420p,fade=t=${isIn?'in':'out'}:st=${start.toFixed(3)}:d=${transitionSeconds.toFixed(3)}:alpha=1${alpha}`);
          filterParts.push(`${white}${alpha}overlay=x=0:y=0:eof_action=pass:shortest=1,setsar=1,format=yuv420p${label}`);
          current=label;
        };
        const addEffect=(effect,isIn,label)=>{
          if(effect==='fade')addFade(isIn?'in':'out',isIn?0:Math.max(0,pageSeconds-transitionSeconds),label);
          else if(effect==='flash-white')addFlash(isIn,label);
          else if(effect==='zoom-in'||effect==='zoom-out')addZoom(effect,isIn,label);
          else addSlide(effect,isIn,label);
        };
        if((comicStyle==='manga'||comicStyle==='hybrid')&&mangaTransitionIn!=='none'&&pageLeadIn<=0){
          const label=`[pg${pageIndex}_transition${sequence++}]`;
          addEffect(mangaTransitionIn,true,label);
        }
        if((comicStyle==='manga'||comicStyle==='hybrid')&&mangaTransitionOut!=='none'){
          const label=`[pg${pageIndex}_transition${sequence++}]`;
          addEffect(mangaTransitionOut,false,label);
        }
        filterParts.push(`${current}setsar=1,format=yuv420p${pageLabel}`);
      }

      // Encode riêng trang này: video-only, cùng tham số encode cho mọi trang để
      // bước ghép cuối copy được stream.
      const pageFile = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}.mp4`);
      const filterPath = path.join(tempDir, `page-${String(pageIndex).padStart(3, '0')}-filter.txt`);
      await fs.writeFile(filterPath, filterParts.join(';'));
      args.push('-filter_complex_script', filterPath, '-map', pageLabel, '-an',
        '-r', String(fps), ...pageEncArgs,
        '-pix_fmt', 'yuv420p', '-progress', 'pipe:1', '-nostats', pageFile);
      await spawnFfmpeg(ffmpeg, args, {
        onCommand, onSpawnEnd, signal,
        onSeconds: (s) => { pageDoneSeconds[pageIndex] = Math.min(s, pageSeconds); reportProgress(); },
        // Encode trang N giây hiếm khi quá 10× realtime; quá là treo -> kill.
        timeoutMs: Math.max(300000, pageSeconds * 10 * 1000),
      });
      pageDoneSeconds[pageIndex] = pageSeconds;
      reportProgress();
      return pageFile;
    };

    // Pool worker (v6l): workerCount luồng cùng kéo index trang theo thứ tự.
    // 1 trang lỗi -> dừng kéo trang mới; trang đang chạy dở được chạy nốt rồi
    // mới ném lỗi ra ngoài (bước ghép chỉ chạy khi MỌI trang xong nên không
    // bao giờ để lại file output nửa vời).
    let nextPageIndex = 0;
    let pageFailure = null;
    const workerLoop = async () => {
      while (!pageFailure) {
        if (signal?.aborted) { if (!pageFailure) { const err = new Error('Đã dừng render theo yêu cầu.'); err.code = 'CANCELLED'; pageFailure = err; } return; }
        const pageIndex = nextPageIndex++;
        if (pageIndex >= pagePlans.length) return;
        try {
          pageFiles[pageIndex] = await renderPage(pageIndex);
        } catch (err) {
          if (!pageFailure) pageFailure = err;
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(workerCount, pagePlans.length) }, () => workerLoop()));
    if (pageFailure) throw pageFailure;

    // Ghép các trang + audio: concat demuxer + video COPY (mọi file trang đều do
    // ta encode với cùng preset/crf/pix_fmt/fps/độ phân giải và bắt đầu bằng
    // keyframe nên copy an toàn, khỏi encode lại cả chap lần hai); audio AAC 160k
    // như bản cũ. Không faststart: tránh lượt di chuyển moov atom toàn file ở 99%.
    report(97);
    throwIfCancelled();
    const listPath = path.join(tempDir, 'concat-list.txt');
    const listLine = (p) => `file '${String(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
    await fs.writeFile(listPath, pageFiles.map(listLine).join('\n') + '\n');
    const finalArgs = ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath];
    if (audioPath) finalArgs.push('-i', audioPath);
    finalArgs.push('-map', '0:v', '-c:v', 'copy');
    if (audioPath) {
      finalArgs.push('-map', '1:a');
      const audioFilter=voiceTimingAudioFilter({anchor:voiceTiming.anchor,offsetSeconds:voiceTiming.offsetSeconds,audioDurationSeconds,videoDurationSeconds:totalSeconds});
      if(audioFilter)finalArgs.push('-af',audioFilter);
      finalArgs.push('-c:a', 'aac', '-b:a', '160k');
    }
    else finalArgs.push('-an');
    finalArgs.push('-progress', 'pipe:1', '-nostats', outputPath);
    finalOutputStarted = true;
    await spawnFfmpeg(ffmpeg, finalArgs, {
      onCommand, onSpawnEnd, signal,
      // Ghép copy stream rất nhanh; quá 3× tổng thời lượng là treo -> kill.
      timeoutMs: Math.max(300000, totalSeconds * 3 * 1000),
    });
    report(100);
    renderCompleted = true;
    return { outputPath, encoder: encoderKind };
  } finally {
    if (finalOutputStarted && !renderCompleted) await fs.rm(outputPath, { force: true }).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
