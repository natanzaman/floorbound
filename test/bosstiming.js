// In-process checks for the boss timing tables (shared/bosstiming.js, docs/ROADMAP.md J3): the default tables reproduce
// the numbers the game used before the tables existed (literal values copied from the old shared/data.js, floor2.js,
// floor3.js, bossteam.js, rescue.js, arenas.js and the server's hard-coded timings), the knobs scale the right fields,
// and the server reads the tables.
// Usage: node test/bosstiming.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WARDEN, SWEEP, MOBS, PACE, paceMoves } from '../shared/data.js';
import { SOVEREIGN, F2 } from '../shared/floor2.js';
import { COLOSSUS, F3 } from '../shared/floor3.js';
import { BOSSTEAM } from '../shared/bossteam.js';
import { RESCUE } from '../shared/rescue.js';
import { ARENAS } from '../shared/arenas.js';
import { runHooks } from '../shared/bots/registry.js';
import { stepRoll } from '../shared/bots/motor.js';
import { gustDodge, readOpenings, openingOn, openingTurn } from '../shared/bots/openings.js';
import { BOSS_TIMING, TIMED, KNOB_KEYS, OPENING, knobsFor, buildTiming, applyKnobs, safeWindow, movesOf, isOpening, fightTable, pickCombo } from '../shared/bosstiming.js';

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
// J3 part 3 retuned these with scripts/tuneboss.js (README "Tuning bosses"); every other number above is still the
// pre-J3 one. Paced like OLD: Lightning Strikes and Gale Push repeat after every + their extra wind-up (0.51 / 0.45 s),
// the Tempest Beam after every + 0.66.
const TUNED = {
  COLOSSUS: { strike: { every: [9.01, 8.01, 7.01] }, gust: { every: [13.45, 12.45, 11.45] }, beam: { every: [0, 0, 15.66] } },
};
for (const [t, moves] of Object.entries(TUNED)) for (const [k, v] of Object.entries(moves)) Object.assign(OLD[t][k], v);
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
    B.phases.forEach((ph, i) => {
      // one-step sequences: today's timer rotation; combos (J3 part 2): steps in this phase, gaps between them, an opening after
      assert.deepEqual(ph.seqs.filter(s => s.steps.length === 1).map(s => s.steps[0]), ph.order, `${b} phase ${i + 1}: the timers`);
      for (const s of ph.seqs.filter(s => s.steps.length === 1)) assert.deepEqual([s.gaps, s.pause, s.w], [[], 0, 1]);
      const combos = ph.seqs.filter(s => s.steps.length > 1);
      assert.ok(combos.length >= 1 && ph.every > 0 && ph.first > 0, `${b} phase ${i + 1}: at least one combo, every / first`);
      for (const s of combos) {
        assert.ok(s.steps.every(k => ph.order.includes(k) && B.abilities[k]), `${b}: ${s.steps} are this phase's moves`);
        assert.equal(s.gaps.length, s.steps.length - 1, `${b}: a gap between each two steps`);
        assert.ok(s.pause > 0 && isOpening(s.state) && s.w > 0, `${b}: ${s.steps} ends in an opening`);
      }
    });
    assert.ok(B.close.gap > 0 && B.close.moves.every(k => B.abilities[k]), `${b}: close moves`);
  }
  assert.ok(BOSS_TIMING.warden.phases[0].order.every(k => !['hounds', 'charge', 'spin', 'rock'].includes(k)), 'phase 1: no hounds, charge, spin, rock');
  assert.ok(BOSS_TIMING.colossus.phases[2].order.includes('beam') && !BOSS_TIMING.colossus.phases[1].order.includes('beam'), 'the beam: phase 3 only');
  assert.equal(COLOSSUS.overload.stopped.state, 'stunned');
  // safe windows: a ground slam lands at the end of its wind-up; a Quake Ring's front reaches 5 m (wind + (5 - w) / speed)
  assert.deepEqual(safeWindow(WARDEN.slam), [2.08, 2.08]);
  const [a, z] = safeWindow(WARDEN.quake, 5); near(a, 2.6 + 4.45 / 9, 'front in'); near(z, 2.6 + 5.55 / 9, 'front out');
  assert.equal(safeWindow(SOVEREIGN.pools), null, 'a zone has no timing window');
  ok('every ability has shape, avoidability, posture and an after state; phases: the timer rotation as one-step sequences plus combos that end in an opening; safeWindow');
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

