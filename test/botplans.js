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
import { parseBotChat, botHelp, BOT_COMMANDS, botMayNotSend, say as botSay } from '../shared/bots/social.js';
import { STEPS, STEP_IDS, PLACES, PLAN_STEPS_MAX, placeOf, mobKind, cleanPlan, planText, planProgress, planHelp } from '../shared/bots/plan.js';
import { setPlan, endPlan, planTurn, planEvent, planNote, spareGear } from '../shared/bots/planrun.js';
import { MERCHANT, SHOP, CONSUMABLES } from '../shared/items.js';
import { sanitizeIntent, INTENT_SCHEMA } from '../server/ai/intent.js';
import { Minds } from '../server/ai/mind.js';
import { readConfig } from '../server/ai/config.js';
import { mockProvider } from '../server/ai/providers/mock.js';
import { SYSTEM, summarize } from '../server/ai/prompt.js';
import { startTeam } from '../shared/teambots.js';
import { SMITH } from '../shared/crafting.js';
import { GARDEN } from '../shared/life.js';
import { MOB_IDS } from '../shared/data.js';
import { LAYERS, labRun, labAt, portOpen } from '../shared/labyrinth.js';

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
ok(/monster/.test(P('/b farm 3 blorps')?.error || '') && /place/.test(P('/b go to the moon')?.error || '') && /Go where/.test(P('/b go')?.error || '') && /1 to 4/.test(P('/b skill 9')?.error || ''), 'an unknown monster, place or skill slot is an error for the player, not a guess');
ok(J(P('/b hunt dire wolves 3 > head to the raid gate > bow')?.plan?.steps.map(s => s.mob || s.place || s.pose)) === J(['wolf', 'gate', 'bow']) && P('/b skill 2 then use skill 3')?.plan?.steps[1].slot === 3, '">" between steps, names in full, "use skill 3"');
ok(botHelp().length === Object.keys(BOT_COMMANDS).length + 1 && planHelp().length === 3 && planHelp().join(' ').includes('smith'), 'help: the orders as before, plus three plan lines');
// the old single orders keep their meaning (review: parsing regressions)
ok(P('/b kill it')?.cmd === 'attack' && P('/b kill my target')?.cmd === 'attack' && P('/b kill the boar')?.cmd === 'attack' && P('/b farm here')?.cmd === 'farm' && P('/b grind exp')?.cmd === 'farm' && P('/b farm blorps')?.cmd === 'farm' && P('/b come here')?.cmd === 'come' && P('/b attack 3')?.cmd === 'attack' && P('/b farm mobs')?.cmd === 'farm' && P('/b grind monsters')?.cmd === 'farm' && P('/b farm 5 mobs')?.plan?.steps[0].n === 5 && P('/b stay here', [])?.cmd === 'stay', '"kill it", "kill the boar", "farm here", "grind exp": the plain order they always were (a count makes "kill" a hunt)');
ok(P('/b go floor 2')?.plan?.steps[0].place === 'camp2' && J(P('/b guard floor 2')?.plan?.steps[0]) === J({ k: 'guard', place: 'camp2', secs: 0 }) && P('/b guard floor 2 60')?.plan?.steps[0].secs === 60 && P('/b guard here 60')?.plan?.steps[0].secs === 60, '"go floor 2" is a place; a number after a guard\'s place is its time');
ok(J(P('/b go smith and come')?.plan?.steps.map(s => s.k)) === J(['goto', 'come']) && J(P('/b farm 10 boars, then go smith and then come')?.plan?.steps.map(s => s.k)) === J(['farm', 'goto', 'come']) && P('/b wait 1m30s then come')?.plan?.steps[0].secs === 90, '"and" before a step word splits too; "1m30s" is 90 s');
ok(J(P('/b go smith then say hi: there')?.plan?.steps) === J([{ k: 'goto', place: 'smith' }, { k: 'say', text: 'hi: there' }]) && P('/b say see you then')?.plan?.steps[0].text === 'see you then' && P('/b say hi and wave then hop')?.plan?.steps[0].text === 'hi and wave' && P('/b Lyra: say hi: there')?.name === 'Lyra', 'a colon or a "then" inside a line to say stays in the line');
ok(P('/b farm 5 wardens hounds')?.plan?.steps[0].mob === 'hound' && P("/b hunt will-o'-wisps 2")?.plan?.steps[0].mob === 'wisp', 'monster names with an apostrophe or hyphens');
ok(P('/b Hop follow', ['Hop', 'Rook'])?.name === 'Hop' && P('/b Hop follow', () => ['Hop'])?.cmd === 'follow' && P('/b hop', ['Hop'])?.plan?.steps[0].pose === 'hop' && P('/b Bow 2 farm 5 boars', ['Bow 2'])?.name === 'Bow 2' && J(P('/b stay here', ['Stay'])) === J({ cmd: 'stay', name: '' }) && P('/b attack boss', ['Attack'])?.cmd === 'attack' && P('/b Stay: come', ['Stay'])?.name === 'Stay', 'a bot named like a step (Hop, Bow 2) is a name when the server knows its party\'s bots; one named like an old order word (Stay) never changes what the order means');
ok(/isn't a bot order/.test(P('/b constructor')?.error || '') && /place/.test(P('/b go __proto__')?.error || '') && P('/b say / / /b Zed: boss')?.plan?.steps[0].text === 'b Zed: boss', 'prototype keys are not orders or places; a line to say never starts with a slash');

// sell and buy (the merchant)
ok(J(P('/b sell loot then buy 5 potions')?.plan?.steps) === J([{ k: 'sell' }, { k: 'buy', n: 5 }]) && J(P('/b go merchant then sell and buy 3')?.plan?.steps.map(s => s.k)) === J(['goto', 'sell', 'buy'])
  && P('/b restock')?.plan?.steps[0].n === 3 && P('/b buy 99 health potions')?.plan?.steps[0].n === 10 && P('/b sell')?.plan?.steps.length === 1, '/b sell loot then buy 5 potions; "restock" buys 3; at most 10 at a time');
ok(/only buy Health Potions/.test(P('/b buy 2 tonics')?.error || '') && /only buy/.test(P('/b buy a sword')?.error || '') && P('/b say buy low and sell high')?.plan?.steps[0].text === 'buy low and sell high'
  && planText(cleanPlan([{ do: 'sell' }, { do: 'buy', what: 'potions', n: 2 }])) === 'Plan: 1) sell my spare gear 2) buy 2 potions' && planHelp().join(' ').includes('sell · buy [3] potions'), 'only potions are bought; the words in a say line stay words; the plan text and the help name both steps');

// ---------- 2. cleaning ----------
ok(placeOf('the smith') === 'smith' && placeOf('to the raid gate') === 'gate' && placeOf('Town of Beginnings') === 'well' && placeOf('me') === 'here' && placeOf('life hall') === 'lifehall' && placeOf('floor 2') === 'camp2' && placeOf('nowhere') === '', 'places by loose name');
ok(mobKind('boars') === 'boar' && mobKind('Dire Wolves') === 'wolf' && mobKind('alpha wolf') === 'alpha' && mobKind('harpies') === 'harpy' && mobKind('warden') === '' && mobKind('vines') === '' && mobKind('training dummy') === '' && mobKind('constructor') === '' && mobKind('mire') === '' && mobKind('ironhide') === 'ironboar', 'monsters by loose name; never a boss, a prop or an Academy dummy; a first word only when one monster has it');
const dirty = cleanPlan([{ do: 'farm', what: 'boars', n: 999 }, { do: 'craft', what: 'sword', n: 1 }, { do: 'goto', what: 'the smith', n: 0 }, { do: 'say', what: '/b leave', n: 0 }, { do: 'say', what: 'see http://x.com', n: 0 }, { do: 'emote', what: 'backflip', n: 0 }, { do: 'wait', what: '', n: 99999 }, { do: 'skill', what: '', n: 7 }, { do: 'farm', what: 'the horned warden', n: 1 }]);
ok(J(dirty.steps) === J([{ k: 'farm', mob: 'boar', n: 50 }, { k: 'goto', place: 'smith' }, { k: 'say', text: 'b leave' }, { k: 'wait', secs: 600 }]) && dirty.errors.length === 5, 'cleanPlan: numbers clamped; craft, a link, an unknown pose, slot 7 and a boss are dropped; a say step is never a slash command');
ok(cleanPlan(Array.from({ length: 30 }, () => ({ k: 'wait', n: 1 }))).steps.length === PLAN_STEPS_MAX && cleanPlan({ steps: [{ k: 'come' }], loops: 99 }).loops === 5 && cleanPlan([]) === null && cleanPlan('farm') === null && cleanPlan([{ k: 'x' }]).steps.length === 0, `at most ${PLAN_STEPS_MAX} steps and 5 repeats; nothing usable is no plan`);
ok(planText({ steps: p1.plan.steps, loops: 1 }) === 'Plan: 1) 10 Forest Boars 2) go to the smith 3) come back to you' && planText({ steps: [{ k: 'wait', secs: 120 }], loops: 3 }) === 'Plan: wait 2 min (x3)', 'the plan in words');
ok(planText({ steps: [{ k: 'farm', mob: 'wolf', n: 3 }, { k: 'farm', mob: 'harpy', n: 2 }, { k: 'goto', place: 'smith' }], loops: 1 }) === 'Plan: 1) 3 Dire Wolves 2) 2 Gale Harpies 3) go to the smith and wait there' && planText({ steps: [{ k: 'goto', place: 'well' }, { k: 'wait', secs: 0 }], loops: 1 }) === 'Plan: 1) go to the well 2) wait there', 'plurals; a last goto or an open wait is where the bot stays');
{
  const hostile = cleanPlan([{ k: 'constructor' }, { k: '__proto__' }, { k: 'goto', what: 'constructor' }, { k: 'goto', what: 'toString' }, { do: 'say', what: ' / / /b leave' }, { do: 'say', what: '\\ /duel x' }, { do: 'say', what: '//' }]);
  ok(J(hostile.steps) === J([{ k: 'say', text: 'b leave' }, { k: 'say', text: 'duel x' }]) && hostile.errors.length === 5, 'cleanPlan: prototype keys are no steps or places; however many slashes, a say step never starts with one');
  ok(J(cleanPlan([{ k: 'farm', what: 'boar', n: 2 }, { k: 'craft' }, { k: 'come' }], { strict: true }).steps) === J([{ k: 'farm', mob: 'boar', n: 2 }]) && cleanPlan([{ k: 'craft' }, { k: 'come' }], { strict: true }).steps.length === 0, 'strict (the AI mind): a plan stops at its first unusable step, never a hole in the middle');
  ok(botMayNotSend({ type: 'chat', text: '/b Zed: boss' }) && botMayNotSend({ type: 'chat', text: '  /duel Nat' }) && botMayNotSend({ type: 'chat', text: '\\b x' }) && botMayNotSend({ type: 'botcmd', cmd: 'boss' }) && !botMayNotSend({ type: 'chat', text: '/sit' }) && !botMayNotSend({ type: 'chat', text: '/stand ' }) && !botMayNotSend({ type: 'chat', text: 'On it!' }) && !botMayNotSend({ type: 'input' }), 'a bot\'s socket may never send a slash command (but a pose) or a bot order');
  const fb = { me: {}, t: 5, name: 'Rook', party: 7, sent: [] }; fb.send = m => fb.sent.push(m);
  botSay(fb, 'mind', {}, { force: true, text: ' / /b Zed: boss' }); botSay(fb, 'mind', {}, { force: true, text: '//' });
  ok(fb.sent.length === 1 && fb.sent[0].text === 'b Zed: boss', 'say(): a line never goes out starting with a slash (the AI mind\'s words too)');
}
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
const turn = (b, dt = 0.5) => { for (let left = dt; left > 1e-9; left -= 0.5) { b.t += Math.min(0.5, left); planTurn(b, PV(b), api); } }; // (in think-sized steps: a long gap with no turn is a pause)
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
  const hit = (kind, by = 2) => Object.assign(new Map([[by, { first: 100, last: 100 }]]), { kind });
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
  ok(!b.plan && /no Gale Harpies on this floor/.test(b.said.at(-1)), 'farming a monster that isn\'t on this floor stops after a while');
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
  ok(b.plan?.i === 0 && b.plan.st.at != null, 'a town raid pauses the plan');
  b.cmd = prev; turn(b, 1);
  ok(b.plan?.i === 0 && b.t - b.plan.st.at < 3, 'released: the guard goes on, its clock not run down by the raid');
  turn(b, 31);
  ok(b.plan?.i === 1 && b.cmd.tend && b.cmd.x === GARDEN.x + 4, 'then tends the garden');
  b.players = [{ id: 2, x: 0, z: 0 }]; turn(b);
  ok(!b.plan && !b.cmd, 'the player who gave it left the party: the plan ends quietly');
  setPlan(b, [{ k: 'skill', n: 2 }], { by: 0 }, api); turn(b);
  ok(!b.plan && b.sent.some(m => m.type === 'skill' && m.slot === 2), 'skill 2: pressed once (a plan from code, by nobody)');
  const s = stub({ script: {} });
  ok(setPlan(s, [{ k: 'come' }], { by: 1 }, api) === null && !s.plan, 'a scripted actor never takes a plan');
}
{ // review fixes: where a plan ends, pauses, group plans, what counts as a kill
  let b = stub();
  setPlan(b, [{ k: 'goto', what: 'smith' }], { by: 1, byName: 'Natan' }, api); turn(b);
  ok(b.said[0] === 'Plan: go to the smith and wait there.' && b.cmd?.plan, 'a single goto: the plan says it will wait there');
  walkCmd(b); turn(b);
  ok(!b.plan && b.cmd?.k === 'stay' && b.cmd.post === 1 && !b.cmd.plan && b.cmd.x === SMITH.x && b.said.at(-1) === "Plan done, Natan. I'll wait here.", 'goto as the last step: the plan ends and the bot holds there (its order stays, marked as a post)');
  b = stub();
  setPlan(b, [{ k: 'wait', n: 2 }, { k: 'wait' }], { by: 1, byName: 'Natan' }, api); turn(b, 0.1); turn(b, 2.5);
  ok(!b.plan && b.cmd?.k === 'stay' && b.cmd.post === 1, 'an open wait as the last step: stays waiting');
  b = stub();
  setPlan(b, [{ k: 'wait', n: 10 }, { k: 'wait', n: 50 }], { by: 1 }, api); turn(b, 0.1); turn(b, 4);
  b.dead = true; turn(b, 60); b.dead = false; turn(b, 3);
  ok(b.plan?.i === 0, 'dead for a minute: the wait did not run down meanwhile');
  b.t += 300; turn(b, 2); // (downed, in a boss arena's fall, encased: no turn at all for a while)
  ok(b.plan?.i === 0 && b.t - b.plan.t0 < 12, 'no turn for five minutes: every clock waited (the 30 minute one too)');
  turn(b, 3);
  ok(b.plan?.i === 1, 'and then it runs out as it should');
  // a group: one bot speaks
  const g = stub({ id: 3, players: [{ id: 1, x: 3, z: 5 }, { id: 2, x: 0, z: 5 }, { id: 3, x: 0, z: 5 }] });
  setPlan(g, [{ k: 'say', what: 'hello all' }, { k: 'attack' }, { k: 'goto', what: 'camp2' }], { by: 1, byName: 'Natan', group: [2, 3] }, api);
  turn(g, 0.1); turn(g, 2);
  ok(g.plan === null && !g.said.length && g.planNote?.text === 'Plan stopped: Floor 2 is sealed for me.', 'not the speaker of its group: says nothing for the plan, the say step or a missing target; a stop is noted for later');
  g.t += 4; planNote(g, api);
  ok(g.said.at(-1) === 'Plan stopped: Floor 2 is sealed for me.' && !g.planNote, 'nobody else said why: it does, a moment later');
  setPlan(g, [{ k: 'goto', what: 'camp2' }], { by: 1, group: [2, 3] }, api); turn(g, 0.1);
  const before = g.said.length; g.partyChatT = g.t + 0.5; g.t += 4; planNote(g, api);
  ok(g.said.length === before && !g.planNote, 'somebody in the party spoke meanwhile (the speaker, for the same reason): it stays quiet');
  // kills: what our party hit during the step, whatever the brain's own hit list still holds
  const f = stub();
  const mate = (bb, id) => id === 3;
  setPlan(f, [{ k: 'farm', what: 'boar', n: 3 }, { k: 'wait', n: 5 }], { by: 1 }, api); turn(f);
  planEvent(f, { t: 'hit', id: 60, by: 3 }, { mob: { type: 'boar' }, mateOf: mate }); planEvent(f, { t: 'die', id: 60, x: 0, z: 9 }, { hits: null, mob: null, mateOf: mate });
  ok(f.plan.st.kills === 1, 'a boar a partymate hit, forgotten by the brain since (out of sight): still our kill');
  planEvent(f, { t: 'hit', id: 61, by: 2 }, { mob: undefined, mateOf: mate }); planEvent(f, { t: 'die', id: 61 }, { hits: Object.assign(new Map([[2, {}]]), {}), mob: { type: 'boar' }, mateOf: mate });
  ok(f.plan.st.kills === 2, 'hit and dead in one snapshot: the kind comes from the snapshot before');
  planEvent(f, { t: 'hit', id: 62, by: 2, prop: 1 }, { mob: { type: 'boar' }, mateOf: mate }); planEvent(f, { t: 'die', id: 62 }, { hits: null, mateOf: mate });
  planEvent(f, { t: 'hit', id: 63, by: 9 }, { mob: { type: 'boar' }, mateOf: mate }); planEvent(f, { t: 'die', id: 63 }, { hits: null, mateOf: mate });
  const prev = f.cmd; f.cmd = { k: 'stay', defend: 1, prev };
  planEvent(f, { t: 'hit', id: 64, by: 2 }, { mob: { type: 'boar' }, mateOf: mate }); planEvent(f, { t: 'die', id: 64 }, { hits: new Map([[2, {}]]), mob: { type: 'boar' }, mateOf: mate });
  f.cmd = prev;
  ok(f.plan.st.kills === 2, 'a prop, a stranger\'s boar and a kill made defending the town in a raid do not count');
  planEvent(f, { t: 'hit', id: 65, by: 2 }, { mob: { type: 'boar' }, mateOf: mate }); f.t += 40; f.plan.seen = f.t;
  planEvent(f, { t: 'die', id: 65 }, { hits: Object.assign(new Map([[2, { first: f.t - 40, last: f.t - 40 }]]), { kind: 'boar' }), mateOf: mate });
  ok(f.plan.st.kills === 2, 'a boar we tapped 40 s ago that somebody else finished is not our kill');
  f.cmd = { k: 'stay', defend: 1, prev }; endPlan(f);
  ok(!f.plan && f.cmd.defend && f.cmd.prev === null, 'a plan that ends during a raid: the raid no longer goes back to its step\'s order');
  const bs = stub();
  setPlan(bs, [{ k: 'boss' }, { k: 'wait', n: 5 }], { by: 1 }, api); turn(bs);
  planEvent(bs, { t: 'die', id: 70, b: 1, x: 3000, z: 0 }, { hits: null, mateOf: mate }); turn(bs);
  ok(bs.plan?.i === 0, 'another floor\'s boss dying is not ours');
  planEvent(bs, { t: 'die', id: 71, b: 1, x: 2, z: 160 }, { hits: null, mateOf: mate }); turn(bs);
  ok(bs.plan?.i === 1, 'this floor\'s boss dies (whoever the brain saw hit it): the boss step is done');
  const t = stub();
  setPlan(t, [{ k: 'wait', n: 600 }, { k: 'wait', n: 600 }, { k: 'wait', n: 600 }, { k: 'wait', n: 600 }], { by: 1 }, api);
  turn(t, 0.1); turn(t, 601); turn(t, 601); turn(t, 601);
  ok(!t.plan && /took too long/.test(t.said.at(-1)), 'a plan ends after 30 minutes whatever is left');
}
{ // sell and buy: a stub merchant that answers the way server/game.js sell() and buy() do
  const POT = SHOP.findIndex(s => s.kind === 'cons' && s.id === 'potion'), PRICE = CONSUMABLES.potion.price;
  const shopper = (o = {}) => {
    const b = stub({ x: MERCHANT.x, z: MERCHANT.z + 40, gold: 10, cons: { potion: 0 }, bag: [{ u: 11, name: 'Old Axe' }, { u: 12, name: 'Keepsake', ks: 1 }, { u: 13, name: 'Cap' }, { u: 14, name: 'Academy Bow', ac: 1 }], ...o });
    b.send = m => {
      b.sent.push(m);
      const near = Math.hypot(b.x - MERCHANT.x, b.z - MERCHANT.z) < MERCHANT.r + 1.5;
      if (m.type === 'sell' && near) { const i = b.bag.findIndex(it => it.u === m.u); if (i >= 0 && !b.bag[i].ks && !b.bag[i].ac) { b.bag = b.bag.filter((_, j) => j !== i); b.gold += 12; } }
      if (m.type === 'buy' && near && m.i === POT && b.gold >= PRICE) { b.gold -= PRICE; b.cons = { ...b.cons, potion: b.cons.potion + 1 }; }
    };
    return b;
  };
  const b = shopper();
  ok(J(spareGear(b).map(it => it.u)) === '[11,13]', 'spare gear: the bag without keepsakes and Academy weapons');
  setPlan(b, [{ k: 'sell' }, { k: 'buy', n: 3 }, { k: 'say', what: 'stocked up' }], { by: 1, byName: 'Natan', at: [3, 5] }, api);
  turn(b, 0.1);
  ok(b.cmd?.k === 'stay' && b.cmd.plan && b.cmd.x === MERCHANT.x && b.cmd.z === MERCHANT.z && b.cmd.fl === 1 && b.cmd.stop < MERCHANT.r + 1.5 && planProgress(b) === 'step 1/3: sell my spare gear', 'sell: an order to the merchant\'s counter, inside the server\'s reach');
  turn(b, 5);
  ok(b.plan.i === 0 && !b.sent.length, 'nothing is sold on the way');
  walkCmd(b); for (let k = 0; k < 14 && b.plan?.i === 0; k++) turn(b, 0.5); // (two sales, 0.35 to 0.65 s apart)
  ok(b.plan?.i === 1 && J(b.sent.filter(m => m.type === 'sell').map(m => m.u)) === '[11,13]' && b.bag.length === 2 && b.gold === 34 && b.said.includes('Sold 2 things for 24 gold.'), `at the counter: the two spare things are sold, one at a time, and it says what it got (${J(b.said.slice(-2))}, ${b.gold} gold)`);
  turn(b, 6);
  ok(b.cons.potion === 2 && b.gold === 4 && b.sent.filter(m => m.type === 'buy').length === 3 && b.said.includes('I could only pay for 2 potions.'), `buy 3 with gold for 2: two potions, and it says so (${J(b.said.slice(-2))})`);
  turn(b, 3);
  ok(!b.plan && b.said.includes('stocked up'), 'and the plan goes on to its next step');
  const r = shopper({ gold: 100, bag: [] });
  setPlan(r, [{ k: 'sell' }, { k: 'buy', n: 2 }], { by: 1, byName: 'Natan' }, api);
  turn(r, 0.1); walkCmd(r); turn(r, 8);
  ok(!r.plan && r.said.includes('Nothing to sell.') && r.said.includes('Bought 2 potions.') && r.cons.potion === 2 && r.gold === 100 - 2 * PRICE && r.sent.filter(m => m.type === 'buy').length === 2, `an empty bag: "Nothing to sell", then exactly two potions (${J(r.said.slice(-3))})`);
  const q = shopper({ gold: 0, bag: [] });
  setPlan(q, [{ k: 'buy', n: 2 }], { by: 1, byName: 'Natan' }, api);
  turn(q, 0.1); walkCmd(q); turn(q, 5);
  ok(!q.plan && q.said.some(t => /^I can't pay for a potion \(0 gold\)\.$/.test(t)) && q.sent.filter(m => m.type === 'buy').length === 1, 'no gold: one try, it says it can\'t pay, and the plan moves on');
  const far = shopper();
  setPlan(far, [{ k: 'sell' }], { by: 1, byName: 'Natan' }, api);
  turn(far, 0.1); turn(far, 245);
  ok(!far.plan && /Plan stopped: I couldn't get to the merchant\./.test(far.said.at(-1)) && !far.sent.length, 'it never gets there: the plan stops after 4 minutes');
}

// ---------- 3c. the lever step (a labyrinth's two levers) ----------
{
  const GAL = LAYERS.find(L => L.id === 'galleries'), [l0, l1] = GAL.leverList, pulls = b => b.sent.filter(m => m.type === 'lab' && m.a === 'lever').length;
  const inLab = (o = {}) => stub({ x: l0.x + 1, z: l0.z, players: [{ id: 1, x: l0.x, z: l0.z }, { id: 2, x: l0.x + 1, z: l0.z }], ...o });
  labRun.now = 50; labRun.portUp.galleries = 0;
  ok(J(P('/b lever')) === J({ plan: { steps: [{ k: 'lever', secs: 0 }], loops: 1 }, name: '' }) && P('/b Rook: pull the other lever').plan?.steps[0].k === 'lever' && P('/b come then lever 2m then follow').plan?.steps[1].secs === 120 && planText({ steps: [{ k: 'lever' }], loops: 1 }) === 'Plan: work the other lever', 'lever: "/b lever", "pull the other lever", a wait time; said as "work the other lever"');
  { // out in the field: nothing to work
    const b = stub(); setPlan(b, [{ k: 'lever' }], { by: 1, byName: 'Natan' }, api); turn(b);
    ok(!b.plan && b.said.at(-1) === 'Plan stopped: there are no levers here.', 'lever: outside a labyrinth the plan stops and says why');
  }
  { // the player at one lever: the bot takes the other, turns it, and turns it again the moment the player's turns
    const b = inLab(); setPlan(b, [{ k: 'lever' }], { by: 1, byName: 'Natan' }, api); turn(b, 0.5);
    ok(b.cmd?.k === 'stay' && b.cmd.plan && b.cmd.x === l1.x && b.cmd.z === l1.z && !pulls(b), 'lever: it heads for the lever its player is not at');
    b.x = l1.x; b.z = l1.z + 1; turn(b, 1);
    ok(pulls(b) === 1 && b.said.at(-1) === 'The bone lever here is turned. Work yours!', `lever: there, it turns it and says so (${b.said.at(-1)})`);
    turn(b, 5); ok(pulls(b) === 1 && b.plan, 'lever: then waits for the other one');
    b.labLever = { l: 'galleries', k: l1.k, by: 2, t: b.t }; turn(b, 1);
    ok(pulls(b) === 1, 'lever: its own pull coming back is not the other lever');
    b.labLever = { l: 'galleries', k: l0.k, by: 1, t: b.t }; turn(b, 0.5);
    ok(pulls(b) === 2, 'lever: the player turns theirs late: it turns its own again at once (inside the window)');
    labRun.portUp.galleries = 95; turn(b, 0.5);
    ok(!b.plan && b.said.at(-1) === 'Plan done, Natan.', 'lever: the gate is up: plan done');
    labRun.portUp.galleries = 0;
  }
  { // the player takes the lever the bot was walking to
    const b = inLab(); setPlan(b, [{ k: 'lever' }], { by: 1, byName: 'Natan' }, api); turn(b, 0.5);
    turn(b, 0.5); b.labLever = { l: 'galleries', k: l1.k, by: 1, t: b.t }; turn(b, 0.5);
    ok(b.cmd?.x === l0.x && b.cmd.z === l0.z && b.plan.st.lk === l0.k, 'lever: the player turned the one it was heading for: it takes the other');
    turn(b, 1); ok(pulls(b) === 1, 'lever: and turns it (it stands right there)');
  }
  { // two bots sent together take one each; a third has nothing to do; nobody is told to work one
    const pl = [{ id: 1, x: l0.x, z: l0.z }, { id: 2, x: l0.x + 1, z: l0.z }, { id: 3, x: l0.x + 1, z: l0.z }, { id: 5, x: l0.x + 1, z: l0.z }];
    const [a, b, c] = [2, 3, 5].map(id => { const q = inLab({ id, players: pl }); setPlan(q, [{ k: 'lever' }], { by: 1, byName: 'Natan', group: [2, 3, 5] }, api); turn(q, 0.5); return q; });
    ok(a.cmd?.x === l1.x && b.cmd?.x === l0.x && !c.plan, 'lever: of a group, the first takes the far lever, the second the near one, a third is done at once');
    turn(b, 1); ok(pulls(b) === 1 && !b.said.some(t => /Work yours/.test(t)), 'lever: two bots work both: the player is not asked to');
  }
  { // nobody comes: it gives up after its wait
    const b = inLab(); setPlan(b, [{ k: 'lever', n: 30 }], { by: 1, byName: 'Natan' }, api); turn(b, 0.5);
    b.x = l1.x; b.z = l1.z; turn(b, 20); ok(b.plan && pulls(b) === 1, 'lever: waiting');
    turn(b, 12); ok(!b.plan && b.said.at(-1) === 'Plan stopped: nobody worked the other bone lever.', `lever: nobody worked the other one in its time: the plan stops (${b.said.at(-1)})`);
  }
  { // the gate is already up; and a bot still upstairs catches up with its player first
    labRun.portUp.galleries = 95;
    const b = inLab(); setPlan(b, [{ k: 'lever' }, { k: 'wait', n: 5 }], { by: 1, byName: 'Natan' }, api); turn(b, 0.5);
    ok(b.plan?.i === 1 && !pulls(b), 'lever: the gate is already up: nothing to do, next step');
    labRun.portUp.galleries = 0;
    const u = stub({ players: [{ id: 1, x: l0.x, z: l0.z }, { id: 2, x: 0, z: 5 }] }); setPlan(u, [{ k: 'lever' }], { by: 1, byName: 'Natan' }, api); turn(u, 0.5);
    ok(u.plan && u.cmd?.k === 'come', 'lever: its player is down there and it is not: it comes first');
    u.x = l0.x + 1; u.z = l0.z; turn(u, 0.5);
    ok(u.cmd?.k === 'stay' && u.cmd.x === l1.x, 'lever: once down there it heads for its lever');
  }
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
  ok(b.plan && /\(step 1\/3: guard/.test(chats(b).at(-1)) && !/plan step/.test(chats(b).at(-1)), `status: keeps the plan and reports it once, in the goal (${chats(b).at(-1)})`);
  snap(b, [{ t: 'botcmd', by: 1, byName: 'Natan', party: 7, cmd: 'attack', tgt: 999 }]);
  ok(b.plan?.i === 0 && b.cmd?.guard, 'an order that cannot be carried out (attack, nothing locked) leaves the plan alone');
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
  snap(b, [{ t: 'hit', id: 81, by: 3 }, { t: 'die', id: 81, x: field[1][2], z: field[1][3], b: 0 }], { mobs: [field[0]] });
  ok(b.plan?.i === 1 && b.cmd?.k === 'stay', 'the wolf is hit and dies to us in one snapshot (already gone from it): one kill, next step');
  b.stop();
}

// the levers, by itself: the party's one player stands at a lever of the Drowning Galleries; Rook (not the healer) goes
// for the other one through the maze, turns it, and turns it again when the player's turns; the gate up ends it
{
  const GAL = LAYERS.find(L => L.id === 'galleries'), [l0, l1] = GAL.leverList;
  const labSnap = (b, { events = [], at1 = [l0.x, l0.z], up = 0, lyra = [l0.x + 1.5, l0.z] } = {}) => b.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs: [], gate: [0, 0, 0], events, lb: [b.t, [['galleries', up, [], 0, 0]]],
    players: [row(1, at1[0], at1[1], 100, 0, 7), row(2, lyra[0], lyra[1], 100, 2, 7), row(3, b.x, b.z, 100, 1, 7)] } });
  const pulls = b => b.ws.sent.filter(m => m.type === 'lab' && m.a === 'lever').length;
  const b = makeBot(), lyra = makeBot('Lyra', 2, 'cleric');
  for (const q of [b, lyra]) { q.x = l0.x + 2; q.z = l0.z + 1; }
  for (let i = 0; i < 20; i++) { labSnap(b); labSnap(lyra); }
  ok(!b.plan && !lyra.plan, 'levers: the player has only just stopped by a lever: nobody moves yet');
  for (let i = 0; i < 30; i++) { labSnap(b); labSnap(lyra); }
  ok(b.plan?.steps[0].k === 'lever' && b.cmd?.x === l1.x && chats(b).includes("I'll get the other bone lever, Natan.") && !lyra.plan, `levers: the player stays at one: Rook goes for the other by itself, the healer stays (${chats(b).at(-1)})`);
  ok(!portOpen(GAL) && labAt(b.x, b.z) === GAL, 'levers: the bot knows the gate is shut from the snapshot');
  let steps = 0; while (!pulls(b) && steps++ < 1200) labSnap(b);
  ok(pulls(b) === 1 && Math.hypot(b.x - l1.x, b.z - l1.z) < 3 && chats(b).includes('The bone lever here is turned. Work yours!'), `levers: it walked the maze to the other lever and turned it (${steps} snapshots, ${Math.hypot(b.x - l1.x, b.z - l1.z).toFixed(1)} m from it)`);
  labSnap(b, { events: [{ t: 'lab', s: 'lever', l: 'galleries', k: l1.k, d: 18, by: 3 }] }); for (let i = 0; i < 30; i++) labSnap(b);
  ok(pulls(b) === 1, 'levers: its own pull is not a reason to pull again');
  labSnap(b, { events: [{ t: 'lab', s: 'lever', l: 'galleries', k: l0.k, d: 18, by: 1 }] }); for (let i = 0; i < 20; i++) labSnap(b);
  ok(pulls(b) === 2, 'levers: the player turns theirs: it turns its own again at once');
  labSnap(b, { up: b.t + 45 }); labSnap(b, { up: b.t + 45 });
  ok(!b.plan && chats(b).at(-1) === 'Plan done, Natan.', 'levers: the gate is up: done, back to following');
  // two players down there work them together: no bot runs off
  const c = makeBot(); c.x = l0.x + 2; c.z = l0.z + 1;
  const two = q => q.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs: [], gate: [0, 0, 0], events: [], lb: [q.t, [['galleries', 0, [], 0, 0]]], players: [row(1, l0.x, l0.z, 100, 0, 7), row(4, l0.x + 3, l0.z, 100, 3, 7), row(3, q.x, q.z, 100, 1, 7)] } });
  for (let i = 0; i < 80; i++) two(c);
  ok(!c.plan, 'levers: two players in the party down there: the bots leave the levers to them');
  // an order comes first
  const d = makeBot(); d.x = l0.x + 2; d.z = l0.z + 1;
  labSnap(d, { events: [{ t: 'botcmd', by: 1, byName: 'Natan', party: 7, cmd: 'stay' }] }); for (let i = 0; i < 80; i++) labSnap(d);
  ok(!d.plan && d.cmd?.k === 'stay', 'levers: a bot told to stay stays');
  for (const q of [b, lyra, c, d]) q.stop();
  labRun.portUp.galleries = 0;
}

