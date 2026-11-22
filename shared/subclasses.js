// Subclasses (docs/briefs/subclasses.md): from level 15 a graduate specialises at the Academy. Each class has two
// subclasses, each built on one of its talent branches: two extra talent nodes in that branch (shared/talents.js, nodes
// with `sub`) and a signature skill in a 5th skill slot (slot 4; server/subclasses.js runs it). Data and pure rules,
// shared by the server, the client (Academy panel, HUD, talent tree) and the tests.
import { CLASSES, MAX_LEVEL } from './data.js';
import { TREES } from './talents.js';

// lvl: when the Specialise section opens. fee: changing to another subclass later (the first pick is free).
// cdOnPick: a fresh pick (or change) starts the signature skill's cooldown at this many s.
export const SPEC = { lvl: 15, fee: { base: 200, perLvl: 20 }, cdOnPick: 5, slot: 4 };
export const specFee = lvl => SPEC.fee.base + SPEC.fee.perLvl * Math.max(1, Math.min(MAX_LEVEL, lvl | 0));

// A signature skill: id (unique), name, cd (s), desc. key 'sig': talent effects aim at it with { sk: 'sig', ... }.
// aim: how far the client looks for an enemy to turn you to (0: it doesn't turn you). anim: a base skill's animation.
// bot: how shared/bots/subclass.js uses it. use: 'melee' (in reach of the target), 'ranged' (within range), 'crowd'
// (2+ enemies within range, or a boss), 'party' (a boss fight, or an ally hurt), 'heal' (allies hurt), 'buff' (once a
// fight is on). range: metres. low: also when your own health is below this fraction.
// Numbers (x attack power) live in `n`; server/subclasses.js reads them.
const sig = (id, name, cd, desc, aim, anim, bot, n) => ({ id, key: 'sig', name, cd, desc, aim, anim, bot, n, lvl: SPEC.lvl });

