// Cinematic camera, server side (docs/ROADMAP.md F4; server/cine.js):
//  - cine(op, data) validates, pushes a `cine` event and keeps the lasting state (shot, light, letterbox, clean, black, title);
//  - targets in all three shapes ({ pid }, { mid }, { x, z }) and [x, z];
//  - a spectator that joins gets { type: 'cine', state } right after the roster, and live `cine` events in snapshots.
// Usage: PORT=3741 node test/cine.js
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { SHOTS } from '../server/cine.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const take = (g, op) => { const e = g.events.filter(x => x.t === 'cine' && (!op || x.op === op)); g.events = []; return e; };

// ---------- in-process ----------
{
  const g = new Game();
  const p = g.addPlayer(null, 'Bram', 'guardian');
  const m = g.addMob('wolf', 0, 70);
  g.events = [];
  assert.deepEqual(g.cineState(), { shot: null, light: null, letterbox: false, clean: false, black: false, title: null });
  ok('fresh state is the normal picture');

  for (const shot of SHOTS) assert.equal(g.cine('shot', { shot, target: { pid: p.id }, secs: 2 }), true);
  assert.equal(g.cine('shot', { shot: 'dolly_zoom' }), false);
  assert.equal(g.cine('zoom', {}), false);
  ok('every shot name is accepted; unknown shots and ops are refused');
  assert.ok(SHOTS.includes('pov') && SHOTS.includes('eyes'));
  g.cine('shot', { shot: 'eyes', target: 'Bram', secs: 0 });
  assert.deepEqual(take(g, 'shot').at(-1), { t: 'cine', op: 'shot', shot: 'eyes', target: { pid: p.id }, secs: 0 });
  ok('F8: the pov and eyes shots ride a character');

  take(g);
  g.cine('shot', { shot: 'close_up', target: { pid: p.id }, secs: 4 });
  let [e] = take(g, 'shot');
  assert.deepEqual(e, { t: 'cine', op: 'shot', shot: 'close_up', target: { pid: p.id }, secs: 4 });
  g.cine('shot', { shot: 'wide', target: { mid: m.id } });
  [e] = take(g, 'shot');
  assert.deepEqual(e.target, { mid: m.id }); assert.equal(e.secs, 1.5);
  g.cine('shot', { shot: 'crane', target: { x: -9, z: 3 }, secs: 0 });
  [e] = take(g, 'shot');
  assert.deepEqual(e.target, { x: -9, z: 3 }); assert.equal(e.secs, 0);
  g.cine('shot', { shot: 'orbit', target: [12.345, -4] });
  assert.deepEqual(take(g, 'shot')[0].target, { x: 12.35, z: -4 });
  g.cine('shot', { shot: 'over_shoulder', target: { mid: m.id }, from: { pid: p.id } });
  [e] = take(g, 'shot');
  assert.deepEqual([e.target, e.from], [{ mid: m.id }, { pid: p.id }]);
  g.cine('shot', { shot: 'medium', target: 'bram' });
  assert.deepEqual(take(g, 'shot')[0].target, { pid: p.id });
  ok('targets: { pid }, { mid }, { x, z }, [x, z], a player name; from for over_shoulder');

  g.cine('shot', { shot: 'follow', target: { pid: p.id }, secs: 1 });
  assert.deepEqual(g.cineState().shot, { shot: 'follow', target: { pid: p.id }, secs: 1 });
  g.cine('shot', { shot: 'free' });
  assert.equal(g.cineState().shot, null);
  ok('the current shot is kept; free clears it');

  take(g);
  g.cine('letterbox', { on: true }); g.cine('clean', { on: true }); g.cine('light', { light: 'eclipse' }); g.cine('fade', { to: 'black', secs: 1.5 });
  let st = g.cineState();
  assert.deepEqual([st.letterbox, st.clean, st.light, st.black], [true, true, 'eclipse', true]);
  const evs = take(g);
  assert.deepEqual(evs.map(x => x.op), ['letterbox', 'clean', 'light', 'fade']);
  assert.deepEqual(evs[3], { t: 'cine', op: 'fade', to: 'black', secs: 1.5 });
  g.cine('letterbox', { on: false }); g.cine('clean', { on: 'off' }); g.cine('light', 'day'); g.cine('fade', { to: 'in' });
  st = g.cineState();
  assert.deepEqual([st.letterbox, st.clean, st.light, st.black], [false, false, 'day', false]);
  g.cine('light', { to: 'eclipse' }); assert.equal(g.cineState().light, 'eclipse');
  g.cine('light', { light: null }); assert.equal(g.cineState().light, null);
  ok('letterbox, clean, light and fade are kept (light also as a plain string or `to`)');

  take(g);
  g.time = 100;
  g.cine('title', { text: 'DAY 41', secs: 3 });
  assert.deepEqual(take(g, 'title')[0], { t: 'cine', op: 'title', text: 'DAY 41', secs: 3 });
  g.time = 101; assert.deepEqual(g.cineState().title, { text: 'DAY 41', secs: 2 });
  g.time = 103.5; assert.equal(g.cineState().title, null);
  g.cine('title', { text: 'FLOOR 1 CLEARED', sub: 'ninety-nine bells to go', secs: 4 });
  assert.equal(g.cineState().title.sub, 'ninety-nine bells to go');
  g.cine('slowmo', { secs: 1.2, scale: 0.35 });
  assert.deepEqual(take(g, 'slowmo')[0], { t: 'cine', op: 'slowmo', secs: 1.2, scale: 0.35 });
  g.cine('slowmo', { scale: 9 }); assert.equal(take(g, 'slowmo')[0].scale, 1);
  ok('titles are kept only while on screen; slowmo is an event only (clamped)');

  g.cine('letterbox', { on: true }); g.cine('shot', { shot: 'wide', target: { x: 0, z: 0 } });
  g.cine('reset');
  assert.deepEqual(g.cineState(), { shot: null, light: null, letterbox: false, clean: false, black: false, title: null });
  assert.equal(take(g, 'reset').length, 1);
  ok('reset puts the picture back to normal');
}

