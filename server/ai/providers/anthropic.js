// Anthropic Messages API (POST https://api.anthropic.com/v1/messages) with structured JSON output
// (output_config.format, GA, no beta header) and a cached system prompt (cache_control on the static block; Haiku 5.5
// and Sonnet 5.5 cache prompts from 512 tokens). Thinking is turned off / deferred for speed where the model allows it.
import { postJson, ProviderError } from './http.js';
import { parseJsonObject } from '../intent.js';

const URL = 'https://api.anthropic.com/v1/messages';

function family(model) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model) || [];
  return { name: m[1] || '', major: Number(m[2]) || 0, minor: Number(m[3]) || 0 };
}

export function anthropicBody({ model, system, user, schema, maxTokens, effort }) {
  const f = family(model);
  const body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  if (effort && f.major >= 5) body.output_config.effort = effort;
  // Haiku: thinking off. Sonnet 5.5: answer first ("between_tools"). Opus / Fable / Mythos: always think (leave it).
  if (f.name === 'haiku' || (f.name === 'sonnet' && f.major < 5) || (f.name === 'sonnet' && f.major === 5 && f.minor === 0)) body.thinking = { type: 'disabled' };
  else if (f.name === 'sonnet') body.thinking = { type: 'between_tools' };
  return body;
}

export function anthropicParse(j) {
  if (j?.stop_reason === 'refusal') throw new ProviderError('model refused');
  const text = (j?.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const intent = parseJsonObject(text);
  if (!intent) throw new ProviderError(j?.stop_reason === 'max_tokens' ? 'output cut off (max tokens)' : 'no JSON in reply');
  const u = j.usage || {};
  return { intent, usage: { in: u.input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, out: u.output_tokens || 0 } };
}

export function anthropicProvider({ model, key, effort, fetch: fetchFn = globalThis.fetch }) {
  return {
    name: 'anthropic', model,
    async call({ system, user, schema, maxTokens, signal }) {
      const k = key();
      if (!k) throw new ProviderError('no API key', { kind: 'nokey' });
      const j = await postJson(fetchFn, URL, {
        headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' },
        body: anthropicBody({ model, system, user, schema, maxTokens, effort }), signal, key: k,
      });
      return anthropicParse(j);
    },
  };
}
