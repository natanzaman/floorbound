// Multi-area boss fights (docs/ROADMAP.md J2). An arena is a boss room whose AREA is a state, not a place: every area
// lives on the same x,z footprint (so inArena3 & co. are unchanged), and the area decides the room's extra colliders
// (walls, pillars), its hazards (sludge pools, fire patterns) and its look. A boss lists its areas and, per phase, a
// transition to another area (the fall). Data here; the server runs it (server/arenas.js), the client draws it
// (public/arenas.js + each floor's world file) and the bots read the same helpers (shared/bots/arenas.js).
//
// Runtime state (which area each arena is in, the fire pattern) is module state, set by the server as it changes and by
// clients and bots from the snapshot (applyArenaSnap). resolveCollision (shared/data.js) adds the active area's colliders,
// so players, bots, mobs and client prediction all collide with them without knowing about areas.
// This module imports only shared/floor3.js (which imports nothing), so shared/data.js can import it.
import { F3 } from './floor3.js';

// Positions are offsets [dx, dz] from the room's centre (face convention: +z is north, the way in is from the south).
// Per arena:
//   room         the boss room ({ x, z, r }), boss: the mob type, game / fight: the Game fields holding the boss and
//                its fight record (a new record, or none while it stands: a wipe or a respawn, back to area 0)
//   timing       crack: the warning (cracks spread, rumble) · fall: everyone drops (inputs frozen) · land: the landing
//                pause (frozen, bleed-out paused) · enter: the boss drops in (impact after `impact` s: a shove, no damage)
//                · gap: s since the last team-scale mechanic (Overload, G4 move, J1 trap) before a fall may start, and
//                before one may start after it · after: s after the fight resumes before the first fire pattern
//   transitions  [{ phase, to }]: when the boss reaches `phase` (0-based), fall to area `to` (once per fight)
//   areas[i]     { id, name, pillars: [[dx, dz, r, los]], walls: [[a0, a1, R]] (arcs of rubble: colliders every
//                ~1.5 m; angles in rad, dx = sin a), sludge: [[dx, dz, r]], slow (speed multiplier in sludge),
//                fire: { tick (s), dmg (fraction of max HP per tick), r, warn, live, rest (s), patterns: [[[dx, dz]]] } }
//                los: the pillar blocks line of sight (beams). Walls always do.
export const ARENAS = {
  colossus: {
    room: F3.arena, boss: 'colossus', game: 'colossus', fight: 'fight3',
    timing: { crack: 3.2, fall: 1.1, land: 2.0, enter: 1.6, impact: 0.55, gap: 8, after: 3, shove: 7, shoveR: 7 },
    transitions: [{ phase: 1, to: 1 }],
    areas: [
      { id: 'eye', name: 'The Eye of the Storm' },
      {
        id: 'undercroft', name: 'The Undercroft',
        blurb: 'Sludge slows you (no rolling in it), fire spreads in patterns, and the great pillars block the Tempest Beam.',
        pillars: [[-9, 5, 2.0, true], [9, 5, 2.0, true], [0, -10, 2.0, true], [-20, -12, 1.3, false], [20, -12, 1.3, false]],
        walls: [[-1.0, -0.6, 17], [0.6, 1.0, 17]],
        sludge: [[-14, -5, 3.8], [14, -5, 3.8], [0, 17.5, 4.0], [-6.5, -16.5, 2.4], [6.5, -16.5, 2.4]],
        slow: 0.45,
        fire: {
          tick: 0.2, dmg: 0.035, r: 2.3, warn: 1.8, live: 6, rest: 2,
          patterns: [
            [[0, 4.5], [4.5, -2.5], [-4.5, -2.5], [0, 11], [-15, 3], [15, 3], [-7, -11], [7, -11]],           // the inner ring
            [[-4, 10], [4, 10], [-19, 4], [19, 4], [-7.5, -4], [7.5, -4], [-2.5, -21.5], [2.5, -21.5], [0, 0]], // the cross
            [[-20, -3.5], [-15, -13], [15, -13], [20, -3.5], [-6, 15], [6, 15], [0, -5], [0, -15]],          // the outer arc
          ],
        },
      },
    ],
  },
};
export const ARENA_KEYS = Object.keys(ARENAS);
export const FIRE_MAX = 10; // fixed patterns, at most 10 patches each (checked at 5 Hz)
export const STAGES = ['', 'pending', 'crack', 'fall', 'land', 'enter']; // the transition's stages (0: none)

