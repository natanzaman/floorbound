// Floor 3 — The Gale Spires: scene construction (terraces, ruins, Windbreak Camp, the Eye of the Storm), the Storm Gate,
// the Stairway up from the Sunken Court, wind and storm atmosphere, the Storm Colossus's decorations and block models
// for Floor 3's enemies. Built alongside Floors 1 and 2 in the same scene (1200 units east). Design: docs/floor3.md.
import * as THREE from 'three';
import { OBSTACLES } from '/shared/data.js';
import { F3, GATE3, STAIRWAY3 } from '/shared/floor3.js';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.04, flatShading: true, ...opts });
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
const fade = (color, opacity, add = false) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, ...(add ? { blending: THREE.AdditiveBlending } : {}) });
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// Floor 3's sky, fog and light (floor2world.js blends it with Floors 1 and 2: ATMOS3 is its third entry).
export const ATMOS3 = { sky: 0xd8c39a, near: 60, far: 250, hemiSky: 0xffe6bf, hemiGround: 0x6b5b45, hemi: 1.05, sun: 0xffcf8a, sunI: 2.1 };
const STORM = 0x3b4256; // the sky over the Eye of the Storm

export function createFloor3(scene, { occluders = [] } = {}) {
  const X = F3.x, r = rng(303);
  const root = new THREE.Group(); root.name = 'floor3'; scene.add(root);
  const add = (o, parent = root) => { parent.add(o); return o; };
  const flat = (geo, material, y, x, z, parent = root) => {
    const m = new THREE.Mesh(geo, material);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; return add(m, parent);
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const stone = mat(0xbdb3a0), slate = mat(0x7d7a74), sand = mat(0xc9b48a);

  // the mountaintop: a sandy-stone plateau, then a cliff edge and the cloud sea far below
  const { rect } = F3;
  flat(new THREE.PlaneGeometry(rect.x1 - rect.x0 + 30, rect.z1 - rect.z0 + 46), sand, 0, X, (rect.z0 + rect.z1) / 2 + 4);
  flat(new THREE.CircleGeometry(F3.arena.r + 9, 56), mat(0xa39d92), -0.01, F3.arena.x, F3.arena.z);
  const clouds = flat(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0xfff6e4, emissive: 0x6b5a40, emissiveIntensity: 0.35, roughness: 1, flatShading: true }), -26, X, 80);
  clouds.receiveShadow = false;
  // cliff faces around the plateau (they read as the edge of the world)
  const cliffN = 120, cliffs = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0x9b8f7c), cliffN);
  for (let i = 0; i < cliffN; i++) {
    const side = i % 4, t = r();
    let x, z;
    if (side === 0) { x = rect.x0 - 14; z = rect.z0 - 22 + t * (rect.z1 - rect.z0 + 60); }
    else if (side === 1) { x = rect.x1 + 14; z = rect.z0 - 22 + t * (rect.z1 - rect.z0 + 60); }
    else if (side === 2) { x = rect.x0 - 14 + t * (rect.x1 - rect.x0 + 28); z = rect.z0 - 22; }
    else { x = rect.x0 - 14 + t * (rect.x1 - rect.x0 + 28); z = 166 + r() * 4; if (Math.abs(x - X) < 36) continue; }
    const sc = 4 + r() * 6;
    m4.compose(p.set(x, -sc * 0.9, z), q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3)), s.set(sc, sc * (1.6 + r()), sc)); cliffs.setMatrixAt(i, m4);
  }
  cliffs.castShadow = true; add(cliffs);

  // terraces: paler stone slabs stepping up the field, and the flagstone road up the middle
  for (let i = 0; i < 9; i++) {
    const z = 30 + i * 14 + r() * 4, w = 40 + r() * 50, x = X + (r() - 0.5) * 60;
    flat(new THREE.PlaneGeometry(w, 9 + r() * 4), mat(i % 2 ? 0xd2c6ac : 0xc4b693), 0.015 + i * 0.001, x, z);
  }
  flat(new THREE.PlaneGeometry(6, 134), mat(0x9d9483), 0.03, X, 84);
  const flagN = 90, flags = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.08, 1.4), mat(0xb7ad99), flagN);
  for (let i = 0; i < flagN; i++) {
    m4.compose(p.set(X + ((i % 3) - 1) * 2 + (r() - 0.5) * 0.2, 0.06, 18 + Math.floor(i / 3) * 4.5 + (r() - 0.5)), q.setFromEuler(e.set(0, (r() - 0.5) * 0.1, 0)), s.set(1, 1, 1));
    flags.setMatrixAt(i, m4);
  }
  flags.receiveShadow = true; add(flags);
  // bleached grass tufts
  const tuftN = 340, tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.25, 0.9, 4), mat(0xd9c98f), tuftN);
  for (let i = 0; i < tuftN; i++) {
    const x = rect.x0 + r() * (rect.x1 - rect.x0), z = -24 + r() * 178;
    if (Math.abs(x - X) < 4) { i--; continue; }
    m4.compose(p.set(x, 0.4, z), q.setFromEuler(e.set(0.25, r() * 6, 0.2)), s.set(1, 0.6 + r(), 1)); tufts.setMatrixAt(i, m4);
  }
  add(tufts);

  // Windbreak Camp: a stone plaza, a brazier, tents in the lee of the walls
  flat(new THREE.CircleGeometry(F3.camp.r, 48), mat(0xa8a08f), 0.02, X, 0);
  flat(new THREE.RingGeometry(F3.camp.r - 0.6, F3.camp.r, 64), mat(0xe6d3a3), 0.03, X, 0);
  const banners = [];
  for (const o of OBSTACLES) {
    if (o.x < F3.split) continue;
    if (o.kind === 'brazier') {
      const g = add(new THREE.Group()); g.position.set(o.x, 0, o.z);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.9, 8), slate), g).position.y = 0.45;
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.9, 0.35, 8, 1, true), mat(0x5b5248, { metalness: 0.5, side: THREE.DoubleSide })), g).position.y = 1.05;
      const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 7), glow(0xffb347, 0.92)), g); flame.position.y = 1.8;
      const core = add(new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.0, 6), glow(0xfff1b8)), g); core.position.y = 1.6;
      root.userData.fire = flame;
      const light = add(new THREE.PointLight(0xffa64d, 2.2, 22, 1.6), g); light.position.y = 2.4;
    } else if (o.kind === 'tent3') {
      const g = add(new THREE.Group()); g.position.set(o.x, 0, o.z); g.rotation.y = o.rot;
      const tent = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 2.4, 2.6, 3), mat(0xb4553a)), g); tent.position.y = 1.3; tent.rotation.y = Math.PI / 6;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 5), mat(0x5a4632)), g).position.y = 1.7;
      g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      occluders.push(g);
    } else if (o.kind === 'windwall') {
      const w = add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.5 + ((o.x * 7) % 3) * 0.15, 1.1), stone));
      w.position.set(o.x, 0.75, o.z); w.rotation.y = o.rot + Math.PI / 2; w.castShadow = true;
    } else if (o.kind === 'menhir') {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(1.2 * o.s, 3.6 * o.s, 0.8 * o.s), mat(0xa29a8c)));
      m.position.set(o.x, 1.7 * o.s, o.z); m.rotation.set(0.05, o.rot, (o.rot % 1 - 0.5) * 0.15); m.castShadow = true; occluders.push(m);
      if (o.s > 1.25) { // a torn banner on the tall ones
        const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4), mat(0x4b3b2a))); pole.position.set(o.x, 3.6 * o.s + 0.8, o.z);
        const cloth = add(new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9, 6, 1), fade(0xc2410c, 0.95)));
        cloth.position.set(o.x + 0.75, 3.6 * o.s + 1.5, o.z); banners.push(cloth);
      }
    } else if (o.kind === 'column') {
      const g = add(new THREE.Group()); g.position.set(o.x, 0, o.z); g.rotation.z = o.tilt;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, o.h, 10), stone), g).position.y = o.h / 2;
      add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 2.0), stone), g).position.y = 0.2;
      if (o.h > 5) add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 1.9), stone), g).position.y = o.h + 0.2;
      g.traverse(m => { if (m.isMesh) m.castShadow = true; }); occluders.push(g);
    } else if (o.kind === 'pier') {
      const g = add(new THREE.Group()); g.position.set(o.x, 0, o.z);
      add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 11, 2.6), stone), g).position.y = 5.5;
      g.traverse(m => { if (m.isMesh) m.castShadow = true; }); occluders.push(g);
    } else if (o.kind === 'pylon') {
      const g = add(new THREE.Group()); g.position.set(o.x, 0, o.z);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.3, 9, 6), slate), g).position.y = 4.5;
      const cap = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.9), glow(0x7dd3fc)), g); cap.position.y = 10.2; cap.scale.y = 1.6;
      for (const y of [3, 6]) { const band = add(new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 6, 20), glow(0x60a5fa)), g); band.rotation.x = Math.PI / 2; band.position.y = y; }
      g.userData.cap = cap; (root.userData.pylons ||= []).push(g);
      g.traverse(m => { if (m.isMesh && m.material.isMeshStandardMaterial) m.castShadow = true; });
    }
  }
  // aqueduct arches: spans over the piers, broken here and there
  for (const z of [104, 124, 144]) {
    for (const sx of [-1, 1]) {
      if ((z + sx * 7) % 3 === 0) continue; // a collapsed span
      const span = add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 21), stone)); span.position.set(X + sx * 16, 11.6, z + 10); span.castShadow = true;
      const ch = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 21), mat(0x7a8f99))); ch.position.set(X + sx * 16, 12.5, z + 10);
    }
  }

  // the Eye of the Storm: a rune-ringed plateau, broken temple walls, the storm overhead
  const A = F3.arena;
  flat(new THREE.CircleGeometry(A.r, 64), mat(0x8e8a84), 0.025, A.x, A.z);
  flat(new THREE.RingGeometry(A.r - 1.2, A.r - 0.8, 72), mat(0x93c5fd, { emissive: 0x1e40af, emissiveIntensity: 0.6 }), 0.03, A.x, A.z);
  flat(new THREE.RingGeometry(8, 8.4, 48), mat(0x6b7280), 0.03, A.x, A.z);
  for (let i = 0; i < 12; i++) { // radial cracks
    const a = (i / 12) * Math.PI * 2 + 0.1, l = 6 + (i % 3) * 3;
    const c = flat(new THREE.PlaneGeometry(0.25, l), mat(0x5b6476), 0.035, A.x + Math.sin(a) * (8.5 + l / 2), A.z + Math.cos(a) * (8.5 + l / 2)); c.rotation.z = -a;
  }
  for (let i = 0; i < 30; i++) { // temple wall stubs (open to the south)
    const a = (i / 30) * Math.PI * 2;
    if (Math.sin(a) < -0.94) continue;
    const h = 2 + ((i * 5) % 7) * 0.9;
    const w = add(new THREE.Mesh(new THREE.BoxGeometry(5.2, h, 1.3), stone));
    w.position.set(A.x + Math.cos(a) * (A.r + 1.2), h / 2, A.z + Math.sin(a) * (A.r + 1.2)); w.rotation.y = -a + Math.PI / 2; w.castShadow = true; occluders.push(w);
  }
  const storm = add(new THREE.Group()); storm.position.set(A.x, 34, A.z);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = r() * 34, sc = 6 + r() * 9;
    const c = add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: STORM, roughness: 1, flatShading: true, transparent: true, opacity: 0.92, emissive: 0x1e3a8a, emissiveIntensity: 0 })), storm);
    c.position.set(Math.sin(a) * d, (r() - 0.5) * 5, Math.cos(a) * d); c.scale.set(sc, sc * 0.45, sc);
  }
  const bolts = [];
  for (let i = 0; i < 3; i++) { const b = add(makeBolt(r), scene); b.visible = false; bolts.push(b); }

  // gate arch at the corridor mouth + the Storm Gate (a portcullis of iron and blue light)
  const arch = add(new THREE.Group()); arch.position.set(X, 0, 150);
  for (const sx of [-6, 6]) { const post = add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 10, 1.8), stone), arch); post.position.set(sx, 5, 0); }
  add(new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 2), stone), arch).position.y = 10.4;
  const sig = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.9), glow(0x7dd3fc)), arch); sig.position.y = 12.1;
  arch.traverse(m => { if (m.isMesh) m.castShadow = true; }); occluders.push(arch);
  for (const sx of [-1, 1]) { const wall = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 18), stone)); wall.position.set(X + sx * 5.9, 2, 159); wall.castShadow = true; }
  const raid = add(new THREE.Group()); raid.position.set(GATE3.x, 0, GATE3.z);
  const iron = mat(0x3a3f4a, { metalness: 0.6, roughness: 0.45 });
  for (const sx of [-1, 1]) { const post = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.6), stone), raid); post.position.set(sx * (GATE3.half + 0.7), 5, 0); occluders.push(post); }
  add(new THREE.Mesh(new THREE.BoxGeometry(GATE3.half * 2 + 2.8, 1.4, 1.8), stone), raid).position.y = 10.2;
  const bars = add(new THREE.Group(), raid);
  for (let i = 0; i < 9; i++) { const b = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 9.4, 0.22), iron), bars); b.position.set(-GATE3.half + 0.6 + i * ((GATE3.half * 2 - 1.2) / 8), 4.7, 0); }
  for (const y of [2.2, 5, 7.8]) add(new THREE.Mesh(new THREE.BoxGeometry(GATE3.half * 2, 0.22, 0.26), iron), bars).position.y = y;
  const gGlow = add(new THREE.Mesh(new THREE.PlaneGeometry(GATE3.half * 2, 9), fade(0x7dd3fc, 0.16)), bars); gGlow.position.y = 4.6;
  raid.traverse(m => { if (m.isMesh && m.material.isMeshStandardMaterial) m.castShadow = true; });
  const gate3 = {
    open: false, h: 0,
    set(open) { this.open = open; },
    update(dt) { const want = this.open ? 9.2 : 0; this.h += (want - this.h) * Math.min(1, dt * (this.open ? 1.2 : 3)); bars.position.y = this.h; gGlow.material.opacity = this.open ? 0 : 0.16 + Math.sin(performance.now() / 300) * 0.04; },
  };

  // the Stairway up to Floor 3: appears in the Sunken Court (Floor 2) for a while after a Sovereign kill
  const stair = add(new THREE.Group(), scene); stair.position.set(STAIRWAY3.x, 0, STAIRWAY3.z); stair.visible = false;
  const ringM = add(new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 40), glow(0xfde68a)), stair); ringM.position.y = 2.8;
  const disc = add(new THREE.Mesh(new THREE.CircleGeometry(2.25, 40), fade(0x7dd3fc, 0.55)), stair); disc.position.y = 2.8;
  const column = add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 30, 16, 1, true), fade(0xbfdbfe, 0.18, true)), stair); column.position.y = 15;
  for (let i = 0; i < 4; i++) { const st = add(new THREE.Mesh(new THREE.BoxGeometry(3.6 - i * 0.5, 0.25, 0.9), mat(0xe7e0cf)), stair); st.position.set(0, 0.12 + i * 0.25, 1.6 - i * 0.7); }
  const stairway = { set(v) { stair.visible = !!v; } };

  // wind: pale streaks blowing east across the plateau, and dust
  const streakN = 70, streaks = [];
  const streakGeo = new THREE.PlaneGeometry(7, 0.06);
  for (let i = 0; i < streakN; i++) {
    const m = add(new THREE.Mesh(streakGeo, fade(0xfffbeb, 0.0)));
    m.userData = { x: rect.x0 + r() * (rect.x1 - rect.x0), y: 0.6 + r() * 5, z: -20 + r() * 210, sp: 14 + r() * 12, ph: r() * 10 };
    m.rotation.y = Math.PI / 2; streaks.push(m);
  }
  const dustN = 220, dp = new Float32Array(dustN * 3), seeds = [];
  for (let i = 0; i < dustN; i++) seeds.push([rect.x0 + r() * (rect.x1 - rect.x0), -20 + r() * 220, r() * 6.28, 0.3 + r() * 4]);
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff0c8, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false })));
  dust.frustumCulled = false;

  let time = 0, flashT = 3;
  function update(dt, onF3, stormy = 0) {
    time += dt;
    gate3.update(dt);
    root.visible = onF3;
    if (stair.visible) { ringM.rotation.z += dt * 0.6; disc.material.opacity = 0.45 + Math.sin(time * 3) * 0.12; column.material.opacity = 0.14 + Math.sin(time * 2) * 0.05; }
    if (!onF3) return;
    const fire = root.userData.fire; if (fire) fire.scale.set(1 + Math.sin(time * 11) * 0.1, 1 + Math.sin(time * 8) * 0.18, 1);
    for (const b of banners) { b.rotation.y = Math.sin(time * 6 + b.position.z) * 0.35; b.scale.x = 1 + Math.sin(time * 9 + b.position.x) * 0.08; }
    for (const m of streaks) {
      const u = m.userData, k = ((time * u.sp + u.ph * 20) % 260) / 260;
      m.position.set(rect.x0 - 20 + k * (rect.x1 - rect.x0 + 40), u.y, u.z);
      m.material.opacity = Math.sin(k * Math.PI) * 0.22;
    }
    for (let i = 0; i < dustN; i++) {
      const [x, z, ph, h] = seeds[i];
      dp[i * 3] = rect.x0 + (((x - rect.x0) + time * 6 + ph * 3) % (rect.x1 - rect.x0)); dp[i * 3 + 1] = h + Math.sin(time * 1.3 + ph) * 0.3; dp[i * 3 + 2] = z + Math.sin(time * 0.4 + ph) * 1.5;
    }
    dustGeo.attributes.position.needsUpdate = true;
    storm.rotation.y += dt * (0.03 + stormy * 0.12);
    for (const g of root.userData.pylons || []) { const c = g.userData.cap; c.rotation.y += dt * (1 + stormy * 4); c.material.color.setHex(stormy > 0.5 && Math.sin(time * 20 + g.position.x) > 0.6 ? 0xffffff : 0x7dd3fc); }
    // distant lightning in the storm over the summit (more of it while the Colossus fights)
    flashT -= dt;
    for (const b of bolts) if (b.visible && (b.userData.life -= dt) <= 0) b.visible = false;
    if (flashT <= 0) {
      flashT = stormy ? 0.6 + Math.random() * 1.6 : 3 + Math.random() * 5;
      const b = bolts.find(b => !b.visible);
      if (b) { const a = Math.random() * 6.28, d = 10 + Math.random() * 22; b.position.set(A.x + Math.sin(a) * d, 0, A.z + Math.cos(a) * d); b.rotation.y = Math.random() * 6; b.visible = true; b.userData.life = 0.12; }
      for (const c of storm.children) c.material.emissiveIntensity = 0.9;
    } else for (const c of storm.children) c.material.emissiveIntensity *= 0.85;
  }

  return { root, gate3, stairway, update };
}

