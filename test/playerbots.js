// Player-owned bots end-to-end over the WebSocket ({ type: 'pbot' }): add (every setup, premade loadout at the
// owner's level, joins the owner's party, follows), the per-player limit, the party-full check, ownership (others
// can't edit/dismiss), owner edits (skill / behaviour / name), dismiss, reconnect within the grace period, and
// removal after the owner leaves. With DATABASE_URL set it also checks that an admin can manage anyone's bot.
// Starts its own server on PORT (default 3641). Usage: node test/playerbots.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { CLASSES, CLASS_IDS, statsFor, resolveCollision, walkable } from '../shared/data.js';
import { setups, loadoutFor } from '../shared/playerbots.js';

const PORT = Number(process.env.PORT) || 3641;
const DB = process.env.DATABASE_URL || '';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

// A player client: keeps the roster, every player's snapshot row, its sys messages and the last pbot reply per op.
function client(name, cls = 'swordsman', join = {}) {
  const c = { name, pl: new Map(), roster: [], sys: [], replies: [], seq: 0 };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'join', name, cls, ...join })));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'welcome') Object.assign(c, { id: m.id, x: m.x, z: m.z, seq: m.seq });
    if (m.type === 'roster') c.roster = m.players;
    if (m.type === 'pbot') c.replies.push(m);
    if (m.type === 'snap') {
      c.pl = new Map(m.w.players.map(p => [p[0], { x: p[1], z: p[2], hp: p[4], maxHp: p[5], lvl: p[6], cls: CLASS_IDS[p[7]], party: p[8], dead: !!p[9] }]));
      for (const e of m.w.events) {
        if (e.t === 'sys' && (!e.to || e.to === c.id)) c.sys.push(e.text);
        if (e.t === 'tp' && e.id === c.id) Object.assign(c, { x: e.x, z: e.z, seq: e.s });
        if (e.t === 'invite' && e.to === c.id && c.autoAccept) c.ws.send(JSON.stringify({ type: 'accept', from: e.from }));
      }
    }
  });
  c.send = o => c.ws.send(JSON.stringify(o));
  c.pbot = async (o, ms = 4000) => { // send and wait for the reply
    const k = c.replies.length;
    c.send({ type: 'pbot', ...o });
    return until(() => c.replies.slice(k).find(r => r.op === o.op), ms, `pbot ${o.op} reply`);
  };
  c.list = async () => { await sleep(260); return (await c.pbot({ op: 'list' })).list; };
  c.me = () => c.pl.get(c.id);
  c.walk = async (tx, tz) => { // walk at ~6 m/s along a straight line
    while (Math.hypot(tx - c.x, tz - c.z) > 0.4) {
      const d = Math.hypot(tx - c.x, tz - c.z), s = Math.min(0.3, d);
      let [x, z] = resolveCollision(c.x + ((tx - c.x) / d) * s, c.z + ((tz - c.z) / d) * s);
      if (!walkable(x, z, true)) break;
      c.x = x; c.z = z;
      c.send({ type: 'input', x, z, face: 0, seq: c.seq });
      await sleep(50);
    }
  };
  return c;
}

const env = { ...process.env, PORT: String(PORT), START_LEVEL: '8', PLAYER_BOT_GRACE: '2', MAX_BOTS: '12' };
if (!DB) delete env.DATABASE_URL;
const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const clients = [];

