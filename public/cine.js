// Cinematic camera for filming (docs/ROADMAP.md F4; server side: server/cine.js). The film view is a spectator
// opened with /?spectate=1&film=1: it obeys every `cine` event (shots, slow motion, titles, fades, letterbox, clean
// feed, light). Other spectators keep their auto framing but still get light, titles, fades and slow motion; players
// only get the light. main.js hooks: cine.onMessage (state on join), cine.event (snapshot events), cine.frame (camera).
import * as THREE from 'three';

const FILM = new URLSearchParams(location.search).has('film');
const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerpA = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const BASE_FOV = 60;
// Each shot: distance, camera height and look height (scaled by the target's size), lens, how the angle is chosen.
// az: where the camera sits around the target, relative to its facing (0 = in front of its face, PI = behind it);
// null = keep the side the camera is already on. Eye-level shots (eye) give camY as a share of the target's height;
// the others in metres (scaled for giants). lookY is always a share of the height.
const SHOTS = {
  close_up: { dist: 3, camY: 0.86, lookY: 0.82, fov: 38, az: 0.5, eye: true },
  medium: { dist: 6, camY: 0.72, lookY: 0.6, fov: 45, az: 0.7, eye: true },
  wide: { dist: 16, camY: 8, lookY: 0.4, fov: 55, az: null },
  over_shoulder: { dist: 2.2, camY: 1.12, lookY: 0.78, fov: 45, eye: true },
  follow: { dist: 8, camY: 4.5, lookY: 0.5, fov: 55, az: Math.PI },
  orbit: { dist: 10, camY: 3.5, lookY: 0.5, fov: 50, az: null, spin: 0.12 },
  crane: { dist: 4, camY: 1.6, lookY: 0.5, fov: 50, az: null, to: { dist: 18, camY: 14, lookY: 0.3 }, len: 7 },
};