// ---------- absolute geometry, built once ----------
for (const A of Object.values(ARENAS)) {
  const { x: cx, z: cz } = A.room;
  for (const area of A.areas) {
    const cols = [];
    for (const [dx, dz, r, los] of area.pillars || []) cols.push({ x: cx + dx, z: cz + dz, r, los: !!los, kind: 'pillar' });
    for (const [a0, a1, R] of area.walls || []) {
      const n = Math.max(2, Math.round((Math.abs(a1 - a0) * R) / 1.5) + 1);
      for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / (n - 1); cols.push({ x: cx + Math.sin(a) * R, z: cz + Math.cos(a) * R, r: 0.95, los: true, kind: 'wall' }); }
    }
    area.colliders = cols;
    area.pools = (area.sludge || []).map(([dx, dz, r]) => ({ x: cx + dx, z: cz + dz, r }));
    if (area.fire) area.fire.spots = area.fire.patterns.map(pat => pat.slice(0, FIRE_MAX).map(([dx, dz]) => ({ x: cx + dx, z: cz + dz, r: area.fire.r })));
  }
}

// ---------- runtime state ----------
// LIVE[key] = { area, stage, left, fi (fire pattern index), fk (0 off, 1 warning, 2 burning), fleft }
const LIVE = {};
for (const k of ARENA_KEYS) LIVE[k] = { area: 0, stage: 0, left: 0, fi: 0, fk: 0, fleft: 0 };
/** The active areas' colliders (absolute { x, z, r, los, kind }): resolveCollision (shared/data.js) adds these. */
export const AREA_COLLIDERS = [];

export const arenaState = key => LIVE[key];
export const areaOf = key => ARENAS[key]?.areas[LIVE[key]?.area || 0] || null;
export const areaDef = (key, i) => ARENAS[key]?.areas[i] || null;
export const inRoom = (A, x, z, pad = 0) => Math.hypot(x - A.room.x, z - A.room.z) < A.room.r + pad;
/** The arena whose room holds (x, z), or null. */
export function arenaAt(x, z) { for (const k of ARENA_KEYS) if (inRoom(ARENAS[k], x, z)) return k; return null; }

/** Set an arena's state (server: as it changes; clients and bots: from the snapshot). Rebuilds the collider list. */
export function setArenaState(key, s) {
  const L = LIVE[key];
  if (!L) return;
  const was = L.area;
  Object.assign(L, s);
  if (L.area !== was) rebuild();
}
function rebuild() {
  AREA_COLLIDERS.length = 0;
  for (const k of ARENA_KEYS) { const a = areaOf(k); if (a?.colliders) AREA_COLLIDERS.push(...a.colliders); }
}
export function resetArenas() { for (const k of ARENA_KEYS) Object.assign(LIVE[k], { area: 0, stage: 0, left: 0, fi: 0, fk: 0, fleft: 0 }); rebuild(); }

// Snapshot form: { key: [area, stage, left, fi, fk, fleft] } (server/arenas.js arenaSnap).
export function arenaRow(key) { const L = LIVE[key]; return [L.area, L.stage, r1(L.left), L.fi, L.fk, r1(L.fleft)]; }
// The server owns the state in its own process: bots running there (server bots, the Named) read it directly, so a
// snapshot they handle a tick late never rolls it back.
let OWNED = false;
export function serverOwnsArenas(on = true) { OWNED = !!on; }
export function applyArenaSnap(ar) {
  if (!ar || OWNED) return;
  for (const k of ARENA_KEYS) {
    const row = ar[k];
    if (row) setArenaState(k, { area: row[0], stage: row[1], left: row[2], fi: row[3], fk: row[4], fleft: row[5] });
  }
}
const r1 = v => Math.round(v * 10) / 10;

