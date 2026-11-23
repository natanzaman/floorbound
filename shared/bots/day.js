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
//   company  help: a player in trouble within HELP_R is helped (an attack order on what is on them), then the day goes
//            on. group: it walks up to another free bot with a day (b.dayPeers, set by the server) and invites it;
//            a party of bots is a day group for a while: the leader's day goes on, the others are "out with" it, and
//            each leaves when it has had enough. ask along: before a hunt a sociable bot may ask the people around
//            ("Anyone for wolves?", at boss level "Anyone up for the Warden?"); it invites a player only after a yes
//            (dayChat), and asks any one player at most once in ASK_AGAIN seconds. No boss tries without a player
//   picker   b.dayPicker(b, ask) may answer for the scores (Jev, server/ai/daypick.js): it calls ask.done(id) or
//            leaves it; with no answer in PICK_WAIT seconds the top score is taken
//   unseen   nobody on this floor (f.quiet, from b.dayFloors): a day is played where someone can see it. Only the
//            goals that leave the floor's monster AI asleep are scored (rest and restock, both in town) plus travel:
//            a sociable bot heads for a floor where players are
//
// BOT_DAYS=0: `own` is `field` (today's game). Pure where it can be: facts, needs, scoreGoals, pickKind and planFor
// take a state and a random source, so tests replay them from a seed.
import { MOBS, PARTY_MAX, inTown, inArena } from '../data.js';
import { floorOf, floorUnlocked, inArena2 } from '../floor2.js';
import { inArena3 } from '../floor3.js';
import { CONSUMABLES } from '../items.js';
import { traitOf } from './personality.js';
import { PLACES, mobName } from './plan.js';
import { setPlan, endPlan, spareGear } from './planrun.js';
import { d2 } from './motor.js';

export const RESUME = 20;     // s after an order ends before the day goes on
export const PICK_WAIT = 0.4; // s a picker (Jev) has to answer
const RETHINK = 5;            // s between looks at a running goal (is something urgent?)
const LOG = 8;                // goals remembered
const HELP_R = 40;            // m: how far off a player in trouble is noticed
const HELP_SECS = 35;         // s: the longest one rescue lasts
const HELP_AGAIN = 45;        // s before the same player's trouble is weighed again
const PEER_R = 90;            // m: another free bot this close can be walked up to
const GROUP_REST = 300;       // s after a group (or a "no") before the next try
export const ASK_AGAIN = 1200; // s before the same player is asked along again
const ASK_OPEN = 25;          // s a question stays open for a yes
const BOSS_NAME = { 1: 'the Warden', 2: 'the Sovereign', 3: 'the Colossus' };
const inBossRoom = (x, z) => inArena(x, z) || inArena2(x, z) || inArena3(x, z);
const isBot = (b, id) => !!b.names?.get(id)?.bot || !!b.peers?.has(id); // (peers: bots started together that the server doesn't flag, as in the brain)
const nameOf = (b, id) => b.names?.get(id)?.name || 'you';
const pick = (rnd, list) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
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
  const mates = b.party ? (b.players || []).filter(p => p.id !== b.id && p.party === b.party) : [];
  return {
    free: peersNear(b).length, mates: mates.length, with: mates.map(p => nameOf(b, p.id)), sinceGroup: t - (d.groupT ?? -1e9),
    lvl, fl, hp: b.maxHp ? clamp(b.hp / b.maxHp) : 1,
    pots: b.cons ? b.cons.potion || 0 : null, // (null: not told yet)
    gold: b.gold || 0, spare: spareGear(b).length, bag: (b.bag || []).length,
    town: inTown(b.x, b.z),
    ...floorsFact(b, fl),
    sinceRest: t - (d.restT ?? d.t0 ?? t), sameFor: t - (d.sameT ?? t), alone: t - (d.seenT ?? d.t0 ?? t),
    deaths: d.deaths || 0, poor: d.poor ?? -99, people: near.length, humans: near.filter(p => !isBot(b, p.id)).length,
    last: d.log?.[0]?.g || '',
  };
}

