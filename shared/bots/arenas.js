// Bots in multi-area boss fights (docs/ROADMAP.md J2, shared/arenas.js): stand still through the fall and the landing,
// step round sludge and fire (moveToward asks hazardStep), get out of a hazard they're in (dodgeSpot asks arenaEscape),
// and hide behind a great pillar from the Tempest Beam when they can reach one in time (else they jump it as before).
// Capability (shared/botskill.js): from 3, sludge is avoided and cover is used; from 4, warning fire is avoided too
// (below that only burning fire); every level leaves burning fire.
import { PLAYER_SPEED } from '../data.js';
import { ARENAS, ARENA_KEYS, arenaState, sludgeAt, fireAt, speedAt, losBlocked, inRoom, areaOf, AREA_COLLIDERS } from '../arenas.js';
import { beamEta } from './floor3.js';

const clock = b => (b.clock ? b.clock() : performance.now() / 1000);
const skillOf = b => b?.skill ?? 5;

/** Is (x, z) a hazard this capability level avoids? */
export function hazardAt(x, z, skill = 5) {
  const f = fireAt(x, z, 0.45);
  if (f >= (skill >= 4 ? 1 : 2)) return true;
  return skill >= 3 && !!sludgeAt(x, z, 0.25);
}

/** A step of length `step` from (x0, z0) toward (tx, tz) that doesn't walk into a hazard (turning up to ~120°), or null. */
export function hazardStep(x0, z0, tx, tz, step, skill = 5) {
  const a = Math.atan2(tx - x0, tz - z0);
  for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1]) {
    const x = x0 + Math.sin(a + off) * step, z = z0 + Math.cos(a + off) * step;
    if (!hazardAt(x, z, skill)) return [x, z];
  }
  return null;
}

/** The bot's movement speed factor here (sludge), and whether it may roll. */
export const botSpeedAt = b => (AREA_COLLIDERS.length ? speedAt(b.x, b.z) : 1);
export const botCanRoll = b => !AREA_COLLIDERS.length || !sludgeAt(b.x, b.z);
/** moveToward's hook: the next step, steered round hazards (null: no safe step). */
export function botStep(b, nx, nz, tx, tz) {
  if (!AREA_COLLIDERS.length) return [nx, nz];
  const sk = skillOf(b), into = sludgeAt(tx, tz, 1.5); // (heading for someone in the sludge: wade in after them)
  const bad = (x, z) => (into ? fireAt(x, z, 0.45) >= (sk >= 4 ? 1 : 2) : hazardAt(x, z, sk));
  if (!bad(nx, nz) || bad(b.x, b.z)) return [nx, nz]; // (already in one: any way out will do)
  return hazardStep(b.x, b.z, tx, tz, Math.hypot(nx - b.x, nz - b.z), into ? Math.min(sk, 2) : sk);
}

/** A way round a wall or pillar when a straight step barely moves (moveToward: after collisions). */
export function sidestep(b, tx, tz, step, resolve, walkable) {
  if (!AREA_COLLIDERS.length) return null;
  const a = Math.atan2(tx - b.x, tz - b.z), side = b.side || (b.side = Math.random() < 0.5 ? 1 : -1);
  for (const off of [0.9, 1.4, 1.9]) for (const sgn of [side, -side]) {
    let [x, z] = resolve(b.x + Math.sin(a + off * sgn) * step, b.z + Math.cos(a + off * sgn) * step);
    if (Math.hypot(x - b.x, z - b.z) > step * 0.5 && walkable(x, z) && !hazardAt(x, z, skillOf(b))) { b.side = sgn; return [x, z]; }
  }
  return null;
}

