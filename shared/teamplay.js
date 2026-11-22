// Team combat (docs/ROADMAP.md G2): skill combos between players and the Team Burst gauge.
// Data and pure helpers shared by the server (server/teamplay.js), the client (public/teamplay.js), the bots
// (shared/bots/teamplay.js) and test/teamplay.js. Skill ids are each slot's base id (an evolved skill keeps its slot's id).
import { CLASSES } from './data.js';

// window: seconds a setup stays open for a payoff by a DIFFERENT player; chain: seconds between two combos on the same
// target that keep its chain counter going ("Combo x2"); again: seconds before the same combo can land on the same target again;
// self: a self-combo (your own setup, your own payoff) gives this share of the combo's bonus (damage, posture, root, stun).
export const COMBO = { window: 2.5, chain: 6, again: 6, self: 0.6 };

// Hits that count as ranged (any Ranger hit is ranged too).
export const RANGED = new Set(['smite', 'sonic', 'dissonance']);

// Setups: something a player does to a target that opens a combo on it. `hit`: rules matched against each hit
// (cls, sk: skill ids, fin: a heavy basic attack (combo finisher), heavy, stun, interrupt: it interrupted a wind-up,
// melee: not a ranged hit, ownMark: the hitter's own Hunter's Mark is on it: a Ranger's heavy arrow (every third Shot,
// Piercing Shot) on its marked target re-opens the Pin). Hunter's Mark itself (no damage) opens 'mark' from
// server/teamplay.js (markA). `call`: what a bot shouts when it opens one for a partner (shared/bots/teamplay.js).
// Every class opens one setup, and every pair of classes has at least one combo (test/teamplay.js checks it).
export const SETUPS = {
  launch: { name: 'Launched', call: 'Launching! Shoot it!', hit: [{ cls: 'lancer', sk: ['skylance', 'lsweep'] }] },
  stun: { name: 'Stunned', call: 'Stunned! Hit it hard!', hit: [{ cls: 'guardian', sk: ['gslam'] }, { cls: 'guardian', fin: true }] },
  mark: { name: 'Marked', call: 'Marked! Pin it!', hit: [{ cls: 'ranger', ownMark: true, heavy: true }] },
  stagger: { name: 'Staggered', call: 'Staggered! Cut across!', hit: [{ cls: 'swordsman', sk: ['rush'] }] },
  grounded: { name: 'Grounded', call: 'Grounded! Slam it!', hit: [{ cls: 'berserker', sk: ['leap'] }] },
  judged: { name: 'Judged', call: 'Judged! Strike now!', hit: [{ cls: 'cleric', sk: ['smite'], interrupt: true }] },
  offbeat: { name: 'Off-beat', call: 'Off-beat! Hit the downbeat!', hit: [{ cls: 'bard', sk: ['dissonance'] }] },
};

