// Breakable boss parts (docs/briefs/combat-quickwins.md 1), mixed into Game by installBossParts (end of game.js).
// Data: shared/bossparts.js. Off while a director show runs (its fights stay as rehearsed).
//  - damageMob wrapper: a hit on an engaged boss from inside a part's arc (the attacker's position vs the boss's
//    facing) wears that part down by the damage dealt x1.5 (melee, within PART.melee m of its edge) or x0.5 (farther).
//    The kneel's extra damage taken is applied here too.
//    A hit's own damage only: a damageMob inside another (a Shatter Chorus out of a Break) counts for itself and is
//    taken out of the outer hit's health change (m._pnest).
//  - A part at 0: `bpart` event and its effect on the fight: `off` moves stop (partOff: the Horn Sweep), `tm` changes
//    go into a copy of m.tm. The bonus personal loot roll (LOOT['part:...']) for every fighter in the arena is paid
//    only when the boss dies, for each part broken in that winning fight (a wipe or a walk-out pays nothing, so
//    resetting the fight can't farm parts).
//  - The part state is made when the boss engages (pips from the start).
//  - Every part of a boss with `all.kneel` broken: it kneels (stunned, busy) for `secs`, taking x`taken`; once per fight,
//    and only once it is free (no Overload, no fall to the Undercroft running). Kneeling drops what it had under way:
//    scheduled strikes and gusts (m.ep), the Tempest Beam, a combo in flight.
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
    for (const p of this.players.values()) if (!p.dead && inA?.(p.x, p.z)) this.teamStat?.(p, 'mechanic');
    if (P.all?.kneel && !s.knelt && s.hp.every(h => h <= 0)) s.pend = true;
  },

  /** The boss died: a bonus roll per part broken in this fight, for everyone in the arena who fought it. */
  partLoot(m, s) {
    const P = BOSS_PARTS[m.type], inA = IN_ARENA[m.type];
    const who = [...this.players.values()].filter(p => !p.dead && inA?.(p.x, p.z) && (m.contributors.has(p.id) || m.threat.has(p.id)));
    P.parts.forEach((pt, i) => {
      if (s.hp[i] > 0) return;
      for (const p of who) this.dropLoot(p, { type: pt.loot.slice(pt.loot.indexOf(':') + 1), def: { part: true }, x: m.x, z: m.z });
    });
  },

  // Per tick: part state for an engaged boss; a pending kneel starts once the boss is free; a kneel ends early if the
  // fall to a lower area begins.
  updateParts() {
    for (const m of [this.boss, this.sovereign, this.colossus]) {
      if (m && !m.dead && m.engaged) this.partsOf(m);
      const s = m?.bp;
      if (!s || m.dead || s.fight !== this.bossFightOf(m)) continue;
      const K = BOSS_PARTS[m.type]?.all?.kneel, t = this.time;
      if (!K) continue;
      if (s.pend && !s.knelt && !m.ov && !(this.arenaHold?.(m)) && t >= (m.stunUntil || 0)) {
        s.pend = false; s.knelt = true; s.kneelUntil = t + K.secs;
        m.stunUntil = Math.max(m.stunUntil || 0, s.kneelUntil); m.busyUntil = Math.max(m.busyUntil || 0, s.kneelUntil); m.windupAt = 0;
        m.ep = (m.ep || 0) + 1; m.seq = null; m.after = null; // pending strikes and gusts fizzle, a combo in flight ends
        if (this.beams) this.beams = this.beams.filter(b => b.m !== m); // the Tempest Beam
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
    const outer = m._pdepth ? m._pnest || 0 : 0, hp = m.hp;
    m._pnest = 0; m._pdepth = (m._pdepth || 0) + 1;
    let out;
    try { out = orig.call(this, m, p, base, opts); } finally {
      m._pdepth--;
      const total = hp - Math.max(0, m.hp), own = total - m._pnest; // nested hits counted themselves
      m._pnest = outer + total;
      this.partHit(m, p, own);
    }
    return out;
  });
  wrap('killMob', function (orig, m, ...a) {
    const s = m?.def?.boss && BOSS_PARTS[m.type] && m.bp && m.bp.fight === this.bossFightOf(m) && this.partsOn() && m.bp.hp.some(h => h <= 0) ? m.bp : null;
    const out = orig.call(this, m, ...a);
    if (s) this.partLoot(m, s);
    return out;
  });
  wrap('update', function (orig, dt) { const out = orig.call(this, dt); this.updateParts(); return out; });
}
