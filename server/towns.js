// Floor towns that grow, and their Stewards (docs/briefs/towns.md). Data and pure rules: shared/towns.js.
// Mixed into Game by installTowns(Game) near the end of game.js.
//
// State: this.towns[f] for floors 1-3 (server-wide; the `towns` table, see makeTownStore), p.town on each character
// (characters.town: home town, when they last moved, what they gave, bounty progress).
// Client message { type: 'town', op, f, ... }:
//   join                 become a citizen of town f (at its board; 7 days between moves)
//   donate {gold, mats}  give to the current project (at its board; only what it still needs)
//   stand {ag, plat}     stand for Steward (a citizen; an agenda and a one-line platform) · withdraw
//   vote {k}             vote for a candidate (a citizen; one per character per cycle, changeable until it closes)
//   steward {project | tax | msg}  the Steward's powers (the Steward only)
//   claim {i}            claim a finished bounty (at the board)
//   gate                 warp to town f's gate waystone (at an awake waypoint; the town's Town-stage project)
// Server → client: { type: 'towns', towns: [...], me } (townsMsg: sent when p.townsDirty, set at most once a second
// for everyone when a town changes); raids in the snapshot as w.tr; events traid (warn, tele, won, lost, gone), townup.
// Per tick: only raid marches (updateMob) and the raid's own checks; everything else once a second (townTick).
// Testing aids (TEST_HOOKS=1): { type: 'test', town: { skip: ms, close: f, paper: 1, raid: f, raidEnd: [f, won], xp: [f, n], mats: { id: n } } }.
import {
  TOWNS, TOWN_FLOORS, BOARD, TRADER, STAGES, STAGE_MAX, stageOf, stageName, stageProgress, TXP, BOT_RATE, TRICKLE, RAID,
  RAID_MOBS, raidLoss, raidWinXp, raidWaveSize, wardHpFor, UNLOCKS, PROJECTS, projectOf, matValue, projectNeed, projectDone,
  openProjects, activeUnlocks, plotSlots, clampTax, CITIZEN_DISCOUNT, priceMul, COOLDOWN, newCitizen, moveBlock, bountyDay, bountiesFor,
  ELECTION, AGENDAS, BOT_CANDIDATES, NAMED_HOMES, NAMED_LEANS, LONERS, platformFor, cleanText, leanOf, botVote, tally,
  pickByVote, pickByContrib, seedBracket, paperDuel, stewardProject, stewardTax, stewardMsg, isMat, DAY, HOUR,
} from '../shared/towns.js';
import { MOBS, inArena, resolveCollision, walkable } from '../shared/data.js';
import { MERCHANT } from '../shared/items.js';
import { floorOf, inArena2, nearAwakeWaypoint, floorUnlocked } from '../shared/floor2.js';
import { inArena3 } from '../shared/floor3.js';
import { labAt } from '../shared/labyrinth.js';
import { SPOT_BY_ID } from '../shared/life.js';
import { MATS } from '../shared/crafting.js';
import { NAMED_BY_ID } from '../shared/named.js';

const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const inBossRoom = p => inArena(p.x, p.z) || inArena2(p.x, p.z) || inArena3(p.x, p.z);
const PAD = 1.5, MSG_GAP = 0.15, TOUR_WAIT = 120, SAVE_MS = 10000;
const randIn = ([a, b], rnd = Math.random) => a + rnd() * (b - a);

// A fresh town record (also what the table row holds).
export function newTown(f, now, rnd = Math.random) {
  return {
    floor: f, xp: 0, treasury: 0, done: [], cur: PROJECTS[f][0].id, given: { gold: 0, mats: {} },
    citizens: 0, tax: 0, msg: '', steward: null, raidNext: now + randIn(RAID.first, rnd) * DAY, raidLast: null,
    trickleAt: now, el: null, last: null, tour: null,
  };
}
// Clean a stored row (anything odd falls back to fresh values).
export function cleanTown(f, row, now) {
  const T = newTown(f, now);
  if (!row) return T;
  const P = row.projects || {}, D = row.data || {};
  T.xp = Math.max(0, +row.xp || 0); T.treasury = Math.max(0, Math.round(+row.treasury || 0));
  T.done = Array.isArray(P.done) ? P.done.filter(id => projectOf(id) && PROJECTS[f].includes(projectOf(id))) : [];
  T.cur = projectOf(P.cur) && PROJECTS[f].includes(projectOf(P.cur)) && !T.done.includes(P.cur) ? P.cur : '';
  T.given = { gold: Math.max(0, +P.given?.gold || 0), mats: {} };
  for (const [k, v] of Object.entries(P.given?.mats || {})) if (isMat(k) && v > 0) T.given.mats[k] = v | 0;
  T.tax = clampTax(D.tax); T.msg = cleanText(D.msg, ELECTION.msgMax);
  T.steward = D.steward && typeof D.steward.key === 'string' ? { key: D.steward.key, name: cleanText(D.steward.name, 32), kind: D.steward.kind, ag: AGENDAS[D.steward.ag] ? D.steward.ag : 'build', since: +D.steward.since || now } : null;
  T.raidNext = +D.raidNext || T.raidNext; T.raidLast = D.raidLast || null;
  T.trickleAt = +D.trickleAt || now; T.el = D.el && Array.isArray(D.el.cands) ? D.el : null; T.last = D.last || null;
  T.tour = D.tour && Array.isArray(D.tour.rounds) ? D.tour : null;
  return T;
}
const rowOf = T => ({
  floor: T.floor, xp: T.xp, stage: stageOf(T.xp), treasury: T.treasury,
  projects: { done: T.done, cur: T.cur, given: T.given },
  data: { tax: T.tax, msg: T.msg, steward: T.steward, raidNext: T.raidNext, raidLast: T.raidLast, trickleAt: T.trickleAt, el: T.el, last: T.last, tour: T.tour },
});

// The table (server/db.js): one row per town, and the citizen counts from characters.town.
export function makeTownStore(q) {
  return {
    load: () => q('SELECT floor, xp, stage, treasury, projects, data FROM towns'),
    citizens: () => q(`SELECT (town->>'home')::int AS f, count(*)::int AS n FROM characters WHERE town IS NOT NULL AND (town->>'home') ~ '^[0-9]+$' GROUP BY 1`),
    save: r => q(`INSERT INTO towns (floor, xp, stage, treasury, projects, data, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (floor) DO UPDATE SET xp = $2, stage = $3, treasury = $4, projects = $5, data = $6, updated_at = now()`,
    [r.floor, r.xp, r.stage, r.treasury, JSON.stringify(r.projects), JSON.stringify(r.data)]),
  };
}
// The saved character record (characters.town).
export const townRecord = p => (p.town ? { home: p.town.home, moved: p.town.moved, given: p.town.given, bounty: p.town.bounty } : null);

