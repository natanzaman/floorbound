// Weapon styles: each class has three ways to fight, picked by the equipped weapon (item.style; none = the class default).
// A style changes how the basic attack plays (combo timings, reach, hit shapes), adds one passive and tweaks one skill.
// Shared by the server (server/styles.js: combos, passives, skill tweaks) and the client (public/styles.js: models,
// animations, hit effects, tooltips). No imports, so items.js / crafting.js can import it without a cycle.

// Order is the wire format (the style index at the end of each snapshot player row): append only, never reorder.
export const STYLE_IDS = ['sword', 'dual', 'rapier', 'shield', 'mace', 'spear', 'staff', 'tome', 'wand'];

// basic: the styled basic attack (default styles have none: the original combo in game.js runs unchanged).
//   cd: seconds between presses · window: seconds to keep the combo going · aim: auto-aim range (client)
//   steps[i]: one press of the combo. shape 'arc' (r, half), 'line' (len, w: a thrust through everything in a line),
//   'ring' (r: around you), 'bolt' (len: the first enemy along a ray). mult: x attack. knock, heavy (x2 posture),
//   frac: extra posture chunk [normal/elite, boss], twin: a second identical hit this many seconds later.
// mods: numeric tweaks read by game.js through styleNum(p, key, default).
export const STYLES = {
  // ---------- Swordsman ----------
  sword: {
    cls: 'swordsman', name: 'One-Handed Sword', noun: 'Blade', def: true,
    desc: 'Balanced 3-hit combo; the third swing hits harder and knocks back.',
  },
  dual: {
    cls: 'swordsman', name: 'Dual Blades', noun: 'Dual Blades',
    desc: 'Fast 4-hit combo with lighter hits. The 4th is a double strike with extra posture damage.',
    passive: 'Each Switch you land cuts your skill cooldowns by 0.5 s.',
    tweak: 'Burst Combo strikes 6 times.',
    mods: { burstHits: 6, switchCdr: 0.5 },
    basic: {
      cd: 0.4, window: 0.9, aim: 6, threat: 1,
      steps: [
        { shape: 'arc', r: 2.8, half: 1.0, mult: 0.72, knock: 0.2 },
        { shape: 'arc', r: 2.8, half: 1.0, mult: 0.72, knock: 0.2 },
        { shape: 'arc', r: 2.8, half: 1.0, mult: 0.72, knock: 0.2 },
        { shape: 'arc', r: 3.1, half: 1.15, mult: 0.7, knock: 0.8, heavy: true, frac: [0.06, 0.02], twin: 0.14, fin: true },
      ],
    },
  },
  rapier: {
    cls: 'swordsman', name: 'Rapier', noun: 'Rapier',
    desc: 'Thrusting 3-hit combo with longer reach that pierces a line. +10% critical chance.',
    passive: 'Perfect-dodge counters deal 40% more damage.',
    tweak: 'Rush is a longer lunge (12 m instead of 8 m).',
    mods: { rushSteps: 24, counterDmg: 1.4, crit: 0.1 },
    basic: {
      cd: 0.6, window: 1.0, aim: 7, threat: 1,
      steps: [
        { shape: 'line', len: 4.6, w: 0.6, mult: 1.05, knock: 0.25 },
        { shape: 'line', len: 4.6, w: 0.6, mult: 1.05, knock: 0.25 },
        { shape: 'line', len: 5.4, w: 0.8, mult: 1.5, knock: 1.2, heavy: true, fin: true },
      ],
    },
  },
  // ---------- Guardian ----------
  shield: {
    cls: 'guardian', name: 'Sword & Shield', noun: 'Longsword', def: true,
    desc: 'Balanced 3-hit combo with extra threat; the third hit knocks back.',
  },
  mace: {
    cls: 'guardian', name: 'Mace & Shield', noun: 'Mace & Shield',
    desc: 'Slow, heavy blunt combo with big posture damage; the third blow sends out a shockwave.',
    passive: 'Breaks you cause last 1.2 s longer (0.6 s on bosses).',
    tweak: 'Ground Slam radius +20%.',
    mods: { slamR: 1.2, breakBonus: [1.2, 0.6] },
    basic: {
      cd: 0.95, window: 1.4, aim: 6, threat: 2.5,
      steps: [
        { shape: 'arc', r: 3.0, half: 1.0, mult: 1.25, knock: 0.5, heavy: true },
        { shape: 'arc', r: 3.0, half: 1.0, mult: 1.25, knock: 0.5, heavy: true },
        { shape: 'arc', r: 3.6, half: 1.4, mult: 2.0, knock: 2.5, heavy: true, frac: [0.18, 0.06], fin: true },
      ],
    },
  },
  spear: {
    cls: 'guardian', name: 'Spear & Shield', noun: 'Spear & Shield',
    desc: 'Long-reach poking combo that hits everything in a line.',
    passive: '+50% threat from everything you do.',
    tweak: 'Taunt range +30%.',
    mods: { tauntR: 1.3, threat: 1.5 },
    basic: {
      cd: 0.75, window: 1.1, aim: 7, threat: 2.5,
      steps: [
        { shape: 'line', len: 4.8, w: 0.7, mult: 0.95, knock: 0.3 },
        { shape: 'line', len: 4.8, w: 0.7, mult: 0.95, knock: 0.3 },
        { shape: 'line', len: 5.6, w: 0.9, mult: 1.5, knock: 1.6, heavy: true, fin: true },
      ],
    },
  },
  // ---------- Cleric ----------
  staff: {
    cls: 'cleric', name: 'Staff', noun: 'Staff', def: true,
    desc: 'Smite: a ranged bolt that interrupts wind-ups.',
  },
  tome: {
    cls: 'cleric', name: 'Mace & Tome', noun: 'Mace & Tome',
    desc: 'Melee 3-hit combo instead of the bolt. Every press that lands heals the most hurt ally nearby a little.',
    passive: 'Hits heal the most hurt ally within 12 m (3% of their health + 2).',
    tweak: 'Smite becomes a melee shockwave: the third blow hits all around you and interrupts wind-ups.',
    mods: { tomeHeal: [0.03, 2, 12] }, // [fraction of the ally's max health, flat, range]
    basic: {
      cd: 0.7, window: 1.1, aim: 4.5, threat: 1,
      steps: [
        { shape: 'arc', r: 3.0, half: 1.0, mult: 1.0, knock: 0.3 },
        { shape: 'arc', r: 3.0, half: 1.0, mult: 1.0, knock: 0.3 },
        { shape: 'ring', r: 3.6, mult: 1.3, knock: 1.4, heavy: true, interrupt: true, fin: true },
      ],
    },
  },
  wand: {
    cls: 'cleric', name: 'Wand', noun: 'Wand',
    desc: 'Faster, longer bolts (12 m) with lower damage; still interrupts wind-ups.',
    passive: 'Bolts that hit a Broken enemy heal the ally who Broke it (5% of their health).',
    tweak: 'Heal reaches 50% farther (22 m).',
    mods: { healR: 1.5, wandAid: 0.05 },
    basic: {
      cd: 0.5, window: 1.0, aim: 12.5, threat: 1,
      steps: [{ shape: 'bolt', len: 12, w: 1.2, mult: 0.72, interrupt: true }],
    },
  },
};

