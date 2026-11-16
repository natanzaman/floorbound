// HTTP static server + WebSocket game server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };

const game = new Game();

const server = http.createServer((req, res) => {
  if (res.handled) return;
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
}

wss.on('connection', ws => {
  let player = null;
  let budget = 60; // simple flood guard: messages per second
  const refill = setInterval(() => { budget = 60; }, 1000);

  ws.on('message', raw => {
    if (--budget < 0) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!player) {
      if (msg.type !== 'join') return;
      if (game.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ type: 'full' })); return ws.close(); }
      player = game.addPlayer(ws, msg.name, msg.cls);
      ws.send(JSON.stringify({ type: 'welcome', id: player.id, x: player.x, z: player.z, seq: player.posSeq }));
      broadcastRoster();
      return;
    }
    game.handle(player, msg);
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (player) { game.removePlayer(player); broadcastRoster(); }
  });
});

function tick(dt) {
  game.update(dt);
  const world = game.snapshot();
  for (const p of game.players.values()) {
    if (p.ws.readyState !== 1) continue;
    p.ws.send(`{"type":"snap","me":${JSON.stringify(game.meFor(p))},"w":${world}}`);
  }
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

server.listen(PORT, () => console.log(`Floorbound running on http://localhost:${PORT}`));
