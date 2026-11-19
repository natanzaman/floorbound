// Threat rules (docs/ROADMAP.md J4, server/threat.js): the one target picker (targetOf), the clean-damage multiplier,
// taunt locks (cuts, renormalisation, lock, handover at 0.9 L, re-taunts, early end), the meter, and the bot rules.
// Usage: node test/threatrules.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WORLD } from '../shared/data.js';
import { TAUNT, CLEAN, THREAT, cleanMult } from '../shared/threat.js';
import { heldByTank, easeOff, mayTaunt } from '../shared/bots/threat.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const A = WORLD.arena;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function setup() {
  const g = new Game();
  g.setTwistOverride('off'); g.twist = null; g.twistW = null;
  const W = g.boss;
  const gu = g.addPlayer(null, 'Halvard', 'guardian'), cl = g.addPlayer(null, 'Heals', 'cleric'), sw = g.addPlayer(null, 'Dps', 'swordsman');
  const g2 = g.addPlayer(null, 'Brann', 'guardian');
  for (const p of [gu, cl, sw, g2]) { p.lvl = 10; g.recompute(p); p.hp = p.maxHp; }
  const party = { id: g.id(), members: [gu.id, cl.id, sw.id, g2.id] };
  g.parties.set(party.id, party);
  for (const p of [gu, cl, sw, g2]) p.party = party.id;
  W.x = A.x; W.z = A.z + 4; W.face = 0; W.engaged = true; W.hp = W.maxHp = 1e7;
  gu.x = W.x; gu.z = W.z - 3; cl.x = W.x; cl.z = W.z - 8; sw.x = W.x + 3; sw.z = W.z; g2.x = W.x - 3; g2.z = W.z;
  g.time = 10; g.events = [];
  return { g, W, gu, cl, sw, g2 };
}

// ---------- clean-damage multiplier: growth ----------
{
  const { g, W, sw } = setup();
  W.threat.set(sw.id, 0);
  g.addThreat(W, sw, 100);
  assert.equal(W.threat.get(sw.id), 100, 'first hit: ×1.0');
  for (let i = 0; i < 10; i++) { g.time += 1; g.addThreat(W, sw, 100); }
  assert.ok(near(g.cleanSecs(sw), 10) && near(g.cleanMul(sw), 1.5), `10 s of clean damage: ×1.5 (${g.cleanMul(sw)})`);
  const v0 = W.threat.get(sw.id); g.time += 1; g.addThreat(W, sw, 100);
  assert.ok(near(W.threat.get(sw.id) - v0, 100 * cleanMult(11)), 'the hit uses the multiplier');
  g.time += 10; // no damage for 10 s: only CLEAN.recent of it counts
  assert.ok(near(g.cleanSecs(sw), 11 + CLEAN.recent), `clean time only runs within ${CLEAN.recent} s of a hit`);
  for (let i = 0; i < 40; i++) { g.time += 1; g.addThreat(W, sw, 1); }
  assert.equal(g.cleanMul(sw), CLEAN.max, 'capped at ×2.5');
  // heal threat and plain mobs: no multiplier
  const boar = [...g.mobs.values()].find(m => m.type === 'boar');
  boar.threat.set(sw.id, 0); g.addThreat(boar, sw, 100);
  assert.equal(boar.threat.get(sw.id), 100, 'plain mobs: no multiplier');
  W.threat.set(sw.id, 0); g.addThreat(W, sw, 100, 'heal');
  assert.equal(W.threat.get(sw.id), 100, 'heal threat: no multiplier');
  ok('clean multiplier: 1 + 0.05 × clean seconds (only while hitting a boss/elite), capped at ×2.5; damage threat on bosses/elites only');
}

// ---------- clean-damage multiplier: resets ----------
{
  const { g, W, gu, cl, sw } = setup();
  const random = Math.random; Math.random = () => 0.5;
  const grow = () => { for (let i = 0; i < 12; i++) { g.time += 1; g.addThreat(W, sw, 10); } assert.ok(g.cleanMul(sw) > 1.5); };
  grow(); sw.iframeUntil = g.time + 1; g.damagePlayer(sw, 30, { src: 'warden' });
  assert.ok(g.cleanMul(sw) > 1.5, 'an evaded hit: no reset');
  sw.iframeUntil = 0; g.damagePlayer(sw, 30, { src: 'warden' });
  assert.equal(g.cleanMul(sw), 1, 'HP loss: reset');
  grow(); sw.hp = sw.maxHp; sw.shield = { hp: 200, max: 200, until: g.time + 5, by: cl.id }; g.damagePlayer(sw, 30, { src: 'warden' });
  assert.equal(sw.hp, sw.maxHp); assert.equal(g.cleanMul(sw), 1, 'shield loss: reset');
  sw.shield = null;
  grow(); gu.x = sw.x + 1; gu.z = sw.z; gu.coverCd = 0; sw.cover = { by: gu.id, until: g.time + 1.5 };
  g.damagePlayer(sw, 30, { src: 'warden' });
  assert.ok(g.cleanMul(sw) > 1.5, 'a Covered hit: no reset for the covered player');
  grow(); g.fight = { start: g.time - 30, ids: new Set([sw.id]), deaths: 0, hp: W.maxHp }; g.endFight('wipe', W);
  assert.equal(g.cleanMul(sw), 1, 'end of the fight: reset');
  grow(); g.tauntMob(W, gu);
  assert.equal(g.cleanMul(sw), 1, 'a taunt: reset');
  Math.random = random;
  ok('clean multiplier resets on HP or shield loss (not evaded or Covered hits), a taunt and the end of the fight');
}

