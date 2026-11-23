// Bot plans (docs/briefs/bot-plans.md, shared/bots/plan.js): a list of steps a bot carries out one after another.
// Unit checks: chat parsing (a plain order word stays an order), cleaning (unknown steps, places and monsters are
// dropped; a say step is never a slash command), the runner on a stub bot (every step starts and ends, limits, repeat,
// pause in a raid), the real brain on a fake socket (a plan from a `botcmd` event, a new order ends it, /b cancel, the
// player leaving, a guard step's targets, kills counted for a farm step) and the AI mind (mock provider: a `plan` in
// the intent becomes the bot's plan, only from a party member who may order it).
// Live (skip with NO_LIVE=1): a server on PORT (default 3745), a human in town with a party of two bots:
// "/b wait 2 then go smith then bow then come" runs to its end, then "/b farm 2 boars then come".
// Usage: node test/botplans.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createBot } from '../shared/bots/brain.js';
import { registerBotHook } from '../shared/bots/registry.js';
import { parseBotChat, botHelp, BOT_COMMANDS } from '../shared/bots/social.js';
import { STEPS, STEP_IDS, PLACES, PLAN_STEPS_MAX, placeOf, mobKind, parsePlan, cleanPlan, planText, planProgress, planHelp, setPlan, endPlan, planTurn, planEvent } from '../shared/bots/plan.js';
import { sanitizeIntent, INTENT_SCHEMA } from '../server/ai/intent.js';
import { Minds } from '../server/ai/mind.js';
import { readConfig } from '../server/ai/config.js';
import { mockProvider } from '../server/ai/providers/mock.js';
import { SYSTEM, summarize } from '../server/ai/prompt.js';
import { startTeam } from '../shared/teambots.js';
import { SMITH } from '../shared/crafting.js';
import { GARDEN } from '../shared/life.js';
import { MOB_IDS } from '../shared/data.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const P = parseBotChat, J = JSON.stringify;

