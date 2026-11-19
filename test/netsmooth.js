// Network smoothing maths (shared/netsmooth.js): the playout clock, the interpolation buffer (interpolate, extrapolate
// briefly, then hold; teleports; out-of-order and late snapshots never jump) and your own position correction.
// Usage: node test/netsmooth.js
import assert from 'node:assert/strict';
import { SnapClock, Track, Correction, NET, decay } from '../shared/netsmooth.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// --- the clock: steady snapshots draw minDelay behind; never backwards ---
{
  const c = new SnapClock();
  let prev = -Infinity;
  for (let i = 0; i < 100; i++) {
    const st = i * 50, arr = st + 1000 + 40; // 40 ms one way
    c.push(st, arr);
    for (let f = 0; f < 3; f++) { const now = arr + f * 16.7, rt = c.renderTime(now); assert.ok(rt >= prev, 'render time never goes backwards'); prev = rt; }
  }
  assert.equal(c.delay, NET.minDelay, 'no jitter: the minimum delay');
  near(c.renderTime(99 * 50 + 1040 + 33), 99 * 50 + 33 - 100, 2, 'drawn 100 ms behind the newest snapshot');
  assert.equal(c.late, 0); assert.equal(c.ooo, 0);
  assert.ok(c.rate(99 * 50 + 1040) >= 19, 'about 20 snapshots a second');
}

// --- jittery arrivals: the delay grows to cover them; late ones are counted ---
{
  const c = new SnapClock();
  for (let i = 0; i < 120; i++) c.push(i * 50, 1000 + i * 50 + 120 + (rnd() * 2 - 1) * 60);
  assert.ok(c.delay > 140 && c.delay <= NET.maxDelay, `delay grows with jitter (${c.delay})`);
  assert.ok(c.late > 0, 'late snapshots counted');
}

// --- out of order: an older snapshot after a newer one is stale ---
{
  const c = new SnapClock();
  c.push(0, 100); c.push(50, 150); c.push(100, 200);
  assert.equal(c.push(50, 210).stale, true, 'older than the newest: stale');
  assert.equal(c.ooo, 1);
}

// --- the clock eases (≤10% speed change) for small corrections, jumps only past NET.resync ---
{
  const c = new SnapClock();
  c.push(0, 1000);
  const a = c.renderTime(1000);
  c.minOff -= 40; // a faster arrival seen: the target moves 40 ms later
  const b = c.renderTime(1016.7);
  assert.ok(b - a <= 16.7 * 1.1 + 1e-9 && b - a >= 16.7, `eases toward the target (${(b - a).toFixed(2)} ms for a 16.7 ms frame)`);
}

// --- the track: interpolation, angle wrap, extrapolation then hold ---
{
  const t = new Track();
  t.push(0, 0, 0, 3.1); t.push(50, 5, 0, -3.1);
  const s = t.sample(25, 0);
  near(s.x, 2.5, 1e-9, 'halfway'); assert.equal(s.mode, 'interp');
  assert.ok(Math.abs(Math.abs(s.f) - Math.PI) < 0.05, `angle takes the short way round (${s.f})`);
  const e = t.sample(100, 0); near(e.x, 10, 1e-9, 'extrapolates past the newest'); assert.equal(e.mode, 'extrap');
  const h = t.sample(1000, 0); near(h.x, 5 + 0.1 * NET.extrap, 1e-9, 'then holds'); assert.equal(h.mode, 'hold');
  near(t.sample(-50, 0).x, 0, 1e-9, 'before the oldest: holds the oldest');
}

// --- teleports: no slide across a big jump; it happens at its moment ---
{
  const t = new Track();
  t.push(0, 0, 0, 0); t.push(50, 30, 0, 0);
  near(t.sample(25, 0).x, 0, 1e-9, 'stays put until the teleport');
  near(t.sample(50, 0).x, 30, 1e-9, 'then is there');
  near(t.sample(80, 0).x, 30, 1e-9, 'no extrapolation from a teleport');
}

// --- out-of-order samples slot into place ---
{
  const t = new Track();
  t.push(0, 0, 0, 0); t.push(100, 10, 0, 0); t.push(50, 8, 0, 0);
  near(t.sample(75, 0).x, 9, 1e-9, 'interpolates with the late sample in its place');
  t.push(50, 99, 0, 0);
  near(t.sample(50, 0).x, 8, 1e-9, 'a duplicate is ignored');
}

// --- a late snapshot that corrects the extrapolation doesn't jump: the difference fades ---
{
  const t = new Track();
  for (let i = 0; i <= 2; i++) t.push(i * 50, i * 5, 0, 0); // 0.1 m/ms to t=100
  const before = t.sample(180, 1000).x; // extrapolated (capped at NET.extrap)
  t.push(150, 10, 0, 0, 180); // it actually stopped at x=10 (arrives late, while drawing t=180)
  const after = t.sample(180, 1000).x;
  near(after, before, 1e-9, 'no jump on arrival');
  const later = t.sample(180, 1000 + 3 * NET.errTau).x;
  assert.ok(Math.abs(later - 10) < 0.06 * Math.abs(before - 10), `the correction fades out (${later.toFixed(3)})`);
}

