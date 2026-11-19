// Floor 3 — The Gale Spires. Map, enemies, Storm Colossus tuning, twists and helpers, shared by the server and the client.
// Floor 3 lives in the same coordinate space as Floors 1 and 2, 1200 units east (everything with x > F3.split is Floor 3).
// Same skeleton as the floors below (camp in the south, field, corridor + raid gate at z≈161, boss plateau at z≈191),
// so z-based heuristics (gate, boss bar, music) work on every floor. Design: docs/floor3.md.
// This module imports nothing (shared/floor2.js and shared/data.js import it).

export const F3 = {
  x: 1200, split: 900,
  rect: { x0: 1132, x1: 1268, z0: -30, z1: 158 },
  corridor: { x0: 1195, x1: 1205, z0: 150, z1: 168 },
  arena: { x: 1200, z: 191, r: 27 },
  camp: { x: 1200, z: 0, r: 18 },
};

export const onFloor3 = x => x > F3.split;
export const inCamp3 = (x, z, pad = 0) => Math.hypot(x - F3.camp.x, z - F3.camp.z) < F3.camp.r + pad;
export const inArena3 = (x, z) => Math.hypot(x - F3.arena.x, z - F3.arena.z) < F3.arena.r;

// The Storm Gate (same shape as the floors below, shifted east).
export const GATE3 = { x: 1200, z: 161, half: 5.6, band: [157.5, 165.5], zone: { x: 12, z0: 138, z1: 158 }, count: 5, force: 20 };
export const inGateZone3 = (x, z) => Math.abs(x - GATE3.x) < GATE3.zone.x && z > GATE3.zone.z0 && z < GATE3.zone.z1;
const gate3Blocks = (x, z) => Math.abs(x - GATE3.x) < GATE3.half && z > GATE3.band[0] && z < GATE3.band[1];
export const crossesGate3 = (x0, z0, x1, z1) => (z0 < GATE3.z) !== (z1 < GATE3.z) && Math.abs((x0 + x1) / 2 - GATE3.x) < GATE3.half + 1;

export function walkable3(x, z, gateClosed = false) {
  if (gateClosed && gate3Blocks(x, z)) return false;
  const { rect, corridor } = F3;
  if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return true;
  if (x >= corridor.x0 && x <= corridor.x1 && z >= corridor.z0 && z <= corridor.z1) return true;
  return inArena3(x, z);
}

export function areaName3(x, z) {
  if (inCamp3(x, z)) return 'Windbreak Camp';
  if (inArena3(x, z)) return 'The Eye of the Storm';
  if (z > 148) return 'The Storm Gate';
  if (z > 98) return 'Floor 3 — The Broken Aqueduct';
  return 'Floor 3 — The Windswept Steps';
}

// Travel: Windbreak Camp's waystone (shared/floor2.js WAYSTONES lists every floor's), and the Stairway that opens in the
// Drowned Sovereign's court for a while after a kill. Floor 3 unlocks once a character has helped kill the Sovereign.
export const WAYSTONE3 = { floor: 3, x: 1200, z: -9, r: 1.4, name: 'Windbreak Camp' };
export const STAIRWAY3 = { x: 600, z: 207, r: 2.2, use: 3.6, secs: 60, floor: 3 };
export const FLOOR_NAMES = { 1: 'Floor 1 — Verdant Field', 2: 'Floor 2 — The Glimmering Mire', 3: 'Floor 3 — The Gale Spires' };
export const FLOOR_BOSS = { 1: 'warden', 2: 'sovereign', 3: 'colossus' }; // the boss type per floor
export const FLOOR_X = { 1: 0, 2: 600, 3: 1200 };                         // each floor's road (x)
export const unlocked3 = stats => (stats?.sovereignKills || 0) > 0 || (stats?.floor3 || 0) > 0;

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