/** A spot out of the hazard the bot stands in (for dodgeSpot), or null. */
export function arenaEscape(b) {
  if (!AREA_COLLIDERS.length) return null;
  const sk = skillOf(b);
  if (!hazardAt(b.x, b.z, sk)) return null;
  const tgt = b.tgtId && b.mobs?.find(m => m.id === b.tgtId);
  if (!fireAt(b.x, b.z, 0.45) && tgt && sludgeAt(tgt.x, tgt.z, (tgt.def?.radius || 1) + 2.5)) return null; // fighting it in the sludge: stay
  for (const k of ARENA_KEYS) {
    const a = areaOf(k), L = arenaState(k);
    if (!a || !inRoom(ARENAS[k], b.x, b.z, 2)) continue;
    const blobs = [...(L.fk ? a.fire.spots[L.fi % a.fire.spots.length] : []), ...(sk >= 3 ? a.pools || [] : [])];
    const here = blobs.filter(o => Math.hypot(b.x - o.x, b.z - o.z) < o.r + 0.5);
    if (!here.length) continue;
    const o = here[0], d = Math.hypot(b.x - o.x, b.z - o.z), base = d > 0.1 ? Math.atan2(b.x - o.x, b.z - o.z) : Math.random() * 6.28;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const x = o.x + Math.sin(base + off) * (o.r + 1.4), z = o.z + Math.cos(base + off) * (o.r + 1.4);
      if (!hazardAt(x, z, sk) && inRoom(ARENAS[k], x, z, -1.5)) return [x, z];
    }
    return [o.x + Math.sin(base) * (o.r + 1.4), o.z + Math.cos(base) * (o.r + 1.4)];
  }
  return null;
}

/** The cover spot behind a line-of-sight pillar from a beam at (bx, bz) nearest to (px, pz), or null. */
export function coverSpot(bx, bz, px, pz, skill = 5) {
  let best = null, bd = 1e9;
  for (const o of AREA_COLLIDERS) {
    if (!o.los || o.kind !== 'pillar') continue;
    const d = Math.hypot(o.x - bx, o.z - bz);
    if (d < 1) continue;
    const ux = (o.x - bx) / d, uz = (o.z - bz) / d, x = o.x + ux * (o.r + 1.1), z = o.z + uz * (o.r + 1.1);
    if (!losBlocked(bx, bz, x, z) || hazardAt(x, z, skill) || AREA_COLLIDERS.some(c => c !== o && Math.hypot(x - c.x, z - c.z) < c.r + 0.6)) continue;
    const dd = Math.hypot(x - px, z - pz);
    if (dd < bd) { bd = dd; best = [x, z]; }
  }
  return best;
}

// One bot turn in a boss arena. True when it took the turn (the brain does nothing else this snapshot).
export function arenaTurn(b, moveToward) {
  for (const k of ARENA_KEYS) {
    const L = arenaState(k);
    if (!inRoom(ARENAS[k], b.x, b.z, 2)) continue;
    if (L.stage === 3 || L.stage === 4) { // falling, landing: frozen (the server ignores us anyway)
      b.roll = null; b.tele = []; b.beams = []; b.sweep = null; b.coverAt = null;
      b.goal = 'Landing';
      return true;
    }
    if (L.area && b.beams?.length) return coverTurn(b, moveToward);
  }
  return false;
}

// The Tempest Beam in an area with great pillars: duck behind one just before the beam reaches us, if one is close
// enough (else jump it as before), and step back out once it has passed. The rest of the sweep we keep fighting.
const COVER_SECS = 2.2; // the farthest a bot walks for cover (s)
function coverTurn(b, moveToward) {
  const now = clock(b);
  const live = b.beams.filter(m => now < m.start + m.turn + 0.2);
  if (!live.length) { b.coverAt = null; return false; }
  const e = beamEta(b, now, true); // (when it reaches us, cover or not)
  if (!e) { b.coverAt = null; return false; }
  const m = e.m;
  if (losBlocked(m.x, m.z, b.x, b.z)) { // in cover: hold still while it passes
    if (e.tIn < 1.0 && e.tOut > -0.15) { b.goal = 'In cover from the beam'; return true; }
    return false;
  }
  const sk = skillOf(b);
  if (sk < 3) return false;
  const spot = b.coverAt?.m === m ? b.coverAt.spot : coverSpot(m.x, m.z, b.x, b.z, sk);
  if (!spot) return false;
  const secs = Math.hypot(spot[0] - b.x, spot[1] - b.z) / (PLAYER_SPEED * Math.max(0.45, botSpeedAt(b)));
  const going = b.coverAt?.m === m;
  if (secs + 0.15 > e.tIn) { b.coverAt = null; return false; } // won't make it in time: jump it (beamDodge)
  if (!going && (secs > COVER_SECS || e.tIn > secs + 0.9)) return false; // too far (jump it), or not yet (keep fighting)
  b.coverAt = { m, spot };
  b.goal = 'Taking cover from the beam';
  moveToward(b, spot[0], spot[1], 0.15);
  return true;
}
