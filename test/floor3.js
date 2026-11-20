// In-process checks for Floor 3 — The Gale Spires (docs/floor3.md, ROADMAP H4): unlock and travel (the Stairway from
// the Sunken Court, waypoints, respawn at Windbreak Camp), the field enemies' mechanics (harpies aloft, sentinel armour,
// the acolyte's Wind Ward, the ram's charge and a Guardian bracing it), the Storm Colossus (health scaling, Overload
// stopped by Break + Switch / Team Burst / a solo Break, Thunderclap, the Tempest Beam, Gale Push), forceBossMove's
// Colossus moves, level cap 30 progression, the Floor 3 drop tables and the Stormforged set, and the bots' beam timing.
// Usage: node test/floor3.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { MAX_LEVEL, MOB_IDS, MOBS, OBSTACLES, xpToNext } from '../shared/data.js';
import { F3, COLOSSUS, HARPY, ACOLYTE, SENTINEL, RAM, STAIRWAY3, WAYPOINT3, F3_TWISTS, inArena3 } from '../shared/floor3.js';
import { F2, floorUnlocked, floorOf, WAYPOINTS, nearWaypoint, nearWaystone, WAYSTONES } from '../shared/floor2.js';
import { pointsAt, MILESTONES } from '../shared/talents.js';
import { loadoutFor } from '../shared/playerbots.js';
import { lootFor, SETS, makeSetPiece } from '../shared/loot.js';
import { beamEta } from '../shared/bots/floor3.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const quiet = f => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const newGame = () => quiet(() => new Game());
const A = F3.arena;
const evs = (g, t, k) => g.events.filter(e => e.t === t && (!k || e.k === k || e.s === k));
function advance(g, dt) { // time + scheduled callbacks only (no AI)
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
  }
}
function arena(classes = ['guardian', 'swordsman', 'cleric'], lvl = 30) {
  const g = newGame();
  process.env.F3_TWIST = 'calm'; g.newTwist3();
  const C = g.colossus;
  const ps = classes.map((c, i) => {
    const p = g.addPlayer(null, `P${i}`, c);
    p.lvl = lvl; g.recompute(p); p.hp = p.maxHp; p.x = A.x + i * 4 - 4; p.z = A.z - 8; p.stats.floor3 = 1;
    return p;
  });
  g.time = 30; g.events = [];
  quiet(() => g.engageColossus(C));
  for (const p of ps) C.threat.set(p.id, 1);
  return { g, C, ps };
}

// ---------- the map, ids, progression ----------
{
  assert.equal(floorOf(1200), 3); assert.equal(floorOf(600), 2); assert.equal(floorOf(0), 1);
  assert.ok(MOB_IDS.indexOf('colossus') > MOB_IDS.indexOf('sovereign'), 'Floor 3 enemies are appended after Floor 2 (type indices never move)');
  assert.ok(WAYPOINTS.some(w => w.floor === 3 && w.x === WAYPOINT3.x), 'Windbreak Camp has a waypoint');
  // each town's centrepiece is its waypoint: an obstacle of its own, usable from just outside it; no crystals left
  for (const [f, kind] of [[1, 'fountain'], [2, 'campfire'], [3, 'brazier']]) {
    const w = WAYPOINTS.find(w => w.floor === f), o = OBSTACLES.find(o => o.kind === kind && o.x === w.x && o.z === w.z);
    assert.ok(w.kind === kind && o && o.r === w.r, `Floor ${f}'s waypoint is its ${kind}`);
    assert.ok(w.use > w.r + 0.5 + 0.6, `the ${kind} can be used from outside its collision ring`);
    assert.equal(nearWaypoint(w.x, w.z + w.r + 0.6), w); assert.equal(nearWaypoint(w.x, w.z + w.use + 0.1), undefined);
  }
  assert.ok(!OBSTACLES.some(o => o.kind === 'waystone'), 'the old waystone crystals are gone');
  assert.ok(WAYSTONES === WAYPOINTS && nearWaystone === nearWaypoint, 'old names still work');
  assert.equal(MAX_LEVEL, 30); assert.equal(pointsAt(30), 29); assert.equal(xpToNext(29), 1450);
  const lo = loadoutFor(30); assert.equal(lo.rarityName, 'Epic'); assert.equal(lo.mastery, 5);
  assert.ok(MILESTONES.some(m => m.lvl === 21 && /Floor 3/.test(m.text)) && MILESTONES.some(m => m.lvl === 25 && /Colossus/.test(m.text)));
  const g = newGame();
  const p = g.addPlayer(null, 'Lv', 'swordsman'); p.lvl = 29; p.xp = 0; quiet(() => g.giveXp(p, xpToNext(29) + 5000));
  assert.equal(p.lvl, 30, 'levels up to 30 and stops there');
  ok('Floor 3 map / ids, level cap 30: XP curve, talent points, Epic + Mastery 5 bot loadout, milestones');
}