// Where the people are: b.dayFloors(b) → the floors with a player on them (the server knows: server/botmanager.js).
// quiet: nobody is on our floor; toFl: a floor with people this bot may travel to (its own town counts as open).
// Without the hook (a bot out of the server's process, a test) nothing is quiet and every floor may be hunted.
function floorsFact(b, fl) {
  const fls = b.dayFloors?.(b);
  if (!Array.isArray(fls)) return { fls: null, quiet: false, toFl: 0 };
  const open = fls.filter(f => f !== fl && (f === 1 || floorUnlocked(b.life, f))).sort((a, c) => a - c);
  return { fls, quiet: !fls.includes(fl), toFl: open[0] || 0 };
}

// Other free bots with a day close enough to walk up to: same floor, alive, in no party, within five levels.
// b.dayPeers(b) → their player ids (the server knows who has a day: server/botmanager.js); without it, nobody.
export function peersNear(b) {
  const ids = b.dayPeers?.(b); if (!ids?.length) return [];
  const fl = floorOf(b.x), lvl = b.me?.lvl || 1;
  return (b.players || []).filter(p => p.id !== b.id && ids.includes(p.id) && !p.dead && !p.party && floorOf(p.x) === fl && Math.abs((p.lvl || 1) - lvl) <= 5 && d2(p.x, p.z, b.x, b.z) < PEER_R)
    .sort((a, c) => d2(a.x, a.z, b.x, b.z) - d2(c.x, c.z, b.x, b.z));
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
    score: (n, f, T) => clamp(0.42 + T('aggression') * 0.2 + (f.mates ? 0.15 : 0) - n.rest * 0.3 - (canShop(f) ? n.supplies * 0.5 : 0) - n.bag * 0.25),
    why: (n, f) => (f.mates ? 'better together' : f.pots === 0 && !canShop(f) ? 'no gold for potions' : f.lvl < (BOSS_LVL[f.fl] || 99) ? 'levelling up' : 'earning gold'),
  },
  restock: {
    name: 'Restocking', cool: 0.3,
    score: (n, f, T) => (canShop(f) ? clamp(Math.max(n.supplies, n.bag * 0.85) * (0.85 + T('caution') * 0.35)) : 0),
    why: (n, f) => (f.pots === 0 ? 'out of potions' : n.supplies >= n.bag * 0.85 ? 'low on potions' : 'bag is nearly full'),
  },
  rest: {
    name: 'Resting', cool: 0.25,
    score: (n, f, T) => clamp(Math.max(n.rest, f.quiet ? 0.5 : 0) * (0.7 + T('patience') * 0.5)),
    why: (n, f) => (f.quiet && n.rest < 0.5 ? 'nobody about' : f.deaths >= 2 ? 'that went badly' : 'been at it a while'),
  },
  travel: { // nobody on this floor: go where the players are (the camp there; the plan runner takes the waypoint)
    name: 'Travelling', cool: 0.2,
    score: (n, f, T) => (f.quiet && f.toFl ? clamp(0.4 + T('sociability') * 0.55) : 0),
    why: () => 'the floor is empty',
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
  group: { // walk up to another free bot and team up (never while following; a leader may fetch a third)
    name: 'Teaming up', cool: 0.2,
    score: (n, f, T) => (!f.free || f.mates >= 2 || f.sinceGroup < GROUP_REST ? 0 : clamp((0.14 + n.company * 0.7) * (0.35 + T('sociability') * 0.9) * (f.mates ? 0.5 : 1))),
    why: (n, f) => (f.mates ? 'room for one more' : 'hunting is better together'),
  },
};
export const GOAL_IDS = Object.keys(GOALS);
// With nobody on this floor, only these are scored: the others would wake the floor's monsters for an empty floor.
const QUIET_GOALS = ['rest', 'restock', 'travel'];

