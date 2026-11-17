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
import { PlayerBots } from './playerbots.js';
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary' };

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
game.onClear = rec => hall.add(rec); // Hall of Clearers (DB insert + in-memory cache)
const spectators = new Set(); // watch-only clients (?spectate=1)
const bots = new BotManager(game, { url: () => `ws://127.0.0.1:${server.address().port}/ws` }); // admin-managed bots
const playerBots = new PlayerBots(game, bots); // bots players add in game (P → Bots), server/playerbots.js

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
    return res.end(JSON.stringify({ players: game.players.size, floorClears: game.floorClears, uptime: Math.round(game.time) }));
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

wss.on('connection', ws => {
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
      return game.addPlayer(ws, c.name, c.cls, { charId: c.id, accountId: acct.id, lvl: c.lvl, xp: c.xp, gold: c.gold, inv: c.inv, stats: c.stats, mastery: c.mastery, talents: c.talents });
    }
    if (bots.isBotJoin(msg)) return bots.addBotPlayer(ws, msg); // server-run bot (server/botmanager.js)
    return game.addPlayer(ws, msg.name, msg.cls);
  }
  let budget = 60; // simple flood guard: messages per second
  const refill = setInterval(() => { budget = 60; }, 1000);

  ws.on('message', raw => {
    if (--budget < 0) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!player) {
      if (msg.type === 'spectate' && !spectators.has(ws)) {
        spectators.add(ws);
        ws.send(JSON.stringify({ type: 'welcome', spectator: true }));
        ws.send(JSON.stringify({ type: 'roster', players: game.roster() }));
        return;
      }
      if (msg.type !== 'join' || joining) return;
      if (game.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ type: 'full' })); return ws.close(); }
      joining = true;
      join(msg).then(p => {
        joining = false;
        if (!p || ws.readyState !== 1) { if (p) game.removePlayer(p); return; }
        player = p;
        ws.send(JSON.stringify({ type: 'welcome', id: player.id, x: player.x, z: player.z, seq: player.posSeq, lvl: player.lvl, xp: player.xp, charId: player.charId || 0 }));
        ws.send(JSON.stringify(game.invFor(player))); player.invDirty = false;
        ws.send(JSON.stringify(game.masteryMsg(player))); player.masteryDirty = false; player.mSentT = game.time;
        ws.send(JSON.stringify(game.talentsMsg(player))); player.talentsDirty = false; // talent tree (server/talents.js)
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
});

function tick(dt) {
  game.update(dt);
  const world = game.snapshot();
  for (const p of game.players.values()) {
    if (p.ws.readyState !== 1) continue;
    p.ws.send(`{"type":"snap","me":${JSON.stringify(game.meFor(p))},"w":${world}}`);
    if (p.invDirty) { p.invDirty = false; p.ws.send(JSON.stringify(game.invFor(p))); }
    if (p.talentsDirty) { p.talentsDirty = false; p.ws.send(JSON.stringify(game.talentsMsg(p))); } // talent tree: points, ranks
    if (p.masteryDirty && (p.masteryNow || game.time - (p.mSentT || 0) >= 1)) { // skill mastery: at most once a second, at once on a level-up/evolve
      p.masteryDirty = p.masteryNow = false; p.mSentT = game.time;
      p.ws.send(JSON.stringify(game.masteryMsg(p)));
    }
  }
  if (game.rosterDirty) { game.rosterDirty = false; broadcastRoster(); } // e.g. someone changed their title
  for (const ws of spectators) if (ws.readyState === 1) ws.send(`{"type":"snap","me":null,"w":${world}}`);
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

admin.init({ game, bots });
db.migrate()
  .then(() => hall.load())
  .then(() => { game.hadFirstClear = hall.hasFirst(); game.hadFirstClear2 = hall.hasFirst(2); })
  .then(() => server.listen(PORT, () => console.log(`Floorbound running on http://localhost:${PORT}${db.enabled ? ' (accounts on' + (accounts.discordOn() ? ', Discord sign-in on' : '') + ')' : ''}`)))
  .catch(err => { console.error('Startup failed', err); process.exit(1); });
