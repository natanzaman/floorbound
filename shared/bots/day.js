// A bot's day (docs/briefs/bot-days.md, phase B of "bots that feel like real players"): a free bot with the behaviour
// `own` picks its own next thing from what it needs and who it is, and carries it out as a plan.
//
//   needs    supplies, bag, rest, change, company, ambition: 0 to 1, read from the bot's own state (facts)
//   goals    hunt, restock, rest, wander, hangout (GOALS): each scores need x how much this bot cares (its traits,
//            shared/bots/personality.js) x a little luck, less a cool-down for what it just did (scoreGoals)
//   plan     the pick becomes a plan from the plan step menu (planFor → setPlan, marked `day`): the plan runner does
//            the work, quietly; b.day keeps the goal, why, since when, and the last eight goals (the bot's card, the
//            admin page, the AI mind's prompt, `/b <name>: status`)
//   wins     an order or a plan from a player, a town raid, a party with a human in it: the day waits, and picks up
//            RESUME seconds after the order ends
//   picker   b.dayPicker(b, ask) may answer for the scores (Jev, server/ai/daypick.js): it calls ask.done(id) or
//            leaves it; with no answer in PICK_WAIT seconds the top score is taken
//
// BOT_DAYS=0: `own` is `field` (today's game). Pure where it can be: facts, needs, scoreGoals, pickKind and planFor
// take a state and a random source, so tests replay them from a seed.
import { MOBS, inTown } from '../data.js';
import { floorOf, floorUnlocked } from '../floor2.js';
import { CONSUMABLES } from '../items.js';
import { traitOf } from './personality.js';
import { PLACES, mobName } from './plan.js';
import { setPlan, endPlan, spareGear } from './planrun.js';
import { d2 } from './motor.js';

export const RESUME = 20;     // s after an order ends before the day goes on
export const PICK_WAIT = 0.4; // s a picker (Jev) has to answer
const RETHINK = 5;            // s between looks at a running goal (is something urgent?)
const LOG = 8;                // goals remembered
const BOSS_LVL = { 1: 5, 2: 15, 3: 25 };
const clamp = v => Math.max(0, Math.min(1, v));

export function daysEnabled() {
  try { return typeof process === 'undefined' || !/^(0|false|off|no)$/i.test(String(process.env?.BOT_DAYS ?? '')); } catch { return true; }
}
// Does this bot have a day of its own? (its behaviour: the Named and a director's actors never get `own`)
export const hasDay = b => b?.behaviour === 'own' && !b.script && daysEnabled();

// ---------- what the bot knows about itself ----------
// d: b.day. Everything a score needs, as plain numbers (also what a picker is told).
export function facts(b, d = b.day || {}) {
  const fl = floorOf(b.x), lvl = b.me?.lvl || 1, t = b.t;
  const near = (b.players || []).filter(p => p.id !== b.id && !p.dead && floorOf(p.x) === fl && d2(p.x, p.z, b.x, b.z) < 30);
  return {
    lvl, fl, hp: b.maxHp ? clamp(b.hp / b.maxHp) : 1,
    pots: b.cons ? b.cons.potion || 0 : null, // (null: not told yet)
    gold: b.gold || 0, spare: spareGear(b).length, bag: (b.bag || []).length,
    town: inTown(b.x, b.z),
    sinceRest: t - (d.restT ?? d.t0 ?? t), sameFor: t - (d.sameT ?? t), alone: t - (d.seenT ?? d.t0 ?? t),
    deaths: d.deaths || 0, poor: d.poor ?? -99, people: near.length, humans: near.filter(p => !(b.names?.get(p.id)?.bot)).length,
    last: d.log?.[0]?.g || '',
  };
}

// How many potions this bot likes to carry (3 to 6), and when it feels short (2 or 3).
export const potionsWanted = b => 3 + Math.round(traitOf(b, 'caution') * 3);
const potionsShort = b => 2 + (traitOf(b, 'caution') > 0.6 ? 1 : 0);
// Worth a trip to the merchant? Gold for a potion (and more than the last time it came away empty-handed), or gear to sell.
const canShop = f => (f.gold >= CONSUMABLES.potion.price && f.gold > f.poor + 5) || f.spare > 0;

