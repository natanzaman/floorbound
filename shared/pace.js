// Ability pacing: every player skill's use time (draws, leaps, gaps between hits) and every boss wind-up is x PACE, so
// abilities read clearly; damage and cooldowns are unchanged (a skill's cooldown starts when its last hit lands:
// server/pacing.js). Instant skills stay instant. The client plays skill clips at speed / PACE. PACE = 1 undoes it all.
// This file imports nothing, so the boss timing tables (shared/bosstiming.js) can pace themselves; shared/data.js
// re-exports all three names.
export const PACE = 1.3;
export const paced = s => Math.round(s * PACE * 1000) / 1000;
// Pace boss move tables in place (once): each move's `wind` (and Quake Ring `gap`) x PACE, and its repeat `every`
// (a number, or one per phase; 0 = not in that phase) grows by the extra wind-up, because repeats are timed from the
// start of the wind-up: the rest after the hit stays the same. `first` timers are unchanged.
// keys: the moves of `tbl` to pace (default: every entry with a numeric `wind`); keys = null paces `tbl` itself as one move.
export function paceMoves(tbl, keys) {
  const moves = keys === null ? [tbl] : (keys || Object.keys(tbl).filter(k => typeof tbl[k]?.wind === 'number')).map(k => tbl[k]);
  for (const mv of moves) {
    if (!mv || mv._paced || typeof mv.wind !== 'number') continue;
    const wind = paced(mv.wind), extra = wind - mv.wind, grow = e => (e > 0 ? Math.round((e + extra) * 1000) / 1000 : e);
    mv.wind = wind;
    const gap0 = mv.gap;
    if (typeof mv.gap === 'number') mv.gap = paced(mv.gap);
    if (Array.isArray(mv.every)) mv.every = mv.every.map((e, i) => grow(e) + (Array.isArray(mv.rings) && typeof mv.gap === 'number' && e > 0 ? Math.round((mv.rings[i] - 1) * (mv.gap - gap0) * 1000) / 1000 : 0));
    else if (typeof mv.every === 'number') mv.every = grow(mv.every);
    Object.defineProperty(mv, '_paced', { value: true }); // not enumerable: twists copy moves with { ...v }
  }
  return tbl;
}
