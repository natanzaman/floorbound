// In-process sockets for the server's own bots (server/localws.js).
//   unit     the hub: open, messages both ways in order, JSON semantics for everything but the 20 Hz input, close
//   server   a real server (server/index.js imported here with TEST_HOOKS=1, PORT default 6070, no database, no Named):
//            one bot on the in-process channel and one of the same class on a real WebSocket (same bot key) get the
//            same messages: the same kinds, the very same world part in every snapshot, the same `me` fields; the
//            in-process one moves (its input is handled) and what it gets is frozen (BOT_FREEZE=1: a bot that wrote
//            into a shared snapshot would throw)
// Usage: node test/localws.js   (PORT=60xx)
import { makeLocalHub } from '../server/localws.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });

console.log('# the hub');
{
  const got = [], server = [];
  let srv = null;
  const hub = makeLocalHub(ws => { srv = ws; ws.on('message', m => server.push(m)); ws.on('close', () => server.push('closed')); }, { freeze: true });
  const c = new hub.WebSocket('ws://x/ws');
  const events = [];
  c.addEventListener('open', () => events.push('open'));
  c.addEventListener('message', ev => got.push(ev.obj));
  c.addEventListener('close', () => events.push('close'));
  ok(c.readyState === 0 && !srv, 'connecting until the next microtask');
  await sleep(0);
  ok(c.readyState === 1 && srv?.local && events.join() === 'open', 'open: the server side is local');
  c.sendObj({ type: 'input', x: NaN, z: 1, seq: 0 });
  c.sendObj({ type: 'skill', slot: 1, face: NaN, extra: undefined });
  c.send(JSON.stringify({ type: 'chat', text: 'hi' }));
  await sleep(0);
  ok(server.length === 3 && server[0].type === 'input' && Number.isNaN(server[0].x), 'input goes over as is (the game checks every field)');
  ok(server[1].face === null && !('extra' in server[1]), 'anything else as on the wire: NaN → null, undefined dropped');
  ok(server[2].text === 'hi', 'send(string) works too, in order');
  const snap = { type: 'snap', me: { a: 1 }, w: { players: [[1, 2]] } };
  srv.deliver(snap); srv.send(JSON.stringify({ type: 'roster', players: [] }));
  await sleep(0);
  ok(got.length === 2 && got[0] === snap && got[1].type === 'roster', 'deliver(obj) hands the object over; send(str) is parsed once; in order');
  ok(Object.isFrozen(got[0].w.players[0]), 'freeze: delivered objects are deep-frozen');
  let threw = false;
  try { got[0].w.players[0][0] = 9; } catch { threw = true; }
  ok(threw, 'writing into a frozen snapshot throws (ES modules are strict)');
  c.close();
  await sleep(0);
  ok(c.readyState === 3 && srv.readyState === 3 && events.join() === 'open,close' && server.at(-1) === 'closed', 'close: both sides closed, both told');
  srv.deliver(snap); c.sendObj({ type: 'input' });
  await sleep(0);
  ok(got.length === 2 && server.length === 4, 'nothing goes through after close');
  // the server closes
  let srv2 = null; const ev2 = [];
  const hub2 = makeLocalHub(ws => { srv2 = ws; ws.on('close', () => ev2.push('srv')); });
  const c2 = new hub2.WebSocket('x'); c2.addEventListener('close', () => ev2.push('cli'));
  await sleep(0);
  srv2.close();
  await sleep(0);
  ok(c2.readyState === 3 && ev2.sort().join() === 'cli,srv' && hub2.stats.open === 0, 'the server side closing closes the bot too');
}

