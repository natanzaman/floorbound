// The obstacle grid in shared/data.js resolveCollision gives exactly the old full scan's result, and is faster.
// Usage: node test/collision.js
import { OBSTACLES, resolveCollision } from '../shared/data.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
function full(x, z, rad) { // the old resolveCollision (OBSTACLES only)
  for (const o of OBSTACLES) {
    const dx = x - o.x, dz = z - o.z, m = o.r + rad;
    if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
    const d = Math.hypot(dx, dz);
    if (d < m && d > 1e-4) { x = o.x + (dx / d) * m; z = o.z + (dz / d) * m; }
  }
  return [x, z];
}
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let bad = 0, tries = 0;
for (const o of OBSTACLES) for (let k = 0; k < 100; k++) {
  const rad = [0.4, 0.5, 1, 2.4, 3.5][k % 5], x = o.x + (rnd() - 0.5) * 14, z = o.z + (rnd() - 0.5) * 14;
  const a = full(x, z, rad), b = resolveCollision(x, z, rad); tries++;
  if (a[0] !== b[0] || a[1] !== b[1]) bad++;
}
ok(bad === 0, `same result as the full scan around every obstacle (${tries} points, ${bad} differ)`);
const pts = Array.from({ length: 50000 }, () => [rnd() * 1300 - 100, rnd() * 500 - 150]);
let t = performance.now(); for (const [x, z] of pts) full(x, z, 0.5); const tf = performance.now() - t;
t = performance.now(); for (const [x, z] of pts) resolveCollision(x, z, 0.5); const tg = performance.now() - t;
ok(tg < tf, `faster (${(tf / pts.length * 1000).toFixed(2)} → ${(tg / pts.length * 1000).toFixed(2)} µs a call, ${OBSTACLES.length} obstacles)`);
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n}/${n} passed`);
process.exit(failed ? 1 : 0);
