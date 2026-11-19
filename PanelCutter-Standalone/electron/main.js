import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createSerialQueue, ensureProject, loadRegistryWithRecovery, resolvePanelIdentities, saveRegistryAtomic } from './identity-registry.js';
import { exportStagedOutput } from './export-core.js';

const require = createRequire(import.meta.url);
const { path7za } = require('7zip-bin');
const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_EXT = /\.(jpe?g|png|webp|bmp)$/i;
let mainWindow;
let activeInput = null;
let activeExport = null;
const tempDirs = new Set();
let detectorAssets;
const serializeRegistry = createSerialQueue();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 850,
    minWidth: 880,
    minHeight: 680,
    backgroundColor: '#11141b',
    title: 'Panel Cutter Offline',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let cleaningTemp = false;
app.on('will-quit', (event) => {
  if (cleaningTemp || !tempDirs.size) return;
  event.preventDefault();
  cleaningTemp = true;
  Promise.all([...tempDirs].map(dir => fs.rm(dir, { recursive: true, force: true }).catch(() => {})))
    .finally(() => app.exit(0));
});

function compareNatural(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

async function walkImages(root, relative = '') {
  const entries = await fs.readdir(root, { withFileTypes: true });
  entries.sort((a, b) => compareNatural(a.name, b.name));
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const abs = path.join(root, entry.name);
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory() && !/-((manga|manhwa|manhua))-panels(?:-\d+)?$/i.test(entry.name)) found.push(...await walkImages(abs, rel));
    else if (entry.isFile() && IMAGE_EXT.test(entry.name)) found.push({ abs, name: entry.name, relativePath: rel });
  }
  return found;
}

