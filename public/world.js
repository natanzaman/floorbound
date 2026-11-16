// Scene construction, character models and visual effects.
import * as THREE from 'three';
import { WORLD, OBSTACLES, CLASSES, rng } from '/shared/data.js';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...opts });

export function createWorld(scene) {
  scene.background = new THREE.Color(0x9cc9ee);
  scene.fog = new THREE.Fog(0x9cc9ee, 70, 230);

  const occluders = []; // things the camera should not clip behind
  scene.add(new THREE.HemisphereLight(0xdbeaff, 0x3b5d2a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.9);
  sun.position.set(30, 60, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);

  // Ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 700, 1, 1), mat(0x5f9a45));
  ground.rotation.x = -Math.PI / 2; ground.position.z = 80; ground.receiveShadow = true;
  scene.add(ground);

  const flat = (geo, color, y, x = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m;
  };
  // Town plaza, road, chamber floor
  flat(new THREE.CircleGeometry(WORLD.town.r, 48), 0xb9b2a3, 0.02);
  flat(new THREE.RingGeometry(WORLD.town.r - 0.6, WORLD.town.r, 64), 0xe6dcc6, 0.03);
  flat(new THREE.PlaneGeometry(8, 128), 0xa8885a, 0.015, 0, 88);
  flat(new THREE.PlaneGeometry(10, 22), 0x6b6670, 0.02, 0, 158);
  flat(new THREE.CircleGeometry(WORLD.arena.r, 48), 0x4a4552, 0.025, WORLD.arena.x, WORLD.arena.z);
  flat(new THREE.RingGeometry(9, 9.4, 48), 0x7a6a48, 0.03, WORLD.arena.x, WORLD.arena.z);

  // Fountain
  const fountain = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.8, 24), mat(0xd6d0c4));
  basin.position.y = 0.4;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 24), mat(0x5eb8f0, { emissive: 0x1d4f7a, emissiveIntensity: 0.4 }));
  water.position.y = 0.8;
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 8), mat(0xd6d0c4));
  spire.position.y = 2;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), mat(0x9fe3ff, { emissive: 0x3fa7ff, emissiveIntensity: 1 }));
  crystal.position.y = 4.1;
  fountain.add(basin, water, spire, crystal);
  fountain.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  scene.add(fountain);

  // Houses
  for (const o of OBSTACLES.filter(o => o.kind === 'house')) {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(5, 3.4, 5), mat(0xeadfc8));
    walls.position.y = 1.7;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.3, 2.6, 4), mat(0x9a3b2e));
    roof.position.y = 4.7; roof.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 0.1), mat(0x6b4226));
    door.position.set(0, 1, 2.52);
    g.add(walls, roof, door);
    g.position.set(o.x, 0, o.z); g.rotation.y = o.rot;
    g.traverse(m => { m.castShadow = true; m.receiveShadow = true; });
    scene.add(g); occluders.push(g);
  }

  // Trees & rocks (instanced)
  const trees = OBSTACLES.filter(o => o.kind === 'tree');
  const rocks = OBSTACLES.filter(o => o.kind === 'rock');
  const r = rng(99);
  const border = [];
  for (let i = 0; i < 260; i++) { // decorative tree line outside the playable area
    const side = i % 4, t = r();
    let x, z;
    if (side === 0) { x = -76 - r() * 30; z = -40 + t * 200; }
    else if (side === 1) { x = 76 + r() * 30; z = -40 + t * 200; }
    else if (side === 2) { x = -80 + t * 160; z = -40 - r() * 25; }
    else { x = -80 + t * 160; z = 163 + r() * 20; if (Math.abs(x) < 34) continue; }
    border.push({ x, z, s: 1 + r() * 0.8 });
  }
  const allTrees = [...trees, ...border];
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6);
  const leafGeo = new THREE.ConeGeometry(1.6, 3.6, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6b4a2b), allTrees.length);
  const leaves = new THREE.InstancedMesh(leafGeo, mat(0x2f6b34), allTrees.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const leafColor = new THREE.Color();
  allTrees.forEach((t, i) => {
    const sc = t.s || 1;
    m4.compose(p.set(t.x, sc, t.z), q, s.set(sc, sc, sc)); trunks.setMatrixAt(i, m4);
    m4.compose(p.set(t.x, sc * 3.6, t.z), q, s.set(sc, sc, sc)); leaves.setMatrixAt(i, m4);
    leaves.setColorAt(i, leafColor.setHSL(0.3 + r() * 0.06, 0.45, 0.25 + r() * 0.1));
  });
  trunks.castShadow = leaves.castShadow = true;
  scene.add(trunks, leaves); occluders.push(trunks, leaves);
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0x8a8d91), rocks.length);
  rocks.forEach((o, i) => {
    m4.compose(p.set(o.x, o.r * 0.5, o.z), q.setFromEuler(new THREE.Euler(r(), r(), r())), s.set(o.r * 1.1, o.r * 0.8, o.r * 1.1));
    rockMesh.setMatrixAt(i, m4);
  });
  rockMesh.castShadow = true; scene.add(rockMesh);

  // Chamber: pillars, walls, gate
  for (const o of OBSTACLES.filter(o => o.kind === 'pillar')) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 12, 8), mat(0x5b5664));
    pil.position.set(o.x, 6, o.z); pil.castShadow = true; scene.add(pil); occluders.push(pil);
    const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), mat(0xff7a2f, { emissive: 0xff5500, emissiveIntensity: 2 }));
    flame.position.set(o.x, 12.6, o.z); scene.add(flame);
  }
  const wallMat = mat(0x3d3946);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    if (Math.abs(Math.sin(a) + 1) < 0.02 || (Math.sin(a) < -0.96)) continue; // opening toward the field
    const w = new THREE.Mesh(new THREE.BoxGeometry(4.3, 8, 1.2), wallMat);
    w.position.set(WORLD.arena.x + Math.cos(a) * (WORLD.arena.r + 0.8), 4, WORLD.arena.z + Math.sin(a) * (WORLD.arena.r + 0.8));
    w.rotation.y = -a + Math.PI / 2; w.castShadow = true; scene.add(w); occluders.push(w);
  }
  const gate = new THREE.Group();
  const postL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 10, 1.6), wallMat); postL.position.set(-6, 5, 0);
  const postR = postL.clone(); postR.position.x = 6;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 1.8), wallMat); lintel.position.y = 10.4;
  const sigil = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), mat(0xff4040, { emissive: 0xff2020, emissiveIntensity: 1.5 }));
  sigil.position.y = 12;
  gate.add(postL, postR, lintel, sigil);
  gate.position.set(0, 0, 150);
  gate.traverse(m => { m.castShadow = true; });
  scene.add(gate); occluders.push(gate);

  // Distant scenery: mountains and the tower spire above everything
  const mtn = mat(0x7d8fa6);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, d = 240 + r() * 40;
    const h = 40 + r() * 50;
    const c = new THREE.Mesh(new THREE.ConeGeometry(30 + r() * 20, h, 6), mtn);
    c.position.set(Math.cos(a) * d, h / 2 - 2, 80 + Math.sin(a) * d); scene.add(c);
  }
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(14, 22, 420, 10), mat(0x8792b0, { fog: false }));
  tower.position.set(60, 200, 420); scene.add(tower);

  return { sun, crystal, occluders };
}

