// Life classes (plan: docs/briefs/life-classes.md): a second track beside the combat class. Life skills level 1-10 by
// doing them: gathering (Herbalist, Miner, Fisher, Farmer) and making (Cook, Alchemist, Smith). Shared by the server
// (rules, validation, rolls: server/life.js) and the client (names, prompts, the Life panel: public/life.js).
//
// Everything here is data. Materials are plain ids in inv.mats (shared/crafting.js MATS merges LIFE_MATS), so the
// Smith, the bag and a later town-project system can all ask for them by id.
//
// This module imports only shared/labyrinth.js (which imports nothing), so shared/crafting.js can import it.
import { LABS } from './labyrinth.js';

// ---------- skills ----------
// kind: 'gather' | 'make'. auto: known from the start (no Life Hall visit needed).
export const LIFE_SKILLS = {
  herbalist: { name: 'Herbalist', kind: 'gather', color: '#86efac', desc: 'Pick herbs from patches in the fields.' },
  miner: { name: 'Miner', kind: 'gather', color: '#cbd5e1', desc: 'Break ore from veins in the fields.' },
  fisher: { name: 'Fisher', kind: 'gather', color: '#7dd3fc', desc: 'Fish the pools: wait for the bite, then strike.' },
  farmer: { name: 'Farmer', kind: 'gather', color: '#facc15', desc: 'Grow crops in your garden plot in town.' },
  cook: { name: 'Cook', kind: 'make', color: '#fb923c', desc: 'Cook meals at the town fire: one meal buff at a time.' },
  alchemist: { name: 'Alchemist', kind: 'make', color: '#c084fc', desc: 'Brew potions, tonics and draughts at the bench.' },
  smith: { name: 'Smith', kind: 'make', color: '#f59e0b', desc: 'Levels from everything you do at the Smith.', auto: true },
};
export const LIFE_SKILL_IDS = Object.keys(LIFE_SKILLS);

// XP curve: LIFE_XP[L] = total XP to reach level L (index 0 unused). Level 10 is the cap.
export const LIFE_MAX = 10;
export const LIFE_XP = [0, 0, 60, 160, 320, 540, 840, 1240, 1760, 2420, 3250];
export function lifeLevel(xp) {
  let L = 1;
  while (L < LIFE_MAX && (xp || 0) >= LIFE_XP[L + 1]) L++;
  return L;
}
// { lvl, into, need } for a progress bar (need 0 at the cap).
export function lifeProgress(xp) {
  const lvl = lifeLevel(xp);
  if (lvl >= LIFE_MAX) return { lvl, into: 0, need: 0 };
  return { lvl, into: (xp || 0) - LIFE_XP[lvl], need: LIFE_XP[lvl + 1] - LIFE_XP[lvl] };
}
export const XP_SMITH = { refine: 14, salvage: 6, reforge: 10, craft: 30, reroll: 10 }; // Smith life skill XP per action

