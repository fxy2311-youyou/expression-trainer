const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // Prompt编辑器
  openPromptEditor: () => ipcRenderer.invoke('open-prompt-editor'),
  getCustomPrompt: () => ipcRenderer.invoke('get-custom-prompt'),
  saveCustomPrompt: (data) => ipcRenderer.invoke('save-custom-prompt', data),
  closeWindow: () => ipcRenderer.invoke('close-current-window'),

  // 语音识别 - 使用 Web Audio 方案
  initASR: () => ipcRenderer.invoke('init-asr'),
  // 音频块是高频数据，直接发送 Float32Array，避免 Array.from 的额外拷贝。
  feedAudio: (samples) => ipcRenderer.send('feed-audio', samples),
  stopASR: () => ipcRenderer.invoke('stop-asr'),
  onASRResult: (callback) => {
    ipcRenderer.on('asr-result', (event, data) => callback(data));
  },
  onASRError: (callback) => {
    ipcRenderer.on('asr-error', (event, data) => callback(data));
  },
  removeASRListener: () => {
    ipcRenderer.removeAllListeners('asr-result');
    ipcRenderer.removeAllListeners('asr-error');
  },

  // 词库分析
  analyzeText: (text) => ipcRenderer.invoke('analyze-text', text),

  // AI反馈
  getRealtimeFeedback: (text) => ipcRenderer.invoke('get-realtime-feedback', text),
  getFinalReport: (data) => ipcRenderer.invoke('get-final-report', data),

  // 文件保存
  saveFile: (content, filename) => ipcRenderer.invoke('save-file', content, filename),
});
