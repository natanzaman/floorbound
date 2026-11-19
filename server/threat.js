// Team threat (docs/ROADMAP.md G3), mixed into Game by installThreat(Game) (before installTalents, which stays last).
//
//  - Visible threat: snapshots carry `th` = [[mobId, targetId], ...] for engaged bosses and elites (who they're after),
//    and each player's `me.th` = [bossId, myPct, nextPct] (my threat as % of the top; when I'm the top, nextPct is the
//    runner-up as % of mine). The HUD draws the marker, the name on the boss bar and the meter (public/threat.js).
//  - Healer threat: effective healing (and damage a shield soaks) adds THREAT.heal × that amount of threat, split across
//    every enemy fighting the healer's / patient's party. Overheal adds none.
//  - Cover (Guardian, `{ type: 'cover', tid }`): dash to an ally within COVER.range and take the next hit meant for them
//    within COVER.window (braced like a guard). Perilous attacks (Horn Sweep) can't be covered: dodge or parry those.
//  - Flanking: a hit from the enemy's back 120° does +10% damage and posture; with a party member on the opposite side
//    (≥120° apart around it, both in melee-ish reach) both get a Pincer (+20%), tagged only to the two players.
//  - Team stats for the MVP card (G5): teamStat(p, 'heal' | 'save' | 'cover' | 'flank' | 'tanked', n) when G2's teamStat exists.
import { GUARD, inTown, resolveCollision } from '../shared/data.js';
import { THREAT, COVER, FLANK, fromBehind, apartAround, inFlankReach } from '../shared/threat.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const shown = m => m && !m.dead && !m.hidden && (m.def.boss || m.def.elite);

// [id, value] of the highest threat on m (living players only), or null.
export function topThreat(g, m) {
  let id = 0, top = -1;
  for (const [pid, v] of m.threat) { const p = g.players.get(pid); if (p && !p.dead && v > top) { top = v; id = pid; } }
  return id ? [id, top] : null;
}

