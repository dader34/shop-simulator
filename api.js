// Direct browser calls to the Claude API. Requires the dangerous-direct-browser-access
// header; the key never leaves the user's machine except to api.anthropic.com.
const MODEL = 'claude-opus-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

export function getKey() { return localStorage.getItem('sts_key') || ''; }
export function setKey(k) { localStorage.setItem('sts_key', k.trim()); }
export function clearKey() { localStorage.removeItem('sts_key'); }

/**
 * One Messages API call. When `schema` is given, uses structured outputs so the
 * response is guaranteed-valid JSON matching it, and returns the parsed object.
 */
export async function ask({ system, messages, schema, effort = 'high', maxTokens = 8000 }) {
  const key = getKey();
  if (!key) throw new Error('No API key set.');

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
    throw new Error(detail);
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

  try {
    return JSON.parse(text);
  } catch {
    // Structured outputs should make this unreachable, but salvage a fenced blob.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Could not parse model response as JSON.');
  }
}
