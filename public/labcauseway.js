// Labyrinths, Floor 3: the look of the Windrift Causeways (docs/briefs/labyrinths.md). Floating stone isles high over
// the cloud sea, no walls: every gap is a drop. The ways are rope-and-plank bridges exactly as wide as you can walk,
// and turning stone spans that screw up into a gap on the clock and sink out of it again. Prayer flags stream on the
// wind, the Eye-Spire's lightning crown shows from everywhere. The Kite Steps, the Turning Isles, and the Eye-Spire
// (one great plaza under the hovering spire). Imports nothing: the runtime (public/labyrinth.js) hands in THREE and
// its helpers as H. Isles, bridges, poles and the spire are merged, vertex-coloured models drawn instanced, so a layer
// is about 25 draw calls.

// The air inside: bright, thin and far-seeing; the squall closes it in.
export const AIR = { sky: 0xc9dbe8, near: 34, far: 130, gutterFar: 58, hemi: 1.1, sun: 1.9, torch: 0xffe3b0 };
// The shared runtime's pieces on this floor: sky chests, wind shrines, the wind wall, beacons, storm-iron plates.
export const COLORS = {
  chest: 0x8a6a4a, chestDeep: 0x4a6a8a, band: 0xb7ad99, bandDeep: 0x7dd3fc, lever: 0x7d7a74, leverKnob: 0x7dd3fc, gate: 0x93c5fd,
  stair: 0xa39d92, plate: 0x6b665e, spike: 0x9ca3af, warn: 0xef4444, flame: 0xffb347, halo: 0xffd27a, bracket: 0x5a4632, lure: 0xfde68a,
};

const PAVE = 0xd6cab0, STONE = 0xbdb3a0, SLATE = 0x7d7a74, ROCK = 0x9b8f7c, DARK = 0x6f675b, WOOD = 0x5a4632, ROPE = 0xc9b48a, SKY = 0x7dd3fc, STORM = 0x3b4256;
const FLAGS = [0x3b82f6, 0xf5f0e1, 0xc2410c, 0x4d7c0f, 0xeab308]; // prayer flags: sky, cloud, fire, leaf, sun
const LOOK = { kitesteps: { lines: 0.7, sag: 0.7 }, turningisles: { lines: 0.4, sag: 0.9 }, eyespire: { lines: 0, sag: 1.3 } };
const POLE = 4.3; // prayer poles (their lines hang well over your head)

// Small build kit: matrices, a cylinder between two points, merging coloured pieces into one model, instancing.
function kit(H) {
  const T = H.THREE, m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), e = new T.Euler(), col = new T.Color(), up = new T.Vector3(0, 1, 0), d3 = new T.Vector3();
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
  const beam = (ax, ay, az, bx, by, bz, r0, r1, sides = 5, capped = false) => { // a tapered cylinder from b (radius r1) to a (radius r0)
    const d = new T.Vector3(ax - bx, ay - by, az - bz), len = d.length();
    return [new T.CylinderGeometry(r0, r1, len, sides, 1, !capped), new T.Matrix4().compose(new T.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), new T.Quaternion().setFromUnitVectors(up, d.normalize()), new T.Vector3(1, 1, 1))];
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
  const stretch = (im, i, ax, ay, az, bx, by, bz, rad) => { d3.set(ax - bx, ay - by, az - bz); const len = d3.length(); m4.compose(p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q.setFromUnitVectors(up, d3.normalize()), s.set(rad, len, rad)); im.setMatrixAt(i, m4); };
  const tint = (im, i, hex, dl = 0) => im.setColorAt(i, col.set(hex).offsetHSL(0, 0, dl));
  const lit = (c, o = 1) => { const m = H.glow(c, o); m.fog = false; return m; }; // a glow the haze doesn't dim
  const soft = (c, o) => { const m = lit(c, o); m.transparent = true; m.depthWrite = false; m.blending = T.AdditiveBlending; return m; };
  return { T, M, beam, merge, vmat, inst, put, stretch, tint, lit, soft };
}

