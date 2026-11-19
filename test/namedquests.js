// The Named's requests and invitations (docs/ROADMAP.md I4): shared/namedquests.js rules, server/namedquests.js in
// process, then a real server.
//   pure        who asks for what (persona templates), the mob from your floor and level range, the tier gates
//               (the loner only at Known, boss help only where they'd party with you), rewards, canned lines
//   in process  offering, one active request per Named, kill progress (never a Named-only kill), materials handed over
//               in person (or while talking), boss help, expiry, rewards (gold, items, friendship with its own cap,
//               outside the shared daily cap), the AI phrasing hook, outreach (Friend+, rate limits, a "no" holds for
//               the session, never in a show or mid-boss, Accept joins your party), bots get nothing, save / load
//   server      a real server on PORT (default 5810): the Friends list carries the request card, take / drop over the
//               socket; NAMED_ENABLED=0: nothing. With DATABASE_URL (a local test database): the migration runs twice,
//               requests round-trip through named_requests (the in-process store test covers a restart).
// Usage: node test/namedquests.js   (PORT=58xx DATABASE_URL=postgresql://postgres:pg@localhost/fb_namedq)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js';
import { NamedManager } from '../server/named.js';
import { NamedQuests, makeQuestStore, PHRASE_WAIT } from '../server/namedquests.js';
import { NamedTalk } from '../server/ai/namedtalk.js';
import { MOBS } from '../shared/data.js';
import { floorOf } from '../shared/floor2.js';
import { NAMED_BY_ID, GAINS, tierIndex, TIERS } from '../shared/named.js';
import {
  REQ, OUTREACH, PERSONA, FLOOR_REQ, KILL_BAND, rollRequest, kindsFor, rewardFor, goalText, phraseRequest, goldFor, mobName,
} from '../shared/namedquests.js';

const PORT = Number(process.env.PORT) || 5810;
const DB_URL = process.env.DATABASE_URL || '';
const DB = /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(DB_URL) ? DB_URL : ''; // a local test database only
if (DB_URL && !DB) console.log('  (DATABASE_URL is not a local database: skipping the Postgres checks)');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}
process.on('uncaughtException', e => { console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });
const seq = vals => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