// ---- 9. The fight's table (m.tm): built at the engage from the twist copy, with the party-size knobs ----
{
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
  const g = quiet(() => new Game());
  g.twist = null; g.twistW = { ...WARDEN }; g.time = 40;
  const b = g.boss, p = quiet(() => g.addPlayer(null, 'Kael', 'guardian'));
  p.x = b.x; p.z = b.z - 3; b.threat.set(p.id, 1);
  quiet(() => g.updateMob(b, 0.05));
  assert.ok(b.engaged && b.tm, 'the Warden engaged and built its fight table');
  assert.equal(b.tm.slam, g.twistW.slam, 'no party override: the twist copy\'s own moves');
  assert.equal(b.tm.sweep, SWEEP, 'the Horn Sweep comes with it');
  assert.equal(b.tm.seqs, TIMED.warden.phases); assert.equal(b.tm.close, TIMED.warden.close);
  const K = BOSS_TIMING.colossus.knobs, keep = K.party;
  try {
    K.party = { 1: { damageMul: 2, gapMul: 0.5, cooldownMul: 2 } };
    process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3());
    const c = g.colossus, q = quiet(() => g.addPlayer(null, 'Ria', 'ranger'));
    q.x = F3.arena.x; q.z = F3.arena.z - 4;
    quiet(() => g.engageColossus(c));
    assert.deepEqual([c.tm.strike.mult, c.tm.gust.mult, c.tm.close.gap, c.tm.seqs[0].every, c.tm.team.every[0]], [4.4, 4.4, 0.75, 26, 56], 'one fighter: the party override applies');
    assert.deepEqual([COLOSSUS.strike.mult, TIMED.colossus.close.gap, TIMED.colossus.phases[0].every], [2.2, 1.5, 13], 'the shared tables are untouched');
    assert.ok(c.tm.seqs[0].seqs.find(x => x.steps.length > 1).gaps[0] === 0.2, 'combo gaps x gapMul');
  } finally { K.party = keep; delete process.env.F3_TWIST; }
  ok('m.tm: built at the engage; the twist copy\'s moves as they are, or copies with the party-size knobs applied');
}

// A fresh game with an engaged Warden and one guardian next to it (no twist)
function wardenFight() {
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
  const g = quiet(() => new Game());
  g.twist = null; g.twistW = { ...WARDEN }; g.time = 40;
  const b = g.boss, p = quiet(() => g.addPlayer(null, 'Kael', 'guardian'));
  p.x = b.x; p.z = b.z - 3; b.threat.set(p.id, 1);
  quiet(() => g.updateMob(b, 0.05));
  return { g, b, p, quiet };
}

