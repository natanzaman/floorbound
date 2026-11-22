// In-process checks for the talent trees (shared/talents.js, server/talents.js): points per level, tier gates,
// prerequisites, ranks, refunds/respec only at a Skill Shrine, every effect type and every keystone,
// plus a save/load round trip through a real server + Postgres when DATABASE_URL is set.
// Usage: node test/talents.js        (DATABASE_URL=... PORT=3593 node test/talents.js for the persistence check)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { CLASSES, DODGE, GUARD, SWITCH, MAX_LEVEL, xpToNext, angleTo } from '../shared/data.js';
import { SHRINES } from '../shared/mastery.js';
import { nodeDef,
  TALENTS, TREES, KEYS, pointsAt, newTalents, allocError, spendBlock, refundBlock, talentTotals, nodesOf, spentOf,
} from '../shared/talents.js';

const realRandom = Math.random;
Math.random = () => 0.5; // no crits, no damage variance

const g = new Game();
g.mobs.clear(); g.boss = null;
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = (t, f = () => true) => { flush(); return events.filter(e => e.t === t && f(e)); };
const clear = () => { flush(); events = []; };
function advance(dt) {
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    for (const zn of g.zones) if (g.time >= zn.next) { zn.next = g.time + 0.5; g.zoneTick(zn); }
    g.zones = g.zones.filter(zn => g.time < zn.until);
    g.updateMastery();
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);

const X = 0, Z = 70; // open ground north of town
let live = [];
function mk(cls, alloc = {}, lvl = MAX_LEVEL, x = X, z = Z) {
  const p = g.addPlayer(null, `T${g.nextId}`, cls);
  p.lvl = lvl; p.x = x; p.z = z; p.face = 0;
  g.setTalents(p, alloc);
  assert.deepEqual(p.talents, alloc, `alloc accepted for ${cls}`);
  p.hp = p.maxHp;
  live.push(p);
  return p;
}
function done() {
  for (const p of live) g.removePlayer(p);
  live = [];
  for (const m of [...g.mobs.values()]) g.mobs.delete(m.id);
  g.zones = []; g.scheduled = []; g.time += 30; clear();
}
function wolf(x = X, z = Z + 2.5, hp = 1e6) {
  const m = g.addMob('wolf', x, z);
  m.hp = m.maxHp = hp; m.x = x; m.z = z; m.sx = x; m.sz = z;
  return m;
}
const dealt = (m, p) => ev('hit', e => e.id === m.id && e.by === p.id).reduce((a, e) => a + e.a, 0);
const face = (p, m) => { p.face = angleTo(p.x, p.z, m.x, m.z); };
const slot = (p, id) => CLASSES[p.cls].skills.findIndex(s => s.id === id);
const botAlloc = (cls, k) => { const a = {}; for (const id of TREES[cls].bot.slice(0, k)) a[id] = (a[id] || 0) + 1; return a; };
g.time = 100;

// ---------- data sanity ----------
{
  for (const [cls, t] of Object.entries(TREES)) {
    assert.ok(CLASSES[cls], `${cls} is a class`);
    assert.equal(t.branches.length, 3);
    for (const b of t.branches) {
      assert.equal(b.nodes.filter(nd => nd.keystone && !nd.sub).length, 1, `${b.id}: one keystone`);
      assert.equal(b.nodes.find(nd => nd.keystone).tier, TALENTS.tiers.length - 1, `${b.id}: keystone at the bottom`);
      for (const nd of b.nodes) {
        assert.ok(nd.max >= 1 && nd.max <= 3 && nd.fx.length, nd.id);
        for (const q of nd.req || []) assert.ok(b.nodes.some(o => o.id === q && o.tier < nd.tier), `${nd.id}: req ${q} above it, same branch`);
        for (const e of nd.fx) if (e.sk && e.sk !== 'basic' && !(nd.sub && e.sk === 'sig')) assert.ok(CLASSES[cls].skills.some(s => s.id === e.sk), `${nd.id}: skill ${e.sk}`);
        for (const e of nd.fx) if (e.key) assert.ok(KEYS[e.key], `${nd.id}: key ${e.key}`);
      }
    }
    assert.ok(nodesOf(cls).some(nd => nd.coop || nd.fx.some(e => e.stat === 'sw' || e.aura)), `${cls}: a co-op / Switch node`);
    // the bot path is legal all the way to level 20
    const a = {};
    for (const id of t.bot) { assert.equal(spendBlock(cls, a, MAX_LEVEL, id), null, `${cls} bot path ${id}`); a[id] = (a[id] || 0) + 1; }
    assert.equal(spentOf(a), pointsAt(MAX_LEVEL));
  }
  ok('trees: 3 branches per class, keystones at the bottom, prerequisites above, co-op nodes, legal bot paths');
}

