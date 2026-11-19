// Performance readouts: the diagnostics overlay (F3, or Settings → Graphics), the small ping chip in the corner, the
// ping itself ({type:'ping'} once a second; the server answers {type:'pong'} at once), and Auto graphics quality.
// main.js calls frame() once per frame and pong() for each pong; everything on screen updates 4 times a second.
import { Q, AutoQuality } from '/quality.js';

export function initPerf({ renderer, clock, settings, save, applyQuality, isJoined }) {
  const box = document.createElement('div'); box.id = 'perf'; box.className = 'hidden';
  const chip = document.createElement('div'); chip.id = 'ping-chip'; chip.className = 'hidden';
  document.body.append(box, chip);
  const F = { n: 0, t0: performance.now(), sum: 0, max: 0, js: 0, fps: 0, ms: 0, maxMs: 0, jsMs: 0 };
  const hitches = []; // times of frames over 100 ms (the last minute)
  const P = { rtt: null, jitter: 0, sent: new Map(), lost: 0 };
  let ents = { interp: 0, extrap: 0, hold: 0 }, uiT = 0, last = '', lastChip = '';
  let auto = settings.quality === 'auto' ? new AutoQuality(Q.level) : null;
  let savedQ = (() => { try { return localStorage.getItem('fb_autoq'); } catch { return null; } })();

  // ping: once a second while in the game
  const ctx = { send: null };
  let seq = 0;
  setInterval(() => {
    if (!isJoined()) return;
    const t = Math.round(performance.now() * 10) / 10;
    P.sent.set(t, ++seq);
    if (P.sent.size > 10) { P.sent.delete(P.sent.keys().next().value); P.lost++; }
    ctx.send?.({ type: 'ping', t });
  }, 1000);

  function pong(msg) {
    if (!P.sent.delete(msg.t)) return;
    const rtt = performance.now() - msg.t;
    if (P.rtt !== null) P.jitter += (Math.abs(rtt - P.rtt) - P.jitter) / 8; // RFC 3550-style smoothed variation
    P.rtt = rtt;
  }

  function frame(now, gapMs, jsMs, entStats) {
    F.n++; F.sum += gapMs; F.max = Math.max(F.max, gapMs); F.js += jsMs;
    if (gapMs > 100) hitches.push(now);
    if (entStats) ents = entStats;
    if (auto) {
      const w = auto.windows, lv = auto.frame(now, gapMs, document.hidden);
      if (lv) applyQuality(lv, auto.over()); // (shadows stay off once Auto turned them off: no shader recompiles)
      if (auto.windows !== w && Q.level !== savedQ) { savedQ = Q.level; try { localStorage.setItem('fb_autoq', Q.level); } catch {} } // where Auto is after each window: the next load starts there (and High with MSAA)
    }
    if (now - F.t0 >= 1000) {
      F.fps = (F.n * 1000) / (now - F.t0); F.ms = F.sum / F.n; F.maxMs = F.max; F.jsMs = F.js / F.n;
      F.n = 0; F.sum = 0; F.max = 0; F.js = 0; F.t0 = now;
    }
    if (now - uiT < 250) return;
    uiT = now;
    while (hitches.length && now - hitches[0] > 60000) hitches.shift();
    const showBox = !!settings.perf, showChip = !showBox && settings.ping !== false && isJoined() && P.rtt !== null;
    box.classList.toggle('hidden', !showBox); chip.classList.toggle('hidden', !showChip);
    if (showChip) { const t = `ping ${Math.round(P.rtt)} ms`; if (t !== lastChip) { lastChip = t; chip.textContent = t; } }
    if (!showBox) return;
    const ri = renderer.info, c = clock;
    const lines = [
      `FPS ${F.fps.toFixed(0)} · ${F.ms.toFixed(1)} ms (worst ${F.maxMs.toFixed(0)}) · JS ${F.jsMs.toFixed(1)} ms`,
      `Graphics ${Q.level}${settings.quality === 'auto' ? ' (Auto)' : ''}${renderer.getContext().getContextAttributes?.()?.antialias ? ' · MSAA' : ''} · pixel ratio ${renderer.getPixelRatio().toFixed(2)} · shadows ${Q.shadows ? 'on' : 'off'}`,
      `Draw ${ri.render.calls} calls · ${(ri.render.triangles / 1000).toFixed(0)}k tris · ${ri.programs?.length ?? '?'} shaders · ${ri.memory.geometries} geos`,
      `Hitches ${hitches.length} in the last minute (frames over 100 ms)`,
      `Ping ${P.rtt === null ? '…' : `${Math.round(P.rtt)} ms`} · jitter ${P.jitter.toFixed(0)} ms${P.lost ? ` · ${P.lost} lost` : ''}`,
      `Snapshots ${c.rate(now)}/s · late ${c.late} · out of order ${c.ooo} · spread ${Math.round(c.jitter)} ms`,
      `Drawn ${Math.round(c.delay)} ms behind · moving ${ents.interp} · guessing ${ents.extrap} · waiting ${ents.hold}`,
    ];
    const html = lines.join('<br>');
    if (html !== last) { last = html; box.innerHTML = html; }
  }

  return {
    frame, pong,
    set send(fn) { ctx.send = fn; },
    toggle() { settings.perf = !settings.perf; save(); },
    // Settings changed the quality choice: Auto starts measuring from the current level
    setMode(q) { auto = q === 'auto' ? new AutoQuality(Q.level) : null; },
    get auto() { return auto; },
    stats: () => ({ fps: F.fps, ms: F.ms, jsMs: F.jsMs, worst: F.maxMs, hitches: hitches.length, rtt: P.rtt, jitter: P.jitter,
      snaps: clock.rate(performance.now()), late: clock.late, ooo: clock.ooo, delay: clock.delay, spread: clock.jitter, ents, level: Q.level }),
  };
}
