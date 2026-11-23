// Residents (shared/residents.js, server/residents.js, docs/briefs/bot-days.md "Residents"): the server's own six bots.
//   in process  the count rule (on Render by default, RESIDENTS anywhere), levels spread below the top player, each
//               one's personality from its own name; none join an empty world; with a player online one joins every
//               tick (no burst), as nobody's bot living its own day, in premade gear, by the waypoint of the floor
//               the players are on; a name a player took: joins as "Pip 2" with Pip's personality; the bot limit
//               holds them back; a closed socket rejoins; an admin removal keeps one out RESIDENT_AWAY, "remove all"
//               too; nobody online for RESIDENT_GRACE: they all leave (a quick reconnect keeps them), and come back
//               at once with the next player
//   server      a real server with RESIDENTS=2: they join a player, show in the bot list as residents anyone may
//               invite, and a player invites one into their party
// Usage: node test/residents.js   (PORT=37xx; NO_LIVE=1 skips the server part)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js';
import { Residents } from '../server/residents.js';
import { RESIDENTS, RESIDENT_GRACE, RESIDENT_AWAY, residentCount, residentLevel } from '../shared/residents.js';
import { rollPersonality } from '../shared/bots/personality.js';
import { canControlBot } from '../shared/accesslevels.js';
import { floorOf, WAYPOINTS } from '../shared/floor2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------------- the rules ----------------
ok(residentCount({}) === 0 && residentCount({ RENDER: 'true' }) === 6, 'off by default, all six on Render');
ok(residentCount({ RESIDENTS: '3' }) === 3 && residentCount({ RENDER: 'true', RESIDENTS: '0' }) === 0 && residentCount({ RESIDENTS: '99' }) === 6 && residentCount({ RENDER: '1', RESIDENTS: 'x' }) === 6, 'RESIDENTS=<n> anywhere (0 = none, at most six, junk = the default)');
const lv = RESIDENTS.map(r => residentLevel(20, r.share));
ok(lv[0] === 20 && lv.every((l, i) => !i || l <= lv[i - 1]) && lv.at(-1) < 20 && residentLevel(1, 0.55) === 1, `levels spread below the top player (${lv.join(', ')} at 20; at least 1)`);
const want = { Marlo: 'steady', Gideon: 'chatterbox', Talia: 'explorer', Pip: 'hothead', Rosalind: 'joker', Brenna: 'quiet' };
ok(RESIDENTS.every(r => rollPersonality(r.name).id === want[r.name]), `each one's personality, rolled from the name (${RESIDENTS.map(r => `${r.name} ${rollPersonality(r.name).id}`).join(', ')})`);
ok(new Set(RESIDENTS.map(r => r.cls)).size === 6, 'six different classes');

