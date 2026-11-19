// Loot and builds on the client (H2): affix lines, set tags, the item tooltip card, the Sets and Loadouts sections of
// the bag (character sheet). Data and text: shared/loot.js. The server validates everything (server/loot.js).
import { inTown } from '/shared/data.js';
import { RARITY, SLOTS, statLabel } from '/shared/items.js';
import { SETS, affixText, isTeamAffix, setProgress, setCounts, setSize } from '/shared/loot.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const LOADOUTS = 3;

const CSS = `
.ax-l { display: block; color: #a5f3fc; opacity: .95; }
.ax-l.team { color: #fda4af; }
.ax-l::before { content: '◆ '; font-size: 9px; opacity: .7; }
.set-tag { display: inline-block; font-weight: 700; font-size: 11px; margin-left: 4px; padding: 0 5px; border-radius: 5px; border: 1px solid currentColor; line-height: 15px; }
#bag .sets .set { border: 1px solid rgba(160,200,255,.18); border-radius: 9px; padding: 6px 8px; margin: 4px 0; }
#bag .sets .set b { font-size: 13px; }
#bag .sets .pips { float: right; letter-spacing: 2px; }
#bag .sets .tier { font-size: 12px; opacity: .45; line-height: 1.35; margin-top: 2px; }
#bag .sets .tier.on { opacity: 1; color: #e2e8f0; }
#bag .sets .tier i { font-style: normal; font-weight: 700; margin-right: 4px; }
#bag .lo .it.cur { border-color: rgba(74,222,128,.5); background: rgba(74,222,128,.06); }
#bag .lo .it button.armed, #bag .lo .it button.warn { background: #b45309; }
#bag .lo-hint, #bag .sets-hint { display: block; font-size: 11px; opacity: .55; margin: 2px 0 4px; }
#itemtip { position: fixed; z-index: 30; pointer-events: none; width: 250px; padding: 9px 11px; border-radius: 10px; font-size: 12px; line-height: 1.4;
  background: rgba(10,14,24,.96); border: 1px solid rgba(160,200,255,.35); box-shadow: 0 8px 28px rgba(0,0,0,.5); color: #e5e7eb; }
#itemtip .h { font-weight: 800; font-size: 14px; }
#itemtip .sub { font-size: 11px; opacity: .65; margin-bottom: 5px; }
#itemtip .st { color: #f8fafc; }
#itemtip .sep { border-top: 1px solid rgba(160,200,255,.18); margin: 6px 0; }
#itemtip .set-h { font-weight: 700; }
#itemtip .tier { opacity: .45; } #itemtip .tier.on { opacity: 1; }
#itemtip .tier i { font-style: normal; font-weight: 700; margin-right: 3px; }
#itemtip .cmp { font-size: 11px; opacity: .7; font-style: italic; margin-top: 5px; }
`;

// Affix lines for an item (inside a row's <small>). cls: the viewer's class.
export const axHtml = (it, cls) => (it?.ax || []).map(a => `<span class="ax-l${isTeamAffix(a) ? ' team' : ''}">${esc(affixText(a, cls))}</span>`).join('');
// "Hornbound 2/3" next to a set piece's name (count of that set worn).
export function setTagHtml(it, eq) {
  const S = it?.set && SETS[it.set];
  if (!S) return '';
  return `<span class="set-tag" style="color:${S.color}" title="${esc(S.name)} set (from ${esc(S.from)})">${esc(S.name)} ${setCounts(eq)[it.set] || 0}/${setSize(it.set)}</span>`;
}