// ---------- points per level ----------
{
  assert.equal(pointsAt(1), 0); assert.equal(pointsAt(2), 1); assert.equal(pointsAt(10), 9); assert.equal(pointsAt(20), 19); assert.equal(pointsAt(30), 29); assert.equal(pointsAt(99), 29);
  const p = mk('swordsman', {}, 1);
  assert.equal(g.talentsMsg(p).pts, 0);
  g.talentAction(p, { op: 'spend', id: 'sw_edge' });
  assert.deepEqual(p.talents, {}, 'no points at level 1');
  clear(); p.talentsDirty = false;
  g.giveXp(p, xpToNext(1));
  assert.equal(p.lvl, 2);
  assert.equal(ev('tpoint', e => e.to === p.id && e.n === 1 && e.got === 1).length, 1, 'level-up announces the point');
  assert.ok(p.talentsDirty, 'and re-sends the talents');
  assert.equal(g.talentsMsg(p).pts, 1);
  g.talentAction(p, { op: 'spend', id: 'sw_edge' });
  assert.deepEqual(p.talents, { sw_edge: 1 });
  assert.equal(ev('talent', e => e.to === p.id && e.op === 'spend' && e.n === 'sw_edge').length, 1);
  g.talentAction(p, { op: 'spend', id: 'sw_edge' });
  assert.deepEqual(p.talents, { sw_edge: 1 }, 'only one point at level 2');
  assert.ok(ev('sys', e => e.to === p.id && /No talent points/.test(e.text)).length);
  done();
  ok('points: 1 per level from level 2 (19 at 20); a level-up announces it; spending stops at zero');
}

// ---------- tier gates, prerequisites, ranks ----------
{
  const p = mk('swordsman');
  const spend = id => g.talentAction(p, { op: 'spend', id });
  spend('sw_finale');
  assert.equal(p.talents.sw_finale, undefined, 'tier 2 is closed with 0 points above');
  spend('sw_edge'); spend('sw_edge');
  assert.match(spendBlock('swordsman', p.talents, p.lvl, 'sw_finale'), /Needs 3 points/);
  spend('sw_precision');
  spend('sw_finale');
  assert.equal(p.talents.sw_finale, 1, 'opens after 3 points in tier 1');
  spend('sw_rush'); // Tempo tier 2: the gate is open, but it hangs from Light Feet
  assert.equal(p.talents.sw_rush, undefined);
  assert.match(spendBlock('swordsman', p.talents, p.lvl, 'sw_rush'), /Light Feet/);
  spend('sw_feet'); spend('sw_rush');
  assert.equal(p.talents.sw_rush, 1, 'prerequisite met');
  spend('sw_edge'); spend('sw_edge');
  assert.equal(p.talents.sw_edge, 3, 'max rank 3');
  assert.match(spendBlock('swordsman', p.talents, p.lvl, 'sw_edge'), /max rank/);
  assert.ok(spendBlock('swordsman', p.talents, p.lvl, 'sw_exec'), 'keystone gated');
  spend('gu_plate');
  assert.equal(p.talents.gu_plate, undefined, 'another class\'s talent');
  // sanitising saved records
  assert.deepEqual(newTalents({ sw_edge: 2, bogus: 3, gu_plate: 1 }, 'swordsman', 5), { sw_edge: 2 });
  assert.deepEqual(newTalents({ sw_edge: 9 }, 'swordsman', 20), { sw_edge: 3 }, 'ranks clamped');
  assert.deepEqual(newTalents({ sw_finale: 1 }, 'swordsman', 20), {}, 'an illegal tree resets for free');
  assert.deepEqual(newTalents({ sw_edge: 3, sw_precision: 3 }, 'swordsman', 4), {}, 'more points than the level gives resets');
  assert.match(allocError('swordsman', { sw_exec: 1 }), /Executioner/);
  done();
  ok('tiers open after 3/6/10/14 points above; prerequisites (any parent); max ranks; other classes; sanitising');
}

