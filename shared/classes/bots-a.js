// Bot brains for the Ranger and Berserker, used by shared/teambots.js (the party's DPS slot and the single-bot brain).
// Ranger: keeps 9-12 m from its target, shoots, opens with Hunter's Mark, Piercing Shot on cooldown (and to Switch),
// Disengages when something reaches it. Berserker: dives in with Leap Slam, chops, Cleaves at high Rage or into a
// crowd, Bloodrage when it has the Rage for it.
import { CLASSES } from '../data.js';

export const TEAM_NAMES_A = { ranger: 'Sylas', berserker: 'Bjorn' };
export const isDpsA = cls => CLASSES[cls]?.role === 'Damage';

// Snapshot events a bot cares about: its own Rage.
export function onEventA(b, e) {
  if (e.t !== 'rageA') return;
  const r = e.l.find(x => x[0] === b.id);
  b.rageA = r ? r[1] : 0;
}

// h: { useSkill, moveToward, switchOpen, d2, ready (the tank has aggro), anchor (the tank, or null), dodge (rolling away) }.
// Returns true when it played b's turn (b is a Ranger or Berserker).
export function brainA(b, tgt, h) {
  if (b.cls === 'ranger') return ranger(b, tgt, h);
  if (b.cls === 'berserker') return berserker(b, tgt, h);
  return false;
}

function ranger(b, tgt, h) {
  const { useSkill, moveToward, d2, anchor } = h;
  const d = d2(b.x, b.z, tgt.x, tgt.z), face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
  const want = tgt.def.boss ? 12.5 : 10;
  if (!h.dodge) {
    if (anchor && !h.ready) { // let the tank grab aggro: wait behind it
      const tx = anchor.x - tgt.x, tz = anchor.z - tgt.z, tl = Math.hypot(tx, tz) || 1;
      moveToward(b, anchor.x + (tx / tl) * 4, anchor.z + (tz / tl) * 4, 0.8);
      b.face = face;
      return true;
    }
    const close = b.mobs.some(m => !m.def.boss && m.engaged && d2(m.x, m.z, b.x, b.z) < 3 + m.def.radius);
    if (close && d < 6 && useSkill(b, 2, face)) { b.face = face; return true; } // Disengage
    if (d < want - 3 || d > want + 6) { // hold the range, off to the side of the tank's line
      let ax = b.x - tgt.x, az = b.z - tgt.z;
      if (anchor) { // the tank's side of the target, turned ~35° off its line
        const r = 0.6, x0 = anchor.x - tgt.x, z0 = anchor.z - tgt.z;
        ax = x0 * Math.cos(r) + z0 * Math.sin(r); az = -x0 * Math.sin(r) + z0 * Math.cos(r);
      }
      const al = Math.hypot(ax, az) || 1;
      moveToward(b, tgt.x + (ax / al) * want, tgt.z + (az / al) * want, 1);
    }
  }
  b.face = face;
  if (d > 23 + tgt.def.radius) return true;
  if (h.switchOpen(b, tgt) && useSkill(b, 1, face)) return true;                            // Switch in with Piercing Shot
  if ((b.me?.lvl || 1) >= 3 && (tgt.engaged || tgt.def.boss) && (tgt.def.boss || tgt.def.elite || tgt.maxHp >= 100) && useSkill(b, 3, face)) return true; // Hunter's Mark
  if (!tgt.staggered && useSkill(b, 1, face)) return true;                                  // Piercing Shot
  useSkill(b, 0, face);                                                                       // Shot
  return true;
}

function berserker(b, tgt, h) {
  const { useSkill, moveToward, d2, anchor } = h;
  const d = d2(b.x, b.z, tgt.x, tgt.z), face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
  const reach = tgt.def.radius + 1.6, rage = b.rageA || 0;
  if (!h.dodge) {
    if (anchor && !h.ready) {
      const tx = tgt.x - anchor.x, tz = tgt.z - anchor.z, tl = Math.hypot(tx, tz) || 1;
      moveToward(b, anchor.x - (tx / tl) * 4, anchor.z - (tz / tl) * 4, 0.8);
      b.face = face;
      return true;
    }
    if (d > 4 + tgt.def.radius && d < 9.5 && useSkill(b, 2, face)) { b.face = face; return true; } // Leap Slam in
    if (anchor) { // far side of the target from the tank, out of its frontal swing
      const tx = tgt.x - anchor.x, tz = tgt.z - anchor.z, tl = Math.hypot(tx, tz) || 1;
      moveToward(b, tgt.x + (tx / tl) * reach, tgt.z + (tz / tl) * reach, 0.5);
    } else moveToward(b, tgt.x, tgt.z, reach - 0.4);
  }
  b.face = face;
  if (d > reach + 1.2) return true;
  const crowd = b.mobs.filter(m => d2(m.x, m.z, b.x, b.z) < 4.5 + m.def.radius).length;
  if ((b.me?.lvl || 1) >= 3 && rage >= 50 && useSkill(b, 3, face)) return true;            // Bloodrage
  if (h.switchOpen(b, tgt) && useSkill(b, 1, face)) return true;                             // Switch in with Cleave
  if ((crowd >= 2 || rage >= 40 || tgt.def.boss) && useSkill(b, 1, face)) return true;       // Cleave
  useSkill(b, 0, face);                                                                       // Axe Chop
  return true;
}
