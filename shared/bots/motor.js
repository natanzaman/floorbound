// Bot "body": moving, rolling out of telegraphs, the Horn Sweep, Tidal Waves, Quake Rings, pressing skills. Shared by every bot brain.
// Capability levels (shared/botskill.js) hook in here: skill cadence, positioning noise, Horn Sweep / Quake Ring timing error.
import { CLASSES, PLAYER_SPEED, DODGE, JUMP, SWEEP, walkable, resolveCollision } from '../data.js';
import { F2, SOVEREIGN, inArena2, onFloor2, floorOf } from '../floor2.js';
import { FLOOR_X } from '../floor3.js';
import { labSteer } from '../labyrinth.js'; // the labyrinths' walls (shared/labyrinth.js)
import { skillReady, pressed, aimNoise, sweepError, quakeError } from '../botskill.js';
import { brainFor, registerBotHook } from './registry.js';
import { botStep, botSpeedAt, botCanRoll, arenaEscape, sidestep } from './arenas.js'; // boss arenas' areas (J2): sludge, fire, cover

export const DT = 0.05; // one snapshot (20 Hz)
export const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function useSkill(b, slot, face, tid) {
  const sk = CLASSES[b.cls]?.skills[slot];
  if (!b.me || !sk || b.cds[slot] > 0 || (b.me.lvl || 1) < (sk.lvl || 1)) return false;
  if (!skillReady(b, slot)) return false; // capability: slower rotations
  if (b.easeT === b.t) return false; // easing off threat this tick (shared/bots/threat.js easeOff)
  b.send({ type: 'skill', slot, face: face ?? b.face, ...(tid ? { tid } : {}) });
  pressed(b, slot);
  b.cds[slot] = 1; (b.pressed ||= [])[slot] = b.t;
  return true;
}

export function moveToward(b, tx, tz, stop = 0.4, speed = PLAYER_SPEED) {
  [tx, tz] = labSteer(b.x, b.z, ...aimNoise(b, tx, tz)); // capability: positioning error in fights; labyrinths: round the walls (next cell first)
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
  if (d <= stop) return false;
  if (b.airUntil > clock(b)) speed *= JUMP.air; // jumping: air control is a little weaker (shared/data.js airStep)
  speed *= botSpeedAt(b); // sludge (shared/arenas.js)
  const step = Math.min(d - stop, speed * (b.dt || DT)); // (b.dt: this snapshot's step, 0.1 s at 10 Hz)
  let nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
  const safe = botStep(b, nx, nz, tx, tz); // round sludge and fire, not into it
  if (!safe) return false;
  [nx, nz] = safe;
  [nx, nz] = resolveCollision(nx, nz);
  if (Math.hypot(nx - b.x, nz - b.z) < step * 0.3) [nx, nz] = sidestep(b, tx, tz, step, resolveCollision, (x, z) => walkable(x, z, !b.gateOpen)) || [nx, nz]; // stuck on a lower area's wall: round it
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
  if (b.dodgeCd <= 0 && !waveSoon(b, 1.4) && botCanRoll(b)) roll(b, Math.atan2(tx - b.x, tz - b.z)); // (no rolling in sludge)
  else moveToward(b, tx, tz);
}

export function stepRoll(b) {
  if (!b.roll) return false;
  const dt = b.dt || DT;
  const step = Math.min(b.roll.left, dt) * (DODGE.dist / DODGE.time);
  b.roll.left -= dt;
  const [nx, nz] = resolveCollision(b.x + Math.sin(b.roll.dir) * step, b.z + Math.cos(b.roll.dir) * step);
  if (walkable(nx, nz, !b.gateOpen)) { b.x = nx; b.z = nz; }
  if (b.roll.left <= 0) b.roll = null;
  return true;
}

// Floor 2: seconds until the next Tidal Wave reaches us (Infinity if none).
function waveEta(b, now = clock(b)) {
  let best = Infinity;
  for (const w of b.waves) {
    const r = (now - w.start) * w.sp, d = d2(b.x, b.z, w.x, w.z);
    if (r - w.w > d) continue; // already past us
    best = Math.min(best, (d - r - w.w) / w.sp);
  }
  return best;
}
const waveSoon = (b, secs) => waveEta(b) < secs;
// Roll INTO the wave just before it arrives: the i-frames carry us through. (Quake Rings first: see quakeDodge.)
export function waveDodge(b) {
  if (quakeDodge(b)) return true;
  const now = clock(b);
  b.waves = b.waves.filter(w => (now - w.start) * w.sp < w.max);
  const eta = waveEta(b, now);
  if (eta > 0.22 || eta < -0.08 || b.roll || b.dodgeCd > 0) return false;
  const w = b.waves.find(w => { const r = (now - w.start) * w.sp; return r - w.w <= d2(b.x, b.z, w.x, w.z); });
  // Hugging the boss, the roll into it goes nowhere (its body is in the way), so the i-frames alone must outlast the
  // whole band passing: roll later then. (Rolled at 0.22 s, the band's back edge caught us just after the i-frames:
  // Riptide's second wall, right behind the first, hit the melee this way.)
  const boss = b.mobs?.find(m => m.def?.boss), room = d2(b.x, b.z, w.x, w.z) - (boss?.def.radius ?? 2.5) - 0.4;
  if (room < 2.5 && eta > Math.max(0.1, DODGE.iframes - (2 * w.w) / w.sp - 0.05)) return false;
  roll(b, Math.atan2(w.x - b.x, w.z - b.z));
  return true;
}

