// Speech bubbles over characters' heads for chat lines (docs/ROADMAP.md F1).
// The pure part (who sees a line, how long it holds, one bubble per speaker) has no DOM or imports, so test/bubbles.js
// runs it in Node; initBubbles() is the browser part, driven from main.js (chat events, the frame loop, Settings).

export const SAY_RANGE = 40; // m: a `say` (/s) line is heard this far away (same as the chat log)
export const FADE_IN = 0.18, FADE_OUT = 0.35; // s

// How long a line holds at full opacity: about 1.6 s + 0.07 s per character, 2–5 s. A `hold` (s) on the event
// (the scene director's timing) wins, clamped to 1–10 s.
export function bubbleDuration(text, hold) {
  if (Number.isFinite(+hold) && +hold > 0) return Math.min(10, Math.max(1, +hold));
  return Math.min(5, Math.max(2, 1.6 + 0.07 * String(text || '').length));
}

// Film subtitles (public/cine.js): how long a scripted line stays on screen: reading time, 2.5 s + 0.06 s per character,
// or the cue's hold if that's longer. A scripted line is a chat event the scene director made (it carries `hold`).
export const subtitleHold = (text, hold) => Math.max(Number.isFinite(+hold) && +hold > 0 ? +hold : 0, 2.5 + 0.06 * String(text || '').length);
export const isCueLine = e => !!e && e.t === 'chat' && e.hold !== undefined && !!String(e.text || '').trim();

// Does this viewer get a bubble for this chat event? Mirrors the chat log: say within 40 m, party chat to the party,
// global chat to everyone; spectators see all of them. `/b` bot orders never show (the server never sends them as chat).
// viewer: { spectator, party, x, z }
export function bubbleVisible(e, viewer) {
  if (!e || e.t !== 'chat' || !e.id || !String(e.text || '').trim()) return false;
  if (/^\/b(\s|$)/i.test(String(e.text).trim())) return false;
  if (viewer.spectator) return true;
  if (e.ch === 'p') return !!viewer.party && e.party === viewer.party;
  if (e.ch === 's') return Math.hypot((e.x ?? 0) - viewer.x, (e.z ?? 0) - viewer.z) < SAY_RANGE;
  return true;
}

// The AI "mind" thinking indicator (H3, server/ai/): { t: 'mind', id, on, party } while a bot's model works on a line
// said to it. Shown like its reply will be (party chat): to its party, and to spectators. A "…" bubble that gives way
// to the reply's own bubble; it never outlives THINK_MAX (a lost "off").
export const THINK_MAX = 15; // s
// A Named answering talk (I3, server/ai/namedtalk.js) sends ch 's' with its position: seen like its reply, by anyone close.
export function thinkVisible(e, viewer) {
  if (!e || e.t !== 'mind' || !e.id) return false;
  if (e.ch === 's') return !!viewer.spectator || Math.hypot((e.x ?? 0) - viewer.x, (e.z ?? 0) - viewer.z) < SAY_RANGE;
  return !!viewer.spectator || (!!viewer.party && e.party === viewer.party);
}

// Opacity of a bubble at time `now` (s): fade in, hold, fade out; 0 once it's over.
export function bubbleAlpha(b, now) {
  const t = now - b.start;
  if (t < 0 || t >= b.hold + FADE_IN + FADE_OUT) return 0;
  if (t < FADE_IN) return b.instant ? 1 : t / FADE_IN;
  if (t < FADE_IN + b.hold) return 1;
  return 1 - (t - FADE_IN - b.hold) / FADE_OUT;
}

// One bubble per speaker: a new line from the same speaker replaces the old one.
export class BubbleStore {
  constructor() { this.map = new Map(); } // speaker id -> { id, text, start, hold, n, instant }
  say(id, text, now, hold) {
    const old = this.map.get(id);
    // a replacement while the old one is still up doesn't fade in again
    const instant = !!old && bubbleAlpha(old, now) > 0.5;
    const b = { id, text: String(text), start: now, hold: bubbleDuration(text, hold), n: (old?.n || 0) + 1, instant };
    this.map.set(id, b);
    return b;
  }
  get(id) { return this.map.get(id); }
  // live bubbles at `now`; expired ones are dropped
  active(now) {
    const out = [];
    for (const [id, b] of this.map) { if (now - b.start >= b.hold + FADE_IN + FADE_OUT) this.map.delete(id); else out.push(b); }
    return out;
  }
  clear() { this.map.clear(); }
}

// Bubble size by camera distance (m): full size up close, a little smaller far away, never below 0.8 (readable).
export const bubbleScale = d => Math.min(1, Math.max(0.8, 1.12 - d / 80));

