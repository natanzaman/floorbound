// Items: gear (weapon, armour, charm), consumables, drops and the town shop.
// Shared by the server (rolls, stats) and the client (names, colours, tooltips).
import { LANCER_WEAPONS } from './classes/lancer.js';
import { BARD_WEAPONS } from './classes/bard.js';
import { RANGER_WEAPONS } from './classes/ranger.js';
import { BERSERKER_WEAPONS } from './classes/berserker.js';
import { applyStyleTo } from './styles.js'; // weapon styles (shared/styles.js)

export const RARITY = [
  { id: 'common', name: 'Common', color: '#e5e7eb', sell: 5 },
  { id: 'uncommon', name: 'Uncommon', color: '#4ade80', sell: 12 },
  { id: 'rare', name: 'Rare', color: '#60a5fa', sell: 30 },
  { id: 'epic', name: 'Epic', color: '#c084fc', sell: 75 },
  { id: 'legend', name: 'Last Attack', color: '#fbbf24', sell: 150 },
  { id: 'keepsake', name: 'Keepsake', color: '#f0abfc', sell: 0 }, // story items: no stats, never sold, salvaged, refined or dropped
];
export const KEEPSAKE = 5; // RARITY index

export const SLOTS = ['weapon', 'armor', 'charm'];
export const BAG_SIZE = 24;

// Stat ranges by rarity (percent). Rolled ±15%.
const WEAPON_ATK = [4, 8, 13, 19, 25];
const ARMOR_HP = [5, 10, 16, 23, 30];
const CHARM = {
  crit: { name: 'Keenness', stat: [3, 5, 8, 11, 15], label: v => `+${v}% critical chance` },
  haste: { name: 'Haste', stat: [4, 7, 10, 13, 18], label: v => `${v}% faster skill cooldowns` },
  sw: { name: 'the Switch', stat: [10, 20, 30, 45, 60], label: v => `+${v}% Switch damage` },
};
const STAT_LABEL = {
  atk: v => `+${v}% damage`, hp: v => `+${v}% max health`, dr: v => `${v}% less damage taken`,
  crit: CHARM.crit.label, haste: CHARM.haste.label, sw: CHARM.sw.label,
};
export const statLabel = (k, v) => (STAT_LABEL[k] ? STAT_LABEL[k](v) : `${k} ${v}`);

const WEAPON_NAMES = {
  swordsman: ['Iron Blade', 'Tempered Blade', 'Duskglass Saber', 'Stormedge'],
  guardian: ['Iron Longsword', 'Tempered Longsword', 'Bastion Brand', 'Oathkeeper'],
  cleric: ['Ash Staff', 'Willow Staff', 'Lumen Staff', 'Dawnspire'],
};
Object.assign(WEAPON_NAMES, { ranger: RANGER_WEAPONS, berserker: BERSERKER_WEAPONS }); // shared/classes/
const ARMOR_NAMES = ['Padded Vest', 'Riveted Jerkin', 'Wardensteel Mail', 'Aegis of the Field'];
const CHARM_PREFIX = ['Worn', 'Fine', 'Gleaming', 'Radiant'];
Object.assign(WEAPON_NAMES, { lancer: LANCER_WEAPONS, bard: BARD_WEAPONS }); // Lancer, Bard (shared/classes/)

export const CONSUMABLES = {
  potion: { name: 'Health Potion', desc: 'Restore 40% of your health.', price: 15, key: '4', cd: 10 },
  tonic: { name: 'Battle Tonic', desc: 'Deal 15% more damage for 30 s.', price: 30, key: '5', cd: 2 },
  draught: { name: 'Ironbark Draught', desc: 'Take 15% less damage for 30 s.', price: 30, key: '6', cd: 2 },
};
export const CONSUMABLE_IDS = Object.keys(CONSUMABLES);

// What the merchant in town sells (gear is for your class, Uncommon).
export const SHOP = [
  { kind: 'cons', id: 'potion' }, { kind: 'cons', id: 'tonic' }, { kind: 'cons', id: 'draught' },
  { kind: 'gear', slot: 'weapon', price: 140 }, { kind: 'gear', slot: 'armor', price: 140 },
  { kind: 'gear', slot: 'weapon', price: 170, alt: 1 }, // an Uncommon weapon in your class's alternate style (shared/styles.js altStyle)
];
export const MERCHANT = { x: 9, z: 3, r: 4 };

