const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_DEEPSEEK_MODEL,
  normalizeDeepSeekSettings,
  getDeepSeekRequestBody
} = require('../lib/deepseek-config');
const { sendFeedback, sendReport } = require('../lib/ai-feedback');

function captureRequests(t) {
  const originalFetch = global.fetch;
  const requests = [];

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (endpoint, options) => {
    requests.push({ endpoint, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '测试反馈' } }] })
    };
  };

  return requests;
}

test('migrates model values previously written by the app', () => {
  assert.equal(
    normalizeDeepSeekSettings({ provider: 'deepseek' }).model,
    DEFAULT_DEEPSEEK_MODEL
  );

  for (const model of ['', 'deepseek-chat', 'deepseek-coder']) {
    const original = { provider: 'deepseek', model };
    const migrated = normalizeDeepSeekSettings(original);
    assert.equal(migrated.model, DEFAULT_DEEPSEEK_MODEL);
    assert.equal(original.model, model);
  }
});

test('preserves current and manually configured model values', () => {
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro', 'custom-model']) {
    const original = { provider: 'deepseek', model };
    const snapshot = { ...original };
    assert.deepEqual(normalizeDeepSeekSettings(original), snapshot);
    assert.deepEqual(original, snapshot);
  }

  const openAI = { provider: 'openai' };
  assert.deepEqual(normalizeDeepSeekSettings(openAI), { provider: 'openai' });
  assert.equal('model' in openAI, false);
});

test('uses non-thinking mode for current V4 models only', () => {
  const nonThinking = { thinking: { type: 'disabled' } };
  assert.deepEqual(getDeepSeekRequestBody('deepseek-v4-flash'), nonThinking);
  assert.deepEqual(getDeepSeekRequestBody('deepseek-v4-pro'), nonThinking);
  assert.deepEqual(getDeepSeekRequestBody('custom-model'), {});
});

test('sends legacy DeepSeek settings as V4 non-thinking requests', async (t) => {
  const requests = captureRequests(t);

  const result = await sendFeedback('这是一段测试文本', {
    provider: 'deepseek',
    apiKey: 'test-key',
    model: 'deepseek-chat'
  });

  const request = requests[0];
  const body = request.body;
  assert.equal(result, '测试反馈');
  assert.equal(request.endpoint, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(body.model, 'deepseek-v4-flash');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 150);
});

test('uses V4 non-thinking mode for final reports', async (t) => {
  const requests = captureRequests(t);

  await sendReport('这是完整转写', {
    duration: 60,
    totalWords: 20,
    fillers: 1,
    hedges: 1,
    vagueWords: 1
  }, {
    provider: 'deepseek',
    apiKey: 'test-key',
    model: 'deepseek-v4-pro'
  });

  assert.equal(requests[0].body.model, 'deepseek-v4-pro');
  assert.deepEqual(requests[0].body.thinking, { type: 'disabled' });
  assert.equal(requests[0].body.max_tokens, 8192);
});

test('does not add thinking controls to non-DeepSeek endpoints or unknown models', async (t) => {
  const requests = captureRequests(t);
  const settingsCases = [
    { provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini' },
    { provider: 'ollama', ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
    {
      provider: 'custom',
      apiKey: 'test-key',
      customEndpoint: 'https://example.com/v1/chat/completions',
      customModel: 'custom-model'
    },
    { provider: 'deepseek', apiKey: 'test-key', model: 'future-deepseek-model' }
  ];

  for (const settings of settingsCases) {
    await sendFeedback('这是一段测试文本', settings);
  }

  assert.equal(requests.length, settingsCases.length);
  requests.forEach(request => {
    assert.equal('thinking' in request.body, false);
  });
});
