// Network smoothing maths (pure, no DOM / Three.js): public/main.js uses it, test/netsmooth.js checks it.
//  - SnapClock: when to draw. Each snapshot carries the server's clock (`st`, ms). The client draws the world a little
//    in the past (about 100 ms, more when snapshots arrive unevenly), so there is nearly always a snapshot on each side
//    of the moment drawn. The playout clock never runs backwards and never jumps: it speeds up or slows down by up to
//    10% to follow the target.
//  - Track: one entity's recent positions; sample(t) interpolates between the two snapshots around t, extrapolates a
//    little past the newest (a late snapshot), then holds. A jump of NET.snapDist or more is a teleport: no sliding
//    across it. Whatever a newly arrived snapshot changes about the position being drawn right now (a late one that
//    corrects the extrapolation, one that arrived out of order) is not drawn as a jump: it becomes an offset that
//    fades out over ~NET.errTau * 3.
//  - Correction: your own character. The server only moves you directly with a `tp` event (dashes, knockbacks,
//    staging): the game position moves at once, the drawn one slides there over ~120 ms unless it's a real teleport.
export const NET = {
  tick: 50,        // server snapshot interval (ms, TICK_RATE 20)
  minDelay: 100,   // draw at least this far in the past (ms)
  maxDelay: 300,   // ... and at most this far
  window: 3000,    // jitter / clock window (ms)
  extrap: 120,     // extrapolate past the newest snapshot for at most this long (ms), then hold
  snapDist: 15,    // a jump this big between two snapshots is a teleport (m)
  errTau: 60,      // a late snapshot's correction fades with this time constant (ms)
  corrTau: 40,     // your own position correction (tp) fades with this time constant (ms): ~95% within 120 ms
  corrSnap: 12,    // ... unless it's this far or more (a real teleport): then it snaps
  resync: 250,     // the playout clock jumps (instead of easing) when it's this far off (ms)
};

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, k) => a + wrap(b - a) * k;
/** Exponential decay of an offset over dt (ms) with time constant tau (ms). */
export const decay = (v, dt, tau) => v * Math.exp(-Math.max(0, dt) / tau);

export class SnapClock {
  constructor(o = {}) {
    this.o = { ...NET, ...o };
    this.samples = []; // [arrival, offset] within the window
    this.minOff = null; this.delay = this.o.minDelay; this.jitter = 0;
    this.lastSt = -Infinity; this.rt = null; this.lastNow = 0;
    this.count = 0; this.late = 0; this.ooo = 0; this.arrivals = []; // arrival times in the last second (rate)
  }
  /** A snapshot stamped st (server ms) arrived at local time `arrival` (ms). stale: older than one already seen. */
  push(st, arrival) {
    this.count++;
    this.arrivals.push(arrival);
    while (this.arrivals.length && arrival - this.arrivals[0] > 1000) this.arrivals.shift();
    if (!(st > this.lastSt)) { this.ooo++; return { stale: true }; }
    this.lastSt = st;
    const off = arrival - st;
    const S = this.samples;
    S.push([arrival, off]);
    while (S.length > 2 && arrival - S[0][0] > this.o.window) S.shift();
    let min = Infinity;
    for (const s of S) if (s[1] < min) min = s[1];
    this.minOff = min;
    const lateness = off - min; // how much later than the best-case arrival
    if (lateness > this.o.tick) this.late++;
    // jitter: the 90th percentile of lateness over the window
    const ls = S.map(s => s[1] - min).sort((a, b) => a - b);
    this.jitter = ls[Math.min(ls.length - 1, Math.floor(ls.length * 0.9))];
    this.delay = Math.max(this.o.minDelay, Math.min(this.o.maxDelay, this.o.tick + this.jitter + 20));
    return { stale: false, lateness };
  }
  /** Snapshots received in the last second. */
  rate(now) { let n = 0; for (const a of this.arrivals) if (now - a <= 1000) n++; return n; }
  /** The server time to draw at local time `now` (ms), or null before the first snapshot. Never goes backwards. */
  renderTime(now) {
    if (this.minOff === null) return null;
    const target = now - this.minOff - this.delay;
    if (this.rt === null || Math.abs(target - this.rt) > this.o.resync) this.rt = target;
    else { // run at normal speed, then close the gap by at most 10% of the frame
      const dt = Math.max(0, now - this.lastNow), pred = this.rt + dt;
      this.rt = pred + Math.max(-0.1 * dt, Math.min(0.1 * dt, target - pred));
    }
    this.lastNow = now;
    return this.rt;
  }
}

