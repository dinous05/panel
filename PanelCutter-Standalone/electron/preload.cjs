const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelCutter', {
  pickArchive: () => ipcRenderer.invoke('cutter:pick-archive'),
  pickFolder: () => ipcRenderer.invoke('cutter:pick-folder'),
  chooseOutputParent: () => ipcRenderer.invoke('cutter:choose-output-parent'),
  beginStaging: (payload) => ipcRenderer.invoke('cutter:begin-staging', payload),
  readImage: (payload) => ipcRenderer.invoke('cutter:read-image', payload),
  getProjectIdentity: (payload) => ipcRenderer.invoke('cutter:project-identity', payload),
  resolvePanelIdentities: (payload) => ipcRenderer.invoke('cutter:resolve-panel-identities', payload),
  writePanel: (payload) => ipcRenderer.invoke('cutter:write-panel', payload),
  readStagedPanel: (payload) => ipcRenderer.invoke('cutter:read-staged-panel', payload),
  deleteStagedPanel: (payload) => ipcRenderer.invoke('cutter:delete-staged-panel', payload),
  finalizeExport: (payload) => ipcRenderer.invoke('cutter:finalize-export', payload),
  readExportedPanel: (payload) => ipcRenderer.invoke('cutter:read-exported-panel', payload),
  exportAiPackage: (payload) => ipcRenderer.invoke('cutter:export-ai-package', payload),
  openOutput: (payload) => ipcRenderer.invoke('cutter:open-output', payload),
  getDetectorAssets: () => ipcRenderer.invoke('cutter:get-detector-assets'),
});
