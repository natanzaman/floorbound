// Loot and builds (H2): affixes, sets, the drop tables, the Smith's reroll, loadouts, bots, old saves.
// Usage: node test/loot.js   (DATABASE_URL=... PORT=5093 node test/loot.js adds the save/load round trip through Postgres)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { CLASSES, WORLD } from '../shared/data.js';
import { makeItem, lastAttackItem, keepsakeItem, DROPS, SLOTS } from '../shared/items.js';
import { SMITH } from '../shared/crafting.js';
import {
  AFFIXES, AFFIX_COUNT, SETS, LOOT, SET_KEYS, SKCD_FLOOR, rollAffixes, rollAffix, rollGear, makeSetPiece, setCounts, gearFx, setProgress,
  lootFor, sourceOf, rerollCost, affixText, cleanAffixes, pickSetSlot, gearScore, botAffixes,
} from '../shared/loot.js';
import { talentTotals } from '../shared/talents.js';

const realRandom = Math.random;
const ws = { readyState: 1, send() {} };
const g = new Game();
g.mobs.clear(); g.boss = null;
const tracked = [];
g.track = (p, k, d) => tracked.push({ k, d });
let n = 0;
const ok = name => { n++; console.log(`  ok ${n} - ${name}`); };
const seq = vals => { let i = 0; return () => vals[i++ % vals.length]; };
const fresh = (cls = 'swordsman', lvl = 20) => {
  const p = g.addPlayer(ws, `L${g.nextId}`, cls);
  p.lvl = lvl; g.recompute(p); p.hp = p.maxHp;
  p.x = WORLD.town.x; p.z = WORLD.town.z;
  g.events.length = 0;
  return p;
};
const sysTo = p => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);

// ---------- affixes ----------
{
  for (let r = 0; r <= 3; r++) {
    for (let i = 0; i < 200; i++) {
      const slot = SLOTS[i % 3], it = rollGear(slot, r, 'guardian', realRandom);
      const ax = it.ax || [];
      if (r === 0) assert.ok(ax.length <= 1); else assert.equal(ax.length, AFFIX_COUNT[r], `rarity ${r} rolls ${AFFIX_COUNT[r]}`);
      assert.equal(new Set(ax.map(a => a.k)).size, ax.length, 'no duplicate affix kinds');
      for (const a of ax) {
        const A = AFFIXES[a.k];
        assert.ok(A.slots.includes(slot), `${a.k} rolls on ${slot}`);
        assert.ok(a.v > 0 && a.v <= A.v[r] * 1.25 + 0.5, `${a.k} ${a.v} in range for rarity ${r}`);
        if (A.skill) assert.ok(CLASSES[a.c].skills.some(s => s.id === a.s), 'a skill affix names a real skill');
        assert.ok(affixText(a, 'guardian').length > 4);
      }
    }
  }
  const commons = Array.from({ length: 400 }, () => rollGear('armor', 0, 'swordsman', realRandom)).filter(it => it.ax).length;
  assert.ok(commons > 60 && commons < 200, `about 30% of Commons get one affix (${commons}/400)`);
  assert.equal(rollAffixes(lastAttackItem(), 'swordsman').ax, undefined, 'Last Attack items have no affixes');
  assert.equal(rollAffixes(keepsakeItem('Bell rope'), 'swordsman').ax, undefined, 'keepsakes have no affixes');
  // role weights: a Tank sees threat far more often than a Damage class
  const count = (cls, k) => Array.from({ length: 3000 }, () => rollAffix('armor', 2, cls, realRandom)).filter(a => a.k === k).length;
  assert.ok(count('guardian', 'threat') > count('swordsman', 'threat') * 3, 'tanks roll threat more');
  assert.ok(count('cleric', 'heal') > count('berserker', 'heal') * 3, 'healers roll healing more');
  const a = rollAffix('armor', 3, 'guardian', seq([0.999, 0.5, 0]), []); // the last affix in the pool on armor
  assert.ok(a && AFFIXES[a.k].slots.includes('armor'));
  const t = affixText({ k: 'skcd', v: 2, s: 'taunt', c: 'guardian' }, 'guardian');
  assert.equal(t, 'Taunt cooldown −2 s');
  assert.equal(affixText({ k: 'skdmg', v: 15, s: 'whirl', c: 'swordsman' }, 'cleric'), '+15% Whirl damage (Swordsman)');
  assert.equal(affixText({ k: 'combo', v: 10 }), '+10% combo damage');
  assert.equal(affixText({ k: 'revive', v: 20 }), 'revive allies 20% faster');
  ok('affixes: 0-1 / 1 / 2 / 3 by rarity, valid for the slot, in range, no duplicates, role-weighted, readable text');
}

