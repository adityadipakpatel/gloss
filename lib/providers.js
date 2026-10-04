// The AI providers Gloss can use. Everything except Anthropic speaks the
// OpenAI-compatible chat completions format, so those share one code path in api.js.
//
// params(model) adds provider-specific request fields. Most of them turn thinking off
// or down: a quick answer doesn't need it, and on some models thinking tokens count
// toward max_tokens, which could leave no room for the answer.

export const PROVIDERS = {
  groq: {
    label: 'Groq',
    format: 'openai',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
    note: 'Free tier available. Its per-minute token limits can be too small for large sources.',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3.8-27b'],
    vision: { supports: (model) => model === 'qwen/qwen3.8-27b', fallback: 'qwen/qwen3.8-27b' },
    contextTokens: 131_072,
    maxTokens: { first: 1024, followUp: 2048 },
    // GPT-OSS models always reason first; keep it brief and out of the response.
    // Qwen can switch reasoning off entirely.
    params: (model) => {
      if (model.includes('gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false };
      if (model.startsWith('qwen/')) return { reasoning_effort: 'none' };
      return {};
    },
  },
  gemini: {
    label: 'Google Gemini',
    format: 'openai',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    note: 'Free tier available (key from Google AI Studio). Google may use free-tier prompts to improve its products.',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'],
    vision: { supports: () => true, fallback: 'gemini-3.8-flash' },
    contextTokens: 1_000_000,
    maxTokens: { first: 1024, followUp: 2048 },
    // Gemini 3 models can't turn thinking off, and not all of them accept "minimal"
    // (gemini-3.8-flash rejects it), so use "low", which they all accept.
    // Gemini 2.5 Flash models accept "none".
    params: (model) => ({ reasoning_effort: /^gemini-2\.5-flash/.test(model) ? 'none' : 'low' }),
  },
  deepseek: {
    label: 'DeepSeek',
    format: 'openai',
    url: 'https://api.deepseek.com/chat/completions',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-…',
    note: 'Pay as you go at very low prices; there is no free tier.',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    vision: { supports: (model) => model === 'deepseek-flash', fallback: 'deepseek-flash' },
    contextTokens: 1_000_000,
    maxTokens: { first: 1024, followUp: 2048 },
    // Thinking is on by default for both models.
    params: () => ({ thinking: { type: 'disabled' } }),
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    format: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    note: 'Paid API credits. A Claude.ai subscription cannot be used.',
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5'],
    vision: { supports: () => true, fallback: 'claude-haiku-4-5-20251001' },
    contextTokens: 1_000_000,
    maxTokens: { first: 400, followUp: 800 },
    // Sonnet 5.5 can't disable thinking; "between_tools" is its lowest setting.
    params: (model) => (model === 'claude-sonnet-5-5' ? { thinking: { type: 'between_tools' } } : {}),
  },
};

export const DEFAULT_PROVIDER = 'groq';

export const defaultModel = (provider) => PROVIDERS[provider].models[0];

// Rough context window, used to catch oversized sources before sending them.
export function contextTokens(provider, model) {
  if (model.startsWith('claude-haiku')) return 200_000;
  return PROVIDERS[provider].contextTokens;
}

// The model to use when a screenshot is attached: the selected one if it can see
// images, otherwise the provider's image-capable model.
export function visionModel(provider, model) {
  const { supports, fallback } = PROVIDERS[provider].vision;
  return supports(model) ? model : fallback;
}
