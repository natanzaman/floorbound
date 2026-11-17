// In-process checks for the talent trees and weapon styles of the newer classes (Ranger, Berserker, Lancer, Bard):
// tree gating and ranks, every keystone and special node, per-skill talents on delayed hits and projectiles; each
// style's basic attack, passive and skill tweak, items, drops, merchant and recipes; plus a save/load round trip of a
// styled weapon through a real server + Postgres when DATABASE_URL is set.
// Usage: node test/newclass.js        (DATABASE_URL=... PORT=3652 node test/newclass.js for the persistence check)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { CLASSES, SWITCH, MAX_LEVEL, angleTo } from '../shared/data.js';
import { makeItem, SHOP, MERCHANT } from '../shared/items.js';
import { SMITH, RECIPES } from '../shared/crafting.js';
import { STYLES, STYLE_IDS, CLASS_STYLES, styleOf, rollStyle, styleItemName } from '../shared/styles.js';
import { TALENTS, TREES, KEYS, spendBlock, nodesOf, nodesForSkill, pointsAt } from '../shared/talents.js';
import { RANGER_TUNE as RT } from '../shared/classes/ranger.js';
import { BERSERKER_TUNE as BT } from '../shared/classes/berserker.js';
import { LANCE } from '../shared/classes/lancer.js';
import { SONG } from '../shared/classes/bard.js';

const NEW = ['ranger', 'berserker', 'lancer', 'bard'];
const realRandom = Math.random;
Math.random = () => 0.5; // no crits (unless forced), no damage variance