// ---------- materials (merged into MATS, shared/crafting.js) ----------
// cat: herb | ore | fish | crop | seed | food. from: the bag tooltip. Every id is a plain material (inv.mats).
export const STACK_MAX = 99; // a life material stops at this many (gathering, harvests and cooking refuse past it)
export const LIFE_MATS = {
  meadowleaf: { name: 'Meadowleaf', cat: 'herb', color: '#86efac', from: 'herb patches on Floor 1 (Herbalist)' },
  bloodcap: { name: 'Bloodcap', cat: 'herb', color: '#f87171', from: 'bloodcap rings on Floor 1 (Herbalist 3)' },
  mireblossom: { name: 'Mireblossom', cat: 'herb', color: '#5eead4', from: 'herb patches on Floor 2 (Herbalist 4)' },
  galebloom: { name: 'Galebloom', cat: 'herb', color: '#a5b4fc', from: 'herb patches on Floor 3 (Herbalist 7)' },
  cryptmoss: { name: 'Crypt Moss', cat: 'herb', color: '#a3e635', from: 'rare patches in the labyrinths (Herbalist 5)' },
  copper: { name: 'Copper Ore', cat: 'ore', color: '#fb923c', from: 'ore veins on Floor 1 (Miner)' },
  iron: { name: 'Iron Ore', cat: 'ore', color: '#94a3b8', from: 'ore veins on Floors 1 and 2 (Miner 3)' },
  silver: { name: 'Mire Silver', cat: 'ore', color: '#e2e8f0', from: 'ore veins on Floor 2 (Miner 5)' },
  stormite: { name: 'Stormite', cat: 'ore', color: '#818cf8', from: 'ore veins on Floor 3 (Miner 7)' },
  minnow: { name: 'Brook Minnow', cat: 'fish', color: '#bae6fd', from: 'fishing pools on Floor 1 (Fisher)' },
  carp: { name: 'Mudcarp', cat: 'fish', color: '#a8a29e', from: 'fishing pools on Floor 2 (Fisher 3)' },
  eel: { name: 'Mire Eel', cat: 'fish', color: '#4ade80', from: 'deep pools on Floor 2 (Fisher 5)' },
  skyfin: { name: 'Skyfin', cat: 'fish', color: '#93c5fd', from: 'cloud pools on Floor 3 (Fisher 7)' },
  wheat: { name: 'Wheat', cat: 'crop', color: '#fde68a', from: 'your garden (Farmer)' },
  carrot: { name: 'Carrot', cat: 'crop', color: '#fb923c', from: 'your garden (Farmer 2)' },
  sunberry: { name: 'Sunberry', cat: 'crop', color: '#facc15', from: 'your garden (Farmer 4)' },
  moonroot: { name: 'Moonroot', cat: 'crop', color: '#c4b5fd', from: 'your garden (Farmer 7)' },
  wheatseed: { name: 'Wheat Seed', cat: 'seed', color: '#fef3c7', from: 'the merchant, herb patches' },
  carrotseed: { name: 'Carrot Seed', cat: 'seed', color: '#fed7aa', from: 'the merchant, herb patches' },
  sunseed: { name: 'Sunberry Seed', cat: 'seed', color: '#fef08a', from: 'the merchant' },
  moonseed: { name: 'Moonroot Seed', cat: 'seed', color: '#ddd6fe', from: 'Floor 3 and labyrinth herb patches' },
  bread: { name: 'Field Bread', cat: 'food', color: '#fcd34d', from: 'the cooking fire (Cook)' },
  fishstew: { name: "Fisher's Stew", cat: 'food', color: '#7dd3fc', from: 'the cooking fire (Cook 2)' },
  carrotpie: { name: 'Carrot Pie', cat: 'food', color: '#fdba74', from: 'the cooking fire (Cook 3)' },
  spicedeel: { name: 'Spiced Eel', cat: 'food', color: '#86efac', from: 'the cooking fire (Cook 5)' },
  feast: { name: 'Tower Feast', cat: 'food', color: '#f0abfc', from: 'the cooking fire (Cook 8)' },
};
for (const m of Object.values(LIFE_MATS)) m.life = true;
export const LIFE_MAT_IDS = Object.keys(LIFE_MATS);
export const LIFE_CATS = { herb: 'Herbs', ore: 'Ore', fish: 'Fish', crop: 'Crops', seed: 'Seeds', food: 'Meals' };

// ---------- meals: timed fight buffs, one at a time ----------
// regen: % of max health a second (any time, also in fights) · posture: +% posture damage · dmg: +% damage · hp: +% max health.
// secs: how long it lasts (counted only while you're online). Eating a new meal replaces the old one.
export const FOODS = {
  bread: { secs: 900, fx: { regen: 0.4 } },
  fishstew: { secs: 900, fx: { posture: 12 } },
  carrotpie: { secs: 900, fx: { hp: 8 } },
  spicedeel: { secs: 900, fx: { dmg: 6 } },
  feast: { secs: 1200, fx: { regen: 0.3, posture: 8, dmg: 4, hp: 5 } },
};
const FX_TEXT = { regen: v => `restore ${v}% health a second`, posture: v => `+${v}% posture damage`, dmg: v => `+${v}% damage`, hp: v => `+${v}% max health` };
export const foodText = id => {
  const f = FOODS[id];
  return f ? `${Object.entries(f.fx).map(([k, v]) => FX_TEXT[k](v)).join(', ')} for ${Math.round(f.secs / 60)} min` : '';
};

