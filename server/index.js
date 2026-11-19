// HTTP static server + WebSocket game server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import * as db from './db.js';
import * as accounts from './accounts.js';
import * as track from './track.js';
import * as hall from './hall.js';
import * as admin from './admin.js';
import { BotManager } from './botmanager.js';
import { makeLocalHub, deepFreeze } from './localws.js'; // in-process sockets for the server's own bots
import { PlayerBots } from './playerbots.js';
import { drain } from './shutdown.js';
import { installAI } from './ai/index.js'; // AI companions (off unless AI_PROVIDER + key are set), server/ai/
import { makeStore as aiStore } from './ai/store.js'; // AI memories + daily spend in Postgres
import { Director } from './director.js'; // the scene director (filming), server/director.js
import { installDirectorAdmin } from './director-admin.js';
import { NamedManager, makeNamedStore, namedOn } from './named.js'; // the Named: the Hearthward and the loner (NAMED_ENABLED=0 turns them off)
import { installNamedAdmin } from './named-admin.js';
import { NamedQuests, makeQuestStore } from './namedquests.js'; // the Named's requests and invitations (I4)
import { TICK_RATE } from '../shared/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 64;

const MOUNTS = [
  ['/vendor/addons/', path.join(root, 'node_modules/three/examples/jsm')],
  ['/vendor/', path.join(root, 'node_modules/three/build')],
  ['/shared/', path.join(root, 'shared')],
  ['/', path.join(root, 'public')],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };

// A bug in one bot or one event shouldn't take the whole world down (and wipe everyone's bots). Log it and keep going.
let crashes = 0;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, err => {
    console.error(`[${ev}]`, err?.stack || err);
    if (++crashes > 50) process.exit(1); // something is badly wrong: let the host restart us
  });
}
setInterval(() => { crashes = Math.max(0, crashes - 5); }, 60000).unref();

const game = new Game();
game.track = track.record;
game.onClear = rec => { hall.add(rec); broadcastHall(); }; // Hall of Clearers (DB insert + in-memory cache); the engraved stones update live
const spectators = new Set(); // watch-only clients (?spectate=1)
// The server's own bots (admin, player-added, the Named) talk to it through in-process sockets (server/localws.js):
// no JSON or loopback socket per bot per tick. BOT_TRANSPORT=ws puts them back on real WebSockets (benchmarks, tests).
const localHub = process.env.BOT_TRANSPORT === 'ws' ? null : makeLocalHub(ws => onConnection(ws));
const bots = new BotManager(game, { url: () => `ws://127.0.0.1:${server.address().port}/ws`, local: localHub }); // admin-managed bots
const playerBots = new PlayerBots(game, bots); // bots players add in game (P → Bots), server/playerbots.js
game.director = new Director(game, bots); // plays cue sheets with bot actors (docs/ROADMAP.md F2)
const named = namedOn() ? new NamedManager(game, bots) : null; // server/named.js (only while a human is online)
if (named) new NamedQuests(named); // named.quests: requests and outreach (server/namedquests.js)