// ---------- characters ----------
const SKIN = 0xf1c7a0;

function part(geo, color, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z); m.castShadow = true;
  parent.add(m); return m;
}

export function makePlayerModel(cls) {
  const color = CLASSES[cls]?.color ?? 0x888888;
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const legL = part(new THREE.BoxGeometry(0.28, 0.8, 0.3), 0x2b2f3a, -0.17, 0.4, 0, body);
  const legR = part(new THREE.BoxGeometry(0.28, 0.8, 0.3), 0x2b2f3a, 0.17, 0.4, 0, body);
  part(new THREE.BoxGeometry(0.72, 0.85, 0.42), color, 0, 1.22, 0, body);
  part(new THREE.BoxGeometry(0.76, 0.12, 0.46), 0x3a2a1c, 0, 0.86, 0, body);
  part(new THREE.SphereGeometry(0.27, 10, 8), SKIN, 0, 1.9, 0, body);
  part(new THREE.SphereGeometry(0.29, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), cls === 'cleric' ? 0xf5e6b8 : 0x2a1c14, 0, 1.94, -0.02, body);
  if (cls !== 'guardian') { // cape
    const cape = part(new THREE.BoxGeometry(0.66, 0.95, 0.05), cls === 'cleric' ? 0xffffff : 0x1e3a8a, 0, 1.15, -0.25, body);
    cape.rotation.x = 0.12;
  }
  const armR = new THREE.Group(); armR.position.set(0.47, 1.55, 0); body.add(armR);
  part(new THREE.BoxGeometry(0.2, 0.7, 0.22), color, 0, -0.33, 0, armR);
  const armL = new THREE.Group(); armL.position.set(-0.47, 1.55, 0); body.add(armL);
  part(new THREE.BoxGeometry(0.2, 0.7, 0.22), color, 0, -0.33, 0, armL);

  const weapon = new THREE.Group(); weapon.position.set(0, -0.7, 0.1); armR.add(weapon);
  if (cls === 'cleric') {
    part(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), 0x8b5a2b, 0, 0.2, 0, weapon);
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat(0x86efac, { emissive: 0x22c55e, emissiveIntensity: 1.2 }));
    orb.position.y = 1.15; weapon.add(orb);
  } else {
    const blade = part(new THREE.BoxGeometry(0.08, 1.2, 0.02), 0xdfe6ee, 0, 0.75, 0, weapon);
    blade.material.metalness = 0.6; blade.material.roughness = 0.3;
    part(new THREE.BoxGeometry(0.36, 0.06, 0.08), 0x8a6d2f, 0, 0.14, 0, weapon);
    part(new THREE.BoxGeometry(0.06, 0.24, 0.06), 0x3a2a1c, 0, 0, 0, weapon);
    weapon.rotation.x = Math.PI / 2;
  }
  if (cls === 'guardian') {
    const shield = part(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 12), 0xb45309, 0, -0.45, 0.2, armL);
    shield.rotation.x = Math.PI / 2;
    part(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 8), 0xe5e7eb, 0, -0.45, 0.25, armL).rotation.x = Math.PI / 2;
  }
  const cursor = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
  cursor.scale.y = 1.6; cursor.position.y = 2.75; g.add(cursor);
  return { group: g, body, legL, legR, armR, armL, cursor, height: 2.5 };
}

