// Boss combos, after states and melee openings (docs/ROADMAP.md J3), mixed into Game. The numbers live in
// shared/bosstiming.js; each boss's AI (server/game.js the Warden, server/floor2.js the Sovereign, server/floor3.js the
// Colossus) calls these:
//  - bossTable(m, base, n) at the engage: the fight's table m.tm (the twist copy + party-size knobs + sequences).
//  - bossCombo(m, run, timers) at the top of its specials: runs the phase's combos step by step (a step starts `gap` s
//    after the previous one ended), then holds the combo's after state for its pause. True while a combo or an after
//    state holds the boss: its own timers wait (summons, rockfall, pools and team mechanics included). A combo waits
//    like a single move: for m.busyUntil (another move holding the boss: a Twin Horns second charge, the Deluge call),
//    for m.comboWait (a team mechanic's channel, server/bossteam.js; the fall, server/arenas.js) and, at its start, for
//    closeReady of its first step, and for a basic swing winding up (it lands on its telegraph first). The next combo
//    comes `every` s after the last one started, and never sooner than the phase's `rest` (default 2) s after its after
//    state ends, so the boss's own moves get turns between two combos.
//  - dropAfter(m) at a phase change (each boss's phase loop, before the new phase's move): the combo in flight and the
//    after state end, and the after state's hold on the boss is released (a hold set since, like the Deluge call, stays).
//  - bossAfter(m, mv, at): after a single move landing at `at`, its table `after` { state, pause }.
//  - closeReady / closeLanded / areaHold / swingReady: no point-blank chaining (the table's `close`).
// While the boss is in an opening (exposed / stunned / planted, not Grounded, not Broken, no director show), melee hits
// (inFlankReach) get +OPENING.dmg damage added to the flank multiplier (server/threat.js), so posture rises with it.
// The snapshot carries w.op = [[boss id, state index, s left, s total]] while any opening is on (late joiners see it).
import { OPENING, AFTER_STATES, isOpening, fightTable, pickCombo } from '../shared/bosstiming.js';
import { inFlankReach } from '../shared/threat.js';
import { BITE, PACE } from '../shared/data.js';

const STATS = !!process.env.OPEN_STATS; // bot runs: log each opening (s, melee hits, who used it)
const r1 = v => Math.round(v * 10) / 10;
const SWING = { warden: 'cleave', sovereign: 'sweep', colossus: 'cleave' }; // each boss's basic swing in its table

