// Enemies that force a role (docs/briefs/combat-quickwins.md 2), mixed into Game by installMobRoles (end of game.js).
// Data: shared/mobroles.js (appended to MOBS). The shield (Mire Bulwark) and the flyer (Gale Harrier) reuse Floor 2's
// shell and Floor 3's harpy rules (server/floor2.js f2DamageMod, server/floor3.js f3DamageMod); this module adds:
//  - plate (Ironhide Boar): x(1 - plate) damage until Broken, x plateBroken while Broken (damageMob wrapper).
//  - shieldBreak (Mire Bulwark): a Break keeps the shield down for that long (breakMob wrapper: m.shieldDownUntil).
//  - f2Hexer (Mire Hexer): the caster's AI, with its interruptible heal channel.
//  - Floor 1's role enemies (F1_ROLE_SPAWNS), added after the classic field.
// Events: { t: 'mrole', k: 'plate' | 'cracked' | 'shieldDown' | 'chan' | 'mend' | 'interrupt', id, to?, x, z, d?, r? }.
import { MOBS, rng } from '../shared/data.js';
import { F1_ROLE_SPAWNS, HEXER } from '../shared/mobroles.js';

const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const methods = {
  // A plated mob's damage multiplier against this hit (and the tags for the hitter).
  plateMul(m, p) {
    const D = m.def;
    if (!D.plate) return 1;
    if (this.time < m.staggerUntil) return D.plateBroken || 1;
    if (this.time - (m.plateTag || 0) > 0.3) { m.plateTag = this.time; this.events.push({ t: 'mrole', k: 'plate', id: m.id, to: p.id, x: r2(m.x), z: r2(m.z) }); }
    return 1 - D.plate;
  },

  // ---------- the Mire Hexer ----------
  f2Hexer(m, dt) {
    const t = this.time;
    if (m.chan && (m.dead || !m.windupAt || t < m.stunUntil || t < m.staggerUntil || m.chan.hits >= HEXER.breakHits)) { // interrupted
      m.chan = null; m.windupAt = 0;
      if (!m.dead) {
        m.stunUntil = Math.max(m.stunUntil, t + HEXER.stun); m.hexT = t + HEXER.every * 0.6;
        this.events.push({ t: 'mrole', k: 'interrupt', id: m.id, x: r2(m.x), z: r2(m.z), d: HEXER.stun });
      }
    }
    const target = this.f2Pre(m);
    if (target === false) return;
    if (m.chan) { if (t >= m.chan.until) this.hexMend(m); return; }
    if (!target) { m.hexT = 0; m.windupAt = 0; this.f2Wander(m, dt); return; }
    if (!m.hexT) m.hexT = t + HEXER.first;
    if (t >= m.hexT && this.hexHurtAlly(m)) { // channel the heal (an interruptible wind-up)
      m.hexT = t + HEXER.every;
      m.chan = { until: t + HEXER.channel, hits: 0 }; m.windupAt = m.chan.until;
      this.events.push({ t: 'mrole', k: 'chan', id: m.id, x: r2(m.x), z: r2(m.z), d: HEXER.channel, r: HEXER.r });
      return;
    }
    const d = dist(m, target);
    m.face = Math.atan2(target.x - m.x, target.z - m.z);
    if (d > HEXER.keep[1]) this.f2Move(m, target.x, target.z, m.def.speed, dt, HEXER.keep[1] - 1, true);
    else if (d < HEXER.keep[0] && Math.hypot(m.x - m.sx, m.z - m.sz) < HEXER.leash) this.f2Move(m, m.x * 2 - target.x, m.z * 2 - target.z, m.def.speed * 0.8, dt, 0, true);
    if (t >= m.atkT && d <= m.def.range) { // a hex circle under its target
      m.atkT = t + m.def.atkCd;
      const x = target.x, z = target.z, R = HEXER.boltR, amount = m.def.atk * HEXER.boltMult;
      this.events.push({ t: 'tele', x: r2(x), z: r2(z), r: R, d: HEXER.boltWind, k: 'hex' });
      this.schedule(HEXER.boltWind, () => {
        if (m.dead) return;
        this.events.push({ t: 'fx', k: 'boom', x: r2(x), z: r2(z), r: R });
        for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.z - z) <= R) this.damagePlayer(p, amount, { ground: true, src: 'hexer hex', mob: m });
      });
    }
  },
  hexHurtAlly(m) { // someone near it worth mending (itself included)
    for (const a of this.mobs.values()) if (!a.dead && !a.def.boss && a.hp < a.maxHp * 0.9 && dist(a, m) <= HEXER.r && !a.def.prop && !a.def.duel) return true;
    return false;
  },
  hexMend(m) {
    const ids = [];
    m.chan = null; m.windupAt = 0;
    for (const a of this.mobs.values()) {
      if (a.dead || a.def.boss || a.def.prop || a.def.duel || dist(a, m) > HEXER.r) continue;
      a.hp = Math.min(a.maxHp, Math.round(a.hp + a.maxHp * HEXER.heal)); ids.push(a.id);
    }
    this.events.push({ t: 'mrole', k: 'mend', id: m.id, x: r2(m.x), z: r2(m.z), r: HEXER.r, ids });
  },
};

export function installMobRoles(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };
  wrap('damageMob', function (orig, m, p, base, opts) {
    if (m?.def?.plate && p && this.targetable(m)) base *= this.plateMul(m, p);
    if (m?.chan && m.def.caster && this.targetable(m)) m.chan.hits++;
    return orig.call(this, m, p, base, opts);
  });
  wrap('breakMob', function (orig, m, p, ...a) {
    const out = orig.call(this, m, p, ...a);
    if (m.def.shieldBreak) { m.shieldDownUntil = this.time + m.def.shieldBreak; this.events.push({ t: 'mrole', k: 'shieldDown', id: m.id, x: r2(m.x), z: r2(m.z), d: m.def.shieldBreak }); }
    if (m.def.plate) this.events.push({ t: 'mrole', k: 'cracked', id: m.id, x: r2(m.x), z: r2(m.z), d: r2(m.staggerUntil - this.time) });
    return out;
  });
  wrap('spawnMobs', function (orig, ...a) {
    const out = orig.call(this, ...a), r = rng(71);
    for (const [type, n, xs, zs] of F1_ROLE_SPAWNS) for (let i = 0; i < n && MOBS[type]; i++) this.addMob(type, xs[0] + r() * (xs[1] - xs[0]), zs[0] + r() * (zs[1] - zs[0]));
    return out;
  });
}
