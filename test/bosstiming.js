// In-process checks for the boss timing tables (shared/bosstiming.js, docs/ROADMAP.md J3): the default tables reproduce
// the numbers the game used before the tables existed (literal values copied from the old shared/data.js, floor2.js,
// floor3.js, bossteam.js, rescue.js, arenas.js and the server's hard-coded timings), the knobs scale the right fields,
// and the server reads the tables.
// Usage: node test/bosstiming.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WARDEN, SWEEP, MOBS, PACE, paceMoves } from '../shared/data.js';
import { SOVEREIGN, F2 } from '../shared/floor2.js';
import { COLOSSUS } from '../shared/floor3.js';
import { BOSSTEAM } from '../shared/bossteam.js';
import { RESCUE } from '../shared/rescue.js';
import { ARENAS } from '../shared/arenas.js';
import { BOSS_TIMING, TIMED, KNOB_KEYS, knobsFor, buildTiming, applyKnobs, safeWindow, movesOf } from '../shared/bosstiming.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
// only the keys the old table had (the new tables add descriptive keys: active, shape, avoid, posture, after, ...)
const pick = (o, like) => Object.fromEntries(Object.keys(like).map(k => [k, o[k]]));
const same = (cur, old, msg) => { for (const [k, v] of Object.entries(old)) assert.deepEqual(pick(cur[k], v), v, `${msg}.${k}`); };

