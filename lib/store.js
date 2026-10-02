// Everything Gloss persists lives in chrome.storage.local (this browser only):
//   apiKeys   { [provider]: key }   (older versions stored one Anthropic key as apiKey)
//   settings  { provider, models: { [provider]: modelId }, length }
//   sources   [{ id, name, kind, pages, chars, tokens, active, warning }]  (metadata)
//   source:<id>  the extracted text of one source, kept apart so listing stays cheap
import { DEFAULT_PROVIDER, PROVIDERS, defaultModel } from './providers.js';

// Returns { provider, apiKey, model, length } for the selected provider, plus every
// provider's apiKeys and models for the options page.
export async function getSettings() {
  const stored = await chrome.storage.local.get(['apiKeys', 'apiKey', 'settings']);
  const settings = stored.settings || {};
  const apiKeys = { ...stored.apiKeys };
  const models = { ...settings.models };
  // Carry over the Claude-only version's key and model.
  if (stored.apiKey && !apiKeys.anthropic) apiKeys.anthropic = stored.apiKey;
  if (settings.model && !models.anthropic) models.anthropic = settings.model;

  const provider = PROVIDERS[settings.provider]
    ? settings.provider
    : stored.apiKey
      ? 'anthropic' // existing Claude users keep working until they pick another
      : DEFAULT_PROVIDER;
  return {
    provider,
    apiKey: apiKeys[provider] || '',
    model: models[provider]?.trim() || defaultModel(provider),
    length: settings.length || 'brief',
    apiKeys,
    models,
  };
}

export async function saveApiKey(provider, key) {
  const { apiKeys = {} } = await chrome.storage.local.get('apiKeys');
  await chrome.storage.local.set({ apiKeys: { ...apiKeys, [provider]: key } });
}

export async function saveSettings(patch) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
}

export async function saveModel(provider, model) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await saveSettings({ models: { ...settings.models, [provider]: model } });
}

// --- Reference sources -----------------------------------------------------

// Rough estimate (about 4 characters per token for English text).
export const estimateTokens = (chars) => Math.ceil(chars / 4);
// Above this, every question gets slow and costly, and may not fit the model at all.
export const SOURCE_TOKEN_WARNING = 150_000;

export async function listSources() {
  const { sources = [] } = await chrome.storage.local.get('sources');
  return sources;
}

// kind is 'pdf' or 'text'. New sources start active.
export async function addSource({ name, kind, text, pages = null, warning = '' }) {
  const source = {
    id: crypto.randomUUID(),
    name,
    kind,
    pages,
    chars: text.length,
    tokens: estimateTokens(text.length),
    active: true,
    warning,
  };
  const sources = await listSources();
  await chrome.storage.local.set({
    [`source:${source.id}`]: text,
    sources: [...sources, source],
  });
  return source;
}

export async function setSourceActive(id, active) {
  const sources = await listSources();
  await chrome.storage.local.set({
    sources: sources.map((s) => (s.id === id ? { ...s, active } : s)),
  });
}

export async function deleteSource(id) {
  const sources = await listSources();
  await chrome.storage.local.set({ sources: sources.filter((s) => s.id !== id) });
  await chrome.storage.local.remove(`source:${id}`);
}

// The sources to attach to requests: [{ name, text, tokens }], in a stable order so
// the cached prompt prefix stays identical between requests.
export async function getActiveSources() {
  const active = (await listSources()).filter((s) => s.active);
  const keys = active.map((s) => `source:${s.id}`);
  const texts = await chrome.storage.local.get(keys);
  return active
    .map((s, i) => ({ name: s.name, text: texts[keys[i]] || '', tokens: s.tokens }))
    .filter((s) => s.text);
}
