// A stand-in model for tests and for trying the plumbing locally (AI_PROVIDER=mock, no key, no cost). It answers in
// the same structured-intent shape as the real adapters. Tests pass reply(req) to script answers; `delayMs` / `fail`
// simulate slow or broken APIs. The default reply just acknowledges whoever spoke; it is NOT the companion's
// intelligence (that is the real model's job), only enough to see chat and intents flow end to end.
import { ProviderError } from './http.js';

const tokens = s => Math.ceil(String(s || '').length / 4);

export function defaultMockReply({ user }) {
  const who = /^Trigger: (.+?) spoke to you: "/m.exec(user)?.[1];
  return { say: who ? `(mock) Heard you, ${who}.` : '', order: 'none', stance: 'keep', focus: '', remember: '' };
}

export function mockProvider({ model = 'mock', reply = defaultMockReply, delayMs = 0, fail = null } = {}) {
  const p = {
    name: 'mock', model, calls: [],
    async call(req) {
      p.calls.push(req);
      if (delayMs) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, delayMs);
          req.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new ProviderError('timed out', { kind: 'timeout' })); });
        });
      }
      if (fail) { const f = typeof fail === 'function' ? fail(req) : fail; if (f) throw f instanceof Error ? f : new ProviderError(String(f)); }
      const intent = await reply(req);
      return { intent, usage: { in: tokens(req.system) + tokens(req.user), cacheRead: 0, cacheWrite: 0, out: tokens(JSON.stringify(intent)) } };
    },
  };
  return p;
}
