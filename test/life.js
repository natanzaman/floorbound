// Life classes (docs/briefs/life-classes.md): node test/life.js
//  1. pure rules: the XP curve, yields, growth timing, recipes, the data tables (spots clear of the scenery)
//  2. in process: learn, gather (per-player depletion), fishing, the garden with an injected clock, tending bots,
//     cooking, alchemy, meals (buffs), the Smith skill, seeds at the merchant, rate limits and stack caps
//  3. with DATABASE_URL: a real server (TEST_HOOKS) on PORT (default 3431): gather, plant, restart, time passes, harvest,
//     cook, eat; everything persists across the restart
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIFE_SKILLS, LIFE_SKILL_IDS, LIFE_XP, LIFE_MAX, lifeLevel, lifeProgress, LIFE_MATS, SPOTS, SPOT_TYPES, SPOT_KINDS, rollSpot,
  STATIONS, GARDEN, LIFE_HALL, COOK_FIRE, ALCH_BENCH, CROPS, CROP_IDS, tileGrowth, tileLeft, LIFE_RECIPES, FOODS, TEND,
  PLOT_TILES, newLife, STACK_MAX, SPOT_BY_ID, TILE_OFFSETS,
} from '../shared/life.js';
import { MATS, RECIPES } from '../shared/crafting.js';
import { CONSUMABLES, SHOP, MERCHANT } from '../shared/items.js';
import { OBSTACLES, walkable } from '../shared/data.js';
import { LABS } from '../shared/labyrinth.js';
import { HALL } from '../shared/titles.js';
import { SHRINES } from '../shared/mastery.js';
import { SMITH } from '../shared/crafting.js';
import { Game } from '../server/game.js';
import { lifeRecord } from '../server/life.js';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

// ---------- 1. pure rules ----------
await t('XP curve: levels 1-10, rising steps, progress bar', () => {
  assert.equal(LIFE_XP.length, LIFE_MAX + 1);
  for (let L = 2; L <= LIFE_MAX; L++) {
    assert.ok(LIFE_XP[L] > LIFE_XP[L - 1]);
    if (L > 2) assert.ok(LIFE_XP[L] - LIFE_XP[L - 1] >= LIFE_XP[L - 1] - LIFE_XP[L - 2], 'each level takes at least as long as the last');
    assert.equal(lifeLevel(LIFE_XP[L]), L); assert.equal(lifeLevel(LIFE_XP[L] - 1), L - 1);
  }
  assert.equal(lifeLevel(0), 1); assert.equal(lifeLevel(1e9), LIFE_MAX);
  assert.deepEqual(lifeProgress(LIFE_XP[3] + 5), { lvl: 3, into: 5, need: LIFE_XP[4] - LIFE_XP[3] });
  assert.equal(lifeProgress(1e9).need, 0);
});

await t('materials are plain ids in MATS; every yield, crop, seed, meal and recipe names a real one', () => {
  for (const id of Object.keys(LIFE_MATS)) assert.ok(MATS[id]?.life, id);
  for (const T of Object.values(SPOT_TYPES)) { assert.ok(SPOT_KINDS[T.kind]); for (const [id] of T.yields) assert.ok(LIFE_MATS[id], id); }
  for (const [c, C] of Object.entries(CROPS)) { assert.equal(LIFE_MATS[c].cat, 'crop'); assert.equal(LIFE_MATS[C.seed].cat, 'seed'); }
  for (const id of Object.keys(FOODS)) assert.equal(LIFE_MATS[id].cat, 'food');
  for (const r of LIFE_RECIPES) {
    for (const k of Object.keys(r.mats)) assert.ok(MATS[k], `${r.id}: ${k}`);
    for (const k of Object.keys(r.out.mats || {})) assert.ok(FOODS[k], `${r.id} makes a meal`);
    for (const k of Object.keys(r.out.cons || {})) assert.ok(CONSUMABLES[k], `${r.id} makes an existing consumable`);
    assert.ok(LIFE_SKILLS[r.skill] && r.lvl >= 1 && r.lvl <= LIFE_MAX);
  }
  assert.ok(RECIPES.some(r => r.mats.iron) && RECIPES.some(r => r.mats.stormite), 'ore feeds the Smith');
  for (const s of SHOP.filter(s => s.kind === 'mat')) assert.equal(MATS[s.id].cat, 'seed');
});

