// Combat quick wins (docs/briefs/combat-quickwins.md): boss parts, role enemies, the weapon swap, Last Stand and the
// finisher. Pure checks on the tables, then an in-process Game driven by hand (no network, no AI ticks unless asked).
// Usage: node test/combatqw.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { MOBS, MOB_IDS, WORLD, PERFECT, angleTo } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { F3 } from '../shared/floor3.js';
import { BOSS_PARTS, PART, relAngle, inArc, partsAt, partDamage, applyPartTable, arcMid } from '../shared/bossparts.js';
import { ROLE_MOB_IDS, HEXER } from '../shared/mobroles.js';
import { LAST_STAND, FINISHER, lastStandReady } from '../shared/clutch.js';
import { SWAP, STYLES, CLASS_STYLES } from '../shared/styles.js';
import { DEFAULTS, ACTION } from '../shared/controls.js';
import { lootFor, sourceOf } from '../shared/loot.js';
import { makeItem } from '../shared/items.js';
import { roleScore } from '../shared/bots/roles.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const DEG = Math.PI / 180;

// ---------- tables ----------
{
  for (const [boss, P] of Object.entries(BOSS_PARTS)) {
    assert.ok(MOBS[boss]?.boss, `${boss} is a boss`);
    for (const pt of P.parts) {
      assert.ok(pt.hp > 0 && pt.hp < 0.2 && pt.arc[0] < pt.arc[1] && pt.call && pt.name, `${boss}.${pt.id}`);
      assert.ok(lootFor(pt.loot), `${pt.loot} has a loot row`);
    }
  }
  const W = { x: 0, z: 0, face: 0 };
  assert.ok(Math.abs(relAngle(W, 0, 5)) < 1e-9, 'straight ahead = 0');
  assert.ok(relAngle(W, 5, 0) > 0, '+x when facing +z: its left (+)');
  assert.deepEqual(partsAt('warden', W, 0, 5).map(p => p.id), ['horns']);
  assert.deepEqual(partsAt('warden', W, 0, -5).map(p => p.id), []);
  assert.deepEqual(partsAt('colossus', W, 5, -1).map(p => p.id), ['kneeL']);
  assert.deepEqual(partsAt('colossus', W, -5, -1).map(p => p.id), ['kneeR']);
  assert.deepEqual(partsAt('sovereign', W, -5, 1).map(p => p.id), ['trident']);
  assert.ok(inArc(BOSS_PARTS.colossus.parts[0], 179 * DEG) && inArc(BOSS_PARTS.colossus.parts[1], -179 * DEG));
  assert.equal(partDamage(100, 1), 100 * PART.meleeMul); assert.equal(partDamage(100, 20), 100 * PART.rangedMul);
  assert.ok(Math.abs(arcMid(BOSS_PARTS.warden.parts[0])) < 1e-9);
  const tm = { charge: { wind: 2 }, geyser: { extra: [1, 2, 3] }, sweep: { wind: 1 } };
  const t2 = applyPartTable(tm, { 'charge.wind': ['mul', 1.5], 'geyser.extra': ['add', -1], 'nope.x': ['add', 1] });
  assert.equal(t2.charge.wind, 3); assert.deepEqual(t2.geyser.extra, [0, 1, 2]);
  assert.equal(tm.charge.wind, 2, 'the original table is untouched'); assert.deepEqual(tm.geyser.extra, [1, 2, 3]);
  assert.equal(sourceOf({ type: 'warden_horns', def: { part: true } }), 'part:warden_horns');
  ok('boss part tables: arcs (+ = its left), part damage melee x1.5 / ranged x0.5, table changes on a copy, loot rows');
}
{
  assert.deepEqual(MOB_IDS.slice(-ROLE_MOB_IDS.length), ROLE_MOB_IDS, 'role enemies appended last (wire indices)');
  for (const id of ROLE_MOB_IDS) { assert.ok(MOBS[id].name && MOBS[id].look && MOBS[MOBS[id].look], id); assert.ok(lootFor(`mob:${id}`)?.gold[1] > 0, `${id} drops`); }
  assert.ok(MOBS.ironboar.plate && MOBS.bulwark.shell && MOBS.bulwark.shieldBreak && MOBS.harrier.aloft === 0 && MOBS.hexer.caster);
  assert.equal(SWAP.cd, 1);
  assert.equal(ACTION.weaponSwap?.group, 'Combat'); assert.equal(DEFAULTS.kbm.weaponSwap[0], 'KeyX'); assert.equal(DEFAULTS.pad.weaponSwap[0], 'LB+Left');
  assert.equal(lastStandReady({ now: 10, clutchAt: 5, fight: null }), true);
  assert.equal(lastStandReady({ now: 16, clutchAt: 5, fight: null }), false, 'more than 10 s after the perfect / parry');
  const f = {};
  assert.equal(lastStandReady({ now: 10, clutchAt: 5, fight: f, usedFight: f }), false, 'once per fight');
  assert.equal(lastStandReady({ now: 10, clutchAt: 5, fight: null, usedAt: 0 }), false, 'outside fights: once per 90 s');
  assert.ok(FINISHER.secs > 0.5 && FINISHER.secs < 1.2);
  const b = { skill: 5, air: [7] };
  assert.ok(roleScore(b, { id: 7, def: MOBS.harrier }, true) < 0 && roleScore(b, { id: 7, def: MOBS.harrier }, false) > 0, 'flyers: ranged in, melee out while it hovers');
  assert.ok(roleScore(b, { id: 8, def: MOBS.hexer, winding: true }, false) < 0, 'a channelling caster is a priority');
  ok('role enemies appended, with drops; swap action bound (X / LB+Left); Last Stand rules; bot target scores');
}