// Combos. on: 'hit' (a payoff hit on an open setup), 'break' (any Break by someone other than the Bard who stacked
// Discord), 'switch' (a Switch made under a Cleric's Sanctuary or Blessing).
//   pay: rules for a partner's payoff hit; self: rules for the setter's own payoff hit (a self-combo, at COMBO.self strength);
//   mult: payoff-hit damage x; crit: the payoff hit always crits; frac: extra posture [normal/elite, boss] (fraction of max);
//   root: seconds the target can't move (a boss: slowed); heal: party heal (fraction of max HP) around the target;
//   burst: the Bard's damage burst (x its attack); extend: seconds added to the Broken (Switch) window.
export const COMBOS = {
  skewer: { name: 'Skewer', on: 'hit', setup: 'launch', pay: [{ ranged: true }], self: [{ cls: 'lancer', sk: ['lthrust', 'lcharge'] }], mult: 1.25, frac: [0.25, 0.05],
    tip: 'Skewer: a Lancer launched it (Sky Lance / Sweep). Hit it with a ranged attack within 2.5 s.' },
  execute: { name: 'Execute', on: 'hit', setup: 'stun', mult: 1.1, crit: true, frac: [0.3, 0.05],
    pay: [{ cls: 'berserker', heavy: true }, { cls: 'swordsman', sk: ['burst'] }, { cls: 'lancer', fin: true }, { cls: 'ranger', heavy: true }],
    self: [{ cls: 'guardian', fin: true }, { cls: 'guardian', sk: ['taunt'] }],
    tip: 'Execute: a Guardian stunned it (Ground Slam / Bash finisher). A Berserker heavy, Swordsman Burst Combo, Lancer Thrust finisher or Ranger heavy arrow within 2.5 s always crits.' },
  pin: { name: 'Pin', on: 'hit', setup: 'mark', mult: 1.1, root: 1.5, frac: [0.15, 0.03],
    pay: [{ cls: 'lancer', sk: ['lcharge', 'lthrust'] }, { cls: 'swordsman', sk: ['rush'] }, { cls: 'berserker', sk: ['leap'] }],
    self: [{ cls: 'ranger', sk: ['pierce'] }],
    tip: 'Pin: a Ranger marked it. Hit it with a Lancer Thrust / Charge, a Swordsman Rush or a Berserker Leap Slam within 2.5 s to root it.' },
  crosscut: { name: 'Cross Cut', on: 'hit', setup: 'stagger', mult: 1.2, frac: [0.22, 0.045],
    pay: [{ cls: 'berserker', sk: ['cleave'] }, { cls: 'berserker', fin: true }, { cls: 'lancer', sk: ['lthrust', 'lcharge'] }],
    self: [{ cls: 'swordsman', fin: true }, { cls: 'swordsman', sk: ['whirl'] }],
    tip: 'Cross Cut: a Swordsman Rushed through it. A Berserker Cleave / heavy chop or a Lancer Thrust / Charge within 2.5 s cuts across it.' },
  aftershock: { name: 'Aftershock', on: 'hit', setup: 'grounded', mult: 1.15, frac: [0.28, 0.05], stunAdd: 0.6,
    pay: [{ cls: 'guardian', sk: ['gslam'] }, { cls: 'guardian', fin: true }, { cls: 'swordsman', sk: ['whirl'] }, { cls: 'lancer', sk: ['skylance'] }],
    self: [{ cls: 'berserker', sk: ['cleave'] }, { cls: 'berserker', fin: true }],
    tip: 'Aftershock: a Berserker Leap Slammed it. A Guardian Ground Slam / Bash finisher, a Swordsman Whirl or a Lancer Sky Lance within 2.5 s stuns it again.' },
  verdict: { name: 'Verdict', on: 'hit', setup: 'judged', mult: 1.15, crit: true, frac: [0.2, 0.04],
    pay: [{ heavy: true, melee: true }],
    self: [{ cls: 'cleric', sk: ['smite'] }],
    tip: 'Verdict: a Cleric\'s Smite interrupted it. Any heavy melee hit within 2.5 s always crits.' },
  downbeat: { name: 'Downbeat', on: 'hit', setup: 'offbeat', mult: 1.2, frac: [0.2, 0.04], discord: 1,
    pay: [{ cls: 'ranger', heavy: true }, { cls: 'swordsman', sk: ['rush'] }, { cls: 'lancer', sk: ['skylance'] }],
    self: [{ cls: 'bard', sk: ['sonic'] }],
    tip: 'Downbeat: a Bard hit it with Dissonance. A Ranger heavy arrow, a Swordsman Rush or a Lancer Sky Lance within 2.5 s lands on the beat (and adds Discord).' },
  chorus: { name: 'Shatter Chorus', on: 'break', discord: 3, heal: 0.1, healR: 12, burst: 1.5,
    tip: 'Shatter Chorus: Break an enemy carrying 3+ Discord stacks from a Bard: the party heals and the chord bursts.' },
  sanctified: { name: 'Sanctified Switch', on: 'switch', extend: 1.5,
    tip: 'Sanctified Switch: Switch while standing in a Cleric\'s Sanctuary or under their Blessing: the Broken window lasts longer.' },
};
export const COMBO_IDS = Object.keys(COMBOS);

// Team Burst: a shared party gauge (solo players have their own). fill: points per team stat (server teamStat keys);
// solo gauges fill at soloFill, big parties a little slower (x sqrt(3 / size) from 4 members). drain: points/s once nobody
// in the team has fought for `idle` s.
// When full, any member presses T: a `sync` s window; every member who presses T in it joins (it fires early once every
// living member is in). Power by joiners: power[n] (1 = solo). The finisher deals per x each joiner's attack x power,
// BREAKs the target (n >= 2; solo: a posture chunk) and gives the team +dmg for buffD s.
export const BURST = {
  max: 100,
  fill: { combo: 8, switch: 5, break: 4, parry: 4, revive: 15, save: 8, cover: 4, mechanic: 5, perfect: 2, chain: 0.5, chainDone: 2 },
  soloFill: 0.5, drain: 4, idle: 6, sync: 3, range: 40,
  power: [0, 0.6, 1, 1.2, 1.35, 1.45, 1.55],
  per: 4, soloFrac: [0.5, 0.18], buff: [0, 0.08, 0.12, 0.14, 0.16, 0.17, 0.18], buffD: 6, buffR: 20, targetR: 14,
  traitMul: 0.6, // in a group, each distinct class's trait at this strength (solo: full)
};

