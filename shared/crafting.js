// Crafting: materials, the town Smith (refine, salvage, reforge, recipes).
// Shared by the server (validation, costs, results) and the client (names, costs, the Smith panel).
import { RANGER_CRAFT } from './classes/ranger.js';
import { BERSERKER_CRAFT } from './classes/berserker.js';

// Materials live in inv.mats { id: count }, not in bag slots.
export const MATS = {
  tusk: { name: 'Boar Tusk', color: '#e7dcc0', from: 'Forest Boars' },
  pelt: { name: 'Wolf Pelt', color: '#a8a29e', from: 'Dire Wolves' },
  resin: { name: 'Thorn Resin', color: '#bef264', from: 'Bramble Spitters' },
  fang: { name: 'Alpha Fang', color: '#fcd34d', from: 'Alpha Wolves' },
  core: { name: 'Rare Core', color: '#f87171', from: 'rare named monsters' },
  horn: { name: 'Horn Shard', color: '#c084fc', from: 'the Horned Warden' },
  dust: { name: 'Dust', color: '#d1d5db', from: 'salvaging Common gear' },
  ess: { name: 'Essence', color: '#60a5fa', from: 'salvaging Uncommon and Rare gear' },
  prism: { name: 'Prism', color: '#e879f9', from: 'salvaging Epic gear' },
};
export const MAT_IDS = Object.keys(MATS);

// Material drops per mob type: [mat, chance, min, max]. Each eligible player rolls their own.
export const MAT_DROPS = {
  boar: [['tusk', 0.6, 1, 2]],
  wolf: [['pelt', 0.6, 1, 2]],
  spitter: [['resin', 0.7, 1, 2]],
  hound: [['pelt', 0.3, 1, 1]],
  alpha: [['fang', 1, 1, 2], ['pelt', 1, 1, 3]],
  oldtusk: [['core', 1, 1, 1], ['tusk', 1, 3, 5]],
  ghostfang: [['core', 1, 1, 1], ['pelt', 1, 3, 5]],
  thornmother: [['core', 1, 1, 1], ['resin', 1, 3, 5]],
  warden: [['horn', 1, 2, 4], ['core', 0.25, 1, 1]],
};
export function rollMats(type, rnd = Math.random) {
  const out = {};
  for (const [id, chance, lo, hi] of MAT_DROPS[type] || []) {
    if (rnd() >= chance) continue;
    out[id] = (out[id] || 0) + lo + Math.floor(rnd() * (hi - lo + 1));
  }
  return out;
}

// The Smith's anvil and forge, on the far side of the plaza from the field road.
export const SMITH = { x: 0, z: -13, r: 3.5 };
export const nearSmithAt = (x, z, pad = 1.5) => Math.hypot(x - SMITH.x, z - SMITH.z) < SMITH.r + pad;

// ---------- refine (+1..+5) ----------
export const REFINE_MAX = 5;
export const REFINE_STEP = 0.1; // each level adds +10% of the item's base stats
const SLOT_MATS = { weapon: ['tusk', 'fang'], armor: ['pelt', 'fang'], charm: ['resin', 'core'] };
const REFINE_GOLD = [30, 60, 100, 160, 250];
const REFINE_MAIN = [3, 5, 6, 8, 10];
const REFINE_SECOND = [0, 0, 1, 2, 3];
const REFINE_HORN = [0, 0, 0, 1, 2];
const REFINE_ESS = [0, 0, 1, 1, 2];

// Cost to go from it.lv to it.lv + 1 (null when maxed).
export function refineCost(it) {
  const lv = it.lv || 0;
  if (lv >= REFINE_MAX) return null;
  const [main, second] = SLOT_MATS[it.slot] || SLOT_MATS.charm;
  const mats = { [main]: REFINE_MAIN[lv] };
  if (REFINE_SECOND[lv]) mats[second] = REFINE_SECOND[lv];
  if (REFINE_ESS[lv]) mats.ess = REFINE_ESS[lv];
  if (REFINE_HORN[lv]) mats.horn = REFINE_HORN[lv];
  return { gold: Math.round(REFINE_GOLD[lv] * (1 + 0.25 * Math.min(4, it.r || 0))), mats };
}

export const baseName = it => it.bn || it.name;
export const refinedName = (name, lv) => (lv > 0 ? `${name} +${lv}` : name);
// Recompute an item's stats and name from its base stats and refine level.
export function applyRefine(it) {
  const lv = it.lv || 0;
  if (!it.b) it.b = { ...it.st };
  if (!it.bn) it.bn = it.name;
  it.st = {};
  for (const [k, v] of Object.entries(it.b)) it.st[k] = Math.round(v * (1 + REFINE_STEP * lv) * 10) / 10;
  it.name = refinedName(it.bn, lv);
  return it;
}

