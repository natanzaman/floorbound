// Duels in a real browser (public/duels.js): two players; A opens Players → Duel on B, picks First Strike, sends it;
// B gets the challenge card and accepts; both see the duel bar and the ring; A sees B's stand-in (and B's name plate
// turns red) and nobody else's; A's swing lands and First Strike ends it: VICTORY on A's screen, the bar says won.
// Both join in town (no monsters there; duels are allowed in town).
// Usage: node test/duels.mjs   (starts its own server; PORT=xxxx, default 3946)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright'); // (not a dependency: npm i --no-save playwright, or point PLAYWRIGHT at its index.mjs)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3946, base = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), START_LEVEL: '10', DATABASE_URL: '', NAMED_ENABLED: '0', TEST_HOOKS: '1' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
const ok = (c, what) => { n++; console.log(`  ${c ? 'ok' : 'NOT OK'} ${n} - ${what}`); if (!c) failed++; };
let browser;
try {
  await sleep(2500);
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  async function join(name, cls) {
    const p = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    p.on('pageerror', e => errors.push(`${name}: ${e}`));
    await p.goto(`${base}/?quality=low`);
    await p.fill('#name', name); await p.click(`.cls[data-id=${cls}]`); await p.click('#enter');
    await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
    return p;
  }
  const A = await join('Alder', 'swordsman'), B = await join('Birch', 'guardian');
  const bId = await B.evaluate(() => window.__fb.state.myId), aId = await A.evaluate(() => window.__fb.state.myId);
  await A.waitForFunction(id => window.__fb.players.has(id), bId, { timeout: 20000 });
  await A.evaluate(() => document.getElementById('players-btn').click());
  await A.waitForSelector(`#players [data-duel="${bId}"]`, { timeout: 10000 });
  ok(true, 'Players list: a Duel button on the other player');
  await A.click(`#players [data-duel="${bId}"]`);
  await A.waitForSelector('#duel-pick:not(.hidden)');
  ok(await A.evaluate(() => /DUEL BIRCH/.test(document.querySelector('#duel-pick h3').textContent) && document.querySelector('#duel-pick [data-k=team]').disabled), 'the picker: rules, Solo, Party vs party off without two parties');
  await A.click('#duel-pick [data-r=first]');
  await A.click('#duel-pick .dp-go');
  await B.waitForSelector('#duel-in:not(.hidden)', { timeout: 10000 });
  ok(await B.evaluate(() => /Alder/.test(document.getElementById('duel-in').textContent) && /First Strike/.test(document.getElementById('duel-in').textContent)), 'B gets the challenge card (who, which rule)');
  await B.click('#duel-in .di-yes');
  for (const [P, who] of [[A, 'A'], [B, 'B']]) await P.waitForSelector('#duel-hud:not(.hidden)', { timeout: 10000 }).then(() => ok(true, `${who}: the duel bar shows`));
  ok(await A.evaluate(() => /starts in|0:/.test(document.querySelector('#duel-hud .dh-top').textContent)), 'the bar counts down');
  // FIGHT: A sees B's stand-in
  await A.waitForFunction(() => [...window.__fb.mobs.values()].some(m => m.type === 'duelist'), null, { timeout: 10000 });
  const stand = await A.evaluate(id => { const m = [...window.__fb.mobs.values()].filter(m => m.type === 'duelist'); return { n: m.length, owner: window.__fb.duels.ownerOf(m[0].id) }; }, bId);
  ok(stand.n === 1 && stand.owner === bId, 'A sees exactly one stand-in: B\'s');
  ok(await A.evaluate(id => window.__fb.players.get(id).label.el.classList.contains('foe'), bId), 'B\'s name plate is red on A\'s screen');
  ok(await A.evaluate(() => window.__fb.scene.children.some(o => o.geometry?.type === 'RingGeometry' && o.geometry.parameters.outerRadius > 10)), 'a ring on the ground');
  // A walks up to B and swings
  const bp = await B.evaluate(() => ({ x: window.__fb.state.x, z: window.__fb.state.z }));
  await A.evaluate(({ x, z }) => { const s = window.__fb.state; s.x = x; s.z = z - 1.5; s.face = 0; }, bp); // (the client sends where it stands; the server walks it there)
  await sleep(1500);
  let done = false;
  for (let i = 0; i < 20 && !done; i++) {
    await A.evaluate(() => window.__fb.send({ type: 'skill', slot: 0, face: 0 }));
    await sleep(350);
    done = await A.evaluate(() => /OVER/.test(document.querySelector('#duel-hud .dh-top')?.textContent || ''));
  }
  ok(done, 'A\'s swing lands: First Strike ends the duel');
  ok(await A.evaluate(() => /won/.test(document.querySelector('#duel-hud .dh-top').textContent) && /VICTORY/.test(document.getElementById('callout').textContent)), 'A: VICTORY, the bar says won');
  ok(await B.evaluate(() => /lost/.test(document.querySelector('#duel-hud .dh-top').textContent)), 'B: the bar says lost');
  await A.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'duel-end.png') });
  await sleep(4800);
  ok(await A.evaluate(() => document.getElementById('duel-hud').classList.contains('hidden') && ![...window.__fb.mobs.values()].some(m => m.type === 'duelist')), 'after a moment the bar and stand-ins are gone');
  ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  void aId;
} catch (e) { failed++; console.log('  NOT OK - ' + (e.stack || e)); }
finally { await browser?.close(); srv.kill(); }
console.log(failed ? `\n${failed} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
