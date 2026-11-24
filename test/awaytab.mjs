// Away from the tab (public/main.js skipAhead): a hidden tab gets no animation frames while snapshots keep arriving, so
// effects, damage numbers and slow motion spawned meanwhile must not pile up and play at once on return.
// The test holds requestAnimationFrame back (as a hidden tab does), spawns a burst of effects, and checks that they are
// aged away while "hidden" (as snapshots arrive) and that the first frame back starts clean.
// Usage: PORT=3898 node test/awaytab.mjs   (in-process server, no database)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
process.env.PORT ||= '3898'; process.env.DATABASE_URL = ''; process.env.NAMED_ENABLED = '0'; process.env.RESIDENTS = '0';
process.env.START_LEVEL = '10'; process.env.SPAWN_AT = '0,8';
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }
const log = console.log; console.log = () => {};
await import('../server/index.js');
let n = 0;
const ok = name => log(`  ok ${++n} - ${name}`);
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const p = await (await b.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => { // a switch that holds animation frames back, as a hidden tab does
    const raf = window.requestAnimationFrame.bind(window), held = [];
    window.__rafPause = false;
    window.requestAnimationFrame = cb => { if (window.__rafPause) { held.push(cb); return 0; } return raf(cb); };
    window.__rafResume = () => { window.__rafPause = false; for (const cb of held.splice(0)) raf(cb); };
    localStorage.setItem('fb_tips', '[]');
  });
  await p.goto(`http://localhost:${process.env.PORT}/?quality=low`);
  await p.fill('#name', 'Away'); await p.click('.cls[data-id=swordsman]'); await p.click('#enter');
  await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  await p.waitForTimeout(1500);

  const burst = () => p.evaluate(() => { // what a minute of fighting nearby leaves behind: rings, sparks, numbers, a slow-mo
    const f = window.__fb, me = f.players.get(f.state.myId);
    for (let i = 0; i < 300; i++) { f.fx.ring(i % 10, i % 7, 2, 0xffffff, 1); f.fx.sparks(0, 1, 0, 6); }
    for (let i = 0; i < 20; i++) f.handleEvent({ t: 'evade', id: f.state.myId, k: 'roll' });
    f.handleEvent({ t: 'hurt', id: f.state.myId, a: 5 });
    f.slowMotion(5, 0.2, { force: true });
    return { fx: f.fx.list.length, nums: document.querySelectorAll('#labels .num').length, me: !!me };
  });
  const look = () => p.evaluate(() => ({ fx: __fb.fx.list.length, nums: document.querySelectorAll('#labels .num').length, ...__fb.motion() }));

  // hidden: no frames; snapshots keep coming
  await p.evaluate(() => { window.__rafPause = true; });
  await p.waitForTimeout(300);
  const b1 = await burst();
  assert.ok(b1.fx >= 300, `burst spawned: ${JSON.stringify(b1)}`);
  await p.waitForTimeout(2500); // a couple of seconds of snapshots, still no frame
  const away = await look();
  assert.ok(away.fx < 20, `effects aged away while hidden: ${JSON.stringify(away)}`);
  assert.equal(away.nums, 0, 'damage numbers gone while hidden');
  ok('while hidden, effects spawned by events are aged away as snapshots arrive (no pile-up)');

  // a last burst right before coming back, then the first frame back
  await burst();
  await p.evaluate(() => window.__rafResume());
  await p.waitForFunction(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
  const back = await look();
  assert.ok(back.fx < 5, `first frames back start clean: ${JSON.stringify(back)}`);
  assert.equal(back.nums, 0);
  assert.equal(back.slowMo, 0); assert.equal(back.hitStop, 0);
  ok('the first frame back skips what was missed: no burst of effects, numbers or slow motion');

  // normal play is untouched: effects spawned while visible live their life
  const live = await p.evaluate(() => { __fb.fx.ring(0, 0, 2, 0xffffff, 1); return __fb.fx.list.length; });
  await p.waitForTimeout(150);
  assert.ok(await p.evaluate(() => __fb.fx.list.length) >= 1 && live >= 1, 'a fresh effect still shows');
  ok('while the tab is visible, effects play as before');
  assert.deepEqual(errors, []);
} catch (e) {
  log(`not ok - ${e.message}`); await b.close(); process.exit(1);
}
await b.close();
log(`1..${n}`);
process.exit(0);
