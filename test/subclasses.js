// Subclasses (docs/briefs/subclasses.md): specialisation at level 15, two per class, a signature skill in slot 5.
// 1. Pure rules (shared/subclasses.js, the talent nodes, cleanPath, the control). 2. In process: specialising at the
// Academy, slot 5, the fee, the talent nodes, the level-15 notice, every signature skill; the hidden path's server
// enforcement. 3. Bots and the Named. 4. With DATABASE_URL: a server run (an Initiate graduates, reaches 15,
// specialises, uses slot 5, still specialised after a restart; an old character and an Initiate unchanged). PORT (3571).
// Usage: node test/subclasses.js   (DATABASE_URL=postgresql://postgres:pg@localhost/fb_subclass node test/subclasses.js)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

process.env.TEST_HOOKS = '1';
process.env.NAMED_ENABLED ??= '0';
const S = await import('../shared/subclasses.js');
const { SPEC, SUBCLASSES, SUB_IDS, HIDDEN } = S;
const { TREES, TALENTS, newTalents, allocError, spendBlock, nodeDef, pointsAt } = await import('../shared/talents.js');
const { CLASSES } = await import('../shared/data.js');
const { cleanPath } = await import('../shared/academy.js');
const { ACADEMY, LECTERN } = await import('../shared/academyyard.js');
const { ACTION, DEFAULTS, validate } = await import('../shared/controls.js');
const { NAMED } = await import('../shared/named.js');
const { SIG_FNS } = await import('../server/subclasses.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

// ---------------- 1. pure rules ----------------
{
  assert.equal(SUB_IDS.length, 14);
  for (const cls of Object.keys(CLASSES)) {
    const subs = S.subsOf(cls);
    assert.equal(subs.length, 2, cls);
    assert.notEqual(SUBCLASSES[subs[0]].branch, SUBCLASSES[subs[1]].branch, `${cls}: two different branches`);
  }
  assert.equal(new Set(S.SIG_IDS).size, 14, 'signature skill ids are unique');
  for (const id of SUB_IDS) {
    const D = SUBCLASSES[id], sk = D.skill;
    assert.ok(TREES[D.cls].branches.some(b => b.id === D.branch), `${id}: its branch exists`);
    assert.ok(sk.name && sk.desc && sk.cd > 0 && sk.key === 'sig' && sk.lvl === SPEC.lvl, `${id}: a complete skill`);
    assert.ok(!CLASSES[D.cls].skills.some(s => s.id === sk.id), `${id}: not one of the class's own ids`);
    assert.equal(typeof SIG_FNS[sk.id], 'function', `${id}: has its code`);
    assert.ok(['melee', 'ranged', 'crowd', 'party', 'heal', 'buff'].includes(sk.bot?.use), `${id}: a bot rule`);
    const nodes = TREES[D.cls].branches.find(b => b.id === D.branch).nodes.filter(x => x.sub === id);
    assert.deepEqual(nodes.map(x => [x.tier, x.x]), [[2, -1], [2, 1]], `${id}: two nodes, tier 2 left and right`);
  }
  for (const [cls, sub] of Object.entries(S.BOT_SUB)) assert.equal(SUBCLASSES[sub].cls, cls);
  assert.deepEqual(Object.keys(S.BOT_SUB).sort(), Object.keys(CLASSES).sort(), 'a bot subclass for every class');
  ok('14 subclasses, two per class on two branches; each has a signature skill with code, a bot rule and two tier-2 nodes');

  assert.equal(S.specFee(15), 500); assert.equal(S.specFee(20), 600);
  const grad = { stage: 'class', trials: { swordsman: 1 } }, ini = { stage: 'initiate', trials: {} };
  assert.match(S.specBlock(ini, 'swordsman', 20, 'duelist', 0), /Graduate/);
  assert.match(S.specBlock(null, 'swordsman', 20, 'duelist', 0), /Graduate/, 'a null path is the caller\'s job (a stand-in)');
  assert.match(S.specBlock(grad, 'swordsman', 14, 'duelist', 0), /level 15/);
  assert.equal(S.specBlock(grad, 'swordsman', 15, 'duelist', 0), null, 'the first pick is free');
  assert.match(S.specBlock(grad, 'swordsman', 15, 'bulwark', 1e6), /not a specialisation/);
  for (const bad of ['constructor', 'toString', '__proto__', '', 'hasOwnProperty']) assert.ok(S.specBlock(grad, 'swordsman', 20, bad, 1e6), bad);
  const has = { ...grad, subs: { swordsman: 'duelist' } };
  assert.match(S.specBlock(has, 'swordsman', 20, 'duelist', 1e6), /already/);
  assert.match(S.specBlock(has, 'swordsman', 20, 'vanguard', 599), /600 gold/);
  assert.equal(S.specBlock(has, 'swordsman', 20, 'vanguard', 600), null);
  ok('specBlock: graduates from level 15, own class only, free first pick, a fee to change (200 + 20 / level); bad ids refused');

  assert.deepEqual(S.cleanSubs({ swordsman: 'duelist', guardian: 'duelist', cleric: 'toString', bogus: 'reaver', ranger: HIDDEN.id }), { swordsman: 'duelist', ranger: HIDDEN.id });
  assert.deepEqual(S.cleanSubs('x'), {}); assert.deepEqual(S.cleanSubs(['duelist']), {});
  assert.deepEqual(S.cleanBorrow({ swordsman: { c: 'cleric', sk: S.borrowable('cleric')[0], br: TREES.cleric.branches[0].id }, guardian: { c: 'guardian', sk: 'taunt', br: 'x' }, lancer: { c: 'constructor' } }),
    { swordsman: { c: 'cleric', sk: S.borrowable('cleric')[0], br: TREES.cleric.branches[0].id } });
  const cp = cleanPath({ stage: 'class', weapon: 'sword', trials: { swordsman: 2 }, subs: { swordsman: 'duelist' }, found: 1, wb: { swordsman: { c: 'cleric', sk: S.borrowable('cleric')[1], br: TREES.cleric.branches[1].id } } });
  assert.deepEqual(cp.subs, { swordsman: 'duelist' }); assert.equal(cp.found, 1); assert.equal(cp.wb.swordsman.c, 'cleric');
  const cp0 = cleanPath({ stage: 'class', weapon: 'sword', trials: {} });
  assert.ok(!cp0.found && !Object.keys(cp0.subs || {}).length, 'an old path: nothing new appears');
  ok('cleanSubs / cleanBorrow drop anything foreign; cleanPath keeps subs, found and the borrow record');

  // talents: a subclass's nodes need that subclass, its tier-1 node above, and the usual points; they open no tier
  const tempo = TREES.swordsman.branches.find(b => b.id === 'tempo');
  const t1 = tempo.nodes.filter(x => x.tier === 1), du = tempo.nodes.filter(x => x.sub === 'duelist');
  const base = { sw_feet: 2, sw_roll: 3, [t1[0].id]: 2, [t1[1].id]: 2 }; // 9 points above tier 2 (needs 6)
  const left = du.find(x => x.x === -1), right = du.find(x => x.x === 1);
  assert.match(allocError('swordsman', { ...base, [left.id]: 1 }, 40), /specialisation/);
  assert.equal(allocError('swordsman', { ...base, [left.id]: 1 }, 40, 'duelist'), null);
  assert.match(allocError('swordsman', { ...base, [left.id]: 1 }, 40, 'vanguard'), /specialisation/);
  assert.match(allocError('swordsman', { sw_feet: 2, sw_roll: 3, [left.id]: 1 }, 40, 'duelist'), /needs/, 'its tier-1 node first');
  assert.match(spendBlock('swordsman', base, 40, right.id), /specialisation/);
  assert.equal(spendBlock('swordsman', base, 40, right.id, 'duelist'), null);
  const kept = newTalents({ ...base, [left.id]: 3, [right.id]: 2 }, 'swordsman', 40, 'duelist');
  assert.equal(kept[left.id], 3);
  const dropped = newTalents({ ...base, [left.id]: 3 }, 'swordsman', 40, null);
  assert.ok(!dropped[left.id] && dropped.sw_feet === 2, 'without the subclass: its nodes go, the rest stays');
  const deep = tempo.nodes.find(x => x.tier === 3);
  const onlySub = { sw_feet: 2, sw_roll: 3, [t1[0].id]: 1, [t1[1].id]: 1, [left.id]: 3, [right.id]: 2 }; // 7 + 5 in sub nodes
  assert.match(allocError('swordsman', { ...onlySub, sw_tempo: 1, [deep.id]: 1 }, 40, 'duelist'), /tiers above/, 'sub nodes open no tier');
  assert.equal(nodeDef(left.id)?.sub, 'duelist');
  ok('talents: sub nodes need the subclass and their tier-1 node; dropped without it; they count toward no tier gate');

  const tot = S.borrowedTotals({ c: 'guardian', sk: 'taunt', br: 'bulwark' });
  const t0 = TREES.guardian.branches.find(b => b.id === 'bulwark').nodes.filter(x => x.tier === 0);
  for (const nd of t0) for (const e of nd.fx) if (e.stat) assert.ok(Math.abs(tot.stat[e.stat] - e.v * nd.max * HIDDEN.tierPow) < 0.05, `${nd.id}: ${tot.stat[e.stat]}`);
  assert.deepEqual(S.borrowedTotals(null), { stat: {}, sk: {}, aura: {} });
  for (const c of Object.keys(CLASSES)) assert.equal(S.borrowable(c).length, 2, `${c}: two borrowable skills`);
  assert.ok(!S.canFind({ stage: 'class', trials: { swordsman: 1, guardian: 1 } }, 14));
  assert.ok(!S.canFind({ stage: 'class', trials: { swordsman: 1, guardian: 0 } }, 20), 'two different passed trials');
  assert.ok(!S.canFind({ stage: 'initiate', trials: { swordsman: 1, guardian: 1 } }, 20));
  assert.ok(S.canFind({ stage: 'class', trials: { swordsman: 1, guardian: 3 } }, 15));
  ok('the hidden path\'s rules: found by a graduate of 15+ with two trials; it borrows a tier-0 branch at 80%');

  assert.ok(ACTION.skill4 && ACTION.skill4.group === 'Combat');
  assert.equal(DEFAULTS.kbm.skill4[0], 'KeyX'); assert.equal(DEFAULTS.pad.skill4[0], 'LB+RT');
  for (const dev of ['kbm', 'pad']) assert.deepEqual(validate(DEFAULTS[dev], dev), [], `${dev} defaults are clean`);
  ok('controls: skill4 (X, pad LB+RT), no conflicts in the defaults');

  // never advertised: the client, the guide, the README and the story never name the hidden path
  const files = [...readdirSync(path.join(root, 'public')).filter(f => /\.(js|html|css)$/.test(f)).map(f => path.join('public', f)), 'README.md', 'docs/NEXT.md'];
  for (const f of files) {
    const txt = readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/wanderer/i.test(txt), `${f} names the hidden path`);
    assert.ok(!/own road/i.test(txt), `${f}: its text`);
  }
  for (const d of Object.values(NAMED)) assert.ok(!/wanderer/i.test(JSON.stringify(d)), `${d.id}: story text`);
  ok('the hidden path is named nowhere players read (public/, README, NEXT, the Named)');
}

