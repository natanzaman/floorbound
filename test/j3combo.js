// In-process checks for the boss combo state machine (server/openings.js bossCombo, docs/ROADMAP.md J3) against the
// other "boss waits" rules: a team mechanic's channel (server/bossteam.js btChannel), the Colossus's fall
// (server/arenas.js arenaCrack), another move holding the boss (busyUntil: a Twin Horns second charge, the Deluge call),
// a phase change (the combo and its after state are dropped), and no point-blank chaining at the start (closeReady).
// Usage: node test/j3combo.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WARDEN } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { F3 } from '../shared/floor3.js';
import { BOSSTEAM } from '../shared/bossteam.js';
import { ARENAS } from '../shared/arenas.js';

let n = 0, failed = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
// Each case runs on its own (a failure is reported, the others still run).
const check = (name, fn) => { try { fn(); ok(name); } catch (e) { failed++; console.log(`  not ok ${++n} - ${name}\n    ${e.message.split('\n')[0]}`); } };
const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const EPS = 1e-9;
const DT = 0.05;
// One tick: the clock, then the scheduled callbacks that are due (like Game.tick), then fn.
function tick(g, fn) {
  g.time = Math.round((g.time + DT) * 100) / 100;
  const due = g.scheduled.filter(s => s.at <= g.time + EPS);
  g.scheduled = g.scheduled.filter(s => s.at > g.time + EPS);
  for (const s of due) s.fn();
  if (fn) quiet(fn);
}
const withRandom = (v, fn) => { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } };
// A one-combo phase table (index ph), other phases without combos.
const onlyCombo = (ph, combo, every = 99, first = 0) => {
  const seqs = [];
  for (let i = 0; i <= Math.max(ph, 2); i++) seqs.push(i === ph ? { order: [], every, first, seqs: [{ state: 'exposed', w: 1, ...combo }] } : { order: [], seqs: [] });
  return seqs;
};

// The Storm Colossus, engaged, nothing on its own timers, a combo due now.
function colossusFight() {
  const g = quiet(() => new Game());
  process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3()); delete process.env.F3_TWIST;
  const c = g.colossus, ps = ['guardian', 'ranger'].map((cls, i) => { const p = quiet(() => g.addPlayer(null, `P${i}`, cls)); p.x = F3.arena.x + i * 4; p.z = F3.arena.z - 4; c.threat.set(p.id, 1); return p; });
  g.time = 100; c.x = F3.arena.x; c.z = F3.arena.z;
  quiet(() => g.f3Colossus(c, DT));
  assert.ok(c.engaged && c.tm, 'the Colossus engaged');
  c.tm = { ...c.tm, seqs: onlyCombo(0, { steps: ['strike', 'gust'], gaps: [0.4], pause: 3 }) };
  c.phase = 0; c.comboPh = 0; c.comboT = g.time; c.seq = null; c.after = null; c.busyUntil = 0; c.windupAt = 0; c.stunUntil = 0; c.closeAt = -99;
  const ran = [];
  const run = k => { ran.push([k, g.time]); return g.time + 1; };
  return { g, c, ps, ran, run };
}

// ---- 1. A team mechanic's channel: no combo starts until the meteor has landed + BOSSTEAM.channel ----
check('a meteor channel: no combo starts (and no next step fires) until it lands + BOSSTEAM.channel', () => {
  const { g, c, ps, ran, run } = colossusFight();
  const t0 = g.time, M = BOSSTEAM.meteor, until = t0 + M.wind + BOSSTEAM.channel;
  assert.equal(g.btMeteor(c, ps[0]), true);
  let firstSeq = null;
  while (g.time < until + 1) { tick(g, () => g.bossCombo(c, run)); if (c.seq && firstSeq === null) firstSeq = g.time; if (g.time < until - EPS) assert.equal(c.seq, null, `no combo during the meteor channel (t+${(g.time - t0).toFixed(2)})`); }
  assert.ok(ran.length >= 1 && ran[0][1] >= until - EPS, `the combo starts after land + channel (${ran[0]?.[1] - t0} vs ${until - t0})`);
  // a combo already in flight: its next step waits for the channel too
  const h = colossusFight(), t1 = h.g.time;
  tick(h.g, () => h.g.bossCombo(h.c, h.run)); assert.equal(h.ran.length, 1, 'step 1 ran');
  h.g.btMeteor(h.c, h.ps[0]);
  const u1 = h.g.time + M.wind + BOSSTEAM.channel;
  while (h.g.time < u1 + 1) tick(h.g, () => h.g.bossCombo(h.c, h.run));
  assert.ok(h.ran.length === 2 && h.ran[1][1] >= u1 - EPS, `step 2 waits for the channel (${h.ran[1]?.[1] - t1})`);
});

