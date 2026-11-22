// Hit sparks and impact flashes: every spark in the game lives in ONE Points cloud (one draw call, however many hits
// land in a frame) with fixed buffers, so a burst allocates nothing. Before, each burst built its own geometry, material
// and typed arrays and cost a draw call of its own. Effects.sparks / Effects.flash (world.js) feed it.
//  kind 0: a spark: thrown outward, pulled down, fading and shrinking.
//  kind 1: an impact flash: a four-point star that pops and is gone (heavy hits, crits, finishers, Breaks).
import * as THREE from 'three';
import { GLOW_BLEND } from '/post.js';

const CAP = 640;
const VERT = `
attribute vec4 aCol; attribute vec2 aSz; uniform float uScale; varying vec4 vCol; varying float vKind;
void main() {
  vCol = aCol; vKind = aSz.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = aSz.x > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = aSz.x * uScale / max(0.1, -mv.z);
}`;
const FRAG = `
varying vec4 vCol; varying float vKind;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; float d = length(p), a;
  if (vKind < 0.5) a = smoothstep(1.0, 0.15, d);
  else { vec2 q = abs(p); a = clamp(1.0 - sqrt(q.x * q.y) * 7.0 - d * 0.75, 0.0, 1.0) + 0.35 * smoothstep(0.7, 0.0, d); }
  a *= vCol.a;
  gl_FragColor = vec4(mix(vCol.rgb, vec3(1.0), a * a * 0.5) * a, min(1.0, a));
}`;
const _c = new THREE.Color(), _v = new THREE.Vector2();

export class SparkPool {
  constructor(scene) {
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(CAP * 3); this.col = new Float32Array(CAP * 4); this.sz = new Float32Array(CAP * 2);
    this.vel = new Float32Array(CAP * 3); this.age = new Float32Array(CAP); this.life = new Float32Array(CAP); this.size = new Float32Array(CAP);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSz', new THREE.BufferAttribute(this.sz, 2).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 400 } }, ...GLOW_BLEND });
    const pts = this.points = new THREE.Points(g, this.mat);
    pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 5;
    pts.onBeforeRender = (renderer, _s, camera) => { this.mat.uniforms.uScale.value = renderer.getDrawingBufferSize(_v).y * 0.5 * camera.projectionMatrix.elements[5]; };
    scene.add(pts);
    this.next = 0; this.live = 0; this.top = 0; // top: one past the highest slot in use (the loop stops there)
  }
  slot() {
    const i = this.next; this.next = (i + 1) % CAP;
    if (this.life[i] <= 0) this.live++;
    if (i >= this.top) this.top = i + 1;
    return i;
  }
  put(i, x, y, z, vx, vy, vz, color, size, life, kind) {
    const p = i * 3, c = i * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    _c.set(color); this.col[c] = _c.r; this.col[c + 1] = _c.g; this.col[c + 2] = _c.b; this.col[c + 3] = 1;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.sz[i * 2] = size; this.sz[i * 2 + 1] = kind;
    this.points.visible = true;
  }
  /** n sparks flung outward from a point (the old Effects.sparks, same look and timing). */
  burst(x, y, z, n, color, size, speed, life = 0.25) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, up = 0.2 + Math.random() * 0.9, s = speed * (0.5 + Math.random() * 0.7);
      this.put(this.slot(), x, y, z, Math.cos(a) * s, up * s, Math.sin(a) * s, color, size, life * (0.85 + Math.random() * 0.4), 0);
    }
  }
  /** n sparks thrown in a cone around a direction (dx, dy, dz: unit), e.g. off the far side of a struck enemy. */
  spray(x, y, z, dx, dy, dz, n, color, size, speed, spread = 0.6, life = 0.3) {
    for (let k = 0; k < n; k++) {
      const s = speed * (0.45 + Math.random() * 0.8);
      this.put(this.slot(), x, y, z, (dx + (Math.random() - 0.5) * 2 * spread) * s, (dy + (Math.random() - 0.2) * spread) * s, (dz + (Math.random() - 0.5) * 2 * spread) * s, color, size, life * (0.8 + Math.random() * 0.5), 0);
    }
  }
  /** One impact flash (a star, `size` m across). */
  flash(x, y, z, size, color, life = 0.14) { this.put(this.slot(), x, y, z, 0, 0, 0, color, size, life, 1); }
  update(dt) {
    if (!this.live) { if (this.points.visible) { this.points.visible = false; this.top = 0; } return; }
    const { pos, vel, age, life, sz, col, size } = this;
    const drag = Math.pow(0.9, dt * 60);
    let top = 0;
    for (let i = 0; i < this.top; i++) {
      if (life[i] <= 0) continue;
      const k = (age[i] += dt) / life[i], p = i * 3;
      if (k >= 1) { life[i] = 0; sz[i * 2] = 0; this.live--; continue; }
      top = i + 1;
      if (sz[i * 2 + 1] < 0.5) {
        pos[p] += vel[p] * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += vel[p + 2] * dt;
        vel[p + 1] -= 18 * dt; vel[p] *= drag; vel[p + 2] *= drag;
        col[i * 4 + 3] = 1 - k * k; sz[i * 2] = size[i] * (1 - k * 0.6);
      } else { col[i * 4 + 3] = 1 - k * k; sz[i * 2] = size[i] * (0.55 + 0.75 * Math.sqrt(k)); }
    }
    this.top = top;
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aCol.needsUpdate = a.aSz.needsUpdate = true;
  }
}
