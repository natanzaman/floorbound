// In-process checks for weapon styles (shared/styles.js, server/styles.js), plus a save/load round trip through a real
// server + Postgres when DATABASE_URL is set.
// Usage: node test/styles.js        (DATABASE_URL=... PORT=3583 node test/styles.js for the persistence check)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { SWITCH, PERFECT, POSTURE } from '../shared/data.js';
import { makeItem, SHOP, MERCHANT, BAG_SIZE } from '../shared/items.js';
import { SMITH, RECIPES, RECIPE_BY_ID } from '../shared/crafting.js';
import { STYLES, STYLE_IDS, CLASS_STYLES, styleOf, rollStyle, styleLine } from '../shared/styles.js';

const realRandom = Math.random;
const g = new Game();
g.mobs.clear(); g.boss = null; // an empty field: only the mobs placed here
g.track = () => {};
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
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const ws = { readyState: 1, send() {} };

// A player of a class holding a weapon of the given style, standing at (0, 60) facing north (+z), level 10.
function hero(cls, style) {
  const p = g.addPlayer(ws, `${style}${g.nextId}`, cls);
  p.lvl = 10;
  const it = makeItem('weapon', 1, cls, () => 0.5, undefined, style);
  p.inv.bag.push(it); g.equip(p, it.u);
  p.x = 0; p.z = 60; p.face = 0; p.crit = 0; p.hp = p.maxHp;
  return p;
}
// A tough wolf at distance d in front of the player (angle a off the facing), that never dies or breaks during a test.
function dummy(p, d, a = 0, type = 'wolf') {
  const m = g.addMob(type, p.x + Math.sin(p.face + a) * d, p.z + Math.cos(p.face + a) * d);
  m.x = p.x + Math.sin(p.face + a) * d; m.z = p.z + Math.cos(p.face + a) * d; // (no collision nudging)
  m.hp = m.maxHp = 1e7; m.posture = 0;
  return m;
}
const reset = () => { for (const m of [...g.mobs.values()]) g.mobs.delete(m.id); for (const p of [...g.players.values()]) g.removePlayer(p); g.scheduled = []; clear(); };
// One basic-attack press (waits out the style's cooldown first). Returns the damage each mob took.
function press(p, mobs) {
  advance(Math.max(0, p.cds[0] - g.time) + 0.01);
  const hp = mobs.map(m => m.hp);
  g.useSkill(p, 0, p.face);
  return mobs.map((m, i) => hp[i] - m.hp);
}
Math.random = () => 0.5; // no crits (crit < 0.5), no damage variance
g.time = 10;

