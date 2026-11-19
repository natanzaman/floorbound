// The Named's requests and invitations (docs/ROADMAP.md I4). Data and pure rules: shared/namedquests.js.
// new NamedQuests(namedManager, { store }) attaches itself as `named.quests` and hooks a few of the manager's methods
// (on that instance only: server/named.js is unchanged), so without a NamedManager (NAMED_ENABLED=0) none of it exists.
//
//  requests    one offer at a time per Named (rolled from their templates when one is due), taken from the Friends tab;
//              at most one active request per Named per player, lasting REQ.ttl. Kill requests count kills of that
//              mob a human took part in (m.contributors: a Named-only kill never counts); boss requests finish on
//              real help in their boss fight (the manager's 'boss' gain); materials are handed over near them (or
//              while talking: turnIn(p, id, { talk: true }) for I3). Rewards: friendship ('request' source, its own
//              cap of REQ.friendDaily a day per Named), gold, now and then a rolled item. Saved per character
//              (named_requests); anonymous players keep theirs for the session.
//  outreach    at Friend and above a Hero may message a free, online player to come farming or raiding (Accept /
//              Decline): OUTREACH.cd per Named per player, OUTREACH.gap between any two, none from a Named you turned
//              down this session, none during a director show, none while you or they are in a boss fight. Accept:
//              they join your party (the usual busy, one-per-party and party-full rules) and come to you.
//  phrasing    phrase(def, req, player, moment) is the canned line (shared/namedquests.js phraseRequest). I3 sets
//              quests.phraser = async (def, req, player, moment) => text (server/ai/namedtalk.js phrase()): an offer
//              is shown once phrased (and its line kept on the offer, then the request: never phrased twice); the
//              thank-you and an invitation go out once phrased. An empty answer, an error or PHRASE_WAIT ms without
//              one keeps the canned line. Expired and declined lines stay canned.
//  talk        talkContext(p, id) is what I3's talk prompt knows of your requests with that Named: the active one and
//              one finished, dropped or lapsed in the last RECENT_REQ ms.
//
// Client messages: { type: 'named', op: 'req', id, act: 'take' | 'drop' | 'turnin' } and { type: 'named', op: 'out',
// id, yes } (TEST_HOOKS=1 also: { op: 'out', test: 1, id } and { op: 'req', test: 1, id, got }). Server: { type: 'named', op: 'req', ev: 'progress' | 'done' | 'expired', … } and { type: 'named', op: 'out',
// id, name, kind, text, until }; Friends tab rows carry `req` (cardFor).
import { MOBS, PARTY_MAX, inArena } from '../shared/data.js';
import { floorOf, inArena2 } from '../shared/floor2.js';
import { inArena3 } from '../shared/floor3.js';
import { SLOTS } from '../shared/items.js';
import { MATS } from '../shared/crafting.js';
import { rollGear, rollTable } from '../shared/loot.js';
import { NAMED_BY_ID, TIERS, tierIndex, tierAt, dayKey } from '../shared/named.js';
import {
  REQ, OUTREACH, PERSONA, FLOOR_REQ, BOSS_BAND, rollRequest, kindsFor, rewardFor, goalText, progressOf, phraseRequest,
} from '../shared/namedquests.js';

const isHuman = p => !!p && !p.bot;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const inBossRoom = p => inArena(p.x, p.z) || inArena2(p.x, p.z) || inArena3(p.x, p.z);
const newRec = () => ({ req: null, offer: null, nextAt: 0, day: 0, got: 0, last: null });
export const PHRASE_WAIT = 3500;        // ms: the most a phrased line may hold up a card, a thank-you or an invitation
export const RECENT_REQ = 3 * 3600e3;   // ms: a finished, dropped or lapsed request is still on their mind this long
const lastOf = (req, ev, at) => ({ k: req.k, n: req.n, ...(req.mob ? { mob: req.mob } : {}), ...(req.mat ? { mat: req.mat } : {}), ev, at });

