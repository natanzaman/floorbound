// Accessibility options in a real browser: each Settings → Accessibility option takes effect (game state or computed style)
// and is saved under fb_controls.access.   Usage: PORT=37300 node test/access.mjs   (Playwright for Node, as test/keys.mjs)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const PORT = +(process.env.PORT || 37300), base = `http://localhost:${PORT}`;
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  await p.goto(`${base}/?quality=low`);
  await p.fill('#name', 'Access');
  await p.click('.cls[data-id=guardian]');
  await p.click('#enter');
  await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  const S = (fn, arg) => p.evaluate(fn, arg);
  const frames = k => S(k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), k);
  const tap = async (code, ms = 80) => { await p.keyboard.down(code); await sleep(ms); await p.keyboard.up(code); await frames(3); };
  // set an option through the real Settings panel
  const setOpt = async (a, value) => {
    await S(() => window.__fb.panels.isOpen('settings') || document.getElementById('settings-btn').click());
    await S(([a, v]) => {
      const el = document.querySelector(`#settings [data-a=${a}]`);
      if (el.type === 'checkbox') el.checked = v; else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [a, value]);
    await S(() => document.querySelector('#settings [data-a=close]').click());
    await frames(2);
  };
  const stored = () => S(() => JSON.parse(localStorage.getItem('fb_controls')).access);

  // defaults change nothing
  const d = await S(() => { const s = window.__fb.settings; return [s.guardToggle, s.wheelToggle, s.reduceMotion, s.highContrast, s.uiScale, s.padSens, s.sens, s.invertY]; });
  assert.deepEqual(d, [false, false, false, false, 1, 1, 1, false]);
  assert.equal(await S(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()), '1');
  assert.equal(await S(() => document.documentElement.classList.contains('hc')), false);
  ok('defaults: nothing on, scale 1');

  // guard: hold by default
  await p.keyboard.down('KeyR'); await frames(4);
  assert.equal(await S(() => window.__fb.combat.guarding), true, 'held R guards');
  await p.keyboard.up('KeyR'); await frames(4);
  assert.equal(await S(() => window.__fb.combat.guarding), false, 'released R drops it');
  await setOpt('guardToggle', true);
  await tap('KeyR');
  assert.equal(await S(() => window.__fb.combat.guarding), true, 'toggle: tap keeps it up');
  await tap('KeyR');
  assert.equal(await S(() => window.__fb.combat.guarding), false, 'toggle: second tap drops it');
  ok('guardToggle: hold by default, press-press when on');

  // bot wheel: hold V past 350 ms and release closes it; with the toggle it stays open until the next press
  await tap('KeyV', 500);
  assert.equal(await S(() => window.__fb.wheel.isOpen()), false, 'hold: release closes the wheel');
  await setOpt('wheelToggle', true);
  await tap('KeyV', 500);
  assert.equal(await S(() => window.__fb.wheel.isOpen()), true, 'toggle: stays open after release');
  await tap('KeyV', 60);
  assert.equal(await S(() => window.__fb.wheel.isOpen()), false, 'toggle: next press closes it');
  ok('wheelToggle: hold by default, press-press when on');

  // reduce motion: shake and slow-mo (hit-stop) are ignored
  const motion = () => S(() => { const f = window.__fb; f.shake(0.5); f.slowMotion(1, 0.5); return f.motion(); });
  const m0 = await motion();
  assert.ok(m0.shakeAmt >= 0.45 && m0.slowMo > 0, `motion on by default: ${JSON.stringify(m0)}`);
  await frames(90);
  await setOpt('reduceMotion', true);
  const m1 = await motion();
  assert.equal(m1.shakeAmt, 0, 'no shake'); assert.equal(m1.slowMo, 0, 'no slow-mo');
  ok('reduceMotion: shake() and slowMotion() do nothing');

  // text/UI scale and high contrast, as computed styles
  await setOpt('uiScale', 1.5);
  assert.equal(await S(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()), '1.5');
  assert.equal(await S(() => getComputedStyle(document.getElementById('settings')).zoom), '1.5');
  await setOpt('highContrast', true);
  assert.equal(await S(() => document.documentElement.classList.contains('hc')), true);
  assert.equal(await S(() => getComputedStyle(document.getElementById('settings')).color), 'rgb(255, 255, 255)');
  ok('uiScale zooms panels; highContrast sets the class and brighter text');

  // stick sensitivity is stored for the pad code; everything is saved under fb_controls.access
  await setOpt('padSens', 2.2);
  assert.deepEqual(await stored(), { sens: 1, invertY: false, padSens: 2.2, guardToggle: true, wheelToggle: true, reduceMotion: true, uiScale: 1.5, highContrast: true });
  // and survives a reload
  await p.reload();
  await p.waitForFunction(() => !!window.__fb?.settings, null, { timeout: 60000 });
  assert.deepEqual(await S(() => { const s = window.__fb.settings; return [s.guardToggle, s.wheelToggle, s.reduceMotion, s.highContrast, s.uiScale, s.padSens]; }), [true, true, true, true, 1.5, 2.2]);
  assert.equal(await S(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()), '1.5');
  ok('saved under fb_controls.access and restored after a reload');

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`access: all ${n} checks passed`);
} finally {
  await browser?.close();
  srv.kill();
}
