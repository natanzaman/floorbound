// Who decides a free bot's next thing (docs/briefs/bot-days.md, "A decision model picks the goal"; owner 2026-11-23: "for every
// bot with a day", not only the ones near a player).
//
// The rules always work on their own: a bot scores its goals from its needs, its personality and a little luck
// (shared/bots/day.js). This asks a decision model the same question, as a Choice over the goals that are worth
// anything, with the bot's state and those scores as hints. The model answers with a probability per goal and the bot
// rolls from them, so a 70/30 call goes the other way three times in ten. Nothing waits for it: the bot carries on
// while the call is out, and the scores decide if the answer is late (BOT_DAY_WAIT_MS), the call fails, the key is
// missing or the day's cap is reached. Three failures in a row: rules only for five minutes.
//
// Every pick is kept with who made it and the odds it was given (the day's log carries the same), which is the first
// piece of the trace and the model scoreboard the owner asked for on 2026-11-23.
//
// BOT_DAY_PICK=rules turns it off; =mock answers in process (tests, local tries). Settings: server/ai/config.js.
import { GOALS } from '../../shared/bots/day.js';
import { readDayConfig, apiKey, hasKey, keyReport } from './config.js';
import { decisionsProvider, mockDecisions } from './providers/decisions.js';
import { redact } from './providers/http.js';

const MIN = 60e3;
const FAIL_PAUSE = 300e3; // 5 min of rules only after FAILS_MAX failures in a row
const FAILS_MAX = 3;
const KEEP = 40;          // picks remembered for the admin page
const day = t => new Date(t).toISOString().slice(0, 10);
const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000);

// What the model is told about the bot. Short on purpose: Jev is billed on input tokens.
export function pickState(b, ask) {
  const f = ask.facts, t = ask.traits || {};
  const trait = k => Math.round((t[k] ?? 0.5) * 10) / 10;
  return {
    who: `${ask.bot}, a level ${f.lvl} ${b.cls}, out on its own`,
    personality: { bold: trait('aggression'), careful: trait('caution'), patient: trait('patience'), sociable: trait('sociability'), curious: trait('curiosity') },
    now: {
      floor: f.fl, in_town: !!f.town, health: `${Math.round(f.hp * 100)}%`,
      potions: f.pots == null ? 'unknown' : f.pots, gold: f.gold, bag_items: f.bag, spare_gear: f.spare,
      people_nearby: f.people, players_nearby: f.humans, in_a_team_of: f.mates, other_free_bots_about: f.free,
      minutes_since_it_rested: Math.round(f.sinceRest / 60), minutes_on_the_same_thing: Math.round(f.sameFor / 60),
      minutes_since_it_saw_anyone: Math.round(f.alone / 60), deaths_lately: f.deaths, last_thing_it_did: f.last || 'nothing yet',
    },
    its_own_scores: Object.fromEntries(ask.scores.map(s => [s.id, s.score])),
  };
}
const INSTRUCTIONS = 'This is a bot playing a co-op dungeon-crawler like a real player would. Pick what it should do next. Its own scores are a hint, not an order: weigh them against its personality and what it needs, and prefer what a human player in its place would do.';

export class DayPickers {
  // opts (tests): env, provider (a stand-in with decide()), now, log, rnd
  constructor({ cfg = null, env = process.env, provider = null, now = Date.now, log = console.log, rnd = Math.random } = {}) {
    this.cfg = cfg || readDayConfig(env);
    this.env = env; this.now = now; this.log = log; this.rnd = rnd;
    this.provider = provider
      || (this.cfg.how === 'model' ? decisionsProvider({ model: this.cfg.model, key: () => apiKey(this.cfg, env) })
        : this.cfg.how === 'mock' ? mockDecisions({ rnd }) : null);
    this.recent = [];     // the last KEEP picks (admin page)
    this.byModel = new Map(); // model id -> counters (the scoreboard's first numbers)
    this.asked = 0; this.answered = 0; this.late = 0; this.errors = 0; this.timeouts = 0; this.rules = 0;
    this.inFlight = 0; this.calls = []; // call start times in the last minute
    this.day = day(now()); this.daySpend = 0; this.totalSpend = 0;
    this.fails = 0; this.pausedUntil = 0; this.pauseWhy = '';
    this.lastError = ''; this.lastErrorAt = 0;
    this.seen = new WeakMap(); // bot -> last ask time
    this.skipped = {};
  }

