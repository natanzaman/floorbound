// Accessibility options: defaults, limits and validation (DOM-free, so node can test it: test/access.js).
// Stored under fb_controls.access (public/settings.js reads and writes it; the values show up flat on `settings`).
// To add an option: add it to ACCESS_DEFAULTS (a default that changes nothing), a range to RANGES if it is a number,
// a control in initSettingsPanel (public/settings.js), and read `settings.<key>` where it takes effect.
export const ACCESS_DEFAULTS = {
  sens: 1,            // mouse look speed (x)
  invertY: false,     // invert vertical look
  padSens: 1,         // stick look speed (x); stored here for the gamepad code (K1b) to read
  guardToggle: false, // guard: press to start, press again to stop (instead of hold)
  wheelToggle: false, // bot wheel: press V to open, press again (or Esc) to close (instead of hold)
  reduceMotion: false, // no camera shake, hit-stop or kill zoom
  uiScale: 1,         // size of panels, frames and chat (x)
  highContrast: false, // stronger HUD text and panels
  palette: 'off',     // telegraph colours: 'off' (the game's own) | 'deuter' (red-green) | 'trit' (blue-yellow); see palette.js
  telegraphSound: false, // a short distinct cue when a telegraph starts
  hideSelfBar: false, // no health / stamina bar over your own character (public/selfbar.js)
  noHurtFlash: false, // no red pulse on the screen edges when you're hit or low on health
};
export const ENUMS = { palette: ['off', 'deuter', 'trit'] }; // string options and their allowed values
export const RANGES = { sens: [0.3, 3], padSens: [0.3, 3], uiScale: [0.8, 1.5] };

// Any stored value in, a complete valid access object out: unknown keys dropped, wrong types and NaN back to the
// default, numbers clamped to their range.
export function normalizeAccess(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, d] of Object.entries(ACCESS_DEFAULTS)) {
    const v = src[k];
    if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
    else if (typeof d === 'string') out[k] = ENUMS[k].includes(v) ? v : d;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], v));
    else out[k] = d;
  }
  return out;
}

// Merge a change into the stored object (and validate the result).
export const mergeAccess = (stored, patch) => normalizeAccess({ ...(stored && typeof stored === 'object' ? stored : {}), ...patch });