// ---------- taunt: renormalise, cut, lock ----------
{
  const { g, W, gu, cl, sw } = setup();
  W.threat.set(gu.id, 100); W.threat.set(sw.id, 3000); W.threat.set(cl.id, 600);
  W.thLog = [[g.time - 3, sw.id, 4800], [g.time - 2, cl.id, 600], [g.time - 2, gu.id, 9000]]; // sw 800/s; the taunter's own doesn't count
  const R = Math.max(800, TAUNT.atkMul * Math.max(gu.atk, cl.atk, sw.atk)), L = TAUNT.Lmul * R;
  assert.equal(g.tauntRate(W, gu), R);
  g.tauntMob(W, gu, 'taunt');
  const k = L / 3000;
  assert.ok(near(W.threat.get(gu.id), L), 'taunter = L');
  assert.ok(near(W.threat.get(sw.id), Math.min(3000 * k, 0.5 * L)), 'the old top drops to 50% of L');
  assert.ok(near(W.threat.get(cl.id), Math.min(600 * k, 0.5 * L)), 'others renormalised (and capped at 50%)');
  assert.ok(near(W.lock.L, L) && W.lock.by === gu.id && near(W.lock.until, g.time + TAUNT.lock.taunt));
  // R's floor: 2 × the highest fighter's attack
  W.thLog = []; g.tauntMob(W, gu);
  assert.ok(near(W.lock.L, TAUNT.Lmul * TAUNT.atkMul * Math.max(gu.atk, cl.atk, sw.atk)), 'R floor = 2 × top attack');
  ok(`taunt: L = ${TAUNT.Lmul} × R, everyone renormalised to L, taunter = L, others ≤ ${TAUNT.cut * 100}% of L (losing aggro to a taunt: 50%)`);

  // during the lock: the target is T, T's entry frozen, others build past L
  const L2 = W.lock.L;
  g.addThreat(W, gu, 999);
  assert.ok(near(W.threat.get(gu.id), L2), "T's entry frozen at L");
  W.threat.set(sw.id, 2 * L2);
  assert.equal(g.targetOf(W), gu, 'the boss stays on the taunter even past 100%');
  const before = W.threat.get(cl.id); g.addThreat(W, cl, 50, 'heal');
  assert.ok(W.threat.get(cl.id) > before, 'others build normally');
  ok('the lock: the target is the taunter, their entry stays at L, others build normally');
}

// ---------- lock end: handover at 0.9 L ----------
for (const [frac, who] of [[0.85, 'gu'], [0.9, 'gu'], [0.95, 'sw']]) {
  const { g, W, gu, sw } = setup();
  W.threat.set(sw.id, 100); g.tauntMob(W, gu); const L = W.lock.L;
  W.threat.set(sw.id, frac * L);
  g.time += TAUNT.lock.taunt - 0.05; assert.equal(g.targetOf(W), gu);
  g.time += 0.1;
  const t = g.targetOf(W);
  assert.equal(W.lock, null);
  assert.ok(near(W.threat.get(gu.id), TAUNT.handover * L), 'the taunter drops to 0.9 L');
  assert.equal(t, who === 'gu' ? gu : sw, `at ${frac} L the ${who === 'gu' ? 'tank keeps it' : 'DPS takes it'}`);
}
ok('lock end: the taunter drops to 0.9 L; 0.85 L: tank keeps it, a tie at 0.9 L goes to the tank, 0.95 L: the DPS takes it');