const server = http.createServer(async (req, res) => {
  if (res.handled) return;
  const full = new URL(req.url, 'http://x');
  if (full.pathname === '/api/stats') {
    const body = await track.stats(Number(full.searchParams.get('days')) || 7).catch(e => ({ error: e.message }));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(body));
  }
  if (full.pathname.startsWith('/api/') || full.pathname.startsWith('/auth/')) {
    if (await admin.handle(req, res, full)) return; // /api/admin/* and /api/lobby (server/admin.js)
    if (await accounts.handle(req, res, full)) return;
  }
  const url = decodeURIComponent(full.pathname);
  if (url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ players: game.players.size, floorClears: game.floorClears, uptime: Math.round(game.time), tick: tickStats(), ...perfStats() }));
  }
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const rel = url.slice(prefix.length) || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) break;
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function broadcastRoster() {
  const msg = JSON.stringify({ type: 'roster', players: game.roster() });
  for (const p of game.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
  for (const ws of spectators) if (ws.readyState === 1) ws.send(msg);
}
function broadcastHall() { // everyone (spectators too) keeps the Hall in step: the engraved stones show the latest clear
  const msg = JSON.stringify(hall.message());
  for (const p of game.players.values()) if (p.ws?.readyState === 1) p.ws.send(msg);
  for (const ws of spectators) if (ws.readyState === 1) ws.send(msg);
}

wss.on('connection', ws => onConnection(ws));

// One client: a browser, an external bot runner, or one of the server's own bots on an in-process socket (ws.local:
// its messages arrive as objects, not JSON).
function onConnection(ws) {
  let player = null, joining = false;

  // Account characters join with { session, character }; without them it's an anonymous (unsaved) player.
  async function join(msg) {
    if (msg.session && db.enabled) {
      const acct = await accounts.accountFromToken(msg.session);
      if (!acct) { ws.send(JSON.stringify({ type: 'denied', reason: 'Your session expired. Sign in again.', signedOut: true })); return null; }
      let c = await accounts.loadCharacter(acct.id, msg.character);
      if (!c) { ws.send(JSON.stringify({ type: 'denied', reason: 'Character not found.' })); return null; }
      for (const other of [...game.players.values()]) {
        if (other.charId !== c.id) continue; // same character opened twice: save the old one, the newer tab wins
        await accounts.saveCharacter(other);
        other.ws.send(JSON.stringify({ type: 'denied', reason: 'This character was opened somewhere else.' }));
        game.removePlayer(other);
        other.ws.close();
        c = await accounts.loadCharacter(acct.id, msg.character);
      }
      const p = game.addPlayer(ws, c.name, c.cls, { charId: c.id, accountId: acct.id, lvl: c.lvl, xp: c.xp, gold: c.gold, inv: c.inv, stats: c.stats, mastery: c.mastery, talents: c.talents });
      admin.isAdmin(acct).then(v => { p.admin = v; }).catch(() => {}); // admins can order any bot (botcmd with a name)
      return p;
    }
    if (bots.isBotJoin(msg)) return bots.addBotPlayer(ws, msg); // server-run bot (server/botmanager.js)
    return game.addPlayer(ws, msg.name, msg.cls);
  }
  let budget = 60; // simple flood guard: messages per second
  const refill = setInterval(() => { budget = 60; }, 1000);

  ws.on('message', raw => {
    if (--budget < 0) return;
    let msg;
    if (ws.local) msg = raw; // (already an object: server/localws.js)
    else try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (!player) {
      if (msg.type === 'spectate' && !spectators.has(ws)) {
        spectators.add(ws);
        ws.send(JSON.stringify({ type: 'welcome', spectator: true }));
        ws.send(JSON.stringify({ type: 'roster', players: game.roster() }));
        ws.send(JSON.stringify(hall.message())); // the engraved stones
        ws.send(JSON.stringify({ type: 'cine', state: game.cineState() })); // film view: the current shot, light, letterbox… (server/cine.js)
        return;
      }
      if (msg.type === 'hall' && spectators.has(ws)) return ws.send(JSON.stringify(hall.message()));
      if (msg.type !== 'join' || joining) return;
      if (game.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ type: 'full' })); return ws.close(); }
      joining = true;
      join(msg).then(p => {
        joining = false;
        if (!p || ws.readyState !== 1) { if (p) game.removePlayer(p); return; }
        player = p;
        ws.send(JSON.stringify({ type: 'welcome', id: player.id, x: player.x, z: player.z, seq: player.posSeq, lvl: player.lvl, xp: player.xp, charId: player.charId || 0, ...(game.aiOn?.() ? { ai: 1 } : {}), ...(game.named ? { named: true } : {}) })); // named: the Friends tab (NAMED_ENABLED=0: none)
        ws.send(JSON.stringify(game.invFor(player))); player.invDirty = false;
        ws.send(JSON.stringify(game.masteryMsg(player))); player.masteryDirty = false; player.mSentT = game.time;
        ws.send(JSON.stringify(game.talentsMsg(player))); player.talentsDirty = false; // talent tree (server/talents.js)
        ws.send(JSON.stringify(hall.message())); // the engraved stones
        ws.send(JSON.stringify({ type: 'cine', state: game.cineState() })); // players only use its light (public/cine.js)
        broadcastRoster();
      }).catch(err => { joining = false; console.error('join failed', err); ws.send(JSON.stringify({ type: 'denied', reason: 'Server error, try again.' })); });
      return;
    }
    if (msg.type === 'hall') return ws.send(JSON.stringify(hall.message()));
    if (msg.type === 'pbot') return void playerBots.handle(player, msg).catch(e => console.error('pbot', e));
    game.handle(player, msg);
  });

  ws.on('close', () => {
    clearInterval(refill);
    spectators.delete(ws);
    if (player && game.players.get(player.id) === player) {
      if (player.charId) accounts.saveCharacter(player).catch(e => console.error('save failed', e));
      game.removePlayer(player); broadcastRoster();
    }
  });
}

