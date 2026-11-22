// Labyrinths, Floor 2: the look of the Weeping Thicket (docs/briefs/labyrinths.md). A drowned forest, never a maze:
// the "walls" are reed beds, root tangles under hanging moss, and deep black water; the ways are mud banks, duckboards,
// stepping-stone paths the tide covers and log rafts it lifts. The Reedmarch (reeds over your head, dead snags,
// fireflies), the Drowned Wood (great willows, moss curtains, mist) and the Heartwillow (a pool clearing under one
// colossal glowing willow: the way out is the hollow in its trunk). Imports nothing: the runtime (public/labyrinth.js)
// hands in THREE and its helpers as H. Whole wall pieces and trees are merged, vertex-coloured models drawn instanced,
// so a layer is about 25 draw calls.

// The air inside: a dark green-teal murk (the Drowned Wood is meant to be ~15 m of sight; the wisps thicken it).
export const AIR = { sky: 0x0e2220, near: 3, far: 30, gutterFar: 15, hemi: 0.55, sun: 0.3, torch: 0xc8f7a8 };
// The shared runtime's pieces on this floor: mossy chests, sluice wheels, the root gate, glowcap lanterns, thorn plates.
export const COLORS = {
  chest: 0x4a4a32, chestDeep: 0x2f5a52, band: 0x7a8a6a, bandDeep: 0x5eead4, lever: 0x3b332c, leverKnob: 0x7dfcf0, gate: 0x4a3b2a,
  stair: 0x4b5a4e, plate: 0x1c2620, spike: 0x8a7a5a, warn: 0xef4444, flame: 0xd9f99d, halo: 0x86efac, bracket: 0x3b332c, lure: 0xd9cfa0,
};

const BARK = 0x3b332c, ROOT = 0x2c2620, GLOW = 0xd9f99d, TEAL = 0x7dfcf0;
const LOOK = {
  reedmarch: { mud: 0x414a34, bed: 0x2c3a30, path: 0x4f5238, wood: 0x6e553a, wall: 'reeds', tall: false, moss: [0x5f7f4a, 0x6f8a4a, 0x3f5a3a], reed: [0x6f8a4a, 0x86a058, 0x5a7340, 0xa39a5e], flies: 80, mist: 0 },
  drownedwood: { mud: 0x2f3a2e, bed: 0x24322c, path: 0x44483a, wood: 0x57482f, wall: 'curtain', tall: true, moss: [0x4f6f45, 0x5f7f4a, 0x3a5438], flies: 46, mist: 0.07 },
  heartwillow: { mud: 0x33402f, bed: 0x24322c, path: 0x44483a, wood: 0x57482f, wall: 'curtain', tall: true, moss: [0x557a4a, 0x6a8f52, 0x3f5a3a], flies: 90, mist: 0.045 },
};
const LOW = -0.45, HIGH = -0.12; // the black water's level at low and high tide (the banks' tops are at 0)

// Small build kit: matrices, a cylinder between two points, merging coloured pieces into one model, instancing.
function kit(H) {
  const T = H.THREE, m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), e = new T.Euler(), col = new T.Color(), up = new T.Vector3(0, 1, 0);
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
  const beam = (ax, ay, az, bx, by, bz, r0, r1, sides = 5) => { // a tapered cylinder from b (radius r1) to a (radius r0)
    const d = new T.Vector3(ax - bx, ay - by, az - bz), len = d.length();
    return [new T.CylinderGeometry(r0, r1, len, sides), new T.Matrix4().compose(new T.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), new T.Quaternion().setFromUnitVectors(up, d.normalize()), new T.Vector3(1, 1, 1))];
  };
  const merge = parts => { // [[geometry, matrix, colour]] -> one geometry with vertex colours
    const pos = [], rgb = [];
    for (const [geo, mx, c] of parts) {
      const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(mx); col.set(c);
      const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); rgb.push(col.r, col.g, col.b); }
      geo.dispose(); g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); out.setAttribute('color', new T.Float32BufferAttribute(rgb, 3));
    out.computeVertexNormals(); return out;
  };
  const vmat = (opts = {}) => H.mat(0xffffff, { vertexColors: true, ...opts });
  const inst = (geo, material, n, parent) => { const im = new T.InstancedMesh(geo, material, Math.max(1, n)); im.count = n; parent.add(im); return im; };
  const put = (im, i, x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) => { m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)); im.setMatrixAt(i, m4); };
  const tint = (im, i, hex, dl = 0) => im.setColorAt(i, col.set(hex).offsetHSL(0, 0, dl));
  const soft = (c, o) => { const m = H.glow(c, o); m.transparent = true; m.depthWrite = false; m.fog = false; m.blending = T.AdditiveBlending; return m; }; // a glow the mist doesn't hide
  return { T, M, beam, merge, vmat, inst, put, tint, soft };
}

