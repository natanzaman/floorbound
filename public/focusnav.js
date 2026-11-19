// Menu focus navigation for the controller (roadmap K1b): spatial navigation over the window on top.
//   createFocusNav({ input, panels, order, hooks })
//     order   where to look, first match wins: element ids, '*' = panels.top(). Only roots marked data-nav are driven
//             (the v1 windows); the others (Smith, Hall, Players) stay mouse-only and the pad plays on under them.
//     hooks   { id: { back, open } }: back() for B (default: a [data-nav=back] button inside, else panels.close(id));
//             open() lets B go back to the window that opened this one with A (Game Menu → Settings → B).
//   tick(now)   once a frame after input.tick(): repeats a held d-pad / left stick, keeps the focus on a live element
//   active()    is a window being driven now (Controller, an element focused); main.js stops the left stick moving you
//   current()   { layer, key } for tests
// D-pad / left stick: move (held: repeat after a delay); A: click; B: back; Left / Right on a slider or a dropdown
// changes it. Each item's key is its data-nav, else built from its id, data-* attributes, name / value or text, so
// the focus comes back to the same button after a window re-renders or reopens.
// The DOM-free parts (picking the nearest element in a direction, stick direction, repeat timing) are exported for
// node tests (test/focusnav.js), so this file imports nothing.

export const REPEAT_DELAY = 400, REPEAT_RATE = 140, STICK_ON = 0.5; // ms; stick tilt that counts as a direction
const DIRS = { Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };
export const NAV_DIRS = Object.keys(DIRS);

// rects: { x, y, w, h } (screen pixels, y down). From cur (null: none yet), the nearest candidate in dir, or null.
// Distance along the direction (edge to edge) plus twice the sideways gap, so a button straight below beats a
// nearer one off to the side; reading order (top, then left) breaks ties and picks the first one with no cur.
export function pickNext(cur, cands, dir) {
  if (!cands.length) return null;
  const ord = (a, b) => a.y - b.y || a.x - b.x;
  if (!cur) return [...cands].sort(ord)[0];
  const [dx, dy] = DIRS[dir] || [0, 0];
  if (!dx && !dy) return null;
  const cx = r => r.x + r.w / 2, cy = r => r.y + r.h / 2;
  const gap = (a0, a1, b0, b1) => Math.max(0, b0 - a1, a0 - b1); // between two ranges (0: they overlap)
  let best = null, bestS = Infinity;
  for (const c of cands) {
    if (c === cur) continue;
    const along = dx ? (cx(c) - cx(cur)) * dx : (cy(c) - cy(cur)) * dy; // centre to centre, in the direction
    if (along <= 1) continue;
    const edge = dx ? Math.max(0, dx > 0 ? c.x - (cur.x + cur.w) : cur.x - (c.x + c.w)) : Math.max(0, dy > 0 ? c.y - (cur.y + cur.h) : cur.y - (c.y + c.h));
    const side = dx ? gap(cur.y, cur.y + cur.h, c.y, c.y + c.h) : gap(cur.x, cur.x + cur.w, c.x, c.x + c.w);
    const off = dx ? Math.abs(cy(c) - cy(cur)) : Math.abs(cx(c) - cx(cur));
    const s = edge + 2 * side + 0.01 * off + 0.001 * along;
    if (s < bestS) { bestS = s; best = c; }
  }
  return best;
}

// A stick ({ x, y }, Gamepad convention: y down) as a direction, by its larger axis past STICK_ON; else null.
export function stickDir(s, on = STICK_ON) {
  const x = s?.x || 0, y = s?.y || 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < on) return null;
  return Math.abs(x) >= Math.abs(y) ? (x > 0 ? 'Right' : 'Left') : (y > 0 ? 'Down' : 'Up');
}

// Held-direction repeat: r = { dir, next } carried between frames. True when it should move now: at once on a new
// direction, then after delay, then every rate while it stays held.
export function repeatStep(r, dir, now, delay = REPEAT_DELAY, rate = REPEAT_RATE) {
  if (dir !== r.dir) { r.dir = dir; r.next = now + delay; return !!dir; }
  if (dir && now >= r.next) { r.next = now + rate; return true; }
  return false;
}

// ---------- the DOM side ----------
const ITEMS = 'button, a[href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [data-nav]';
const ATTR_SKIP = new Set(['nav', 'tu']); // (data-tu: the bag's tooltip hook, on rows)

export function navKey(el) {
  if (el.dataset?.nav) return el.dataset.nav;
  if (el.id) return `#${el.id}`;
  const data = Object.entries(el.dataset || {}).filter(([k]) => !ATTR_SKIP.has(k)).map(([k, v]) => `${k}=${v}`).sort().join('&');
  if (data) return `${el.tagName}?${data}`;
  if (el.name) return `${el.tagName}:${el.name}=${el.value ?? ''}`;
  return `${el.tagName}"${(el.textContent || el.getAttribute?.('aria-label') || '').trim().slice(0, 40)}`;
}