// ---------- refunds and respec: only at a Skill Shrine ----------
{
  const p = mk('swordsman', { sw_edge: 3, sw_precision: 1, sw_finale: 1 });
  g.talentAction(p, { op: 'refund', id: 'sw_edge' });
  assert.equal(p.talents.sw_edge, 3, 'no refunds in the field');
  g.talentAction(p, { op: 'reset' });
  assert.equal(spentOf(p.talents), 5, 'no respec in the field');
  assert.ok(ev('sys', e => e.to === p.id && /Skill Shrine/.test(e.text)).length);
  p.x = SHRINES[0].x + 1; p.z = SHRINES[0].z;
  assert.ok(g.atShrine(p));
  g.talentAction(p, { op: 'refund', id: 'sw_edge' });
  assert.equal(p.talents.sw_edge, 2, 'refund one rank at the shrine');
  assert.match(refundBlock('swordsman', p.talents, 'sw_precision'), /depend/);
  g.talentAction(p, { op: 'refund', id: 'sw_precision' });
  assert.equal(p.talents.sw_precision, 1, 'a refund that would break the tree is refused');
  const atk = p.atk;
  g.talentAction(p, { op: 'reset' });
  assert.deepEqual(p.talents, {}, 'respec refunds everything');
  assert.ok(p.atk < atk, 'and the bonuses go away');
  g.talentAction(p, { op: 'spend', id: 'sw_feet' });
  assert.equal(p.talents.sw_feet, 1, 'spending works anywhere (here too)');
  p.dead = true; g.talentAction(p, { op: 'reset' });
  assert.equal(p.talents.sw_feet, 1, 'not while dead');
  done();
  ok('refunds and respec are free but only at a Skill Shrine; a refund can\'t break prerequisites or tier gates');
}

