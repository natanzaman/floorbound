// Floor 2 — The Glimmering Mire: scene construction, the waypoint glows and the Stairway, atmosphere, and block models
// for Floor 2's enemies. Built alongside Floor 1 in the same scene (600 units east).
import * as THREE from 'three';
import { OBSTACLES } from '/shared/data.js';
import { F2, GATE2, WAYPOINTS, STAIRWAY, SOVEREIGN } from '/shared/floor2.js';
import { ATMOS3 } from '/floor3world.js';
import { Q } from '/quality.js'; // graphics quality (effect density)

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...opts });
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// Sky, fog and light for each floor (Floor 1's values match createWorld in world.js).
const ATMOS = [
  { sky: 0x9cc9ee, near: 70, far: 230, hemiSky: 0xdbeaff, hemiGround: 0x3b5d2a, hemi: 1.1, sun: 0xfff1d6, sunI: 1.9 },
  { sky: 0x31454f, near: 22, far: 150, hemiSky: 0x9fd6e0, hemiGround: 0x1d2b22, hemi: 0.95, sun: 0xb9d4ff, sunI: 1.15 },
  ATMOS3, // Floor 3 (floor3world.js)
];

export function createFloor2(scene, { sun, occluders = [] } = {}) {
  const X = F2.x, r = rng(77);
  const root = new THREE.Group(); root.name = 'floor2'; scene.add(root);
  const add = (o, parent = root) => { parent.add(o); return o; };
  const flat = (geo, material, y, x, z) => {
    const m = new THREE.Mesh(geo, material);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; return add(m);
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();

  // ground, boardwalk, camp plaza, corridor and court floors
  flat(new THREE.PlaneGeometry(330, 360), mat(0x34463a), 0, X, 70);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f5f5c, emissive: 0x0c3b3a, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.35, transparent: true, opacity: 0.82 });
  const puddles = [];
  for (let i = 0; i < 46; i++) {
    const x = F2.rect.x0 + r() * (F2.rect.x1 - F2.rect.x0), z = 22 + r() * 132;
    if (Math.abs(x - X) < 5) continue;
    puddles.push([x, z, 2.5 + r() * 6.5, 0.6 + r() * 0.5]);
  }
  const water = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20), waterMat, puddles.length);
  puddles.forEach(([x, z, rad, sq], i) => { m4.compose(p.set(x, 0.03, z), q.setFromEuler(e.set(-Math.PI / 2, 0, r() * 6)), s.set(rad, rad * sq, 1)); water.setMatrixAt(i, m4); });
  water.receiveShadow = true; add(water);
  flat(new THREE.PlaneGeometry(5.4, 134), mat(0x5a4632), 0.04, X, 84);
  const plankN = 64, planks = new THREE.InstancedMesh(new THREE.BoxGeometry(6.2, 0.1, 0.7), mat(0x6e553a), plankN);
  for (let i = 0; i < plankN; i++) { m4.compose(p.set(X + (r() - 0.5) * 0.2, 0.07, 18 + i * 2.06), q.setFromEuler(e.set(0, (r() - 0.5) * 0.06, 0)), s.set(1, 1, 1)); planks.setMatrixAt(i, m4); }
  planks.receiveShadow = true; add(planks);
  flat(new THREE.CircleGeometry(F2.camp.r, 48), mat(0x56605a), 0.02, X, 0);
  flat(new THREE.RingGeometry(F2.camp.r - 0.6, F2.camp.r, 64), mat(0x8fb8a8), 0.03, X, 0);
  flat(new THREE.PlaneGeometry(10, 22), mat(0x3c4a4a), 0.02, X, 158);
  flat(new THREE.CircleGeometry(F2.arena.r, 56), mat(0x2b3a3c), 0.025, F2.arena.x, F2.arena.z);
  flat(new THREE.RingGeometry(SOVEREIGN.deluge.r - 0.3, SOVEREIGN.deluge.r, 64), mat(0x5eead4, { emissive: 0x115e59, emissiveIntensity: 0.8 }), 0.03, F2.arena.x, F2.arena.z);
  flat(new THREE.RingGeometry(6, 6.4, 48), mat(0x4b6b66), 0.03, F2.arena.x, F2.arena.z);

  // camp: crystal lamps, campfire, tents
  const lampN = 12;
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 2.4, 6), mat(0x3a3128), lampN);
  const lamps = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.32), glow(0x7dfcf0), lampN);
  for (let i = 0; i < lampN; i++) {
    const a = (i / lampN) * Math.PI * 2 + 0.13, x = X + Math.cos(a) * (F2.camp.r - 1.2), z = Math.sin(a) * (F2.camp.r - 1.2);
    m4.compose(p.set(x, 1.2, z), q.identity(), s.set(1, 1, 1)); posts.setMatrixAt(i, m4);
    m4.compose(p.set(x, 2.65, z), q.identity(), s.set(1, 1.5, 1)); lamps.setMatrixAt(i, m4);
  }
  posts.castShadow = true; add(posts); add(lamps);
  for (const o of OBSTACLES) {
    if (o.kind === 'campfire') {
      const g = add(new THREE.Group()); g.position.set(o.x, 0, o.z);
      for (let i = 0; i < 5; i++) { const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.6, 6), mat(0x4a3424)), g); l.rotation.set(Math.PI / 2 - 0.3, (i / 5) * Math.PI * 2, 0); l.position.y = 0.3; }
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.22, 6, 14), mat(0x6b7280)), g); ring.rotation.x = Math.PI / 2; ring.position.y = 0.12;
      const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 7), glow(0x5eead4, 0.9)), g); flame.position.y = 0.95; g.userData.flame = flame;
      root.userData.fire = flame;
    } else if (o.kind === 'tent') {
      const g = add(new THREE.Group()); g.position.set(o.x, 0, o.z); g.rotation.y = o.rot;
      const tent = add(new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.8, 4), mat(0x2f6d6a)), g); tent.position.y = 1.4; tent.rotation.y = Math.PI / 4;
      const flap = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.05), mat(0x1c3f3d)), g); flap.position.set(0, 0.65, 1.42); flap.rotation.x = -0.45;
      g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      occluders.push(g);
    }
  }

  // dead trees (field + a border around the mire) and glowing crystal clusters
  const dead = OBSTACLES.filter(o => o.kind === 'deadtree').map(o => ({ ...o }));
  for (let i = 0; i < 170; i++) {
    const side = i % 4, t = r();
    let x, z;
    if (side === 0) { x = F2.rect.x0 - 4 - r() * 26; z = -36 + t * 196; }
    else if (side === 1) { x = F2.rect.x1 + 4 + r() * 26; z = -36 + t * 196; }
    else if (side === 2) { x = F2.rect.x0 - 10 + t * 156; z = F2.rect.z0 - 4 - r() * 22; }
    else { x = F2.rect.x0 - 10 + t * 156; z = 163 + r() * 22; if (Math.abs(x - X) < 34) continue; }
    dead.push({ x, z, s: 1 + r() * 0.9, rot: r() * 6.28 });
  }
  const barkMat = mat(0x3b332c);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.42, 5, 6), barkMat, dead.length);
  const branchA = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.13, 2.4, 5), barkMat, dead.length);
  const branchB = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.11, 1.8, 5), barkMat, dead.length);
  const moss = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.4, 5, 1, true), new THREE.MeshStandardMaterial({ color: 0x5f7f4a, flatShading: true, side: THREE.DoubleSide }), dead.length);
  const rq = new THREE.Quaternion(), tmp = new THREE.Matrix4();
  dead.forEach((t, i) => {
    const sc = t.s || 1;
    rq.setFromEuler(e.set(0, t.rot || 0, (i % 3 - 1) * 0.06));
    const base = new THREE.Matrix4().compose(p.set(t.x, 0, t.z), rq, s.set(sc, sc, sc));
    trunks.setMatrixAt(i, tmp.multiplyMatrices(base, m4.makeTranslation(0, 2.5, 0)));
    branchA.setMatrixAt(i, tmp.multiplyMatrices(base, m4.compose(p.set(0.55, 3.6, 0), q.setFromEuler(e.set(0, 0, -0.9)), s.set(1, 1, 1))));
    branchB.setMatrixAt(i, tmp.multiplyMatrices(base, m4.compose(p.set(-0.4, 4.2, 0.2), q.setFromEuler(e.set(0.3, 0, 0.8)), s.set(1, 1, 1))));
    moss.setMatrixAt(i, tmp.multiplyMatrices(base, m4.compose(p.set(0.95, 3.2, 0), q.identity(), s.set(0.7, 1, 0.7))));
  });
  for (const im of [trunks, branchA, branchB, moss]) { im.castShadow = true; add(im); }
  const crystals = OBSTACLES.filter(o => o.kind === 'crystal');
  const shardGeo = new THREE.OctahedronGeometry(0.5);
  const shards = new THREE.InstancedMesh(shardGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), crystals.length * 3);
  const cc = new THREE.Color();
  crystals.forEach((o, i) => {
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + o.hue * 6, d = k ? 0.55 : 0, h = (k ? 1.3 : 2.1) * o.s;
      m4.compose(p.set(o.x + Math.cos(a) * d, h * 0.45, o.z + Math.sin(a) * d), q.setFromEuler(e.set((k ? 0.35 : 0) * Math.cos(a), a, (k ? 0.35 : 0) * Math.sin(a))), s.set(0.55 * o.s, h, 0.55 * o.s));
      shards.setMatrixAt(i * 3 + k, m4);
      shards.setColorAt(i * 3 + k, cc.setHSL(o.hue < 0.6 ? 0.47 + o.hue * 0.06 : 0.74 + (o.hue - 0.6) * 0.1, 0.85, k ? 0.6 : 0.68));
    }
  });
  add(shards);

  // the Sunken Court: walls (open to the south), broken pillars, a drowned throne
  const wallMat = mat(0x2e3b38), A = F2.arena;
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2;
    if (Math.sin(a) < -0.96) continue; // opening toward the corridor
    const w = add(new THREE.Mesh(new THREE.BoxGeometry(4.3, 6 + ((i * 7) % 5) * 0.6, 1.2), wallMat));
    w.position.set(A.x + Math.cos(a) * (A.r + 0.8), 3, A.z + Math.sin(a) * (A.r + 0.8));
    w.rotation.y = -a + Math.PI / 2; w.castShadow = true; occluders.push(w);
  }
  for (const o of OBSTACLES.filter(o => o.kind === 'mpillar')) {
    const pil = add(new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.55, o.h, 8), mat(0x435452)));
    pil.position.set(o.x, o.h / 2, o.z); pil.rotation.z = 0.05; pil.castShadow = true; occluders.push(pil);
    const cap = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.45), glow(0x5eead4)));
    cap.position.set(o.x, o.h + 0.6, o.z);
  }
  const throne = add(new THREE.Group()); throne.position.set(A.x, 0, A.z + A.r - 3.2);
  const tStone = mat(0x3f5552);
  add(new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 3), tStone), throne).position.y = 0.4;
  add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 2.4), tStone), throne).position.y = 1.4;
  const back = add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 6, 0.8), tStone), throne); back.position.set(0, 4, 1);
  for (const sx of [-1.2, 0, 1.2]) { const sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.35, sx ? 1.6 : 2.4, 5), glow(0x5eead4)), throne); sp.position.set(sx, 7.4 + (sx ? 0 : 0.4), 1); }
  throne.rotation.y = Math.PI; throne.traverse(m => { if (m.isMesh) m.castShadow = true; });

  // gate arch at the corridor mouth + the Sunken Gate portcullis
  const arch = add(new THREE.Group()); arch.position.set(X, 0, 150);
  for (const sx of [-6, 6]) { const post = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), wallMat), arch); post.position.set(sx, 4.5, 0); }
  add(new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 1.8), wallMat), arch).position.y = 9.4;
  const sig = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.8), glow(0x2dd4bf)), arch); sig.position.y = 11;
  arch.traverse(m => { if (m.isMesh) m.castShadow = true; }); occluders.push(arch);
  const raid = add(new THREE.Group()); raid.position.set(GATE2.x, 0, GATE2.z);
  const iron = mat(0x23302f, { metalness: 0.6, roughness: 0.5 });
  for (const sx of [-1, 1]) { const post = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.6), wallMat), raid); post.position.set(sx * (GATE2.half + 0.7), 5, 0); occluders.push(post); }
  add(new THREE.Mesh(new THREE.BoxGeometry(GATE2.half * 2 + 2.8, 1.4, 1.8), wallMat), raid).position.y = 10.2;
  const bars = add(new THREE.Group(), raid);
  for (let i = 0; i < 9; i++) { const b = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 9.4, 0.22), iron), bars); b.position.set(-GATE2.half + 0.6 + i * ((GATE2.half * 2 - 1.2) / 8), 4.7, 0); }
  for (const y of [2.2, 5, 7.8]) add(new THREE.Mesh(new THREE.BoxGeometry(GATE2.half * 2, 0.22, 0.26), iron), bars).position.y = y;
  const gGlow = add(new THREE.Mesh(new THREE.PlaneGeometry(GATE2.half * 2, 9), new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })), bars);
  gGlow.position.y = 4.6;
  raid.traverse(m => { if (m.isMesh) m.castShadow = true; });
  const gate2 = {
    open: false, h: 0,
    set(open) { this.open = open; },
    update(dt) { const want = this.open ? 9.2 : 0; this.h += (want - this.h) * Math.min(1, dt * (this.open ? 1.2 : 3)); bars.position.y = this.h; gGlow.material.opacity = this.open ? 0 : 0.14; },
  };

  // the Deluge: water over the outer court in phase 3
  const deluge = flat(new THREE.RingGeometry(SOVEREIGN.deluge.r, A.r + 0.4, 64, 1), new THREE.MeshStandardMaterial({ color: 0x2a8a86, emissive: 0x0f4f4c, emissiveIntensity: 0.7, transparent: true, opacity: 0, roughness: 0.1, metalness: 0.3, depthWrite: false }), 0.22, A.x, A.z);
  deluge.userData.k = 0;

  // waypoints: each town's centrepiece (fountain, campfire, brazier; modelled with its floor) gets a soft glow that reads
  // as "usable": an additive ring on the ground round it, a faint circle where its reach ends, and a halo at its light.
  // No extra lights. In the scene (not root) so Floor 1's shows too.
  const HALO_Y = { fountain: 4.1, campfire: 1.0, brazier: 1.9 }; // (the fountain's crystal, the flames)
  const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const waypoints = WAYPOINTS.map(w => {
    const g = add(new THREE.Group(), scene); g.position.set(w.x, 0, w.z);
    const color = ({ 2: 0x5eead4, 3: 0xfcd34d })[w.floor] || 0x93c5fd;
    const ring = add(new THREE.Mesh(new THREE.RingGeometry(w.r + 0.3, w.r + 0.8, 48, 1), additive(color, 0.4)), g); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    const reach = add(new THREE.Mesh(new THREE.RingGeometry(w.use - 0.08, w.use, 64, 1), additive(color, 0.18)), g); reach.rotation.x = -Math.PI / 2; reach.position.y = 0.05;
    const halo = add(new THREE.Mesh(new THREE.SphereGeometry(w.kind === 'fountain' ? 1.0 : 0.9, 14, 10), additive(color, 0.16)), g); halo.position.y = HALO_Y[w.kind] ?? 2;
    return { ...w, g, ring, reach, halo, k: 0 };
  });
  const stair = add(new THREE.Group(), scene); stair.position.set(STAIRWAY.x, 0, STAIRWAY.z); stair.visible = false;
  const ringM = add(new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 40), glow(0xfde68a)), stair); ringM.position.y = 2.8;
  const disc = add(new THREE.Mesh(new THREE.CircleGeometry(2.25, 40), new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })), stair); disc.position.y = 2.8;
  const column = add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 30, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x99f6e4, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })), stair); column.position.y = 15;
  const steps = add(new THREE.Group(), stair);
  for (let i = 0; i < 4; i++) { const st = add(new THREE.Mesh(new THREE.BoxGeometry(3.6 - i * 0.5, 0.25, 0.9), mat(0xd6d3c4)), steps); st.position.set(0, 0.12 + i * 0.25, 1.6 - i * 0.7); }
  const stairway = {
    left: 0,
    set(v) { this.left = v ? v[2] : 0; stair.visible = !!v; },
  };

  // fireflies / will-o-motes drifting over the mire
  const motesN = 260, mp = new Float32Array(motesN * 3), seeds = [];
  for (let i = 0; i < motesN; i++) { const x = F2.rect.x0 + r() * (F2.rect.x1 - F2.rect.x0), z = -10 + r() * 230; seeds.push([x, z, r() * 6.28, 0.6 + r() * 2.2]); }
  const motesGeo = new THREE.BufferGeometry(); motesGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = add(new THREE.Points(motesGeo, new THREE.PointsMaterial({ color: 0xa7f3d0, size: 0.32, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })));
  motes.frustumCulled = false;

  // atmosphere switching (Floor 1 <-> Floor 2), eased so a warp fades the mist in
  const hemi = scene.children.find(o => o.isHemisphereLight);
  // cur.k: how far into Floor 2's look, cur.k3: into Floor 3's (Floor 1 is the rest); a warp eases from one to the next
  const cur = { k: 0, k3: 0 }, c1 = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();
  const mix = (key, k, k3, out) => out.set(c1.setHex(ATMOS[0][key]).multiplyScalar(1 - k - k3).add(c2.setHex(ATMOS[1][key]).multiplyScalar(k)).add(c3.setHex(ATMOS[2][key]).multiplyScalar(k3)));
  const num = (key, k, k3) => ATMOS[0][key] * (1 - k - k3) + ATMOS[1][key] * k + ATMOS[2][key] * k3;
  function setAtmosphere(k, k3 = cur.k3) {
    if (scene.background?.isColor) mix('sky', k, k3, scene.background);
    if (scene.fog) { mix('sky', k, k3, scene.fog.color); scene.fog.near = num('near', k, k3); scene.fog.far = num('far', k, k3); }
    if (hemi) { mix('hemiSky', k, k3, hemi.color); mix('hemiGround', k, k3, hemi.groundColor); hemi.intensity = num('hemi', k, k3); }
    if (sun) { mix('sun', k, k3, sun.color); sun.intensity = num('sunI', k, k3); }
  }

  let time = 0;
  // wp: { near: the waypoint you're in reach of (or null), calm: Reduce motion (no pulsing), lit: per waypoint 0-1
  //       (0: dormant, no glow at all; public/wellwake.js fades a waking one up), flare: per waypoint 0-1 (the burst of
  //       light as it wakes) }
  function update(dt, onF2, deluged, onF3 = false, wp = {}) {
    time += dt;
    const want = onF2 ? 1 : 0, want3 = onF3 ? 1 : 0;
    if (Math.abs(cur.k - want) > 0.001 || Math.abs(cur.k3 - want3) > 0.001) {
      for (const [key, w] of [['k', want], ['k3', want3]]) { cur[key] += (w - cur[key]) * Math.min(1, dt * 2.5); if (Math.abs(cur[key] - w) < 0.01) cur[key] = w; }
      setAtmosphere(cur.k, cur.k3);
    }
    gate2.update(dt);
    root.visible = cur.k > 0.02 || onF2; // skip drawing the Mire from Floor 1
    waypoints.forEach((w, i) => { // brighter while you're in reach; a slow breathe unless Reduce motion is on
      const lit = wp.lit ? wp.lit[i] ?? 1 : 1, fl = wp.flare?.[i] || 0;
      w.g.visible = lit > 0.005;
      if (!w.g.visible) { w.k = 0; return; }
      w.k += ((wp.near === w.floor ? 1 : 0) - w.k) * Math.min(1, dt * 6);
      const b = wp.calm ? 1 : 0.85 + 0.15 * Math.sin(time * 1.8 + w.floor);
      w.ring.material.opacity = ((0.4 + 0.35 * w.k) * b + 0.5 * fl) * lit; w.reach.material.opacity = (0.18 + 0.32 * w.k) * lit;
      w.halo.material.opacity = ((0.16 + 0.14 * w.k) * b + 0.5 * fl) * lit; w.halo.scale.setScalar(1 + 1.6 * fl);
    });
    if (stair.visible) { ringM.rotation.z += dt * 0.6; disc.material.opacity = 0.45 + Math.sin(time * 3) * 0.12; column.material.opacity = 0.14 + Math.sin(time * 2) * 0.05; }
    const fire = root.userData.fire; if (fire) { fire.scale.set(1 + Math.sin(time * 9) * 0.08, 1 + Math.sin(time * 7) * 0.15, 1); }
    deluge.userData.k += ((deluged ? 1 : 0) - deluge.userData.k) * Math.min(1, dt * 0.8);
    deluge.material.opacity = deluge.userData.k * (0.62 + Math.sin(time * 2) * 0.06);
    deluge.visible = deluge.userData.k > 0.01;
    if (onF2) {
      const on = Math.round(motesN * Q.fx); motesGeo.setDrawRange(0, on); // fewer motes on lower graphics settings
      for (let i = 0; i < on; i++) {
        const [x, z, ph, h] = seeds[i];
        mp[i * 3] = x + Math.sin(time * 0.3 + ph) * 2.2; mp[i * 3 + 1] = h + Math.sin(time * 0.9 + ph * 2) * 0.4; mp[i * 3 + 2] = z + Math.cos(time * 0.25 + ph) * 2.2;
      }
      motesGeo.attributes.position.needsUpdate = true;
    }
  }

  return { root, gate2, stairway, waypoints, update, deluge };
}

