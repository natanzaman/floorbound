// Floor 2 — The Glimmering Mire. Map, mobs, boss tuning and helpers, shared by the server and the client.
// Floor 2 lives in the same coordinate space as Floor 1, 600 units east (everything with x > F2.split is Floor 2).
// Its layout mirrors Floor 1's skeleton (camp in the south, field, corridor + raid gate at z≈161, boss court at z≈190),
// so z-based heuristics (gate, boss bar, music) work on both floors.
// This module must not import shared/data.js (data.js imports it). Floor 3 (x > 900) is shared/floor3.js.
import { F3, WAYSTONE3, unlocked3 } from './floor3.js';

export const F2 = {
  x: 600, split: 300,
  rect: { x0: 532, x1: 668, z0: -30, z1: 158 },
  corridor: { x0: 595, x1: 605, z0: 150, z1: 168 },
  arena: { x: 600, z: 191, r: 27 },
  camp: { x: 600, z: 0, r: 18 },
};

export const onFloor2 = x => x > F2.split && x <= F3.split;
export const floorOf = x => (x > F3.split ? 3 : x > F2.split ? 2 : 1);
export const inCamp2 = (x, z, pad = 0) => Math.hypot(x - F2.camp.x, z - F2.camp.z) < F2.camp.r + pad;
export const inArena2 = (x, z) => Math.hypot(x - F2.arena.x, z - F2.arena.z) < F2.arena.r;

// Floor 2's raid gate (same shape as Floor 1's, shifted east).
export const GATE2 = { x: 600, z: 161, half: 5.6, band: [157.5, 165.5], zone: { x: 12, z0: 138, z1: 158 }, count: 5, force: 20 };
export const inGateZone2 = (x, z) => Math.abs(x - GATE2.x) < GATE2.zone.x && z > GATE2.zone.z0 && z < GATE2.zone.z1;
const gate2Blocks = (x, z) => Math.abs(x - GATE2.x) < GATE2.half && z > GATE2.band[0] && z < GATE2.band[1];
export const crossesGate2 = (x0, z0, x1, z1) => (z0 < GATE2.z) !== (z1 < GATE2.z) && Math.abs((x0 + x1) / 2 - GATE2.x) < GATE2.half + 1;

export function walkable2(x, z, gateClosed = false) {
  if (gateClosed && gate2Blocks(x, z)) return false;
  const { rect, corridor } = F2;
  if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return true;
  if (x >= corridor.x0 && x <= corridor.x1 && z >= corridor.z0 && z <= corridor.z1) return true;
  return inArena2(x, z);
}

export function areaName2(x, z) {
  if (inCamp2(x, z)) return 'Mirelight Camp';
  if (inArena2(x, z)) return 'The Sunken Court';
  if (z > 148) return 'Sunken Gate';
  if (z > 98) return 'Floor 2 — The Drowned Wood';
  return 'Floor 2 — The Glimmering Mire';
}

// Waystones: a teleport crystal in each town (F to use). They offer every floor the character has unlocked.
export const WAYSTONES = [
  { floor: 1, x: 0, z: -11, r: 1.4, name: 'Town of Beginnings' },
  { floor: 2, x: 600, z: -9, r: 1.4, name: 'Mirelight Camp' },
  WAYSTONE3, // Floor 3: Windbreak Camp
];
export const WAYSTONE_USE = 3.2; // how close you need to stand
export const nearWaystone = (x, z) => WAYSTONES.find(w => Math.hypot(x - w.x, z - w.z) < WAYSTONE_USE);
// The Stairway: a portal that appears in the Warden's chamber for a while after a kill.
export const STAIRWAY = { x: 0, z: 207, r: 2.2, use: 3.6, secs: 60 };

// Floor 2 unlocks once a character has helped kill the Horned Warden (stats.wardenKills), or via the floor2 flag;
// Floor 3 once they've helped kill the Drowned Sovereign (or the floor3 flag).
export const floorUnlocked = (stats, f) => f <= 1 || (f === 2 && ((stats?.wardenKills || 0) > 0 || (stats?.floor2 || 0) > 0)) || (f === 3 && unlocked3(stats));

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

// Static obstacles for Floor 2 (deterministic): appended to OBSTACLES in data.js.
export function floor2Obstacles() {
  const out = [];
  for (const w of WAYSTONES) out.push({ kind: 'waystone', x: w.x, z: w.z, r: w.r, floor: w.floor });
  const { camp, arena } = F2;
  out.push({ kind: 'campfire', x: camp.x, z: camp.z, r: 1.3 });
  for (const [dx, dz] of [[-11, -6], [11, -6], [-12, 7], [12, 7]]) out.push({ kind: 'tent', x: camp.x + dx, z: camp.z + dz, r: 2.2, rot: Math.atan2(-dx, -dz) });
  const r = rng(2024);
  const placed = () => out;
  const clear = (x, z, pad) => !placed().some(o => Math.hypot(o.x - x, o.z - z) < o.r + pad);
  let n = 0, tries = 0;
  while (n < 90 && tries < 9000) { // dead trees and glowing crystals across the mire
    tries++;
    const x = F2.rect.x0 + 2 + r() * (F2.rect.x1 - F2.rect.x0 - 4), z = 26 + r() * 128;
    if (Math.abs(x - F2.x) < 7) continue; // keep the boardwalk clear
    if (!clear(x, z, 3.2)) continue;
    const crystal = r() < 0.28;
    out.push(crystal ? { kind: 'crystal', x, z, r: 0.9, s: 0.8 + r() * 0.9, hue: r() } : { kind: 'deadtree', x, z, r: 0.8, s: 0.9 + r() * 0.7, rot: r() * 6.28 });
    n++;
  }
  for (let i = 0; i < 6; i++) { // broken pillars around the Sunken Court
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    out.push({ kind: 'mpillar', x: arena.x + Math.cos(a) * 22.5, z: arena.z + Math.sin(a) * 22.5, r: 1.5, h: 4 + ((i * 5) % 7) });
  }
  return out;
}

