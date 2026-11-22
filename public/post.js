// Bloom + tone mapping for Medium and High (Settings → Graphics; Q.post in public/quality.js). A lean pipeline of our
// own instead of three's UnrealBloomPass (13 full-screen passes, most at full size, half-float buffers): here the scene
// is drawn once into a plain 8-bit target, then 7 small passes (a quarter of the screen and below) and one full-screen
// pass put it on the canvas.
//
//  scene ──▶ sceneRT (canvas size, MSAA on High)
//            └▶ bright (1/4) ─▶ 1/8 ─▶ 1/16 ─▶ 1/32          (downsample: 4 bilinear taps each)
//                  ▲◀──────── up ◀──── up ◀──── up            (upsample: a 9-tap tent, added to that level's own)
//  canvas ◀─ final: scene + bloom, soft highlight shoulder (the tone map), a light vignette, dither
//
// Two things keep it cheap and safe:
//  - No shader ever recompiles when it turns on or off. three.js picks a material's shader by the output colour space
//    and tone mapping of the target it draws into: the canvas gets sRGB, an ordinary render target gets linear, so a
//    switch would recompile every material in view (a long hitch mid-fight, exactly when Auto quality steps down).
//    sceneRT is flagged like an XR target with an sRGB texture, which makes three.js use the very same programs as for
//    the canvas, and it stores what the canvas would have got (plain RGBA8, forced by internalFormat).
//  - What glows is chosen, not guessed. The scene's alpha channel is free (every ordinary material leaves it at 1), so
//    the game's glowing effects (public/vfx.js, public/sparks.js: GLOW_BLEND) multiply it down where they draw. The
//    bright pass takes those pixels whatever their colour, plus anything close to white. The sky, the sunlit ground
//    and the red danger telegraphs stay crisp and readable.
import * as THREE from 'three';
import { FXL } from '/fxlook.js';

/** Blending for a glowing effect: colour is added (premultiplied in the shader), alpha is multiplied down by the
 *  shader's alpha, which marks the pixel for the bloom. (On the canvas itself, Low, the alpha write does nothing.) */
export const GLOW_BLEND = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, transparent: true, depthWrite: false,
};

/** Every material that draws with GLOW_BLEND registers here, so a look (public/fxlook.js `solid`) can switch them all
 *  between pure glow (light is added: bright on dark ground, washed out on bright ground) and paint (the effect covers
 *  what is behind it by its own strength, so its colour reads on any ground). Blend factors are GL state, not shader
 *  code: nothing recompiles. In paint mode the shader's alpha is scaled by `solid` (uniform uSolid), and the bloom
 *  mask is scaled back up by the same amount so the effect glows as much as before. */
export const glowMats = [];
export function glowMaterial(mat) { mat.uniforms.uSolid = GLOW_SOLID; glowMats.push(mat); return mat; }
export const GLOW_SOLID = { value: 1 };
let glowRev = -1;
export function applyGlowLook() {
  if (glowRev === FXL.rev) return;
  glowRev = FXL.rev;
  const solid = FXL.fx.solid;
  GLOW_SOLID.value = solid > 0 ? solid : 1;
  for (const m of glowMats) m.blendDst = solid > 0 ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
}

export const BLOOM = { threshold: 0.78, knee: 0.2, bright: 0.55, mask: 1.0, strength: 0.85, shoulder: 0.8, vignette: 0.16, levels: 4 };

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
// (bloom buffers hold sqrt(light): 8 bits go a long way, and no float-texture extension is needed)
const BRIGHT = `
uniform sampler2D tMap; uniform vec2 uTexel; uniform vec4 uP; varying vec2 vUv;
vec3 pick(vec2 uv) {
  vec4 s = texture2D(tMap, uv); vec3 lin = s.rgb * s.rgb;
  float l = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  return lin * (smoothstep(uP.x, uP.x + uP.y, l) * uP.z + (1.0 - s.a) * uP.w);
}
void main() {
  vec3 c = pick(vUv + uTexel * vec2(-1.0, -1.0)) + pick(vUv + uTexel * vec2(1.0, -1.0)) + pick(vUv + uTexel * vec2(-1.0, 1.0)) + pick(vUv + uTexel * vec2(1.0, 1.0));
  gl_FragColor = vec4(sqrt(c * 0.25), 1.0);
}`;
const DOWN = `
uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv;
vec3 tap(vec2 o) { vec3 c = texture2D(tMap, vUv + uTexel * o).rgb; return c * c; }
void main() {
  vec3 c = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
  gl_FragColor = vec4(sqrt(c * 0.25), 1.0);
}`;
const UP = `
uniform sampler2D tMap; uniform sampler2D tAdd; uniform vec2 uTexel; varying vec2 vUv;
vec3 tap(vec2 o) { vec3 c = texture2D(tMap, vUv + uTexel * o).rgb; return c * c; }
void main() {
  vec3 c = tap(vec2(0.0)) * 4.0 + (tap(vec2(-1.0, 0.0)) + tap(vec2(1.0, 0.0)) + tap(vec2(0.0, -1.0)) + tap(vec2(0.0, 1.0))) * 2.0
    + tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
  vec3 own = texture2D(tAdd, vUv).rgb;
  gl_FragColor = vec4(sqrt(c * 0.0625 * 0.75 + own * own * 0.6), 1.0);
}`;
const FINAL = `
uniform sampler2D tMap; uniform sampler2D tBloom; uniform vec4 uP; uniform vec4 uGain; uniform vec4 uLift; varying vec2 vUv;
// The tone map: light below the shoulder passes untouched (the game keeps its colours), light above it rolls off
// towards white instead of clipping, so a glow over a bright floor keeps its shape.
vec3 shoulder(vec3 x) { float a = uP.y, w = 1.0 - a; vec3 t = max(x - a, 0.0) / w; return min(x, vec3(a)) + w * (1.0 - 1.0 / (1.0 + t + t * t)); }
float hash(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec3 s = texture2D(tMap, vUv).rgb, b = texture2D(tBloom, vUv).rgb;
  vec3 lin = s * s + b * b * uP.x; // (gamma 2 in, sqrt out: exact for an untouched pixel, and no pow per pixel)
  // the look's colour grade (public/fxlook.js): saturation, contrast about mid grey, a tint on the light, a lift in the darks
  float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  lin = max((mix(vec3(lum), lin, uGain.a) - 0.18) * uLift.a + 0.18, 0.0) * uGain.rgb;
  lin += uLift.rgb * (1.0 - min(lin, 1.0));
  lin = min(shoulder(lin), 1.0);
  vec2 q = vUv - 0.5; lin *= 1.0 - uP.z * smoothstep(0.25, 0.95, dot(q, q) * 2.0);
  gl_FragColor = vec4(sqrt(lin) + (hash(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}`;