const g = new Game();
g.mobs.clear(); g.boss = null;
g.track = () => {};
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = (t, f = () => true) => { flush(); return events.filter(e => e.t === t && f(e)); };
const clear = () => { flush(); events = []; };
function advance(dt) { // scheduled callbacks, arrows, traps, Rage, sonic bolts, songs (no mob AI: enemies stay put)
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    const step = Math.min(0.05, end - g.time);
    g.time += step;
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateClassesA(step);
    g.updateProjectiles(step);
    g.updateMastery();
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

const X = 0, Z = 70; // open ground north of town
let live = [];
// A player of a class at (X + dx, Z) facing north, with a weapon style and a talent allocation.
function mk(cls, { style, alloc = {}, lvl = MAX_LEVEL, dx = 0 } = {}) {
  const p = g.addPlayer(null, `N${g.nextId}`, cls);
  p.lvl = lvl;
  const it = makeItem('weapon', 1, cls, () => 0.5, undefined, style); // (the same Uncommon weapon for everyone)
  p.inv.bag.push(it); g.equip(p, it.u);
  g.setTalents(p, alloc);
  assert.deepEqual(p.talents, alloc, `alloc accepted for ${cls}`);
  p.x = X + dx; p.z = Z; p.face = 0; p.hp = p.maxHp; p.crit = 0;
  live.push(p);
  return p;
}
function done() {
  for (const p of live) g.removePlayer(p);
  live = [];
  for (const m of [...g.mobs.values()]) g.mobs.delete(m.id);
  g.scheduled = []; g.arrowList = []; g.trapList = []; g.cbShots = []; g.zones = [];
  g.time += 30; clear();
}
// A tough wolf d m in front of p (a: angle off its facing).
function wolf(p, d, a = 0, hp = 1e6) {
  const x = p.x + Math.sin(p.face + a) * d, z = p.z + Math.cos(p.face + a) * d;
  const m = g.addMob('wolf', x, z);
  m.x = x; m.z = z; m.sx = x; m.sz = z; m.hp = m.maxHp = hp; m.posture = 0;
  return m;
}
const slot = (p, id) => CLASSES[p.cls].skills.findIndex(s => s.id === id);
const use = (p, id) => { const i = slot(p, id); p.cds[i] = 0; g.useSkill(p, i, p.face); };
const press = p => { p.cds[0] = 0; g.useSkill(p, 0, p.face); };
const dealt = (m, p) => ev('hit', e => e.id === m.id && (!p || e.by === p.id)).reduce((a, e) => a + e.a, 0);
const hitsOn = (m, p) => ev('hit', e => e.id === m.id && (!p || e.by === p.id));
const fresh = p => { p.combo = 0; p.lastBasic = -9; };
// Every node of a branch at max rank (tiers 0-3 add up to 14+, so the keystone is legal too).
const full = (cls, bid) => Object.fromEntries(TREES[cls].branches.find(b => b.id === bid).nodes.map(nd => [nd.id, nd.max]));
g.time = 100;

// ====================================================================================================
// Talent trees
// ====================================================================================================
{
  for (const cls of NEW) {
    const t = TREES[cls];
    assert.ok(t, `${cls} has a tree`);
    assert.equal(t.branches.length, 3);
    for (const b of t.branches) {
      assert.ok(b.nodes.length >= 7 && b.nodes.length <= 8, `${b.id}: 7-8 nodes`);
      for (let k = 0; k < 5; k++) assert.ok(b.nodes.some(nd => nd.tier === k), `${b.id}: tier ${k}`);
      assert.ok(b.nodes.some(nd => nd.max > 1), `${b.id}: ranked nodes`);
      const ks = b.nodes.find(nd => nd.keystone);
      assert.ok(ks.desc && ks.fx.some(e => e.key && KEYS[e.key]), `${ks.id}: a key rule`);
    }
    assert.ok(t.branches.some(b => b.nodes.some(nd => nd.keystone && nd.coop)), `${cls}: a co-op keystone`);
    for (const key of ['basic', ...CLASSES[cls].skills.slice(1).map(s => s.id)]) assert.ok(nodesForSkill(cls, key).length, `${cls}: a talent for ${key} (Abilities pane)`);
    // gating: tier 2 needs 3 points above, the keystone 14; ranks stop at max
    const b0 = t.branches[0], t0 = b0.nodes.find(nd => nd.tier === 0), t1 = b0.nodes.find(nd => nd.tier === 1 && nd.req.includes(t0.id));
    assert.match(spendBlock(cls, {}, MAX_LEVEL, t1.id), /Needs 3 points/);
    assert.match(spendBlock(cls, { [t0.id]: t0.max }, MAX_LEVEL, t0.id), /max rank/);
    const ks = b0.nodes.find(nd => nd.keystone), a = full(cls, b0.id); delete a[ks.id];
    assert.equal(spendBlock(cls, a, MAX_LEVEL, ks.id), null, 'a full branch opens its keystone');
    const lean = { ...a }; for (const nd of b0.nodes.filter(x => x.tier === 3)) delete lean[nd.id];
    assert.match(spendBlock(cls, lean, MAX_LEVEL, ks.id), /Needs 14 points|Needs a point/);
    assert.match(spendBlock(cls, {}, 1, t0.id), /No talent points/);
  }
  // spending through the server, as the client does
  const p = mk('bard', { lvl: 4 });
  for (let i = 0; i < 4; i++) g.talentAction(p, { op: 'spend', id: 'bd_ward' });
  assert.deepEqual(p.talents, { bd_ward: 3 }, 'three ranks, then capped (level 4: 3 points)');
  assert.equal(pointsAt(4), 3);
  done();
  ok('trees: 3 branches x 5 tiers per new class, 7-8 nodes, ranks, gates (0/3/6/10/14), co-op keystones, every skill has a talent');
}

// ---------- per-skill talents reach projectiles and delayed hits ----------
{
  // arrows (Heavy Draw: basic attack +15%) and sonic bolts (Sharp Notes: +15%) carry their skill
  const r0 = mk('ranger'), r1 = mk('ranger', { alloc: { rg_draw: 3 }, dx: 30 });
  const m0 = wolf(r0, 10), m1 = wolf(r1, 10);
  r0.atk = r1.atk = 1000; // (big numbers: no rounding noise)
  press(r0); press(r1); advance(0.6);
  const d0 = dealt(m0, r0), d1 = dealt(m1, r1);
  near(d1 / d0, 1.15, 0.002, 'arrow +15%');
  const b0 = mk('bard', { dx: 60 }), b1 = mk('bard', { alloc: { bd_sharp: 3 }, dx: -30 });
  const s0 = wolf(b0, 6), s1 = wolf(b1, 6);
  b0.atk = b1.atk = 1000;
  press(b0); press(b1); advance(0.6);
  near(dealt(s1, b1) / dealt(s0, b0), 1.15, 0.002, 'bolt +15%');
  done();
  // Sky Lance's landing (scheduled) gets Diving Strike's radius
  const l0 = mk('lancer'), l1 = mk('lancer', { alloc: { ln_wings: 3, ln_dive: 2 }, dx: 40 });
  const hits = [];
  for (const p of [l0, l1]) {
    wolf(p, 6);
    const side = g.addMob('wolf', p.x + 4.75, p.z + 4.6); side.x = p.x + 4.75; side.z = p.z + 4.6; side.hp = side.maxHp = 1e6;
    use(p, 'skylance'); advance(1);
    hits.push(dealt(side, p));
  }
  assert.equal(hits[0], 0, 'base Sky Lance: 3.5 m'); assert.ok(hits[1] > 0, 'Diving Strike: +20% radius on the delayed landing');
  done();
  // durations: Mark the Prey (mark), Breath Control (Anthem), Blood Price (Bloodrage), Wide Spread (caltrops)
  const rg = mk('ranger', { alloc: { rg_prey: 3 } }), wm = wolf(rg, 10);
  use(rg, 'mark');
  near(wm.markA.until - g.time, RT.mark.dur * 1.36, 1e-6, 'mark');
  const bd = mk('bard', { alloc: { bd_breath: 3 }, dx: 30 });
  use(bd, 'anthem');
  near(bd.song.until - g.time, SONG.anthem.dur * 1.3, 1e-6, 'anthem');
  const bz = mk('berserker', { alloc: { bz_leech: 3, bz_price: 2 }, dx: 60 });
  bz.rage = 60; use(bz, 'bloodrage');
  near(bz.brA.until - g.time, (BT.bloodrage.dur[0] + (BT.bloodrage.dur[1] - BT.bloodrage.dur[0]) * 0.6) * 1.3, 1e-6, 'bloodrage');
  const tr = mk('ranger', { alloc: { rg_spikes: 3, rg_spread: 2 }, dx: -30 });
  use(tr, 'disengage');
  const trap = g.trapList.find(x => x.owner === tr.id);
  near(trap.r, RT.disengage.trap.r * 1.3, 1e-9, 'trap radius'); near(trap.until - g.time, RT.disengage.trap.dur * 1.3, 1e-6, 'trap duration');
  done();
  ok(`per-skill talents: arrows/bolts +15% (${d1} vs ${d0}), Sky Lance landing radius, mark/song/Bloodrage/trap durations`);
}

// ---------- Ranger keystones ----------
{
  // Dead Shot: Piercing Shot always crits; a crit from another arrow takes 1 s off it. Longshot: +20% beyond 12 m.
  const p = mk('ranger', { alloc: full('ranger', 'marksman') });
  const m = wolf(p, 10);
  use(p, 'pierce'); advance(1);
  const ph = hitsOn(m, p);
  assert.ok(ph.length && ph.every(e => e.c === 1), 'Piercing Shot crits');
  const i = slot(p, 'pierce'); p.cds[i] = g.time + 5;
  p.crit = 0.9; fresh(p); press(p); advance(0.6); p.crit = 0;
  near(p.cds[i] - g.time, 5 - 0.6 - 1, 1e-6, 'pierce cd after a crit arrow');
  clear();
  const mNear = wolf(p, 9, 0.3), mFar = wolf(p, 16, -0.3);
  p.face = 0.3; fresh(p); press(p); advance(0.8);
  p.face = -0.3; fresh(p); press(p); advance(0.8);
  near(dealt(mFar, p) / dealt(mNear, p), 1.2, 0.02, 'Longshot');
  done();
  ok('Dead Shot (Piercing Shot always crits, crit arrows refund it) and Longshot (+10%/rank beyond 12 m)');

  // Minefield: the caltrops explode when they run out; Pinning Arrow: the 3rd arrow slows
  const t = mk('ranger', { alloc: full('ranger', 'trapper') });
  const w = wolf(t, 1);
  use(t, 'disengage');
  advance(7);
  const boom = ev('tproc', e => e.k === 'minefield' && e.id === t.id);
  assert.equal(boom.length, 1, 'one explosion');
  assert.ok(hitsOn(w, t).some(e => e.h && e.a >= Math.round(t.atk * KEYS.minefield.mult * 0.99)), 'a heavy blast on the wolf');
  g.mobs.delete(w.id);
  const w2 = wolf(t, 10);
  fresh(t); press(t); press(t); press(t); advance(0.6);
  assert.ok(w2.slowUntil > g.time && w2.slowV > 0, 'Pinning Arrow slows');
  done();
  ok('Minefield (traps explode when they end) and Pinning Arrow (3rd arrow slows)');

  // Pack Leader + Deep Mark: a Switch on the marked enemy refreshes the mark, resets Piercing Shot, buffs the party
  const r = mk('ranger', { alloc: full('ranger', 'packhunt') }), tank = mk('guardian', { dx: 3 }), sw = mk('swordsman', { dx: -3 });
  const mm = wolf(r, 8);
  use(r, 'mark');
  near(mm.markA.bonus, RT.mark.bonus + 2 * KEYS.deepmark.bonus, 1e-9, 'Deep Mark');
  advance(3);
  const pi = slot(r, 'pierce'); r.cds[pi] = g.time + 5;
  mm.staggerUntil = g.time + 2; mm.staggerBy = tank.id; mm.switched = false;
  g.damageMob(mm, sw, 10, {});
  assert.equal(ev('tproc', e => e.k === 'packlead' && e.id === r.id).length, 1);
  near(mm.markA.until - g.time, RT.mark.dur * 1.36, 1e-6, 'mark refreshed');
  assert.ok(r.cds[pi] <= g.time, 'Piercing Shot ready');
  for (const o of [r, tank, sw]) near(o.relay?.v, KEYS.packlead.dmg, 1e-9, `${o.cls} buffed`);
  done();
  ok('Pack Leader (co-op): a Switch on your mark refreshes it, readies Piercing Shot, +10% party damage; Deep Mark +10%');
}

// ---------- Berserker keystones ----------
{
  const p = mk('berserker', { alloc: full('berserker', 'carnage') });
  g.gainRageA(p, 10); near(p.rage, 13, 1e-9, 'Fury +30%');
  const m = wolf(p, 2);
  p.rage = 0; g.damageMob(m, p, 100, {}); const a0 = dealt(m, p); clear();
  p.rage = 100; g.damageMob(m, p, 100, {}); const a1 = dealt(m, p); clear();
  assert.equal(a0, 100); assert.equal(a1, Math.round(100 * (1 + 2 * KEYS.redmist.dmg)), 'Red Mist at full Rage');
  // Massacre: a kill grants Rage and resets Cleave; Cleave +30% on enemies below 35%
  const ci = slot(p, 'cleave'); p.cds[ci] = g.time + 5; p.rage = 0;
  const weak = wolf(p, 2, 0.5, 1);
  g.damageMob(weak, p, 50, {});
  assert.ok(weak.dead); near(p.rage, KEYS.massacre.rage * 1.3 + 0, 3, 'Rage from the kill'); // (+ a little from the hit)
  assert.ok(p.cds[ci] <= g.time, 'Cleave reset');
  for (const mob of [...g.mobs.values()]) g.mobs.delete(mob.id);
  const hi = wolf(p, 2), lo = wolf(p, 2.2, 0.2); lo.hp = lo.maxHp * 0.3;
  clear(); p.rage = 0; use(p, 'cleave');
  const dh = dealt(hi, p), dl = dealt(lo, p);
  near(dl / dh, 1 + KEYS.massacre.dmg, 0.02, 'Massacre cleave');
  done();
  ok(`Fury (+30% Rage), Red Mist (+16% at full Rage), Massacre (kill: Rage + Cleave reset; Cleave +30% on low health)`);

  // Bloodlust: Leech heals, Second Wind cuts damage when low, Sanguine Frenzy extends Bloodrage on kills and heals at the end
  const b = mk('berserker', { alloc: full('berserker', 'bloodlust') });
  const w = wolf(b, 2);
  b.hp = b.maxHp - 50; g.damageMob(w, b, 100, {});
  assert.equal(b.hp, b.maxHp - 50 + Math.round(100 * 0.06 * 1.2), 'Leech 6% (x Feast +20% healing)');
  b.hp = Math.round(b.maxHp * 0.3);
  assert.equal(g.talentHurt(b, 100, false, false), 88, 'Second Wind: -12% below 35%');
  b.hp = b.maxHp; b.rage = 60; use(b, 'bloodrage');
  const u0 = b.brA.until;
  const weak2 = wolf(b, 2, 0.4, 1); g.damageMob(weak2, b, 50, {});
  near(b.brA.until - u0, KEYS.sanguine.ext, 1e-9, 'kill extends Bloodrage');
  b.hp = Math.round(b.maxHp / 2); const h0 = b.hp;
  advance(b.brA.until - g.time + 0.1);
  assert.ok(!b.brA && b.hp >= h0 + Math.round(b.maxHp * KEYS.sanguine.heal), 'heal when it ends');
  assert.equal(ev('tproc', e => e.k === 'sanguine').length, 1);
  b.brA = { until: g.time + 5, ls: 0, haste: 1, k: 'frenzy' };
  const mp = wolf(b, 2), mq = wolf(b, 2);
  g.addPosture(mp, b, 10, {}); b.brA = null; g.addPosture(mq, b, 10, {});
  near(mp.posture / mq.posture, 1 + KEYS.sanguine.posture, 1e-6, 'posture while raging');
  done();
  ok('Leech, Second Wind, Sanguine Frenzy (kills extend Bloodrage, +25% posture, heal 15% when it ends)');

  // Warcry (co-op): a Break buffs everyone around and readies Leap Slam
  const z = mk('berserker', { alloc: full('berserker', 'warcry') }), ally = mk('cleric', { dx: 5 }), far = mk('guardian', { dx: 40 });
  const wm = wolf(z, 2), li = slot(z, 'leap'); z.cds[li] = g.time + 6;
  g.addPosture(wm, z, g.postureCap(wm) + 1, {});
  assert.ok(g.time < wm.staggerUntil);
  near(z.relay.v, KEYS.warcry.dmg, 1e-9); near(ally.relay.v, KEYS.warcry.dmg, 1e-9); assert.ok(!far.relay, 'out of range');
  assert.ok(z.cds[li] <= g.time, 'Leap Slam ready');
  const w2 = wolf(z, 2); z.cds[li] = g.time + 6;
  g.addPosture(w2, z, g.postureCap(w2) + 1, {});
  assert.ok(z.cds[li] > g.time, 'at most every 8 s');
  done();
  ok('Warcry (co-op): your Breaks give allies within 12 m +12% damage and reset Leap Slam (8 s internal cooldown)');
}

// ---------- Lancer keystones ----------
{
  const p = mk('lancer', { alloc: full('lancer', 'dragoon') });
  const mn = wolf(p, 1.5), mt = wolf(p, 4);
  const si = slot(p, 'skylance'); p.cds[si] = g.time + 5;
  p.atk = 1000; fresh(p); press(p);
  near(dealt(mt, p) / dealt(mn, p), LANCE.sweetMult + 0.2, 0.003, 'Honed Tip +20%');
  near(p.cds[si] - g.time, 4.5, 1e-6, 'Dragoon: a tip hit takes 0.5 s off Sky Lance');
  const a = wolf(p, 2), b = wolf(p, 2);
  g.addPosture(a, p, 10, { sk: 'skylance' }); g.addPosture(b, p, 10, {});
  near(a.posture / b.posture, 1 + KEYS.dragoon.posture, 1e-6, 'Sky Lance posture +40%');
  done();
  ok('Dragoon (tip thrusts shorten Sky Lance, Sky Lance +40% posture) and Honed Tip');

  const s = mk('lancer', { alloc: full('lancer', 'skirmish') });
  const ci = slot(s, 'lcharge'); s.cds[ci] = g.time + 5;
  g.dodge(s, 0);
  near(s.cds[ci] - g.time, 5 - KEYS.fade.roll, 1e-6, 'a roll shortens Lance Charge');
  advance(1);
  use(s, 'lcharge');
  near(s.fadeUntil - g.time, KEYS.fade.window, 1e-9);
  const m = wolf(s, 1.6); clear();
  fresh(s); press(s); const first = dealt(m, s); clear();
  advance(0.7); press(s); const second = dealt(m, s);
  near(first / second, 1 + KEYS.fade.dmg, 0.02, 'the first thrust after a charge');
  done();
  ok(`Hit and Fade: rolls shorten Lance Charge; the first thrust after it deals +40% (${first} vs ${second})`);

  const l = mk('lancer', { alloc: full('lancer', 'phalanx') }), ally = mk('cleric', { dx: 4 }), far = mk('cleric', { dx: 30 });
  const w = wolf(l, 2.5); w.threat.set(ally.id, 500);
  use(l, 'lsweep');
  assert.equal(ally.shield?.hp, Math.round(ally.maxHp * KEYS.phalanx.shield)); assert.ok(l.shield); assert.ok(!far.shield);
  assert.equal(g.topThreat(w), l.id, 'the tripped wolf turns on the lancer');
  done();
  ok('Phalanx (co-op): Sweep shields allies within 8 m and pulls what it hits off them');
}

// ---------- Bard keystones ----------
{
  const p = mk('bard', { alloc: full('bard', 'maestro') }), ally = mk('swordsman', { dx: 4 });
  use(p, 'anthem');
  near(p.song.pow, 1 + 3 * KEYS.voice.pow, 1e-9, 'Resonant Voice');
  const u0 = p.song.until, m = wolf(p, 5);
  press(p); advance(0.5);
  near(p.song.until - u0, KEYS.maestro.ext, 1e-6, 'a bolt that lands extends the song');
  const target = wolf(ally, 2, 0.5); clear();
  g.damageMob(target, ally, 100, {});
  assert.equal(dealt(target, ally), Math.round(100 * (1 + KEYS.maestro.dmg) * 1.06), 'ally +8% under the song (and Chorus +6%)');
  ally.hp = Math.round(ally.maxHp / 2); const h0 = ally.hp;
  advance(1.05);
  assert.ok(ally.hp > h0, 'Soothing Song heals');
  done();
  ok('Maestro (hits extend the song; allies under it +8%), Resonant Voice, Soothing Song');

  const d = mk('bard', { alloc: full('bard', 'discord') });
  const a = wolf(d, 5), b = wolf(d, 6.5, 0.3);
  press(d); advance(0.5);
  assert.equal(g.discordOf(a), 1); assert.equal(g.discordOf(b), 1, 'Cacophony: the discord spreads to enemies within 3 m');
  near(a.discord.until - g.time, SONG.discord.dur + 2 * KEYS.linger.d - 0.5 + 0.05, 0.11, 'Lingering Discord');
  a.discord.n = 3; clear();
  g.damageMob(a, d, 100, {});
  assert.equal(dealt(a, d), Math.round(100 * (1 + 2 * KEYS.resonance.dmg * 3)), 'Resonance: +4% per stack');
  const c = wolf(d, 3, -0.6); g.addDiscord(c, d, 2); // 2 stacks: one short of a Break, normally
  use(d, 'crescendo'); advance(SONG.crescendo.build + 0.1);
  assert.ok(g.time < c.staggerUntil, 'Cacophony: Crescendo Breaks it with one stack fewer');
  done();
  ok('Cacophony (spreading Discord, Crescendo needs one stack fewer), Lingering Discord, Resonance');

  const h = mk('bard', { alloc: full('bard', 'harmony') }), sw = mk('swordsman', { dx: 5 }), tank = mk('guardian', { dx: -3 });
  const w = wolf(sw, 2);
  const ci = slot(h, 'crescendo'); h.cds[ci] = g.time + 10;
  w.staggerUntil = g.time + 2; w.staggerBy = tank.id; w.switched = false;
  g.damageMob(w, sw, 10, {});
  assert.equal(sw.shield?.hp, Math.round(sw.maxHp * KEYS.symphony.shield), 'Symphony shield');
  near(h.cds[ci] - g.time, 10 - KEYS.symphony.cdr, 1e-6, 'Crescendo -2 s');
  sw.shield = null;
  use(h, 'crescendo'); advance(SONG.crescendo.build + 0.1);
  assert.equal(sw.shield.hp, Math.round(sw.maxHp * SONG.crescendo.shield) + Math.round(sw.maxHp * 2 * KEYS.crescshield.shield), 'Bulwark Chord: +10%');
  done();
  ok('Symphony (co-op: an ally\'s Switch near you shields them and speeds up Crescendo) and Bulwark Chord');
}

// ====================================================================================================
// Weapon styles
// ====================================================================================================
{
  for (const cls of NEW) {
    assert.equal(CLASS_STYLES[cls].length, 3);
    for (const id of CLASS_STYLES[cls]) assert.ok(STYLE_IDS.indexOf(id) >= 9, 'appended after the original nine');
    assert.equal(styleOf(null, cls), CLASS_STYLES[cls][0]);
    const counts = {};
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000; i++) { const s = rollStyle(cls, rnd); counts[s] = (counts[s] || 0) + 1; }
    assert.equal(Object.keys(counts).length, 3, `${cls} drops roll all three styles`);
    assert.ok(RECIPES.filter(rc => rc.style && STYLES[rc.style].cls === cls).length === 2, `${cls}: a recipe per non-default style`);
  }
  const names = { crossbow: ['ranger', 2, 'Galeshot Crossbow'], daggers: ['ranger', 0, 'Hunting Twin Daggers'], twinaxes: ['berserker', 1, 'Bearded Twin Axes'],
    warhammer: ['berserker', 3, 'Worldsplitter Warhammer'], halberd: ['lancer', 2, 'Galeglass Halberd'], glaive: ['lancer', 1, 'Tempered Glaive'],
    drum: ['bard', 2, 'Resonant War Drum'], flute: ['bard', 0, 'Pine Flute'] };
  for (const [id, [cls, r, name]] of Object.entries(names)) {
    const it = makeItem('weapon', r, cls, () => 0.5, undefined, id);
    assert.equal(it.style, id); assert.equal(it.name, name); assert.equal(styleItemName(id, r), name);
  }
  assert.equal(makeItem('weapon', 1, 'lancer', () => 0.5, undefined, 'lance').style, undefined, 'the default keeps the classic name');
  assert.equal(makeItem('weapon', 1, 'lancer', () => 0.5).name, 'Tempered Pike');
  // drops, snapshot
  Math.random = realRandom;
  const p = mk('ranger');
  const seen = new Set();
  for (let i = 0; i < 80; i++) { p.inv.bag = []; g.dropLoot(p, { type: 'warden', x: 0, z: 0 }); for (const it of p.inv.bag) if (it.slot === 'weapon') seen.add(styleOf(it, 'ranger')); }
  Math.random = () => 0.5;
  assert.deepEqual([...seen].sort(), ['crossbow', 'daggers', 'longbow']);
  const q = mk('bard', { style: 'flute' });
  assert.equal(STYLE_IDS[JSON.parse(g.snapshot()).players.find(r => r[0] === q.id)[11]], 'flute');
  g.unequip(q, 'weapon'); assert.equal(q.style, 'lyre');
  done();
  ok('styles: 3 per new class (ids appended), names, drops roll all three, recipes, snapshot index');
}

