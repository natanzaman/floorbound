// In-process checks for the Path redesign (docs/briefs/path.md): the class tree layouts (no node or label overlaps,
// everything in view, with Subclass II and crown nodes too), plan then confirm (planAlloc and the server's spendMany),
// build identity (buildShape, buildTag, buildName, the roster's bt) and the suggested path.
// Usage: node test/path.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { newPath, cleanPath } from '../shared/academy.js';
import { MAX_LEVEL, CLASSES } from '../shared/data.js';
import { talentTotals, TREES, BUILD_TAGS, planAlloc, buildShape, buildTag, buildName, suggestOrder, spendBlock, spentOf, nodeDef } from '../shared/talents.js';
import { SUBCLASSES, subsOf, SIG_EVOS } from '../shared/subclasses.js';
import { MASTERY, BRANCHES, masterySkills, AWAKEN } from '../shared/mastery.js';
import { ruleText, cleanRule, FX_MAX } from '../shared/effects.js';
import { shapeOf, VIEW, nodeBox } from '../public/treeshapes.js';

let n = 0;
const nodesOfAll = cls => TREES[cls].branches.flatMap(b => b.nodes.map(nd => nodeDef(nd.id)));
const ok = name => console.log(`  ok ${++n} - ${name}`);
const g = new Game();
g.mobs.clear(); g.boss = null;
let events = [];
const ev = (t, f = () => true) => { events.push(...g.events); g.events = []; return events.filter(e => e.t === t && f(e)); };
function mk(cls, lvl = 20) {
  const p = g.addPlayer(null, `P${g.nextId}`, cls);
  p.path = { stage: 'class', weapon: 'sword', trials: {}, drills: {}, keep: {}, subs: {} };
  p.lvl = lvl; g.setTalents(p, {});
  return p;
}

// ---------- layouts ----------
{
  const SLACK = 5; // label widths are estimates (5.6 px a character is generous)
  for (const cls of Object.keys(TREES)) {
    const sh = shapeOf(cls);
    assert.notEqual(sh.name, 'The Tree', `${cls} has its own shape`);
    assert.ok(/^[MmLlHhVvCcQqSsAaZz0-9 .,-]+$/.test(sh.sigil), `${cls}: sigil is a path`);
    for (const sub of subsOf(cls)) {
      const boxes = [];
      TREES[cls].branches.forEach((b, bi) => {
        const nodes = b.nodes.filter(nd => !nd.sub || nd.sub === sub);
        if (b.id === SUBCLASSES[sub].branch && !nodes.some(nd => nd.tier === 5)) // stand-ins for the later nodes, at their places
          nodes.push({ id: 'II-a', name: 'Subclass Two A', tier: 4, x: -1 }, { id: 'II-b', name: 'Subclass Two B', tier: 4, x: 1 }, { id: 'crown', name: 'The Crown Node', tier: 5, x: 0, keystone: true });
        for (const nd of nodes) { const [x, y] = sh.pos(bi, nd); assert.ok(Number.isFinite(x) && Number.isFinite(y), `${nd.id} placed`); boxes.push({ id: nd.id, b: nodeBox(x, y, nd) }); }
      });
      for (const q of boxes) assert.ok(q.b[0] >= -SLACK && q.b[1] >= -SLACK && q.b[2] <= VIEW.w + SLACK && q.b[3] <= VIEW.h + SLACK, `${cls}/${sub}: ${q.id} in view (${q.b.map(Math.round)})`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].b, c = boxes[j].b;
        const ox = Math.min(a[2], c[2]) - Math.max(a[0], c[0]), oy = Math.min(a[3], c[3]) - Math.max(a[1], c[1]);
        assert.ok(!(ox > SLACK && oy > SLACK), `${cls}/${sub}: ${boxes[i].id} and ${boxes[j].id} overlap (${ox.toFixed(0)} x ${oy.toFixed(0)})`);
      }
    }
  }
  ok('every class tree has its own shape; no two nodes (with labels) overlap and all stay in view, for every subclass');
}

