// Your own bars over your character, and clearer feedback when you're hurt (docs/briefs/selfbar.md).
//   Bar: health (green → amber → red as it drops), a pale "just lost" chunk that drains after a hit, and a thin
//   stamina line under it: the dodge charge (empty right after a dodge, full when you can dodge again). The game has
//   no mana; the dodge is its stamina.
//   Hurt: a red pulse on the screen edges (stronger for bigger hits), the bar shakes and flashes, your character
//   flashes red, a bigger number for a big hit; under 30% health the edges keep a slow red pulse.
// Settings → Accessibility: "Hide the bar over your character" (hideSelfBar), "No red damage flash" (noHurtFlash).
const CSS = `
#selfbar { position: absolute; left: 0; top: 0; width: 74px; pointer-events: none; z-index: 2; will-change: transform; }
#selfbar.off { display: none; }
#selfbar .sb-hp { position: relative; height: 7px; border-radius: 4px; background: rgba(8,12,22,.78); box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.5); overflow: hidden; }
#selfbar .sb-lost { position: absolute; left: 0; top: 0; bottom: 0; background: #fde2e2; transition: width .45s ease-in .25s; }
#selfbar .sb-fill { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(#5eea8f, #22c55e); transition: width .08s linear; }
#selfbar.mid .sb-fill { background: linear-gradient(#fcd34d, #f59e0b); }
#selfbar.low .sb-fill { background: linear-gradient(#fb7185, #e11d48); }
#selfbar .sb-st { margin: 2px auto 0; width: 86%; height: 3px; border-radius: 2px; background: rgba(8,12,22,.7); overflow: hidden; box-shadow: 0 0 0 1px rgba(0,0,0,.45); }
#selfbar .sb-st i { display: block; height: 100%; width: 100%; background: #7dd3fc; }
#selfbar .sb-st.empty i { background: #38bdf8; opacity: .55; }
#selfbar.hit .sb-hp { animation: sb-hit .32s ease-out; }
@keyframes sb-hit { 0% { transform: translateX(0) scale(1.15); box-shadow: 0 0 0 1px #fff, 0 0 10px #ef4444; } 25% { transform: translateX(-3px) scale(1.1); } 50% { transform: translateX(3px) scale(1.05); } 75% { transform: translateX(-1px); } 100% { transform: none; } }
#hurtfx { position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: 0;
  background: radial-gradient(ellipse at center, rgba(220,20,30,0) 52%, rgba(220,20,30,.55) 88%, rgba(170,0,10,.85) 100%); }
#hurtfx.low { animation: hurt-low 1.4s ease-in-out infinite; }
@keyframes hurt-low { 0%, 100% { opacity: .18; } 50% { opacity: .38; } }
.num.hurt.big { font-size: 1.45em; color: #ff4d4d; text-shadow: 0 0 6px rgba(255,0,0,.6), 0 2px 3px #000; }
`;

export function initSelfBar({ state, players, project, settings, hud }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'selfbar'; el.className = 'off';
  el.innerHTML = '<div class="sb-hp"><div class="sb-lost"></div><div class="sb-fill"></div></div><div class="sb-st"><i></i></div>';
  hud.appendChild(el);
  const fill = el.querySelector('.sb-fill'), lost = el.querySelector('.sb-lost'), stBar = el.querySelector('.sb-st'), stFill = stBar.firstChild;
  const vig = document.createElement('div'); vig.id = 'hurtfx'; document.body.appendChild(vig);
  const ui = { pct: -1, tr: '', band: '', pulse: 0, dodgeAt: 0, dodgeEnd: 0, st: -1, hitT: 0 };

  // A hit on you: amount a, big hit or not.
  function hurt(a, big) {
    const frac = state.maxHp ? a / state.maxHp : 0.1;
    if (!settings.noHurtFlash) ui.pulse = Math.max(ui.pulse, Math.min(1, 0.35 + frac * 3 + (big ? 0.35 : 0)));
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); // restart the shake
    clearTimeout(ui.hitT); ui.hitT = setTimeout(() => el.classList.remove('hit'), 340);
    const me = players.get(state.myId);
    if (me) me.hurtRed = 0.28; // main.js tints the model red while this runs down
  }

  // Every frame.
  function frame(dt, now) {
    // the screen edges: a hit's pulse fades over ~0.6 s; low health keeps a slow pulse (CSS)
    const alive = state.joined && !state.dead && !state.spectator;
    const lowHp = alive && state.maxHp && state.hp / state.maxHp < 0.3 && !settings.noHurtFlash;
    vig.classList.toggle('low', lowHp && ui.pulse <= 0.05);
    if (ui.pulse > 0) { ui.pulse = Math.max(0, ui.pulse - dt * 1.2); vig.style.opacity = ui.pulse.toFixed(3); }
    else if (!lowHp && vig.style.opacity !== '0') vig.style.opacity = '0';

    const me = players.get(state.myId);
    const show = alive && me && !settings.hideSelfBar;
    el.classList.toggle('off', !show);
    if (!show) return;
    const g = me.model.group.position;
    const p = project(g.x, g.y + (me.model.height || 1.8) + 0.95, g.z);
    if (!p) { el.classList.add('off'); return; }
    const tr = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -100%)`;
    if (tr !== ui.tr) { ui.tr = tr; el.style.transform = tr; }
    const pct = Math.max(0, Math.min(100, Math.round((state.hp / (state.maxHp || 1)) * 100)));
    if (pct !== ui.pct) {
      if (pct < ui.pct) lost.style.width = `${ui.pct}%`; // the lost chunk starts where the bar was, then drains
      ui.pct = pct; fill.style.width = `${pct}%`;
      requestAnimationFrame(() => { lost.style.width = `${pct}%`; });
      const band = pct < 30 ? 'low' : pct < 60 ? 'mid' : '';
      if (band !== ui.band) { el.classList.remove(ui.band || 'x'); if (band) el.classList.add(band); ui.band = band; }
    }
    // stamina: the dodge charge (state.dodgeReady: when you can dodge again)
    const ready = state.dodgeReady || 0;
    // (snapshots nudge dodgeReady a little all the time: only a later end, or one after the last ran out, starts a new charge)
    if (ready > now && (!(ui.dodgeEnd > now) || ready > ui.dodgeEnd + 150)) ui.dodgeAt = now;
    ui.dodgeEnd = ready;
    const s = ready > now ? Math.round(Math.max(0, Math.min(1, (now - ui.dodgeAt) / Math.max(1, ready - ui.dodgeAt))) * 100) : 100;
    if (s !== ui.st) { ui.st = s; stFill.style.width = `${s}%`; stBar.classList.toggle('empty', s < 100); }
  }
  return { hurt, frame };
}