// ---------- unlock and travel ----------
{
  const g = newGame();
  const p = g.addPlayer(null, 'Trav', 'guardian'); p.lvl = 25; g.recompute(p);
  assert.equal(floorUnlocked(p.stats, 3), false, 'sealed at first');
  const w2 = WAYPOINTS.find(w => w.floor === 2);
  p.x = w2.x; p.z = w2.z + w2.r + 1; p.stats.floor2 = 1; g.events = [];
  quiet(() => g.warp(p, 3));
  assert.ok(p.x < F3.split, 'the waypoint refuses Floor 3 while sealed');
  // the Sovereign falls with p fighting: Floor 3 opens and the Stairway appears in the Sunken Court
  const S = g.sovereign; S.contributors.add(p.id); p.x = F2.arena.x; p.z = F2.arena.z;
  quiet(() => g.killSovereign(S, p));
  assert.ok(floorUnlocked(p.stats, 3), 'helping kill the Sovereign unlocks Floor 3');
  assert.ok(g.portal3 && evs(g, 'stair').some(e => e.f === 3 && e.x === STAIRWAY3.x), 'the Stairway up to Floor 3 opens');
  p.x = STAIRWAY3.x; p.z = STAIRWAY3.z; g.events = [];
  quiet(() => g.warp(p, 3));
  assert.ok(Math.hypot(p.x - F3.camp.x, p.z - F3.camp.z) < F3.camp.r && evs(g, 'warp').some(e => e.f === 3), 'the Stairway takes you to Windbreak Camp');
  const [rx, rz] = g.respawnPoint({ ...p, x: A.x, z: A.z });
  assert.ok(Math.hypot(rx - F3.camp.x, rz - F3.camp.z) < F3.camp.r, 'deaths on Floor 3 respawn at Windbreak Camp');
  p.x = WAYPOINT3.x; p.z = WAYPOINT3.z + WAYPOINT3.r + 1;
  quiet(() => g.warp(p, 1));
  assert.equal(floorOf(p.x), 1, 'the Floor 3 waypoint (the brazier) goes back down');
  ok('unlock (Sovereign kill), the Stairway from the Sunken Court, waypoints both ways, respawn at Windbreak Camp');
}

