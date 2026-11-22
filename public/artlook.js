// Art styles: how characters are shaded and proportioned (CHARS) and how Floor 1's scenery is built and lit (ENVS).
// Unlike the effects styles (public/fxlook.js) these are fixed when the page loads: they pick materials and geometry.
// Pick with ?char=<id>&env=<id>, or Settings → Graphics (applies after a reload). `classic` is what main draws.
//
// CHARS (every rigged character: players, bots, the Named, the three bosses):
//   toon: 0 = the smooth standard shading; 2-4 = cel shading with that many light bands
//   outline: a dark line round the silhouette, as a fraction of the character's height (0 = none). It draws every
//            part of the character a second time (back faces, pushed outward), so it roughly doubles a character's
//            draw calls: the one part of a style with a real cost.
//   rim: a light edge where the surface turns away from the camera (0 = none) · rimColor
//   head / legs / arms / body: proportions, applied after the animation pose (head 0.8 is main's; legs > 1 = longer)
//   sat: texture colour strength (1 = as painted)
// ENVS (Floor 1 only; Floors 2 and 3 keep their own scenery and light):
//   toon: as above, for the ground, buildings, trees and rocks · smooth: round off the faceted low-poly shading
//   trees: 'cone' (main) | 'layered' (three stacked tiers) | 'round' (leafy blobs) · leaf: [hue, sat, light] base
//   sky: null (flat colour) or { top, horizon, sun } for a gradient dome with a sun glow · clouds: how many
//   tufts / flowers: instanced grass tufts and flowers on the field (one draw call each) · patches: ground colour variety
//   atmos: Floor 1's sky colour, fog distance, sky light, sun colour and strength (floor2world.js ATMOS[0])
import * as THREE from 'three';

export const CHARS = {
  classic: { name: 'Classic', note: 'What is live now: smooth shading, big heads.', toon: 0, outline: 0, rim: 0, rimColor: 0xffffff, head: 0.8, legs: 1, arms: 1, body: 1, sat: 1 },
  cel: { name: 'Storybook Cel', note: 'Cel shading with a dark outline: reads like a cartoon, same chunky bodies.', toon: 3, outline: 0.011, rim: 0, rimColor: 0xffffff, head: 0.8, legs: 1, arms: 1, body: 1, sat: 1.08 },
  hero: { name: 'Sword Hero', note: 'Taller and slimmer: smaller heads, longer legs, cel shading, a thin outline and a light rim.', toon: 3, outline: 0.007, rim: 0.3, rimColor: 0xcfe8ff, head: 0.64, legs: 1.36, arms: 1.12, body: 0.9, sat: 1.05 },
  soft: { name: 'Soft Clay', note: 'No outline: smooth shading with a warm rim light, slightly smaller heads.', toon: 0, outline: 0, rim: 0.38, rimColor: 0xffe2b8, head: 0.72, legs: 1.12, arms: 1, body: 1, sat: 1.12 },
  ink: { name: 'Bold Ink', note: 'Two flat light bands and a heavy outline: the comic-book end of the range.', toon: 2, outline: 0.018, rim: 0, rimColor: 0xffffff, head: 0.76, legs: 1.1, arms: 1, body: 1, sat: 1.2 },
};
const CLASSIC_ATMOS = { sky: 0x9cc9ee, near: 70, far: 230, hemiSky: 0xdbeaff, hemiGround: 0x3b5d2a, hemi: 1.1, sun: 0xfff1d6, sunI: 1.9 };
export const ENVS = {
  classic: { name: 'Classic', note: 'What is live now: flat sky, cone trees, plain grass.', toon: 0, smooth: false, trees: 'cone', leaf: [0.3, 0.45, 0.25], sky: null, clouds: 0, tufts: 0, flowers: 0, patches: 0, ground: 0x5f9a45, atmos: CLASSIC_ATMOS },
  meadow: { name: 'Painted Meadow', note: 'Blue-to-haze sky with clouds, round leafy trees, grass tufts and flowers, softer light.', toon: 0, smooth: true, trees: 'round', leaf: [0.27, 0.5, 0.32], sky: { top: 0x3f86d8, horizon: 0xcfe9f7, sun: 0xfff3c9 }, clouds: 38, tufts: 5200, flowers: 700, patches: 0.5, ground: 0x6aa84a,
    atmos: { sky: 0xcfe9f7, near: 80, far: 250, hemiSky: 0xe4f1ff, hemiGround: 0x4d6f33, hemi: 1.2, sun: 0xfff0cf, sunI: 1.8 } },
  alpine: { name: 'Crisp Alpine', note: 'Deep cool sky, tiered pines, cel-shaded ground and buildings, sharper sun.', toon: 3, smooth: false, trees: 'layered', leaf: [0.38, 0.42, 0.24], sky: { top: 0x2467c9, horizon: 0xb9dcf5, sun: 0xffffff }, clouds: 22, tufts: 3600, flowers: 250, patches: 0.35, ground: 0x4f9550,
    atmos: { sky: 0xb9dcf5, near: 85, far: 260, hemiSky: 0xd5e8ff, hemiGround: 0x2f5a3a, hemi: 1.0, sun: 0xffffff, sunI: 2.2 } },
  dusk: { name: 'Amber Dusk', note: 'Low evening sun: orange horizon, long warm light, dark tiered pines.', toon: 0, smooth: false, trees: 'layered', leaf: [0.31, 0.4, 0.19], sky: { top: 0x3b4f9e, horizon: 0xffb877, sun: 0xffd9a0 }, clouds: 26, tufts: 4200, flowers: 300, patches: 0.4, ground: 0x6a8f3f,
    atmos: { sky: 0xf2b98a, near: 60, far: 230, hemiSky: 0xffd9b8, hemiGround: 0x3a3f2a, hemi: 0.95, sun: 0xffb26b, sunI: 2.1 } },
};
export const CHAR_IDS = Object.keys(CHARS), ENV_IDS = Object.keys(ENVS);

