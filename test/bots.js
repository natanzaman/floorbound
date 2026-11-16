// Headless bot players for load and gameplay testing.
// Usage: node test/bots.js [count=6] [seconds=60] [mode=field|boss] [url=ws://localhost:3000/ws]
import WebSocket from 'ws';
import { CLASS_IDS, MOB_IDS, PLAYER_SPEED, walkable, resolveCollision } from '../shared/data.js';

const [count = 6, seconds = 60, mode = 'field', url = 'ws://localhost:3000/ws'] = process.argv.slice(2);
const stats = { kills: 0, hits: 0, hurt: 0, deaths: 0, levels: 0, heals: 0, clears: 0, msgs: 0, bytes: 0 };
const bots = [];

function makeBot(i) {
  const ws = new WebSocket(url);
  const cls = CLASS_IDS[i % 3];
  const bot = { i, ws, cls, id: 0, x: 0, z: 0, seq: 0, face: 0, mobs: [], players: [], me: null, lvl: 1, dead: false };
  ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name: `Bot${i}`, cls })));
  ws.on('message', raw => {
    stats.msgs++; stats.bytes += raw.length;
    const msg = JSON.parse(raw);
    if (msg.type === 'welcome') Object.assign(bot, { id: msg.id, x: msg.x, z: msg.z, seq: msg.seq });
    if (msg.type !== 'snap') return;
    bot.me = msg.me; bot.lvl = msg.me.lvl;
    bot.mobs = msg.w.mobs; bot.players = msg.w.players;
    bot.fresh = true;
    const mine = msg.w.players.find(p => p[0] === bot.id);
    if (mine) bot.dead = !!mine[9];
    for (const e of msg.w.events) {
      if (e.t === 'tp' && e.id === bot.id) { bot.x = e.x; bot.z = e.z; bot.seq = e.s; }
      if (e.t === 'invite' && e.to === bot.id) ws.send(JSON.stringify({ type: 'accept', from: e.from }));
      if (bot.i !== 0) continue; // count global events once
      if (e.t === 'die') stats.kills++;
      if (e.t === 'hit') stats.hits++;
      if (e.t === 'hurt') stats.hurt++;
      if (e.t === 'pdie') stats.deaths++;
      if (e.t === 'lvl') stats.levels++;
      if (e.t === 'heal') stats.heals++;
      if (e.t === 'clear') stats.clears++;
      if (e.t === 'sys' && !e.to) console.log(`  [sys] ${e.text}`);
    }
  });
  return bot;
}

for (let i = 0; i < +count; i++) bots.push(makeBot(i));

// Bot 0 invites up to 5 others into a party after joining.
setTimeout(() => {
  for (const b of bots.slice(1, 6)) bots[0].ws.send(JSON.stringify({ type: 'invite', id: b.id }));
}, 1500);

const dt = 0.05;
const loop = setInterval(() => {
  for (const b of bots) {
    if (!b.id || b.ws.readyState !== 1 || b.dead || !b.fresh) continue;
    b.fresh = false;
    let tx, tz, target = null;
    const near = b.mobs.filter(m => MOB_IDS[m[1]] !== 'warden').sort((a, c) => Math.hypot(a[2] - b.x, a[3] - b.z) - Math.hypot(c[2] - b.x, c[3] - b.z))[0];
    if (mode === 'boss' && near && Math.hypot(near[2] - b.x, near[3] - b.z) < 16) { target = near; tx = near[2]; tz = near[3]; }
    else if (mode === 'boss') {
      const boss = b.mobs.find(m => MOB_IDS[m[1]] === 'warden');
      if (b.z < 150) { tx = 0; tz = 160; }
      else if (boss) { target = boss; tx = boss[2]; tz = boss[3]; }
      else { tx = 0; tz = 185; }
    } else {
      let best = 1e9;
      for (const m of b.mobs) {
        if (MOB_IDS[m[1]] === 'warden') continue;
        const d = Math.hypot(m[2] - b.x, m[3] - b.z);
        if (d < best) { best = d; target = m; }
      }
      if (target) { tx = target[2]; tz = target[3]; }
    }
    if (tx === undefined) continue;
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    b.face = Math.atan2(dx, dz);
    const stop = target ? (b.cls === 'cleric' ? 6 : 2.2) + (MOB_IDS[target[1]] === 'warden' ? 2 : 0) : 0.5;
    if (d > stop) {
      const step = Math.min(d - stop, PLAYER_SPEED * dt);
      let nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
      [nx, nz] = resolveCollision(nx, nz);
      if (walkable(nx, nz)) { b.x = nx; b.z = nz; }
    }
    b.ws.send(JSON.stringify({ type: 'input', x: b.x, z: b.z, face: b.face, seq: b.seq }));
    if (target && d < stop + 3 && b.me) {
      for (let s = 3; s >= 0; s--) {
        if (b.me.cds[s] <= 0) { b.ws.send(JSON.stringify({ type: 'skill', slot: s, face: b.face })); b.me.cds[s] = 1; break; }
      }
    }
  }
}, 5);

const report = setInterval(() => {
  const lv = bots.map(b => b.lvl).join(',');
  console.log(`t+ kills=${stats.kills} hits=${stats.hits} hurt=${stats.hurt} deaths=${stats.deaths} lvls=${stats.levels} heals=${stats.heals} clears=${stats.clears} levels=[${lv}] avgMsg=${Math.round(stats.bytes / Math.max(1, stats.msgs))}B`);
}, 10000);

setTimeout(() => {
  clearInterval(loop); clearInterval(report);
  console.log('FINAL', JSON.stringify(stats), 'levels', bots.map(b => `${b.cls}:${b.lvl}`).join(' '));
  for (const b of bots) b.ws.close();
  setTimeout(() => process.exit(0), 300);
}, +seconds * 1000);
