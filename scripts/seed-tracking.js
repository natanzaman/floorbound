// Seeds a LOCAL database with play-tracking data for the stats dashboard (/stats.html, admin part).
//  1. Live bot fights: starts game servers against DATABASE_URL (ports PORT..PORT+3) and sends bot parties at the
//     Warden through the real game code, so the rows are exactly what the game records:
//     players only (bot clients join as guests), mixed (guests + a bot they add), bots only (a guest's 3 bots in
//     Warden mode while it waits outside), and a weak party that tends to wipe.
//  2. Two weeks of history for a handful of made-up characters (sessions, quits, deaths by phase and twist, boss
//     attempts until the first clear, class / style / talent picks, added bots). These rows carry data.seed = 1.
// Usage: DATABASE_URL=postgresql://postgres:pg@localhost/fb_tracking PORT=4211 node scripts/seed-tracking.js
//        (env: ROUNDS=2 live fights per scenario, LIMIT=240 s per fight, LIVE=0 history only, HISTORY=0 live only,
//         ADMIN=1 also prints an admin session token for the dashboard)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import pg from 'pg';
import { startTeam } from '../shared/teambots.js';
import { TREES, pointsAt } from '../shared/talents.js';
import { CLASS_STYLES } from '../shared/styles.js';
import { TWIST_IDS } from '../shared/twists.js';

const DB = process.env.DATABASE_URL;
if (!DB || !/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.log('Set DATABASE_URL to a LOCAL database (localhost): this script writes test data.'); process.exit(1); }
const PORT = Number(process.env.PORT) || 4211, ROUNDS = Number(process.env.ROUNDS) || 2, LIMIT = Number(process.env.LIMIT) || 240;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pool = new pg.Pool({ connectionString: DB });
const sql = (t, p) => pool.query(t, p).then(r => r.rows);

// ---------- 1. live bot fights ----------
function server(port) {
  const env = { ...process.env, PORT: String(port), START_LEVEL: '10', SPAWN_AT: '0,150', BOT_STYLES: '1' };
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; }); srv.stderr.on('data', d => { srv.log += d; });
  return srv;
}

// Watches one connection's snapshots until the Warden dies or resets after being hit.
function watchWarden(ws) {
  return new Promise(resolve => {
    let hit = false;
    const on = ev => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.type !== 'snap') return;
      for (const e of msg.w.events) if (e.t === 'sys' && /Horned Warden has fallen/.test(e.text)) { ws.removeEventListener('message', on); return resolve('kill'); }
      const w = msg.w.mobs.find(m => m[1] === 2);
      if (w && w[5] < w[6]) hit = true;
      if (w && hit && w[5] >= w[6]) { ws.removeEventListener('message', on); resolve('wipe'); }
    };
    ws.addEventListener('message', on);
  });
}

function guest(port, name, cls) { // a plain anonymous client that stays where it spawns
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name, cls })));
  return ws;
}

const SCENARIOS = [
  { name: 'players only', roles: ['guardian', 'swordsman', 'cleric'], skill: 5 },
  { name: 'mixed', roles: ['guardian', 'cleric'], skill: 4, add: ['ranger'] },
  { name: 'bots only', owner: 'bard', add: ['guardian', 'swordsman', 'cleric'], mode: 'warden' },
  { name: 'weak party', roles: ['ranger', 'berserker', 'bard'], skill: 2 },
];

async function liveFight(sc, port, round) {
  const srv = server(port);
  for (let k = 0; k < 150 && !/running on/.test(srv.log); k++) await sleep(100);
  let g = null, owner = null, watch;
  if (sc.roles) {
    g = startTeam({ url: `ws://localhost:${port}/ws`, WebSocket, roles: sc.roles, skill: sc.skill, suffix: String(round) });
    await new Promise(r => g.team[0].ws.addEventListener('open', r));
    watch = watchWarden(g.team[0].ws);
    if (sc.add) { // the host adds bots once the party is up
      await sleep(3000);
      for (const cls of sc.add) g.team[0].send({ type: 'pbot', op: 'add', cls, skill: 5 });
    }
  } else {
    owner = guest(port, `Owner${round}`, sc.owner);
    await new Promise(r => owner.on('open', r));
    watch = watchWarden(owner);
    await sleep(1500);
    for (const cls of sc.add) { owner.send(JSON.stringify({ type: 'pbot', op: 'add', cls, skill: 5 })); await sleep(300); }
    await sleep(2500);
    owner.send(JSON.stringify({ type: 'pbot', op: 'list' }));
    const list = await new Promise(r => owner.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'pbot' && m.list) r(m.list); }));
    for (const b of list.bots.filter(b => b.mine)) owner.send(JSON.stringify({ type: 'pbot', op: 'edit', bid: b.bid, mode: 'warden' }));
  }
  const result = await Promise.race([watch, sleep(LIMIT * 1000).then(() => 'timeout')]);
  await sleep(1500);
  g?.stop(); owner?.close();
  await sleep(6500); // session_end rows, then the 5 s tracking flush
  srv.kill();
  console.log(`  [${sc.name}] round ${round + 1}: ${result}`);
}

