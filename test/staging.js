// In-process checks for the scene director's staging hooks (server/staging.js, docs/ROADMAP.md F3).
// Usage: node test/staging.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WORLD, SWEEP, MOBS } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { RARITY, KEEPSAKE, MERCHANT } from '../shared/items.js';
import { SMITH } from '../shared/crafting.js';

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
function advance(dt) { // time + scheduled callbacks only (no AI)
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
const heal = () => { for (const p of g.players.values()) { p.dead = false; p.respawnAt = 0; p.hp = p.maxHp; } };

const W = g.boss, A = WORLD.arena;
const pell = g.addPlayer(null, 'Pell', 'swordsman'), bram = g.addPlayer(null, 'Bram', 'guardian'), corvin = g.addPlayer(null, 'Corvin', 'berserker');
for (const [p, dx] of [[pell, -3], [bram, 0], [corvin, 3]]) { p.x = A.x + dx; p.z = A.z - 2; p.lvl = 10; g.recompute(p); p.hp = p.maxHp; }
g.time = 10; clear();

// ---------- forceBossMove ----------
{
  for (const p of [pell, bram, corvin]) W.threat.set(p.id, 1);
  assert.equal(g.forceBossMove(W, 'horn_sweep', pell.id), true);
  assert.equal(ev('tele').filter(e => e.k === 'sweep').length, 1, 'sweep telegraph');
  const hp = pell.hp;
  advance(SWEEP.wind + 0.1);
  assert.ok(pell.hp < hp, 'the sweep lands like the real one');
  ok('horn_sweep: telegraph now, damage after its wind-up');

  for (const p of [pell, bram, corvin]) p.hp = p.maxHp;
  W.busyUntil = 0; clear();
  assert.equal(g.forceBossMove(W, 'slam', corvin.id), true);
  const slam = ev('tele').find(e => e.k === undefined);
  assert.ok(slam && Math.abs(slam.x - corvin.x) < 0.01 && Math.abs(slam.z - corvin.z) < 0.01, 'slam circle on the target');
  assert.equal(g.forceBossMove(W, 'charge', corvin.id), true);
  assert.equal(ev('tele').filter(e => e.k === 'line').length, 1);
  assert.equal(g.forceBossMove(W, 'quake', pell.id), true);
  assert.ok(ev('quake').length >= 1);
  assert.equal(g.forceBossMove(W, 'rockfall', pell.id), true);
  const rocks = ev('tele').filter(e => e.k === 'rock');
  assert.ok(rocks.length >= 3 + 3 && Math.abs(rocks[0].x - pell.x) < 0.01, 'rockfall: first circle on the target, one per fighter + strays');
  assert.equal(g.forceBossMove(W, 'tidal_wave', pell.id), false, 'not a Warden move');
  assert.equal(g.forceBossMove(W, 'nope'), false);
  advance(5); g.clearQuakes(); g.events = []; clear();
  W.x = A.x; W.z = A.z + 4;
  ok('slam / charge / quake / rockfall start at once; unknown moves return false');

  const S = g.sovereign, v = g.addPlayer(null, 'Juno', 'ranger');
  v.x = F2.arena.x; v.z = F2.arena.z - 6; S.threat.set(v.id, 1); S.engaged = true;
  assert.equal(g.forceBossMove(S, 'tidal_wave', v.id), true); assert.equal(ev('f2wave').length, 1);
  assert.equal(g.forceBossMove(S, 'geyser', v.id), true); assert.equal(ev('tele').filter(e => e.k === 'geyser').length, 1);
  assert.equal(g.forceBossMove(S.id, 'trident', v.id), true); assert.ok(S.windupAt > g.time && ev('wind').some(e => e.id === S.id));
  assert.equal(g.forceBossMove(S, 'deluge'), true); assert.equal(g.deluge, true);
  assert.equal(g.forceBossMove(S, 'slam', v.id), false);
  g.clearF2Fight(); S.windupAt = 0; S.engaged = false; S.threat.clear(); g.removePlayer(v); clear();
  ok('Sovereign: tidal_wave, geyser, trident, deluge');
}

// ---------- reserveLastAttack ----------
{
  advance(3); clear(); heal();
  W.hp = 300; W.staggerUntil = 0; W.posture = 0;
  g.reserveLastAttack(W, pell.id);
  for (let i = 0; i < 5; i++) g.damageMob(W, corvin, 5000, { heavy: true });
  assert.equal(W.dead, false); assert.equal(W.hp, 1, 'held at 1 HP');
  assert.ok(W.posture > 0 || W.staggerUntil > g.time, 'held hits still build posture (a Break can still happen)');
  g.hitCircle(bram, W.x, W.z, 8, 9999, {}); // a skill path (talent wrappers)
  g.killMob(W, corvin); // even a direct kill call
  assert.equal(W.dead, false); assert.equal(W.hp, 1);
  ok('a reserved Warden survives everyone else at 1 HP (damageMob, hitCircle, killMob)');

  const bag = pell.inv.bag.length;
  g.damageMob(W, pell, 10, {});
  assert.equal(W.dead, true, 'the reserved player kills it');
  const la = ev('la');
  assert.equal(la.length, 1); assert.equal(la[0].id, pell.id);
  assert.ok(pell.inv.bag.length > bag && pell.inv.bag.some(it => it.la), 'Last Attack Bonus item');
  assert.equal(W.laFor, null, 'cleared on death');
  ok('the reserved player lands the Last Attack (and gets the bonus); the reservation clears');

  const wolf = g.addMob('wolf', 0, 70);
  g.reserveLastAttack(wolf, pell.id); g.reserveLastAttack(wolf, null);
  g.damageMob(wolf, corvin, 99999, {});
  assert.equal(wolf.dead, true);
  ok('null clears a reservation');
  W.deadUntil = g.time; // let the Warden respawn for the next checks
}

// ---------- protect ----------
{
  heal(); const p = bram; p.iframeUntil = 0;
  g.protect(p, 0.1);
  g.damagePlayer(p, 1e6, { src: 'warden slam' });
  assert.equal(p.dead, false); assert.ok(p.hp >= Math.ceil(p.maxHp * 0.1) && p.hp <= Math.ceil(p.maxHp * 0.1));
  g.damagePlayer(p, 1e6, { peril: true, src: 'warden sweep' });
  assert.equal(p.dead, false, 'perilous hits too');
  g.protect(p, 0);
  g.damagePlayer(p, 1e6, { src: 'warden slam' });
  assert.equal(p.dead, true, 'protect 0 = off');
  p.respawnAt = 0; g.update(0.05); assert.equal(p.dead, false); p.hp = p.maxHp;
  p.x = A.x; p.z = A.z - 2;
  ok('protect: a health floor; 0 turns it off');
}

// ---------- scriptDeath / scriptRevive ----------
{
  clear(); heal();
  W.threat.set(bram.id, 5);
  const x = bram.x, z = bram.z;
  assert.equal(g.scriptDeath(bram, { respawn: false }), true);
  const d = ev('pdie').find(e => e.id === bram.id);
  assert.ok(d && d.stay === 1, 'pdie (death animation), marked as staying down');
  assert.ok(W.contributors.has(bram.id), 'counts as a fighter for the Hall');
  for (let i = 0; i < 400; i++) g.update(0.05); // 20 s of the full simulation
  assert.equal(bram.dead, true, 'never respawns'); assert.equal(bram.x, x); assert.equal(bram.z, z);
  ok('scriptDeath: dies the normal way and stays down where they fell');

  g.scriptRevive(bram);
  assert.equal(bram.dead, false); assert.equal(bram.hp, bram.maxHp); assert.equal(bram.x, x);
  ok('scriptRevive: back up on the spot');

  // a scripted death still makes the Hall of Clearers when the party kills the Warden
  let rec = null; g.onClear = r => { rec = r; };
  W.dead = false; W.hp = 50; W.contributors.clear();
  g.damageMob(W, corvin, 1, {});
  W.threat.set(bram.id, 5); g.scriptDeath(bram); // he held its attention (no hits of his own): still a fighter
  g.damageMob(W, pell, 99999, {});
  assert.ok(rec && rec.players.some(q => q.name === 'Bram'), 'Bram is on the clear');
  g.scriptRevive(bram);
  ok('a scripted-dead fighter is on the Hall of Clearers record');
}

// ---------- setTwistOverride ----------
{
  clear();
  g.setTwistOverride('off');
  assert.equal(g.twist, null, 'the current Warden has no twist');
  g.newTwist(); assert.equal(g.twist, null, 'the next spawn rolls none');
  g.setTwistOverride('echo'); assert.equal(g.twist.id, 'echo');
  g.newTwist(); assert.equal(g.twist.id, 'echo', 'forced on respawn too');
  assert.equal(g.setTwistOverride('bogus'), false);
  g.setTwistOverride(null); g.newTwist(); assert.ok(g.twist && g.twist.id !== 'echo', 'back to random');
  ok("twists: 'off', a forced id, null");
}

// ---------- spawnMob ----------
{
  const mom = g.spawnMob('matron', F2.arena.x - 40, F2.arena.z, { label: 'mom' });
  const lurk = g.spawnMob('lurker', F2.arena.x - 45, F2.arena.z, { label: 'lurk' });
  const boar = g.spawnMob('boar', 10, 50, { label: 'pig' });
  assert.ok(mom && lurk && boar); assert.equal(g.spawnMob('dragon', 0, 0), null);
  assert.equal(mom.label, 'mom'); assert.equal(g.stagedMob('lurk'), lurk); assert.equal(lurk.hidden, true, 'a lurker starts burrowed');
  assert.equal(mom.maxHp, MOBS.matron.hp);
  g.damageMob(boar, corvin, 99999, {});
  for (let i = 0; i < 400; i++) g.update(0.05);
  assert.equal(boar.dead, true, 'a staged spawn stays dead'); assert.ok(g.mobs.has(boar.id), 'and stays tracked');
  ok('spawnMob: any type (Mire Matron, Bog Lurker), labelled, tracked, no respawn');
}

// ---------- giveKeepsake ----------
{
  clear();
  const it = g.giveKeepsake(pell, { name: "Bram's Buckle", slot: 'charm', desc: 'Nobody gets left at the stop.' });
  assert.equal(it.r, KEEPSAKE); assert.equal(RARITY[it.r].id, 'keepsake'); assert.ok(RARITY[it.r].color);
  assert.deepEqual(it.st, {}); assert.equal(it.desc, 'Nobody gets left at the stop.'); assert.ok(pell.inv.bag.includes(it));
  assert.ok(ev('loot').some(e => e.to === pell.id && e.items[0].name === "Bram's Buckle"));
  const has = () => pell.inv.bag.includes(it);
  pell.x = MERCHANT.x; pell.z = MERCHANT.z;
  g.sell(pell, it.u); assert.ok(has(), 'not sold');
  g.discard(pell, it.u); assert.ok(has(), 'not deleted');
  g.dropItem(pell, it.u); assert.ok(has(), 'not dropped');
  pell.x = SMITH.x; pell.z = SMITH.z; pell.gold = 1e6; pell.inv.mats = { tusk: 99, fang: 99, pelt: 99, resin: 99, core: 99, ess: 99, horn: 99, dust: 99, prism: 99 };
  g.smith(pell, { a: 'salvage', u: it.u }); assert.ok(has(), 'not salvaged');
  g.smith(pell, { a: 'refine', u: it.u }); assert.ok(!it.lv, 'not refined');
  g.smith(pell, { a: 'reforge', u: it.u, mode: 'stats' }); assert.deepEqual(it.st, {});
  g.equip(pell, it.u); assert.equal(pell.inv.eq.charm, it, 'it can be worn');
  const full = Array.from({ length: 30 }, () => ({}));
  pell.inv.bag = full.slice(0, 24).map((_, i) => ({ u: 1e7 + i, slot: 'armor', r: 0, name: 'x', st: {} }));
  const it2 = g.giveKeepsake(pell, { name: 'Note', desc: 'x' }); assert.ok(pell.inv.bag.includes(it2), 'a full bag still takes it');
  assert.equal(JSON.parse(JSON.stringify(it2)).ks, 1, 'saved like any item (plain JSON)');
  ok('giveKeepsake: keepsake rarity, desc, no stats; never sold, deleted, dropped, salvaged, refined or reforged');
}

// ---------- clearStaging ----------
{
  const wolf = g.addMob('wolf', 0, 75);
  g.reserveLastAttack(wolf, pell.id); g.protect(corvin, 0.5); g.scriptDeath(bram); g.setTwistOverride('off');
  const mom = g.stagedMob('mom');
  g.clearStaging();
  assert.equal(bram.dead, false, 'the scripted dead get up');
  assert.equal(corvin.protectFrac, 0); assert.equal(wolf.laFor, null); assert.equal(g.twistOverride, null);
  assert.equal(g.mobs.has(mom.id), false, 'spawns removed');
  assert.ok(ev('die').some(e => e.id === mom.id));
  assert.equal(g.stagedMob('mom'), null);
  ok('clearStaging undoes everything');
}

console.log(`staging: ${n} checks passed`);