// ---------- salvage ----------
export const SALVAGE = [{ dust: 2 }, { dust: 1, ess: 1 }, { ess: 2 }, { ess: 2, prism: 1 }];
// What salvaging returns: the rarity yield plus half the main/second materials spent refining it.
export function salvageYield(it) {
  if (!SALVAGE[it.r]) return null; // Last Attack items can't be salvaged
  const out = { ...SALVAGE[it.r] };
  const [main, second] = SLOT_MATS[it.slot] || SLOT_MATS.charm;
  let m = 0, s = 0;
  for (let l = 0; l < (it.lv || 0); l++) { m += REFINE_MAIN[l]; s += REFINE_SECOND[l]; }
  if (Math.floor(m / 2)) out[main] = (out[main] || 0) + Math.floor(m / 2);
  if (Math.floor(s / 2)) out[second] = (out[second] || 0) + Math.floor(s / 2);
  return out;
}

// ---------- reforge ----------
// 'stats': reroll the stat values within the item's rarity range. 'affix': a charm gets a different affix.
export const CHARM_AFFIXES = ['crit', 'haste', 'sw'];
export function reforgeCost(it, mode) {
  if (it.r > 3 || it.cr || it.la) return null; // crafted and Last Attack items are fixed
  if (mode === 'affix' && it.slot !== 'charm') return null;
  if (mode !== 'affix' && mode !== 'stats') return null;
  const mats = { ess: [1, 1, 2, 3][it.r] + (mode === 'affix' ? 1 : 0) };
  if (it.r >= 3) mats.prism = 1;
  return { gold: [15, 30, 60, 120][it.r], mats };
}
export const charmAffix = it => CHARM_AFFIXES.find(k => (it.b || it.st)[k] !== undefined);

// ---------- recipes ----------
const CLASS_WEAPON = { swordsman: 'Blade', guardian: 'Longsword', cleric: 'Staff' };
Object.assign(CLASS_WEAPON, { ranger: RANGER_CRAFT, berserker: BERSERKER_CRAFT }); // shared/classes/
export const RECIPES = [
  { id: 'tuskbreaker', name: 'Tuskbreaker', slot: 'weapon', r: 2, cls: true, st: { atk: 15, crit: 3 },
    gold: 150, mats: { tusk: 12, dust: 4, ess: 1 }, desc: 'Boar-ivory edge. Your class.' },
  { id: 'peltmantle', name: 'Pelt Mantle', slot: 'armor', r: 2, st: { hp: 18, dr: 4 },
    gold: 150, mats: { pelt: 12, dust: 4, ess: 1 }, desc: 'Layered dire-wolf hide.' },
  { id: 'resinhaste', name: 'Resin Charm of Haste', slot: 'charm', r: 2, st: { haste: 12 },
    gold: 150, mats: { resin: 10, dust: 4, ess: 1 }, desc: 'Amber that hums.' },
  { id: 'fangsigil', name: 'Fang Sigil', slot: 'charm', r: 2, st: { sw: 35 },
    gold: 200, mats: { fang: 3, pelt: 4, ess: 2 }, desc: 'A Switch charm carved from an Alpha fang.' },
  { id: 'keenfang', name: 'Keen Fang Charm', slot: 'charm', r: 2, st: { crit: 9 },
    gold: 180, mats: { fang: 2, resin: 6, ess: 2 }, desc: 'Strikes find the gaps.' },
  { id: 'hornplate', name: 'Hornplate', slot: 'armor', r: 3, st: { hp: 26, dr: 6 },
    gold: 400, mats: { horn: 4, fang: 2, pelt: 6, ess: 3 }, desc: 'Plates of the Warden\'s own horn.' },
  { id: 'wardenforged', name: 'Warden-Forged', slot: 'weapon', r: 3, cls: true, st: { atk: 22, crit: 4 },
    gold: 500, mats: { horn: 6, core: 2, ess: 3 }, desc: 'Horn and rare core, forged together. Your class.' },
  { id: 'thornheart', name: 'Thornheart Talisman', slot: 'charm', r: 3, st: { haste: 12, sw: 25 },
    gold: 400, mats: { core: 2, resin: 8, prism: 1 }, desc: 'A rare core wrapped in living thorn.' },
];
export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map(r => [r.id, r]));
export const recipeName = (rc, cls) => (rc.cls ? `${rc.name} ${CLASS_WEAPON[cls] || 'Blade'}` : rc.name);

// ---------- helpers ----------
export const hasMats = (have, need) => Object.entries(need || {}).every(([k, v]) => (have?.[k] || 0) >= v);
export const canAfford = (gold, mats, cost) => !!cost && gold >= cost.gold && hasMats(mats, cost.mats);
export const matsText = m => Object.entries(m || {}).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${MATS[k]?.name || k}`).join(', ');
