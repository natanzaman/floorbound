// Gamepad reading (roadmap K1b): the DOM-free parts, so node tests can check them. public/input.js polls
// navigator.getGamepads() every frame and runs each pad through these.
//   readButtons(gp, prev)   the button names held now (standard indices -> PAD_BUTTONS; triggers with hysteresis)
//   readSticks(gp)          { LS, RS }: { x, y } after the deadzone (Gamepad convention: x right, y down)
//   padEdges(prev, now)     [{ name, down }]: what went down or up since the last frame
//   pressAction(...)        the action a button press triggers (LB is the modifier and never triggers on its own)
//   lookFrom(stick, access) the camera stick with sensitivity (padSens, else sens) and invert-Y (y up)
//   glyphFamily(id)         'sony' | 'nintendo' | 'xbox', from the pad's id string; padLabel(binding, family)
// A pad whose mapping isn't 'standard' is read the same way, by raw index (index i -> PAD_BUTTONS[i]), so it can be
// rebound button by button; input.js flags it as not recognised.
import { PAD_BUTTONS, PAD_MODIFIERS, resolve } from './controls.js';

export const DEADZONE = 0.2;                 // sticks: radial, rescaled so just past it is ~0
export const TRIGGER_ON = 0.5, TRIGGER_OFF = 0.3; // triggers press past ON and let go under OFF (no flicker in between)
const TRIGGERS = ['LT', 'RT'];

// A radial deadzone, rescaled so the output runs 0..1 from the edge of the zone to the rim.
export function deadzone(x, y, dz = DEADZONE) {
  x = +x || 0; y = +y || 0;
  const m = Math.hypot(x, y);
  if (!(m > dz)) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k };
}

// Trigger hysteresis: was it down last frame, and its analogue value now.
export const trigger = (was, value, on = TRIGGER_ON, off = TRIGGER_OFF) => (was ? value > off : value >= on);

// One button's value: Gamepad buttons are { pressed, value } (very old browsers: a number).
const bval = b => (typeof b === 'number' ? b : b ? (typeof b.value === 'number' && b.value > 0 ? b.value : b.pressed ? 1 : 0) : 0);
const bpressed = b => (typeof b === 'number' ? b > 0.5 : !!b?.pressed);

export function readButtons(gp, prev = new Set()) {
  const now = new Set();
  (gp?.buttons || []).forEach((b, i) => {
    const name = PAD_BUTTONS[i] || `B${i}`;
    if (TRIGGERS.includes(name) ? trigger(prev.has(name), bval(b)) : bpressed(b)) now.add(name);
  });
  return now;
}

export function readSticks(gp, dz = DEADZONE) {
  const a = gp?.axes || [];
  return { LS: deadzone(a[0], a[1], dz), RS: deadzone(a[2], a[3], dz) };
}

export function padEdges(prev, now) {
  const out = [];
  for (const n of prev) if (!now.has(n)) out.push({ name: n, down: false });
  for (const n of now) if (!prev.has(n)) out.push({ name: n, down: true });
  return out;
}

// held: the buttons down now (the pressed one included). LB+X beats X while LB is held.
export function pressAction(bindings, held, name, ctx = new Set()) {
  if (PAD_MODIFIERS.includes(name)) return null;
  return resolve(bindings, held, { code: name }, ctx, 'pad');
}

// The camera stick: x right, y up (stick pushed up = look up, like moving the mouse up), unless invert-Y.
// Sensitivity: access.padSens (the controller's own, K3) when set, else the shared access.sens.
const posNum = v => v != null && v !== '' && Number.isFinite(+v) && +v > 0;
export function lookFrom(s, access = {}) {
  const sens = posNum(access.padSens) ? +access.padSens : posNum(access.sens) ? +access.sens : 1;
  return { x: s.x * sens, y: -s.y * sens * (access.invertY ? -1 : 1) };
}

// ---------- glyphs ----------
export const GLYPH_FAMILIES = ['xbox', 'sony', 'nintendo'];
export function glyphFamily(id = '') {
  const s = String(id).toLowerCase();
  if (/054c|sony|playstation|dualshock|dualsense|ps[345]\b/.test(s)) return 'sony';
  if (/057e|nintendo|switch|joy-con|pro controller/.test(s)) return 'nintendo';
  return 'xbox';
}
// By position: the bottom face button is 'A' (Xbox A, PlayStation ✕, Nintendo B).
export const GLYPHS = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', View: 'View', Start: 'Menu', L3: 'LS', R3: 'RS', Home: 'Xbox' },
  sony: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', View: 'Share', Start: 'Options', L3: 'L3', R3: 'R3', Home: 'PS' },
  nintendo: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', View: '−', Start: '+', L3: 'LS', R3: 'RS', Home: 'Home' },
};
const PAD_NAMES = { LS: 'Left stick', RS: 'Right stick', Up: 'D-pad ↑', Down: 'D-pad ↓', Left: 'D-pad ←', Right: 'D-pad →' };
export const buttonGlyph = (name, family = 'xbox') => (GLYPHS[family] || GLYPHS.xbox)[name] || PAD_NAMES[name] || name;
export const padLabel = (b, family = 'xbox') => (b ? b.split('+').map(t => buttonGlyph(t, family)).join('+') : 'Not bound');
