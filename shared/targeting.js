// Targeting and cleave: the player's choices under Controls → Combat (fb_controls.combat, synced with the account),
// the attack field-of-view / target-limit table, and the pure pickers both sides use.
//   Client (public/main.js useSkill, public/combat.js guard): which way an attack turns you (pickTarget).
//   Server (server/targeting.js): who an attack hits (capTargets for cleave, rayPick for aimed marks and leaps),
//   whether arrows home (not in aimed mode). Players send their prefs in { type: 'tprefs' }; bots never do and keep
//   the old behaviour (no caps, no lock preference).
// No imports, so shared/controls.js can import it without a cycle.

// ---------- the four modes ----------
export const TARGET_MODES = ['nearest', 'lock', 'cone', 'aimed'];
export const TARGET_MODE_INFO = {
  nearest: { label: 'Nearest', desc: 'Always the nearest enemy, wherever you look and whatever is locked.' },
  lock: { label: 'Locked or nearest', desc: 'Your locked target, however far; with nothing locked, the nearest enemy.' },
  cone: { label: 'Cone', desc: 'The nearest enemy in a 120° cone in front of you, never beside or behind. A locked target inside the cone comes first.' },
  aimed: { label: 'Aimed', desc: 'No auto-targeting: attacks go where you look. Arrows and bolts fly straight and hit whatever is in the line.' },
};
export const CONE_HALF = Math.PI / 3; // the Cone mode: 120° in front of you
export const AIM_PAD = 0.35; // aimed projectiles: hitbox this much wider than the visual (m)
export const LOCK_RANGE = 45; // how far a lock holds (public/main.js lockedMob)
export const MAX_TARGETS = { min: 1, max: 8 };
export const DEFAULT_PREFS = Object.freeze({ mode: 'lock', cleave: true, max: MAX_TARGETS.max }); // closest to the old feel

// A saved / sent value made safe: unknown modes, wrong types and out-of-range numbers fall back to the defaults.
// Accepts the saved shape ({ target }) and the wire shape ({ mode }).
export function cleanPrefs(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = TARGET_MODES.includes(r.mode) ? r.mode : TARGET_MODES.includes(r.target) ? r.target : DEFAULT_PREFS.mode;
  const cleave = typeof r.cleave === 'boolean' ? r.cleave : r.cleave === 0 || r.cleave === 1 ? !!r.cleave : DEFAULT_PREFS.cleave;
  const n = typeof r.max === 'number' || (typeof r.max === 'string' && r.max.trim() !== '') ? Math.round(Number(r.max)) : NaN; // (null, '', true: the default)
  const max = Number.isFinite(n) ? Math.min(MAX_TARGETS.max, Math.max(MAX_TARGETS.min, n)) : DEFAULT_PREFS.max;
  return { mode, cleave, max };
}

// ---------- attack field of view and target limits ----------
// Per basic attack / ability: r (reach, m) and half (half the attack field of view, radians) where the shape used to
// be hard-coded (game.js, mastery.js; the base values are the old ones, so balance is unchanged), and n: how many
// enemies one hit can reach with Cleave on (the player's "max targets" caps it further).
//   aoe: an area attack: the Cleave toggle and max targets don't apply (its own n still caps it). The Bard chords,
//        Hamstring, the Berserker's Cleave skill (a 180° sweep) and all-round ring basics.
//   round: all around you: Cone mode's "nothing beside or behind" filter doesn't apply (rings, Feedback).
// Spins, slams and ground circles (hitCircle), dashes and projectiles never go through this table.
// The newer classes keep their shapes in their own tunes (BERSERKER_TUNE.chop / cleave / executioner, LANCE,
// SONG.dissonance / shatter) and weapon-style basics in shared/styles.js steps (a step may carry its own n).
// Weapon styles widen or narrow every arc with mods.fov (x half; wider swings are meant to come with slower ones).
export const ATTACKS = {
  slash: { r: 3, half: 1.05, n: 4 }, slashFin: { r: 3.5, half: 1.3, n: 6 }, // Swordsman / Guardian basic combo
  burst: { r: 3.2, half: 0.9, n: 4 }, burstFin: { r: 3.2, half: 0.9, n: 6 },
  starburst: { r: 3.2, half: 0.9, n: 4 }, starburstFin: { r: 3.2, half: 0.9, n: 6 },
  finisher: { r: 3.2, half: 0.9, n: 4 }, finisher2: { r: 3.4, half: 0.9, n: 6 },
  chop: { n: 4 }, chopFin: { n: 6 }, // Berserker (BERSERKER_TUNE.chop)
  cleave: { n: 8, aoe: true }, executioner: { n: 6 },
  lthrust: { n: 3 }, lthrustFin: { n: 4 }, // Lancer: the spear line (LANCE.reach / width)
  hamstring: { aoe: true }, dissonance: { aoe: true }, shatter: { aoe: true }, feedback: { aoe: true, round: true },
  styleArc: { n: 4 }, styleFin: { n: 6 }, styleLine: { n: 3 }, styleRing: { n: 8, aoe: true, round: true }, // weapon-style basics by shape
};
// The shape and limit of one attack: the table entry, a call's own shape (over: a class tune, a style step), the
// style's field-of-view multiplier on the half-angle (never past a full circle).
export function attackFov(key, { fov = 1, over = null } = {}) {
  const A = { ...ATTACKS[key], ...(over || {}) };
  if (typeof A.half === 'number') A.half = Math.min(Math.PI, A.half * fov);
  A.key = key;
  return A;
}

