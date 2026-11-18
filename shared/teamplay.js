// Team combat (docs/ROADMAP.md G2): skill combos between players and the Team Burst gauge.
// Data and pure helpers shared by the server (server/teamplay.js), the client (public/teamplay.js), the bots
// (shared/bots/teamplay.js) and test/teamplay.js. Skill ids are each slot's base id (an evolved skill keeps its slot's id).
import { CLASSES } from './data.js';

// window: seconds a setup stays open for a payoff by a DIFFERENT player; chain: seconds between two combos on the same
// target that keep its chain counter going ("Combo x2"); again: seconds before the same combo can land on the same target again.
export const COMBO = { window: 2.5, chain: 6, again: 6 };

// Hits that count as ranged (any Ranger hit is ranged too).
export const RANGED = new Set(['smite', 'sonic', 'dissonance']);

// Setups: something a player does to a target that opens a combo on it. `hit`: rules matched against each hit
// (cls, sk: skill ids, fin: a heavy basic attack (combo finisher), heavy, stun, ownMark: the hitter's own Hunter's Mark is on it:
// a Ranger's heavy arrow (every third Shot, Piercing Shot) on its marked target re-opens the Pin).
// Hunter's Mark itself (no damage) opens 'mark' from server/teamplay.js (markA).
export const SETUPS = {
  launch: { name: 'Launched', hit: [{ cls: 'lancer', sk: ['skylance', 'lsweep'] }] },
  stun: { name: 'Stunned', hit: [{ cls: 'guardian', sk: ['gslam'] }, { cls: 'guardian', fin: true }] },
  mark: { name: 'Marked', hit: [{ cls: 'ranger', ownMark: true, heavy: true }] },
};

// Combos. on: 'hit' (a payoff hit on an open setup), 'break' (any Break by someone other than the Bard who stacked
// Discord), 'switch' (a Switch made under a Cleric's Sanctuary or Blessing).
//   mult: payoff-hit damage x; crit: the payoff hit always crits; frac: extra posture [normal/elite, boss] (fraction of max);
//   root: seconds the target can't move (a boss: slowed); heal: party heal (fraction of max HP) around the target;
//   burst: the Bard's damage burst (x its attack); extend: seconds added to the Broken (Switch) window.
export const COMBOS = {
  skewer: { name: 'Skewer', on: 'hit', setup: 'launch', pay: [{ ranged: true }], mult: 1.25, frac: [0.25, 0.05],
    tip: 'Skewer: a Lancer launched it (Sky Lance / Sweep). Hit it with a ranged attack within 2.5 s.' },
  execute: { name: 'Execute', on: 'hit', setup: 'stun', pay: [{ cls: 'berserker', heavy: true }, { cls: 'swordsman', sk: ['burst'] }], mult: 1.1, crit: true, frac: [0.3, 0.05],
    tip: 'Execute: a Guardian stunned it (Ground Slam / Bash finisher). A Berserker heavy or Swordsman Burst Combo within 2.5 s always crits.' },
  pin: { name: 'Pin', on: 'hit', setup: 'mark', pay: [{ cls: 'lancer', sk: ['lcharge', 'lthrust'] }], mult: 1.1, root: 1.5, frac: [0.15, 0.03],
    tip: 'Pin: a Ranger marked it. Hit it with a Lancer Thrust or Lance Charge within 2.5 s to root it.' },
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
  fill: { combo: 8, switch: 5, break: 4, parry: 4, revive: 15, save: 8, cover: 4, mechanic: 5, perfect: 2 },
  soloFill: 0.5, drain: 4, idle: 6, sync: 3, range: 40,
  power: [0, 0.6, 1, 1.2, 1.35, 1.45, 1.55],
  per: 4, soloFrac: [0.5, 0.18], buff: [0, 0.08, 0.12, 0.14, 0.16, 0.17, 0.18], buffD: 6, buffR: 20, targetR: 14,
};
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
  return true;
}
// Setup keys this hit opens.
export function setupsOf(h) { return Object.keys(SETUPS).filter(k => SETUPS[k].hit.some(r => ruleMatch(r, h))); }
// Describe a hit. sk: the skill that made it (the basic attack's id for basic attacks; null for lingering effects:
// zones, songs, reflects).
export function hitInfo(cls, sk, { heavy = false, stun = 0, ownMark = false } = {}) {
  const basic = CLASSES[cls]?.skills[0]?.id;
  sk = sk || null;
  return { cls, sk, fin: !!sk && sk === basic && !!heavy, heavy: !!heavy, stun: !!stun, ranged: cls === 'ranger' || RANGED.has(sk), ownMark: !!ownMark };
}
// The 'hit' combo this hit pays off: open setups { key: { by, at } } at time t, hitter pid; last: { combo id: time it
// last landed on this target }. Returns { id, def, setup } or null.
export function payoffFor(setups, h, pid, t, last = null) {
  if (!setups) return null;
  for (const id of COMBO_IDS) {
    const c = COMBOS[id];
    if (c.on !== 'hit' || !comboReady(last, id, t)) continue;
    const s = setups[c.setup];
    if (!s || s.by === pid || t - s.at > COMBO.window + 1e-9) continue;
    if (c.pay.some(r => ruleMatch(r, h))) return { id, def: c, setup: s };
  }
  return null;
}
export const comboReady = (last, id, t) => !last || !(t - (last[id] ?? -1e9) < COMBO.again - 1e-9);
export const burstFillScale = size => (size <= 3 ? 1 : Math.sqrt(3 / size));
// Can a class (in principle) pay off this combo? (client hints, bots)
export function canPay(cls, id) {
  const c = COMBOS[id];
  if (!c || c.on !== 'hit') return false;
  return c.pay.some(r => (!r.cls || r.cls === cls) && (!r.ranged || cls === 'ranger' || CLASSES[cls]?.skills.some(s => RANGED.has(s.id))));
}
// Combos a setup key opens.
export const combosOf = setup => COMBO_IDS.filter(id => COMBOS[id].setup === setup);

// Chain counter on a target: { n, at } -> the next one.
export function nextChain(ch, t) { return ch && t - ch.at <= COMBO.chain + 1e-9 ? { n: ch.n + 1, at: t } : { n: 1, at: t }; }

// Bots: the skill a class presses to pay a setup off (slot, max distance to the target's edge). Absent = its normal
// play pays it off anyway (a Ranger's arrows, a Berserker's heavy chops).
export const BOT_PAYOFF = {
  lancer: { mark: { slot: 1, range: 8 } },
  swordsman: { stun: { slot: 3, range: 3 } },
  berserker: { stun: { slot: 2, range: 9 } },
  ranger: { launch: { slot: 0, range: 18 } },
  cleric: { launch: { slot: 0, range: 9 } },
  bard: { launch: { slot: 0, range: 10 } },
};
// Bots: chance to notice a partner's setup / join a Team Burst window, and the delay before pressing, by capability 1-5.
export const BOT_TEAM = {
  notice: [0, 0.15, 0.35, 0.6, 0.85, 1],
  join: [0, 0.35, 0.55, 0.75, 0.92, 1],
  joinDelay: [[0, 0], [1.2, 2.8], [0.8, 2], [0.5, 1.4], [0.3, 0.8], [0.15, 0.4]],
  startWait: 5, // s a full gauge waits for a human in the party to start it
};
