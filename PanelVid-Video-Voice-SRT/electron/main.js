import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { fileURLToPath } from 'node:url';
import {
  synthesizeWithRetry, findResumeStart, cueMp3Path, cueWavPath,
  MAX_TTS_ATTEMPTS,
  CHATTERBOX_VOICE_ID, VIENEU_VOICE_ID, selectTtsBackend, validateChatterboxArgs,
} from './tts-retry.js';
import { renderChapter, sanitizeFileName } from './render.js';
import { probeFile, concatVideos } from './concat.js';
import { listLibEntries, addLibEntry, removeLibEntry } from './voicelib-store.js';
import { createJob as createRenderJob, saveJobImage, readJobImage, listJobs as listRenderJobs, updateJob as updateRenderJob, removeJob as removeRenderJob, loadJob as loadRenderJob } from './jobs-store.js';
import { sortLibEntries } from '../src/voicelib.js';
import { buildAssDocument } from '../src/subtitles.js';
import { decapsForTts } from '../src/voice.js';
import { parseLoudnormMeasurement, cueLoudnormFilter } from '../src/audio-normalization.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let activeVoiceRun = null;
const activeRenderControllers = new Set();
const activeRenderVoiceDirs = new Set();

function cancelledError(kind = 'voice') {
  const err = new Error(kind === 'render' ? 'Đã dừng render theo yêu cầu.' : 'Đã dừng tạo voice theo yêu cầu.');
  err.code = 'CANCELLED';
  return err;
}
function trackVoiceChild(child) {
  const run = activeVoiceRun;
  if (!run) return null;
  run.children.add(child);
  child.once('close', () => run.children.delete(child));
  if (run.cancelled) { try { child.kill('SIGKILL'); } catch {} }
  return run;
}
async function withVoiceRun(work) {
  if (activeVoiceRun) throw new Error('Đang có một tác vụ voice khác chạy.');
  const run = { children: new Set(), cancelled: false };
  activeVoiceRun = run;
  try {
    const result = await work(run);
    if (run.cancelled) throw cancelledError();
    return result;
  } catch (err) {
    if (run.cancelled) {
      if (run.tmp && Array.isArray(run.cues)) {
        const existsFn = async (file) => { try { await fs.access(file); return true; } catch { return false; } };
        const pathFn = selectTtsBackend(run.voiceId) === 'edge' ? cueMp3Path : cueWavPath;
        const failedAt = await findResumeStart(run.tmp, run.cues.length, existsFn, pathFn);
        lastVoiceFail = { failedAt, tmpDir: run.tmp, cueCount: run.cues.length, voiceId: run.voiceId };
      }
      throw cancelledError();
    }
    throw err;
  }
  finally { if (activeVoiceRun === run) activeVoiceRun = null; }
}
function terminateChildTree(child) {
  if (process.platform === 'win32' && child && child.pid) {
    try { const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.unref(); } catch {}
  }
  try { child?.kill('SIGKILL'); } catch {}
}

function createWindow() {
  const cloneOnly = process.env.PANELVID_VOICE_CLONE_ONLY === '1';
  mainWindow = new BrowserWindow({
    width: cloneOnly ? 1120 : 1460,
    height: cloneOnly ? 880 : 940,
    minWidth: cloneOnly ? 850 : 1050,
    minHeight: cloneOnly ? 680 : 720,
    backgroundColor: '#111117',
    title: cloneOnly ? 'PanelVid Voice Clone' : 'PanelVid Offline',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    const base = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '');
    mainWindow.loadURL(cloneOnly ? `${base}/voice-clone.html` : base);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', cloneOnly ? 'voice-clone.html' : 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function ffmpegPath() {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'ffmpeg.exe')
      : path.join(app.getAppPath(), 'resources', 'ffmpeg.exe');
  }
  if (process.env.PANELVID_FFMPEG) return process.env.PANELVID_FFMPEG;
  return 'ffmpeg';
}

