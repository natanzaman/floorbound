// Team combat on the client (docs/ROADMAP.md G2; server: server/teamplay.js, tables: shared/teamplay.js):
//  - combo chain counter over the target ("Combo ×2 · Skewer"), seen by everyone (a target effect), a flash for the pair
//  - setup hints: a partner's setup you can cash in shows "→ Skewer" over the target (only to you)
//  - the Team Burst bar at the top of the party frames, the sync window prompt (T to join), the finisher's burst
// main.js wiring: event(e), snap(w), frame(), partyBar() (prepended to the party frames), press() (T key / tap the bar).
import { COMBOS, canPay, combosOf, BURST } from '/shared/teamplay.js';

const CSS = `
.tbar { padding: 5px 8px 6px; font-size: 11px; font-weight: 800; letter-spacing: .06em; border-radius: 8px; background: rgba(15,23,42,.72); color: #e2e8f0; }
.tbar .row { display: flex; justify-content: space-between; margin: 0; }
.tbar .tb-track { height: 7px; margin-top: 3px; border-radius: 4px; background: rgba(255,255,255,.12); overflow: hidden; }
.tbar .tb-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--tb1), var(--tb2)); transition: width .2s; }
.tbar.full { pointer-events: auto; cursor: pointer; box-shadow: 0 0 0 1px var(--tb2), 0 0 14px var(--tb1); animation: tbpulse 1s ease-in-out infinite; }
.tbar.sync { box-shadow: 0 0 0 2px #fff, 0 0 18px var(--tb2); }
.tbar kbd { font: inherit; padding: 0 4px; border-radius: 3px; background: rgba(255,255,255,.2); }
@keyframes tbpulse { 50% { filter: brightness(1.35); } }
#tb-sync { position: absolute; top: 18%; left: 50%; transform: translateX(-50%); min-width: 260px; text-align: center; pointer-events: none; z-index: 6;
  font-weight: 900; font-size: clamp(18px, 3.6vw, 28px); letter-spacing: .08em; color: #fff; text-shadow: 0 0 14px var(--tb1), 0 2px 4px #000; transition: opacity .2s; }
#tb-sync.hidden { opacity: 0; }
#tb-sync small { display: block; font-size: 45%; letter-spacing: .04em; font-weight: 700; margin-top: 2px; }
#tb-sync .tb-time { height: 5px; margin: 6px auto 0; width: 220px; border-radius: 3px; background: rgba(255,255,255,.2); overflow: hidden; }
#tb-sync .tb-time div { height: 100%; background: linear-gradient(90deg, var(--tb1), var(--tb2)); }
.touch #tb-sync { pointer-events: auto; }
.combo-lbl { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; font-weight: 900; font-size: 17px; letter-spacing: .04em;
  color: #fff; text-shadow: 0 0 10px var(--tb1), 0 2px 3px #000; pointer-events: none; }
.combo-lbl b { color: var(--tb2); font-size: 120%; }
.num.combohint { color: #a5f3fc; font-size: 15px; }
.num.tburst { color: #fff; font-size: 30px; text-shadow: 0 0 14px #67e8f9, 0 2px 4px #000; }
.combo-lbl.pair { font-size: 22px; color: #fff; text-shadow: 0 0 6px #fff, 0 0 18px var(--tb1), 0 0 28px var(--tb2), 0 2px 3px #000; }
.num.combopair { color: #fff; font-size: 26px; text-shadow: 0 0 12px #67e8f9, 0 2px 4px #000; }
`;

