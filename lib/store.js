// Everything Gloss persists lives in chrome.storage.local (this browser only):
//   apiKey    string
//   settings  { model, length }
//   sources   [{ id, name, kind, pages, chars, tokens, active, warning }]  (metadata)
//   source:<id>  the extracted text of one source, kept apart so listing stays cheap
import { DEFAULT_MODEL, MODELS } from './api.js';

const DEFAULT_SETTINGS = { model: DEFAULT_MODEL, length: 'normal' };

// Returns { apiKey, model, length } with defaults filled in.
export async function getSettings() {
  const { apiKey = '', settings = {} } = await chrome.storage.local.get(['apiKey', 'settings']);
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (!MODELS[merged.model]) merged.model = DEFAULT_MODEL;
  return { apiKey, ...merged };
}

export async function saveApiKey(apiKey) {
  await chrome.storage.local.set({ apiKey });
}

export async function saveSettings(patch) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
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
