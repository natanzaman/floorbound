// In-process checks for multi-area boss fights (docs/ROADMAP.md J2, shared/arenas.js + server/arenas.js): the Storm
// Colossus's fall from the Eye of the Storm to the Undercroft. Everyone in the room switches area and lands clear of the
// new pillars, walls and sludge; late joiners get the area from the snapshot; a wipe and a respawn put it back; the
// fall waits while a team-scale mechanic runs (Overload, a G4 move, a J1 trap, a wind-up) and `gap` s after; it fires
// once even when a burst skips a phase; bleed-out pauses on the landing; inputs freeze while falling; sludge slows and
// stops rolls; fire patterns burn only while lit; the great pillars block the Tempest Beam; the director's 'fall';
// the bots' hazard helpers.
// Usage: node test/arenas.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { F3, COLOSSUS } from '../shared/floor3.js';
import { resolveCollision, OBSTACLES } from '../shared/data.js';
import {
  ARENAS, FIRE_MAX, arenaState, AREA_COLLIDERS, sludgeAt, fireAt, inCollider, losBlocked, speedAt, applyArenaSnap, serverOwnsArenas, freeSpot,
} from '../shared/arenas.js';
import { hazardStep, coverSpot } from '../shared/bots/arenas.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const quiet = f => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const A = F3.arena, AR = ARENAS.colossus, T = AR.timing, U = AR.areas[1];
const FALL = T.crack + T.fall + T.land + T.enter;
const at = (dx, dz) => [A.x + dx, A.z + dz];
const evs = (g, s) => g.events.filter(e => e.t === 'arena' && (!s || e.s === s));

function setup(classes = ['guardian', 'swordsman', 'cleric']) {
  process.env.F3_TWIST = 'calm';
  const g = quiet(() => new Game());
  g.newTwist3();
  const C = g.colossus;
  const ps = classes.map((c, i) => {
    const p = g.addPlayer(null, `P${i}`, c);
    p.lvl = 30; g.recompute(p); p.hp = p.maxHp; p.stats.floor3 = 1;
    [p.x, p.z] = at(i * 4 - 4, -8);
    return p;
  });
  for (const p of ps.slice(1)) { g.invite(ps[0], p.id); g.accept(p, ps[0].id); }
  g.time = 30; g.events = [];
  quiet(() => g.engageColossus(C));
  for (const p of ps) { C.threat.set(p.id, 1); g.protect(p, 0.9); }
  return { g, C, ps };
}
function tick(g, secs, each) {
  const end = g.time + secs;
  while (g.time < end - 1e-9) { g.events = []; quiet(() => g.update(0.05)); each?.(); }
}
// Run until the fall reaches `stage` (2 crack .. 5 enter, 0 = done) or `secs` pass. Returns the arena events seen.
function until(g, C, test, secs = 30) {
  const seen = [];
  const end = g.time + secs;
  while (g.time < end && !test()) { tick(g, 0.05); seen.push(...evs(g)); }
  return seen;
}
const hp = (C, f) => { C.hp = Math.round(C.maxHp * f); };

// ---------- data ----------
{
  assert.ok(U.colliders.some(o => o.los && o.kind === 'pillar'), 'at least one line-of-sight pillar');
  assert.ok(U.pools.length >= 1 && U.slow < 1, 'sludge pools with a strong slow');
  for (const pat of U.fire.spots) assert.ok(pat.length > 0 && pat.length <= FIRE_MAX, 'fire patterns: at most 10 patches');
  assert.ok(Math.abs(U.fire.tick - 0.2) < 1e-9, 'fire checked at 5 Hz');
  const pylons = OBSTACLES.filter(o => o.kind === 'pylon');
  for (const o of U.colliders) {
    assert.ok(Math.hypot(o.x - A.x, o.z - A.z) + o.r < A.r - 1, 'colliders inside the room');
    for (const q of pylons) assert.ok(Math.hypot(o.x - q.x, o.z - q.z) > o.r + q.r + 1, 'colliders clear of the storm pylons');
    for (const p of U.pools) assert.ok(Math.hypot(o.x - p.x, o.z - p.z) > o.r + p.r, 'sludge clear of colliders');
  }
  for (const pat of U.fire.spots) for (const s of pat) for (const o of [...U.colliders, ...pylons]) assert.ok(Math.hypot(s.x - o.x, s.z - o.z) > s.r + o.r, 'fire clear of colliders');
  // the way in from the gate stays open
  for (let z = A.z - A.r; z < A.z - 18; z += 0.5) assert.ok(!U.colliders.some(o => Math.hypot(A.x - o.x, z - o.z) < o.r + 1), 'the entrance is clear');
  ok('the Undercroft: pillars (line of sight), walls, sludge, fire patterns of at most 10 checked at 5 Hz, a clear way in');
}

