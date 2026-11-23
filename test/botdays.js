// Bot days (docs/briefs/bot-days.md, shared/bots/day.js): a free bot with the behaviour `own` picks its own next thing.
// Unit checks: the scores (repeatable from a seed, in range, each need leads to its goal, no flip-flopping), the monster
// it hunts, every goal's plan, the day on a stub bot (a goal becomes a quiet plan, an order pauses it and it resumes,
// a party with a player has no day, the picker's answer and its time limit, BOT_DAYS=0), and the real brain on a fake
// socket (out of potions: walks to the merchant, sells, buys, then goes on with its day; nothing is said).
// Live (skip with NO_LIVE=1): a server on PORT (default 3746) with a player in town and three free bots.
// Usage: node test/botdays.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createBot } from '../shared/bots/brain.js';
import { GOALS, GOAL_IDS, RESUME, PICK_WAIT, facts, needs, scoreGoals, pickKind, planFor, potionsWanted, dayTurn, dayText, dayLog, hasDay, daysEnabled } from '../shared/bots/day.js';
import { cleanPlan } from '../shared/bots/plan.js';
import { planTurn } from '../shared/bots/planrun.js';
import { rng, rollPersonality, ARCHETYPE_IDS } from '../shared/bots/personality.js';
import { MERCHANT, CONSUMABLES } from '../shared/items.js';
import { MOBS, MOB_IDS } from '../shared/data.js';
import { MODES } from '../shared/playerbots.js';
import { BEHAVIOURS } from '../server/botmanager.js';
import { startTeam } from '../shared/teambots.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;

