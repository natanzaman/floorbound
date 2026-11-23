// Server CPU benchmark: starts a real server (anonymous, no database) with N humans (fake WebSocket clients that move
// about like players), B player-added bots (each human adds up to 3 through the Bots tab's own messages) and F free
// bots living their own day (added out of any party, shared/bots/day.js), plus the 5 Named, then reads the server's own
// /status before and after a measuring window.
// Reports: tick p50 / p95 (ms), server CPU seconds per wall second (process.cpuUsage, so 0.15 = Render's free plan),
// snapshot bytes serialised per second, and who was online by kind.
//
// Usage: node scripts/perfbench.js                      (the three standard runs: 2h+0b, 2h+6b, 4h+9b, Named on)
//        HUMANS=2 BOTS=6 FREE=30 node scripts/perfbench.js  (one run; NAMED=0 turns the Named off)
//        FREE=10,30,60,100 node scripts/perfbench.js     (one run per count, with HUMANS humans, default 2)
//   env: SECS=60 measuring window, WARM=15 seconds before it, PORT=6050, SPOT=town|field (where the humans stand:
//        town = the spawn; field = the Verdant Field, the Named's home), CLS=swordsman,cleric,... (the bots' classes),
//        EXTRA="K=V K2=V2" extra server env (e.g. BOT_TRANSPORT=ws BOT_THINK=20), JSON=1 one JSON line per run,
//        PROFILE=1 stops the server with SIGINT so NODE_OPTIONS=--cpu-prof (in EXTRA) can write its profile.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SECS = Number(process.env.SECS) || 60, WARM = Number(process.env.WARM ?? 15);
const BASE_PORT = Number(process.env.PORT) || 6050;
const SPOTS = { town: [0, 6], field: [0, 70] };
const CLS = (process.env.CLS || 'guardian,cleric,swordsman,ranger,berserker,lancer,bard').split(',');

function startServer(port, env) {
  const extra = Object.fromEntries((process.env.EXTRA || '').split(/\s+/).filter(Boolean).map(kv => kv.split('=')));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATABASE_URL: '', TEST_HOOKS: '', ...env, ...extra },
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; if (process.env.VERBOSE) process.stderr.write(d); });
  return { child, log: () => out };
}
async function status(port) { return (await fetch(`http://127.0.0.1:${port}/status`)).json(); }
async function waitUp(port) {
  for (let i = 0; i < 100; i++) { try { return await status(port); } catch { await sleep(100); } }
  throw new Error('server did not start');
}

// A fake human: joins, walks a slow circle around its spot at 20 Hz (like the browser's input), adds bots on request.
function human(port, i, spot) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const h = { ws, id: 0, x: 0, z: 0, seq: 0, a: i, bytes: 0, replies: [] };
  const send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  h.send = send;
  ws.on('open', () => send({ type: 'join', name: `Bench${i}`, cls: CLS[i % CLS.length] }));
  ws.on('message', raw => {
    h.bytes += raw.length;
    const s = raw.toString();
    if (s.startsWith('{"type":"snap"')) { // only our own teleports matter (the spot, a death)
      if (s.includes('"t":"tp"')) for (const e of JSON.parse(s).w.events) if (e.t === 'tp' && e.id === h.id) Object.assign(h, { x: e.x, z: e.z, seq: e.s });
      return;
    }
    const m = JSON.parse(s);
    if (m.type === 'welcome') Object.assign(h, { id: m.id, x: m.x, z: m.z, seq: m.seq });
    if (m.type === 'pbot') h.replies.push(m);
  });
  h.timer = setInterval(() => {
    if (!h.id) return;
    const [cx, cz] = spot;
    const far = Math.hypot(h.x - cx, h.z - cz) > 8;
    if (far) { const d = Math.hypot(cx - h.x, cz - h.z); h.x += ((cx - h.x) / d) * 0.3; h.z += ((cz - h.z) / d) * 0.3; }
    else { h.a += 0.01; h.x = cx + Math.sin(h.a) * 4; h.z = cz + Math.cos(h.a) * 4; }
    send({ type: 'input', x: +h.x.toFixed(2), z: +h.z.toFixed(2), face: 0, seq: h.seq });
  }, 50);
  h.stop = () => { clearInterval(h.timer); ws.close(); };
  return h;
}