// ---------- stat effects ----------
{
  const base = mk('swordsman'), t = mk('swordsman', { sw_edge: 3, sw_precision: 3 }, MAX_LEVEL, X + 40);
  near(t.atk, base.atk * 1.09, 1e-9, 'atk'); near(t.crit, base.crit + nodeDef('sw_precision').fx[0].v * 3 / 100, 1e-9, 'crit');
  done();
  const gb = mk('guardian'), gp = mk('guardian', { gu_plate: 3 }, MAX_LEVEL, X + 40), gd = mk('guardian', { gu_brace: 3 }, MAX_LEVEL, X - 40);
  assert.equal(gp.maxHp, Math.round(gb.maxHp * 1.12), 'hp');
  near(gd.gearDr, 0.09, 1e-9, 'dr');
  g.damagePlayer(gb, 100, { src: 'test' }); g.damagePlayer(gd, 100, { src: 'test' });
  assert.equal(gb.maxHp - gb.hp, 100); assert.equal(gd.maxHp - gd.hp, 91, 'dr cuts damage taken');
  done();
  const h = mk('swordsman', { sw_feet: 2, sw_roll: 1, sw_riposte: 3, sw_tempo: 3 });
  near(h.haste, 0.09, 1e-9, 'haste');
  near(g.skillCd(h, CLASSES.swordsman.skills[2], 2), 8 * 0.91, 1e-9, 'haste shortens skill cooldowns');
  assert.equal(talentTotals('swordsman', h.talents).stat.speed, 8, 'move speed (client-side, server tolerates it)');
  assert.ok(talentTotals('guardian', { gu_charge: 3 }).stat.speed <= TALENTS.caps.speed);
  // dodge cooldown
  g.dodge(h, 0);
  near(h.dodgeCd - g.time, DODGE.cd * (1 - 0.07), 1e-9, 'Quick Roll');
  // counter damage (Riposte +45%) after a perfect dodge
  const m = wolf(); face(h, m);
  advance(1); g.dodge(h, h.face); advance(0.05);
  g.damagePlayer(h, 20, { src: 'wolf bite', mob: m });
  assert.ok(h.counterUntil > g.time, 'perfect dodge');
  clear();
  g.damageMob(m, h, 10, {});
  assert.equal(dealt(m, h), Math.round(10 * 1.5 * 1.45), 'counter +50% x Riposte');
  done();
  // Switch damage, posture, Broken damage
  const s = mk('swordsman', { sw_switch: 3, sw_pressure: 3, sw_opening: 2 }), other = mk('swordsman', {}, MAX_LEVEL, X + 1);
  near(s.swPow, 0.24, 1e-9, 'sw');
  let w = wolf();
  w.staggerUntil = g.time + 2; w.staggerBy = other.id; w.switched = false;
  g.damageMob(w, s, 10, {});
  assert.equal(dealt(w, s), Math.round(10 * SWITCH.first * 1.24 * 1.16), 'Switch: +24% Switch damage and +16% vs Broken');
  w = wolf(X + 3);
  g.damageMob(w, other, 10, {}); const p0 = w.posture;
  w.posture = 0; g.damageMob(w, s, 10, {});
  near(w.posture, p0 * 1.24, 1e-6, 'posture +24%');
  w.staggerUntil = g.time + 2; w.staggerBy = s.id; clear();
  g.damageMob(w, s, 10, {});
  assert.equal(dealt(w, s), Math.round(10 * 1.16), 'Opportunist: +16% vs Broken (own Break, no Switch)');
  done();
  // healing
  const cl = mk('cleric', { cl_hands: 3 }), hurt = mk('swordsman', {}, MAX_LEVEL, X + 2);
  hurt.hp = 10;
  assert.equal(g.healPlayer(hurt, 100, cl, 'heal'), 115, 'healing +15%');
  done();
  // threat
  const tb = mk('guardian'), tm = mk('guardian', { gu_menace: 3 }, MAX_LEVEL, X + 2);
  w = wolf();
  g.damageMob(w, tb, 10, {}); g.damageMob(w, tm, 10, {});
  near(w.threat.get(tm.id), w.threat.get(tb.id) * 1.45, 1e-6, 'threat +45%');
  done();
  // guard block
  const g1 = mk('guardian', { gu_brace: 3 }), g2 = mk('guardian', { gu_brace: 3, gu_guard: 2 }, MAX_LEVEL, X + 30);
  for (const gg of [g1, g2]) {
    const mm = wolf(gg.x, gg.z + 2.5); face(gg, mm);
    g.guard(gg, true); gg.guardAt = g.time - 1; // held for a while: a guard, not a parry
    g.damagePlayer(gg, 200, { src: 'wolf bite', mob: mm });
  }
  const l1 = g1.maxHp - g1.hp, l2 = g2.maxHp - g2.hp;
  near(l2, l1 * (1 - 0.86) / (1 - GUARD.dr), 1.5, 'Stalwart Guard: 86% blocked instead of 70%');
  done();
  ok('stats: attack, health, crit, haste, damage reduction, Switch, posture, Broken, healing, threat, dodge, counter, guard, speed');
}