await t('yields: the first always lands for a sure yield; levels above the spot add more', () => {
  const lo = rollSpot('meadow', 1, () => 0), hi = rollSpot('meadow', 10, () => 0);
  assert.equal(lo.meadowleaf, 1);
  assert.equal(hi.meadowleaf, 1 + 3);
  assert.deepEqual(rollSpot('meadow', 1, () => 0.99), { meadowleaf: 2 }); // (0.99: no seeds)
  assert.deepEqual(rollSpot('nope', 1), {});
});

await t('growth timing: linear in wall time, tending boost counts, clamped', () => {
  const tile = { c: 'wheat', at: 1000, boost: 0 }, G = CROPS.wheat.grow;
  assert.equal(tileGrowth(tile, 1000), 0);
  assert.equal(tileGrowth(tile, 1000 + G / 2), 0.5);
  assert.equal(tileGrowth(tile, 1000 + G * 3), 1);
  assert.equal(tileGrowth(tile, 0), 0); // a clock that went back: never negative
  assert.equal(tileLeft({ ...tile, boost: G / 4 }, 1000 + G / 2), G / 4);
  assert.ok(TEND.mult > 1 && TEND.mult < 2);
});

await t('spots and stations sit clear of the scenery; lab spots avoid starts, ends, traps, levers and chests', () => {
  assert.equal(new Set(SPOTS.map(s => s.id)).size, SPOTS.length);
  for (const s of [...SPOTS, ...Object.values(STATIONS)]) {
    assert.ok(walkable(s.x, s.z), `${s.id || s.name} walkable`);
    for (const o of OBSTACLES) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) >= o.r + 2.5, `${s.id || s.name} clear of a ${o.kind}`);
  }
  for (const f of [1, 2, 3]) assert.ok(SPOTS.filter(s => !s.lab && (s.x > 900 ? 3 : s.x > 300 ? 2 : 1) === f).length >= 6, `floor ${f} has spots`);
  const layers = Object.values(LABS).flatMap(l => l.layers);
  for (const s of SPOTS.filter(s => s.lab)) {
    const L = layers.find(L => L.id === s.lab), c = Math.floor((s.z - L.z0) / L.cell) * L.cols + Math.floor((s.x - L.x0) / L.cell);
    const bad = new Set([L.start[1] * L.cols + L.start[0], L.end[1] * L.cols + L.end[0], ...(L.trapList || []).map(x => x.c), ...(L.leverList || []).map(x => x.c), ...(L.chestList || []).map(x => x.c)]);
    assert.ok(!bad.has(c), `${s.id}: a quiet cell`);
    assert.ok(SPOT_TYPES[s.type].rare, `${s.id}: lab spots are rare ones`);
  }
  const town = [MERCHANT, HALL, SMITH, SHRINES[0], { x: 0, z: 0 }];
  for (const st of Object.values(STATIONS)) for (const o of town) assert.ok(Math.hypot(st.x - o.x, st.z - o.z) > st.use + 4, `${st.name} has room`);
  assert.equal(TILE_OFFSETS.length, PLOT_TILES);
});

