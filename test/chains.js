// Skill chains (shared/chains.js, server/chains.js; docs/briefs/combos-visuals.md A) and the bots' chain turn.
// Usage: node test/chains.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { angleTo } from '../shared/data.js';
import { CHAIN, CHAIN_ARTS, BOT_CHAIN, stepOf, artFor, chainStep, chainMult } from '../shared/chains.js';
import { chainTurn } from '../shared/bots/teamplay.js';
import { CLASSES } from '../shared/data.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

// ---------- pure ----------
{
  assert.equal(stepOf('swordsman', 'slash', true), 'fin');
  assert.equal(stepOf('swordsman', 'slash', false), null, 'a light basic press is no step');
  assert.equal(stepOf('cleric', 'smite', false), 'fin', 'classes without a heavy basic: any basic hit');
  assert.equal(stepOf('swordsman', 'rush', false), 'rush');
  assert.equal(stepOf('swordsman', null, true), null, 'lingering effects are no step');
  assert.equal(stepOf('swordsman', 'gslam', true), null, "another class's skill is no step");
  for (const [cls, arts] of Object.entries(CHAIN_ARTS)) {
    const ids = new Set(['fin', ...CLASSES[cls].skills.slice(1).map(s => s.id)]);
    for (const [id, a] of Object.entries(arts)) {
      assert.ok(ids.has(a.from) && ids.has(a.to) && a.from !== a.to, `${cls}.${id}: from/to are its own moves`);
      assert.equal(artFor(cls, a.from, a.to)?.id, id);
    }
  }
  ok('steps: finishers, skills, not light presses or lingering effects; every art links two of its own moves');
}
{
  let c = null, r;
  r = chainStep(c, 'swordsman', 'fin', 10); c = r.c;
  assert.equal(r.link, null); assert.equal(c.n, 1);
  r = chainStep(c, 'swordsman', 'rush', 10.8); c = r.c;
  assert.equal(r.link.n, 2); assert.equal(r.link.art.id, 'risingedge', 'fin -> rush is Rising Edge');
  assert.ok(Math.abs(chainMult(c, 11) - (1 + CHAIN.step)) < 1e-9);
  r = chainStep(c, 'swordsman', 'rush', 11.0); assert.equal(r.link, null, 'the same move landing again: no link'); c = r.c;
  r = chainStep(c, 'swordsman', 'whirl', 11.9); c = r.c;
  assert.equal(r.link.n, 3); assert.equal(r.link.art.id, 'cyclonecut');
  r = chainStep(c, 'swordsman', 'fin', 12.5); c = r.c;
  assert.equal(r.link, null, 'a move already in this chain: ignored'); assert.equal(c.n, 3, '... the chain keeps going');
  assert.ok(chainMult(c, 12.6) > 1 + CHAIN.step * 1.5, '... and its bonus');
  r = chainStep(c, 'swordsman', 'burst', 12.5); assert.equal(r.link?.n, 4, 'the next new move still links'); c = r.c;
  r = chainStep(c, 'swordsman', 'rush', 12.5 + CHAIN.window + 0.1); c = r.c;
  assert.equal(r.link, null, 'too late: a new chain'); assert.equal(c.n, 1);
  assert.ok(chainMult(c, 12.5 + CHAIN.window + 0.2) > 1 + CHAIN.step * 2.5, 'a new chain keeps the old bonus for its full hold');
  { let d = chainStep(null, 'swordsman', 'fin', 30).c; const q = chainStep(d, 'swordsman', 'rush', 30.05); assert.equal(q.link, null, 'inside minGap: ignored'); assert.equal(q.c.k, 'fin'); }
  // to x4 and done
  c = null;
  for (const [k, t] of [['fin', 20], ['rush', 20.5], ['whirl', 21], ['burst', 21.5]]) c = chainStep(c, 'swordsman', k, t).c;
  assert.equal(c.n, 4); assert.ok(c.done);
  assert.equal(chainMult(c, 21.6), 1 + CHAIN.step * 3);
  assert.equal(chainMult(c, 21.5 + CHAIN.hold + 0.01), 1, 'the bonus lapses after hold');
  r = chainStep(c, 'swordsman', 'fin', 21.8);
  assert.equal(r.link, null, 'a completed chain: the next move starts a new one'); assert.equal(r.c.n, 1);
  ok('chain state: links, arts, same move, repeats, window, x4 completes, hold');
}

