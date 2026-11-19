// Floor 3 bot reflexes (docs/floor3.md): jumping the Storm Colossus's Tempest Beam, and spending Break skills into an
// Overload. Capability (shared/botskill.js) adds timing error to the jump, like the Warden's Quake Rings.
import { CLASSES, JUMP } from '../data.js';
import { quakeError } from '../botskill.js';
import { registerBotHook } from './registry.js';
import { losBlocked } from '../arenas.js';
import { d2, useSkill, moveToward } from './motor.js';

const clock = b => (b.clock ? b.clock() : performance.now() / 1000);
const wrap = a => { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; };

registerBotHook('onEvent', (b, e) => {
  if (e.t === 'f3beam') (b.beams ||= []).push({ x: e.x, z: e.z, a0: e.a0, dir: e.dir, start: clock(b) + e.d, turn: e.turn, w: e.w, len: e.len });
  if (e.t === 'f3ov') b.ovMob = e.s === 'start' ? e.id : null;
});

// Seconds until the beam reaches us (tIn) and has passed (tOut); null if it won't (done, or we're out of its reach).
export function beamEta(b, now = clock(b), ignoreCover = false) {
  let best = null;
  for (const m of b.beams || []) {
    const d = d2(b.x, b.z, m.x, m.z);
    if (d > m.len + 0.5) continue;
    if (!ignoreCover && losBlocked(m.x, m.z, b.x, b.z)) continue; // behind a great pillar (the Undercroft): it passes us by
    const ap = Math.atan2(b.x - m.x, b.z - m.z), tol = Math.atan2(m.w + 0.45, Math.max(0.5, d));
    const ahead = wrap((ap - m.a0) * m.dir); // how far round the beam must sweep from its start to reach us
    const k = (now - m.start) / m.turn, swept = Math.max(0, k) * Math.PI * 2;
    if (ahead + tol < swept) continue; // already past us
    const tIn = m.start + ((ahead - tol) / (Math.PI * 2)) * m.turn - now, tOut = m.start + ((ahead + tol) / (Math.PI * 2)) * m.turn - now;
    if (!best || tIn < best.tIn) best = { m, tIn, tOut };
  }
  return best;
}

// Jump the beam as it reaches us (or roll through it when the jump is on cooldown). True while it takes the bot's turn.
export function beamDodge(b) {
  if (!b.beams?.length) return false;
  const now = clock(b);
  b.beams = b.beams.filter(m => now < m.start + m.turn + 0.3);
  if (b.bHold && b.bHold > now) return true; // airborne: let it pass under us
  b.bHold = 0;
  const e = beamEta(b, now);
  if (!e || b.roll || e.m.jumpedAt === Math.round(e.tIn + now)) return false;
  const lead = JUMP.airFrom + Math.max(0, (JUMP.airTo - JUMP.airFrom - (e.tOut - e.tIn)) / 2) + quakeError(b, e.m);
  if (e.tIn > lead || e.tIn < -0.1) return false;
  if ((b.jumpT ?? -9) + JUMP.cd <= now) {
    e.m.jumpedAt = Math.round(e.tIn + now); b.jumpT = now; b.airUntil = now + JUMP.time;
    b.send({ type: 'jump' });
    b.bHold = now + Math.min(JUMP.airTo, e.tOut + 0.1);
    return true;
  }
  return false;
}

// During an Overload: walk in and spend a Break skill on the Colossus (its guard is open). True if it acted.
export function overloadTurn(b, tgt) {
  if (!b.ovMob || tgt?.id !== b.ovMob || tgt.staggered) return false;
  const skills = CLASSES[b.cls]?.skills || [];
  const slot = skills.findIndex((s, i) => s.brk && b.cds[i] <= 0 && (b.me?.lvl || 1) >= (s.lvl || 1));
  if (slot < 0) return false;
  const reach = b.cls === 'lancer' ? 9 : b.cls === 'bard' ? 7 : 3.2;
  const d = d2(b.x, b.z, tgt.x, tgt.z) - (tgt.def?.radius || 0);
  const face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
  if (d > reach) { moveToward(b, tgt.x, tgt.z, (tgt.def?.radius || 0) + reach * 0.7); return true; }
  b.face = face;
  return useSkill(b, slot, face, tgt.id);
}
