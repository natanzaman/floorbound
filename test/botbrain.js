// One brain per bot, party teamwork and party commands, end to end.
// A human client gets a team of 3 server-run bots (admin API, follow) into its party, then checks: greetings, the bots
// follow it, assist on its target (the tank taunts what's on it), the healer heals it, /b chat + command-wheel orders
// (stay / follow / attack my target / status / heal me; plain chat never orders), an outsider can't order them, editing
// one bot leaves the others alone, and admin Respawn as… keeps a bot in the party with its order. Also unit-checks
// the /b parser.
// Starts its own server on PORT (default 3632) against DATABASE_URL (required for the admin API; skipped without).
// Usage: DATABASE_URL=postgresql://... node test/botbrain.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import pg from 'pg';
import { MOB_IDS, MOBS, CLASS_IDS } from '../shared/data.js';
import { parseBotChat, botHelp, BOT_COMMANDS } from '../shared/bots/social.js';
import { moveToward } from '../shared/bots/motor.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }

// ---------- the /b parser: only /b lines are orders ----------
const P = parseBotChat;
ok(['all stay', 'Brann follow me', 'Lyra heal me', 'hold here', "let's do the boss", 'use potion', 'leave party', 'stop', 'gg', 'follow'].every(t => P(t) === null), 'plain chat is never an order ("all stay", "Lyra heal me", "follow", ...)');
ok(P('/p stay') === null && P('/bob hi') === null && P('/boss') === null, 'other slash commands and words starting with /b are not orders');
ok(P('/b stay')?.cmd === 'stay' && P('/b stay').name === '' && P('/bots follow')?.cmd === 'follow' && P('/bot regroup')?.cmd === 'come', '/b stay, /bots follow, /bot regroup: every bot');
ok(P('/b Lyra: heal me')?.cmd === 'heal' && P('/b Lyra: heal me').name === 'Lyra', '/b Lyra: heal me (one bot)');
ok(P('/b Brann 2 hold')?.cmd === 'stay' && P('/b Brann 2 hold').name === 'Brann 2' && P('/B KAEL STATUS')?.name === 'KAEL', '/b <name> <order> without a colon, any case');
ok(P('/b all: attack')?.cmd === 'attack' && P('/b all: attack').name === '' && P('/b pot')?.cmd === 'potion' && P('/b warden')?.cmd === 'boss' && P('/b farm')?.cmd === 'farm' && P('/b ready')?.cmd === 'ready' && P('/b leave')?.cmd === 'leave', 'aliases: all, pot, warden, farm, ready, leave');
ok(P('/b')?.help && P('/b help')?.help && P('/b ?')?.help, '/b and /b help: the listing');
ok(/isn't a bot order/.test(P('/b dance')?.error || ''), '/b dance: an error, not chat');
ok(Object.keys(BOT_COMMANDS).every(id => P(`/b ${id}`)?.cmd === id) && botHelp().length === Object.keys(BOT_COMMANDS).length + 1, 'every order has its own word and a help line');

const DB = process.env.DATABASE_URL;
if (!DB) { console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} parser checks passed (set DATABASE_URL for the live tests)`); process.exit(failed ? 1 : 0); }

const PORT = Number(process.env.PORT) || 3632;
const BASE = `http://localhost:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const local = /@(localhost|127\.0\.0\.1)|host=\//.test(DB);
const pool = new pg.Pool({ connectionString: DB, ssl: local ? false : { rejectUnauthorized: false } });
async function call(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

// A scripted human: walks, locks targets, swings, chats; keeps the latest snapshot and every event.
function human(name, cls = 'swordsman') {
  const h = { name, x: 0, z: 0, seq: 0, face: 0, t: 0, pl: new Map(), mobs: [], events: [], roster: [], gateOpen: false };
  h.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  h.send = o => h.ws.readyState === 1 && h.ws.send(JSON.stringify(o));
  h.ws.on('open', () => h.send({ type: 'join', name, cls }));
  h.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'welcome') Object.assign(h, { id: m.id, x: m.x, z: m.z, seq: m.seq });
    if (m.type === 'roster') h.roster = m.players;
    if (m.type !== 'snap') return;
    h.t += 0.05;
    h.pl = new Map(m.w.players.map(p => [p[0], { id: p[0], x: p[1], z: p[2], hp: p[4], maxHp: p[5], cls: CLASS_IDS[p[7]], party: p[8], dead: !!p[9] }]));
    h.mobs = m.w.mobs.map(x => ({ id: x[0], type: MOB_IDS[x[1]], x: x[2], z: x[3], hp: x[5], engaged: !!(x[7] & 2), def: MOBS[MOB_IDS[x[1]]] }));
    h.gateOpen = !!m.w.gate?.[0];
    for (const e of m.w.events) { h.events.push({ ...e, at: Date.now() }); if (e.t === 'tp' && e.id === h.id) { h.x = e.x; h.z = e.z; h.seq = e.s; } }
    if (h.walk) { if (!moveToward(h, h.walk[0], h.walk[1], 0.5)) h.walk = null; }
    h.send({ type: 'input', x: +h.x.toFixed(2), z: +h.z.toFixed(2), face: h.face, seq: h.seq });
  });
  h.me = () => h.pl.get(h.id);
  h.party = () => h.me()?.party || 0;
  h.say = (text, ch = 'p') => h.send({ type: 'chat', text, ch });
  h.walkTo = async (x, z, ms = 15000) => { h.walk = [x, z]; await until(() => !h.walk, ms, 'walk').catch(() => { h.walk = null; }); }; // (gives up when stuck)
  h.since = t0 => h.events.filter(e => e.at >= t0);
  return h;
}

