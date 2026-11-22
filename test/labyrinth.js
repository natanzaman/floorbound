// In-process checks for the labyrinths (docs/briefs/labyrinths.md), Floor 1's Undercrypt: the maze is connected and
// walled, steering gets from the start to the end, the stairs, spike plates, the crypt breathing, the Gravekeeper's
// Grave Bell, call and key, the Horn Lock on the Chamber Gate (and its waivers), mobs and bots staying inside.
// Usage: node test/labyrinth.js
import assert from 'node:assert/strict';
delete process.env.SPAWN_AT; delete process.env.LAB_GATE;
const { Game } = await import('../server/game.js');
const { walkable, areaName, GATE } = await import('../shared/data.js');
const { LABS, labAt, labSteer, startPoint, endPoint, hallCenter, inHall, trapState, hasLabKey, cellOf } = await import('../shared/labyrinth.js');
const { moveToward } = await import('../shared/bots/motor.js');

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const L = LABS[1];

// ---------- the maze ----------
{
  const N = L.cols * L.rows;
  for (let c = 0; c < N; c++) assert.ok(L.next[c * N + (N - 1 - c)] >= 0 || c === N - 1 - c, `cell ${c} reaches the far cell`);
  const [sx, sz] = startPoint(L), [ex, ez] = endPoint(L), [hx, hz] = hallCenter(L);
  assert.ok(walkable(sx, sz) && walkable(ex, ez) && walkable(hx, hz));
  assert.ok(!walkable(L.x0 + 0.3, sz), 'outer wall');
  assert.ok(!walkable(L.x0 + L.cell, L.z0 + L.cell), 'a corner post');
  assert.equal(areaName(hx, hz), 'The Ossuary'); assert.equal(areaName(sx, sz), 'The Undercrypt');
  assert.ok(!labAt(0, 100) && !labAt(600, 100), 'the field and Floor 2 are not in it');
  // walk with the steering from start to end, and to the hall, never through a wall
  for (const [tx, tz] of [[ex, ez], [hx, hz]]) {
    let x = sx, z = sz, steps = 0;
    while (Math.hypot(x - tx, z - tz) > 0.5 && steps++ < 3000) {
      const [ax, az] = labSteer(x, z, tx, tz), d = Math.hypot(ax - x, az - z), st = Math.min(d, 0.35);
      x += (ax - x) / d * st; z += (az - z) / d * st;
      assert.ok(walkable(x, z), `steering stays on the floor (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    assert.ok(steps < 3000, 'steering arrives');
  }
  // walls: from every cell, the straight line to a non-neighbour cell's centre hits a wall somewhere (it's a maze)
  let blocked = 0;
  for (let c = 0; c < 20; c++) { const [ax, az] = [L.x0 + 5, L.z0 + 5 + c * 4]; for (let k = 0; k < 40; k++) if (!walkable(ax + k * 2, az)) { blocked++; break; } }
  assert.ok(blocked > 5, 'straight lines across hit walls');
  ok('the maze: connected, walled, steering reaches the end and the Ossuary');
}

const g = new Game();
const a = g.addPlayer(null, 'Pell', 'swordsman'), b = g.addPlayer(null, 'Bram', 'guardian');
const tick = (secs, dt = 0.05) => { for (let t = 0; t < secs; t += dt) g.update(dt); };
const evs = t => g.events.filter(e => e.t === t);
a.lvl = b.lvl = 10; g.recompute(a); g.recompute(b); a.hp = a.maxHp; b.hp = b.maxHp;

// ---------- mobs ----------
{
  const inside = [...g.mobs.values()].filter(m => m.labF === 1);
  assert.ok(inside.filter(m => m.type === 'ghoul').length >= 10, 'ghouls in the maze');
  assert.equal(inside.filter(m => m.type === 'gravekeeper').length, 1, 'one Gravekeeper');
  const k = g.labs[1].keeper; assert.ok(inHall(L, k.x, k.z), 'in the Ossuary');
  ok('mobs: ghouls through the maze, the Gravekeeper in the Ossuary');
}

// ---------- the stairs ----------
{
  g.teleport(a, L.entry.x, L.entry.z); g.events = [];
  g.handle(a, { type: 'lab', a: 'out' }); assert.ok(!labAt(a.x, a.z), 'out from the field does nothing');
  g.handle(a, { type: 'lab', a: 'in' });
  assert.equal(labAt(a.x, a.z), L, 'down the crypt stair'); assert.equal(evs('labtp').length, 1);
  const [sx, sz] = startPoint(L); assert.ok(Math.hypot(a.x - sx, a.z - sz) < 4);
  g.handle(a, { type: 'lab', a: 'up' }); assert.equal(labAt(a.x, a.z), L, 'not at the end stair: stays');
  g.handle(a, { type: 'lab', a: 'out' }); assert.ok(!labAt(a.x, a.z) && Math.hypot(a.x - L.back.x, a.z - L.back.z) < 3, 'back up to the field');
  const [ex, ez] = endPoint(L); g.teleport(a, ex, ez);
  g.handle(a, { type: 'lab', a: 'up' }); assert.ok(Math.hypot(a.x - L.exitTo.x, a.z - L.exitTo.z) < 3, 'the end stair comes out at the Chamber Gate');
  assert.ok(a.z < GATE.band[0], '... on the near side of the gate');
  ok('stairs: in, back out, and up to the Chamber Gate');
}

// ---------- spike plates ----------
{
  const tr = L.trapList[0];
  g.teleport(a, tr.x, tr.z); a.hp = a.maxHp; a.iframeUntil = 0; a.airUntil = 0;
  // wait for the spikes to rise
  let guard = 0; while (trapState(L, tr, g.time) === 2 && guard++ < 200) tick(0.05);
  while (trapState(L, tr, g.time) !== 2 && guard++ < 400) tick(0.05);
  tick(0.1);
  const hurt = a.maxHp - a.hp;
  assert.ok(hurt > a.maxHp * 0.1, `spikes hurt (${hurt})`);
  const hp = a.hp; tick(0.3); assert.equal(a.hp, hp, 'once per rise');
  ok('spike plates: hit once per rise');
}

// ---------- the crypt breathes ----------
{
  a.hp = a.maxHp; const [sx, sz] = startPoint(L); g.teleport(a, sx, sz); a.testWard = true;
  g.labs[1].breatheAt = g.time + 0.1; g.events = [];
  tick(0.3);
  assert.equal(evs('lab').filter(e => e.s === 'breathe').length, 1, 'breathes');
  const risen = [...g.mobs.values()].filter(m => m.labTemp === 1);
  assert.ok(risen.length >= 1 && risen.every(m => labAt(m.x, m.z) === L), 'the dead rise inside');
  assert.ok(g.labSnap()[1] > 0, 'torches gutter (snapshot)');
  for (const m of risen) m.labTtl = g.time; for (const m of risen) m.threat.clear();
  a.x = sx; tick(0.1); // (still threatened ones wait)
  for (const m of risen) { m.threat.clear(); } g.teleport(a, L.back.x, L.back.z); tick(0.2);
  assert.equal([...g.mobs.values()].filter(m => m.labTemp === 1).length, 0, 'they crumble when their time is up');
  a.testWard = false;
  ok('the crypt breathes: torches gutter, the dead rise, then crumble');
}

// ---------- mobs and bots go round walls ----------
{
  const m = [...g.mobs.values()].find(m => m.type === 'ghoul');
  const [ex, ez] = endPoint(L), from = cellOf(L, m.x, m.z);
  for (let i = 0; i < 400; i++) g.moveMob(m, ex, ez, 6, 0.05, 1);
  assert.notEqual(cellOf(L, m.x, m.z), from, 'a ghoul paths to another cell');
  const [sx, sz] = startPoint(L);
  const bot = { x: sx, z: sz, face: 0, t: 0, dt: 0.05, gateOpen: false, me: { lvl: 10 } };
  for (let i = 0; i < 1200 && Math.hypot(bot.x - ex, bot.z - ez) > 1; i++) moveToward(bot, ex, ez);
  assert.ok(Math.hypot(bot.x - ex, bot.z - ez) <= 1.5, `a bot walks the maze (${bot.x.toFixed(1)}, ${bot.z.toFixed(1)})`);
  // ghouls don't chase people outside the labyrinth
  g.teleport(b, 0, 100); assert.equal(g.validTarget(m, b), false);
  ok('steering: ghouls and bots go round the walls; ghouls stay on people inside');
}

// ---------- the Gravekeeper: the Grave Bell, the call, the key ----------
{
  const k = g.labs[1].keeper, [hx, hz] = hallCenter(L);
  a.stats.lab1Keys = 0; a.stats.wardenKills = 0; b.stats.lab1Keys = 0; b.stats.wardenKills = 0;
  g.teleport(a, hx, hz - 6); a.hp = a.maxHp; a.testWard = true; g.events = [];
  k.threat.set(a.id, 10);
  tick(8);
  assert.ok(evs('quake').some(e => e.by === k.id), 'rings the Grave Bell');
  k.hp = k.maxHp * 0.45; tick(0.2);
  assert.ok(evs('lab').some(e => e.s === 'call'), 'calls the dead at half health');
  assert.ok([...g.mobs.values()].filter(m => m.labTemp === 1 && inHall(L, m.x, m.z)).length >= 2, 'they rise in the Ossuary');
  g.events = []; k.contributors.add(a.id);
  k.hp = 1; g.killMob(k, a);
  assert.ok(k.dead && k.deadUntil > g.time + 60, 'down, back in a while');
  assert.equal(a.stats.lab1Keys, 1, 'the fighter gets the key');
  assert.equal(b.stats.lab1Keys, 0, 'someone on the field does not');
  assert.equal(evs('labkey').filter(e => e.id === a.id && e.first).length, 1);
  assert.equal([...g.mobs.values()].filter(m => m.labTemp === 1 && inHall(L, m.x, m.z) && !m.dead).length, 0, 'its dead go with it');
  a.testWard = false;
  ok('the Gravekeeper: Grave Bell, calls the dead once, drops the Horn Key');
}

// ---------- the Horn Lock ----------
{
  const zone = [0, (GATE.zone.z0 + GATE.zone.z1) / 2];
  g.gate.open = false; g.gate.ready.clear();
  g.teleport(b, ...zone); g.teleport(a, 0, 60); g.events = [];
  assert.equal(hasLabKey(b.stats, 1), false);
  g.handle(b, { type: 'ready' });
  assert.equal(g.gate.ready.has(b.id), false, 'no key: not ready');
  assert.ok(evs('lab').some(e => e.s === 'locked' && e.to === b.id));
  g.teleport(a, 2, zone[1]);
  g.handle(b, { type: 'ready' });
  assert.equal(g.gate.ready.has(b.id), true, 'a keyholder at the gate opens it for the party');
  g.handle(a, { type: 'ready' }); tick(6);
  assert.equal(g.gate.open, true, 'the gate opens');
  // the keyholder walks off before the count: no opening
  g.gate.open = false; g.gate.ready.clear(); g.handle(b, { type: 'ready' }); g.teleport(a, 0, 60); tick(25);
  assert.equal(g.gate.open, false, 'without a keyholder there the count never finishes');
  // past Warden killers count as keyholders; so do bot-only groups; LAB_GATE=0 waives it
  b.stats.wardenKills = 1; assert.equal(hasLabKey(b.stats, 1), true); b.stats.wardenKills = 0;
  b.bot = true; assert.equal(g.labGateOk(1, [b]), true, 'bots only: no lock'); b.bot = false;
  process.env.LAB_GATE = '0'; assert.equal(g.labGateOk(1, [b]), true, 'LAB_GATE=0'); delete process.env.LAB_GATE;
  ok('the Horn Lock: needs a keyholder at the gate; Warden killers, bot groups and LAB_GATE=0 pass');
}

console.log(`labyrinth: ${n} checks passed`);
process.exit(0);