// ---------------- 2. in process ----------------
const { Game } = await import('../server/game.js');
const g = new Game(); g.track = () => {};
const sock = () => ({ readyState: 1, send() {} });
const tick = s => { for (let i = 0; i < Math.round(s * 20); i++) g.update(0.05); };
const sysTo = p => g.events.filter(e => e.t === 'sys' && (e.to === p.id)).map(e => e.text);
const atAcademy = p => g.teleport(p, ACADEMY.x + 3, ACADEMY.z);
const act = (p, m) => g.handle(p, { type: 'academy', ...m });
const join = (name, cls, lvl, weapon = null) => {
  g.joinWeapon = weapon; const p = g.addPlayer(sock(), name, cls); g.joinWeapon = null;
  if (lvl) { p.lvl = lvl; g.recompute(p); p.hp = p.maxHp; }
  return p;
};
const field = (p) => { g.teleport(p, 0, 80); const m = g.addMob('wolf', 0, 82); m.hp = m.maxHp = 1e5; return m; };

{
  const p = join('Duel', 'swordsman', 16);
  assert.equal(p.cds.length, 5, 'five cooldowns');
  assert.ok(!g.pathMsg(p).spec.sub && g.pathMsg(p).spec.opts.length === 2, 'two options, none picked');
  g.teleport(p, 0, 80); act(p, { op: 'specialise', sub: 'duelist' });
  assert.ok(!S.subOf(p.path, 'swordsman'), 'only at the Academy');
  atAcademy(p); p.gold = 0;
  act(p, { op: 'specialise', sub: 'reaver' }); assert.ok(!S.subOf(p.path, 'swordsman'), 'not my class');
  act(p, { op: 'specialise', sub: 'duelist' });
  assert.equal(p.path.subs.swordsman, 'duelist'); assert.equal(p.gold, 0, 'free');
  assert.equal(p.path.stage, 'class', 'a legacy character gets a graduated path');
  assert.ok(g.events.some(e => e.t === 'spec' && e.id === p.id && e.sub === 'duelist'));
  assert.equal(g.meFor(p).sub, 'duelist'); assert.equal(g.rosterPath(p).sub, 'duelist');
  const spec = g.pathMsg(p).spec; assert.equal(spec.sub, 'duelist'); assert.equal(spec.sig.name, 'Flash Step'); assert.ok(!('hid' in spec));
  assert.ok(p.cds[4] > g.time, 'a short cooldown after picking');
  // slot 5
  const m = field(p); tick(SPEC.cdOnPick + 0.5);
  const hp0 = m.hp; g.handle(p, { type: 'skill', slot: 4, face: 0 }); tick(1.5);
  assert.ok(m.hp < hp0, 'Flash Step hits'); const cd = p.cds[4] - g.time;
  assert.ok(cd > 14 && cd <= 18, `its cooldown (${cd})`);
  const hp1 = m.hp; g.handle(p, { type: 'skill', slot: 4, face: 0 }); tick(0.2); assert.equal(m.hp, hp1, 'not again while cooling down');
  g.mobs.delete(m.id);
  // talents: sub nodes spend with the subclass; a change refunds them and costs gold
  for (const id of ['sw_feet', 'sw_feet', 'sw_roll', 'sw_roll', 'sw_roll', 'sw_rush', 'sw_riposte', 'sw_riposte', 'sw_du_feint', 'sw_du_sig'])
    g.handle(p, { type: 'talent', op: 'spend', id });
  assert.equal(p.talents.sw_du_feint, 1); assert.equal(p.talents.sw_du_sig, 1);
  assert.ok((p.tal.sk.sig?.cd || 0) < 0, 'its talent shortens the signature cooldown');
  atAcademy(p); p.gold = S.specFee(p.lvl) - 1; act(p, { op: 'specialise', sub: 'vanguard' });
  assert.equal(p.path.subs.swordsman, 'duelist', 'too little gold'); assert.match(sysTo(p).at(-1), /gold/);
  p.gold = S.specFee(p.lvl) + 5; act(p, { op: 'specialise', sub: 'vanguard' });
  assert.equal(p.path.subs.swordsman, 'vanguard'); assert.equal(p.gold, 5);
  assert.ok(!p.talents.sw_du_feint && !p.talents.sw_du_sig && p.talents.sw_feet === 2, 'the Duelist nodes came back as points');
  assert.equal(g.pathMsg(p).spec.sig.name, 'Rallying Cut');
  ok('specialise at the Academy: free first pick, slot 5 fires with its cooldown, sub talents, a paid change refunds the nodes');

  // gates: under 15, an Initiate, a trial's loan
  const low = join('Low', 'guardian', 14); atAcademy(low); act(low, { op: 'specialise', sub: 'bulwark' });
  assert.ok(!S.subOf(low.path, 'guardian'), 'under 15'); assert.match(sysTo(low).at(-1), /level 15/);
  g.handle(low, { type: 'skill', slot: 4, face: 0 }); assert.equal(low.cds[4], 0, 'no slot 5 yet');
  const ini = join('Ini', 'swordsman', 0, 'sword'); g.giveXp(ini, 1e7); atAcademy(ini);
  act(ini, { op: 'specialise', sub: 'duelist' }); assert.ok(!S.subOf(ini.path, 'swordsman'), 'an Initiate cannot');
  assert.ok(ini.lvl >= 15 && !sysTo(ini).some(t => /you can specialise/.test(t)), 'no level-15 notice for an Initiate');
  const up = join('Up', 'ranger', 14); up.path = { stage: 'class', weapon: 'bow', trials: { ranger: 1 }, drills: {}, keep: {}, cohort: [] };
  g.giveXp(up, 1e5); assert.ok(sysTo(up).some(t => /Level 15: you can specialise/.test(t)), 'a graduate hears it at 15');
  assert.ok(up.pathDirty, 'the path message goes again');
  ok('gates: level 15, graduates only (Initiates refused, no notice), the level-15 notice for graduates');

  // every signature skill fires and sets its cooldown
  for (const id of SUB_IDS) {
    const D = SUBCLASSES[id], q = join(`T${id.slice(0, 10)}`, D.cls, 18);
    atAcademy(q); act(q, { op: 'specialise', sub: id }); assert.equal(q.path.subs[D.cls], id);
    const mob = field(q); tick(SPEC.cdOnPick + 0.2); q.hp = q.maxHp * 0.5;
    g.handle(q, { type: 'skill', slot: 4, face: 0 }); tick(1.5);
    assert.ok(q.cds[4] > g.time, `${id}: cooldown set`); assert.ok(Number.isFinite(mob.hp) && Number.isFinite(q.hp), `${id}: no NaN`);
    g.mobs.delete(mob.id); g.removePlayer(q);
  }
  ok('all 14 signature skills fire in the field and set slot 5\'s cooldown');

  // a class change keeps one subclass per class
  const cc = join('Cc', 'swordsman', 20); atAcademy(cc); act(cc, { op: 'specialise', sub: 'duelist' });
  cc.path.trials.guardian = 1; cc.path.trials.swordsman = 1; cc.gold = 1e5;
  act(cc, { op: 'change', cls: 'guardian' }); assert.equal(cc.cls, 'guardian');
  assert.ok(!g.sigDef(cc), 'the Guardian is not specialised yet'); act(cc, { op: 'specialise', sub: 'warlord' });
  act(cc, { op: 'change', cls: 'swordsman' }); assert.equal(g.sigDef(cc).name, 'Flash Step', 'the Duelist is back');
  assert.deepEqual(cc.path.subs, { swordsman: 'duelist', guardian: 'warlord' });
  ok('changing class keeps each class\'s subclass');
}

