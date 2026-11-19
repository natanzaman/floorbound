// Settings: what's saved where, and the Settings panel (camera, chat, graphics).
// fb_settings (this browser only): camera mode, graphics, overlays, the active input device.
// fb_controls (public/input.js; follows the account later): bindings, and the camera feel that belongs with them
// (mouse sensitivity, invert-Y). Older saves kept sensitivity and invert-Y in fb_settings: moved over on load.
// camera 'mouse' (default): the camera follows the mouse (pointer lock; click the game to capture the cursor, Esc to free it).
// camera 'classic': right-drag to look, or rest the cursor at a screen edge to turn.
// quality: 'auto' (default) | 'low' | 'medium' | 'high' (public/quality.js) · perf: the diagnostics overlay · ping: the ping chip
import { controlsStore } from '/input.js';
import { ACCESS_DEFAULTS, RANGES, normalizeAccess } from '/access.js'; // the accessibility options (Settings → Accessibility)

const LOCAL_DEFAULTS = { camera: 'mouse', bubbles: true, quality: 'auto', perf: false, ping: true };
const SYNCED_DEFAULTS = ACCESS_DEFAULTS; // everything in fb_controls.access (mouse feel + accessibility)
const SYNCED = Object.keys(SYNCED_DEFAULTS);

export function loadSettings() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem('fb_settings') || '{}') || {}; } catch {}
  let c = controlsStore.get();
  if (!c.access) { // first load with fb_controls: take sensitivity / invert-Y over from fb_settings
    const access = {};
    for (const k of SYNCED) if (k in local) access[k] = local[k];
    c = controlsStore.set({ access });
  }
  for (const k of SYNCED) delete local[k];
  return Object.assign({}, LOCAL_DEFAULTS, local, normalizeAccess(controlsStore.get().access));
}
// The CSS side of the options: --ui-scale and the high-contrast class (the commented block at the end of style.css).
export function applyAccess(settings, root = document.documentElement) {
  root.style.setProperty('--ui-scale', String(normalizeAccess(settings).uiScale));
  root.classList.toggle('hc', !!settings.highContrast);
}
export function saveSettings(settings) {
  const local = {}, access = {};
  for (const [k, v] of Object.entries(settings)) (SYNCED.includes(k) ? access : local)[k] = v;
  try { localStorage.setItem('fb_settings', JSON.stringify(local)); } catch {}
  controlsStore.set({ access: normalizeAccess({ ...controlsStore.get().access, ...access }) });
}

const QLABEL = { auto: 'Auto <small>picks a level that keeps the game smooth</small>', low: 'Low <small>fastest: no shadows, fewer effects, shorter view</small>', medium: 'Medium', high: 'High <small>sharpest, with shadows and full effects</small>' };

