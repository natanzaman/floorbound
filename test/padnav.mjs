// Controller menu navigation (public/focusnav.js, roadmap K1b) in a real browser with a fake standard pad.
// Character select by pad (d-pad to a class, A picks it, A on Enter joins), the Game Menu (Start opens it, the d-pad
// moves, A opens Settings, Right moves the slider, B backs out to the menu with the focus back on Settings, Start
// closes it), the Bag and the Skill Tree (navigable, B closes, Start closes the Skill Tree), the MVP card (A / B
// close it), and the keyboard & mouse device leaves the menus alone. Needs Playwright for Node (see test/keys.mjs).
// Usage: PORT=371xx node test/padnav.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const PORT = +(process.env.PORT || 37120), base = `http://localhost:${PORT}`;
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Start: 9, L3: 10, R3: 11, Up: 12, Down: 13, Left: 14, Right: 15 };

const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', START_LEVEL: '10', SPAWN_AT: '0,150', TEST_HOOKS: '1', NAMED_ENABLED: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
try {
  await new Promise((res, rej) => { srv.stdout.on('data', d => /listening|localhost:\d+/i.test(d) && res()); srv.on('exit', rej); setTimeout(res, 4000); });
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = { on: false, pad };
    navigator.getGamepads = () => [window.__pad.on ? pad : null, null, null, null];
  });
  await p.goto(`${base}/?quality=low`);
  await p.waitForFunction(() => window.__fb?.input && !document.getElementById('enter').disabled, null, { timeout: 60000 });

  // ---- helpers: presses are held for N polled frames (__fb.input.frames); d-pad taps are one frame (no repeat) ----
  const S = (fn, arg) => p.evaluate(fn, arg);
  const frames = k => S(k => new Promise(r => { const end = window.__fb.input.frames + k; const f = () => (window.__fb.input.frames >= end ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), k);
  const btn = (name, down) => S(([i, d]) => { const b = window.__pad.pad.buttons[i]; b.pressed = d; b.value = d ? 1 : 0; }, [BTN[name], down]);
  const press = async (names, k = 1) => { for (const nm of names) await btn(nm, true); await frames(k); for (const nm of [...names].reverse()) await btn(nm, false); await frames(2); };
  const cur = () => S(() => window.__fb.nav.current());
  const ring = () => S(() => [...document.querySelectorAll('.nav-focus')].length);
  const isOpen = id => S(id => window.__fb.panels.isOpen(id), id);
  async function goTo(key, dir = 'Down', max = 30) { // d-pad until the focus is on key
    for (let i = 0; i < max; i++) { if ((await cur()).key === key) return; await press([dir]); }
    assert.equal((await cur()).key, key, `reached ${key} with ${dir}`);
  }

  // ---- character select by pad ----
  await S(() => { window.__pad.on = true; const e = new Event('gamepadconnected'); e.gamepad = window.__pad.pad; dispatchEvent(e); });
  await frames(2);
  await press(['A'], 2); // (answers "Controller detected": switch)
  assert.equal(await S(() => window.__fb.input.device), 'pad');
  await frames(2);
  assert.equal((await cur()).layer, 'login', 'character select is driven by the pad');
  assert.equal(await ring(), 1, 'one focus ring');
  assert.equal((await cur()).key, '#name', 'the focus starts at the top: the name field');
  await press(['Down']);
  assert.equal((await cur()).key, 'BUTTON?id=guardian', 'down: the class card straight below (the middle one)');
  await goTo('BUTTON?id=swordsman', 'Left');
  await goTo('BUTTON?id=guardian', 'Right');
  { const before = await cur(); await press(['A']); assert.equal((await cur()).key, before.key, 'the focus stays on the card after it re-renders'); }
  assert.ok(await S(() => document.querySelector('.cls[data-id=guardian]').classList.contains('sel')), 'A picks the class');
  await S(() => { document.getElementById('name').value = 'Padnav'; });
  await goTo('#enter');
  await press(['A']);
  await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  assert.equal(await S(() => window.__fb.state.cls), 'guardian');
  await frames(2);
  assert.equal((await cur()).layer, null, 'nothing to navigate in play');
  ok('character select: d-pad to a class, A picks it (focus kept), A on Enter joins');

  // ---- the Game Menu → Settings → back ----
  await press(['Start'], 2);
  assert.ok(await isOpen('gamemenu'), 'Start opens the Game Menu');
  assert.deepEqual(await cur(), { layer: 'gamemenu', key: 'BUTTON?a=resume' }, 'focus starts on Resume');
  const x0 = await S(() => window.__fb.state.x);
  await press(['Down']);
  assert.equal((await cur()).key, 'BUTTON?a=settings', 'd-pad down: Settings');
  await press(['Up']); await press(['Down']);
  assert.equal((await cur()).key, 'BUTTON?a=settings');
  await S(() => { window.__pad.pad.axes = [0, 1, 0, 0]; }); await frames(2); await S(() => { window.__pad.pad.axes = [0, 0, 0, 0]; }); await frames(2);
  assert.equal((await cur()).key, 'BUTTON?a=controls', 'the left stick moves the focus too');
  assert.equal(await S(() => window.__fb.state.x), x0, 'and does not walk');
  await press(['Up']);
  await press(['A']);
  assert.ok(await isOpen('settings') && !(await isOpen('gamemenu')), 'A opens Settings');
  assert.equal((await cur()).layer, 'settings');
  await goTo('INPUT?a=sens');
  const sens0 = await S(() => +document.querySelector('#settings [data-a=sens]').value);
  await press(['Right']);
  assert.equal((await cur()).key, 'INPUT?a=sens', 'Right on a slider keeps the focus');
  assert.ok(Math.abs(await S(() => +document.querySelector('#settings [data-a=sens]').value) - (sens0 + 0.1)) < 1e-6, 'and moves the slider');
  assert.ok(Math.abs(await S(() => JSON.parse(localStorage.getItem('fb_controls')).access.sens) - (sens0 + 0.1)) < 1e-6, 'which saves');
  await press(['Left']);
  await press(['B']);
  assert.ok(!(await isOpen('settings')), 'B closes Settings');
  assert.ok(await isOpen('gamemenu'), 'and goes back to the Game Menu');
  assert.deepEqual(await cur(), { layer: 'gamemenu', key: 'BUTTON?a=settings' }, 'focus restored on Settings');
  await p.waitForTimeout(450);
  await press(['Start'], 2);
  assert.ok(!(await isOpen('gamemenu')), 'Start closes the Game Menu');
  await press(['Start'], 2); await p.waitForTimeout(450);
  assert.equal((await cur()).key, 'BUTTON?a=settings', 'reopened: the focus comes back where it was');
  await press(['B']);
  assert.ok(!(await isOpen('gamemenu')), 'B on the Game Menu closes it');
  ok('Game Menu: Start, d-pad / stick move (no walking), A opens Settings, slider, B back with focus restored, Start closes');

  // ---- the Bag ----
  await press(['View']);
  assert.ok(await isOpen('bag'), 'View opens the Bag');
  assert.equal((await cur()).layer, 'bag');
  const k0 = (await cur()).key;
  await press(['Down']);
  const k1 = (await cur()).key;
  assert.notEqual(k1, k0, 'd-pad moves in the Bag');
  await press(['B']);
  assert.ok(!(await isOpen('bag')), 'B closes the Bag');
  await press(['View']);
  assert.equal((await cur()).key, k1, 'reopened: focus restored');
  await press(['B']);
  ok('Bag: navigable, B closes it, focus restored on reopening');

  // ---- the Skill Tree ----
  await press(['LB', 'Up'], 2);
  assert.ok(await S(() => !document.getElementById('talentsp').classList.contains('hidden')), 'LB+Up opens the Skill Tree');
  await frames(2);
  const t0 = await cur();
  assert.equal(t0.layer, 'talentsp');
  assert.ok(t0.key, 'something focused');
  await goTo('BUTTON?tab=talents', 'Right', 6).catch(async () => { await goTo('BUTTON?tab=talents', 'Left', 6); });
  await press(['A']);
  assert.ok(await S(() => document.querySelector('#talentsp [data-tab=talents]').classList.contains('on')), 'A switches tab');
  await press(['Down']);
  assert.match((await cur()).key || '', /^g\?id=|^BUTTON|^DIV/i, 'down into the tree');
  await press(['B']);
  assert.ok(await S(() => document.getElementById('talentsp').classList.contains('hidden')), 'B closes the Skill Tree');
  await press(['LB', 'Up'], 2); await frames(2);
  await press(['Start'], 2);
  assert.ok(await S(() => document.getElementById('talentsp').classList.contains('hidden')), 'Start closes the Skill Tree too');
  assert.ok(!(await isOpen('gamemenu')), '(without opening the Game Menu)');
  ok('Skill Tree: navigable, A switches tabs, B and Start close it');

  // ---- the MVP card ----
  const card = await S(() => ({ result: 'kill', boss: 'Test Boss', floor: 1, secs: 60, mvp: window.__fb.state.myId, rows: [{ id: window.__fb.state.myId, name: 'Padnav', cls: 'guardian', lvl: 10, titles: ['steady'] }] }));
  for (const b of ['A', 'B']) {
    await S(c => window.__fb.mvp.event({ t: 'mvp', all: true, d: 0, secs: 30, card: c }), card);
    await p.waitForFunction(() => document.querySelector('#mvp.mv-on'), null, { timeout: 5000 });
    await frames(2);
    { const c = await cur(); assert.ok(c.layer === 'mvp' && c.key, `the MVP card is focused (${c.key})`); }
    await press([b]);
    assert.ok(!(await S(() => window.__fb.mvp.isOpen())), `${b} closes the MVP card`);
    await p.waitForTimeout(400);
  }
  ok('MVP card: focused, A or B closes it');

  // ---- keyboard & mouse: the pad leaves menus alone ----
  await S(() => window.__fb.input.setDevice('kbm'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  if (!(await isOpen('gamemenu'))) await p.keyboard.press('Escape');
  await frames(2);
  assert.ok(await isOpen('gamemenu'));
  assert.equal((await cur()).layer, null, 'no navigation under keyboard & mouse');
  assert.equal(await ring(), 0, 'no focus ring');
  ok('under keyboard & mouse there is no pad navigation or ring');

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`padnav: all ${n} checks passed`);
} finally {
  await browser?.close();
  srv.kill();
}