const B4 = {}, AF = {}; // scratch (push)
export class Track {
  constructor(o = {}) { this.o = { ...NET, ...o }; this.s = []; this.ex = 0; this.ez = 0; this.mode = 'hold'; this.lastT = null; }
  /** Add a snapshot's position (server time t). rt: the time being drawn now (so a change to it fades, never jumps). */
  push(t, x, z, f, rt = null) {
    const before = rt !== null && this.s.length ? this.sampleRaw(rt, B4) : null;
    const S = this.s;
    let i = S.length;
    while (i > 0 && S[i - 1].t > t) i--;
    if (i > 0 && S[i - 1].t === t) return; // already have it
    const smp = { t, x, z, f, cut: false };
    S.splice(i, 0, smp);
    const prev = S[i - 1], next = S[i + 1];
    if (prev) smp.cut = Math.hypot(x - prev.x, z - prev.z) >= this.o.snapDist;
    if (next) next.cut = Math.hypot(next.x - x, next.z - z) >= this.o.snapDist;
    while (S.length > 30) S.shift();
    if (before) {
      const after = this.sampleRaw(rt, AF);
      const dx = before.x - after.x, dz = before.z - after.z;
      if (after.cutNow || Math.hypot(dx, dz) >= this.o.snapDist) { this.ex = 0; this.ez = 0; } // a teleport: just go
      else { this.ex += dx; this.ez += dz; }
    }
  }
  /** Drop samples that are no longer needed for drawing at time t (keep one before it). */
  trim(t) { while (this.s.length > 2 && this.s[1].t <= t) this.s.shift(); }
  /** Where the entity is at server time t, before the late-correction offset. */
  sampleRaw(t, out = {}) {
    const S = this.s, n = S.length;
    if (!n) return null;
    const put = (x, z, f, mode, cutNow = false) => { out.x = x; out.z = z; out.f = f; out.mode = mode; out.cutNow = cutNow; return out; };
    if (t <= S[0].t) return put(S[0].x, S[0].z, S[0].f, 'hold');
    for (let i = 0; i < n - 1; i++) {
      const a = S[i], b = S[i + 1];
      if (t < b.t) {
        if (b.cut) return put(a.x, a.z, a.f, 'interp'); // stay put until the teleport's moment
        const k = (t - a.t) / (b.t - a.t);
        return put(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, lerpAngle(a.f, b.f, k), 'interp');
      }
    }
    const b = S[n - 1], a = S[n - 2];
    if (!a || b.cut || b.t - a.t > this.o.tick * 3) return put(b.x, b.z, b.f, 'hold', b.cut);
    const over = Math.min(t - b.t, this.o.extrap), k = over / (b.t - a.t);
    return put(b.x + (b.x - a.x) * k, b.z + (b.z - a.z) * k, b.f, t - b.t > this.o.extrap ? 'hold' : 'extrap');
  }
  /** Where to draw the entity at server time t; `now` (ms, local) fades the late-correction offset. */
  sample(t, now, out = {}) {
    const r = this.sampleRaw(t, out);
    if (!r) return null;
    if (this.lastT !== null) { const dt = now - this.lastT; this.ex = decay(this.ex, dt, this.o.errTau); this.ez = decay(this.ez, dt, this.o.errTau); }
    this.lastT = now;
    if (Math.abs(this.ex) < 1e-3) this.ex = 0;
    if (Math.abs(this.ez) < 1e-3) this.ez = 0;
    this.mode = r.mode;
    r.x += this.ex; r.z += this.ez;
    return r;
  }
  get newest() { return this.s[this.s.length - 1] || null; }
}

/** Your own drawn position: the game position plus an offset that fades after a server correction. */
export class Correction {
  constructor(o = {}) { this.o = { ...NET, ...o }; this.x = 0; this.z = 0; }
  /** The server moved you from (fx, fz) (where you were drawn) to (tx, tz). Returns true when it snapped. */
  apply(fx, fz, tx, tz) {
    const dx = fx - tx, dz = fz - tz;
    if (Math.hypot(dx, dz) >= this.o.corrSnap) { this.x = 0; this.z = 0; return true; }
    this.x = dx; this.z = dz; return false;
  }
  step(dtMs) {
    this.x = decay(this.x, dtMs, this.o.corrTau); this.z = decay(this.z, dtMs, this.o.corrTau);
    if (Math.hypot(this.x, this.z) < 1e-3) { this.x = 0; this.z = 0; }
  }
}
