// In-process checks for the Path redesign (docs/briefs/path.md): the class tree layouts (no node or label overlaps,
// everything in view, with Subclass II and crown nodes too), plan then confirm (planAlloc and the server's spendMany),
// build identity (buildShape, buildTag, buildName, the roster's bt) and the suggested path.
// Usage: node test/path.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { MAX_LEVEL } from '../shared/data.js';
import { TREES, BUILD_TAGS, planAlloc, buildShape, buildTag, buildName, suggestOrder, spendBlock, spentOf, nodeDef } from '../shared/talents.js';
import { SUBCLASSES, subsOf } from '../shared/subclasses.js';
import { shapeOf, VIEW, nodeBox } from '../public/treeshapes.js';

let n = 0;
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

console.log(`path: all ${n} checks passed`);
process.exit(0);