// ---------- skill effects: cooldown, damage, finisher, radius, duration ----------
{
  const b = mk('swordsman'), t = mk('swordsman', { sw_feet: 2, sw_roll: 1, sw_rush: 2 }, MAX_LEVEL, X + 40);
  near(g.skillCd(t, CLASSES.swordsman.skills[1], 1), 6 * 0.76, 1e-9, 'Swift Rush cooldown');
  const mb = wolf(b.x, b.z + 4), mt = wolf(t.x, t.z + 4);
  g.useSkill(b, 1, 0); g.useSkill(t, 1, 0);
  near(t.cds[1] - g.time, 6 * 0.76, 1e-9, 'the real cooldown');
  assert.equal(dealt(mt, t), Math.round(b.atk * 1.6 * 1.2), 'Swift Rush +20% damage');
  assert.equal(dealt(mb, b), Math.round(b.atk * 1.6));
  done();
  // finisher
  const f = mk('swordsman', { sw_edge: 3, sw_finale: 2 }), m = wolf(X, Z + 2);
  const hitsOf = () => ev('hit', e => e.id === m.id && e.by === f.id).map(e => e.a);
  for (let i = 0; i < 3; i++) { g.useSkill(f, 0, 0); advance(0.8); }
  const [h1, , h3] = hitsOf();
  assert.equal(h1, Math.round(f.atk)); assert.equal(h3, Math.round(f.atk * 1.6 * 1.4), 'Finishing Flourish: 3rd hit +40%');
  done();
  // radius (Wide Arc): a wolf 5.3 m away is outside Whirl's 4 m ring, inside 4.96 m
  const r0 = mk('swordsman'), r1 = mk('swordsman', { sw_edge: 3, sw_precision: 2, sw_burst: 1, sw_wide: 2 }, MAX_LEVEL, X + 40);
  const w0 = wolf(r0.x, r0.z + 5.3), w1 = wolf(r1.x, r1.z + 5.3);
  g.useSkill(r0, 2, 0); g.useSkill(r1, 2, 0);
  assert.equal(dealt(w0, r0), 0, 'base Whirl misses');
  assert.equal(dealt(w1, r1), Math.round(r1.atk * 1.4 * 1.16), 'Wide Arc reaches it (+16% damage)');
  assert.ok(ev('fx', e => e.id === r1.id && e.s === 'whirl' && Math.abs(e.r - 4.96) < 0.01).length, 'the ring visual grows too');
  done();
  // duration (Fortress) and Sanctuary radius + duration
  const gw = mk('guardian', { gu_plate: 3, gu_fortress: 2 });
  g.useSkill(gw, 2, 0);
  near(gw.dr.until - g.time, 4 * 1.4, 1e-9, 'Shield Wall lasts +40%');
  assert.ok(ev('buff', e => e.id === gw.id && e.k === 'wall' && Math.abs(e.d - 5.6) < 0.01).length);
  near(g.skillCd(gw, CLASSES.guardian.skills[2], 2), 14 * 0.84, 1e-9, 'and -16% cooldown');
  const cs = mk('cleric', { cl_vigor: 3, cl_wide: 2 }, MAX_LEVEL, X + 30);
  g.useSkill(cs, 3, 0);
  const zn = g.zones.find(z => z.owner === cs.id);
  near(zn.r, 6 * 1.24, 1e-9, 'Sanctuary radius'); near(zn.until - g.time, 5 * 1.3, 1e-9, 'Sanctuary duration');
  done();
  ok('skill mods: cooldown, damage, finisher, radius (hits + visuals), duration (buffs + zones)');
}

// ---------- auras ----------
{
  const lead = mk('swordsman', { sw_switch: 3, sw_pressure: 2, sw_opening: 1, sw_rhythm: 2 }), ally = mk('swordsman', {}, MAX_LEVEL, X + 5), far = mk('swordsman', {}, MAX_LEVEL, X + 30);
  const m1 = wolf(ally.x, ally.z + 2), m2 = wolf(far.x, far.z + 2);
  g.damageMob(m1, ally, 100, {}); g.damageMob(m2, far, 100, {});
  assert.equal(dealt(m1, ally), 106, 'Battle Rhythm: +6% within 12 m'); assert.equal(dealt(m2, far), 100, 'nothing at 30 m');
  done();
  const tank = mk('guardian', { gu_cover: 3 }), a2 = mk('cleric', {}, MAX_LEVEL, X + 4);
  g.damagePlayer(a2, 100, { src: 'test' });
  assert.equal(a2.maxHp - a2.hp, 94, 'Cover: allies take 6% less');
  done();
  const cl = mk('cleric', { cl_presence: 2, cl_inspire: 1, cl_cleanse: 1, cl_swift: 2, cl_unity: 2 }), s = mk('swordsman', {}, MAX_LEVEL, X + 3), o = mk('guardian', {}, MAX_LEVEL, X + 3);
  const w = wolf(s.x, s.z + 2);
  w.staggerUntil = g.time + 2; w.staggerBy = o.id; w.switched = false;
  g.damageMob(w, s, 10, {});
  assert.equal(dealt(w, s), Math.round(10 * SWITCH.first * 1.2), 'Unity: +20% Switch damage for allies nearby');
  done();
  ok('auras: damage, damage taken and Switch damage for everyone within 12 m');
}