// ---------------- 2b. the hidden path: server enforcement ----------------
{
  const atLectern = p => g.teleport(p, LECTERN.x, LECTERN.z);
  const w = join('Wan', 'swordsman', 16);
  w.path = { stage: 'class', weapon: 'sword', trials: { swordsman: 2 }, drills: {}, keep: {}, cohort: [] };
  const borrow = { c: 'cleric', sk: S.borrowable('cleric')[0], br: TREES.cleric.branches[0].id };
  atAcademy(w); w.gold = 1e5;
  act(w, { op: 'specialise', sub: HIDDEN.id, borrow }); assert.ok(!S.subOf(w.path, 'swordsman'), 'not found: refused');
  assert.match(sysTo(w).at(-1), /No such path/);
  atLectern(w); tick(0.1); act(w, { op: 'lectern' });
  assert.ok(!w.path.found, 'one trial: the book is too faded'); assert.match(sysTo(w).at(-1), /faded/);
  w.path.trials.cleric = 1; tick(3.1); g.teleport(w, 0, 80); act(w, { op: 'lectern' }); assert.ok(!w.path.found, 'only at the lectern');
  atLectern(w); act(w, { op: 'lectern' }); assert.equal(w.path.found, 1, 'found');
  assert.ok(g.pathMsg(w).spec.hid, 'the option is sent once found');
  assert.ok(!JSON.stringify(g.pathMsg(join('Nob', 'swordsman', 16)).spec).includes(HIDDEN.id), 'and never before');
  atAcademy(w);
  for (const bad of [{ c: 'swordsman', sk: 'rush', br: 'tempo' }, { c: 'ranger', sk: S.borrowable('ranger')[0], br: TREES.ranger.branches[0].id }, { c: 'cleric', sk: CLASSES.cleric.skills[3].id, br: borrow.br }, { c: 'cleric', sk: CLASSES.cleric.skills[0].id, br: borrow.br }, { c: 'cleric', sk: borrow.sk, br: 'nope' }, { c: 'constructor', sk: 'x', br: 'y' }, null]) {
    act(w, { op: 'specialise', sub: HIDDEN.id, borrow: bad }); assert.ok(!S.subOf(w.path, 'swordsman'), `refused: ${JSON.stringify(bad)}`);
  }
  const lo = join('Lo', 'swordsman', 14); lo.path = { ...w.path, trials: { ...w.path.trials } }; atAcademy(lo);
  act(lo, { op: 'specialise', sub: HIDDEN.id, borrow }); assert.ok(!S.subOf(lo.path, 'swordsman'), 'under 15');
  const atk0 = w.atk;
  act(w, { op: 'specialise', sub: HIDDEN.id, borrow });
  assert.equal(w.path.subs.swordsman, HIDDEN.id); assert.deepEqual(w.path.wb.swordsman, borrow);
  assert.equal(w.gold, 1e5, 'the first pick is free');
  assert.ok(!('sub' in g.meFor(w)) && !('sub' in g.rosterPath(w)), 'it never shows on plates, lists or me.sub');
  assert.ok(!g.pathMsg(w).spec.sub, 'nor as the picked subclass');
  assert.ok(w.atk >= atk0, 'the borrowed tier adds');
  const sig = g.sigDef(w); assert.equal(sig.borrow, 'cleric'); assert.equal(sig.id, borrow.sk);
  // the borrowed skill: the other class's code, 80% power, the real class back after
  const m = field(w); tick(SPEC.cdOnPick + 0.2); w.hp = w.maxHp * 0.5;
  let pow = null; const orig = g.skillPow; g.skillPow = function (pp, ...a) { const v = orig.call(this, pp, ...a); if (pp === w && w._borrowing) pow = { v, cls: w.cls }; return v; };
  g.handle(w, { type: 'skill', slot: 4, face: 0 }); g.skillPow = orig; tick(1);
  assert.equal(w.cls, 'swordsman'); assert.ok(!w._borrowing); assert.ok(w.cds[4] > g.time, 'slot 5 cools down');
  assert.equal(w.cds[1], 0, 'the swordsman\'s own slot 2 untouched');
  if (pow) assert.equal(pow.cls, 'cleric', 'ran as the other class');
  g.mobs.delete(m.id);
  // a non-graduate, or no found flag via the admin path record, is refused even with a forged record
  const f = join('Forge', 'swordsman', 16); f.path = { stage: 'class', weapon: 'sword', trials: { swordsman: 1, cleric: 1 }, drills: {}, keep: {}, cohort: [], subs: { swordsman: HIDDEN.id }, wb: { swordsman: borrow } };
  assert.equal(g.subOfP(f), null, 'a pick without the found flag does nothing'); assert.equal(g.sigDef(f), null);
  ok('the hidden path: the lectern needs a graduate of 15+ with two trials; until found every pick is refused; bad borrows refused; 80% via the other class\'s code; never shown');
}