// ---------- Ranger: Crossbow, Twin Daggers ----------
{
  const lb = mk('ranger'), xb = mk('ranger', { style: 'crossbow', dx: 30 });
  const l1 = wolf(lb, 9), l2 = wolf(lb, 12), x1 = wolf(xb, 9), x2 = wolf(xb, 12), x3 = wolf(xb, 15);
  fresh(lb); fresh(xb); press(lb); press(xb); advance(0.8);
  const dl1 = dealt(l1, lb);
  assert.ok(dl1 > 0 && dealt(l2, lb) === 0, 'the longbow arrow stops at the first');
  assert.ok(dealt(x1, xb) > 0 && dealt(x2, xb) > 0 && dealt(x3, xb) === 0, 'the bolt pierces one extra');
  assert.equal(hitsOn(x1, xb)[0].c, 1, 'Crossbow: the first bolt on a new target crits');
  near(xb.cds[0] - (g.time - 0.8), CLASSES.ranger.skills[0].cd * 1.65, 1e-6, 'slower');
  clear(); xb.crit = 0;
  fresh(xb); press(xb); advance(0.8);
  assert.equal(hitsOn(x1, xb)[0].c, 0, 'only the first');
  const ratio = dealt(x1, xb) / dl1;
  near(ratio, 1.75, 0.03, 'heavier bolts');
  assert.ok(ev('aproj', e => e.by === xb.id).every(e => e.k === 'xbolt' || e.k === 'xheavy'));
  clear(); use(lb, 'pierce'); use(xb, 'pierce');
  const draws = ev('fx', e => e.k === 'ca' && e.v === 'draw');
  near(draws.find(e => e.id === xb.id).d, RT.pierce.draw * 0.6, 0.01); near(draws.find(e => e.id === lb.id).d, RT.pierce.draw, 0.01);
  done();
  ok('Crossbow: slower (0.99 s), x1.75 bolts that pierce one extra, first bolt on a new target crits, Piercing Shot draws 40% faster');

  const dg = mk('ranger', { style: 'daggers' });
  const m = wolf(dg, 2);
  const per = [0, 1, 2, 3].map(() => { clear(); advance(0.41); g.useSkill(dg, 0, 0); return dealt(m, dg); });
  advance(0.3);
  assert.equal(ev('aproj', e => e.by === dg.id).length, 0, 'no arrows');
  assert.equal(ev('fx', e => e.k === 'sty' && e.st === 'daggers' && e.n === 3).length, 2, 'the 4th press stabs twice');
  near(dg.cds[0] - (g.time - 0.3), 0.4, 1e-6);
  near(per[0], Math.round(dg.atk * 0.8), 1);
  // passive: a 12% chance to mark
  m.x = dg.x; m.z = dg.z + 2; // (the combo knocked it back)
  Math.random = () => 0.05; advance(0.5); g.useSkill(dg, 0, 0); Math.random = () => 0.5;
  assert.ok(m.markA && m.markA.by === dg.id && m.markA.bonus === RT.mark.bonus, 'marked on hit');
  // tweak: Disengage resets on a kill
  const di = slot(dg, 'disengage'); dg.cds[di] = g.time + 8;
  for (const mob of [...g.mobs.values()]) g.mobs.delete(mob.id);
  const weak = wolf(dg, 2, 0, 1); advance(0.5); g.useSkill(dg, 0, 0);
  assert.ok(weak.dead && dg.cds[di] <= g.time, 'Disengage ready after the kill');
  done();
  ok(`Twin Daggers: melee 4-hit combo (0.4 s, ${per.join('/')}), double 4th stab, marks on a 12% roll, kills reset Disengage`);
}

