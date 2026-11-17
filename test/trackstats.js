// Play-tracking dashboard: the game hooks (server/trackgame.js), BotManager's bot filter, and the admin queries
// (server/track.js detail()) on known rows, their query plans, and the admin-only API.
// Usage: node test/trackstats.js                       (in-process hook checks only)
//        DATABASE_URL=postgresql://... PORT=4231 node test/trackstats.js   (also the queries; uses a throwaway schema)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js';
import { WORLD } from '../shared/data.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 1. game hooks (no database) ----------
{
  const g = quiet(() => new Game());
  const rows = [];
  g.track = (p, kind, data) => rows.push({ p, kind, data });
  const mgr = new BotManager(g, { url: () => '' }); // wraps g.track like the server does
  clearInterval(mgr.timer);
  const hum = g.addPlayer(null, 'Kael', 'guardian');
  mgr.joining = true; const bot = quiet(() => g.addPlayer(null, 'Brann', 'cleric')); mgr.joining = false; bot.bot = true;
  assert.equal(rows.filter(r => r.kind === 'session_start').length, 1, 'a joining bot records no session');
  ok('bots joining record no session_start');
  for (const p of [hum, bot]) { p.x = WORLD.arena.x; p.z = WORLD.arena.z - 4; }
  const b = g.boss;
  g.twist = { id: 'quaking' };
  g.startFight(b);
  assert.equal(g.fight.who.length, 2);
  b.phase = 1;
  for (const p of [hum, bot]) { p.iframeUntil = 0; p.hp = 1; g.damagePlayer(p, 9999, { src: 'warden slam' }); }
  const d = rows.find(r => r.kind === 'death'), bd = rows.find(r => r.kind === 'bot_death');
  assert.ok(d && bd, 'player death and bot death recorded');
  assert.deepEqual([d.data.cause, d.data.boss, d.data.phase, d.data.twist], ['warden slam', 1, 1, 'quaking']);
  assert.deepEqual([bd.data.boss, bd.data.phase], [1, 1]);
  ok('deaths in a boss fight carry boss, phase and twist; bot deaths go in as bot_death');
  g.endFight('wipe', b);
  const f = rows.filter(r => r.kind === 'fight');
  assert.equal(f.length, 1, 'one fight row per fight');
  assert.equal(f[0].p, null);
  assert.deepEqual(
    { floor: f[0].data.floor, result: f[0].data.result, humans: f[0].data.humans, bots: f[0].data.bots, deaths: f[0].data.deaths, botDeaths: f[0].data.botDeaths, cls: f[0].data.cls, botCls: f[0].data.botCls, twist: f[0].data.twist },
    { floor: 1, result: 'wipe', humans: 1, bots: 1, deaths: 1, botDeaths: 1, cls: ['guardian'], botCls: ['cleric'], twist: 'quaking' });
  assert.deepEqual(f[0].data.party, [`s${hum.sid}`]);
  ok('fight row: result, players vs bots, deaths split, party key');
  g.endFight('wipe', b);
  assert.equal(rows.filter(r => r.kind === 'fight').length, 1);
  ok('no fight row without a running fight');
  // Floor 2 fight
  g.sovereign.phase = 2;
  g.startFight2(g.sovereign);
  g.fight2.ids.add(hum.id); g.fight2.who = [{ bot: false, cls: 'guardian', key: 'c7', lvl: 15 }];
  g.endFight2('kill', g.sovereign);
  const f2 = rows.filter(r => r.kind === 'fight')[1];
  assert.deepEqual([f2.data.floor, f2.data.result, f2.data.phase, f2.data.twist, f2.data.party], [2, 'kill', 2, undefined, ['c7']]);
  ok('Floor 2 fights are recorded too');
  // session end: zone, class, style, party (noted before removePlayer leaves the party)
  hum.dead = false; hum.x = 0; hum.z = 0;
  g.removePlayer(hum);
  const se = rows.find(r => r.kind === 'session_end');
  assert.equal(se.data.cls, 'guardian');
  assert.ok(se.data.zone && se.data.floor === 1 && se.data.style, JSON.stringify(se.data));
  ok(`session_end carries zone (${se.data.zone}), floor, class, style`);
  g.removePlayer(bot);
  assert.equal(rows.filter(r => r.kind === 'session_end').length, 1);
  ok('bots leaving record no session_end');
}

