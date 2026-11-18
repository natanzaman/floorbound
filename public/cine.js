// Cinematic camera for filming (docs/ROADMAP.md F4; server side: server/cine.js). The film view is a spectator
// opened with /?spectate=1&film=1: it obeys every `cine` event (shots, slow motion, titles, fades, letterbox, clean
// feed, light). Other spectators keep their auto framing but still get light, titles, fades and slow motion; players
// only get the light. main.js hooks: cine.onMessage (state on join), cine.event (snapshot events), cine.frame (camera).
// POV view (F8): /?spectate=1&pov=<name> rides one character: their own game camera (behind and above, looking where
// they look); add &eyes=1 for first person. It gets the picture like the film view (light, fades, titles, letterbox,
// clean feed) but keeps its own camera, so one window per character records a multi-camera take. The director can also
// cut the film view into a character with the shots `pov` and `eyes`.
import * as THREE from 'three';

const Q = new URLSearchParams(location.search);
const POV = (Q.get('pov') || '').trim().toLowerCase() || null;
const FILM = Q.has('film') || !!POV;
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
  // F8: a character's own view. pov: their game camera (behind, a little above, over the right shoulder, looking ahead);
  // eyes: first person (their model is hidden). Both turn with the character, smoothed; when they fall, the camera
  // rises out of them and looks down at the body.
  pov: { dist: 5.5, camY: 1.55, lookY: 0.7, fov: 58, ahead: 6, side: 0.6, turn: 3, pov: true },
  eyes: { dist: -0.25, camY: 0.93, lookY: 0.86, fov: 72, ahead: 12, side: 0, turn: 5, pov: true, hide: true },
};
const RISE = { dist: 4, camY: 6, lookY: 0.15, secs: 3 }; // a POV whose character is down