// Static obstacles for Floor 3 (deterministic): appended to OBSTACLES in data.js. (Its waystone comes with WAYSTONES.)
export function floor3Obstacles() {
  const out = [];
  const { camp, arena } = F3;
  out.push({ kind: 'brazier', x: camp.x, z: camp.z, r: 1.2 });
  for (const [dx, dz] of [[-11, -6], [11, -6], [-12, 7], [12, 7]]) out.push({ kind: 'tent3', x: camp.x + dx, z: camp.z + dz, r: 2.2, rot: Math.atan2(-dx, -dz) });
  // windbreak walls: low stacked-stone arcs on the camp's west and east (wind) sides
  for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
    const a = side * Math.PI / 2 + i * 0.16;
    out.push({ kind: 'windwall', x: camp.x + Math.sin(a) * (camp.r - 0.6), z: camp.z + Math.cos(a) * (camp.r - 0.6), r: 1.4, rot: a });
  }
  const r = rng(3033);
  const clear = (x, z, pad) => !out.some(o => Math.hypot(o.x - x, o.z - z) < o.r + pad);
  let n = 0, tries = 0;
  while (n < 70 && tries < 9000) { // standing stones and broken columns across the terraces
    tries++;
    const x = F3.rect.x0 + 3 + r() * (F3.rect.x1 - F3.rect.x0 - 6), z = 26 + r() * 126;
    if (Math.abs(x - F3.x) < 7) continue; // keep the road clear
    if (!clear(x, z, 3.6)) continue;
    const col = z > 98 && r() < 0.5;
    out.push(col ? { kind: 'column', x, z, r: 1.0, h: 3 + r() * 5, tilt: (r() - 0.5) * 0.3 } : { kind: 'menhir', x, z, r: 0.9, s: 0.8 + r() * 0.8, rot: r() * 6.28 });
    n++;
  }
  for (const z of [104, 124, 144]) for (const sx of [-1, 1]) { // aqueduct piers flanking the road
    const x = F3.x + sx * 16;
    if (clear(x, z, 1)) out.push({ kind: 'pier', x, z, r: 1.6 });
  }
  for (let i = 0; i < 6; i++) { // storm pylons around the Eye of the Storm
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    out.push({ kind: 'pylon', x: arena.x + Math.cos(a) * 22.5, z: arena.z + Math.sin(a) * 22.5, r: 1.3 });
  }
  return out;
}

// ---------- enemies (appended to MOBS / MOB_IDS in data.js) ----------
// ai: the Game method that runs this mob (server/floor3.js). f3: lives on Floor 3.
export const F3_MOB_IDS = ['ram', 'harpy', 'acolyte', 'sentinel', 'skyrender', 'bastion', 'colossus'];
export const F3_MOBS = {
  ram: { name: 'Crag Ram', hp: 1300, atk: 40, speed: 4.4, aggro: 11, range: 2.6, atkCd: 2.0, xp: 260, radius: 1.2, level: 21, f3: true, ai: 'f3Ram' },
  harpy: { name: 'Gale Harpy', hp: 800, atk: 36, speed: 5.6, aggro: 15, range: 2.4, atkCd: 1.6, xp: 240, radius: 0.9, level: 22, f3: true, ai: 'f3Harpy', fly: true },
  acolyte: { name: 'Storm Acolyte', hp: 700, atk: 34, speed: 3.4, aggro: 16, range: 14, atkCd: 3.2, xp: 250, radius: 0.8, level: 23, f3: true, ai: 'f3Acolyte', ranged: true },
  sentinel: { name: 'Spire Sentinel', hp: 2000, atk: 46, speed: 2.6, aggro: 10, range: 2.8, atkCd: 2.4, xp: 380, radius: 1.4, level: 24, f3: true, ai: 'f3Sentinel', armor: 0.55 },
  // rare named elites (the rare-spawn system: one at a time, announced server-wide)
  skyrender: { name: 'Skyrender', hp: 5200, atk: 44, speed: 6.2, aggro: 18, range: 2.8, atkCd: 1.4, xp: 900, radius: 1.3, level: 26, f3: true, ai: 'f3Harpy', fly: true, dives: 3, elite: true, rare: true },
  bastion: { name: 'The Old Bastion', hp: 7500, atk: 52, speed: 2.8, aggro: 12, range: 3.2, atkCd: 2.2, xp: 1100, radius: 1.9, level: 27, f3: true, ai: 'f3Sentinel', armor: 0.65, calls: 2, elite: true, rare: true },
  colossus: { name: 'The Storm Colossus', hp: 16000, atk: 54, speed: 3.8, aggro: 20, range: 5.0, atkCd: 2.3, xp: 5000, radius: 2.6, level: 28, f3: true, ai: 'f3Colossus', boss: true, f3boss: true },
};
export const F3_BITE = { ram: [3.2, 0.7], harpy: [2.8, 0.7], sentinel: [3.4, 0.8], skyrender: [3.4, 0.8], bastion: [4.2, 0.9], colossus: [6.4, 0.95] };

// Where Floor 3's field mobs live: [type, count, x range, z range]
export const F3_SPAWNS = [
  ['ram', 7, [1140, 1260], [34, 96]],
  ['harpy', 7, [1140, 1260], [40, 140]],
  ['acolyte', 6, [1140, 1260], [60, 146]],
  ['sentinel', 5, [1140, 1260], [102, 146]],
];
// Rare spawns (merged into RARE.spawns in data.js): x range, z range, and the area named in the announcement.
export const F3_RARES = {
  skyrender: { x: [1140, 1260], z: [40, 140], where: 'the Windswept Steps' },
  bastion: { x: [1140, 1260], z: [100, 146], where: 'the Broken Aqueduct' },
};