// ---------- Postgres (server/db.js makes the table) ----------
export function makeQuestStore(q) {
  return {
    load: charId => q('SELECT named_id, req, next_at, day, got FROM named_requests WHERE char_id = $1', [charId]),
    save: (charId, id, r) => q(`INSERT INTO named_requests (char_id, named_id, req, next_at, day, got, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (char_id, named_id) DO UPDATE SET req = EXCLUDED.req, next_at = EXCLUDED.next_at, day = EXCLUDED.day, got = EXCLUDED.got, updated_at = now()`,
      [charId, id, r.req ? JSON.stringify(r.req) : null, Math.round(r.nextAt || 0), r.day | 0, r.got || 0]),
  };
}

export class NamedQuests {
  constructor(nm, { store = null, rnd = Math.random } = {}) {
    this.nm = nm; this.game = nm.game; this.store = store; this.rnd = rnd;
    this.recs = new Map();    // player key -> Map(named id -> { req, offer, nextAt, day, got }) (m.loaded)
    this.dirty = new Set();   // `${charId}:${namedId}`
    this.outs = new Map();    // player key -> { at, per: { id: at }, no: Set (declined this session), open, checkAt }
    this.phraser = null;      // I3: AI phrasing (see the top)
    this.flushAt = 0;
    nm.quests = this;
    const wrap = (name, fn) => { const orig = nm[name].bind(nm); nm[name] = (...a) => fn(orig, ...a); };
    wrap('tick', orig => { const out = orig(); this.upkeep(); return out; });
    wrap('handle', (orig, p, msg) => (msg?.op === 'req' || msg?.op === 'out' ? this.handle(p, msg) : orig(p, msg)));
    wrap('listFor', (orig, h) => { const l = orig(h); for (const r of l.rows) r.req = this.cardFor(h, r.id); return l; });
    wrap('dropFriends', (orig, p) => { this.drop(p); return orig(p); });
    wrap('flush', orig => Promise.allSettled([orig(), this.flush()]));
    wrap('onMobDead', (orig, m, killer) => { this.onKill(m); return orig(m, killer); });
    wrap('add', (orig, p, id, amount, reason) => { const r = orig(p, id, amount, reason); if (reason === 'boss') this.onBoss(p, id); return r; });
  }
  useStore(store) { this.store = store; }
  now() { return this.nm.now(); }

  // ---------- records ----------
  recsOf(p) {
    const key = this.nm.keyOf(p);
    let m = this.recs.get(key);
    if (!m) { this.recs.set(key, m = new Map()); m.loaded = !(p.charId && this.store); }
    if (!m.loaded && !m.loading && this.now() - (m.failAt || -1e15) >= 5000) this.load(p.charId, key, m);
    return m;
  }
  load(charId, key, m) {
    m.loading = true;
    return Promise.resolve().then(() => this.store.load(charId)).then(rows => {
      m.loading = false;
      if (this.recs.get(key) !== m) return;
      for (const r of rows) {
        if (!this.nm.chars.has(r.named_id)) continue;
        const req = typeof r.req === 'string' ? JSON.parse(r.req) : r.req || null;
        m.set(r.named_id, { ...newRec(), req, nextAt: +r.next_at || 0, day: r.day | 0, got: +r.got || 0 });
      }
      m.loaded = true;
    }, e => { m.loading = false; m.failAt = this.now(); console.error('[namedquests] load failed:', e.message); });
  }
  rec(p, id) { const m = this.recsOf(p); let r = m.get(id); if (!r) m.set(id, r = newRec()); return r; }
  touch(p, id) { if (p.charId) this.dirty.add(`${p.charId}:${id}`); }
  drop(p) { this.flush(p.charId || 0); const key = this.nm.keyOf(p); this.recs.delete(key); this.outs.delete(key); }
  flush(only = 0) {
    if (!this.store) { this.dirty.clear(); return Promise.resolve(); }
    const writes = [];
    for (const key of [...this.dirty]) {
      const [cid, id] = key.split(':'), charId = +cid;
      if (only && charId !== only) continue;
      const m = this.recs.get(charId);
      if (m && !m.loaded) continue;
      this.dirty.delete(key);
      const r = m?.get(id);
      if (r) writes.push(this.store.save(charId, id, r).catch(e => { this.dirty.add(key); console.error('[namedquests] save failed:', e.message); }));
    }
    return Promise.all(writes);
  }

