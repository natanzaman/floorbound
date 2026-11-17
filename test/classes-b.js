// Lancer and Bard: in-process checks of every skill and evolution (server/classes-b.js), mastery credit, and a
// save/load round trip through a real server + Postgres when DATABASE_URL is set.
// Usage: node test/classes-b.js                      (DATABASE_URL=... PORT=3612 node test/classes-b.js for persistence)
//        node test/classes-b.js farm [url] [secs]    (a Lancer and a Bard bot farm the field; run the server with START_LEVEL=5)
//        node test/classes-b.js warden [url] [secs]  (Guardian + Lancer + Bard + Cleric vs the Warden; START_LEVEL=10 SPAWN_AT=0,150)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { CLASSES, CLASS_IDS, OBSTACLES, POSTURE, angleTo, postureMax, resolveCollision } from '../shared/data.js';
import { MASTERY, BRANCHES } from '../shared/mastery.js';
import { makeItem } from '../shared/items.js';
import { RECIPE_BY_ID, recipeName } from '../shared/crafting.js';
import { LANCE } from '../shared/classes/lancer.js';
import { SONG } from '../shared/classes/bard.js';
import { startTeam } from '../shared/teambots.js';

const mode = process.argv[2];
if (mode === 'farm' || mode === 'warden') await botRun(mode);