// ---------- gathering spots ----------
// Spot types: kind (herb | ore | fish), the skill, lvl (skill level needed), secs (how long gathering takes; fishing:
// the bite comes after bite[0]..bite[1] s and you have `window` s to strike), respawn (s, per player), xp, and
// yields [[mat, chance, min, max]] (rolled each time; one extra of the first yield per BONUS_EVERY levels above lvl).
export const SPOT_KINDS = {
  herb: { skill: 'herbalist', verb: 'gather', doing: 'Gathering', secs: 2.5, respawn: 180 },
  ore: { skill: 'miner', verb: 'mine', doing: 'Mining', secs: 3.5, respawn: 240 },
  fish: { skill: 'fisher', verb: 'fish', doing: 'Fishing', bite: [2, 5], window: 1.2, respawn: 150 },
};
export const BONUS_EVERY = 3;
export const SPOT_TYPES = {
  meadow: { kind: 'herb', name: 'Meadowleaf patch', lvl: 1, xp: 12, yields: [['meadowleaf', 1, 1, 2], ['wheatseed', 0.25, 1, 2], ['carrotseed', 0.12, 1, 1]] },
  bloodring: { kind: 'herb', name: 'Bloodcap ring', lvl: 3, xp: 20, yields: [['bloodcap', 1, 1, 2], ['meadowleaf', 0.4, 1, 1]] },
  mirepatch: { kind: 'herb', name: 'Mireblossom patch', lvl: 4, xp: 26, yields: [['mireblossom', 1, 1, 2], ['carrotseed', 0.2, 1, 1]] },
  galepatch: { kind: 'herb', name: 'Galebloom patch', lvl: 7, xp: 40, yields: [['galebloom', 1, 1, 2], ['moonseed', 0.15, 1, 1]] },
  cryptpatch: { kind: 'herb', name: 'Crypt moss', lvl: 5, xp: 45, rare: true, yields: [['cryptmoss', 1, 1, 2], ['moonseed', 0.35, 1, 1]] },
  coppervein: { kind: 'ore', name: 'Copper vein', lvl: 1, xp: 14, yields: [['copper', 1, 1, 2]] },
  ironvein: { kind: 'ore', name: 'Iron vein', lvl: 3, xp: 22, yields: [['iron', 1, 1, 2], ['copper', 0.3, 1, 1]] },
  silvervein: { kind: 'ore', name: 'Mire Silver vein', lvl: 5, xp: 30, yields: [['silver', 1, 1, 2], ['iron', 0.4, 1, 1]] },
  stormvein: { kind: 'ore', name: 'Stormite vein', lvl: 7, xp: 42, yields: [['stormite', 1, 1, 2]] },
  deepvein: { kind: 'ore', name: 'Deep vein', lvl: 6, xp: 50, rare: true, yields: [['silver', 1, 2, 3], ['stormite', 0.5, 1, 1]] },
  brook: { kind: 'fish', name: 'Fishing pool', lvl: 1, xp: 14, yields: [['minnow', 1, 1, 2]] },
  mirepool: { kind: 'fish', name: 'Mire pool', lvl: 3, xp: 22, yields: [['carp', 1, 1, 2], ['minnow', 0.3, 1, 1]] },
  eelpool: { kind: 'fish', name: 'Deep pool', lvl: 5, xp: 30, yields: [['eel', 1, 1, 1], ['carp', 0.4, 1, 1]] },
  cloudpool: { kind: 'fish', name: 'Cloud pool', lvl: 7, xp: 42, yields: [['skyfin', 1, 1, 2]] },
  skypool: { kind: 'fish', name: 'Sky pool', lvl: 6, xp: 50, rare: true, yields: [['skyfin', 1, 1, 2], ['eel', 0.4, 1, 1]] },
};
export const SPOT_USE = 3.2; // how close you stand to gather (the server allows a little more for lag)

