// The companion "mind": a slow LLM layer over the fast rule-based bot brain (shared/bots/brain.js).
//
// It never runs per tick and never moves or fights. It listens to a bot's events through the brain's onEvent hook,
// and asks the model for one structured intent (server/ai/intent.js) when:
//   - a human party member mentions the bot by name in chat ("Rook, hang back and heal me when I'm low"), or
//   - every AI_THINK_S seconds while the bot is partied with a human, only if something changed (call-outs, banter).
// Intents go through the bot's existing interfaces: party chat (social.js say), b.command() orders (the same ones
// /b gives), a stance (defensive steps out of fights early, aggressive doesn't step out), a focus (a healer keeps that
// player topped up; others anchor on them) and short memories about players.
// Chat is never keyword-parsed here: only the model's structured output turns words into intents. Lines starting
// with "/" are commands for the game (/b ...) and are ignored.
//
// Off (no provider, no key, or toggled off): onEvent returns at once and tick() does nothing, so bots play exactly as
// before. Any error, timeout or cap simply means no intent this time.
import { say } from '../../shared/bots/social.js';
import { planText } from '../../shared/bots/plan.js';
import { INTENT_SCHEMA, sanitizeIntent } from './intent.js';
import { SYSTEM, summarize, isBotId, nameOfId, partyMates } from './prompt.js';
import { Budget } from './budget.js';
import { priceOf, costOf } from './prices.js';
import { hasKey, apiKey, keyHint, keyReport, envLookup, KEY_ENV } from './config.js';
import { redact } from './providers/http.js';

const STANCE_MS = 10 * 60e3;   // a stance / focus lasts 10 minutes unless changed
const PENDING_MS = 20e3;       // an unanswered line older than this is dropped
const UNPROMPTED_GAP_MS = 20e3; // at most one unprompted line per bot per 20 s
const TEST_PROMPT = 'Trigger: the server admin is running a connection test (nobody is playing). Set "say" to a short in-character line confirming you can hear them (under 60 characters). Keep "order" none, "stance" keep, "focus" and "remember" empty, "plan" [].';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Notes per (bot name, player name), 5 each, the 400 most recent pairs. `dirty` holds the keys changed since the last
// save (server/ai/store.js keeps them across restarts).
export class Memory {
  constructor(max = 400) { this.max = max; this.m = new Map(); this.dirty = new Set(); }
  key(bot, player) { return `${String(bot).toLowerCase()}|${String(player).toLowerCase()}`; }
  get(bot, player) { return this.m.get(this.key(bot, player))?.notes || []; }
  add(bot, player, note) {
    if (!note) return;
    const k = this.key(bot, player), r = this.m.get(k) || { bot: String(bot).toLowerCase(), player: String(player).toLowerCase(), notes: [] };
    if (!r.notes.some(n => n.toLowerCase() === note.toLowerCase())) r.notes.push(note);
    r.notes = r.notes.slice(-5);
    this.m.delete(k); this.m.set(k, r); // most recent last
    this.dirty.add(k);
    while (this.m.size > this.max) { const old = this.m.keys().next().value; this.m.delete(old); this.dirty.delete(old); }
  }
  // rows from the store, oldest first; doesn't mark anything dirty (and never overwrites a note made since boot)
  load(rows) {
    for (const r of rows || []) {
      if (!r?.bot || !r?.player) continue;
      const k = this.key(r.bot, r.player);
      if (this.m.has(k)) continue;
      this.m.set(k, { bot: String(r.bot).toLowerCase(), player: String(r.player).toLowerCase(), notes: (r.notes || []).map(n => String(n).slice(0, 100)).filter(Boolean).slice(-5) });
    }
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
  }
  // the changed rows, and forget that they changed (put them back with markDirty if the save fails)
  takeDirty() {
    const keys = [...this.dirty]; this.dirty.clear();
    return { keys, rows: keys.map(k => this.m.get(k)).filter(Boolean).map(({ bot, player, notes }) => ({ bot, player, notes })) };
  }
  markDirty(keys) { for (const k of keys) if (this.m.has(k)) this.dirty.add(k); }
  get size() { return this.m.size; }
}