  // ---------- phrasing (the hook for I3) ----------
  phrase(def, req, player, moment = 'offer') { return phraseRequest(def, req, player, moment, this.rnd); }
  // The canned line now (obj.text); with a phraser, an AI line replaces it if one comes back within PHRASE_WAIT
  // (obj.phrasing is set until then). Resolves with the final text.
  // A phraser may answer at once ('' or a line, not a promise): then nothing waits (AI off, a cap: the usual case).
  phraseInto(obj, def, req, player, moment = 'offer') {
    obj.text = this.phrase(def, req, player, moment);
    if (typeof this.phraser !== 'function') return Promise.resolve(obj.text);
    let first;
    try { first = this.phraser(def, req, player, moment); } catch { first = ''; }
    if (typeof first?.then !== 'function') {
      if (typeof first === 'string' && first.trim()) obj.text = first.trim().slice(0, 240);
      return Promise.resolve(obj.text);
    }
    obj.phrasing = true;
    let timer = null;
    const wait = new Promise(res => { timer = setTimeout(res, PHRASE_WAIT, ''); timer.unref?.(); });
    return Promise.race([first, wait])
      .then(t => { if (typeof t === 'string' && t.trim()) obj.text = t.trim().slice(0, 240); }, () => {})
      .then(() => { clearTimeout(timer); delete obj.phrasing; return obj.text; });
  }
  // deliver(text) with the line for this moment: at once (canned) without a phraser, else once phrased.
  phraseThen(def, req, player, moment, deliver) {
    const obj = {}, run = t => { try { deliver(t); } catch (e) { console.error('[namedquests] deliver', e); } };
    const later = this.phraseInto(obj, def, req, player, moment);
    if (obj.phrasing) later.then(run); else run(obj.text);
  }
  online(p) { return this.game.players.get(p.id) === p; }

