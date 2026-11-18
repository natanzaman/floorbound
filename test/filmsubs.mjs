// Film dialogue in a real browser (docs/handoffs/film-dialogue-brief.md): the director's say lines show as subtitles in
// the film view (inside the lower letterbox bar, replaced by the next line, gone after their hold) and play their
// voice-over file in the film view and a plain spectator; a plain spectator gets no subtitles.
// Needs Playwright for Node (not a dependency: `npm i --no-save playwright`) and the Episode 1 voice files.
// Usage: PORT=37xx node test/filmsubs.mjs [shots dir]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { voiceKey } from '../server/director-sheet.js';

const PORT = +(process.env.PORT || 3791), base = `http://localhost:${PORT}`, shots = process.argv[2];
const L1 = 'Forty-one days. Not one name on this stone.', L2 = 'Three raids tried.';
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
try {
  await new Promise((res, rej) => { srv.stdout.on('data', d => /listening|localhost:\d+/i.test(d) && res()); srv.on('exit', rej); setTimeout(res, 4000); });
  const open = async q => { const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }); await p.goto(`${base}/${q}`); await p.waitForFunction(() => window.__fb?.state?.spectator, null, { timeout: 30000 }); return p; };
  const film = await open('?spectate=1&film=1'), spec = await open('?spectate=1');
  const post = (p, body) => fetch(`${base}/api/admin/director/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const ld = await post('load', { text: `
title: Subs
episode: 1
cast:
  - { id: corvin, name: "Corvin", class: swordsman, style: sword, level: 13 }
  - { id: bram, name: "Bram", class: guardian, style: shield, level: 12 }
scenes:
  - id: s1
    place: town
    marks: { corvin: hall_of_clearers, bram: fountain }
    cues:
      - { do: letterbox, on: true }
      - { do: clean, on: true }
      - { do: camera, shot: medium, target: corvin, secs: 0 }
      - { who: corvin, do: say, text: "${L1}", hold: 4, delay: 2 }
      - { who: bram, do: say, text: "${L2}", hold: 2.5, after: prev }
      - { do: wait, secs: 6, after: prev }
` });
  assert.ok(ld.ok, JSON.stringify(ld.errors));
  await post('run', { force: true });

  const sub = p => p.evaluate(() => { const el = document.getElementById('cine-sub'), r = el.getBoundingClientRect(), bar = document.querySelector('#cine-bars i:last-child').getBoundingClientRect(); return { text: window.__fb.cine.view.sub, shown: el.classList.contains('show'), top: r.top, bottom: r.bottom, barTop: bar.top, h: innerHeight }; });
  await film.waitForFunction(t => window.__fb.cine.view.sub?.endsWith(t), L1, { timeout: 30000 });
  await sleep(600);
  let s = await sub(film);
  assert.equal(s.text, `Corvin: ${L1}`); assert.ok(s.shown);
  ok('a say line shows as "Name: line" in the film view');
  assert.ok(s.top >= s.barTop - 2 && s.bottom <= s.h, `inside the lower letterbox bar (${s.top.toFixed(0)}-${s.bottom.toFixed(0)}, bar from ${s.barTop.toFixed(0)})`);
  ok('the subtitle sits inside the lower letterbox bar');
  if (shots) await film.screenshot({ path: `${shots}/film-sub.png` });
  const heard = p => p.evaluate(() => window.__fb.sfx.heard.map(h => ({ name: h.name, ok: h.ok, why: h.why })));
  await sleep(300);
  const h1 = await heard(film), want = `ep1/${voiceKey('corvin', L1)}`;
  assert.ok(h1.some(h => h.name === want && h.ok), JSON.stringify(h1));
  ok('the film view played the line\'s voice-over file');
  const hs = await heard(spec);
  assert.ok(hs.some(h => h.name === want && h.ok), JSON.stringify(hs));
  assert.equal((await sub(spec)).shown, false);
  const bub = p => p.evaluate(() => document.querySelectorAll('.bubble').length);
  assert.equal(await bub(film), 0); assert.ok(await bub(spec) > 0);
  ok('a plain spectator hears the voice but gets no subtitle');
  ok('bubbles: none in the film view (the subtitle carries the line), still over heads for a plain spectator');
  if (shots) await spec.screenshot({ path: `${shots}/spec-bubble.png` });

  await film.waitForFunction(t => window.__fb.cine.view.sub?.endsWith(t), L2, { timeout: 15000 });
  ok('the next line replaces the subtitle');
  const t0 = Date.now();
  await film.waitForFunction(() => window.__fb.cine.view.sub === null, null, { timeout: 15000 });
  const held = (Date.now() - t0) / 1000;
  assert.ok(held > 2, `held ${held.toFixed(1)} s`); // 2.5 s + 0.06 s x 18 chars = 3.6 s
  ok(`the last line clears after its reading time (${held.toFixed(1)} s after the check started)`);
  await post('stop', {});
} finally {
  await browser.close(); srv.kill();
}
console.log('filmsubs: all ok');
process.exit(0);
