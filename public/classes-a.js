// Client side of the Ranger and Berserker (server: server/classes-a.js, data: shared/classes/).
// main.js calls initClassesA() once and routes events here (fx k:'ca', arrows, marks, Rage, Bloodrage auras);
// world.js calls attachClassA() to put the Ranger's bow in its hand.
import * as THREE from 'three';
import { RANGER_TUNE as RT } from '/shared/classes/ranger.js';

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- models ----------
// A low-poly recurve bow (no bow in the KayKit pack): two curved limbs, a grip and a string, held in the left hand.
function makeBow() {
  const wood = new THREE.MeshStandardMaterial({ color: 0x7c4a1e, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b2412, roughness: 0.8 });
  const g = new THREE.Group();
  const limb = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 6, 18, Math.PI * 0.62), wood);
  limb.rotation.z = Math.PI - Math.PI * 0.31; // the arc opens toward +X (the archer), centred on the grip
  limb.position.x = 0.5;
  g.add(limb);
  for (const s of [-1, 1]) { // recurved tips
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 5), dark);
    const a = Math.PI + s * Math.PI * 0.31;
    tip.position.set(0.5 + Math.cos(a) * 0.62, Math.sin(a) * 0.62 * -1, 0);
    tip.rotation.z = a - Math.PI / 2 + (s > 0 ? 0.5 : -0.5);
    g.add(tip);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), dark);
  grip.position.x = -0.12; g.add(grip);
  const span = 2 * 0.62 * Math.sin(Math.PI * 0.31);
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, span, 3), new THREE.MeshStandardMaterial({ color: 0xe7e5e4, roughness: 0.5 })); // Standard: main.js flashes every rig material's emissive
  str.position.x = 0.5 + Math.cos(Math.PI - Math.PI * 0.31) * 0.62; g.add(str);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function attachClassA(kind, root) {
  if (kind !== 'bow') return;
  const slot = root.getObjectByName('handslotl');
  if (!slot) return;
  const bow = makeBow();
  bow.rotation.set(0, Math.PI / 2, 0);
  bow.scale.setScalar(1.15);
  slot.add(bow);
}

function arrowMesh(kind) {
  if (kind === 'xbolt' || kind === 'xheavy') return boltMesh(kind === 'xheavy');
  const big = kind === 'pierce' || kind === 'sniper', heavy = kind === 'heavy';
  const g = new THREE.Group();
  const s = big ? 1.6 : heavy ? 1.2 : 1;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 0.9 * s, 4), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
  shaft.rotation.x = Math.PI / 2; g.add(shaft);
  const headCol = big ? 0x5eead4 : 0xd1d5db;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.06 * s, 0.18 * s, 4), new THREE.MeshStandardMaterial({ color: headCol, emissive: big ? 0x14b8a6 : 0x000000, emissiveIntensity: big ? 1.2 : 0, metalness: 0.5 }));
  head.rotation.x = Math.PI / 2; head.position.z = 0.5 * s; g.add(head);
  for (const r of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.1 * s, 0.2 * s), new THREE.MeshBasicMaterial({ color: big ? 0x99f6e4 : 0xf8fafc, side: THREE.DoubleSide }));
    f.rotation.set(Math.PI / 2, r, 0); f.position.z = -0.38 * s;
    const h = new THREE.Group(); h.rotation.z = r; h.add(f); g.add(h);
  }
  if (big) { // a glowing trail
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.07, 2.2, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    tr.rotation.x = -Math.PI / 2; tr.position.z = -1.4; g.add(tr);
  }
  return g;
}

// Crossbow bolt (weapon style): short, thick, iron-headed, with stubby vanes and an amber glint.
function boltMesh(heavy) {
  const g = new THREE.Group(), s = heavy ? 1.3 : 1;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.55 * s, 5), new THREE.MeshStandardMaterial({ color: 0x4b3621 }));
  shaft.rotation.x = Math.PI / 2; g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.08 * s, 0.16 * s, 4), new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.7, emissive: 0xf59e0b, emissiveIntensity: heavy ? 0.6 : 0.25 }));
  head.rotation.x = Math.PI / 2; head.position.z = 0.33 * s; g.add(head);
  for (const r of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.12 * s, 0.1 * s), new THREE.MeshBasicMaterial({ color: 0x92400e, side: THREE.DoubleSide }));
    f.rotation.set(Math.PI / 2, r, 0); f.position.z = -0.24 * s;
    const h = new THREE.Group(); h.rotation.z = r; h.add(f); g.add(h);
  }
  return g;
}