export class Minds {
  // cfg: readConfig(); provider: makeProvider(); listBots(): live bot objects; env: for the key check.
  // onThink(b, on): a bot started / stopped thinking about a line said to it (the "…" over its head).
  constructor({ cfg, provider, listBots = () => [], env = process.env, now = Date.now, log = console.log, onThink = null, mayOrder = null }) {
    this.mayOrder = mayOrder; // (bot, player id) -> may that player order it? (server/ai/index.js: the /b rule; null: any party member)
    this.cfg = cfg; this.provider = provider; this.listBots = listBots; this.env = env; this.now = now; this.log = log; this.onThink = onThink;
    this.store = null; this.flushing = null; this.spendSaved = 0; this.callsSaved = 0; this.lastTest = null; this.testing = false; this.flushes = 0;
    this.on = !!(cfg.startOn && this.ready());
    this.budget = new Budget(cfg, now);
    this.memory = new Memory();
    this.price = priceOf(cfg.model, env);
    this.state = new WeakMap();
    this.stats = { calls: 0, ok: 0, errors: 0, timeouts: 0, skipped: {}, tokIn: 0, tokOut: 0, cached: 0, ms: 0, lastError: '', lastErrorAt: 0 };
    this.recent = []; // last decisions, for the admin page
    if (!cfg.provider && !cfg.badProvider) { const k = Object.values(KEY_ENV).flat().find(n => envLookup(env, n)?.value); if (k) log(`[ai] companions off: AI_PROVIDER isn't set (${k} is)`); }
    if (cfg.badProvider) log(`[ai] unknown AI_PROVIDER "${cfg.badProvider}": companions stay off`);
    else if (cfg.provider) log(`[ai] companions: ${cfg.provider}/${cfg.model}, ${keyReport(cfg, env).text}, ${this.on ? 'ON' : 'off'}${cfg.startOn && !this.on ? ' (AI_ENABLED is set, but there is no key)' : ''}`);
  }

  ready() { return !!this.provider && hasKey(this.cfg, this.env); }
  active() { return this.on && this.ready(); }
  why() { return !this.cfg.provider ? (this.cfg.badProvider ? `unknown provider "${this.cfg.badProvider}"` : 'no AI_PROVIDER set') : !this.ready() ? `no key (${this.cfg.keyEnvs.join(' or ')})` : this.on ? 'on' : 'off'; }

  setEnabled(on) {
    if (on && !this.ready()) return { ok: false, error: `Can't turn on: ${this.why()}.` };
    this.on = !!on;
    this.log(`[ai] companions turned ${this.on ? 'ON' : 'off'}`);
    return { ok: true };
  }

  // ---------- what survives a restart (server/ai/store.js) ----------
  // Loads the memories and today's spend, then saves changes every flushMs (and on flush(): shutdown).
  async useStore(store, { flushMs = 15e3 } = {}) {
    if (!store || this.store || !this.cfg.provider) return false; // no provider: nothing to remember
    this.store = store;
    try {
      this.memory.load(await store.loadMemories());
      this.budget.rollDay();
      const day = this.budget.day, usd = await store.loadSpend(day);
      if (this.budget.day === day && usd > 0) { this.budget.daySpend += usd; this.budget.savedDay = day; } // (spend before this boot counts)
      const nUsd = (await store.loadNamedSpend?.(day)) || 0;
      if (this.budget.day === day && nUsd > 0) this.budget.named.daySpend += nUsd;
      await store.pruneMemories();
      this.log(`[ai] loaded ${this.memory.size} memories, $${usd.toFixed(4)} spent today before this start`);
    } catch (e) { this.log('[ai] could not load memories / spend:', redact(e?.message || e)); }
    await this.namedTalk?.useStore(store); // the Named's notes (server/ai/namedtalk.js)
    if (flushMs) { const t = setInterval(() => this.flush(), flushMs); t.unref?.(); this.flushTimer = t; }
    return true;
  }