// ---------- in-process ----------
const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
const X = 0, Z = 70;
const mk = (name, cls) => { const p = g.addPlayer(null, name, cls); p.x = X; p.z = Z - 2; p.lvl = 10; g.recompute(p); p.hp = p.maxHp; p.crit = 0; return p; };
const swo = mk('Swo', 'swordsman'), cle = mk('Cle', 'cleric');
g.time = 100;
const mob = g.addMob('wolf', X, Z + 1);
mob.face = angleTo(mob.x, mob.z, X, Z - 2); mob.maxHp = mob.hp = 1e6; mob.posture = 0; mob.def = { ...mob.def, posture: 1e9 };
const press = (p, sk) => { (p.chPress ||= {})[sk] = g.time; };
const hit = (p, opts) => { if (opts.sk) press(p, opts.sk); flush(); const k = events.length; g.damageMob(mob, p, 100, opts); flush(); return events.slice(k).find(e => e.t === 'hit' && e.by === p.id); };
{
  clear();
  const base = hit(swo, { tsk: 'slash', heavy: true }).a; // fin: chain x1
  g.time += 0.6;
  hit(swo, { sk: 'rush' });
  const ch = ev('chain');
  assert.equal(ch.length, 1); assert.equal(ch[0].id, swo.id); assert.equal(ch[0].n, 2); assert.equal(ch[0].k, 'risingedge'); assert.equal(ch[0].nm, 'Rising Edge'); assert.equal(ch[0].s, 'rush');
  g.time += 0.3;
  const a = []; for (let i = 0; i < 40; i++) a.push(hit(swo, { tsk: 'slash' }).a); // light presses while x2 is live
  const avg = a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg > 100 * (1 + CHAIN.step) * 0.97 && avg < 100 * (1 + CHAIN.step) * 1.03, `x2 bonus on every hit (${avg.toFixed(1)})`);
  assert.ok(base > 0);
  ok('a finisher then Rush: chain x2 event with its art, and the bonus on every hit while it is live');
}
{
  clear();
  swo.cds[1] = g.time + 5; swo.cds[3] = g.time + 9; // rush / burst cooling
  const before = [...swo.cds];
  g.time += 0.4; hit(swo, { sk: 'whirl' }); // x3: refund on the others
  const e = ev('chain').at(-1);
  assert.equal(e.n, 3);
  assert.ok(Math.abs(swo.cds[1] - (before[1] - CHAIN.refund)) < 1e-9 && Math.abs(swo.cds[3] - (before[3] - CHAIN.refund)) < 1e-9, 'other skills come back sooner');
  const p0 = mob.posture;
  g.time += 0.4; hit(swo, { sk: 'burst', heavy: true }); // x4: Storm Burst + done
  const e4 = ev('chain').at(-1);
  assert.equal(e4.n, 4); assert.equal(e4.k, 'stormburst');
  assert.ok(mob.posture - p0 > mob.def.posture * 0 && mob.posture > p0, 'posture chunk on the art / completion');
  ok('x3 takes the refund off the other skills; x4 completes with its art');
}
{
  clear();
  g.time += CHAIN.hold + 0.2;
  g.updateChains();
  assert.equal(ev('chainEnd').filter(e => e.id === swo.id).length, 1, 'chainEnd once');
  g.updateChains();
  assert.equal(ev('chainEnd').filter(e => e.id === swo.id).length, 1);
  ok('chainEnd once a chain lapses');
}
{ // a support skill counts when used (the Cleric's Heal), then Smite links
  clear();
  g.time += 5;
  cle.hp = cle.maxHp * 0.5; cle.cds[1] = 0;
  g.useSkill(cle, 1, 0);
  g.time += 0.5;
  hit(cle, { tsk: 'smite' });
  const e = ev('chain').filter(x => x.id === cle.id).at(-1);
  assert.ok(e && e.n === 2 && e.k === 'prayer', 'Heal then Smite: Answered Prayer');
  ok('support skills are a step when used (Heal -> Smite: Answered Prayer)');
}
{ // a zone ticking on long after its press is no step
  clear();
  g.time += 10;
  hit(swo, { tsk: 'slash', heavy: true });
  g.time += 0.5;
  swo.chPress.whirl = g.time - 4; flush(); g.damageMob(mob, swo, 100, { sk: 'whirl' }); // (a late tick: no press refresh)
  assert.equal(ev('chain').filter(e => e.id === swo.id).length, 0, 'no link from a late tick');
  ok('a skill\'s hits long after its press (zones, traps) are no step');
}
{ // a combo's own damage (_tbIn) is never a step
  clear();
  g.time += 5;
  g._tbIn = true; try { hit(swo, { sk: 'rush' }); } finally { g._tbIn = false; }
  assert.equal(swo.chain?.k === 'rush' && g.time - swo.chain.at < 0.01, false);
  ok('a combo or Team Burst hit is never a chain step');
}

