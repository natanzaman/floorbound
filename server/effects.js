// The effect engine (docs/briefs/path.md, Phase 3): runs the rules of shared/effects.js for awakenings (Mastery 5,
// AWAKEN in shared/mastery.js) and rule talent nodes (p.tal.rules, shared/talents.js). Installed after the subclasses
// (game.js) so the hooks see every other wrapper's result:
//   useSkill -> 'cast' (a cooldown started), damageMob -> 'hit' / 'crit' / 'switch' / 'kill', breakMob -> 'break',
//   healPlayer -> 'heal'. A rule never sets off another (this._fxDepth), and `icd` spaces one rule's procs per player.
import { AWAKEN, awakening } from '../shared/mastery.js';
import { skKey } from '../shared/talents.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;

export const EffectMethods = {
  // The rules that fire for p on `on`, with the skill involved (a mastery skill id, or null).
  fxRules(p, on, sk) {
    const out = [];
    if (sk && AWAKEN[sk]) { const a = awakening(sk, p.mastery?.[sk]); if (a && a.on === on) out.push([`aw:${sk}`, a]); }
    const R = p.tal?.rules;
    if (R?.length) {
      const key = sk ? (sk === this.sigDef?.(p)?.id ? 'sig' : skKey(p.cls, sk)) : null;
      for (const r of R) if (r.on === on && (!r.sk || r.sk === key)) out.push([r.id, r]);
    }
    return out;
  },
  // Fire p's rules for an event. ctx: { m (the enemy), t (the player healed) }.
  fxOn(p, on, sk, ctx = {}) {
    if (!p || p.dead || this._fxDepth || !this.players.has(p.id) || this.duelOf?.(p)) return; // (no rules in a duel)
    const list = this.fxRules(p, on, sk);
    if (!list.length) return;
    const now = this.time, icd = (p.fxIcd ||= {});
    for (const [id, r] of list) {
      if (r.icd && now < (icd[id] || 0)) continue;
      if (r.ch && r.ch < 1 && Math.random() >= r.ch) continue;
      if (r.icd) icd[id] = now + r.icd;
      this._fxDepth = (this._fxDepth || 0) + 1;
      try { this.fxDo(p, r, ctx); } finally { this._fxDepth--; }
    }
  },
  fxDo(p, r, { m = null, t = null } = {}) {
    const now = this.time, atk = p.atk * this.dmgMult(p), live = m && !m.dead && this.targetable(m) ? m : null;
    const ev = (extra = {}) => this.events.push({ t: 'fxr', k: r.do, id: p.id, to: p.id, x: r2((live || p).x), z: r2((live || p).z), ...extra });
    const allies = rad => (rad ? [...this.players.values()].filter(o => !o.dead && dist(o, p) <= rad && (o === p || !this.duelOf?.(o))) : [p]);
    switch (r.do) {
      case 'burn': {
        if (!live) return;
        // A lingering effect, not use time (effectLater: no longer cooldown), and not the skill's own hits: the ticks
        // carry no skill (no skill talents, mastery or chain steps), so the skill markers are cleared while queuing them.
        const per = atk * r.v, ticks = Math.max(1, Math.round(r.d)), tp = this._tp, tsk = p._tsk, sig = this._sigId;
        this._tp = null; p._tsk = null; this._sigId = null;
        try {
          for (let i = 1; i <= ticks; i++) (this.effectLater || this.schedule).call(this, i, () => {
            if (m.dead || !this.targetable(m) || !this.players.has(p.id)) return;
            this._fxDepth = (this._fxDepth || 0) + 1;
            try { this.damageMob(m, p, per, { threat: 0.5 }); } finally { this._fxDepth--; }
          });
        } finally { this._tp = tp; p._tsk = tsk; this._sigId = sig; }
        return ev({ d: r.d });
      }
      case 'slow': if (live) { this.slowMob?.(m, r.v, r.d); ev(); } return;
      case 'stun': if (live) { m.stunUntil = Math.max(m.stunUntil || 0, now + r.d * (m.def.boss ? 0.3 : 1)); ev(); } return;
      case 'posture': if (live) { this.addPosture(m, p, 0, { frac: r.frac }); ev(); } return;
      case 'mark': if (live) { m.fxMark = { until: now + r.d, v: Math.max(r.v, now < (m.fxMark?.until || 0) ? m.fxMark.v : 0) }; ev({ d: r.d }); } return;
      case 'burst': {
        if (!live) return;
        const x = m.x, z = m.z;
        this.hitCircle(p, x, z, r.r, atk * r.mult, { threat: 1 });
        return ev({ r: r.r });
      }
      case 'pull': {
        if (!live) return;
        for (const o of this.mobs.values()) if (o !== m && this.targetable(o) && dist(o, m) <= r.r + o.def.radius) this.dragToward(o, m, r.v, 1.2);
        return ev({ r: r.r });
      }
      case 'shield': for (const o of r.to === 't' && t ? [t] : allies(r.r)) if (!o.dead) this.talentShield(o, o.maxHp * r.v, r.d); return ev({ r: r.r || 0 }); // (to 't': the one healed)
      case 'heal': for (const o of allies(r.r)) if (!this.unhealable?.(o)) this.healPlayer(o, o.maxHp * r.v, p, null); return ev({ r: r.r || 0 });
      case 'team': for (const o of allies(r.r)) this.teamBuff(o, r.v, r.d); return ev({ r: r.r });
      case 'cdcut': for (let i = 1; i < 4; i++) if (p.cds[i] > now) p.cds[i] = Math.max(now, p.cds[i] - r.v); return ev();
      case 'dr': if (!(now < (p.dr?.until || 0) && p.dr.v >= r.v)) { p.dr = { until: now + r.d, v: r.v, by: p.id }; this.events.push({ t: 'buff', id: p.id, k: 'dr', d: r.d }); } return ev();
      case 'rage': if (p.cls === 'berserker') { p.rage = Math.min(100, (p.rage || 0) + r.v); ev(); } return;
    }
  },
};

