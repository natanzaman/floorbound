// The Controls screen (roadmap K2), from the Game Menu → Controls. Registered with the panel registry (Esc closes it).
//   Header: the Input device choice (Keyboard & Mouse | Controller; Controller only while a pad is connected) and a
//           live "Controller connected: …" line.
//   Tabs:   Keyboard & Mouse | Controller. Each starts with a device picture (#cu-pic-kbm / #cu-pic-pad: empty here,
//           drawn in K2 part 2), then every control by group with its binding and a Rebind button.
//   Rebind: input.capture() takes the next key, click or chord (Esc cancels). shared/controls.js check() decides:
//           refused keys get a reason; a key that's taken asks Swap / Unbind / Cancel (assign 'swap' | 'unbind').
//   Reset to defaults per device. Every change saves to fb_controls (input.setBinding), which the account sync uploads.
import { ACTION, ACTIONS, DEFAULTS, GROUPS, PAD_BUTTONS, PAD_MODIFIERS, bindingLabel, check, isAxisBinding, tokens } from '/shared/controls.js';

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

export function initControlsUi({ input, sfx, onChange = () => {}, id = 'controlsui' }) {
  const el = document.createElement('div');
  el.id = id; el.className = 'panel hidden'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Controls');
  document.body.appendChild(el);
  let tab = input.device === 'pad' ? 'pad' : 'kbm', busy = null, msg = '', prompt = null, resetArmed = null, poll = null, padCount = 0;

  const pads = () => { try { return input.readPads() || []; } catch { return []; } };
  const padName = p => (p && p.id ? String(p.id).replace(/\s*\(.*$/, '') || p.id : 'controller');

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
    return `<span class="cu-slot ${slot ? 'alt' : ''}"><span class="cu-b ${b ? '' : 'none'}" data-b="${esc(key)}">${mine ? esc(busy.text) : esc(bindingLabel(b))}</span>`
      + `<button class="cu-rb" data-rb="${esc(key)}" data-nav="cu-rb-${device}-${esc(key)}" ${can && !busy ? '' : 'disabled'} title="${esc(title)}">${mine ? 'Listening…' : slot ? 'Alt' : 'Rebind'}</button></span>`;
  }
  function list(device) {
    return controlRows(device).map(g => `<h4>${esc(g.group)}</h4>`
      + g.actions.map(a => `<div class="cu-row" data-action="${a.id}"><span class="cu-name">${esc(a.label)}${a.fixed ? ' <small>fixed</small>' : ''}</span>`
        + `<span class="cu-slots">${slotCell(device, a, 0)}${device === 'kbm' ? slotCell(device, a, 1) : ''}</span></div>`).join('')).join('');
  }
  function render() {
    const p = prompt;
    el.innerHTML = header()
      + ['kbm', 'pad'].map(d => `<section class="cu-tab ${tab === d ? '' : 'hidden'}" id="cu-tab-${d}" role="tabpanel">
        <div class="cu-pic" id="cu-pic-${d}" data-device="${d}"><!-- K2 part 2: the ${DEVICE_NAMES[d]} picture goes here --></div>
        <div class="cu-msg ${msg ? '' : 'hidden'}" id="cu-msg-${d}" role="status">${esc(msg)}</div>
        ${p && p.device === d ? `<div class="cu-prompt" id="cu-prompt"><div><b>${esc(bindingLabel(p.binding))}</b> is already on ${p.conflicts.map(c => `<b>${esc(ACTION[c.action].label)}</b>`).join(', ')}.</div>
          <button data-p="swap" data-nav="cu-p-swap">Swap</button><button data-p="unbind" data-nav="cu-p-unbind">Unbind ${p.conflicts.length > 1 ? 'them' : 'it'}</button><button data-p="cancel" data-nav="cu-p-cancel">Cancel</button></div>` : ''}
        <div class="cu-list">${list(d)}</div>
        <button class="cu-reset" data-reset="${d}" data-nav="cu-reset-${d}">${resetArmed === d ? `Sure? Reset ${DEVICE_NAMES[d]}` : `Reset ${DEVICE_NAMES[d]} to defaults`}</button>
      </section>`).join('');
  }
  const say = t => { msg = t || ''; render(); };
  const changed = () => { try { onChange(); } catch (e) { console.error(e); } };

  // Rebind one slot: capture, check, then save / refuse / ask.
  async function rebind(device, action, slot) {
    if (busy) return;
    const a = ACTION[action], cur = input.bindings(device)[action]?.[slot] ?? null;
    prompt = null; resetArmed = null;
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
    if (binding === cur) return say(`${a.label} stays on ${bindingLabel(binding)}.`);
    const r = check(input.bindings(device), device, action, slot, binding);
    if (r.error) { sfx?.play?.('ui'); return say(`${bindingLabel(binding)}: ${REFUSED[r.error] || r.error}`); }
    if (r.conflicts.length) { prompt = { device, action, slot, binding, conflicts: r.conflicts }; return say(''); }
    apply(device, action, slot, binding, 'unbind');
  }
  function apply(device, action, slot, binding, mode) {
    const r = input.setBinding(device, action, slot, binding, mode);
    prompt = null;
    if (r?.error) return say(REFUSED[r.error] || r.error);
    say(`${ACTION[action].label}: ${bindingLabel(binding)}.`);
    changed();
  }

  el.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.a === 'close') return close();
    if (t.dataset.tab) { tab = t.dataset.tab; prompt = null; resetArmed = null; msg = ''; render(); return; }
    if (t.dataset.rb) { const [action, slot] = t.dataset.rb.split(':'); rebind(t.closest('section').id.slice(7), action, +slot); return; }
    if (t.dataset.p) {
      const p = prompt;
      if (!p || t.dataset.p === 'cancel') { prompt = null; return say('Cancelled.'); }
      return apply(p.device, p.action, p.slot, p.binding, t.dataset.p);
    }
    if (t.dataset.reset) {
      const d = t.dataset.reset;
      if (resetArmed !== d) { resetArmed = d; return render(); }
      resetArmed = null; prompt = null; input.resetBindings(d); say(`${DEVICE_NAMES[d]} is back to the default controls.`); changed();
    }
  });
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
    tab = input.device === 'pad' ? 'pad' : 'kbm'; msg = ''; prompt = null; resetArmed = null; padCount = pads().length;
    render(); el.classList.remove('hidden'); sfx?.play?.('ui');
    clearInterval(poll); poll = setInterval(() => (isOpen() ? live() : clearInterval(poll)), 500);
  }
  function close() { el.classList.add('hidden'); prompt = null; if (busy) input.cancelCapture?.(); busy = null; clearInterval(poll); }
  return { el, open, close, isOpen, render, refresh: () => { if (isOpen() && !busy) render(); }, get tab() { return tab; } };
}