// ---------- animation per skill (clips from knight.glb, plus the Ranger's extra ranged clips) ----------
const ANIM = {
  shot: [['2H_Ranged_Shoot', 2.4], ['2H_Ranged_Shoot', 2.6], ['1H_Ranged_Shoot', 2]],
  draw: [['2H_Ranged_Aiming', 1.2]], loose: [['2H_Ranged_Shoot', 2.2]],
  rain: [['2H_Ranged_Shoot', 1.6]], mark: [['Throw', 1.8]],
  disengage: [['Dodge_Backward', 1.7]], snare: [['Dodge_Backward', 1.9]], tumble: [['Dodge_Backward', 1.4]],
  chop: [['2H_Melee_Attack_Slice', 1.6], ['1H_Melee_Attack_Slice_Horizontal', 1.5], ['2H_Melee_Attack_Chop', 1.25]],
  cleave: [['2H_Melee_Attack_Spin', 1.6]], whirl: [['2H_Melee_Attack_Spinning', 1.6]], execute: [['2H_Melee_Attack_Chop', 1.3]],
  leap: [['Jump_Full_Long', 2.2]], slam: [['2H_Melee_Attack_Chop', 2.2]], pounce: [['2H_Melee_Attack_Chop', 1.8]],
  roar: [['Cheer', 1.6]], warblood: [['Cheer', 1.6]],
  // weapon styles (shared/styles.js)
  crossbow: [['1H_Ranged_Shoot', 1.5], ['1H_Ranged_Shoot', 1.5], ['2H_Ranged_Shoot', 1.3]],
  twinaxes: [['1H_Melee_Attack_Slice_Diagonal', 2.4], ['1H_Melee_Attack_Slice_Horizontal', 2.4], ['2H_Melee_Attack_Spin', 2.0]],
  warhammer: [['2H_Melee_Attack_Chop', 1.1], ['2H_Melee_Attack_Slice', 1.05], ['2H_Melee_Attack_Chop', 0.95]],
};

const CSS = `
.bar.rage { height: 5px; margin-top: 3px; background: rgba(0,0,0,.45); }
.bar.rage > div { height: 100%; width: 0; background: linear-gradient(90deg, #991b1b, #ef4444); transition: width .15s; }
.bar.rage.full > div { background: linear-gradient(90deg, #dc2626, #fca5a5); box-shadow: 0 0 6px #ef4444; }
.bar.rage.on > div { animation: ca-pulse .4s ease-in-out infinite alternate; }
#party .bar.rage { height: 3px; margin-top: 2px; }
.lbl .rgbar { width: 64px; height: 3px; margin: 1px auto 0; border-radius: 2px; background: rgba(0,0,0,.45); overflow: hidden; }
.lbl .rgbar > div { height: 100%; width: 0; background: #ef4444; }
@keyframes ca-pulse { from { filter: brightness(1); } to { filter: brightness(1.6); } }
.num.rage { color: #fca5a5; font-size: 16px; letter-spacing: .05em; }
`;

