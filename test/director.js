// The scene director (docs/ROADMAP.md F2): cue sheet parsing and validation, the cue timeline, and a short in-process
// show (an actor walks, says a line, the scene finishes).
// FULL=1 also runs Episode 1 (docs/story/ep1-first-line.yaml) end to end on its own server (no database, PORT default
// 3712, driven through the director's admin routes from localhost) and checks: every scene finished, Bram dead and
// never respawned, Pell landed the Last Attack, the bell rang once, no actor died unscripted.
// Usage: node test/director.js   ·   FULL=1 node test/director.js
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js';
import { Director } from '../server/director.js';
import { parseSheet, validateSheet, Timeline, parseCond, API_NAMES, sayHold } from '../server/director-sheet.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const fmt = p => `s${p.scene}${p.cue ? `.c${p.cue}` : ''}: ${p.msg}`;

// ---------- 1. Episode 1's sheet ----------
console.log('# Episode 1 cue sheet');
const ep1 = fs.readFileSync(path.join(root, 'docs/story/ep1-first-line.yaml'), 'utf8');
const parsed = parseSheet(ep1);
ok(!parsed.error && parsed.sheet.scenes.length === 4, 'ep1 parses (4 scenes)');
const full = validateSheet(parsed.sheet, { has: () => true }); // a server with every F module
for (const e of full.errors) console.log(`    error ${fmt(e)}`);
for (const w of full.warnings) console.log(`    warning ${fmt(w)}`);
ok(full.errors.length === 0, `ep1 validates with no errors (${full.warnings.length} warnings)`);
const g0 = new Game();
const here = validateSheet(parsed.sheet, { has: k => typeof g0[k] === 'function' });
const missing = API_NAMES.filter(k => typeof g0[k] !== 'function');
console.log(`    APIs missing on this checkout: ${missing.join(', ') || 'none'}`);
ok(here.errors.every(e => e.api), 'against this server, the only errors are missing F-module APIs');