// ---------- Berserker: Twin Axes, Warhammer ----------
{
  const ga = mk('berserker'), ta = mk('berserker', { style: 'twinaxes', dx: 30 }), wh = mk('berserker', { style: 'warhammer', dx: 60 });
  const res = {};
  for (const p of [ga, ta, wh]) {
    const front = wolf(p, 2, 0, 2000), back = wolf(p, 2, Math.PI, 2000);
    fresh(p); const out = [];
    for (let i = 0; i < 3; i++) { front.posture = 0; clear(); p.cds[0] = 0; g.useSkill(p, 0, 0); out.push([dealt(front, p), Math.round(front.posture)]); advance(0.2); }
    res[p.style] = { out, back: dealt(back, p), cd: p.cds[0] - (g.time - 0.2) };
  }
  near(res.greataxe.cd, 0.85, 1e-6); near(res.twinaxes.cd, 0.85 * 0.65, 1e-6); near(res.warhammer.cd, 0.85 * 1.45, 1e-6);
  assert.ok(res.twinaxes.out[0][0] < res.greataxe.out[0][0] && res.twinaxes.out[0][1] < res.greataxe.out[0][1] / 1.5, 'lighter hits, much less posture');
  assert.ok(res.warhammer.out[0][1] > res.greataxe.out[0][1] * 1.3, 'more posture per blow');
  assert.equal(res.greataxe.back, 0); assert.ok(res.warhammer.back > 0, 'the third hammer blow smashes all around');
  // passives
  const r1 = mk('berserker', { style: 'twinaxes', dx: -30 }); g.gainRageA(r1, 10); near(r1.rage, 13, 1e-9, 'Twin Axes: Rage +30%');
  const w1 = wolf(wh, 3), w2 = wolf(ga, 3);
  g.addPosture(w1, wh, g.postureCap(w1) + 1, {}); g.addPosture(w2, ga, g.postureCap(w2) + 1, {});
  near(w1.staggerUntil - g.time, SWITCH.window + 1, 1e-9, 'Warhammer: Breaks +1 s'); near(w2.staggerUntil - g.time, SWITCH.window, 1e-9);
  done();
  // tweaks: Twin Axes cleaves twice; Warhammer's Leap Slam is 35% wider
  const t2 = mk('berserker', { style: 'twinaxes' }), g2 = mk('berserker', { dx: 30 });
  wolf(t2, 2); wolf(g2, 2);
  use(t2, 'cleave'); use(g2, 'cleave'); advance(0.4);
  assert.equal(ev('fx', e => e.v === 'cleave' && e.id === t2.id).length, 2); assert.equal(ev('fx', e => e.v === 'cleave' && e.id === g2.id).length, 1);
  const h2 = mk('berserker', { style: 'warhammer', dx: 60 });
  wolf(h2, 6); wolf(g2, 6);
  clear(); use(h2, 'leap'); use(g2, 'leap'); advance(1);
  near(ev('fx', e => e.v === 'slam' && e.id === h2.id)[0].r, BT.leap.r * 1.35, 0.01); near(ev('fx', e => e.v === 'slam' && e.id === g2.id)[0].r, BT.leap.r, 0.01);
  done();
  ok(`Twin Axes (0.55 s, ${JSON.stringify(res.twinaxes.out)}; Rage +30%; Cleave x2) · Warhammer (1.23 s, ${JSON.stringify(res.warhammer.out)}; ring finisher; Breaks +1 s; Leap Slam +35%) vs Greataxe ${JSON.stringify(res.greataxe.out)}`);
}

