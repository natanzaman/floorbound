// Shared game data and helpers, imported by both the server and the browser client.

export const TICK_RATE = 20;
export const PLAYER_SPEED = 7;
export const SPRINT_SPEED = 10; // automatic when out of combat for a few seconds
export const SPRINT_AFTER = 3;   // seconds without dealing or taking damage
export const PLAYER_RADIUS = 0.5;
export const MAX_LEVEL = 10;
export const PARTY_MAX = 6;

// Dodge roll: a short burst of movement with invulnerability frames.
export const DODGE = { dist: 5.2, time: 0.34, iframes: 0.42, cd: 1.1 };
// Jump: cosmetic hop, but you're airborne (and safe from ground slams) for most of it.
export const JUMP = { time: 0.65, height: 1.1, airFrom: 0.08, airTo: 0.58, cd: 0.75 };
// Switch: a "break" hit staggers an enemy; the next hit from a DIFFERENT player is a Switch.
export const SWITCH = { window: 2.4, bossWindow: 1.8, bossCd: 9, first: 2.5, follow: 1.4 };

export const WORLD = {
  rect: { x0: -70, x1: 70, z0: -35, z1: 158 },
  corridor: { x0: -5, x1: 5, z0: 150, z1: 168 },
  arena: { x: 0, z: 190, r: 26 },
  town: { x: 0, z: 0, r: 26 },
};

export const inTown = (x, z) => Math.hypot(x - WORLD.town.x, z - WORLD.town.z) < WORLD.town.r;
export const inArena = (x, z) => Math.hypot(x - WORLD.arena.x, z - WORLD.arena.z) < WORLD.arena.r;

// Raid gate: a portcullis across the corridor to the Warden's chamber. It opens after a ready check.
export const GATE = { z: 161, half: 5.6, band: [157.5, 165.5], zone: { x: 12, z0: 138, z1: 158 }, count: 5 };
export const inGateZone = (x, z) => Math.abs(x) < GATE.zone.x && z > GATE.zone.z0 && z < GATE.zone.z1;
const gateBlocks = (x, z) => Math.abs(x) < GATE.half && z > GATE.band[0] && z < GATE.band[1];
// Does a move from (x0,z0) to (x1,z1) pass through the closed gate?
export const crossesGate = (x0, z0, x1, z1) => (z0 < GATE.z) !== (z1 < GATE.z) && Math.abs((x0 + x1) / 2) < GATE.half + 1;

export function walkable(x, z, gateClosed = false) {
  if (gateClosed && gateBlocks(x, z)) return false;
  const { rect, corridor } = WORLD;
  if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return true;
  if (x >= corridor.x0 && x <= corridor.x1 && z >= corridor.z0 && z <= corridor.z1) return true;
  return inArena(x, z);
}

export function areaName(x, z) {
  if (inTown(x, z)) return 'Town of Beginnings';
  if (inArena(x, z)) return "Warden's Chamber";
  if (z > 148) return 'Chamber Gate';
  return 'Floor 1 — Verdant Field';
}

export function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Static obstacles (deterministic so client and server agree).
export const OBSTACLES = (() => {
  const r = rng(42);
  const out = [];
  const houses = [[-16, -12], [16, -12], [-18, 8], [18, 8], [-8, -20], [8, -20]];
  for (const [x, z] of houses) out.push({ kind: 'house', x, z, r: 3.4, rot: Math.atan2(-x, -z) });
  out.push({ kind: 'fountain', x: 0, z: 0, r: 3 });
  let n = 0, tries = 0;
  while (n < 110 && tries < 8000) {
    tries++;
    const x = -68 + r() * 136, z = 30 + r() * 126;
    if (Math.abs(x) < 7) continue; // keep the main road clear
    if (out.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 3)) continue;
    const big = r() < 0.3;
    out.push({ kind: r() < 0.15 ? 'rock' : 'tree', x, z, r: big ? 1.3 : 0.9, s: big ? 1.5 : 1 });
    n++;
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    out.push({ kind: 'pillar', x: WORLD.arena.x + Math.cos(a) * 21, z: WORLD.arena.z + Math.sin(a) * 21, r: 1.6 });
  }
  return out;
})();

export function resolveCollision(x, z, rad = PLAYER_RADIUS) {
  for (const o of OBSTACLES) {
    const dx = x - o.x, dz = z - o.z;
    const m = o.r + rad;
    if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
    const d = Math.hypot(dx, dz);
    if (d < m && d > 1e-4) { x = o.x + (dx / d) * m; z = o.z + (dz / d) * m; }
  }
  return [x, z];
}

// Face angle convention: direction = (sin f, cos f) on the (x, z) plane.
export const angleTo = (x0, z0, x1, z1) => Math.atan2(x1 - x0, z1 - z0);
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export const CLASS_IDS = ['swordsman', 'guardian', 'cleric'];

