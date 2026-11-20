// Downed + revive on the client (docs/ROADMAP.md G1, server/revive.js).
//  - snap(w.down): marks downed players (e.downed = { left, prog, by }) and you (state.downed).
//  - Your overlay while downed: a bleed-out ring with the seconds left, who is reviving you and their progress.
//  - "Hold E to revive <name>" when a downed partymate is in reach (on touch: press and hold the prompt); sends
//    { type: 'revive', on: 1, id } while held and { on: 0 } on release.
//  - A marker above every downed partymate (everyone's for spectators), drawn on the HUD layer so it shows through
//    walls: a red cross in a bleed-out ring, the name, and the revive progress.
//  - Downed: you crawl (crawlCap) and can't attack, roll or jump (isDown); the rig slumps (the `downed` pose, world.js).
import { DOWNED } from '/shared/revive.js';
import { tapping } from '/keyname.js'; // touch devices tap unless playing with a pad

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RING = 2 * Math.PI * 16; // svg circle r=16

// keyLabel(action): the key a prompt names (input.label: follows the player's bindings and the active device).
export function initRevive({ state, players, send, project, layer, guide, sfx, fx, floatNum, isTouch, keyLabel = () => 'E' }) {
  const overlay = document.createElement('div');
  overlay.id = 'downed'; overlay.className = 'hidden';
  overlay.innerHTML = `<div class="dn-box"><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16"/></svg>
    <div class="dn-secs"></div><div class="dn-title">DOWNED</div><div class="dn-sub"></div><div class="dn-bar"><div></div></div></div>`;
  document.body.appendChild(overlay);
  const prompt = document.createElement('div');
  prompt.id = 'revive-prompt'; prompt.className = 'hidden';
  document.body.appendChild(prompt);
  const markers = new Map(); // player id -> marker element
  const name = id => state.roster.get(id)?.name || players.get(id)?.name || 'someone';
  let touchHeld = false, sent = 0, sentAt = 0, lastPrompt = '', lastSub = '';
  prompt.addEventListener('pointerdown', e => { touchHeld = true; e.preventDefault(); });
  for (const k of ['pointerup', 'pointercancel', 'pointerleave']) prompt.addEventListener(k, () => { touchHeld = false; });

  function snap(list) {
    const down = new Map((list || []).map(r => [r[0], { left: r[1], prog: r[2], by: r[3] }]));
    for (const [id, e] of players) e.downed = down.get(id) || null;
    const was = !!state.downed;
    state.downed = state.spectator ? null : down.get(state.myId) || null;
    if (!!state.downed !== was) overlay.classList.toggle('hidden', !state.downed);
  }

  function event(e) {
    const me = state.myId;
    if (e.t === 'down') {
      const p = players.get(e.id);
      if (e.id === me) { guide.tip('downed'); sfx.play('hurt', null, 1.2); }
      else if (p && state.party && p.party === state.party) { guide.tip('revive'); sfx.play('warn', { x: e.x, z: e.z }, 0.8); }
      if (p) floatNum(p.model.group.position, 2.6, 'DOWNED', 'brk');
      return true;
    }
    if (e.t === 'rev') return true;
    if (e.t === 'revived') {
      const p = players.get(e.id);
      if (p) { fx.heal(p.model.group); floatNum(p.model.group.position, 2.8, 'Revived!', 'heal'); }
      sfx.play('heal', { x: e.x, z: e.z }, e.id === me || e.by === me ? 1.2 : 0.7);
      if (e.by === me) sent = 0;
      return true;
    }
    return false;
  }

  // The downed partymate you can revive right now (nearest in reach), or null.
  function reviveTarget() {
    if (!state.joined || state.spectator || state.dead || state.downed || !state.party) return null;
    let best = null, bd = DOWNED.reach;
    for (const p of players.values()) {
      if (!p.downed || p.id === state.myId || p.party !== state.party || p.dead) continue;
      if (p.downed.by && p.downed.by !== state.myId) continue; // someone else has them
      const d = Math.hypot(p.model.group.position.x - state.x, p.model.group.position.z - state.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function frame(keys) {
    // you, downed
    if (state.downed) {
      const D = state.downed, f = Math.max(0, Math.min(1, D.left / DOWNED.secs));
      overlay.querySelector('.fg').style.strokeDashoffset = `${RING * (1 - f)}`;
      overlay.querySelector('.dn-secs').textContent = Math.ceil(D.left);
      const sub = D.by ? `${esc(name(D.by))} is reviving you…` : `Crawl to your party. A partymate can hold <b>${esc(keyLabel('revive'))}</b> next to you to revive you.`;
      if (sub !== lastSub) { lastSub = sub; overlay.querySelector('.dn-sub').innerHTML = sub; }
      overlay.querySelector('.dn-bar').style.visibility = D.by ? 'visible' : 'hidden';
      overlay.querySelector('.dn-bar > div').style.width = `${Math.round(D.prog * 100)}%`;
      overlay.classList.toggle('urgent', D.left < 5 && !D.by);
    }
    // you, next to a downed partymate
    const t = reviveTarget();
    const typing = document.activeElement?.id === 'chat-input';
    const held = !!t && !typing && (keys.has('e') || touchHeld), now = performance.now();
    if (held) { // (pressed again if the channel broke: a hit, a step too far)
      if (sent !== t.id || (t.downed.by !== state.myId && now - sentAt > 400)) { send({ type: 'revive', on: 1, id: t.id }); sent = t.id; sentAt = now; }
    } else if (sent) { send({ type: 'revive', on: 0 }); sent = 0; }
    const html = t ? `<div>${t.downed.by === state.myId ? 'Reviving' : tapping() ? 'Hold here to revive' : `Hold <b>${esc(keyLabel('revive'))}</b> to revive`} ${esc(name(t.id))}</div><div class="rp-bar"><div style="width:${Math.round((t.downed.by === state.myId ? t.downed.prog : 0) * 100)}%"></div></div>` : '';
    if (html !== lastPrompt) { lastPrompt = html; prompt.innerHTML = html; prompt.classList.toggle('hidden', !t); }
    // markers over downed partymates (all of them for spectators), through walls
    const seen = new Set();
    for (const p of players.values()) {
      if (!p.downed || p.dead || p.id === state.myId) continue;
      if (!state.spectator && !(state.party && p.party === state.party)) continue;
      const g = p.model.group.position, sp = project(g.x, g.y + 1.6, g.z);
      if (!sp) continue;
      seen.add(p.id);
      let el = markers.get(p.id);
      if (!el) {
        el = document.createElement('div'); el.className = 'dn-mark';
        el.innerHTML = `<svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16"/><path d="M17 11h6v6h6v6h-6v6h-6v-6h-6v-6h6z"/></svg><div class="nm"></div><div class="pg"><div></div></div>`;
        layer.appendChild(el); markers.set(p.id, el);
      }
      el.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%)`;
      el.querySelector('.fg').style.strokeDashoffset = `${RING * (1 - Math.max(0, Math.min(1, p.downed.left / DOWNED.secs)))}`;
      const nm = `${esc(name(p.id))} · ${Math.ceil(p.downed.left)}s`;
      if (el.querySelector('.nm').innerHTML !== nm) el.querySelector('.nm').innerHTML = nm;
      el.classList.toggle('busy', !!p.downed.by);
      el.querySelector('.pg > div').style.width = `${Math.round(p.downed.prog * 100)}%`;
    }
    for (const [id, el] of markers) if (!seen.has(id)) { el.remove(); markers.delete(id); }
  }

  return {
    snap, event, frame,
    isDown: () => !!state.downed,
    usesE: () => !!state.downed || !!reviveTarget(), // E revives here instead of turning the camera
    crawlCap: (want, mag = 1) => (state.downed ? Math.min(want, DOWNED.crawl * mag) : want),
  };
}
