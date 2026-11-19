// Looks (docs/ROADMAP.md I2): the look table is sound (shared/looks.js), the loner's look is complete and his own, the
// Heroes share a base; setLook works on any entity (players and mobs), is opt-in, and is listed in snapshots (w.looks)
// so a late joiner or spectator sees it, without touching the player rows bots index into or the roster.
// Usage: node test/looks.js        (PORT=5460 by default for the live late-join check)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js'; // (its admin actions: server/botedit.js)
import { LOOKS, LOOK_IDS, isLook, lookOf, validateLooks } from '../shared/looks.js';
import { NAMED } from '../shared/named.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

{ // the table
  assert.deepEqual(validateLooks(), []);
  for (const id of ['cairn', 'hearthward', 'halvard', 'maribel', 'tovin', 'sennet']) assert.ok(isLook(id), id);
  assert.equal(isLook('toString'), false); assert.equal(isLook(3), false); assert.equal(lookOf('nope'), null);
  assert.ok(validateLooks({ Bad: {} }).length, 'bad id');
  assert.ok(validateLooks({ aa: { base: 'zz' } }).length, 'unknown base');
  assert.ok(validateLooks({ aa: { cloak: 'red' } }).length, 'a part that is not an object');
  assert.ok(validateLooks({ aa: { cloak: { color: '#ff0000' } } }).length, 'colours are numbers');
  assert.ok(validateLooks({ aa: { plate: { color: 'red' } } }).length, 'plate colours are #rrggbb');
  assert.ok(validateLooks({ aa: { scale: 3 } }).length, 'scale range');
  ok('the look table validates; bad tables are caught');
}
{ // the loner: every part of a recognisable look, in colours nobody else has
  const l = lookOf('cairn');
  for (const k of ['tint', 'hair', 'cloak', 'weapon', 'aura', 'plate', 'swatch']) assert.ok(l[k] && typeof l[k] === 'object', `loner.${k}`);
  assert.equal(l.cloak.kind, 'coat'); assert.ok(l.cloak.mantle); assert.ok(l.hair.tail);
  assert.ok(l.weapon.model); assert.ok(l.aura.motes && l.aura.trail && l.aura.ground);
  assert.ok(l.plate.title && l.plate.color && l.emblem && l.cloak.mantle.mark);
  const others = LOOK_IDS.filter(id => id !== 'cairn').map(lookOf);
  const colours = o => JSON.stringify(o).match(/\d{5,8}/g) || [];
  for (const o of others) {
    assert.notEqual(o.plate?.color, l.plate.color, `${o.id}: plate colour`);
    assert.ok(!colours(o).includes(String(l.aura.color)), `${o.id} uses the loner's light`);
    assert.ok(!colours(o).includes(String(l.cloak.color)), `${o.id} uses the loner's coat colour`);
    assert.notEqual(o.weapon?.model, l.weapon.model);
  }
  ok('the loner has every part, and his colours and weapon are his alone');
}
{ // the Heroes: one base (party colour, emblem, plate), a trim each; data only
  const base = lookOf('hearthward'), heroes = ['halvard', 'maribel', 'tovin', 'sennet'].map(lookOf);
  assert.equal(base.cloak.kind, 'cape'); assert.equal(base.emblem, 'hearth');
  for (const h of heroes) {
    assert.equal(h.base, undefined, 'the base is folded in');
    assert.equal(h.cloak.color, base.cloak.color); assert.equal(h.cloak.emblem, 'hearth'); assert.deepEqual(h.plate, base.plate);
    assert.equal(h.cloak.trim, LOOKS[h.id].cloak.trim, 'own trim wins');
    assert.equal(h.weapon, undefined, 'their weapons stay');
  }
  assert.equal(new Set(heroes.map(h => h.cloak.trim)).size, 4, 'a trim colour each');
  assert.equal(LOOKS.hearthward.cloak.trim, lookOf('hearthward').cloak.trim, 'folding never changes the table');
  ok('the four Heroes share the party cape, emblem and plate, with a trim each');
}

{ // the Named (shared/named.js) each name a look that exists; the loner's is his own, the Heroes share a base
  for (const d of NAMED) {
    assert.ok(isLook(d.look?.id), `${d.id}: look.id`);
    assert.ok(Number.isInteger(d.look.color), `${d.id}: look.color (the plain portrait colour)`);
    assert.equal(LOOKS[d.look.id].base, d.group === 'heroes' ? 'hearthward' : undefined, `${d.id}: base`);
  }
  assert.equal(new Set(NAMED.map(d => d.look.id)).size, NAMED.length, 'one look each');
  ok('every Named in shared/named.js has a look of its own');
}

