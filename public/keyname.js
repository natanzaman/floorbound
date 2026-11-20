// The key a prompt names for an action (roadmap K): the player's binding on the active device ('F' on keyboard & mouse,
// 'D-pad ↓' / '✕' on a controller), read from the input layer each time a prompt is drawn, so prompts follow a device
// switch or a rebind with no bookkeeping. main.js calls setKeySource(input) once; until then (and for an unbound action)
// the default keyboard key.
//   keyName(action)   the label ('F', 'LB+X')          keyHtml(action)  the same, escaped for innerHTML
//   tapping()         touch play (no pad): prompts say "tap …" instead of naming a key
//   keyText(text)     server text with {key:action} tokens filled in ("Hold {key:revive} next to them")
import { DEFAULTS, bindingLabel } from '/shared/controls.js';

let src = null;
export function setKeySource(input) { src = input; }
export function keyName(action) {
  try { const l = src?.label(action); if (l && l !== 'Not bound') return l; } catch {}
  return bindingLabel(DEFAULTS.kbm[action]?.[0] ?? null);
}
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const keyHtml = action => esc(keyName(action));
export const tapping = () => (src ? src.device === 'touch' : document.body.classList.contains('touch'));
export const keyText = text => String(text).replace(/\{key:(\w+)\}/g, (_, a) => keyName(a));