// ---------- browser part ----------
// opts: { state, players, project(x, y, z) -> [sx, sy] | null, camera, layer (the #labels element), enabled() -> bool }
export function initBubbles({ state, players, project, camera, layer, enabled }) {
  const store = new BubbleStore();
  const els = new Map(); // speaker id -> { el, n }
  const now = () => performance.now() / 1000;
  const drop = id => { els.get(id)?.el.remove(); els.delete(id); };
  const thinking = new Map(); // bot id -> since (s): the AI mind's "…" (H3)
  const thinkEls = new Map(); // bot id -> element
  const dropThink = id => { thinkEls.get(id)?.remove(); thinkEls.delete(id); };
  // where a bubble for this speaker goes on screen, or null (off screen / behind the camera)
  const place = id => {
    const ent = players.get(id), g = ent?.model?.group;
    const p = g && project(g.position.x, g.position.y + (ent.model.height || 1.8) + 0.55, g.position.z);
    const m = 40;
    if (!p || p[0] < -m || p[0] > innerWidth + m || p[1] < -m || p[1] > innerHeight + m) return null;
    const lbl = ent.label?.el, lh = lbl && lbl.style.display !== 'none' ? lbl.offsetHeight : 0; // sit above the nameplate
    return `translate(${p[0]}px, ${p[1] - lh - 8}px) translate(-50%, -100%) scale(${bubbleScale(camera.position.distanceTo(g.position)).toFixed(3)})`;
  };

  return {
    store, // (debugging: window.__fb.bubbles.store)
    // a chat event from the snapshot (main.js `case 'chat'`); true if it got a bubble
    chat(e) {
      if (!enabled() || !bubbleVisible(e, state)) return false;
      store.say(e.id, e.text, now(), e.hold);
      return true;
    },
    // an AI mind thinking on / off (main.js `case 'mind'`); true if this viewer sees it
    mind(e) {
      if (!thinkVisible(e, state)) return false;
      if (e.on) thinking.set(e.id, now()); else thinking.delete(e.id);
      return !!e.on;
    },
    thinking, // (debugging / tests: window.__fb.bubbles.thinking)
    clear() { store.clear(); for (const id of [...els.keys()]) drop(id); thinking.clear(); for (const id of [...thinkEls.keys()]) dropThink(id); },
    // position every bubble above its speaker's nameplate (call after entities are animated)
    frame() {
      const t = now(), live = enabled() ? store.active(t) : (store.clear(), []);
      const ids = new Set(live.map(b => b.id));
      for (const id of [...els.keys()]) if (!ids.has(id)) drop(id);
      // "…" while a mind thinks, unless that bot already has a line up
      for (const [id, since] of thinking) if (t - since > THINK_MAX) thinking.delete(id);
      for (const id of [...thinkEls.keys()]) if (!thinking.has(id) || ids.has(id) || !enabled()) dropThink(id);
      if (enabled()) for (const id of thinking.keys()) {
        if (ids.has(id)) continue;
        let el = thinkEls.get(id);
        if (!el) { el = document.createElement('div'); el.className = 'bubble think'; el.dataset.id = id; el.innerHTML = '<i></i><i></i><i></i>'; layer.appendChild(el); thinkEls.set(id, el); }
        const tr = place(id);
        el.style.display = tr ? '' : 'none';
        if (tr) el.style.transform = tr;
      }
      for (const b of live) {
        const ent = players.get(b.id);
        let rec = els.get(b.id);
        if (!rec) {
          const el = document.createElement('div');
          el.className = 'bubble'; el.dataset.id = b.id;
          layer.appendChild(el);
          rec = { el, n: 0 }; els.set(b.id, rec);
        }
        if (rec.n !== b.n) { rec.n = b.n; rec.el.textContent = b.text; }
        const g = ent?.model?.group;
        const p = g && project(g.position.x, g.position.y + (ent.model.height || 1.8) + 0.55, g.position.z);
        const m = 40; // off screen (or behind the camera): hidden
        if (!p || p[0] < -m || p[0] > innerWidth + m || p[1] < -m || p[1] > innerHeight + m) { rec.el.style.display = 'none'; continue; }
        const lbl = ent.label?.el, lh = lbl && lbl.style.display !== 'none' ? lbl.offsetHeight : 0; // sit above the nameplate
        const s = bubbleScale(camera.position.distanceTo(g.position));
        rec.el.style.display = '';
        rec.el.style.opacity = bubbleAlpha(b, t).toFixed(3);
        rec.el.style.transform = `translate(${p[0]}px, ${p[1] - lh - 8}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      }
    },
  };
}
