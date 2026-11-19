// The Controls screen (roadmap K2), from the Game Menu → Controls. Registered with the panel registry (Esc closes it).
//   Header: the Input device choice (Keyboard & Mouse | Controller; Controller only while a pad is connected) and a
//           live "Controller connected: …" line.
//   Tabs:   Keyboard & Mouse | Controller. Each starts with a device picture (#cu-pic-kbm / #cu-pic-pad), then every
//           control by group with its binding and a Rebind button.
//   Picture: inline SVG drawn from layout tables, one element per binding code ([data-k="KeyW"], "Mouse0", "A", "LB").
//           Hover presses it and a tooltip names its control(s); ★ marks bound keys; a click opens a popover (the
//           control or "Not bound", Edit); a second click (or Edit) lists the controls with a filter box, and choosing
//           one binds the key to it (main slot) through the same check / conflict prompt as Rebind. While the screen
//           is open, real key presses (and pad buttons, input.padHeld) light up in the picture and play ignores them.
//   Rebind: input.capture() takes the next key, click or chord (Esc cancels). shared/controls.js check() decides:
//           refused keys get a reason; a key that's taken asks Swap / Unbind / Cancel (assign 'swap' | 'unbind').
//   Reset to defaults per device. Every change saves to fb_controls (input.setBinding), which the account sync uploads.
import { ACTION, ACTIONS, DEFAULTS, GROUPS, PAD_BUTTONS, PAD_MODIFIERS, bindingLabel, canSwap, check, isAxisBinding, keyName, modOfCode, tokens } from '/shared/controls.js';
import { buttonGlyph, padLabel } from '/shared/gamepad.js';

