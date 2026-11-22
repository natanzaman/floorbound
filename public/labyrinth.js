// Labyrinths (docs/briefs/labyrinths.md): the client. Builds each layer's look (Floor 1: the Undercrypt's Catacombs,
// Drowning Galleries and Ossuary), its stairs, torches, water, chests, levers and portcullis, spike plates, the crypt's
// darkness and your torch, the prompts, and the events (the crypt breathing, the dead rising, a lure, the key). Block
// models for its enemies. Data and geometry: shared/labyrinth.js. Server: server/labyrinth.js.
import * as THREE from 'three';
import { LABS, LAB_FLOORS, LAYERS, LURE, LAB_MOBS, LAB_WORDS, labAt, startPoint, endPoint, hallCenter, trapState, hasLabKey, stairsOf, applyLabSnap, portOpen, labRun, labSpeedAt, shiftPhase, shiftLeft, windAt, windLeft, onBridge, cellOf } from '/shared/labyrinth.js';
import { keyHtml, tapping } from '/keyname.js';
import * as THICKET from '/labthicket.js'; // Floor 2's look (the Weeping Thicket)
import * as CAUSEWAY from '/labcauseway.js'; // Floor 3's look (the Windrift Causeways)
const STYLES = { thicket: THICKET, causeway: CAUSEWAY }; // (Floor 1's crypt is drawn here)

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, flatShading: true, ...opts });
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// The crypt's air (blended in while you're inside): sky / fog colour, fog near and far, light.
const CRYPT = { sky: 0x0b0a0e, near: 8, far: 46, gutterFar: 17, hemi: 0.35, sun: 0.25, torch: 0xffa64d };
// The crypt's colours for the shared pieces (each other floor's style module has its own COLORS).
const CRYPT_COLORS = { chest: 0x4a3424, chestDeep: 0x5a3a1a, band: 0x6b6b6b, bandDeep: 0xd4a017, lever: 0xd8cdb6, leverKnob: 0xe7dcc4, gate: 0x3f3f46, stair: 0x6a625a, plate: 0x24201d, spike: 0x9aa0a6, warn: 0xef4444, flame: 0xffa53a, halo: 0xff7a1a, bracket: 0x2a211a, lure: 0xe7dcc4 };
const styleOf = L => STYLES[L?.lab?.style] || null;
const AIRS = new Map(); // per layer: its floor's air, with any per-layer override (AIR.layers)
const airOf = L => { if (!L) return CRYPT; if (!AIRS.has(L)) { const A = styleOf(L)?.AIR; AIRS.set(L, A ? { ...A, ...(A.layers?.[L.id] || {}) } : CRYPT); } return AIRS.get(L); };
const colorsOf = L => styleOf(L)?.COLORS || CRYPT_COLORS;
const FIELD = { 1: 'the Verdant Field', 2: 'the Glimmering Mire', 3: 'the Gale Spires' };
const GATE_NAME = { 1: 'the Chamber Gate', 2: 'the Sunken Gate', 3: 'the Storm Gate' };
const KEEPER_NAME = { 1: 'the Gravekeeper', 2: 'the Mother of Mire', 3: 'the Gale Matriarch' };
const DOWN_LINE = { galleries: 'Deeper. Wetter. Louder.', ossuary: 'Something tall waits among the bones', drownedwood: 'Follow the true light. Mind the tide.', heartwillow: 'Something vast stirs beneath the roots', turningisles: 'Mind the spans. Mind the wind.', eyespire: 'Wings beat above the spire' };
const BREATHE = { // [callout, line, line at full pressure]
  rise: ['THE CRYPT BREATHES', 'The torches gutter. The dead stir.', 'It has noticed you. More of the dead stir.'],
  wisps: ['THE WISPS RISE', 'One light leads on. The others lie.', 'The mist thickens. The lies grow bolder.'],
  squall: ['THE SQUALL', 'Lightning marks the stone: step off the glow!', 'The storm has found you. More strikes come.'],
};
const CALL = { 1: ['THE GRAVE BELL', 'The dead answer. Cut them down!'], 2: ['THE TIDE TURNS EARLY', 'Lurkers surface. Cut them down!'], 3: ['THE MATRIARCH SHRIEKS', 'Harpies answer. Bring them down!'] };
const LOCK = { 1: 'THE HORN LOCK', 2: 'THE TIDE LOCK', 3: 'THE STORM LOCK' };
const WAKE = { 1: ['A TOMB WARDEN STIRS', 'It heard you. Quiet steps, or throw a rattle to draw it off'], 2: ['A MOSS HAG STIRS', 'It heard you. Keep out of the water, or blow a whistle to draw it off'], 3: ['A KITE RIDER WAKES', 'It heard the fight. Ring a chime to draw it off'] };
// Per layer: floor and wall stone, and its landmark (seen or heard from far off).
const LOOK = {
  catacombs: { floor: 0x2a2622, wall: 0x5b544c, cap: 0x3a3530, post: 0x4a443e },
  galleries: { floor: 0x232628, wall: 0x4d5250, cap: 0x2f3433, post: 0x3f4442 },
  ossuary: { floor: 0x4a433a, wall: 0x6b6258, cap: 0x4a433a, post: 0x5d564d },
};