// ---------- 1. scores ----------
// A stub bot: level 6 on the field, 3 potions, some gold, nobody about. t: traits (default: all 0.5).
function stub(o = {}, t = {}) {
  const b = { id: 2, name: 'Rook', behaviour: 'own', t: 1000, x: 0, z: 60, hp: 100, maxHp: 100, dead: false, me: { lvl: 6 }, cls: 'swordsman', players: [{ id: 2, x: 0, z: 60 }], names: new Map(), mobs: [], allMobs: [], locks: new Map(), life: {},
    cons: { potion: 3 }, gold: 40, bag: [], cds: [0, 0, 0, 0, 0], sent: [], said: [], cmd: null, plan: null, persona: { id: 'test', t: { aggression: 0.5, caution: 0.5, patience: 0.5, sociability: 0.5, chattiness: 0.5, playfulness: 0.5, curiosity: 0.5, ...t } }, ...o };
  b.send = m => b.sent.push(m);
  return b;
}
const top = (b, d, seed = 7) => scoreGoals(b, facts(b, d), rng(seed))[0];
{
  const b = stub();
  const a = scoreGoals(b, facts(b), rng(42)), c = scoreGoals(b, facts(b), rng(42)), e = scoreGoals(b, facts(b), rng(43));
  ok(J(a) === J(c) && J(a) !== J(e) && a.length === GOAL_IDS.length, 'the same seed gives the same scores; another seed, another luck');
  let lo = 9, hi = -9;
  for (let s = 1; s <= 200; s++) {
    const p = rollPersonality(`Bot${s}`, ARCHETYPE_IDS[s % ARCHETYPE_IDS.length]), r = rng(s);
    const q = stub({ persona: p, cons: { potion: Math.floor(r() * 5) }, gold: Math.floor(r() * 80), bag: Array.from({ length: Math.floor(r() * 24) }, (_, i) => ({ u: i })) });
    const d = { t0: 0, restT: q.t - r() * 2000, sameT: q.t - r() * 1500, seenT: q.t - r() * 1500, deaths: Math.floor(r() * 3), log: [] };
    for (const g of scoreGoals(q, facts(q, d), r)) { lo = Math.min(lo, g.score); hi = Math.max(hi, g.score); if (typeof g.why !== 'string' || !g.why) hi = 99; }
    for (const v of Object.values(needs(q, facts(q, d)))) { lo = Math.min(lo, v); hi = Math.max(hi, v > 1 ? 99 : hi); }
  }
  ok(lo >= 0 && hi <= 1.151, `200 bots in random states: every need is 0 to 1, every score 0 to 1.15, every goal has a reason (${lo} to ${hi})`);
  ok(top(b).id === 'hunt' && top(b).why === 'earning gold' && top(stub({ me: { lvl: 3 } })).why === 'levelling up', 'nothing pressing: it hunts (levelling up below the boss\'s level, earning gold after)');
  ok(top(stub({ cons: { potion: 0 } })).id === 'restock' && top(stub({ cons: { potion: 0 } })).why === 'out of potions' && top(stub({ cons: { potion: 1 }, gold: 20 })).id === 'restock', 'out of potions (or down to one) with gold: it restocks');
  const broke = stub({ cons: { potion: 0 }, gold: 5 });
  ok(top(broke).id === 'hunt' && top(broke).why === 'no gold for potions' && scoreGoals(broke, facts(broke), rng(1)).find(g => g.id === 'restock').score === 0, 'out of potions with no gold and nothing to sell: it hunts for the gold');
  ok(top(stub({ cons: { potion: 0 }, gold: 5, bag: [{ u: 1 }] })).id === 'restock', 'no gold but gear to sell: it restocks');
  const full = stub({ bag: Array.from({ length: 21 }, (_, i) => ({ u: i })) });
  ok(top(full).id === 'restock' && top(full).why === 'bag is nearly full' && top(stub({ bag: Array.from({ length: 10 }, (_, i) => ({ u: i })) })).id === 'hunt', 'a nearly full bag sends it to the merchant; a half-empty one doesn\'t');
  ok(top(b, { restT: b.t - 1500, log: [] }).id === 'rest' && top(b, { restT: b.t - 200, deaths: 3, log: [] }).id === 'rest' && top(b, { restT: b.t - 200, deaths: 3, log: [] }).why === 'that went badly', 'long since it sat down, or a few deaths: it rests');
  const curious = stub({}, { curiosity: 0.9 }), homebody = stub({}, { curiosity: 0.1 });
  ok(top(curious, { sameT: curious.t - 700, log: [] }).id === 'wander' && top(homebody, { sameT: homebody.t - 400, log: [] }).id === 'hunt', 'the same thing for a long while: a curious bot goes to look around, sooner than a homebody');
  const social = stub({}, { sociability: 0.9 }), loner = stub({}, { sociability: 0.1 });
  ok(top(social, { seenT: social.t - 600, log: [] }).id === 'hangout' && top(loner, { seenT: loner.t - 600, log: [] }).id === 'hunt', 'alone for ten minutes: a sociable bot goes to find people, a loner hunts on');
  // no flip-flopping: what it just did is cooled down, and a trip that got no potions isn't made again for the same gold
  const tired = { restT: b.t - 800, log: [{ g: 'rest' }] }, sc = id => (d, s) => scoreGoals(b, facts(b, d), rng(s)).find(g => g.id === id).score;
  ok(sc('rest')(tired, 5) < sc('rest')({ ...tired, log: [] }, 5) * 0.3 && sc('hunt')({ log: [{ g: 'hunt' }] }, 5) > sc('hunt')({ log: [] }, 5) * 0.85, 'what it just did scores far lower (a rest right after a rest); a hunt after a hunt is fine');
  const poor = stub({ cons: { potion: 0 }, gold: 15 });
  ok(top(poor).id === 'restock' && top(poor, { poor: 15, log: [] }).id === 'hunt' && top(stub({ cons: { potion: 0 }, gold: 40 }), { poor: 15, log: [] }).id === 'restock', 'it came away with no potions for 15 gold: not again until it has earned more');
}