  // Save changed memories and the spend since the last save. Never throws; overlapping calls share one save.
  flush() {
    if (!this.store) return Promise.resolve();
    return (this.flushing ||= (async () => {
      const { keys, rows } = this.memory.takeDirty();
      if (rows.length) try { await this.store.saveMemories(rows); } catch (e) { this.memory.markDirty(keys); this.log('[ai] memory save failed:', redact(e?.message || e)); }
      await this.namedTalk?.flush();
      const B = this.budget, usd = B.totalSpend - this.spendSaved, calls = B.calls - this.callsSaved;
      const nUsd = B.named.totalSpend - (this.namedSaved || 0), nCalls = B.named.calls - (this.namedCallsSaved || 0);
      if (usd > 0 || calls > 0) {
        try {
          await this.store.addSpend(B.day, usd, calls, nUsd, nCalls);
          this.spendSaved += usd; this.callsSaved += calls; this.namedSaved = (this.namedSaved || 0) + nUsd; this.namedCallsSaved = (this.namedCallsSaved || 0) + nCalls;
        } catch (e) { this.log('[ai] spend save failed:', redact(e?.message || e)); }
      }
      if (++this.flushes % 240 === 0) { await this.store.pruneMemories().catch(() => {}); await this.store.pruneNamedMemories?.().catch(() => {}); } // about once an hour
    })().finally(() => { this.flushing = null; }));
  }
  // ---------- admin "Test call": one tiny real call to prove the key, model and request shape work ----------
  async testCall() {
    const t0 = this.now();
    const done = r => (this.lastTest = { at: Date.now(), ...r });
    if (!this.provider) return done({ ok: false, error: `Can't test: ${this.why()}.` });
    if (!this.ready()) return done({ ok: false, error: `Can't test: no key (${this.cfg.keyEnvs.join(' or ')} isn't set).` });
    if (this.testing) return { ok: false, error: 'A test call is already running.' };
    if (this.lastTest && Date.now() - this.lastTest.at < 3000) return { ok: false, error: 'Wait a few seconds between tests.' };
    this.testing = true;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    timer.unref?.();
    this.budget.start(null);
    let res = { ok: false, test: true };
    const base = { provider: this.cfg.provider, model: this.cfg.model, key: keyHint(apiKey(this.cfg, this.env)) };
    try {
      const r = await Promise.race([
        this.provider.call({ system: SYSTEM, user: TEST_PROMPT, schema: INTENT_SCHEMA, maxTokens: this.cfg.maxOutTokens, signal: ctl.signal }),
        new Promise((_, rej) => ctl.signal.addEventListener('abort', () => rej(Object.assign(new Error('timed out'), { kind: 'timeout' })))),
      ]);
      const cost = costOf(r.usage, this.price);
      res = { ok: true, test: true, usage: r.usage, cost };
      if (this.budget.pausedUntil > this.now() && /errors in a row/.test(this.budget.pauseWhy)) this.budget.pausedUntil = 0; // fixed: stop waiting
      return done({ ok: true, ...base, ms: this.now() - t0, cost, usage: r.usage, say: sanitizeIntent(r.intent).say });
    } catch (e) {
      const kind = e?.kind || 'error';
      return done({ ok: false, ...base, ms: this.now() - t0, error: kind === 'timeout' ? `timed out after ${this.cfg.timeoutMs} ms` : redact(e?.message || String(e)) });
    } finally {
      clearTimeout(timer);
      this.testing = false;
      this.budget.end(null, res);
    }
  }

  st(b) {
    let s = this.state.get(b);
    if (!s) this.state.set(b, s = { party: b.party, chat: [], events: [], pending: null, busy: false, lastThink: 0, lastSaid: 0, sig: '', stance: 'balanced', stanceUntil: 0, focusId: 0, backT: -99, calls: 0 });
    if (s.party !== b.party) Object.assign(s, { party: b.party, chat: [], events: [], pending: null, stance: 'balanced', stanceUntil: 0, focusId: 0, sig: '' });
    return s;
  }

  // A bot with a human party member gets a mind (up to AI_MAX_BOTS of them).
  companion(b) { return !b.closed && !!b.me && !!b.party && partyMates(b).some(p => !isBotId(b, p.id)); }

