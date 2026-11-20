// Targeting modes and cleave on the server (player settings, Controls → Combat; data in shared/targeting.js).
//   setTargetPrefs  { type: 'tprefs', mode, cleave, max } from the client, validated (p.tprefs). Bots never send it:
//                   p.tprefs null = the old behaviour everywhere (no caps, no lock preference, homing arrows).
//   atkFov          an attack's shape and target limit (ATTACKS x the weapon style's mods.fov).
//   capHits         Cleave: which of the enemies inside an attack's field it hits (lock first, then nearest).
//   arcTargets      the enemies inside an arc, capped (hitArc and the hand-written arc loops).
//   aimedMode / aimPad / lockedFor   what classes-a (aimA, arrows), mastery (pickFront), game.js (Smite), classes-b
//                   (sonic bolts) and styles (bolt basics) ask.
import { cleanPrefs, attackFov, capTargets, rayPick, AIM_PAD, CONE_HALF } from '../shared/targeting.js';

export const TargetingMethods = {
  setTargetPrefs(p, msg) { p.tprefs = cleanPrefs(msg); },
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
    if (!pr || !A || A.aoe || list.length <= 1) return list;
    const n = pr.cleave ? Math.min(A.n ?? Infinity, pr.max) : 1;
    const lock = p.target ? this.mobs.get(p.target) || null : null;
    return capTargets(list, { x: p.x, z: p.z, n, lock });
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