// ---------- 2. what it hunts, and every goal's plan ----------
{
  const kinds = (b, o) => { const r = rng(3), set = new Set(); for (let i = 0; i < 300; i++) set.add(pickKind(b, facts(b), r, o)); return [...set].sort(); };
  const l1 = stub({ me: { lvl: 1 } }), l6 = stub(), l14 = stub({ me: { lvl: 14 } }), l14open = stub({ me: { lvl: 14 }, life: { floor2: 1 } });
  ok(J(kinds(l1)) === '["boar"]', 'level 1 hunts boars');
  ok(kinds(l6).every(k => !MOBS[k].elite && !MOBS[k].rare && !MOBS[k].boss && !MOBS[k].f2 && MOBS[k].level <= 7) && kinds(l6).includes('wolf') && kinds(l6).length >= 3, `level 6: a few kinds at or under its level, no elites (${kinds(l6)})`);
  ok(kinds(l14).every(k => !MOBS[k].f2 && !MOBS[k].f3) && kinds(l14open).some(k => MOBS[k].f2) && kinds(l14open).every(k => !MOBS[k].f3 && k !== 'thrall'), 'a sealed floor\'s monsters are never picked; with Floor 2 open, its monsters are (never the boss\'s thralls)');
  ok(!kinds(l6, { skip: ['wolf', 'spitter'] }).some(k => k === 'wolf' || k === 'spitter') && kinds(l14open, { floors: [1] }).every(k => !MOBS[k].f2), 'a kind it couldn\'t find is skipped; only the floors it is given');
  const r = rng(11);
  let bad = '';
  for (const id of GOAL_IDS) for (const fl of [1, 2]) for (let i = 0; i < 20; i++) {
    const b = stub({ x: fl === 2 ? 600 : 0, life: { floor2: 1 }, me: { lvl: fl === 2 ? 13 : 6 } }), made = planFor(id, b, facts(b), r);
    const c = cleanPlan(made?.steps), last = c?.steps.at(-1);
    if (!made?.text || !c || c.errors.length || c.steps.length !== made.steps.length || !(last.k === 'farm' || last.secs > 0)) bad ||= `${id} F${fl}: ${J(made)} ${J(c?.errors)}`;
  }
  ok(!bad, `every goal makes a plan the cleaner takes whole, ending in a step with an end (${bad || 'hunt, restock, rest, wander, hangout on Floors 1 and 2'})`);
  const rs = planFor('restock', stub({ cons: { potion: 1 } }, { caution: 1 }), facts(stub({ cons: { potion: 1 } })), rng(1));
  ok(J(rs.steps.slice(0, 2)) === J([{ k: 'sell' }, { k: 'buy', n: 5 }]) && potionsWanted(stub({}, { caution: 0 })) === 3 && potionsWanted(stub({}, { caution: 1 })) === 6, 'restock: sell, then buy up to its own number of potions (3 for the bold, 6 for the careful)');
  ok(GOALS.hunt && MODES.own?.behaviour === 'own' && BEHAVIOURS.own && daysEnabled(), 'the behaviour `own` is on the players\' and the admin\'s lists');
}

