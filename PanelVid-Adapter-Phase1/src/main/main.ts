import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonText, readAnalysisSummary, readBatchReportSummary, readManifestSummary } from '../shared/import-data';
import { countImagesInFolder } from '../shared/image-files';
import type { ImportResult } from '../shared/types';

const here = path.dirname(fileURLToPath(import.meta.url));

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
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(path.join(here, '../dist/index.html'));
}

function failure<T>(error: unknown): ImportResult<T> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

ipcMain.handle('import:manifest', async (): Promise<ImportResult<ReturnType<typeof readManifestSummary>>> => {
  const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, error: 'Đã hủy chọn file.' };
  try {
    const filePath = selected.filePaths[0];
    const value = parseJsonText(await readFile(filePath, 'utf8'), path.basename(filePath));
    return { ok: true, data: readManifestSummary(value, filePath) };
  } catch (error) { return failure(error); }
});

ipcMain.handle('import:analysis', async (): Promise<ImportResult<ReturnType<typeof readAnalysisSummary>[]>> => {
  const selected = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (selected.canceled || selected.filePaths.length === 0) return { ok: false, error: 'Chưa chọn file analysis.' };
  try {
    const summaries = await Promise.all(selected.filePaths.map(async (filePath) => {
      const value = parseJsonText(await readFile(filePath, 'utf8'), path.basename(filePath));
      return readAnalysisSummary(value, filePath);
    }));
    return { ok: true, data: summaries };
  } catch (error) { return failure(error); }
});

ipcMain.handle('import:batch-report', async (): Promise<ImportResult<ReturnType<typeof readBatchReportSummary>>> => {
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
    return { ok: true, data: { path: folder, folderName: path.basename(folder), imageCount: await countImagesInFolder(folder) } };
  } catch (error) { return failure(error); }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
