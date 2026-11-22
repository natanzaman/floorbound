// Screenshots of the art styles (public/artlook.js): a line-up of every class, and wide shots of the scenery, the same
// frame in every style. Usage: PLAYWRIGHT=<playwright index.mjs> OUT=<dir> node scripts/artshots.mjs
//   env: ARTS=<char>[:<env>],...  e.g. classic,cel,hero:alpine  SHOTS=lineup,close,world  SPAWN_AT=x,z  YAW=  TAG=  W=1280 H=720 PORT=3798  LOOK=<effects style>
// Like scripts/lookshots.mjs it runs the page on a stepped clock, so every style is shot at the same moment.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3798, base = `http://localhost:${PORT}`;
const OUT = process.env.OUT || '/tmp/artshots', W = Number(process.env.W) || 1280, H = Number(process.env.H) || 720;
const TAG = process.env.TAG || '', YAW = Number(process.env.YAW ?? 3.14);
fs.mkdirSync(OUT, { recursive: true });
const arts = (process.env.ARTS || 'classic').split(',');
const SHOTS = { // cam: [yaw offset, pitch, distance]; line: put the class line-up d metres ahead (0 = none)
  lineup: { cam: [0, 0.16, 3.2], line: 5.5 },
  close: { cam: [0, 0.14, 0.2], line: 3.6, only: 3 },
  world: { cam: [0, 0.22, 11], line: 0 },
  wide: { cam: [0.9, 0.3, 15], line: 0 },
};
const shots = (process.env.SHOTS || 'close,lineup,world').split(',');
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), START_LEVEL: '10', ...(process.env.SPAWN_AT ? { SPAWN_AT: process.env.SPAWN_AT } : {}), DATABASE_URL: '', NAMED_ENABLED: '0', TEST_HOOKS: '1' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  await sleep(2500);
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGE ERROR', String(e)));
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window), real = performance.now.bind(performance);
    const S = window.__step = { hold: false, t: 0, q: [] };
    performance.now = () => (S.hold ? S.t : real());
    const run = () => { const q = S.q; S.q = []; S.t += 1000 / 60; for (const cb of q) cb(S.t); };
    window.requestAnimationFrame = cb => { if (!S.hold) return raf(cb); S.q.push(cb); return 0; };
    S.start = () => { S.t = real(); S.hold = true; };
    S.go = n => new Promise(res => { let k = 0; const tick = () => { if (k++ >= n) return res(); run(); raf(tick); }; raf(tick); });
    S.skip = n => { const r = window.__fb.renderer, draw = r.render; r.render = () => {}; try { for (let k = 0; k < n; k++) run(); } finally { r.render = draw; } };
  });
  for (const art of arts) { // (an art style is fixed when the world is built: one page load each)
    await p.goto(`${base}/?quality=high&char=${art.split(':')[0]}&env=${art.split(':')[1] || 'classic'}${process.env.LOOK ? `&look=${process.env.LOOK}` : ''}`);
    await p.waitForFunction(() => window.__fb?.input && !document.getElementById('enter').disabled, null, { timeout: 180000 });
    await p.fill('#name', 'Kirin'); await p.click('.cls[data-id=swordsman]'); await p.click('#enter');
    await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
    await p.evaluate(() => { const f = window.__fb; f.send({ type: 'test', ward: 1 }); f.settings.reduceMotion = true; f.settings.perf = false; });
    await p.addStyleTag({ content: 'body > *:not(#view) { visibility: hidden !important; }' });
    await sleep(2500);
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => { window.__step.start(); r(); })));
    for (const sh of shots) {
      const S = SHOTS[sh];
      await p.evaluate(async ({ S, YAW }) => {
        const f = window.__fb, s = f.state, W = await import('/world.js');
        s.yaw = s.face = YAW + S.cam[0]; s.pitch = S.cam[1]; s.camDist = S.cam[2];
        for (const m of window.__line || []) f.scene.remove(m.group);
        window.__line = [];
        const me = f.players.get(s.myId); me.model.group.visible = !S.line;
        if (!S.line) return;
        let cls = ['guardian', 'berserker', 'cleric', 'swordsman', 'ranger', 'lancer', 'bard'];
        if (S.only) cls = cls.slice(2, 2 + S.only);
        const fx = Math.sin(YAW), fz = Math.cos(YAW), rx = Math.cos(YAW), rz = -Math.sin(YAW), gap = S.only ? 1.5 : 1.9;
        cls.forEach((c, i) => {
          const m = W.makePlayerModel(c), o = (i - (cls.length - 1) / 2) * gap;
          m.group.position.set(s.x + fx * S.line + rx * o, 0, s.z + fz * S.line + rz * o);
          m.group.rotation.y = YAW + Math.PI + o * 0.06; if (m.cursor) m.cursor.visible = false;
          f.scene.add(m.group); window.__line.push(m);
        });
        window.__lineTick ||= setInterval(() => {}, 1e9);
      }, { S, YAW });
      await p.evaluate(() => { window.__step.skip(240); for (const m of window.__line) m.anim?.update?.(0.8); });
      await p.evaluate(() => window.__step.go(1));
      await p.screenshot({ path: path.join(OUT, `${TAG}${sh}-${art.replace(':', '_')}.png`) });
      console.log(`shot ${sh}-${art}`);
    }
  }
} catch (e) { console.log('FAILED ' + (e.stack || e)); process.exitCode = 1; }
finally { await browser?.close(); srv.kill(); }
