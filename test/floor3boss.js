// Storm Colossus runs with human-like bots (Floor 3, docs/floor3.md): starts its own server (START_LEVEL 30, SPAWN_AT at
// the Storm Gate), sends a role party (Guardian, Swordsman, Cleric by default) at a capability level, and reports kill /
// wipe, fight time, deaths (and what killed them), Overloads stopped (by Switch / Team Burst / solo Break) vs Thunderclaps,
// Tempest Beam jumps / rolls / hits, downs / revives, team mechanics, combos and Team Bursts.
// Usage: BOT_SKILL=5 RUNS=2 PORT=5221 node test/floor3boss.js
//        (env: ROLES=guardian,ranger,bard,cleric, START_LEVEL=30, F3_TWIST to force a twist, LIMIT=360 s per run, MVP=1)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';
import { skillName } from '../shared/botskill.js';
import { MOB_IDS } from '../shared/data.js';
import { MVP_TITLE } from '../shared/mvp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = Number(process.env.BOT_SKILL) || 5, RUNS = Number(process.env.RUNS) || 1, PORT = Number(process.env.PORT) || 5221;
const LIMIT = Number(process.env.LIMIT) || 360;
const COLOSSUS = MOB_IDS.indexOf('colossus');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(i) {
  const env = { ...process.env, PORT: String(PORT), START_LEVEL: process.env.START_LEVEL || '30', SPAWN_AT: process.env.SPAWN_AT || '1200,150', DATABASE_URL: '', F3_STATS: '1' };
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  for (let k = 0; k < 150 && !/running on/.test(log); k++) await sleep(100);
  const g = startTeam({ url: `ws://localhost:${PORT}/ws`, WebSocket, skill: SKILL, behaviour: 'floor3', ...(process.env.ROLES ? { roles: process.env.ROLES.split(',') } : {}) });
  const lead = g.team[0];
  const res = { run: i + 1, result: 'timeout', secs: 0, deaths: 0, downs: 0, revives: 0, twist: (log.match(/Colossus twist: (\w+)/) || [])[1] || '?', ov: 0, beams: 0, phase: 0 };
  let start = null, hit = false, done = false;
  const t0 = Date.now();
  lead.ws.addEventListener('message', ev => {
    if (done) return;
    const msg = JSON.parse(ev.data.toString());
    if (msg.type !== 'snap') return;
    const ids = new Set(g.team.map(b => b.id));
    for (const e of msg.w.events) {
      if (e.t === 'pdie' && ids.has(e.id) && start) { res.deaths++; (res.causes ||= []).push(e.src); }
      if (e.t === 'down' && ids.has(e.id) && start) res.downs++;
      if (e.t === 'revived' && ids.has(e.id) && start) res.revives++;
      if (e.t === 'combo' && ids.has(e.by) && start) (res.combos ||= {})[e.k] = (res.combos[e.k] || 0) + 1;
      if (e.t === 'tburst' && ids.has(e.by) && start) (res.bursts ||= []).push(e.n);
      if (e.t === 'f3ov' && e.s === 'start') res.ov++;
      if (e.t === 'f3beam') res.beams++;
      if (e.t === 'f3phase') res.phase = Math.max(res.phase, e.n);
      if (e.t === 'sys' && /Storm Colossus has fallen/.test(e.text)) { res.result = 'kill'; done = true; }
      if (e.t === 'mvp') res.card = e.card;
      if (e.t === 'btend' && start && !e.off) {
        const M = (res.mech ||= { stack: [], spread: [0, 0], tether: [0, 0] });
        if (e.k === 'stack') M.stack.push(e.n);
        if (e.k === 'spread') { M.spread[0] += e.clean.length; M.spread[1] += e.ids.length; }
        if (e.k === 'tether') { M.tether[0] += e.ok; M.tether[1]++; }
      }
    }
    const c = msg.w.mobs.find(m => m[1] === COLOSSUS);
    if (c && c[5] < c[6] && !hit) { hit = true; start = Date.now(); }
    if (c) res.hpLeft = Math.round((100 * c[5]) / c[6]);
    if (c && hit && c[5] >= c[6] && !done) { res.result = 'wipe'; done = true; }
    if (done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  });
  while (!done && Date.now() - t0 < LIMIT * 1000) await sleep(250);
  if (!done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  g.stop(); srv.kill();
  const n = re => (log.match(re) || []).length;
  res.stop = { sw: n(/\[ov\] stop switch/g), burst: n(/\[ov\] stop burst/g), brk: n(/\[ov\] stop break/g) }; res.clap = n(/\[ov\] clap/g);
  res.beam = { jump: n(/\[beam\] jump/g), roll: n(/\[beam\] roll/g), hit: n(/\[beam\] hit/g) };
  if (/Error|TypeError|ReferenceError/.test(log)) res.err = (log.match(/.*(Error).*/) || [''])[0];
  await sleep(300);
  return res;
}

const out = [];
for (let i = 0; i < RUNS; i++) {
  const r = await run(i); out.push(r);
  console.log(`[skill ${SKILL} ${skillName(SKILL)}] run ${r.run}: ${r.result} in ${r.secs}s${r.result !== 'kill' ? ` (boss at ${r.hpLeft ?? '?'}%, phase ${r.phase + 1})` : ''}, ${r.deaths} deaths, ${r.downs} downed, ${r.revives} revived (twist ${r.twist})`
    + ` · Overload ${r.ov}: stopped ${r.stop.sw} by Switch, ${r.stop.burst} by Team Burst, ${r.stop.brk} solo; ${r.clap} Thunderclaps`
    + ` · Tempest Beam ${r.beams}: ${r.beam.jump} jumped, ${r.beam.roll} rolled, ${r.beam.hit} hit`
    + `${r.causes ? ` · deaths to ${r.causes.join(', ')}` : ''}${r.mech ? ` · team mechanics: stacks ${r.mech.stack.join('/') || '-'} in, spread ${r.mech.spread[0]}/${r.mech.spread[1]} clean, tethers ${r.mech.tether[0]}/${r.mech.tether[1]} snapped` : ''}`
    + ` · combos ${Object.values(r.combos || {}).reduce((a, v) => a + v, 0)} · Team Bursts ${r.bursts?.length || 0}${r.err ? ` · SERVER ERROR: ${r.err}` : ''}`);
  if (process.env.MVP && r.card) for (const f of r.card.rows) console.log(`    ${f.id === r.card.mvp ? '★' : ' '} ${f.name} (${f.cls}): ${f.titles.map(k => MVP_TITLE[k].name).join(', ') || '-'} · dmg ${f.dmg} heal ${f.heal} tanked ${f.tanked} · mech ${f.mechanic} · down ${f.down} death ${f.death}`);
}
const wins = out.filter(r => r.result === 'kill');
console.log(`[skill ${SKILL} ${skillName(SKILL)}] ${wins.length}/${out.length} kills · avg kill time ${wins.length ? Math.round(wins.reduce((s, r) => s + r.secs, 0) / wins.length) : '-'}s · avg deaths ${(out.reduce((s, r) => s + r.deaths, 0) / out.length).toFixed(1)} · Overloads stopped ${out.reduce((s, r) => s + r.stop.sw + r.stop.burst + r.stop.brk, 0)}/${out.reduce((s, r) => s + r.ov, 0)} · beam hits ${out.reduce((s, r) => s + r.beam.hit, 0)}/${out.reduce((s, r) => s + r.beam.hit + r.beam.jump + r.beam.roll, 0)}`);
process.exit(0);
