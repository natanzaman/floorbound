// Team combat (docs/ROADMAP.md G2), mixed into Game by installTeamplay (end of game.js, after the talents):
//  - Skill combos between players: a setup (Lancer launch, Guardian stun, Ranger Mark) on a target, then a payoff by a
//    DIFFERENT player within COMBO.window s; plus Shatter Chorus (a Break on a Bard's 3+ Discord stacks) and
//    Sanctified Switch (a Switch under a Cleric's Sanctuary / Blessing). Each target keeps a chain counter.
//  - Team Burst: a shared gauge per party (solo players have their own), filled by team stats (combos, Switches,
//    Breaks, parries, revives, saves...), drained out of combat. Full: any member presses T to open a sync window;
//    everyone who presses T joins; the finisher scales with the joiners.
//  - teamStat(p, key, n): per-fight counters for the post-fight card (G5): this.fight.team / this.fight2.team,
//    Map(player id -> { key: n }). Keys: docs/ROADMAP.md "Shared contracts for G".
// Tables: shared/teamplay.js. Events (all in this.events): 'tsetup' { id, k, by, d } a setup opened on a target;
// 'combo' { id, k, n, by, from, x, z } (n: the target's chain); 'tbsync' { key, by, d, ids } a sync window opened;
// 'tbjoin' { key, id, n }; 'tburst' { key, by, ids, n, m, x, z } the finisher fired. Snapshot: w.tb (teamSnap).
// Hooks wrapped here (the original always runs): damageMob, breakMob, markA, healPlayer, guardHit, evadeHit,
// damagePlayer, killMob, update, handle ('burst' messages), meFor is untouched.
import { inArena } from '../shared/data.js';
import { inArena2 } from '../shared/floor2.js';
import { COMBO, COMBOS, BURST, hitInfo, setupsOf, payoffFor, comboReady, nextChain, burstPower, burstBuff, burstFillScale } from '../shared/teamplay.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