/** The live style (set once by main.js before the world is built). */
export const ART = { charId: 'classic', envId: 'classic', char: CHARS.classic, env: ENVS.classic };
export function setArt(charId, envId) {
  ART.charId = CHARS[charId] ? charId : 'classic'; ART.envId = ENVS[envId] ? envId : 'classic';
  ART.char = CHARS[ART.charId]; ART.env = ENVS[ART.envId];
  return ART;
}

// ---------- shading ----------
const ramps = new Map();
function ramp(n) { // n flat light bands, darkest first (the shadow band stays well above black so colours hold)
  let t = ramps.get(n);
  if (!t) {
    const d = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const v = Math.round(255 * (0.5 + 0.5 * (i / (n - 1)))); d.set([v, v, v, 255], i * 4); }
    t = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
    ramps.set(n, t);
  }
  return t;
}
function addRim(m, strength, color) {
  const c = new THREE.Color(color).multiplyScalar(strength);
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = { value: c };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <opaque_fragment>', 'outgoingLight += uRim * pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => `rim${c.getHexString()}`;
}
/** A scenery material in the world style (world.js mat()). */
export function envMaterial(color, opts = {}) {
  const E = ART.env;
  if (E.toon) { const { roughness, metalness, flatShading, ...rest } = opts; return new THREE.MeshToonMaterial({ color, gradientMap: ramp(E.toon), ...rest }); }
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: !E.smooth, ...opts });
}
/** A rigged character's material in the character style (from the model's own, already cloned). */
export function charMaterial(src) {
  const C = ART.char;
  let m = src;
  if (C.toon) {
    m = new THREE.MeshToonMaterial({ color: src.color, map: src.map, gradientMap: ramp(C.toon), transparent: src.transparent, opacity: src.opacity, side: src.side, alphaTest: src.alphaTest });
    m.name = src.name;
  }
  if (C.sat !== 1) m.color.multiplyScalar(C.sat);
  if (C.rim) addRim(m, C.rim, C.rimColor);
  return m;
}

