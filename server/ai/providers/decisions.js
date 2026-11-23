// A decision model through OpenRouter's Decisions API (POST https://openrouter.ai/api/alpha/decisions). One small
// question, one answer with a probability per option: much cheaper and faster than a chat model, and it is all a bot
// needs for "what shall I do next?" (server/ai/daypick.js). Jev is billed on input tokens only (output is free).
//
// Request:  { model, state (the bot's situation), questions: { next: { type: 'choice', instructions, criteria } } }
// Answer:   { id, model, provider, answers: { next: { type: 'choice', choice, probabilities, confidence } }, usage }
// `probabilities`, `confidence` and `usage.cost` are optional in the schema, so everything is read through a check.
// Docs: openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request (looked up 2026-11-23).
import { postJson, ProviderError } from './http.js';

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

export function decisionsBody({ model, state, instructions, criteria, user = '' }) {
  return {
    model,
    state,
    questions: { next: { type: 'choice', instructions, criteria } },
    ...(user ? { user: String(user).slice(0, 256) } : {}),
  };
}

// -> { pick, odds ({ id: 0..1 }), confidence, model, usage: { in, out, cost (USD or null) } }
export function decisionsParse(j, want = null) {
  const a = j?.answers?.next;
  if (!a) throw new ProviderError('no answer in reply');
  if (a.type === 'refusal') throw new ProviderError('the model declined the question');
  if (a.type !== 'choice' || typeof a.choice !== 'string') throw new ProviderError(`unexpected answer type "${a.type}"`);
  const odds = {};
  const p = a.probabilities;
  if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) if (Number.isFinite(+v) && +v >= 0 && (!want || want.includes(k))) odds[k] = +v;
  if (want && !want.includes(a.choice)) throw new ProviderError('the model picked something it was not offered');
  const u = j.usage || {};
  return {
    pick: a.choice,
    odds,
    confidence: Number.isFinite(+a.confidence) ? +a.confidence : null,
    model: typeof j.model === 'string' ? j.model : '',
    usage: { in: u.input_tokens || 0, out: u.output_tokens || 0, cost: Number.isFinite(+u.cost) ? +u.cost : null },
  };
}

// { name, model, decide({ state, instructions, criteria, want, signal }) }. The key is read per call, never kept.
export function decisionsProvider({ model, key, fetch: fetchFn = globalThis.fetch, url = DECISIONS_URL }) {
  return {
    name: 'openrouter', model,
    async decide({ state, instructions, criteria, want = null, user = '', signal }) {
      const k = key();
      if (!k) throw new ProviderError('no API key', { kind: 'nokey' });
      const j = await postJson(fetchFn, url, { headers: { authorization: `Bearer ${k}` }, body: decisionsBody({ model, state, instructions, criteria, user }), signal, key: k });
      return decisionsParse(j, want);
    },
  };
}

// BOT_DAY_PICK=mock: answers in process, no key and no network (local tries, tests). It leans on the scores it was
// given, with a little noise, so the whole path (odds, the roll, the records, the admin card) can be seen working.
export function mockDecisions({ model = 'mock-decider', ms = 60, rnd = Math.random } = {}) {
  return {
    name: 'mock', model,
    async decide({ state, want = [] }) {
      if (ms) await new Promise(r => setTimeout(r, ms));
      const ids = want.length ? want : Object.keys(state?.its_own_scores || { hunt: 1 });
      const w = ids.map(id => Math.max(0.02, (state?.its_own_scores?.[id] ?? 0.3) * (0.6 + rnd() * 0.8)));
      const sum = w.reduce((a, v) => a + v, 0);
      const odds = Object.fromEntries(ids.map((id, i) => [id, w[i] / sum]));
      const pick = ids[w.indexOf(Math.max(...w))];
      return { pick, odds, confidence: odds[pick], model, usage: { in: 400, out: 0, cost: 0 } };
    },
  };
}
