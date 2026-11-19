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
//   readPads()          the connected standard pads (K1b; none yet)
//   frames              frames polled so far (tick() once per frame), for tests that hold a press for N frames
// Bound by KeyboardEvent.code, so Shift+1 is still 1 and other layouts keep the same physical keys. Typing fields
// (input, textarea, select, IME composition) swallow game keys; preventDefault only on keys that did something.
import { ACTION, merged, resolve, actionsOn, bindingHeld, bindingArmed, axisFromKeys, assign, diff, bindingLabel, modOfCode, isAxisBinding, tokens } from '/shared/controls.js';

// fb_controls: the bindings (and, from K3, accessibility), versioned; synced to the account later (K2).
const CONTROLS_KEY = 'fb_controls', CONTROLS_V = 1;
export const controlsStore = {
  get() { try { const c = JSON.parse(localStorage.getItem(CONTROLS_KEY) || 'null'); return c && typeof c === 'object' ? c : { v: CONTROLS_V }; } catch { return { v: CONTROLS_V }; } },
  set(patch) { const c = { ...this.get(), ...patch, v: CONTROLS_V }; try { localStorage.setItem(CONTROLS_KEY, JSON.stringify(c)); } catch {} return c; },
};

const KBM_ALWAYS = ['menu', 'chat', 'perfOverlay'];
export const isTyping = el => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// gate(action): may this action fire now (main.js: joined, the Game Menu not open, ...)
export function createInput({ isTouch = false, gate = () => true, settings = {}, save = () => {}, notify = () => {} } = {}) {
  const stored = controlsStore.get();
  const B = { kbm: merged('kbm', stored.kbm), pad: merged('pad', stored.pad) };
  const held = new Set();     // key codes, 'Mouse<n>', and 'Ctrl' 'Shift' 'Alt' 'Meta' while down
  const active = new Map();   // code -> action it pressed (released with that code)
  const subs = new Map();     // action -> Set(fn)
  const ctx = new Set();      // contexts on ('downedAlly')
  let device = isTouch ? 'touch' : 'kbm';
  if (settings.device === 'pad') settings.device = 'kbm'; // (no pad is connected at load: never start locked to one)
  let capturing = null;

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
  function reset() { held.clear(); active.clear(); } // (quietly: callers clear their own holds)

  // Mouse buttons on the game view: main.js asks what a click would do (peek), then lets it happen (mouseDown).
  const mouseCode = e => `Mouse${e.button}`;
  function peek(e) { setMods(e); const h = new Set(held); h.add(mouseCode(e)); return resolve(kb(), h, { code: mouseCode(e) }, ctx, 'kbm'); }
  function mouseDown(e) { setMods(e); held.add(mouseCode(e)); return press(mouseCode(e), e, 'kbm'); }

  // ---- reading ----
  function suppressed(action, b) { // a context action that's on takes its keys from the others (E: revive, not turn)
    if (ACTION[action].context) return false;
    return tokens(b).some(t => actionsOn(kb(), t).some(o => ACTION[o.action]?.context && ctx.has(ACTION[o.action].context)));
  }
  function heldNow(action) {
    const a = ACTION[action];
    if (!a || device === 'pad') return false; // (pad holds: K1b)
    return (kb()[action] || []).some(b => b && (isAxisBinding(b) ? tokens(b).some(k => held.has(k)) : bindingHeld(b, held)) && !suppressed(action, b) && (!a.context || ctx.has(a.context)));
  }
  function axis(name) {
    const v = { x: 0, y: 0 };
    if (name === 'move' && device !== 'pad') for (const b of kb().move || []) { const a = axisFromKeys(b, held); v.x += a.x; v.y += a.y; }
    return v; // (sticks: K1b; the mouse turns the camera through its own events)
  }

  // ---- capture (rebinding): the next key / click / chord ----
  let capKeys = [], capMods = new Set(), capDone = null;
  function capture() {
    if (capturing) capturing(null);
    return new Promise(res => {
      capKeys = []; capMods = new Set();
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

  // ---- devices ----
  function readPads() { return []; } // K1b: navigator.getGamepads(), standard mapping
  const devSubs = new Set(); // onDevice(fn): called after every device switch (holds already released)
  function setDevice(d) {
    if (d === device) return true;
    if (d === 'pad' && !readPads().length) return false; // Controller only while one is connected
    for (const [code] of active) release(code, null, device, false); // let go of every hold
    device = d; settings.device = d === 'touch' ? undefined : d; save();
    for (const fn of devSubs) fn(d);
    return true;
  }
  addEventListener('gamepaddisconnected', () => {
    if (device !== 'pad' || readPads().length) return;
    setDevice(isTouch ? 'touch' : 'kbm'); notify('Controller disconnected: back to keyboard & mouse.');
  });

  const api = {
    on(action, fn) { if (!subs.has(action)) subs.set(action, new Set()); subs.get(action).add(fn); return () => subs.get(action).delete(fn); },
    held: heldNow,
    armed: action => (kb()[action] || []).some(b => bindingArmed(b, held)),
    axis,
    label: action => { const d = device === 'pad' ? 'pad' : 'kbm'; return bindingLabel(B[d][action]?.[0] || B[d][action]?.[1] || null); },
    get device() { return device; },
    setDevice,
    onDevice(fn) { devSubs.add(fn); return () => devSubs.delete(fn); },
    bindings: (d = 'kbm') => B[d],
    setBinding(d, action, slot, binding, mode = 'unbind') {
      const r = assign(B[d], d, action, slot, binding, mode);
      if (r.result.error) return r.result;
      B[d] = r.bindings;
      controlsStore.set({ [d]: diff(d, B[d]) });
      return r.result;
    },
    resetBindings(d) { B[d] = merged(d, {}); controlsStore.set({ [d]: {} }); },
    setContext(name, on) { on ? ctx.add(name) : ctx.delete(name); },
    capture, readPads, peek, mouseDown, reset,
    frames: 0,
    tick() { api.frames++; readPads(); },
    get capturing() { return !!capturing; },
    key: code => held.has(code), // a physical key (the old key set's shim)
  };
  return api;
}
