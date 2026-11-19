// Controls: every game action, its default bindings per device, and the rules for binding (roadmap K contract).
// DOM-free so node tests can check it; public/input.js turns raw events into these actions.
//
// A binding is a string:
//   a key by its KeyboardEvent.code ('KeyW', 'Digit1', 'ShiftLeft', 'Space', 'F3'), a mouse button ('Mouse0' left,
//   'Mouse1' middle, 'Mouse2' right), the mouse itself ('Mouse') or its wheel ('Wheel'); a pad button by its standard
//   name ('A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right') or a
//   stick ('LS', 'RS').
//   A chord joins tokens with '+': modifiers first ('Ctrl+Mouse0', 'Ctrl+Shift+KeyZ'), or two keys ('KeyZ+KeyX'); on the
//   pad only LB is a modifier ('LB+X').
//   An axis on keys lists four keys, up,left,down,right ('KeyW,KeyA,KeyS,KeyD').
// Bindings for one device: { [actionId]: [main, alt] } (null = unbound). The alt slot is keyboard & mouse only.

export const DEVICES = ['kbm', 'pad'];
export const GROUPS = ['Move', 'Camera', 'Combat', 'Target', 'World', 'Items', 'Menus', 'Keyboard & mouse'];

// type: button (fires on press) · hold (press and release) · axis (read every frame) · toggle (press flips it)
// context: the action only applies (and outranks the others on its key) while the game says that context is on.
// kbmOnly: no controller binding. fixed: can't be rebound.
export const ACTIONS = [
  { id: 'move', label: 'Move', group: 'Move', type: 'axis' },
  { id: 'look', label: 'Camera', group: 'Camera', type: 'axis' },
  { id: 'attack', label: 'Attack', group: 'Combat', type: 'hold' },
  { id: 'skill1', label: 'Skill 1', group: 'Combat', type: 'button' },
  { id: 'skill2', label: 'Skill 2', group: 'Combat', type: 'button' },
  { id: 'skill3', label: 'Skill 3', group: 'Combat', type: 'button' },
  { id: 'dodge', label: 'Dodge', group: 'Combat', type: 'button' },
  { id: 'jump', label: 'Jump', group: 'Combat', type: 'button' },
  { id: 'guard', label: 'Guard / parry (Guardian)', group: 'Combat', type: 'hold' },
  { id: 'cover', label: 'Cover an ally (Guardian)', group: 'Combat', type: 'button' },
  { id: 'teamBurst', label: 'Team Burst', group: 'Combat', type: 'button' },
  { id: 'lockNext', label: 'Lock on / next target', group: 'Target', type: 'button' },
  { id: 'selectAimed', label: 'Select what you aim at', group: 'Target', type: 'button' },
  { id: 'clearTarget', label: 'Clear target', group: 'Target', type: 'button' },
  { id: 'interact', label: 'Interact', group: 'World', type: 'button' },
  { id: 'revive', label: 'Revive (hold, next to a downed ally)', group: 'World', type: 'hold', context: 'downedAlly' },
  { id: 'item1', label: 'Potion', group: 'Items', type: 'button' },
  { id: 'item2', label: 'Tonic', group: 'Items', type: 'button' },
  { id: 'item3', label: 'Draught', group: 'Items', type: 'button' },
  { id: 'bag', label: 'Bag', group: 'Menus', type: 'button' },
  { id: 'skillTree', label: 'Skill Tree', group: 'Menus', type: 'button' },
  { id: 'players', label: 'Players', group: 'Menus', type: 'button' },
  { id: 'botWheel', label: 'Bot orders wheel', group: 'Menus', type: 'hold' },
  { id: 'menu', label: 'Game Menu', group: 'Menus', type: 'button', fixed: true },
  { id: 'chat', label: 'Chat', group: 'Keyboard & mouse', type: 'button', kbmOnly: true },
  { id: 'perfOverlay', label: 'Performance overlay', group: 'Keyboard & mouse', type: 'button', kbmOnly: true },
  { id: 'turnLeft', label: 'Turn left', group: 'Keyboard & mouse', type: 'hold', kbmOnly: true },
  { id: 'turnRight', label: 'Turn right', group: 'Keyboard & mouse', type: 'hold', kbmOnly: true },
  { id: 'zoom', label: 'Zoom', group: 'Keyboard & mouse', type: 'axis', kbmOnly: true },
];
export const ACTION = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