// A floating isle S across: a paved top with a darker carved border, rock hanging under it (deep m).
function isleParts({ T, M }, S, deep, rm) {
  const b = Math.min(0.9, S * 0.07), out = [[new T.BoxGeometry(S - 2 * b, 0.9, S - 2 * b), M(0, -0.435, 0), PAVE]], k = S / 8;
  for (const [x, z, w, d] of [[0, -(S - b) / 2, S, b], [0, (S - b) / 2, S, b], [-(S - b) / 2, 0, b, S - 2 * b], [(S - b) / 2, 0, b, S - 2 * b]]) out.push([new T.BoxGeometry(w, 1.1, d), M(x, -0.535, z), SLATE]);
  out.push([new T.ConeGeometry(S * 0.5, deep, 6), M(0, -1 - deep / 2, 0, Math.PI, rm() * 3, 0), ROCK], [new T.ConeGeometry(S * 0.3, deep * 0.75, 5), M(S * 0.17, -1 - deep * 0.375, -S * 0.14, Math.PI, rm() * 3, 0), DARK]);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + rm() * 0.4, rad = (0.5 + rm() * 0.4) * k, d = S * 0.47; out.push([new T.DodecahedronGeometry(rad, 0), M(Math.max(-d, Math.min(d, Math.sin(a) * S * 0.62)), -0.45 - rad * 1.3, Math.max(-d, Math.min(d, Math.cos(a) * S * 0.62)), rm() * 3, rm() * 3, 0, 1, 1.3, 1), i % 2 ? ROCK : DARK]); }
  return out;
}
// A rope-and-plank bridge across a gap W long (along z), B to each side: planks, stringers, four posts, sagging ropes.
function bridgeParts({ T, M, beam }, B, W, rm) {
  const out = [], n = Math.round(W / 0.5), end = W / 2 + 0.3;
  for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push([new T.BoxGeometry(2 * B, 0.09, W / n - 0.07), M((rm() - 0.5) * 0.06, -0.03 - 0.05 * (1 - (2 * t - 1) ** 2), -W / 2 + t * W, 0, (rm() - 0.5) * 0.05, (rm() - 0.5) * 0.03), [0x8a6f4d, 0x7a6142, 0x9a7d58][Math.floor(rm() * 3)]]); }
  for (const sx of [-1, 1]) {
    const x = sx * (B + 0.1);
    out.push([new T.BoxGeometry(0.14, 0.14, W + 0.3), M(sx * (B - 0.35), -0.17, 0), 0x4a3a28]);
    for (const sz of [-1, 1]) out.push([new T.CylinderGeometry(0.09, 0.12, 1.35, 5), M(x, 0.66, sz * end), WOOD], [new T.OctahedronGeometry(0.15), M(x, 1.42, sz * end), 0xc2410c]);
    out.push([...beam(x, 1.25, -end, x, 0.82, -W / 6, 0.035, 0.035, 4), ROPE], [...beam(x, 0.82, W / 6, x, 0.82, -W / 6, 0.035, 0.035, 4), ROPE], [...beam(x, 1.25, end, x, 0.82, W / 6, 0.035, 0.035, 4), ROPE]);
    for (const z of [-W / 6, W / 6]) out.push([...beam(x, 0.82, z, sx * B, -0.02, z, 0.02, 0.02, 4), ROPE]);
  }
  return out;
}