// A colour per team (party): two hues for the bar, the burst and the combo text.
export function teamColors(key) {
  const h = ((key | 0) * 137) % 360, h2 = (h + 40) % 360;
  return { c1: `hsl(${h}, 90%, 58%)`, c2: `hsl(${h2}, 95%, 70%)`, hex: hslHex(h, 0.9, 0.58) };
}
function hslHex(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

export function initTeamplay({ state, players, mobs, fx, sfx, floatNum, project, send, guide, isTouch, callout, shake, $ }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const sync = document.createElement('div'); sync.id = 'tb-sync'; sync.className = 'hidden'; $('hud').appendChild(sync);
  sync.addEventListener('pointerdown', () => press()); // touch: tap the prompt to join
  $('party').addEventListener('pointerdown', e => { if (e.target.closest?.('.tbar.full, .tbar.sync')) { e.stopPropagation(); press(); } });
  let rows = [], joinedAt = 0, fullSeen = false;
  const labels = new Map(); // mob id -> { el, until, n, k }
  const myKey = () => state.party || state.myId;
  const mine = () => rows.find(r => r[0] === myKey());
  const setColors = (el, key) => { const c = teamColors(key); el.style.setProperty('--tb1', c.c1); el.style.setProperty('--tb2', c.c2); };
  setColors(document.documentElement, 0);

  function press() {
    if (!state.joined || state.spectator || state.dead) return;
    send({ type: 'burst' });
  }

  function partyBar() {
    if (state.spectator) return '';
    const r = mine();
    if (!r) return '';
    const [key, g, left, ids] = r, open = left > 0, full = g >= BURST.max;
    const c = teamColors(key), solo = !state.party;
    const key1 = isTouch ? 'Tap' : '<kbd>T</kbd>';
    const right = open ? (ids.includes(state.myId) ? `IN ${ids.length}` : `${key1} JOIN`) : full ? `${key1} READY` : `${g}%`;
    return `<div class="tbar ${open ? 'sync' : full ? 'full' : ''}" style="--tb1:${c.c1};--tb2:${c.c2}" title="${solo ? 'Burst' : 'Team Burst'}: combos, Switches, Breaks, parries and revives fill it. Full: press T, partners press T to join."><div class="row"><span>${solo ? 'BURST' : 'TEAM BURST'}</span><span>${right}</span></div><div class="tb-track"><div class="tb-fill" style="width:${open ? 100 : g}%"></div></div></div>`;
  }

  function snap(w) {
    rows = w.tb || [];
    const r = mine();
    if (r && r[1] >= BURST.max && !r[2] && !fullSeen) { fullSeen = true; guide.tip('tbfull'); sfx.play('ui'); }
    if (!r || r[1] < BURST.max) fullSeen = false;
    // the sync prompt
    const open = r && r[2] > 0 && !state.spectator;
    sync.classList.toggle('hidden', !open);
    if (open) {
      setColors(sync, r[0]);
      const inMe = r[3].includes(state.myId), names = r[3].map(id => players.get(id)?.name || state.roster.get(id)?.name || '?').join(' · ');
      sync.innerHTML = `${inMe ? `SYNCED ×${r[3].length}` : `TEAM BURST! ${isTouch ? 'TAP' : 'PRESS T'}`}<small>${names}</small><div class="tb-time"><div style="width:${Math.min(100, (r[2] / BURST.sync) * 100)}%"></div></div>`;
    }
  }

  function comboLabel(m, e, pair) {
    let L = labels.get(m.id);
    if (!L) { const el = document.createElement('div'); el.className = 'combo-lbl'; $('labels').appendChild(el); labels.set(m.id, L = { el }); }
    setColors(L.el, players.get(e.by)?.party || e.by);
    L.el.classList.toggle('pair', !!pair); // the two players who made it: a brighter flash
    L.el.innerHTML = `${e.n > 1 ? `Combo <b>×${e.n}</b> · ` : ''}${COMBOS[e.k]?.name || e.k}`;
    L.until = performance.now() + 2600; L.at = performance.now(); L.m = m;
  }

  function event(e) {
    const me = state.myId;
    switch (e.t) {
      case 'tsetup': { // a partner's setup I can cash in: a hint over the target (only for me)
        if (state.spectator || e.by === me) return true;
        const m = mobs.get(e.id), ids = combosOf(e.k).filter(id => canPay(state.cls, id));
        if (!m || !ids.length) return true;
        floatNum(m.model.group.position, m.model.height + 1.1, `→ ${COMBOS[ids[0]].name}`, 'combohint');
        guide.tip(`combo_${ids[0]}`);
        return true;
      }
      case 'combo': {
        const m = mobs.get(e.id), ours = e.by === me || e.from === me;
        const col = teamColors(players.get(e.by)?.party || e.by).hex;
        fx.ring(e.x, e.z, (m?.def?.radius || 1) + 1.4, col, 0.45);
        fx.sparks?.(e.x, (m?.model.height || 2) * 0.6, e.z, 10, col, 0.22, 7);
        if (m) comboLabel(m, e, ours);
        if (ours && m) { // the pair: a flash on the target, a sound, the name in big letters
          fx.ring(e.x, e.z, (m.def?.radius || 1) + 2.6, 0xffffff, 0.3);
          floatNum(m.model.group.position, m.model.height * 0.9, `${(COMBOS[e.k]?.name || e.k).toUpperCase()}!`, 'combopair');
          sfx.play('switch');
          guide.tip('combo');
        }
        return true;
      }
      case 'tbsync':
        if (e.ids?.includes(me)) { sfx.play('warn'); if (e.by !== me) guide.tip('tbsync'); }
        return true;
      case 'tbjoin':
        if (e.id === me) { joinedAt = performance.now(); sfx.play('ui'); }
        return true;
      case 'tburst': {
        const c = teamColors(e.key), ours = e.ids?.includes(me) || e.key === myKey();
        for (let i = 0; i < 3; i++) setTimeout(() => fx.ring(e.x, e.z, 3 + i * 3 + e.n, c.hex, 0.6), i * 90);
        fx.sparks?.(e.x, 2, e.z, 24 + e.n * 6, c.hex, 0.3, 11);
        const m = mobs.get(e.m);
        if (m) floatNum(m.model.group.position, m.model.height + 0.6, e.n > 1 ? `TEAM BURST ×${e.n}` : 'BURST', 'tburst');
        sfx.play(e.n >= 4 ? 'clear' : 'boom');
        if (ours) { shake?.(0.25 + 0.05 * e.n); callout?.(e.n > 1 ? `TEAM BURST ×${e.n}` : 'BURST', e.n >= 4 ? 'Huge!' : e.n > 1 ? 'Synced!' : 'Solo burst', 1.4); }
        return true;
      }
    }
    return false;
  }

  function frame() {
    const now = performance.now();
    for (const [id, L] of labels) {
      const m = mobs.get(id);
      if (!m || now > L.until) { L.el.remove(); labels.delete(id); continue; }
      const g = m.model.group.position, p = project(g.x, g.y + m.model.height + 1.5, g.z);
      if (!p) { L.el.style.display = 'none'; continue; }
      const age = (now - L.at) / 1000, pop = age < 0.15 ? 1.35 - age * 2.3 : 1, fade = Math.min(1, (L.until - now) / 400);
      L.el.style.display = ''; L.el.style.left = `${p[0]}px`; L.el.style.top = `${p[1]}px`;
      L.el.style.opacity = fade; L.el.style.transform = `translate(-50%, -50%) scale(${pop})`;
    }
  }

  return { event, snap, frame, partyBar, press, joinedAt: () => joinedAt };
}
