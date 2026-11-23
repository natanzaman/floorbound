// AI companion settings, from environment variables only (set them in Render: service → Environment).
// The API key is read from the environment at call time and never stored, logged, returned or sent anywhere but the
// provider's own API host. See docs/research/ai-companions.md for what to set.
//
//   AI_PROVIDER        anthropic | openai | gemini | mock   (unset: off, bots play exactly as before)
//   AI_MODEL           model id (default per provider: claude-haiku-5-5, gpt-6-luna, gemini-3.1-flash-lite)
//   AI_KEY_ENV         name of the env var holding the key, tried first (then ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
//                      and the fallbacks in KEY_ENV). Names and values are read forgivingly: see envLookup.
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
// Talking to the Named (server/ai/namedtalk.js) shares the provider, key, toggle and AI_DAILY_USD, with a slice each:
//   AI_NAMED_RESERVE   share of AI_DAILY_USD kept for Named talk: companions stop that far short of the cap until the
//                      Named have spent it (default 0.2)
//   AI_NAMED_MAX_SHARE most of AI_DAILY_USD Named talk may spend, so companions keep the rest (default 0.5)
//   AI_NAMED_CALLS_MIN Named talk calls per minute, counted apart from AI_MAX_CALLS_MIN (default 12)
//   AI_NAMED_DAILY     Named talk calls per player per day (resets 10:00 UTC with friendship; default 30)
//   AI_NAMED_GAP_S     seconds between two lines from one player to the Named (default 4)
//   AI_NAMED_PHRASE_DAILY  requests and invitations the Named phrase in their own words, per player per day (on the
//                      Named slice, not the player's talk calls; then canned lines; default 10)
export const DEFAULT_MODEL = { anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', gemini: 'gemini-3.1-flash-lite', mock: 'mock' };
// Key env var names per provider, first one wins. The extra names are common misnamings, accepted on purpose.
export const KEY_ENV = {
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'ANTHROPIC_KEY', 'CLAUDE_KEY', 'ANTHROPIC_API_TOKEN'],
  openai: ['OPENAI_API_KEY', 'OPENAI_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_KEY'],
  mock: [],
};
// What a real key starts with (only for a warning on the admin card / in the log; a key that doesn't match is still used).
const KEY_SHAPE = { anthropic: [/^sk-ant-/, 'sk-ant-'], openai: [/^sk-/, 'sk-'], gemini: [/^AIza/, 'AIza'] };
export const DEFAULT_EFFORT = { anthropic: 'low', openai: 'none', gemini: 'minimal', mock: '' };

const num = (v, def, lo = 0, hi = Infinity) => { const n = Number(v); return v === undefined || v === '' || !Number.isFinite(n) ? def : Math.min(hi, Math.max(lo, n)); };
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