// ---- 2. The Colossus's fall: no combo before the fight resumes + T.resume; a combo in flight is dropped ----
check('the Colossus\'s fall: no combo before resume + T.resume; a combo in flight is dropped', () => {
  const { g, c, ran, run } = colossusFight();
  const T = ARENAS.colossus.timing;
  withRandom(0, () => quiet(() => g.arenaCrack('colossus', c)));
  const resume = c.busyUntil, after = resume + T.resume;
  c.ar.stage = 0; // (the fall's own stages are server/arenas.js's; here only the combo clock matters)
  while (g.time < after + 1) { tick(g, () => g.bossCombo(c, run)); if (g.time < after - EPS) assert.equal(c.seq, null, `no combo before resume + T.resume (t=${g.time})`); }
  assert.ok(ran.length >= 1 && ran[0][1] >= after - EPS, `the combo waits for resume + T.resume (${ran[0]?.[1]} vs ${after})`);
  const h = colossusFight();
  tick(h.g, () => h.g.bossCombo(h.c, h.run)); assert.ok(h.c.seq, 'a combo in flight');
  withRandom(0, () => quiet(() => h.g.arenaCrack('colossus', h.c)));
  assert.equal(h.c.seq, null, 'the fall drops it');
});

// ---- 3. Twin Horns: a combo step waits for the second horn (no slam circle before the second lane lands) ----
check('Twin Horns: the combo\'s next step waits for the second horn charge', () => {
  const g = quiet(() => new Game());
  g.twist = { id: 'twinhorns' }; g.twistW = { ...WARDEN }; g.time = 40;
  const b = g.boss, p = quiet(() => g.addPlayer(null, 'Kael', 'guardian')), q = quiet(() => g.addPlayer(null, 'Ria', 'ranger'));
  p.x = b.x; p.z = b.z - 3; q.x = b.x + 5; q.z = b.z - 3; b.threat.set(p.id, 1); b.threat.set(q.id, 1);
  quiet(() => g.updateMob(b, DT));
  assert.ok(b.engaged && b.tm, 'the Warden engaged');
  b.tm = { ...b.tm, seqs: onlyCombo(1, { steps: ['charge', 'slam'], gaps: [0.3], pause: 3 }, 99, 0.5) };
  b.phase = 1; b.comboPh = -1; b.seq = null; b.after = null; b.busyUntil = 0; b.windupAt = 0; b.stunUntil = 0;
  b.slamT = b.quakeT = b.chargeT = b.houndT = b.spinT = b.rockT = b.twinT = Infinity; b.btKey = g.fight; b.btT = Infinity;
  g.events = [];
  const lines = [], slams = [];
  withRandom(0.3, () => {
    for (let i = 0; i < 300; i++) {
      tick(g, () => g.bossSpecials(b, p));
      for (const e of g.events) if (e.t === 'tele' && e.k === 'line') lines.push(g.time); else if (e.t === 'tele' && !e.k && e.r === b.tm.slam.r) slams.push(g.time);
      g.events = [];
    }
  });
  assert.equal(lines.length, 2, `two horn lanes (${lines})`);
  assert.ok(slams.length >= 1, 'the combo\'s slam');
  const land2 = lines[1] + b.tm.charge.wind;
  assert.ok(slams[0] >= land2 - EPS, `no slam circle before the second lane lands (slam ${slams[0]}, second lane lands ${land2})`);
});