// ---------- field enemies ----------
{
  const g = newGame();
  const p = g.addPlayer(null, 'F', 'ranger'); p.lvl = 25; g.recompute(p);
  const h = [...g.mobs.values()].find(m => m.type === 'harpy');
  p.x = h.x + 2; p.z = h.z;
  assert.equal(Math.round(g.f3DamageMod(h, p, 100)), Math.round(100 * HARPY.aloft), 'harpy aloft: melee does 35%');
  p.x = h.x + 10;
  assert.equal(g.f3DamageMod(h, p, 100), 100, 'harpy aloft: ranged from 6 m+ does full damage');
  h.state = 'grounded'; p.x = h.x + 2;
  assert.equal(g.f3DamageMod(h, p, 100), 100, 'a grounded harpy takes full melee damage');
  const s = [...g.mobs.values()].find(m => m.type === 'sentinel');
  p.x = s.x + 2; p.z = s.z;
  assert.equal(Math.round(g.f3DamageMod(s, p, 100)), Math.round(100 * (1 - MOBS.sentinel.armor)), 'sentinel armour soaks 55%');
  g.time = 50; quiet(() => g.breakMob(s, p)); g.events = [];
  g.f3Sentinel(s, 0.05);
  assert.ok(evs(g, 'f3fx', 'crack').length && s.crackedUntil > g.time, 'a Break cracks its shell');
  s.staggerUntil = 0;
  assert.equal(g.f3DamageMod(s, p, 100), 100, 'cracked: full damage');
  // acolyte: Wind Ward over its allies, interrupted by 3 hits during the channel
  const a = [...g.mobs.values()].find(m => m.type === 'acolyte');
  a.x = a.sx = 1200; a.z = a.sz = 120; const ally = [...g.mobs.values()].find(m => m.type === 'sentinel' && m !== s); ally.x = 1205; ally.z = 120;
  p.x = 1200; p.z = 110; a.threat.set(p.id, 1); a.wardT = g.time; g.events = [];
  g.f3Acolyte(a, 0.05);
  assert.ok(a.chan && evs(g, 'f3fx', 'chan').length, 'the acolyte channels a Wind Ward');
  g.time += ACOLYTE.channel + 0.1; g.f3Acolyte(a, 0.05);
  assert.ok(ally.ward > 0 && evs(g, 'f3fx', 'ward').length, 'not interrupted: allies within 12 m get a shield');
  const soaked = g.f3DamageMod(ally, p, 100); assert.ok(soaked < 100, 'the ward soaks damage');
  a.wardT = g.time; g.f3Acolyte(a, 0.05); g.events = [];
  for (let i = 0; i < ACOLYTE.breakHits; i++) g.f3DamageMod(a, p, 10);
  g.f3Acolyte(a, 0.05);
  assert.ok(!a.chan && evs(g, 'f3fx', 'interrupt').length, '3 hits during the channel interrupt it');
  // ram: a charge throws you back; a Guardian guarding it head-on stops it dead
  const r = [...g.mobs.values()].find(m => m.type === 'ram');
  const v = g.addPlayer(null, 'V', 'swordsman'); v.lvl = 25; g.recompute(v); v.hp = v.maxHp;
  r.x = 1180; r.z = 60; v.x = 1180; v.z = 66; r.lane = { x0: r.x, z0: r.z, ux: 0, uz: 1 };
  g.ramGo(r); const z0 = v.z;
  for (let i = 0; i < 20; i++) { g.time += 0.05; g.updateFloor3(0.05); }
  assert.ok(v.hp < v.maxHp && v.z > z0 + 3, `hit and thrown back (${(v.z - z0).toFixed(1)} m)`);
  const gd = g.addPlayer(null, 'G', 'guardian'); gd.lvl = 25; g.recompute(gd); gd.hp = gd.maxHp;
  r.x = 1196; r.z = 40; r.state = null; r.stunUntil = 0; gd.x = 1196; gd.z = 46; gd.face = Math.PI; gd.guarding = true; r.lane = { x0: r.x, z0: r.z, ux: 0, uz: 1 };
  g.ramGo(r); g.events = [];
  for (let i = 0; i < 20; i++) { g.time += 0.05; g.updateFloor3(0.05); }
  assert.ok(evs(g, 'f3fx', 'braced').length && r.stunUntil > g.time && Math.abs(gd.z - 46) < 0.01, 'braced: the ram is stopped and stunned, the Guardian holds');
  ok('field: harpies aloft vs ranged / grounded, sentinel armour and cracking, Wind Ward + interrupt, ram charge + Guardian brace');
}