export function createFocusNav({ input, panels, order = ['*'], hooks = {} }) {
  const memory = new Map(); // layer id -> the key focused last
  const parent = new Map(); // layer id -> the layer whose A opened it
  let layer = null, el = null, pendingFrom = null;
  const dpad = { dir: null, next: 0 }, stick = { dir: null, next: 0 };

  const shown = e => !!e && e.isConnected && !e.classList.contains('hidden') && e.getClientRects().length > 0;
  function rootOf(id) {
    const e = id === '*' ? (panels.top() && document.getElementById(panels.top())) : document.getElementById(id);
    return shown(e) ? e : null;
  }
  function top() { // { id, root } of the window to drive, or null (also when the top one is mouse-only)
    for (const o of order) {
      const r = rootOf(o);
      if (!r) continue;
      return r.hasAttribute('data-nav') ? { id: r.id, root: r } : null;
    }
    return null;
  }
  const usable = e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const items = root => [...root.querySelectorAll(ITEMS)].filter(usable);
  const rect = e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, e }; };

  function setFocus(next) {
    if (el && el !== next) el.classList.remove('nav-focus');
    el = next;
    if (!el) return;
    el.classList.add('nav-focus');
    if (layer) memory.set(layer.id, navKey(el));
    try { el.focus({ preventScroll: true }); } catch {}
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function clear() { el?.classList.remove('nav-focus'); el = null; layer = null; }
  function sync() { // the right window, and a live element in it (restored by key after a re-render or reopening)
    const t = input.device === 'pad' ? top() : null;
    if (!t) { if (layer || el) clear(); return null; }
    if (!layer || layer.id !== t.id || layer.root !== t.root) {
      if (pendingFrom && pendingFrom !== t.id && !rootOf(pendingFrom)) parent.set(t.id, pendingFrom); // A here opened it
      pendingFrom = null;
      el?.classList.remove('nav-focus'); el = null; layer = t;
      // a direction already held (LB+D-pad ↑ opened the Skill Tree) does nothing here until it's let go
      dpad.dir = NAV_DIRS.find(n => input.padHeld(n)) || null; stick.dir = stickDir(input.stick('LS')); dpad.next = stick.next = Infinity;
    }
    if (el && el.isConnected && t.root.contains(el) && usable(el)) return t;
    const list = items(t.root), want = memory.get(t.id);
    const found = (want != null && list.find(e => navKey(e) === want)) || null;
    setFocus(found || pickNext(null, list.map(rect), 'Down')?.e || null);
    return t;
  }

  function move(dir) {
    const t = sync(); if (!t) return;
    if (el && (dir === 'Left' || dir === 'Right') && adjust(el, dir === 'Right' ? 1 : -1)) return;
    const list = items(t.root).map(rect);
    const cur = el ? list.find(r => r.e === el) || rect(el) : null;
    const next = pickNext(cur, list, dir);
    if (next) setFocus(next.e);
  }
  function adjust(e, step) { // sliders and dropdowns: Left / Right change them
    if (e.tagName === 'INPUT' && e.type === 'range') { step > 0 ? e.stepUp() : e.stepDown(); }
    else if (e.tagName === 'SELECT') { const i = Math.max(0, Math.min(e.options.length - 1, e.selectedIndex + step)); if (i === e.selectedIndex) return true; e.selectedIndex = i; }
    else return false;
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function confirm() {
    const t = sync(); if (!t || !el) return;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type))) { el.focus(); return; } // (a text field: focus it to type)
    if (el.tagName === 'INPUT' && el.type === 'range') return;
    pendingFrom = t.id;
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); // (SVG nodes: the Skill Tree)
    sync(); pendingFrom = null; // (a window it opened now knows where B goes back to)
  }
  function back() {
    const t = sync(); if (!t) return;
    const h = hooks[t.id] || {}, from = parent.get(t.id);
    const btn = [...t.root.querySelectorAll('[data-nav=back]')].find(usable);
    if (btn) { btn.click(); return; } // (a view inside the window: the Game Menu's Controls page, the character form)
    if (h.back) h.back(); else panels.close(t.id);
    parent.delete(t.id);
    if (from && !rootOf(from)) hooks[from]?.open?.();
  }

  input.onPad((name, down) => {
    const t = input.device === 'pad' ? sync() : null;
    if (!t || (!el && !hooks[t.id])) return false; // (a window with nothing to press, the death card: the pad plays on)
    if (name === 'Start') return false; // (the menu action: opens / closes the Game Menu, closes windows)
    if (down && name === 'A') confirm();
    else if (down && name === 'B') back();
    return true; // everything else is the menu's while it's open (the d-pad moves in tick())
  });

  return {
    tick(now = performance.now()) {
      const t = sync();
      if (!t) { dpad.dir = stick.dir = null; return; }
      const d = NAV_DIRS.find(n => input.padHeld(n)) || null;
      if (repeatStep(dpad, d, now)) move(d);
      const s = d ? null : stickDir(input.stick('LS'));
      if (repeatStep(stick, s, now)) move(s);
    },
    active: () => !!el && input.device === 'pad',
    current: () => ({ layer: layer?.id || null, key: el ? navKey(el) : null }),
  };
}