// ---- 4. The Sovereign crosses 33% mid-combo: the next step waits for the Deluge; 'planted' does not stick ----
function sovereignFight() {
  const g = quiet(() => new Game());
  quiet(() => g.setTwist2(null));
  g.time = 30;
  const s = g.sovereign, ps = ['guardian', 'ranger'].map((cls, i) => { const p = quiet(() => g.addPlayer(null, `S${i}`, cls)); p.x = F2.arena.x + i * 4; p.z = F2.arena.z - 3; s.threat.set(p.id, 1); return p; });
  quiet(() => g.f2Sovereign(s, DT));
  assert.ok(s.engaged && s.tm, 'the Sovereign engaged');
  s.tm = { ...s.tm, seqs: onlyCombo(1, { steps: ['geyser', 'geyser'], gaps: [0.6], pause: 2.5, state: 'planted' }, 99, 0.2) };
  s.phase = 1; s.hp = s.maxHp * 0.5; s.comboPh = -1; s.seq = null; s.after = null; s.busyUntil = 0; s.windupAt = 0; s.stunUntil = 0;
  s.geyserT = s.waveT = s.thrallT = s.poolT = s.volleyT = Infinity; s.btKey = g.fight2; s.btT = Infinity;
  const calls = [], orig = g.sovMove.bind(g);
  g.sovMove = (...a) => { calls.push([a[1], g.time]); return orig(...a); };
  return { g, s, p: ps[0], calls };
}
check('the Sovereign crossing 33% mid-combo: the next step waits for the Deluge, the planted after state is dropped', () => {
  const { g, s, p, calls } = sovereignFight();
  const low = 0.3; // below the 33% line
  let crossed = null;
  for (let i = 0; i < 200; i++) {
    tick(g, () => g.sovereignSpecials(s, p));
    if (crossed === null && calls.length === 1 && g.time >= calls[0][1] + 0.5 - EPS) { s.hp = s.maxHp * low; crossed = g.time; }
    if (crossed !== null && g.time > crossed && g.time < g.delugeAt - EPS) assert.notEqual(s.after?.state, 'planted', `no planted opening during the Deluge call (t=${g.time})`);
  }
  assert.ok(crossed !== null && s.phase === 2 && g.deluge, 'phase 3: the Deluge was called');
  const later = calls.filter(c => c[0] === 'geyser' && c[1] > crossed);
  assert.equal(s.seq, null, 'the phase change dropped the combo in flight');
  assert.equal(later.length, 0, `no combo step after the crossing (phase 3 table has no combos here; steps at ${later.map(c => c[1])})`);
  assert.ok(later.every(c => c[1] >= g.delugeAt - EPS),`no combo step before the Deluge lands (steps at ${later.map(c => c[1])}, delugeAt ${g.delugeAt})`);
  // crossing during the combo's planted after state: it is dropped with the phase
  const h = sovereignFight();
  let done = null;
  for (let i = 0; i < 200 && done === null; i++) { tick(h.g, () => h.g.sovereignSpecials(h.s, h.p)); if (h.calls.length === 2 && h.g.afterOf(h.s)?.state === 'planted') done = h.g.time; }
  assert.ok(done !== null, 'the combo ended in its planted after state');
  h.s.hp = h.s.maxHp * low;
  tick(h.g, () => h.g.sovereignSpecials(h.s, h.p));
  assert.equal(h.s.phase, 2);
  assert.equal(h.g.afterOf(h.s), null, '\'planted\' does not stick through the phase change');
});

// ---- 5. A combo starts only when its first step is closeReady (no point-blank chaining), like a single move ----
check('a combo whose first step is a close move waits for closeReady', () => {
  const g = quiet(() => new Game());
  g.twist = null; g.twistW = { ...WARDEN }; g.time = 40;
  const b = g.boss, p = quiet(() => g.addPlayer(null, 'Kael', 'guardian'));
  p.x = b.x; p.z = b.z - 3; b.threat.set(p.id, 1);
  quiet(() => g.updateMob(b, DT));
  b.tm = { ...b.tm, seqs: onlyCombo(2, { steps: ['spin', 'slam'], gaps: [0.3], pause: 3 }) };
  b.phase = 2; b.comboPh = 2; b.comboT = g.time; b.seq = null; b.after = null; b.busyUntil = 0; b.windupAt = 0; b.stunUntil = 0;
  b.closeAt = g.time + 0.2; // the basic swing lands in 0.2 s
  const gap = b.tm.close.gap, ready = b.closeAt + gap, ran = [];
  const run = k => { ran.push([k, g.time]); return g.time + 1; };
  while (g.time < ready + 1) tick(g, () => g.bossCombo(b, run));
  assert.ok(ran.length >= 1 && ran[0][0] === 'spin', 'the spin combo ran');
  assert.ok(ran[0][1] >= ready - EPS, `the combo's spin waits for close.gap after the swing (${ran[0][1]} vs ${ready})`);
});