// Class traits in the finisher (server/teamplay.js burstTraits): every distinct class among the joiners adds its own.
//   blades: extra hits (n x per x attack each) · aegis: a shield on the team (fraction of max HP, s) · radiance: heals the
//   team (fraction of max HP) · volley: damage to other enemies within r of the target (x per x attack) · fury: the
//   finisher's damage x · impale: root (s; a boss is slowed) · resonance: s off the team's skill cooldowns.
export const BURST_TRAITS = {
  swordsman: { k: 'blades', hits: 3, per: 0.35 },
  guardian: { k: 'aegis', shield: 0.15, d: 6 },
  cleric: { k: 'radiance', heal: 0.15 },
  ranger: { k: 'volley', r: 9, per: 1.2 },
  berserker: { k: 'fury', mult: 1.25 },
  lancer: { k: 'impale', root: 2 },
  bard: { k: 'resonance', cd: 2.5 },
};
// The finisher's name: by its first two classes (the starter's, then the first other class that joined), or one class alone.
export const BURST_NAMES = {
  swordsman: 'Blade Tempest', guardian: 'Aegis Crash', cleric: 'Radiant Verdict', ranger: 'Hail of Arrows',
  berserker: 'Red Rampage', lancer: 'Hundred Spears', bard: 'Grand Resonance',
  'bard+berserker': 'War Song', 'bard+cleric': 'Hymn of Dawn', 'bard+guardian': 'Anthem of Iron', 'bard+lancer': 'Spear Waltz',
  'bard+ranger': 'Singing Arrows', 'bard+swordsman': 'Blade Ballad', 'berserker+cleric': 'Holy Fury',
  'berserker+guardian': 'Iron Avalanche', 'berserker+lancer': 'Skyfall Rampage', 'berserker+ranger': 'Savage Volley',
  'berserker+swordsman': 'Twin Fang', 'cleric+guardian': 'Sanctum Wall', 'cleric+lancer': 'Lance of Light',
  'cleric+ranger': 'Arrows of Dawn', 'cleric+swordsman': 'Dawnblade', 'guardian+lancer': 'Phalanx',
  'guardian+ranger': 'Fortress Volley', 'guardian+swordsman': 'Shield and Sword', 'lancer+ranger': 'Rain of Spears',
  'lancer+swordsman': 'Crossed Steel', 'ranger+swordsman': 'Arrow Dance',
};
// The distinct classes among the joiners (starter first) and the pair id ('a+b', sorted; one class alone: its id).
export function burstFlavor(classes) {
  const cls = [];
  for (const c of classes) if (c && !cls.includes(c)) cls.push(c);
  const pk = cls.length >= 2 ? [cls[0], cls[1]].sort().join('+') : cls[0] || '';
  return { cls, pk, name: BURST_NAMES[pk] || 'Team Burst' };
}
export const burstPower = n => BURST.power[Math.max(0, Math.min(BURST.power.length - 1, n | 0))];
export const burstBuff = n => BURST.buff[Math.max(0, Math.min(BURST.buff.length - 1, n | 0))];

// ---------- matching (pure) ----------
// h: what a hit was { cls, sk, fin, heavy, stun, ranged, ownMark }.
export function ruleMatch(r, h) {
  if (r.cls && r.cls !== h.cls) return false;
  if (r.sk && !r.sk.includes(h.sk)) return false;
  if (r.fin && !h.fin) return false;
  if (r.heavy && !h.heavy) return false;
  if (r.stun && !h.stun) return false;
  if (r.ranged && !h.ranged) return false;
  if (r.ownMark && !h.ownMark) return false;
  if (r.interrupt && !h.interrupt) return false;
  if (r.melee && h.ranged) return false;
  return true;
}
// Setup keys this hit opens.
export function setupsOf(h) { return Object.keys(SETUPS).filter(k => SETUPS[k].hit.some(r => ruleMatch(r, h))); }
// Describe a hit. sk: the skill that made it (the basic attack's id for basic attacks; null for lingering effects:
// zones, songs, reflects).
export function hitInfo(cls, sk, { heavy = false, stun = 0, ownMark = false, interrupt = false } = {}) {
  const basic = CLASSES[cls]?.skills[0]?.id;
  sk = sk || null;
  return { cls, sk, fin: !!sk && sk === basic && !!heavy, heavy: !!heavy, stun: !!stun, ranged: cls === 'ranger' || RANGED.has(sk), ownMark: !!ownMark, interrupt: !!interrupt };
}
// The 'hit' combo this hit pays off: open setups { key: { by, at } } at time t, hitter pid; last: { combo id: time it
// last landed on this target }. Returns { id, def, setup, self } or null (self: the setter's own payoff, a self-combo).
// A partner's payoff is looked for first.
export function payoffFor(setups, h, pid, t, last = null) {
  if (!setups) return null;
  let own = null;
  for (const id of COMBO_IDS) {
    const c = COMBOS[id];
    if (c.on !== 'hit' || !comboReady(last, id, t)) continue;
    const s = setups[c.setup];
    if (!s || t - s.at > COMBO.window + 1e-9) continue;
    if (s.by !== pid) { if (c.pay.some(r => ruleMatch(r, h))) return { id, def: c, setup: s, self: false }; }
    else if (!own && c.self?.some(r => ruleMatch(r, h)) && t - s.at > 0.05) own = { id, def: c, setup: s, self: true }; // (not the very hit that opened it)
  }
  return own;
}
// A combo's numbers for a self-combo: the bonus part scaled by COMBO.self (mult 1.25 -> 1.15, posture, root, stun).
export function selfScaled(c) {
  const k = COMBO.self;
  return { ...c, mult: c.mult ? 1 + (c.mult - 1) * k : c.mult, frac: c.frac?.map(v => v * k) || null, root: c.root ? c.root * k : 0,
    stunAdd: c.stunAdd ? c.stunAdd * k : 0, crit: false, discord: c.discord && c.on === 'hit' ? 0 : c.discord };
}
export const comboReady = (last, id, t) => !last || !(t - (last[id] ?? -1e9) < COMBO.again - 1e-9);
export const burstFillScale = size => (size <= 3 ? 1 : Math.sqrt(3 / size));
// Can a class (in principle) pay off this combo? (client hints, bots)
export function canPay(cls, id) {
  const c = COMBOS[id];
  if (!c || c.on !== 'hit') return false;
  return c.pay.some(r => (!r.cls || r.cls === cls) && (!r.ranged || cls === 'ranger' || CLASSES[cls]?.skills.some(s => RANGED.has(s.id)))
    && (!r.melee || cls !== 'ranger'));
}
// The setup a class opens (one each), or null.
export const setupOfClass = cls => Object.keys(SETUPS).find(k => SETUPS[k].hit.some(r => r.cls === cls)) || null;
// Combos a setup key opens.
export const combosOf = setup => COMBO_IDS.filter(id => COMBOS[id].setup === setup);

