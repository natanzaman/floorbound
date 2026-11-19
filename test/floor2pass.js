// Floor 2 bot play pass: starts its own server, sends a bot party through the Glimmering Mire and reports what happened:
// kills per mob type (Shieldbacks, Wisps, Lurkers, Matrons), deaths and what caused them, levels gained, bots stuck in
// place (not fighting, barely moving for STUCK s, with where), warps / Stairway use, the Sunken Gate, the Sovereign, and
// any server error.
// Usage: PORT=4911 node test/floor2pass.js
//        (env: START_LEVEL=12, SPAWN_AT=600,24 (unset it with SPAWN_AT= to start in town: with START_LEVEL>=15 the party
//         kills the Warden and takes the Stairway), ROLES=guardian,swordsman,cleric, BOT_SKILL=5, SECS=240, STUCK=12,
//         CHECK=1 exits 1 when a bot got stuck or the server logged an error)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';
import { MOB_IDS } from '../shared/data.js';
import { onFloor2, inCamp2, areaName2 } from '../shared/floor2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4911, SECS = Number(process.env.SECS) || 240, STUCK = Number(process.env.STUCK) || 12;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const env = { ...process.env, PORT: String(PORT), START_LEVEL: process.env.START_LEVEL || '12', SPAWN_AT: process.env.SPAWN_AT ?? '600,24', DATABASE_URL: '' };
if (!env.SPAWN_AT) delete env.SPAWN_AT;
const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
for (let k = 0; k < 150 && !/running on/.test(log); k++) await sleep(100);

const g = startTeam({ url: `ws://localhost:${PORT}/ws`, WebSocket, floor: 2, skill: Number(process.env.BOT_SKILL) || 5, ...(process.env.ROLES ? { roles: process.env.ROLES.split(',') } : {}) });
const ids = () => new Set(g.team.map(b => b.id));
const R = { kills: {}, deaths: [], warps: [], sys: [], stuck: [], lvl0: null, gate: [], sov: null };
const types = new Map(); // mob id -> type (from snapshots)
const t0 = Date.now(), now = () => Math.round((Date.now() - t0) / 1000);
g.team[0].ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data.toString());
  if (msg.type !== 'snap') return;
  for (const m of msg.w.mobs) types.set(m[0], MOB_IDS[m[1]]);
  const mine = ids();
  for (const e of msg.w.events) {
    if (e.t === 'die' && types.has(e.id)) { const k = types.get(e.id); R.kills[k] = (R.kills[k] || 0) + 1; }
    if (e.t === 'pdie' && mine.has(e.id)) R.deaths.push(`${e.src}@${now()}s`);
    if (e.t === 'warp' && mine.has(e.id)) R.warps.push(`f${e.f}@${now()}s`);
    if (e.t === 'gate2') R.gate.push(`${e.s}@${now()}s`);
    if (e.t === 'sys' && !e.to && /Sovereign|Stairway|Glimmering|Warden has fallen/.test(e.text)) R.sys.push(`${now()}s ${e.text.slice(0, 90)}`);
    if (e.t === 'f2phase') R.sov = { ...(R.sov || {}), phase: e.n, at: now() };
  }
});
const track = new Map(g.team.map(b => [b, { x: 0, z: 0, since: 0, flagged: false }]));
while (Date.now() - t0 < SECS * 1000) {
  await sleep(1000);
  R.lvl0 ??= g.team.every(b => b.me) ? g.team.map(b => b.me.lvl) : null;
  for (const b of g.team) { // stuck: alive, out of camp, no target, moved < 1.5 m for STUCK s
    const s = track.get(b);
    if (Math.hypot(b.x - s.x, b.z - s.z) > 1.5 || b.dead || b.tgtId || inCamp2(b.x, b.z) || /Waiting|gate/i.test(b.goal)) { Object.assign(s, { x: b.x, z: b.z, since: Date.now(), flagged: false }); continue; }
    if (!s.flagged && Date.now() - s.since > STUCK * 1000) { s.flagged = true; R.stuck.push(`${b.name} at [${b.x.toFixed(0)}, ${b.z.toFixed(0)}] (${onFloor2(b.x) ? areaName2(b.x, b.z) : 'Floor 1'}) goal "${b.goal}" @${now()}s`); }
  }
}
const errors = log.split('\n').filter(l => /Error|TypeError|at .*\.js:\d+/.test(l)).slice(0, 12);
console.log(`[floor2 pass] ${SECS}s, ${g.team.map(b => b.cls).join('/')} skill ${Number(process.env.BOT_SKILL) || 5}, levels ${R.lvl0?.join('/')} -> ${g.team.map(b => b.me?.lvl).join('/')}`);
console.log(`  kills: ${Object.entries(R.kills).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
console.log(`  deaths: ${R.deaths.length}${R.deaths.length ? ` (${R.deaths.join(', ')})` : ''}`);
console.log(`  warps: ${R.warps.join(', ') || '-'} · Sunken Gate: ${R.gate.join(', ') || '-'} · Sovereign phase reached: ${R.sov ? R.sov.phase + 1 : '-'}`);
console.log(`  where now: ${g.team.map(b => `${b.name} [${b.x.toFixed(0)}, ${b.z.toFixed(0)}] ${b.goal}`).join(' · ')}`);
console.log(`  stuck: ${R.stuck.length ? `\n    ${R.stuck.join('\n    ')}` : 'none'}`);
for (const l of R.sys) console.log(`  [sys] ${l}`);
console.log(`  server errors: ${errors.length ? `\n    ${errors.join('\n    ')}` : 'none'}`);
g.stop(); srv.kill();
await sleep(200);
process.exit(process.env.CHECK && (R.stuck.length || errors.length) ? 1 : 0);
