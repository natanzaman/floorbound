// Boss timing tables (docs/ROADMAP.md J3): every timing of the Horned Warden, the Drowned Sovereign and the Storm
// Colossus lives here, so a boss is tuned by changing numbers and re-running bots (scripts/tuneboss.js), not by
// rewriting AI code. Values are the designed (unpaced) numbers; buildTiming() paces them (shared/pace.js) and applies
// the knobs. The old per-boss tables are built from these: WARDEN and SWEEP (shared/data.js), SOVEREIGN
// (shared/floor2.js), COLOSSUS (shared/floor3.js), each boss's BOSSTEAM rotation (shared/bossteam.js), its RESCUE trap
// (shared/rescue.js) and ARENAS.colossus.timing (shared/arenas.js), so the server keeps reading the names it knows.
// This file imports only shared/pace.js, so every shared table can import it.
//
// Per boss:
//   knobs      damageMul windupMul gapMul pauseMul cooldownMul (all 1 = the designed numbers), and `party`: optional
//              overrides by fighter count, { [n]: { knob: v } }; the entry for the largest n <= the party size applies.
//   pace       the abilities whose wind-ups are x PACE (their `every` grows by the extra wind-up: shared/pace.js).
//   abilities  per ability (the keys the server reads, plus what describes it):
//                wind     the wind-up (telegraph) in s; `channel` for Overload
//                active   s the hit stays live after the wind-up (0: instant; a wavefront: max range / speed)
//                mult     damage x the boss's attack (frac / clap / dot / boom: x the victim's max HP)
//                shape    'wedge' 'circle' 'line' 'cone' 'ring' 'beam' 'room' 'zone' 'summon' 'trap', with its sizes
//                         in the old keys (r, len, width, half, w, max, ...)
//                avoid    { by: ['roll' 'jump' 'block' 'parry' 'outrange' 'none'], at }: at = the moment to be safe at:
//                         'land' (the end of the wind-up), 'front' (the wavefront passing you), 'sweep' (the beam
//                         passing you), 'zone' (while you stand in it). safeWindow() gives it in s.
//                posture  posture the move puts on the boss itself (x its max; 0: none). Counters (perfect dodge, parry)
//                         use the global POSTURE chunks (shared/data.js).
//                every    cooldown: s between two uses (one per phase; 0 = not in that phase), from the wind-up start
//                cd       the basic swing's cooldown (MOBS atkCd); rage: x cd in the last phase
//                first    s from the engage (or from the phase it joins) to its first use
//                after    { state, pause }: what the boss does for `pause` s after the hit (busy, no new attack):
//                         'idle' 'walk' 'planted' 'stunned' 'exposed'
//              Entries with `table` live outside the boss's move table (SWEEP, the RESCUE trap).
//   phases     per phase: `order` (the abilities on their own timers, checked each tick in this order), `seqs`,
//              sequences { steps, gaps (s between steps), pause (s after), state (the after state, default 'exposed'),
//              w (weight) }. A one-step sequence is an ability on its own timer (`every`). Sequences with more steps are
//              combos (server/openings.js): `every` s apart (`first` s into the phase), one picked by weight; each step
//              starts `gap` s after the previous one ended, and after the last the boss holds its `state` for `pause` s
//              (the main melee opening). None run during a director show.
//   close      no point-blank chaining: { gap, moves, hold }: a close-range / all-around move (`moves`, the basic swing
//              included) never starts within `gap` s of the last one landing; hold: the basic swing waits while the
//              boss's own telegraphed area move is winding up (it favours those over instant swings). Off in a show.
//   team       the G4 team mechanics / J1 trap rotation (shared/bossteam.js): every (per phase), first, moves per phase.
//   transition the J2 fall to the next area (shared/arenas.js), Colossus only.
import { paceMoves } from './pace.js';

export const KNOB_KEYS = ['damageMul', 'windupMul', 'gapMul', 'pauseMul', 'cooldownMul'];
const KNOBS = () => ({ damageMul: 1, windupMul: 1, gapMul: 1, pauseMul: 1, cooldownMul: 1, party: {} });
const DAMAGE_KEYS = ['mult', 'frac', 'clap', 'dot', 'boom'];
const WINDUP_KEYS = ['wind', 'channel'];
const COOLDOWN_KEYS = ['every', 'cd'];

