// Shared game data and helpers, imported by both the server and the browser client.
import { F2, F2_MOB_IDS, F2_MOBS, F2_BITE, SOVEREIGN, inCamp2, walkable2, areaName2, floor2Obstacles } from './floor2.js';
import { F3, F3_MOB_IDS, F3_MOBS, F3_BITE, F3_RARES, COLOSSUS, inCamp3, walkable3, areaName3, floor3Obstacles } from './floor3.js';
import { LANCER } from './classes/lancer.js';
import { BARD } from './classes/bard.js';
import { RANGER } from './classes/ranger.js';
import { BERSERKER } from './classes/berserker.js';

export const TICK_RATE = 20;
// Ability pacing: every player skill's use time (draws, leaps, gaps between hits) and every boss wind-up is x PACE, so
// abilities read clearly; damage and cooldowns are unchanged (a skill's cooldown starts when its last hit lands:
// server/pacing.js). Instant skills stay instant. The client plays skill clips at speed / PACE. PACE = 1 undoes it all.
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
export const PLAYER_SPEED = 7;
export const SPRINT_SPEED = 10; // automatic when out of combat for a few seconds
export const SPRINT_AFTER = 3;   // seconds without dealing or taking damage
export const PLAYER_RADIUS = 0.5;
export const MAX_LEVEL = 30; // Floor 3 (docs/floor3.md) raised it from 20
export const PARTY_MAX = 6;

// Dodge roll: a short burst of movement with invulnerability frames.
export const DODGE = { dist: 5.2, time: 0.34, iframes: 0.42, cd: 0.825 };
// Jump: cosmetic hop, but you're airborne (and safe from ground slams) for most of it.
// air: in the air you can steer at up to this fraction of your ground speed (more if you took off faster); steer: how
// quickly (per s) your air velocity turns toward where you're steering (on the ground it's instant). See airStep.
export const JUMP = { time: 0.65, height: 1.1, airFrom: 0.08, airTo: 0.58, cd: 0.75, air: 0.8, steer: 5 };
// Air control, shared by client prediction and the bots: v ({ x, z }, m/s) keeps its momentum and eases toward the
// input direction (dx, dz: unit vector, or 0, 0 for none) at the speed you took off with, at least JUMP.air x `want`
// (your ground speed now) and never above it. No input = keep drifting. Never faster than on the ground, so the
// server's movement check (onInput) accepts every airborne step.
export function airStep(v, dx, dz, want, dt) {
  if (!dx && !dz) return v;
  const sp = Math.min(want, Math.max(want * JUMP.air, Math.hypot(v.x, v.z))), k = Math.min(1, dt * JUMP.steer);
  v.x += (dx * sp - v.x) * k; v.z += (dz * sp - v.z) * k;
  return v;
}
// Switch: a "break" hit staggers an enemy; the next hit from a DIFFERENT player is a Switch.
export const SWITCH = { window: 2.4, bossWindow: 1.8, bossCd: 9, first: 2.5, follow: 1.4 };

export const WORLD = {
  rect: { x0: -70, x1: 70, z0: -35, z1: 158 },
  corridor: { x0: -5, x1: 5, z0: 150, z1: 168 },
  arena: { x: 0, z: 190, r: 26 },
  town: { x: 0, z: 0, r: 26 },
};

export const inTown = (x, z) => Math.hypot(x - WORLD.town.x, z - WORLD.town.z) < WORLD.town.r || inCamp2(x, z) || inCamp3(x, z); // the Floor 2 and 3 camps are safe zones too
export const inArena = (x, z) => Math.hypot(x - WORLD.arena.x, z - WORLD.arena.z) < WORLD.arena.r;

// Raid gate: a portcullis across the corridor to the Warden's chamber. It opens after a ready check.
export const GATE = { z: 161, half: 5.6, band: [157.5, 165.5], zone: { x: 12, z0: 138, z1: 158 }, count: 5, force: 20 };
export const inGateZone = (x, z) => Math.abs(x) < GATE.zone.x && z > GATE.zone.z0 && z < GATE.zone.z1;
const gateBlocks = (x, z) => Math.abs(x) < GATE.half && z > GATE.band[0] && z < GATE.band[1];
// Does a move from (x0,z0) to (x1,z1) pass through the closed gate?
export const crossesGate = (x0, z0, x1, z1) => (z0 < GATE.z) !== (z1 < GATE.z) && Math.abs((x0 + x1) / 2) < GATE.half + 1;

