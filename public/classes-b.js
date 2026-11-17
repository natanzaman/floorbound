// Lancer and Bard on the client: their character rigs (a spear; a lyre and a feathered beret, built from simple
// geometry on the KayKit rigs), every skill visual and sound, the Bard's sonic bolts, Discord marks, song auras,
// buff tags, Anthem's speed / haste on your own character, and auto-aim for their skills.
// Server side: server/classes-b.js. Data: shared/classes/lancer.js, shared/classes/bard.js.
//
// main.js calls initClassesB(ctx) once and classesB.aim(...) in useSkill. Everything else hooks in by wrapping a few
// methods of the mastery / combat / sound objects it is given (the same way public/mastery.js extends the sounds):
//  mastery.event (this module sees events first), mastery.cd (Anthem's haste), mastery.buffTags (HUD tags),
//  combat.speedMult (Anthem's speed), sfx.play (extra sounds).
import * as THREE from 'three';
import { RIGS } from '/world.js';
import { LANCE } from '/shared/classes/lancer.js';
import { SONG } from '/shared/classes/bard.js';

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, flatShading: true, ...opts });
const glass = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });

// ---------- character rigs (registered with world.js; built from the KayKit rigs, CC0) ----------
// The weapon group copies the knight's sword transform on the hand slot, so +Y runs along the weapon (sword units:
// the 1H sword's blade is ~1.4 long).
function weaponGroup(assets, root) {
  const slot = root.getObjectByName('handslotr'), sword = assets.gltf.knight.scene.getObjectByName('1H_Sword');
  if (!slot || !sword) return null;
  const g = new THREE.Group();
  g.position.copy(sword.position); g.quaternion.copy(sword.quaternion); g.scale.copy(sword.scale);
  slot.add(g);
  return g;
}
function mesh(geo, mat, x, y, z, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; }

function addSpear(root, assets) { // a long ash spear with a steel leaf head and a teal pennant
  const g = weaponGroup(assets, root);
  if (!g) return [];
  const wood = std(0x8b5a2b, { metalness: 0 }), steel = std(0xdbe7f0, { metalness: 0.7, roughness: 0.3 }), cloth = std(0x14b8a6, { metalness: 0, side: THREE.DoubleSide });
  const brass = std(0xd4a24c, { metalness: 0.6, roughness: 0.4 });
  mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.7, 6), wood, 0, 0.75, 0, g);           // shaft: -1.1 .. 2.6
  mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 6), brass, 0, 2.6, 0, g);             // collar
  const head = mesh(new THREE.OctahedronGeometry(0.24, 0), steel, 0, 3.05, 0, g);       // leaf blade
  head.scale.set(0.75, 2.4, 0.3);
  mesh(new THREE.ConeGeometry(0.08, 0.25, 6), brass, 0, -1.2, 0, g).rotation.x = Math.PI; // butt spike
  const flag = mesh(new THREE.PlaneGeometry(0.45, 0.32), cloth, 0.24, 2.35, 0, g);       // pennant
  flag.rotation.y = 0.2;
  return [wood, steel, cloth, brass];
}

