/**
 * AI反馈模块 - 支持多后端
 * 支持 DeepSeek / OpenAI / Ollama / 自定义 OpenAI 兼容接口
 */

const { getRealtimePrompt, getReportPrompt, getMemoryExtractionPrompt } = require('./prompts');

// 各后端的 API 配置
const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions'
};

/**
 * 发送请求到 OpenAI 兼容接口
 */
async function callAPI(endpoint, apiKey, model, messages, maxTokens = 200) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 获取endpoint和配置
 */
function getProviderConfig(settings) {
  const { provider, apiKey, model, ollamaUrl, customEndpoint, customModel } = settings;

  switch (provider) {
    case 'deepseek':
      return {
        endpoint: PROVIDER_ENDPOINTS.deepseek,
        apiKey,
        model: model || 'deepseek-chat'
      };
    case 'openai':
      return {
        endpoint: PROVIDER_ENDPOINTS.openai,
        apiKey,
        model: model || 'gpt-4o-mini'
      };
    case 'deepseek':
      return {
        endpoint: PROVIDER_ENDPOINTS.deepseek,
        apiKey,
        model: model || 'deepseek-chat'
      };
    case 'ollama':
      return {
        endpoint: `${ollamaUrl || 'http://localhost:11434'}/v1/chat/completions`,
        apiKey: 'ollama', // Ollama 不需要真实key但接口需要这个字段
        model: model || 'qwen2.5:7b'
      };
    case 'custom':
      return {
        endpoint: customEndpoint,
        apiKey,
        model: customModel || model
      };
    default:
      throw new Error(`未知的 provider: ${provider}`);
  }
}

/**
 * 发送实时反馈请求
 * @param {string} text - 当前累积文本
 * @param {Object} settings - 用户设置
 * @returns {string} 反馈HTML
 */
async function sendFeedback(text, settings, customPrompt, context) {
  const config = getProviderConfig(settings);
  const prompt = getRealtimePrompt(text, context, customPrompt);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 150);
  return result;
}

/**
 * 发送结束报告请求
 * @param {string} fullText - 完整文本
 * @param {Object} stats - 统计数据
 * @param {Object} settings - 用户设置
 * @returns {string} 报告文本
 */
async function sendReport(fullText, stats, settings, customPrompt, longTermProfile) {
  const config = getProviderConfig(settings);
  const prompt = getReportPrompt(fullText, stats, customPrompt, longTermProfile);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 8192);
  return result;
}

function parseMemoryJSON(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('记忆提炼未返回 JSON');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  return normalizeMemoryInsight(parsed);
}

function normalizeMemoryInsight(data) {
  const problemCategories = new Set([
    'conclusion_late', 'filler_words', 'hedging', 'vague_language', 'repetition',
    'topic_drift', 'lack_examples', 'weak_structure', 'unclear_expression', 'pacing', 'other'
  ]);
  const strengthCategories = new Set([
    'clear_conclusion', 'strong_structure', 'vivid_examples', 'strong_imagery',
    'concise_language', 'confident_tone', 'engaging_hook', 'other'
  ]);
  const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
  const clean = value => String(value || '').trim().slice(0, 300);
  const normalizeProblem = item => ({
    category: problemCategories.has(item?.category) ? item.category : 'other',
    summary: clean(item?.summary),
    evidence: clean(item?.evidence),
    confidence: clamp(item?.confidence)
  });

  return {
    mainProblem: normalizeProblem(data?.mainProblem || {}),
    patterns: (Array.isArray(data?.patterns) ? data.patterns : []).slice(0, 3).map(normalizeProblem),
    strengths: (Array.isArray(data?.strengths) ? data.strengths : []).slice(0, 3).map(item => ({
      category: strengthCategories.has(item?.category) ? item.category : 'other',
      summary: clean(item?.summary),
      evidence: clean(item?.evidence)
    })),
    recommendedDrill: {
      name: clean(data?.recommendedDrill?.name),
      instruction: clean(data?.recommendedDrill?.instruction),
      successMetric: clean(data?.recommendedDrill?.successMetric)
    }
  };
}

async function extractMemoryInsight(fullText, report, stats, settings) {
  const config = getProviderConfig(settings);
  const prompt = getMemoryExtractionPrompt(fullText, report, stats);
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];
  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 900);
  return parseMemoryJSON(result);
}

/**
 * 将AI返回的纯文本反馈格式化为HTML
 */
function formatFeedback(text) {
  // 简单处理：检测是否包含建议标记
  let html = text
    .replace(/→/g, '<span class="suggestion"> → </span>')
    .replace(/⚠️/g, '<span class="issue">⚠️</span>')
    .replace(/✓/g, '<span class="suggestion">✓</span>')
    .replace(/\n/g, '<br>');

  return html;
}

module.exports = { sendFeedback, sendReport, extractMemoryInsight, parseMemoryJSON, normalizeMemoryInsight };