// The Warden's Quake Rings (event 'quake', after capability perception): remembered here, cleared once they're gone.
// Timed on the wall clock, not b.t (one DT per snapshot): the server steps by real elapsed time, so under load its
// ticks get longer and a snapshot count runs slow, which is enough to mistime a jump. (A bot may bring its own b.clock.)
const clock = b => (b.clock ? b.clock() : performance.now() / 1000);
registerBotHook('onEvent', (b, e) => {
  if (e.t === 'quake') (b.quakes ||= []).push({ x: e.x, z: e.z, start: clock(b) + e.d, sp: e.sp, w: e.w, max: e.max });
  if (e.t === 'f2wave') b.waves.push({ x: e.x, z: e.z, start: clock(b) + e.d, sp: e.sp, w: e.w, max: e.max }); // the Sovereign's Tidal Waves (wall clock too)
});
// Seconds until the nearest Quake Ring's wavefront reaches us (tIn) and has passed (tOut); null if none will.
export function quakeEta(b, now = clock(b)) {
  let best = null;
  for (const q of b.quakes || []) {
    const r = (now - q.start) * q.sp, d = d2(b.x, b.z, q.x, q.z);
    if (d > q.max + q.w || r - q.w > d) continue; // out of its reach, or already past us
    const tIn = (d - q.w - r) / q.sp, tOut = (d + q.w - r) / q.sp;
    if (!best || tIn < best.tIn) best = { q, tIn, tOut };
  }
  return best;
}
// Jump the wavefront (airborne from JUMP.airFrom to JUMP.airTo after the press: press ~0.27 s before it reaches us),
// or roll through it when the jump isn't ready. In the air it steers out of any telegraph it's standing in (a slam or
// rockfall circle), sideways to the ring so the wavefront still passes under it on time; otherwise it holds still.
// Capability adds timing error (quakeError). Returns true while it takes over the bot's turn.
export function quakeDodge(b) {
  if (!b.quakes?.length) return false;
  const now = clock(b);
  b.quakes = b.quakes.filter(q => (now - q.start) * q.sp < q.max + q.w);
  if (b.qHold && b.qHold.until > now) { airSteer(b, b.qHold.q); return true; } // airborne: let it pass under us
  b.qHold = null;
  const e = quakeEta(b, now);
  if (!e || b.roll || e.q.jumped) return false;
  const lead = JUMP.airFrom + (JUMP.airTo - JUMP.airFrom - (e.tOut - e.tIn)) / 2 + quakeError(b, e.q); // ~0.27 s
  if (e.tIn > lead || e.tIn < -0.1) return false;
  if ((b.jumpT ?? -9) + JUMP.cd <= now) {
    e.q.jumped = true; b.jumpT = now; b.airUntil = now + JUMP.time;
    b.send({ type: 'jump' });
    b.qHold = { until: now + Math.min(JUMP.airTo, e.tOut + 0.1), q: e.q };
    return true;
  }
  if (e.tIn > 0.15 || b.dodgeCd > 0) return false; // jump on cooldown: roll through it instead
  e.q.jumped = true;
  roll(b, Math.atan2(e.q.x - b.x, e.q.z - b.z));
  return true;
}

// Mid-jump over a Quake Ring: if we're standing in a telegraph, drift out of it along the ring (tangentially).
function airSteer(b, q) {
  const spot = b.tele && dodgeSpot(b);
  if (!spot) return;
  const rx = b.x - q.x, rz = b.z - q.z, rl = Math.hypot(rx, rz) || 1, ux = rx / rl, uz = rz / rl;
  const dx = spot[0] - b.x, dz = spot[1] - b.z, along = dx * ux + dz * uz; // drop the part toward / away from the ring
  const tx = dx - ux * along, tz = dz - uz * along;
  if (Math.hypot(tx, tz) > 0.3) moveToward(b, b.x + tx * 3, b.z + tz * 3, 0.2);
}

// Point just outside any active telegraph we're standing in (or Floor 2 hazard), or null.
export function dodgeSpot(b) {
  b.tele = b.tele.filter(t => t.until > b.t);
  const hz = arenaEscape(b); // standing in sludge or fire (a boss arena's lower area): out first
  if (hz) return hz;
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
    const [cx, cz] = teleAt(b, t), d = d2(b.x, b.z, cx, cz);
    if (d < t.r + 1.2) { // straight out, unless that lands in another circle: then the nearest way out that doesn't
      const a = d > 0.1 ? Math.atan2(b.x - cx, b.z - cz) : 0;
      let first = null;
      for (const off of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
        const x = cx + Math.sin(a + off) * (t.r + 2.2), z = cz + Math.cos(a + off) * (t.r + 2.2);
        if (!walkable(x, z, !b.gateOpen)) continue;
        first ||= [x, z];
        if (!b.tele.some(o => o !== t && !o.line && d2(x, z, ...teleAt(b, o)) < o.r + 0.8)) return [x, z];
      }
      return first || [cx + Math.sin(a) * (t.r + 2.2), cz + Math.cos(a) * (t.r + 2.2)];
    }
  }
  return null;
}
function teleAt(b, t) { // a circle's centre (a Warden spin follows the Warden)
  const m = t.follow && b.mobs.find(m => m.id === t.follow);
  return m ? [m.x, m.z] : [t.x, t.z];
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
  const ox = FLOOR_X[floorOf(b.x)] ?? 0;
  if (!b.gateOpen && b.z > 120) { moveToward(b, ox, 154); return; }
  if (b.z < 150 && Math.abs(b.x - ox) > 3) moveToward(b, ox, Math.min(150, b.z + 6));
  else if (b.z < 162) moveToward(b, ox, 172);
  else moveToward(b, ox, 182);
}