// The spots, by floor (x, z: Floor 2 is x + 600, Floor 3 x + 1200). Checked clear of the scenery by test/life.js.
const F = (dx, list) => list.map(([id, type, x, z]) => ({ id, type, x: x + dx, z }));
const LAB_SPOTS = [ // a few rare ones in the labyrinths: [id, type, layer id, cell i, cell j]
  ['l1moss', 'cryptpatch', 'catacombs', 0, 4], ['l1moss2', 'cryptpatch', 'galleries', 0, 6],
  ['l2vein', 'deepvein', 'drownedwood', 5, 6], ['l2moss', 'cryptpatch', 'reedmarch', 0, 4],
  ['l3pool', 'skypool', 'turningisles', 0, 4], ['l3vein', 'deepvein', 'kitesteps', 0, 4],
];
const layerOf = id => Object.values(LABS).flatMap(l => l.layers).find(L => L.id === id);
export const SPOTS = [
  ...F(0, [ // Floor 1, the Verdant Field
    ['f1h1', 'meadow', -30, 45], ['f1h2', 'meadow', 36, 50], ['f1h3', 'meadow', -55, 99], ['f1h4', 'meadow', 20, 85],
    ['f1h5', 'bloodring', -44, 128], ['f1h6', 'bloodring', 58, 110],
    ['f1o1', 'coppervein', -62, 62], ['f1o2', 'coppervein', 62, 40], ['f1o3', 'coppervein', -20, 110],
    ['f1o4', 'ironvein', 40, 142], ['f1o5', 'ironvein', -64, 146],
    ['f1f1', 'brook', -40, 34], ['f1f2', 'brook', 44, 30], ['f1f3', 'brook', 13, 122],
  ]),
  ...F(600, [ // Floor 2, the Glimmering Mire
    ['f2h1', 'mirepatch', -40, 40], ['f2h2', 'mirepatch', 36, 64], ['f2h3', 'mirepatch', -25, 105], ['f2h4', 'bloodring', 50, 120],
    ['f2o1', 'ironvein', -58, 70], ['f2o2', 'silvervein', 61, 88], ['f2o3', 'silvervein', -50, 140],
    ['f2f1', 'mirepool', -30, 28], ['f2f2', 'mirepool', 30, 30], ['f2f3', 'eelpool', 20, 130], ['f2f4', 'eelpool', -60, 112],
  ]),
  ...F(1200, [ // Floor 3, the Gale Spires
    ['f3h1', 'galepatch', -40, 45], ['f3h2', 'galepatch', 45, 70], ['f3h3', 'galepatch', -30, 120],
    ['f3o1', 'stormvein', -61, 93], ['f3o2', 'stormvein', 56, 125], ['f3o3', 'silvervein', 30, 40],
    ['f3f1', 'cloudpool', -25, 30], ['f3f2', 'cloudpool', 52, 100],
  ]),
  ...LAB_SPOTS.map(([id, type, layer, i, j]) => { const L = layerOf(layer); return { id, type, x: L.x0 + (i + 0.5) * L.cell + L.cell * 0.2, z: L.z0 + (j + 0.5) * L.cell, lab: layer }; }),
];
export const SPOT_BY_ID = Object.fromEntries(SPOTS.map(s => [s.id, s]));
export const spotType = s => SPOT_TYPES[s?.type];
export const spotKind = s => SPOT_KINDS[SPOT_TYPES[s?.type]?.kind];
export const nearSpot = (x, z, pad = 0) => {
  let best = null, bd = SPOT_USE + pad;
  for (const s of SPOTS) { const d = Math.hypot(x - s.x, z - s.z); if (d < bd) { bd = d; best = s; } }
  return best;
};