// ---- 6. The next combo counts from the end of the last one's after state (+ the phase's rest): own moves get turns ----
// The phase's longest combo pinned (a combo + its pause can outlast the phase's `every`): between two combos the boss
// still uses a move on its own timer that waits for busyUntil (Warden: slam, quake, charge, spin, the Horn Sweep;
// Colossus: Overload, the Tempest Beam, Gale Push, Lightning Strikes).
// (the review's longest: Warden spin+slam+quake ~14.1 s vs every 13; Colossus strike+beam ~16.4 s vs every 12)
const pinCombo = (tm, ph, steps) => {
  const top = tm.seqs[ph].seqs.find(s => s.steps.join() === steps);
  assert.ok(top, `phase ${ph + 1} has the combo ${steps}`);
  return { ...tm, seqs: tm.seqs.map((Q, i) => (i === ph ? { ...Q, seqs: [...Q.seqs.filter(s => s.steps.length === 1), top] } : Q)) };
};
// Combo starts and own (not combo-step) busy-gated moves in `secs` s; every pair of combo starts must have one between.
function ownBetween(g, m, step, secs, log) {
  const starts = [];
  for (let i = 0; i < secs / DT; i++) { tick(g, step); if (m.seq && (!starts.length || starts[starts.length - 1].seq !== m.seq)) starts.push({ seq: m.seq, t: g.time }); }
  assert.ok(starts.length >= 3, `three combos or more in ${secs} s (${starts.length})`);
  for (let i = 1; i < starts.length; i++) {
    const a = starts[i - 1].t, b = starts[i].t, own = log.filter(([, t, inSeq]) => !inSeq && t > a && t < b);
    assert.ok(own.length >= 1, `an own move between the combos at ${a.toFixed(2)} and ${b.toFixed(2)} (own moves: ${log.filter(e => !e[2]).map(([k, t]) => `${k}@${t.toFixed(1)}`).join(' ')})`);
  }
}
check('the longest combo pinned: an own move fires between two combos (Warden phase 3, Colossus phase 3)', () => {
  { // the Warden: spin, slam, Quake Ring (+ 3.5 s exposed) vs a combo every 13 s
    const g = quiet(() => new Game());
    g.twist = null; g.twistW = { ...WARDEN }; g.time = 40;
    const b = g.boss;
    for (let i = 0; i < 3; i++) { const p = quiet(() => g.addPlayer(null, `P${i}`, 'guardian')); p.x = b.x + i; p.z = b.z - 3; p.hp = p.maxHp = 1e9; b.threat.set(p.id, 1); }
    quiet(() => g.updateMob(b, DT));
    assert.ok(b.engaged && b.tm, 'the Warden engaged');
    b.hp = Math.floor(b.maxHp * 0.3); g.damagePlayer = () => 0; g.bossTeam = () => {};
    b.tm = pinCombo(b.tm, 2, 'spin,slam,quake');
    assert.deepEqual(b.tm.seqs[2].seqs.filter(s => s.steps.length > 1).map(s => s.steps.join()), ['spin,slam,quake']);
    const log = [], BUSY = ['slam', 'quake', 'charge', 'spin', 'sweep'];
    const wm = g.wardenMove.bind(g); g.wardenMove = (m, k, ...a) => { if (BUSY.includes(k)) log.push([k, g.time, !!m.seq]); return wm(m, k, ...a); };
    const hs = g.hornSweep.bind(g); g.hornSweep = m => { log.push(['sweep', g.time, !!m.seq]); return hs(m); };
    ownBetween(g, b, () => { g.updateMob(b, DT); g.updateCombat(DT); }, 90, log);
  }
  { // the Colossus: Lightning Strikes into the Tempest Beam (+ 3.5 s planted) vs a combo every 12 s
    const g = quiet(() => new Game());
    process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3()); delete process.env.F3_TWIST;
    const c = g.colossus;
    for (let i = 0; i < 3; i++) { const p = quiet(() => g.addPlayer(null, `P${i}`, 'guardian')); p.x = F3.arena.x + i * 3; p.z = F3.arena.z - 3; p.hp = p.maxHp = 1e9; c.threat.set(p.id, 1); }
    g.time = 100; c.x = F3.arena.x; c.z = F3.arena.z;
    quiet(() => g.f3Colossus(c, DT));
    assert.ok(c.engaged && c.tm, 'the Colossus engaged');
    c.hp = Math.floor(c.maxHp * 0.2); g.damagePlayer = () => 0; g.bossTeam = () => {}; g.arenaHold = () => 0;
    c.tm = pinCombo(c.tm, 2, 'strike,beam');
    assert.deepEqual(c.tm.seqs[2].seqs.filter(s => s.steps.length > 1).map(s => s.steps.join()), ['strike,beam']);
    const log = [];
    for (const k of ['lightningStrikes', 'galePush', 'tempestBeam']) { const f = g[k].bind(g); g[k] = (m, ...a) => { log.push([k, g.time, !!m.seq]); return f(m, ...a); }; }
    g.startOverload = m => { log.push(['overload', g.time, !!m.seq]); m.ovT = g.time + 24; }; // (no channel: updateFloor3 isn't run here)
    ownBetween(g, c, () => g.f3Colossus(c, DT), 90, log);
  }
});

