// Client side of looks (data: shared/looks.js, server: server/looks.js).
// A look is applied to any entity whose id is listed in a snapshot's w.looks: players, bots, the Named, mobs.
//   - the rig's own texture remapped onto the look's colour ramp, attachments hidden, a height factor
//   - procedural cloth and gear on the bones (hood, coat tails, collar, mantle, cape + emblem), the way public/styles.js
//     builds weapons; the tails, the hood's tail and the lantern sway and lag behind when the character moves
//   - a signature weapon in the hand slot (the weapon style underneath still plays its attacks)
//   - an aura: a faint ground glow, motes rising from the lantern, a short trail while moving
//   - plate(): the nameplate treatment; swatch(): a round badge for UI lists
// Entities without a KayKit rig (block models, most mobs) get the aura and the nameplate only.
// main.js calls snap() per snapshot and frame() per entity per frame.
import * as THREE from 'three';
import { lookOf } from '/shared/looks.js';

const CSS = `
.lbl .lk { font-weight: 800; letter-spacing: .02em; }
.lbl .lk-t { display: block; font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; opacity: .9; margin-top: 1px; }
.lk-sw { display: inline-block; vertical-align: -0.28em; margin-right: .3em; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.45); }
`;
const HIDDEN = 31; // a render layer no camera draws: hides rig parts without touching .visible (which styles and skills toggle)

// ---------- emblems: flat polygons in a -1..1 box (y up), used on capes (3D) and swatches (SVG) ----------
const mirror = pts => pts.map(([x, y]) => [-x, y]).reverse();
const mothWing = [[0.1, 0.28], [0.86, 0.72], [0.98, 0.12], [0.48, -0.1], [0.1, 0]], mothTail = [[0.1, -0.06], [0.52, -0.16], [0.62, -0.66], [0.26, -0.72], [0.1, -0.36]];
const sunRay = a => { const c = Math.cos(a), s = Math.sin(a), w = 0.11; return [[c * 0.62 - s * w, s * 0.62 + c * w - 0.3], [c * 0.98, s * 0.98 - 0.3], [c * 0.62 + s * w, s * 0.62 - c * w - 0.3]]; };
export const EMBLEMS = {
  moth: [[[0, 0.6], [0.09, 0], [0, -0.62], [-0.09, 0]], mothWing, mirror(mothWing), mothTail, mirror(mothTail)],
  sun: [Array.from({ length: 9 }, (_, i) => [Math.cos((i / 8) * Math.PI) * 0.5, Math.sin((i / 8) * Math.PI) * 0.5 - 0.3]), ...[0.3, 0.94, 1.57, 2.2, 2.84].map(sunRay), [[-0.95, -0.42], [0.95, -0.42], [0.95, -0.56], [-0.95, -0.56]]],
};
const hex = n => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

// ---------- materials ----------
const cloth = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide, ...o });
const metal = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55, flatShading: true, ...o });
const lit = color => new THREE.MeshBasicMaterial({ color }); // unlit: reads as glowing
let glowTex = null;
function glowTexture() { // a soft round dot
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
const haze = (color, opacity) => new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

function mesh(geo, m, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.castShadow = shadow; o.frustumCulled = false;
  return o;
}
function rng(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }

// A hanging strip of cloth: the top edge centred on the origin along x, hanging down -y, bowing out towards +z,
// with a torn hem (teeth: points along the bottom; ragged 0-1: how deep the tears go).
function strip(w0, w1, len, { teeth = 2, ragged = 0.3, bow = 0, seed = 1 } = {}) {
  const rows = 4, cols = teeth * 2, rnd = rng(seed), pos = [], idx = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows, w = w0 + (w1 - w0) * t;
    for (let c = 0; c <= cols; c++) {
      let y = -len * t;
      if (r === rows) y = -len * (c % 2 ? 1 : 1 - ragged * (0.45 + 0.55 * rnd()));
      pos.push((c / cols - 0.5) * w, y, bow * t * t + (r === rows ? (rnd() - 0.5) * 0.03 : 0));
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function emblemGeo(id) {
  const polys = EMBLEMS[id];
  if (!polys) return null;
  return new THREE.ShapeGeometry(polys.map(p => new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x, y)))));
}

