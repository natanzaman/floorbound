// Compact item cards for the bag, the merchant and the Smith (plan: docs/briefs/item-cards.md).
// A card shows the essentials: an icon for the slot, the name in its rarity colour, its stats in short form
// ("+12% DMG · +5% Crit"), small badges (refine level, bonus count, set, style) and one main button. Everything else
// (affix lines, the style's passive, set bonuses, the other buttons) waits behind the ⋯ button or a tap on the card,
// and on desktop the hover card (public/loot.js tipHtml) shows the full details without a click.
import { RARITY } from '/shared/items.js';
import { SETS } from '/shared/loot.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ICON = { weapon: '⚔', armor: '⛨', charm: '◈', weapon2: '⚔' };
const SHORT = {
  atk: v => `+${v}% DMG`, hp: v => `+${v}% HP`, dr: v => `−${v}% dmg taken`,
  crit: v => `+${v}% Crit`, haste: v => `+${v}% Haste`, sw: v => `+${v}% Switch`,
};
// A stat's short name, for a change ("+3% DMG" better, "−2% Dmg reduction" worse).
const NAME = { atk: 'DMG', hp: 'HP', dr: 'Dmg reduction', crit: 'Crit', haste: 'Haste', sw: 'Switch' };
export const statDelta = (k, d) => `${d > 0 ? '+' : '−'}${Math.abs(d)}% ${NAME[k] || k}`;
// One stat in short form (the hover card and the expanded card keep the full sentence: shared/items.js statLabel).
export const shortStat = (k, v) => (SHORT[k] ? SHORT[k](v) : `${k} ${v}`);
export const shortStats = st => Object.entries(st || {}).map(([k, v]) => `<i class="ic-st">${esc(shortStat(k, v))}</i>`).join('');

