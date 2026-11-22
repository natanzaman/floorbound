// In-process checks for the labyrinths (docs/briefs/labyrinths.md), Floor 1's Undercrypt: every layer connected and
// walled, separate seeds, braiding, loot placement, the levers' equal walk, steering, the stairs and thresholds (and
// respawning at them), spike plates, wading noise, Tomb Wardens and the lure, torches, chests, the levers and the
// portcullis, the crypt breathing with rising pressure, the Gravekeeper and the Horn Key, the Horn Lock on the gate.
// Usage: node test/labyrinth.js
import assert from 'node:assert/strict';
delete process.env.SPAWN_AT; delete process.env.LAB_GATE;
const { Game } = await import('../server/game.js');
const { walkable, areaName, GATE } = await import('../shared/data.js');
const LB = await import('../shared/labyrinth.js');
const { LABS, LAYERS, labAt, labSteer, startPoint, endPoint, hallCenter, trapState, hasLabKey, cellOf, stairsOf, portOpen, labRun, leverWindow } = LB;
const { moveToward } = await import('../shared/bots/motor.js');

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const lab = LABS[1], [CAT, GAL, OSS] = lab.layers;

// ---------- the layers ----------
{
  for (const L of LAYERS) {
    const N = L.cols * L.rows;
    for (let c = 0; c < N; c++) assert.ok(c === 0 || L.next[c * N] >= 0, `${L.id}: cell ${c} reaches cell 0`);
    const [sx, sz] = startPoint(L), [ex, ez] = endPoint(L);
    assert.ok(walkable(sx, sz) && walkable(ex, ez), `${L.id}: start and end are floor`);
    assert.ok(!walkable(L.x0 + 0.3, sz), `${L.id}: outer wall`);
    assert.equal(areaName(sx, sz), L.name);
    labRun.portUp[L.id] = 1e9; // (portcullis up for the walk)
    let x = sx, z = sz, steps = 0;
    while (Math.hypot(x - ex, z - ez) > 0.5 && steps++ < 3000) {
      const [ax, az] = labSteer(x, z, ex, ez), d = Math.hypot(ax - x, az - z), st = Math.min(d, 0.35);
      x += (ax - x) / d * st; z += (az - z) / d * st;
      assert.ok(walkable(x, z), `${L.id}: steering stays on the floor (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    assert.ok(steps < 3000, `${L.id}: steering arrives`);
    labRun.portUp[L.id] = 0;
  }
  assert.ok(!labAt(0, 100) && !labAt(600, 100), 'the field and Floor 2 are not in it');
  for (let i = 0; i < LAYERS.length; i++) for (let j = i + 1; j < LAYERS.length; j++) {
    const A = LAYERS[i], B = LAYERS[j];
    assert.ok(A.x0 + A.w < B.x0 || B.x0 + B.w < A.x0 || A.z0 + A.d < B.z0 || B.z0 + B.d < A.z0, `${A.id} and ${B.id} don't overlap`);
  }
  ok('three layers: connected, walled, apart; steering reaches each end');
}

// ---------- seeds, braid, loot, levers ----------
{
  // separate seeds: changing the trap seed leaves walls and mobs alone
  const before = { open: [...GAL.open].sort().join(), mobs: JSON.stringify(GAL.mobCells) };
  assert.ok(GAL.seeds.walls !== GAL.seeds.traps && GAL.seeds.traps !== GAL.seeds.mobs && GAL.seeds.mobs !== GAL.seeds.loot, 'four seeds');
  assert.equal([...GAL.open].sort().join(), before.open);
  // braid: the Catacombs (0.5) has fewer dead ends than the Galleries (0.2), per cell
  const deadShare = L => { let d = 0; for (let c = 0; c < L.cols * L.rows; c++) if (L.nbrs(c).length === 1) d++; return d / (L.cols * L.rows); };
  assert.ok(deadShare(CAT) < deadShare(GAL), `braid: ${deadShare(CAT).toFixed(2)} < ${deadShare(GAL).toFixed(2)}`);
  // loot: mostly off the main route, some on it; deep chests are off-route dead ends
  for (const L of [CAT, GAL]) {
    const on = L.chestList.filter(c => L.onPath.has(c.c)).length;
    assert.equal(L.chestList.length, L.loot.n);
    assert.equal(on, Math.round(L.loot.n * L.loot.onPath), `${L.id}: ${on} chest(s) on the main route`);
    for (const c of L.chestList.filter(c => c.deep)) assert.ok(!L.onPath.has(c.c) && L.nbrs(c.c).length === 1);
  }
  // levers: same walk from the split, far apart, off the route; the solo window comes from the walk
  const [a, b] = GAL.leverCells, N = GAL.cols * GAL.rows;
  const dist = (from, to) => { let c = from, k = 0; while (c !== to && k < N) { c = GAL.next[c * N + to]; k++; } return k; };
  assert.equal(dist(GAL.splitCell, a), dist(GAL.splitCell, b), 'equal walk from the split');
  assert.ok(!GAL.onPath.has(a) && !GAL.onPath.has(b));
  assert.equal(dist(a, b) * GAL.cell, GAL.leverWalk);
  assert.ok(leverWindow(GAL, 1) > GAL.leverWalk / 10 && leverWindow(GAL, 1) > leverWindow(GAL, 3), 'solo window from the walk');
  ok('separate seeds, braid per layer, loot by path, fair levers');
}

const g = new Game();
const a = g.addPlayer(null, 'Pell', 'swordsman'), b = g.addPlayer(null, 'Bram', 'guardian');
const tick = (secs, dt = 0.05) => { for (let t = 0; t < secs; t += dt) g.update(dt); };
const evs = (t, s) => g.events.filter(e => e.t === t && (!s || e.s === s));
a.lvl = b.lvl = 10; g.recompute(a); g.recompute(b); a.hp = a.maxHp; b.hp = b.maxHp;
const stair = (L, kind) => stairsOf(lab).find(s => s.L === L && s.kind === kind);
const at = (p, x, z) => g.teleport(p, x, z);

// ---------- mobs ----------
{
  const by = id => [...g.mobs.values()].filter(m => labAt(m.x, m.z)?.id === id);
  assert.ok(by('catacombs').every(m => m.type === 'ghoul') && by('catacombs').length === 6);
  assert.equal(by('galleries').filter(m => m.type === 'tombwarden').length, 3);
  assert.equal(by('ossuary').filter(m => m.type === 'gravekeeper').length, 1);
  ok('mobs: ghouls, Tomb Wardens in the Galleries, the Gravekeeper in the Ossuary');
}

// ---------- stairs and thresholds ----------
{
  at(a, lab.entry.x, lab.entry.z); g.events = [];
  g.handle(a, { type: 'lab', a: 'stair' });
  assert.equal(labAt(a.x, a.z), CAT, 'down the crypt stair'); assert.equal(evs('labtp').length, 1); assert.ok(a.labLures >= 1, 'a rattle to start');
  at(a, stair(CAT, 'down').x, stair(CAT, 'down').z); g.handle(a, { type: 'lab', a: 'stair' });
  assert.equal(labAt(a.x, a.z), GAL, 'down to the Galleries'); assert.deepEqual(a.labCk, { f: 1, li: 1 });
  at(a, stair(GAL, 'up').x, stair(GAL, 'up').z); g.handle(a, { type: 'lab', a: 'stair' });
  assert.equal(labAt(a.x, a.z), CAT, 'back up to the Catacombs');
  at(a, stair(CAT, 'up').x, stair(CAT, 'up').z); g.handle(a, { type: 'lab', a: 'stair' });
  assert.ok(!labAt(a.x, a.z) && a.labCk === null, 'out to the field');
  at(a, stair(OSS, 'out').x, stair(OSS, 'out').z); g.handle(a, { type: 'lab', a: 'stair' });
  assert.ok(Math.hypot(a.x - lab.exitTo.x, a.z - lab.exitTo.z) < 3 && a.z < GATE.band[0], 'the Ossuary stair comes out before the Chamber Gate');
  // dying inside: back at the last threshold
  a.labCk = { f: 1, li: 1 }; const [gx, gz] = GAL.center(GAL.mobCells[0][1]); at(a, gx, gz);
  const rp = g.respawnPoint(a); assert.equal(labAt(...rp), GAL, 'respawn at the Galleries threshold');
  a.labCk = null;
  ok('stairs: field, layers, back up, out to the gate; respawn at the last threshold');
}

// ---------- spike plates ----------
{
  const tr = CAT.trapList[0];
  at(a, tr.x, tr.z); a.hp = a.maxHp; a.iframeUntil = 0; a.airUntil = 0;
  let guard = 0; while (trapState(CAT, tr, g.time) === 2 && guard++ < 200) tick(0.05);
  while (trapState(CAT, tr, g.time) !== 2 && guard++ < 400) tick(0.05);
  tick(0.1);
  assert.ok(a.maxHp - a.hp > a.maxHp * 0.1, 'spikes hurt');
  const hp = a.hp; tick(0.3); assert.equal(a.hp, hp, 'once per rise');
  ok('spike plates: hit once per rise');
}

// ---------- noise, Tomb Wardens and the lure ----------
{
  const w = [...g.mobs.values()].find(m => m.type === 'tombwarden');
  a.testWard = true; a.hp = a.maxHp;
  at(a, w.x + 0.1, w.z + 0.1); // right next to it, quietly: it sleeps
  tick(1); assert.equal(w.threat.size, 0, 'asleep: a quiet player beside it is not noticed');
  // a torch lit nearby wakes it, and it fights what it finds
  const tc = GAL.torchList.slice().sort((p, q) => Math.hypot(p.x - w.x, p.z - w.z) - Math.hypot(q.x - w.x, q.z - w.z))[0];
  at(a, tc.x, tc.z); g.events = [];
  g.handle(a, { type: 'lab', a: 'torch' });
  assert.equal(evs('lab', 'torch').length, 1);
  assert.ok(g.labs.galleries.lit.has(tc.k), 'torch lit');
  if (Math.hypot(tc.x - w.x, tc.z - w.z) < 16) assert.ok(w.labAwake > g.time, 'the torch woke it');
  // wading is noise
  w.labAwake = 0; w.threat.clear(); g.teleport(w, w.sx, w.sz);
  const wc = [...GAL.waterCells][0], [wx, wz] = GAL.center(wc);
  g.labNoise(GAL, wx, wz, 1e3); assert.ok(w.labAwake > g.time, 'noise wakes it');
  // the lure draws it away
  w.labAwake = 0; w.threat.clear();
  at(a, ...GAL.center(GAL.path[1])); a.labLures = 1; g.events = [];
  g.handle(a, { type: 'lab', a: 'lure', face: 0 });
  assert.equal(a.labLures, 0); const lu = evs('lab', 'lure')[0]; assert.ok(lu && labAt(lu.x, lu.z) === GAL, 'thrown');
  g.labNoise(GAL, lu.x, lu.z, 1e3);
  assert.deepEqual(w.labGo, [lu.x, lu.z], 'goes to the rattle');
  g.handle(a, { type: 'lab', a: 'lure', face: 0 }); assert.equal(evs('lab', 'lure').length, 1, 'no rattles left');
  a.testWard = false; w.labAwake = 0; w.threat.clear();
  ok('noise: Tomb Wardens sleep, wake to torches and noise, follow a lure');
}

// ---------- chests ----------
{
  const c = CAT.chestList[0]; at(a, c.x, c.z); const gold = a.gold; g.events = [];
  g.handle(a, { type: 'lab', a: 'chest' });
  assert.ok(a.gold > gold, 'loot'); assert.equal(evs('lab', 'chest').length, 1);
  const g2 = a.gold; g.handle(a, { type: 'lab', a: 'chest' }); assert.equal(a.gold, g2, 'once per character until it refills');
  at(b, c.x, c.z); const gb = b.gold; g.handle(b, { type: 'lab', a: 'chest' }); assert.ok(b.gold > gb, 'everyone gets their own');
  ok('chests: loot per character, refilling later');
}

// ---------- levers and the portcullis ----------
{
  const [l0, l1] = GAL.leverList, [ex, ez] = endPoint(GAL);
  assert.equal(portOpen(GAL, g.time), false, 'shut');
  const blocked = (() => { let x = ex, z = ez - GAL.cell / 2; return !walkable(x, z) || !walkable(...[ex, ez - GAL.cell * 0.55]); })();
  // a portcullis edge blocks while down
  const [pi, pj, dir] = GAL.portEdge.split(','), px = GAL.x0 + (+pi + (dir === 'E' ? 1 : 0.5)) * GAL.cell, pz = GAL.z0 + (+pj + (dir === 'N' ? 1 : 0.5)) * GAL.cell;
  assert.equal(walkable(px, pz), false, 'the portcullis blocks');
  at(a, l0.x, l0.z); at(b, l1.x, l1.z); g.events = [];
  g.handle(a, { type: 'lab', a: 'lever' }); tick(1);
  g.handle(b, { type: 'lab', a: 'lever' });
  assert.equal(evs('lab', 'port').length, 1, 'two pulls in time: up');
  assert.equal(portOpen(GAL, g.time), true); assert.equal(walkable(px, pz), true, 'open edge');
  // too slow: no
  labRun.portUp.galleries = 0; g.labs.galleries.lever = [-99, -99]; g.events = [];
  g.handle(a, { type: 'lab', a: 'lever' }); tick(leverWindow(GAL, 2) + 1);
  g.handle(b, { type: 'lab', a: 'lever' }); assert.equal(evs('lab', 'port').length, 0, 'too slow');
  void blocked;
  ok('levers: two pulls in time raise the portcullis; the edge opens');
}

// ---------- the crypt breathes, with rising pressure ----------
{
  const S = g.labs.galleries;
  at(a, ...startPoint(GAL)); a.testWard = true; at(b, 0, 60);
  tick(0.2); assert.ok(S.since > 0, 'pressure clock starts');
  assert.ok(g.labPressure(GAL) < 0.05);
  S.since = g.time - GAL.breathe.pressAfter; S.breatheAt = g.time; g.events = [];
  tick(0.2);
  const br = evs('lab', 'breathe')[0]; assert.ok(br && br.p >= 1, 'breathes at full pressure');
  assert.ok(S.breatheAt - g.time < GAL.breathe.every[1] * GAL.breathe.press + 0.5, 'and comes back sooner');
  assert.ok([...g.mobs.values()].filter(m => m.labTemp === 'galleries').length >= GAL.breathe.rise + 1, 'more dead at full pressure');
  at(a, ...startPoint(CAT)); tick(0.2);
  assert.equal(S.since, 0, 'leaving the layer resets the pressure');
  assert.equal(evs('lab', 'breathe').filter(e => e.l === 'catacombs').length, 0, 'the Catacombs never breathe (teaching layer)');
  for (const m of [...g.mobs.values()]) if (m.labTemp) { m.threat.clear(); m.labTtl = 0; } tick(0.1);
  a.testWard = false;
  ok('the crypt breathes: sooner and harder the longer you stay, reset at the threshold');
}

// ---------- the Gravekeeper and the Horn Key ----------
{
  const k = g.labs.ossuary.keeper, [hx, hz] = hallCenter(OSS);
  a.stats.lab1Keys = 0; a.stats.wardenKills = 0; b.stats.lab1Keys = 0; b.stats.wardenKills = 0;
  at(a, hx, hz - 6); a.hp = a.maxHp; a.testWard = true; at(b, 0, 60); g.events = [];
  k.threat.set(a.id, 10);
  tick(8);
  assert.ok(evs('quake').some(e => e.by === k.id), 'rings the Grave Bell');
  k.hp = k.maxHp * 0.45; tick(0.2);
  assert.ok(evs('lab', 'call').length === 1, 'calls the dead at half health');
  g.events = []; k.contributors.add(a.id);
  k.hp = 1; g.killMob(k, a);
  assert.ok(k.dead && k.deadUntil > g.time + 60);
  assert.equal(a.stats.lab1Keys, 1, 'the fighter gets the key'); assert.equal(b.stats.lab1Keys, 0);
  assert.equal(evs('labkey').filter(e => e.id === a.id && e.first).length, 1);
  assert.equal([...g.mobs.values()].filter(m => m.labTemp === 'ossuary' && !m.dead).length, 0, 'its dead go with it');
  a.testWard = false;
  ok('the Gravekeeper: Grave Bell, calls the dead once, drops the Horn Key');
}

// ---------- steering for mobs and bots ----------
{
  const m = [...g.mobs.values()].find(m => m.type === 'ghoul' && labAt(m.x, m.z) === CAT && !m.dead);
  const [ex, ez] = endPoint(CAT), from = cellOf(CAT, m.x, m.z);
  for (let i = 0; i < 400; i++) g.moveMob(m, ex, ez, 6, 0.05, 1);
  assert.ok(cellOf(CAT, m.x, m.z) !== from || from === cellOf(CAT, ex, ez), 'a ghoul paths through cells');
  const [sx, sz] = startPoint(CAT);
  const bot = { x: sx, z: sz, face: 0, t: 0, dt: 0.05, gateOpen: false, me: { lvl: 10 } };
  for (let i = 0; i < 1500 && Math.hypot(bot.x - ex, bot.z - ez) > 1; i++) moveToward(bot, ex, ez);
  assert.ok(Math.hypot(bot.x - ex, bot.z - ez) <= 1.5, 'a bot walks the maze');
  at(b, 0, 100); assert.equal(g.validTarget(m, b), false, 'ghouls ignore people outside their layer');
  ok('steering: ghouls and bots go round the walls');
}

// ---------- the Horn Lock ----------
{
  const zone = [0, (GATE.zone.z0 + GATE.zone.z1) / 2];
  g.gate.open = false; g.gate.ready.clear();
  at(b, ...zone); at(a, 0, 60); g.events = [];
  g.handle(b, { type: 'ready' });
  assert.equal(g.gate.ready.has(b.id), false, 'no key: not ready'); assert.ok(evs('lab', 'locked').length === 1);
  at(a, 2, zone[1]); g.handle(b, { type: 'ready' });
  assert.equal(g.gate.ready.has(b.id), true, 'a keyholder at the gate opens it for the party');
  g.handle(a, { type: 'ready' }); tick(6);
  assert.equal(g.gate.open, true, 'the gate opens');
  g.gate.open = false; g.gate.ready.clear(); g.handle(b, { type: 'ready' }); at(a, 0, 60); tick(25);
  assert.equal(g.gate.open, false, 'without a keyholder there the count never finishes');
  b.stats.wardenKills = 1; assert.equal(hasLabKey(b.stats, 1), true); b.stats.wardenKills = 0;
  b.bot = true; assert.equal(g.labGateOk(1, [b]), true, 'bots only: no lock'); b.bot = false;
  process.env.LAB_GATE = '0'; assert.equal(g.labGateOk(1, [b]), true, 'LAB_GATE=0'); delete process.env.LAB_GATE;
  ok('the Horn Lock: needs a keyholder at the gate; Warden killers, bot groups and LAB_GATE=0 pass');
}

console.log(`labyrinth: ${n} checks passed`);
process.exit(0);
