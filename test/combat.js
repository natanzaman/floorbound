// In-process checks for the combat core: posture/break, perfect dodge + counter, Guardian guard/parry, Horn Sweep.
// Usage: node test/combat.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { DODGE, GUARD, PERFECT, POSTURE, SWEEP, SWITCH, angleTo } from '../shared/data.js';

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
// advance time, running scheduled callbacks (no AI, so mobs stay put)
function advance(dt) {
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
  }
}
const face = (p, m) => { p.face = angleTo(p.x, p.z, m.x, m.z); };
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

const wolf = g.addMob('wolf', 0, 70);
const sword = g.addPlayer(null, 'Kael', 'swordsman');
const tank = g.addPlayer(null, 'Brann', 'guardian');
for (const p of [sword, tank]) { p.x = 0; p.z = 67; }
face(sword, wolf); face(tank, wolf);
g.time = 10; clear();

// ---------- perfect dodge ----------
{
  wolf.posture = 0;
  g.dodge(sword, 0);
  advance(0.1); // the bite lands 0.1 s after the roll started
  const hp = sword.hp;
  g.damagePlayer(sword, 30, { src: 'wolf bite' });
  assert.equal(sword.hp, hp, 'no damage through i-frames');
  const pf = ev('perfect');
  assert.equal(pf.length, 1); assert.equal(pf[0].m, wolf.id);
  assert.ok(Math.abs(wolf.posture - g.postureCap(wolf) * POSTURE.perfect[0]) < 1e-6, 'perfect dodge posture chunk');
  assert.ok(sword.counterUntil > g.time && sword.counterUntil <= g.time + PERFECT.counter + 1e-9);
  ok('roll 0.1 s before the hit = perfect dodge, posture chunk, counter window');

  g.damagePlayer(sword, 30, { src: 'wolf bite' }); // a second hit during the same roll: evaded, not another perfect
  assert.equal(ev('perfect').length, 1); assert.equal(ev('evade').length, 1);
  ok('only one perfect per roll');

  // counter: next hit +50% damage and double posture
  const before = wolf.posture, hp0 = wolf.hp;
  sword.crit = 0; Math.random = () => 0.5; // no crit, no damage variance
  g.damageMob(wolf, sword, 10, {});
  assert.equal(hp0 - wolf.hp, 15, '+50% damage');
  assert.ok(wolf.dead || wolf.staggerUntil > g.time || Math.abs(wolf.posture - before - 15 * PERFECT.posture) < 1e-6, 'double posture');
  assert.equal(ev('counter').length, 1);
  g.damageMob(wolf, sword, 10, {}); // same instant (e.g. one swing hitting several enemies): still a counter
  assert.equal(hp0 - 15 - wolf.hp, 15);
  advance(0.05);
  g.damageMob(wolf, sword, 10, {});
  assert.equal(hp0 - 30 - wolf.hp, 10, 'counter used up');
  ok('counter hit: +50% damage, double posture, then consumed');
}

// ---------- late roll: not perfect ----------
{
  advance(DODGE.cd + 0.1); clear();
  g.dodge(sword, 0);
  advance(0.3);
  const hp = sword.hp;
  g.damagePlayer(sword, 30, { src: 'wolf bite' });
  assert.equal(sword.hp, hp);
  assert.equal(ev('perfect').length, 0); assert.equal(ev('evade').length, 1);
  ok('roll 0.3 s before the hit = plain evade (no perfect)');
}

// ---------- posture fills -> BROKEN, resets, decays ----------
{
  advance(1); clear();
  const m = g.addMob('wolf', 6, 72), cap = g.postureCap(m);
  m.hp = 1e6; // keep it alive
  let hits = 0;
  while (!(m.staggerUntil > g.time) && hits < 100) { g.damageMob(m, sword, 10, {}); hits++; }
  const st = ev('stagger');
  assert.equal(st.length, 1); assert.equal(st[0].by, sword.id); assert.equal(m.staggerBy, sword.id);
  assert.equal(m.posture, 0, 'posture resets on break');
  assert.equal(hits, Math.ceil(cap / 10));
  ok(`posture ${cap} on a Dire Wolf: broken after ${hits} plain hits of 10, posture reset`);

  // Switch rules are unchanged: first teammate hit 2.5x, then 1.4x
  const hp = m.hp; tank.swPow = 0; tank.crit = 0;
  g.damageMob(m, tank, 10, {}); assert.equal(hp - m.hp, 10 * SWITCH.first);
  g.damageMob(m, tank, 10, {}); assert.equal(hp - m.hp, 10 * SWITCH.first + 10 * SWITCH.follow);
  assert.equal(m.posture, 0, 'no posture while broken');
  ok('Switch 2.5x then 1.4x on a broken enemy; posture frozen while broken');

  advance(SWITCH.window + 0.1);
  g.damageMob(m, sword, 10, { heavy: true });
  assert.equal(m.posture, 10 * POSTURE.heavy, 'heavy hits fill 2x');
  m.posture = 0;
  g.damageMob(m, sword, 10, { brk: true });
  assert.ok(Math.abs(m.posture - (10 + cap * POSTURE.brk[0])) < 1e-6, 'break skills fill a big chunk');
  const p0 = m.posture;
  for (let i = 0; i < 10; i++) { advance(0.2); g.updateCombat(0.2); }
  assert.equal(m.posture, p0, 'no decay within 2.5 s');
  advance(0.6); g.updateCombat(1);
  assert.ok(m.posture < p0, 'decays after 2.5 s');
  ok('heavy = 2x, break skills = big chunk, decay only after 2.5 s');
}

