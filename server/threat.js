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
import { GUARD, CLASSES, inTown, resolveCollision } from '../shared/data.js';
import { THREAT, COVER, FLANK, TAUNT, CLEAN, cleanMult, fromBehind, apartAround, inFlankReach } from '../shared/threat.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const shown = m => m && !m.dead && !m.hidden && (m.def.boss || m.def.elite);

// [id, value] of who m is after (targetOf), or null.
export function topThreat(g, m) {
  const p = g.targetOf(m);
  return p ? [p.id, m.threat.get(p.id) || 0] : null;
}
const free = p => p && !p.dead && !p.downed && !p.trap; // can be picked as a target
const fighter = (g, m) => [...m.threat.keys()].map(id => g.players.get(id)).filter(p => p && !p.dead);
const STATS = !!process.env.THREAT_STATS; // bot runs: log each lock's end (test/wardenskill.js, test/floor3boss.js)

const methods = {
  // ---------- the target picker (J4) ----------
  // The only place targets are chosen: the taunt-lock holder, otherwise the top threat among living, non-downed,
  // non-trapped players (a tie goes to the current target). If nobody free is left, the top of the rest (still alive),
  // so a party that is all downed / trapped isn't read as a wipe.
  targetOf(m) {
    if (!m?.threat?.size) { if (m) m.tgtId = 0; return null; }
    const lk = this.lockOf(m);
    if (lk) { m.tgtId = lk.by; return this.players.get(lk.by); }
    let best = null, top = -1, any = null, atop = -1;
    for (const [pid, v] of m.threat) {
      const p = this.players.get(pid);
      if (!p || p.dead) continue;
      const better = (x) => v > x || (v === x && pid === m.tgtId);
      if (free(p)) { if (better(top)) { top = v; best = p; } } else if (better(atop)) { atop = v; any = p; }
    }
    const t = best || any;
    m.tgtId = t ? t.id : 0;
    return t;
  },

  // m's taunt lock while it holds, else null. Ends it here: on time (handover: the taunter drops to TAUNT.handover × L),
  // or early (no handover) if the taunter is dead, downed, trapped or out of the room (their entry was dropped).
  lockOf(m) {
    const lk = m.lock;
    if (!lk) return null;
    const p = this.players.get(lk.by);
    if (!free(p) || !m.threat.has(lk.by)) { m.lock = null; return null; }
    if (this.time < lk.until) return lk;
    m.lock = null;
    m.threat.set(lk.by, TAUNT.handover * lk.L);
    m.tgtId = lk.by; // a tie at the handover goes to the taunter
    if (STATS && m.def.boss) {
      const others = fighter(this, m).filter(o => o.id !== lk.by).map(o => `${o.cls}:${Math.round((100 * m.threat.get(o.id)) / lk.L)}`);
      console.log(`[threat] lockend ${m.type} by ${p.cls} L ${Math.round(lk.L)} ${others.join(' ')}`);
    }
    return null;
  },

  // Add threat to p's entry on m. kind 'dmg': × the clean multiplier on bosses and elites; 'heal': as is.
  // A lock holder's entry stays frozen at L. Gains (before the clean multiplier) are kept for TAUNT.window s (a taunt's
  // R: the taunt resets everyone's multiplier, so R is the pace they rebuild from).
  addThreat(m, p, amount, kind = 'dmg') {
    if (!m || !p || !(amount > 0)) return;
    const big = m.def.boss || m.def.elite, base = amount;
    if (kind === 'dmg' && big) amount *= this.cleanHit(p);
    if (m.lock && m.lock.by === p.id && this.time < m.lock.until) return;
    m.threat.set(p.id, (m.threat.get(p.id) || 0) + amount);
    if (!big) return;
    const log = (m.thLog ||= []), t = this.time;
    log.push([t, p.id, base]);
    while (log.length && t - log[0][0] > TAUNT.window) log.shift();
  },

  // ---------- clean-damage multiplier ----------
  cleanOf(p) { return (p.clean ||= { s: 0, at: this.time, hit: -1e9 }); },
  // Clean seconds as of now (they only run while p damaged a boss / elite in the last CLEAN.recent s).
  cleanSecs(p) { const c = this.cleanOf(p); return c.s + Math.max(0, Math.min(this.time, c.hit + CLEAN.recent) - c.at); },
  cleanMul(p) { return p?.clean ? cleanMult(this.cleanSecs(p)) : 1; },
  // p damaged a boss / elite now: bank the clean time, mark the hit, return the multiplier for it.
  cleanHit(p) { const c = this.cleanOf(p); c.s = this.cleanSecs(p); c.at = this.time; c.hit = this.time; return cleanMult(c.s); },
  cleanReset(p) { if (p?.clean) { p.clean.s = 0; p.clean.at = this.time; } },

  // ---------- taunts ----------
  // How long kind's lock lasts for p: TAUNT.lock × Provoke's duration bonus, never more than the cooldown − TAUNT.cdGap.
  lockSecs(p, kind) {
    let secs = (TAUNT.lock[kind] ?? TAUNT.lock.taunt) * (1 + (p.tal?.sk?.taunt?.dur || 0) / 100);
    const sk = CLASSES[p.cls]?.skills.find(s => s.id === 'taunt'), slot = sk ? CLASSES[p.cls].skills.indexOf(sk) : -1;
    if (sk) secs = Math.min(secs, this.skillCd(p, sk, slot) - TAUNT.cdGap);
    return Math.max(0.5, secs);
  },
  // R: the best non-taunter threat/s (before clean multipliers) over the last TAUNT.window s, at least TAUNT.atkMul × the highest fighter's attack.
  tauntRate(m, by) {
    const t = this.time, sum = new Map();
    for (const [at, id, a] of m.thLog || []) if (id !== by.id && t - at <= TAUNT.window) sum.set(id, (sum.get(id) || 0) + a);
    const best = Math.max(0, ...sum.values()) / TAUNT.window;
    const atk = Math.max(by.atk || 0, ...fighter(this, m).map(o => o.atk || 0));
    return Math.max(best, TAUNT.atkMul * atk);
  },
  // T taunts m (Taunt, War Cry, Challenge): renormalise to L, T = L, others cut to TAUNT.cut × L, locked on T.
  tauntMob(m, T, kind = 'taunt') {
    if (!m || !T || m.def.prop) return; // trap objects (J1) can't be taunted
    const L = TAUNT.Lmul * this.tauntRate(m, T);
    let top = 0; for (const v of m.threat.values()) top = Math.max(top, v);
    const k = L / Math.max(top, 1);
    for (const [pid, v] of m.threat) { m.threat.set(pid, Math.min(v * k, TAUNT.cut * L)); this.cleanReset(this.players.get(pid)); }
    m.threat.set(T.id, L);
    this.cleanReset(T);
    m.lock = { by: T.id, L, until: this.time + this.lockSecs(T, kind) };
    m.tgtId = T.id;
  },
  // Phalanx: p goes to the top (no lock, no cuts).
  threatToTop(m, p) {
    let top = 0; for (const [pid, v] of m.threat) if (pid !== p.id) top = Math.max(top, v);
    if ((m.threat.get(p.id) || 0) <= top) m.threat.set(p.id, top + 1);
  },

  // ---------- visible threat ----------
  // (talents.js topThreat(m) -> id; threatTop(m) -> [id, value]: both go through targetOf)
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

  // My meter against the boss I'm fighting: [bossId, pct, nextPct, mult×10, lockSecs, lockById].
  //   No lock: pct = my % of the top (99 at most unless I'm it); when I'm the top, nextPct = the runner-up as % of mine.
  //   During a lock: pct = v / L (up to TAUNT.meterMax); the holder gets 100 and nextPct = the runner-up's v / L.
  threatMe(p) {
    for (const m of this.mobs.values()) {
      if (!m.def.boss || m.dead || !m.threat.has(p.id)) continue;
      const tg = this.targetOf(m), lk = m.lock;
      if (!tg) return null;
      const mine = m.threat.get(p.id) || 0, mul = Math.round(this.cleanMul(p) * 10);
      let second = 0;
      for (const [pid, v] of m.threat) { const o = this.players.get(pid); if (pid !== tg.id && o && !o.dead && v > second) second = v; }
      if (lk) {
        const secs = Math.max(1, Math.ceil(lk.until - this.time));
        return tg.id === p.id ? [m.id, 100, Math.round((100 * second) / lk.L), mul, secs, lk.by]
          : [m.id, Math.min(TAUNT.meterMax, Math.round((100 * mine) / lk.L)), 0, mul, secs, lk.by];
      }
      const top = m.threat.get(tg.id) || 0;
      if (!top) return null;
      return tg.id === p.id ? [m.id, 100, Math.round((100 * second) / top), mul, 0, 0] : [m.id, Math.min(99, Math.round((100 * mine) / top)), 0, mul, 0, 0];
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
    for (const m of foes) this.addThreat(m, by, share, 'heal');
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
    const before = p.hp, sh = s => (s && t < s.until ? s.hp : 0), sh0 = sh(p.shield);
    const out = orig.call(this, p, base, opts);
    const lost = before - Math.max(0, p.hp);
    if (lost > 0 || sh(p.shield) < sh0 || p.downed) this.cleanReset(p); // any HP or shield loss (evaded / parried / Covered: none)
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

  // The clean multiplier resets at the end of a fight (boss: endFight / 2 / 3; an elite: when it dies), and locks go.
  for (const [end, field] of [['endFight', 'fight'], ['endFight2', 'fight2'], ['endFight3', 'fight3']]) {
    if (!P[end]) continue;
    wrap(end, function (orig, result, m, ...a) {
      for (const id of this[field]?.ids || []) this.cleanReset(this.players.get(id));
      if (m) m.lock = null;
      return orig.call(this, result, m, ...a);
    });
  }
  wrap('killMob', function (orig, m, killer) {
    const out = orig.call(this, m, killer);
    if (m.dead || m.hp <= 0) {
      if (m.def.boss || m.def.elite) for (const id of m.threat.keys()) this.cleanReset(this.players.get(id));
      m.lock = null; m.thLog = null;
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
