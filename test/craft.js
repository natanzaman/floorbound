// In-process crafting tests: node test/craft.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { makeItem, lastAttackItem, BAG_SIZE } from '../shared/items.js';
import { SMITH, refineCost, RECIPES, RECIPE_BY_ID, MAT_DROPS, REFINE_MAX } from '../shared/crafting.js';

const ws = { readyState: 1, send() {} };
const g = new Game();
const tracked = [];
g.track = (p, k, d) => tracked.push({ k, d });
let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('ok', name); };
const fresh = (cls = 'swordsman') => {
  const p = g.addPlayer(ws, `T${g.nextId}`, cls);
  p.x = SMITH.x; p.z = SMITH.z + 2.5;
  p.gold = 100000;
  p.inv.mats = { tusk: 99, pelt: 99, resin: 99, fang: 99, core: 99, horn: 99, dust: 99, ess: 99, prism: 99 };
  g.events.length = 0;
  return p;
};
const sysTo = p => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);

t('mats drop from mobs and show in the loot event', () => {
  const p = fresh();
  delete p.inv.mats; // old save
  const m = { type: 'warden', x: 1, z: 2 };
  g.dropLoot(p, m);
  const ev = g.events.find(e => e.t === 'loot');
  assert.ok(ev.mats.horn >= 2 && ev.mats.horn <= 4);
  assert.equal(p.inv.mats.horn, ev.mats.horn);
  assert.deepEqual(g.invFor(p).mats, p.inv.mats);
  for (const type of Object.keys(MAT_DROPS)) g.dropLoot(p, { type, x: 0, z: 0 });
  g.dropLoot(p, { type: 'nosuchmob', x: 0, z: 0 }); // unknown mobs (e.g. new floors) drop nothing
});

t('refine bag item +1..+5, stats +10% per level, name +N, cost rises', () => {
  const p = fresh();
  const it = makeItem('weapon', 2, 'swordsman', () => 0.5);
  const base = it.st.atk, name = it.name;
  p.inv.bag.push(it);
  const costs = [];
  for (let lv = 1; lv <= REFINE_MAX; lv++) {
    costs.push(refineCost(it));
    const gold = p.gold, tusk = p.inv.mats.tusk;
    assert.equal(g.refine(p, it.u), true);
    assert.equal(it.lv, lv);
    assert.equal(it.name, `${name} +${lv}`);
    assert.equal(it.st.atk, Math.round(base * (1 + 0.1 * lv) * 10) / 10);
    assert.equal(gold - p.gold, costs[lv - 1].gold);
    assert.equal(tusk - p.inv.mats.tusk, costs[lv - 1].mats.tusk);
  }
  assert.ok(costs[3].mats.horn >= 1 && costs[4].mats.horn >= 1 && !costs[0].mats.horn);
  assert.ok(costs.every((c, i) => !i || c.gold > costs[i - 1].gold));
  assert.equal(g.refine(p, it.u), false); // maxed
  assert.ok(tracked.some(e => e.k === 'craft' && e.d.action === 'refine' && e.d.r === 2));
});

t('refine equipped item recomputes stats', () => {
  const p = fresh();
  const it = makeItem('armor', 1, null, () => 0.5);
  p.inv.bag.push(it); g.equip(p, it.u);
  const hp0 = p.maxHp;
  assert.equal(g.refine(p, it.u), true);
  assert.ok(p.maxHp > hp0);
  assert.equal(p.inv.eq.armor.lv, 1);
});

t('armour uses pelts, charms resin; +4 needs horn shards', () => {
  assert.ok(refineCost(makeItem('armor', 1)).mats.pelt);
  assert.ok(refineCost(makeItem('charm', 1)).mats.resin);
  assert.ok(refineCost({ ...makeItem('armor', 1), lv: 3 }).mats.horn);
});

t('rejects: not near smith, not enough mats/gold, bad uid, wrong class weapon', () => {
  const p = fresh();
  const it = makeItem('weapon', 1, 'swordsman'); p.inv.bag.push(it);
  p.x = 40; p.z = 40;
  assert.equal(g.refine(p, it.u), false);
  assert.equal(g.salvage(p, it.u), false);
  assert.equal(g.reforge(p, it.u, 'stats'), false);
  assert.equal(g.craft(p, 'tuskbreaker'), false);
  p.x = SMITH.x; p.z = SMITH.z + 2.5;
  p.inv.mats.tusk = 0;
  assert.equal(g.refine(p, it.u), false);
  assert.ok(sysTo(p).includes('Not enough materials.'));
  p.inv.mats.tusk = 99; p.gold = 0;
  assert.equal(g.refine(p, it.u), false);
  assert.ok(sysTo(p).includes('Not enough gold.'));
  p.gold = 100000;
  assert.equal(g.refine(p, 424242), false);
  assert.equal(g.refine(p, 'junk'), false);
  assert.equal(g.salvage(p, 424242), false);
  assert.equal(g.craft(p, 'nope'), false);
  const other = makeItem('weapon', 1, 'cleric'); p.inv.bag.push(other);
  assert.equal(g.refine(p, other.u), false);
  assert.equal(g.reforge(p, other.u, 'stats'), false);
  assert.equal(g.craft(p, 'wardenforged', 'cleric'), false);
  assert.equal(it.lv, undefined);
  p.dead = true;
  assert.equal(g.refine(p, it.u), false);
});