export const SUBCLASSES = {
  // ---------- Swordsman ----------
  duelist: {
    cls: 'swordsman', branch: 'tempo', name: 'Duelist', blurb: 'Footwork and counters: in, out, and never where the blow lands.',
    skill: sig('flashstep', 'Flash Step', 18, 'Blink to your target (up to 7 m; else 7 m ahead), untouchable as you pass and cutting through everything in the way, then three quick cuts where you land.', 9, 'rush',
      { use: 'melee', range: 7 }, { len: 7, width: 1.6, line: 1.5, cuts: 3, gap: 0.15, cut: 0.75, r: 3.2, half: 1.0, iframes: 0.45 }),
  },
  vanguard: {
    cls: 'swordsman', branch: 'link', name: 'Vanguard', blurb: 'The first blade in: sets up Switches and carries the party with it.',
    skill: sig('rallycut', 'Rallying Cut', 24, 'A wide, heavy cut that tears a big chunk off the target\'s posture (set up the Switch), and rallies you and every ally within 12 m: +12% damage for 6 s.', 6, 'burst',
      { use: 'melee', range: 4 }, { r: 3.8, half: 1.2, mult: 2.0, frac: [0.3, 0.1], allyR: 12, dmg: 0.12, d: 6 }),
  },
  // ---------- Guardian ----------
  bulwark: {
    cls: 'guardian', branch: 'bulwark', name: 'Bulwark Knight', blurb: 'An unmoving wall: the party stands behind your shield.',
    skill: sig('aegisline', 'Aegis of the Line', 32, 'Raise a shield over the line: you take 40% less damage for 5 s, and every ally within 10 m takes 25% less.', 0, 'wall',
      { use: 'party', range: 10 }, { r: 10, self: 0.4, ally: 0.25, d: 5 }),
  },
  warlord: {
    cls: 'guardian', branch: 'warlord', name: 'Warlord', blurb: 'Threat and pressure: every enemy answers to you, then breaks.',
    skill: sig('conqroar', 'Conqueror\'s Roar', 24, 'A roar that taunts every enemy within 9 m onto you, staggers them and fills a quarter of their posture (less on bosses).', 0, 'taunt',
      { use: 'crowd', range: 8 }, { r: 9, mult: 1.2, stun: 0.8, frac: [0.25, 0.08] }),
  },
  // ---------- Cleric ----------
  lightbringer: {
    cls: 'cleric', branch: 'mercy', name: 'Lightbringer', blurb: 'Mending light: nobody falls on your watch.',
    skill: sig('dawnburst', 'Dawnburst', 30, 'A burst of dawn light heals you and every ally within 15 m for 22% of their health.', 0, 'heal',
      { use: 'heal', range: 15 }, { r: 15, frac: 0.22, flat: 8, perLvl: 1.5 }),
  },
  inquisitor: {
    cls: 'cleric', branch: 'judgement', name: 'Inquisitor', blurb: 'Smite and sentence: the healer who also ends fights.',
    skill: sig('judgeray', 'Judgement Ray', 16, 'A 14 m ray of light: heavy damage to everything in the line and posture damage; it interrupts anything mid wind-up.', 14, 'smite',
      { use: 'ranged', range: 13 }, { len: 14, width: 1.3, mult: 2.2, frac: [0.18, 0.07] }),
  },
  // ---------- Ranger ----------
  sharpshooter: {
    cls: 'ranger', branch: 'marksman', name: 'Sharpshooter', blurb: 'One breath, one arrow: range and precision.',
    skill: sig('deadeye', 'Deadeye Shot', 18, 'Draw for half a second (a line shows where), then loose an arrow that pierces everything for 24 m: very heavy damage and posture damage.', 24, 'smite',
      { use: 'ranged', range: 22 }, { draw: 0.5, len: 24, width: 0.8, mult: 3.2, frac: [0.2, 0.08] }),
  },
  trapmaster: {
    cls: 'ranger', branch: 'trapper', name: 'Trapmaster', blurb: 'Control the ground: nothing reaches you that you didn\'t allow.',
    skill: sig('snarefield', 'Snare Field', 24, 'Throw a net of snares up to 10 m ahead (on your target if it is in reach): everything within 4.5 m is held for 2 s (bosses briefly) and slowed by 50% for 5 s.', 10, 'bless',
      { use: 'crowd', range: 10 }, { range: 10, fwd: 8, r: 4.5, mult: 1.0, stun: 2.2, slow: 0.5, slowFor: 5 }),
  },
  // ---------- Berserker ----------
  reaver: {
    cls: 'berserker', branch: 'carnage', name: 'Reaver', blurb: 'All axe, no brakes: the whole crowd goes down together.',
    skill: sig('rampage', 'Rampage', 20, 'Three spinning axe sweeps (4.5 m) in a row; the last one hits harder and knocks back.', 0, 'whirl',
      { use: 'crowd', range: 4.5 }, { r: 4.5, spins: 3, gap: 0.35, mult: 1.15, last: 1.5 }),
  },
  bloodknight: {
    cls: 'berserker', branch: 'bloodlust', name: 'Blood Knight', blurb: 'Every wound you deal closes one of yours.',
    skill: sig('crimsonpact', 'Crimson Pact', 18, 'A heavy cleave in front of you; you heal for 40% of the damage it deals (up to 20% of your health).', 5, 'gslam',
      { use: 'melee', range: 4, low: 0.7 }, { r: 4, half: 1.3, mult: 2.0, leech: 0.4, cap: 0.2 }),
  },
  // ---------- Lancer ----------
  dragoon: {
    cls: 'lancer', branch: 'dragoon', name: 'Dragoon', blurb: 'The sky is your road: dive in from where they can\'t look.',
    skill: sig('wyverndive', 'Wyvern Dive', 22, 'Leap onto your target (up to 11 m away; else 7 m ahead) and crash down: heavy damage, a stagger and posture damage within 4.5 m. Airborne while you fly.', 11, 'gslam',
      { use: 'melee', range: 10 }, { range: 11, fwd: 7, air: 0.6, r: 4.5, mult: 2.4, stun: 0.8, knock: 1.5, frac: [0.25, 0.09] }),
  },
  phalanx: {
    cls: 'lancer', branch: 'phalanx', name: 'Phalanx', blurb: 'A line of spears: hold the ground and the people behind you.',
    skill: sig('spearwall', 'Spear Wall', 26, 'Plant your spear in a wide 5 m arc: enemies in front are knocked back and stunned; you and allies within 8 m take 20% less damage for 5 s.', 5, 'bash',
      { use: 'melee', range: 4.5 }, { r: 5, half: 1.2, mult: 1.4, knock: 2, stun: 1.2, allyR: 8, dr: 0.2, d: 5 }),
  },
  // ---------- Bard ----------
  virtuoso: {
    cls: 'bard', branch: 'maestro', name: 'Virtuoso', blurb: 'The song is the weapon: the whole party plays faster.',
    skill: sig('encore', 'Encore', 40, 'Play the encore: you and every ally within 14 m get 4 s back on their skills and +10% damage for 6 s.', 0, 'bless',
      { use: 'buff', range: 14 }, { r: 14, cut: 4, dmg: 0.1, d: 6 }),
  },
  siren: {
    cls: 'bard', branch: 'discord', name: 'Siren', blurb: 'A voice that breaks wind-ups and wills.',
    skill: sig('sirenwail', 'Siren\'s Wail', 22, 'A wail all around you (7 m): damage and posture damage, slows enemies by 40% for 4 s, and interrupts anything mid wind-up.', 0, 'smite',
      { use: 'crowd', range: 7 }, { r: 7, mult: 1.4, frac: [0.2, 0.08], slow: 0.4, slowFor: 4 }),
  },
};
export const SUB_IDS = Object.keys(SUBCLASSES);
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
export const isSub = id => own(SUBCLASSES, id);
export const subsOf = cls => SUB_IDS.filter(id => SUBCLASSES[id].cls === cls);
export const subName = id => (isSub(id) ? SUBCLASSES[id].name : '');
export const sigOf = id => (isSub(id) ? SUBCLASSES[id].skill : null);
export const SIG_IDS = SUB_IDS.map(id => SUBCLASSES[id].skill.id);
export const branchName = (cls, bid) => TREES[cls]?.branches.find(b => b.id === bid)?.name || bid;