// ---------- Smite mid wind-up ----------
{
  advance(3); clear();
  const cleric = g.addPlayer(null, 'Lyra', 'cleric');
  cleric.x = 0; cleric.z = 62;
  const m = g.addMob('wolf', 0, 66); m.hp = 1e6; m.windupAt = g.time + 0.3;
  face(cleric, m); cleric.crit = 0;
  g.useSkill(cleric, 0, cleric.face);
  assert.equal(m.windupAt, 0, 'interrupted');
  assert.ok(m.posture >= g.postureCap(m) * POSTURE.smite[0]);
  ok('Smite mid wind-up interrupts and fills a big chunk of posture');
  g.removePlayer(cleric);
}

// ---------- Guardian guard / parry ----------
{
  advance(2); clear();
  const m = g.addMob('wolf', 0, 70.5); m.hp = 1e6;
  tank.x = 0; tank.z = 67; face(tank, m); tank.hp = tank.maxHp; tank.dr = { until: 0, v: 0 }; tank.gearDr = 0;
  g.guard(tank, true);
  advance(0.1);
  g.damagePlayer(tank, 40, { src: 'wolf bite', mob: m });
  assert.equal(tank.hp, tank.maxHp, 'parried: no damage');
  assert.equal(ev('parry').length, 1);
  assert.ok(m.posture >= g.postureCap(m) * POSTURE.parry[0] - 1e-6 || m.staggerUntil > g.time, 'parry posture chunk');
  ok('guard pressed 0.1 s before a frontal hit = PARRY (negated, posture chunk)');

  advance(0.4);
  g.damagePlayer(tank, 40, { src: 'wolf bite', mob: m });
  assert.equal(tank.maxHp - tank.hp, Math.round(40 * (1 - GUARD.dr)), 'guarded: -70%');
  ok('holding guard: frontal hit takes 70% less');

  tank.face += Math.PI; tank.hp = tank.maxHp;
  g.damagePlayer(tank, 40, { src: 'wolf bite', mob: m });
  assert.equal(tank.maxHp - tank.hp, 40, 'from behind: full damage');
  ok('guard does nothing against hits from behind');
  face(tank, m);

  // mashing R: a re-press within GUARD.repress doesn't open a new parry window
  g.guard(tank, false); g.guard(tank, true); clear();
  advance(0.05); tank.hp = tank.maxHp;
  g.damagePlayer(tank, 40, { src: 'wolf bite', mob: m });
  assert.equal(ev('parry').length, 0); assert.equal(tank.maxHp - tank.hp, 12);
  ok('mashing guard does not parry');

  // a guarding Guardian can't attack
  const cd = tank.cds[0];
  g.useSkill(tank, 0, tank.face);
  assert.equal(tank.cds[0], cd);
  g.guard(tank, false);
  ok('no attacks while guarding');

  // non-Guardians can't guard
  g.guard(sword, true);
  assert.ok(!sword.guarding);
  ok('non-Guardian guard is ignored');
}

// ---------- Horn Sweep (perilous) ----------
{
  advance(1); clear();
  const b = g.boss; b.engaged = true; b.threat.set(sword.id, 1);
  const place = (p, d) => { p.x = b.x; p.z = b.z - d; p.hp = p.maxHp; p.dr = { until: g.time + 99, v: 0.6 }; face(p, b); };
  place(sword, 4); place(tank, 5);
  const far = g.addPlayer(null, 'Far', 'cleric'); place(far, SWEEP.r + 3);
  g.jump(sword); // jumping does not help
  g.guard(tank, true); // hold guard (but too early to parry)
  advance(0.5);
  g.hornSweep(b);
  assert.equal(ev('tele').filter(e => e.k === 'sweep').length, 1);
  advance(SWEEP.wind - 0.2);
  advance(0.25);
  assert.equal(sword.maxHp - sword.hp, Math.round(sword.maxHp * SWEEP.frac), 'jump + Shield Wall do not reduce it');
  assert.equal(tank.maxHp - tank.hp, Math.round(tank.maxHp * SWEEP.frac), 'held guard does not reduce it');
  assert.equal(far.hp, far.maxHp, 'out of range');
  const d = g.events.concat(events).find(e => e.t === 'pdie');
  assert.ok(!d);
  ok('Horn Sweep: 80% max HP through jump / Shield Wall / held guard; out of range is safe');

  // dodge or parry it
  g.guard(tank, false); advance(1); clear();
  place(sword, 4); place(tank, 5);
  b.busyUntil = 0; b.posture = 0;
  g.hornSweep(b);
  advance(SWEEP.wind - 0.15);
  g.dodge(sword, 0); g.guard(tank, true);
  advance(0.2);
  assert.equal(sword.hp, sword.maxHp); assert.equal(tank.hp, tank.maxHp);
  assert.equal(ev('perfect').length, 1); assert.equal(ev('parry').length, 1);
  assert.ok(b.posture > 0 || b.staggerUntil > g.time);
  ok('Horn Sweep: perfect dodge and parry both avoid it and hurt the Warden\'s posture');

  // breaking the Warden during the wind-up cancels the sweep
  g.guard(tank, false); advance(1); clear();
  place(sword, 4); b.busyUntil = 0; b.staggerUntil = 0;
  g.hornSweep(b);
  advance(0.3);
  g.breakMob(b, tank);
  advance(1);
  assert.equal(sword.hp, sword.maxHp); assert.equal(ev('pcancel').length, 1);
  ok('breaking the Warden mid wind-up cancels the Horn Sweep');

  // snapshot carries posture as the 9th mob field
  b.posture = g.postureCap(b) / 2;
  const snap = JSON.parse(g.snapshot());
  const row = snap.mobs.find(r => r[0] === b.id);
  assert.equal(row.length, 9); assert.equal(row[8], 50);
  ok('snapshot mob rows carry posture (0-100) as the 9th field');
}
console.log(`all ${n} checks passed`);
process.exit(0);