// ---------- the scenery of one layer ----------
export function buildTerrain(root, L, H) {
  const { mat, glow, flat } = H, { T, M, beam, merge, vmat, inst, put, tint, soft } = kit(H);
  const look = LOOK[L.id] || LOOK.drownedwood, heart = !!L.keeper;
  const C = L.cell, W = L.wall, HT = L.height, S = C - W, { cols, rows } = L, cx = L.x0 + L.w / 2, cz = L.z0 + L.d / 2;
  const r = H.rng(L.seeds.walls + 7), rm = H.rng(L.seeds.walls + 101), TAU = Math.PI * 2;
  const edgeAt = id => { const [i, j, d] = id.split(','), E = d === 'E'; return { x: L.x0 + (+i + (E ? 1 : 0.5)) * C, z: L.z0 + (+j + (E ? 0.5 : 1)) * C, E, rot: E ? Math.PI / 2 : 0 }; };

  // deep black water under everything (it rises and falls with the tide)
  const water = flat(L.w + 90, L.d + 90, mat(0x061311, { flatShading: false, roughness: 0.14, metalness: 0.55, emissive: 0x05221e, emissiveIntensity: 0.55 }), cx, LOW, cz);

  // the ground you walk: a mud bank per cell (a sunken bed where you wade), one per open way, one for the hall
  const banks = [], ways = [], walls = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const hall = L.inHallCell(i, j), x = L.x0 + (i + 0.5) * C, z = L.z0 + (j + 0.5) * C, wet = L.waterCells.has(j * cols + i);
    if (!hall) banks.push([x, z, S, S, wet ? -0.08 : 0.015, wet ? look.bed : look.mud]);
    for (const [di, dj, d] of [[1, 0, 'E'], [0, 1, 'N']]) {
      if (i + di >= cols || j + dj >= rows) continue;
      const id = `${i},${j},${d}`, at = edgeAt(id);
      if (L.open.has(id)) { if (!(hall && L.inHallCell(i + di, j + dj))) ways.push(at); }
      else if (!L.shiftEdges.has(id)) walls.push([at.x, at.z, at.rot, 0]);
    }
  }
  for (const at of ways) banks.push([at.x, at.z, at.E ? W : S, at.E ? S : W, 0.015, look.mud]);
  if (L.hall) { const [a0, b0, a1, b1] = L.hall; banks.push([L.x0 + (a0 + a1 + 1) / 2 * C, L.z0 + (b0 + b1 + 1) / 2 * C, (a1 - a0 + 1) * C - W, (b1 - b0 + 1) * C - W, 0.015, look.mud]); }
  const bankIM = inst(new T.BoxGeometry(1, 1, 1), mat(0xffffff), banks.length, root); bankIM.receiveShadow = true;
  banks.forEach(([x, z, w, d, top, c], i) => { put(bankIM, i, x, top - 0.45, z, 0, w, 0.9, d); tint(bankIM, i, c, (r() - 0.5) * 0.03); });

  // duckboards across every open way
  const plankIM = inst(new T.BoxGeometry(1, 0.08, 0.46), mat(0xffffff), ways.length * 5, root); plankIM.receiveShadow = true;
  ways.forEach((at, n) => {
    for (let k = 0; k < 5; k++) {
      const off = (k - 2) * 0.6, side = (r() - 0.5) * 0.4, i = n * 5 + k;
      put(plankIM, i, at.x + (at.E ? off : side), 0.045, at.z + (at.E ? side : off), at.rot + (r() - 0.5) * 0.12, 3.5 + r() * 0.9, 1, 1);
      tint(plankIM, i, look.wood, (r() - 0.5) * 0.07);
    }
  });

  // "walls": one model per closed way (a reed bed, or a root tangle under a bough hung with moss), a second row outside
  for (let i = 0; i < cols; i++) for (const [z, o] of [[L.z0, -1], [L.z0 + L.d, 1]]) { const x = L.x0 + (i + 0.5) * C; walls.push([x, z, 0, 0], [x + (r() - 0.5) * 3, z + o * (2.6 + r() * 1.6), (r() - 0.5) * 0.5, 1]); }
  for (let j = 0; j < rows; j++) for (const [x, o] of [[L.x0, -1], [L.x0 + L.w, 1]]) { const z = L.z0 + (j + 0.5) * C; walls.push([x, z, Math.PI / 2, 0], [x + o * (2.6 + r() * 1.6), z + (r() - 0.5) * 3, Math.PI / 2 + (r() - 0.5) * 0.5, 1]); }
  const Lw = S + 0.5, wp = [];
  for (let k = 0; k < 3; k++) wp.push([new T.DodecahedronGeometry(1, 0), M((k - 1) * Lw / 3 + (rm() - 0.5) * 0.6, 0.05, (rm() - 0.5) * 0.4, rm() * 3, rm() * 3, 0, Lw / 6 + 0.35, 0.5 + rm() * 0.45, W * 0.42), look.wall === 'reeds' ? look.bed : ROOT]);
  if (look.wall === 'reeds') {
    for (let k = 0; k < 13; k++) { const hgt = 1.8 + rm() * 1.3; wp.push([new T.ConeGeometry(0.55, hgt, 4), M(-Lw / 2 + (k + rm()) * Lw / 13, hgt / 2 - 0.2, (rm() - 0.5) * 1.2, 0, rm() * 3, 0), look.moss[2]]); }
    for (let k = 0; k < 38; k++) {
      const hgt = HT - 1.3 + rm() * 2.2, x = -Lw / 2 + (k + rm()) * Lw / 38, z = ((k % 3) - 1) * 0.62 + (rm() - 0.5) * 0.3;
      wp.push([new T.ConeGeometry(0.13 + rm() * 0.05, hgt, 3), M(x, hgt / 2 - 0.2, z, (rm() - 0.5) * 0.14, rm() * 3, (rm() - 0.5) * 0.14), look.reed[k % look.reed.length]]);
      if (k % 5 === 2) wp.push([new T.CylinderGeometry(0.12, 0.12, 0.6, 5), M(x, hgt * 0.78, z), 0x5a3d24]); // a cattail
    }
  } else {
    for (let k = 0; k < 7; k++) { const x = -Lw / 2 + (k + 0.5) * Lw / 7, sd = k % 2 ? 1 : -1; wp.push([...beam(x + (rm() - 0.5) * 0.9, 1.4 + rm() * 1.3, sd * 0.1, x + (rm() - 0.5) * 0.5, -0.5, sd * (W * 0.5 - 0.1), 0.09, 0.2), BARK]); } // arching roots
    for (const sx of [-1, 1]) { const x = sx * Lw * (0.2 + rm() * 0.1); wp.push([...beam(x + (rm() - 0.5) * 0.8, HT, (rm() - 0.5) * 0.3, x, 0, (rm() - 0.5) * 0.4, 0.2, 0.36, 6), BARK]); } // stems
    wp.push([...beam(Lw / 2 + 0.7, HT - 0.1, 0, -Lw / 2 - 0.7, HT - 0.35, 0, 0.26, 0.32, 6), BARK]); // the bough
    const nF = Math.round(Lw / 0.72);
    for (let row = 0; row < 2; row++) for (let k = 0; k < nF; k++) { // the moss curtain: two rows of ragged fronds
      const len = HT - 0.8 - rm() * 1.5;
      wp.push([new T.CylinderGeometry(0.52, 0.14, len, 4), M(-Lw / 2 + (k + 0.5 + row * 0.5) * Lw / nF, HT - 0.05 - len / 2, (row - 0.5) * 0.8 + (rm() - 0.5) * 0.2, 0, (rm() - 0.5) * 0.8, 0, 1, 1, 0.45), look.moss[(k + row) % 3]]);
    }
  }
  const wallIM = inst(merge(wp), vmat(), walls.length, root); wallIM.receiveShadow = true;
  walls.forEach(([x, z, rot, far], i) => { put(wallIM, i, x, 0, z, rot + (r() < 0.5 ? Math.PI : 0), 1, (far ? 1.05 : 0.92) + r() * 0.2, 1); tint(wallIM, i, 0xffffff, -r() * (far ? 0.3 : 0.14)); });

  // trees: at every grid node (the corners of the ways), and more beyond the edge. Great willows, or dead snags in the reeds
  const tp = [];
  if (look.tall) {
    tp.push([new T.CylinderGeometry(0.6, 1.05, 14, 7), M(0, 7, 0), BARK], [new T.DodecahedronGeometry(1, 0), M(0, 14.3, 0, 0.4, 0.3, 0, 3.4, 1.5, 3.4), 0x1f3026]);
    for (let k = 0; k < 3; k++) { const a = rm() * TAU, y = 8.4 + k * 1.7, sn = Math.sin(a), cs = Math.cos(a); tp.push([...beam(sn * 3.2, y + 1.6, cs * 3.2, sn * 0.4, y, cs * 0.4, 0.1, 0.24), BARK], [new T.CylinderGeometry(0.5, 0.1, 2.8, 4), M(sn * 2.7, y, cs * 2.7, 0, a, 0, 1, 1, 0.4), look.moss[k]]); }
    for (let k = 0; k < 7; k++) { const a = k / 7 * TAU + rm(), len = 3.5 + rm() * 2.5; tp.push([new T.CylinderGeometry(0.7, 0.16, len, 4), M(Math.sin(a) * 2.6, 14 - len / 2, Math.cos(a) * 2.6, 0, a, 0, 1, 1, 0.4), look.moss[k % 3]]); } // the crown's weeping fronds
  } else {
    tp.push([new T.CylinderGeometry(0.42, 1.0, 6, 7), M(0, 3, 0), BARK], [new T.ConeGeometry(0.42, 1.1, 5), M(0.12, 6.3, 0, 0, 0, 0.25), ROOT], [...beam(1.5, 5.4, 0.4, 0.2, 3.9, 0, 0.07, 0.2), BARK]);
    for (let k = 0; k < 6; k++) { const a = rm() * TAU, hgt = 2 + rm() * 2; tp.push([new T.ConeGeometry(0.14, hgt, 3), M(Math.sin(a) * 1.2, hgt / 2, Math.cos(a) * 1.2, 0, rm() * 3, 0), look.reed[k % 4]]); }
  }
  for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + rm(), d = 1.4 + rm() * 0.25, sn = Math.sin(a), cs = Math.cos(a); tp.push([...beam(sn * 0.55, 2 + rm(), cs * 0.55, sn * d, -0.4, cs * d, 0.16, 0.3), ROOT]); } // buttress roots
  const trees = [], caps = [];
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
    if (L.hall && i > L.hall[0] && i <= L.hall[2] && j > L.hall[1] && j <= L.hall[3]) continue;
    trees.push([L.x0 + i * C, L.z0 + j * C, 0.95 + r() * 0.25, look.tall ? 1 + r() * 0.5 : 0.4 + r() * 0.75]);
  }
  for (let k = 0; k < 44; k++) { // the forest beyond
    const side = k % 4, t = r(), o = 6 + r() * 12;
    trees.push([side < 2 ? L.x0 - 8 + t * (L.w + 16) : side === 2 ? L.x0 - o : L.x0 + L.w + o, side === 0 ? L.z0 - o : side === 1 ? L.z0 + L.d + o : L.z0 - 8 + t * (L.d + 16), 1.1 + r() * 0.6, look.tall ? 1.1 + r() * 0.6 : 0.5 + r()]);
  }
  const treeIM = inst(merge(tp), vmat(), trees.length, root); treeIM.castShadow = true; treeIM.receiveShadow = true;
  trees.forEach(([x, z, sc, sy], i) => {
    put(treeIM, i, x, 0, z, r() * TAU, sc, sy, sc); tint(treeIM, i, 0xffffff, -r() * 0.12);
    for (let k = 0; k < 2; k++) { const a = r() * TAU; caps.push([x + Math.sin(a) * 1.25 * sc, 0.25 + r() * 1.5, z + Math.cos(a) * 1.25 * sc]); }
  });
  H.occluders.push(wallIM, treeIM);

  // small things: glowcaps on the roots, ferns in the corners, lantern stakes under the torches
  const capIM = inst(new T.OctahedronGeometry(0.13), glow(TEAL), caps.length, root);
  caps.forEach(([x, y, z], i) => put(capIM, i, x, y, z, r() * 3, 0.7 + r() * 0.8, 1 + r(), 0.7 + r() * 0.8));
  const ferns = [];
  for (const [x, z, w, d, top] of banks) { if (top < 0 || Math.min(w, d) < S) continue; const n = w > S ? 46 : 3; for (let k = 0; k < n; k++) { const a = Math.floor(r() * 4), u = (r() < 0.5 ? -1 : 1) * (w / 2 - 0.3 - r() * 0.5), v = (r() < 0.5 ? -1 : 1) * (d / 2 - 0.3 - r() * 0.5); ferns.push(w > S && a < 2 ? [x + u, z + (r() - 0.5) * d] : w > S ? [x + (r() - 0.5) * w, z + v] : [x + u, z + v]); } }
  const fernIM = inst(new T.ConeGeometry(0.32, 1, 4), mat(look.moss[1]), ferns.length, root);
  ferns.forEach(([x, z], i) => { const hgt = 0.6 + r() * 1.1; put(fernIM, i, x, hgt / 2, z, r() * 3, 1, hgt, 1, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3); });
  const stakeIM = inst(new T.CylinderGeometry(0.05, 0.09, 2.75, 5), mat(BARK), L.torchList.length, root);
  L.torchList.forEach((tc, i) => put(stakeIM, i, tc.x, 1.36, tc.z, 0, 1, 1, 1, tc.nz * 0.05, -tc.nx * 0.05));

  // wading water (shallow, teal, faintly lit: unlike the black deeps) and lily pads
  const wet = [...L.waterCells].map(c => L.center(c)), pads = [];
  const wadeMat = mat(0x1f5f5c, { flatShading: false, emissive: 0x0c3b3a, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.35, transparent: true, opacity: 0.8 });
  const wadeIM = inst(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), wadeMat, wet.length, root);
  wet.forEach(([x, z], i) => { put(wadeIM, i, x, 0.05, z, 0, S, 1, S); for (let k = 0; k < 5; k++) pads.push([x + (r() - 0.5) * (S - 1), 0.065, z + (r() - 0.5) * (S - 1)]); });

  // the tide's ways. Set 0: stepping stones on a mud bar (low tide; the water covers it). Set 1: a log raft (high tide
  // lifts it level with the banks; at low tide it lies sunk). Shut, either is a channel of open black water. Stakes
  // with a lamp stand at each: bright while its way is open, dull red while it's shut.
  const shifts = [...L.shiftEdges].map(([id, set]) => ({ ...edgeAt(id), set })), by = k => shifts.filter(sh => sh.set === k);
  const cg = [[new T.BoxGeometry(S - 0.3, 0.6, W + 0.3), M(0, -0.29, 0), look.path]];
  for (let k = 0; k < 9; k++) cg.push([new T.CylinderGeometry(0.5 + rm() * 0.2, 0.7, 0.14, 6), M(-S / 2 + 0.9 + (k % 5) * (S - 1.8) / 4 + (rm() - 0.5) * 0.4, 0.02, (k < 5 ? -0.55 : 0.6) + (rm() - 0.5) * 0.3, 0, rm() * 3, 0), k % 2 ? 0x6b7265 : 0x7a8272]);
  const rg = [], nLog = Math.floor((S - 0.3) / 0.72);
  for (let k = 0; k < nLog; k++) { const x = (k - (nLog - 1) / 2) * 0.72; rg.push([...beam(x + (rm() - 0.5) * 0.08, -0.3, W / 2 + 0.15 + rm() * 0.2, x, -0.3, -W / 2 - 0.15 - rm() * 0.2, 0.33, 0.3, 6), k % 3 ? 0x4a3d2c : 0x5a4a34]); }
  for (const z of [-0.75, 0.75]) rg.push([new T.BoxGeometry(S - 0.5, 0.07, 0.2), M(0, 0.04, z), 0xa39a5e]);
  for (const sx of [-1, 1]) rg.push([new T.CylinderGeometry(0.42, 0.42, 0.04, 6), M(sx * (S / 2 - 0.5), 0.07, sx * 0.3), 0x4d7c3a]);
  const causeIM = inst(merge(cg), vmat(), by(0).length, root), raftIM = inst(merge(rg), vmat(), by(1).length, root);
  by(0).forEach((sh, i) => put(causeIM, i, sh.x, 0, sh.z, sh.rot)); by(1).forEach((sh, i) => put(raftIM, i, sh.x, 0, sh.z, sh.rot));
  causeIM.receiveShadow = raftIM.receiveShadow = true; causeIM.frustumCulled = raftIM.frustumCulled = false;
  const markIM = inst(new T.CylinderGeometry(0.05, 0.08, 1.6, 5), mat(BARK), shifts.length * 4, root);
  const lamps = [0, 1].map(k => inst(new T.OctahedronGeometry(0.17), glow(GLOW), by(k).length * 4, root)), nLamp = [0, 0];
  shifts.forEach((sh, n) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b], k) => {
    const u = a * (S / 2 - 0.35), v = b * (W / 2 + 0.3), x = sh.x + (sh.E ? v : u), z = sh.z + (sh.E ? u : v);
    put(markIM, n * 4 + k, x, 0.8, z, 0, 1, 1, 1, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12); put(lamps[sh.set], nLamp[sh.set]++, x, 1.75, z, 0, 1, 1.5, 1);
  }));

  // fireflies and low mist
  const nFly = look.flies, fly = inst(new T.OctahedronGeometry(0.07), glow(0xeaff9a), nFly, root), fb = new Float32Array(nFly * 4);
  for (let i = 0; i < nFly; i++) { fb[i * 4] = L.x0 + r() * L.w; fb[i * 4 + 1] = 0.7 + r() * 3; fb[i * 4 + 2] = L.z0 + r() * L.d; fb[i * 4 + 3] = r() * 40; put(fly, i, fb[i * 4], fb[i * 4 + 1], fb[i * 4 + 2]); }
  fly.frustumCulled = false;
  let mist = null;
  if (look.mist) {
    mist = inst(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glow(0x9fd8c8, look.mist), 7, root); mist.frustumCulled = false; mist.renderOrder = 2;
    for (let i = 0; i < 7; i++) { const sc = 16 + r() * 10; put(mist, i, L.x0 + r() * L.w, 0.6 + i * 0.22, L.z0 + r() * L.d, r() * 3, sc, 1, sc * 0.7); }
  }

  // the landmark. Outer layers: the Heartwillow's glow far beyond the way on, seen through the mist over every wall.
  // The Heart: the willow itself at the clearing's far edge (its hollow is the way out), its roots arching overhead,
  // strands of light hanging over a shallow pool.
  const pulse = [];
  if (!heart) {
    const ex = L.x0 + (L.end[0] + 0.5) * C, ez = L.z0 + L.d + 26, g = new T.Group(); g.position.set(ex, 0, ez); root.add(g);
    const colm = new T.Mesh(new T.CylinderGeometry(2.2, 4.6, 34, 10, 1, true), soft(GLOW, 0.1)); colm.position.y = 17; g.add(colm);
    const crown = new T.Mesh(new T.SphereGeometry(13, 10, 6), soft(0xa7f3d0, 0.06)); crown.position.y = 30; crown.scale.y = 0.55; g.add(crown);
    const strands = inst(new T.CylinderGeometry(0.5, 0.1, 1, 4), soft(GLOW, 0.14), 26, g);
    for (let i = 0; i < 26; i++) { const a = r() * TAU, d = 5 + r() * 8, len = 9 + r() * 9; put(strands, i, Math.sin(a) * d, 31 - len / 2, Math.cos(a) * d, 0, 1, len, 1); }
    pulse.push([colm.material, 0.1], [crown.material, 0.06], [strands.material, 0.14]);
  } else {
    const zc = L.z0 + L.d + 5.6, hp = [[new T.CylinderGeometry(4.2, 6.2, 30, 9), M(cx, 15, zc), 0x4a4438]];
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) hp.push([...beam(cx + sx * (3 + k), 2.5 + k, zc - 4.2 + k, cx + sx * (9 + k * 4.5), -0.5, L.z0 + L.d + 0.8 + k * 1.6, 0.5, 1.0, 6), ROOT]);
    for (const sx of [-1, 1]) for (const near of [0, 1]) { // root arches over the clearing (their feet land outside it)
      const a = [cx + sx * 3.5, 10, zc - 4.5], b = [sx > 0 ? L.x0 + L.w + 1.6 : L.x0 - 1.6, -0.6, L.z0 + (near ? 23 : 8)], c = [(a[0] + b[0]) / 2 + sx * 4, 19 - near * 3, (a[2] + b[2]) / 2];
      const at = t => [0, 1, 2].map(k => (1 - t) * (1 - t) * a[k] + 2 * t * (1 - t) * c[k] + t * t * b[k]);
      for (let k = 0; k < 7; k++) { const p0 = at(k / 7), p1 = at((k + 1) / 7); hp.push([...beam(...p0, ...p1, 0.8 - k * 0.07, 0.72 - k * 0.07, 6), k % 2 ? ROOT : 0x352e26]); }
    }
    const willow = new T.Mesh(merge(hp), vmat()); willow.castShadow = true; root.add(willow);
    const lit = c => { const m = glow(c); m.fog = false; return m; };
    const hollow = new T.Mesh(new T.OctahedronGeometry(1), lit(GLOW)); hollow.position.set(cx, 2.7, L.z0 + L.d - 0.45); hollow.scale.set(1.5, 3.3, 0.4); root.add(hollow);
    const halo = new T.Mesh(new T.SphereGeometry(4.2, 10, 8), soft(GLOW, 0.14)); halo.position.set(cx, 3, L.z0 + L.d - 0.6); halo.scale.set(1, 1.4, 0.5); root.add(halo);
    const veins = inst(new T.BoxGeometry(0.16, 1, 0.1), lit(0xa7f3d0), 7, root);
    for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.3 + (r() - 0.5) * 0.1, len = 7 + r() * 9; const rad = 6.28 - (5.5 + len / 2) / 15; put(veins, i, cx + Math.sin(a) * rad, 5.5 + len / 2, zc - Math.cos(a) * rad, -a, 1, len, 1, 0.066); }
    const strands = inst(new T.CylinderGeometry(0.34, 0.07, 1, 4), soft(0xb8f5a0, 0.2), 70, root);
    for (let i = 0; i < 70; i++) { const a = r() * TAU, d = Math.sqrt(r()) * 18, top = 19 + r() * 6, len = top - 7.5 - r() * 4; put(strands, i, cx + Math.sin(a) * d, top - len / 2, cz + 3 + Math.cos(a) * d * 0.9, r() * 3, 1, len, 1); }
    const pool = flat(1, 1, wadeMat, cx, 0.028, cz - 1); pool.geometry = new T.CircleGeometry(12.5, 30);
    const rim = flat(1, 1, glow(0x5eead4, 0.4), cx, 0.034, cz - 1); rim.geometry = new T.RingGeometry(12.4, 12.7, 48);
    for (let k = 0; k < 18; k++) { const a = r() * TAU, d = 3 + r() * 9; pads.push([cx + Math.sin(a) * d, 0.04, cz - 1 + Math.cos(a) * d]); }
    pulse.push([halo.material, 0.14], [strands.material, 0.2], [rim.material, 0.4]);
  }
  const padIM = inst(new T.CircleGeometry(0.4, 6).rotateX(-Math.PI / 2), mat(0x4d7c3a), pads.length, root);
  pads.forEach(([x, y, z], i) => put(padIM, i, x, y, z, r() * 3, 0.6 + r() * 0.7));

  // ---------- per frame: the tide, the lamps, fireflies, mist, the willow's pulse ----------
  const OPEN = new T.Color(GLOW), SHUT = new T.Color(0x6b1d12);
  let tide = -1;
  function update(dt, time, info) {
    const want = info?.phase ? 1 : 0, dark = (info?.gutter || 0) > 0;
    tide = tide < 0 ? want : tide + Math.sign(want - tide) * Math.min(Math.abs(want - tide), dt / 1.5);
    const k = tide * tide * (3 - 2 * tide);
    water.position.y = LOW + (HIGH - LOW) * k + Math.sin(time * 0.7) * 0.012;
    causeIM.position.y = -0.55 * k; raftIM.position.y = -0.64 * (1 - k) + Math.sin(time * 1.3) * 0.015 * k;
    lamps[0].material.color.lerpColors(OPEN, SHUT, k); lamps[1].material.color.lerpColors(SHUT, OPEN, k);
    const a = fly.instanceMatrix.array; // (the fireflies go out while the wisps are about)
    for (let i = 0, o = 0; i < nFly; i++, o += 16) {
      const b = i * 4, ph = fb[b + 3];
      a[o] = a[o + 5] = a[o + 10] = dark ? 0.001 : Math.max(0.001, Math.sin(time * 1.1 + ph * 7));
      a[o + 12] = fb[b] + Math.sin(time * 0.31 + ph) * 1.4; a[o + 13] = fb[b + 1] + Math.sin(time * 0.53 + ph * 2) * 0.4; a[o + 14] = fb[b + 2] + Math.cos(time * 0.27 + ph * 3) * 1.4;
    }
    fly.instanceMatrix.needsUpdate = true;
    if (mist) { mist.position.set(Math.sin(time * 0.04) * 4, 0, Math.cos(time * 0.031) * 4); mist.material.opacity += ((dark ? look.mist * 2.4 : look.mist) - mist.material.opacity) * Math.min(1, dt * 1.5); }
    const beat = 0.82 + 0.18 * Math.sin(time * 0.9);
    for (let i = 0; i < pulse.length; i++) pulse[i][0].opacity = pulse[i][1] * beat;
  }
  return { update };
}