// validation catches mistakes, each with its scene and cue
const bad = parseSheet(`
title: Bad
cast:
  - { id: a, name: "Ann", class: swordsman, style: shield, level: 2 }
  - { id: b, name: "Bo", class: wizard }
scenes:
  - id: x
    place: moon
    marks: { a: nowhere, zed: town_square }
    cues:
      - { who: a, do: dance }
      - { who: c, do: walk_to, to: fountain }
      - { who: a, do: fight, target: warden, until: "warden_hp < lots" }
      - { who: a, do: skill, skill: burst }
      - { who: a, do: say, text: "hi", after: later, colour: red }
      - { do: camera, shot: dolly, target: a }
`).sheet;
const vb = validateSheet(bad, { has: k => k !== 'cine' });
const has = (re, sc, cue) => vb.errors.some(e => re.test(e.msg) && (sc === undefined || e.scene === sc) && (cue === undefined || e.cue === cue));
ok(has(/style "shield" belongs to guardian/), 'error: style of another class');
ok(has(/unknown class "wizard"/), 'error: unknown class');
ok(has(/Unknown place "moon"/, 1, 0), 'error: unknown place (scene 1)');
ok(has(/"nowhere" is not a landmark/, 1, 0) && has(/marks: unknown actor "zed"/, 1, 0), 'error: unknown mark landmark and actor');
ok(has(/Unknown verb "dance"/, 1, 1), 'error: unknown verb (scene 1, cue 1)');
ok(has(/unknown actor "c"/, 1, 2), 'error: unknown actor in who (cue 2)');
ok(has(/can't read "warden_hp < lots"/, 1, 3), 'error: unreadable condition (cue 3)');
ok(has(/Burst Combo unlocks at 3/, 1, 4), 'error: skill above the actor\'s level (cue 4)');
ok(has(/no earlier cue with id "later"/, 1, 5), 'error: after an unknown label (cue 5)');
ok(vb.warnings.some(w => /unknown field "colour"/.test(w.msg) && w.cue === 5), 'warning: unknown field');
ok(has(/"dolly" isn't one of/, 1, 6) && vb.errors.some(e => e.api && e.cue === 6), 'error: unknown shot, and camera needs cine (api)');
ok(parseCond('warden_hp < 66%')?.v === 0.66 && parseCond('pell_dead')?.kind === 'dead' && parseCond('t > 12')?.v === 12 && parseCond('gate_open')?.kind === 'gate', 'conditions parse');
ok(Math.abs(sayHold('Every second.') - 2.51) < 0.01 && sayHold('x'.repeat(200)) === 5 && sayHold('') === 2, 'say holds 2-5 s by length');

// the admin routes without a database: localhost only
{
  const { directorAuth } = await import('../server/director-admin.js');
  const db = await import('../server/db.js');
  if (!db.enabled) {
    const req = ip => ({ socket: { remoteAddress: ip }, headers: {} });
    ok(await directorAuth(req('127.0.0.1')) === 0 && await directorAuth(req('::1')) === 0 && await directorAuth(req('10.1.2.3')) === 503, 'no database: the director answers localhost only');
  }
}

// ---------- 2. the timeline ----------
console.log('# Timing rules');
{
  // c0 2 s; c1 together (1 s); c2 after prev (c1); c3 delay 0.5 together with c2; c4 after label "a" (c0) + delay 1
  const cues = [{ id: 'a' }, {}, { after: 'prev' }, { delay: 0.5 }, { after: 'a', delay: 1 }, { after: 'prev' }];
  const dur = [2, 1, 1, 0, 0.5, 0];
  const tl = new Timeline(cues, 0), started = [];
  for (let t = 0; t <= 6 + 1e-9; t = Math.round((t + 0.05) * 100) / 100) {
    tl.step(t, i => started.push([i, t]), i => t - tl.startedAt[i] >= dur[i] - 1e-9);
    if (tl.over) break;
  }
  const at = i => tl.startedAt[i], fin = i => tl.finishedAt[i];
  ok(at(0) === 0 && at(1) === 0, 'a cue starts together with the previous cue');
  ok(at(2) === 1, 'after: prev starts when the previous cue finishes');
  ok(at(3) === 1.5, 'delay waits after the trigger (together + 0.5 s)');
  ok(at(4) === 3, 'after: <label> starts when that cue finishes (+ delay)');
  ok(at(5) === fin(4) && fin(5) === fin(4), 'an instant cue after prev resolves in the same tick');
  ok(tl.over && fin(5) === 3.5 && Math.max(...tl.finishedAt) === 3.5, 'the scene is over when every cue has finished');
}

// ---------- 3. a short in-process show ----------
console.log('# In-process show');
function inProcessServer(game) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: '/ws' });
  const bots = new BotManager(game, { url: () => `ws://127.0.0.1:${server.address().port}/ws` });
  const roster = () => JSON.stringify({ type: 'roster', players: game.roster() });
  wss.on('connection', ws => {
    let p = null;
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (!p) {
        if (msg.type !== 'join' || !bots.isBotJoin(msg)) return;
        p = bots.addBotPlayer(ws, msg);
        ws.send(JSON.stringify({ type: 'welcome', id: p.id, x: p.x, z: p.z, seq: p.posSeq, lvl: p.lvl }));
        for (const o of game.players.values()) o.ws.readyState === 1 && o.ws.send(roster());
        return;
      }
      game.handle(p, msg);
    });
    ws.on('close', () => { if (p && game.players.get(p.id) === p) game.removePlayer(p); });
  });
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(), dt = Math.min(0.2, (now - last) / 1000); last = now;
    game.update(dt);
    const w = game.snapshot();
    for (const p of game.players.values()) if (p.ws.readyState === 1) p.ws.send(`{"type":"snap","me":${JSON.stringify(game.meFor(p))},"w":${w}}`);
  }, 50);
  return { server, bots, listen: () => new Promise(r => server.listen(0, '127.0.0.1', r)), close() { clearInterval(timer); bots.timer && clearInterval(bots.timer); wss.close(); server.close(); } };
}
{
  const game = new Game();
  const S = inProcessServer(game);
  const dir = new Director(game, S.bots);
  await S.listen();
  const chats = [], snap = game.snapshot.bind(game);
  game.snapshot = () => { for (const e of game.events) if (e.t === 'chat') chats.push(e); return snap(); };
  const r = dir.load(`
title: Test
cast:
  - { id: wren, name: "Wren", class: cleric, style: staff, level: 4 }
  - { id: kade, name: "Kade", class: swordsman, style: dual, level: 4, skill: 3 }
scenes:
  - id: one
    place: town
    marks: { wren: fountain, kade: merchant }
    cues:
      - { who: wren, do: walk_to, to: hall_of_clearers, id: walk }
      - { who: kade, do: face, to: wren }
      - { who: wren, do: say, text: "Not one name on this stone.", hold: 1, after: walk }
      - { who: kade, do: run_to, to: wren, after: prev }
      - { do: wait, secs: 0.5, after: prev }
`);
  ok(r.ok && r.scenes.join() === 'one', 'a short sheet loads');
  dir.run({ force: true });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && dir.state !== 'done' && dir.state !== 'error') await sleep(100);
  const st = dir.status();
  if (st.state !== 'done') console.log(st.log.map(l => `    ${l.t} ${l.text}`).join('\n'));
  ok(st.state === 'done', `the show finishes (${st.elapsed} s)`);
  const wren = dir.actors.get('wren').p, kade = dir.actors.get('kade').p;
  ok(wren.name === 'Wren' && wren.cls === 'cleric' && wren.lvl === 4 && kade.lvl === 4 && dir.actors.get('kade').b.skill === 3, 'actors join with their name, class, level and capability');
  ok(kade.inv.eq.weapon?.style === 'dual' && !wren.inv.eq.weapon?.style, 'an actor carries a weapon of its style (the default style: none)');
  ok(wren.party && wren.party === kade.party, 'the cast is one party');
  ok(Math.hypot(wren.x - -5.6, wren.z - 1.9) < 1.5, `Wren walked to the Hall of Clearers (${wren.x.toFixed(1)}, ${wren.z.toFixed(1)})`);
  ok(Math.hypot(kade.x - wren.x, kade.z - wren.z) < 2.6, 'Kade ran to Wren');
  ok(chats.some(e => e.id === wren.id && e.text === 'Not one name on this stone.' && e.ch === 's'), 'Wren said her line (say chat)');
  ok(!chats.some(e => e.id === kade.id || (e.id === wren.id && e.text !== 'Not one name on this stone.')), 'actors never chatter on their own');
  ok(st.checks.scenes.join() === 'one' && st.checks.unscripted.length === 0, 'status: scene finished, no unscripted deaths');
  const said = st.log.findIndex(l => /Wren: Not one name/.test(l.text)), walked = st.log.findIndex(l => /Scene one finished/.test(l.text));
  ok(said > 0 && walked > said, 'the log has the line, then the scene end');
  dir.stop();
  await sleep(300);
  ok(dir.state === 'stopped' && !game.players.has(wren.id) && S.bots.count() === 0, 'stop() removes the actors');
  ok(game.bellAuto !== false, 'stop() gives the automatic bell back');
  // plain bots are untouched by the script layer
  const plain = S.bots.add({ cls: 'guardian', name: 'Plain', lvl: 3, behaviour: 'field' });
  await sleep(1500);
  const pe = S.bots.bots.find(e => e.bid === plain.bid);
  ok(pe.b.script === undefined && !!pe.b.goal && pe.b.goal !== 'joining', `a normal bot plays its own brain (goal: ${pe.b.goal})`);
  S.bots.removeAll();
  S.close();
}