try {
  await until(() => /running on/.test(log), 15000, 'server start');
  const tag = String(100 + Math.floor(Math.random() * 900));
  const A = client(`Ann${tag}`, 'swordsman'), B = client(`Bob${tag}`, 'guardian');
  clients.push(A, B);
  await until(() => A.id && B.id && A.me(), 5000, 'players joined');

  // ---------- list ----------
  let L = await A.list();
  ok(Array.isArray(L.bots) && L.mine === 0 && L.max === 3 && L.cap === 12, 'list: no bots yet, limit 3 of 12');

  // ---------- add one bot per setup (the first three) ----------
  const picks = ['Tank', 'Healer', 'Damage'].map(role => setups().find(s => s.role === role));
  ok(picks.every(Boolean) && setups().length === Object.keys(CLASSES).length && setups()[0].role === 'Tank', 'a setup per class, Tank first');
  const added = [];
  for (const [i, s] of picks.entries()) {
    const r = await A.pbot({ op: 'add', cls: s.cls, skill: i === 1 ? 3 : undefined, name: i === 2 ? `Kael${tag}` : undefined });
    ok(r.ok && r.bid, `add ${s.label}: ${r.msg || r.error}`);
    added.push(r.bid);
  }
  const r4 = await A.pbot({ op: 'add', cls: picks[0].cls });
  ok(!r4.ok && /already have 3/.test(r4.error), `4th add refused: "${r4.error}"`);

  // they join at Ann's level with the premade loadout, in Ann's party
  await until(() => A.me()?.party && A.roster.filter(r => r.bot && r.owner === A.name).length === 3, 8000, 'bots in roster');
  const botIds = () => A.roster.filter(r => r.bot && r.owner === A.name).map(r => r.id);
  await until(() => botIds().every(id => A.pl.get(id)?.party === A.me().party), 6000, 'bots in Ann\'s party');
  ok(true, 'all three bots joined Ann\'s party');
  L = await A.list();
  const mine = L.bots.filter(b => b.mine);
  ok(mine.length === 3 && L.mine === 3, 'list: 3 of my bots');
  ok(mine.every(b => b.lvl === 8 && b.owner === A.name && b.can), 'bots are Lv 8 (my level), owned by me');
  ok(mine.find(b => b.bid === added[1]).skill === 3 && mine.find(b => b.bid === added[0]).skill === 4, 'skill level as picked (default 4)');
  ok(mine.some(b => b.name === `Kael${tag}`), 'custom name kept');
  const want = loadoutFor(8);
  ok(want.rarityName === 'Uncommon' && want.mastery === 2 && !want.evolved, 'loadout table: Lv 8 = Uncommon, Mastery 2');
  ok(mine.every(b => b.kit && b.kit.gear.length === 3 && b.kit.gear.every(g => g.r === 1)), 'premade gear: weapon, armour and charm, all Uncommon');
  ok(mine.every(b => b.kit.mastery.length && b.kit.mastery.every(m => m.lvl === 2 && !m.br)), 'premade mastery: every skill at Mastery 2');
  const heal = mine.find(b => CLASSES[b.cls].role === 'Healer'), dmg = mine.find(b => CLASSES[b.cls].role === 'Damage');
  ok(heal.kit.gear.find(g => g.slot === 'charm').st.haste && dmg.kit.gear.find(g => g.slot === 'charm').st.crit, 'charm suits the role (healer: haste, damage: crit)');
  ok(mine.every(b => { const p = A.pl.get(b.id); return p && p.maxHp >= Math.round(statsFor(b.cls, 8).maxHp * (1 + b.kit.gear.find(g => g.slot === 'armor').st.hp / 100)); }), 'max health includes the armour (talent health nodes may add more)');
  ok(mine.every(b => /^Following/.test(b.doing)), `bots are following ("${mine[0].doing}")`);

  // they follow: Ann walks ~20 m, the bots come along
  const start = { x: A.x, z: A.z };
  await A.walk(0, 22);
  await sleep(3500);
  const near = botIds().map(id => A.pl.get(id)).map(p => Math.hypot(p.x - A.x, p.z - A.z));
  ok(Math.hypot(A.x - start.x, A.z - start.z) > 10 && near.every(d => d < 8), `bots followed Ann (distances ${near.map(d => d.toFixed(1)).join(', ')} m)`);

  // ---------- ownership: Bob can't touch Ann's bots ----------
  let r = await B.pbot({ op: 'edit', bid: added[0], skill: 1 });
  ok(!r.ok && /Ann/.test(r.error), `another player can't edit: "${r.error}"`);
  r = await B.pbot({ op: 'dismiss', bid: added[0] });
  ok(!r.ok, 'another player can\'t dismiss');
  const LB = (await B.list()).bots.find(b => b.bid === added[0]);
  ok(LB && !LB.mine && !LB.can && LB.owner === A.name && !LB.kit, 'Bob sees Ann\'s bot with its owner, no controls, no kit');

  // ---------- owner edits ----------
  r = await A.pbot({ op: 'edit', bid: added[0], skill: 2, mode: 'stay', name: `Rock${tag}` });
  ok(r.ok, `edit skill + behaviour + name: ${r.msg || r.error}`);
  let b0 = r.list.bots.find(b => b.bid === added[0]);
  ok(b0.skill === 2 && b0.skillName === 'Casual' && b0.mode === 'stay' && b0.name === `Rock${tag}` && b0.doing === 'Holding position', 'edit applied (Casual, stay, renamed)');
  await until(() => A.roster.some(x => x.name === `Rock${tag}` && x.owner === A.name && x.mode === 'stay'), 3000, 'roster rename');
  ok(true, 'roster shows the new name, owner and mode');
  r = await A.pbot({ op: 'edit', bid: added[0], mode: 'field' });
  b0 = r.list.bots.find(b => b.bid === added[0]);
  ok(r.ok && b0.mode === 'field' && b0.behaviour === 'field', 'behaviour: farm nearby');
  r = await A.pbot({ op: 'edit', bid: added[0], mode: 'nope' });
  ok(!r.ok && /Unknown/.test(r.error), 'bad behaviour refused');
  r = await A.pbot({ op: 'edit', bid: added[0], name: '!' });
  ok(!r.ok, 'bad name refused');
  r = await A.pbot({ op: 'edit', bid: added[0], mode: 'follow' });
  ok(r.ok && r.list.bots.find(b => b.bid === added[0]).doing === `Following ${A.name}`, 'behaviour: follow me again');
  await sleep(1200);
  ok(A.pl.get(botIds()[0])?.party === A.me().party, 'still in Ann\'s party after the behaviour changes');

  // ---------- dismiss ----------
  r = await A.pbot({ op: 'dismiss', bid: added[2] });
  ok(r.ok && !r.list.bots.some(b => b.bid === added[2]) && r.list.mine === 2, `dismiss: ${r.msg}`);
  await until(() => !A.roster.some(x => x.name === `Kael${tag}`), 3000, 'dismissed bot gone from roster');
  ok(true, 'dismissed bot left the world');

  // ---------- party full ----------
  const extra = [client(`Cy${tag}`), client(`Di${tag}`), client(`Ed${tag}`)];
  clients.push(...extra);
  for (const c of extra) c.autoAccept = true;
  await until(() => extra.every(c => c.id), 5000, 'extra players');
  for (const c of extra) A.send({ type: 'invite', id: c.id });
  await until(() => extra.every(c => c.me()?.party && c.me().party === A.me()?.party), 5000, 'party of 6');
  r = await A.pbot({ op: 'add', cls: picks[2].cls });
  ok(!r.ok && /party is full/.test(r.error), `party full refused: "${r.error}"`);
  for (const c of extra) c.ws.close();
  await sleep(300);

  // ---------- Bob's bot: listed after Ann's, reconnect within the grace period ----------
  r = await B.pbot({ op: 'add', cls: picks[1].cls });
  ok(r.ok, 'Bob adds a bot');
  const bobBid = r.bid;
  L = await A.list();
  ok(L.bots.findIndex(b => b.bid === bobBid) > L.bots.findIndex(b => b.mine) && L.bots.find(b => b.bid === bobBid).owner === B.name, 'Ann sees Bob\'s bot after her own, with Bob as owner');
  await until(() => A.roster.some(x => x.bot && x.owner === B.name), 5000, 'Bob\'s bot joined');
  B.ws.close();
  await sleep(700);
  const B2 = client(B.name, 'guardian'); clients.push(B2);
  await until(() => B2.id, 4000, 'Bob reconnects');
  await sleep(2500); // past the grace period
  L = await B2.list();
  ok(L.mine === 1 && L.bots.some(b => b.bid === bobBid && b.mine), 'Bob reconnected within the grace period: his bot is still his');
  await until(() => { const id = B2.roster.find(x => x.bot && x.owner === B.name)?.id; return id && B2.pl.get(id)?.party && B2.pl.get(id).party === B2.me()?.party; }, 5000, 'Bob\'s bot back in his party');
  ok(true, 'and it rejoined his party');

  // ---------- admin (needs accounts) ----------
  if (DB) {
    const call = async (method, p, token, body) => { const res = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return res.json().catch(() => ({})); };
    const pg = (await import('pg')).default;
    const local = /@(localhost|127\.0\.0\.1)|host=\//.test(DB);
    const pool = new pg.Pool({ connectionString: DB, ssl: local ? false : { rejectUnauthorized: false } });
    const tok = (await call('POST', '/api/guest')).token;
    const ch = (await call('POST', '/api/characters', tok, { name: `Adm${tag}`, cls: 'cleric' })).character;
    const acct = await call('GET', '/api/me', tok);
    await pool.query('UPDATE accounts SET is_admin = true WHERE id = $1', [acct.account?.id ?? acct.id]);
    await pool.end();
    const M = client(`Adm${tag}`, 'cleric', { session: tok, character: ch.id }); clients.push(M);
    await until(() => M.id, 5000, 'admin joined');
    L = await M.list();
    ok(L.admin && L.bots.filter(b => !b.mine).every(b => b.can), 'admin can manage every bot');
    r = await M.pbot({ op: 'edit', bid: bobBid, skill: 5 });
    ok(r.ok && r.list.bots.find(b => b.bid === bobBid).skill === 5, 'admin edits Bob\'s bot');
    r = await M.pbot({ op: 'dismiss', bid: bobBid });
    ok(r.ok, 'admin dismisses Bob\'s bot');
    await until(() => B2.sys.some(t => /admin dismissed/.test(t)), 3000, 'Bob told');
    ok(true, 'Bob is told an admin dismissed it');
  } else console.log('  (admin checks skipped: set DATABASE_URL)');

  // ---------- owner leaves: bots go after the grace period ----------
  const annBots = botIds();
  ok(annBots.length === 2, 'Ann has 2 bots before leaving');
  A.ws.close();
  await sleep(800);
  ok(annBots.every(id => B2.roster.some(x => x.id === id)), 'right after Ann leaves her bots wait (grace period)');
  await until(() => annBots.every(id => !B2.roster.some(x => x.id === id)), 6000, 'Ann\'s bots removed');
  ok(true, 'after the grace period Ann\'s bots are removed');

  // ---------- every other class (classes added later) ----------
  const rest = setups().filter(s => !picks.some(x => x.cls === s.cls));
  if (rest.length) {
    const G = client(`Gus${tag}`); clients.push(G);
    await until(() => G.id, 4000, 'Gus joined');
    for (let i = 0; i < rest.length; i += 3) {
      const chunk = rest.slice(i, i + 3), bids = [];
      for (const s of chunk) { const r = await G.pbot({ op: 'add', cls: s.cls }); ok(r.ok, `add ${s.label}: ${r.msg || r.error}`); bids.push(r.bid); }
      let got = [];
      for (let k = 0; k < 40 && !(got.length === bids.length && got.every(b => b.kit?.gear.length === 3)); k++) got = (await G.list()).bots.filter(b => bids.includes(b.bid));
      ok(got.length === chunk.length && got.every(b => b.lvl === 8 && b.kit.gear.every(g => g.r === 1) && b.kit.mastery.every(m => m.lvl === 2)), `${chunk.map(s => s.label).join(', ')}: Lv 8, Uncommon gear, Mastery 2`);
      for (const bid of bids) await G.pbot({ op: 'dismiss', bid });
      await sleep(5200); // (rate limit window)
    }
  }

  // ---------- rate limit ----------
  const C = client(`Fi${tag}`); clients.push(C);
  await until(() => C.id, 4000, 'Fi joined');
  const k = C.replies.length;
  for (let i = 0; i < 12; i++) C.send({ type: 'pbot', op: 'edit', bid: 99999 });
  await until(() => C.replies.length - k >= 12, 3000, 'replies');
  ok(C.replies.slice(k).some(r => /Slow down/.test(r.error)), 'rate limit: "Slow down a little."');
} catch (e) {
  failed++; console.log('  NOT OK -', e.message);
} finally {
  for (const c of clients) c.ws.close();
  srv.kill();
  if (/\[uncaught|pbot Error|TypeError/.test(log)) { failed++; console.log('server log:\n' + log); }
  console.log(failed ? `\n${failed} FAILED of ${n}` : `\nall ${n} passed`);
  process.exit(failed ? 1 : 0);
}