// ---- 1. The old tables, as they were at runtime (paced) before J3 ----
const OLD = {
  WARDEN: { slam: { every: [6.98, 5.48, 4.23], r: 5.5, wind: 2.08, mult: 3, per: 3 }, charge: { every: 9.95, len: 15, width: 2.4, wind: 1.95, mult: 3 }, cleave: { wind: 0.975 }, hounds: { every: 24, n: 2, max: 3 }, spin: { every: 8.555, r: 8, wind: 2.405, mult: 2.2 }, rock: { every: 6.48, r: 3.2, wind: 2.08, extra: 3, mult: 2.3 }, quake: { every: [15.6, 12.885, 10.67], first: [9, 5, 4], wind: 2.6, speed: 9, w: 0.55, max: 15, mult: 2.7, rings: [1, 2, 3], gap: 1.235 } },
  SWEEP: { r: 9, wind: 1.56, frac: 0.8, every: [12.86, 9.86, 7.86], first: 9 },
  // (the old sweep.mult 1.15 was never read: the swing deals 1 x atk; the table says so now)
  SOVEREIGN: { sweep: { wind: 1.43 }, geyser: { every: [7.495, 6.495, 5.495], r: 3, wind: 2.145, mult: 2, extra: [1, 2, 3] }, wave: { every: [0, 15.69, 11.69], first: 3.5, wind: 2.99, speed: 11, width: 1.4, mult: 3.6 }, thralls: { every: 24, n: 2, max: 4 }, pools: { every: 10, n: 2, r: 3.8, arm: 1.2, life: 16, tick: 0.5, mult: 0.3, max: 6 }, deluge: { r: 16.5, tick: 0.5, mult: 0.25, wind: 3.12 }, volley: { every: 9, n: 5 } },
  COLOSSUS: { cleave: { wind: 1.17, mult: 1 }, strike: { every: [7.51, 6.51, 5.51], first: 4, r: 3.2, wind: 2.21, mult: 2.2, extra: [2, 3, 4] }, gust: { every: [11.45, 10.45, 9.45], first: 7, wind: 1.95, r: 11, half: 0.75, mult: 2.2, shove: 7 }, overload: { every: [0, 30, 24], first: 5, channel: 8, posture: 0.5, clap: 0.55, charged: 15, chargedMult: 1.25, stun: 4, weakD: 8, weak: 1.3 }, harpies: { every: 26, n: 2, max: 3, first: 6 }, beam: { every: [0, 0, 12.66], first: 4, wind: 2.86, turn: 7, sweep: Math.PI * 2, len: 26, w: 0.8, mult: 2.5, from: 0.5 } },
  BOSSTEAM: { min: 2, channel: 0.8, warden: { every: [26, 22, 18], first: 16, moves: [['meteor', 'vines', 'spread'], ['meteor', 'vines', 'spread', 'tether'], ['meteor', 'vines', 'spread', 'tether']] }, sovereign: { every: [26, 22, 18], first: 14, moves: [['meteor', 'pillar', 'spread'], ['meteor', 'pillar', 'spread', 'tether'], ['meteor', 'pillar', 'spread', 'tether']] }, colossus: { every: [28, 26, 22], first: 18, moves: [['meteor', 'crystal', 'spread'], ['meteor', 'crystal', 'spread', 'tether'], ['spread', 'crystal', 'tether']] }, meteor: { r: 3.6, wind: 4.5, total: 0.9, split: 1.3 }, spread: { r: 6, wind: 5.5, hit: 0.42, self: 0.06 }, tether: { need: 15, grace: 1.5, tick: 0.5, dmg: 0.035, max: 11 } },
  RESCUE: { minFree: 2, gap: 8, ownHit: 0.25, channel: 2, vines: { name: 'Thornbind', wind: 1.4, hits: 3, max: 14, tick: 0.5, dot: 0.018, hold: 1.5, reach: 2.6, leash: 3.6 }, pillar: { name: 'Drowning Pillar', wind: 1.6, hits: 3.5, max: 12, tick: 0.5, dot: 0.026, src: [12, 17], block: 1.6, lane: 1.4 }, crystal: { name: 'Storm Crystal', wind: 1.3, hits: 4, fuse: 8, boom: 0.32 } },
  TRANSITION: { crack: 3.2, fall: 1.1, land: 2, enter: 1.6, impact: 0.55, gap: 8, after: 3, shove: 7, shoveR: 7 },
  atkCd: { warden: 2, sovereign: 2.4, colossus: 2.3 },
};
{
  same(WARDEN, OLD.WARDEN, 'WARDEN');
  assert.deepEqual(pick(SWEEP, OLD.SWEEP), OLD.SWEEP, 'SWEEP');
  same(SOVEREIGN, OLD.SOVEREIGN, 'SOVEREIGN');
  same(COLOSSUS, OLD.COLOSSUS, 'COLOSSUS');
  for (const k of ['min', 'channel']) assert.equal(BOSSTEAM[k], OLD.BOSSTEAM[k], `BOSSTEAM.${k}`);
  same(BOSSTEAM, Object.fromEntries(Object.entries(OLD.BOSSTEAM).filter(([, v]) => typeof v === 'object')), 'BOSSTEAM');
  assert.equal(BOSSTEAM.spread.n(4), 2); assert.equal(BOSSTEAM.spread.n(5), 3);
  for (const k of ['minFree', 'gap', 'ownHit', 'channel']) assert.equal(RESCUE[k], OLD.RESCUE[k], `RESCUE.${k}`);
  same(RESCUE, { vines: OLD.RESCUE.vines, pillar: OLD.RESCUE.pillar, crystal: OLD.RESCUE.crystal }, 'RESCUE');
  assert.deepEqual(pick(ARENAS.colossus.timing, OLD.TRANSITION), OLD.TRANSITION, 'the fall');
  for (const [k, v] of Object.entries(OLD.atkCd)) assert.equal(MOBS[k].atkCd, v, `${k} atkCd`);
  // the old tables' move sets are unchanged (nothing new leaks into WARDEN / SOVEREIGN / COLOSSUS: no sweep, no trap)
  assert.deepEqual(Object.keys(movesOf(TIMED.warden)).sort(), Object.keys(OLD.WARDEN).sort());
  assert.deepEqual(Object.keys(movesOf(TIMED.sovereign)).sort(), Object.keys(OLD.SOVEREIGN).sort());
  assert.deepEqual(Object.keys(movesOf(TIMED.colossus)).sort(), Object.keys(OLD.COLOSSUS).sort());
  ok('defaults reproduce the old WARDEN, SWEEP, SOVEREIGN, COLOSSUS, BOSSTEAM, RESCUE, the fall timing and boss atkCd');
}