// ---- 10. Combos: steps in order, each `gap` s after the previous one ended, then the after state for `pause` s ----
{
  const { g, b } = wardenFight();
  b.tm = { ...b.tm, seqs: [{ order: [], every: 20, first: 1, seqs: [{ steps: ['slam', 'quake', 'slam'], gaps: [0.4, 0.6], pause: 2.5, state: 'exposed', w: 1 }] }] };
  b.comboPh = -1; b.busyUntil = 0; b.slamT = b.quakeT = 0; b.windupAt = 0; b.stunUntil = 0;
  const ran = [], dur = { slam: 2, quake: 3 };
  const run = k => { ran.push([k, Math.round((g.time - 40) * 100) / 100]); return g.time + dur[k]; };
  const timers = { slam: 'slamT', quake: 'quakeT' };
  const step = (until) => { const out = []; for (; g.time < until - 1e-9; g.time = Math.round((g.time + 0.05) * 100) / 100) out.push(g.bossCombo(b, run, timers)); return out; };
  g.time = 40; step(40.95);
  assert.equal(ran.length, 0, 'the first combo waits `first` s');
  step(41.05); assert.deepEqual(ran, [['slam', 1]], 'step 1 at first');
  assert.ok(b.slamT >= 41 + WARDEN.slam.every[0] - 1e-9, 'a combo step pushes back its own timer');
  step(44); assert.deepEqual(ran.map(r => r[0]), ['slam', 'quake'], 'step 2 ...'); assert.equal(ran[1][1], 1 + 2 + 0.4, '... gap s after step 1 ended');
  step(48); assert.equal(ran[2][1], 3.4 + 3 + 0.6, 'step 3 after the second gap');
  assert.equal(ran.length, 3);
  const end = 40 + 7 + 2;
  near(b.busyUntil, end + 2.5, 'busy for the pause after the last step');
  assert.deepEqual([b.after.state, b.after.from, b.after.until], ['exposed', end, end + 2.5], 'the after state');
  g.time = end + 1; assert.ok(g.openingOf(b), 'an opening while exposed');
  assert.equal(g.bossCombo(b, run, timers), true, 'the after state holds the boss: its own timers wait');
  g.time = end + 2.6; assert.equal(g.openingOf(b), null, 'the opening ends'); assert.equal(g.bossCombo(b, run, timers), false);
  // weights: the pick follows them
  const tm = { seqs: [{ seqs: [{ steps: ['a'], w: 1 }, { steps: ['a', 'b'], w: 1, gaps: [0] }, { steps: ['b', 'a'], w: 3, gaps: [0] }] }] };
  assert.deepEqual([pickCombo(tm, 0, () => 0.1).steps, pickCombo(tm, 0, () => 0.3).steps, pickCombo(tm, 0, () => 0.99).steps], [['a', 'b'], ['b', 'a'], ['b', 'a']], 'by weight (one-step entries are timers, not combos)');
  // a Break interrupts a combo
  b.tm.seqs[0].first = 0; b.comboPh = -1; b.after = null; b.busyUntil = 0; g.time = 60; ran.length = 0;
  g.bossCombo(b, run, timers); assert.equal(ran.length, 1); b.staggerUntil = 61;
  g.time = 63; g.bossCombo(b, run, timers); assert.equal(b.seq, null, 'broken: the combo is dropped'); assert.equal(ran.length, 1);
  // the real thing: the Warden's specials run a slam, then a Quake Ring 0.4 s after the slam lands
  const w = wardenFight();
  w.b.tm = { ...w.b.tm, seqs: [{ ...TIMED.warden.phases[0], first: 0.5 }] };
  w.b.comboPh = -1; w.b.slamT = w.b.quakeT = Infinity; w.b.busyUntil = 0; w.b.windupAt = 0; w.g.time = 50; w.g.events = [];
  const kinds = [];
  for (let i = 0; i < 200; i++) { w.g.time = Math.round((w.g.time + 0.05) * 100) / 100; w.quiet(() => w.g.bossSpecials(w.b, w.p)); for (const e of w.g.events) if ((e.t === 'tele' && e.r === WARDEN.slam.r) || (e.t === 'quake' && e.i === 0)) kinds.push([e.t, w.g.time]); w.g.events = []; }
  assert.deepEqual(kinds.map(k => k[0]), ['tele', 'quake'], 'slam, then the Quake Ring');
  assert.ok(Math.abs(kinds[1][1] - kinds[0][1] - (WARDEN.slam.wind + 0.4)) <= 0.05 + 1e-9, 'the ring starts gap s after the slam lands (to the tick)');
  ok('combos: steps in order, gap s after each ends, own timers pushed back, then the after state (an opening) for the pause; weights; a Break drops one');
}