// ---------- 1. chat ----------
ok(P('/b stay')?.cmd === 'stay' && P('/b follow me')?.cmd === 'follow' && P('/b attack my target')?.cmd === 'attack' && P('/b farm')?.cmd === 'farm' && P('/b Brann 2 hold')?.name === 'Brann 2' && P('/b Lyra: heal me')?.cmd === 'heal', 'a plain order word (with filler words) is still the old order');
ok(/isn't a bot order/.test(P('/b dance')?.error || '') && P('/b cancel')?.cmd === 'cancel' && BOT_COMMANDS.cancel.wheel === false, '/b dance is still an error; /b cancel is an order (not on the wheel)');
const p1 = P('/b farm 10 boars then go smith then come');
ok(J(p1?.plan?.steps) === J([{ k: 'farm', mob: 'boar', n: 10 }, { k: 'goto', place: 'smith' }, { k: 'come' }]) && p1.name === '' && p1.plan.loops === 1, '/b farm 10 boars then go smith then come: three steps for every bot');
const p2 = P('/b Lyra kill 5 wolves; guard here 2m; sit 10; repeat 2');
ok(p2?.name === 'Lyra' && J(p2.plan.steps) === J([{ k: 'farm', mob: 'wolf', n: 5 }, { k: 'guard', place: 'here', secs: 120 }, { k: 'emote', pose: 'sit', secs: 10 }]) && p2.plan.loops === 2, 'a name, ";" between steps, minutes, a pose and "repeat 2"');
ok(P('/b farm boars')?.plan?.steps[0].mob === 'boar' && P('/b all: farm boars').name === '' && P('/b wait 30 then come')?.plan?.steps[0].secs === 30 && P('/b guard')?.plan?.steps[0].place === 'spot', 'one step with an argument is a plan; "all:" is every bot; a bare guard holds this spot');
ok(J(P('/b say hi: there then hop')?.plan?.steps) === J([{ k: 'say', text: 'hi: there' }, { k: 'emote', pose: 'hop', secs: 0 }]), 'a line to say may hold a colon');
ok(/monster/.test(P('/b farm blorps')?.error || '') && /place/.test(P('/b go to the moon')?.error || '') && /Go where/.test(P('/b go')?.error || '') && /1 to 4/.test(P('/b skill 9')?.error || ''), 'an unknown monster, place or skill slot is an error for the player, not a guess');
ok(J(P('/b hunt dire wolves 3 > head to the raid gate > bow')?.plan?.steps.map(s => s.mob || s.place || s.pose)) === J(['wolf', 'gate', 'bow']) && P('/b skill 2 then use skill 3')?.plan?.steps[1].slot === 3, '">" between steps, names in full, "use skill 3"');
ok(botHelp().length === Object.keys(BOT_COMMANDS).length + 1 && planHelp().length === 3 && planHelp().join(' ').includes('smith'), 'help: the orders as before, plus three plan lines');

// ---------- 2. cleaning ----------
ok(placeOf('the smith') === 'smith' && placeOf('to the raid gate') === 'gate' && placeOf('Town of Beginnings') === 'well' && placeOf('me') === 'here' && placeOf('life hall') === 'lifehall' && placeOf('floor 2') === 'camp2' && placeOf('nowhere') === '', 'places by loose name');
ok(mobKind('boars') === 'boar' && mobKind('Dire Wolves') === 'wolf' && mobKind('alpha wolf') === 'alpha' && mobKind('harpies') === 'harpy' && mobKind('warden') === '' && mobKind('vines') === '' && mobKind('training dummy') === '', 'monsters by loose name; never a boss, a prop or an Academy dummy');
const dirty = cleanPlan([{ do: 'farm', what: 'boars', n: 999 }, { do: 'craft', what: 'sword', n: 1 }, { do: 'goto', what: 'the smith', n: 0 }, { do: 'say', what: '/b leave', n: 0 }, { do: 'say', what: 'see http://x.com', n: 0 }, { do: 'emote', what: 'backflip', n: 0 }, { do: 'wait', what: '', n: 99999 }, { do: 'skill', what: '', n: 7 }, { do: 'farm', what: 'the horned warden', n: 1 }]);
ok(J(dirty.steps) === J([{ k: 'farm', mob: 'boar', n: 50 }, { k: 'goto', place: 'smith' }, { k: 'say', text: 'b leave' }, { k: 'wait', secs: 600 }]) && dirty.errors.length === 5, 'cleanPlan: numbers clamped; craft, a link, an unknown pose, slot 7 and a boss are dropped; a say step is never a slash command');
ok(cleanPlan(Array.from({ length: 30 }, () => ({ k: 'wait', n: 1 }))).steps.length === PLAN_STEPS_MAX && cleanPlan({ steps: [{ k: 'come' }], loops: 99 }).loops === 5 && cleanPlan([]) === null && cleanPlan('farm') === null && cleanPlan([{ k: 'x' }]).steps.length === 0, `at most ${PLAN_STEPS_MAX} steps and 5 repeats; nothing usable is no plan`);
ok(planText({ steps: p1.plan.steps, loops: 1 }) === 'Plan: 1) 10 Forest Boars 2) go to the smith 3) come back to you' && planText({ steps: [{ k: 'wait', secs: 120 }], loops: 3 }) === 'Plan: wait 2 min (x3)', 'the plan in words');
ok(STEP_IDS.every(k => STEPS[k].label) && Object.values(PLACES).every(p => p.words.length && p.name), 'every step and place has a name');

// ---------- 3. the runner on a stub bot ----------
function stub(o = {}) {
  const b = { id: 2, name: 'Lyra', t: 100, x: 0, z: 5, face: 0, dead: false, players: [{ id: 1, x: 3, z: 5 }, { id: 2, x: 0, z: 5 }], mobs: [], allMobs: [], locks: new Map(), life: {}, cds: [0, 0, 0, 0, 0], me: { lvl: 9 }, cls: 'swordsman', sent: [], said: [], cmd: null, ...o };
  b.send = m => b.sent.push(m);
  return b;
}
const api = {
  say: (b, key, vars, o) => b.said.push(o?.text || key),
  command: (b, c) => { // (what brain.js command() leaves in b.cmd for these orders)
    if (c.k === 'follow' || c.k === 'come') b.cmd = { k: c.k, by: c.by };
    if (c.k === 'farm' || c.k === 'boss') b.cmd = { k: c.k, group: c.group };
    if (c.k === 'attack' && c.tgt && b.mobs.some(m => m.id === c.tgt)) b.cmd = { k: 'attack', tgt: c.tgt };
  },
};
const PV = b => ({ all: b.players });
const turn = (b, dt = 0.5) => { b.t += dt; planTurn(b, PV(b), api); };
const walkCmd = b => { if (b.cmd?.k === 'stay') { b.x = b.cmd.x; b.z = b.cmd.z + (b.cmd.stop || 0); } }; // (the brain walks to its order's spot)
{
  const b = stub();
  const c = setPlan(b, [{ k: 'wait', n: 3 }, { k: 'goto', what: 'smith' }, { k: 'emote', what: 'bow', n: 2 }, { k: 'say', what: 'made it' }, { k: 'come' }], { by: 1, byName: 'Natan', at: [3, 5] }, api);
  ok(c?.steps.length === 5 && b.said[0].startsWith('Plan: 1) wait 3 s 2) go to the smith') && b.plan.i === 0, 'setPlan: the bot takes the plan and says it');
  turn(b, 0.1);
  ok(b.cmd?.k === 'stay' && b.cmd.plan && b.cmd.x === 0 && b.cmd.z === 5 && planProgress(b) === 'step 1/5: wait 3 s', 'wait: holds its own spot');
  turn(b, 2); ok(b.plan.i === 0, 'still waiting at 2 s');
  turn(b, 1.2);
  ok(b.plan.i === 1 && b.cmd.x === SMITH.x && b.cmd.z === SMITH.z && b.cmd.stop > SMITH.r && b.cmd.fl === 1 && b.said.includes('Next: go to the smith.'), 'then goto: an order to the smith (stopping outside it), and a "Next" line');
  turn(b, 5); ok(b.plan.i === 1, 'not there yet');
  walkCmd(b); turn(b);
  ok(b.plan.i === 2 && b.sent.some(m => m.type === 'chat' && m.text === '/bow') && b.plan.st.pose === 'bow', 'arrived: bows');
  turn(b, 1); ok(b.plan.i === 2, 'holding the bow');
  turn(b, 1.2);
  ok(b.sent.some(m => m.text === '/stand') && b.said.includes('made it') && b.plan.i === 3, 'stands up, then says its line');
  turn(b, 2);
  ok(b.plan?.i === 4 && b.cmd?.k === 'come', 'then comes back');
  b.x = 2; b.z = 5; turn(b);
  ok(!b.plan && !b.cmd && b.said.at(-1) === 'Plan done, Natan.', 'next to the player: plan done, order cleared');
}
{
  const b = stub();
  setPlan(b, [{ k: 'goto', what: 'gate' }], { by: 1, byName: 'Natan' }, api);
  turn(b); turn(b, 241);
  ok(!b.plan && /Plan stopped: I couldn't get to the raid gate/.test(b.said.at(-1)), 'goto: four minutes without arriving stops the plan');
  setPlan(b, [{ k: 'goto', what: 'camp2' }], { by: 1 }, api); turn(b);
  ok(!b.plan && /Floor 2 is sealed/.test(b.said.at(-1)), 'a place on a sealed floor stops the plan at once');
  b.life = { floor2: 1 }; setPlan(b, [{ k: 'goto', what: 'camp2' }], { by: 1 }, api); turn(b);
  ok(b.plan && b.cmd.fl === 2, 'unlocked: the order names Floor 2 (the brain travels by waypoint)');
  endPlan(b);
  ok(!b.plan && !b.cmd, 'endPlan drops the plan and its order');
}
{
  const b = stub({ mobs: [{ id: 50, type: 'boar', x: 4, z: 8 }], allMobs: [{ id: 50, type: 'boar', x: 4, z: 8 }] });
  setPlan(b, [{ k: 'farm', what: 'boar', n: 2 }, { k: 'attack' }, { k: 'follow' }], { by: 1, byName: 'Natan', group: [2, 3] }, api);
  turn(b);
  ok(b.cmd?.k === 'farm' && b.cmd.mob === 'boar' && J(b.cmd.group) === '[2,3]' && b.plan.all, 'farm: the farm order for the group, with the monster kind');
  const hit = (kind, by = 2) => Object.assign(new Map([[by, { first: 0, last: 0 }]]), { kind });
  const mate = (bb, id) => id === 3;
  planEvent(b, { t: 'die', id: 50 }, { hits: hit('wolf'), mateOf: mate }); planEvent(b, { t: 'die', id: 51 }, { hits: hit('boar', 9), mateOf: mate }); planEvent(b, { t: 'die', id: 52 }, { hits: null, mateOf: mate });
  ok(b.plan.st.kills === 0, 'a wolf, a stranger\'s kill and an unseen kill don\'t count');
  planEvent(b, { t: 'die', id: 53 }, { hits: hit('boar'), mateOf: mate }); turn(b);
  ok(b.plan.st.kills === 1 && planProgress(b) === 'step 1/3: 1/2 Forest Boars', 'my boar counts (and shows in the progress line)');
  planEvent(b, { t: 'die', id: 54 }, { hits: hit('boar', 3), mateOf: mate });
  b.locks.set(1, 50); turn(b);
  ok(b.plan.i === 1 && b.cmd?.k === 'attack' && b.cmd.tgt === 50, 'a partymate\'s boar too: two kills, on to the player\'s locked target');
  b.cmd = null; turn(b);
  ok(!b.plan && b.cmd?.k === 'follow' && !b.cmd.plan && b.said.at(-1) === 'On you, Natan.', 'target gone; follow as the last step: the plan ends and the bot stays following');
  setPlan(b, [{ k: 'attack' }, { k: 'wait', n: 5 }], { by: 1, byName: 'Natan' }, api); b.locks.clear(); turn(b);
  ok(b.plan?.i === 1 && b.said.includes('noTarget'), 'attack with nothing locked: says so and moves on');
  endPlan(b);
  setPlan(b, [{ k: 'farm', what: 'harpy', n: 3 }], { by: 1 }, api); turn(b); turn(b, 91);
  ok(!b.plan && /no Gale Harpys? on this floor/.test(b.said.at(-1)), 'farming a monster that isn\'t on this floor stops after a while');
}
{
  const b = stub();
  setPlan(b, [{ k: 'wait', n: 2 }, { k: 'emote', what: 'hop' }], { by: 1, loops: 2 }, api);
  b.plan.loops = 2;
  turn(b, 0.1); turn(b, 2.1);
  ok(b.plan.i === 1 && b.sent.filter(m => m.type === 'jump').length === 1, 'repeat: first round, the hop');
  turn(b, 1.1);
  ok(b.plan?.loop === 1 && b.plan.i === 0 && planProgress(b).includes('round 2/2'), 'round two starts over');
  turn(b, 2.1); turn(b, 1.1);
  ok(!b.plan && b.sent.filter(m => m.type === 'jump').length === 2, 'and ends after it');
  setPlan(b, [{ k: 'guard', what: 'here', n: 30 }, { k: 'tend', n: 10 }], { by: 1, at: [20, 40] }, api); turn(b, 0.1);
  ok(b.cmd.guard && b.cmd.x === 20 && b.cmd.z === 40 && b.plan.st.at == null, 'guard here: the player\'s spot when they gave the plan');
  walkCmd(b); turn(b);
  const prev = b.cmd; b.cmd = { k: 'stay', defend: 1, prev }; // a raid on the town (brain.js 'defend')
  turn(b, 0.05); turn(b, 100); turn(b, 100);
  ok(b.plan?.i === 0 && b.plan.pause != null, 'a town raid pauses the plan');
  b.cmd = prev; turn(b, 1);
  ok(b.plan?.i === 0 && b.plan.pause == null, 'released: the guard goes on, its clock not run down by the raid');
  turn(b, 31);
  ok(b.plan?.i === 1 && b.cmd.tend && b.cmd.x === GARDEN.x + 4, 'then tends the garden');
  b.players = [{ id: 2, x: 0, z: 0 }]; turn(b);
  ok(!b.plan && !b.cmd, 'the player who gave it left the party: the plan ends quietly');
  setPlan(b, [{ k: 'skill', n: 2 }], { by: 0 }, api); turn(b);
  ok(!b.plan && b.sent.some(m => m.type === 'skill' && m.slot === 2), 'skill 2: pressed once (a plan from code, by nobody)');
  const s = stub({ script: {} });
  ok(setPlan(s, [{ k: 'come' }], { by: 1 }, api) === null && !s.plan, 'a scripted actor never takes a plan');
  const t = stub();
  setPlan(t, [{ k: 'wait', n: 600 }, { k: 'wait', n: 600 }, { k: 'wait', n: 600 }, { k: 'wait', n: 600 }], { by: 1 }, api);
  turn(t, 0.1); turn(t, 601); turn(t, 601); turn(t, 601);
  ok(!t.plan && /took too long/.test(t.said.at(-1)), 'a plan ends after 30 minutes whatever is left');
}

// ---------- 4. the real brain on a fake socket ----------
class FakeWS {
  constructor() { this.readyState = 1; this.sent = []; this.h = {}; }
  addEventListener(t, f) { (this.h[t] ||= []).push(f); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.emit('close'); }
  emit(t, data) { for (const f of this.h[t] || []) f(data === undefined ? {} : { data: JSON.stringify(data) }); }
}
// Natan (human, id 1) partied (7) with Lyra (cleric bot, id 2) and Rook (guardian bot, id 3); Vex (human, id 4) alone.
const ROSTER = [{ id: 1, name: 'Natan', cls: 'swordsman', bot: false }, { id: 2, name: 'Lyra', cls: 'cleric', bot: true }, { id: 3, name: 'Rook', cls: 'guardian', bot: true }, { id: 4, name: 'Vex', cls: 'ranger', bot: false }];
function makeBot(name = 'Rook', id = 3, cls = 'guardian') {
  const b = createBot({ url: 'ws://test', WebSocket: FakeWS, cls, name, behaviour: 'follow', follow: 'Natan', skill: 5, persona: 'neutral' });
  b.ws.emit('message', { type: 'welcome', id, x: 1, z: 20, seq: 0 });
  b.ws.emit('message', { type: 'roster', players: ROSTER });
  b.ws.emit('message', { type: 'inv', life: {}, cons: { potion: 3 } });
  return b;
}
const row = (id, x, z, hp, cls, party) => [id, x, z, 0, hp, 100, 5, cls, party, 0, 0, 0];
const mobRow = (id, type, x, z, flags = 0) => [id, MOB_IDS.indexOf(type), x, z, 0, 60, 60, flags];
function snap(b, events = [], { mobs = [], party1 = 7, at1 = [2, 20] } = {}) {
  b.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs, gate: [0, 0, 0], events,
    players: [row(1, at1[0], at1[1], 100, 0, party1), row(2, 0, 20, 100, 2, 7), row(3, b.x, b.z, 100, 1, 7), row(4, 30, 30, 100, 3, 9)] } });
}
const run = (b, k, o) => { for (let i = 0; i < k; i++) snap(b, [], o); };
const chats = b => b.ws.sent.filter(m => m.type === 'chat').map(m => m.text);
const planCmd = (plan, more = {}) => ({ t: 'botcmd', by: 1, byName: 'Natan', party: 7, cmd: 'plan', plan, at: [2, 20], ...more });
{
  const b = makeBot();
  run(b, 3);
  snap(b, [planCmd({ steps: [{ k: 'wait', secs: 60 }], loops: 1 })]);
  ok(b.plan && b.plan.all && !b.plan.speak && !chats(b).some(t => t.startsWith('Plan')), 'a plan for the whole party: taken; another bot (the first of the group) says it');
  snap(b, [planCmd({ steps: [{ k: 'guard', place: 'here', secs: 30 }, { k: 'goto', place: 'smith' }, { k: 'come' }], loops: 1 }, { name: 'Rook' })]);
  ok(b.plan?.steps.length === 3 && b.cmd?.guard && b.cmd.x === 2 && chats(b).some(t => t.startsWith('Plan: 1) guard your spot for 30 s 2) go to the smith 3) come back to you')), 'a plan from a botcmd event: taken, said, first step under way');
  ok(/^Plan \(step 1\/3: guard your spot/.test(b.goal) && b.mode === 'stay', `the goal shows the plan (${b.goal})`);
  // a boar wanders within 14 m of the post: the guard takes it on; one 30 m off is left alone
  const near = [mobRow(70, 'boar', 8, 26), mobRow(71, 'boar', 2, 52)];
  run(b, 4, { mobs: near });
  ok(b.tgtId === 70, 'guard: fights what comes near the post, not what is far off');
  snap(b, [{ t: 'botcmd', by: 1, byName: 'Natan', party: 7, cmd: 'status' }]);
  ok(b.plan && /plan step 1\/3/.test(chats(b).at(-1)), 'status: keeps the plan and reports it');
  snap(b, [{ t: 'botcmd', by: 1, byName: 'Natan', party: 7, cmd: 'follow' }]);
  ok(!b.plan && b.cmd?.k === 'follow' && !b.cmd.plan, 'a new order ends the plan');
  snap(b, [planCmd({ steps: [{ k: 'wait', secs: 60 }], loops: 1 })]);
  const said = chats(b).length;
  snap(b, [{ t: 'botcmd', by: 1, byName: 'Natan', party: 7, cmd: 'cancel', name: 'Rook' }]);
  ok(!b.plan && !b.cmd && chats(b).length === said + 1, '/b cancel: no plan, no order, one line');
  snap(b, [planCmd({ steps: [{ k: 'wait', secs: 60 }], loops: 1 }, { by: 4, byName: 'Vex', party: 9 })]);
  ok(!b.plan, 'another party\'s plan is not ours');
  snap(b, [planCmd({ steps: [{ k: 'wait', secs: 60 }], loops: 1 }, { name: 'Lyra' })]);
  ok(!b.plan, 'a plan for another bot by name is not ours');
  snap(b, [planCmd({ steps: [{ k: 'goto', place: 'smith' }, { k: 'come' }], loops: 1 }, { name: 'rook' })]);
  ok(b.plan && J(b.plan.group) === '[3]', 'a plan for us by name');
  let steps = 0; while (b.plan?.i === 0 && steps++ < 600) snap(b);
  ok(b.plan?.i === 1 && Math.hypot(b.x - SMITH.x, b.z - SMITH.z) < SMITH.r + 3.2, `walked to the smith (${steps} snapshots, ${Math.hypot(b.x - SMITH.x, b.z - SMITH.z).toFixed(1)} m from it)`);
  steps = 0; while (b.plan && steps++ < 600) snap(b);
  ok(!b.plan && Math.hypot(b.x - 2, b.z - 20) < 6.5 && chats(b).at(-1) === 'Plan done, Natan.', 'and came back to the player: plan done');
  snap(b, [planCmd({ steps: [{ k: 'wait', secs: 60 }], loops: 1 })]);
  run(b, 2, { party1: 0 });
  ok(!b.plan && !b.cmd, 'the player leaves the party: the plan ends');
  // farm: the leader hunts the named kind, kills are counted from die events
  snap(b, [planCmd({ steps: [{ k: 'farm', mob: 'wolf', n: 1 }, { k: 'wait', secs: 5 }], loops: 1 }, { name: 'Rook' })]);
  const field = [mobRow(80, 'boar', b.x + 6, b.z + 6), mobRow(81, 'wolf', b.x + 20, b.z + 30)];
  run(b, 6, { mobs: field });
  ok(b.cmd?.k === 'farm' && b.cmd.mob === 'wolf' && b.tgtId === 81, 'farm wolves: goes for the wolf, past a nearer boar');
  snap(b, [{ t: 'hit', id: 81, by: 3 }], { mobs: field });
  snap(b, [{ t: 'die', id: 81 }], { mobs: [field[0]] });
  ok(b.plan?.i === 1 && b.cmd?.k === 'stay', 'the wolf dies to us: one kill, next step');
  b.stop();
}

// ---------- 5. the AI mind ----------
let current = null;
registerBotHook('onEvent', (b, e) => current?.onEvent(b, e));
const chat = (id, from, text) => ({ t: 'chat', id, from, text, ch: 'p', party: 7 });
async function mindCase(reply, { mayOrder = null } = {}) {
  const cfg = readConfig({ AI_PROVIDER: 'mock', AI_ENABLED: '1', AI_THINK_S: '0' });
  const p = mockProvider({ reply: () => reply });
  const bots = [], m = new Minds({ cfg, provider: p, listBots: () => bots, env: {}, log: () => {}, mayOrder });
  current = m;
  const b = makeBot(); bots.push(b);
  run(b, 3);
  snap(b, [chat(1, 'Natan', 'Rook, farm 5 boars then meet me at the smith')]);
  for (let i = 0; i < 20 && !p.calls.length; i++) await sleep(5);
  await sleep(20);
  return { b, p, m };
}
ok(INTENT_SCHEMA.required.includes('plan') && J(INTENT_SCHEMA.properties.plan.items.properties.do.enum) === J(STEP_IDS) && INTENT_SCHEMA.properties.plan.items.additionalProperties === false, 'the intent schema carries a strict plan: steps from the menu only');
ok(J(sanitizeIntent({ say: 'ok', plan: [{ do: 'farm', what: 'boars', n: 5 }, { do: 'buy', what: 'sword', n: 1 }] }).plan) === J([{ k: 'farm', mob: 'boar', n: 5 }]) && J(sanitizeIntent({ plan: 'farm' }).plan) === '[]' && J(sanitizeIntent({}).plan) === '[]', 'sanitizeIntent: clean steps only, [] for anything else');
ok(/"plan"/.test(SYSTEM) && /cannot craft, buy, sell or gather/.test(SYSTEM) && SYSTEM.includes('smith'), 'the prompt lists the steps, the places and what a bot cannot do');
{
  const { b, p } = await mindCase({ say: 'On it!', order: 'follow', stance: 'keep', focus: '', remember: '', plan: [{ do: 'farm', what: 'boar', n: 5 }, { do: 'goto', what: 'smith', n: 0 }, { do: 'craft', what: 'sword', n: 1 }] });
  snap(b);
  const c = chats(b);
  ok(p.calls.length === 1 && b.plan?.steps.length === 2 && b.plan.by === 1 && b.cmd?.k === 'farm' && b.cmd.mob === 'boar', 'a plan from the model becomes the bot\'s plan (the unknown step dropped; the order beside it ignored)');
  ok(c.indexOf('On it!') >= 0 && c.indexOf('On it!') < c.findIndex(t => t.startsWith('Plan: 1) 5 Forest Boars 2) go to the smith')), 'it says its own line, then the plan');
  const sum = summarize(b, { stance: 'balanced', focusId: 0, events: [], chat: [] }, { kind: 'tick' }, null, Date.now());
  ok(/Your plan \(from Natan\): 1\) 5 Forest Boars 2\) go to the smith\. Now at step 1\/2: 0\/5 Forest Boars/.test(sum), 'the next prompt shows the plan and where it is');
  b.stop();
}
{
  const { b } = await mindCase({ say: 'Sorry, not for you.', order: 'follow', stance: 'keep', focus: '', remember: '', plan: [{ do: 'come', what: '', n: 0 }] }, { mayOrder: () => false });
  ok(!b.plan && !b.cmd && chats(b).includes('Sorry, not for you.'), 'a player who may not order the bot gets a reply, but no plan and no order');
  b.stop();
}
{
  const { b } = await mindCase({ say: '', order: 'stay', stance: 'keep', focus: '', remember: '', plan: [] }, { mayOrder: () => true });
  ok(!b.plan && b.cmd?.k === 'stay', 'no plan: an order works as before');
  b.stop();
}
current = null;