  // ---------- requests ----------
  ctx(p, id) { return { pts: this.nm.peek(p, id)?.pts || 0, lvl: p.lvl, floor: floorOf(p.x) || 1 }; }
  // The current offer from this Named to this player (rolled when one is due), or null.
  offerFor(p, id, now = this.now()) {
    const def = NAMED_BY_ID[id], P = PERSONA[id], m = this.recsOf(p);
    if (!def || !P || !m.loaded) return null;
    const r = this.rec(p, id), ctx = this.ctx(p, id);
    if (r.req) return null;
    if (r.offer && now - r.offer.at < REQ.offerLife * 1000 && kindsFor(def, ctx).some(([k]) => k === r.offer.k)) return r.offer;
    r.offer = null;
    if (now < r.nextAt) return null;
    if (!kindsFor(def, ctx).length) return null; // (nothing until the tier is reached: no roll spent)
    if (this.rnd() >= P.ask) { r.nextAt = now + P.every * 1000; this.touch(p, id); return null; } // the loner rarely asks
    const req = rollRequest(def, ctx, this.rnd);
    if (!req) return null;
    r.offer = { ...req, at: now };
    this.phraseInto(r.offer, def, req, p);
    return r.offer;
  }
  take(p, id) {
    const def = NAMED_BY_ID[id], r = this.rec(p, id), now = this.now();
    if (r.req) return 'You already have a request from them.';
    const o = this.offerFor(p, id, now);
    if (!o) return `${def.name} has nothing to ask of you right now.`;
    r.req = { k: o.k, n: o.n, ...(o.mob ? { mob: o.mob } : {}), ...(o.mat ? { mat: o.mat } : {}), floor: o.floor, got: 0, at: now, until: now + REQ.ttl * 1000, text: o.text };
    r.offer = null;
    this.touch(p, id);
    this.game.track(p, 'named_req', { named: id, k: r.req.k, ev: 'take' });
    return '';
  }
  abandon(p, id) {
    const r = this.rec(p, id);
    if (!r.req) return 'No request to drop.';
    this.game.track(p, 'named_req', { named: id, k: r.req.k, ev: 'drop' });
    r.last = lastOf(r.req, 'dropped', this.now());
    r.req = null; r.nextAt = this.now() + REQ.dropAfter * 1000;
    this.touch(p, id);
    return '';
  }
  have(p, mat) { return p.inv?.mats?.[mat] || 0; }
  // Why the materials can't be handed over now ('' = they can). talk: the player is talking to them (I3).
  turnInBlock(p, id, { talk = false } = {}) {
    const def = NAMED_BY_ID[id], r = this.rec(p, id), np = this.nm.playerOf(this.nm.chars.get(id));
    if (r.req?.k !== 'bring') return 'Nothing to hand over.';
    if (this.have(p, r.req.mat) < r.req.n) return `You need ${r.req.n} ${MATS[r.req.mat]?.name || r.req.mat} (you have ${this.have(p, r.req.mat)}).`;
    if (talk) return '';
    if (!np) return `${def.name} isn't around right now.`;
    if (p.dead || np.dead || floorOf(p.x) !== floorOf(np.x) || dist(p, np) > REQ.turnInR) return `Find ${def.name} to hand it over (within ${REQ.turnInR} m).`;
    return '';
  }
  turnIn(p, id, opts = {}) {
    const why = this.turnInBlock(p, id, opts);
    if (why) return why;
    const r = this.rec(p, id);
    p.inv.mats[r.req.mat] -= r.req.n;
    r.req.got = r.req.n;
    this.complete(p, id);
    return '';
  }
  // A field mob died: count it for every human who took part (never a Named-only kill).
  onKill(m) {
    if (!m?.contributors?.size || m.def?.boss || m.temp || m.rare) return;
    const now = this.now();
    for (const pid of m.contributors) {
      const h = this.game.players.get(pid);
      if (!isHuman(h)) continue;
      const map = this.recs.get(this.nm.keyOf(h));
      if (!map) continue;
      for (const [id, r] of map) {
        if (r.req?.k !== 'kill' || r.req.mob !== m.type || now > r.req.until) continue;
        r.req.got = Math.min(r.req.n, (r.req.got || 0) + 1);
        this.touch(h, id);
        if (r.req.got >= r.req.n) this.complete(h, id);
        else this.nm.send(h, { op: 'req', ev: 'progress', id, name: NAMED_BY_ID[id].name, goal: goalText(r.req), got: r.req.got, n: r.req.n });
      }
    }
  }
  // Real help in their boss fight (the manager's 'boss' gain): a boss request with this Named is done.
  onBoss(h, id) {
    if (!isHuman(h)) return;
    const r = this.recs.get(this.nm.keyOf(h))?.get(id);
    if (r?.req?.k !== 'boss' || this.now() > r.req.until) return;
    r.req.got = 1;
    this.complete(h, id);
  }
  // Pay out and close it.
  complete(p, id) {
    const g = this.game, def = NAMED_BY_ID[id], r = this.rec(p, id), req = r.req, now = this.now();
    if (!req) return null;
    const pay = rewardFor(req, p.lvl, this.rnd);
    // friendship: the 'request' source, at most REQ.friendDaily a day per Named (after their rate)
    const day = dayKey(now);
    if (r.day !== day) { r.day = day; r.got = 0; }
    const rate = def.trust.rate.request ?? 1, want = pay.friend * rate, room = Math.max(0, REQ.friendDaily - r.got);
    let fr = 0;
    if (rate > 0 && want > 0 && room > 0) {
      const res = this.nm.add(p, id, Math.min(want, room) / rate, 'request');
      fr = res?.d || 0;
      r.got = r2(r.got + fr);
    }
    p.gold += pay.gold;
    let item = null;
    if (pay.item) {
      const slot = SLOTS[Math.floor(this.rnd() * SLOTS.length)];
      const it = rollGear(slot, rollTable(pay.item, this.rnd), p.cls, this.rnd, undefined, 'roll');
      if (g.giveItem(p, it)) item = { name: it.name, r: it.r };
    }
    g.invChanged(p);
    const goal = goalText(req);
    r.req = null; r.nextAt = now + (PERSONA[id]?.every ?? 2700) * 1000; r.last = lastOf(req, 'done', now);
    this.touch(p, id);
    g.sys(`Request done for ${def.name}: ${goal}. +${pay.gold} gold${item ? `, ${item.name}` : ''}${fr > 0 ? `, +${r2(fr)} friendship` : ''}.`, p.id);
    this.phraseThen(def, req, p, 'done', text => { // their thanks: a bubble if you're close, and on the toast
      if (!this.online(p)) return;
      const np = this.nm.playerOf(this.nm.chars.get(id));
      if (np && dist(np, p) < 40 && floorOf(np.x) === floorOf(p.x)) this.nm.say(np, text);
      this.nm.send(p, { op: 'req', ev: 'done', id, name: def.name, goal, gold: pay.gold, item, fr: r2(fr), text });
    });
    g.track(p, 'named_req', { named: id, k: req.k, ev: 'done', gold: pay.gold, fr: r2(fr), ...(item ? { r: item.r } : {}) });
    return { gold: pay.gold, item, fr };
  }
  expire(p, id, now) {
    const r = this.rec(p, id), def = NAMED_BY_ID[id];
    this.game.track(p, 'named_req', { named: id, k: r.req.k, ev: 'expired' });
    const goal = goalText(r.req);
    r.last = lastOf(r.req, 'expired', now);
    r.req = null; r.nextAt = now + REQ.dropAfter * 1000;
    this.touch(p, id);
    this.nm.send(p, { op: 'req', ev: 'expired', id, name: def.name, goal, text: this.phrase(def, null, p, 'expired') });
  }

