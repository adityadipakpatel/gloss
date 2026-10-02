// Chat API client: one streaming call, SSE parsing and error mapping, for both the
// Anthropic Messages format and the OpenAI-compatible format (Gemini, Groq, DeepSeek).
// An API key is only ever sent to its own provider's URL.
import { PROVIDERS } from './providers.js';

// `code` is one of the keys of ERROR_TEXT below.
export class ApiError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.code = code;
    this.detail = detail; // the provider's own message, when there was one
  }
}

// Friendly text per error code, plus the action the card offers ('settings' | 'retry').
const ERROR_TEXT = {
  no_key: ['Add an API key in settings to start using Gloss.', 'settings'],
  invalid_key: ['The API key was rejected. Check it in settings.', 'settings'],
  forbidden: ["This API key isn't allowed to do that. Check its permissions with the provider."],
  billing: ['There is a billing or credit problem on your provider account.'],
  model_unavailable: ["The selected model isn't available to this API key. Pick another in settings.", 'settings'],
  too_large: [
    'Your active sources are too large for this model or its free-tier limits. Turn some off in settings.',
    'settings',
  ],
  rate_limit: ['Rate limit or free-tier quota reached. Wait a moment and try again.', 'retry'],
  server: ['The API is overloaded or having trouble. Try again shortly.', 'retry'],
  network: ["Couldn't reach the API. Check your connection.", 'retry'],
  refusal: ['The model declined to answer this one.'],
  bad_request: ['The request was rejected.'],
};

// Turns any thrown value into { code, message, action } for display.
export function describeError(err) {
  const code = err instanceof ApiError && ERROR_TEXT[err.code] ? err.code : 'bad_request';
  const [text, action = null] = ERROR_TEXT[code];
  // For the catch-all, the provider's own message is the most useful thing to show.
  const raw = err instanceof ApiError ? err.detail : err?.message;
  const detail = code === 'bad_request' && raw ? ` ${raw}` : '';
  return { code, message: text + detail, action };
}

// Providers disagree on error shapes, so match on status first, then on wording.
// status is 0 for errors that arrive inside a stream.
function errorCode(status, type = '', message = '') {
  const text = `${type} ${message}`;
  if (status === 401 || /authentication|api key not valid|invalid.{0,12}api.?key|incorrect api key/i.test(text)) {
    return 'invalid_key';
  }
  if (status === 402 || /billing|insufficient.balance|credit balance/i.test(text)) return 'billing';
  if (status === 403 || /permission/i.test(type)) return 'forbidden';
  if (status === 404 || /not_found/i.test(type)) return 'model_unavailable';
  // Too much input: 413 for the request size, 400 when it exceeds the context window.
  if (status === 413 || /prompt is too long|too many tokens|context.(window|length)|maximum context|request too large/i.test(text)) {
    return 'too_large';
  }
  if (status === 429 || /rate.?limit|resource.exhausted|quota/i.test(text)) return 'rate_limit';
  if (status >= 500 || /overloaded|api_error|server_error|unavailable/i.test(text)) return 'server';
  return 'bad_request';
}

// Returns { url, headers, body } for one request in the provider's format.
// `system` is the array of { type: 'text', text } blocks from prompt.js.
function buildRequest(provider, apiKey, { model, system = [], messages, maxTokens, stream }) {
  const p = PROVIDERS[provider];
  if (p.format === 'anthropic') {
    return {
      url: p.url,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for calls that carry a browser Origin header, as extension fetches do.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: { model, max_tokens: maxTokens, stream, system, messages, ...p.params(model) },
    };
  }
  // OpenAI-compatible: the system blocks become one system message. Their order still
  // gives a stable prefix, which providers with automatic prompt caching reuse.
  const systemText = system.map((block) => block.text).join('\n\n');
  return {
    url: p.url,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: {
      model,
      max_tokens: maxTokens,
      stream,
      messages: systemText ? [{ role: 'system', content: systemText }, ...messages] : messages,
      ...p.params(model),
    },
  };
}

async function post({ url, headers, body }, signal) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('network');
  }
  if (!response.ok) {
    let error = {};
    try {
      const data = await response.json();
      error = (Array.isArray(data) ? data[0] : data)?.error || {}; // Gemini may wrap it in an array
    } catch {
      // Non-JSON error body (e.g. from a proxy); the status code is enough.
    }
    const type = String(error.type || error.status || error.code || '');
    const message = String(error.message || '');
    throw new ApiError(errorCode(response.status, type, message), message);
  }
  return response;
}

// Makes the smallest useful request to check that the key and model work.
// Resolves on success; rejects with ApiError.
export async function testConnection(provider, apiKey, model) {
  const request = buildRequest(provider, apiKey, {
    model,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    maxTokens: PROVIDERS[provider].format === 'anthropic' ? 8 : 256,
    stream: false,
  });
  await post(request);
}

// Yields the parsed JSON of each SSE "data:" line. Both formats put everything needed
// in the JSON, so "event:" lines can be ignored; OpenAI's final "[DONE]" isn't JSON.
async function* sseEvents(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // the last piece may be an incomplete line
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        yield JSON.parse(line.slice(5));
      } catch {
        // Ignore anything that isn't JSON; unknown events must not break the stream.
      }
    }
  }
}

// Returns the answer text in one streamed event, or null. Throws on in-stream errors.
// Sets state.stopReason when the event carries one.
function readEvent(format, event, state) {
  if (format === 'anthropic') {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') return event.delta.text;
    if (event.type === 'message_delta') state.stopReason = event.delta?.stop_reason ?? state.stopReason;
    if (event.type === 'error') {
      const { type, message = '' } = event.error || {};
      throw new ApiError(errorCode(0, type, message), message);
    }
    return null;
  }
  if (event.error) {
    const { type, code, message = '' } = event.error;
    throw new ApiError(errorCode(0, String(type || code || ''), message), message);
  }
  const choice = event.choices?.[0];
  if (choice?.finish_reason) state.stopReason = choice.finish_reason;
  return choice?.delta?.content || null; // reasoning arrives in other fields and is skipped
}

// Streams one answer, calling onText(chunk) for each piece of text.
// Resolves with the stop reason; rejects with ApiError (or AbortError if aborted).
export async function streamAnswer({ provider, apiKey, model, system, messages, maxTokens, signal, onText }) {
  const format = PROVIDERS[provider].format;
  const request = buildRequest(provider, apiKey, { model, system, messages, maxTokens, stream: true });
  const response = await post(request, signal);
  const state = { stopReason: null };
  try {
    for await (const event of sseEvents(response.body)) {
      const text = readEvent(format, event, state);
      if (text) onText(text);
    }
  } catch (err) {
    if (err instanceof ApiError || err.name === 'AbortError') throw err;
    throw new ApiError('network'); // connection dropped mid-stream
  }
  if (state.stopReason === 'refusal' || state.stopReason === 'content_filter') throw new ApiError('refusal');
  return state.stopReason;
}