// ---------- block models for Floor 2's enemies ----------
// Same shape as world.js makeBlockMob's result: { group, body, legs, armR, cursor, mats, height }.
// Glowing parts use MeshBasicMaterial so the hit-flash (which rewrites emissive on `mats`) leaves them lit.
function part(geo, material, x, y, z, parent) {
  const m = new THREE.Mesh(geo, typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}

export function makeF2Mob(type) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const legs = [];
  let height = 1.8, armR = null, inner = null;
  const eyes = (head, color, pts, size = 0.06) => { for (const [x, y, z] of pts) part(new THREE.SphereGeometry(size, 6, 4), glow(color), x, y, z, head); };

  if (type === 'shieldback') { // turtle brute: a mossy back shell and a pale horn plate across its FRONT
    part(new THREE.BoxGeometry(1.7, 0.55, 2.1), 0x5b5040, 0, 0.55, 0, body);
    const shell = part(new THREE.SphereGeometry(1.2, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0x3f5a3a, 0, 0.75, -0.15, body); shell.scale.set(1, 0.85, 1.25);
    part(new THREE.CylinderGeometry(1.25, 1.3, 0.22, 14), 0x2a3a28, 0, 0.8, -0.15, body).scale.z = 1.25;
    for (const [x, z] of [[0, -0.2], [0.55, 0.3], [-0.5, -0.7], [0.4, -0.9]]) part(new THREE.OctahedronGeometry(0.22), glow(0x67e8f9), x, 1.75 - Math.hypot(x, z) * 0.35, z, body).scale.y = 1.8;
    const head = part(new THREE.BoxGeometry(0.62, 0.5, 0.6), 0x6b6a4a, 0, 0.62, 1.3, body);
    eyes(head, 0xfde047, [[-0.18, 0.08, 0.31], [0.18, 0.08, 0.31]]);
    const plate = part(new THREE.BoxGeometry(2.1, 1.45, 0.28), 0xcdbb8a, 0, 1.05, 1.62, body); plate.rotation.x = -0.18; // the shell front: hits from here are BLOCKED
    part(new THREE.BoxGeometry(2.25, 0.16, 0.34), 0x8a7a55, 0, 1.78, 1.5, body).rotation.x = -0.18;
    for (const sx of [-0.6, 0, 0.6]) part(new THREE.BoxGeometry(0.1, 1.2, 0.05), 0x9c8a60, sx, 1.05, 1.78, body).rotation.x = -0.18;
    for (const [x, z] of [[-0.75, 0.75], [0.75, 0.75], [-0.75, -0.75], [0.75, -0.75]]) legs.push(part(new THREE.BoxGeometry(0.34, 0.5, 0.34), 0x4a4232, x, 0.25, z, body));
    height = 2.3;
  } else if (type === 'wisp') { // a floating lantern-flame that keeps its distance
    inner = new THREE.Group(); inner.position.y = 1.7; body.add(inner);
    part(new THREE.SphereGeometry(0.34, 14, 10), glow(0xe0fbff), 0, 0, 0, inner);
    part(new THREE.SphereGeometry(0.62, 14, 10), new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.32, depthWrite: false }), 0, 0, 0, inner);
    const flame = part(new THREE.ConeGeometry(0.32, 1.0, 8), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.55, depthWrite: false }), 0, 0.62, 0, inner);
    flame.castShadow = false;
    const cage = part(new THREE.IcosahedronGeometry(0.5, 0), mat(0x1f2937, { wireframe: true }), 0, 0, 0, inner); cage.castShadow = false;
    const motes = new THREE.Group(); inner.add(motes); inner.userData.motes = motes;
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; part(new THREE.SphereGeometry(0.09, 6, 4), glow(0xa5f3fc), Math.cos(a) * 0.95, (i - 1) * 0.2, Math.sin(a) * 0.95, motes); }
    height = 2.8;
  } else if (type === 'lurker' || type === 'matron') { // mud-crawler with a huge jaw (the Matron: bigger, violet, crowned with glowing reeds)
    const mt = type === 'matron';
    const hide = mt ? 0x4a2f4a : 0x4a3b28, dark = mt ? 0x2b1a2e : 0x2e2418;
    const torso = part(new THREE.SphereGeometry(0.9, 12, 8), hide, 0, 0.7, -0.1, body); torso.scale.set(1.3, 0.72, 1.4);
    part(new THREE.BoxGeometry(1.2, 0.18, 1.0), mt ? 0x6d4b7a : 0x3f5f2a, 0, 1.25, -0.25, body).rotation.x = 0.2; // moss / back plates
    const jaw = part(new THREE.BoxGeometry(1.15, 0.36, 0.8), dark, 0, 0.42, 1.05, body);
    const upper = part(new THREE.BoxGeometry(1.2, 0.34, 0.85), hide, 0, 0.86, 1.0, body); upper.rotation.x = -0.25;
    for (let i = 0; i < 5; i++) { part(new THREE.ConeGeometry(0.06, 0.24, 4), 0xf5f0e1, -0.44 + i * 0.22, 0.22, 0.32, jaw); const tt = part(new THREE.ConeGeometry(0.06, 0.22, 4), 0xf5f0e1, -0.44 + i * 0.22, -0.2, 0.33, upper); tt.rotation.x = Math.PI; }
    eyes(upper, mt ? 0xf0abfc : 0xd9f99d, [[-0.35, 0.2, 0.2], [0.35, 0.2, 0.2], [-0.18, 0.26, 0.05], [0.18, 0.26, 0.05], [-0.42, 0.14, -0.1], [0.42, 0.14, -0.1]], 0.07);
    armR = new THREE.Group(); armR.position.set(0.95, 0.85, 0.45); body.add(armR);
    part(new THREE.BoxGeometry(0.26, 0.8, 0.26), hide, 0, -0.35, 0, armR);
    for (const cx of [-0.08, 0.08]) part(new THREE.ConeGeometry(0.06, 0.32, 4), 0xe5e7eb, cx, -0.85, 0.08, armR).rotation.x = Math.PI;
    const armL = new THREE.Group(); armL.position.set(-0.95, 0.85, 0.45); body.add(armL);
    part(new THREE.BoxGeometry(0.26, 0.8, 0.26), hide, 0, -0.35, 0, armL);
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6]]) legs.push(part(new THREE.BoxGeometry(0.3, 0.45, 0.3), dark, x, 0.22, z, body));
    height = 1.9;
    if (mt) {
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const reed = part(new THREE.CylinderGeometry(0.04, 0.06, 1.0 + (i % 3) * 0.35, 5), glow(0xc4b5fd), Math.cos(a) * 0.45, 1.75, Math.sin(a) * 0.45 - 0.2, body); reed.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); }
      part(new THREE.OctahedronGeometry(0.35), glow(0xe879f9), 0, 2.45, -0.2, body).scale.y = 1.7;
      body.scale.setScalar(1.6); height = 4.0;
    }
  } else if (type === 'thrall') { // drowned humanoid, hunched, trailing weed
    const skin = 0x5d7470, cloth = 0x2f4a4a;
    for (const sx of [-0.18, 0.18]) legs.push(part(new THREE.BoxGeometry(0.26, 0.85, 0.28), cloth, sx, 0.42, 0, body));
    const torso = part(new THREE.BoxGeometry(0.7, 0.85, 0.42), cloth, 0, 1.25, 0.05, body); torso.rotation.x = 0.25;
    const head = part(new THREE.SphereGeometry(0.27, 10, 8), skin, 0, 1.85, 0.25, body);
    eyes(head, 0x5eead4, [[-0.1, 0.03, 0.24], [0.1, 0.03, 0.24]], 0.05);
    for (let i = 0; i < 5; i++) part(new THREE.BoxGeometry(0.06, 0.5 + (i % 2) * 0.3, 0.04), 0x3f6b3a, -0.3 + i * 0.15, 0.95, -0.18, body);
    armR = new THREE.Group(); armR.position.set(0.45, 1.55, 0.1); body.add(armR);
    part(new THREE.BoxGeometry(0.18, 0.75, 0.2), skin, 0, -0.33, 0, armR);
    const blade = part(new THREE.BoxGeometry(0.08, 0.9, 0.03), 0x7c6f5a, 0, -0.95, 0.15, armR); blade.rotation.x = 0.5;
    const armL = new THREE.Group(); armL.position.set(-0.45, 1.55, 0.1); body.add(armL);
    part(new THREE.BoxGeometry(0.18, 0.75, 0.2), skin, 0, -0.33, 0, armL);
    height = 2.2;
  } else { // the Drowned Sovereign (block fallback when the rigged models fail to load)
    const sc = 2.6;
    part(new THREE.ConeGeometry(0.9 * sc, 1.9 * sc, 8), 0x1f4f4f, 0, 0.95 * sc, 0, body);
    part(new THREE.BoxGeometry(1.1 * sc, 0.9 * sc, 0.6 * sc), 0x2a6460, 0, 2.1 * sc, 0, body);
    const head = part(new THREE.SphereGeometry(0.38 * sc, 12, 10), 0x7fb8b0, 0, 2.85 * sc, 0.05, body);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; part(new THREE.ConeGeometry(0.09 * sc, 0.4 * sc, 4), mat(0xfbbf24, { metalness: 0.6, roughness: 0.4 }), Math.cos(a) * 0.3 * sc, 0.42 * sc, Math.sin(a) * 0.3 * sc, head); }
    eyes(head, 0x5eead4, [[-0.12 * sc, 0.05 * sc, 0.33 * sc], [0.12 * sc, 0.05 * sc, 0.33 * sc]], 0.08 * sc);
    armR = new THREE.Group(); armR.position.set(0.75 * sc, 2.4 * sc, 0); body.add(armR);
    part(new THREE.BoxGeometry(0.3 * sc, 1.0 * sc, 0.3 * sc), 0x2a6460, 0, -0.45 * sc, 0, armR);
    const tri = new THREE.Group(); tri.position.set(0, -0.95 * sc, 0.1 * sc); armR.add(tri);
    part(new THREE.CylinderGeometry(0.05 * sc, 0.05 * sc, 2.4 * sc, 6), 0x8a7a55, 0, 0, 0.7 * sc, tri).rotation.x = Math.PI / 2;
    for (const sx of [-0.18, 0, 0.18]) { const tine = part(new THREE.ConeGeometry(0.05 * sc, 0.5 * sc, 4), glow(0x5eead4), sx * sc, 0, 1.95 * sc, tri); tine.rotation.x = Math.PI / 2; }
    height = 7.6;
  }
  const cursor = new THREE.Mesh(new THREE.OctahedronGeometry(type === 'sovereign' ? 0.3 : 0.14), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.2; g.add(cursor);
  const mats = [];
  g.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial && !o.material.wireframe) mats.push(o.material); });
  return { group: g, body, legs, armR, cursor, mats, height, inner };
}