// A jagged lightning bolt from the clouds (the summit's storm, and the Colossus's strikes).
export function makeBolt(r = Math.random, h = 34, color = 0xdbeafe) {
  const pts = [], n = 9;
  for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(i && i < n ? (r() - 0.5) * 2.4 : 0, h * (1 - i / n), i && i < n ? (r() - 0.5) * 2.4 : 0));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 24, 0.16, 5), glow(color)));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 24, 0.55, 5), fade(0x93c5fd, 0.35, true)));
  return g;
}

// ---------- the Storm Colossus's wind-up poses (merged into world.js POSES / WINDUPS) ----------
// Angles as in world.js: [pitch, yaw, roll] per bone, in the model's frame; drop lowers the hips.
export const F3_POSES = {
  gustBack: { drop: 0.04, hips: [0, 30, 0], spine: [-4, 28, 0], chest: [-6, 32, 0], head: [-6, -55, 0], // sword drawn far back, wind gathering
    'upperarm.r': [40, 50, 50], 'lowerarm.r': [-35, 0, 0], 'upperarm.l': [-70, -30, -30], 'lowerarm.l': [-20, 0, 0],
    'upperleg.l': [-30, 0, 0], 'lowerleg.l': [35, 0, 0], 'upperleg.r': [12, 0, 0] },
  gustHit: { hips: [6, -25, 0], spine: [8, -25, 0], chest: [6, -28, 0], head: [6, 30, 0], // the sweep through
    'upperarm.r': [-80, -40, 30], 'lowerarm.r': [-10, 0, 0], 'upperarm.l': [-30, 20, -40] },
  overload: { drop: 0.1, spine: [-6, 0, 0], chest: [-8, 0, 0], head: [-25, 0, 0], // on one knee, the sword raised high to the storm
    'upperleg.l': [-88, 0, 0], 'lowerleg.l': [88, 0, 0], 'upperleg.r': [5, 0, 0], 'lowerleg.r': [85, 0, 0], 'foot.r': [-20, 0, 0],
    'upperarm.r': [-165, 0, 10], 'lowerarm.r': [-10, 0, 0], 'upperarm.l': [-160, 0, -10], 'lowerarm.l': [-10, 0, 0], 'hand.r': [-20, 0, 0] },
  clap: { drop: 0.1, hips: [18, 0, 0], spine: [16, 0, 0], chest: [12, 0, 0], head: [10, 0, 0], // the sword brought down into the ground
    'upperleg.l': [-60, 0, 0], 'lowerleg.l': [70, 0, 0], 'upperleg.r': [-10, 0, 0], 'lowerleg.r': [70, 0, 0],
    'upperarm.r': [-60, 0, 10], 'lowerarm.r': [-20, 0, 0], 'upperarm.l': [-55, 0, -10], 'lowerarm.l': [-20, 0, 0], 'hand.r': [60, 0, 0] },
  plant: { drop: 0.07, hips: [10, 0, 0], spine: [10, 0, 0], chest: [8, 0, 0], head: [-6, 0, 0], // sword planted point-down in front, both hands on the hilt
    'upperleg.l': [-30, 0, -8], 'lowerleg.l': [40, 0, 0], 'upperleg.r': [-30, 0, 8], 'lowerleg.r': [40, 0, 0],
    'upperarm.r': [-55, 0, 25], 'lowerarm.r': [-35, 0, 0], 'upperarm.l': [-55, 0, -25], 'lowerarm.l': [-35, 0, 0], 'hand.r': [80, 0, 0] },
  skyArm: { spine: [-6, -10, 0], chest: [-8, -12, 0], head: [-28, 0, 0], // the free hand raised to the sky (calling lightning)
    'upperarm.l': [-170, 0, -15], 'lowerarm.l': [-5, 0, 0], 'upperarm.r': [-20, 0, 20] },
};
export const F3_WINDUPS = {
  gust: { up: 'gustBack', hit: 'gustHit', hold: 0.35 },
  overload: { up: 'overload', hold: 30 }, // held until the Overload ends (floor3client cancels it)
  clap: { up: 'overload', hit: 'clap', hold: 0.6 },
  beam: { up: 'plant', hold: 30 }, // held through the sweep (floor3client cancels it)
  strike: { up: 'skyArm', hold: 0.3 },
};

