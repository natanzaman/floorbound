// Post-fight MVP card on the client (docs/ROADMAP.md G5; server: server/mvp.js, data: shared/mvp.js).
// An 'mvp' event { ids, d, card, all?, secs? } shows the card after d s to the fighters in ids (everyone, spectators
// too, when all: a director cue). Closes on a click or tap anywhere, Esc, or after secs (default 25).
// main.js wiring: event(e).
import { CLASSES } from '/shared/data.js';
import { MVP_STATS, titleLine, headline, fmtSecs } from '/shared/mvp.js';

const CSS = `
#mvp { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 10px;
  background: radial-gradient(ellipse at 50% 35%, rgba(30,50,110,.35), rgba(4,7,18,.72)); backdrop-filter: blur(2px);
  opacity: 0; transition: opacity .35s; pointer-events: auto; }
#mvp.mv-on { opacity: 1; }
#mvp .mv-mc { touch-action: pan-y; position: relative; width: min(1000px, 100%); max-height: calc(100dvh - 20px); overflow-y: auto; overscroll-behavior: contain;
  padding: 16px 18px 12px; border-radius: 14px; background: linear-gradient(180deg, rgba(16,24,50,.96), rgba(10,15,32,.96));
  border: 1px solid rgba(160,200,255,.25); box-shadow: 0 0 70px rgba(80,140,255,.22), 0 20px 50px rgba(0,0,0,.5);
  transform: translateY(14px) scale(.98); transition: transform .35s cubic-bezier(.2,.9,.3,1.2); }
#mvp.mv-on .mv-mc { transform: none; }
#mvp.mv-wipe .mv-mc { border-color: rgba(248,113,113,.3); box-shadow: 0 0 70px rgba(220,60,60,.18), 0 20px 50px rgba(0,0,0,.5); }
#mvp .mv-mh { display: flex; align-items: center; gap: 6px 12px; flex-wrap: wrap; padding-right: 26px; }
#mvp .mv-res { font-weight: 900; font-size: 12px; letter-spacing: .2em; padding: 4px 10px; border-radius: 6px; color: #1a1205;
  background: linear-gradient(180deg, #fde68a, #d4a017); }
#mvp.mv-wipe .mv-res { color: #fff; background: linear-gradient(180deg, #f87171, #b91c1c); }
#mvp .mv-boss { font-size: clamp(17px, 2.6vw, 24px); font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
  background: linear-gradient(180deg, #fff, #9cc4ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
#mvp .mv-meta { font-size: 13px; opacity: .65; margin-left: auto; white-space: nowrap; }
#mvp .mv-x { position: absolute; top: 8px; right: 10px; border: 0; background: none; font-size: 22px; line-height: 1; opacity: .55; padding: 4px 6px; }
#mvp .mv-star { margin: 12px 0 12px; padding: 10px 14px; border-radius: 10px; display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap;
  background: linear-gradient(90deg, rgba(234,179,8,.22), rgba(234,179,8,.04)); border: 1px solid rgba(250,204,21,.35); }
#mvp .mv-star .mv-lbl { font-weight: 900; letter-spacing: .18em; font-size: 12px; color: #fde68a; }
#mvp .mv-star b { font-size: 19px; }
#mvp .mv-star .mv-stag { font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 4px; background: rgba(148,163,184,.25); color: #cbd5e1; }
#mvp .mv-star .mv-why { opacity: .8; font-size: 14px; }
#mvp .mv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 10px; }
#mvp .mv-t { position: relative; padding: 10px 12px 10px 14px; border-radius: 10px; background: rgba(255,255,255,.045);
  border: 1px solid rgba(160,200,255,.12); overflow: hidden; }
#mvp .mv-t::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--cc); }
#mvp .mv-t.mv-me { border-color: rgba(156,196,255,.55); background: rgba(120,170,255,.09); }
#mvp .mv-t.mv-isMvp { border-color: rgba(250,204,21,.5); }
#mvp .mv-nm { display: flex; align-items: baseline; gap: 6px; }
#mvp .mv-nm b { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mvp .mv-nm small { font-size: 11px; opacity: .6; white-space: nowrap; }
#mvp .mv-nm .mv-tag { font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 4px; letter-spacing: .06em; background: rgba(148,163,184,.25); color: #cbd5e1; }
#mvp .mv-nm .mv-tag.mv-you { background: rgba(96,165,250,.35); color: #e0ecff; }
#mvp .mv-nm .mv-mvpb { margin-left: auto; color: #facc15; font-weight: 900; font-size: 12px; letter-spacing: .1em; }
#mvp .mv-tt { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 8px; }
#mvp .mv-tt i { font-style: normal; font-size: 11px; padding: 2px 7px; border-radius: 10px; background: rgba(160,200,255,.12); color: #cfe0ff; }
#mvp .mv-tt i.mv-h { background: rgba(250,204,21,.2); color: #fde68a; font-weight: 800; }
#mvp .mv-tt i em { font-style: normal; opacity: .7; font-weight: 400; }
#mvp .mv-big { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
#mvp .mv-big div { min-width: 0; }
#mvp .mv-big label { display: block; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; opacity: .6; }
#mvp .mv-big b { display: block; font-size: 17px; font-variant-numeric: tabular-nums; }
#mvp .mv-big .mv-top b { color: #fde68a; }
#mvp .mv-bar { height: 4px; border-radius: 2px; background: rgba(255,255,255,.08); margin-top: 3px; overflow: hidden; }
#mvp .mv-bar span { display: block; height: 100%; background: var(--cc); }
#mvp .mv-cnt { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; font-size: 12px; opacity: .85; }
#mvp .mv-cnt span b { font-variant-numeric: tabular-nums; }
#mvp .mv-cnt .mv-top b { color: #fde68a; }
#mvp .mv-cnt .mv-bad b { color: #fca5a5; }
#mvp .mv-cnt .mv-none { opacity: .45; }
#mvp .mv-ft { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 12px; opacity: .55; }
#mvp .mv-ft .mv-tm { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,.1); overflow: hidden; }
#mvp .mv-ft .mv-tm span { display: block; height: 100%; width: 100%; background: #9cc4ff; transform-origin: left; }
@media (max-width: 600px) {
  #mvp { padding: 6px; place-items: start center; }
  #mvp .mv-mc { padding: 12px 12px 10px; max-height: calc(100dvh - 12px); }
  #mvp .mv-meta { margin-left: 0; width: 100%; }
  #mvp .mv-grid { grid-template-columns: 1fr; gap: 7px; }
  #mvp .mv-star { margin: 10px 0; padding: 8px 10px; }
  #mvp .mv-star b { font-size: 16px; }
  #mvp .mv-t { padding: 8px 10px 8px 12px; }
  #mvp .mv-tt { margin: 4px 0 6px; }
  #mvp .mv-big b { font-size: 15px; }
}
@media (max-height: 520px) and (min-width: 601px) { #mvp .mv-grid { grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); } #mvp .mv-star { margin: 8px 0; } }
`;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => (v >= 10000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : Math.round(v).toLocaleString('en-US'));
const clsColor = c => '#' + (CLASSES[c]?.color ?? 0x9cc4ff).toString(16).padStart(6, '0');

