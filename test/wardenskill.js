// Warden runs with human-like bots: starts its own server (START_LEVEL, SPAWN_AT at the raid gate), sends a role party
// (Guardian, Swordsman, Cleric) at a capability level, and reports kill / wipe, fight time and deaths.
// Usage: BOT_SKILL=3 RUNS=2 PORT=3621 node test/wardenskill.js
//        (env: START_LEVEL=10, SPAWN_AT=0,150, LIMIT=300 s per run, WARDEN_TWIST to force a twist)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';
import { skillName } from '../shared/botskill.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = Number(process.env.BOT_SKILL) || 5, RUNS = Number(process.env.RUNS) || 1, PORT = Number(process.env.PORT) || 3621;
const LIMIT = Number(process.env.LIMIT) || 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(i) {
  const env = { ...process.env, PORT: String(PORT), START_LEVEL: process.env.START_LEVEL || '10', SPAWN_AT: process.env.SPAWN_AT || '0,150', DATABASE_URL: '' };
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  for (let k = 0; k < 150 && !/running on/.test(log); k++) await sleep(100);
  const g = startTeam({ url: `ws://localhost:${PORT}/ws`, WebSocket, skill: SKILL, ...(process.env.ROLES ? { roles: process.env.ROLES.split(',') } : {}), log: m => { if (process.env.LOG_TALENTS && m.startsWith('[talent]')) console.log(m); } });
  const lead = g.team[0];
  const res = { run: i + 1, result: 'timeout', secs: 0, deaths: 0, twist: (log.match(/Warden twist: (\w+)/) || [])[1] || '?' };
  let start = null, hit = false, done = false;
  const t0 = Date.now();
  lead.ws.addEventListener('message', ev => {
    if (done) return;
    const msg = JSON.parse(ev.data.toString());
    if (msg.type !== 'snap') return;
    const ids = new Set(g.team.map(b => b.id));
    for (const e of msg.w.events) {
      if (e.t === 'pdie' && ids.has(e.id) && start) res.deaths++;
      if (e.t === 'sys' && /Horned Warden has fallen/.test(e.text)) { res.result = 'kill'; done = true; }
    }
    const w = msg.w.mobs.find(m => m[1] === 2); // warden
    if (w && w[5] < w[6] && !hit) { hit = true; start = Date.now(); }
    if (w && hit && w[5] >= w[6] && !done) { res.result = 'wipe'; res.hpLeft = 100; done = true; }
    if (done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  });
  while (!done && Date.now() - t0 < LIMIT * 1000) await sleep(250);
  if (!done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  g.stop(); srv.kill();
  await sleep(300);
  return res;
}

const out = [];
for (let i = 0; i < RUNS; i++) { const r = await run(i); out.push(r); console.log(`[skill ${SKILL} ${skillName(SKILL)}] run ${r.run}: ${r.result} in ${r.secs}s, ${r.deaths} deaths (twist ${r.twist})`); }
const wins = out.filter(r => r.result === 'kill');
console.log(`[skill ${SKILL} ${skillName(SKILL)}] ${wins.length}/${out.length} kills · avg kill time ${wins.length ? Math.round(wins.reduce((s, r) => s + r.secs, 0) / wins.length) : '-'}s · avg deaths ${(out.reduce((s, r) => s + r.deaths, 0) / out.length).toFixed(1)}`);
process.exit(0);