// ---------- the way in, in the Mire: a hollow under a great root arch, steps going down into dark water ----------
export function buildEntry(parent, lab, H) {
  const { mat, glow } = H, { T, M, beam, merge, vmat } = kit(H), rm = H.rng(lab.layers[0].seeds.walls + 3);
  const E = lab.entry, g = new T.Group(); g.position.set(E.x, 0, E.z); parent.add(g);
  const pool = new T.Mesh(new T.PlaneGeometry(3.6, 4.4), glow(0x04100e)); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04; g.add(pool);
  for (let k = 0; k < 4; k++) { const sp = new T.Mesh(new T.BoxGeometry(3.2, 0.06, 0.7), mat(0x3c4a44 - k * 0x0a0c0b)); sp.position.set(0, 0.05, 1.4 - k * 0.8); g.add(sp); }
  const ap = [[new T.DodecahedronGeometry(1, 0), M(0, 4.5, -2.1, 0.3, 0.5, 0, 1.5, 0.9, 1.1), BARK], [...beam(0.5, 10, -3, 0, 4.5, -2.1, 0.45, 0.85, 6), BARK]];
  for (const sx of [-1, 1]) {
    ap.push([...beam(sx * 0.6, 4.3, -2.1, sx * 2.5, -0.3, -1.9, 0.45, 0.7, 6), BARK], [...beam(sx * 0.9, 3.9, -2.3, sx * 3.3, -0.3, -2.9, 0.2, 0.34), ROOT], [...beam(sx * 1.6, 2.6, -1.9, sx * 2.2, -0.3, 0.6, 0.12, 0.26), ROOT]);
    ap.push([new T.DodecahedronGeometry(1, 0), M(sx * 2.4, 0.1, 0.2, rm() * 3, rm() * 3, 0, 0.6, 0.35, 2.2), 0x34463a]); // mossy banks either side of the steps
    for (let k = 0; k < 3; k++) { const len = 1.1 + rm() * 0.8; ap.push([new T.CylinderGeometry(0.4, 0.1, len, 4), M(sx * (0.7 + k * 0.5), 4.1 - k * 0.25 - len / 2, -2.0 + (rm() - 0.5) * 0.3, 0, (rm() - 0.5) * 0.6, 0, 1, 1, 0.45), k % 2 ? 0x5f7f4a : 0x4f6f45]); }
  }
  const arch = new T.Mesh(merge(ap), vmat()); arch.castShadow = true; g.add(arch);
  for (const [x, y, z] of [[-2.1, 0.5, -1.4], [2.3, 0.9, -1.7], [-1.2, 3.4, -1.8], [1.9, 0.35, 1.0], [-2.4, 0.4, 0.9]]) { const c = new T.Mesh(new T.OctahedronGeometry(0.14), glow(TEAL)); c.position.set(x, y, z); c.scale.y = 1.6; g.add(c); }
  const ring = new T.Mesh(new T.RingGeometry(E.use - 0.25, E.use, 48), glow(0x5eead4, 0.35)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  return { g, ring };
}

// ---------- block models for its enemies (same shape as makeLabMob in labyrinth.js) ----------
export function makeMob(type, H) {
  const { THREE: T, glow } = H, pal = {};
  const part = (geo, color, x, y, z, parent, rx = 0, rz = 0) => {
    const m = new T.Mesh(geo, typeof color === 'number' ? (pal[color] ||= H.mat(color)) : color);
    m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz; m.castShadow = true; parent.add(m); return m;
  };
  const box = (w, h, d) => new T.BoxGeometry(w, h, d), eyes = (parent, c, rad, dx, y, z) => { for (const sx of [-1, 1]) { const o = new T.Mesh(new T.SphereGeometry(rad, 6, 4), glow(c)); o.position.set(sx * dx, y, z); parent.add(o); } };
  const g = new T.Group(), body = new T.Group(); g.add(body);
  const legs = []; let armR = null, height = 2;
  if (type === 'mirelurker') { // a hunched heap of mud and roots: low head, long root arms, a spine of snags
    const mud = 0x4a4230, dark = 0x33301f;
    for (const sx of [-1, 1]) legs.push(part(box(0.3, 0.62, 0.34), dark, sx * 0.28, 0.31, 0, body));
    part(new T.DodecahedronGeometry(0.62, 0), mud, 0, 1.02, 0.08, body, 0.5).scale.set(1.2, 0.85, 1.05);
    for (let k = 0; k < 5; k++) part(new T.ConeGeometry(0.09, 0.6 + (k % 3) * 0.22, 4), ROOT, (k - 2) * 0.2, 1.62 - Math.abs(k - 2) * 0.1, -0.28, body, -0.5, (2 - k) * 0.22);
    for (const sx of [-1, 1]) part(box(0.42, 0.1, 0.5), 0x55703f, sx * 0.34, 1.45, 0.0, body, 0.35, sx * -0.25); // moss on the shoulders
    const head = part(box(0.44, 0.34, 0.5), 0x3d3a2a, 0, 1.12, 0.66, body, 0.2);
    part(box(0.4, 0.1, 0.4), 0x6a6344, 0, -0.2, 0.1, head, 0.25); eyes(head, GLOW, 0.06, 0.13, 0.05, 0.26);
    for (const sx of [-1, 1]) {
      const arm = new T.Group(); arm.position.set(sx * 0.62, 1.32, 0.28); body.add(arm); if (sx > 0) armR = arm;
      part(box(0.18, 1.2, 0.18), ROOT, 0, -0.5, 0.2, arm, -0.5);
      for (let k = -1; k <= 1; k++) part(new T.ConeGeometry(0.045, 0.32, 4), 0x6a6344, k * 0.08, -1.08, 0.56, arm, 2.3);
    }
    height = 1.95;
  } else if (type === 'mosshag') { // a tall stooped crone draped in moss, with lantern eyes
    const s = 1.3, robe = 0x44603c, moss = 0x5f7f4a, deep = 0x34492f;
    for (const sx of [-1, 1]) legs.push(part(box(0.16 * s, 0.95 * s, 0.16 * s), 0x2a2a20, sx * 0.2 * s, 0.47 * s, 0, body));
    part(new T.CylinderGeometry(0.3 * s, 0.68 * s, 1.6 * s, 7), robe, 0, 1.35 * s, 0.08 * s, body, 0.2);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; part(new T.CylinderGeometry(0.2 * s, 0.03, 0.7 * s, 4), k % 2 ? moss : deep, Math.sin(a) * 0.6 * s, 0.55 * s, Math.cos(a) * 0.6 * s - 0.06 * s, body); } // the ragged hem
    part(new T.DodecahedronGeometry(0.5 * s, 0), deep, 0, 2.15 * s, 0.22 * s, body, 0.3).scale.set(1.25, 0.8, 1);
    const head = part(box(0.38 * s, 0.42 * s, 0.4 * s), 0x7a856a, 0, 2.2 * s, 0.66 * s, body, 0.35);
    part(new T.ConeGeometry(0.36 * s, 0.75 * s, 6), deep, 0, 0.36 * s, -0.12 * s, head, -0.5);
    part(new T.ConeGeometry(0.07 * s, 0.3 * s, 4), 0x7a856a, 0, -0.08 * s, 0.3 * s, head, 1.9); // the nose
    for (const sx of [-1, 1]) part(box(0.08 * s, 0.75 * s, 0.05 * s), moss, sx * 0.2 * s, -0.3 * s, 0.1 * s, head);
    eyes(head, 0xfde68a, 0.085 * s, 0.1 * s, 0.05 * s, 0.2 * s);
    for (const sx of [-1, 1]) {
      const arm = new T.Group(); arm.position.set(sx * 0.52 * s, 2.1 * s, 0.3 * s); body.add(arm); if (sx > 0) armR = arm;
      part(box(0.13 * s, 1.3 * s, 0.13 * s), 0x6b7558, 0, -0.5 * s, 0.25 * s, arm, -0.7);
      part(box(0.07 * s, 0.9 * s, 0.6 * s), moss, 0, -0.75 * s, 0.05 * s, arm, -0.7); // moss hanging off the arm
      for (let k = -1; k <= 1; k++) part(new T.ConeGeometry(0.035 * s, 0.34 * s, 4), 0xd9cfb5, k * 0.07 * s, -1.02 * s, 0.75 * s, arm, 2.2);
    }
    height = 3.3;
  } else { // the Mother of Mire: a huge moss-backed matriarch, half toad and half fish, an angler's lure over her mouth
    const hide = 0x3f5a48, dark = 0x34503f, pale = 0x9fb08a, fin = 0x2f6d6a;
    for (const sx of [-1, 1]) legs.push(part(box(0.5, 0.6, 0.85), dark, sx * 0.62, 0.3, -0.15, body));
    part(new T.SphereGeometry(0.9, 8, 6), hide, 0, 0.98, 0, body).scale.set(1.25, 0.88, 1.3);
    part(new T.SphereGeometry(0.7, 8, 5), pale, 0, 0.7, 0.4, body).scale.set(1.08, 0.62, 1);
    const head = part(box(1.35, 0.5, 0.85), 0x466350, 0, 1.3, 0.9, body, 0.08);
    part(box(1.25, 0.2, 0.8), pale, 0, 0.92, 0.95, body, 0.12);
    for (let k = 0; k < 6; k++) part(new T.ConeGeometry(0.05, 0.16, 4), 0xe7dcc4, (k - 2.5) * 0.2, -0.3, 0.36, head, Math.PI);
    for (const sx of [-1, 1]) { const b = part(new T.SphereGeometry(0.2, 6, 5), 0x466350, sx * 0.42, 0.32, 0.05, head); const e = new T.Mesh(new T.SphereGeometry(0.11, 6, 4), glow(0xfde047)); e.position.set(0, 0.03, 0.13); b.add(e); }
    part(new T.CylinderGeometry(0.02, 0.04, 0.9, 4), dark, 0, 0.55, 0.3, head, 0.9); // the lure
    const bulb = new T.Mesh(new T.SphereGeometry(0.12, 8, 6), glow(TEAL)); bulb.position.set(0, 0.8, 0.72); head.add(bulb);
    for (let k = 0; k < 4; k++) part(new T.ConeGeometry(0.34, 0.75 - k * 0.1, 4), fin, 0, 1.85 - k * 0.14, -0.1 - k * 0.38, body, -0.4).scale.x = 0.15; // dorsal fins
    part(new T.ConeGeometry(0.5, 1.5, 6), hide, 0, 0.62, -1.6, body, -Math.PI / 2);
    part(box(1.0, 0.06, 0.7), fin, 0, 0.62, -2.45, body, 0, 0.5);
    for (let k = 0; k < 8; k++) { const a = (k / 7 - 0.5) * 3.6; part(new T.CylinderGeometry(0.2, 0.03, 0.7 + (k % 2) * 0.3, 4), k % 2 ? 0x5f7f4a : 0x4f6f45, Math.sin(a) * 1.02, 1.25, -0.25 - Math.cos(a) * 0.75, body); } // the moss mantle
    for (const sx of [-1, 1]) {
      const arm = new T.Group(); arm.position.set(sx * 1.08, 1.0, 0.5); body.add(arm); if (sx > 0) armR = arm;
      part(box(0.28, 0.9, 0.28), dark, 0, -0.35, 0.12, arm, -0.4); part(box(0.55, 0.08, 0.5), fin, 0, -0.8, 0.42, arm, -0.2);
    }
    body.scale.setScalar(2.2); height = 4.7;
  }
  const cursor = new T.Mesh(new T.OctahedronGeometry(type === 'motherofmire' ? 0.22 : 0.14), new T.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.2; g.add(cursor);
  return { group: g, body, legs, armR, cursor, mats: Object.values(pal), height };
}