const idle = (pause = 0) => ({ state: 'idle', pause });
const AVOID = (by, at = 'land') => ({ by, at });
const ALL = ['roll', 'jump', 'block', 'parry', 'outrange']; // a ground hit: anything works
const HIT = ['roll', 'block', 'parry', 'outrange'];         // not a ground hit: jumping doesn't help
// Today's selection: every ability on its own timer, one-step sequences of weight 1 (J3 part 2 replaces them).
const solo = order => ({ order, seqs: order.map(k => ({ steps: [k], gaps: [], pause: 0, w: 1 })) });
// A phase: today's timer rotation plus combos ({ steps, gaps, pause, state, w }), one every `every` s, first after `first`.
const phase = (order, every, first, ...combos) => { const P = solo(order); P.seqs.push(...combos.map(c => ({ state: 'exposed', w: 1, ...c }))); return combos.length ? { ...P, every, first } : P; };

export const BOSS_TIMING = {
  // The Horned Warden (Floor 1): server/game.js bossSpecials, server/combat.js (Horn Sweep, Quake Ring), server/twists.js.
  warden: {
    knobs: KNOBS(),
    pace: ['slam', 'charge', 'cleave', 'spin', 'rock', 'quake', 'sweep'],
    abilities: {
      cleave: { wind: 0.75, active: 0, mult: 1, cd: 2.0, rage: 0.7, shape: 'wedge', avoid: AVOID(HIT), posture: 0, after: idle() }, // its basic axe swing
      // one slam circle per `per` fighters (on different ones)
      slam: { every: [6.5, 5, 3.75], first: 5, r: 5.5, wind: 1.6, active: 0, mult: 3.0, per: 3, shape: 'circle', avoid: AVOID(ALL), posture: 0, after: idle() },
      // the lane, then it barrels down it in `steps` hops of `step` s (x PACE: active = 3 x 0.13)
      charge: { every: 9.5, first: 5, len: 15, width: 2.4, wind: 1.5, active: 0.39, step: 0.1, steps: 3, mult: 3.0, shape: 'line', avoid: AVOID(HIT), posture: 0, after: idle(0.45) },
      hounds: { every: 24, first: 1.5, n: 2, max: 3, shape: 'summon', avoid: AVOID(['none']), posture: 0, after: idle() },
      spin: { every: 8, first: 3, r: 8, wind: 1.85, active: 0, mult: 2.2, shape: 'circle', avoid: AVOID(ALL), posture: 0, after: idle() },
      rock: { every: 6, first: 6, r: 3.2, wind: 1.6, active: 0, extra: 3, mult: 2.3, shape: 'circle', avoid: AVOID(HIT), posture: 0, after: idle() },
      // Quake Ring: rings per phase, `gap` s apart; `w`: half-thickness of the wavefront (m); speed in m/s; first per phase.
      quake: { every: [15, 12, 9.5], first: [9, 5, 4], wind: 2.0, active: 15 / 9, speed: 9, w: 0.55, max: 15, mult: 2.7, rings: [1, 2, 3], gap: 0.95, shape: 'ring', avoid: AVOID(['jump', 'roll', 'outrange'], 'front'), posture: 0, after: idle(0.35) },
      // The perilous Horn Sweep: dodge (i-frames) or parry it. jitter: [min factor, span] on each repeat.
      sweep: { table: 'SWEEP', r: 9, wind: 1.2, active: 0, frac: 0.8, every: [12.5, 9.5, 7.5], first: 9, jitter: [0.85, 0.3], shape: 'circle', avoid: AVOID(['roll', 'parry', 'outrange']), posture: 0, after: idle(0.35) },
      // J1 trap (shared/rescue.js RESCUE.vines): root + dot x max HP every tick, up to `max` s
      vines: { table: 'RESCUE', name: 'Thornbind', wind: 1.4, hits: 3, max: 14, tick: 0.5, dot: 0.018, hold: 1.5, reach: 2.6, leash: 3.6, shape: 'trap', avoid: AVOID(['none']), posture: 0, after: idle() },
    },
    // combos: a slam and a Quake Ring, then it stands exposed; later a charge or the spin leads in. J3 part 3 (scripts/
    // tuneboss.js): openings 3-3.5 s (were 2.5-3), close-range moves 1.5 s apart (were 1)
    phases: [
      phase(['cleave', 'slam', 'quake', 'sweep'], 16, 11, { steps: ['slam', 'quake'], gaps: [0.4], pause: 3.5 }),
      phase(['cleave', 'slam', 'quake', 'sweep', 'hounds', 'charge'], 15, 7, { steps: ['slam', 'quake'], gaps: [0.4], pause: 3.5 }, { steps: ['charge', 'slam'], gaps: [0.3], pause: 3 }),
      phase(['cleave', 'slam', 'quake', 'sweep', 'hounds', 'charge', 'spin', 'rock'], 13, 6, { steps: ['spin', 'slam', 'quake'], gaps: [0.3, 0.4], pause: 3.5 }, { steps: ['charge', 'spin'], gaps: [0.3], pause: 3 }),
    ],
    close: { gap: 1.5, moves: ['cleave', 'spin', 'sweep'], hold: true },
    team: { every: [26, 22, 18], first: 16, moves: [['meteor', 'vines', 'spread'], ['meteor', 'vines', 'spread', 'tether'], ['meteor', 'vines', 'spread', 'tether']] },
  },
  // The Drowned Sovereign (Floor 2): server/floor2.js f2Sovereign / sovereignSpecials, server/sovtwists.js.
  sovereign: {
    knobs: KNOBS(),
    pace: ['sweep', 'geyser', 'wave', 'deluge'],
    abilities: {
      // its basic swing. mult was 1.15 in the old table but never read: the swing has always dealt 1 x atk
      sweep: { wind: 1.1, active: 0, mult: 1, cd: 2.4, rage: 0.8, shape: 'wedge', avoid: AVOID(HIT), posture: 0, after: idle() },
      geyser: { every: [7, 6, 5], first: 4, r: 3.0, wind: 1.65, active: 0, mult: 2.0, extra: [1, 2, 3], shape: 'circle', avoid: AVOID(ALL), posture: 0, after: idle() },
      // the must-dodge ring of water; firstAfterDeluge: s after the Deluge call lands (phase 3)
      wave: { every: [0, 15, 11], first: 3.5, firstAfterDeluge: 7, wind: 2.3, active: 56 / 11, speed: 11, width: 1.4, mult: 3.6, shape: 'ring', avoid: AVOID(['roll'], 'front'), posture: 0, after: idle(0.5) },
      thralls: { every: 24, first: 2, n: 2, max: 4, shape: 'summon', avoid: AVOID(['none']), posture: 0, after: idle() },
      pools: { every: 10, first: 6, n: 2, r: 3.8, arm: 1.2, life: 16, tick: 0.5, mult: 0.3, max: 6, shape: 'zone', avoid: AVOID(['outrange'], 'zone'), posture: 0, after: idle() },
      // the Sovereign calls it (pose + a flood line filling inward), then the outer court floods for the rest of the fight
      deluge: { r: 16.5, tick: 0.5, mult: 0.25, wind: 2.4, shape: 'room', avoid: AVOID(['outrange'], 'zone'), posture: 0, after: idle() },
      // a fan of `n` orbs `fan` rad apart, each mult x atk; first: s after the Deluge call lands
      volley: { every: 9, first: 4, n: 5, fan: 0.45, mult: 0.8, shape: 'line', avoid: AVOID(HIT), posture: 0, after: idle() },
      // J1 trap (RESCUE.pillar): pinned in a column fed by an orb `src` m away
      pillar: { table: 'RESCUE', name: 'Drowning Pillar', wind: 1.6, hits: 3.5, max: 12, tick: 0.5, dot: 0.026, src: [12, 17], block: 1.6, lane: 1.4, shape: 'trap', avoid: AVOID(['none']), posture: 0, after: idle() },
    },
    // combos: geysers (then a Tidal Wave), then the trident planted
    phases: [
      phase(['sweep', 'geyser'], 16, 10, { steps: ['geyser', 'geyser'], gaps: [0.6], pause: 2.5, state: 'planted' }),
      phase(['sweep', 'geyser', 'wave', 'thralls', 'pools'], 15, 8, { steps: ['geyser', 'geyser'], gaps: [0.6], pause: 2.5, state: 'planted' }, { steps: ['geyser', 'wave'], gaps: [0.5], pause: 3, state: 'planted' }),
      phase(['sweep', 'geyser', 'wave', 'thralls', 'pools', 'deluge', 'volley'], 14, 9, { steps: ['wave', 'volley'], gaps: [0.5], pause: 2.5, state: 'planted' }, { steps: ['geyser', 'wave'], gaps: [0.5], pause: 3, state: 'planted' }),
    ],
    close: { gap: 1, moves: ['sweep'], hold: true },
    team: { every: [26, 22, 18], first: 14, moves: [['meteor', 'pillar', 'spread'], ['meteor', 'pillar', 'spread', 'tether'], ['meteor', 'pillar', 'spread', 'tether']] },
  },
  // The Storm Colossus (Floor 3): server/floor3.js colossusSpecials, server/arenas.js (the fall).
  colossus: {
    knobs: KNOBS(),
    pace: ['cleave', 'strike', 'gust', 'beam'],
    abilities: {
      cleave: { wind: 0.9, active: 0, mult: 1.0, cd: 2.3, rage: 0.85, shape: 'wedge', avoid: AVOID(HIT), posture: 0, after: idle() }, // its basic sword swing
      strike: { every: [8.5, 7.5, 6.5], first: 4, r: 3.2, wind: 1.7, active: 0, mult: 2.2, extra: [2, 3, 4], shape: 'circle', avoid: AVOID(HIT), posture: 0, after: idle() },
      gust: { every: [13, 12, 11], first: 7, wind: 1.5, active: 0, r: 11, half: 0.75, mult: 2.2, shove: 7, shape: 'cone', avoid: AVOID(HIT), posture: 0, after: idle(0.45) },
      // Overload: a team mechanic (Break it, then Switch or Team Burst). after: the Thunderclap's pause; stopped, it is
      // stunned for `stun` s, then Grounded (takes `weak` x damage) for `weakD` s. firstStatic: s after the engage with
      // the Static twist; phase3: the next one comes within every[2] x this when phase 3 starts. stopped: doc-only (the
      // server never reads it: a stopped Overload stuns through stunUntil in server/floor3.js, not an after state).
      overload: { every: [0, 30, 24], first: 5, firstStatic: 14, phase3: 0.6, channel: 8, posture: 0.5, clap: 0.55, charged: 15, chargedMult: 1.25, stun: 4, weakD: 8, weak: 1.3, shape: 'room', avoid: AVOID(['none'], 'zone'), after: idle(0.6), stopped: { state: 'stunned' } },
      harpies: { every: 26, n: 2, max: 3, first: 6, shape: 'summon', avoid: AVOID(['none']), posture: 0, after: idle() },
      // Tempest Beam: the sword planted, a beam sweeps `sweep` rad around it in `turn` s (its active time)
      beam: { every: [0, 0, 15], first: 4, wind: 2.2, active: 7, turn: 7, sweep: Math.PI * 2, len: 26, w: 0.8, mult: 2.5, from: 0.5, shape: 'beam', avoid: AVOID(['jump', 'roll'], 'sweep'), posture: 0, after: idle(0.4) },
      // J1 trap (RESCUE.crystal): encased; break it within `fuse` s or it bursts for `boom` x max HP on everyone
      crystal: { table: 'RESCUE', name: 'Storm Crystal', wind: 1.3, hits: 4, fuse: 8, boom: 0.32, shape: 'trap', avoid: AVOID(['none']), posture: 0, after: idle() },
    },
    // combos: strikes into a Gale Push (or the beam), then it stands exposed / its sword planted. J3 part 3 (scripts/
    // tuneboss.js): a combo every 12-13 s (was 14-16) with 3-3.5 s openings (were 2.5-3), the beam combo half as likely,
    // Lightning Strikes, Gale Push and the Tempest Beam less often (part 2's combos had added beams and beam hits)
    phases: [
      phase(['cleave', 'gust', 'strike'], 13, 10, { steps: ['strike', 'gust'], gaps: [0.4], pause: 3.5 }),
      phase(['cleave', 'overload', 'gust', 'strike', 'harpies'], 12, 8, { steps: ['strike', 'gust'], gaps: [0.4], pause: 3.5 }, { steps: ['gust', 'strike'], gaps: [0.5], pause: 3 }),
      phase(['cleave', 'overload', 'beam', 'gust', 'strike', 'harpies'], 12, 8, { steps: ['strike', 'gust'], gaps: [0.4], pause: 3.5, w: 2 }, { steps: ['strike', 'beam'], gaps: [0.4], pause: 3.5, state: 'planted' }),
    ],
    close: { gap: 1.5, moves: ['cleave', 'gust'], hold: true },
    team: { every: [28, 26, 22], first: 18, moves: [['meteor', 'crystal', 'spread'], ['meteor', 'crystal', 'spread', 'tether'], ['spread', 'crystal', 'tether']] },
    // The fall (J2): crack (warning), fall (inputs frozen), land (frozen, bleed-out paused), enter (the boss drops in,
    // its impact `impact` s later: a shove, no damage); gap: s since the last team-scale mechanic before a fall may start,
    // and before one may start after it; after: s before the first fire pattern; the boss's own moves resume
    // `resume` + up to `resumeJitter` s after it has landed.
    transition: { crack: 3.2, fall: 1.1, land: 2.0, enter: 1.6, impact: 0.55, gap: 8, after: 3, shove: 7, shoveR: 7, resume: 2, resumeJitter: 2 },
  },
};
export const BOSS_KEYS = Object.keys(BOSS_TIMING);

