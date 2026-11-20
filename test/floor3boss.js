// Storm Colossus runs with human-like bots (Floor 3, docs/floor3.md): starts its own server (START_LEVEL 30, SPAWN_AT at
// the Storm Gate), sends a role party (Guardian, Swordsman, Cleric by default) at a capability level, and reports kill /
// wipe, fight time, deaths (and what killed them), Overloads stopped (by Switch / Team Burst / solo Break) vs Thunderclaps,
// Tempest Beam jumps / rolls / hits, downs / revives, team mechanics, combos and Team Bursts.
// Usage: BOT_SKILL=5 RUNS=2 PORT=5221 node test/floor3boss.js
//        (env: ROLES=guardian,ranger,bard,cleric, START_LEVEL=30, F3_TWIST to force a twist, LIMIT=360 s per run, MVP=1,
//         TUNE_JSON=file writes every run's result there, with damage on the boss by class and opening use (scripts/tuneboss.js))
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';
import { skillName } from '../shared/botskill.js';
import { MOB_IDS } from '../shared/data.js';
import { MVP_TITLE } from '../shared/mvp.js';
import { threatWatch, threatLine, threatSummary } from './threatwatch.js'; // J4: tank share, DPS threat at lock end (THREAT_STATS, NO_TAUNT)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = Number(process.env.BOT_SKILL) || 5, RUNS = Number(process.env.RUNS) || 1, PORT = Number(process.env.PORT) || 5221;
const FROM_TOWN = !!process.env.FROM_TOWN; // the whole journey: town -> waystone -> Windbreak Camp -> the field -> the Storm Gate -> the boss
const LIMIT = Number(process.env.LIMIT) || (FROM_TOWN ? 720 : 360);
const COLOSSUS = MOB_IDS.indexOf('colossus');
const TUNE = process.env.TUNE_JSON ? await import('../scripts/tuneboss.js') : null; // the tuning harness's numbers
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(i) {
  const env = { ...process.env, THREAT_STATS: '1', PORT: String(PORT), START_LEVEL: process.env.START_LEVEL || '30', SPAWN_AT: FROM_TOWN ? '' : process.env.SPAWN_AT || '1200,150', DATABASE_URL: '', F3_STATS: '1', TEST_HOOKS: '1', NAMED_ENABLED: process.env.NAMED_ENABLED || '0' }; // (the bots here join as players: keep the Named out of the run)
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  for (let k = 0; k < 150 && !/running on/.test(log); k++) await sleep(100);
  const g = startTeam({ url: `ws://localhost:${PORT}/ws`, WebSocket, skill: SKILL, behaviour: 'floor3', ...(process.env.ROLES ? { roles: process.env.ROLES.split(',') } : {}) });
  const lead = g.team[0];
  const tw = threatWatch(g.team, COLOSSUS), tz = TUNE?.tuneWatch(g.team, COLOSSUS);
  if (FROM_TOWN) { for (let k = 0; k < 50 && !g.team.every(b => b.id); k++) await sleep(100); for (const b of g.team) b.send({ type: 'test', unlock: 3 }); }
  const t00 = Date.now(), journey = {};
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
      if (e.t === 'trapend' && start && e.why !== 'off') { const R = (res.traps ||= {}); R[e.why] = (R[e.why] || 0) + 1; } // rescue traps (server/rescue.js): how each one ended
      if (e.t === 'btend' && start && !e.off) {
        const M = (res.mech ||= { stack: [], spread: [0, 0], tether: [0, 0] });
        if (e.k === 'stack') M.stack.push(e.n);
        if (e.k === 'spread') { M.spread[0] += e.clean.length; M.spread[1] += e.ids.length; }
        if (e.k === 'tether') { M.tether[0] += e.ok; M.tether[1]++; }
      }
    }
    if (start) for (const r of msg.w.players) if (ids.has(r[0]) && !r[9]) res.minHp = Math.min(res.minHp ?? 100, Math.round((100 * r[4]) / r[5]));
    if (start) for (const e of msg.w.events) if (e.t === 'hurt' && ids.has(e.id)) res.taken = (res.taken || 0) + e.a;
    if (FROM_TOWN) {
      const me = msg.w.players.filter(r => ids.has(r[0]));
      if (!journey.f3 && me.length && me.every(r => r[1] > 900)) journey.f3 = Math.round((Date.now() - t00) / 1000);
      if (!journey.gate && me.length && me.every(r => r[1] > 900 && r[2] > 138)) journey.gate = Math.round((Date.now() - t00) / 1000);
      for (const e of msg.w.events) if (e.t === 'die' && journey.f3 && !start) journey.kills = (journey.kills || 0) + 1;
    }
    const c = msg.w.mobs.find(m => m[1] === COLOSSUS);
    if (start) { tw.snap(msg); tz?.snap(msg); }
    if (c && c[5] < c[6] && !hit) { hit = true; start = Date.now(); }
    if (c) res.hpLeft = Math.round((100 * c[5]) / c[6]);
    if (c && hit && c[5] >= c[6] && !done) { res.result = 'wipe'; done = true; }
    if (done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  });
  while (!done && Date.now() - t0 < LIMIT * 1000) await sleep(250);
  if (!done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  if (FROM_TOWN) res.journey = journey;
  g.stop(); srv.kill();
  if (process.env.LOG_FILE) (await import('node:fs')).appendFileSync(process.env.LOG_FILE, `--- run ${i + 1}\n${log}`); // the server's log (F3_STATS lines) for a closer look
  res.threat = tw.report(log);
  if (tz) res.tune = tz.report(log);
  const n = re => (log.match(re) || []).length;
  res.stop = { sw: n(/\[ov\] stop switch/g), burst: n(/\[ov\] stop burst/g), brk: n(/\[ov\] stop break/g) }; res.clap = n(/\[ov\] clap/g);
  res.beam = { jump: n(/\[beam\] jump/g), roll: n(/\[beam\] roll/g), hit: n(/\[beam\] hit/g), cover: n(/\[beam\] cover/g) };
  res.arena = { falls: n(/\[arena\] resume/g), fire: n(/\[arena\] fire hit/g) }; // the fall to the Undercroft (J2), fire ticks taken
  if (/Error|TypeError|ReferenceError/.test(log)) res.err = (log.match(/.*(Error).*/) || [''])[0];
  await sleep(300);
  return res;
}

