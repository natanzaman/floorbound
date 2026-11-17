// What a bot's basic attack can reach with its equipped weapon style, derived from the style data (shared/styles.js)
// and the class tuning, so the class brains fight at the right distance: melee styles close in, ranged ones kite,
// the Glaive / Halberd keep the tip of their reach, the War Drum stays inside its shockwave.
//
// basicProfile(cls, style) -> { style, kind, reach, sweet, min, half }
//   kind   'melee' (arcs / thrusts in front: face the target), 'ring' (all around you: just be close), 'ranged' (bolts, arrows)
//   reach  how far from the target's EDGE (centre distance minus its radius) every press of the combo still lands
//   sweet  the tip-of-reach bonus starts this far from the edge (Lancer), else 0
//   min    ranged attacks that are weak point-blank (the Ranger's arrows): full damage from here, else 0
//   half   half-angle of the narrowest arc (melee), else null
// The bot learns its style from its own snapshot row (players[i][11], see brain.js) as b.style.
import { STYLES } from '../styles.js';
import { RANGER_TUNE } from '../classes/ranger.js';
import { BERSERKER_TUNE } from '../classes/berserker.js';
import { LANCE } from '../classes/lancer.js';
import { SONG } from '../classes/bard.js';

// The original classes' default basic attacks (server/game.js useSkill: slash / bash arcs, the Smite ray).
const CLASSIC = {
  swordsman: { kind: 'melee', reach: 3, half: 1.05 },
  guardian: { kind: 'melee', reach: 3, half: 1.05 },
  cleric: { kind: 'ranged', reach: 10 },
};

// A style with its own combo steps (shared/styles.js `basic`): every step must land, so the shortest step sets the reach.
function fromSteps(steps) {
  const reach = Math.min(...steps.map(s => s.shape === 'arc' || s.shape === 'ring' ? s.r : s.len));
  const arcs = steps.filter(s => s.shape === 'arc');
  const kind = steps.some(s => s.shape === 'bolt') ? 'ranged' : steps.every(s => s.shape === 'ring') ? 'ring' : 'melee';
  return { kind, reach, sweet: Math.max(0, ...steps.map(s => s.sweet?.[0] || 0)), min: 0, half: arcs.length ? Math.min(...arcs.map(s => s.half)) : null };
}

// The class's own basic attack, with a style's overrides merged in (mods.arrow / chop / thrust / bolt).
function fromClass(cls, mods) {
  if (CLASSIC[cls]) return { sweet: 0, min: 0, half: null, ...CLASSIC[cls] };
  if (cls === 'ranger') { const A = { ...RANGER_TUNE.arrow, ...mods.arrow }; return { kind: 'ranged', reach: A.range, sweet: 0, min: A.close?.[1] || 0, half: null }; }
  if (cls === 'berserker') { const C = { ...BERSERKER_TUNE.chop, ...mods.chop }; return { kind: 'melee', reach: C.r, sweet: 0, min: 0, half: C.half }; }
  if (cls === 'lancer') { const L = { ...LANCE, ...mods.thrust }; return { kind: 'melee', reach: L.reach, sweet: L.sweetFrom, min: 0, half: null }; }
  if (cls === 'bard') { const B = { ...SONG.bolt, ...mods.bolt }; return { kind: 'ranged', reach: B.range, sweet: 0, min: 0, half: null }; }
  return { kind: 'melee', reach: 3, sweet: 0, min: 0, half: null };
}

const cache = new Map();
export function basicProfile(cls, style) {
  const key = `${cls}:${style || ''}`;
  let p = cache.get(key);
  if (!p) {
    const S = STYLES[style]?.cls === cls ? STYLES[style] : null;
    p = Object.freeze({ style: S ? style : null, ...(S?.basic ? fromSteps(S.basic.steps) : fromClass(cls, S?.mods || {})) });
    cache.set(key, p);
  }
  return p;
}

// Where to stand, as an edge distance from the target: just inside the reach for melee (between the tip bonus and the
// reach when there is one), well inside the shockwave for rings, and back at `ranged` for ranged styles (scaled with
// the reach when the default would be out of range).
export function standOff(P, ranged = 7.5) {
  if (P.kind === 'ring') return Math.max(0.8, P.reach - 0.9);
  if (P.kind === 'melee') return P.sweet ? Math.max(P.sweet + 0.3, P.reach - 0.9) : Math.max(0.6, P.reach - 1.4);
  return Math.max(P.min, Math.min(ranged, P.reach * 0.7));
}
