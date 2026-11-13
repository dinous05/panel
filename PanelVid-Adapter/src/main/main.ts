import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPanelMapping, loadPanelImageData } from '../shared/panel-mapping';
import { parseJsonText, readAnalysisSummary, readBatchReportSummary, readManifestSummary } from '../shared/import-data';
import { countImagesInFolder } from '../shared/image-files';
import { exportPackageToDirectory } from './export-package';
import type { AnalysisDocument, ExportDestination, ExportProgress, ExportResult, ImportedAnalysis, ImportResult, ManifestDocument, PreviewImageData, MappingResult } from '../shared/types';
import type { LogicalPageDocument } from '../shared/logical-pages';

const here = path.dirname(fileURLToPath(import.meta.url));
let selectedPanelFolderPath: string | null = null;
let selectedExportParentPath: string | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    backgroundColor: '#0b1110',
    title: 'PanelVid Adapter',
    webPreferences: {
      preload: path.join(here, 'preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://127.0.0.1:5173' : null);
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
      .then(() => console.info(`[PanelVid Adapter] Renderer loaded from ${devServerUrl}`))
      .catch(error => console.error(`[PanelVid Adapter] Could not load dev server ${devServerUrl}:`, error));
  } else {
    const rendererPath = path.join(here, '../dist/index.html');
    void win.loadFile(rendererPath)
      .then(() => console.info(`[PanelVid Adapter] Renderer loaded from ${rendererPath}`))
      .catch(error => console.error(`[PanelVid Adapter] Could not load production renderer ${rendererPath}:`, error));
  }
}

function failure<T>(error: unknown): ImportResult<T> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

ipcMain.handle('import:manifest', async (): Promise<ImportResult<Awaited<ReturnType<typeof readManifestSummary>> & { data: ManifestDocument }>> => {
  const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, error: 'Đã hủy chọn file.' };
  try {
    const filePath = selected.filePaths[0];
    const value = parseJsonText(await readFile(filePath, 'utf8'), path.basename(filePath));
    const summary = readManifestSummary(value, filePath);
    return { ok: true, data: { ...summary, data: value as ManifestDocument } };
  } catch (error) { return failure(error); }
});

ipcMain.handle('import:analysis', async (): Promise<ImportResult<ImportedAnalysis[]>> => {
  const selected = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selected.canceled || selected.filePaths.length === 0) return { ok: false, error: 'Chưa chọn file analysis.' };
  try {
    const summaries = await Promise.all(selected.filePaths.map(async (filePath): Promise<ImportedAnalysis> => {
      const value = parseJsonText(await readFile(filePath, 'utf8'), path.basename(filePath));
      return { ...readAnalysisSummary(value, filePath), data: value as AnalysisDocument };
    }));
    return { ok: true, data: summaries };
  } catch (error) { return failure(error); }
});

ipcMain.handle('import:batch-report', async (): Promise<ImportResult<Awaited<ReturnType<typeof readBatchReportSummary>>>> => {
  const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, error: 'Đã hủy chọn file.' };
  try {
    const filePath = selected.filePaths[0];
    const value = parseJsonText(await readFile(filePath, 'utf8'), path.basename(filePath));
    return { ok: true, data: readBatchReportSummary(value, filePath) };
  } catch (error) { return failure(error); }
});

ipcMain.handle('import:panel-folder', async (): Promise<ImportResult<{ path: string; folderName: string; imageCount: number }>> => {
  const selected = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, error: 'Đã hủy chọn thư mục.' };
  try {
    const folder = selected.filePaths[0];
    const imageCount = await countImagesInFolder(folder);
    selectedPanelFolderPath = folder;
    return { ok: true, data: { path: folder, folderName: path.basename(folder), imageCount } };
  } catch (error) { return failure(error); }
});

ipcMain.handle('mapping:build', async (_event, manifest: ManifestDocument, analyses: ImportedAnalysis[]) => {
  if (!selectedPanelFolderPath) return { ok: false, error: 'Hãy import thư mục ảnh panel trước khi chạy UUID Mapping.' };
  try {
    return { ok: true, data: await buildPanelMapping(manifest, analyses, selectedPanelFolderPath) };
  } catch (error) { return failure(error); }
});

ipcMain.handle('mapping:preview-image', async (_event, manifestFile: string): Promise<ImportResult<PreviewImageData>> => {
  if (!selectedPanelFolderPath) return { ok: false, error: 'Chưa có thư mục ảnh panel được chọn.' };
  try {
    return { ok: true, data: await loadPanelImageData(selectedPanelFolderPath, manifestFile) };
  } catch (error) { return failure(error); }
});

ipcMain.handle('export:choose-folder', async (): Promise<ImportResult<ExportDestination>> => {
  const selected = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, error: 'Đã hủy chọn thư mục export.' };
  selectedExportParentPath = path.resolve(selected.filePaths[0]);
  return { ok: true, data: { path: selectedExportParentPath, folderName: path.basename(selectedExportParentPath) } };
});

ipcMain.handle('export:package', async (event, mapping: MappingResult, document: LogicalPageDocument, outputParent: string): Promise<ImportResult<ExportResult>> => {
  if (!selectedPanelFolderPath) return { ok: false, error: 'Chưa chọn thư mục ảnh nguồn.' };
  if (!selectedExportParentPath || path.resolve(outputParent) !== selectedExportParentPath) return { ok: false, error: 'Hãy chọn lại thư mục đầu ra trước khi export.' };
  if (path.resolve(mapping.imageRoot) !== path.resolve(selectedPanelFolderPath)) return { ok: false, error: 'Thư mục ảnh trong mapping không còn khớp lựa chọn hiện tại.' };
  try {
    const result = await exportPackageToDirectory(mapping, document, selectedExportParentPath, (progress: ExportProgress) => {
      if (!event.sender.isDestroyed()) event.sender.send('export:progress', progress);
    });
    return { ok: true, data: result };
  } catch (error) { return failure(error); }
});

ipcMain.handle('export:open-folder', async (_event, folderPath: string): Promise<ImportResult<null>> => {
  if (!selectedExportParentPath || !folderPath || path.resolve(path.dirname(folderPath)) !== selectedExportParentPath || path.basename(folderPath) !== 'PanelVid_Output') {
    return { ok: false, error: 'Đường dẫn package không khớp vị trí export đã chọn.' };
  }
  const error = await shell.openPath(folderPath);
  return error ? { ok: false, error } : { ok: true, data: null };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