// ---------- data, items, drops ----------
{
  assert.equal(STYLE_IDS.length, 9);
  for (const cls of ['swordsman', 'guardian', 'cleric']) {
    assert.equal(CLASS_STYLES[cls].length, 3);
    assert.equal(CLASS_STYLES[cls].filter(id => STYLES[id].def).length, 1);
    for (const id of CLASS_STYLES[cls]) if (!STYLES[id].def) assert.ok(STYLES[id].basic && STYLES[id].passive && STYLES[id].tweak, id);
  }
  const plain = makeItem('weapon', 1, 'swordsman', () => 0.5);
  assert.equal(plain.style, undefined); assert.equal(plain.name, 'Tempered Blade'); // old behaviour unchanged
  assert.equal(styleOf(plain, 'swordsman'), 'sword');
  assert.equal(styleOf(null, 'cleric'), 'staff');
  const names = { dual: ['swordsman', 1, 'Tempered Dual Blades'], rapier: ['swordsman', 2, 'Duskglass Rapier'], mace: ['guardian', 0, 'Iron Mace & Shield'], wand: ['cleric', 0, 'Ash Wand'], tome: ['cleric', 3, 'Dawn Mace & Tome'], spear: ['guardian', 2, 'Bastion Spear & Shield'] };
  for (const [id, [cls, r, name]] of Object.entries(names)) {
    const it = makeItem('weapon', r, cls, () => 0.5, undefined, id);
    assert.equal(it.style, id); assert.equal(it.name, name); assert.equal(it.cls, cls);
  }
  assert.equal(makeItem('weapon', 1, 'guardian', () => 0.5, undefined, 'dual').style, undefined, 'a style of another class is ignored');
  assert.equal(makeItem('armor', 1, null, () => 0.5, undefined, 'roll').style, undefined);
  const counts = {};
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6000; i++) { const s = rollStyle('guardian', rnd); counts[s] = (counts[s] || 0) + 1; }
  assert.ok(counts.shield > counts.mace && counts.shield > counts.spear && counts.mace > 1000 && counts.spear > 1000, JSON.stringify(counts));
  assert.match(styleLine(makeItem('weapon', 1, 'cleric', () => 0.5, undefined, 'wand')), /^Wand: Bolts that hit a Broken enemy/);
  ok(`names, defaults and drop rolls (guardian over 6000 drops: ${JSON.stringify(counts)})`);

  // drops roll a style
  Math.random = realRandom;
  const p = g.addPlayer(ws, 'Looter', 'swordsman');
  const seen = new Set();
  for (let i = 0; i < 60; i++) { p.inv.bag = []; g.dropLoot(p, { type: 'warden', x: 0, z: 0 }); for (const it of p.inv.bag) if (it.slot === 'weapon') seen.add(styleOf(it, 'swordsman')); }
  assert.deepEqual([...seen].sort(), ['dual', 'rapier', 'sword']);
  Math.random = () => 0.5;
  reset();
  ok('loot drops roll all three styles');
}

// ---------- equip, snapshot, wrong class ----------
{
  const p = hero('swordsman', 'dual');
  assert.equal(p.style, 'dual');
  const row = JSON.parse(g.snapshot()).players.find(r => r[0] === p.id);
  assert.equal(row.length, 12); assert.equal(STYLE_IDS[row[11]], 'dual');
  g.unequip(p, 'weapon');
  assert.equal(p.style, 'sword');
  assert.equal(STYLE_IDS[JSON.parse(g.snapshot()).players.find(r => r[0] === p.id)[11]], 'sword');
  const t = hero('guardian', 'spear');
  const wrong = makeItem('weapon', 2, 'swordsman', () => 0.5, undefined, 'rapier'); t.inv.bag.push(wrong);
  g.equip(t, wrong.u);
  assert.equal(t.inv.eq.weapon.style, 'spear', 'wrong-class weapon refused'); assert.equal(t.style, 'spear');
  assert.ok(ev('sys', e => e.to === t.id && /Only a Swordsman/.test(e.text)).length);
  const cl = hero('cleric', 'tome');
  const cross = makeItem('weapon', 1, 'guardian', () => 0.5, undefined, 'mace'); cl.inv.bag.push(cross);
  g.equip(cl, cross.u);
  assert.equal(cl.style, 'tome');
  reset();
  ok('style follows the equipped weapon; snapshot row [11] carries it; wrong-class weapons are refused');
}

