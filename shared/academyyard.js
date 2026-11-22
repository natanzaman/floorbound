// The Academy yard (docs/briefs/academy.md): the building in the Town of Beginnings, the walled training pens and the
// training enemies. No imports, so shared/data.js can import it (walkable, area names, MOB_IDS) without a cycle;
// the rules live in shared/academy.js.

// The Academy building, west of the square: F within `use` m opens the Academy panel.
export const ACADEMY = { x: -21, z: -3, r: 3.2, use: 4.6, name: 'The Academy' };
export const nearAcademy = (x, z, pad = 0) => Math.hypot(x - ACADEMY.x, z - ACADEMY.z) < ACADEMY.use + pad;
// A dusty lectern against the hall's back wall (no label; server/subclasses.js answers an interact there).
const BACK = 4.5, AL = Math.hypot(ACADEMY.x, ACADEMY.z);
export const LECTERN = { x: ACADEMY.x + (ACADEMY.x / AL) * BACK, z: ACADEMY.z + (ACADEMY.z / AL) * BACK, use: 1.4 };
export const nearLectern = (x, z, pad = 0) => Math.hypot(x - LECTERN.x, z - LECTERN.z) < LECTERN.use + pad;

// The yard: `n` square pens in their own patch of Floor 1's coordinate space (east of the labyrinth layers, west of
// Floor 2's split at x 300), `gap` m apart so nothing in one pen notices the next. A pen's floor is walkable (shared/data.js
// walkable); everything around it is not, so its edge is its wall.
export const YARD = { x0: 215, z0: 80, size: 30, gap: 25, n: 4, wall: 3 };
export const PENS = Array.from({ length: YARD.n }, (_, i) => {
  const x0 = YARD.x0, z0 = YARD.z0 + i * (YARD.size + YARD.gap);
  return { i, x0, z0, x1: x0 + YARD.size, z1: z0 + YARD.size, cx: x0 + YARD.size / 2, cz: z0 + YARD.size / 2 };
});
export const penAt = (x, z) => PENS.find(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) || null;
export const inYard = (x, z) => x >= YARD.x0 - 1 && x <= YARD.x0 + YARD.size + 1 && !!penAt(x, z);
// Where you stand when a trial starts (the south end) and where its enemies gather (the north end).
export const penStart = pen => [pen.cx, pen.z0 + 4];
export const penFar = pen => [pen.cx, pen.z1 - 6];

// Training enemies (appended to MOB_IDS in shared/data.js). academy: give no XP or loot, belong to one trial (m.trial).
// ai: 'academyMobAI' runs them in server/academy.js (dummies stand, movers strafe, advancers step in); the others use the
// normal mob AI with their own wind-up (`wind`). Health and posture scale with the trialist's attack (server/academy.js).
export const ACADEMY_MOB_IDS = ['tgolem', 'twolf', 'tdummy', 'tmover', 'tcaster'];
export const ACADEMY_MOBS = {
  tgolem: { name: 'Training Golem', hp: 600, atk: 7, speed: 2.6, aggro: 40, range: 2.6, atkCd: 2.4, xp: 0, radius: 1.1, level: 1, wind: 0.8, academy: true },
  twolf: { name: 'Training Wolf', hp: 140, atk: 4, speed: 5.2, aggro: 0, range: 2.0, atkCd: 1.6, xp: 0, radius: 0.8, level: 1, academy: true },
  tdummy: { name: 'Training Dummy', hp: 120, atk: 0, speed: 0, aggro: 0, range: 0, atkCd: 99, xp: 0, radius: 0.7, level: 1, academy: true, ai: 'academyMobAI' },
  tmover: { name: 'Moving Target', hp: 60, atk: 0, speed: 0, aggro: 0, range: 0, atkCd: 99, xp: 0, radius: 0.7, level: 1, academy: true, ai: 'academyMobAI' },
  tcaster: { name: 'Training Caster', hp: 800, atk: 6, speed: 2.0, aggro: 40, range: 3.0, atkCd: 3.2, xp: 0, radius: 0.9, level: 1, wind: 1.6, academy: true },
};
export const ACADEMY_BITE = { tgolem: [3.0, 0.8], twolf: [2.6, 0.6], tcaster: [3.6, 1.3] };
