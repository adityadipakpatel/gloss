// The AI providers Gloss can use. Everything except Anthropic speaks the
// OpenAI-compatible chat completions format, so those share one code path in api.js.
//
// params(model) adds provider-specific request fields. Most of them turn thinking off
// or down: a quick answer doesn't need it, and on some models thinking tokens count
// toward max_tokens, which could leave no room for the answer.

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    format: 'openai',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    note: 'Free tier available (key from Google AI Studio). Google may use free-tier prompts to improve its products.',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'],
    contextTokens: 1_000_000,
    maxTokens: { first: 1024, followUp: 2048 },
    // Gemini 3 models can't turn thinking off; "minimal" is their lowest setting.
    // Gemini 2.5 Flash models accept "none".
    params: (model) => ({ reasoning_effort: /^gemini-2\.5-flash/.test(model) ? 'none' : 'minimal' }),
  },
  groq: {
    label: 'Groq',
    format: 'openai',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
    note: 'Free tier available. Its per-minute token limits can be too small for large sources.',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    contextTokens: 131_072,
    maxTokens: { first: 1024, followUp: 2048 },
    // GPT-OSS models always reason first; keep it brief and out of the response.
    params: (model) => (model.includes('gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
  },
  deepseek: {
    label: 'DeepSeek',
    format: 'openai',
    url: 'https://api.deepseek.com/chat/completions',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-…',
    note: 'Pay as you go at very low prices; there is no free tier.',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
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
    contextTokens: 1_000_000,
    maxTokens: { first: 400, followUp: 800 },
    // Sonnet 5.5 can't disable thinking; "between_tools" is its lowest setting.
    params: (model) => (model === 'claude-sonnet-5-5' ? { thinking: { type: 'between_tools' } } : {}),
  },
};

export const DEFAULT_PROVIDER = 'gemini';

export const defaultModel = (provider) => PROVIDERS[provider].models[0];

// Rough context window, used to catch oversized sources before sending them.
export function contextTokens(provider, model) {
  if (model.startsWith('claude-haiku')) return 200_000;
  return PROVIDERS[provider].contextTokens;
}