// The card's HTML (exported for tests / previews).
export function cardHtml(card, myId = 0) {
  const win = card.result === 'kill', best = {};
  for (const s of MVP_STATS) best[s.k] = Math.max(1, ...card.rows.map(r => r[s.k] || 0));
  const mvp = card.rows.find(r => r.id === card.mvp), hl = mvp && headline(mvp);
  const tile = r => {
    const top = new Set(r.top || []);
    const titles = (r.titles?.length ? r.titles : ['steady']).map((k, i) => { const t = titleLine(k, r); return `<i class="${i ? '' : 'mv-h'}" title="${esc(t.why)}">${esc(t.name)}${i ? '' : ` <em>· ${esc(t.why)}</em>`}</i>`; }).join('');
    const big = MVP_STATS.filter(s => s.big).map(s => `<div class="${top.has(s.k) ? 'mv-top' : ''}"><label>${s.name}</label><b>${num(r[s.k] || 0)}</b><div class="mv-bar"><span style="width:${Math.round(((r[s.k] || 0) / best[s.k]) * 100)}%"></span></div></div>`).join('');
    const counts = MVP_STATS.filter(s => !s.big && r[s.k]).map(s => `<span class="${s.bad ? 'mv-bad' : top.has(s.k) ? 'mv-top' : ''}">${s.k === 'lastAttack' ? `<b>★</b> ${s.name}` : `<b>${r[s.k]}</b> ${esc(r[s.k] === 1 ? s.one || s.name : s.name)}`}</span>`).join('');
    const cls = CLASSES[r.cls];
    return `<div class="mv-t${r.id === myId ? ' mv-me' : ''}${r.id === card.mvp ? ' mv-isMvp' : ''}" style="--cc:${clsColor(r.cls)}">
      <div class="mv-nm"><b>${esc(r.name)}</b>${r.bot ? '<span class="mv-tag">BOT</span>' : ''}${r.id === myId ? '<span class="mv-tag mv-you">YOU</span>' : ''}<small>${esc(cls?.name || r.cls)}${r.lvl ? ` · Lv ${r.lvl}` : ''}</small>${r.id === card.mvp ? '<span class="mv-mvpb">★ MVP</span>' : ''}</div>
      <div class="mv-tt">${titles}</div><div class="mv-big">${big}</div><div class="mv-cnt">${counts || '<span class="mv-none">No team plays this time</span>'}</div></div>`;
  };
  const bots = card.rows.filter(r => r.bot).length;
  return `<div class="mv-mc" role="dialog" aria-label="Fight summary"><button class="mv-x" aria-label="Close">×</button>
    <div class="mv-mh"><span class="mv-res">${win ? 'VICTORY' : 'WIPE'}</span><span class="mv-boss">${esc(card.boss)}</span>
      <span class="mv-meta">Floor ${card.floor} · ${fmtSecs(card.secs)} · ${card.rows.length} fighter${card.rows.length > 1 ? 's' : ''}${bots ? ` (${bots} bot${bots > 1 ? 's' : ''})` : ''}</span></div>
    ${mvp ? `<div class="mv-star"><span class="mv-lbl">★ MVP</span><b>${esc(mvp.name)}</b>${mvp.bot ? '<span class="mv-stag">BOT</span>' : ''}<span class="mv-why">${esc(hl.name)} · ${esc(hl.why)}</span></div>` : ''}
    <div class="mv-grid">${card.rows.map(tile).join('')}</div>
    <div class="mv-ft"><span>Click, tap or Esc to close</span><div class="mv-tm"><span></span></div></div></div>`;
}