// ---------- forgiving env lookup ----------
// Dashboards make it easy to save "ANTHROPIC_API_KEY " (trailing space), "anthropic_api_key" or a value pasted with
// quotes / a newline. A name matches exactly first, else trimmed, case-insensitive, with spaces or '-' read as '_'.
// A value is trimmed and loses one pair of surrounding quotes.
export const normName = n => String(n).trim().toUpperCase().replace(/[\s-]+/g, '_');
export function cleanValue(v) {
  let s = String(v ?? '').trim();
  if (s.length >= 2 && /^(["'`]).*\1$/s.test(s)) s = s.slice(1, -1).trim();
  return s;
}
// -> { name (as set in the environment), value (cleaned), exact } or null when no variable has that name at all.
// A set name wins over a blank one (an exact match first).
export function envLookup(env, name) {
  const exact = Object.prototype.hasOwnProperty.call(env, name) ? { name, value: cleanValue(env[name]), exact: true } : null;
  if (exact?.value) return exact;
  const want = normName(name);
  let blank = exact;
  for (const k of Object.keys(env)) {
    if (k === name || normName(k) !== want) continue;
    const r = { name: k, value: cleanValue(env[k]), exact: false };
    if (r.value) return r;
    blank ||= r;
  }
  return blank;
}
const envGet = (env, name) => envLookup(env, name)?.value;

export function readConfig(env = process.env) {
  const provider = String(envGet(env, 'AI_PROVIDER') || '').toLowerCase();
  const known = provider in DEFAULT_MODEL;
  const custom = normName(envGet(env, 'AI_KEY_ENV') || '');
  const keyEnvs = [...new Set([...(custom && ENV_NAME.test(custom) ? [custom] : []), ...(KEY_ENV[provider] || [])])];
  const enabled = String(envGet(env, 'AI_ENABLED') || '').toLowerCase();
  const effort = envGet(env, 'AI_EFFORT');
  return {
    provider: known ? provider : '',
    badProvider: provider && !known ? provider : '',
    model: String(envGet(env, 'AI_MODEL') || DEFAULT_MODEL[provider] || ''),
    keyEnvs,
    startOn: enabled === '1' || enabled === 'true' || enabled === 'yes' || enabled === 'on',
    effort: effort !== undefined ? effort : DEFAULT_EFFORT[provider] || '',
    thinkS: num(envGet(env, 'AI_THINK_S'), 30, 0),
    botMinGapS: num(envGet(env, 'AI_BOT_MIN_GAP_S'), 4, 0.5),
    botTokensHour: num(envGet(env, 'AI_BOT_TOKENS_HOUR'), 150000, 1000),
    maxCallsMin: num(envGet(env, 'AI_MAX_CALLS_MIN'), 30, 1),
    maxConcurrent: num(envGet(env, 'AI_MAX_CONCURRENT'), 4, 1, 32),
    dailyUsd: num(envGet(env, 'AI_DAILY_USD'), 1, 0),
    timeoutMs: num(envGet(env, 'AI_TIMEOUT_MS'), 8000, 500, 60000),
    maxBots: num(envGet(env, 'AI_MAX_BOTS'), 10, 1),
    maxOutTokens: num(envGet(env, 'AI_MAX_OUT_TOKENS'), 500, 64, 4000), // (room for a plan of 8 steps)
    namedReserve: num(envGet(env, 'AI_NAMED_RESERVE'), 0.2, 0, 1),
    namedMaxShare: num(envGet(env, 'AI_NAMED_MAX_SHARE'), 0.5, 0, 1),
    namedCallsMin: num(envGet(env, 'AI_NAMED_CALLS_MIN'), 12, 1),
    namedConcurrent: 2, // Named calls in flight at once, apart from AI_MAX_CONCURRENT (companions always keep theirs)
    namedDaily: num(envGet(env, 'AI_NAMED_DAILY'), 30, 0),
    namedGapS: num(envGet(env, 'AI_NAMED_GAP_S'), 4, 1),
    namedPhraseDaily: num(envGet(env, 'AI_NAMED_PHRASE_DAILY'), 10, 0),
    namedPhraseMs: 3000, // a phrasing that takes longer than this keeps the canned line
  };
}

// The key, looked up when needed (never cached on an object that could be serialised).
export function apiKey(cfg, env = process.env) {
  for (const k of cfg.keyEnvs) { const v = envGet(env, k); if (v) return v; }
  return '';
}
export const hasKey = (cfg, env = process.env) => cfg.provider === 'mock' || !!apiKey(cfg, env);
// At most the key's last 4 characters, never the key.
export const keyHint = k => (k.length >= 12 ? `…${k.slice(-4)}` : k ? '(set)' : '');

// Which env var names were looked for and what was found: names, whether set, at most the key's last 4 characters.
// Never a value. -> { looked, found, foundAs, hint, empty, related, warn, text }
const RELATED = /(ANTHROPIC|CLAUDE|OPENAI|GEMINI|GOOGLE).*(KEY|TOKEN|SECRET)|API_?KEY/i; // key-like names only
export function keyReport(cfg, env = process.env) {
  const looked = [...cfg.keyEnvs], empty = [];
  let found = null, foundAs = null, hint = '', warn = '';
  for (const n of looked) {
    const r = envLookup(env, n);
    if (!r) continue;
    if (!r.value) { empty.push(r.exact ? n : JSON.stringify(r.name)); continue; }
    found = n; if (!r.exact) foundAs = JSON.stringify(r.name); hint = keyHint(r.value);
    const shape = KEY_SHAPE[cfg.provider];
    if (shape && !shape[0].test(r.value)) warn = `the value doesn't start with ${shape[1]}, so it may not be a ${cfg.provider} key`;
    break;
  }
  const lookedN = new Set(looked.map(normName));
  const related = Object.keys(env).filter(k => RELATED.test(k) && !lookedN.has(normName(k)) && normName(k) !== 'AI_KEY_ENV').sort().slice(0, 8);
  let text;
  if (cfg.provider === 'mock') text = 'mock provider: no key needed';
  else if (!looked.length) text = 'no key names to look for (set AI_PROVIDER)';
  else if (found) text = `key from ${found}${foundAs ? ` (set as ${foundAs})` : ''} ${hint}${warn ? `; warning: ${warn}` : ''}`;
  else text = `key missing: looked for ${looked.join(', ')}; ${empty.length ? `set but empty: ${empty.join(', ')}` : 'none of them is set'}${related.length ? `; other related names present: ${related.join(', ')}` : ''}`;
  return { looked, found, foundAs, hint, empty, related, warn, text };
}