// ---------- 3. the day on a stub bot ----------
const api = {
  say: (b, key, vars, o) => b.said.push(o?.text || key),
  command: (b, c) => { if (c.k === 'farm' || c.k === 'boss') b.cmd = { k: c.k, group: c.group }; },
};
const PV = (b, humans = []) => ({ all: [{ id: b.id }, ...humans], humans, botLeader: { id: b.id } });
function turn(b, secs = 0.5, P = PV(b), r = Math.random) { for (let left = secs; left > 1e-9; left -= 0.5) { b.t += Math.min(0.5, left); dayTurn(b, P, api, r); if (b.plan) planTurn(b, P, api); } }
{
  const b = stub(), r = rng(5);
  turn(b, 0.5, PV(b), r);
  ok(b.plan?.day === 'hunt' && b.day.goal === 'hunt' && b.cmd?.k === 'farm' && b.cmd.mob === b.day.kind && /^Hunting .+: earning gold$/.test(dayText(b)) && !b.said.length, `its first turn: a hunt, as a plan marked as its day's, and nothing said (${dayText(b)})`);
  b.plan.st.kills = 99; turn(b, 1, PV(b), r);
  ok(!b.plan && !b.cmd && !b.said.length, 'the hunt is over: no "plan done" line, no order left behind');
  turn(b, 6, PV(b), r);
  ok(b.plan?.day && b.day.log[0]?.g === 'hunt' && b.day.log[0].how === 'done' && /^Hunting .+ \(\d+ s\)$/.test(dayLog(b)), `a breath, then the next goal; the last one is in its log (${dayLog(b)})`);
  // an order from a player: the day stops and waits
  b.plan = null; b.cmd = { k: 'stay', by: 4, byName: 'Vex', adm: true, x: 0, z: 60 };
  turn(b, 30, PV(b), r);
  ok(!b.plan && !b.day.goal && b.day.log[0].how === 'order' && b.cmd?.k === 'stay', 'an order: no goal of its own while it stands, however long');
  b.cmd = null; turn(b, RESUME - 2, PV(b), r);
  const waiting = !b.plan;
  turn(b, 4, PV(b), r);
  ok(waiting && b.plan?.day, `the order ends: its day goes on ${RESUME} s later, not before`);
  // somebody's plan is not its day's
  b.plan = { steps: [{ k: 'wait', secs: 600 }], i: 0, loops: 1, loop: 0, by: 4, adm: true, st: { t0: b.t }, t0: b.t, seen: b.t }; b.cmd = { k: 'stay', plan: 1, x: 0, z: 60 };
  turn(b, 3, PV(b), r);
  ok(b.plan && !b.plan.day && !b.day.goal, 'a player\'s plan is left alone');
  b.plan = null; b.cmd = null;
  // in a party with a player: no day; following another bot's lead: no day
  turn(b, RESUME + 5, PV(b, [{ id: 1 }]), r);
  ok(!b.plan && !b.day.goal, 'in a party with a player it has no day of its own');
  b.party = 7; turn(b, RESUME + 5, { all: [{ id: 2 }, { id: 3 }], humans: [], botLeader: { id: 3 } }, r);
  ok(!b.plan, 'nor while it follows another bot\'s lead');
  turn(b, RESUME + 5, { all: [{ id: 2 }, { id: 3 }], humans: [], botLeader: { id: 2 } }, r);
  ok(b.plan?.day, 'leading a party of bots, it chooses for them');
  // a hunt that finds none of its kind: another kind next time
  b.plan = null; b.cmd = null; b.day.goal = 'hunt'; b.day.kind = 'wolf'; b.dayStop = 'there are no Dire Wolves on this floor';
  turn(b, 0.5, PV(b), r);
  ok(b.day.skip.includes('wolf') && b.day.log[0].how === 'stopped' && !b.said.length, 'a plan that had to stop: noted, not said, and that monster is skipped for a while');
  // dead: nothing is chosen; a behaviour change ends the day
  b.dead = true; b.plan = null; b.day.hold = 0; turn(b, 10, PV(b), r);
  ok(!b.plan, 'dead: nothing is chosen');
  b.dead = false; turn(b, 6, PV(b), r);
  b.behaviour = 'field'; turn(b, 0.5, PV(b), r);
  ok(!b.plan && !b.day && !hasDay(b), 'another behaviour: the day and its plan are gone');
}
{ // the picker (Jev): its answer is taken; no answer in time, an unknown answer or none at all: the scores decide
  const b = stub({ cons: { potion: 0 } }), r = rng(9), asks = [];
  b.dayPicker = (bot, ask) => { asks.push(ask); return true; };
  turn(b, 0.1, PV(b), r);
  ok(asks.length === 1 && !b.plan && asks[0].scores[0].id === 'restock' && asks[0].facts.pots === 0, 'the picker is asked once, with the facts and the scores; the bot waits a moment');
  asks[0].done('rest'); turn(b, 0.1, PV(b), r);
  ok(b.plan?.day === 'rest' && b.day.picked === 1 && asks.length === 1, 'its answer is taken, even against the top score');
  const c = stub({ cons: { potion: 0 } }); c.dayPicker = (bot, ask) => { asks.push(ask); return true; };
  turn(c, 0.1, PV(c), r); const early = !c.plan; c.t += PICK_WAIT; turn(c, 0.1, PV(c), r);
  ok(early && c.plan?.day === 'restock' && c.day.picked === 0, `no answer in ${PICK_WAIT} s: the top score`);
  asks.at(-1).done('hunt');
  ok(c.plan?.day === 'restock', 'a late answer changes nothing');
  const e = stub({ cons: { potion: 0 } }); e.dayPicker = (bot, ask) => { ask.done('fly to the moon'); return true; };
  turn(e, 0.1, PV(e), r); e.t += PICK_WAIT; turn(e, 0.1, PV(e), r);
  ok(e.plan?.day === 'restock', 'an answer that is no goal is ignored');
  const g = stub({ cons: { potion: 0 } }); g.dayPicker = () => false;
  turn(g, 0.1, PV(g), r);
  ok(g.plan?.day === 'restock' && g.day.asked === 0, 'a picker that declines (capped, down): the scores decide at once');
}
{ // BOT_DAYS=0: `own` is the field, as before
  const was = process.env.BOT_DAYS; process.env.BOT_DAYS = '0';
  const b = stub(); turn(b, 5);
  ok(!daysEnabled() && !hasDay(b) && !b.plan && !b.day, 'BOT_DAYS=0: no day');
  if (was === undefined) delete process.env.BOT_DAYS; else process.env.BOT_DAYS = was;
}