// ---------- the rig's texture on a two-colour ramp (cached per texture and look) ----------
const remapped = new Map();
function remap(tex, look) {
  const t = look.tint, key = `${tex.uuid}:${look.id}`;
  if (remapped.has(key)) return remapped.get(key);
  let out = null;
  try {
    const img = tex.image, c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    const lo = new THREE.Color(t.ramp[0]), hi = new THREE.Color(t.ramp[1]), k = t.amount ?? 1; // (sRGB bytes below, so read the ramp as sRGB too)
    const l8 = v => Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255), a = [l8(lo.r), l8(lo.g), l8(lo.b)], b = [l8(hi.r), l8(hi.g), l8(hi.b)];
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], bb = px[i + 2], mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
      if (t.keepSkin && mx > 150 && r >= gg && gg >= bb && mx - mn > 25 && mx - mn < 120 && (gg - bb) < (r - bb) * 0.8 && (gg - bb) > (r - bb) * 0.35) continue; // warm, light, soft: skin
      let L = (0.3 * r + 0.59 * gg + 0.11 * bb) / 255;
      L = L * L * (3 - 2 * L); // a little more contrast
      for (let j = 0; j < 3; j++) px[i + j] = px[i + j] * (1 - k) + (a[j] + (b[j] - a[j]) * L) * k;
    }
    g.putImageData(d, 0, 0);
    out = new THREE.CanvasTexture(c);
    for (const p of ['flipY', 'wrapS', 'wrapT', 'colorSpace', 'magFilter', 'minFilter', 'generateMipmaps', 'channel']) out[p] = tex[p];
    out.needsUpdate = true;
  } catch { out = null; } // (no 2D canvas for this image: keep the rig's own colours)
  remapped.set(key, out);
  return out;
}

// ---------- parts: each adds objects to rig.objs and, when it moves, a function to rig.tick ----------
// Sizes are in the rig's own units (a KayKit adventurer is about 2.2 tall: legs 0.4, body 0.85, head 1.0).
function sway(rig, pivot, { angle = 0, base, lag = 0.3, amp = 0.04, i = 0 }) { // a hanging piece: flares out, lags when moving
  pivot.rotation.x = -base;
  rig.tick.push((t, mv) => {
    const back = -Math.cos(angle); // 1: straight behind, -1: in front
    pivot.rotation.x = -(base + Math.sin(t * 2.1 + i * 1.7) * amp + mv * lag * Math.max(-0.35, back) + mv * Math.sin(t * 9 + i * 2.3) * 0.05);
  });
}

