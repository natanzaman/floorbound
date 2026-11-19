// Graphics quality: the presets, the live settings every module reads (Q), and Auto (pure: test/quality.js checks it).
// Settings → Graphics: Low / Medium / High / Auto (saved as fb_settings.quality). main.js applies a preset with apply().
//  - pixelRatio: cap on devicePixelRatio · shadows: the sun's shadow map (off on Low) and its size
//  - fx: particle / effect density (hit sparks, shatters, auras' motes and trails, Floor 2/3 motes and dust)
//  - segs: telegraph and ring detail (circle segments) · auraGlow: an aura's ground glow
//  - fog: draw distance (fog distances are scaled by it; characters past the fog aren't drawn)
//  - animNear / animEvery: characters beyond animNear (m) animate every animEvery frames (off screen: every 6th);
//    past the (scaled) fog they leave the scene altogether (main.js animateEntity)
//  - antialias: needs a reload (it's fixed when the WebGL canvas is created)
export const LEVELS = ['low', 'medium', 'high'];
export const PRESETS = {
  low:    { pixelRatio: 1,   shadows: false, shadowSize: 512,  fx: 0.4, segs: 0.5, auraGlow: false, fog: 0.7,  animNear: 18, animEvery: 3, antialias: false },
  medium: { pixelRatio: 1.5, shadows: true,  shadowSize: 1024, fx: 0.7, segs: 0.75, auraGlow: true, fog: 0.85, animNear: 30, animEvery: 2, antialias: false },
  high:   { pixelRatio: 2,   shadows: true,  shadowSize: 1024, fx: 1,   segs: 1,   auraGlow: true,  fog: 1,    animNear: 55, animEvery: 2, antialias: true },
};
/** The live settings (mutated in place by apply / main.js; modules read Q.fx etc. every time they need them). */
export const Q = { level: 'high', ...PRESETS.high };
export function setLevel(level) { Object.assign(Q, PRESETS[level] || PRESETS.high, { level: PRESETS[level] ? level : 'high' }); return Q; }
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

// Auto: measure ~5 s of frames; step down when under `low` fps, step up when there's clear headroom (≥ `high` fps,
// i.e. the frame rate is at the display's cap) for two windows running. A level Auto stepped down from is off limits
// for a while (`ban`, doubling each time it fails again), so it never flips back and forth.
export const AUTO = { window: 5000, low: 45, high: 57, upWindows: 2, ban: 30000, maxGap: 1500, settle: 1500 };
export class AutoQuality {
  constructor(level = 'high', o = {}) {
    this.o = { ...AUTO, ...o }; this.level = level;
    this.t0 = null; this.frames = 0; this.good = 0; this.ban = {}; this.banLen = {}; this.skipUntil = 0; this.lastFps = 0;
  }
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
    this.lastFps = fps; this.t0 = now; this.frames = 0;
    const i = LEVELS.indexOf(this.level);
    if (fps < this.o.low && i > 0) {
      const len = Math.min(8 * this.o.ban, (this.banLen[this.level] || this.o.ban / 2) * 2);
      this.banLen[this.level] = len; this.ban[this.level] = now + len;
      this.good = 0;
      return this.set(LEVELS[i - 1], now);
    }
    if (fps >= this.o.high && i < LEVELS.length - 1) {
      const up = LEVELS[i + 1];
      if (++this.good >= this.o.upWindows && !(now < (this.ban[up] || 0))) { this.good = 0; return this.set(up, now); }
    } else this.good = 0;
    return null;
  }
  set(level, now) { this.level = level; this.skipUntil = now + this.o.settle; this.t0 = null; return level; }
}