  on() { return this.cfg.how !== 'rules' && !!this.provider; }
  ready() { return this.on() && (this.cfg.how === 'mock' || hasKey(this.cfg, this.env)); }
  model() { return this.provider?.model || this.cfg.model; }
  rollDay() { const d = day(this.now()); if (d !== this.day) { this.day = d; this.daySpend = 0; } }
  stat(model) { let s = this.byModel.get(model); if (!s) this.byModel.set(model, s = { model, picks: 0, answered: 0, late: 0, errors: 0, ms: 0, cost: 0, tokIn: 0, goals: {} }); return s; }

  // Why this bot is not asking now, or '' when it may. (A reason worth counting on the admin page.)
  skip(b, ask) {
    this.rollDay();
    const t = this.now(), c = this.cfg;
    if (!this.ready()) return this.on() ? 'no key' : 'rules only';
    if (t < this.pausedUntil) return `paused: ${this.pauseWhy}`;
    if (c.dailyUsd >= 0 && this.daySpend >= c.dailyUsd) return 'daily cap';
    if (ask.facts.quiet) return 'nobody on this floor'; // (it is going home to rest: nothing to decide)
    const gap = (ask.facts.humans > 0 ? c.nearS : c.farS) * 1000;
    if (t - (this.seen.get(b) ?? -Infinity) < gap) return 'bot cooldown';
    if (this.inFlight >= c.concurrent) return 'busy';
    this.calls = this.calls.filter(x => x > t - MIN);
    if (this.calls.length >= c.callsMin) return 'rate limit';
    return '';
  }

  // The hook the day calls (b.dayPicker). True: an answer may come, so the bot waits BOT_DAY_WAIT_MS for it.
  // False: the scores decide at once. Never throws, never blocks.
  pick(b, ask) {
    const why = this.skip(b, ask);
    if (why) { this.skipped[why] = (this.skipped[why] || 0) + 1; this.rules++; return false; }
    const want = ask.scores.filter(s => s.score > 0).map(s => s.id);
    for (const id of ['rest', 'hunt']) if (want.length < 2 && !want.includes(id)) want.push(id); // (always a real choice)
    if (want.length < 2) { this.rules++; return false; }
    const t0 = this.now();
    this.asked++; this.inFlight++; this.calls.push(t0); this.seen.set(b, t0);
    this.ask(b, ask, want, t0).catch(e => this.log('[daypick]', e?.message || e)).finally(() => { this.inFlight = Math.max(0, this.inFlight - 1); });
    return true;
  }

