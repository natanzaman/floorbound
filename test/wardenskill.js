// Warden runs with human-like bots: starts its own server (START_LEVEL, SPAWN_AT at the raid gate), sends a role party
// (Guardian, Swordsman, Cleric) at a capability level, and reports kill / wipe, fight time, deaths (and what killed them)
// and Quake Rings jumped / rolled / hit, how the boss team mechanics went (people in each stack, clean spreads, snapped
// tethers), downs / revives (G1), Covers / Pincers (G3), and team combos / Team Bursts (G2).
// Usage: BOT_SKILL=3 RUNS=2 PORT=3621 node test/wardenskill.js
//        (env: START_LEVEL=10, SPAWN_AT=0,150, LIMIT=300 s per run, WARDEN_TWIST to force a twist,
//         ROLES=guardian,ranger,bard,cleric, START_STYLE=daggers,drum to arm each class with the first of its styles listed,
//         LOG_TALENTS=1, STATS=1 for each bot's damage, DPS and basic-attack presses; styled melee / ring combos also report how many landed,
//         MVP=1 prints each run's post-fight MVP card (G5), MVP_JSON=file saves the last one,
//         LOCAL=1 runs the party as the server's own bots (in-process sockets, server/localws.js, with their think-rate
//         rule) and watches as a spectator; STATS' basic-attack presses are not counted then)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';
import { skillName } from '../shared/botskill.js';
import { STYLE_IDS } from '../shared/styles.js';
import { writeFileSync } from 'node:fs';
import { MVP_TITLE } from '../shared/mvp.js';
import { MOB_IDS } from '../shared/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = Number(process.env.BOT_SKILL) || 5, RUNS = Number(process.env.RUNS) || 1, PORT = Number(process.env.PORT) || 3621;
const LIMIT = Number(process.env.LIMIT) || 300;
const SOV = process.env.BOSS === 'sovereign';
const BOSS = SOV
  ? { type: MOB_IDS.indexOf('sovereign'), lvl: '18', at: '600,150', fell: /Drowned Sovereign has fallen/, twist: /Sovereign twist: (\w+)/ }
  : { type: MOB_IDS.indexOf('warden'), lvl: '10', at: '0,150', fell: /Horned Warden has fallen/, twist: /Warden twist: (\w+)/ };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LOCAL = !!process.env.LOCAL;
// LOCAL=1: a spectator socket stands in for the lead bot's; the team is read off the roster (the server's bots).
async function watchLocal(roles) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const team = [];
  ws.on('open', () => ws.send(JSON.stringify({ type: 'spectate' })));
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'roster' && !team.length && m.players.filter(r => r.bot).length >= roles.length) team.push(...m.players.filter(r => r.bot).map(r => ({ id: r.id, cls: r.cls, name: r.name, send: () => {} })));
  });
  for (let k = 0; k < 100 && !team.length; k++) await sleep(100);
  if (!team.length) throw new Error('the server\'s team never joined');
  team[0].ws = ws;
  return { team, stop: () => ws.close() };
}