  // ---------- the brain's onEvent hook ----------
  onEvent(b, e) {
    if (!this.active() || !b || !e || !b.party) return;
    if (e.t === 'chat') return this.onChat(b, e);
    const mate = id => partyMates(b).some(p => p.id === id);
    let text = null;
    if (e.t === 'pdie' && (e.id === b.id || mate(e.id))) text = `${nameOfId(b, e.id)} went down`;
    else if (e.t === 'lvl' && (e.id === b.id || mate(e.id))) text = `${nameOfId(b, e.id)} reached level ${e.lvl}`;
    else if (e.t === 'die' && e.b) text = 'a boss was defeated';
    else if (e.t === 'stagger' && mate(e.by)) text = `${nameOfId(b, e.by)} Broke an enemy (Switch window)`;
    if (text) { const s = this.st(b); s.events.push({ t: this.now(), text }); s.events = s.events.slice(-10); }
  }

  onChat(b, e) {
    const text = String(e.text || '').trim();
    if (!text) return;
    const s = this.st(b), inParty = e.ch === 'p' ? e.party === b.party : partyMates(b).some(p => p.id === e.id);
    if (!(inParty || e.id === b.id)) return; // other parties' talk isn't ours
    if (!text.startsWith('/')) { s.chat.push({ t: this.now(), from: e.id === b.id ? `${b.name} (you)` : e.from, text: text.slice(0, 160) }); s.chat = s.chat.slice(-10); }
    if (e.id === b.id || isBotId(b, e.id) || text.startsWith('/')) return;
    if (!partyMates(b).some(p => p.id === e.id)) return; // only party members talk to their companions
    const first = String(b.name).split(' ')[0];
    if (!new RegExp(`(^|[^\\w])(${esc(b.name)}|${esc(first)})([^\\w]|$)`, 'i').test(text)) return;
    s.pending = { kind: 'chat', id: e.id, name: e.from, text: text.slice(0, 200), t: this.now() };
    this.kick(b);
  }

  // ---------- once a second ----------
  tick() {
    if (!this.active()) return;
    let n = 0;
    for (const b of this.listBots()) {
      if (!this.companion(b)) continue;
      if (++n > this.cfg.maxBots) break;
      const s = this.st(b);
      this.steer(b, s);
      if (s.pending && this.now() - s.pending.t > PENDING_MS) s.pending = null;
      if (s.pending) { this.kick(b); continue; }
      if (this.cfg.thinkS > 0 && !s.busy && this.now() - s.lastThink >= this.cfg.thinkS * 1000) {
        const sig = this.signature(b, s);
        if (sig !== s.sig) { s.sig = sig; this.kick(b, { kind: 'tick' }); }
      }
    }
  }

  // Something worth a fresh look? (area, rough HP, enemies in view, deaths, new events or chat)
  signature(b, s) {
    const near = (b.mobs || []).filter(m => Math.hypot(m.x - b.x, m.z - b.z) < 30).map(m => m.type).sort().join(',');
    const mates = partyMates(b).map(p => `${p.id}:${Math.round(4 * p.hp / (p.maxHp || 1))}:${p.dead ? 1 : 0}`).join(',');
    return [Math.round(4 * b.hp / (b.maxHp || 1)), b.dead ? 1 : 0, near, mates, s.events.length && s.events.at(-1).t, s.chat.length && s.chat.at(-1).t].join('|');
  }

  // Stance and focus, applied through the brain's own knobs (b.backOff, b.healFocus, b.lastCmdBy).
  steer(b, s) {
    if (s.stanceUntil && this.now() > s.stanceUntil) { s.stance = 'balanced'; s.focusId = 0; s.stanceUntil = 0; }
    if (b.dead) return;
    const low = b.hp / (b.maxHp || 1);
    if (s.stance === 'defensive' && b.role !== 'tank' && b.tgtId && low < 0.5 && b.t - s.backT > 5) { s.backT = b.t; b.backOff = b.t + 1.5; }
    if (s.stance === 'aggressive' && b.backOff > b.t) b.backOff = 0;
    if (s.focusId) {
      if (!partyMates(b).some(p => p.id === s.focusId)) s.focusId = 0;
      else if (b.role === 'healer') b.healFocus = { id: s.focusId, until: b.t + 5 };
    }
  }

