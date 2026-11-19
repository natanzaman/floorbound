// Graphics quality (public/quality.js): presets, the starting level, effect density, and Auto stepping down when the
// frame rate is low, up when there's headroom, without flipping back and forth.
// Usage: node test/quality.js
import assert from 'node:assert/strict';
import { PRESETS, LEVELS, Q, setLevel, startLevel, startAntialias, fxCount, segs, AutoQuality, AUTO } from '../public/quality.js';

// presets
assert.deepEqual(LEVELS, ['low', 'medium', 'high']);
assert.equal(PRESETS.low.pixelRatio, 1); assert.equal(PRESETS.medium.pixelRatio, 1.5);
assert.equal(PRESETS.low.shadows, false); assert.equal(PRESETS.high.shadows, true);
assert.ok(PRESETS.low.fx < PRESETS.medium.fx && PRESETS.medium.fx < PRESETS.high.fx, 'effect density rises with the level');
assert.ok(PRESETS.low.fog < PRESETS.high.fog, 'shorter view on Low');
assert.equal(PRESETS.high.antialias, true); assert.equal(PRESETS.low.antialias, false);

assert.ok(PRESETS.low.charDist < PRESETS.medium.charDist && PRESETS.medium.charDist < PRESETS.high.charDist, 'character draw distance rises with the level (review #7)');
assert.deepEqual(LEVELS.map(l => PRESETS[l].charDist), [70, 100, 140]);
assert.ok(LEVELS.every(l => PRESETS[l].charShadow === 25), 'characters cast shadows within 25 m');

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
// review #3: a borderline machine (too slow for High, fine on Medium) settles instead of oscillating for good
{
  const a = new AutoQuality('high'), fpsOf = { high: 40, medium: 60, low: 60 };
  let t = 0; const changes = [];
  for (; t < 30 * 60000; t += 1000 / fpsOf[a.level]) { const c = a.frame(t, 1000 / fpsOf[a.level]); if (c) changes.push([Math.round(t / 1000), c]); }
  assert.equal(changes.filter(c => c[1] === 'medium').length, AUTO.maxFails, `fails on High ${AUTO.maxFails} times (${JSON.stringify(changes)})`);
  assert.equal(changes.length, 2 * AUTO.maxFails - 1, 'then High is off limits for the session: no more changes in 30 minutes');
  assert.equal(a.level, 'medium');
  assert.ok(changes.at(-1)[0] < 600, `settled within 10 minutes (${changes.at(-1)[0]} s)`);
  // ... while a level that failed fewer than maxFails times is still retried after its ban
  const b = new AutoQuality('medium');
  let r = run(b, 30, 6000, 0);
  assert.deepEqual(r.changes.map(c => c[1]), ['low']);
  r = run(b, 60, 120000, r.t);
  assert.equal(r.changes[0]?.[1], 'medium', 'one failure: Medium is tried again later');
}
// review #3: shadows: once Auto turns them off it keeps them off on the way back up (no shader recompiles)
{
  const a = new AutoQuality('medium');
  assert.equal(a.over(), null, 'nothing overridden at first');
  let r = run(a, 30, 6000, 0);
  assert.deepEqual(r.changes.map(c => c[1]), ['low']);
  assert.deepEqual(a.over(), { shadows: false });
  r = run(a, 60, 120000, r.t);
  assert.ok(r.changes.some(c => c[1] === 'medium'), 'back up to Medium');
  setLevel('medium', a.over()); assert.equal(Q.shadows, false, 'Medium without shadows'); assert.equal(Q.pixelRatio, PRESETS.medium.pixelRatio, 'the rest of the preset applies');
  setLevel('high', a.over()); assert.equal(Q.shadows, false, 'High too');
  setLevel('high'); assert.equal(Q.shadows, true, 'a chosen level has its own shadows');
  const h = new AutoQuality('high'); run(h, 30, 6000, 0);
  assert.equal(h.level, 'medium'); assert.equal(h.over(), null, 'High to Medium keeps shadows (both have them)');
}
// review #8: edge smoothing (MSAA) is fixed when the renderer is made: Auto only asks for it once High has held
assert.equal(startAntialias('auto'), false, 'Auto, first visit: High without MSAA');
assert.equal(startAntialias('auto', { lastAuto: 'high' }), true, 'Auto settled on High last time: MSAA');
assert.equal(startAntialias('auto', { lastAuto: 'medium' }), false);
assert.equal(startAntialias('high'), true); assert.equal(startAntialias('medium', { lastAuto: 'high' }), false);
assert.equal(startAntialias('high', { touch: true }), false, 'never on touch');
{ const a = new AutoQuality('high'); run(a, 60, 11000, 0); assert.ok(a.windows >= 2, 'windows are counted (main saves the level after each)'); }

console.log('quality: all checks passed');