// Extra pieces for the rigged Colossus: blue lightning veins, a storm crown, a glowing edge on the greatsword.
export function decorateColossus(root, height) {
  const out = [];
  const ws = new THREE.Vector3();
  root.updateMatrixWorld(true);
  const veinMat = glow(0x7dd3fc);
  const onBone = (name, build) => {
    const b = root.getObjectByName(name);
    if (!b) return;
    b.getWorldScale(ws);
    const g = build(); g.scale.setScalar((1 / ws.x) * (height / 7.2)); b.add(g);
  };
  onBone('head', () => {
    const crown = new THREE.Group();
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, i % 2 ? 0.55 : 0.9, 4), veinMat); sp.position.set(Math.cos(a) * 0.62, 1.05 + (i % 2 ? 0 : 0.15), Math.sin(a) * 0.62); sp.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); crown.add(sp); }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 6, 32), veinMat); halo.rotation.x = Math.PI / 2; halo.position.y = 1.0; crown.add(halo);
    return crown;
  });
  for (const bone of ['chest', 'upperarmr', 'upperarml', 'lowerarmr', 'lowerarml', 'upperlegl', 'upperlegr']) {
    onBone(bone, () => {
      const g = new THREE.Group(), rr = rng(bone.length * 31);
      for (let i = 0; i < 3; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55 + rr() * 0.4, 0.05), veinMat); v.position.set((rr() - 0.5) * 0.5, -0.2 - rr() * 0.4, 0.28 + rr() * 0.05); v.rotation.z = (rr() - 0.5) * 1.2; g.add(v); }
      return g;
    });
  }
  const sword = root.getObjectByName('2H_Sword');
  if (sword) { sword.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(0xcbd5e1); o.material.emissive?.setHex(0x1d4ed8); if (o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = 0.5; out.push(o.material); } }); }
  return out;
}

