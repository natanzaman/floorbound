// Admin page: bots, players, character editor. Uses the game's session (localStorage fb_session).
import { CLASSES, CLASS_IDS, MAX_LEVEL, xpToNext } from '/shared/data.js';
import { RARITY, SLOTS, CONSUMABLES, CONSUMABLE_IDS, statLabel } from '/shared/items.js';
import { MATS, MAT_IDS } from '/shared/crafting.js';
import { TITLES, STAT_KEYS } from '/shared/titles.js';
import { MASTERY, BRANCHES, masteryLevel } from '/shared/mastery.js';
import { TREES, pointsAt, spentOf } from '/shared/talents.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const token = localStorage.getItem('fb_session');

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(b.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return b;
}
function flash(text, ok = false) {
  $('flash').innerHTML = `<div class="msg ${ok ? 'ok' : 'err'}">${esc(text)}</div>`;
  clearTimeout(flash.t); flash.t = setTimeout(() => { $('flash').innerHTML = ''; }, ok ? 2500 : 6000);
}
const ago = iso => {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
const date = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const clsName = c => CLASSES[c]?.name || c;

// ---------- gate ----------
async function boot() {
  if (!token) return gate('You are not signed in. Open the game, sign in (guest or Discord), then come back to /admin.html.');
  let me;
  try { me = await api('/api/admin/me'); } catch (e) {
    return gate(e.status === 401 ? 'Your session expired. Open the game and sign in again.' : e.status === 503 ? 'This server runs without a database, so there are no accounts or admins.' : `Could not reach the server (${e.message}).`);
  }
  if (!me.admin) return gate(`Your account (#${me.account.id}${me.account.discord ? `, ${me.account.discord}` : ', guest'}) is not an admin. The server owner can set accounts.is_admin = true for it, or list your Discord user id in ADMIN_DISCORD_IDS.`);
  $('who').textContent = `Signed in as ${me.account.discord || `guest #${me.account.id}`}`;
  $('app').classList.remove('hidden');
  $('tabs').classList.remove('hidden');
  setupBots();
  setupPlayers();
  const m = location.hash.match(/^#edit=(\d+)/);
  if (m) openEditor(+m[1]); else show(location.hash === '#players' ? 'players' : 'bots');
}
function gate(text) { $('gate-text').textContent = text; $('gate').classList.remove('hidden'); }

// ---------- tabs ----------
let tab = 'bots';
function show(name) {
  tab = name;
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of ['bots', 'players', 'edit']) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  if (name === 'bots') refreshBots();
  if (name === 'players') refreshPlayers();
  if (name !== 'edit') history.replaceState(null, '', name === 'bots' ? location.pathname : `#${name}`);
}
for (const b of $('tabs').querySelectorAll('button')) b.onclick = () => show(b.dataset.tab);

// ---------- BOTS ----------
let botData = null;
function setupBots() {
  $('b-cls').innerHTML = CLASS_IDS.map(c => `<option value="${c}">${clsName(c)} · ${CLASSES[c].role}</option>`).join('');
  $('b-lvl').max = MAX_LEVEL;
  $('b-beh').onchange = followVis;
  $('b-add').onclick = async () => {
    try {
      const r = await api('/api/admin/bots', { method: 'POST', body: botForm(true) });
      flash(`Added ${r.added.name}.`, true); $('b-name').value = ''; refreshBots();
    } catch (e) { flash(e.message); }
  };
  $('b-team').onclick = async () => {
    try {
      const r = await api('/api/admin/bots/team', { method: 'POST', body: botForm(false) });
      flash(`Added ${r.added.map(b => b.name).join(', ')}.`, true); refreshBots();
    } catch (e) { flash(e.message); }
  };
  $('b-clear').onclick = async () => {
    if (!confirm('Disconnect every bot?')) return;
    try { const r = await api('/api/admin/bots', { method: 'DELETE' }); flash(`Removed ${r.removed} bots.`, true); refreshBots(); } catch (e) { flash(e.message); }
  };
  setInterval(() => { if (tab === 'bots' && !document.hidden) refreshBots(); }, 1500);
}
function botForm(single) {
  const o = { lvl: +$('b-lvl').value || 1, behaviour: $('b-beh').value, follow: $('b-follow').value };
  if (single) Object.assign(o, { cls: $('b-cls').value, name: $('b-name').value.trim() });
  return o;
}
function followVis() { $('b-follow-wrap').classList.toggle('hidden', $('b-beh').value !== 'follow'); }
async function refreshBots() {
  try { botData = await api('/api/admin/bots'); } catch (e) { return flash(e.message); }
  const d = botData;
  if (!$('b-beh').options.length) {
    $('b-beh').innerHTML = Object.entries(d.behaviours).map(([k, v]) => `<option value="${k}" ${k === 'field' ? 'selected' : ''}>${esc(v)}</option>`).join('');
    followVis();
  }
  const keep = $('b-follow').value;
  $('b-follow').innerHTML = d.players.length ? d.players.map(p => `<option value="${esc(p.name)}">${esc(p.name)} (Lv ${p.lvl} ${clsName(p.cls)})</option>`).join('') : '<option value="">(nobody online)</option>';
  if (keep && d.players.some(p => p.name === keep)) $('b-follow').value = keep;
  const live = d.bots.filter(b => b.status !== 'gone');
  $('b-count').textContent = `${live.length} / ${d.max} bots running · ${d.players.length} real player${d.players.length === 1 ? '' : 's'} online`;
  $('b-rows').innerHTML = d.bots.map(b => {
    const pct = b.maxHp ? Math.round((b.hp / b.maxHp) * 100) : 0;
    const beh = b.behaviour === 'follow' ? `follow <b>${esc(b.follow)}</b>` : esc(d.behaviours[b.behaviour]?.split(' (')[0] || b.behaviour);
    return `<tr class="${b.dead || b.status !== 'online' ? 'dim' : ''}"><td><b>${esc(b.name)}</b> <span class="pill bot">BOT</span>${b.team ? ` <span class="dim">team ${b.team}</span>` : ''}</td><td>${clsName(b.cls)}</td><td>${b.lvl}</td>
      <td>${b.status === 'online' ? `<span class="hp"><div style="width:${pct}%;${pct < 35 ? 'background:#f87171' : ''}"></div></span>${b.dead ? 'dead' : `${b.hp}/${b.maxHp}`}` : esc(b.status)}</td>
      <td>${b.floor ? `F${b.floor} · ` : ''}${esc(b.area)}</td><td>${b.party.length ? esc(b.party.join(', ')) : '<span class="dim">—</span>'}</td><td>${beh}</td>
      <td><button class="small danger" data-rm="${b.bid}">Remove</button></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="dim">No bots running.</td></tr>';
  for (const btn of $('b-rows').querySelectorAll('[data-rm]')) btn.onclick = async () => { try { await api(`/api/admin/bots/${btn.dataset.rm}`, { method: 'DELETE' }); refreshBots(); } catch (e) { flash(e.message); } };
}

// ---------- PLAYERS ----------
let pData = null, sort = { k: 'lastSeen', asc: false };
function setupPlayers() {
  $('p-search').oninput = renderPlayers;
  $('p-filter').onchange = renderPlayers;
  $('p-refresh').onclick = refreshPlayers;
  for (const th of document.querySelectorAll('#tab-players th[data-sort]')) th.onclick = () => {
    const k = th.dataset.sort;
    sort = { k, asc: sort.k === k ? !sort.asc : ['name', 'cls', 'account', 'area'].includes(k) };
    renderPlayers();
  };
  setInterval(() => { if (tab === 'players' && !document.hidden) refreshPlayers(); }, 5000);
}
async function refreshPlayers() {
  try { pData = await api('/api/admin/players'); } catch (e) { return flash(e.message); }
  renderPlayers();
}
function renderPlayers() {
  if (!pData) return;
  const s = $('p-search').value.trim().toLowerCase(), f = $('p-filter').value;
  let rows = pData.players.filter(p => (f === 'all' || (f === 'online') === p.online) && (!s || p.name.toLowerCase().includes(s) || p.account.toLowerCase().includes(s)));
  const val = (p, k) => (k === 'online' ? (p.online ? 1 : 0) : k === 'lastSeen' || k === 'created' ? new Date(p[k]).getTime() : k === 'area' ? p.area || '' : p[k]);
  rows.sort((a, b) => { const x = val(a, sort.k), y = val(b, sort.k); const c = typeof x === 'string' ? x.localeCompare(y) : x - y; return sort.asc ? c : -c; });
  for (const th of document.querySelectorAll('#tab-players th[data-sort]')) { th.classList.toggle('sorted', th.dataset.sort === sort.k); th.classList.toggle('asc', sort.asc); }
  const on = pData.players.filter(p => p.online).length;
  $('p-count').textContent = `${rows.length} shown · ${pData.players.length} characters · ${on} online`;
  $('p-rows').innerHTML = rows.map(p => `<tr class="click" data-id="${p.id}"><td><b>${esc(p.name)}</b></td><td>${clsName(p.cls)}</td><td>${p.lvl}</td>
    <td>${esc(p.account)}${p.admin ? ' <span class="pill adm">admin</span>' : ''}</td><td>${p.online ? '<span class="pill on">online</span>' : '<span class="pill">offline</span>'}</td>
    <td>${p.online ? `F${p.floor} · ${esc(p.area)}${p.party.length ? ` <span class="dim">(party: ${esc(p.party.join(', '))})</span>` : ''}` : '<span class="dim">—</span>'}</td>
    <td>${p.online ? 'now' : ago(p.lastSeen)}</td><td>${date(p.created)}</td></tr>`).join('') || '<tr><td colspan="8" class="dim">No characters match.</td></tr>';
  for (const tr of $('p-rows').querySelectorAll('tr[data-id]')) tr.onclick = () => openEditor(+tr.dataset.id);
  $('p-extra').innerHTML = `<h2>Not in the list</h2><div class="dim">${pData.anon.length ? `Anonymous (unsaved) players online: ${pData.anon.map(a => `${esc(a.name)} (Lv ${a.lvl} ${clsName(a.cls)}, ${esc(a.area)})`).join(', ')}.` : 'No anonymous players online.'} ${pData.bots} bot${pData.bots === 1 ? '' : 's'} online (see the Bots tab).</div>`;
}

// ---------- EDIT ----------
let ch = null; // the character being edited (as the server last sent it)
async function openEditor(id) {
  try { ch = (await api(`/api/admin/characters/${id}`)).character; } catch (e) { return flash(e.message); }
  $('tabs').querySelector('[data-tab=edit]').disabled = false;
  show('edit');
  history.replaceState(null, '', `#edit=${id}`);
  renderEditor();
}
async function patch(body, okText = 'Saved.') {
  try {
    ch = (await api(`/api/admin/characters/${ch.id}`, { method: 'PATCH', body })).character;
    renderEditor();
    flash(okText + (ch.online ? ' Applied live to the online player.' : ''), true);
  } catch (e) { flash(e.message); }
}
const itemLine = it => `<span class="nm" style="color:${RARITY[it.r]?.color || '#fff'}">${esc(it.name)}${it.la ? ' ★' : ''}</span><span class="st">${Object.entries(it.st || {}).map(([k, v]) => statLabel(k, v)).join(', ')}${it.cls ? ` · ${clsName(it.cls)}` : ''}</span>`;

function renderEditor() {
  const c = ch, inv = c.inv, st = c.stats;
  const num = (id, v, min = 0, max = '') => `<input type="number" id="${id}" value="${v ?? 0}" min="${min}" ${max !== '' ? `max="${max}"` : ''} />`;
  $('e-body').innerHTML = `
  <div class="lead"><h2>${esc(c.name)}</h2><span>Lv ${c.lvl} ${clsName(c.cls)}</span>
    ${c.online ? `<span class="pill on">online · F${c.floor} · ${esc(c.area)}</span>` : '<span class="pill">offline</span>'}
    <span class="dim">account: ${esc(c.account.label)} (#${c.account.id})${c.account.admin ? ' <span class="pill adm">admin</span>' : ''}</span>
    <span class="dim">created ${date(c.created_at)} · last seen ${c.online ? 'now' : ago(c.updated_at)}</span>
    <span style="flex:1"></span><button id="e-reload">Reload</button><button id="e-back">Back to players</button></div>
  <div class="grid">
    <div class="card"><h2>Character</h2>
      <div class="row"><label class="f">Name<input id="e-name" value="${esc(c.name)}" maxlength="16" /></label><button id="e-rename" style="margin-bottom:10px">Rename</button></div>
      <div class="row"><label class="f">Class<select id="e-cls" ${c.online ? 'disabled title="Only while offline"' : ''}>${CLASS_IDS.map(k => `<option value="${k}" ${k === c.cls ? 'selected' : ''}>${clsName(k)}</option>`).join('')}</select></label>
      ${c.online ? '<span class="dim" style="font-size:12px;margin-bottom:12px">class changes only while offline</span>' : '<button id="e-setcls" style="margin-bottom:10px">Change class</button>'}</div>
      <label class="f">Level (1–${MAX_LEVEL})${num('e-lvl', c.lvl, 1, MAX_LEVEL)}</label>
      <label class="f">XP <span id="e-xpmax">(of ${c.lvl >= MAX_LEVEL ? 0 : xpToNext(c.lvl)})</span>${num('e-xp', c.xp)}</label>
      <label class="f">Gold${num('e-gold', c.gold)}</label>
      <div><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="e-f2" ${st.floor2 ? 'checked' : ''} /> Floor 2 unlocked</label>
      ${!st.floor2 && st.wardenKills > 0 ? '<span class="dim" style="font-size:12px"> (also unlocked by its Warden kills)</span>' : ''}</div>
    </div>
    <div class="card"><h2>Consumables &amp; materials</h2>
      <div>${CONSUMABLE_IDS.map(k => `<label class="f">${esc(CONSUMABLES[k].name)}${num(`e-cons-${k}`, inv.cons?.[k] || 0, 0, 999)}</label>`).join('')}</div>
      <div>${MAT_IDS.map(k => `<label class="f" style="color:${MATS[k].color}">${esc(MATS[k].name)}${num(`e-mat-${k}`, inv.mats?.[k] || 0, 0, 99999)}</label>`).join('')}</div>
    </div>
    <div class="card"><h2>Titles</h2>
      <div class="titles">${TITLES.map(t => `<label style="color:${t.color}"><input type="checkbox" data-title="${t.id}" ${st.titles.includes(t.id) ? 'checked' : ''} />${esc(t.name)}</label>`).join('')}</div>
      <label class="f" style="margin-top:6px">Active title<select id="e-active"><option value="">(none: Newcomer)</option>${TITLES.map(t => `<option value="${t.id}" ${st.activeTitle === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <h2 style="margin-top:8px">Lifetime stats</h2>
      <div>${STAT_KEYS.filter(k => k !== 'floor2').map(k => `<label class="f">${k}${num(`e-st-${k}`, st[k] || 0)}</label>`).join('')}</div>
    </div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Skill mastery &amp; evolutions</h2>
    <table><thead><tr><th>Skill</th><th>Mastery</th><th>Points</th><th>Evolution (Mastery ${MASTERY.evolveAt}+)</th></tr></thead><tbody>
    ${Object.entries(c.mastery).map(([sk, e]) => { const def = CLASSES[c.cls].skills.find(s => s.id === sk), B = BRANCHES[sk]; return `<tr>
      <td><b>${esc(def?.name || sk)}</b></td>
      <td><select data-mlvl="${sk}">${[1, 2, 3, 4, 5].map(l => `<option ${masteryLevel(e.pts) === l ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input type="number" data-mpts="${sk}" value="${e.pts}" min="0" style="width:100px" /></td>
      <td><select data-mbr="${sk}"><option value="">none</option>${B ? ['A', 'B'].map(k => `<option value="${k}" ${e.br === k ? 'selected' : ''}>${k}: ${esc(B[k].name)}</option>`).join('') : ''}</select></td></tr>`; }).join('')}
    </tbody></table>
    <div class="dim" style="font-size:12px;margin-top:6px">Picking a mastery level sets the points to that level's threshold (${MASTERY.need.slice(1).join(' / ')}); or type exact points.</div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Talents <span class="dim" style="font-size:12px;font-weight:400">${spentOf(c.talents || {})} of ${pointsAt(c.lvl)} points spent (1 per level from 2)</span></h2>
    ${TREES[c.cls] ? `<div class="grid">${TREES[c.cls].branches.map(b => `<div><b style="color:${b.color}">${esc(b.name)}</b>${b.nodes.map(nd => `<label class="f" style="display:flex;justify-content:space-between;gap:8px;align-items:center">${esc(nd.name)}${nd.keystone ? ' ★' : ''} <span class="dim" style="font-size:11px">T${nd.tier + 1}</span><input type="number" data-tal="${nd.id}" value="${c.talents?.[nd.id] || 0}" min="0" max="${nd.max}" style="width:60px" /></label>`).join('')}</div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button id="t-save" class="primary">Save talents</button><button id="t-reset">Reset talents (refund all)</button><span class="dim" style="font-size:12px">Checked against the tree: tier gates, prerequisites, max ranks and the level's points.</span></div>` : '<div class="dim">No talent tree for this class.</div>'}
  </div>
  <div class="sticky-save"><button class="primary" id="e-save">Save changes</button><span class="dim" style="font-size:12px">Saves level, XP, gold, consumables, materials, titles, stats, mastery and the Floor 2 flag.</span></div>
  <div class="grid">
    <div class="card items"><h2>Equipped</h2>
      ${SLOTS.map(s => `<div class="it"><span class="slot">${s}</span>${inv.eq[s] ? `${itemLine(inv.eq[s])}<button class="small" data-uneq="${s}">To bag</button><button class="small danger" data-rmu="${inv.eq[s].u}">Remove</button>` : '<span class="nm dim">—</span>'}</div>`).join('')}
      <h2 style="margin-top:14px">Bag (${inv.bag.length}/24)</h2>
      ${inv.bag.map(it => `<div class="it"><span class="slot">${it.slot}</span>${itemLine(it)}<button class="small" data-eq="${it.u}">Equip</button><button class="small danger" data-rmu="${it.u}">Remove</button></div>`).join('') || '<div class="dim">Empty.</div>'}
    </div>
    <div class="card"><h2>Add an item</h2>
      <div class="row">
        <label class="f">Slot<select id="a-slot">${SLOTS.map(s => `<option>${s}</option>`).join('')}</select></label>
        <label class="f">Rarity<select id="a-r">${RARITY.slice(0, 4).map((r, i) => `<option value="${i}" style="color:${r.color}">${r.name}</option>`).join('')}</select></label>
        <label class="f" id="a-cls-w">Weapon class<select id="a-cls">${CLASS_IDS.map(k => `<option value="${k}" ${k === c.cls ? 'selected' : ''}>${clsName(k)}</option>`).join('')}</select></label>
        <label class="f hidden" id="a-charm-w">Charm affix<select id="a-charm"><option value="">random</option><option value="crit">Keenness (crit)</option><option value="haste">Haste</option><option value="sw">the Switch</option></select></label>
        <button id="a-add" style="margin-bottom:10px">Add to bag</button>
      </div>
      <div class="row"><button id="a-la1" style="color:${RARITY[4].color}">+ Horn of the Warden</button><button id="a-la2" style="color:${RARITY[4].color}">+ Sovereign's Tidecloak</button></div>
    </div>
  </div>
  <div class="card"><h2>Advanced: raw JSON</h2>
    <div class="dim" style="font-size:12px;margin-bottom:8px">Edit the stored inventory, stats, skill mastery and talents directly (validated on the server; unknown stats keys are kept).</div>
    <div class="grid"><div><b>inv</b><textarea id="r-inv" spellcheck="false"></textarea></div><div><b>stats</b><textarea id="r-stats" spellcheck="false"></textarea></div><div><b>mastery</b><textarea id="r-mastery" spellcheck="false"></textarea></div><div><b>talents</b><textarea id="r-talents" spellcheck="false"></textarea></div></div>
    <div class="row" style="margin-top:8px"><button id="r-apply" class="primary">Apply raw JSON</button><span id="r-err" class="dim"></span></div>
  </div>
  <div class="card" style="border-color:rgba(248,113,113,.35)"><h2 style="color:#fca5a5">Delete character</h2>
    <div class="row"><label class="f">Type <b style="color:#fff">${esc(c.name)}</b> to confirm<input id="d-name" autocomplete="off" /></label><button class="danger" id="d-go" style="margin-bottom:10px">Delete forever</button></div>
  </div>`;
  $('r-inv').value = JSON.stringify(inv, null, 2);
  $('r-stats').value = JSON.stringify(st, null, 2);
  $('r-mastery').value = JSON.stringify(c.mastery, null, 2);
  $('r-talents').value = JSON.stringify(c.talents || {}, null, 2);
  wireEditor();
}

function wireEditor() {
  const c = ch;
  $('e-back').onclick = () => show('players');
  $('e-reload').onclick = () => openEditor(c.id);
  $('e-lvl').oninput = () => { const l = +$('e-lvl').value; $('e-xpmax').textContent = `(of ${l >= MAX_LEVEL ? 0 : xpToNext(l) || '?'})`; };
  $('e-rename').onclick = () => patch({ name: $('e-name').value }, 'Renamed.');
  if ($('e-setcls')) $('e-setcls').onclick = () => patch({ cls: $('e-cls').value }, 'Class changed.');
  $('e-save').onclick = () => {
    const titles = [...document.querySelectorAll('[data-title]')].filter(x => x.checked).map(x => x.dataset.title);
    const active = $('e-active').value;
    patch({
      lvl: +$('e-lvl').value, xp: +$('e-xp').value, gold: +$('e-gold').value,
      cons: Object.fromEntries(CONSUMABLE_IDS.map(k => [k, +$(`e-cons-${k}`).value])),
      mats: Object.fromEntries(MAT_IDS.map(k => [k, +$(`e-mat-${k}`).value])),
      stats: Object.fromEntries(STAT_KEYS.filter(k => k !== 'floor2').map(k => [k, +$(`e-st-${k}`).value])),
      floor2: $('e-f2').checked, titles, activeTitle: titles.includes(active) ? active : null,
      mastery: Object.fromEntries(Object.entries(c.mastery).map(([sk, e]) => {
        const lvl = +document.querySelector(`[data-mlvl="${sk}"]`).value, pts = +document.querySelector(`[data-mpts="${sk}"]`).value;
        const out = pts !== e.pts ? { pts } : { lvl }; // typed points win; otherwise the level picker
        return [sk, { ...out, br: document.querySelector(`[data-mbr="${sk}"]`).value || null }];
      })),
    });
  };
  for (const b of document.querySelectorAll('[data-rmu]')) b.onclick = () => patch({ ops: [{ op: 'removeItem', u: +b.dataset.rmu }] }, 'Item removed.');
  for (const b of document.querySelectorAll('[data-eq]')) b.onclick = () => patch({ ops: [{ op: 'equip', u: +b.dataset.eq }] }, 'Equipped.');
  for (const b of document.querySelectorAll('[data-uneq]')) b.onclick = () => patch({ ops: [{ op: 'unequip', slot: b.dataset.uneq }] }, 'Moved to the bag.');
  const slotVis = () => { $('a-cls-w').classList.toggle('hidden', $('a-slot').value !== 'weapon'); $('a-charm-w').classList.toggle('hidden', $('a-slot').value !== 'charm'); };
  $('a-slot').onchange = slotVis; slotVis();
  $('a-add').onclick = () => patch({ ops: [{ op: 'addItem', slot: $('a-slot').value, r: +$('a-r').value, cls: $('a-cls').value, charm: $('a-charm').value }] }, 'Item added.');
  $('a-la1').onclick = () => patch({ ops: [{ op: 'addLastAttack', which: 1 }] }, 'Item added.');
  $('a-la2').onclick = () => patch({ ops: [{ op: 'addLastAttack', which: 2 }] }, 'Item added.');
  $('r-apply').onclick = () => {
    let rawInv, rawStats;
    try { rawInv = JSON.parse($('r-inv').value); } catch (e) { $('r-err').textContent = `inv: ${e.message}`; return; }
    try { rawStats = JSON.parse($('r-stats').value); } catch (e) { $('r-err').textContent = `stats: ${e.message}`; return; }
    let rawMastery;
    try { rawMastery = JSON.parse($('r-mastery').value); } catch (e) { $('r-err').textContent = `mastery: ${e.message}`; return; }
    let rawTalents;
    try { rawTalents = JSON.parse($('r-talents').value); } catch (e) { $('r-err').textContent = `talents: ${e.message}`; return; }
    $('r-err').textContent = '';
    patch({ rawInv, rawStats, rawMastery, rawTalents }, 'Raw JSON applied.');
  };
  if ($('t-save')) {
    $('t-save').onclick = () => patch({ talents: Object.fromEntries([...document.querySelectorAll('[data-tal]')].map(x => [x.dataset.tal, +x.value]).filter(([, v]) => v > 0)) }, 'Talents saved.');
    $('t-reset').onclick = () => patch({ talents: {} }, 'Talents reset.');
  }
  $('d-go').onclick = async () => {
    if ($('d-name').value !== c.name) return flash('Type the exact character name to delete it.');
    try {
      await api(`/api/admin/characters/${c.id}`, { method: 'DELETE', body: { confirm: $('d-name').value } });
      flash(`${c.name} was deleted.`, true);
      ch = null; $('tabs').querySelector('[data-tab=edit]').disabled = true;
      show('players');
    } catch (e) { flash(e.message); }
  };
}

boot();
