import { contextBridge, ipcRenderer } from 'electron';
import type { PanelVidAdapterApi } from '../shared/types';

const api: PanelVidAdapterApi = {
  chooseManifest: () => ipcRenderer.invoke('import:manifest'),
  choosePanelFolder: () => ipcRenderer.invoke('import:panel-folder'),
  chooseAnalysisFiles: () => ipcRenderer.invoke('import:analysis'),
  chooseBatchReport: () => ipcRenderer.invoke('import:batch-report'),
  buildMapping: (manifest, analyses) => ipcRenderer.invoke('mapping:build', manifest, analyses),
  loadPanelPreview: (manifestFile) => ipcRenderer.invoke('mapping:preview-image', manifestFile)
};

contextBridge.exposeInMainWorld('panelVidAdapter', api);