export function installEffects(Game) {
  const P = Game.prototype;
  Object.assign(P, EffectMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('useSkill', function (orig, p, slot, face) {
    const before = p?.cds?.[slot | 0], r = orig.call(this, p, slot, face);
    if (p && (slot | 0) > 0 && p.cds[slot | 0] !== before && !p._borrowing) {
      const sk = this.skillAt ? this.skillAt(p, slot | 0) : null;
      if (sk && !sk.borrow) this.fxOn(p, 'cast', sk.id, {});
    }
    return r;
  });
  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    if (!p || !m || m.def?.duel) return orig.call(this, m, p, base, opts); // (a duel stand-in: duelHit decides, no rules)
    if (m.fxMark && this.time < m.fxMark.until) base *= 1 + m.fxMark.v; // a Mark (shared/effects.js)
    const ev0 = this.events.length, wasDead = m.dead, sk = this.mSk ? this.mSk(p, opts.sk || null) : opts.sk || null;
    const r = orig.call(this, m, p, base, opts);
    if (this._fxDepth || !this.players.has(p.id)) return r;
    let hit = null;
    for (let i = ev0; i < this.events.length; i++) { const e = this.events[i]; if (e.t === 'hit' && e.id === m.id && e.by === p.id) { hit = e; break; } }
    if (!hit) return r;
    const ctx = { m };
    this.fxOn(p, 'hit', sk, ctx);
    if (hit.c) this.fxOn(p, 'crit', sk, ctx);
    if (hit.sw) this.fxOn(p, 'switch', sk, ctx);
    if (m.dead && !wasDead) this.fxOn(p, 'kill', sk, ctx);
    return r;
  });
  wrap('breakMob', function (orig, m, p, interrupt = false, sk = null) {
    const r = orig.call(this, m, p, interrupt, sk);
    if (p && this.players.has(p.id)) this.fxOn(p, 'break', sk, { m });
    return r;
  });
  wrap('healPlayer', function (orig, t, amount, by, sk) {
    const got = orig.call(this, t, amount, by, sk);
    if (by && got > 0 && this.players.has(by.id)) this.fxOn(by, 'heal', this.mSk ? this.mSk(by, sk) : sk, { t });
    return got;
  });
}
