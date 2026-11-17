// Unit test for bot capability levels (shared/botskill.js): reaction delays, failure rates, Horn Sweep timing, rotations.
// Usage: node test/botskill.js
import { BOT_SKILLS, reaction, perceive, sweepError, skillReady, pressed, potionAt, aimNoise, setSkill, clampSkill } from '../shared/botskill.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const N = 20000;

ok(clampSkill(undefined) === 4 && clampSkill(9) === 4 && clampSkill('2') === 2, 'clampSkill: default 4, strings ok');

// ---- reactions per level ----
const rows = [];
for (const lvl of [5, 4, 3, 2, 1]) {
  const P = BOT_SKILLS[lvl];
  let fails = 0, drops = 0, sum = 0, cnt = 0, clean = 0, cleanN = 0;
  for (let i = 0; i < N; i++) {
    const r = reaction(lvl);
    if (r.fail) fails++;
    if (r.drop) { drops++; continue; }
    sum += r.delay; cnt++;
    if (!r.fail) { clean += r.delay; cleanN++; }
  }
  const failRate = fails / N, meanClean = cleanN ? clean / cleanN : 0;
  // Horn Sweep outcome from the timing error: perfect dodge if the roll lands <= 0.2 s before the hit (the bot rolls at
  // ~0.15 s + error), safe while the 0.42 s i-frames cover it.
  let perfect = 0, safe = 0;
  for (let i = 0; i < N; i++) { const e = sweepError({ skill: lvl }, {}); if (e >= 0 && 0.15 + e <= 0.2) perfect++; if (e >= 0 && 0.15 + e <= 0.42) safe++; }
  rows.push({ lvl, name: P.name, meanClean: meanClean.toFixed(3), failRate: failRate.toFixed(3), dropRate: (drops / N).toFixed(3), sweepPerfect: (perfect / N).toFixed(2), sweepSafe: (safe / N).toFixed(2) });
  const near = (v, want, tol) => Math.abs(v - want) <= tol;
  ok(meanClean >= P.react[0] - 1e-9 && meanClean <= P.react[1] + 1e-9 && near(meanClean, (P.react[0] + P.react[1]) / 2, 0.01), `L${lvl} ${P.name}: mean reaction ${meanClean.toFixed(3)} s within ${P.react.join('-')}`);
  ok(near(failRate, P.fail, 0.015), `L${lvl}: misjudged-telegraph rate ${failRate.toFixed(3)} ~ ${P.fail}`);
  ok(near(drops / N, P.fail / 2, 0.015), `L${lvl}: half the failures are missed entirely (${(drops / N).toFixed(3)})`);
}
console.table(rows);
const f = k => rows.map(r => +r[k]);
ok(f('meanClean').every((v, i, a) => i === 0 || v > a[i - 1]), 'reactions get slower from 5 to 1');
ok(f('failRate').every((v, i, a) => i === 0 || v > a[i - 1]), 'failure rate grows from 5 to 1');
ok(f('sweepPerfect').every((v, i, a) => i === 0 || v <= a[i - 1]) && rows[0].sweepPerfect === '1.00', 'perfect-dodge rate on the Horn Sweep: 100% at 5, falling with the level');
ok(+rows[1].meanClean >= 0.15 && +rows[1].meanClean <= 0.25 && +rows[1].failRate < 0.13, 'Skilled: ~0.15-0.25 s, ~10% misjudged');
ok(+rows[4].meanClean >= 0.6 && +rows[4].failRate > 0.5, 'Novice: 0.6 s+ reactions, mostly fails');

// ---- perceive(): level 5 passes events straight through; lower levels delay them and shorten `d` ----
const evs = [{ t: 'tele', x: 1, z: 2, r: 3, d: 1.0 }, { t: 'tp', id: 1, x: 0, z: 0, s: 1 }];
const b5 = { t: 0, skill: 5 };
ok(perceive(b5, evs) === evs, 'L5: events untouched (same array)');
let seen = 0, missed = 0, early = 0, dOk = true, tpNow = true;
for (let i = 0; i < 2000; i++) {
  const b = { t: 0, skill: 4 };
  const first = perceive(b, evs);
  if (!first.some(e => e.t === 'tp')) tpNow = false;
  if (first.some(e => e.t === 'tele')) early++;
  let got = null;
  for (let k = 1; k <= 30 && !got; k++) { b.t = k * 0.05; got = perceive(b, []).find(e => e.t === 'tele'); }
  if (!got) { missed++; continue; }
  seen++;
  if (!(got.d < 1.0 && got.d > 1.0 - 0.8)) dOk = false;
}
ok(tpNow && early === 0, 'L4: teleports are handled at once, telegraphs never instantly');
ok(Math.abs(missed / 2000 - 0.05) < 0.02, `L4: ~5% of telegraphs missed entirely (${missed / 2000})`);
ok(dOk, 'delayed telegraphs arrive with less time left (d shortened by the delay)');

// ---- rotations: Novice presses its skills seconds late; Perfect at once ----
const press = lvl => { const b = { t: 0, skill: lvl }; let k = 0; while (!skillReady(b, 3) && k < 400) { b.t += 0.05; k++; } pressed(b, 3); return b.t; };
const avg = lvl => { let s = 0; for (let i = 0; i < 300; i++) s += press(lvl); return s / 300; };
const a5 = avg(5), a4 = avg(4), a1 = avg(1);
ok(a5 === 0 && a4 > 0.1 && a4 < 0.6 && a1 > 2.4, `skill notice: L5 ${a5.toFixed(2)} s, L4 ${a4.toFixed(2)} s, L1 ${a1.toFixed(2)} s`);
const bb = { t: 0, skill: 1 };
ok(skillReady(bb, 0), 'Novice: the basic attack is pressed straight away (button-mashing)');
pressed(bb, 0);
ok(!skillReady(bb, 0), '...but not faster than its press gap');

// ---- potions, positioning ----
let forgot = 0;
for (let i = 0; i < 4000; i++) { const b = { t: 0, skill: 1 }; if (potionAt(b) === 0) forgot++; }
ok(Math.abs(forgot / 4000 - BOT_SKILLS[1].potForget) < 0.03 && potionAt({ t: 0, skill: 5 }) === 0.35, `potions: L1 forgets ${(forgot / 4000).toFixed(2)}, L5 drinks at 35%`);
const fighter = s => ({ t: 0, skill: s, x: 0, z: 0, mobs: [{ x: 3, z: 0 }] });
const [x5, z5] = aimNoise(fighter(5), 10, 10), [x1, z1] = aimNoise(fighter(1), 10, 10);
ok(x5 === 10 && z5 === 10 && Math.hypot(x1 - 10, z1 - 10) <= BOT_SKILLS[1].noise, 'positioning noise: none at 5, bounded at 1');
const live = { t: 0, skill: 4 };
setSkill(live, 2);
ok(live.skill === 2 && live.sk === null, 'setSkill changes the level live');

console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} botskill checks passed`);
process.exit(failed ? 1 : 0);