// ---------- Swordsman combos ----------
{
  const sw = hero('swordsman', 'sword'), du = hero('swordsman', 'dual'), ra = hero('swordsman', 'rapier');
  du.x = 100; ra.x = -40; // far apart: each attacks its own dummy
  const ms = dummy(sw, 2), md = dummy(du, 2), mr = dummy(ra, 2);
  const swHits = [0, 1, 2].map(() => press(sw, [ms])[0]);
  const duHits = [0, 1, 2, 3].map(() => press(du, [md])[0]);
  advance(0.3); // the 4th press's second strike
  const duTwin = md.maxHp - md.hp - duHits.reduce((a, b) => a + b, 0);
  const raHits = [0, 1, 2].map(() => press(ra, [mr])[0]);
  assert.ok(duHits[0] < swHits[0] && duHits[1] < swHits[1], `dual hits lighter (${duHits} vs ${swHits})`);
  assert.ok(duTwin > 0 && Math.abs(duTwin - duHits[3]) <= 1, 'the 4th press strikes twice');
  assert.equal(ev('fx', e => e.k === 'sty' && e.id === du.id && e.n === 3).length, 2);
  // cooldowns
  advance(2); g.useSkill(du, 0, 0); assert.ok(Math.abs(du.cds[0] - g.time - 0.4) < 1e-9);
  g.useSkill(sw, 0, 0); assert.ok(Math.abs(sw.cds[0] - g.time - 0.55) < 1e-9);
  g.useSkill(ra, 0, 0); assert.ok(Math.abs(ra.cds[0] - g.time - 0.6) < 1e-9);
  // reach: a rapier thrust reaches 5 m (the sword doesn't) and pierces two enemies in a line
  reset();
  const s2 = hero('swordsman', 'sword'), r2 = hero('swordsman', 'rapier'); r2.x = 50;
  const far = dummy(s2, 4.4), farR = dummy(r2, 4.4), nearR = dummy(r2, 1.8), side = dummy(r2, 2.5, 1.2);
  assert.equal(press(s2, [far])[0], 0, 'sword: 4.4 m is out of reach');
  const [a, b, c] = press(r2, [farR, nearR, side]);
  assert.ok(a > 0 && b > 0, 'rapier: pierces both enemies in the line'); assert.equal(c, 0, 'rapier: misses to the side');
  const rc = hero('swordsman', 'rapier'), sc = hero('swordsman', 'sword');
  g.recompute(rc); g.recompute(sc); // (hero() zeroes crit)
  assert.ok(Math.abs(rc.crit - sc.crit - 0.1) < 1e-9, 'rapier +10% crit');
  reset();
  ok(`swordsman: sword ${swHits}, dual ${duHits}+${duTwin} (cd 0.4, 4-hit, double 4th), rapier ${raHits} (5 m line, +10% crit)`);
}

// ---------- Guardian combos ----------
{
  const sh = hero('guardian', 'shield'), ma = hero('guardian', 'mace'), sp = hero('guardian', 'spear');
  ma.x = 40; sp.x = 80;
  const m1 = dummy(sh, 2), m2 = dummy(ma, 2), m3 = dummy(sp, 2);
  const post = (p, m) => { const out = []; for (let i = 0; i < 3; i++) { m.posture = 0; const d = press(p, [m])[0]; out.push([d, Math.round(m.posture)]); } return out; };
  const shP = post(sh, m1), maP = post(ma, m2), spP = post(sp, m3);
  assert.ok(maP[0][1] > shP[0][1] * 1.5, `mace posture per hit (${maP[0][1]} vs ${shP[0][1]})`);
  assert.ok(maP[2][1] > shP[2][1] + g.postureCap(m2) * 0.15, 'mace finisher: big posture chunk');
  advance(2); g.useSkill(ma, 0, 0); assert.ok(Math.abs(ma.cds[0] - g.time - 0.95) < 1e-9);
  reset();
  const s2 = hero('guardian', 'shield'), p2 = hero('guardian', 'spear'); p2.x = 60;
  const far = dummy(s2, 4.6), farS = dummy(p2, 4.6), nearS = dummy(p2, 1.5);
  assert.equal(press(s2, [far])[0], 0, 'sword & shield: 4.6 m is out of reach');
  const [a, b] = press(p2, [farS, nearS]);
  assert.ok(a > 0 && b > 0, 'spear: hits both enemies in the line');
  reset();
  ok(`guardian: shield [dmg,posture] ${JSON.stringify(shP)}, mace ${JSON.stringify(maP)} (cd 0.95), spear ${JSON.stringify(spP)} (5 m line)`);
}