// =====================================================================================================================
console.log('# pure rules (shared/namedquests.js)');
{
  const { halvard, maribel, tovin, sennet, cairn } = NAMED_BY_ID;
  const tally = (def, ctx, k = 400) => { const c = {}; for (let i = 0; i < k; i++) { const r = rollRequest(def, ctx); if (r) c[r.k] = (c[r.k] || 0) + 1; } return c; };
  const ally = { pts: 40, lvl: 12, floor: 1 };
  const t = tally(tovin, ally), m = tally(maribel, ally), s = tally(sennet, ally);
  ok(t.kill > 300 && !t.bring, `Tovin wants kill counts (${JSON.stringify(t)})`);
  ok(m.bring > 250 && !m.boss, `Maribel wants herbs and materials (${JSON.stringify(m)})`);
  ok(s.boss > s.kill && s.boss > (s.bring || 0), `Sennet studies bosses (${JSON.stringify(s)})`);
  ok(PERSONA.maribel.mats.includes('resin') && Object.values(tally(maribel, { pts: 0, lvl: 5, floor: 1 }, 600)).length > 0, 'the Hearthward ask even a Stranger');
  ok(!rollRequest(cairn, { pts: 14, lvl: 12, floor: 1 }) && !!rollRequest(cairn, { pts: 15, lvl: 12, floor: 1 }), 'Cairn asks nothing of a Stranger, only from Known');
  ok(PERSONA.cairn.ask < 0.5 && PERSONA.cairn.every >= 3 * PERSONA.tovin.every, 'and rarely: a small chance, long between offers');
  ok(!kindsFor(halvard, { pts: 20, lvl: 12, floor: 1 }).some(([k]) => k === 'boss') && kindsFor(halvard, { pts: 35, lvl: 12, floor: 1 }).some(([k]) => k === 'boss'), 'boss help only once a Hero would party with you (Ally)');
  ok(!kindsFor(cairn, { pts: 40, lvl: 12, floor: 1 }).some(([k]) => k === 'boss') && kindsFor(cairn, { pts: 60, lvl: 12, floor: 1 }).some(([k]) => k === 'boss'), '…the loner at Friend');
  ok(!kindsFor(halvard, { pts: 40, lvl: 3, floor: 1 }).some(([k]) => k === 'boss'), 'and not while you are far under the boss');
  // floor and level range
  let inBand = true, onFloor = true;
  for (const floor of [1, 2, 3]) for (const lvl of [3, 8, 12, 16, 22, 28]) for (let i = 0; i < 40; i++) {
    const r = rollRequest(tovin, { pts: 5, lvl, floor });
    if (!FLOOR_REQ[floor].kill.some(([mob]) => mob === r.mob)) onFloor = false;
    const lv = MOBS[r.mob].level, band = FLOOR_REQ[floor].kill.filter(([mb]) => MOBS[mb].level >= lvl + KILL_BAND[0] && MOBS[mb].level <= lvl + KILL_BAND[1]);
    if (band.length && !band.some(([mb]) => mb === r.mob)) inBand = false;
    if (!band.length && Math.abs(lv - lvl) > Math.min(...FLOOR_REQ[floor].kill.map(([mb]) => Math.abs(MOBS[mb].level - lvl)))) inBand = false;
  }
  ok(onFloor && inBand, 'a kill request picks a mob from your floor and level range (or the nearest there is)');
  ok(rollRequest(tovin, { pts: 0, lvl: 5, floor: 1 }, () => 0).n === 15 && rollRequest(halvard, { pts: 0, lvl: 5, floor: 1 }, () => 0).n === 10, 'Tovin keeps score: half again as many (15 Forest Boars, not 10)');
  const kill = { k: 'kill', mob: 'wolf', n: 8, floor: 1 }, boss = { k: 'boss', mob: 'sovereign', n: 1, floor: 2 };
  ok(rewardFor(kill, 10, () => 0.99).gold === goldFor(10) && rewardFor(boss, 10, () => 0.99).gold === goldFor(10) * 2 && rewardFor(kill, 10, () => 0.99).item === null, 'gold by level (a boss pays double)');
  ok(rewardFor(kill, 10, () => 0).item === 'field' && rewardFor(boss, 10, () => 0).item === 'mireElite', 'now and then a rolled item, from the floor\'s table');
  ok(goalText(kill) === 'Defeat 8 Dire Wolves' && goalText({ k: 'bring', mat: 'resin', n: 6 }) === 'Bring 6 Thorn Resin' && goalText(boss) === 'Help them fell the Drowned Sovereign' && mobName('harpy', 5) === 'Gale Harpies', 'goals in plain words');
  const line = phraseRequest(tovin, kill, { name: 'Nat' }, 'offer', () => 0);
  ok(/Nat/.test(line) && /8 Dire Wolves/.test(line), `canned lines in character: "${line}"`);
  ok(/Nat/.test(phraseRequest(halvard, { k: 'raid', boss: 'warden' }, { name: 'Nat' }, 'raid')) && phraseRequest(cairn, null, { name: 'Nat' }, 'declined') === 'Fine.', 'outreach and decline lines');
}

// =====================================================================================================================
console.log('# in process (server/namedquests.js on a NamedManager)');
function memStore() {
  const rows = new Map();
  return {
    rows,
    load: async charId => [...rows.values()].filter(r => r.char_id === charId).map(r => ({ ...r, req: r.req ? JSON.parse(r.req) : null })),
    save: async (charId, id, r) => { rows.set(`${charId}:${id}`, { char_id: charId, named_id: id, req: r.req ? JSON.stringify(r.req) : null, next_at: r.nextAt, day: r.day, got: r.got }); },
  };
}
function world({ store = null, presence = false } = {}) {
  const g = new Game();
  const tracked = [];
  g.track = (p, kind, data) => { tracked.push({ p, kind, data }); };
  const mgr = new BotManager(g, { url: 'ws://127.0.0.1:9/ws' });
  clearInterval(mgr.timer);
  mgr.start = function (roles, names, { lvl, behaviour, join }) { // (as test/named.js: a "bot" is just a player added here)
    this.joining = true; this.joiningNamed = !!join?.named;
    let p;
    try { p = g.addPlayer({ readyState: 1, send() {} }, names[0], roles[0]); } finally { this.joining = false; this.joiningNamed = false; }
    p.bot = true; p.lvl = lvl;
    g.recompute(p); p.hp = p.maxHp;
    if (join?.named) this.namedJoin?.(p, join.named);
    const e = { bid: this.nextBid++, behaviour, lvl, at: Date.now(), b: { id: p.id, name: p.name, cls: p.cls, closed: false, goal: 'Farming the field', cmd: null, t: 0 } };
    e.group = { configure: o => { e.b.cfg = o; }, drop: b => { b.closed = true; g.removePlayer(p); } };
    this.bots.push(e);
    return [{ bid: e.bid }];
  };
  const clock = { t: Date.UTC(2026, 10, 18, 12) };
  const nm = new NamedManager(g, mgr, { interval: 0, now: () => clock.t, presence });
  const R = { f: Math.random };
  const qs = new NamedQuests(nm, { store, rnd: () => R.f() });
  const human = (name, lvl = 12, cls = 'swordsman', saved = null) => {
    const sent = [];
    const p = g.addPlayer({ readyState: 1, send: s => sent.push(JSON.parse(s)) }, name, cls, saved);
    p.lvl = lvl; g.recompute(p); p.hp = p.maxHp; p.sent = sent;
    return p;
  };
  const tick = (k = 1, secs = 1) => { for (let i = 0; i < k; i++) { clock.t += secs * 1000; nm.tick(); } };
  const P = id => nm.playerOf(nm.chars.get(id));
  const sys = p => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);
  const set = (h, id, pts) => { nm.recOf(h, id).pts = pts; };
  const msgs = (h, op, ev) => h.sent.filter(m => m.type === 'named' && m.op === op && (!ev || m.ev === ev));
  const card = (h, id) => nm.listFor(h).rows.find(r => r.id === id).req;
  const mob = type => [...g.mobs.values()].find(m => m.type === type);
  const kill = (type, ...who) => { const m = mob(type); m.dead = false; m.hp = 1; m.contributors = new Set(who.map(p => p.id)); g.killMob(m, who[0]); };
  return { g, mgr, nm, qs, clock, R, human, tick, P, sys, set, msgs, card, mob, kill, tracked };
}

