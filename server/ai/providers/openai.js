// OpenAI Responses API (POST https://api.openai.com/v1/responses) with strict JSON-schema output (text.format) and
// reasoning effort "none" for speed. gpt-6-luna sometimes adds an extra "commentary" message item next to the JSON
// (community.openai.com thread in the research doc), so the parser skips commentary and takes the last valid object.
import { postJson, ProviderError } from './http.js';
import { parseJsonObject } from '../intent.js';

const URL = 'https://api.openai.com/v1/responses';

export function openaiBody({ model, system, user, schema, maxTokens, effort }) {
  const body = {
    model,
    instructions: system,
    input: user,
    max_output_tokens: maxTokens,
    store: false,
    text: { format: { type: 'json_schema', name: 'companion_intent', schema, strict: true } },
  };
  if (effort) body.reasoning = { effort };
  return body;
}

export function openaiParse(j) {
  const msgs = (j?.output || []).filter(o => o.type === 'message');
  const parts = [];
  for (const m of [...msgs.filter(m => m.phase !== 'commentary'), ...msgs.filter(m => m.phase === 'commentary')]) {
    for (const c of m.content || []) {
      if (c.type === 'refusal') throw new ProviderError('model refused');
      if (c.type === 'output_text') parts.push(c.text);
    }
  }
  let intent = null;
  for (const t of parts.reverse()) { intent = parseJsonObject(t); if (intent) break; } // the last valid one of the real answer
  if (!intent && typeof j?.output_text === 'string') intent = parseJsonObject(j.output_text);
  if (!intent) throw new ProviderError(j?.status === 'incomplete' ? `output cut off (${j.incomplete_details?.reason || 'incomplete'})` : 'no JSON in reply');
  const u = j.usage || {}, cached = u.input_tokens_details?.cached_tokens || 0;
  return { intent, usage: { in: Math.max(0, (u.input_tokens || 0) - cached), cacheRead: cached, cacheWrite: 0, out: u.output_tokens || 0 } };
}

export function openaiProvider({ model, key, effort, fetch: fetchFn = globalThis.fetch }) {
  return {
    name: 'openai', model,
    async call({ system, user, schema, maxTokens, signal }) {
      const k = key();
      if (!k) throw new ProviderError('no API key', { kind: 'nokey' });
      const j = await postJson(fetchFn, URL, { headers: { authorization: `Bearer ${k}` }, body: openaiBody({ model, system, user, schema, maxTokens, effort }), signal, key: k });
      return openaiParse(j);
    },
  };
}
