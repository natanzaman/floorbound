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

// the review's fixes: the portcullis, knockback, walls between bites, chests across a reconnect
{
  const [i, j, d] = GAL.portEdge.split(','), C = GAL.cell;
  const lx = GAL.x0 + (+i + 1) * C, cz = GAL.z0 + (+j + 0.5) * C; // (an E edge: the bars' line is x = lx)
  assert.equal(d, 'E');
  labRun.portUp.galleries = 0;
  at(a, lx - 0.7, cz); g.update(0.05); // the bars drop on you in the gateway
  assert.ok(walkable(a.x, a.z) && a.x < lx, 'pushed out of the bars, on your side');
  const x0 = a.x; g.onInput(a, { seq: a.posSeq, x: lx + 0.8, z: cz }); assert.equal(a.x, x0, 'no hopping the shut bars');
  // the stair down past the portcullis works while it's shut (going back up from the Ossuary doesn't trap you)
  const dn = stair(GAL, 'down'); at(a, dn.x, dn.z); g.handle(a, { type: 'lab', a: 'stair' });
  assert.equal(labAt(a.x, a.z), OSS, 'down from behind the shut portcullis');
  // knockback stops at a wall
  const [ci, cj] = [...Array(CAT.cols * CAT.rows).keys()].map(c => [c % CAT.cols, (c / CAT.cols) | 0]).find(([ci, cj]) => ci < CAT.cols - 1 && !CAT.open.has(`${ci},${cj},E`));
  const m = [...g.mobs.values()].find(m => m.type === 'ghoul' && !m.dead);
  const wx = CAT.x0 + (ci + 1) * CAT.cell, wz = CAT.z0 + (cj + 0.5) * CAT.cell;
  m.x = wx - 1.6; m.z = wz; at(b, wx - 3, wz);
  g.knockback(m, b, 2.5);
  assert.ok(m.x < wx - 0.9 && cellOf(CAT, m.x, m.z) === cellOf(CAT, wx - 1.6, wz), 'knockback stops at the wall');
  // no bite through the wall
  at(b, wx + 1.4, wz); const hp = b.hp; b.testWard = false;
  g.damagePlayer(b, 30, { src: 'ghoul bite', mob: m });
  assert.equal(b.hp, hp, 'the wall takes the bite');
  at(b, m.x - 1.5, wz); g.damagePlayer(b, 30, { src: 'ghoul bite', mob: m }); assert.ok(b.hp < hp, 'in the open it lands');
  // chests: emptied per character, still emptied after a reconnect
  const c = CAT.chestList[0]; at(a, c.x, c.z - 1.2); a.charId = 77; g.handle(a, { type: 'lab', a: 'chest' });
  const a2 = g.addPlayer(null, 'Pell', 'swordsman'); a2.charId = 77; at(a2, c.x, c.z - 1.2); g.events = [];
  g.handle(a2, { type: 'lab', a: 'chest' });
  assert.equal(evs('lab', 'chest').length, 0, 'reconnecting does not refill chests');
  ok('review fixes: out from under the bars, no hopping them, stair down behind them, knockback and bites stop at walls, chests per character');
}