export function makeMobModel(type) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const legs = [];
  let height = 1.4, armR = null;
  if (type === 'boar') {
    part(new THREE.SphereGeometry(0.75, 10, 8), 0x7a4b2a, 0, 0.75, 0, body).scale.set(0.9, 0.75, 1.3);
    const head = part(new THREE.BoxGeometry(0.6, 0.55, 0.6), 0x6a3f22, 0, 0.75, 0.95, body);
    part(new THREE.BoxGeometry(0.3, 0.22, 0.14), 0xd99a8a, 0, -0.08, 0.33, head);
    for (const sx of [-1, 1]) {
      const tusk = part(new THREE.ConeGeometry(0.06, 0.32, 5), 0xf5f0e1, sx * 0.22, -0.12, 0.3, head);
      tusk.rotation.x = -0.8;
      part(new THREE.SphereGeometry(0.05, 6, 4), 0x220000, sx * 0.17, 0.12, 0.3, head);
    }
    for (const [x, z] of [[-0.35, 0.5], [0.35, 0.5], [-0.35, -0.5], [0.35, -0.5]]) legs.push(part(new THREE.BoxGeometry(0.18, 0.5, 0.18), 0x4b2e19, x, 0.25, z, body));
    height = 1.6;
  } else if (type === 'wolf') {
    part(new THREE.BoxGeometry(0.6, 0.6, 1.5), 0x5b5f6b, 0, 0.95, 0, body);
    const head = part(new THREE.BoxGeometry(0.48, 0.45, 0.6), 0x4b4f5a, 0, 1.2, 0.95, body);
    part(new THREE.BoxGeometry(0.26, 0.2, 0.3), 0x3a3d45, 0, -0.1, 0.42, head);
    for (const sx of [-1, 1]) {
      part(new THREE.ConeGeometry(0.1, 0.28, 4), 0x3a3d45, sx * 0.16, 0.32, -0.05, head);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      eye.position.set(sx * 0.13, 0.08, 0.31); head.add(eye);
    }
    const tail = part(new THREE.BoxGeometry(0.14, 0.14, 0.7), 0x5b5f6b, 0, 1.1, -1.0, body); tail.rotation.x = 0.5;
    for (const [x, z] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) legs.push(part(new THREE.BoxGeometry(0.15, 0.7, 0.15), 0x3a3d45, x, 0.35, z, body));
    height = 1.8;
  } else { // warden boss
    const s = 2.3;
    legs.push(part(new THREE.BoxGeometry(0.45 * s, 1.0 * s, 0.5 * s), 0x3b1f1f, -0.3 * s, 0.5 * s, 0, body));
    legs.push(part(new THREE.BoxGeometry(0.45 * s, 1.0 * s, 0.5 * s), 0x3b1f1f, 0.3 * s, 0.5 * s, 0, body));
    part(new THREE.BoxGeometry(1.3 * s, 1.2 * s, 0.75 * s), 0x7f1d1d, 0, 1.6 * s, 0, body);
    part(new THREE.BoxGeometry(1.5 * s, 0.35 * s, 0.85 * s), 0x2d2a33, 0, 2.15 * s, 0, body);
    const head = part(new THREE.BoxGeometry(0.6 * s, 0.6 * s, 0.6 * s), 0x5b1414, 0, 2.6 * s, 0.05 * s, body);
    for (const sx of [-1, 1]) {
      const horn = part(new THREE.ConeGeometry(0.12 * s, 0.9 * s, 6), 0xe8dcc0, sx * 0.38 * s, 0.4 * s, 0, head);
      horn.rotation.z = -sx * 0.6;
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.06 * s, 0.02), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
      eye.position.set(sx * 0.14 * s, 0.05 * s, 0.31 * s); head.add(eye);
    }
    armR = new THREE.Group(); armR.position.set(0.85 * s, 2.0 * s, 0); body.add(armR);
    part(new THREE.BoxGeometry(0.38 * s, 1.1 * s, 0.4 * s), 0x7f1d1d, 0, -0.5 * s, 0, armR);
    const axe = new THREE.Group(); axe.position.set(0, -1.05 * s, 0.1 * s); armR.add(axe);
    part(new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 2.0 * s, 6), 0x3a2a1c, 0, 0, 0.6 * s, axe).rotation.x = Math.PI / 2;
    part(new THREE.BoxGeometry(0.1 * s, 0.8 * s, 0.6 * s), 0x9ca3af, 0, 0.25 * s, 1.4 * s, axe);
    const armL = new THREE.Group(); armL.position.set(-0.85 * s, 2.0 * s, 0); body.add(armL);
    part(new THREE.BoxGeometry(0.38 * s, 1.1 * s, 0.4 * s), 0x7f1d1d, 0, -0.5 * s, 0, armL);
    height = 7.6;
  }
  const cursor = new THREE.Mesh(new THREE.OctahedronGeometry(type === 'warden' ? 0.3 : 0.14), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.2; g.add(cursor);
  const mats = [];
  g.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) mats.push(o.material); });
  return { group: g, body, legs, armR, cursor, mats, height };
}