// ---------- the fall: everyone switched, nobody stuck, late joiners ----------
{
  const { g, C, ps } = setup();
  assert.equal(C.area || 0, 0); assert.equal(AREA_COLLIDERS.length, 0, "no extra colliders up on the Eye");
  // stand where the Undercroft's pillar, sludge and north wall will be
  const pil = U.colliders.find(o => o.los), pool = U.pools[0], wall = U.colliders.find(o => o.kind === 'wall');
  [ps[0].x, ps[0].z] = [pil.x + 0.3, pil.z]; [ps[1].x, ps[1].z] = [pool.x, pool.z]; [ps[2].x, ps[2].z] = [wall.x, wall.z];
  hp(C, 0.6);
  let seen = until(g, C, () => C.ar?.stage === 2);
  assert.equal(C.ar.stage, 2, 'phase 2 starts the crack');
  assert.ok(seen.some(e => e.s === 'crack' && e.d === T.crack), 'crack event with its warning time');
  assert.equal(C.area || 0, 0, "still on the Eye while it cracks");
  seen = until(g, C, () => C.area === 1);
  assert.ok(seen.some(e => e.s === 'fall'), 'fall event');
  assert.equal(arenaState('colossus').area, 1); assert.ok(AREA_COLLIDERS.length > 0, 'the Undercroft colliders are live');
  for (const p of ps) {
    assert.ok(!inCollider(p.x, p.z, 0.45), `${p.name} isn't inside a pillar or wall`);
    assert.ok(!sludgeAt(p.x, p.z), `${p.name} didn't land in sludge`);
    assert.ok(Math.hypot(p.x - A.x, p.z - A.z) < A.r, `${p.name} is still in the room`);
    const [rx, rz] = resolveCollision(p.x, p.z); assert.ok(Math.hypot(rx - p.x, rz - p.z) < 1e-6, 'collision leaves them where they are');
  }
  assert.ok(!inCollider(C.x, C.z, C.def.radius), 'the boss lands clear too');
  // frozen while falling / landing: inputs are ignored
  const p0 = ps[0], x0 = p0.x;
  g.handle(p0, { type: 'input', x: p0.x + 0.5, z: p0.z, face: 0, seq: p0.posSeq });
  assert.equal(p0.x, x0, 'no moving while falling');
  // the boss can't be hurt while it's out of reach
  assert.equal(g.f3DamageMod(C, p0, 100), 0, 'the boss is out of reach while falling');
  // late joiner: the snapshot carries the area
  const late = g.addPlayer(null, 'Late', 'ranger');
  const snap = g.f3Snap();
  assert.ok(Array.isArray(snap.ar?.colossus) && snap.ar.colossus[0] === 1, 'w.f3.ar tells a late joiner the area');
  seen = until(g, C, () => C.ar.stage === 0, 10);
  assert.ok(seen.some(e => e.s === 'land') && seen.some(e => e.s === 'enter') && seen.some(e => e.s === 'resume'), 'land, enter, resume');
  assert.ok(g.f3DamageMod(C, p0, 100) > 0, 'hittable again after its entrance');
  g.handle(p0, { type: 'input', x: p0.x + 0.3, z: p0.z, face: 0, seq: p0.posSeq });
  assert.ok(C.ovT >= g.time + T.gap - FALL, 'Overload waits `gap` s after the fight resumes');
  // a client process (not the server's): applyArenaSnap sets the same state
  const ar = JSON.parse(JSON.stringify(g.f3Snap().ar));
  serverOwnsArenas(false);
  applyArenaSnap({ colossus: [0, 0, 0, 0, 0, 0] }); assert.equal(AREA_COLLIDERS.length, 0);
  applyArenaSnap(ar); assert.equal(arenaState('colossus').area, 1); assert.ok(AREA_COLLIDERS.length > 0, 'a client gets the colliders from the snapshot');
  serverOwnsArenas(true);
  const [px, pz] = resolveCollision(pil.x + 0.2, pil.z); assert.ok(Math.hypot(px - pil.x, pz - pil.z) >= pil.r, 'resolveCollision pushes out of a pillar');
  late.x = A.x; late.z = A.z - A.r + 0.5;
  ok('the fall: crack → fall → land → enter; everyone switched, nobody in a pillar, wall or sludge; frozen and unhittable boss while falling; late joiners get the area');

  // fires once: back to phase 3 (a burst skipped through), no second fall
  hp(C, 0.2);
  seen = until(g, C, () => C.ar.stage > 0, 12);
  assert.equal(C.ar.stage, 0, 'no second fall'); assert.equal(C.area, 1);
  ok('the fall fires once per fight');

  // a wipe resets it
  quiet(() => g.resetColossus(C));
  tick(g, 0.1);
  assert.equal(C.area, 0); assert.equal(AREA_COLLIDERS.length, 0, 'a wipe puts the Eye back');
  ok('a wipe resets the area');
}