export function initMvp({ state, guide }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  let el = null, timer = 0, wait = 0;

  function close() {
    clearTimeout(timer); clearTimeout(wait);
    if (!el) return;
    const e = el; el = null;
    e.classList.remove('mv-on');
    guide?.tip('mvp');
    setTimeout(() => e.remove(), 350);
  }
  function show(card, secs) {
    close();
    el = document.createElement('div'); el.id = 'mvp'; el.dataset.nav = 'mvp'; // (controller: A on ✕ or B closes it)
    if (card.result !== 'kill') el.classList.add('mv-wipe');
    el.innerHTML = cardHtml(card, state.myId);
    document.body.appendChild(el);
    const bar = el.querySelector('.mv-ft .mv-tm span');
    requestAnimationFrame(() => {
      el?.classList.add('mv-on');
      if (bar) { bar.style.transition = `transform ${secs}s linear`; requestAnimationFrame(() => { bar.style.transform = 'scaleX(0)'; }); }
    });
    timer = setTimeout(close, secs * 1000);
    state.mvpCard = card; // (tests, previews)
  }
  // A click or tap anywhere (also with the mouse captured) or Esc closes it; nothing else in the game reacts to that click.
  // Touch: a drag scrolls a long card (a click only fires for a tap).
  const open = () => el?.classList.contains('mv-on');
  addEventListener('pointerdown', e => {
    if (!el) return;
    e.stopPropagation(); // no attack, camera drag or joystick under the card
    if (document.pointerLockElement && open()) { close(); e.preventDefault(); }
  }, true);
  addEventListener('click', e => { if (el && open()) { close(); e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('keydown', e => { if (el && e.key === 'Escape') { close(); e.stopPropagation(); } }, true);

  function event(e) {
    if (e.t !== 'mvp') return false;
    const mine = e.all || (!state.spectator && e.ids?.includes(state.myId));
    if (!mine || !e.card?.rows?.length) return true;
    clearTimeout(wait);
    wait = setTimeout(() => show(e.card, e.secs || 25), (e.d || 0) * 1000);
    return true;
  }
  return { event, close, isOpen: () => !!el };
}