// The six needs, 0 to 1.
export function needs(b, f) {
  const T = k => traitOf(b, k), short = potionsShort(b);
  return {
    supplies: f.pots == null ? 0 : f.pots >= short ? 0 : clamp((short - f.pots) / short + (f.pots === 0 ? 0.25 : 0)),
    bag: clamp((f.bag / 24 - 0.5) / 0.35),
    rest: clamp(f.sinceRest / (540 + T('patience') * 720) + f.deaths * 0.3),
    change: clamp(f.sameFor / (300 + (1 - T('curiosity')) * 600)),
    company: clamp(f.alone / (240 + (1 - T('sociability')) * 900)),
    ambition: f.lvl >= (BOSS_LVL[f.fl] || 99) ? 0.4 + T('aggression') * 0.4 : 0,
  };
}

// ---------- the goals ----------
// score(n, f, T): 0 to about 1 from the needs n, the facts f and the traits T(k). why(n, f): a few words for the card.
export const GOALS = {
  hunt: {
    name: 'Hunting', cool: 0.9,
    score: (n, f, T) => clamp(0.42 + T('aggression') * 0.2 - n.rest * 0.3 - (canShop(f) ? n.supplies * 0.5 : 0) - n.bag * 0.25),
    why: (n, f) => (f.pots === 0 && !canShop(f) ? 'no gold for potions' : f.lvl < (BOSS_LVL[f.fl] || 99) ? 'levelling up' : 'earning gold'),
  },
  restock: {
    name: 'Restocking', cool: 0.3,
    score: (n, f, T) => (canShop(f) ? clamp(Math.max(n.supplies, n.bag * 0.85) * (0.85 + T('caution') * 0.35)) : 0),
    why: (n, f) => (f.pots === 0 ? 'out of potions' : n.supplies >= n.bag * 0.85 ? 'low on potions' : 'bag is nearly full'),
  },
  rest: {
    name: 'Resting', cool: 0.25,
    score: (n, f, T) => clamp(n.rest * (0.7 + T('patience') * 0.5)),
    why: (n, f) => (f.deaths >= 2 ? 'that went badly' : 'been at it a while'),
  },
  wander: {
    name: 'Looking around', cool: 0.5,
    score: (n, f, T) => clamp(n.change * (0.45 + T('curiosity') * 0.8)),
    why: () => 'wants a change',
  },
  hangout: {
    name: 'Hanging out', cool: 0.4,
    score: (n, f, T) => clamp(n.company * (0.45 + T('sociability') * 0.8) * (f.people || f.town ? 1 : 0.7)),
    why: (n, f) => (f.humans ? 'people are about' : 'wants company'),
  },
};
export const GOAL_IDS = Object.keys(GOALS);

// Every goal scored, best first: [{ id, score, why }]. rnd: 0 to 1 (luck, 0.85 to 1.15 on each score).
export function scoreGoals(b, f, rnd = Math.random) {
  const n = needs(b, f), T = k => traitOf(b, k);
  return GOAL_IDS.map(id => {
    const G = GOALS[id];
    const s = G.score(n, f, T) * (0.85 + rnd() * 0.3) * (f.last === id ? G.cool : 1);
    return { id, score: Math.round(s * 1000) / 1000, why: G.why(n, f) };
  }).sort((a, c) => c.score - a.score || a.id.localeCompare(c.id));
}

// ---------- from a goal to a plan ----------
const HUNTABLE = Object.entries(MOBS).filter(([id, d]) => !d.boss && !d.prop && !d.duel && !d.academy && !d.lab && !d.elite && !d.rare && id !== 'hound' && id !== 'thrall')
  .map(([id, d]) => ({ id, lvl: d.level || 1, fl: d.f3 ? 3 : d.f2 ? 2 : 1 }));
// A monster kind that fits: on a floor open to the bot (floors: which ones it may use, default all), at or under its
// level + 1, nearest its level first; its own floor counts double, a kind it just failed to find never.
export function pickKind(b, f, rnd = Math.random, { floors = null, skip = [] } = {}) {
  const ok = HUNTABLE.filter(k => k.lvl <= f.lvl + 1 && !skip.includes(k.id) && (k.fl === f.fl || floorUnlocked(b.life, k.fl)) && (!floors || floors.includes(k.fl)));
  if (!ok.length) return HUNTABLE.find(k => k.fl === f.fl && !skip.includes(k.id))?.id || 'boar';
  const w = ok.map(k => (1 / (1 + (Math.max(0, f.lvl - k.lvl) * 0.5) ** 2)) * (k.fl === f.fl ? 2 : 1) * (k.id === b.day?.kind ? 0.5 + (1 - traitOf(b, 'curiosity')) * 0.6 : 1));
  let r = rnd() * w.reduce((a, c) => a + c, 0);
  for (let i = 0; i < ok.length; i++) { r -= w[i]; if (r <= 0) return ok[i].id; }
  return ok[ok.length - 1].id;
}
const kindFloor = id => HUNTABLE.find(k => k.id === id)?.fl || 1;
const campOf = fl => (fl === 3 ? 'camp3' : fl === 2 ? 'camp2' : 'well');
const SIGHTS = ['smith', 'hall', 'academy', 'garden', 'gate', 'fire', 'bench', 'registrar', 'lifehall', 'field', 'merchant'];
const between = (rnd, lo, hi) => Math.round(lo + rnd() * (hi - lo));

