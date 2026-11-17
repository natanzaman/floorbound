// Poses (docs/ROADMAP.md F5): setPose stores and announces a pose; /kneel /sit /bow /stand chat sets it (never shown as
// chat); moving, a skill, a dodge, a jump, guarding or dying clears it; snapshots list current poses (w.poses) so a late
// joiner or spectator sees them, without touching the player rows bots index into.
// Usage: node test/poses.js        (PORT=3750 by default for the live late-join check)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';

const g = new Game();
g.mobs.clear(); g.boss = null;
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

const a = g.addPlayer(null, 'Pell', 'swordsman');
const b = g.addPlayer(null, 'Bram', 'guardian');
for (const p of [a, b]) { p.x = 0; p.z = 150; }
g.time = 10; clear();

{ // set, announce, no-op repeat, unknown kinds refused, 'none' clears
  assert.equal(g.setPose(a, 'kneel'), true);
  assert.equal(a.pose, 'kneel');
  assert.deepEqual(ev('pose'), [{ t: 'pose', id: a.id, k: 'kneel' }]);
  assert.equal(g.setPose(a, 'kneel'), false, 'same pose again: no event');
  assert.equal(g.setPose(a, 'dance'), false); assert.equal(a.pose, 'kneel');
  clear();
  g.setPose(a, 'none');
  assert.equal(a.pose, null);
  assert.deepEqual(ev('pose'), [{ t: 'pose', id: a.id, k: null }]);
  ok('setPose stores the pose and sends { t: pose, id, k }');
}
{ // snapshot: w.poses while held, left out when empty; player rows unchanged
  clear();
  const row0 = JSON.parse(g.snapshot()).players[0].length;
  assert.equal(JSON.parse(g.snapshot()).poses, undefined, 'no poses key when nobody is posed');
  g.setPose(b, 'bow');
  const w1 = JSON.parse(g.snapshot()), w2 = JSON.parse(g.snapshot());
  assert.deepEqual(w1.poses, [[b.id, 'bow']]);
  assert.deepEqual(w2.poses, [[b.id, 'bow']], 'still listed after the event went out (late joiners)');
  assert.equal(w2.players[0].length, row0, 'player row layout unchanged');
  g.setPose(b, null);
  ok('snapshots list current poses (w.poses) only while any is held');
}
{ // chat commands
  clear();
  g.handle(a, { type: 'chat', text: '/sit' });
  assert.equal(a.pose, 'sit');
  g.handle(a, { type: 'chat', text: '/BOW ' });
  assert.equal(a.pose, 'bow');
  g.handle(a, { type: 'chat', text: '/stand' });
  assert.equal(a.pose, null);
  g.handle(a, { type: 'chat', text: '/sit down please' }); // not a command: ordinary chat
  assert.equal(a.pose, null);
  const chats = ev('chat');
  assert.equal(chats.length, 1); assert.equal(chats[0].text, '/sit down please');
  ok('/kneel /sit /bow /stand set the pose and never show as chat');
}
{ // clears on move (not on turning in place)
  g.setPose(a, 'kneel'); clear();
  g.time += 0.05;
  g.onInput(a, { x: a.x, z: a.z, face: 1.2, seq: a.posSeq });
  assert.equal(a.pose, 'kneel', 'turning in place keeps it');
  g.time += 0.05;
  g.onInput(a, { x: a.x + 0.3, z: a.z, face: 1.2, seq: a.posSeq });
  assert.equal(a.pose, null);
  assert.deepEqual(ev('pose'), [{ t: 'pose', id: a.id, k: null }]);
  ok('moving clears the pose; turning in place does not');
}
{ // clears on a skill / attack (only when it is used), dodge, jump, guard
  g.setPose(a, 'sit');
  a.cds[0] = g.time + 5; g.useSkill(a, 0, 0);
  assert.equal(a.pose, 'sit', 'a skill on cooldown does nothing');
  a.cds[0] = 0; g.useSkill(a, 0, 0);
  assert.equal(a.pose, null, 'attack');
  g.setPose(a, 'sit'); g.dodge(a, 0);
  assert.equal(a.pose, null, 'dodge');
  g.time += 2;
  g.setPose(a, 'bow'); g.jump(a);
  assert.equal(a.pose, null, 'jump');
  g.time += 2;
  assert.equal(g.setPose(a, 'kneel'), true);
  g.setPose(b, 'kneel'); g.guard(b, true);
  assert.equal(b.pose, null, 'guard'); g.guard(b, false);
  ok('attacking, a skill, dodging, jumping and guarding clear it');
}
{ // clears on death (damage or any other path), refused while dead
  clear();
  g.setPose(b, 'kneel');
  g.damagePlayer(b, 1e9, { peril: true, src: 'test' });
  assert.ok(b.dead);
  g.update(0.05);
  assert.equal(b.pose, null, 'death clears it');
  assert.equal(g.setPose(b, 'sit'), false, 'no pose while dead');
  a.pose = 'sit'; a.dead = true; g.update(0.05); a.dead = false; // e.g. a scripted death that sets dead directly
  assert.equal(a.pose, null);
  ok('dying clears it; the dead cannot pose');
}

// ---------- live: a spectator who connects after the pose sees it ----------
const port = Number(process.env.PORT) || 3750;
const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DATABASE_URL: '', SPAWN_AT: '0,150' }, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', d => { out += d; if (/running on/.test(out)) resolve(); });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', c => reject(new Error(`server exited ${c}: ${out}`)));
    setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 10000);
  });
  const conn = (first, until) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`), st = {};
    ws.on('open', () => ws.send(JSON.stringify(first)));
    ws.on('message', raw => { const m = JSON.parse(raw); if (until(m, st, ws)) resolve({ ws, st }); });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });
  const { ws: pws, st } = await conn({ type: 'join', name: 'Tamsin', cls: 'cleric' }, (m, s, ws) => {
    if (m.type === 'welcome') { s.id = m.id; ws.send(JSON.stringify({ type: 'chat', text: '/kneel' })); }
    return m.type === 'snap' && m.w.events?.some(e => e.t === 'pose' && e.id === s.id && e.k === 'kneel');
  });
  ok('a live /kneel sends the pose event');
  await new Promise(r => setTimeout(r, 300)); // the event has gone out; only w.poses carries it now
  const { ws: sws } = await conn({ type: 'spectate' }, m => m.type === 'snap' && m.w.poses?.some(([id, k]) => id === st.id && k === 'kneel'));
  ok('a spectator joining later sees the current pose');
  pws.close(); sws.close();
} finally { proc.kill(); }
console.log(`# ${n} passed`);