export function initClassesA(ctx) {
  const { scene, state, players, mobs, fx, sfx, floatNum, shake, log, $ } = ctx;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const rage = new Map();   // player id -> [rage 0-100, raging]
  const arrows = new Map(); // arrow id -> { g, x, z, a, sp, range, trav, tg }
  const marks = new Map();  // mob id -> { g, until }
  const auras = new Map();  // player id -> { g, until }
  const traps = [];         // snare visuals, ended when sprung
  let tipped = false;

  // ---------- extra sounds (same building blocks as audio.js) ----------
  const basePlay = sfx.play.bind(sfx);
  const EXTRA = {
    bow: o => { sfx.noise(o, { dur: 0.12, vol: 0.32, type: 'bandpass', f: 2600, to: 900, q: 3 }); sfx.tone(o, { f: 190, to: 120, dur: 0.12, vol: 0.18, type: 'triangle' }); },
    bowHeavy: o => { sfx.noise(o, { dur: 0.22, vol: 0.45, type: 'bandpass', f: 1800, to: 500, q: 2 }); sfx.tone(o, { f: 150, to: 70, dur: 0.25, vol: 0.3, type: 'triangle' }); sfx.tone(o, { f: 1400, to: 2600, dur: 0.2, vol: 0.08, type: 'sine' }); },
    draw: o => { sfx.noise(o, { dur: 0.45, vol: 0.12, type: 'bandpass', f: 500, to: 1400, q: 6, attack: 0.1 }); },
    thunk: o => { sfx.tone(o, { f: 260, to: 120, dur: 0.08, vol: 0.25, type: 'square' }); },
    mark: o => { [79, 86].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.35, vol: 0.12, type: 'triangle', at: i * 0.08 })); },
    trap: o => { sfx.noise(o, { dur: 0.08, vol: 0.4, type: 'highpass', f: 3000 }); sfx.tone(o, { f: 700, to: 300, dur: 0.15, vol: 0.2, type: 'square' }); },
    axe: o => { sfx.noise(o, { dur: 0.32, vol: 0.55, f: 1100, to: 180, q: 1.1 }); sfx.tone(o, { f: 90, to: 50, dur: 0.2, vol: 0.25 }); },
    xbow: o => { sfx.noise(o, { dur: 0.08, vol: 0.45, type: 'highpass', f: 2200 }); sfx.tone(o, { f: 140, to: 60, dur: 0.18, vol: 0.32, type: 'square' }); }, // the crossbow's clack-thump
    hatchet: o => { sfx.noise(o, { dur: 0.16, vol: 0.4, f: 2200, to: 500, q: 1.4 }); },
    hammer: o => { sfx.noise(o, { dur: 0.4, vol: 0.6, type: 'lowpass', f: 700, to: 120 }); sfx.tone(o, { f: 70, to: 38, dur: 0.35, vol: 0.4 }); },
  };
  sfx.play = (name, pos, vol = 1) => {
    if (!EXTRA[name]) return basePlay(name, pos, vol);
    if (!sfx.ctx || !sfx.on) return;
    const o = sfx.out(vol, pos);
    if (o) EXTRA[name](o);
  };

  const me = () => state.myId;
  const entPos = id => (id === me() ? { x: state.x, z: state.z } : players.get(id) || mobs.get(id) || null);
  function anim(id, key, n = 0) {
    const ent = players.get(id), list = ANIM[key];
    if (!ent?.model.anim || !list) return;
    const [name, speed] = list[n % list.length];
    ent.model.anim.shot(name, speed);
  }

  // ---------- visuals ----------
  function ringOnly(x, z, r, color, life, opacity = 0.75) { // a static ring (friendly telegraph)
    const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.22, r, 48), fx.fadeMat(color, opacity));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.09, z);
    fx.add(m, life, (mesh, k) => { mesh.material.opacity = opacity * (0.55 + 0.45 * Math.sin(k * Math.PI * 6) ** 2); });
    return m;
  }
  function drawLine(id, f, len, life, big) { // the Piercing / Sniper Shot aim line, following the archer
    const m = new THREE.Mesh(new THREE.PlaneGeometry(big ? 0.5 : 0.3, len), fx.fadeMat(0x5eead4, 0.2));
    m.rotation.x = -Math.PI / 2;
    const g = new THREE.Group(); g.add(m); m.position.z = len / 2; m.rotation.z = Math.PI;
    fx.add(g, life, (mesh, k) => {
      const p = entPos(id), ent = players.get(id);
      if (p) mesh.position.set(p.x, 0.1, p.z);
      mesh.rotation.y = id === me() ? state.face : ent ? ent.model.group.rotation.y : f;
      m.material.opacity = 0.15 + 0.45 * k;
    });
  }
  function caltrops(x, z, r, life) {
    fx.zone(x, z, r, life, 0x94a3b8);
    const geo = new THREE.TetrahedronGeometry(0.12), mat = new THREE.MeshStandardMaterial({ color: 0x52525b, metalness: 0.6, roughness: 0.4 });
    const g = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (r - 0.3);
      const s = new THREE.Mesh(geo, mat); s.position.set(Math.sin(a) * d, 0.08, Math.cos(a) * d); s.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      g.add(s);
    }
    g.position.set(x, 0, z);
    fx.add(g, life, (mesh, k) => { if (k > 0.85) mesh.scale.setScalar(1 - (k - 0.85) / 0.15); });
  }
  function snare(x, z, r, life) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, 0.05, 4, 24), new THREE.MeshStandardMaterial({ color: 0x78716c, metalness: 0.7 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; g.add(ring);
    for (let i = 0; i < 10; i++) { // jaws
      const a = (i / 10) * Math.PI * 2, t = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), ring.material);
      t.position.set(Math.sin(a) * r * 0.55, 0.14, Math.cos(a) * r * 0.55); g.add(t);
    }
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 40), fx.fadeMat(0xf59e0b, 0.35)); edge.rotation.x = -Math.PI / 2; edge.position.y = 0.05; g.add(edge);
    g.position.set(x, 0, z);
    const e = { mesh: g, life, age: 0, update: (mesh, k) => { edge.material.opacity = 0.2 + 0.25 * Math.abs(Math.sin(k * 30)); } };
    scene.add(g); fx.list.push(e);
    traps.push({ e, x, z });
  }
  function rain(x, z, r, life) {
    ringOnly(x, z, r, 0x5eead4, life, 0.6);
    fx.zone(x, z, r, life, 0x2dd4bf);
    const n = Math.round(life * 22);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
        const m = arrowMesh('shot'); m.rotation.x = Math.PI / 2 - 0.15; m.position.set(px, 9, pz);
        fx.add(m, 0.35, (mesh, k) => { mesh.position.y = Math.max(0.3, 9 - k * 30); });
        if (i % 4 === 0) setTimeout(() => fx.sparks(px, 0.3, pz, 4, 0xd6d3d1, 0.15, 3), 300);
      }, 450 + (i / n) * (life - 0.45) * 1000);
    }
  }
  function marker(id, by, d, kind) {
    endMark(id);
    const color = kind === 'deadeye' ? 0xfbbf24 : 0x2dd4bf;
    const g = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }));
    gem.scale.y = 1.5; gem.renderOrder = 9; g.add(gem);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 32), fx.fadeMat(color, 0.7)); ring.rotation.x = -Math.PI / 2; g.add(ring);
    scene.add(g);
    marks.set(id, { g, gem, ring, until: performance.now() + d * 1000 });
  }
  function endMark(id) { const k = marks.get(id); if (!k) return; scene.remove(k.g); k.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); marks.delete(id); }
  function aura(id, d, kind) {
    endAura(id);
    const color = kind === 'warblood' ? 0xbe123c : kind === 'frenzy' ? 0xf97316 : 0xdc2626;
    const g = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(g);
    auras.set(id, { g, until: performance.now() + d * 1000 });
  }
  function endAura(id) { const a = auras.get(id); if (!a) return; scene.remove(a.g); a.g.geometry.dispose(); a.g.material.dispose(); auras.delete(id); }

  function caFx(e) {
    const mine = e.id === me() ? 1 : 0.6, at = { x: e.x, z: e.z };
    const ox = e.id === me() ? state.x : e.x, oz = e.id === me() ? state.z : e.z;
    switch (e.v) {
      case 'shot':
        if (e.sty === 'crossbow') { anim(e.id, 'crossbow', e.n); sfx.play('xbow', at, mine * (e.fin ? 1.3 : 1)); if (e.fin && e.id === me()) shake(0.05); break; }
        anim(e.id, 'shot', e.n); sfx.play(e.fin ? 'bowHeavy' : 'bow', at, mine); break;
      case 'draw': anim(e.id, 'draw'); drawLine(e.id, e.f, e.r, e.d, e.big); sfx.play('draw', at, mine); break;
      case 'loose': anim(e.id, 'loose'); sfx.play('bowHeavy', at, mine * (e.big ? 1.4 : 1)); if (e.big && e.id === me()) shake(0.12); break;
      case 'rain': anim(e.id, 'rain'); rain(e.x2, e.z2, e.r, e.d); sfx.play('bowHeavy', at, mine); break;
      case 'disengage': anim(e.id, 'disengage'); fx.line(e.x0, e.z0, e.x2, e.z2, 0x99f6e4, 0.6, 0.35, 0.6); caltrops(e.x0, e.z0, e.r, e.d); sfx.play('roll', at, mine); sfx.play('trap', { x: e.x0, z: e.z0 }, 0.5 * mine); break;
      case 'snare': anim(e.id, 'snare'); fx.line(e.x0, e.z0, e.x2, e.z2, 0x99f6e4, 0.6, 0.3, 0.6); snare(e.x0, e.z0, e.r, e.d); sfx.play('roll', at, mine); break;
      case 'snared': {
        let best = -1, bd = 1;
        traps.forEach((t, i) => { const d = Math.hypot(t.x - e.x, t.z - e.z); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) { fx.end(traps[best].e); traps.splice(best, 1); }
        fx.ring(e.x, e.z, e.r + 0.5, 0xf59e0b, 0.45); fx.sparks(e.x, 0.4, e.z, 14, 0xfde68a, 0.22, 6); sfx.play('trap', at, 1); break;
      }
      case 'tumble': anim(e.id, 'tumble'); fx.line(e.x0, e.z0, e.x2, e.z2, 0x99f6e4, 0.7, 0.4, 0.6); sfx.play('roll', at, mine); sfx.play('bow', at, mine); break;
      case 'mark': anim(e.id, 'mark'); fx.line(ox, oz, e.x2, e.z2, e.dead ? 0xfbbf24 : 0x2dd4bf, 0.12, 0.35, 1.4); sfx.play('mark', at, mine); break;
      case 'chop':
        if (e.sty === 'twinaxes') { // two quick crossing hatchet arcs
          anim(e.id, 'twinaxes', e.n);
          fx.arc(ox, oz, e.f + (e.n % 2 ? 0.3 : -0.3), e.r, 1.0, e.fin ? 0xfdba74 : 0xffedd5);
          if (e.fin) fx.arc(ox, oz, e.f - 0.3, e.r * 0.9, 1.0, 0xfb923c);
          sfx.play('hatchet', at, mine); break;
        }
        if (e.sty === 'warhammer') { // a heavy dull arc and dust; the third blow cracks the ground all around
          anim(e.id, 'warhammer', e.n);
          if (e.fin) { fx.ring(ox, oz, e.r, 0xa16207, 0.55); fx.ring(ox, oz, e.r * 0.55, 0xfde68a, 0.4); fx.sparks(ox, 0.3, oz, 20, 0xa8a29e, 0.3, 8); sfx.play('boom', at, mine * 0.8); if (e.id === me()) shake(0.25); }
          else { fx.arc(ox, oz, e.f, e.r, 1.2, 0xd6d3d1); fx.sparks(ox + Math.sin(e.f) * e.r * 0.7, 0.4, oz + Math.cos(e.f) * e.r * 0.7, 8, 0xa8a29e, 0.22, 4); }
          sfx.play('hammer', at, mine); break;
        }
        anim(e.id, 'chop', e.n); fx.arc(ox, oz, e.f, e.r, 1.1, e.fin ? 0xfca5a5 : 0xfee2e2); sfx.play('axe', at, mine * (e.fin ? 1.3 : 1)); if (e.fin && e.id === me()) shake(0.08); break;
      case 'cleave': anim(e.id, 'cleave'); fx.arc(ox, oz, e.f, e.r, e.h, e.rage > 60 ? 0xef4444 : e.rage > 25 ? 0xf87171 : 0xfecaca); fx.arc(ox, oz, e.f, e.r * 0.7, e.h, 0xfff1f2); sfx.play('axe', at, mine * 1.3); if (e.id === me()) shake(0.1); break;
      case 'whirl': if (!e.n) anim(e.id, 'whirl'); fx.ring(ox, oz, e.r, 0xf87171, 0.35); fx.arc(ox, oz, e.f + e.n * 2, e.r, Math.PI, 0xfecaca); sfx.play('axe', at, mine); break;
      case 'execute': anim(e.id, 'execute'); fx.arc(ox, oz, e.f, e.r, e.h, 0x7f1d1d); fx.arc(ox, oz, e.f, e.r * 0.8, e.h * 0.6, 0xef4444); sfx.play('axe', at, mine * 1.4); if (e.id === me()) shake(0.15); break;
      case 'leap': anim(e.id, 'leap'); ringOnly(e.x2, e.z2, e.r, 0xf97316, e.d, 0.8); fx.zone(e.x2, e.z2, e.r, e.d, 0xfb923c); sfx.play('roll', at, mine); break;
      case 'slam': anim(e.id, 'slam'); fx.ring(e.x, e.z, e.r, e.big ? 0xfbbf24 : 0xf97316, 0.5); fx.ring(e.x, e.z, e.r * 0.6, 0xfed7aa, 0.35); fx.sparks(e.x, 0.3, e.z, 18, 0xd6d3d1, 0.3, 8); sfx.play('boom', at, mine); shake(e.id === me() ? 0.3 : 0.1); break;
      case 'pounce': anim(e.id, 'pounce'); fx.line(e.x0, e.z0, e.x2, e.z2, 0xfca5a5, 0.8, 0.35, 0.8); fx.ring(e.x2, e.z2, 2, 0xef4444, 0.35); sfx.play('axe', at, mine * 1.3); if (e.id === me()) shake(0.15); break;
      case 'roar': anim(e.id, 'roar'); fx.ring(ox, oz, 4, e.frenzy ? 0xf97316 : 0xdc2626, 0.6); fx.ring(ox, oz, 2.4, 0xfca5a5, 0.4); sfx.play('roar', at, 0.6 * mine); break;
      case 'warblood': anim(e.id, 'warblood'); fx.ring(ox, oz, e.r, 0xbe123c, 0.7); fx.ring(ox, oz, 3, 0xfda4af, 0.45); sfx.play('roar', at, 0.5 * mine); sfx.play('heal', at, mine); break;
    }
  }

  // ---------- events ----------
  function event(e) {
    switch (e.t) {
      case 'fx': if (e.k !== 'ca') return false; caFx(e); return true;
      case 'aproj': {
        const g = arrowMesh(e.k), p = e.by === me() ? state : null;
        const x = p ? p.x : e.x, z = p ? p.z : e.z;
        g.position.set(x, 1.3, z); g.rotation.y = e.a; scene.add(g);
        arrows.set(e.id, { g, x, z, a: e.a, sp: e.sp, range: e.r, trav: 0, tg: e.tg, k: e.k });
        return true;
      }
      case 'apend': {
        const a = arrows.get(e.id);
        if (a) { scene.remove(a.g); a.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); arrows.delete(e.id); }
        const xb = a?.k === 'xbolt' || a?.k === 'xheavy'; // crossbow bolts: an amber burst and a ring
        if (e.h) { fx.sparks(e.x, 1.2, e.z, xb ? 10 : 6, xb ? 0xfbbf24 : 0xfef3c7, xb ? 0.24 : 0.18, 5); if (xb) fx.ring(e.x, e.z, 0.9, 0xf59e0b, 0.25); }
        else if (a) sfx.play('thunk', { x: e.x, z: e.z }, 0.4);
        return true;
      }
      case 'rageA': {
        rage.clear();
        for (const [id, v, on] of e.l) rage.set(id, [v, on]);
        return true;
      }
      case 'markA': {
        marker(e.id, e.by, e.d, e.k);
        const m = mobs.get(e.id);
        if (m && (e.by === me() || state.spectator)) floatNum(m.model.group.position, (m.model.height || 2) + 0.4, e.k === 'deadeye' ? 'DEADEYE' : 'MARKED', 'rage');
        return true;
      }
      case 'brA': {
        if (e.end) { endAura(e.id); return true; }
        aura(e.id, e.d, e.k);
        const p = players.get(e.id);
        if (p && (e.id === me() || state.spectator)) floatNum(p.model.group.position, 2.5, e.k === 'warblood' ? 'Warblood' : e.k === 'frenzy' ? 'FRENZY' : 'BLOODRAGE', 'rage');
        return true;
      }
    }
    return false;
  }

  // ---------- per frame ----------
  const rageOf = id => rage.get(id) || [0, 0];
  function setRage(el, id) {
    const [v, on] = rageOf(id);
    el.firstChild.style.width = `${v}%`;
    el.classList.toggle('full', v >= 100); el.classList.toggle('on', !!on);
  }
  function frame(dt, now) {
    if (state.joined && !tipped && !state.spectator) {
      tipped = true;
      if (state.cls === 'ranger') log('Ranger: arrows fly at your target (or straight ahead) and hit the first enemy in the way. Keep your distance: point-blank shots are weak. Hunter\'s Mark (Lv 3) makes the whole party hit harder.', 'sys');
      if (state.cls === 'berserker') log('Berserker: hitting and getting hit builds Rage (red bar). Cleave hits harder with more Rage; Bloodrage (Lv 3) spends it for lifesteal and faster swings. No guard, thin armour: dodge!', 'sys');
    }
    for (const [id, a] of arrows) { // fly (and home) like the server does; the server's 'apend' removes it
      const m = a.tg && mobs.get(a.tg);
      if (m && !m.dying) a.a += Math.max(-RT.arrow.homing * dt, Math.min(RT.arrow.homing * dt, wrap(Math.atan2(m.x - a.x, m.z - a.z) - a.a)));
      const step = a.sp * dt;
      a.x += Math.sin(a.a) * step; a.z += Math.cos(a.a) * step; a.trav += step;
      a.g.position.set(a.x, 1.3, a.z); a.g.rotation.y = a.a;
      if (a.trav > a.range + 2) { scene.remove(a.g); arrows.delete(id); }
    }
    const t = performance.now();
    for (const [id, k] of marks) {
      const m = mobs.get(id);
      if (!m || m.dying || t > k.until) { endMark(id); continue; }
      const p = m.model.group.position;
      k.gem.position.set(p.x, (m.model.height || 2) + 0.9 + Math.sin(t / 200) * 0.12, p.z); k.gem.rotation.y += dt * 3;
      k.ring.position.set(p.x, 0.1, p.z); k.ring.scale.setScalar((m.def?.radius || 1) + 0.4);
    }
    for (const [id, a] of auras) {
      const p = players.get(id);
      if (!p || t > a.until || p.dead) { endAura(id); continue; }
      a.g.position.set(p.model.group.position.x, 1.2, p.model.group.position.z);
      a.g.material.opacity = 0.12 + 0.07 * Math.sin(t / 90);
    }
    // Rage bars: under my health (me frame) and on Berserkers' nameplates
    let mine = $('me-rage');
    if (!mine && state.joined && state.cls === 'berserker') {
      const xp = $('me-xp')?.parentElement;
      if (xp) { mine = document.createElement('div'); mine.className = 'bar rage'; mine.id = 'me-rage'; mine.title = 'Rage'; mine.innerHTML = '<div></div>'; xp.parentElement.insertBefore(mine, xp); }
    }
    if (mine) { mine.style.display = state.cls === 'berserker' ? '' : 'none'; setRage(mine, me()); } // hidden after switching class
    for (const e of players.values()) {
      if (e.cls !== 'berserker' || !e.label) continue;
      if (!e.rgEl) { e.rgEl = document.createElement('div'); e.rgEl.className = 'rgbar'; e.rgEl.innerHTML = '<div></div>'; e.label.el.appendChild(e.rgEl); }
      e.rgEl.firstChild.style.width = `${rageOf(e.id)[0]}%`;
    }
  }

  // Auto-aim range for a skill (main.js useSkill turns you toward the locked / nearest enemy within it), or 0.
  const AIM = { shot: 24, pierce: 26, disengage: 24, mark: 28, chop: 6, cleave: 5, leap: 10 };
  const AIM_EVO = { rainofarrows: 18, snipershot: 32, tumblevolley: 24, snaretrap: 0, packhunter: 28, deadeye: 28, pounce: 12, earthshatter: 10 };
  function aimRange(skId, evoId) { return evoId && evoId in AIM_EVO ? AIM_EVO[evoId] : AIM[skId] || 0; }
  // What a ranged skill aims at with nothing locked: the enemy closest to the camera's line of sight within range
  // (the crosshair), else anything close by.
  function pick(range, canTarget, nearestMob) {
    const fx0 = Math.sin(state.yaw), fz0 = Math.cos(state.yaw);
    let best = null, bs = Infinity;
    for (const m of mobs.values()) {
      if (!canTarget(m)) continue;
      const dx = m.x - state.x, dz = m.z - state.z, d = Math.hypot(dx, dz) || 0.01;
      if (d > range + (m.def?.radius || 0)) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx0 + dz * fz0) / d)));
      if (ang > 0.45 + Math.atan2(m.def?.radius || 0.8, d)) continue;
      const sc = ang * 4 + d / range;
      if (sc < bs) { bs = sc; best = m; }
    }
    return best || nearestMob(Math.min(range, 7));
  }
  // Party frame: a thin Rage bar under a Berserker's health.
  function frameBar(p) {
    if (p.cls !== 'berserker') return '';
    const [v, on] = rageOf(p.id);
    return `<div class="bar rage ${v >= 100 ? 'full' : ''} ${on ? 'on' : ''}"><div style="width:${v}%"></div></div>`;
  }

  return { event, frame, aimRange, pick, frameBar, rage: id => rageOf(id)[0] };
}