// ---------- keystones ----------
{ // Executioner
  const p = mk('swordsman', botAlloc('swordsman', 16));
  assert.ok(p.tal.keys.exec);
  const m = wolf(X, Z + 2, 1000); m.hp = 300; // 30%
  g.damageMob(m, p, 10, {});
  assert.equal(dealt(m, p), Math.round(10 * 1.35), '+35% below 35% health');
  p.cds[1] = g.time + 5;
  g.damageMob(m, p, 1e5, {});
  assert.ok(m.dead); assert.equal(p.cds[1], g.time, 'a kill resets Rush');
  assert.equal(ev('tproc', e => e.k === 'exec').length, 1);
  done();
  ok('keystone Executioner: +35% vs low health, kills reset Rush');
}
{ // Flowing Blade
  const p = mk('swordsman', { sw_feet: 2, sw_roll: 3, sw_rush: 2, sw_riposte: 3, sw_tempo: 3, sw_cyclone: 2, sw_flow: 1 });
  p.cds = [0, g.time + 5, g.time + 5, g.time + 5];
  g.dodge(p, 0);
  near(p.cds[1] - g.time, 4, 1e-9, 'a roll takes 1 s off');
  const m = wolf(); face(p, m);
  advance(1); g.dodge(p, p.face); advance(0.05);
  g.damagePlayer(p, 20, { src: 'wolf bite', mob: m });
  assert.ok(p.cds[1] <= g.time && p.cds[2] <= g.time, 'a perfect dodge resets Rush and Whirl');
  assert.ok(p.cds[3] > g.time, 'not Burst Combo');
  assert.equal(ev('tproc', e => e.k === 'flow').length, 1);
  done();
  ok('keystone Flowing Blade: rolls shave cooldowns, perfect dodges reset Rush and Whirl');
}
{ // Relay Strike
  const p = mk('swordsman', { sw_switch: 3, sw_pressure: 3, sw_opening: 2, sw_breaker: 2, sw_rhythm: 2, sw_shared: 3, sw_relay: 1 });
  const breaker = mk('guardian', {}, MAX_LEVEL, X + 2), farAlly = mk('cleric', {}, MAX_LEVEL, X + 40);
  const m = wolf();
  m.staggerUntil = g.time + 2; m.staggerBy = breaker.id; m.switched = false;
  p.cds[3] = g.time + 10;
  g.damageMob(m, p, 10, {});
  assert.equal(p.cds[3], g.time, 'Burst Combo reset');
  assert.ok(breaker.relay?.until > g.time && !farAlly.relay, 'allies within 12 m get the buff');
  const m2 = wolf(X + 2, Z + 4); clear();
  g.damageMob(m2, breaker, 100, {});
  assert.equal(dealt(m2, breaker), Math.round(100 * 1.15 * 1.06), '+15% (and the Battle Rhythm aura)');
  done();
  ok('keystone Relay Strike: a Switch buffs allies nearby and resets Burst Combo');
}
{ // Shield Riposte + Unbreakable
  const p = mk('guardian', botAlloc('guardian', 16));
  assert.ok(p.tal.keys.unbreak && p.tal.keys.parryCounter);
  const m = wolf(); face(p, m);
  p.hp = Math.round(p.maxHp / 2); const hp0 = p.hp;
  p.guardPress = -99; g.guard(p, true);
  g.damagePlayer(p, 30, { src: 'wolf bite', mob: m });
  assert.equal(ev('parry').length, 1);
  assert.equal(p.hp, hp0 + Math.round(p.maxHp * 0.1), 'a parry heals 10%');
  assert.equal(dealt(m, p), Math.round(p.atk * 2), 'and strikes back for 2x attack');
  assert.ok(p.counterUntil > g.time, 'Shield Riposte opens a counter window');
  done();
  ok('Shield Riposte + keystone Unbreakable: parries heal, strike back and open a counter');
}
{ // Juggernaut
  const p = mk('guardian', { gu_menace: 3, gu_crush: 3, gu_provoke: 2, gu_quake: 2, gu_heavy: 2, gu_monger: 3, gu_jugg: 1 });
  const m = wolf(X, Z + 4);
  g.useSkill(p, 1, 0); // Taunt
  assert.ok(m.posture >= g.postureCap(m) * 0.25 || m.staggerUntil > g.time, 'Taunt fills 25% posture');
  const m2 = wolf(X + 3, Z + 3), o = mk('swordsman', {}, MAX_LEVEL, X + 30);
  m2.threat.set(o.id, 1e6); // fixed on someone else
  g.addPosture(m2, p, 10); const off = m2.posture;
  m2.posture = 0; m2.threat.clear(); m2.threat.set(p.id, 1);
  g.addPosture(m2, p, 10);
  near(m2.posture, off * 1.4, 1e-6, '+40% posture on enemies attacking you');
  done();
  ok('keystone Juggernaut: Taunt fills posture; +40% posture on enemies fixed on you');
}
{ // Rallying Bash
  const p = mk('guardian', { gu_bashing: 3, gu_cover: 3, gu_setup: 2, gu_steadfast: 2, gu_partner: 2, gu_charge: 3, gu_rally: 1 });
  const ally = mk('cleric', {}, MAX_LEVEL, X + 3), m = wolf(X, Z + 2);
  for (let i = 0; i < 3; i++) { g.useSkill(p, 0, 0); if (i < 2) advance(0.8); }
  assert.ok(m.stunUntil > g.time + 0.5, 'the Bash finisher stuns');
  const m2 = wolf(X - 3, Z + 2);
  m2.posture = g.postureCap(m2) - 1; face(p, m2);
  g.damageMob(m2, p, 5, {});
  assert.ok(m2.staggerUntil > g.time, 'broken');
  assert.ok(ally.shield?.hp === Math.round(ally.maxHp * 0.1) && p.shield, 'allies (and you) get a 10% shield');
  done();
  ok('keystone Rallying Bash: the finisher stuns; Breaks shield the allies around');
}
{ // Overflow
  const c = mk('cleric', botAlloc('cleric', 16)), a = mk('guardian', {}, MAX_LEVEL, X + 3);
  a.hp = a.maxHp - 10;
  g.healPlayer(a, 50, c, 'heal');
  assert.equal(a.hp, a.maxHp);
  assert.equal(a.shield.hp, Math.round(50 * (1 + c.tal.stat.heal / 100)) - 10, 'the overheal becomes a shield');
  g.healPlayer(a, 1e5, c, 'heal');
  assert.equal(a.shield.hp, Math.round(a.maxHp * KEYS.overflow.cap), 'capped at 25% health');
  done();
  ok('keystone Overflow: overhealing turns into a shield (capped)');
}
{ // Wrath
  const c = mk('cleric', { cl_zeal: 3, cl_insight: 3, cl_searing: 2, cl_silence: 2, cl_hammer: 2, cl_verdict: 3, cl_wrath: 1 });
  const ms = [3, 7, 12.5].map(d => wolf(X, Z + d));
  g.useSkill(c, 0, 0);
  const d = ms.map(m => dealt(m, c));
  const first = Math.round(c.atk * 1.1 * 1.24);
  assert.equal(d[0], first, 'the first enemy: full damage');
  assert.equal(d[1], Math.round(c.atk * 1.1 * 0.7 * 1.24), 'the rest: 70%');
  assert.ok(d[2] > 0, 'reaches 14 m (Smite alone stops at 10 m)');
  done();
  ok('keystone Wrath: Smite pierces every enemy in a 14 m line');
}
{ // Cleansing Light
  const c = mk('cleric', { cl_presence: 1, cl_inspire: 2, cl_cleanse: 1 }), a = mk('swordsman', {}, MAX_LEVEL, X + 4);
  g.useSkill(c, 2, 0); // Blessing
  assert.ok(a.purifyUntil > g.time && a.dmg.until > g.time);
  const hp = a.hp;
  g.damagePlayer(a, 50, { src: 'mire pool' });
  assert.equal(a.hp, hp, 'purified: ground hazards do nothing');
  near(a.dmg.until - g.time, 8 * 1.24, 1e-6, 'Inspire: Blessing lasts +24%');
  done();
  ok('Cleansing Light: Blessing purifies allies; Inspire lengthens it');
}
{ // Guardian Spirit
  const c = mk('cleric', { cl_presence: 3, cl_inspire: 3, cl_cleanse: 1, cl_swift: 2, cl_unity: 2, cl_guiding: 3, cl_spirit: 1 });
  const a = mk('swordsman', {}, MAX_LEVEL, X + 5);
  a.hp = 10;
  g.damagePlayer(a, 500, { src: 'test' });
  assert.ok(!a.dead && a.hp === Math.round(a.maxHp * 0.3), 'saved at 30%');
  assert.equal(ev('tproc', e => e.k === 'spirit' && e.by === c.id).length, 1);
  g.damagePlayer(a, 5000, { src: 'test' });
  assert.ok(a.dead, 'once every 60 s');
  done();
  ok('keystone Guardian Spirit: a lethal hit on an ally nearby is survived at 30% (60 s cooldown)');
}