// Roll a spot's yield for a skill level. rnd: () => [0, 1).
export function rollSpot(type, lvl, rnd = Math.random) {
  const T = SPOT_TYPES[type], out = {};
  if (!T) return out;
  T.yields.forEach(([id, chance, lo, hi], i) => {
    if (rnd() >= chance) return;
    let n = lo + Math.floor(rnd() * (hi - lo + 1));
    if (i === 0) n += Math.floor(Math.max(0, lvl - T.lvl) / BONUS_EVERY);
    out[id] = (out[id] || 0) + n;
  });
  return out;
}

// ---------- the town stations (Town of Beginnings) ----------
// The garden, the cooking fire, the alchemy bench and the Life Hall (where you learn the skills: free).
export const LIFE_HALL = { x: 11, z: -6, r: 2.2, use: 3.6, name: 'Life Hall' };
export const COOK_FIRE = { x: 14, z: 14, r: 1.0, use: 3.2, name: 'Cooking fire' };
export const ALCH_BENCH = { x: 21, z: -2, r: 1.2, use: 3.2, name: 'Alchemy bench' };
export const GARDEN = { x: -12, z: 15, r: 4.2, use: 5.2, name: 'Garden' };
export const STATIONS = { hall: LIFE_HALL, cook: COOK_FIRE, brew: ALCH_BENCH, garden: GARDEN };
export const nearStation = (k, x, z, pad = 0) => { const s = STATIONS[k]; return !!s && Math.hypot(x - s.x, z - s.z) < s.use + pad; };
export const stationAt = (x, z, pad = 0) => Object.keys(STATIONS).find(k => nearStation(k, x, z, pad)) || null;

// ---------- farming ----------
// Each character has their own plot of PLOT_TILES tiles in the garden (instanced: everyone sees their own crops on the
// same tiles). Crops grow in real time (wall clock), across restarts. grow: ms to ripen · yield [min, max] · xp ·
// lvl (Farmer level needed) · seedBack: chance of a seed back on harvest.
export const PLOT_TILES = 6;
export const TILE_OFFSETS = [[-1.7, -1.2], [0, -1.2], [1.7, -1.2], [-1.7, 1.2], [0, 1.2], [1.7, 1.2]];
export const CROPS = {
  wheat: { seed: 'wheatseed', grow: 20 * 60e3, yield: [2, 4], xp: 20, lvl: 1, seedBack: 0.5 },
  carrot: { seed: 'carrotseed', grow: 45 * 60e3, yield: [2, 3], xp: 32, lvl: 2, seedBack: 0.4 },
  sunberry: { seed: 'sunseed', grow: 2 * 3600e3, yield: [2, 4], xp: 60, lvl: 4, seedBack: 0.3 },
  moonroot: { seed: 'moonseed', grow: 6 * 3600e3, yield: [1, 3], xp: 120, lvl: 7, seedBack: 0.25 },
};
export const CROP_IDS = Object.keys(CROPS);
export const cropOfSeed = seed => CROP_IDS.find(c => CROPS[c].seed === seed) || null;
// Bots tending the plot (their creator's own free bots ordered to "tend", or idling in town near the garden): growth
// runs this much faster while at least one is there (it doesn't stack). reach: how close to the garden they count.
export const TEND = { mult: 1.25, reach: 14, every: 5 };
// Growth of a tile { c, at (planted, ms), boost (ms of extra growth from tending) } at time now (ms): 0..1.
export function tileGrowth(tile, now) {
  const C = CROPS[tile?.c];
  if (!C) return 0;
  return Math.max(0, Math.min(1, (now - tile.at + (tile.boost || 0)) / C.grow));
}
export const tileLeft = (tile, now) => { const C = CROPS[tile?.c]; return C ? Math.max(0, C.grow - (now - tile.at + (tile.boost || 0))) : 0; };

