// Graphics quality (public/quality.js): presets, the starting level, effect density, and Auto stepping down when the
// frame rate is low, up when there's headroom, without flipping back and forth.
// Usage: node test/quality.js
import assert from 'node:assert/strict';
import { PRESETS, LEVELS, Q, setLevel, startLevel, fxCount, segs, AutoQuality, AUTO } from '../public/quality.js';

// presets
assert.deepEqual(LEVELS, ['low', 'medium', 'high']);
assert.equal(PRESETS.low.pixelRatio, 1); assert.equal(PRESETS.medium.pixelRatio, 1.5);
assert.equal(PRESETS.low.shadows, false); assert.equal(PRESETS.high.shadows, true);
assert.ok(PRESETS.low.fx < PRESETS.medium.fx && PRESETS.medium.fx < PRESETS.high.fx, 'effect density rises with the level');
assert.ok(PRESETS.low.fog < PRESETS.high.fog, 'shorter view on Low');
assert.equal(PRESETS.high.antialias, true); assert.equal(PRESETS.low.antialias, false);

// starting level
assert.equal(startLevel('low'), 'low');
assert.equal(startLevel('medium', { lastAuto: 'low' }), 'medium', 'an explicit choice wins');
assert.equal(startLevel('auto', { lastAuto: 'low' }), 'low', 'Auto starts where it settled last time');
assert.equal(startLevel('auto'), 'high'); assert.equal(startLevel('auto', { touch: true }), 'medium');
assert.equal(startLevel(undefined, { lastAuto: 'bogus' }), 'high', 'junk in storage is ignored');

// live settings + density
setLevel('low'); assert.equal(Q.level, 'low'); assert.equal(Q.shadows, false);
assert.equal(fxCount(60, 6), 24); assert.equal(fxCount(2, 2), 2, 'never below the minimum');
assert.equal(segs(56), 28);
setLevel('nonsense'); assert.equal(Q.level, 'high', 'unknown level: High');
assert.equal(fxCount(60), 60);

// Auto: feed frames at a given fps for a while
function run(a, fps, ms, t0) {
  const step = 1000 / fps, changes = [];
  let t = t0;
  for (; t < t0 + ms; t += step) { const c = a.frame(t, step); if (c) changes.push([Math.round(t), c]); }
  return { t, changes };
}
{
  const a = new AutoQuality('high');
  let r = run(a, 30, 6000, 0);
  assert.deepEqual(r.changes.map(c => c[1]), ['medium'], '30 fps on High: one step down after ~5 s');
  assert.ok(r.changes[0][0] >= AUTO.window && r.changes[0][0] < AUTO.window + 500, 'after one window');
  r = run(a, 30, 8000, r.t);
  assert.deepEqual(r.changes.map(c => c[1]), ['low'], 'still slow: down to Low');
  r = run(a, 30, 20000, r.t);
  assert.deepEqual(r.changes, [], 'Low is the floor');
  // fast again: back up, one level per two good windows, but not into a level that failed recently
  r = run(a, 60, 12000, r.t);
  assert.deepEqual(r.changes.map(c => c[1]), [], 'Medium failed within the ban: stays on Low');
  r = run(a, 60, 40000, r.t);
  assert.ok(r.changes.length >= 1 && r.changes[0][1] === 'medium', `after the ban, up to Medium (${JSON.stringify(r.changes)})`);
}
{
  const a = new AutoQuality('medium');
  const r = run(a, 60, 11000, 0);
  assert.deepEqual(r.changes.map(c => c[1]), ['high'], 'headroom on Medium: up to High after two good windows');
  const r2 = run(a, 50, 30000, r.t);
  assert.deepEqual(r2.changes, [], '50 fps: neither up nor down (no flip-flopping)');
}
{
  const a = new AutoQuality('high');
  let t = 0;
  for (let i = 0; i < 40; i++) { t += 1000; assert.equal(a.frame(t, 1000, true), null, 'a hidden tab never counts'); }
  for (let i = 0; i < 20; i++) { t += 3000; assert.equal(a.frame(t, 3000), null, 'nor multi-second stalls'); }
}
{
  const a = new AutoQuality('high');
  const r = run(a, 3, 12000, 0);
  assert.deepEqual(r.changes.map(c => c[1]), ['medium', 'low'], `a very slow machine (3 fps) still steps down (${JSON.stringify(r.changes)})`);
}
console.log('quality: all checks passed');