// ---------- the scenery of one layer ----------
function buildLayer(scene, L, occluders) {
  const look = LOOK[L.id] || LOOK.catacombs;
  const root = new THREE.Group(); root.name = `lab-${L.id}`; scene.add(root);
  const r = rng(L.seeds.walls + 7), C = L.cell, T = L.wall, H = L.height;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const flat = (w, d, m, x, y, z, parent = root) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); o.rotation.x = -Math.PI / 2; o.position.set(x, y, z); o.receiveShadow = true; parent.add(o); return o; };
  const ST = styleOf(L), K = colorsOf(L);
  const terrain = ST ? ST.buildTerrain(root, L, { THREE, mat, glow, rng, flat, occluders }) : null;
  if (!ST) {
  flat(L.w, L.d, mat(look.floor), L.x0 + L.w / 2, 0.015, L.z0 + L.d / 2);
  // flagstone seams
  const seams = [];
  for (let k = 0; k <= L.cols * 4; k++) seams.push([L.x0 + k * C / 4, L.z0 + L.d / 2, 0.06, L.d]);
  for (let k = 0; k <= L.rows * 4; k++) seams.push([L.x0 + L.w / 2, L.z0 + k * C / 4, L.w, 0.06]);
  const seam = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glow(0x14110f), seams.length);
  seams.forEach(([x, z, w, d], i) => { m4.compose(p.set(x, 0.02, z), q.setFromEuler(e.set(-Math.PI / 2, 0, 0)), s.set(w, d, 1)); seam.setMatrixAt(i, m4); });
  root.add(seam);

  // walls: one box per closed edge (plus the outer wall), a darker cap, taller corner posts
  const walls = [], posts = [];
  for (let i = 0; i < L.cols; i++) for (let j = 0; j < L.rows; j++) {
    if (i < L.cols - 1 && !L.open.has(`${i},${j},E`)) walls.push([L.x0 + (i + 1) * C, L.z0 + (j + 0.5) * C, T, C + T]);
    if (j < L.rows - 1 && !L.open.has(`${i},${j},N`)) walls.push([L.x0 + (i + 0.5) * C, L.z0 + (j + 1) * C, C + T, T]);
  }
  walls.push([L.x0 + L.w / 2, L.z0, L.w + T, T], [L.x0 + L.w / 2, L.z0 + L.d, L.w + T, T], [L.x0, L.z0 + L.d / 2, T, L.d + T], [L.x0 + L.w, L.z0 + L.d / 2, T, L.d + T]);
  for (let i = 0; i <= L.cols; i++) for (let j = 0; j <= L.rows; j++) {
    if (L.hall && i > L.hall[0] && i <= L.hall[2] && j > L.hall[1] && j <= L.hall[3]) continue;
    posts.push([L.x0 + i * C, L.z0 + j * C]);
  }
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(look.wall), walls.length);
  const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(look.cap), walls.length);
  walls.forEach(([x, z, w, d], i) => {
    m4.compose(p.set(x, H / 2, z), q.identity(), s.set(w, H, d)); wallMesh.setMatrixAt(i, m4);
    m4.compose(p.set(x, H + 0.15, z), q.identity(), s.set(w + 0.2, 0.3, d + 0.2)); capMesh.setMatrixAt(i, m4);
  });
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(look.post), posts.length);
  posts.forEach(([x, z], i) => { m4.compose(p.set(x, (H + 0.8) / 2, z), q.identity(), s.set(T + 0.5, H + 0.8, T + 0.5)); postMesh.setMatrixAt(i, m4); });
  for (const im of [wallMesh, capMesh, postMesh]) { im.castShadow = true; im.receiveShadow = true; root.add(im); }
  occluders.push(wallMesh, postMesh);
  }

  // torches you can light: a bracket always, a flame once lit
  const tN = L.torchList.length;
  const bracket = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), mat(K.bracket), Math.max(1, tN));
  const flame = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.55, 6), glow(K.flame), Math.max(1, tN));
  const halo = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), glow(K.halo, 0.22), Math.max(1, tN));
  L.torchList.forEach((tc, i) => { m4.compose(p.set(tc.x, 2.5, tc.z), q.identity(), s.set(1, 1, 1)); bracket.setMatrixAt(i, m4); });
  bracket.count = tN; root.add(bracket, flame, halo);

  // water: dark, still, faintly lit (the Galleries)
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0f1c22, emissive: 0x06232a, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.88 });
  if (!ST) for (const c of L.waterCells) { const [x, z] = L.center(c); flat(C - T + 0.2, C - T + 0.2, waterMat, x, 0.05, z); }

  // spike plates: an iron grate per plate, spikes (rise when armed), a warning glow
  const per = 25, spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 1.1, 5), mat(K.spike, { metalness: 0.6, roughness: 0.35 }), Math.max(1, L.trapList.length * per));
  spikes.count = L.trapList.length * per; spikes.castShadow = true; root.add(spikes);
  const plates = L.trapList.map(tr => {
    const w = tr.half * 2;
    flat(w, w, mat(K.plate, { metalness: 0.4 }), tr.x, 0.03, tr.z);
    const warn = flat(w, w, glow(K.warn, 0), tr.x, 0.045, tr.z);
    return { tr, warn, y: -0.6 };
  });

  // chests: a bound box and its lid (deep chests are gilded)
  const chests = L.chestList.map(c => {
    const g = new THREE.Group(); g.position.set(c.x, 0, c.z); g.rotation.y = r() * Math.PI * 2; root.add(g);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.85), mat(c.deep ? K.chestDeep : K.chest)); box.position.y = 0.35; box.castShadow = true; g.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.12, 0.89), mat(c.deep ? K.bandDeep : K.band, { metalness: 0.6 })); band.position.y = 0.55; g.add(band);
    const hinge = new THREE.Group(); hinge.position.set(0, 0.7, -0.42); g.add(hinge);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, 0.85), mat(c.deep ? K.chestDeep : K.chest)); lid.position.set(0, 0.12, 0.42); hinge.add(lid);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), glow(c.deep ? 0xfde047 : 0xfbbf24, 0.5)); shine.position.y = 0.9; g.add(shine);
    return { c, g, hinge, shine, open: false };
  });

  // levers and the portcullis (the Galleries' two-place puzzle)
  const levers = (L.leverList || []).map(lv => {
    const g = new THREE.Group(); g.position.set(lv.x, 0, lv.z); root.add(g);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), mat(0x3b3631)); base.position.y = 0.25; g.add(base);
    const arm = new THREE.Group(); arm.position.y = 0.5; g.add(arm);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6), mat(K.lever)); stick.position.y = 0.7; arm.add(stick); // a long bone
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat(K.leverKnob)); knob.position.y = 1.45; arm.add(knob);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.3, 40), glow(0xf59e0b, 0.3)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    arm.rotation.x = -0.6;
    return { lv, arm, ring, at: -99 };
  });
  let port = null;
  if (L.portEdge) {
    const [i, j, dir] = L.portEdge.split(','), x = L.x0 + (+i + (dir === 'E' ? 1 : 0.5)) * C, z = L.z0 + (+j + (dir === 'N' ? 1 : 0.5)) * C;
    const g = new THREE.Group(); g.position.set(x, 0, z); if (dir === 'E') g.rotation.y = Math.PI / 2; root.add(g);
    const bars = new THREE.Group(); g.add(bars);
    const Hg = Math.max(H, 4), wide = L.bridge ? L.bridge * 2 : C - T; // (the root gate, the wind wall: they sink away when open)
    const barMat = ST ? (L.bridge ? glow(K.gate, 0.45) : mat(K.gate)) : mat(K.gate, { metalness: 0.7, roughness: 0.4 });
    for (let k = -4; k <= 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(ST ? 0.3 : 0.14, Hg, ST ? 0.3 : 0.14), barMat); b.position.set(k * wide / 9, Hg / 2, 0); b.castShadow = !L.bridge; bars.add(b); }
    for (const y of [0.6, Hg / 2, Hg - 0.4]) { const b = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.12, 0.12), barMat); b.position.y = y; bars.add(b); }
    port = { bars, h: 0, open: ST ? -Hg - 0.3 : H - 0.3 };
  }

  // the stairs of this layer: 'up' (pale light from above), 'down' / 'out' (a dark way down, or warm light up to the gate)
  const stairs = stairsOf(L.lab).filter(st => st.L === L).map(st => {
    const g = new THREE.Group(); g.position.set(st.x, 0, st.z); root.add(g);
    const color = st.kind === 'up' ? 0xfef3c7 : st.kind === 'out' ? 0xfbbf24 : 0x93c5fd;
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3 * (k + 1), 0.8), mat(K.stair)); sp.position.set(0, 0.15 * (k + 1), (st.kind === 'up' ? -1 : 1) * (0.4 + k * 0.8)); sp.castShadow = true; g.add(sp); }
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 14, 16, 1, true), glow(color, 0.12)); shaft.position.y = 7; g.add(shaft);
    const ring = new THREE.Mesh(new THREE.RingGeometry(st.r - 0.25, st.r, 48), glow(color, 0.5)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    return { st, g, shaft, ring };
  });

  // landmarks: the Catacombs' bell rope (hangs through the ceiling by the way down), the Ossuary's great bell, bones
  if (!ST && L.id === 'catacombs') {
    const [ex, ez] = endPoint(L);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 30, 6), glow(0xfde68a, 0.85)); rope.position.set(ex + 2.5, 15, ez); root.add(rope);
    const motes = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 12, 1, true), glow(0xfde68a, 0.08)); motes.position.copy(rope.position); root.add(motes);
  }
  if (!ST && L.id === 'ossuary') {
    const [hx, hz] = hallCenter(L);
    const bones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0xd8cdb6), 30);
    for (let i = 0; i < 30; i++) { const a = r() * Math.PI * 2, d = 11 + r() * 5; m4.compose(p.set(hx + Math.sin(a) * d, 0.2, hz + Math.cos(a) * d), q.setFromEuler(e.set(r(), r(), r())), s.set(0.6 + r() * 0.9, 0.35 + r() * 0.5, 0.6 + r() * 0.9)); bones.setMatrixAt(i, m4); }
    bones.castShadow = true; root.add(bones);
    const bier = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 1.8), mat(0x6b6258)); bier.position.set(hx, 0.55, hz - 3); bier.castShadow = true; root.add(bier);
    const candles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), glow(0xfde68a), 16);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; m4.compose(p.set(hx + Math.sin(a) * 8, 0.4, hz + Math.cos(a) * 8), q.identity(), s.set(1, 1.6, 1)); candles.setMatrixAt(i, m4); }
    root.add(candles);
    const rune = flat(1, 1, glow(0xb45309, 0.55), hx, 0.04, hz); rune.geometry = new THREE.RingGeometry(7.6, 8, 64);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 3, 16, 1, true), mat(0x8a6a2a, { metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })); bell.position.set(hx, 9, hz); root.add(bell);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 10, 6), mat(0x52525b)); chain.position.set(hx, 15.5, hz); root.add(chain);
  }
  return { L, root, flame, halo, plates, spikes, per, stairs, chests, levers, port, terrain };
}