export const CLASSES = {
  swordsman: {
    name: 'Swordsman', role: 'Damage', hp: 100, atk: 12, color: 0x3b82f6,
    blurb: 'Fast blade combos and dashes. Hits hard, takes hits poorly.',
    skills: [
      { id: 'slash', name: 'Slash', cd: 0.55, lvl: 1, desc: '3-hit combo; the third swing hits harder and knocks back.' },
      { id: 'rush', name: 'Rush', cd: 6, lvl: 1, desc: 'Dash forward, striking everything in your path.' },
      { id: 'whirl', name: 'Whirl', cd: 8, lvl: 1, desc: 'Spin and hit everything around you.' },
      { id: 'burst', name: 'Burst Combo', cd: 14, lvl: 3, desc: '4-hit sword skill. The finisher BREAKS the target, opening a Switch.', brk: true },
    ],
  },
  guardian: {
    name: 'Guardian', role: 'Tank', hp: 150, atk: 8, color: 0xf59e0b,
    blurb: 'Sword and shield. Holds aggro and keeps the party alive.',
    skills: [
      { id: 'bash', name: 'Bash', cd: 0.7, lvl: 1, desc: '3-hit combo with extra threat; the third hit knocks back.' },
      { id: 'taunt', name: 'Taunt', cd: 10, lvl: 1, desc: 'Pull nearby enemies onto you; take 30% less damage for 4s.' },
      { id: 'wall', name: 'Shield Wall', cd: 14, lvl: 1, desc: 'Take 60% less damage for 4s.' },
      { id: 'gslam', name: 'Ground Slam', cd: 12, lvl: 3, desc: 'Area hit that BREAKS enemies, opening a Switch.', brk: true },
    ],
  },
  cleric: {
    name: 'Cleric', role: 'Healer', hp: 85, atk: 9, color: 0x22c55e,
    blurb: 'Heals and buffs allies, smites from range.',
    skills: [
      { id: 'smite', name: 'Smite', cd: 0.8, lvl: 1, desc: 'Ranged bolt. Hitting an enemy mid wind-up interrupts and BREAKS it.' },
      { id: 'heal', name: 'Heal', cd: 4, lvl: 1, desc: 'Heal the most hurt ally nearby.' },
      { id: 'bless', name: 'Blessing', cd: 20, lvl: 1, desc: 'Allies nearby deal 25% more damage for 8s.' },
      { id: 'sanct', name: 'Sanctuary', cd: 18, lvl: 3, desc: 'Healing circle for 5s.' },
    ],
  },
};

export const MOB_IDS = ['boar', 'wolf', 'warden', 'alpha', 'spitter', 'hound'];

export const MOBS = {
  boar: { name: 'Forest Boar', hp: 60, atk: 6, speed: 4.5, aggro: 0, range: 1.8, atkCd: 1.6, xp: 20, radius: 0.8, level: 2 },
  wolf: { name: 'Dire Wolf', hp: 110, atk: 11, speed: 6.2, aggro: 11, range: 2.0, atkCd: 1.3, xp: 40, radius: 0.8, level: 5 },
  alpha: { name: 'Alpha Wolf', hp: 480, atk: 15, speed: 6.6, aggro: 14, range: 2.4, atkCd: 1.4, xp: 150, radius: 1.2, level: 7, elite: true },
  spitter: { name: 'Bramble Spitter', hp: 80, atk: 10, speed: 0, aggro: 17, range: 15, atkCd: 2.2, xp: 30, radius: 0.9, level: 4, ranged: true },
  hound: { name: "Warden's Hound", hp: 90, atk: 12, speed: 6.6, aggro: 30, range: 2.0, atkCd: 1.2, xp: 15, radius: 0.8, level: 8 },
  warden: { name: 'The Horned Warden', hp: 2400, atk: 26, speed: 4.2, aggro: 18, range: 4.2, atkCd: 2.0, xp: 600, radius: 2.2, level: 10, boss: true },
};

export const xpToNext = lvl => 50 * lvl;

// Melee bites hit a wedge in front of the attacker (shown as a red wedge during the wind-up).
export const BITE = { boar: [2.6, 0.7], wolf: [2.8, 0.6], alpha: [3.4, 0.85], hound: [2.8, 0.6] }; // [reach, half-angle]
export const PACK = { auraRange: 12, auraAtk: 0.25, howlEvery: 12, howlRange: 16, frenzy: 6 };
// The Warden's three phases: 100-66% (cleave + slams), 66-33% (+ hounds, horn charge), <33% (+ spin, rockfall).
export const WARDEN = {
  phases: [0.66, 0.33], hpBase: 2400, hpPer: 900,
  slam: { every: [8, 6, 4.5], r: 5.5, wind: 1.2, mult: 2.0 },
  charge: { every: 11, len: 15, width: 2.4, wind: 1.1, mult: 2.2 },
  hounds: { every: 28, n: 2, max: 3 },
  spin: { every: 9, r: 8, wind: 1.4, mult: 1.6 },
  rock: { every: 7, r: 3.2, wind: 1.3, extra: 3, mult: 1.5 },
};
export const THORN = { speed: 16, radius: 0.6, wind: 0.75 };

export function statsFor(cls, lvl) {
  const c = CLASSES[cls];
  return { maxHp: Math.round(c.hp * (1 + 0.1 * (lvl - 1))), atk: c.atk * (1 + 0.08 * (lvl - 1)) };
}
