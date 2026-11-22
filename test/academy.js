// The Academy (docs/briefs/academy.md): Initiates, class trials, drills, graduation, class changes, ranks, cohorts.
// 1. Pure rules (shared/academy.js). 2. In process: an Initiate's kit and power, the level-5 gate, a loaned kit, trials
// and drills that score for real, rewards once per tier, graduating, changing class keeps talents, a legacy character.
// 3. With DATABASE_URL: a server run (create an Initiate with a weapon, level to 5, pass a trial by test hook, graduate,
// the path survives a restart, a legacy character with path null loads unchanged). PORT (default 3941).
// Usage: node test/academy.js   (DATABASE_URL=postgresql://postgres:pg@localhost/fb_academy node test/academy.js)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

process.env.TEST_HOOKS = '1';
process.env.NAMED_ENABLED ??= '0';
const A = await import('../shared/academy.js');
const { pointsAt, TREES } = await import('../shared/talents.js');
const { CLASSES } = await import('../shared/data.js');
const { ACADEMY, penAt } = await import('../shared/academyyard.js');

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

// ---------------- 1. pure rules ----------------
{
  assert.deepEqual(A.WEAPON_IDS, ['sword', 'spear', 'bow', 'staff', 'wand']);
  for (const w of A.WEAPON_IDS) { const W = A.WEAPONS[w]; assert.ok(CLASSES[W.base] && W.leads.includes(W.base), w); for (const c of W.leads) assert.ok(A.TRIALS[c], `${w} leads to ${c}`); }
  assert.deepEqual([...new Set(A.WEAPON_IDS.flatMap(w => A.WEAPONS[w].leads))].sort(), Object.keys(CLASSES).sort(), 'every class is reachable from some weapon');
  ok('five weapons, each with a base class it leads to; every class reachable');

  const P = A.newPath('sword');
  assert.deepEqual([0, 1, 2].map(i => A.kitName(P, 'swordsman', i)), ['Strike', 'Lunge', 'Spin']);
  assert.equal(A.kitName({ ...P, stage: 'class' }, 'swordsman', 1), null, 'a graduate: the real names');
  assert.ok(A.kitLocked(P, 3) && !A.kitLocked(P, 2) && !A.kitLocked({ ...P, stage: 'class' }, 3) && !A.kitLocked(null, 3));
  assert.equal(A.pathLabel(P, 'swordsman'), 'Initiate · Sword');
  ok('Initiate kit: plain names, the level-3 skill locked, "Initiate · Sword"');

  assert.equal(A.medalFor(A.TRIALS.swordsman, 25, true), 2, 'low is better: 25 s is silver');
  assert.equal(A.medalFor(A.TRIALS.swordsman, 50, true), 0);
  assert.equal(A.medalFor(A.TRIALS.ranger, 8, true), 2);
  assert.equal(A.medalFor(A.TRIALS.cleric, 1, true), 1, 'the Ward Post alive is bronze');
  assert.equal(A.medalFor(A.DRILLS.windup, 0, true), 3, 'no hits taken: gold');
  ok('medals: bronze / silver / gold, lower-is-better scores');

  assert.equal(A.trialBlock(P, 'swordsman', 4), 'Class trials open at level 5.');
  assert.equal(A.trialBlock(P, 'guardian', 5), null);
  assert.match(A.trialBlock(P, 'ranger', 9), /doesn't lead/);
  assert.equal(A.trialBlock(null, 'ranger', 1), null, 'graduates (and legacy) may try any class');
  assert.match(A.gradBlock(P, 'guardian', 'swordsman', 5, 0), /Pass the Guardian trial/);
  assert.equal(A.gradBlock({ ...P, trials: { guardian: 1 } }, 'guardian', 'swordsman', 5, 0), null);
  assert.ok(A.gradBlock({ ...P, stage: 'class', trials: { guardian: 1 } }, 'guardian', 'swordsman', 10, 0), 'a class change costs gold');
  assert.equal(A.gradBlock({ ...P, stage: 'class', trials: { guardian: 1 } }, 'guardian', 'swordsman', 10, A.changeFee(10)), null);
  assert.equal(A.changeFee(10), 300);
  ok('gates: level 5, the weapon\'s classes, a passed trial to graduate, a fee to change class');

  assert.equal(A.rankOf({ trials: {}, drills: {} }, {}), 0);
  assert.equal(A.rankOf({ trials: { swordsman: 3, guardian: 3 }, drills: {} }, {}), 1, '6 points: Adept');
  assert.equal(A.rankOf({ trials: { swordsman: 3, guardian: 3, berserker: 3, lancer: 3, ranger: 3, cleric: 1 }, drills: {} }, {}), 1, 'Expert needs a floor');
  assert.equal(A.rankOf({ trials: { swordsman: 3, guardian: 3, berserker: 3, lancer: 3, ranger: 3, cleric: 1 }, drills: {} }, { wardenKills: 1 }), 2);
  assert.equal(A.rankName(0), 'Novice'); assert.equal(A.rankName(3), 'Master');
  ok('ranks: points from medals, floors cleared');

  assert.equal(A.gradStyle('guardian', 'spear'), 'spear'); assert.equal(A.gradStyle('guardian', 'sword'), 'shield'); assert.equal(A.gradStyle('cleric', 'wand'), 'wand');
  assert.deepEqual(A.cohortClasses('cleric', ['sword', 'spear']), ['guardian', 'lancer'], 'a healer gets a tank and damage');
  for (const w of A.WEAPON_IDS) assert.equal(A.COHORT[w].length, A.COHORT_MAX);
  assert.equal(A.cleanPath('x'), null);
  const c = A.cleanPath({ weapon: 'nope', stage: 'initiate', trials: { swordsman: 9, bogus: 2 }, cohort: [1, 'Ann', 'Bo', 'Cy'] });
  assert.equal(c.weapon, 'sword'); assert.deepEqual(c.trials, { swordsman: 3 }); assert.deepEqual(c.cohort, ['Ann', 'Bo']);
  ok('graduation styles, cohort classes, cleanPath');
}

// ---------------- 2. in process ----------------
const { Game } = await import('../server/game.js');
const g = new Game(); g.track = () => {};
const sock = () => ({ readyState: 1, send() {} });
const tick = (s) => { for (let i = 0; i < Math.round(s * 20); i++) g.update(0.05); };
const sysTo = p => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);
const atAcademy = p => g.teleport(p, ACADEMY.x + 3, ACADEMY.z);
const act = (p, m) => g.handle(p, { type: 'academy', ...m });
const join = (name, weapon, cls) => { g.joinWeapon = weapon || null; const p = g.addPlayer(sock(), name, cls); g.joinWeapon = null; p.testWard = false; return p; };
function runTrial(p, op, id) { act(p, { op, id }); assert.ok(p.trial, `${id} started (${sysTo(p).slice(-1)})`); tick(3.2); assert.ok(p.trial.spawned, 'spawned after the countdown'); return p.trial; }
const trialMobs = T => [...T.mobs].map(i => g.mobs.get(i)).filter(Boolean);
const finish = p => { tick(3); assert.equal(p.trial, null, 'home again'); };

