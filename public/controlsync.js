// Controls that follow the account (roadmap K2): fb_controls (bindings + accessibility) is kept on the account too
// (accounts.settings, GET / PUT /api/settings), so bindings follow you across browsers.
//   login()   after sign-in: the account's copy wins when it has one (it replaces this browser's, then onApply(c));
//             otherwise this browser's copy goes up. The rules live in shared/controls.js (syncPlan, cleanControls).
//             Exception: when this browser has a change the server never got (the fb_controls_unsynced flag), that
//             change goes up instead, so a reload, a failed request or a second login never reverts it. The flag holds
//             the id of the account the change belongs to ('?' when made before /api/me answered: it belongs to the
//             stored token's account and is claimed at the next login); a flag of another account is dropped at login
//             (this browser takes the new account's copy; the change is never uploaded to the wrong account). A change
//             the server refuses for good (400, 413) is dropped at login too, and the account copy wins.
//   After that, every change to fb_controls is uploaded (debounced, one PUT at a time, failed ones retried with
//   backoff a few times; on pagehide a waiting change goes out with fetch keepalive). Signed out: nothing leaves the
//   browser and nothing is flagged.
import { syncPlan } from '/shared/controls.js';
import { controlsStore } from '/input.js';

export const UNSYNCED_KEY = 'fb_controls_unsynced';
// Worth trying again: no answer at all (offline, a deploy restart), a timeout, rate limiting or a server error.
const retryable = e => !e?.status || e.status === 408 || e.status === 429 || e.status >= 500;

export function createControlSync({ api, signedIn, account = () => null, onApply = () => {}, delay = 800, backoff = 1000, retries = 5, storage = globalThis.localStorage }) {
  let live = false, quiet = false, timer = null, gen = 0, ver = 0, sending = null, fails = 0;
  const me = () => { const id = account(); return id == null ? null : String(id); };
  const flag = () => { try { return storage.getItem(UNSYNCED_KEY); } catch { return null; } };
  // A change of this account (or of the stored token's, owner not known yet) is waiting to go up.
  const unsynced = () => { const f = flag(); return f != null && (f === '?' || f === me()); };
  const mark = on => { try { if (on) storage.setItem(UNSYNCED_KEY, me() ?? '?'); else storage.removeItem(UNSYNCED_KEY); } catch {} };
  // Refused for good (bad request, too large): sending it again cannot help. 401 is a sign-out, not a refusal.
  const refused = e => !!e?.status && e.status !== 401 && !retryable(e);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // One PUT of this browser's fb_controls; the flag clears only when the server took the latest copy (200).
  function send(keepalive) {
    const v = ver;
    return api('/api/settings', { method: 'PUT', body: JSON.stringify({ settings: controlsStore.get() }), ...(keepalive ? { keepalive: true } : {}) })
      .then(() => { if (v === ver) mark(false); });
  }
  // Uploads a change the server never got; waits for a PUT already out first, so they land in order.
  async function flush() {
    clearTimeout(timer); timer = null;
    while (sending) await sending.catch(() => {});
    if (!unsynced()) return;
    const p = sending = send(false);
    try { await p; } finally { if (sending === p) sending = null; }
  }
  // fn() again after 1x, 2x, 4x... backoff while it fails with something worth retrying and this login is current.
  async function retry(fn, my) {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        if (my !== gen || i >= retries || !retryable(e)) throw e;
        await wait(backoff * 2 ** i);
        if (my !== gen) throw e;
      }
    }
  }
  function schedule(ms = delay) { clearTimeout(timer); timer = setTimeout(push, ms); }
  async function push() {
    timer = null;
    if (!live || !signedIn()) return;
    try { await flush(); fails = 0; } catch (e) { if (live && retryable(e) && fails < retries) schedule(backoff * 2 ** fails++); }
  }

  async function login() {
    const my = ++gen;
    live = false;
    if (!signedIn()) { clearTimeout(timer); timer = null; return; }
    const f = flag();
    if (f === '?' && me() != null) mark(true); // (made with this token before /api/me answered: this account's)
    else if (f != null && !unsynced()) mark(false); // (another account's: never uploaded here; this account's copy wins)
    try {
      for (let fetched = false; ;) {
        if (!unsynced()) {
          const { settings } = await retry(() => api('/api/settings'), my);
          if (my !== gen) return;
          fetched = true;
          if (!unsynced()) { // (a change made while the GET was out keeps this browser's copy)
            const plan = syncPlan(controlsStore.get(), settings);
            if (plan.use) { quiet = true; try { controlsStore.replace(plan.use); } finally { quiet = false; } onApply(plan.use); }
            else mark(true); // the account has no copy yet: this browser's goes up
          }
        }
        try { await retry(flush, my); break; } catch (e) { // (a pending upload is flushed, never cancelled)
          if (my !== gen || !refused(e)) throw e;
          mark(false); // refused for good: dropped, and the account copy wins (fetched already: nothing more to do)
          if (fetched) break;
        }
      }
      if (my !== gen) return;
      live = true; fails = 0;
      if (unsynced()) schedule(); // (changed while the last PUT was out)
    } catch {} // (still failing after the retries: the flag stays, so the next login uploads this browser's copy)
  }
  controlsStore.listen(() => {
    if (quiet || !signedIn()) return;
    ver++; mark(true); fails = 0;
    if (live) schedule();
  });
  globalThis.addEventListener?.('pagehide', () => {
    if (!signedIn() || !unsynced()) return;
    clearTimeout(timer); timer = null;
    send(true).catch(() => {}); // (the flag stays until a 200 is seen, so if this is lost the next login uploads again)
  });
  return { login, get live() { return live; } };
}
