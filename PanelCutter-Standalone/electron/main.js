import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ensureProject, resolvePanelIdentities } from './identity-registry.js';
import { remapManifestPaths, validateManifest } from '../src/manifest-core.js';

const require = createRequire(import.meta.url);
const { path7za } = require('7zip-bin');
const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_EXT = /\.(jpe?g|png|webp|bmp)$/i;
let mainWindow;
let activeInput = null;
let activeExport = null;
const tempDirs = new Set();
let detectorAssets;

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

async function loadIdentityRegistry() {
  const registryPath = path.join(app.getPath('userData'), 'panel-identities.json');
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    if (parsed?.schema_version !== 1 || !parsed.projects || typeof parsed.projects !== 'object') throw new Error('Registry schema không hợp lệ.');
    return { registryPath, registry: parsed };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Không đọc được registry Panel ID: ${error.message}`);
    return { registryPath, registry: { schema_version: 1, projects: {} } };
  }
}

async function saveIdentityRegistry(registryPath, registry) {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  const temporary = `${registryPath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, registryPath);
}

ipcMain.handle('cutter:project-identity', async (_event, { token }) => {
  if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh không còn hợp lệ.');
  const { registryPath, registry } = await loadIdentityRegistry();
  const project = ensureProject(registry, activeInput.projectKey);
  await saveIdentityRegistry(registryPath, registry);
  return { projectId: project.projectId, createdAt: project.createdAt, projectName: activeInput.sourceName };
});

ipcMain.handle('cutter:resolve-panel-identities', async (_event, { token, keys }) => {
  if (!activeInput || token !== activeInput.token) throw new Error('Nguồn ảnh không còn hợp lệ.');
  if (!Array.isArray(keys) || keys.length > 10000 || keys.some(key => typeof key !== 'string' || !key || key.length > 4000)) throw new Error('Danh sách identity key không hợp lệ.');
  const { registryPath, registry } = await loadIdentityRegistry();
  const project = ensureProject(registry, activeInput.projectKey);
  const identities = resolvePanelIdentities(project, keys);
  await saveIdentityRegistry(registryPath, registry);
  return { projectId: project.projectId, createdAt: project.createdAt, identities };
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
  if (!manifest || manifest.schema_version !== '1.0' || !Array.isArray(manifest.panels) || !manifest.project?.project_id) throw new Error('Manifest thiếu hoặc sai schema. Không thể hoàn tất xuất.');
  const ids = new Set(), orders = new Set();
  for (const [index, panel] of manifest.panels.entries()) {
    if (!panel.id || ids.has(panel.id) || !panel.uuid) throw new Error(`Panel ID thiếu hoặc trùng tại vị trí ${index + 1}.`);
    ids.add(panel.id);
    if (!Number.isInteger(panel.order) || panel.order < 1 || orders.has(panel.order)) throw new Error(`Thứ tự panel sai hoặc trùng tại vị trí ${index + 1}.`);
    orders.add(panel.order);
    if (!Number.isInteger(panel.width) || panel.width < 1 || !Number.isInteger(panel.height) || panel.height < 1) throw new Error(`Kích thước panel không hợp lệ tại vị trí ${index + 1}.`);
    resolvePanelPath(stagingDir, panel.file);
  }
  if ([...orders].sort((a,b)=>a-b).some((order,index)=>order!==index+1)) throw new Error('Thứ tự panel phải liên tục từ 1.');
  const stagedImages = await walkImages(stagingDir);
  const stagedPaths = new Set(stagedImages.map(file => file.relativePath.replace(/\\/g, '/')));
  const manifestPaths = manifest.panels.map(panel => panel.file.replace(/\\/g, '/'));
  if (new Set(manifestPaths).size !== manifestPaths.length) throw new Error('Một file ảnh được tham chiếu bởi nhiều panel trong manifest.');
  if (stagedPaths.size !== manifestPaths.length || manifestPaths.some(file => !stagedPaths.has(file))) throw new Error('Manifest không khớp đầy đủ với ảnh trong vùng tạm; chưa hoàn tất xuất.');
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
    const exportedPaths = new Map();
    if (layout === 'preserve') {
      const entries = await fs.readdir(stagingDir, { withFileTypes: true });
      for (const entry of entries) {
        const source = path.join(stagingDir, entry.name), destination = path.join(outputDir, entry.name);
        if (entry.isDirectory()) await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
        else await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      }
      for (const panel of manifest.panels) exportedPaths.set(panel.file.replace(/\\/g, '/'), panel.file.replace(/\\/g, '/'));
    } else {
      const files = await walkImages(stagingDir);
      for (let index = 0; index < files.length; index++) {
        const source = files[index].abs;
        const relative = files[index].relativePath.split(/[\\/]/).map(part => safeLabel(part)).join('__');
        const outputName = `${String(index + 1).padStart(6, '0')}__${relative}`;
        const destination = path.join(outputDir, outputName);
        await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
        exportedPaths.set(files[index].relativePath.replace(/\\/g, '/'), outputName);
      }
    }
    const exportedManifest = remapManifestPaths(manifest, exportedPaths);
    const validation = validateManifest(exportedManifest);
    if (!validation.valid) throw new Error(`Manifest không hợp lệ: ${validation.errors.join(' ')}`);
    for (const panel of exportedManifest.panels) {
      const diskPath = path.resolve(outputDir, ...panel.file.split('/'));
      if (!diskPath.startsWith(path.resolve(outputDir) + path.sep)) throw new Error(`Đường dẫn manifest vượt ngoài thư mục xuất: ${panel.file}`);
      const stat = await fs.stat(diskPath);
      if (!stat.isFile() || stat.size === 0) throw new Error(`Ảnh panel thiếu hoặc rỗng: ${panel.file}`);
    }
    const manifestText = `${JSON.stringify(exportedManifest, null, 2)}\n`;
    JSON.parse(manifestText);
    await fs.writeFile(path.join(outputDir, 'manifest.json'), manifestText, { encoding: 'utf8', flag: 'wx' });
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