// ---------- Cleric combos ----------
{
  const st = hero('cleric', 'staff'), wa = hero('cleric', 'wand'), to = hero('cleric', 'tome');
  wa.x = 40; to.x = 80;
  const at11s = dummy(st, 11), at11w = dummy(wa, 11), at8t = dummy(to, 8);
  assert.equal(press(st, [at11s])[0], 0, 'staff bolt: 10 m');
  const wDmg = press(wa, [at11w])[0];
  assert.ok(wDmg > 0, 'wand bolt reaches 11 m');
  assert.equal(press(to, [at8t])[0], 0, 'mace & tome: melee only');
  const n1 = dummy(st, 5); const sDmg = press(st, [n1])[0];
  assert.ok(wDmg < sDmg, `wand bolts are weaker (${wDmg} vs ${sDmg})`);
  advance(2); g.useSkill(wa, 0, 0); assert.ok(Math.abs(wa.cds[0] - g.time - 0.5) < 1e-9);
  // tome: melee combo; the 3rd press is a shockwave all around (hits behind you) that interrupts a wind-up
  for (const m of [...g.mobs.values()]) g.mobs.delete(m.id);
  to.combo = 0; to.lastBasic = -9;
  const front = dummy(to, 2), behind = dummy(to, 2, Math.PI);
  const h1 = press(to, [front, behind]); press(to, [front, behind]);
  behind.windupAt = g.time + 0.5;
  const h3 = press(to, [front, behind]);
  assert.ok(h1[0] > 0 && h1[1] === 0, 'tome: arc in front');
  assert.ok(h3[0] > 0 && h3[1] > 0 && behind.windupAt === 0, 'tome: the 3rd blow is a shockwave that interrupts');
  reset();
  ok(`cleric: staff ${sDmg} @10 m, wand ${wDmg} @12 m (cd 0.5), mace & tome melee + shockwave finisher`);
}

