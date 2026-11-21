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
  { const r = await accounts.storeSettings(id, mine); assert.ok(Math.abs(r.at - Date.now()) < 5000, 'stamped now'); delete r.at;
    assert.deepEqual(r, { ok: true, settings: { v: 1, kbm: { jump: ['KeyB', null] }, pad: { jump: ['B', null] }, access: { sens: 1.5, invertY: true } } }); }
  assert.deepEqual(await accounts.loadSettings(id), { v: 1, kbm: { jump: ['KeyB', null] }, pad: { jump: ['B', null] }, access: { sens: 1.5, invertY: true } }, 'unknown ids and local-only keys dropped');
  assert.equal((await accounts.storeSettings(id, { kbm: {} })).code, 400, 'no v: refused');
  assert.equal((await accounts.storeSettings(id, [1])).code, 400, 'not an object: refused');
  const big = { v: 1, kbm: {}, junk: 'x'.repeat(CONTROLS_MAX_BYTES) };
  assert.equal((await accounts.storeSettings(id, big)).code, 413, 'over 8 KB: refused');
  assert.deepEqual((await accounts.loadSettings(id)).kbm, { jump: ['KeyB', null] }, 'a refused save leaves the old copy');
  ok('storeSettings / loadSettings: cleaned, needs v, 8 KB cap, refusals change nothing');

  // ---- newest change wins (a server timestamp): an older change that arrives late is refused with the newer copy ----
  const cols2 = await db.q(`SELECT data_type FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'settings_at'`);
  assert.deepEqual(cols2, [{ data_type: 'bigint' }]);
  { const t0 = Date.now();
    await db.q('UPDATE accounts SET settings_at = $2 WHERE id = $1', [id, t0 - 10000]); // (the copy above: made 10 s ago)
    assert.equal((await accounts.storeSettings(id, { v: 1, kbm: { jump: ['KeyC', null] } }, t0 - 1000)).ok, true, 'a change older than now, newer than the copy: saved');
    const late = await accounts.storeSettings(id, { v: 1, kbm: { jump: ['KeyD', null] } }, t0 - 5000);
    assert.equal(late.code, 409, 'an older change: 409');
    assert.deepEqual(late.settings.kbm, { jump: ['KeyC', null] }, 'with the newer copy'); assert.equal(late.at, t0 - 1000);
    assert.deepEqual((await accounts.loadSettings(id)).kbm, { jump: ['KeyC', null] }, 'and changes nothing');
    const fut = await accounts.storeSettings(id, { v: 1, kbm: { jump: ['KeyE', null] } }, t0 + 3600e3);
    assert.ok(fut.ok && fut.at <= Date.now(), 'a change from the future counts as now');
    assert.ok((await accounts.storeSettings(id, { v: 1, kbm: { jump: ['KeyF', null] } })).ok, 'no stamp (an older page): saved as now');
    assert.deepEqual((await accounts.loadSettings(id)).kbm, { jump: ['KeyF', null] }); }
  ok('storeSettings: stamped with when the change was made; an older change is refused (409) with the newer copy');

  // ---- the routes ----
  srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), NAMED_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost:\d+/.test(d) && res()); srv.on('exit', rej); setTimeout(res, 8000); });
  assert.equal((await call('GET', '/api/settings')).status, 401, 'signed out: 401');
  const { token } = (await call('POST', '/api/guest')).body;
  assert.ok(token);
  assert.deepEqual({ ...(await call('GET', '/api/settings', token)).body, now: 0 }, { settings: null, at: 0, now: 0 }, 'a new account has no copy');
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
  { const g = (await call('GET', '/api/settings', token)).body;
    assert.ok(g.at > 0 && Math.abs(g.now - Date.now()) < 5000, 'GET answers the copy\'s stamp and the server\'s clock');
    const late = await call('PUT', '/api/settings', token, { settings: { v: 1, kbm: { jump: ['KeyO', null] } }, at: g.at - 1 });
    assert.equal(late.status, 409); assert.deepEqual(late.body.settings.kbm, { jump: ['KeyM', null] }); assert.equal(late.body.at, g.at);
    const put = await call('PUT', '/api/settings', token, { settings: g.settings, at: g.now });
    assert.equal(put.status, 200); assert.ok(put.body.at >= g.at && put.body.now > 0); }
  ok('GET / PUT /api/settings: stamps; an older change gets 409 and the newer copy');

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

    // ---- hard review finding 1: a change this browser made is never lost to the account copy ----
    const jumpLocal = () => p.evaluate(() => JSON.parse(localStorage.getItem('fb_controls')).kbm.jump?.[0]);
    const jumpLive = () => p.evaluate(() => window.__fb?.input.bindings('kbm').jump[0]);
    async function serverJump(want, ms = 8000, t = token) {
      const end = Date.now() + ms; let j;
      while (Date.now() < end) { j = (await call('GET', '/api/settings', t)).body.settings?.kbm?.jump?.[0]; if (j === want) return j; await sleep(150); }
      return j;
    }
    const ready = () => p.waitForFunction(() => window.__fb?.input && !document.getElementById('enter').disabled, null, { timeout: 30000 });
    // (a) a rebind, then a reload before the debounced upload fires
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyU'));
    await p.reload(); await ready();
    assert.equal(await serverJump('KeyU'), 'KeyU', 'a rebind just before a reload reaches the server');
    await sleep(1500);
    assert.equal(await jumpLocal(), 'KeyU', 'and is still this browser\'s binding after the reload');
    assert.equal(await jumpLive(), 'KeyU');
    ok('browser: rebind then an immediate reload keeps the binding, and it reaches the server');
    // (b) the sign-in GET fails once: a rebind made meanwhile survives a reload and reaches the server
    let failed = 0;
    await p.route('**/api/settings', r => (r.request().method() === 'GET' && !failed++ ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }) : r.continue()));
    await p.reload(); await ready();
    for (let end = Date.now() + 15000; !failed && Date.now() < end;) await sleep(50);
    assert.equal(failed >= 1, true, 'the first GET /api/settings failed');
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyV'));
    await sleep(200);
    await p.reload(); await ready();
    assert.equal(await serverJump('KeyV'), 'KeyV', 'the rebind reaches the server');
    await sleep(1500);
    assert.equal(await jumpLocal(), 'KeyV', 'the rebind is kept after the reload');
    assert.equal(await jumpLive(), 'KeyV');
    await p.unroute('**/api/settings');
    ok('browser: the sign-in GET fails once, a rebind, a reload: the rebind is kept and uploaded');
    // (d) the sign-in GET fails once and is retried, so later rebinds still upload in that session; (e) a failed PUT
    // (a deploy restart) is retried
    let getFails = 0, putFails = 0;
    await p.route('**/api/settings', r => {
      const m = r.request().method();
      if (m === 'GET' && !getFails++) return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      if (m === 'PUT' && putFails < 1 && JSON.parse(r.request().postData()).settings.kbm.jump[0] === 'KeyW') { putFails++; return r.abort('connectionreset'); }
      return r.continue();
    });
    await p.reload(); await ready();
    for (let end = Date.now() + 15000; !getFails && Date.now() < end;) await sleep(50);
    await sleep(2500); // (the retried GET has answered)
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyT'));
    assert.equal(await serverJump('KeyT'), 'KeyT', 'after a retried sign-in GET, a rebind uploads');
    ok('browser: a failed sign-in GET is retried, so the session still uploads rebinds');
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyW'));
    assert.equal(await serverJump('KeyW'), 'KeyW', 'a failed upload is retried');
    assert.equal(putFails, 1, 'the first upload failed');
    await p.unroute('**/api/settings');
    ok('browser: a failed upload is retried with backoff');
    // (c) a second login (loadMe again, here: creating a character) does not revert a change still waiting to upload
    await sleep(1500); // (the login after that reload has finished)
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyY'));
    await p.evaluate(() => { document.getElementById('name').value = 'Syncer'; document.getElementById('enter').click(); });
    assert.equal(await serverJump('KeyY'), 'KeyY', 'the pending change reaches the server');
    await sleep(1500);
    assert.equal(await jumpLocal(), 'KeyY', 'a second login does not revert the pending change');
    assert.equal(await jumpLive(), 'KeyY');
    assert.deepEqual(errors, []);
    ok('browser: a second login (loadMe again) flushes a pending change instead of reverting it');

    // ---- fix re-check: the unsynced flag belongs to an account; a change refused for good does not block syncing ----
    const jumpOf = async t => (await call('GET', '/api/settings', t)).body.settings?.kbm?.jump?.[0];
    const flagNow = () => p.evaluate(() => localStorage.getItem('fb_controls_unsynced'));
    // (localStorage seeded on the next load, before the game's scripts run)
    await p.addInitScript(() => { const s = sessionStorage.getItem('fb_test_seed'); if (s) { sessionStorage.removeItem('fb_test_seed'); for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); } });
    const seedReload = async kv => { await p.evaluate(s => sessionStorage.setItem('fb_test_seed', s), JSON.stringify(kv)); await p.reload(); await ready(); };
    const { token: tokB } = (await call('POST', '/api/guest')).body;
    assert.equal((await call('PUT', '/api/settings', tokB, { settings: { v: 1, kbm: { jump: ['KeyJ', null] } } })).status, 200);
    // (f) signed in as A, a rebind the server refuses leaves the flag; then B signs in in this browser. (A real refusal,
    // 413 for fb_controls past the 8 KB cap, not a route: the pagehide keepalive PUT is not routed.)
    const bloat = () => p.evaluate(n => { const c = JSON.parse(localStorage.getItem('fb_controls')); c.junk = 'x'.repeat(n); localStorage.setItem('fb_controls', JSON.stringify(c)); }, CONTROLS_MAX_BYTES);
    await bloat();
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyU'));
    await sleep(1500);
    assert.ok(await flagNow(), 'the refused change is flagged');
    await seedReload({ fb_session: tokB, fb_controls: JSON.stringify({ v: 1, kbm: { jump: ['KeyU', null] } }) }); // (A's change, minus the bloat)
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('fb_controls')).kbm.jump?.[0] === 'KeyJ', null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    assert.equal(await jumpOf(tokB), 'KeyJ', "B's saved copy is not overwritten by A's change");
    assert.equal(await jumpOf(token), 'KeyY', "and B's copy never goes to A");
    assert.equal(await jumpLocal(), 'KeyJ', "this browser takes B's copy");
    assert.equal(await jumpLive(), 'KeyJ');
    assert.equal(await flagNow(), null, "A's flag is dropped");
    ok("browser: an account switch never uploads the last account's unsynced change; the new account's copy wins");
    // (g) a change made with B's token before /api/me answered ('?') is B's: it goes up (local wins)
    await seedReload({ fb_controls: JSON.stringify({ v: 1, kbm: { jump: ['KeyP', null] } }), fb_controls_unsynced: '?' });
    assert.equal(await serverJump('KeyP', 8000, tokB), 'KeyP', "a '?' change uploads to the signed-in account");
    await sleep(500);
    assert.equal(await jumpLocal(), 'KeyP'); assert.equal(await jumpLive(), 'KeyP');
    assert.equal(await flagNow(), null);
    ok("browser: a change flagged '?' belongs to the stored token's account and is uploaded");
    // (h) the server refuses a change for good (413, as in (f)): at the next login it is dropped and the account copy
    // applies
    await bloat();
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyQ'));
    await sleep(1500);
    assert.ok(await flagNow(), 'the refused change is flagged');
    await p.reload(); await ready();
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('fb_controls')).kbm.jump?.[0] === 'KeyP', null, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    assert.equal(await jumpLocal(), 'KeyP', 'the account copy applies'); assert.equal(await jumpLive(), 'KeyP');
    assert.equal(await flagNow(), null, 'the flag is gone');
    await p.evaluate(() => window.__fb.input.setBinding('kbm', 'jump', 0, 'KeyR'));
    assert.equal(await serverJump('KeyR', 8000, tokB), 'KeyR', 'a later rebind uploads (live)');
    assert.deepEqual(errors, []);
    ok('browser: a change refused for good (413) is dropped at login; the account copy applies and syncing goes on');
    // (i) newest change wins (NEXT.md follow-up): a rebind in this tab never reached the server (closed within the
    // debounce), another browser then changes the account's copy, and this tab comes back: the other browser's later
    // change stays and this tab takes it. The converse: a waiting change made after the other browser's still goes up.
    await sleep(1500); // (the live rebind above is saved; nothing waiting)
    const tB = Date.now();
    assert.equal((await call('PUT', '/api/settings', tokB, { settings: { v: 1, kbm: { jump: ['KeyL', null] } }, at: tB })).status, 200);
    await seedReload({ fb_controls: JSON.stringify({ v: 1, kbm: { jump: ['KeyK', null] } }), fb_controls_unsynced: '?', fb_controls_at: String(tB - 30000) });
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('fb_controls')).kbm.jump?.[0] === 'KeyL', null, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    assert.equal(await jumpOf(tokB), 'KeyL', "the other browser's later change is kept");
    assert.equal(await jumpLocal(), 'KeyL', 'this tab takes it'); assert.equal(await jumpLive(), 'KeyL');
    assert.equal(await flagNow(), null, 'and its older change is dropped');
    await seedReload({ fb_controls: JSON.stringify({ v: 1, kbm: { jump: ['KeyK', null] } }), fb_controls_unsynced: '?', fb_controls_at: String(Date.now()) });
    assert.equal(await serverJump('KeyK', 8000, tokB), 'KeyK', 'a waiting change newer than the account copy still uploads');
    await sleep(500);
    assert.equal(await jumpLocal(), 'KeyK'); assert.equal(await flagNow(), null);
    assert.deepEqual(errors, []);
    ok('browser: newest change wins: an older waiting change never replaces another browser\'s later one; a newer one goes up');
  } else console.log('  (browser part skipped: no Playwright)');

  // ---- review fixes: prototype names and odd binding strings are never stored; the body cap is the 8 KB cap (+512) ----
  const protoBody = '{"settings":{"v":1,"kbm":{"constructor":["KeyX",null],"toString":["KeyY",null],"__proto__":["KeyZ",null],"jump":["KeyB",null]},"pad":{"constructor":["A",null]}}}';
  assert.equal((await call('PUT', '/api/settings', token, null, protoBody)).status, 200);
  assert.deepEqual((await call('GET', '/api/settings', token)).body.settings, { v: 1, kbm: { jump: ['KeyB', null] }, pad: {} }, 'prototype names dropped');
  assert.equal((await call('PUT', '/api/settings', token, { settings: { v: 1, kbm: { jump: ['<img src=x>', 'KeyJ'] } } })).status, 200);
  assert.deepEqual((await call('GET', '/api/settings', token)).body.settings.kbm, { jump: [null, 'KeyJ'] }, "a binding with '<' is dropped");
  const padded = JSON.stringify({ settings: { v: 1 }, pad: 'y'.repeat(CONTROLS_MAX_BYTES + 600) });
  assert.equal((await call('PUT', '/api/settings', token, null, padded)).status, 413, 'a body over the cap + 512 is refused before parsing');
  assert.deepEqual((await call('GET', '/api/settings', token)).body.settings.kbm, { jump: [null, 'KeyJ'] }, 'and changes nothing');
  ok('PUT /api/settings: prototype names and bindings with odd characters are dropped; the body is capped at 8 KB + 512');

  await db.q('DELETE FROM accounts WHERE id = $1', [id]);
  console.log(`controlsync: all ${n} checks passed`);
} catch (e) {
  console.error('NOT OK:', e); process.exitCode = 1;
} finally {
  await browser?.close(); srv?.kill(); await sleep(100);
  process.exit(process.exitCode || 0);
}