// How long the last minute of ticks took (ms), for /status.
const tickMs = new Float32Array(60 * TICK_RATE); let tickN = 0;
function tickStats() {
  const a = [...tickMs.subarray(0, Math.min(tickN, tickMs.length))].sort((x, y) => x - y), at = q => +(a[Math.min(a.length - 1, Math.floor(a.length * q))] || 0).toFixed(2);
  return { n: a.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}

// CPU and bytes, for /status and scripts/perfbench.js: process CPU (% of one core over the last minute, and seconds in all),
// snapshot bytes serialised for sockets (per second over the last minute, and in all), and who is online by kind.
const perf = { cpu: new Float64Array(61), bytes: new Float64Array(61), i: 0, bytesNow: 0, bytesAll: 0, t: new Float64Array(61) };
const cpuSecs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1e6; };
perf.cpu.fill(cpuSecs()); perf.t.fill(performance.now() / 1000);
setInterval(() => { const k = ++perf.i % 61; perf.cpu[k] = cpuSecs(); perf.bytes[k] = perf.bytesAll; perf.t[k] = performance.now() / 1000; }, 1000).unref();
function perfStats() {
  const k = perf.i % 61, o = (perf.i + 1) % 61, dt = Math.max(1e-3, perf.t[k] - perf.t[o]);
  const kinds = { humans: 0, player: 0, admin: 0, named: 0 };
  const owned = new Set([...(playerBots.owned?.keys() || [])]);
  for (const p of game.players.values()) if (!p.bot) kinds.humans++;
  for (const e of bots.bots) if (!e.b.closed) kinds[e.named ? 'named' : owned.has(e.bid) ? 'player' : 'admin']++;
  return {
    cpu: { pct: +((100 * (perf.cpu[k] - perf.cpu[o])) / dt).toFixed(1), s: +cpuSecs().toFixed(2) },
    bytes: { perSec: Math.round((perf.bytes[k] - perf.bytes[o]) / dt), total: perf.bytesAll },
    online: kinds,
  };
}
const sendCounted = (ws, str) => { perf.bytesAll += str.length; ws.send(str); };

function tick(dt) {
  const t0 = performance.now();
  game.update(dt);
  const world = game.snapshot();
  let shared = null; // the world part for in-process bots: parsed once a tick, shared by all of them (read-only)
  for (const p of game.players.values()) {
    if (p.ws.readyState !== 1) continue;
    if (p.ws.local) p.ws.deliver({ type: 'snap', me: game.meFor(p), w: (shared ||= localHub.freeze ? deepFreeze(JSON.parse(world)) : JSON.parse(world)) });
    else sendCounted(p.ws, `{"type":"snap","me":${JSON.stringify(game.meFor(p))},"w":${world}}`);
    if (p.invDirty) { p.invDirty = false; p.ws.send(JSON.stringify(game.invFor(p))); }
    if (p.talentsDirty) { p.talentsDirty = false; p.ws.send(JSON.stringify(game.talentsMsg(p))); } // talent tree: points, ranks
    if (p.masteryDirty && (p.masteryNow || game.time - (p.mSentT || 0) >= 1)) { // skill mastery: at most once a second, at once on a level-up/evolve
      p.masteryDirty = p.masteryNow = false; p.mSentT = game.time;
      p.ws.send(JSON.stringify(game.masteryMsg(p)));
    }
  }
  if (game.rosterDirty) { game.rosterDirty = false; broadcastRoster(); } // e.g. someone changed their title
  for (const ws of spectators) if (ws.readyState === 1) sendCounted(ws, `{"type":"snap","me":null,"w":${world}}`);
  tickMs[tickN++ % tickMs.length] = performance.now() - t0;
}