await t('newLife: sanitises a saved record; Smith is known from the start', () => {
  const L = newLife({ skills: { herbalist: 50, miner: -3, bogus: 9 }, learned: ['herbalist', 'nope'], plot: [{ c: 'wheat', at: 5 }, { c: 'weed', at: 1 }], food: { id: 'bread', left: 9e9 }, spots: { f1h1: 7, zz: 1 } });
  assert.equal(L.skills.herbalist, 50); assert.equal(L.skills.miner, 0); assert.ok(!('bogus' in L.skills));
  assert.deepEqual(L.learned, ['herbalist', 'smith']);
  assert.deepEqual(L.plot[0], { c: 'wheat', at: 5, boost: 0 }); assert.equal(L.plot[1], null); assert.equal(L.plot.length, PLOT_TILES);
  assert.equal(L.food.left, FOODS.bread.secs * 1000);
  assert.deepEqual(L.spots, { f1h1: 7 });
  assert.deepEqual(newLife(null).learned, ['smith']);
});

// ---------- 2. in process ----------
const ws = { readyState: 1, send() {} };
const g = new Game();
let clock = 1_700_000_000_000;
g.lifeClock = () => clock;
let rnd = 0.5;
g.lifeRnd = () => rnd;
g.track = () => {};
for (const m of g.mobs.values()) { m.dead = true; m.deadUntil = Infinity; } // (no bites mid-test)
const sysTo = p => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);
const at = (p, o) => { p.x = o.x + 1; p.z = o.z + 1; };
const step = (secs) => { for (let i = 0; i < Math.round(secs * 20); i++) g.update(0.05); };
const act = (p, msg) => { g.time += 0.2; return g.handle(p, { type: 'life', ...msg }); }; // (past the rate limit)
const fresh = () => { const p = g.addPlayer(ws, `L${g.nextId}`, 'swordsman'); p.inv.mats = {}; g.events.length = 0; return p; };

await t('learn at the Life Hall only, free, once', () => {
  const p = fresh();
  p.x = 50; p.z = 50;
  assert.equal(act(p, { a: 'learn', id: 'herbalist' }), false);
  at(p, LIFE_HALL);
  assert.equal(act(p, { a: 'learn', id: 'herbalist' }), true);
  assert.equal(act(p, { a: 'learn', id: 'herbalist' }), false);
  assert.equal(act(p, { a: 'learn', id: 'bogus' }), false);
  for (const id of ['constructor', '__proto__', 'toString']) { assert.equal(act(p, { a: 'learn', id }), false); assert.equal(act(p, { a: 'gather', id }), false); assert.equal(act(p, { a: 'make', id }), false); assert.equal(act(p, { a: 'eat', id }), false); }
  assert.deepEqual(p.life.learned.sort(), ['herbalist', 'smith']);
  assert.ok(g.lifeMsg(p).learned.includes('herbalist'));
  assert.ok(p.lifeDirty && p.dirty);
});

await t('gathering: needs the skill, takes its time, cancels on a move, refills per player only', () => {
  const p = fresh(), q = fresh(), s = SPOT_BY_ID.f1h1;
  at(p, s); at(q, s);
  assert.equal(act(p, { a: 'gather', id: s.id }), false);
  assert.match(sysTo(p).join(), /Life Hall/);
  for (const o of [p, q]) { at(o, LIFE_HALL); act(o, { a: 'learn', id: 'herbalist' }); at(o, s); }
  assert.equal(act(p, { a: 'gather', id: 'f1o1' }), false); // too far
  assert.equal(act(p, { a: 'gather', id: s.id }), true);
  assert.equal(act(p, { a: 'gather', id: s.id }), false); // one at a time
  step(1); assert.ok(p.lifeAct);
  step(2); assert.equal(p.lifeAct, null);
  assert.ok(p.inv.mats.meadowleaf >= 1, 'got herbs: ' + sysTo(p).join(' / '));
  assert.ok(p.life.skills.herbalist >= SPOT_TYPES.meadow.xp);
  assert.equal(act(p, { a: 'gather', id: s.id }), false); // depleted for p
  assert.match(sysTo(p).join(), /back in/);
  assert.equal(act(q, { a: 'gather', id: s.id }), true); // ... not for q
  q.x += 3; step(0.2); assert.equal(q.lifeAct, null); // walked off
  clock += SPOT_KINDS.herb.respawn * 1000;
  assert.equal(act(p, { a: 'gather', id: s.id }), true); // refilled
  p.lastHurt = g.time + 0.01; step(0.1); assert.equal(p.lifeAct, null, 'a hit interrupts');
  assert.equal(act(p, { a: 'gather', id: 'f1h5' }), false); // Bloodcap needs Herbalist 3 (and to be there)
});