  async ask(b, ask, want, t0) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(this.cfg.waitMs * 4, 2000)); // (the bot stops waiting much sooner; this is only to free the socket)
    timer.unref?.();
    const criteria = Object.fromEntries(want.map(id => [id, GOALS[id].tell || GOALS[id].name]));
    let r = null;
    try {
      r = await this.provider.decide({ state: pickState(b, ask), instructions: INSTRUCTIONS, criteria, want, signal: ctl.signal });
    } catch (e) {
      const kind = e?.kind || 'error';
      if (kind === 'timeout') this.timeouts++; else this.errors++;
      this.lastError = redact(e?.message || String(e)); this.lastErrorAt = Date.now();
      this.stat(this.model()).errors++;
      this.fails++;
      if (this.fails >= FAILS_MAX) { this.pausedUntil = this.now() + FAIL_PAUSE; this.pauseWhy = `${this.fails} errors in a row`; this.fails = 0; }
      return;
    } finally {
      clearTimeout(timer);
    }
    this.fails = 0;
    const ms = this.now() - t0;
    const cost = r.usage.cost ?? (r.usage.in / 1e6) * this.cfg.priceIn;
    this.daySpend += cost; this.totalSpend += cost;
    const model = r.model || this.model(), S = this.stat(model);
    S.answered++; S.ms += ms; S.cost += cost; S.tokIn += r.usage.in || 0;
    this.answered++;
    const goal = this.roll(r, want);
    const odds = r.odds[goal] ?? null;
    // done() is true only while the bot is still waiting: a late answer is counted and dropped (it played on).
    const took = ask.done(goal, { who: 'model', odds: r3(odds), model }) === true;
    if (took) { S.picks++; S.goals[goal] = (S.goals[goal] || 0) + 1; } else { this.late++; S.late++; }
    this.recent.push({ at: Date.now(), bot: ask.bot, goal, odds: r3(odds), conf: r3(r.confidence), ms, cost, model, late: !took, scores: Object.fromEntries(ask.scores.filter(s => want.includes(s.id)).map(s => [s.id, s.score])), probs: Object.fromEntries(Object.entries(r.odds).map(([k, v]) => [k, r3(v)])) });
    this.recent = this.recent.slice(-KEEP);
  }

  // The answer's own pick is the model's choice; its probabilities make it a roll, so a 70/30 call goes the other way
  // three times in ten (owner 2026-11-23: bots should not all do the same thing).
  roll(r, want) {
    // Likeliest first, so the model's own favourite is what a low roll gives (and the order never depends on how the
    // goals happened to be offered).
    const ids = want.filter(id => r.odds[id] > 0).sort((a, c) => r.odds[c] - r.odds[a] || want.indexOf(a) - want.indexOf(c));
    const sum = ids.reduce((a, id) => a + r.odds[id], 0);
    if (!ids.length || sum <= 0) return want.includes(r.pick) ? r.pick : want[0];
    let x = this.rnd() * sum;
    for (const id of ids) { x -= r.odds[id]; if (x <= 0) return id; }
    return ids[ids.length - 1];
  }

  // For the admin page (and the model scoreboard later).
  status() {
    this.rollDay();
    const avg = s => (s.answered ? Math.round(s.ms / s.answered) : 0);
    return {
      how: this.cfg.how, on: this.on(), ready: this.ready(), model: this.model(),
      keyEnv: this.cfg.keyEnvs[0], keySet: hasKey(this.cfg, this.env), keyCheck: keyReport(this.cfg, this.env),
      waitMs: this.cfg.waitMs, nearS: this.cfg.nearS, farS: this.cfg.farS,
      asked: this.asked, answered: this.answered, late: this.late, errors: this.errors, timeouts: this.timeouts, rules: this.rules,
      spendToday: +this.daySpend.toFixed(5), spendTotal: +this.totalSpend.toFixed(5), dailyCap: this.cfg.dailyUsd,
      paused: this.pausedUntil > this.now() ? { s: Math.ceil((this.pausedUntil - this.now()) / 1000), why: this.pauseWhy } : null,
      skipped: { ...this.skipped }, lastError: this.lastError, lastErrorAt: this.lastErrorAt,
      models: [...this.byModel.values()].map(s => ({ ...s, avgMs: avg(s), perPick: s.picks ? +(s.cost / s.picks).toFixed(6) : 0 })),
      recent: this.recent.slice(-8),
      line: this.line(),
    };
  }

  line() {
    if (this.cfg.how === 'rules') return 'Bots decide by their own scores (BOT_DAY_PICK=rules).';
    if (!this.ready()) return `${this.model()} would decide, but no key is set (${this.cfg.keyEnvs[0]}). The bots' own scores decide meanwhile.`;
    const s = this.byModel.get(this.model());
    return `${this.model()} decides: ${this.answered} of ${this.asked} answered${this.late ? `, ${this.late} too late` : ''}${this.errors + this.timeouts ? `, ${this.errors + this.timeouts} failed` : ''} · ${this.rules} picks left to the scores · $${this.daySpend.toFixed(5)} today of $${this.cfg.dailyUsd.toFixed(2)}${s?.answered ? ` · avg ${Math.round(s.ms / s.answered)} ms` : ''}`;
  }

  // One real call with a made-up bot, for the admin page's button. -> { ok, ms, cost, pick, odds, error }
  async testCall() {
    if (!this.on()) return { at: Date.now(), ok: false, error: 'BOT_DAY_PICK=rules: the model is off.' };
    const t0 = this.now();
    const want = ['hunt', 'restock', 'rest'];
    const state = { who: 'Rook, a level 6 swordsman, out on its own', now: { potions: 0, gold: 120, in_town: true, health: '100%' }, its_own_scores: { hunt: 0.3, restock: 0.8, rest: 0.2 } };
    try {
      const r = await this.provider.decide({ state, instructions: INSTRUCTIONS, criteria: Object.fromEntries(want.map(id => [id, GOALS[id].tell])), want });
      const cost = r.usage.cost ?? (r.usage.in / 1e6) * this.cfg.priceIn;
      this.daySpend += cost; this.totalSpend += cost;
      return { at: Date.now(), ok: true, ms: this.now() - t0, cost, pick: r.pick, odds: Object.fromEntries(Object.entries(r.odds).map(([k, v]) => [k, r3(v)])), model: r.model || this.model(), conf: r3(r.confidence) };
    } catch (e) {
      return { at: Date.now(), ok: false, ms: this.now() - t0, error: redact(e?.message || String(e)) };
    }
  }
}

// Called by server/ai/index.js (installAI): gives every bot with a day the hook. The admin routes live there too,
// next to the companions' own, so both cards share one login and one poll.
export function installDayPick({ bots }, opts = {}) {
  const pickers = new DayPickers(opts);
  if (bots) bots.dayPick = (b, ask) => { try { return pickers.pick(b, ask); } catch (e) { pickers.log('[daypick]', e?.message || e); return false; } };
  return pickers;
}
