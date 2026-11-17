// Combat core, mixed into Game (see installCombat at the bottom of game.js):
//  - Posture: every hit fills an enemy's break meter; full = BROKEN (stagger + Switch window), then it resets.
//  - Perfect dodge: a roll that starts just before a hit lands -> slow-mo, posture damage to the attacker, a counter window.
//  - Guardian guard (hold R): frontal hits take much less damage; pressing just before a hit PARRIES it.
//  - The Warden's perilous Horn Sweep: dodge through it or parry it; shields don't help.
//  - The Warden's Quake Ring: shockwave rings rolling out along the floor; jump over the wavefront or roll through it.
import { DODGE, SWITCH, POSTURE, PERFECT, GUARD, SWEEP, WARDEN, postureMax, angleTo, wrapAngle, inArena } from '../shared/data.js';
import { MASTERY } from '../shared/mastery.js';

const QSTATS = !!process.env.QUAKE_STATS; // test/wardenskill.js: count Quake Ring hits / evades

// A boss's big hits (damagePlayer `src`): landing one tags the `hurt` event `big`, and only the victim's client
// does a short hit-stop and camera shake (docs/ROADMAP.md A3). Twist echoes ("warden slam echo") count as the original.
export const BIG_HITS = new Set(['warden slam', 'warden charge', 'warden sweep', 'warden quake', 'rockfall',
  'sovereign trident', 'sovereign geyser', 'tidal wave']);
// Who sees what (docs/ROADMAP.md A2): reactions a player performs (Jumped!, Dodged!, PERFECT, PARRY!, COUNTER, self procs)
// carry `to: <their id>` and only that player's client shows the text; effects on a target (BROKEN, MARKED, Discord) carry no `to`.
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;

