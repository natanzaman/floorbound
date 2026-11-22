// Graphics quality: the presets, the live settings every module reads (Q), and Auto (pure: test/quality.js checks it).
// Settings → Graphics: Low / Medium / High / Auto (saved as fb_settings.quality). main.js applies a preset with apply().
//  - pixelRatio: cap on devicePixelRatio · shadows: the sun's shadow map (off on Low) and its size
//  - fx: particle / effect density (hit sparks, shatters, auras' motes and trails, Floor 2/3 motes and dust)
//  - segs: telegraph and ring detail (circle segments) · auraGlow: an aura's ground glow
//  - fog: draw distance (fog distances are scaled by it; characters past the fog aren't drawn)
//  - animNear / animEvery: characters beyond animNear (m) animate every animEvery frames (off screen: every 6th);
//    past the (scaled) fog they leave the scene altogether (main.js animateEntity)
//  - antialias: needs a reload (it's fixed when the WebGL canvas is created)
//  - charDist: characters farther than this (m) from the camera aren't drawn (fewer draw calls), except bosses, your
//    party and anyone in the boss arena you're in (main.js keepDrawn); the film view uses the fog only
//  - charShadow: only characters this close (m) cast shadows (bosses always do)
//  - post: bloom + tone mapping (public/post.js). Off on Low. Switching it never recompiles a shader (the scene is drawn
//    with the same programs either way), so Auto stepping down to Low just stops the extra passes.
//  - trails: how many weapon trails can be alive at once (public/vfx.js; 0 = none) · fx3d: the 3D skill effects, impact
//    flashes and animation accents (off on Low: the flat rings and arcs only, as before)
export const LEVELS = ['low', 'medium', 'high'];
export const PRESETS = {
  low:    { pixelRatio: 1,   shadows: false, shadowSize: 512,  fx: 0.4, segs: 0.5, auraGlow: false, fog: 0.7,  animNear: 18, animEvery: 3, antialias: false, charDist: 70,  charShadow: 25, post: false, trails: 0, fx3d: false },
  medium: { pixelRatio: 1.5, shadows: true,  shadowSize: 1024, fx: 0.7, segs: 0.75, auraGlow: true, fog: 0.85, animNear: 30, animEvery: 2, antialias: false, charDist: 100, charShadow: 25, post: true,  trails: 5, fx3d: true },
  high:   { pixelRatio: 2,   shadows: true,  shadowSize: 1024, fx: 1,   segs: 1,   auraGlow: true,  fog: 1,    animNear: 55, animEvery: 2, antialias: true,  charDist: 140, charShadow: 25, post: true,  trails: 8, fx3d: true },
};
/** The live settings (mutated in place by apply / main.js; modules read Q.fx etc. every time they need them). */
export const Q = { level: 'high', ...PRESETS.high };
/** Switch preset. `over`: settings that override it (Auto keeps shadows off once it has turned them off). */
export function setLevel(level, over = null) { Object.assign(Q, PRESETS[level] || PRESETS.high, over, { level: PRESETS[level] ? level : 'high' }); return Q; }
/** Scale a count by the effect density (at least `min`). */
export const fxCount = (n, min = 1) => Math.max(min, Math.round(n * Q.fx));
/** Scale a circle's segment count by the detail level (at least 12). */
export const segs = n => Math.max(12, Math.round(n * Q.segs));

/** The level to start with: the saved choice, or for Auto the level Auto settled on last time (else High, Medium on touch). */
export function startLevel(setting, { touch = false, lastAuto = null } = {}) {
  if (LEVELS.includes(setting)) return setting;
  if (LEVELS.includes(lastAuto)) return lastAuto;
  return touch ? 'medium' : 'high';
}
/** Edge smoothing (MSAA) for the renderer, which is created once: on for High chosen outright, and for Auto only once
 *  an earlier session settled on High (fb_autoq). Auto's first visit starts on High without it, so stepping down early
 *  never leaves a slow machine paying for MSAA the rest of the session; the next load has it if High held. */
export function startAntialias(setting, { touch = false, lastAuto = null } = {}) {
  if (touch) return false;
  if (LEVELS.includes(setting)) return !!PRESETS[setting].antialias;
  return lastAuto === 'high';
}

// Auto: measure ~5 s of frames; step down when under `low` fps, step up when there's clear headroom (≥ `high` fps,
// i.e. the frame rate is at the display's cap) for two windows running. A level Auto stepped down from is off limits
// for a while (`ban`, doubling each time it fails again); after `maxFails` failures it's off limits for the session, so
// a borderline machine settles instead of flipping back and forth forever. Once Auto has turned shadows off (stepping
// down to a level without them) it keeps them off when it steps back up (`over()`): turning them on and off again
// recompiles every shader, a hitch each time.
export const AUTO = { window: 5000, low: 45, high: 57, upWindows: 2, ban: 30000, maxFails: 3, maxGap: 1500, settle: 1500 };
export class AutoQuality {
  constructor(level = 'high', o = {}) {
    this.o = { ...AUTO, ...o }; this.level = level;
    this.t0 = null; this.frames = 0; this.good = 0; this.ban = {}; this.banLen = {}; this.fails = {}; this.skipUntil = 0; this.lastFps = 0;
    this.windows = 0; this.noShadows = false;
  }
  /** Settings that override the preset (pass to setLevel / applyQuality with the level). */
  over() { return this.noShadows ? { shadows: false } : null; }
  /** Feed one frame: now (ms), the time since the previous frame (ms), and whether the tab is hidden. Returns a new
   *  level, or null to keep it. (A very slow machine still counts: only a hidden tab or a multi-second stall doesn't.) */
  frame(now, gapMs, hidden = false) {
    if (now < this.skipUntil) return null; // just changed: let it settle (shaders, a new pixel ratio)
    if (hidden || gapMs > this.o.maxGap) { this.t0 = null; return null; } // a hidden tab or a stall: don't count it
    if (this.t0 === null) { this.t0 = now; this.frames = 0; return null; }
    this.frames++;
    const span = now - this.t0;
    if (span < this.o.window) return null;
    const fps = (this.frames * 1000) / span;
    this.lastFps = fps; this.t0 = now; this.frames = 0; this.windows++;
    const i = LEVELS.indexOf(this.level);
    if (fps < this.o.low && i > 0) {
      const fails = this.fails[this.level] = (this.fails[this.level] || 0) + 1;
      const len = fails >= this.o.maxFails ? Infinity : (this.banLen[this.level] || this.o.ban / 2) * 2;
      this.banLen[this.level] = len; this.ban[this.level] = now + len;
      this.good = 0;
      const down = LEVELS[i - 1];
      if (PRESETS[this.level].shadows && !PRESETS[down].shadows) this.noShadows = true;
      return this.set(down, now);
    }
    if (fps >= this.o.high && i < LEVELS.length - 1) {
      const up = LEVELS[i + 1];
      if (++this.good >= this.o.upWindows && !(now < (this.ban[up] || 0))) { this.good = 0; return this.set(up, now); }
    } else this.good = 0;
    return null;
  }
  set(level, now) { this.level = level; this.skipUntil = now + this.o.settle; this.t0 = null; return level; }
}