function addBardGear(root, assets) { // a golden lyre in the right hand, a feathered beret
  const mats = [];
  const g = weaponGroup(assets, root);
  if (g) {
    const gold = std(0xe8b04a, { metalness: 0.75, roughness: 0.3 }), wood = std(0x7c3f1d, { metalness: 0 }), str = std(0xfff7d6, { emissive: 0x6b5a1a, emissiveIntensity: 0.4 });
    mats.push(gold, wood, str);
    mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, 6), wood, 0, 0.1, 0, g);            // grip
    const body = mesh(new THREE.SphereGeometry(0.3, 10, 8), wood, 0, 0.45, 0, g); body.scale.set(1, 0.7, 0.45);
    for (const s of [-1, 1]) {                                                              // the two curved arms
      const arm = mesh(new THREE.TorusGeometry(0.42, 0.045, 5, 12, Math.PI * 0.75), gold, s * 0.08, 0.95, 0, g);
      arm.rotation.z = s > 0 ? -0.35 : Math.PI + 0.35; arm.scale.x = 0.55;
    }
    mesh(new THREE.BoxGeometry(0.62, 0.06, 0.06), gold, 0, 1.38, 0, g);                    // crossbar
    for (let i = -2; i <= 2; i++) mesh(new THREE.BoxGeometry(0.012, 0.85, 0.012), str, i * 0.08, 0.95, 0, g); // strings
  }
  const head = root.getObjectByName('head');
  if (head) {
    const felt = std(0x6d28d9, { metalness: 0 }), band = std(0xfbbf24, { metalness: 0.5 }), plume = std(0xef4444, { metalness: 0, side: THREE.DoubleSide });
    mats.push(felt, band, plume);
    const hat = new THREE.Group(); hat.position.set(0.05, 1.0, -0.05); hat.rotation.z = -0.18; head.add(hat);
    mesh(new THREE.CylinderGeometry(0.66, 0.74, 0.2, 14), felt, 0, 0, 0, hat);
    mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 14), band, 0, -0.08, 0, hat);
    const f = mesh(new THREE.ConeGeometry(0.12, 1.1, 5), plume, -0.55, 0.35, -0.2, hat);
    f.rotation.z = 0.9; f.rotation.x = -0.3; f.scale.z = 0.35;
  }
  return mats;
}