{
  const ini = join('Ann', 'sword', 'swordsman'), grad = join('Gus', null, 'swordsman');
  assert.equal(ini.cls, 'swordsman'); assert.equal(ini.path.stage, 'initiate'); assert.equal(grad.path, null, 'a cls join: graduated (path null)');
  assert.equal(ini.inv.eq.weapon?.cls, 'swordsman', 'starter weapon');
  ini.inv.eq.weapon = grad.inv.eq.weapon = null; g.recompute(ini); g.recompute(grad);
  assert.ok(Math.abs(ini.atk - grad.atk * A.INITIATE.pow) < 0.01, `x0.85 attack (${ini.atk} vs ${grad.atk})`);
  ini.cds = [0, 0, 0, 0]; g.useSkill(ini, 3); assert.equal(ini.cds[3], 0, 'the level-3 skill does nothing');
  assert.equal(g.classTitle(ini), 'Initiate · Sword'); assert.equal(g.classTitle(grad), 'Swordsman');
  assert.equal(g.talentsMsg(ini).locked, 1); assert.ok(!g.talentsMsg(grad).locked);
  g.handle(ini, { type: 'talent', op: 'spend', id: 'sw_edge' }); assert.ok(!Object.keys(ini.talents).length, 'no spending');
  assert.deepEqual(g.rosterPath(ini), { ini: 'sword' });
  ok('an Initiate: base class, starter weapon, x0.85 attack, no level-3 skill, talents locked, roster "ini"');

  // the level-5 gate, then a loaned kit
  atAcademy(ini); ini.lvl = 4; g.recompute(ini);
  act(ini, { op: 'trial', id: 'guardian' }); assert.equal(ini.trial, undefined ?? ini.trial); assert.ok(!ini.trial && /level 5/.test(sysTo(ini).at(-1)));
  g.giveXp(ini, 1e5); assert.ok(ini.lvl >= 5);
  assert.ok(g.events.some(e => e.t === 'trial' && e.op === 'open' && e.to === ini.id), 'the level-5 notice');
  act(ini, { op: 'trial', id: 'ranger' }); assert.ok(!ini.trial, 'a sword does not lead to the Ranger');
  const T = runTrial(ini, 'trial', 'guardian');
  assert.equal(ini.cls, 'guardian'); assert.ok(ini.loan && ini.loan.cls === 'swordsman'); assert.ok(penAt(ini.x, ini.z));
  assert.ok(!g.kitLocked(ini, 3), 'the full kit on loan'); assert.equal(g.talentsMsg(ini).locked, 1);
  assert.equal(trialMobs(T).length, 3); assert.ok(trialMobs(T).every(m => m.trial === ini.id && m.def.xp === 0));
  assert.ok(g.meFor(ini).ac && g.meFor(ini).ac.w === 100, 'the HUD data');
  assert.ok(!g.validTarget(trialMobs(T)[0], grad), 'training mobs ignore everyone else');
  { const w = trialMobs(T)[0], hp = w.hp; g.damageMob(w, grad, 1e4); assert.equal(w.hp, hp, 'and nobody else can hurt them'); }
  act(ini, { op: 'leave' }); finish(ini);
  assert.equal(ini.cls, 'swordsman'); assert.equal(ini.loan, null); assert.ok(!penAt(ini.x, ini.z)); assert.ok(!ini.path.trials.guardian);
  ok('level 5 opens trials (with a notice); a trial loans the full kit in a pen; leaving gives it back, no medal');

  // Swordsman: Break, then bring it down
  ini.testWard = true;
  let S = runTrial(ini, 'trial', 'swordsman'); const golem = trialMobs(S)[0];
  g.killMob(golem, ini); assert.ok(g.mobs.has(golem.id) && golem.hp === 1, 'not before a Break');
  g.breakMob(golem, ini); g.killMob(golem, ini);
  assert.ok(S.endAt && S.medal === 3, `fast: gold (${S.medal})`); finish(ini);
  assert.equal(ini.path.trials.swordsman, 3); assert.equal(ini.cls, 'swordsman');
  // Berserker: fell six
  S = runTrial(ini, 'trial', 'berserker'); assert.equal(trialMobs(S).length, 6);
  for (const m of trialMobs(S)) g.killMob(m, ini);
  assert.equal(S.medal, 3); finish(ini);
  ok('Swordsman (Break first, then the kill) and Berserker (six dummies) score and pay medals');

  // a drill: Read the Wind-up passes with no hits after its 30 s; rewards once per tier
  const gold0 = ini.gold, tonic0 = ini.inv.cons.tonic | 0, dr0 = ini.inv.cons.draught | 0;
  S = runTrial(ini, 'drill', 'windup'); tick(31); assert.ok(S.endAt, 'the clock ends it');
  assert.equal(S.medal, 3, `no hits: gold (${S.hits})`); finish(ini);
  assert.equal(ini.gold - gold0, 175); assert.equal((ini.inv.cons.tonic | 0) - tonic0, 1); assert.equal((ini.inv.cons.draught | 0) - dr0, 1);
  runTrial(ini, 'drill', 'windup'); g.handle(ini, { type: 'test', trialWin: 3 }); finish(ini);
  assert.equal(ini.gold - gold0, 175, 'paid once');
  // Revive Under Fire: stand by the fallen dummy
  ini.testWard = true; S = runTrial(ini, 'drill', 'revive');
  for (let k = 0; k < 2; k++) { g.teleport(ini, S.fx, S.fz); tick(3.2); }
  assert.ok(S.score >= 2, `two revives (${S.score})`); act(ini, { op: 'leave' }); finish(ini);
  ok('drills: Read the Wind-up (no hits: gold), rewards once per tier (175 gold, a tonic, a draught), Revive Under Fire counts');

  // the Ward Post falls without heals (Cleric trial, a staff Initiate)
  const cl = join('Cleo', 'staff', 'cleric'); g.giveXp(cl, 1e5); atAcademy(cl); cl.testWard = true;
  S = runTrial(cl, 'trial', 'cleric'); tick(30); assert.ok(S.endAt && !S.medal, 'no heals: the Ward Post falls'); finish(cl);
  S = runTrial(cl, 'trial', 'cleric');
  for (let k = 0; k < 30; k++) { g.healPlayer(cl, cl.maxHp * 0.4, cl); tick(1); }
  assert.ok(S.medal >= 2, `healing keeps it up (${S.medal}, ${S.score}%)`); finish(cl);
  ok('Cleric: the Ward Post falls without heals; your heals mend it');

  // graduate as a Guardian (Sword & Shield), talents open with every banked point; change class keeps talents
  atAcademy(ini);
  act(ini, { op: 'graduate', cls: 'guardian' }); assert.equal(ini.path.stage, 'initiate', 'no Guardian pass yet');
  runTrial(ini, 'trial', 'guardian'); g.handle(ini, { type: 'test', trialWin: 1 }); finish(ini);
  act(ini, { op: 'graduate', cls: 'guardian' });
  assert.equal(ini.cls, 'guardian'); assert.equal(ini.path.stage, 'class'); assert.ok(ini.inv.eq.weapon.cls === 'guardian' && !ini.inv.eq.weapon.style, 'Sword & Shield (the default style)');
  assert.ok(!g.talentsMsg(ini).locked && g.talentsMsg(ini).pts === pointsAt(ini.lvl), 'all the banked points');
  assert.ok(!g.kitLocked(ini, 3)); assert.equal(g.classTitle(ini), 'Guardian');
  assert.ok(ini.path.keep.swordsman, 'the Initiate kit\'s mastery kept');
  g.handle(ini, { type: 'talent', op: 'spend', id: TREES.guardian.bot[0] }); const gTal = JSON.stringify(ini.talents); assert.ok(gTal !== '{}', 'talents spent');
  ini.gold = 1e4;
  act(ini, { op: 'change', cls: 'swordsman' }); assert.equal(ini.cls, 'swordsman'); assert.equal(ini.gold, 1e4 - A.changeFee(ini.lvl));
  act(ini, { op: 'change', cls: 'guardian' }); assert.equal(ini.cls, 'guardian'); assert.equal(JSON.stringify(ini.talents), gTal, 'Guardian talents back');
  act(ini, { op: 'weapon', w: 'bow' }); assert.equal(ini.path.weapon, 'sword', 'graduates use no armory');
  ok('graduate: class, shield weapon, talents open with every point; change class for gold keeps talents per class');

  // armory (free, Initiates only) and a legacy character
  const sp = join('Spe', 'spear', 'lancer'); atAcademy(sp);
  act(sp, { op: 'weapon', w: 'wand' }); assert.equal(sp.cls, 'cleric'); assert.equal(sp.inv.eq.weapon.style, 'wand'); assert.equal(sp.path.weapon, 'wand');
  atAcademy(grad); act(grad, { op: 'talk', cls: 'ranger' });
  assert.ok(g.events.some(e => e.t === 'chat' && e.head && e.from === 'Tovin'), 'the Ranger hall\'s head talks');
  assert.equal(grad.path, null, 'talking leaves a legacy character alone');
  grad.lvl = 5; act(grad, { op: 'trial', id: 'ranger' }); assert.ok(grad.trial, 'a legacy character may try any trial');
  act(grad, { op: 'leave' }); finish(grad); assert.equal(grad.cls, 'swordsman'); assert.equal(grad.path?.stage, 'class');
  ok('armory changes the weapon and base class for free; heads talk; a legacy character gets a graduated path on its first trial');
}