// ---------- 4. the real brain on a fake socket ----------
class FakeWS {
  constructor() { this.readyState = 1; this.sent = []; this.h = {}; }
  addEventListener(t, f) { (this.h[t] ||= []).push(f); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.emit('close'); }
  emit(t, data) { for (const f of this.h[t] || []) f(data === undefined ? {} : { data: JSON.stringify(data) }); }
}
const ROSTER = [{ id: 3, name: 'Rook', cls: 'guardian', bot: true }, { id: 4, name: 'Vex', cls: 'ranger', bot: false }];
const row = (id, x, z, hp, cls, party) => [id, x, z, 0, hp, 100, 5, cls, party, 0, 0, 0];
const mobRow = (id, type, x, z, flags = 0) => [id, MOB_IDS.indexOf(type), x, z, 0, 60, 60, flags];
function makeBot(inv, behaviour = 'own') {
  const b = createBot({ url: 'ws://test', WebSocket: FakeWS, cls: 'guardian', name: 'Rook', behaviour, skill: 5, persona: 'neutral' });
  b.ws.emit('message', { type: 'welcome', id: 3, x: 1, z: 20, seq: 0 });
  b.ws.emit('message', { type: 'roster', players: ROSTER });
  b.ws.emit('message', { type: 'inv', life: {}, ...inv });
  return b;
}
const snap = (b, events = [], mobs = []) => b.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs, gate: [0, 0, 0], events, players: [row(3, b.x, b.z, 100, 1, 0), row(4, 30, 30, 100, 3, 9)] } });
const chats = b => b.ws.sent.filter(m => m.type === 'chat').map(m => m.text);
{
  const inv = { gold: 40, cons: { potion: 0 }, bag: [{ u: 5, name: 'Old Axe' }, { u: 6, name: 'Cap' }] };
  const b = makeBot(inv);
  let seen = 0;
  const shop = () => { // the server's side of the counter
    for (const m of b.ws.sent.slice(seen)) {
      const near = Math.hypot(b.x - MERCHANT.x, b.z - MERCHANT.z) < MERCHANT.r + 1.5;
      if (m.type === 'sell' && near && inv.bag.some(it => it.u === m.u)) { inv.bag = inv.bag.filter(it => it.u !== m.u); inv.gold += 10; b.ws.emit('message', { type: 'inv', life: {}, ...inv }); }
      if (m.type === 'buy' && near && inv.gold >= CONSUMABLES.potion.price) { inv.gold -= CONSUMABLES.potion.price; inv.cons = { potion: inv.cons.potion + 1 }; b.ws.emit('message', { type: 'inv', life: {}, ...inv }); }
    }
    seen = b.ws.sent.length;
  };
  for (let i = 0; i < 5; i++) snap(b);
  ok(b.plan?.day === 'restock' && b.mode === 'stay' && b.goal === 'Restocking at the merchant: out of potions', `a free bot out of potions: its own plan to the merchant, and its goal says why (${b.goal})`);
  let steps = 0; while (b.day?.goal === 'restock' && steps++ < 1500) { snap(b); shop(); }
  ok(b.day.log[0]?.g === 'restock' && inv.bag.length === 0 && inv.cons.potion === 4 && inv.gold === 0 && b.cons.potion === 4, `it walked there, sold its two things and bought potions with all it had (${steps} snapshots: ${inv.cons.potion} potions, ${inv.gold} gold)`);
  steps = 0; while (!b.plan && steps++ < 200) snap(b);
  ok(b.plan?.day === 'hunt' && /^Hunting .+: /.test(b.goal) && !chats(b).length, `then on with its day: a hunt, and not a word said about any of it (${b.goal})`);
  // an order from a player it may obey: the day waits; cancel: it goes on
  snap(b, [{ t: 'botcmd', by: 4, byName: 'Vex', cmd: 'stay', name: 'Rook', free: 1 }]);
  for (let i = 0; i < 100; i++) snap(b);
  ok(!b.plan && b.cmd?.k === 'stay' && /Holding position/.test(b.goal), 'a player\'s order: it holds, its own plan is dropped');
  snap(b, [{ t: 'botcmd', by: 4, byName: 'Vex', cmd: 'cancel', name: 'Rook', free: 1 }]);
  for (let i = 0; i < 100; i++) snap(b);
  const soon = !b.plan && b.goal === 'Deciding what to do next';
  for (let i = 0; i < (RESUME + 6) * 20; i++) snap(b);
  ok(soon && b.plan?.day, `/b cancel: back to its own day ${RESUME} s later`);
  // attacked between two goals: it fights back
  const c = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] });
  for (let i = 0; i < 3; i++) snap(c);
  c.plan = null; c.cmd = null; c.day.hold = c.t + 60; c.day.goal = '';
  for (let i = 0; i < 4; i++) snap(c, [], [mobRow(70, 'boar', c.x + 2, c.z + 1, 2)]);
  ok(c.tgtId === 70, 'between two goals a monster on it is fought');
  const f = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] }, 'field');
  for (let i = 0; i < 5; i++) snap(f);
  ok(!f.plan && !f.day && f.goal === 'Farming the field', 'a bot told to farm the field has no day');
}

