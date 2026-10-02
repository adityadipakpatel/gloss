// Gloss options page: API key, answer settings and reference sources.
import { MODELS, describeError, testConnection } from './lib/api.js';
import { getSettings, saveApiKey, saveSettings } from './lib/store.js';

const $ = (id) => document.getElementById(id);

function setStatus(node, text, kind = '') {
  node.textContent = text;
  node.dataset.kind = kind;
}

// --- API key ---------------------------------------------------------------

const keyInput = $('api-key');
const keyStatus = $('key-status');

async function saveKey() {
  const key = keyInput.value.trim();
  await saveApiKey(key);
  setStatus(keyStatus, key ? 'Key saved.' : 'Key removed.', 'ok');
  return key;
}

$('save-key').addEventListener('click', saveKey);
$('toggle-key').addEventListener('click', (event) => {
  const reveal = keyInput.type === 'password';
  keyInput.type = reveal ? 'text' : 'password';
  event.target.textContent = reveal ? 'Hide' : 'Show';
});

// Saves whatever is in the field, then makes one tiny request with it.
$('test-key').addEventListener('click', async (event) => {
  const key = await saveKey();
  if (!key) {
    setStatus(keyStatus, 'Enter an API key first.', 'error');
    return;
  }
  event.target.disabled = true;
  setStatus(keyStatus, 'Testing…');
  try {
    await testConnection(key, modelSelect.value);
    setStatus(keyStatus, 'Connection works. Key saved.', 'ok');
  } catch (err) {
    setStatus(keyStatus, describeError(err).message, 'error');
  } finally {
    event.target.disabled = false;
  }
});

// --- Answer settings -------------------------------------------------------

const modelSelect = $('model');
const lengthSelect = $('length');

for (const [id, { label }] of Object.entries(MODELS)) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = label;
  modelSelect.append(option);
}

async function saveAnswerSettings() {
  await saveSettings({ model: modelSelect.value, length: lengthSelect.value });
  setStatus($('settings-status'), 'Saved.', 'ok');
}
modelSelect.addEventListener('change', saveAnswerSettings);
lengthSelect.addEventListener('change', saveAnswerSettings);

// Shortcuts are managed by Chrome; show the current one and link to where it's changed.
chrome.commands.getAll().then((commands) => {
  const command = commands.find((c) => c.name === 'ask-gloss');
  $('shortcut').textContent = command?.shortcut || 'not set';
});
$('change-shortcut').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// --- Startup ---------------------------------------------------------------

const settings = await getSettings();
keyInput.value = settings.apiKey;
modelSelect.value = settings.model;
lengthSelect.value = settings.length;
