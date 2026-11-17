// Admin API end-to-end: starts its own server on PORT (default 3572) against DATABASE_URL (required).
// Usage: DATABASE_URL=postgresql://... node test/admin.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import pg from 'pg';
import { MASTERY, masterySkills } from '../shared/mastery.js';

const DB = process.env.DATABASE_URL;
if (!DB) { console.log('skipped: set DATABASE_URL to run the admin tests'); process.exit(0); }
const PORT = Number(process.env.PORT) || 3572;
const BASE = `http://localhost:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const local = /@(localhost|127\.0\.0\.1)|host=\//.test(DB);
const pool = new pg.Pool({ connectionString: DB, ssl: local ? false : { rejectUnauthorized: false } });
const sql = (t, p) => pool.query(t, p).then(r => r.rows);

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }

async function call(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// A WebSocket client that remembers the latest messages of each type.
function client(join) {
  const c = { msgs: [], last: {}, sys: [] };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify(join)));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    c.last[m.type] = m;
    if (m.type === 'welcome') c.id = m.id;
    if (m.type === 'snap') for (const e of m.w.events) if (e.t === 'sys' && (!e.to || e.to === c.id)) c.sys.push(e.text);
  });
  c.closed = new Promise(r => c.ws.on('close', r));
  return c;
}
async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), MAX_BOTS: '7' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

try {
  await until(() => /running on/.test(log), 15000, 'server start');
  const tag = Math.random().toString(36).slice(2, 7);

  // ---------- access ----------
  const adminTok = (await call('POST', '/api/guest')).body.token;
  const userTok = (await call('POST', '/api/guest')).body.token;
  ok(adminTok && userTok, 'guest accounts created');
  const meA = await call('GET', '/api/admin/me', adminTok);
  ok(meA.status === 200 && meA.body.admin === false, '/api/admin/me: a fresh account is not an admin');
  await sql('UPDATE accounts SET is_admin = true WHERE id = $1', [meA.body.account.id]);
  ok((await call('GET', '/api/admin/me', adminTok)).body.admin === true, 'is_admin = true makes it an admin');
  ok((await call('GET', '/api/admin/players', userTok)).status === 403, 'non-admin gets 403 on /api/admin/players');
  ok((await call('POST', '/api/admin/bots', userTok, { cls: 'cleric' })).status === 403, 'non-admin gets 403 adding a bot');
  ok((await call('GET', '/api/admin/players')).status === 401, 'no session: 401');

  // ---------- characters ----------
  const mk = async (tok, name, cls) => (await call('POST', '/api/characters', tok, { name, cls })).body.character;
  const off = await mk(userTok, `Off${tag}`, 'swordsman');
  const on = await mk(userTok, `On${tag}`, 'cleric');
  const other = await mk(userTok, `Taken${tag}`, 'guardian');
  ok(off?.id && on?.id && other?.id, 'characters created');
  const list = await call('GET', '/api/admin/players', adminTok);
  const row = list.body.players?.find(p => p.id === off.id);
  ok(list.status === 200 && row && !row.online && /^guest #\d+$/.test(row.account), 'admin lists players (offline, guest account label)');

  // ---------- offline edit ----------
  let r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { lvl: 7, xp: 40, gold: 500, cons: { potion: 9 }, mats: { horn: 4 }, ops: [{ op: 'addItem', slot: 'weapon', r: 2, cls: 'swordsman' }, { op: 'addLastAttack', which: 1 }] });
  ok(r.status === 200 && r.body.character.lvl === 7 && r.body.character.inv.bag.length === 2, 'offline edit: level, gold, items');
  let [db] = await sql('SELECT lvl, xp, gold, inv, stats FROM characters WHERE id = $1', [off.id]);
  ok(db.lvl === 7 && db.xp === 40 && db.gold === 500 && db.inv.cons.potion === 9 && db.inv.mats.horn === 4, 'DB has the new level, XP, gold, potions, materials');
  ok(db.inv.bag.some(it => it.slot === 'weapon' && it.r === 2) && db.inv.bag.some(it => it.la === 1), 'DB has the added Rare weapon and the Horn of the Warden');
  const weapon = db.inv.bag.find(it => it.slot === 'weapon');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { ops: [{ op: 'equip', u: weapon.u }] });
  ok(r.body.character.inv.eq.weapon?.u === weapon.u, 'equip a bag item');
  const rawInv = { ...r.body.character.inv, cons: { potion: 2, tonic: 5, draught: 1 } };
  const rawStats = { ...r.body.character.stats, kills: 77, titles: ['veteran'], activeTitle: 'veteran', mastery: { swordsman: { slash: 3 } } };
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { rawInv, rawStats });
  ok(r.status === 200, 'raw JSON accepted');
  [db] = await sql('SELECT inv, stats FROM characters WHERE id = $1', [off.id]);
  ok(db.inv.cons.tonic === 5 && db.stats.kills === 77 && db.stats.activeTitle === 'veteran' && db.stats.mastery?.swordsman?.slash === 3, 'raw JSON saved (unknown stats keys like mastery kept)');
  const [sw1, sw2] = masterySkills('swordsman');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { mastery: { [sw1]: { lvl: 3, br: 'B' } } });
  [db] = await sql('SELECT mastery FROM characters WHERE id = $1', [off.id]);
  ok(r.status === 200 && db.mastery?.[sw1]?.pts === MASTERY.need[3] && db.mastery[sw1].br === 'B', 'mastery: set a skill to Mastery 3 with branch B (DB)');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { rawMastery: { ...r.body.character.mastery, [sw2]: { pts: 2000, br: 'A' } } });
  [db] = await sql('SELECT mastery FROM characters WHERE id = $1', [off.id]);
  ok(r.status === 200 && db.mastery[sw2].pts === 2000 && db.mastery[sw2].br === 'A' && db.mastery[sw1].br === 'B', 'raw mastery JSON saved');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { mastery: { [sw1]: { br: 'C' } } });
  ok(r.status === 400, 'bad branch rejected');
  // talents (shared/talents.js): the section and the raw editor, validated against the tree and the level
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { lvl: 10, talents: { sw_edge: 3, sw_precision: 1, sw_finale: 1 } });
  [db] = await sql('SELECT talents FROM characters WHERE id = $1', [off.id]);
  ok(r.status === 200 && db.talents?.sw_finale === 1 && r.body.character.talents.sw_edge === 3, 'talents: set ranks (DB)');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { talents: { sw_exec: 1 } });
  ok(r.status === 400 && /talents/.test(r.body.error), 'an illegal talent tree is rejected (400)');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { rawTalents: { sw_edge: 2 } });
  [db] = await sql('SELECT talents FROM characters WHERE id = $1', [off.id]);
  ok(r.status === 200 && JSON.stringify(db.talents) === '{"sw_edge":2}', 'raw talents JSON saved');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { lvl: 2 });
  [db] = await sql('SELECT talents FROM characters WHERE id = $1', [off.id]);
  ok(r.status === 200 && JSON.stringify(db.talents) === '{}', 'lowering the level below the points spent refunds the talents');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { rawInv: { bag: 'nope' } });
  ok(r.status === 400, 'invalid raw inventory rejected (400)');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { lvl: 99 });
  ok(r.status === 400, 'level out of range rejected');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { name: `Taken${tag}` });
  ok(r.status === 409, 'rename to a taken name: 409');
  r = await call('PATCH', `/api/admin/characters/${off.id}`, adminTok, { name: `Ren${tag}`, cls: 'guardian' });
  [db] = await sql('SELECT name, cls, inv FROM characters WHERE id = $1', [off.id]);
  ok(r.status === 200 && db.name === `Ren${tag}` && db.cls === 'guardian' && !db.inv.eq.weapon && db.inv.bag.some(it => it.u === weapon.u), 'rename + class change (old-class weapon back to the bag)');

  // ---------- online edit ----------
  const pc = client({ type: 'join', session: userTok, character: on.id });
  await until(() => pc.last.welcome && pc.last.inv, 5000, 'character join');
  r = await call('GET', '/api/admin/players', adminTok);
  ok(r.body.players.find(p => p.id === on.id)?.online === true, 'online character shows as online with an area');
  const clSk = masterySkills('cleric')[0];
  r = await call('PATCH', `/api/admin/characters/${on.id}`, adminTok, { lvl: 9, gold: 1234, floor2: true, mastery: { [clSk]: { lvl: 4, br: 'A' } }, talents: { cl_hands: 2 }, ops: [{ op: 'addLastAttack', which: 2 }] });
  ok(r.status === 200 && r.body.character.online, 'edit an online character');
  await until(() => pc.last.inv?.gold === 1234 && pc.last.inv.bag.some(it => it.la === 2), 3000, 'live inv');
  ok(true, 'the player received the updated inventory (gold, Tidecloak)');
  await until(() => pc.last.snap?.me?.lvl === 9, 3000, 'live level');
  ok(pc.last.inv.life.floor2 === 1, 'the player sees level 9 and Floor 2 unlocked');
  await until(() => pc.last.mastery?.m?.[clSk]?.pts === MASTERY.need[4] && pc.last.mastery.m[clSk].br === 'A', 3000, 'live mastery');
  ok(true, 'the player received the updated skill mastery');
  await until(() => pc.last.talents?.r?.cl_hands === 2 && pc.last.talents.pts === 8, 3000, 'live talents');
  ok(true, 'the player received the updated talents');
  await until(() => pc.sys.some(t => /admin updated your character/.test(t)), 3000, 'sys message');
  ok(true, 'the player got "An admin updated your character"');
  pc.ws.close(); await pc.closed; await sleep(400);
  [db] = await sql('SELECT lvl, gold, inv, stats, mastery, talents FROM characters WHERE id = $1', [on.id]);
  ok(db.lvl === 9 && db.gold === 1234 && db.inv.bag.some(it => it.la === 2) && db.stats.floor2 === 1 && db.mastery[clSk].pts === MASTERY.need[4] && db.talents?.cl_hands === 2, 'after disconnect the DB keeps the admin values (incl. mastery, talents)');

  // ---------- bots ----------
  const watcher = client({ type: 'join', name: `Watch${tag}`, cls: 'guardian' });
  await until(() => watcher.last.roster, 5000, 'watcher roster');
  r = await call('POST', '/api/admin/bots', adminTok, { cls: 'swordsman', name: `Bot${tag}`, lvl: 6, behaviour: 'field' });
  ok(r.status === 200 && r.body.added.name === `Bot${tag}`, 'add a single bot');
  const solo = r.body.added;
  r = await call('POST', '/api/admin/bots', adminTok, { cls: 'cleric', lvl: 4, behaviour: 'follow', follow: `Watch${tag}` });
  ok(r.status === 200, 'add a follower bot');
  const fol = r.body.added;
  r = await call('POST', '/api/admin/bots/team', adminTok, { lvl: 5 });
  ok(r.status === 200 && r.body.added.length === 3, 'add a team');
  const roster = await until(() => { const ro = watcher.last.roster?.players; return ro && ro.filter(p => p.bot).length === 5 && ro; }, 6000, 'bots in roster');
  ok(roster.find(p => p.name === `Bot${tag}`)?.bot === 1 && !roster.find(p => p.name === `Watch${tag}`).bot, 'bots are in the game roster, flagged bot (humans are not)');
  const botList = (await call('GET', '/api/admin/bots', adminTok)).body;
  const sb = botList.bots.find(b => b.bid === solo.bid);
  ok(sb && sb.lvl === 6 && sb.status === 'online' && sb.hp > 0, 'the bot list has level, HP and status (START level applied)');
  await sleep(2500);
  const fb = (await call('GET', '/api/admin/bots', adminTok)).body.bots.find(b => b.bid === fol.bid);
  ok(fb.party.includes(`Watch${tag}`), "the follower joined the followed player's party");
  r = await call('POST', '/api/admin/bots/team', adminTok, {});
  ok(r.status === 400 && /limit/i.test(r.body.error), 'bot cap enforced (MAX_BOTS=7 here)');
  r = await call('POST', '/api/admin/bots', adminTok, { cls: 'cleric', behaviour: 'follow', follow: 'NobodyHere' });
  ok(r.status === 400, 'following a player who is not online is rejected');
  const pl = (await call('GET', '/api/admin/players', adminTok)).body;
  ok(pl.bots === 5 && pl.anon.length === 1 && pl.anon[0].name === `Watch${tag}`, 'players list: bots counted apart, not listed as anonymous players');
  const lob = (await call('GET', '/api/lobby')).body;
  ok(lob.offline.some(o => o.name === `Ren${tag}`) && !lob.offline.some(o => /^(Brann|Kael|Lyra)/.test(o.name)), '/api/lobby lists recently seen characters, no bots');
  ok(lob.offline.every(o => Object.keys(o).sort().join() === 'cls,lvl,name,seen'), '/api/lobby has no account details');
  r = await call('DELETE', `/api/admin/bots/${solo.bid}`, adminTok);
  await until(() => watcher.last.roster && !watcher.last.roster.players.some(p => p.name === `Bot${tag}`), 4000, 'bot removed from roster');
  ok(r.status === 200, 'remove one bot (gone from the roster)');
  r = await call('DELETE', '/api/admin/bots', adminTok);
  await until(() => watcher.last.roster && !watcher.last.roster.players.some(p => p.bot), 4000, 'all bots gone');
  ok(r.body.removed === 4, 'remove all bots');
  watcher.ws.close();

  // ---------- delete ----------
  r = await call('DELETE', `/api/admin/characters/${other.id}`, adminTok, { confirm: 'wrong' });
  ok(r.status === 400, 'delete needs the typed name');
  r = await call('DELETE', `/api/admin/characters/${other.id}`, adminTok, { confirm: `Taken${tag}` });
  ok(r.status === 200 && (await sql('SELECT id FROM characters WHERE id = $1', [other.id])).length === 0, 'delete with the typed name removes the row');
} catch (e) {
  failed++;
  console.log('  NOT OK - ' + e.message);
  console.log(log.split('\n').slice(-15).join('\n'));
} finally {
  srv.kill();
  await pool.end();
}
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} admin checks passed`);
process.exit(failed ? 1 : 0);