// Defaults: keyboard & mouse = the keys the game has always used; the controller per the K contract (Xbox names).
export const DEFAULTS = {
  kbm: {
    move: ['KeyW,KeyA,KeyS,KeyD', 'ArrowUp,ArrowLeft,ArrowDown,ArrowRight'],
    look: ['Mouse', null],
    attack: ['Mouse0', 'KeyJ'],
    skill1: ['Digit1', null], skill2: ['Digit2', null], skill3: ['Digit3', null],
    dodge: ['ShiftLeft', 'ShiftRight'],
    jump: ['Space', null],
    guard: ['KeyR', null],
    cover: ['KeyC', null],
    teamBurst: ['KeyT', null],
    lockNext: ['Tab', null],
    selectAimed: ['Ctrl+Mouse0', 'Meta+Mouse0'], // (Cmd on a Mac)
    clearTarget: ['Ctrl+Mouse2', 'Meta+Mouse2'],
    interact: ['KeyF', null],
    revive: ['KeyE', null],
    item1: ['Digit4', null], item2: ['Digit5', null], item3: ['Digit6', null],
    bag: ['KeyB', 'KeyI'],
    skillTree: ['KeyK', null],
    players: ['KeyP', null],
    botWheel: ['KeyV', null],
    menu: ['Escape', null],
    chat: ['Enter', null],
    perfOverlay: ['F3', null],
    turnLeft: ['KeyQ', null],
    turnRight: ['KeyE', null],
    zoom: ['Wheel', null],
  },
  pad: {
    move: ['LS', null], look: ['RS', null],
    attack: ['RT', null], dodge: ['RB', null], guard: ['LT', null],
    jump: ['A', null], cover: ['LB+A', null],
    skill1: ['X', null], teamBurst: ['LB+X', null],
    skill2: ['Y', null], botWheel: ['LB+Y', null],
    skill3: ['B', null], selectAimed: ['LB+B', null],
    lockNext: ['R3', null], clearTarget: ['LB+R3', null],
    item1: ['Up', null], item2: ['Left', null], item3: ['Right', null],
    skillTree: ['LB+Up', null], players: ['LB+Right', null],
    interact: ['Down', null], revive: ['Down', null], // (Down: interact; held next to a downed ally: revive)
    bag: ['View', null],
    menu: ['Start', null],
  },
};

// Standard-mapping pad buttons, by index (Gamepad API 'standard' layout).
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'Home'];
export const PAD_MODIFIERS = ['LB'];
export const MODIFIERS = ['Ctrl', 'Shift', 'Alt', 'Meta'];
const MOD_CODES = { Ctrl: ['ControlLeft', 'ControlRight'], Shift: ['ShiftLeft', 'ShiftRight'], Alt: ['AltLeft', 'AltRight'], Meta: ['MetaLeft', 'MetaRight'] };
export const modOfCode = code => MODIFIERS.find(m => MOD_CODES[m].includes(code)) || null;

// Keys the browser or the OS keeps (closing / opening tabs and windows, reload, full screen, dev tools).
export const RESERVED = ['Ctrl+KeyW', 'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+Shift+KeyW', 'Ctrl+Shift+KeyT', 'Ctrl+Shift+KeyN', 'Ctrl+Tab', 'Meta+KeyQ', 'Meta+KeyW', 'F5', 'F11', 'F12', 'Alt+F4'];
export const FIXED_KEYS = { kbm: ['Escape'], pad: ['Start'] }; // the Game Menu's, always

// ---------- parsing ----------
export const isAxisBinding = b => typeof b === 'string' && b.includes(',');
export const tokens = b => (b ? (isAxisBinding(b) ? b.split(',') : b.split('+')) : []);
const isMod = (t, device) => (device === 'pad' ? PAD_MODIFIERS.includes(t) : MODIFIERS.includes(t));
// Canonical form: modifiers first in a fixed order, then the keys in the order given.
export function normalize(b, device = 'kbm') {
  if (!b || isAxisBinding(b)) return b || null;
  const t = b.split('+');
  const mods = (device === 'pad' ? PAD_MODIFIERS : MODIFIERS).filter(m => t.includes(m));
  return [...mods, ...t.filter(x => !isMod(x, device))].join('+');
}
// The physical keys a binding uses (a modifier stands for both of its keys).
function physical(b, device) {
  return tokens(b).flatMap(t => (device === 'kbm' && MOD_CODES[t] ? MOD_CODES[t] : [t]));
}
const isChord = b => !!b && !isAxisBinding(b) && b.includes('+');

// ---------- resolving ----------
// Is a token held? held: a Set of codes / button names, plus 'Ctrl' 'Shift' 'Alt' 'Meta' while those are down.
const tokHeld = (t, held) => held.has(t) || (MOD_CODES[t] ? MOD_CODES[t].some(c => held.has(c)) : false);