// The hover card: name, rarity, stats, affixes, the set and its bonuses.
export function tipHtml(it, eq, cls, worn) {
  if (!it) return '';
  const R = RARITY[it.r] || RARITY[0];
  let h = `<div class="h" style="color:${it.set ? SETS[it.set]?.color : R.color}">${esc(it.name)}</div>`;
  h += `<div class="sub">${R.name}${it.set ? ' · set piece' : ''} ${esc(it.slot)}${it.lv ? ` · refined +${it.lv}` : ''}${worn ? ' · worn' : ''}</div>`;
  if (it.ks) return `${h}<div>${esc(it.desc || '')}</div>`;
  h += Object.entries(it.st || {}).map(([k, v]) => `<div class="st">${esc(statLabel(k, v))}</div>`).join('');
  if (it.ax?.length) h += `<div class="sep"></div>${axHtml(it, cls)}`;
  const S = it.set && SETS[it.set];
  if (S) {
    const prog = setProgress(eq, cls, true).find(x => x.id === it.set);
    h += `<div class="sep"></div><div class="set-h" style="color:${S.color}">${esc(S.name)} (${prog.have}/${prog.size} worn)</div>`;
    h += prog.tiers.map(t => `<div class="tier${t.on ? ' on' : ''}"><i>${t.n}:</i>${t.lines.map(esc).join('; ')}</div>`).join('');
    h += `<div class="sub" style="margin:4px 0 0">Drops from ${esc(S.from)}</div>`;
  }
  return h;
}