export const CLASS_STYLES = {};
for (const id of STYLE_IDS) (CLASS_STYLES[STYLES[id].cls] ||= []).push(id);
export const defaultStyle = cls => CLASS_STYLES[cls]?.find(id => STYLES[id].def) || null;
// The merchant's alternate weapon for a class (the first non-default style).
export const altStyle = cls => CLASS_STYLES[cls]?.find(id => !STYLES[id].def) || null;
export const styleIndex = id => Math.max(0, STYLE_IDS.indexOf(id));
export const validStyle = (id, cls) => !!STYLES[id] && STYLES[id].cls === cls;
// The style an item gives a class (a weapon without a valid style, or no weapon: the class default).
export function styleOf(it, cls) {
  const s = it?.style;
  return s && validStyle(s, cls) ? s : defaultStyle(cls);
}

// Item names: [rarity 0..3] prefix + the style's noun. Default-style weapons keep their classic names (items.js).
const PREFIX = {
  swordsman: ['Iron', 'Tempered', 'Duskglass', 'Storm'],
  guardian: ['Iron', 'Tempered', 'Bastion', 'Oathbound'],
  cleric: ['Ash', 'Willow', 'Lumen', 'Dawn'],
};
export const styleItemName = (id, rarity) => `${PREFIX[STYLES[id].cls]?.[Math.min(3, rarity)] || 'Fine'} ${STYLES[id].noun}`;