// ---------- Lancer: Halberd, Glaive ----------
{
  const sp = mk('lancer'), hb = mk('lancer', { style: 'halberd', dx: 30 }), gl = mk('lancer', { style: 'glaive', dx: 60 });
  const sSide = wolf(sp, 3, 0.7), hSide = wolf(hb, 3, 0.7);
  const sFar = wolf(sp, 6.2), gFar = wolf(gl, 6.2);
  for (const p of [sp, hb, gl]) { fresh(p); press(p); }
  assert.equal(dealt(sSide, sp), 0); assert.ok(dealt(hSide, hb) > 0, 'Halberd: a sweeping arc hits to the side');
  assert.equal(dealt(sFar, sp), 0); assert.ok(dealt(gFar, gl) > 0, 'Glaive: reaches 5.6 m');
  assert.ok(hSide.slowUntil > g.time && hSide.slowV === 0.25, 'Halberd: hooked blade slows');
  near(gl.cds[0] - g.time, CLASSES.lancer.skills[0].cd * 1.15, 1e-6); near(hb.cds[0] - g.time, 0.7, 1e-6);
  done();
  // tip bonuses: spear +30%, glaive +50% (3.4 m+), halberd arcs +30% at the tip
  const ratios = {};
  for (const style of ['lance', 'glaive', 'halberd']) {
    const p = mk('lancer', { style });
    const a = wolf(p, 1.5), b = wolf(p, 4.5);
    p.atk = 1000; fresh(p); press(p);
    ratios[style] = dealt(b, p) / dealt(a, p);
    done();
  }
  near(ratios.lance, 1.3, 0.003); near(ratios.glaive, 1.5, 0.003); near(ratios.halberd, 1.3, 0.003);
  // tweaks: Halberd Sweep +30%, Glaive Lance Charge 12 m
  const h = mk('lancer', { style: 'halberd' }), s = mk('lancer', { dx: 30 });
  const hw = wolf(h, 5.6), sw = wolf(s, 5.6);
  use(h, 'lsweep'); use(s, 'lsweep');
  assert.ok(dealt(hw, h) > 0 && dealt(sw, s) === 0, 'Halberd: Sweep reaches 5.85 m');
  done();
  const gc = mk('lancer', { style: 'glaive' }), sc = mk('lancer', { dx: 4 });
  use(gc, 'lcharge'); use(sc, 'lcharge');
  near(gc.z - Z, LANCE.charge.len * 1.35, 0.5, 'Glaive charge'); near(sc.z - Z, LANCE.charge.len, 0.5);
  done();
  ok(`Halberd (arcs, slows, Sweep +30%) and Glaive (5.6-6.4 m, tip +50%, Lance Charge 12 m); tip ratios ${JSON.stringify(ratios)}`);
}

