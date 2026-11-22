// The empty world sleeps and browsers get only what is near them (docs/ROADMAP.md, perf review #6 and #10).
//   in process  nobody online: no mob moves anywhere, but the dead still respawn on time; a human on a floor wakes that
//               floor only (town counts); a server bot out of the safe zones wakes its floor (bot-only parties), one
//               resting in a camp doesn't; a boss mid-fight keeps its floor awake with nobody there (its wipe reset
//               runs); a director show wakes every floor with anyone on it; mobs are only pushed apart on awake floors;
//               viewFor(player): players and mobs near them (+ party, duel, the floor's boss), with hysteresis
//   server      a real server on PORT (default 6620, no database, no Named): a browser on Floor 1 gets only Floor 1's
//               mobs, a spectator (the film view) every floor's; /status shows the bytes
// Usage: node test/worldsleep.js   (PORT=66xx)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Game, VIEW } from '../server/game.js';
import { MOBS, MOB_IDS } from '../shared/data.js';
import { floorOf, F2 } from '../shared/floor2.js';
import { F3 } from '../shared/floor3.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });

const field = g => [...g.mobs.values()].filter(m => !m.def.boss && !m.dead && !m.def.ai); // Floor 1 field mobs (they wander)
const posOf = g => new Map([...g.mobs.values()].map(m => [m.id, `${m.x.toFixed(3)},${m.z.toFixed(3)}`]));
const movedOn = (g, before) => { const out = { 1: 0, 2: 0, 3: 0 }; for (const m of g.mobs.values()) if (before.get(m.id) !== `${m.x.toFixed(3)},${m.z.toFixed(3)}`) out[floorOf(m.x)]++; return out; };
const run = (g, secs) => { for (let i = 0; i < secs * 20; i++) g.update(0.05); };
const human = (g, name, x, z) => { const p = g.addPlayer({ readyState: 1, send() {} }, name, 'swordsman'); p.x = x; p.z = z; return p; };