// ---- 11. After states of single moves: exposed is an opening; walk lets it move but not attack ----
{
  const { g, b, p } = wardenFight();
  b.busyUntil = 0; g.time = 50;
  b.tm = { ...b.tm, charge: { ...b.tm.charge, after: { state: 'exposed', pause: 2 } } };
  const end = g.hornCharge(b, p), land = 50 + b.tm.charge.wind;
  near(end, land + 2, 'hornCharge returns its end'); near(b.busyUntil, land + 2, 'busy for the pause');
  g.time = land - 0.1; assert.equal(g.openingOf(b), null, 'not before it lands');
  g.time = land + 1; assert.equal(g.openingOf(b)?.state, 'exposed', 'exposed after the charge');
  g.time = 70; b.busyUntil = 0; b.after = null; b.holdUntil = 0; b.closeAt = -99;
  g.bossAfter(b, { after: { state: 'walk', pause: 1.5 } }, 70);
  assert.ok(b.busyUntil <= 70 && b.holdUntil === 71.5, 'walk: not busy, but held');
  assert.equal(g.swingReady(b), false, 'no swing while walking it off'); assert.equal(g.openingOf(b), null, 'walking is no opening');
  g.time = 71.6; assert.equal(g.swingReady(b), true);
  g.bossAfter(b, { after: { state: 'idle', pause: 0.5 } }, 72); assert.equal(g.afterOf(b), null, 'idle: just busy'); near(b.busyUntil, 72.5, 'idle pause');
  ok('after states: a single move\'s exposed pause is an opening; walk: free to move, no attacks; idle: only busy');
}

// ---- 12. The opening bonus: + to the flank multiplier (not x), posture too; not Broken, not Grounded, melee only, no show ----
{
  const { g, b, p } = wardenFight();
  g.time = 80; b.after = { state: 'exposed', from: 79, until: 82, hits: new Map() }; b.staggerUntil = 0; b.groundedUntil = 0;
  b.face = 0; p.x = b.x; p.z = b.z + 3; // in front of it
  near(g.flankMult(b, p), 1 + OPENING.dmg, 'front: 1 + 0.25'); assert.equal(p._flankPost || 0, 0, 'no extra posture factor (OPENING.posture 0)'); p._flankPost = 0;
  p.z = b.z - 3; // behind it
  near(g.flankMult(b, p), 1.08 + OPENING.dmg, 'behind: 1.08 + 0.25 (added, not 1.08 x 1.25)'); near(p._flankPost, 1.12, 'the flank posture bonus as before'); p._flankPost = 0;
  const q = g.addPlayer(null, 'Ria', 'ranger'); g.parties.set(99, { id: 99, members: [p.id, q.id] }); p.party = q.party = 99;
  q.x = b.x; q.z = b.z + 3; // a Pincer
  near(g.flankMult(b, p), 1.15 + OPENING.dmg, 'Pincer: 1.15 + 0.25'); p._flankPost = 0; p.party = q.party = 0; g.parties.delete(99);
  assert.equal(OPENING.posture, 0);
  b.staggerUntil = 81; near(g.flankMult(b, p), 1.08, 'Broken (Switch window): no opening bonus'); b.staggerUntil = 0; p._flankPost = 0;
  b.groundedUntil = 81; near(g.flankMult(b, p), 1.08, 'Grounded: no opening bonus'); b.groundedUntil = 0; p._flankPost = 0;
  p.z = b.z - (b.def.radius + 7); near(g.flankMult(b, p), 1, 'out of flank reach (ranged): no bonus'); p.z = b.z - 3;
  g.director = { running: true }; near(g.flankMult(b, p), 1.08, 'a director show: no openings'); p._flankPost = 0;
  assert.equal(g.bossCombo(b, () => 0), false, 'no combos in a show');
  g.setAfter(b, 'exposed', 80, 90); assert.equal(b.after.until, 82, 'no new opening in a show');
  g.director = null;
  // end to end: damageMob deals 25% more (and 25% more posture) in the opening, front-on
  p.z = b.z + 3; b.hp = b.maxHp = 1e6; const rnd = Math.random; Math.random = () => 0.5;
  try {
    const hit = () => { const hp = b.hp, ps = b.posture = 0; g.damageMob(b, p, 100); return [hp - b.hp, b.posture - ps]; };
    const [d1, s1] = hit(); b.after = null; const [d0, s0] = hit();
    near(d1 / d0, 1.25, `damage x1.25 (${d1} vs ${d0})`); near(s1 / s0, 1.25, 'posture x1.25 (it follows the damage)');
  } finally { Math.random = rnd; }
  ok('opening bonus: +0.25 added to the flank multiplier (front 1.25, back 1.33, Pincer 1.40), posture +25% with it; none while Broken or Grounded, at range, or in a show');
}