// ---------- 2. queries (needs a database) ----------
const BASE_DB = process.env.DATABASE_URL;
if (!BASE_DB) { console.log('  (query checks skipped: set DATABASE_URL to a local database)'); console.log(`all ${n} checks passed`); process.exit(0); }
const pg = (await import('pg')).default;
const schema = `trk_test_${process.pid}`;
const admin = new pg.Pool({ connectionString: BASE_DB });
await admin.query(`CREATE SCHEMA ${schema}`);
const DB = `${BASE_DB}${BASE_DB.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
process.env.DATABASE_URL = DB;
const db = await import('../server/db.js');
const track = await import('../server/track.js');
let srv = null;
try {
  await db.migrate();
  assert.ok(db.enabled, 'database up');
  const q = db.q;
  const [acct] = await q(`INSERT INTO accounts (discord_name) VALUES ('t') RETURNING id`);
  const mk = async (name, cls, talents, style, daysAgo = 0) => (await q(`INSERT INTO characters (account_id, name, cls, lvl, talents, inv, updated_at) VALUES ($1, $2, $3, 12, $4, $5, now() - make_interval(days => $6)) RETURNING id`,
    [acct.id, name, cls, talents, { bag: [], eq: { weapon: style ? { slot: 'weapon', style } : null } }, daysAgo]))[0].id;
  const A = await mk('Ta', 'guardian', { gd_wall: 2, gd_x: 1 }, 'mace'), B = await mk('Tb', 'cleric', { cl_mend: 1 }, null), C = await mk('Tc', 'guardian', { gd_wall: 1 }, 'shield');
  const ev = (daysAgo, kind, data, char = null, sid = null) => q(`INSERT INTO play_events (at, account_id, char_id, sid, kind, data) VALUES (now() - make_interval(secs => $1), $2, $3, $4, $5, $6)`,
    [Math.round(daysAgo * 86400), char ? acct.id : null, char, sid, kind, data]);
  const fight = (daysAgo, result, party, extra = {}) => ev(daysAgo, 'fight', { floor: 1, result, secs: 90, phase: 1, hpLeft: result === 'wipe' ? 40 : 0, humans: party.length, bots: 0, deaths: 1, botDeaths: 0, party, cls: [], botCls: [], lvl: 12, ...extra });
  // deaths: 2 field wolf bites, 3 Warden slams in phase 2 (one twist), 1 bot death in phase 3
  await ev(1, 'death', { cause: 'wolf bite', floor: 1 }, A); await ev(1, 'death', { cause: 'wolf bite', floor: 1 }, B);
  for (let i = 0; i < 3; i++) await ev(1, 'death', { cause: 'warden slam', floor: 1, boss: 1, phase: 1, twist: 'echo' }, A);
  await ev(1, 'bot_death', { cause: 'warden quake', floor: 1, boss: 1, phase: 2 });
  // attempts: party A+B wiped 3 times, then cleared, then farmed it once more; party C cleared 20 days ago on its
  // first try and fought again today (still 1 attempt); a bot-only party wiped twice; a guest party never cleared
  const AB = [`c${A}`, `c${B}`].sort();
  await fight(5, 'wipe', AB, { twist: 'echo', hpLeft: 60 }); await fight(4, 'wipe', AB, { hpLeft: 25 }); await fight(3, 'wipe', AB, { hpLeft: 30 });
  await fight(2, 'kill', AB, { twist: 'echo' }); await fight(1, 'kill', AB);
  await fight(20, 'kill', [`c${C}`]); await fight(0.5, 'wipe', [`c${C}`]);
  await fight(1, 'wipe', [], { humans: 0, bots: 3, botCls: ['cleric', 'guardian', 'swordsman'], deaths: 0, botDeaths: 3 });
  await fight(1, 'wipe', [], { humans: 0, bots: 3, botCls: ['cleric', 'guardian', 'swordsman'], deaths: 0, botDeaths: 2 });
  await fight(1, 'wipe', ['sabc'], { humans: 1, bots: 2, botCls: ['ranger', 'ranger'] });
  // sessions: A quit at level 12 in the field 5 days ago (dropped off); B is still playing; a guest played 90 s
  await ev(5, 'session_end', { secs: 1000, lvl: 12, zone: 'Floor 1 — Verdant Field', cls: 'guardian', style: 'mace', party: 1, pbots: 0 }, A);
  await ev(6, 'session_end', { secs: 4000, lvl: 11, zone: 'Town of Beginnings', cls: 'guardian', style: 'mace', party: 1, pbots: 0 }, A);
  await ev(1, 'session_end', { secs: 2000, lvl: 12, zone: "Warden's Chamber", cls: 'cleric', style: 'tome', party: 3, pbots: 2 }, B);
  await ev(0.1, 'session_end', { secs: 90, lvl: 3, zone: 'Town of Beginnings', cls: 'ranger', style: 'longbow', party: 1, pbots: 0 }, null, 'g1');
  await ev(30, 'session_end', { secs: 90, lvl: 3, zone: 'Old', cls: 'ranger', party: 1, pbots: 0 }, null, 'g2'); // outside the window
  await ev(1, 'pbot_add', { cls: 'ranger', skill: 4, lvl: 12 }, B); await ev(1, 'pbot_add', { cls: 'ranger', skill: 5, lvl: 12 }, B); await ev(2, 'pbot_add', { cls: 'cleric', skill: 5, lvl: 12 }, A);

  const d = await track.detail(7, { fresh: true });
  assert.equal(d.enabled, true);
  const deaths = (bot, cause) => d.deaths.filter(r => r.bot === bot && r.cause === cause);
  assert.deepEqual(deaths(false, 'wolf bite').map(r => [r.boss, r.n]), [[0, 2]]);
  assert.deepEqual(deaths(false, 'warden slam').map(r => [r.boss, r.phase, r.twist, r.n]), [[1, 1, 'echo', 3]]);
  assert.deepEqual(deaths(true, 'warden quake').map(r => [r.boss, r.phase, r.n]), [[1, 2, 1]]);
  ok('deaths: by cause, boss, phase and twist; bot deaths kept apart');
  const comp = k => d.fights.filter(r => r.comp === k).reduce((s, r) => ({ fights: s.fights + r.fights, kills: s.kills + r.kills, bots: s.bots + r.bots, bd: s.bd + r.bot_deaths }), { fights: 0, kills: 0, bots: 0, bd: 0 });
  assert.deepEqual(comp('players'), { fights: 6, kills: 2, bots: 0, bd: 0 }); // the 20-day-old clear is outside the window
  assert.deepEqual(comp('bots'), { fights: 2, kills: 0, bots: 6, bd: 5 });
  assert.deepEqual(comp('mixed'), { fights: 1, kills: 0, bots: 2, bd: 0 });
  assert.equal(d.fights.find(r => r.twist === 'echo' && r.comp === 'players').fights, 2);
  ok('fights: by composition (players / mixed / bots) and twist');
  const att = d.attempts;
  const ab = att.find(r => r.members.some(m => m.name === 'Ta'));
  assert.deepEqual([ab.attempts, ab.cleared, ab.fights, ab.kills, ab.best_hp_left], [4, true, 5, 2, 25]);
  assert.deepEqual(ab.members.map(m => m.name).sort(), ['Ta', 'Tb']);
  const c = att.find(r => r.members.some(m => m.name === 'Tc'));
  assert.deepEqual([c.attempts, c.cleared], [1, true]);
  const bots = att.find(r => r.members.every(m => m.bot));
  assert.deepEqual([bots.attempts, bots.cleared, bots.members.map(m => m.cls)], [2, false, ['cleric', 'guardian', 'swordsman']]);
  const guestParty = att.find(r => r.members.some(m => m.name === 'Guest'));
  assert.deepEqual([guestParty.attempts, guestParty.cleared, guestParty.bots], [1, false, 2]);
  assert.equal(att.length, 4);
  ok('attempts until first clear: per party, counted over all time, listed when active in the window');
  assert.deepEqual(d.lengths.map(r => [r.b, r.n]), [[0, 1], [3, 1], [4, 1], [5, 1]]);
  ok('session lengths bucketed');
  const drop = Object.fromEntries(d.dropoff.map(r => [`${r.zone}|${r.lvl}|${r.gone}|${r.guest}`, r.n]));
  assert.deepEqual(drop, { 'Floor 1 — Verdant Field|12|true|false': 1, "Warden's Chamber|12|false|false": 1, 'Town of Beginnings|3|false|true': 1 });
  ok("drop-off: each player's last session (zone, level, gone for 3+ days)");
  const played = Object.fromEntries(d.played.map(r => [`${r.cls}/${r.style}`, [r.sessions, r.players, r.mins]]));
  assert.deepEqual(played, { 'guardian/mace': [2, 1, 83], 'cleric/tome': [1, 1, 33], 'ranger/longbow': [1, 1, 2] });
  const chars = Object.fromEntries(d.chars.map(r => [`${r.cls}/${r.style}`, r.n]));
  assert.deepEqual(chars, { 'guardian/mace': 1, 'guardian/shield': 1, 'cleric/null': 1 });
  const tal = Object.fromEntries(d.talents.map(r => [r.node, r.n]));
  assert.deepEqual(tal, { gd_wall: 2, gd_x: 1, cl_mend: 1 });
  ok('picks: play time by class / style, characters by style, talents learned');
  assert.deepEqual(d.pbots.map(r => [r.cls, r.adds, r.players]).sort(), [['cleric', 1, 1], ['ranger', 2, 1]]);
  assert.deepEqual(d.botSessions, { sessions: 4, with_bots: 1 });
  ok('bots players add and sessions with bots');
  const pub = await track.stats(7);
  assert.equal(pub.deaths.reduce((s, r) => s + r.n, 0), 5, 'public stats ignore bot deaths');
  ok('the public summary is unchanged by the new rows');
  const t0 = Date.now(); await track.detail(7); assert.ok(Date.now() - t0 < 5, 'second call is cached');
  ok('results cached per window');

  // query plans: with plenty of other events, every query reads play_events through the (kind, at) index
  await q(`INSERT INTO play_events (at, kind, data) SELECT now() - make_interval(secs => g % 2000000), (ARRAY['talent','loot','level','guide','title'])[1 + g % 5], '{}'::jsonb FROM generate_series(1, 60000) g`);
  await q('ANALYZE play_events');
  for (const [k, text] of Object.entries(track.DETAIL_SQL)) {
    const plan = (await q(`EXPLAIN ${text}`, [7])).map(r => r['QUERY PLAN']).join('\n');
    if (/play_events/.test(text)) assert.ok(!/Seq Scan on play_events/.test(plan), `${k} scans play_events:\n${plan}`);
  }
  const t1 = Date.now(); await track.detail(30, { fresh: true });
  ok(`queries use the (kind, at) index (60k extra rows: all sections in ${Date.now() - t1} ms)`);

  // admin-only API
  const PORT = Number(process.env.PORT) || 4231, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, DATABASE_URL: DB, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', x => { log += x; }); srv.stderr.on('data', x => { log += x; });
  for (let k = 0; k < 150 && !/running on/.test(log); k++) await sleep(100);
  const get = (p, tok) => fetch(`http://localhost:${PORT}${p}`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
  assert.equal((await get('/api/admin/stats')).status, 401);
  const tok = (await (await fetch(`http://localhost:${PORT}/api/guest`, { method: 'POST' })).json()).token;
  assert.equal((await get('/api/admin/stats', tok)).status, 403);
  await q(`UPDATE accounts SET is_admin = true WHERE id = (SELECT account_id FROM sessions ORDER BY created_at DESC LIMIT 1)`);
  const r = await get('/api/admin/stats?days=7', tok);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).attempts.length, 4);
  assert.equal((await get('/api/stats')).status, 200, 'the public summary stays public');
  ok('/api/admin/stats: 401 signed out, 403 non-admin, 200 admin; /api/stats stays public');
} finally {
  srv?.kill();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
  await admin.end();
}
console.log(`all ${n} checks passed`);
process.exit(0);