// ---------- over the wire: a spectator joining gets the state ----------
{
  const PORT = process.env.PORT || 3741;
  process.env.PORT = PORT;
  delete process.env.DATABASE_URL;
  let game = null;
  const upd = Game.prototype.update;
  Game.prototype.update = function (dt) { game = this; return upd.call(this, dt); };
  await import('../server/index.js');
  const t0 = Date.now();
  while (!game && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
  assert.ok(game, 'server ticking');
  await new Promise(r => setTimeout(r, 300));

  game.cine('letterbox', { on: true });
  game.cine('light', { light: 'eclipse' });
  game.cine('shot', { shot: 'orbit', target: { x: -9, z: 3 }, secs: 2 });

  const connect = () => new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d)));
    ws.on('open', () => res({ ws, msgs }));
    ws.on('error', rej);
  });
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 30)); } return null; };

  const sp = await connect();
  sp.ws.send(JSON.stringify({ type: 'spectate' }));
  const cm = await until(() => sp.msgs.find(m => m.type === 'cine'));
  assert.ok(cm, 'spectator got a cine message');
  const types = sp.msgs.map(m => m.type);
  assert.ok(types.indexOf('welcome') < types.indexOf('cine'));
  assert.deepEqual(cm.state, { shot: { shot: 'orbit', target: { x: -9, z: 3 }, secs: 2 }, light: 'eclipse', letterbox: true, clean: false, black: false, title: null });
  ok('a spectator joining gets the current shot, light and letterbox');

  game.cine('title', { text: 'DAY 41', secs: 3 });
  const live = await until(() => sp.msgs.filter(m => m.type === 'snap').flatMap(m => m.w.events).find(e => e.t === 'cine' && e.op === 'title'));
  assert.deepEqual(live, { t: 'cine', op: 'title', text: 'DAY 41', secs: 3 });
  ok('live cine events reach spectators in snapshots');

  const pl = await connect();
  pl.ws.send(JSON.stringify({ type: 'join', name: 'Tester', cls: 'cleric' }));
  const pm = await until(() => pl.msgs.find(m => m.type === 'cine'));
  assert.equal(pm?.state.light, 'eclipse');
  ok('a player joining gets the state too (the client only uses its light)');

  sp.ws.close(); pl.ws.close();
  console.log(`# ${n} passed`);
  process.exit(0);
}