export function createPost(renderer, { samples = 0 } = {}) {
  const tri = new THREE.BufferGeometry(); // one triangle covering the screen
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const quad = new THREE.Mesh(tri, null); quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  const B = BLOOM, N = B.levels;
  const mBright = mat(BRIGHT, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() }, uP: { value: new THREE.Vector4(B.threshold, B.knee, B.bright, B.mask) } });
  const mDown = mat(DOWN, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const mUp = mat(UP, { tMap: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const mFinal = mat(FINAL, { tMap: { value: null }, tBloom: { value: null }, uP: { value: new THREE.Vector4(B.strength, B.shoulder, B.vignette, 0) }, uGain: { value: new THREE.Vector4(1, 1, 1, 1) }, uLift: { value: new THREE.Vector4(0, 0, 0, 1) } });
  const small = () => new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const down = [], up = [];
  for (let i = 0; i < N; i++) { down.push(small()); if (i < N - 1) up.push(small()); }
  let sceneRT = null, W = 0, H = 0;
  function makeScene() {
    const rt = new THREE.WebGLRenderTarget(W, H, { samples, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    rt.isXRRenderTarget = true; rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.internalFormat = 'RGBA8'; // (see the note at the top)
    return rt;
  }
  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, cam);
  }
  const size = new THREE.Vector2();
  const api = {
    BLOOM: B, materials: [mBright, mDown, mUp, mFinal],
    /** Match the canvas (call after a resize or a pixel-ratio change). Allocates nothing until the first render. */
    setSize() {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(8, size.x | 0), h = Math.max(8, size.y | 0);
      if (w === W && h === H) return;
      W = w; H = h;
      sceneRT?.dispose(); sceneRT = null;
      for (let i = 0; i < N; i++) { const d = 4 << i; down[i].setSize(Math.max(2, Math.ceil(w / d)), Math.max(2, Math.ceil(h / d))); if (up[i]) up[i].setSize(down[i].width, down[i].height); }
    },
    /** Free the big buffer (Low: nothing of this runs). The small ones stay: they're a few hundred KB together. */
    release() { sceneRT?.dispose(); sceneRT = null; },
    /** Compile the four pass shaders (the loading screen's warm-up), so turning bloom on later never stalls a frame. */
    warm() {
      const tex = down[0].texture;
      mBright.uniforms.tMap.value = tex; pass(mBright, down[1]);
      mDown.uniforms.tMap.value = tex; pass(mDown, down[1]);
      mUp.uniforms.tMap.value = tex; mUp.uniforms.tAdd.value = tex; pass(mUp, down[1]);
      mFinal.uniforms.tMap.value = tex; mFinal.uniforms.tBloom.value = tex; pass(mFinal, down[1]);
      renderer.setRenderTarget(null);
    },
    render(scene, camera) {
      if (!W) api.setSize();
      sceneRT ||= makeScene();
      const K = FXL.bloom, G = FXL.grade, n = Math.max(2, Math.min(N, K.levels | 0)); // the look: numbers only (no shader changes)
      mBright.uniforms.uP.value.set(K.threshold, K.knee, K.bright, K.mask / (FXL.fx.solid > 0 ? FXL.fx.solid : 1));
      mFinal.uniforms.uP.value.set(K.strength, K.shoulder, K.vignette, 0);
      mFinal.uniforms.uGain.value.set(G.gain[0], G.gain[1], G.gain[2], G.sat);
      mFinal.uniforms.uLift.value.set(G.lift[0], G.lift[1], G.lift[2], G.contrast);
      const info = renderer.info, reset = info.autoReset; // count the whole frame (the F3 overlay's draw calls), not just the last pass
      info.autoReset = false; info.reset();
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      const auto = renderer.autoClear; renderer.autoClear = false; // (every pass covers its whole target)
      mBright.uniforms.tMap.value = sceneRT.texture; mBright.uniforms.uTexel.value.set(1 / W, 1 / H); pass(mBright, down[0]);
      for (let i = 1; i < n; i++) { mDown.uniforms.tMap.value = down[i - 1].texture; mDown.uniforms.uTexel.value.set(0.5 / down[i - 1].width, 0.5 / down[i - 1].height); pass(mDown, down[i]); }
      let src = down[n - 1];
      for (let i = n - 2; i >= 0; i--) {
        mUp.uniforms.tMap.value = src.texture; mUp.uniforms.tAdd.value = down[i].texture; mUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        pass(mUp, up[i]); src = up[i];
      }
      mFinal.uniforms.tMap.value = sceneRT.texture; mFinal.uniforms.tBloom.value = src.texture;
      pass(mFinal, null);
      renderer.autoClear = auto;
      info.autoReset = reset;
    },
  };
  return api;
}