// Drops: the class default is the most common.
const ROLL = { def: 0.5 }; // chance of the default style; the rest is split evenly between the others
export function rollStyle(cls, rnd = Math.random) {
  const list = CLASS_STYLES[cls];
  if (!list) return null;
  if (rnd() < ROLL.def) return defaultStyle(cls);
  const others = list.filter(id => !STYLES[id].def);
  return others[Math.floor(rnd() * others.length)] || defaultStyle(cls);
}

// Give a fresh weapon its style (called from makeItem). style: undefined = default (unchanged), 'roll' = random, or an id.
export function applyStyleTo(it, cls, rnd, style) {
  if (!style) return it;
  const id = style === 'roll' ? rollStyle(cls, rnd) : style;
  if (!validStyle(id, cls) || STYLES[id].def) return it;
  it.style = id;
  it.name = styleItemName(id, it.r);
  return it;
}

// Crafting: one recipe per non-default style (appended to RECIPES in crafting.js). Only that style's class sees/forges it.
export const STYLE_RECIPES = [
  { id: 'twinfang', name: 'Twinfang Dual Blades', style: 'dual', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 4 },
    gold: 180, mats: { pelt: 8, fang: 1, dust: 4, ess: 1 }, desc: 'A matched pair, quick as a wolf. Swordsman.' },
  { id: 'thornneedle', name: 'Thornneedle Rapier', style: 'rapier', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 5 },
    gold: 180, mats: { resin: 8, tusk: 4, dust: 4, ess: 1 }, desc: 'A resin-hardened needle of a blade. Swordsman.' },
  { id: 'tuskmaul', name: 'Tuskmaul Mace & Shield', style: 'mace', slot: 'weapon', r: 2, cls: true, st: { atk: 15, crit: 2 },
    gold: 180, mats: { tusk: 10, pelt: 3, dust: 4, ess: 1 }, desc: 'Boar ivory set in iron. Guardian.' },
  { id: 'packpike', name: 'Packpike Spear & Shield', style: 'spear', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 3 },
    gold: 180, mats: { fang: 2, pelt: 6, dust: 4, ess: 1 }, desc: 'Tipped with an Alpha fang. Guardian.' },
  { id: 'hymnal', name: 'Hymnal Mace & Tome', style: 'tome', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 3 },
    gold: 180, mats: { tusk: 6, resin: 4, dust: 4, ess: 1 }, desc: 'A prayer book and the means to enforce it. Cleric.' },
  { id: 'resinwand', name: 'Resinlight Wand', style: 'wand', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 4 },
    gold: 180, mats: { resin: 10, dust: 4, ess: 1 }, desc: 'Amber that holds a spark. Cleric.' },
  { id: 'hornmaul', name: 'Hornmaul Mace & Shield', style: 'mace', slot: 'weapon', r: 3, cls: true, st: { atk: 22, crit: 3 },
    gold: 500, mats: { horn: 6, core: 2, ess: 3 }, desc: 'The Warden\'s horn as a mace head. Guardian.' },
];

// Tooltip text for an item (client): "Dual Blades — passive ..." or '' for non-weapons.
export function styleLine(it) {
  if (it?.slot !== 'weapon' || !it.cls) return '';
  const s = STYLES[styleOf(it, it.cls)];
  if (!s) return '';
  return s.def ? s.name : `${s.name}: ${s.passive}`;
}