function addHood(rig, h) {
  const head = rig.bone('head');
  if (!head) return;
  const g = new THREE.Group(); g.position.set(0, 0.45, -0.03);
  const outer = cloth(h.color), inner = cloth(h.lining ?? 0x111111);
  rig.cloth.push(outer);
  const open = 0.8, shell = r => { const geo = new THREE.SphereGeometry(r, 10, 7, 0, Math.PI * 2, open, Math.PI - open); geo.rotateX(Math.PI / 2); return geo; }; // the opening faces +z
  const o = mesh(shell(0.66), outer); o.scale.set(0.98, 1, 1.0); g.add(o);
  const i = mesh(shell(0.63), inner, 0, 0, 0, false); i.scale.copy(o.scale); g.add(i);
  const rim = mesh(new THREE.TorusGeometry(0.66 * Math.sin(open), 0.045, 4, 14), outer, 0, 0, 0.66 * Math.cos(open)); g.add(rim); // a rolled edge round the face
  const peak = mesh(new THREE.ConeGeometry(0.3, 0.42, 5), outer, 0, 0.5, -0.33); peak.rotation.x = -0.9; g.add(peak);
  if (h.tail) { // a long flat tail down the back, in swaying pieces, torn at the tip
    const n = 4, seg = h.tail.len / n, tm = h.tail.color === h.color ? outer : cloth(h.tail.color);
    if (tm !== outer) rig.cloth.push(tm);
    let parent = g, y = 0.2, z = -0.63;
    for (let k = 0; k < n; k++) {
      const p = new THREE.Group(); p.position.set(0, y, z); parent.add(p);
      const w = 0.36 - k * 0.05;
      if (k < n - 1) p.add(mesh(new THREE.BoxGeometry(w, seg * 1.04, 0.035), tm, 0, seg / 2, 0));
      else { const tip = strip(w, w * 0.85, seg * 1.15, { teeth: 2, ragged: 0.6, seed: 11 }); tip.rotateX(Math.PI); p.add(mesh(tip, tm)); }
      const rest = k ? -0.07 : -2.95; // straight down the back; it streams out behind when he runs
      p.rotation.x = rest;
      rig.tick.push((t, mv) => { p.rotation.x = rest + (k ? 0.1 : 0.75) * mv + Math.sin(t * 2.3 - k * 0.9) * (0.03 + k * 0.025) + mv * Math.sin(t * 8 - k * 1.3) * 0.07; p.rotation.z = Math.sin(t * 1.7 - k * 1.1) * 0.03 * (k + 1); });
      parent = p; y = seg; z = 0;
    }
  }
  if (h.mask) { // a band across the lower face
    const m = mesh(new THREE.CylinderGeometry(0.585, 0.56, 0.34, 9, 1, true, -1.15, 2.3), cloth(h.mask), 0, -0.36, 0.03, false);
    m.scale.z = 0.93; g.add(m);
  }
  for (const c of head.children) if (!c.isBone) c.traverse(o => { o.layers.set(HIDDEN); rig.hid.add(o); }); // hats built onto the head (the Bard's)
  head.add(g); rig.objs.push(g);
}

function addCoat(rig, c) {
  const hips = rig.bone('hips'), chest = rig.bone('chest');
  if (!hips) return;
  const outer = cloth(c.color), inner = cloth(c.lining ?? c.color);
  rig.cloth.push(outer);
  const g = new THREE.Group(); g.position.y = 0.16;
  const n = c.tails || 6, gap = 1.25, arc = Math.PI * 2 - gap, rx = 0.44, rz = 0.4; // open at the front
  const waist = mesh(new THREE.CylinderGeometry(0.43, 0.47, 0.16, 12, 1, true, gap / 2, arc), outer); waist.scale.z = rz / rx; g.add(waist);
  const w0 = (arc * (rx + rz) / 2 / n) * 1.25;
  for (let i = 0; i < n; i++) {
    const a = gap / 2 + ((i + 0.5) / n) * arc; // 0: front, PI: behind
    const p = new THREE.Group(); p.position.set(Math.sin(a) * rx, -0.04, Math.cos(a) * rz); p.rotation.y = a;
    const piv = new THREE.Group(); p.add(piv);
    const len = c.length * (0.9 + 0.22 * Math.abs(Math.sin(i * 2.4))), opts = { teeth: 2, ragged: c.ragged ?? 0.3, bow: 0.06, seed: i + 3 };
    piv.add(mesh(strip(w0, w0 * 1.55, len, opts), outer));
    const lin = mesh(strip(w0 * 0.94, w0 * 1.45, len * 0.95, opts), inner, 0, 0, -0.015, false); piv.add(lin);
    sway(rig, piv, { angle: a, base: c.flare ?? 0.4, lag: 0.45, i });
    g.add(p);
  }
  hips.add(g); rig.objs.push(g);
  if (c.collar && chest) { // a tall collar, open at the throat
    const k = c.collar, col = mesh(new THREE.CylinderGeometry(0.56, 0.42, k.height, 10, 1, true, 0.55, Math.PI * 2 - 1.1), k.color === c.color ? outer : cloth(k.color), 0, 0.2 + k.height / 2, -0.04);
    col.scale.z = 0.86; col.rotation.x = -0.12;
    chest.add(col); rig.objs.push(col);
  }
  if (c.mantle && chest) addMantle(rig, c.mantle, chest);
}

