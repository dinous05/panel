import { contextBridge, ipcRenderer } from 'electron';
import type { PanelVidAdapterApi } from '../shared/types';

const api: PanelVidAdapterApi = {
  chooseManifest: () => ipcRenderer.invoke('import:manifest'),
  choosePanelFolder: () => ipcRenderer.invoke('import:panel-folder'),
  chooseAnalysisFiles: () => ipcRenderer.invoke('import:analysis'),
  chooseBatchReport: () => ipcRenderer.invoke('import:batch-report'),
  buildMapping: (manifest, analyses) => ipcRenderer.invoke('mapping:build', manifest, analyses),
  loadPanelPreview: (manifestFile) => ipcRenderer.invoke('mapping:preview-image', manifestFile),
  chooseExportFolder: () => ipcRenderer.invoke('export:choose-folder'),
  exportPackage: (mapping, document, outputParent) => ipcRenderer.invoke('export:package', mapping, document, outputParent),
  openExportFolder: (folderPath) => ipcRenderer.invoke('export:open-folder', folderPath),
  onExportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  }
};

contextBridge.exposeInMainWorld('panelVidAdapter', api);