// Openings (J3): while a boss holds one of these `after` states, a weak point glows, an OPENING tag shows over it, and
// melee hits (inFlankReach: shared/threat.js) get +dmg damage, added to the flank bonus (not multiplied). Posture is
// fed by the damage, so it rises by the same +25%; `posture` is extra on top (added to the flank posture bonus). Not
// while it is Grounded or Broken (a Switch), and never in a director show (server/openings.js).
export const OPENING = { states: ['exposed', 'stunned', 'planted'], dmg: 0.25, posture: 0 };
export const AFTER_STATES = ['idle', 'walk', 'planted', 'stunned', 'exposed'];
export const isOpening = state => OPENING.states.includes(state);

// Shared team-scale timings (not per boss: no knobs). team: G4 (shared/bossteam.js): `min` alive fighters, `channel`:
// the boss's telegraphed attacks wait this long after a meteor/spread lands, `retry`: s before a blocked rotation tries
// again. traps: J1 (shared/rescue.js): `minFree` free fighters, `gap` s between two team-scale mechanics on one boss,
// `channel` s the boss's big attacks wait after a trap lands.
export const TEAM_TIMING = {
  team: { min: 2, channel: 0.8, retry: 2 },
  traps: { minFree: 2, gap: 8, channel: 2 },
  meteor: { r: 3.6, wind: 4.5, total: 0.9, split: 1.3 },
  spread: { r: 6, wind: 5.5, hit: 0.42, self: 0.06, n: f => (f >= 5 ? 3 : 2) },
  tether: { need: 15, grace: 1.5, tick: 0.5, dmg: 0.035, max: 11 },
};