// ---------- 4. FULL=1: Episode 1 end to end on its own server ----------
if (process.env.FULL) {
  console.log('# FULL: Episode 1 end to end');
  const PORT = Number(process.env.PORT) || 3712, BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, PORT: String(PORT) };
  delete env.DATABASE_URL; // no accounts: a blank Hall, and the director's routes answer localhost
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
  const call = async (m, p, body) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  try {
    for (let i = 0; i < 100 && !/running on/.test(out); i++) await sleep(100);
    const sheets = await call('GET', '/api/admin/director/sheets');
    ok(sheets.body.sheets?.includes('ep1-first-line.yaml'), 'the sheet list has ep1');
    const text = (await call('GET', '/api/admin/director/sheets/ep1-first-line.yaml')).body.text;
    const ld = await call('POST', '/api/admin/director/load', { text });
    const apiErr = (ld.body.errors || []).filter(e => e.api), hard = (ld.body.errors || []).filter(e => !e.api);
    ok(ld.status === 200 && hard.length === 0, `ep1 loads on the server (${apiErr.length} cues need a missing module)`);
    const lacking = Object.entries((await call('GET', '/api/admin/director')).body.apis || {}).filter(([, v]) => !v).map(([k]) => k);
    if (lacking.length) console.log(`    NOTE: missing on main: ${lacking.join(', ')}; those cues are skipped (force) and the checks that need them may fail`);
    const run = await call('POST', '/api/admin/director/run', { from: process.env.FULL_FROM || 0, force: true });
    ok(run.status === 200, `run starts (${run.body.error || run.body.state})`);
    let st = null, lastScene = '', t0 = Date.now();
    const limit = Number(process.env.FULL_SECS || 600) * 1000;
    while (Date.now() - t0 < limit) {
      st = (await call('GET', '/api/admin/director')).body;
      if (st.scene && st.scene.id !== lastScene) { lastScene = st.scene.id; console.log(`    scene ${lastScene} at ${st.elapsed}s`); }
      if (process.env.FULL_LOG && st.bosses?.length && Math.round(st.elapsed) % 10 === 0) console.log(`    ${st.elapsed}s ${st.bosses.map(b => `${b.id} ${Math.round(b.hp / b.maxHp * 100)}% posture ${b.posture}%${b.broken ? ' BROKEN' : ''}`).join(' ')} | ${st.actors.map(a => `${a.id} ${a.maxHp ? Math.round(a.hp / a.maxHp * 100) : 0}% ${a.doing}`).join(', ')}`);
      if (['done', 'error', 'stopped'].includes(st.state)) break;
      await sleep(1000);
    }
    if (process.env.FULL_LOG || st?.state !== 'done') console.log((st?.log || []).map(l => `    ${l.t} [${l.scene}] ${l.text}`).join('\n'));
    const c = st?.checks || {};
    ok(st?.state === 'done', `the episode finishes (${st?.state}, ${st?.elapsed} s)`);
    ok((c.scenes || []).join() === 's1,s2,s3,s4', `every scene finished (${(c.scenes || []).join(',')})`);
    const bram = st?.actors?.find(a => a.id === 'bram');
    ok(!!bram?.dead && (c.deaths || []).filter(d => d.id === 'bram').length === 1, 'Bram is dead and never respawned');
    ok(c.lastAttack?.id === 'pell', `Pell landed the Last Attack (${c.lastAttack?.name || 'none'})`);
    ok(c.bells === 1, `the bell rang once (${c.bells})`);
    ok((c.unscripted || []).length === 0, `no actor died unscripted (${(c.unscripted || []).join(', ') || 'none'})`);
    const names = c.clearNames || [];
    ok(['Corvin', 'Bram', 'Tamsin', 'Juno', 'Pell'].every(x => names.includes(x)), `the clear counts all five, Bram included (${names.join(', ')})`);
    const sp = await call('POST', '/api/admin/director/stop');
    ok(sp.body.state === 'stopped' && sp.body.actors.length === 0, 'Stop sends the actors home');
  } finally { srv.kill(); }
}

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