// ---------- persistence round trip (needs DATABASE_URL) ----------
async function persistence() {
  if (!process.env.DATABASE_URL) { console.log('  skip - persistence (set DATABASE_URL to run it)'); return; }
  const port = Number(process.env.PORT) || 3593, base = `http://localhost:${port}`;
  const start = () => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), START_LEVEL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; if (/running on/.test(out)) resolve(proc); });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', c => reject(new Error(`server exited ${c}: ${out}`)));
    setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 10000);
  });
  const stop = proc => new Promise(r => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(); });
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) }).then(r => r.json());
  const session = (token, id, onMsg) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', session: token, character: id })));
    ws.on('message', raw => { const msg = JSON.parse(raw); if (onMsg(msg, ws)) resolve(ws); });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });
  let srv = await start();
  const db = await import('../server/db.js');
  try {
    const { token } = await post('/api/guest');
    const name = `Tal${Math.floor(realRandom() * 1e6)}`;
    const { character } = await post('/api/characters', { name, cls: 'swordsman' }, token);
    assert.ok(character?.id, 'character created');
    await db.q('UPDATE characters SET lvl = 6 WHERE id = $1', [character.id]); // 5 points
    const want = ['sw_edge', 'sw_edge', 'sw_edge', 'sw_precision', 'sw_finale'];
    let i = 0;
    const ws = await session(token, character.id, (msg, w) => {
      if (msg.type !== 'talents') return false;
      assert.equal(msg.pts, 5);
      if (spentOf(msg.r) === want.length) return true;
      w.send(JSON.stringify({ type: 'talent', op: 'spend', id: want[i++] }));
      return false;
    });
    await new Promise(r => { ws.on('close', r); ws.close(); });
    await new Promise(r => setTimeout(r, 500)); // the save on disconnect
    const [row] = await db.q('SELECT talents FROM characters WHERE id = $1', [character.id]);
    assert.deepEqual(row.talents, { sw_edge: 3, sw_precision: 1, sw_finale: 1 }, 'saved in characters.talents');
    await stop(srv);
    srv = await start();
    let got = null;
    const ws2 = await session(token, character.id, msg => { if (msg.type === 'talents') { got = msg; return true; } return false; });
    ws2.close();
    assert.deepEqual(got.r, { sw_edge: 3, sw_precision: 1, sw_finale: 1 }, 'loaded after a restart');
    ok('persistence: spent talents survive a reconnect and a restart (guest account, Postgres)');
  } finally { await stop(srv); }
}

await persistence();
Math.random = realRandom;
console.log(`all ${n} checks passed`);
process.exit(0);