function addMantle(rig, m, chest) { // a half-cape over one shoulder
  const side = m.side === 'r' ? -1 : 1, body = cloth(m.color);
  rig.cloth.push(body);
  const g = new THREE.Group(); g.position.set(0.16 * side, 0.3, -0.02);
  const len = m.length, r1 = 0.66, t0 = 0.35, tl = 2.75, seg = 9;
  const geo = new THREE.CylinderGeometry(0.2, r1, len, seg, 3, true, t0, tl);
  const pos = geo.attributes.position, rnd = rng(7);
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -len / 2 + 0.01) pos.setY(i, pos.getY(i) + (rnd() - 0.35) * 0.2); // a torn hem
  geo.computeVertexNormals();
  const shell = mesh(geo, body, 0, -len / 2, 0); if (side < 0) shell.scale.x = -1;
  g.add(shell);
  if (m.trim !== undefined) g.add(mesh(new THREE.OctahedronGeometry(0.075), metal(m.trim), 0.14 * side, -0.02, 0.2)); // the clasp
  if (m.spots !== undefined) { // two eye-spots, like a moth's wing
    const sm = lit(m.spots), ring = lit(m.color);
    for (const th of [1.25, 2.2]) {
      const f = 0.62, r = (0.2 + (r1 - 0.2) * f) + 0.012, slope = Math.atan2(r1 - 0.2, len);
      const s = new THREE.Group(); s.position.set(Math.sin(th) * r * side, -len * f, Math.cos(th) * r); s.rotation.set(0, th * side, 0, 'YXZ'); s.rotateX(-slope);
      s.add(mesh(new THREE.CircleGeometry(0.085, 10), sm, 0, 0, 0, false));
      s.add(mesh(new THREE.CircleGeometry(0.04, 8), ring, 0, 0, 0.004, false));
      for (const o of s.children) o.material.side = THREE.DoubleSide;
      g.add(s);
    }
  }
  const piv = new THREE.Group(); piv.add(g);
  rig.tick.push((t, mv) => { piv.rotation.x = Math.sin(t * 1.9) * 0.02 + mv * 0.06; });
  chest.add(piv); rig.objs.push(piv);
}

function addCape(rig, c) { // a short cape down the back, with an emblem
  const chest = rig.bone('chest');
  if (!chest) return;
  const body = cloth(c.color);
  rig.cloth.push(body);
  const p = new THREE.Group(); p.position.set(0, 0.22, -0.34); p.rotation.y = Math.PI;
  const piv = new THREE.Group(); p.add(piv);
  const len = c.length ?? 0.5, o = { teeth: 3, ragged: 0.12, bow: 0.05, seed: 2 };
  piv.add(mesh(strip(0.78, 0.98, len, o), body));
  p.add(mesh(new THREE.BoxGeometry(0.86, 0.09, 0.1), c.trim !== undefined ? cloth(c.trim) : body, 0, 0.01, 0)); // the shoulder band
  if (c.trim !== undefined) piv.add(mesh(strip(0.8, 1.02, len + 0.05, o), cloth(c.trim), 0, 0, -0.012)); // a trim showing at the hem
  const eg = c.emblem && emblemGeo(c.emblem);
  if (eg) { const e = mesh(eg, cloth(c.emblemColor ?? 0xffffff, { roughness: 0.6 }), 0, -len * 0.5, 0.045, false); e.scale.setScalar(Math.min(0.26, len * 0.42)); e.rotation.x = 0.1; piv.add(e); }
  sway(rig, piv, { angle: Math.PI, base: 0.16, lag: 0.5, amp: 0.03 });
  chest.add(p); rig.objs.push(p);
}