export function initLoot({ state, send, $, styleTitle = () => '', fx, sfx, guide, players, floatNum }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const tip = document.createElement('div'); tip.id = 'itemtip'; tip.style.display = 'none'; document.body.appendChild(tip);
  const ui = { arm: -1, armT: 0 };

  const findItem = u => {
    const inv = state.inv; if (!inv) return null;
    for (const s of SLOTS) if (inv.eq[s]?.u === u) return { it: inv.eq[s], worn: true };
    const it = inv.bag.find(x => x.u === u);
    return it ? { it, worn: false } : null;
  };

  // Hover cards on any panel whose rows carry data-tu="<item uid>".
  function bindTips(el) {
    el.addEventListener('mousemove', e => {
      const row = e.target.closest('[data-tu]');
      const f = row && findItem(+row.dataset.tu);
      if (!f) { tip.style.display = 'none'; return; }
      const st = styleTitle(f.it), html = tipHtml(f.it, state.inv.eq, state.cls, f.worn) + (st ? `<div class="sep"></div><div class="sub" style="margin:0">${esc(st)}</div>` : '');
      if (tip.innerHTML !== html) tip.innerHTML = html;
      tip.style.display = '';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX - w - 14, y = e.clientY + 12;
      if (x < 6) x = e.clientX + 16;
      if (y + h > innerHeight - 6) y = innerHeight - h - 6;
      tip.style.left = `${x}px`; tip.style.top = `${Math.max(6, y)}px`;
    });
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }
  const hideTip = () => { tip.style.display = 'none'; };

  // Extra lines under an item's stats in the bag rows.
  const lines = it => axHtml(it, state.cls);
  const setTag = it => setTagHtml(it, state.inv?.eq);

  // ---------- Sets (character sheet) ----------
  function setsHtml(inv) {
    const worn = setProgress(inv.eq, state.cls);
    const inBag = Object.keys(SETS).filter(id => !worn.some(w => w.id === id) && inv.bag.some(it => it.set === id));
    if (!worn.length && !inBag.length) return '';
    let h = '<h4>Sets</h4><div class="sets">';
    h += worn.map(s => `<div class="set"><b style="color:${s.color}">${esc(s.name)}</b><span class="pips" style="color:${s.color}">${'●'.repeat(s.have)}${'○'.repeat(Math.max(0, s.size - s.have))}</span>`
      + s.tiers.map(t => `<div class="tier${t.on ? ' on' : ''}"><i>${t.n} pieces</i>${t.lines.map(esc).join(' · ')}</div>`).join('') + '</div>').join('');
    if (inBag.length) h += `<small class="sets-hint">In your bag: ${inBag.map(id => `<span style="color:${SETS[id].color}">${esc(SETS[id].name)}</span>`).join(', ')} (wear 2 pieces for a bonus)</small>`;
    return `${h}</div>`;
  }

  // ---------- Loadouts ----------
  const canSwap = () => !state.dead && state.joined && inTown(state.x, state.z);
  const sameTal = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
  function loadoutsHtml(inv) {
    const lo = inv.lo || [], swap = canSwap();
    if (state.lvl >= 6) guide?.tip('loadout'); // once
    let h = `<h4>Loadouts</h4><div class="lo"><small class="lo-hint">Save your worn gear (the weapon brings its style) and talents. Swap in town or at a camp, out of combat.</small>`;
    for (let i = 0; i < LOADOUTS; i++) {
      const L = lo[i];
      if (!L) { h += `<div class="it empty"><span class="slot">${i + 1}</span><span class="nm"><small>Empty</small></span><button data-a="loSave" data-i="${i}">Save current</button></div>`; continue; }
      const parts = SLOTS.map(s => { const u = L.eq?.[s]; if (!u) return null; const f = findItem(u); return f ? `<span class="r${f.it.r}">${esc(f.it.name)}</span>` : `<span style="opacity:.5">${s} missing</span>`; }).filter(Boolean);
      const pts = Object.values(L.tal || {}).reduce((a, b) => a + b, 0);
      const cur = SLOTS.every(s => !L.eq?.[s] || inv.eq[s]?.u === L.eq[s]) && sameTal(L.tal, state.talentAlloc);
      const armed = ui.arm === i && performance.now() < ui.armT;
      h += `<div class="it${cur ? ' cur' : ''}"><span class="slot">${i + 1}</span><span class="nm"><b>${esc(L.n)}${cur ? ' <span class="up">worn</span>' : ''}</b><small>${parts.join(' · ') || 'no gear'} · ${pts} talent pts</small></span>`
        + `<button data-a="loUse" data-i="${i}" ${swap && !cur ? '' : 'disabled style="opacity:.4"'} title="${swap ? 'Wear this loadout' : 'Only in town or at a camp'}">Equip</button>`
        + `<button data-a="loSave" data-i="${i}" class="${armed ? 'armed' : ''}" title="Overwrite with what you wear now">${armed ? 'Sure?' : 'Save'}</button>`
        + `<button data-a="loName" data-i="${i}" title="Rename">✎</button><button class="del" data-a="loClear" data-i="${i}" title="Clear">✕</button></div>`;
    }
    return `${h}</div>`;
  }

  // Bag clicks for the loadout buttons. Returns true when handled.
  function click(b) {
    const a = b.dataset.a, i = +b.dataset.i;
    if (!a?.startsWith('lo')) return false;
    const L = state.inv?.lo?.[i];
    if (a === 'loSave') {
      if (L && !(ui.arm === i && performance.now() < ui.armT)) { ui.arm = i; ui.armT = performance.now() + 3000; return 'render'; } // overwrite: confirm
      ui.arm = -1;
      send({ type: 'loadout', op: 'save', i });
    } else if (a === 'loUse') send({ type: 'loadout', op: 'use', i });
    else if (a === 'loClear') send({ type: 'loadout', op: 'clear', i });
    else if (a === 'loName' && L) {
      const name = prompt('Name this loadout', L.n);
      if (name != null) send({ type: 'loadout', op: 'rename', i, name: name.slice(0, 20) });
    }
    return true;
  }

  // A set piece in a drop: a beam in the set's colour and a tip; any gear with affixes: the affix tip.
  function onLoot(e) {
    const set = e.items.find(it => it.set && SETS[it.set]);
    if (set) { fx?.beam(e.x, e.z, parseInt(SETS[set.set].color.slice(1), 16), 4.5); guide?.tip('setpiece'); }
    else if (state.inv?.bag.some(it => it.ax?.length)) guide?.tip('affix');
  }
  // { t: 'loadout', id, i, x, z }: someone swapped loadouts.
  function event(e) {
    if (e.t !== 'loadout') return false;
    fx?.ring(e.x, e.z, 1.6, 0x4ade80, 0.5);
    if (e.id === state.myId) {
      sfx?.play('evolve');
      const p = players?.get(e.id), L = state.inv?.lo?.[e.i];
      if (p && floatNum) floatNum(p.model.group.position, 3.1, L?.n || `Loadout ${e.i + 1}`, 'talent');
    }
    return true;
  }

  return { lines, setTag, setsHtml, loadoutsHtml, click, bindTips, hideTip, canSwap, onLoot, event };
}