// ---------- enemies (appended to MOBS / MOB_IDS in data.js) ----------
// ai: the Game method that runs this mob (server/floor2.js). f2: lives on Floor 2.
export const F2_MOB_IDS = ['shieldback', 'wisp', 'lurker', 'matron', 'thrall', 'sovereign'];
export const F2_MOBS = {
  shieldback: { name: 'Mire Shieldback', hp: 760, atk: 26, speed: 3.6, aggro: 10, range: 2.6, atkCd: 2.1, xp: 110, radius: 1.3, level: 12, f2: true, ai: 'f2Brute', shell: 0.2, turn: 1.5 },
  wisp: { name: "Will-o'-Wisp", hp: 260, atk: 24, speed: 3.2, aggro: 16, range: 13, atkCd: 3.4, xp: 90, radius: 0.7, level: 11, f2: true, ai: 'f2Wisp', ranged: true, float: true },
  lurker: { name: 'Bog Lurker', hp: 440, atk: 22, speed: 5.0, aggro: 15, range: 2.2, atkCd: 1.5, xp: 100, radius: 1.0, level: 13, f2: true, ai: 'f2Lurker' },
  matron: { name: 'Mire Matron', hp: 2000, atk: 30, speed: 4.2, aggro: 14, range: 3.0, atkCd: 1.9, xp: 480, radius: 1.7, level: 15, f2: true, ai: 'f2Matron', elite: true },
  thrall: { name: 'Drowned Thrall', hp: 320, atk: 24, speed: 5.4, aggro: 30, range: 2.0, atkCd: 1.4, xp: 25, radius: 0.8, level: 16, f2: true, ai: 'f2Brute' },
  sovereign: { name: 'The Drowned Sovereign', hp: 9000, atk: 40, speed: 3.9, aggro: 20, range: 4.8, atkCd: 2.4, xp: 1800, radius: 2.4, level: 18, f2: true, ai: 'f2Sovereign', boss: true, f2boss: true },
};
export const F2_BITE = { shieldback: [3.2, 0.75], lurker: [2.8, 0.7], matron: [3.8, 0.9], thrall: [2.8, 0.6], sovereign: [6.0, 1.0] };

// Where Floor 2's field mobs live: [type, count, x range, z range]
export const F2_SPAWNS = [
  ['shieldback', 8, [540, 660], [34, 96]],
  ['wisp', 8, [540, 660], [40, 140]],
  ['lurker', 9, [540, 660], [102, 146]],
];
export const F2_MATRONS = [[566, 124], [636, 118]];

export const ORB = { speed: 6.4, turn: 1.8, ttl: 4.6, radius: 0.55, wind: 0.9 };            // homing orbs (wisps, the Sovereign)
export const WISP = { blinkR: 5.5, blinkCd: 4.5, blinkDist: [9, 12], keep: [7, 12], leash: 26 }; // blinks away when approached
export const LURK = { still: 1.8, moved: 0.9, wind: 1.1, r: 2.6, mult: 2.0, up: 6.5, hunt: 9, cd: 6, speed: 4.5 }; // erupts under players who stand still
export const MATRON = { callEvery: 13, callR: 24, aura: 0.25, auraR: 14 };                   // calls nearby lurkers up; lurkers hit harder near her

// The Drowned Sovereign: each phase ADDS attacks. 100-66%: trident sweep + geysers. 66-33%: + Tidal Wave (must-dodge),
// Drowned Thralls, mire pools. Below 33%: + the Deluge (outer ring floods) and homing orb volleys; waves come faster.
export const SOVEREIGN = { // sweep / geyser / wave wind-ups and repeats are paced by shared/data.js (paceMoves)
  phases: [0.66, 0.33], hpBase: 4600, hpPer: 2000,
  sweep: { wind: 1.1, mult: 1.0 },
  geyser: { every: [7, 6, 5], r: 3.0, wind: 1.65, mult: 1.5, extra: [1, 2, 3] },
  wave: { every: [0, 15, 11], first: 3.5, wind: 2.3, speed: 11, width: 1.4, mult: 2.8 },
  thralls: { every: 24, n: 2, max: 4 },
  pools: { every: 10, n: 2, r: 3.8, arm: 1.2, life: 16, tick: 0.5, mult: 0.3, max: 6 },
  deluge: { r: 16.5, tick: 0.5, mult: 0.25 },
  volley: { every: 9, n: 5 },
};
export const PHASE_TEXT2 = ['PHASE 1 · TRIDENT & GEYSERS', 'PHASE 2 · TIDAL WAVE · THRALLS · MIRE POOLS', 'PHASE 3 · THE DELUGE · ORB VOLLEYS'];