const { Game } = await import('../server/game.js');
const realRandom = Math.random;
Math.random = () => 0.5; // no crits, no damage variance

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = (t, f = () => true) => { flush(); return events.filter(e => e.t === t && f(e)); };
const cb = (name, f = () => true) => ev('fx', e => e.k === 'cb' && e.ev === name && f(e));
const clear = () => { flush(); events = []; };
function advance(dt) { // scheduled callbacks + this module's per-tick upkeep (no AI, so mobs stay put)
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    const step = Math.min(0.05, end - g.time);
    g.time += step;
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateMastery();
    g.updateProjectiles(step); // runs updateClassesB (sonic bolts, songs, buff expiry)
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

g.mobs.clear(); g.boss = null; // an empty field: only the enemies each check places
const lancer = g.addPlayer(null, 'Rook', 'lancer');
const bard = g.addPlayer(null, 'Wren', 'bard');
const ally = g.addPlayer(null, 'Ally', 'swordsman');
const far = g.addPlayer(null, 'Far', 'guardian');
const all = [lancer, bard, ally, far];
for (const p of all) { p.lvl = 10; g.recompute(p); p.hp = p.maxHp; }
g.time = 100;

const X = 0, Z = 70; // open ground on the road north of town
function reset() {
  for (const m of g.mobs.values()) g.mobs.delete(m.id);
  g.zones = []; g.scheduled = []; g.cbShots = [];
  for (const p of all) {
    Object.assign(p, { x: X, z: Z, face: 0, dead: false, cds: [0, 0, 0, 0], combo: 0, lastBasic: -9, dr: { until: 0, v: 0 }, dmg: { until: 0, v: 0 }, cry: { until: 0, v: 0 }, shield: null, anthem: null, march: null, song: null, cresc: null, iframeUntil: 0, airFrom: 0, airUntil: 0 });
    p.hp = p.maxHp;
    for (const k of Object.keys(p.mastery)) p.mastery[k] = { pts: 0, br: null };
  }
  far.x = X + 20; ally.x = X + 4;
  g.time += 30; clear();
}
function wolf(x, z, hp = 5000) {
  const m = g.addMob('wolf', x, z);
  m.hp = m.maxHp = hp; m.sx = m.x; m.sz = m.z;
  return m;
}
const face = (p, m) => { p.face = angleTo(p.x, p.z, m.x, m.z); };
const slotOf = (p, sk) => CLASSES[p.cls].skills.findIndex(s => s.id === sk);
const use = (p, sk) => { p.cds[slotOf(p, sk)] = 0; g.useSkill(p, slotOf(p, sk), p.face); };
const hits = (m, p) => ev('hit', e => e.id === m.id && (!p || e.by === p.id));
const dealt = (m, p) => hits(m, p).reduce((s, e) => s + e.a, 0);
const evolve = (p, sk, br) => { p.mastery[sk] = { pts: MASTERY.need[3], br }; };

// ---------- data ----------
{
  assert.deepEqual(CLASS_IDS.slice(0, 3), ['swordsman', 'guardian', 'cleric'], 'existing class indices unchanged');
  assert.ok(CLASS_IDS.includes('lancer') && CLASS_IDS.includes('bard'));
  assert.equal(CLASSES.lancer.role, 'Damage'); assert.equal(CLASSES.bard.role, 'Support');
  for (const c of ['lancer', 'bard']) {
    assert.equal(CLASSES[c].skills.length, 4);
    for (const s of CLASSES[c].skills.slice(1)) assert.ok(BRANCHES[s.id]?.A && BRANCHES[s.id]?.B, `${s.id} has two branches`);
    assert.ok(Object.keys(lancer.mastery).length === 3 && Object.keys(bard.mastery).length === 3);
    for (let r = 0; r < 4; r++) assert.equal(makeItem('weapon', r, c).cls, c);
  }
  assert.equal(makeItem('weapon', 0, 'lancer').name, 'Ash Spear');
  assert.equal(recipeName(RECIPE_BY_ID.tuskbreaker, 'lancer'), 'Tuskbreaker Spear');
  assert.equal(recipeName(RECIPE_BY_ID.wardenforged, 'bard'), 'Warden-Forged Lyre');
  ok('Lancer (Damage) and Bard (Support) appended to CLASS_IDS; weapons and crafted weapons resolve; 2 branches per skill');
}

// ---------- Lancer ----------
{ // Thrust: a long narrow line, +30% at the tip
  reset();
  const near = wolf(X, Z + 2.0), tip = wolf(X - 0.3, Z + 3.9 + 0.8), side = wolf(X + 3, Z + 2.5), out = wolf(X, Z + 6.5);
  lancer.face = 0;
  use(lancer, 'lthrust');
  assert.equal(hits(side).length, 0, 'narrow: an enemy beside the line is missed');
  assert.equal(hits(out).length, 0, 'out of reach');
  const base = lancer.atk * LANCE.mult;
  assert.equal(dealt(near), Math.round(base));
  assert.equal(dealt(tip), Math.round(base * LANCE.sweetMult), 'tip of the spear: +30%');
  assert.deepEqual(cb('thrust')[0].tip, [tip.id]);
  clear(); g.time += 0.3; use(lancer, 'lthrust'); clear(); g.time += 0.3; use(lancer, 'lthrust'); // third: the finisher reaches further
  assert.equal(hits(out).length, 0);
  const fin = wolf(X, Z + 5.2 + 0.8); clear(); g.time += 2; lancer.combo = 1; lancer.lastBasic = g.time - 0.2;
  use(lancer, 'lthrust');
  assert.equal(cb('thrust')[0].n, 2); assert.equal(hits(fin).length, 1, 'the finisher reaches 5.4 m');
  ok('Thrust: 4.6 m narrow line, misses beside it, +30% near the tip; the third thrust reaches 5.4 m');
}
{ // Lance Charge: dash along a line, hit everything in it, stop short of trees and walls
  reset();
  const a = wolf(X, Z + 3), b = wolf(X + 0.8, Z + 7), off = wolf(X + 5, Z + 5);
  lancer.face = 0;
  use(lancer, 'lcharge');
  assert.ok(hits(a, lancer).length && hits(b, lancer).length, 'everything on the path');
  assert.equal(hits(off).length, 0);
  assert.ok(Math.abs(lancer.z - (Z + LANCE.charge.len)) < 0.01, `9 m dash (got ${lancer.z - Z})`);
  assert.ok(lancer.mastery.lcharge.pts > 0, 'mastery from the damage');
  // a tree in the way
  const tree = OBSTACLES.find(o => o.kind === 'tree' && o.z > 50 && o.z < 140 && Math.abs(o.x) > 10 && Math.abs(o.x) < 60
    && resolveCollision(o.x, o.z - o.r - 3.2)[1] === o.z - o.r - 3.2 && !OBSTACLES.some(q => q !== o && Math.hypot(q.x - o.x, q.z - (o.z - 5)) < q.r + 4));
  reset();
  Object.assign(lancer, { x: tree.x, z: tree.z - tree.r - 3.2, face: 0 });
  use(lancer, 'lcharge');
  assert.ok(lancer.z < tree.z - tree.r, `stopped short of the tree (z ${lancer.z.toFixed(2)}, tree ${tree.z.toFixed(2)} r ${tree.r})`);
  assert.ok(lancer.z > tree.z - tree.r - 3.2 + 1.5, 'but still moved up to it');
  // the Warden's chamber wall
  reset();
  Object.assign(lancer, { x: 18, z: 190, face: Math.PI / 2 });
  use(lancer, 'lcharge');
  assert.ok(lancer.x < 26 && lancer.x > 23, `stopped at the wall (x ${lancer.x})`);
  ok('Lance Charge: 9 m along a line hitting everything in it; stops short of trees and the chamber wall');
}
{ // Sweep: everything around is tripped (stagger) and takes posture
  reset();
  const ms = [wolf(X + 3, Z), wolf(X - 2, Z - 2), wolf(X, Z + 3.5)], away = wolf(X, Z + 9);
  use(lancer, 'lsweep');
  for (const m of ms) {
    assert.ok(m.stunUntil >= g.time + LANCE.sweep.stun - 1e-6, 'tripped');
    assert.ok(m.posture > LANCE.sweep.frac[0] * postureMax(m.def, m.maxHp), 'posture: heavy + chunk');
  }
  assert.equal(hits(away).length, 0);
  assert.ok(lancer.mastery.lsweep.pts > 0);
  ok('Sweep: every enemy within 4.5 m staggered and takes heavy posture; none beyond');
}
{ // Sky Lance: a marked leap, airborne, lands at the target, Break posture, sets up a Switch
  reset();
  const m = wolf(X, Z + 8, 400);
  const other = wolf(X + 2, Z + 8.5, 400);
  m.posture = postureMax(m.def, m.maxHp) * 0.3;
  face(lancer, m);
  use(lancer, 'skylance');
  const mark = cb('skymark')[0];
  assert.ok(mark && Math.abs(mark.z2 - (m.z - 0.8 - 0.6)) < 0.6, 'the landing spot is marked for allies');
  assert.ok(lancer.airUntil > g.time && lancer.airFrom <= g.time, 'airborne');
  advance(0.5);
  assert.equal(hits(m).length, 0, 'still in the air');
  assert.equal(lancer.z, Z, 'not landed yet');
  advance(0.3);
  assert.ok(Math.abs(lancer.z - mark.z2) < 0.01, 'landed on the mark');
  assert.ok(ev('stagger', e => e.id === m.id && e.by === lancer.id).length, 'BROKEN');
  assert.ok(hits(other, lancer).length, 'area hit');
  assert.ok(lancer.mastery.skylance.pts > MASTERY.brk[0], 'mastery: damage, posture and the Break');
  g.damageMob(m, ally, 10);
  assert.ok(ev('switch', e => e.id === m.id && e.by === ally.id && e.from === lancer.id).length, 'a teammate Switches in');
  ok('Sky Lance: marked leap, airborne for 0.7 s, crashes down to BREAK, a teammate Switches');
}
{ // the airborne flight dodges a ground slam
  reset();
  const m = wolf(X, Z + 8);
  face(lancer, m); use(lancer, 'skylance'); advance(0.2);
  const hp = lancer.hp;
  g.damagePlayer(lancer, 50, { ground: true, src: 'warden slam' });
  assert.equal(lancer.hp, hp);
  assert.ok(ev('evade', e => e.id === lancer.id && e.k === 'jump').length);
  ok('Sky Lance: ground attacks miss the Lancer in the air');
}

// ---------- Bard ----------
{ // Sonic bolt: a projectile; Discord stacks (max 5) raise posture damage
  reset();
  const m = wolf(X, Z + 6), m2 = wolf(X + 3, Z + 30);
  bard.face = 0;
  use(bard, 'sonic');
  assert.equal(g.cbShots.length, 1);
  assert.equal(hits(m).length, 0, 'travels, not instant');
  advance(0.3);
  assert.equal(hits(m, bard).length, 1);
  assert.equal(g.discordOf(m), 1);
  assert.equal(g.cbShots.length, 0, 'spent');
  assert.ok(cb('sonicEnd', e => e.m === m.id).length);
  for (let i = 0; i < 7; i++) { use(bard, 'sonic'); advance(0.3); }
  assert.equal(g.discordOf(m), SONG.discord.max, 'capped at 5');
  // range: a bolt fizzles after 11 m
  reset();
  const farM = wolf(X, Z + 14);
  use(bard, 'sonic'); advance(1);
  assert.equal(hits(farM).length, 0, 'out of range');
  // Discord: +10% posture per stack, on damage and flat chunks alike
  const a = wolf(X - 5, Z), b = wolf(X + 5, Z);
  g.addDiscord(b, bard, 5);
  g.addPosture(a, ally, 20); g.addPosture(b, ally, 20);
  assert.equal(b.posture, a.posture * 1.5);
  a.posture = b.posture = 0;
  g.addPosture(a, ally, 0, { interrupt: true }); g.addPosture(b, ally, 0, { interrupt: true });
  assert.ok(Math.abs(b.posture - a.posture * 1.5) < 1e-6, 'chunks too');
  advance(SONG.discord.dur + 0.1);
  assert.equal(g.discordOf(b), 0, 'stacks wear off');
  void m2;
  ok('Sonic Bolt: a travelling bolt (11 m) that adds Discord (max 5, 6 s): +10% posture damage per stack');
}
{ // Anthem: allies in range move and attack faster; out of range nothing; follows the bard; ends after 8 s
  reset();
  use(bard, 'anthem');
  assert.ok(ally.anthem && g.time < ally.anthem.until, 'ally in range');
  assert.ok(bard.anthem, 'the bard too');
  assert.equal(far.anthem, null, 'out of range: nothing');
  assert.ok(ev('buff', e => e.k === 'anthem' && e.id === ally.id).length);
  const slash = CLASSES.swordsman.skills[0], rush = CLASSES.swordsman.skills[1];
  assert.ok(Math.abs(g.skillCd(ally, slash, 0) - slash.cd * 0.8) < 1e-9, 'basic attacks 20% faster');
  assert.ok(Math.abs(g.skillCd(ally, rush, 1) - rush.cd * 0.85) < 1e-9, 'skills recharge 15% faster');
  assert.equal(g.skillCd(far, CLASSES.guardian.skills[0], 0), CLASSES.guardian.skills[0].cd);
  const m = wolf(X + 4, Z + 2);
  g.damageMob(m, ally, 100);
  assert.ok(bard.mastery.anthem.pts > 0, 'mastery from the buffed damage');
  advance(2);
  far.x = X + 6; advance(0.6); // walks into the aura
  assert.ok(far.anthem, 'joins the song in range');
  ally.x = X + 30; advance(1.2);
  assert.equal(ally.anthem, null, 'left the aura: buff gone');
  assert.ok(ev('buff', e => e.k === 'anthem' && e.id === ally.id && e.end).length);
  advance(5);
  assert.equal(bard.song, null, 'the song ends after 8 s');
  advance(1.1);
  assert.equal(far.anthem, null);
  ok('Anthem: 8 s aura, allies within 12 m (and the bard) attack 20% faster / skills 15% faster; leaving the aura ends it');
}
{ // Dissonance: slows and interrupts wind-ups in a cone
  reset();
  const winding = wolf(X, Z + 4), idle = wolf(X + 1.5, Z + 5), behind = wolf(X, Z - 4);
  winding.windupAt = g.time + 0.3; behind.windupAt = g.time + 0.3;
  bard.face = 0;
  use(bard, 'dissonance');
  assert.equal(winding.windupAt, 0, 'interrupted');
  assert.ok(cb('interrupt', e => e.m === winding.id).length);
  assert.ok(winding.posture > POSTURE.smite[0] * postureMax(winding.def, winding.maxHp), 'big posture chunk');
  assert.equal(behind.windupAt > 0, true, 'outside the cone');
  assert.equal(hits(behind).length, 0);
  assert.ok(Math.abs(g.slowMult(idle) - (1 - SONG.dissonance.slow)) < 1e-9, 'slowed 40%');
  assert.equal(g.discordOf(idle), 1);
  const x0 = idle.x, z0 = idle.z;
  g.moveMob(idle, idle.x + 50, idle.z, idle.def.speed, 0.1, 0);
  assert.ok(Math.abs(Math.hypot(idle.x - x0, idle.z - z0) - idle.def.speed * 0.1 * 0.6) < 1e-6, 'moves at 60% speed');
  assert.ok(bard.mastery.dissonance.pts > 0);
  advance(SONG.dissonance.slowFor + 0.1);
  assert.equal(g.slowMult(idle), 1, 'slow wears off');
  ok('Dissonance: 7 m cone, interrupts wind-ups (posture chunk), slows 40% for 4 s, adds Discord');
}
{ // Crescendo: builds 3 s, then shields + buffs allies and Breaks enemies with enough Discord
  reset();
  const ready = wolf(X + 3, Z + 2), weak = wolf(X - 3, Z + 2), out = wolf(X, Z + 20);
  const boss3 = g.addMob('warden', X - 4, Z - 5), boss5 = g.addMob('warden', X + 4, Z - 5);
  for (const b of [boss3, boss5]) { b.hp = b.maxHp = 50000; }
  g.addDiscord(ready, bard, 3); g.addDiscord(weak, bard, 1); g.addDiscord(out, bard, 5);
  g.addDiscord(boss3, bard, 3); g.addDiscord(boss5, bard, 5);
  use(bard, 'crescendo');
  assert.ok(cb('cresc').length, 'the build-up is shown');
  advance(SONG.crescendo.build - 0.1);
  assert.equal(cb('crescBurst').length, 0, 'still building');
  assert.equal(ally.shield, null);
  advance(0.2);
  assert.ok(cb('crescBurst').length, 'bursts after 3 s');
  assert.equal(ally.shield.hp, Math.round(ally.maxHp * SONG.crescendo.shield));
  assert.ok(Math.abs(ally.dmg.v - SONG.crescendo.dmg) < 1e-9 && ally.dmg.until > g.time);
  assert.equal(far.shield, null, 'out of range');
  { // HUD buff bits: Crescendo has its own (4096 +damage, 8192 shield), never Blessed (2) or Aegis (32)
    const row = JSON.parse(g.snapshot()).players.find(r => r[0] === ally.id), bits = row[10];
    assert.ok(bits & 4096 && bits & 8192, 'Crescendo bits set');
    assert.ok(!(bits & 2) && !(bits & 32), 'not shown as Blessed or Aegis');
    const keep = { dmg: ally.dmg, shield: ally.shield };
    ally.dmg = { until: g.time + 8, v: 0.25, by: 0 }; ally.shield = { hp: 9, max: 9, until: g.time + 8, by: 0 }; // Bless + Aegis
    const b2 = JSON.parse(g.snapshot()).players.find(r => r[0] === ally.id)[10];
    assert.ok(b2 & 2 && b2 & 32 && !(b2 & 4096) && !(b2 & 8192), 'Bless and Aegis keep their own bits');
    g.talentShield(ally, 10, 5);
    assert.ok(JSON.parse(g.snapshot()).players.find(r => r[0] === ally.id)[10] & 32, 'a talent shield on top of Aegis tops it up');
    ally.shield = null; g.talentShield(ally, 10, 5);
    const b3 = JSON.parse(g.snapshot()).players.find(r => r[0] === ally.id)[10];
    assert.ok(b3 & 16384 && !(b3 & 32), 'a talent shield alone shows as Shield, not Aegis');
    Object.assign(ally, keep);
  }
  const brk = id => ev('stagger', e => e.id === id && e.by === bard.id).length;
  assert.equal(brk(ready.id), 1, '3 stacks: BROKEN');
  assert.equal(brk(weak.id), 0, '1 stack: not broken');
  assert.ok(weak.posture > 0, '...but posture');
  assert.equal(brk(out.id), 0, 'out of range');
  assert.equal(brk(boss3.id), 0, 'a boss needs 5');
  assert.equal(brk(boss5.id), 1, 'a boss with 5 stacks: BROKEN');
  assert.equal(g.discordOf(ready), 0, 'stacks spent');
  const pts = bard.mastery.crescendo.pts;
  assert.ok(pts > 0);
  g.damagePlayer(ally, 20, { src: 'wolf bite' });
  assert.ok(bard.mastery.crescendo.pts > pts, 'mastery for what the shield soaked');
  const pts2 = bard.mastery.crescendo.pts;
  g.damageMob(ready, ally, 100);
  assert.ok(bard.mastery.crescendo.pts > pts2, 'mastery for the buffed damage');
  // the bard goes down mid-song: it fizzles
  reset(); use(bard, 'crescendo'); advance(1); bard.dead = true; advance(2.5);
  assert.equal(cb('crescBurst').length, 0); assert.ok(cb('crescFizzle').length); assert.equal(ally.shield, null);
  bard.dead = false;
  ok('Crescendo: builds 3 s, then shields (20%) and +15% damage for allies in 12 m (its own HUD label, not Blessed), BREAKS enemies with 3+ Discord (bosses 5+); fizzles if the bard falls');
}

// ---------- evolutions ----------
{ // behaviour of each branch
  reset(); evolve(lancer, 'lcharge', 'A'); lancer.face = 0;
  const endW = wolf(X + 2.5, Z + 13);
  use(lancer, 'lcharge');
  assert.ok(Math.abs(lancer.z - (Z + LANCE.comet.len)) < 0.01, 'Comet: 13 m');
  assert.ok(endW.posture > LANCE.comet.frac[0] * postureMax(endW.def, endW.maxHp), 'shockwave posture at the end');

  reset(); evolve(lancer, 'lcharge', 'B'); lancer.face = 0;
  const hr = wolf(X, Z + 3);
  use(lancer, 'lcharge');
  assert.ok(Math.abs(lancer.z - (Z + LANCE.hitrun.len)) < 0.01, 'Hit & Run: 6 m');
  assert.equal(dealt(hr), Math.round(lancer.atk * LANCE.hitrun.mult));
  advance(0.5);
  assert.ok(Math.abs(lancer.z - Z) < 0.01 && Math.abs(lancer.x - X) < 0.01, 'sprang back to the start');

  reset(); evolve(lancer, 'lsweep', 'A');
  const cy = wolf(X + 5, Z + 1);
  use(lancer, 'lsweep'); advance(0.5);
  assert.equal(hits(cy).length, 2, 'Cyclone: two spins, 5.5 m');
  assert.ok(cy.stunUntil <= g.time, 'no stagger');

  reset(); evolve(lancer, 'lsweep', 'B'); lancer.face = 0;
  const hf = wolf(X, Z + 3), hb = wolf(X, Z - 3);
  use(lancer, 'lsweep');
  assert.ok(hf.stunUntil >= g.time + LANCE.hamstring.stun - 1e-6 && g.slowMult(hf) < 1, 'Hamstring: knocked down and slowed');
  assert.equal(hits(hb).length, 0, 'only in front');

  reset(); evolve(lancer, 'skylance', 'A');
  const ma = wolf(X, Z + 8, 400), mb = wolf(X + 4, Z + 7, 400);
  face(lancer, ma); use(lancer, 'skylance'); advance(0.8);
  assert.ok(hits(ma).length && hits(mb).length, 'Meteor: wide crash');
  assert.equal(ev('stagger').length, 0, 'no Break');

  reset(); evolve(lancer, 'skylance', 'B');
  const pin = wolf(X, Z + 8);
  face(lancer, pin); use(lancer, 'skylance'); advance(0.8);
  assert.equal(ev('stagger', e => e.id === pin.id && e.by === lancer.id).length, 1, 'Pinning: instant Break');
  assert.ok(pin.stunUntil >= g.time + LANCE.pin.root - 0.1, 'pinned (rooted)');

  reset(); evolve(bard, 'anthem', 'A');
  use(bard, 'anthem');
  assert.ok(ally.march && !ally.anthem, 'War March: damage, not speed');
  assert.ok(Math.abs(g.dmgMult(ally) - (1 + SONG.warmarch.dmg)) < 1e-9);
  const wm = wolf(X + 5, Z); g.damageMob(wm, ally, 100);
  assert.ok(bard.mastery.anthem.pts > 0, 'mastery from the extra damage');

  reset(); evolve(bard, 'anthem', 'B');
  const lw = wolf(X + 6, Z), lfar = wolf(X + 20, Z);
  lw.threat.set(ally.id, 1);
  use(bard, 'anthem'); advance(2.6);
  assert.ok(g.slowMult(lw) < 1 && g.slowMult(lfar) === 1, 'Lullaby: slows enemies within 10 m');
  assert.ok(!ally.anthem && !ally.march, 'no ally buff');
  assert.ok(g.discordOf(lw) >= 2, 'a Discord stack every 2 s');
  assert.ok(bard.mastery.anthem.pts > 0, 'mastery for holding down an enemy in the fight');

  reset(); evolve(bard, 'dissonance', 'A'); bard.face = 0;
  const sh = wolf(X, Z + 9.5), shSide = wolf(X + 4, Z + 4);
  use(bard, 'dissonance');
  assert.equal(g.discordOf(sh), 2, 'Shattering Chord: 10 m beam, 2 stacks');
  assert.equal(g.slowMult(sh), 1, 'no slow');
  assert.equal(hits(shSide).length, 0, 'narrow');

  reset(); evolve(bard, 'dissonance', 'B');
  const fb = wolf(X, Z - 2);
  use(bard, 'dissonance');
  assert.ok(Math.hypot(fb.x - X, fb.z - Z) > 3.5 && g.slowMult(fb) < 1, 'Feedback: all around, hurled away and slowed');

  reset(); evolve(bard, 'crescendo', 'A');
  const fw = wolf(X + 9, Z); g.addDiscord(fw, bard, 3);
  use(bard, 'crescendo'); advance(SONG.finale.build + 0.1);
  assert.equal(ev('stagger', e => e.id === fw.id).length, 1, 'Grand Finale: 1.5 s, 10 m, Break');
  assert.equal(ally.shield, null, 'no shield');

  reset(); evolve(bard, 'crescendo', 'B');
  const ew = wolf(X + 3, Z); g.addDiscord(ew, bard, 5);
  ally.hp = Math.round(ally.maxHp * 0.5);
  use(bard, 'crescendo'); advance(SONG.encore.build + 0.1);
  assert.equal(ally.shield.hp, Math.round(ally.maxHp * SONG.encore.shield), 'Encore: a bigger shield');
  assert.ok(ally.hp > ally.maxHp * 0.6, 'and a heal');
  assert.equal(hits(ew).length + ev('stagger').length, 0, 'no damage, no Break');
  assert.ok(bard.mastery.crescendo.pts > MASTERY.need[3], 'healing gives mastery');
  ok('evolutions: Comet (13 m + shockwave), Hit & Run (springs back), Cyclone, Hamstring, Meteor, Pinning, War March, Lullaby, Shattering Chord, Feedback, Grand Finale, Encore');
}
{ // every branch runs without throwing, with its own visual
  const want = { comet: 'comet', hitrun: 'hitrun', cyclone: 'cyclone', hamstring: 'hamstring', meteor: 'meteorLand', pinning: 'pinLand', warmarch: 'song', lullaby: 'song', shatter: 'shatter', feedback: 'feedback', finale: 'crescBurst', encore: 'crescBurst' };
  const seen = new Set();
  for (const p of [lancer, bard]) {
    for (const s of CLASSES[p.cls].skills.slice(1)) {
      for (const br of ['A', 'B']) {
        reset(); evolve(p, s.id, br);
        wolf(X, Z + 3); wolf(X + 2, Z + 6); ally.hp = 40;
        p.face = 0;
        assert.doesNotThrow(() => { use(p, s.id); advance(4); });
        const id = BRANCHES[s.id][br].id;
        assert.ok(cb(want[id], e => !e.kind || e.kind === id).length, `${s.id}/${br} (${id}) emits its visual`);
        assert.ok(p.cds[slotOf(p, s.id)] > g.time - 4, 'cooldown spent');
        seen.add(id);
      }
    }
  }
  assert.equal(seen.size, 12);
  ok('all 12 Lancer / Bard evolutions run and emit their own visual');
}
{ // level-locked: Sky Lance and Crescendo at Lv 3
  reset();
  lancer.lvl = 2; bard.lvl = 2;
  wolf(X, Z + 5);
  use(lancer, 'skylance'); use(bard, 'crescendo');
  assert.equal(cb('skymark').length + cb('cresc').length, 0);
  lancer.lvl = 10; bard.lvl = 10;
  ok('Sky Lance and Crescendo unlock at level 3');
}
{ // snapshot rows: class index resolved through CLASS_IDS
  reset();
  const snap = JSON.parse(g.snapshot());
  const row = snap.players.find(r => r[0] === bard.id);
  assert.equal(CLASS_IDS[row[7]], 'bard');
  ok('snapshot: player rows carry the Bard / Lancer class index from CLASS_IDS');
}

// ---------- persistence round-trip (needs DATABASE_URL) ----------
async function persistence() {
  if (!process.env.DATABASE_URL) { console.log('  skip - persistence (set DATABASE_URL to run it)'); return; }
  const port = Number(process.env.PORT) || 3612, base = `http://localhost:${port}`;
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
  const close = ws => new Promise(r => { ws.on('close', r); ws.close(); });
  let srv = await start({ MASTERY: '3', START_LEVEL: '' });
  try {
    const { token } = await post('/api/guest');
    const tag = Math.floor(realRandom() * 1e6);
    const { character: lc } = await post('/api/characters', { name: `Lance${tag}`, cls: 'lancer' }, token);
    const { character: bc } = await post('/api/characters', { name: `Song${tag}`, cls: 'bard' }, token);
    assert.equal(lc?.cls, 'lancer'); assert.equal(bc?.cls, 'bard');
    let first = null, inv = null, id = 0;
    const ws = await session(token, lc.id, (msg, ws) => {
      if (msg.type === 'welcome') id = msg.id;
      if (msg.type === 'inv') inv = msg;
      if (msg.type === 'mastery' && !first) { first = msg.m; ws.send(JSON.stringify({ type: 'evolve', sk: 'lcharge', br: 'B' })); }
      return msg.type === 'mastery' && msg.m.lcharge?.br === 'B';
    });
    assert.deepEqual(Object.keys(first), ['lcharge', 'lsweep', 'skylance']);
    assert.equal(first.skylance.pts, MASTERY.need[3]);
    assert.ok(id && inv, 'joined');
    ws.send(JSON.stringify({ type: 'skill', slot: 0, face: 0 })); // a thrust at nothing: harmless
    await new Promise(r => setTimeout(r, 200));
    await close(ws);
    const ws2 = await session(token, bc.id, (msg, ws) => {
      if (msg.type === 'mastery' && !msg.m.anthem.br) ws.send(JSON.stringify({ type: 'evolve', sk: 'anthem', br: 'A' }));
      return msg.type === 'mastery' && msg.m.anthem?.br === 'A';
    });
    await close(ws2);
    await new Promise(r => setTimeout(r, 400)); // the save on disconnect
    await stop(srv);
    srv = await start({ MASTERY: '' }); // no testing aid this time: everything comes from the database
    let got = null, roster = null;
    const ws3 = await session(token, lc.id, msg => { if (msg.type === 'roster') roster = msg.players; if (msg.type === 'mastery') { got = msg.m; return true; } return false; });
    await new Promise(r => setTimeout(r, 300));
    await close(ws3);
    assert.equal(got.lcharge.br, 'B', 'Lancer branch saved');
    assert.equal(got.skylance.pts, MASTERY.need[3], 'mastery points saved');
    assert.equal(roster?.find(r => r.name === `Lance${tag}`)?.cls, 'lancer', 'class saved');
    let gotB = null;
    const ws4 = await session(token, bc.id, msg => { if (msg.type === 'mastery') { gotB = msg.m; return true; } return false; });
    await close(ws4);
    assert.equal(gotB.anthem.br, 'A', 'Bard branch saved');
    const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
    assert.deepEqual(me.characters.map(c => c.cls).sort(), ['bard', 'lancer']);
    ok('persistence: a Lancer and a Bard (guest account) keep class, mastery and branches across a restart (Postgres)');
  } finally { await stop(srv); }
}

await persistence();
Math.random = realRandom;
console.log(`all ${n} checks passed`);
process.exit(0);

// ---------- bots against a running server ----------
async function botRun(kind) {
  const url = process.argv[3] || 'ws://localhost:3611/ws', secs = Number(process.argv[4]) || (kind === 'farm' ? 90 : 240);
  const errors = [];
  const roles = kind === 'farm' ? ['lancer', 'bard'] : ['guardian', 'lancer', 'bard', 'cleric'];
  const team = startTeam({ url, WebSocket, roles, behaviour: kind === 'farm' ? 'field' : 'warden', log: s => { if (/sys|switch|stagger/.test(s)) return; console.log(s); } });
  for (const b of team.team) b.ws.addEventListener('error', e => errors.push(`${b.name}: ${e.message}`));
  // count what each bot did from the snapshots it receives
  const stats = Object.fromEntries(team.team.map(b => [b.name, { skills: {}, hits: 0, kills: 0, deaths: 0, switches: 0, breaks: 0 }]));
  let cleared = false;
  for (const b of team.team) {
    b.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.type !== 'snap') return;
      for (const e of msg.w.events) {
        const s = stats[b.name];
        if (e.t === 'fx' && e.id === b.id && (e.s || e.ev)) s.skills[e.s || e.ev] = (s.skills[e.s || e.ev] || 0) + 1;
        if (e.t === 'hit' && e.by === b.id) s.hits++;
        if (e.t === 'pdie' && e.id === b.id) s.deaths++;
        if (e.t === 'switch' && e.by === b.id) s.switches++;
        if (e.t === 'stagger' && e.by === b.id) s.breaks++;
        if (e.t === 'clear') cleared = true;
      }
    });
  }
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000 && !cleared) await new Promise(r => setTimeout(r, 500));
  const lv = team.team.map(b => `${b.name} (${b.cls}) Lv ${b.me?.lvl ?? '?'}`).join(', ');
  team.stop();
  console.log(`${kind}: ${Math.round((Date.now() - t0) / 1000)} s · ${lv}`);
  for (const [name, s] of Object.entries(stats)) console.log(`  ${name}: hits ${s.hits}, breaks ${s.breaks}, switches ${s.switches}, deaths ${s.deaths}, skills ${JSON.stringify(s.skills)}`);
  if (errors.length) { console.log('errors:', errors); process.exit(1); }
  if (kind === 'warden') { console.log(cleared ? 'WARDEN DOWN' : 'warden not killed'); process.exit(cleared ? 0 : 1); }
  const idle = team.team.filter(b => !stats[b.name].hits);
  if (idle.length) { console.log('no hits from', idle.map(b => b.name)); process.exit(1); }
  process.exit(0);
}