await t('level gate and stack cap', () => {
  const p = fresh(), s = SPOT_BY_ID.f1h5;
  at(p, LIFE_HALL); act(p, { a: 'learn', id: 'herbalist' }); at(p, s);
  assert.equal(act(p, { a: 'gather', id: s.id }), false);
  assert.match(sysTo(p).join(), /level 3/);
  p.life.skills.herbalist = LIFE_XP[3];
  p.inv.mats.bloodcap = STACK_MAX;
  assert.equal(act(p, { a: 'gather', id: s.id }), false);
  assert.match(sysTo(p).join(), /carry more/);
  p.inv.mats.bloodcap = STACK_MAX - 1; rnd = 0.99;
  assert.equal(act(p, { a: 'gather', id: s.id }), true); step(3);
  assert.equal(p.inv.mats.bloodcap, STACK_MAX, 'the stack stops at its cap');
  rnd = 0.5;
});

await t('fishing: strike in the bite window; too soon or too late loses it', () => {
  const p = fresh(), s = SPOT_BY_ID.f1f1;
  at(p, LIFE_HALL); act(p, { a: 'learn', id: 'fisher' }); at(p, s);
  assert.equal(act(p, { a: 'gather', id: s.id }), true);
  assert.equal(act(p, { a: 'hook' }), false); assert.match(sysTo(p).join(), /Too soon/);
  assert.equal(act(p, { a: 'gather', id: s.id }), true); // a miss doesn't use the pool up
  const bite = p.lifeAct.biteAt;
  while (g.time < bite) step(0.05);
  assert.ok(g.events.some(e => e.t === 'lifebite' && e.to === p.id));
  assert.ok(g.lifeMsg(p).act.bite);
  assert.equal(g.handle(p, { type: 'life', a: 'hook' }), true);
  assert.ok(p.inv.mats.minnow >= 1);
  clock += SPOT_KINDS.fish.respawn * 1000;
  act(p, { a: 'gather', id: s.id }); step(SPOT_KINDS.fish.bite[1] + SPOT_KINDS.fish.window + 1);
  assert.equal(p.lifeAct, null); assert.match(sysTo(p).join(), /Too late/);
});