  // The Friends tab's request card for one Named.
  cardFor(h, id) {
    if (!isHuman(h)) return null;
    const def = NAMED_BY_ID[id], m = this.recsOf(h), now = this.now();
    if (!def || !m.loaded) return null;
    const r = this.rec(h, id), day = dayKey(now), left = r2(Math.max(0, REQ.friendDaily - (r.day === day ? r.got : 0)));
    const gold = q => rewardFor(q, h.lvl, () => 1).gold;
    if (r.req) { // (time left in minutes: the tab redraws only when something it shows changes)
      const q = r.req, got = q.k === 'bring' ? Math.min(q.n, this.have(h, q.mat)) : q.got || 0;
      const turn = q.k === 'bring' ? this.turnInBlock(h, id) : null;
      return { state: 'active', k: q.k, goal: goalText(q), text: q.text, n: q.n, got, prog: r2(progressOf({ ...q, got })), mins: Math.max(0, Math.ceil((q.until - now) / 60000)), gold: gold(q), left, ...(turn !== null ? { turnIn: turn ? { ok: false, why: turn } : { ok: true } } : {}) };
    }
    const o = this.offerFor(h, id, now);
    if (o?.phrasing) return { state: 'none', why: '' }; // (shown once it is in their words: a moment at most)
    if (o) return { state: 'offer', k: o.k, goal: goalText(o), text: o.text, n: o.n, gold: gold(o), left, ttl: REQ.ttl };
    const P = PERSONA[id], ti = tierIndex(this.nm.peek(h, id)?.pts || 0);
    if (P && ti < tierAt(P.from)) return { state: 'none', why: `${def.name} only asks favours of someone ${TIERS[tierAt(P.from)].name} or closer.` };
    return { state: 'none', why: now < r.nextAt ? `${def.name} has nothing for you right now.` : '' };
  }

  // What I3's talk prompt knows of this player's requests with this Named (null: nothing to mention). Small on purpose.
  // -> { now: { k, n, mob, mat, got, mins (left), ready (materials in hand, near) }, last: { k, n, mob, mat, ev, mins (ago) } }
  talkContext(p, id, { near = false } = {}) {
    if (!isHuman(p)) return null;
    const r = this.recs.get(this.nm.keyOf(p))?.get(id), now = this.now();
    if (!r) return null;
    const out = {};
    if (r.req && now <= r.req.until) {
      const q = r.req, got = q.k === 'bring' ? Math.min(q.n, this.have(p, q.mat)) : q.got || 0;
      out.now = { k: q.k, n: q.n, ...(q.mob ? { mob: q.mob } : {}), ...(q.mat ? { mat: q.mat } : {}), got, mins: Math.max(1, Math.ceil((q.until - now) / 60000)), ready: q.k === 'bring' && got >= q.n && near };
    }
    if (r.last && now - r.last.at < RECENT_REQ) { const { at, ...l } = r.last; out.last = { ...l, mins: Math.floor((now - at) / 60000) }; }
    return out.now || out.last ? out : null;
  }