// ---------- Bard: War Drum, Flute ----------
{
  const ly = mk('bard'), dr = mk('bard', { style: 'drum', dx: 30 }), fl = mk('bard', { style: 'flute', dx: 60 });
  const dF = wolf(dr, 2), dB = wolf(dr, 2.5, Math.PI);
  const lFar = wolf(ly, 14), fFar = wolf(fl, 14);
  for (const p of [ly, dr, fl]) press(p);
  advance(0.8);
  assert.ok(dealt(dF, dr) > 0 && dealt(dB, dr) > 0, 'War Drum: a shockwave all around');
  assert.equal(g.discordOf(dF), 1); assert.equal(g.discordOf(dB), 1, 'adds Discord to everything it hits');
  assert.equal(ev('fx', e => e.k === 'cb' && e.ev === 'sonic' && e.id === dr.id).length, 0, 'no bolts');
  assert.equal(dealt(lFar, ly), 0); assert.ok(dealt(fFar, fl) > 0, 'Flute: bolts reach 16 m');
  near(fl.cds[0] - (g.time - 0.8), CLASSES.bard.skills[0].cd * 0.65, 1e-6);
  // Flute: every second bolt that lands adds 2 stacks
  clear(); press(fl); advance(0.8);
  assert.equal(g.discordOf(fFar), 3, '1 + 2');
  // War Drum passive: 3+ Discord from a drummer -> +10% damage from anyone
  const ally = mk('swordsman', { dx: 33 }), m = wolf(ally, 2);
  m.discord = { n: 3, until: g.time + 5, by: dr.id }; clear();
  g.damageMob(m, ally, 100, {}); assert.equal(dealt(m, ally), 110);
  m.discord = { n: 3, until: g.time + 5, by: ly.id }; clear();
  g.damageMob(m, ally, 100, {}); assert.equal(dealt(m, ally), 100, 'not from a lyre bard');
  // tweaks: War Drum Anthem +40%, Flute Dissonance cone +50%
  use(dr, 'anthem'); near(dr.song.until - g.time, SONG.anthem.dur * 1.4, 1e-9);
  done();
  const f2 = mk('bard', { style: 'flute' }), l2 = mk('bard', { dx: 30 });
  const fa = wolf(f2, 5, 0.9), la = wolf(l2, 5, 0.9);
  use(f2, 'dissonance'); use(l2, 'dissonance');
  assert.ok(dealt(fa, f2) > 0 && dealt(la, l2) === 0, 'Flute: wider Dissonance');
  done();
  ok('War Drum (shockwaves + Discord, party +10% on 3+ stacks, Anthem +40%) and Flute (16 m, 0.46 s, double stacks, wider Dissonance)');
}