export function initCine({ camera, state, players, mobs, slowMotion, twists }) {
  const S = { markers: true, shot: null, t: 0, u: 1, dur: 0, az: null, from: null, last: null, active: false, fov: BASE_FOV };
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), want = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: BASE_FOV };
  const known = new Map(); // last seen place of each target (a mob that died and vanished keeps its spot)

  // ---------- overlays: letterbox bars, fade, title ----------
  const css = document.createElement('style');
  css.textContent = `
#cine-bars i { position: fixed; left: 0; right: 0; height: max(0px, calc((100vh - 100vw / 2.39) / 2)); background: #000; z-index: 50; pointer-events: none; transition: transform .8s ease; }
#cine-bars i:first-child { top: 0; transform: translateY(-100%); } #cine-bars i:last-child { bottom: 0; transform: translateY(100%); }
#cine-bars.on i { transform: none !important; }
#cine-fade { position: fixed; inset: 0; background: #000; opacity: 0; z-index: 60; pointer-events: none; }
#cine-title { position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%); z-index: 70; pointer-events: none; text-align: center; color: #f5f1e6;
  font: 800 clamp(30px, 7vw, 76px)/1.05 Georgia, 'Times New Roman', serif; letter-spacing: .16em; text-shadow: 0 3px 24px rgba(0,0,0,.85); opacity: 0; transition: opacity 1s ease; white-space: nowrap; }
#cine-title small { display: block; margin-top: .55em; font: 600 clamp(13px, 2.2vw, 22px)/1.2 system-ui, sans-serif; letter-spacing: .28em; text-transform: uppercase; opacity: .85; }
#cine-title.show { opacity: 1; }
body.cine-clean #hud > :not(#banner):not(#bubbles):not(.bubbles):not([data-cine-keep]), body.cine-clean #rare-hint, body.cine-clean #crosshair { display: none !important; }`;
  document.head.appendChild(css);
  const bars = document.createElement('div'); bars.id = 'cine-bars'; bars.innerHTML = '<i></i><i></i>';
  const fadeEl = document.createElement('div'); fadeEl.id = 'cine-fade';
  const titleEl = document.createElement('div'); titleEl.id = 'cine-title';
  document.body.append(bars, fadeEl, titleEl);
  let titleT = 0;

  const view = { letterbox: false, clean: false, black: false, title: null, light: null }; // what's applied (tests read it)
  function fade(to, secs) {
    view.black = to === 'black';
    fadeEl.style.transition = `opacity ${Math.max(0, secs)}s ease`;
    fadeEl.style.opacity = view.black ? '1' : '0';
  }
  function title(text, sub, secs) {
    clearTimeout(titleT);
    if (!text) { titleEl.classList.remove('show'); view.title = null; return; }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    titleEl.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    titleEl.classList.add('show'); view.title = text;
    titleT = setTimeout(() => { titleEl.classList.remove('show'); view.title = null; }, Math.max(0.5, secs) * 1000);
  }
  function letterbox(on) { view.letterbox = !!on; bars.classList.toggle('on', view.letterbox); }
  function clean(on) { view.clean = !!on; document.body.classList.toggle('cine-clean', view.clean); }
  function light(v) { view.light = v || null; twists.light = view.light; }
  function shot(e, cut) {
    if (e.shot === 'free' && !S.active) { S.shot = null; return; }
    S.shot = e; S.t = 0; S.u = 0; S.dur = cut ? 0 : Math.max(0, e.secs ?? 1.5); S.az = null;
    S.from = S.active ? { pos: pos.clone(), look: look.clone(), fov: S.fov } : null; // null: start from the auto camera
  }

  // ---------- events ----------
  function apply(op, e, late) {
    const spec = !!state.spectator, film = spec && FILM;
    switch (op) {
      case 'light': light(e.light); break;
      case 'fade': if (spec) fade(e.to, late ? 0 : e.secs); break;
      case 'title': if (spec) title(e.text, e.sub, e.secs); break;
      case 'slowmo': if (spec) slowMotion(e.secs, e.scale); break;
      case 'letterbox': if (film) letterbox(e.on); break;
      case 'clean': if (film) clean(e.on); break;
      case 'shot': if (film) shot(e, late); break;
      case 'reset': light(null); fade('in', late ? 0 : 1); title(''); letterbox(false); clean(false); if (film) shot({ shot: 'free', secs: 1.5 }); break;
    }
  }
  function event(e) { if (e.t !== 'cine') return false; apply(e.op, e, false); return true; }
  function onMessage(msg) { // { type: 'cine', state }: the picture as it is now, sent when we join
    if (msg.type !== 'cine') return false;
    const st = msg.state || {};
    apply('reset', {}, true);
    apply('light', { light: st.light }, true);
    if (st.black) apply('fade', { to: 'black' }, true);
    apply('letterbox', { on: st.letterbox }, true);
    apply('clean', { on: st.clean }, true);
    if (st.title) apply('title', st.title, true);
    if (st.shot) apply('shot', st.shot, true);
    return true;
  }

  // ---------- camera ----------
  function find(t) { // -> { x, z, h, face } or null
    if (!t) return null;
    if (t.x !== undefined) return { x: t.x, z: t.z, h: 2, face: null };
    const key = t.pid !== undefined ? `p${t.pid}` : `m${t.mid}`;
    const e = t.pid !== undefined ? players.get(t.pid) : mobs.get(t.mid);
    if (e) {
      const g = e.model.group.position;
      known.set(key, { x: g.x, z: g.z, h: e.model.height || 2, face: e.model.group.rotation.y });
      if (known.size > 200) known.delete(known.keys().next().value);
    }
    return known.get(key) || null;
  }
  // Where the shot wants the camera this frame (into `want`); false while its target isn't known yet.
  function aim(dt) {
    const e = S.shot, D = SHOTS[e.shot], T = find(e.target);
    if (!D || !T) return false;
    const k = Math.sqrt(Math.max(1, T.h / 1.95)); // giants get a wider frame
    const cp = S.active ? pos : camera.position, bearing = Math.atan2(cp.x - T.x, cp.z - T.z); // the side the camera is on now
    if (e.shot === 'over_shoulder') {
      const F = find(e.from);
      if (!F) return false;
      let dx = T.x - F.x, dz = T.z - F.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      want.pos.set(F.x - dx * D.dist + dz * 0.75, F.h * D.camY, F.z - dz * D.dist - dx * 0.75);
      want.look.set(T.x, T.h * D.lookY, T.z);
      want.fov = D.fov;
      return true;
    }
    if (S.az === null) S.az = D.az === null || T.face === null ? bearing : T.face + D.az;
    if (e.shot === 'follow' && T.face !== null) S.az = lerpA(S.az, T.face + Math.PI, Math.min(1, dt * 1.2));
    if (D.spin) S.az += D.spin * dt;
    let { dist, camY, lookY } = D;
    if (D.to) { const c = ease(S.t / Math.max(D.len, e.secs || 0)); dist += (D.to.dist - dist) * c; camY += (D.to.camY - camY) * c; lookY += (D.to.lookY - lookY) * c; }
    const lx = e.shot === 'follow' && T.face !== null ? Math.sin(T.face) * 2 : 0, lz = e.shot === 'follow' && T.face !== null ? Math.cos(T.face) * 2 : 0;
    const cy = D.eye ? T.h * camY : camY * k;
    want.pos.set(T.x + Math.sin(S.az) * dist * k, cy, T.z + Math.cos(S.az) * dist * k);
    want.look.set(T.x + lx, T.h * lookY, T.z + lz);
    want.fov = D.fov;
    return true;
  }

  // After main.js has placed the auto camera: take over in the film view. Returns the [x, z] the shot looks at (for
  // the sun, the floor and the listener) or null when the auto camera is in charge.
  function frame(dt, cx, cz) {
    if (FILM && (view.clean || S.markers === false)) { // clean feed: no game-style markers over heads either
      for (const e of players.values()) if (e.model.cursor) e.model.cursor.visible = !view.clean;
      for (const e of mobs.values()) if (e.model.cursor) e.model.cursor.visible = !view.clean;
      S.markers = !view.clean;
    }
    if (!FILM || !state.spectator || !S.shot) { S.active = false; return null; }
    S.t += dt;
    const free = S.shot.shot === 'free';
    if (free) { want.pos.copy(camera.position); want.look.set(cx, 1.6, cz); want.fov = BASE_FOV; }
    else if (!aim(dt)) { if (!S.active) return null; want.pos.copy(pos); want.look.copy(look); want.fov = S.fov; } // hold until the target shows up
    const from = S.from || { pos: camera.position.clone(), look: new THREE.Vector3(cx, 1.6, cz), fov: BASE_FOV };
    S.from = from;
    S.u = S.dur > 0 ? Math.min(1, S.u + dt / S.dur) : 1;
    const u = ease(S.u);
    pos.copy(from.pos).lerp(want.pos, u); look.copy(from.look).lerp(want.look, u);
    S.fov = from.fov + (want.fov - from.fov) * u;
    if (free && S.u >= 1) { S.shot = null; S.active = false; setFov(BASE_FOV); return null; } // back to the auto framing
    S.active = true;
    camera.position.copy(pos); camera.lookAt(look); setFov(S.fov);
    state.x = look.x; state.z = look.z; // nameplates show around what we're filming
    return [look.x, look.z];
  }
  function setFov(f) { if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }

  const api = { film: FILM, view, onMessage, event, frame, get shot() { return S.shot?.shot || 'free'; }, get active() { return S.active; }, want, pos, look };
  return api;
}
