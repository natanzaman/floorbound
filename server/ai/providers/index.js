// Pick the adapter named by AI_PROVIDER. Every adapter has the same shape:
//   { name, model, call({ system, user, schema, maxTokens, signal }) -> { intent, usage: { in, cacheRead, cacheWrite, out } } }
import { apiKey } from '../config.js';
import { anthropicProvider } from './anthropic.js';
import { openaiProvider } from './openai.js';
import { geminiProvider } from './gemini.js';
import { mockProvider } from './mock.js';

export function makeProvider(cfg, { env = process.env, fetch } = {}) {
  const key = () => apiKey(cfg, env); // read on each call, never kept
  const o = { model: cfg.model, key, effort: cfg.effort, ...(fetch ? { fetch } : {}) };
  switch (cfg.provider) {
    case 'anthropic': return anthropicProvider(o);
    case 'openai': return openaiProvider(o);
    case 'gemini': return geminiProvider(o);
    case 'mock': return mockProvider({ model: cfg.model, delayMs: Number(env.AI_MOCK_DELAY_MS) || 0 }); // (AI_MOCK_DELAY_MS: see the "…" locally)
    default: return null;
  }
}