// ---------- plan, then confirm ----------
{
  const r = planAlloc('swordsman', {}, 20, ['sw_edge', 'sw_edge', 'sw_edge', 'sw_finale']);
  assert.deepEqual(r.alloc, { sw_edge: 3, sw_finale: 1 });
  assert.match(planAlloc('swordsman', {}, 20, ['sw_edge', 'sw_edge', 'sw_finale']).error, /Finishing Flourish: Needs 3 points/, 'tier gates count planned ranks');
  assert.match(planAlloc('swordsman', {}, 20, ['sw_finale']).error, /Finishing Flourish: Needs/);
  assert.match(planAlloc('swordsman', {}, 2, ['sw_edge', 'sw_edge']).error, /No talent points/);
  assert.match(planAlloc('swordsman', {}, 20, ['gu_brace']).error, /Not in your tree/);
  assert.deepEqual(planAlloc('swordsman', { sw_edge: 1 }, 20, []).alloc, { sw_edge: 1 }, 'an empty plan changes nothing');
  ok('planAlloc: ranks in order, the first illegal one named, nothing half-applied');

  const p = mk('swordsman', 8);
  g.talentAction(p, { op: 'spendMany', ids: ['sw_edge', 'sw_edge', 'sw_edge', 'sw_finale', 'sw_finale'] });
  assert.deepEqual(p.talents, { sw_edge: 3, sw_finale: 2 }, 'a legal plan lands whole');
  assert.equal(ev('talent', e => e.to === p.id && e.op === 'spend').length, 2, 'one spend event per node');
  g.talentAction(p, { op: 'spendMany', ids: ['sw_precision', 'sw_exec'] });
  assert.deepEqual(p.talents, { sw_edge: 3, sw_finale: 2 }, 'an illegal plan lands not at all');
  assert.ok(ev('sys', e => e.to === p.id && /Executioner/.test(e.text)).length, 'and says which node and why');
  g.talentAction(p, { op: 'spendMany', ids: 'sw_precision' });
  g.talentAction(p, { op: 'spendMany', ids: Array(60).fill('sw_precision') });
  assert.deepEqual(p.talents, { sw_edge: 3, sw_finale: 2 }, 'junk and oversized plans do nothing');
  g.removePlayer(p);
  ok('spendMany: the server checks the whole plan, then applies it (or nothing)');
}

// ---------- build identity ----------
{
  for (const cls of Object.keys(TREES)) {
    assert.equal(buildTag(cls, {}), null, 'no name before 3 points');
    for (const b of TREES[cls].branches) { // all-in on one branch reads as that branch
      const a = {}; let k = 0;
      for (const nd of [...b.nodes].filter(x => !x.sub).sort((p, q) => p.tier - q.tier)) for (let r = 0; r < nd.max && k < 12; r++, k++) if (!spendBlock(cls, a, MAX_LEVEL, nd.id)) a[nd.id] = (a[nd.id] | 0) + 1;
      const s = buildShape(cls, a);
      assert.deepEqual(Object.keys(s).sort(), [...BUILD_TAGS].sort());
      assert.ok(Math.max(...Object.values(s)) === 1, `${cls}/${b.id}: shape normalised`);
      assert.ok(BUILD_TAGS.includes(buildTag(cls, a)), `${cls}/${b.id}: a tag`);
    }
  }
  assert.equal(buildName('tempo', 'Duelist'), 'Swift Duelist');
  assert.equal(buildName(null, 'Duelist'), 'Duelist');
  const p = mk('swordsman', 20);
  g.rosterDirty = false;
  g.talentAction(p, { op: 'spendMany', ids: ['sw_feet', 'sw_feet', 'sw_roll', 'sw_roll', 'sw_roll'] });
  assert.equal(g.roster().find(r => r.id === p.id).bt, 'tempo', 'the roster carries the build tag');
  assert.ok(g.rosterDirty, 'a new build tag re-sends the roster');
  g.removePlayer(p);
  ok('build identity: five tags, a normalised shape, a name from 3 points, the roster carries bt');
}

// ---------- suggested path ----------
{
  for (const sub of Object.keys(SUBCLASSES)) {
    const { cls, branch } = SUBCLASSES[sub], order = suggestOrder(cls, sub, branch);
    const first = nodeDef(order[0]);
    assert.equal(first.branch, branch, `${sub}: starts in its branch`);
    const a = {}; let spent = 0;
    for (const id of order) { if (spent >= 29) break; if (!spendBlock(cls, a, MAX_LEVEL, id, sub)) { a[id] = (a[id] | 0) + 1; spent++; } }
    assert.ok(spentOf(a) >= 25, `${sub}: the suggested path spends (nearly) every point (${spentOf(a)})`);
    assert.ok(Object.keys(a).some(id => nodeDef(id).sub === sub), `${sub}: takes its own nodes`);
  }
  ok('suggested path: the subclass branch first (its own nodes too), then the class order');
}


