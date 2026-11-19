// The input layer (roadmap K): raw keyboard, mouse (and, from K1b, gamepad) events become actions from
// shared/controls.js, using the player's bindings. main.js and feature modules subscribe to actions, not keys.
//   on(action, fn)      fn({ down, repeat, source, event }) on press (and on release for hold actions); returns off()
//   held(action)        is it held now (polled actions: turning, revive)
//   armed(action)       are its chord modifiers held (Ctrl down for Ctrl+click: hover previews)
//   axis('move'|'look') { x, y } (move: x right, y forward)
//   label(action)       its main binding on the active device, for prompts ('E', 'Click', 'LB+X')
//   device              'kbm' | 'pad' | 'touch' (one device drives play; setDevice)
//   bindings(device)    the bindings in force; setBinding(device, action, slot, binding, mode) checks, swaps or unbinds, saves
//   capture()           the next key, click or chord as a binding (Esc: null); swallows everything meanwhile
//   readPads()          the connected pads (navigator.getGamepads(); tick() polls the first standard one)
//   frames              frames polled so far (tick() once per frame), for tests that hold a press for N frames
//   pad                 { connected, id, recognised, family }; glyphs / setGlyphs('auto'|'xbox'|'sony'|'nintendo')
//   onPad(fn)           fn(name, down) on every pad button edge, before actions (menus: return true to swallow it)
//   onDevice(fn)        fn(device) after the active device changes; stick('LS'|'RS') a stick after the deadzone
// The pad (K1b, shared/gamepad.js): polled every frame, buttons resolved against bindings('pad') with LB as the
// modifier, triggers with hysteresis, sticks with a deadzone; the camera stick takes sens / invertY from
// fb_controls.access. Under keyboard & mouse the pad keeps only Start (the Game Menu); a pad seen for the first time
// asks once whether to switch to it. A pad that goes away lets go of its holds and falls back to keyboard & mouse.
// Bound by KeyboardEvent.code, so Shift+1 is still 1 and other layouts keep the same physical keys. Typing fields
// (input, textarea, select, IME composition) swallow game keys; preventDefault only on keys that did something.
import { ACTION, merged, loadBindings, resolve, actionsOn, bindingHeld, bindingArmed, axisFromKeys, assign, diff, bindingLabel, modOfCode, isAxisBinding, tokens } from '/shared/controls.js';
import { readButtons, readSticks, padEdges, pressAction, lookFrom, glyphFamily, padLabel, GLYPH_FAMILIES } from '/shared/gamepad.js';

// fb_controls: the bindings (and, from K3, accessibility), versioned; follows the account (K2: public/controlsync.js).
// listen(fn): fn(c) after every set / replace (the account sync uploads changes).
const CONTROLS_KEY = 'fb_controls', CONTROLS_V = 1;
let accessCache = null; // fb_controls.access, read once per change (the camera stick reads it every frame)
const storeListeners = new Set();
export const controlsStore = {
  access() { return accessCache ||= { sens: 1, invertY: false, ...(this.get().access || {}) }; },
  get() { try { const c = JSON.parse(localStorage.getItem(CONTROLS_KEY) || 'null'); return c && typeof c === 'object' ? c : { v: CONTROLS_V }; } catch { return { v: CONTROLS_V }; } },
  set(patch) { return this.replace({ ...this.get(), ...patch }); },
  replace(c) { accessCache = null; c = { ...c, v: CONTROLS_V }; try { localStorage.setItem(CONTROLS_KEY, JSON.stringify(c)); } catch {} for (const fn of storeListeners) fn(c); return c; },
  listen(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn); },
};