if (process.env.LOCKSTEP) {
  // Testing aid for frame-by-frame recording: the world only advances on GET /step.
  server.prependListener('request', (req, res) => {
    if (!req.url.startsWith('/step')) return;
    tick(1 / TICK_RATE);
    res.writeHead(200); res.end('ok');
    res.handled = true;
  });
} else {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    tick(dt);
  }, 1000 / TICK_RATE);
}

// Save account characters every 15 s (and on disconnect / level-up via the dirty flag).
{
  setInterval(() => {
    if (!db.enabled) return;
    for (const p of game.players.values()) {
      if (!p.charId || !p.dirty) continue;
      p.dirty = false;
      accounts.saveCharacter(p).catch(e => { p.dirty = true; console.error('save failed', e); });
    }
  }, 15000);
}

// Deploys (Render sends SIGTERM to the old instance): warn everyone, let a boss fight finish (up to 4 min), save, exit.
let stopping = false;
async function shutdown(sig) {
  if (stopping) { console.log(`${sig} again: exiting now`); process.exit(1); } // (a second Ctrl+C doesn't wait)
  stopping = true;
  console.log(`${sig}: draining before exit`);
  try {
    await drain({
      game,
      notify: text => game.sys(text), // (sent with the next snapshot)
      save: async () => {
        if (db.enabled) await Promise.allSettled([...game.players.values()].filter(p => p.charId).map(p => accounts.saveCharacter(p)));
        await track.flush().catch(() => {});
        await aiMinds.flush(); // AI memories + spend (server/ai/store.js)
        await named?.flush(); // friendship still waiting to be saved (server/named.js)
      },
    });
  } catch (e) { console.error('shutdown', e); }
  await new Promise(r => setTimeout(r, 300)); // let the last snapshot (with the notice) go out
  console.log('saved, exiting');
  process.exit(0);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => void shutdown(sig));

admin.init({ game, bots });
if (process.env.TEST_HOOKS) globalThis.floorbound = { game, bots, playerBots, localHub }; // testing aid: a test that imports this file reaches the live objects (test/localws.js)
const aiMinds = installAI({ game, bots, server });
installDirectorAdmin({ server, director: game.director }); // /api/admin/director (admin page: Director tab)
installNamedAdmin({ server, named }); // /api/admin/named (admin page: The Named card)
server.on('error', err => { console.error('Server error', err); if (err.code === 'EADDRINUSE' || err.code === 'EACCES') process.exit(1); }); // can't listen: don't linger
db.migrate()
  .then(() => hall.load())
  .then(() => { game.hadFirstClear = hall.hasFirst(); game.hadFirstClear2 = hall.hasFirst(2); game.hadFirstClear3 = hall.hasFirst(3); })
  .then(() => { if (db.enabled) aiMinds.useStore(aiStore(db.q)); }) // (async, never blocks or fails startup)
  .then(() => { if (db.enabled && named) { named.quests.useStore(makeQuestStore(db.q)); return named.useStore(makeNamedStore(db.q, { adminIds: (process.env.ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean) })); } })
  .then(() => server.listen(PORT, () => console.log(`Floorbound running on http://localhost:${PORT}${db.enabled ? ' (accounts on' + (accounts.discordOn() ? ', Discord sign-in on' : '') + ')' : ''}`)))
  .catch(err => { console.error('Startup failed', err); process.exit(1); });
