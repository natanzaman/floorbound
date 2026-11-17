// Records an episode: film view + plain spectator, real video (Playwright recordVideo), plus a JSONL track of
// camera/shot/director state every 0.25 s. Usage: node record.mjs <port> <outdir> <sheet.yaml> [fromScene] [maxSecs] [extraViews]
// extraViews: comma list of extra query strings, e.g. "pov=Pell" -> /?spectate=1&film=1&pov=Pell
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [port, out, sheet, from = '0', maxS = '480', extra = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;
const W = 1280, H = 720;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const views = [['film', '/?spectate=1&film=1'], ['spec', '/?spectate=1'], ...extra.split(',').filter(Boolean).map(q => [q.replace(/[^\w]+/g, '_'), `/?spectate=1&film=1&${q}`])];
const pages = {};
for (const [name, url] of views) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: path.join(out, name), size: { width: W, height: H } } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') fs.appendFileSync(path.join(out, `${name}-console.txt`), m.text() + '\n'); });
  page.on('pageerror', e => fs.appendFileSync(path.join(out, `${name}-console.txt`), 'PAGEERROR ' + e.message + '\n'));
  await page.goto(base + url);
  await page.waitForFunction(() => window.__fb?.state?.joined, null, { timeout: 60000 });
  pages[name] = { ctx, page };
}
const fps = await pages.film.page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log('film fps', fps);

const api = (p, body) => fetch(base + '/api/admin/director' + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(r => r.json());
const load = await api('/load', { text: fs.readFileSync(sheet, 'utf8') });
console.log('load', JSON.stringify(load).slice(0, 400));
const t0 = Date.now();
console.log('run', JSON.stringify(await api('/run', { from: +from })).slice(0, 300));
const track = fs.createWriteStream(path.join(out, 'track.jsonl'));
let st; const seen = new Set();
const probe = () => {
  const fb = window.__fb, c = fb.camera, s = fb.state;
  const ent = [...fb.players.values()].map(p => ({ n: p.name, x: +p.model.group.position.x.toFixed(1), z: +p.model.group.position.z.toFixed(1), dead: !!p.dead }));
  const boss = [...fb.mobs.values()].filter(m => m.def?.boss).map(m => ({ n: m.def.name, x: +m.x.toFixed(1), z: +m.z.toFixed(1) }));
  return { view: fb.cine.view, spec: s.spectator, shot: fb.cine.shot, active: fb.cine.active, pov: fb.cine.pov || null, cam: [c.position.x, c.position.y, c.position.z].map(v => +v.toFixed(1)), look: fb.cine.active ? [fb.cine.look.x, fb.cine.look.y, fb.cine.look.z].map(v => +v.toFixed(1)) : null, fov: +c.fov.toFixed(0), ent, boss };
};
while (Date.now() - t0 < +maxS * 1000) {
  st = await api('');
  const rec = { t: +((Date.now() - t0) / 1000).toFixed(2), state: st.state, scene: st.scene?.id, ssecs: st.scene?.secs, el: st.elapsed };
  for (const [name, { page }] of Object.entries(pages)) rec[name] = await page.evaluate(probe).catch(e => String(e));
  track.write(JSON.stringify(rec) + '\n');
  for (const l of st.log || []) { const k = typeof l === 'string' ? l : JSON.stringify(l); if (!seen.has(k)) { seen.add(k); fs.appendFileSync(path.join(out, 'director-log.txt'), k + '\n'); } }
  if (st.state === 'done' || st.state === 'error' || st.state === 'stopped') break;
  await new Promise(r => setTimeout(r, 250));
}
console.log('final', JSON.stringify(st).slice(0, 1500));
await new Promise(r => setTimeout(r, 3000));
await api('/stop', {});
for (const [name, { ctx, page }] of Object.entries(pages)) { const v = page.video(); await ctx.close(); fs.renameSync(await v.path(), path.join(out, `${name}.webm`)); }
await browser.close();
console.log('wall secs', (Date.now() - t0) / 1000);
