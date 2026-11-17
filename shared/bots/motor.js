// Bot "body": moving, rolling out of telegraphs, the Horn Sweep, Tidal Waves, pressing skills. Shared by every bot brain.
// Capability levels (shared/botskill.js) hook in here: skill cadence, positioning noise, Horn Sweep timing error.
import { CLASSES, PLAYER_SPEED, DODGE, SWEEP, walkable, resolveCollision } from '../data.js';
import { F2, SOVEREIGN, inArena2, onFloor2 } from '../floor2.js';
import { skillReady, pressed, aimNoise, sweepError } from '../botskill.js';
import { brainFor } from './registry.js';

export const DT = 0.05; // one snapshot (20 Hz)
export const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function useSkill(b, slot, face, tid) {
  const sk = CLASSES[b.cls]?.skills[slot];
  if (!b.me || !sk || b.cds[slot] > 0 || (b.me.lvl || 1) < (sk.lvl || 1)) return false;
  if (!skillReady(b, slot)) return false; // capability: slower rotations
  b.send({ type: 'skill', slot, face: face ?? b.face, ...(tid ? { tid } : {}) });
  pressed(b, slot);
  b.cds[slot] = 1; (b.pressed ||= [])[slot] = b.t;
  return true;
}

export function moveToward(b, tx, tz, stop = 0.4, speed = PLAYER_SPEED) {
  [tx, tz] = aimNoise(b, tx, tz); // capability: positioning error in fights
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
  if (d <= stop) return false;
  const step = Math.min(d - stop, speed * DT);
  let nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
  [nx, nz] = resolveCollision(nx, nz);
  if (!walkable(nx, nz, !b.gateOpen)) return false;
  b.x = nx; b.z = nz; b.face = Math.atan2(dx, dz);
  return true;
}

function roll(b, dir) {
  b.roll = { left: DODGE.time, dir }; b.face = dir;
  b.dodgeCd = DODGE.cd; b.dodgePressed = b.t;
  b.send({ type: 'dodge', face: dir });
}

// Roll out of danger if the dodge is ready; otherwise just run.
export function evade(b, tx, tz) {
  if (b.roll) return;
  if (b.dodgeCd <= 0 && !waveSoon(b, 1.4)) roll(b, Math.atan2(tx - b.x, tz - b.z));
  else moveToward(b, tx, tz);
}

export function stepRoll(b) {
  if (!b.roll) return false;
  const step = Math.min(b.roll.left, DT) * (DODGE.dist / DODGE.time);
  b.roll.left -= DT;
  const [nx, nz] = resolveCollision(b.x + Math.sin(b.roll.dir) * step, b.z + Math.cos(b.roll.dir) * step);
  if (walkable(nx, nz, !b.gateOpen)) { b.x = nx; b.z = nz; }
  if (b.roll.left <= 0) b.roll = null;
  return true;
}

// Floor 2: seconds until the next Tidal Wave reaches us (Infinity if none).
function waveEta(b) {
  let best = Infinity;
  for (const w of b.waves) {
    const r = (b.t - w.start) * w.sp, d = d2(b.x, b.z, w.x, w.z);
    if (r - w.w > d) continue; // already past us
    best = Math.min(best, (d - r - w.w) / w.sp);
  }
  return best;
}
const waveSoon = (b, secs) => waveEta(b) < secs;
// Roll INTO the wave just before it arrives: the i-frames carry us through.
export function waveDodge(b) {
  b.waves = b.waves.filter(w => (b.t - w.start) * w.sp < w.max);
  const eta = waveEta(b);
  if (eta > 0.22 || eta < -0.08 || b.roll || b.dodgeCd > 0) return false;
  const w = b.waves.find(w => { const r = (b.t - w.start) * w.sp; return r - w.w <= d2(b.x, b.z, w.x, w.z); });
  roll(b, Math.atan2(w.x - b.x, w.z - b.z));
  return true;
}

