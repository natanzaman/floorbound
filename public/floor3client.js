// Floor 3 — The Gale Spires: client runtime. Snapshot state (the Storm Gate, harpies aloft, Wind Wards, cracked
// sentinels, the Overload bar, Grounded / Charged, the Stairway up from the Sunken Court), Floor 3 events and effects
// (charges, dives, lightning, Gale Push, Overload, Thunderclap, the Tempest Beam), callouts and banners, and the
// Colossus's wind-up poses. main.js wires it in with a few calls. Design: docs/floor3.md.
import * as THREE from 'three';
import { F3, GATE3, STAIRWAY3, PHASE_TEXT3, F3_TWISTS, inArena3, inGateZone3, onFloor3, unlocked3 } from '/shared/floor3.js';
import { createFloor3, makeBolt } from '/floor3world.js';

// ctx: { scene, occluders, fx, sfx, state, mobs, players, send, banner, callout, floatNum, log, shake, project, isTouch, hallOpen }
export function initFloor3Client(ctx) {
  const { scene, fx, sfx, state, mobs } = ctx;
  const world = createFloor3(scene, { occluders: ctx.occluders });
  const data = { ph: 0, gate: [0, 0, 0, 0], ov: 0, gr: 0, ch: 0, air: [], ward: [], crk: [], chan: [], down: [], stair: 0, tw: null };
  const air = new Set(), wards = new Map(), beams = [];
  const fade = (c, o, add = false) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, ...(add ? { blending: THREE.AdditiveBlending } : {}) });
  const near = (x, z, d) => Math.hypot(x - state.x, z - state.z) < d;
  const on3 = () => onFloor3(state.x);
  const fighting = () => inArena3(state.x, state.z) && !state.spectator;
  const anim = id => mobs.get(id)?.model.anim;
  const dodgeKey = () => (ctx.isTouch ? 'Dodge' : 'Shift'), jumpKey = () => (ctx.isTouch ? 'Jump' : 'Space');

  // ---------- the Overload bar (under the boss bar) ----------
  const ovEl = document.createElement('div');
  ovEl.style.cssText = 'display:none;margin:6px auto 0;width:70%;font:800 12px/1.2 system-ui,sans-serif;letter-spacing:.14em;color:#fde047;text-shadow:0 0 8px #1d4ed8,0 2px 3px #000';
  ovEl.innerHTML = '<div class="ovt">OVERLOAD</div><div style="height:8px;margin-top:3px;border:1px solid rgba(253,224,71,.6);background:rgba(15,23,42,.6)"><div class="ovf" style="height:100%;width:0;background:linear-gradient(90deg,#60a5fa,#fde047)"></div></div>';
  document.getElementById('boss')?.appendChild(ovEl);
  const ovFill = ovEl.querySelector('.ovf'), ovText = ovEl.querySelector('.ovt');

  // ---------- label for the Stairway ----------
  const stairLabel = document.createElement('div'); stairLabel.className = 'lbl npc'; stairLabel.style.display = 'none';
  document.getElementById('labels').appendChild(stairLabel);
  function place(el, x, y, z, html, maxD) {
    const p = ctx.project(x, y, z), d = Math.hypot(state.x - x, state.z - z);
    if (!p || d > maxD || !state.joined) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = `${p[0]}px`; el.style.top = `${p[1]}px`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // ---------- per-snapshot state ----------
  function snap(f3) {
    Object.assign(data, f3);
    if (on3()) { state.gate = f3.gate; state.gateOpen = !!f3.gate[0]; }
    world.gate3.set(!!f3.gate[0]);
    world.stairway.set(f3.stair || null);
    air.clear(); for (const id of f3.air) air.add(id);
    const seen = new Set();
    for (const id of f3.ward) { // Wind Wards: a swirling shell on each warded enemy
      seen.add(id);
      const m = mobs.get(id);
      if (!m || wards.has(id)) continue;
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), fade(0xbae6fd, 0.22, true));
      const r = (m.def?.radius || 1) + 0.6; s.scale.set(r, r * 1.2, r); s.position.y = m.model.height * 0.5;
      m.model.group.add(s); wards.set(id, s);
    }
    for (const [id, s] of wards) if (!seen.has(id)) { s.parent?.remove(s); s.geometry.dispose(); s.material.dispose(); wards.delete(id); }
    for (const m of mobs.values()) { // sentinels' armour: cracked (glowing seams) after a Break
      const c = m.model.body?.userData?.cracks;
      if (c) c.visible = f3.crk.includes(m.id);
    }
  }

  // ---------- events ----------
  // Returns true when the event is fully handled here (main.js skips its own handling).
  function onEvent(e) {
    const myId = state.myId;
    switch (e.t) {
      case 'tele': { // Floor 3 telegraphs that aren't plain lanes: the Colossus's lightning, acolyte bolts, sentinel stomps
        if (!['strike', 'bolt', 'stomp'].includes(e.k)) return false;
        fx.telegraph(e.x, e.z, e.r, e.d, e.follow ? () => mobs.get(e.follow)?.model.group.position : null);
        const mine = near(e.x, e.z, e.r + 1.5);
        sfx.play('warn', { x: e.x, z: e.z }, e.k === 'strike' ? 0.7 : 1);
        if (e.k === 'stomp') { const m = mobs.get(e.id); if (m && !m.model.anim) m.stomp = e.d; if (mine && !state.f3StompTip) { state.f3StompTip = 1; ctx.log('Spire Sentinel stomp: jump it or roll out of the circle.', 'sys'); } }
        if (e.k === 'strike' && mine && fighting()) ctx.callout('LIGHTNING', 'Step out of the circle', e.d);
        return true;
      }
      case 'f3fx': fxEvent(e); return true;
      case 'f3ov': overload(e); return true;
      case 'f3beam': beam(e); return true;
      case 'f3phase': {
        const b = mobs.get(e.id);
        b?.model.anim?.shot('2H_Melee_Attack_Spin', 0.8);
        sfx.play('roar', b?.model.group.position || null, 1.3); ctx.shake(0.3);
        if (e.n === 1) ctx.banner('THE STORM WAKES', 'Phase 2: OVERLOAD (Break it, then Switch, or Team Burst) and Gale Harpies');
        else ctx.banner('THE TEMPEST', `Phase 3: the Tempest Beam sweeps the plateau. JUMP (${jumpKey()}) as it reaches you`);
        return true;
      }
      case 'la3': fx.beam(e.x, e.z, 0xfbbf24, 4.5); sfx.play('loot', { x: e.x, z: e.z }, 1.3); setTimeout(() => ctx.banner('LAST ATTACK BONUS', `${e.name} · Stormheart`), 3400); return true;
      case 'clear3':
        sfx.play('clear'); ctx.banner('FLOOR 3 CLEARED', e.names.join(' · '));
        if (ctx.hallOpen()) setTimeout(() => ctx.send({ type: 'hall' }), 400);
        return false; // main.js marks the guide's boss step
      case 'gate3':
        if (e.s === 'count' && inGateZone3(state.x, state.z)) for (let i = 0; i < e.d; i++) setTimeout(() => sfx.play('tick'), i * 1000);
        if (e.s === 'open') {
          sfx.play('gate', { x: GATE3.x, z: GATE3.z }, 1.5);
          if (Math.abs(state.x - GATE3.x) < 30 && state.z > 120) { const tw = F3_TWISTS[data.tw]; ctx.banner('THE STORM GATE OPENS', tw && data.tw !== 'calm' ? `The Storm Colossus awaits · ${tw.name}: ${tw.short}` : 'The Storm Colossus awaits'); }
        }
        return true;
      case 'stair':
        if (e.f !== 3) return false;
        fx.rareBeam(e.x, e.z, 5); sfx.play('rare', { x: e.x, z: e.z }, 1);
        if (!on3() && state.z > 120 && Math.abs(state.x - e.x) < 60) setTimeout(() => !on3() && ctx.banner('THE STAIRWAY APPEARS', `Step into it and press ${ctx.isTouch ? 'Warp' : 'F'} to climb to Floor 3 (${e.d} s)`), 6500);
        return true;
      case 'warp':
        if (e.f !== 3) return false;
        fx.beam(e.x0, e.z0, 0xfcd34d, 1.6); fx.beam(e.x, e.z, 0xfcd34d, 2.2); fx.ring(e.x, e.z, 3, 0xfde68a, 0.8);
        sfx.play('spell', { x: e.x, z: e.z }, 1);
        if (e.id === myId) { document.getElementById('warp')?.classList.add('hidden'); ctx.banner('FLOOR 3 · THE GALE SPIRES', 'Windbreak Camp: a safe zone. The Storm Colossus waits beyond the Storm Gate'); }
        return true;
    }
    return false;
  }

  function fxEvent(e) {
    const at = { x: e.x, z: e.z }, m = mobs.get(e.id), mine = (e.to ?? e.by) === state.myId;
    switch (e.k) {
      case 'shove': if (e.id === state.myId) ctx.shake(0.25); fx.ring(e.x, e.z, 1.4, 0xfef3c7, 0.35); break;
      case 'aloft': if (mine && m) { tag(m, 'ALOFT', 300); if (!state.f3AirTip) { state.f3AirTip = 1; ctx.log('Harpies aloft take little from melee: hit them from range, or when they land after a dive.', 'sys'); } } break;
      case 'armor': if (mine && m) { tag(m, 'ARMOURED', 400); if (!state.f3ArmorTip) { state.f3ArmorTip = 1; ctx.log("The Sentinel's armour soaks most damage: BREAK it (posture) to crack its shell.", 'sys'); } } break;
      case 'warded': if (mine && m) tag(m, 'WARDED', 400); break;
      case 'wardbreak': fx.shatter(e.x, e.z, false); sfx.play('shield', at, 0.7); break;
      case 'charge': sfx.play('swingHeavy', at, 1); fx.sparks(e.x, 0.3, e.z, 10, 0xd6c9ae, 0.3, 6); break;
      case 'braced': fx.ring(e.x, e.z, 2.2, 0x60a5fa, 0.5); sfx.play('shield', at, 1.2); if (m) ctx.floatNum(m.model.group.position, m.model.height + 0.4, 'STOPPED!', 'crit'); break;
      case 'dive': sfx.play('swing', at, 1); break;
      case 'land': fx.ring(e.x, e.z, 1.8, 0xfef3c7, 0.4); fx.sparks(e.x, 0.3, e.z, 8, 0xe7c79a, 0.25, 5); if (m) ctx.floatNum(m.model.group.position, 1.6, 'GROUNDED', 'evade'); break;
      case 'lift': break;
      case 'chan': // an acolyte's Wind Ward channel: interrupt it
        fx.telegraph(e.x, e.z, e.r, e.d, () => mobs.get(e.id)?.model.group.position);
        sfx.play('spell', at, 0.8);
        if (m) ctx.floatNum(m.model.group.position, m.model.height + 0.4, 'WIND WARD', 'crit');
        if (near(e.x, e.z, 22) && !state.f3WardTip) { state.f3WardTip = 1; ctx.log('Storm Acolyte channelling a Wind Ward: interrupt it (a stun, a Break, Smite, or 3 quick hits).', 'sys'); }
        break;
      case 'interrupt': fx.ring(e.x, e.z, 1.6, 0xfde047, 0.4); if (m) ctx.floatNum(m.model.group.position, m.model.height + 0.4, 'INTERRUPTED', 'switch'); sfx.play('shield', at, 0.6); break;
      case 'ward': fx.ring(e.x, e.z, e.r, 0xbae6fd, 0.8); fx.ring(e.x, e.z, e.r * 0.6, 0xe0f2fe, 0.6); sfx.play('spell', at, 1.1); break;
      case 'crack': fx.shatter(e.x, e.z, true); sfx.play('switch', at, 1); if (m) ctx.floatNum(m.model.group.position, m.model.height + 0.5, 'ARMOUR CRACKED', 'crit'); break;
      case 'stomp': fx.ring(e.x, e.z, e.r, 0xd6c9ae, 0.5); fx.sparks(e.x, 0.3, e.z, 16, 0xa8a29e, 0.3, 8); sfx.play('boom', at, 0.9); if (near(e.x, e.z, e.r + 3)) ctx.shake(0.25); break;
      case 'call': fx.ring(e.x, e.z, 2.5, 0xfbbf24, 0.7); sfx.play('howl', at, 0.9); break;
      case 'bolt': case 'strike': strike(e.x, e.z, e.r, e.k === 'strike'); break;
      case 'raise': anim(e.id)?.windup?.('strike', Math.max(0.5, e.d * 0.6)); break;
      case 'swoop': fx.ring(e.x, e.z, 2.4, 0xe7c79a, 0.5); sfx.play('howl', at, 0.6); break;
      case 'gust': { // Gale Push wind-up: the sword drawn back, a cone of wind gathering in front
        anim(e.id)?.windup?.('gust', e.d);
        fx.wedge(e.x, e.z, e.f, e.r, e.h, e.d, 0x7dd3fc);
        sfx.play('warn', at, 1.3);
        if (fighting()) ctx.callout('GALE PUSH', `Get behind or beside it, or roll (${dodgeKey()}) through`, e.d);
        break;
      }
      case 'gusthit': {
        for (let i = 0; i < 18; i++) { const a = e.f + (Math.random() * 2 - 1) * e.h, d = 2 + Math.random() * e.r; fx.line(e.x + Math.sin(a) * 2, e.z + Math.cos(a) * 2, e.x + Math.sin(a) * d, e.z + Math.cos(a) * d, 0xf8fafc, 0.12, 0.35, 0.8 + Math.random() * 2); }
        sfx.play('swingHeavy', at, 1.4); if (fighting()) ctx.shake(0.3);
        break;
      }
      case 'reset': ovEl.style.display = 'none'; anim(e.id)?.cancelWindup?.(); break;
    }
  }

  function tag(m, text, ms) {
    const now = performance.now();
    if (now - (m.f3Tag || 0) < ms) return;
    m.f3Tag = now; ctx.floatNum(m.model.group.position, m.model.height + 0.3, text, 'evade');
  }

  // A lightning strike: a bolt from the sky onto the circle.
  function strike(x, z, r, big) {
    const b = makeBolt(Math.random, big ? 30 : 16);
    b.position.set(x, 0, z); b.scale.setScalar(big ? 1 : 0.6);
    fx.add(b, 0.22, (mesh, k) => { mesh.traverse(o => { if (o.material) o.material.opacity = (o.material.transparent ? 0.35 : 1) * (1 - k); }); });
    fx.ring(x, z, r, 0xbfdbfe, 0.4); fx.sparks(x, 0.3, z, 12, 0xdbeafe, 0.22, 8);
    sfx.play('boom', { x, z }, big ? 1 : 0.6);
    if (near(x, z, r + 2)) ctx.shake(0.2);
  }

  // Overload: the Colossus kneels, sword raised, a bar fills; stop it or Thunderclap.
  function overload(e) {
    const m = mobs.get(e.id), A = F3.arena;
    if (e.s === 'start') {
      m?.model.anim?.windup?.('overload', 0.9);
      sfx.play('roar', m?.model.group.position || null, 1.4);
      fx.ring(A.x, A.z, A.r - 1, 0xfde047, 0.8);
      if (fighting() || (state.spectator && near(A.x, A.z, 60))) ctx.callout('OVERLOAD', e.solo ? 'BREAK it before the bar fills' : 'BREAK it, then SWITCH (or Team Burst) before the bar fills', Math.min(4, e.d));
      if (fighting() && !state.f3OvTip) { state.f3OvTip = 1; ctx.log('OVERLOAD: its guard is open (posture half full). Break it, then a DIFFERENT player hits it (a Switch), or fire a Team Burst. Fail = Thunderclap on everyone.', 'sys'); }
    } else if (e.s === 'stop') {
      m?.model.anim?.cancelWindup?.();
      m?.model.anim?.shot('Hit_B', 0.6);
      fx.shatter(m?.x ?? A.x, m?.z ?? A.z, true); fx.beam(m?.x ?? A.x, m?.z ?? A.z, 0xfde047, 1.5);
      sfx.play('switch', m?.model.group.position || null, 1.4); ctx.shake(0.4);
      ctx.banner('GROUNDED', `${e.by === 'burst' ? 'Team Burst!' : e.by === 'switch' ? 'Break and Switch!' : 'Broken!'} The Colossus is down: hit it hard`);
    } else if (e.s === 'clap') {
      m?.model.anim?.windup?.('clap', 0.25);
      fx.ring(A.x, A.z, A.r, 0xfde047, 0.7); fx.ring(A.x, A.z, A.r * 0.6, 0xffffff, 0.5);
      for (let i = 0; i < 6; i++) setTimeout(() => { const a = Math.random() * 6.28, d = Math.random() * A.r; strike(A.x + Math.sin(a) * d, A.z + Math.cos(a) * d, 2.5, true); }, i * 60);
      if (inArena3(state.x, state.z)) { ctx.shake(0.7); ctx.banner('THUNDERCLAP', 'The Colossus is Charged: it hits harder for a while'); }
    }
  }

  // The Tempest Beam: the sword planted, a beam of lightning sweeps a full turn round the Colossus. Jump it.
  function beam(e) {
    anim(e.by)?.windup?.('beam', 0.8);
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(e.w * 0.6, 0.5, e.len), fade(0xffffff, 0.95));
    const halo = new THREE.Mesh(new THREE.BoxGeometry(e.w * 2.2, 1.4, e.len), fade(0x60a5fa, 0.4, true));
    for (const b of [core, halo]) { b.position.set(0, 0.6, e.len / 2); g.add(b); }
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(e.w * 2, e.len), fade(0x60a5fa, 0.35)); warn.rotation.x = -Math.PI / 2; warn.position.set(0, 0.06, e.len / 2); g.add(warn);
    const rim = new THREE.Mesh(new THREE.RingGeometry(e.len - 0.3, e.len, 72), fade(0x93c5fd, 0.5)); rim.rotation.x = -Math.PI / 2; rim.position.y = 0.05;
    g.position.set(e.x, 0, e.z); g.rotation.y = e.a0; core.visible = halo.visible = false;
    rim.position.set(e.x, 0.05, e.z);
    scene.add(g); scene.add(rim);
    const start = performance.now() / 1000 + e.d;
    beams.push({ g, rim, core, halo, warn, start, e });
    sfx.play('warn', { x: e.x, z: e.z }, 1.5);
    if (fighting() || (state.spectator && near(e.x, e.z, 60))) ctx.callout('TEMPEST BEAM', `JUMP (${jumpKey()}) as the beam reaches you, or roll through it`, e.d + 1.2);
  }

  // ---------- interaction (F) ----------
  function interactKind() {
    if (state.dead || !state.joined || state.spectator) return null;
    if (data.stair && Math.hypot(state.x - data.stair[0], state.z - data.stair[1]) < STAIRWAY3.use) return 'stair3';
    return null;
  }
  function interact(k) {
    if (k !== 'stair3') return false;
    if (!unlocked3(state.inv?.life)) ctx.log('The Stairway is sealed to you: only those who fought the Sovereign may climb.', 'sys');
    else ctx.send({ type: 'warp', f: 3 });
    sfx.play('ui'); return true;
  }

  // ---------- per frame ----------
  let t = 0;
  function update(dt) {
    t += dt;
    const here = on3();
    world.update(dt, here, data.ov ? 1 : data.ph >= 1 ? 0.6 : 0);
    if (here) {
      for (const m of mobs.values()) { // harpies hover while aloft, sit on the ground while grounded; acolyte sigils spin
        const fly = m.model.fly, mb = m.model.baseHeight;
        if (fly) {
          const up = air.has(m.id), want = up ? 3.4 + Math.sin(t * 2 + m.id) * 0.35 : 0.9;
          fly.position.y += (want - fly.position.y) * Math.min(1, dt * 6);
          const w = fly.userData.wings; if (w) { const flap = Math.sin(t * (up ? 9 : 3) + m.id) * (up ? 0.6 : 0.15); w[0].rotation.z = flap; w[1].rotation.z = -flap; }
          m.model.height = mb + fly.position.y - 1.2;
        }
        const sg = m.model.body?.userData?.sigil; if (sg) { sg.rotation.y += dt * 2; sg.rotation.x = Math.sin(t) * 0.3; }
      }
    }
    // the Overload bar
    if (data.ov) {
      const [left, total, broke] = data.ov;
      ovEl.style.display = ''; ovFill.style.width = `${Math.min(100, (1 - left / total) * 100)}%`;
      ovText.textContent = broke ? 'OVERLOAD · BROKEN: SWITCH NOW!' : 'OVERLOAD · BREAK IT!';
      ovText.style.color = broke ? '#4ade80' : '#fde047';
    } else if (data.gr) { ovEl.style.display = ''; ovFill.style.width = '0'; ovText.textContent = `GROUNDED · +30% DAMAGE · ${Math.ceil(data.gr)} s`; ovText.style.color = '#4ade80'; }
    else if (data.ch) { ovEl.style.display = ''; ovFill.style.width = '0'; ovText.textContent = `CHARGED · IT HITS HARDER · ${Math.ceil(data.ch)} s`; ovText.style.color = '#f87171'; }
    else ovEl.style.display = 'none';
    // Tempest Beams
    const now = performance.now() / 1000;
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i], k = (now - b.start) / b.e.turn;
      if (k < 0) { b.warn.material.opacity = 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(now * 16)); const m = mobs.get(b.e.by); if (m) b.g.position.set(m.x, 0, m.z); continue; }
      b.core.visible = b.halo.visible = true; b.warn.visible = false;
      b.g.rotation.y = b.e.a0 + b.e.dir * Math.PI * 2 * Math.min(1, k);
      b.halo.material.opacity = 0.3 + Math.random() * 0.2; b.core.scale.x = 0.8 + Math.random() * 0.5;
      if (Math.random() < 0.3) fx.sparks(b.g.position.x + Math.sin(b.g.rotation.y) * b.e.len * Math.random(), 0.6, b.g.position.z + Math.cos(b.g.rotation.y) * b.e.len * Math.random(), 2, 0xdbeafe, 0.18, 4);
      if (k >= 1) { const an = anim(b.e.by); if (an?.wind?.W?.up === 'plant') an.cancelWindup(); for (const o of [b.g, b.rim]) { scene.remove(o); o.traverse(x => { x.geometry?.dispose(); x.material?.dispose(); }); } beams.splice(i, 1); }
    }
    if (!state.spectator) {
      if (data.stair) place(stairLabel, data.stair[0], 6.2, data.stair[1], `The Stairway · Floor 3 <small>${Math.ceil(data.stair[2])} s</small>${Math.hypot(state.x - data.stair[0], state.z - data.stair[1]) < STAIRWAY3.use ? `<br><small>${ctx.isTouch ? 'tap Warp' : 'press F to climb'}</small>` : ''}`, 40);
      else stairLabel.style.display = 'none';
    }
  }

  const phaseText = () => {
    const tw = F3_TWISTS[data.tw];
    return (PHASE_TEXT3[data.ph] || '') + (tw && data.tw !== 'calm' ? ` · ${tw.name.toUpperCase()}` : '');
  };
  const gateText = () => {
    const tw = F3_TWISTS[data.tw];
    return `The Storm Colossus${tw && data.tw !== 'calm' ? ` · ${tw.name}: ${tw.short}` : ''}`;
  };
  return { world, snap, onEvent, update, interactKind, interact, phaseText, gateText };
}