// ---------- the scenery of one layer ----------
export function buildTerrain(root, L, H) {
  const { mat, glow, flat } = H, K = kit(H), { T, M, beam, merge, vmat, inst, put, stretch, tint, lit, soft } = K;
  const look = LOOK[L.id] || LOOK.kitesteps, heart = !!L.keeper;
  const C = L.cell, W = L.wall, S = C - W, B = L.bridge || 1.6, { cols, rows } = L, cx = L.x0 + L.w / 2, cz = L.z0 + L.d / 2;
  const r = H.rng(L.seeds.walls + 7), rm = H.rng(L.seeds.walls + 101), TAU = Math.PI * 2;
  const edgeAt = id => { const [i, j, d] = id.split(','), E = d === 'E'; return { x: L.x0 + (+i + (E ? 1 : 0.5)) * C, z: L.z0 + (+j + (E ? 0.5 : 1)) * C, E, rot: E ? Math.PI / 2 : 0 }; };

  // the isles: one per cell (the hall is one great plaza), far ones adrift all round, loose rock hanging under them
  const isles = [], ways = [], hang = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const hall = L.inHallCell(i, j);
    if (!hall) isles.push([L.x0 + (i + 0.5) * C, 0, L.z0 + (j + 0.5) * C, 1, 0.8 + r() * 0.8]);
    for (const [di, dj, d] of [[1, 0, 'E'], [0, 1, 'N']]) { const id = `${i},${j},${d}`; if (i + di < cols && j + dj < rows && L.open.has(id) && !(hall && L.inHallCell(i + di, j + dj))) ways.push(edgeAt(id)); }
  }
  const near = isles.length;
  for (let k = 0; k < 16; k++) { // (never close enough to look like somewhere to go)
    const side = k % 4, t = r(), o = 20 + r() * 36;
    isles.push([side < 2 ? L.x0 - 10 + t * (L.w + 20) : side === 2 ? L.x0 - o : L.x0 + L.w + o, -19 + r() * 19, side === 0 ? L.z0 - o : side === 1 ? L.z0 + L.d + o : L.z0 - 10 + t * (L.d + 20), 0.45 + r() * 0.9, 0.8 + r()]);
  }
  const isleIM = inst(merge(isleParts(K, S, 7, rm)), vmat(), isles.length, root); isleIM.castShadow = true; isleIM.receiveShadow = true;
  isles.forEach(([x, y, z, sc, sy], i) => {
    put(isleIM, i, x, y, z, i < near ? Math.floor(r() * 4) * Math.PI / 2 : r() * TAU, sc, sc * (i < near ? 1 : sy), sc); tint(isleIM, i, 0xffffff, -r() * 0.07);
    for (let k = 0; k < 2; k++) hang.push([x + (r() - 0.5) * S * 0.6 * sc, y - 1.2, z + (r() - 0.5) * S * 0.6 * sc, (0.5 + r() * 0.7) * sc, (2 + r() * 4) * sc]);
  });
  if (L.hall) {
    const [a0, b0, a1, b1] = L.hall, hs = (a1 - a0 + 1) * C - W, hx = L.x0 + (a0 + a1 + 1) / 2 * C, hz = L.z0 + (b0 + b1 + 1) / 2 * C;
    const plaza = new T.Mesh(merge(isleParts(K, hs, 23, rm)), vmat()); plaza.position.set(hx, 0, hz); plaza.castShadow = plaza.receiveShadow = true; root.add(plaza);
    for (let k = 0; k < 14; k++) { const a = r() * TAU, d = 4 + r() * hs * 0.4; hang.push([hx + Math.sin(a) * d, -1.2, hz + Math.cos(a) * d, 1.2 + r() * 2, 5 + r() * 9]); }
  }
  const hangIM = inst(new T.ConeGeometry(1, 1, 5), mat(0xffffff), hang.length, root);
  hang.forEach(([x, y, z, w, len], i) => { put(hangIM, i, x, y - len / 2, z, r() * 3, w, len, w, Math.PI); tint(hangIM, i, i % 2 ? ROCK : DARK, (r() - 0.5) * 0.06); });

  // bridges: rope and plank, exactly as wide as the way across
  const bridgeIM = inst(merge(bridgeParts(K, B, W, rm)), vmat(), ways.length, root); bridgeIM.castShadow = true; bridgeIM.receiveShadow = true;
  ways.forEach((at, i) => { put(bridgeIM, i, at.x, 0, at.z, at.rot + (r() < 0.5 ? Math.PI : 0)); tint(bridgeIM, i, 0xffffff, -r() * 0.1); });

  // the turning spans: a slab of floating stone with a rune line down it. Open, it lies level across its gap; shut, it
  // hangs turned a quarter and sunk well below, bobbing, and the gap is empty. Rune plates on both rims show which.
  const shifts = [...L.shiftEdges].map(([id, set]) => ({ ...edgeAt(id), set })), nSet = [0, 1].map(k => shifts.filter(sh => sh.set === k).length);
  const sp = [[new T.BoxGeometry(0.6, 0.55, W - 0.06), M(0, -0.26, 0), 0x8fb9dc], [new T.ConeGeometry(Math.min(B, W / 2) * 0.95, 2.6, 5), M(0, -1.8, 0, Math.PI, 0.4, 0), ROCK], [new T.DodecahedronGeometry(0.7, 0), M(B * 0.5, -0.9, W * 0.25, 1, 2, 0), DARK], [new T.DodecahedronGeometry(0.6, 0), M(-B * 0.55, -0.85, -W * 0.3, 2, 1, 0), DARK]];
  for (const sx of [-1, 1]) sp.push([new T.BoxGeometry(B - 0.3, 0.55, W - 0.06), M(sx * (B + 0.3) / 2, -0.26, 0), sx > 0 ? STONE : 0xb2a895]);
  const spanIM = inst(merge(sp), vmat(), shifts.length, root); spanIM.castShadow = spanIM.receiveShadow = true; spanIM.frustumCulled = false;
  const runes = [0, 1].map(k => inst(new T.BoxGeometry(2 * B, 0.03, 0.4), glow(SKY), nSet[k] * 2, root)), nRune = [0, 0];
  for (const sh of shifts) for (const o of [-1, 1]) { const d = o * (W / 2 + 0.34); put(runes[sh.set], nRune[sh.set]++, sh.x + (sh.E ? d : 0), 0.035, sh.z + (sh.E ? 0 : d), sh.rot); }

  // prayer poles (a wind chime on each), lines of flags strung between them, beacon posts under the torches
  const pg = [[new T.BoxGeometry(0.55, 0.4, 0.55), M(0, 0.2, 0), SLATE], [new T.CylinderGeometry(0.06, 0.09, POLE, 5), M(0, POLE / 2, 0), WOOD], [new T.OctahedronGeometry(0.16), M(0, POLE + 0.14, 0, 0, 0, 0, 1, 1.6, 1), 0xeab308], [new T.BoxGeometry(0.9, 0.05, 0.05), M(0.32, 2.75, 0), WOOD]];
  for (let k = 0; k < 3; k++) { const len = 0.3 + k * 0.12; pg.push([new T.CylinderGeometry(0.035, 0.035, len, 5), M(0.2 + k * 0.2, 2.66 - len / 2, 0), 0xb8c4d6]); }
  const poles = [], lines = [];
  if (!heart) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const sx = r() < 0.5 ? -1 : 1, sz = r() < 0.5 ? -1 : 1; poles.push([L.x0 + (i + 0.5) * C + sx * (S / 2 - 0.45), 0, L.z0 + (j + 0.5) * C + sz * (S / 2 - 0.45)]); }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) for (const [di, dj] of [[1, 0], [0, 1]]) if (i + di < cols && j + dj < rows && r() < look.lines) { const a = poles[j * cols + i], b = poles[(j + dj) * cols + i + di]; lines.push([a[0], POLE, a[2], b[0], POLE, b[2]]); }
  } else for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * TAU, sn = Math.sin(a), cs = Math.cos(a); const py = 7 + (k % 3) * 0.7; poles.push([cx + sn * 29.5, py, cz + cs * 29.5]); lines.push([cx + sn * 2.6, 19, cz + cs * 2.6, cx + sn * 29.5, py + POLE, cz + cs * 29.5]); } // (all of it above the camera)
  const poleIM = inst(merge(pg), vmat(), poles.length, root);
  poles.forEach(([x, y, z], i) => put(poleIM, i, x, y, z, r() * TAU));
  if (heart) { const stones = inst(new T.DodecahedronGeometry(1, 0), mat(SLATE), 8, root); poles.forEach(([x, y, z], i) => put(stones, i, x, y - 2.3, z, r() * 3, 1.5, 2.4, 1.3)); } // the rim stones the lines run out to
  const SEG = 4, flagN = lines.reduce((n, ln) => n + Math.floor(Math.hypot(ln[3] - ln[0], ln[5] - ln[2]) / 0.62), 0);
  const stringIM = inst(new T.CylinderGeometry(1, 1, 1, 3), mat(ROPE), lines.length * SEG, root);
  const flagMat = glow(0xffffff); flagMat.side = T.DoubleSide;
  const flags = inst(new T.PlaneGeometry(0.42, 0.5).translate(0, -0.25, 0), flagMat, flagN, root), fd = new Float32Array(flagN * 3); flags.frustumCulled = false;
  let nf = 0;
  lines.forEach(([ax, ay, az, bx, by, bz], n) => {
    const at = t => [ax + (bx - ax) * t, ay + (by - ay) * t - look.sag * 4 * t * (1 - t), az + (bz - az) * t];
    for (let k = 0; k < SEG; k++) stretch(stringIM, n * SEG + k, ...at(k / SEG), ...at((k + 1) / SEG), 0.02);
    const cnt = Math.floor(Math.hypot(bx - ax, bz - az) / 0.62), th = Math.atan2(-(bz - az), bx - ax);
    for (let k = 0; k < cnt; k++, nf++) { const [x, y, z] = at((k + 0.5) / cnt); put(flags, nf, x, y - 0.02, z, th); tint(flags, nf, FLAGS[(k + n) % 5]); fd[nf * 3] = Math.cos(th); fd[nf * 3 + 1] = Math.sin(th); fd[nf * 3 + 2] = r() * 30; }
  });
  const tg = merge([[new T.BoxGeometry(0.5, 0.35, 0.5), M(0, 0.17, 0), SLATE], [new T.CylinderGeometry(0.07, 0.1, 2.3, 5), M(0, 1.4, 0), WOOD], [new T.CylinderGeometry(0.24, 0.12, 0.2, 6), M(0, 2.55, 0), 0x5b5248]]);
  const postIM = inst(tg, vmat(), L.torchList.length, root);
  L.torchList.forEach((tc, i) => put(postIM, i, tc.x, 0, tc.z));

  // cloud puffs far below (over the floor's own cloud sea) and wind streaks that show which way it blows
  const puffs = inst(new T.IcosahedronGeometry(1, 0), mat(0xfff6e4, { emissive: 0x6b5a40, emissiveIntensity: 0.35, roughness: 1 }), 28, root); puffs.frustumCulled = false;
  for (let i = 0; i < 28; i++) { const sc = 8 + r() * 9; put(puffs, i, L.x0 - 50 + r() * (L.w + 100), -25 + r() * 7, L.z0 - 50 + r() * (L.d + 100), r() * 3, sc, 2.5 + r() * 2.5, sc * (0.6 + r() * 0.5)); }
  const NS = 22, span = Math.max(L.w, L.d) + 36, streakMat = glow(0xffffff, 0.45); streakMat.side = T.DoubleSide;
  const streaks = inst(new T.PlaneGeometry(6, 0.11).rotateX(-Math.PI / 2), streakMat, NS, root), sd = new Float32Array(NS * 4); streaks.frustumCulled = false;
  for (let i = 0; i < NS; i++) { sd[i * 4] = r() * span; sd[i * 4 + 1] = (r() - 0.5) * span; sd[i * 4 + 2] = 0.8 + r() * 6; sd[i * 4 + 3] = 9 + r() * 8; put(streaks, i, cx, 3, cz); }

  // the landmark: the Eye-Spire. From the outer layers it stands far beyond the way on, out of the cloud sea; in the
  // Heart it hovers over the middle of the plaza (so the whole floor stays clear), flag lines running out to the rim.
  const g = new T.Group(); root.add(g);
  const base = heart ? 17 : -27, top = 40; let rad = heart ? 3.4 : 6.5, y = base;
  const ps = [], bands = [];
  for (let k = 0; k < 4; k++) { const seg = (top - base) * [0.34, 0.28, 0.22, 0.16][k], r1 = rad * 0.72; ps.push([new T.CylinderGeometry(r1, rad, seg, 6), M((rm() - 0.5) * 0.7, y + seg / 2, (rm() - 0.5) * 0.7, 0, rm() * 3, 0), k % 2 ? 0x5f5d62 : 0x514f57]); y += seg; if (k < 3) bands.push([y, r1 + 0.45]); rad = r1 * 0.95; }
  ps.push([new T.ConeGeometry(rad, 5, 6), M(0, top + 2.5, 0), 0x5f5d62]);
  if (heart) ps.push([new T.ConeGeometry(3.4, 5.5, 6), M(0, base - 2.75, 0, Math.PI), 0x514f57]);
  for (let k = 0; k < 7; k++) { const a = r() * TAU, d = (heart ? 5 : 9) + r() * 4; ps.push([new T.DodecahedronGeometry(0.6 + r() * 0.9, 0), M(Math.sin(a) * d, base + 6 + r() * (top - base - 8), Math.cos(a) * d, r() * 3, r() * 3, 0, 1, 1.5, 1), ROCK]); } // shards adrift round it
  if (heart) g.position.set(cx, 0, cz); else g.position.set(L.x0 + (L.end[0] + 0.5) * C, 0, L.z0 + L.d + 40);
  const shaft = new T.Mesh(merge(ps), vmat()); shaft.castShadow = false; g.add(shaft);
  const bandIM = inst(new T.TorusGeometry(1, 0.035, 5, 20).rotateX(Math.PI / 2), lit(0x60a5fa), bands.length, g);
  bands.forEach(([by, br], i) => put(bandIM, i, 0, by, 0, 0, br, 4, br));
  const eye = new T.Mesh(new T.OctahedronGeometry(1.5), lit(SKY)); eye.position.y = top + 7.5; eye.scale.y = 1.6; g.add(eye);
  const crown = new T.Mesh(new T.TorusGeometry(4.6, 0.14, 5, 24).rotateX(Math.PI / 2), lit(0xbfdbfe)); crown.position.y = top + 7.5; g.add(crown);
  const halo = new T.Mesh(new T.SphereGeometry(7, 10, 8), soft(0x93c5fd, 0.16)); halo.position.y = top + 7.5; g.add(halo);
  const bp = []; let bx = 0, by = 0, bz = 0;
  for (let k = 0; k < 6; k++) { const nx = bx + 1.6 + rm() * 1.4, ny = by + (k % 2 ? 1.7 : -1.2) * (0.6 + rm()), nz = bz + (rm() - 0.5) * 2.4; bp.push([...beam(nx, ny, nz, bx, by, bz, 0.05 + (5 - k) * 0.012, 0.06 + (5 - k) * 0.012, 3), 0xffffff]); bx = nx; by = ny; bz = nz; }
  const boltGeo = merge(bp), boltMat = lit(0xe0f2fe), bolts = [0, 1, 2].map(() => { const b = new T.Mesh(boltGeo, boltMat); b.position.y = top + 7.5; g.add(b); return b; });
  const storm = inst(new T.IcosahedronGeometry(1, 0), mat(STORM, { roughness: 1 }), 9, g);
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, d = 7 + r() * 9, sc = 6 + r() * 5; put(storm, i, Math.sin(a) * d, top + 16 + r() * 5, Math.cos(a) * d, r() * 3, sc, 2.6 + r() * 1.5, sc); }
  const pulse = [];
  if (heart) { // the plaza under the spire: the eye's rune rings, cracks running out from it, a shaft of light from its point
    const ring = (a, b, c, o) => { const m = flat(1, 1, glow(c, o), cx, 0.035, cz); m.geometry = new T.RingGeometry(a, b, 56); return m; };
    pulse.push(ring(7.6, 8, 0x93c5fd, 0.6).material, ring(2.3, 2.8, SKY, 0.7).material); ring(16.6, 16.9, 0x60a5fa, 0.3);
    const cracks = inst(new T.PlaneGeometry(0.22, 1).rotateX(-Math.PI / 2), mat(0x5b6476), 12, root);
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + 0.1, len = 3.5 + (i % 3) * 2.2; put(cracks, i, cx + Math.sin(a) * (8.4 + len / 2), 0.03, cz + Math.cos(a) * (8.4 + len / 2), a, 1, 1, len); }
    const beamDown = new T.Mesh(new T.CylinderGeometry(0.3, 2.6, 11.5, 10, 1, true), soft(0x93c5fd, 0.1)); beamDown.position.set(cx, 5.75, cz); root.add(beamDown);
  }

  // ---------- per frame: the spans, the flags and streaks on the wind, the crown's lightning ----------
  const OPEN = new T.Color(SKY), SHUT = new T.Color(0x9a3412), hash = n => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const open = [-1, -1]; let wx = 0, wz = 0;
  function update(dt, time, info) {
    const squall = (info?.gutter || 0) > 0, wind = info?.wind || null;
    for (let k = 0; k < 2; k++) { const want = (info?.phase ? 1 : 0) === k ? 1 : 0; open[k] = open[k] < 0 ? want : open[k] + Math.sign(want - open[k]) * Math.min(Math.abs(want - open[k]), dt / 1.5); runes[k].material.color.lerpColors(SHUT, OPEN, open[k]); }
    for (let i = 0; i < shifts.length; i++) {
      const sh = shifts[i], o = open[sh.set], away = 1 - o * o * (3 - 2 * o);
      put(spanIM, i, sh.x, away * (-4.6 + Math.sin(time * 1.1 + i * 2) * 0.3), sh.z, sh.rot + away * Math.PI / 2, 1, 1, 1, away * 0.1, away * 0.22);
    }
    spanIM.instanceMatrix.needsUpdate = true;
    // flags: each hangs from its line and streams downwind (harder in the squall), with a flutter of its own
    const f = Math.min(1, dt * 2); wx += ((wind ? wind[0] : 0) - wx) * f; wz += ((wind ? wind[1] : 0) - wz) * f;
    const a = flags.instanceMatrix.array, gust = squall ? 1.7 : 1;
    for (let i = 0, o = 0; i < flagN; i++, o += 16) {
      const c = fd[i * 3], sn = fd[i * 3 + 1], wn = wx * sn + wz * c;
      const ang = -wn * 1.1 * Math.min(1.25, gust) + Math.sin(time * 6 * gust + fd[i * 3 + 2]) * (0.16 + 0.22 * Math.abs(wn)) * gust, ca = Math.cos(ang), sa = Math.sin(ang);
      a[o + 4] = sn * sa; a[o + 5] = ca; a[o + 6] = c * sa; a[o + 8] = sn * ca; a[o + 9] = -sa; a[o + 10] = c * ca;
    }
    flags.instanceMatrix.needsUpdate = true;
    streaks.visible = !!wind;
    if (wind) {
      const m = streaks.instanceMatrix.array, ux = wind[0], uz = wind[1];
      for (let i = 0, o = 0; i < NS; i++, o += 16) {
        const along = ((sd[i * 4] + time * sd[i * 4 + 3] * gust) % span) - span / 2, lat = sd[i * 4 + 1];
        m[o] = ux; m[o + 2] = uz; m[o + 8] = -uz; m[o + 10] = ux; m[o + 12] = cx + ux * along - uz * lat; m[o + 13] = sd[i * 4 + 2]; m[o + 14] = cz + uz * along + ux * lat;
      }
      streaks.instanceMatrix.needsUpdate = true;
    }
    puffs.position.x = Math.sin(time * 0.02) * 9; puffs.position.z = Math.cos(time * 0.017) * 9;
    // the crown: the ring turns, the eye beats, bolts jump round it (more of them in the squall)
    crown.rotation.y = time * 0.5; crown.rotation.x = Math.sin(time * 0.7) * 0.25;
    const beat = 0.85 + 0.15 * Math.sin(time * 2.2); eye.scale.set(beat, 1.6 * beat, beat); halo.material.opacity = 0.16 * beat * (squall ? 1.6 : 1);
    for (let k = 0; k < 3; k++) { const n = Math.floor(time * 9) + k * 17.3, b = bolts[k]; b.visible = hash(n) < (squall ? 0.75 : 0.3); if (b.visible) { b.rotation.y = hash(n + 0.5) * TAU; b.rotation.z = (hash(n + 0.7) - 0.5) * 1.4; } }
    for (let i = 0; i < pulse.length; i++) pulse[i].opacity = (i ? 0.7 : 0.6) * beat;
  }
  return { update };
}

