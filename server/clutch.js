// Clutch moments (docs/briefs/combat-quickwins.md 4), mixed into Game by installClutch (end of game.js). Data:
// shared/clutch.js.
//  - Last Stand: evadeHit (a perfect dodge) and guardHit (a parry) note p.clutchAt. game.js damagePlayer asks
//    lastStand(p, src, duel) before going down: within LAST_STAND.after s of that, once per fight, p stays up at 1 HP
//    and nothing hurts them for LAST_STAND.invuln s (damagePlayer wrapper).
//  - Finisher: a floor boss's death from a Team Burst (this._tbIn) or the killing blow (the Last Attack): a `finisher`
//    event naming everyone in that fight; their clients play a short slow-motion beat (public/clutch.js).
// Events: { t: 'lstand', id, x, z, d } · { t: 'finisher', id (the boss), by, tb (1: a Team Burst), ids }.
// Off during a director show (a show's deaths and kills stay as staged).
import { LAST_STAND, lastStandReady } from '../shared/clutch.js';
import { inArena } from '../shared/data.js';
import { inArena2 } from '../shared/floor2.js';
import { inArena3 } from '../shared/floor3.js';

const r2 = v => Math.round(v * 100) / 100;
const IN_ARENA = { warden: inArena, sovereign: inArena2, colossus: inArena3 };

const methods = {
  lastStand(p, src, duel) {
    if (duel || p.duel || p.downed || p.dead || this.director?.running) return false;
    const t = this.time, fight = this.activeFightOf?.(p)?.[1] || null;
    if (!lastStandReady({ now: t, clutchAt: p.clutchAt, usedFight: p.lsFight, usedAt: p.lsAt, fight })) return false;
    p.hp = LAST_STAND.hp; p.lsUntil = t + LAST_STAND.invuln; p.lsAt = t; p.lsFight = fight; p.clutchAt = -1e9;
    this.events.push({ t: 'lstand', id: p.id, x: r2(p.x), z: r2(p.z), d: LAST_STAND.invuln });
    return true;
  },
};

export function installClutch(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };
  wrap('evadeHit', function (orig, p, ...a) {
    const n = p.perfects || 0, out = orig.call(this, p, ...a);
    if ((p.perfects || 0) > n) p.clutchAt = this.time;
    return out;
  });
  wrap('guardHit', function (orig, p, ...a) {
    const out = orig.call(this, p, ...a);
    if (out === 'parry') p.clutchAt = this.time;
    return out;
  });
  wrap('damagePlayer', function (orig, p, base, opts = {}) {
    if (p && this.time < (p.lsUntil || 0) && !p.dead && !opts.duel) return; // Last Stand: untouchable for a moment
    return orig.call(this, p, base, opts);
  });
  wrap('killMob', function (orig, m, killer, ...a) {
    const boss = !!m?.def?.boss && !!IN_ARENA[m.type] && !m.dead, tb = !!this._tbIn;
    const f = boss ? this.bossFightOf?.(m) : null;
    const out = orig.call(this, m, killer, ...a);
    if (boss && m.dead && !this.director?.running) {
      const inA = IN_ARENA[m.type], ids = [];
      for (const p of this.players.values()) if (f?.ids.has(p.id) || inA(p.x, p.z)) ids.push(p.id);
      this.events.push({ t: 'finisher', id: m.id, by: killer?.id || 0, tb: tb ? 1 : 0, ids });
    }
    return out;
  });
}