// ---------- merchant, crafting, testing aid ----------
{
  const p = mk('bard'); p.x = MERCHANT.x; p.z = MERCHANT.z; p.gold = 1000;
  g.handle(p, { type: 'buy', i: SHOP.findIndex(s => s.alt) });
  assert.equal(p.inv.bag.at(-1).style, 'drum');
  const c = mk('lancer'); c.x = SMITH.x; c.z = SMITH.z + 2.5; c.gold = 1e5;
  c.inv.mats = { tusk: 99, pelt: 99, resin: 99, fang: 99, core: 99, horn: 99, dust: 99, ess: 99, prism: 99 };
  assert.equal(g.craft(c, 'fangglaive'), true);
  assert.equal(c.inv.bag.at(-1).style, 'glaive'); assert.equal(c.inv.bag.at(-1).name, 'Fangreach Glaive');
  assert.equal(g.craft(c, 'hidedrum'), false, 'another class\'s style recipe is refused');
  g.equip(c, c.inv.bag.at(-1).u); assert.equal(c.style, 'glaive');
  process.env.START_STYLE = 'warhammer';
  const z = g.addPlayer(null, 'Aid', 'berserker'), r = g.addPlayer(null, 'Aid2', 'ranger');
  assert.equal(z.style, 'warhammer'); assert.equal(r.style, 'longbow');
  delete process.env.START_STYLE;
  g.removePlayer(z); g.removePlayer(r);
  done();
  ok('merchant sells the alternate style (War Drum), Smith recipes are class-locked (Fangreach Glaive), START_STYLE=warhammer');
}

