// Skill chains (docs/briefs/combos-visuals.md A): link different moves one after another for a short damage bonus.
// Shared by the server (server/chains.js), the client (public/teamplay.js shows the counter) and the bots
// (shared/bots/teamplay.js chainTurn), and checked by test/chains.js.
//
// A *step* is one move: a slot 1-3 skill that lands a hit (or, for support skills that hit nothing, the moment it's used),
// or a basic-attack finisher that lands (the heavy press; for classes whose basic attack is never heavy, any basic hit).
// A step made within `window` s of the previous step's last hit *links*: the chain goes x2, x3, x4 (`max`). Every step in
// one chain must be a different move. While a chain is live (`hold` s after its last link) your hits deal
// 1 + step x (n - 1) more. A link that reaches x3 or more takes `refund` s off your other skills' cooldowns; x4 completes
// the chain (a posture chunk `doneFrac`), and the next move starts a new one. Links fill the Burst gauge (shared/teamplay.js
// BURST.fill: chain, chainDone).
// Named links (CHAIN_ARTS) add a posture chunk `frac` [normal/elite, boss] on their first hit and show their name.
import { CLASSES } from './data.js';

export const CHAIN = {
  window: 1.4, hold: 2.5, max: 4, step: 0.04, refund: 1, minGap: 0.15,
  doneFrac: [0.12, 0.03],
};

// Classes whose basic attack has no heavy press: any basic hit is their "finisher" step.
export const BASIC_ANY = new Set(['cleric', 'bard']);
// Skills that hit nothing by design: they count as a step when used.
export const SUPPORT = new Set(['wall', 'heal', 'bless', 'sanct', 'mark', 'anthem', 'bloodrage']);

// Named links per class: id -> { from, to, name, frac }. from / to: a skill id (its slot's base id) or 'fin'.
export const CHAIN_ARTS = {
  swordsman: {
    risingedge: { from: 'fin', to: 'rush', name: 'Rising Edge', frac: [0.12, 0.025] },
    cyclonecut: { from: 'rush', to: 'whirl', name: 'Cyclone Cut', frac: [0.1, 0.02] },
    stormburst: { from: 'whirl', to: 'burst', name: 'Storm Burst', frac: [0.14, 0.03] },
    flashstep: { from: 'burst', to: 'rush', name: 'Flash Step', frac: [0.08, 0.02] },
  },
  guardian: {
    bulwark: { from: 'fin', to: 'gslam', name: 'Bulwark Crash', frac: [0.14, 0.03] },
    ironroar: { from: 'gslam', to: 'taunt', name: 'Iron Roar', frac: [0.08, 0.02] },
    riposte: { from: 'wall', to: 'fin', name: 'Shield Riposte', frac: [0.1, 0.02] },
  },
  cleric: {
    prayer: { from: 'heal', to: 'fin', name: 'Answered Prayer', frac: [0.1, 0.02] },
    sacred: { from: 'bless', to: 'sanct', name: 'Sacred Ground', frac: null },
    judgement: { from: 'sanct', to: 'fin', name: 'Judgement', frac: [0.1, 0.02] },
  },
  ranger: {
    deadline: { from: 'fin', to: 'pierce', name: 'Deadline', frac: [0.12, 0.025] },
    parting: { from: 'disengage', to: 'pierce', name: 'Parting Shot', frac: [0.1, 0.02] },
    called: { from: 'mark', to: 'fin', name: 'Called Shot', frac: [0.1, 0.02] },
  },
  berserker: {
    skybreaker: { from: 'fin', to: 'leap', name: 'Skybreaker', frac: [0.12, 0.025] },
    rending: { from: 'leap', to: 'cleave', name: 'Rending Fall', frac: [0.14, 0.03] },
    redmist: { from: 'cleave', to: 'bloodrage', name: 'Red Mist', frac: null },
  },
  lancer: {
    piercing: { from: 'fin', to: 'lcharge', name: 'Piercing Line', frac: [0.1, 0.02] },
    wheel: { from: 'lcharge', to: 'lsweep', name: 'Wheel Charge', frac: [0.12, 0.025] },
    ladder: { from: 'lsweep', to: 'skylance', name: 'Sky Ladder', frac: [0.14, 0.03] },
  },
  bard: {
    sforzando: { from: 'fin', to: 'dissonance', name: 'Sforzando', frac: [0.1, 0.02] },
    counterpoint: { from: 'anthem', to: 'dissonance', name: 'Counterpoint', frac: [0.1, 0.02] },
    rising: { from: 'dissonance', to: 'crescendo', name: 'Rising Discord', frac: [0.12, 0.025] },
  },
};