// ---------- queries (all areas currently active) ----------
/** Push (x, z) out of the active areas' colliders (the same rule as shared/data.js resolveCollision). */
export function resolveArea(x, z, rad) {
  for (const o of AREA_COLLIDERS) {
    const dx = x - o.x, dz = z - o.z, m = o.r + rad;
    if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
    const d = Math.hypot(dx, dz);
    if (d < m && d > 1e-4) { x = o.x + (dx / d) * m; z = o.z + (dz / d) * m; }
  }
  return [x, z];
}
/** Is (x, z) inside a collider of an active area (with `pad`)? */
export const inCollider = (x, z, pad = 0) => AREA_COLLIDERS.some(o => Math.hypot(x - o.x, z - o.z) < o.r + pad);

/** The sludge pool (x, z) stands in (pad: margin), or null. Only in areas the fight is in. */
export function sludgeAt(x, z, pad = 0) {
  for (const k of ARENA_KEYS) {
    const a = areaOf(k);
    if (!a?.pools) continue;
    for (const p of a.pools) if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return p;
  }
  return null;
}
/** Movement speed multiplier at (x, z): the area's `slow` in sludge, else 1. */
export function speedAt(x, z) {
  for (const k of ARENA_KEYS) {
    const a = areaOf(k);
    if (a?.pools && a.pools.some(p => Math.hypot(x - p.x, z - p.z) < p.r)) return a.slow ?? 0.5;
  }
  return 1;
}
export const canDodgeAt = (x, z) => !sludgeAt(x, z);

/** The fire patches of an arena's current pattern ([] when none), and their state (1 warning, 2 burning). */
export function firePatches(key) {
  const L = LIVE[key], a = areaOf(key);
  if (!a?.fire || !L.fk) return [];
  return a.fire.spots[L.fi % a.fire.spots.length];
}
/** The fire at (x, z): 0 none, 1 a warning patch, 2 burning (pad: margin). */
export function fireAt(x, z, pad = 0) {
  let best = 0;
  for (const k of ARENA_KEYS) {
    const L = LIVE[k];
    if (!L.fk) continue;
    for (const s of firePatches(k)) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) best = Math.max(best, L.fk);
  }
  return best;
}

/** Does a line-of-sight collider (a great pillar or a wall) stand between (x0, z0) and (x1, z1)? */
export function losBlocked(x0, z0, x1, z1) {
  const lx = x1 - x0, lz = z1 - z0, L2 = lx * lx + lz * lz || 1e-6;
  for (const o of AREA_COLLIDERS) {
    if (!o.los) continue;
    const k = Math.max(0, Math.min(1, ((o.x - x0) * lx + (o.z - z0) * lz) / L2));
    if (Math.hypot(x0 + lx * k - o.x, z0 + lz * k - o.z) < o.r * 0.9) return true; // (a little inside the edge: a body grazing the rim is still hit)
  }
  return false;
}

/** A free spot near (x, z) in the arena's area `area`: out of its colliders, sludge and the room's edge. */
export function freeSpot(key, area, x, z, rad = 0.6) {
  const A = ARENAS[key], a = A.areas[area] || {}, R = A.room.r - 1.5 - rad;
  const bad = (px, pz) => Math.hypot(px - A.room.x, pz - A.room.z) > R
    || (a.colliders || []).some(o => Math.hypot(px - o.x, pz - o.z) < o.r + rad + 0.15)
    || (a.pools || []).some(p => Math.hypot(px - p.x, pz - p.z) < p.r + 0.4);
  if (!bad(x, z)) return [x, z];
  for (let d = 1; d <= 16; d += 0.75) {
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2, px = x + Math.sin(ang) * d, pz = z + Math.cos(ang) * d;
      if (!bad(px, pz)) return [px, pz];
    }
  }
  return [A.room.x, A.room.z];
}

/** How far a beam from (x, z) at angle `ang` (dx = sin) gets before a line-of-sight collider stops it (≤ len). */
export function losReach(x, z, ang, len) {
  const ux = Math.sin(ang), uz = Math.cos(ang);
  let best = len;
  for (const o of AREA_COLLIDERS) {
    if (!o.los) continue;
    const px = o.x - x, pz = o.z - z, t = px * ux + pz * uz;
    if (t <= 0 || t - o.r > best) continue;
    const d = Math.hypot(px - ux * t, pz - uz * t), rr = o.r * 0.9;
    if (d < rr) best = Math.min(best, t - Math.sqrt(rr * rr - d * d));
  }
  return Math.max(0.5, best);
}
