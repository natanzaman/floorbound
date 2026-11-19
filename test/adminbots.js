// Admin bot editing end-to-end: capability levels, live edits (name / level / capability / behaviour), actions
// (teleport / kill / revive / heal / respawn as another class), the summary strip, and admin-only access.
// Starts its own server on PORT (default 3624) against DATABASE_URL (required).
// Usage: DATABASE_URL=postgresql://... node test/adminbots.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import pg from 'pg';
import { CLASS_IDS } from '../shared/data.js';

const DB = process.env.DATABASE_URL;
if (!DB) { console.log('skipped: set DATABASE_URL to run the admin bot tests'); process.exit(0); }
const PORT = Number(process.env.PORT) || 3624;
const BASE = `http://localhost:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const local = /@(localhost|127\.0\.0\.1)|host=\//.test(DB);
const pool = new pg.Pool({ connectionString: DB, ssl: local ? false : { rejectUnauthorized: false } });

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
async function call(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

// A watcher that keeps the latest roster and every player's snapshot row.
function watcher(name) {
  const c = { pl: new Map(), roster: [] };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'join', name, cls: 'guardian' })));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'welcome') c.id = m.id;
    if (m.type === 'roster') c.roster = m.players;
    if (m.type === 'snap') c.looks = new Map(m.w.looks || []); // who wears a look (server/looks.js)
    if (m.type === 'snap') { c.pl = new Map(m.w.players.map(p => [p[0], { x: p[1], z: p[2], hp: p[4], maxHp: p[5], lvl: p[6], cls: CLASS_IDS[p[7]], party: p[8], dead: !!p[9] }])); }
  });
  return c;
}

const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), MAX_BOTS: '10' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });

try {
  await until(() => /running on/.test(log), 15000, 'server start');
  const tag = Math.random().toString(36).slice(2, 6);
  const adminTok = (await call('POST', '/api/guest')).body.token, userTok = (await call('POST', '/api/guest')).body.token;
  const me = await call('GET', '/api/admin/me', adminTok);
  await pool.query('UPDATE accounts SET is_admin = true WHERE id = $1', [me.body.account.id]);
  const w = watcher(`Watch${tag}`);
  await until(() => w.id && w.roster.length, 5000, 'watcher');
  const bots = async () => (await call('GET', '/api/admin/bots', adminTok)).body;
  const pos = id => w.pl.get(id);

  // ---------- add with capability ----------
  let r = await call('POST', '/api/admin/bots', adminTok, { cls: 'swordsman', name: `Cap${tag}`, lvl: 3, behaviour: 'field', skill: 2 });
  ok(r.status === 200 && r.body.added.skill === 2 && r.body.added.skillName === 'Casual', 'add a bot with capability 2 (Casual)');
  const a = r.body.added;
  r = await call('POST', '/api/admin/bots', adminTok, { cls: 'cleric', behaviour: 'field' });
  ok(r.status === 200 && r.body.added.skill === 4, 'capability defaults to 4 (Skilled)');
  const c = r.body.added;
  r = await call('POST', '/api/admin/bots/team', adminTok, { lvl: 4, behaviour: 'field', skill: 3 });
  ok(r.status === 200 && r.body.added.every(b => b.skill === 3), 'add a team at capability 3');
  const team = r.body.added;
  const list = await bots();
  ok(Object.keys(list.skills).join() === '1,2,3,4,5' && list.skills[5].name === 'Perfect', 'GET /api/admin/bots lists the capability levels');
  await until(() => list.bots.length && [...w.pl.keys()].length >= 6, 6000, 'bots in snapshots');
  const aid = (await bots()).bots.find(b => b.bid === a.bid).id;
  await until(() => pos(aid), 4000, 'bot in snapshot');

  // ---------- access ----------
  ok((await call('PATCH', `/api/admin/bots/${a.bid}`, userTok, { lvl: 9 })).status === 403, 'non-admin PATCH: 403');
  ok((await call('POST', `/api/admin/bots/${a.bid}/heal`, userTok)).status === 403, 'non-admin action: 403');
  ok((await call('PATCH', `/api/admin/bots/${a.bid}`, null, { lvl: 9 })).status === 401, 'signed out: 401');
  ok((await call('GET', '/api/admin/summary', userTok)).status === 403, 'non-admin summary: 403');

  // ---------- live edits ----------
  const hp0 = pos(aid).maxHp;
  r = await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { lvl: 12 });
  ok(r.status === 200 && r.body.bot.lvl === 12, 'PATCH level 12');
  await until(() => pos(aid)?.lvl === 12, 3000, 'live level');
  ok(pos(aid).maxHp > hp0 && pos(aid).hp === pos(aid).maxHp, `the game sees Lv 12, stats recomputed (max HP ${hp0} -> ${pos(aid).maxHp})`);
  ok((await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { lvl: 99 })).status === 400, 'level out of range: 400');
  r = await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { name: `Ren${tag}` });
  await until(() => w.roster.some(p => p.id === aid && p.name === `Ren${tag}` && p.bot), 3000, 'renamed in roster');
  ok(r.status === 200 && r.body.bot.name === `Ren${tag}`, 'rename: the roster shows the new name');
  ok((await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { name: `watch${tag}` })).status === 409, 'rename to a taken name (any case): 409');
  r = await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { skill: 1 });
  ok(r.status === 200 && r.body.bot.skill === 1 && r.body.bot.skillName === 'Novice', 'capability changed live to 1 (Novice)');
  ok((await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { skill: 6 })).status === 400, 'capability 6: 400');
  ok((await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { behaviour: 'follow', follow: 'Nobody' })).status === 400, 'follow someone offline: 400');
  r = await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { behaviour: 'follow', follow: `Watch${tag}` });
  ok(r.status === 200 && r.body.bot.behaviour === 'follow' && r.body.bot.follow === `Watch${tag}`, 'behaviour -> follow the watcher');
  await until(() => pos(aid)?.party && pos(aid).party === pos(w.id)?.party, 5000, 'follower in party');
  ok(true, "the follower joined the watcher's party");
  r = await call('PATCH', `/api/admin/bots/${a.bid}`, adminTok, { behaviour: 'field' });
  await sleep(1200);
  ok(r.body.bot.behaviour === 'field' && r.body.bot.follow === '' && pos(aid)?.party && pos(aid).party === pos(w.id)?.party, 'behaviour back to field: it stays in its party (bots are never left detached)');
  ok((await bots()).bots.find(b => b.bid === a.bid)?.order?.cmd === 'farm', '...with a "go farm" order, so the new behaviour holds next to a player');
  r = await call('PATCH', `/api/admin/bots/${team[0].bid}`, adminTok, { behaviour: 'warden' });
  const tb = (await bots()).bots.filter(b => team.some(t => t.bid === b.bid));
  ok(r.status === 200 && tb.find(b => b.bid === team[0].bid).behaviour === 'warden' && tb.filter(b => b.bid !== team[0].bid).every(b => b.behaviour === 'field'),
    "a team member's behaviour is its own (one brain per bot): the rest of the team keeps theirs");
  await until(() => team.every(t => pos(tb.find(b => b.bid === t.bid).id)?.party) && new Set(tb.map(b => pos(b.id).party)).size === 1, 5000, 'team party');
  ok(true, 'Add team puts the three bots into one party');

  // ---------- actions ----------
  r = await call('POST', `/api/admin/bots/${a.bid}/teleport`, adminTok, { to: 'gate' });
  await until(() => pos(aid) && Math.hypot(pos(aid).x, pos(aid).z - 150) < 8, 3000, 'at gate');
  ok(r.status === 200, 'teleport to the Warden gate');
  r = await call('POST', `/api/admin/bots/${a.bid}/teleport`, adminTok, { to: 'player', name: `Watch${tag}` });
  await until(() => pos(aid) && Math.hypot(pos(aid).x - pos(w.id).x, pos(aid).z - pos(w.id).z) < 6, 3000, 'at player');
  ok(r.status === 200, 'teleport to a player');
  r = await call('POST', `/api/admin/bots/${a.bid}/teleport`, adminTok, { to: 'town' });
  await until(() => pos(aid) && Math.hypot(pos(aid).x, pos(aid).z) < 12, 3000, 'in town');
  ok(r.status === 200, 'teleport to town');
  r = await call('POST', `/api/admin/bots/${a.bid}/kill`, adminTok);
  await until(() => pos(aid)?.dead, 3000, 'dead');
  ok(r.status === 200 && r.body.bot.dead, 'kill: the bot is down');
  await sleep(4600);
  ok(pos(aid).dead, '...and stays down past the normal 4 s respawn');
  ok((await call('POST', `/api/admin/bots/${a.bid}/heal`, adminTok)).status === 400, 'heal a downed bot: 400 (revive first)');
  r = await call('POST', `/api/admin/bots/${a.bid}/revive`, adminTok);
  await until(() => pos(aid) && !pos(aid).dead && pos(aid).hp === pos(aid).maxHp, 3000, 'revived');
  ok(r.status === 200, 'revive: up at full health');
  r = await call('POST', `/api/admin/bots/${a.bid}/heal`, adminTok);
  ok(r.status === 200 && r.body.bot.hp === r.body.bot.maxHp, 'heal to full');
  ok((await call('POST', `/api/admin/bots/${a.bid}/explode`, adminTok)).status === 404, 'unknown action: 404');
  ok((await call('PATCH', '/api/admin/bots/99999', adminTok, { lvl: 2 })).status === 404, 'unknown bot: 404');

  // ---------- wear a look (shared/looks.js) ----------
  ok(!w.looks.size, 'nobody wears a look until asked');
  r = await call('POST', `/api/admin/bots/${a.bid}/look`, adminTok, { look: 'loner' });
  ok(r.status === 200 && r.body.bot.look === 'loner', 'look: the bot wears the loner look');
  await until(() => w.looks.get(aid) === 'loner', 3000, 'look in snapshots');
  ok(w.looks.size === 1, 'snapshots list it (w.looks), for that bot only');
  ok((await call('POST', `/api/admin/bots/${a.bid}/look`, adminTok, { look: 'tuxedo' })).status === 400, 'an unknown look: 400');

  // ---------- respawn as another class ----------
  r = await call('POST', `/api/admin/bots/${a.bid}/respawn`, adminTok, { cls: 'guardian' });
  ok(r.status === 200 && r.body.bot.cls === 'guardian' && r.body.bot.name === `Ren${tag}` && r.body.bot.skill === 1 && r.body.bot.lvl === 12 && r.body.bot.bid === a.bid, 'respawn as Guardian: same name, level, capability; same bot id');
  const nb = r.body.bot.bid;
  await until(() => w.roster.some(p => p.name === `Ren${tag}` && p.cls === 'guardian') && !w.roster.some(p => p.id === aid), 5000, 'respawned in roster');
  ok(true, 'the roster has the Guardian and not the old Swordsman');
  await until(() => { const np = w.roster.find(p => p.name === `Ren${tag}`); return np && w.looks.get(np.id) === 'loner'; }, 4000, 'look after respawn');
  ok(true, 'its look survives Respawn as…');
  r = await call('POST', `/api/admin/bots/${nb}/look`, adminTok, { look: '' });
  await until(() => !w.looks.size, 3000, 'look cleared');
  ok(r.status === 200 && r.body.bot.look === '', 'look: none clears it');
  const after = (await bots()).bots;
  ok(after.filter(b => b.bid === a.bid).length === 1 && after.find(b => b.bid === nb)?.cls === 'guardian' && after.find(b => b.bid === nb)?.status !== 'gone', 'the bot list swapped the entry in place');
  ok((await call('POST', `/api/admin/bots/${nb}/respawn`, adminTok, { cls: 'wizard' })).status === 400, 'respawn as an unknown class: 400');

  // ---------- summary strip ----------
  r = await call('GET', '/api/admin/summary', adminTok);
  ok(r.status === 200 && r.body.players === 1 && r.body.bots === 5 && r.body.twist?.name && r.body.uptime >= 0 && Array.isArray(r.body.clears), `summary: 1 player, 5 bots, twist ${r.body.twist?.name}, uptime ${r.body.uptime}s`);
  void c;
  await call('DELETE', '/api/admin/bots', adminTok);
  w.ws.close();
} catch (e) {
  failed++;
  console.log('  NOT OK - ' + e.message);
  console.log(log.split('\n').slice(-15).join('\n'));
} finally {
  srv.kill();
  await pool.end();
}
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} admin bot checks passed`);
process.exit(failed ? 1 : 0);