const methods = {
  showOn() { return !!this.director?.running; },

  /** The fight's table at the engage, for `n` fighters (party-size knobs; this.bossKnobs[type]: live overrides). */
  bossTable(m, base, n) {
    m.tm = fightTable(m.type, base, n, this.bossKnobs?.[m.type] || null);
    m.seq = null; m.after = null; m.comboPh = -1; m.comboT = Infinity; m.comboPick = null; m.comboWait = 0; m.closeAt = -99; m.holdUntil = 0;
    return m.tm;
  },

  /** Hold `state` from `from` to `until` (no openings in a director show). */
  setAfter(m, state, from, until, prev = null) {
    if (state === 'idle' || until <= from || (isOpening(state) && this.showOn())) return;
    if (STATS && m.after) this.logOpening(m);
    m.after = { state, from, until, hits: new Map(), prev }; // prev: the holds before it (dropAfter restores them)
  },

  /** Hold the boss until `until` in `state`: busy (standing), or for 'walk' free to move but not to attack. */
  holdFor(m, state, from, until) {
    const prev = { busy: m.busyUntil || 0, hold: m.holdUntil || 0 };
    if (state === 'walk') m.holdUntil = Math.max(m.holdUntil || 0, until), m.busyUntil = Math.max(m.busyUntil || 0, from);
    else m.busyUntil = Math.max(m.busyUntil || 0, until);
    this.setAfter(m, state, from, until, prev);
    return until;
  },

  /** After a single move landing at `at` (+ extra s of its own): busy for its `after.pause`, holding its state. */
  bossAfter(m, mv, at, extra = 0) {
    const A = mv?.after || { state: 'idle', pause: 0 }, from = at + extra;
    return this.holdFor(m, A.state || 'idle', from, from + (A.pause || 0));
  },

  /** A new phase: the combo in flight and the after state end with the last phase, and the after state's hold on the
   *  boss is released (back to the holds it had before; a later or longer hold, like the Deluge call, stays). */
  dropAfter(m) {
    const a = m.after;
    if (STATS && a) this.logOpening(m);
    m.seq = null; m.after = null;
    if (!a?.prev) return;
    if ((m.busyUntil || 0) <= a.until && (m.busyUntil || 0) > a.prev.busy) m.busyUntil = a.prev.busy;
    if ((m.holdUntil || 0) <= a.until && (m.holdUntil || 0) > a.prev.hold) m.holdUntil = a.prev.hold;
  },

  /** The after state m holds now, or null. */
  afterOf(m) {
    const a = m.after, t = this.time;
    if (!a || t >= a.until) { if (a && STATS) this.logOpening(m); if (a && t >= a.until) m.after = null; return null; }
    return t >= a.from ? a : null;
  },

  /** The opening m is in now ({ state, from, until }), or null: not while Grounded or Broken, never in a show. */
  openingOf(m) {
    if (!m || m.dead || !m.engaged) return null;
    const a = this.afterOf(m), t = this.time;
    if (!a || !isOpening(a.state) || this.showOn()) return null;
    if (t < (m.groundedUntil || 0) || t < (m.staggerUntil || 0)) return null;
    return a;
  },

  /** Run the phase's combos. run(k): perform ability k now, return when it ends (absolute s). timers: ability -> the
   *  boss's own timer field (a combo step pushes that timer back by the ability's cooldown). True while a combo, or the
   *  after state of one (or of a single move), holds the boss. */
  bossCombo(m, run, timers = {}) {
    const tm = m.tm, t = this.time;
    if (!tm?.seqs || this.showOn()) { m.seq = null; return false; }
    const P = tm.seqs[m.phase] || {};
    if (m.comboPh !== m.phase) { // a new phase: the last phase's combo and after state end with it (the Deluge call, ...)
      if (m.comboPh >= 0) this.dropAfter(m); // (each boss's phase loop has already done it, before its phase move)
      m.comboPh = m.phase; m.comboT = P.every ? t + (P.first ?? P.every) : Infinity; m.comboPick = null;
    }
    if (m.seq && m.staggerUntil > m.seq.stag) m.seq = null; // a Break interrupts it
    if (!m.seq) {
      const a = this.afterOf(m);
      if (a) return a.state !== 'idle';
      if (t < m.comboT || t < (m.busyUntil || 0) || t < (m.comboWait || 0) || m.windupAt || t < (m.stunUntil || 0)) return false;
      if (this.arenaHold?.(m)) return false; // a fall is pending (server/arenas.js): a combo + after state would starve it
      const s = m.comboPick || pickCombo(tm, m.phase);
      if (!s) { m.comboT = Infinity; return false; }
      if (!this.closeReady(m, s.steps[0])) { m.comboPick = s; return false; } // no point-blank chaining (it keeps its pick)
      m.comboPick = null; m.comboT = t + P.every;
      m.seq = { s, i: 0, next: t, stag: m.staggerUntil || 0 };
      m.windupAt = 0;
    }
    const q = m.seq;
    if (t >= q.next && t < (m.busyUntil || 0)) q.next = m.busyUntil; // another move holds the boss: the next step waits for it
    if (t < (m.comboWait || 0)) return false; // a team channel: the combo pauses, basic swings go on (server/bossteam.js btChannel)
    if (m.windupAt) return true; // a basic swing started in the channel lands on its telegraph first (no busy hold), then the step
    if (t < q.next) { m.busyUntil = Math.max(m.busyUntil || 0, q.next); return true; }
    const k = q.s.steps[q.i], mv = tm[k];
    if (!this.closeReady(m, k)) { q.next = (m.closeAt ?? -99) + tm.close.gap; m.busyUntil = Math.max(m.busyUntil || 0, q.next); return true; } // (a swing just landed: no point-blank chaining)
    const end = Math.max(t, run(k) ?? t);
    const every = Array.isArray(mv?.every) ? mv.every[m.phase] : mv?.every;
    if (timers[k] && every > 0) m[timers[k]] = Math.max(m[timers[k]] ?? -Infinity, t + every);
    q.i++;
    if (q.i < q.s.steps.length) { q.next = end + (q.s.gaps[q.i - 1] || 0); m.busyUntil = Math.max(m.busyUntil || 0, q.next); return true; }
    m.seq = null;
    const until = this.holdFor(m, q.s.state || 'exposed', end, end + (q.s.pause || 0));
    m.comboT = Math.max(m.comboT, until + (P.rest ?? 2)); // the boss's own moves get a turn before the next combo
    return true;
  },

  // ---------- no point-blank chaining ----------
  /** May close-range / all-around move k start now (the table's close.gap since the last one landed)? */
  closeReady(m, k) {
    const C = m.tm?.close;
    return !C || this.showOn() || !C.moves.includes(k) || this.time >= (m.closeAt ?? -99) + C.gap;
  },
  /** Close-range move k lands at `at`. */
  closeLanded(m, k, at) {
    const C = m.tm?.close;
    if (C && C.moves.includes(k)) m.closeAt = Math.max(m.closeAt ?? -99, at);
  },
  /** The boss's own telegraphed area move winds up until `until`: its basic swing waits (close.hold). */
  areaHold(m, until) {
    if (m.tm?.close?.hold && !this.showOn()) m.holdUntil = Math.max(m.holdUntil || 0, until);
  },
  /** May the boss start its basic swing now? */
  swingReady(m) {
    if (this.time < (m.after?.state === 'walk' ? m.holdUntil || 0 : 0)) return false; // walking it off: no swing
    return this.closeReady(m, SWING[m.type]) && (this.showOn() || this.time >= (m.holdUntil || 0));
  },
  /** Its basic swing starts now and lands after `wind` s. */
  swingStart(m, wind) { this.closeLanded(m, SWING[m.type], this.time + wind); },
  /** A basic swing forced now (the director's boss_move, testing aids): the same wind-up, rest and no-chaining as the boss's
   *  own swing, read from its fight table (m.tm, else `base`: the table before the fight scaled it). */
  forceSwing(m, base) {
    const t = this.time, A = (m.tm || base)[SWING[m.type]], [r, h] = BITE[m.type];
    m.windupAt = t + A.wind; this.swingStart(m, A.wind); m.busyUntil = Math.min(m.busyUntil || 0, t);
    m.atkT = t + A.cd * (m.phase === 2 ? A.rage : 1) + A.wind * (1 - 1 / PACE); // as the boss's AI: the table's cd (+ rage), the paced extra wind-up
    this.events.push({ t: 'wind', id: m.id, d: A.wind, f: Math.round(m.face * 100) / 100, r, h });
  },

  // ---------- snapshot / stats ----------
  openSnap() {
    let out;
    for (const m of [this.boss, this.sovereign, this.colossus]) {
      const a = m && this.openingOf(m);
      if (a) (out ||= []).push([m.id, AFTER_STATES.indexOf(a.state), r1(a.until - this.time), r1(a.until - a.from)]);
    }
    return out;
  },
  logOpening(m) {
    const a = m.after;
    if (!a || a.logged || !isOpening(a.state)) return;
    a.logged = true;
    const by = [...a.hits].map(([id, n]) => `${this.players.get(id)?.cls || id}:${n}`).join(',');
    console.log(`[opening] ${m.type} ${a.state} ${r1(a.until - a.from)}s melee hits ${[...a.hits.values()].reduce((s, n) => s + n, 0)} by ${by || '-'}`);
  },
};

export function installOpenings(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  // The opening bonus: added to the flank multiplier (server/threat.js multiplies the hit by it, and the posture by
  // p._flankPost), so it never multiplies with a Pincer; never during a Switch (Broken) or while Grounded (openingOf).
  const orig = P.flankMult;
  P.flankMult = function (m, p) {
    const f = orig.call(this, m, p);
    if (!m?.def?.boss || !p || !inFlankReach(m, p)) return f;
    const a = this.openingOf(m);
    if (!a) return f;
    a.hits.set(p.id, (a.hits.get(p.id) || 0) + 1);
    if (OPENING.posture) p._flankPost = (p._flankPost || 1) + OPENING.posture; // (the extra damage already adds posture)
    return f + OPENING.dmg;
  };
}
