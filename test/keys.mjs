// Keyboard & mouse regression test (roadmap K, must-fix 1): presses every default key and mouse action in a real
// browser and checks what it does: the message it sends (send(), captured from the socket) or the state it changes
// (window.__fb). It must pass the same before and after the input layer (public/input.js) took over the keys.
// Needs Playwright for Node (not a dependency: `npm i --no-save playwright`, or point PLAYWRIGHT at its index.mjs).
// Pointer lock does not engage in headless Chrome, so the page gets a stand-in (requestPointerLock / exitPointerLock /
// pointerLockElement) that behaves like the real thing, and mouse-look motion is sent as movementX/Y events.
// Usage: PORT=67xx node test/keys.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const PORT = +(process.env.PORT || 6790), base = `http://localhost:${PORT}`;
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Spawn in the gate zone in front of the Warden's arena (wolves and spitters close by, F readies the gate).
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
    let locked = null; // pointer lock stand-in
    window.__plock = 0;
    Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
    Element.prototype.requestPointerLock = function () { window.__plock++; locked = this; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { if (!locked) return; locked = null; document.dispatchEvent(new Event('pointerlockchange')); };
  });
  await p.goto(`${base}/?quality=low`);
  await p.fill('#name', 'Keys');
  await p.click('.cls[data-id=guardian]'); // Guardian: has guard (R) and Cover (C) too
  await p.click('#enter');
  await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });

  // ---- helpers ----
  const frames = k => p.evaluate(k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), k);
  const S = (fn, arg) => p.evaluate(fn, arg);
  const mark = () => S(() => window.__sent.length);
  const sent = (m, type) => S(([m, t]) => window.__sent.slice(m).filter(o => o.type === t), [m, type]);
  const visible = id => S(id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); }, id);
  const menuOpen = () => visible('gamemenu');
  const tap = async (code, k = 2) => { await p.keyboard.down(code); await frames(k); await p.keyboard.up(code); await frames(2); };
  const lastLog = () => S(() => document.getElementById('log').lastElementChild?.textContent || '');
  const ready = slot => p.waitForFunction(s => performance.now() > window.__fb.state.ready[s] + 50, slot, { timeout: 20000 });
  const fakeMouse = (type, init) => S(([type, init]) => dispatchEvent(new MouseEvent(type, { bubbles: true, ...init })), [type, init]);
  const keepAlive = () => S(() => window.__fb.send({ type: 'test', hurt: 1 })); // (wolves bite: top up between checks)
  const clearTarget = () => S(() => { window.__fb.state.lock = 0; window.__fb.state.focus = 0; });
  // a spot where the game view itself is under the mouse (HUD boxes such as the gate's Ready button cover parts of it)
  const spot = () => S(() => { for (let y = 200; y < innerHeight - 200; y += 40) for (let x = 200; x < innerWidth - 200; x += 40) if (document.elementFromPoint(x, y)?.id === 'view') return [x, y]; return null; });

  // ---- movement: WASD and the arrows, relative to the camera ----
  await clearTarget();
  const moves = [['KeyW', 0], ['KeyS', Math.PI], ['KeyA', Math.PI / 2], ['KeyD', -Math.PI / 2], ['ArrowUp', 0], ['ArrowDown', Math.PI], ['ArrowLeft', Math.PI / 2], ['ArrowRight', -Math.PI / 2]];
  for (const [code, off] of moves) {
    await p.keyboard.down(code); await frames(3);
    const { dir, yaw } = await S(() => ({ dir: window.__fb.state.moveDir, yaw: window.__fb.state.yaw }));
    await p.keyboard.up(code); await frames(2);
    assert.ok(dir !== null && angDiff(dir, yaw + off) < 0.05, `${code}: moveDir ${dir} vs yaw ${yaw} + ${off}`);
    assert.equal(await S(() => window.__fb.state.moveDir), null, `${code}: released, still moving`);
  }
  await p.keyboard.down('KeyW'); await p.keyboard.down('KeyD'); await frames(3);
  { const { dir, yaw } = await S(() => ({ dir: window.__fb.state.moveDir, yaw: window.__fb.state.yaw })); assert.ok(angDiff(dir, yaw - Math.PI / 4) < 0.05, 'W+D diagonal'); }
  await p.keyboard.up('KeyW'); await p.keyboard.up('KeyD'); await frames(2);
  ok('WASD and arrows move relative to the camera, diagonals combine, release stops');

  // ---- Tab locks on / cycles; Esc clears the target before opening the menu ----
  await keepAlive(); await clearTarget();
  assert.ok(await S(() => [...window.__fb.mobs.values()].some(e => !e.dying && !e.hidden && Math.hypot(e.x - window.__fb.state.x, e.z - window.__fb.state.z) < 25)), 'a mob in range for Tab');
  await tap('Tab');
  const first = await S(() => window.__fb.state.lock);
  assert.ok(first > 0, 'Tab locks on');
  assert.ok(!(await S(() => document.activeElement && document.activeElement !== document.body && document.activeElement.tagName !== 'CANVAS')), 'Tab does not move focus');
  await tap('Tab');
  assert.notEqual(await S(() => window.__fb.state.lock), first, 'Tab again moves to the next target');
  await tap('Tab'); // (Tab may have wrapped round to no target)
  if (!(await S(() => window.__fb.state.lock))) await tap('Tab');
  assert.ok(await S(() => window.__fb.state.lock) > 0, 'locked on');
  await tap('Escape');
  assert.equal(await S(() => window.__fb.state.lock), 0, 'Esc clears the target');
  assert.ok(!(await menuOpen()), 'that Esc does not open the menu');
  ok('Tab locks on and cycles targets; Esc clears the target first');

  // ---- Q / E turn ----
  for (const [code, sign] of [['KeyQ', 1], ['KeyE', -1]]) {
    await clearTarget();
    const y0 = await S(() => window.__fb.state.yaw);
    await p.keyboard.down(code); await frames(4); await p.keyboard.up(code); await frames(1);
    const y1 = await S(() => window.__fb.state.yaw);
    assert.ok((y1 - y0) * sign > 0.05, `${code} turns (${y0} -> ${y1})`);
  }
  ok('Q turns left, E turns right (no downed ally in reach)');

  // ---- mouse look: the first click captures the cursor, the mouse turns the camera, clicks attack ----
  const [vx, vy] = await spot();
  let m = await mark();
  await p.mouse.click(vx, vy); await frames(2);
  assert.equal(await S(() => window.__plock), 1, 'first click asks for pointer lock');
  assert.equal(await S(() => document.pointerLockElement?.id), 'view', 'cursor captured by the canvas');
  assert.equal((await sent(m, 'skill')).length, 0, 'the capturing click does not attack');
  ok('mouse look: the first click captures the cursor and does not attack');
  {
    await clearTarget();
    const [y0, p0] = await S(() => [window.__fb.state.yaw, window.__fb.state.pitch]);
    await fakeMouse('mousemove', { movementX: 100, movementY: -40 }); await frames(1);
    const [y1, p1] = await S(() => [window.__fb.state.yaw, window.__fb.state.pitch]);
    assert.ok(Math.abs(y1 - (y0 - 0.24)) < 0.03, `mouse x turns the camera (${y0} -> ${y1})`);
    assert.ok(p1 < p0, 'mouse y tilts the camera');
  }
  ok('mouse look: moving the mouse turns and tilts the camera');
  await ready(0); m = await mark();
  await p.mouse.down(); await frames(3); await p.mouse.up(); await frames(1);
  const clicks = (await sent(m, 'skill')).filter(o => o.slot === 0).length;
  assert.ok(clicks >= 1, 'left click (captured) attacks');
  await sleep(900); m = await mark(); await frames(3);
  assert.equal((await sent(m, 'skill')).length, 0, 'releasing the button stops attacking');
  ok('left click attacks while held (cursor captured), stops on release');
  // the cursor leaves pointer lock by itself (the browser spent an Esc on it): the Game Menu opens
  await S(() => document.exitPointerLock()); await frames(2);
  assert.ok(await menuOpen(), 'losing pointer lock opens the Game Menu');
  await sleep(450); await tap('Escape'); await frames(1);
  assert.ok(!(await menuOpen()), 'Esc closes the Game Menu');
  ok('losing the pointer lock opens the Game Menu; Esc closes it');

  // ---- J attacks while held ----
  await keepAlive(); await ready(0); m = await mark();
  await p.keyboard.down('KeyJ'); await frames(3); await p.keyboard.up('KeyJ'); await frames(1);
  assert.ok((await sent(m, 'skill')).some(o => o.slot === 0), 'J attacks');
  await sleep(900); m = await mark(); await frames(3);
  assert.equal((await sent(m, 'skill')).length, 0, 'releasing J stops attacking');
  ok('J attacks while held, stops on release');

  // ---- skills 1 2 3 ----
  for (const slot of [1, 2, 3]) {
    m = await mark(); await tap(`Digit${slot}`);
    assert.deepEqual((await sent(m, 'skill')).map(o => o.slot), [slot], `${slot} uses skill ${slot}`);
  }
  ok('1 2 3 use skills 1 2 3');

  // ---- dodge, jump ----
  m = await mark(); await tap('ShiftLeft');
  assert.equal((await sent(m, 'dodge')).length, 1, 'Shift dodges');
  await p.waitForFunction(() => !window.__fb.state.roll, null, { timeout: 5000 });
  m = await mark(); await tap('Space');
  assert.equal((await sent(m, 'jump')).length, 1, 'Space jumps');
  ok('Shift dodges, Space jumps');

  // ---- guard (hold R), Cover (C), Team Burst (T) ----
  m = await mark();
  await p.keyboard.down('KeyR'); await frames(3);
  assert.deepEqual((await sent(m, 'guard')).map(o => o.on), [true], 'R raises the guard');
  await p.keyboard.up('KeyR'); await frames(2);
  assert.deepEqual((await sent(m, 'guard')).map(o => o.on), [true, false], 'releasing R lowers it');
  m = await mark(); await tap('KeyC');
  assert.equal((await sent(m, 'cover')).length, 1, 'C covers');
  m = await mark(); await tap('KeyT');
  assert.equal((await sent(m, 'burst')).length, 1, 'T presses Team Burst');
  ok('R guards while held, C covers, T presses Team Burst');

  // ---- F interacts (here: ready at the raid gate) ----
  assert.ok(await S(() => !window.__fb.state.gateOpen && Math.abs(window.__fb.state.x) < 12 && window.__fb.state.z > 138 && window.__fb.state.z < 158), 'still in the gate zone');
  m = await mark(); await tap('KeyF');
  assert.equal((await sent(m, 'ready')).length, 1, 'F readies at the gate');
  await tap('KeyF'); // (un-ready)
  ok('F interacts');

  // ---- items 4 5 6 ----
  await S(() => window.__fb.send({ type: 'test', hurt: 0.5 }));
  await p.waitForFunction(() => window.__fb.state.hp < window.__fb.state.maxHp, null, { timeout: 5000 });
  m = await mark(); await tap('Digit4');
  assert.deepEqual((await sent(m, 'use')).map(o => o.id), ['potion'], '4 drinks a potion');
  const inv = await S(() => window.__fb.state.inv.cons);
  for (const [code, id, name] of [['Digit5', 'tonic', 'Tonic'], ['Digit6', 'draught', 'Draught']]) {
    m = await mark(); await tap(code);
    if (inv[id] > 0) assert.deepEqual((await sent(m, 'use')).map(o => o.id), [id], `${code} uses ${id}`);
    else assert.match(await lastLog(), new RegExp(name, 'i'), `${code} tries the ${id} (none left)`);
  }
  ok('4 5 6 use the potion, tonic and draught');

  // ---- panels: bag (B / I), skill tree (K), players (P); Esc closes a panel, not the menu ----
  await tap('KeyB'); assert.ok(await visible('bag'), 'B opens the bag');
  await tap('KeyB'); assert.ok(!(await visible('bag')), 'B closes the bag');
  await tap('KeyI'); assert.ok(await visible('bag'), 'I opens the bag');
  await tap('Escape'); assert.ok(!(await visible('bag')), 'Esc closes the bag');
  assert.ok(!(await menuOpen()), 'that Esc does not open the menu');
  await tap('KeyK'); assert.ok(await visible('talentsp'), 'K opens the Skill Tree');
  await tap('KeyK'); assert.ok(!(await visible('talentsp')), 'K closes the Skill Tree');
  await tap('KeyP'); assert.ok(await visible('players'), 'P opens Players');
  await tap('KeyP'); assert.ok(!(await visible('players')), 'P closes Players');
  ok('B / I bag, K Skill Tree, P Players toggle; Esc closes an open panel without the menu');

  // ---- the bot wheel: hold V (released on nothing: closes), tap V (stays open), V again closes ----
  await p.keyboard.down('KeyV'); await frames(2);
  assert.ok(await visible('botwheel'), 'holding V opens the wheel');
  await sleep(450); await p.keyboard.up('KeyV'); await frames(2);
  assert.ok(!(await visible('botwheel')), 'releasing a held V on nothing closes it');
  await p.keyboard.down('KeyV'); await p.keyboard.up('KeyV'); await frames(2);
  assert.ok(await visible('botwheel'), 'a quick tap keeps it open');
  await tap('KeyV');
  assert.ok(!(await visible('botwheel')), 'V again closes it');
  ok('V: hold for the bot wheel, tap to keep it open, tap again to close');

  // ---- chat: Enter focuses, keys type instead of playing, Enter sends, Esc leaves ----
  await tap('Enter');
  assert.equal(await S(() => document.activeElement?.id), 'chat-input', 'Enter focuses the chat');
  m = await mark();
  await p.keyboard.type('hi 1 2 b');
  await frames(2);
  assert.equal((await sent(m, 'skill')).length, 0, 'typing digits does not use skills');
  assert.ok(!(await visible('bag')), 'typing b does not open the bag');
  assert.equal(await S(() => window.__fb.state.moveDir), null, 'typing does not move');
  await tap('Enter');
  assert.deepEqual((await sent(m, 'chat')).map(o => o.text), ['hi 1 2 b'], 'Enter sends the line');
  assert.notEqual(await S(() => document.activeElement?.id), 'chat-input', 'and leaves the chat');
  await tap('Enter'); await p.keyboard.type('x'); await tap('Escape');
  assert.notEqual(await S(() => document.activeElement?.id), 'chat-input', 'Esc leaves the chat');
  assert.ok(!(await menuOpen()), 'without opening the menu');
  await S(() => { document.getElementById('chat-input').value = ''; });
  ok('Enter chats: game keys type text, Enter sends, Esc leaves');

  // ---- F3 overlay, wheel zoom ----
  const perf0 = await visible('perf');
  await tap('F3'); assert.equal(await visible('perf'), !perf0, 'F3 toggles the overlay');
  await tap('F3'); assert.equal(await visible('perf'), perf0, 'F3 toggles it back');
  {
    const d0 = await S(() => window.__fb.state.camDist);
    await p.mouse.move(vx, vy); await p.mouse.wheel(0, 300); await frames(2);
    const d1 = await S(() => window.__fb.state.camDist);
    assert.ok(d1 > d0 + 1 || d1 === 22, `wheel zooms out (${d0} -> ${d1})`);
    await p.mouse.wheel(0, -300); await frames(2);
    assert.ok(await S(() => window.__fb.state.camDist) < d1, 'wheel zooms in');
  }
  ok('F3 toggles the overlay, the wheel zooms');

  // ---- Esc with nothing open: the Game Menu, which blocks play ----
  await clearTarget(); await tap('Escape');
  assert.ok(await menuOpen(), 'Esc opens the Game Menu');
  m = await mark();
  await tap('Digit1'); await p.keyboard.down('KeyW'); await frames(3);
  assert.equal(await S(() => window.__fb.state.moveDir), null, 'no moving under the menu');
  await p.keyboard.up('KeyW');
  assert.equal((await sent(m, 'skill')).length, 0, 'no skills under the menu');
  await tap('KeyB'); assert.ok(!(await visible('bag')), 'no hotkeys under the menu');
  await sleep(450); await tap('Escape');
  assert.ok(!(await menuOpen()), 'Esc closes it');
  ok('Esc opens the Game Menu (no moves, skills or hotkeys under it), Esc closes it');

  // ---- classic camera (Settings): clicks attack, right-drag looks, Ctrl+click selects, Ctrl+right-click clears ----
  await tap('Escape'); await p.click('#gamemenu [data-a=settings]');
  await p.click('#settings input[name=cam][value=classic]');
  await p.click('#settings [data-a=close]'); await frames(2);
  assert.equal(await S(() => JSON.parse(localStorage.getItem('fb_settings')).camera), 'classic', 'classic camera saved');
  assert.ok(!(await menuOpen()) && !(await visible('settings')), 'back in the game');
  await keepAlive(); await ready(0); m = await mark();
  const plock = await S(() => window.__plock);
  await p.mouse.move(vx, vy); await p.mouse.down(); await frames(3); await p.mouse.up(); await frames(1);
  assert.ok((await sent(m, 'skill')).some(o => o.slot === 0), 'classic: left click attacks');
  assert.equal(await S(() => window.__plock), plock, 'classic: no pointer lock');
  ok('classic camera: left click attacks without capturing the cursor');
  {
    await clearTarget();
    const y0 = await S(() => window.__fb.state.yaw);
    await p.mouse.move(vx, vy); await p.mouse.down({ button: 'right' }); await p.mouse.move(vx + 100, vy, { steps: 4 }); await p.mouse.up({ button: 'right' }); await frames(1);
    const y1 = await S(() => window.__fb.state.yaw);
    assert.ok(y1 < y0 - 0.2, `classic: right-drag turns the camera (${y0} -> ${y1})`);
  }
  ok('classic camera: right-drag looks');
  {
    // a mob on screen, its middle in screen pixels
    const pick = () => S(() => {
      for (const e of window.__fb.mobs.values()) {
        if (e.dying || e.hidden) continue;
        const g = e.model.group.position, a = window.__fb.project(g.x, g.y + e.model.height / 2, g.z);
        if (a && a[0] > 80 && a[0] < innerWidth - 80 && a[1] > 80 && a[1] < innerHeight - 160) return { id: e.id, x: a[0], y: a[1] };
      }
      return null;
    });
    let t = null;
    for (let i = 0; i < 16 && !(t = await pick()); i++) { await S(() => { window.__fb.state.yaw += Math.PI / 8; }); await frames(2); }
    assert.ok(t, 'a mob on screen');
    await clearTarget();
    await p.keyboard.down('ControlLeft'); await p.mouse.click(t.x, t.y); await p.keyboard.up('ControlLeft'); await frames(1);
    assert.ok(await S(() => window.__fb.state.lock) > 0, 'Ctrl+click selects the enemy under the cursor');
    await p.keyboard.down('ControlLeft'); await p.mouse.click(vx, vy, { button: 'right' }); await p.keyboard.up('ControlLeft'); await frames(1);
    assert.equal(await S(() => window.__fb.state.lock), 0, 'Ctrl+right-click clears the selection');
  }
  ok('Ctrl+click selects, Ctrl+right-click clears');

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`keys: all ${n} checks passed`);
} finally {
  await browser?.close();
  srv.kill();
}