  // ---------- one call ----------
  kick(b, trig = null) {
    const s = this.st(b);
    if (s.busy) return;
    const t = trig || s.pending;
    if (!t) return;
    const ok = this.budget.allow(b);
    if (!ok.ok) {
      this.stats.skipped[ok.why] = (this.stats.skipped[ok.why] || 0) + 1;
      if (ok.hard) s.pending = null; // no point waiting: the bot just plays on
      return;
    }
    if (t.kind === 'chat') s.pending = null;
    s.busy = true; s.lastThink = this.now();
    this.think(b, s, t).catch(err => this.log('[ai] mind error', err?.message || err)).finally(() => { s.busy = false; });
  }

  async think(b, s, trig) {
    const t0 = this.now(), ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    timer.unref?.();
    this.budget.start(b);
    this.stats.calls++; s.calls++;
    const shown = trig.kind === 'chat' && this.think1(b, true); // only a line said to it shows the "…"
    let r = null, res = { ok: false, kind: 'error' };
    try {
      const user = summarize(b, s, trig, this.memory, this.now());
      r = await Promise.race([
        this.provider.call({ system: SYSTEM, user, schema: INTENT_SCHEMA, maxTokens: this.cfg.maxOutTokens, signal: ctl.signal }),
        new Promise((_, rej) => ctl.signal.addEventListener('abort', () => rej(Object.assign(new Error('timed out'), { kind: 'timeout' })))),
      ]);
      const cost = costOf(r.usage, this.price);
      res = { ok: true, usage: r.usage, cost };
      const ms = this.now() - t0;
      Object.assign(this.stats, { ok: this.stats.ok + 1, tokIn: this.stats.tokIn + (r.usage.in || 0) + (r.usage.cacheRead || 0) + (r.usage.cacheWrite || 0), tokOut: this.stats.tokOut + (r.usage.out || 0), cached: this.stats.cached + (r.usage.cacheRead || 0), ms: this.stats.ms + ms });
      if (b.closed) return;
      const intent = sanitizeIntent(r.intent);
      const did = this.apply(b, s, intent, trig);
      this.recent.push({ at: Date.now(), bot: b.name, trig: trig.kind === 'chat' ? `${trig.name}` : 'check-in', ...did, ms, cost });
      this.recent = this.recent.slice(-8);
    } catch (e) {
      const kind = e?.kind || 'error';
      res = { ok: false, kind, retryAfter: e?.retryAfter || 0, usage: null };
      if (kind === 'timeout') this.stats.timeouts++; else this.stats.errors++;
      this.stats.lastError = redact(e?.message || String(e)); this.stats.lastErrorAt = Date.now();
    } finally {
      clearTimeout(timer);
      if (shown) this.think1(b, false);
      this.budget.end(b, res);
    }
  }

  think1(b, on) { try { this.onThink?.(b, on); return true; } catch { return false; } }

