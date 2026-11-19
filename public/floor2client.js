// Floor 2 — The Glimmering Mire: client runtime. Snapshot state (gate 2, orbs, pools, burrowed lurkers, the Deluge,
// the Stairway), Floor 2 events and effects, waystone travel UI, and atmosphere. main.js wires it in with a few calls.
import * as THREE from 'three';
import { F2, GATE2, WAYSTONES, STAIRWAY, PHASE_TEXT2, inArena2, inGateZone2, nearWaystone, floorUnlocked, onFloor2, floorOf } from '/shared/floor2.js';
import { FLOOR_NAMES, onFloor3 } from '/shared/floor3.js';
import { createFloor2 } from '/floor2world.js';
import { PACE } from '/shared/data.js';

// ctx: { scene, sun, occluders, fx, sfx, state, mobs, players, send, banner, callout, floatNum, log, shake, project, isTouch, hallOpen }
export function initFloor2Client(ctx) {
  const { scene, fx, sfx, state, mobs, players } = ctx;
  const world = createFloor2(scene, { sun: ctx.sun, occluders: ctx.occluders });
  const data = { ph: 0, del: 0, gate: [0, 0, 0, 0] };
  const orbs = new Map(), pools = new Map(), ripples = [], waves = [];
  const fade = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
  const me = () => players.get(state.myId);
  const near = (x, z, d) => Math.hypot(x - state.x, z - state.z) < d;
  const lastBlock = new Map();

  // ---------- labels for the waystones and the Stairway ----------
  const labels = document.getElementById('labels');
  const mkLabel = () => { const el = document.createElement('div'); el.className = 'lbl npc'; el.style.display = 'none'; labels.appendChild(el); return el; };
  const wsLabels = WAYSTONES.map(mkLabel), stairLabel = mkLabel();
  function place(el, x, y, z, html, maxD) {
    const p = ctx.project(x, y, z), d = Math.hypot(state.x - x, state.z - z);
    if (!p || d > maxD || !state.joined) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = `${p[0]}px`; el.style.top = `${p[1]}px`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // ---------- waystone panel ----------
  const panel = document.createElement('div');
  panel.id = 'warp'; panel.className = 'panel hidden';
  panel.style.cssText = 'position:absolute;top:30%;left:50%;transform:translateX(-50%);min-width:280px;padding:12px 16px;border-color:rgba(94,234,212,.5);z-index:4';
  document.getElementById('hud').appendChild(panel);
  const unlocked = f => floorUnlocked(state.inv?.life, f);
  function renderPanel() {
    const here = floorOf(state.x);
    const row = w => {
      const open = unlocked(w.floor), cur = w.floor === here;
      const btn = cur ? '<small style="opacity:.6">You are here</small>' : open ? `<button data-f="${w.floor}" style="padding:6px 14px;border-radius:7px;border:0;font-weight:800;background:linear-gradient(90deg,#0d9488,#2dd4bf)">Travel</button>` : '<small style="opacity:.6">Sealed</small>';
      const sub = open ? w.name : `Help defeat ${w.floor === 3 ? 'the Drowned Sovereign' : 'the Horned Warden'} to open it`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)"><span><b>${FLOOR_NAMES[w.floor]}</b><br><small style="opacity:.7">${sub}</small></span>${btn}</div>`;
    };
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;font-weight:800;letter-spacing:.12em;color:#99f6e4">WAYSTONE<button data-a="close" style="padding:2px 9px;border-radius:6px;border:1px solid rgba(160,200,255,.3);background:transparent">✕</button></div>${WAYSTONES.map(row).join('')}`;
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'close') { panel.classList.add('hidden'); sfx.play('ui'); return; }
    if (b.dataset.f) { ctx.send({ type: 'warp', f: +b.dataset.f }); panel.classList.add('hidden'); sfx.play('ui'); }
  });

  // ---------- per-snapshot state ----------
  function snap(f2) {
    Object.assign(data, f2);
    if (onFloor2(state.x)) { state.gate = f2.gate; state.gateOpen = !!f2.gate[0]; }
    world.gate2.set(!!f2.gate[0]);
    world.stairway.set(f2.stair || null);
    const seen = new Set();
    for (const [id, x, z] of f2.orbs) { // homing orbs (wisps and the Sovereign)
      seen.add(id);
      let o = orbs.get(id);
      if (!o) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe0fbff })));
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), fade(0x2dd4bf, 0.35)));
        g.position.set(x, 1.2, z); scene.add(g);
        o = { g, x, z }; orbs.set(id, o);
      }
      o.x = x; o.z = z;
    }
    for (const [id, o] of orbs) if (!seen.has(id)) { scene.remove(o.g); o.g.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); }); orbs.delete(id); }
    seen.clear();
    for (const [id, x, z, r, armed] of f2.pools) { // mire pools: damage while you stand in them
      seen.add(id);
      let p = pools.get(id);
      if (!p) {
        const g = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), fade(0x7e22ce, 0.25)); disc.rotation.x = -Math.PI / 2;
        const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 48), fade(0xc084fc, 0.7)); edge.rotation.x = -Math.PI / 2; edge.position.y = 0.01;
        g.add(disc, edge); g.position.set(x, 0.1, z); scene.add(g);
        p = { g, disc, edge, t: 0 }; pools.set(id, p);
      }
      p.armed = armed;
    }
    for (const [id, p] of pools) if (!seen.has(id)) { scene.remove(p.g); p.g.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); }); pools.delete(id); }
    while (ripples.length < f2.bur.length) { // burrowed lurkers: a ring of bubbling mud
      const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.9, 20), fade(0x8b6b3a, 0.6)); m.rotation.x = -Math.PI / 2;
      scene.add(m); ripples.push(m);
    }
    ripples.forEach((m, i) => { const b = f2.bur[i]; m.visible = !!b; if (b) { m.position.set(b[0], 0.06, b[1]); m.userData.hot = b[2]; } });
  }

  // ---------- events ----------
  function onEvent(e) {
    const myId = state.myId;
    switch (e.t) {
      case 'f2fx': {
        const at = { x: e.x, z: e.z };
        if (e.k === 'blink') { fx.ring(e.x, e.z, 1.4, 0x67e8f9, 0.4); fx.line(e.x, e.z, e.x2, e.z2, 0x67e8f9, 0.15, 0.3, 1.7); fx.ring(e.x2, e.z2, 1.6, 0xa5f3fc, 0.45); sfx.play('spell', at, 0.5); }
        else if (e.k === 'orb') sfx.play('bolt', at, 0.6);
        else if (e.k === 'opop') { fx.ring(e.x, e.z, 1.3, 0x5eead4, 0.35); fx.sparks(e.x, 1.2, e.z, 10, 0xa5f3fc, 0.2, 5); }
        else if (e.k === 'erupt') {
          const lm = mobs.get(e.id); if (lm) lm.hidden = false;
          fx.ring(e.x, e.z, e.r + 0.5, 0x8b6b3a, 0.6); fx.sparks(e.x, 0.4, e.z, 26, 0x7a5a32, 0.4, 10);
          sfx.play('boom', at, 0.9); if (near(e.x, e.z, 10)) ctx.shake(0.3);
        } else if (e.k === 'burrow') {
          const m = mobs.get(e.id); if (m) m.hidden = true; // untargetable until it erupts (the next snapshot drops it)
          if (state.lock === e.id) state.lock = 0;
          fx.ring(e.x, e.z, 1.8, 0x8b6b3a, 0.5); fx.sparks(e.x, 0.3, e.z, 14, 0x7a5a32, 0.3, 6); }
        else if (e.k === 'call') {
          fx.ring(e.x, e.z, e.r, 0xa78bfa, 1.0); fx.ring(e.x, e.z, e.r * 0.5, 0xe879f9, 0.7);
          const m = mobs.get(e.id); if (m) ctx.floatNum(m.model.group.position, m.model.height + 0.6, e.n ? `CALL OF THE MIRE ×${e.n}` : 'CALL OF THE MIRE', 'crit');
          sfx.play('howl', at, 1.1);
        } else if (e.k === 'geyser') {
          fx.ring(e.x, e.z, e.r, 0x5eead4, 0.5); geyser(e.x, e.z, e.r);
          sfx.play('boom', at, 1.1); if (near(e.x, e.z, e.r + 3)) ctx.shake(0.3);
        } else if (e.k === 'dcall') delugeCall(e);
        else if (e.k === 'rise') { fx.ring(e.x, e.z, 2.6, 0x2dd4bf, 0.7); fx.sparks(e.x, 0.5, e.z, 16, 0x5eead4, 0.3, 6); sfx.play('howl', at, 0.6); }
        break;
      }
      case 'blocked': { // a Shieldback's front shell soaked the hit
        const m = mobs.get(e.id);
        if (!m || (e.to ?? e.by) !== myId) break; // your hit was blocked: only you see it
        const now = performance.now();
        if (now - (lastBlock.get(e.id) || 0) < 300) break;
        lastBlock.set(e.id, now);
        ctx.floatNum(m.model.group.position, m.model.height + 0.3, 'BLOCKED', 'evade');
        sfx.play('shield', m.model.group.position, 0.5);
        if (e.by === myId && !state.f2ShellTip) { state.f2ShellTip = 1; ctx.log("The Shieldback's front shell blocks most damage: hit it from the side or behind, or Break it.", 'sys'); }
        break;
      }
      case 'f2wave': wave(e); break;
      case 'f2phase': {
        const b = mobs.get(e.id);
        if (e.n === 1) b?.model.anim?.shot('Spellcast_Long', 1.2 / PACE); // (phase 3: the Deluge call has its own pose, 'dcall')
        sfx.play('roar', b?.model.group.position || null, 1.3);
        if (e.n === 1) ctx.banner('THE TIDE RISES', 'Phase 2: Tidal Waves (roll THROUGH them), Drowned Thralls, mire pools');
        else ctx.banner('THE DELUGE', 'Phase 3: the outer court floods. Stay near the centre and dodge the orbs');
        break;
      }
      case 'la2': fx.beam(e.x, e.z, 0xfbbf24, 4.5); sfx.play('loot', { x: e.x, z: e.z }, 1.3); setTimeout(() => ctx.banner('LAST ATTACK BONUS', `${e.name} · Sovereign's Tidecloak`), 3400); break;
      case 'clear2':
        sfx.play('clear'); ctx.banner('FLOOR 2 CLEARED', e.names.join(' · '));
        if (ctx.hallOpen()) setTimeout(() => ctx.send({ type: 'hall' }), 400);
        break;
      case 'gate2':
        if (e.s === 'count' && inGateZone2(state.x, state.z)) for (let i = 0; i < e.d; i++) setTimeout(() => sfx.play('tick'), i * 1000);
        if (e.s === 'open') { sfx.play('gate', { x: GATE2.x, z: GATE2.z }, 1.5); if (Math.abs(state.x - GATE2.x) < 30 && state.z > 120) ctx.banner('THE SUNKEN GATE OPENS', 'The Drowned Sovereign awaits'); }
        break;
      case 'stair':
        fx.rareBeam(e.x, e.z, 5); sfx.play('rare', { x: e.x, z: e.z }, 1);
        if (!onFloor2(state.x) && state.z > 120) setTimeout(() => ctx.banner('THE STAIRWAY APPEARS', `Step into it and press ${ctx.isTouch ? 'Warp' : 'F'} to climb to Floor 2 (${e.d} s)`), 6500);
        break;
      case 'warp': {
        fx.beam(e.x0, e.z0, 0x5eead4, 1.6); fx.beam(e.x, e.z, 0x5eead4, 2.2); fx.ring(e.x, e.z, 3, 0x99f6e4, 0.8);
        sfx.play('spell', { x: e.x, z: e.z }, 1);
        if (e.id === myId) { panel.classList.add('hidden'); ctx.banner(e.f === 2 ? 'FLOOR 2 · THE GLIMMERING MIRE' : 'FLOOR 1 · TOWN OF BEGINNINGS', e.f === 2 ? 'Mirelight Camp: a safe zone. The Sovereign waits beyond the Sunken Gate' : ''); }
        break;
      }
    }
  }

  // A water column bursting from a geyser circle.
  function geyser(x, z, r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.8, 1, 14, 1, true), fade(0x99f6e4, 0.6));
    m.position.set(x, 0, z);
    fx.add(m, 0.7, (mesh, k) => { const h = 6 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5); mesh.scale.y = Math.max(0.01, h); mesh.position.y = h / 2; mesh.material.opacity = 0.6 * (1 - k); });
    fx.sparks(x, 1, z, 22, 0xccfbf1, 0.3, 9);
  }

  // The Tidal Wave: a warning at the Sovereign (a ring that fills up toward the moment it breaks, while it crouches and
  // gathers the water: world.js WINDUPS 'wave'), then a wall of water sweeping out across the court.
  // e.n = 2: Riptide's second wall right behind the first (no second pose or callout).
  function wave(e) {
    const start = performance.now() / 1000 + e.d;
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true), fade(0x5eead4, 0.5));
    const foam = new THREE.Mesh(new THREE.RingGeometry(1 - e.w * 0.04, 1, 64), fade(0xe0fbff, 0.85)); foam.rotation.x = -Math.PI / 2;
    const warn = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 40), fade(0x67e8f9, 0.8)); warn.rotation.x = -Math.PI / 2; warn.position.y = 0.15;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), fade(0x22d3ee, 0.4)); fill.rotation.x = -Math.PI / 2; fill.position.y = 0.13; fill.scale.setScalar(0.01);
    g.add(wall, foam, warn, fill); g.position.set(e.x, 0, e.z); wall.visible = foam.visible = false;
    scene.add(g);
    waves.push({ g, wall, foam, warn, fill, start, e });
    if (e.n !== 2) mobs.get(e.by)?.model.anim?.windup?.('wave', e.d);
    sfx.play('warn', { x: e.x, z: e.z }, e.n === 2 ? 1 : 1.5);
    if (e.n === 2) { if (inArena2(state.x, state.z) && !state.spectator) ctx.callout('RIPTIDE', 'A second wave right behind: roll again', e.d + 0.4); }
    else if (inArena2(state.x, state.z) && !state.spectator) ctx.callout('TIDAL WAVE', `Roll (${ctx.isTouch ? 'Dodge' : 'Shift'}) THROUGH it as it reaches you`, e.d + 0.6);
    else if (state.spectator && near(e.x, e.z, 60)) ctx.callout('TIDAL WAVE', 'Roll through it as it reaches you', e.d + 0.6);
    setTimeout(() => { sfx.play('boom', { x: e.x, z: e.z }, 1.4); if (inArena2(state.x, state.z)) ctx.shake(0.35); }, e.d * 1000);
  }

  // The Deluge being called: the Sovereign raises its arms (WINDUPS 'deluge') while a flood line fills in from the court's
  // wall to the bright safe ring; when it lands, the outer court floods (world.update, f2.del).
  function delugeCall(e) {
    mobs.get(e.id)?.model.anim?.windup?.('deluge', e.d);
    const g = new THREE.Group(), w = e.r2 - e.r;
    const band = new THREE.Mesh(new THREE.RingGeometry(e.r, e.r2, 72, 1), fade(0x0e7490, 0.18));
    const front = new THREE.Mesh(new THREE.RingGeometry(e.r2 - 0.5, e.r2, 72, 1), fade(0x67e8f9, 0.85));
    const safe = new THREE.Mesh(new THREE.RingGeometry(e.r - 0.45, e.r, 72, 1), fade(0xccfbf1, 0.9));
    for (const m of [band, front, safe]) m.rotation.x = -Math.PI / 2;
    front.position.y = 0.02; safe.position.y = 0.03;
    g.add(band, front, safe); g.position.set(e.x, 0.1, e.z);
    fx.add(g, e.d, (mesh, k) => { // the water's edge moves in from the wall and meets the safe ring on impact
      const ez = k * k * (3 - 2 * k), r = e.r2 - w * ez, s = r / e.r2;
      front.scale.setScalar(s); band.material.opacity = 0.18 + 0.3 * ez;
      safe.material.opacity = 0.55 + 0.4 * Math.sin(k * (14 + 22 * k));
    });
    sfx.play('warn', { x: e.x, z: e.z }, 1.6);
    if (inArena2(state.x, state.z) && !state.spectator) ctx.callout('THE DELUGE', 'Get inside the bright ring before the water comes in', e.d + 0.4);
    setTimeout(() => { sfx.play('boom', { x: e.x, z: e.z }, 1.2); if (inArena2(state.x, state.z)) ctx.shake(0.3); }, e.d * 1000);
  }

  // ---------- interaction (F) ----------
  function interactKind() {
    if (state.dead || !state.joined || state.spectator) return null;
    if (nearWaystone(state.x, state.z)) return 'warp';
    if (data.stair && Math.hypot(state.x - data.stair[0], state.z - data.stair[1]) < STAIRWAY.use) return 'stair';
    return null;
  }
  function interact(k) {
    if (k === 'warp') { const open = panel.classList.contains('hidden'); panel.classList.toggle('hidden', !open); if (open) renderPanel(); sfx.play('ui'); return true; }
    if (k === 'stair') {
      if (!unlocked(2)) ctx.log('The Stairway is sealed to you: only those who fought the Warden may climb.', 'sys');
      else ctx.send({ type: 'warp', f: 2 });
      sfx.play('ui'); return true;
    }
    return false;
  }

  // ---------- per frame ----------
  let t = 0;
  function update(dt) {
    t += dt;
    const on2 = onFloor2(state.x);
    world.update(dt, on2, !!data.del, onFloor3(state.x));
    for (const o of orbs.values()) { const p = o.g.position; p.x += (o.x - p.x) * Math.min(1, dt * 14); p.z += (o.z - p.z) * Math.min(1, dt * 14); p.y = 1.2 + Math.sin(t * 8 + o.x) * 0.1; o.g.rotation.y += dt * 3; }
    for (const p of pools.values()) { p.t += dt; p.disc.material.opacity = p.armed ? 0.42 + Math.sin(p.t * 4) * 0.08 : 0.15 + 0.2 * Math.min(1, p.t); p.edge.material.color.setHex(p.armed ? 0xe879f9 : 0xc084fc); }
    for (const m of ripples) if (m.visible) { const k = (t * (m.userData.hot ? 3 : 1.2)) % 1; m.scale.setScalar(0.6 + k * (m.userData.hot ? 2.4 : 1.4)); m.material.opacity = 0.65 * (1 - k); }
    const now = performance.now() / 1000;
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], r = (now - w.start) * w.e.sp;
      if (r < 0) { // winding up: the warning ring pulses faster and fills toward the moment the wave breaks
        const k = Math.min(1, Math.max(0, 1 + (now - w.start) / w.e.d)), ez = k * k * (3 - 2 * k);
        w.warn.scale.setScalar(1 + Math.sin(now * (10 + 16 * k)) * 0.12); w.fill.scale.setScalar(Math.max(0.01, ez)); w.fill.material.opacity = 0.3 + 0.35 * k;
        const m = mobs.get(w.e.by); if (m && w.e.n !== 2) w.g.position.set(m.x, 0, m.z); continue;
      }
      w.warn.visible = w.fill.visible = false; w.wall.visible = w.foam.visible = true;
      w.wall.scale.set(r, 1.7, r); w.wall.position.y = 0.85; w.foam.scale.setScalar(Math.max(0.01, r + w.e.w)); w.foam.position.y = 0.12;
      w.wall.material.opacity = 0.5 * (1 - r / w.e.max);
      if (r > w.e.max) { scene.remove(w.g); w.g.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); }); waves.splice(i, 1); }
    }
    for (const m of mobs.values()) { // wisps bob; burrowing lurkers sink in
      const inner = m.model.inner;
      if (inner) { inner.position.y = 1.7 + Math.sin(t * 2.2 + m.id) * 0.25; if (inner.userData.motes) inner.userData.motes.rotation.y += dt * 2.5; }
    }
    if (!state.spectator) {
      WAYSTONES.forEach((w, i) => place(wsLabels[i], w.x, 5.2, w.z, `Waystone${Math.hypot(state.x - w.x, state.z - w.z) < 3.2 ? `<br><small>${ctx.isTouch ? 'tap Warp' : 'press F to travel'}</small>` : ''}`, 24));
      if (data.stair) place(stairLabel, data.stair[0], 6.2, data.stair[1], `The Stairway · Floor 2 <small>${Math.ceil(data.stair[2])} s</small>${Math.hypot(state.x - data.stair[0], state.z - data.stair[1]) < STAIRWAY.use ? `<br><small>${ctx.isTouch ? 'tap Warp' : 'press F to climb'}</small>` : ''}`, 40);
      else stairLabel.style.display = 'none';
      if (!panel.classList.contains('hidden') && !nearWaystone(state.x, state.z)) panel.classList.add('hidden');
    }
  }

  const phaseText = () => PHASE_TEXT2[data.ph] || '';
  const gateText = () => (onFloor2(state.x) ? 'The Drowned Sovereign' : 'The Horned Warden');
  return { world, snap, onEvent, update, interactKind, interact, phaseText, gateText };
}