// ---------- the Storm Colossus: scaling, Overload ----------
{
  const trio = arena().C.maxHp, six = arena(['guardian', 'swordsman', 'cleric', 'ranger', 'berserker', 'lancer']).C;
  assert.ok(six.maxHp > trio * 1.8 && six.def.atk > MOBS.colossus.atk, `health scales with the party (${trio} / ${six.maxHp}), damage with headcount`);
  ok(`health scaling: trio ${trio}, six ${six.maxHp}`);
}
{ // party: Break, then a Switch from someone else
  const { g, C, ps } = arena();
  quiet(() => g.startOverload(C, ps));
  assert.ok(C.ov && C.posture > 0 && evs(g, 'f3ov', 'start').length, 'Overload starts with its guard open');
  quiet(() => g.breakMob(C, ps[0])); g.updateOverload(C);
  assert.ok(C.ov && C.ov.broke, 'Broken, but a party still needs the Switch');
  C.switched = true; g.events = [];
  quiet(() => g.updateOverload(C));
  assert.ok(!C.ov && evs(g, 'f3ov', 'stop').some(e => e.by === 'switch') && C.groundedUntil > g.time, 'Break + Switch stops it: Grounded');
  assert.ok(g.f3DamageMod(C, ps[1], 100) === Math.round(100 * COLOSSUS.overload.weak), 'Grounded: +30% damage taken');
  ok('Overload: Break + Switch stops it, the Colossus is Grounded (+30%)');
}
{ // Team Burst during the channel
  const { g, C, ps } = arena();
  quiet(() => g.startOverload(C, ps));
  quiet(() => g.breakMob(C, ps[0])); g._tbIn = true; g.f3DamageMod(C, ps[1], 10); g._tbIn = false;
  quiet(() => g.updateOverload(C));
  assert.ok(!C.ov && evs(g, 'f3ov', 'stop').some(e => e.by === 'burst'));
  ok('Overload: a Team Burst into the Broken Colossus stops it');
}
{ // solo: a Break alone
  const { g, C, ps } = arena(['swordsman']);
  quiet(() => g.startOverload(C, ps));
  assert.ok(C.ov.solo);
  quiet(() => g.breakMob(C, ps[0])); quiet(() => g.updateOverload(C));
  assert.ok(!C.ov && evs(g, 'f3ov', 'stop').some(e => e.by === 'break'));
  ok('Overload solo: a Break alone stops it');
}
{ // not stopped: Thunderclap (rolls don't dodge it), Charged
  const { g, C, ps } = arena();
  quiet(() => g.startOverload(C, ps));
  ps[1].iframeUntil = g.time + 99;
  g.time = C.ov.until + 0.01; quiet(() => g.updateOverload(C));
  const lost = ps.map(p => 1 - p.hp / p.maxHp);
  assert.ok(evs(g, 'f3ov', 'clap').length && C.chargedUntil > g.time, 'Thunderclap, then Charged');
  assert.ok(lost.every(l => l > 0.2), `everyone on the plateau is hit, i-frames or not (${lost.map(l => Math.round(l * 100)).join('/')}% lost)`);
  assert.ok(g.f3Atk(C) > C.def.atk, 'Charged: it hits harder');
  ok('Overload failed: Thunderclap hits everyone (a roll doesn\'t dodge it), the Colossus is Charged');
}

// ---------- Tempest Beam, Gale Push ----------
{
  const { g, C, ps } = arena(['swordsman', 'swordsman']);
  C.x = A.x; C.z = A.z; C.face = 0; // the beam starts pointing +z and turns
  const [a, b] = ps;
  a.x = A.x + 8; a.z = A.z; b.x = A.x - 8; b.z = A.z; // a quarter turn either way
  g.tempestBeam(C);
  const beam = g.beams[0];
  b.airFrom = 0; b.airUntil = 999; // b jumps the whole time
  const hpA = a.hp, hpB = b.hp;
  for (let i = 0; i < Math.ceil((COLOSSUS.beam.wind + COLOSSUS.beam.turn) / 0.05) + 4; i++) { g.time += 0.05; g.updateFloor3(0.05); }
  assert.ok(a.hp < hpA, 'the beam hits a fighter on the ground as it sweeps past');
  assert.equal(b.hp, hpB, 'a jumping fighter clears it');
  assert.ok(evs(g, 'f3beam').length && beam.hit.has(a.id), 'beam event + hit list');
  // the bots' beam timing agrees with the server: a bot ahead of the beam sees it coming
  const bot = { x: A.x + 8, z: A.z, clock: () => 0, beams: [{ x: A.x, z: A.z, a0: 0, dir: 1, start: 1, turn: 7, w: COLOSSUS.beam.w, len: COLOSSUS.beam.len }] };
  const e = beamEta(bot, 0);
  assert.ok(e && Math.abs((e.tIn + e.tOut) / 2 - (1 + 7 / 4)) < 0.05, `bots: the beam reaches a bot a quarter turn round after 1/4 of the turn (eta ${e && e.tIn.toFixed(2)})`);
  ok('Tempest Beam: hits fighters on the ground as it passes, jumps clear it; bots time it right');
}
{
  const { g, C, ps } = arena(['swordsman', 'swordsman']);
  C.x = A.x; C.z = A.z; const [front, back] = ps;
  front.x = A.x; front.z = A.z - 5; back.x = A.x; back.z = A.z + 5;
  const z0 = front.z, hb = back.hp;
  g.galePush(C, front);
  advance(g, COLOSSUS.gust.wind + 0.1);
  assert.ok(front.hp < front.maxHp && front.z < z0 - 3, 'Gale Push: hit and shoved back');
  assert.equal(back.hp, hb, 'standing behind it is safe');
  ok('Gale Push: the cone in front hits and shoves, behind is safe');
}