{ // live presses: instant skills (Rush, Whirl) land inside useSkill, and still count as steps
  clear();
  g.time += 10;
  const s2 = mk('Swo2', 'swordsman'); s2.x = X; s2.z = Z - 1.5; s2.chain = null; s2.chPress = {};
  const f = angleTo(s2.x, s2.z, mob.x, mob.z);
  g.useSkill(s2, 1, f); // Rush through it
  g.time += 0.5; s2.x = mob.x; s2.z = mob.z - 1.2;
  g.useSkill(s2, 2, angleTo(s2.x, s2.z, mob.x, mob.z)); // Whirl
  const e = ev('chain').filter(x => x.id === s2.id);
  assert.ok(e.length >= 1 && e.at(-1).n === 2 && e.at(-1).k === 'cyclonecut', `Rush then Whirl by real presses: Cyclone Cut (${JSON.stringify(e)})`);
  const cd = s2.cds[1]; s2.cds[1] = g.time + 9; const pr = s2.chPress.rush;
  g.useSkill(s2, 1, 0); // still cooling: nothing fires, the old press stays
  assert.equal(s2.chPress.rush, pr, 'a press that does not fire leaves the press time alone');
  s2.cds[1] = cd;
  g.removePlayer?.(s2);
  ok('real presses of instant skills are chain steps (Rush -> Whirl: Cyclone Cut)');
}

// ---------- bots ----------
{
  const sent = [];
  const b = { cls: 'swordsman', skill: 5, t: 50, x: 0, z: 0, face: 0, cds: [0, 0, 0, 0], pressed: [], finAt: 49.6 };
  const tgt = { id: 9, x: 0, z: 2, def: { radius: 0.6 } };
  const ctx = { dodge: null, ready: true, useSkill: (bb, slot) => { sent.push(slot); return true; } };
  const orig = BOT_CHAIN.chance; BOT_CHAIN.chance = [0, 1, 1, 1, 1, 1];
  try {
    assert.equal(chainTurn(b, tgt, ctx), true); assert.deepEqual(sent, [1], 'after a finisher: Rush');
    b.pressed[1] = 50; b.t = 50.4; b.cds[1] = 1;
    assert.equal(chainTurn(b, tgt, ctx), true); assert.deepEqual(sent, [1, 2], 'after Rush: Whirl (never the same slot)');
    b.pressed[2] = 50.4; b.t = 50.4 + CHAIN.window; b.cds[2] = 1;
    assert.equal(chainTurn(b, tgt, ctx), false, 'too late');
    BOT_CHAIN.chance = [0, 0, 0, 0, 0, 0];
    b.t = 51; b.finAt = 50.8; b.cds = [0, 0, 0, 0];
    assert.equal(chainTurn(b, tgt, ctx), false, 'capability roll failed');
  } finally { BOT_CHAIN.chance = orig; }
  ok('bots keep their chain going: another chain skill right after a step, by capability');
}
console.log(`chains: ${n} checks passed`);
process.exit(0);