// ---------- 6. live ----------
if (process.env.NO_LIVE) { console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed (live part skipped)`); process.exit(failed ? 1 : 0); }
const PORT = Number(process.env.PORT) || 3745;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PORT: String(PORT), DATABASE_URL: '', NAMED_ENABLED: '0', AI_PROVIDER: '', START_LEVEL: '6' };
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
const stop = code => { try { srv.kill(); } catch {} process.exit(code); };
try {
  for (let i = 0; i < 150; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(200); } }
  const url = `ws://localhost:${PORT}/ws`;
  const h = { id: 0, events: [], sys: [], ws: new WebSocket(url), x: 0, z: 0 };
  h.ws.on('open', () => h.ws.send(J({ type: 'join', name: 'Nat', cls: 'swordsman' })));
  h.ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.type === 'welcome') { h.id = m.id; h.x = m.x; h.z = m.z; }
    if (m.type === 'snap') for (const e of m.w.events || []) { h.events.push(e); if (e.t === 'invite' && e.to === h.id) h.ws.send(J({ type: 'accept', from: e.from })); if (e.t === 'sys' && e.to === h.id) h.sys.push(e.text); }
  });
  const say = text => h.ws.send(J({ type: 'chat', text }));
  await sleep(800);
  const { team } = startTeam({ url, WebSocket, roles: ['guardian', 'ranger'], names: ['Rook', 'Wren'], inviteHumans: true, behaviour: 'follow', skill: 5 });
  const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(100); } return false; };
  ok(await until(() => team.every(b => b.party && b.anchor?.name === 'Nat'), 15000), 'live: two bots joined the human\'s party');
  const dist = (b, x, z) => Math.hypot(b.x - x, b.z - z);
  const botChat = () => h.events.filter(e => e.t === 'chat' && team.some(b => b.id === e.id)).map(e => e.text);

  say('/b wait 2 then go smith then bow then come');
  ok(await until(() => team.every(b => b.plan), 3000) && h.sys.some(t => /^Plan for your bots: 1\) wait 2 s 2\) go to the smith 3\) bow 4\) come back to you\.$/.test(t)), `live: both bots took the plan; the player is told (${h.sys.at(-1)})`);
  ok(await until(() => botChat().filter(t => t.startsWith('Plan: 1) wait 2 s')).length === 1, 3000), 'live: one bot says the plan for the group');
  ok(await until(() => team.every(b => (b.plan?.i ?? 9) >= 2 && dist(b, SMITH.x, SMITH.z) < SMITH.r + 3.2), 40000) , `live: both walked to the smith (${team.map(b => dist(b, SMITH.x, SMITH.z).toFixed(1)).join(', ')} m)`);
  ok(await until(() => team.every(b => h.events.some(e => e.t === 'pose' && e.id === b.id && e.k === 'bow')), 8000), 'live: and bowed there');
  ok(await until(() => team.every(b => !b.plan), 40000) && team.every(b => dist(b, h.x, h.z) < 9) && await until(() => botChat().some(t => /^Plan done, Nat\.$/.test(t)), 3000), `live: then came back to the player: plan done (${team.map(b => dist(b, h.x, h.z).toFixed(1)).join(', ')} m)`);

  say('/b Rook: guard here 60');
  await until(() => team[0].plan, 3000);
  say('/b follow');
  ok(await until(() => !team[0].plan && team[0].cmd?.k === 'follow', 3000), 'live: a new order ends the plan');
  say('/b go to the moon');
  ok(await until(() => h.sys.some(t => /don't know a place/.test(t)), 3000) && team.every(b => !b.plan), 'live: an unknown place is an error for the player, no plan');

  say('/b farm 2 boars then come');
  ok(await until(() => team.every(b => b.plan?.steps[0].mob === 'boar'), 3000), 'live: farm 2 boars then come: taken');
  const done = await until(() => team.every(b => !b.plan), 150000);
  ok(done && await until(() => botChat().filter(t => /^Plan done, Nat\.$/.test(t)).length >= 2, 3000) && team.every(b => dist(b, h.x, h.z) < 9), `live: two boars killed, then back to the player (${team.map(b => `${b.name} ${b.plan ? planProgress(b) : 'done'} ${dist(b, h.x, h.z).toFixed(0)} m`).join(', ')})`);
  if (process.env.SHOW_CHAT) console.log(botChat());
  for (const b of team) b.stop();
  h.ws.close();
} catch (err) { console.error(err); console.error(srvLog.slice(-2000)); failed++; }
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
stop(failed ? 1 : 0);