{
  const { g, nm, qs, clock, R, human, tick, P, sys, set, msgs, card, kill, tracked } = world();
  const nat = human('Natan', 8); // (level 8: a Floor 1 kill request is 8-15 of something, not 2 Alpha Wolves)
  const G = goldFor(8); // (gold follows your level: kills below level you up)
  tick(2);
  ok(nm.quests === qs && nm.online().length === 5, 'the quests ride on the manager (named.quests)');

  // ---- offering ----
  R.f = () => 0.5;
  const c0 = card(nat, 'tovin');
  ok(c0?.state === 'offer' && c0.k === 'kill' && FLOOR_REQ[1].kill.some(([m]) => m === qs.rec(nat, 'tovin').offer.mob) && c0.text && c0.gold === G && c0.n >= 8, `Tovin offers a request in the Friends tab: "${c0?.text}"`);
  ok(card(nat, 'tovin').text === c0.text, 'the same offer until it\'s taken (or goes stale)');
  ok(card(nat, 'cairn').state === 'none' && /Known/.test(card(nat, 'cairn').why), 'Cairn asks nothing of a Stranger');
  set(nat, 'cairn', 20);
  R.f = () => 0.9; // (his roll fails)
  ok(card(nat, 'cairn').state === 'none' && qs.rec(nat, 'cairn').nextAt > clock.t + 3 * 3600e3, '…and at Known only now and then: a missed roll waits hours');
  // take
  nat.sent.length = 0;
  nm.handle(nat, { type: 'named', op: 'req', id: 'tovin', act: 'take' });
  const tq = qs.rec(nat, 'tovin').req;
  ok(tq && tq.k === 'kill' && tq.got === 0 && tq.until === clock.t + REQ.ttl * 1000 && msgs(nat, 'req')[0]?.list && /You took/.test(msgs(nat, 'req')[0].msg), 'taking it: an active request for 24 hours');
  ok(card(nat, 'tovin').state === 'active' && card(nat, 'tovin').prog === 0 && card(nat, 'tovin').mins === REQ.ttl / 60, 'the card shows it active, with progress and time left');
  ok(qs.take(nat, 'tovin') !== '' && qs.rec(nat, 'tovin').req === tq, 'at most one active request per Named');
  ok(tracked.some(t => t.kind === 'named_req' && t.data.ev === 'take'), 'tracked');

  // ---- progress: kills a human took part in ----
  const want = tq.mob, other = FLOOR_REQ[1].kill.map(([m]) => m).find(m => m !== want);
  kill(want, nat);
  ok(tq.got === 1 && msgs(nat, 'req', 'progress').at(-1)?.got === 1, 'a kill you took part in counts (a progress toast)');
  kill(other, nat);
  ok(tq.got === 1, 'another mob doesn\'t');
  kill(want, P('cairn'));
  ok(tq.got === 1, 'a Named-only kill never counts');
  kill(want, P('halvard'), nat);
  ok(tq.got === 2, 'a kill shared with a Named does');
  const bot = human('Botty', 12); bot.bot = true;
  kill(want, bot);
  ok(tq.got === 2 && card(bot, 'tovin') === null && qs.recs.get(nm.keyOf(bot)) === undefined, 'bots get no requests');
  // ---- finishing: rewards ----
  // fill today's shared cap first: requests have their own
  for (let i = 0; i < 80; i++) nm.add(nat, 'tovin', GAINS.fight, 'fight');
  const capped = nm.friendship(nat, 'tovin');
  ok(capped.left === 0, `the shared daily cap is used up (${capped.pts})`);
  const gold0 = nat.gold, bag0 = nat.inv.bag.length;
  R.f = () => 0; // (the item roll succeeds)
  while (qs.rec(nat, 'tovin').req) kill(want, nat);
  const done = msgs(nat, 'req', 'done').at(-1), fr1 = nm.friendship(nat, 'tovin').pts - capped.pts;
  ok(done && done.gold === goldFor(nat.lvl) && nat.gold - gold0 >= done.gold, `done: gold (+${done?.gold})`);
  ok(nat.inv.bag.length >= bag0 + 1 && nat.inv.bag.some(it => it.name === done.item?.name && it.r === done.item.r), `and a rolled item (${done?.item?.name})`);
  ok(Math.abs(fr1 - REQ.friend.kill) < 0.01 && done.fr === REQ.friend.kill, `and friendship (+${fr1}) even with the shared cap used up (requests have their own)`);
  ok(sys(nat).some(s => /Request done for Tovin/.test(s)) && g.events.some(e => e.t === 'chat' && e.id === P('tovin').id && e.text === done.text), 'a line in the log, and Tovin says thanks when he\'s near');
  ok(qs.rec(nat, 'tovin').req === null && card(nat, 'tovin').state === 'none' && qs.rec(nat, 'tovin').nextAt === clock.t + PERSONA.tovin.every * 1000, 'the next offer after a while');
  // the request cap: 6 a day per Named
  clock.t = qs.rec(nat, 'tovin').nextAt + 1000;
  R.f = () => 0.5;
  ok(card(nat, 'tovin').state === 'offer', 'a new offer');
  qs.take(nat, 'tovin');
  const t2 = qs.rec(nat, 'tovin').req;
  R.f = () => 0.99;
  const p0 = nm.friendship(nat, 'tovin').pts;
  while (qs.rec(nat, 'tovin').req) kill(t2.mob, nat);
  const fr2 = nm.friendship(nat, 'tovin').pts - p0;
  ok(Math.abs(fr2 - (REQ.friendDaily - REQ.friend.kill)) < 0.01, `the second request today gives only what's left of the request cap (+${fr2})`);
  ok(msgs(nat, 'req', 'done').at(-1).gold === goldFor(nat.lvl), 'but still pays gold');

  // ---- bring: handed over in person ----
  R.f = () => 0.5;
  const mar = P('maribel');
  ok(card(nat, 'maribel').k === 'bring', 'Maribel asks for materials');
  qs.take(nat, 'maribel');
  const mq = qs.rec(nat, 'maribel').req;
  nat.x = mar.x + 40; nat.z = mar.z;
  g.matsOf(nat)[mq.mat] = 0; // (kills above may have dropped some)
  ok(/You need/.test(card(nat, 'maribel').turnIn.why) && card(nat, 'maribel').got === 0, 'nothing to hand over yet');
  g.giveMats(nat, { [mq.mat]: mq.n - 1 });
  ok(card(nat, 'maribel').got === mq.n - 1 && card(nat, 'maribel').prog < 1, 'progress follows what\'s in your bag');
  g.giveMats(nat, { [mq.mat]: 3 }); // (2 more than asked)
  ok(/Find Maribel/.test(card(nat, 'maribel').turnIn.why) && qs.turnIn(nat, 'maribel') !== '', 'with enough: you have to find her');
  nat.x = mar.x + 3; nat.z = mar.z;
  ok(card(nat, 'maribel').turnIn.ok, 'near her: Turn in');
  nat.sent.length = 0;
  nm.handle(nat, { type: 'named', op: 'req', id: 'maribel', act: 'turnin' });
  ok(qs.rec(nat, 'maribel').req === null && nat.inv.mats[mq.mat] === 2 && msgs(nat, 'req', 'done').length === 1, 'handed over: the materials are gone and it\'s done');
  // talking (I3) also hands them over
  clock.t = qs.rec(nat, 'maribel').nextAt + 1000;
  R.f = seq([0.5, 0.5, 0.1]);
  card(nat, 'maribel'); qs.take(nat, 'maribel');
  const mq2 = qs.rec(nat, 'maribel').req;
  R.f = () => 0.5;
  if (mq2.k === 'bring') {
    g.giveMats(nat, { [mq2.mat]: mq2.n });
    nat.x = mar.x + 80;
    ok(qs.turnIn(nat, 'maribel', { talk: true }) === '' && !qs.rec(nat, 'maribel').req, 'or while talking to her (the hook for I3)');
  } else ok(qs.abandon(nat, 'maribel') === '', '(a kill request this time: dropped)');
  // …and through I3's talk path: a line to her nearby (AI off: a canned reply)
  clock.t = Math.max(qs.rec(nat, 'maribel').nextAt, clock.t) + 1000;
  qs.rec(nat, 'maribel').offer = null;
  let mq3 = null;
  for (let i = 0; i < 30 && mq3?.k !== 'bring'; i++) { qs.rec(nat, 'maribel').offer = null; R.f = Math.random; mq3 = qs.offerFor(nat, 'maribel'); }
  R.f = () => 0.5;
  qs.take(nat, 'maribel');
  g.giveMats(nat, { [mq3.mat]: mq3.n });
  const talk = new NamedTalk({ game: g, cfg: { namedGapS: 0, namedDaily: 30 }, provider: null, budget: null, now: () => clock.t, log: () => {} });
  nat.x = mar.x + 30; nat.z = mar.z;
  await talk.talk(nat, nm.chars.get('maribel'), 'Maribel, I brought what you asked for.');
  ok(!qs.rec(nat, 'maribel').req && msgs(nat, 'req', 'done').at(-1).id === 'maribel', 'talking to her nearby (I3\'s talk path) hands the materials over');
  // review #9: on Floors 2–3 (where the Named rarely are) the card says @Name works, and it does, from anywhere there
  clock.t = Math.max(qs.rec(nat, 'maribel').nextAt, clock.t) + 1000;
  let mq4 = null;
  for (let i = 0; i < 30 && mq4?.k !== 'bring'; i++) { qs.rec(nat, 'maribel').offer = null; R.f = Math.random; mq4 = qs.offerFor(nat, 'maribel'); }
  R.f = () => 0.5;
  qs.take(nat, 'maribel');
  g.giveMats(nat, { [mq4.mat]: mq4.n });
  const nx = nat.x, nz = nat.z;
  nat.x = mar.x + 200; nat.z = mar.z;
  ok(/Find Maribel/.test(card(nat, 'maribel').turnIn.why) && !/@Maribel/.test(card(nat, 'maribel').turnIn.why), 'Floor 1, far from her: find her (no @ hint)');
  nat.x = 700; nat.z = 40; // (Floor 2)
  ok(floorOf(nat.x) === 2 && /@Maribel/.test(card(nat, 'maribel').turnIn.why), `Floor 2: the card hints that @Maribel hands it over (${card(nat, 'maribel').turnIn.why})`);
  await talk.talk(nat, nm.chars.get('maribel'), 'Here are the things you asked for.', { explicit: true });
  ok(!qs.rec(nat, 'maribel').req && msgs(nat, 'req', 'done').at(-1).id === 'maribel', 'Floor 2: talking to her from afar hands the materials over');
  nat.x = nx; nat.z = nz;

  // ---- boss help ----
  set(nat, 'halvard', 40);
  R.f = seq([0.5, 0.9, 0.5]); // (weights: kill 2, boss 2, bring 1 → 0.9 lands on boss? retry until it does)
  let hq = null;
  for (let i = 0; i < 20 && !hq; i++) { qs.rec(nat, 'halvard').offer = null; R.f = () => Math.random(); const o = qs.offerFor(nat, 'halvard'); if (o?.k === 'boss') hq = o; }
  ok(hq?.mob === 'warden', 'Halvard (Ally) asks for help with the Warden');
  qs.take(nat, 'halvard');
  nm.onFightEnd({ team: new Map([[nat.id, { dmg: 5 }], [P('halvard').id, { dmg: 95 }]]) }, 'kill');
  ok(qs.rec(nat, 'halvard').req?.k === 'boss', 'too little help (5% of the damage) doesn\'t count');
  nm.onFightEnd({ team: new Map([[nat.id, { dmg: 30 }], [P('halvard').id, { dmg: 70 }]]) }, 'wipe');
  ok(qs.rec(nat, 'halvard').req?.k === 'boss', 'nor a wipe');
  nm.onFightEnd({ team: new Map([[nat.id, { dmg: 30 }], [P('halvard').id, { dmg: 70 }]]) }, 'kill');
  ok(!qs.rec(nat, 'halvard').req && msgs(nat, 'req', 'done').at(-1).id === 'halvard' && msgs(nat, 'req', 'done').at(-1).gold === goldFor(nat.lvl) * 2, 'real help in a kill finishes it (double gold)');

  // ---- expiry ----
  clock.t = Math.max(qs.rec(nat, 'sennet').nextAt, clock.t) + 1000;
  R.f = () => 0.5;
  ok(card(nat, 'sennet').state === 'offer', 'Sennet offers one');
  qs.take(nat, 'sennet');
  tick(1, REQ.ttl - 10);
  ok(!!qs.rec(nat, 'sennet').req, 'still there just before 24 hours');
  nat.sent.length = 0;
  tick(1, 20);
  ok(!qs.rec(nat, 'sennet').req && msgs(nat, 'req', 'expired').length === 1 && qs.rec(nat, 'sennet').nextAt === clock.t + REQ.dropAfter * 1000, 'expired after 24 hours (a toast), a new offer later');
  // drop
  clock.t = qs.rec(nat, 'sennet').nextAt + 1000;
  card(nat, 'sennet'); qs.take(nat, 'sennet');
  nm.handle(nat, { type: 'named', op: 'req', id: 'sennet', act: 'drop' });
  ok(!qs.rec(nat, 'sennet').req && card(nat, 'sennet').state === 'none', 'dropping one');

  // ---- the AI phrasing hook ----
  clock.t = qs.rec(nat, 'sennet').nextAt + 1000;
  qs.phraser = async (def, req, player, moment) => `${def.name} (AI) to ${player.name}: ${moment} ${req.k}`;
  const o = qs.offerFor(nat, 'sennet');
  const canned = o.text;
  await sleep(5);
  ok(canned && o.text === `Sennet (AI) to Natan: offer ${o.k}`, 'quests.phraser replaces the canned line when it answers');
  qs.rec(nat, 'sennet').offer = null; clock.t += 1000;
  qs.phraser = async () => { throw new Error('no key'); };
  const o2 = qs.offerFor(nat, 'sennet'); const c2 = o2.text;
  await sleep(5);
  ok(c2 && o2.text === c2, 'a failing phraser keeps the canned line');
  qs.rec(nat, 'sennet').offer = null; clock.t += 1000;
  qs.phraser = () => new Promise(() => {}); // (never answers)
  const o3 = qs.offerFor(nat, 'sennet'); const c3 = o3.text;
  ok(o3.phrasing && qs.cardFor(nat, 'sennet').state === 'none', 'an offer waits for its line…');
  await sleep(PHRASE_WAIT + 100);
  ok(!o3.phrasing && o3.text === c3 && qs.cardFor(nat, 'sennet').state === 'offer', `…at most ${PHRASE_WAIT / 1000} s, then the canned line`);
  qs.phraser = () => ''; // (AI off: answers at once)
  qs.rec(nat, 'sennet').offer = null; clock.t += 1000;
  const o4 = qs.offerFor(nat, 'sennet');
  ok(!o4.phrasing && qs.cardFor(nat, 'sennet').state === 'offer', 'a phraser that answers at once holds nothing up');
  qs.phraser = null;
}

