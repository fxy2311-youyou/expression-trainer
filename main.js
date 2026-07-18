const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { initASR, feedAudio, stopRecognition } = require('./lib/asr');
const { loadLexicon, analyzeText } = require('./lib/lexicon');
const { sendFeedback, sendReport, testConnection } = require('./lib/ai-feedback');

// 覆盖应用显示名称（菜单栏、Dock、任务栏、窗口标题）
app.setName('宇宙无敌表达训练');

let mainWindow;
let settingsWindow;
let promptEditorWindow;
let asrReady = false;

// Custom prompt 文件路径
function getCustomPromptPath() {
  return path.join(app.getPath('userData'), 'custom-prompt.json');
}

function loadCustomPrompt() {
  const p = getCustomPromptPath();
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch(e) { return null; }
  }
  return null;
}

function saveCustomPrompt(data) {
  fs.writeFileSync(getCustomPromptPath(), JSON.stringify(data, null, 2));
}

// 各 Provider 的默认配置
const DEFAULT_PROVIDER_CONFIGS = {
  openai: { apiKey: '', model: 'gpt-4o-mini' },
  deepseek: { apiKey: '', model: 'deepseek-chat' },
  ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
  custom: { apiKey: '', baseUrl: '', model: '' }
};

// 设置文件路径
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    // 兼容旧版扁平结构 → 迁移到 per-provider 结构
    if (!raw.providers) {
      const migrated = {
        provider: raw.provider || 'deepseek',
        providers: {
          openai: { ...DEFAULT_PROVIDER_CONFIGS.openai },
          deepseek: { ...DEFAULT_PROVIDER_CONFIGS.deepseek },
          ollama: { ...DEFAULT_PROVIDER_CONFIGS.ollama },
          custom: { ...DEFAULT_PROVIDER_CONFIGS.custom }
        }
      };
      // 将旧字段迁移到对应 provider
      const p = migrated.provider;
      if (raw.apiKey) migrated.providers[p].apiKey = raw.apiKey;
      if (raw.model) migrated.providers[p].model = raw.model;
      if (raw.ollamaUrl) migrated.providers.ollama.ollamaUrl = raw.ollamaUrl;
      if (raw.customEndpoint) migrated.providers.custom.baseUrl = raw.customEndpoint;
      if (raw.customModel) migrated.providers.custom.model = raw.customModel;
      saveSettings(migrated);
      return migrated;
    }
    // 确保每个 provider 都有完整的默认字段
    for (const key of Object.keys(DEFAULT_PROVIDER_CONFIGS)) {
      if (!raw.providers[key]) {
        raw.providers[key] = { ...DEFAULT_PROVIDER_CONFIGS[key] };
      } else {
        raw.providers[key] = { ...DEFAULT_PROVIDER_CONFIGS[key], ...raw.providers[key] };
      }
    }
    return raw;
  }
  return {
    provider: 'deepseek',
    providers: JSON.parse(JSON.stringify(DEFAULT_PROVIDER_CONFIGS))
  };
}

function saveSettings(settings) {
  const settingsPath = getSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/** 获取当前选中 provider 的配置 */
function getCurrentProviderSettings(settings) {
  const config = settings.providers[settings.provider];
  return config || DEFAULT_PROVIDER_CONFIGS[settings.provider] || {};
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#000000',
    title: '宇宙无敌表达训练',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setFullScreenable(true);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createPromptEditorWindow() {
  if (promptEditorWindow) {
    promptEditorWindow.focus();
    return;
  }

  promptEditorWindow = new BrowserWindow({
    width: 720,
    height: 700,
    resizable: true,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  promptEditorWindow.loadFile(path.join(__dirname, 'src', 'prompt-editor.html'));

  promptEditorWindow.on('closed', () => {
    promptEditorWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: false,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  // macOS 需要显式创建应用菜单，否则菜单栏显示默认的 "Electron"
  // Windows/Linux 上此菜单同样适用，macOS 专属角色（hide/hideOthers）会自动生效
  const appMenuTemplate = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate));

  // 加载词库
  loadLexicon();

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// 设置相关
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  return { success: true };
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

// Prompt编辑器相关
ipcMain.handle('open-prompt-editor', () => {
  createPromptEditorWindow();
});

ipcMain.handle('get-custom-prompt', () => {
  return loadCustomPrompt();
});

ipcMain.handle('save-custom-prompt', (event, data) => {
  saveCustomPrompt(data);
  return { success: true };
});

ipcMain.handle('close-current-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

// 语音识别相关 - Web Audio方案
ipcMain.handle('init-asr', async () => {
  try {
    await initASR();
    asrReady = true;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 接收渲染进程发来的音频数据（sampleRate 为实际采集率，由 sherpa 内部重采样）
ipcMain.handle('feed-audio', (event, samplesArray, sampleRate) => {
  if (!asrReady) return null;
  const samples = new Float32Array(samplesArray);
  const result = feedAudio(samples, sampleRate);
  return result; // { text, isFinal } or null
});

ipcMain.handle('stop-asr', () => {
  const finalText = stopRecognition();
  asrReady = false;
  return { success: true, finalText };
});

// LLM 连通性测试
ipcMain.handle('test-llm-connection', async (event, settings) => {
  const providerConfig = getCurrentProviderSettings(settings);
  return await testConnection({ ...settings, ...providerConfig });
});

// 词库分析
ipcMain.handle('analyze-text', (event, text) => {
  return analyzeText(text);
});

// 文件保存
ipcMain.handle('save-file', async (event, content, filename) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存报告',
    defaultPath: path.join(app.getPath('desktop'), filename),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

// AI反馈（传入customPrompt）
ipcMain.handle('get-realtime-feedback', async (event, text) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  try {
    const feedback = await sendFeedback(text, { ...settings, ...providerConfig }, customPrompt);
    return { success: true, feedback };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-final-report', async (event, { fullText, stats }) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  try {
    const report = await sendReport(fullText, stats, { ...settings, ...providerConfig }, customPrompt);
    return { success: true, report };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