/** The knobs for `boss` at party size `n` (undefined: the base knobs), as { damageMul, ..., cooldownMul }. */
export function knobsFor(boss, n, table = BOSS_TIMING) {
  const K = table[boss].knobs, out = Object.fromEntries(KNOB_KEYS.map(k => [k, K[k] ?? 1]));
  if (n != null && K.party) {
    const at = Object.keys(K.party).map(Number).filter(c => c <= n).sort((a, b) => b - a)[0];
    if (at != null) Object.assign(out, K.party[at]);
  }
  return out;
}

const r3 = v => Math.round(v * 1000) / 1000;
const scale = (v, k) => (Array.isArray(v) ? v.map(e => (typeof e === 'number' ? r3(e * k) : e)) : typeof v === 'number' ? r3(v * k) : v);

/** Apply knobs in place to one built boss timing ({ abilities, phases, team }). A knob of 1 touches nothing.
 *  damageMul: mult frac clap dot boom · windupMul: wind channel (a repeat's `every` grows by the extra wind-up, like
 *  PACE, so the rest after the hit stays the same) · cooldownMul: every cd, the team rotation's every ·
 *  pauseMul: after.pause, each sequence's pause · gapMul: each sequence's gaps, the close-move gap · cooldownMul also
 *  the combos' `every`. `first` timers are unchanged. */
