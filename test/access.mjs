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

  // the film director's slow-mo is exempt from Reduce motion (reduceMotion is still on here)
  const cineSlow = () => S(() => { const f = window.__fb; f.state.spectator = true; f.cine.event({ t: 'cine', op: 'slowmo', secs: 1, scale: 0.4 }); f.state.spectator = false; return f.motion(); });
  assert.ok((await cineSlow()).slowMo > 0, 'cine slow-mo runs under reduce motion');
  assert.equal((await S(() => { window.__fb.slowMotion(1, 0.5); return window.__fb.motion().slowMo; })) > 0, true, 'slowMo still running from cine (the gated call changed nothing)');
  await frames(90);
  ok('reduceMotion: cine.js slow-mo still works');

  // telegraph palette: the real ground telegraph's colours follow the setting (default = today's reds); colour-blind modes add dashes
  const teleCols = () => S(() => {
    const fx = window.__fb.fx, before = fx.list.length;
    fx.telegraph(0, 0, 3, 5);
    const g = fx.list[fx.list.length - 1].mesh, hex = g.children.slice(0, 4).map(m => m.material.color.getHex());
    const dashes = g.children.length - 4;
    fx.end(fx.list[fx.list.length - 1]);
    return { hex, dashes, added: fx.list.length - before };
  });
  const t0 = await teleCols();
  assert.deepEqual(t0.hex, [0x7f1d1d, 0xff2a2a, 0xff3b3b, 0xffd0c0]); assert.equal(t0.dashes, 0);
  await setOpt('palette', 'deuter');
  const t1 = await teleCols();
  assert.deepEqual(t1.hex, [0x5a2d00, 0xffb000, 0xff7a00, 0xffffff]); assert.equal(t1.dashes, 1, 'dashed ring added');
  await setOpt('palette', 'trit');
  assert.equal((await teleCols()).hex[1], 0xff2d7a);
  await setOpt('palette', 'off');
  assert.deepEqual((await teleCols()).hex, t0.hex);
  ok('palette: telegraph colours switch with the setting and default to today\'s');

  // sound cue for telegraphs: a 'tele' event plays the cue only when the option is on
  const teleSound = () => S(() => {
    const f = window.__fb, played = [], orig = f.sfx.play;
    f.sfx.play = (n, ...r) => { played.push(n); return orig.call(f.sfx, n, ...r); };
    f.handleEvent({ t: 'tele', k: 'slam', x: 500, z: 500, r: 3, d: 1 });
    f.sfx.play = orig;
    return played;
  });
  assert.equal((await teleSound()).includes('cue'), false, 'no cue by default');
  await setOpt('telegraphSound', true);
  const pl = await teleSound();
  assert.ok(pl.includes('cue') && pl.includes('warn'), `cue plays with the option on: ${pl}`);
  await setOpt('telegraphSound', false);
  ok('telegraphSound: off by default, a distinct cue when on');

  // Echo (and cracked-ground) telegraphs play the cue too, exactly once
  await setOpt('telegraphSound', true);
  const echoSound = k => S(k => {
    const f = window.__fb, played = [], orig = f.sfx.play;
    f.sfx.play = (n, ...r) => { played.push(n); return orig.call(f.sfx, n, ...r); };
    f.handleEvent({ t: 'tele', k, x: 500, z: 500, r: 3, d: 1 });
    f.sfx.play = orig;
    return played.filter(n => n === 'cue').length;
  }, k);
  assert.equal(await echoSound('echo'), 1, 'echo telegraph plays the cue once');
  assert.equal(await echoSound('crack'), 1, 'crack telegraph plays the cue once');
  assert.equal(await echoSound('slam'), 1, 'slam still plays it once');
  await setOpt('telegraphSound', false);
  assert.equal(await echoSound('echo'), 0, 'no cue when off');
  ok('telegraphSound: Echo and crack telegraphs cue once');

  // Toggle guard: a device switch drops a raised guard
  await setOpt('guardToggle', true);
  await tap('KeyR');
  assert.equal(await S(() => window.__fb.combat.guarding), true, 'guard up');
  await S(() => window.__fb.input.setDevice('touch')); await frames(3);
  assert.equal(await S(() => window.__fb.combat.guarding), false, 'device switch drops the toggled guard');
  await S(() => window.__fb.input.setDevice('kbm'));
  ok('guardToggle: device switch drops the guard');

  // text/UI scale and high contrast, as computed styles
  await setOpt('uiScale', 1.5);
  assert.equal(await S(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()), '1.5');
  assert.equal(await S(() => getComputedStyle(document.getElementById('settings')).zoom), '1.5');
  await setOpt('highContrast', true);
  assert.equal(await S(() => document.documentElement.classList.contains('hc')), true);
  assert.equal(await S(() => getComputedStyle(document.getElementById('settings')).color), 'rgb(255, 255, 255)');
  ok('uiScale zooms panels; highContrast sets the class and brighter text');

  // panels with viewport-unit caps stay on screen at scale 1.5 (zoom also scales vh), and their scroll reaches the last control
  await S(() => { const f = window.__fb; f.state.lvl = Math.max(f.state.lvl, 10); });
  const btnOf = { settings: 'settings-btn', bag: 'bag-btn', talentsp: 'skills-btn', players: 'players-btn', gamemenu: 'menu-btn' };
  const openers = btnOf;
  const fits = id => S(async ([id, btn]) => {
    const f = window.__fb; for (const o of ['settings', 'bag', 'talentsp', 'players', 'gamemenu']) if (f.panels.isOpen(o)) f.panels.close(o);
    if (!f.panels.isOpen(id)) document.getElementById(btn).click();
    await new Promise(r => setTimeout(r, 150));
    const el = document.getElementById(id), r = el.getBoundingClientRect();
    const sc = [el, ...el.querySelectorAll('*')].filter(x => x.scrollHeight > x.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(x).overflowY));
    const last = [...el.querySelectorAll('button, input, select, label')].filter(x => x.offsetParent).pop();
    let reach = true;
    if (last) { for (const x of sc) x.scrollTop = 1e6; reach = last.getBoundingClientRect().bottom <= innerHeight + 1; }
    return { id, bottom: Math.round(r.bottom), vh: innerHeight, reach, shown: r.height > 0 };
  }, [id, btnOf[id]]);
  for (const id of Object.keys(openers)) {
    const r = await fits(id);
    if (!r.shown) { console.log(`  (skip ${id}: not openable here)`); continue; }
    assert.ok(r.bottom <= r.vh + 1, `${id} fits at 1.5: ${JSON.stringify(r)}`);
    assert.ok(r.reach, `${id} scroll reaches the last control at 1.5: ${JSON.stringify(r)}`);
  }
  ok('uiScale 1.5: panels stay within the viewport and scroll to the end');

  // Skill Tree tooltip follows the pointer at scale 1.5 (its left/top are in zoomed units)
  await S(() => { const f = window.__fb; for (const o of ['settings', 'bag', 'talentsp', 'players', 'gamemenu']) if (f.panels.isOpen(o)) f.panels.close(o); document.getElementById('skills-btn').click(); });
  await sleep(200);
  const nodeBox = await S(() => { const r = document.querySelector('#talentsp .tn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(nodeBox.x - 2, nodeBox.y); await p.mouse.move(nodeBox.x, nodeBox.y); await sleep(100);
  const tt = await S(() => { const z = +getComputedStyle(document.getElementById('talentsp')).zoom, r = document.querySelector('#talentsp .tt').getBoundingClientRect(), b = document.getElementById('talentsp').getBoundingClientRect(); return { z, l: r.left, t: r.top, r: r.right, b: r.bottom, bl: b.left, bt: b.top, br: b.right, bb: b.bottom }; });
  const flipped = tt.r <= nodeBox.x + 1; // placed left of the pointer when it would run off the right edge
  if (!flipped) assert.ok(Math.abs(tt.l - (nodeBox.x + 18 * tt.z)) < 4, `tooltip ${JSON.stringify(tt)} should be 18*zoom right of the pointer ${nodeBox.x}`);
  assert.ok(Math.abs(tt.t - (nodeBox.y + 14 * tt.z)) < 4 || tt.b >= tt.bb - 12, `tooltip top ${tt.t} is under the pointer ${nodeBox.y} (or pinned to the bottom)`);
  assert.ok(tt.r <= tt.br + 1 && tt.b <= tt.bb + 1, `tooltip inside the panel: ${JSON.stringify(tt)}`);
  await S(() => window.__fb.panels.close('talentsp'));
  ok('uiScale 1.5: Skill Tree tooltip follows the pointer');

  // stick sensitivity is stored for the pad code; everything is saved under fb_controls.access
  await setOpt('padSens', 2.2);
  assert.deepEqual(await stored(), { sens: 1, invertY: false, padSens: 2.2, guardToggle: true, wheelToggle: true, reduceMotion: true, uiScale: 1.5, highContrast: true, palette: 'off', telegraphSound: false });
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