// Chain counter on a target: { n, at } -> the next one.
export function nextChain(ch, t) { return ch && t - ch.at <= COMBO.chain + 1e-9 ? { n: ch.n + 1, at: t } : { n: 1, at: t }; }

// Bots: the skill a class presses to pay a setup off (slot, max distance to the target's edge). Absent = its normal
// play pays it off anyway (a Ranger's arrows, a Berserker's heavy chops).
export const BOT_PAYOFF = {
  lancer: { mark: { slot: 1, range: 8 }, stagger: { slot: 1, range: 8 }, offbeat: { slot: 3, range: 6 }, grounded: { slot: 3, range: 6 } },
  swordsman: { stun: { slot: 3, range: 3 }, mark: { slot: 1, range: 7 }, grounded: { slot: 2, range: 3.5 }, offbeat: { slot: 1, range: 7 } },
  berserker: { stun: { slot: 2, range: 9 }, mark: { slot: 2, range: 9 }, stagger: { slot: 1, range: 3.5 } },
  guardian: { grounded: { slot: 3, range: 4 } },
  ranger: { launch: { slot: 0, range: 18 }, stun: { slot: 1, range: 18 }, offbeat: { slot: 1, range: 18 } },
  cleric: { launch: { slot: 0, range: 9 } },
  bard: { launch: { slot: 0, range: 10 } },
};
// Bots: the skill a class presses to OPEN its setup for a partner (slot, max distance to the target's edge). The Cleric's
// Judged needs a wind-up to interrupt: its normal play (Smite on wind-ups) opens it.
export const BOT_SETUP = {
  lancer: { k: 'launch', slot: 2, range: 3.5 },
  guardian: { k: 'stun', slot: 3, range: 4 },
  ranger: { k: 'mark', slot: 3, range: 20 },
  swordsman: { k: 'stagger', slot: 1, range: 7 },
  berserker: { k: 'grounded', slot: 2, range: 10 },
  bard: { k: 'offbeat', slot: 2, range: 6 },
};
// Bots: chance to notice a partner's setup / join a Team Burst window, and the delay before pressing, by capability 1-5.
export const BOT_TEAM = {
  notice: [0, 0.15, 0.35, 0.6, 0.85, 1],
  join: [0, 0.35, 0.55, 0.75, 0.92, 1],
  joinDelay: [[0, 0], [1.2, 2.8], [0.8, 2], [0.5, 1.4], [0.3, 0.8], [0.15, 0.4]],
  startWait: 5, // s a full gauge waits for a human in the party to start it
  setup: [0, 0.1, 0.25, 0.45, 0.65, 0.8], // chance (rolled every `setupEvery` s) to open a setup for a partner who can pay it
  setupEvery: 2, payerNear: 7, payerNearRanged: 22,
  callEvery: 14, setmeCall: 4, setme: 30, // s between call-outs (Set me up: shorter); how long a Set me up order lasts
};