const CSS = `
.ic { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 2px 8px; padding: 6px 7px 6px 6px; margin-bottom: 4px;
  border-radius: 9px; border: 1px solid rgba(255,255,255,.07); border-left: 3px solid var(--rc, #e5e7eb); background: rgba(255,255,255,.035); cursor: pointer; }
.ic:hover { background: rgba(255,255,255,.06); }
.ic.open { background: rgba(120,170,255,.08); border-color: rgba(160,200,255,.28); border-left-color: var(--rc, #e5e7eb); }
.ic.cur { border-color: rgba(74,222,128,.45); border-left-color: var(--rc); }
.ic .ic-ico { width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center; font-size: 17px; line-height: 1;
  color: var(--rc); background: color-mix(in srgb, var(--rc) 14%, transparent); border: 1px solid color-mix(in srgb, var(--rc) 35%, transparent); }
.ic .ic-ico.txt { font-size: 10px; font-weight: 800; letter-spacing: .02em; }
.ic .ic-main { min-width: 0; }
.ic .ic-nm { display: flex; align-items: baseline; gap: 5px; font-weight: 700; font-size: 13px; color: var(--rc); white-space: nowrap; overflow: hidden; }
.ic .ic-nm > span.n { overflow: hidden; text-overflow: ellipsis; }
.ic .ic-sum { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 11.5px; margin-top: 1px; color: #e2e8f0; }
.ic .ic-sum i { font-style: normal; }
.ic .ic-sum .ic-st { font-weight: 600; }
.ic .ic-sum .ic-dim { opacity: .55; }
.ic .ic-b { font-size: 10px; font-weight: 800; padding: 0 4px; border-radius: 4px; line-height: 15px; flex: none; border: 1px solid currentColor; }
.ic .ic-b.lv { color: #fcd34d; }
.ic .ic-b.ax { color: #a5f3fc; }
.ic .ic-b.set { color: var(--sc); }
.ic .ic-b.sty { color: #c4b5fd; border-style: dashed; }
.ic .ic-b.no { color: #f87171; }
.ic .ic-b.new { color: #4ade80; }
.ic .up { color: #4ade80; font-weight: 800; font-size: 11.5px; }
.ic .down { color: #f87171; font-size: 11.5px; }
.ic .ic-act { display: flex; gap: 4px; align-items: center; }
.ic .ic-act button { padding: 5px 10px; border-radius: 7px; border: 1px solid rgba(160,200,255,.35); background: rgba(120,170,255,.15); font-size: 12px; font-weight: 600; }
.ic .ic-act button:disabled { opacity: .35; cursor: default; }
.ic .ic-act button.sell, .ic .ic-more button.sell { border-color: rgba(252,211,77,.45); background: rgba(252,211,77,.12); color: #fde68a; }
.ic .ic-act button.buy { border-color: rgba(252,211,77,.45); background: rgba(252,211,77,.12); color: #fde68a; min-width: 52px; }
.ic .ic-act button.more { padding: 5px 7px; background: transparent; border-color: rgba(160,200,255,.2); opacity: .8; font-weight: 800; letter-spacing: .05em; }
.ic.open .ic-act button.more { background: rgba(160,200,255,.18); opacity: 1; }
.ic .ic-more { grid-column: 1 / -1; margin-top: 5px; padding-top: 6px; border-top: 1px solid rgba(160,200,255,.15); font-size: 12px; line-height: 1.4; cursor: default; }
.ic .ic-more .st { color: #f8fafc; }
.ic .ic-more .sub { font-size: 11px; opacity: .65; margin-bottom: 3px; }
.ic .ic-more .sep { border-top: 1px solid rgba(160,200,255,.12); margin: 5px 0; }
.ic .ic-more .tier { opacity: .45; } .ic .ic-more .tier.on { opacity: 1; }
.ic .ic-more .tier i { font-style: normal; font-weight: 700; margin-right: 3px; }
.ic .ic-more .set-h { font-weight: 700; }
.ic .ic-more .h { display: none; }
.ic .ic-more .desc { opacity: .8; }
.ic .ic-btns { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.ic .ic-btns button { padding: 5px 10px; border-radius: 7px; border: 1px solid rgba(160,200,255,.35); background: rgba(120,170,255,.12); font-size: 12px; }
.ic .ic-btns button.del { border-color: rgba(248,113,113,.4); background: rgba(248,113,113,.1); }
.ic .ic-btns button.del.armed, .ic .ic-btns button.armed { background: #b91c1c; color: #fff; }
.ic .ic-btns button:disabled { opacity: .35; cursor: default; }
.ic.empty { opacity: .45; cursor: default; }
.ic.empty .ic-ico { color: #94a3b8; background: transparent; border-style: dashed; border-color: rgba(148,163,184,.4); }
.ic-tabs { display: flex; gap: 4px; margin: 6px 0 8px; }
.ic-tabs button { flex: 1; padding: 6px 0; border-radius: 8px; border: 1px solid rgba(160,200,255,.22); background: rgba(255,255,255,.03); font-size: 12px; font-weight: 700; letter-spacing: .03em; }
.ic-tabs button.on { background: rgba(120,170,255,.2); border-color: rgba(160,200,255,.6); color: #dbeafe; }
.ic-tabs button.shoptab.on { background: rgba(252,211,77,.18); border-color: rgba(252,211,77,.6); color: #fde68a; }
.ic-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin: 4px 0 2px; }
.ic-stats span { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; padding: 3px 7px; border-radius: 6px; background: rgba(255,255,255,.04); font-size: 10.5px; opacity: .9; white-space: nowrap; }
.ic-stats b { font-size: 13px; color: #f8fafc; }
.ic-stats b.dim { opacity: .45; font-weight: 600; }
.ic.empty.slim { padding: 3px 7px 3px 6px; }
.ic.empty.slim .ic-ico { width: 22px; height: 22px; font-size: 13px; margin-left: 4px; }
.ic .ic-cmp, #itemtip .ic-cmp { margin-top: 2px; font-size: 11.5px; }
#itemtip .up, .ic-more .up { color: #4ade80; font-weight: 700; } #itemtip .down, .ic-more .down { color: #f87171; }
.ic .ic-foot { display: block; margin-top: 3px; font-size: 11px; }
.ic .ic-next { color: #86efac; font-size: 11px; font-weight: 600; }
.ic .ic-axrow { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px; font-size: 11.5px; }
.ic .ic-axrow button { padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(160,200,255,.35); background: rgba(120,170,255,.12); font-size: 11px; flex: none; }
.ic .ic-axrow button:disabled { opacity: .35; }
.ic .ic-act button.warn { border-color: rgba(248,113,113,.7); background: rgba(248,113,113,.25); }
.ic .ic-act.col { flex-direction: column; align-items: stretch; }
.ic-hint { display: block; font-size: 11px; opacity: .55; margin: 0 0 6px; line-height: 1.35; }
.ic-cost { display: flex; flex-wrap: wrap; gap: 2px 7px; font-size: 11px; margin-top: 2px; }
.ic-cost span { color: var(--c, #e5e7eb); white-space: nowrap; }
.ic-cost span.g { color: #fcd34d; }
.ic-cost span.no { color: #f87171; }
.ic-cost i { font-style: normal; opacity: .55; }
.touch .ic .ic-act button, .touch .ic .ic-btns button { padding: 7px 12px; }
`;
let styled = false;
export function injectCss() {
  if (styled) return; styled = true;
  const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
}

