// Item cards in a real browser (public/itemcard.js, docs/briefs/item-cards.md): the bag's tabs, compact cards whose
// details and extra buttons open with ⋯ or a tap, the hover card with the comparison, Equip / Use / Delete, the
// merchant's Shop tab (buy, sell), and the Smith's cards (refine, open details).
// Usage: PORT=3895 node test/itemcards.mjs   (in-process server with TEST_HOOKS, no database)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
process.env.PORT ||= '3895'; process.env.TEST_HOOKS = '1'; process.env.DATABASE_URL = ''; process.env.NAMED_ENABLED = '0';
process.env.START_LEVEL = '20'; process.env.SPAWN_AT = '0,8';
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }
const log = console.log; console.log = () => {}; // the server's own lines
await import('../server/index.js');
const { rollGear } = await import('../shared/loot.js');
const { MAT_IDS } = await import('../shared/crafting.js');
const game = globalThis.floorbound.game;
let n = 0;
const ok = name => log(`  ok ${++n} - ${name}`);
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const errors = [];
try {
  async function join(name, touch) {
    const ctx = await b.newContext({ viewport: touch ? { width: 412, height: 860 } : { width: 1280, height: 800 }, hasTouch: !!touch, isMobile: !!touch });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript("localStorage.setItem('fb_tips', '[]')");
    await p.goto(`http://localhost:${process.env.PORT}/?quality=low`);
    await p.fill('#name', name); await p.click('.cls[data-id=swordsman]'); await p.click('#enter');
    await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
    await p.evaluate(() => window.__fb.send({ type: 'test', ward: 1 }));
    const me = [...game.players.values()].find(x => x.name === name);
    return { p, me };
  }
  const place = async (p, me, x, z) => { me.x = x; me.z = z; await p.evaluate(([x, z]) => { __fb.state.x = x; __fb.state.z = z; }, [x, z]); await p.waitForTimeout(600); };
  const S = (p, fn, arg) => p.evaluate(fn, arg);

  const { p, me } = await join('Carda');
  const w = rollGear('weapon', 3, me.cls), a = rollGear('armor', 2, me.cls), c = rollGear('charm', 1, me.cls, Math.random, 'crit');
  const ew = rollGear('weapon', 1, me.cls);
  for (const it of [w, a, c, ew]) game.giveItem(me, it);
  me.inv.bag = me.inv.bag.filter(x => x !== ew); me.inv.eq.weapon = ew;
  me.gold = 3000; me.inv.cons = { potion: 3, tonic: 0, draught: 0 }; for (const k of MAT_IDS.slice(0, 8)) game.matsOf(me)[k] = 6;
  game.recompute(me); game.invChanged(me);
  await p.waitForFunction(n => __fb.state.inv.bag.length === n, me.inv.bag.length);

  await S(p, () => document.getElementById('bag-btn').click());
  await p.waitForSelector('#bag .ic-tabs [data-tab=gear].on');
  const tabs = await S(p, () => [...document.querySelectorAll('#bag .ic-tabs button')].map(x => x.dataset.tab));
  assert.deepEqual(tabs, ['gear', 'supplies', 'build', 'titles'], 'no Shop tab away from the merchant');
  const cards = await S(p, () => document.querySelectorAll('#bag .bag-body .ic[data-tu]').length);
  assert.equal(cards, me.inv.bag.length + 1, 'a card per bag item and the worn weapon');
  const wCard = `#bag .ic[data-tu="${w.u}"]`;
  const sum = await p.textContent(`${wCard} .ic-sum`);
  assert.match(sum, /% DMG/); assert.ok(sum.includes(`+${w.ax.length} bonus`), sum);
  assert.equal(await p.$(`${wCard} .ic-more`), null, 'details closed at first');
  assert.equal(await p.$(`${wCard} [data-a=discard]`), null, 'Delete waits behind ⋯');
  ok('bag: tabs, one compact card per item (short stats, a bonus count), details closed');

  await p.hover(`${wCard} .ic-main`);
  await p.waitForFunction(() => document.getElementById('itemtip').style.display !== 'none');
  const tip = await p.textContent('#itemtip');
  assert.match(tip, /vs your/); assert.match(tip, /% damage/);
  ok('hover card: full stats and the comparison with the worn item');

  await p.click(`${wCard} [data-a=more]`);
  await p.waitForSelector(`${wCard}.open .ic-more [data-a=discard]`);
  const more = await p.textContent(`${wCard} .ic-more`);
  for (const ax of w.ax) assert.ok(more.includes(String(ax.v)), 'affix lines in the open card');
  await p.click(`${wCard} .ic-main`);
  await p.waitForFunction(s => !document.querySelector(s + '.open'), wCard);
  ok('⋯ opens the card (bonus lines, Carry as 2nd, Drop, Delete); a click on the card closes it');

  await p.click(`${wCard} [data-a=equip]`);
  await p.waitForFunction(u => __fb.state.inv.eq.weapon?.u === u, w.u);
  ok('Equip from the card');

  await S(p, () => document.querySelector('#bag [data-tab=supplies]').click());
  await p.waitForSelector('#bag .ic[data-ic="c:potion"] [data-a=use]');
  await S(p, () => __fb.send({ type: 'test', hurt: 0.5 })); await p.waitForTimeout(300);
  await p.click('#bag .ic[data-ic="c:potion"] [data-a=use]');
  await p.waitForFunction(() => __fb.state.inv.cons.potion === 2);
  await p.click('#bag .ic[data-ic="c:potion"] [data-a=more]');
  const del1 = '#bag .ic[data-ic="c:potion"] .ic-btns [data-a=discardStack] >> nth=0';
  await p.click(del1); assert.equal(await p.textContent(del1), 'Sure?');
  await p.click(del1);
  await p.waitForFunction(() => __fb.state.inv.cons.potion === 1);
  ok('Supplies: Use a potion; Delete 1 asks twice');

  // the merchant
  await S(p, () => document.querySelector('#bag [data-a=close]').click());
  await place(p, me, 9, 0);
  await S(p, () => document.getElementById('bag-btn').click());
  await p.waitForSelector('#bag .ic-tabs [data-tab=shop].on');
  const g0 = await S(p, () => __fb.state.gold);
  await p.click('#bag [data-a=buy][data-i="0"]');
  await p.waitForFunction(() => __fb.state.inv.cons.potion === 2);
  await p.click(`#bag [data-a=sell][data-u="${a.u}"]`);
  await p.waitForFunction(u => !__fb.state.inv.bag.some(x => x.u === u), a.u);
  assert.ok(await S(p, () => __fb.state.gold) > g0 - 20, 'sold');
  ok('merchant: opens on the Shop tab; buy a potion, sell from the Sell list');
  await S(p, () => document.querySelector('#bag [data-a=close]').click());

  // the Smith
  await place(p, me, 0, -10);
  await p.mouse.click(640, 400); await p.keyboard.press('KeyF');
  await p.waitForSelector('#smith:not(.hidden) .ic[data-tu]');
  const rb = `#smith .ic[data-tu="${w.u}"] [data-a=refine]`;
  await p.waitForSelector(rb);
  assert.match(await p.textContent(`#smith .ic[data-tu="${w.u}"] .ic-next`), /→ \+1/);
  await p.click(rb);
  await p.waitForFunction(u => __fb.state.inv.eq.weapon?.u === u && __fb.state.inv.eq.weapon.lv === 1, w.u);
  await p.click(`#smith .ic[data-tu="${w.u}"] [data-a=more]`);
  await p.waitForSelector(`#smith .ic[data-tu="${w.u}"].open .ic-more`);
  ok('Smith: refine from the card (next level shown), ⋯ opens the details');
  await p.context().close();

  // a phone: a tap opens the card, no hover card
  const T = await join('Cardb', true);
  const t1 = rollGear('weapon', 2, T.me.cls); game.giveItem(T.me, t1); game.invChanged(T.me);
  await T.p.waitForFunction(u => __fb.state.inv.bag.some(x => x.u === u), t1.u);
  await S(T.p, () => document.getElementById('bag-btn').click());
  await T.p.waitForSelector(`#bag .ic[data-tu="${t1.u}"]`);
  await T.p.tap(`#bag .ic[data-tu="${t1.u}"] .ic-main`);
  await T.p.waitForSelector(`#bag .ic[data-tu="${t1.u}"].open .ic-more [data-a=drop]`);
  assert.equal(await S(T.p, () => document.getElementById('itemtip').style.display), 'none', 'no hover card on a tap');
  ok('phone: a tap opens the card in place (no hover card)');
  assert.deepEqual(errors, [], 'no page errors');
  log('# all passed');
} catch (e) { log(e); process.exitCode = 1; } finally {
  await b.close();
  process.exit(process.exitCode || 0);
}
