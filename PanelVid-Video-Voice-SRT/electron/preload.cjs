const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('panelVid', {
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  saveBlobAudio: (payload) => ipcRenderer.invoke('app:save-blob-audio', payload),
  exportVideo: (payload) => ipcRenderer.invoke('app:export', payload),
  exportToPath: (payload) => ipcRenderer.invoke('app:export-to-path', payload),
  pickDir: () => ipcRenderer.invoke('app:pick-dir'),
  generateVoice: (payload) => ipcRenderer.invoke('app:tts', payload),
  resumeVoice: (payload) => ipcRenderer.invoke('app:tts-resume', payload),
  cancelVoice: () => ipcRenderer.invoke('app:cancel-voice'),
  cancelRender: () => ipcRenderer.invoke('app:cancel-render'),
  saveVoiceAudio: (payload) => ipcRenderer.invoke('app:voice-save-as', payload),
  getVoiceFailInfo: () => ipcRenderer.invoke('app:tts-fail-info'),
  pythonReady: () => ipcRenderer.invoke('app:python-ready'),
  chatterboxReady: () => ipcRenderer.invoke('app:chatterbox-ready'),
  vieneuReady: () => ipcRenderer.invoke('app:vieneu-ready'),
  pickVoiceRef: () => ipcRenderer.invoke('app:pick-voice-ref'),
  listEdgeVoices: () => ipcRenderer.invoke('app:edge-voices'),
  previewVoiceCue: (payload) => ipcRenderer.invoke('app:voice-preview', payload),
  saveVoiceCues: (payload) => ipcRenderer.invoke('app:voice-cues-save', payload),
  audioInfo: (payload) => ipcRenderer.invoke('app:audio-info', payload),
  fileExists: (payload) => ipcRenderer.invoke('app:file-exists', payload),
  stashVoice: (payload) => ipcRenderer.invoke('app:stash-voice', payload),
  unstashVoice: (payload) => ipcRenderer.invoke('app:unstash-voice', payload),
  cloneTest: (payload) => ipcRenderer.invoke('app:clone-test', payload),
  saveCloneTest: () => ipcRenderer.invoke('app:clone-test-save'),
  voiceLibList: () => ipcRenderer.invoke('app:voice-lib-list'),
  voiceLibAdd: (payload) => ipcRenderer.invoke('app:voice-lib-add', payload),
  voiceLibRemove: (payload) => ipcRenderer.invoke('app:voice-lib-remove', payload),
  jobsCreate: (payload) => ipcRenderer.invoke('app:jobs-create', payload),
  jobsSaveImage: (payload) => ipcRenderer.invoke('app:jobs-save-image', payload),
  jobsFinalize: (payload) => ipcRenderer.invoke('app:jobs-finalize', payload),
  jobsList: () => ipcRenderer.invoke('app:jobs-list'),
  jobsReadImage: (payload) => ipcRenderer.invoke('app:jobs-read-image', payload),
  jobsUpdate: (payload) => ipcRenderer.invoke('app:jobs-update', payload),
  jobsRemove: (payload) => ipcRenderer.invoke('app:jobs-remove', payload),
  onVoiceProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('app:tts-progress', handler);
    return () => ipcRenderer.removeListener('app:tts-progress', handler);
  },
  ffmpegReady: () => ipcRenderer.invoke('app:ffmpeg-ready'),
  pickVideoFiles: () => ipcRenderer.invoke('app:pick-videos'),
  probeFiles: (payload) => ipcRenderer.invoke('app:probe-videos', payload),
  concatVideos: (payload) => ipcRenderer.invoke('app:concat', payload),
  onConcatProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('app:concat-progress', handler);
    return () => ipcRenderer.removeListener('app:concat-progress', handler);
  },
  onExportProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('app:export-progress', handler);
    return () => ipcRenderer.removeListener('app:export-progress', handler);
  },
});
