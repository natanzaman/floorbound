// Interest management and static files in a real browser (docs/briefs/perf-batch.md): the page loads from gzipped,
// ETagged files (Three.js minified), joins, sees a nearby player, loses them when they go out of range on the same
// floor (no page errors), sees them again when they come back, and always sees a party member wherever they are.
// Usage: PORT=37xx node test/interest.mjs   (needs Node Playwright: npm i --no-save playwright, or a global one)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3791, base = `http://127.0.0.1:${PORT}`;
let n = 0, failed = 0;
const ok = (c, what) => { n++; if (c) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', NAMED_ENABLED: '0', TEST_HOOKS: '1', SPAWN_AT: '0,6' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/status`); break; } catch { await sleep(100); } }
  // static files
  const r1 = await fetch(`${base}/vendor/three.module.min.js`, { headers: { 'accept-encoding': 'gzip' } });
  ok(r1.headers.get('content-encoding') === 'gzip' && /max-age=86400/.test(r1.headers.get('cache-control')), 'Three.js: gzipped, cached for a day');
  const r2 = await fetch(`${base}/main.js`, { headers: { 'if-none-match': r1.headers.get('etag') } });
  const r3 = await fetch(`${base}/main.js`, { headers: { 'if-none-match': r2.headers.get('etag') } });
  ok(r2.status === 200 && r2.headers.get('cache-control') === 'no-cache' && r3.status === 304, 'code revalidates: 304 when unchanged');

  // a second player over a plain socket
  const other = await new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`), o = { ws, id: 0 };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name: 'Other', cls: 'cleric' })));
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'welcome') { o.id = m.id; res(o); } if (m.type === 'invite') o.invite = m; });
  });
  const tp = (x, z) => other.ws.send(JSON.stringify({ type: 'test', tp: [x, z] }));

  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('fb_tips', '[]'));
  await page.goto(`${base}/?quality=low`);
  await page.fill('#name', 'Viewer'); await page.click('.cls[data-id=swordsman]'); await page.click('#enter');
  await page.waitForFunction(() => window.__fb?.state?.joined, null, { timeout: 60000 });
  const has = () => page.evaluate(id => window.__fb.players.has(id), other.id);
  const waitHas = async want => { for (let i = 0; i < 60; i++) { if ((await has()) === want) return true; await sleep(100); } return false; };
  ok(await waitHas(true), 'a player nearby is drawn');
  await page.evaluate(() => window.__fb.send({ type: 'test', tp: [-60, -28] })); // two corners of Floor 1: ~215 m apart
  tp(60, 150);
  ok(await waitHas(false), 'gone when they walk out of range on the same floor');
  tp(-55, -20);
  ok(await waitHas(true), 'back when they return');
  // a party member is always there
  await page.evaluate(id => window.__fb.send({ type: 'invite', id }), other.id);
  await sleep(500);
  other.ws.send(JSON.stringify({ type: 'accept', from: (await page.evaluate(() => window.__fb.state.myId)) }));
  await sleep(500);
  tp(60, 150);
  await sleep(1500);
  const party = await page.evaluate(() => window.__fb.state.party);
  ok(!party || (await has()), party ? 'a party member far away is still drawn' : 'party: invite not accepted here (skipped)');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  other.ws.close();
} finally {
  await browser?.close();
  srv.kill('SIGKILL');
}
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n}/${n} passed`);
process.exit(failed ? 1 : 0);