// ---- 13. No point-blank chaining; the snapshot carries the opening ----
{
  const { g, b } = wardenFight();
  g.time = 90; b.closeAt = -99; b.holdUntil = 0; b.after = null;
  const wind = WARDEN.cleave.wind, gap = TIMED.warden.close.gap;
  g.swingStart(b, wind);
  g.time = 90 + wind + gap - 0.05; assert.equal(g.closeReady(b, 'spin'), false, 'no spin right after the swing lands'); assert.equal(g.closeReady(b, 'slam'), true, 'a slam is not a close move');
  g.time = 90 + wind + gap + 0.01; assert.equal(g.closeReady(b, 'spin'), true);
  g.areaHold(b, g.time + 2); assert.equal(g.swingReady(b), false, 'the swing waits out its own area telegraph');
  g.director = { running: true }; assert.equal(g.swingReady(b), true, 'not in a show'); g.director = null;
  g.time = 100; b.after = { state: 'planted', from: 99, until: 102.5, hits: new Map() }; b.staggerUntil = 0; b.groundedUntil = 0;
  const op = JSON.parse(g.snapshot()).op;
  assert.deepEqual(op, [[b.id, 2, 2.5, 3.5]], 'w.op: [boss id, state index (planted), s left, s total]');
  b.after = null; assert.equal(JSON.parse(g.snapshot()).op, undefined, 'no opening: no op key');
  // the Sovereign's and the Colossus's swings still arm their cooldowns (and mark the close gap)
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
  quiet(() => g.setTwist2(null)); process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3()); delete process.env.F3_TWIST;
  const p = [...g.players.values()][0];
  for (const [m, ai, A] of [[g.sovereign, 'f2Sovereign', F2.arena], [g.colossus, 'f3Colossus', F3.arena]]) {
    g.time = 200; p.x = A.x; p.z = A.z - 3; m.x = A.x; m.z = A.z; m.threat.clear(); m.threat.set(p.id, 1);
    quiet(() => g[ai](m, 0.05));
    m.busyUntil = 0; m.windupAt = 0; m.atkT = 0; m.closeAt = -99; m.holdUntil = 0; m.after = null; m.seq = null; m.comboT = Infinity;
    m.geyserT = m.strikeT = m.gustT = m.waveT = m.ovT = Infinity; m.btT = Infinity;
    g.time = 201; quiet(() => g[ai](m, 0.05));
    assert.ok(m.windupAt > 201 && m.atkT > 201 + 1, `${m.type}: swung, cooldown armed (${m.atkT})`);
    assert.ok(m.closeAt > 201, `${m.type}: the swing marks the close gap`);
  }
  ok('close moves keep their gap; the swing waits out area telegraphs (not in a show); swings arm their cooldowns; the snapshot carries the opening');
}

