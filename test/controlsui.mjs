// The Controls screen (roadmap K2, public/controlsui.js) in a real browser: open it from the Game Menu, the device
// choice (Controller only with a pad), rebind a key, a refused combo, the conflict prompt (swap), the new key works in
// game and after a reload, the HUD labels follow, Reset to defaults, Esc closes it; the device pictures (hover press
// and tooltip, ★ on bound keys, click popover → Edit → filter → bind, live light-up, keys don't reach the game while
// it's open, a fake pad.padHeld lights pad buttons), the guide names the new key. Anonymous mode (no DB).
// Needs Playwright for Node (as test/keys.mjs). Screenshots: SHOTS=<dir> (not committed).
// Usage: PORT=372xx node test/controlsui.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const PORT = +(process.env.PORT || 37210), base = `http://localhost:${PORT}`, SHOTS = process.env.SHOTS || '';
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', START_LEVEL: '10', SPAWN_AT: '0,150', TEST_HOOKS: '1', NAMED_ENABLED: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
const errors = [];
try {
  await new Promise((res, rej) => { srv.stdout.on('data', d => /listening|localhost:\d+/i.test(d) && res()); srv.on('exit', rej); setTimeout(res, 4000); });
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    window.__sent = [];
    const ws = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { try { window.__sent.push(JSON.parse(d)); } catch {} return ws.call(this, d); };
  });
  const join = async () => {
    await p.goto(`${base}/?quality=low`);
    await p.fill('#name', 'Binder');
    await p.click('.cls[data-id=guardian]');
    await p.click('#enter');
    await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  };
  await join();

  const frames = k => p.evaluate(k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), k);
  const S = (fn, arg) => p.evaluate(fn, arg);
  const tap = async (code, k = 2) => { await p.keyboard.down(code); await frames(k); await p.keyboard.up(code); await frames(2); };
  const visible = id => S(id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); }, id);
  const mark = () => S(() => window.__sent.length);
  const sent = (m, type) => S(([m, t]) => window.__sent.slice(m).filter(o => o.type === t), [m, type]);
  const saved = () => S(() => JSON.parse(localStorage.getItem('fb_controls') || '{}'));
  const bound = (a, d = 'kbm') => S(([a, d]) => window.__fb.input.bindings(d)[a][0], [a, d]);
  const cell = (a, d = 'kbm') => S(([a, d]) => document.querySelector(`#cu-tab-${d} [data-b="${a}:0"]`).textContent, [a, d]);
  const msg = () => S(() => document.querySelector('#cu-tab-kbm .cu-msg').textContent);
  const shot = async name => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
  const rebind = async (action, ...codes) => {
    await p.click(`#cu-tab-kbm [data-rb="${action}:0"]`);
    await p.waitForFunction(() => window.__fb.input.capturing);
    if (!rebind.shot) { rebind.shot = 1; await shot('03b-rebind-listening'); }
    for (const c of codes) await p.keyboard.down(c);
    for (const c of [...codes].reverse()) await p.keyboard.up(c);
    await frames(2);
  };

  // ---- open it from the Game Menu ----
  await tap('Escape'); await frames(2);
  assert.ok(await visible('gamemenu'), 'Esc opens the Game Menu');
  const items = await S(() => [...document.querySelectorAll('#gamemenu .gm-b')].map(b => b.textContent.trim()));
  assert.equal(items[items.indexOf('Settings') + 1], 'Controls', `Controls sits right after Settings (${items})`);
  await shot('01-gamemenu');
  await p.click('#gamemenu [data-a=bindings]'); await frames(2);
  assert.ok(await visible('controlsui') && !(await visible('gamemenu')), 'Controls opens, the Game Menu closes');
  assert.equal(await S(() => window.__fb.panels.top()), 'controlsui', 'it is the top panel');
  ok('Game Menu → Controls opens the Controls screen');

  // ---- header: device choice, status, tabs, picture containers, the list ----
  assert.equal(await S(() => document.querySelector('input[name=cu-dev][value=kbm]').checked), true);
  assert.equal(await S(() => document.querySelector('input[name=cu-dev][value=pad]').disabled), true, 'Controller needs a connected pad');
  assert.match(await S(() => document.getElementById('cu-status').textContent), /No controller connected/);
  assert.equal(await S(() => window.__fb.input.setDevice('pad')), false, 'and the input layer agrees');
  assert.ok(await S(() => !!document.getElementById('cu-pic-kbm') && !!document.getElementById('cu-pic-pad')), 'picture containers for part 2');
  const rows = await S(() => [...document.querySelectorAll('#cu-tab-kbm .cu-row')].map(r => r.dataset.action));
  const ids = await S(() => import('/shared/controls.js').then(m => m.ACTIONS.map(a => a.id)));
  assert.deepEqual([...rows].sort(), [...ids].sort(), 'every control is listed on the keyboard tab');
  assert.equal(await cell('attack'), 'Click'); assert.equal(await cell('move'), 'WASD');
  assert.ok(await S(() => document.querySelector('#cu-tab-kbm [data-rb="menu:0"]').disabled), 'the Game Menu key is fixed');
  assert.ok(await S(() => ['look:0', 'look:1', 'zoom:0'].every(k => document.querySelector(`#cu-tab-kbm [data-rb="${k}"]`).disabled)), 'the mouse and wheel stay');
  assert.ok(await S(() => !document.querySelector('#cu-tab-kbm [data-rb="move:1"]').disabled), 'Move (four keys) can be rebound');
  await shot('02-kbm-tab');
  await p.click('.cu-tabs [data-tab=pad]'); await frames(1);
  assert.ok(await visible('cu-tab-pad') && !(await visible('cu-tab-kbm')), 'Controller tab');
  const padRows = await S(() => [...document.querySelectorAll('#cu-tab-pad .cu-row')].map(r => r.dataset.action));
  assert.ok(!padRows.includes('chat') && padRows.includes('jump'), 'the pad tab leaves out keyboard-only controls');
  assert.equal(await cell('jump', 'pad'), 'A');
  assert.ok(await S(() => document.querySelector('#cu-tab-pad [data-rb="jump:0"]').disabled), 'pad rebinding waits for a pad');
  await shot('03-pad-tab');
  await p.click('.cu-tabs [data-tab=kbm]'); await frames(1);
  ok('device choice (Controller disabled without a pad), status line, both tabs with every control');

  // ---- rebind Jump to G ----
  await rebind('jump', 'KeyG');
  assert.equal(await bound('jump'), 'KeyG');
  assert.equal(await cell('jump'), 'G');
  assert.deepEqual((await saved()).kbm, { jump: ['KeyG', null] }, 'saved in fb_controls');
  assert.equal(await S(() => document.querySelector('#skills .sj .key').textContent), 'G', 'the skill bar names the new key');
  ok('Rebind: Jump → G, saved, the skill bar label follows');

  // ---- Esc cancels a capture without closing the screen ----
  await p.click('#cu-tab-kbm [data-rb="jump:0"]');
  await tap('Escape');
  assert.ok(await visible('controlsui'), 'still open');
  assert.equal(await bound('jump'), 'KeyG'); assert.match(await msg(), /Cancelled/);
  ok('Esc cancels a rebind and leaves the screen open');

  // ---- refused: a combo whose first key has its own control ----
  await rebind('jump', 'Digit1', 'KeyX');
  assert.equal(await bound('jump'), 'KeyG');
  assert.match(await msg(), /combo/, 'says why');
  await shot('04-refused');
  ok('a combo using a key that has its own control is refused, with the reason');

  // ---- conflict: F is Interact's → swap ----
  await rebind('jump', 'KeyF');
  assert.ok(await S(() => !!document.getElementById('cu-prompt')), 'the conflict prompt');
  assert.match(await S(() => document.getElementById('cu-prompt').textContent), /F is already on Interact/);
  assert.equal(await bound('jump'), 'KeyG', 'nothing changes until you choose');
  await shot('05-conflict');
  await p.click('#cu-prompt [data-p=swap]'); await frames(1);
  assert.equal(await bound('jump'), 'KeyF'); assert.equal(await bound('interact'), 'KeyG', 'Interact takes the old key');
  assert.deepEqual((await saved()).kbm, { jump: ['KeyF', null], interact: ['KeyG', null] });
  ok('a taken key asks; Swap gives the other control the old key');

  // ---- unbind ----
  await rebind('cover', 'KeyG');
  await p.click('#cu-prompt [data-p=unbind]'); await frames(1);
  assert.equal(await bound('cover'), 'KeyG'); assert.equal(await bound('interact'), null);
  assert.equal(await cell('interact'), 'Not bound');
  ok('Unbind leaves the other control unbound');

  // ---- Move's alt keys: four presses, one per direction ----
  await p.click('#cu-tab-kbm [data-rb="move:1"]');
  for (const c of ['KeyU', 'KeyH', 'KeyN', 'KeyM']) { await p.waitForFunction(() => window.__fb.input.capturing); await p.keyboard.press(c); await frames(1); }
  await frames(2);
  assert.equal(await S(() => window.__fb.input.bindings('kbm').move[1]), 'KeyU,KeyH,KeyN,KeyM');
  ok('Move takes four keys, one per direction');

  // ---- the new key works in game ----
  await tap('Escape'); await frames(2);
  assert.ok(!(await visible('controlsui')), 'Esc closes the Controls screen');
  assert.ok(!(await visible('gamemenu')), 'without opening the Game Menu');
  let m = await mark(); await tap('KeyF');
  assert.equal((await sent(m, 'jump')).length, 1, 'F jumps now');
  await sleep(900); m = await mark(); await tap('Space');
  assert.equal((await sent(m, 'jump')).length, 0, 'Space no longer jumps');
  ok('in game: the new key jumps, the old one does nothing');

  // ---- loads back after a reload ----
  await join();
  assert.equal(await bound('jump'), 'KeyF'); assert.equal(await bound('cover'), 'KeyG');
  m = await mark(); await tap('KeyF');
  assert.equal((await sent(m, 'jump')).length, 1, 'F still jumps after a reload');
  ok('bindings load back after a reload');

  // ---- reset to defaults ----
  await tap('Escape'); await frames(2); await p.click('#gamemenu [data-a=bindings]'); await frames(1);
  await p.click('#cu-tab-kbm [data-reset=kbm]');
  assert.match(await S(() => document.querySelector('#cu-tab-kbm [data-reset]').textContent), /Sure/, 'asks once');
  assert.equal(await bound('jump'), 'KeyF', 'not yet');
  await p.click('#cu-tab-kbm [data-reset=kbm]'); await frames(1);
  assert.equal(await bound('jump'), 'Space'); assert.equal(await bound('interact'), 'KeyF'); assert.equal(await bound('cover'), 'KeyC');
  assert.deepEqual((await saved()).kbm, {});
  assert.equal(await S(() => document.querySelector('#skills .sj .key').textContent), 'SPACE');
  await shot('06-reset');
  await p.click('#controlsui [data-a=close]'); await frames(1);
  assert.ok(!(await visible('controlsui')));
  m = await mark(); await tap('Space');
  assert.equal((await sent(m, 'jump')).length, 1, 'Space jumps again');
  ok('Reset to defaults (asks once), saved, the HUD follows; ✕ closes');

  // ---- the pictures: hover, ★, live light-up ----
  const hasCls = (sel, c) => S(([s, c]) => document.querySelector(s)?.classList.contains(c), [sel, c]);
  const K = (k, d = 'kbm') => `#cu-pic-${d} [data-k="${k}"]`;
  const tipText = d => S(d => { const t = document.getElementById(`cu-tip-${d}`); return t.classList.contains('hidden') ? null : t.textContent; }, d);
  await tap('Escape'); await frames(2); await p.click('#gamemenu [data-a=bindings]'); await frames(1);
  assert.ok(await S(() => document.querySelectorAll('#cu-pic-kbm svg [data-k]').length > 100), 'a full keyboard');
  assert.ok(await S(() => ['Mouse0', 'Mouse1', 'Mouse2', 'Wheel', 'Mouse', 'Numpad5', 'F12', 'ArrowUp'].every(k => document.querySelector(`#cu-pic-kbm [data-k="${k}"]`))), 'mouse buttons, wheel, numpad, F keys, arrows');
  assert.ok(await S(() => ['LS', 'RS', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start'].every(k => document.querySelector(`#cu-pic-pad [data-k="${k}"]`))), 'the whole controller');
  await p.hover(K('KeyW')); await frames(4);
  assert.match(await tipText('kbm') || '', /^W.*Move \(up\)/, 'hover: the tooltip names the control');
  assert.notEqual(await S(s => getComputedStyle(document.querySelector(s + ' .cu-kin')).transform, K('KeyW')), 'none', 'hover: the key presses down');
  await shot('07-hover');
  await p.hover(K('ControlLeft')); await frames(2);
  assert.match(await tipText('kbm'), /Select what you aim at · combo Ctrl\+Click/, 'chords are noted');
  await p.hover(K('KeyZ')); await frames(2);
  assert.match(await tipText('kbm'), /Not bound/);
  const star = (k, d) => S(s => !!document.querySelector(s + ' .cu-star'), K(k, d));
  assert.ok(await star('KeyW') && await star('Mouse0') && await star('Space') && await star('Mouse') && !(await star('KeyZ')), '★ on bound keys only');
  ok('picture: hover presses the key and shows its control(s), combos noted; ★ on bound keys');

  m = await mark();
  await p.keyboard.down('Space'); await frames(3);
  assert.ok(await hasCls(K('Space'), 'lit'), 'a held key lights up');
  await p.keyboard.up('Space'); await frames(2);
  assert.ok(!(await hasCls(K('Space'), 'lit')), 'and goes out');
  assert.equal((await sent(m, 'jump')).length, 0, 'the game ignores keys while the screen is open');
  await p.keyboard.down('KeyD'); await frames(2); await shot('08-live-key'); await p.keyboard.up('KeyD');
  ok('live feedback: a real key press lights its key; play ignores it while the screen is open');

  // ---- click: popover → Edit → filter → bind Z to Jump; it works in game ----
  await p.click(K('KeyZ')); await frames(1);
  assert.match(await S(() => document.getElementById('cu-pop').textContent), /Z.*Not bound.*Edit/s, 'the popover');
  await shot('09-popover');
  await p.click(K('KeyZ')); await frames(1);
  assert.ok(await S(() => document.activeElement?.id === 'cu-filter'), 'a second click opens the list with the filter box focused');
  await p.keyboard.type('jum'); await frames(1);
  assert.deepEqual(await S(() => [...document.querySelectorAll('#cu-picks [data-pick]')].map(b => b.dataset.pick)), ['jump'], 'the filter narrows the list');
  await shot('10-filter');
  await p.click('#cu-picks [data-pick=jump]'); await frames(1);
  assert.equal(await bound('jump'), 'KeyZ'); assert.equal(await cell('jump'), 'Z');
  assert.ok(!(await S(() => document.getElementById('cu-pop'))), 'the popover closes');
  assert.ok(await star('KeyZ') && !(await star('Space')), 'the ★ moves');
  assert.match(await S(() => import('/guide.js').then(g => g.STEPS.find(s => s.id === 'boss').text())), /jump \(Z\)/, 'the guide names the new key');
  ok('click → popover → Edit list with filter → Jump on Z (★ and guide follow)');

  await p.click(K('KeyF')); await frames(1);
  assert.match(await S(() => document.getElementById('cu-pop').textContent), /Interact/);
  await p.click('#cu-pop [data-pop=edit]'); await frames(1);
  await p.keyboard.type('dodge'); await p.keyboard.press('Enter'); await frames(1);
  assert.match(await S(() => document.getElementById('cu-prompt')?.textContent || ''), /F is already on Interact/, 'the same conflict prompt as Rebind');
  assert.equal(await bound('dodge'), 'ShiftLeft', 'nothing changes until you choose');
  await shot('11-picture-conflict');
  await p.click('#cu-prompt [data-p=cancel]'); await frames(1);
  assert.equal(await bound('interact'), 'KeyF');
  await p.click(K('KeyQ')); await frames(1);
  await tap('Escape'); await frames(1);
  assert.ok(await visible('controlsui') && !(await S(() => document.getElementById('cu-pop'))), 'Esc closes the popover first');
  await tap('Escape'); await frames(2);
  assert.ok(!(await visible('controlsui')));
  m = await mark(); await tap('KeyZ');
  assert.equal((await sent(m, 'jump')).length, 1, 'Z jumps in game');
  ok('Edit + Enter on a taken key asks Swap / Unbind / Cancel; Esc closes the popover, then the screen; Z jumps');

  // ---- the controller picture ----
  await tap('Escape'); await frames(2); await p.click('#gamemenu [data-a=bindings]'); await frames(1);
  await p.click('.cu-tabs [data-tab=pad]'); await frames(1);
  assert.ok(await star('A', 'pad') && await star('LS', 'pad') && !(await star('Home', 'pad')));
  await p.hover(K('LB', 'pad')); await frames(2);
  assert.match(await tipText('pad'), /Cover an ally \(Guardian\) · combo LB\+A/);
  await shot('12-pad-hover');
  await S(() => { window.__fb.input.padHeld = n => n === 'X'; }); await frames(3);
  assert.ok(await hasCls(K('X', 'pad'), 'lit') && !(await hasCls(K('A', 'pad'), 'lit')), 'a held pad button lights up (input.padHeld)');
  await S(() => { delete window.__fb.input.padHeld; });
  await frames(3); assert.ok(!(await hasCls(K('X', 'pad'), 'lit')), 'and goes out when the reading stops');
  await p.click(K('Y', 'pad')); await frames(1);
  assert.match(await S(() => document.getElementById('cu-pop').textContent), /Skill 2/);
  await shot('13-pad-popover');
  await p.click('#controlsui [data-a=close]'); await frames(1);
  ok('controller picture: ★, tooltip with combos, popover; pad buttons light up through input.padHeld');

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`controlsui: all ${n} checks passed`);
} catch (e) {
  console.error('NOT OK:', e.message?.split('\n').slice(0, 3).join(' | '), errors); process.exitCode = 1;
} finally {
  await browser?.close(); srv.kill();
}
