// voicelib-store.js — lưu trữ "Thư viện giọng" (v6d), chạy ở main process.
// baseDir = app.getPath('userData') khi ở Electron; test truyền tmp dir.
// Cấu trúc: <baseDir>/voice-library/index.json + các file wav <timestamp>-<ten>.wav
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeEntry, validateEntry, pruneEntries, sanitizeLibFileName } from '../src/voicelib.js';

export function getLibDir(baseDir) {
  return path.join(baseDir, 'voice-library');
}

function getIndexPath(baseDir) {
  return path.join(getLibDir(baseDir), 'index.json');
}

export async function loadLibIndex(baseDir) {
  try {
    const raw = await fs.readFile(getIndexPath(baseDir), 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(validateEntry);
  } catch {
    return [];
  }
}

export async function saveLibIndex(baseDir, entries) {
  const dir = getLibDir(baseDir);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, 'index.json.tmp');
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
  await fs.rename(tmp, getIndexPath(baseDir));
}

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// Danh sách entry còn file thật; tự dọn entry mà file đã mất.
export async function listLibEntries(baseDir) {
  const entries = await loadLibIndex(baseDir);
  const existing = new Set();
  for (const e of entries) {
    if (await pathExists(e.path)) existing.add(e.path);
  }
  const kept = pruneEntries(entries, existing);
  if (kept.length !== entries.length) await saveLibIndex(baseDir, kept);
  return kept;
}

// Copy wav nguồn vào thư viện + thêm entry. duration do main tính bằng ffprobe.
export async function addLibEntry(baseDir, { srcPath, name, type, meta = {}, duration = 0 }) {
  if (!srcPath || !(await pathExists(srcPath))) throw new Error('Không tìm thấy file giọng nguồn.');
  const dir = getLibDir(baseDir);
  await fs.mkdir(dir, { recursive: true });
  const ts = Date.now();
  const cleanName = String(name || '').trim() || 'Giọng không tên';
  const fileName = `${ts}-${sanitizeLibFileName(cleanName)}.wav`;
  const dest = path.join(dir, fileName);
  try {
    await fs.copyFile(srcPath, dest);
  } catch (e) {
    throw new Error(`Không copy được file vào thư viện: ${e.message}`);
  }
  const entry = makeEntry({
    id: `${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName,
    type,
    file: dest,
    duration,
    createdAt: ts,
    meta,
  });
  if (!validateEntry(entry)) throw new Error('Entry thư viện không hợp lệ.');
  const entries = await loadLibIndex(baseDir);
  entries.push(entry);
  await saveLibIndex(baseDir, entries);
  return entry;
}

// Xóa entry + file. Trả true nếu có xóa.
export async function removeLibEntry(baseDir, id) {
  const entries = await loadLibIndex(baseDir);
  const entry = entries.find(e => e.id === id);
  if (!entry) return false;
  try { await fs.unlink(entry.path); } catch {}
  await saveLibIndex(baseDir, entries.filter(e => e.id !== id));
  return true;
}