// ---------- fires once even when a burst skips a phase; respawn resets ----------
{
  const { g, C, ps } = setup();
  hp(C, 0.2); // straight from phase 1 to phase 3
  until(g, C, () => C.area === 1);
  assert.equal(C.area, 1, 'a skipped phase still falls');
  until(g, C, () => C.ar.stage === 0, 10);
  const falls = [];
  tick(g, 6, () => falls.push(...evs(g, 'crack')));
  assert.equal(falls.length, 0, 'once');
  // a kill: the room stays; the respawn resets it
  quiet(() => g.killMob(C, ps[0]));
  tick(g, 0.1);
  assert.equal(C.area, 1, 'after a kill the room stays as it is');
  C.deadUntil = g.time; tick(g, 0.2);
  assert.ok(!C.dead); assert.equal(C.area, 0, 'the respawn resets it'); assert.equal(AREA_COLLIDERS.length, 0);
  ok('a burst that skips a phase still falls (once); after a kill it stays; the respawn resets it');
}

// ---------- deferred while a team-scale mechanic runs ----------
{
  const { g, C, ps } = setup();
  quiet(() => g.startOverload(C, ps));
  hp(C, 0.6);
  tick(g, 2);
  assert.equal(C.ar?.stage, 1, 'pending while Overload channels');
  const fakeBt = { m: C };
  C.ov = null; C.busyUntil = 0; (g.btActive ||= []).push(fakeBt); // a G4 move
  tick(g, 2); assert.equal(C.ar.stage, 1, 'pending while a G4 move runs');
  g.btActive = g.btActive.filter(a => a !== fakeBt);
  ps[1].trap = { k: 'crystal' }; // a J1 trap
  tick(g, 2); assert.equal(C.ar.stage, 1, 'pending while someone is trapped');
  delete ps[1].trap;
  const since = g.time;
  const seen = until(g, C, () => C.ar.stage >= 2, 15);
  assert.ok(seen.some(e => e.s === 'crack'));
  assert.ok(g.time - since >= T.gap - 0.1, `the fall waits ${T.gap} s after the last team mechanic (${(g.time - since).toFixed(1)} s)`);
  assert.ok(!C.ov && !(g.btActive || []).some(a => a.m === C), 'nothing else running when it cracks');
  ok('deferred while Overload, a G4 move or a J1 trap runs, and `gap` s after the last one; no Overload starts while it is pending');

  // a wind-up: the crack waits for it
  const s2 = setup();
  s2.C.windupAt = s2.g.time + 0.8; hp(s2.C, 0.6);
  tick(s2.g, 0.3); assert.equal(s2.C.ar.stage, 1, 'pending during a wind-up');
  until(s2.g, s2.C, () => s2.C.ar.stage >= 2, 5);
  assert.ok(s2.C.ar.stage >= 2 && !s2.C.windupAt);
  ok('a wind-up delays the crack');
}

