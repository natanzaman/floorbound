// Accessibility options (public/access.js): defaults change nothing, validation, merge.   Usage: node test/access.js
import assert from 'node:assert/strict';
import { ACCESS_DEFAULTS, RANGES, ENUMS, normalizeAccess, mergeAccess } from '../public/access.js';
import { PALETTE_MODES, PALETTE_NAMES, setPalette, paletteMode, patterned, col, setTelegraphCues, telegraphCues, cue } from '../public/palette.js';
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
  // enum option: only an allowed string survives; palette and sound cue are off by default
  assert.equal(ACCESS_DEFAULTS.palette, 'off'); assert.equal(ACCESS_DEFAULTS.telegraphSound, false);
  assert.deepEqual(ENUMS.palette, PALETTE_MODES);
  assert.equal(normalizeAccess({ palette: 'deuter' }).palette, 'deuter');
  assert.equal(normalizeAccess({ palette: 'trit' }).palette, 'trit');
  assert.equal(normalizeAccess({ palette: 'rainbow' }).palette, 'off');
  assert.equal(normalizeAccess({ palette: 3 }).palette, 'off');
  assert.equal(normalizeAccess({ telegraphSound: true }).telegraphSound, true);
  // palette: 'off' is today's colours exactly; the other modes differ for every danger colour and add the dashed pattern
  const TODAY = { dangerEdge: 0xff2a2a, dangerFill: 0xff3b3b, dangerBase: 0x7f1d1d, dangerCloser: 0xffd0c0, sweepEdge: 0xf59e0b, sweepInner: 0xfde047,
    sweepFill: 0xfb923c, echoEdge: 0xc084fc, echoFill: 0xa855f7, trapVines: 0x65a30d, trapPillar: 0x38bdf8, trapCrystal: 0x67e8f9 };
  assert.deepEqual(PALETTE_NAMES.sort(), Object.keys(TODAY).sort());
  assert.equal(paletteMode(), 'off'); assert.equal(patterned(), false);
  for (const [k, v] of Object.entries(TODAY)) assert.equal(col(k), v, `${k} unchanged by default`);
  for (const mode of ['deuter', 'trit']) {
    setPalette(mode); assert.equal(paletteMode(), mode); assert.equal(patterned(), true);
    for (const k of ['dangerEdge', 'dangerFill', 'dangerBase', 'sweepEdge', 'sweepFill', 'echoEdge', 'echoFill']) assert.notEqual(col(k), TODAY[k], `${mode} ${k} differs`);
  }
  setPalette('bogus'); assert.equal(paletteMode(), 'off');
  assert.throws(() => col('nope'));
  // sound cue helper: silent unless on
  const played = []; const sfx = { play: (...a) => played.push(a) };
  cue(sfx, { x: 1, z: 2 }); assert.equal(played.length, 0);
  setTelegraphCues(true); assert.equal(telegraphCues(), true); cue(sfx, { x: 1, z: 2 }, 1.2);
  assert.deepEqual(played, [['cue', { x: 1, z: 2 }, 1.2]]);
  console.log('access: ok');
}