export function initCine({ camera, state, players, mobs, slowMotion, twists, occluders = [] }) {
  const S = { markers: true, shot: null, t: 0, u: 1, dur: 0, az: null, from: null, last: null, active: false, fov: BASE_FOV, hidden: null, down: 0, base: null, side: null, off: null, spin: 0, chk: 0, flip: 0, d: null };
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
    if (POV) return; // the POV view keeps its own camera
    if (e.shot === 'free' && !S.active) { S.shot = null; return; }
    S.shot = e; S.t = 0; S.u = 0; S.dur = cut ? 0 : Math.max(0, e.secs ?? 1.5);
    Object.assign(S, { az: null, base: null, side: null, off: null, spin: 0, chk: 0, flip: 0, down: 0, d: null });
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
  if (POV) S.shot = { shot: Q.has('eyes') ? 'eyes' : 'pov', target: { name: POV }, secs: 0 };
  function find(t) { // -> { x, z, h, face, dead, ent } or null
    if (!t) return null;
    if (t.x !== undefined) return { x: t.x, z: t.z, h: 2, face: null };
    let e, key;
    if (t.name !== undefined) { // the POV view names its character (F8)
      for (const p of players.values()) if (p.name?.toLowerCase() === t.name) { e = p; break; }
      key = `n${t.name}`;
    } else {
      key = t.pid !== undefined ? `p${t.pid}` : `m${t.mid}`;
      e = t.pid !== undefined ? players.get(t.pid) : mobs.get(t.mid);
    }
    if (e) {
      const g = e.model.group.position;
      known.set(key, { x: g.x, z: g.z, h: e.model.height || 2, face: e.model.group.rotation.y, dead: !!e.dead, boss: !!e.def?.boss });
      if (known.size > 200) known.delete(known.keys().next().value);
    }
    const k = known.get(key);
    return k ? { ...k, ent: e || null } : null;
  }
  // F8: a character's own view (pov / eyes). Turns with them (smoothed); while they're down the camera rises out of
  // them to look at the body, and comes back down when they get up.
  function aimPov(D, T, dt) {
    if (S.az === null) S.az = T.face ?? 0;
    if (T.face !== null) S.az = lerpA(S.az, T.face, Math.min(1, dt * D.turn));
    S.down = Math.max(0, Math.min(1, S.down + (T.dead ? dt : -dt) / RISE.secs));
    const c = ease(S.down), fx = Math.sin(S.az), fz = Math.cos(S.az), rx = -fz, rz = fx;
    const dist = D.dist + (RISE.dist - D.dist) * c, side = D.side * (1 - c), ahead = D.ahead * (1 - c);
    const cy = T.h * D.camY + (RISE.camY - T.h * D.camY) * c;
    let d = dist; // never inside a big body (a boss in melee range): pull the camera in along the arm
    if (d > 0) for (let i = 0; i < 8 && insideBig(V5.set(T.x - fx * d + rx * side, cy, T.z - fz * d + rz * side)); i++) d *= 0.75;
    want.pos.set(T.x - fx * d + rx * side, cy, T.z - fz * d + rz * side);
    want.look.set(T.x + fx * ahead, T.h * (D.lookY + (RISE.lookY - D.lookY) * c), T.z + fz * ahead);
    want.fov = D.fov + (55 - D.fov) * c;
    hide(D.hide && c < 0.5 ? T.ent : null); // in their eyes: don't draw their own head
    return true;
  }
  function hide(ent) { // runs after main.js has drawn the entities this frame, so it wins until the next one
    if (S.hidden && S.hidden !== ent) S.hidden.model.group.visible = true;
    S.hidden = ent || null;
    if (!S.hidden) return;
    S.hidden.model.group.visible = false;
    if (S.hidden.label) S.hidden.label.el.style.display = 'none';
  }
  // ---------- framing helpers (Ep 1 dress rehearsal fixes) ----------
  // A shot keeps a clear line to what it films: no wall, pillar or other body in between, and never the camera inside a
  // body (the Warden filled the screen when a close-up landed on its side of Bram). In a boss fight, close-ups,
  // mediums and follows frame the boss with their subject, and a character who falls is followed down to the ground.
  const ray = new THREE.Raycaster(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), V4 = new THREE.Vector3(), V5 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const OFFS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.85, -1.85, 2.4, -2.4, Math.PI];
  const BOSS_NEAR = 22; // m: a boss this close shares the frame
  const bodyR = (e, big) => big ? Math.max(e.def?.radius || 0.8, (e.model.height || 2) * 0.38) : 0.45;
  // How badly the view from p to l is blocked: a wall or pillar 2, another body 1 (a big one 2), the camera inside a
  // body 5. `bodies: false` (wide, crane) only counts walls and the camera inside a big body.
  function blockers(p, l, skip, bodies) {
    let n = 0;
    const len = p.distanceTo(l);
    if (occluders.length && len > 0.6) {
      ray.set(l, V1.copy(p).sub(l).normalize()); ray.near = 0; ray.far = len - 0.2;
      if (ray.intersectObjects(occluders, true).length) n += 2;
    }
    const sx = p.x - l.x, sz = p.z - l.z, L2 = sx * sx + sz * sz || 1e-6;
    for (const map of [players, mobs]) for (const e of map.values()) {
      const big = map === mobs && (e.def?.boss || (e.model.height || 2) > 3);
      if (skip.includes(e) || e.dead || !e.model?.group || (!bodies && !big)) continue;
      const g = e.model.group.position, r = bodyR(e, big), h = e.model.height || 2;
      if (Math.hypot(p.x - g.x, p.z - g.z) < r + 0.5 && p.y < h + 0.4) { n += 5; continue; }
      const u = ((g.x - l.x) * sx + (g.z - l.z) * sz) / L2;
      if (u < 0.1 || u > 1) continue; // beside or behind the subject, or behind the camera
      const y = l.y + (p.y - l.y) * u;
      if (Math.hypot(l.x + sx * u - g.x, l.z + sz * u - g.z) < r && y < h) n += big ? 2 : 1;
    }
    return n;
  }
  // Are all these points inside the picture (the letterboxed part when the bars are on)?
  function fits(p, l, fov, pts) {
    V1.copy(l).sub(p).normalize(); V2.crossVectors(V1, UP).normalize(); V3.crossVectors(V2, V1);
    const tv = Math.tan(fov * Math.PI / 360), th = tv * camera.aspect, tvv = view.letterbox ? Math.min(tv, th / 2.39) : tv;
    for (const q of pts) {
      V4.copy(q).sub(p); const z = V4.dot(V1);
      if (z < 0.3 || Math.abs(V4.dot(V2)) / z > th * 0.9 || Math.abs(V4.dot(V3)) / z > tvv * 0.86) return false;
    }
    return true;
  }
  function bossNear(T) { // the nearest live boss to a (non-boss) subject
    let best = null, bd = BOSS_NEAR;
    for (const m of mobs.values()) {
      if (!m.def?.boss || m.dead || m === T.ent) continue;
      const g = m.model.group.position, d = Math.hypot(g.x - T.x, g.z - T.z);
      if (d < bd) { bd = d; best = { x: g.x, z: g.z, h: m.model.height || 6, ent: m }; }
    }
    return best;
  }
  function insideBig(p) {
    for (const m of mobs.values()) {
      if (m.dead || !(m.def?.boss || (m.model.height || 2) > 3)) continue;
      const g = m.model.group.position;
      if (Math.hypot(p.x - g.x, p.z - g.z) < bodyR(m, true) + 0.4 && p.y < (m.model.height || 6) + 0.4) return true;
    }
    return false;
  }
  // Spring arm: how far from the look point the camera can sit along this direction before a wall gets in the way.
  function wallClamp(l, p, d) {
    if (!occluders.length || d < 1) return d;
    ray.set(l, V1.copy(p).sub(l).normalize()); ray.near = 0; ray.far = d;
    const hit = ray.intersectObjects(occluders, true)[0];
    return hit ? Math.max(1.5, hit.distance - 0.6) : d;
  }
  function pushOut(p) { // never leave the camera inside a big body
    for (const m of mobs.values()) {
      if (m.dead || !(m.def?.boss || (m.model.height || 2) > 3)) continue;
      const g = m.model.group.position, r = bodyR(m, true) + 0.6, d = Math.hypot(p.x - g.x, p.z - g.z);
      if (d < r && p.y < (m.model.height || 6) + 0.4) { const a = d > 0.01 ? Math.atan2(p.x - g.x, p.z - g.z) : 0; p.x = g.x + Math.sin(a) * r; p.z = g.z + Math.cos(a) * r; }
    }
  }
  const sideOf = (a, b) => (Math.atan2(Math.sin(a - b), Math.cos(a - b)) < 0 ? -1 : 1);
  const mix = (a, b, c) => a + (b - a) * c;

  // Where the shot wants the camera this frame (into `want`); false while its target isn't known yet.
  function aim(dt) {
    const e = S.shot, D = SHOTS[e.shot], T = find(e.target);
    if (!D || !T) return false;
    if (D.pov) return aimPov(D, T, dt);
    S.down = Math.max(0, Math.min(1, S.down + (T.dead ? dt : -dt) / 1.2));
    const down = ease(S.down); // the subject is lying on the ground
    const cp = S.active ? pos : camera.position, bearing = Math.atan2(cp.x - T.x, cp.z - T.z); // the side the camera is on now
    S.chk -= dt; const check = S.chk <= 0; if (check) S.chk = 0.4;
    const skip = [T.ent].filter(Boolean);
    if (e.shot === 'over_shoulder') {
      const F = find(e.from);
      if (!F) return false;
      let dx = T.x - F.x, dz = T.z - F.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const at = (side, v) => v.set(F.x - dx * D.dist + dz * 0.75 * side, F.h * D.camY, F.z - dz * D.dist - dx * 0.75 * side);
      want.look.set(T.x, mix(T.h * D.lookY, 0.3, down), T.z);
      if (F.ent) skip.push(F.ent);
      if (S.side === null || (check && S.t > S.flip)) { // the clearer shoulder (a reverse cut at most every 2 s)
        const cur = blockers(at(S.side || 1, V3).clone(), want.look, skip, true), oth = blockers(at(-(S.side || 1), V3).clone(), want.look, skip, true);
        if (S.side === null) S.side = oth < cur ? -1 : 1;
        else if (oth < cur) { S.side = -S.side; S.flip = S.t + 2; }
      }
      at(S.side, want.pos); want.fov = D.fov;
      return true;
    }
    const B = (e.shot === 'close_up' || e.shot === 'medium' || e.shot === 'follow') && !T.boss ? bossNear(T) : null;
    let base, rate = 2.5;
    if (B) { // fighting a boss: the camera behind the subject's shoulder, the boss beyond them (follow), or side-on (close-up / medium)
      const bb = Math.atan2(T.x - B.x, T.z - B.z); // 0 = straight behind the subject (away from the boss), PI = between them
      if (S.side === null) S.side = sideOf(bearing, bb);
      base = bb + S.side * (e.shot === 'follow' ? 0.45 : e.shot === 'close_up' ? 1.6 : 1.35); rate = 1.4;
      skip.push(B.ent);
    } else if (e.shot === 'follow') { base = T.face !== null ? T.face + Math.PI : bearing; rate = 1.2; }
    else { if (S.base === null) S.base = D.az === null || T.face === null ? bearing : T.face + D.az; base = S.base; }
    if (D.spin) { S.spin += D.spin * dt; base += S.spin; }
    const k = Math.sqrt(Math.max(1, T.h / 1.95)); // giants get a wider frame
    let { dist, camY, lookY } = D;
    if (D.to) { const c = ease(S.t / Math.max(D.len, e.secs || 0)); dist += (D.to.dist - dist) * c; camY += (D.to.camY - camY) * c; lookY += (D.to.lookY - lookY) * c; }
    dist *= k;
    let cy = D.eye ? T.h * camY : camY * k;
    // what it looks at: ahead of a follow's subject, between subject and boss in a fight, down at a fallen one
    const w = B ? (e.shot === 'follow' ? 0.45 : 0.3) : 0;
    let lx = T.x, lz = T.z, ly = T.h * lookY;
    if (B) { lx = mix(T.x, B.x, w); lz = mix(T.z, B.z, w); ly = mix(ly, B.h * 0.42, w); }
    else if (e.shot === 'follow' && T.face !== null) { lx += Math.sin(T.face) * 2; lz += Math.cos(T.face) * 2; }
    ly = mix(ly, 0.3, down); cy = mix(cy, Math.max(cy, 1.8, dist * 0.55), down);
    want.look.set(lx, ly, lz);
    want.fov = D.fov;
    const place = (az, d, y, v) => v.set(T.x + Math.sin(az) * d, y, T.z + Math.cos(az) * d);
    if (S.az === null) S.az = base + (S.off || 0);
    // widen until the subject (and the boss) fit
    const pts = [];
    if (B) {
      pts.push(V4.set(T.x, T.h * (1 - down * 0.8), T.z).clone(), V4.set(T.x, e.shot === 'close_up' ? T.h * 0.45 : 0.05, T.z).clone());
      pts.push(V4.set(B.x, B.h * (e.shot === 'close_up' ? 0.55 : 0.95), B.z).clone());
      if (e.shot !== 'close_up') pts.push(V4.set(B.x, 0.2, B.z).clone());
      for (let i = 0; i < 12 && !fits(place(S.az, dist, cy, V5), want.look, want.fov, pts); i++) { dist *= 1.12; if (!D.eye) cy *= 1.04; else cy += 0.15; }
    }
    // a clear line of sight: keep the current angle if it's clear, else swing to the clearest one nearby
    if (S.off === null || check) {
      const bodies = !(e.shot === 'wide' || e.shot === 'crane' || e.shot === 'orbit');
      // a boss two-shot prefers its own band (within ~1.1 rad), but a wall anywhere in it is worse than a wider angle
      const score = off => blockers(place(base + off, dist, cy, V3).clone(), want.look, skip, bodies) + Math.abs(off) * 0.01 + (B && Math.abs(off) > 1.1 ? 1.2 : 0);
      let best = S.off ?? 0, bs = score(best);
      if (bs >= 0.5) for (const o of OFFS) { const sc = score(o); if (sc < bs - 0.5) { bs = sc; best = o; } }
      if (S.off === null) S.az = base + best;
      S.off = best;
    }
    S.az = lerpA(S.az, base + S.off, Math.min(1, dt * rate));
    // the camera's distance from the look point, pulled in front of any wall, eased (in fast, out slowly) so it never pops
    place(S.az, dist, cy, V5);
    const full = V5.distanceTo(want.look), dT = wallClamp(want.look, V5, full);
    S.d = S.d === null ? dT : S.d + (dT - S.d) * Math.min(1, dt * (dT < S.d ? 6 : 1.5));
    want.pos.copy(want.look).add(V5.sub(want.look).multiplyScalar(S.d / (full || 1)));
    pushOut(want.pos);
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
    if (!SHOTS[S.shot?.shot]?.hide) hide(null);
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

  const api = { film: FILM, pov: POV, view, onMessage, event, frame, get shot() { return S.shot?.shot || 'free'; }, get active() { return S.active; }, want, pos, look };
  return api;
}