// ---- 14. Bots read the tables: they get out of a Gale Push, and melee goes in for an opening and out before it closes ----
{
  const mk = (x, z, skill = 5) => ({ t: 0, x, z, face: 0, skill, mobs: [], tele: [], waves: [], dodgeCd: 0, roll: null, gateOpen: true, sent: [], send(o) { this.sent.push(o); } });
  const A = F3.arena, G = COLOSSUS.gust, f = 0; // the cone faces +z
  const run = (b, secs) => { for (let i = 0; i < secs / 0.05; i++) { b.t = Math.round((b.t + 0.05) * 100) / 100; b.dodgeCd = Math.max(0, b.dodgeCd - 0.05); if (!stepRoll(b)) gustDodge(b); } };
  const inCone = b => { const d = Math.hypot(b.x - A.x, b.z - A.z); return d <= G.r + 0.5 && (d <= 2.6 + 0.8 || Math.abs(Math.atan2(b.x - A.x, b.z - A.z) - f) <= G.half); };
  for (const [dz, dx] of [[5, 0.3], [9, -1], [3.5, 0]]) {
    const b = mk(A.x + dx, A.z + dz);
    assert.ok(inCone(b), 'starts in the cone');
    runHooks('onEvent', b, { t: 'f3fx', k: 'gust', id: 1, x: A.x, z: A.z, f, r: G.r, h: G.half, d: G.wind });
    run(b, G.wind);
    assert.ok(!inCone(b), `out of the cone (or rolling through it) by the time it lands, from ${dz} m: ${b.x - A.x}, ${b.z - A.z}`);
  }
  const back = mk(A.x, A.z - 5); runHooks('onEvent', back, { t: 'f3fx', k: 'gust', id: 1, x: A.x, z: A.z, f, r: G.r, h: G.half, d: G.wind });
  back.t = 0.05; assert.equal(gustDodge(back), false, 'behind it: nothing to do');
  const rnd = Math.random; Math.random = () => 0.99; // a skill-3 bot: a slower glance
  try {
    const slow = mk(A.x, A.z + 5, 3); runHooks('onEvent', slow, { t: 'f3fx', k: 'gust', id: 1, x: A.x, z: A.z, f, r: G.r, h: G.half, d: G.wind });
    slow.t = 0.1; assert.equal(gustDodge(slow), false, 'not seen yet'); slow.t = 0.5; assert.equal(gustDodge(slow), true, 'seen after its reaction time');
  } finally { Math.random = rnd; }
  // openings
  const W = { id: 7, x: 0, z: 150, def: { boss: true, radius: 2.2 } }, ctx = { basic: { kind: 'melee', reach: 3 }, dodge: null, ready: false };
  const b = mk(0, 140); b.role = 'dps';
  readOpenings(b, [[7, 4, 3, 3]]);
  assert.equal(openingOn(b, W)?.state, 'exposed');
  assert.equal(openingTurn(b, W, ctx), true, 'out of reach: in for the opening'); assert.ok(b.z > 140 && ctx.ready, 'moving in, ready');
  b.z = 147; assert.equal(openingTurn(b, W, ctx), false, 'in reach: the class brain hits it');
  b.t = 2.7; assert.equal(openingTurn(b, W, ctx), true, 'just before it closes: step out'); assert.ok(b.z < 147, 'backing off');
  const tank = mk(0, 140); tank.role = 'tank'; readOpenings(tank, [[7, 4, 3, 3]]); assert.equal(openingTurn(tank, W, ctx), false, 'the tank stays on it');
  const archer = mk(0, 140); archer.role = 'dps'; readOpenings(archer, [[7, 4, 3, 3]]); assert.equal(openingTurn(archer, W, { ...ctx, basic: { kind: 'ranged', reach: 14 } }), false, 'ranged: steady as before');
  readOpenings(b, undefined); assert.equal(openingOn(b, W), null, 'gone from the snapshot: over');
  ok('bots: out of the Gale Push cone in time (walk, or roll), skill-scaled; melee in for an opening and out before it closes; tank and ranged unchanged');
}

console.log(`bosstiming: ${n} checks passed`);
process.exit(0);
