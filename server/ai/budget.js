// Cost and safety caps for the companion minds. Every call asks allow() first; any "no" means the bot simply keeps
// playing on its rule-based brain (the fallback is always "do nothing extra").
//   per bot:  a minimum gap between calls, and a token budget per rolling hour
//   global:   calls per minute, calls in flight, estimated USD per UTC day
//   breaker:  5 failures in a row pause all calls for 2 minutes (a 429's retry-after is honoured too)
const HOUR = 3600e3, MIN = 60e3;
const day = t => new Date(t).toISOString().slice(0, 10);

export class Budget {
  constructor(cfg, now = Date.now) {
    this.cfg = cfg; this.now = now;
    this.bots = new WeakMap(); // bot -> { last, used: [{ t, n }] }
    this.recent = [];          // global call start times (last minute)
    this.inFlight = 0; this.calls = 0;
    this.day = day(now()); this.daySpend = 0; this.totalSpend = 0;
    this.fails = 0; this.pausedUntil = 0; this.pauseWhy = '';
  }

  bot(b) { let s = this.bots.get(b); if (!s) this.bots.set(b, s = { last: -Infinity, used: [] }); return s; }
  rollDay() { const d = day(this.now()); if (d !== this.day) { this.day = d; this.daySpend = 0; } }
  botTokens(b) { const s = this.bot(b), cut = this.now() - HOUR; s.used = s.used.filter(u => u.t > cut); return s.used.reduce((a, u) => a + u.n, 0); }

  // { ok: true } or { ok: false, why, hard } (hard: no point retrying soon). Doesn't reserve anything.
  allow(b) {
    const t = this.now(), c = this.cfg;
    this.rollDay();
    if (t < this.pausedUntil) return { ok: false, why: `paused: ${this.pauseWhy || '?'}`, hard: true };
    if (c.dailyUsd >= 0 && this.daySpend >= c.dailyUsd) return { ok: false, why: 'daily budget used', hard: true };
    if (this.inFlight >= c.maxConcurrent) return { ok: false, why: 'busy' };
    this.recent = this.recent.filter(x => x > t - MIN);
    if (this.recent.length >= c.maxCallsMin) return { ok: false, why: 'rate limit' };
    if (b) {
      const s = this.bot(b);
      if (t - s.last < c.botMinGapS * 1000) return { ok: false, why: 'bot cooldown' };
      if (this.botTokens(b) >= c.botTokensHour) return { ok: false, why: 'bot token budget used', hard: true };
    }
    return { ok: true };
  }

  start(b) {
    const t = this.now();
    this.inFlight++; this.calls++; this.recent.push(t);
    if (b) this.bot(b).last = t;
  }

  // r: { ok, usage, cost, kind ('timeout' | 'rate' | 'nokey' | 'error'), retryAfter, test (admin test call) }
  end(b, r) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.rollDay();
    if (r.usage && b) this.bot(b).used.push({ t: this.now(), n: (r.usage.in || 0) + (r.usage.cacheRead || 0) + (r.usage.cacheWrite || 0) + (r.usage.out || 0) });
    if (r.cost) { this.daySpend += r.cost; this.totalSpend += r.cost; }
    if (r.test) return; // an admin test call never trips the breaker
    if (r.ok) { this.fails = 0; return; }
    this.fails++;
    if (r.kind === 'rate' && r.retryAfter) this.pause(r.retryAfter * 1000, 'provider rate limit');
    else if (this.fails >= 5) { this.pause(120e3, `${this.fails} errors in a row`); this.fails = 0; }
  }

  pause(ms, why) { this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms); this.pauseWhy = why; }
}