async function run({ humans: N, bots: B, free = 0, named = true, port }) {
  const srv = startServer(port, { NAMED_ENABLED: named ? '1' : '0', MAX_BOTS: String(Math.max(40, B + free + 10)) });
  try {
    await waitUp(port);
    const spot = SPOTS[process.env.SPOT || 'town'] || SPOTS.town;
    const hs = Array.from({ length: N }, (_, i) => human(port, i, spot));
    for (let t = 0; t < 100 && !hs.every(h => h.id); t++) await sleep(100);
    if (!hs.every(h => h.id)) throw new Error('humans did not join');
    for (let k = 0; k < B; k++) { // up to 3 per human
      const h = hs[k % N];
      h.send({ type: 'pbot', op: 'add', cls: CLS[(k + 3) % CLS.length], skill: 5 });
      await sleep(150);
    }
    // free bots: out of any party, so each lives its own day. The Bots tab allows 10 adds per 5 s per player
    // (server/playerbots.js), so they go in slowly, and a refusal ("Slow down a little.") is tried again.
    for (let k = 0, sent = 0, left = free; left > 0 && k < free * 4; k++) {
      const h = hs[k % N];
      h.send({ type: 'pbot', op: 'add', cls: CLS[k % CLS.length], skill: 4, party: false });
      sent++;
      await sleep(Math.ceil(700 / N));
      const done = hs.reduce((a, q) => a + q.replies.filter(m => m.op === 'add' && m.ok).length, 0);
      left = free - done;
      if (sent >= free + left) sent = 0; // (keep going until they are all in)
    }
    const refused = hs.flatMap(h => h.replies.filter(m => m.op === 'add' && m.ok === false).map(m => m.error));
    const got = hs.reduce((a, q) => a + q.replies.filter(m => m.op === 'add' && m.ok).length, 0);
    if (got < free) console.log(`  (only ${got} of ${free} free bots: ${refused.at(-1) || 'no reply'})`);
    await sleep(WARM * 1000);
    const a = await status(port), ta = performance.now();
    await sleep(SECS * 1000);
    const b = await status(port), tb = performance.now();
    const wall = (tb - ta) / 1000;
    const res = {
      humans: N, bots: B, free, named, spot: process.env.SPOT || 'town', extra: process.env.EXTRA || '',
      cpuPerSec: +((b.cpu.s - a.cpu.s) / wall).toFixed(4),
      tickP50: b.tick.p50, tickP95: b.tick.p95, tickMax: b.tick.max,
      bytesPerSec: Math.round((b.bytes.total - a.bytes.total) / wall),
      online: b.online,
    };
    for (const h of hs) h.stop();
    return res;
  } finally {
    if (process.env.PROFILE) { srv.child.kill('SIGINT'); await new Promise(r => { srv.child.once('exit', r); setTimeout(r, 15000); }); } // (lets --cpu-prof write its file)
    srv.child.kill('SIGKILL');
    await sleep(300);
  }
}

const show = r => process.env.JSON ? JSON.stringify(r)
  : `${r.humans} humans + ${r.bots} bots${r.free ? ` + ${r.free} free` : ''}, Named ${r.named ? 'on' : 'off'} (${r.spot}${r.extra ? ', ' + r.extra : ''}): CPU ${r.cpuPerSec.toFixed(3)} s/s · tick p50 ${r.tickP50} ms, p95 ${r.tickP95} ms, max ${r.tickMax} ms · ${(r.bytesPerSec / 1024).toFixed(0)} KB/s serialised · online ${JSON.stringify(r.online)}`;

const named = process.env.NAMED !== '0';
const FREE = (process.env.FREE || '').split(',').filter(Boolean).map(Number);
const runs = FREE.length ? FREE.map(free => ({ humans: Number(process.env.HUMANS) || 2, bots: Number(process.env.BOTS) || 0, free, named }))
  : process.env.HUMANS ? [{ humans: Number(process.env.HUMANS), bots: Number(process.env.BOTS) || 0, free: 0, named }]
  : [{ humans: 2, bots: 0, named: true }, { humans: 2, bots: 6, named: true }, { humans: 4, bots: 9, named: true }];
let port = BASE_PORT;
for (const r of runs) console.log(show(await run({ ...r, port: port++ })));
process.exit(0);
