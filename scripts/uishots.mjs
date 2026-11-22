// Screenshots of the bag, the merchant and the Smith with a full bag (item cards, docs/briefs/item-cards.md).
// Usage: OUT=/some/dir PORT=3893 node scripts/uishots.mjs   (TABS=supplies,build: shoot those bag tabs too)   (in-process server, TEST_HOOKS; no database)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';
process.env.PORT ||= '3893'; process.env.TEST_HOOKS = '1'; process.env.DATABASE_URL = ''; process.env.NAMED_ENABLED = '0';
process.env.START_LEVEL = '20'; process.env.SPAWN_AT ||= '9,0';
const OUT = process.env.OUT || '/tmp/uishots'; mkdirSync(OUT, { recursive: true });
await import('../server/index.js');
const { rollGear, makeSetPiece } = await import('../shared/loot.js');
const { lastAttackItem } = await import('../shared/items.js');
const { MAT_IDS } = await import('../shared/crafting.js');
const game = globalThis.floorbound.game;
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
async function place(p, me, x, z) { me.x = x; me.z = z; await p.evaluate(([x, z]) => { __fb.state.x = x; __fb.state.z = z; }, [x, z]); await p.waitForTimeout(700); }
async function shoot(tag, viewport, touch) {
  console.log('shoot', tag);
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 2, hasTouch: !!touch, isMobile: !!touch });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.addInitScript("localStorage.setItem('fb_tips', '[]')");
  await p.goto(`http://localhost:${process.env.PORT}/?quality=low`);
  await p.fill('#name', `Shot${tag}`); await p.click('.cls[data-id=swordsman]'); await p.click('#enter');
  console.log('joining'); await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  const me = [...game.players.values()].find(x => x.name === `Shot${tag}`);
  const cls = me.cls;
  const items = [rollGear('weapon', 3, cls), rollGear('armor', 2, cls), rollGear('charm', 1, cls, Math.random, 'crit'), rollGear('weapon', 0, cls), rollGear('armor', 3, cls),
    rollGear('weapon', 2, 'guardian'), rollGear('charm', 3, cls, Math.random, 'haste'), lastAttackItem?.('weapon', cls) || rollGear('weapon', 3, cls)];
  const set = Object.keys((await import('../shared/loot.js')).SETS)[0];
  for (const s of ['weapon', 'armor', 'charm']) { const it = makeSetPiece(set, s, cls); if (it) items.push(it); }
  for (const it of items) if (it) game.giveItem(me, it);
  const eqw = rollGear('weapon', 2, cls); game.giveItem(me, eqw); me.inv.bag = me.inv.bag.filter(x => x !== eqw); me.inv.eq.weapon = eqw;
  me.gold = 2500; for (const k of MAT_IDS.slice(0, 8)) game.matsOf(me)[k] = 6; me.inv.cons = { potion: 5, tonic: 2, draught: 0 };
  game.recompute(me); game.invChanged(me);
  await p.waitForTimeout(800);
  // the bag, out of the merchant's reach
  await place(p, me, 0, 8);
  await p.evaluate(() => document.getElementById('bag-btn').click());
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/${tag}-bag.png` });
  for (const t of (process.env.TABS || '').split(',').filter(Boolean)) { await p.evaluate(t => document.querySelector(`#bag [data-tab=${t}]`)?.click(), t); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${tag}-bag-${t}.png` }); }
  await p.evaluate(() => document.querySelector('#bag [data-tab=gear]')?.click());
  const row = await p.$('#bag .ic[data-tu] .ic-main, #bag .it[data-tu]');
  if (row) { if (touch) await row.tap(); else { await row.hover(); } await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${tag}-bag-detail.png` }); }
  await p.evaluate(() => document.querySelector('#bag .bag-body .ic[data-tu]:not(.open) [data-a=more]')?.click()); await p.mouse.move(5, 5);
  await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${tag}-bag-open.png` });
  await p.evaluate(() => document.querySelector('#bag [data-a=close]')?.click());
  // the merchant
  await place(p, me, 9, 0);
  await p.evaluate(() => document.getElementById('bag-btn').click());
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/${tag}-shop.png` });
  await p.evaluate(() => document.querySelector('#bag [data-a=close]')?.click());
  // the Smith
  await place(p, me, 0, -10);
  await p.evaluate(() => __fb.send && document.querySelector('#smith') && null);
  await p.mouse.click(viewport.width / 2, viewport.height / 2); await p.keyboard.press('KeyF'); await p.waitForTimeout(500);
  for (const t of ['refine', 'craft', 'salvage', 'reforge', 'reroll']) {
    await p.evaluate(tab => document.querySelector(`#smith [data-t=${tab}]`)?.click(), t);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${tag}-smith-${t}.png` });
  }
  await ctx.close();
}
await shoot('desk', { width: 1280, height: 800 });
await shoot('phone', { width: 412, height: 860 }, true);
await b.close();
console.log('done', OUT);
process.exit(0);