// The steps for a goal: { steps, text (what the card says), kind? }. o: { floors, skip } for pickKind.
export function planFor(id, b, f, rnd = Math.random, o = {}) {
  const T = k => traitOf(b, k);
  switch (id) {
    case 'hunt': {
      const kind = pickKind(b, f, rnd, o), n = between(rnd, 10, 18 + T('aggression') * 10), fl = kindFloor(kind);
      return { kind, text: `Hunting ${mobName(kind, 2)}`, steps: [...(fl !== f.fl ? [{ k: 'goto', place: campOf(fl) }] : []), { k: 'farm', mob: kind, n }] };
    }
    case 'restock': {
      const want = Math.max(1, potionsWanted(b) - (f.pots || 0));
      return { text: 'Restocking at the merchant', steps: [{ k: 'sell' }, ...(f.pots == null || f.pots < potionsWanted(b) ? [{ k: 'buy', n: Math.min(10, want) }] : []), { k: 'wait', n: between(rnd, 3, 9) }] };
    }
    case 'rest': {
      const place = f.fl === 1 ? (rnd() < 0.35 ? 'fire' : 'well') : 'camp', secs = between(rnd, 60, 150 + T('patience') * 90);
      return { text: `Resting ${f.fl === 1 ? `by ${PLACES[place].name}` : 'in camp'}`, steps: [{ k: 'goto', place }, { k: 'wait', n: between(rnd, 2, 5) }, { k: 'emote', pose: 'sit', n: secs }] };
    }
    case 'wander': {
      if (f.fl !== 1) return { text: 'Looking around camp', steps: [{ k: 'goto', place: 'camp' }, { k: 'wait', n: between(rnd, 20, 50) }] };
      const seen = b.day?.sights || [], fresh = SIGHTS.filter(s => !seen.includes(s)), list = fresh.length ? fresh : SIGHTS;
      const a = list[Math.floor(rnd() * list.length)], rest = list.filter(s => s !== a), two = T('curiosity') > 0.55 && rest.length && rnd() < 0.6 ? rest[Math.floor(rnd() * rest.length)] : '';
      const stop = p => [{ k: 'goto', place: p }, { k: 'wait', n: between(rnd, 12, 40) }];
      return { sights: two ? [a, two] : [a], text: `Looking around (${PLACES[a].name})`, steps: [...stop(a), ...(two ? stop(two) : [])] };
    }
    case 'hangout':
      return { text: f.fl === 1 ? 'Hanging out by the well' : 'Hanging out in camp', steps: [{ k: 'goto', place: f.fl === 1 ? 'well' : 'camp' }, { k: 'wait', n: between(rnd, 60, 120 + T('sociability') * 120) }] };
  }
  return null;
}

// ---------- the day itself ----------
const fresh = b => ({ t0: b.t, goal: '', why: '', text: '', since: b.t, log: [], restT: b.t, sameT: b.t, seenT: b.t, deaths: 0, deadSeen: false, hold: 0, lookT: 0, sights: [], skip: [], kind: '', urgent: 0, pending: null, picked: 0, asked: 0 });

// The goal is over (done, stopped, or dropped for an order): into the log.
function close(b, d, how = 'done') {
  if (!d.goal) return;
  d.log.unshift({ g: d.goal, why: d.why, text: d.text, at: Math.round(d.since), secs: Math.round(b.t - d.since), how });
  d.log.length = Math.min(d.log.length, LOG);
  if (d.goal === 'rest' && how === 'done') { d.restT = b.t; d.deaths = 0; }
  if (d.goal === 'restock' && b.cons) d.poor = (b.cons.potion || 0) < potionsShort(b) ? b.gold || 0 : null; // (still short: the gold wasn't enough)
  if (d.goal !== d.log[1]?.g) d.sameT = d.since; // (a different thing from the one before: the "same old" clock runs from its start)
  d.goal = ''; d.text = ''; d.why = '';
}