const KBM_ALWAYS = ['menu', 'chat', 'perfOverlay'];
export const isTyping = el => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// gate(action): may this action fire now (main.js: joined, the Game Menu not open, ...)
// notify(text): a short message (a toast). ask(text, answer): a yes / no prompt, answer(bool); returns close().
export function createInput({ isTouch = false, gate = () => true, settings = {}, save = () => {}, notify = () => {}, ask = null } = {}) {
  const stored = controlsStore.get();
  const B = { kbm: loadBindings('kbm', stored.kbm), pad: loadBindings('pad', stored.pad) };
  const held = new Set();     // key codes, 'Mouse<n>', and 'Ctrl' 'Shift' 'Alt' 'Meta' while down
  const active = new Map();   // code -> action it pressed (released with that code)
  const subs = new Map();     // action -> Set(fn)
  const ctx = new Set();      // contexts on ('downedAlly')
  let device = isTouch ? 'touch' : 'kbm';
  if (settings.device === 'pad') settings.device = 'kbm'; // (no pad is connected at load: never start locked to one)
  let capturing = null;
  // the pad: the one being read (index, id), its buttons down now, the hold actions they pressed, its sticks
  const pad = { index: -1, id: null, recognised: true, family: 'xbox', held: new Set(), active: new Map(), sticks: { LS: { x: 0, y: 0 }, RS: { x: 0, y: 0 } } };
  const padSubs = new Set(), deviceSubs = new Set();
  let pendingAsk = null; // the "Controller detected" prompt's answer(), while it's up (A: yes, B: no)

  const fire = (action, ev) => { for (const fn of subs.get(action) || []) fn(ev); };
  const setMods = e => { for (const [m, on] of [['Ctrl', e.ctrlKey], ['Shift', e.shiftKey], ['Alt', e.altKey], ['Meta', e.metaKey]]) on ? held.add(m) : held.delete(m); };
  const kb = () => B.kbm;

  function press(code, e, source) {
    const hit = resolve(kb(), held, { code }, ctx, 'kbm');
    if (!hit || !gate(hit.action)) return null;
    if (device === 'pad' && !KBM_ALWAYS.includes(hit.action)) return null; // one device drives play (the keyboard keeps Esc, chat, F3)
    if (ACTION[hit.action].type === 'hold') active.set(code, hit.action);
    fire(hit.action, { down: true, repeat: !!e.repeat, source, event: e });
    return hit;
  }
  function release(code, e, source, always) {
    const a = active.get(code);
    active.delete(code);
    const ups = new Set(a ? [a] : []);
    if (always) for (const o of actionsOn(kb(), code)) if (ACTION[o.action]?.type === 'hold' && !ACTION[o.action].context) ups.add(o.action);
    for (const u of ups) fire(u, { down: false, repeat: false, source, event: e });
  }

  // rebinding: capture swallows every key first (window, capture phase), Esc cancels
  addEventListener('keydown', e => { if (capturing) captureKey(e); }, true);
  addEventListener('keyup', e => { if (capturing) captureKeyUp(e); }, true);
  addEventListener('keydown', e => {
    if (capturing) return;
    setMods(e);
    // typing fields keep their keys (function keys still work: they type nothing)
    if ((isTyping(e.target) || e.isComposing || e.keyCode === 229) && !/^F\d+$/.test(e.code)) return;
    held.add(e.code);
    if (press(e.code, e, 'kbm')) e.preventDefault();
  });
  addEventListener('keyup', e => {
    if (capturing) return;
    setMods(e);
    held.delete(e.code);
    release(e.code, e, 'kbm', true); // (a released key always lets go of its hold actions, as before)
  });
  addEventListener('pointerup', e => {
    if (e.pointerType !== 'mouse') return;
    const code = `Mouse${e.button}`;
    held.delete(code);
    if (active.has(code)) release(code, e, 'kbm', false);
  });
  addEventListener('blur', () => reset());
  // Keys and mouse let go quietly (callers clear their own holds); pad holds fire their up (the bot wheel closes) and
  // the pad buttons still down stay down (no new press when they come back up).
  function reset() { held.clear(); active.clear(); releasePad(); }

  // Mouse buttons on the game view: main.js asks what a click would do (peek), then lets it happen (mouseDown).
  const mouseCode = e => `Mouse${e.button}`;
  function peek(e) { setMods(e); const h = new Set(held); h.add(mouseCode(e)); return resolve(kb(), h, { code: mouseCode(e) }, ctx, 'kbm'); }
  function mouseDown(e) { setMods(e); held.add(mouseCode(e)); return press(mouseCode(e), e, 'kbm'); }

  // ---- reading ----
  const dev = () => (device === 'pad' ? 'pad' : 'kbm');
  function suppressed(action, b, d) { // a context action that's on takes its keys from the others (E: revive, not turn)
    if (ACTION[action].context) return false;
    return tokens(b).some(t => actionsOn(B[d], t, d).some(o => ACTION[o.action]?.context && ctx.has(ACTION[o.action].context)));
  }
  function heldNow(action) {
    const a = ACTION[action];
    if (!a) return false;
    const d = dev(), h = d === 'pad' ? pad.held : held;
    return (B[d][action] || []).some(b => b && (isAxisBinding(b) ? tokens(b).some(k => h.has(k)) : bindingHeld(b, h)) && !suppressed(action, b, d) && (!a.context || ctx.has(a.context)));
  }
  const stick = name => pad.sticks[name] || { x: 0, y: 0 };
  function axis(name) {
    if (device === 'pad') { // the stick bound to it (move: y forward; look: sensitivity and invert-Y, y up)
      const s = stick(B.pad[name]?.[0]);
      return name === 'look' ? lookFrom(s, controlsStore.access()) : { x: s.x, y: -s.y };
    }
    const v = { x: 0, y: 0 };
    if (name === 'move') for (const b of kb().move || []) { const a = axisFromKeys(b, held); v.x += a.x; v.y += a.y; }
    return v; // (the mouse turns the camera through its own events)
  }

  // ---- capture (rebinding): the next key / click / chord ----
  let capKeys = [], capMods = new Set(), capDone = null;
  function capture() {
    if (capturing) capturing(null);
    return new Promise(res => {
      capKeys = []; capMods = new Set(); capLB = false;
      capturing = b => { capturing = null; removeEventListener('pointerdown', capturePointer, true); res(b); };
      capDone = b => capturing?.(b);
      addEventListener('pointerdown', capturePointer, true);
    });
  }
  const modPrefix = () => ['Ctrl', 'Shift', 'Alt', 'Meta'].filter(m => capMods.has(m)).map(m => `${m}+`).join('');
  function captureKey(e) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') return capDone(null);
    const mod = modOfCode(e.code);
    if (mod) { capMods.add(mod); return; }
    if (capKeys.length) return capDone(`${modPrefix()}${capKeys[0]}+${e.code}`); // a second key: a two-key chord
    capKeys.push(e.code);
    if (e.metaKey) { capMods.add('Meta'); return capDone(`${modPrefix()}${e.code}`); } // (macOS sends no keyup while Cmd is held: done on the press)
  }
  function captureKeyUp(e) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (capKeys.length) return capDone(`${modPrefix()}${capKeys[0]}`);
    const mod = modOfCode(e.code);
    if (mod && capMods.has(mod)) return capDone(capMods.size === 1 ? e.code : `${modPrefix().slice(0, -1)}`); // a lone modifier key
  }
  function capturePointer(e) {
    if (e.pointerType !== 'mouse') return;
    e.preventDefault(); e.stopImmediatePropagation();
    setMods(e); for (const m of ['Ctrl', 'Shift', 'Alt', 'Meta']) if (held.has(m)) capMods.add(m);
    capDone(`${modPrefix()}Mouse${e.button}`);
  }
  // a pad button (on its press; LB is only a modifier: LB+X, or a lone LB on release, which check() refuses); Start cancels
  let capLB = false;
  function capturePad(name, down) {
    if (name === 'LB') { if (down) capLB = true; else if (capLB) capDone('LB'); return; }
    if (!down) return;
    if (name === 'Start') return capDone(null);
    capDone(pad.held.has('LB') ? `LB+${name}` : name);
  }

  // ---- devices ----
  function readPads() {
    let list = [];
    try { list = [...(navigator.getGamepads?.() || [])]; } catch {}
    return list.filter(p => p && p.connected !== false);
  }
  function releasePad() {
    const ups = [...new Set(pad.active.values())];
    pad.active.clear();
    for (const a of ups) fire(a, { down: false, repeat: false, source: 'pad', event: null });
  }
  function setDevice(d) {
    if (d === device) return true;
    if (d === 'pad' && !readPads().length) return false; // Controller only while one is connected
    for (const [code] of active) release(code, null, device, false); // let go of every hold
    releasePad();
    device = d; settings.device = d === 'touch' ? undefined : d; save();
    for (const fn of deviceSubs) fn(d);
    return true;
  }
  function padFound(gp) {
    if (pad.index !== -1) releasePad(); // (the active pad left and another took over: let go of its holds)
    pad.index = gp.index; pad.id = gp.id; pad.recognised = gp.mapping === 'standard'; pad.family = glyphFamily(gp.id);
    pad.held = readButtons(gp); // (buttons already down, the press that woke it: no edge, so it can't answer the prompt below)
    if (!pad.recognised) notify('Controller not recognised: its buttons are read by position. Rebind them in Controls if they feel wrong.');
    if (device === 'pad' || settings.padAsked) return;
    settings.padAsked = true; save(); // (asked once; the Controls screen switches later)
    let close = () => {};
    const answer = yes => { if (pendingAsk !== answer) return; pendingAsk = null; close?.(); if (yes && setDevice('pad')) notify('Controller on: Start opens the Game Menu.'); };
    pendingAsk = answer;
    close = ask ? ask('Controller detected. Switch to it?', answer) : (notify('Controller detected: choose it in the Game Menu → Controls.'), pendingAsk = null, () => {});
  }
  function padLost() {
    releasePad();
    pad.index = -1; pad.id = null; pad.held = new Set(); pad.sticks = { LS: { x: 0, y: 0 }, RS: { x: 0, y: 0 } };
    pendingAsk = null;
    if (device !== 'pad') return;
    setDevice(isTouch ? 'touch' : 'kbm'); notify('Controller disconnected: back to keyboard & mouse.');
  }
  function padEdge(name, down) {
    if (capturing) return capturePad(name, down);
    if (down && pendingAsk && (name === 'A' || name === 'B')) return pendingAsk(name === 'A');
    if (!down) { const a = pad.active.get(name); pad.active.delete(name); if (a) fire(a, { down: false, repeat: false, source: 'pad', event: null }); }
    for (const fn of padSubs) if (fn(name, down) === true) return; // menus (focus navigation) first
    if (!down) return;
    const hit = pressAction(B.pad, pad.held, name, ctx);
    if (!hit || !gate(hit.action)) return;
    if (device !== 'pad' && hit.action !== 'menu') return; // one device drives play (Start always opens the menu)
    if (ACTION[hit.action].type === 'hold') pad.active.set(name, hit.action);
    fire(hit.action, { down: true, repeat: false, source: 'pad', event: null });
  }
  function poll() {
    const pads = readPads();
    const gp = pads.find(p => p.index === pad.index && p.id === pad.id) || pads.find(p => p.mapping === 'standard') || pads[0] || null;
    if (!gp) { if (pad.index !== -1) padLost(); return; }
    if (gp.index !== pad.index || gp.id !== pad.id) padFound(gp);
    const now = readButtons(gp, pad.held);
    pad.sticks = readSticks(gp);
    const edges = padEdges(pad.held, now);
    pad.held = now;
    for (const e of edges) padEdge(e.name, e.down);
  }
  addEventListener('gamepadconnected', () => poll());
  addEventListener('gamepaddisconnected', () => { if (!readPads().length) padLost(); });
  const glyphs = () => (GLYPH_FAMILIES.includes(settings.padGlyphs) ? settings.padGlyphs : pad.family);

  const api = {
    on(action, fn) { if (!subs.has(action)) subs.set(action, new Set()); subs.get(action).add(fn); return () => subs.get(action).delete(fn); },
    held: heldNow,
    armed: action => (kb()[action] || []).some(b => bindingArmed(b, held)),
    axis,
    label: action => (device === 'pad' ? padLabel(B.pad[action]?.[0] || null, glyphs()) : bindingLabel(kb()[action]?.[0] || kb()[action]?.[1] || null)),
    get device() { return device; },
    setDevice,
    bindings: (d = 'kbm') => B[d],
    setBinding(d, action, slot, binding, mode = 'unbind') {
      const r = assign(B[d], d, action, slot, binding, mode);
      if (r.result.error) return r.result;
      B[d] = r.bindings;
      controlsStore.set({ [d]: diff(d, B[d]) });
      return r.result;
    },
    resetBindings(d) { B[d] = merged(d, {}); controlsStore.set({ [d]: {} }); },
    reload() { // (K2: the account's copy replaced fb_controls) let go of every hold, then take the saved bindings
      for (const [code] of active) release(code, null, device, false);
      const c = controlsStore.get(); B.kbm = loadBindings('kbm', c.kbm); B.pad = loadBindings('pad', c.pad);
    },
    setContext(name, on) { on ? ctx.add(name) : ctx.delete(name); },
    capture, readPads, peek, mouseDown, reset,
    cancelCapture() { capturing?.(null); }, // (K2: the Controls screen closed mid-rebind)
    frames: 0,
    tick() { api.frames++; poll(); },
    get pad() { return { connected: pad.index !== -1, id: pad.id, recognised: pad.recognised, family: pad.family }; },
    get glyphs() { return glyphs(); },
    get glyphPick() { return GLYPH_FAMILIES.includes(settings.padGlyphs) ? settings.padGlyphs : 'auto'; }, // (the Controls screen's Xbox / PlayStation choice)
    setGlyphs(f) { settings.padGlyphs = GLYPH_FAMILIES.includes(f) ? f : undefined; save(); },
    onPad(fn) { padSubs.add(fn); return () => padSubs.delete(fn); },
    onDevice(fn) { deviceSubs.add(fn); return () => deviceSubs.delete(fn); },
    padHeld: name => pad.held.has(name),
    stick,
    get capturing() { return !!capturing; },
    key: code => held.has(code), // a physical key (the old key set's shim)
  };
  return api;
}