// Weapons, in the hand slot's frame like public/styles.js: the grip at the origin, the business end along +y.
const WEAPONS = {
  // A hooked glaive: a long dark haft, a crook at the top with a crescent blade along its back, and a caged lantern
  // hanging from the tip of the hook.
  lanternglaive(rig, w) {
    const g = new THREE.Group(), haft = metal(w.haft, { metalness: 0.2, roughness: 0.7 }), steel = metal(w.steel, { side: THREE.DoubleSide, metalness: 0.15, roughness: 0.5 }), iron = metal(w.cage), top = 2.25, R = 0.4;
    g.add(mesh(new THREE.CylinderGeometry(0.045, 0.055, 3.25, 6), haft, 0, top - 1.625, 0));
    const butt = mesh(new THREE.ConeGeometry(0.07, 0.2, 5), iron, 0, top - 3.33, 0); butt.rotation.x = Math.PI; g.add(butt);
    for (const y of [0.42, -0.3, 1.5]) g.add(mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.1, 6), steel, 0, y, 0)); // pale bindings
    const crook = mesh(new THREE.TorusGeometry(R, 0.05, 5, 12, Math.PI * 1.2), iron, R, top, 0); crook.rotation.z = -0.2 * Math.PI; g.add(crook);
    const s = new THREE.Shape(); // the crescent, hugging the back of the crook
    s.absarc(R, top, R + 0.3, Math.PI * 1.08, Math.PI * 0.12, true); s.absarc(R + 0.02, top - 0.12, R + 0.07, Math.PI * 0.14, Math.PI * 1.02, false);
    g.add(mesh(new THREE.ShapeGeometry(s, 10), steel, 0, 0, 0, false)); // (no shadow: a thin two-sided sheet would shade itself)
    const tip = [R + R * Math.cos(-0.2 * Math.PI), top + R * Math.sin(-0.2 * Math.PI)];
    const lan = new THREE.Group(); lan.position.set(tip[0], tip[1], 0); g.add(lan);
    const hang = new THREE.Group(); lan.add(hang); // kept upright each frame
    hang.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 4), iron, 0, -0.1, 0));
    hang.add(mesh(new THREE.ConeGeometry(0.15, 0.12, 6), iron, 0, -0.24, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; hang.add(mesh(new THREE.BoxGeometry(0.02, 0.3, 0.02), iron, Math.cos(a) * 0.115, -0.45, Math.sin(a) * 0.115)); }
    hang.add(mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.05, 6), iron, 0, -0.62, 0));
    const flame = mesh(new THREE.OctahedronGeometry(0.085), lit(w.flame), 0, -0.45, 0, false); flame.scale.y = 1.5; hang.add(flame);
    const halo = new THREE.Sprite(haze(w.flame, 0.75)); halo.position.set(0, -0.45, 0); halo.scale.setScalar(1.3); hang.add(halo);
    const q = new THREE.Quaternion();
    rig.tick.push((t, mv) => { // the lantern hangs straight down and swings a little
      lan.getWorldQuaternion(q); hang.quaternion.copy(q.invert());
      hang.rotateZ(Math.sin(t * 2.6) * (0.08 + mv * 0.16)); hang.rotateX(Math.sin(t * 2.1 + 1) * 0.05 - mv * 0.2);
      flame.rotation.y = t * 2.4; halo.material.opacity = 0.62 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 13.1) * 0.05;
    });
    rig.light = flame; // where the motes rise from
    return g;
  },
};
function addWeapon(rig, w) {
  const R = rig.bone('handslotr'), build = WEAPONS[w.model];
  if (!R || !build) return;
  const obj = build(rig, w);
  obj.quaternion.set(0, -1, 0, 0); obj.position.set(0, 0.033, 0); // the KayKit 1H_Sword's frame (public/styles.js inHand)
  obj.userData.look = 1;
  if (w.turn) obj.rotateY(w.turn);
  R.add(obj); rig.objs.push(obj);
  rig.weapon = w;
}
// The look's weapon replaces whatever the class and style hold: everything else in the hand goes to the hidden layer.
function hideHands(rig) {
  const slots = [rig.bone('handslotr'), rig.weapon.offhand === 'hide' ? rig.bone('handslotl') : null];
  for (const s of slots) for (const c of s?.children || []) if (!c.isBone && !c.userData.look) c.traverse(o => { o.layers.set(HIDDEN); rig.hid.add(o); });
}