// The subclass a premade bot (shared/playerbots.js, server/playerbots.js) or the Named take at level 15+, by class.
export const BOT_SUB = { swordsman: 'duelist', guardian: 'bulwark', cleric: 'lightbringer', ranger: 'sharpshooter', berserker: 'reaver', lancer: 'dragoon', bard: 'virtuoso' };

// ---------- the record (characters.path.subs) ----------
// path.subs = { cls: subId }: the subclass of each class you have specialised (a class change keeps them per class).
export const subOf = (path, cls) => (path?.subs && own(path.subs, cls) ? path.subs[cls] : null);

export function cleanSubs(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [cls, id] of Object.entries(raw)) if (own(CLASSES, cls) && isSub(id) && SUBCLASSES[id].cls === cls) out[cls] = id;
  }
  return out;
}

const graduate = path => !!path && path.stage !== 'initiate';
export const NOT_A_SUB = 'That is not a specialisation of your class.';
// Why this character can't take `sub` now (null: it can).
export function specBlock(path, cls, lvl, sub, gold) {
  if (!graduate(path)) return 'Graduate from the Academy first.';
  if ((lvl | 0) < SPEC.lvl) return `Specialisation opens at level ${SPEC.lvl}.`;
  if (!isSub(sub) || SUBCLASSES[sub].cls !== cls) return NOT_A_SUB;
  const cur = subOf(path, cls);
  if (cur === sub) return `You are already a ${SUBCLASSES[sub].name}.`;
  if (cur && (gold | 0) < specFee(lvl)) return `Changing specialisation costs ${specFee(lvl)} gold.`;
  return null;
}