const g = new Game();
const a = g.addPlayer(null, 'Vesper', 'swordsman'), b = g.addPlayer(null, 'Bram', 'guardian');
const snap = () => JSON.parse(g.snapshot());
{ // opt-in: nothing wears a look by default
  const w = snap();
  assert.equal(w.looks, undefined, 'no looks key when nobody wears one');
  assert.ok(g.roster().every(r => !('look' in r)), 'the roster is as before');
  ok('nothing has a look until setLook is called (no w.looks key)');
}
{ // set, list, refuse unknown, clear
  const row = snap().players[0].length;
  assert.equal(g.setLook(a, 'cairn'), true);
  assert.equal(g.setLook(a, 'cairn'), false, 'same look again: no change');
  assert.equal(g.setLook(a, 'tuxedo'), false); assert.equal(g.setLook(a, 'constructor'), false); assert.equal(a.look, 'cairn');
  assert.equal(g.setLook(null, 'cairn'), false);
  const w1 = snap(), w2 = snap();
  assert.deepEqual(w1.looks, [[a.id, 'cairn']]);
  assert.deepEqual(w2.looks, [[a.id, 'cairn']], 'in every snapshot (late joiners)');
  assert.equal(w2.players[0].length, row, 'player row layout unchanged');
  g.setLook(b, 'halvard');
  assert.deepEqual(snap().looks, [[a.id, 'cairn'], [b.id, 'halvard']]);
  assert.equal(g.setLook(b, null), true); assert.equal(g.setLook(a, 'none'), true);
  assert.equal(snap().looks, undefined);
  ok('setLook stores a known look, snapshots list it as [id, look], null clears it');
}
{ // any entity with an id: a mob
  const m = [...g.mobs.values()].find(m => m.type === 'boar');
  assert.equal(g.setLook(m, 'cairn'), true);
  g.setLook(a, 'tovin');
  assert.deepEqual(snap().looks, [[a.id, 'tovin'], [m.id, 'cairn']]);
  m.dead = true;
  assert.deepEqual(snap().looks, [[a.id, 'tovin']], 'a dead mob is not listed');
  m.dead = false; g.setLook(m, null); g.setLook(a, null);
  ok('a look works on any entity with an id (a mob), not only players');
}
{ // the testing aid is off unless TEST_HOOKS is set
  const was = process.env.TEST_HOOKS;
  delete process.env.TEST_HOOKS;
  g.handle(a, { type: 'test', look: 'cairn' });
  assert.equal(a.look ?? null, null, 'ignored without TEST_HOOKS');
  process.env.TEST_HOOKS = '1';
  g.handle(a, { type: 'test', look: 'cairn' });
  assert.equal(a.look, 'cairn');
  g.handle(a, { type: 'test', hurt: 0.5 }); // the other test hooks still work
  assert.equal(a.hp, Math.round(a.maxHp * 0.5));
  g.handle(a, { type: 'test', look: null });
  assert.equal(a.look, null);
  if (was === undefined) delete process.env.TEST_HOOKS; else process.env.TEST_HOOKS = was;
  ok('{ type: test, look } wears a look only with TEST_HOOKS=1');
}
{ // the admin action on a bot (server/botedit.js action 'look')
  const e = { bid: 1 }, mgr = { game: g, entry: () => e, live: () => b, view: x => ({ look: x.look || '' }), action: BotManager.prototype.action };
  assert.deepEqual(mgr.action(1, 'look', { look: 'maribel' }), { look: 'maribel' });
  assert.equal(b.look, 'maribel'); assert.equal(e.look, 'maribel');
  assert.throws(() => mgr.action(1, 'look', { look: 'tuxedo' }), /Unknown look/);
  assert.equal(b.look, 'maribel', 'a bad look changes nothing');
  assert.deepEqual(mgr.action(1, 'look', {}), { look: '' });
  assert.equal(b.look, null);
  ok('admin bot action look: wears a look, refuses unknown ones, clears with none');
}

// ---------- live: a spectator who connects later sees who wears what ----------
const port = Number(process.env.PORT) || 5460;
const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DATABASE_URL: '', SPAWN_AT: '0,150', TEST_HOOKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', d => { out += d; if (/running on/.test(out)) resolve(); });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', c => reject(new Error(`server exited ${c}: ${out}`)));
    setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 10000);
  });
  const conn = (first, until) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`), st = { snaps: 0 };
    ws.on('open', () => ws.send(JSON.stringify(first)));
    ws.on('message', raw => { const m = JSON.parse(raw); if (until(m, st, ws)) resolve({ ws, st }); });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });
  const plain = await conn({ type: 'join', name: 'Tamsin', cls: 'cleric' }, (m, s) => {
    if (m.type === 'snap' && s.snaps < 3) { s.snaps++; assert.equal(m.w.looks, undefined); }
    return s.snaps >= 3;
  });
  ok('a live server sends no w.looks while nobody wears a look');
  const { ws: pws, st } = await conn({ type: 'join', name: 'Vesper', cls: 'swordsman' }, (m, s, ws) => {
    if (m.type === 'welcome') { s.id = m.id; ws.send(JSON.stringify({ type: 'test', look: 'cairn' })); }
    return m.type === 'snap' && m.w.looks?.some(([id, k]) => id === s.id && k === 'cairn');
  });
  ok('a live look shows up in the wearer\'s own snapshots');
  const { ws: sws } = await conn({ type: 'spectate' }, m => m.type === 'snap' && m.w.looks?.length === 1 && m.w.looks[0][0] === st.id && m.w.looks[0][1] === 'cairn');
  ok('a spectator joining later sees it');
  pws.close(); sws.close(); plain.ws.close();
} finally { proc.kill(); }
console.log(`# ${n} passed`);
