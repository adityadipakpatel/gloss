// Gloss options page: provider, API keys, answer settings and reference sources.
import { describeError, testConnection } from './lib/api.js';
import { PROVIDERS, defaultModel } from './lib/providers.js';
import {
  SOURCE_TOKEN_WARNING,
  addSource,
  deleteSource,
  getSettings,
  listSources,
  saveApiKey,
  saveModel,
  saveSettings,
  setSourceActive,
} from './lib/store.js';

const $ = (id) => document.getElementById(id);

function setStatus(node, text, kind = '') {
  node.textContent = text;
  node.dataset.kind = kind;
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

let state = await getSettings(); // { provider, apiKeys, models, length, ... }

// --- Provider, API key and model --------------------------------------------

const providerSelect = $('provider');
const keyInput = $('api-key');
const keyStatus = $('key-status');
const modelSelect = $('model');
const customModel = $('custom-model');
const OTHER = '__other';

for (const [id, { label }] of Object.entries(PROVIDERS)) providerSelect.append(option(id, label));

// Fill the key and model fields for the selected provider.
function showProvider() {
  const provider = state.provider;
  const p = PROVIDERS[provider];
  providerSelect.value = provider;
  $('provider-note').textContent = p.note;
  $('api-key-label').textContent = `${p.label} API key`;
  $('key-link').href = p.keyUrl;
  keyInput.value = state.apiKeys[provider] || '';
  keyInput.placeholder = p.keyPlaceholder;
  setStatus(keyStatus, '');
  setStatus($('model-status'), '');

  modelSelect.replaceChildren(...p.models.map((m) => option(m, m)), option(OTHER, 'Other model ID…'));
  const model = state.models[provider]?.trim() || defaultModel(provider);
  const known = p.models.includes(model);
  modelSelect.value = known ? model : OTHER;
  customModel.value = known ? '' : model;
  customModel.hidden = known;
}

const currentModel = () =>
  (modelSelect.value === OTHER ? customModel.value.trim() : modelSelect.value) ||
  defaultModel(state.provider);

async function storeModel() {
  const model = currentModel();
  state.models = { ...state.models, [state.provider]: model };
  await saveModel(state.provider, model);
  setStatus($('model-status'), `Using ${model}.`, 'ok');
}

providerSelect.addEventListener('change', async () => {
  state.provider = providerSelect.value;
  await saveSettings({ provider: state.provider });
  showProvider();
});

modelSelect.addEventListener('change', () => {
  customModel.hidden = modelSelect.value !== OTHER;
  if (modelSelect.value === OTHER) customModel.focus();
  else storeModel();
});
customModel.addEventListener('change', () => {
  if (customModel.value.trim()) storeModel();
});

async function saveKey() {
  const key = keyInput.value.trim();
  state.apiKeys = { ...state.apiKeys, [state.provider]: key };
  await saveApiKey(state.provider, key);
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
    await testConnection(state.provider, key, currentModel());
    setStatus(keyStatus, `Connection works with ${currentModel()}. Key saved.`, 'ok');
  } catch (err) {
    setStatus(keyStatus, describeError(err).message, 'error');
  } finally {
    event.target.disabled = false;
  }
});

// --- Answer settings -------------------------------------------------------

const lengthSelect = $('length');
lengthSelect.addEventListener('change', async () => {
  await saveSettings({ length: lengthSelect.value });
  setStatus($('settings-status'), 'Saved.', 'ok');
});

// Shortcuts are managed by Chrome; show the current one and link to where it's changed.
chrome.commands.getAll().then((commands) => {
  const command = commands.find((c) => c.name === 'ask-gloss');
  $('shortcut').textContent = command?.shortcut || 'not set';
});
$('change-shortcut').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// --- Sources ---------------------------------------------------------------

const sourceStatus = $('source-status');
const number = (n) => n.toLocaleString();

function sourceRow(source) {
  const row = document.createElement('li');

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = source.active;
  toggle.title = 'Attach to questions';
  toggle.setAttribute('aria-label', `Attach ${source.name} to questions`);
  toggle.addEventListener('change', async () => {
    await setSourceActive(source.id, toggle.checked);
    renderSources();
  });

  const info = document.createElement('div');
  info.className = 'source-info';
  const name = document.createElement('strong');
  name.textContent = source.name;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = [
    source.kind === 'pdf' ? `PDF, ${number(source.pages)} pages` : 'Text',
    `${number(source.chars)} characters`,
    `about ${number(source.tokens)} tokens`,
  ].join(' · ');
  info.append(name, meta);
  if (source.warning) {
    const warning = document.createElement('span');
    warning.className = 'meta warn';
    warning.textContent = source.warning;
    info.append(warning);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${source.name}`);
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete "${source.name}"?`)) return;
    await deleteSource(source.id);
    renderSources();
  });

  row.append(toggle, info, remove);
  return row;
}