export const TownMethods = {
  townNow() { return (this.townClock ? this.townClock() : Date.now()) + (this.townSkew || 0); },
  townRnd() { return (this.townRand || Math.random)(); },
  townsAll() {
    if (!this.towns) { const now = this.townNow(); this.towns = {}; for (const f of TOWN_FLOORS) { this.towns[f] = newTown(f, now, () => this.townRnd()); this.electionOpen(f, now, true); } }
    return this.towns;
  },
  town(f) { return this.townsAll()[f] || null; },
  townKey(p) { return p.charId ? `c${p.charId}` : `s${p.sid}`; },
  citizenOf(p) { return (p.town ||= newCitizen()); },
  townFloorAt(x, z) { return labAt(x, z)?.floor || floorOf(x); },
  townChanged(T) { T.dirty = true; this.townsVer = (this.townsVer || 0) + 1; },
  stageOfTown(T) { return stageOf(T.xp); },
  unlocksOf(f) { const T = this.town(f); return T ? activeUnlocks(f, stageOf(T.xp), T.done) : {}; },
  townSay(f, text) { for (const p of this.players.values()) if (!p.bot && floorOf(p.x) === f) this.sys(text, p.id); },

  // ---------- loading and saving ----------
  async townsLoad(store) {
    this.townStore = store;
    const now = this.townNow(), rows = await store.load(), counts = await store.citizens();
    this.towns = {};
    for (const f of TOWN_FLOORS) {
      const T = cleanTown(f, rows.find(r => (r.floor | 0) === f), now);
      T.citizens = counts.find(c => (c.f | 0) === f)?.n || 0;
      this.towns[f] = T;
      if (!T.el) this.electionOpen(f, now, true);
      if (!T.cur) this.pickProject(T);
    }
    this.townsVer = (this.townsVer || 0) + 1;
  },
  async townsFlush() {
    if (!this.townStore || !this.towns) return;
    const writes = [];
    for (const T of Object.values(this.towns)) if (T.dirty) { T.dirty = false; writes.push(this.townStore.save(rowOf(T)).catch(e => { T.dirty = true; console.error('[towns] save failed:', e.message); })); }
    await Promise.all(writes);
  },

  // ---------- XP and stages ----------
  // n XP to town f for a deed by `who` (a player; bots and the Named earn BOT_RATE of it; null: the town itself).
  townXp(f, n, who = null) {
    const T = this.town(f);
    if (!T || !(n > 0)) return;
    const before = stageOf(T.xp);
    T.xp += who?.bot ? n * BOT_RATE : n;
    const after = stageOf(T.xp);
    if (after > before) this.townStageUp(T, after);
    T.dirty = true; this._townsBumped = true;
  },
  townStageUp(T, s) {
    const name = TOWNS[T.floor].name;
    this.sys(`${name} has grown into a ${STAGES[s].name}! New projects can be built there.`);
    this.events.push({ t: 'townup', f: T.floor, s, name: STAGES[s].name });
    if (!T.cur) this.pickProject(T);
    this.townChanged(T);
  },
  townSetXp(f, xp) { // admin / tests: never more than the top stage's need
    const T = this.town(f), before = stageOf(T.xp);
    T.xp = Math.max(0, Math.min(STAGES[STAGE_MAX].xp * 3, +xp || 0));
    const after = stageOf(T.xp);
    if (after > before) this.townStageUp(T, after);
    if (!T.cur) this.pickProject(T);
    this.townChanged(T);
  },

  // ---------- projects ----------
  pickProject(T) {
    const open = openProjects(T.floor, stageOf(T.xp), T.done);
    if (!open.length) { T.cur = ''; return; }
    const st = T.steward;
    T.cur = st && st.kind !== 'player' ? stewardProject(st.ag, open) : open[0].id;
    T.given = { gold: 0, mats: {} };
  },
  // Gold for the current project (donations, the treasury, bot pledges): what fits. Returns what was taken.
  fundGold(T, gold) {
    const pr = projectOf(T.cur);
    if (!pr || !(gold > 0)) return 0;
    const take = Math.min(Math.floor(gold), projectNeed(pr, T.given).gold);
    if (take > 0) { T.given.gold += take; this.checkProject(T); }
    return take;
  },
  checkProject(T) {
    const pr = projectOf(T.cur);
    if (!pr || !projectDone(pr, T.given)) return;
    T.done.push(pr.id);
    const U = UNLOCKS[pr.unlock];
    this.sys(`${TOWNS[T.floor].name} finished the ${pr.name}! ${U.desc}`);
    this.events.push({ t: 'townbuilt', f: T.floor, id: pr.id, name: pr.name });
    T.cur = ''; this.pickProject(T);
    this.townChanged(T);
  },

  // ---------- the panel's actions ----------
  townAction(p, msg) {
    if (!p || p.bot || !msg) return false;
    const op = String(msg.op || ''), f = msg.f | 0, T = this.town(f);
    if (op === 'state') { p.townsDirty = true; return true; }
    if (!T) return false;
    if (this.time - (p.townMsgT ?? -9) < MSG_GAP) return false;
    p.townMsgT = this.time;
    if (op === 'gate') return this.townGate(p, f);
    if (p.dead || Math.hypot(p.x - TOWNS[f].board.x, p.z - TOWNS[f].board.z) > BOARD.use + PAD) return false; // (everything else at the town's board)
    switch (op) {
      case 'join': return this.townJoin(p, f);
      case 'donate': return this.townDonate(p, f, msg);
      case 'stand': return this.townStand(p, f, String(msg.ag || ''), msg.plat);
      case 'withdraw': return this.townWithdraw(p, f);
      case 'vote': return this.townVote(p, f, String(msg.k || ''));
      case 'steward': return this.townSteward(p, f, msg);
      case 'claim': return this.townClaim(p, f, msg.i | 0);
    }
    return false;
  },
  townJoin(p, f) {
    const c = this.citizenOf(p), now = this.townNow(), why = moveBlock(c, f, now);
    if (why) { this.sys(why, p.id); return false; }
    const old = c.home;
    if (old) {
      const O = this.town(old); O.citizens = Math.max(0, O.citizens - 1); this.townChanged(O);
      const E = O.el; // leaving: your candidacy and vote there go
      if (E) { E.cands = E.cands.filter(k => k.key !== this.townKey(p)); delete E.votes[this.townKey(p)]; }
    }
    c.home = f; c.moved = now;
    this.town(f).citizens++;
    this.townChanged(this.town(f));
    this.sys(`You are now a citizen of ${TOWNS[f].name}. You get a ${Math.round(CITIZEN_DISCOUNT * 100)}% discount at its merchant${f === 1 ? ' and Smith' : ''}, and a vote for its Steward.`, p.id);
    this.track(p, 'town_join', { f, from: old });
    p.dirty = true; p.townsDirty = true;
    return true;
  },
  townDonate(p, f, msg) {
    const T = this.town(f), pr = projectOf(T.cur);
    if (!pr) { this.sys('There is no project to give to right now.', p.id); return false; }
    const need = projectNeed(pr, T.given), have = this.matsOf(p);
    let value = 0;
    const gold = Math.max(0, Math.min(p.gold, need.gold, Math.floor(+msg.gold || 0)));
    if (gold > 0) { p.gold -= gold; T.given.gold += gold; value += gold; }
    const gave = [];
    for (const [k, v] of Object.entries(msg.mats && typeof msg.mats === 'object' ? msg.mats : {})) {
      if (!isMat(k) || !own(need.mats, k)) continue;
      const n = Math.max(0, Math.min(v | 0, have[k] || 0, need.mats[k]));
      if (!n) continue;
      have[k] -= n; if (!have[k]) delete have[k];
      T.given.mats[k] = (T.given.mats[k] || 0) + n; value += matValue(k) * n;
      gave.push(`${n} ${MATS[k]?.name || k}`);
    }
    if (!value) { this.sys('Nothing to give that the project still needs.', p.id); return false; }
    const key = this.townKey(p), E = T.el;
    if (E) E.contrib[key] = (E.contrib[key] || 0) + value;
    this.citizenOf(p).given += value;
    this.sys(`You gave ${[gold ? `${gold} gold` : '', ...gave].filter(Boolean).join(', ')} to the ${pr.name}.`, p.id);
    this.track(p, 'town_donate', { f, value });
    this.townXp(f, Math.ceil(value / TXP.donate), p);
    this.invChanged(p); p.townsDirty = true;
    this.checkProject(T);
    this.townChanged(T);
    return true;
  },
  townStand(p, f, ag, plat) {
    const T = this.town(f), E = T.el, key = this.townKey(p);
    if (this.citizenOf(p).home !== f) { this.sys(`Only citizens of ${TOWNS[f].name} can stand for Steward there.`, p.id); return false; }
    if (!AGENDAS[ag]) ag = 'build';
    plat = cleanText(plat, ELECTION.platMax) || AGENDAS[ag].line;
    const had = E.cands.find(c => c.key === key);
    if (had) { had.ag = ag; had.plat = plat; had.name = p.name; }
    else {
      if (E.cands.length >= ELECTION.candMax) { this.sys('The ballot is full this cycle.', p.id); return false; }
      E.cands.push({ key, name: p.name, kind: 'player', ag, plat, at: this.townNow(), lvl: p.lvl, fr: {} });
      this.sys(`${p.name} stands for Steward of ${TOWNS[f].name}: "${plat}"`);
    }
    this.townChanged(T); p.townsDirty = true;
    return true;
  },
  townWithdraw(p, f) {
    const E = this.town(f).el, key = this.townKey(p), n = E.cands.length;
    E.cands = E.cands.filter(c => c.key !== key);
    if (E.cands.length === n) return false;
    for (const [v, k] of Object.entries(E.votes)) if (k === key) delete E.votes[v];
    this.sys('You withdrew from the election.', p.id);
    this.townChanged(this.town(f)); p.townsDirty = true;
    return true;
  },
  townVote(p, f, k) {
    const T = this.town(f), E = T.el;
    if (T.tour) { this.sys('The vote is closed: the tournament is on.', p.id); return false; }
    if (this.citizenOf(p).home !== f) { this.sys(`Only citizens of ${TOWNS[f].name} vote there.`, p.id); return false; }
    if (!E.cands.some(c => c.key === k)) return false;
    E.votes[this.townKey(p)] = k;
    this.sys(`Your vote is in for ${E.cands.find(c => c.key === k).name}. You can change it until the election closes.`, p.id);
    this.townChanged(T); p.townsDirty = true;
    return true;
  },
  townSteward(p, f, msg) {
    const T = this.town(f);
    if (!T.steward || T.steward.key !== this.townKey(p)) { this.sys('Only the Steward can do that.', p.id); return false; }
    if (msg.project !== undefined) {
      const id = String(msg.project), open = openProjects(f, stageOf(T.xp), T.done);
      if (!open.some(pr => pr.id === id) || id === T.cur) return false;
      // nothing given is lost: the gold goes to the treasury (which funds projects), the materials stay given (they
      // count wherever the new project needs them)
      T.treasury += T.given.gold;
      T.cur = id; T.given = { gold: 0, mats: { ...T.given.mats } };
      this.townSay(f, `Steward ${p.name} set the next project: the ${projectOf(id).name}.`);
    }
    if (msg.tax !== undefined) T.tax = clampTax(msg.tax);
    if (msg.msg !== undefined) T.msg = cleanText(msg.msg, ELECTION.msgMax);
    this.townChanged(T); p.townsDirty = true;
    return true;
  },
  townGate(p, f) {
    if (p.dead || !this.unlocksOf(f).gate) return false;
    if (!nearAwakeWaypoint(p.stats, p.x, p.z, 0.5) || !floorUnlocked(p.stats, f)) return false;
    const g = TOWNS[f].gate, [x, z] = resolveCollision(g.x + 1.2, g.z, 0.5);
    this.events.push({ t: 'warp', id: p.id, x0: r2(p.x), z0: r2(p.z), x: r2(x), z: r2(z), f });
    this.gate.ready.delete(p.id); this.gate2?.ready.delete(p.id); this.gate3?.ready.delete(p.id);
    this.teleport(p, x, z);
    this.sys(`${p.name} took the gate waystone of ${TOWNS[f].name}.`, p.id);
    return true;
  },

  // ---------- bounties ----------
  bountyState(p, f, now = this.townNow()) {
    const c = this.citizenOf(p), day = bountyDay(now);
    if (c.bounty.day !== day) c.bounty = { day, f: {} };
    return (c.bounty.f[f] ||= { prog: [0, 0, 0], got: [0, 0, 0] });
  },
  bountyKill(p, m, f) {
    if (!p || p.bot || !this.unlocksOf(f).bounty) return;
    const list = bountiesFor(f, bountyDay(this.townNow())), B = this.bountyState(p, f);
    list.forEach((b, i) => { if (b.mob === m.type && !B.got[i] && B.prog[i] < b.n) { B.prog[i]++; p.dirty = true; p.townsDirty = true; if (B.prog[i] === b.n) this.sys(`Bounty done: ${b.n} ${MOBS[b.mob]?.name || b.mob}. Claim it at the ${TOWNS[f].name} board.`, p.id); } });
  },
  townClaim(p, f, i) {
    if (!this.unlocksOf(f).bounty) return false;
    const b = bountiesFor(f, bountyDay(this.townNow()))[i], B = this.bountyState(p, f);
    if (!b || B.got[i] || B.prog[i] < b.n) return false;
    B.got[i] = 1; p.gold += b.gold;
    this.sys(`Bounty claimed: ${b.gold} gold.`, p.id);
    this.events.push({ t: 'coin', id: p.id });
    this.townXp(f, TXP.bounty, p);
    this.track(p, 'town_bounty', { f, mob: b.mob });
    this.invChanged(p); p.dirty = true; p.townsDirty = true;
    return true;
  },

  // ---------- prices: the merchant, camp traders, the Smith ----------
  // The town whose merchant or trader p is at (0: none).
  merchantFloor(p) {
    if (!p || p.dead) return 0;
    if (Math.hypot(p.x - MERCHANT.x, p.z - MERCHANT.z) < MERCHANT.r + 1.5) return 1;
    for (const f of [2, 3]) { const tr = TOWNS[f].trader; if (tr && Math.hypot(p.x - tr.x, p.z - tr.z) < TRADER.use + PAD && this.unlocksOf(f).trader) return f; }
    return 0;
  },
  priceMulFor(p, f) {
    const T = this.town(f);
    if (!T) return 1;
    return priceMul({ tax: T.tax, citizen: p?.town?.home === f, market: this.unlocksOf(f).discount ? UNLOCKS.discount.pct : 0, subsidyOk: T.treasury > 0 });
  },
  // A sale's tax goes to the treasury; a Steward's discount comes out of it.
  townTaxOn(f, base) {
    const T = this.town(f);
    if (!T || !T.tax || !(base > 0)) return;
    const d = Math.round(base * T.tax);
    if (d > 0) T.treasury += d; else if (T.treasury > 0) T.treasury = Math.max(0, T.treasury + d);
    T.dirty = true;
  },
  shopBlock(p, s) { const f = this.merchantFloor(p); return s.town && (s.town !== f || !this.unlocksOf(f).stock) ? 'That isn\'t sold here.' : ''; },
  shopPrice(p, s, base) { const f = this.merchantFloor(p) || 1; return Math.max(1, Math.round(base * this.priceMulFor(p, f))); },
  shopPaid(p, s, price, base) { this.townTaxOn(this.merchantFloor(p) || 1, base); },
  smithCost(p, cost) { if (!cost?.gold) return cost; return { ...cost, gold: Math.max(1, Math.round(cost.gold * this.priceMulFor(p, 1))) }; },

  // ---------- citizens who are bots ----------
  botHome(b) {
    if (b.named) return NAMED_HOMES[b.named] || 1;
    const e = this.botMgr?.entryOf?.(b), cr = e?.creator, owner = cr?.pid ? this.players.get(cr.pid) : null;
    return owner?.town?.home || floorOf(b.x);
  },
  botKey(b) { return b.named ? `n:${b.named}` : `b:${b.name}`; },

  // ---------- elections ----------
  electionOpen(f, now = this.townNow(), quiet = false) {
    const T = this.town(f) || this.towns[f], n = (T.el?.n || 0) + 1;
    const cands = BOT_CANDIDATES[f].map((c, i) => {
      const def = c.named ? NAMED_BY_ID[c.named] : null, name = def ? def.name : `${c.name} ${c.title}`;
      return { key: c.key, name, kind: c.named ? 'named' : 'npc', ag: c.ag, plat: platformFor(c.ag, n + i), at: now - (10 - i), lvl: def ? (this.named?.chars?.get(c.named)?.lvl || 10) : 6 + 6 * f, fr: {} };
    });
    T.el = { n, opens: now, closes: now + ELECTION.days * DAY, cands, votes: {}, contrib: {}, rap: {}, seen: {} };
    T.tour = null;
    for (const c of cands) if (c.kind === 'named') this.platformAI?.(T, c);
    if (!quiet) this.townSay(f, `A new election for Steward of ${TOWNS[f].name} is open. Stand or vote at the town board.`);
    this.townChanged(T);
  },
  // The Named write their own platform line through the AI mind, only when it's on and within the day's budget.
  platformAI(T, c) {
    const ai = this.townAI, def = NAMED_BY_ID[c.key.slice(2)], n = T.el.n;
    if (!ai?.platform || !def) return;
    Promise.resolve(ai.platform(def, TOWNS[T.floor].name, AGENDAS[c.ag].line)).then(line => {
      const s = cleanText(line, ELECTION.platMax);
      if (s && T.el?.n === n) { c.plat = s; this.townChanged(T); }
    }).catch(() => {});
  },
  // The voters who are bots: the Named who live here, and the free bots seen living here this cycle.
  botVoters(T) {
    const E = T.el, out = [];
    for (const [id, home] of Object.entries(NAMED_HOMES)) {
      if (home !== T.floor) continue;
      const key = `n:${id}`, fr = {};
      for (const c of E.cands) if (c.kind === 'player' && c.fr?.[id]) fr[c.key] = c.fr[id];
      out.push({ key, lean: NAMED_LEANS[id], fr, rap: E.rap[key] || {}, min: LONERS[id] || 0 });
    }
    for (const [key, s] of Object.entries(E.seen)) out.push({ key, lean: s.lean, creator: s.creator || '', rap: E.rap[key] || {} });
    return out;
  },
  electionVotes(T) {
    const E = T.el, cands = E.cands.map(c => ({ ...c, contrib: E.contrib[c.key] || 0 })), votes = { ...E.votes };
    for (const v of this.botVoters(T)) { const k = botVote(v, cands); if (k) votes[v.key] = k; }
    return { cands, votes, t: tally(votes, cands) };
  },
  electionClose(f, { paper = false } = {}) {
    const T = this.town(f), E = T.el;
    if (!E || T.tour) { if (T.tour && paper) this.tourRun(T, true); return; }
    const { cands, votes, t } = this.electionVotes(T);
    const rule = TOWNS[f].rule;
    if (rule === 'duel' && cands.length > 1) {
      const first = seedBracket(cands, t);
      T.tour = { rounds: [first.map(([a, b]) => [a, b, ''])], round: 0, at: this.time, live: null, cands, t, voted: Object.keys(votes).length };
      this.sys(`The duel tournament for Steward of ${TOWNS[f].name} begins: ${first.map(([a, b]) => `${this.candName(T, a)} vs ${b ? this.candName(T, b) : 'a bye'}`).join(', ')}.`);
      this.townChanged(T);
      if (paper) this.tourRun(T, true);
      return;
    }
    const win = rule === 'contrib' ? pickByContrib(cands, t) : pickByVote(cands, t);
    this.electionDone(T, win, rule, t, cands, Object.keys(votes).length);
  },
  candName(T, key) { return (T.tour?.cands || T.el?.cands || []).find(c => c.key === key)?.name || '?'; },
  electionDone(T, key, how, t, cands, voted) {
    const c = cands.find(x => x.key === key), f = T.floor;
    if (c) {
      T.steward = { key: c.key, name: c.name, kind: c.kind, ag: c.ag, since: this.townNow() };
      if (c.kind !== 'player') { // a bot Steward governs by its agenda at once
        T.tax = stewardTax(c.ag); T.msg = stewardMsg(c.ag, T.el.n);
        const open = openProjects(f, stageOf(T.xp), T.done), want = stewardProject(c.ag, open);
        if (want && want !== T.cur && !(T.given.gold > 0) && !Object.keys(T.given.mats).length) T.cur = want;
      }
      const why = how === 'vote' ? `${t[key] || 0} vote${t[key] === 1 ? '' : 's'}` : how === 'contrib' ? `${Math.round(c.contrib || 0)} given to the town` : 'won the duel tournament';
      this.sys(`${c.name} is the new Steward of ${TOWNS[f].name} (${why}).`);
      this.events.push({ t: 'steward', f, name: c.name });
    }
    T.last = { n: T.el.n, key, name: c?.name || '', how, at: this.townNow(), voted: voted || 0, tally: cands.map(x => [x.name, t[x.key] || 0, Math.round(x.contrib || 0)]) };
    T.tour = null;
    this.electionOpen(f);
  },

  // ---------- the Floor 3 duel tournament ----------
  // Who can fight for a candidate key right now (null: nobody: away, an npc, busy).
  candLive(key) {
    for (const p of this.players.values()) {
      if (key.startsWith('n:') ? p.named !== key.slice(2) : p.bot || this.townKey(p) !== key) continue;
      if (p.dead || p.downed || p.trap || p.trial || this.duelOf?.(p) || inBossRoom(p) || this.activeFightOf?.(p)) return null;
      return p;
    }
    return null;
  },
  candOnline(key) { for (const p of this.players.values()) if (key.startsWith('n:') ? p.named === key.slice(2) : !p.bot && this.townKey(p) === key) return true; return false; },
  // One step of the tournament (once a second; paper: settle every match on paper at once).
  tourRun(T, paper = false) {
    const R = T.tour;
    for (let guard = 0; guard < 64 && T.tour === R; guard++) {
      const round = R.rounds[R.round], m = round.find(x => !x[2]);
      if (!m) { // the round is done: the next, or the winner
        const winners = round.map(x => x[2]);
        if (winners.length === 1) { this.electionDone(T, winners[0], 'duel', R.t, R.cands, R.voted); return; }
        const next = [];
        for (let i = 0; i < winners.length; i += 2) next.push([winners[i], winners[i + 1] || '', winners[i + 1] ? '' : winners[i]]);
        R.rounds.push(next); R.round++; R.at = this.time; this.townChanged(T);
        continue;
      }
      const [a, b] = m;
      if (!a || !b) { m[2] = a || b; continue; }
      const ca = R.cands.find(c => c.key === a), cb = R.cands.find(c => c.key === b);
      if (paper) { m[2] = paperDuel(ca, cb, T.el.n); continue; }
      if (R.live) return; // a duel is on: tourDuelEnd fills it in
      const pa = this.candLive(a), pb = this.candLive(b);
      if (pa && pb) { this.tourDuel(T, m, pa, pb); return; }
      const waited = this.time - R.at, busy = (k, live) => !live && !k.startsWith('npc:') && this.candOnline(k);
      if (waited < TOUR_WAIT && (busy(a, pa) || busy(b, pb))) return; // online but busy (a fight, a trial): wait a while
      if (pa || pb) { m[2] = pa ? a : b; this.sys(`${(pa ? ca : cb).name} goes through: ${(pa ? cb : ca).name} did not come to the duel.`); }
      else { m[2] = paperDuel(ca, cb, T.el.n); this.sys(`${this.candName(T, m[2])} goes through to the next round of the tournament.`); }
      R.at = this.time; this.townChanged(T);
    }
  },
  tourDuel(T, m, pa, pb) {
    const B = TOWNS[T.floor].board, at = (dx) => { const [x, z] = resolveCollision(B.x + dx, B.z + 6, 0.5); return walkable(x, z) ? [x, z] : [B.x, B.z + 3]; };
    this.teleport(pa, ...at(-4)); this.teleport(pb, ...at(4));
    const d = this.duelStart(pa, pb, 'half', false);
    if (!d) return;
    T.tour.live = { id: d.id, a: m[0], b: m[1] };
    this.sys(`Tournament duel for Steward of ${TOWNS[T.floor].name}: ${pa.name} vs ${pb.name}!`);
    this.townChanged(T);
  },
  tourDuelEnd(d, won) {
    for (const T of Object.values(this.towns || {})) {
      const R = T.tour;
      if (!R?.live || R.live.id !== d.id) continue;
      const m = R.rounds[R.round].find(x => x[0] === R.live.a && x[1] === R.live.b);
      const side = [...d.f.values()].filter(f => f.side === won)[0];
      const p = side && this.players.get(side.id);
      if (m) m[2] = p ? (p.named ? `n:${p.named}` : this.townKey(p)) : paperDuel(R.cands.find(c => c.key === m[0]), R.cands.find(c => c.key === m[1]), T.el.n);
      R.live = null; R.at = this.time; this.townChanged(T);
    }
  },

  // ---------- raids ----------
  humansOn(f) { let n = 0; for (const p of this.players.values()) if (!p.bot && !p.dead && floorOf(p.x) === f && !labAt(p.x, p.z)) n++; return n; },
  raidStart(f, { warn = RAID.warn } = {}) {
    const T = this.town(f);
    if (T.raid || this.director?.running) return false;
    const humans = Math.max(1, this.humansOn(f)), hp = wardHpFor(humans);
    T.raid = { state: 'warn', until: this.time + warn, wave: 0, waves: RAID.waves, ward: hp, max: hp, end: 0, nextWave: 0, mobs: new Set(), humans, emptySince: 0, pending: 0 };
    this.townSay(f, `Scouts report raiders gathering outside ${TOWNS[f].name}! Defend the ward on the town's edge${warn > 0 ? ` in ${Math.round(warn)} seconds` : ''}.`);
    this.events.push({ t: 'traid', s: 'warn', f, d: warn, x: TOWNS[f].ward.x, z: TOWNS[f].ward.z });
    this.townChanged(T);
    return true;
  },
  raidWave(T) {
    const R = T.raid, f = T.floor, W = TOWNS[f], src = RAID_MOBS[f];
    R.wave++; R.nextWave = Infinity;
    const n = raidWaveSize(R.humans), pts = [];
    for (let i = 0; i < n; i++) {
      const x = W.raidFrom.x[0] + ((i + 0.5) / n) * (W.raidFrom.x[1] - W.raidFrom.x[0]), z = W.raidFrom.z + (this.townRnd() - 0.5) * 8;
      const [px, pz] = resolveCollision(x, z, 1.2);
      const type = R.wave === R.waves && i === 0 ? src.elite : src.mobs[i % src.mobs.length];
      pts.push([r2(px), r2(pz), type]);
    }
    this.events.push({ t: 'traid', s: 'tele', f, wave: R.wave, waves: R.waves, pts: pts.map(([x, z]) => [x, z]), d: RAID.tele });
    R.pending++;
    this.schedule(RAID.tele, () => {
      if (T.raid !== R) return;
      R.pending--;
      for (const [x, z, type] of pts) {
        if (!MOBS[type]) continue;
        const m = this.addMob(type, x, z);
        if (MOBS[type].f2) this.f2Init?.(m); else if (MOBS[type].f3) this.f3Init?.(m);
        m.hidden = false; m.raid = f; m.sx = W.ward.x; m.sz = W.ward.z + 3; m.raidHitAt = 0;
        R.mobs.add(m.id);
      }
      if (R.wave < R.waves) R.nextWave = this.time + RAID.gap;
    });
  },
  raidEnd(T, result) {
    const R = T.raid, f = T.floor;
    if (!R) return;
    T.raid = null;
    for (const id of R.mobs) { const m = this.mobs.get(id); if (m && !m.dead) this.events.push({ t: 'die', id, x: r2(m.x), z: r2(m.z), b: 0 }); this.mobs.delete(id); }
    this.raidBots(f, false);
    const now = this.townNow();
    let xp = 0;
    if (result === 'won') { xp = raidWinXp(R.wave); this.townXp(f, xp); this.townSay(f, `The raid on ${TOWNS[f].name} is beaten! The town gains ${xp} XP.`); }
    else if (result === 'lost') {
      xp = -raidLoss(T.xp); T.xp += xp;
      this.townSay(f, `The ward fell. ${TOWNS[f].name} loses ${-xp} XP${stageOf(T.xp) < stageOf(T.xp - xp) ? ` and is a ${stageName(stageOf(T.xp))} again` : ''}.`);
    } else this.townSay(f, 'The raiders withdraw for now.');
    this.events.push({ t: 'traid', s: result, f, xp });
    T.raidNext = now + (result === 'gone' ? RAID.retry : randIn(RAID.every, () => this.townRnd()) * DAY);
    if (result !== 'gone') T.raidLast = { at: now, won: result === 'won', xp };
    this.townChanged(T);
  },
  // Free bots and the Named on that floor hold the ward while a raid is on (party bots keep following their players).
  raidBots(f, on) {
    const mgr = this.botMgr;
    if (!mgr) return;
    const W = TOWNS[f].ward;
    for (const e of mgr.bots) {
      if (e.b.closed || e.director) continue;
      const p = mgr.livePlayer(e);
      if (!p || typeof e.b.command !== 'function') continue;
      if (on) {
        if (floorOf(p.x) !== f || e.townDef) continue;
        const party = this.partyOf(p);
        if (party?.members.some(id => { const o = this.players.get(id); return o && !o.bot; })) continue;
        e.townDef = f;
        try { e.b.command({ k: 'defend', x: W.x, z: W.z + 4, by: 0, byName: TOWNS[f].name, group: [p.id] }); } catch (err) { console.error('[towns] defend', err); }
      } else if (e.townDef === f) {
        e.townDef = 0;
        try { e.b.command({ k: 'release', by: 0, byName: TOWNS[f].name, group: [p.id] }); } catch (err) { console.error('[towns] release', err); }
      }
    }
  },
  raidTick(T) {
    const R = T.raid, f = T.floor, t = this.time;
    if (this.director?.running) return this.raidEnd(T, 'gone');
    if (!this.humansOn(f)) { R.emptySince ||= t; if (t - R.emptySince >= RAID.abandon) return this.raidEnd(T, 'gone'); } else R.emptySince = 0;
    if (R.state === 'warn') {
      if (t < R.until) return;
      R.state = 'fight'; R.end = t + RAID.limit;
      this.raidBots(f, true);
      this.raidWave(T);
      return;
    }
    for (const id of R.mobs) { const m = this.mobs.get(id); if (!m || m.dead) R.mobs.delete(id); }
    if (R.ward <= 0) return this.raidEnd(T, 'lost');
    if (t >= R.end) return this.raidEnd(T, 'lost');
    if (!R.mobs.size && !R.pending) {
      if (R.wave >= R.waves) return this.raidEnd(T, 'won');
      R.nextWave = Math.min(R.nextWave, t);
    }
    if (R.wave < R.waves && t >= R.nextWave && !R.pending) this.raidWave(T);
  },
  // A raider with nobody to fight marches on the ward and hits it (a short telegraphed swing).
  raidMarch(m, dt) {
    const T = this.towns?.[m.raid], R = T?.raid;
    if (!R || R.state !== 'fight') return false;
    const t = this.time, def = m.def, aggro = (def.aggro || 10) + 3;
    if (m.threat.size) return false;
    for (const p of this.players.values()) if (!p.dead && Math.abs(p.x - m.x) < aggro && Math.abs(p.z - m.z) < aggro && dist(p, m) < aggro && this.validTarget(m, p)) return false;
    m.moving = false;
    if (t < m.stunUntil) return true;
    const W = TOWNS[T.floor].ward, reach = def.radius + 1.6, d = Math.hypot(W.x - m.x, W.z - m.z);
    if (m.raidHitAt && t >= m.raidHitAt) {
      m.raidHitAt = 0;
      if (d <= reach + 0.8) { R.ward = Math.max(0, R.ward - def.atk * RAID.wardDmg); }
      return true;
    }
    if (m.raidHitAt) return true;
    if (d > reach) { this.moveMob(m, W.x, W.z, def.speed * 0.8, dt, reach - 0.2); return true; }
    m.face = Math.atan2(W.x - m.x, W.z - m.z);
    if (t >= m.atkT) { m.atkT = t + (def.atkCd || 2); m.raidHitAt = t + 0.6; this.events.push({ t: 'wind', id: m.id, d: 0.6, f: r2(m.face) }); }
    return true;
  },
  raidSnap() {
    if (!this.towns) return undefined;
    let out;
    for (const T of Object.values(this.towns)) {
      const R = T.raid;
      if (!R) continue;
      (out ||= []).push([T.floor, R.state === 'warn' ? 0 : 1, R.wave, R.waves, Math.round((100 * R.ward) / R.max), Math.max(0, Math.round((R.state === 'warn' ? R.until : R.end) - this.time)), R.mobs.size]);
    }
    return out;
  },

  // ---------- once a second ----------
  updateTowns(dt) {
    this._townAcc = (this._townAcc || 0) + dt;
    if (this.towns) for (const T of Object.values(this.towns)) if (T.raid && T.raid.state === 'fight' && T.raid.ward <= 0) this.raidEnd(T, 'lost');
    if (this._townAcc < 1) return;
    const step = this._townAcc; this._townAcc = 0;
    this.townTick(step);
  },
  townTick(step) {
    const now = this.townNow(), towns = this.townsAll();
    // quests turned in to the Named: town XP (wrapped once, lazily: the quests module may come after the game)
    const Q = this.named?.quests;
    if (Q && !Q._townHook) { Q._townHook = true; const orig = Q.complete.bind(Q); Q.complete = (p, id) => { const r = orig(p, id); if (p && !p.bot) this.townXp(this.townFloorAt(p.x, p.z), TXP.request, p); return r; }; }
    const homes = { 1: 0, 2: 0, 3: 0 };
    for (const f of Object.values(NAMED_HOMES)) homes[f]++;
    const liveBots = { 1: 0, 2: 0, 3: 0 };
    // bots living in town: seen (voters) and counted; party time with candidates (rapport)
    for (const b of this.players.values()) {
      if (!b.bot || b.named || b.dead) continue;
      const f = this.botHome(b), E = towns[f]?.el;
      if (!E) continue;
      liveBots[f]++;
      const key = this.botKey(b);
      if (!E.seen[key] && Object.keys(E.seen).length < 40) {
        const e = this.botMgr?.entryOf?.(b), cr = e?.creator, owner = cr?.pid ? this.players.get(cr.pid) : null;
        E.seen[key] = { lean: leanOf(b.name), creator: owner ? this.townKey(owner) : cr?.charId ? `c${cr.charId}` : '' };
      }
    }
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const key = this.townKey(p);
      for (const T of Object.values(towns)) {
        const c = T.el?.cands.find(x => x.key === key);
        if (!c) continue;
        c.lvl = p.lvl;
        for (const id of Object.keys(NAMED_HOMES)) { const pts = this.named?.peek?.(p, id)?.pts; if (pts) c.fr[id] = pts; }
        const party = this.partyOf(p);
        if (party) for (const id of party.members) {
          const b = this.players.get(id);
          if (!b?.bot) continue;
          const bk = this.botKey(b), rap = (T.el.rap[bk] ||= {});
          if (Object.keys(T.el.rap).length <= 48) rap[key] = (rap[key] || 0) + step;
        }
      }
    }
    for (const T of Object.values(towns)) {
      const f = T.floor, bots = homes[f] + liveBots[f];
      T.bots = bots;
      // the quiet trickle: XP and treasury gold, by the hour; bot candidates pledge gold to the project
      const hrs = Math.min(TRICKLE.catchUp, Math.max(0, now - T.trickleAt)) / HOUR;
      T.trickleAt = now;
      if (hrs > 0) {
        this.townXp(f, (TRICKLE.xp + TRICKLE.xpPerBot * bots) * hrs);
        T.goldAcc = (T.goldAcc || 0) + (TRICKLE.gold + TRICKLE.goldPerBot * bots) * hrs;
        for (const c of T.el.cands) if (c.kind !== 'player') { const g = (TRICKLE.pledge * hrs) / 24; T.el.contrib[c.key] = (T.el.contrib[c.key] || 0) + g; T.goldAcc += g; }
        if (T.goldAcc >= 1) { const g = Math.floor(T.goldAcc); T.goldAcc -= g; T.treasury += g; T.dirty = true; }
      }
      if (T.treasury > 0 && projectOf(T.cur)) { const took = this.fundGold(T, T.treasury); if (took) { T.treasury -= took; T.dirty = true; } }
      if (!T.cur) this.pickProject(T);
      // raids
      if (T.raid) this.raidTick(T);
      else if (now >= T.raidNext && process.env.TOWN_RAIDS !== '0' && !this.director?.running && this.humansOn(f)) this.raidStart(f);
      // elections
      if (T.tour) this.tourRun(T);
      else if (now >= T.el.closes) this.electionClose(f);
    }
    // the irrigation unlock: citizens' crops grow faster while they play
    for (const p of this.players.values()) {
      const home = p.town?.home;
      if (!home || p.bot || !p.life?.plot || !this.unlocksOf(home).garden) continue;
      for (const tile of p.life.plot) if (tile) { tile.boost = (tile.boost || 0) + step * 1000 * (UNLOCKS.garden.mult - 1); }
    }
    if (this._townsBumped) { this._townsBumped = false; this.townsVer = (this.townsVer || 0) + 1; }
    if (this.townsVer !== this._townsSent) { // everyone's Town panel, at most once a second
      this._townsSent = this.townsVer;
      for (const p of this.players.values()) if (!p.bot) p.townsDirty = true;
    }
  },

  // ---------- the client's view ----------
  townsMsg(p) {
    const now = this.townNow(), c = this.citizenOf(p), key = this.townKey(p), towns = this.townsAll();
    const out = [];
    for (const f of TOWN_FLOORS) {
      const T = towns[f], s = stageOf(T.xp), pg = stageProgress(T.xp), pr = projectOf(T.cur), E = T.el, U = activeUnlocks(f, s, T.done);
      out.push({
        f, name: TOWNS[f].name, rule: TOWNS[f].rule, stage: s, xp: Math.floor(T.xp), into: Math.floor(pg.into), need: pg.need, treasury: T.treasury, tax: T.tax, msg: T.msg,
        steward: T.steward ? { name: T.steward.name, kind: T.steward.kind, ag: T.steward.ag, me: T.steward.key === key ? 1 : 0 } : null,
        cur: pr ? { id: pr.id, name: pr.name, unlock: pr.unlock, cost: pr.cost, need: projectNeed(pr, T.given) } : null,
        done: T.done, open: openProjects(f, s, T.done).map(x => x.id), unl: Object.keys(U), plots: plotSlots(f, s, T.done),
        cit: { players: T.citizens, bots: T.bots ?? Object.values(NAMED_HOMES).filter(h => h === f).length },
        raid: { due: Math.max(0, Math.round((T.raidNext - now) / 1000)), on: T.raid ? 1 : 0, last: T.raidLast ? { ago: Math.round((now - T.raidLast.at) / 1000), won: T.raidLast.won ? 1 : 0, xp: Math.round(T.raidLast.xp) } : null },
        el: {
          n: E.n, left: Math.max(0, Math.round((E.closes - now) / 1000)), voted: Object.keys(E.votes).length, my: E.votes[key] || '',
          cands: E.cands.map(x => ({ k: x.key, name: x.name, kind: x.kind, ag: x.ag, plat: x.plat, me: x.key === key ? 1 : 0, c: Math.round(E.contrib[x.key] || 0) })),
          tour: T.tour ? T.tour.rounds.map(r => r.map(([a, b, w]) => [this.candName(T, a), b ? this.candName(T, b) : '', w ? this.candName(T, w) : ''])) : null,
        },
        last: T.last ? { name: T.last.name, how: T.last.how, ago: Math.round((now - T.last.at) / 1000), voted: T.last.voted, tally: T.last.tally } : null,
        mul: r2(this.priceMulFor(p, f)),
        bounty: U.bounty ? (() => { const B = this.bountyState(p, f, now); return bountiesFor(f, bountyDay(now)).map((b, i) => ({ mob: b.mob, name: MOBS[b.mob]?.name || b.mob, n: b.n, gold: b.gold, prog: B.prog[i], got: B.got[i] })); })() : null,
      });
    }
    return { type: 'towns', towns: out, me: { home: c.home, move: c.home ? Math.max(0, Math.round((COOLDOWN - (now - c.moved)) / 1000)) : 0, given: Math.round(c.given) } };
  },
  // The admin page's view and actions (server/towns-admin.js).
  townsAdmin() {
    const now = this.townNow();
    return TOWN_FLOORS.map(f => {
      const T = this.town(f);
      return { f, name: TOWNS[f].name, xp: Math.floor(T.xp), stage: stageOf(T.xp), stageName: stageName(stageOf(T.xp)), treasury: T.treasury, citizens: T.citizens, bots: T.bots || 0,
        cur: T.cur, given: T.given, done: T.done, tax: T.tax, msg: T.msg, steward: T.steward, raidIn: Math.round((T.raidNext - now) / 1000), raid: this.raidSnap()?.find(r => r[0] === f) || null,
        el: { n: T.el.n, closesIn: Math.round((T.el.closes - now) / 1000), cands: T.el.cands.map(c => ({ key: c.key, name: c.name, kind: c.kind, ag: c.ag, plat: c.plat })), votes: Object.keys(T.el.votes).length, tour: !!T.tour },
        last: T.last };
    });
  },
};

