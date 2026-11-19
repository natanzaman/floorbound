// Controls that follow the account (roadmap K2): fb_controls (bindings + accessibility) is kept on the account too
// (accounts.settings, GET / PUT /api/settings), so bindings follow you across browsers.
//   login()   after sign-in: the account's copy wins when it has one (it replaces this browser's, then onApply(c));
//             otherwise this browser's copy goes up. The rules live in shared/controls.js (syncPlan, cleanControls).
//   After that, every change to fb_controls is uploaded (debounced). Signed out: nothing leaves the browser.
import { syncPlan } from '/shared/controls.js';
import { controlsStore } from '/input.js';

export function createControlSync({ api, signedIn, onApply = () => {}, delay = 800 }) {
  let live = false, quiet = false, timer = null, gen = 0;
  const put = c => api('/api/settings', { method: 'PUT', body: JSON.stringify({ settings: c }) });

  async function login() {
    const my = ++gen;
    live = false; clearTimeout(timer);
    if (!signedIn()) return;
    try {
      const { settings } = await api('/api/settings');
      if (my !== gen) return;
      const plan = syncPlan(controlsStore.get(), settings);
      if (plan.use) { quiet = true; try { controlsStore.replace(plan.use); } finally { quiet = false; } onApply(plan.use); }
      else await put(plan.upload);
      if (my === gen) live = true;
    } catch {} // (offline or no accounts: this browser's copy stays in force)
  }
  controlsStore.listen(() => {
    if (!live || quiet || !signedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(() => put(controlsStore.get()).catch(() => {}), delay);
  });
  return { login, get live() { return live; } };
}