// ---- 2. The server's hard-coded timings, now in the tables (literal values from the old server code) ----
{
  const W = WARDEN, S = SOVEREIGN, C = COLOSSUS;
  // server/game.js: slamT = t + 5 at the engage; phase 2: hounds +1.5, charge +5; phase 3: spin +3, rock +6;
  // enraged swing cooldown x 0.7; charge busy wind + 0.45, 3 hops paced(0.1) apart
  assert.deepEqual([W.slam.first, W.hounds.first, W.charge.first, W.spin.first, W.rock.first], [5, 1.5, 5, 3, 6]);
  assert.deepEqual([W.cleave.rage, W.cleave.mult, W.charge.after.pause, W.charge.steps, W.charge.step], [0.7, 1, 0.45, 3, 0.1]);
  // server/combat.js: Horn Sweep repeat x (0.85 + rnd 0.3), busy wind + 0.35; Quake Ring busy + 0.35
  assert.deepEqual([SWEEP.jitter, SWEEP.after.pause, W.quake.after.pause], [[0.85, 0.3], 0.35, 0.35]);
  // server/floor2.js: geyser +4 at the engage; phase 2: thralls +2, pools +6; phase 3: volley +4, wave +7 (after the
  // Deluge call); swing cooldown x 0.8 in phase 3; wave busy wind + 0.5; volley orbs 0.45 rad apart at 0.8 x atk
  assert.deepEqual([S.geyser.first, S.thralls.first, S.pools.first, S.volley.first, S.wave.firstAfterDeluge], [4, 2, 6, 4, 7]);
  assert.deepEqual([S.sweep.rage, S.sweep.mult, S.wave.after.pause, S.volley.fan, S.volley.mult], [0.8, 1, 0.5, 0.45, 0.8]);
  // server/floor3.js: Static: Overload at +14; phase 3: within every[2] x 0.6; swing cooldown x 0.85 in phase 3; gust
  // busy + 0.45; after a Thunderclap busy 0.6; beam busy wind + turn + 0.4
  assert.deepEqual([C.overload.firstStatic, C.overload.phase3, C.cleave.rage, C.gust.after.pause, C.overload.after.pause, C.beam.after.pause], [14, 0.6, 0.85, 0.45, 0.6, 0.4]);
  // server/bossteam.js: a blocked rotation retries in 2 s; server/arenas.js: own moves resume 2 + rnd 2 s after landing
  assert.deepEqual([BOSSTEAM.retry, ARENAS.colossus.timing.resume, ARENAS.colossus.timing.resumeJitter], [2, 2, 2]);
  ok('the server\'s hard-coded timings (first-use delays, recovery pauses, enrage swing rates, jitters, retries) are table values');
}

// ---- 3. One source: the old tables are the built timing tables ----
{
  assert.equal(WARDEN.slam, TIMED.warden.abilities.slam); assert.equal(SWEEP, TIMED.warden.abilities.sweep);
  assert.equal(SOVEREIGN.wave, TIMED.sovereign.abilities.wave); assert.equal(COLOSSUS.beam, TIMED.colossus.abilities.beam);
  assert.equal(BOSSTEAM.warden, TIMED.warden.team); assert.equal(BOSSTEAM.colossus, TIMED.colossus.team);
  assert.equal(RESCUE.vines, TIMED.warden.abilities.vines); assert.equal(RESCUE.pillar, TIMED.sovereign.abilities.pillar); assert.equal(RESCUE.crystal, TIMED.colossus.abilities.crystal);
  assert.equal(ARENAS.colossus.timing, TIMED.colossus.transition);
  for (const b of ['warden', 'sovereign', 'colossus']) for (const k of KNOB_KEYS) assert.equal(TIMED[b].knobs[k], 1, `${b} ${k} defaults to 1`);
  // paced exactly once: building again gives the same numbers, and pacing the old table again changes nothing
  assert.deepEqual(buildTiming('warden').abilities, TIMED.warden.abilities);
  const w = WARDEN.slam.wind; paceMoves(WARDEN); assert.equal(WARDEN.slam.wind, w);
  near(BOSS_TIMING.warden.abilities.slam.wind * PACE, WARDEN.slam.wind, 'the table holds the unpaced wind-up');
  ok('WARDEN / SWEEP / SOVEREIGN / COLOSSUS / BOSSTEAM / RESCUE / ARENAS timing are the built tables; knobs default to 1; paced once');
}