// ---------- passives ----------
{
  // Dual Blades: a Switch cuts skill cooldowns by 0.5 s
  const du = hero('swordsman', 'dual'), tank = hero('guardian', 'shield'); tank.x = 3;
  const m = dummy(du, 2);
  m.staggerUntil = g.time + 2; m.staggerBy = tank.id; m.switched = false;
  advance(0.5);
  du.cds = [0, g.time + 5, g.time + 5, g.time + 5];
  g.useSkill(du, 0, du.face);
  assert.equal(ev('switch', e => e.by === du.id).length, 1);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(du.cds[i] - (g.time + 4.5)) < 1e-9, 'cooldowns -0.5 s');
  const sw = hero('swordsman', 'sword'); m.switched = false; m.staggerUntil = g.time + 2;
  sw.cds = [0, g.time + 5, g.time + 5, g.time + 5];
  g.useSkill(sw, 0, sw.face);
  assert.ok(Math.abs(sw.cds[1] - (g.time + 5)) < 1e-9, 'the default sword has no such passive');
  ok('Dual Blades: landing a Switch cuts skill cooldowns by 0.5 s');

  // Rapier: perfect-dodge counters +40%
  const ra = hero('swordsman', 'rapier'); ra.crit = 0; sw.crit = 0;
  const m2 = dummy(ra, 2); m2.staggerUntil = 0;
  ra.counterUntil = g.time + 1; let hp = m2.hp; g.damageMob(m2, ra, 10, {}); const rDmg = hp - m2.hp;
  advance(0.05);
  sw.counterUntil = g.time + 1; hp = m2.hp; g.damageMob(m2, sw, 10, {}); const sDmg = hp - m2.hp;
  assert.equal(sDmg, Math.round(10 * PERFECT.dmg)); assert.equal(rDmg, Math.round(10 * PERFECT.dmg * 1.4));
  ok(`Rapier: perfect-dodge counter hit ${rDmg} vs ${sDmg} for the sword`);

  // Mace & Shield: Breaks last longer
  const ma = hero('guardian', 'mace'), sh = hero('guardian', 'shield');
  const w1 = dummy(ma, 2), w2 = dummy(sh, 2);
  g.addPosture(w1, ma, g.postureCap(w1) + 1, {}); g.addPosture(w2, sh, g.postureCap(w2) + 1, {});
  assert.ok(Math.abs(w1.staggerUntil - g.time - (SWITCH.window + 1.2)) < 1e-9, 'mace break +1.2 s');
  assert.ok(Math.abs(w2.staggerUntil - g.time - SWITCH.window) < 1e-9);
  const boss = g.addMob('warden', 0, 190); boss.hp = 1e7;
  g.addPosture(boss, ma, g.postureCap(boss) + 1, {});
  assert.ok(Math.abs(boss.staggerUntil - g.time - (SWITCH.bossWindow + 0.6)) < 1e-9, 'boss +0.6 s');
  assert.equal(ev('stagger', e => e.id === w1.id)[0].d, SWITCH.window + 1.2);
  g.mobs.delete(boss.id);
  ok('Mace & Shield: Breaks last 1.2 s longer (0.6 s on the boss)');

  // Spear & Shield: +50% threat
  const sp = hero('guardian', 'spear');
  const m3 = dummy(sp, 2);
  g.damageMob(m3, sp, 10, { threat: 2 }); g.damageMob(m3, sh, 10, { threat: 2 });
  assert.equal(m3.threat.get(sp.id), 10 * 2 * 1.5); assert.equal(m3.threat.get(sh.id), 10 * 2);
  ok('Spear & Shield: +50% threat');

  // Mace & Tome: a press that lands heals the most hurt ally in 12 m
  reset();
  const to = hero('cleric', 'tome'), ally = hero('guardian', 'shield'); ally.x = 6; ally.hp = Math.round(ally.maxHp / 2);
  const farAlly = hero('swordsman', 'sword'); farAlly.x = 30; farAlly.hp = 5;
  let ahp = ally.hp;
  press(to, []); // a whiff heals nobody
  assert.equal(ally.hp, ahp);
  const m4 = dummy(to, 2);
  press(to, [m4]);
  assert.equal(ally.hp - ahp, Math.round(ally.maxHp * 0.03 + 2), 'heal on hit');
  assert.equal(farAlly.hp, 5, 'out of range');
  assert.ok(ev('fx', e => e.k === 'sty' && e.ev === 'heal' && e.id === ally.id).length);
  ok(`Mace & Tome: each landed press heals the most hurt ally nearby (+${Math.round(ally.maxHp * 0.03 + 2)})`);

  // Wand: a bolt on an enemy a teammate Broke heals that teammate
  reset();
  const wa = hero('cleric', 'wand'), br = hero('guardian', 'shield'); br.x = 4; br.hp = 50;
  const m5 = dummy(wa, 8);
  m5.staggerUntil = g.time + 2; m5.staggerBy = br.id; m5.switched = false;
  press(wa, [m5]);
  assert.equal(br.hp, 50 + Math.round(br.maxHp * 0.05), 'the breaker is healed');
  assert.ok(ev('fx', e => e.k === 'sty' && e.ev === 'aid' && e.id === br.id).length);
  const st = hero('cleric', 'staff'); st.x = 1; br.hp = 50;
  m5.switched = false; press(st, [m5]);
  assert.equal(br.hp, 50, 'the staff has no such passive');
  ok('Wand: bolts on a Broken enemy heal the ally who Broke it');
  reset();
}