  // ---------- outreach ----------
  outOf(p) { const key = this.nm.keyOf(p); let o = this.outs.get(key); if (!o) this.outs.set(key, o = { at: -1e15, per: {}, no: new Set(), open: null, checkAt: 0, since: this.now() }); return o; }
  // Why this Named won't message this player now ('' = they may).
  outBlock(h, st, now) {
    const g = this.game, def = st.def, np = this.nm.playerOf(st), o = this.outOf(h);
    if (!PERSONA[def.id]?.outreach) return 'never';
    if (!np && !this.nm.resting?.(st)) return 'away'; // (resting at home: an Accept wakes them, server/named.js)
    if (tierIndex(this.nm.peek(h, def.id)?.pts || 0) < tierAt('friend')) return 'tier';
    if (o.no.has(def.id)) return 'declined';
    if (now - (o.per[def.id] ?? -1e15) < OUTREACH.cd * 1000) return 'cooldown';
    if (np && (this.nm.hostOf(np) || np.dead || np.downed || inBossRoom(np) || g.activeFightOf?.(np))) return 'busy';
    const party = g.partyOf(h);
    if (this.nm.namedInParty(party).length || (party?.members.length || 1) >= PARTY_MAX) return 'party';
    return '';
  }
  outreach(humans, now) {
    const g = this.game;
    if (g.director?.running || this.nm.parked) return;
    for (const h of humans) {
      const o = this.outOf(h);
      if (o.open && now > o.open.until) o.open = null; // lapsed: counts as sent, not as a "no"
      if (o.open || now < o.checkAt) continue;
      o.checkAt = now + OUTREACH.every * 1000;
      if (now - o.since < OUTREACH.settle * 1000 || now - o.at < OUTREACH.gap * 1000) continue;
      if (h.dead || h.downed || inBossRoom(h) || g.activeFightOf?.(h)) continue; // never mid-boss
      const ok = [...this.nm.chars.values()].filter(st => !this.outBlock(h, st, now));
      if (!ok.length || this.rnd() >= OUTREACH.chance) continue;
      this.send(h, ok[Math.floor(this.rnd() * ok.length)], now);
    }
  }
  send(h, st, now = this.now()) {
    const def = st.def, np = this.nm.playerOf(st), o = this.outOf(h), floor = floorOf(h.x) || 1, boss = FLOOR_REQ[floor]?.boss;
    if (!np && !this.nm.resting?.(st)) return null;
    const raid = !!boss && h.lvl >= (MOBS[boss]?.level ?? 99) - BOSS_BAND && this.rnd() < OUTREACH.raid;
    const msg = { k: raid ? 'raid' : 'farm', boss, area: FLOOR_REQ[floor]?.area || 'the field' };
    const open = o.open = { id: def.id, kind: msg.k, until: now + OUTREACH.ttl * 1000 };
    o.at = now; o.per[def.id] = now; // (the limits count from now, before it is phrased)
    this.game.track(h, 'named_out', { named: def.id, kind: msg.k, ev: 'sent' });
    this.phraseThen(def, msg, h, msg.k, text => {
      if (o.open !== open || !this.online(h)) return; // (gone, or it lapsed while being phrased)
      open.until = Math.max(open.until, this.now() + OUTREACH.ttl * 1000);
      this.game.sys(`${def.name} whispers: "${text}"`, h.id);
      this.nm.send(h, { op: 'out', id: def.id, name: def.name, kind: msg.k, text, until: open.until, ttl: OUTREACH.ttl });
    });
    return open;
  }
  // The player's answer. Returns '' or why it didn't work.
  respond(h, id, yes) {
    const g = this.game, o = this.outOf(h), now = this.now(), st = this.nm.chars.get(id);
    if (!st || o.open?.id !== id || now > o.open.until) { o.open = null; return 'That invitation has lapsed.'; }
    const kind = o.open.kind;
    o.open = null;
    g.track(h, 'named_out', { named: id, kind, ev: yes ? 'accept' : 'decline' });
    if (!yes) {
      o.no.add(id); // none from them again this session
      const line = this.phrase(st.def, null, h, 'declined');
      if (line) g.sys(`${st.def.name} whispers: "${line}"`, h.id);
      return '';
    }
    const np = this.nm.playerOf(st);
    if (!np && this.nm.resting?.(st)) { // resting at home: they come in, then join you (named.runPending -> join)
      const why = this.joinBlock(h, st, null);
      if (why) { g.sys(why, h.id); return why; }
      this.nm.wake(st, h, 'out', { out: kind });
      g.sys(`${st.def.name} is on the way.`, h.id);
      return '';
    }
    return this.join(h, st, kind);
  }
  joinBlock(h, st, np) {
    const g = this.game;
    return (np && this.nm.freeBlock(h, st, np)) || (this.nm.namedInParty(g.partyOf(h)).length || this.nm.namedInvited(h, st) ? 'One of the Named per party.' : (g.partyOf(h)?.members.length || 1) >= PARTY_MAX ? 'Your party is full.' : '');
  }
  // An accepted invitation: the Named joins the player's party and comes to them. Returns '' or why not.
  join(h, st, kind) {
    const g = this.game, np = this.nm.playerOf(st);
    if (!np) return `${st.def.name} isn't around any more.`;
    const why = this.joinBlock(h, st, np);
    if (why) { g.sys(why, h.id); return why; }
    if (h.dead || h.downed) return 'Wait until you are back on your feet.';
    this.nm.mgr.joinParty(np, h);
    if (!h.party || np.party !== h.party) { g.sys(`${st.def.name} couldn't join your party.`, h.id); return 'failed'; }
    this.nm.mgr.catchUp(np, h);
    g.sys(kind === 'raid' ? `${st.def.name} joins you. Lead the way to the raid gate.` : `${st.def.name} joins you to hunt.`, h.id);
    return '';
  }

