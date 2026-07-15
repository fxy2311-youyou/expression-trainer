// 设置页逻辑

const PROVIDER_CONFIG = {
  openai: {
    needsKey: true,
    keyHint: '在 platform.openai.com 获取',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini（推荐）' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ]
  },
  deepseek: {
    needsKey: true,
    keyHint: '在 platform.deepseek.com 获取',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat（推荐）' },
      { value: 'deepseek-coder', label: 'DeepSeek Coder' }
    ]
  },
  ollama: {
    needsKey: false,
    models: [
      { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B（推荐）' },
      { value: 'llama3.1:8b', label: 'Llama 3.1 8B' },
      { value: 'mistral:7b', label: 'Mistral 7B' }
    ]
  },
  custom: {
    needsKey: true,
    keyHint: '自定义 API Key',
    models: []
  }
};

class SettingsPage {
  constructor() {
    this.providerSelect = document.getElementById('provider');
    this.apikeyInput = document.getElementById('apikey');
    this.apikeyHint = document.getElementById('apikey-hint');
    this.modelSelect = document.getElementById('model');
    this.modelHint = document.getElementById('model-hint');
    this.ollamaUrlInput = document.getElementById('ollama-url');
    this.customBaseUrlInput = document.getElementById('custom-base-url');
    this.customModelInput = document.getElementById('custom-model');
    this.btnSave = document.getElementById('btn-save');
    this.saveSuccess = document.getElementById('save-success');

    this.groupApikey = document.getElementById('group-apikey');
    this.groupOllama = document.getElementById('group-ollama');
    this.groupCustom = document.getElementById('group-custom');
    this.groupCustomModel = document.getElementById('group-custom-model');

    this.bindEvents();
    this.loadSettings();
  }

  bindEvents() {
    this.providerSelect.addEventListener('change', () => this.onProviderChange());
    this.btnSave.addEventListener('click', () => this.save());
  }

  async loadSettings() {
    this.settings = await window.api.getSettings();

    this.providerSelect.value = this.settings.provider || 'deepseek';

    // 先填充模型列表再加载字段值
    this.onProviderChange();
  }

  /** 加载指定 provider 的配置到表单字段 */
  loadProviderFields(provider) {
    const providerConfig = this.settings?.providers?.[provider] || {};

    this.apikeyInput.value = providerConfig.apiKey || '';
    this.ollamaUrlInput.value = providerConfig.ollamaUrl || 'http://localhost:11434';
    this.customBaseUrlInput.value = providerConfig.baseUrl || '';
    this.customModelInput.value = providerConfig.customModel || '';

    // 设置模型下拉框（非 custom 模式）
    if (providerConfig.model && provider !== 'custom') {
      this.modelSelect.value = providerConfig.model;
    }
  }

  onProviderChange() {
    const provider = this.providerSelect.value;
    const config = PROVIDER_CONFIG[provider];

    // 显示/隐藏条件字段
    this.groupApikey.classList.toggle('visible', config.needsKey);
    this.groupOllama.classList.toggle('visible', provider === 'ollama');
    this.groupCustom.classList.toggle('visible', provider === 'custom');
    this.groupCustomModel.classList.toggle('visible', provider === 'custom');

    // 更新key提示
    if (config.keyHint) {
      this.apikeyHint.textContent = config.keyHint;
    }

    // 填充模型列表
    this.modelSelect.innerHTML = '';
    if (config.models.length > 0) {
      config.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        this.modelSelect.appendChild(opt);
      });
      this.modelSelect.parentElement.style.display = '';
    } else {
      this.modelSelect.parentElement.style.display = 'none';
    }

    // 切换后加载该 provider 保存的配置到表单字段
    this.loadProviderFields(provider);
  }

  async save() {
    const provider = this.providerSelect.value;

    // 隐藏上次的错误提示
    const errorEl = document.getElementById('connection-error');
    errorEl.classList.remove('show');
    errorEl.textContent = '';

    // 先获取完整 settings（包含所有 provider 的独立配置）
    const settings = await window.api.getSettings();

    // 只更新当前 provider 的配置
    settings.provider = provider;
    if (!settings.providers) {
      settings.providers = {};
    }

    if (provider === 'custom') {
      // custom 的模型名来自自定义输入框
      settings.providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.customModelInput.value.trim(),
        ollamaUrl: this.ollamaUrlInput.value.trim(),
        baseUrl: this.customBaseUrlInput.value.trim(),
        customModel: this.customModelInput.value.trim()
      };
    } else {
      settings.providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.modelSelect.value,
        ollamaUrl: this.ollamaUrlInput.value.trim(),
        baseUrl: this.customBaseUrlInput.value.trim(),
        customModel: ''
      };
    }

    await window.api.saveSettings(settings);

    // 更新缓存，让下次切换 provider 时能看到最新值
    this.settings = settings;

    // 测试连通性
    this.btnSave.textContent = '⏳ 测试连接中...';
    this.btnSave.classList.add('loading');
    const result = await window.api.testLLMConnection(settings);

    if (result.success) {
      // 连接成功 → 显示保存成功并关闭
      this.btnSave.textContent = '保存设置';
      this.btnSave.classList.remove('loading');
      this.saveSuccess.classList.add('show');
      setTimeout(() => {
        window.close();
      }, 800);
    } else {
      // 连接失败 → 显示红色错误提示，不关闭
      this.btnSave.textContent = '保存设置';
      this.btnSave.classList.remove('loading');
      errorEl.textContent = `⚠️ 大模型测试连接失败，请核对后重试!`;
      errorEl.classList.add('show');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsPage();
});