console.log('# in process');
{
  const g = new Game();
  run(g, 1);
  let before = posOf(g);
  run(g, 20);
  let mv = movedOn(g, before);
  ok(mv[1] === 0 && mv[2] === 0 && mv[3] === 0, `nobody online: no mob moves on any floor (${JSON.stringify(mv)})`);
  ok(g.activeFloors().size === 0, 'no floor is awake');
  const wolf = field(g).find(m => m.type === 'wolf');
  wolf.hp = 0; wolf.dead = true; wolf.deadUntil = g.time + 2; const sx = wolf.sx;
  run(g, 3);
  ok(!wolf.dead && wolf.hp === wolf.maxHp && wolf.x === sx, 'but a dead mob still respawns on time (at its spawn point)');

  const nat = human(g, 'Natan', 0, 6); // in town
  before = posOf(g); run(g, 20); mv = movedOn(g, before);
  ok(mv[1] > 5 && mv[2] === 0 && mv[3] === 0, `a human in town: Floor 1 wanders, Floors 2 and 3 stand still (${JSON.stringify(mv)})`);

  // bots: out of the safe zones they count (bot-only parties); resting in a camp they don't
  const bot = human(g, 'Bot', F2.camp.x, F2.camp.z); bot.bot = true;
  run(g, 1);
  ok(!g.activeFloors().has(2), 'a server bot resting in Mirelight Camp: Floor 2 sleeps');
  bot.x = F2.camp.x; bot.z = F2.camp.z + 60; bot.maxHp = bot.hp = 1e9; // (a level-1 bot in the Mire wouldn't last the 20 s)
  before = posOf(g); run(g, 20); mv = movedOn(g, before);
  ok(g.activeFloors().has(2) && mv[2] > 3 && mv[3] === 0, `a server bot out in the Mire: Floor 2 wakes (${JSON.stringify(mv)})`);
  g.removePlayer(bot);

  // a boss mid-fight keeps its floor awake with nobody there: the wipe reset runs
  const sov = g.sovereign;
  sov.hp = Math.round(sov.maxHp * 0.6);
  ok(g.activeFloors().has(2), 'a hurt Sovereign with nobody in the court: Floor 2 stays awake');
  run(g, 1);
  ok(sov.hp === sov.maxHp && !g.activeFloors().has(2), 'its fight resets (nobody left), then Floor 2 sleeps');

  // a director show: every floor with anyone on it (its cast are bots, even in a camp)
  const actor = human(g, 'Actor', F3.camp.x, F3.camp.z); actor.bot = true;
  ok(!g.activeFloors().has(3), 'a bot in Windbreak Camp: Floor 3 sleeps');
  g.director = { running: true };
  ok(g.activeFloors().has(3), 'during a show it is awake');
  g.director = null; g.removePlayer(actor);

  // humans count anywhere: one on Floor 3 wakes Floor 3
  const ron = human(g, 'Ronnie', F3.camp.x, F3.camp.z);
  ok(g.activeFloors().has(3) && g.activeFloors().has(1) && !g.activeFloors().has(2), 'a human in each of Floors 1 and 3: those two, not Floor 2');
  g.removePlayer(ron);

  // WORLD_SLEEP=0: every floor, always (benchmarks)
  process.env.WORLD_SLEEP = '0';
  ok(g.activeFloors().size === 3, 'WORLD_SLEEP=0: every floor');
  delete process.env.WORLD_SLEEP;

  // separation: per floor (two mobs stacked on a sleeping floor stay as they are; on an awake one they're pushed apart)
  const [a, b] = [...g.mobs.values()].filter(m => floorOf(m.x) === 2 && !m.def.boss && !m.dead && !m.hidden).slice(0, 2);
  a.x = b.x + 0.1; a.z = b.z;
  g.update(0.05);
  ok(Math.abs(a.x - b.x - 0.1) < 1e-9, 'a sleeping floor: no separation pass');
  const [c, d] = field(g).slice(0, 2);
  c.x = d.x + 0.1; c.z = d.z; c.moving = false;
  g.update(0.05);
  ok(Math.hypot(c.x - d.x, c.z - d.z) > 0.1 + 1e-6, 'an awake floor: stacked mobs are pushed apart');

  // snapshots: the full one for bots and spectators, viewFor(player) for browsers (only what is near them)
  const full = JSON.parse(g.snapshot());
  ok(new Set(full.mobs.map(m => floorOf(m[2]))).size === 3 && full.mobs.length > 60, `the full world has every floor's mobs (${full.mobs.length})`);
  const dm = (a, x, z) => Math.hypot(a[2] - x, a[3] - z), dp = (a, x, z) => Math.hypot(a[1] - x, a[2] - z);
  const v = { id: -1, x: 0, z: 70, party: 0, duel: 0 };
  let w = JSON.parse(g.viewFor(v));
  ok(w.mobs.length && w.mobs.every(m => floorOf(m[2]) === 1 && (dm(m, v.x, v.z) <= VIEW.in || MOBS[MOB_IDS[m[1]]].boss)), `a viewer gets only its floor's mobs within ${VIEW.in} m, and its floor's boss (${w.mobs.length})`);
  ok(full.mobs.filter(m => floorOf(m[2]) === 1 && dm(m, v.x, v.z) <= VIEW.in).every(m => w.mobs.some(x => x[0] === m[0])), 'every mob in range is there');
  ok(w.mobs.some(m => MOBS[MOB_IDS[m[1]]].boss && dm(m, v.x, v.z) > VIEW.in) || !full.mobs.some(m => MOBS[MOB_IDS[m[1]]].boss && floorOf(m[2]) === 1 && dm(m, v.x, v.z) > VIEW.in), 'the floor\'s boss is there even out of range');
  const strip = w => JSON.stringify({ ...w, mobs: 0, players: 0 });
  ok(strip(w) === strip(full), 'everything else is the same (events, gates, Floor 2/3 state, …)');
  // hysteresis: a mob between VIEW.in and VIEW.out stays only if it was already shown
  const edge = field(g).find(m => floorOf(m.x) === 1);
  const at = (VIEW.in + VIEW.out) / 2;
  const v2 = { id: -2, x: edge.x, z: edge.z - at, party: 0, duel: 0 };
  g.snapshot();
  w = JSON.parse(g.viewFor(v2));
  ok(!w.mobs.some(m => m[0] === edge.id), `a mob ${at} m away isn't shown to a newcomer`);
  v2.inView.add(edge.id);
  w = JSON.parse(g.viewFor(v2));
  ok(w.mobs.some(m => m[0] === edge.id), '…but stays for a viewer that already had it (no popping at the edge)');
  // players: near ones, the party and the duel wherever they are
  const near = human(g, 'Nearby', 2, 72), far = human(g, 'Faraway', F2.x, 0), mate = human(g, 'Mate', far.x + 1, far.z), foe = human(g, 'Foe', far.x + 2, far.z);
  const me = human(g, 'Viewer', 0, 70);
  me.party = mate.party = 77; me.duel = foe.duel = 'd1';
  g.snapshot();
  w = JSON.parse(g.viewFor(me));
  const ids = new Set(w.players.map(p => p[0]));
  ok(ids.has(me.id) && ids.has(near.id), 'myself and a player nearby are there');
  ok(!ids.has(far.id), 'a stranger on another floor isn\'t');
  ok(ids.has(mate.id) && ids.has(foe.id), 'my party and my duel are, wherever they are');
  ok(w.players.every(p => [me, near, mate, foe].some(q => q.id === p[0]) || dp(p, me.x, me.z) <= VIEW.in), 'nobody else out of range');
  me.party = mate.party = 0; me.duel = foe.duel = 0;
  for (const q of [near, far, mate, foe, me]) g.removePlayer(q);
  g.events.push({ t: 'chat', text: '"mobs":0 "players":0 ]' });
  const tricky = g.snapshot();
  ok(JSON.parse(tricky).events.at(-1).text === '"mobs":0 "players":0 ]' && JSON.parse(g.viewFor(v)).events.at(-1).text === '"mobs":0 "players":0 ]', 'chat text that looks like the keys changes nothing');
  void nat;
}