// ---------- 2. two weeks of history ----------
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const CAST = [ // made-up characters: [name, class, skill 0..1 (dies less, clears sooner), how many days they keep playing]
  ['Aster', 'guardian', 0.8, 14], ['Brindle', 'cleric', 0.7, 14], ['Corvo', 'swordsman', 0.6, 12], ['Dune', 'ranger', 0.5, 9],
  ['Ember', 'berserker', 0.4, 6], ['Fable', 'bard', 0.5, 11], ['Gale', 'lancer', 0.3, 3], ['Hollow', 'swordsman', 0.2, 2],
  ['Isle', 'cleric', 0.4, 5], ['Juniper', 'ranger', 0.6, 13],
];
const PARTIES = [['Aster', 'Brindle', 'Corvo'], ['Dune', 'Fable', 'Juniper'], ['Ember', 'Isle'], ['Aster', 'Fable']];
const FIELD = { cause: ['boar bite', 'wolf bite', 'alpha bite', 'spitter thorn', 'hound bite'], zone: ['Floor 1 — Verdant Field', 'Town of Beginnings', 'Chamber Gate', "Warden's Chamber"] };
const WARDEN_BY_PHASE = [['warden slam', 'warden cleave', 'hound bite'], ['warden sweep', 'warden charge', 'warden slam', 'hound bite'], ['warden quake', 'rockfall', 'warden sweep', 'warden spin']];
const SOV_BY_PHASE = [['sovereign bite', 'tidal wave'], ['tidal wave', 'mire pool', 'thrall bite'], ['the deluge', 'sovereign orb', 'tidal wave']];

function talentsFor(cls, lvl) {
  const tree = TREES[cls], out = {};
  if (!tree) return out;
  let pts = pointsAt(lvl);
  const br = tree.branches[Math.floor(rnd() * tree.branches.length)]; // most points into one favourite branch
  for (const b of [br, ...tree.branches.filter(x => x !== br)]) for (const n of b.nodes) {
    if (pts <= 0 || n.req?.some(r => !out[r])) continue;
    const r = Math.min(n.max, pts, b === br ? n.max : 1);
    if (b !== br && rnd() < 0.6) continue;
    out[n.id] = r; pts -= r;
  }
  return out;
}

