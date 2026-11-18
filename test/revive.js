// In-process checks for downed + revive (server/revive.js, docs/ROADMAP.md G1).
// Usage: node test/revive.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WORLD } from '../shared/data.js';
import { DOWNED, reviveTime } from '../shared/revive.js';

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
// Time, scheduled callbacks and the downed / revive logic only (no mob AI).
function tick(secs) {
  const end = g.time + secs;
  while (g.time < end - 1e-9) {
    const dt = Math.min(0.05, end - g.time);
    g.time += dt;
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateDowned(dt);
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const stats = [];
g.teamStat = (p, key, k = 1) => stats.push([p.id, key, k]);
const kill = p => g.damagePlayer(p, p.maxHp * 50, { src: 'test', peril: true });
const fresh = (...ps) => { for (const p of ps) Object.assign(p, { dead: false, downed: null, reviving: null, respawnAt: 0, hp: p.maxHp, iframeUntil: 0, reviveN: 0, revT: -1e9, revFight: null }); };

// A field spot well away from town, mobs don't matter (no AI runs here).
const X = 40, Z = 60;
const mk = (name, cls, dx) => { const p = g.addPlayer(null, name, cls); p.x = X + dx; p.z = Z; p.lvl = 10; g.recompute(p); p.hp = p.maxHp; return p; };
const ana = mk('Ana', 'swordsman', 0), bo = mk('Bo', 'guardian', 1.5), cy = mk('Cy', 'cleric', -1.5), solo = mk('Solo', 'ranger', 30);
g.invite(ana, bo.id); g.accept(bo, ana.id);
g.invite(ana, cy.id); g.accept(cy, ana.id);
assert.ok(ana.party && ana.party === bo.party && bo.party === cy.party);
g.time = 100; clear();

// ---------- solo death is unchanged ----------
{
  kill(solo);
  assert.equal(solo.dead, true); assert.equal(!!solo.downed, false);
  assert.equal(ev('pdie').filter(e => e.id === solo.id).length, 1);
  assert.equal(ev('down').length, 0);
  ok('solo (no party): 0 HP is a normal death');
}

// ---------- downed ----------
{
  clear();
  kill(ana);
  assert.equal(ana.dead, false, 'downed is not dead');
  assert.ok(ana.downed, 'downed');
  assert.equal(ana.hp, 0);
  assert.equal(ev('pdie').filter(e => e.id === ana.id).length, 0, 'no death');
  const d = ev('down').find(e => e.id === ana.id);
  assert.ok(d && d.d === DOWNED.secs && d.src === 'test');
  const snap = JSON.parse(g.snapshot());
  const row = snap.down.find(r => r[0] === ana.id);
  assert.ok(row && row[1] > DOWNED.secs - 0.1 && row[2] === 0 && row[3] === 0, 'w.down row: [id, bleed left, progress, reviver]');
  // can't act
  const cds = [...ana.cds];
  g.handle(ana, { type: 'skill', slot: 0, face: 0 }); g.handle(ana, { type: 'skill', slot: 1, face: 0 });
  assert.deepEqual(ana.cds, cds, 'no skills while downed');
  g.handle(ana, { type: 'dodge', face: 0 }); assert.ok(g.time >= ana.rollUntil, 'no dodge');
  g.handle(ana, { type: 'jump' }); assert.ok(!(g.time < ana.airUntil), 'no jump');
  // crawl: a full-speed step is clamped
  const x0 = ana.x; ana.lastMoveT = g.time - 0.05;
  g.handle(ana, { type: 'input', x: ana.x + 1, z: ana.z, face: 0, seq: ana.posSeq });
  assert.ok(ana.x - x0 > 0 && ana.x - x0 <= DOWNED.crawl * 0.05 * 1.25 + 0.03, `crawls (moved ${(ana.x - x0).toFixed(3)} m)`);
  ana.x = x0;
  // healing does nothing without a channel; heal targeting skips the body
  assert.equal(g.healPlayer(ana, 500, cy, 'heal'), 0);
  assert.equal(ana.hp, 0);
  cy.hp = cy.maxHp; bo.hp = Math.round(bo.maxHp * 0.9);
  g.useSkill(cy, 1, 0); flush();
  const hf = events.filter(e => e.t === 'fx' && e.k === 'heal').pop();
  assert.ok(hf && hf.id === bo.id, 'Cleric Heal goes to the hurt standing ally, not the unrevived body');
  ok('0 HP with a partymate near: downed (alive, 0 HP, can\'t act, crawls, in w.down)');
}

// ---------- revive ----------
{
  clear(); stats.length = 0;
  bo.cds = [0, 0, 0, 0];
  g.handle(bo, { type: 'revive', on: 1, id: ana.id });
  assert.equal(bo.reviving?.id, ana.id);
  assert.equal(ana.downed.by, bo.id);
  assert.ok(ev('rev').find(e => e.id === ana.id && e.by === bo.id && !e.end));
  const left = ana.downed.until - g.time;
  tick(DOWNED.channel - 0.1);
  assert.ok(ana.downed, 'still channelling');
  assert.ok(Math.abs((ana.downed.until - g.time) - left) < 0.06, 'bleed-out paused while being revived');
  const row = JSON.parse(g.snapshot()).down.find(r => r[0] === ana.id);
  assert.ok(row[2] > 0.9 && row[3] === bo.id, 'progress in the snapshot');
  tick(0.15);
  assert.equal(ana.downed, null);
  assert.equal(ana.dead, false);
  assert.equal(ana.hp, Math.round(ana.maxHp * DOWNED.hp), 'up at 35%');
  assert.ok(ana.iframeUntil > g.time + DOWNED.iframe - 0.2, 'brief i-frame');
  assert.equal(bo.reviving, null);
  assert.ok(ev('revived').find(e => e.id === ana.id && e.by === bo.id));
  assert.deepEqual(stats, [[bo.id, 'revive', 1]], 'teamStat(reviver, "revive")');
  const hp = ana.hp; g.damagePlayer(ana, 50, { src: 'x' });
  assert.equal(ana.hp, hp, 'i-frame absorbs a hit');
  ok('hold E: 2.5 s channel, up at 35% HP with an i-frame, teamStat revive');
}

// ---------- anti-cheese: each revive in a fight takes longer ----------
{
  tick(DOWNED.iframe + 0.1); clear();
  kill(ana);
  assert.ok(ana.downed);
  assert.equal(ana.downed.need, reviveTime(1));
  assert.ok(reviveTime(1) > reviveTime(0) && reviveTime(2) > reviveTime(1));
  g.startRevive(bo, ana.id);
  tick(reviveTime(0) + 0.1);
  assert.ok(ana.downed, 'the second revive takes longer');
  tick(reviveTime(1) - reviveTime(0));
  assert.equal(ana.downed, null);
  // a new fight later resets the count
  ana.revT = g.time - DOWNED.fightGap - 1; tick(DOWNED.iframe + 0.1);
  kill(ana);
  assert.equal(ana.downed.need, reviveTime(0), 'count resets after a quiet spell');
  ok(`each revive in one fight is slower (${reviveTime(0)} s, ${reviveTime(1)} s, ${reviveTime(2)} s…)`);
}

// ---------- the channel breaks ----------
{
  clear();
  g.startRevive(bo, ana.id); tick(1);
  bo.x += DOWNED.leash + 0.5; tick(0.1);
  assert.equal(bo.reviving, null); assert.equal(ana.downed.by, 0);
  assert.ok(ev('rev').find(e => e.end), 'end event');
  const kept = ana.downed.prog;
  assert.ok(kept > 0.8 && kept < 1, 'a broken channel keeps its progress for a moment');
  tick(0.5); assert.ok(Math.abs(ana.downed.prog - (kept - 0.5)) < 0.06, '...fading at the channel\'s pace');
  tick(1); assert.equal(ana.downed.prog, 0);
  bo.x = X + 1.5;
  assert.equal(g.startRevive(bo, ana.id), true); tick(0.5);
  g.damagePlayer(bo, bo.maxHp * 0.3, { src: 'big', peril: true });
  assert.equal(bo.reviving, null, 'a heavy hit breaks it');
  bo.hp = bo.maxHp; bo.iframeUntil = 0;
  g.startRevive(bo, ana.id); tick(0.5);
  g.damagePlayer(bo, 2, { src: 'scratch', peril: true });
  assert.equal(bo.reviving?.id, ana.id, 'a scratch does not');
  bo.cds = [0, 0, 0, 0]; g.handle(bo, { type: 'skill', slot: 0, face: 0 });
  assert.equal(bo.reviving, null, 'attacking breaks it');
  g.startRevive(bo, ana.id); g.handle(bo, { type: 'revive', on: 0 });
  assert.equal(bo.reviving, null, 'releasing E stops it');
  assert.equal(g.startRevive(bo, 0), true, 'id 0: the nearest downed partymate');
  assert.equal(g.startRevive(cy, ana.id), false, 'one reviver at a time');
  g.stopRevive(bo);
  assert.equal(g.startRevive(solo, ana.id), false, 'not a partymate');
  cy.x = X + 10; assert.equal(g.startRevive(cy, ana.id), false, 'out of reach'); cy.x = X - 1.5;
  ok('moving away, a heavy hit, acting or releasing E breaks the channel (its progress fades); partymates in reach only');
}

// ---------- Cleric Heal speeds the channel ----------
{
  clear(); fresh(ana, bo, cy); tick(DOWNED.iframe + 0.1); ana.reviveN = 0;
  kill(ana);
  g.startRevive(bo, ana.id); tick(0.5);
  const before = ana.downed.prog;
  cy.cds = [0, 0, 0, 0]; bo.hp = bo.maxHp; cy.hp = cy.maxHp;
  g.useSkill(cy, 1, 0);
  assert.ok(ana.downed.prog > before + ana.downed.need * 0.3, 'a Heal on the body jumps the channel');
  tick(DOWNED.channel * (1 - DOWNED.heal) - 0.4);
  assert.equal(ana.downed, null, 'revived early');
  // the Cleric itself: its Heal doesn't break its own channel
  fresh(ana); tick(DOWNED.iframe + 0.1); clear();
  kill(ana);
  g.startRevive(cy, ana.id); tick(0.3);
  cy.cds = [0, 0, 0, 0]; g.useSkill(cy, 1, 0);
  assert.equal(cy.reviving?.id, ana.id, 'the Cleric keeps channelling');
  assert.ok(ana.downed.prog > 0.3 + ana.downed.need * 0.3);
  tick(2); assert.equal(ana.downed, null);
  ok('Cleric Heal on a downed ally speeds the channel (also the Cleric\'s own)');
}

// ---------- bleed-out ----------
{
  fresh(ana, bo, cy); tick(DOWNED.iframe + 0.1); clear();
  kill(ana);
  const until = ana.downed.until;
  g.damagePlayer(ana, ana.maxHp * 0.2, { src: 'bite' });
  const lost = Math.min(DOWNED.hitBleedMax, DOWNED.hitBleed * 0.2);
  assert.ok(Math.abs(until - ana.downed.until - lost) < 0.01, 'hits take bleed time off');
  assert.equal(ana.hp, 0);
  tick(DOWNED.secs - lost - 0.3);
  assert.ok(ana.downed && !ana.dead);
  tick(0.4);
  assert.equal(ana.dead, true); assert.equal(ana.downed, null);
  assert.ok(ana.respawnAt > g.time && ana.respawnAt < g.time + 5, 'normal respawn');
  assert.equal(ev('pdie').filter(e => e.id === ana.id).length, 1, 'one pdie, with the downing hit as the cause');
  assert.equal(ev('pdie').find(e => e.id === ana.id).src, 'test');
  ok('bleed-out after 15 s (hits shorten it) is a normal death and respawn');
}

// ---------- whole party down = wipe ----------
{
  fresh(ana, bo, cy); clear();
  kill(ana); kill(bo);
  assert.ok(ana.downed && bo.downed, 'two down, the Cleric still standing');
  kill(cy);
  assert.equal(cy.dead, true, 'the last one standing dies outright');
  tick(0.05);
  assert.ok(ana.dead && bo.dead && !ana.downed && !bo.downed, 'everyone downed bleeds out at once: a wipe');
  assert.equal(ev('pdie').length, 3);
  // also when the only one standing is far away (abandoned)
  fresh(ana, bo, cy); clear();
  cy.x = X + DOWNED.keep + 5;
  kill(ana); assert.ok(ana.downed, 'Bo is near');
  bo.x = X + DOWNED.keep + 5; tick(0.05);
  assert.ok(ana.dead, 'nobody standing within reach of help: bleeds out');
  fresh(ana, bo, cy); cy.x = X - 1.5; bo.x = X + 1.5;
  ok('whole party downed = wipe as today');
}

// ---------- bosses prefer standing players; no regen while down ----------
{
  clear();
  const W = g.boss;
  W.threat.clear(); W.threat.set(ana.id, 500); W.threat.set(bo.id, 200);
  kill(ana);
  assert.ok(W.threat.get(ana.id) < W.threat.get(bo.id), 'downed threat cut on bosses');
  ana.lastHurt = g.time - 20;
  for (const m of [...g.mobs.values()]) if (!m.def.boss) g.mobs.delete(m.id); // keep the field quiet
  W.x = WORLD.arena.x; W.z = WORLD.arena.z;
  for (let i = 0; i < 40; i++) g.update(0.05);
  assert.ok(ana.downed && ana.hp === 0, 'no regeneration while downed');
  W.threat.clear();
  g.startRevive(bo, ana.id);
  for (let i = 0; i < 60; i++) g.update(0.05);
  assert.equal(ana.downed, null, 'the full update loop runs the channel');
  ok('bosses turn to standing players; downed players don\'t regenerate');
}

// ---------- film safety ----------
{
  fresh(ana, bo, cy); clear();
  assert.equal(g.scriptDeath(ana, { respawn: false }), true);
  assert.equal(ana.dead, true); assert.equal(ana.downed, null);
  assert.equal(ana.respawnAt, Infinity);
  assert.equal(ev('down').length, 0, 'scripted deaths are instant deaths');
  tick(DOWNED.secs + 1);
  assert.equal(ana.dead, true, 'and stay down');
  assert.equal(g.scriptRevive(ana), true); assert.equal(ana.dead, false); assert.equal(ana.hp, ana.maxHp);
  // a downed player scripted dead: instant
  kill(bo); assert.ok(bo.downed);
  g.scriptDeath(bo); assert.ok(bo.dead && !bo.downed);
  g.scriptRevive(bo);
  // while a show runs, 0 HP is a death
  g.director = { running: true };
  kill(ana);
  assert.equal(ana.dead, true); assert.equal(ana.downed ?? null, null);
  g.director = null; g.clearStaging?.();
  fresh(ana, bo, cy);
  // scriptRevive also stands a downed player up
  kill(ana); assert.ok(ana.downed);
  assert.equal(g.scriptRevive(ana), true); assert.equal(ana.downed, null); assert.equal(ana.hp, ana.maxHp);
  ok('film safety: scriptDeath stays instant, no downed state while a show runs, scriptRevive works on downed');
}

console.log(`revive: ${n} checks passed`);