RIGS.lancer ||= { file: 'knight', hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword'], height: 2.0, tint: 0xa7ddd3, decorate: addSpear };
RIGS.bard ||= { file: 'rogue', hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'], height: 1.92, tint: 0xe2c8ff, decorate: addBardGear };

// ---------- skills: auto-aim ranges and animations ----------
const AIM = { lthrust: 6.5, lcharge: 10, skylance: 11, sonic: 11, dissonance: 8 };
const ANIM = {
  thrust: (n, sty) => (sty === 'glaive' ? ['2H_Melee_Attack_Stab', n === 2 ? 1.3 : 1.9] : n === 2 ? ['1H_Melee_Attack_Stab', 1.5] : ['1H_Melee_Attack_Stab', 2.3]),
  charge: () => ['1H_Melee_Attack_Stab', 1.4], comet: () => ['1H_Melee_Attack_Stab', 1.3], hitrun: () => ['1H_Melee_Attack_Stab', 1.8],
  sweep: () => ['2H_Melee_Attack_Spin', 1.7], cyclone: () => ['2H_Melee_Attack_Spinning', 1.6], hamstring: () => ['2H_Melee_Attack_Slice', 1.6],
  skyland: () => ['2H_Melee_Attack_Chop', 1.8], meteorLand: () => ['2H_Melee_Attack_Chop', 1.6], pinLand: () => ['1H_Melee_Attack_Stab', 1.6],
  sonic: () => ['Spellcast_Shoot', 2.2], dissonance: () => ['Spellcast_Shoot', 1.6], shatter: () => ['Spellcast_Shoot', 1.5], feedback: () => ['Spellcast_Raise', 1.8],
  song: () => ['Spellcast_Long', 1.2], cresc: () => ['Spellcast_Long', 1.0], crescBurst: () => ['Cheer', 1.4],
};
const SONG_COLOR = { anthem: 0xfbbf24, warmarch: 0xf97316, lullaby: 0x93c5fd };
const BUFF_NAME = { anthem: 'Anthem', march: 'War March', cresc: 'Crescendo' };

export function initClassesB(ctx) {
  const { state, players, mobs, fx, sfx, mastery, combat, floatNum } = ctx;
  const shake = a => ctx.shake?.(a);
  const me = () => state.myId;
  const buffs = new Map(); // player id -> { k: until (ms) }
  const marks = new Map(); // mob id -> Discord mark entry
  const shots = new Map(); // bolt id -> effect entry
  const auras = new Map(); // `${id}:${kind}` -> effect entry
  const buffOn = (id, k) => (buffs.get(id)?.[k] || 0) > performance.now();

  // ---------- sounds ----------
  const basePlay = sfx.play.bind(sfx);
  const EXTRA = {
    pluck: o => { const n = 72 + [0, 3, 5, 7][Math.floor(Math.random() * 4)]; sfx.tone(o, { f: NOTE(n), dur: 0.28, vol: 0.14, type: 'triangle' }); sfx.tone(o, { f: NOTE(n + 12), dur: 0.12, vol: 0.05, type: 'sine' }); },
    strum: o => [60, 64, 67, 72, 76].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.9, vol: 0.1, type: 'triangle', at: i * 0.035 })),
    lull: o => [79, 76, 72, 76].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.6, vol: 0.09, type: 'sine', at: i * 0.16 })),
    march: o => { [55, 55, 62, 67].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.3, vol: 0.12, type: 'square', at: i * 0.12 })); sfx.noise(o, { dur: 0.12, vol: 0.2, type: 'lowpass', f: 400 }); },
    discord: o => { [61, 62, 66].forEach(n => sfx.tone(o, { f: NOTE(n), to: NOTE(n - 5), dur: 0.45, vol: 0.12, type: 'sawtooth' })); sfx.noise(o, { dur: 0.3, vol: 0.18, f: 1800, to: 600, q: 2 }); },
    rise: o => { for (let i = 0; i < 8; i++) sfx.tone(o, { f: NOTE(60 + i * 2), dur: 0.35, vol: 0.06 + i * 0.008, type: 'triangle', at: i * 0.17 }); },
    burst: o => { [48, 60, 64, 67, 72, 79].forEach(n => sfx.tone(o, { f: NOTE(n), dur: 1.2, vol: 0.1, type: 'triangle', attack: 0.01 })); sfx.noise(o, { dur: 0.6, vol: 0.25, type: 'highpass', f: 1500, to: 6000 }); },
    spear: o => { sfx.noise(o, { dur: 0.13, vol: 0.32, type: 'bandpass', f: 3200, to: 900, q: 2.2 }); },
    flute: o => { const n = 79 + [0, 2, 4, 7][Math.floor(Math.random() * 4)]; sfx.tone(o, { f: NOTE(n), dur: 0.18, vol: 0.1, type: 'sine', attack: 0.02 }); sfx.noise(o, { dur: 0.12, vol: 0.05, type: 'bandpass', f: 3000, q: 3 }); },
  };
  sfx.play = (name, pos, vol = 1) => {
    if (!EXTRA[name]) return basePlay(name, pos, vol);
    if (!sfx.ctx || !sfx.on) return;
    const o = sfx.out(vol, pos);
    if (o) EXTRA[name](o);
  };

  // ---------- small effect builders ----------
  const lastEntry = () => fx.list[fx.list.length - 1];
  function follow(id, life, make, key) { // an effect that sticks to a player for `life` s
    const p = players.get(id); if (!p) return null;
    const m = make();
    fx.add(m, life, (mesh, k, dt) => { const g = p.model.group.position; mesh.position.set(g.x, mesh.position.y, g.z); mesh.userData.tick?.(mesh, k, dt); });
    const e = lastEntry();
    if (key) { fx.end(auras.get(key)); auras.set(key, e); }
    return e;
  }
  function notes(x, z, color, n = 5, spread = 1.2) { // little music notes rising
    for (let i = 0; i < n; i++) {
      const m = new THREE.Group();
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), glass(color, 0.95)); head.scale.set(1.3, 1, 1);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), glass(color, 0.95)); stem.position.set(0.1, 0.15, 0);
      m.add(head, stem);
      const a = Math.random() * Math.PI * 2, d = Math.random() * spread;
      m.position.set(x + Math.sin(a) * d, 1 + Math.random() * 0.6, z + Math.cos(a) * d);
      const sway = Math.random() * 6;
      fx.add(m, 1 + Math.random() * 0.5, (mesh, k, dt) => {
        mesh.position.y += dt * 1.2; mesh.position.x += Math.sin(sway + k * 8) * dt * 0.4;
        for (const c of mesh.children) c.material.opacity = 0.95 * (1 - k);
      });
    }
  }
  function cone(x, z, f, r, half, color, life = 0.35) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24, f - Math.PI / 2 - half, half * 2), glass(color, 0.45));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, z);
    fx.add(m, life, (mesh, k) => { mesh.scale.setScalar(0.3 + 0.7 * Math.min(1, k * 2.5)); mesh.material.opacity = 0.45 * (1 - k); });
    for (let i = 0; i < 3; i++) { // sound waves: arcs travelling out
      const arc = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 24, 1, f - Math.PI / 2 - half, half * 2), glass(0xf0abfc, 0.8));
      arc.rotation.x = -Math.PI / 2; arc.position.set(x, 0.9, z);
      fx.add(arc, life + 0.1, (mesh, k) => { const kk = Math.min(1, Math.max(0.01, k * 1.3 - i * 0.15)); mesh.scale.setScalar(r * kk); mesh.material.opacity = 0.8 * (1 - kk); });
    }
  }
  function marker(x, z, r, life, color) { // an ally-friendly landing mark (not a red danger telegraph)
    const g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.2, r, 40), glass(color, 0.9));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), glass(color, 0.22));
    const cross = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.45, 4), glass(0xffffff, 0.9));
    for (const m of [edge, fill, cross]) m.rotation.x = -Math.PI / 2;
    g.add(edge, fill, cross); g.position.set(x, 0.1, z);
    fx.add(g, life + 0.15, (mesh, k) => { fill.scale.setScalar(Math.max(0.01, k)); cross.rotation.z += 0.08; edge.material.opacity = 0.9 * (k < 0.9 ? 1 : (1 - k) * 10); });
  }
  function streak(x0, z0, x1, z1, color, life = 0.35) { // a spear-tip streak
    fx.line(x0, z0, x1, z1, color, 0.35, life, 1.2);
    fx.line(x0, z0, x1, z1, 0xffffff, 0.12, life * 0.7, 1.25);
  }

  // ---------- Discord marks over enemies ----------
  function discordMark(id, n, d) {
    fx.end(marks.get(id)); marks.delete(id);
    const m = mobs.get(id);
    if (!m || !n) return;
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), glass(n >= 3 ? 0xe879f9 : 0xc084fc, 0.95));
      const a = (i / n) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55); g.add(s);
    }
    fx.add(g, d, (mesh, k, dt) => {
      const p = m.model.group.position;
      mesh.position.set(p.x, p.y + m.model.height + (m.label ? 0.25 : 0.6), p.z); mesh.rotation.y += dt * 2.5;
      if (k > 0.85) for (const c of mesh.children) c.material.opacity = 0.95 * (1 - k) / 0.15;
    });
    marks.set(id, lastEntry());
  }

  // ---------- events ----------
  function playAnim(id, key, n, sty) {
    const p = players.get(id), a = ANIM[key]?.(n, sty);
    if (!p?.model.anim || !a) return;
    p.model.anim.shot(a[0], a[1]);
    p.swing = 0.3;
  }
  function onFx(e) {
    const p = players.get(e.id), mine = e.id === me() ? 1 : 0.6, at = { x: e.x, z: e.z };
    const ox = e.id === me() ? state.x : e.x, oz = e.id === me() ? state.z : e.z;
    playAnim(e.id, e.ev, e.n, e.sty);
    if (p && e.id === me() && e.ev !== 'discord') state.lastCombat = performance.now();
    switch (e.ev) {
      // ----- Lancer -----
      case 'thrust': {
        const x1 = ox + Math.sin(e.f) * e.r, z1 = oz + Math.cos(e.f) * e.r;
        const gl = e.sty === 'glaive'; // Glaive (weapon style): longer violet streaks, a crescent at the tip
        streak(ox + Math.sin(e.f) * 0.6, oz + Math.cos(e.f) * 0.6, x1, z1, gl ? (e.n === 2 ? 0xe9d5ff : 0xc4b5fd) : e.n === 2 ? 0xfde68a : 0x99f6e4, e.n === 2 ? 0.3 : 0.2);
        if (e.n === 2) fx.ring(x1, z1, 1.3, gl ? 0xa78bfa : 0xfde68a, 0.3);
        if (gl) fx.arc(x1 - Math.sin(e.f) * 0.8, z1 - Math.cos(e.f) * 0.8, e.f, 1.1, 0.9, 0xddd6fe);
        for (const id of e.tip || []) { const m = mobs.get(id); if (m) { fx.sparks(m.x, 1.4, m.z, 6, gl ? 0xa78bfa : 0x5eead4, 0.26, 6); if (e.id === me()) floatNum(m.model.group.position, m.model.height + 0.2, 'REACH', 'evade', 0.9); } }
        sfx.play(e.n === 2 ? 'swingHeavy' : 'spear', at, mine);
        break;
      }
      case 'charge': case 'comet': case 'hitrun':
        streak(e.x, e.z, e.x2, e.z2, e.ev === 'comet' ? 0xfbbf24 : e.ev === 'hitrun' ? 0xf472b6 : 0x2dd4bf, 0.45);
        fx.line(e.x, e.z, e.x2, e.z2, 0x99f6e4, 1.6, 0.3, 0.6);
        if (e.ev === 'comet') { setTimeout(() => { fx.ring(e.x2, e.z2, e.r, 0xfbbf24, 0.5); fx.ring(e.x2, e.z2, e.r * 0.6, 0xfde68a, 0.4); fx.sparks(e.x2, 0.5, e.z2, 14, 0xfde68a, 0.3, 8); shake(e.id === me() ? 0.25 : 0.08); sfx.play('boom', { x: e.x2, z: e.z2 }, 0.7 * mine); }, 120); }
        sfx.play('roll', at, mine); sfx.play('whoosh', at, mine * 0.8);
        break;
      case 'hitrunBack': streak(e.x, e.z, e.x2, e.z2, 0xf9a8d4, 0.3); sfx.play('whoosh', at, mine * 0.7); break;
      case 'sweep': case 'cyclone':
        fx.ring(ox, oz, e.r, e.ev === 'cyclone' ? 0x5eead4 : 0xfde68a, 0.35); fx.ring(ox, oz, e.r * 0.65, 0xccfbf1, 0.3);
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; fx.sparks(ox + Math.sin(a) * e.r * 0.8, 0.3, oz + Math.cos(a) * e.r * 0.8, 3, 0xd6d3d1, 0.25, 4); }
        sfx.play('swingHeavy', at, mine);
        break;
      case 'hamstring': fx.arc(ox, oz, e.f, e.r, Math.PI / 2, 0x5eead4); fx.ring(ox, oz, e.r, 0x2dd4bf, 0.3); sfx.play('swingHeavy', at, mine); break;
      case 'skymark': {
        const color = e.ev2 === 'pinning' ? 0xf472b6 : e.ev2 === 'meteor' ? 0xfb923c : 0x38bdf8;
        marker(e.x2, e.z2, e.r, e.d, color);
        if (p) { p.jumpT = 0; p.model.anim?.shot('Jump_Full_Short', 1.6); }
        for (let i = 1; i < 10; i++) { // the flight path: a dotted arc
          const k = i / 10, dot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 4), glass(color, 0.9));
          dot.position.set(e.x + (e.x2 - e.x) * k, 1 + 4 * 2.6 * k * (1 - k), e.z + (e.z2 - e.z) * k);
          fx.add(dot, e.d, (mesh, kk) => { mesh.material.opacity = 0.9 * (kk < k ? 1 : 0.25); });
        }
        sfx.play('whoosh', at, mine);
        break;
      }
      case 'skyland': case 'meteorLand': case 'pinLand': {
        const big = e.ev === 'meteorLand', color = e.ev === 'pinLand' ? 0xf472b6 : big ? 0xfb923c : 0x38bdf8;
        fx.ring(e.x, e.z, e.r, color, 0.5); fx.ring(e.x, e.z, e.r * 0.5, 0xffffff, 0.35);
        fx.sparks(e.x, 0.4, e.z, big ? 26 : 16, color, 0.35, big ? 11 : 8);
        if (e.ev === 'pinLand') { const m = mobs.get(e.m); if (m) { fx.beam(m.x, m.z, 0xf472b6, 0.8); floatNum(m.model.group.position, m.model.height + 0.4, 'PINNED', 'crit', mine); } }
        shake(e.id === me() ? (big ? 0.45 : 0.35) : 0.1); sfx.play('quake', at, mine);
        break;
      }
      // ----- Bard -----
      case 'sonic': {
        const fl = e.sty === 'flute'; // Flute (weapon style): a smaller, faster green-gold note
        const g = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(fl ? 0.18 : 0.28, fl ? 0.04 : 0.06, 6, 16), glass(fl ? 0x86efac : 0xe879f9, 0.95));
        const core = new THREE.Mesh(new THREE.SphereGeometry(fl ? 0.09 : 0.13, 8, 6), glass(fl ? 0xfef08a : 0xffffff, 0.9));
        g.add(ring, core); g.position.set(e.x, 1.3, e.z); g.rotation.y = Math.atan2(e.vx, e.vz);
        const entry = { mesh: g, life: e.ttl, age: 0, update: (mesh, k, dt) => { mesh.position.x += e.vx * dt; mesh.position.z += e.vz * dt; ring.scale.setScalar(1 + Math.sin(k * 30) * 0.2); } };
        fx.scene.add(g); fx.list.push(entry);
        shots.set(e.pid, { entry, fl });
        sfx.play(fl ? 'flute' : 'pluck', at, mine);
        break;
      }
      case 'sonicEnd': {
        const sh = shots.get(e.pid), c = sh?.fl ? 0x86efac : 0xe879f9;
        fx.end(sh?.entry); shots.delete(e.pid); fx.ring(e.x, e.z, e.m ? 1.1 : 0.6, c, 0.25); if (e.m) notes(e.x, e.z, c, 2, 0.4);
        break;
      }
      case 'discord': discordMark(e.m, e.n, e.d || SONG.discord.dur); break;
      case 'interrupt': { const m = mobs.get(e.m); if (m) { floatNum(m.model.group.position, m.model.height + 0.5, 'INTERRUPTED', 'counter', e.id === me() ? 1 : 0.7); fx.ring(m.x, m.z, m.def.radius + 1.4, 0xe879f9, 0.4); } break; }
      case 'song': {
        const color = SONG_COLOR[e.kind] || 0xfbbf24;
        follow(e.id, e.d, () => {
          const g = new THREE.Group();
          const ring = new THREE.Mesh(new THREE.RingGeometry(e.r - 0.15, e.r, 64), glass(color, 0.35)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
          const inner = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 32), glass(color, 0.7)); inner.rotation.x = -Math.PI / 2; inner.position.y = 0.1;
          g.add(ring, inner);
          let noteT = 0;
          g.userData.tick = (mesh, k, dt) => {
            inner.rotation.z += dt * 1.5; ring.material.opacity = 0.35 * (1 - k * 0.5) * (0.75 + 0.25 * Math.sin(k * 60));
            if ((noteT -= dt) <= 0) { noteT = 0.35; notes(mesh.position.x, mesh.position.z, color, 2, 1.4); }
          };
          return g;
        }, `${e.id}:song`);
        sfx.play(e.kind === 'lullaby' ? 'lull' : e.kind === 'warmarch' ? 'march' : 'strum', at, mine);
        break;
      }
      case 'songEnd': fx.end(auras.get(`${e.id}:song`)); auras.delete(`${e.id}:song`); break;
      case 'dissonance': case 'shatter':
        cone(ox, oz, e.f, e.r, e.h, e.ev === 'shatter' ? 0xf0abfc : 0xa855f7);
        sfx.play('discord', at, mine);
        break;
      case 'feedback': fx.ring(ox, oz, e.r, 0xa855f7, 0.4); fx.ring(ox, oz, e.r * 0.6, 0xf0abfc, 0.35); shake(e.id === me() ? 0.2 : 0.05); sfx.play('discord', at, mine); break;
      case 'cresc': {
        const color = e.kind === 'encore' ? 0x5eead4 : e.kind === 'finale' ? 0xf43f5e : 0xfbbf24;
        follow(e.id, e.d, () => {
          const g = new THREE.Group();
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), glass(color, 0.8)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1;
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 3, 16, 1, true), glass(color, 0.12)); col.position.y = 1.5;
          g.add(ring, col);
          let noteT = 0;
          g.userData.tick = (mesh, k, dt) => {
            ring.scale.setScalar(Math.max(0.05, e.r * k)); col.scale.set(1 + k, 1 + k * 0.5, 1 + k); col.material.opacity = 0.12 + 0.25 * k;
            if ((noteT -= dt) <= 0) { noteT = 0.25 - 0.15 * k; notes(mesh.position.x, mesh.position.z, color, 1 + Math.round(k * 3), 1 + k); }
          };
          return g;
        }, `${e.id}:cresc`);
        sfx.play('rise', at, mine);
        break;
      }
      case 'crescBurst': {
        fx.end(auras.get(`${e.id}:cresc`)); auras.delete(`${e.id}:cresc`);
        const color = e.kind === 'encore' ? 0x5eead4 : e.kind === 'finale' ? 0xf43f5e : 0xfbbf24;
        if (e.er) { fx.ring(ox, oz, e.er, color, 0.6); fx.ring(ox, oz, e.er * 0.6, 0xffffff, 0.4); }
        if (e.kind !== 'finale') fx.ring(ox, oz, e.r, 0xfde68a, 0.7);
        fx.beam(ox, oz, color, 1.2); notes(ox, oz, color, 10, 3);
        shake(e.id === me() ? 0.35 : 0.1); sfx.play('burst', at, mine);
        break;
      }
      case 'crescFizzle': fx.end(auras.get(`${e.id}:cresc`)); auras.delete(`${e.id}:cresc`); fx.ring(e.x, e.z, 1.5, 0x9ca3af, 0.4); break;
    }
  }
  function onBuff(e) {
    if (!BUFF_NAME[e.k]) return false;
    const b = buffs.get(e.id) || {};
    if (e.end) delete b[e.k]; else b[e.k] = performance.now() + e.d * 1000;
    buffs.set(e.id, b);
    const p = players.get(e.id);
    if (p && !e.end) {
      const g = p.model.group.position, color = e.k === 'march' ? 0xf97316 : e.k === 'cresc' ? 0xfde68a : 0xfbbf24;
      fx.ring(g.x, g.z, 1.5, color, 0.5); notes(g.x, g.z, color, 2, 0.5);
      if (e.k === 'cresc') fx.shield(p.model.group, Math.min(e.d, 6), 0xfde68a);
    }
    return true;
  }
  function event(e) {
    if (e.t === 'fx' && e.k === 'cb') { onFx(e); return true; }
    if (e.t === 'buff') return onBuff(e);
    return false;
  }

  // ---------- hooks into main.js objects ----------
  const baseEvent = mastery.event, baseCd = mastery.cd, baseTags = mastery.buffTags, baseSpeed = combat.speedMult;
  mastery.event = e => event(e) || baseEvent(e);
  mastery.cd = slot => baseCd(slot) * (buffOn(me(), 'anthem') ? 1 - (slot === 0 ? SONG.anthem.haste : SONG.anthem.skillHaste) : 1);
  combat.speedMult = () => baseSpeed() * (buffOn(me(), 'anthem') ? 1 + SONG.anthem.speed : 1);
  mastery.buffTags = b => {
    const now = performance.now(), mine = buffs.get(me()) || {};
    let html = baseTags(b);
    if ((mine.cresc || 0) > now) html = html.replace('>Aegis<', '>Crescendo shield<'); // the shield bit is shared with Aegis
    for (const k of ['anthem', 'march', 'cresc']) if ((mine[k] || 0) > now) html += `<span class="evo">${BUFF_NAME[k]} ${Math.ceil((mine[k] - now) / 1000)}s</span>`;
    return html;
  };

  // Auto-aim for Lancer / Bard skills (main.js useSkill): face the locked enemy, or the nearest one in range.
  function aim(skId, lockedMob, nearestMob) {
    const range = AIM[skId];
    if (!range) return;
    const lm = lockedMob();
    const t = lm && Math.hypot(lm.x - state.x, lm.z - state.z) < 14 ? lm : nearestMob(range);
    if (t) state.face = Math.atan2(t.x - state.x, t.z - state.z);
  }

  return { aim, event, buffOn, reach: LANCE.reach };
}
