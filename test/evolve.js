// In-process checks for skill mastery and evolutions (shared/mastery.js, server/mastery.js),
// plus a persistence round-trip through a real server + Postgres when DATABASE_URL is set.
// Usage: node test/evolve.js            (DATABASE_URL=... PORT=3562 node test/evolve.js for the persistence check)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { CLASSES, angleTo } from '../shared/data.js';
import { MASTERY, BRANCHES, SHRINES, masteryLevel, masteryProgress, newMastery, skillName, masteryCd } from '../shared/mastery.js';

const realRandom = Math.random;
Math.random = () => 0.5; // no crits (crit < 0.1 needs random < 0.1), no damage variance

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = (t, f = () => true) => { flush(); return events.filter(e => e.t === t && f(e)); };
const clear = () => { flush(); events = []; };
function advance(dt) { // scheduled callbacks, zones and mastery upkeep (no AI, so mobs stay put)
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

g.mobs.clear(); g.boss = null; // an empty field: only the enemies each check places
const sword = g.addPlayer(null, 'Kael', 'swordsman');
const tank = g.addPlayer(null, 'Brann', 'guardian');
const cleric = g.addPlayer(null, 'Lyra', 'cleric');
const ally = g.addPlayer(null, 'Ally', 'swordsman');
for (const p of [sword, tank, cleric, ally]) { p.lvl = 10; g.recompute(p); p.hp = p.maxHp; }
g.time = 100;

const X = 0, Z = 70; // open ground on the road north of town
function reset() {
  for (const m of g.mobs.values()) g.mobs.delete(m.id);
  g.zones = []; g.scheduled = []; g.weakT = 0; g.bulwarkT = 0;
  for (const p of [sword, tank, cleric, ally]) {
    Object.assign(p, { x: X, z: Z, face: 0, dead: false, cds: [0, 0, 0, 0], dr: { until: 0, v: 0 }, dmg: { until: 0, v: 0 }, cry: { until: 0, v: 0 }, shield: null, bulwark: null, iron: null, renew: null, purifyUntil: 0, iframeUntil: 0, airUntil: 0, guarding: false, counterUntil: 0, counterAt: -1 });
    p.hp = p.maxHp;
  }
  g.time += 30; clear();
}
function wolf(x, z, hp = 5000) {
  const m = g.addMob('wolf', x, z);
  m.hp = m.maxHp = hp; m.sx = m.x; m.sz = m.z;
  return m;
}
const face = (p, m) => { p.face = angleTo(p.x, p.z, m.x, m.z); };
const setM = (p, sk, lvl, br = null) => { p.mastery[sk] = { pts: MASTERY.need[lvl], br }; };
const pts = (p, sk) => p.mastery[sk].pts;
const slotOf = (p, sk) => CLASSES[p.cls].skills.findIndex(s => s.id === sk);
const use = (p, sk) => g.useSkill(p, slotOf(p, sk), p.face);
const hits = (m, by) => ev('hit', e => e.id === m.id && (!by || e.by === by.id));

// ---------- thresholds, helpers ----------
{
  for (let l = 1; l <= MASTERY.max; l++) {
    assert.equal(masteryLevel(MASTERY.need[l]), l);
    if (l > 1) assert.equal(masteryLevel(MASTERY.need[l] - 0.01), l - 1);
  }
  assert.deepEqual(masteryProgress(MASTERY.need[2] + 5), [2, 5, MASTERY.need[3] - MASTERY.need[2]]);
  assert.equal(masteryProgress(1e9)[0], MASTERY.max);
  const fresh = newMastery({ rush: { pts: 999, br: 'B' }, bogus: { pts: 5 } }, 'swordsman');
  assert.deepEqual(Object.keys(fresh), ['rush', 'whirl', 'burst']);
  assert.equal(fresh.rush.br, 'B'); assert.equal(fresh.whirl.pts, 0);
  assert.equal(newMastery({}, 'cleric', 3).heal.pts, MASTERY.need[3], 'MASTERY=3 start level');
  assert.equal(Object.keys(BRANCHES).length, 9);
  for (const b of Object.values(BRANCHES)) assert.ok(b.A.name && b.B.name && b.A.desc && b.B.desc);
  for (const cls of Object.keys(CLASSES)) { // every class has at least one co-op leaning branch
    assert.ok(CLASSES[cls].skills.slice(1).some(s => BRANCHES[s.id].A.coop || BRANCHES[s.id].B.coop), cls);
  }
  ok('mastery levels: thresholds, progress, sanitising, MASTERY start level, 9 skills x 2 branches');
}

// ---------- mastery only from effective use ----------
{
  reset();
  setM(sword, 'rush', 1);
  use(sword, 'rush'); advance(0.5);
  assert.equal(pts(sword, 'rush'), 0, 'a whiffed Rush gives nothing');
  reset();
  const m = wolf(X, Z + 4);
  use(sword, 'rush'); advance(0.1);
  const got = pts(sword, 'rush');
  const dmg = hits(m, sword).reduce((a, e) => a + e.a, 0);
  assert.ok(dmg > 0 && got > 0, 'a Rush that lands gives mastery');
  assert.ok(got >= (dmg / sword.atk) * MASTERY.w.dmg - 1e-6, 'at least the damage it dealt, in attack units');
  // the basic attack never gives mastery
  reset();
  const before = JSON.stringify(sword.mastery);
  wolf(X, Z + 2); g.useSkill(sword, 0, 0); advance(0.1);
  assert.equal(JSON.stringify(sword.mastery), before);
  // overheal doesn't count; real healing does
  reset();
  setM(cleric, 'heal', 1);
  use(cleric, 'heal');
  assert.equal(pts(cleric, 'heal'), 0, 'healing a full-health party gives nothing');
  reset();
  ally.hp = Math.round(ally.maxHp * 0.4);
  use(cleric, 'heal');
  assert.ok(pts(cleric, 'heal') > 0, 'real healing gives mastery');
  // Taunt: damage it prevents
  reset();
  setM(tank, 'taunt', 1);
  use(tank, 'taunt');
  const p0 = pts(tank, 'taunt');
  assert.equal(p0, 0, 'a Taunt with no one around');
  g.damagePlayer(tank, 100, { src: 'wolf bite' });
  assert.ok(pts(tank, 'taunt') > 0, 'Taunt is credited with the damage it prevented');
  // Blessing: the extra damage buffed allies deal
  reset();
  setM(cleric, 'bless', 1);
  use(cleric, 'bless');
  assert.equal(pts(cleric, 'bless'), 0);
  const w = wolf(X, Z + 2);
  g.damageMob(w, ally, 50, {});
  assert.ok(pts(cleric, 'bless') > 0, 'Blessing is credited with the buffed damage');
  ok('mastery only from effective use: whiffs, basic attacks and overheal give nothing; hits, heals, prevented and buffed damage do');
}

// ---------- Breaks and Switches ----------
{
  reset();
  setM(tank, 'gslam', 1); setM(sword, 'burst', 1);
  const m = wolf(X, Z + 2);
  m.posture = g.postureCap(m) * 0.9;
  use(tank, 'gslam');
  assert.ok(m.staggerUntil > g.time && m.staggerSk === 'gslam');
  const afterBreak = pts(tank, 'gslam');
  assert.ok(afterBreak >= MASTERY.brk[0]);
  g.damageMob(m, sword, 10, { sk: 'burst' }); // Kael Switches in with a Burst hit
  assert.equal(ev('switch').length, 1);
  assert.ok(pts(tank, 'gslam') >= afterBreak + MASTERY.setup - 1e-6, 'the Break skill gets Switch set-up credit');
  assert.ok(pts(sword, 'burst') >= MASTERY.sw, 'the Switch hit is credited');
  ok('Breaks, Switch set-ups and Switch hits give mastery to the skills involved');
}

// ---------- level-ups, Mastery 2 and 4 upgrades ----------
{
  reset();
  sword.mastery.whirl = { pts: MASTERY.need[2] - 0.01, br: null };
  wolf(X + 1, Z + 1);
  use(sword, 'whirl');
  const ups = ev('mlvl', e => e.sk === 'whirl');
  assert.ok(ups.length >= 1 && ups[0].lvl >= 2 && ups[0].to === sword.id);
  const sk = CLASSES.swordsman.skills[2];
  sword.cds[2] = 0; use(sword, 'whirl'); // the next cast uses the new level
  assert.ok(Math.abs(sword.cds[2] - g.time - sk.cd * MASTERY.cd2 * (1 - sword.haste)) < 1e-6, 'Mastery 2: -10% cooldown');
  assert.equal(masteryCd(sk, { pts: MASTERY.need[1] }), sk.cd);
  // Mastery 4: +10% damage
  const dmgAt = lvl => {
    reset(); setM(sword, 'whirl', lvl);
    const m = wolf(X + 1, Z + 1); use(sword, 'whirl');
    return hits(m, sword)[0].a;
  };
  const d3 = dmgAt(3), d4 = dmgAt(4);
  assert.ok(Math.abs(d4 / d3 - 1.1) < 0.03, `Mastery 4: +10% damage (${d3} -> ${d4})`);
  // Mastery 4 heals 10% more
  const healAt = lvl => { reset(); setM(cleric, 'heal', lvl); ally.hp = 10; use(cleric, 'heal'); return ally.hp - 10; };
  const h1 = healAt(1), h4 = healAt(4);
  assert.ok(Math.abs(h4 / h1 - 1.1) < 0.03, `Mastery 4: +10% healing (${h1} -> ${h4})`);
  // reaching 3 prompts the evolution
  reset();
  sword.mastery.rush = { pts: MASTERY.need[3] - 0.01, br: null };
  wolf(X, Z + 4); use(sword, 'rush');
  const evo = ev('mlvl', e => e.sk === 'rush' && e.lvl === 3);
  assert.equal(evo.length, 1); assert.equal(evo[0].evo, 1);
  ok('level-ups (mlvl events), Mastery 2 -10% cooldown, Mastery 4 +10% damage and healing, Mastery 3 prompts an evolution');
}

// ---------- choosing and re-picking a branch ----------
{
  reset();
  setM(sword, 'rush', 2);
  g.handle(sword, { type: 'evolve', sk: 'rush', br: 'A' });
  assert.equal(sword.mastery.rush.br, null, 'rejected below Mastery 3');
  setM(sword, 'rush', 3);
  g.handle(sword, { type: 'evolve', sk: 'rush', br: 'C' });
  g.handle(sword, { type: 'evolve', sk: 'slash', br: 'A' });
  g.handle(sword, { type: 'evolve', sk: 'heal', br: 'A' });
  assert.equal(sword.mastery.rush.br, null); assert.equal(sword.mastery.slash, undefined); assert.equal(sword.mastery.heal, undefined);
  g.handle(sword, { type: 'evolve', sk: 'rush', br: 'A' }); // in the field: the first pick works anywhere
  assert.equal(sword.mastery.rush.br, 'A');
  assert.equal(ev('evolve').length, 1);
  assert.equal(skillName(CLASSES.swordsman.skills[1], sword.mastery.rush), 'Phantom Rush');
  g.handle(sword, { type: 'evolve', sk: 'rush', br: 'B' }); // re-pick away from a shrine: refused
  assert.equal(sword.mastery.rush.br, 'A');
  sword.x = SHRINES[0].x + 2; sword.z = SHRINES[0].z + 1; // at the Town of Beginnings' Skill Shrine
  g.handle(sword, { type: 'evolve', sk: 'rush', br: 'B' });
  assert.equal(sword.mastery.rush.br, 'B');
  sword.x = SHRINES[1].x - 1.5; sword.z = SHRINES[1].z; // Mirelight Camp's shrine works too
  g.handle(sword, { type: 'evolve', sk: 'rush', br: 'A' });
  assert.equal(sword.mastery.rush.br, 'A');
  sword.x = 0; sword.z = 5; // in town but not at the shrine
  g.handle(sword, { type: 'evolve', sk: 'rush', br: 'B' });
  assert.equal(sword.mastery.rush.br, 'A');
  ok('branch choice: refused before Mastery 3, first pick anywhere, re-pick only at a Skill Shrine (both towns)');
}

// ---------- the 18 evolutions ----------
const evolve = (p, sk, br) => setM(p, sk, 3, br);
const evoFx = name => ev('fx', e => e.k === 'evo' && e.ev === name);

{ // Phantom Rush: an afterimage strikes the path again 0.4 s later
  reset(); evolve(sword, 'rush', 'A');
  const m = wolf(X, Z + 4);
  use(sword, 'rush');
  assert.equal(hits(m, sword).length, 1);
  assert.ok(sword.z > m.z, 'dashes through');
  advance(0.3); assert.equal(hits(m, sword).length, 1);
  advance(0.2); assert.equal(hits(m, sword).length, 2, 'afterimage hit');
  assert.equal(evoFx('phantom2').length, 1);
  ok('Phantom Rush: passes through, afterimage strikes again ~0.4 s later');
}
{ // Shoulder Charge: stops on the first enemy, big posture
  reset(); evolve(sword, 'rush', 'B');
  const a = wolf(X, Z + 4), b = wolf(X, Z + 7);
  use(sword, 'rush');
  assert.equal(hits(a, sword).length, 1); assert.equal(hits(b, sword).length, 0, 'only the first enemy');
  assert.ok(sword.z < a.z, 'stops in front of it');
  assert.ok(a.posture >= g.postureCap(a) * 0.4 || a.staggerUntil > g.time, 'heavy posture damage');
  reset(); evolve(sword, 'rush', 'B');
  use(sword, 'rush'); assert.ok(sword.z > Z + 7, 'no enemy: the full dash');
  ok('Shoulder Charge: stops on the first enemy with heavy posture damage');
}
{ // Vortex: pulls enemies in
  reset(); evolve(sword, 'whirl', 'A');
  const m = wolf(X + 6, Z), far = wolf(X + 20, Z);
  const d0 = Math.hypot(m.x - sword.x, m.z - sword.z);
  use(sword, 'whirl');
  const d1 = Math.hypot(m.x - sword.x, m.z - sword.z);
  assert.ok(d1 < d0 - 2 && d1 < 3, `pulled in (${d0.toFixed(1)} -> ${d1.toFixed(1)})`);
  assert.equal(far.x, X + 20, 'out of reach: not pulled');
  advance(0.3); assert.equal(hits(m, sword).length, 1, 'then the spin hits');
  ok('Vortex: moves enemies toward you, then spins');
}
{ // Blade Ring: keeps hitting where you are as you move
  reset(); evolve(sword, 'whirl', 'B');
  const a = wolf(X + 2, Z), b = wolf(X + 30, Z);
  use(sword, 'whirl');
  assert.equal(hits(a, sword).length, 1); assert.equal(hits(b, sword).length, 0);
  sword.x = X + 29; // keep moving
  advance(0.55);
  assert.equal(hits(b, sword).length, 1, 'the ring moved with you');
  advance(1.1);
  assert.equal(evoFx('bladering').length, 4);
  ok('Blade Ring: 4 ticks over 1.5 s that follow you as you move');
}
{ // Starburst: 6 hits
  reset(); evolve(sword, 'burst', 'A');
  const m = wolf(X, Z + 2);
  use(sword, 'burst'); advance(1);
  assert.equal(hits(m, sword).length, 6);
  ok('Starburst: 6 hits');
}
{ // Finisher: 2 hits; instantly breaks an enemy above 50% health
  reset(); evolve(sword, 'burst', 'B');
  const m = wolf(X, Z + 2);
  use(sword, 'burst'); advance(0.5);
  assert.equal(hits(m, sword).length, 2);
  assert.ok(m.staggerUntil > g.time && m.staggerBy === sword.id, 'BROKEN');
  reset(); evolve(sword, 'burst', 'B');
  const low = wolf(X, Z + 2); low.hp = low.maxHp * 0.3;
  use(sword, 'burst'); advance(0.5);
  assert.ok(!(low.staggerUntil > g.time) || low.posture === 0, 'below 50%: no instant fill');
  ok('Finisher: 2 hits, instant Break above 50% health');
}
{ // Challenge: one enemy deals 30% less to everyone but the Guardian
  reset(); evolve(tank, 'taunt', 'A');
  const m = wolf(X, Z + 4), other = wolf(X + 5, Z - 3);
  use(tank, 'taunt');
  assert.ok(m.weakUntil > g.time && m.weakBy === tank.id);
  assert.ok(!other.threat.has(tank.id), 'single target');
  const hp0 = cleric.hp;
  g.damagePlayer(cleric, 100, { src: 'wolf bite', mob: m });
  assert.equal(hp0 - cleric.hp, 70, '30% less to an ally');
  const hp1 = tank.hp;
  g.damagePlayer(tank, 100, { src: 'wolf bite', mob: m });
  assert.equal(hp1 - tank.hp, 70, 'the Guardian only gets the 30% Taunt reduction');
  assert.ok(pts(tank, 'taunt') > MASTERY.need[3]);
  reset(); evolve(tank, 'taunt', 'A');
  use(tank, 'taunt'); assert.equal(tank.cds[1], 0, 'no enemy in reach: no cooldown spent');
  ok('Challenge: single target, it deals 30% less to everyone else');
}
{ // War Cry: wider pull + party damage buff
  reset(); evolve(tank, 'taunt', 'B');
  const m = wolf(X + 10, Z);
  use(tank, 'taunt');
  assert.ok(m.threat.get(tank.id) >= 100, 'taunted at 10 m (base Taunt reaches 8)');
  assert.ok(m.x < X + 8.5, 'dragged in');
  assert.ok(ally.cry.until > g.time);
  assert.ok(Math.abs(g.dmgMult(ally) - 1.1) < 1e-9);
  ok('War Cry: taunts and drags enemies in at 11 m, +10% party damage');
}
{ // Bulwark: front blocked for the Guardian and allies behind
  reset(); evolve(tank, 'wall', 'A');
  const m = wolf(X, Z + 4);
  face(tank, m);
  cleric.x = X; cleric.z = Z - 2; // behind the Guardian
  use(tank, 'wall');
  let hp = cleric.hp; g.damagePlayer(cleric, 100, { src: 'wolf bite', mob: m }); assert.equal(hp - cleric.hp, 40, 'ally behind: -60%');
  hp = tank.hp; g.damagePlayer(tank, 100, { src: 'wolf bite', mob: m }); assert.equal(hp - tank.hp, 20, 'Guardian: -80% from the front');
  const back = wolf(X, Z - 6);
  hp = tank.hp; g.damagePlayer(tank, 100, { src: 'wolf bite', mob: back }); assert.equal(hp - tank.hp, 100, 'not from behind');
  tank.z += 2; advance(0.1);
  assert.equal(tank.bulwark, null, 'moving ends it');
  hp = cleric.hp; g.damagePlayer(cleric, 100, { src: 'wolf bite', mob: m }); assert.equal(hp - cleric.hp, 100);
  ok('Bulwark: stand still to block the front for you and allies behind; moving ends it');
}
{ // Iron Skin: reflects
  reset(); evolve(tank, 'wall', 'B');
  const m = wolf(X, Z + 2);
  use(tank, 'wall');
  const mhp = m.hp, hp = tank.hp;
  g.damagePlayer(tank, 100, { src: 'wolf bite', mob: m });
  assert.equal(hp - tank.hp, 65, '35% less');
  assert.ok(m.hp < mhp, 'reflected damage');
  ok('Iron Skin: 35% less damage and reflects hits back');
}
{ // Quake: bigger area, launches
  reset(); evolve(tank, 'gslam', 'A');
  const m = wolf(X + 6.5, Z);
  use(tank, 'gslam');
  assert.equal(hits(m, tank).length, 1, 'hits at 6.5 m (base Ground Slam reaches 5)');
  assert.ok(m.launchUntil > g.time);
  const snap = JSON.parse(g.snapshot()); g.events = [];
  assert.ok(snap.mobs.find(r => r[0] === m.id)[7] & 128, 'snapshot launched flag');
  ok('Quake: 7 m slam that launches enemies');
}
{ // Seismic Line: hits along a line forward
  reset(); evolve(tank, 'gslam', 'B');
  const ahead = wolf(X, Z + 10), behind = wolf(X, Z - 3), side = wolf(X + 6, Z + 5);
  use(tank, 'gslam'); advance(0.5);
  assert.equal(hits(ahead, tank).length, 1, '10 m ahead');
  assert.equal(hits(behind, tank).length, 0); assert.equal(hits(side, tank).length, 0);
  assert.equal(evoFx('seismic').length, 4);
  ok('Seismic Line: a shockwave that hits along a line 12 m forward');
}
{ // Renew: heal over time on two allies
  reset(); evolve(cleric, 'heal', 'A');
  ally.hp = 20; sword.hp = 30; tank.hp = tank.maxHp;
  use(cleric, 'heal');
  const a1 = ally.hp, s1 = sword.hp;
  assert.ok(a1 > 20 && s1 > 30, 'two allies');
  assert.ok(ally.renew && sword.renew && !tank.renew);
  advance(3.05);
  assert.ok(ally.hp > a1 && sword.hp > s1, 'keeps healing');
  advance(3);
  assert.equal(ally.renew, null);
  ok('Renew: heals two allies over 6 s');
}
{ // Miracle: big heal + purify
  reset(); evolve(cleric, 'heal', 'B');
  ally.hp = 10;
  use(cleric, 'heal');
  assert.ok(ally.hp > ally.maxHp * 0.6);
  const hp = ally.hp;
  g.damagePlayer(ally, 40, { src: 'mire pool' }); assert.equal(ally.hp, hp, 'purified');
  g.damagePlayer(ally, 40, { src: 'wolf bite' }); assert.ok(ally.hp < hp, 'not against attacks');
  const sk = CLASSES.cleric.skills[1];
  assert.ok(Math.abs(cleric.cds[1] - g.time - sk.cd * MASTERY.cd2 * BRANCHES.heal.B.cd * (1 - cleric.haste)) < 1e-6, 'longer cooldown');
  ok('Miracle: big heal, purify, longer cooldown');
}
{ // Zeal: +damage and faster cooldowns
  reset(); evolve(cleric, 'bless', 'A');
  ally.cds = [0, g.time + 8, g.time + 4, 0];
  use(cleric, 'bless');
  assert.ok(Math.abs(ally.cds[1] - g.time - 6) < 1e-6, 'running cooldowns cut by 25%');
  assert.ok(ally.dmg.zeal && Math.abs(g.dmgMult(ally) - 1.15) < 1e-9);
  ally.cds[2] = 0; g.useSkill(ally, 2, 0);
  const sk = CLASSES.swordsman.skills[2];
  assert.ok(Math.abs(ally.cds[2] - g.time - sk.cd * 0.75) < 1e-6, 'new cooldowns 25% faster');
  ok('Zeal: +15% damage and 25% faster cooldowns');
}
{ // Aegis: a damage shield
  reset(); evolve(cleric, 'bless', 'B');
  use(cleric, 'bless');
  assert.ok(ally.shield && ally.shield.hp > 0);
  assert.equal(ally.dmg.until <= g.time, true, 'no damage buff');
  const hp = ally.hp;
  g.damagePlayer(ally, 20, { src: 'wolf bite' });
  assert.equal(ally.hp, hp, 'absorbed');
  assert.ok(ev('absorb').length >= 1);
  assert.ok(pts(cleric, 'bless') > MASTERY.need[3], 'absorbed damage gives mastery');
  ok('Aegis: shields that absorb damage');
}
{ // Haven: allies inside take less
  reset(); evolve(cleric, 'sanct', 'A');
  use(cleric, 'sanct');
  const hp = ally.hp;
  g.damagePlayer(ally, 100, { src: 'wolf bite' });
  assert.equal(hp - ally.hp, 75);
  ally.x += 10; const hp2 = ally.hp;
  g.damagePlayer(ally, 100, { src: 'wolf bite' });
  assert.equal(hp2 - ally.hp, 100, 'outside: full damage');
  ok('Haven: allies inside take 25% less damage');
}
{ // Consecrate: burns and fills posture, no healing
  reset(); evolve(cleric, 'sanct', 'B');
  const m = wolf(X + 2, Z, 110); // a normal wolf (posture scales with max health)
  ally.hp = 50;
  use(cleric, 'sanct'); advance(4);
  assert.ok(hits(m, cleric).length >= 6, 'burns');
  assert.ok(ev('stagger', e => e.id === m.id && e.by === cleric.id).length >= 1, 'fills posture to a Break');
  assert.equal(ally.hp, 50, 'no healing');
  ok('Consecrate: burns enemies inside and Breaks them; no healing');
}
{ // every branch runs without throwing, with a distinct visual
  const seen = new Set();
  for (const p of [sword, tank, cleric]) {
    for (const s of CLASSES[p.cls].skills.slice(1)) {
      for (const br of ['A', 'B']) {
        reset(); evolve(p, s.id, br);
        wolf(X, Z + 3); wolf(X + 2, Z + 6); ally.hp = 40;
        p.face = 0;
        assert.doesNotThrow(() => { use(p, s.id); advance(2); });
        const fxs = ev('fx', e => e.k === 'evo').map(e => e.ev);
        assert.ok(fxs.includes(BRANCHES[s.id][br].id), `${s.id}/${br} emits its visual`);
        seen.add(BRANCHES[s.id][br].id);
      }
    }
  }
  assert.equal(seen.size, 18);
  ok('all 18 evolutions run without throwing and emit their own visual');
}

// ---------- persistence round-trip (needs DATABASE_URL) ----------
async function persistence() {
  if (!process.env.DATABASE_URL) { console.log('  skip - persistence (set DATABASE_URL to run it)'); return; }
  const port = Number(process.env.PORT) || 3562, base = `http://localhost:${port}`;
  const start = env => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  let srv = await start({ MASTERY: '3' });
  try {
    const { token } = await post('/api/guest');
    const name = `Evo${Math.floor(realRandom() * 1e6)}`;
    const { character } = await post('/api/characters', { name, cls: 'guardian' }, token);
    assert.ok(character?.id, 'character created');
    let first = null;
    const ws = await session(token, character.id, (msg, ws) => {
      if (msg.type === 'mastery' && !first) { first = msg.m; ws.send(JSON.stringify({ type: 'evolve', sk: 'wall', br: 'B' })); }
      return msg.type === 'mastery' && msg.m.wall?.br === 'B';
    });
    assert.equal(first.wall.pts, MASTERY.need[3]);
    await new Promise(r => { ws.on('close', r); ws.close(); });
    await new Promise(r => setTimeout(r, 400)); // the save on disconnect
    await stop(srv);
    srv = await start({ MASTERY: '' }); // no testing aid this time: everything comes from the database
    let got = null;
    const ws2 = await session(token, character.id, msg => { if (msg.type === 'mastery') { got = msg.m; return true; } return false; });
    ws2.close();
    assert.equal(got.wall.br, 'B', 'branch saved');
    assert.equal(got.wall.pts, MASTERY.need[3], 'mastery points saved');
    assert.equal(got.taunt.pts, MASTERY.need[3]);
    ok('persistence: mastery points and the chosen branch survive a restart (guest account, Postgres)');
  } finally { await stop(srv); }
}

await persistence();
Math.random = realRandom;
console.log(`all ${n} checks passed`);
process.exit(0);