let uid = Date.now() % 1e6;
const vary = (base, rnd) => Math.max(1, Math.round(base * (0.85 + rnd() * 0.3)));

// Build a gear item. rarity: 0..4. charmKind optional. style (weapons): undefined = class default, 'roll' = random, or a style id.
export function makeItem(slot, rarity, cls, rnd = Math.random, charmKind, style) {
  const it = { u: ++uid, slot, r: rarity, st: {} };
  if (slot === 'weapon') {
    it.cls = cls;
    it.name = WEAPON_NAMES[cls][Math.min(3, rarity)];
    it.st.atk = vary(WEAPON_ATK[rarity], rnd);
    if (rarity >= 3) it.st.crit = vary(3, rnd);
    applyStyleTo(it, cls, rnd, style);
  } else if (slot === 'armor') {
    it.name = ARMOR_NAMES[Math.min(3, rarity)];
    it.st.hp = vary(ARMOR_HP[rarity], rnd);
    if (rarity >= 2) it.st.dr = vary(rarity >= 3 ? 5 : 3, rnd);
  } else {
    const kinds = Object.keys(CHARM);
    const k = charmKind || kinds[Math.floor(rnd() * kinds.length)];
    it.name = `${CHARM_PREFIX[Math.min(3, rarity)]} Charm of ${CHARM[k].name}`;
    it.st[k] = vary(CHARM[k].stat[rarity], rnd);
  }
  return it;
}

// The Last Attack Bonus: only whoever lands the killing blow on the Warden gets this.
export function lastAttackItem() {
  return { u: ++uid, slot: 'charm', r: 4, name: 'Horn of the Warden', st: { crit: 10, haste: 8, sw: 40 }, la: 1 };
}

// The Floor 2 Last Attack Bonus: only whoever lands the killing blow on the Drowned Sovereign gets this.
export function lastAttackItem2() {
  return { u: ++uid, slot: 'armor', r: 4, name: "Sovereign's Tidecloak", st: { hp: 30, dr: 10, haste: 6 }, la: 2 };
}

// The Floor 3 Last Attack Bonus: only whoever lands the killing blow on the Storm Colossus gets this.
export function lastAttackItem3() {
  return { u: ++uid, slot: 'charm', r: 4, name: 'Stormheart', st: { atk: 12, crit: 8, haste: 8 }, la: 3 };
}

// A keepsake (server/staging.js giveKeepsake): a named memento with a line of text and no stats. It can be worn, but
// it can't be sold, salvaged, refined, reforged, dropped or deleted.
export function keepsakeItem(name, slot = 'charm', desc = '') {
  return { u: ++uid, slot, r: KEEPSAKE, name: String(name || 'Keepsake').slice(0, 40), st: {}, ks: 1, desc: String(desc || '').slice(0, 200) };
}
export const isKeepsake = it => !!it?.ks;

// Rarity tables (weights for common..epic).
const TABLES = {
  field: [62, 28, 9, 1],
  elite: [0, 55, 35, 10],
  boss: [0, 0, 70, 30],
  rare: [0, 20, 55, 25],
};
Object.assign(TABLES, { mire: [40, 40, 17, 3], mireElite: [0, 30, 48, 22], boss2: [0, 0, 45, 55] }); // Floor 2
Object.assign(TABLES, { spire: [25, 45, 25, 5], spireRare: [0, 10, 50, 40], boss3: [0, 0, 30, 70] }); // Floor 3 (its drops: LOOT in shared/loot.js)
export function rollRarity(table, rnd = Math.random) {
  const w = TABLES[table];
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; }
  return 0;
}

