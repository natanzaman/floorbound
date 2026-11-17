// Combat core, mixed into Game (see installCombat at the bottom of game.js):
//  - Posture: every hit fills an enemy's break meter; full = BROKEN (stagger + Switch window), then it resets.
//  - Perfect dodge: a roll that starts just before a hit lands -> slow-mo, posture damage to the attacker, a counter window.
//  - Guardian guard (hold R): frontal hits take much less damage; pressing just before a hit PARRIES it.
//  - The Warden's perilous Horn Sweep: dodge through it or parry it; shields don't help.
import { DODGE, SWITCH, POSTURE, PERFECT, GUARD, SWEEP, postureMax, angleTo, wrapAngle, inArena } from '../shared/data.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;

const methods = {
  // ---------- posture ----------
  postureCap(m) { return postureMax(m.def, m.maxHp); },
  posturePct(m) { return Math.min(100, Math.round((100 * (m.posture || 0)) / this.postureCap(m))) || 0; },

  // Add posture damage from player p. amount = damage dealt; the flags add big chunks.
  addPosture(m, p, amount, { heavy = false, brk = false, interrupt = false, counter = false, chunk = null } = {}) {
    if (!m || m.dead) return;
    const t = this.time;
    if (counter) this.events.push({ t: 'counter', id: m.id, by: p.id });
    if (interrupt && !m.def.boss) m.windupAt = 0; // a Smite mid wind-up still interrupts small enemies
    if (t < m.staggerUntil) return; // frozen while broken
    const max = this.postureCap(m), bi = m.def.boss ? 1 : 0;
    let gain = amount * (heavy ? POSTURE.heavy : 1);
    if (brk) gain += max * POSTURE.brk[bi];
    if (interrupt) gain += max * POSTURE.smite[bi];
    if (chunk) gain += max * POSTURE[chunk][bi];
    if (counter) gain *= PERFECT.posture;
    m.posture = (m.posture || 0) + gain;
    m.postureAt = t;
    if (m.posture >= max) this.breakMob(m, p, interrupt);
  },

  // Posture full: BROKEN. Staggered for the Switch window, wind-ups (and a pending Horn Sweep) are cancelled.
  breakMob(m, p, interrupt = false) {
    const t = this.time, dur = m.def.boss ? SWITCH.bossWindow : SWITCH.window;
    m.staggerUntil = t + dur; m.staggerBy = p.id; m.switched = false;
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
      this.events.push({ t: 'perfect', id: p.id, m: a?.id || 0, x: r2(p.x), z: r2(p.z) });
      if (a) this.addPosture(a, p, 0, { chunk: 'perfect' });
      p.perfects = (p.perfects || 0) + 1;
      return;
    }
    this.events.push({ t: 'evade', id: p.id });
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
      this.events.push({ t: 'parry', id: p.id, m: a?.id || 0, x: r2(p.x), z: r2(p.z), f: r2(p.face) });
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
    const b = this.boss;
    if (!b || b.dead || !b.engaged || !b.threat.size) return;
    if (b.sweepFight !== this.fight) { b.sweepFight = this.fight; b.sweepT = t + SWEEP.first; } // a new attempt
    if (t < b.sweepT || t < b.stunUntil || t < (b.busyUntil || 0) || b.windupAt) return;
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

export function installCombat(Game) { Object.assign(Game.prototype, methods); }
