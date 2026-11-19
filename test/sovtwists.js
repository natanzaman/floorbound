// In-process checks for the harder Drowned Sovereign (docs/ROADMAP.md H1): its twists (server/sovtwists.js), the
// Warden-style health / damage scaling (server/floor2.js scaleSovereign), the Deluge call and the director-show scaling.
// Usage: node test/sovtwists.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { MOBS } from '../shared/data.js';
import { F2, SOVEREIGN, SOV_TWISTS, SOV_TWIST_IDS } from '../shared/floor2.js';

const g = new Game();
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const flush = () => { const e = g.events; g.events = []; return e; };
function advance(dt) { // time + scheduled callbacks + the Floor 2 hazards (waves, pools, Deluge); no AI
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateFloor2(0.05);
  }
}
const S = g.sovereign, A = F2.arena;
const party = (classes, lvl = 18) => {
  for (const p of [...g.players.values()]) g.removePlayer(p);
  return classes.map((c, i) => { const p = g.addPlayer(null, `P${i}`, c); p.x = A.x + i - classes.length / 2; p.z = A.z - 8; p.lvl = lvl; g.recompute(p); p.hp = p.maxHp; return p; });
};
g.time = 10; flush();

// ---------- the twist table ----------
{
  assert.ok(SOV_TWIST_IDS.length >= 5, 'a twist pool');
  for (const id of SOV_TWIST_IDS) {
    g.setTwist2(id);
    assert.equal(g.twist2.id, id); assert.ok(g.sovS, 'an attack table');
    assert.ok(SOV_TWISTS[id].reward.loot || SOV_TWISTS[id].reward.gold, `${id} pays a reward`);
    assert.equal(flush().filter(e => e.t === 'twist2' && e.id === id).length, 1, 'announced to clients');
  }
  g.setTwist2('hightide'); assert.ok(g.sovS.wave.every[0] > 0 && g.sovS.wave.every[1] < SOVEREIGN.wave.every[1], 'High Tide: waves from phase 1, more often');
  g.setTwist2('moonless'); assert.ok(Math.abs(g.sovS.geyser.wind - SOVEREIGN.geyser.wind * 0.85) < 0.01 && g.sovS.wave.wind < SOVEREIGN.wave.wind, 'Moonless: less warning');
  g.setTwist2('drownedhost'); assert.equal(g.sovS.thralls.max, SOV_TWISTS.drownedhost.thralls.max);
  g.setTwist2(null); assert.equal(g.twist2, null); assert.deepEqual(g.sovS.wave, SOVEREIGN.wave);
  let prev = 'riptide', repeat = 0;
  for (let i = 0; i < 40; i++) { g.twist2 = { id: prev }; g.newTwist2(); if (g.twist2.id === prev) repeat++; prev = g.twist2.id; }
  assert.equal(repeat, 0, 'never the same twist twice in a row');
  g.setTwist2('riptide'); g.setTwistOverride('off'); assert.equal(g.twist2, null, "setTwistOverride('off') turns it off (director shows)");
  g.newTwist2(); assert.equal(g.twist2, null, '... and it rolls none while off'); g.setTwistOverride(null);
  flush();
  ok('twist pool: every twist builds its attack table and announces itself; no repeats; off');
}

// ---------- scaling ----------
{
  const hp = cls => { party(cls); S.engaged = false; g.scaleSovereign(S); return { hp: S.maxHp, atk: S.def.atk }; };
  const trio = hp(['guardian', 'swordsman', 'cleric']), six = hp(['guardian', 'ranger', 'berserker', 'lancer', 'bard', 'cleric']);
  const w3 = 0.6 + 1.2 + 0.5;
  assert.equal(trio.hp, Math.round(SOVEREIGN.hpBase + SOVEREIGN.hpPer * Math.pow(w3, SOVEREIGN.hpExp)), 'trio health from role weight');
  assert.ok(six.hp > trio.hp * 2, 'six fighters: much more health');
  assert.equal(trio.atk, MOBS.sovereign.atk); assert.ok(Math.abs(six.atk - MOBS.sovereign.atk * (1 + SOVEREIGN.atkPer * 3)) < 0.1, 'more damage past 3 fighters');
  party(['guardian', 'swordsman', 'cleric'], 20); g.scaleSovereign(S);
  assert.ok(S.maxHp > trio.hp && S.def.atk > trio.atk, 'levels above 18 scale it up');
  const dir0 = g.director; g.director = { running: true }; // a filmed show (server/director.js) keeps the scaling its episodes were rehearsed with
  party(['guardian', 'swordsman', 'cleric']); g.scaleSovereign(S);
  assert.equal(S.maxHp, SOVEREIGN.show.hpBase + SOVEREIGN.show.hpPer * 3); assert.equal(S.def.atk, SOVEREIGN.show.atk);
  g.setTwist2('riptide'); g.twistEngage2(S); assert.equal(g.twist2, null, 'and fights without a twist');
  g.director = dir0;
  ok('health from role weight and level, damage past 3 fighters; director shows keep the old scaling');
}