  // ---------- once a second (after the manager's own tick) ----------
  upkeep() {
    try {
      const humans = this.nm.humans(), now = this.now();
      if (!humans.length) return; // (nothing is simulated or written with nobody online)
      for (const h of humans) {
        const m = this.recsOf(h);
        if (!m.loaded) continue;
        for (const [id, r] of m) if (r.req && now > r.req.until) this.expire(h, id, now);
      }
      this.outreach(humans, now);
      if (now - this.flushAt > 3000) { this.flushAt = now; this.flush(); }
    } catch (e) { console.error('[namedquests]', e); }
  }

  // { type: 'named', op: 'req' | 'out' }
  handle(p, msg) {
    if (!isHuman(p)) return;
    const now = this.now(), op = msg.op, id = String(msg.id || '');
    const rl = (p.nqRate ||= { n: 0, at: now });
    if (now - rl.at > 5000) { rl.n = 0; rl.at = now; }
    if (++rl.n > 8) return this.nm.send(p, { op, error: 'Slow down a little.' });
    if (!this.nm.chars.has(id)) return this.nm.send(p, { op, error: 'Nobody by that name.' });
    const name = NAMED_BY_ID[id].name;
    if (process.env.TEST_HOOKS && msg.test) { // testing aids: { op: 'out', test: 1, id } sends their message now; { op: 'req', test: 1, id, got } sets progress
      if (op === 'out') return void this.send(p, this.nm.chars.get(id));
      const r = this.rec(p, id);
      if (r.req) { r.req.got = Math.max(0, Math.min(r.req.n, msg.got | 0)); if (r.req.got >= r.req.n) this.complete(p, id); }
      return;
    }
    if (op === 'out') {
      const why = this.respond(p, id, !!msg.yes);
      return this.nm.send(p, { op, id, ...(why ? { error: why } : { msg: msg.yes ? `${name} is on the way.` : '' }), list: this.nm.listFor(p) });
    }
    const act = String(msg.act || '');
    if (!this.recsOf(p).loaded) return this.nm.send(p, { op, error: 'One moment…' });
    const why = act === 'take' ? this.take(p, id) : act === 'drop' ? this.abandon(p, id) : act === 'turnin' ? this.turnIn(p, id) : 'Unknown request.';
    const ok = { take: `You took ${name}'s request.`, drop: `You dropped ${name}'s request.`, turnin: '' }[act];
    this.nm.send(p, { op, id, ...(why ? { error: why } : ok ? { msg: ok } : {}), list: this.nm.listFor(p) });
  }
}
