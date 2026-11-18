// Records an episode for review: the film view (plus optional extra views) as a 60 fps MP4 with the game's audio, and a
// JSONL track of camera/shot/director state every 0.25 s.
// Usage: node record.mjs <port> <outdir> <sheet.yaml> [fromScene] [maxSecs] [extraViews]
// extraViews: comma list; "spec" = plain spectator, anything else is a query string, e.g. "pov=Pell" -> /?spectate=1&film=1&pov=Pell
// Video: CDP Page.startScreencast (every compositor frame, with its real timestamp), re-timed to a constant 60 fps by ffmpeg.
//   (Playwright recordVideo is fixed at 25 fps and has no audio.) Audio: the game's WebAudio output tapped in the page
//   (MediaRecorder on a MediaStreamDestination) and muxed in, aligned by wall-clock. Only the film view carries audio.
//   Speech made with speechSynthesis cannot be tapped; WebAudio or <audio>/<video> elements routed through an AudioContext can.
// Env: FPS (60), W/H (1280x720), CRF (18). Needs ffmpeg on PATH. Each extra view costs real-time rendering: the more pages,
//   the lower the smoothness of all of them; record extra views in a separate run if the distinct-fps number drops.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [port, out, sheet, from = '0', maxS = '480', extra = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;
const W = +(process.env.W || 1280), H = +(process.env.H || 720), FPS = +(process.env.FPS || 60), CRF = process.env.CRF || '18';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const views = [['film', '/?spectate=1&film=1'], ...extra.split(',').filter(Boolean).map(q => q === 'spec' ? ['spec', '/?spectate=1'] : [q.replace(/[^\w]+/g, '_'), `/?spectate=1&film=1&${q}`])];
// Page-side audio tap: every connection into an AudioContext's destination also feeds a MediaRecorder.
const TAP = `(() => {
  const taps = window.__aud = { start: 0, chunks: [], rec: null };
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...r) {
    const res = orig.call(this, dest, ...r);
    try {
      if (dest instanceof AudioDestinationNode && !dest.__tap) {
        dest.__tap = true;
        const md = dest.context.createMediaStreamDestination();
        const rec = new MediaRecorder(md.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
        rec.ondataavailable = e => { if (e.data.size) taps.chunks.push(e.data); };
        taps.rec = rec; taps.start = Date.now(); rec.start(500);
        taps.md = md; taps.ctx = dest.context; taps.dest = dest;
      }
    } catch (e) { console.error('tap', e.message); }
    if (taps.md && dest instanceof AudioDestinationNode && dest === taps.dest) orig.call(this, taps.md);
    return res;
  };
})();`;
const pages = {};
for (const [name, url] of views) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  if (name === 'film') await ctx.addInitScript(TAP);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') fs.appendFileSync(path.join(out, `${name}-console.txt`), m.text() + '\n'); });
  page.on('pageerror', e => fs.appendFileSync(path.join(out, `${name}-console.txt`), 'PAGEERROR ' + e.message + '\n'));
  await page.goto(base + url);
  await page.waitForFunction(() => window.__fb?.state?.joined, null, { timeout: 60000 });
  await page.mouse.click(W / 2, H / 2); // user gesture: unlocks the game's audio
  pages[name] = { ctx, page };
}
// Screencast: write every frame as it arrives, keep its compositor timestamp.
for (const [name, p] of Object.entries(pages)) {
  p.dir = path.join(out, `${name}-frames`); fs.rmSync(p.dir, { recursive: true, force: true }); fs.mkdirSync(p.dir, { recursive: true });
  p.frames = []; p.cdp = await p.ctx.newCDPSession(p.page);
  p.cdp.on('Page.screencastFrame', f => {
    const i = p.frames.length; p.frames.push(f.metadata.timestamp * 1000);
    fs.writeFile(path.join(p.dir, `${String(i).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64'), () => {});
    p.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await p.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
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
const stopAt = Date.now();
const timing = { runStartMs: t0, stopMs: stopAt, fps: FPS, views: {} };
for (const [name, p] of Object.entries(pages)) {
  await p.cdp.send('Page.stopScreencast').catch(() => {});
  let audio = null;
  if (name === 'film') {
    audio = await p.page.evaluate(async () => {
      const a = window.__aud; if (!a?.rec) return null;
      await new Promise(r => { a.rec.onstop = r; a.rec.stop(); });
      const buf = await new Blob(a.chunks).arrayBuffer();
      let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return { start: a.start, b64: btoa(s) };
    }).catch(e => { console.log('audio tap failed', e.message); return null; });
  }
  await p.ctx.close();
  await new Promise(r => setTimeout(r, 500));
  // Re-time to a constant frame rate: concat list with each frame's real duration, then fps=FPS (repeats/drops to the grid).
  const n = p.frames.length; if (!n) { console.log(name, 'no frames'); continue; }
  const list = [];
  for (let i = 0; i < n; i++) { const d = ((i + 1 < n ? p.frames[i + 1] : stopAt) - p.frames[i]) / 1000; list.push(`file '${path.resolve(p.dir, String(i).padStart(6, '0') + '.jpg')}'`, `duration ${Math.max(d, 0.001).toFixed(4)}`); }
  list.push(`file '${path.resolve(p.dir, String(n - 1).padStart(6, '0') + '.jpg')}'`);
  fs.writeFileSync(path.join(out, `${name}-frames.txt`), list.join('\n'));
  const mp4 = path.join(out, `${name}.mp4`), args = ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(out, `${name}-frames.txt`)];
  const startMs = p.frames[0];
  if (audio) {
    fs.writeFileSync(path.join(out, `${name}-audio.webm`), Buffer.from(audio.b64, 'base64'));
    args.push('-itsoffset', ((audio.start - startMs) / 1000).toFixed(3), '-i', path.join(out, `${name}-audio.webm`));
  }
  args.push('-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', CRF, '-r', String(FPS));
  if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-shortest');
  args.push(mp4);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status) console.log(name, 'ffmpeg failed', r.stderr.slice(-500)); else fs.rmSync(p.dir, { recursive: true, force: true });
  timing.views[name] = { firstFrameMs: startMs, frames: n, srcFps: +(n / ((stopAt - startMs) / 1000)).toFixed(1), audio: !!audio, audioStartMs: audio?.start };
  console.log(name, JSON.stringify(timing.views[name]));
}
fs.writeFileSync(path.join(out, 'timing.json'), JSON.stringify(timing, null, 1));
await browser.close();
console.log('wall secs', (Date.now() - t0) / 1000);
