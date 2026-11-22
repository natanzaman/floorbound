// Breakable boss parts (docs/briefs/combat-quickwins.md 1), mixed into Game by installBossParts (end of game.js).
// Data: shared/bossparts.js. Off while a director show runs (its fights stay as rehearsed).
//  - damageMob wrapper: a hit on an engaged boss from inside a part's arc (the attacker's position vs the boss's
//    facing) wears that part down by the damage dealt x1.5 (melee, within PART.melee m of its edge) or x0.5 (farther).
//    The kneel's extra damage taken is applied here too.
//  - A part at 0: `bpart` event, a bonus personal loot roll for every fighter in the arena (LOOT['part:...']), and its
//    effect on the fight: `off` moves stop (hornSweep wrapper), `tm` changes go into a copy of m.tm.
//  - Every part of a boss with `all.kneel` broken: it kneels (stunned, busy) for `secs`, taking x`taken`; once per fight,
//    and only once it is free (no Overload, no fall to the Undercroft running).
// State on the boss: m.bp = { fight, hp: [..], max: [..], kneelUntil, knelt }. Snapshot: w.bp = [[id, [%...], kneel s]].
// Events: { t: 'bpart', id, k (part id), n (its index), by, x, z } · { t: 'kneel', id, d }.
import { BOSS_PARTS, partsAt, partDamage, applyPartTable } from '../shared/bossparts.js';
import { inArena } from '../shared/data.js';
import { inArena2 } from '../shared/floor2.js';
import { inArena3 } from '../shared/floor3.js';

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const IN_ARENA = { warden: inArena, sovereign: inArena2, colossus: inArena3 };

const methods = {
  partsOn() { return !this.director?.running && process.env.BOSS_PARTS !== '0'; },
  bossFightOf(m) { return m.type === 'warden' ? this.fight : m.type === 'sovereign' ? this.fight2 : m.type === 'colossus' ? this.fight3 : null; },

  /** The boss's part state for its current fight (made at the first look), or null (no parts, not engaged, a show). */
  partsOf(m) {
    const P = BOSS_PARTS[m?.type];
    if (!P || m.dead || !m.engaged || !this.partsOn()) return null;
    const f = this.bossFightOf(m);
    if (!f) return null;
    if (m.bp?.fight !== f) {
      const max = P.parts.map(pt => Math.max(1, Math.round(m.maxHp * pt.hp)));
      m.bp = { fight: f, max, hp: [...max], kneelUntil: 0, knelt: false, pend: false };
    }
    return m.bp;
  },
  partBroken(m, id) {
    const s = m?.bp, P = BOSS_PARTS[m?.type];
    if (!s || s.fight !== this.bossFightOf(m) || !this.partsOn()) return false;
    const i = P.parts.findIndex(pt => pt.id === id);
    return i >= 0 && s.hp[i] <= 0;
  },
  /** Does a broken part stop this move? */
  partOff(m, move) {
    const s = m?.bp, P = BOSS_PARTS[m?.type];
    if (!s || s.fight !== this.bossFightOf(m) || !this.partsOn()) return false;
    return P.parts.some((pt, i) => s.hp[i] <= 0 && pt.off?.includes(move));
  },
  kneeling(m) { return !!m?.bp && this.time < m.bp.kneelUntil; },

  /** A hit landed on a boss: wear down the parts in the attacker's arc. */
  partHit(m, p, dealt) {
    const s = this.partsOf(m);
    if (!s || dealt <= 0 || !p) return;
    const P = BOSS_PARTS[m.type], edge = Math.max(0, Math.hypot(p.x - m.x, p.z - m.z) - m.def.radius), amt = partDamage(dealt, edge);
    for (const pt of partsAt(m.type, m, p.x, p.z)) {
      const i = P.parts.indexOf(pt);
      if (s.hp[i] <= 0) continue;
      s.hp[i] = Math.max(0, s.hp[i] - amt);
      if (s.hp[i] <= 0) this.breakPart(m, i, p);
    }
  },

  breakPart(m, i, by) {
    const P = BOSS_PARTS[m.type], pt = P.parts[i], s = m.bp;
    this.events.push({ t: 'bpart', id: m.id, k: pt.id, n: i, by: by?.id || 0, x: r2(m.x), z: r2(m.z) });
    this.sys(`${pt.call}! ${pt.sub}`);
    if (pt.tm) m.tm = applyPartTable(m.tm, pt.tm);
    const inA = IN_ARENA[m.type];
    for (const p of this.players.values()) { // the bonus roll: everyone fighting it
      if (p.dead || !inA?.(p.x, p.z) || !(m.contributors.has(p.id) || m.threat.has(p.id))) continue;
      this.dropLoot(p, { type: pt.loot.slice(pt.loot.indexOf(':') + 1), def: { part: true }, x: m.x, z: m.z });
    }
    for (const p of this.players.values()) if (!p.dead && inA?.(p.x, p.z)) this.teamStat?.(p, 'mechanic');
    if (P.all?.kneel && !s.knelt && s.hp.every(h => h <= 0)) s.pend = true;
  },

  // Per tick: a pending kneel starts once the boss is free; a kneel ends early if the fall to a lower area begins.
  updateParts() {
    for (const m of [this.boss, this.sovereign, this.colossus]) {
      const s = m?.bp;
      if (!s || m.dead || s.fight !== this.bossFightOf(m)) continue;
      const K = BOSS_PARTS[m.type]?.all?.kneel, t = this.time;
      if (!K) continue;
      if (s.pend && !s.knelt && !m.ov && !(this.arenaHold?.(m)) && t >= (m.stunUntil || 0)) {
        s.pend = false; s.knelt = true; s.kneelUntil = t + K.secs;
        m.stunUntil = Math.max(m.stunUntil || 0, s.kneelUntil); m.busyUntil = Math.max(m.busyUntil || 0, s.kneelUntil); m.windupAt = 0;
        this.events.push({ t: 'kneel', id: m.id, d: K.secs });
        this.sys(`${K.call}! ${K.sub}`);
      }
      if (t < s.kneelUntil && this.arenaHold?.(m)) { s.kneelUntil = t; m.stunUntil = t; m.busyUntil = t; } // the fall wins
    }
  },

  partsSnap() {
    let out;
    for (const m of [this.boss, this.sovereign, this.colossus]) {
      const s = m && !m.dead && m.engaged && this.partsOn() ? m.bp : null;
      if (!s || s.fight !== this.bossFightOf(m)) continue;
      (out ||= []).push([m.id, s.hp.map((h, i) => Math.ceil((100 * h) / s.max[i])), r1(Math.max(0, s.kneelUntil - this.time))]);
    }
    return out;
  },
};

export function installBossParts(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };
  wrap('damageMob', function (orig, m, p, base, opts) {
    if (!m?.def?.boss || !BOSS_PARTS[m.type] || !p?.cls) return orig.call(this, m, p, base, opts);
    const K = BOSS_PARTS[m.type].all?.kneel;
    if (K && this.kneeling(m)) base *= K.taken;
    const hp = m.hp, out = orig.call(this, m, p, base, opts);
    this.partHit(m, p, hp - Math.max(0, m.hp));
    return out;
  });
  // A broken part's `off` moves: the Horn Sweep (its own timer and as a combo step) does nothing.
  wrap('hornSweep', function (orig, m, ...a) { return this.partOff(m, 'sweep') ? this.time : orig.call(this, m, ...a); });
  wrap('update', function (orig, dt) { const out = orig.call(this, dt); this.updateParts(); return out; });
}