// ---------- Floors 2 and 3: the Weeping Thicket and the Windrift Causeways ----------
const { shiftPhase, windAt, onBridge, stripEdge, edgeShut, gatedEdges, edgeSide, KEEPERS } = LB;
const [REED, WOOD, HEART] = LABS[2].layers, [KITE, ISLE, SPIRE] = LABS[3].layers;
{
  // the tide and the spans: both phases keep every layer connected, and a shifting way opens and shuts with the clock
  for (const L of [REED, WOOD, KITE, ISLE]) {
    assert.ok(L.shiftEdges.size >= 2, `${L.id}: shifting ways`);
    const N = L.cols * L.rows;
    for (const ph of [0, 1]) for (let c = 1; c < N; c++) assert.ok(L.nextBy[ph][c * N] >= 0, `${L.id} phase ${ph}: cell ${c} reaches cell 0`);
    const [e, set] = [...L.shiftEdges][0], [i, j, d] = e.split(','), C = L.cell;
    const mx = d === 'E' ? L.x0 + (+i + 1) * C : L.x0 + (+i + 0.5) * C, mz = d === 'E' ? L.z0 + (+j + 0.5) * C : L.z0 + (+j + 1) * C;
    labRun.now = set * L.shift.every + 1; assert.equal(shiftPhase(L), set); assert.equal(walkable(mx, mz), true, `${L.id}: open in its phase`);
    labRun.now = (1 - set) * L.shift.every + 1; assert.equal(walkable(mx, mz), false, `${L.id}: shut in the other`);
  }
  labRun.now = g.time;
  // bridges: narrow; off the side is a drop
  const [bi, bj, bd] = [...ISLE.open].find(e => !ISLE.inHallCell(...e.split(',').map(Number))).split(','), C = ISLE.cell;
  const bx = bd === 'E' ? ISLE.x0 + (+bi + 1) * C : ISLE.x0 + (+bi + 0.5) * C, bz = bd === 'E' ? ISLE.z0 + (+bj + 0.5) * C : ISLE.z0 + (+bj + 1) * C;
  assert.equal(walkable(bx, bz), true, 'on the bridge'); assert.ok(onBridge(ISLE, bx, bz));
  assert.equal(walkable(bd === 'E' ? bx : bx + ISLE.bridge + 0.4, bd === 'E' ? bz + ISLE.bridge + 0.4 : bz), false, 'off its side: a drop');
  assert.ok(windAt(ISLE, 0) && !windAt(WOOD, 0), 'wind only on the causeways');
  // mobs and keepers
  const by = id => [...g.mobs.values()].filter(m => !m.dead && labAt(m.x, m.z)?.id === id);
  assert.ok(by('drownedwood').some(m => m.type === 'mosshag') && by('turningisles').some(m => m.type === 'kiterider'), 'the hearers');
  assert.ok(g.labs.heartwillow.keeper?.type === 'motherofmire' && g.labs.eyespire.keeper?.type === 'galematriarch', 'the keepers');
  // stairs: in from Floor 2's field, out before the Sunken Gate
  const inn = stairsOf(LABS[2])[0]; at(a, inn.x, inn.z); g.handle(a, { type: 'lab', a: 'stair' });
  assert.equal(labAt(a.x, a.z), REED, 'into the Reedmarch');
  const out = stairsOf(LABS[3]).find(s => s.kind === 'out'); at(a, out.x, out.z); g.handle(a, { type: 'lab', a: 'stair' });
  assert.ok(!labAt(a.x, a.z) && Math.hypot(a.x - LABS[3].exitTo.x, a.z - LABS[3].exitTo.z) < 3, 'out before the Storm Gate');
  ok('Floors 2 and 3: tide and spans keep the maze whole and open on their clocks; narrow bridges; wind; hearers and keepers; stairs');
}
{
  // a shifting way that shuts on you pushes you out of it
  const L = REED, [e, set] = [...L.shiftEdges][0], [i, j, d] = e.split(','), C = L.cell;
  const lx = L.x0 + (+i + 1) * C, cz = L.z0 + (+j + 0.5) * C, cx = L.x0 + (+i + 0.5) * C, lz = L.z0 + (+j + 1) * C;
  g.time = Math.ceil(g.time / L.shift.every / 2) * L.shift.every * 2 + (1 - set) * L.shift.every + 1; // (the other phase)
  at(a, d === 'E' ? lx - 0.2 : cx, d === 'E' ? cz : lz - 0.2); g.update(0.05);
  assert.ok(walkable(a.x, a.z) && edgeSide(L, e, a.x, a.z) !== 0, 'out of the shut way');
  // the wisps: a true one and a false one; walking into the false one's dead end brings up lurkers
  const S = g.labs.drownedwood; at(a, ...startPoint(WOOD)); a.testWard = true; tick(0.2);
  S.breatheAt = g.time; g.events = []; tick(0.1);
  const w = evs('lab', 'wisps')[0]; assert.ok(w && w.sets[0].w.length === 2, 'two wisps');
  const lie = S.ambush[0]; assert.ok(lie, 'an ambush waits');
  const before = [...g.mobs.values()].filter(m => m.labTemp === 'drownedwood').length;
  at(a, ...WOOD.center(lie.c)); tick(0.1);
  assert.ok([...g.mobs.values()].filter(m => m.labTemp === 'drownedwood').length > before && evs('lab', 'ambush').length === 1, 'lurkers rise at the false light');
  // the squall: strikes marked, then they land
  const Q = g.labs.turningisles; at(a, ...startPoint(ISLE)); tick(0.2);
  Q.breatheAt = g.time; g.events = []; tick(0.1);
  const st = evs('lab', 'strike'); assert.ok(st.length >= ISLE.breathe.rise, 'strikes marked');
  a.testWard = false; a.hp = a.maxHp; at(a, st[0].x, st[0].z); tick(ISLE.breathe.strike.wind + 0.2);
  assert.ok(a.hp < a.maxHp, 'standing in the glow hurts');
  for (const m of [...g.mobs.values()]) if (m.labTemp) { m.threat.clear(); m.labTtl = 0; } tick(0.1);
  ok('the shifting ways push you clear; the wisps (a false one hides lurkers); the squall');
}
{
  // the Mother of Mire: under (hard to hurt), bursts up at the ripples, stranded (easy to hurt)
  const k = g.labs.heartwillow.keeper, [hx, hz] = hallCenter(HEART), D = KEEPERS.motherofmire.dive;
  at(a, hx, hz - 5); a.hp = a.maxHp; a.testWard = false; g.events = [];
  k.x = hx; k.z = hz; k.threat.set(a.id, 10); k.kp = null; k.labEngaged = false;
  tick(D.first + 0.1);
  const dv = evs('lab', 'dive')[0]; assert.ok(dv, 'she dives');
  let hp = k.hp; g.damageMob(k, a, 100); assert.ok(hp - k.hp < 40, 'hard to hurt under the water');
  a.testWard = true; tick(D.wind + 0.1);
  assert.ok(evs('lab', 'erupt').length === 1, 'bursts up');
  hp = k.hp; g.damageMob(k, a, 100); assert.ok(hp - k.hp > 120, 'stranded: easy to hurt');
  // the Gale Matriarch: a lane, a perch, the gale
  const q = g.labs.eyespire.keeper, [sx, sz] = hallCenter(SPIRE), A = KEEPERS.galematriarch;
  at(a, sx, sz - 6); g.events = [];
  q.x = sx; q.z = sz; q.threat.set(a.id, 10); q.kp = null; q.labEngaged = false;
  tick(A.lane.first + 0.1); assert.ok(evs('lab', 'lane').length === 1, 'marks a lane');
  tick(A.lane.wind + 0.1); assert.ok(evs('lab', 'perch').length === 1, 'dives and perches');
  hp = q.hp; g.damageMob(q, a, 100); assert.ok(hp - q.hp > 130, 'perched: easy to hurt');
  tick(A.gale.first); assert.ok(evs('lab', 'gale').length >= 1, 'the gale');
  // the Tide Lock and the Storm Lock; the keys
  a.stats.lab2Keys = 0; a.stats.sovereignKills = 0;
  assert.equal(g.labGateOk(2, [a]), false, 'no Tide Key: locked');
  k.contributors.add(a.id); k.hp = 1; g.killMob(k, a);
  assert.equal(a.stats.lab2Keys, 1, 'the Tide Key'); assert.equal(g.labGateOk(2, [a]), true);
  a.stats.lab3Keys = 0; a.stats.colossusKills = 0; assert.equal(g.labGateOk(3, [a]), false, 'no Storm Key: locked');
  a.testWard = false;
  ok('the Mother of Mire (dive, burst, stranded) and the Gale Matriarch (lane, perch, gale); the Tide and Storm Locks and keys');
}

console.log(`labyrinth: ${n} checks passed`);
process.exit(0);