// ---------- a Game, by hand ----------
const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
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
const rnd = Math.random;
const at = (p, m, a, d) => { const A = m.face + a; p.x = m.x + Math.sin(A) * d; p.z = m.z + Math.cos(A) * d; p.face = angleTo(p.x, p.z, m.x, m.z); };
g.time = 20;

// ---------- the Warden's horns ----------
{
  const w = g.boss, s = g.addPlayer(null, 'Kael', 'swordsman'), r = g.addPlayer(null, 'Wren', 'ranger');
  for (const p of [s, r]) { p.x = WORLD.arena.x; p.z = WORLD.arena.z - 8; p.lvl = 10; }
  w.threat.set(s.id, 1);
  g.updateMob(w, 0.05); // engage: scale, fight table, fight
  assert.ok(w.engaged && g.fight && w.tm, 'engaged');
  w.face = 0; clear();
  const st = g.partsOf(w); assert.ok(st && st.hp[0] > 0);
  const wind0 = w.tm.charge.wind;
  at(r, w, 0, 20); const hp0 = st.hp[0];
  g.damageMob(w, r, 50, {}); const dealtR = hp0 - st.hp[0];
  at(s, w, Math.PI, w.def.radius + 1.5); const hp1 = st.hp[0];
  g.damageMob(w, s, 50, {}); assert.equal(st.hp[0], hp1, 'a hit from behind does not touch the horns');
  at(s, w, 0.2, w.def.radius + 1.5);
  const hp2 = st.hp[0], whp = w.hp; g.damageMob(w, s, 50, {}); const dealt = whp - w.hp;
  assert.ok(Math.abs((hp2 - st.hp[0]) - dealt * PART.meleeMul) < 1e-6, 'melee from the front: x1.5');
  assert.ok(dealtR > 0 && dealtR < dealt, 'ranged from the front: x0.5');
  for (let i = 0; i < 400 && st.hp[0] > 0; i++) { w.hp = w.maxHp; g.damageMob(w, s, 80, {}); }
  assert.equal(st.hp[0], 0, 'horns broken');
  assert.equal(ev('bpart').length, 1); assert.equal(ev('bpart')[0].k, 'horns');
  assert.ok(ev('loot').some(e => e.to === s.id) && ev('loot').some(e => e.to === r.id), 'a bonus loot roll for each fighter');
  assert.ok(Math.abs(w.tm.charge.wind - wind0 * 1.35) < 1e-9, 'the charge winds up slower');
  clear(); w.windupAt = 0;
  assert.equal(g.wardenMove(w, 'sweep', null, [], () => null), g.time, 'no Horn Sweep any more (a combo step)'); assert.equal(ev('tele').length, 0);
  w.sweepT = 0; w.stunUntil = 0; w.busyUntil = 0; w.closeAt = -99; g.updateCombat(0.05); assert.equal(ev('tele').length, 0, 'nor from its own timer');
  ok('Warden horns: front arc only, melee x1.5 / ranged x0.5, break -> callout, bonus loot, no Horn Sweep, slower charge');

  // the finisher: a Team Burst kill
  clear(); g._tbIn = true; w.hp = 1; g.damageMob(w, s, 999, {}); g._tbIn = false;
  const fin = ev('finisher');
  assert.equal(fin.length, 1); assert.equal(fin[0].tb, 1); assert.ok(fin[0].ids.includes(s.id) && fin[0].ids.includes(r.id));
  ok('a Team Burst kill on the Warden: finisher event for everyone in the fight');

  // a director show: no parts
  g.director = { running: true }; assert.equal(g.partsOn(), false); g.director = null;
  g.removePlayer(s); g.removePlayer(r);
}

