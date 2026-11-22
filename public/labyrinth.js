// Labyrinths (docs/briefs/labyrinths.md): the client. Builds each labyrinth's look (Floor 1: the Undercrypt, a torchlit
// stone maze with an ossuary at its heart), its stairs and spike plates, the crypt's darkness and your torch, the
// prompts, and the events (the crypt breathing, the dead rising, the key). Block models for its enemies.
// Data and geometry: shared/labyrinth.js. Server: server/labyrinth.js.
import * as THREE from 'three';
import { LABS, LAB_FLOORS, labAt, startPoint, endPoint, hallCenter, trapState, hasLabKey } from '/shared/labyrinth.js';
import { keyHtml, tapping } from '/keyname.js';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, flatShading: true, ...opts });
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// The crypt's air (blended in while you're inside): sky / fog colour, fog near and far, light.
const CRYPT = { sky: 0x0b0a0e, near: 8, far: 46, gutterFar: 17, hemi: 0.35, sun: 0.25 };
const cryptSky = new THREE.Color(CRYPT.sky);

// ---------- the scenery ----------
function buildLab(scene, L, occluders) {
  const root = new THREE.Group(); root.name = `lab-${L.id}`; scene.add(root);
  const r = rng(L.seed + 7), C = L.cell, T = L.wall, H = L.height, h = L.h;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  // floor: dark flagstones, the Ossuary's floor a paler bone-dust stone
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.d), mat(0x2a2622));
  floor.rotation.x = -Math.PI / 2; floor.position.set(L.x0 + L.w / 2, 0.015, L.z0 + L.d / 2); floor.receiveShadow = true; root.add(floor);
  const [a0, b0, a1, b1] = L.hall, [hx, hz] = hallCenter(L);
  const hall = new THREE.Mesh(new THREE.PlaneGeometry((a1 - a0 + 1) * C - T, (b1 - b0 + 1) * C - T), mat(0x4a433a));
  hall.rotation.x = -Math.PI / 2; hall.position.set(hx, 0.025, hz); hall.receiveShadow = true; root.add(hall);
  // flagstone seams: a grid of thin dark lines over the corridors
  const seams = [];
  for (let k = 0; k <= L.cols * 4; k++) seams.push([L.x0 + k * 2.5, L.z0 + L.d / 2, 0.06, L.d]);
  for (let k = 0; k <= L.rows * 4; k++) seams.push([L.x0 + L.w / 2, L.z0 + k * 2.5, L.w, 0.06]);
  const seam = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glow(0x14110f), seams.length);
  seams.forEach(([x, z, w, d], i) => { m4.compose(p.set(x, 0.02, z), q.setFromEuler(e.set(-Math.PI / 2, 0, 0)), s.set(w, d, 1)); seam.setMatrixAt(i, m4); });
  root.add(seam);

  // walls: one box per closed edge (plus the outer wall), stone with a darker cap
  const walls = [];
  for (let i = 0; i < L.cols; i++) for (let j = 0; j < L.rows; j++) {
    if (i < L.cols - 1 && !L.open.has(`${i},${j},E`)) walls.push([L.x0 + (i + 1) * C, L.z0 + (j + 0.5) * C, T, C + T]);
    if (j < L.rows - 1 && !L.open.has(`${i},${j},N`)) walls.push([L.x0 + (i + 0.5) * C, L.z0 + (j + 1) * C, C + T, T]);
  }
  walls.push([L.x0 + L.w / 2, L.z0, L.w + T, T], [L.x0 + L.w / 2, L.z0 + L.d, L.w + T, T], [L.x0, L.z0 + L.d / 2, T, L.d + T], [L.x0 + L.w, L.z0 + L.d / 2, T, L.d + T]);
  const posts = []; // the corner posts, a little taller
  for (let i = 0; i <= L.cols; i++) for (let j = 0; j <= L.rows; j++) {
    const x = L.x0 + i * C, z = L.z0 + j * C;
    if (i > a0 && i <= a1 && j > b0 && j <= b1) continue; // (none inside the Ossuary)
    posts.push([x, z]);
  }
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x5b544c), walls.length);
  const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x3a3530), walls.length);
  walls.forEach(([x, z, w, d], i) => {
    m4.compose(p.set(x, H / 2, z), q.identity(), s.set(w, H, d)); wallMesh.setMatrixAt(i, m4);
    m4.compose(p.set(x, H + 0.15, z), q.identity(), s.set(w + 0.2, 0.3, d + 0.2)); capMesh.setMatrixAt(i, m4);
  });
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x4a443e), posts.length);
  posts.forEach(([x, z], i) => { m4.compose(p.set(x, (H + 0.8) / 2, z), q.identity(), s.set(T + 0.5, H + 0.8, T + 0.5)); postMesh.setMatrixAt(i, m4); });
  for (const im of [wallMesh, capMesh, postMesh]) { im.castShadow = true; im.receiveShadow = true; root.add(im); }
  occluders.push(wallMesh, postMesh);

  // torches: on about a third of the walls, a bracket and a flickering flame on one face
  const torches = [];
  walls.forEach(([x, z, w, d], i) => {
    if (i >= walls.length - 4 || r() > 0.38) return;
    const alongX = w > d, side = r() < 0.5 ? -1 : 1;
    torches.push(alongX ? [x + (r() - 0.5) * 3, z + side * (T / 2 + 0.15), side, true] : [x + side * (T / 2 + 0.15), z + (r() - 0.5) * 3, side, false]);
  });
  const bracket = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mat(0x2a211a), torches.length);
  const flame = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.55, 6), glow(0xffa53a), torches.length);
  const halo = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), glow(0xff7a1a, 0.22), torches.length);
  torches.forEach(([x, z], i) => { m4.compose(p.set(x, 2.5, z), q.identity(), s.set(1, 1, 1)); bracket.setMatrixAt(i, m4); });
  root.add(bracket, flame, halo);

  // the Ossuary: bone heaps, a ring of candles and the Gravekeeper's bier
  const bones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0xd8cdb6), 26);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 9 + r() * 4;
    m4.compose(p.set(hx + Math.sin(a) * d, 0.2, hz + Math.cos(a) * d), q.setFromEuler(e.set(r(), r(), r())), s.set(0.6 + r() * 0.9, 0.35 + r() * 0.5, 0.6 + r() * 0.9));
    bones.setMatrixAt(i, m4);
  }
  bones.castShadow = true; root.add(bones);
  const bier = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 1.8), mat(0x6b6258)); bier.position.set(hx, 0.55, hz - 3); bier.castShadow = true; root.add(bier);
  const candles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), glow(0xfde68a), 12);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; m4.compose(p.set(hx + Math.sin(a) * 6.5, 0.4, hz + Math.cos(a) * 6.5), q.identity(), s.set(1, 1.6, 1)); candles.setMatrixAt(i, m4); }
  root.add(candles);
  const rune = new THREE.Mesh(new THREE.RingGeometry(6.2, 6.6, 64), glow(0xb45309, 0.55)); rune.rotation.x = -Math.PI / 2; rune.position.set(hx, 0.04, hz); root.add(rune);

  // the stairs: up out of the start (back to the field), up out of the end (to the Chamber Gate)
  const stairs = [];
  const stair = (x, z, color) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); root.add(g);
    for (let k = 0; k < 4; k++) { const st = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3 * (k + 1), 0.8), mat(0x6a625a)); st.position.set(0, 0.15 * (k + 1), 0.4 + k * 0.8); st.castShadow = true; g.add(st); }
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 14, 16, 1, true), glow(color, 0.12)); shaft.position.y = 7; g.add(shaft);
    const ring = new THREE.Mesh(new THREE.RingGeometry(L.use - 0.25, L.use, 48), glow(color, 0.5)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    stairs.push({ g, shaft, ring }); return g;
  };
  const [sx, sz] = startPoint(L), [ex, ez] = endPoint(L);
  stair(sx, sz + 1.5, 0xfef3c7); stair(ex, ez, 0xfbbf24);

  // spike plates: an iron grate per plate, spikes (rise when armed), a warning glow
  const per = 25, spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 1.1, 5), mat(0x9aa0a6, { metalness: 0.6, roughness: 0.35 }), L.trapList.length * per);
  spikes.castShadow = true; root.add(spikes);
  const plates = L.trapList.map(tr => {
    const w = tr.half * 2;
    const grate = new THREE.Mesh(new THREE.PlaneGeometry(w, w), mat(0x24201d, { metalness: 0.4 })); grate.rotation.x = -Math.PI / 2; grate.position.set(tr.x, 0.03, tr.z); root.add(grate);
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(w, w), glow(0xef4444, 0)); warn.rotation.x = -Math.PI / 2; warn.position.set(tr.x, 0.045, tr.z); root.add(warn);
    return { tr, warn, y: -0.6 };
  });
  return { root, torches, flame, halo, plates, spikes, per, stairs };
}