// ---------- outlines: every mesh of a rig drawn again, back faces only, pushed out along its normals ----------
let lineSkin = null, lineStatic = null;
function lineMat(thick) {
  const m = new THREE.MeshBasicMaterial({ color: 0x14100f, side: THREE.BackSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uThick = { value: thick };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uThick;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uThick;');
  };
  m.customProgramCacheKey = () => `line${thick}`;
  return m;
}
/** Add the outline to a finished rig (root: the cloned model; unit: the model's height in its own units). */
export function outlineRig(root, unit) {
  const t = ART.char.outline * unit;
  if (!(t > 0)) return 0;
  lineSkin ||= lineMat(t); lineStatic ||= lineMat(t);
  const list = [];
  root.traverse(o => { if (o.isMesh && !o.userData.outline && o.geometry?.attributes.normal) list.push(o); });
  for (const o of list) {
    const l = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, lineSkin) : new THREE.Mesh(o.geometry, lineStatic);
    if (o.isSkinnedMesh) l.bind(o.skeleton, o.bindMatrix);
    l.userData.outline = true; l.frustumCulled = false; l.name = 'outline';
    o.add(l); // (a child: hidden whenever its part is)
  }
  return list.length;
}

// ---------- proportions: applied after the animation pose, every frame the animator runs ----------
const LEG = 0.45; // the rig's leg length (its own units): the hips rise by what the legs gain
export function bonesOf(root) {
  const C = ART.char;
  if (C.legs === 1 && C.arms === 1 && C.body === 1) return null;
  const g = n => root.getObjectByName(n);
  return { hips: g('hips'), legs: [g('upperlegl'), g('upperlegr')].filter(Boolean), arms: [g('upperarml'), g('upperarmr')].filter(Boolean), chest: g('chest') };
}
export function applyProportions(b) {
  if (!b) return;
  const C = ART.char;
  for (const l of b.legs) l.scale.multiplyScalar(C.legs);
  for (const a of b.arms) a.scale.multiplyScalar(C.arms);
  if (b.hips) { b.hips.position.y += LEG * (C.legs - 1); if (C.body !== 1) { b.hips.scale.x *= C.body; b.hips.scale.z *= C.body; } }
}
/** How much taller the style makes a rig, roughly (longer legs raise the hips; the rig is 1.62 units tall). */
export const heightFactor = () => 1 + LEG * (ART.char.legs - 1) / 1.62;

// ---------- scenery pieces ----------
function merge(parts) { // a few indexed geometries into one (positions + normals only)
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const g of parts) {
    const p = g.attributes.position, n = g.attributes.normal, ix = g.index;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i)); else for (let i = 0; i < p.count; i++) idx.push(base + i);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(idx);
  return out;
}
/** The crown of a tree (centred like main's cone: 3.6 tall about y = 0). */
export function leafGeometry() {
  const kind = ART.env.trees;
  if (kind === 'layered') {
    const tier = (r, h, y) => new THREE.ConeGeometry(r, h, 8).translate(0, y, 0);
    return merge([tier(1.75, 1.9, -0.95), tier(1.35, 1.7, 0.15), tier(0.9, 1.6, 1.15)]);
  }
  if (kind === 'round') {
    const blob = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
    return merge([blob(1.45, 0, -0.5, 0), blob(1.05, 0.75, 0.25, 0.3), blob(1.0, -0.7, 0.35, -0.35), blob(0.95, 0.05, 1.0, 0.1)]);
  }
  return new THREE.ConeGeometry(1.6, 3.6, 7);
}
const SKY_V = 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_F = `
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunDir; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHor, uTop, pow(h, 0.55));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSun * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.28);
  gl_FragColor = vec4(c, 1.0);
}`;
/** Sky dome, clouds, grass tufts, flowers and ground colour patches for Floor 1 (nothing for Classic). `clear(x, z)`
 *  says whether a spot is open ground. Returns { group, update(dt) }. */