const methods = {
  // ---------- visible threat ----------
  // (talents.js has topThreat(m) -> id over every entry; threatTop(m) -> [id, value] over living players only)
  threatTop(m) { return topThreat(this, m); },

  // [[mobId, targetId]] for engaged bosses and elites (snapshot `th`). Empty -> undefined (not sent).
  threatSnap() {
    let out;
    for (const m of this.mobs.values()) {
      if (!shown(m) || !m.threat.size) continue;
      const top = topThreat(this, m);
      if (top) (out ||= []).push([m.id, top[0]]);
    }
    return out;
  },

  // My meter against the boss I'm fighting: [bossId, my % of the top, runner-up % of mine when I'm the top].
  threatMe(p) {
    for (const m of this.mobs.values()) {
      if (!m.def.boss || m.dead || !m.threat.has(p.id)) continue;
      const mine = m.threat.get(p.id) || 0;
      let top = 0, second = 0, topId = 0;
      for (const [pid, v] of m.threat) {
        const o = this.players.get(pid); if (!o || o.dead) continue;
        if (v > top) { second = top; top = v; topId = pid; } else if (v > second) second = v;
      }
      if (!top) return null;
      return topId === p.id ? [m.id, 100, Math.round((100 * second) / top)] : [m.id, Math.min(99, Math.round((100 * mine) / top)), 0];
    }
    return null;
  },

  // ---------- healer threat ----------
  // Spread amount × THREAT.heal across the enemies fighting the healer's or the patient's party.
  healThreat(by, tg, amount) {
    if (!by || !(amount > 0) || !this.players.has(by.id)) return;
    const grp = new Set([by.id, tg?.id]);
    for (const pid of [by.party, tg?.party]) for (const id of (pid && this.parties.get(pid)?.members) || []) grp.add(id);
    const foes = [];
    for (const m of this.mobs.values()) {
      if (m.dead || !m.threat.size) continue;
      if (![...m.threat.keys()].some(id => grp.has(id))) continue;
      if (!(m.def.f3 ? this.f3Valid(m, by) : m.def.f2 ? this.f2Valid(m, by) : this.validTarget(m, by))) continue; // out of its reach: no share
      foes.push(m);
    }
    if (!foes.length) return;
    const share = (amount * THREAT.heal) / foes.length;
    for (const m of foes) m.threat.set(by.id, (m.threat.get(by.id) || 0) + share);
  },

  // ---------- Cover ----------
  // The ally a Cover goes to: the asked one if in reach, else whoever an enemy is after (most hurt first), else the most hurt.
  coverPick(p, tid) {
    const ok = o => o && o !== p && !o.dead && !o.downed && !inTown(o.x, o.z) && dist(o, p) <= COVER.range;
    const want = tid && this.players.get(tid);
    if (ok(want)) return want;
    const targeted = new Set();
    for (const m of this.mobs.values()) if (!m.dead && m.threat.size) { const t = topThreat(this, m); if (t) targeted.add(t[0]); }
    let best = null, bs = Infinity;
    for (const o of this.players.values()) {
      if (!ok(o)) continue;
      const mate = p.party && o.party === p.party;
      const s = o.hp / o.maxHp - (targeted.has(o.id) ? 1 : 0) - (mate ? 0.5 : 0);
      if (s < bs) { bs = s; best = o; }
    }
    return best;
  },

  // The enemy most likely to hit o next: one whose top threat is o (nearest), else the nearest engaged one.
  coverThreatOf(o) {
    let best = null, bd = Infinity;
    for (const m of this.mobs.values()) {
      if (m.dead || m.hidden || !m.threat.size) continue;
      const d = dist(m, o) - (topThreat(this, m)?.[0] === o.id ? 1000 : 0);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  },

  cover(p, tid) {
    const t = this.time;
    if (!p || p.dead || p.downed || p.cls !== 'guardian' || t < (p.coverCd || 0)) return false;
    const ally = this.coverPick(p, tid | 0);
    if (!ally) { this.events.push({ t: 'cover', id: p.id, to: p.id, fail: 1 }); return false; }
    const foe = this.coverThreatOf(ally);
    // land just in front of the ally, toward the threat (or on our side of them)
    const fx = foe ? foe.x : p.x, fz = foe ? foe.z : p.z, dx = fx - ally.x, dz = fz - ally.z, dl = Math.hypot(dx, dz) || 1;
    const sx = ally.x + (dx / dl) * COVER.stand, sz = ally.z + (dz / dl) * COVER.stand;
    const x0 = p.x, z0 = p.z, steps = Math.max(1, Math.ceil(Math.hypot(sx - x0, sz - z0) / 0.5));
    let tx = x0, tz = z0;
    for (let i = 1; i <= steps; i++) { // dash along the line, stopping at walls / closed gates (like Rush)
      const nx = x0 + ((sx - x0) * i) / steps, nz = z0 + ((sz - z0) * i) / steps;
      if (!this.walk(nx, nz)) break;
      [tx, tz] = resolveCollision(nx, nz);
    }
    p.coverCd = t + COVER.cd;
    ally.cover = { by: p.id, until: t + COVER.window };
    p.face = Math.atan2(fx - tx, fz - tz);
    this.events.push({ t: 'cover', id: p.id, w: ally.id, x: r2(x0), z: r2(z0), x2: r2(tx), z2: r2(tz), d: COVER.window });
    if (tx !== x0 || tz !== z0) this.teleport(p, tx, tz);
    p.lastCombat = t;
    return true;
  },

  // ---------- flanking ----------
  // Damage multiplier for p hitting m now (and the Pincer partner, if any). Tags the players (throttled).
  flankMult(m, p) {
    if (!m.def || !inFlankReach(m, p) || m.dead) return 1;
    let partner = null;
    const party = p.party && this.parties.get(p.party);
    if (party) for (const id of party.members) {
      const o = id !== p.id && this.players.get(id);
      if (o && !o.dead && !o.downed && inFlankReach(m, o) && apartAround(m, p, o) >= FLANK.apart) { partner = o; break; }
    }
    const t = this.time;
    if (partner) {
      for (const [a, b] of [[p, partner], [partner, p]]) {
        if (t - (a.pincerT ?? -99) < FLANK.tagEvery) continue;
        a.pincerT = t;
        this.events.push({ t: 'flank', k: 'pincer', id: m.id, by: a.id, w: b.id, to: a.id });
        this.teamStat?.(a, 'flank');
      }
      p._flankPost = FLANK.posture.pincer;
      return FLANK.dmg.pincer;
    }
    if (!fromBehind(m, p.x, p.z)) return 1;
    if (t - (p.flankT ?? -99) >= FLANK.backTagEvery) { p.flankT = t; this.events.push({ t: 'flank', k: 'back', id: m.id, by: p.id, to: p.id }); }
    p._flankPost = FLANK.posture.back;
    return FLANK.dmg.back;
  },
};

export function installThreat(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // Flanking: more damage (and posture) from behind or in a Pincer.
  wrap('damageMob', function (orig, m, p, base, opts) {
    if (!p || !this.targetable(m) || !this.players.has(p.id)) return orig.call(this, m, p, base, opts);
    const mult = this.flankMult(m, p);
    try { return orig.call(this, m, p, base * mult, opts); } finally { p._flankPost = 0; }
  });
  wrap('addPosture', function (orig, m, p, amount, opts) {
    return orig.call(this, m, p, p?._flankPost ? amount * p._flankPost : amount, opts);
  });

  // Healer threat, healing stats and the "save" bookkeeping.
  wrap('healPlayer', function (orig, tg, amount, by, sk) {
    const got = orig.call(this, tg, amount, by, sk);
    if (got > 0 && by?.id) {
      this.healThreat(by, tg, got);
      tg.lastHeal = { by: by.id, a: got, at: this.time };
      this.teamStat?.(by, 'heal', got);
    }
    return got;
  });
  wrap('absorbHit', function (orig, p, amount) {
    const s = p.shield, by = s && this.time < s.until && s.hp > 0 ? s.by : 0, hp = p.hp;
    const left = orig.call(this, p, amount), soaked = amount - left, h = by && this.players.get(by);
    if (soaked > 0 && h) {
      this.healThreat(h, p, soaked);
      if (amount >= hp && left < hp && h.id !== p.id) this.teamStat?.(h, 'save');
    }
    return left;
  });

  // Cover redirects the hit; then "tanked" (damage taken while top threat) and heal saves.
  wrap('damagePlayer', function (orig, p, base, opts = {}) {
    const t = this.time, c = p.cover;
    if (c && !opts.peril && !opts.covered && t < c.until && !p.dead && !inTown(p.x, p.z)) {
      const g = this.players.get(c.by);
      const dodged = t < p.iframeUntil || (opts.ground && t >= p.airFrom && t < p.airUntil);
      if (g && g !== p && !g.dead && !g.downed && dist(g, p) <= COVER.leash && !dodged) {
        p.cover = null;
        this.events.push({ t: 'covered', id: g.id, w: p.id, x: r2(g.x), z: r2(g.z) });
        this.teamStat?.(g, 'cover');
        if (base >= p.hp) this.teamStat?.(g, 'save');
        return this.damagePlayer(g, g.guarding ? base : base * (1 - GUARD.dr), { ...opts, covered: true }); // braced like a guard
      }
    }
    if (c && t >= c.until) p.cover = null;
    const before = p.hp;
    const out = orig.call(this, p, base, opts);
    const lost = before - Math.max(0, p.hp);
    if (lost > 0 && this.teamStat) {
      const a = this.attackerOf(p, opts.src, opts.mob);
      if (a && topThreat(this, a)?.[0] === p.id) this.teamStat(p, 'tanked', lost);
      const h = p.lastHeal;
      if (h && t - h.at <= THREAT.saveWin && h.by !== p.id && !p.dead && !p.downed && p.hp > 0 && lost >= before - h.a) {
        p.lastHeal = null;
        const by = this.players.get(h.by);
        if (by) this.teamStat(by, 'save');
      }
    }
    return out;
  });

  // Per-player HUD data: my threat meter, Cover cooldown.
  wrap('meFor', function (orig, p) {
    const me = orig.call(this, p);
    const th = this.threatMe(p);
    if (th) me.th = th;
    if (p.cls === 'guardian') me.cov = Math.max(0, r2((p.coverCd || 0) - this.time));
    return me;
  });
}