console.log('# server: in-process vs WebSocket');
{
  const PORT = Number(process.env.PORT) || 6070;
  Object.assign(process.env, { PORT: String(PORT), TEST_HOOKS: '1', NAMED_ENABLED: '0', DATABASE_URL: '', BOT_FREEZE: '1', BOT_TRANSPORT: '', BOT_THINK: '20' });
  await import('../server/index.js');
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${PORT}/status`); break; } catch { await sleep(100); } }
  const { game, bots, localHub } = globalThis.floorbound;
  const { BotManager } = await import('../server/botmanager.js');
  ok(!!localHub && bots.local === localHub, 'the server runs its bots on the in-process hub by default');
  const wsMgr = new BotManager(game, { url: `ws://127.0.0.1:${PORT}/ws` });
  wsMgr.key = bots.key; // (the same secret: it joins as a server bot, over a real socket)
  const rec = e => { const out = []; e.b.ws.addEventListener('message', ev => out.push(ev.obj || JSON.parse(ev.data))); return out; };
  const lv = bots.add({ cls: 'swordsman', name: 'Loco', behaviour: 'field', lvl: 6 });
  const le = bots.bots.find(x => x.bid === lv.bid), lmsgs = rec(le);
  const wv = wsMgr.add({ cls: 'swordsman', name: 'Wire', behaviour: 'field', lvl: 6 });
  const we = wsMgr.bots.find(x => x.bid === wv.bid), wmsgs = rec(we);
  ok(le.b.ws.constructor.local && !we.b.ws.constructor.local, 'one bot on the in-process channel, one on a WebSocket');
  await sleep(4000);
  const lp = game.players.get(le.b.id), wp = game.players.get(we.b.id);
  ok(lp?.bot && wp?.bot && lp.ws.local && !wp.ws.local, 'both joined as server bots');
  const types = ms => [...new Set(ms.filter(m => m.type !== 'snap').map(m => m.type))].sort().join();
  ok(types(lmsgs) === types(wmsgs) && /welcome/.test(types(lmsgs)) && /roster/.test(types(lmsgs)), `the same kinds of message (${types(lmsgs)})`);
  const lw = lmsgs.filter(m => m.type === 'snap').map(m => JSON.stringify(m.w)), ww = wmsgs.filter(m => m.type === 'snap').map(m => JSON.stringify(m.w));
  const at = lw.indexOf(ww[5]);
  const run = Math.min(lw.length - at, ww.length - 5);
  let same = at >= 0 && run > 40;
  for (let k = 0; same && k < run; k++) same = lw[at + k] === ww[5 + k];
  ok(same, `the very same world part, snapshot by snapshot (${run} in a row)`);
  const lme = lmsgs.filter(m => m.type === 'snap').at(-1).me, wme = wmsgs.filter(m => m.type === 'snap').at(-1).me;
  ok(Object.keys(lme).sort().join() === Object.keys(wme).sort().join() && lme.lvl === wme.lvl && lme.cds.length === wme.cds.length, 'the same `me` fields');
  const welcome = m => { const { id, x, z, ...rest } = m.find(o => o.type === 'welcome'); return JSON.stringify(rest); };
  ok(welcome(lmsgs) === welcome(wmsgs), 'the same welcome (but for id and spawn spot)');
  ok(Object.isFrozen(lmsgs.at(-1).w ?? lmsgs.at(-1)) && le.b.mobs && !le.b.closed, 'what the in-process bot gets is frozen, and its brain runs on it without writing into it');
  // the think rate: far from any human and out of a boss fight, every other snapshot, with both ticks' events
  process.env.BOT_THINK = '';
  const l0 = lmsgs.length, w0 = wmsgs.length;
  await sleep(2000);
  const ls = lmsgs.slice(l0).filter(m => m.type === 'snap'), wsn = wmsgs.slice(w0).filter(m => m.type === 'snap');
  ok(ls.length > 10 && Math.abs(ls.length * 2 - wsn.length) <= 4 && ls.slice(1).every(m => m.dt === 0.1), `10 Hz far from humans: ${ls.length} snapshots to the WebSocket bot's ${wsn.length}, each with dt 0.1`);
  const strip = w => JSON.stringify({ ...w, events: [] });
  const k = wsn.findIndex(m => strip(m.w) === strip(ls[3].w));
  ok(k > 0 && JSON.stringify(ls[3].w.events) === JSON.stringify([...wsn[k - 1].w.events, ...wsn[k].w.events]), 'a skipped tick\'s events come with the next snapshot, in order');
  // a human comes within 60 m: back to every snapshot
  const { default: WebSocket } = await import('ws');
  const hws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  hws.on('open', () => hws.send(JSON.stringify({ type: 'join', name: 'Hugh', cls: 'cleric' })));
  await sleep(500);
  const hu = [...game.players.values()].find(p => !p.bot);
  game.teleport(hu, lp.x + 5, lp.z);
  await sleep(300);
  const l1 = lmsgs.length;
  await sleep(1000);
  const near = lmsgs.slice(l1).filter(m => m.type === 'snap');
  ok(near.length >= 17 && near.every(m => !m.dt), `20 Hz with a human ${Math.round(Math.hypot(hu.x - lp.x, hu.z - lp.z))} m away (${near.length} snapshots a second)`);
  hws.close();
  process.env.BOT_THINK = '20';
  const spawnAt = [lp.x, lp.z];
  await sleep(2500);
  ok(Math.hypot(lp.x - spawnAt[0], lp.z - spawnAt[1]) > 1 || lp.z > 20, 'its input is handled: it walks out to the field');
  const before = (await (await fetch(`http://127.0.0.1:${PORT}/status`)).json());
  ok(before.online?.admin === 1 && typeof before.cpu?.pct === 'number' && typeof before.bytes?.perSec === 'number', '/status: CPU, bytes and who is online by kind');
  bots.remove(lv.bid);
  await sleep(200);
  ok(!game.players.has(lp.id) && le.b.closed, 'removing it closes its channel and takes it out of the game');
  wsMgr.removeAll();
}

console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} passed`);
process.exit(failed ? 1 : 0);