const out = [];
for (let i = 0; i < RUNS; i++) {
  const r = await run(i); out.push(r);
  console.log(`[skill ${SKILL} ${skillName(SKILL)}] run ${r.run}: ${r.result} in ${r.secs}s${r.result !== 'kill' ? ` (boss at ${r.hpLeft ?? '?'}%, phase ${r.phase + 1})` : ''}, ${r.deaths} deaths, ${r.downs} downed, ${r.revives} revived, lowest ${r.minHp ?? '-'}% HP, ${r.taken || 0} taken (twist ${r.twist})`
    + ` · Overload ${r.ov}: stopped ${r.stop.sw} by Switch, ${r.stop.burst} by Team Burst, ${r.stop.brk} solo; ${r.clap} Thunderclaps`
    + ` · Tempest Beam ${r.beams}: ${r.beam.jump} jumped, ${r.beam.roll} rolled, ${r.beam.cover} in cover, ${r.beam.hit} hit`
    + ` · Undercroft: ${r.arena.falls ? 'fell' : 'no fall'}, ${r.arena.fire} fire ticks`
    + `${r.causes ? ` · deaths to ${r.causes.join(', ')}` : ''}${r.mech ? ` · team mechanics: stacks ${r.mech.stack.join('/') || '-'} in, spread ${r.mech.spread[0]}/${r.mech.spread[1]} clean, tethers ${r.mech.tether[0]}/${r.mech.tether[1]} snapped` : ''}${r.traps ? ` · traps: ${Object.entries(r.traps).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`
    + ` · combos ${Object.values(r.combos || {}).reduce((a, v) => a + v, 0)} · Team Bursts ${r.bursts?.length || 0}${threatLine(r.threat)}${r.err ? ` · SERVER ERROR: ${r.err}` : ''}`
    + (r.journey ? ` · journey: on Floor 3 after ${r.journey.f3 ?? '-'}s, all at the Storm Gate after ${r.journey.gate ?? '-'}s, ${r.journey.kills || 0} field kills on the way` : ''));
  if (process.env.MVP && r.card) for (const f of r.card.rows) console.log(`    ${f.id === r.card.mvp ? '★' : ' '} ${f.name} (${f.cls}): ${f.titles.map(k => MVP_TITLE[k].name).join(', ') || '-'} · dmg ${f.dmg} heal ${f.heal} tanked ${f.tanked} · mech ${f.mechanic} · down ${f.down} death ${f.death}`);
}
if (TUNE) (await import('node:fs')).writeFileSync(process.env.TUNE_JSON, JSON.stringify(out.map(({ card, ...r }) => r)));
const wins = out.filter(r => r.result === 'kill');
console.log(`[skill ${SKILL} ${skillName(SKILL)}] ${wins.length}/${out.length} kills · avg kill time ${wins.length ? Math.round(wins.reduce((s, r) => s + r.secs, 0) / wins.length) : '-'}s · avg deaths ${(out.reduce((s, r) => s + r.deaths, 0) / out.length).toFixed(1)} · Overloads stopped ${out.reduce((s, r) => s + r.stop.sw + r.stop.burst + r.stop.brk, 0)}/${out.reduce((s, r) => s + r.ov, 0)} · beam hits ${out.reduce((s, r) => s + r.beam.hit, 0)}/${out.reduce((s, r) => s + r.beam.hit + r.beam.jump + r.beam.roll + r.beam.cover, 0)} (${out.reduce((s, r) => s + r.beam.cover, 0)} in cover) · falls ${out.reduce((s, r) => s + r.arena.falls, 0)} · fire ticks ${out.reduce((s, r) => s + r.arena.fire, 0)}${threatSummary(out)}`);
process.exit(0);
