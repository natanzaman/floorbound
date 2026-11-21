// Targeting modes and cleave (shared/targeting.js, server/targeting.js): the pure picker for all four modes (cone edge,
// a lock behind you, a far lock), the cleave cap, settings cleaning; then in-process server checks: cleave on / off /
// capped, per-skill limits, bots unchanged, aimed straight-line arrows (no homing, walk-in hits, padded hitbox), the
// lock preference in the Ranger's server aim, aimed marks; weapon styles' fov (mods.fov) on the hit arc.
// Usage: node test/targeting.js
import assert from 'node:assert/strict';
import { pickTarget, crosshairPick, capTargets, cleanPrefs, inCone, rayPick, attackFov, ATTACKS, CONE_HALF, DEFAULT_PREFS, AIM_PAD } from '../shared/targeting.js';
import { cleanControls, combatSetting } from '../shared/controls.js';
import { Game } from '../server/game.js';
import { CLASSES } from '../shared/data.js';
import { newMastery } from '../shared/mastery.js';
import { STYLES, STYLE_IDS } from '../shared/styles.js';

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
  assert.equal(pick('lock', { lock: far, range: 26 }), far, 'lock: a bow turns to the locked target 30 m away (range + 4)');
  assert.equal(pick('lock', { lock: far }), near, 'lock: a 12 m skill does not spin to a lock 30 m away (max(14, range + 4))');
  assert.equal(pick('lock', { lock: mob(6, 0, 15) }).id, 6, 'lock: within 14 m + radius it turns you');
  assert.equal(pick('lock'), near, 'lock: nothing locked = the nearest');
  assert.equal(pick('lock', { lock: mob(5, 0, 60), lockRange: 99 }), near, 'lock: never past the 45 m lock range');
  assert.equal(pick('lock', { lock: far, canTarget: m => m !== far }), near, 'lock: a dead / hidden lock is skipped');
  assert.equal(pick('cone'), front, 'cone: never the one behind you');
  assert.equal(pick('cone', { lock: far, range: 26 }), far, 'cone: a lock inside the cone wins over a nearer one');
  assert.equal(pick('cone', { lock: far }), front, 'cone: a lock too far for the skill = the nearest in the cone');
  assert.equal(pick('cone', { lock: near }), front, 'cone: a lock behind you is ignored (nearest in the cone)');
  assert.equal(pick('cone', { mobs: [near, side] }), null, 'cone: nothing in the cone = no target (attack forward)');
  assert.equal(pick('aimed', { lock: far }), null, 'aimed: never picks');
  ok('pickTarget: nearest, locked or nearest (lock within max(14, range + 4)), cone, aimed');

  // Locked or nearest, nothing locked, a long-range skill: the crosshair pick (as before), never a spin to one behind
  const ahead = mob(11, 1, 15), behind = mob(12, 0, -6), beside = mob(13, 9, 1);
  assert.equal(pick('lock', { mobs: [ahead, behind], range: 24 }), ahead, 'a bow shoots the one in the crosshair, not the nearer one behind');
  assert.equal(pick('nearest', { mobs: [ahead, behind], range: 24 }), behind, 'Nearest mode: the nearest, as chosen');
  assert.equal(pick('lock', { mobs: [behind, beside], range: 24 }), behind, 'nothing in the crosshair: anything within 7 m');
  assert.equal(pick('lock', { mobs: [beside], range: 24 }), null, 'else nothing (shoot where you look)');
  assert.equal(crosshairPick({ x: 0, z: 0, front: Math.PI / 2, mobs: [ahead, beside], range: 24 }), beside, 'the crosshair follows the look');
  ok('Locked or nearest keeps the crosshair pick for ranges over 12 m (no 180° turns)');

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
  const offLine = mob(5, 1.5, 1.5), onLine = mob(6, 0.1, 3);
  assert.deepEqual(capTargets([offLine, onLine], { x: 0, z: 0, n: 1, line: 0 }), [onLine], 'aimed: the nearest to the aim line');
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
  for (const max of [null, '', true, undefined, NaN]) assert.equal(cleanPrefs({ max }).max, 8, `max ${max}: the default`);
  assert.equal(cleanPrefs({ max: '3' }).max, 3);
  const cc = cleanControls({ v: 1, combat: { target: 'cone', cleave: false, max: 2, junk: 1 } });
  assert.deepEqual(cc.combat, { target: 'cone', cleave: false, max: 2 }, 'saved and synced as { target, cleave, max }');
  assert.deepEqual(cleanControls({ v: 1, combat: 'bad' }).combat, combatSetting({}), 'a bad save falls back to the defaults');
  assert.equal(cleanControls({ v: 1 }).combat, undefined, 'no combat key: none added');
  ok('settings: cleaned, clamped, defaults Locked or nearest / cleave on / 8');

  assert.equal(attackFov('slash').half, 1.05, 'base field of view = the old hitArc half-angle');
  assert.equal(attackFov('slash', { fov: 1.5 }).half, 1.05 * 1.5, 'a weapon widens it');
  assert.equal(attackFov('cleave', { fov: 9, over: { r: 4.2, half: 1.6 } }).half, Math.PI, 'never past a full circle');
  for (const [k, A] of Object.entries(ATTACKS)) assert.ok(A.aoe || A.n >= 3, `${k}: a target limit`);
  assert.ok(ATTACKS.styleRing.aoe && ATTACKS.styleRing.round && ATTACKS.feedback.round && ATTACKS.cleave.aoe && ATTACKS.cleave.n === 8);
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
const zerk = g.addPlayer(null, 'Bjorn', 'berserker');
const bard = g.addPlayer(null, 'Lio', 'bard');
const all = [sword, ranger, cleric, zerk, bard];
for (const p of all) { p.lvl = 10; g.recompute(p); }
g.time = 100;
const X = 0, Z = 70;
function reset() {
  for (const m of g.mobs.values()) g.mobs.delete(m.id);
  g.scheduled = []; g.arrowList = [];
  for (const p of all) {
    Object.assign(p, { x: X, z: Z, face: 0, dead: false, cds: [0, 0, 0, 0], combo: 0, lastBasic: -9, target: 0, tprefs: null, aimYaw: null, style: null, rage: 0 });
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

  reset(); const w4 = [wolf(0.3, 2.6), wolf(-0.6, 1.6)];
  prefs(sword, { mode: 'nearest', cleave: false }); sword.target = w4[0].id; use(sword, 'slash');
  assert.deepEqual([...hitIds(sword)], [w4[1].id], 'Nearest mode, cleave off: the nearest, even with a lock');

  reset(); const w5 = [wolf(-1.4, 1.2), wolf(0.2, 2.6)]; // the first is nearer, the second on the aim line
  prefs(sword, { mode: 'aimed', cleave: false }); use(sword, 'slash');
  assert.deepEqual([...hitIds(sword)], [w5[1].id], 'Aimed, cleave off: the one nearest the aim line');

  reset(); fan(5); prefs(zerk, { cleave: false }); use(zerk, 'cleave');
  assert.equal(hitIds(zerk).size, 5, "the Berserker's Cleave skill is an area sweep: Cleave off doesn't make it single-target");
  reset(); fan(3); bard.style = 'drum'; prefs(bard, { cleave: false }); use(bard, 'sonic');
  assert.equal(hitIds(bard).size, 3, 'a ring basic (War Drum) hits all around, Cleave off or not');

  prefs(sword, { mode: 'nonsense', cleave: 'x', max: 1e9 });
  assert.deepEqual(sword.tprefs, { mode: 'lock', cleave: true, max: 8 }, 'the message is validated');
  ok('cleave: on hits all in the swing, off hits the lock or the nearest, max and skill limits cap it, bots unchanged');
}

// Cone: arc and line hits stay inside the cone around the camera's look (sent with the skill)
{
  const swing = (look, extra = {}) => g.handle(sword, { type: 'skill', slot: 0, face: 1.0, ...(look === undefined ? {} : { look }), ...extra });
  const layout = () => [wolf(Math.sin(0.5) * 2.4, Math.cos(0.5) * 2.4), wolf(Math.sin(1.9) * 2.4, Math.cos(1.9) * 2.4)]; // 29° and 109° from the look
  reset(); let [inside, outside] = layout(); prefs(sword, { mode: 'cone' }); swing(0);
  assert.ok(hitIds(sword).has(inside.id) && !hitIds(sword).has(outside.id), 'Cone: the swing skips the enemy beside the camera');
  reset(); [inside, outside] = layout(); prefs(sword, { mode: 'cone' }); swing(undefined);
  assert.equal(hitIds(sword).size, 2, 'an old client without look: no filter');
  reset(); [inside, outside] = layout(); prefs(sword, { mode: 'cone' }); swing('x');
  assert.equal(sword.aimYaw, null, 'look is validated'); assert.equal(hitIds(sword).size, 2);
  reset(); [inside, outside] = layout(); prefs(sword, { mode: 'lock' }); swing(0);
  assert.equal(hitIds(sword).size, 2, 'other modes: no filter');
  reset(); [inside, outside] = layout(); swing(0);
  assert.equal(hitIds(sword).size, 2, 'bots: no filter');
  reset(); [inside, outside] = layout(); prefs(sword, { mode: 'cone' }); g.handle(sword, { type: 'skill', slot: 0, face: 1.0, look: 2 * Math.PI });
  assert.ok(hitIds(sword).has(inside.id) && !hitIds(sword).has(outside.id), 'look is wrapped');
  reset(); fan(3); const behindW = wolf(0, -1.2); bard.style = 'drum'; prefs(bard, { mode: 'cone' }); g.handle(bard, { type: 'skill', slot: 0, face: 0, look: 0 });
  assert.ok(hitIds(bard).has(behindW.id), 'all-round ring basics are not cone-filtered');
  ok('Cone: arc / line hits outside the camera cone dropped (look validated; old clients, bots, other modes, rings unfiltered)');
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

// weapon styles' field of view (mods.fov, owner 2026-11-21): slower arcs wider, quicker narrower; Cleave cap and Cone
// filter unchanged on a widened arc
{
  // the data: modest, slow heavy arcs > 1, quick ones < 1, styles without arcs (lines, rings, bolts, bows) 1
  const fov = id => STYLES[id].mods?.fov ?? 1;
  for (const id of STYLE_IDS) assert.ok(fov(id) >= 0.85 && fov(id) <= 1.2, `${id}: a modest multiplier`);
  for (const id of ['mace', 'halberd', 'warhammer']) assert.ok(fov(id) > 1, `${id}: slow, heavy arcs swing wider`);
  for (const id of ['dual', 'daggers', 'twinaxes', 'rapier']) assert.ok(fov(id) < 1, `${id}: quick, precise ones narrower`);
  for (const id of STYLE_IDS.filter(id => STYLES[id].def)) assert.equal(fov(id), 1, `${id}: the class default is the baseline`);
  for (const id of ['spear', 'tome', 'wand', 'crossbow', 'glaive', 'drum', 'flute']) assert.equal(fov(id), 1, `${id}: no arcs (or no swing): 1`);
  const cd = (id, base) => STYLES[id].basic?.cd ?? base * (STYLES[id].mods?.basicCd ?? 1);
  assert.ok(cd('mace', 0.7) > 0.7 && cd('warhammer', 0.85) > 0.85 && cd('dual', 0.55) < 0.55 && cd('daggers', 0.6) < 0.6 && cd('twinaxes', 0.85) < 0.85, 'wider goes with slower, narrower with quicker');

  const guard = g.addPlayer(null, 'Bran', 'guardian'); guard.lvl = 10; g.recompute(guard);
  const swingAt = (p, style, angles, o = {}) => {
    reset();
    Object.assign(guard, { x: X, z: Z, face: 0, dead: false, cds: [0, 0, 0, 0], combo: 0, lastBasic: -9, target: 0, tprefs: null, aimYaw: null });
    p.style = style;
    const ws = angles.map(a => wolf(Math.sin(a) * 2.4, Math.cos(a) * 2.4));
    if (o.prefs) prefs(p, o.prefs);
    g.handle(p, { type: 'skill', slot: 0, face: 0, ...(o.look === undefined ? {} : { look: o.look }) });
    const hit = hitIds(p);
    return ws.map(w => hit.has(w.id));
  };
  // Mace & Shield (x1.15): its first blow's half-angle 1.0 rad becomes 1.15
  assert.deepEqual(swingAt(guard, 'mace', [1.08, 1.2]), [true, false], 'Mace & Shield: a wolf at 1.08 rad (outside 1.0, inside 1.15) is hit, 1.2 is not');
  assert.equal(ev('fx', e => e.k === 'sty' && e.id === guard.id)[0]?.h, 1.15, 'the swing effect shows the wider arc');
  // Dual Blades (x0.85): 1.0 rad becomes 0.85
  assert.deepEqual(swingAt(sword, 'dual', [0.8, 0.92]), [true, false], 'Dual Blades: 0.8 rad is hit, 0.92 (inside 1.0, outside 0.85) is not');
  // the Cleave cap on a widened arc
  const spread = [-1.1, -0.7, -0.35, 0, 0.35, 0.7, 1.1];
  assert.equal(swingAt(guard, 'mace', spread, { prefs: { cleave: true, max: 8 } }).filter(Boolean).length, ATTACKS.styleArc.n, 'Cleave on: the arc basic\'s own limit (4) still caps a widened swing');
  assert.equal(swingAt(guard, 'mace', spread, { prefs: { cleave: true, max: 2 } }).filter(Boolean).length, 2, 'max targets still caps it');
  assert.equal(swingAt(guard, 'mace', spread, { prefs: { cleave: false } }).filter(Boolean).length, 1, 'Cleave off: one');
  assert.equal(swingAt(guard, 'mace', spread).filter(Boolean).length, 7, 'bots (no prefs): every enemy in the wider swing');
  // the Cone filter on a widened arc: looking 0.6 rad left, the wolf at +1.08 rad is in the swing but outside the cone
  assert.deepEqual(swingAt(guard, 'mace', [1.08, 0], { prefs: { mode: 'cone' }, look: -0.6 }), [false, true], 'Cone: a widened swing still skips what is outside the camera cone');
  // the Berserker's Cleave skill takes the style's multiplier too, and stays an area sweep with its own limit
  zerk.style = 'warhammer';
  const A = g.atkFov(zerk, 'cleave', { r: 4.2, half: 1.6 });
  assert.ok(Math.abs(A.half - 1.6 * 1.2) < 1e-9 && A.aoe && A.n === 8, 'Warhammer: the Cleave skill sweeps x1.2 wider, still aoe with its own 8');
  // the chop's swing effect carries the arc it hit with (the client draws e.h)
  for (const [style, want] of [['warhammer', 1.44], ['twinaxes', 0.9], [null, 1.1]]) {
    reset(); zerk.style = style; use(zerk, 'chop');
    assert.equal(ev('fx', e => e.k === 'ca' && e.v === 'chop' && e.id === zerk.id)[0]?.h, want, `${style || 'greataxe'} chop: h ${want}`);
  }
  zerk.style = null;
  g.removePlayer(guard);
  ok('weapon field of view: mods.fov widens slow arcs and narrows quick ones; Cleave cap and Cone filter unchanged');
}

console.log(`targeting: all ${n} checks passed`);