{
  assert.deepEqual(cleanAffixes([{ k: 'crit', v: 4 }, { k: 'skdmg', v: 12, s: 'whirl', c: 'swordsman', junk: 1 }], 'weapon'), [{ k: 'crit', v: 4 }, { k: 'skdmg', v: 12, s: 'whirl', c: 'swordsman' }]);
  assert.throws(() => cleanAffixes([{ k: 'dr', v: 3 }], 'weapon'), /doesn't roll/);
  assert.throws(() => cleanAffixes([{ k: 'nope', v: 3 }], 'weapon'), /unknown/);
  assert.throws(() => cleanAffixes([{ k: 'skcd', v: 1, s: 'whirl' }], 'armor'), /class/);
  ok('cleanAffixes validates admin edits');
}

// ---------- affixes reach the stats and the hooks ----------
{
  const p = fresh('guardian');
  const base = { atk: p.atk, maxHp: p.maxHp, crit: p.crit, haste: p.haste };
  const ch = makeItem('charm', 2, 'guardian', () => 0.5, 'crit');
  ch.ax = [{ k: 'hp', v: 10 }, { k: 'threat', v: 20 }];
  const ar = makeItem('armor', 2, 'guardian', () => 0.5);
  ar.ax = [{ k: 'skcd', v: 2, s: 'taunt', c: 'guardian' }, { k: 'posture', v: 12 }];
  p.inv.eq.charm = ch; p.inv.eq.armor = ar; g.recompute(p);
  assert.ok(p.maxHp > base.maxHp * 1.1, 'max health affix');
  assert.equal(p.tal.stat.threat, 20, 'threat affix in p.tal (the talent hooks read it)');
  assert.equal(p.tal.stat.posture, 12);
  assert.equal(p.tal.gear.cds.taunt, 2);
  const taunt = CLASSES.guardian.skills[1];
  const cd0 = g.skillCd({ ...p, tal: talentTotals('guardian', {}) }, taunt, 1); // (no gear)
  assert.ok(Math.abs(g.skillCd(p, taunt, 1) - Math.max(cd0 * SKCD_FLOOR, cd0 - 2)) < 1e-9, 'Taunt cooldown −2 s');
  // talents still count, and stack with gear
  p.talents = { gu_menace: 2 }; g.recompute(p);
  assert.equal(p.tal.stat.threat, 20 + 30);
  // a skill damage affix lands in tal.sk under the talent key ('basic' for the class's slot 0)
  const s = fresh('swordsman');
  s.inv.eq.weapon = makeItem('weapon', 2, 'swordsman', () => 0.5);
  s.inv.eq.weapon.ax = [{ k: 'skdmg', v: 15, s: 'whirl', c: 'swordsman' }, { k: 'skdmg', v: 9, s: 'slash', c: 'swordsman' }];
  g.recompute(s);
  assert.equal(s.tal.sk.whirl.dmg, 15); assert.equal(s.tal.sk.basic.dmg, 9);
  // another class's skill affix does nothing
  s.inv.eq.charm = makeItem('charm', 2, 'swordsman', () => 0.5); s.inv.eq.charm.ax = [{ k: 'skdmg', v: 15, s: 'gslam', c: 'guardian' }];
  g.recompute(s);
  assert.equal(s.tal.sk.gslam, undefined);
  ok('affixes: stats via recompute, threat/posture/skill damage via p.tal, flat skill cooldown cuts, talents stack');
}

// combo damage and revive speed (team affixes)
{
  const lan = fresh('lancer'), rang = fresh('ranger');
  const X = 40, Z = 60; // the field, away from town
  for (const p of [lan, rang]) { p.x = X; p.z = Z; }
  const m = g.addMob('wolf', X, Z + 1);
  m.maxHp = m.hp = 1e6; m.def = { ...m.def, posture: 1e9 };
  Math.random = () => 0.99; // no crits, no variance
  const skewer = combo => {
    rang.inv.eq.charm = combo ? Object.assign(makeItem('charm', 2, 'ranger', () => 0.5, 'haste'), { ax: [{ k: 'combo', v: combo }] }) : null;
    g.recompute(rang);
    m.tbSet = { launch: { by: lan.id, at: g.time } }; m.tbLast = {};
    m.face = Math.atan2(rang.x - m.x, rang.z - m.z); // facing the archer: no flank bonus
    const before = m.hp;
    g.damageMob(m, rang, 100, { tsk: 'shot' });
    assert.equal(m.tbSet.launch, undefined, 'the Skewer landed');
    return before - m.hp;
  };
  const plain = skewer(0), boosted = skewer(20);
  assert.ok(Math.abs(boosted / plain - 1.2) < 0.03, `+20% combo damage (${plain} -> ${boosted})`);
  Math.random = realRandom;
  g.mobs.delete(m.id);
  // revive: +100% revive speed halves the channel
  const ana = fresh('swordsman'), bo = fresh('guardian');
  for (const p of [ana, bo]) { p.x = X; p.z = Z + 20; }
  g.invite(ana, bo.id); g.accept(bo, ana.id);
  const channel = speed => {
    Object.assign(ana, { dead: false, downed: null, hp: ana.maxHp, reviveN: 0, iframeUntil: 0, revT: -1e9 });
    bo.inv.eq.armor = speed ? Object.assign(makeItem('armor', 2, 'guardian', () => 0.5), { ax: [{ k: 'revive', v: speed }] }) : null;
    g.recompute(bo);
    g.damagePlayer(ana, ana.maxHp * 50, { src: "test", peril: true });
    assert.ok(ana.downed, 'downed');
    g.startRevive(bo, ana.id);
    let secs = 0;
    while (ana.downed && secs < 20) { g.time += 0.05; secs += 0.05; g.updateDowned(0.05); }
    assert.ok(!ana.downed && !ana.dead, 'revived');
    return secs;
  };
  const s0 = channel(0), s1 = channel(100);
  assert.ok(Math.abs(s1 / s0 - 0.5) < 0.06, `revive 100% faster halves it (${s0.toFixed(2)} -> ${s1.toFixed(2)} s)`);
  g.leaveParty(bo);
  ok('team affixes: combo payoff damage (server/teamplay.js), revive speed (server/revive.js)');
}

// ---------- sets ----------
{
  for (const [id, S] of Object.entries(SETS)) {
    const pieces = SLOTS.filter(s => S.pieces[s]);
    assert.ok(pieces.length >= 2 && pieces.length <= 3, `${id}: 2-3 pieces`);
    assert.ok(S.bonus[2] && (pieces.length < 3 || S.bonus[3]), `${id}: 2- and 3-piece bonuses`);
    for (const slot of pieces) {
      const it = makeSetPiece(id, slot, 'cleric');
      assert.equal(it.set, id); assert.equal(it.slot, slot); assert.equal(it.r, S.r ?? 3);
      assert.equal((it.ax || []).length, S.affixes ?? 2);
      if (slot === 'weapon') { assert.equal(it.cls, 'cleric'); assert.ok(it.name.startsWith(S.name)); }
    }
    for (const e of Object.values(S.bonus).flat()) if (e.key) assert.ok(SET_KEYS[e.key], `${id}: rule ${e.key} has tuning`);
  }
  const p = fresh('swordsman');
  const before = { ...p.tal.stat };
  p.inv.eq.weapon = makeSetPiece('hornbound', 'weapon', 'swordsman'); p.inv.eq.weapon.ax = [];
  p.inv.eq.armor = makeSetPiece('hornbound', 'armor', 'swordsman'); p.inv.eq.armor.ax = [];
  g.recompute(p);
  assert.deepEqual(setCounts(p.inv.eq), { hornbound: 2 });
  assert.equal((p.tal.stat.posture || 0) - (before.posture || 0), 15, '2-piece: +15% posture');
  assert.ok(!p.tal.gear.keys.rampart, 'no 3-piece rule at 2');
  const atk2 = p.atk;
  p.inv.eq.charm = makeSetPiece('hornbound', 'charm', 'swordsman'); p.inv.eq.charm.ax = [];
  g.recompute(p);
  assert.ok(p.tal.gear.keys.rampart, '3-piece rule on');
  assert.ok(p.atk > atk2, '3-piece: +5% attack');
  const prog = setProgress(p.inv.eq, 'swordsman');
  assert.equal(prog[0].have, 3); assert.equal(prog[0].size, 3); assert.ok(prog[0].tiers.every(t => t.on));
  assert.equal(setProgress({}, 'swordsman', true).length, Object.keys(SETS).length);
  // Rampart: a Break buffs allies around
  const q = fresh('cleric'); q.x = p.x + 3; q.z = p.z;
  const m = g.addMob('wolf', p.x + 2, p.z);
  g.breakMob(m, p, false, null);
  assert.ok(q.relay && q.relay.v === SET_KEYS.rampart.dmg && q.relay.until > g.time, 'Rampart buffs an ally');
  assert.ok(g.events.some(e => e.t === 'tproc' && e.k === 'rampart'));
  g.mobs.delete(m.id);
  ok('sets: 2-3 pieces each, 2- and 3-piece bonuses switch on by count, Rampart works, progress for the UI');
}

{ // Undertow: a Switch hit heals allies around
  const p = fresh('swordsman'), q = fresh('guardian');
  q.x = p.x + 2; q.z = p.z; q.hp = Math.round(q.maxHp * 0.5);
  for (const s of SLOTS) { p.inv.eq[s] = makeSetPiece('tidebound', s, 'swordsman'); p.inv.eq[s].ax = []; }
  g.recompute(p);
  assert.ok(p.tal.gear.keys.undertow);
  assert.equal(p.tal.stat.combo, 15); assert.equal(p.tal.stat.revive, 25);
  const m = g.addMob('wolf', p.x + 1, p.z); m.hp = m.maxHp = 1e6;
  m.staggerUntil = g.time + 5; m.staggerBy = q.id; // broken by someone else: p's hit is a Switch
  const hp0 = q.hp;
  g.damageMob(m, p, 50, {});
  assert.ok(g.events.some(e => e.t === 'hit' && e.by === p.id && e.sw), 'it was a Switch');
  assert.ok(q.hp > hp0, 'Undertow healed the ally');
  const hp1 = q.hp;
  g.damageMob(m, p, 50, {});
  assert.equal(q.hp, hp1, 'once every few seconds');
  g.mobs.delete(m.id);
  ok('sets: Undertow heals allies on a Switch hit (with a short cooldown)');
}

// ---------- drop tables ----------
{
  assert.equal(sourceOf({ type: 'warden', def: { boss: true } }), 'boss:warden');
  assert.equal(sourceOf({ type: 'sovereign', def: { boss: true, f2boss: true } }), 'boss:sovereign');
  assert.equal(sourceOf({ type: 'oldtusk', def: {}, rare: true }), 'rare:oldtusk');
  assert.equal(sourceOf({ type: 'boar', def: {} }), 'mob:boar');
  assert.deepEqual(lootFor('mob:boar').gold, DROPS.boar.gold, 'falls back to DROPS');
  assert.ok(lootFor('boss:warden').sets.length && lootFor('boss:warden').item === DROPS.warden.item, 'merged over DROPS');
  assert.equal(lootFor('mob:nothing'), null);
  for (const [src, e] of Object.entries(LOOT)) for (const s of e.sets || []) assert.ok(SETS[s.id], `${src}: set ${s.id} exists`);
  for (const id of Object.keys(SETS)) assert.ok(Object.entries(LOOT).some(([k, e]) => k.startsWith('boss:') && e.sets?.some(s => s.id === id)), `${id} drops from a boss`);
  for (const r of ['rare:oldtusk', 'rare:ghostfang', 'rare:thornmother']) assert.ok(LOOT[r].sets[0].chance > 0 && LOOT[r].sets[0].chance < 0.1, `${r}: a small set chance`);
  // a new source added as data drops without any code
  LOOT['mob:testmob'] = { gold: [5, 5], item: 1, table: [0, 0, 0, 1], potion: 0 };
  const p = fresh();
  g.dropLoot(p, { type: 'testmob', def: {}, x: 0, z: 0 });
  const ev = g.events.find(e => e.t === 'loot' && e.to === p.id);
  assert.equal(ev.g, 5); assert.equal(ev.items.length, 1); assert.equal(ev.items[0].r, 3);
  assert.equal(p.inv.bag.at(-1).ax.length, 3, 'drops roll affixes');
  delete LOOT['mob:testmob'];
  ok('drop tables: source keys, LOOT merged over DROPS, new entries need no code, drops have affixes');
}

{ // set pieces from bosses, better odds for the Last Attack; a missing piece first
  const p = fresh('ranger'), k = fresh('cleric');
  const warden = { type: 'warden', def: { boss: true }, x: 0, z: 0 };
  let pk = 0, kk = 0;
  for (let i = 0; i < 400; i++) {
    p.inv.bag.length = 0; k.inv.bag.length = 0;
    g._laBy = k.id;
    g.dropLoot(p, warden); g.dropLoot(k, warden);
    g._laBy = undefined;
    pk += p.inv.bag.filter(it => it.set === 'hornbound').length;
    kk += k.inv.bag.filter(it => it.set === 'hornbound').length;
  }
  assert.ok(pk > 40 && pk < 130, `about 20% for a fighter (${pk}/400)`);
  assert.ok(kk > 150 && kk < 250, `about 50% for the Last Attack (${kk}/400)`);
  const inv = { bag: [makeSetPiece('tidebound', 'weapon', 'ranger')], eq: { weapon: null, armor: makeSetPiece('tidebound', 'armor', 'ranger'), charm: null } };
  for (let i = 0; i < 20; i++) assert.equal(pickSetSlot('tidebound', inv), 'charm', 'the piece you lack');
  // a real Warden kill through killMob gives the killer better odds (killMob remembers the killer)
  const w = g.addMob('warden', WORLD.arena.x, WORLD.arena.z); w.contributors = new Set([p.id, k.id]);
  Math.random = () => 0.3; // between the fighter's 20% and the Last Attack's 50%
  p.inv.bag.length = 0; k.inv.bag.length = 0;
  g.killMob(w, k);
  Math.random = realRandom;
  assert.ok(k.inv.bag.some(it => it.set === 'hornbound'), 'the killer got a set piece');
  assert.ok(!p.inv.bag.some(it => it.set === 'hornbound'), 'the other fighter did not (at this roll)');
  assert.ok(tracked.some(e => e.k === 'loot' && e.d.set === 'hornbound'));
  g.mobs.delete(w.id);
  ok('sets drop from their boss (20%, 50% for the Last Attack), a missing piece first, tracked');
}

// ---------- the Smith: reroll one affix ----------
{
  const p = fresh('swordsman');
  p.x = SMITH.x; p.z = SMITH.z + 2.5; p.gold = 10000; p.inv.mats = { ess: 20, prism: 5 };
  const it = makeItem('weapon', 3, 'swordsman', () => 0.5);
  it.ax = [{ k: 'atk', v: 7 }, { k: 'crit', v: 5 }, { k: 'sw', v: 20 }];
  p.inv.eq.weapon = it; g.recompute(p);
  const cost = rerollCost(it), gold = p.gold;
  assert.ok(cost.gold > 0 && cost.mats.ess > 0 && cost.mats.prism === 1);
  assert.equal(g.smith(p, { a: 'reroll', u: it.u, i: 1 }), true);
  assert.equal(it.ax.length, 3);
  assert.notEqual(it.ax[1].k, 'crit', 'a different affix');
  assert.equal(it.ax[0].k, 'atk'); assert.equal(it.ax[2].k, 'sw', 'the others stay');
  assert.equal(new Set(it.ax.map(a => a.k)).size, 3);
  assert.equal(gold - p.gold, cost.gold);
  assert.ok(sysTo(p).some(s => s.startsWith('Rerolled: +5% critical hit chance')));
  assert.equal(g.smith(p, { a: 'reroll', u: it.u, i: 7 }), false, 'no such affix');
  const la = lastAttackItem(); p.inv.bag.push(la);
  assert.equal(rerollCost(la), null); assert.equal(g.smith(p, { a: 'reroll', u: la.u, i: 0 }), false, 'Last Attack items are fixed');
  p.gold = 0;
  assert.equal(g.smith(p, { a: 'reroll', u: it.u, i: 0 }), false, 'needs gold');
  p.x = 100;
  p.gold = 10000;
  assert.equal(g.smith(p, { a: 'reroll', u: it.u, i: 0 }), false, 'only at the Smith');
  assert.ok(rerollCost(makeSetPiece('hornbound', 'armor', 'swordsman')).gold === cost.gold * 2, 'set pieces cost double');
  ok('Smith: reroll one affix for gold and materials (a different one; the rest stay); fixed items refused');
}

// ---------- loadouts ----------
{
  const p = fresh('swordsman');
  const A = { weapon: makeItem('weapon', 2, 'swordsman', () => 0.5, undefined, 'dual'), armor: makeItem('armor', 2, 'swordsman', () => 0.5), charm: makeItem('charm', 2, 'swordsman', () => 0.5, 'crit') };
  const B = { weapon: makeItem('weapon', 3, 'swordsman', () => 0.5), armor: makeSetPiece('hornbound', 'armor', 'swordsman'), charm: makeSetPiece('hornbound', 'charm', 'swordsman') };
  p.inv.eq = { ...A }; p.talents = { sw_edge: 3, sw_precision: 2 }; g.setTalents(p, p.talents);
  g.loadoutAction(p, { op: 'save', i: 0, name: 'Dual <b>DPS</b>' });
  assert.equal(p.inv.loadouts[0].n, 'Dual bDPS/b');
  assert.deepEqual(p.inv.loadouts[0].eq, { weapon: A.weapon.u, armor: A.armor.u, charm: A.charm.u });
  // switch to B by hand, new talents, save as loadout 2
  for (const s of SLOTS) { p.inv.bag.push(p.inv.eq[s]); p.inv.eq[s] = B[s]; }
  g.setTalents(p, { sw_switch: 3, sw_pressure: 3 });
  g.recompute(p);
  g.loadoutAction(p, { op: 'save', i: 1 });
  assert.equal(p.inv.loadouts[1].n, 'Loadout 2');
  const bag0 = p.inv.bag.length;
  // swap back to loadout 1 in town
  p.lastCombat = g.time - 60;
  g.loadoutAction(p, { op: 'use', i: 0 });
  for (const s of SLOTS) assert.equal(p.inv.eq[s].u, A[s].u, `${s} from loadout 1`);
  assert.equal(p.style, 'dual', 'the weapon style comes with the weapon');
  assert.deepEqual(p.talents, { sw_edge: 3, sw_precision: 2 }, 'talents restored');
  assert.equal(p.inv.bag.length, bag0, 'what was worn went to the bag');
  assert.ok(B.armor.u && p.inv.bag.some(it => it.u === B.armor.u));
  assert.deepEqual(setCounts(p.inv.eq), {});
  g.loadoutAction(p, { op: 'use', i: 1 });
  assert.deepEqual(setCounts(p.inv.eq), { hornbound: 2 });
  assert.deepEqual(p.talents, { sw_switch: 3, sw_pressure: 3 });
  // never mid-fight, never outside town
  p.lastCombat = g.time - 1;
  g.loadoutAction(p, { op: 'use', i: 0 });
  assert.equal(p.inv.eq.weapon.u, B.weapon.u, 'no swap mid-fight');
  assert.ok(sysTo(p).some(s => /mid-fight/.test(s)));
  p.lastCombat = g.time - 60; p.x = WORLD.arena.x; p.z = WORLD.arena.z;
  g.loadoutAction(p, { op: 'use', i: 0 });
  assert.equal(p.inv.eq.weapon.u, B.weapon.u, 'no swap outside town');
  p.x = WORLD.town.x; p.z = WORLD.town.z;
  // an item that's gone (sold) is reported and the slot left as is
  const ix = p.inv.bag.findIndex(it => it.u === A.armor.u); p.inv.bag.splice(ix, 1);
  g.events.length = 0;
  g.loadoutAction(p, { op: 'use', i: 0 });
  assert.equal(p.inv.eq.weapon.u, A.weapon.u); assert.equal(p.inv.eq.armor.u, B.armor.u);
  assert.ok(sysTo(p).some(s => /Missing: armor/.test(s)));
  assert.ok(g.events.some(e => e.t === 'loadout' && e.to === p.id));
  // rename, clear, bounds, and the inventory message
  g.loadoutAction(p, { op: 'rename', i: 1, name: 'Breaker' });
  assert.equal(g.invFor(p).lo[1].n, 'Breaker');
  g.loadoutAction(p, { op: 'clear', i: 1 });
  assert.equal(p.inv.loadouts[1], null);
  g.loadoutAction(p, { op: 'save', i: 3 }); g.loadoutAction(p, { op: 'save', i: -1 });
  assert.equal(p.inv.loadouts.length, 3, 'three slots');
  g.handle(p, { type: 'loadout', op: 'save', i: 2 });
  assert.ok(p.inv.loadouts[2], 'through the message handler');
  ok('loadouts: save, swap gear + style + talents in town, never mid-fight or outside town, missing items reported, rename/clear');
}

// ---------- bots ----------
{
  const b = fresh('guardian'); b.bot = true;
  b.inv.eq.armor = makeItem('armor', 1, 'guardian', () => 0.5);
  g.recompute(b);
  LOOT['mob:testbot'] = { gold: [0, 0], item: 3, table: [0, 0, 0, 1], potion: 0 };
  g.dropLoot(b, { type: 'testbot', def: {}, x: 0, z: 0 });
  delete LOOT['mob:testbot'];
  for (const s of SLOTS) {
    const best = Math.max(0, ...b.inv.bag.filter(it => it.slot === s && (!it.cls || it.cls === 'guardian')).map(it => gearScore(it, 'guardian')));
    assert.ok(gearScore(b.inv.eq[s], 'guardian') * 1.05 + 0.01 >= best, `the bot wears its best ${s}`);
  }
  const epic = makeItem('armor', 3, 'guardian', () => 0.5); b.inv.bag.push(epic);
  g.botLoot(b);
  assert.ok(b.inv.eq.armor.r === 3, 'an Epic armour replaces the Uncommon one');
  assert.ok(gearScore({ slot: 'armor', st: { hp: 20 }, ax: [{ k: 'threat', v: 20 }] }, 'guardian') > gearScore({ slot: 'armor', st: { hp: 20 }, ax: [{ k: 'crit', v: 5 }] }, 'guardian'), 'a tank values threat over crit');
  assert.ok(gearScore({ slot: 'charm', st: { crit: 8 }, ax: [{ k: 'heal', v: 10 }] }, 'cleric') > gearScore({ slot: 'charm', st: { crit: 8 }, ax: [{ k: 'posture', v: 10 }] }, 'cleric'), 'a healer values healing');
  const it = botAffixes(makeItem('charm', 3, 'cleric', () => 0.5, 'haste'), 'cleric');
  assert.deepEqual(it.ax.map(a => a.k), ['heal', 'haste', 'revive'], 'premade healer charm: healing, haste, revive');
  assert.equal(botAffixes(makeItem('armor', 0, 'swordsman', () => 0.5), 'swordsman').ax, undefined, 'Common premade gear: no affixes');
  ok('bots: equip clearly better loot for their role; premade gear gets role-fit affixes');
}

// ---------- old saves ----------
{
  const old = {
    bag: [{ u: 11, slot: 'weapon', r: 2, st: { atk: 13 }, cls: 'swordsman', name: 'Duskglass Saber' }, { u: 12, slot: 'armor', r: 1, st: { hp: 10 }, name: 'Riveted Jerkin', lv: 2, b: { hp: 9 }, bn: 'Riveted Jerkin' }],
    eq: { weapon: { u: 13, slot: 'weapon', r: 1, st: { atk: 8 }, cls: 'swordsman', name: 'Tempered Blade' }, armor: null, charm: lastAttackItem() },
    cons: { potion: 3, tonic: 0, draught: 0 },
  };
  const p = g.addPlayer(ws, 'OldSave', 'swordsman', { charId: 1, accountId: 1, lvl: 12, xp: 0, gold: 50, inv: JSON.parse(JSON.stringify(old)) });
  assert.equal(p.inv.bag.length, 2); assert.equal(p.inv.eq.weapon.name, 'Tempered Blade');
  assert.deepEqual(setCounts(p.inv.eq), {});
  assert.deepEqual(gearFx(p.inv.eq, 'swordsman').stat, {});
  assert.deepEqual(g.invFor(p).lo, [], 'no loadouts yet');
  assert.ok(p.maxHp > 0 && p.atk > 0);
  g.equip(p, 11); assert.equal(p.inv.eq.weapon.u, 11);
  g.loadoutAction(p, { op: 'save', i: 0 });
  assert.equal(p.inv.loadouts.length, 3);
  ok('old saves load: items without affixes or sets, no loadouts; everything still works');
}

// ---------- persistence round trip (needs DATABASE_URL) ----------
async function persistence() {
  if (!process.env.DATABASE_URL) { console.log('  skip - persistence (set DATABASE_URL to run it)'); return; }
  const port = Number(process.env.PORT) || 5093, base = `http://localhost:${port}`;
  const start = () => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), START_LEVEL: '', SPAWN_AT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; if (/running on/.test(out)) resolve(proc); });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', c => reject(new Error(`server exited ${c}: ${out}`)));
    setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 15000);
  });
  const stop = proc => new Promise(r => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(); });
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) }).then(r => r.json());
  const session = (token, id, onMsg) => new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://localhost:${port}/ws`);
    w.on('open', () => w.send(JSON.stringify({ type: 'join', session: token, character: id })));
    w.on('message', raw => { const msg = JSON.parse(raw); if (onMsg(msg, w)) resolve(w); });
    w.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 10000);
  });
  let srv = await start();
  const db = await import('../server/db.js');
  try {
    const { token } = await post('/api/guest');
    const name = `Lo${Math.floor(realRandom() * 1e6)}`;
    const { character } = await post('/api/characters', { name, cls: 'swordsman' }, token);
    assert.ok(character?.id, 'character created');
    // an old (pre-H2) inventory: no affixes, no sets, no loadouts
    const old = {
      bag: [{ u: 21, slot: 'armor', r: 2, st: { hp: 16, dr: 3 }, name: 'Wardensteel Mail' }],
      eq: { weapon: { u: 22, slot: 'weapon', r: 2, st: { atk: 13 }, cls: 'swordsman', name: 'Duskglass Saber' }, armor: null, charm: null },
      cons: { potion: 3, tonic: 0, draught: 0 }, mats: { tusk: 2 },
    };
    await db.q('UPDATE characters SET lvl = 8, inv = $2 WHERE id = $1', [character.id, JSON.stringify(old)]);
    let inv = null, sent = false;
    const w = await session(token, character.id, (msg, ws2) => {
      if (msg.type !== 'inv') return false;
      inv = msg;
      if (!sent) { sent = true; ws2.send(JSON.stringify({ type: 'loadout', op: 'save', i: 1, name: 'Tank' })); return false; }
      return !!msg.lo?.[1];
    });
    assert.equal(inv.bag[0].name, 'Wardensteel Mail'); assert.equal(inv.eq.weapon.name, 'Duskglass Saber');
    assert.equal(inv.lo[1].n, 'Tank'); assert.equal(inv.lo[1].eq.weapon, 22);
    await new Promise(r => { w.on('close', r); w.close(); });
    await new Promise(r => setTimeout(r, 600)); // the save on disconnect
    const [row] = await db.q('SELECT inv FROM characters WHERE id = $1', [character.id]);
    assert.equal(row.inv.loadouts[1].n, 'Tank', 'loadouts saved inside inv');
    assert.equal(row.inv.bag[0].ax, undefined, 'old items stay as they were');
    // affixes and sets survive a restart
    row.inv.bag.push({ u: 23, slot: 'charm', r: 3, st: { crit: 11 }, name: 'Hornbound Totem', set: 'hornbound', ax: [{ k: 'posture', v: 15 }, { k: 'skcd', v: 2, s: 'burst', c: 'swordsman' }] });
    await db.q('UPDATE characters SET inv = $2 WHERE id = $1', [character.id, JSON.stringify(row.inv)]);
    await stop(srv);
    srv = await start();
    let got = null;
    const w2 = await session(token, character.id, msg => { if (msg.type === 'inv') { got = msg; return true; } return false; });
    w2.close();
    const totem = got.bag.find(it => it.u === 23);
    assert.equal(totem.set, 'hornbound'); assert.deepEqual(totem.ax[1], { k: 'skcd', v: 2, s: 'burst', c: 'swordsman' });
    assert.equal(got.lo[1].n, 'Tank', 'loadouts after a restart');
    ok('persistence: an old inventory loads, loadouts and affixes/sets are saved and survive a restart (Postgres)');
  } finally { await stop(srv); }
}

await persistence();
console.log(`loot: ${n} checks passed`);
process.exit(0);
