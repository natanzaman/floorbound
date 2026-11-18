// In-process checks for ability pacing (PACE in shared/data.js, server/pacing.js): slower use times and boss wind-ups,
// and a skill's cooldown starting when its last own hit lands.
// Usage: node test/pacing.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { CLASSES, PACE, paced, paceMoves, WARDEN, SWEEP, angleTo } from '../shared/data.js';
import { SOVEREIGN } from '../shared/floor2.js';
import { MASTERY } from '../shared/mastery.js';
import { RANGER_TUNE as RT } from '../shared/classes/ranger.js';
import { LANCE } from '../shared/classes/lancer.js';

Math.random = () => 0.5; // no crits, no damage variance

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = (t, f = () => true) => { flush(); return events.filter(e => e.t === t && f(e)); };
const clear = () => { flush(); events = []; };
function advance(dt) { // scheduled callbacks only (no AI, so mobs stay put)
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// ---------- the knob and the boss tables ----------
{
  assert.equal(PACE, 1.3);
  assert.equal(paced(0.2), 0.26); assert.equal(paced(1), 1.3); assert.equal(paced(0.45), 0.585);
  // WARDEN slam (base wind 1.6, every [6.5, 5, 3.75]): wind x PACE, every + the extra wind-up
  near(WARDEN.slam.wind, 1.6 * PACE, 'slam wind');
  const extra = WARDEN.slam.wind - 1.6;
  [6.5, 5, 3.75].forEach((e, i) => near(WARDEN.slam.every[i], e + extra, `slam every[${i}]`));
  near(WARDEN.charge.wind, paced(1.5), 'charge wind'); near(WARDEN.charge.every, 9.5 + paced(1.5) - 1.5, 'charge every');
  near(WARDEN.cleave.wind, paced(0.75), 'cleave wind');
  near(WARDEN.quake.gap, paced(0.95), 'quake gap'); assert.deepEqual(WARDEN.quake.first, [9, 5, 4], 'first timers unchanged');
  near(SWEEP.wind, paced(1.2), 'sweep wind'); near(SWEEP.every[2], 7.5 + paced(1.2) - 1.2, 'sweep every'); assert.equal(SWEEP.first, 9);
  near(SOVEREIGN.wave.wind, paced(2.3), 'wave wind'); assert.equal(SOVEREIGN.wave.every[0], 0, 'a move not in a phase stays off');
  near(SOVEREIGN.wave.every[1], 15 + paced(2.3) - 2.3, 'wave every'); near(SOVEREIGN.sweep.wind, paced(1.1), 'sovereign sweep');
  assert.equal(WARDEN.hounds.every, 24, 'moves without a wind-up are untouched');
  // pacing a table twice does nothing more
  const w = WARDEN.slam.wind; paceMoves(WARDEN); assert.equal(WARDEN.slam.wind, w);
  ok('PACE / paced; Warden, Horn Sweep and Sovereign wind-ups x PACE, repeats grow by the extra wind-up, first unchanged');
}

// ---------- player cooldowns start when the skill finishes ----------
const sword = g.addPlayer(null, 'Kael', 'swordsman');
const ranger = g.addPlayer(null, 'Sylas', 'ranger');
const lancer = g.addPlayer(null, 'Vex', 'lancer');
const all = [sword, ranger, lancer];
for (const p of all) { p.lvl = 10; g.recompute(p); p.hp = p.maxHp; }
g.mobs.clear();
g.time = 100;
const slotOf = (p, id) => CLASSES[p.cls].skills.findIndex(s => s.id === id);
function reset() {
  g.scheduled = [];
  for (const p of all) Object.assign(p, { x: 0, z: 70, face: 0, dead: false, cds: [0, 0, 0, 0], combo: 0, lastBasic: -9, mastery: {} });
  g.time += 30; clear();
}
// use a skill; returns [press time, its cooldown as skillCd computes it]
function use(p, id) {
  const slot = slotOf(p, id), sk = CLASSES[p.cls].skills[slot], t = g.time, cd = g.skillCd(p, sk, slot);
  g.useSkill(p, slot, p.face);
  return [t, cd, slot];
}

{
  reset();
  const [t, cd, slot] = use(sword, 'burst');
  near(sword.cds[slot], t + 3 * paced(0.2) + cd, 'Burst Combo: cd after the 4th hit');
  advance(3 * paced(0.2) + 0.05);
  assert.equal(ev('fx', e => e.s === 'burst').length, 4, 'all four hits played');
  ok('Burst Combo: hits are 0.2 s apart x PACE and its cooldown starts after the last hit');
}
{
  reset();
  const [t, cd, slot] = use(sword, 'whirl');
  near(sword.cds[slot], t + cd, 'instant Whirl');
  reset();
  const [t0, cd0] = use(sword, 'slash');
  near(sword.cds[0], t0 + cd0, 'basic attack');
  ok('instant skills and basic attacks: cooldown unchanged (press + cd)');
}
{
  reset();
  const [t, cd, slot] = use(ranger, 'pierce');
  near(ranger.cds[slot], t + paced(RT.pierce.draw) + cd, 'Piercing Shot: cd after the draw');
  assert.equal(ev('fx', e => e.k === 'ca' && e.v === 'draw')[0]?.d, Math.round(paced(RT.pierce.draw) * 100) / 100, 'the draw event carries the paced draw');
  ok('Piercing Shot (classes-a): draw x PACE, cooldown starts on the loose');
}
{
  reset(); ranger.mastery.pierce = { pts: MASTERY.need[3], br: 'A' }; // Rain of Arrows
  const [t, cd, slot] = use(ranger, 'pierce');
  near(ranger.cds[slot], t + cd, 'Rain of Arrows: the falling rain is not use time');
  const due = g.scheduled.map(s => s.at - t).sort((a, b) => a - b);
  assert.equal(due.length, RT.rain.ticks, 'rain ticks still scheduled');
  near(due[0], paced(RT.rain.delay), 'first rain tick'); near(due[1] - due[0], paced(RT.rain.every), 'rain tick spacing');
  ok('Rain of Arrows: rain ticks paced but lingering, so the cooldown starts on the press');
}
{
  reset();
  const [t, cd, slot] = use(lancer, 'skylance');
  near(lancer.cds[slot], t + paced(LANCE.sky.air) + cd, 'Sky Lance: cd after the landing');
  near(lancer.airUntil, t + paced(LANCE.sky.air), 'airborne for the paced leap');
  ok('Sky Lance (classes-b): air time x PACE, cooldown starts on landing');
}

// ---------- the Warden's basic swing keeps its rest ----------
{
  reset();
  const b = g.boss;
  sword.x = b.x; sword.z = b.z - 3; sword.face = angleTo(sword.x, sword.z, b.x, b.z);
  b.threat.set(sword.id, 1); b.atkT = 0; b.windupAt = 0; b.busyUntil = 0; b.stunUntil = 0;
  const t = g.time;
  g.updateMob(b, 0.05);
  const wind = (g.twistW || WARDEN).cleave.wind;
  near(b.windupAt, t + wind, 'cleave wind-up');
  near(b.atkT, t + b.def.atkCd + wind - wind / PACE, 'next swing waits the extra wind-up too');
  ok('Warden cleave: paced wind-up, the next swing is pushed back by the extra wind-up');
}

console.log(`pacing: ${n} checks passed`);
process.exit(0);