// Take goal id: make its plan and start it. Returns false when it cannot be planned.
function begin(b, d, id, why, api, rnd) {
  const f = facts(b, d), made = planFor(id, b, f, rnd, { floors: b.dayFloors?.(b) || null, skip: d.skip });
  if (!made || !setPlan(b, made.steps, { by: 0, quiet: true, day: id }, api)) return false;
  Object.assign(d, { goal: id, why, text: made.text, since: b.t, urgent: 0 });
  if (made.kind) d.kind = made.kind;
  if (made.sights) d.sights = [...made.sights, ...d.sights].slice(0, 6);
  return true;
}

// Once per think turn, before the plan runner. P: the party view; api: { command, say } (as for plans).
// rnd: the luck (tests pass a seeded one).
export function dayTurn(b, P, api, rnd = Math.random) {
  if (!hasDay(b)) { if (b.day) { if (b.plan?.day) endPlan(b); b.day = null; } return; }
  const d = (b.day ||= fresh(b));
  if (b.dead) return;
  d.deadSeen = false;
  if ((b.players || []).some(p => p.id !== b.id && !p.dead && d2(p.x, p.z, b.x, b.z) < 15)) d.seenT = b.t; // company
  const mine = !!b.plan?.day;
  // not ours to choose: in a party with a player, following another bot's lead, somebody's plan or order, a raid
  const led = P.humans.length > 0 || (!!b.party && P.botLeader && P.botLeader.id !== b.id);
  if (led || (b.plan && !mine) || (!b.plan && b.cmd)) {
    if (mine) endPlan(b);
    close(b, d, 'order'); d.pending = null;
    d.hold = b.t + RESUME;
    return;
  }
  if (mine) { // a goal is running: is something more urgent?
    if (b.cmd?.defend || d.goal !== 'hunt') return;
    if (b.t >= d.lookT) { // out of potions with the means to buy some: back to town once this fight is over
      d.lookT = b.t + RETHINK;
      const f = facts(b, d);
      d.urgent = f.pots === 0 && canShop(f) ? d.urgent || b.t : 0;
    }
    if (d.urgent && (!b.tgtId || b.t - d.urgent > 25)) { d.urgent = 0; endPlan(b); close(b, d, 'cut short'); begin(b, d, 'restock', 'out of potions', api, rnd); }
    return;
  }
  // no plan: the goal ended (or never started)
  if (d.goal) {
    const stopped = b.dayStop; b.dayStop = null;
    if (stopped && d.goal === 'hunt' && d.kind) d.skip = [d.kind, ...d.skip].slice(0, 4); // (none of that kind about: another next time)
    close(b, d, stopped ? 'stopped' : 'done');
    d.hold = Math.max(d.hold, b.t + 1 + rnd() * 3); // a breath between two things
  }
  if (b.t < d.hold || b.tgtId) return;
  if (!d.pending) {
    const f = facts(b, d), scores = scoreGoals(b, f, rnd);
    d.pending = { at: b.t, scores, pick: '' };
    const ask = { facts: f, scores, done: id => { if (d.pending?.scores === scores && scores.some(s => s.id === id)) d.pending.pick = id; } };
    if (b.dayPicker?.(b, ask)) d.asked++; else d.pending.at = -1; // (nobody to ask: the scores decide now)
  }
  const p = d.pending;
  if (!p.pick && p.at >= 0 && b.t - p.at < PICK_WAIT) return; // the picker has a moment yet
  d.pending = null;
  if (p.pick) d.picked++;
  for (const s of [...(p.pick ? [p.scores.find(s => s.id === p.pick)] : []), ...p.scores]) if (s.score > 0 || s.id === p.pick) { if (begin(b, d, s.id, s.why, api, rnd)) return; }
  begin(b, d, 'hunt', 'nothing better to do', api, rnd);
}

// The bot died: a bad day wants a rest sooner (the brain calls this; a dead bot's turn stops before dayTurn).
export function dayDied(b) { const d = b.day; if (d && !d.deadSeen) { d.deadSeen = true; d.deaths++; } }

// ---------- words ----------
const ago = s => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
// "Restocking at the merchant: out of potions" (the bot's card, its goal on the admin page), or ''.
export function dayText(b) {
  const d = b?.day;
  return d?.goal ? `${d.text}: ${d.why}` : '';
}
// The last few goals, newest first: "Hunting Forest Boars (6 min), Resting by the well (2 min)".
export function dayLog(b, n = 4) {
  return (b?.day?.log || []).slice(0, n).map(e => `${e.text} (${ago(e.secs)}${e.how === 'done' ? '' : `, ${e.how}`})`).join(', ');
}