// ---------- double taunt, early end, lock durations ----------
{
  const { g, W, gu, sw, g2 } = setup();
  W.threat.set(sw.id, 500); g.tauntMob(W, gu);
  g.time += 2; W.threat.set(sw.id, 0.7 * W.lock.L);
  g.tauntMob(W, g2, 'warcry');
  const L2 = W.lock.L;
  assert.equal(W.lock.by, g2.id); assert.equal(g.targetOf(W), g2, 'the latest taunt wins');
  assert.ok(near(W.threat.get(g2.id), L2) && W.threat.get(gu.id) <= 0.5 * L2 + 1e-6 && W.threat.get(sw.id) <= 0.5 * L2 + 1e-6, 'same cuts from the current values');
  ok('re-taunt by another Guardian replaces the lock with the same steps');

  for (const [why, hurt, undo] of [
    ['downed', p => { p.downed = { at: g.time }; }, p => { p.downed = null; }],
    ['trapped', p => { p.trap = { kind: 'vines' }; }, p => { p.trap = null; }],
    ['dead', p => { p.dead = true; }, p => { p.dead = false; }],
    ['out of the room', () => W.threat.delete(g2.id), () => {}],
  ]) {
    W.threat.set(g2.id, 1); W.threat.set(sw.id, 100); g.tauntMob(W, g2);
    const v = W.threat.get(g2.id);
    hurt(g2);
    const t = g.targetOf(W);
    assert.equal(W.lock, null, `${why}: the lock ends early`);
    assert.notEqual(t, g2);
    if (W.threat.has(g2.id)) assert.equal(W.threat.get(g2.id), v, `${why}: no handover`);
    undo(g2);
  }
  ok('the lock ends early (no handover) if the taunter is downed, trapped, dead or out of the room');

  assert.equal(g.lockSecs(gu, 'taunt'), 6); assert.equal(g.lockSecs(gu, 'warcry'), 6);
  assert.equal(g.lockSecs(gu, 'challenge'), 7, 'Challenge 8 s, capped at cooldown (10) − 3');
  gu.tal.sk.taunt = { dur: 25 };
  assert.equal(g.lockSecs(gu, 'taunt'), 7, 'Provoke +25%: 7.5 s, capped at 7');
  gu.tal.sk.taunt = { dur: 25, cd: -10 };
  assert.ok(near(g.lockSecs(gu, 'taunt'), 6), 'a shorter cooldown shortens the cap');
  delete gu.tal.sk.taunt;
  ok('lock lengths: Taunt / War Cry 6 s, Challenge 8 s, × Provoke, never above cooldown − 3 s');
}

// ---------- targetOf ----------
{
  const { g, W, gu, cl, sw } = setup();
  W.threat.set(gu.id, 100); W.threat.set(sw.id, 500); W.threat.set(cl.id, 300);
  sw.trap = { kind: 'crystal' }; cl.downed = { at: g.time };
  assert.equal(g.targetOf(W), gu, 'skips trapped and downed players');
  gu.dead = true;
  assert.equal(g.targetOf(W), sw, 'nobody free: the top of the rest (still alive), not a wipe');
  gu.dead = false; sw.trap = null; cl.downed = null;
  W.threat.set(cl.id, 500);
  W.tgtId = cl.id; assert.equal(g.targetOf(W), cl, 'a tie goes to the current target');
  W.tgtId = sw.id; assert.equal(g.targetOf(W), sw);
  // the floors' AIs and the snapshot use it
  const w = JSON.parse(g.snapshot());
  assert.equal(new Map(w.th).get(W.id), sw.id);
  sw.trap = { kind: 'vines' };
  g.updateMob(W, 0.05);
  assert.notEqual(W.tgtId, sw.id, "the Warden's AI goes through targetOf");
  ok('targetOf: lock holder, else top threat among living, non-downed, non-trapped players (tie: current target)');
}

// ---------- the skills: Taunt, Challenge, War Cry, Phalanx ----------
{
  const { g, W, gu, sw } = setup();
  W.threat.set(sw.id, 5000);
  g.useSkill(gu, 1, 0);
  assert.ok(W.lock && W.lock.by === gu.id && g.targetOf(W) === gu, 'Taunt locks every mob it hits');
  assert.ok(W.threat.get(sw.id) <= 0.5 * W.lock.L + 1e-6);
  const { g: g3, W: W3, gu: gu3, sw: sw3 } = setup();
  W3.threat.set(sw3.id, 5000);
  g3.threatToTop(W3, gu3);
  assert.equal(W3.lock, undefined); assert.equal(W3.threat.get(sw3.id), 5000, 'Phalanx: no cuts, no lock');
  assert.equal(g3.targetOf(W3), gu3, 'Phalanx: to the top');
  ok('Taunt (useSkill) locks with cuts; Phalanx goes to the top with no lock and no cuts');
}

