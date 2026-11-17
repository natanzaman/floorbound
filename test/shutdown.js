// Deploy shutdown drain (server/shutdown.js): on SIGTERM the server warns everyone, lets a running boss fight finish
// (capped), saves every character and exits 0.
//   unit: bossFightLive / drain with a fake game (hold until the fight ends; the cap)
//   live: a real server gets SIGTERM: the notice reaches the client, it exits 0, and (with DATABASE_URL) the
//         character is saved; then a player in the Warden's chamber holds the shutdown until the cap.
// Usage: node test/shutdown.js   (DATABASE_URL=... PORT=4160 node test/shutdown.js for the save check)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { bossFightLive, drain, UPDATE_MSG } from '../server/shutdown.js';
import { WORLD, xpToNext } from '../shared/data.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4160;
const DB = process.env.DATABASE_URL || '';

// ---------- unit ----------
const A = WORLD.arena;
const fake = (fight, inRoom = true) => ({
  players: new Map([[1, { id: 1, x: A.x, z: inRoom ? A.z : 0, dead: false }], [2, { id: 2, bot: true, x: A.x, z: A.z }]]),
  boss: { dead: false, threat: new Map(fight ? [[1, 5]] : []) }, gate: { open: false },
  sovereign: null, gate2: { open: false },
});
ok(bossFightLive(fake(true)) && !bossFightLive(fake(false)) && !bossFightLive(fake(true, false)), 'a boss fight is live only with the boss engaged and a player in the arena');
{
  const g = fake(false); g.players.delete(1);
  g.boss.threat.set(2, 9);
  ok(!bossFightLive(g), 'a bots-only fight does not hold a deploy');
}
{
  const g = fake(true), said = [];
  let saved = 0;
  setTimeout(() => { g.boss.dead = true; }, 300);
  const r = await drain({ game: g, notify: t => said.push(t), save: async () => { saved++; }, holdMs: 5000, pollMs: 50, log: () => {} });
  ok(said[0] === UPDATE_MSG && r.held && r.waited >= 250 && r.waited < 2000 && saved === 1 && /Fight over/.test(said.at(-1)), `waits for the fight to end, then saves (${r.waited} ms): ${said.join(' | ')}`);
}
{
  const g = fake(true), said = [];
  const r = await drain({ game: g, notify: t => said.push(t), save: async () => {}, holdMs: 400, pollMs: 50, log: () => {} });
  ok(r.held && r.waited >= 380 && r.waited < 1500 && /Out of time/.test(said.at(-1)), `never waits past the cap (${r.waited} ms)`);
}
{
  const said = [];
  const r = await drain({ game: fake(false), notify: t => said.push(t), save: async () => {}, holdMs: 5000, pollMs: 50, log: () => {} });
  ok(!r.held && r.waited < 200 && said.length === 1, 'no fight: straight to saving');
}

{ // the hold: 4 min on Render (RENDER=true), none elsewhere, SHUTDOWN_HOLD_MS overrides
  const { execFileSync } = await import('node:child_process');
  const hold = env => Number(execFileSync(process.execPath, ['--input-type=module', '-e', "import('./server/shutdown.js').then(m => console.log(m.HOLD_MS))"], { cwd: root, env: { PATH: process.env.PATH, ...env } }).toString());
  ok(hold({ RENDER: 'true' }) === 240000 && hold({}) === 0 && hold({ RENDER: 'true', SHUTDOWN_HOLD_MS: '5000' }) === 5000, 'hold: 240 s on Render, 0 locally, SHUTDOWN_HOLD_MS overrides');
}

// ---------- live ----------
function server(extra = {}) {
  const env = { ...process.env, PORT: String(PORT), TEST_HOOKS: '1', ...extra };
  if (!DB) delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.log = '';
  proc.stdout.on('data', d => { proc.log += d; }); proc.stderr.on('data', d => { proc.log += d; });
  proc.exited = new Promise(r => proc.on('exit', (code, sig) => r({ code, sig, at: Date.now() })));
  return proc;
}
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}
function client(join) {
  const c = { sys: [], id: 0 };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'join', ...join })));
  c.ws.on('error', () => {});
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'welcome') c.id = m.id;
    if (m.type === 'snap') { c.me = m.me; for (const e of m.w.events) if (e.t === 'sys' && (!e.to || e.to === c.id)) c.sys.push(e.text); }
  });
  c.send = o => c.ws.readyState === 1 && c.ws.send(JSON.stringify(o));
  return c;
}
const post = (p, body, token) => fetch(`http://localhost:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) }).then(r => r.json());

let srv = server();
try {
  await until(() => /running on/.test(srv.log), 15000, 'server start');
  let join = { name: `Drn${Math.floor(Math.random() * 1e4)}`, cls: 'cleric' }, charId = 0;
  if (DB) {
    const { token } = await post('/api/guest');
    const { character } = await post('/api/characters', { name: join.name, cls: 'cleric' }, token);
    charId = character.id; join = { session: token, character: charId };
  }
  const c = client(join);
  await until(() => c.id && c.me, 5000, 'joined');
  c.send({ type: 'test', xp: xpToNext(1) + xpToNext(2) }); // Lv 1 -> 3 (unsaved until the shutdown, the periodic save is 15 s)
  await until(() => c.me?.lvl === 3 || c.sys.some(t => /unlocked/.test(t)), 3000, 'level up');
  const t0 = Date.now();
  srv.kill('SIGTERM');
  const ex = await srv.exited;
  ok(c.sys.includes(UPDATE_MSG), `SIGTERM: everyone gets "${UPDATE_MSG}"`);
  ok(ex.code === 0 && ex.at - t0 < 5000, `then the server saves and exits 0 (${ex.at - t0} ms, no boss fight)`);
  if (DB) {
    const db = await import('../server/db.js');
    const [row] = await db.q('SELECT lvl FROM characters WHERE id = $1', [charId]);
    ok(row?.lvl === 3, `the character was saved on the way out (Lv ${row?.lvl})`);
    await db.end?.();
  } else console.log('  skip - save check (set DATABASE_URL)');

  // a player in the Warden's chamber: the boss engages, the shutdown waits (here capped at 2.5 s)
  srv = server({ SPAWN_AT: `${A.x},${A.z - 6}`, START_LEVEL: '20', SHUTDOWN_HOLD_MS: '2500' });
  await until(() => /running on/.test(srv.log), 15000, 'server start');
  const f = client({ name: `Fgt${Math.floor(Math.random() * 1e4)}`, cls: 'guardian' });
  await until(() => f.id && f.me, 5000, 'fighter joined');
  await sleep(1500); // the Warden notices the player
  const t1 = Date.now();
  srv.kill('SIGTERM');
  const ex2 = await srv.exited;
  ok(f.sys.includes(UPDATE_MSG) && f.sys.some(t => /boss fight is on/.test(t)), 'a boss fight is on: players are told the update waits');
  ok(ex2.code === 0 && f.sys.some(t => /updating now/.test(t)) && ex2.at - t1 < 8000, `...it exits 0 when the fight ends or the cap is reached (${ex2.at - t1} ms; ${f.sys.filter(t => /updating now/.test(t))[0]})`);
  c.ws.close(); f.ws.close();
} catch (e) {
  failed++;
  console.log('  NOT OK - ' + e.message);
  console.log(srv.log.split('\n').slice(-15).join('\n'));
  srv.kill('SIGKILL');
}
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} shutdown checks passed`);
process.exit(failed ? 1 : 0);