// Every goal scored, best first: [{ id, score, why }]. rnd: 0 to 1 (luck, 0.85 to 1.15 on each score).
export function scoreGoals(b, f, rnd = Math.random) {
  const n = needs(b, f), T = k => traitOf(b, k);
  return GOAL_IDS.map(id => {
    const G = GOALS[id];
    const s = (f.quiet && !QUIET_GOALS.includes(id) ? 0 : G.score(n, f, T)) * (0.85 + rnd() * 0.3) * (f.last === id ? G.cool : 1);
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
      const crew = f.with?.length ? ` with ${f.with.slice(0, 2).join(' and ')}` : '';
      return { kind, text: `Hunting ${mobName(kind, 2)}${crew}`, steps: [...(o.ask ? [{ k: 'wait', n: 8 }] : []), ...(fl !== f.fl ? [{ k: 'goto', place: campOf(fl) }] : []), { k: 'farm', mob: kind, n: Math.round(n * (1 + 0.4 * (f.mates || 0))) }] };
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
    case 'group': { // up to the nearest free bot, then a moment for its answer (the invite goes out on arrival: dayTurn)
      const c = peersNear(b)[0]; if (!c) return null;
      return { by: c.id, cand: c.id, text: `Teaming up with ${nameOf(b, c.id)}`, steps: [{ k: 'come' }, { k: 'wait', n: 7 }] };
    }
    case 'travel': {
      const fl = f.toFl; if (!fl) return null;
      return { text: `Heading for ${PLACES[campOf(fl)].name}`, steps: [{ k: 'goto', place: campOf(fl) }, { k: 'wait', n: between(rnd, 5, 20) }] };
    }
    case 'hangout':
      return { text: f.fl === 1 ? 'Hanging out by the well' : 'Hanging out in camp', steps: [{ k: 'goto', place: f.fl === 1 ? 'well' : 'camp' }, { k: 'wait', n: between(rnd, 60, 120 + T('sociability') * 120) }] };
  }
  return null;
}

// ---------- the day itself ----------
const fresh = b => ({ t0: b.t, goal: '', why: '', text: '', since: b.t, log: [], restT: b.t, sameT: b.t, seenT: b.t, deaths: 0, deadSeen: false, hold: 0, lookT: 0, sights: [], skip: [], kind: '', urgent: 0, pending: null, picked: 0, asked: 0,
  help: null, helpSeen: new Map(), helpT: 0, helped: 0, groupUntil: null, groupT: null, leftT: -9, lead: 0, cand: 0, inv: 0, ask: null, askedAt: new Map() });

// The goal is over (done, stopped, or dropped for an order): into the log.
function close(b, d, how = 'done') {
  if (!d.goal) return;
  d.log.unshift({ g: d.goal, why: d.why, text: d.text, at: Math.round(d.since), secs: Math.round(b.t - d.since), how });
  d.log.length = Math.min(d.log.length, LOG);
  if (d.goal === 'rest' && how === 'done') { d.restT = b.t; d.deaths = 0; }
  if (d.goal === 'restock' && b.cons) d.poor = (b.cons.potion || 0) < potionsShort(b) ? b.gold || 0 : null; // (still short: the gold wasn't enough)
  if (d.goal !== d.log[1]?.g) d.sameT = d.since; // (a different thing from the one before: the "same old" clock runs from its start)
  d.goal = ''; d.text = ''; d.why = ''; d.help = null; d.cand = 0; d.inv = 0; d.lead = 0;
}

// Take goal id: make its plan and start it. Returns false when it cannot be planned.
function begin(b, d, id, why, api, rnd) {
  const f = facts(b, d), ask = id === 'hunt' && askAlong(b, d, f, api, rnd);
  const made = planFor(id, b, f, rnd, { floors: b.dayFloors?.(b) || null, skip: d.skip, ask });
  if (!made || !setPlan(b, made.steps, { by: made.by || 0, adm: true, quiet: true, day: id }, api)) return false;
  Object.assign(d, { goal: id, why, text: made.text, since: b.t, urgent: 0, cand: made.cand || 0, inv: 0 });
  if (made.kind) d.kind = made.kind;
  if (made.sights) d.sights = [...made.sights, ...d.sights].slice(0, 6);
  if (ask) d.ask.kind = d.kind;
  return true;
}

// ----- help: a player in trouble nearby -----
// The player (not a bot, alive, on our floor, within HELP_R, outside a boss room) with the most on them, and the
// monster to take off them: { p, mob, low } or null. Trouble: under 45% health with a monster on them, or three on them.
export function inTrouble(b, only = 0) {
  const fl = floorOf(b.x), lvl = b.me?.lvl || 1;
  let best = null;
  for (const p of b.players || []) {
    if (p.id === b.id || p.dead || isBot(b, p.id) || (only && p.id !== only) || floorOf(p.x) !== fl || d2(p.x, p.z, b.x, b.z) > HELP_R || inBossRoom(p.x, p.z) || inTown(p.x, p.z)) continue;
    const on = (b.mobs || []).filter(m => m.engaged && !m.def.boss && !m.def.prop && !m.def.duel && !m.def.academy && !m.def.lab && (m.def.level || 1) <= lvl + 3 && d2(m.x, m.z, p.x, p.z) < m.def.radius + 4.5);
    const low = p.maxHp > 0 && p.hp / p.maxHp < 0.45;
    if (!on.length || !(low || on.length >= 3)) continue;
    const mob = on.sort((a, c) => d2(a.x, a.z, p.x, p.z) - d2(c.x, c.z, p.x, p.z))[0];
    if (!best || on.length > best.n) best = { p, mob, low, n: on.length };
  }
  return best;
}
const HELP_LINES = ['Hang on, {who}!', 'I\'ve got you, {who}.', 'Coming, {who}!', 'On my way, {who}.'];
const HELPED_LINES = ['There. You all right, {who}?', 'That\'s the last of them.', 'Careful out here, {who}.'];
const attack = (b, mob, api) => { api.command(b, { k: 'attack', tgt: mob.id, by: 0, adm: true, quiet: true }); if (b.cmd?.k === 'attack' && b.cmd.tgt === mob.id) { b.cmd.day = 1; b.cmd.prev = null; return true; } return false; };
// True while this bot is busy helping (the rest of the day waits).
function helpTurn(b, d, api, rnd) {
  const T = k => traitOf(b, k);
  if (d.goal === 'help') {
    if (b.cmd?.day && b.t < d.help.until) return true; // on it
    if (b.cmd?.day) b.cmd = null;
    const more = b.t < d.help.until ? inTrouble(b, d.help.pid) : null; // the next one on them
    if (more && attack(b, more.mob, api)) return true;
    const p = (b.players || []).find(q => q.id === d.help.pid);
    if (p && !p.dead && rnd() < 0.3 + T('chattiness') * 0.5) api.say?.(b, 'dayHelped', {}, { force: true, ch: 's', text: pick(rnd, HELPED_LINES).replace('{who}', nameOf(b, p.id)) });
    d.helped++;
    close(b, d, 'done');
    d.hold = b.t + 2 + rnd() * 3;
    return true;
  }
  if (b.t < d.helpT || d.goal === 'with') return false;
  d.helpT = b.t + 1.5;
  if (b.maxHp && b.hp / b.maxHp < 0.5) return false;
  if (d.goal === 'restock' && b.cons && !(b.cons.potion > 0)) return false; // no potions: not now
  const tr = inTrouble(b);
  if (!tr || b.t < (d.helpSeen.get(tr.p.id) || 0)) return false;
  d.helpSeen.set(tr.p.id, b.t + HELP_AGAIN); // weighed once per scrape
  if (rnd() > clamp(0.4 + T('sociability') * 0.5 - T('caution') * 0.35 + (tr.low ? 0.1 : 0))) return false;
  if (b.plan?.day) endPlan(b);
  close(b, d, 'cut short');
  if (!attack(b, tr.mob, api)) return false;
  Object.assign(d, { goal: 'help', text: `Helping ${nameOf(b, tr.p.id)}`, why: tr.low ? 'they were in trouble' : 'too many on them', since: b.t, help: { pid: tr.p.id, until: b.t + HELP_SECS }, pending: null });
  api.say?.(b, 'dayHelp', {}, { force: true, ch: 's', text: pick(rnd, HELP_LINES).replace('{who}', nameOf(b, tr.p.id)) });
  return true;
}

// ----- ask along: "Anyone for wolves?" -----
const ASK_LINES = ['Anyone for {what}?', 'Heading out for {what}. Room for one more.', 'Going after {what}. Anyone want in?'];
const BOSS_LINES = ['Anyone up for {what}?', 'I\'d try {what} if someone comes along.'];
const YES = /\b(yes|yeah|yep|yup|sure|ok|okay|me|i'?m in|count me in|let'?s go|coming|i'?ll come|why not)\b/i;
// Before a hunt: ask the players around (never one asked in the last ASK_AGAIN s). True when it asked: the hunt
// waits a few seconds for an answer. At the boss's level the question is about the boss.
function askAlong(b, d, f, api, rnd) {
  if (!f.humans || f.mates + 1 >= PARTY_MAX) return false;
  const fl = f.fl, near = (b.players || []).filter(p => p.id !== b.id && !p.dead && !isBot(b, p.id) && floorOf(p.x) === fl && d2(p.x, p.z, b.x, b.z) < 30);
  const fresh = near.filter(p => b.t - (d.askedAt.get(p.id) ?? -1e9) >= ASK_AGAIN);
  if (!fresh.length || fresh.length < near.length) return false; // (someone here heard it not long ago)
  const T = k => traitOf(b, k);
  if (rnd() > clamp((T('sociability') - 0.25) * 0.9 + T('chattiness') * 0.25)) return false;
  for (const p of fresh) d.askedAt.set(p.id, b.t);
  const boss = f.lvl >= (BOSS_LVL[fl] || 99) && rnd() < 0.3 + T('aggression') * 0.5 ? BOSS_NAME[fl] : '';
  d.ask = { until: b.t + ASK_OPEN, boss, kind: '', said: false };
  return true;
}
// A chat line (the brain's onChat): a yes from a player nearby to an open question gets the invite.
export function dayChat(b, e) {
  const d = b.day, a = d?.ask;
  if (!a || !a.said || b.t > a.until || e.id === b.id || isBot(b, e.id) || e.ch === 'p') return false;
  const p = (b.players || []).find(q => q.id === e.id);
  if (!p || p.dead || floorOf(p.x) !== floorOf(b.x) || d2(p.x, p.z, b.x, b.z) > 35) return false;
  const text = String(e.text || '');
  if (text.length > 40 || !YES.test(text)) return false;
  d.ask = null;
  b.send({ type: 'invite', id: p.id });
  d.invited = { id: p.id, at: b.t, boss: a.boss };
  return true;
}

// ----- a day group: a party of bots -----
const groupSecs = (b, rnd) => 420 + rnd() * 360 + traitOf(b, 'sociability') * 240;
const BYE_LINES = ['Good hunting, all. I\'m off.', 'That was fun. See you around.', 'I\'ll head off. Thanks for the company.'];
const JOIN_LINES = ['Want to team up, {who}?', '{who}, hunt together for a bit?', 'Room for one more, {who}?'];
// An invite from another bot (the brain's onInvite, for a bot with a day): join it?
export function dayInvite(b, e, rnd = Math.random) {
  const d = b.day; if (!d || b.party || b.dead) return false;
  const peers = b.dayPeers?.(b);
  if (peers && !peers.includes(e.from)) return false; // (only bots with a day of their own)
  if ((b.plan && !b.plan.day) || (b.cmd && !b.cmd.plan && !b.cmd.day)) return false; // on a player's order
  if (d.goal === 'help' || (d.goal === 'restock' && b.cons && !(b.cons.potion > 0)) || b.t - (d.groupT ?? -1e9) < GROUP_REST) return false;
  return rnd() < 0.5 + traitOf(b, 'sociability') * 0.45;
}

// Once per think turn, before the plan runner. P: the party view; api: { command, say } (as for plans).
// rnd: the luck (tests pass a seeded one).
export function dayTurn(b, P, api, rnd = Math.random) {
  if (!hasDay(b)) { if (b.day) { if (b.plan?.day) endPlan(b); if (b.cmd?.day) b.cmd = null; b.day = null; } return; }
  const d = (b.day ||= fresh(b));
  if (b.dead) return;
  d.deadSeen = false;
  if ((b.players || []).some(p => p.id !== b.id && !p.dead && d2(p.x, p.z, b.x, b.z) < 15)) d.seenT = b.t; // company
  const mine = !!b.plan?.day, helping = !!b.cmd?.day;
  // not ours to choose: in a party with a player, somebody's plan or order, a raid
  if (P.humans.length > 0 || (b.plan && !mine) || (!b.plan && b.cmd && !helping)) {
    if (mine) endPlan(b);
    if (helping) b.cmd = null;
    if (d.invited && P.humans.some(h => h.id === d.invited.id)) { // the player we asked along came
      if (d.invited.boss) api.say?.(b, 'dayAsk', {}, { force: true, ch: 'p', text: `Lead on to ${d.invited.boss} when you're ready.` });
      d.invited = null;
    }
    close(b, d, 'order'); d.pending = null; d.ask = null;
    d.hold = b.t + RESUME;
    return;
  }
  if (d.ask && !d.ask.said && b.t - d.since > 0.5) { // the question, once the hunt is set
    d.ask.said = true;
    const what = d.ask.boss || mobName(d.ask.kind || d.kind || 'boar', 2).toLowerCase();
    api.say?.(b, 'dayAsk', {}, { force: true, ch: 's', text: pick(rnd, d.ask.boss ? BOSS_LINES : ASK_LINES).replace('{what}', what) });
  }
  if (d.ask && b.t > d.ask.until) d.ask = null;
  // a party of bots: a day group. The leader's day goes on; the others are out with it; each leaves in its own time
  if (b.party && P.mates.length && b.t - d.leftT > 2) {
    d.groupUntil ??= b.t + groupSecs(b, rnd);
    const lead = P.botLeader && P.botLeader.id !== b.id ? P.botLeader : null;
    if (b.t > d.groupUntil && !b.tgtId && !helping) {
      if (mine) endPlan(b);
      api.say?.(b, 'dayBye', {}, { force: true, ch: 'p', text: pick(rnd, BYE_LINES) });
      b.send({ type: 'leave' });
      close(b, d, 'done');
      Object.assign(d, { groupUntil: null, groupT: b.t, leftT: b.t, pending: null, hold: b.t + 2 + rnd() * 3 });
      return;
    }
    if (lead) {
      if (mine) endPlan(b);
      if (d.goal !== 'with' || d.lead !== lead.id) { close(b, d, d.goal === 'group' ? 'done' : 'joined'); Object.assign(d, { goal: 'with', lead: lead.id, text: `Out with ${lead.name || nameOf(b, lead.id)}`, why: 'better together', since: b.t }); }
      d.pending = null;
      return;
    }
  } else if (!b.party && d.groupUntil != null) { d.groupUntil = null; d.groupT = b.t; } // the group broke up
  if (d.goal === 'with') { close(b, d, 'done'); d.hold = b.t + 1 + rnd() * 3; }
  if (helpTurn(b, d, api, rnd)) return;
  if (mine) { // a goal is running: is something more urgent?
    if (d.goal === 'group') { // by the other bot's side (the wait step): the invite, once
      if (b.plan.i >= 1 && !d.inv && d.cand) {
        d.inv = d.cand;
        api.say?.(b, 'dayGroup', {}, { force: true, ch: 's', text: pick(rnd, JOIN_LINES).replace('{who}', nameOf(b, d.cand)) });
        b.send({ type: 'invite', id: d.cand });
      }
      return;
    }
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
    const alone = d.goal === 'group' && !P.mates.length;
    if (alone) d.groupT = b.t; // nobody came: not again for a while
    close(b, d, stopped ? 'stopped' : alone ? 'no luck' : 'done');
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