// ---------- Riptide, Brackish, Coral Hide ----------
{
  const [p] = party(['swordsman']); S.engaged = true; S.dead = false; S.x = A.x; S.z = A.z + 4; flush();
  g.setTwist2('riptide'); g.tidalWave(S);
  const waves = flush().filter(e => e.t === 'f2wave');
  assert.equal(waves.length, 2); assert.equal(waves[1].n, 2);
  assert.ok(Math.abs(waves[1].d - waves[0].d - SOV_TWISTS.riptide.gap) < 0.01, 'the second wall comes gap s later');
  assert.ok(SOV_TWISTS.riptide.gap > 1.4, 'room to roll into both (the dodge is ready again)');
  g.waves = [];
  g.setTwist2('brackish'); g.pools = [];
  g.f2Circle(S, A.x + 5, A.z, 3, 0.5, 10, 'geyser'); advance(0.6);
  assert.equal(g.pools.length, 1, 'a geyser leaves a mire pool');
  g.setTwist2('coralhide'); S.staggerUntil = 0;
  assert.equal(g.twistTaken(S), SOV_TWISTS.coralhide.taken, 'Coral Hide: less damage');
  S.staggerUntil = g.time + 2; assert.equal(g.twistTaken(S), 1, '... unless Broken');
  g.setTwist2(null); assert.equal(g.twistTaken(S), 1, 'no armour without the twist');
  g.clearF2Fight(); g.pools = []; p.hp = p.maxHp;
  ok('Riptide: two waves; Brackish: geyser pools; Coral Hide: armour unless Broken');
}

// ---------- the Deluge call ----------
{
  const [p] = party(['guardian']); p.x = A.x; p.z = A.z - (SOVEREIGN.deluge.r + 4); // out in the flood zone
  S.engaged = true; S.dead = false; g.setTwist2(null); g.deluge = false; flush();
  g.callDeluge(S);
  const call = flush().find(e => e.t === 'f2fx' && e.k === 'dcall');
  assert.ok(call && call.d === SOVEREIGN.deluge.wind && call.r === SOVEREIGN.deluge.r, 'the call telegraph (flood line to the safe ring)');
  assert.ok(S.busyUntil >= g.time + SOVEREIGN.deluge.wind - 1e-9, 'the Sovereign holds its pose while it calls');
  let snap = g.f2Snap(); assert.equal(snap.dcall, 1); assert.equal(snap.del, 0);
  const hp0 = p.hp; advance(SOVEREIGN.deluge.wind - 0.1);
  assert.equal(p.hp, hp0, 'no flood damage during the call');
  advance(0.3); assert.ok(p.hp < hp0, 'then the flood hurts outside the ring');
  for (let i = 0; i < 12; i++) { advance(0.05); snap = g.f2Snap(); assert.equal(snap.del, 1, 'the flood stays up between ticks'); assert.equal(snap.dcall, 0); }
  g.clearF2Fight(); S.engaged = false;
  ok('Deluge: called with a wind-up, no damage until it lands, then a steady flood');
}

// ---------- twist reward ----------
{
  const [p] = party(['ranger']); g.setTwist2('moonless');
  const bag = p.inv.bag.length, gold = p.gold;
  g.twistKill2(S, [p.id]);
  assert.equal(p.inv.bag.length, bag + SOV_TWISTS.moonless.reward.loot, 'extra loot rolls');
  assert.ok(p.gold > gold, 'extra gold');
  ok('kill under a twist pays its reward');
}
console.log(`sovtwists: ${n} ok`);
process.exit(0);