export function walkable(x, z, gateClosed = false) {
  if (x > F3.split) return walkable3(x, z, gateClosed); // Floor 3 (shared/floor3.js): gateClosed means its Storm Gate
  if (x > F2.split) return walkable2(x, z, gateClosed); // Floor 2: gateClosed means Floor 2's gate there
  if (gateClosed && gateBlocks(x, z)) return false;
  const { rect, corridor } = WORLD;
  if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return true;
  if (x >= corridor.x0 && x <= corridor.x1 && z >= corridor.z0 && z <= corridor.z1) return true;
  return inArena(x, z);
}

export function areaName(x, z) {
  if (x > F3.split) return areaName3(x, z);
  if (x > F2.split) return areaName2(x, z);
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
  out.push(...floor2Obstacles()); // waystones + Floor 2 (see shared/floor2.js)
  out.push(...floor3Obstacles()); // Floor 3 (see shared/floor3.js)
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
      { id: 'burst', name: 'Burst Combo', cd: 14, lvl: 3, desc: '4-hit sword skill. The finisher deals heavy posture damage: fill it to BREAK the target and open a Switch.', brk: true },
    ],
  },
  guardian: {
    name: 'Guardian', role: 'Tank', hp: 150, atk: 8, color: 0xf59e0b,
    blurb: 'Sword and shield. Holds aggro and keeps the party alive.',
    skills: [
      { id: 'bash', name: 'Bash', cd: 0.7, lvl: 1, desc: '3-hit combo with extra threat; the third hit knocks back.' },
      { id: 'taunt', name: 'Taunt', cd: 10, lvl: 1, desc: 'Pull nearby enemies onto you; take 30% less damage for 4s.' },
      { id: 'wall', name: 'Shield Wall', cd: 14, lvl: 1, desc: 'Take 60% less damage for 4s.' },
      { id: 'gslam', name: 'Ground Slam', cd: 12, lvl: 3, desc: 'Area hit with heavy posture damage: fill it to BREAK enemies and open a Switch.', brk: true },
    ],
  },
  cleric: {
    name: 'Cleric', role: 'Healer', hp: 85, atk: 9, color: 0x22c55e,
    blurb: 'Heals and buffs allies, smites from range.',
    skills: [
      { id: 'smite', name: 'Smite', cd: 0.8, lvl: 1, desc: 'Ranged bolt. Hitting an enemy mid wind-up interrupts it and deals big posture damage.' },
      { id: 'heal', name: 'Heal', cd: 4, lvl: 1, desc: 'Heal the most hurt ally nearby.' },
      { id: 'bless', name: 'Blessing', cd: 20, lvl: 1, desc: 'Allies nearby deal 25% more damage for 8s.' },
      { id: 'sanct', name: 'Sanctuary', cd: 18, lvl: 3, desc: 'Healing circle for 5s.' },
    ],
  },
};
// Ranger and Berserker (shared/classes/), appended so existing class indices never move.
CLASS_IDS.push('ranger', 'berserker');
Object.assign(CLASSES, { ranger: RANGER, berserker: BERSERKER });

// Lancer and Bard (shared/classes/), appended so existing class indices never move. Resolve indices via CLASS_IDS.
CLASS_IDS.push('lancer', 'bard');
Object.assign(CLASSES, { lancer: LANCER, bard: BARD });

export const MOB_IDS = ['boar', 'wolf', 'warden', 'alpha', 'spitter', 'hound', 'oldtusk', 'ghostfang', 'thornmother'];

