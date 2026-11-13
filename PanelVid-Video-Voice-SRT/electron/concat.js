// concat.js — nối nhiều file MP4 thành 1 video dài.
// Module thuần ESM, KHÔNG import electron: dùng được cho cả main process và node --test.
// 2 chế độ:
//   - fast: tất cả file cùng chuẩn h264 + 1920x1080 + 60fps + aac -> concat demuxer, -c copy (vài giây, không giảm chất lượng).
//   - normalize: có file lệch chuẩn -> concat filter, chuẩn hóa 1920x1080 60fps, libx264 + aac.
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sanitizeFileName } from './render.js';

const execFileAsync = promisify(execFile);

export const TARGET_W = 1920;
export const TARGET_H = 1080;
export const TARGET_FPS = 60;

// Chạy `ffmpeg -i file`, đọc stderr -> thông tin stream.
export async function probeFile(ffmpeg, filePath) {
  if (!ffmpeg) throw new Error('Thiếu đường dẫn FFmpeg.');
  if (!filePath) throw new Error('Thiếu đường dẫn file.');
  try { await fs.access(filePath); }
  catch { throw new Error(`Không tìm thấy file: ${path.basename(filePath)}`); }
  let out = '';
  try { await execFileAsync(ffmpeg, ['-hide_banner', '-i', filePath]); }
  catch (e) { out = String((e && e.stderr) || (e && e.message) || ''); }
  if (!out) throw new Error(`Không đọc được thông tin file: ${path.basename(filePath)}`);
  const dur = /Duration:\s*(\d+):(\d{2}):([\d.]+)/.exec(out);
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  const vLine = out.split('\n').find(l => /Stream #\d+:\d+/.test(l) && /\bVideo:/.test(l)) || '';
  const aLine = out.split('\n').find(l => /Stream #\d+:\d+/.test(l) && /\bAudio:/.test(l)) || '';
  const vcodec = (/Video:\s*([a-z0-9_]+)/i.exec(vLine) || [])[1] || '';
  const res = /,\s*(\d{3,5})x(\d{3,5})\b/.exec(vLine);
  const fpsM = /([\d.]+)\s*fps/.exec(vLine);
  const acodec = (/Audio:\s*([a-z0-9_]+)/i.exec(aLine) || [])[1] || '';
  return {
    vcodec: vcodec.toLowerCase(),
    width: res ? Number(res[1]) : 0,
    height: res ? Number(res[2]) : 0,
    fps: fpsM ? Number(fpsM[1]) : 0,
    acodec: acodec.toLowerCase(),
    hasAudio: !!aLine,
    duration,
  };
}

// Tất cả file cùng chuẩn mục tiêu thì nối nhanh bằng -c copy.
export function canFastConcat(infos) {
  if (!infos.length) return false;
  const sourceFps = Number(infos[0].fps);
  if (!(sourceFps > 0)) return false;
  return infos.every(i =>
    i.vcodec === 'h264' &&
    i.width === TARGET_W && i.height === TARGET_H &&
    Math.abs(i.fps - sourceFps) < 0.01 &&
    i.hasAudio && i.acodec === 'aac' &&
    i.duration > 0
  );
}

function reportTo(onProgress) {
  return (pct) => { try { onProgress && onProgress(Math.max(0, Math.min(100, Math.round(pct)))); } catch {} };
}

function runFfmpegProgress(ffmpeg, args, totalSeconds, onProgress) {
  const report = reportTo(onProgress);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    let buf = '';
    child.stdout.on('data', data => {
      buf += data.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && totalSeconds > 0) report((Number(m[1]) / 1_000_000 / totalSeconds) * 100);
      }
    });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => reject(new Error(`Không thể chạy FFmpeg. ${e.message}`)));
    child.on('close', code => {
      if (code === 0) { report(100); resolve(); }
      else reject(new Error(stderr.slice(-1800) || `FFmpeg thoát với mã ${code}`));
    });
  });
}