// ---------------- in process ----------------
{
  const g = new Game();
  g.track = () => {};
  const mgr = new BotManager(g, { url: 'ws://127.0.0.1:9/ws', max: 30 });
  clearInterval(mgr.timer);
  const starts = [];
  mgr.start = function (roles, names, opts) { // a bot with no socket (as test/freebots.js)
    starts.push(opts);
    this.joining = true;
    let p;
    try { p = g.addPlayer({ readyState: 1, send() {} }, names[0], roles[0]); } finally { this.joining = false; }
    p.bot = true; p.lvl = opts.lvl || 1; g.recompute(p); p.hp = p.maxHp;
    const e = { bid: this.nextBid++, behaviour: opts.behaviour, follow: '', lvl: opts.lvl, at: Date.now(), creator: { name: 'x' }, allow: ['1'], b: { id: p.id, name: p.name, cls: p.cls, closed: false, skill: opts.skill } };
    e.group = { drop: b => { b.closed = true; g.removePlayer(p); } };
    this.bots.push(e);
    return [{ bid: e.bid }];
  };
  const clock = { t: 1e9 };
  const R = new Residents(g, mgr, { interval: 0, now: () => clock.t, n: 6 });
  const tick = (k = 1, s = 2) => { for (let i = 0; i < k; i++) { clock.t += s * 1000; R.tick(); } };
  const ins = () => R.list.filter(st => st.e);
  const human = (name, lvl, x, z) => { const p = g.addPlayer({ readyState: 1, send() {} }, name, 'swordsman'); p.lvl = lvl; g.recompute(p); if (x !== undefined) g.teleport(p, x, z); return p; };

  ok(g.residents === R && R.list.length === 6, 'the server keeps six (game.residents)');
  tick(5);
  ok(ins().length === 0 && mgr.bots.length === 0, 'nobody online: none join');

  const pipP = human('Pip', 20);
  tick(1);
  ok(ins().length === 1, 'a player comes online: one joins (one a tick, no burst)');
  tick(6);
  ok(ins().length === 6 && mgr.count() === 6, 'six ticks later all six are in');
  const es = ins().map(st => st.e);
  ok(es.every(e => e.resident && e.creator === null && e.allow.length === 0), 'each is nobody\'s bot (no creator, empty allow list), marked resident');
  ok(starts.every(o => o.behaviour === 'own' && o.join?.f2 && o.join?.f3), 'each lives its own day (behaviour own), free to travel the floors');
  ok(starts.every((o, i) => o.lvl === residentLevel(20, RESIDENTS[i].share) && o.skill === RESIDENTS[i].skill), `levels and skill from the table (${starts.map(o => `${o.lvl}/${o.skill}`).join(' ')})`);
  const pip = es.find(e => e.resident === 'Pip');
  ok(pip.b.name === 'Pip 2' && pip.b.persona?.id === 'hothead' && pip.b.persona.slot === rollPersonality('Pip').slot, 'a player called Pip: the resident joins as "Pip 2", with Pip\'s own personality');
  const ps = es.map(e => mgr.livePlayer(e));
  ok(ps.every(p => p.inv.eq.weapon && p.inv.eq.armor && p.inv.eq.charm), 'each wears the premade gear for its level');
  const w = WAYPOINTS.find(x => x.floor === floorOf(pipP.x)) || WAYPOINTS[0];
  ok(ps.every(p => Math.hypot(p.x - w.x, p.z - w.z) < 12), `each stands by the waypoint of the players' floor (${ps.map(p => Math.round(Math.hypot(p.x - w.x, p.z - w.z))).join(', ')} m)`);
  const stranger = { id: 99, name: 'Zed', access: 1, charId: 77 };
  ok(es.every(e => canControlBot(stranger, e, 'botInvite').ok), 'anyone may invite one');

  // an admin removes one: out for RESIDENT_AWAY, then back
  mgr.remove(pip.bid);
  ok(!R.list.find(st => st.def.name === 'Pip').e && R.status().find(s => s.name === 'Pip').away === RESIDENT_AWAY, `an admin removes Pip: out, away ${RESIDENT_AWAY} s`);
  tick(10);
  ok(!R.list.find(st => st.def.name === 'Pip').e, 'Pip stays out meanwhile');
  tick(1, RESIDENT_AWAY);
  ok(R.list.find(st => st.def.name === 'Pip').e, 'and comes back once the time is up');

  // "remove all" too
  mgr.removeAll();
  ok(ins().length === 0 && R.status().every(s => !s.in && s.away > 0), '"remove all": every one out for a while');
  tick(1, RESIDENT_AWAY + 1);
  tick(6);
  ok(ins().length === 6, 'and all back after it');

  // a closed socket rejoins
  const gid = R.list.find(st => st.def.name === 'Gideon').e;
  gid.b.closed = true;
  tick(2);
  const g2 = R.list.find(st => st.def.name === 'Gideon').e;
  ok(g2 && g2 !== gid && !g2.b.closed, 'a resident whose socket closed rejoins');

  // the bot limit holds them back
  mgr.removeAll(); tick(1, RESIDENT_AWAY + 1);
  mgr.max = 2;
  tick(6);
  ok(ins().length === 2, 'the bot limit reached: the rest wait for a free slot');
  mgr.max = 30; tick(6);
  ok(ins().length === 6, 'and join when there is room');

  // nobody online: they leave after the grace, and come straight back with the next player
  g.removePlayer(pipP);
  tick(1, RESIDENT_GRACE / 2);
  ok(ins().length === 6, 'the last player leaves: they stay through a quick reconnect');
  tick(2, RESIDENT_GRACE / 2);
  ok(ins().length === 0 && mgr.count() === 0 && R.status().every(s => !s.in && s.away === 0), `nobody online for ${RESIDENT_GRACE} s: they all leave (not counted as an admin removal)`);
  const ann = human('Ann', 8, WAYPOINTS[1].x, WAYPOINTS[1].z);
  const k0 = starts.length;
  tick(1);
  const back = ins()[0]?.e;
  tick(1);
  const bp = back && mgr.livePlayer(back);
  ok(back && starts[k0]?.lvl === residentLevel(8, RESIDENTS[0].share), 'the next player online: they come back at once, levelled to that player');
  ok(bp && floorOf(bp.x) === floorOf(ann.x), `on the floor that player is on (floor ${bp && floorOf(bp.x)})`);
}