// ===== PHỤ ĐỀ GHI LÊN VIDEO (v6i) =====
// Kiểm tra 1 lần xem ffmpeg đi kèm có filter 'subtitles' (libass) không; cache kết quả.
let subFilterSupport = null;
async function ffmpegHasSubtitlesFilter() {
  if (subFilterSupport !== null) return subFilterSupport;
  try {
    const { stdout } = await execFileAsync(ffmpegPath(), ['-hide_banner', '-filters'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    subFilterSupport = /(^|\n)\s*\S*\s+subtitles\s/.test(stdout);
  } catch { subFilterSupport = false; }
  return subFilterSupport;
}

// Ghi phụ đề (ASS) đè lên file MP4 đã render: render ra file tạm rồi chép đè
// file đích. Trả { ok:true } hoặc { ok:false, error } — lỗi KHÔNG làm mất MP4 gốc.
async function burnSubtitlesIntoVideo(videoPath, subtitles, quality, { signal } = {}) {
  const items = (subtitles && Array.isArray(subtitles.items)) ? subtitles.items : [];
  if (!items.length) return { ok: false, error: 'Không có dòng phụ đề nào để ghi.' };
  if (!(await ffmpegHasSubtitlesFilter())) {
    return { ok: false, error: 'Bản ffmpeg đi kèm không hỗ trợ ghi phụ đề lên video.' };
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'panelvid-sub-'));
  try {
    const assPath = path.join(tmp, 'subs.ass');
    await fs.writeFile(assPath, buildAssDocument(items, (subtitles && subtitles.style) || {}), 'utf8');
    // Duong dan trong filter subtitles: doi \ thanh /, thoat ':' va dau nhay don.
    const assArg = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const outPath = path.join(tmp, 'burned.mp4');
    await runFfmpegQuiet([
      '-hide_banner', '-y', '-i', videoPath,
      '-vf', `subtitles=filename='${assArg}'`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', quality === 'high' ? '18' : '21',
      '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', outPath,
    ], { signal });
    await fs.copyFile(outPath, videoPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Không ghi được phụ đề lên video. ${String((e && e.message) || e).slice(-300)}` };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

ipcMain.handle('app:cancel-render', async () => {
  for (const controller of activeRenderControllers) controller.abort();
  return { cancelled: activeRenderControllers.size > 0 };
});
ipcMain.handle('app:cancel-voice', async () => {
  const run = activeVoiceRun;
  if (!run) return { cancelled: false };
  run.cancelled = true;
  for (const child of run.children) terminateChildTree(child);
  return { cancelled: true };
});

ipcMain.handle('app:export', async (event, { pages, quality = 'balanced', fps = 60, seconds = 4, audioPath = null, subtitles = null, encoder = 'auto', workers = 2, comicStyle = 'manga', mangaTransitionIn = 'none', mangaTransitionOut = 'slide-right', voiceTimingAnchor = 'start', voiceTimingOffsetSeconds = 0, audioDurationSeconds = 0 }) => {
  const choice = await dialog.showSaveDialog(mainWindow, {
    title: 'Lưu video truyện',
    defaultPath: path.join(app.getPath('videos'), 'PanelVid-video.mp4'),
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }],
  });
  if (choice.canceled || !choice.filePath) return { cancelled: true };
  const outputPath = choice.filePath.toLowerCase().endsWith('.mp4') ? choice.filePath : `${choice.filePath}.mp4`;
  const sendProgress = (pct) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:export-progress', Math.min(99, pct));
  };
  const controller = new AbortController(); activeRenderControllers.add(controller);
  const candidateAudioDir = audioPath ? path.dirname(path.resolve(audioPath)) : null;
  const trackedAudioDir = candidateAudioDir && path.basename(candidateAudioDir).startsWith('panelvid-voice-') ? candidateAudioDir : null;
  if (trackedAudioDir) activeRenderVoiceDirs.add(trackedAudioDir);
  try {
    const rendered = await renderChapter({
      ffmpeg: ffmpegPath(), pages, quality, fps, seconds, audioPath, outputPath, encoder, workers, comicStyle, mangaTransitionIn, mangaTransitionOut, voiceTimingAnchor, voiceTimingOffsetSeconds, audioDurationSeconds,
      onProgress: sendProgress, signal: controller.signal,
    });
    let subtitleWarning = null;
    if (subtitles && Array.isArray(subtitles.items) && subtitles.items.length) {
      const burn = await burnSubtitlesIntoVideo(outputPath, subtitles, quality, { signal: controller.signal });
      if (!burn.ok) subtitleWarning = burn.error;
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:export-progress', 100);
    return { cancelled: false, outputPath, subtitleWarning, encoder: rendered.encoder };
  } catch (err) { if (controller.signal.aborted || err?.code === 'CANCELLED') return { cancelled: true }; throw err; }
  finally {
    activeRenderControllers.delete(controller);
    if (trackedAudioDir) {
      activeRenderVoiceDirs.delete(trackedAudioDir);
      if (trackedAudioDir !== lastVoiceDir) await fs.rm(trackedAudioDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

// Xuất thẳng ra đường dẫn cho trước (dùng cho hàng đợi render): không hiện hộp thoại lưu.
ipcMain.handle('app:export-to-path', async (event, { pages, quality = 'balanced', fps = 60, seconds = 4, audioPath = null, subtitles = null, encoder = 'auto', workers = 2, comicStyle = 'manga', mangaTransitionIn = 'none', mangaTransitionOut = 'slide-right', voiceTimingAnchor = 'start', voiceTimingOffsetSeconds = 0, audioDurationSeconds = 0, outDir, fileName }) => {
  if (!outDir || !String(outDir).trim()) throw new Error('Chưa chọn thư mục xuất video.');
  const dir = path.resolve(String(outDir));
  try { await fs.mkdir(dir, { recursive: true }); } catch (e) { throw new Error(`Không tạo được thư mục xuất: ${e.message}`); }
  let base = sanitizeFileName(fileName);
  if (!base.toLowerCase().endsWith('.mp4')) base += '.mp4';
  const outputPath = path.join(dir, base);
  const sendProgress = (pct) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:export-progress', Math.min(99, pct));
  };
  const controller = new AbortController(); activeRenderControllers.add(controller);
  const candidateAudioDir = audioPath ? path.dirname(path.resolve(audioPath)) : null;
  const trackedAudioDir = candidateAudioDir && path.basename(candidateAudioDir).startsWith('panelvid-voice-') ? candidateAudioDir : null;
  if (trackedAudioDir) activeRenderVoiceDirs.add(trackedAudioDir);
  try {
    const rendered = await renderChapter({
      ffmpeg: ffmpegPath(), pages, quality, fps, seconds, audioPath, outputPath, encoder, workers, comicStyle, mangaTransitionIn, mangaTransitionOut, voiceTimingAnchor, voiceTimingOffsetSeconds, audioDurationSeconds,
      onProgress: sendProgress, signal: controller.signal,
    });
    let subtitleWarning = null;
    if (subtitles && Array.isArray(subtitles.items) && subtitles.items.length) {
      const burn = await burnSubtitlesIntoVideo(outputPath, subtitles, quality, { signal: controller.signal });
      if (!burn.ok) subtitleWarning = burn.error;
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:export-progress', 100);
    return { outputPath, subtitleWarning, encoder: rendered.encoder };
  } catch (err) { if (controller.signal.aborted || err?.code === 'CANCELLED') return { cancelled: true }; throw err; }
  finally {
    activeRenderControllers.delete(controller);
    if (trackedAudioDir) {
      activeRenderVoiceDirs.delete(trackedAudioDir);
      if (trackedAudioDir !== lastVoiceDir) await fs.rm(trackedAudioDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

// Chọn thư mục xuất cho hàng đợi render.
ipcMain.handle('app:pick-dir', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục lưu các video trong hàng đợi',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (choice.canceled || !choice.filePaths || !choice.filePaths.length) return { cancelled: true };
  return { cancelled: false, dirPath: choice.filePaths[0] };
});

// ===== NỐI VIDEO (v4) =====
// Chọn nhiều file MP4 để nối.
ipcMain.handle('app:pick-videos', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn các file video MP4 để nối',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }],
  });
  if (choice.canceled || !choice.filePaths || !choice.filePaths.length) return { cancelled: true };
  return { cancelled: false, files: choice.filePaths };
});

// Đọc thông tin các file video (hiện thời lượng/độ phân giải trong danh sách nối).
ipcMain.handle('app:probe-videos', async (event, { files }) => {
  const infos = [];
  for (const f of files || []) {
    try {
      const info = await probeFile(ffmpegPath(), f);
      infos.push({ ...info, path: f, name: path.basename(f), ok: true });
    } catch (e) {
      infos.push({ path: f, name: path.basename(String(f || '')), ok: false, error: (e && e.message) || String(e) });
    }
  }
  return { infos };
});

// Nối nhiều video thành 1 file.
ipcMain.handle('app:concat', async (event, { files, outDir, fileName, quality = 'balanced' }) => {
  const sendProgress = (pct) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:concat-progress', Math.min(99, pct));
  };
  const res = await concatVideos({
    ffmpeg: ffmpegPath(), files, outDir, fileName, quality,
    onProgress: sendProgress,
  });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:concat-progress', 100);
  return res;
});


function edgeTtsHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'edge_tts_helper.py')
    : path.join(app.getAppPath(), 'resources', 'edge_tts_helper.py');
}

// Script batch Chatterbox local (v5): load model 1 lần, clone giọng mẫu, gen từng cue.
function chatterboxBatchPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'chatterbox_batch.py')
    : path.join(app.getAppPath(), 'resources', 'chatterbox_batch.py');
}

// Script batch VieNeu-TTS local (v6o): clone giọng mẫu đọc text TIẾNG VIỆT.
function vieneuBatchPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'vieneu_batch.py')
    : path.join(app.getAppPath(), 'resources', 'vieneu_batch.py');
}

// Cache model VieNeu (~610MB) nằm ở userData: thư mục app bị thay mỗi lần cập
// nhật bản mới, cache trong app sẽ bắt tải lại từ đầu.
function vieneuCacheDir() {
  return path.join(app.getPath('userData'), 'vieneu-cache');
}

async function findPython() {
  const tries = [
    { cmd: 'py', args: ['-3.11', '--version'], base: ['-3.11'] },
    { cmd: 'py', args: ['--version'], base: [] },
    { cmd: 'python', args: ['--version'], base: [] },
  ];
  for (const t of tries) {
    try {
      const { stdout, stderr } = await execFileAsync(t.cmd, t.args, { timeout: 15000, windowsHide: true });
      if (/Python 3/.test(String(stdout || '') + String(stderr || ''))) return { cmd: t.cmd, base: t.base };
    } catch { /* thử cách tiếp theo */ }
  }
  return null;
}

async function checkEdgeTts(py) {
  try {
    await execFileAsync(py.cmd, [...py.base, '-c', 'import edge_tts'], { timeout: 30000, windowsHide: true });
    return true;
  } catch { return false; }
}

ipcMain.handle('app:python-ready', async () => {
  const py = await findPython();
  if (!py) return { ok: false, reason: 'no-python' };
  if (!(await checkEdgeTts(py))) return { ok: false, reason: 'no-edge-tts' };
  return { ok: true };
});

// Kiểm tra môi trường Chatterbox local (v5): Python + torch + chatterbox (+ CUDA?).
async function checkChatterbox(py) {
  try {
    const { stdout } = await execFileAsync(py.cmd, [...py.base, '-c',
      'import torch; print("cuda" if torch.cuda.is_available() else "cpu")'],
      { timeout: 90000, windowsHide: true });
    await execFileAsync(py.cmd, [...py.base, '-c',
      'from chatterbox.mtl_tts import ChatterboxMultilingualTTS'],
      { timeout: 90000, windowsHide: true });
    return { ok: true, cuda: String(stdout || '').includes('cuda') };
  } catch {
    return { ok: false };
  }
}
ipcMain.handle('app:chatterbox-ready', async () => {
  const py = await findPython();
  if (!py) return { ok: false, reason: 'no-python' };
  const chk = await checkChatterbox(py);
  if (!chk.ok) return { ok: false, reason: 'no-chatterbox' };
  return { ok: true, cuda: chk.cuda };
});

// Kiểm tra môi trường VieNeu-TTS local (v6o): Python + gói vieneu (ONNX, không torch).
async function checkVieneu(py) {
  try {
    await execFileAsync(py.cmd, [...py.base, '-c', 'import vieneu'], { timeout: 90000, windowsHide: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
ipcMain.handle('app:vieneu-ready', async () => {
  const py = await findPython();
  if (!py) return { ok: false, reason: 'no-python' };
  const chk = await checkVieneu(py);
  if (!chk.ok) return { ok: false, reason: 'no-vieneu' };
  return { ok: true };
});

// Chọn file giọng mẫu để clone (wav/mp3/m4a/flac).
ipcMain.handle('app:edge-voices', async () => {
  const py = await findPython();
  if (!py) throw new Error('Không tìm thấy Python 3. Hãy chạy lại file BAT để cài đặt.');
  if (!(await checkEdgeTts(py))) throw new Error('Thiếu edge-tts. Chạy lại file BAT để cài thư viện.');
  const { stdout } = await execFileAsync(py.cmd, [...py.base, '-c', 'import asyncio,edge_tts,json; print(json.dumps(asyncio.run(edge_tts.list_voices()),ensure_ascii=False))'], { timeout: 60000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout.trim());
});
ipcMain.handle('app:voice-preview', async (event, { text, voice, cloneRef, cloneLang, cloneExaggeration, ttsOptions = {} } = {}) => {
  const cueText = String(text || '').trim();
  const voiceId = String(voice || '').trim();
  if (!cueText || !voiceId) throw new Error('Chọn voice và cue cần nghe thử trước.');
  return withVoiceRun(async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'panelvid-preview-'));
    try {
      const cues = [{ text: cueText, start: 0, end: 0 }];
      let audioPath, mime;
      if (selectTtsBackend(voiceId) === 'chatterbox') {
        const { py, batch } = await requireChatterboxEnv();
        await synthesizeCuesChatterbox({ py, batch, tmp, cues, cloneRef, cloneLang, cloneExaggeration });
        audioPath = cueWavPath(tmp, 0); mime = 'audio/wav';
      } else if (selectTtsBackend(voiceId) === 'vieneu') {
        const { py, batch } = await requireVieneuEnv();
        await synthesizeCuesVieneu({ py, batch, tmp, cues, cloneRef });
        audioPath = cueWavPath(tmp, 0); mime = 'audio/wav';
      } else {
        const { py, helper } = await requireTtsEnv();
        await synthesizeCues({ py, helper, tmp, cues, voiceId, ttsOptions });
        audioPath = cueMp3Path(tmp, 0); mime = 'audio/mpeg';
      }
      const data = await fs.readFile(audioPath);
      return { dataUri: `data:${mime};base64,${data.toString('base64')}` };
    } finally { await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
  });
});
ipcMain.handle('app:voice-cues-save', async (event, { count, extension = 'mp3' } = {}) => {
  if (!lastVoiceDir) throw new Error('Chưa có audio cue được tạo.');
  const choice = await dialog.showOpenDialog(mainWindow, { title: 'Chọn thư mục lưu audio theo cue', properties: ['openDirectory', 'createDirectory'] });
  if (choice.canceled || !choice.filePaths?.[0]) return { cancelled: true };
  const total = Math.max(0, Math.min(5000, Number(count) || 0));
  const ext = extension === 'wav' ? 'wav' : 'mp3';
  const pathFn = ext === 'wav' ? cueWavPath : cueMp3Path;
  for (let i = 0; i < total; i++) {
    const src = pathFn(lastVoiceDir, i), dest = path.join(choice.filePaths[0], `cue-${String(i + 1).padStart(4, '0')}.${ext}`);
    await fs.copyFile(src, dest);
  }
  return { outputDir: choice.filePaths[0], count: total };
});
ipcMain.handle('app:pick-voice-ref', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file giọng mẫu để clone',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }],
  });
  if (choice.canceled || !choice.filePaths || !choice.filePaths.length) return { cancelled: true };
  return { cancelled: false, refPath: choice.filePaths[0] };
});

// Lưu file audio kéo-thả từ renderer (v6a): renderer không đọc được đường dẫn
// trực tiếp trên Electron mới (File.path bị bỏ) nên gửi bytes sang main ghi ra temp.
ipcMain.handle('app:save-blob-audio', async (event, { name, data }) => {
  try {
    const buf = Buffer.from(data || []);
    if (!buf.length) throw new Error('File rỗng.');
    const dir = path.join(os.tmpdir(), 'panelvid-drop');
    await fs.mkdir(dir, { recursive: true });
    const safe = String(name || 'giong-mau.wav').replace(/[^\w.\- àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/g, '_');
    const dest = path.join(dir, `${Date.now()}-${safe}`);
    await fs.writeFile(dest, buf);
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// Thông tin file audio (v6): tồn tại? + thời lượng (giây). Dùng để hiện tên/thời lượng giọng mẫu.
ipcMain.handle('app:audio-info', async (event, { filePath }) => {
  try {
    await fs.access(filePath);
    let duration = 0;
    try { duration = await audioDurationSeconds(filePath); } catch {}
    return { exists: true, duration };
  } catch { return { exists: false, duration: 0 }; }
});

// Kiểm tra file tồn tại (v6): dùng khi mở chap chờ để xác nhận file voice còn đó.
ipcMain.handle('app:file-exists', async (event, { filePath }) => {
  if (!filePath) return false;
  try { await fs.access(filePath); return true; } catch { return false; }
});

function parkedVoicePath(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(app.getPath('userData'), 'parked-voices', `${safe}.mp3`);
}

// Giữ file voice cho chap chờ (v6): copy sang userData (bền vững, tmp có thể bị dọn).
ipcMain.handle('app:stash-voice', async (event, { srcPath, id }) => {
  if (!srcPath || !id) throw new Error('Thiếu tham số giữ voice.');
  const dest = parkedVoicePath(id);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(srcPath, dest);
  return { path: dest };
});
ipcMain.handle('app:unstash-voice', async (event, { id }) => {
  if (!id) return { ok: false };
  await fs.rm(parkedVoicePath(id), { force: true }).catch(() => {});
  return { ok: true };
});

// Độ biểu cảm Chatterbox (v6i): kẹp 0..1, rác/không có -> 0.5 (mặc định cũ).
function sanitizeExaggeration(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

// Avoid Hugging Face symlink creation on Windows without Developer Mode.
function chatterboxProcessOptions() {
  return {
    windowsHide: true,
    env: {
      ...process.env,
      HF_HUB_DISABLE_SYMLINKS: '1',
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    },
  };
}

// Nghe thử giọng clone (v6): gen 1 câu ngắn bằng file mẫu, trả về data URI để phát ngay trong app.
let lastCloneTestPath = '';
ipcMain.handle('app:clone-test', async (event, { refPath, lang, text, exaggeration }) => {
  // Tiếng Việt đi đường VieNeu (v6o), các ngôn ngữ còn lại đi Chatterbox như cũ.
  const isVi = lang === 'vi';
  const { py, batch } = isVi ? await requireVieneuEnv() : await requireChatterboxEnv();
  const ref = validateChatterboxArgs({ cloneRef: refPath });
  try { await fs.access(ref); } catch { throw new Error(`Không tìm thấy file giọng mẫu: ${ref}`); }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'panelvid-clonetest-'));
  const outPath = path.join(tmp, 'test.wav');
  const jobPath = path.join(tmp, 'job.json');
  const sampleText = String(text || (isVi
    ? 'Xin chào, đây là bản thử giọng clone của tôi.'
    : 'こんにちは、これは私の声のテストです。')).slice(0, 200);
  const job = isVi
    ? { cues: [{ text: sampleText, output: outPath }], reference_voice: ref, cache_dir: vieneuCacheDir(), skip_existing: false }
    : { cues: [{ text: sampleText, output: outPath }], reference_voice: ref, language_id: lang || 'ja', exaggeration: sanitizeExaggeration(exaggeration), skip_existing: false };
  await fs.writeFile(jobPath, JSON.stringify(job), 'utf8');
  await new Promise((resolve, reject) => {
    const child = spawn(py.cmd, [...py.base, batch, jobPath], chatterboxProcessOptions());
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => reject(new Error(`Không chạy được Python: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Tạo giọng thử thất bại. ${stderr.slice(-600)}`)));
  });
  let data;
  try { data = await fs.readFile(outPath); } catch { throw new Error('Không tạo được file giọng thử.'); }
  lastCloneTestPath = outPath;
  return { dataUri: `data:audio/wav;base64,${data.toString('base64')}` };
});

// Lưu file giọng thử vừa tạo ra chỗ anh chọn (v6c).
ipcMain.handle('app:clone-test-save', async () => {
  try {
    if (!lastCloneTestPath) throw new Error('Chưa có giọng thử. Hãy bấm "Nghe thử giọng clone" trước.');
    try { await fs.access(lastCloneTestPath); } catch { throw new Error('File giọng thử không còn. Hãy tạo lại.'); }
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu file giọng thử',
      defaultPath: 'giong-thu.wav',
      filters: [{ name: 'WAV', extensions: ['wav'] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, cancelled: true };
    await fs.copyFile(lastCloneTestPath, choice.filePath);
    return { ok: true, path: choice.filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ===== Thư viện giọng (v6d) — lưu trong userData/voice-library =====
ipcMain.handle('app:voice-lib-list', async () => {
  const base = app.getPath('userData');
  const entries = await listLibEntries(base);
  return sortLibEntries(entries);
});

ipcMain.handle('app:voice-lib-add', async (event, payload = {}) => {
  const base = app.getPath('userData');
  let srcPath = payload.srcPath || '';
  if (payload.useLastVoiceCue) {
    if (!lastVoiceDir) throw new Error('Chưa có voice vừa tạo để lưu.');
    srcPath = cueWavPath(lastVoiceDir, 0);
  }
  if (payload.useLastCloneTest) {
    if (!lastCloneTestPath) throw new Error('Chưa có giọng thử. Hãy bấm "Nghe thử giọng clone" trước.');
    srcPath = lastCloneTestPath;
  }
  if (!srcPath) throw new Error('Thiếu file giọng nguồn.');
  let duration = 0;
  try { duration = await audioDurationSeconds(srcPath); } catch {}
  const entry = await addLibEntry(base, {
    srcPath,
    name: payload.name,
    type: payload.type,
    meta: payload.meta || {},
    duration,
  });
  return entry;
});

ipcMain.handle('app:voice-lib-remove', async (event, { id } = {}) => {
  const base = app.getPath('userData');
  const removed = await removeLibEntry(base, String(id || ''));
  return { removed };
});

async function audioDurationSeconds(file) {
  let out = '';
  try { await execFileAsync(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true }); }
  catch (e) { out = String((e && e.stderr) || (e && e.message) || ''); }
  const m = /Duration:\s*(\d+):(\d{2}):([\d.]+)/.exec(out);
  if (!m) throw new Error('Không đọc được thời lượng file voice.');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function runFfmpegQuiet(args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted || activeVoiceRun?.cancelled) { reject(cancelledError()); return; }
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    const voiceRun = trackVoiceChild(child);
    let wasCancelled = false;
    const onAbort = () => { wasCancelled = true; terminateChildTree(child); };
    signal?.addEventListener('abort', onAbort, { once: true });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => { signal?.removeEventListener('abort', onAbort); reject(wasCancelled || voiceRun?.cancelled ? cancelledError() : new Error(`Không thể chạy FFmpeg. ${e.message}`)); });
    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      if (wasCancelled || signal?.aborted || voiceRun?.cancelled) reject(cancelledError());
      else if (code === 0) resolve(stderr);
      else reject(new Error(stderr.slice(-1800) || `FFmpeg thoát với mã ${code}`));
    });
  });
}

// Một lượt FFmpeg cho cả thời lượng (metadata input) lẫn phân tích loudness.
async function analyzeCue(file) {
  const stderr = await runFfmpegQuiet(['-hide_banner', '-i', file, '-af', 'loudnorm=I=-18:TP=-2:LRA=11:print_format=json', '-f', 'null', '-']);
  const m = /Duration:\s*(\d+):(\d{2}):([\d.]+)/.exec(stderr);
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  if (!(duration > 0)) throw new Error(`Không đọc được thời lượng cue: ${path.basename(file)}`);
  return { duration, loudness: parseLoudnormMeasurement(stderr) };
}

let lastVoiceDir = null;
// Thông tin lần tạo voice dở dang (để resume): { failedAt, tmpDir, cueCount, voiceId }.
let lastVoiceFail = null;

function sendVoiceProgress(p) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:tts-progress', p);
}

async function requireTtsEnv() {
  const py = await findPython();
  if (!py) throw new Error('Không tìm thấy Python 3 trên máy. Cài Python 3.11 (tick "Add python.exe to PATH") rồi thử lại.');
  if (!(await checkEdgeTts(py))) throw new Error('Thiếu thư viện edge-tts. Chạy lại CHAY-PANELVID.bat để tự cài (cần Internet).');
  const helper = edgeTtsHelperPath();
  try { await fs.access(helper); } catch { throw new Error('Thiếu file edge_tts_helper.py trong resources.'); }
  return { py, helper };
}

// Môi trường Chatterbox local (v5): Python + torch + chatterbox. Không có CUDA vẫn chạy (CPU, chậm hơn).
async function requireChatterboxEnv() {
  const py = await findPython();
  if (!py) throw new Error('Không tìm thấy Python 3 trên máy. Cài Python 3.11 (tick "Add python.exe to PATH") rồi thử lại.');
  const chk = await checkChatterbox(py);
  if (!chk.ok) throw new Error('Chưa cài Chatterbox. Chạy 1-cai-dat.bat của bộ Chatterbox để cài đặt (cần Internet 1 lần).');
  const batch = chatterboxBatchPath();
  try { await fs.access(batch); } catch { throw new Error('Thiếu file chatterbox_batch.py trong resources.'); }
  if (!chk.cuda) sendVoiceProgress({ note: 'Không thấy GPU CUDA — Chatterbox sẽ chạy bằng CPU (chậm hơn nhiều).' });
  return { py, batch };
}

// Môi trường VieNeu-TTS local (v6o): Python + gói vieneu (chạy ONNX/CPU, không
// đụng torch của Chatterbox). Chưa cài -> báo chạy lại BAT để tự cài.
async function requireVieneuEnv() {
  const py = await findPython();
  if (!py) throw new Error('Không tìm thấy Python 3 trên máy. Cài Python 3.11 (tick "Add python.exe to PATH") rồi thử lại.');
  const chk = await checkVieneu(py);
  if (!chk.ok) throw new Error('Chưa cài VieNeu-TTS. Chạy lại CHAY-PANELVID.bat để tự cài (cần Internet 1 lần).');
  const batch = vieneuBatchPath();
  try { await fs.access(batch); } catch { throw new Error('Thiếu file vieneu_batch.py trong resources.'); }
  return { py, batch };
}

// Chạy VieNeu batch cho toàn bộ cue: load model 1 lần, clone giọng mẫu, gen từng
// cue ra wav 48kHz. Dùng cho voice 'vieneu-clone' (text TIẾNG VIỆT). Batch script
// tự bỏ qua cue đã có wav (skip_existing) nên resume chỉ cần chạy lại batch.
async function synthesizeCuesVieneu({ py, batch, tmp, cues, cloneRef }) {
  const ref = validateChatterboxArgs({ cloneRef });
  try { await fs.access(ref); } catch { throw new Error(`Không tìm thấy file giọng mẫu: ${ref}`); }
  const srtStarts = cues.map(c => Number((c && c.start) || 0));
  const jobCues = [];
  for (let i = 0; i < cues.length; i++) {
    const text = String((cues[i] && cues[i].text) || '').trim();
    if (!text) {
      lastVoiceFail = { failedAt: i, tmpDir: tmp, cueCount: cues.length, voiceId: VIENEU_VOICE_ID };
      throw new Error(`Cue ${i + 1} không có nội dung.`);
    }
    jobCues.push({ text, output: cueWavPath(tmp, i) });
  }
  const jobPath = path.join(tmp, 'vieneu-job.json');
  await fs.writeFile(jobPath, JSON.stringify({
    cues: jobCues, reference_voice: ref, cache_dir: vieneuCacheDir(), skip_existing: true,
  }), 'utf8');

  sendVoiceProgress({ note: 'Đang nạp model VieNeu (lần đầu sẽ tải ~610MB model, chỉ 1 lần)...', done: 0, total: cues.length });
  const runBatch = () => new Promise((resolve) => {
    const child = spawn(py.cmd, [...py.base, batch, jobPath], { windowsHide: true });
    trackVoiceChild(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', d => {
      stdout += d.toString();
      const lines = stdout.split(/\r?\n/); stdout = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        const m = /^CUE_(DONE|SKIP)\s+(\d+)/.exec(line);
        if (m) sendVoiceProgress({ done: Number(m[2]) + 1, total: cues.length });
        else if (line === 'MODEL_LOADING') sendVoiceProgress({ note: 'Đã nạp model xong, đang đọc từng cue...', done: 0, total: cues.length });
        else if (line.startsWith('CANH BAO')) sendVoiceProgress({ note: line });
      }
    });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => resolve({ code: 1, stderr: `Không chạy được Python: ${e.message}` }));
    child.on('close', code => resolve({ code, stderr }));
  });

  try {
    await synthesizeWithRetry({
      spawnOnce: runBatch,
      cueIndex: cues.length - 1,
      total: cues.length,
      onProgress: (p) => {
        if (p.retrying != null) sendVoiceProgress({ note: `VieNeu gặp lỗi, đang thử lại (lần ${p.attempt}/${p.maxAttempts})...` });
      },
      shouldCancel: () => Boolean(activeVoiceRun?.cancelled),
    });
  } catch (err) {
    const existsFn = async (p) => { try { await fs.access(p); return true; } catch { return false; } };
    const failedAt = await findResumeStart(tmp, cues.length, existsFn, cueWavPath);
    lastVoiceFail = { failedAt, tmpDir: tmp, cueCount: cues.length, voiceId: VIENEU_VOICE_ID };
    throw new Error(`Tạo voice bằng VieNeu thất bại. ${String(err.message || '').slice(-600)}`);
  }
  for (let i = 0; i < cues.length; i++) {
    try { await fs.access(cueWavPath(tmp, i)); }
    catch {
      lastVoiceFail = { failedAt: i, tmpDir: tmp, cueCount: cues.length, voiceId: VIENEU_VOICE_ID };
      throw new Error(`Tạo voice thất bại ở cue ${i + 1} (không có file wav).`);
    }
  }
  return srtStarts;
}

// Chạy Chatterbox batch cho toàn bộ cue: load model 1 lần, clone giọng mẫu, gen từng cue ra wav.
// Dùng cho voice 'chatterbox-clone'. Batch script tự bỏ qua cue đã có wav (skip_existing) nên resume
// chỉ cần chạy lại batch.
async function synthesizeCuesChatterbox({ py, batch, tmp, cues, cloneRef, cloneLang, cloneExaggeration }) {
  const ref = validateChatterboxArgs({ cloneRef });
  try { await fs.access(ref); } catch { throw new Error(`Không tìm thấy file giọng mẫu: ${ref}`); }
  const srtStarts = cues.map(c => Number((c && c.start) || 0));
  const jobCues = [];
  for (let i = 0; i < cues.length; i++) {
    const text = String((cues[i] && cues[i].text) || '').trim();
    if (!text) {
      lastVoiceFail = { failedAt: i, tmpDir: tmp, cueCount: cues.length, voiceId: CHATTERBOX_VOICE_ID };
      throw new Error(`Cue ${i + 1} không có nội dung.`);
    }
    // v6u: chỉ bản gửi cho TTS mới hạ chữ hoa ở cue "hét" (decapsForTts) —
    // trị tận gốc cue vỡ tiếng; phụ đề vẫn dùng text SRT gốc.
    jobCues.push({ text: decapsForTts(text), output: cueWavPath(tmp, i) });
  }
  const jobPath = path.join(tmp, 'chatterbox-job.json');
  await fs.writeFile(jobPath, JSON.stringify({
    cues: jobCues, reference_voice: ref, language_id: cloneLang || 'vi',
    exaggeration: sanitizeExaggeration(cloneExaggeration), skip_existing: true,
  }), 'utf8');

  sendVoiceProgress({ note: 'Đang nạp model Chatterbox (lần đầu mất 30–60 giây)...', done: 0, total: cues.length });
  const runBatch = () => new Promise((resolve) => {
    const child = spawn(py.cmd, [...py.base, batch, jobPath], chatterboxProcessOptions());
    trackVoiceChild(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', d => {
      stdout += d.toString();
      const lines = stdout.split(/\r?\n/); stdout = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        const m = /^CUE_(DONE|SKIP)\s+(\d+)/.exec(line);
        if (m) sendVoiceProgress({ done: Number(m[2]) + 1, total: cues.length });
        else if (line === 'MODEL_LOADING') sendVoiceProgress({ note: 'Đã nạp model xong, đang đọc từng cue...', done: 0, total: cues.length });
        else if (line.startsWith('CANH BAO')) sendVoiceProgress({ note: line });
      }
    });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => resolve({ code: 1, stderr: `Không chạy được Python: ${e.message}` }));
    child.on('close', code => resolve({ code, stderr }));
  });

  try {
    await synthesizeWithRetry({
      spawnOnce: runBatch,
      cueIndex: cues.length - 1,
      total: cues.length,
      onProgress: (p) => {
        if (p.retrying != null) sendVoiceProgress({ note: `Chatterbox gặp lỗi, đang thử lại (lần ${p.attempt}/${p.maxAttempts})...` });
      },
      shouldCancel: () => Boolean(activeVoiceRun?.cancelled),
    });
  } catch (err) {
    const existsFn = async (p) => { try { await fs.access(p); return true; } catch { return false; } };
    const failedAt = await findResumeStart(tmp, cues.length, existsFn, cueWavPath);
    lastVoiceFail = { failedAt, tmpDir: tmp, cueCount: cues.length, voiceId: CHATTERBOX_VOICE_ID };
    throw new Error(`Tạo voice bằng Chatterbox thất bại. ${String(err.message || '').slice(-600)}`);
  }
  for (let i = 0; i < cues.length; i++) {
    try { await fs.access(cueWavPath(tmp, i)); }
    catch {
      lastVoiceFail = { failedAt: i, tmpDir: tmp, cueCount: cues.length, voiceId: CHATTERBOX_VOICE_ID };
      throw new Error(`Tạo voice thất bại ở cue ${i + 1} (không có file wav).`);
    }
  }
  return srtStarts;
}

// Chạy Edge TTS tối đa 2 cue đồng thời. Mỗi cue có retry/backoff độc lập;
// resume chỉ chạy lại từ cue lỗi trở đi.
async function synthesizeCues({ py, helper, tmp, cues, voiceId, startIndex = 0, ttsOptions = {} }) {
  const srtStarts = [];
  for (let i = 0; i < cues.length; i++) srtStarts.push(Number((cues[i] && cues[i].start) || 0));
  let nextIndex = startIndex;
  let firstError = null;
  const synthesizeCue = async (i) => {
    const text = String((cues[i] && cues[i].text) || '').trim();
    if (!text) {
      lastVoiceFail = { failedAt: i, tmpDir: tmp, cueCount: cues.length, voiceId };
      throw new Error(`Cue ${i + 1} không có nội dung.`);
    }
    const pad = String(i).padStart(4, '0');
    const txtPath = path.join(tmp, `cue-${pad}.txt`);
    const jsonPath = path.join(tmp, `cue-${pad}.json`);
    const mp3Path = cueMp3Path(tmp, i);
    await fs.writeFile(txtPath, text, 'utf8');
    await fs.writeFile(jsonPath, JSON.stringify({ textFile: txtPath, voice: voiceId, output: mp3Path, rate: ttsOptions.rate || '+0%', pitch: ttsOptions.pitch || '+0Hz', volume: ttsOptions.volume || '+0%' }));
    const spawnOnce = () => new Promise((resolve) => {
      const child = spawn(py.cmd, [...py.base, helper, jsonPath], { windowsHide: true });
      trackVoiceChild(child);
      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', e => resolve({ code: 1, stderr: `Không chạy được Python: ${e.message}` }));
      child.on('close', code => resolve({ code, stderr }));
    });
    // Guard file rỗng (v6n): helper thoát 0 nhưng mp3 thiếu hoặc 0 byte vẫn tính
    // là 1 lần thử hỏng để vòng retry gọi lại helper, thay vì lọt qua rồi chết ở
    // bước kiểm tra sau. Check fs.access ở dưới vẫn giữ làm lưới an toàn cuối.
    const verifyMp3 = async () => {
      try {
        const st = await fs.stat(mp3Path);
        return st.size > 0 ? true : 'TTS không trả file audio (rỗng)';
      } catch {
        return 'TTS không trả file audio (rỗng)';
      }
    };
    try {
      await synthesizeWithRetry({
        spawnOnce,
        verify: verifyMp3,
        cueIndex: i,
        total: cues.length,
        onProgress: sendVoiceProgress,
        shouldCancel: () => Boolean(activeVoiceRun?.cancelled),
      });
    } catch (err) {
      lastVoiceFail = { failedAt: i, tmpDir: tmp, cueCount: cues.length, voiceId };
      const note = err.rateLimited
        ? `Tạo voice thất bại ở cue ${i + 1} sau ${MAX_TTS_ATTEMPTS} lần thử (server bận / giới hạn).`
        : `Tạo voice thất bại ở cue ${i + 1}.`;
      throw new Error(`${note} ${String(err.message || '').slice(-600)}`);
    }
    try { await fs.access(mp3Path); } catch {
      lastVoiceFail = { failedAt: i, tmpDir: tmp, cueCount: cues.length, voiceId };
      throw new Error(`Tạo voice thất bại ở cue ${i + 1} (không có file mp3).`);
    }
  };
  const worker = async () => {
    while (!firstError && !activeVoiceRun?.cancelled) {
      const i = nextIndex++;
      if (i >= cues.length) return;
      try { await synthesizeCue(i); }
      catch (err) { if (!firstError) firstError = err; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, Math.max(0, cues.length - startIndex)) }, () => worker()));
  if (activeVoiceRun?.cancelled) throw cancelledError();
  if (firstError) throw firstError;
  return srtStarts;
}

// Dựng timeline voice_full.mp3 + pageSegments từ các file cue. Dùng chung cho tts và tts-resume.
// cuePathFn: cueMp3Path (Edge TTS) hoặc cueWavPath (Chatterbox).
async function buildVoiceTimeline(tmp, cues, srtStarts, cuePathFn = cueMp3Path) {
  const starts = [], cueDurations = [], cueLoudness = [];
  let cursor = 0;
  for (let i = 0; i < cues.length; i++) {
    const { duration: dur, loudness } = await analyzeCue(cuePathFn(tmp, i));
    cueDurations.push(dur);
    cueLoudness.push(loudness);
    const start = Math.max(srtStarts[i], cursor);
    starts.push(start);
    cursor = start + dur;
  }
  const D = cursor;
  const voicePath = path.join(tmp, 'voice_full.mp3');
  const args = ['-hide_banner', '-y'];
  for (let i = 0; i < cues.length; i++) args.push('-i', cuePathFn(tmp, i));
  const parts = [];
  for (let i = 0; i < cues.length; i++) {
    const ms = Math.round(starts[i] * 1000);
    // Cân từng cue theo integrated loudness (EBU R128), không chỉ theo peak:
    // peak bằng nhau nhưng RMS/LUFS khác nhau vẫn tạo cảm giác càng về cuối càng to.
    const norm=cueLoudnormFilter(cueLoudness[i]);
    parts.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo,${norm},aresample=44100,adelay=${ms}|${ms}[a${i}]`);
  }
  // normalize=0 rất quan trọng: với input bị adelay, amix mặc định đổi hệ số
  // khi từng input kết thúc; các cue cuối bị khuếch đại thêm. Mỗi cue đã chuẩn
  // hóa riêng về -18 LUFS / -2 dBTP nên chỉ giới hạn đỉnh sau khi trộn.
  parts.push(`${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:duration=longest:normalize=0[mix]`);
  parts.push(`[mix]alimiter=limit=0.9:level=false[aout]`);
  const filterPath = path.join(tmp, 'voice-filter.txt');
  await fs.writeFile(filterPath, parts.join(';'));
  args.push('-filter_complex_script', filterPath, '-map', '[aout]', '-c:a', 'libmp3lame', '-b:a', '128k', voicePath);
  await runFfmpegQuiet(args);
  // Mốc trang -> pageSegments {pageIndex 0-based: [start, end]}.
  const segMap = new Map(), order = [];
  for (let i = 0; i < cues.length; i++) {
    const pg = cues[i] && cues[i].page;
    if (pg == null) continue;
    if (!segMap.has(pg)) { segMap.set(pg, { start: starts[i], end: D }); order.push(pg); }
  }
  const pageSegments = {};
  order.forEach((pg, k) => {
    const seg = segMap.get(pg);
    seg.end = k + 1 < order.length ? segMap.get(order[k + 1]).start : D;
    pageSegments[pg - 1] = [seg.start, seg.end];
  });
  // cueStarts (v6i): giây bắt đầu từng cue trên timeline — renderer dùng để
  // dựng dòng phụ đề ghi lên video, khớp đúng tiếng đọc.
  return { voicePath, duration: D, pageSegments, cueStarts: starts, cueDurations };
}

ipcMain.handle('app:tts', async (event, { cues, voice, cloneRef, cloneLang, cloneExaggeration, ttsOptions }) => {
  return withVoiceRun(async (run) => {
  if (!Array.isArray(cues) || !cues.length) throw new Error('Chưa có cue nào để tạo voice.');
  const voiceId = String(voice || '').trim();
  if (!voiceId) throw new Error('Chưa chọn giọng đọc.');
  // Keep earlier generated audio until its export finishes; the export IPC owns cleanup.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'panelvid-voice-'));
  lastVoiceDir = tmp;
  run.tmp = tmp; run.cues = cues; run.voiceId = voiceId;
  lastVoiceFail = null;
  if (selectTtsBackend(voiceId) === 'chatterbox') {
    const { py, batch } = await requireChatterboxEnv();
    const srtStarts = await synthesizeCuesChatterbox({ py, batch, tmp, cues, cloneRef, cloneLang, cloneExaggeration });
    const result = await buildVoiceTimeline(tmp, cues, srtStarts, cueWavPath);
    lastVoiceFail = null;
    return result;
  }
  if (selectTtsBackend(voiceId) === 'vieneu') {
    const { py, batch } = await requireVieneuEnv();
    const srtStarts = await synthesizeCuesVieneu({ py, batch, tmp, cues, cloneRef });
    const result = await buildVoiceTimeline(tmp, cues, srtStarts, cueWavPath);
    lastVoiceFail = null;
    return result;
  }
  const { py, helper } = await requireTtsEnv();
  const srtStarts = await synthesizeCues({ py, helper, tmp, cues, voiceId, startIndex: 0, ttsOptions });
  const result = await buildVoiceTimeline(tmp, cues, srtStarts);
  lastVoiceFail = null;
  return result;
  });
});

// Tiếp tục batch voice dở dang: dùng lại tmp dir cũ, chỉ chạy các cue còn thiếu.
ipcMain.handle('app:tts-resume', async (event, { cues, voice, cloneRef, cloneLang, cloneExaggeration, ttsOptions }) => {
  return withVoiceRun(async (run) => {
  if (!Array.isArray(cues) || !cues.length) throw new Error('Chưa có cue nào để tạo voice.');
  const voiceId = String(voice || '').trim();
  if (!voiceId) throw new Error('Chưa chọn giọng đọc.');
  const tmp = lastVoiceDir;
  run.tmp = tmp; run.cues = cues; run.voiceId = voiceId;
  if (!tmp) throw new Error('Không còn dữ liệu voice dở dang để tiếp tục. Hãy tạo voice lại từ đầu.');
  try { await fs.access(tmp); } catch { throw new Error('Thư mục voice dở dang đã bị xóa. Hãy tạo voice lại từ đầu.'); }
  if (lastVoiceFail && lastVoiceFail.cueCount !== cues.length) {
    throw new Error('File SRT đã đổi so với lần tạo dở dang. Hãy tạo voice lại từ đầu.');
  }
  const existsFn = async (p) => { try { await fs.access(p); return true; } catch { return false; } };
  if (selectTtsBackend(voiceId) === 'chatterbox') {
    // Batch script tự bỏ qua cue đã có wav nên resume = chạy lại batch.
    const { py, batch } = await requireChatterboxEnv();
    const startIndex = await findResumeStart(tmp, cues.length, existsFn, cueWavPath);
    if (startIndex >= cues.length) {
      const srtStarts = cues.map(c => Number((c && c.start) || 0));
      const result = await buildVoiceTimeline(tmp, cues, srtStarts, cueWavPath);
      lastVoiceFail = null;
      return result;
    }
    sendVoiceProgress({ done: startIndex, total: cues.length });
    const srtStarts = await synthesizeCuesChatterbox({ py, batch, tmp, cues, cloneRef, cloneLang, cloneExaggeration });
    const result = await buildVoiceTimeline(tmp, cues, srtStarts, cueWavPath);
    lastVoiceFail = null;
    return result;
  }
  if (selectTtsBackend(voiceId) === 'vieneu') {
    // Batch script tự bỏ qua cue đã có wav nên resume = chạy lại batch.
    const { py, batch } = await requireVieneuEnv();
    const startIndex = await findResumeStart(tmp, cues.length, existsFn, cueWavPath);
    if (startIndex >= cues.length) {
      const srtStarts = cues.map(c => Number((c && c.start) || 0));
      const result = await buildVoiceTimeline(tmp, cues, srtStarts, cueWavPath);
      lastVoiceFail = null;
      return result;
    }
    sendVoiceProgress({ done: startIndex, total: cues.length });
    const srtStarts = await synthesizeCuesVieneu({ py, batch, tmp, cues, cloneRef });
    const result = await buildVoiceTimeline(tmp, cues, srtStarts, cueWavPath);
    lastVoiceFail = null;
    return result;
  }
  const { py, helper } = await requireTtsEnv();
  const startIndex = await findResumeStart(tmp, cues.length, existsFn);
  if (startIndex >= cues.length) {
    // Mọi mp3 đã có: dựng lại timeline luôn.
    const srtStarts = cues.map(c => Number((c && c.start) || 0));
    const result = await buildVoiceTimeline(tmp, cues, srtStarts);
    lastVoiceFail = null;
    return result;
  }
  sendVoiceProgress({ done: startIndex, total: cues.length });
  const srtStarts = await synthesizeCues({ py, helper, tmp, cues, voiceId, startIndex, ttsOptions });
  const result = await buildVoiceTimeline(tmp, cues, srtStarts);
  lastVoiceFail = null;
  return result;
  });
});

// Renderer hỏi thông tin lần fail gần nhất để hiện nút "Tiếp tục từ câu N".
ipcMain.handle('app:tts-fail-info', async () => {
  if (!lastVoiceFail) return null;
  return { failedAt: lastVoiceFail.failedAt };
});

ipcMain.handle('app:voice-save-as', async (event, { voicePath, fileName } = {}) => {
  const source = path.resolve(String(voicePath || ''));
  const activeDir = lastVoiceDir ? path.resolve(lastVoiceDir) + path.sep : '';
  if (!activeDir || !source.startsWith(activeDir)) throw new Error('Không tìm thấy audio voice vừa tạo để lưu.');
  try { await fs.access(source); } catch { throw new Error('File voice tạm đã bị xóa. Hãy tạo lại voice.'); }
  const choice = await dialog.showSaveDialog(mainWindow, {
    title: 'Lưu file voice clone',
    defaultPath: path.join(app.getPath('music'), String(fileName || 'voice-clone.mp3')),
    filters: [{ name: 'Audio MP3', extensions: ['mp3'] }],
  });
  if (choice.canceled || !choice.filePath) return { cancelled: true };
  const outputPath = choice.filePath.toLowerCase().endsWith('.mp3') ? choice.filePath : `${choice.filePath}.mp3`;
  await fs.copyFile(source, outputPath);
  return { cancelled: false, outputPath };
});

// ===== HÀNG ĐỢI RENDER — jobs (v6f) =====
// Renderer snapshot chap vào <userData>/render-jobs/<id>/ rồi xử lý nền,
// không chạm state workspace.
ipcMain.handle('app:jobs-create', async (event, { job }) => {
  if (!job || !job.id) throw new Error('Thiếu dữ liệu job.');
  await createRenderJob(app.getPath('userData'), job);
  return { id: job.id };
});
ipcMain.handle('app:jobs-save-image', async (event, { jobId, file, data }) => {
  if (!jobId || !file) throw new Error('Thiếu jobId/file ảnh.');
  return saveJobImage(app.getPath('userData'), jobId, file, data);
});
ipcMain.handle('app:jobs-finalize', async (event, { jobId }) => {
  if (!jobId) throw new Error('Thiếu jobId.');
  return loadRenderJob(app.getPath('userData'), jobId);
});
ipcMain.handle('app:jobs-list', async () => listRenderJobs(app.getPath('userData')));
ipcMain.handle('app:jobs-read-image', async (event, { jobId, file }) => {
  if (!jobId || !file) throw new Error('Thiếu jobId/file ảnh.');
  return readJobImage(app.getPath('userData'), jobId, file);
});
ipcMain.handle('app:jobs-update', async (event, { job }) => {
  if (!job || !job.id) throw new Error('Thiếu dữ liệu job.');
  return updateRenderJob(app.getPath('userData'), job);
});
ipcMain.handle('app:jobs-remove', async (event, { jobId }) => {
  if (!jobId) throw new Error('Thiếu jobId.');
  return removeRenderJob(app.getPath('userData'), jobId);
});

ipcMain.handle('app:ffmpeg-ready', async () => {
  try {
    await fs.access(ffmpegPath());
    return true;
  } catch {
    return process.platform !== 'win32';
  }
});