// ---------------- 2b. review fixes: no minting, own keys only, no spam, solo trials, honest scoring ----------------
{
  const { sellPrice, BAG_SIZE, makeItem } = await import('../shared/items.js');
  const { salvageYield } = await import('../shared/crafting.js');
  const { BotManager } = await import('../server/botmanager.js');
  const { inYard } = await import('../shared/academyyard.js');
  const q = join('Quin', 'sword', 'swordsman'); atAcademy(q); q.testWard = true;
  // switching weapon mints nothing of value: the swapped-out Academy weapon goes back, nothing is sold
  const gold0 = q.gold, bag0 = q.inv.bag.length;
  assert.ok(q.inv.eq.weapon.ac, 'the starter is an Academy weapon');
  for (let k = 0; k < 12; k++) { tick(5.1); act(q, { op: 'weapon', w: A.WEAPON_IDS[(k + 1) % 5] }); }
  assert.equal(q.gold, gold0, 'no gold from switching'); assert.equal(q.inv.bag.length, bag0, 'no weapons pile up');
  assert.ok(q.inv.eq.weapon.ac && sellPrice(q.inv.eq.weapon) === 0 && salvageYield(q.inv.eq.weapon) === null, 'worth nothing, no salvage');
  const ww = q.inv.eq.weapon; q.inv.eq.weapon = null; q.inv.bag.push(ww);
  g.dropItem(q, ww.u); assert.ok(q.inv.bag.includes(ww), 'not dropped');
  g.teleport(q, 9, 3); g.sell(q, ww.u); assert.ok(q.inv.bag.includes(ww) && q.gold === gold0, 'not sold');
  q.inv.bag.pop(); q.inv.eq.weapon = ww; atAcademy(q);
  // the cooldown
  tick(5.1); const w1 = q.path.weapon, w2 = w1 === 'bow' ? 'staff' : 'bow';
  act(q, { op: 'weapon', w: w2 }); act(q, { op: 'weapon', w: w1 }); assert.equal(q.path.weapon, w2, 'a second change right away waits');
  // a full bag with a real weapon in hand: refused, nothing sold (switching, graduating)
  const epic = makeItem('weapon', 3, q.cls, () => 0.5, undefined, A.WEAPONS[w2].style === 'longbow' || A.WEAPONS[w2].style === 'staff' ? undefined : A.WEAPONS[w2].style);
  q.inv.eq.weapon = epic; while (q.inv.bag.length < BAG_SIZE) q.inv.bag.push(makeItem('armor', 0, undefined, () => 0.5));
  tick(5.1); act(q, { op: 'weapon', w: 'sword' });
  assert.equal(q.path.weapon, w2, 'refused'); assert.equal(q.inv.eq.weapon, epic); assert.equal(q.gold, gold0);
  assert.match(sysTo(q).at(-1), /bag is full/);
  q.path.trials[A.WEAPONS[w2].leads[0]] = 1; act(q, { op: 'graduate', cls: A.WEAPONS[w2].leads[0] });
  assert.equal(q.path.stage, 'initiate', 'graduating with a full bag: refused'); assert.equal(q.inv.eq.weapon, epic, 'the Epic is not sold');
  q.inv.bag.length = 0;
  ok('weapon changes mint nothing (Academy weapons: no sale, salvage or drop), wait 5 s, and a full bag refuses instead of selling');

  // prototype keys: never a lookup hit, never a throw
  const before = q.path.weapon, n0 = g.events.length;
  for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    act(q, { op: 'talk', cls: bad }); act(q, { op: 'weapon', w: bad }); act(q, { op: 'drill', id: bad }); act(q, { op: 'trial', id: bad });
    act(q, { op: 'graduate', cls: bad }); act(q, { op: 'change', cls: bad });
  }
  act(q, { op: 'talk', cls: { toString: null } }); g.academyAction(q, null);
  assert.equal(q.path.weapon, before); assert.ok(!q.trial, 'no trial started'); assert.ok(!g.events.slice(n0).some(e => e.t === 'chat'), 'no head talked');
  assert.equal(A.cleanPath({ weapon: 'toString', stage: 'initiate' }).weapon, 'sword');
  assert.equal(A.newPath('constructor').weapon, 'sword'); assert.equal(A.trialBlock(null, 'constructor', 9), 'No such trial.');
  assert.equal(A.gradBlock({ trials: { constructor: 3 } }, 'constructor', 'swordsman', 9, 1e6), 'No such class.');
  assert.equal(A.headOf('constructor'), null); assert.equal(A.weaponOfClass('constructor'), 'sword'); assert.equal(A.gradStyle('constructor', 'toString'), '');
  { g.joinWeapon = 'toString'; const z = g.addPlayer(sock(), 'Zed', 'swordsman'); g.joinWeapon = null; assert.equal(z.path, null); assert.equal(z.cls, 'swordsman'); }
  const gr = join('Gra', null, 'guardian'); gr.lvl = 9; atAcademy(gr); act(gr, { op: 'trial', id: 'constructor' }); assert.ok(!gr.trial && gr.cls === 'guardian');
  ok('ids like "constructor" / "toString" are refused everywhere (talk, weapon, trial, drill, graduate, change, paths, joins)');

  // no spam: 'state' sends the path only; talking has a cooldown
  act(q, { op: 'state' }); g.rosterDirty = false; q.dirty = false; q.pathDirty = false; act(q, { op: 'state' }); // (the first one enrols)
  assert.ok(q.pathDirty && !g.rosterDirty && !q.dirty, 'state: the path message only');
  const c0 = g.events.length; for (let k = 0; k < 5; k++) act(q, { op: 'talk', cls: 'ranger' });
  assert.equal(g.events.slice(c0).filter(e => e.t === 'chat').length, 1, 'one line per cooldown');
  ok('no spam: "state" neither rebroadcasts the roster nor saves; heads talk once per cooldown');

  // trials stay solo: followers are sent to the Academy's door, never into the pen
  const fol = { x: 0, z: 40 }, mgr = Object.create(BotManager.prototype); mgr.game = { teleport: (p2, x, z) => { p2.x = x; p2.z = z; } };
  const pen = { x: A.PENS[1].cx, z: A.PENS[1].z0 + 4 };
  mgr.catchUp(fol, pen); assert.ok(!inYard(fol.x, fol.z) && Math.hypot(fol.x - ACADEMY.x, fol.z - ACADEMY.z) < 12, `at the door (${fol.x}, ${fol.z})`);
  const fx0 = fol.x; mgr.catchUp(fol, pen); assert.equal(fol.x, fx0, 'already there: stays');
  ok('bots following a trialist wait at the Academy door (catchUp)');

  // scoring: Guardian wolves can't be killed; Lancer counts only its own tip-of-reach thrusts
  const gu = join('Gwen', 'sword', 'swordsman'); g.giveXp(gu, 1e5); atAcademy(gu); gu.testWard = true;
  let S = runTrial(gu, 'trial', 'guardian');
  for (const m of trialMobs(S)) for (let k = 0; k < 5; k++) g.damageMob(m, gu, 1e6);
  assert.equal(trialMobs(S).length, 3, 'the wolves never fall'); act(gu, { op: 'leave' }); finish(gu);
  const la = join('Lan', 'spear', 'lancer'); g.giveXp(la, 1e5); atAcademy(la); la.testWard = true;
  S = runTrial(la, 'trial', 'lancer');
  const d = trialMobs(S)[0];
  g.teleport(la, d.x, d.z - 6); for (let k = 0; k < 10; k++) g.damageMob(d, la, 5);
  assert.equal(S.score, 0, 'plain damage (areas, DoTs) does not count');
  g.teleport(la, d.x, d.z - (2.6 + d.def.radius)); la.face = 0;
  g.spearLine(la, 4.6, 0.6, 5, {}); assert.equal(S.score, 1, 'a tip-of-reach thrust counts');
  g.teleport(la, d.x, d.z - (1.0 + d.def.radius)); g.spearLine(la, 4.6, 0.6, 5, {}); assert.equal(S.score, 1, 'a close thrust does not');
  act(la, { op: 'leave' }); finish(la);
  ok('Guardian: the wolves never fall (hold them, don\'t kill them); Lancer: only tip-of-reach thrusts score');
}

