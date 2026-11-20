// Targeting modes and cleave (shared/targeting.js, server/targeting.js): the pure picker for all four modes (cone edge,
// a lock behind you, a far lock), the cleave cap, settings cleaning; then in-process server checks: cleave on / off /
// capped, per-skill limits, bots unchanged, aimed straight-line arrows (no homing, walk-in hits, padded hitbox), the
// lock preference in the Ranger's server aim, aimed marks.
// Usage: node test/targeting.js
import assert from 'node:assert/strict';
import { pickTarget, capTargets, cleanPrefs, inCone, rayPick, attackFov, ATTACKS, CONE_HALF, DEFAULT_PREFS, AIM_PAD } from '../shared/targeting.js';
import { cleanControls, combatSetting } from '../shared/controls.js';
import { Game } from '../server/game.js';
import { CLASSES } from '../shared/data.js';
import { newMastery } from '../shared/mastery.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const mob = (id, x, z, r = 0.8) => ({ id, x, z, def: { radius: r } });

// ---------- pure: pickTarget ----------
{
  const me = { x: 0, z: 0 }; // facing / looking north (+z, angle 0)
  const near = mob(1, 0, -2); // behind you, close
  const front = mob(2, 0.5, 6); // in front, further
  const side = mob(3, 5, 0.2); // beside you (90°)
  const far = mob(4, 0, 30); // locked, far in front
  const mobs = [near, front, side, far];
  const pick = (mode, o = {}) => pickTarget({ mode, ...me, front: 0, mobs, range: 12, ...o });

  assert.equal(pick('nearest'), near, 'nearest: the nearest, behind or not');
  assert.equal(pick('nearest', { lock: far }), near, 'nearest: ignores the lock');
  assert.equal(pick('lock', { lock: far }), far, 'lock: the locked target however far (no 14 m cutoff)');
  assert.equal(pick('lock'), near, 'lock: nothing locked = the nearest');
  assert.equal(pick('lock', { lock: mob(5, 0, 60) }), near, 'lock: past the lock range = the nearest');
  assert.equal(pick('lock', { lock: far, canTarget: m => m !== far }), near, 'lock: a dead / hidden lock is skipped');
  assert.equal(pick('cone'), front, 'cone: never the one behind you');
  assert.equal(pick('cone', { lock: far }), far, 'cone: a lock inside the cone wins over a nearer one');
  assert.equal(pick('cone', { lock: near }), front, 'cone: a lock behind you is ignored (nearest in the cone)');
  assert.equal(pick('cone', { mobs: [near, side] }), null, 'cone: nothing in the cone = no target (attack forward)');
  assert.equal(pick('aimed', { lock: far }), null, 'aimed: never picks');
  ok('pickTarget: nearest, locked or nearest, cone, aimed');

  // the cone edge (60° either side), for a point-sized enemy and for a big one
  const at = deg => mob(9, Math.sin((deg * Math.PI) / 180) * 5, Math.cos((deg * Math.PI) / 180) * 5, 0);
  assert.ok(inCone(0, 0, 0, at(59), CONE_HALF) && inCone(0, 0, 0, at(-59), CONE_HALF), '59° is inside');
  assert.ok(!inCone(0, 0, 0, at(61), CONE_HALF) && !inCone(0, 0, 0, at(-61), CONE_HALF), '61° is outside');
  assert.equal(pick('cone', { mobs: [at(61)] }), null);
  assert.equal(pick('cone', { mobs: [at(59)] })?.id, 9);
  const big = { ...at(65), def: { radius: 1 } }; // its body reaches into the cone
  assert.ok(inCone(0, 0, 0, big, CONE_HALF), 'a big enemy counts once part of it is inside');
  assert.equal(pick('cone', { front: Math.PI, mobs }), near, 'cone follows where you look (turned round: the one behind)');
  ok('cone edge at 60°, big enemies, the cone follows the look direction');
}