const methods = {
  // ---------- team stats (G5 reads them) ----------
  // The boss fight p is part of (the Warden's or the Sovereign's), or null.
  teamFightOf(p) {
    if (this.fight && (this.fight.ids.has(p.id) || inArena(p.x, p.z))) return this.fight;
    if (this.fight2 && (this.fight2.ids.has(p.id) || inArena2(p.x, p.z))) return this.fight2;
    return null;
  },
  teamStat(p, key, n = 1) {
    if (!p || !key || !(n > 0)) return;
    const f = this.teamFightOf(p);
    if (f) {
      const team = (f.team ||= new Map()), row = team.get(p.id) || {};
      row[key] = (row[key] || 0) + n;
      team.set(p.id, row);
    }
    const fill = BURST.fill[key];
    if (fill) this.fillBurst(p, fill * n);
  },
  // The per-fight rows as a plain object { id: { name, cls, ...counts } } (G5, tests).
  teamStats(f = this.fight) {
    const out = {};
    for (const [id, row] of f?.team || []) { const p = this.players.get(id); out[id] = { name: p?.name, cls: p?.cls, ...row }; }
    return out;
  },

  // ---------- combos ----------
  // Note a setup on m (hit by p). Only events for a new or refreshed (>0.5 s) setup.
  noteSetup(m, p, k) {
    const t = this.time, s = (m.tbSet ||= {}), old = s[k];
    s[k] = { by: p.id, at: t, cls: p.cls };
    if (!old || old.by !== p.id || t - old.at > 0.5) this.events.push({ t: 'tsetup', id: m.id, k, by: p.id, d: COMBO.window });
  },
  // A combo landed on m: chain counter, event, stats. by: the payer, from: the setter.
  landCombo(m, by, from, id, extra = {}) {
    const t = this.time;
    m.tbChain = nextChain(m.tbChain, t);
    (m.tbLast ||= {})[id] = t;
    this.events.push({ t: 'combo', id: m.id, k: id, n: m.tbChain.n, by: by.id, from: from?.id || 0, x: r2(m.x), z: r2(m.z), ...extra });
    this.teamStat(by, 'combo');
    if (from && from !== by) this.teamStat(from, 'setup');
  },
  // Payoff effects after the hit (posture chunk, root).
  comboAfter(m, p, c) {
    if (m.dead || !this.mobs.has(m.id)) return;
    const t = this.time;
    if (c.root) {
      if (m.def.boss) this.slowMob?.(m, 1, c.root); // a boss is slowed (bosses shrug off half), never rooted
      else { m.stunUntil = Math.max(m.stunUntil || 0, t + c.root); m.windupAt = 0; m.rootA = t + c.root; }
    }
    if (c.frac) this.addPosture(m, p, 0, { frac: c.frac });
  },
  // Sanctified Switch: p Switched standing in a Cleric's Sanctuary (owner not p) or under their Blessing.
  sanctifiedBy(p) {
    const t = this.time;
    for (const z of this.zones) if (z.sk === 'sanct' && z.owner !== p.id && t < z.until && Math.hypot(p.x - z.x, p.z - z.z) <= z.r) return this.players.get(z.owner) || null;
    const d = p.dmg, s = p.shield;
    if (d && t < d.until && d.sk === 'bless' && d.by && d.by !== p.id) return this.players.get(d.by) || null;
    if (s && t < s.until && s.sk === 'bless' && s.by && s.by !== p.id) return this.players.get(s.by) || null;
    return null;
  },

  // ---------- Team Burst ----------
  teamKey(p) { return p.party || p.id; }, // party and player ids come from one counter: never equal
  teamOf(key) {
    const party = this.parties.get(key);
    if (party) return party.members.map(id => this.players.get(id)).filter(Boolean);
    const p = this.players.get(key);
    return p ? [p] : [];
  },
  tbState(key) { let s = (this.tb ||= new Map()).get(key); if (!s) this.tb.set(key, s = { g: 0, sync: 0, ids: [], by: 0 }); return s; },
  showRunning() { return !!this.director?.running; }, // a filmed show: no Team Burst (docs/ROADMAP.md G film safety)
  fillBurst(p, v) {
    if (this.showRunning()) return;
    const key = this.teamKey(p), s = this.tbState(key);
    if (s.sync) return; // a window is open: it doesn't fill until the finisher fires
    s.g = Math.min(BURST.max, s.g + v * (p.party ? burstFillScale(this.teamOf(key).length) : BURST.soloFill));
  },
  // T pressed (a 'burst' message { m }: the presser's target, a hint): open a sync window (full gauge), or join the open one.
  teamBurst(p, mid = 0) {
    if (!p || p.dead || this.showRunning()) return false;
    const key = this.teamKey(p), s = this.tbState(key), t = this.time;
    const hint = this.mobs.get(mid | 0);
    if (hint && this.targetable(hint) && dist(hint, p) <= BURST.range && !s.tgt) s.tgt = hint.id;
    if (s.sync && t < s.sync) {
      if (s.ids.includes(p.id)) return false;
      s.ids.push(p.id);
      this.events.push({ t: 'tbjoin', key, id: p.id, n: s.ids.length });
      if (this.allJoined(key, s)) this.fireBurst(key, s);
      return true;
    }
    if (s.g < BURST.max - 1e-6) return false;
    const team = this.teamOf(key);
    if (!this.burstTarget(p, team.map(o => o.id), hint && this.targetable(hint) && dist(hint, p) <= BURST.range ? hint.id : 0)) {
      if (t - (p.tbNoTgt || -9) > 3) { p.tbNoTgt = t; this.sys('Team Burst: no enemy in reach.', p.id); }
      return false; // kept for a fight
    }
    s.by = p.id; s.ids = [p.id]; s.tgt = hint && this.targetable(hint) && dist(hint, p) <= BURST.range ? hint.id : 0;
    if (team.length <= 1) { this.fireBurst(key, s); return true; } // solo: no window
    s.sync = t + BURST.sync;
    this.events.push({ t: 'tbsync', key, by: p.id, d: BURST.sync, ids: team.map(o => o.id) });
    if (this.allJoined(key, s)) this.fireBurst(key, s);
    return true;
  },
  // Every living team member near the starter has joined.
  allJoined(key, s) {
    const st = this.players.get(s.by);
    return this.teamOf(key).every(o => o.dead || s.ids.includes(o.id) || (st && dist(o, st) > BURST.range));
  },
  // What the finisher hits: the target the starter (else a joiner) pressed T on, the starter's locked target, the boss
  // the team is fighting, else the nearest enemy the team is fighting near the starter.
  burstTarget(p, ids, hint = 0) {
    const h = hint && this.mobs.get(hint);
    if (h && this.targetable(h)) return h;
    const lock = p.target && this.mobs.get(p.target);
    if (lock && this.targetable(lock) && dist(lock, p) <= BURST.range) return lock;
    for (const b of [this.boss, this.sovereign]) { // a boss any joiner is fighting (or close to the starter)
      if (b && this.targetable(b) && b.threat.size && (ids.some(id => b.threat.has(id)) || dist(b, p) <= BURST.targetR * 2)) return b;
    }
    let best = null, bd = BURST.targetR;
    for (const m of this.mobs.values()) {
      if (!this.targetable(m)) continue;
      const d = dist(m, p) - m.def.radius;
      if (d < bd && ids.some(id => m.threat.has(id))) { bd = d; best = m; }
    }
    return best;
  },
  fireBurst(key, s) {
    const t = this.time, ids = s.ids.filter(id => this.players.get(id) && !this.players.get(id).dead);
    const starter = this.players.get(s.by) || this.players.get(ids[0]), hint = s.tgt;
    s.sync = 0; s.g = 0; s.ids = []; s.tgt = 0;
    if (!starter || !ids.length) return;
    const n = ids.length, joiners = ids.map(id => this.players.get(id)), m = this.burstTarget(starter, ids, hint), pow = burstPower(n);
    this.events.push({ t: 'tburst', key, by: starter.id, ids, n, m: m?.id || 0, x: r2(m?.x ?? starter.x), z: r2(m?.z ?? starter.z) });
    for (const o of joiners) this.teamStat(o, 'burst');
    if (m) {
      this._tbIn = true;
      try {
        for (const o of joiners) { // each joiner's share: their attack x power (Switch / Mark bonuses apply as usual)
          if (!this.targetable(m)) break;
          this.damageMob(m, o, o.atk * this.dmgMult(o) * BURST.per * pow, { heavy: true, threat: 0.5 });
        }
      } finally { this._tbIn = false; }
      if (this.targetable(m) && t >= (m.staggerUntil || 0)) {
        this._tbIn = true;
        try {
          if (n >= 2) { m.posture = 0; this.breakMob(m, starter); } // a full posture break: a Switch window for everyone
          else this.addPosture(m, starter, 0, { frac: BURST.soloFrac });
        } finally { this._tbIn = false; }
      }
    }
    const v = burstBuff(n);
    for (const o of this.teamOf(key)) { // the team (near the starter): a short damage buff
      if (o.dead || dist(o, starter) > BURST.buffR) continue;
      this.teamBuff?.(o, v, BURST.buffD);
      this.events.push({ t: 'buff', id: o.id, k: 'tburst', d: BURST.buffD });
    }
  },
  // Per tick: windows that ran out fire with whoever joined; idle teams drain.
  updateTeamplay(dt) {
    if (!this.tb?.size) return;
    const t = this.time;
    for (const [key, s] of this.tb) {
      const team = this.teamOf(key);
      if (!team.length) { this.tb.delete(key); continue; }
      if (s.sync && t >= s.sync) this.fireBurst(key, s);
      if (s.sync || s.g <= 0) continue;
      if (!team.some(o => t - (o.lastCombat ?? -99) < BURST.idle)) s.g = Math.max(0, s.g - BURST.drain * dt);
    }
    for (const [key, s] of this.tb) if (s.g <= 0 && !s.sync) this.tb.delete(key);
  },
  // Snapshot: [[key, gauge 0-100, sync s left (0 = closed), joined ids]] for teams with something to show.
  teamSnap() {
    if (!this.tb?.size) return undefined;
    const t = this.time, out = [];
    for (const [key, s] of this.tb) out.push([key, Math.round(s.g), s.sync ? r1(Math.max(0, s.sync - t)) : 0, s.sync ? s.ids : []]);
    return out;
  },
};

