// Bot days (docs/briefs/bot-days.md, shared/bots/day.js): a free bot with the behaviour `own` picks its own next thing.
// Unit checks: the scores (repeatable from a seed, in range, each need leads to its goal, no flip-flopping), the monster
// it hunts, every goal's plan, the day on a stub bot (a goal becomes a quiet plan, an order pauses it and it resumes,
// a party with a player has no day, the picker's answer and its time limit, BOT_DAYS=0), and the real brain on a fake
// socket (out of potions: walks to the merchant, sells, buys, then goes on with its day; nothing is said).
// Company: a player in trouble is helped, two free bots team up and part again, a player is asked along and invited
// only after a yes (unit, the real brain, and live for teaming up).
// Live (skip with NO_LIVE=1): a server on PORT (default 3746) with a player in town and three free bots.
// Usage: node test/botdays.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createBot } from '../shared/bots/brain.js';
import { GOALS, GOAL_IDS, RESUME, PICK_WAIT, ASK_AGAIN, facts, needs, scoreGoals, pickKind, planFor, potionsWanted, dayTurn, dayText, dayLog, dayChat, dayInvite, inTrouble, peersNear, hasDay, daysEnabled } from '../shared/bots/day.js';
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
    const x = fl === 2 ? 600 : 0, lvl = fl === 2 ? 13 : 6;
    const b = stub({ x, life: { floor2: 1 }, me: { lvl }, players: [{ id: 2, x, z: 60 }, { id: 7, x: x + 20, z: 60, lvl }], dayPeers: () => [7] }), made = planFor(id, b, facts(b), r);
    const c = cleanPlan(made?.steps), last = c?.steps.at(-1);
    if (!made?.text || !c || c.errors.length || c.steps.length !== made.steps.length || !(last.k === 'farm' || last.secs > 0)) bad ||= `${id} F${fl}: ${J(made)} ${J(c?.errors)}`;
  }
  ok(!bad, `every goal makes a plan the cleaner takes whole, ending in a step with an end (${bad || `${GOAL_IDS.join(', ')} on Floors 1 and 2`})`);
  const rs = planFor('restock', stub({ cons: { potion: 1 } }, { caution: 1 }), facts(stub({ cons: { potion: 1 } })), rng(1));
  ok(J(rs.steps.slice(0, 2)) === J([{ k: 'sell' }, { k: 'buy', n: 5 }]) && potionsWanted(stub({}, { caution: 0 })) === 3 && potionsWanted(stub({}, { caution: 1 })) === 6, 'restock: sell, then buy up to its own number of potions (3 for the bold, 6 for the careful)');
  ok(GOALS.hunt && MODES.own?.behaviour === 'own' && BEHAVIOURS.own && daysEnabled(), 'the behaviour `own` is on the players\' and the admin\'s lists');
}

// ---------- 3. the day on a stub bot ----------
const api = {
  say: (b, key, vars, o) => b.said.push(o?.text || key),
  command: (b, c) => { if (c.k === 'farm' || c.k === 'boss') b.cmd = { k: c.k, group: c.group }; if (c.k === 'come') b.cmd = { k: 'come', by: c.by }; if (c.k === 'attack' && b.mobs.some(m => m.id === c.tgt)) b.cmd = { k: 'attack', tgt: c.tgt, prev: b.cmd }; },
};
const PV = (b, humans = [], mates = humans) => ({ all: [{ id: b.id }, ...mates], mates, humans, botLeader: { id: b.id } });
const GV = (b, mate, lead = b.id) => ({ all: [{ id: b.id }, mate], mates: [mate], humans: [], botLeader: lead === b.id ? { id: b.id } : mate }); // a party of bots
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
  b.party = 7; turn(b, RESUME + 5, GV(b, { id: 3, name: 'Wren' }, 3), r);
  ok(!b.plan && dayText(b) === 'Out with Wren: better together', `nor while it follows another bot's lead (${dayText(b)})`);
  turn(b, RESUME + 5, GV(b, { id: 3, name: 'Wren' }), r);
  ok(b.plan?.day, 'leading a party of bots, it chooses for them');
  // a hunt that finds none of its kind: another kind next time
  b.party = 0; b.plan = null; b.cmd = null; b.day.goal = 'hunt'; b.day.kind = 'wolf'; b.dayStop = 'there are no Dire Wolves on this floor';
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