// it: the item; o: { key, open, worn, cls, eq, cmp (html), main (buttons html), more (extra html for the open card),
// btns (secondary buttons html), badges (extra badge html), cur, foot (html under the summary: a cost, a yield),
// noMore (no ⋯ button) }
export function cardHtml(it, o = {}) {
  const R = RARITY[it.r] || RARITY[0];
  const S = it.set && SETS[it.set];
  const rc = S ? S.color : R.color;
  const badges = [];
  if (it.lv) badges.push(`<span class="ic-b lv" title="Refined +${it.lv}">+${it.lv}</span>`);
  if (S) badges.push(`<span class="ic-b set" style="--sc:${S.color}" title="${esc(S.name)} set">${esc(S.name)}${o.setCount != null ? ` ${o.setCount}` : ''}</span>`);
  if (o.badges) badges.push(o.badges);
  const sum = it.ks ? `<i class="ic-dim">Keepsake</i>` : shortStats(it.st)
    + (it.ax?.length ? `<i class="ic-dim">+${it.ax.length} bonus${it.ax.length > 1 ? 'es' : ''}</i>` : '')
    + (o.sumExtra || '');
  const key = o.key ?? it.u;
  return `<div class="ic${o.open ? ' open' : ''}${o.cur ? ' cur' : ''}" style="--rc:${rc}" data-ic="${esc(key)}"${it.u ? ` data-tu="${it.u}"` : ''}>`
    + `<span class="ic-ico">${o.icon || ICON[it.slot] || '•'}</span>`
    + `<span class="ic-main"><span class="ic-nm"><span class="n">${esc(it.name)}</span>${badges.join('')}${o.cmp || ''}</span><span class="ic-sum">${sum}</span>${o.foot || ''}</span>`
    + `<span class="ic-act${o.col ? ' col' : ''}">${o.main || ''}${o.noMore ? '' : `<button class="more" data-a="more" data-k="${esc(key)}" title="Details">${o.open ? '▴' : '⋯'}</button>`}</span>`
    + (o.open ? `<div class="ic-more">${o.more || ''}${o.btns ? `<div class="ic-btns">${o.btns}</div>` : ''}</div>` : '')
    + '</div>';
}

// A card for something that isn't gear (a potion, a material, a shop line): name, a short line, buttons.
export function rowHtml(o) {
  const key = o.key;
  return `<div class="ic${o.open ? ' open' : ''}${o.empty ? ' empty' : ''}" style="--rc:${o.color || '#94a3b8'}" data-ic="${esc(key)}"${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}>`
    + `<span class="ic-ico${o.iconTxt ? ' txt' : ''}">${o.icon || '•'}</span>`
    + `<span class="ic-main"><span class="ic-nm"><span class="n">${o.name}</span>${o.badges || ''}</span>${o.sum ? `<span class="ic-sum">${o.sum}</span>` : ''}</span>`
    + `<span class="ic-act${o.col ? ' col' : ''}">${o.main || ''}${o.more || o.btns ? `<button class="more" data-a="more" data-k="${esc(key)}" title="Details">${o.open ? '▴' : '⋯'}</button>` : ''}</span>`
    + (o.open && (o.more || o.btns) ? `<div class="ic-more">${o.more || ''}${o.btns ? `<div class="ic-btns">${o.btns}</div>` : ''}</div>` : '')
    + '</div>';
}

// Which cards are open (one at a time per panel). Click on a card (not a button) or its ⋯ toggles it.
export function openState() {
  let open = null;
  return {
    is: k => open != null && String(open) === String(k),
    toggle(k) { open = this.is(k) ? null : String(k); },
    close() { open = null; },
    // a click inside a panel: returns true when it opened or closed a card (the caller re-renders)
    click(e) {
      const b = e.target.closest('button');
      if (b && b.dataset.a === 'more') { this.toggle(b.dataset.k); return true; }
      if (b || e.target.closest('.ic-more, input, select, a')) return false;
      const card = e.target.closest('.ic[data-ic]');
      if (!card || card.classList.contains('empty')) return false;
      this.toggle(card.dataset.ic); return true;
    },
  };
}
