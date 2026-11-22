// Breakable boss parts (docs/briefs/combat-quickwins.md 1). Shared by the server (server/bossparts.js), the client
// (public/bossparts.js: pips under the boss bar, callouts) and the bots (shared/bots/roles.js: stand in a part's arc).
// No imports, so anything can use it.
//
// BOSS_PARTS[boss type]:
//   parts[i]: id, name, call (the callout), arc [from, to] in degrees from the boss's facing (+ = its left, - = its right;
//     the attacker's position decides), hp (part health as a share of the fight's max health), loot (a LOOT key in
//     shared/loot.js: every fighter gets a bonus personal roll), off (moves it stops using), tm (changes to the fight's
//     move table m.tm: 'move.key': ['mul' | 'add', v]; arrays change element-wise, never below 0).
//   all: once every part is broken: kneel { secs, taken (x damage it takes), call }. Once per fight.
export const PART = { melee: 5, meleeMul: 1.5, rangedMul: 0.5 }; // a hit from within `melee` m of the boss's edge counts x meleeMul toward a part, else x rangedMul

export const BOSS_PARTS = {
  warden: {
    parts: [
      { id: 'horns', name: 'Horns', call: 'HORNS BROKEN', sub: 'No more Horn Sweep. Its charge winds up slower.', arc: [-60, 60], hp: 0.08, loot: 'part:warden_horns',
        off: ['sweep'], tm: { 'charge.wind': ['mul', 1.35] } },
    ],
  },
  sovereign: {
    parts: [
      { id: 'trident', name: 'Trident hand', call: 'TRIDENT HAND BROKEN', sub: 'Its trident winds up slower. Fewer geysers.', arc: [-125, -15], hp: 0.08, loot: 'part:sovereign_trident',
        tm: { 'sweep.wind': ['mul', 1.3], 'geyser.extra': ['add', -1] } },
    ],
  },
  colossus: {
    parts: [
      { id: 'kneeL', name: 'Left knee', call: 'LEFT KNEE BROKEN', sub: 'Break the other knee to bring it down.', arc: [60, 180], hp: 0.06, loot: 'part:colossus_knee' },
      { id: 'kneeR', name: 'Right knee', call: 'RIGHT KNEE BROKEN', sub: 'Break the other knee to bring it down.', arc: [-180, -60], hp: 0.06, loot: 'part:colossus_knee' },
    ],
    all: { kneel: { secs: 6, taken: 1.25, call: 'THE COLOSSUS KNEELS', sub: 'It takes 25% more damage. Everyone in!' } },
  },
};

const DEG = Math.PI / 180;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
/** The attacker's angle around the boss, relative to its facing (radians, + = its left). */
export const relAngle = (boss, x, z) => wrap(Math.atan2(x - boss.x, z - boss.z) - boss.face);
/** Is relative angle `rel` (radians) inside a part's arc? */
export function inArc(part, rel) {
  const [a, b] = part.arc, d = rel / DEG;
  return d >= a - 1e-9 && d <= b + 1e-9;
}
/** The parts of `type` whose arc holds the point (x, z). */
export const partsAt = (type, boss, x, z) => (BOSS_PARTS[type]?.parts || []).filter(pt => inArc(pt, relAngle(boss, x, z)));
/** Part damage for a hit: dealt x melee / ranged multiplier. edge: the attacker's distance to the boss's edge (m). */
export const partDamage = (dealt, edge) => dealt * (edge <= PART.melee ? PART.meleeMul : PART.rangedMul);
/** The middle of a part's arc (radians, relative to the facing): where a bot stands. */
export const arcMid = part => ((part.arc[0] + part.arc[1]) / 2) * DEG;

/** A copy of a move table with a part's changes applied (the original is never touched). */
export function applyPartTable(tm, changes) {
  if (!tm || !changes) return tm;
  const out = { ...tm };
  for (const [path, [op, v]] of Object.entries(changes)) {
    const [move, key] = path.split('.');
    if (!out[move] || out[move][key] === undefined) continue;
    const f = x => Math.max(0, op === 'mul' ? x * v : x + v);
    const cur = out[move][key];
    out[move] = { ...out[move], [key]: Array.isArray(cur) ? cur.map(f) : f(cur) };
  }
  return out;
}
