// The well awakens (owner request 2026-11-21; plan: docs/briefs/well-awakens.md).
// A waypoint with `wakes` (shared/floor2.js WAYPOINTS: Floor 1's well, the town fountain) is just scenery until your
// character has that floor unlocked: no glow, label or prompt (floor2client.js asks glow() and awake()). The moment it
// wakes for you (your first Warden kill, or the floor2 flag), a short shot cuts to it as its glow fades up from nothing,
// with its `woke` line ("A bright light emits from the well.") in the callout style, then back to you.
//   - Skippable: any key, click, tap or pad button (that press does nothing else). Never traps you: it ends on its own
//     after LEN s, and at once if the Game Menu opens or you go down.
//   - Not while you're dead, downed, rooted, falling into an arena or near a live boss: it waits until you're free (up to
//     QUEUE s, and only while you're still on that waypoint's floor), else it's dropped and the glow just fades in.
//   - Reduce motion: a still frame of the well (gentle dip-to-black cuts, no push-in).
//   - Spectators see every waypoint lit; the film view follows the director's `wake` cue (server/cine.js) instead.
// main.js wiring: inv() on each inv message, reset() on welcome, frame(dt) after the game camera is placed (returns the
// [x, z] it looks at while the shot runs), active (movement and the attack hold pause), the input gate asks swallow().
import * as THREE from 'three';
import { WAYPOINTS, waypointAwake, floorOf } from '/shared/floor2.js';