// ---------- signature mastery (Phase 2) ----------
{
  for (const sub of Object.keys(SUBCLASSES)) {
    const { cls, skill } = SUBCLASSES[sub], f = SIG_EVOS[skill.id];
    assert.ok(f?.A?.name && f?.B?.name && f.A.desc && f.B.desc, `${skill.id}: two forms`);
    for (const k of ['A', 'B']) for (const key of Object.keys(f[k].n)) assert.ok(key in skill.n || (skill.id === 'conqroar' && ['selfDr', 'd'].includes(key)) || (skill.id === 'sirenwail' && key === 'stun'), `${skill.id}/${k}: ${key} is one of its numbers`);
    assert.ok(masterySkills(cls).includes(skill.id), `${cls}: a mastery record for ${skill.id}`);
    assert.equal(BRANCHES[skill.id], f);
  }
  const p = mk('swordsman', 20);
  p.path.subs = { swordsman: 'duelist' }; g.specRefresh(p);
  const field = () => { g.teleport(p, 0, 80); p.face = 0; const m = g.addMob('wolf', 0, 83); m.hp = m.maxHp = 1e5; return m; };
  const m = field(), t0 = g.time;
  g.useSkill(p, 4, 0);
  for (let i = 0; i < 30; i++) g.update(0.05);
  assert.ok(p.mastery.flashstep.pts > 0, `Flash Step earns mastery (${p.mastery.flashstep.pts})`);
  assert.ok(Math.abs(p.cds[4] - t0 - SUBCLASSES.duelist.skill.cd * (1 - (p.haste || 0))) < 0.6, 'base cooldown at Mastery 1');
  // Mastery 3: it evolves; the form's numbers and the cooldown change, the path message says so
  p.mastery.flashstep.pts = MASTERY.need[3];
  g.chooseBranch(p, 'flashstep', 'B');
  assert.equal(p.mastery.flashstep.br, 'B');
  const sm = g.specMsg(p).sig;
  assert.equal(sm.name, 'Long Step'); assert.equal(sm.base, 'Flash Step');
  assert.ok(Math.abs(g.sigCd(p) - SUBCLASSES.duelist.skill.cd * MASTERY.cd2) < 1e-6, 'Mastery 2+: -10% cooldown');
  p.mastery.rallycut = { pts: MASTERY.need[3], br: null };
  g.chooseBranch(p, 'deadeye', 'A'); // not this class's: nothing
  assert.ok(!p.mastery.deadeye);
  // Snap Shot: a form's cooldown
  const r = mk('ranger', 20); r.path.subs = { ranger: 'sharpshooter' }; g.specRefresh(r);
  r.mastery.deadeye = { pts: MASTERY.need[3], br: 'B' };
  assert.ok(Math.abs(g.sigCd(r) - SUBCLASSES.sharpshooter.skill.cd * MASTERY.cd2 * SIG_EVOS.deadeye.B.cd) < 1e-6, 'Snap Shot comes back sooner');
  g.mobs.delete(m.id); g.removePlayer(p); g.removePlayer(r);
  ok('signature mastery: two forms each, earned by using slot 5, -10% at Mastery 2, a form at 3 (name, numbers, cooldown)');
}

{ // every form runs (and still earns mastery)
  for (const sub of Object.keys(SUBCLASSES)) for (const br of ['A', 'B']) {
    const { cls, skill } = SUBCLASSES[sub], p = mk(cls, 20);
    p.path.subs = { [cls]: sub }; g.specRefresh(p);
    p.mastery[skill.id] = { pts: MASTERY.need[3], br };
    g.teleport(p, 0, 80); p.face = 0; p.hp = p.maxHp * 0.5;
    const m = g.addMob('wolf', 0, 83); m.hp = m.maxHp = 1e5;
    const pts = p.mastery[skill.id].pts;
    g.useSkill(p, 4, 0);
    for (let i = 0; i < 40; i++) g.update(0.05);
    assert.ok(p.cds[4] > 0, `${skill.id}/${br}: used`);
    assert.ok(p.mastery[skill.id].pts > pts || ['aegisline', 'encore'].includes(skill.id), `${skill.id}/${br}: earns mastery`);
    g.mobs.delete(m.id); g.removePlayer(p);
  }
  ok('all 28 signature forms run');
}