t('salvage gives dust/essence/prism by rarity, refunds refine mats, keeps LA item', () => {
  const p = fresh();
  p.inv.mats = { tusk: 99, fang: 99, ess: 99 };
  const exp = [{ dust: 2 }, { dust: 1, ess: 1 }, { ess: 2 }, { ess: 2, prism: 1 }];
  for (let r = 0; r < 4; r++) {
    const it = makeItem('armor', r); p.inv.bag.push(it);
    const before = { ...p.inv.mats };
    assert.equal(g.salvage(p, it.u), true);
    for (const [k, v] of Object.entries(exp[r])) assert.equal((p.inv.mats[k] || 0) - (before[k] || 0), v);
    assert.ok(!p.inv.bag.includes(it));
  }
  const w = makeItem('weapon', 1, 'swordsman'); p.inv.bag.push(w);
  g.refine(p, w.u); g.refine(p, w.u); // 3 + 5 tusks spent
  const tusk = p.inv.mats.tusk;
  assert.equal(g.salvage(p, w.u), true);
  assert.equal(p.inv.mats.tusk - tusk, 4);
  const la = lastAttackItem(); p.inv.bag.push(la);
  assert.equal(g.salvage(p, la.u), false);
  // equipped items can't be salvaged
  const a = makeItem('armor', 1); p.inv.bag.push(a); g.equip(p, a.u);
  assert.equal(g.salvage(p, a.u), false);
});

t('reforge: charm affix changes, stats reroll in range, keeps refine level', () => {
  const p = fresh();
  const c = makeItem('charm', 2, null, Math.random, 'crit'); p.inv.bag.push(c);
  g.refine(p, c.u);
  const ess = p.inv.mats.ess;
  assert.equal(g.reforge(p, c.u, 'affix'), true);
  assert.ok(p.inv.mats.ess < ess);
  assert.equal(c.st.crit, undefined);
  assert.ok(c.st.haste || c.st.sw);
  assert.equal(c.lv, 1);
  assert.match(c.name, /^Gleaming Charm of (Haste|the Switch) \+1$/);
  const w = makeItem('weapon', 2, 'swordsman'); p.inv.bag.push(w);
  for (let i = 0; i < 20; i++) { assert.equal(g.reforge(p, w.u, 'stats'), true); assert.ok(w.st.atk >= 11 && w.st.atk <= 15); }
  assert.equal(g.reforge(p, w.u, 'affix'), false); // affix is charms only
  assert.equal(g.reforge(p, w.u, 'bogus'), false);
  const la = lastAttackItem(); p.inv.bag.push(la);
  assert.equal(g.reforge(p, la.u, 'stats'), false);
});

t('recipes: every recipe crafts with fixed stats; class weapons; costs deducted; bag full rejected', () => {
  for (const cls of ['swordsman', 'guardian', 'cleric']) {
    const p = fresh(cls);
    for (const rc of RECIPES) {
      const gold = p.gold;
      assert.equal(g.craft(p, rc.id), true, rc.id);
      const it = p.inv.bag.at(-1);
      assert.equal(it.cr, rc.id); assert.equal(it.r, rc.r); assert.equal(it.slot, rc.slot);
      assert.deepEqual(it.st, rc.st);
      if (rc.slot === 'weapon') assert.equal(it.cls, cls); else assert.equal(it.cls, undefined);
      assert.equal(gold - p.gold, rc.gold);
    }
    assert.equal(g.reforge(p, p.inv.bag.at(-1).u, 'stats'), false); // crafted items are fixed
    assert.equal(g.refine(p, p.inv.bag.at(-1).u), true); // but can be refined
  }
  const p = fresh();
  p.inv.mats = { horn: 5, core: 2, ess: 3 };
  assert.equal(g.craft(p, 'wardenforged'), false); // needs 6 horn
  p.inv.mats.horn = 6;
  assert.equal(g.craft(p, 'wardenforged'), true);
  assert.equal(p.inv.mats.horn, 0);
  assert.equal(p.inv.bag.at(-1).name, 'Warden-Forged Blade');
  while (p.inv.bag.length < BAG_SIZE) p.inv.bag.push(makeItem('armor', 0));
  p.inv.mats = { tusk: 99, dust: 99, ess: 99 };
  assert.equal(g.craft(p, 'tuskbreaker'), false);
  assert.ok(RECIPES.length >= 6 && RECIPE_BY_ID.hornplate.mats.horn && RECIPE_BY_ID.hornplate.mats.fang);
});

t('handle() routes smith messages and emits a forge event', () => {
  const p = fresh();
  const it = makeItem('armor', 1); p.inv.bag.push(it);
  g.handle(p, { type: 'smith', a: 'refine', u: it.u });
  assert.equal(it.lv, 1);
  assert.ok(g.events.some(e => e.t === 'forge' && e.id === p.id && e.a === 'refine'));
  assert.ok(p.invDirty);
  g.handle(p, { type: 'smith', a: 'salvage', u: it.u });
  assert.ok(!p.inv.bag.includes(it));
  g.handle(p, { type: 'smith', a: 'craft', id: 'peltmantle' });
  assert.equal(p.inv.bag.at(-1).cr, 'peltmantle');
  g.handle(p, { type: 'smith', a: 'reforge', u: p.inv.bag.at(-1).u, mode: 'stats' }); // rejected, no throw
  g.handle(p, { type: 'smith', a: 'bogus' });
  g.handle(p, { type: 'smith' });
  g.update(0.05); // the simulation still ticks
});

console.log(`\n${ok} crafting tests passed`);