async function renderSources() {
  const sources = await listSources();
  $('source-list').replaceChildren(...sources.map(sourceRow));
  $('source-empty').hidden = sources.length > 0;

  const active = sources.filter((s) => s.active);
  const tokens = active.reduce((sum, s) => sum + s.tokens, 0);
  $('source-total').textContent = sources.length
    ? `${active.length} of ${sources.length} active, about ${number(tokens)} tokens attached to each question.`
    : '';
  const warning = $('source-warning');
  warning.hidden = tokens <= SOURCE_TOKEN_WARNING;
  warning.textContent =
    `Active sources total about ${number(tokens)} tokens, over the recommended ` +
    `${number(SOURCE_TOKEN_WARNING)}. Every question will be slower and cost more, and may exceed ` +
    "the model's context window or a free tier's limits. Turn some sources off.";
}

// Below this many characters per page, a PDF is probably scanned images.
const SCANNED_CHARS_PER_PAGE = 100;

let pdfjs = null; // loaded on first use; it's a large library

// Extracts text page by page. onProgress(pageNumber, pageCount) after each page.
async function extractPdf(file, onProgress) {
  if (!pdfjs) {
    pdfjs = await import('./lib/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
  }
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false, // extension pages can't eval
  });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join(''));
      page.cleanup();
      onProgress(n, pdf.numPages);
    }
    return { text: pages.join('\n\n').trim(), pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

async function addPdf(file) {
  const progress = $('pdf-progress');
  progress.textContent = `${file.name}: opening…`;
  let extracted;
  try {
    extracted = await extractPdf(file, (page, total) => {
      progress.textContent = `${file.name}: page ${page} of ${total}`;
    });
  } catch (err) {
    const reason = err?.name === 'PasswordException' ? 'it is password-protected' : err?.message;
    return `Couldn't read "${file.name}": ${reason || 'unknown error'}.`;
  }
  const { text, pages } = extracted;
  if (!text) {
    return `"${file.name}" has no extractable text. It looks like a scanned or image-only PDF, so it wasn't added.`;
  }
  const perPage = Math.round(text.length / pages);
  const scanned = perPage < SCANNED_CHARS_PER_PAGE;
  await addSource({
    name: file.name,
    kind: 'pdf',
    text,
    pages,
    warning: scanned
      ? `Only about ${perPage} characters per page were found. This may be a scanned PDF with little usable text.`
      : '',
  });
  return scanned ? `"${file.name}" was added, but very little text was found in it.` : null;
}

$('pdf-button').addEventListener('click', () => $('pdf-input').click());
$('pdf-input').addEventListener('change', async (event) => {
  const files = [...event.target.files];
  event.target.value = ''; // allow picking the same file again later
  if (!files.length) return;
  $('pdf-button').disabled = true;
  setStatus(sourceStatus, '');
  const problems = [];
  for (const file of files) {
    const problem = await addPdf(file);
    if (problem) problems.push(problem);
    await renderSources();
  }
  $('pdf-progress').textContent = '';
  $('pdf-button').disabled = false;
  if (problems.length) setStatus(sourceStatus, problems.join(' '), 'error');
  else setStatus(sourceStatus, files.length === 1 ? `Added "${files[0].name}".` : `Added ${files.length} PDFs.`, 'ok');
});

$('text-add').addEventListener('click', async () => {
  const text = $('text-body').value.trim();
  if (!text) {
    setStatus(sourceStatus, 'Paste some text first.', 'error');
    return;
  }
  const name = $('text-name').value.trim() || 'Pasted text';
  await addSource({ name, kind: 'text', text });
  $('text-name').value = '';
  $('text-body').value = '';
  setStatus(sourceStatus, `Added "${name}".`, 'ok');
  renderSources();
});

// --- Startup ---------------------------------------------------------------

showProvider();
lengthSelect.value = state.length;
renderSources();