// ---------- meter ----------
{
  const { g, W, gu, cl, sw } = setup();
  W.threat.set(sw.id, 100); W.threat.set(cl.id, 50);
  for (let i = 0; i < 12; i++) { g.time += 1; g.addThreat(W, sw, 10); }
  g.tauntMob(W, gu); const L = W.lock.L;
  for (let i = 0; i < 8; i++) { g.time += 0.25; g.addThreat(W, sw, 1); }
  W.threat.set(sw.id, 0.72 * L); W.threat.set(cl.id, 2 * L);
  assert.deepEqual(g.meFor(sw).th, [W.id, 72, 0, 11, 4, gu.id], 'during a lock: v / L, ×1.1, 4 s left, by the taunter');
  assert.equal(g.meFor(cl).th[1], TAUNT.meterMax, 'shown up to 150%');
  assert.deepEqual(g.meFor(gu).th.slice(0, 3), [W.id, 100, 200], 'the taunter: 100, runner-up as % of L');
  ok('me.th = [boss, pct, next, mult×10, lockSecs, lockBy]: v / L during a lock (≤150), the multiplier, the countdown');
}

// ---------- a steady damage dealer gains about 25% of L per lock ----------
function steady(hitEvery) { // hitEvery: the boss hits the DPS this often (resets the multiplier), 0: never
  const { g, W, gu, sw } = setup();
  W.threat.set(gu.id, 1); W.threat.set(sw.id, 1);
  const rate = 40 * sw.atk; // well above the 2 × attack floor
  let k = 0;
  const step = () => { g.time += 0.05; if (hitEvery && ++k % Math.round(hitEvery * 20) === 0) g.cleanReset(sw); g.addThreat(W, sw, rate * 0.05); };
  for (let i = 0; i < 20 * 12; i++) step();
  g.tauntMob(W, gu);
  const L = W.lock.L, at0 = W.threat.get(sw.id) / L;
  while (W.lock) { step(); g.targetOf(W); }
  return W.threat.get(sw.id) / L - at0;
}
{
  const hit = steady(1), clean = steady(0);
  assert.ok(Math.abs(hit - 0.25) < 0.02, `gain ${hit.toFixed(3)} of L`);
  assert.ok(clean > 0.27 && clean < 0.31, `gain ${clean.toFixed(3)} of L`);
  ok(`a steady DPS gains ${(hit * 100).toFixed(0)}% of L per 6 s lock (${(clean * 100).toFixed(0)}% when never hit: R is measured before the multiplier, which restarts at the taunt)`);
}

// ---------- bots ----------
{
  const boss = { id: 7, def: { boss: true }, tgt: 2 };
  const players = [{ id: 1, cls: 'guardian' }, { id: 2, cls: 'guardian' }, { id: 3, cls: 'swordsman' }];
  const tank = { id: 1, players, me: { th: [7, 40, 0, 10, 0, 0] } };
  assert.ok(heldByTank(tank, boss) && !mayTaunt(tank, boss), 'another Guardian holds it: no taunt');
  assert.ok(!heldByTank(tank, { ...boss, tgt: 3 }), 'a DPS holds it: taunt it back');
  tank.me.th = [7, 40, 0, 10, 4, 2];
  assert.ok(heldByTank(tank, { ...boss, tgt: 0 }), 'another Guardian has it locked');
  assert.ok(!mayTaunt({ ...tank, noTaunt: true, me: null }, { ...boss, tgt: 3 }), 'noTaunt (bot runs)');
  const ctx = { tank: players[0] };
  const dps = (skill, th) => ({ id: 3, role: 'dps', skill, me: { th } });
  assert.ok(easeOff(dps(5, [7, 92, 0, 10, 3, 1]), boss, ctx), 'skill 5 eases off at 92% of L during a lock');
  assert.ok(easeOff(dps(4, [7, 91, 0, 10, 0, 0]), boss, ctx), 'skill 4 eases off at 91% of top');
  assert.ok(!easeOff(dps(3, [7, 95, 0, 10, 3, 1]), boss, ctx), 'skill 3 does not');
  assert.ok(!easeOff(dps(5, [7, 80, 0, 10, 3, 1]), boss, ctx), 'below 90%: keep going');
  assert.ok(!easeOff(dps(5, [7, 100, 50, 10, 0, 0]), boss, ctx), 'already the top: no point');
  assert.ok(!easeOff(dps(5, [7, 95, 0, 10, 0, 0]), boss, { tank: null }), 'no tank: no point');
  assert.ok(!easeOff({ ...dps(5, [7, 95, 0, 10, 0, 0]), role: 'healer' }, boss, ctx), 'DPS only');
  ok('bots: tanks never taunt a boss another Guardian holds or locked; only skill 4+ DPS ease off at 90%');
}

console.log(`threatrules: ${n} passed`);
