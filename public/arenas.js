// Multi-area boss fights, client side (docs/ROADMAP.md J2, shared/arenas.js, server/arenas.js). Generic over the
// arena views the floors' world files build (floor3world.js: the Colossus's Undercroft). From the snapshot (w.f3.ar)
// it keeps the shared state (colliders, sludge, fire: client prediction collides with the same pillars as the server)
// and shows the right area, so a late joiner or a spectator sees the fight where it is. From the events it plays the
// fall: the plateau cracks (rumble, glowing cracks), everyone drops (a dark flash, characters and debris falling in),
// a landing pause, and the boss drops in with a shockwave. The lower area's light is a recolour of the floor's sky and
// sun (no new lights: the shader warm-up still holds), eased in while you're in the room.
// main.js wiring: snap(ar), event(e), frame(dt), lift(entity), camLift(), frozen(), speedMult(), noDodge().
import * as THREE from 'three';
import { ARENAS, ARENA_KEYS, arenaState, applyArenaSnap, inRoom, speedAt, sludgeAt, areaDef } from '/shared/arenas.js';

// ctx: { scene, fx, sfx, state, mobs, players, views: { key: view }, banner, callout, shake, tip, camera }
export function initArenas(ctx) {
  const { scene, fx, sfx, state, mobs, players, views } = ctx;
  const hemi = scene.children.find(o => o.isHemisphereLight), sun = scene.children.find(o => o.isDirectionalLight);
  const anim = {}; // key -> { t0, kind, ... } the fall being played
  const low = {};  // key -> how far into the lower area's light (eased)
  const rubble = {}; // key -> { t0, d, list }: debris falling with everyone, settling, then sinking away
  const c1 = new THREE.Color(), c2 = new THREE.Color();
  let clock = 0;

  // a full-screen dark flash that hides the swap from one area to the other
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;background:#07050a;opacity:0;pointer-events:none;z-index:40;transition:none';
  document.body.appendChild(veil);

  const inRoomNow = (key, x = state.x, z = state.z) => inRoom(ARENAS[key], x, z, 2);
  const viewer = () => (state.spectator ? [ctx.camera.position.x, ctx.camera.position.z] : [state.x, state.z]);
  const here = key => { const [x, z] = viewer(); return Math.hypot(x - ARENAS[key].room.x, z - ARENAS[key].room.z) < ARENAS[key].room.r + (state.spectator ? 30 : 8); };

  function snap(ar) {
    applyArenaSnap(ar);
    for (const key of ARENA_KEYS) {
      const v = views[key], L = arenaState(key);
      if (!v) continue;
      let a = anim[key];
      if (L.stage === 3 && a?.kind === 'crack') a = startFall(key, L.area, mobBoss(key), L.left); // (this snapshot carries the fall: play it, don't pop)
      if (!a || a.kind === 'enter') { if (v.area() !== L.area) v.setArea(L.area); } // (the fall swaps it itself, under the flash)
      if (L.stage === 2 && !a) startCrack(key, L.left); // joined during the warning
      if (L.stage !== 2 && a?.kind === 'crack') { delete anim[key]; v.crack(0); }
      v.fire(L.fi, L.fk);
    }
  }

  function event(e) {
    if (e.t !== 'arena') return false;
    const key = e.k, v = views[key], A = ARENAS[key];
    if (!v || !A) return true;
    const mine = inRoomNow(key) && !state.spectator, near = here(key);
    switch (e.s) {
      case 'crack': {
        startCrack(key, e.d);
        const m = mobs.get(e.id); m?.model.anim?.windup?.('beam', 0.6); // the sword driven into the plateau
        if (near) { sfx.play('roar', m?.model.group.position || null, 1.3); ctx.shake(0.35); }
        if (mine) { ctx.callout('THE GROUND IS BREAKING', 'Hold on: you are about to fall!', e.d); ctx.tip('f3fall'); }
        break;
      }
      case 'fall': if (anim[key]?.kind !== 'fall') startFall(key, e.a, e.id, e.d, e.land); else Object.assign(anim[key], { d: e.d, land: e.land }); break;
      case 'land': if (mine) ctx.shake(0.45); if (near) { sfx.play('boom', null, 1.2); for (const p of players.values()) if (inRoomNow(key, p.x, p.z)) fx.ring(p.x, p.z, 2.2, 0xd6c9ae, 0.5); } break;
      case 'enter': mobs.get(e.id)?.model.anim?.cancelWindup?.(); anim[key] = { kind: 'enter', t0: clock, d: e.d, i: e.i, boss: e.id, x: e.x, z: e.z }; if (near) sfx.play('warn', { x: e.x, z: e.z }, 1.4); if (mine) ctx.callout('IT FOLLOWS YOU DOWN', 'Get clear of where it lands!', e.i + 0.4); break;
      case 'impact': {
        fx.ring(e.x, e.z, e.r + 2, 0xfde68a, 0.7); fx.ring(e.x, e.z, (e.r + 2) * 0.6, 0xffffff, 0.5); fx.shatter(e.x, e.z, true); fx.sparks(e.x, 0.4, e.z, 26, 0xd6c9ae, 0.35, 12);
        if (near) { sfx.play('boom', { x: e.x, z: e.z }, 1.6); sfx.play('roar', mobs.get(e.id)?.model.group.position || null, 1.4); ctx.shake(mine ? 0.8 : 0.3); }
        const area = areaDef(key, arenaState(key).area);
        if (mine && area) { ctx.banner(area.name.toUpperCase(), area.blurb || ''); ctx.tip('f3under'); }
        break;
      }
      case 'fire': if (near && e.f === 2) sfx.play('spell', null, 0.5); if (mine && e.f === 1) ctx.tip('f3fire'); break;
      case 'reset': if (anim[key]?.kind === 'crack') mobs.get(e.id)?.model.anim?.cancelWindup?.(); delete anim[key]; if (rubble[key]) { for (const b of rubble[key].list) b.d.visible = false; delete rubble[key]; } v.crack(0); v.setArea(0); break;
    }
    return true;
  }

  function startCrack(key, d) { anim[key] = { kind: 'crack', t0: clock, d: Math.max(0.5, d) }; }
  function startFall(key, area, boss, d, land) {
    const T = ARENAS[key].timing;
    d = Math.max(0.5, d || T.fall); land = land || T.land * (d / T.fall);
    rubble[key] = { t0: clock, d, list: dropDebris(key) };
    return (anim[key] = { kind: 'fall', t0: clock, d, land, area, swapped: false, boss });
  }
  function mobBoss(key) { for (const m of mobs.values()) if (m.type === ARENAS[key].boss) return m.id; return 0; }

  // Slabs of the plateau falling with everyone, landing as rubble.
  function dropDebris(key) {
    const A = ARENAS[key].room, v = views[key];
    return (v.debris || []).map(d => {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * (A.r - 5);
      d.position.set(A.x + Math.sin(a) * r, 16 + Math.random() * 6, A.z + Math.cos(a) * r);
      d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      d.visible = false;
      return { d, h: d.position.y, spin: [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3], delay: Math.random() * 0.25 };
    });
  }

  // ---------- per frame ----------
  function frame(dt) {
    clock += dt;
    let veilOn = 0;
    for (const key of ARENA_KEYS) {
      const v = views[key], a = anim[key];
      if (!v) continue;
      v.update?.(dt, clock);
      if (a?.kind === 'crack') {
        const k = Math.min(1, (clock - a.t0) / a.d);
        v.crack(k);
        if (here(key) && Math.random() < dt * 6) { const A = ARENAS[key].room, r = Math.random() * A.r, an = Math.random() * 6.28; fx.sparks(A.x + Math.sin(an) * r, 0.2, A.z + Math.cos(an) * r, 4, 0xd6c9ae, 0.25, 4); }
        if (here(key) && inRoomNow(key)) ctx.shake(0.06 + k * 0.12);
      } else if (a?.kind === 'fall') {
        const s = clock - a.t0, SW = 0.25; // the swap happens under the dark flash
        if (here(key)) veilOn = Math.max(veilOn, s < SW ? s / SW : Math.max(0, 1 - (s - SW) / 0.45));
        if (!a.swapped && s >= SW) { a.swapped = true; v.crack(0); v.setArea(a.area); for (const b of rubble[key]?.list || []) b.d.visible = true; }
        if (s > a.d + a.land + 1) delete anim[key];
      } else if (a?.kind === 'enter') {
        if (clock - a.t0 > a.d) delete anim[key];
      }
      const R = rubble[key];
      if (R) { // debris falls, settles as rubble, then sinks out of the way
        const s = clock - R.t0, SW = 0.25;
        for (const b of R.list) {
          const u = Math.max(0, (s - SW - b.delay) / Math.max(0.3, R.d - SW));
          if (u <= 1) { b.d.position.y = 0.3 + (b.h - 0.3) * (1 - u * u); b.d.rotation.x += b.spin[0] * dt; b.d.rotation.z += b.spin[1] * dt; }
          else if (s > R.d + 3) b.d.position.y = 0.3 - (s - R.d - 3) * 0.5;
        }
        if (s > R.d + 7) { for (const b of R.list) b.d.visible = false; delete rubble[key]; }
      }
      // the lower area's light: eased in while you're in (or watching) the room
      const want = v.area() > 0 && here(key) ? 1 : 0;
      const cur = low[key] ?? 0;
      if (Math.abs(cur - want) > 0.001) {
        const k = Math.abs(cur - want) < 0.01 ? want : cur + (want - cur) * Math.min(1, dt * 1.8);
        low[key] = k; tint(v, k);
      }
    }
    veil.style.opacity = veilOn.toFixed(3);
  }

  // Recolour the floor's atmosphere (the same objects, no new lights). The floor's own blend (floor2world.js) reads the
  // same ATMOS object, so a warp away and back keeps whatever this left in it.
  function tint(v, k) {
    const L = v.atmos[Math.max(1, v.area())] || v.atmos[1], U = v.up, B = v.base;
    if (!L) return;
    for (const key of Object.keys(U)) {
      if (typeof U[key] !== 'number' || key === 'near' || key === 'far' || key === 'hemi' || key === 'sunI') continue;
      B[key] = c1.setHex(U[key]).lerp(c2.setHex(L[key]), k).getHex();
    }
    for (const key of ['near', 'far', 'hemi', 'sunI']) B[key] = U[key] + (L[key] - U[key]) * k;
    if (!(state.x > 900 || state.spectator)) return; // (only applied directly while on Floor 3; elsewhere the floor blend does it)
    if (scene.background?.isColor) scene.background.setHex(B.sky);
    if (scene.fog) { scene.fog.color.setHex(B.sky); scene.fog.near = B.near; scene.fog.far = B.far; }
    if (hemi) { hemi.color.setHex(B.hemiSky); hemi.groundColor.setHex(B.hemiGround); hemi.intensity = B.hemi; }
    if (sun) { sun.color.setHex(B.sun); sun.intensity = B.sunI; }
  }

  // Vertical offset of a character while falling / the boss dropping in (main.js animateEntity adds it).
  function lift(e) {
    for (const key of ARENA_KEYS) {
      const a = anim[key];
      if (!a || a.kind === 'crack') continue;
      const s = clock - a.t0;
      if (a.kind === 'fall') {
        if (e.kind === 'mob' && e.id === a.boss) return -60; // the boss stays up there until it drops in
        if (s < 0.25 || !inRoomNow(key, e.model.group.position.x, e.model.group.position.z)) continue;
        const u = Math.min(1, (s - 0.25) / Math.max(0.3, a.d - 0.25));
        return 14 * (1 - u * u);
      }
      if (a.kind === 'enter' && e.kind === 'mob' && e.id === a.boss) {
        const u = Math.min(1, s / Math.max(0.2, a.i));
        return 30 * (1 - u * u);
      }
    }
    return 0;
  }
  function camLift() { const me = players.get(state.myId); return me ? lift(me) : 0; }

  // Falling or landing in a room: no moving, skills or rolls (the server ignores them too).
  function frozen() {
    for (const key of ARENA_KEYS) { const L = arenaState(key); if ((L.stage === 3 || L.stage === 4) && inRoomNow(key)) return true; }
    return false;
  }
  const speedMult = () => speedAt(state.x, state.z);
  function noDodge() {
    if (!sludgeAt(state.x, state.z)) return false;
    const now = performance.now();
    if (now - (noDodge.t || 0) > 1500) { noDodge.t = now; ctx.callout('STUCK IN SLUDGE', 'No rolling in it: wade out', 1.2); ctx.tip('f3sludge'); }
    return true;
  }

  return { snap, event, frame, lift, camLift, frozen, speedMult, noDodge };
}