// The crypt stair in the field: a dark opening with steps going down, under a stone arch.
function buildEntry(scene, L) {
  const E = L.entry, g = new THREE.Group(); g.position.set(E.x, 0, E.z); scene.add(g);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.2), glow(0x050405)); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.04; g.add(hole);
  for (let k = 0; k < 4; k++) { const st = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.7), mat(0x3b3631 - k * 0x080808)); st.position.set(0, 0.05, 1.4 - k * 0.8); g.add(st); }
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
// ctx: { scene, occluders, sun, floor1, fx, sfx, state, players, send, banner, callout, log, project, shake, tip }
export function initLabClient(ctx) {
  const { scene, state, sfx, fx } = ctx;
  const views = {}, entries = {};
  for (const f of LAB_FLOORS) { views[f] = buildLab(scene, LABS[f], ctx.occluders); entries[f] = buildEntry(ctx.floor1, LABS[f]); }
  const hemi = scene.children.find(o => o.isHemisphereLight);
  const torch = new THREE.PointLight(0xffa64d, 3.2, 20, 1.5); torch.visible = false; scene.add(torch);
  const base = { sky: scene.background.clone(), near: scene.fog.near, far: scene.fog.far, hemi: hemi?.intensity ?? 1, sun: ctx.sun?.intensity ?? 1 };
  let k = 0, sOff = null, gutter = 0, time = 0, dirty = false;

  // labels: each stair's name and prompt
  const labels = document.getElementById('labels');
  const mkLabel = () => { const el = document.createElement('div'); el.className = 'lbl npc'; el.style.display = 'none'; labels.appendChild(el); return el; };
  const lbl = { in: mkLabel(), out: mkLabel(), up: mkLabel() };
  function place(el, x, y, z, html, maxD) {
    const p = ctx.project(x, y, z), d = Math.hypot(state.x - x, state.z - z);
    if (!p || d > maxD || !state.joined || state.spectator) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = `${p[0]}px`; el.style.top = `${p[1]}px`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  const prompt = verb => `<br><small>${tapping() ? 'tap Enter' : `press ${keyHtml('interact')} to ${verb}`}</small>`;

  // which stair you're in reach of: 'in' | 'out' | 'up' (and its labyrinth)
  function nearStair() {
    for (const f of LAB_FLOORS) {
      const L = LABS[f], [sx, sz] = startPoint(L), [ex, ez] = endPoint(L);
      if (Math.hypot(state.x - L.entry.x, state.z - L.entry.z) < L.entry.use) return 'in';
      if (Math.hypot(state.x - sx, state.z - sz) < L.use) return 'out';
      if (Math.hypot(state.x - ex, state.z - ez) < L.use) return 'up';
    }
    return null;
  }
  function interactKind() {
    if (state.dead || !state.joined || state.spectator) return null;
    const s = nearStair();
    return s ? `lab-${s}` : null;
  }
  function interact(kind) {
    if (!kind?.startsWith('lab-')) return false;
    ctx.send({ type: 'lab', a: kind.slice(4) }); sfx.play('ui'); return true;
  }

  function snap(lb) {
    if (!lb) return;
    const now = performance.now() / 1000;
    sOff = lb[0] - now; gutter = lb[1] || 0;
  }

  function onEvent(e) {
    switch (e.t) {
      case 'labtp':
        if (e.id === state.myId) {
          const L = LABS[e.f];
          if (e.a === 'in') { ctx.banner(L.name.toUpperCase(), hasLabKey(state.inv?.life, e.f) ? 'The way down is known to you' : `Find the Gravekeeper. Take the ${L.keyName}.`); ctx.tip?.('lab'); }
          sfx.play('ui');
        }
        return true;
      case 'lab':
        if (e.s === 'breathe' && labAt(state.x, state.z)?.floor === e.f) { ctx.callout('THE CRYPT BREATHES', 'The torches gutter. The dead stir.', 3); sfx.play('warn', null, 0.8); }
        else if (e.s === 'rise') { fx.sparks?.(e.x, 0.4, e.z, 10, 0x84cc16, 0.25, 3); }
        else if (e.s === 'call' && labAt(state.x, state.z)) ctx.callout('THE GRAVE BELL', 'The dead answer. Cut them down!', 2.5);
        else if (e.s === 'locked' && e.to === state.myId) ctx.callout('THE HORN LOCK', `Find the ${LABS[e.f].keyName} in ${LABS[e.f].name} first`, 3);
        return true;
      case 'labkey':
        if (e.id === state.myId) {
          const L = LABS[e.f];
          if (e.first) { ctx.banner(L.keyName.toUpperCase(), 'The Chamber Gate will open for you now'); sfx.play('levelup'); }
          else ctx.log(`You take another ${L.keyName} from the Ossuary.`, 'sys');
        }
        return true;
    }
    return false;
  }

  const tmp = { m4: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3() };
  const SPIKE_UP = 0.35, SPIKE_DOWN = -0.6;
  function update(dt, me) {
    time += dt;
    const L = labAt(state.x, state.z), inside = !!L && state.joined;
    k += ((inside ? 1 : 0) - k) * Math.min(1, dt * (inside ? 4 : 2.5)); if (Math.abs(k - (inside ? 1 : 0)) < 0.01) k = inside ? 1 : 0;
    // the crypt's air: dark, close fog (closer still while the torches gutter), dim light, your own torch
    const lerp = (a, b) => a + (b - a) * k;
    if (k > 0 || dirty) { // (one last pass at k = 0 puts the floor's own air back)
      const far = gutter > 0 ? CRYPT.gutterFar : CRYPT.far;
      scene.fog.near = lerp(base.near, CRYPT.near); scene.fog.far = lerp(base.far, far);
      scene.background.copy(base.sky).lerp(cryptSky, k); scene.fog.color.copy(scene.background);
      if (hemi) hemi.intensity = lerp(base.hemi, CRYPT.hemi);
      if (ctx.sun) ctx.sun.intensity = lerp(base.sun, CRYPT.sun);
      dirty = k > 0;
    } else { // outside: remember the floor's current air (floor2world.js blends it between floors)
      base.sky.copy(scene.background); base.near = scene.fog.near; base.far = scene.fog.far;
      if (hemi) base.hemi = hemi.intensity; if (ctx.sun) base.sun = ctx.sun.intensity;
    }
    ctx.floor1.visible = ctx.floor1.visible && k < 0.98; // the field and the sky tower aren't seen from below
    torch.visible = k > 0.02;
    if (torch.visible && me) { torch.position.set(me.x, 2.6, me.z); torch.intensity = 3.2 * k * (gutter > 0 ? 0.55 : 1) * (0.92 + 0.08 * Math.sin(time * 13) * Math.sin(time * 7.3)); }

    for (const f of LAB_FLOORS) {
      const V = views[f], Lf = LABS[f];
      V.root.visible = k > 0.02;
      if (!V.root.visible) continue;
      // torch flames flicker (and shrink while the crypt breathes)
      const { m4, q, s, p } = tmp;
      const low = gutter > 0 ? 0.35 : 1;
      V.torches.forEach(([x, z], i) => {
        const fl = (0.85 + 0.25 * Math.sin(time * 11 + i * 1.7)) * low;
        m4.compose(p.set(x, 2.95, z), q.identity(), s.set(fl, fl * (1 + 0.2 * Math.sin(time * 9 + i)), fl)); V.flame.setMatrixAt(i, m4);
        m4.compose(p.set(x, 2.95, z), q.identity(), s.set(fl * 1.4, fl * 1.4, fl * 1.4)); V.halo.setMatrixAt(i, m4);
      });
      V.flame.instanceMatrix.needsUpdate = true; V.halo.instanceMatrix.needsUpdate = true;
      // spike plates (server time from the snapshot)
      const t = sOff === null ? 0 : performance.now() / 1000 + sOff;
      let n = 0;
      V.plates.forEach(pl => {
        const st = trapState(Lf, pl.tr, t), want = st === 2 ? SPIKE_UP : SPIKE_DOWN;
        pl.y += (want - pl.y) * Math.min(1, dt * (st === 2 ? 30 : 6));
        pl.warn.material.opacity = st === 1 ? 0.25 + 0.2 * Math.sin(time * 20) : st === 2 ? 0.15 : 0;
        const step = (pl.tr.half * 2) / 5;
        for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
          m4.compose(p.set(pl.tr.x - pl.tr.half + step * (a + 0.5), pl.y, pl.tr.z - pl.tr.half + step * (b + 0.5)), q.identity(), s.set(1, 1, 1));
          V.spikes.setMatrixAt(n++, m4);
        }
      });
      V.spikes.instanceMatrix.needsUpdate = true;
      for (const st of V.stairs) st.shaft.material.opacity = 0.1 + 0.05 * Math.sin(time * 2);
      // stair labels
      const [sx, sz] = startPoint(Lf), [ex, ez] = endPoint(Lf), near = nearStair();
      place(lbl.out, sx, 4.2, sz + 1.5, `Climb out · the Verdant Field${near === 'out' ? prompt('climb') : ''}`, 30);
      const key = hasLabKey(state.inv?.life, f);
      place(lbl.up, ex, 4.2, ez, `Stair to the Chamber Gate${key ? '' : '<br><small>(the gate needs the ' + Lf.keyName + ')</small>'}${near === 'up' ? prompt('climb') : ''}`, 30);
    }
    if (k <= 0.02) { lbl.out.style.display = 'none'; lbl.up.style.display = 'none'; }
    for (const f of LAB_FLOORS) {
      const Lf = LABS[f], E = entries[f], near = nearStair();
      E.ring.material.opacity = near === 'in' ? 0.7 : 0.3 + 0.1 * Math.sin(time * 2);
      if (k < 0.5) place(lbl.in, Lf.entry.x, 4.8, Lf.entry.z - 2.1, `${Lf.name}${hasLabKey(state.inv?.life, f) ? '' : `<br><small>the ${Lf.keyName} lies below</small>`}${near === 'in' ? prompt('descend') : ''}`, 40);
      else lbl.in.style.display = 'none';
    }
  }

  // the gate box line (Floor 1's raid gate) while you don't hold the key yet
  const gateLine = f => (hasLabKey(state.inv?.life, f) ? '' : `<br><b style="color:#fbbf24">Horn Lock</b>: needs the ${LABS[f].keyName} from ${LABS[f].name} (crypt stair west of the road)`);
  return { update, snap, onEvent, interactKind, interact, gateLine, inLab: () => k > 0.5 };
}
