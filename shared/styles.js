// Weapon styles: each class has three ways to fight, picked by the equipped weapon (item.style; none = the class default).
// A style changes how the basic attack plays (combo timings, reach, hit shapes), adds one passive and tweaks one skill.
// Shared by the server (server/styles.js: combos, passives, skill tweaks) and the client (public/styles.js: models,
// animations, hit effects, tooltips). No imports, so items.js / crafting.js can import it without a cycle.

// Order is the wire format (the style index at the end of each snapshot player row): append only, never reorder.
export const STYLE_IDS = ['sword', 'dual', 'rapier', 'shield', 'mace', 'spear', 'staff', 'tome', 'wand',
  'longbow', 'crossbow', 'daggers', 'greataxe', 'twinaxes', 'warhammer', 'lance', 'halberd', 'glaive', 'lyre', 'drum', 'flute'];

// basic: the styled basic attack (default styles have none: the original combo in game.js runs unchanged).
//   cd: seconds between presses · window: seconds to keep the combo going · aim: auto-aim range (client)
//   steps[i]: one press of the combo. shape 'arc' (r, half), 'line' (len, w: a thrust through everything in a line),
//   'ring' (r: around you), 'bolt' (len: the first enemy along a ray). mult: x attack. knock, heavy (x2 posture),
//   frac: extra posture chunk [normal/elite, boss], twin: a second identical hit this many seconds later.
//   ring/arc steps may also add `discord` (Bard: Discord stacks on every enemy hit) and `sweet` ([from m, x damage] for
//   enemies whose near edge is that far away: the Lancer's tip-of-reach bonus).
// mods: numeric tweaks read by game.js and the class files through styleNum(p, key, default).
// The newer classes (Ranger, Berserker, Lancer, Bard) implement their basic attacks in server/classes-a.js / classes-b.js;
// a style there either has `basic` steps (it replaces the class attack: Twin Daggers, Halberd, Drum) or tunes the class
// attack through mods: basicCd (x the basic attack's cooldown) and arrow / chop / thrust / bolt (overrides merged over
// RANGER_TUNE.arrow, BERSERKER_TUNE.chop, LANCE, SONG.bolt).
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
    tweak: 'Heal reaches 50% farther (22.5 m instead of 15 m).',
    mods: { healR: 1.5, wandAid: 0.05 },
    basic: {
      cd: 0.5, window: 1.0, aim: 12.5, threat: 1,
      steps: [{ shape: 'bolt', len: 12, w: 1.2, mult: 0.72, interrupt: true }],
    },
  },
  // ---------- Ranger ----------
  longbow: {
    cls: 'ranger', name: 'Longbow', noun: 'Longbow', def: true,
    desc: 'Arrows from range; every third hits harder. Weak point-blank.',
  },
  crossbow: {
    cls: 'ranger', name: 'Crossbow', noun: 'Crossbow',
    desc: 'Slower, heavier bolts (1 s) that punch through one extra enemy; every third still hits hardest.',
    passive: 'Your first bolt on an enemy you haven\'t hit yet is a critical hit.',
    tweak: 'Piercing Shot (and its evolutions) draws 40% faster.',
    mods: { basicCd: 1.65, arrow: { mult: [1.75, 1.75, 2.4], speed: 46, pierceN: 1, combo: 2.1, k: 'xbolt', kFin: 'xheavy' }, firstCrit: 1, drawMul: 0.6 },
  },
  daggers: {
    cls: 'ranger', name: 'Twin Daggers', noun: 'Twin Daggers',
    desc: 'Melee instead of the bow: a fast 4-hit dagger combo (0.4 s); the 4th is a double stab.',
    passive: 'Dagger hits have a 12% chance to put a 4 s Hunter\'s Mark on the enemy.',
    tweak: 'Disengage is ready again whenever you kill an enemy.',
    mods: { markChance: [0.12, 4], killReset: 'disengage' },
    basic: {
      cd: 0.4, window: 0.9, aim: 5, threat: 1,
      steps: [
        { shape: 'arc', r: 2.7, half: 1.0, mult: 0.8, knock: 0.15 },
        { shape: 'arc', r: 2.7, half: 1.0, mult: 0.8, knock: 0.15 },
        { shape: 'arc', r: 2.7, half: 1.0, mult: 0.8, knock: 0.15 },
        { shape: 'arc', r: 2.9, half: 1.1, mult: 0.75, knock: 0.6, heavy: true, frac: [0.05, 0.015], twin: 0.12, fin: true },
      ],
    },
  },
  // ---------- Berserker ----------
  greataxe: {
    cls: 'berserker', name: 'Greataxe', noun: 'Greataxe', def: true,
    desc: 'Slow, heavy 3-hit axe combo with big posture damage.',
  },
  twinaxes: {
    cls: 'berserker', name: 'Twin Axes', noun: 'Twin Axes',
    desc: 'A faster 3-hit combo (0.55 s) with lighter hits and less posture damage (only the third swing is heavy).',
    passive: 'You build Rage 30% faster.',
    tweak: 'Cleave strikes twice (the second sweep at 60%).',
    mods: { basicCd: 0.65, chop: { r: 3.1, half: 1.0, mult: [0.9, 0.9, 1.4], heavy: [false, false, true], fin: { knock: 1.6, frac: [0.06, 0.02] } }, rageGain: 1.3, cleaveTwin: 0.6 },
  },
  warhammer: {
    cls: 'berserker', name: 'Warhammer', noun: 'Warhammer',
    desc: 'The slowest swings (1.25 s), every blow heavy with a posture chunk; the third smashes the ground all around you.',
    passive: 'Breaks you cause last 1 s longer (0.5 s on bosses).',
    tweak: 'Leap Slam (and its evolutions) lands in a 35% wider ring.',
    mods: { basicCd: 1.45, chop: { r: 3.5, half: 1.2, mult: [2.0, 2.0, 3.0], frac: [0.05, 0.015], fin: { knock: 3, frac: [0.16, 0.05], ring: 3.8 } }, breakBonus: [1.0, 0.5], leapR: 1.35 },
  },
  // ---------- Lancer ----------
  lance: {
    cls: 'lancer', name: 'Spear', noun: 'Spear', def: true,
    desc: '3-hit thrusts along a 4.6-5.4 m line; +30% at the tip of your reach.',
  },
  halberd: {
    cls: 'lancer', name: 'Halberd', noun: 'Halberd',
    desc: 'Sweeping arcs instead of lines (4 m, the third 4.6 m and wide); still +30% at the tip of the reach.',
    passive: 'The hooked blade slows every enemy you hit by 25% for 2 s (half on bosses).',
    tweak: 'Sweep radius +30%.',
    mods: { hookSlow: [0.25, 2], sweepR: 1.3 },
    basic: {
      cd: 0.7, window: 1.1, aim: 5.5, threat: 1,
      steps: [
        { shape: 'arc', r: 4.0, half: 0.9, mult: 1.0, knock: 0.3, sweet: [2.4, 1.3] },
        { shape: 'arc', r: 4.0, half: 0.9, mult: 1.0, knock: 0.3, sweet: [2.4, 1.3] },
        { shape: 'arc', r: 4.6, half: 1.5, mult: 1.5, knock: 1.2, heavy: true, sweet: [2.4, 1.3], fin: true },
      ],
    },
  },
  glaive: {
    cls: 'lancer', name: 'Glaive', noun: 'Glaive',
    desc: 'The longest thrusts (5.6-6.4 m), a little slower (0.7 s).',
    passive: 'Hits at the tip of your reach (3.4 m+) deal +50% instead of +30%.',
    tweak: 'Lance Charge dashes 12 m (9 m).',
    mods: { basicCd: 1.15, thrust: { reach: 5.6, finReach: 6.4, mult: 1.0, finMult: 1.55, sweetFrom: 3.4, sweetMult: 1.5 }, chargeLen: 1.35 },
  },
  // ---------- Bard ----------
  lyre: {
    cls: 'bard', name: 'Lyre', noun: 'Lyre', def: true,
    desc: 'Sonic Bolt: an 11 m bolt that adds a Discord stack.',
  },
  drum: {
    cls: 'bard', name: 'War Drum', noun: 'War Drum',
    desc: 'Short-range shockwaves all around you (3.4 m, the third 4.4 m and interrupts) that add a Discord stack to everything they hit.',
    passive: 'Enemies with 3+ Discord stacks take 10% more damage from your whole party.',
    tweak: 'Anthem (and its evolutions) plays 40% longer.',
    mods: { warDrums: [3, 0.1], songDur: 1.4 },
    basic: {
      cd: 0.9, window: 1.3, aim: 4, threat: 1.2,
      steps: [
        { shape: 'ring', r: 3.4, mult: 0.75, knock: 0.4, discord: 1 },
        { shape: 'ring', r: 3.4, mult: 0.75, knock: 0.4, discord: 1 },
        { shape: 'ring', r: 4.4, mult: 1.0, knock: 1.4, heavy: true, interrupt: true, discord: 1, fin: true },
      ],
    },
  },
  flute: {
    cls: 'bard', name: 'Flute', noun: 'Flute',
    desc: 'Quick, long-range bolts (16 m, 0.45 s) that hit lighter.',
    passive: 'Every second bolt that lands adds 2 Discord stacks instead of 1.',
    tweak: 'Dissonance (and Shattering Chord) sounds in a 50% wider cone.',
    mods: { basicCd: 0.65, bolt: { speed: 36, range: 16, radius: 0.45, mult: 0.62 }, fluteStacks: 2, chordHalf: 1.5, aim: 16 },
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
  ranger: ['Hunting', 'Ashwood', 'Galeshot', 'Skyreaver'],
  berserker: ['Woodcutter', 'Bearded', 'Ravager', 'Worldsplitter'],
  lancer: ['Ash', 'Tempered', 'Galeglass', 'Skyreaver'],
  bard: ['Pine', 'Maple', 'Resonant', 'Dawnsong'],
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
  { id: 'tuskbolt', name: 'Tuskbolt Crossbow', style: 'crossbow', slot: 'weapon', r: 2, cls: true, st: { atk: 15, crit: 3 },
    gold: 180, mats: { tusk: 8, resin: 3, dust: 4, ess: 1 }, desc: 'Ivory-tipped bolts and a resin-glued stock. Ranger.' },
  { id: 'fangpair', name: 'Fangpair Twin Daggers', style: 'daggers', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 5 },
    gold: 180, mats: { fang: 2, pelt: 5, dust: 4, ess: 1 }, desc: 'Two Alpha fangs, honed to a point. Ranger.' },
  { id: 'peltcleavers', name: 'Peltcleaver Twin Axes', style: 'twinaxes', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 4 },
    gold: 180, mats: { pelt: 8, tusk: 3, dust: 4, ess: 1 }, desc: 'A pair of hide-wrapped hatchets. Berserker.' },
  { id: 'tuskhammer', name: 'Tuskhammer Warhammer', style: 'warhammer', slot: 'weapon', r: 2, cls: true, st: { atk: 15, crit: 2 },
    gold: 180, mats: { tusk: 10, resin: 2, dust: 4, ess: 1 }, desc: 'A boar-ivory maul. Berserker.' },
  { id: 'resinhalberd', name: 'Resinhook Halberd', style: 'halberd', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 3 },
    gold: 180, mats: { resin: 8, pelt: 3, dust: 4, ess: 1 }, desc: 'A hooked blade on an amber-bound haft. Lancer.' },
  { id: 'fangglaive', name: 'Fangreach Glaive', style: 'glaive', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 4 },
    gold: 180, mats: { fang: 2, tusk: 4, dust: 4, ess: 1 }, desc: 'An Alpha fang at the end of a very long pole. Lancer.' },
  { id: 'hidedrum', name: 'Direhide War Drum', style: 'drum', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 3 },
    gold: 180, mats: { pelt: 10, dust: 4, ess: 1 }, desc: 'Dire-wolf hide stretched tight. Bard.' },
  { id: 'resinflute', name: 'Resinsong Flute', style: 'flute', slot: 'weapon', r: 2, cls: true, st: { atk: 14, crit: 4 },
    gold: 180, mats: { resin: 8, fang: 1, dust: 4, ess: 1 }, desc: 'Amber that sings when you breathe through it. Bard.' },
];

// Tooltip text for an item (client): "Dual Blades — passive ..." or '' for non-weapons.
export function styleLine(it) {
  if (it?.slot !== 'weapon' || !it.cls) return '';
  const s = STYLES[styleOf(it, it.cls)];
  if (!s) return '';
  return s.def ? s.name : `${s.name}: ${s.passive}`;
}
