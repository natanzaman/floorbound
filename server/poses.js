// Poses (docs/ROADMAP.md F5): kneel, sit, bow. Players use them with /kneel, /sit, /bow, /stand; the scene director
// (F2) calls setPose. A pose is stored on the player (p.pose), announced with { t: 'pose', id, k } and listed in every
// snapshot while any is held (w.poses = [[id, k], ...], left out when empty), so late joiners and spectators see it.
// It clears itself when the character moves, attacks or uses a skill, guards, dodges, jumps or dies.
export const POSE_KINDS = ['kneel', 'sit', 'bow'];
const CMD = /^\/(kneel|sit|bow|stand)\s*$/i;

export const PoseMethods = {
  // k: 'kneel' | 'sit' | 'bow' | null ('none' / 'stand' also mean null). Returns whether the pose changed.
  setPose(p, k) {
    if (k === 'none' || k === 'stand') k = null;
    if (k != null && !POSE_KINDS.includes(k)) return false;
    if (k && (p.dead || this.time < p.rollUntil || (this.time >= p.airFrom && this.time < p.airUntil))) return false;
    if ((p.pose || null) === k) return false;
    p.pose = k;
    this.events.push({ t: 'pose', id: p.id, k });
    return true;
  },
  clearPose(p) { if (p?.pose) this.setPose(p, null); },
  posesSnap() {
    const out = [];
    for (const p of this.players.values()) if (p.pose) out.push([p.id, p.pose]);
    return out.length ? out : undefined; // undefined: JSON.stringify leaves the key out
  },
};

export function installPoses(Game) {
  const P = Game.prototype;
  Object.assign(P, PoseMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('handle', function (orig, p, msg) { // chat /kneel, /sit, /bow, /stand (never shown as chat)
    const m = msg?.type === 'chat' && String(msg.text || '').trim().match(CMD);
    if (!m) return orig.call(this, p, msg);
    this.setPose(p, m[1].toLowerCase());
  });
  wrap('onInput', function (orig, p, msg) {
    if (!p.pose) return orig.call(this, p, msg);
    const x = p.x, z = p.z;
    orig.call(this, p, msg);
    if (Math.hypot(p.x - x, p.z - z) > 0.05) this.clearPose(p);
  });
  wrap('useSkill', function (orig, p, slot, ...a) {
    if (!p.pose) return orig.call(this, p, slot, ...a);
    const before = p.cds[slot | 0];
    const r = orig.call(this, p, slot, ...a);
    if (p.cds[slot | 0] !== before) this.clearPose(p); // it was used (a cooldown started)
    return r;
  });
  wrap('dodge', function (orig, p, ...a) { const r = orig.call(this, p, ...a); if (this.time < p.rollUntil) this.clearPose(p); return r; });
  wrap('jump', function (orig, p, ...a) { const r = orig.call(this, p, ...a); if (this.time < p.airUntil) this.clearPose(p); return r; });
  wrap('guard', function (orig, p, on, ...a) { const r = orig.call(this, p, on, ...a); if (p.guarding) this.clearPose(p); return r; });
  wrap('teleport', function (orig, p, ...a) { this.clearPose(p); return orig.call(this, p, ...a); });
  wrap('update', function (orig, ...a) { // dying (by any path, e.g. a scripted death) or a forced move clears it too
    const r = orig.apply(this, a);
    for (const p of this.players.values()) if (p.pose && p.dead) this.clearPose(p);
    return r;
  });
}
