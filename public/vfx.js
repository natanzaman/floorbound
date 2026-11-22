// The visuals pass (docs/briefs/combos-visuals.md, section F): everything here is drawn on top of what the feature
// modules already show, and is built to add almost nothing to the frame:
//  - 3D skill effects from five instanced batches (shock bands, crescent blades, domes, lances, rock shards): one draw
//    call per batch however many effects are alive, fixed buffers, nothing allocated per frame.
//  - Weapon trails: every ribbon lives in one mesh (one draw call), following the weapon in a character's hand while a
//    melee clip swings it; coloured by class, brighter and wider as that player's skill chain rises.
//  - Heavier hits: impact flashes and directional sparks on finishers, crits, combos and Breaks (public/sparks.js).
//  - Skill accents (world.js ACCENTS): which skill leans, lunges, rears or slams.
//  - Camera kick: a small FOV punch and shake on YOUR finishers, chain x3+, combos you're in and Team Bursts.
//  - The Combos 2.0 events: the chain counter by your character, a flourish per combo, a look per Team Burst trait,
//    bots' call-outs as bubbles.
// Low (Q.fx3d false, Q.trails 0) gets none of it: the flat rings and arcs as before. Reduce motion: no camera kick.
// main.js wiring: event(e) first in handleEvent (it only consumes chain / chainEnd / tcall), hit(m, e, dx, dz) from
// hitJuice, frame(dt, vdt) after the characters are animated, applyKick(camera) after the camera is placed, warm(on).
import * as THREE from 'three';
import { Q } from '/quality.js';
import { GLOW_BLEND, glowMaterial, applyGlowLook } from '/post.js';
import { paletteMode } from '/palette.js';
import { FXL } from '/fxlook.js';

// A colour per class for trails and skill effects. The colour-blind palettes move the danger colours (palette.js), so the
// classes that would sit too close to them there move away (danger is amber under 'deuter', pink under 'trit').
const CLASS_COL = {
  off: { swordsman: 0x55b4ff, guardian: 0xffbe45, cleric: 0xffe58a, ranger: 0x2fe0c4, berserker: 0xff4a26, lancer: 0x3fd2ff, bard: 0xdb5cff },
  deuter: { guardian: 0xbcd7ff, berserker: 0xd9a8ff, cleric: 0xffffff },
  trit: { bard: 0xa5f3fc, berserker: 0xff8a3d },
};
// Gold (finishers, Breaks, completed chains) sits next to the red-green palette's amber danger colour: pale ice instead.
const gold = () => { // (... as the look draws it: fx.gold / fx.goldMix)
  if (paletteMode() === 'deuter') return 0xcfeaff;
  if (goldRev !== FXL.rev) { goldRev = FXL.rev; goldHex = FXL.fx.goldMix ? _lc.set(GOLD_).lerp(_lt.set(FXL.fx.gold), FXL.fx.goldMix).getHex() : GOLD_; }
  return goldHex;
};
let goldRev = -1, goldHex = 0xffd76a;
const baseColor = cls => CLASS_COL[paletteMode()]?.[cls] ?? CLASS_COL.off[cls] ?? 0xdbeafe;
// ... as the look draws it (public/fxlook.js fx.tint / fx.vivid): worked out once per look, palette and class.
const _lc = new THREE.Color(), _lt = new THREE.Color(), lookCols = new Map();
let lookRev = -1;
export function classColor(cls) {
  if (lookRev !== FXL.rev) { lookCols.clear(); lookRev = FXL.rev; }
  const key = paletteMode() + cls;
  let v = lookCols.get(key);
  if (v === undefined) {
    const K = FXL.fx; _lc.set(baseColor(cls));
    if (K.vivid) _lc.offsetHSL(0, K.vivid, 0);
    if (K.tintMix) _lc.lerp(_lt.set(K.tint), K.tintMix);
    lookCols.set(key, v = _lc.getHex());
  }
  return v;
}
const WHITE = 0xffffff, GOLD_ = 0xffd76a;
// How far along the hand slot's +Y the weapon reaches (rig units), for the trail's outer edge.
const REACH = { swordsman: 1.7, guardian: 1.7, cleric: 2.0, ranger: 1.3, berserker: 2.3, lancer: 3.1, bard: 1.4 };

// ---------- the glow shader (bands, blades, domes, lances, trails) ----------
const VERT = `
attribute vec4 iColor; varying vec4 vC; varying vec2 vUv; varying float vRim;
void main() {
  vUv = uv; vC = iColor; vRim = 0.0;
  #ifdef USE_INSTANCING
    mat4 mvm = modelViewMatrix * instanceMatrix;
  #else
    mat4 mvm = modelViewMatrix;
  #endif
  vec4 mv = mvm * vec4(position, 1.0);
  #if SHAPE == 2
    vRim = 1.0 - abs(dot(normalize(mat3(mvm) * normal), normalize(-mv.xyz)));
  #endif
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vC; varying vec2 vUv; varying float vRim; uniform vec4 uTr; uniform float uWhite; uniform float uSolid; // (the look: trail cross-section, hot cores)
void main() {
  float a;
  #if SHAPE == 0
    a = pow(1.0 - vUv.y, 1.7) * 0.85 + 0.6 * smoothstep(0.1, 0.0, vUv.y);
  #elif SHAPE == 1
    float e = sin(3.14159 * vUv.x);
    a = (pow(vUv.y, 2.6) + 0.7 * smoothstep(0.82, 1.0, vUv.y)) * smoothstep(0.0, 0.3, e);
  #elif SHAPE == 2
    a = pow(vRim, 2.2) * 0.9 + 0.07 + 0.55 * smoothstep(0.07, 0.0, vUv.y);
  #elif SHAPE == 3
    a = pow(vUv.y, 1.5);
  #else
    a = mix(uTr.x, 1.0, pow(vUv.y, uTr.y)) + uTr.z * smoothstep(0.84, 0.98, vUv.y);
  #endif
  a = clamp(a * vC.a, 0.0, 1.0);
  #if SHAPE == 4
    gl_FragColor = vec4(mix(vC.rgb, vec3(1.0), a * a * uTr.w) * a, a * 0.8 * uSolid);
  #else
    gl_FragColor = vec4(mix(vC.rgb, vec3(1.0), a * a * uWhite) * a, a * uSolid);
  #endif
}`;
const GLOW_U = { uTr: { value: new THREE.Vector4(0.22, 2, 0, 0.3) }, uWhite: { value: 0.55 } }; // shared by every glow material
const glowMat = shape => glowMaterial(new THREE.ShaderMaterial({ defines: { SHAPE: shape }, uniforms: { ...GLOW_U }, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, ...GLOW_BLEND }));