// ---- 4. Knobs scale the right fields ----
{
  const D = TIMED.warden.abilities;
  const dmg = buildTiming('warden', null, { damageMul: 2 }).abilities;
  assert.deepEqual([dmg.slam.mult, dmg.sweep.frac, dmg.vines.dot, dmg.cleave.mult], [6, 1.6, 0.036, 2]);
  assert.deepEqual([dmg.slam.wind, dmg.slam.every, dmg.slam.after.pause], [D.slam.wind, D.slam.every, D.slam.after.pause], 'damage only');
  const dc = buildTiming('colossus', null, { damageMul: 2 }).abilities;
  assert.deepEqual([dc.overload.clap, dc.overload.chargedMult, dc.crystal.boom], [1.1, 1.25, 0.64], 'Thunderclap and the crystal scale; the Charged multiplier does not');

  // wind-ups: wind (and Overload's channel) x k; a repeat grows by the extra wind-up (the rest after the hit stays)
  const wu = buildTiming('warden', null, { windupMul: 1.5 }).abilities;
  near(wu.slam.wind, 3.12, 'slam wind'); [8.02, 6.52, 5.27].forEach((e, i) => near(wu.slam.every[i], e, `slam every[${i}]`));
  near(wu.charge.every, 9.95 + 0.975, 'charge every'); assert.deepEqual(wu.quake.first, [9, 5, 4], 'first timers unchanged');
  assert.equal(wu.hounds.every, 24, 'no wind-up: no change'); assert.equal(wu.slam.mult, 3, 'no damage change');
  assert.equal(buildTiming('colossus', null, { windupMul: 1.5 }).abilities.overload.channel, 12);
  assert.equal(buildTiming('sovereign', null, { windupMul: 2 }).abilities.wave.every[0], 0, 'a move not in a phase stays off');

  const cd = buildTiming('warden', null, { cooldownMul: 2 });
  assert.deepEqual([cd.abilities.slam.every, cd.abilities.cleave.cd, cd.abilities.charge.every, cd.team.every], [[13.96, 10.96, 8.46], 4, 19.9, [52, 44, 36]]);
  assert.deepEqual([cd.abilities.slam.wind, cd.abilities.slam.first, cd.team.first], [D.slam.wind, 5, 16], 'wind-ups and first timers unchanged');

  const pz = buildTiming('colossus', null, { pauseMul: 2 }).abilities;
  assert.deepEqual([pz.gust.after.pause, pz.beam.after.pause, pz.overload.after.pause, pz.gust.every], [0.9, 0.8, 1.2, TIMED.colossus.abilities.gust.every]);

  // sequences (today every one is a single step with no gaps / pause, so try a made-up one)
  const T = { abilities: { a: { wind: 1, every: 5, after: { state: 'exposed', pause: 3 } } }, phases: [{ order: ['a'], seqs: [{ steps: ['a', 'a', 'a'], gaps: [0.6, 1.0], pause: 3, w: 2 }] }], team: null };
  applyKnobs(T, { damageMul: 1, windupMul: 1, gapMul: 2, pauseMul: 0.5, cooldownMul: 1 });
  assert.deepEqual([T.phases[0].seqs[0].gaps, T.phases[0].seqs[0].pause, T.abilities.a.after.pause, T.phases[0].seqs[0].w], [[1.2, 2], 1.5, 1.5, 2]);
  ok('knobs: damageMul (mult frac clap dot boom), windupMul (wind channel; every grows by the extra), cooldownMul (every cd team), pauseMul (after, sequence pause), gapMul (sequence gaps)');
}