// ---------- the Colossus's knees ----------
{
  const c = g.colossus, p = g.addPlayer(null, 'Thrain', 'berserker');
  p.x = F3.arena.x; p.z = F3.arena.z - 6; p.lvl = 28;
  c.threat.set(p.id, 1);
  g.updateMob(c, 0.05);
  assert.ok(c.engaged && g.fight3, 'engaged');
  c.face = 0; clear();
  const st = g.partsOf(c);
  for (const [a, k] of [[Math.PI / 2, 0], [-Math.PI / 2, 1]]) {
    at(p, c, a + 0.3, c.def.radius + 1.5);
    for (let i = 0; i < 400 && st.hp[k] > 0; i++) { c.hp = c.maxHp; c.staggerUntil = 0; g.damageMob(c, p, 100, {}); }
    assert.equal(st.hp[k], 0);
  }
  assert.equal(ev('bpart').length, 2);
  g.updateParts();
  assert.equal(ev('kneel').length, 1); assert.ok(g.kneeling(c) && c.stunUntil >= g.time + 5.9);
  const snap = g.partsSnap(); assert.deepEqual(snap[0].slice(0, 2), [c.id, [0, 0]]); assert.ok(snap[0][2] > 5);
  Math.random = () => 0.5; p.crit = 0;
  c.hp = c.maxHp; const h0 = c.hp; g.damageMob(c, p, 100, {}); const kneelHit = h0 - c.hp;
  advance(6.2); g.updateParts();
  c.hp = c.maxHp; c.staggerUntil = 0; g.damageMob(c, p, 100, {}); const plain = c.maxHp - c.hp;
  Math.random = rnd;
  assert.ok(Math.abs(kneelHit / plain - 1.25) < 0.05, `kneeling: +25% (${kneelHit} vs ${plain})`);
  c.bp.pend = true; g.updateParts(); assert.equal(ev('kneel').length, 1, 'once per fight');
  ok('Colossus: both knees -> it kneels 6 s taking +25%, once per fight; w.bp rows');
  g.removePlayer(p);
}

// ---------- role enemies ----------
{
  Math.random = () => 0.5;
  const p = g.addPlayer(null, 'Kael', 'swordsman'); p.crit = 0;
  const boar = [...g.mobs.values()].find(m => m.type === 'ironboar');
  assert.ok(boar, 'Floor 1 has Ironhide Boars');
  p.x = boar.x; p.z = boar.z - 2; boar.face = angleTo(boar.x, boar.z, p.x, p.z);
  clear(); boar.hp = boar.maxHp; g.damageMob(boar, p, 100, {});
  assert.equal(boar.maxHp - boar.hp, 30, 'plate: 70% less'); assert.equal(ev('mrole')[0]?.k, 'plate');
  boar.hp = boar.maxHp; boar.staggerUntil = g.time + 2; boar.staggerBy = p.id; boar.switched = true;
  g.damageMob(boar, p, 100, {});
  assert.equal(boar.maxHp - boar.hp, 125, 'Broken: x1.25'); boar.staggerUntil = 0;

  const bw = [...g.mobs.values()].find(m => m.type === 'bulwark');
  p.x = bw.x; p.z = bw.z - 2; bw.face = angleTo(bw.x, bw.z, p.x, p.z); clear();
  bw.hp = bw.maxHp; g.damageMob(bw, p, 100, {});
  assert.equal(bw.maxHp - bw.hp, 15, 'shield: front hits blocked');
  g.breakMob(bw, p); assert.ok(bw.shieldDownUntil > g.time + 5.9); assert.equal(ev('mrole').at(-1).k, 'shieldDown');
  bw.staggerUntil = 0; bw.hp = bw.maxHp; g.damageMob(bw, p, 100, {});
  assert.equal(bw.maxHp - bw.hp, 100, 'shield down: full damage from the front');

  const hr = [...g.mobs.values()].find(m => m.type === 'harrier');
  p.x = hr.x; p.z = hr.z - 2; hr.face = angleTo(hr.x, hr.z, p.x, p.z);
  hr.hp = hr.maxHp; hr.aloft = true; hr.state = null; g.damageMob(hr, p, 100, {});
  assert.equal(hr.hp, hr.maxHp, 'a hovering Harrier: melee can\'t touch it');
  p.airFrom = g.time - 0.1; p.airUntil = g.time + 0.3; g.damageMob(hr, p, 100, {});
  assert.equal(hr.maxHp - hr.hp, 100, 'from a jump: full'); p.airUntil = 0;
  hr.hp = hr.maxHp; hr.state = 'dive'; g.damageMob(hr, p, 100, {}); assert.equal(hr.maxHp - hr.hp, 100, 'in its swoop: full');
  hr.state = null; p.x = hr.x; p.z = hr.z - 12; hr.hp = hr.maxHp; g.damageMob(hr, p, 100, {}); assert.equal(hr.maxHp - hr.hp, 100, 'from range: full');
  Math.random = rnd;

  const hx = [...g.mobs.values()].find(m => m.type === 'hexer');
  p.x = hx.x + 9; p.z = hx.z; hx.threat.set(p.id, 5); hx.hp = Math.round(hx.maxHp / 2); hx.hexT = g.time - 1; hx.stunUntil = 0; clear();
  g.updateMob(hx, 0.05);
  assert.ok(hx.chan && hx.windupAt, 'channelling'); assert.equal(ev('mrole').at(-1).k, 'chan');
  for (let i = 0; i < HEXER.breakHits; i++) g.damageMob(hx, p, 1, {});
  g.updateMob(hx, 0.05);
  assert.equal(hx.chan, null); assert.ok(hx.stunUntil >= g.time + HEXER.stun - 0.01, 'interrupted: stunned'); assert.equal(ev('mrole').at(-1).k, 'interrupt');
  hx.stunUntil = 0; hx.hexT = g.time - 1; const hpH = hx.hp = Math.round(hx.maxHp / 2);
  g.updateMob(hx, 0.05); advance(HEXER.channel + 0.05); g.updateMob(hx, 0.05);
  assert.ok(hx.hp > hpH, 'an uninterrupted channel heals'); assert.equal(ev('mrole').at(-1).k, 'mend');
  ok('Ironhide Boar plate (x0.3, x1.25 Broken); Bulwark shield (front x0.15, 6 s down after a Break); Harrier (no melee aloft; jump, swoop, range hit); Hexer (channel, 3 hits interrupt + stun, else it mends)');
  g.removePlayer(p);
}