// ---- outreach from a Named resting at home (presence, shared/named.js PRESENCE) ----
{
  const { nm, qs, R, human, tick, P, set, msgs } = world({ presence: true });
  const nat = human('Natan', 12);
  nat.x = 0; nat.z = 0; // (in town: they rest at home in the field)
  R.f = () => 0;
  set(nat, 'tovin', 60);
  tick(OUTREACH.settle + OUTREACH.every * 2);
  const m = msgs(nat, 'out').find(o => o.kind);
  ok(nm.online().length === 0 && m?.id === 'tovin', 'resting at home, a Friend still hears from Tovin');
  nm.handle(nat, { type: 'named', op: 'out', id: 'tovin', yes: true });
  ok(['halvard', 'maribel', 'tovin', 'sennet'].every(id => nm.chars.get(id).e), 'Accept wakes the Hearthward');
  tick(2);
  ok(P('tovin')?.party === nat.party && !!nat.party && Math.hypot(P('tovin').x - nat.x, P('tovin').z - nat.z) < 6, 'and Tovin joins your party and comes to you');
  void qs;
}

// ---- outreach ----
{
  const { g, nm, qs, clock, R, human, tick, P, sys, set, msgs } = world();
  const nat = human('Natan', 12), ann = human('Ann', 12);
  tick(2);
  R.f = () => 0; // (every chance passes)
  for (const id of ['halvard', 'maribel', 'tovin', 'sennet']) set(ann, id, 40);
  set(nat, 'cairn', 90);
  tick(OUTREACH.settle + OUTREACH.every * 2);
  ok(!msgs(ann, 'out').length && !msgs(nat, 'out').length, 'nobody messages an Ally, and Cairn never does (his raid whisper is his only one)');
  set(nat, 'tovin', 60);
  tick(OUTREACH.every);
  const m1 = msgs(nat, 'out')[0];
  ok(m1?.id === 'tovin' && m1.kind && m1.text && sys(nat).some(s => /Tovin whispers/.test(s)), `at Friend, Tovin messages you (${m1?.kind}): "${m1?.text}"`);
  ok(m1.until - clock.t <= OUTREACH.ttl * 1000, 'with Accept / Decline for a minute');
  tick(OUTREACH.ttl + 1);
  set(nat, 'maribel', 60);
  tick(OUTREACH.gap - OUTREACH.ttl - 40, 1);
  ok(msgs(nat, 'out').length === 1, 'one message every 15 minutes at most, across all of them');
  tick(60);
  const m2 = msgs(nat, 'out')[1];
  ok(m2?.id === 'maribel', 'after the gap: Maribel (Tovin waits his hour)');
  nat.sent.length = 0;
  nm.handle(nat, { type: 'named', op: 'out', id: 'maribel', yes: false });
  ok(sys(nat).some(s => /Maribel whispers: "(Another time|No trouble)/.test(s)) && !nat.party, 'a "no", answered politely');
  clock.t += 3 * 3600e3; tick(2);
  ok(msgs(nat, 'out').filter(m => m.kind).every(m => m.id !== 'maribel') && msgs(nat, 'out').some(m => m.id === 'tovin' && m.kind), 'Maribel never asks again this session; Tovin does after his hour');
  // accept
  const m3 = msgs(nat, 'out').find(m => m.id === 'tovin' && m.kind);
  nat.x = 0; nat.z = 0;
  nm.handle(nat, { type: 'named', op: 'out', id: 'tovin', yes: true });
  ok(P('tovin').party === nat.party && !!nat.party && Math.hypot(P('tovin').x - nat.x, P('tovin').z - nat.z) < 6, `Accept: Tovin joins your party and comes to you (${m3.kind})`);
  ok(nm.handle(nat, { type: 'named', op: 'out', id: 'tovin', yes: true }) === undefined && /lapsed/.test(msgs(nat, 'out').at(-1).error), 'an answer twice: lapsed');
  g.leaveParty(nat); tick(2);
  // never in a show, never mid-boss
  clock.t += 3 * 3600e3;
  g.director = { running: true };
  tick(OUTREACH.every * 3);
  const before = msgs(nat, 'out').filter(m => m.kind).length;
  g.director = null;
  const w = [...g.mobs.values()].find(m => m.type === 'warden');
  nat.x = w.x; nat.z = w.z;
  tick(OUTREACH.every * 3);
  ok(msgs(nat, 'out').filter(m => m.kind).length === before, 'none during a director show, none in a boss room');
  nat.x = 0; nat.z = 0;
  tick(OUTREACH.every * 2);
  ok(msgs(nat, 'out').filter(m => m.kind).length === before + 1, 'back in town: the next one comes');
  // an unanswered one isn't a "no"
  const o = qs.outOf(nat);
  ok(o.no.size === 1 && !o.no.has('tovin'), 'an unanswered message lapses without counting as a "no"');
  // the Named in a fight or with someone else: busy
  set(ann, 'tovin', 60);
  g.invite(nat, P('tovin').id); g.accept(P('tovin'), nat.id);
  ok(qs.outBlock(ann, nm.chars.get('tovin'), clock.t) === 'busy', 'a Named in someone\'s party doesn\'t message others');
}

// ---- save / load (a store) ----
{
  const store = memStore();
  const a = world({ store });
  const nat = a.human('Natan', 8, 'swordsman', { charId: 7, lvl: 8, xp: 0, gold: 0 });
  nat.charId = 7;
  a.tick(1);
  await sleep(5);
  a.R.f = () => 0.5;
  ok(a.qs.recsOf(nat).loaded && a.card(nat, 'tovin').state === 'offer', 'a saved character: loaded (nothing stored yet), an offer');
  a.qs.take(nat, 'tovin');
  const tq = a.qs.rec(nat, 'tovin').req;
  a.kill(tq.mob, nat); a.kill(tq.mob, nat);
  a.tick(4);
  await sleep(5);
  const row = store.rows.get('7:tovin');
  ok(row && JSON.parse(row.req).got === 2, 'saved while you play (every few seconds)');
  a.g.removePlayer(nat);
  ok(!a.qs.recs.has(7), 'leaving: saved, then forgotten');
  // a fresh server
  const b = world({ store });
  const nat2 = b.human('Natan', 8, 'swordsman', { charId: 7, lvl: 8, xp: 0, gold: 0 });
  nat2.charId = 7;
  b.clock.t = a.clock.t;
  ok(b.card(nat2, 'tovin') === null || b.qs.recsOf(nat2).loaded === false, 'until the stored rows are in: no card, no offers');
  await sleep(5);
  const q2 = b.qs.rec(nat2, 'tovin').req;
  ok(q2 && q2.mob === tq.mob && q2.got === 2 && q2.until === tq.until && b.card(nat2, 'tovin').state === 'active', 'back after a restart: the same request, its progress and its deadline');
  b.clock.t = tq.until + 1000; b.tick(1);
  ok(!b.qs.rec(nat2, 'tovin').req, 'and it still runs out on time');
}

// =====================================================================================================================
console.log('# server');
const servers = new Set();
process.on('exit', () => { for (const s of servers) s.kill('SIGKILL'); });
function startServer(env = {}) {
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', TEST_HOOKS: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; }); srv.stderr.on('data', d => { srv.log += d; });
  srv.ready = until(() => /running on/.test(srv.log), 15000, 'the server');
  srv.stop = () => new Promise(r => { servers.delete(srv); srv.once('exit', r); srv.kill('SIGKILL'); });
  servers.add(srv);
  return srv;
}
function client(name, join = {}) {
  const c = { name, msgs: [] };
  c.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'join', name, cls: 'swordsman', ...join })));
  c.ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'welcome') Object.assign(c, { id: m.id, welcome: m }); else if (m.type !== 'snap') c.msgs.push(m); });
  c.send = o => c.ws.send(JSON.stringify(o));
  c.ask = async o => { const k = c.msgs.length; c.send(o); return until(() => c.msgs.slice(k).find(m => m.type === 'named' && m.op === o.op && (m.list || m.error)), 5000, `${o.op} reply`); };
  c.close = () => c.ws.close();
  return c;
}
{
  const srv = startServer();
  await srv.ready;
  const a = client('Quester');
  await until(() => a.id, 5000, 'join');
  await sleep(2500);
  const l = await a.ask({ type: 'named', op: 'list' });
  const row = l.list.rows.find(r => r.id === 'tovin');
  ok(row?.req?.state === 'offer' && row.req.text && l.list.rows.find(r => r.id === 'cairn').req.state === 'none', 'the Friends list carries each Named\'s request card');
  const t = await a.ask({ type: 'named', op: 'req', id: 'tovin', act: 'take' });
  ok(t.msg && t.list.rows.find(r => r.id === 'tovin').req.state === 'active', 'take it over the socket');
  const d = await a.ask({ type: 'named', op: 'req', id: 'tovin', act: 'drop' });
  ok(d.msg && d.list.rows.find(r => r.id === 'tovin').req.state === 'none', 'and drop it');
  a.close();
  await srv.stop();
}
{
  const srv = startServer({ NAMED_ENABLED: '0' });
  await srv.ready;
  const a = client('Quiet');
  await until(() => a.id, 5000, 'join');
  a.send({ type: 'named', op: 'req', id: 'tovin', act: 'take' });
  await sleep(600);
  ok(!a.welcome.named && !a.msgs.some(m => m.type === 'named'), 'NAMED_ENABLED=0: no requests, no outreach, nothing');
  a.close();
  await srv.stop();
}
if (DB) {
  console.log('# Postgres');
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: DB });
  const q = (t, p) => pool.query(t, p).then(r => r.rows);
  let srv = startServer({ DATABASE_URL: DB });
  await srv.ready; await srv.stop();
  srv = startServer({ DATABASE_URL: DB });
  await srv.ready; await srv.stop();
  ok((await q(`SELECT 1 FROM information_schema.tables WHERE table_name = 'named_requests'`)).length === 1, 'the migration runs twice without trouble');
  await q(`DELETE FROM characters WHERE name = 'NqTester'`);
  const [acc] = await q(`INSERT INTO accounts (discord_name) VALUES ('nq-test') RETURNING id`);
  const [ch] = await q(`INSERT INTO characters (account_id, name, cls, lvl) VALUES ($1, 'NqTester', 'swordsman', 12) RETURNING id`, [acc.id]);
  const st = makeQuestStore(q), req = { k: 'kill', mob: 'wolf', n: 8, floor: 1, got: 3, at: 1, until: 2 };
  await st.save(ch.id, 'tovin', { req, nextAt: 12345, day: 9, got: 4 });
  await st.save(ch.id, 'tovin', { req: { ...req, got: 4 }, nextAt: 12345, day: 9, got: 4 });
  await st.save(ch.id, 'maribel', { req: null, nextAt: 99, day: 9, got: 0 });
  const rows = await st.load(ch.id);
  const tv = rows.find(r => r.named_id === 'tovin');
  ok(rows.length === 2 && tv.req.got === 4 && +tv.next_at === 12345 && tv.got === 4 && rows.find(r => r.named_id === 'maribel').req === null, 'a request and its counters round-trip through named_requests (upsert)');
  await q('DELETE FROM accounts WHERE id = $1', [acc.id]);
  ok((await q('SELECT 1 FROM named_requests WHERE char_id = $1', [ch.id])).length === 0, 'deleting the character deletes its requests');
  await pool.end();
}

console.log(`\n${n - failed}/${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