// ---- 5. Per-party-size overrides ----
{
  const tbl = structuredClone({ warden: { ...BOSS_TIMING.warden, knobs: { ...BOSS_TIMING.warden.knobs, party: { 5: { damageMul: 1.5 }, 6: { damageMul: 1.5, cooldownMul: 0.5 } } } } });
  tbl.warden.abilities = BOSS_TIMING.warden.abilities; // (structuredClone kept everything but the shared refs: fine)
  assert.equal(knobsFor('warden', 3, tbl).damageMul, 1); assert.equal(knobsFor('warden', undefined, tbl).damageMul, 1);
  assert.deepEqual([knobsFor('warden', 5, tbl).damageMul, knobsFor('warden', 5, tbl).cooldownMul], [1.5, 1]);
  assert.deepEqual([knobsFor('warden', 6, tbl).damageMul, knobsFor('warden', 6, tbl).cooldownMul], [1.5, 0.5]);
  assert.equal(buildTiming('warden', 6, null, tbl).abilities.slam.mult, 4.5);
  assert.equal(buildTiming('warden', 6, { damageMul: 1 }, tbl).abilities.slam.mult, 3, 'explicit knobs win over the party override');
  assert.equal(BOSS_TIMING.warden.abilities.slam.mult, 3.0, 'building never touches the source table');
  ok('per-party-size overrides: the largest size <= the party applies; explicit knobs win; the source table is untouched');
}

// ---- 6. The table's shape: every ability described; phases encode today's timer rotation ----
{
  const STATES = ['idle', 'walk', 'planted', 'stunned', 'exposed'], BY = ['roll', 'jump', 'block', 'parry', 'outrange', 'none'];
  for (const [b, B] of Object.entries(BOSS_TIMING)) {
    for (const [k, mv] of Object.entries(B.abilities)) {
      assert.ok(typeof mv.shape === 'string' && typeof mv.posture === 'number', `${b}.${k}: shape, posture`);
      assert.ok(mv.avoid?.by.length && mv.avoid.by.every(x => BY.includes(x)), `${b}.${k}: avoid`);
      assert.ok(STATES.includes(mv.after?.state) && typeof mv.after.pause === 'number', `${b}.${k}: after`);
    }
    assert.equal(B.phases.length, 3, `${b}: three phases`);
    for (const ph of B.phases) for (const s of ph.seqs) { assert.ok(B.abilities[s.steps[0]], `${b}: ${s.steps[0]}`); assert.deepEqual([s.steps.length, s.gaps, s.pause, s.w], [1, [], 0, 1]); }
  }
  assert.ok(BOSS_TIMING.warden.phases[0].order.every(k => !['hounds', 'charge', 'spin', 'rock'].includes(k)), 'phase 1: no hounds, charge, spin, rock');
  assert.ok(BOSS_TIMING.colossus.phases[2].order.includes('beam') && !BOSS_TIMING.colossus.phases[1].order.includes('beam'), 'the beam: phase 3 only');
  assert.equal(COLOSSUS.overload.stopped.state, 'stunned');
  // safe windows: a ground slam lands at the end of its wind-up; a Quake Ring's front reaches 5 m (wind + (5 - w) / speed)
  assert.deepEqual(safeWindow(WARDEN.slam), [2.08, 2.08]);
  const [a, z] = safeWindow(WARDEN.quake, 5); near(a, 2.6 + 4.45 / 9, 'front in'); near(z, 2.6 + 5.55 / 9, 'front out');
  assert.equal(safeWindow(SOVEREIGN.pools), null, 'a zone has no timing window');
  ok('every ability has shape, avoidability, posture and an after state; phases list today\'s rotation as one-step sequences; safeWindow');
}