// ---------- 5. live ----------
if (process.env.NO_LIVE) { console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed (live part skipped)`); process.exit(failed ? 1 : 0); }
const PORT = Number(process.env.PORT) || 3746;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PORT: String(PORT), DATABASE_URL: '', NAMED_ENABLED: '0', AI_PROVIDER: '', START_LEVEL: '6', TEST_HOOKS: '1' };
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
const stop = code => { try { srv.kill(); } catch {} process.exit(code); };
try {
  for (let i = 0; i < 150; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(200); } }
  const url = `ws://localhost:${PORT}/ws`;
  const h = { id: 0, events: [], ws: new WebSocket(url), replies: [], roster: [] };
  h.ws.on('open', () => h.ws.send(J({ type: 'join', name: 'Nat', cls: 'swordsman' })));
  h.ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.type === 'welcome') h.id = m.id;
    if (m.type === 'roster') h.roster = m.players;
    if (m.type === 'pbot') h.replies.push(m);
    if (m.type === 'snap') for (const e of m.w.events || []) h.events.push(e);
  });
  const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await sleep(100); } return false; };
  await sleep(800);
  // three free bots of our own (their brains run here, so the test can look inside)
  const bots = ['Rook', 'Wren', 'Tamsin'].map((name, i) => startTeam({ url, WebSocket, roles: [['swordsman', 'ranger', 'guardian'][i]], names: [name], inviteHumans: false, behaviour: 'own', skill: 4 }).team[0]);
  ok(await until(() => bots.every(b => b.plan?.day && b.day?.goal), 15000), `live: three free bots each chose something to do (${bots.map(b => b.goal).join(' | ')})`);
  const [rook, wren, tam] = bots;
  // Rook believes it is out of potions and has gold: off to the merchant
  rook.send({ type: 'test', gold: 60 });
  await until(() => rook.gold >= 60, 3000);
  const pots = rook.cons?.potion || 0, g0 = rook.gold;
  let real = rook.cons, fake = true; // (loot keeps telling it what it really carries: it goes on believing it has none until it sets out)
  Object.defineProperty(rook, 'cons', { configurable: true, get: () => (fake ? { ...real, potion: 0 } : real), set: v => { real = v; } });
  ok(await until(() => { if (rook.day.goal === 'restock') fake = false; return !fake; }, 40000), `live: out of potions, it leaves its hunt for the merchant once the fight is over (${rook.goal})`);
  ok(await until(() => rook.day.log[0]?.g === 'restock', 60000) && (rook.cons?.potion || 0) > pots && rook.gold < g0 && Math.hypot(rook.x - MERCHANT.x, rook.z - MERCHANT.z) < 12, `live: it bought potions with its own gold (${pots} -> ${rook.cons?.potion} potions, ${g0} -> ${rook.gold} gold)`);
  // Tamsin is tired: a rest in town, sitting
  tam.day.restT -= 3000; tam.plan = null; tam.cmd = null;
  ok(await until(() => tam.day.goal === 'rest', 45000) && await until(() => h.events.some(e => e.t === 'pose' && e.id === tam.id && e.k === 'sit'), 60000), `live: a tired bot walks to town and sits down (${tam.goal})`);
  // Wren wants a change: a look around
  wren.day.sameT -= 3000; wren.day.since -= 3000; wren.day.restT = wren.t; wren.plan = null; wren.cmd = null;
  ok(await until(() => wren.day.goal === 'wander', 45000), `live: a bored bot goes to look around (${wren.goal})`);
  // nobody said a word about plans, and nobody is left standing with nothing to do
  await sleep(4000);
  const said = h.events.filter(e => e.t === 'chat' && bots.some(b => b.id === e.id)).map(e => e.text);
  const kinds = b => new Set([b.day.goal, ...b.day.log.map(e => e.g)].filter(Boolean));
  ok(!said.some(t => /plan|next:/i.test(t)) && kinds(rook).size >= 2 && bots.every(b => b.day.goal || b.t < b.day.hold + 5), `live: no plan talk in chat, and nobody is left with nothing to do (${J(said.slice(0, 4))}; Rook: ${dayLog(rook)})`);
  // a bot a player adds out of their party lives its own day, and its card says what it is doing
  h.ws.send(J({ type: 'pbot', op: 'add', cls: 'ranger', name: 'Zed', party: false }));
  const zed = () => h.replies.at(-1)?.list?.bots?.find(x => x.name === 'Zed');
  ok(await until(() => { h.ws.send(J({ type: 'pbot', op: 'list' })); return /^(Hunting|Resting|Looking around|Hanging out|Restocking) .*: /.test(zed()?.doing || ''); }, 20000) && zed().mode === 'own', `live: a bot added out of the party lives its own day; its card says what and why (${zed()?.doing})`);
  h.ws.send(J({ type: 'pbot', op: 'edit', bid: zed().bid, mode: 'field' }));
  ok(await until(() => { h.ws.send(J({ type: 'pbot', op: 'list' })); return zed()?.mode === 'field' && zed().doing === 'Farming the field'; }, 8000), 'live: its creator can still tell it to farm the field instead');
  for (const b of bots) b.stop();
  h.ws.close();
} catch (err) { console.error(err); console.error(srvLog.slice(-2000)); failed++; }
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
stop(failed ? 1 : 0);