export function installTeamplay(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // Combos (setups and payoffs), damage and Switch stats.
  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    if (!p?.cls || !this.targetable(m)) return orig.call(this, m, p, base, opts);
    if (this._tbIn) { // a combo's or the Team Burst's own damage: counted, never a setup or payoff
      const ev0 = this.events.length, out = orig.call(this, m, p, base, opts);
      const hit = this.events.slice(ev0).find(e => e.t === 'hit' && e.id === m.id && e.by === p.id);
      if (hit) this.teamStat(p, 'dmg', hit.a);
      return out;
    }
    const t = this.time, mk = m.markA;
    const h = hitInfo(p.cls, opts.sk || opts.tsk || p._tsk, { heavy: opts.heavy, stun: opts.stun, ownMark: !!mk && mk.by === p.id && t < mk.until });
    const pay = payoffFor(m.tbSet, h, p.id, t, m.tbLast), c = pay?.def;
    let crit = null;
    if (c?.crit) { crit = p.crit; p.crit = 1; }
    const ev0 = this.events.length;
    let out;
    try { out = orig.call(this, m, p, base * (c?.mult || 1), opts); } finally { if (crit !== null) p.crit = crit; }
    const hit = this.events.slice(ev0).find(e => e.t === 'hit' && e.id === m.id && e.by === p.id);
    if (!hit) return out;
    this.teamStat(p, 'dmg', hit.a);
    if (pay) {
      delete m.tbSet[c.setup]; // spent
      this.landCombo(m, p, this.players.get(pay.setup.by), pay.id);
      this.comboAfter(m, p, c);
    }
    if (hit.sw) {
      this.teamStat(p, 'switch');
      const cl = !m.dead && comboReady(m.tbLast, 'sanctified', t) && this.sanctifiedBy(p), S = COMBOS.sanctified;
      if (cl && t < m.staggerUntil) {
        m.staggerUntil += S.extend; m.stunUntil = Math.max(m.stunUntil || 0, m.staggerUntil);
        this.landCombo(m, p, cl, 'sanctified', { ext: S.extend });
      }
    }
    if (!m.dead && this.mobs.has(m.id)) for (const k of setupsOf(h)) this.noteSetup(m, p, k);
    return out;
  });

  // Breaks: stats, and Shatter Chorus (a Bard's 3+ Discord stacks Broken by someone else).
  wrap('breakMob', function (orig, m, p, interrupt, sk) {
    const C = COMBOS.chorus, n = this.discordOf?.(m) || 0, bard = n >= C.discord ? this.players.get(m.discord?.by) : null;
    const out = orig.call(this, m, p, interrupt, sk);
    if (!p?.cls || this._tbIn) return out; // (the Team Burst's own Break counts as the burst)
    this.teamStat(p, 'break');
    if (bard && bard !== p && !bard.dead && comboReady(m.tbLast, 'chorus', this.time)) {
      this.landCombo(m, p, bard, 'chorus');
      for (const o of this.players.values()) {
        const mate = o === p || o === bard || (!!p.party && o.party === p.party); // the breaker's party (and the two)
        if (o.dead || !mate) continue;
        if (dist(o, m) <= C.healR + m.def.radius) this.healPlayer(o, o.maxHp * C.heal, bard, null);
      }
      if (this.targetable(m)) {
        this._tbIn = true;
        try { this.damageMob(m, bard, bard.atk * this.dmgMult(bard) * C.burst, { threat: 0.8 }); } finally { this._tbIn = false; }
      }
    }
    return out;
  });

  // Hunter's Mark opens a Pin.
  wrap('markA', function (orig, p, m, ...rest) {
    const out = orig.call(this, p, m, ...rest);
    if (p && m && !m.dead) this.noteSetup(m, p, 'mark');
    return out;
  });

  // Healing done (overheal doesn't count).
  wrap('healPlayer', function (orig, tg, amount, by, sk) {
    const got = orig.call(this, tg, amount, by, sk);
    if (by?.cls && got > 0) this.teamStat(by, 'heal', got);
    return got;
  });

  // Parries and perfect dodges fill the gauge a little.
  wrap('guardHit', function (orig, p, ...rest) {
    const r = orig.call(this, p, ...rest);
    if (r === 'parry') this.teamStat(p, 'parry');
    return r;
  });
  wrap('evadeHit', function (orig, p, ...rest) {
    const n = p.perfects || 0;
    const out = orig.call(this, p, ...rest);
    if ((p.perfects || 0) > n) this.teamStat(p, 'perfect');
    return out;
  });

  // Damage taken while the attacker's top threat ("tanked").
  wrap('damagePlayer', function (orig, p, base, opts = {}) {
    const hp = p.hp;
    const out = orig.call(this, p, base, opts);
    const lost = hp - Math.max(0, p.hp);
    if (lost > 0) {
      const a = this.attackerOf(p, opts.src, opts.mob);
      if (a?.threat?.size) {
        let top = null, tv = -1;
        for (const [id, v] of a.threat) if (v > tv) { tv = v; top = id; }
        if (top === p.id) this.teamStat(p, 'tanked', lost);
      }
    }
    return out;
  });

  // Last Attack on a boss (before killMob ends the fight record).
  wrap('killMob', function (orig, m, killer) {
    if (m?.def?.boss && killer?.cls && !this.lastAttackHeld?.(m, killer)) this.teamStat(killer, 'lastAttack');
    return orig.call(this, m, killer);
  });

  wrap('update', function (orig, dt) { const out = orig.call(this, dt); this.updateTeamplay(dt); return out; });
  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'burst') return this.teamBurst(p, msg.m);
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.tb > 0 && p) this.tbState(this.teamKey(p)).g = Math.min(BURST.max, +msg.tb); // testing aid: { tb } sets your team's gauge
    return orig.call(this, p, msg);
  });
}