// Which action does this press trigger? event: { code } (a key code, 'Mouse0', a pad button name).
// A binding matches when the code is one of its keys (a modifier never triggers) and the rest are held. The most
// specific match wins (Ctrl+click beats click; LB+X beats X), and an action whose context is on beats one without.
// Axis bindings never trigger presses. ctx: the contexts that are on (Set). Returns { action, slot, binding } or null.
export function resolve(bindings, held, event, ctx = new Set(), device = 'kbm') {
  let best = null, bestScore = -1;
  for (const [id, slots] of Object.entries(bindings || {})) {
    const a = ACTION[id];
    if (!a || a.type === 'axis') continue;
    if (a.context && !ctx.has(a.context)) continue;
    (slots || []).forEach((b, slot) => {
      if (!b || isAxisBinding(b)) return;
      const t = b.split('+');
      if (!t.includes(event.code) || isMod(event.code, device) && t.length > 1) return;
      if (!t.every(x => x === event.code || tokHeld(x, held))) return;
      const score = t.length * 2 + (a.context ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = { action: id, slot, binding: b }; }
    });
  }
  return best;
}

// Every action a code could take part in (any slot), for releases and the "is it bound" check.
export function actionsOn(bindings, code, device = 'kbm') {
  const out = [];
  for (const [id, slots] of Object.entries(bindings || {})) (slots || []).forEach((b, slot) => { if (b && physical(b, device).includes(code) || tokens(b).includes(code)) out.push({ action: id, slot, binding: b }); });
  return out;
}

// Is a binding fully held right now?
export const bindingHeld = (b, held) => !!b && !isAxisBinding(b) && b.split('+').every(t => tokHeld(t, held));
// Are all but its trigger held (Ctrl down for Ctrl+click)? Used for hover previews.
export const bindingArmed = (b, held, device = 'kbm') => isChord(b) && b.split('+').filter(t => isMod(t, device)).every(t => tokHeld(t, held));

// An axis binding's value from held keys: { x: right - left, y: up - down }.
export function axisFromKeys(b, held) {
  if (!isAxisBinding(b)) return { x: 0, y: 0 };
  const [u, l, d, r] = b.split(','), h = k => (k && held.has(k) ? 1 : 0);
  return { x: h(r) - h(l), y: h(u) - h(d) };
}

// ---------- checking a new binding ----------
// May `binding` go into `action`'s `slot` on `device`? Returns { ok, error?, conflicts: [{ action, slot }] }.
//   error: 'fixed' (the action or the key can't change) · 'reserved' (the browser keeps it) · 'kbmOnly' · 'noAlt'
//          (the pad has one slot) · 'axis' (an axis needs an axis binding, and only an axis takes one) ·
//          'chord' (a chord member has its own action, or a key with an action would become one; pad chords are LB+one) ·
//          'modifier' (a lone modifier: LB on the pad)
//   conflicts: other actions already on that key, to swap or unbind (context actions share keys freely).
export function check(bindings, device, action, slot, binding) {
  const a = ACTION[action], res = (error, conflicts = []) => ({ ok: !error && !conflicts.length, error: error || null, conflicts });
  if (!a) return res('unknown');
  if (a.fixed) return res('fixed');
  if (a.kbmOnly && device === 'pad') return res('kbmOnly');
  if (device === 'pad' && slot > 0) return res('noAlt');
  if (binding === null) return res(null);
  const b = normalize(binding, device);
  if (a.type === 'axis' ? !(isAxisBinding(b) || ['Mouse', 'Wheel', 'LS', 'RS'].includes(b)) : isAxisBinding(b) || ['Mouse', 'Wheel', 'LS', 'RS'].includes(b)) return res('axis');
  if (FIXED_KEYS[device].some(k => tokens(b).includes(k))) return res('fixed');
  if (device === 'kbm' && RESERVED.includes(b)) return res('reserved');
  const t = tokens(b);
  if (!isAxisBinding(b) && t.every(x => isMod(x, device))) { if (device === 'pad' || t.length > 1) return res('modifier'); }
  if (device === 'pad' && isChord(b) && (t.length !== 2 || t[0] !== 'LB' || isMod(t[1], 'pad'))) return res('chord');
  // chords without timing windows: a chord's held members can't have a press action of their own, and a key that is
  // held as part of a chord can't get one
  const others = Object.entries(bindings || {}).filter(([id]) => id !== action);
  const single = new Set(), members = new Set();
  for (const [id, slots] of others) for (const ob of slots || []) {
    if (!ob || isAxisBinding(ob) || ACTION[id]?.type === 'axis') continue;
    if (isChord(ob)) for (const m of ob.split('+').slice(0, -1)) physical(m, device).forEach(c => members.add(c));
    else physical(ob, device).forEach(c => single.add(c));
  }
  if (isChord(b) && t.slice(0, -1).some(m => physical(m, device).some(c => single.has(c)))) return res('chord');
  if (!isChord(b) && !isAxisBinding(b) && physical(b, device).some(c => members.has(c))) return res('chord');
  // conflicts: the same binding, or a key inside another action's axis keys (and the other way round)
  const conflicts = [];
  for (const [id, slots] of others) (slots || []).forEach((ob, s) => {
    if (!ob) return;
    if (a.context || ACTION[id]?.context) return; // context actions overlay others (revive on E)
    const o = normalize(ob, device);
    const clash = o === b || (isAxisBinding(o) && !isChord(b) && tokens(o).includes(b)) || (isAxisBinding(b) && !isChord(o) && tokens(b).includes(o))
      || (isAxisBinding(o) && isAxisBinding(b) && tokens(o).some(k => tokens(b).includes(k)));
    if (clash) conflicts.push({ action: id, slot: s });
  });
  return res(null, conflicts);
}

