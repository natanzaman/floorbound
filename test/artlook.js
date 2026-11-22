// The art styles tables (public/artlook.js): every character and world style is complete, its numbers stay in the
// ranges the materials and rigs were built for, Classic is exactly what main draws, and an unknown id falls back to it.
// Usage: node test/artlook.js
import { CHARS, ENVS, CHAR_IDS, ENV_IDS, ART, setArt, heightFactor, rigScale } from '../public/artlook.js';
let n = 0, failed = 0;
const ok = (c, what) => { n++; console.log(`  ${c ? 'ok' : 'NOT OK'} ${n} - ${what}`); if (!c) failed++; };
const within = (v, a, b) => typeof v === 'number' && v >= a && v <= b;

const C = CHARS.classic, E = ENVS.classic;
ok(C.toon === 0 && C.outline === 0 && C.rim === 0 && C.head === 0.8 && C.legs === 1 && C.arms === 1 && C.body === 1 && C.sat === 1 && C.legT === 1 && C.armT === 1 && C.torso === 1 && C.hands === 1 && C.feet === 1, 'Classic characters keep main\'s shading and proportions');
ok(E.toon === 0 && !E.smooth && E.trees === 'cone' && E.sky === null && !E.clouds && !E.tufts && !E.flowers && !E.patches && E.ground === 0x5f9a45, 'Classic world keeps main\'s scenery');
ok(E.atmos.sky === 0x9cc9ee && E.atmos.near === 70 && E.atmos.far === 230 && E.atmos.sunI === 1.9 && E.atmos.hemi === 1.1, 'Classic world keeps main\'s light and fog');
ok(ART.charId === 'classic' && ART.envId === 'classic' && heightFactor() === 1 && rigScale() === 1, 'the default is Classic, at main\'s height');

for (const id of CHAR_IDS) {
  const c = CHARS[id];
  ok(typeof c.name === 'string' && c.note.length > 10 && Object.keys(C).every(k => k in c) && Object.keys(c).every(k => k in C), `char ${id}: complete, no unknown keys`);
  ok([0, 2, 3, 4].includes(c.toon) && within(c.outline, 0, 0.02) && within(c.rim, 0, 0.6) && within(c.sat, 0.8, 1.3), `char ${id}: shading in range`);
  ok(within(c.head, 0.5, 0.9) && within(c.legs, 1, 2.5) && within(c.arms, 0.9, 1.5) && within(c.body, 0.7, 1.1) && within(c.torso, 1, 1.2), `char ${id}: lengths in range`);
  ok(within(c.legT, 0.8, 1.1) && within(c.armT, 0.8, 1.1) && within(c.hands, 0.7, 1) && within(c.feet, 0.7, 1) && within(c.tall, 0, 1), `char ${id}: thickness, hands and feet in range`);
  setArt(id, 'classic');
  ok(ART.char === c && within(heightFactor(), 1, 1.45) && within(rigScale(), 0.8, 1), `char ${id}: the rig grows by x${heightFactor().toFixed(2)}, drawn at x${(heightFactor() * rigScale()).toFixed(2)} of today's height`);
}
for (const id of ENV_IDS) {
  const e = ENVS[id];
  ok(typeof e.name === 'string' && e.note.length > 10 && Object.keys(E).every(k => k in e) && Object.keys(e).every(k => k in E), `world ${id}: complete, no unknown keys`);
  ok(['cone', 'layered', 'round'].includes(e.trees) && [0, 2, 3, 4].includes(e.toon) && e.leaf.length === 3 && e.leaf.every(v => within(v, 0, 1)), `world ${id}: trees and shading in range`);
  ok(within(e.clouds, 0, 60) && within(e.tufts, 0, 8000) && within(e.flowers, 0, 1500) && within(e.patches, 0, 1), `world ${id}: ground cover within the instance budgets`);
  ok(e.sky === null || ['top', 'horizon', 'sun'].every(k => Number.isInteger(e.sky[k])), `world ${id}: sky is flat or a full gradient`);
  ok(Object.keys(E.atmos).every(k => typeof e.atmos[k] === 'number') && e.atmos.near < e.atmos.far && within(e.atmos.sunI, 1, 3) && within(e.atmos.hemi, 0.5, 1.6), `world ${id}: light and fog complete`);
}
setArt('nope', 'nah');
ok(ART.charId === 'classic' && ART.envId === 'classic' && ART.char === C && ART.env === E, 'unknown ids fall back to Classic');
setArt('hero', 'dusk');
ok(ART.charId === 'hero' && ART.envId === 'dusk', 'a character style and a world style are picked independently');
setArt('classic', 'classic');
console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