export function installTowns(Game) {
  const P = Game.prototype;
  Object.assign(P, TownMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('addPlayer', function (orig, ws, name, cls, saved = null) {
    const p = orig.call(this, ws, name, cls, saved);
    p.town = newCitizen(saved?.town);
    p.townsDirty = true;
    return p;
  });
  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'town') return this.townAction(p, msg);
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.town && p) { // testing aids
      const o = msg.town;
      if (o.skip > 0) this.townSkew = (this.townSkew || 0) + Math.min(400 * DAY, +o.skip);
      if (o.xp) this.townSetXp(o.xp[0] | 0, +o.xp[1]);
      if (o.mats) { for (const [k, v] of Object.entries(o.mats)) if (isMat(k)) this.giveMats(p, { [k]: Math.min(999, v | 0) }); this.invChanged(p); }
      if (o.close) this.electionClose(o.close | 0, { paper: !!o.paper });
      if (o.raid) { this.town(o.raid | 0).raidNext = 0; this.raidStart(o.raid | 0, { warn: 0 }); }
      if (o.raidEnd) { const T = this.town(o.raidEnd[0] | 0); if (T?.raid) this.raidEnd(T, o.raidEnd[1] ? 'won' : 'lost'); }
      if (o.ward != null) { const T = this.town(floorOf(p.x)); if (T?.raid) T.raid.ward = Math.max(0, +o.ward); }
      p.townsDirty = true;
      return;
    }
    return orig.call(this, p, msg);
  });
  wrap('update', function (orig, dt) { const r = orig.call(this, dt); this.updateTowns(dt); return r; });
  wrap('updateMob', function (orig, m, dt) { if (m.raid && !m.dead && this.raidMarch(m, dt)) return; return orig.call(this, m, dt); });
  wrap('nearMerchant', function (orig, p) { return orig.call(this, p) || this.merchantFloor(p) > 1; });
  // Town XP for kills (and bounties); raiders never respawn.
  wrap('killMob', function (orig, m, killer) {
    const was = !m.dead;
    const r = orig.call(this, m, killer);
    if (!was || !m.dead) return r;
    if (m.raid) this.mobs.delete(m.id);
    if (m.trial || m.def.duel || m.def.prop || m.staged) return r;
    const f = this.townFloorAt(m.x, m.z), d = m.def;
    this.townXp(f, d.boss ? TXP.boss : d.rare || m.rare ? TXP.rare : d.elite ? TXP.elite : TXP.kill, killer);
    const seen = new Set();
    for (const id of [killer?.id, ...m.contributors]) { const p = this.players.get(id); if (p && !seen.has(p)) { seen.add(p); this.bountyKill(p, m, f); } }
    return r;
  });
  wrap('labKeeperKilled', function (orig, m) { const L = labAt(m.x, m.z); const r = orig.call(this, m); this.townXp(L?.floor || floorOf(m.x), TXP.lab); return r; });
  wrap('lifeDone', function (orig, p) {
    const a = p.lifeAct, s = a && SPOT_BY_ID[a.id];
    const r = orig.call(this, p);
    if (s) this.townXp(this.townFloorAt(s.x, s.z), TXP.gather, p);
    return r;
  });
  wrap('lifeMake', function (orig, p, id) { const r = orig.call(this, p, id); if (r) this.townXp(1, TXP.craft, p); return r; });
  wrap('forged', function (orig, p, a, it) { const r = orig.call(this, p, a, it); if (p && !p.bot) this.townXp(1, TXP.craft, p); return r; });
  // The Smith's gold costs carry the town's price (tax, the citizen's discount, the market).
  wrap('smithCheck', function (orig, p, cost) { return orig.call(this, p, this.smithCost(p, cost)); });
  wrap('smithPay', function (orig, p, cost) { const r = orig.call(this, p, this.smithCost(p, cost)); if (cost?.gold) this.townTaxOn(1, cost.gold); return r; });
  wrap('duelEnd', function (orig, d, won, why) { const r = orig.call(this, d, won, why); if (this.towns) this.tourDuelEnd(d, won); return r; });
}