console.log('# a real server');
{
  const PORT = Number(process.env.PORT) || 6620;
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', NAMED_ENABLED: '0', TEST_HOOKS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${PORT}/status`); break; } catch { await sleep(100); } }
    const connect = (hello, keep) => new Promise(res => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`), snaps = [];
      ws.on('open', () => ws.send(JSON.stringify(hello)));
      ws.on('message', raw => { const s = raw.toString(); if (s.startsWith('{"type":"snap"')) { snaps.push(JSON.parse(s)); if (snaps.length === keep) res({ ws, snaps }); } });
    });
    const [h, sp] = await Promise.all([connect({ type: 'join', name: 'Floorone', cls: 'cleric' }, 10), connect({ type: 'spectate' }, 10)]);
    const hm = h.snaps.at(-1).w.mobs, sm = sp.snaps.at(-1).w.mobs;
    ok(hm.length > 20 && hm.every(m => floorOf(m[2]) === 1), `a browser on Floor 1 gets only Floor 1's mobs (${hm.length})`);
    ok(new Set(sm.map(m => floorOf(m[2]))).size === 3 && sm.length > hm.length, `a spectator (the film view) gets every floor's (${sm.length})`);
    ok(h.snaps.every(s => typeof s.st === 'number') && h.snaps.at(-1).st > h.snaps[0].st, 'snapshots carry the server clock');
    const st = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
    ok(st.bytes.total > 0, `/status counts the bytes (${st.bytes.total})`);
    h.ws.close(); sp.ws.close();
  } finally { srv.kill('SIGKILL'); }
  if (/\[uncaughtException\]|\[unhandledRejection\]/.test(log)) { failed++; console.log(log); }
}

console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n}/${n} passed`);
process.exit(failed ? 1 : 0);