export function applyKnobs(T, K) {
  for (const mv of Object.values(T.abilities)) {
    if (K.damageMul !== 1) for (const k of DAMAGE_KEYS) if (k in mv) mv[k] = scale(mv[k], K.damageMul);
    if (K.windupMul !== 1) {
      const extra = typeof mv.wind === 'number' ? r3(mv.wind * K.windupMul) - mv.wind : 0;
      for (const k of WINDUP_KEYS) if (k in mv) mv[k] = scale(mv[k], K.windupMul);
      if (extra && mv.every != null) mv.every = Array.isArray(mv.every) ? mv.every.map(e => (e > 0 ? r3(e + extra) : e)) : mv.every > 0 ? r3(mv.every + extra) : mv.every;
    }
    if (K.cooldownMul !== 1) for (const k of COOLDOWN_KEYS) if (k in mv) mv[k] = scale(mv[k], K.cooldownMul);
    if (K.pauseMul !== 1 && mv.after) mv.after.pause = scale(mv.after.pause, K.pauseMul);
  }
  for (const ph of T.phases || []) {
    if (K.cooldownMul !== 1 && ph.every) ph.every = scale(ph.every, K.cooldownMul);
    for (const s of ph.seqs) {
      if (K.gapMul !== 1) s.gaps = scale(s.gaps, K.gapMul);
      if (K.pauseMul !== 1) s.pause = scale(s.pause, K.pauseMul);
    }
  }
  if (T.close && K.gapMul !== 1) T.close.gap = scale(T.close.gap, K.gapMul);
  if (T.team && K.cooldownMul !== 1) T.team.every = scale(T.team.every, K.cooldownMul);
  return T;
}