export function buildScenery({ sunPos, rand, clear }) {
  const E = ART.env, g = new THREE.Group();
  let clouds = null;
  if (E.sky) {
    const m = new THREE.ShaderMaterial({ vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color(E.sky.top) }, uHor: { value: new THREE.Color(E.sky.horizon) }, uSun: { value: new THREE.Color(E.sky.sun) }, uSunDir: { value: sunPos.clone().normalize() } } });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(520, 24, 12), m); dome.position.set(0, -20, 80); dome.renderOrder = -10; dome.frustumCulled = false;
    g.add(dome);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), col = new THREE.Color();
  if (E.clouds) {
    const puff = merge([new THREE.IcosahedronGeometry(1, 1), new THREE.IcosahedronGeometry(0.75, 1).translate(1.1, -0.1, 0.2), new THREE.IcosahedronGeometry(0.65, 1).translate(-1.05, -0.15, -0.1)]);
    clouds = new THREE.InstancedMesh(puff, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92 }), E.clouds);
    const tint = new THREE.Color(E.sky?.horizon ?? 0xffffff).lerp(new THREE.Color(0xffffff), 0.7);
    clouds.material.color.copy(tint);
    for (let i = 0; i < E.clouds; i++) {
      const a = rand() * Math.PI * 2, d = 150 + rand() * 260, w = 16 + rand() * 26;
      m4.compose(p.set(Math.sin(a) * d, 70 + rand() * 60, 80 + Math.cos(a) * d), q.setFromEuler(e.set(0, rand() * 6.28, 0)), s.set(w, w * 0.22, w * 0.55));
      clouds.setMatrixAt(i, m4);
    }
    clouds.frustumCulled = false; g.add(clouds);
  }
  const scatter = (n, geo, material, size, tintFn) => {
    const im = new THREE.InstancedMesh(geo, material, n);
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const x = -74 + rand() * 148, z = -36 + rand() * 196;
      if (!clear(x, z)) continue;
      const sc = size * (0.7 + rand() * 0.7);
      m4.compose(p.set(x, 0, z), q.setFromEuler(e.set(0, rand() * 6.28, 0)), s.set(sc, sc * (0.8 + rand() * 0.6), sc));
      im.setMatrixAt(k, m4); im.setColorAt(k, tintFn(col)); k++;
    }
    im.count = k; im.receiveShadow = true; im.frustumCulled = false; g.add(im);
    return im;
  };
  if (E.tufts) {
    const blade = (rz, ry) => { const b = new THREE.ConeGeometry(0.07, 0.5, 3).translate(0, 0.25, 0); b.rotateZ(rz); b.rotateY(ry); return b; };
    const base = new THREE.Color(E.ground);
    scatter(E.tufts, merge([blade(0.25, 0), blade(-0.3, 2.1), blade(0.12, 4.2), blade(-0.1, 1.0)]), envMaterial(0xffffff), 1, c => c.copy(base).offsetHSL((rand() - 0.5) * 0.04, 0.05, 0.03 + rand() * 0.1));
  }
  if (E.flowers) {
    const hues = [0xfff3a6, 0xffffff, 0xf9a8d4, 0xc4b5fd, 0xfda4af];
    scatter(E.flowers, new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.3, 0), envMaterial(0xffffff), 1, c => c.setHex(hues[(rand() * hues.length) | 0]));
  }
  if (E.patches) { // soft darker and lighter blotches on the grass: big flat discs just above the ground
    const base = new THREE.Color(E.ground);
    const im = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 * E.patches * 2, depthWrite: false }), 90);
    for (let i = 0; i < 90; i++) {
      const r = 4 + rand() * 9;
      m4.compose(p.set(-74 + rand() * 148, 0.012, -36 + rand() * 196), q.identity(), s.set(r * (0.7 + rand() * 0.8), 1, r));
      im.setMatrixAt(i, m4); im.setColorAt(i, col.copy(base).offsetHSL((rand() - 0.5) * 0.05, 0, (rand() - 0.5) * 0.16));
    }
    im.frustumCulled = false; im.renderOrder = -1; g.add(im);
  }
  return { group: g, update(dt) { if (clouds) clouds.rotation.y += dt * 0.004; } };
}