export const MOBS = {
  boar: { name: 'Forest Boar', hp: 60, atk: 6, speed: 4.5, aggro: 0, range: 1.8, atkCd: 1.6, xp: 20, radius: 0.8, level: 2 },
  wolf: { name: 'Dire Wolf', hp: 110, atk: 11, speed: 6.2, aggro: 11, range: 2.0, atkCd: 1.3, xp: 40, radius: 0.8, level: 5 },
  alpha: { name: 'Alpha Wolf', hp: 480, atk: 15, speed: 6.6, aggro: 14, range: 2.4, atkCd: 1.4, xp: 150, radius: 1.2, level: 7, elite: true },
  spitter: { name: 'Bramble Spitter', hp: 80, atk: 10, speed: 0, aggro: 17, range: 15, atkCd: 2.2, xp: 30, radius: 0.9, level: 4, ranged: true },
  hound: { name: "Warden's Hound", hp: 90, atk: 12, speed: 6.6, aggro: 30, range: 2.0, atkCd: 1.2, xp: 15, radius: 0.8, level: 8 },
  warden: { name: 'The Horned Warden', hp: 2400, atk: 38, posture: 1200, speed: 4.2, aggro: 18, range: 4.2, atkCd: 2.0, xp: 600, radius: 2.2, level: 10, boss: true },
  // Rare named elites: one at a time, announced server-wide, temporary (see RARE).
  oldtusk: { name: 'Old Tusk', hp: 600, atk: 14, speed: 5.0, aggro: 10, range: 2.2, atkCd: 1.5, xp: 160, radius: 1.4, level: 6, elite: true, rare: true },
  ghostfang: { name: 'Ghostfang', hp: 750, atk: 16, speed: 7.2, aggro: 14, range: 2.4, atkCd: 1.2, xp: 200, radius: 1.3, level: 8, elite: true, rare: true, howl: true },
  thornmother: { name: 'Thornmother', hp: 700, atk: 12, speed: 0, aggro: 18, range: 16, atkCd: 2.4, xp: 180, radius: 1.5, level: 7, elite: true, rare: true, ranged: true, spread: 3 },
};

// Floor 2 enemies (shared/floor2.js), appended so existing type indices never move.
MOB_IDS.push(...F2_MOB_IDS);
Object.assign(MOBS, F2_MOBS);
// Floor 3 enemies (shared/floor3.js), appended after Floor 2's.
MOB_IDS.push(...F3_MOB_IDS);
Object.assign(MOBS, F3_MOBS);

export const xpToNext = lvl => 50 * lvl;

// Melee bites hit a wedge in front of the attacker (shown as a red wedge during the wind-up).
export const BITE = { boar: [2.6, 0.7], wolf: [2.8, 0.6], alpha: [3.4, 0.85], hound: [2.8, 0.6], oldtusk: [3.6, 0.8], ghostfang: [3.4, 0.85] }; // [reach, half-angle]
Object.assign(BITE, F2_BITE, F3_BITE);
export const PACK = { auraRange: 12, auraAtk: 0.25, howlEvery: 12, howlRange: 16, frenzy: 6 };
// The Warden's three phases: 100-66% (cleave + slams), 66-33% (+ hounds, horn charge), <33% (+ spin, rockfall).
// Quake Rings and the Horn Sweep come in every phase (more rings / more often later).
export const WARDEN = {
  // Scaled to the fighters in the chamber when it engages (server/game.js scaleWarden). Party weight = the sum of each
  // fighter's role weight (hpRole: a damage dealer counts more than a healer); health = (hpBase + hpPer * weight^hpExp)
  // * (1 + hpLvl * levels above 10); damage = atk * (1 + atkLvl * levels above 10) * (1 + atkPer * fighters above 3).
  phases: [0.66, 0.33], hpBase: 2400, hpPer: 680, hpExp: 2.05, hpLvl: 0.12, atkLvl: 0.06, atkPer: 0.25,
  hpRole: { Tank: 0.6, Healer: 0.5, Support: 0.8, Damage: 1.2 },
  // A filmed director show (server/director.js) keeps the scaling its episodes were rehearsed against (before the G5
  // balance pass): the scripted fights' pacing and Break cues depend on it.
  show: { hpBase: 2000, hpExp: 1.8, atkPer: 0.12, atk: 34 },
  slam: { every: [6.5, 5, 3.75], r: 5.5, wind: 1.6, mult: 3.0, per: 3 }, // one slam circle per `per` fighters (on different ones)
  charge: { every: 9.5, len: 15, width: 2.4, wind: 1.5, mult: 3.0 },
  cleave: { wind: 0.75 }, // its basic axe swing (a wedge in front of it)
  hounds: { every: 24, n: 2, max: 3 },
  spin: { every: 8, r: 8, wind: 1.85, mult: 2.2 },
  rock: { every: 6, r: 3.2, wind: 1.6, extra: 3, mult: 2.3 },
  // Wind-ups (`wind`, s) are long enough to read the pose and the telegraph and get ready: each big attack has its own wind-up pose (public/world.js WINDUPS).
  // Quake Ring: the Warden rears up and stomps; shockwave rings roll out along the floor from where it stands.
  // Jump over the wavefront (airborne as it passes you), roll through it (i-frames), or be beyond `max` m.
  // rings per phase, `gap` s apart; `w`: half-thickness of the wavefront (m); speed in m/s.
  quake: { every: [15, 12, 9.5], first: [9, 5, 4], wind: 2.0, speed: 9, w: 0.55, max: 15, mult: 2.7, rings: [1, 2, 3], gap: 0.95 },
};
paceMoves(WARDEN, ['slam', 'charge', 'cleave', 'spin', 'rock', 'quake']); // slower, readable wind-ups (PACE above)
paceMoves(SOVEREIGN, ['sweep', 'geyser', 'wave', 'deluge']); // shared/floor2.js can't import this file, so it is paced here
paceMoves(COLOSSUS, ['cleave', 'strike', 'gust', 'beam']); // Floor 3's boss (shared/floor3.js), likewise
export const THORN = { speed: 16, radius: 0.6, wind: 0.75 };
// Rare named spawns: at most one alive; first after `first` s, then `every` s after the last one is gone.
export const RARE = {
  first: [180, 300], every: [360, 600], despawn: 300, soon: 10,
  spawns: { // biome per rare: x range, z range, and the area name used in the announcement
    oldtusk: { x: [-60, 60], z: [38, 93], where: 'the Verdant Field' },
    ghostfang: { x: [-60, 60], z: [100, 145], where: 'the Wolf Woods' },
    thornmother: { x: [-60, 60], z: [55, 140], where: 'the Verdant Field' },
    ...F3_RARES, // Floor 3: Skyrender, the Old Bastion (shared/floor3.js)
  },
  spreadAngle: 0.28, // radians between Thornmother's thorns
};

