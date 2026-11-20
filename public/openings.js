// Boss openings (docs/ROADMAP.md J3, server/openings.js): while a boss is exposed, stunned or planted after a combo,
// everyone sees a glowing weak point on it, an OPENING tag over it (its nameplate) and on the boss bar with the seconds
// left. From the snapshot (w.op: [[boss id, state index, s left, s total]]), so a late joiner sees one already running.
// The first few openings near you: a callout; a one-time guide tip.
import * as THREE from 'three';
import { AFTER_STATES, OPENING } from '/shared/bosstiming.js';

const PROMPTS = 3; // callouts for the first three openings you're near
const WORD = { exposed: 'EXPOSED', stunned: 'STUNNED', planted: 'PLANTED' };
const CSS = `
#boss .opening{display:none;margin-top:3px;font-weight:800;letter-spacing:.08em;font-size:12px;color:#fde68a;text-shadow:0 0 8px #f59e0b}
#boss.open .opening{display:block}
.lbl .opn{color:#fde68a;text-shadow:0 0 6px #f59e0b;font-weight:800;letter-spacing:.05em}
`;

export function initOpenings({ state, mobs, guide, callout }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const line = document.createElement('div'); line.className = 'opening';
  document.getElementById('boss')?.appendChild(line);
  const open = new Map(); // boss id -> { state, end (performance.now s), total }
  const glows = new Map(); // boss id -> weak-point mesh
  const starts = new Map(); // boss id -> when its last opening started (s): a blink in w.op is not a new opening
  const now = () => performance.now() / 1000;

  // Free a weak point (its boss left, or its model was rebuilt).
  function drop(id) {
    const g = glows.get(id);
    if (!g) return;
    g.parent?.remove(g); g.geometry.dispose(); g.material.dispose();
    glows.delete(id);
  }

  // The weak point: an unlit, additive orb on the boss's chest (no new lights: shader warm-up holds).
  function glowFor(e) {
    let g = glows.get(e.id);
    if (g && g.parent === e.model.group) return g;
    if (g) drop(e.id); // the model was rebuilt
    const mat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    g = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), mat);
    g.position.set(0, (e.model.height || 4) * 0.62, 0.35 * (e.def?.radius || 2));
    g.renderOrder = 5;
    e.model.group.add(g);
    glows.set(e.id, g);
    return g;
  }

  function snap(op) {
    const seen = new Set();
    for (const [id, si, left, total] of op || []) {
      seen.add(id);
      const was = open.get(id), st = AFTER_STATES[si], from = now() + left - total;
      open.set(id, { state: st, end: now() + left, total });
      const e = mobs.get(id);
      if (e) e.opening = st;
      if (!was && !(Math.abs((starts.get(id) ?? -1e9) - from) < 0.5)) started(id, e); // (the same opening back after a blink: no new callout)
      starts.set(id, from);
    }
    for (const id of [...open.keys()]) if (!seen.has(id)) { open.delete(id); const e = mobs.get(id); if (e) e.opening = null; }
    for (const id of [...starts.keys()]) if (!mobs.has(id)) starts.delete(id);
  }

  function started(id, e) {
    if (!e || state.spectator || state.dead) return;
    if (Math.hypot(e.tx - state.x, e.tz - state.z) > 30) return;
    guide.tip('opening');
    let n = 0; try { n = +(localStorage.getItem('fb_opening') || 0); } catch {}
    if (n >= PROMPTS) return;
    try { localStorage.setItem('fb_opening', String(n + 1)); } catch {}
    callout('OPENING!', `Melee: get in and hit it now (+${Math.round(OPENING.dmg * 100)}% damage). Get out before it ends.`, 2.2);
  }

  /** The boss bar line ("OPENING · EXPOSED · 2 s"). */
  function bossBar(boss) {
    const o = boss && open.get(boss.id), el = document.getElementById('boss');
    el?.classList.toggle('open', !!o);
    if (!o) return;
    const txt = `OPENING · ${WORD[o.state] || o.state.toUpperCase()} · ${Math.max(0, Math.ceil(o.end - now()))} s`;
    if (line.textContent !== txt) line.textContent = txt;
  }

  /** The nameplate tag (main.js mob labels). */
  const tag = e => (e.opening ? ' <b class="opn">OPENING</b>' : '');

  /** Every frame: the weak points pulse while open, hide otherwise. */
  function frame() {
    const t = now();
    for (const [id, g] of [...glows]) {
      if (!mobs.get(id)) drop(id); // the boss left
      else if (!open.has(id)) g.visible = false;
    }
    for (const [id, o] of open) {
      const e = mobs.get(id);
      if (!e?.model?.group) continue;
      const g = glowFor(e), left = o.end - t;
      g.visible = true;
      const k = 1 + 0.25 * Math.sin(t * 9) + (left < 0.8 ? 0.3 * Math.sin(t * 30) : 0); // flickers as it closes
      g.scale.setScalar(k);
      g.material.opacity = left < 0.8 ? 0.5 : 0.85;
    }
  }

  return { snap, bossBar, tag, frame, get open() { return open; } };
}