// Extra pieces for the rigged Sovereign (a crown on its head, a glowing trident head on its staff).
export function decorateSovereign(root, height) {
  const head = root.getObjectByName('head');
  const hand = root.getObjectByName('handslotr');
  const ws = new THREE.Vector3();
  root.updateMatrixWorld(true);
  if (head) {
    head.getWorldScale(ws);
    const k = 1 / ws.x; // build in world units, then undo the bone's scale
    const crown = new THREE.Group();
    const gold = mat(0xfbbf24, { metalness: 0.6, roughness: 0.35, emissive: 0x7c5a10, emissiveIntensity: 0.4 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.22, 10, 1, true), gold); band.material.side = THREE.DoubleSide; crown.add(band);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, i % 2 ? 0.32 : 0.5, 4), gold); sp.position.set(Math.cos(a) * 0.62, 0.25 + (i % 2 ? 0 : 0.09), Math.sin(a) * 0.62); crown.add(sp); }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), glow(0x5eead4)); gem.position.set(0, 0.05, 0.66); crown.add(gem);
    crown.scale.setScalar(k * height / 6.4 * 2.1); // the rig is chibi-proportioned: a big head
    crown.position.set(0, (height * 0.33) * k, 0);
    head.add(crown);
  }
  if (hand) {
    hand.getWorldScale(ws);
    const k = 1 / ws.x;
    const tri = new THREE.Group();
    const tg = glow(0x5eead4);
    for (const sx of [-0.22, 0, 0.22]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, sx ? 0.6 : 0.85, 5), tg); t.position.set(sx, sx ? 0.3 : 0.42, 0); tri.add(t); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.07), tg); tri.add(bar);
    tri.scale.setScalar(k * height / 6.4 * 1.6);
    tri.position.set(0, (height * 0.3) * k, 0);
    hand.add(tri);
  }
}