// ---------- skill tweaks ----------
{
  const cnt = (p, sk) => ev('fx', e => e.id === p.id && e.s === sk && e.k === 'arc').length;
  const du = hero('swordsman', 'dual'), sw = hero('swordsman', 'sword');
  g.useSkill(du, 3, 0); g.useSkill(sw, 3, 0); advance(1.5);
  assert.equal(cnt(du, 'burst'), 6); assert.equal(cnt(sw, 'burst'), 4);
  ok('Dual Blades: Burst Combo strikes 6 times (sword: 4)');

  reset();
  const ra = hero('swordsman', 'rapier'), s2 = hero('swordsman', 'sword');
  ra.z = s2.z = 30; s2.x = 0.5;
  const z0 = ra.z;
  g.useSkill(ra, 1, 0); g.useSkill(s2, 1, 0);
  assert.ok(Math.abs(ra.z - z0 - 12) < 0.01 && Math.abs(s2.z - z0 - 8) < 0.01, `rush ${ra.z - z0} vs ${s2.z - z0}`);
  ok('Rapier: Rush lunges 12 m (sword: 8 m)');

  reset();
  const ma = hero('guardian', 'mace'), sh = hero('guardian', 'shield'); sh.x = 40;
  const mA = dummy(ma, 6.3), mB = dummy(sh, 6.3);
  g.useSkill(ma, 3, 0); g.useSkill(sh, 3, 0);
  assert.ok(mA.hp < mA.maxHp && mB.hp === mB.maxHp, 'ground slam radius +20%');
  ok('Mace & Shield: Ground Slam reaches 6 m (default 5 m)');

  reset();
  const sp = hero('guardian', 'spear'), s3 = hero('guardian', 'shield'); s3.x = 40;
  const tA = dummy(sp, 9.8), tB = dummy(s3, 9.8);
  g.useSkill(sp, 1, 0); g.useSkill(s3, 1, 0);
  assert.ok(tA.threat.get(sp.id) >= 100 && !tB.threat.has(s3.id), 'taunt range +30%');
  ok('Spear & Shield: Taunt reaches 10.4 m (default 8 m)');

  reset();
  const wa = hero('cleric', 'wand'), st = hero('cleric', 'staff'), hurt = hero('guardian', 'shield');
  st.x = 0; hurt.x = 0; hurt.z = 60 + 20; hurt.hp = 40;
  wa.hp = wa.maxHp; st.hp = st.maxHp;
  g.useSkill(st, 1, 0);
  assert.equal(hurt.hp, 40, 'staff heal: 15 m');
  g.useSkill(wa, 1, 0);
  assert.ok(hurt.hp > 40, 'wand heal reaches 20 m');
  ok('Wand: Heal reaches 22.5 m (default 15 m)');
  reset();
}