// ---------- the crack clears pending strikes and beams ----------
{
  const { g, C, ps } = setup();
  quiet(() => g.lightningStrikes(C, ps, ps[0]));
  quiet(() => g.tempestBeam(C));
  assert.ok(g.beams.length === 1);
  const hpBefore = ps.map(p => p.hp);
  g.protect(ps[0], 0); // unprotected: a strike would show
  hp(C, 0.6);
  quiet(() => g.arenaForce(C));
  assert.equal(C.ar.stage, 2); assert.equal(g.beams.length, 0, 'beams cleared');
  tick(g, 2.5);
  assert.equal(ps[0].hp, hpBefore[0], 'pending strikes fizzle');
  ok('the crack clears beams and pending strikes');
}

// ---------- bleed-out pauses on the landing ----------
{
  const { g, C, ps } = setup();
  hp(C, 0.6);
  until(g, C, () => C.ar?.stage === 3);
  const p = ps[2];
  p.hp = 0; p.downed = { at: g.time, until: g.time + 5, src: 'test', by: 0, prog: 0, need: 3 };
  const left = p.downed.until - g.time;
  until(g, C, () => C.ar.stage === 5, 10);
  assert.ok(p.downed, 'still downed'); assert.ok(Math.abs((p.downed.until - g.time) - left) < 0.15, `bleed-out paused while landing (${left.toFixed(2)} → ${(p.downed.until - g.time).toFixed(2)})`);
  tick(g, 1);
  assert.ok(p.downed.until - g.time < left - 0.8, 'and runs again once the boss drops in');
  ok('bleed-out pauses during the landing');
}

