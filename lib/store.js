// Everything Gloss persists lives in chrome.storage.local (this browser only):
//   apiKey    string
//   settings  { model, length }
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
