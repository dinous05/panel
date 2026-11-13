import { contextBridge, ipcRenderer } from 'electron';
import type { PanelVidAdapterApi } from '../shared/types';

const api: PanelVidAdapterApi = {
  chooseManifest: () => ipcRenderer.invoke('import:manifest'),
  choosePanelFolder: () => ipcRenderer.invoke('import:panel-folder'),
  chooseAnalysisFiles: () => ipcRenderer.invoke('import:analysis'),
  chooseBatchReport: () => ipcRenderer.invoke('import:batch-report')
};

contextBridge.exposeInMainWorld('panelVidAdapter', api);