const methods = {
  // ---------- posture ----------
  postureCap(m) { return postureMax(m.def, m.maxHp); },
  bigHit(src = '') { return BIG_HITS.has(String(src).replace(/ echo$/, '')); },
  posturePct(m) { return Math.min(100, Math.round((100 * (m.posture || 0)) / this.postureCap(m))) || 0; },

  // Add posture damage from player p. amount = damage dealt; the flags add big chunks.
  // sk: the skill credited with mastery (posture dealt, Breaks); frac: an extra chunk [normal/elite, boss] (evolved skills).
  addPosture(m, p, amount, { heavy = false, brk = false, interrupt = false, counter = false, chunk = null, sk = null, frac = null } = {}) {
    if (!m || m.dead) return;
    const t = this.time;
    if (counter) this.events.push({ t: 'counter', id: m.id, by: p.id, to: p.id });
    if (interrupt && !m.def.boss) m.windupAt = 0; // a Smite mid wind-up still interrupts small enemies
    if (t < m.staggerUntil) return; // frozen while broken
    const max = this.postureCap(m), bi = m.def.boss ? 1 : 0;
    let gain = amount * (heavy ? POSTURE.heavy : 1);
    if (brk) gain += max * POSTURE.brk[bi];
    if (interrupt) gain += max * POSTURE.smite[bi];
    if (chunk) gain += max * POSTURE[chunk][bi];
    if (frac) gain += max * frac[bi];
    gain *= this.postureMul?.(p, m) ?? 1; // talents: posture damage, Juggernaut (server/talents.js)
    if (counter) gain *= PERFECT.posture;
    if (sk) this.masteryGain?.(p, sk, Math.min(gain, max - (m.posture || 0)), 'posture');
    m.posture = (m.posture || 0) + gain;
    m.postureAt = t;
    if (m.posture >= max) this.breakMob(m, p, interrupt, sk);
  },

  // Posture full: BROKEN. Staggered for the Switch window, wind-ups (and a pending Horn Sweep) are cancelled.
  breakMob(m, p, interrupt = false, sk = null) {
    const t = this.time, dur = (m.def.boss ? SWITCH.bossWindow : SWITCH.window) + (this.styleBreakBonus?.(p, m) || 0); // Mace: longer
    m.staggerUntil = t + dur; m.staggerBy = p.id; m.switched = false;
    m.staggerSk = sk; // the skill that broke it gets mastery when a teammate Switches in
    if (sk) this.masteryGain?.(p, sk, MASTERY.brk[m.def.boss ? 1 : 0]);
    m.stunUntil = Math.max(m.stunUntil, t + dur);
    m.windupAt = 0;
    m.posture = 0;
    if (m.sweepPending) { m.sweepPending = false; m.perilTok = (m.perilTok || 0) + 1; this.events.push({ t: 'pcancel', id: m.id }); }
    this.events.push({ t: 'stagger', id: m.id, by: p.id, d: dur, i: interrupt ? 1 : 0 });
    this.twistAfterHit?.(m); // Warden twists (main): Ironhide lengthens Broken windows; idempotent per break
  },

  // Perfect-dodge counter: the next hit (every target struck at that same instant) does +50% damage and double posture.
  counterHit(p) {
    const t = this.time;
    if (t < (p.counterUntil || 0)) { p.counterUntil = 0; p.counterAt = t; return true; }
    return p.counterAt === t;
  },

  // ---------- who hit me? ----------
  // damagePlayer callers pass a `src` string; work out the attacking mob from it (or take `mob` if given).
  attackerOf(p, src = '', mob = null) {
    if (mob) return mob;
    if (/^(warden|rockfall)/.test(src)) return this.boss && !this.boss.dead ? this.boss : null;
    const type = String(src).split(' ')[0];
    let best = null, bd = 30;
    for (const m of this.mobs.values()) {
      if (m.dead || m.hidden) continue; // a burrowed lurker can't be countered
      const match = m.type === type || (type === 'spitter' && m.def.ranged);
      if (!match && !m.threat.has(p.id)) continue;
      const d = dist(m, p) + (match ? 0 : 20);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  },

  // ---------- perfect dodge ----------
  // Called from damagePlayer when a hit is avoided by dodge i-frames.
  evadeHit(p, src, mob) {
    const t = this.time, rollAt = p.iframeUntil - DODGE.iframes;
    if (t - rollAt <= PERFECT.window + 1e-6 && p.perfectRoll !== rollAt) {
      p.perfectRoll = rollAt; // one perfect per roll
      const a = this.attackerOf(p, src, mob);
      p.counterUntil = t + PERFECT.counter;
      this.events.push({ t: 'perfect', id: p.id, to: p.id, m: a?.id || 0, x: r2(p.x), z: r2(p.z) });
      if (a) this.addPosture(a, p, 0, { chunk: 'perfect' });
      p.perfects = (p.perfects || 0) + 1;
      return;
    }
    this.events.push({ t: 'evade', id: p.id, to: p.id });
  },

  // ---------- Guardian guard / parry ----------
  guard(p, on) {
    on = !!on && p.cls === 'guardian' && !p.dead;
    if (on === !!p.guarding) return;
    const t = this.time;
    p.guarding = on;
    if (on) {
      p.parryOk = t - (p.guardPress ?? -9) >= GUARD.repress; // mashing R doesn't keep a parry window open
      p.guardPress = t; p.guardAt = t;
    }
    this.events.push({ t: 'guard', id: p.id, on: on ? 1 : 0 });
  },

  // A hit is about to land on p: 'parry' (negated), 'guard' (reduced) or null.
  guardHit(p, src, mob, peril) {
    if (!p.guarding || p.dead) return null;
    const a = this.attackerOf(p, src, mob);
    if (a && Math.abs(wrapAngle(angleTo(p.x, p.z, a.x, a.z) - p.face)) > GUARD.arc) return null; // not frontal
    if (p.parryOk && this.time - p.guardAt <= GUARD.parry + 1e-6) {
      this.events.push({ t: 'parry', id: p.id, to: p.id, m: a?.id || 0, x: r2(p.x), z: r2(p.z), f: r2(p.face) });
      if (a) this.addPosture(a, p, 0, { chunk: 'parry' });
      p.parries = (p.parries || 0) + 1;
      return 'parry';
    }
    return peril ? null : 'guard'; // guarding does nothing against a perilous attack
  },

  // ---------- per-tick upkeep: posture decay, the Warden's Horn Sweep ----------
  updateCombat(dt) {
    const t = this.time;
    for (const m of this.mobs.values()) {
      if (m.dead) { m.posture = 0; continue; }
      if (m.posture > 0 && t - (m.postureAt || 0) > POSTURE.decayAfter) {
        m.posture = Math.max(0, m.posture - this.postureCap(m) * POSTURE.decay[m.def.boss ? 1 : 0] * dt);
      }
    }
    for (const p of this.players.values()) if (p.dead && p.guarding) this.guard(p, false); // the guard drops on death
    this.updateQuakes();
    const b = this.boss;
    if (!b || b.dead || !b.engaged || !b.threat.size) return;
    if (b.sweepFight !== this.fight) { b.sweepFight = this.fight; b.sweepT = t + SWEEP.first; } // a new attempt
    if (t < b.sweepT || t < b.stunUntil || t < (b.busyUntil || 0) || b.windupAt) return;
    if (this.quakes?.some(q => q.m === b && q.r < SWEEP.r + 1)) return; // never a Horn Sweep on top of a Quake Ring still near it
    const near = [...this.players.values()].some(p => !p.dead && inArena(p.x, p.z) && dist(p, b) <= SWEEP.r + 4);
    if (!near) { b.sweepT = t + 2; return; }
    b.sweepT = t + SWEEP.every[b.phase] * (0.85 + Math.random() * 0.3);
    this.hornSweep(b);
  },

  // Horn Sweep: a gold "!" telegraph, then a full circle around the Warden. ~80% max HP to anyone not i-framing or parrying.
  hornSweep(m) {
    const t = this.time, tok = (m.perilTok = (m.perilTok || 0) + 1);
    m.windupAt = 0; m.sweepPending = true;
    m.busyUntil = Math.max(m.busyUntil || 0, t + SWEEP.wind + 0.35);
    this.events.push({ t: 'tele', k: 'sweep', x: r2(m.x), z: r2(m.z), r: SWEEP.r, d: SWEEP.wind, follow: m.id, id: m.id });
    this.schedule(SWEEP.wind, () => {
      if (m.dead || m.perilTok !== tok) return;
      m.sweepPending = false;
      this.events.push({ t: 'fx', k: 'sweep', id: m.id, x: r2(m.x), z: r2(m.z), r: SWEEP.r });
      for (const p of this.players.values()) {
        if (!p.dead && dist(p, m) <= SWEEP.r + 0.4) this.damagePlayer(p, p.maxHp * SWEEP.frac, { peril: true, src: 'warden sweep', mob: m });
      }
    });
  },
};

// ---------- the Warden's Quake Ring ----------
// Wind-up (it rears up, the reach of the rings shows on the floor), then 1-3 rings `gap` s apart roll out from where it
// stands. A ring hurts anyone on the ground as its wavefront (a band `w` m either side of its radius) passes them:
// airborne (jump) or rolling (i-frames) = no damage ("Jumped!" / "Dodged!", rolls can be perfect dodges), and beyond
// `max` m it never reaches you. Each ring hits a player at most once.
Object.assign(methods, {
  quakeRing(m, n) {
    const Q = (this.twistW || WARDEN).quake, t = this.time;
    n = Math.max(1, n ?? Q.rings[m.phase] ?? 1);
    m.windupAt = 0;
    m.busyUntil = Math.max(m.busyUntil || 0, t + Q.wind + Q.gap * (n - 1) + 0.35);
    const x = m.x, z = m.z, atk = m.def.atk * Q.mult;
    for (let i = 0; i < n; i++) {
      const q = { id: this.id(), x, z, start: t + Q.wind + i * Q.gap, r: 0, sp: Q.speed, w: Q.w, max: Q.max, atk, hit: new Set(), ev: new Set(), m };
      (this.quakes ||= []).push(q);
      // d: seconds until this ring starts rolling; i/n: its place in the volley (the client winds up on ring 0)
      this.events.push({ t: 'quake', id: q.id, by: m.id, x: r2(x), z: r2(z), d: r2(q.start - t), sp: q.sp, w: q.w, max: q.max, g: Q.gap, i, n });
    }
  },

  updateQuakes() {
    if (!this.quakes?.length) return;
    const t = this.time;
    for (const q of this.quakes) {
      if (t < q.start || q.m.dead) continue;
      const prev = q.r;
      q.r = Math.min(q.max, (t - q.start) * q.sp);
      for (const p of this.players.values()) {
        if (p.dead || q.hit.has(p.id) || !inArena(p.x, p.z)) continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < prev - q.w || d > q.r + q.w) continue; // the wavefront isn't on you this tick
        const opts = { ground: true, src: 'warden quake', mob: q.m };
        if (t < p.iframeUntil || (t >= p.airFrom && t < p.airUntil)) { // over it or rolling through: evaded (once per ring)
          if (!q.ev.has(p.id)) { q.ev.add(p.id); this.damagePlayer(p, q.atk, opts); if (QSTATS) console.log(`[quake] evade ${t < p.iframeUntil ? 'roll' : 'jump'}`); }
          continue;
        }
        q.hit.add(p.id);
        this.damagePlayer(p, q.atk, opts);
        if (QSTATS) console.log('[quake] hit');
      }
    }
    this.quakes = this.quakes.filter(q => q.r < q.max && !q.m.dead && q.m.engaged);
  },

  clearQuakes() { this.quakes = []; },
});

export function installCombat(Game) { Object.assign(Game.prototype, methods); }