async function run(i) {
  const env = { ...process.env, PORT: String(PORT), START_LEVEL: process.env.START_LEVEL || BOSS.lvl, SPAWN_AT: process.env.SPAWN_AT || BOSS.at, DATABASE_URL: '', QUAKE_STATS: '1', NAMED_ENABLED: process.env.NAMED_ENABLED || '0' }; // (the bots here join as players: keep the Named out of the run)
  const roles = process.env.ROLES ? process.env.ROLES.split(',') : ['guardian', 'swordsman', 'cleric'];
  if (LOCAL) env.TEST_TEAM = `${roles.join(',')}:${SKILL}:${SOV ? 'floor2' : 'warden'}`; // the server runs them (server/index.js)
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  for (let k = 0; k < 150 && !/running on/.test(log); k++) await sleep(100);
  const g = LOCAL ? await watchLocal(roles) : startTeam({ url: `ws://localhost:${PORT}/ws`, WebSocket, skill: SKILL, roles, log: m => { if (process.env.LOG_TALENTS && m.startsWith('[talent]')) console.log(m); } });
  const lead = g.team[0];
  const res = { run: i + 1, result: 'timeout', secs: 0, deaths: 0, downs: 0, revives: 0, twist: (log.match(BOSS.twist) || [])[1] || '?' };
  let start = null, hit = false, done = false;
  const t0 = Date.now();
  const stats = new Map(g.team.map(b => [b, { dmg: 0, presses: 0, swings: 0, landed: 0, style: null }]));
  for (const b of g.team) { // count basic-attack presses once the fight is on
    const send = b.send;
    b.send = o => { if (o.type === 'skill' && o.slot === 0 && start) stats.get(b).presses++; return send(o); };
  }
  lead.ws.addEventListener('message', ev => {
    if (done) return;
    const msg = JSON.parse(ev.data.toString());
    if (msg.type !== 'snap') return;
    const ids = new Set(g.team.map(b => b.id));
    const byId = new Map(g.team.map(b => [b.id, stats.get(b)]));
    for (const r of msg.w.players) if (byId.has(r[0])) byId.get(r[0]).style = r[11];
    const open = new Map(); // bot id -> its styled swing in this snapshot, waiting for a hit
    if (start) for (const e of msg.w.events) {
      if (e.t === 'fx' && e.k === 'sty' && !e.ev && !e.tw && byId.has(e.id)) { byId.get(e.id).swings++; open.set(e.id, true); }
      if (e.t === 'hit' && byId.has(e.by)) { const st = byId.get(e.by); st.dmg += e.a; if (open.get(e.by)) { st.landed++; open.set(e.by, false); } }
    }
    for (const e of msg.w.events) {
      if (e.t === 'pdie' && ids.has(e.id) && start) { res.deaths++; (res.causes ||= []).push(e.src); }
      if (e.t === 'down' && ids.has(e.id) && start) res.downs++;
      if (e.t === 'revived' && ids.has(e.id) && start) res.revives++;
      if (e.t === 'combo' && ids.has(e.by) && start) (res.combos ||= {})[e.k] = (res.combos[e.k] || 0) + 1; // team combos (G2)
      if (e.t === 'tburst' && ids.has(e.by) && start) (res.bursts ||= []).push(e.n); // Team Bursts: joiners each
      if (e.t === 'sys' && BOSS.fell.test(e.text)) { res.result = 'kill'; done = true; }
      if (e.t === 'mvp') res.card = e.card; // the post-fight MVP card (G5)
      if (start && (e.t === 'cover' || e.t === 'covered' || e.t === 'flank')) { // team threat (server/threat.js): Covers, covered hits, Pincer tags
        const T = (res.team ||= { cover: 0, covered: 0, pincer: 0 });
        if (e.t === 'cover' && !e.fail) T.cover++; else if (e.t === 'covered') T.covered++; else if (e.t === 'flank' && e.k === 'pincer') T.pincer++;
      }
      if (e.t === 'btend' && start && !e.off) { // boss team mechanics (server/bossteam.js): how each one went
        const M = (res.mech ||= { stack: [], spread: [0, 0], tether: [0, 0] });
        if (e.k === 'stack') M.stack.push(e.n);
        if (e.k === 'spread') { M.spread[0] += e.clean.length; M.spread[1] += e.ids.length; }
        if (e.k === 'tether') { M.tether[0] += e.ok; M.tether[1]++; }
      }
    }
    if (!res.twist || res.twist === '?') res.twist = (log.match(BOSS.twist) || [])[1] || '?'; // rolled when the boss engages
    const w = msg.w.mobs.find(m => m[1] === BOSS.type); // the boss
    if (w && w[5] < w[6] && !hit) { hit = true; start = Date.now(); }
    if (w && hit && w[5] >= w[6] && !done) { res.result = 'wipe'; res.hpLeft = 100; done = true; }
    if (done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  });
  while (!done && Date.now() - t0 < LIMIT * 1000) await sleep(250);
  if (!done) res.secs = Math.round((Date.now() - (start || t0)) / 1000);
  if (process.env.STATS) {
    const secs = Math.max(1, (Date.now() - (start || t0)) / 1000);
    res.stats = g.team.map(b => { const s = stats.get(b); return `${b.cls}/${s.style >= 0 ? STYLE_IDS[s.style] : '-'} dmg ${Math.round(s.dmg)} (${(s.dmg / secs).toFixed(1)}/s) basic ${s.presses}${s.swings ? ` styled ${s.landed}/${s.swings} landed (${Math.round((100 * s.landed) / s.swings)}%)` : ''}`; });
  }
  g.stop(); srv.kill();
  const qs = k => (log.match(new RegExp(`\\[quake\\] ${k}`, 'g')) || []).length;
  res.quake = { jump: qs('evade jump'), roll: qs('evade roll'), hit: qs('hit') };
  const ws = k => (log.match(new RegExp(`\\[wave\\] ${k}`, 'g')) || []).length;
  res.wave = { roll: ws('evade'), hit: ws('hit'), geyser: ws('geyser'), deluge: ws('deluge') };
  await sleep(300);
  return res;
}

const out = [];
for (let i = 0; i < RUNS; i++) { const r = await run(i); out.push(r); console.log(`[skill ${SKILL} ${skillName(SKILL)}${SOV ? ' Sovereign' : ''}] run ${r.run}: ${r.result} in ${r.secs}s, ${r.deaths} deaths, ${r.downs} downed, ${r.revives} revived (twist ${r.twist}) · ${SOV ? `Tidal Waves: ${r.wave.roll} rolled, ${r.wave.hit} hit · geyser hits ${r.wave.geyser} · deluge ticks ${r.wave.deluge}` : `Quake Rings: ${r.quake.jump} jumped, ${r.quake.roll} rolled, ${r.quake.hit} hit`}${r.causes ? ` · deaths to ${r.causes.join(', ')}` : ''}${r.mech ? ` · team mechanics: stacks ${r.mech.stack.join('/') || '-'} in, spread ${r.mech.spread[0]}/${r.mech.spread[1]} clean, tethers ${r.mech.tether[0]}/${r.mech.tether[1]} snapped` : ''}${r.team ? ` · Covers ${r.team.cover} (${r.team.covered} hits taken), Pincer tags ${r.team.pincer}` : ''} · combos ${Object.entries(r.combos || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 0} · Team Bursts ${r.bursts ? `${r.bursts.length} (joiners ${r.bursts.join('/')})` : 0}`); for (const l of r.stats || []) console.log(`    ${l}`);
  if (process.env.MVP && r.card) for (const f of r.card.rows) console.log(`    ${f.id === r.card.mvp ? '★' : ' '} ${f.name} (${f.cls}${f.bot ? ' bot' : ''}): ${f.titles.map(k => MVP_TITLE[k].name).join(', ') || '-'} · dmg ${f.dmg} heal ${f.heal} tanked ${f.tanked} · Sw ${f.switch} Br ${f.break} combo ${f.combo} burst ${f.burst} rev ${f.revive} save ${f.save} cover ${f.cover} pincer ${f.flank} mech ${f.mechanic} LA ${f.lastAttack} · down ${f.down} death ${f.death}`);
  if (process.env.MVP_JSON && r.card) writeFileSync(process.env.MVP_JSON, JSON.stringify(r.card, null, 1)); }
const wins = out.filter(r => r.result === 'kill');
const qt = k => out.reduce((s, r) => s + r.quake[k], 0), qn = qt('jump') + qt('roll') + qt('hit');
console.log(`[skill ${SKILL} ${skillName(SKILL)}${SOV ? ' Sovereign' : ''}] ${wins.length}/${out.length} kills · avg kill time ${wins.length ? Math.round(wins.reduce((s, r) => s + r.secs, 0) / wins.length) : '-'}s · avg deaths ${(out.reduce((s, r) => s + r.deaths, 0) / out.length).toFixed(1)} · avg revives ${(out.reduce((s, r) => s + r.revives, 0) / out.length).toFixed(1)} (of ${(out.reduce((s, r) => s + r.downs, 0) / out.length).toFixed(1)} downs) · ${SOV ? `Tidal Waves rolled ${out.reduce((s, r) => s + r.wave.roll, 0)}, hit ${out.reduce((s, r) => s + r.wave.hit, 0)}` : `Quake Rings cleared ${qn ? Math.round((100 * (qn - qt('hit'))) / qn) : '-'}% of ${qn}`} · combos/fight ${(out.reduce((s, r) => s + Object.values(r.combos || {}).reduce((a, v) => a + v, 0), 0) / out.length).toFixed(1)} · bursts/fight ${(out.reduce((s, r) => s + (r.bursts?.length || 0), 0) / out.length).toFixed(1)}`);
process.exit(0);