// ---------- pure: capTargets, rayPick, cleanPrefs, attackFov ----------
{
  const a = mob(1, 0, 1), b = mob(2, 0, 2), c = mob(3, 0, 3), d = mob(4, 0, 4);
  assert.deepEqual(capTargets([d, b, a, c], { x: 0, z: 0, n: 2 }), [a, b], 'cap: the nearest first');
  assert.deepEqual(capTargets([d, b, a, c], { x: 0, z: 0, n: 2, lock: d }), [d, a], 'cap: the lock first, then the nearest');
  assert.deepEqual(capTargets([d, b, a, c], { x: 0, z: 0, n: 1, lock: c }), [c], 'cleave off: the lock');
  assert.deepEqual(capTargets([b, a], { x: 0, z: 0, n: 8 }), [b, a], 'under the cap: unchanged');
  ok('capTargets: lock first, then nearest, at most n');

  const line = [mob(1, 2.5, 4), mob(2, 0.3, 9), mob(3, 0, 20)];
  assert.equal(rayPick({ x: 0, z: 0, a: 0, mobs: line, range: 15 })?.id, 2, 'the first on the line, not the nearest beside it');
  assert.equal(rayPick({ x: 0, z: 0, a: 0, mobs: [line[2]], range: 15 }), null, 'out of range');
  assert.equal(rayPick({ x: 0, z: 0, a: 0, mobs: [mob(4, 0.8 + AIM_PAD - 0.05, 5)], range: 15 })?.id, 4, 'padded hitbox');
  ok('rayPick: first enemy along the aim line, padded');

  assert.deepEqual(cleanPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(DEFAULT_PREFS, { mode: 'lock', cleave: true, max: 8 });
  assert.deepEqual(cleanPrefs({ mode: 'cone', cleave: false, max: 3 }), { mode: 'cone', cleave: false, max: 3 });
  assert.deepEqual(cleanPrefs({ target: 'aimed', cleave: 0, max: 99 }), { mode: 'aimed', cleave: false, max: 8 });
  assert.deepEqual(cleanPrefs({ mode: '__proto__', cleave: 'yes', max: -4 }), { mode: 'lock', cleave: true, max: 1 });
  assert.deepEqual(cleanPrefs({ max: 'x' }).max, 8);
  const cc = cleanControls({ v: 1, combat: { target: 'cone', cleave: false, max: 2, junk: 1 } });
  assert.deepEqual(cc.combat, { target: 'cone', cleave: false, max: 2 }, 'saved and synced as { target, cleave, max }');
  assert.deepEqual(cleanControls({ v: 1, combat: 'bad' }).combat, combatSetting({}), 'a bad save falls back to the defaults');
  assert.equal(cleanControls({ v: 1 }).combat, undefined, 'no combat key: none added');
  ok('settings: cleaned, clamped, defaults Locked or nearest / cleave on / 8');

  assert.equal(attackFov('slash').half, 1.05, 'base field of view = the old hitArc half-angle');
  assert.equal(attackFov('slash', { fov: 1.5 }).half, 1.05 * 1.5, 'a weapon widens it');
  assert.equal(attackFov('cleave', { fov: 9, over: { r: 4.2, half: 1.6 } }).half, Math.PI, 'never past a full circle');
  for (const [k, A] of Object.entries(ATTACKS)) assert.ok(A.aoe || A.n >= 3, `${k}: a target limit`);
  ok('attack field of view and target limits: table, weapon multiplier');
}

// ---------- server ----------
Math.random = () => 0.5; // no crits
const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = (t, f = () => true) => { flush(); return events.filter(e => e.t === t && f(e)); };
const clear = () => { flush(); events = []; };
function advance(dt) {
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    const step = Math.min(0.05, end - g.time);
    g.time += step;
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateClassesA(step);
  }
}
g.mobs.clear(); g.boss = null;
const sword = g.addPlayer(null, 'Kael', 'swordsman');
const ranger = g.addPlayer(null, 'Sylas', 'ranger');
const cleric = g.addPlayer(null, 'Mira', 'cleric');
const all = [sword, ranger, cleric];
for (const p of all) { p.lvl = 10; g.recompute(p); }
g.time = 100;
const X = 0, Z = 70;
function reset() {
  for (const m of g.mobs.values()) g.mobs.delete(m.id);
  g.scheduled = []; g.arrowList = [];
  for (const p of all) {
    Object.assign(p, { x: X, z: Z, face: 0, dead: false, cds: [0, 0, 0, 0], combo: 0, lastBasic: -9, target: 0, tprefs: null });
    p.hp = p.maxHp; p.mastery = newMastery({}, p.cls);
  }
  g.time += 30; clear();
}
function wolf(x, z) { const m = g.addMob('wolf', X + x, Z + z); m.hp = m.maxHp = 50000; return m; }
const slotOf = (p, sk) => CLASSES[p.cls].skills.findIndex(s => s.id === sk);
const use = (p, sk) => g.useSkill(p, slotOf(p, sk), p.face);
const hitIds = by => new Set(ev('hit', e => e.by === by.id).map(e => e.id));
const prefs = (p, o) => g.handle(p, { type: 'tprefs', ...o });
const fan = k => Array.from({ length: k }, (_, i) => wolf(Math.sin(-0.8 + (1.6 * i) / Math.max(1, k - 1)) * 2.4, Math.cos(-0.8 + (1.6 * i) / Math.max(1, k - 1)) * 2.4));