// ---------------- 3. the server and the database ----------------
const DB = process.env.DATABASE_URL;
if (!DB) { console.log('# skipped the server run: set DATABASE_URL (a local test database, never production)'); console.log(`1..${n}`); process.exit(0); }
const PORT = Number(process.env.PORT) || 3941, BASE = `http://localhost:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await import('../server/db.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function until(fn, ms = 8000, what = 'condition') { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); } throw new Error(`timed out: ${what}`); }
function client(joinMsg) {
  const c = { last: {}, sys: [], roster: null };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify(joinMsg)));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString()); c.last[m.type] = m;
    if (m.type === 'welcome') c.id = m.id;
    if (m.type === 'snap') for (const e of m.w?.events || []) if (e.t === 'sys' && (!e.to || e.to === c.id)) c.sys.push(e.text);
    if (m.type === 'roster') c.roster = m.players;
  });
  c.send = m => c.ws.send(JSON.stringify(m));
  c.closed = new Promise(r => c.ws.on('close', r));
  return c;
}
let srv = null;
async function start() {
  srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), TEST_HOOKS: '1', NAMED_ENABLED: '0', SAVE_EVERY: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost:\d+/.test(d) && res()); srv.on('exit', rej); setTimeout(res, 10000); });
}
async function stop() { if (!srv) return; const s = srv; srv = null; s.kill('SIGTERM'); await new Promise(r => { s.on('exit', r); setTimeout(r, 5000); }); }
try {
  await db.migrate();
  const [col] = await db.q(`SELECT data_type FROM information_schema.columns WHERE table_name = 'characters' AND column_name = 'path'`);
  assert.equal(col?.data_type, 'jsonb'); ok('migration adds characters.path (JSONB)');
  await start();
  const { token } = (await call('POST', '/api/guest')).body; assert.ok(token);
  const tag = String(Date.now() % 1e6);
  assert.equal((await call('POST', '/api/characters', token, { name: `Ini${tag}` })).status, 400, 'no weapon: refused');
  for (const bad of [{ weapon: 'toString' }, { weapon: 'constructor' }, { cls: 'constructor' }, { cls: '__proto__' }]) assert.equal((await call('POST', '/api/characters', token, { name: `Bad${tag}`, ...bad })).status, 400, JSON.stringify(bad));
  const made = await call('POST', '/api/characters', token, { name: `Ini${tag}`, weapon: 'spear' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const cid = made.body.character?.id ?? made.body.id;
  let [row] = await db.q('SELECT cls, path FROM characters WHERE id = $1', [cid]);
  assert.equal(row.cls, 'lancer'); assert.equal(row.path.stage, 'initiate'); assert.equal(row.path.weapon, 'spear');
  ok('create with a weapon: an Initiate · Spear (base class Lancer)');
  // a legacy character (made before the Academy: path null)
  const [{ id: legId }] = await db.q(`INSERT INTO characters (account_id, name, cls) SELECT account_id, $2, 'ranger' FROM characters WHERE id = $1 RETURNING id`, [cid, `Old${tag}`]);

  let c = client({ type: 'join', session: token, character: cid });
  await until(() => c.last.path, 8000, 'path message');
  assert.equal(c.last.path.ini, 1); assert.equal(c.last.path.cls, 'lancer');
  await until(() => c.last.talents, 5000, 'talents'); assert.equal(c.last.talents.locked, 1);
  c.send({ type: 'test', xp: 5000 });
  await until(() => c.last.snap?.me?.lvl >= 5, 5000, 'level 5');
  c.send({ type: 'test', tp: [ACADEMY.x + 3, ACADEMY.z] }); await sleep(300);
  c.send({ type: 'academy', op: 'state' });
  await until(() => c.last.path?.path?.enrolled, 5000, 'enrolled');
  c.send({ type: 'academy', op: 'trial', id: 'lancer' });
  await until(() => c.last.snap?.me?.ac?.id === 'lancer', 5000, 'trial running');
  assert.equal(c.last.path.loan, 1);
  { // an admin edit while the kit is on loan would write the loan back over the real one: refused until the trial ends
    const adminTok = (await call('POST', '/api/guest')).body.token, me = await call('GET', '/api/admin/me', adminTok);
    await db.q('UPDATE accounts SET is_admin = true WHERE id = $1', [me.body.account.id]);
    const r = await call('PATCH', `/api/admin/characters/${cid}`, adminTok, { gold: 777 });
    assert.equal(r.status, 409, JSON.stringify(r.body));
  }
  c.send({ type: 'test', trialWin: 2 });
  await until(() => c.last.path?.path?.trials?.lancer === 2 && !c.last.path.loan, 5000, 'silver');
  ok('over the socket: level 5, enrolled at the Academy, a Lancer trial on loan (admin edits refused meanwhile), a silver medal by test hook; bad ids refused at creation');
  await until(() => c.roster?.filter(r => r.ini && r.owner).length === 2, 10000, 'two classmates in the roster');
  ok('two cohort classmates joined as Initiates');
  await until(() => c.last.path && !c.last.path.trial, 8000, 'home (the trial over)');
  c.send({ type: 'academy', op: 'graduate', cls: 'lancer' });
  await until(() => c.last.path?.ini === 0 && c.last.path.path.stage === 'class', 5000, `graduated (${c.sys.slice(-3).join(' | ')})`);
  await until(() => c.last.talents && !c.last.talents.locked, 5000, 'talents open');
  await until(() => c.roster?.filter(r => r.owner && !r.ini).length === 2, 10000, 'classmates graduated');
  ok('graduated as a Lancer: talents open; the classmates graduated too');
  c.ws.close(); await c.closed; await sleep(800);
  [row] = await db.q('SELECT cls, path FROM characters WHERE id = $1', [cid]);
  assert.equal(row.cls, 'lancer'); assert.equal(row.path.stage, 'class'); assert.equal(row.path.trials.lancer, 2); assert.equal(row.path.cohort.length, 2);
  ok('saved: class, stage, medals, classmates');

  await stop(); await start();
  c = client({ type: 'join', session: token, character: cid });
  await until(() => c.last.path, 8000, 'path after restart');
  assert.equal(c.last.path.ini, 0); assert.equal(c.last.path.cls, 'lancer'); assert.equal(c.last.path.path.trials.lancer, 2);
  c.ws.close(); await c.closed;
  const o = client({ type: 'join', session: token, character: legId });
  await until(() => c.last.path && o.last.path && o.last.snap?.me, 8000, 'legacy join');
  assert.equal(o.last.path.path, null); assert.equal(o.last.path.cls, 'ranger'); assert.equal(o.last.path.ini, 0);
  await until(() => o.last.talents, 5000); assert.ok(!o.last.talents.locked);
  o.ws.close(); await o.closed; await sleep(800);
  [row] = await db.q('SELECT cls, path FROM characters WHERE id = $1', [legId]);
  assert.equal(row.cls, 'ranger'); assert.equal(row.path, null);
  ok('after a restart the path is there; a legacy character (path null) loads and saves unchanged');
} finally {
  await stop();
  await db.close?.();
}
console.log(`1..${n}`);
process.exit(0);
