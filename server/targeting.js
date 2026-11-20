// Targeting modes and cleave on the server (player settings, Controls → Combat; data in shared/targeting.js).
//   setTargetPrefs  { type: 'tprefs', mode, cleave, max } from the client, validated (p.tprefs). Bots never send it:
//                   p.tprefs null = the old behaviour everywhere (no caps, no lock preference, homing arrows).
//   atkFov          an attack's shape and target limit (ATTACKS x the weapon style's mods.fov).
//   capHits         which of the enemies inside an arc / line attack's field it hits: Cone mode drops any outside the
//                   cone around the camera's look (p.aimYaw, sent with each skill; old clients without it: no filter;
//                   round attacks exempt), then Cleave caps them (lock first in Locked or nearest / Cone, nearest in
//                   Nearest, nearest the aim line in Aimed; aoe attacks: only their own limit).
//   arcTargets      the enemies inside an arc, capped (hitArc and the hand-written arc loops).
//   aimedMode / aimPad / lockedFor   what classes-a (aimA, arrows), mastery (pickFront), game.js (Smite), classes-b
//                   (sonic bolts) and styles (bolt basics) ask.
import { cleanPrefs, attackFov, capTargets, rayPick, inCone, AIM_PAD, CONE_HALF } from '../shared/targeting.js';
import { wrapAngle } from '../shared/data.js';

export const TargetingMethods = {
  setTargetPrefs(p, msg) { p.tprefs = cleanPrefs(msg); },
  // The camera's look with a skill press (Cone mode's filter): a finite number, wrapped; anything else = none.
  // (p.aimYaw, not p.look: that name is the character's appearance, server/looks.js)
  setAimYaw(p, look) { p.aimYaw = typeof look === 'number' && Number.isFinite(look) ? wrapAngle(look) : null; },
  aimedMode(p) { return p.tprefs?.mode === 'aimed'; },
  aimPad(p) { return this.aimedMode(p) ? AIM_PAD : 0; }, // aimed projectiles: a slightly bigger hitbox
  // The locked enemy when this player's mode respects it (Locked or nearest, Cone), else null.
  lockedFor(p) {
    const mode = p.tprefs?.mode;
    if (mode !== 'lock' && mode !== 'cone') return null;
    const m = p.target && this.mobs.get(p.target);
    return this.targetable(m) ? m : null;
  },
  atkFov(p, key, over = null) { return attackFov(key, { fov: this.styleNum(p, 'fov', 1), over }); },
  capHits(p, list, A) {
    const pr = p.tprefs;
    if (!pr || !A) return list; // bots, old call sites: unchanged
    if (pr.mode === 'cone' && !A.round && typeof p.aimYaw === 'number') list = list.filter(m => inCone(p.x, p.z, p.aimYaw, m, CONE_HALF));
    const n = A.aoe ? A.n ?? Infinity : pr.cleave ? Math.min(A.n ?? Infinity, pr.max) : 1;
    if (list.length <= n) return list;
    const lock = this.lockedFor(p); // (Locked or nearest, Cone only)
    return capTargets(list, { x: p.x, z: p.z, n, lock, line: pr.mode === 'aimed' ? p.face : null });
  },
  arcTargets(p, range, half, A) {
    const list = [];
    for (const m of this.mobs.values()) if (this.targetable(m) && this.inArc(p, m, range, half)) list.push(m);
    return this.capHits(p, list, A);
  },
  // Aimed mode: the first enemy along the aim line (pickFront). Cone mode: never wider than the cone.
  aimedPick(p, range) { return rayPick({ x: p.x, z: p.z, a: p.face, mobs: this.mobs.values(), range, canTarget: m => this.targetable(m) }); },
  frontHalf(p, half) { return p.tprefs?.mode === 'cone' ? Math.min(half, CONE_HALF) : half; },
};

export function installTargeting(Game) {
  Object.assign(Game.prototype, TargetingMethods);
}