// ---------- the aura: ground glow, motes, trail (world-space sprites next to the entity's model) ----------
function addAura(rig, a, e) {
  const grp = e.model.group;
  if (a.ground) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(a.ground.r, 24), new THREE.MeshBasicMaterial({ map: glowTexture(), color: a.color, transparent: true, opacity: a.ground.opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    d.rotation.x = -Math.PI / 2; d.position.y = 0.07; d.renderOrder = 1;
    grp.add(d); rig.objs.push(d);
    rig.tick.push(t => { d.material.opacity = a.ground.opacity * (0.85 + Math.sin(t * 1.3) * 0.15); });
  }
  if (!a.motes && !a.trail) return;
  const fx = new THREE.Group(); rig.fx = fx;
  const mat = haze(a.color, 0.9), pool = [], live = [];
  const spawn = (x, y, z, size, life, vy, drift) => {
    const s = pool.pop() || new THREE.Sprite(mat);
    s.position.set(x, y, z); fx.add(s);
    live.push({ s, age: 0, life, size, vy, dx: (Math.random() - 0.5) * drift, dz: (Math.random() - 0.5) * drift });
  };
  const v = new THREE.Vector3();
  let accM = 0, accT = 0;
  rig.tick.push((t, mv, dt) => {
    if (fx.parent !== grp.parent) grp.parent ? grp.parent.add(fx) : fx.removeFromParent();
    const on = grp.visible && !e.dead;
    if (rig.light) rig.light.getWorldPosition(v); else v.set(grp.position.x, grp.position.y + e.model.height * 0.55, grp.position.z);
    if (on && a.motes) for (accM += dt * a.motes.rate; accM >= 1; accM--) spawn(v.x + (Math.random() - 0.5) * 0.15, v.y, v.z + (Math.random() - 0.5) * 0.15, a.motes.size, a.motes.life, a.motes.rise, 0.25);
    if (on && a.trail && mv > 0.25) for (accT += dt * a.trail.rate * mv; accT >= 1; accT--) spawn(v.x, v.y - 0.1, v.z, a.trail.size, a.trail.life, 0.08, 0.1);
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i]; p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { fx.remove(p.s); pool.push(p.s); live.splice(i, 1); continue; }
      p.s.position.x += p.dx * dt; p.s.position.z += p.dz * dt; p.s.position.y += p.vy * dt;
      p.s.scale.setScalar(p.size * 2.2 * Math.sin(Math.PI * Math.min(1, 0.15 + k * 0.85)));
    }
  });
}

