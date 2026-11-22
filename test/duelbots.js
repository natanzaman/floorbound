// Duels between real bot brains on a real server (docs/briefs/duels.md): the bots read w.du, attack only their
// opponents' stand-ins, and the duel ends with a result. Pairs (solo) and a 2 v 2 team duel; prints how long each
// took, for tuning DUEL.pvp and the clock.
// Usage: node test/duelbots.js   (PORT=37xx, PAIRS=swordsman:guardian,ranger:cleric, RULE=half, SKILL=4)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createBot } from '../shared/bots/brain.js';
import { startTeam } from '../shared/teambots.js';
import { readDuels } from '../shared/duels.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3787, URL = `ws://localhost:${PORT}/ws`;
const RULE = process.env.RULE || 'half', SKILL = Number(process.env.SKILL) || 4;
const PAIRS = (process.env.PAIRS || 'swordsman:guardian,ranger:cleric,berserker:lancer,bard:swordsman').split(',').map(s => s.split(':'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
async function until(fn, ms, what) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`timed out: ${what}`); }

const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), START_LEVEL: '12', SPAWN_AT: '0,62', DATABASE_URL: '', NAMED_ENABLED: '0', SERVER_BOTS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const stop = () => { try { srv.kill(); } catch {} };
process.on('exit', stop);
await until(() => log.includes('running on'), 15000, 'server up');

// watch one bot's snapshots for the duel it's in
function watch(b) {
  const w = { duel: null, seen: false, end: null };
  b.ws.addEventListener('message', ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== 'snap' && !msg.w) return;
    for (const d of readDuels(msg.w?.du)) if (d.fighters.some(f => f.id === b.id)) { w.duel = d; w.seen = true; if (d.state === 2) w.end ||= d; }
  });
  return w;
}

async function solo(c1, c2) {
  const a = createBot({ url: URL, WebSocket, cls: c1, name: `D${c1.slice(0, 5)}A`, behaviour: 'follow', follow: '', skill: SKILL });
  const b = createBot({ url: URL, WebSocket, cls: c2, name: `D${c2.slice(0, 5)}B`, behaviour: 'follow', follow: '', skill: SKILL });
  await until(() => a.id && b.id && a.me && b.me, 10000, 'bots in');
  const w = watch(a);
  const t0 = Date.now();
  a.send({ type: 'duel', op: 'ask', id: b.id, rule: RULE });
  await sleep(300);
  b.send({ type: 'duel', op: 'accept' });
  await until(() => w.seen, 5000, 'duel started');
  const end = await until(() => w.end, 150000, 'duel over').catch(() => null);
  const secs = Math.round((Date.now() - t0) / 1000);
  ok(!!end, `${c1} vs ${c2} (${RULE}): ${end ? (end.won < 0 ? 'draw' : `${end.won ? c2 : c1} won`) : 'no result'} in ${secs} s`);
  if (end) ok(end.fighters.some(f => f.out) || secs > 100, `${c1} vs ${c2}: someone was beaten (not just the clock)`);
  ok(!a.dead && !b.dead, `${c1} vs ${c2}: nobody died`);
  a.stop(); b.stop();
  await sleep(500);
}

for (const [c1, c2] of PAIRS) await solo(c1, c2);

// 2 v 2: two parties, the whole of each
{
  const A = startTeam({ url: URL, WebSocket, roles: ['guardian', 'swordsman'], suffix: 'A', behaviour: 'follow', skill: SKILL });
  const B = startTeam({ url: URL, WebSocket, roles: ['cleric', 'berserker'], suffix: 'B', behaviour: 'follow', skill: SKILL });
  const all = [...A.team, ...B.team];
  await until(() => all.every(b => b.id && b.party) && A.team[0].party !== B.team[0].party, 15000, 'two parties');
  const w = watch(A.team[0]);
  const t0 = Date.now();
  A.team[0].send({ type: 'duel', op: 'ask', id: B.team[0].id, rule: RULE, team: 1 });
  await sleep(300);
  B.team[0].send({ type: 'duel', op: 'accept' });
  await until(() => w.seen, 5000, 'team duel started');
  ok(w.duel.fighters.length === 4, 'team duel: all four fighters in');
  const end = await until(() => w.end, 200000, 'team duel over').catch(() => null);
  ok(!!end, `2 v 2 (${RULE}): ${end ? (end.won < 0 ? 'draw' : `side ${end.won ? 'B' : 'A'} won`) : 'no result'} in ${Math.round((Date.now() - t0) / 1000)} s`);
  ok(all.every(b => !b.dead), '2 v 2: nobody died');
  A.stop(); B.stop();
}

stop();
console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