export const DEVICE_NAMES = { kbm: 'Keyboard & Mouse', pad: 'Controller' };
// Why a binding is refused (check() errors), in plain words.
export const REFUSED = {
  fixed: 'Esc and Start always open the Game Menu: they can’t be rebound.',
  reserved: 'The browser keeps that key (closing or opening tabs, reload, full screen, dev tools).',
  kbmOnly: 'That control is keyboard & mouse only.',
  noAlt: 'The controller has one button per control.',
  axis: 'That needs a stick, the mouse or four keys, not a button (or the other way round).',
  chord: 'That key has its own control, so it can’t be part of a combo (and a combo key can’t have one of its own).',
  modifier: 'A modifier on its own can’t be a control: hold it with another key.',
  unknown: 'Unknown control.',
  notPad: 'Press a controller button (or Esc to cancel).',
  notKbm: 'Press a key or click (or Esc to cancel).',
};
const AXIS_DIRS = ['up', 'left', 'down', 'right'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The controls a device's tab lists, grouped (GROUPS order), with whether each slot can be rebound here.
export function controlRows(device) {
  return GROUPS.map(g => ({ group: g, actions: ACTIONS.filter(a => a.group === g && !(a.kbmOnly && device === 'pad')) })).filter(g => g.actions.length);
}
// Can this slot be rebound from the list? Not fixed actions, and an axis only where it runs on four keys (Move);
// the mouse, the wheel and the sticks stay as they are.
export function rebindable(device, action) {
  const a = ACTION[action];
  if (!a || a.fixed) return false;
  if (a.type === 'axis') return device === 'kbm' && isAxisBinding(DEFAULTS.kbm[action]?.[0]);
  return true;
}
// Is a captured binding made of this device's inputs?
const padToken = t => PAD_BUTTONS.includes(t) || PAD_MODIFIERS.includes(t);
export const fitsDevice = (device, b) => (device === 'pad' ? tokens(b).every(padToken) : !tokens(b).some(padToken));

// ---------- the device pictures ----------
// Keyboard rows, in key units: 'Code[:width[:height]]', '_w' a gap; a lone letter or digit means KeyX / DigitN.
const KB_ROWS = [
  [0, 0, 'Escape _1 F1 F2 F3 F4 _0.5 F5 F6 F7 F8 _0.5 F9 F10 F11 F12'],
  [0, 1.25, 'Backquote 1 2 3 4 5 6 7 8 9 0 Minus Equal Backspace:2'],
  [0, 2.25, 'Tab:1.5 Q W E R T Y U I O P BracketLeft BracketRight Backslash:1.5'],
  [0, 3.25, 'CapsLock:1.75 A S D F G H J K L Semicolon Quote Enter:2.25'],
  [0, 4.25, 'ShiftLeft:2.25 Z X C V B N M Comma Period Slash ShiftRight:2.75'],
  [0, 5.25, 'ControlLeft:1.25 MetaLeft:1.25 AltLeft:1.25 Space:6.25 AltRight:1.25 MetaRight:1.25 ContextMenu:1.25 ControlRight:1.25'],
  [15.25, 0, 'PrintScreen ScrollLock Pause'],
  [15.25, 1.25, 'Insert Home PageUp'],
  [15.25, 2.25, 'Delete End PageDown'],
  [16.25, 4.25, 'ArrowUp'],
  [15.25, 5.25, 'ArrowLeft ArrowDown ArrowRight'],
  [18.5, 1.25, 'NumLock NumpadDivide NumpadMultiply NumpadSubtract'],
  [18.5, 2.25, 'Numpad7 Numpad8 Numpad9 NumpadAdd:1:2'],
  [18.5, 3.25, 'Numpad4 Numpad5 Numpad6'],
  [18.5, 4.25, 'Numpad1 Numpad2 Numpad3 NumpadEnter:1:2'],
  [18.5, 5.25, 'Numpad0:2 NumpadDecimal'],
];
const KU = 40; // px per key unit
// The mouse, right of the keyboard (key units): the body is "Mouse" (camera look), the wheel strip "Wheel".
const MOUSE = [
  { k: 'Mouse', x: 23.25, y: 1.25, w: 3.5, h: 5, rx: 1.6, label: 'Mouse', ly: 5.6 },
  { k: 'Mouse0', x: 23.4, y: 1.4, w: 1.2, h: 1.9, rx: 0.5, label: 'L' },
  { k: 'Mouse2', x: 25.4, y: 1.4, w: 1.2, h: 1.9, rx: 0.5, label: 'R' },
  { k: 'Wheel', x: 24.72, y: 1.5, w: 0.56, h: 0.95, rx: 0.28, label: '⇕' },
  { k: 'Mouse1', x: 24.72, y: 2.6, w: 0.56, h: 0.6, rx: 0.2, label: 'M' },
  { k: 'Mouse3', x: 23.35, y: 3.8, w: 0.35, h: 0.6, rx: 0.15, label: '' },
  { k: 'Mouse4', x: 23.35, y: 4.5, w: 0.35, h: 0.6, rx: 0.15, label: '' },
].map(m => ({ ...m, x: m.x * KU, y: m.y * KU, w: m.w * KU, h: m.h * KU, rx: m.rx * KU, ly: m.ly && m.ly * KU }));
const KB_SHORT = { Backspace: '⌫', CapsLock: 'Caps', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Cmd', MetaRight: 'Cmd', ContextMenu: 'Menu', Space: '', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk',
  Pause: 'Pause', Insert: 'Ins', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn', NumLock: 'Num', NumpadDivide: '/', NumpadMultiply: '*',
  NumpadSubtract: '-', NumpadAdd: '+', NumpadEnter: 'Ent', NumpadDecimal: '.', Mouse3: 'Mouse 4 (back)', Mouse4: 'Mouse 5 (forward)' };
const kbCode = t => (/^[A-Z]$/.test(t) ? `Key${t}` : /^\d$/.test(t) ? `Digit${t}` : t);
export const KB_KEYS = KB_ROWS.flatMap(([x0, y, row]) => {
  let x = x0;
  return row.split(' ').flatMap(t => {
    if (t[0] === '_') { x += +t.slice(1); return []; }
    const [c, w = 1, h = 1] = t.split(':'), k = kbCode(c);
    const key = { k, x: x * KU, y: y * KU, w: w * KU, h: h * KU, rx: 6, label: KB_SHORT[k] ?? (/^Numpad\d$/.test(k) ? k.slice(6) : keyName(k)) };
    x += +w;
    return [key];
  });
});
// A generic controller (Xbox names), in SVG px. Sticks: the ring is the stick ("LS", move / look), the cap its click ("L3").
const FACE = { A: '#22c55e', B: '#ef4444', X: '#3b82f6', Y: '#eab308' };
export const PAD_KEYS = [
  { k: 'LT', x: 95, y: 6, w: 90, h: 32, rx: 12, label: 'LT' }, { k: 'RT', x: 415, y: 6, w: 90, h: 32, rx: 12, label: 'RT' },
  { k: 'LB', x: 85, y: 44, w: 120, h: 20, rx: 10, label: 'LB' }, { k: 'RB', x: 395, y: 44, w: 120, h: 20, rx: 10, label: 'RB' },
  { k: 'LS', cx: 170, cy: 135, r: 38, label: '' }, { k: 'L3', cx: 170, cy: 135, r: 22, label: 'L3' },
  { k: 'RS', cx: 370, cy: 212, r: 38, label: '' }, { k: 'R3', cx: 370, cy: 212, r: 22, label: 'R3' },
  { k: 'Up', x: 218, y: 168, w: 26, h: 30, rx: 5, label: '▲' }, { k: 'Down', x: 218, y: 224, w: 26, h: 30, rx: 5, label: '▼' },
  { k: 'Left', x: 188, y: 198, w: 30, h: 26, rx: 5, label: '◀' }, { k: 'Right', x: 244, y: 198, w: 30, h: 26, rx: 5, label: '▶' },
  { k: 'Y', cx: 430, cy: 98, r: 17, label: 'Y' }, { k: 'A', cx: 430, cy: 172, r: 17, label: 'A' },
  { k: 'X', cx: 393, cy: 135, r: 17, label: 'X' }, { k: 'B', cx: 467, cy: 135, r: 17, label: 'B' },
  { k: 'View', x: 246, y: 116, w: 46, h: 22, rx: 11, label: 'View' }, { k: 'Start', x: 308, y: 116, w: 46, h: 22, rx: 11, label: 'Start' },
  { k: 'Home', cx: 300, cy: 170, r: 14, label: '⌂' },
];
// A PlayStation pad (same button names underneath): d-pad top left, both sticks low in the middle, a touchpad.
const FACE_SONY = { A: '#60a5fa', B: '#f87171', X: '#f472b6', Y: '#34d399' };
export const PAD_KEYS_SONY = [
  { k: 'LT', x: 95, y: 6, w: 90, h: 32, rx: 12, label: 'L2' }, { k: 'RT', x: 415, y: 6, w: 90, h: 32, rx: 12, label: 'R2' },
  { k: 'LB', x: 85, y: 44, w: 120, h: 20, rx: 10, label: 'L1' }, { k: 'RB', x: 395, y: 44, w: 120, h: 20, rx: 10, label: 'R1' },
  { k: 'Up', x: 157, y: 98, w: 26, h: 30, rx: 5, label: '▲' }, { k: 'Down', x: 157, y: 154, w: 26, h: 30, rx: 5, label: '▼' },
  { k: 'Left', x: 127, y: 128, w: 30, h: 26, rx: 5, label: '◀' }, { k: 'Right', x: 183, y: 128, w: 30, h: 26, rx: 5, label: '▶' },
  { k: 'LS', cx: 228, cy: 212, r: 36, label: '' }, { k: 'L3', cx: 228, cy: 212, r: 21, label: 'L3' },
  { k: 'RS', cx: 372, cy: 212, r: 36, label: '' }, { k: 'R3', cx: 372, cy: 212, r: 21, label: 'R3' },
  { k: 'Y', cx: 430, cy: 98, r: 17, label: '△' }, { k: 'A', cx: 430, cy: 172, r: 17, label: '✕' },
  { k: 'X', cx: 393, cy: 135, r: 17, label: '□' }, { k: 'B', cx: 467, cy: 135, r: 17, label: '○' },
  { k: 'View', x: 196, y: 80, w: 44, h: 18, rx: 9, label: 'Share' }, { k: 'Start', x: 360, y: 80, w: 44, h: 18, rx: 9, label: 'Options' },
  { k: 'Home', cx: 300, cy: 178, r: 13, label: 'PS' },
];
const PAD_BODY = 'M150,70 C100,70 62,92 47,150 L20,262 C10,302 42,326 76,305 L150,252 L450,252 L524,305 C558,326 590,302 580,262 L553,150 C538,92 500,70 450,70 Z';
const PIC = {
  kbm: { keys: [...KB_KEYS, ...MOUSE], w: 26.9 * KU, h: 6.3 * KU, back: '' },
  pad: { keys: PAD_KEYS, face: FACE, w: 600, h: 330, back: `<path class="cu-body" d="${PAD_BODY}"/>` },
  padSony: { keys: PAD_KEYS_SONY, face: FACE_SONY, w: 600, h: 330, back: `<path class="cu-body" d="${PAD_BODY}"/><rect class="cu-touch" x="246" y="78" width="108" height="66" rx="10"/>` },
};
// Which controller picture: PlayStation for a Sony pad (detected or chosen), else Xbox (Nintendo pads too).
export const PAD_STYLES = { xbox: 'Xbox', sony: 'PlayStation' };
export const padStyle = family => (family === 'sony' ? 'sony' : 'xbox');
// A controller button's name in the tooltip and popover, in the picture's own names ('✕ button', 'L1', 'D-pad ↑').
export const padTitle = (k, family) => (['LS', 'RS', 'L3', 'R3'].includes(k) ? keyTitle(k)
  : k === 'Home' ? (family === 'sony' ? 'PS button' : 'Guide button')
  : ['A', 'B', 'X', 'Y'].includes(k) ? `${buttonGlyph(k, family)} button` : buttonGlyph(k, family));
const AXIS_DIR_NAMES = ['up', 'left', 'down', 'right'];
// A key's name in the picture's tooltip and popover.
export const keyTitle = k => ({ Mouse: 'Mouse (moving it)', Wheel: 'Mouse wheel', LS: 'Left stick', RS: 'Right stick', L3: 'Left stick click', R3: 'Right stick click', Home: 'Guide button', ...KB_SHORT, Space: 'Space', Backspace: 'Backspace', CapsLock: 'Caps Lock', NumpadEnter: 'Num Enter' })[k] || keyName(k);
// Every use of a key in a device's bindings: { action, slot, binding, dir (a four-key axis), chord (part of a combo) }.
// A modifier key stands for its modifier (ControlLeft: the Ctrl of Ctrl+click).
export function keyUses(bindings, device, code) {
  const mod = device === 'kbm' ? modOfCode(code) : null, out = [];
  for (const a of ACTIONS) (bindings[a.id] || []).forEach((b, slot) => {
    if (!b) return;
    const t = tokens(b), i = t.findIndex(x => x === code || (mod && x === mod));
    if (i >= 0) out.push({ action: a.id, slot, binding: b, dir: isAxisBinding(b) ? AXIS_DIR_NAMES[i] : null, chord: !isAxisBinding(b) && t.length > 1 });
  });
  return out;
}
const useText = (u, lab = bindingLabel) => `${ACTION[u.action].label}${u.dir ? ` (${u.dir})` : ''}${u.slot ? ' · alt' : ''}${u.chord ? ` · combo ${lab(u.binding)}` : ''}`;
// The controls a key can be given from the picture: one-key controls (not fixed, not the axes), on this device.
export const pickable = device => ACTIONS.filter(a => !a.fixed && a.type !== 'axis' && !(a.kbmOnly && device === 'pad'));

export function initControlsUi({ input, sfx, onChange = () => {}, id = 'controlsui' }) {
  const el = document.createElement('div');
  el.id = id; el.className = 'panel hidden'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Controls');
  el.dataset.nav = id; // (the controller drives it: public/focusnav.js)
  document.body.appendChild(el);
  let tab = input.device === 'pad' ? 'pad' : 'kbm', busy = null, msg = '', prompt = null, resetArmed = null, poll = null, padCount = 0;
  let restore = null, dflt = ''; // the Rebind button to put pad focus back on once a capture is over (focusnav's data-nav-default)
  let pop = null; // the picture's popover: { device, code, mode: 'info' | 'list', filter }
  const lit = new Set(), padLit = new Set(); // keys / pad buttons held now (live feedback)

  const pads = () => { try { return input.readPads() || []; } catch { return []; } };
  const padName = p => (p && p.id ? String(p.id).replace(/\s*\(.*$/, '') || p.id : 'controller');
  // Controller names follow the picture: Xbox (A, LB, RT) or PlayStation (✕, L1, R2); auto from the pad unless chosen.
  const fam = () => input.glyphs || 'xbox';
  const lab = (device, b) => (device === 'pad' ? padLabel(b, fam()) : bindingLabel(b));
  const title = (device, k) => (device === 'pad' ? padTitle(k, fam()) : keyTitle(k));
  function styleSwitch() {
    const pick = input.glyphPick || 'auto', s = padStyle(fam()), det = input.pad?.connected ? PAD_STYLES[padStyle(input.pad.family)] : null;
    const note = pick !== 'auto' ? `Chosen by you. <button data-glyph="auto" data-nav="cu-glyph-auto">Auto-detect${det ? ` (${det})` : ''}</button>`
      : det ? `Auto: ${det} controller detected.` : 'Auto: follows the controller you connect.';
    return `<div class="cu-style" role="radiogroup" aria-label="Controller buttons">${Object.entries(PAD_STYLES).map(([f, n]) => `<button role="radio" data-glyph="${f}" data-nav="cu-glyph-${f}" class="${s === f ? 'on' : ''}" aria-checked="${s === f}">${n}</button>`).join('')}<small>${note}</small></div>`;
  }

  function header() {
    const p = pads(), dev = input.device === 'pad' ? 'pad' : 'kbm';
    return `<div class="cu-top"><b>Controls</b><button class="cu-x" data-a="close" data-nav="cu-close">✕</button></div>
      <h4>Input device</h4>
      <div class="cu-dev" role="radiogroup">${['kbm', 'pad'].map(d => `<label class="cu-opt ${d === 'pad' && !p.length ? 'off' : ''}"><input type="radio" name="cu-dev" value="${d}" data-nav="cu-dev-${d}" ${dev === d ? 'checked' : ''} ${d === 'pad' && !p.length && dev !== 'pad' ? 'disabled' : ''}> ${DEVICE_NAMES[d]}</label>`).join('')}</div>
      <small class="cu-status" id="cu-status">${p.length ? `Controller connected: ${esc(padName(p[0]))}` : 'No controller connected (press a button on one to wake it).'}</small>
      <div class="cu-tabs" role="tablist">${['kbm', 'pad'].map(d => `<button role="tab" data-tab="${d}" data-nav="cu-tab-${d}" class="${tab === d ? 'on' : ''}" aria-selected="${tab === d}">${DEVICE_NAMES[d]}</button>`).join('')}</div>`;
  }
  function slotCell(device, a, slot) {
    const b = input.bindings(device)[a.id]?.[slot] ?? null, key = `${a.id}:${slot}`;
    const mine = busy && busy.key === key && busy.device === device;
    const can = rebindable(device, a.id) && !(device === 'pad' && !pads().length);
    const title = a.fixed ? 'Always this key' : !rebindable(device, a.id) ? 'Set by the device' : device === 'pad' && !pads().length ? 'Connect a controller to rebind it' : '';
    const isDef = restore && restore.device === device && restore.key === key && dflt === 'rb';
    return `<span class="cu-slot ${slot ? 'alt' : ''}"><span class="cu-b ${b ? '' : 'none'}" data-b="${esc(key)}">${mine ? esc(busy.text) : esc(lab(device, b))}</span>`
      + `<button class="cu-rb" data-rb="${esc(key)}" data-nav="cu-rb-${device}-${esc(key)}" ${isDef ? 'data-nav-default' : ''} ${can && !busy ? '' : 'disabled'} title="${esc(title)}">${mine ? 'Listening…' : slot ? 'Alt' : 'Rebind'}</button></span>`;
  }
  function picture(device) {
    const P = device === 'pad' ? PIC[padStyle(fam()) === 'sony' ? 'padSony' : 'pad'] : PIC[device], b = input.bindings(device), f = fam();
    const keys = P.keys.map(K => {
      const uses = keyUses(b, device, K.k), sel = pop && pop.device === device && pop.code === K.k;
      const label = f === 'nintendo' && device === 'pad' && /^(A|B|X|Y|LB|RB|LT|RT)$/.test(K.k) ? buttonGlyph(K.k, f) : K.label; // (a Switch pad: Xbox shape, its own letters)
      const fs = K.r ? Math.min(13, K.r * 0.8) : Math.min(13, K.h * 0.55, (K.w - 8) / Math.max(1, label.length * 0.62));
      const shape = K.r ? `<circle class="cu-kc" cx="${K.cx}" cy="${K.cy}" r="${K.r}"${P.face?.[K.k] ? ` style="stroke:${P.face[K.k]}"` : ''}/>`
        : `<rect class="cu-kc" x="${K.x + 2}" y="${K.y + 2}" width="${K.w - 4}" height="${K.h - 4}" rx="${K.rx}"/>`;
      const lx = K.r ? K.cx : K.x + K.w / 2, ly = K.r ? K.cy + 4.5 : K.ly ?? K.y + K.h / 2 + 4.5;
      const sx = K.r ? K.cx + K.r * 0.75 : K.x + K.w - 6, sy = K.r ? K.cy - K.r * 0.6 : K.y + 10;
      return `<g class="cu-k${uses.length ? ' bound' : ''}${sel ? ' sel' : ''}${lit.has(K.k) || padLit.has(K.k) ? ' lit' : ''}" data-k="${esc(K.k)}"><g class="cu-kin">${shape}`
        + (label ? `<text class="cu-kl" x="${lx}" y="${ly}" font-size="${fs.toFixed(1)}">${esc(label)}</text>` : '')
        + (uses.length ? `<text class="cu-star" x="${sx}" y="${sy}">★</text>` : '') + '</g></g>';
    }).join('');
    return `<svg viewBox="0 0 ${P.w} ${P.h}" role="img" aria-label="${DEVICE_NAMES[device]} picture">${P.back}${keys}</svg>
      <div class="cu-tip hidden" id="cu-tip-${device}" role="tooltip"></div>${pop && pop.device === device ? popover(device) : ''}`;
  }
  function popover(device) {
    const uses = keyUses(input.bindings(device), device, pop.code);
    const head = `<div class="cu-pop-h"><b>${esc(title(device, pop.code))}</b><button data-pop="close" data-nav="cu-pop-close">✕</button></div>`;
    if (pop.mode === 'list') return `<div class="cu-pop" id="cu-pop">${head}<input id="cu-filter" type="text" placeholder="Filter controls…" autocomplete="off" value="${esc(pop.filter || '')}" data-nav="cu-filter">
      <div class="cu-picks" id="cu-picks">${picks(device)}</div></div>`;
    return `<div class="cu-pop" id="cu-pop">${head}<div class="cu-pop-b">${uses.length ? uses.map(u => `<div>${esc(useText(u, x => lab(device, x)))}</div>`).join('') : '<div class="none">Not bound</div>'}</div>
      <button data-pop="edit" data-nav="cu-pop-edit">Edit</button></div>`;
  }
  function picks(device) {
    const q = (pop?.filter || '').trim().toLowerCase(), b = input.bindings(device);
    const list = pickable(device).filter(a => !q || a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q));
    return list.length ? list.map(a => `<button data-pick="${a.id}" data-nav="cu-pick-${a.id}">${esc(a.label)} <small>${esc(lab(device, b[a.id]?.[0] ?? null))}</small></button>`).join('')
      : '<div class="none">No control matches.</div>';
  }
  function list(device) {
    return controlRows(device).map(g => `<h4>${esc(g.group)}</h4>`
      + g.actions.map(a => `<div class="cu-row" data-action="${a.id}"><span class="cu-name">${esc(a.label)}${a.fixed ? ' <small>fixed</small>' : ''}</span>`
        + `<span class="cu-slots">${slotCell(device, a, 0)}${device === 'kbm' ? slotCell(device, a, 1) : ''}</span></div>`).join('')).join('');
  }
  function render() {
    const p = prompt;
    dflt = p ? 'prompt' : restore && !busy ? 'rb' : ''; // (while listening the Rebind button is disabled: no default yet)
    el.innerHTML = header()
      + ['kbm', 'pad'].map(d => `<section class="cu-tab ${tab === d ? '' : 'hidden'}" id="cu-tab-${d}" role="tabpanel">
        ${d === 'pad' ? styleSwitch() : ''}<div class="cu-pic" id="cu-pic-${d}" data-device="${d}">${picture(d)}</div>
        <div class="cu-msg ${msg ? '' : 'hidden'}" id="cu-msg-${d}" role="status">${esc(msg)}</div>
        ${p && p.device === d ? `<div class="cu-prompt" id="cu-prompt"><div><b>${esc(lab(p.device, p.binding))}</b> is already on ${p.conflicts.map(c => `<b>${esc(ACTION[c.action].label)}</b>`).join(', ')}.</div>
          ${p.swap ? '<button data-p="swap" data-nav="cu-p-swap" data-nav-default>Swap</button>' : ''}<button data-p="unbind" data-nav="cu-p-unbind"${p.swap ? '' : ' data-nav-default'}>Unbind ${p.conflicts.length > 1 ? 'them' : 'it'}</button><button data-p="cancel" data-nav="cu-p-cancel">Cancel</button></div>` : ''}
        <div class="cu-list">${list(d)}</div>
        <button class="cu-reset" data-reset="${d}" data-nav="cu-reset-${d}">${resetArmed === d ? `Sure? Reset ${DEVICE_NAMES[d]}` : `Reset ${DEVICE_NAMES[d]} to defaults`}</button>
      </section>`).join('');
    if (dflt === 'rb') restore = null; // (used once; the next render starts clean)
  }
  const say = t => { msg = t || ''; render(); if (pop?.mode === 'list') el.querySelector('#cu-filter')?.focus(); };
  const changed = () => { try { onChange(); } catch (e) { console.error(e); } };

  // Rebind one slot: capture, check, then save / refuse / ask.
  async function rebind(device, action, slot) {
    if (busy) return;
    const a = ACTION[action];
    prompt = null; resetArmed = null; pop = null; restore = { device, key: `${action}:${slot}` };
    let binding;
    if (a.type === 'axis') { // four keys, one per direction
      const keys = [];
      for (const dir of AXIS_DIRS) {
        busy = { device, key: `${action}:${slot}`, text: `Press ${dir}…` }; say('');
        const k = await input.capture(device);
        if (!k) { busy = null; return say('Cancelled.'); }
        if (k.includes('+')) { busy = null; return say('One key per direction.'); }
        keys.push(k);
      }
      binding = keys.join(',');
    } else {
      busy = { device, key: `${action}:${slot}`, text: device === 'pad' ? 'Press a button…' : 'Press a key…' }; say('');
      binding = await input.capture(device);
      if (!binding) { busy = null; return say('Cancelled.'); }
    }
    busy = null;
    if (!fitsDevice(device, binding)) return say(REFUSED[device === 'pad' ? 'notPad' : 'notKbm']);
    decide(device, action, slot, binding);
  }
  // A new binding for a slot (from Rebind or the picture): save it, refuse it with the reason, or ask about a taken key.
  function decide(device, action, slot, binding) {
    const a = ACTION[action], cur = input.bindings(device)[action]?.[slot] ?? null;
    if (binding === cur) return say(`${a.label} stays on ${lab(device, binding)}.`);
    const r = check(input.bindings(device), device, action, slot, binding);
    if (r.error) { sfx?.play?.('ui'); return say(`${lab(device, binding)}: ${REFUSED[r.error] || r.error}`); }
    if (r.conflicts.length) { prompt = { device, action, slot, binding, conflicts: r.conflicts, swap: canSwap(input.bindings(device), device, action, slot, binding) }; return say(''); }
    apply(device, action, slot, binding, 'unbind');
  }
  function apply(device, action, slot, binding, mode) {
    const r = input.setBinding(device, action, slot, binding, mode);
    prompt = null;
    if (r?.error) return say(REFUSED[r.error] || r.error);
    say(`${ACTION[action].label}: ${lab(device, binding)}.`);
    changed();
  }

  el.addEventListener('click', e => {
    const k = e.target.closest('[data-k]');
    if (k) { // the picture: first click the popover, the second (same key) the control list
      const device = k.closest('.cu-pic').dataset.device, code = k.dataset.k;
      pop = pop && pop.device === device && pop.code === code ? { ...pop, mode: 'list', filter: '' } : { device, code, mode: 'info' };
      prompt = null; resetArmed = null; sfx?.play?.('ui'); return say('');
    }
    const t = e.target.closest('button');
    if (!t) { if (pop && !e.target.closest('.cu-pop')) { pop = null; render(); } return; }
    if (t.dataset.pop) { pop = t.dataset.pop === 'edit' ? { ...pop, mode: 'list', filter: '' } : null; return say(''); }
    if (t.dataset.pick) return pickFor(t.dataset.pick);
    if (t.dataset.a === 'close') return close();
    if (t.dataset.glyph) { input.setGlyphs(t.dataset.glyph); pop = null; restore = null; sfx?.play?.('ui'); render(); changed(); return; }
    if (t.dataset.tab) { tab = t.dataset.tab; restore = null; prompt = null; resetArmed = null; pop = null; msg = ''; render(); return; }
    if (t.dataset.rb) { const [action, slot] = t.dataset.rb.split(':'); rebind(t.closest('section').id.slice(7), action, +slot); return; }
    if (t.dataset.p) {
      const p = prompt;
      if (!p || t.dataset.p === 'cancel') { prompt = null; return say('Cancelled.'); }
      if (t.dataset.p === 'swap' && !p.swap) return; // (no Swap offered: the other control can't take the old key)
      return apply(p.device, p.action, p.slot, p.binding, t.dataset.p);
    }
    if (t.dataset.reset) {
      const d = t.dataset.reset;
      if (resetArmed !== d) { resetArmed = d; return render(); }
      resetArmed = null; prompt = null; input.resetBindings(d); say(`${DEVICE_NAMES[d]} is back to the default controls.`); changed();
    }
  });
  // Bind the popover's key to a control (its main slot), through the same check and conflict prompt as Rebind.
  function pickFor(action) {
    const p = pop; pop = null;
    if (!p || !pickable(p.device).some(a => a.id === action)) return say('');
    decide(p.device, action, 0, p.code);
  }
  el.addEventListener('input', e => {
    if (e.target.id !== 'cu-filter' || !pop) return;
    pop.filter = e.target.value; el.querySelector('#cu-picks').innerHTML = picks(pop.device);
  });
  el.addEventListener('keydown', e => { // Enter in the filter box takes the first match
    if (e.target.id === 'cu-filter' && e.key === 'Enter') { const f = el.querySelector('#cu-picks [data-pick]'); if (f) pickFor(f.dataset.pick); }
  });
  // Hover: the tooltip names the key's control(s).
  el.addEventListener('pointerover', e => {
    const k = e.target.closest?.('[data-k]'), pic = k?.closest('.cu-pic'), tip = pic?.querySelector('.cu-tip');
    if (!tip) return;
    const uses = keyUses(input.bindings(pic.dataset.device), pic.dataset.device, k.dataset.k);
    const dv = pic.dataset.device;
    tip.innerHTML = `<b>${esc(title(dv, k.dataset.k))}</b>${uses.length ? uses.map(u => `<div>${esc(useText(u, x => lab(dv, x)))}</div>`).join('') : '<div class="none">Not bound</div>'}`;
    const r = k.getBoundingClientRect(), pr = pic.getBoundingClientRect();
    tip.style.left = `${r.left - pr.left + r.width / 2}px`; tip.style.top = `${r.top - pr.top - 4}px`;
    tip.classList.remove('hidden');
  });
  el.addEventListener('pointerout', e => {
    const k = e.target.closest?.('[data-k]');
    if (k && !k.contains(e.relatedTarget)) k.closest('.cu-pic')?.querySelector('.cu-tip')?.classList.add('hidden');
  });
  // Live feedback: held keys, mouse buttons, the wheel and pad buttons light up. While the screen is open the game
  // doesn't see key presses (Esc still closes it, or the popover first); typing fields (the filter box, chat) keep their keys.
  const paint = () => { for (const k of el.querySelectorAll('[data-k]')) k.classList.toggle('lit', lit.has(k.dataset.k) || padLit.has(k.dataset.k)); };
  const typing = t => !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  addEventListener('keydown', e => {
    if (!isOpen() || (typing(e.target) && !e.target.closest?.('#' + id))) return; // (chat outside the screen keeps its keys)
    if (e.code === 'Escape' && pop) { pop = null; render(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (typing(e.target)) return; // (the filter box keeps its keys)
    if (!lit.has(e.code)) { lit.add(e.code); paint(); }
    if (e.code !== 'Escape') e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', e => { if (lit.delete(e.code)) paint(); }, true);
  addEventListener('pointerdown', e => { if (isOpen() && e.pointerType === 'mouse') { lit.add(`Mouse${e.button}`); paint(); } }, true);
  addEventListener('pointerup', e => { if (lit.delete(`Mouse${e.button}`)) paint(); }, true);
  let wheelT = null;
  addEventListener('wheel', () => { if (!isOpen()) return; lit.add('Wheel'); paint(); clearTimeout(wheelT); wheelT = setTimeout(() => { lit.delete('Wheel'); paint(); }, 180); }, { passive: true });
  addEventListener('blur', () => { lit.clear(); paint(); });
  let raf = null;
  function padLoop() { // (input.padHeld comes with the gamepad reading, K1b; until then nothing lights)
    raf = null;
    if (!isOpen()) { padLit.clear(); return; }
    if (typeof input.padHeld === 'function') {
      let changed = false;
      for (const n of PAD_BUTTONS) { let on = false; try { on = !!input.padHeld(n); } catch {} if (on !== padLit.has(n)) { changed = true; on ? padLit.add(n) : padLit.delete(n); } }
      if (changed) paint();
    } else if (padLit.size) { padLit.clear(); paint(); }
    raf = requestAnimationFrame(padLoop);
  }

  el.addEventListener('change', e => {
    if (e.target.name !== 'cu-dev') return;
    const ok = input.setDevice(e.target.value);
    say(ok ? `Playing with: ${DEVICE_NAMES[e.target.value]}.` : 'Connect a controller first.');
    if (ok) changed();
  });
  const live = () => { const n = pads().length; if (n !== padCount && isOpen() && !busy) { padCount = n; render(); } }; // (the device line follows the pads)
  addEventListener('gamepadconnected', live);
  addEventListener('gamepaddisconnected', live);

  const isOpen = () => !el.classList.contains('hidden');
  function open() {
    tab = input.device === 'pad' ? 'pad' : 'kbm'; msg = ''; prompt = null; resetArmed = null; pop = null; padCount = pads().length; lit.clear(); padLit.clear(); restore = null;
    render(); el.classList.remove('hidden'); sfx?.play?.('ui');
    if (!raf) raf = requestAnimationFrame(padLoop);
    clearInterval(poll); poll = setInterval(() => (isOpen() ? live() : clearInterval(poll)), 500);
  }
  function close() { el.classList.add('hidden'); prompt = null; restore = null; pop = null; if (busy) input.cancelCapture?.(); busy = null; clearInterval(poll); }
  return { el, open, close, isOpen, render, refresh: () => { if (isOpen() && !busy) render(); }, get tab() { return tab; } };
}