// cleave on / off / capped, the skill's own limit, bots unchanged
{
  reset(); const w = fan(3);
  prefs(sword, { mode: 'lock', cleave: true, max: 8 }); use(sword, 'slash');
  assert.equal(hitIds(sword).size, 3, 'cleave on: every enemy in the swing');

  reset(); const w2 = fan(3);
  prefs(sword, { mode: 'lock', cleave: false, max: 8 }); sword.target = w2[2].id; use(sword, 'slash');
  assert.deepEqual([...hitIds(sword)], [w2[2].id], 'cleave off: only the locked one');

  reset(); const w3 = [wolf(0.3, 2.6), wolf(-0.6, 1.6), wolf(1.2, 2.2)];
  prefs(sword, { cleave: false }); g.handle(sword, { type: 'target', id: 9999 }); use(sword, 'slash');
  assert.deepEqual([...hitIds(sword)], [w3[1].id], 'cleave off, no lock in the arc: the nearest');

  reset(); fan(5); prefs(sword, { cleave: true, max: 2 }); use(sword, 'slash');
  assert.equal(hitIds(sword).size, 2, 'max targets caps it');

  reset(); fan(7); prefs(sword, { cleave: true, max: 8 }); use(sword, 'slash');
  assert.equal(hitIds(sword).size, ATTACKS.slash.n, "the basic swing's own limit (4) under max 8");

  reset(); fan(7); use(sword, 'slash'); // a bot: never sends tprefs
  assert.equal(sword.tprefs, null);
  assert.equal(hitIds(sword).size, 7, 'bots (no prefs): unchanged, every enemy in the swing');

  prefs(sword, { mode: 'nonsense', cleave: 'x', max: 1e9 });
  assert.deepEqual(sword.tprefs, { mode: 'lock', cleave: true, max: 8 }, 'the message is validated');
  ok('cleave: on hits all in the swing, off hits the lock or the nearest, max and skill limits cap it, bots unchanged');
}

// aimed: arrows fly straight (no homing, no auto-aim), hit whatever walks into the line; padded hitbox
{
  reset(); const off = wolf(2.2, 12); // 10° off your aim: inside the bow's auto-aim cone
  use(ranger, 'shot'); advance(1);
  assert.ok(hitIds(ranger).has(off.id), 'a bot / default player: the arrow turns onto it');

  reset(); const off2 = wolf(2.2, 12);
  prefs(ranger, { mode: 'aimed' }); use(ranger, 'shot');
  const pr = ev('aproj')[0];
  assert.equal(pr.tg, 0, 'aimed: no homing target'); assert.equal(pr.a, 0, 'aimed: flies along the aim');
  advance(1);
  assert.equal(hitIds(ranger).size, 0, 'aimed: the arrow misses an enemy off the line');
  assert.ok(Math.abs(ranger.face) < 1e-9, 'aimed: never turned');
  void off2;

  reset(); const walker = wolf(3, 10);
  prefs(ranger, { mode: 'aimed' }); use(ranger, 'shot');
  advance(0.1); walker.x = X + 0.2; // walks into the line before the arrow gets there
  advance(1);
  assert.ok(hitIds(ranger).has(walker.id), 'aimed: an enemy that walks into the line is hit');

  // Smite flies straight in every mode; aimed gives it a slightly bigger hitbox
  reset(); wolf(2.15, 6); use(cleric, 'smite');
  assert.equal(hitIds(cleric).size, 0, 'smite just past its old hitbox: a miss');
  reset(); const edge = wolf(2.15, 6); prefs(cleric, { mode: 'aimed' }); use(cleric, 'smite');
  assert.ok(hitIds(cleric).has(edge.id), 'aimed: the padded bolt hits it');
  ok('aimed: straight arrows with no homing, walk-in hits, padded bolt hitbox');
}

// the lock is respected by the Ranger's server aim (a nearer enemy slightly off-axis used to win)
{
  reset(); const far = wolf(0, 18), near = wolf(0.6, 6);
  ranger.target = far.id; use(ranger, 'shot'); // a bot / no prefs: the old pick
  assert.equal(ev('aproj')[0].tg, near.id, 'no prefs: the old best-in-cone pick (the nearer one)');
  reset(); const far2 = wolf(0, 18); wolf(0.6, 6);
  prefs(ranger, { mode: 'lock' }); ranger.target = far2.id; use(ranger, 'shot');
  assert.equal(ev('aproj')[0].tg, far2.id, 'Locked or nearest: the arrow goes to the locked one');
  reset(); const behind = wolf(0, -8), front = wolf(0.6, 6);
  prefs(ranger, { mode: 'cone' }); ranger.target = behind.id; use(ranger, 'shot');
  assert.equal(ev('aproj')[0].tg, front.id, 'Cone: a lock behind you is not shot at');
  ok('server aim: the lock wins in Locked or nearest / Cone when it is in range and in the cone');
}

// aimed marks take the enemy on the aim line, out to the mark's full range; Cone keeps pickFront in the cone
{
  reset(); const beside = wolf(3, 2), onLine = wolf(0.2, 16);
  prefs(ranger, { mode: 'aimed' }); use(ranger, 'mark');
  assert.ok(onLine.markA && !beside.markA, 'aimed: the mark lands on the enemy you aim at');
  reset(); const side = wolf(4, 0.5);
  prefs(ranger, { mode: 'cone' }); use(ranger, 'mark');
  assert.ok(!side.markA && ev('sys').some(e => /No enemy/.test(e.text)), 'Cone: nothing beside you gets marked');
  reset(); const side2 = wolf(4, 0.5); use(ranger, 'mark');
  assert.ok(side2.markA, 'no prefs: the old pick (anything close by)');
  ok('marks: aimed along the line, cone stays in the cone, bots unchanged');
}

console.log(`targeting: all ${n} checks passed`);