/** Build a boss's live timing: a deep copy of its table, paced (PACE), then knobbed for party size `n`.
 *  knobs: extra overrides on top (the tuning harness). Returns { abilities, phases, team, transition, close, knobs }. */
export function buildTiming(boss, n, knobs = null, table = BOSS_TIMING) {
  const src = table[boss], K = { ...knobsFor(boss, n, table), ...(knobs || {}) };
  const T = { abilities: structuredClone(src.abilities), phases: structuredClone(src.phases || []), team: src.team ? structuredClone(src.team) : null, transition: src.transition ? { ...src.transition } : null, close: src.close ? structuredClone(src.close) : null, knobs: K };
  paceMoves(T.abilities, src.pace || []);
  return applyKnobs(T, K);
}

/** A boss's moves for its old move table (WARDEN, SOVEREIGN, COLOSSUS): the abilities without a `table` of their own. */
export const movesOf = T => Object.fromEntries(Object.entries(T.abilities).filter(([, v]) => !v.table));

/** When to be safe from a move, in s after its wind-up starts: [from, to]. d: your distance from where it starts (for a
 *  wavefront: 'front'). null when it can't be dodged by timing (a zone, a trap, a team mechanic). */
export function safeWindow(mv, d = 0) {
  const at = mv.avoid?.at, wind = mv.wind ?? mv.channel ?? 0;
  if (at === 'land') return [wind, wind + (mv.active || 0)];
  if (at === 'front' && mv.speed) { const w = mv.w ?? mv.width ?? 0; return [wind + Math.max(0, d - w) / mv.speed, wind + (d + w) / mv.speed]; }
  if (at === 'sweep') return [wind, wind + (mv.active || mv.turn || 0)];
  return null;
}

// The default timings every table is built from (base knobs, no party size).
export const TIMED = Object.fromEntries(BOSS_KEYS.map(k => [k, buildTiming(k)]));

/** One fight's table (m.tm, built at the engage once the party size `n` is known): the boss's move table `base` (its
 *  twist copy, e.g. game.twistW, or WARDEN / SOVEREIGN / COLOSSUS), plus `seqs` (its phases' sequences), `close`,
 *  `team` and `knobs`. When the party size (or `knobs`, the tuning harness) changes no knob, the moves are `base`'s own
 *  objects; otherwise copies with the change applied on top (relative to the base knobs `base` was built with). */
export function fightTable(boss, base, n, knobs = null, table = BOSS_TIMING) {
  const T = TIMED[boss], K0 = knobsFor(boss, undefined, table), K = { ...knobsFor(boss, n, table), ...(knobs || {}) };
  const rel = Object.fromEntries(KNOB_KEYS.map(k => [k, r3((K[k] ?? 1) / (K0[k] || 1))]));
  const out = { ...base, seqs: T.phases, close: T.close, team: T.team, knobs: K };
  if (base.sweep === undefined && T.abilities.sweep?.table === 'SWEEP') out.sweep = T.abilities.sweep; // the Horn Sweep
  if (KNOB_KEYS.every(k => rel[k] === 1)) return out;
  const moves = Object.fromEntries(Object.keys(T.abilities).filter(k => out[k]).map(k => [k, structuredClone(out[k])]));
  const P = applyKnobs({ abilities: moves, phases: structuredClone(T.phases), team: structuredClone(T.team), close: structuredClone(T.close) }, rel);
  return Object.assign(out, moves, { seqs: P.phases, close: P.close, team: P.team });
}

/** Pick a combo for phase `ph` of a fight table (the sequences with more than one step), by weight; null if none. */
export function pickCombo(tm, ph, rnd = Math.random) {
  const list = (tm.seqs?.[ph]?.seqs || []).filter(s => s.steps.length > 1 && s.w > 0);
  let r = rnd() * list.reduce((a, s) => a + s.w, 0);
  for (const s of list) if ((r -= s.w) < 0) return s;
  return list[list.length - 1] || null;
}