// --- end to end: jittered, reordered delivery; steady motion stays smooth frame to frame ---
for (const [jit, reo] of [[0, 0], [60, 0.02]]) {
  const c = new SnapClock(), t = new Track();
  const speed = 0.006; // 6 m/s
  const msgs = [];
  let lastAt = 0;
  for (let i = 0; i < 200; i++) {
    const st = i * 50;
    let at = Math.max(lastAt, 1000 + st + 120 + (rnd() * 2 - 1) * jit);
    if (rnd() < reo) at += 75; else lastAt = at;
    msgs.push({ st, at, x: st * speed });
  }
  msgs.sort((a, b) => a.at - b.at);
  let mi = 0, prevX = null, worst = 0, rtPrev = null;
  for (let now = 1000; now < 1000 + 200 * 50; now += 1000 / 60) {
    while (mi < msgs.length && msgs[mi].at <= now) { const m = msgs[mi++]; c.push(m.st, m.at); t.push(m.st, m.x, 0, 0, c.rt); } // (a stale one still fills the buffer)
    const rt = c.renderTime(now);
    if (rt === null) continue;
    if (rtPrev !== null && now > 3000) assert.ok(rt >= rtPrev, 'never backwards');
    rtPrev = rt;
    const x = t.sample(rt, now).x;
    if (prevX !== null && now > 3000) worst = Math.max(worst, Math.abs(x - prevX));
    prevX = x;
  }
  const step = speed * 1000 / 60; // 0.1 m per frame
  assert.ok(worst < step * 1.6, `jitter ${jit} ms, reorder ${reo * 100}%: biggest frame-to-frame move ${worst.toFixed(3)} m (steady ${step.toFixed(3)})`);
  console.log(`ok smooth under jitter ${jit} ms / reorder ${reo * 100}%: worst step ${worst.toFixed(3)} m vs ${step.toFixed(3)} m; delay ${Math.round(c.delay)} ms; late ${c.late}, out of order ${c.ooo}`);
}

// --- a server stall (review #2): the tick caps dt at 0.2 s, so a 1 s stall leaves game time 0.8 s behind wall time ---
// Stamped on the game clock (the old server), every later snapshot arrives 800 ms "late": without a resync the client
// drew past the newest one (hold) until the stale best case left the 3 s window. Stamped on a wall clock (the server
// now), the stall is just a gap. Either way: smooth again within about a second.
for (const wall of [false, true]) {
  const c = new SnapClock(), t = new Track(), speed = 0.006; // 6 m/s of game time
  const msgs = [];
  let game = 0, w = 0;
  for (let i = 0; i < 260; i++) {
    const stall = i === 100 ? 1000 : 50; // one tick takes 1 s of wall time
    w += stall; game += Math.min(stall, 200);
    msgs.push({ st: wall ? w : game, at: 1000 + w + 40, x: game * speed });
  }
  const stallEnd = msgs[100].at; // (the first snapshot after the stall)
  let mi = 0, prevX = null, worst = 0, holds = 0, rtPrev = null;
  for (let now = 1000; now < msgs.at(-1).at; now += 1000 / 60) {
    while (mi < msgs.length && msgs[mi].at <= now) { const m = msgs[mi++]; c.push(m.st, m.at); t.push(m.st, m.x, 0, 0, c.rt); }
    const rt = c.renderTime(now);
    if (rt === null) continue;
    const x = t.sample(rt, now).x;
    if (now > stallEnd + 1200) { // a second after the stall: every frame interpolates and moves at the steady pace
      if (t.mode !== 'interp') holds++;
      if (prevX !== null) worst = Math.max(worst, Math.abs(x - prevX));
      if (rtPrev !== null) assert.ok(rt >= rtPrev, 'never backwards once settled');
      rtPrev = rt;
    }
    prevX = x;
  }
  const step = speed * 1000 / 60;
  assert.equal(holds, 0, `${wall ? 'wall' : 'game'}-clock stamps: no holds a second after a 1 s stall`);
  assert.ok(worst < step * 1.6, `${wall ? 'wall' : 'game'}-clock stamps: smooth a second after the stall (worst ${worst.toFixed(3)} m vs ${step.toFixed(3)} m)`);
  console.log(`ok a 1 s server stall (${wall ? 'wall' : 'game'}-clock stamps): smooth again within 1.2 s (worst step ${worst.toFixed(3)} m; resyncs ${c.shifts || 0})`);
}

// --- your own position: a small correction slides over ~120 ms, a big one snaps ---
{
  const k = new Correction();
  assert.equal(k.apply(2, 0, 0, 0), false);
  near(k.x, 2, 1e-9, 'starts where you were drawn');
  for (let i = 0; i < 7; i++) k.step(1000 / 60);
  assert.ok(k.x < 2 * 0.06, `mostly gone after ~117 ms (${k.x.toFixed(3)})`);
  assert.ok(k.x > 0, 'but it slid, not snapped');
  assert.equal(k.apply(20, 0, 0, 0), true, 'a teleport snaps');
  assert.equal(k.x, 0);
  near(decay(1, 40, 40), Math.exp(-1), 1e-12, 'decay');
}

console.log('netsmooth: all checks passed');
