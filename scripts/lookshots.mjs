// Screenshots of every effects style (public/fxlook.js) in the same staged scenes, for side by side comparison.
// Usage: PLAYWRIGHT=/path/to/playwright/index.mjs OUT=<dir> node scripts/lookshots.mjs   (LOOKS=ember,neon SCENES=burst W=1280 H=720 PORT=3795)
// It starts its own server (anonymous, TEST_HOOKS) and joins as a Swordsman. The page's clock is replaced by a stepped
// one (one frame = 1/60 s, advanced only when asked), so every look is shot at exactly the same moment of the same
// effect: for each look and scene it reseeds Math.random (the same sparks and rocks), plays the scene's events, steps
// `at` frames and saves <OUT>/<TAG><scene>-<look>.png. With CLIP=<scene> it saves every frame instead
// (<OUT>/clip-<scene>-<look>/f%03d.png, FRAMES of them) for ffmpeg. Headless software rendering: fine for pictures,
// useless for frame times. SPAWN_AT=x,z picks the backdrop (Floor 2 and 3 work), TAG prefixes the file names.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3795, base = `http://localhost:${PORT}`;
const OUT = process.env.OUT || '/tmp/lookshots', W = Number(process.env.W) || 1280, H = Number(process.env.H) || 720;
fs.mkdirSync(OUT, { recursive: true });
const { LOOK_IDS } = await import(path.join(root, 'public/fxlook.js'));
const looks = (process.env.LOOKS || LOOK_IDS.join(',')).split(',');
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), START_LEVEL: '10', ...(process.env.SPAWN_AT ? { SPAWN_AT: process.env.SPAWN_AT } : {}), DATABASE_URL: '', NAMED_ENABLED: '0', TEST_HOOKS: '1' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Each scene: stage runs in the page (f = window.__fb, s = f.state, me, ev = f.handleEvent, P = my player) at frame 0;
// `at`: the frame (1/60 s each) the still is taken at; cam: [yaw, pitch]; more: { frame: code } run at later frames.
const CAMY = Number(process.env.YAW ?? 3.14); // which way the camera (and the character) faces
const SWING = n => `P.model.anim.shot(${JSON.stringify(['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'][n])}, ${n === 2 ? 1.6 : 2.0});`;
const SCENES = {
  trail: { at: 15, cam: [CAMY + 0.4, 0.3], dist: 6.5, stage: SWING(1), frames: 150,
    more: { 28: SWING(0), 56: SWING(2) + `ev({ t: 'chain', id: me, n: 3, k: 'x', s: 'fin', x: s.x, z: s.z });`, 70: `ev({ t: 'fx', k: 'arc', fin: 1, n: 2, id: me, x: s.x, z: s.z, f: s.face, r: 3.2 }); HIT(2.4, 1);` } },
  hit: { at: 5, cam: [CAMY, 0.3], dist: 7, stage: `HIT(2.6, 1);` },
  finisher: { at: 9, cam: [CAMY, 0.34], stage: `
    ev({ t: 'fx', k: 'arc', s: 'burst', n: 3, c: 'gold', id: me, x: s.x, z: s.z, f: s.face, r: 3.4 });
    ev({ t: 'fx', k: 'ca', v: 'cleave', s: 'cleave', id: me, x: s.x, z: s.z, f: s.face, r: 4.5, h: 1.2, rage: 30 }); HIT(2.6, 1);` },
  slam: { at: 12, cam: [CAMY, 0.44], stage: `
    ev({ t: 'fx', k: 'ca', v: 'slam', id: me, x: s.x + Math.sin(s.face) * 3, z: s.z + Math.cos(s.face) * 3, r: 4.5, big: 1 });
    ev({ t: 'fx', k: 'ring', s: 'whirl', id: me, x: s.x, z: s.z, f: s.face, r: 4 });` },
  burst: { at: 34, cam: [CAMY, 0.42], dist: 15, frames: 110, stage: `
    const x = s.x + Math.sin(s.face) * 5, z = s.z + Math.cos(s.face) * 5;
    ev({ t: 'tburst', key: me, ids: [me], n: 3, x, z, m: 0, cls: ['swordsman', 'guardian', 'cleric', 'ranger', 'berserker', 'lancer', 'bard'], pk: 'guardian+swordsman', nm: 'Aegis Edge' });` },
  dash: { at: 9, cam: [CAMY + 0.7, 0.3], stage: `
    const fwd = d => ({ x2: s.x + Math.sin(s.face) * d, z2: s.z + Math.cos(s.face) * d });
    ev({ t: 'fx', k: 'rush', s: 'rush', id: me, x: s.x, z: s.z, f: s.face, ...fwd(8) });
    ev({ t: 'fx', k: 'ca', v: 'loose', id: me, x: s.x, z: s.z, f: s.face + 0.5, r: 26 });
    ev({ t: 'fx', k: 'cb', ev: 'dissonance', id: me, x: s.x, z: s.z, f: s.face - 0.7, r: 8, h: 0.7 });` },
  world: { at: 2, cam: [CAMY, 0.22], dist: 11, stage: `` },
};
// a heavy crit landing d metres ahead: the flash, the sparks thrown through, the plain burst
const HIT = `const HIT = (d, crit) => { const x = s.x + Math.sin(s.face) * d, z = s.z + Math.cos(s.face) * d, dx = Math.sin(s.face), dz = Math.cos(s.face);
  f.fx.flash(x, 1.3, z, crit ? 2.8 : 2.1, crit ? 0xffd76a : 0xfff0d8, 0.15); f.fx.spray(x, 1.3, z, dx, 0.35, dz, crit ? 14 : 9, crit ? 0xffd76a : 0xffd9a0, 0.24, 11, 0.5); f.fx.sparks(x, 1.3, z, 10, 0xfff3c4, 0.22, 7); };`;