// ---------- the weapon swap ----------
{
  const p = g.addPlayer(null, 'Kael', 'swordsman');
  p.x = 0; p.z = 0; clear();
  assert.equal(g.swapWeapon(p), false, 'nothing to swap to');
  const alt = CLASS_STYLES.swordsman.find(id => !STYLES[id].def);
  const main = makeItem('weapon', 1, 'swordsman', Math.random, undefined, 'sword'); p.inv.bag.push(main); g.equip(p, main.u);
  const it = makeItem('weapon', 1, 'swordsman', Math.random, undefined, alt);
  p.inv.bag.push(it);
  g.handle(p, { type: 'equip2', u: it.u });
  assert.equal(p.inv.eq.weapon2, it); assert.ok(!p.inv.bag.includes(it));
  const style0 = p.style;
  p.cds[1] = g.time + 4;
  g.handle(p, { type: 'swap' });
  assert.equal(p.style, alt); assert.equal(ev('wswap').length, 1); assert.equal(p.cds[1], g.time + 4, 'cooldowns carry over');
  assert.equal(p.chain?.k, SWAP.step, 'a swap is a chain step');
  assert.equal(g.swapWeapon(p), false, '1 s cooldown');
  advance(SWAP.cd + 0.05);
  (p.chPress ||= {}).slash = g.time;
  assert.equal(g.swapWeapon(p), false, 'not mid-skill');
  advance(SWAP.busy + 0.05);
  assert.equal(g.swapWeapon(p), true); assert.equal(p.style, style0);
  const ally = makeItem('weapon', 1, 'cleric', Math.random); p.inv.bag.push(ally);
  g.equip2(p, ally.u); assert.notEqual(p.inv.eq.weapon2, ally, 'another class\'s weapon is refused');
  g.unequip(p, 'weapon2'); assert.equal(p.inv.eq.weapon2, null);
  ok('weapon swap: equip2, swap changes the style, keeps cooldowns, chain step, 1 s apart, not mid-skill, own class only');
  g.removePlayer(p);
}

// ---------- Last Stand ----------
{
  const p = g.addPlayer(null, 'Lyra', 'swordsman');
  p.x = 0; p.z = 60; clear();
  g.dodge(p, 0); advance(0.1);
  g.damagePlayer(p, 10, { src: 'wolf bite' });
  assert.equal(ev('perfect').length, 1); assert.equal(p.clutchAt, g.time);
  advance(3);
  g.damagePlayer(p, p.maxHp * 5, { src: 'wolf bite' });
  assert.equal(p.hp, LAST_STAND.hp); assert.ok(!p.dead && !p.downed); assert.equal(ev('lstand').length, 1);
  g.damagePlayer(p, 50, { src: 'wolf bite' }); assert.equal(p.hp, LAST_STAND.hp, 'untouchable for a moment');
  advance(LAST_STAND.invuln + 0.1);
  g.damagePlayer(p, p.maxHp * 5, { src: 'wolf bite' });
  assert.ok(p.dead, 'only once (and no perfect since)');
  ok('Last Stand: a lethal hit within 10 s of a perfect dodge leaves 1 HP and 1.5 s untouchable; once');
}
console.log(`combatqw: ${n} checks passed`);
process.exit(0);
