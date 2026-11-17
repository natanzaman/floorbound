// Client side of the combat core: posture bars, perfect dodge / parry feedback, the Guardian's guard (R),
// the Warden's perilous Horn Sweep telegraph and its Quake Rings. main.js calls initCombat() once and routes events here first.
import * as THREE from 'three';
import { GUARD } from '/shared/data.js';

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);

const CSS = `
.lbl .pbar { width: 64px; height: 3px; margin: 1px auto 0; border-radius: 2px; background: rgba(0,0,0,.45); overflow: hidden; display: none; }
.lbl.mob.elite .pbar { width: 90px; }
.lbl .pbar > div { height: 100%; width: 0; background: linear-gradient(90deg, #facc15, #fde047); transition: width .12s; }
.lbl .pbar.hi > div { background: linear-gradient(90deg, #f59e0b, #fde047); box-shadow: 0 0 4px #fde047; }
.lbl .pbar.brk > div, .bar.posture.brk > div { animation: cb-blink .25s steps(2) infinite; background: #fff7ae; }
.bar.posture { height: 4px; margin-top: 3px; background: rgba(0,0,0,.4); }
.bar.posture > div { background: linear-gradient(90deg, #eab308, #fde047); }
.bar.boss-posture { height: 5px; margin: 3px auto 0; width: 100%; border: 1px solid rgba(253,224,71,.35); background: rgba(0,0,0,.45); }
.bar.boss-posture > div { background: linear-gradient(90deg, #ca8a04, #fde047); }
.bar.boss-posture.brk > div { animation: cb-blink .25s steps(2) infinite; background: #fff7ae; }
@keyframes cb-blink { 50% { opacity: .35; } }
#cb-flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 20; }
#cb-flash.go { animation: cb-flash .45s ease-out; }
@keyframes cb-flash { 0% { opacity: .75; } 100% { opacity: 0; } }
.num.perfect { color: #fff; font-size: 26px; letter-spacing: .08em; text-shadow: 0 0 14px #93c5fd, 0 0 4px #fff, 0 2px 4px #000; }
.num.parry { color: #fde68a; font-size: 26px; letter-spacing: .08em; text-shadow: 0 0 14px #f59e0b, 0 2px 4px #000; }
.num.counter { color: #fdba74; font-size: 18px; letter-spacing: .06em; }
.sk.sg { border-color: rgba(147,197,253,.6); }
.sk.sg.on { border-color: #fde68a; background-color: rgba(96,165,250,.35); }
`;