// ---------- the way in, on the Spires: a stone landing between two prayer poles, a rope bridge off into the cloud ----------
export function buildEntry(parent, lab, H) {
  const { glow } = H, K = kit(H), { T, M, beam, merge, vmat } = K, rm = H.rng(lab.layers[0].seeds.walls + 3);
  const E = lab.entry, g = new T.Group(); g.position.set(E.x, 0, E.z); parent.add(g);
  const ps = [[new T.BoxGeometry(4.2, 0.1, 3.8), M(0, 0, 0), STONE]];
  for (const [x, z, w, d] of [[0, -2.1, 4.8, 0.4], [0, 2.1, 4.8, 0.4], [-2.25, 0, 0.3, 3.8], [2.25, 0, 0.3, 3.8]]) ps.push([new T.BoxGeometry(w, 0.14, d), M(x, 0, z), SLATE]);
  for (const part of bridgeParts(K, 1.3, 2.6, rm)) { part[1].premultiply(M(0, 0.06, -3.75)); ps.push(part); }
  for (const sx of [-1, 1]) ps.push([new T.BoxGeometry(0.55, 0.4, 0.55), M(sx * 2.1, 0.2, -1.9), SLATE], [new T.CylinderGeometry(0.06, 0.09, POLE, 5), M(sx * 2.1, POLE / 2, -1.9), WOOD], [new T.OctahedronGeometry(0.16), M(sx * 2.1, POLE + 0.14, -1.9, 0, 0, 0, 1, 1.6, 1), 0xeab308]);
  for (let k = 0; k < 7; k++) { const t = (k + 0.5) / 7, y = POLE - 0.1 - 0.5 * 4 * t * (1 - t); ps.push([new T.BoxGeometry(0.4, 0.5, 0.02), M(-2.1 + t * 4.2, y - 0.25, -1.9, 0.25, 0, (rm() - 0.5) * 0.3), FLAGS[k % 5]]); }
  for (let k = 0; k < 3; k++) ps.push([...beam(-2.1 + (k + 1) * 1.4, POLE - 0.1 - 0.5 * 4 * ((k + 1) / 3) * (1 - (k + 1) / 3), -1.9, -2.1 + k * 1.4, POLE - 0.1 - 0.5 * 4 * (k / 3) * (1 - k / 3), -1.9, 0.02, 0.02, 3), ROPE]);
  const cp = []; // the cloud it leads into
  for (let k = 0; k < 7; k++) { const sc = 0.7 + rm() * 0.7; cp.push([new T.IcosahedronGeometry(1, 0), M((k - 3) * 0.75 + (rm() - 0.5) * 0.5, 0.35 + rm() * 0.9, -5.3 - rm() * 1.1, rm() * 3, rm() * 3, 0, sc * 1.4, sc * 0.6, sc), 0xffffff]); }
  g.add(new T.Mesh(merge(cp), H.mat(0xffffff, { emissive: 0xfff6e4, emissiveIntensity: 0.6, roughness: 1 })));
  const mesh = new T.Mesh(merge(ps), vmat()); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
  const ring = new T.Mesh(new T.RingGeometry(E.use - 0.25, E.use, 48), glow(SKY, 0.35)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
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
  const legs = []; let armR = null, height = 2.3;
  // a harpy: bird legs, a leaning feathered body, a beaked head with a crest, a fanned tail, two wings (armR is the right)
  const harpy = (plume, dark, pale, span, queen) => {
    for (const sx of [-1, 1]) { const leg = part(box(0.12, 0.72, 0.12), 0xd9a441, sx * 0.2, 0.36, 0, body); part(box(0.24, 0.07, 0.36), 0xd9a441, 0, -0.33, 0.1, leg); legs.push(leg); }
    part(box(0.62, 0.85, 0.44), plume, 0, 1.15, 0.02, body, 0.3); part(box(0.5, 0.5, 0.1), pale, 0, 1.2, 0.3, body, 0.3);
    for (let k = -2; k <= 2; k++) if (queen || Math.abs(k) < 2) part(box(0.16, 0.04, queen ? 1.1 : 0.7), k % 2 ? dark : plume, k * 0.14, 0.82, -0.55 - (queen ? 0.2 : 0), body, 0.45, k * 0.12);
    const head = part(box(0.36, 0.36, 0.36), plume, 0, 1.76, 0.24, body);
    part(new T.ConeGeometry(0.09, 0.32, 4), 0xeab308, 0, -0.04, 0.3, head, Math.PI / 2); eyes(head, SKY, 0.05, 0.11, 0.06, 0.19);
    for (let k = 0; k < 3; k++) part(new T.ConeGeometry(0.07, 0.36 + k * 0.08, 4), dark, 0, 0.3, -0.02 - k * 0.12, head, -0.5 - k * 0.2);
    for (const sx of [-1, 1]) {
      const arm = new T.Group(); arm.position.set(sx * 0.34, 1.5, 0); body.add(arm); if (sx > 0) armR = arm;
      const wing = new T.Group(); wing.rotation.z = sx * 0.4; arm.add(wing);
      part(box(span, 0.12, 0.34), dark, sx * span / 2, 0, 0, wing);
      const nFe = queen ? 6 : 4;
      for (let k = 0; k < nFe; k++) part(box(span / nFe - 0.03, 0.04, 0.62 + (k % 2) * 0.16 + k * 0.05), k === nFe - 1 ? pale : k % 2 ? plume : dark, sx * (k + 0.5) * span / nFe, -0.3, -0.2 - k * 0.02, wing, 1.0);
    }
  };
  if (type === 'stormharpy') { harpy(0x64768f, 0x46506a, 0xb8c4d6, 1.15, false); height = 2.3; }
  else if (type === 'kiterider') { // a raider slung under a great diamond kite: boots off the ground, goggles, a hooked spear
    const leather = 0x8a7355, cloth = 0xc2410c;
    for (const sx of [-1, 1]) legs.push(part(box(0.17, 0.75, 0.17), 0x4a3f33, sx * 0.16, 1.02, 0, body));
    part(box(0.52, 0.72, 0.32), leather, 0, 1.76, 0, body, 0.15); part(box(0.56, 0.12, 0.36), 0x3b332c, 0, 1.45, 0, body);
    const head = part(box(0.34, 0.34, 0.34), 0xd9b38c, 0, 2.32, 0.06, body);
    part(box(0.38, 0.14, 0.36), 0x4a3f33, 0, 0.14, 0, head); part(box(0.5, 0.1, 0.9), SKY, 0, -0.22, -0.4, head, 0.3); // cap, scarf streaming back
    for (const sx of [-1, 1]) { const lens = new T.Mesh(new T.BoxGeometry(0.11, 0.09, 0.03), glow(0xfde047)); lens.position.set(sx * 0.08, 0.02, 0.18); head.add(lens); }
    const kite = new T.Group(); kite.position.set(0, 3.7, -0.2); kite.rotation.x = -0.7; body.add(kite);
    part(box(2.0, 0.05, 2.0), cloth, 0, 0, 0, kite).rotation.y = Math.PI / 4; part(box(0.9, 0.06, 0.9), 0xeab308, 0, 0.01, 0, kite).rotation.y = Math.PI / 4;
    part(box(2.8, 0.07, 0.07), WOOD, 0, 0.05, 0, kite); part(box(0.07, 0.07, 2.8), WOOD, 0, 0.05, 0, kite);
    for (let k = 0; k < 3; k++) part(box(0.3, 0.03, 0.34), FLAGS[k], 0, -0.1 - k * 0.12, -1.7 - k * 0.5, kite, 0.3); // its tail
    part(box(1.1, 0.06, 0.06), WOOD, 0, 2.78, 0.12, body); // the bar
    for (const sx of [-1, 1]) part(new T.CylinderGeometry(0.015, 0.015, 1.0, 4), ROPE, sx * 0.5, 3.22, 0.0, body, -0.25, sx * -0.3);
    const armL = new T.Group(); armL.position.set(-0.34, 2.05, 0); body.add(armL); part(box(0.14, 0.78, 0.14), leather, -0.08, 0.34, 0.06, armL, 0.15);
    armR = new T.Group(); armR.position.set(0.36, 2.05, 0); body.add(armR);
    part(box(0.14, 0.7, 0.14), leather, 0, -0.28, 0.14, armR, -0.5);
    part(new T.CylinderGeometry(0.03, 0.03, 2.0, 5), WOOD, 0, -0.6, 0.6, armR, Math.PI / 2 - 0.25); part(new T.ConeGeometry(0.09, 0.4, 4), 0xcbd5e1, 0, -0.9, 1.72, armR, Math.PI / 2 - 0.25);
    height = 4.5;
  } else { // the Gale Matriarch: the harpy queen. Wide storm-dark wings tipped white, long tail, a crown of lightning shards
    harpy(0x55628a, 0x363f5c, 0xe5edf5, 1.9, true);
    const head = body.children.find(o => o.isMesh && o.position.y === 1.76);
    for (let k = -2; k <= 2; k++) { const sh = new T.Mesh(new T.OctahedronGeometry(0.08), glow(k % 2 ? 0x93c5fd : 0xe0f2fe)); sh.position.set(k * 0.13, 0.42 - Math.abs(k) * 0.05, 0); sh.scale.y = 3 - Math.abs(k) * 0.6; head.add(sh); }
    const gem = new T.Mesh(new T.OctahedronGeometry(0.13), glow(SKY)); gem.position.set(0, 1.42, 0.42); body.add(gem);
    part(box(0.9, 0.18, 0.5), 0x363f5c, 0, 1.58, -0.02, body, 0.3); // a mantle of dark feathers
    body.scale.setScalar(2); height = 4.7;
  }
  const cursor = new T.Mesh(new T.OctahedronGeometry(type === 'galematriarch' ? 0.22 : 0.14), new T.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.2; g.add(cursor);
  return { group: g, body, legs, armR, cursor, mats: Object.values(pal), height };
}