// ---------- block models for Floor 3's enemies ----------
// Same shape as world.js makeBlockMob's result: { group, body, legs, armR, cursor, mats, height }. `fly` (harpies) is
// the group floor3client lifts while the harpy is aloft.
function part(geo, material, x, y, z, parent) {
  const m = new THREE.Mesh(geo, typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}

export function makeF3Mob(type) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const legs = [];
  let height = 1.8, armR = null, fly = null;
  const eyes = (head, color, pts, size = 0.06) => { for (const [x, y, z] of pts) part(new THREE.SphereGeometry(size, 6, 4), glow(color), x, y, z, head); };

  if (type === 'ram') { // a shaggy mountain ram with great curled horns
    part(new THREE.BoxGeometry(1.3, 1.0, 2.0), 0xe7dcc6, 0, 1.0, 0, body);
    part(new THREE.BoxGeometry(1.4, 0.4, 1.6), 0xd6c9ae, 0, 1.55, -0.1, body);
    const head = part(new THREE.BoxGeometry(0.62, 0.7, 0.8), 0x8a7a63, 0, 1.3, 1.2, body);
    eyes(head, 0xfbbf24, [[-0.26, 0.12, 0.3], [0.26, 0.12, 0.3]]);
    for (const sx of [-1, 1]) {
      const horn = part(new THREE.TorusGeometry(0.34, 0.12, 6, 12, Math.PI * 1.5), 0x5c4a36, sx * 0.42, 0.22, -0.05, head);
      horn.rotation.set(0, sx * Math.PI / 2, 0);
    }
    for (const [x, z] of [[-0.45, 0.7], [0.45, 0.7], [-0.45, -0.7], [0.45, -0.7]]) legs.push(part(new THREE.BoxGeometry(0.26, 0.8, 0.26), 0x5c4a36, x, 0.4, z, body));
    height = 2.0;
  } else if (type === 'harpy' || type === 'skyrender') { // a winged hunter of the high winds (Skyrender: bigger, storm-dark)
    const big = type === 'skyrender', feath = big ? 0x3b3f63 : 0xb08a5a, skin = big ? 0x6b6fa0 : 0xd9b38c;
    fly = new THREE.Group(); body.add(fly);
    part(new THREE.SphereGeometry(0.5, 10, 8), feath, 0, 0, 0, fly).scale.set(1, 1.2, 0.9);
    const head = part(new THREE.SphereGeometry(0.28, 10, 8), skin, 0, 0.72, 0.15, fly);
    eyes(head, big ? 0x7dd3fc : 0xfde047, [[-0.1, 0.03, 0.24], [0.1, 0.03, 0.24]], 0.05);
    part(new THREE.ConeGeometry(0.08, 0.3, 4), 0xf59e0b, 0, 0.66, 0.42, fly).rotation.x = Math.PI / 2;
    const wings = [];
    for (const sx of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(sx * 0.4, 0.3, -0.05); fly.add(w);
      const blade = part(new THREE.BoxGeometry(1.6, 0.08, 0.7), feath, sx * 0.8, 0, 0, w); blade.rotation.z = sx * 0.1;
      part(new THREE.BoxGeometry(1.0, 0.06, 0.45), big ? 0x7dd3fc : 0xe7c79a, sx * 1.5, -0.02, -0.15, w);
      wings.push(w);
    }
    for (const sx of [-0.18, 0.18]) part(new THREE.ConeGeometry(0.07, 0.5, 4), 0x4b3b2a, sx, -0.62, 0.05, fly).rotation.x = Math.PI;
    fly.userData.wings = wings; fly.position.y = 1.2;
    if (big) { body.scale.setScalar(1.6); }
    height = big ? 3.4 : 2.2;
  } else if (type === 'acolyte') { // a robed storm-caller with a staff and a floating sigil
    part(new THREE.ConeGeometry(0.6, 1.6, 8), 0x1e3a8a, 0, 0.8, 0, body);
    part(new THREE.BoxGeometry(0.6, 0.6, 0.4), 0x1e40af, 0, 1.75, 0, body);
    const head = part(new THREE.ConeGeometry(0.3, 0.6, 6), 0x172554, 0, 2.3, 0, body);
    eyes(head, 0x7dd3fc, [[-0.08, -0.08, 0.2], [0.08, -0.08, 0.2]], 0.045);
    armR = new THREE.Group(); armR.position.set(0.42, 1.85, 0.05); body.add(armR);
    part(new THREE.BoxGeometry(0.16, 0.7, 0.16), 0x1e40af, 0, -0.3, 0, armR);
    part(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5), 0x6b5a45, 0, -0.3, 0.15, armR);
    const orb = part(new THREE.OctahedronGeometry(0.17), glow(0x93c5fd), 0, 0.85, 0.15, armR);
    orb.castShadow = false;
    const sigil = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 4, 6), glow(0x7dd3fc)); sigil.position.set(0, 2.9, 0); body.add(sigil);
    body.userData.sigil = sigil;
    height = 3.0;
  } else if (type === 'sentinel' || type === 'bastion') { // a stone guardian in plated armour (the Old Bastion: bigger, mossy, gilded)
    const big = type === 'bastion', rock = big ? 0x6f7563 : 0x9a9488, plate = big ? 0xa8892e : 0x6b7280;
    for (const sx of [-0.4, 0.4]) legs.push(part(new THREE.BoxGeometry(0.55, 1.0, 0.6), rock, sx, 0.5, 0, body));
    part(new THREE.BoxGeometry(1.6, 1.3, 1.0), rock, 0, 1.65, 0, body);
    const shell = part(new THREE.BoxGeometry(1.85, 1.1, 1.2), plate, 0, 1.75, 0.02, body); shell.material.metalness = 0.5;
    body.userData.shell = shell;
    const head = part(new THREE.BoxGeometry(0.6, 0.55, 0.6), rock, 0, 2.6, 0.05, body);
    eyes(head, 0x7dd3fc, [[-0.15, 0.04, 0.31], [0.15, 0.04, 0.31]], 0.06);
    const cracks = new THREE.Group(); body.add(cracks); cracks.visible = false; body.userData.cracks = cracks;
    for (let i = 0; i < 5; i++) { const c = part(new THREE.BoxGeometry(0.06, 0.7, 0.04), glow(0xfbbf24), -0.7 + i * 0.35, 1.75, 0.64, cracks); c.rotation.z = (i % 2 ? 1 : -1) * 0.5; c.castShadow = false; }
    armR = new THREE.Group(); armR.position.set(1.05, 2.1, 0); body.add(armR);
    part(new THREE.BoxGeometry(0.45, 1.2, 0.45), rock, 0, -0.5, 0, armR);
    part(new THREE.BoxGeometry(0.6, 0.5, 0.6), plate, 0, -1.2, 0, armR);
    const armL = new THREE.Group(); armL.position.set(-1.05, 2.1, 0); body.add(armL);
    part(new THREE.BoxGeometry(0.45, 1.2, 0.45), rock, 0, -0.5, 0, armL);
    part(new THREE.BoxGeometry(0.6, 0.5, 0.6), plate, 0, -1.2, 0, armL);
    if (big) { for (let i = 0; i < 6; i++) part(new THREE.BoxGeometry(0.4, 0.12, 0.4), 0x4d7c0f, -0.7 + i * 0.28, 2.33, (i % 2 - 0.5) * 0.6, body); body.scale.setScalar(1.45); }
    height = big ? 4.3 : 3.0;
  } else { // the Storm Colossus (block fallback when the rigged models fail to load)
    const sc = 2.8;
    for (const sx of [-0.25, 0.25]) legs.push(part(new THREE.BoxGeometry(0.3 * sc, 1.0 * sc, 0.32 * sc), 0x8b8f99, sx * sc, 0.5 * sc, 0, body));
    part(new THREE.BoxGeometry(1.0 * sc, 1.0 * sc, 0.6 * sc), 0x9ca3af, 0, 1.5 * sc, 0, body);
    const head = part(new THREE.BoxGeometry(0.45 * sc, 0.45 * sc, 0.45 * sc), 0xa8adb6, 0, 2.25 * sc, 0, body);
    eyes(head, 0x7dd3fc, [[-0.1 * sc, 0.03 * sc, 0.23 * sc], [0.1 * sc, 0.03 * sc, 0.23 * sc]], 0.07 * sc);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; part(new THREE.ConeGeometry(0.06 * sc, 0.35 * sc, 4), glow(0x7dd3fc), Math.cos(a) * 0.2 * sc, 0.33 * sc, Math.sin(a) * 0.2 * sc, head); }
    armR = new THREE.Group(); armR.position.set(0.65 * sc, 1.9 * sc, 0); body.add(armR);
    part(new THREE.BoxGeometry(0.28 * sc, 0.9 * sc, 0.28 * sc), 0x9ca3af, 0, -0.4 * sc, 0, armR);
    part(new THREE.BoxGeometry(0.12 * sc, 2.0 * sc, 0.05 * sc), glow(0xbfdbfe), 0, -1.1 * sc, 0.8 * sc, armR).rotation.x = Math.PI / 2;
    height = 7.2;
  }
  const cursor = new THREE.Mesh(new THREE.OctahedronGeometry(type === 'colossus' ? 0.3 : 0.14), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.2; g.add(cursor);
  const mats = [];
  g.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) mats.push(o.material); });
  return { group: g, body, legs, armR, cursor, mats, height, fly, baseHeight: height };
}