// ---- 7. A basic swing started during a team channel mid-combo lands on its telegraph; the next step only after ----
check('a combo in flight, a J1 trap channel mid-gap, a swing started: it lands within a tick of its wind-up, the next step after', () => {
  const g = quiet(() => new Game());
  process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3()); delete process.env.F3_TWIST;
  const c = g.colossus;
  for (const [i, cls] of ['guardian', 'ranger'].entries()) { const p = quiet(() => g.addPlayer(null, `P${i}`, cls)); p.x = F3.arena.x + i * 3; p.z = F3.arena.z - 3; c.threat.set(p.id, 1); p.hp = p.maxHp = 1e9; }
  g.time = 100; c.x = F3.arena.x; c.z = F3.arena.z;
  quiet(() => g.f3Colossus(c, DT));
  c.tm = { ...c.tm, seqs: onlyCombo(0, { steps: ['gust', 'strike'], gaps: [0.5], pause: 3 }) };
  c.phase = 0; c.comboPh = 0; c.comboT = g.time; c.seq = null; c.after = null; c.busyUntil = 0; c.windupAt = 0; c.stunUntil = 0; c.closeAt = -99;
  c.strikeT = c.gustT = c.ovT = c.harpyT = c.beamT = Infinity; c.btT = Infinity; c.btKey = g.btFight(c); c.atkT = Infinity;
  const t0 = g.time, steps = [];
  let wind = null, bite = null, chan = false;
  const bt = g.f3Bite.bind(g); g.f3Bite = m => { if (m === c && bite === null) bite = g.time; return bt(m); };
  const cm = g.colMove.bind(g); g.colMove = (m, k, ...a) => { steps.push([k, g.time]); return cm(m, k, ...a); };
  for (let i = 0; i < 260; i++) {
    tick(g, () => g.f3Colossus(c, DT));
    if (!chan && c.seq && g.time >= t0 + 2.0) { chan = true; g.btChannel(c, 2); c.atkT = 0; } // a trap lands mid-combo (rescue.js -> btChannel)
    if (c.windupAt && wind === null) wind = { at: g.time, lands: c.windupAt };
  }
  assert.ok(chan && wind, `the channel came mid-combo and a swing wound up (${JSON.stringify(wind)})`);
  assert.ok(wind.at > t0 + 2.0, 'the swing started during the channel');
  assert.ok(bite !== null && bite <= wind.lands + DT + EPS, `the swing lands on its telegraph (wind-up ends +${(wind.lands - t0).toFixed(2)}, landed +${bite === null ? 'never' : (bite - t0).toFixed(2)})`);
  assert.deepEqual(steps.map(s => s[0]), ['gust', 'strike'], 'both steps ran (no silent cancel)');
  assert.ok(steps[1][1] >= bite - EPS, `the next step only after the swing (+${(steps[1][1] - t0).toFixed(2)} vs +${(bite - t0).toFixed(2)})`);
});

