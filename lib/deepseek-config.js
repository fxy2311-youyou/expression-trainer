const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

// These are the legacy model values previously written by this application.
const LEGACY_APP_MODELS = new Set([
  'deepseek-chat',
  'deepseek-coder'
]);

const V4_MODELS = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro'
]);

/**
 * Keep existing app-generated DeepSeek settings compatible with the current
 * model identifiers. Unknown values are not changed by this migration.
 */
function normalizeDeepSeekSettings(settings) {
  if (!settings || typeof settings !== 'object' || settings.provider !== 'deepseek') {
    return settings;
  }

  if (settings.model && !LEGACY_APP_MODELS.has(settings.model)) {
    return settings;
  }

  return {
    ...settings,
    model: DEFAULT_DEEPSEEK_MODEL
  };
}

/**
 * The app historically used deepseek-chat, which maps to non-thinking mode.
 * Preserve that low-latency behavior when using the new V4 model names.
 */
function getDeepSeekRequestBody(model) {
  return V4_MODELS.has(model)
    ? { thinking: { type: 'disabled' } }
    : {};
}

module.exports = {
  DEFAULT_DEEPSEEK_MODEL,
  normalizeDeepSeekSettings,
  getDeepSeekRequestBody
};