// ---------- 3b. company: help, teaming up, asking along ----------
const VEX = { id: 4, x: 10, z: 70, hp: 30, maxHp: 100, lvl: 6, party: 0 }, WREN = { id: 7, x: 30, z: 60, hp: 100, maxHp: 100, lvl: 6, party: 0 };
const NAMES = () => new Map([[4, { name: 'Vex', bot: false }], [7, { name: 'Wren', bot: true }]]);
const mob = (id, x, z, type = 'wolf', more = {}) => ({ id, x, z, engaged: true, def: MOBS[type], ...more });
const lucky = () => 0.01, unlucky = () => 0.99;
{ // help: a player in trouble within 40 m
  const kind = { sociability: 1, caution: 0, chattiness: 1 };
  const b = stub({ names: NAMES(), players: [{ id: 2, x: 0, z: 60 }, { ...VEX, hp: 100 }] }, kind);
  turn(b, 0.5, PV(b), unlucky); // (its day starts: a hunt)
  const hunting = b.day.goal; b.said.length = 0;
  b.players[1].hp = 30; b.mobs = [mob(50, 11, 70)];
  turn(b, 2, PV(b), lucky);
  ok(hunting === 'hunt' && b.day.goal === 'help' && b.cmd?.k === 'attack' && b.cmd.tgt === 50 && b.cmd.day && !b.plan && dayText(b) === 'Helping Vex: they were in trouble' && /Vex/.test(b.said[0] || ''), `a player under half health with a wolf on them: it drops its hunt and goes for the wolf ("${b.said[0]}", ${dayText(b)})`);
  b.mobs = [mob(51, 9, 70)]; b.cmd = null; turn(b, 0.5, PV(b), lucky);
  ok(b.day.goal === 'help' && b.cmd?.tgt === 51, 'that one down and another on them: the next one');
  b.mobs = []; b.cmd = null; turn(b, 0.5, PV(b), lucky);
  ok(!b.day.goal && b.day.log[0].g === 'help' && b.day.log[1].g === 'hunt' && b.day.log[1].how === 'cut short' && b.said.length === 2 && b.day.helped === 1, `all clear: a word, and the rescue is in its log ("${b.said[1]}")`);
  turn(b, 8, PV(b), rng(4));
  ok(b.plan?.day, `then on with its day (${dayText(b)})`);
  // who is not helped
  const calm = (o, t, r = lucky) => { const c = stub({ names: NAMES(), players: [{ id: 2, x: 0, z: 60 }, { ...VEX }], mobs: [mob(50, 11, 70)], ...o }, { ...kind, ...t }); turn(c, 3, PV(c), r); return c.day.log.some(e => e.g === 'help') || c.day.goal === 'help' ? 'help' : c.day.goal; };
  ok(calm({}, { sociability: 0, caution: 1 }, () => 0.5) !== 'help' && calm({}, {}, () => 0.5) === 'help', 'a cautious loner mostly walks on; a sociable, bold bot mostly helps');
  ok(calm({ hp: 40 }) !== 'help' && calm({ players: [{ id: 2, x: 0, z: 60 }, { ...VEX, hp: 90 }] }) !== 'help' && calm({ players: [{ id: 2, x: 0, z: 60 }, { ...VEX, x: 60 }], mobs: [mob(50, 61, 70)] }) !== 'help', 'not when it is hurt itself, not a healthy player with one wolf, not 50 m away');
  ok(calm({ names: new Map([[4, { name: 'Vex', bot: true }]]) }) !== 'help' && calm({ mobs: [mob(50, 11, 70, 'warden')] }) !== 'help' && calm({ mobs: [mob(50, 11, 70, 'wolf', { engaged: false })] }) !== 'help', 'not a bot, not a boss, not a monster that is not fighting');
  const many = stub({ names: NAMES(), players: [{ id: 2, x: 0, z: 60 }, { ...VEX, hp: 95 }], mobs: [mob(50, 11, 70), mob(51, 9, 70), mob(52, 10, 72)] }, kind);
  ok(inTrouble(many)?.n === 3 && !inTrouble(many).low, 'three on a healthy player is trouble too');
  const twice = stub({ names: NAMES(), players: [{ id: 2, x: 0, z: 60 }, { ...VEX }], mobs: [mob(50, 11, 70)] });
  turn(twice, 3, PV(twice), unlucky); turn(twice, 20, PV(twice), lucky);
  ok(twice.day.goal !== 'help' && twice.day.helpSeen.get(4) > twice.t, 'it makes up its mind once per scrape, not every second');
}
{ // teaming up with another free bot
  const soc = { sociability: 1 };
  const b = stub({ names: NAMES(), players: [{ id: 2, x: 0, z: 60, lvl: 6 }, { ...WREN }] }, soc);
  ok(!peersNear(b).length && scoreGoals(b, facts(b), rng(1)).find(g => g.id === 'group').score === 0, 'nobody it knows to have a day: no teaming up');
  b.dayPeers = () => [7];
  b.dayPicker = (bot, ask) => { ask.done('group'); return true; };
  turn(b, 1, PV(b), rng(2));
  ok(peersNear(b)[0]?.id === 7 && b.plan?.day === 'group' && b.plan.by === 7 && b.cmd?.k === 'come' && b.cmd.by === 7 && dayText(b) === 'Teaming up with Wren: hunting is better together', `another free bot 30 m off: it walks up to it (${dayText(b)})`);
  ok(!b.sent.some(m => m.type === 'invite'), 'no invite before it is there');
  b.x = 27; turn(b, 1, PV(b), rng(2));
  ok(b.sent.filter(m => m.type === 'invite' && m.id === 7).length === 1 && /Wren/.test(b.said.at(-1)), `there: a word and the invite ("${b.said.at(-1)}")`);
  turn(b, 2, PV(b), rng(2));
  ok(b.sent.filter(m => m.type === 'invite').length === 1, '...once');
  // it said yes: a party of two, ours to lead
  b.party = 9; b.players[1].party = 9; b.dayPicker = null;
  const mate = { id: 7, name: 'Wren' };
  turn(b, 12, GV(b, mate), rng(2));
  ok(b.plan?.day === 'hunt' && / with Wren: better together$/.test(dayText(b)) && b.day.log[0].g === 'group' && b.day.log[0].how === 'done' && b.day.groupUntil > b.t + 300, `together: the leader hunts with it (${dayText(b)})`);
  const solo = stub(), duo = stub({ party: 9, players: [{ id: 2, x: 0, z: 60, party: 9 }, { ...WREN, party: 9 }], names: NAMES() });
  ok(planFor('hunt', duo, facts(duo), rng(5)).steps.at(-1).n > planFor('hunt', solo, facts(solo), rng(5)).steps.at(-1).n, 'a longer hunt for two');
  // had enough: it says so and leaves; no new group for a while
  b.day.groupUntil = b.t - 1; b.tgtId = 5; turn(b, 1, GV(b, mate), rng(2));
  const stays = !b.sent.some(m => m.type === 'leave');
  b.tgtId = null; turn(b, 0.5, GV(b, mate), rng(2));
  ok(stays && b.sent.some(m => m.type === 'leave') && !b.plan && /off|around|company/i.test(b.said.at(-1)) && b.day.groupT === b.t, `time is up: never mid-fight, then a goodbye and it leaves ("${b.said.at(-1)}")`);
  b.party = 0; b.players[1].party = 0; turn(b, 10, PV(b), rng(2));
  ok(b.plan?.day && b.plan.day !== 'group' && scoreGoals(b, facts(b), rng(1)).find(g => g.id === 'group').score === 0, 'alone again: on with its day, and no teaming up for five minutes');
  // nobody came
  const c = stub({ names: NAMES(), players: [{ id: 2, x: 0, z: 60, lvl: 6 }, { ...WREN, x: 4 }], dayPeers: () => [7] }, soc);
  c.dayPicker = (bot, ask) => { ask.done('group'); return true; };
  turn(c, 1, PV(c), rng(2)); c.dayPicker = null; turn(c, 14, PV(c), rng(2));
  ok(c.day.log.some(e => e.g === 'group' && e.how === 'no luck') && c.plan?.day && c.plan.day !== 'group', 'no answer: it shrugs and goes on alone');
  // asked by another bot
  const asked = (o = {}, r = lucky) => { const x = stub({ names: NAMES(), dayPeers: () => [7], ...o }); turn(x, 0.5, PV(x), rng(3)); Object.assign(x, o.then || {}); return dayInvite(x, { from: 7 }, r); };
  ok(asked() && !asked({}, unlucky) && !asked({ dayPeers: () => [8] }), 'asked by a bot with a day: it joins when it feels like it; never a bot without one');
  ok(!asked({ then: { plan: { steps: [], by: 4 } } }) && !asked({ then: { party: 5 } }) && !asked({ then: { cmd: { k: 'stay', by: 4 } } }), 'not on a player\'s plan or order, not from inside a party');
  // the one that follows
  const f = stub({ names: NAMES(), party: 9, players: [{ id: 2, x: 0, z: 60, party: 9 }, { ...WREN, party: 9 }] });
  turn(f, 0.5, PV(f), rng(3)); turn(f, 5, GV(f, mate, 7), rng(3));
  ok(!f.plan && f.day.goal === 'with' && dayText(f) === 'Out with Wren: better together' && f.day.log[0].how === 'joined', `in another bot's party it drops its own plan and is out with it (${dayText(f)})`);
  f.party = 0; turn(f, 8, PV(f), rng(3));
  ok(f.plan?.day && f.day.log[0].g === 'with' && f.day.groupT > 0, 'the party is gone: its own day again');
}
{ // asking a player along
  const keen = { sociability: 1, chattiness: 1, aggression: 0 };
  const near = () => [{ id: 2, x: 0, z: 60, lvl: 4 }, { ...VEX, hp: 100, x: 5, z: 62 }];
  const b = stub({ names: NAMES(), players: near(), me: { lvl: 4 } }, keen);
  turn(b, 0.5, PV(b), lucky);
  ok(b.plan?.day === 'hunt' && b.plan.steps[0].k === 'wait' && b.day.ask && !b.said.length, 'a sociable bot with a player near: its hunt waits a moment');
  turn(b, 1, PV(b), lucky);
  ok(b.said.length === 1 && /^Anyone for .+\?$/.test(b.said[0]) && b.day.askedAt.get(4) > 0, `...and it asks ("${b.said[0]}")`);
  ok(!dayChat(b, { id: 7, text: 'yes', ch: 's' }) && !dayChat(b, { id: 4, text: 'yes but first tell me everything about how the smith works', ch: 's' }) && !dayChat(b, { id: 4, text: 'nah', ch: 's' }) && !b.sent.length, 'a bot\'s yes, a long sentence and a no are not a yes');
  ok(dayChat(b, { id: 4, text: 'Sure!', ch: 's' }) && J(b.sent) === J([{ type: 'invite', id: 4 }]) && !b.day.ask, 'a player\'s "sure": the invite goes out, once');
  ok(!dayChat(b, { id: 4, text: 'yes', ch: 's' }), 'no second invite');
  // not again for twenty minutes
  b.plan.st = { ...b.plan.st }; b.plan = null; b.cmd = null; b.day.hold = 0; turn(b, 12, PV(b), lucky);
  ok(b.plan?.day && b.said.length === 1 && !b.day.ask, 'the next hunt, minutes later: the same player is not asked again');
  b.t += ASK_AGAIN; b.day.restT = b.day.sameT = b.day.seenT = b.t; b.plan = null; b.cmd = null; b.day.goal = ''; b.day.hold = 0; turn(b, 3, PV(b), lucky);
  ok(b.said.length === 2, `twenty minutes on, it may ask again ("${b.said[1]}")`);
  // too late, and the shy
  const late = stub({ names: NAMES(), players: near(), me: { lvl: 4 } }, keen);
  turn(late, 2, PV(late), lucky); late.t += 30;
  ok(!dayChat(late, { id: 4, text: 'yes', ch: 's' }), 'a yes half a minute later is too late');
  const shy = stub({ names: NAMES(), players: near(), me: { lvl: 4 } }, { sociability: 0.2, chattiness: 0 });
  turn(shy, 2, PV(shy), lucky);
  ok(shy.plan?.day === 'hunt' && !shy.said.length, 'a shy bot asks nobody');
  // at the boss's level a bold one asks about the boss, and says so once the player is in its party
  const bold = stub({ names: NAMES(), players: [{ id: 2, x: 0, z: 60, lvl: 6 }, { ...VEX, hp: 100, x: 5, z: 62 }] }, { ...keen, aggression: 1 });
  turn(bold, 2, PV(bold), lucky);
  ok(/Warden/.test(bold.said[0] || ''), `at the boss's level: "${bold.said[0]}"`);
  dayChat(bold, { id: 4, text: 'ok', ch: 's' }); bold.party = 3;
  turn(bold, 1, PV(bold, [{ id: 4 }]), lucky);
  ok(!bold.plan && /Warden/.test(bold.said.at(-1)) && bold.said.length === 2 && !bold.day.goal, `the player joined: it is theirs to lead ("${bold.said.at(-1)}")`);
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
const snap = (b, events = [], mobs = []) => b.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs, gate: [0, 0, 0], events, players: [row(3, b.x, b.z, 100, 1, 0), row(4, 150, 30, 100, 3, 9)] } }); // (Vex: far off)
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
  // company, through the real brain. A player in trouble out in the field: it runs to the wolf on them
  const world = (bot, players, mobs = [], events = []) => bot.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs, gate: [0, 0, 0], events, players: [row(3, bot.x, bot.z, 100, 1, bot.party || 0), ...players] } });
  const realRandom = Math.random;
  const h = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] });
  h.ws.emit('message', { type: 'welcome', id: 3, x: 0, z: 90, seq: 0 });
  for (let i = 0; i < 3; i++) world(h, [row(4, 150, 30, 100, 3, 9)]);
  const wolf = [mobRow(80, 'wolf', 13, 100, 2)], hurt = [row(4, 12, 99, 30, 3, 9)];
  Math.random = () => 0.01;
  for (let i = 0; i < 40; i++) world(h, hurt, wolf);
  Math.random = realRandom;
  ok(h.day.goal === 'help' && h.cmd?.k === 'attack' && h.cmd.tgt === 80 && h.tgtId === 80 && h.mode === 'attack' && chats(h).some(t => /Vex/.test(t)) && /Helping Vex/.test(dayText(h)), `the real brain: a player in trouble 15 m off, and it goes for the wolf on them (${h.goal}; "${chats(h).at(-1)}")`);
  for (let i = 0; i < 60; i++) world(h, [row(4, 12, 99, 80, 3, 9)]);
  ok(h.day.log[0]?.g === 'help' && !h.cmd?.day, 'the wolf is gone: the rescue is over');
  // another bot's invite: a bot with a day decides for itself; one without a day says yes as before
  const invite = (bot, peers, luck) => { bot.dayPeers = () => peers; bot.ws.emit('message', { type: 'roster', players: [...ROSTER, { id: 5, name: 'Wren', cls: 'ranger', bot: true }] }); const n0 = bot.ws.sent.length; Math.random = () => luck; world(bot, [row(5, bot.x + 3, bot.z, 100, 3, 0)], [], [{ t: 'invite', to: 3, from: 5, name: 'Wren' }]); Math.random = realRandom; return bot.ws.sent.slice(n0).filter(m => m.type === 'accept' || m.type === 'decline').map(m => m.type).join(); };
  const d1 = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] }); for (let i = 0; i < 3; i++) snap(d1);
  const d2 = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] }); for (let i = 0; i < 3; i++) snap(d2);
  const d3 = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] }); for (let i = 0; i < 3; i++) snap(d3);
  const f2 = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] }, 'field'); for (let i = 0; i < 3; i++) snap(f2);
  ok(invite(d1, [5], 0.01) === 'accept' && invite(d2, [5], 0.99) === 'decline' && invite(d3, [], 0.01) === 'decline' && invite(f2, [], 0.99) === 'accept', 'another bot\'s invite: a bot with a day joins when it feels like it and only a bot with a day; a bot without a day says yes as before');
  // "Anyone for boars?" and a player's yes, through the chat it hears
  const a = makeBot({ gold: 0, cons: { potion: 3 }, bag: [] });
  a.ws.emit('message', { type: 'welcome', id: 3, x: 0, z: 90, seq: 0 });
  const by = [row(4, 6, 92, 100, 3, 0)];
  Math.random = () => 0.01;
  for (let i = 0; i < 40; i++) world(a, by);
  Math.random = realRandom;
  const asked = chats(a).find(t => /^Anyone (up )?for /.test(t));
  world(a, by, [], [{ t: 'chat', id: 4, from: 'Vex', text: 'sure', ch: 's', x: 6, z: 92 }]);
  ok(asked && a.ws.sent.some(m => m.type === 'invite' && m.id === 4) && chats(a).some(t => /Invite's out/.test(t)), `a player near as its hunt starts: "${asked}", their "sure", and the invite goes out ("${chats(a).at(-1)}")`);
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
  const known = new Set(bots.map(b => b.id)); for (const b of bots) b.peers = known; // (the server does not flag a test's bots: they know each other, as a team's do)
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
  // two free bots team up: one walks up to the other and invites it; one leads the hunt, the other is out with it; then they part
  const [ada, bo] = ['Ada', 'Bo'].map((name, i) => startTeam({ url, WebSocket, roles: [['swordsman', 'cleric'][i]], names: [name], inviteHumans: false, behaviour: 'own', skill: 4 }).team[0]);
  await until(() => ada.id && bo.id && ada.day?.goal && bo.day?.goal, 15000);
  known.add(ada.id); known.add(bo.id); ada.peers = bo.peers = known;
  ada.dayPeers = () => [bo.id]; bo.dayPeers = () => [ada.id];
  bo.persona = { ...bo.persona, t: { ...bo.persona.t, sociability: 1 } }; // (a yes nearly every time)
  ada.dayPicker = (bot, ask) => { ask.done('group'); return true; };
  const together = () => !!ada.party && ada.party === bo.party;
  ok(await until(() => { if (!together() && ada.day.goal && ada.day.goal !== 'group' && ada.plan) { ada.day.groupT = null; bo.day.groupT = null; ada.plan = null; ada.cmd = null; } return together(); }, 120000), `live: a free bot walks up to another and they team up (Ada: ${dayLog(ada, 2)})`);
  ada.dayPicker = null;
  const lead = () => [ada, bo].find(b => b.plan?.day), tail = () => [ada, bo].find(b => b.day.goal === 'with');
  ok(await until(() => lead() && tail() && lead() !== tail() && / with /.test(dayText(lead())), 40000), `live: one leads the hunt, the other is out with it (${ada.name}: ${dayText(ada)} | ${bo.name}: ${dayText(bo)})`);
  const t = tail(); if (t) t.day.groupUntil = 0;
  ok(await until(() => !ada.party && !bo.party, 60000) && await until(() => ada.plan?.day && bo.plan?.day && ada.day.goal !== 'with' && bo.day.goal !== 'with', 30000), `live: when one has had enough it leaves, and each goes on with its own day (${dayText(ada)} | ${dayText(bo)})`);
  for (const b of [...bots, ada, bo]) b.stop();
  h.ws.close();
} catch (err) { console.error(err); console.error(srvLog.slice(-2000)); failed++; }
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
stop(failed ? 1 : 0);
