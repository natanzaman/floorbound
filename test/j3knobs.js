// J3 review fixes, part B (docs/ROADMAP.md J3, docs/briefs/reviews/j3-soft-review.md findings 3, 4, 6, 7):
//  1. the knobs (damageMul, cooldownMul) reach the three bosses' basic swings; no knobs: today's numbers
//  2. the Colossus's fight health (COLOSSUS.hpBase / hpPer) at the engage
//  3. the client's opening glows are disposed, and an opening's callout fires once per opening
//  4. a bot's Gale Push escape spot stays inside the Eye of the Storm
// Usage: node test/j3knobs.js
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { Game } from '../server/game.js';
import { WARDEN, CLASSES, PACE, MOBS } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { COLOSSUS, F3 } from '../shared/floor3.js';
import { runHooks } from '../shared/bots/registry.js';
import { stepRoll } from '../shared/bots/motor.js';
import { gustDodge } from '../shared/bots/openings.js';

let n = 0;
const fails = [];
// Each check runs on its own, so one run shows every failure.
async function check(name, fn) {
  try { const msg = await fn(); console.log(`  ok ${++n} - ${msg || name}`); } catch (e) { fails.push(name); console.log(`  not ok - ${name}: ${e.message}`); }
}
const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

// ---- 1. Knobs reach the basic swings ----
// One boss swing in a fresh game: the cooldown it arms (atkT - t), its wind-up, and the damage it deals.
const TIMERS = ['slamT', 'quakeT', 'houndT', 'chargeT', 'spinT', 'rockT', 'sweepT', 'geyserT', 'waveT', 'thrallT', 'poolT', 'volleyT', 'strikeT', 'gustT', 'ovT', 'harpyT', 'beamT', 'btT', 'comboT'];
function swing(boss, knobs) {
  const g = quiet(() => new Game());
  g.bossKnobs = knobs ? { [boss]: knobs } : null;
  quiet(() => g.setTwist2(null)); process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3()); delete process.env.F3_TWIST;
  g.twist = null; g.twistW = { ...WARDEN }; g.time = 40;
  const p = quiet(() => g.addPlayer(null, 'Kael', 'guardian'));
  const m = boss === 'warden' ? g.boss : boss === 'sovereign' ? g.sovereign : g.colossus;
  const step = boss === 'warden' ? () => g.updateMob(m, 0.05) : boss === 'sovereign' ? () => g.f2Sovereign(m, 0.05) : () => g.f3Colossus(m, 0.05);
  const A = boss === 'warden' ? { x: m.x, z: m.z } : boss === 'sovereign' ? F2.arena : F3.arena;
  m.x = A.x; m.z = A.z; p.x = A.x; p.z = A.z - 3; m.threat.clear(); m.threat.set(p.id, 1);
  quiet(step); // engage (builds m.tm with the knobs)
  assert.ok(m.engaged && m.tm, `${boss}: engaged with a fight table`);
  m.busyUntil = 0; m.windupAt = 0; m.atkT = 0; m.closeAt = -99; m.holdUntil = 0; m.after = null; m.seq = null; m.stunUntil = 0;
  for (const k of TIMERS) m[k] = Infinity;
  m.sweepFight = g.fight; // (the Horn Sweep re-arms on a new attempt)
  g.time = 41; quiet(step);
  assert.ok(m.windupAt > 41, `${boss}: swung`);
  const cd = m.atkT - 41, wind = m.windupAt - 41, hits = [];
  g.damagePlayer = (pl, amt, o) => { if (pl === p) hits.push([amt, o?.src]); };
  g.time = m.windupAt + 0.01; quiet(step);
  assert.equal(hits.length, 1, `${boss}: the swing hit (${JSON.stringify(hits)})`);
  return { cd, wind, dmg: hits[0][0], atk: m.def.atk, tm: m.tm };
}
await check('knobs', async () => {
  for (const [boss, key] of [['warden', 'cleave'], ['sovereign', 'sweep'], ['colossus', 'cleave']]) {
    const base = swing(boss), k = swing(boss, { damageMul: 2, cooldownMul: 0.5 });
    const extra = base.wind * (1 - 1 / PACE); // the paced extra wind-up (doesn't eat the rest)
    // no knobs: today's numbers (MOBS atkCd, 1 x atk)
    near(base.cd, MOBS[boss].atkCd + extra, `${boss}: default cooldown = atkCd + paced extra`);
    near(base.dmg, base.atk * base.tm[key].mult, `${boss}: default damage`);
    assert.equal(base.tm[key].mult, 1, `${boss}: the swing's mult is 1 by default`);
    // knobs: 2 x damage, 0.5 x cooldown (the wind-up unchanged)
    near(k.wind, base.wind, `${boss}: wind-up unchanged`);
    near(k.dmg, 2 * base.dmg, `${boss}: damageMul 2 doubles the swing`);
    near(k.cd - extra, 0.5 * (base.cd - extra), `${boss}: cooldownMul 0.5 halves the swing's cooldown`);
  }
  return 'knobs reach the basic swings: damageMul and cooldownMul on the Warden cleave, Sovereign sweep and Colossus hammerfall; no knobs: today\'s numbers';
});

