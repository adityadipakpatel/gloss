// Anthropic Messages API client: one streaming call, SSE parsing, and error mapping.
// The API key is only ever sent to API_URL.

const API_URL = 'https://api.anthropic.com/v1/messages';

export const MODELS = {
  'claude-haiku-4-5-20251001': {
    label: 'Claude Haiku 4.5 (fast and cheap)',
    contextTokens: 200_000,
  },
  'claude-sonnet-5-5': {
    label: 'Claude Sonnet 5.5 (more capable)',
    contextTokens: 1_000_000,
    // Sonnet 5.5 thinks before answering by default, and thinking counts toward
    // max_tokens. "between_tools" is its lowest setting (no up-front thinking), which
    // keeps a short definition fast and inside the small token limit.
    extra: { thinking: { type: 'between_tools' } },
  },
};
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// `code` is one of the keys of ERROR_TEXT below.
export class ApiError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.code = code;
  }
}

// Friendly text per error code, plus the action the card offers ('settings' | 'retry').
const ERROR_TEXT = {
  no_key: ['Add your Anthropic API key to start using Gloss.', 'settings'],
  invalid_key: ['Anthropic rejected the API key. Check it in settings.', 'settings'],
  forbidden: ["This API key isn't allowed to do that. Check its permissions in the Claude Console."],
  billing: ["There's a billing problem on your Anthropic account. Check the Claude Console."],
  model_unavailable: ["The selected model isn't available to this API key. Pick another in settings.", 'settings'],
  too_large: ['Your active sources are too large for this model. Turn some off in settings.', 'settings'],
  rate_limit: ['Rate limit reached. Wait a moment and try again.', 'retry'],
  server: ["Anthropic's API is overloaded or having trouble. Try again shortly.", 'retry'],
  network: ["Couldn't reach api.anthropic.com. Check your connection.", 'retry'],
  refusal: ['The model declined to answer this one.'],
  bad_request: ['The request was rejected.'],
};

// Turns any thrown value into { code, message, action } for display.
export function describeError(err) {
  const code = err instanceof ApiError && ERROR_TEXT[err.code] ? err.code : 'bad_request';
  const [text, action = null] = ERROR_TEXT[code];
  // For the catch-all, the API's own message is the most useful thing to show.
  const detail = code === 'bad_request' && err?.message ? ` ${err.message}` : '';
  return { code, message: text + detail, action };
}

function errorCode(status, type, message) {
  if (status === 401 || type === 'authentication_error') return 'invalid_key';
  if (status === 402 || type === 'billing_error') return 'billing';
  if (status === 403 || type === 'permission_error') return 'forbidden';
  if (status === 404 || type === 'not_found_error') return 'model_unavailable';
  if (status === 429 || type === 'rate_limit_error') return 'rate_limit';
  if (status >= 500 || type === 'overloaded_error' || type === 'api_error') return 'server';
  // Too much input: 413 for the raw request size, 400 when it exceeds the context window.
  if (status === 413 || /prompt is too long|too many tokens|context window|context limit/i.test(message)) {
    return 'too_large';
  }
  return 'bad_request';
}

async function post(apiKey, body, signal) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for calls that carry a browser Origin header, as extension fetches do.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ ...MODELS[body.model]?.extra, ...body }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('network');
  }
  if (!response.ok) {
    let error = {};
    try {
      error = (await response.json()).error || {};
    } catch {
      // Non-JSON error body (e.g. from a proxy); the status code is enough.
    }
    throw new ApiError(errorCode(response.status, error.type, error.message || ''), error.message);
  }
  return response;
}

// Makes the smallest useful request to check that the key and model work.
// Resolves on success; rejects with ApiError.
export async function testConnection(apiKey, model) {
  await post(apiKey, { model, max_tokens: 8, messages: [{ role: 'user', content: 'Hi' }] });
}

// Yields the parsed JSON of each SSE "data:" line. Anthropic puts the event type
// inside the JSON too, so "event:" lines can be ignored.
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

// Streams one response, calling onText(chunk) for each piece of answer text.
// Resolves with the stop reason; rejects with ApiError (or AbortError if aborted).
export async function streamMessage({ apiKey, body, signal, onText }) {
  const response = await post(apiKey, { ...body, stream: true }, signal);
  let stopReason = null;
  try {
    for await (const event of sseEvents(response.body)) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        onText(event.delta.text);
      } else if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason ?? stopReason;
      } else if (event.type === 'error') {
        const { type, message = '' } = event.error || {};
        throw new ApiError(errorCode(0, type, message), message);
      }
    }
  } catch (err) {
    if (err instanceof ApiError || err.name === 'AbortError') throw err;
    throw new ApiError('network'); // connection dropped mid-stream
  }
  if (stopReason === 'refusal') throw new ApiError('refusal');
  return stopReason;
}