// Crag Ram: lowers its horns (a lane), then charges through it. Hit = damage + thrown back. Guarding it head-on stops it dead.
export const RAM = { every: 7, first: 2.5, wind: 1.1, len: 13, width: 1.6, speed: 18, mult: 1.6, shove: 6, stun: 2.5, minD: 4 };
// Gale Harpy: aloft = melee hits do `aloft` damage (ranged from `rangedD` m do full). Dives along a lane, then grounded.
export const HARPY = { aloft: 0.35, rangedD: 6, every: 6.5, first: 2, wind: 1.0, len: 12, width: 1.3, speed: 20, mult: 1.5, grounded: 3, groundedRare: 4, weak: 1.25, keep: [5, 9], leash: 26, chain: 0.7 };
// Storm Acolyte: Wind Ward (a channel; interrupt it) and lightning strikes from range.
export const ACOLYTE = { wardEvery: 12, wardFirst: 4, channel: 2.2, wardR: 12, shield: 0.3, shieldD: 10, breakHits: 3, boltWind: 1.5, boltR: 2.6, boltMult: 1.4, keep: [8, 13], leash: 24 };
// Spire Sentinel: armoured until Broken (then cracked for `crack` s); a stomp around itself.
export const SENTINEL = { crack: 8, stompEvery: 9, stompFirst: 4, stompR: 4.5, stompRBig: 6.5, stompWind: 1.4, stompMult: 1.7 };

// The Storm Colossus. Each phase ADDS attacks. 100-66%: Hammerfall, Lightning Strikes, Gale Push. 66-33%: + OVERLOAD (a
// team mechanic: Break it and Switch, or Team Burst, before the channel ends), Gale Harpies. Below 33%: + Tempest Beam
// (jump it or roll through it), Overload more often. Wind-ups and repeats are paced by shared/data.js (paceMoves).
export const COLOSSUS = {
  phases: [0.66, 0.33],
  // Health scales with the fighters who walk in (like the Warden): (hpBase + hpPer * weight^hpExp) * (1 + hpLvl * avg
  // levels above 28); weight = the sum of role weights. Damage = atk * (1 + atkPer * fighters above 3).
  hpBase: 9000, hpPer: 4300, hpExp: 1.35, hpLvl: 0.05, atkPer: 0.18,
  hpRole: { Tank: 0.7, Healer: 0.6, Support: 0.8, Damage: 1.2 },
  cleave: { wind: 0.9, mult: 1.0 },
  strike: { every: [7, 6, 5], first: 4, r: 3.2, wind: 1.7, mult: 1.6, extra: [1, 3, 3] },
  gust: { every: [11, 10, 9], first: 7, wind: 1.5, r: 11, half: 0.75, mult: 1.6, shove: 7 },
  overload: { every: [0, 30, 26], first: 5, channel: 8, posture: 0.5, clap: 0.55, charged: 15, chargedMult: 1.25, stun: 4, weakD: 8, weak: 1.3 },
  harpies: { every: 26, n: 2, max: 3, first: 6 },
  beam: { every: [0, 0, 14], first: 4, wind: 2.2, turn: 7, sweep: Math.PI * 2, len: 26, w: 0.8, mult: 2.6, from: 0.5 },
};
export const PHASE_TEXT3 = ['PHASE 1 · HAMMERFALL · LIGHTNING · GALE PUSH', 'PHASE 2 · OVERLOAD · HARPIES', 'PHASE 3 · TEMPEST BEAM'];

// The Colossus's twists: one rolled per spawn (like the Warden's). reward: extra loot rolls per player / extra gold fraction.
export const F3_TWISTS = {
  tailwind: { name: 'Tailwind', color: '#7dd3fc', short: 'Gale Push throws farther, more often', desc: 'Gale Push throws 50% farther and comes 3 s sooner.', reward: { loot: 1 }, shove: 1.5, gustSooner: 3 },
  thunderhead: { name: 'Thunderhead', color: '#a5b4fc', short: '+2 strays, strikes chain', desc: 'Two more Lightning Strike strays, and every strike lands again 1.2 s later.', reward: { gold: 0.5 }, extra: 2, chain: 1.2 },
  stoneskin: { name: 'Stoneskin', color: '#d6d3d1', short: '35% less damage unless Broken or Grounded', desc: 'Takes 35% less damage unless Broken or Grounded; Grounded lasts 2 s longer.', reward: { loot: 1 }, taken: 0.65, stun: 2 },
  static: { name: 'Static', color: '#fde047', short: 'Overload from phase 1, shorter channel', desc: 'Overload from phase 1, and its channel is 1.5 s shorter.', reward: { loot: 1, gold: 0.5 }, from: 0, shorter: 1.5 },
  calm: { name: 'Calm', color: '#94a3b8', short: 'No twist', desc: 'A rare calm at the summit: no twist.', reward: {} },
};
export const F3_TWIST_IDS = Object.keys(F3_TWISTS);
