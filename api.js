// Direct browser calls to the Claude API. Requires the dangerous-direct-browser-access
// header; the key never leaves the user's machine except to api.anthropic.com.
const MODEL = 'claude-opus-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

export function getKey() { return localStorage.getItem('sts_key') || ''; }
export function setKey(k) { localStorage.setItem('sts_key', k.trim()); }

/** Anthropic keys look like sk-ant-... and are long. Catch obvious junk early. */
export function keyLooksValid(k = getKey()) {
  return /^sk-ant-/.test(k) && k.length > 40;
}
export function clearKey() { localStorage.removeItem('sts_key'); }

/**
 * One Messages API call. When `schema` is given, uses structured outputs so the
 * response is guaranteed-valid JSON matching it, and returns the parsed object.
 */
export async function ask({ system, messages, schema, effort = 'high', maxTokens = 8000, stream = false, onProgress }) {
  const key = getKey();
  if (!key) throw new Error('No API key set.');
  if (!keyLooksValid(key)) {
    throw new Error('The saved API key does not look like an Anthropic key (they start with sk-ant-). Re-enter it on the setup screen.');
  }

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    thinking: { type: 'adaptive' },
    output_config: { effort },
  };
  if (schema) {
    body.output_config.format = { type: 'json_schema', schema };
  }
  if (stream) body.stream = true;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error?.message) detail = j.error.message;
    } catch { /* non-JSON error body */ }
    if (res.status === 401) {
      detail = `${detail} — check the API key on the setup screen.`;
    }
    throw new Error(detail);
  }

  if (stream) {
    const text = await readStream(res, onProgress);
    return schema ? parseJson(text) : text;
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('The model declined this request. Try regenerating the case.');
  }

  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  if (!schema) return text;
  return parseJson(text);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Structured outputs should make this unreachable, but salvage a fenced blob.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Could not parse model response as JSON.');
  }
}

/**
 * Read an SSE stream, accumulating text deltas. Streaming keeps a long
 * generation from tripping request timeouts and lets the UI show progress
 * instead of sitting blank.
 */
async function readStream(res, onProgress) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let refused = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }

      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        text += ev.delta.text;
        onProgress?.(text.length, 'writing');
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
        // Thinking can run for a while before any text appears; report it so the
        // UI doesn't look frozen at zero.
        onProgress?.(text.length, 'thinking');
      } else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') {
        refused = true;
      } else if (ev.type === 'error') {
        throw new Error(ev.error?.message || 'Stream error.');
      }
    }
  }

  if (refused) throw new Error('The model declined this request. Try regenerating the case.');
  if (!text) throw new Error('Empty response from the model.');
  return text;
}