// ---------- 5. the AI mind ----------
let current = null;
registerBotHook('onEvent', (b, e) => current?.onEvent(b, e));
const chat = (id, from, text) => ({ t: 'chat', id, from, text, ch: 'p', party: 7 });
async function mindCase(reply, { mayOrder = null } = {}) {
  const cfg = readConfig({ AI_PROVIDER: 'mock', AI_ENABLED: '1', AI_THINK_S: '0', AI_BOT_MIN_GAP_S: '0.5' });
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
ok(J(sanitizeIntent({ say: 'ok', plan: [{ do: 'farm', what: 'boars', n: 5 }, { do: 'buy', what: 'sword', n: 1 }, { do: 'come', what: '', n: 0 }] }).plan) === J([{ k: 'farm', mob: 'boar', n: 5 }]) && J(sanitizeIntent({ plan: 'farm' }).plan) === '[]' && J(sanitizeIntent({}).plan) === '[]', 'sanitizeIntent: clean steps only, [] for anything else');
ok(/"plan"/.test(SYSTEM) && /cannot craft, gather, trade with players or buy anything but potions/.test(SYSTEM) && /sell \(walk to the merchant/.test(SYSTEM) && SYSTEM.includes('smith') && /\[\] lets it carry on/.test(SYSTEM) && !SYSTEM.includes('"""'), 'the prompt lists the steps, the places, what a bot cannot do, and that [] keeps a running plan');
{
  const { b, p } = await mindCase({ say: 'On it!', order: 'follow', stance: 'keep', focus: '', remember: '', plan: [{ do: 'farm', what: 'boar', n: 5 }, { do: 'goto', what: 'smith', n: 0 }, { do: 'craft', what: 'sword', n: 1 }] });
  snap(b);
  const c = chats(b);
  ok(p.calls.length === 1 && b.plan?.steps.length === 2 && b.plan.by === 1 && b.cmd?.k === 'farm' && b.cmd.mob === 'boar', 'a plan from the model becomes the bot\'s plan (the unknown step dropped; the order beside it ignored)');
  ok(c.indexOf('On it!') >= 0 && c.indexOf('On it!') < c.findIndex(t => t.startsWith('Plan: 1) 5 Forest Boars 2) go to the smith')), 'it says its own line, then the plan');
  const sum = summarize(b, { stance: 'balanced', focusId: 0, events: [], chat: [] }, { kind: 'tick' }, null, Date.now());
  ok(/Your plan \(from Natan\): 1\) 5 Forest Boars 2\) go to the smith and wait there\. Now at step 1\/2: 0\/5 Forest Boars\. It carries on by itself/.test(sum), 'the next prompt shows the plan and where it is');
  // the model repeats the running plan on a later line: it carries on, not from the start
  b.plan.st.kills = 3; const t0 = b.plan.t0, saidBefore = chats(b).filter(t => t.startsWith('Plan:')).length;
  await sleep(600); // (the gap between two calls for one bot)
  snap(b, [chat(1, 'Natan', 'Rook, how is it going?')]);
  for (let i = 0; i < 40 && p.calls.length < 2; i++) { await sleep(10); snap(b); }
  await sleep(20); snap(b);
  ok(p.calls.length === 2 && b.plan?.st?.kills === 3 && b.plan.t0 === t0 && chats(b).filter(t => t.startsWith('Plan:')).length === saidBefore, 'the same plan again from the model: the running one carries on (not restarted, not announced twice)');
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
const env = { ...process.env, PORT: String(PORT), DATABASE_URL: '', NAMED_ENABLED: '0', AI_PROVIDER: '', START_LEVEL: '6', TEST_HOOKS: '1' };
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
const stop = code => { try { srv.kill(); } catch {} process.exit(code); };
try {
  for (let i = 0; i < 150; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(200); } }
  const url = `ws://localhost:${PORT}/ws`;
  const h = { id: 0, events: [], sys: [], ws: new WebSocket(url), x: 0, z: 0, pl: new Map(), roster: [] };
  h.ws.on('open', () => h.ws.send(J({ type: 'join', name: 'Nat', cls: 'swordsman' })));
  h.ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.type === 'welcome') { h.id = m.id; h.x = m.x; h.z = m.z; }
    if (m.type === 'roster') h.roster = m.players;
    if (m.type === 'snap') h.pl = new Map(m.w.players.map(p => [p[0], { x: p[1], z: p[2], party: p[8] }]));
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
  // the merchant: Rook is given gold, buys a piece of armor by hand, then sells its bag and buys potions as a plan
  {
    const rook = team[0], armor = SHOP.findIndex(s => s.kind === 'gear' && s.slot === 'armor' && !s.town);
    rook.send({ type: 'test', gold: 400 });
    say('/b Rook: go merchant');
    ok(await until(() => !rook.plan && dist(rook, MERCHANT.x, MERCHANT.z) < MERCHANT.r + 1.4 && rook.gold >= 400, 40000), `live: Rook walked to the merchant with 400 gold (${dist(rook, MERCHANT.x, MERCHANT.z).toFixed(1)} m, ${rook.gold} gold)`);
    rook.send({ type: 'buy', i: armor });
    await until(() => spareGear(rook).length > 0, 3000);
    const had = spareGear(rook).length, pots = rook.cons?.potion || 0, gold = rook.gold, c0 = botChat().length;
    say('/b Rook: sell then buy 2 potions then come');
    const fin = await until(() => !rook.plan && botChat().slice(c0).some(t => /^Plan done, Nat\.$/.test(t)), 60000), lines = botChat().slice(c0);
    ok(had > 0 && fin && spareGear(rook).length === 0 && lines.some(t => new RegExp(`^Sold ${had} things? for \\d+ gold\\.$`).test(t)), `live: it sold its ${had} spare thing(s) (${J(lines)})`);
    ok((rook.cons?.potion || 0) === pots + 2 && lines.includes('Bought 2 potions.') && rook.gold !== gold && dist(rook, h.x, h.z) < 9, `live: bought two potions (${pots} -> ${rook.cons?.potion}), then came back (${gold} -> ${rook.gold} gold)`);
  }
  // a bot the player added (server-managed: it follows them and is pulled back when it falls 45 m behind)
  h.ws.send(J({ type: 'pbot', op: 'add', cls: 'guardian', name: 'Zed' }));
  const zid = () => h.roster.find(r => r.name === 'Zed')?.id, zed = () => h.pl.get(zid());
  ok(await until(() => zed()?.party && zed().party === h.pl.get(h.id)?.party, 15000), 'live: a bot the player added is in the party');
  const e0 = h.events.length, mine = t => h.events.slice(e0).filter(e => e.t === t && (e.id === zid() || e.by === zid()));
  say('/b Zed: say / / /b Rook: sit 30 then go field');
  ok(await until(() => mine('chat').some(e => e.text === 'b Rook: sit 30'), 6000) && !mine('botcmd').length && !team[0].plan && !h.events.slice(e0).some(e => e.t === 'pose' && e.id === team[0].id), `live: a say step is plain chat, never a slash command: no order reaches another bot (${J(mine('chat').map(e => e.text))})`);
  const fx = PLACES.field.x, fz = PLACES.field.z, far = () => { const p = zed(); return p ? Math.hypot(p.x - fx, p.z - fz) : 999; };
  ok(Math.hypot(h.x - fx, h.z - fz) > 50 && await until(() => far() < 4 && mine('chat').some(e => /^Plan done, Nat\. I'll wait here\.$/.test(e.text)), 60000), `live: it walked to the field, more than 45 m from its player (${far().toFixed(1)} m from the spot)`);
  await sleep(12000); // (two rounds of the server's catch-up for followers)
  ok(far() < 12 && !mine('tp').length, `live: and stays there: not pulled back to the player (${far().toFixed(1)} m, ${mine('tp').length} teleports)`);
  say('/b Zed: come');
  ok(await until(() => { const p = zed(); return p && Math.hypot(p.x - h.x, p.z - h.z) < 9; }, 40000), 'live: /b come brings it back');
  if (process.env.SHOW_CHAT) console.log(botChat(), mine('chat').map(e => e.text));
  for (const b of team) b.stop();
  // the levers of the Drowning Galleries, with a bot the server runs (it is pulled down the stairs after its player)
  {
    const GAL = LAYERS.find(L => L.id === 'galleries'), [l0, l1] = GAL.leverList;
    const me = () => h.pl.get(h.id), zd = (x, z) => { const p = zed(); return p ? Math.hypot(p.x - x, p.z - z) : 999; };
    const tp = (x, z) => h.ws.send(J({ type: 'test', life: { tp: [x, z] } })), pull = () => h.ws.send(J({ type: 'lab', a: 'lever' }));
    const port = from => h.events.slice(from).some(e => e.t === 'lab' && e.s === 'port' && e.l === 'galleries');
    const zsaid = (from, re) => h.events.slice(from).some(e => e.t === 'chat' && e.id === zid() && re.test(e.text));
    h.ws.send(J({ type: 'test', labgo: 'galleries' }));
    ok(await until(() => labAt(me()?.x, me()?.z) === GAL && labAt(zed()?.x, zed()?.z) === GAL, 20000), 'live: the player goes down into the Drowning Galleries and the bot is brought along');
    // by order: the player turns one lever and says /b lever
    let e1 = h.events.length;
    tp(l0.x, l0.z + 1); await sleep(400); pull(); say('/b lever');
    ok(await until(() => zsaid(e1, /^Plan: work the other lever\.$/), 4000), 'live: /b lever: the bot takes it');
    const there = await until(() => port(e1) || zsaid(e1, /here is turned\. Work yours!$/), 60000);
    if (!port(e1)) { await sleep(300); pull(); } // (it got there after the player's window: the player turns theirs again)
    ok(there && await until(() => port(e1), 5000) && zd(l1.x, l1.z) < 3.5, `live: it ran to the other lever and the two opened the gate (${zd(l1.x, l1.z).toFixed(1)} m from its lever)`);
    ok(await until(() => zsaid(e1, /^Plan done, Nat\.$/), 5000), 'live: plan done');
    // by itself: the gate has fallen again, the player just stands at the other lever
    tp(GAL.x0 + (GAL.start[0] + 0.5) * GAL.cell, GAL.z0 + (GAL.start[1] + 0.5) * GAL.cell); // (away from both levers while the gate falls)
    await sleep(47000);
    ok(!zsaid(e1, /I'll get the other/), 'live: away from the levers nobody runs off');
    e1 = h.events.length; tp(l1.x, l1.z + 1);
    ok(await until(() => zsaid(e1, /^I'll get the other bone lever, Nat\.$/), 25000), 'live: the player stands at a lever: the bot goes for the other one without being asked');
    const turned = await until(() => zsaid(e1, /here is turned\. Work yours!$/), 60000);
    pull();
    ok(turned && await until(() => port(e1), 5000) && zd(l0.x, l0.z) < 3.5, `live: it turned its lever, the player theirs: the gate is up (${zd(l0.x, l0.z).toFixed(1)} m from its lever)`);
    if (process.env.SHOW_CHAT) console.log(h.events.filter(e => e.t === 'chat' && e.id === zid()).map(e => e.text), h.sys.slice(-6));
  }
  h.ws.close();
} catch (err) { console.error(err); console.error(srvLog.slice(-2000)); failed++; }
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
stop(failed ? 1 : 0);