// ---------- effects ----------
export class Effects {
  constructor(scene) { this.scene = scene; this.list = []; }

  add(mesh, life, update) {
    this.scene.add(mesh);
    this.list.push({ mesh, life, age: 0, update });
  }

  update(dt) {
    for (const e of this.list) {
      e.age += dt;
      const k = Math.min(1, e.age / e.life);
      e.update?.(e.mesh, k, dt);
    }
    for (const e of this.list.filter(e => e.age >= e.life)) {
      this.scene.remove(e.mesh);
      e.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    this.list = this.list.filter(e => e.age < e.life);
  }

  fadeMat(color, opacity = 0.8) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  }

  arc(x, z, face, r, half, color = 0xe0f2ff) {
    const geo = new THREE.RingGeometry(r * 0.35, r, 24, 1, face - Math.PI / 2 - half, half * 2);
    const m = new THREE.Mesh(geo, this.fadeMat(color, 0.85));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 1.0, z);
    this.add(m, 0.22, (mesh, k) => { mesh.material.opacity = 0.85 * (1 - k); mesh.scale.setScalar(0.85 + k * 0.2); });
  }

  ring(x, z, r, color = 0xe0f2ff, life = 0.4) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), this.fadeMat(color, 0.9));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.3, z);
    this.add(m, life, (mesh, k) => { mesh.scale.setScalar(Math.max(0.01, r * (0.3 + 0.7 * k))); mesh.material.opacity = 0.9 * (1 - k); });
  }

  line(x0, z0, x1, z1, color, width = 0.5, life = 0.3, y = 1) {
    const len = Math.hypot(x1 - x0, z1 - z0) || 0.1;
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.15, len), this.fadeMat(color, 0.9));
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    this.add(m, life, (mesh, k) => { mesh.material.opacity = 0.9 * (1 - k); mesh.scale.x = 1 - k * 0.7; });
  }

  zone(x, z, r, life, color = 0x4ade80) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), this.fadeMat(color, 0.25));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z);
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 48), this.fadeMat(color, 0.7));
    m.add(edge); edge.position.z = 0.01;
    this.add(m, life, (mesh, k) => { mesh.material.opacity = 0.25 * (1 - k * 0.6); edge.rotation.z += 0.02; });
  }

  telegraph(x, z, r, life, follow) {
    const g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.3, r, 48), this.fadeMat(0xff2a2a, 0.85));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), this.fadeMat(0xff3b3b, 0.3));
    edge.rotation.x = fill.rotation.x = -Math.PI / 2;
    g.add(edge, fill); g.position.set(x, 0.08, z);
    this.add(g, life, (mesh, k) => {
      fill.scale.setScalar(Math.max(0.01, k));
      if (follow) { const p = follow(); if (p) mesh.position.set(p.x, 0.08, p.z); }
    });
  }

  heal(obj) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 24), this.fadeMat(0x86efac, 0.9));
      m.rotation.x = -Math.PI / 2;
      this.add(m, 0.8, (mesh, k) => {
        const kk = Math.max(0, k - i * 0.15);
        mesh.position.set(obj.position.x, 0.2 + kk * 2.4, obj.position.z);
        mesh.material.opacity = 0.9 * (1 - kk);
      });
    }
  }

  shatter(x, z, big) {
    const n = big ? 60 : 22;
    for (let i = 0; i < n; i++) {
      const s = (big ? 0.35 : 0.16) * (0.6 + Math.random());
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(s), this.fadeMat(i % 3 ? 0x9fe3ff : 0xffffff, 1));
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6).multiplyScalar(big ? 1.6 : 1);
      m.position.set(x, big ? 4 : 1, z);
      this.add(m, 1.1 + Math.random() * 0.5, (mesh, k, dt) => {
        mesh.position.addScaledVector(v, dt); v.y -= 4 * dt;
        mesh.rotation.x += dt * 5; mesh.rotation.y += dt * 4;
        mesh.material.opacity = 1 - k;
      });
    }
  }

  shield(obj, life, color = 0x60a5fa) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), this.fadeMat(color, 0.18));
    this.add(m, life, (mesh, k) => { mesh.position.set(obj.position.x, 1.2, obj.position.z); mesh.material.opacity = 0.2 * (1 - k * k); });
  }
}