export function initCombat(ctx) {
  const { state, players, mobs, fx, sfx, floatNum, slowMotion, shake, guide, send, bossShot } = ctx;
  const callout = ctx.callout || (() => {});
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const flash = document.createElement('div'); flash.id = 'cb-flash'; document.body.appendChild(flash);
  const whiteFlash = () => { flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); };
  const near = (x, z, r) => Math.hypot(x - state.x, z - state.z) < r;
  const shakeNear = ctx.shakeNear || ((x, z, a, r) => near(x, z, r) && shake(a));
  const mineTo = e => (e.to ?? e.id) === state.myId; // a reaction you performed: only you see its text (docs/ROADMAP.md A2)

  // ---------- extra sounds (same building blocks as audio.js) ----------
  const basePlay = sfx.play.bind(sfx);
  sfx.play = (name, pos, vol = 1) => {
    if (!EXTRA[name]) return basePlay(name, pos, vol);
    if (!sfx.ctx || !sfx.on) return;
    const o = sfx.out(vol, pos);
    if (o) EXTRA[name](o);
  };
  const EXTRA = {
    perfect: o => { // a bright whoosh and a rising chime
      sfx.noise(o, { dur: 0.35, vol: 0.35, type: 'highpass', f: 1500, to: 7000, attack: 0.01 });
      [84, 88, 91, 96].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.5, vol: 0.13, type: 'triangle', at: i * 0.045 }));
      sfx.tone(o, { f: NOTE(60), to: NOTE(72), dur: 0.4, vol: 0.18, type: 'sine' });
    },
    parry: o => { // metal on metal: an inharmonic clang
      sfx.noise(o, { dur: 0.05, vol: 0.7, type: 'highpass', f: 4000, attack: 0.001 });
      [1180, 1730, 2650, 3410].forEach((f, i) => sfx.tone(o, { f, dur: 0.6 - i * 0.1, vol: 0.16, type: i % 2 ? 'square' : 'triangle', attack: 0.001 }));
      sfx.tone(o, { f: 140, to: 60, dur: 0.25, vol: 0.5 });
    },
    peril: o => { // a low horn swelling up, then a sharp glint
      sfx.tone(o, { f: 196, to: 392, dur: 0.55, vol: 0.28, type: 'sawtooth', attack: 0.06 });
      sfx.tone(o, { f: 98, to: 147, dur: 0.6, vol: 0.25, type: 'triangle', attack: 0.06 });
      sfx.tone(o, { f: 2400, dur: 0.25, vol: 0.18, type: 'square', at: 0.5, attack: 0.002 });
      sfx.tone(o, { f: 3600, dur: 0.35, vol: 0.12, type: 'sine', at: 0.52 });
    },
    guardUp: o => { sfx.tone(o, { f: 180, to: 140, dur: 0.15, vol: 0.25, type: 'triangle' }); sfx.noise(o, { dur: 0.08, vol: 0.2, type: 'lowpass', f: 800 }); },
    sweep: o => { sfx.noise(o, { dur: 0.6, vol: 0.6, type: 'bandpass', f: 400, to: 2400, q: 0.8, attack: 0.02 }); sfx.tone(o, { f: 80, to: 35, dur: 0.7, vol: 0.7 }); },
    quakeWarn: o => { // the ground groaning: a low swelling rumble with a grinding edge, then two war-drum knocks
      sfx.noise(o, { dur: 1.3, vol: 0.45, type: 'lowpass', f: 140, to: 420, attack: 0.5 });
      sfx.tone(o, { f: 45, to: 70, dur: 1.3, vol: 0.45, type: 'sawtooth', attack: 0.4 });
      [0.55, 0.95].forEach(at => sfx.tone(o, { f: 110, to: 50, dur: 0.22, vol: 0.4, type: 'triangle', at, attack: 0.005 }));
    },
    quake: o => { // the stomp: a deep thud and a rolling crack of stone
      sfx.tone(o, { f: 70, to: 28, dur: 0.6, vol: 0.85, attack: 0.003 });
      sfx.noise(o, { dur: 0.9, vol: 0.55, type: 'lowpass', f: 900, to: 160, attack: 0.005 });
      sfx.noise(o, { dur: 0.25, vol: 0.3, type: 'bandpass', f: 2200, q: 1.2, attack: 0.002 });
    },
  };

  // ---------- guard (Guardian, hold R) ----------
  let guarding = false, tipped = false;
  const shields = new Map(); // player id -> shield mesh
  function shieldOn(id, on) {
    const p = players.get(id);
    const old = shields.get(id);
    if (old) { old.parent?.remove(old); old.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); shields.delete(id); }
    if (!on || !p) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.7, 20, 1, true, -1.0, 2.0),
      new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.07, 1.07, 0.09, 20, 1, true, -1.0, 2.0),
      new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    rim.position.y = 0.85; m.add(rim);
    m.position.y = 1.0;
    p.model.group.add(m);
    shields.set(id, m);
  }
  function guard(on) {
    if (!state.joined || state.spectator) return;
    if (on && state.cls !== 'guardian') { guide.tip('rguard'); return; }
    if (on && (state.dead || guarding)) return;
    if (!on && !guarding) return;
    guarding = on;
    send({ type: 'guard', on });
    shieldOn(state.myId, on);
    if (on) sfx.play('guardUp', null, 0.7);
    if (on) players.get(state.myId)?.model.anim?.shot('Block', 1);
  }

  // ---------- Horn Sweep telegraph ----------
  let glintTex = null;
  function glintTexture() {
    if (glintTex) return glintTex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,240,160,.95)'); grd.addColorStop(0.35, 'rgba(251,146,60,.55)'); grd.addColorStop(1, 'rgba(251,146,60,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    g.font = '900 92px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#7c2d12'; g.strokeText('!', 64, 68);
    g.fillStyle = '#fffbeb'; g.fillText('!', 64, 68);
    glintTex = new THREE.CanvasTexture(c);
    return glintTex;
  }
  const sweeps = new Map(); // mob id -> [fx entries]
  function lastFx() { return fx.list[fx.list.length - 1]; }
  function sweepTelegraph(e) {
    const m = mobs.get(e.follow), pos = () => m?.model.group.position || { x: e.x, z: e.z };
    const g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.RingGeometry(e.r - 0.4, e.r, 64), fx.fadeMat(0xf59e0b, 0.95));
    const inner = new THREE.Mesh(new THREE.RingGeometry(e.r - 0.9, e.r - 0.75, 64), fx.fadeMat(0xfde047, 0.7));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(e.r, 64), fx.fadeMat(0xfb923c, 0.28));
    for (const o of [edge, inner, fill]) o.rotation.x = -Math.PI / 2;
    fill.position.y = 0.01;
    g.add(edge, inner, fill); g.position.set(e.x, 0.1, e.z);
    fx.add(g, e.d, (mesh, k) => {
      const p = pos(); mesh.position.set(p.x, 0.1, p.z);
      fill.scale.setScalar(Math.max(0.01, k));
      edge.material.opacity = 0.6 + 0.35 * Math.sin(k * 30);
    });
    const ring = lastFx();
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), transparent: true, depthWrite: false, depthTest: false }));
    const h = (m?.model.height || 7) + 1.6;
    fx.add(spr, e.d, (s, k) => {
      const p = pos(); s.position.set(p.x, h, p.z);
      const sc = 2.6 + Math.sin(k * 26) * 0.5 + (k < 0.15 ? (0.15 - k) * 20 : 0);
      s.scale.set(sc, sc, 1);
      s.material.opacity = k > 0.9 ? (1 - k) * 10 : 1;
    });
    sweeps.set(e.follow, [ring, lastFx()]);
    sfx.play('peril', pos(), 1.4);
    m?.model.anim?.windup?.('sweep', e.d); // coils round, axe wound back (world.js WINDUPS)
    if (near(e.x, e.z, e.r + 6)) guide.tip('peril');
  }

  // ---------- Quake Ring ----------
  // Ring 0 of a volley: the wind-up (the Warden rears up and smashes down, a cracked amber disc spreads under it, and a
  // dashed amber boundary marks how far the rings reach). Every ring: at its start, a low wall of rock and dust rolls
  // out to that boundary. Jump over it as it reaches you, roll through it, or stand outside the boundary.
  const isTouch = () => document.body.classList.contains('touch');
  function band(mesh, inner, outer) { mesh.geometry.dispose(); mesh.geometry = new THREE.RingGeometry(Math.max(0.01, inner), outer, 96); }
  function quakeWindup(e) {
    const m = mobs.get(e.by), last = e.d + (e.n - 1) * (e.g ?? 1), life = last + e.max / e.sp + 0.2;
    const g = new THREE.Group();
    const reach = new THREE.Mesh(new THREE.RingGeometry(e.max - 0.18, e.max + 0.18, 128), fx.fadeMat(0xf59e0b, 0.8));
    const ticks = new THREE.Group();
    for (let i = 0; i < 36; i++) { // dashes just inside the boundary: "the rings stop here"
      const a = (i / 36) * Math.PI * 2, d = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.1), fx.fadeMat(0xfde68a, 0.75));
      d.position.set(Math.sin(a) * (e.max - 0.9), Math.cos(a) * (e.max - 0.9), 0); d.rotation.z = -a; ticks.add(d);
    }
    const core = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), fx.fadeMat(0xb45309, 0.45));
    const coreEdge = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.3, 48), fx.fadeMat(0xfbbf24, 0.9));
    for (const o of [reach, ticks, core, coreEdge]) { o.rotation.x = -Math.PI / 2; g.add(o); }
    core.position.y = coreEdge.position.y = 0.02;
    g.position.set(e.x, 0.09, e.z);
    let t = 0;
    fx.add(g, life, (mesh, k, dt) => {
      t += dt || 0;
      const wind = Math.min(1, t / Math.max(0.1, e.d)), pulse = 0.5 + 0.5 * Math.sin(t * (10 + wind * 18));
      core.scale.setScalar(0.2 + 0.8 * wind);
      core.material.opacity = t < e.d ? 0.25 + 0.3 * pulse : Math.max(0, 0.45 * (1 - (t - e.d) / 0.6));
      coreEdge.scale.setScalar(0.2 + 0.8 * wind); coreEdge.material.opacity = t < last + 0.2 ? 0.55 + 0.4 * pulse : 0;
      reach.material.opacity = (k > 0.85 ? (1 - k) / 0.15 : 1) * (0.5 + 0.35 * pulse);
      ticks.rotation.z += (dt || 0) * 0.15;
      for (const d of ticks.children) d.material.opacity = reach.material.opacity * 0.9;
    });
    const pos = m?.model.group.position || { x: e.x, z: e.z };
    sfx.play('quakeWarn', pos, 1.5);
    m?.model.anim?.windup?.('quake', e.d); // rears up on one leg, then stomps
    const mine = !state.spectator && near(e.x, e.z, e.max + 4);
    if (mine || (state.spectator && near(e.x, e.z, 60))) {
      callout(e.n > 1 ? `QUAKE RINGS ×${e.n}` : 'QUAKE RING', `${isTouch() ? 'Jump' : 'Jump (Space)'} as the wave reaches you, roll through it, or get outside the amber ring`, e.d + 0.5);
    }
    if (mine) guide.tip('quake');
  }
  // The wavefront is placed by the wall clock, not effect time: slow motion (a perfect dodge on the first ring) or a
  // slow frame must never make the next ring look later than it really is.
  function quakeRing(e) {
    const m = mobs.get(e.by), t0 = performance.now() / 1000 + Math.max(0, e.d), life = e.max / e.sp;
    if (e.i > 0 && m) setTimeout(() => m.model.anim?.windup?.('quake', 0.6), Math.max(0, e.d - 0.6) * 1000); // stomps again for each ring
    setTimeout(() => {
      const g = new THREE.Group();
      const glowMat = c => { const mt = fx.fadeMat(c, 0.9); mt.blending = THREE.AdditiveBlending; return mt; };
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), fx.fadeMat(0xea580c, 0.8));
      const crest = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.14, 96, 1, true), glowMat(0xfff1c2));
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 96), glowMat(0xffb020));
      const wake = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 96), fx.fadeMat(0x5b3412, 0.5));
      glow.rotation.x = wake.rotation.x = -Math.PI / 2; glow.position.y = 0.07; wake.position.y = 0.05;
      g.add(wake, wall, glow, crest); g.position.set(e.x, 0, e.z);
      let shook = false, entry = null;
      fx.add(g, life + 2, mesh => {
        const k = (performance.now() / 1000 - t0) / life;
        if (k >= 1) { mesh.visible = false; fx.end(entry); return; }
        const r = Math.max(0.3, k * e.max), h = 1.0 * (1 - 0.35 * k);
        wall.scale.set(r, h, r); wall.position.y = h / 2; crest.scale.set(r, 1, r); crest.position.y = h;
        band(glow, r - e.w, r + e.w); band(wake, Math.max(0, r - e.w - 2.4), r - e.w);
        const a = k > 0.82 ? (1 - k) / 0.18 : 1;
        wall.material.opacity = 0.8 * a; crest.material.opacity = 0.9 * a; glow.material.opacity = 0.9 * a; wake.material.opacity = 0.5 * a;
        if (!shook && !state.dead && Math.abs(Math.hypot(state.x - e.x, state.z - e.z) - r) < e.w + 0.3) { shook = true; shake(0.22); }
      });
      entry = lastFx();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; fx.sparks(e.x + Math.sin(a) * 2.6, 0.4, e.z + Math.cos(a) * 2.6, 4, 0xd6b98c, 0.3, 5); }
      fx.ring(e.x, e.z, 3.5, 0xfbbf24, 0.35);
      sfx.play('quake', m?.model.group.position || { x: e.x, z: e.z }, 1.4);
      shakeNear(e.x, e.z, 0.35, 30); // the stomp that throws the ring
    }, Math.max(0, e.d) * 1000);
  }

  // ---------- events ----------
  function event(e) {
    const me = state.myId;
    switch (e.t) {
      case 'quake':
        if (e.i === 0) quakeWindup(e);
        quakeRing(e);
        return true;
      case 'tele':
        if (e.k !== 'sweep') return false;
        sweepTelegraph(e);
        return true;
      case 'fx':
        if (e.k !== 'sweep') return false;
        sweeps.delete(e.id);
        fx.ring(e.x, e.z, e.r, 0xfbbf24, 0.6); fx.ring(e.x, e.z, e.r * 0.7, 0xfb923c, 0.5); fx.ring(e.x, e.z, e.r * 1.1, 0xffffff, 0.35);
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; fx.sparks(e.x + Math.sin(a) * e.r * 0.9, 0.6, e.z + Math.cos(a) * e.r * 0.9, 5, 0xfde68a, 0.3, 6); }
        sfx.play('sweep', { x: e.x, z: e.z }, 1.3);
        shakeNear(e.x, e.z, 0.5, 30);
        return true;
      case 'pcancel': {
        for (const f of sweeps.get(e.id) || []) fx.end(f);
        sweeps.delete(e.id);
        const m = mobs.get(e.id);
        if (m) floatNum(m.model.group.position, m.model.height + 0.8, 'SWEEP BROKEN', 'counter');
        return true;
      }
      case 'perfect': {
        const p = players.get(e.id);
        if (e.id === me) { whiteFlash(); slowMotion(0.5, 0.22); guide.tip('perfect'); }
        else if (state.spectator && p) slowMotion(0.3, 0.35);
        if (p && (e.id === me || state.spectator || near(p.x, p.z, 25))) {
          const g = p.model.group.position;
          if (mineTo(e)) floatNum(g, 2.6, 'PERFECT', 'perfect');
          fx.ring(g.x, g.z, 2.2, 0xffffff, 0.45); fx.ring(g.x, g.z, 3.4, 0x93c5fd, 0.55);
          fx.sparks(g.x, 1.2, g.z, 10, 0xe0f2fe, 0.25, 6);
          sfx.play('perfect', g, e.id === me ? 1.1 : 0.6);
        }
        const m = mobs.get(e.m);
        if (m) m.flash = 0.12;
        return true;
      }
      case 'parry': {
        const p = players.get(e.id);
        if (!p) return true;
        const g = p.model.group.position, fx0 = g.x + Math.sin(e.f) * 0.9, fz0 = g.z + Math.cos(e.f) * 0.9;
        fx.sparks(fx0, 1.3, fz0, 16, 0xfde68a, 0.32, 9); fx.sparks(fx0, 1.3, fz0, 8, 0xffffff, 0.4, 5);
        fx.ring(fx0, fz0, 2.4, 0xfbbf24, 0.4);
        sfx.play('parry', g, e.id === me ? 1.2 : 0.8);
        if (mineTo(e)) floatNum(g, 2.6, 'PARRY!', 'parry');
        p.model.anim?.shot('Block_Attack', 1.6);
        if (e.id === me || state.spectator) { slowMotion(0.3, 0.3); shake(0.3); }
        const m = mobs.get(e.m);
        if (m) { m.flash = 0.12; m.model.anim?.shot('Hit_B', 1.2); }
        return true;
      }
      case 'guard':
        if (e.id !== me) shieldOn(e.id, !!e.on);
        else if (!e.on && guarding) { guarding = false; shieldOn(me, false); } // dropped server-side (e.g. on death)
        return true;
      case 'counter': {
        const m = mobs.get(e.id);
        if (m && (e.to ?? e.by) === me) floatNum(m.model.group.position, m.model.height * 0.95, 'COUNTER', 'counter');
        return true;
      }
    }
    return false;
  }

  // ---------- posture bars ----------
  function label(e) { // a thin yellow bar under a nameplate's HP bar
    const L = e.label;
    if (!L) return;
    if (!L.pbar) {
      L.pbar = document.createElement('div'); L.pbar.className = 'pbar'; L.pbar.innerHTML = '<div></div>';
      L.el.appendChild(L.pbar); L.pfill = L.pbar.firstChild; L.ppct = -1;
    }
    const pct = e.staggered ? 100 : e.posture || 0, key = pct + (e.staggered ? 'b' : '');
    if (key === L.ppct) return;
    L.ppct = key;
    L.pbar.style.display = pct > 0 ? 'block' : 'none';
    L.pfill.style.width = `${pct}%`;
    L.pbar.className = `pbar${e.staggered ? ' brk' : pct >= 70 ? ' hi' : ''}`;
    if (pct >= 50 && !e.staggered && near(e.x, e.z, 15)) guide.tip('posture');
  }
  const frameBar = t => `<div class="bar posture${t.staggered ? ' brk' : ''}"><div style="width:${t.staggered ? 100 : t.posture || 0}%"></div></div>`;
  let bossEl = null;
  function bossBar(boss) {
    if (!bossEl) {
      const hp = document.querySelector('#boss .boss-hp');
      if (!hp) return;
      bossEl = document.createElement('div'); bossEl.className = 'bar boss-posture'; bossEl.innerHTML = '<div></div>';
      hp.after(bossEl);
    }
    const pct = boss.staggered ? 100 : boss.posture || 0;
    bossEl.firstChild.style.width = `${pct}%`;
    bossEl.classList.toggle('brk', !!boss.staggered);
    if (pct >= 50 && !boss.staggered && near(boss.x, boss.z, 25)) guide.tip('posture');
  }

  // ---------- per-frame: keep facing the enemy while guarding; drop the guard when rolling or dead ----------
  function frame() {
    if (!guarding) return;
    if (state.dead || state.roll) { guard(false); return; }
    const t = ctx.lockedMob() || ctx.nearestMob(12);
    if (t) state.face = Math.atan2(t.x - state.x, t.z - state.z);
    const s = shields.get(state.myId);
    if (s) s.material.opacity = 0.26 + Math.sin(performance.now() / 120) * 0.06;
  }

  const guardButton = (cls, touch) => cls === 'guardian' && !touch
    ? `<button class="sk sg" data-slot="guard" title="Guard (hold R): frontal hits take 70% less damage; you can't attack. Press it just before a hit lands to PARRY."><span class="key">R</span>Guard<span class="cd"></span><span class="cdt"></span></button>` : '';
  function bindGuardButton(b) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); guard(true); });
    const up = () => { b.classList.remove('pressed'); guard(false); };
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  }

  return {
    event, label, frameBar, bossBar, guard, frame, guardButton, bindGuardButton,
    get guarding() { return guarding; },
    speedMult: () => (guarding ? GUARD.speed : 1),
  };
}