await t('garden: seeds from the merchant, plant, grow in wall time, harvest; tending bots speed it up', () => {
  const p = fresh();
  p.gold = 100;
  p.x = MERCHANT.x; p.z = MERCHANT.z;
  const i = SHOP.findIndex(s => s.id === 'wheatseed');
  g.handle(p, { type: 'buy', i }); g.handle(p, { type: 'buy', i });
  assert.equal(p.inv.mats.wheatseed, 2); assert.equal(p.gold, 100 - 2 * SHOP[i].price);
  at(p, GARDEN);
  assert.equal(act(p, { a: 'plant', tile: 0, seed: 'wheatseed' }), false); // not a Farmer yet
  at(p, LIFE_HALL); act(p, { a: 'learn', id: 'farmer' }); at(p, GARDEN);
  assert.equal(act(p, { a: 'plant', tile: 0, seed: 'wheatseed' }), true);
  assert.equal(act(p, { a: 'plant', tile: 0, seed: 'wheatseed' }), false); // taken
  assert.equal(act(p, { a: 'plant', tile: 1, seed: 'carrotseed' }), false); // none
  assert.equal(act(p, { a: 'plant', tile: 9, seed: 'wheatseed' }), false);
  assert.equal(act(p, { a: 'harvest' }), false); // not ripe
  clock += CROPS.wheat.grow / 2;
  assert.equal(g.lifeMsg(p).plot[0].g, 0.5);
  // a bot of p's, near the garden: crops grow TEND.mult times as fast
  const b = g.addPlayer(ws, 'Tender', 'guardian'); b.bot = true; b.pbOwner = p.id; b.x = GARDEN.x + 3; b.z = GARDEN.z;
  step(TEND.every * 2 + 0.1);
  assert.ok(p.life.plot[0].boost >= TEND.every * 2 * 1000 * (TEND.mult - 1) - 1, 'tending adds growth');
  assert.ok(g.lifeMsg(p).tend);
  b.x = 60; step(TEND.every + 0.1); assert.equal(g.lifeMsg(p).tend, false);
  g.players.delete(b.id);
  clock += CROPS.wheat.grow / 2;
  assert.equal(act(p, { a: 'harvest' }), true);
  assert.ok(p.inv.mats.wheat >= CROPS.wheat.yield[0]);
  assert.equal(p.life.plot[0], null);
  assert.ok(p.life.skills.farmer >= CROPS.wheat.xp);
  act(p, { a: 'plant', tile: 2, seed: 'wheatseed' });
  assert.equal(act(p, { a: 'uproot', tile: 2 }), true); assert.equal(p.life.plot[2], null);
  p.x = 60; assert.equal(act(p, { a: 'harvest' }), false); // away from the garden
});

await t('cooking and alchemy: at their station, level-gated, eat a meal: one buff at a time', () => {
  const p = fresh();
  at(p, LIFE_HALL); act(p, { a: 'learn', id: 'cook' }); act(p, { a: 'learn', id: 'alchemist' });
  p.inv.mats = { wheat: 6, meadowleaf: 6, carrot: 1, minnow: 2 };
  assert.equal(act(p, { a: 'make', id: 'bread' }), false); // not at the fire
  at(p, COOK_FIRE);
  assert.equal(act(p, { a: 'make', id: 'bread' }), true);
  assert.equal(p.inv.mats.wheat, 3); assert.equal(p.inv.mats.bread, 2);
  assert.equal(act(p, { a: 'make', id: 'fishstew' }), false); // Cook 2
  p.life.skills.cook = LIFE_XP[2];
  assert.equal(act(p, { a: 'make', id: 'fishstew' }), true); assert.equal(p.inv.mats.fishstew, 1);
  assert.equal(act(p, { a: 'make', id: 'potion' }), false); // that's the bench
  at(p, ALCH_BENCH);
  const pots = p.inv.cons.potion;
  assert.equal(act(p, { a: 'make', id: 'potion' }), true);
  assert.equal(p.inv.cons.potion, pots + 2); assert.equal(p.inv.mats.meadowleaf, 3);
  // meals
  const atk = g.dmgMult(p), post = g.postureMul(p, { def: {} });
  assert.equal(act(p, { a: 'eat', id: 'fishstew' }), true);
  assert.equal(p.life.food.id, 'fishstew'); assert.equal(p.inv.mats.fishstew, 0);
  assert.ok(Math.abs(g.postureMul(p, { def: {} }) / post - 1.12) < 1e-9, 'posture +12%');
  assert.equal(g.dmgMult(p), atk);
  assert.equal(act(p, { a: 'eat', id: 'fishstew' }), false); // none left
  p.inv.mats.spicedeel = 1; p.inv.mats.carrotpie = 1;
  const hp0 = p.maxHp;
  act(p, { a: 'eat', id: 'carrotpie' });
  assert.equal(p.maxHp, Math.round(hp0 * 1.08)); assert.equal(g.postureMul(p, { def: {} }), post, 'the stew is replaced');
  act(p, { a: 'eat', id: 'spicedeel' });
  assert.equal(p.maxHp, hp0); assert.ok(Math.abs(g.dmgMult(p) / atk - 1.06) < 1e-9);
  // bread: health back over time, even in a fight; the meal wears off (game time)
  act(p, { a: 'eat', id: 'bread' });
  p.x = 0; p.z = 60; p.hp = Math.round(p.maxHp / 2); p.lastHurt = g.time;
  const h0 = p.hp; step(5.05);
  assert.ok(Math.abs(p.hp - h0 - p.maxHp * 0.004 * 5) <= 1.01 && p.hp > h0, `regen ${h0} -> ${p.hp} of ${p.maxHp}`);
  p.life.food.left = 500; step(1.1);
  assert.equal(p.life.food, null); assert.match(sysTo(p).join(), /wore off/);
});