// ---------- forceBossMove, snapshot, twists ----------
{
  const { g, C, ps } = arena();
  for (const mv of ['hammerfall', 'lightning', 'gale_push', 'tempest_beam', 'overload']) { C.busyUntil = 0; C.ov = null; assert.equal(g.forceBossMove(C, mv, ps[0].id), true, mv); }
  assert.equal(g.forceBossMove(C, 'meteor', ps[0].id), true, 'G4 team moves still work on the Colossus');
  assert.equal(g.forceBossMove(C, 'quake', ps[0].id), false, 'not the Warden\'s moves');
  const snap = JSON.parse(g.snapshot()).f3 ?? g.f3Snap();
  assert.ok(snap.gate && 'ov' in snap && Array.isArray(snap.air), 'w.f3 in the snapshot');
  assert.ok(Object.keys(F3_TWISTS).length >= 4 && F3_TWISTS[g.twist3.id], 'a twist per spawn');
  ok('forceBossMove: the Colossus\'s moves (and G4 team moves); w.f3 snapshot; twist pool');
}

// ---------- loot ----------
{
  const L = lootFor('boss:colossus');
  assert.ok(L.item === 2 && L.sets.some(s => s.id === 'stormforged'), 'the Colossus drops from shared/loot.js with the Stormforged set');
  for (const k of ['mob:ram', 'mob:harpy', 'mob:acolyte', 'mob:sentinel', 'rare:skyrender', 'rare:bastion']) assert.ok(lootFor(k)?.gold[1] > 0, k);
  const S = SETS.stormforged, piece = makeSetPiece('stormforged', 'charm', 'guardian');
  assert.ok(S.floor === 3 && piece.set === 'stormforged' && piece.name === 'Stormforged Sigil');
  // Stormcall: a Switch hit on a Broken boss hits harder and takes time off the Break skill
  const { g, C, ps } = arena(['guardian', 'swordsman']);
  const [gd, sw] = ps;
  for (const s of ['weapon', 'armor', 'charm']) { const it = makeSetPiece('stormforged', s, 'swordsman'); sw.inv.eq[s] = it; }
  g.recompute(sw);
  assert.ok(sw.tal.gear.keys.stormcall, 'three pieces: Stormcall');
  sw.cds[3] = g.time + 10;
  quiet(() => g.breakMob(C, gd)); g.events = [];
  quiet(() => g.damageMob(C, sw, 50));
  assert.ok(evs(g, 'tproc', 'stormcall').length && sw.cds[3] <= g.time + 8.01, 'Stormcall procs on the Switch and refunds 2 s');
  ok('loot: Floor 3 entries in shared/loot.js, the Stormforged set and its Stormcall bonus');
}

// ---------- a scripted clear (bell + Hall) ----------
{
  const { g, C, ps } = arena();
  g.hadFirstClear3 = false; const rung = []; g.ringBell = (f, o) => rung.push(f); const clears = []; g.onClear = c => clears.push(c);
  for (const p of ps) C.contributors.add(p.id);
  quiet(() => g.killMob(C, ps[1]));
  assert.ok(evs(g, 'clear3').length && evs(g, 'la3').some(e => e.id === ps[1].id), 'clear + Last Attack Bonus');
  assert.ok(ps[1].inv.bag.some(it => it.name === 'Stormheart') || Object.values(ps[1].inv.eq).some(it => it?.name === 'Stormheart'), 'the Stormheart');
  assert.deepEqual(rung, [3], 'the first clear rings the third bell');
  assert.ok(clears[0]?.floor === 3 && ps.every(p => p.stats.colossusKills === 1), 'recorded for the Hall, Stormbreaker progress');
  ok('kill: Last Attack Stormheart, the third bell, Hall row, colossusKills');
}
delete process.env.F3_TWIST;
console.log(`floor3: ${n} checks passed`);
process.exit(0);
