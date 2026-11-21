// Controller smoke test (roadmap K1b): a fake standard pad (17 buttons, 4 axes) through navigator.getGamepads(),
// checked by game state and sent messages. The "Controller detected" prompt, switching with A, the left stick
// moves, the right stick turns the camera, X / LB+X / RT / R3, Start opens the Game Menu, and unplugging falls back
// to keyboard & mouse; the press that wakes a pad doesn't answer the prompt, a second pad taking over and a blur let
// go of pad holds. K4 does the full harness. Needs Playwright for Node (see test/keys.mjs).
// Usage: PORT=371xx node test/padsmoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const PORT = +(process.env.PORT || 37110), base = `http://localhost:${PORT}`;
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
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
    window.__sent = [];
    const ws = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { try { window.__sent.push(JSON.parse(d)); } catch {} return ws.call(this, d); };
    // the fake pad: window.__pad.on plugs it in; buttons / axes are set by the test
    const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = { on: false, pad };
    // a second pad (index 1) for the active-pad-leaves check
    const pad2 = { ...pad, id: 'DualSense Wireless Controller (STANDARD GAMEPAD)', index: 1, buttons: pad.buttons.map(b => ({ ...b })), axes: [0, 0, 0, 0] };
    window.__pad2 = { on: false, pad: pad2 };
    navigator.getGamepads = () => [window.__pad.on ? pad : null, window.__pad2.on ? pad2 : null, null, null];
  });

  // ---- waking the pad with A: that press does not answer the prompt (a fresh page; the pad is there with A down) ----
  {
    const q = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    q.on('pageerror', e => errors.push(e.message));
    await q.addInitScript(() => {
      const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, touched: false, value: i === 0 ? 1 : 0 })), axes: [0, 0, 0, 0] };
      window.__pad = { pad };
      navigator.getGamepads = () => [pad, null, null, null];
    });
    await q.goto(`${base}/?quality=low`);
    await q.waitForFunction(() => window.__fb?.input?.pad.connected && window.__fb.input.frames > 3, null, { timeout: 60000 });
    assert.equal(await q.evaluate(() => window.__fb.input.device), 'kbm', 'the waking A did not switch');
    assert.match(await q.evaluate(() => document.getElementById('padtoast')?.textContent || ''), /Controller detected/, 'the prompt is still up');
    await q.evaluate(() => { const b = window.__pad.pad.buttons[0]; b.pressed = false; b.value = 0; });
    await q.waitForFunction(() => !window.__fb.input.padHeld('A'));
    await q.evaluate(() => { const b = window.__pad.pad.buttons[0]; b.pressed = true; b.value = 1; });
    await q.waitForFunction(() => window.__fb.input.device === 'pad', null, { timeout: 5000 });
    await q.close();
    ok('the button press that wakes the pad does not answer "Controller detected"; a fresh A does');
  }

  // ---- the "Controller detected" toast: unplugging closes it; a later note never leaves the question live ----
  {
    const q = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    q.on('pageerror', e => errors.push(e.message));
    await q.addInitScript(() => {
      const mk = (id, index, mapping) => ({ id, index, connected: true, mapping, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] });
      window.__pads = [mk('Xbox Wireless Controller (STANDARD GAMEPAD)', 0, 'standard'), mk('Generic USB Joystick', 1, '')];
      window.__on = [false, false];
      navigator.getGamepads = () => [window.__on[0] ? window.__pads[0] : null, window.__on[1] ? window.__pads[1] : null, null, null];
    });
    await q.goto(`${base}/?quality=low`);
    await q.waitForFunction(() => window.__fb?.input && window.__fb.input.frames > 3, null, { timeout: 60000 });
    const tq = () => q.evaluate(() => { const el = document.getElementById('padtoast'); return el && !el.classList.contains('hidden') ? el.textContent : null; });
    const fq = k => q.evaluate(k => new Promise(r => { const end = window.__fb.input.frames + k; const f = () => (window.__fb.input.frames >= end ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), k);
    await q.evaluate(() => { window.__on[0] = true; dispatchEvent(new Event('gamepadconnected')); }); await fq(2);
    assert.match(await tq() || '', /Controller detected/, 'the question is up');
    await q.evaluate(() => { window.__on[0] = false; dispatchEvent(new Event('gamepaddisconnected')); }); await fq(2);
    assert.equal(await tq(), null, 'unplugging the pad closes the "Controller detected" toast');
    // the question again, then the pad is swapped for an unrecognised one in one poll: its note replaces the question
    await q.evaluate(() => { window.__fb.settings.padAsked = false; window.__on[0] = true; dispatchEvent(new Event('gamepadconnected')); }); await fq(2);
    assert.match(await tq() || '', /Controller detected/, 'asked again');
    await q.evaluate(() => { window.__on[0] = false; window.__on[1] = true; }); await fq(2);
    assert.match(await tq() || '', /not recognised/, 'the unrecognised pad\'s note');
    await q.evaluate(() => { const b = window.__pads[1].buttons[0]; b.pressed = true; b.value = 1; }); await fq(3);
    assert.equal(await q.evaluate(() => window.__fb.input.device), 'kbm', 'A after the note does not answer the hidden question');
    // the stored access is clamped before the camera stick reads it
    const acc = await q.evaluate(async () => {
      const { controlsStore } = await import('/input.js');
      controlsStore.set({ access: { sens: 1e308, padSens: -5, invertY: 'yes' } });
      const a = controlsStore.access(); controlsStore.set({ access: {} });
      return { sens: a.sens, padSens: a.padSens, invertY: a.invertY };
    });
    assert.deepEqual(acc, { sens: 3, padSens: 0.3, invertY: false }, 'stored access is normalised (sens / padSens clamped)');
    await q.close();
    ok('unplugging closes the "Controller detected" toast; a note never leaves the question live; stored access is clamped');
  }

  await p.goto(`${base}/?quality=low`);
  await p.fill('#name', 'Pad');
  await p.click('.cls[data-id=guardian]');
  await p.click('#enter');
  await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  await p.evaluate(() => window.__fb.send({ type: 'test', ward: 1 })); // (TEST_HOOKS: the wolves can't bite us down mid-check on a slow run)

  // ---- helpers: presses are held for N polled frames (__fb.input.frames) ----
  const S = (fn, arg) => p.evaluate(fn, arg);
  const frames = k => S(k => new Promise(r => { const end = window.__fb.input.frames + k; const f = () => (window.__fb.input.frames >= end ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), k);
  const mark = () => S(() => window.__sent.length);
  const sent = (m, type) => S(([m, t]) => window.__sent.slice(m).filter(o => o.type === t), [m, type]);
  const btn = (name, down) => S(([i, d]) => { const b = window.__pad.pad.buttons[i]; b.pressed = d; b.value = d ? 1 : 0; }, [BTN[name], down]);
  const press = async (names, k = 3) => { for (const nm of names) await btn(nm, true); await frames(k); for (const nm of [...names].reverse()) await btn(nm, false); await frames(2); };
  const axes = a => S(a => { window.__pad.pad.axes = a; }, a);
  const keepAlive = () => S(() => window.__fb.send({ type: 'test', hurt: 1 }));
  const ready = slot => p.waitForFunction(s => { const st = window.__fb.state, t = performance.now(); return t > st.ready[s] + 50 || (t >= st.ready[s] && t - st.lastPress[s] > 400); }, slot, { timeout: 60000 });
  const toast = () => S(() => { const el = document.getElementById('padtoast'); return el && !el.classList.contains('hidden') ? el.textContent : null; });

  // ---- plugging it in: the one-time prompt; A switches ----
  assert.equal(await S(() => window.__fb.input.device), 'kbm');
  await S(() => { window.__pad.on = true; const e = new Event('gamepadconnected'); e.gamepad = window.__pad.pad; dispatchEvent(e); });
  await frames(2);
  assert.match(await toast() || '', /Controller detected/);
  assert.equal(await S(() => window.__fb.input.device), 'kbm', 'not switched yet');
  await press(['A']);
  assert.equal(await S(() => window.__fb.input.device), 'pad', 'A on the prompt switches');
  assert.ok(await S(() => document.body.classList.contains('pad')), 'body.pad (touch HUD hidden)');
  assert.equal(await S(() => window.__fb.state.jumpPress > performance.now() - 300), false, 'the answering A did not jump');
  assert.equal(await S(() => window.__fb.input.label('skill1')), 'X');
  ok('a new pad asks once; A switches to Controller; labels follow the pad');

  // ---- left stick moves, right stick turns ----
  await S(() => { window.__fb.state.lock = 0; window.__fb.state.focus = 0; });
  await axes([0, -1, 0, 0]); await frames(3);
  { const { dir, yaw } = await S(() => ({ dir: window.__fb.state.moveDir, yaw: window.__fb.state.yaw })); assert.ok(dir !== null && angDiff(dir, yaw) < 0.05, `stick up: forward (${dir} vs ${yaw})`); }
  await axes([1, 0, 0, 0]); await frames(3);
  { const { dir, yaw } = await S(() => ({ dir: window.__fb.state.moveDir, yaw: window.__fb.state.yaw })); assert.ok(angDiff(dir, yaw - Math.PI / 2) < 0.05, 'stick right: strafe right'); }
  await axes([0.1, 0.1, 0, 0]); await frames(2);
  assert.equal(await S(() => window.__fb.state.moveDir), null, 'inside the deadzone: still');
  const y0 = await S(() => window.__fb.state.yaw);
  await axes([0, 0, 1, 0]); await frames(6); await axes([0, 0, 0, 0]); await frames(1);
  assert.ok(await S(() => window.__fb.state.yaw) < y0 - 0.02, 'right stick right: camera turns right');
  ok('left stick moves relative to the camera (with a deadzone); right stick turns the camera');

  // ---- buttons: X skill 1, LB+X Team Burst (not skill 1), RT attacks while held, R3 locks on ----
  await keepAlive(); await ready(1);
  let m = await mark(); // (skill 1 is ready: LB+X would use it if the modifier layer didn't take the press)
  await press(['LB', 'X']);
  assert.equal((await sent(m, 'skill')).filter(o => o.slot === 1).length, 0, 'LB+X is not skill 1');
  m = await mark();
  await press(['X']);
  assert.deepEqual((await sent(m, 'skill')).map(o => o.slot), [1], 'X uses skill 1');
  await keepAlive(); await ready(0); m = await mark();
  await S(() => { const b = window.__pad.pad.buttons[7]; b.pressed = true; b.value = 0.8; }); await frames(4);
  assert.ok((await sent(m, 'skill')).some(o => o.slot === 0), 'RT attacks');
  await S(() => { const b = window.__pad.pad.buttons[7]; b.value = 0.4; }); await frames(2); // (between the thresholds: still held)
  assert.ok(await S(() => window.__fb.input.padHeld('RT')), 'trigger hysteresis keeps RT down at 0.4');
  await S(() => { const b = window.__pad.pad.buttons[7]; b.pressed = false; b.value = 0; }); await frames(2);
  await p.waitForFunction(() => [...window.__fb.mobs.values()].some(e => !e.dying && !e.hidden && Math.hypot(e.x - window.__fb.state.x, e.z - window.__fb.state.z) < 22), null, { timeout: 30000 });
  await S(() => { window.__fb.state.lock = 0; });
  await press(['R3']);
  assert.ok(await S(() => window.__fb.state.lock) > 0, 'R3 locks on');
  await press(['LB', 'R3']);
  assert.equal(await S(() => window.__fb.state.lock), 0, 'LB+R3 clears the target');
  ok('X skill 1, LB+X not skill 1, RT attacks (trigger hysteresis), R3 locks on, LB+R3 clears');

  // ---- keyboard under Controller: no skills; Start opens the menu ----
  m = await mark();
  await p.keyboard.press('Digit2'); await frames(2);
  assert.equal((await sent(m, 'skill')).length, 0, 'keyboard skills off under Controller');
  await press(['Start']);
  assert.ok(await S(() => window.__fb.panels.isOpen('gamemenu')), 'Start opens the Game Menu');
  await p.waitForTimeout(450); await press(['Start']);
  assert.ok(!(await S(() => window.__fb.panels.isOpen('gamemenu'))), 'Start again closes it');
  ok('keyboard keys off under Controller; Start opens and closes the Game Menu');

  // ---- unplugging: holds let go, back to keyboard & mouse with a toast ----
  await keepAlive(); await ready(0);
  await S(() => { const b = window.__pad.pad.buttons[7]; b.pressed = true; b.value = 1; }); await frames(3);
  await S(() => { window.__pad.on = false; dispatchEvent(new Event('gamepaddisconnected')); }); await frames(2);
  assert.equal(await S(() => window.__fb.input.device), 'kbm', 'back to keyboard & mouse');
  assert.match(await toast() || '', /disconnected/);
  await p.waitForTimeout(900); m = await mark(); await frames(3);
  assert.equal((await sent(m, 'skill')).length, 0, 'the held RT let go');
  m = await mark(); await ready(2); await p.keyboard.press('Digit2'); await frames(2);
  assert.deepEqual((await sent(m, 'skill')).map(o => o.slot), [2], 'keyboard works again');
  ok('unplugging lets go of holds and falls back to keyboard & mouse with a toast');

  // ---- two pads: the active one leaves while RT is held; the other takes over and the attack lets go ----
  await S(() => { const b = window.__pad.pad.buttons[7]; b.pressed = false; b.value = 0; }); // (still down from the unplug check)
  await S(() => { window.__pad.on = true; window.__pad2.on = true; dispatchEvent(new Event('gamepadconnected')); }); await frames(2);
  await S(() => window.__fb.input.setDevice('pad')); await frames(1);
  assert.equal(await S(() => window.__fb.input.pad.id), await S(() => window.__pad.pad.id), 'pad 1 is the active one');
  await keepAlive(); await ready(0); m = await mark();
  await S(() => { const b = window.__pad.pad.buttons[7]; b.pressed = true; b.value = 1; }); await frames(4);
  assert.ok((await sent(m, 'skill')).some(o => o.slot === 0), 'RT on pad 1 attacks');
  await S(() => { window.__pad.on = false; const b = window.__pad.pad.buttons[7]; b.pressed = false; b.value = 0; dispatchEvent(new Event('gamepaddisconnected')); }); await frames(2);
  assert.equal(await S(() => window.__fb.input.pad.id), await S(() => window.__pad2.pad.id), 'pad 2 takes over');
  assert.equal(await S(() => window.__fb.input.device), 'pad', 'still on Controller');
  await keepAlive(); await frames(2); m = await mark(); await p.waitForTimeout(1500); // (longer than the attack's cooldown)
  assert.equal((await sent(m, 'skill')).length, 0, 'the RT held on pad 1 let go');
  ok('the active pad leaving with another connected lets go of its holds');

  // ---- the bot wheel by pad (LB+Y), the window loses focus, Y let go: the wheel closes ----
  const wheelOpen = () => S(() => !document.getElementById('botwheel').classList.contains('hidden'));
  for (const i of [4, 3]) await S(i => { const b = window.__pad2.pad.buttons[i]; b.pressed = true; b.value = 1; }, i);
  await frames(3);
  assert.ok(await wheelOpen(), 'LB+Y opens the wheel');
  await p.waitForTimeout(450); // (held past a tap)
  await S(() => dispatchEvent(new Event('blur')));
  for (const i of [3, 4]) await S(i => { const b = window.__pad2.pad.buttons[i]; b.pressed = false; b.value = 0; }, i);
  await frames(3);
  assert.ok(!(await wheelOpen()), 'the wheel is not left open after a blur');
  ok('a blur lets go of pad holds: the bot wheel closes');

  // ---- prompts follow the device: the bar's key chips, world prompts, server text; the Controls tab follows too ----
  const chips = () => S(() => [...document.querySelectorAll('#skills .key')].filter(k => k.closest('[data-slot],[data-item]')).map(k => k.textContent));
  const want = () => S(() => { const I = window.__fb.input, A = { 0: 'attack', 1: 'skill1', 2: 'skill2', 3: 'skill3', dodge: 'dodge', jump: 'jump', guard: 'guard', cover: 'cover' };
    return [...document.querySelectorAll('#skills .key')].filter(k => k.closest('[data-slot],[data-item]')).map(k => { const b = k.closest('button'), a = A[b.dataset.slot] || (b.dataset.item ? `item${[...document.querySelectorAll('#skills [data-item]')].indexOf(b) + 1}` : null); return a ? I.label(a).toUpperCase() : k.textContent; }); });
  const kn = () => S(async () => { const m = await import('/keyname.js'); return [m.keyName('interact'), m.keyText('Hold {key:revive} next to them'), m.tapping()]; });
  assert.equal(await S(() => window.__fb.input.device), 'pad');
  assert.deepEqual(await chips(), await want(), 'under Controller the bar names pad buttons (pad 2 took over: its own kind)');
  assert.ok((await chips()).includes('□') && (await chips()).includes('R1'), 'pad 2 reads as PlayStation: Skill 1 on □, Dodge on R1');
  await S(() => window.__fb.input.setGlyphs('xbox'));
  assert.ok((await chips()).includes('X') && (await chips()).includes('RB'), 'the Xbox picture chosen: Skill 1 on X, Dodge on RB');
  assert.deepEqual(await kn(), [await S(() => window.__fb.input.label('interact')), `Hold ${await S(() => window.__fb.input.label('revive'))} next to them`, false], 'prompts and server text name the pad button');
  await S(() => window.__fb.controlsUi.open());
  assert.equal(await S(() => window.__fb.controlsUi.tab), 'pad', 'Controls opens on the Controller tab');
  await S(() => window.__fb.input.setDevice('kbm')); await frames(1);
  assert.ok((await chips()).includes('1') && !(await chips()).includes('RB'), 'back on keyboard the bar names keys again, no rebuild needed');
  assert.deepEqual(await chips(), await want());
  assert.equal((await kn())[0], 'F', 'world prompts say F again');
  assert.equal(await S(() => window.__fb.controlsUi.tab), 'kbm', 'the open Controls screen follows to the Keyboard tab');
  assert.ok(await S(() => !document.getElementById('cu-tab-kbm').classList.contains('hidden') && document.getElementById('cu-tab-pad').classList.contains('hidden')));
  await p.click('#controlsui input[name=cu-dev][value=pad]'); await frames(1);
  assert.equal(await S(() => window.__fb.input.device), 'pad', 'the radio switches to Controller');
  assert.equal(await S(() => window.__fb.controlsUi.tab), 'pad', 'and the tab follows it at once');
  assert.ok(await S(() => !document.getElementById('cu-tab-pad').classList.contains('hidden')) && /Playing with/.test(await S(() => document.getElementById('cu-msg-pad').textContent)));
  assert.ok((await chips()).includes('X'), 'and the bar names pad buttons again');
  await S(() => window.__fb.controlsUi.close());
  await S(() => window.__fb.input.setGlyphs('auto'));
  assert.ok((await chips()).includes('□'), 'back to auto: PlayStation names');
  ok('key hints follow the device (bar, prompts, server text); the Controls tab follows a device switch');

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`padsmoke: all ${n} checks passed`);
} finally {
  await browser?.close();
  srv.kill();
}
