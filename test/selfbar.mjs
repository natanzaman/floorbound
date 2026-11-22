// Your bar over your character and the hurt feedback (public/selfbar.js, docs/briefs/selfbar.md), in a real browser:
// the bar follows you with your health, a hit shakes it, leaves a "lost" chunk, pulses the screen edges and tints your
// model red; low health keeps a pulse; a dodge empties the stamina line and it refills; the two settings turn them off.
// Usage: PORT=3897 node test/selfbar.mjs   (in-process server with TEST_HOOKS, no database; SHOTS=<dir> saves screenshots)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
process.env.PORT ||= '3897'; process.env.TEST_HOOKS = '1'; process.env.DATABASE_URL = ''; process.env.NAMED_ENABLED = '0';
process.env.START_LEVEL = '10'; process.env.SPAWN_AT = '0,8';
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }
const log = console.log; console.log = () => {};
await import('../server/index.js');
const SHOTS = process.env.SHOTS; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let n = 0;
const ok = name => log(`  ok ${++n} - ${name}`);
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const errors = [];
try {
  for (const touch of [false, true]) {
    const tag = touch ? 'phone' : 'desk';
    const ctx = await b.newContext({ viewport: touch ? { width: 412, height: 860 } : { width: 1280, height: 800 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: SHOTS ? 2 : 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript("localStorage.setItem('fb_tips', '[]')");
    await p.goto(`http://localhost:${process.env.PORT}/?quality=low`);
    await p.fill('#name', `Bar${tag}`); await p.click('.cls[data-id=swordsman]'); await p.click('#enter');
    await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
    await p.evaluate(() => { window.__fb.send({ type: 'test', ward: 1 }); localStorage.setItem('fb_tips', '[]'); document.querySelectorAll('#tip, #guide').forEach(e => { e.style.display = 'none'; }); });
    await p.waitForSelector('#selfbar:not(.off)');
    const box = await p.evaluate(() => { const r = document.querySelector('#selfbar .sb-hp').getBoundingClientRect(); return [r.x + r.width / 2, r.y, innerWidth, innerHeight]; });
    assert.ok(box[0] > box[2] * 0.25 && box[0] < box[2] * 0.75 && box[1] > 40 && box[1] < box[3] * 0.85, `bar near your character: ${box}`);
    assert.equal(await p.evaluate(() => document.querySelector('#selfbar .sb-fill').style.width), '100%');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${tag}-full.png` });
    ok(`${tag}: the bar shows over your character at full health`);

    // a hit: the server sets your health, then the hurt event
    await p.evaluate(() => { const f = window.__fb; f.send({ type: 'test', hurt: 0.55 }); });
    await p.waitForFunction(() => __fb.state.hp < __fb.state.maxHp * 0.6);
    await p.evaluate(() => { const f = window.__fb; f.handleEvent({ t: 'hurt', id: f.state.myId, a: Math.round(f.state.maxHp * 0.3), big: 1 }); });
    const hit = await p.evaluate(() => ({ shake: document.getElementById('selfbar').classList.contains('hit'), vig: +document.getElementById('hurtfx').style.opacity,
      red: __fb.players.get(__fb.state.myId).hurtRed > 0, big: [...document.querySelectorAll('#labels .num.hurt.big')].length, band: document.getElementById('selfbar').className }));
    assert.ok(hit.shake && hit.vig > 0.3 && hit.red && hit.big >= 1, JSON.stringify(hit));
    assert.match(hit.band, /mid/);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${tag}-hit.png` });
    await p.waitForFunction(() => +document.getElementById('hurtfx').style.opacity === 0, null, { timeout: 5000 }); // the pulse fades
    ok(`${tag}: a big hit shakes the bar, pulses the screen edges, tints you red, shows a big number; the bar turns amber`);

    await p.evaluate(() => window.__fb.send({ type: 'test', hurt: 0.2 }));
    await p.waitForFunction(() => document.getElementById('hurtfx').classList.contains('low') && document.getElementById('selfbar').classList.contains('low'));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${tag}-low.png` });
    ok(`${tag}: under 30% the bar is red and the edges keep a slow pulse`);

    // a dodge empties the stamina line, then it refills
    await p.evaluate(() => __fb.dodge());
    await p.waitForTimeout(250);
    const s1 = await p.evaluate(() => parseFloat(document.querySelector('#selfbar .sb-st i').style.width));
    await p.waitForFunction(() => document.querySelector('#selfbar .sb-st i').style.width === '100%', null, { timeout: 8000 });
    const s2 = await p.evaluate(() => parseFloat(document.querySelector('#selfbar .sb-st i').style.width));
    assert.ok(s1 < 40 && s2 === 100, `stamina ${s1} → ${s2}`);
    ok(`${tag}: the stamina line empties on a dodge and refills`);

    // settings off
    await p.evaluate(() => { const s = window.__fb.settings; s.hideSelfBar = true; s.noHurtFlash = true; });
    await p.waitForTimeout(200);
    const off = await p.evaluate(() => [document.getElementById('selfbar').classList.contains('off'), document.getElementById('hurtfx').classList.contains('low')]);
    assert.deepEqual(off, [true, false]);
    ok(`${tag}: the two settings hide the bar and the red flash`);
    await ctx.close();
  }
  assert.deepEqual(errors, [], 'no page errors');
  log('# all passed');
} catch (e) { log(e); process.exitCode = 1; } finally {
  await b.close();
  process.exit(process.exitCode || 0);
}