async function history() {
  await sql(`DELETE FROM play_events WHERE data->>'seed' = '1'`);
  const [acct] = await sql(`INSERT INTO accounts (discord_name) VALUES ('seed-tester') RETURNING id`);
  const chars = new Map();
  for (const [name, cls, skill, keep] of CAST) {
    const lvl = Math.min(20, Math.round(4 + skill * 10 + keep * 0.4));
    const style = pick(CLASS_STYLES[cls]);
    const inv = { bag: [], eq: { weapon: { slot: 'weapon', r: 2, name: 'Seed weapon', st: { atk: 5 }, cls, style } }, cons: {}, mats: {} };
    await sql(`DELETE FROM characters WHERE lower(name) = lower($1)`, [name]);
    const [c] = await sql(`INSERT INTO characters (account_id, name, cls, lvl, inv, talents, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(days => $7)) RETURNING id`,
      [acct.id, name, cls, lvl, inv, talentsFor(cls, lvl), Math.max(0, 14 - keep)]);
    chars.set(name, { id: c.id, name, cls, skill, keep, lvl, style, cur: 1 });
  }
  const rows = [];
  const ev = (c, at, kind, data) => rows.push([at, c ? acct.id : null, c?.id ?? null, c ? `seed${c.id}` : null, kind, { ...data, seed: 1 }]);
  const day = d => new Date(Date.now() - d * 86400e3);
  for (const c of chars.values()) {
    for (let d = 14; d > 14 - c.keep; d--) {
      if (rnd() < 0.3) continue; // not every day
      const at = new Date(day(d).getTime() + between(0, 6) * 3600e3), secs = Math.round(c.keep <= 3 ? between(60, 900) : between(300, 5400));
      c.cur = Math.min(c.lvl, c.cur + Math.round(between(0, 3)));
      ev(c, at, 'session_start', { cls: c.cls, lvl: c.cur });
      for (let k = 0; k < Math.round((1 - c.skill) * 4 * rnd()); k++) ev(c, new Date(+at + between(30, secs) * 1000), 'death', { cause: pick(FIELD.cause), lvl: c.cur, floor: 1, area: 'field' });
      const last = d === 15 - c.keep;
      const bots = rnd() < 0.35 ? 1 + Math.floor(rnd() * 3) : 0;
      if (bots) for (let k = 0; k < bots; k++) ev(c, new Date(+at + 60e3), 'pbot_add', { cls: pick(Object.keys(TREES)), skill: 3 + Math.floor(rnd() * 3), lvl: c.cur });
      ev(c, new Date(+at + secs * 1000), 'session_end', { secs, kills: Math.round(secs / 40), deaths: 0, lvl: c.cur, lvlStart: c.cur, switches: 0, gold: 100,
        zone: last && c.keep < 8 ? pick(FIELD.zone.slice(0, 3)) : pick(FIELD.zone), floor: 1, cls: c.cls, style: c.style, party: bots ? 1 + bots : 1, pbots: bots });
    }
  }
  // boss attempts: each party wipes until it clears the Warden; the strongest one goes on to the Sovereign
  PARTIES.forEach((names, pi) => {
    const ms = names.map(n => chars.get(n)), skill = ms.reduce((s, c) => s + c.skill, 0) / ms.length;
    for (const floor of pi === 0 ? [1, 2] : [1]) {
      const need = Math.max(1, Math.round((1 - skill) * 9 + (floor === 2 ? 3 : 0))), tries = pi === 2 ? need - 1 : need; // party 3 hasn't cleared yet
      let t = day(12 - pi * 2 - (floor === 2 ? -4 : 0)).getTime();
      for (let a = 1; a <= tries; a++) {
        t += between(0.3, 20) * 3600e3;
        const kill = a === need, twist = floor === 1 ? pick(TWIST_IDS) : undefined;
        const phase = kill ? 2 : Math.min(2, Math.floor((a / need) * 3 + rnd() * 0.6));
        const bots = pi === 1 && a > 2 ? 1 : 0;
        let deaths = 0, botDeaths = 0;
        for (const c of ms) if (!kill || rnd() < 0.3) {
          const ph = Math.floor(rnd() * (phase + 1)), cause = pick((floor === 1 ? WARDEN_BY_PHASE : SOV_BY_PHASE)[ph]);
          ev(c, new Date(t + between(20, 100) * 1000), 'death', { cause, lvl: c.lvl, floor, area: 'arena', boss: floor, phase: ph, ...(twist ? { twist } : {}) });
          deaths++;
        }
        if (bots && rnd() < 0.6) { ev(null, new Date(t + 50e3), 'bot_death', { cause: pick(WARDEN_BY_PHASE[phase]), lvl: 12, floor, area: 'arena', boss: floor, phase, ...(twist ? { twist } : {}) }); botDeaths++; }
        ev(null, new Date(t + 120e3), 'fight', { floor, result: kill ? 'kill' : 'wipe', secs: Math.round(between(60, 150)), phase, hpLeft: kill ? 0 : Math.round(between(5, 70) * (1 - a / (need + 1))),
          ...(twist ? { twist } : {}), humans: ms.length, bots, deaths, botDeaths, party: ms.map(c => `c${c.id}`).sort(), cls: ms.map(c => c.cls).sort(), botCls: bots ? ['cleric'] : [], lvl: 12 });
        for (const c of ms) {
          ev(c, new Date(t), floor === 1 ? 'boss_start' : 'boss2_start', { players: ms.length, hp: 3000, ...(twist ? { twist } : {}) });
          ev(c, new Date(t + 120e3), floor === 1 ? 'boss_end' : 'boss2_end', { result: kill ? 'kill' : 'wipe', secs: 100, players: ms.length, deaths, hpLeft: 0, phase, ...(c === ms[0] ? {} : { sys: 1 }) });
        }
      }
    }
  });
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400), vals = [], params = [];
    chunk.forEach((r, j) => { vals.push(`($${j * 6 + 1}, $${j * 6 + 2}, $${j * 6 + 3}, $${j * 6 + 4}, $${j * 6 + 5}, $${j * 6 + 6}::jsonb)`); params.push(...r.slice(0, 5), JSON.stringify(r[5])); });
    await sql(`INSERT INTO play_events (at, account_id, char_id, sid, kind, data) VALUES ${vals.join(',')}`, params);
  }
  console.log(`history: ${chars.size} characters, ${rows.length} events`);
}

async function adminToken() {
  const [a] = await sql(`INSERT INTO accounts (discord_name, is_admin) VALUES ('seed-admin', true) RETURNING id`);
  const token = crypto.randomBytes(24).toString('base64url');
  await sql('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [crypto.createHash('sha256').update(token).digest('hex'), a.id]);
  return token;
}

// The game server creates the tables; make sure they exist before writing history.
if (process.env.LIVE !== '0') {
  console.log(`live fights: ${SCENARIOS.length} scenarios x ${ROUNDS} rounds on ports ${PORT}..${PORT + SCENARIOS.length - 1}`);
  for (let r = 0; r < ROUNDS; r++) await Promise.all(SCENARIOS.map((sc, i) => liveFight(sc, PORT + i, r)));
} else { const srv = server(PORT); for (let k = 0; k < 150 && !/running on/.test(srv.log); k++) await sleep(100); srv.kill(); }
if (process.env.HISTORY !== '0') await history();
if (process.env.ADMIN) console.log(`admin session token: ${await adminToken()}`);
await pool.end();
process.exit(0);