await t('Smith life skill levels from Smith actions; rate limit; the saved record', () => {
  const p = fresh();
  p.x = SMITH.x; p.z = SMITH.z + 2.5; p.gold = 1e5; p.inv.mats = { tusk: 99, dust: 99, ess: 99 };
  assert.equal(g.craft(p, 'tuskbreaker'), true);
  assert.equal(p.life.skills.smith, 30);
  g.time += 1;
  assert.equal(g.handle(p, { type: 'life', a: 'cancel' }), true);
  assert.equal(g.handle(p, { type: 'life', a: 'cancel' }), false, 'a second message in the same instant is dropped');
  p.life.food = { id: 'bread', left: 1234.4 };
  const rec = JSON.parse(JSON.stringify(lifeRecord(p)));
  assert.deepEqual(newLife(rec).food, { id: 'bread', left: 1234 });
  assert.equal(newLife(rec).skills.smith, 30);
});

// ---------- 3. a real server with a database ----------
const DB = process.env.DATABASE_URL;
if (!DB) { console.log(`${n} life tests passed (DB part skipped: set DATABASE_URL)`); process.exit(0); }
const { default: WebSocket } = await import('ws');
const PORT = Number(process.env.PORT) || 3431;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(40); }
  throw new Error(`timed out waiting for ${what}`);
}
function start() {
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), TEST_HOOKS: '1', MAX_BOTS: '0', NAMED_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; }); srv.stderr.on('data', d => { srv.log += d; });
  srv.done = new Promise(r => srv.on('exit', r));
  return srv;
}
const call = async (method, p, token, body) => {
  const r = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
function client(join) {
  const c = { last: {}, sys: [] };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify(join)));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    c.last[m.type] = m;
    if (m.type === 'welcome') { c.id = m.id; c.ws.send(JSON.stringify({ type: 'test', ward: 1 })); } // (no bites mid-test: TEST_HOOKS)
    if (m.type === 'snap') { c.me = m.me; for (const e of m.w.events) if (e.t === 'sys' && e.to === c.id) c.sys.push(e.text); }
  });
  c.send = o => c.ws.send(JSON.stringify(o));
  c.closed = new Promise(r => c.ws.on('close', r));
  return c;
}
let srv = start();
try {
  await until(() => /running on/.test(srv.log), 15000, 'server start');
  const tok = (await call('POST', '/api/guest')).token;
  const ch = (await call('POST', '/api/characters', tok, { name: `Life${Math.random().toString(36).slice(2, 7)}`, cls: 'cleric' })).character;
  assert.ok(ch?.id, 'character made');
  { const { default: pg } = await import('pg'); const pool = new pg.Pool({ connectionString: DB }); await pool.query('UPDATE characters SET gold = 100 WHERE id = $1', [ch.id]); await pool.end(); } // (seed money)
  let c = client({ type: 'join', session: tok, character: ch.id });
  globalThis.lastSys = () => c.sys.slice(-8).join(' / ');
  await until(() => c.last.life, 8000, 'life message on join');
  const tp = async (o, dx = 1) => { c.send({ type: 'test', life: { tp: [o.x + dx, o.z + 1] } }); await sleep(150); };
  const life = () => c.last.life;
  await tp(LIFE_HALL);
  for (const id of ['herbalist', 'farmer', 'cook']) { c.send({ type: 'life', a: 'learn', id }); await sleep(200); }
  await until(() => ['herbalist', 'farmer', 'cook'].every(id => life().learned.includes(id)), 5000, 'learned');
  const s = SPOT_BY_ID.f1h1;
  await tp(s);
  c.send({ type: 'life', a: 'gather', id: s.id });
  await until(() => life().act?.k === 'herb', 3000, 'gathering');
  await until(() => !life().act && c.last.inv?.mats?.meadowleaf >= 1, 6000, 'herbs gathered');
  assert.ok(life().spots[s.id] > 0, 'the spot is spent for us');
  await tp(MERCHANT);
  const si = SHOP.findIndex(x => x.id === 'wheatseed');
  for (let k = 0; k < 3; k++) { c.send({ type: 'buy', i: si }); await sleep(120); }
  await until(() => c.last.inv?.mats?.wheatseed === 3, 4000, 'seeds bought');
  await tp(GARDEN);
  c.send({ type: 'life', a: 'plant', tile: 0, seed: 'wheatseed' }); await sleep(200);
  c.send({ type: 'life', a: 'plant', tile: 3, seed: 'wheatseed' });
  await until(() => life().plot[0]?.c === 'wheat' && life().plot[3]?.c === 'wheat', 4000, 'planted');
  // restart: the plot, skills and the spot timer come back
  c.ws.close(); await c.closed; await sleep(400);
  srv.kill('SIGTERM'); await srv.done;
  srv = start();
  await until(() => /running on/.test(srv.log), 15000, 'server restart');
  c = client({ type: 'join', session: tok, character: ch.id });
  await until(() => c.last.life, 8000, 'life after restart');
  assert.equal(life().plot[0].c, 'wheat'); assert.equal(life().plot[3].c, 'wheat');
  assert.ok(life().plot[0].left > 0 && life().plot[0].left <= CROPS.wheat.grow / 1000);
  assert.ok(life().skills.herbalist >= SPOT_TYPES.meadow.xp && life().learned.includes('cook'));
  assert.ok(life().spots[s.id] > 0, 'spot timer kept');
  // time passes (wall clock, test skew): ripe; harvest; cook bread; eat it
  c.send({ type: 'test', life: { skip: CROPS.wheat.grow + 1000 } });
  await until(() => life().plot[0]?.g >= 1, 4000, 'ripe');
  await tp(GARDEN);
  c.send({ type: 'life', a: 'harvest' });
  await until(() => !life().plot[0] && !life().plot[3] && c.last.inv?.mats?.wheat >= 4, 4000, 'harvested');
  await tp(COOK_FIRE);
  c.send({ type: 'life', a: 'make', id: 'bread' });
  await until(() => c.last.inv?.mats?.bread >= 2, 4000, 'bread');
  await sleep(200); c.send({ type: 'life', a: 'eat', id: 'bread' });
  await until(() => life().food?.id === 'bread', 4000, 'meal buff');
  c.ws.close(); await c.closed; await sleep(400);
  srv.kill('SIGTERM'); await srv.done;
  srv = start();
  await until(() => /running on/.test(srv.log), 15000, 'second restart');
  c = client({ type: 'join', session: tok, character: ch.id });
  await until(() => c.last.life, 8000, 'life after the second restart');
  assert.equal(life().food?.id, 'bread', 'the meal survives a restart');
  assert.ok(life().food.left > FOODS.bread.secs - 60);
  assert.ok(life().skills.farmer >= 2 * CROPS.wheat.xp && life().skills.cook >= 16);
  c.ws.close(); await c.closed;
  n++; console.log('ok DB: gather, plant, restart, time passes, harvest, cook, eat; it all persists');
} catch (e) {
  console.log(srv.log.slice(-3000));
  console.log('sys:', globalThis.lastSys?.());
  throw e;
} finally {
  srv.kill('SIGTERM'); await srv.done;
}
console.log(`${n} life tests passed`);
process.exit(0);