// The crypt stair in the field: a dark opening with steps going down, under a stone arch.
function buildEntry(parent, lab) {
  const E = lab.entry, g = new THREE.Group(); g.position.set(E.x, 0, E.z); parent.add(g);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.2), glow(0x050405)); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.04; g.add(hole);
  for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.7), mat(0x3b3631 - k * 0x080808)); sp.position.set(0, 0.05, 1.4 - k * 0.8); g.add(sp); }
  for (const sx of [-1, 1]) { const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 4.4), mat(0x6b645a)); curb.position.set(sx * 1.9, 0.15, 0); g.add(curb); }
  for (const sx of [-1, 1]) { const pil = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.6, 0.6), mat(0x6b645a)); pil.position.set(sx * 2.0, 1.8, -2.1); pil.castShadow = true; g.add(pil); }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.7, 0.8), mat(0x5d564d)); lintel.position.set(0, 3.8, -2.1); lintel.castShadow = true; g.add(lintel);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), mat(0xe7dcc4)); skull.position.set(0, 3.8, -1.65); g.add(skull);
  const ring = new THREE.Mesh(new THREE.RingGeometry(E.use - 0.25, E.use, 48), glow(0xf59e0b, 0.35)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  return { g, ring };
}

// ---------- block models for its enemies (same shape as world.js makeBlockMob) ----------
function part(geo, color, x, y, z, parent) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
export function makeLabMob(type) {
  const ST = STYLES[LABS[LAB_MOBS[type]?.lab]?.style];
  if (ST) return ST.makeMob(type, { THREE, mat, glow, rng, part });
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const legs = []; let armR = null, height = 2.1;
  if (type === 'ghoul') { // a hunched grey-green corpse with long arms and pale eyes
    legs.push(part(new THREE.BoxGeometry(0.22, 0.8, 0.22), 0x3f4a3a, -0.2, 0.4, 0, body), part(new THREE.BoxGeometry(0.22, 0.8, 0.22), 0x3f4a3a, 0.2, 0.4, 0, body));
    const torso = part(new THREE.BoxGeometry(0.75, 0.8, 0.45), 0x5c6b52, 0, 1.15, 0.1, body); torso.rotation.x = 0.45;
    for (let k = 0; k < 3; k++) part(new THREE.BoxGeometry(0.8, 0.05, 0.05), 0xd9cfb5, 0, 1.0 + k * 0.18, 0.36 + k * 0.07, body); // ribs
    const head = part(new THREE.BoxGeometry(0.42, 0.42, 0.42), 0x6f7d63, 0, 1.55, 0.45, body);
    for (const sx of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), glow(0xbef264)); eye.position.set(sx * 0.11, 0.05, 0.22); head.add(eye); }
    armR = new THREE.Group(); armR.position.set(0.45, 1.4, 0.3); body.add(armR);
    part(new THREE.BoxGeometry(0.16, 1.0, 0.16), 0x55624b, 0, -0.45, 0.15, armR).rotation.x = -0.5;
    const armL = new THREE.Group(); armL.position.set(-0.45, 1.4, 0.3); body.add(armL);
    part(new THREE.BoxGeometry(0.16, 1.0, 0.16), 0x55624b, 0, -0.45, 0.15, armL).rotation.x = -0.5;
    height = 2.0;
  } else if (type === 'tombwarden') { // a stone knight effigy that climbs off its tomb: grey armour, a slab shield, a dim helm slit
    const s = 1.25;
    legs.push(part(new THREE.BoxGeometry(0.32 * s, 0.9 * s, 0.32 * s), 0x6b6b6b, -0.22 * s, 0.45 * s, 0, body), part(new THREE.BoxGeometry(0.32 * s, 0.9 * s, 0.32 * s), 0x6b6b6b, 0.22 * s, 0.45 * s, 0, body));
    part(new THREE.BoxGeometry(0.9 * s, 1.0 * s, 0.55 * s), 0x7c7c7c, 0, 1.4 * s, 0, body);
    const helm = part(new THREE.BoxGeometry(0.5 * s, 0.55 * s, 0.5 * s), 0x8a8a8a, 0, 2.15 * s, 0, body);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.06 * s, 0.02), glow(0x7dd3fc)); slit.position.set(0, 0.04 * s, 0.26 * s); helm.add(slit);
    armR = new THREE.Group(); armR.position.set(0.6 * s, 1.8 * s, 0); body.add(armR);
    part(new THREE.BoxGeometry(0.24 * s, 0.9 * s, 0.24 * s), 0x6b6b6b, 0, -0.4 * s, 0, armR);
    part(new THREE.BoxGeometry(0.12 * s, 1.3 * s, 0.12 * s), 0x9ca3af, 0, -1.0 * s, 0.5 * s, armR).rotation.x = Math.PI / 2; // stone sword
    const armL = new THREE.Group(); armL.position.set(-0.6 * s, 1.8 * s, 0); body.add(armL);
    part(new THREE.BoxGeometry(0.15 * s, 1.1 * s, 0.8 * s), 0x57534e, -0.1 * s, -0.5 * s, 0.2 * s, armL); // slab shield
    height = 3.1;
  } else { // the Gravekeeper: a tall hooded figure in a ragged cloak with a lantern on a chain
    const s = 1.5;
    legs.push(part(new THREE.BoxGeometry(0.3 * s, 0.9 * s, 0.3 * s), 0x1f1b24, -0.22 * s, 0.45 * s, 0, body), part(new THREE.BoxGeometry(0.3 * s, 0.9 * s, 0.3 * s), 0x1f1b24, 0.22 * s, 0.45 * s, 0, body));
    part(new THREE.CylinderGeometry(0.45 * s, 0.75 * s, 1.5 * s, 8), 0x2d2735, 0, 1.45 * s, 0, body); // cloak
    const hood = part(new THREE.ConeGeometry(0.42 * s, 0.9 * s, 8), 0x231e2a, 0, 2.55 * s, 0, body);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 8, 6), glow(0x0a0a0a)); face.position.set(0, -0.2 * s, 0.18 * s); hood.add(face);
    for (const sx of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 6, 4), glow(0xfbbf24)); eye.position.set(sx * 0.08 * s, -0.18 * s, 0.33 * s); hood.add(eye); }
    armR = new THREE.Group(); armR.position.set(0.6 * s, 2.0 * s, 0); body.add(armR);
    part(new THREE.BoxGeometry(0.25 * s, 1.0 * s, 0.25 * s), 0x2d2735, 0, -0.45 * s, 0, armR);
    part(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.8 * s, 4), 0x9ca3af, 0, -1.3 * s, 0.1 * s, armR); // the chain
    const lantern = part(new THREE.BoxGeometry(0.35 * s, 0.45 * s, 0.35 * s), 0x3b3024, 0, -1.8 * s, 0.1 * s, armR);
    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 8, 6), glow(0x86efac)); lantern.add(fire);
    const armL = new THREE.Group(); armL.position.set(-0.6 * s, 2.0 * s, 0); body.add(armL);
    part(new THREE.BoxGeometry(0.25 * s, 1.0 * s, 0.25 * s), 0x2d2735, 0, -0.45 * s, 0, armL);
    const bell = part(new THREE.ConeGeometry(0.3 * s, 0.4 * s, 10, 1, true), 0xa16207, 0, -1.05 * s, 0, armL); bell.material.side = THREE.DoubleSide;
    height = 4.4;
  }
  const cursor = new THREE.Mesh(new THREE.OctahedronGeometry(type === 'gravekeeper' ? 0.22 : 0.14), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.2; g.add(cursor);
  const mats = [];
  g.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) mats.push(o.material); });
  return { group: g, body, legs, armR, cursor, mats, height };
}