const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), MAX_BOTS: '10', START_LEVEL: '6', TEST_HOOKS: '1', NAMED_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });

try {
  await until(() => /running on/.test(log), 15000, 'server start');
  const tag = Math.random().toString(36).slice(2, 6);
  const adminTok = (await call('POST', '/api/guest')).body.token;
  const me = await call('GET', '/api/admin/me', adminTok);
  await pool.query('UPDATE accounts SET is_admin = true WHERE id = $1', [me.body.account.id]);
  const H = human(`Hum${tag}`), O = human(`Out${tag}`, 'guardian');
  await until(() => H.id && O.id && H.me() && O.me(), 5000, 'humans in');

  // ---------- a team of 3 joins the human's party ----------
  let r = await call('POST', '/api/admin/bots/team', adminTok, { lvl: 6, behaviour: 'follow', follow: H.name, skill: 5 });
  ok(r.status === 200 && r.body.added.length === 3, 'Add team: three bots');
  const bots = async () => (await call('GET', '/api/admin/bots', adminTok)).body.bots;
  let list = [];
  for (let i = 0; i < 100; i++) { // (the admin list is async: poll it)
    list = await bots();
    if (H.party() && list.length === 3 && list.every(b => b.id && H.pl.get(b.id)?.party === H.party())) break;
    await sleep(100);
  }
  const byCls = c => list.find(b => b.cls === c);
  const tank = byCls('guardian'), dps = byCls('swordsman'), heal = byCls('cleric');
  ok(list.every(b => H.pl.get(b.id)?.party === H.party()), `all three are in ${H.name}'s party`);
  const pchat = (t0, who) => H.since(t0).filter(e => e.t === 'chat' && e.ch === 'p' && e.id !== H.id && (!who || e.id === who.id));
  const T0 = Date.now() - 10000;
  await until(() => pchat(T0).length >= 3, 6000, 'greetings');
  ok(pchat(T0).every(e => e.party === H.party()) && pchat(T0).some(e => /here|joining|reporting/i.test(e.text)), `bots greet in party chat: "${pchat(T0)[0]?.text}"`);
  ok(!H.since(T0).some(e => e.t === 'chat' && !e.ch && list.some(b => b.id === e.id)), 'no bot chatter in global chat');

  // ---------- they follow the human ----------
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  await H.walkTo(0, 26);
  await until(() => list.every(b => H.pl.get(b.id) && dist(H.pl.get(b.id), H) < 8), 8000, 'bots caught up');
  ok(true, 'the bots follow the human up the road (all within 8 m)');
  r = await call('GET', '/api/admin/bots', adminTok);
  ok(r.body.bots.every(b => /Following Hum|with Hum/.test(b.goal)), `admin cards show each bot's goal ("${r.body.bots[0].goal}")`);

  // ---------- assist: the human locks and hits a mob; the tank taunts it, the others join in ----------
  const pickMob = (types, maxD = 70) => H.mobs.filter(m => types.includes(m.type) && !m.engaged && m.z < 140).sort((a, c) => dist(a, H) - dist(c, H)).find(m => dist(m, H) < maxD);
  let mob = null;
  for (let tries = 0; tries < 4 && !mob; tries++) { // walk up to a mob that isn't fighting anyone
    const m = await until(() => pickMob(['boar', 'wolf']), 6000, 'a mob nearby');
    await H.walkTo(m.x + (H.x - m.x) / dist(m, H) * 2.2, m.z + (H.z - m.z) / dist(m, H) * 2.2);
    const now = H.mobs.find(x => x.id === m.id);
    if (now && dist(now, H) < 4.5) mob = now;
  }
  if (!mob) throw new Error('could not reach a mob');
  let t0 = Date.now();
  H.send({ type: 'target', id: mob.id });
  H.face = Math.atan2(mob.x - H.x, mob.z - H.z);
  H.send({ type: 'skill', slot: 0, face: H.face });
  const hitters = () => new Set(H.since(t0).filter(e => e.t === 'hit' && e.id === mob.id && e.by !== H.id).map(e => e.by));
  await until(() => hitters().size >= 2 || H.since(t0).some(e => e.t === 'die' && e.id === mob.id) && hitters().size >= 1, 9000, 'bots assisting');
  ok(hitters().size >= 1, `bots assist on the human's target (${hitters().size} bot(s) hit the ${mob.type})`);
  ok(H.since(t0).some(e => e.t === 'ptgt' && e.id === H.id && e.m === mob.id), 'the server shares the locked target with the party (ptgt)');
  ok(H.since(t0).some(e => e.t === 'fx' && e.s === 'taunt' && e.id === tank.id), 'the tank taunts the mob attacking the human');
  await until(() => !H.mobs.some(m => m.id === mob.id), 12000, 'mob down').catch(() => {});

  // ---------- the healer heals the human ----------
  t0 = Date.now();
  H.send({ type: 'test', hurt: 0.4 });
  await until(() => H.since(t0).some(e => e.t === 'fx' && e.k === 'heal' && e.by === heal.id && e.id === H.id), 6000, 'heal');
  ok(true, 'the healer heals the human when hurt');

  // ---------- orders by chat: plain chat does nothing, /b does ----------
  t0 = Date.now();
  H.say('all stay'); H.say('hold here', undefined);
  await H.walkTo(H.x + 5, H.z - 4);
  await sleep(1200);
  ok(list.every(b => dist(H.pl.get(b.id), H) < 8) && !pchat(t0).some(e => /hold|stay/i.test(e.text)), 'plain "all stay" / "hold here": no order (they keep following)');
  ok(!H.since(t0).some(e => e.t === 'botcmd'), '...and no order event');
  t0 = Date.now();
  H.say('/b help');
  await until(() => H.since(t0).some(e => e.t === 'sys' && e.to === H.id && /\/b follow/.test(e.text)), 3000, '/b help');
  ok(!H.since(t0).some(e => e.t === 'chat' && /\/b/.test(e.text)), '/b help lists the orders (to me only, never as chat)');
  t0 = Date.now();
  H.say('/b stay');
  await sleep(600);
  const spots = new Map(list.map(b => [b.id, { ...H.pl.get(b.id) }]));
  await H.walkTo(H.x, H.z - 18);
  await sleep(1500);
  ok(list.every(b => dist(H.pl.get(b.id), spots.get(b.id)) < 4.5 && dist(H.pl.get(b.id), H) > 12), '"/b stay": they hold while the human walks off');
  ok(pchat(t0).some(e => /hold|stay/i.test(e.text)), `...and one of them acknowledges ("${pchat(t0)[0]?.text}")`);
  r = await call('GET', '/api/admin/bots', adminTok);
  ok(r.body.bots.every(b => b.order?.cmd === 'stay' && /Holding/.test(b.goal)), 'the admin view shows the order and goal');

  t0 = Date.now();
  O.say(`/b ${tank.name}: follow`, undefined); // an outsider (global chat) ...
  O.send({ type: 'botcmd', cmd: 'follow' }); // ... and from the wheel (not in a party: refused by the server)
  await O.walkTo(O.x + 6, O.z + 4).catch(() => {});
  await sleep(1500);
  ok(list.every(b => dist(H.pl.get(b.id), spots.get(b.id)) < 4.5), "an outsider can't order the party's bots");
  ok(!H.since(t0).some(e => e.t === 'botcmd' && e.by === O.id), 'the server drops wheel orders from players without a party');

  t0 = Date.now();
  H.say('/b follow');
  await until(() => list.every(b => dist(H.pl.get(b.id), H) < 8), 9000, 'follow again');
  ok(true, '"/b follow": they come back and follow');

  t0 = Date.now();
  H.say(`/b ${heal.name.slice(0, 3)}: status`); // a unique start of the name is enough
  await until(() => pchat(t0, heal).some(e => /HP \d+\/\d+ · Lv \d+/.test(e.text)), 4000, 'status');
  ok(true, `"/b ${heal.name.slice(0, 3)}: status": only ${heal.name} answers: "${pchat(t0, heal)[0].text}"`);
  await sleep(500);
  ok(!pchat(t0).some(e => e.id === tank.id || e.id === dps.id), '...the others stay quiet (the order named one bot)');

  t0 = Date.now();
  H.say(`/b ${heal.name} heal me`);
  await until(() => pchat(t0, heal).length, 3000, 'heal ack');
  r = await call('GET', '/api/admin/bots', adminTok);
  ok(r.body.bots.find(b => b.bid === heal.bid) && pchat(t0, heal).length, `"/b ${heal.name} heal me": the healer answers ("${pchat(t0, heal)[0].text}")`);
  H.send({ type: 'test', hurt: 0.85 });
  await until(() => H.since(t0).some(e => e.t === 'fx' && e.k === 'heal' && e.by === heal.id && e.id === H.id), 6000, 'priority heal');
  ok(true, '...and keeps the human topped up (heals at 85%, the normal threshold is 78%)');

  // attack my target: lock a mob that isn't fighting anyone, order the attack (wheel)
  mob = await until(() => pickMob(['boar', 'wolf'], 30), 8000, 'a free mob within 30 m').catch(() => null);
  if (mob) {
    t0 = Date.now();
    H.send({ type: 'target', id: mob.id });
    await sleep(200);
    H.send({ type: 'botcmd', cmd: 'attack' });
    await until(() => H.since(t0).some(e => e.t === 'hit' && e.id === mob.id && list.some(b => b.id === e.by)), 12000, 'attack order');
    ok(!H.since(t0).some(e => e.t === 'hit' && e.id === mob.id && e.by === H.id), `"attack my target" (wheel): the bots attack the human's locked ${mob.type} without the human`);
  } else ok(false, 'no free mob for the attack order');

  // ---------- one brain per bot: editing one bot leaves the others alone ----------
  const before = await bots();
  r = await call('PATCH', `/api/admin/bots/${dps.bid}`, adminTok, { skill: 2, behaviour: 'field' });
  const after = await bots();
  const same = b => { const x = after.find(a => a.bid === b.bid); return x.skill === b.skill && x.behaviour === b.behaviour && x.follow === b.follow; };
  ok(r.status === 200 && r.body.bot.skill === 2 && r.body.bot.behaviour === 'field', 'PATCH one bot: capability 2, behaviour field');
  ok(before.filter(b => b.bid !== dps.bid).every(same), 'the other two keep their own capability and behaviour');

  // ---------- admin Respawn as…: the tank comes back as another class, in the same party, with its order ----------
  t0 = Date.now();
  H.say(`/b ${tank.name}: stay`);
  await until(() => pchat(t0, tank).length, 3000, 'tank holds');
  r = await call('POST', `/api/admin/bots/${tank.bid}/respawn`, adminTok, { cls: 'berserker' });
  ok(r.status === 200 && r.body.bot.bid === tank.bid && r.body.bot.cls === 'berserker', 'respawn the tank as a Berserker: same bot id');
  let nb = null;
  for (let i = 0; i < 80 && !(nb && H.pl.get(nb.id)?.party === H.party()); i++) { await sleep(100); nb = (await bots()).find(b => b.bid === tank.bid && b.id && b.id !== tank.id); }
  ok(nb && H.pl.get(nb.id)?.party === H.party(), `...back in ${H.name}'s party`);
  await sleep(1200);
  ok((await bots()).find(b => b.bid === tank.bid)?.order?.cmd === 'stay', '...still on its "stay" order');

  // ---------- admin orders ----------
  t0 = Date.now();
  r = await call('POST', `/api/admin/bots/${tank.bid}/command`, adminTok, { cmd: 'status' });
  await until(() => pchat(t0).some(e => e.id === nb?.id && /HP \d+/.test(e.text)), 4000, 'admin status');
  ok(r.status === 200, 'admin order through the API (status answered in party chat)');
  ok((await call('POST', `/api/admin/bots/${tank.bid}/command`, adminTok, { cmd: 'dance' })).status === 400, 'unknown order: 400');
  await call('DELETE', '/api/admin/bots', adminTok);
  H.ws.close(); O.ws.close();
} catch (e) {
  failed++;
  console.log('  NOT OK - ' + e.message);
  console.log(log.split('\n').slice(-15).join('\n'));
} finally {
  srv.kill();
  await pool.end();
}
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} bot brain checks passed`);
process.exit(failed ? 1 : 0);