const DELAY = 2.5;  // s after the unlock before the shot (the kill's slow-mo and banners play first)
const QUEUE = 90;   // s it waits for you to be free before it gives up
const LEN = 3.8;    // s: the shot, dips included
const DIP = 0.25;   // s: each dip to black (out, cut, in)
const GLOW = [0.55, 2.4]; // s into the shot: the glow fades up from nothing over this span
const BOSS_NEAR = 40; // m: a live boss this close means you're still in a fight
const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export function initWellWake({ camera, state, mobs, fx, sfx, occluders = [], calm = () => false, busy = () => false, callout, tip, onStart = () => {}, film = false }) {
  const n = WAYPOINTS.length;
  const asleep = () => WAYPOINTS.map(w => (w.wakes ? 0 : 1)); // (until we know your character: the sleeping ones stay dark)
  const lit = asleep(), flare = new Array(n).fill(0);
  let base = null;         // per waypoint: awake when we last looked (null until the first inv after joining)
  let pending = null;      // { i, at, until }: a shot waiting to play
  let shot = null;         // { i, t, w, az, calm, beam, said }
  let eatUntil = 0;        // ms: the skip press is swallowed (keys, clicks)
  const filmWake = { on: false, k: 0 };

  const fade = document.createElement('div');
  fade.id = 'wake-fade';
  fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:45';
  document.body.appendChild(fade);

  const stats = () => state.inv?.life;
  const awakeNow = () => WAYPOINTS.map(w => waypointAwake(w, stats()));

  // ---------- the unlock ----------
  function reset() { if (shot) end(); base = null; pending = null; asleep().forEach((v, i) => { lit[i] = v; }); }
  function inv() {
    if (state.spectator || !state.inv) return;
    const now = awakeNow();
    if (!base) { base = now; now.forEach((a, i) => { lit[i] = a ? 1 : 0; }); return; } // (joining: as it is, no shot)
    now.forEach((a, i) => {
      if (a && !base[i]) { // it just woke for you
        const w = WAYPOINTS[i];
        if (w.woke && floorOf(state.x) === w.floor) pending = { i, at: performance.now() / 1000 + DELAY, until: performance.now() / 1000 + QUEUE };
        else lit[i] = Math.max(lit[i], 0.001); // (elsewhere: it just fades in)
      }
      if (!a) lit[i] = 0;
    });
    base = now;
  }

  function bossNear() {
    for (const m of mobs.values()) if (m.def?.boss && !m.dead && Math.hypot(m.x - state.x, m.z - state.z) < BOSS_NEAR) return true;
    return false;
  }
  const free = () => state.joined && !state.spectator && !state.dead && !state.downed && !busy() && !bossNear();

  // ---------- the shot ----------
  function start(i) {
    const w = WAYPOINTS[i];
    pending = null;
    // the camera stands on your side of it, looking at it from a little way off
    shot = { i, w, t: 0, az: Math.atan2(state.x - w.x, state.z - w.z), calm: !!calm(), beam: false, said: false, cut: false };
    lit[i] = 0; flare[i] = 0;
    onStart();
    document.body.classList.add('well-shot');
  }
  function end() {
    if (!shot) return;
    const i = shot.i;
    lit[i] = 1; flare[i] = 0;
    fade.style.transition = `opacity ${DIP}s ease`; fade.style.opacity = '0';
    shot = null;
    document.body.classList.remove('well-shot');
    tip?.('waypoint'); // (once: how travel works, now there's somewhere to go)
  }
  function skip() { if (!shot) return false; eatUntil = performance.now() + 150; end(); return true; }

  // any fresh key, click, tap or pad button skips (and does nothing else)
  addEventListener('keydown', e => { if (shot && !e.repeat && !/^(Shift|Control|Alt|Meta)/.test(e.code) && !(e.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName))) { skip(); e.preventDefault(); } }, true);
  addEventListener('pointerdown', () => { if (shot) skip(); }, true);
  const onPad = (name, down) => (down && shot ? skip() : false);
  const swallow = () => !!shot || performance.now() < eatUntil; // the input gate: no actions while it plays

  // Light column rising from it as it wakes (additive, fades out).
  function beam(w) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, 26, 20, 1, true), fx.fadeMat(0xdbeafe, 0));
    m.material.blending = THREE.AdditiveBlending; m.material.side = THREE.DoubleSide;
    m.position.set(w.x, 13, w.z);
    fx.add(m, 2.6, (mesh, k) => { mesh.material.opacity = 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.15)); mesh.scale.set(1 + k * 0.3, Math.max(0.05, ease(k * 2)), 1 + k * 0.3); });
    fx.ring(w.x, w.z, w.use + 1, 0xbfdbfe, 1.4);
  }

  const ray = new THREE.Raycaster(), V = new THREE.Vector3(), L = new THREE.Vector3();
  function frame(dt) {
    const now = performance.now() / 1000;
    if (state.spectator) { // film view: the director's wake cue; other spectators: lit
      filmWake.k = film ? Math.max(0, Math.min(1, filmWake.k + (filmWake.on ? dt / (GLOW[1] - GLOW[0]) : -dt * 4))) : 1;
      WAYPOINTS.forEach((w, i) => { lit[i] = w.wakes ? ease(filmWake.k) : 1; flare[i] = w.wakes && film ? Math.sin(Math.PI * filmWake.k) * (filmWake.on ? 1 : 0) : 0; });
      return null;
    }
    for (let i = 0; i < n; i++) if (lit[i] > 0 && lit[i] < 1 && !(shot?.i === i) && !(pending?.i === i)) lit[i] = Math.min(1, lit[i] + dt / 1.5); // (fading in without a shot)
    if (pending && !shot) {
      const w = WAYPOINTS[pending.i];
      if (now > pending.until || floorOf(state.x) !== w.floor || !state.joined) { lit[pending.i] = 0.001; pending = null; } // dropped: it just fades in
      else if (now >= pending.at && free()) start(pending.i);
    }
    if (!shot) return null;
    if (!state.joined || state.dead || state.downed || busy()) { end(); return null; } // never trap you: anything comes up, it ends
    const s = shot, w = s.w;
    s.t += dt;
    const t = s.t;
    if (t >= LEN) { end(); return null; }
    // dips to black: out before the cut to the well, in after it; out again before the cut back
    const black = t < DIP ? t / DIP : t < 2 * DIP ? 1 - (t - DIP) / DIP : t > LEN - DIP ? (t - (LEN - DIP)) / DIP : 0;
    fade.style.transition = 'none'; fade.style.opacity = String(Math.max(0, Math.min(1, black)));
    if (t < DIP) return null; // still on you, going dark
    // the glow fades up from nothing, with a burst of light at the start
    const g = (t - GLOW[0]) / (GLOW[1] - GLOW[0]);
    lit[s.i] = ease(g);
    flare[s.i] = g > 0 && g < 1.4 ? Math.sin(Math.PI * Math.min(1, g / 1.4)) : 0;
    if (!s.beam && t >= GLOW[0]) { s.beam = true; if (!s.calm) beam(w); else fx.ring(w.x, w.z, w.use + 1, 0xbfdbfe, 1.4); sfx?.play('rare'); }
    if (!s.said && t >= GLOW[0] + 0.15) { s.said = true; callout(w.woke[0], w.woke[1], LEN - GLOW[0] - 0.6); }
    // the camera: a slow push in and a little drift round it (Reduce motion: a still frame)
    const u = s.calm ? 1 : ease((t - DIP) / (LEN - 2 * DIP));
    const az = s.az + (s.calm ? 0 : -0.18 + 0.18 * u), d = 15 - 3.5 * u, y = 5.6 - 1.2 * u;
    L.set(w.x, 2.6 + 0.6 * u, w.z);
    V.set(w.x + Math.sin(az) * d, y, w.z + Math.cos(az) * d);
    if (occluders.length) { // never behind a wall or a roof: pull in toward the well
      ray.set(L, V.clone().sub(L).normalize()); ray.near = 0; ray.far = d;
      const hit = ray.intersectObjects(occluders, true)[0];
      if (hit) V.sub(L).multiplyScalar(Math.max(4, hit.distance - 0.6) / d).add(L);
    }
    camera.position.copy(V); camera.lookAt(L);
    return [w.x, w.z];
  }

  // The film view (server/cine.js `wake`): on fades the sleeping waypoints up, off puts them back to sleep.
  function filmCue(on, late) { filmWake.on = !!on; if (late || !on) filmWake.k = on ? 1 : 0; }

  // floor2client.js: per waypoint 0-1 (0 = dormant: no glow), and the burst as it wakes.
  const glow = () => ({ lit, flare });
  return { inv, reset, frame, glow, swallow, onPad, skip, filmCue, get active() { return !!shot; }, get pending() { return pending ? { ...pending } : null; }, get view() { return shot ? { t: shot.t, i: shot.i, calm: shot.calm } : null; } };
}
