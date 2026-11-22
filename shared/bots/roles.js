// Bots and the combat quick wins (docs/briefs/combat-quickwins.md):
//  - Boss parts (w.bp, shared/bossparts.js): melee bots (not the tank) at capability 4-5 stand in an unbroken part's
//    arc when it is safe: a side / rear part any time, a front part only while the boss is Broken or in an opening.
//    Two bots split between two parts (by id).
//  - Shielded mobs (def.shell): melee bots at capability 3+ go round to its back until its shield is down (Broken).
//  - Target choice (roleScore): ranged bots prefer flyers, melee bots leave a flyer they can't touch while it hovers,
//    and from capability 4 everyone jumps on a caster channelling a heal (3 hits or a stun interrupts it).
//  - Armoured mobs (def.plate) and shields that Break (def.shieldBreak): Break skills are always welcome (ctx.mayBreak).
import { BOSS_PARTS, arcMid } from '../bossparts.js';
import { d2, moveToward, useSkill } from './motor.js';
import { openingOn } from './openings.js';

const faceTo = (b, t) => Math.atan2(t.x - b.x, t.z - b.z);

/** The snapshot's part rows into b.parts: boss id -> [part health %]. */
export function readParts(b, bp) {
  b.parts = new Map((bp || []).map(([id, pct]) => [id, pct]));
}

// Where a melee bot should stand on this boss for its parts, or null.
function partSpot(b, tgt, reach) {
  const P = BOSS_PARTS[tgt.type], pct = b.parts?.get(tgt.id);
  if (!P || !pct || (b.skill || 5) < 4 || typeof tgt.face !== 'number') return null;
  const safe = tgt.staggered || !!openingOn(b, tgt);
  const open = P.parts.filter((pt, i) => pct[i] > 0 && (safe || !(pt.arc[0] < 0 && pt.arc[1] > 0))); // (a front part: only when safe)
  if (!open.length) return null;
  const pt = open[b.id % open.length], a = tgt.face + arcMid(pt);
  return [tgt.x + Math.sin(a) * reach, tgt.z + Math.cos(a) * reach];
}

// Behind a shielded mob (its shield faces where it looks), or null.
function flankSpot(b, tgt, reach) {
  if (!tgt.def.shell || tgt.staggered || (b.skill || 5) < 3 || typeof tgt.face !== 'number') return null;
  const a = tgt.face + Math.PI;
  return [tgt.x + Math.sin(a) * reach, tgt.z + Math.cos(a) * reach];
}

/** Melee positioning for parts and shields. True if it took the turn (the class brain fought from the spot). */
export function roleTurn(b, tgt, ctx, fight) {
  if (!tgt || ctx.dodge || b.role === 'tank' || ctx.basic.kind === 'ranged' || !ctx.ready) return false;
  const reach = tgt.def.radius + Math.max(1, ctx.basic.reach - 1.4);
  const spot = tgt.def.boss ? partSpot(b, tgt, reach) : flankSpot(b, tgt, reach);
  if (!spot) return false;
  const face = faceTo(b, tgt);
  if (d2(b.x, b.z, spot[0], spot[1]) > 0.9) {
    moveToward(b, spot[0], spot[1], 0.4);
    b.face = faceTo(b, tgt);
    if (d2(b.x, b.z, tgt.x, tgt.z) <= reach + 1) useSkill(b, 0, b.face); // swing on the way round
    b.goal = tgt.def.boss ? `Working on the ${tgt.def.name.replace(/^The /, '')}'s weak part` : `Going round the ${tgt.def.name}'s shield`;
    return true;
  }
  const x = b.x, z = b.z;
  fight(); // the class brain picks its skills; we keep our spot
  b.x = x; b.z = z; b.face = face;
  return true;
}

/** A target score change (lower is better) for the role enemies. */
export function roleScore(b, m, ranged) {
  let s = 0;
  if (m.def.fly) {
    const aloft = b.air?.includes(m.id);
    if (ranged) s -= 20; // flyers are the archers' and casters' job
    else if (aloft && m.def.aloft === 0 && (b.skill || 5) >= 3) s += 40; // can't touch it up there
  }
  if (m.def.caster && m.winding && (b.skill || 5) >= 4) s -= 50; // interrupt the heal
  return s;
}

/** Break skills are welcome on armoured mobs and shields that Break. */
export const wantsBreak = tgt => !!(tgt?.def.plate || tgt?.def.shieldBreak);