{ // an Initiate plans the first talents of a class their weapon leads to; graduating as it spends the plan
  const p = mk('swordsman', 8);
  p.path = newPath('sword'); g.setTalents(p, {});
  const t0 = TREES.guardian.branches[0].nodes.find(nd => nd.tier === 0), s0 = TREES.swordsman.branches[0].nodes.find(nd => nd.tier === 0);
  g.talentAction(p, { op: 'plan', cls: 'guardian', ids: [t0.id, t0.id] });
  assert.deepEqual(p.path.plan, { guardian: { [t0.id]: 2 } });
  g.talentAction(p, { op: 'plan', cls: 'swordsman', ids: [s0.id] });
  g.talentAction(p, { op: 'plan', cls: 'ranger', ids: [TREES.ranger.branches[0].nodes[0].id] });
  assert.ok(!p.path.plan.ranger, 'not a class the sword leads to');
  g.talentAction(p, { op: 'plan', cls: 'guardian', ids: Array(20).fill(t0.id) });
  assert.deepEqual(p.path.plan.guardian, { [t0.id]: 2 }, 'an illegal plan changes nothing');
  assert.deepEqual(p.talents, {}, 'the Initiate\'s own tree stays shut');
  assert.deepEqual(g.talentsMsg(p).plan, p.path.plan, 'the talents message carries the plans');
  assert.deepEqual(cleanPath(JSON.parse(JSON.stringify(p.path))).plan, p.path.plan, 'saved and loaded');
  g.talentAction(p, { op: 'plan', cls: 'swordsman', clear: 1 });
  assert.ok(!p.path.plan.swordsman, 'clear');
  g.graduate(p, 'guardian', { quiet: true });
  assert.equal(p.cls, 'guardian'); assert.deepEqual(p.talents, { [t0.id]: 2 }, 'graduation spends the plan');
  assert.ok(!p.path.plan, 'and forgets every plan');
  g.removePlayer(p);
  ok('Initiate plans: per class the weapon leads to, all or nothing, saved, spent at graduation');
}

// ---------- Phase 3: the effect library, awakenings, Subclass II and the Crown, rule riders ----------
{
  const rules = [];
  for (const [sk, f] of Object.entries(AWAKEN)) for (const k of ['A', 'B']) rules.push([`${sk}/${k}`, f[k]]);
  for (const cls of Object.keys(TREES)) for (const nd of nodesOfAll(cls)) for (const e of nd.fx) if (e.rule) rules.push([nd.id, e.rule]);
  for (const [id, r] of rules) {
    assert.ok(cleanRule(r), `${id}: a known rule`); assert.ok(ruleText(r).length > 20, `${id}: has text`);
    for (const [k, cap] of Object.entries(FX_MAX)) { const v = k === 'mult' ? r.mult : r.do === k ? r.v : undefined; if (v !== undefined) assert.ok(v <= cap, `${id}: ${k} ${v} <= ${cap}`); }
  }
  assert.equal(Object.keys(AWAKEN).length, Object.keys(BRANCHES).length, 'every skill with forms awakens');
  for (const sub of Object.keys(SUBCLASSES)) {
    const later = nodesOfAll(SUBCLASSES[sub].cls).filter(nd => nd.sub === sub && nd.lvl);
    assert.deepEqual(later.map(nd => [nd.tier, nd.x, nd.lvl]).sort(), [[4, -1, 22], [4, 1, 22], [5, 0, MAX_LEVEL]], `${sub}: II left and right, the Crown`);
  }
  // level gates: Subclass II at 22, the Crown at 30; never a tier gate for others
  const D = nodesOfAll('swordsman').filter(nd => nd.sub === 'duelist' && nd.lvl), a = {};
  for (const id of suggestOrder('swordsman', 'duelist', 'tempo')) if (!spendBlock('swordsman', a, 21, id, 'duelist')) a[id] = (a[id] | 0) + 1;
  assert.match(spendBlock('swordsman', a, 21, D[0].id, 'duelist') || '', /level 22/);
  const crown = D.find(nd => nd.tier === 5);
  assert.match(spendBlock('swordsman', { ...a, [D[0].id]: 1 }, 29, crown.id, 'duelist') || '', /level 30/);
  ok('effect library: every awakening and rule node is a known rule with text, within caps; Subclass II at 22, the Crown at 30');
}
{ // the engine: an awakening fires on its skill's hits, a Crown rule on kills; a rule never sets off another
  const p = mk('swordsman', MAX_LEVEL);
  g.teleport(p, 0, 80); p.face = 0;
  p.mastery.rush = { pts: MASTERY.need[5], br: 'A' }; // Phantom Rush awakened: its hits mark
  const m = g.addMob('wolf', 0, 82); m.hp = m.maxHp = 1e5;
  g.useSkill(p, 1, 0);
  for (let i = 0; i < 20; i++) g.update(0.05);
  assert.ok(m.fxMark && m.fxMark.until > g.time, 'Phantom Rush (Mastery 5) marks what it hits');
  assert.ok(ev('fxr', e => e.id === p.id && e.k === 'mark').length, 'and says so');
  const hp = m.hp; g.damageMob(m, p, 100, {}); assert.ok(hp - m.hp > 100 * 0.9 * 1.1 - 1, 'a marked enemy takes more');
  g.mobs.delete(m.id);
  p.path.subs = { swordsman: 'duelist' }; g.specRefresh(p);
  const alloc = {}; for (const id of suggestOrder('swordsman', 'duelist', 'tempo')) if (!spendBlock('swordsman', alloc, MAX_LEVEL, id, 'duelist')) alloc[id] = (alloc[id] | 0) + 1;
  for (const nd of nodesOfAll('swordsman').filter(nd => nd.sub === 'duelist' && nd.lvl).sort((x, y) => x.tier - y.tier)) if (!(alloc[nd.id] > 0)) { const k = Object.keys(alloc).find(id => !nodeDef(id).sub && nodeDef(id).tier < 2 && alloc[id] > 0 && !spendBlock('swordsman', { ...alloc, [id]: alloc[id] - 1 }, MAX_LEVEL, nd.id, 'duelist')); if (k && spendBlock('swordsman', alloc, MAX_LEVEL, nd.id, 'duelist')) alloc[k]--; if (!spendBlock('swordsman', alloc, MAX_LEVEL, nd.id, 'duelist')) alloc[nd.id] = 1; }
  g.setTalents(p, alloc);
  assert.ok(p.talents.sw_du_crown, `the Crown is learned (${JSON.stringify(p.talents)})`);
  assert.ok(p.tal.rules.length >= 2, 'its rules are in the totals');
  p.cds[1] = g.time + 10; p.cds[2] = g.time + 10;
  const w = g.addMob('wolf', 0, 82); w.hp = 1;
  g.damageMob(w, p, 50, {});
  assert.ok(w.dead, 'killed');
  assert.ok(p.cds[1] <= g.time + 7.01, `Crown: Untouchable takes 3 s off on a kill (${(p.cds[1] - g.time).toFixed(2)} left)`);
  g.mobs.delete(w.id);
  // no chains: a burst from a rule does not set off hit rules again
  p.tal.rules.push({ on: 'hit', do: 'burst', mult: 0.1, r: 3, id: 'test' });
  const z = g.addMob('wolf', 0, 82); z.hp = z.maxHp = 1e5; const e0 = g.events.length;
  g.damageMob(z, p, 10, {});
  assert.equal(g.events.slice(e0).filter(e => e.t === 'fxr' && e.k === 'burst').length, 1, 'one burst, no chain');
  g.mobs.delete(z.id); g.removePlayer(p);
  ok('the engine: an awakening marks on hit, the Crown cuts cooldowns on a kill, a rule never chains');
}

