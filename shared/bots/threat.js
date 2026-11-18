// Bots and team threat (docs/ROADMAP.md G3): a Guardian Covers a hurt ally a big hit is coming for, a tank re-Taunts a
// boss / elite that turned on a partymate, and melee DPS take the side of the target opposite the tank (flank / Pincer).
// Bot mobs carry `tgt` (who a boss / elite is after) from the snapshot's `th` (server/threat.js).
import { BOT_SKILLS } from '../botskill.js';
import { COVER } from '../threat.js';

const near = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) <= r;
// Is point o inside a telegraph the bot has seen (red circle, or a lane) that lands within `soon` seconds?
function underTele(b, o, soon) {
  for (const t of b.tele || []) {
    if (t.until - b.t > soon) continue;
    if (t.line) {
      const [x2, z2, w] = t.line, lx = x2 - t.x, lz = z2 - t.z, l2 = lx * lx + lz * lz || 1;
      const k = Math.max(0, Math.min(1, ((o.x - t.x) * lx + (o.z - t.z) * lz) / l2));
      if (Math.hypot(o.x - (t.x + lx * k), o.z - (t.z + lz * k)) <= (w || 1.5) + 0.5) return true;
    } else if (near(o, t.x, t.z, (t.r || 0) + 0.5)) return true;
  }
  return false;
}

// A winding boss / elite is about to hit o: o is its target, or stands in its frontal swing (it faces its target).
function inSwing(b, m, o) {
  if (!m.winding || !(m.def.boss || m.def.elite) || !near(m, o.x, o.z, m.def.range + m.def.radius + 1.5)) return false;
  if (m.tgt === o.id) return true;
  const t = m.tgt && (b.players || []).find(p => p.id === m.tgt);
  if (!t) return false;
  const a = Math.atan2(o.x - m.x, o.z - m.z) - Math.atan2(t.x - m.x, t.z - m.z);
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 1.3; // the Warden's cleave arc
}

// Guardian: Cover a partymate under half health that a big hit is about to land on (a winding boss / elite after them
// or swinging through where they stand, or a telegraph under them). Noticed with the bot's Switch awareness (capability). Returns true if it covered.
export function botCover(b, ctx) {
  if (b.dead || b.cls !== 'guardian' || (b.me?.cov ?? 99) > 0.05 || b.t - (b.coverT ?? -99) < 0.8) return false;
  const aware = (BOT_SKILLS[b.skill] || BOT_SKILLS[5]).switchAware;
  for (const o of ctx.party.all) {
    if (o.id === b.id || o.dead || o.hp / o.maxHp >= 0.5 || !near(o, b.x, b.z, COVER.range - 0.5)) continue;
    if (!b.mobs.some(m => inSwing(b, m, o)) && !underTele(b, o, 1.3)) continue;
    b.coverT = b.t;
    if (Math.random() >= aware) return false; // didn't see it in time (lower capability)
    b.send({ type: 'cover', tid: o.id });
    return true;
  }
  return false;
}

// Tank: a boss / elite it's fighting turned on a partymate: Taunt it back (when the Taunt is up and it's in reach).
export function lostAggro(b, tgt, ctx) {
  return !!tgt.tgt && tgt.tgt !== b.id && (tgt.def.boss || tgt.def.elite) && ctx.party.all.some(p => p.id === tgt.tgt && p.id !== b.id);
}

// Melee DPS: the spot on the far side of the target from the anchor (the tank), `r` from its centre, for a Pincer.
export function oppositeSpot(tgt, anchor, r) {
  const tx = tgt.x - anchor.x, tz = tgt.z - anchor.z, tl = Math.hypot(tx, tz) || 1;
  return [tgt.x + (tx / tl) * r, tgt.z + (tz / tl) * r];
}