// ---------------- 3. bots and the Named ----------------
{
  const { sigTurn } = await import('../shared/bots/subclass.js');
  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const wolf = (x, z, extra = {}) => ({ x, z, hp: 100, maxHp: 100, def: { radius: 0.8, ...extra } });
  const mk = (sub, mobs, party = []) => { const used = []; const b = { x: 0, z: 0, t: 1, me: { sub, lvl: 20 }, cds: [0, 0, 0, 0, 0], mobs, hp: 100, maxHp: 100, engAt: null, send: m => used.push(m) }; b.used = used; return { b, ctx: { d2, party: { all: party }, dodge: false } }; };
  let { b, ctx } = mk('duelist', [wolf(0, 3)]);
  assert.ok(sigTurn(b, b.mobs[0], ctx), 'Duelist: a target in reach');
  ({ b, ctx } = mk('duelist', [wolf(0, 30)])); assert.ok(!sigTurn(b, b.mobs[0], ctx), 'not from 30 m');
  ({ b, ctx } = mk('reaver', [wolf(0, 2)])); assert.ok(!sigTurn(b, b.mobs[0], ctx), 'Reaver: one wolf is not a crowd');
  ({ b, ctx } = mk('reaver', [wolf(0, 2), wolf(1, 2)])); assert.ok(sigTurn(b, b.mobs[0], ctx), 'two: a crowd');
  ({ b, ctx } = mk('lightbringer', [wolf(0, 8)], [{ hp: 90, maxHp: 100 }, { hp: 95, maxHp: 100 }])); assert.ok(!sigTurn(b, b.mobs[0], ctx), 'a healthy party: no Dawnburst');
  ({ b, ctx } = mk('lightbringer', [wolf(0, 8)], [{ hp: 30, maxHp: 100 }])); assert.ok(sigTurn(b, b.mobs[0], ctx), 'a partymate low: Dawnburst');
  ({ b, ctx } = mk('', [wolf(0, 2)])); assert.ok(!sigTurn(b, b.mobs[0], ctx), 'no subclass: nothing');
  ({ b, ctx } = mk('duelist', [wolf(0, 2)])); b.cds[4] = 3; assert.ok(!sigTurn(b, b.mobs[0], ctx), 'cooling down');
  ok('bots: sigTurn uses slot 5 when its rule fits (reach, crowd, a hurt party) and not otherwise');

  const bot = join('Rob', 'cleric', 14); bot.bot = true;
  assert.equal(g.botSpecialise(bot), false, 'under 15: not yet');
  bot.lvl = 15; assert.equal(g.botSpecialise(bot), true); assert.equal(g.meFor(bot).sub, 'lightbringer');
  assert.equal(g.botSpecialise(bot, HIDDEN.id), false, 'never the hidden pick'); assert.equal(g.botSpecialise(bot, 'reaver'), false, 'never another class\'s');
  const runner = (() => { process.env.START_LEVEL = '18'; g.joinSub = 'sharpshooter'; try { return g.addPlayer(sock(), 'Run', 'ranger'); } finally { g.joinSub = null; delete process.env.START_LEVEL; } })();
  assert.equal(g.meFor(runner).sub, 'sharpshooter', 'an anonymous bot join with a subclass');
  for (const d of Object.values(NAMED)) if (d.sub) assert.equal(SUBCLASSES[d.sub]?.cls, d.cls, `${d.id}: its subclass fits its class`);
  assert.deepEqual(Object.values(NAMED).filter(d => d.sub).map(d => d.id).sort(), ['cairn', 'halvard', 'maribel', 'sennet', 'tovin']);
  const dir = readFileSync(path.join(root, 'server/director.js'), 'utf8');
  assert.ok(!/botSpecialise|joinSub/.test(dir), 'director actors are left alone');
  ok('premade bots specialise by role at 15 (never the hidden pick); runners join specialised; the Named have fitting subclasses; the director is untouched');
}