// ---- 7. The server reads the tables (change a table value, see the server follow) ----
{
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
  const g = quiet(() => new Game());
  quiet(() => g.setTwist2(null)); // no Sovereign twist (Moonless, High Tide, Drowned Host change these timings)
  const keep = [WARDEN.charge.after.pause, SWEEP.after.pause, SOVEREIGN.wave.after.pause, COLOSSUS.gust.after.pause, COLOSSUS.beam.after.pause];
  try {
    WARDEN.charge.after.pause = 1.11; SWEEP.after.pause = 1.22; SOVEREIGN.wave.after.pause = 1.33; COLOSSUS.gust.after.pause = 1.44; COLOSSUS.beam.after.pause = 1.55;
    const b = g.boss, p = quiet(() => g.addPlayer(null, 'Kael', 'guardian'));
    g.twistW = { ...WARDEN }; g.twist = null; g.time = 50; // (no twist: Twin Horns would add its own charge)
    b.busyUntil = 0; g.hornCharge(b, p); near(b.busyUntil, 50 + WARDEN.charge.wind + 1.11, 'Horn Charge recovery');
    b.busyUntil = 0; g.hornSweep(b); near(b.busyUntil, 50 + SWEEP.wind + 1.22, 'Horn Sweep recovery');
    const s = g.sovereign; s.busyUntil = 0; g.tidalWave(s); near(s.busyUntil, 50 + SOVEREIGN.wave.wind + 1.33, 'Tidal Wave recovery');
    const c = g.colossus; c.busyUntil = 0; g.galePush(c, p); near(c.busyUntil, 50 + COLOSSUS.gust.wind + 1.44, 'Gale Push recovery');
    c.busyUntil = 0; g.tempestBeam(c); near(c.busyUntil, 50 + COLOSSUS.beam.wind + COLOSSUS.beam.turn + 1.55, 'Tempest Beam recovery');
  } finally {
    [WARDEN.charge.after.pause, SWEEP.after.pause, SOVEREIGN.wave.after.pause, COLOSSUS.gust.after.pause, COLOSSUS.beam.after.pause] = keep;
  }
  ok('the server reads the tables: recovery pauses of Horn Charge, Horn Sweep, Tidal Wave, Gale Push and Tempest Beam follow them');
}

// ---- 8. Engage timers: each boss starts its fight with the table's first-use delays (and nothing else armed) ----
{
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
  const g = quiet(() => new Game());
  quiet(() => g.setTwist2(null)); // no Sovereign twist (Moonless, High Tide, Drowned Host change these timings)
  g.twist = null; g.twistW = { ...WARDEN }; g.time = 30;
  const s = g.sovereign, p = quiet(() => g.addPlayer(null, 'Kael', 'guardian'));
  p.x = F2.arena.x; p.z = F2.arena.z - 3; s.threat.set(p.id, 1);
  quiet(() => g.f2Sovereign(s, 0.05));
  assert.ok(s.engaged, 'the Sovereign engaged');
  assert.equal(s.geyserT, 30 + SOVEREIGN.geyser.first);
  for (const k of ['waveT', 'thrallT', 'poolT', 'volleyT']) assert.equal(s[k], Infinity, `Sovereign ${k} waits for its phase`);
  process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3());
  const c = g.colossus; quiet(() => g.engageColossus(c));
  assert.deepEqual([c.strikeT, c.gustT, c.ovT, c.harpyT, c.beamT], [30 + COLOSSUS.strike.first, 30 + COLOSSUS.gust.first, Infinity, Infinity, Infinity]);
  delete process.env.F3_TWIST;
  ok('engage timers: the Sovereign and the Colossus arm their first moves from the tables, later-phase moves wait');
}

console.log(`bosstiming: ${n} checks passed`);
process.exit(0);