// Point just outside any active telegraph we're standing in (or Floor 2 hazard), or null.
export function dodgeSpot(b) {
  b.tele = b.tele.filter(t => t.until > b.t);
  if (onFloor2(b.x)) { // homing orbs, mire pools, the Deluge
    for (const [, ox, oz] of b.orbs) {
      const d = d2(b.x, b.z, ox, oz);
      if (d < 2.6) { const ux = (b.x - ox) / (d || 1), uz = (b.z - oz) / (d || 1); return [b.x - uz * 4, b.z + ux * 4]; }
    }
    for (const [, px, pz, r] of b.pools) {
      const d = d2(b.x, b.z, px, pz);
      if (d < r + 0.8) { const ux = d > 0.1 ? (b.x - px) / d : 1, uz = d > 0.1 ? (b.z - pz) / d : 0; return [px + ux * (r + 2), pz + uz * (r + 2)]; }
    }
    const A = F2.arena, dc = d2(b.x, b.z, A.x, A.z);
    if (b.deluge && inArena2(b.x, b.z) && dc > SOVEREIGN.deluge.r - 1) return [A.x + ((b.x - A.x) / dc) * 11, A.z + ((b.z - A.z) / dc) * 11];
  }
  for (const t of b.tele) {
    if (t.line) { // the Warden's charge lane: step sideways out of it
      const [x2, z2, w] = t.line, lx = x2 - t.x, lz = z2 - t.z, len = Math.hypot(lx, lz) || 1;
      const k = Math.max(0, Math.min(1, ((b.x - t.x) * lx + (b.z - t.z) * lz) / (len * len)));
      const px = t.x + lx * k, pz = t.z + lz * k, off = Math.hypot(b.x - px, b.z - pz);
      if (off < w + 1.2) {
        let nx = -lz / len, nz = lx / len;
        if ((b.x - px) * nx + (b.z - pz) * nz < 0) { nx = -nx; nz = -nz; }
        return [px + nx * (w + 3), pz + nz * (w + 3)];
      }
      continue;
    }
    let cx = t.x, cz = t.z;
    if (t.follow) { const m = b.mobs.find(m => m.id === t.follow); if (m) { cx = m.x; cz = m.z; } }
    const d = d2(b.x, b.z, cx, cz);
    if (d < t.r + 1.2) {
      const ux = d > 0.1 ? (b.x - cx) / d : 1, uz = d > 0.1 ? (b.z - cz) / d : 0;
      return [cx + ux * (t.r + 2.2), cz + uz * (t.r + 2.2)];
    }
  }
  return null;
}

// Horn Sweep (perilous): roll through it at the last moment (a perfect dodge), or parry it (classes with parry: true).
// Returns true when it takes over this bot's turn.
export function perilous(b) {
  const s = b.sweep;
  if (!s) return false;
  const left = s.at - b.t, m = b.mobs.find(m => m.id === s.id);
  if (left < -0.3 || !m) { // over: let go of the guard
    b.sweep = null;
    if (b.guardOn) { b.guardOn = false; b.send({ type: 'guard', on: false }); }
    return false;
  }
  if (left <= 0) return !!b.guardOn;
  const d = d2(b.x, b.z, m.x, m.z), away = Math.atan2(b.x - m.x, b.z - m.z);
  if (d > SWEEP.r + 1.5) return left < 1; // outside: don't walk in
  if (brainFor(b.cls).parry) { // face it and raise the shield just before it lands
    if (left > 0.12 + sweepError(b, s)) return false;
    b.face = Math.atan2(m.x - b.x, m.z - b.z);
    if (!b.guardOn) { b.guardOn = true; b.send({ type: 'guard', on: true }); }
    return true;
  }
  if (b.dodgeCd <= left - 0.1) {
    if (left > 0.15 + sweepError(b, s)) return false;
    evade(b, b.x + Math.sin(away) * 5, b.z + Math.cos(away) * 5);
    return true;
  }
  moveToward(b, m.x + Math.sin(away) * (SWEEP.r + 2.5), m.z + Math.cos(away) * (SWEEP.r + 2.5)); // no roll: run out
  return true;
}

// Is this mob Broken by someone else (i.e. our turn to Switch in)?
export const switchOpen = (b, m) => !!(m?.staggered && b.stag[m.id] && b.stag[m.id].by !== b.id && b.stag[m.id].until > b.t);

// Up the road to the boss chamber, waiting at the raid gate while it's shut.
export function travelToBoss(b) {
  const ox = onFloor2(b.x) ? F2.x : 0;
  if (!b.gateOpen && b.z > 120) { moveToward(b, ox, 154); return; }
  if (b.z < 150 && Math.abs(b.x - ox) > 3) moveToward(b, ox, Math.min(150, b.z + 6));
  else if (b.z < 162) moveToward(b, ox, 172);
  else moveToward(b, ox, 182);
}