const scenes = (process.env.SCENES || Object.keys(SCENES).join(',')).split(',');
const CLIP = process.env.CLIP || '', TAG = process.env.TAG || '';

let browser;
try {
  await sleep(2500);
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGE ERROR', String(e)));
  await p.addInitScript(() => { // the stepped clock: free-running until __step.hold is set, then one frame per step
    const raf = window.requestAnimationFrame.bind(window), real = performance.now.bind(performance);
    const S = window.__step = { hold: false, left: 0, t: 0, done: null, q: [] };
    performance.now = () => (S.hold ? S.t : real());
    const run = () => { const q = S.q; S.q = []; S.t += 1000 / 60; for (const cb of q) cb(S.t); };
    window.requestAnimationFrame = cb => {
      if (!S.hold) return raf(cb);
      S.q.push(cb); return 0;
    };
    S.start = () => { S.t = real(); S.hold = true; };
    S.go = n => new Promise(res => { let k = 0; const tick = () => { if (k++ >= n) return res(); run(); raf(tick); }; raf(tick); });
    // n frames of game time with nothing drawn (software rendering takes about a second a frame): for the frames no picture is taken of
    S.skip = n => { const r = window.__fb.renderer, draw = r.render; r.render = () => {}; try { for (let k = 0; k < n; k++) run(); } finally { r.render = draw; } };
  });
  await p.goto(`${base}/?quality=high`);
  await p.waitForFunction(() => window.__fb?.input && !document.getElementById('enter').disabled, null, { timeout: 180000 });
  await p.fill('#name', 'Kirin'); await p.click('.cls[data-id=swordsman]'); await p.click('#enter');
  await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
  await p.evaluate(() => { const f = window.__fb; f.send({ type: 'test', ward: 1 }); f.settings.reduceMotion = true; f.settings.perf = false; });
  await p.addStyleTag({ content: 'body > *:not(#view) { visibility: hidden !important; }' });
  await sleep(3000);
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => { window.__step.start(); r(); }))); // (the pending frame is now queued in the stepped clock)
  const go = n => p.evaluate(n => window.__step.go(n), n), skip = n => p.evaluate(n => window.__step.skip(n), n);
  const run = (code, cam, dist) => p.evaluate(({ code, cam, dist, HIT }) => {
    const f = window.__fb, s = f.state, me = s.myId, ev = e => f.handleEvent(e), P = f.players.get(me);
    if (cam) { s.yaw = cam[0]; s.face = cam[0]; s.pitch = cam[1]; s.camDist = dist || 9; }
    new Function('f', 's', 'me', 'ev', 'P', HIT + code)(f, s, me, ev, P);
  }, { code, cam, dist, HIT });
  for (const sc of scenes) {
    const S = SCENES[sc], clip = CLIP === sc;
    for (const look of looks) {
      await p.evaluate(look => { let a = 12345; Math.random = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); window.__fb.setLook(look); }, look);
      await run('', S.cam, S.dist); await skip(120); // settle: the camera eases in, the last scene's effects die out
      await run(S.stage, S.cam, S.dist);
      const N = clip ? (Number(process.env.FRAMES) || S.frames || 90) : S.at, dir = path.join(OUT, `clip-${sc}-${look}`);
      if (clip) fs.mkdirSync(dir, { recursive: true });
      for (let i = 1; i <= N; i++) {
        if (S.more?.[i] && (clip || i < S.at)) await run(S.more[i]);
        if (clip || i === N) await go(1); else await skip(1);
        if (clip) await p.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.png`) });
      }
      if (!clip) await p.screenshot({ path: path.join(OUT, `${TAG}${sc}-${look}.png`) });
      console.log(`shot ${sc}-${look}`);
    }
  }
} catch (e) { console.log('FAILED ' + (e.stack || e)); process.exitCode = 1; }
finally { await browser?.close(); srv.kill(); }
