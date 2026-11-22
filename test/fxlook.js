// The effects styles table (public/fxlook.js): every look is complete once merged over Classic, its numbers stay in the
// ranges the shaders and pools were built for, Classic is exactly what main draws, and an unknown id falls back to it.
// Usage: node test/fxlook.js
import { LOOKS, LOOK_IDS, FXL, setLook } from '../public/fxlook.js';
let n = 0, failed = 0;
const ok = (c, what) => { n++; console.log(`  ${c ? 'ok' : 'NOT OK'} ${n} - ${what}`); if (!c) failed++; };
const SECTS = ['bloom', 'grade', 'trail', 'spark', 'fx'];
const within = (v, a, b) => typeof v === 'number' && v >= a && v <= b;

const C = LOOKS.classic;
ok(JSON.stringify(C.bloom) === JSON.stringify({ threshold: 0.78, knee: 0.2, bright: 0.55, mask: 1.0, strength: 0.85, shoulder: 0.8, vignette: 0.16, levels: 4 }), 'Classic keeps main\'s bloom numbers');
ok(C.grade.sat === 1 && C.grade.contrast === 1 && C.grade.gain.every(v => v === 1) && C.grade.lift.every(v => v === 0), 'Classic has no colour grade');
ok(C.trail.life === 0.28 && C.trail.inner === 0.42 && C.trail.gain === 1 && C.trail.body === 0.22 && C.trail.tipPow === 2 && C.trail.edge === 0 && C.trail.white === 0.3 && !C.trail.tailMix && !C.trail.hue, 'Classic keeps main\'s trail');
ok(C.spark.n === 1 && C.spark.size === 1 && C.spark.speed === 1 && C.spark.life === 1 && C.spark.grav === 18 && C.spark.drag === 0.9 && C.spark.shape === 0 && C.spark.core === 0.5 && C.spark.flash === 1 && !C.spark.tintMix, 'Classic keeps main\'s sparks');
ok(C.fx.a === 1 && C.fx.white === 0.55 && C.fx.tall === 1 && C.fx.blade === 1 && C.fx.rocks === 1 && !C.fx.tintMix && !C.fx.vivid && !C.fx.solid && !C.fx.goldMix, 'Classic keeps main\'s skill effects (pure glow)');

for (const id of LOOK_IDS) {
  const L = setLook(id);
  ok(L.id === id && typeof LOOKS[id].name === 'string' && LOOKS[id].note.length > 10, `${id}: has a name and a note`);
  ok(SECTS.every(s => Object.keys(C[s]).every(k => L[s][k] !== undefined)), `${id}: every number is there once merged over Classic`);
  ok(SECTS.every(s => Object.keys(LOOKS[id][s] || {}).every(k => k in C[s])), `${id}: no unknown keys`);
  const { bloom: b, grade: g, trail: t, spark: s, fx } = L;
  ok(Number.isInteger(b.levels) && within(b.levels, 2, 4) && within(b.threshold, 0.4, 0.95) && within(b.strength, 0.3, 1.6) && within(b.shoulder, 0.5, 0.95) && within(b.vignette, 0, 0.4), `${id}: bloom in range (levels ${b.levels})`);
  ok(within(g.sat, 0.7, 1.4) && within(g.contrast, 0.85, 1.25) && g.gain.every(v => within(v, 0.8, 1.2)) && g.lift.every(v => within(v, 0, 0.06)), `${id}: grade in range`);
  ok(within(t.life, 0.12, 0.5) && within(t.inner, 0.1, 0.9) && within(t.gain, 0.5, 2.5) && within(t.tipPow, 0.5, 5) && within(t.body, 0, 1), `${id}: trail in range (life ${t.life} s: at 60 fps ${Math.ceil(t.life * 60)} of 32 points)`);
  ok(t.life * 60 <= 32, `${id}: the trail's life fits the ribbon's 32 points at 60 fps`);
  ok(within(s.n, 0.3, 2.5) && within(s.life, 0.5, 2) && within(s.shape, 0, 1) && within(s.grav, 0, 40) && within(s.drag, 0.7, 0.99), `${id}: sparks in range (x${s.n} of them)`);
  ok(within(fx.a, 0.5, 1.3) && within(fx.solid, 0, 1) && (fx.solid === 0 || fx.solid >= 0.3) && within(fx.rocks, 0.5, 2), `${id}: skill effects in range (${fx.solid ? 'paint ' + fx.solid : 'glow'})`);
}
ok(setLook('nope').id === 'classic' && FXL.bloom.strength === 0.85, 'an unknown look falls back to Classic');
const r = FXL.rev; setLook('ember');
ok(FXL.rev === r + 1 && FXL.fx.solid === 0.55, 'setLook bumps the revision (the modules re-read colours and blending)');
setLook('classic');
ok(FXL.fx.solid === 0 && FXL.trail.headMix === 0 && JSON.stringify(FXL.trail) === JSON.stringify(C.trail), 'going back to Classic clears what a look added');
console.log(failed ? `\n${failed} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