// ---------- persistence round trip (needs DATABASE_URL) ----------
async function persistence() {
  if (!process.env.DATABASE_URL) { console.log('  skip - persistence (set DATABASE_URL to run it)'); return; }
  const port = Number(process.env.PORT) || 3652, base = `http://localhost:${port}`;
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
  let srv = await start({ START_STYLE: 'halberd', BOT_STYLES: '' });
  try {
    const { token } = await post('/api/guest');
    const { character } = await post('/api/characters', { name: `Nc${Math.floor(realRandom() * 1e6)}`, cls: 'lancer' }, token);
    assert.ok(character?.id, 'character created');
    const s1 = await session(token, character.id);
    assert.equal(s1.inv.eq.weapon?.style, 'halberd'); assert.equal(s1.style, 'halberd');
    await new Promise(r => { s1.ws.on('close', r); s1.ws.close(); });
    await new Promise(r => setTimeout(r, 400));
    await stop(srv);
    srv = await start({ START_STYLE: '', BOT_STYLES: '' });
    const s2 = await session(token, character.id);
    s2.ws.close();
    assert.equal(s2.inv.eq.weapon?.style, 'halberd', 'style saved with the weapon'); assert.equal(s2.style, 'halberd');
    assert.equal(s2.inv.eq.weapon.name, s1.inv.eq.weapon.name);
    ok('persistence: a Lancer\'s Halberd survives a restart (guest account, Postgres)');
  } finally { await stop(srv); }
}

await persistence();
Math.random = realRandom;
console.log(`all ${n} checks passed`);
process.exit(0);
