import { randomUUID } from 'node:crypto';
import { access, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

export const LAYOUT = ['source/originals','panels/images','analysis/incoming','adapter','audio/tts','audio/voice-clones','subtitles','video/renders','logs','backups'];
const MARKER = 'project.json';
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function safeName(input) {
  const value = String(input ?? '').trim();
  if (!value || value.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || value === '.' || value === '..' || RESERVED_WINDOWS_NAMES.test(value) || /[. ]$/.test(value)) {
    throw new Error('Tên Project không hợp lệ.');
  }
  return value;
}
function absolutePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw new Error('Đường dẫn không hợp lệ.');
  return path.resolve(input);
}
function inside(root, relative) {
  const base = path.resolve(root), target = path.resolve(base, relative), rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Đường dẫn nằm ngoài Project.');
  return target;
}
function normalizedPath(p) {
  let result = path.normalize(p);
  if (process.platform === 'win32') {
    result = result.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').toLowerCase();
    if (result.length > 3) result = result.replace(/[\\/]+$/, '');
  }
  return result;
}
function samePath(a, b) { return normalizedPath(a) === normalizedPath(b); }

async function ensureSafeDirectory(dir, { create = false, writable = false } = {}) {
  const absolute = absolutePath(dir), parsed = path.parse(absolute);
  if (!parsed.root) throw new Error('Đường dẫn thư mục không hợp lệ.');
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error(`Từ chối thư mục symbolic link/reparse point: ${current}`);
      if (!entry.isDirectory()) throw new Error(`Một phần đường dẫn không phải thư mục: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      try { await mkdir(current); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Thư mục vừa tạo không an toàn: ${current}`);
    }
  }
  const resolved = await realpath(absolute);
  if (!samePath(resolved, absolute)) throw new Error(`Đường dẫn có thành phần symbolic link/reparse point: ${absolute}`);
  if (writable) await access(absolute, fsConstants.W_OK | fsConstants.X_OK);
  else await access(absolute, fsConstants.R_OK | fsConstants.X_OK);
  return absolute;
}
async function ensureRegularFile(filePath, label) {
  const entry = await lstat(filePath);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} phải là file thông thường, không phải symbolic link.`);
  await access(filePath, fsConstants.R_OK);
}
async function assertNoLinksOrSpecialFiles(root) {
  const base = await ensureSafeDirectory(root);
  async function walk(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, item.name), entry = await lstat(full);
      if (entry.isSymbolicLink()) throw new Error(`Từ chối backup/restore vì có symbolic link: ${full}`);
      if (entry.isDirectory()) await walk(full);
      else if (!entry.isFile()) throw new Error(`Từ chối file đặc biệt trong Project: ${full}`);
    }
  }
  await walk(base);
}
async function readMetadata(projectRoot) {
  const marker = inside(projectRoot, MARKER);
  await ensureRegularFile(marker, 'project.json');
  let metadata;
  try { metadata = JSON.parse(await readFile(marker, 'utf8')); }
  catch (error) { throw new Error(`Không đọc được project.json: ${error.message}`); }
  if (!metadata || metadata.schemaVersion !== 1 || typeof metadata.projectId !== 'string' || !metadata.projectId || typeof metadata.name !== 'string' || !metadata.name || !metadata.paths || typeof metadata.paths !== 'object') {
    throw new Error('Project metadata không hợp lệ hoặc chưa hỗ trợ.');
  }
  return metadata;
}

export async function createProject(parentPath, name, appVersion = '0.1.0') {
  const cleanName = safeName(name), parent = await ensureSafeDirectory(parentPath, { create: true, writable: true });
  const projectPath = inside(parent, cleanName);
  try { await mkdir(projectPath); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Thư mục đích đã tồn tại; không ghi đè dữ liệu.'); throw error; }
  let markerWritten = false;
  try {
    await ensureSafeDirectory(projectPath);
    const paths = { originals: 'source/originals', panels: 'panels', analysis: 'analysis', adapter: 'adapter', audio: 'audio', subtitles: 'subtitles', video: 'video', logs: 'logs', backups: 'backups' };
    for (const relative of LAYOUT) await ensureSafeDirectory(inside(projectPath, relative), { create: true, writable: true });
    const now = new Date().toISOString();
    const metadata = { schemaVersion: 1, projectId: randomUUID(), name: cleanName, createdAt: now, updatedAt: now, appVersion, paths };
    await writeFile(inside(projectPath, MARKER), JSON.stringify(metadata, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    markerWritten = true;
    return { path: projectPath, metadata };
  } catch (error) {
    if (markerWritten) await unlink(inside(projectPath, MARKER)).catch(() => {});
    const folders = new Set();
    for (const relative of LAYOUT) {
      let current = '';
      for (const part of relative.split(/[\\/]/)) { current = current ? path.join(current, part) : part; folders.add(current); }
    }
    for (const relative of [...folders].sort((a, b) => b.length - a.length)) await rmdir(inside(projectPath, relative)).catch(() => {});
    await rmdir(projectPath).catch(() => {});
    throw error;
  }
}

export async function openProject(projectPath) {
  const root = await ensureSafeDirectory(projectPath);
  const metadata = await readMetadata(root);
  for (const relative of LAYOUT) {
    const target = inside(root, relative);
    try { await ensureSafeDirectory(target); }
    catch (error) { if (error.code === 'ENOENT') throw new Error(`Project thiếu thư mục bắt buộc: ${relative}`); throw error; }
  }
  return { path: root, metadata };
}

export async function listProjects(parentPath) {
  const parent = await ensureSafeDirectory(parentPath);
  const found = [];
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try { found.push(await openProject(path.join(parent, entry.name))); } catch { /* ignore folders that are not valid Studio projects */ }
  }
  return found;
}

export async function backupProject(projectPath, backupParent) {
  const project = await openProject(projectPath);
  await assertNoLinksOrSpecialFiles(project.path);
  const parent = await ensureSafeDirectory(backupParent, { create: true, writable: true });
  const projectBackupDir = inside(project.path, 'backups');
  const relativeBackupParent = path.relative(project.path, parent);
  const parentIsInsideProject = samePath(parent, project.path) || (relativeBackupParent !== '..' && !relativeBackupParent.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeBackupParent));
  if (parentIsInsideProject && !samePath(parent, projectBackupDir)) {
    throw new Error('Để tránh backup lồng vô hạn, chỉ lưu backup bên ngoài Project hoặc trong thư mục Project/backups.');
  }
  const suffix = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const stage = path.join(parent, `.${project.metadata.name}-${suffix}.staging`);
  const destination = path.join(parent, `${project.metadata.name}-${suffix}.backup`);
  await mkdir(stage);
  try {
    for (const item of await readdir(project.path, { withFileTypes: true })) {
      if (item.name === 'backups') continue;
      const source = inside(project.path, item.name), target = inside(stage, item.name);
      if (item.isDirectory()) await cp(source, target, { recursive: true, errorOnExist: true, force: false, dereference: false });
      else await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    }
    await writeFile(inside(stage, 'backup-info.json'), JSON.stringify({ projectId: project.metadata.projectId, createdAt: new Date().toISOString() }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await rename(stage, destination);
    return destination;
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}

export async function restoreProject(backupPath, destinationPath) {
  const backup = await ensureSafeDirectory(backupPath);
  await assertNoLinksOrSpecialFiles(backup);
  const infoPath = inside(backup, 'backup-info.json'), markerPath = inside(backup, MARKER);
  await ensureRegularFile(infoPath, 'backup-info.json');
  const info = JSON.parse(await readFile(infoPath, 'utf8'));
  const metadata = await readMetadata(backup);
  if (!info || info.projectId !== metadata.projectId) throw new Error('Backup identity does not match project metadata.');

  const destination = absolutePath(destinationPath), parent = await ensureSafeDirectory(path.dirname(destination), { create: true, writable: true });
  const finalDestination = inside(parent, path.basename(destination));
  if (samePath(finalDestination, backup)) throw new Error('Không thể khôi phục đè lên chính thư mục backup.');
  const destinationRelativeToBackup = path.relative(backup, finalDestination);
  if (destinationRelativeToBackup === '' || (destinationRelativeToBackup !== '..' && !destinationRelativeToBackup.startsWith(`..${path.sep}`) && !path.isAbsolute(destinationRelativeToBackup))) {
    throw new Error('Không thể khôi phục vào bên trong thư mục backup nguồn.');
  }
  const stage = path.join(parent, `.${path.basename(destination)}-${randomUUID()}.restore-staging`);
  try { await lstat(finalDestination); throw new Error('Thư mục khôi phục đã tồn tại; không ghi đè dữ liệu.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(stage);
  try {
    for (const item of await readdir(backup, { withFileTypes: true })) {
      if (item.name === 'backup-info.json') continue;
      const source = inside(backup, item.name), target = inside(stage, item.name);
      if (item.isDirectory()) await cp(source, target, { recursive: true, errorOnExist: true, force: false, dereference: false });
      else await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    }
    await ensureSafeDirectory(inside(stage, 'backups'), { create: true, writable: true });
    await openProject(stage);
    try { await lstat(finalDestination); throw new Error('Thư mục khôi phục vừa được tạo bởi tiến trình khác; không ghi đè dữ liệu.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(stage, finalDestination);
    return openProject(finalDestination);
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}

export async function inspectProject(projectPath) {
  const project = await openProject(projectPath), details = await stat(project.path);
  return { ...project, modifiedAt: details.mtime.toISOString() };
}

export async function inspectProjectAccess(projectPath) {
  const project = await openProject(projectPath);
  const owned = { panels: ['panels/images'], analysis: ['analysis/incoming'], adapter: ['adapter'], audio: ['audio/tts', 'audio/voice-clones'], subtitles: ['subtitles'], video: ['video/renders'], logs: ['logs'], backups: ['backups'] };
  const writable = {};
  for (const [module, folders] of Object.entries(owned)) {
    try { for (const relative of folders) await access(inside(project.path, relative), fsConstants.W_OK | fsConstants.X_OK); writable[module] = true; }
    catch { writable[module] = false; }
  }
  return { projectId: project.metadata.projectId, writable, readOnlyModules: Object.keys(writable).filter(module => !writable[module]) };
}