function escapeConcatPath(p) {
  // Concat demuxer: file '...'; dùng / cho an toàn trên Windows, escape dấu nháy đơn.
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

async function concatFast(ffmpeg, files, outputPath, totalSeconds, onProgress) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelvid-concat-'));
  try {
    const listPath = path.join(tempDir, 'list.txt');
    await fs.writeFile(listPath, files.map(f => `file '${escapeConcatPath(f)}'`).join('\n'), 'utf8');
    const args = ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', '-progress', 'pipe:1', '-nostats', outputPath];
    await runFfmpegProgress(ffmpeg, args, totalSeconds, onProgress);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function concatNormalize(ffmpeg, files, infos, outputPath, totalSeconds, quality, onProgress) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelvid-concat-'));
  try {
    const args = ['-hide_banner', '-y'];
    files.forEach(f => args.push('-i', f));
    const parts = [];
    const vLabels = [], aLabels = [];
    for (let i = 0; i < files.length; i++) {
      const info = infos[i];
      const v = `[v${i}]`, a = `[a${i}]`;
      parts.push(`[${i}:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${TARGET_FPS},format=yuv420p${v}`);
      if (info.hasAudio) {
        parts.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo${a}`);
      } else {
        // File không có audio: chèn silence đúng duration.
        const d = Math.max(0.1, info.duration || 1);
        parts.push(`aevalsrc=0:d=${d.toFixed(3)}:s=44100,aformat=channel_layouts=stereo${a}`);
      }
      vLabels.push(v); aLabels.push(a);
    }
    const inter = [];
    for (let i = 0; i < files.length; i++) inter.push(vLabels[i], aLabels[i]);
    parts.push(`${inter.join('')}concat=n=${files.length}:v=1:a=1[outv][outa]`);
    const filterPath = path.join(tempDir, 'concat-filter.txt');
    await fs.writeFile(filterPath, parts.join(';'), 'utf8');
    args.push('-filter_complex_script', filterPath,
      '-map', '[outv]', '-map', '[outa]',
      '-r', String(TARGET_FPS), '-c:v', 'libx264',
      '-preset', quality === 'high' ? 'superfast' : 'ultrafast',
      '-crf', quality === 'high' ? '18' : '21',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
      '-progress', 'pipe:1', '-nostats', outputPath);
    await runFfmpegProgress(ffmpeg, args, totalSeconds, onProgress);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Nối files (đường dẫn tuyệt đối) thành 1 mp4 trong outDir.
// Trả về {outputPath, mode: 'fast' | 'normalize'}.
export async function concatVideos({ ffmpeg, files, outDir, fileName, quality = 'balanced', onProgress }) {
  if (!ffmpeg) throw new Error('Thiếu đường dẫn FFmpeg.');
  if (!Array.isArray(files) || files.length < 2) {
    throw new Error('Cần ít nhất 2 video để nối.');
  }
  if (!outDir || !String(outDir).trim()) throw new Error('Chưa chọn thư mục lưu video.');
  const dir = path.resolve(String(outDir));
  try { await fs.mkdir(dir, { recursive: true }); }
  catch (e) { throw new Error(`Không tạo được thư mục lưu: ${e.message}`); }
  let base = sanitizeFileName(fileName);
  if (!base.toLowerCase().endsWith('.mp4')) base += '.mp4';
  const outputPath = path.join(dir, base);

  const infos = [];
  for (const f of files) {
    try { infos.push(await probeFile(ffmpeg, f)); }
    catch (e) { throw new Error(`Không đọc được "${path.basename(f)}": ${e.message}`); }
  }
  const totalSeconds = infos.reduce((s, i) => s + (i.duration || 0), 0);
  if (totalSeconds <= 0) throw new Error('Không đọc được thời lượng các file video.');

  if (canFastConcat(infos)) {
    await concatFast(ffmpeg, files, outputPath, totalSeconds, onProgress);
    return { outputPath, mode: 'fast' };
  }
  await concatNormalize(ffmpeg, files, infos, outputPath, totalSeconds, quality, onProgress);
  return { outputPath, mode: 'normalize' };
}