// ---------- the Undercroft's rules: sludge, fire, cover ----------
{
  const { g, C, ps } = setup();
  quiet(() => g.arenaForce(C));
  until(g, C, () => C.ar.stage === 0, 12);
  const [p, q] = ps;
  const calm = () => { C.stunUntil = g.time + 999; C.ep = (C.ep || 0) + 1; C.windupAt = 0; }; // (the boss stands still: only the area's rules hurt here)
  calm();
  // sludge: no roll, slowed
  const pool = U.pools[1];
  g.teleport(p, pool.x, pool.z);
  assert.ok(speedAt(p.x, p.z) < 0.6 && !!sludgeAt(p.x, p.z));
  p.dodgeCd = 0; p.lastMoveT = g.time - 0.05; const roll0 = p.rollUntil || 0;
  g.handle(p, { type: 'dodge', face: 0 });
  assert.equal(p.rollUntil || 0, roll0, 'no rolling in sludge');
  const x0 = p.x; p.lastMoveT = g.time - 0.05;
  g.handle(p, { type: 'input', x: p.x + 2, z: p.z, face: 0, seq: p.posSeq });
  assert.ok(p.x - x0 < 0.6, `the sludge holds you back (${(p.x - x0).toFixed(2)} m in one tick)`);
  // fire: burns only while lit, not the downed
  const F = C.ar.fire;
  assert.ok(F && F.k === 0, 'fire pattern waiting');
  const until2 = (k) => until(g, C, () => C.ar.fire.k === k, 12);
  until2(1);
  const spot = U.fire.spots[C.ar.fire.i][0];
  g.protect(q, 0); g.teleport(q, spot.x, spot.z); q.hp = q.maxHp;
  assert.equal(fireAt(q.x, q.z), 1, 'a warning patch'); tick(g, 0.4);
  assert.equal(q.hp, q.maxHp, 'a warning patch does no harm');
  until2(2); g.teleport(q, spot.x, spot.z);
  const h0 = q.hp; tick(g, 1.0);
  assert.ok(q.hp < h0, 'a burning patch hurts'); assert.equal(fireAt(q.x, q.z), 2);
  const ticks = Math.round((h0 - q.hp) / (q.maxHp * U.fire.dmg));
  assert.ok(ticks >= 3 && ticks <= 7, `about 5 ticks a second (${ticks} in 1 s)`);
  // cover: the Tempest Beam passes a player behind a great pillar
  const pil = U.colliders.find(o => o.los);
  C.x = A.x; C.z = A.z; // the beam's origin
  const ang = Math.atan2(pil.x - C.x, pil.z - C.z), d = Math.hypot(pil.x - C.x, pil.z - C.z) + pil.r + 1.2;
  const behind = { x: C.x + Math.sin(ang) * d, z: C.z + Math.cos(ang) * d };
  assert.ok(losBlocked(C.x, C.z, behind.x, behind.z), 'behind the pillar: out of sight');
  assert.ok(!losBlocked(C.x, C.z, C.x - Math.sin(ang) * d, C.z - Math.cos(ang) * d), 'the other side: in sight');
  g.protect(p, 0); g.teleport(p, behind.x, behind.z); p.hp = p.maxHp; p.airUntil = 0; p.iframeUntil = 0;
  g.protect(q, 0); g.teleport(q, C.x - Math.sin(ang) * d, C.z - Math.cos(ang) * d); q.hp = q.maxHp; q.airUntil = 0; q.iframeUntil = 0;
  g.protect(ps[2], 0.9);
  C.ar.fire = null; // (no fire in this part)
  calm();
  quiet(() => g.tempestBeam(C));
  const B = g.beams[0]; B.x = C.x; B.z = C.z; B.a0 = ang + 0.3 * B.dir * -1;
  const hp0 = [p.hp, q.hp];
  tick(g, COLOSSUS.beam.wind + COLOSSUS.beam.turn + 0.3, () => { C.x = A.x; C.z = A.z; p.x = behind.x; p.z = behind.z; });
  assert.equal(p.hp, hp0[0], 'behind the pillar: the beam passes');
  assert.ok(q.hp < hp0[1], 'in the open: the beam hits');
  ok('sludge slows hard and stops rolls; fire burns only while lit, ~5 ticks/s; a great pillar blocks the Tempest Beam');

  // the bots' helpers
  const near = U.pools[0];
  const step = hazardStep(near.x - near.r - 1.2, near.z, near.x, near.z, 0.6, 5);
  assert.ok(step && !sludgeAt(...step), 'a bot steps round sludge, not into it');
  const cs = coverSpot(C.x, C.z, p.x - 3, p.z);
  assert.ok(cs && losBlocked(C.x, C.z, cs[0], cs[1]), 'a bot finds cover behind a pillar');
  ok('bot helpers: step round hazards, find cover from a beam');
}

// ---------- the director: no surprise fall during a show; the 'fall' move ----------
{
  const { g, C } = setup();
  g.director = { running: true }; // (server/index.js attaches the real one: only its flag matters here)
  hp(C, 0.6);
  tick(g, 12);
  assert.equal(C.area || 0, 0, "no fall during a show"); assert.equal(g.arenaHold(C), 0, 'and it holds nothing back');
  assert.equal(g.forceBossMove(C, 'fall'), true, 'a cue can force it');
  until(g, C, () => C.area === 1, 6);
  assert.equal(C.area, 1);
  g.director = undefined;
  ok("the director: no fall during a show unless a cue asks (boss_move 'fall')");
}

// ---------- freeSpot ----------
{
  for (const o of U.colliders) {
    const [x, z] = freeSpot('colossus', 1, o.x, o.z, 0.6);
    assert.ok(!U.colliders.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 0.6), 'freeSpot clears every collider');
  }
  ok('freeSpot: a clear landing spot from inside any pillar or wall');
}
console.log(`arenas: ${n} checks passed`);
process.exit(0);