// The Settings panel (#settings). Returns { render, open, toggle }.
export function initSettingsPanel({ el, settings, save, Q, PRESETS, perf, applyQuality, freeCursor, bubbles, sfx }) {
  function render() {
    el.innerHTML = `<div class="top"><b>Settings</b><button class="x" data-a="close">✕</button></div>
    <h4>Camera</h4>
    <label class="opt"><input type="radio" name="cam" value="mouse" ${settings.camera === 'mouse' ? 'checked' : ''}> Follows the mouse <small>click the game to capture the cursor · Esc to free it</small></label>
    <label class="opt"><input type="radio" name="cam" value="classic" ${settings.camera === 'classic' ? 'checked' : ''}> Classic <small>right-drag to look · rest the cursor at a screen edge to turn</small></label>
    <h4>Mouse sensitivity <span id="sens-v">${settings.sens.toFixed(1)}×</span></h4>
    <input type="range" min="0.3" max="3" step="0.1" value="${settings.sens}" data-a="sens">
    <label class="opt"><input type="checkbox" data-a="inv" ${settings.invertY ? 'checked' : ''}> Invert vertical look</label>
    <h4>Stick look sensitivity <span id="padsens-v">${settings.padSens.toFixed(1)}×</span></h4>
    <input type="range" min="${RANGES.padSens[0]}" max="${RANGES.padSens[1]}" step="0.1" value="${settings.padSens}" data-a="padSens">
    <h4>Accessibility</h4>
    <label class="opt"><input type="checkbox" data-a="guardToggle" ${settings.guardToggle ? 'checked' : ''}> Toggle guard <small>press the guard key to raise it, again to lower it (instead of holding)</small></label>
    <label class="opt"><input type="checkbox" data-a="wheelToggle" ${settings.wheelToggle ? 'checked' : ''}> Toggle the bot wheel <small>press V to open it, again (or Esc) to close it</small></label>
    <label class="opt"><input type="checkbox" data-a="reduceMotion" ${settings.reduceMotion ? 'checked' : ''}> Reduce motion <small>no camera shake, hit-stop or kill-zoom</small></label>
    <label class="opt"><input type="checkbox" data-a="highContrast" ${settings.highContrast ? 'checked' : ''}> High-contrast HUD text <small>brighter text on darker panels</small></label>
    <h4>Text &amp; UI size <span id="uiscale-v">${Math.round(settings.uiScale * 100)}%</span></h4>
    <input type="range" min="${RANGES.uiScale[0]}" max="${RANGES.uiScale[1]}" step="0.05" value="${settings.uiScale}" data-a="uiScale">
    <h4>Chat</h4>
    <label class="opt"><input type="checkbox" data-a="bub" ${settings.bubbles !== false ? 'checked' : ''}> Speech bubbles <small>chat lines over the speaker's head (the chat log keeps everything)</small></label>
    <h4>Graphics</h4>
    ${['auto', 'low', 'medium', 'high'].map(q => `<label class="opt"><input type="radio" name="gq" value="${q}" ${settings.quality === q ? 'checked' : ''}> ${QLABEL[q]}${q === 'auto' && settings.quality === 'auto' ? ` <small>now: ${Q.level}${!Q.shadows && PRESETS[Q.level]?.shadows ? ', shadows off' : ''}</small>` : ''}</label>`).join('')}
    <small class="note">Lower settings draw fewer pixels, effects and shadows. Smoothing edges (High) changes after a reload.</small>
    <label class="opt"><input type="checkbox" data-a="perf" ${settings.perf ? 'checked' : ''}> Performance overlay <small>F3 · frame rate, ping, snapshots</small></label>
    <label class="opt"><input type="checkbox" data-a="ping" ${settings.ping !== false ? 'checked' : ''}> Show ping in the corner</label>`;
  }
  el.addEventListener('click', e => { if (e.target.closest('[data-a=close]')) el.classList.add('hidden'); });
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.name === 'cam') { settings.camera = t.value; if (t.value === 'classic') freeCursor(); }
    if (t.dataset.a === 'sens') { settings.sens = +t.value; el.querySelector('#sens-v').textContent = `${settings.sens.toFixed(1)}×`; }
    if (t.dataset.a === 'inv') settings.invertY = t.checked;
    if (t.dataset.a === 'padSens') { settings.padSens = +t.value; el.querySelector('#padsens-v').textContent = `${settings.padSens.toFixed(1)}×`; }
    for (const k of ['guardToggle', 'wheelToggle', 'reduceMotion', 'highContrast']) if (t.dataset.a === k) settings[k] = t.checked;
    if (t.dataset.a === 'uiScale') { settings.uiScale = +t.value; el.querySelector('#uiscale-v').textContent = `${Math.round(settings.uiScale * 100)}%`; }
    applyAccess(settings);
    if (t.dataset.a === 'bub') { settings.bubbles = t.checked; if (!t.checked) bubbles.clear(); }
    if (t.name === 'gq') { settings.quality = t.value; perf.setMode(t.value); if (t.value !== 'auto') applyQuality(t.value); }
    if (t.dataset.a === 'perf') settings.perf = t.checked;
    if (t.dataset.a === 'ping') settings.ping = t.checked;
    save();
  });
  const isOpen = () => !el.classList.contains('hidden');
  return {
    render,
    isOpen,
    open() { el.classList.remove('hidden'); render(); },
    toggle() { el.classList.toggle('hidden'); if (isOpen()) render(); sfx.play('ui'); },
    refresh() { if (isOpen()) render(); },
  };
}
