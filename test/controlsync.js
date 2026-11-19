// Controls that follow the account (roadmap K2): the accounts.settings migration (safe twice), saving and loading
// fb_controls (cleaned, `v`, 8 KB cap) directly and over GET / PUT /api/settings, and the login rule (syncPlan).
// Starts its own server on PORT (default 37201) against DATABASE_URL (required; never production).
// Usage: DATABASE_URL=postgresql://localhost/fb_controlsui node test/controlsync.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = process.env.DATABASE_URL;
if (!DB) { console.log('skipped: set DATABASE_URL to run the controls sync tests'); process.exit(0); }
const PORT = Number(process.env.PORT) || 37201, BASE = `http://localhost:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await import('../server/db.js');
const accounts = await import('../server/accounts.js');
const { syncPlan, loadBindings, CONTROLS_MAX_BYTES } = await import('../shared/controls.js');

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, token, body, raw) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let srv, browser;
try {
  // ---- migration, twice ----
  await db.migrate(); await db.migrate();
  assert.ok(db.enabled, 'the database stayed on after migrating twice');
  const cols = await db.q(`SELECT data_type FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'settings'`);
  assert.deepEqual(cols, [{ data_type: 'jsonb' }]);
  ok('migration adds accounts.settings (JSONB) and is safe to run twice');

  // ---- save / load directly ----
  const [{ id }] = await db.q('INSERT INTO accounts DEFAULT VALUES RETURNING id');
  assert.equal(await accounts.loadSettings(id), null, 'nothing saved yet');
  const mine = { v: 1, kbm: { jump: ['KeyB', null], nope: ['KeyX', null] }, pad: { jump: ['B', null] }, access: { sens: 1.5, invertY: true }, device: 'pad' };
  assert.deepEqual(await accounts.storeSettings(id, mine), { ok: true, settings: { v: 1, kbm: { jump: ['KeyB', null] }, pad: { jump: ['B', null] }, access: { sens: 1.5, invertY: true } } });
  assert.deepEqual(await accounts.loadSettings(id), { v: 1, kbm: { jump: ['KeyB', null] }, pad: { jump: ['B', null] }, access: { sens: 1.5, invertY: true } }, 'unknown ids and local-only keys dropped');
  assert.equal((await accounts.storeSettings(id, { kbm: {} })).code, 400, 'no v: refused');
  assert.equal((await accounts.storeSettings(id, [1])).code, 400, 'not an object: refused');
  const big = { v: 1, kbm: {}, junk: 'x'.repeat(CONTROLS_MAX_BYTES) };
  assert.equal((await accounts.storeSettings(id, big)).code, 413, 'over 8 KB: refused');
  assert.deepEqual((await accounts.loadSettings(id)).kbm, { jump: ['KeyB', null] }, 'a refused save leaves the old copy');
  ok('storeSettings / loadSettings: cleaned, needs v, 8 KB cap, refusals change nothing');

  // ---- the routes ----
  srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), NAMED_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost:\d+/.test(d) && res()); srv.on('exit', rej); setTimeout(res, 8000); });
  assert.equal((await call('GET', '/api/settings')).status, 401, 'signed out: 401');
  const { token } = (await call('POST', '/api/guest')).body;
  assert.ok(token);
  assert.deepEqual((await call('GET', '/api/settings', token)).body, { settings: null }, 'a new account has no copy');
  // login with no account copy: this browser's goes up
  const local = { v: 1, kbm: { jump: ['KeyB', null], gone: ['KeyQ', null] } };
  let plan = syncPlan(local, (await call('GET', '/api/settings', token)).body.settings);
  assert.equal(plan.use, null);
  assert.equal((await call('PUT', '/api/settings', token, { settings: plan.upload })).status, 200);
  assert.deepEqual((await call('GET', '/api/settings', token)).body.settings, { v: 1, kbm: { jump: ['KeyB', null] } }, 'uploaded, unknown ids dropped');
  // another browser logs in: the account copy wins over its own
  plan = syncPlan({ v: 1, kbm: { jump: ['KeyN', null] } }, (await call('GET', '/api/settings', token)).body.settings);
  assert.deepEqual(plan, { use: { v: 1, kbm: { jump: ['KeyB', null] } }, upload: null }, 'server copy wins');
  assert.equal(loadBindings('kbm', plan.use.kbm).jump[0], 'KeyB');
  // a later change uploads and replaces it
  assert.equal((await call('PUT', '/api/settings', token, { settings: { v: 1, kbm: { jump: ['KeyM', null] }, access: { sens: 2 } } })).status, 200);
  assert.deepEqual((await call('GET', '/api/settings', token)).body.settings, { v: 1, kbm: { jump: ['KeyM', null] }, access: { sens: 2 } });
  // refusals
  assert.equal((await call('PUT', '/api/settings', token, { settings: big })).status, 413, 'over 8 KB: 413');
  assert.equal((await call('PUT', '/api/settings', token, null, JSON.stringify({ settings: big, pad: 'y'.repeat(40000) }))).status, 413, 'a huge body: 413');
  assert.equal((await call('PUT', '/api/settings', token, { settings: { kbm: {} } })).status, 400, 'no v: 400');
  assert.equal((await call('PUT', '/api/settings', 'not-a-real-token', { settings: { v: 1 } })).status, 401, 'bad token: 401');
  assert.equal((await call('POST', '/api/settings', token, { settings: { v: 1 } })).status, 405, 'only GET and PUT');
  assert.deepEqual((await call('GET', '/api/settings', token)).body.settings.kbm, { jump: ['KeyM', null] }, 'refusals leave the copy alone');
  ok('GET / PUT /api/settings: signed in only, login rule (local uploads, then the account copy wins), 8 KB cap, v required');

  // ---- in the browser (public/controlsync.js): on sign-in the account copy replaces this browser's and takes effect;
  // a later rebind uploads. (Skipped without Playwright.)
  let chromium = null;
  try { ({ chromium } = await import(process.env.PLAYWRIGHT || 'playwright')); } catch {}
  if (chromium) {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
    const p = await browser.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(t => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('fb_session', t); localStorage.setItem('fb_controls', JSON.stringify({ v: 1, kbm: { jump: ['KeyN', null] } })); } }, token);
    await p.goto(`${BASE}/?quality=low`);
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('fb_controls')).kbm.jump?.[0] === 'KeyM', null, { timeout: 30000 });
    assert.equal(await p.evaluate(() => window.__fb?.input.bindings('kbm').jump[0]), 'KeyM', 'the account copy is in force');
    assert.equal(await p.evaluate(() => window.__fb.input.label('jump')), 'M');
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyH'));
    const until = Date.now() + 5000; let got;
    while (Date.now() < until) { got = (await call('GET', '/api/settings', token)).body.settings; if (got.kbm.jump[0] === 'KeyH') break; await sleep(200); }
    assert.equal(got.kbm.jump[0], 'KeyH', 'a rebind uploads');
    assert.equal(got.access?.sens, 2, 'with the rest of fb_controls');
    assert.deepEqual(errors, []);
    ok('browser: on sign-in the account copy wins and takes effect; a later rebind uploads');
  } else console.log('  (browser part skipped: no Playwright)');

  await db.q('DELETE FROM accounts WHERE id = $1', [id]);
  console.log(`controlsync: all ${n} checks passed`);
} catch (e) {
  console.error('NOT OK:', e); process.exitCode = 1;
} finally {
  await browser?.close(); srv?.kill(); await sleep(100);
  process.exit(process.exitCode || 0);
}