// ---------- the client runtime ----------
// ctx: { scene, occluders, sun, floor1, fx, sfx, state, mobs, send, banner, callout, log, project, tip }
export function initLabClient(ctx) {
  const { scene, state, sfx, fx } = ctx;
  const views = new Map(LAYERS.map(L => [L.id, buildLayer(scene, L, ctx.occluders)]));
  const H = { THREE, mat, glow, rng, flat: null, occluders: ctx.occluders };
  const entries = Object.fromEntries(LAB_FLOORS.map(f => [f, STYLES[LABS[f].style] ? STYLES[LABS[f].style].buildEntry(scene, LABS[f], H) : buildEntry(ctx.floor1, LABS[f])]));
  const hemi = scene.children.find(o => o.isHemisphereLight);
  const torch = new THREE.PointLight(0xffa64d, 3.2, 20, 1.5); torch.visible = false; scene.add(torch);
  const base = { sky: scene.background.clone(), near: scene.fog.near, far: scene.fog.far, hemi: hemi?.intensity ?? 1, sun: ctx.sun?.intensity ?? 1 };
  let k = 0, sOff = null, time = 0, dirty = false, lures = 0, lastL = null;
  const airSky = new THREE.Color();
  const gutter = {}, opened = new Map(); // guttering s per layer; chests you've emptied -> when they fill again (performance.now s)
  const lureFx = [];

  // labels: the stairs, and a line for your lures
  const labels = document.getElementById('labels');
  const mkLabel = () => { const el = document.createElement('div'); el.className = 'lbl npc'; el.style.display = 'none'; labels.appendChild(el); return el; };
  const lblIn = mkLabel(), lblNear = mkLabel();
  function place(el, x, y, z, html, maxD) {
    const p = ctx.project(x, y, z), d = Math.hypot(state.x - x, state.z - z);
    if (!p || d > maxD || !state.joined || state.spectator) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = `${p[0]}px`; el.style.top = `${p[1]}px`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  const prompt = verb => `<br><small>${tapping() ? `tap ${verb}` : `press ${keyHtml('interact')} to ${verb}`}</small>`;
  const now = () => (sOff === null ? 0 : performance.now() / 1000 + sOff);

  // what's in reach: a stair, a chest, a lever, an unlit torch (nearest first); else a lure throw while you carry one
  const REACH = 2.6;
  const isOpen = (l, k) => { const u = opened.get(`${l}:${k}`); return u !== undefined && u > performance.now() / 1000; };
  function near() {
    if (state.dead || !state.joined || state.spectator) return null;
    for (const f of LAB_FLOORS) for (const st of stairsOf(LABS[f])) if (Math.hypot(state.x - st.x, state.z - st.z) < st.r) return { a: 'stair', st, x: st.x, z: st.z };
    const L = labAt(state.x, state.z); if (!L) return null;
    let best = null;
    const consider = (a, o) => { const d = Math.hypot(state.x - o.x, state.z - o.z); if (d < REACH && (!best || d < best.d)) best = { a, o, x: o.x, z: o.z, d }; };
    let empty = false; // (standing at an emptied chest: no prompt, and no stray rattle throw)
    for (const c of L.chestList) { if (!isOpen(L.id, c.k)) consider('chest', c); else if (Math.hypot(state.x - c.x, state.z - c.z) < REACH) empty = true; }
    if (!portOpen(L, now())) for (const lv of L.leverList || []) consider('lever', lv);
    const lit = new Set(labRun.lit[L.id] || []);
    for (const tc of L.torchList) if (!lit.has(tc.k)) consider('torch', tc);
    if (best) return best;
    return lures > 0 && !empty ? { a: 'lure' } : null;
  }
  function interactKind() { const n = near(); return n ? `lab-${n.a}` : null; }
  function interact(kind) {
    if (!kind?.startsWith('lab-')) return false;
    ctx.send({ type: 'lab', a: kind.slice(4), face: state.yaw }); sfx.play('ui'); return true;
  }
  const actLabel = a => ({ stair: 'Enter', chest: 'Open', lever: 'Pull', torch: 'Light', lure: 'Throw' })[a];

  function snap(lb) {
    if (!lb) return;
    sOff = lb[0] - performance.now() / 1000;
    applyLabSnap(lb);
    for (const [id, , , g] of lb[1] || []) gutter[id] = g;
  }

  function onEvent(e) {
    const mine = e.id === state.myId || e.to === state.myId || e.by === state.myId;
    switch (e.t) {
      case 'labtp':
        if (e.id === state.myId) {
          lures = e.lu ?? lures;
          const lab = LABS[e.f], to = lab.layers.find(L => L.id === e.l);
          if (e.k === 'in') { ctx.banner(lab.name.toUpperCase(), hasLabKey(state.inv?.life, e.f) ? 'The way is known to you' : `Find ${KEEPER_NAME[e.f]}. Take the ${lab.keyName}.`); ctx.tip?.(e.f === 1 ? 'lab' : `lab${e.f}`); }
          else if (to && e.k === 'down') ctx.banner(to.name.toUpperCase(), DOWN_LINE[to.id] || '');
          sfx.play('ui');
        }
        return true;
      case 'lab':
        if (e.s === 'breathe' && labAt(state.x, state.z)?.id === e.l) { const B = BREATHE[e.k] || BREATHE.rise; ctx.callout(B[0], e.p >= 1 ? B[2] : B[1], 3); sfx.play('warn', null, 0.8); }
        else if (e.s === 'rise') fx.sparks?.(e.x, 0.4, e.z, 10, colorsOf(labAt(e.x, e.z)).warn === CRYPT_COLORS.warn ? 0x84cc16 : colorsOf(labAt(e.x, e.z)).halo, 0.25, 3);
        else if (e.s === 'call' && labAt(state.x, state.z)) ctx.callout(...(CALL[labAt(state.x, state.z).floor] || CALL[1]), 2.5);
        else if (e.s === 'locked' && mine) ctx.callout(LOCK[e.f] || 'THE LOCK', `Find the ${LABS[e.f].keyName} in ${LABS[e.f].name} first`, 3);
        else if (e.s === 'wisps') { if (labAt(state.x, state.z)?.id === e.l) wispsAt(e); }
        else if (e.s === 'ambush' && labAt(state.x, state.z)?.id === e.l) { ctx.callout('A FALSE LIGHT', 'Lurkers rise from the mud!', 2); fx.sparks?.(e.x, 0.4, e.z, 14, 0x65a30d, 0.3, 3); }
        else if (e.s === 'strike') { const Lh = labAt(state.x, state.z); if (Lh?.id === e.l) markRing(e.x, e.z, e.r, e.d, 0xfde047, () => { fx.sparks?.(e.x, 0.5, e.z, 16, 0xe0f2fe, 0.4, 6); sfx.play('hit', { x: e.x, z: e.z }, 0.7); }); }
        else if (e.s === 'dive') { const m = ctx.mobs?.get(e.id); if (m) m.labSink = 1; for (const [x, z] of e.spots) markRing(x, z, e.r, e.d, 0x2dd4bf); if (labAt(state.x, state.z)) ctx.callout('SHE DIVES', 'Ripples under your feet: move!', 1.6); }
        else if (e.s === 'erupt') { const m = ctx.mobs?.get(e.id); if (m) m.labSink = 0; fx.sparks?.(e.x, 0.6, e.z, 24, 0x5eead4, 0.4, 7); sfx.play('hit', { x: e.x, z: e.z }); if (labAt(state.x, state.z)) ctx.callout('STRANDED', 'Hit her now!', 1.6); }
        else if (e.s === 'lane') { markLane(e.a, e.w, e.d); if (labAt(state.x, state.z)) ctx.callout('SHE MARKS A LANE', 'Step out of the line!', 1.4); }
        else if (e.s === 'perch') { fx.sparks?.(e.x, 1.2, e.z, 18, 0xbae6fd, 0.4, 6); if (labAt(state.x, state.z)) ctx.callout('SHE PERCHES', 'Hit her now!', 1.6); }
        else if (e.s === 'gale') { if (labAt(state.x, state.z)) { gale = { x: e.x, z: e.z, until: now() + e.d, k: e.k }; ctx.callout('THE GALE', 'Lean into the wind: the rim stings', 2); sfx.play('warn', null, 0.7); } }
        else if (e.s === 'kreset') { const m = ctx.mobs?.get(e.id); if (m) m.labSink = 0; }
        else if (e.s === 'chest') { if (mine) { opened.set(`${e.l}:${e.k}`, performance.now() / 1000 + (LAYERS.find(Q => Q.id === e.l)?.loot.cd ?? 600)); lures = e.lu ?? lures; sfx.play('loot'); } }
        else if (e.s === 'lever') { const v = views.get(e.l)?.levers[e.k]; if (v) v.at = performance.now() / 1000; sfx.play('ui', null, 0.6); if (labAt(state.x, state.z)?.id === e.l) ctx.callout('A LEVER CLANKS', `The other must follow within ${Math.round(e.d)} s`, 2); }
        else if (e.s === 'port') { sfx.play('clear', null, 0.5); const Lp = LAYERS.find(Q => Q.id === e.l); if (labAt(state.x, state.z)?.id === e.l) ctx.callout(`THE ${LAB_WORDS[Lp.floor].gate.toUpperCase()} OPENS`, `The way to ${Lp.lab.layers[Lp.li + 1]?.name || 'the heart'} is open`, 3); }
        else if (e.s === 'torch') sfx.play('ui', null, 0.4);
        else if (e.s === 'wake') { const m = ctx.mobs?.get(e.id); if (m && Math.hypot(m.x - state.x, m.z - state.z) < 30) { const f = labAt(m.x, m.z)?.floor || 1; ctx.callout(WAKE[f][0], WAKE[f][1], 2.5); ctx.tip?.('labnoise'); } }
        else if (e.s === 'lure') { if (mine) lures = e.lu ?? lures; lureAt(e); }
        return true;
      case 'labkey':
        if (e.id === state.myId) {
          const lab = LABS[e.f];
          if (e.first) { ctx.banner(lab.keyName.toUpperCase(), `${GATE_NAME[e.f][0].toUpperCase()}${GATE_NAME[e.f].slice(1)} will open for you now`); sfx.play('levelup'); }
          else ctx.log(`You take another ${lab.keyName}.`, 'sys');
        }
        return true;
    }
    return false;
  }

  // telegraphs: a glowing disc that fills in until it lands (lightning, the Mother's ripples), a lane (the Matriarch's dive)
  const marks = [];
  function markRing(x, z, r, d, color, onEnd) {
    const g = new THREE.Group(); g.position.set(x, 0.07, z); scene.add(g);
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r, 40), glow(color, 0.8)); edge.rotation.x = -Math.PI / 2; g.add(edge);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), glow(color, 0.25)); fill.rotation.x = -Math.PI / 2; fill.position.y = -0.01; g.add(fill);
    marks.push({ g, fill, t0: performance.now() / 1000, d: Math.max(0.2, d), onEnd });
  }
  function markLane([x0, z0, x1, z1], w, d) {
    const len = Math.hypot(x1 - x0, z1 - z0) || 1, g = new THREE.Group(); g.position.set((x0 + x1) / 2, 0.07, (z0 + z1) / 2); g.rotation.y = Math.atan2(x1 - x0, z1 - z0); scene.add(g);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, len), glow(0x7dd3fc, 0.3)); fill.rotation.x = -Math.PI / 2; g.add(fill);
    marks.push({ g, fill, t0: performance.now() / 1000, d: Math.max(0.2, d) });
  }
  // the wisps: your true one drifts toward the way on, the false one into a dead end (it flickers; the true one doesn't)
  const wispFx = [];
  function wispsAt(e) {
    const set = e.sets.find(q => q.id === state.myId); if (!set) return;
    const L = LAYERS.find(Q => Q.id === e.l);
    set.w.forEach((cells, i) => {
      const pts = cells.map(c => L.center(c));
      const g = new THREE.Group(); scene.add(g);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glow(i === set.tr ? 0xfde68a : 0xd9f99d)); g.add(core);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), glow(i === set.tr ? 0xfbbf24 : 0xa3e635, 0.25)); g.add(halo);
      wispFx.push({ g, halo, pts, t0: performance.now() / 1000, d: e.d, liar: i !== set.tr, ph: i * 1.7 });
    });
  }
  function updateFx(dt) {
    const wall = performance.now() / 1000;
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i], u = (wall - m.t0) / m.d;
      m.fill.material.opacity = 0.15 + 0.45 * Math.min(1, u);
      if (u >= 1) { m.onEnd?.(); scene.remove(m.g); m.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); marks.splice(i, 1); }
    }
    for (let i = wispFx.length - 1; i >= 0; i--) {
      const w = wispFx[i], el = wall - w.t0, seg = 2.4, f = Math.min(w.pts.length - 1, el / seg), a = Math.floor(f), b = Math.min(w.pts.length - 1, a + 1), u = f - a;
      const x = w.pts[a][0] + (w.pts[b][0] - w.pts[a][0]) * u, z = w.pts[a][1] + (w.pts[b][1] - w.pts[a][1]) * u;
      w.g.position.set(x + Math.sin(el * 1.3 + w.ph) * 0.5, 1.6 + Math.sin(el * 2.1 + w.ph) * 0.3, z + Math.cos(el * 1.1 + w.ph) * 0.5);
      w.halo.material.opacity = w.liar ? 0.12 + 0.18 * Math.abs(Math.sin(el * 9 + w.ph)) : 0.25;
      if (el > w.d) { scene.remove(w.g); w.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); wispFx.splice(i, 1); }
    }
    // a mini-boss under the water: it sinks out of sight (and comes back up)
    for (const m of ctx.mobs?.values() || []) if (m.labSink !== undefined && m.model?.body) { const want = m.labSink ? -3.5 : 0; m.model.body.position.y += (want - m.model.body.position.y) * Math.min(1, dt * 5); }
  }

  // Wind on the causeways and the Matriarch's gale: a drift (m) to add to your own step this frame.
  let gale = null;
  function drift(dt, guarding) {
    const L = labAt(state.x, state.z); if (!L || state.dead) return null;
    let dx = 0, dz = 0;
    const brace = guarding ? 0.35 : 1, t = now();
    if (L.wind) { const w = windAt(L, t), kf = (onBridge(L, state.x, state.z) ? 1 : 0.3) * L.wind.push * brace * dt; dx += w[0] * kf; dz += w[1] * kf; }
    if (gale && t < gale.until && L.hall) { const ax = state.x - gale.x, az = state.z - gale.z, d = Math.hypot(ax, az) || 1; dx += ax / d * gale.k * brace * dt; dz += az / d * gale.k * brace * dt; }
    return dx || dz ? [dx, dz] : null;
  }

  // a thrown bone rattle: a small bone on the floor and soft rings while it rattles
  function lureAt(e) {
    const g = new THREE.Group(); g.position.set(e.x, 0, e.z); scene.add(g);
    const bone = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.08, 0.5, 4, 6) : new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), mat(colorsOf(labAt(e.x, e.z)).lure)); bone.rotation.z = Math.PI / 2; bone.position.y = 0.12; g.add(bone);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 32), glow(0xfde68a, 0.5)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    lureFx.push({ g, ring, bone, until: performance.now() / 1000 + (e.d || LURE.secs) });
    sfx.play('ui', { x: e.x, z: e.z }, 0.6);
  }

  const tmp = { m4: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3() };
  const SPIKE_UP = 0.35, SPIKE_DOWN = -0.6;
  function update(dt, me) {
    time += dt;
    updateFx(dt);
    const L = labAt(state.x, state.z), inside = !!L && state.joined, t = now(), wall = performance.now() / 1000;
    if (L) lastL = L;
    k += ((inside ? 1 : 0) - k) * Math.min(1, dt * (inside ? 4 : 2.5)); if (Math.abs(k - (inside ? 1 : 0)) < 0.01) k = inside ? 1 : 0;
    const g = L ? gutter[L.id] || 0 : 0;
    // the crypt's air: dark, close fog (closer still while the torches gutter), dim light, your own torch
    const lerp = (a, b) => a + (b - a) * k;
    if (k > 0 || dirty) { // (one last pass at k = 0 puts the floor's own air back)
      const A = airOf(L || lastL); airSky.setHex(A.sky);
      scene.fog.near = lerp(base.near, A.near); scene.fog.far = lerp(base.far, g > 0 ? A.gutterFar : A.far);
      scene.background.copy(base.sky).lerp(airSky, k); scene.fog.color.copy(scene.background);
      if (hemi) hemi.intensity = lerp(base.hemi, A.hemi);
      if (ctx.sun) ctx.sun.intensity = lerp(base.sun, A.sun);
      if (torch.userData.air !== A) { torch.userData.air = A; torch.color.setHex(A.torch ?? 0xffa64d); }
      dirty = k > 0;
    } else { // outside: remember the floor's current air (floor2world.js blends it between floors)
      base.sky.copy(scene.background); base.near = scene.fog.near; base.far = scene.fog.far;
      if (hemi) base.hemi = hemi.intensity; if (ctx.sun) base.sun = ctx.sun.intensity;
    }
    ctx.floor1.visible = ctx.floor1.visible && k < 0.98; // the field and the sky tower aren't seen from below
    torch.visible = k > 0.02;
    if (torch.visible && me) { torch.position.set(me.x, 2.6, me.z); torch.intensity = 3.2 * k * (g > 0 ? 0.55 : 1) * (0.92 + 0.08 * Math.sin(time * 13) * Math.sin(time * 7.3)); }

    const { m4, q, s, p } = tmp;
    for (const V of views.values()) {
      const Lv = V.L, here = L === Lv;
      V.root.visible = k > 0.02 && here; // only your own layer is drawn
      if (!V.root.visible) continue;
      V.terrain?.update(dt, time, { phase: shiftPhase(Lv, t), phaseLeft: shiftLeft(Lv, t), wind: windAt(Lv, t), gutter: g, t });
      // torches: lit ones flicker (lower while the crypt breathes)
      const lit = labRun.lit[Lv.id] || [], low = g > 0 ? 0.35 : 1;
      lit.forEach((id, i) => {
        const tc = Lv.torchList[id]; if (!tc) return;
        const fl = (0.85 + 0.25 * Math.sin(time * 11 + id * 1.7)) * low;
        m4.compose(p.set(tc.x, 2.95, tc.z), q.identity(), s.set(fl, fl * (1 + 0.2 * Math.sin(time * 9 + id)), fl)); V.flame.setMatrixAt(i, m4);
        m4.compose(p.set(tc.x, 2.95, tc.z), q.identity(), s.set(fl * 1.4, fl * 1.4, fl * 1.4)); V.halo.setMatrixAt(i, m4);
      });
      V.flame.count = V.halo.count = lit.length; V.flame.instanceMatrix.needsUpdate = V.halo.instanceMatrix.needsUpdate = true;
      // spike plates (server time from the snapshot)
      let n = 0;
      for (const pl of V.plates) {
        const st = trapState(Lv, pl.tr, t), want = st === 2 ? SPIKE_UP : SPIKE_DOWN;
        pl.y += (want - pl.y) * Math.min(1, dt * (st === 2 ? 30 : 6));
        pl.warn.material.opacity = st === 1 ? 0.25 + 0.2 * Math.sin(time * 20) : st === 2 ? 0.15 : 0;
        const step = (pl.tr.half * 2) / 5;
        for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) { m4.compose(p.set(pl.tr.x - pl.tr.half + step * (a + 0.5), pl.y, pl.tr.z - pl.tr.half + step * (b + 0.5)), q.identity(), s.set(1, 1, 1)); V.spikes.setMatrixAt(n++, m4); }
      }
      V.spikes.instanceMatrix.needsUpdate = true;
      for (const c of V.chests) { const o = isOpen(Lv.id, c.c.k); c.hinge.rotation.x += ((o ? -1.9 : 0) - c.hinge.rotation.x) * Math.min(1, dt * 6); c.shine.visible = !o; if (!o) c.shine.position.y = 0.9 + 0.08 * Math.sin(time * 3 + c.c.k); }
      for (const v of V.levers) { const down = wall - v.at < 8 || portOpen(Lv, t); v.arm.rotation.x += ((down ? 0.6 : -0.6) - v.arm.rotation.x) * Math.min(1, dt * 8); v.ring.material.opacity = down ? 0.6 : 0.25 + 0.1 * Math.sin(time * 3); }
      if (V.port) { const want = portOpen(Lv, t) ? V.port.open : 0; V.port.h += (want - V.port.h) * Math.min(1, dt * 1.5); V.port.bars.position.y = V.port.h; }
      for (const st of V.stairs) st.shaft.material.opacity = 0.1 + 0.05 * Math.sin(time * 2);
    }
    for (let i = lureFx.length - 1; i >= 0; i--) {
      const u = lureFx[i], left = u.until - wall;
      const ph = (time * 1.6) % 1; u.ring.scale.setScalar(1 + ph * 8); u.ring.material.opacity = 0.5 * (1 - ph); u.bone.rotation.y = Math.sin(time * 30) * 0.3;
      if (left <= 0) { scene.remove(u.g); u.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); lureFx.splice(i, 1); }
    }

    // each labyrinth's way in, in its floor's field (the label goes on the nearest one)
    let fe = null, fd = 1e9;
    for (const f of LAB_FLOORS) {
      const lab = LABS[f], E = entries[f], d = Math.hypot(state.x - lab.entry.x, state.z - lab.entry.z), nb = d < lab.entry.use;
      E.ring.material.opacity = nb ? 0.7 : 0.3 + 0.1 * Math.sin(time * 2);
      if (d < fd) { fd = d; fe = f; }
    }
    if (k < 0.5 && fe) {
      const lab = LABS[fe], nb = fd < lab.entry.use;
      place(lblIn, lab.entry.x, 4.8, lab.entry.z - 2.1, `${lab.name}${hasLabKey(state.inv?.life, fe) ? '' : `<br><small>the ${lab.keyName} lies within</small>`}${nb ? prompt(fe === 1 ? 'descend' : 'enter') : ''}`, 40);
    } else lblIn.style.display = 'none';
    // the thing in reach inside (or a stair's name)
    const nb = inside ? near() : null, W = LAB_WORDS[L?.floor || 1];
    if (nb && nb.a !== 'lure') {
      const st = nb.st, txt = nb.a === 'stair'
        ? (st.kind === 'up' ? (st.to ? `Back to ${st.to.name}` : `Out to ${FIELD[L.floor]}`) : st.kind === 'out' ? `On to ${GATE_NAME[L.floor]}${hasLabKey(state.inv?.life, L.floor) ? '' : `<br><small>(the gate needs the ${L.lab.keyName})</small>`}` : `On to ${st.to.name}`) + prompt(L.floor === 1 ? 'climb' : 'go')
        : nb.a === 'chest' ? `${nb.o.deep ? W.deep : W.chest}${prompt('open')}` : nb.a === 'lever' ? `${W.lever}${prompt(L.floor === 1 ? 'pull' : 'turn')}` : `${W.torch}${prompt('light')}`;
      place(lblNear, nb.x, nb.a === 'stair' ? 4.2 : 2.4, nb.z, txt, 12);
    } else if (inside && (lures > 0 || L.shift || L.wind)) {
      const bits = [];
      if (L.shift) bits.push(`${L.shift.names[shiftPhase(L, t)]} · turns in ${Math.ceil(shiftLeft(L, t))} s`);
      if (L.wind) { const w = windAt(L, t); bits.push(`Wind ${w[1] > 0 ? 'north' : w[1] < 0 ? 'south' : w[0] > 0 ? 'east' : 'west'}ward · turns in ${Math.ceil(windLeft(L, t))} s`); }
      if (lures > 0) bits.push(`${W.lure[0].toUpperCase()}${W.lure.slice(1)}s: ${lures}${tapping() ? ' · tap Throw' : ` · ${keyHtml('interact')} to throw`}`);
      place(lblNear, state.x, 3.4, state.z, `<small>${bits.join('<br>')}</small>`, 5);
    } else lblNear.style.display = 'none';
  }

  // the gate box line (Floor 1's raid gate) while you don't hold the key yet
  const WAY_IN = { 1: 'crypt stair west of the road', 2: 'root hollow west of the boardwalk', 3: 'cloud landing west of the road' };
  const gateLine = f => (!LABS[f] || hasLabKey(state.inv?.life, f) ? '' : `<br><b style="color:#fbbf24">${LOCK[f].slice(4).toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}</b>: needs the ${LABS[f].keyName} from ${LABS[f].name} (${WAY_IN[f]})`);
  const speedMult = () => labSpeedAt(state.x, state.z); // wading (client prediction)
  return { update, snap, onEvent, interactKind, interact, actLabel, gateLine, speedMult, drift, inLab: () => k > 0.5 };
}