// ---- 2. The Colossus's fight health (finding 3: x ~0.72, verified with scripts/tuneboss.js) ----
await check('colossus hp', async () => {
  assert.deepEqual([COLOSSUS.hpBase, COLOSSUS.hpPer, COLOSSUS.hpExp, COLOSSUS.hpLvl], [5750, 4550, 1.9, 0.05]);
  assert.equal(MOBS.colossus.hp, 16000, 'the MOBS entry is not the fight health (left alone)');
  const g = quiet(() => new Game());
  process.env.F3_TWIST = 'calm'; quiet(() => g.newTwist3()); delete process.env.F3_TWIST;
  const party = [['Kael', 'guardian', 30], ['Ria', 'ranger', 31], ['Mio', 'cleric', 29]];
  for (const [name, cls, lvl] of party) { const p = quiet(() => g.addPlayer(null, name, cls)); p.lvl = lvl; p.x = F3.arena.x + 2; p.z = F3.arena.z - 4; }
  const c = g.colossus; quiet(() => g.engageColossus(c));
  const weight = party.reduce((s, [, cls]) => s + (COLOSSUS.hpRole[CLASSES[cls].role] ?? 1), 0), over = 30 - MOBS.colossus.level;
  assert.equal(c.maxHp, Math.round((5750 + 4550 * Math.pow(weight, 1.9)) * (1 + 0.05 * over)), 'engage health = the formula');
  assert.equal(c.hp, c.maxHp);
  return `the Colossus engages at (5750 + 4550 x weight^1.9) x (1 + 0.05 x levels over): ${c.maxHp} for a 3-player party`;
});

