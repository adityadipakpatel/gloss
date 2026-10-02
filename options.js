// Gloss options page: API key, answer settings and reference sources.
import { getSettings, saveApiKey } from './lib/store.js';

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

// --- Startup ---------------------------------------------------------------

const settings = await getSettings();
keyInput.value = settings.apiKey;
