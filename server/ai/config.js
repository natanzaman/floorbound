// AI companion settings, from environment variables only (set them in Render: service → Environment).
// The API key is read from the environment at call time and never stored, logged, returned or sent anywhere but the
// provider's own API host. See docs/research/ai-companions.md for what to set.
//
//   AI_PROVIDER        anthropic | openai | gemini | mock   (unset: off, bots play exactly as before)
//   AI_MODEL           model id (default per provider: claude-haiku-5-5, gpt-6-luna, gemini-3.1-flash-lite)
//   AI_KEY_ENV         name of the env var holding the key (default ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY)
//   AI_ENABLED         1: companions start ON at boot (else they start OFF and an admin turns them on in /admin.html)
//   AI_EFFORT          the provider's speed/think knob (default anthropic "low", openai "none", gemini "minimal")
//   AI_THINK_S         seconds between unprompted check-ins per bot while partied with a human (default 30; 0 = only when spoken to)
//   AI_BOT_MIN_GAP_S   minimum seconds between two calls for one bot (default 4)
//   AI_BOT_TOKENS_HOUR per-bot token budget per rolling hour (default 150000)
//   AI_MAX_CALLS_MIN   global calls per minute (default 30)
//   AI_MAX_CONCURRENT  calls in flight at once (default 4)
//   AI_DAILY_USD       global estimated spend cap per UTC day (default 1.00)
//   AI_TIMEOUT_MS      per-call timeout (default 8000)
//   AI_MAX_BOTS        most bots with a mind at once (default 10)
//   AI_PRICE_IN / AI_PRICE_OUT   USD per 1M tokens, only for a model missing from server/ai/prices.js
export const DEFAULT_MODEL = { anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', gemini: 'gemini-3.1-flash-lite', mock: 'mock' };
export const KEY_ENV = { anthropic: ['ANTHROPIC_API_KEY'], openai: ['OPENAI_API_KEY'], gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], mock: [] };
export const DEFAULT_EFFORT = { anthropic: 'low', openai: 'none', gemini: 'minimal', mock: '' };

const num = (v, def, lo = 0, hi = Infinity) => { const n = Number(v); return v === undefined || v === '' || !Number.isFinite(n) ? def : Math.min(hi, Math.max(lo, n)); };
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

export function readConfig(env = process.env) {
  const provider = String(env.AI_PROVIDER || '').trim().toLowerCase();
  const known = provider in DEFAULT_MODEL;
  const keyEnvs = env.AI_KEY_ENV && ENV_NAME.test(env.AI_KEY_ENV) ? [env.AI_KEY_ENV] : KEY_ENV[provider] || [];
  return {
    provider: known ? provider : '',
    badProvider: provider && !known ? provider : '',
    model: String(env.AI_MODEL || DEFAULT_MODEL[provider] || '').trim(),
    keyEnvs,
    startOn: env.AI_ENABLED === '1' || env.AI_ENABLED === 'true',
    effort: env.AI_EFFORT !== undefined ? String(env.AI_EFFORT).trim() : DEFAULT_EFFORT[provider] || '',
    thinkS: num(env.AI_THINK_S, 30, 0),
    botMinGapS: num(env.AI_BOT_MIN_GAP_S, 4, 0.5),
    botTokensHour: num(env.AI_BOT_TOKENS_HOUR, 150000, 1000),
    maxCallsMin: num(env.AI_MAX_CALLS_MIN, 30, 1),
    maxConcurrent: num(env.AI_MAX_CONCURRENT, 4, 1, 32),
    dailyUsd: num(env.AI_DAILY_USD, 1, 0),
    timeoutMs: num(env.AI_TIMEOUT_MS, 8000, 500, 60000),
    maxBots: num(env.AI_MAX_BOTS, 10, 1),
    maxOutTokens: num(env.AI_MAX_OUT_TOKENS, 300, 64, 4000),
  };
}

// The key, looked up when needed (never cached on an object that could be serialised).
export function apiKey(cfg, env = process.env) {
  for (const k of cfg.keyEnvs) if (env[k] && String(env[k]).trim()) return String(env[k]).trim();
  return '';
}
export const hasKey = (cfg, env = process.env) => cfg.provider === 'mock' || !!apiKey(cfg, env);