// Per-kill drops. Each eligible player gets their own roll (no loot fights).
export const DROPS = {
  boar: { gold: [2, 4], item: 0.06, potion: 0.1, table: 'field' },
  wolf: { gold: [4, 7], item: 0.1, potion: 0.12, table: 'field' },
  spitter: { gold: [3, 5], item: 0.08, potion: 0.1, table: 'field' },
  hound: { gold: [1, 2], item: 0, potion: 0.15, table: 'field' },
  alpha: { gold: [25, 40], item: 1, potion: 0.5, table: 'elite' },
  warden: { gold: [120, 160], item: 2, potion: 1, table: 'boss' },
  oldtusk: { gold: [40, 70], item: 1, potion: 1, table: 'rare' },
  ghostfang: { gold: [40, 70], item: 1, potion: 1, table: 'rare' },
  thornmother: { gold: [40, 70], item: 1, potion: 1, table: 'rare' },
};

Object.assign(DROPS, { // the Undercrypt (shared/labyrinth.js): its enemies, its chests (deep: in a far dead end)
  ghoul: { gold: [3, 6], item: 0.08, potion: 0.12, table: 'field' },
  tombwarden: { gold: [10, 18], item: 0.25, potion: 0.3, table: 'field' },
  gravekeeper: { gold: [60, 90], item: 1, potion: 1, table: 'elite' },
  cryptchest: { gold: [15, 30], item: 1, potion: 0.5, table: 'field' },
  cryptchestdeep: { gold: [30, 55], item: 1, potion: 1, table: 'elite' },
});

Object.assign(DROPS, { // the Weeping Thicket and the Windrift Causeways (shared/labyrinth.js)
  mirelurker: { gold: [8, 13], item: 0.12, potion: 0.14, table: 'mire' },
  mosshag: { gold: [18, 28], item: 0.3, potion: 0.3, table: 'mire' },
  motherofmire: { gold: [90, 130], item: 1, potion: 1, table: 'mireElite' },
  thicketchest: { gold: [30, 50], item: 1, potion: 0.5, table: 'mire' },
  thicketchestdeep: { gold: [50, 80], item: 1, potion: 1, table: 'mireElite' },
  stormharpy: { gold: [12, 20], item: 0.14, potion: 0.15, table: 'spire' },
  kiterider: { gold: [26, 38], item: 0.3, potion: 0.3, table: 'spire' },
  galematriarch: { gold: [140, 190], item: 1, potion: 1, table: 'spireRare' },
  skychest: { gold: [45, 70], item: 1, potion: 0.5, table: 'spire' },
  skychestdeep: { gold: [70, 110], item: 1, potion: 1, table: 'spireRare' },
});

Object.assign(DROPS, { // Floor 2
  shieldback: { gold: [8, 14], item: 0.13, potion: 0.14, table: 'mire' },
  wisp: { gold: [7, 12], item: 0.11, potion: 0.12, table: 'mire' },
  lurker: { gold: [8, 13], item: 0.13, potion: 0.14, table: 'mire' },
  thrall: { gold: [2, 4], item: 0, potion: 0.2, table: 'mire' },
  matron: { gold: [50, 80], item: 1, potion: 0.6, table: 'mireElite' },
  sovereign: { gold: [260, 340], item: 2, potion: 2, table: 'boss2' },
});
Object.assign(DROPS, { // enemies that force a role (shared/mobroles.js)
  ironboar: { gold: [6, 10], item: 0.15, potion: 0.15, table: 'field' },
  bulwark: { gold: [10, 16], item: 0.16, potion: 0.15, table: 'mire' },
  hexer: { gold: [9, 15], item: 0.15, potion: 0.15, table: 'mire' },
  harrier: { gold: [13, 21], item: 0.15, potion: 0.15, table: 'spire' },
});


export const RANDOM_SLOT = rnd => SLOTS[Math.floor(rnd() * SLOTS.length)];

// Sum of equipped stats.
export function gearStats(eq) {
  const s = { atk: 0, hp: 0, dr: 0, crit: 0, haste: 0, sw: 0 };
  for (const slot of SLOTS) {
    const it = eq?.[slot];
    if (!it) continue;
    for (const [k, v] of Object.entries(it.st)) s[k] = (s[k] || 0) + v;
  }
  return s;
}

export const sellPrice = it => RARITY[it.r]?.sell ?? 1;
export const newInventory = () => ({ bag: [], eq: { weapon: null, armor: null, charm: null }, cons: { potion: 3, tonic: 0, draught: 0 } });
