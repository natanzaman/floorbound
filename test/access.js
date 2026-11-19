// Accessibility options (public/access.js): defaults change nothing, validation, merge.   Usage: node test/access.js
import assert from 'node:assert/strict';
import { ACCESS_DEFAULTS, RANGES, normalizeAccess, mergeAccess } from '../public/access.js';
{
  // defaults keep today's behaviour: normal sensitivity, no invert, everything else off, scale 100%
  assert.deepEqual(normalizeAccess(undefined), ACCESS_DEFAULTS);
  assert.deepEqual(normalizeAccess({}), ACCESS_DEFAULTS);
  assert.equal(ACCESS_DEFAULTS.sens, 1); assert.equal(ACCESS_DEFAULTS.invertY, false); assert.equal(ACCESS_DEFAULTS.uiScale, 1);
  for (const [k, v] of Object.entries(ACCESS_DEFAULTS)) if (typeof v === 'boolean') assert.equal(v, false, `${k} off by default`);
  // an old save (sens + invertY only) keeps its values and gets the new defaults
  assert.deepEqual(normalizeAccess({ sens: 2, invertY: true }), { ...ACCESS_DEFAULTS, sens: 2, invertY: true });
  // clamping and bad types
  assert.equal(normalizeAccess({ sens: 99 }).sens, RANGES.sens[1]);
  assert.equal(normalizeAccess({ padSens: -5 }).padSens, RANGES.padSens[0]);
  assert.equal(normalizeAccess({ uiScale: 0.1 }).uiScale, RANGES.uiScale[0]);
  assert.equal(normalizeAccess({ uiScale: 9 }).uiScale, RANGES.uiScale[1]);
  assert.equal(normalizeAccess({ sens: NaN }).sens, 1);
  assert.equal(normalizeAccess({ sens: '2' }).sens, 1);
  assert.equal(normalizeAccess({ reduceMotion: 'yes' }).reduceMotion, false);
  assert.equal(normalizeAccess({ guardToggle: true }).guardToggle, true);
  assert.ok(!('bogus' in normalizeAccess({ bogus: 1 })), 'unknown keys dropped');
  assert.deepEqual(normalizeAccess('junk'), ACCESS_DEFAULTS);
  // merge: a patch changes only its keys, and is validated
  const m = mergeAccess({ sens: 1.5, reduceMotion: true }, { highContrast: true, uiScale: 3 });
  assert.deepEqual(m, { ...ACCESS_DEFAULTS, sens: 1.5, reduceMotion: true, highContrast: true, uiScale: RANGES.uiScale[1] });
  assert.deepEqual(mergeAccess(null, {}), ACCESS_DEFAULTS);
  console.log('access: ok');
}