// Put a binding in place, resolving conflicts: 'swap' gives the other action this slot's old binding, 'unbind' clears
// it. Returns { bindings, result } (bindings unchanged when the check refuses it).
export function assign(bindings, device, action, slot, binding, mode = 'unbind') {
  const result = check(bindings, device, action, slot, binding);
  if (result.error) return { bindings, result };
  const next = Object.fromEntries(Object.entries(bindings).map(([k, v]) => [k, [...(v || [null, null])]]));
  const old = next[action]?.[slot] ?? null;
  for (const c of result.conflicts) next[c.action][c.slot] = mode === 'swap' ? old : null;
  (next[action] ||= [null, null])[slot] = binding === null ? null : normalize(binding, device);
  return { bindings: next, result };
}

// The bindings in force: defaults, with the player's changes on top (unknown ids dropped; a saved null unbinds).
export function merged(device, overrides = {}) {
  const out = Object.fromEntries(Object.entries(DEFAULTS[device]).map(([k, v]) => [k, [...v]]));
  for (const [id, slots] of Object.entries(overrides || {})) {
    if (!ACTION[id] || ACTION[id].fixed || !Array.isArray(slots)) continue;
    if (ACTION[id].kbmOnly && device === 'pad') continue;
    out[id] = [slots[0] ?? null, device === 'pad' ? null : slots[1] ?? null];
  }
  return out;
}
// The other way: only what differs from the defaults (what gets saved).
export function diff(device, bindings) {
  const out = {};
  for (const [id, slots] of Object.entries(bindings)) {
    const d = DEFAULTS[device][id] || [null, null];
    if ((slots[0] ?? null) !== (d[0] ?? null) || (slots[1] ?? null) !== (d[1] ?? null)) out[id] = [slots[0] ?? null, slots[1] ?? null];
  }
  return out;
}

// Every problem in a whole set of bindings (for tests and for loading saved ones): [{ action, slot, error | conflicts }].
export function validate(bindings, device) {
  const out = [];
  for (const [id, slots] of Object.entries(bindings)) (slots || []).forEach((b, slot) => {
    if (!b) return;
    if (ACTION[id]?.fixed) { if (!FIXED_KEYS[device].includes(b)) out.push({ action: id, slot, error: 'fixed' }); return; }
    const r = check(bindings, device, id, slot, b);
    if (!r.ok) out.push({ action: id, slot, error: r.error, conflicts: r.conflicts });
  });
  return out;
}

// ---------- labels ----------
const KEY_NAMES = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'Caps Lock',
  ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Alt', AltRight: 'Right Alt',
  MetaLeft: 'Cmd', MetaRight: 'Right Cmd', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Mouse0: 'Click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  Mouse: 'Mouse', Wheel: 'Wheel', Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Cmd',
  LS: 'Left stick', RS: 'Right stick', Up: 'D-pad ↑', Down: 'D-pad ↓', Left: 'D-pad ←', Right: 'D-pad →',
};
export function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}
const AXIS_NAMES = { 'KeyW,KeyA,KeyS,KeyD': 'WASD', 'ArrowUp,ArrowLeft,ArrowDown,ArrowRight': 'Arrows' };
export function bindingLabel(b) {
  if (!b) return 'Not bound';
  if (isAxisBinding(b)) return AXIS_NAMES[b] || b.split(',').map(keyName).join(' ');
  return b.split('+').map(keyName).join('+');
}