{ // review fixes: a burn never lengthens the skill's cooldown; cooldown cuts leave slot 5 alone; 'the one healed' gets the shield
  const p = mk('swordsman', MAX_LEVEL); g.teleport(p, 0, 80); p.face = 0;
  const m = g.addMob('wolf', 0, 81.5); m.hp = m.maxHp = 1e5;
  p.tal.rules.push({ on: 'hit', do: 'burn', v: 0.1, d: 3, id: 't1' });
  const t0 = g.time; g.useSkill(p, 2, 0);
  const want = g.skillCd(p, CLASSES.swordsman.skills[2], 2);
  assert.ok(p.cds[2] - t0 <= want + 0.3, `cooldown unchanged by the burn (${(p.cds[2] - t0).toFixed(2)} vs ${want.toFixed(2)})`);
  p.tal.rules = [{ on: 'kill', do: 'cdcut', v: 3, id: 't2' }];
  p.cds[4] = g.time + 20; p.cds[1] = g.time + 10;
  const w = g.addMob('wolf', 0, 82); w.hp = 1; g.damageMob(w, p, 50, {});
  assert.ok(p.cds[1] < g.time + 7.1 && Math.abs(p.cds[4] - g.time - 20) < 1e-6, 'skills 1-3 only');
  const c = mk('cleric', MAX_LEVEL), o = mk('swordsman', MAX_LEVEL);
  g.teleport(c, 0, 80); g.teleport(o, 2, 80); o.hp = 10; o.shield = null; c.shield = null;
  c.tal.rules = [{ on: 'heal', do: 'shield', v: 0.05, r: 0, to: 't', d: 4, id: 't3' }];
  g.healPlayer(o, 50, c, null);
  assert.ok(o.shield?.hp > 0 && !c.shield, 'the one healed is shielded, not the healer');
  for (const x of [m, w]) g.mobs.delete(x.id);
  for (const x of [p, c, o]) g.removePlayer(x);
  ok('burns keep the cooldown, cuts leave slot 5, heal shields go to the one healed');
}

console.log(`path: all ${n} checks passed`);
process.exit(0);