export function statsFor(cls, lvl) {
  const c = CLASSES[cls];
  return { maxHp: Math.round(c.hp * (1 + 0.1 * (lvl - 1))), atk: c.atk * (1 + 0.08 * (lvl - 1)) };
}

// ---------- combat core: posture, perfect dodge, guard/parry, perilous attacks ----------
// Posture (break meter): every hit fills it; when full the enemy is BROKEN (staggered, Switch window) and it resets.
// Max posture is a fraction of max HP by tier (a mob def can override it with `posture: N`).
export const POSTURE = {
  frac: { normal: 0.6, elite: 0.4, boss: 0.35 },
  heavy: 2,                       // heavy hits / combo finishers fill posture this many times faster
  // Big chunks, as a fraction of max posture: [normal / elite, boss]
  brk: [0.55, 0.2],               // Break skills (Burst Combo finisher, Ground Slam)
  smite: [0.4, 0.15],             // Smite landing while the enemy winds up an attack
  perfect: [0.5, 0.15],           // a perfect dodge against its attack
  parry: [0.6, 0.22],             // a Guardian parry
  decayAfter: 2.5,                // seconds without being hit before posture drains
  decay: [0.15, 0.05],            // fraction of max drained per second
};
export function postureMax(def, maxHp = def.hp) {
  if (def.posture) return def.boss ? def.posture * (maxHp / def.hp) : def.posture;
  return Math.max(10, Math.round(maxHp * POSTURE.frac[def.boss ? 'boss' : def.elite ? 'elite' : 'normal']));
}
// Perfect dodge: the roll started at most `window` s before the hit landed.
export const PERFECT = { window: 0.2, counter: 1.5, dmg: 1.5, posture: 2 };
// Guardian guard (hold R): frontal hits (within `arc` rad of facing) take `dr` less damage; a press <= `parry` s before a hit negates it.
export const GUARD = { arc: (70 * Math.PI) / 180, dr: 0.7, parry: 0.2, speed: 0.5, repress: 0.6 };
// The Warden's perilous Horn Sweep: dodge (i-frames) or parry it; shields, guard, gear and jumping don't help.
export const SWEEP = paceMoves({ r: 9, wind: 1.2, frac: 0.8, every: [12.5, 9.5, 7.5], first: 9 }, null);