// The step a hit makes: 'fin', a skill id, or null (not a step: a light basic press, a lingering zone / song tick).
// sk: the skill credited with the hit (opts.sk / opts.tsk / p._tsk); heavy: the hit's heavy flag.
export function stepOf(cls, sk, heavy) {
  if (!sk) return null;
  const basic = CLASSES[cls]?.skills[0]?.id;
  if (sk === basic) return heavy || BASIC_ANY.has(cls) ? 'fin' : null;
  return CLASSES[cls]?.skills.some(s => s.id === sk) ? sk : null;
}

// The named art for a link from -> to, or null: { id, name, frac }.
export function artFor(cls, from, to) {
  const A = CHAIN_ARTS[cls];
  if (!A) return null;
  for (const id in A) if (A[id].from === from && A[id].to === to) return { id, ...A[id] };
  return null;
}
export const artName = (cls, id) => CHAIN_ARTS[cls]?.[id]?.name || '';

// Pure chain state machine. c: the player's chain { k, at, last, n, used: [keys], done, bn, until } or null; a step `k`
// landing at time t. n counts the links of the chain being built; bn / until are the live bonus (kept when a new chain
// starts, so a bonus always runs its full `hold`). Returns { c: the new state, link: null | { n, art } }.
//  - the same move again (multi-hit, or pressed again) within the window: it just keeps the step open;
//  - within the window, a move not yet in this chain: a link; a move already in it (or one inside minGap): ignored;
//  - otherwise (no chain, lapsed or completed): a new chain starts with this move.
export function chainStep(c, cls, k, t) {
  if (!k) return { c, link: null };
  const inWin = c && t - c.last <= CHAIN.window + 1e-9;
  if (inWin && c.k === k) { c.last = t; return { c, link: null }; }
  if (inWin && !c.done) {
    if (c.used.includes(k) || t - c.at < CHAIN.minGap - 1e-9) return { c, link: null };
    const n = Math.min(CHAIN.max, c.n + 1), art = artFor(cls, c.k, k);
    c.used.push(k);
    Object.assign(c, { k, at: t, last: t, n, bn: n, until: t + CHAIN.hold, done: n >= CHAIN.max, endSent: false });
    return { c, link: { n, art } };
  }
  return { c: { k, at: t, last: t, n: 1, used: [k], done: false, bn: c?.bn || 0, until: c?.until || 0, endSent: c ? !!c.endSent : true }, link: null };
}
// The damage multiplier a live chain gives at time t.
export const chainMult = (c, t) => (c && c.bn >= 2 && t < c.until ? 1 + CHAIN.step * (c.bn - 1) : 1);
// A slot skill's hits count as its step only this long after it was pressed (zones, traps and mines that tick on later
// are not steps); basic finishers count whenever they land.
export const STEP_LAG = 2.5;

// Bots: the skills a class may press to keep its own chain going (slot, max distance to the target's edge), and the
// chance (by capability 1-5) it does so after a step. Healers, tanks (the Guardian's Slam is its Break) and utility skills
// are left to the class brains.
export const BOT_CHAIN = {
  chance: [0, 0.1, 0.25, 0.45, 0.65, 0.8],
  swordsman: [{ slot: 1, range: 6 }, { slot: 2, range: 3.5 }],
  ranger: [{ slot: 1, range: 18 }],
  berserker: [{ slot: 1, range: 3.5 }, { slot: 2, range: 10 }],
  lancer: [{ slot: 1, range: 8 }, { slot: 2, range: 3.5 }],
  bard: [{ slot: 2, range: 6 }],
};