async function run7zip(args) {
  const executable = app.isPackaged ? path.join(process.resourcesPath, '7za.exe') : path7za;
  if (process.platform !== 'win32' && !app.isPackaged) await fs.chmod(executable, 0o755).catch(() => {});
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Không giải nén được archive (7-Zip mã ${code}). ${stderr.trim().slice(-700)}`)));
  });
}

function safeLabel(value) {
  const cleaned = String(value || 'truyen').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  return cleaned && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? cleaned.slice(0, 100) : 'truyen';
}

async function registerInput({ sourcePath, rootPath, sourceName, sourceType, tempDir = null }) {
  const images = await walkImages(rootPath);
  if (!images.length) {
    if (tempDir) { tempDirs.delete(tempDir); await fs.rm(tempDir, { recursive: true, force: true }); }
    throw new Error('Không tìm thấy ảnh JPG, PNG, WebP hoặc BMP trong nguồn đã chọn.');
  }
  if (images.length > 50000) throw new Error('Nguồn có quá nhiều ảnh (tối đa 50.000 file).');
  const oldTemp = activeInput?.tempDir;
  if (oldTemp && oldTemp !== tempDir) { tempDirs.delete(oldTemp); await fs.rm(oldTemp, { recursive: true, force: true }); }
  if (activeExport?.stagingDir) {
    tempDirs.delete(activeExport.stagingDir);
    await fs.rm(activeExport.stagingDir, { recursive: true, force: true });
  }
  const token = randomUUID();
  const projectKey = createHash('sha256').update(`${sourceType}\0${path.resolve(sourcePath)}`).digest('hex');
  activeInput = { token, sourcePath, rootPath, sourceName, sourceType, images, tempDir, projectKey, defaultOutputParent: path.dirname(sourcePath) };
  if (tempDir) tempDirs.add(tempDir);
  activeExport = null;
  const chapterMap = new Map();
  for (let index = 0; index < images.length; index++) {
    const parts = images[index].relativePath.split(/[\\/]/);
    const chapter = parts.length > 1 ? parts[0] : null;
    if (chapter) { if (!chapterMap.has(chapter)) chapterMap.set(chapter, []); chapterMap.get(chapter).push(index); }
  }
  const chapters = [...chapterMap].map(([name, indices]) => ({ name, indices }));
  return {
    canceled: false,
    token,
    sourceName,
    sourceType,
    count: images.length,
    chapters,
    defaultOutputParent: path.dirname(sourcePath),
    files: images.slice(0, 80).map((image, index) => ({ index, name: image.name, relativePath: image.relativePath })),
    moreFiles: Math.max(0, images.length - 80),
  };
}

ipcMain.handle('cutter:pick-archive', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file truyện ZIP / CBZ / RAR / CBR',
    properties: ['openFile'],
    filters: [{ name: 'Comic archive', extensions: ['zip', 'cbz', 'rar', 'cbr'] }],
  });
  if (choice.canceled || !choice.filePaths?.length) return { canceled: true };
  const archivePath = choice.filePaths[0];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelcutter-archive-'));
  try {
    await run7zip(['x', archivePath, `-o${tempDir}`, '-y', '-bd']);
    const extension = path.extname(archivePath).slice(1).toUpperCase();
    return await registerInput({ sourcePath: archivePath, rootPath: tempDir, sourceName: path.basename(archivePath, path.extname(archivePath)), sourceType: extension === 'CBR' ? 'CBR / RAR' : extension, tempDir });
  } catch (error) {
    tempDirs.delete(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
});

ipcMain.handle('cutter:pick-folder', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục ảnh truyện',
    properties: ['openDirectory'],
  });
  if (choice.canceled || !choice.filePaths?.length) return { canceled: true };
  const folderPath = choice.filePaths[0];
  return registerInput({ sourcePath: folderPath, rootPath: folderPath, sourceName: path.basename(folderPath), sourceType: 'FOLDER' });
});

ipcMain.handle('cutter:choose-output-parent', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn nơi lưu kết quả',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: activeInput?.defaultOutputParent,
  });
  if (choice.canceled || !choice.filePaths?.length) return { canceled: true };
  return { canceled: false, path: choice.filePaths[0] };
});

ipcMain.handle('cutter:begin-staging', async (_event, { token, style }) => {
  if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh đã thay đổi; hãy chọn lại truyện.');
  if (!['manga', 'manhwa', 'manhua'].includes(style)) throw new Error('Kiểu cắt không hợp lệ.');
  if (activeExport?.stagingDir) {
    tempDirs.delete(activeExport.stagingDir);
    await fs.rm(activeExport.stagingDir, { recursive: true, force: true });
  }
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelcutter-pending-'));
  tempDirs.add(stagingDir);
  activeExport = { token, style, stagingDir, outputDir: null };
  return { ready: true };
});

ipcMain.handle('cutter:read-image', async (_event, { token, index }) => {
  if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh không còn hợp lệ.');
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= activeInput.images.length) throw new Error('Chỉ mục ảnh không hợp lệ.');
  const data = await fs.readFile(activeInput.images[i].abs);
  const sourceFingerprint = createHash('sha256').update(data).digest('hex');
  return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), name: activeInput.images[i].name, relativePath: activeInput.images[i].relativePath, sourceFingerprint };
});

function identityRegistryPath() { return path.join(app.getPath('userData'), 'panel-identities.json'); }

ipcMain.handle('cutter:project-identity', async (_event, { token }) => {
  if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh không còn hợp lệ.');
  return serializeRegistry(async () => {
    if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh đã thay đổi trước khi cấp project ID.');
    const registryPath = identityRegistryPath();
    const registry = await loadRegistryWithRecovery(registryPath);
    const project = ensureProject(registry, activeInput.projectKey);
    await saveRegistryAtomic(registryPath, registry);
    return { projectId: project.projectId, createdAt: project.createdAt, projectName: activeInput.sourceName };
  });
});

ipcMain.handle('cutter:resolve-panel-identities', async (_event, { token, keys }) => {
  if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh không còn hợp lệ.');
  if (!Array.isArray(keys) || keys.length > 10000 || keys.some(key => typeof key !== 'string' || !key || key.length > 4000)) throw new Error('Danh sách identity key không hợp lệ.');
  return serializeRegistry(async () => {
    if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh đã thay đổi trước khi cấp Panel ID.');
    const registryPath = identityRegistryPath();
    const registry = await loadRegistryWithRecovery(registryPath);
    const project = ensureProject(registry, activeInput.projectKey);
    const identities = resolvePanelIdentities(project, keys);
    await saveRegistryAtomic(registryPath, registry);
    return { projectId: project.projectId, createdAt: project.createdAt, identities };
  });
});

function resolvePanelPath(root, relativePath) {
  const rel = String(relativePath || '');
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Tên file đầu ra không hợp lệ.');
  if (!/\.(png|jpe?g)$/i.test(rel)) throw new Error('Định dạng đầu ra không hợp lệ.');
  const outputDir = path.resolve(root);
  const destination = path.resolve(outputDir, rel);
  if (!destination.startsWith(outputDir + path.sep)) throw new Error('Đường dẫn đầu ra vượt ngoài thư mục kết quả.');
  return destination;
}

function requireStaging(token) {
  if (!activeExport || activeExport.token !== token || !activeExport.stagingDir || activeExport.outputDir) throw new Error('Workspace tạm không còn hợp lệ; hãy cắt lại ảnh.');
  return activeExport.stagingDir;
}

ipcMain.handle('cutter:write-panel', async (_event, { token, relativePath, data }) => {
  const destination = resolvePanelPath(requireStaging(token), relativePath);
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes) throw new Error('Dữ liệu ảnh đầu ra không hợp lệ.');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return { path: destination };
});

ipcMain.handle('cutter:read-staged-panel', async (_event, { token, relativePath }) => {
  const data = await fs.readFile(resolvePanelPath(requireStaging(token), relativePath));
  return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
});

ipcMain.handle('cutter:delete-staged-panel', async (_event, { token, relativePath }) => {
  const stagingRoot=path.resolve(requireStaging(token));
  const destination=resolvePanelPath(stagingRoot,relativePath);
  await fs.rm(destination,{force:true});
  let parent=path.dirname(destination);
  while(parent!==stagingRoot&&parent.startsWith(stagingRoot+path.sep)){
    try{await fs.rmdir(parent);}
    catch(error){if(error.code==='ENOENT'){parent=path.dirname(parent);continue;}if(error.code==='ENOTEMPTY'||error.code==='EEXIST')break;throw error;}
    parent=path.dirname(parent);
  }
  return { ok: true };
});

ipcMain.handle('cutter:finalize-export', async (_event, { token, outputParent, layout = 'preserve', manifest }) => {
  const stagingDir = requireStaging(token);
  if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh đã thay đổi; hãy chọn lại truyện.');
  if (!['preserve', 'flat'].includes(layout)) throw new Error('Kiểu sắp xếp folder không hợp lệ.');
  const parent = path.resolve(outputParent || activeInput.defaultOutputParent);
  await fs.mkdir(parent, { recursive: true });
  const styleLabel = activeExport.style === 'manga' ? 'Manga' : activeExport.style === 'manhwa' ? 'Manhwa' : 'Manhua';
  const stem = `${safeLabel(activeInput.sourceName)}-${styleLabel}-panels`;
  let outputDir, suffix = 1;
  while (!outputDir) {
    const candidate = path.join(parent, suffix === 1 ? stem : `${stem}-${suffix}`);
    try { await fs.mkdir(candidate, { recursive: false }); outputDir = candidate; }
    catch (error) { if (error.code === 'EEXIST') suffix++; else throw error; }
  }
  try {
    const exportedManifest = await exportStagedOutput({ stagingDir, outputDir, layout, manifest });
    activeExport.manifest = exportedManifest;
  } catch (error) {
    await fs.rm(outputDir, { recursive: true, force: true });
    throw error;
  }
  activeExport.outputDir = outputDir;
  activeExport.stagingDir = null;
  tempDirs.delete(stagingDir);
  await fs.rm(stagingDir, { recursive: true, force: true });
  return { outputDir };
});

function requireSavedExport(token) {
  if (!activeExport || activeExport.token !== token || !activeExport.outputDir || !activeExport.manifest) {
    throw new Error('Hãy lưu ảnh panel trước khi xuất AI Package.');
  }
  return activeExport;
}

function resolveExportedPanel(exportDir, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  const parts = rel.split('/');
  if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Đường dẫn panel trong Manifest không an toàn.');
  }
  const absolute = path.resolve(exportDir, ...parts);
  if (!absolute.startsWith(path.resolve(exportDir) + path.sep)) throw new Error('Đường dẫn panel vượt ngoài folder kết quả.');
  return absolute;
}

ipcMain.handle('cutter:read-exported-panel', async (_event, { token, relativePath }) => {
  const saved = requireSavedExport(token);
  const data = await fs.readFile(resolveExportedPanel(saved.outputDir, relativePath));
  return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
});

ipcMain.handle('cutter:export-ai-package', async (_event, { token, sheets }) => {
  const saved = requireSavedExport(token);
  if (!Array.isArray(sheets) || !sheets.length || sheets.length > 1000) throw new Error('Danh sách Contact Sheet không hợp lệ.');
  const target = path.join(saved.outputDir, 'AI-Package');
  await fs.mkdir(target, { recursive: false });
  try {
    const sheetsDir = path.join(target, 'ContactSheets');
    await fs.mkdir(sheetsDir);
    const sheetRecords = [];
    const layoutRecords = [];
    const chapterByUuid = new Map();
    const panelByUuid = new Map(saved.manifest.panels.map(panel => [panel.uuid, panel]));
    const seenUuids = new Set();
    const expectedUuids = saved.manifest.panels.map(panel => panel.uuid);
    const actualUuids = [];
    let totalBytes = 0;
    for (let i = 0; i < sheets.length; i++) {
      const item = sheets[i];
      const ext = item?.format === 'png' ? 'png' : item?.format === 'jpg' ? 'jpg' : null;
      if (!ext || typeof item.chapter_id !== 'string' || !item.chapter_id || !Number.isInteger(item.chapter_index) || item.chapter_index < 1 || !Number.isInteger(item.sheet_index) || item.sheet_index < 1 || !Array.isArray(item.panel_uuids) || !item.panel_uuids.length || !Array.isArray(item.layout_panels) || item.layout_panels.length !== item.panel_uuids.length) throw new Error('Dữ liệu Contact Sheet không hợp lệ.');
      const bytes = item.data instanceof ArrayBuffer ? Buffer.from(item.data) : ArrayBuffer.isView(item.data) ? Buffer.from(item.data.buffer, item.data.byteOffset, item.data.byteLength) : null;
      if (!bytes || !bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error(`Contact Sheet ${i + 1} rỗng hoặc vượt quá 30 MB.`);
      totalBytes += bytes.length;
      if (totalBytes > 500 * 1024 * 1024) throw new Error('AI Package vượt giới hạn 500 MB. Hãy giảm số panel mỗi sheet hoặc chọn JPEG.');
      const chapterDir = `Chapter_${String(item.chapter_index).padStart(3, '0')}_${safeLabel(item.chapter_id)}`;
      const chapterSheetDir = path.join(sheetsDir, chapterDir);
      await fs.mkdir(chapterSheetDir, { recursive: true });
      const name = `sheet_${String(item.sheet_index).padStart(3, '0')}.${ext}`;
      const relativeSheetPath = `ContactSheets/${chapterDir}/${name}`;
      await fs.writeFile(path.join(chapterSheetDir, name), bytes, { flag: 'wx' });
      const groupUuids = [...item.panel_uuids];
      for (const uuid of groupUuids) {
        if (!panelByUuid.has(uuid)) throw new Error(`Contact Sheet tham chiếu UUID không tồn tại: ${uuid}`);
        if (seenUuids.has(uuid)) throw new Error(`UUID xuất hiện lặp trong Contact Sheets: ${uuid}`);
        seenUuids.add(uuid); actualUuids.push(uuid); chapterByUuid.set(uuid, item.chapter_id);
      }
      if (item.layout_panels.some((entry, index) => entry.uuid !== groupUuids[index] || entry.chapter_id !== item.chapter_id)) throw new Error(`Layout không khớp UUID/chapter ở sheet ${name}.`);
      sheetRecords.push({ file: relativeSheetPath, panel_uuids: groupUuids });
      layoutRecords.push({ sheet_id: `sheet_${String(item.sheet_index).padStart(3, '0')}`, chapter_id: item.chapter_id, file: relativeSheetPath, panel_count: groupUuids.length, panels: item.layout_panels });
    }
    if (actualUuids.length !== expectedUuids.length || expectedUuids.some((uuid, index) => actualUuids[index] !== uuid)) throw new Error('Contact Sheets không bảo toàn đầy đủ thứ tự/định danh panel trong Manifest.');
    const panelRecords = saved.manifest.panels.map(panel => {
      const normalized = String(panel.file).replace(/\\/g, '/');
      resolveExportedPanel(saved.outputDir, normalized);
      return {
        panel_id: panel.id,
        uuid: panel.uuid,
        chapter_id: chapterByUuid.get(panel.uuid) || (normalized.includes('/') ? normalized.split('/')[0] : null),
        page_id: panel.source_page ?? null,
        reading_order: panel.order,
        image_path: `../${normalized}`,
      };
    });
    const mapping = {
      schema_version: '1.0',
      project: saved.manifest.project,
      manifest_path: '../manifest.json',
      contact_sheets: sheetRecords,
      panels: panelRecords,
    };
    const contactSheetLayout = { algorithm: 'ASL', version: '1.0.0', canvas_width: 2400, reading_direction: saved.manifest.source.reading_direction || 'top_to_bottom', sheets: layoutRecords };
    await fs.writeFile(path.join(target, 'PanelMapping.json'), `${JSON.stringify(mapping, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.writeFile(path.join(target, 'ContactSheetLayout.json'), `${JSON.stringify(contactSheetLayout, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.writeFile(path.join(target, 'README.txt'), 'AI Package: ContactSheets được chia theo chapter, chỉ dùng để xem tổng quan. Panel có nhãn XEM ẢNH GỐC có thumbnail quá hẹp hoặc nhỏ để đọc thoại; hãy mở ảnh gốc theo image_path trong PanelMapping.json khi cần chi tiết. UUID/Panel ID và Manifest không bị thay đổi.\n', { encoding: 'utf8', flag: 'wx' });
    return { path: target, panelCount: panelRecords.length, sheetCount: sheetRecords.length };
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
});

ipcMain.handle('cutter:open-output', async (_event, { token }) => {
  if (!activeExport || activeExport.token !== token || !activeExport.outputDir) return { ok: false, error: 'Chưa có folder kết quả đã lưu.' };
  const error = await shell.openPath(activeExport.outputDir);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('cutter:get-detector-assets', async () => {
  if (!detectorAssets) {
    const modelPath = app.isPackaged ? path.join(process.resourcesPath, 'manga-panel-detector.onnx') : path.join(app.getAppPath(), 'resources', 'manga-panel-detector.onnx');
    const wasmPath = app.isPackaged
      ? path.join(process.resourcesPath, 'ort-wasm-simd-threaded.wasm')
      : path.join(app.getAppPath(), 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.wasm');
    const [model, wasm] = await Promise.all([fs.readFile(modelPath), fs.readFile(wasmPath)]);
    detectorAssets = {
      model: model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength),
      wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    };
  }
  return detectorAssets;
});