export function initLooks({ players, mobs }) {
  const css = document.createElement('style'); css.textContent = CSS; document.head.appendChild(css);
  const rigs = new Map(); // entity -> rig
  let worn = new Map(); // entity id -> look id (the latest snapshot)

  function clear(e) {
    const rig = rigs.get(e);
    if (!rig) return;
    rigs.delete(e);
    for (const o of rig.objs) { o.removeFromParent(); o.traverse(n => { n.geometry?.dispose(); n.material?.dispose(); }); }
    rig.fx?.removeFromParent(); rig.fx?.traverse(n => n.material?.dispose());
    for (const o of rig.hid) o.layers.set(0);
    for (const [m, map, color] of rig.skin) { m.map = map; m.color.setHex(color); m.needsUpdate = true; }
    if (rig.scaled) { e.model.root.scale.divideScalar(rig.scaled); e.model.height /= rig.scaled; if (e.model.cursor) e.model.cursor.position.y = e.model.height + 0.35; }
    if (e.mats) for (const m of rig.cloth) { const i = e.mats.indexOf(m); if (i >= 0) e.mats.splice(i, 1); }
    e.look = null;
  }

  function apply(e, id) {
    clear(e);
    const look = lookOf(id);
    if (!look) return;
    const root = e.model.root || null; // (block models have no rig: aura and nameplate only)
    const rig = { look, objs: [], hid: new Set(), skin: [], cloth: [], tick: [], t: Math.random() * 10, mv: 0, px: e.model.group.position.x, pz: e.model.group.position.z, style: e.style, bone: n => root?.getObjectByName(n) || null };
    rigs.set(e, rig); e.look = id;
    if (root) {
      if (look.scale) { root.scale.multiplyScalar(look.scale); e.model.height *= look.scale; rig.scaled = look.scale; if (e.model.cursor) e.model.cursor.position.y = e.model.height + 0.35; }
      for (const end of look.hide || []) root.traverse(o => { if (o.isMesh && o.name.endsWith(end)) { o.layers.set(HIDDEN); rig.hid.add(o); } });
      if (look.tint) for (const m of e.model.mats || []) {
        if (look.tint.ramp && m.map) { const tex = remap(m.map, look); if (tex) { rig.skin.push([m, m.map, m.color.getHex()]); m.map = tex; m.color.setHex(0xffffff); m.needsUpdate = true; } }
        else if (look.tint.color !== undefined) { rig.skin.push([m, m.map, m.color.getHex()]); m.color.multiply(new THREE.Color(look.tint.color)); }
      }
      if (look.hair?.kind === 'hood') addHood(rig, look.hair);
      if (look.cloak?.kind === 'coat') addCoat(rig, look.cloak);
      if (look.cloak?.kind === 'cape') addCape(rig, look.cloak);
      if (look.weapon) { addWeapon(rig, look.weapon); if (rig.weapon) hideHands(rig); }
      if (e.mats) e.mats.push(...rig.cloth); // the cloth flashes with the body on a hit
    }
    if (look.aura) addAura(rig, look.aura, e);
  }

  // A snapshot's w.looks ([[entityId, lookId], ...], absent when nobody wears one). Call after the entities are in step.
  function snap(list) {
    worn = new Map(list || []);
    for (const [e] of rigs) if ((e.kind === 'mob' ? mobs : players).get(e.id) !== e) { const fx = rigs.get(e).fx; fx?.removeFromParent(); fx?.traverse(n => n.material?.dispose()); rigs.delete(e); } // gone (main.js disposed its model)
    if (!worn.size && !rigs.size) return;
    for (const map of [players, mobs]) for (const [id, e] of map) {
      const want = worn.get(id) || null;
      if ((e.look || null) !== want) apply(e, want);
      const rig = want && rigs.get(e);
      if (rig?.weapon && rig.style !== e.style) { rig.style = e.style; hideHands(rig); } // a new weapon style brought its own model
    }
  }

  // Per entity per frame (main.js animateEntity).
  function frame(e, dt) {
    const rig = rigs.get(e);
    if (!rig) return;
    const p = e.model.group.position, sp = dt > 0 ? Math.hypot(p.x - rig.px, p.z - rig.pz) / dt : 0;
    rig.px = p.x; rig.pz = p.z;
    rig.mv += (Math.min(1, sp / 6) - rig.mv) * Math.min(1, dt * 6); // 0 standing .. 1 running
    rig.t += dt;
    for (const f of rig.tick) f(rig.t, rig.mv, dt);
  }

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // The nameplate: nameHtml as it is without a look; with one, in the look's colour with its glyph, and its title beneath.
  function plate(e, nameHtml) {
    const pl = e.look && lookOf(e.look)?.plate;
    if (!pl) return nameHtml;
    return `<span class="lk" style="color:${pl.color || '#fff'};text-shadow:0 0 7px ${pl.glow || '#000'},0 1px 2px #000">${pl.glyph ? `${esc(pl.glyph)} ` : ''}${nameHtml}</span>${pl.title ? `<span class="lk-t" style="color:${pl.color || '#fff'}">${esc(pl.title)}</span>` : ''}`;
  }
  // A round badge for UI lists: by look id (the Friends tab knows it from shared/named.js) or by entity id (who wears one now).
  function swatch(look, px = 16) {
    const l = lookOf(typeof look === 'number' ? worn.get(look) : look), s = l?.swatch;
    if (!s) return '';
    const polys = EMBLEMS[l.emblem] || [];
    const d = polys.map(p => `M${p.map(([x, y]) => `${(50 + x * 30).toFixed(1)} ${(50 - y * 30).toFixed(1)}`).join('L')}Z`).join('');
    return `<svg class="lk-sw" width="${px}" height="${px}" viewBox="0 0 100 100" aria-label="${esc(l.name || l.id)}"><title>${esc(l.name || l.id)}</title><circle cx="50" cy="50" r="50" fill="${hex(s.bg)}"/><circle cx="50" cy="50" r="43" fill="none" stroke="${hex(s.accent ?? s.fg)}" stroke-width="7"/><path d="${d}" fill="${hex(s.fg)}"/></svg>`;
  }

  return { snap, frame, plate, swatch, of: id => worn.get(id) || null, clear };
}