// ---------- recipes: cooking (meals) and alchemy (the existing consumables) ----------
// skill, lvl, mats, out: { mats: { id: n } } (a meal) or { cons: { id: n } } (potion / tonic / draught: shared/items.js),
// xp. At DOUBLE_AT levels above the recipe's, a quarter of the batches come out double.
export const DOUBLE_AT = 3;
export const LIFE_RECIPES = [
  { id: 'bread', skill: 'cook', lvl: 1, mats: { wheat: 3 }, out: { mats: { bread: 2 } }, xp: 16 },
  { id: 'fishstew', skill: 'cook', lvl: 2, mats: { minnow: 2, carrot: 1 }, out: { mats: { fishstew: 1 } }, xp: 26 },
  { id: 'carrotpie', skill: 'cook', lvl: 3, mats: { carrot: 3, wheat: 2 }, out: { mats: { carrotpie: 1 } }, xp: 30 },
  { id: 'spicedeel', skill: 'cook', lvl: 5, mats: { eel: 2, meadowleaf: 2 }, out: { mats: { spicedeel: 1 } }, xp: 46 },
  { id: 'feast', skill: 'cook', lvl: 8, mats: { skyfin: 2, sunberry: 2, moonroot: 1 }, out: { mats: { feast: 1 } }, xp: 90 },
  { id: 'potion', skill: 'alchemist', lvl: 1, mats: { meadowleaf: 3 }, out: { cons: { potion: 2 } }, xp: 16 },
  { id: 'tonic', skill: 'alchemist', lvl: 3, mats: { bloodcap: 2, resin: 1 }, out: { cons: { tonic: 2 } }, xp: 30 },
  { id: 'draught', skill: 'alchemist', lvl: 4, mats: { mireblossom: 2, iron: 1 }, out: { cons: { draught: 2 } }, xp: 34 },
  { id: 'potionbatch', skill: 'alchemist', lvl: 6, mats: { mireblossom: 2, meadowleaf: 2, cryptmoss: 1 }, out: { cons: { potion: 5 } }, xp: 48 },
  { id: 'galebrew', skill: 'alchemist', lvl: 8, mats: { galebloom: 2, bloodcap: 2 }, out: { cons: { tonic: 3, draught: 3 } }, xp: 80 },
];
export const LIFE_RECIPE_BY_ID = Object.fromEntries(LIFE_RECIPES.map(r => [r.id, r]));
export const STATION_OF = { cook: 'cook', alchemist: 'brew' }; // a recipe's skill -> the station it needs

// ---------- the saved record (characters.life) ----------
// { skills: { id: xp }, learned: [ids], plot: [tile | null] x PLOT_TILES, food: { id, left (ms) } | null, spots: { spotId: readyAt (ms) } }
export function newLife(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const skills = {};
  for (const id of LIFE_SKILL_IDS) skills[id] = Math.max(0, Math.min(LIFE_XP[LIFE_MAX], Number(s.skills?.[id]) || 0));
  const learned = LIFE_SKILL_IDS.filter(id => LIFE_SKILLS[id].auto || (Array.isArray(s.learned) && s.learned.includes(id)));
  const plot = Array.from({ length: PLOT_TILES }, (_, i) => {
    const t = Array.isArray(s.plot) ? s.plot[i] : null;
    return t && CROPS[t.c] && Number.isFinite(+t.at) ? { c: t.c, at: +t.at, boost: Math.max(0, +t.boost || 0) } : null;
  });
  const food = s.food && FOODS[s.food.id] && +s.food.left > 0 ? { id: s.food.id, left: Math.min(FOODS[s.food.id].secs * 1000, +s.food.left) } : null;
  const spots = {};
  for (const [k, v] of Object.entries(s.spots || {})) if (SPOT_BY_ID[k] && Number.isFinite(+v)) spots[k] = +v;
  return { skills, learned, plot, food, spots };
}
export const knows = (life, id) => !!life?.learned?.includes(id);
export const skillLevel = (life, id) => lifeLevel(life?.skills?.[id] || 0);