// A crescent blade lying flat (XZ), its middle towards +Z: outer radius 1, widest in the middle, tapering to the ends.
function crescentGeo(span = 2.5, seg = 20, width = 0.42) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = (u - 0.5) * span, inner = 1 - width * Math.sin(Math.PI * u);
    pos.push(Math.sin(a) * inner, 0, Math.cos(a) * inner, Math.sin(a), 0, Math.cos(a));
    uv.push(u, 0, u, 1);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _c = new THREE.Color();
const _white = new THREE.Color(0xffffff);
const rnd = (a, b) => a + Math.random() * (b - a);

// One instanced batch: a fixed pool of effect records, drawn in one call. A record animates on its own:
//  position (x, y, z) + velocity (and gravity), or an offset from a followed object (fol);
//  scale from (sx, sy, sz) to (ex, ey, ez), eased out; pop: the height rises fast then sinks back (rock shards);
//  rotation (rx, ry, rz, 'YXZ') with a spin about y; colour and strength `a`, fading in over `fi` and out by power `fo`.
class Batch {
  constructor(scene, geo, material, cap, lit = false) {
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.renderOrder = 4;
    this.lit = lit; this.cap = cap; this.n = 0;
    if (lit) { this.mesh.setColorAt(0, _c.set(WHITE)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    else { this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iColor', this.col); }
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = Array.from({ length: cap }, () => ({}));
    scene.add(this.mesh);
  }
  // o: the record's fields (see above); anything left out takes its default.
  add(o) {
    if (this.n >= this.cap) return null; // (full: the effect is skipped, never queued)
    const r = this.items[this.n++];
    r.t = 0; r.life = o.life ?? 0.4; r.delay = o.delay || 0;
    r.x = o.x || 0; r.y = o.y || 0; r.z = o.z || 0; r.vx = o.vx || 0; r.vy = o.vy || 0; r.vz = o.vz || 0; r.grav = o.grav || 0; r.fol = o.fol || null;
    r.sx = o.sx ?? 1; r.sy = o.sy ?? r.sx; r.sz = o.sz ?? r.sx; r.ex = o.ex ?? r.sx; r.ey = o.ey ?? r.sy; r.ez = o.ez ?? (o.ex ?? r.sz);
    r.rx = o.rx || 0; r.ry = o.ry || 0; r.rz = o.rz || 0; r.spin = o.spin || 0; r.pop = o.pop || 0;
    _c.set(o.col ?? WHITE); r.r = _c.r; r.g = _c.g; r.b = _c.b; r.a = (o.a ?? 1) * FXL.fx.a; r.fi = o.fi ?? 0.12; r.fo = o.fo ?? 1.6;
    return r;
  }
  update(dt) {
    if (!this.n) { if (this.mesh.visible) { this.mesh.visible = false; this.mesh.count = 0; } return; }
    const L = this.items, M = this.mesh.instanceMatrix.array, C = this.lit ? this.mesh.instanceColor.array : this.col.array;
    let d = 0;
    for (let i = 0; i < this.n; i++) {
      const r = L[i];
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { L[i] = L[--this.n]; L[this.n] = r; r.fol = null; i--; continue; }
      if (!r.fol) { r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt; r.vy -= r.grav * dt; }
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      let sy = r.sy + (r.ey - r.sy) * e;
      if (r.pop) sy *= k < 0.14 ? k / 0.14 : 1 - ((k - 0.14) / 0.86) ** 2.2;
      _s.set(r.sx + (r.ex - r.sx) * e, Math.max(1e-4, sy), r.sz + (r.ez - r.sz) * e);
      if (r.fol) _p.set(r.fol.position.x + r.x, r.fol.position.y + r.y, r.fol.position.z + r.z); else _p.set(r.x, r.y, r.z);
      _q.setFromEuler(_e.set(r.rx, r.ry + r.spin * r.t, r.rz, 'YXZ'));
      _m.compose(_p, _q, _s).toArray(M, d * 16);
      if (this.lit) { C[d * 3] = r.r; C[d * 3 + 1] = r.g; C[d * 3 + 2] = r.b; }
      else { C[d * 4] = r.r; C[d * 4 + 1] = r.g; C[d * 4 + 2] = r.b; C[d * 4 + 3] = r.a * Math.min(1, k / r.fi) * (1 - k) ** r.fo; }
      d++;
    }
    this.mesh.count = d; this.mesh.visible = d > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.lit ? this.mesh.instanceColor : this.col).needsUpdate = true;
  }
}

// ---------- weapon trails: every ribbon in one mesh ----------
const T_PTS = 32, T_REC = 7; // points per ribbon, seconds a point lives, floats per sample (base xyz, tip xyz, age)
class Trails {
  constructor(scene, cap) {
    this.cap = cap;
    const verts = cap * T_PTS * 2, g = this.geo = new THREE.BufferGeometry(), uv = new Float32Array(verts * 2), idx = [];
    this.pos = new Float32Array(verts * 3); this.col = new Float32Array(verts * 4);
    for (let s = 0; s < cap; s++) for (let i = 0; i < T_PTS; i++) {
      const v = (s * T_PTS + i) * 2;
      uv[v * 2] = i / (T_PTS - 1); uv[v * 2 + 1] = 0; uv[v * 2 + 2] = i / (T_PTS - 1); uv[v * 2 + 3] = 1;
      if (i < T_PTS - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, glowMat(4)); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.slots = Array.from({ length: cap }, () => ({ ent: null, n: 0, h: new Float32Array(T_PTS * T_REC), r: 1, g: 1, b: 1, tr: 1, tg: 1, tb: 1, gain: 1, lx: 0, ly: 0, lz: 0, ex: 0, ez: 0, has: false }));
    this.live = 0;
  }
  slotFor(ent, max) {
    let free = null;
    for (let i = 0; i < Math.min(max, this.cap); i++) { const s = this.slots[i]; if (s.ent === ent) return s; if (!s.ent && !s.n && !free) free = s; }
    if (free) { free.ent = ent; free.has = false; }
    return free;
  }
  ins(s, bx, by, bz, tx, ty, tz, age) { // newest first
    const h = s.h; h.copyWithin(T_REC, 0, (T_PTS - 1) * T_REC);
    h[0] = bx; h[1] = by; h[2] = bz; h[3] = tx; h[4] = ty; h[5] = tz; h[6] = age;
    if (s.n < T_PTS) s.n++;
  }
  // A new weapon position for this slot's character (cx, cz: where the character stands). Between two frames the
  // weapon swings round the body, so the gap is filled along that arc (angle, reach and height each blended), not
  // with a straight chord: the ribbon stays round at any frame rate.
  push(s, bx, by, bz, tx, ty, tz, cx, cz, dt) {
    if (s.n) {
      const h = s.h, d = Math.hypot(tx - h[3], ty - h[4], tz - h[5]), steps = Math.min(5, Math.ceil(d / 0.28));
      if (steps > 1) {
        const pbx = h[0], pby = h[1], pbz = h[2], ptx = h[3], pty = h[4], ptz = h[5];
        const a0 = Math.atan2(ptx - s.ex, ptz - s.ez), r0 = Math.hypot(ptx - s.ex, ptz - s.ez), a1 = Math.atan2(tx - cx, tz - cz), r1 = Math.hypot(tx - cx, tz - cz);
        const b0 = Math.atan2(pbx - s.ex, pbz - s.ez), q0 = Math.hypot(pbx - s.ex, pbz - s.ez), b1 = Math.atan2(bx - cx, bz - cz), q1 = Math.hypot(bx - cx, bz - cz);
        const da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), db = Math.atan2(Math.sin(b1 - b0), Math.cos(b1 - b0));
        for (let i = 1; i < steps; i++) {
          const u = i / steps, ox = s.ex + (cx - s.ex) * u, oz = s.ez + (cz - s.ez) * u, a = a0 + da * u, r = r0 + (r1 - r0) * u, b = b0 + db * u, q = q0 + (q1 - q0) * u;
          this.ins(s, ox + Math.sin(b) * q, pby + (by - pby) * u, oz + Math.cos(b) * q, ox + Math.sin(a) * r, pty + (ty - pty) * u, oz + Math.cos(a) * r, (1 - u) * dt);
        }
      }
    }
    this.ins(s, bx, by, bz, tx, ty, tz, 0);
    s.ex = cx; s.ez = cz;
  }
  update(dt, mine, mdt) { // (mine: your own character, whose clock isn't slowed by slow motion; mdt: its seconds)
    let any = false;
    const P = this.pos, C = this.col, vdt = dt, T_LIFE = FXL.trail.life;
    for (let si = 0; si < this.cap; si++) {
      const s = this.slots[si], h = s.h, v0 = si * T_PTS * 2;
      if (!s.n) { if (s.drawn) { s.drawn = false; for (let i = 0; i < T_PTS * 2; i++) C[(v0 + i) * 4 + 3] = 0; any = true; } continue; }
      let n = s.n;
      dt = s.ent === mine ? mdt : vdt;
      for (let i = 0; i < n; i++) { h[i * T_REC + 6] += dt; if (h[i * T_REC + 6] >= T_LIFE) { n = i; break; } }
      s.n = n; s.drawn = true; any = true;
      for (let i = 0; i < T_PTS; i++) {
        const k = Math.min(i, Math.max(0, n - 1)) * T_REC, v = v0 + i * 2, u = Math.min(1, h[k + 6] / T_LIFE), f = i < n ? (1 - u) ** 1.4 * s.gain : 0;
        const cr = s.r + (s.tr - s.r) * u, cg = s.g + (s.tg - s.g) * u, cb = s.b + (s.tb - s.b) * u; // head colour → tail colour
        P[v * 3] = h[k]; P[v * 3 + 1] = h[k + 1]; P[v * 3 + 2] = h[k + 2]; P[v * 3 + 3] = h[k + 3]; P[v * 3 + 4] = h[k + 4]; P[v * 3 + 5] = h[k + 5];
        C[v * 4] = C[v * 4 + 4] = cr; C[v * 4 + 1] = C[v * 4 + 5] = cg; C[v * 4 + 2] = C[v * 4 + 6] = cb; C[v * 4 + 3] = C[v * 4 + 7] = n > 1 ? f : 0;
      }
    }
    this.mesh.visible = any;
    if (any) this.geo.attributes.position.needsUpdate = this.geo.attributes.iColor.needsUpdate = true;
  }
}

const CSS = `
#chain-hud { position: absolute; left: 0; top: 0; pointer-events: none; white-space: nowrap; z-index: 5; font-weight: 900; letter-spacing: .08em;
  font-size: 15px; color: #e0f2fe; text-shadow: 0 0 10px var(--ch, #38bdf8), 0 2px 3px #000; opacity: 0; transition: opacity .25s; will-change: transform; }
#chain-hud.on { opacity: 1; }
#chain-hud b { font-size: 150%; color: #fff; margin: 0 2px; }
#chain-hud i { font-style: normal; font-weight: 700; letter-spacing: .03em; opacity: .92; }
#chain-hud.n3 { --ch: #fbbf24; color: #fef3c7; font-size: 17px; }
#chain-hud.n4 { --ch: #fb7185; color: #ffe4e6; font-size: 19px; }
#chain-hud.pop span { display: inline-block; animation: chainpop .22s ease-out; }
@keyframes chainpop { from { transform: scale(1.5); filter: brightness(1.8); } to { transform: scale(1); } }
.bubble.call { font-weight: 800; letter-spacing: .03em; border-color: rgba(125, 211, 252, .8); box-shadow: 0 0 12px rgba(56, 189, 248, .45); }
`;

// Which accent (world.js ACCENTS) a skill's fx event plays, and which 3D effect (FX below). Keys: the event's kind and
// skill: `arc:fin` (a basic finisher), `arc:burst` / `arc:burstfin` (Burst Combo), `ring:<skill>`, `ca:<v>`, `cb:<ev>`,
// `evo:<ev>`, `sty:fin`.
const SKILL = {
  'arc:fin': ['cut', 'cut'], 'arc:burst': ['cut', 'cut'], 'arc:burstfin': ['finisher', 'finisher'], 'sty:fin': ['cut', 'cut'],
  rush: ['lunge', 'dash'], 'ring:whirl': ['spin', 'whirl'], 'ring:gslam': ['slam', 'slam'], bolt: ['cast', 'smite'],
  'ca:cleave': ['cleave', 'cleave'], 'ca:whirl': ['spin', 'whirl'], 'ca:execute': ['finisher', 'finisher'], 'ca:leap': ['leap', 'takeoff'],
  'ca:slam': ['slam', 'slam'], 'ca:draw': ['draw', null], 'ca:loose': ['loose', 'pierce'], 'ca:pounce': ['lunge', 'dash'],
  'cb:thrust': ['thrust', 'thrust'], 'cb:charge': ['lunge', 'dash'], 'cb:comet': ['lunge', 'dash'], 'cb:hitrun': ['lunge', 'dash'],
  'cb:sweep': ['spin', 'whirl'], 'cb:cyclone': ['spin', 'whirl'], 'cb:hamstring': ['cleave', 'cleave'], 'cb:skymark': ['leap', 'skymark'],
  'cb:skyland': ['slam', 'skyland'], 'cb:meteorLand': ['slam', 'skyland'], 'cb:pinLand': ['slam', 'skyland'],
  'cb:dissonance': ['cast', 'waves'], 'cb:shatter': ['cast', 'waves'], 'cb:feedback': ['cast', 'whirl'],
  'evo:finisher': ['finisher', 'finisher'], 'evo:starburst': ['cut', 'cut'], 'evo:bladering': ['spin', 'whirl'], 'evo:vortex2': ['spin', 'whirl'],
};
function skillKey(e) {
  if (e.k === 'arc') return e.s === 'burst' ? (e.c === 'gold' ? 'arc:burstfin' : 'arc:burst') : e.fin ? 'arc:fin' : null;
  if (e.k === 'ring') return `ring:${e.s}`;
  if (e.k === 'ca') return `ca:${e.v}`;
  if (e.k === 'cb') return `cb:${e.ev}`;
  if (e.k === 'evo') return `evo:${e.ev}`;
  if (e.k === 'sty') return e.fin && e.r && !e.x2 ? 'sty:fin' : null;
  return e.k;
}
// A flourish per combo (shared/teamplay.js COMBOS ids); anything unknown gets the plain one.
const COMBO_FX = { crosscut: 'cross', execute: 'cross', aftershock: 'quake', verdict: 'judge', downbeat: 'beat', shatter: 'beat', skewer: 'spike', pin: 'spike' };

export function initVfx({ scene, state, players, mobs, fx, camera, project, bubbles, shake, calm, hud }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const me = () => state.myId;
  // ---------- batches ----------
  const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true); bandGeo.translate(0, 0.5, 0);
  const lanceGeo = new THREE.ConeGeometry(1, 1, 6, 1, true); lanceGeo.translate(0, 0.5, 0);
  const shardGeo = new THREE.ConeGeometry(1, 1, 5); shardGeo.translate(0, 0.5, 0);
  const bands = new Batch(scene, bandGeo, glowMat(0), 48);
  const blades = new Batch(scene, crescentGeo(), glowMat(1), 40);
  const domes = new Batch(scene, new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), glowMat(2), 8);
  const lances = new Batch(scene, lanceGeo, glowMat(3), 64);
  const shards = new Batch(scene, shardGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05, flatShading: true }), 64, true);
  const batches = [bands, blades, domes, lances, shards];
  const trails = new Trails(scene, 8);

  // ---------- building blocks ----------
  const HALF = Math.PI / 2;
  const shock = (x, z, r, col, o = {}) => bands.add({ x, y: 0.05, z, sx: r * 0.25, ex: r, ey: 0.35, life: 0.42, col, a: 0.7, ...o, sy: (o.h ?? 1.3) * FXL.fx.tall });
  const pillar = (x, z, w, h, col, o = {}) => bands.add({ x, y: 0, z, sx: w * 0.5, sy: h * FXL.fx.tall, ex: w, ey: h * 1.15 * FXL.fx.tall, life: 0.45, col, a: 0.85, fo: 1.2, ...o });
  // a standing hoop facing along `f` (sound waves, sonic rings): the band turned on its side
  const hoop = (x, y, z, f, r0, r1, col, o = {}) => bands.add({ x, y, z, rx: HALF, ry: f, sx: r0, sy: 0.25, sz: r0, ex: r1, ey: 0.12, ez: r1, life: 0.35, col, a: 0.9, ...o });
  // a flat resonance ring at height y
  const disc = (x, y, z, r0, r1, col, o = {}) => bands.add({ x, y, z, sx: r0, sy: 0.14, ex: r1, ey: 0.1, life: 0.6, col, a: 0.8, ...o });
  const blade = (x, y, z, f, tilt, r0, r1, col, o = {}) => blades.add({ x, y, z, ry: f, rz: tilt, sx: r0 * FXL.fx.blade, ex: r1 * FXL.fx.blade, life: 0.28, col, a: 1, fi: 0.08, ...o });
  // a lance of light from (x, y, z) pointing along f (level), `len` long
  const streak = (x, y, z, f, len, w, col, o = {}) => lances.add({ x, y, z, rx: HALF, ry: f, sx: w, sy: len * 0.5, sz: w, ex: w * 0.4, ey: len, ez: w * 0.4, life: 0.3, col, a: 1, fi: 0.05, ...o });
  function rocks(x, z, r, n, h, tint = 0x8a8078, delay = 0) {
    n = Math.max(3, Math.round(n * FXL.fx.rocks));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.25, 0.25), d = r * rnd(0.45, 0.8), w = rnd(0.16, 0.34);
      shards.add({ x: x + Math.sin(a) * d, y: -0.05, z: z + Math.cos(a) * d, ry: a, rx: rnd(0.2, 0.55), sx: w, sy: h * rnd(0.6, 1.15), sz: w, life: rnd(0.7, 1.05), pop: 1, col: tint, delay: delay + rnd(0, 0.06) });
    }
  }

  // ---------- the 3D skill effects ----------
  // (e: the fx event; ox, oz: where the caster stands (your own predicted spot for yourself); col: the class colour; g: the
  // caster's model group, to follow)
  const FX = {
    cut(e, ox, oz, col) { // a crescent through the swing: the Burst Combo's steps alternate, a basic finisher is bigger
      const r = e.r || 3, fin = e.fin || e.c === 'gold', tilt = (e.n % 2 ? -1 : 1) * (fin ? 0.5 : 0.85);
      blade(ox + Math.sin(e.f) * 0.3, 1.15, oz + Math.cos(e.f) * 0.3, e.f, tilt, r * 0.6, r * (fin ? 1.05 : 0.9), fin ? gold() : col, { life: fin ? 0.3 : 0.22 });
    },
    finisher(e, ox, oz, col) { // crossed blades, a pillar and a shock where the last blow lands
      const r = e.r || 3.2, x = ox + Math.sin(e.f) * r * 0.55, z = oz + Math.cos(e.f) * r * 0.55;
      blade(ox, 1.2, oz, e.f, 0.95, r * 0.7, r * 1.25, gold(), { life: 0.34 });
      blade(ox, 1.2, oz, e.f, -0.95, r * 0.7, r * 1.25, gold(), { life: 0.34, delay: 0.04 });
      blade(ox, 1.0, oz, e.f, 0.05, r * 0.8, r * 1.4, WHITE, { life: 0.3, delay: 0.08 });
      pillar(x, z, 0.9, 6, gold(), { life: 0.4 });
      shock(x, z, r * 0.9, col, { h: 0.9 });
      fx.flash(x, 1.4, z, 3.2, 0xfff3c4, 0.18);
    },
    cleave(e, ox, oz, col) { // a wide heavy blade sweeping across, a second one in its wake
      const r = e.r || 4, c = e.rage > 60 ? 0xff3d2e : col;
      blade(ox, 1.1, oz, e.f - 0.9, 0.18, r * 0.75, r * 1.12, c, { spin: 6.5, life: 0.3 });
      blade(ox, 1.3, oz, e.f - 1.2, -0.14, r * 0.6, r * 0.95, WHITE, { spin: 7.5, life: 0.26, delay: 0.05, a: 0.7 });
    },
    whirl(e, ox, oz, col, g) { // blades spinning round the body, a low shock
      const r = e.r || 4, n = e.n || 0;
      for (let i = 0; i < 2; i++) blades.add({ fol: g, x: g ? 0 : ox, y: 1.0 + i * 0.35, z: g ? 0 : oz, ry: (e.f || 0) + i * Math.PI + n * 1.3, rz: i ? -0.14 : 0.14, sx: r * 0.55, ex: r * (i ? 0.85 : 1), spin: 15, life: 0.4, col: i ? WHITE : col, a: i ? 0.75 : 1 });
      if (!n) shock(ox, oz, r, col, { h: 0.7, a: 0.6 });
    },
    slam(e, ox, oz, col) { // the ground breaks: a shock wall, rock shards, dust
      const x = e.k === 'ring' ? ox : e.x, z = e.k === 'ring' ? oz : e.z, r = e.r || 5, big = !!e.big || e.c === 'gold';
      shock(x, z, r * 1.05, col, { h: big ? 2.2 : 1.6, life: 0.48 });
      shock(x, z, r * 0.6, WHITE, { h: 0.8, life: 0.3, delay: 0.05, a: 0.7 });
      rocks(x, z, r, big ? 11 : 8, big ? 1.9 : 1.4);
      fx.flash(x, 0.6, z, big ? 4 : 3, 0xffe2b0, 0.16);
      fx.sparks(x, 0.3, z, 14, 0xcfc6ba, 0.26, 7);
    },
    skyland(e, ox, oz, col) { // Sky Lance comes down: a pillar of light on top of the slam
      const big = e.ev === 'meteorLand', c = e.ev === 'pinLand' ? 0xf78fd0 : big ? 0xffa257 : col;
      pillar(e.x, e.z, big ? 2 : 1.3, 10, c, { life: 0.5 });
      shock(e.x, e.z, (e.r || 4) * 1.05, c, { h: 1.8, life: 0.46 });
      rocks(e.x, e.z, e.r || 4, big ? 10 : 7, big ? 1.8 : 1.3);
      fx.flash(e.x, 0.8, e.z, big ? 4.5 : 3.4, WHITE, 0.16);
    },
    skymark(e, ox, oz, col) { // ... and on its way: a lance of light falling to the mark
      const d = Math.max(0.2, e.d || 0.6), c = e.ev2 === 'pinning' ? 0xf78fd0 : e.ev2 === 'meteor' ? 0xffa257 : col;
      lances.add({ x: e.x2, y: 16.5, z: e.z2, vy: -12.5 / d, rx: Math.PI, sx: 0.3, sy: 3.5, sz: 0.3, ex: 0.42, ey: 4.5, life: d, col: c, a: 1, fi: 0.3, fo: 0.4 });
      pillar(e.x2, e.z2, 0.3, 9, c, { life: d, a: 0.3, fi: 0.4 });
    },
    takeoff(e, ox, oz, col) { disc(e.x0 ?? ox, 0.1, e.z0 ?? oz, 0.5, 2.6, col, { life: 0.35 }); }, // Leap Slam leaves the ground
    dash(e, ox, oz, col) { // three lances down the lane, a sonic hoop behind, a cut at the far end
      const x0 = e.x0 ?? e.x, z0 = e.z0 ?? e.z, dx = e.x2 - x0, dz = e.z2 - z0, len = Math.hypot(dx, dz);
      if (!(len > 0.5)) return;
      const f = Math.atan2(dx, dz), sx = Math.cos(f), sz = -Math.sin(f);
      for (let i = 0; i < 3; i++) { const o = (i - 1) * 0.42; streak(x0 + sx * o, 0.75 + i * 0.5, z0 + sz * o, f, len * (0.85 + i * 0.07), 0.1, i === 1 ? WHITE : col, { delay: i * 0.03, life: 0.3 }); }
      hoop(x0 + dx * 0.15, 1.2, z0 + dz * 0.15, f, 0.5, 1.9, col, { life: 0.32 });
      hoop(x0 + dx * 0.55, 1.2, z0 + dz * 0.55, f, 0.4, 1.4, WHITE, { life: 0.28, delay: 0.06, a: 0.6 });
      blade(e.x2, 1.2, e.z2, f, 1.15, 1.5, 2.6, col, { life: 0.26, delay: 0.08 });
    },
    thrust(e, ox, oz, col) { // spear and rapier basics: only the finishing thrust gets a lance
      if (e.n !== 2) return;
      streak(ox, 1.25, oz, e.f, (e.r || 4) * 1.05, 0.16, col, { life: 0.22 });
      hoop(ox + Math.sin(e.f) * (e.r || 4), 1.25, oz + Math.cos(e.f) * (e.r || 4), e.f, 0.3, 1.1, gold(), { life: 0.25, delay: 0.04 });
    },
    pierce(e, ox, oz, col) { // Piercing Shot: a tracer the whole range, rings where it tears through the air
      const r = e.r || 24, sx = Math.sin(e.f), sz = Math.cos(e.f), w = e.big ? 0.36 : 0.24;
      streak(ox + sx, 1.3, oz + sz, e.f, r, w, col, { life: e.big ? 0.5 : 0.38, fo: 1.1 });
      streak(ox + sx, 1.3, oz + sz, e.f, r * 0.7, w * 0.45, WHITE, { life: 0.3 });
      for (let i = 0; i < 3; i++) { const d = 2 + i * (e.big ? 5 : 4); hoop(ox + sx * d, 1.3, oz + sz * d, e.f, 0.25, 1.5 - i * 0.3, col, { life: 0.34, delay: i * 0.035, a: 0.8 - i * 0.15 }); }
      fx.flash(ox + sx * 1.1, 1.3, oz + sz * 1.1, e.big ? 2.6 : 1.9, WHITE, 0.12);
    },
    waves(e, ox, oz, col) { // Dissonance: hoops of sound rolling out through the cone
      const r = e.r || 7, sx = Math.sin(e.f), sz = Math.cos(e.f), wide = Math.min(3.2, Math.tan(Math.min(1.2, e.h || 0.6)) * r * 0.5), sp = r / 0.42;
      for (let i = 0; i < 3; i++) hoop(ox + sx * 0.8, 1.25, oz + sz * 0.8, e.f, 0.5, wide, i === 1 ? 0xf5c2ff : col, { vx: sx * sp, vz: sz * sp, life: 0.42, delay: i * 0.085, a: 0.9 - i * 0.15 });
    },
    smite(e, ox, oz, col) { pillar(e.x2, e.z2, 0.6, 7, col, { life: 0.34 }); fx.flash(e.x2, 1.3, e.z2, 2.4, 0xfff7d6, 0.14); },
  };

  // ---------- Team Burst: a look per class trait, layered for pairs and parties ----------
  const TRAIT = {
    swordsman(x, z, h, col, t) { for (let i = 0; i < 5; i++) blade(x, h * rnd(0.3, 0.7), z, rnd(0, 6.3), rnd(-1.3, 1.3), 2.2, 3.6, i % 2 ? WHITE : col, { life: 0.3, delay: t + i * 0.055 }); },
    guardian(x, z, h, col, t) { domes.add({ x, y: 0, z, sx: 1.2, ex: 5.5, life: 1.25, col, a: 1, fi: 0.1, fo: 1.1, delay: t }); shock(x, z, 5.6, col, { h: 0.5, life: 0.6, delay: t }); },
    cleric(x, z, h, col, t) {
      pillar(x, z, 1.5, 13, col, { life: 0.95, delay: t, fo: 1 });
      for (let i = 0; i < 3; i++) disc(x, 0.2, z, 2.4 - i * 0.5, 2.8 - i * 0.5, WHITE, { vy: 4.5, life: 0.8, delay: t + i * 0.14, a: 0.7 });
    },
    ranger(x, z, h, col, t) {
      for (let i = 0; i < 10; i++) {
        const a = rnd(0, 6.3), d = rnd(0.4, 3.6);
        lances.add({ x: x + Math.sin(a) * d, y: 11, z: z + Math.cos(a) * d, vy: -46, rx: Math.PI, rz: rnd(-0.08, 0.08), sx: 0.11, sy: 2.6, sz: 0.11, ey: 3.2, life: 0.23, col, a: 1, fi: 0.2, fo: 0.3, delay: t + i * 0.045 });
      }
    },
    berserker(x, z, h, col, t) { rocks(x, z, 3.2, 10, 2.2, 0x9a3b2c, t); shock(x, z, 4.5, col, { h: 2.4, life: 0.5, delay: t }); blade(x, h * 0.5, z, rnd(0, 6.3), 0.4, 2.5, 4.4, col, { life: 0.34, delay: t, spin: 5 }); },
    lancer(x, z, h, col, t) {
      for (let i = 0; i < 6; i++) { // six spears driven in round the target, leaning inward
        const a = (i / 6) * Math.PI * 2, d = 2.6;
        lances.add({ x: x + Math.sin(a) * (d + 2.4), y: 12.7, z: z + Math.cos(a) * (d + 2.4), vx: -Math.sin(a) * 13, vy: -44, vz: -Math.cos(a) * 13, ry: a + Math.PI, rx: Math.PI - 0.3, sx: 0.14, sy: 4.2, sz: 0.14, life: 0.19, col, a: 1, fi: 0.2, fo: 0.3, delay: t + i * 0.03 });
        lances.add({ x: x + Math.sin(a) * d, y: 4.3, z: z + Math.cos(a) * d, ry: a + Math.PI, rx: Math.PI - 0.3, sx: 0.12, sy: 4.4, sz: 0.12, ex: 0.05, life: 0.75, col, a: 0.9, fi: 0.03, fo: 1.4, delay: t + 0.19 + i * 0.03 });
      }
    },
    bard(x, z, h, col, t) { for (let i = 0; i < 3; i++) disc(x, 0.4 + i * 1.0, z, 0.6, 6.2 - i * 0.9, i === 1 ? 0xa5f3fc : col, { life: 0.85, delay: t + i * 0.11 }); },
  };
  function burst(e) {
    const m = mobs.get(e.m), h = Math.min(m?.model.height || 2.2, 4.5);
    let cls = Array.isArray(e.cls) && e.cls.length ? e.cls : null;
    cls ||= [...new Set((e.ids || []).map(id => players.get(id)?.cls).filter(Boolean))];
    if (!cls.length) cls = [players.get(e.by)?.cls || state.cls];
    fx.flash(e.x, h * 0.5, e.z, 4 + cls.length, WHITE, 0.2);
    shock(e.x, e.z, 3 + cls.length, WHITE, { h: 1.2, life: 0.4, a: 0.7 });
    cls.slice(0, 6).forEach((c, i) => TRAIT[c]?.(e.x, e.z, h, classColor(c), i * 0.13));
  }

  // ---------- combos: a flourish on the target ----------
  function combo(e) {
    const m = mobs.get(e.id), h = Math.min(m?.model.height || 2, 4) * 0.55, s = e.self ? 0.6 : 1, x = e.x, z = e.z;
    const col = classColor(players.get(e.by)?.cls), kind = COMBO_FX[e.k];
    fx.flash(x, h, z, 2.4 * s, WHITE, 0.14);
    if (kind === 'cross') { blade(x, h, z, rnd(0, 6.3), 0.8, 1.4 * s, 2.7 * s, col); blade(x, h, z, rnd(0, 6.3), -0.8, 1.4 * s, 2.7 * s, WHITE, { delay: 0.05 }); }
    else if (kind === 'quake') { rocks(x, z, 2.6 * s, e.self ? 5 : 8, 1.5 * s); shock(x, z, 3 * s, col, { h: 1.4 * s }); }
    else if (kind === 'judge') { pillar(x, z, 0.9 * s, 9, 0xfff1b8, { life: 0.5 }); disc(x, 0.15, z, 0.4, 2.6 * s, gold(), { life: 0.4 }); }
    else if (kind === 'beat') { for (let i = 0; i < 2; i++) disc(x, h * (0.6 + i * 0.7), z, 0.4, (3 - i * 0.6) * s, i ? WHITE : col, { life: 0.45, delay: i * 0.07 }); }
    else if (kind === 'spike') { const f = rnd(0, 6.3); streak(x - Math.sin(f) * 2.4 * s, h, z - Math.cos(f) * 2.4 * s, f, 4.8 * s, 0.18, col, { life: 0.26 }); hoop(x, h, z, f, 0.3, 1.5 * s, WHITE, { life: 0.26 }); }
    else shock(x, z, 2.2 * s, col, { h: 0.9 * s, life: 0.32 });
  }

  // ---------- skill chains: the counter by your character, a flourish for others, brighter trails ----------
  const chains = new Map(); // player id -> { n, until }
  let arts = null, chainHold = 4;
  import('/shared/chains.js').then(m => { arts = m.CHAIN_ARTS || null; chainHold = m.CHAIN?.hold || chainHold; }).catch(() => {}); // (the gameplay branch's table; fine without it)
  const chainEl = document.createElement('div'); chainEl.id = 'chain-hud'; (hud || document.body).appendChild(chainEl);
  const chainN = id => { const c = chains.get(id); return c && performance.now() < c.until ? c.n : 0; };
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  function chain(e) {
    const n = Math.max(1, Math.min(9, e.n | 0)), p = players.get(e.id);
    chains.set(e.id, { n, until: performance.now() + (chainHold + 0.5) * 1000 });
    if (e.id === me()) {
      const name = e.nm || e.name || arts?.[p?.cls || state.cls]?.[e.k]?.name || '';
      chainEl.innerHTML = `<span>CHAIN <b>x${n}</b>${name ? ` · <i>${esc(name)}</i>` : ''}</span>`;
      chainEl.className = `on n${Math.min(4, n)}`;
      if (!calm()) { void chainEl.offsetWidth; chainEl.classList.add('pop'); }
      if (n >= 3) kick(0.3 + 0.12 * (n - 3));
    }
    if (!Q.fx3d || !p || p.culled) return;
    const g = p.model.group.position, col = classColor(p.cls);
    disc(g.x, 0.12, g.z, 0.5, 1.5 + n * 0.3, col, { life: 0.4, a: e.id === me() ? 0.9 : 0.55 }); // a ring at the feet, wider with the chain
    if (n >= 3) pillar(g.x, g.z, 0.5, 2.2 + n * 0.4, n >= 4 ? gold() : col, { life: 0.36, a: e.id === me() ? 0.6 : 0.4 });
    if (e.k || n >= 3) fx.sparks(g.x, 1.2, g.z, 4 + n * 2, n >= 4 ? gold() : col, 0.2, 5);
  }
  function chainFrame() {
    const c = chains.get(me()), on = !!c && performance.now() < c.until && !state.dead && !state.spectator;
    if (!on) { if (chainEl.classList.contains('on')) chainEl.classList.remove('on'); return; }
    const p = players.get(me()), g = p?.model.group.position, s = g && project(g.x, g.y + 1.25, g.z);
    if (s) chainEl.style.transform = `translate(${Math.round(s[0] + 54)}px, ${Math.round(s[1] - 10)}px)`;
  }

  // ---------- camera kick ----------
  let kickAmt = 0, kickFov = 0;
  function kick(a) { if (calm() || state.spectator) return; kickAmt = Math.min(1, Math.max(kickAmt, a)); shake(0.1 + 0.16 * a); }
  /** After the game camera is placed: the FOV punch (widens for a moment, eases back). Not during a film shot. */
  function applyKick(cam, base = 60) {
    const f = kickAmt > 0.004 ? 3.4 * kickAmt : 0;
    if (f === kickFov) return;
    kickFov = f; cam.fov = base + f; cam.updateProjectionMatrix();
  }

  // ---------- accents ----------
  const near = p => p.id === me() || (!p.culled && Math.hypot(p.model.group.position.x - camera.position.x, p.model.group.position.z - camera.position.z) < Q.animNear);
  function accent(p, kind) { if (kind && Q.fx3d && p?.model.anim?.accent && near(p)) p.model.anim.accent(kind); }

  // ---------- events ----------
  function onFx(e) {
    const key = skillKey(e), S = key && SKILL[key];
    if (!S) return;
    const p = players.get(e.id);
    if (!p) return; // (players only: enemies keep their own telegraphs and wind-ups)
    if (!(key === 'ca:whirl' && e.n) && !(key === 'cb:cyclone' && e.n)) accent(p, S[0]);
    if (!S[1] || !Q.fx3d || (p.culled && e.id !== me())) return;
    const mine = e.id === me();
    FX[S[1]](e, mine ? state.x : e.x, mine ? state.z : e.z, classColor(p.cls), p.model.group);
  }
  /** Every event passes through here first. Returns true only for the events that are ours alone. */
  function event(e) {
    switch (e.t) {
      case 'fx': onFx(e); return false;
      case 'chain': chain(e); return true;
      case 'chainEnd': chains.delete(e.id); return true;
      case 'tcall': bubbles?.call?.(e); return true;
      case 'combo':
        if (Q.fx3d) combo(e);
        if (e.by === me() || e.from === me()) kick(e.self ? 0.3 : 0.55);
        return false;
      case 'tburst':
        if (Q.fx3d) burst(e);
        if (e.ids?.includes(me())) kick(Math.min(1, 0.6 + 0.1 * (e.n || 1)));
        return false;
      case 'stagger': { // a Break: the guard shatters
        const m = mobs.get(e.id);
        if (!m || !Q.fx3d) return false;
        const g = m.model.group.position, h = Math.min(m.model.height * 0.6, 3.2);
        fx.flash(g.x, h, g.z, 3.6, gold(), 0.2);
        shock(g.x, g.z, m.def.radius + 2.8, gold(), { h: 1.5, life: 0.42 });
        fx.spray(g.x, h, g.z, 0, 1, 0, 16, 0xffe9a8, 0.26, 9, 0.9);
        if (e.by === me()) kick(0.5);
        return false;
      }
    }
    return false;
  }
  /** A player's hit landed on enemy m (main.js hitJuice; dx, dz: unit vector from the attacker to it). Heavier
   *  blows get a flash, sparks thrown through the far side, the attacker's recoil, and (yours) a camera kick. */
  function hit(m, e, dx, dz) {
    if (!Q.fx3d || !(e.h || e.c)) return;
    const g = m.model.group.position, r = m.def.radius * 0.8, y = Math.min(m.model.height * 0.55, m.def.boss ? 3.2 : 2.2);
    const x = g.x - dx * r, z = g.z - dz * r;
    fx.flash(x, y, z, e.h && e.c ? 2.8 : e.h ? 2.1 : 1.7, e.c ? gold() : 0xfff0d8, e.h ? 0.15 : 0.11);
    if (e.h) fx.spray(x, y, z, dx, 0.35, dz, e.c ? 14 : 9, e.c ? gold() : 0xffd9a0, 0.24, 11, 0.5);
    const by = players.get(e.by);
    if (by?.model.anim?.recoil && near(by)) by.model.anim.recoil(e.h ? 1 : 0.5);
    if (e.by === me() && e.h) kick(e.c ? 0.5 : 0.36);
  }

  // ---------- trails: follow the weapon while a melee clip swings it ----------
  const isMelee = act => (act._fbMelee ??= /Melee_Attack|Block_Attack/.test(act.getClip().name));
  function trailFrame(vdt, rdt) {
    const max = Q.trails, mine = players.get(me());
    if (max > 0) for (const p of players.values()) {
      const dt = p === mine ? rdt : vdt;
      if (!(dt > 0)) continue;
      const a = p.model.anim, act = a?.shotAct;
      if (!act || p.culled || p.dead || !isMelee(act)) continue;
      const g = p.model.group.position;
      if (p.id !== me() && Math.hypot(g.x - camera.position.x, g.z - camera.position.z) > 45) continue;
      const s = trails.slotFor(p, max);
      if (!s) continue;
      const slot = p.vfxSlot === undefined ? (p.vfxSlot = p.model.root?.getObjectByName('handslotr') || null) : p.vfxSlot;
      if (!slot) continue;
      slot.updateWorldMatrix(true, false);
      const L = REACH[p.cls] || 1.7;
      _p.set(0, L, 0).applyMatrix4(slot.matrixWorld); _s.set(0, L * FXL.trail.inner, 0).applyMatrix4(slot.matrixWorld);
      // only while the weapon really moves (relative to the body): the wind-up and the recovery leave no ribbon
      const sp = s.has ? Math.hypot(_p.x - s.lx - (g.x - s.ex0), _p.y - s.ly, _p.z - s.lz - (g.z - s.ez0)) / dt : 0;
      s.lx = _p.x; s.ly = _p.y; s.lz = _p.z; s.ex0 = g.x; s.ez0 = g.z; s.has = true;
      if (sp > 3.2) {
        const n = chainN(p.id);
        _c.set(classColor(p.cls)).lerp(_white, Math.min(0.5, 0.13 * n)); s.r = _c.r; s.g = _c.g; s.b = _c.b;
        const K = FXL.trail;
        if (K.headMix) { _c.lerp(_lc.set(K.head), K.headMix); s.r = _c.r; s.g = _c.g; s.b = _c.b; }
        if (K.hue) _c.offsetHSL(K.hue, 0, 0);
        if (K.tailMix) _c.lerp(_lc.set(K.tail), K.tailMix);
        s.tr = _c.r; s.tg = _c.g; s.tb = _c.b;
        s.gain = (0.8 + 0.2 * Math.min(4, n)) * Math.min(1, sp / 7) * K.gain;
        trails.push(s, _s.x, _s.y, _s.z, _p.x, _p.y, _p.z, g.x, g.z, dt);
      }
    }
    for (const s of trails.slots) if (s.ent && !s.n && !(s.ent.model.anim?.shotAct && players.get(s.ent.id) === s.ent)) { s.ent = null; s.has = false; } // faded out and the swing is over: free
    trails.update(vdt, mine, rdt);
  }
  return {
    event, hit, kick, applyKick, chainN,
    /** dt: real seconds (the camera kick); vdt: visual seconds (slow motion and hit-stop hold the effects too). */
    frame(dt, vdt) {
      applyGlowLook(); GLOW_U.uTr.value.set(FXL.trail.body, FXL.trail.tipPow, FXL.trail.edge, FXL.trail.white); GLOW_U.uWhite.value = FXL.fx.white;
      for (const b of batches) b.update(vdt);
      trailFrame(vdt, dt);
      chainFrame();
      kickAmt *= Math.exp(-dt * 9);
    },
    /** The loading screen's shader warm-up: show one (invisible) instance of everything while main.js compiles. */
    warm(on) {
      for (const b of batches) { if (on) { _m.makeScale(0, 0, 0).toArray(b.mesh.instanceMatrix.array, 0); b.mesh.count = 1; b.mesh.visible = true; } else if (!b.n) { b.mesh.count = 0; b.mesh.visible = false; } }
      trails.mesh.visible = on || trails.mesh.visible;
    },
    stats: () => ({ bands: bands.n, blades: blades.n, domes: domes.n, lances: lances.n, shards: shards.n, trails: trails.slots.filter(s => s.n).length, pts: Math.max(...trails.slots.map(s => s.n)), draws: batches.filter(b => b.mesh.visible).length + (trails.mesh.visible ? 1 : 0) + (fx.pool.points.visible ? 1 : 0), kick: kickAmt }),
    FX, TRAIT,
  };
}