// ---- 8. A phase change releases the after state's hold (not the Deluge's) ----
check('a phase change: the after state\'s hold ends with it (Warden), the Deluge call still holds (Sovereign)', () => {
  const g = quiet(() => new Game());
  g.twist = null; g.twistW = { ...WARDEN }; g.time = 40;
  const b = g.boss, p = quiet(() => g.addPlayer(null, 'Kael', 'guardian')), q = quiet(() => g.addPlayer(null, 'Ria', 'ranger'));
  p.x = b.x; p.z = b.z - 3; q.x = b.x + 5; q.z = b.z - 3; b.threat.set(p.id, 1); b.threat.set(q.id, 1); p.hp = p.maxHp = q.hp = q.maxHp = 1e9;
  quiet(() => g.updateMob(b, DT));
  b.slamT = b.quakeT = b.chargeT = b.houndT = b.spinT = b.rockT = Infinity; b.btT = Infinity; b.btKey = g.fight; b.sweepT = Infinity; b.sweepFight = g.fight;
  b.comboT = g.time; b.busyUntil = 0; b.windupAt = 0; b.atkT = Infinity;
  let exposed = false;
  for (let i = 0; i < 400 && !exposed; i++) { tick(g, () => g.updateMob(b, DT)); exposed = !!g.openingOf(b); }
  assert.ok(exposed && b.busyUntil > g.time + 1, 'the Warden stands exposed after its combo');
  b.hp = Math.floor(b.maxHp * 0.6); b.atkT = 0; // cross 66%
  tick(g, () => g.updateMob(b, DT));
  const t0 = g.time;
  assert.equal(b.phase, 1);
  assert.equal(g.openSnap(), undefined, 'no OPENING after the phase change');
  let acted = null;
  for (let i = 0; i < 20 && acted === null; i++) { tick(g, () => g.updateMob(b, DT)); if (b.windupAt) acted = g.time; }
  assert.ok(acted !== null && acted - t0 <= 0.5 + EPS, `a swing within 0.5 s (${acted === null ? 'none' : (acted - t0).toFixed(2)}; busyUntil +${(b.busyUntil - t0).toFixed(2)})`);
  // the Sovereign crossing 33% in its planted after state: the Deluge wind-up still holds it
  const h = sovereignFight();
  h.s.tm.seqs[1].seqs[0].pause = 6; // the planted hold outlasts the Deluge wind-up: only the after state's part is released
  let planted = false;
  for (let i = 0; i < 200 && !planted; i++) { tick(h.g, () => h.g.sovereignSpecials(h.s, h.p)); planted = h.g.afterOf(h.s)?.state === 'planted'; }
  assert.ok(planted, 'planted after its combo');
  h.s.hp = h.s.maxHp * 0.3;
  tick(h.g, () => h.g.sovereignSpecials(h.s, h.p));
  assert.ok(h.g.deluge && h.s.phase === 2, 'the Deluge was called');
  assert.equal(h.g.afterOf(h.s), null, 'the planted after state is gone');
  assert.ok(h.s.busyUntil >= h.g.delugeAt - EPS, `the Deluge wind-up holds the Sovereign (busyUntil ${h.s.busyUntil}, delugeAt ${h.g.delugeAt})`);
});

// ---- 9. The fall drops the after state too (no OPENING through the crack) ----
check('the Colossus\'s fall during an opening: the after state is dropped', () => {
  const { g, c } = colossusFight();
  g.holdFor(c, 'exposed', g.time, g.time + 3);
  tick(g);
  assert.ok(g.openingOf(c), 'an opening on');
  withRandom(0, () => quiet(() => g.arenaCrack('colossus', c)));
  assert.equal(c.after, null, 'the fall drops the after state');
  assert.equal(g.openingOf(c), null, 'no opening through the crack');
});

if (failed) { console.log(`${failed} of ${n} failed`); process.exit(1); }
console.log(`all ${n} passed`);