// ---------- merchant, crafting, testing aids ----------
{
  const p = hero('swordsman', 'sword'); p.x = MERCHANT.x; p.z = MERCHANT.z; p.gold = 1000;
  const alt = SHOP.findIndex(s => s.alt);
  g.handle(p, { type: 'buy', i: alt });
  assert.equal(p.inv.bag.at(-1).style, 'dual');
  g.handle(p, { type: 'buy', i: SHOP.findIndex(s => s.kind === 'gear' && s.slot === 'weapon' && !s.alt) });
  assert.equal(p.inv.bag.at(-1).style, undefined);
  ok('merchant: the class default weapon, plus an alternate-style one');

  const c = hero('cleric', 'staff'); c.x = SMITH.x; c.z = SMITH.z + 2.5; c.gold = 1e5;
  c.inv.mats = { tusk: 99, pelt: 99, resin: 99, fang: 99, core: 99, horn: 99, dust: 99, ess: 99, prism: 99 };
  const styled = RECIPES.filter(rc => rc.style);
  assert.ok(['dual', 'rapier', 'mace', 'spear', 'tome', 'wand'].every(s => styled.some(rc => rc.style === s)), 'a recipe per non-default style');
  assert.equal(g.craft(c, 'resinwand'), true);
  assert.equal(c.inv.bag.at(-1).style, 'wand'); assert.equal(c.inv.bag.at(-1).name, 'Resinlight Wand');
  const n0 = c.inv.bag.length;
  assert.equal(g.craft(c, 'twinfang'), false, 'another class\'s style recipe is refused');
  assert.equal(c.inv.bag.length, n0);
  g.equip(c, c.inv.bag.at(-1).u); assert.equal(c.style, 'wand');
  assert.equal(g.refine(c, c.inv.eq.weapon.u), true); assert.equal(c.inv.eq.weapon.style, 'wand'); assert.equal(c.inv.eq.weapon.name, 'Resinlight Wand +1');
  assert.equal(g.reforge(c, makeItem('weapon', 1, 'cleric', () => 0.5, undefined, 'tome').u, 'stats'), false); // (not in the bag)
  const tomeIt = makeItem('weapon', 1, 'cleric', () => 0.5, undefined, 'tome'); c.inv.bag.push(tomeIt);
  assert.equal(g.reforge(c, tomeIt.u, 'stats'), true); assert.equal(tomeIt.style, 'tome');
  ok('crafting: one recipe per style (class-locked), refine/reforge keep the style');

  process.env.START_STYLE = 'rapier';
  const a = g.addPlayer(ws, 'Aid', 'swordsman'), b = g.addPlayer(ws, 'Aid2', 'guardian');
  assert.equal(a.style, 'rapier'); assert.equal(b.style, 'shield');
  delete process.env.START_STYLE; process.env.BOT_STYLES = '1';
  Math.random = realRandom;
  const got = new Set();
  for (let i = 0; i < 30; i++) got.add(g.addPlayer(ws, `B${i}`, 'cleric').style);
  assert.deepEqual([...got].sort(), ['staff', 'tome', 'wand']);
  assert.equal(g.addPlayer(ws, 'Saved', 'cleric', { charId: 1, accountId: 1, lvl: 1, xp: 0, gold: 0, inv: null }).style, 'staff', 'saved characters are left alone');
  delete process.env.BOT_STYLES; Math.random = () => 0.5;
  reset();
  ok('testing aids: START_STYLE=<id> and BOT_STYLES=1');
}

// ---------- persistence round trip (needs DATABASE_URL) ----------
async function persistence() {
  if (!process.env.DATABASE_URL) { console.log('  skip - persistence (set DATABASE_URL to run it)'); return; }
  const port = Number(process.env.PORT) || 3583, base = `http://localhost:${port}`;
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
  // Join; resolve with { inv, style } once the inventory and a snapshot row for this player arrived.
  const session = (token, id) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    let me = 0, inv = null;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', session: token, character: id })));
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.type === 'welcome') me = msg.id;
      if (msg.type === 'inv') inv = msg;
      if (msg.type === 'snap' && inv && me) {
        const row = msg.w.players.find(r => r[0] === me);
        if (row) resolve({ ws, inv, style: STYLE_IDS[row[11]] });
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });
  let srv = await start({ START_STYLE: 'spear', BOT_STYLES: '' });
  try {
    const { token } = await post('/api/guest');
    const name = `Sty${Math.floor(realRandom() * 1e6)}`;
    const { character } = await post('/api/characters', { name, cls: 'guardian' }, token);
    assert.ok(character?.id, 'character created');
    const s1 = await session(token, character.id);
    assert.equal(s1.inv.eq.weapon?.style, 'spear'); assert.equal(s1.style, 'spear');
    await new Promise(r => { s1.ws.on('close', r); s1.ws.close(); });
    await new Promise(r => setTimeout(r, 400)); // the save on disconnect
    await stop(srv);
    srv = await start({ START_STYLE: '', BOT_STYLES: '' }); // no testing aid: everything comes from the database
    const s2 = await session(token, character.id);
    s2.ws.close();
    assert.equal(s2.inv.eq.weapon?.style, 'spear', 'style saved with the weapon');
    assert.equal(s2.inv.eq.weapon.name, s1.inv.eq.weapon.name);
    assert.equal(s2.style, 'spear', 'snapshot style after reload');
    ok('persistence: the equipped weapon\'s style survives a restart (guest account, Postgres)');
  } finally { await stop(srv); }
}

await persistence();
Math.random = realRandom;
console.log(`all ${n} checks passed`);
process.exit(0);
