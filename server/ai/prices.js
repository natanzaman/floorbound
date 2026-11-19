// List prices (USD per 1M tokens) used for the spend estimate on the admin page. Checked 2026-11-17 (Anthropic rows
// re-checked 2026-11-18: Haiku 5.5 is still the cheapest/fastest; its >100K-token-prompt tier never applies here); sources in
// docs/research/ai-companions.md. in = uncached input, cr = cache read, cw = cache write (5 min), out = output (thinking
// included). An unknown model uses AI_PRICE_IN / AI_PRICE_OUT if set, else a deliberately high guess, so the daily cap
// errs on the safe side.
export const PRICES = {
  // Anthropic (platform.claude.com/docs/en/about-claude/pricing)
  'claude-haiku-5-5': { in: 0.10, out: 0.50, cr: 0.01, cw: 0.125 },
  'claude-sonnet-5-5': { in: 2, out: 10, cr: 0.10, cw: 2.50 },
  'claude-opus-5-5': { in: 4, out: 20, cr: 0.20, cw: 5 },
  'claude-sonnet-5': { in: 2, out: 10, cr: 0.20, cw: 2.50 },
  'claude-haiku-4-5': { in: 1, out: 5, cr: 0.10, cw: 1.25 },
  'claude-sonnet-4-6': { in: 3, out: 15, cr: 0.30, cw: 3.75 },
  // OpenAI (developers.openai.com/api/docs/pricing)
  'gpt-6-luna': { in: 0.10, out: 0.50, cr: 0.01, cw: 0.125 },
  'gpt-6.1-terra': { in: 1, out: 5, cr: 0.05 },
  'gpt-6.1-sol': { in: 2, out: 10, cr: 0.10 },
  'gpt-6-astra': { in: 10, out: 50, cr: 1 },
  'gpt-5.6-luna': { in: 0.20, out: 1.20, cr: 0.02 },
  'gpt-5.4-mini': { in: 0.75, out: 4.50, cr: 0.075 },
  'gpt-5.4-nano': { in: 0.20, out: 1.25, cr: 0.02 },
  // Google (ai.google.dev/gemini-api/docs/pricing, paid tier, text)
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.50, cr: 0.025 },
  'gemini-3.5-flash': { in: 1.50, out: 9, cr: 0.15 },
  'gemini-3-flash-preview': { in: 0.50, out: 3, cr: 0.05 },
  'gemini-3.1-pro-preview': { in: 2, out: 12, cr: 0.20 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40, cr: 0.01 },
  'gemini-2.5-flash': { in: 0.30, out: 2.50, cr: 0.03 },
  mock: { in: 0, out: 0, cr: 0, cw: 0 },
};
const GUESS = { in: 3, out: 15, cr: 0.3, cw: 3.75 };

// The price row for a model: exact id, else the longest known id it starts with (dated snapshots like
// "claude-haiku-5-5-20261007"), else the env override / the high guess.
export function priceOf(model, env = process.env) {
  const id = String(model || '').toLowerCase();
  if (PRICES[id]) return { ...PRICES[id], known: true };
  const base = Object.keys(PRICES).filter(k => id.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0];
  if (base) return { ...PRICES[base], known: true };
  const inP = Number(env.AI_PRICE_IN), outP = Number(env.AI_PRICE_OUT);
  if (inP > 0 && outP > 0) return { in: inP, out: outP, cr: inP / 10, cw: inP * 1.25, known: true };
  return { ...GUESS, known: false };
}

// usage: { in (uncached input), cacheRead, cacheWrite, out } in tokens. Returns USD.
export function costOf(usage, price) {
  const u = usage || {};
  return ((u.in || 0) * price.in + (u.cacheRead || 0) * (price.cr ?? price.in) + (u.cacheWrite || 0) * (price.cw ?? price.in) + (u.out || 0) * price.out) / 1e6;
}