// ---- 3. Client: opening glows are disposed; a callout once per opening ----
await check('client glows', async () => {
  // public/openings.js imports '/shared/...' (the browser's absolute path): map it onto the repo's shared folder.
  const root = new URL('../', import.meta.url).href;
  if (nodeModule.registerHooks) nodeModule.registerHooks({ resolve: (spec, ctx, next) => (spec.startsWith('/shared/') ? next(root + spec.slice(1), ctx) : next(spec, ctx)) });
  else nodeModule.register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { return s.startsWith('/shared/') ? next(${JSON.stringify(root)} + s.slice(1), c) : next(s, c); }`)); // (Node 20)
  const el = () => ({ classList: { toggle() {} }, appendChild() {}, textContent: '', className: '' });
  globalThis.document = { createElement: el, head: el(), getElementById: () => el() };
  const store = {}; globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  let clock = 100; globalThis.performance = { now: () => clock * 1000 };
  const THREE = await import('three');
  const { initOpenings } = await import('../public/openings.js');
  const mobs = new Map(), callouts = [];
  const op = initOpenings({ state: { x: 0, z: 0 }, mobs, guide: { tip() {} }, callout: (...a) => callouts.push(a) });
  const model = () => ({ group: new THREE.Group(), height: 4 });
  const boss = { id: 7, tx: 0, tz: 5, def: { radius: 2 }, model: model() };
  mobs.set(7, boss);
  op.snap([[7, 0, 3, 3]]); op.frame();
  assert.equal(callouts.length, 1, 'a callout when the opening starts');
  const g1 = boss.model.group.children[0];
  assert.ok(g1?.isMesh && g1.visible, 'the weak point glows');
  let gone = 0; const watch = g => { g.geometry.addEventListener('dispose', () => gone++); g.material.addEventListener('dispose', () => gone++); };
  watch(g1);
  // the w.op entry drops for a snapshot and comes back (same opening): no second callout
  clock += 0.1; op.snap(undefined); op.frame();
  clock += 0.1; op.snap([[7, 0, 2.8, 3]]); op.frame();
  assert.equal(callouts.length, 1, 'the same opening back in the snapshot: no new callout');
  // the model is rebuilt: the old glow is disposed and removed, a new one on the new model
  boss.model = model(); op.frame();
  assert.equal(gone, 2, 'old glow: geometry and material disposed');
  assert.ok(!g1.parent, 'old glow: off the old model');
  const g2 = boss.model.group.children[0]; assert.ok(g2?.isMesh && g2 !== g1, 'a new glow on the new model'); watch(g2);
  // a new opening later: a callout again (until the three-callout limit)
  clock += 5; op.snap(undefined); op.frame();
  clock += 5; op.snap([[7, 1, 4, 4]]); op.frame();
  assert.equal(callouts.length, 2, 'a new opening: a new callout');
  // the boss leaves the mobs: its glow is disposed and forgotten
  mobs.delete(7); op.snap(undefined); op.frame();
  assert.equal(gone, 4, 'boss gone: its glow disposed');
  assert.ok(!g2.parent, 'boss gone: the glow is off its model');
  return 'client: opening glows disposed when the boss leaves or its model is rebuilt; one callout per opening, even when w.op blinks';
});

// ---- 4. Gale Push: the escape spot stays inside the arena ----
await check('gust spot', async () => {
  const mk = (x, z, skill = 5) => ({ t: 0, x, z, face: 0, skill, mobs: [], tele: [], waves: [], dodgeCd: 9, roll: null, gateOpen: true, sent: [], send(o) { this.sent.push(o); } });
  const A = F3.arena, G = COLOSSUS.gust, run = (b, secs, fn) => { for (let i = 0; i < secs / 0.05; i++) { b.t = Math.round((b.t + 0.05) * 100) / 100; if (!stepRoll(b)) gustDodge(b); fn?.(b); } };
  // the Colossus 16 m out from the centre, its cone facing the wall; a bot 7 m in front of it: straight out is 29 m out
  const cz = A.z + 16, b = mk(A.x, cz + 7);
  runHooks('onEvent', b, { t: 'f3fx', k: 'gust', id: 1, x: A.x, z: cz, f: 0, r: G.r, h: G.half, d: G.wind });
  let far = 0;
  run(b, G.wind + 0.5, x => { far = Math.max(far, Math.hypot(x.x - A.x, x.z - A.z)); });
  assert.ok(far <= A.r - 1 + 0.05, `stays inside the arena (radius - 1): got ${far.toFixed(2)} m out of ${A.r}`);
  const d = Math.hypot(b.x - A.x, b.z - cz), side = Math.abs(Math.atan2(b.x - A.x, b.z - cz));
  assert.ok(d > G.r + 0.5 || side > G.half, `out of the cone by the time it lands: ${d.toFixed(2)} m, ${side.toFixed(2)} rad`);
  return 'Gale Push: the escape spot is clamped to the arena (radius - 1); a bot near the wall slips out the side instead';
});

if (fails.length) { console.log(`j3knobs: ${fails.length} failed: ${fails.join(', ')}`); process.exit(1); }
console.log(`j3knobs: ${n} checks passed`);
process.exit(0);