// ---------------- 4. the server and the database ----------------
const DB = process.env.DATABASE_URL;
if (!DB) { console.log('# skipped the server run: set DATABASE_URL (a local test database, never production)'); console.log(`1..${n}`); process.exit(0); }
const PORT = Number(process.env.PORT) || 3571, BASE = `http://localhost:${PORT}`;
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
  await start();
  const { token } = (await call('POST', '/api/guest')).body; assert.ok(token);
  const tag = String(Date.now() % 1e6);
  const mk = async (name, body) => { const r = await call('POST', '/api/characters', token, { name, ...body }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.character?.id ?? r.body.id; };
  const cid = await mk(`Spec${tag}`, { weapon: 'spear' });
  const iniId = await mk(`Ini${tag}`, { weapon: 'sword' });
  const [{ id: oldId }] = await db.q(`INSERT INTO characters (account_id, name, cls, lvl, talents) SELECT account_id, $2, 'ranger', 20, '{"rg_aim":1}'::jsonb FROM characters WHERE id = $1 RETURNING id`, [cid, `Old${tag}`]);

  let c = client({ type: 'join', session: token, character: cid });
  await until(() => c.last.path, 8000, 'path message');
  c.send({ type: 'test', xp: 5000 }); await until(() => c.last.snap?.me?.lvl >= 5, 5000, 'level 5');
  c.send({ type: 'test', tp: [ACADEMY.x + 3, ACADEMY.z] }); await sleep(300);
  c.send({ type: 'academy', op: 'state' }); await until(() => c.last.path?.path?.enrolled, 5000, 'enrolled');
  c.send({ type: 'academy', op: 'trial', id: 'lancer' }); await until(() => c.last.snap?.me?.ac?.id === 'lancer', 5000, 'trial');
  c.send({ type: 'test', trialWin: 2 }); await until(() => c.last.path?.path?.trials?.lancer === 2 && !c.last.path.loan, 5000, 'medal');
  await until(() => c.last.path && !c.last.path.trial, 8000, 'home');
  c.send({ type: 'academy', op: 'graduate', cls: 'lancer' }); await until(() => c.last.path?.path?.stage === 'class', 5000, 'graduated');
  c.send({ type: 'academy', op: 'specialise', sub: 'dragoon' }); await sleep(400);
  assert.ok(!c.last.path.spec.sub, 'not before 15'); assert.ok(c.sys.some(t => /level 15/.test(t)));
  c.send({ type: 'test', xp: 400000 }); await until(() => c.last.snap?.me?.lvl >= 15, 5000, 'level 15');
  await until(() => c.sys.some(t => /Level 15: you can specialise/.test(t)), 5000, 'the level-15 notice');
  await until(() => c.last.path?.spec?.fee === 200 + 20 * c.last.snap.me.lvl, 5000, 'the path again (the fee by level)');
  c.send({ type: 'test', tp: [ACADEMY.x + 3, ACADEMY.z] }); await sleep(300);
  c.send({ type: 'academy', op: 'specialise', sub: 'dragoon' });
  await until(() => c.last.path?.spec?.sub === 'dragoon', 5000, `specialised (${c.sys.slice(-2).join(' | ')})`);
  assert.equal(c.last.path.spec.sig.name, 'Wyvern Dive');
  await until(() => c.last.snap?.me?.sub === 'dragoon' && c.roster?.find(r => r.id === c.id)?.sub === 'dragoon', 5000, 'me.sub and the roster');
  await until(() => c.last.snap.me.cds?.length === 5 && c.last.snap.me.cds[4] === 0, 8000, 'slot 5 ready');
  c.send({ type: 'skill', slot: 4, face: 0 });
  await until(() => c.last.snap?.me?.cds?.[4] > 10, 5000, 'slot 5 used: on cooldown');
  ok('over the socket: an Initiate graduates, is refused under 15, hears the level-15 notice, specialises as a Dragoon and uses slot 5');
  c.ws.close(); await c.closed; await sleep(800);
  let [row] = await db.q('SELECT cls, path FROM characters WHERE id = $1', [cid]);
  assert.deepEqual(row.path.subs, { lancer: 'dragoon' });

  await stop(); await start();
  c = client({ type: 'join', session: token, character: cid });
  await until(() => c.last.path?.spec && c.last.snap?.me, 8000, 'path after restart');
  assert.equal(c.last.path.spec.sub, 'dragoon'); assert.equal(c.last.path.spec.sig.name, 'Wyvern Dive');
  await until(() => c.last.snap?.me?.sub === 'dragoon', 5000, 'me.sub after restart');
  c.ws.close(); await c.closed;
  ok('after a restart the subclass and its signature skill are still there');

  const o = client({ type: 'join', session: token, character: oldId });
  await until(() => o.last.path && o.last.snap?.me, 8000, 'old join');
  assert.equal(o.last.path.path, null); assert.ok(!o.last.path.spec.sub); assert.ok(!('sub' in o.last.snap.me));
  await until(() => o.last.talents, 5000); assert.ok(!o.last.talents.locked);
  o.ws.close(); await o.closed;
  const i = client({ type: 'join', session: token, character: iniId });
  await until(() => i.last.path && i.last.snap?.me, 8000, 'Initiate join');
  i.send({ type: 'test', xp: 400000 }); await until(() => i.last.snap?.me?.lvl >= 15, 5000, 'Initiate at 15');
  i.send({ type: 'test', tp: [ACADEMY.x + 3, ACADEMY.z] }); await sleep(300);
  i.send({ type: 'academy', op: 'specialise', sub: 'duelist' }); await sleep(500);
  assert.equal(i.last.path.ini, 1); assert.ok(!i.last.path.spec.sub, 'an Initiate cannot specialise');
  i.ws.close(); await i.closed; await sleep(800);
  [row] = await db.q('SELECT cls, path, talents FROM characters WHERE id = $1', [oldId]);
  assert.equal(row.path, null, 'the old character: path still null'); assert.equal(row.talents.rg_aim, 1);
  [row] = await db.q('SELECT path FROM characters WHERE id = $1', [iniId]);
  assert.equal(row.path.stage, 'initiate'); assert.ok(!row.path.subs || !Object.keys(row.path.subs).length);
  ok('an old character (path null) and an Initiate at 15 load and save unchanged');
} finally {
  await stop();
  await db.close?.();
}
console.log(`1..${n}`);
process.exit(0);
