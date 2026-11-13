// jobs-store.js — lưu trữ HÀNG ĐỢI RENDER (v6f) ở main process.
// baseDir = app.getPath('userData') khi ở Electron; test truyền tmp dir.
// Cấu trúc: <baseDir>/render-jobs/<jobId>/job.json + page-0001.jpg ...
import fs from 'node:fs/promises';
import path from 'node:path';
import { markInterrupted, JOB_STATUSES } from '../src/jobs.js';

export function jobsRoot(baseDir) {
  return path.join(baseDir, 'render-jobs');
}

function sanitizeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'job';
}

function jobDir(baseDir, jobId) {
  return path.join(jobsRoot(baseDir), sanitizeId(jobId));
}

function safeFileName(file) {
  return String(file || '').replace(/[^a-zA-Z0-9_.-]/g, '_') || 'page.bin';
}

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function writeJobJson(dir, job) {
  return fs.writeFile(path.join(dir, 'job.json'), JSON.stringify(job, null, 2), 'utf8');
}

function validateJobShape(job) {
  if (!job || typeof job !== 'object') throw new Error('Job không hợp lệ.');
  if (!job.id) throw new Error('Job thiếu id.');
  if (!JOB_STATUSES.includes(job.status)) job.status = 'cho';
  if (!Array.isArray(job.pages)) job.pages = [];
  if (!Array.isArray(job.scenes)) job.scenes = [];
  return job;
}

// Tạo thư mục job + ghi job.json (ảnh ghi riêng bằng saveJobImage).
export async function createJob(baseDir, job) {
  const clean = validateJobShape(job);
  const dir = jobDir(baseDir, clean.id);
  await fs.mkdir(dir, { recursive: true });
  await writeJobJson(dir, clean);
  return { id: clean.id };
}

// Ghi 1 file ảnh trang vào thư mục job. data: Uint8Array/Buffer/ArrayBuffer.
export async function saveJobImage(baseDir, jobId, file, data) {
  const dir = jobDir(baseDir, jobId);
  await fs.mkdir(dir, { recursive: true });
  const buf = Buffer.from(data || []);
  if (!buf.length) throw new Error(`File ảnh rỗng: ${file}`);
  await fs.writeFile(path.join(dir, safeFileName(file)), buf);
  return { ok: true, file: safeFileName(file) };
}

// Đọc ảnh trang trả về ArrayBuffer (để renderer dựng Blob).
export async function readJobImage(baseDir, jobId, file) {
  const buf = await fs.readFile(path.join(jobDir(baseDir, jobId), safeFileName(file)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function loadJob(baseDir, jobId) {
  const raw = await fs.readFile(path.join(jobDir(baseDir, jobId), 'job.json'), 'utf8');
  return validateJobShape(JSON.parse(raw));
}

export async function updateJob(baseDir, job) {
  const clean = validateJobShape(job);
  await writeJobJson(jobDir(baseDir, clean.id), clean);
  return { ok: true };
}

export async function removeJob(baseDir, jobId) {
  await fs.rm(jobDir(baseDir, jobId), { recursive: true, force: true });
  return { ok: true };
}

// Nạp toàn bộ job lúc khởi động: job dở dang (voice/render) → đánh dấu lỗi gián đoạn.
// Job 'cho' giữ nguyên chờ người dùng bấm "Chạy hàng đợi" (không tự chạy lại).
export async function listJobs(baseDir) {
  const root = jobsRoot(baseDir);
  let ids = [];
  try { ids = await fs.readdir(root); } catch { return []; }
  const jobs = [];
  for (const id of ids) {
    try {
      const job = await loadJob(baseDir, id);
      if (job && job.id) {
        // Kiểm tra ảnh còn đủ trước khi giữ job.
        let imagesOk = true;
        for (const p of job.pages) {
          if (!(await pathExists(path.join(jobDir(baseDir, job.id), safeFileName(p.file))))) { imagesOk = false; break; }
        }
        if (!imagesOk) {
          job.status = 'loi'; job.note = ''; job.error = 'Thiếu file ảnh của job trên đĩa.';
        }
        jobs.push(job);
      }
    } catch { /* bỏ qua thư mục hỏng */ }
  }
  const changed = markInterrupted(jobs);
  if (changed) {
    for (const j of jobs) { try { await updateJob(baseDir, j); } catch {} }
  }
  jobs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return jobs;
}