  // Put a sanitized intent into the game. Orders, plans, stance and focus only answer a party member who spoke to us
  // (and, for orders and plans, one who may order this bot: mayOrder, the same rule as /b).
  apply(b, s, it, trig) {
    const did = { say: '', order: 'none', stance: 'keep', focus: '' };
    const speaker = trig.kind === 'chat' ? partyMates(b).find(p => p.id === trig.id && !isBotId(b, p.id)) : null;
    let plan = null;
    if (speaker) {
      const byName = nameOfId(b, speaker.id), may = !this.mayOrder || !!this.mayOrder(b, speaker.id);
      const same = !!b.plan && JSON.stringify(b.plan.steps) === JSON.stringify(it.plan); // the model repeating the plan that is already running: let it carry on
      if (may && it.plan?.length && typeof b.setPlan === 'function') { if (!same) plan = { steps: it.plan, o: { by: speaker.id, byName, at: [speaker.x, speaker.z], group: [b.id] } }; } // (given after our line, below)
      else if (may && it.order !== 'none' && typeof b.command === 'function') {
        const c = { k: it.order, by: speaker.id, byName, tgt: b.locks?.get(speaker.id) || 0, group: [b.id], all: false, adm: false };
        if (it.say) { // our own line replaces the canned acknowledgement
          const send = b.send;
          b.send = o => (o?.type === 'chat' ? true : send(o));
          try { b.command(c); } finally { b.send = send; }
        } else b.command(c);
        did.order = it.order;
      }
      if (it.stance !== 'keep') { s.stance = it.stance; s.stanceUntil = this.now() + STANCE_MS; did.stance = it.stance; }
      if (it.focus) {
        if (it.focus.toLowerCase() === 'none') { s.focusId = 0; did.focus = 'none'; }
        else {
          const want = it.focus.toLowerCase().replace(/^me$/, byName.toLowerCase());
          const p = [...partyMates(b)].find(p => nameOfId(b, p.id).toLowerCase() === want) || partyMates(b).find(p => nameOfId(b, p.id).toLowerCase().startsWith(want));
          if (p) {
            s.focusId = p.id; s.stanceUntil ||= this.now() + STANCE_MS; did.focus = nameOfId(b, p.id);
            if (!isBotId(b, p.id)) b.lastCmdBy = p.id; // the brain anchors on the human who last spoke to it
            if (b.role === 'healer') b.healFocus = { id: p.id, until: b.t + 5 };
          }
        }
      }
      if (it.remember) this.memory.add(b.name, byName, it.remember);
    }
    if (it.say && (speaker || this.now() - s.lastSaid >= UNPROMPTED_GAP_MS)) {
      say(b, 'mind', {}, { force: true, text: it.say });
      s.lastSaid = this.now(); did.say = it.say;
    }
    if (plan) { const c = b.setPlan(plan.steps, plan.o); if (c) did.plan = planText(c).replace(/^Plan: /, ''); } // (the bot says its plan itself)
    return did;
  }

  // ---------- admin page ----------
  status() {
    const S = this.stats, B = this.budget;
    B.rollDay();
    const live = this.active() ? this.listBots().filter(b => this.companion(b)).length : 0;
    return {
      on: this.on, active: this.active(), state: this.why(), provider: this.cfg.provider || null, model: this.cfg.model || null,
      keyEnv: this.cfg.keyEnvs.join(' or ') || null, keySet: this.ready(), keyCheck: this.cfg.provider ? keyReport(this.cfg, this.env) : null, priceKnown: this.price.known,
      price: { in: this.price.in, out: this.price.out },
      minds: Math.min(live, this.cfg.maxBots), calls: S.calls, ok: S.ok, errors: S.errors, timeouts: S.timeouts, skipped: S.skipped,
      tokensIn: S.tokIn, tokensOut: S.tokOut, cachedIn: S.cached, avgMs: S.ok ? Math.round(S.ms / S.ok) : 0,
      spendToday: +B.daySpend.toFixed(5), spendTotal: +B.totalSpend.toFixed(5), dailyCap: this.cfg.dailyUsd,
      paused: B.pausedUntil > this.now() ? { why: B.pauseWhy, s: Math.ceil((B.pausedUntil - this.now()) / 1000) } : null,
      lastError: S.lastError || null, lastErrorAt: S.lastErrorAt || null, memories: this.memory.size, saved: !!this.store, recent: this.recent,
      lastTest: this.lastTest, testing: this.testing, named: this.namedTalk?.status() || null,
      limits: { thinkS: this.cfg.thinkS, botMinGapS: this.cfg.botMinGapS, botTokensHour: this.cfg.botTokensHour, maxCallsMin: this.cfg.maxCallsMin, maxConcurrent: this.cfg.maxConcurrent, timeoutMs: this.cfg.timeoutMs, maxBots: this.cfg.maxBots },
      line: this.line(),
    };
  }

  line() {
    const S = this.stats, B = this.budget;
    if (!this.active()) return `AI companions: ${this.on ? 'ON but ' : ''}${this.why()}${S.calls ? ` · ${S.calls} calls · $${B.totalSpend.toFixed(4)} so far` : ''}`;
    return `AI companions: ON · ${this.cfg.provider}/${this.cfg.model} · ${S.calls} calls (${S.errors + S.timeouts} failed) · $${B.daySpend.toFixed(4)} today of $${this.cfg.dailyUsd.toFixed(2)}${this.price.known ? '' : ' (price guessed)'} · avg ${S.ok ? Math.round(S.ms / S.ok) : 0} ms`;
  }
}