if (process.env.NO_LIVE) { console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed (live part skipped)`); process.exit(failed ? 1 : 0); }

// ---------------- server ----------------
const PORT = Number(process.env.PORT) || 3746;
const env = { ...process.env, PORT: String(PORT), DATABASE_URL: '', NAMED_ENABLED: '0', AI_PROVIDER: '', RESIDENTS: '2', START_LEVEL: '10' };
delete env.RENDER;
const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = '';
srv.stdout.on('data', d => { srv.log += d; }); srv.stderr.on('data', d => { srv.log += d; });
let ws;
try {
  await until(() => /running on/.test(srv.log), 15000, 'server start');
  const c = { id: 0, msgs: [] };
  ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'welcome') c.id = m.id; c.msgs.push(m); });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(JSON.stringify({ type: 'join', name: `Ann${100 + Math.floor(Math.random() * 900)}`, cls: 'swordsman' }));
  await until(() => c.id, 5000, 'joined');
  const list = async () => { await sleep(300); const k = c.msgs.length; ws.send(JSON.stringify({ type: 'pbot', op: 'list' })); return (await until(() => c.msgs.slice(k).find(m => m.type === 'pbot' && m.list), 3000, 'list')).list; }; // (lists are throttled to one per 250 ms)
  const L = await until(async () => { const l = await list(); return l.bots.filter(b => b.resident).length === 2 ? l : null; }, 15000, 'two residents');
  const rs = L.bots.filter(b => b.resident);
  ok(rs.map(b => b.name).sort().join() === 'Gideon,Marlo', `RESIDENTS=2: Marlo and Gideon join a player (${rs.map(b => `${b.name}: ${b.doing}`).join('; ')})`);
  ok(rs.every(b => !b.mine && !b.creator && b.ctl.invite.ok && b.behaviour === 'own'), `listed as residents living their own day, nobody's, invitable`);
  const k = c.msgs.length;
  ws.send(JSON.stringify({ type: 'pbot', op: 'invite', bid: rs[0].bid }));
  await sleep(1500);
  const L2 = await list();
  const inv = L2.bots.find(b => b.bid === rs[0].bid);
  ok(inv?.myParty, `a player invites ${rs[0].name} into the party${inv?.myParty ? '' : ` (${JSON.stringify(c.msgs.slice(k).filter(m => m.type === 'pbot' || m.t === 'sys').slice(-2))})`}`);
} catch (e) {
  failed++; console.log(`  NOT OK - ${e.message}`); console.log(srv.log.slice(-1500));
} finally {
  ws?.close(); srv.kill();
}
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
process.exit(failed ? 1 : 0);