// ---------- pickers (mobs: { x, z, def: { radius } }) ----------
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const rad = m => m?.def?.radius || 0;
// Is m inside the cone of `half` around `front` seen from (x, z)? A big enemy counts once part of it is inside.
export function inCone(x, z, front, m, half) {
  const dx = m.x - x, dz = m.z - z, d = Math.hypot(dx, dz);
  if (d < 0.01) return true;
  return Math.abs(wrap(Math.atan2(dx, dz) - front)) <= half + Math.atan2(rad(m), Math.max(d, 0.5));
}
const edge = (x, z, m) => Math.hypot(m.x - x, m.z - z) - rad(m);

// What a long-range skill aims at with nothing locked: the enemy closest to the camera's line of sight within range
// (the crosshair, ~26° either side, more for big or close enemies), else anything within 7 m.
export const CROSSHAIR = { half: 0.45, fallback: 7, from: 12 }; // from: ranges above this use it (Locked or nearest)
export function crosshairPick({ x, z, front, mobs, range, canTarget = () => true }) {
  const fx0 = Math.sin(front), fz0 = Math.cos(front);
  let best = null, bs = Infinity, near = null, nd = Math.min(range, CROSSHAIR.fallback);
  for (const m of mobs) {
    if (!canTarget(m)) continue;
    const dx = m.x - x, dz = m.z - z, d = Math.hypot(dx, dz) || 0.01;
    if (d - rad(m) < nd) { nd = d - rad(m); near = m; }
    if (d > range + rad(m)) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx0 + dz * fz0) / d)));
    if (ang > CROSSHAIR.half + Math.atan2(rad(m) || 0.8, d)) continue;
    const sc = ang * 4 + d / range;
    if (sc < bs) { bs = sc; best = m; }
  }
  return best || near;
}

// Which enemy an attack turns you toward, or null (attack where you face / look).
//   mode: TARGET_MODES · front: the direction "in front of you" (the camera's look) · lock: the locked enemy or null
//   range: the skill's engage range (nearest picks) · lockRange: how far a lock still turns you (default
//   max(14, range + 4): a slash doesn't spin to a boss 30 m away while a wolf bites you)
export function pickTarget({ mode, x, z, front = 0, mobs, lock = null, range, lockRange = Math.max(14, range + 4), canTarget = () => true, cone = CONE_HALF }) {
  if (mode === 'aimed') return null;
  const lockOk = !!lock && canTarget(lock) && edge(x, z, lock) <= Math.min(lockRange, LOCK_RANGE);
  const nearest = test => {
    let best = null, bd = range;
    for (const m of mobs) {
      if (!canTarget(m) || (test && !test(m))) continue;
      const d = edge(x, z, m);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  };
  if (mode === 'nearest') return nearest();
  if (mode === 'cone') {
    const inside = m => inCone(x, z, front, m, cone);
    return lockOk && inside(lock) ? lock : nearest(inside);
  }
  if (lockOk) return lock; // 'lock' (and anything unknown)
  return range > CROSSHAIR.from ? crosshairPick({ x, z, front, mobs, range, canTarget }) : nearest(); // bows, bolts: the crosshair
}

// Cleave: which of the enemies inside an attack's field it hits. At most n: the locked one first (pass it only in the
// modes that honour a lock), then the nearest; line: an angle to order by distance from that line instead (Aimed).
export function capTargets(list, { x, z, n = Infinity, lock = null, line = null }) {
  if (list.length <= n) return list;
  const key = line === null ? m => edge(x, z, m) : m => Math.abs((m.x - x) * Math.cos(line) - (m.z - z) * Math.sin(line)) - rad(m);
  const out = [...list].sort((a, b) => key(a) - key(b));
  const i = lock ? out.indexOf(lock) : -1;
  if (i > 0) { out.splice(i, 1); out.unshift(lock); }
  return out.slice(0, Math.max(0, n));
}

// The first enemy along a straight line from (x, z) at angle a, within `range` (to its near edge), whose body is
// within `pad` of the line. Aimed mode's marks, pounces and leaps.
export function rayPick({ x, z, a, mobs, range, pad = AIM_PAD, canTarget = () => true }) {
  const dx = Math.sin(a), dz = Math.cos(a);
  let best = null, bt = Infinity;
  for (const m of mobs) {
    if (!canTarget(m)) continue;
    const vx = m.x - x, vz = m.z - z, along = vx * dx + vz * dz;
    if (along < -rad(m) || along - rad(m) > range) continue;
    if (Math.abs(vx * dz - vz * dx) > rad(m) + pad) continue;
    if (along < bt) { bt = along; best = m; }
  }
  return best;
}
