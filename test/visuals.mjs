// The visuals pass in a real browser (public/post.js, public/vfx.js, public/sparks.js): bloom turns on and off without
// compiling a shader and without changing the picture's colours; the 3D effects, trails and impact flashes run from
// pooled batches (a handful of draw calls, no geometry made per effect); Low gets none of it; Reduce motion stops the
// camera kick; the Combos 2.0 events (chain, chainEnd, tcall, combo self, tburst cls / nm) render and never throw.
// Usage: node test/visuals.mjs   (starts its own server; PORT=xxxx, default 3791; SHOT_DIR for the screenshots)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright'); // (not a dependency: npm i --no-save playwright, or point PLAYWRIGHT at its index.mjs)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3791, base = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), START_LEVEL: '10', SPAWN_AT: '0,140', DATABASE_URL: '', NAMED_ENABLED: '0', TEST_HOOKS: '1' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
const ok = (c, what) => { n++; console.log(`  ${c ? 'ok' : 'NOT OK'} ${n} - ${what}`); if (!c) failed++; };
let browser;
try {
  await sleep(2500);
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  const p = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(`${base}/?quality=high`);
  await p.waitForFunction(() => window.__fb?.input && !document.getElementById('enter').disabled, null, { timeout: 120000 });
  await p.fill('#name', 'Vis'); await p.click('.cls[data-id=swordsman]'); await p.click('#enter');
  await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  await p.setViewportSize({ width: 480, height: 320 }); // (small: headless rendering is slow)
  await p.evaluate(() => { const f = window.__fb; f.send({ type: 'test', ward: 1 }); f.settings.reduceMotion = false; f.state.yaw = f.state.face = 2.2; });
  const frames = k => p.evaluate(k => new Promise(r => { let i = 0; const t = () => (++i > k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), k);
  await frames(4);

  // --- bloom on / off: same shaders, same colours ---
  await p.evaluate(() => { // the mean colour of a patch of ground low on the screen (nothing glows there)
    window.__px = () => {
      const c = document.getElementById('view'), t = document.createElement('canvas'); t.width = 16; t.height = 16;
      const g = t.getContext('2d'); g.drawImage(c, c.width * 0.1, c.height * 0.8, 32, 32, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return [r / 256, gg / 256, b / 256];
    };
  });
  const grab = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => r(window.__px())))); // (right after the game's own frame)
  const progs = () => p.evaluate(() => window.__fb.renderer.info.programs.length);
  ok(await p.evaluate(() => window.__fb.Q.post === true && window.__fb.Q.trails > 0 && window.__fb.Q.fx3d === true), 'High: bloom, trails and 3D effects are on');
  await frames(3);
  const n0 = await progs(), withBloom = await grab();
  await p.evaluate(() => { window.__fb.Q.post = false; });
  await frames(3);
  const n1 = await progs(), plain = await grab();
  await p.evaluate(() => { window.__fb.Q.post = true; });
  await frames(3);
  const n2 = await progs();
  ok(n0 === n1 && n1 === n2, `turning bloom off and on compiles no shader (${n0} → ${n1} → ${n2})`);
  const diff = Math.max(...withBloom.map((v, i) => Math.abs(v - plain[i])));
  ok(diff < 6, `the ground keeps its colour under bloom + tone mapping (largest channel difference ${diff.toFixed(1)} of 255)`);

  // --- the effects: pooled, few draw calls ---
  await p.evaluate(() => {
    const f = window.__fb, s = f.state, me = s.myId, ev = e => f.handleEvent(e), fwd = d => ({ x2: s.x + Math.sin(s.face) * d, z2: s.z + Math.cos(s.face) * d });
    f.slowMotion(20, 0.05, { force: true }); // (hold the effects on screen while we count)
    ev({ t: 'fx', k: 'ring', s: 'whirl', id: me, x: s.x, z: s.z, f: s.face, r: 4 });
    ev({ t: 'fx', k: 'ring', s: 'gslam', c: 'gold', id: me, x: s.x, z: s.z, f: s.face, r: 5 });
    ev({ t: 'fx', k: 'rush', s: 'rush', id: me, x: s.x, z: s.z, f: s.face, ...fwd(8) });
    ev({ t: 'fx', k: 'arc', s: 'burst', n: 3, c: 'gold', id: me, x: s.x, z: s.z, f: s.face, r: 3.4 });
    ev({ t: 'fx', k: 'ca', v: 'cleave', s: 'cleave', id: me, x: s.x, z: s.z, f: s.face, r: 4.5, h: 1.2, rage: 30 });
    ev({ t: 'fx', k: 'ca', v: 'slam', id: me, x: s.x, z: s.z, r: 4.5, big: 1 });
    ev({ t: 'fx', k: 'ca', v: 'loose', id: me, x: s.x, z: s.z, f: s.face, r: 26 });
    ev({ t: 'fx', k: 'cb', ev: 'skymark', ev2: 'skylance', id: me, x: s.x, z: s.z, f: s.face, ...fwd(6), d: 0.6, r: 4 });
    ev({ t: 'fx', k: 'cb', ev: 'skyland', id: me, x: s.x, z: s.z, f: s.face, r: 4 });
    ev({ t: 'fx', k: 'cb', ev: 'dissonance', id: me, x: s.x, z: s.z, f: s.face, r: 8, h: 0.7 });
    ev({ t: 'tburst', key: me, ids: [me], n: 3, x: s.x, z: s.z, m: 0, cls: ['swordsman', 'guardian', 'cleric', 'ranger', 'berserker', 'lancer', 'bard'], pk: 'guardian+swordsman', nm: 'Aegis Edge' });
    ev({ t: 'combo', id: 0, by: me, from: me, self: 1, k: 'crosscut', n: 1, x: s.x, z: s.z });
    ev({ t: 'combo', id: 0, by: me, from: 0, k: 'aftershock', n: 2, x: s.x, z: s.z });
    for (const k of ['verdict', 'downbeat', 'skewer', 'somethingnew']) ev({ t: 'combo', id: 0, by: 0, from: 0, k, n: 1, x: s.x, z: s.z });
  });
  await frames(3);
  const st = await p.evaluate(() => window.__fb.vfx.stats());
  ok(st.bands > 5 && st.blades > 5 && st.lances > 5 && st.shards > 5 && st.domes === 1, `every big skill and a seven-class burst at once: ${JSON.stringify(st)}`);
  ok(st.draws <= 7, `all of it is drawn in ${st.draws} draw calls (five batches, the trails, the sparks: at most 7)`);
  await p.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'visuals-all.png') });
  await p.evaluate(() => window.__fb.slowMotion(0.01, 1, { force: true }));
  await sleep(2500); await frames(3);
  const idle = await p.evaluate(() => window.__fb.vfx.stats());
  ok(idle.bands + idle.blades + idle.lances + idle.shards + idle.domes === 0, 'the batches empty out');

  // --- the camera never zooms or shakes for hits, combos, chains or bursts (owner's rule: shake is for the ground shaking) ---
  const big = by => p.evaluate(by => { const f = window.__fb, m = [...f.mobs.values()].find(m => !m.def?.boss && !m.dying); if (!m) return null;
    const fov0 = f.camera.fov;
    f.handleEvent({ t: 'hit', id: m.id, by, a: 12, h: 1, c: 1 });
    f.handleEvent({ t: 'combo', id: m.id, by, from: 0, k: 'crosscut', n: 1, x: m.x, z: m.z });
    f.handleEvent({ t: 'chain', id: by, n: 4, k: 'stormburst', nm: 'Storm Burst', s: 'burst' });
    f.handleEvent({ t: 'tburst', key: by, ids: [by], n: 3, x: m.x, z: m.z, m: m.id, cls: ['lancer', 'ranger'], nm: 'Rain of Spears' });
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ fov: f.camera.fov - fov0, shake: f.motion().shakeAmt }))));
  }, by);
  await p.evaluate(() => { const s = window.__fb.state; s.z = 120; }); // (out on the field: enemies in view)
  await p.waitForFunction(() => [...window.__fb.mobs.values()].some(m => !m.def?.boss), null, { timeout: 30000 });
  await sleep(800);
  const r = await big(await p.evaluate(() => window.__fb.state.myId));
  ok(r && r.fov === 0 && r.shake < 0.02, `my heavy crit, combo, x4 chain and Team Burst: no zoom, no shake (${JSON.stringify(r)})`);
  ok(await p.evaluate(() => { window.__fb.shake(0.4); return window.__fb.motion().shakeAmt >= 0.35; }), 'ground shaking (shake()) still works');
  await p.evaluate(() => { window.__fb.settings.reduceMotion = true; });
  await sleep(600);
  ok(await p.evaluate(() => { window.__fb.shake(0.4); return window.__fb.motion().shakeAmt < 0.02; }), 'Reduce motion: no shake');
  await p.evaluate(() => { window.__fb.settings.reduceMotion = false; });

  // --- chain counter, call-out bubbles ---
  const chain = await p.evaluate(() => { const f = window.__fb, me = f.state.myId; f.handleEvent({ t: 'chain', id: me, n: 3, k: 'x', s: 'whirl', name: 'Rising Edge', x: f.state.x, z: f.state.z }); const el = document.getElementById('chain-hud'); return { text: el.textContent, on: el.classList.contains('on'), n: f.vfx.chainN(me) }; });
  ok(chain.on && /CHAIN x3/.test(chain.text) && /Rising Edge/.test(chain.text) && chain.n === 3, `the chain counter by my character: "${chain.text}"`);
  const plainChain = await p.evaluate(() => { const f = window.__fb; f.handleEvent({ t: 'chain', id: f.state.myId, n: 2, k: '', s: 'fin' }); return document.getElementById('chain-hud').textContent; });
  ok(plainChain.trim() === 'CHAIN x2', `an unnamed link: "${plainChain}"`);
  ok(await p.evaluate(() => { const f = window.__fb; f.handleEvent({ t: 'chainEnd', id: f.state.myId }); return f.vfx.chainN(f.state.myId) === 0; }), 'chainEnd clears it');
  const chatBefore = await p.evaluate(() => document.getElementById('log').children.length);
  await p.evaluate(() => { const f = window.__fb; f.handleEvent({ t: 'tcall', id: f.state.myId, text: 'Launching!' }); });
  await frames(2);
  ok(await p.evaluate(() => [...document.querySelectorAll('.bubble.call')].some(b => b.textContent === 'Launching!')), 'a call-out shows as a bubble');
  ok(chatBefore === await p.evaluate(() => document.getElementById('log').children.length), '... and not in the chat log');

  // --- Low: none of it ---
  await p.evaluate(() => window.__fb.applyQuality('low'));
  await frames(2);
  const low = await p.evaluate(() => {
    const f = window.__fb, s = f.state, me = s.myId;
    f.handleEvent({ t: 'fx', k: 'ring', s: 'gslam', c: 'gold', id: me, x: s.x, z: s.z, f: s.face, r: 5 });
    f.handleEvent({ t: 'tburst', key: me, ids: [me], n: 2, x: s.x, z: s.z, m: 0, cls: ['guardian', 'bard'] });
    const st = f.vfx.stats();
    return { post: f.Q.post, n: st.bands + st.blades + st.lances + st.shards + st.domes };
  });
  ok(low.post === false && low.n === 0, 'Low: no bloom, no 3D effects (the flat rings only, as before)');
  ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) { failed++; console.log('  NOT OK - ' + (e.stack || e)); }
finally { await browser?.close(); srv.kill(); }
console.log(failed ? `\n${failed} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
