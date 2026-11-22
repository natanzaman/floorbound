// Admin page: summary strip, bots (add with presets, live edit, actions), players, character editor.
// Uses the game's session (localStorage fb_session). Classes come from CLASSES, so new classes show up automatically.
import { CLASSES, CLASS_IDS, MAX_LEVEL, xpToNext } from '/shared/data.js';
import { RARITY, SLOTS, CONSUMABLES, CONSUMABLE_IDS, statLabel } from '/shared/items.js';
import { MATS, MAT_IDS } from '/shared/crafting.js';
import { TITLES, STAT_KEYS } from '/shared/titles.js';
import { MASTERY, BRANCHES, masteryLevel } from '/shared/mastery.js';
import { TWISTS } from '/shared/twists.js';
import { BOT_SKILLS, BOT_SKILL_DEFAULT } from '/shared/botskill.js';
import { STYLES, CLASS_STYLES, styleLine } from '/shared/styles.js';
import { TREES, pointsAt, spentOf } from '/shared/talents.js';
import { AFFIXES, AFFIX_IDS, SETS, affixText, isTeamAffix, setSlots, bestSetFor } from '/shared/loot.js';
import { LOOKS } from '/shared/looks.js';
import { ACCESS_MIN, ACCESS_MAX, ACCESS_ADMIN, ACCESS } from '/shared/accesslevels.js'; // account access levels (permissions)

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const token = localStorage.getItem('fb_session');

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(b.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return b;
}

// ---------- toasts ----------
function toast(text, ok = false) {
  const el = document.createElement('div');
  el.className = `toast ${ok ? 'ok' : 'err'}`;
  el.innerHTML = `<span class="ti">${ok ? '✔' : '✖'}</span><span>${esc(text)}</span>`;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ok ? 2600 : 6000);
}
const flash = toast; // (older name)
async function act(fn, okText) { // run an API call; toast the result
  try { const r = await fn(); if (okText) toast(typeof okText === 'function' ? okText(r) : okText, true); return r; } catch (e) { toast(e.message); return null; }
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
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const dur = s => (s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);
const clsName = c => CLASSES[c]?.name || c;
const clsColor = c => { const v = CLASSES[c]?.color; return typeof v === 'number' ? `#${v.toString(16).padStart(6, '0')}` : v || '#9cc4ff'; };

// Class icon: by role (Tank: shield, Healer/Support: cross, Ranged: bow, Damage: sword), else the initial.
const ICONS = {
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/>',
  cross: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9" stroke-opacity=".35"/>',
  bow: '<path d="M6 3c7 3 7 15 0 18M6 3v18M4 12h16M17 9l3 3-3 3"/>',
  sword: '<path d="M14.5 4H20v5.5L9 20.5 3.5 15zM5 13l6 6M3 21l3-3"/>',
  spear: '<path d="M4 20 18 6M15 4h5v5M7 14l3 3"/>',
  note: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  axe: '<path d="M5 21 17 9M14 4c3 0 6 3 6 6l-4 1-3-3z"/>',
};
function iconKey(c) {
  const r = `${CLASSES[c]?.role || ''} ${CLASSES[c]?.name || c}`.toLowerCase();
  if (/bard|song|music/.test(r)) return 'note';
  if (/tank|guard/.test(r)) return 'shield';
  if (/heal|support|cleric/.test(r)) return 'cross';
  if (/rang|bow|archer/.test(r)) return 'bow';
  if (/lanc|spear/.test(r)) return 'spear';
  if (/berserk|axe/.test(r)) return 'axe';
  if (/dam|dps|sword/.test(r)) return 'sword';
  return null;
}
function clsIcon(c, sm = false) {
  const k = iconKey(c);
  return `<span class="cls-ico${sm ? ' sm' : ''}" style="--cc:${clsColor(c)}" title="${esc(clsName(c))}">${k ? `<svg viewBox="0 0 24 24">${ICONS[k]}</svg>` : esc(clsName(c)[0] || '?')}</span>`;
}
const SKILL_COLORS = { 1: 'var(--s1)', 2: 'var(--s2)', 3: 'var(--s3)', 4: 'var(--s4)', 5: 'var(--s5)' };
const skillTag = s => `<span class="skill-tag" style="--sc:${SKILL_COLORS[s]}" title="${esc(BOT_SKILLS[s]?.desc)}">${s} · ${esc(BOT_SKILLS[s]?.name)}</span>`;
const segHtml = cur => [1, 2, 3, 4, 5].map(s => `<button type="button" data-s="${s}" style="--sc:${SKILL_COLORS[s]}" class="${s === cur ? 'on' : ''}" title="${s} · ${esc(BOT_SKILLS[s].name)}: ${esc(BOT_SKILLS[s].desc)}">${s}</button>`).join('');

// ---------- gate ----------
let me = null;
async function boot() {
  if (!token && await localDirector()) return;
  if (!token) return gate('You are not signed in. Open the game, sign in (guest or Discord), then come back to /admin.html.');
  try { me = await api('/api/admin/me'); } catch (e) {
    if (e.status === 503 && await localDirector()) return; // no accounts: a local filming server (Director tab only)
    return gate(e.status === 401 ? 'Your session expired. Open the game and sign in again.' : e.status === 503 ? 'This server runs without a database, so there are no accounts or admins.' : `Could not reach the server (${e.message}).`);
  }
  if (!me.admin) return gate(`Your account (#${me.account.id}${me.account.discord ? `, ${me.account.discord}` : ', guest'}) is not an admin. The server owner can set accounts.is_admin = true for it, or list your Discord user id in ADMIN_DISCORD_IDS.`);
  $('who').innerHTML = `<span class="dot"></span>${esc(me.account.discord || `guest #${me.account.id}`)}`;
  for (const id of ['app', 'tabs', 'strip']) $(id).classList.remove('hidden');
  setupBots();
  setupPlayers();
  refreshSummary(); setInterval(() => { if (!document.hidden) refreshSummary(); }, 5000);
  refreshPlayers(true); setInterval(() => { if (!document.hidden && tab !== 'players') refreshPlayers(true); }, 15000);
  const m = location.hash.match(/^#edit=(\d+)/);
  if (m) openEditor(+m[1]); else show(location.hash === '#players' ? 'players' : location.hash === '#director' ? 'director' : 'bots');
}
// A server without a database answers the Director from localhost (docs/story/FILMING.md): show just that tab.
async function localDirector() {
  const r = await fetch('/api/admin/director').catch(() => null);
  if (!r?.ok) return false;
  $('tabs').classList.remove('hidden'); $('app').classList.remove('hidden');
  for (const b of $('tabs').querySelectorAll('button')) if (b.dataset.tab !== 'director') b.classList.add('hidden');
  $('who').textContent = 'local filming server (no accounts)';
  show('director');
  return true;
}
function gate(text) { $('gate-text').textContent = text; $('gate').classList.remove('hidden'); }

// ---------- tabs ----------
let tab = 'bots';
function show(name) {
  tab = name;
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of ['bots', 'players', 'director', 'edit']) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  window.dispatchEvent(new CustomEvent('admin-tab', { detail: name })); // (the Director tab polls only while shown)
  if (name === 'bots') refreshBots();
  if (name === 'players') refreshPlayers();
  if (name !== 'edit') history.replaceState(null, '', name === 'bots' ? location.pathname : `#${name}`);
}
for (const b of $('tabs').querySelectorAll('button')) b.onclick = () => show(b.dataset.tab);

// ---------- SUMMARY STRIP ----------
async function refreshSummary() {
  let s;
  try { s = await api('/api/admin/summary'); } catch { return; }
  $('s-players').innerHTML = `${s.players}`;
  $('s-players-sub').textContent = `${s.accounts} signed in · ${s.players - s.accounts} anonymous`;
  $('s-bots').innerHTML = `${s.bots}<small>/ ${s.maxBots}</small>`;
  $('s-bots-sub').textContent = botData ? `${botData.bots.filter(b => b.dead).length} down · ${new Set(botData.bots.filter(b => b.team).map(b => b.team)).size} teams` : ' ';
  $('n-bots').textContent = s.bots;
  $('s-uptime').textContent = dur(s.uptime);
  $('s-uptime-sub').textContent = `since ${new Date(Date.now() - s.uptime * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${s.floorClears} clear${s.floorClears === 1 ? '' : 's'}`;
  const T = s.twist && TWISTS[s.twist.id];
  $('s-twist-card').style.setProperty('--c', T?.color || '#94a3b8');
  $('s-twist').innerHTML = s.twist ? `<span style="color:${T?.color || '#fff'}">${esc(s.twist.name)}</span>` : '<span class="dim">none</span>';
  $('s-twist-sub').textContent = T?.desc || ' ';
  $('s-twist-sub').title = T?.desc || '';
  $('s-clears-n').textContent = s.clears.length ? `${s.floorClears} this session` : '';
  $('s-clears').innerHTML = s.clears.slice(0, 4).map(c => `<li><span class="fl">F${c.floor}</span><b>${mmss(c.secs)}</b>
    <span class="names">${c.players.map(p => `<span style="color:${clsColor(p.cls)}">${esc(p.name)}</span>`).join(', ')}${c.deaths ? ` <span class="faint">· ${c.deaths} death${c.deaths === 1 ? '' : 's'}</span>` : ''}</span><span class="faint">${ago(c.at)}</span></li>`).join('')
    || '<li class="faint">No clears yet.</li>';
}

// ---------- BOTS ----------
let botData = null, myChar = null;
const form = { cls: CLASS_IDS[0], skill: BOT_SKILL_DEFAULT };
function setupBots() {
  // class picker (generic over CLASSES)
  $('b-cls').innerHTML = CLASS_IDS.map(c => `<button type="button" data-c="${c}" style="--cc:${clsColor(c)}"><span class="nm">${clsIcon(c, true)}${esc(clsName(c))}</span><span class="rl">${esc(CLASSES[c].role || '')}</span></button>`).join('');
  const pickCls = c => { form.cls = c; for (const b of $('b-cls').children) b.classList.toggle('on', b.dataset.c === c); };
  for (const b of $('b-cls').children) b.onclick = () => pickCls(b.dataset.c);
  pickCls(form.cls);
  // capability
  const pickSkill = s => { form.skill = s; $('b-skill').innerHTML = segHtml(s); $('b-skill-desc').innerHTML = `<b style="color:${SKILL_COLORS[s]}">${esc(BOT_SKILLS[s].name)}</b> · ${esc(BOT_SKILLS[s].desc)}`; for (const b of $('b-skill').children) b.onclick = () => pickSkill(+b.dataset.s); };
  pickSkill(form.skill);
  // level stepper
  $('b-lvl').max = MAX_LEVEL;
  for (const b of $('b-lvl-step').querySelectorAll('button')) b.onclick = () => { $('b-lvl').value = Math.min(MAX_LEVEL, Math.max(1, (+$('b-lvl').value || 1) + +b.dataset.d)); };
  $('b-beh').onchange = followVis;
  $('b-add').onclick = () => act(() => api('/api/admin/bots', { method: 'POST', body: botForm(true) }), r => `Added ${r.added.name}.`).then(r => { if (r) { $('b-name').value = ''; refreshBots(); } });
  $('b-team').onclick = () => act(() => api('/api/admin/bots/team', { method: 'POST', body: botForm(false) }), r => `Added ${r.added.map(b => b.name).join(', ')}.`).then(r => r && refreshBots());
  $('b-clear').onclick = async () => {
    if (!confirm('Disconnect every bot?')) return;
    if (await act(() => api('/api/admin/bots', { method: 'DELETE' }), r => `Removed ${r.removed} bots.`)) refreshBots();
  };
  renderPresets();
  setInterval(() => { if (tab === 'bots' && !document.hidden) refreshBots(); }, 1500);
}
function botForm(single) {
  const o = { lvl: +$('b-lvl').value || 1, behaviour: $('b-beh').value, follow: $('b-follow').value, skill: form.skill };
  if (single) Object.assign(o, { cls: form.cls, name: $('b-name').value.trim() });
  return o;
}
function followVis() { $('b-follow-wrap').classList.toggle('hidden', $('b-beh').value !== 'follow'); }

// Presets: one click, sensible settings.
const PRESETS = [
  { id: 'mine', icon: ICONS.shield, name: 'Party of 3 for me', desc: () => (myChar ? `Guardian, Swordsman, Cleric follow ${myChar.name} (Lv ${myChar.lvl}), Skilled` : 'Join the game with this account first'),
    ok: () => !!myChar, run: () => api('/api/admin/bots/team', { method: 'POST', body: { lvl: myChar.lvl, behaviour: 'follow', follow: myChar.name, skill: 4 } }) },
  { id: 'warden', icon: '<path d="M4 20 12 4l8 16M8 13h8"/>', name: 'Warden test team', desc: () => 'Tank, DPS, healer · Lv 10 · straight to the Warden · Skilled', ok: () => true,
    run: () => api('/api/admin/bots/team', { method: 'POST', body: { lvl: 10, behaviour: 'warden', skill: 4 } }) },
  { id: 'colossus', icon: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', name: 'Floor 3 team', desc: () => 'Tank, DPS, healer · Lv 30 · up to Floor 3 and the Storm Colossus · Skilled', ok: () => true,
    run: () => api('/api/admin/bots/team', { method: 'POST', body: { lvl: 30, behaviour: 'floor3', skill: 4 } }) },
  { id: 'field', icon: '<path d="M4 20c4-8 12-8 16 0M12 4v8M8 8l4 4 4-4"/>', name: 'Field farmers', desc: () => `One of each class (${Math.min(3, CLASS_IDS.length)}) · Lv 3 · farm the field · Average`, ok: () => true,
    run: async () => { const out = []; for (const cls of [...CLASS_IDS].sort(() => Math.random() - 0.5).slice(0, 3)) out.push((await api('/api/admin/bots', { method: 'POST', body: { cls, lvl: 3, behaviour: 'field', skill: 3 } })).added); return { added: out }; } },
  { id: 'novice', icon: '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01M9 16c2-1.5 4-1.5 6 0"/>', name: 'Novice crowd', desc: () => '4 random new players · Lv 1 · field · Novice / Casual', ok: () => true,
    run: async () => { const out = []; for (let i = 0; i < 4; i++) out.push((await api('/api/admin/bots', { method: 'POST', body: { cls: CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)], lvl: 1, behaviour: 'field', skill: i < 2 ? 1 : 2 } })).added); return { added: out }; } },
];
function renderPresets() {
  $('presets').innerHTML = PRESETS.map(p => `<button class="preset" data-p="${p.id}" ${p.ok() ? '' : 'disabled'}><span class="pi"><svg class="i" viewBox="0 0 24 24">${p.icon}</svg></span><span><b>${esc(p.name)}</b><span class="d">${esc(p.desc())}</span></span></button>`).join('');
  for (const b of $('presets').children) b.onclick = async () => {
    const p = PRESETS.find(x => x.id === b.dataset.p);
    b.disabled = true;
    const r = await act(p.run, r => `${p.name}: added ${r.added.map(x => x.name).join(', ')}.`);
    b.disabled = !p.ok();
    if (r) refreshBots();
  };
}

async function refreshBots() {
  try { botData = await api('/api/admin/bots'); } catch (e) { return toast(e.message); }
  const d = botData;
  if (!$('b-beh').options.length) {
    $('b-beh').innerHTML = Object.entries(d.behaviours).map(([k, v]) => `<option value="${k}" ${k === 'field' ? 'selected' : ''}>${esc(v)}</option>`).join('');
    followVis();
  }
  const keep = $('b-follow').value;
  $('b-follow').innerHTML = d.players.length ? d.players.map(p => `<option value="${esc(p.name)}">${esc(p.name)} (Lv ${p.lvl} ${esc(clsName(p.cls))})</option>`).join('') : '<option value="">(nobody online)</option>';
  if (keep && d.players.some(p => p.name === keep)) $('b-follow').value = keep;
  const live = d.bots.filter(b => b.status !== 'gone');
  $('b-count').textContent = `${live.length} / ${d.max} · ${d.players.length} real player${d.players.length === 1 ? '' : 's'} online`;
  $('n-bots').textContent = live.length;
  renderBotCards(live);
}

const ORDERS = { follow: 'Follow', come: 'Regroup', stay: 'Hold here', attack: 'Attack', heal: 'Heal', farm: 'Go farm', boss: 'Do the boss', ready: 'Ready up', potion: 'Use potion', status: 'Status (party chat)', leave: 'Leave party' };
const ROLE_NAMES = { tank: 'Tank ·', dps: 'DPS ·', healer: 'Healer ·', support: 'Support ·' };
// Keyed cards: built once per bot, then only the live parts are updated (so open selects / typing aren't disturbed).
const cards = new Map(); // bid -> element
function renderBotCards(list) {
  const root = $('b-cards');
  for (const [bid, el] of cards) if (!list.some(b => b.bid === bid)) { el.remove(); cards.delete(bid); }
  for (const b of list) {
    let el = cards.get(b.bid);
    if (!el || el.dataset.cls !== b.cls) { el?.remove(); el = buildCard(b); cards.set(b.bid, el); }
    updateCard(el, b);
  }
  // keep bid order
  [...cards.entries()].sort((x, y) => x[0] - y[0]).forEach(([, el]) => root.appendChild(el));
  root.querySelector('.empty')?.remove();
  if (!list.length) root.innerHTML = '<div class="empty">No bots running. Pick a preset or add one on the left.</div>';
}
const focused = el => document.activeElement === el;
function behOptions(cur) { return Object.entries(botData.behaviours).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v.split(' (')[0])}</option>`).join(''); }

function buildCard(b) {
  const el = document.createElement('div');
  el.className = 'botcard'; el.dataset.bid = b.bid; el.dataset.cls = b.cls;
  el.style.setProperty('--cc', clsColor(b.cls));
  el.innerHTML = `
    <div class="top">${clsIcon(b.cls)}<input class="nm" data-k="name" maxlength="16" title="Rename: type, then Enter" spellcheck="false" />
      <span class="pill bot">BOT</span>${b.team ? `<span class="pill team" title="Added as team ${b.team}: three bots in one party, each with its own brain">TEAM ${b.team}</span>` : ''}<span class="grow"></span><span data-k="skilltag"></span></div>
    <div class="meta"><span class="cls-name">${esc(clsName(b.cls))}</span><span class="sep">·</span><span data-k="where"></span><span data-k="party"></span></div>
    <div class="hp"><div data-k="hpbar"></div><span data-k="hptext"></span></div>
    <div class="goal" data-k="goal"></div>
    <div class="ctl">
      <span>Level</span><span><span class="step"><button type="button" data-d="-1" title="Level down">−</button><input type="number" data-k="lvl" min="1" max="${MAX_LEVEL}" /><button type="button" data-d="1" title="Level up">+</button></span></span>
      <span>Capability</span><span><span class="seg" data-k="seg"></span></span>
      <span>Behaviour</span><span class="beh"><select data-k="beh"></select><select data-k="follow" class="hidden"></select></span>
    </div>
    <div class="acts">
      <button class="small" data-a="heal" title="Heal to full">✚ Heal</button>
      <button class="small" data-a="kill" data-k="killbtn"></button>
      <select data-k="tp" title="Teleport"></select>
      <select data-k="respawn" title="Re-add as another class: same bot, name, level, capability, behaviour, party and orders"></select>
      <select data-k="order" title="Give this bot an order, as its party would"></select>
      <select data-k="look" title="Wear a look (shared/looks.js): preview a Named character's appearance on this bot"></select>
      <input data-k="allow" placeholder="Allow: anyone" title="Who may command, invite or kick this bot besides its creator and access ${ACCESS.overrideBots}+: saved characters' names (or ids), comma-separated; 'me' for just the creator; empty: anyone. Enter to save." style="width:140px" spellcheck="false" />
      <span class="grow"></span>
      <button class="small danger icon" data-a="remove" title="Remove this bot"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>`;
  const q = k => el.querySelector(`[data-k="${k}"]`);
  const bid = () => +el.dataset.bid;
  const patch = (body, okText) => act(() => api(`/api/admin/bots/${bid()}`, { method: 'PATCH', body }), okText).then(r => { if (r) { const cur = botData?.bots.find(x => x.bid === r.bot.bid); if (cur) Object.assign(cur, r.bot); updateCard(el, r.bot, true); } return r; });
  const post = (a, body, okText) => act(() => api(`/api/admin/bots/${bid()}/${a}`, { method: 'POST', body: body || {} }), okText).then(r => { if (r) refreshBots(); return r; });
  // name
  const nm = q('name');
  nm.onkeydown = e => { if (e.key === 'Enter') nm.blur(); if (e.key === 'Escape') { nm.value = nm.dataset.v; nm.blur(); } };
  nm.onblur = () => { const v = nm.value.trim(); if (v && v !== nm.dataset.v) patch({ name: v }, r => `Renamed to ${r.bot.name}.`).then(r => { if (!r) nm.value = nm.dataset.v; }); else nm.value = nm.dataset.v; };
  // level stepper (debounced)
  const lv = q('lvl');
  const sendLvl = () => { clearTimeout(el.lvT); el.lvT = setTimeout(() => { el.lvPending = false; const v = Math.min(MAX_LEVEL, Math.max(1, +lv.value || 1)); lv.value = v; patch({ lvl: v }, `Level ${v}.`); }, 450); el.lvPending = true; };
  for (const btn of el.querySelectorAll('.step button')) btn.onclick = () => { lv.value = Math.min(MAX_LEVEL, Math.max(1, (+lv.value || 1) + +btn.dataset.d)); sendLvl(); };
  lv.onchange = sendLvl;
  // capability
  q('seg').onclick = e => { const s = +e.target.closest('button')?.dataset.s; if (s) patch({ skill: s }, r => `${r.bot.name}: capability ${s} (${BOT_SKILLS[s].name}).`); };
  // behaviour + follow
  q('beh').onchange = () => {
    const v = q('beh').value;
    if (v === 'follow') {
      const first = botData.players[0]?.name;
      if (!first) { toast('Nobody is online to follow.'); q('beh').value = el.dataset.beh; return; }
      patch({ behaviour: 'follow', follow: first }, `Following ${first}.`);
    } else patch({ behaviour: v }, r => `${r.bot.name}: ${botData.behaviours[v].split(' (')[0]}.`);
  };
  q('follow').onchange = () => patch({ follow: q('follow').value }, `Following ${q('follow').value}.`);
  // actions
  for (const btn of el.querySelectorAll('[data-a]')) btn.onclick = () => {
    const a = btn.dataset.a, name = nm.dataset.v;
    if (a === 'remove') return act(() => api(`/api/admin/bots/${bid()}`, { method: 'DELETE' }), `Removed ${name}.`).then(r => r && refreshBots());
    if (a === 'heal') return post('heal', null, `${name} healed.`);
    if (a === 'kill') return el.dataset.dead === '1' ? post('revive', null, `${name} revived.`) : post('kill', null, `${name} is down (until revived).`);
  };
  q('tp').onchange = () => {
    const v = q('tp').value; q('tp').value = '';
    if (!v) return;
    const [to, name] = v.split(':');
    post('teleport', { to, name }, `${nm.dataset.v} teleported to ${to === 'player' ? name : ({ gate: 'the Warden gate', camp2: 'Mirelight Camp', gate2: 'the Sunken Gate', camp3: 'Windbreak Camp', gate3: 'the Storm Gate' })[to] || 'town'}.`);
  };
  q('order').onchange = () => {
    const v = q('order').value; q('order').value = '';
    if (!v) return;
    const [cmd, name] = v.split(':');
    post('command', { cmd, name }, `${nm.dataset.v}: ${ORDERS[cmd]}${name ? ` (${name})` : ''}.`);
  };
  const al = q('allow');
  al.onkeydown = e => { if (e.key === 'Enter') al.blur(); if (e.key === 'Escape') { al.value = al.dataset.v; al.blur(); } };
  al.onblur = () => { if (al.value.trim() !== al.dataset.v) patch({ allow: al.value }, r => (r.bot.allow.length ? `${r.bot.name}: allowed ${r.bot.allow.map(a => a.name).join(', ')}.` : `${r.bot.name}: open to anyone.`)); };
  q('look').onchange = () => {
    const v = q('look').value;
    post('look', { look: v }, v ? `${nm.dataset.v} wears ${LOOKS[v].name || v}.` : `${nm.dataset.v}: look removed.`);
  };
  q('respawn').onchange = () => {
    const c = q('respawn').value; q('respawn').value = '';
    if (c) post('respawn', { cls: c }, r => `${r.bot.name} respawned as ${clsName(c)}.`);
  };
  return el;
}

function updateCard(el, b, force = false) {
  const q = k => el.querySelector(`[data-k="${k}"]`);
  el.classList.toggle('down', !!b.dead);
  el.classList.toggle('joining', b.status !== 'online');
  el.dataset.dead = b.dead ? '1' : '0'; el.dataset.beh = b.behaviour;
  const nm = q('name');
  if (!focused(nm) && (force || nm.dataset.v !== b.name)) nm.value = b.name;
  nm.dataset.v = b.name;
  q('skilltag').innerHTML = skillTag(b.skill);
  if (q('seg').dataset.v !== String(b.skill)) { q('seg').innerHTML = segHtml(b.skill); q('seg').dataset.v = b.skill; }
  q('where').textContent = b.status === 'online' ? `${b.floor ? `F${b.floor} · ` : ''}${b.area}` : b.status;
  q('party').innerHTML = (b.party.length ? `<span class="sep">·</span> party: ${esc(b.party.join(', '))}` : '') + (b.owner ? ` <span class="sep">·</span> added by ${esc(b.owner)} (levels with them)` : b.creator ? ` <span class="sep">·</span> made by ${esc(b.creator)}` : '');
  const al = q('allow'), av = (b.allow || []).map(a => a.name).join(', ');
  if (!focused(al) && al.dataset.v !== av) { al.value = av; al.dataset.v = av; }
  const pct = b.maxHp ? Math.round((b.hp / b.maxHp) * 100) : 0;
  q('hpbar').style.width = `${pct}%`;
  el.querySelector('.hp').classList.toggle('low', pct < 35);
  q('hptext').textContent = b.status !== 'online' ? '' : b.dead ? 'DOWN' : `${b.hp} / ${b.maxHp}`;
  const lv = q('lvl');
  if (!focused(lv) && !el.lvPending) lv.value = b.lvl;
  const beh = q('beh');
  if (!focused(beh) && beh.dataset.v !== b.behaviour) { beh.innerHTML = behOptions(b.behaviour); beh.dataset.v = b.behaviour; }
  beh.title = `${botData?.behaviours[b.behaviour] || ''} (this bot only; in a party the leader's course wins: a human, else the tank)`;
  const order = b.order ? ` · <span class="ord">order: ${esc(ORDERS[b.order.cmd] || b.order.cmd)}${b.order.by ? ` (${esc(b.order.by)})` : ''}</span>` : '';
  const goalHtml = b.status === 'online' ? `<span class="dim">${esc(ROLE_NAMES[b.role] || '')}</span> ${esc(b.goal || '')}${order}` : '';
  if (q('goal').dataset.v !== goalHtml) { q('goal').innerHTML = goalHtml; q('goal').dataset.v = goalHtml; }
  const od = q('order'), okey = (botData?.players || []).map(p => p.name).join(',');
  if (!focused(od) && od.dataset.v !== okey) {
    const ps = botData?.players || [];
    od.innerHTML = `<option value="">⌘ Order…</option>${['stay', 'ready', 'potion', 'farm', 'boss', 'status', 'leave'].map(c => `<option value="${c}">${esc(ORDERS[c])}</option>`).join('')}${ps.length ? `<optgroup label="Follow / regroup on">${ps.map(p => `<option value="follow:${esc(p.name)}">Follow ${esc(p.name)}</option><option value="come:${esc(p.name)}">Come to ${esc(p.name)}</option>`).join('')}</optgroup>` : ''}`;
    od.dataset.v = okey;
  }
  od.disabled = !!b.dead || b.status !== 'online';
  const fol = q('follow'), players = botData?.players || [];
  fol.classList.toggle('hidden', b.behaviour !== 'follow');
  const fkey = `${b.follow}|${players.map(p => p.name).join(',')}`;
  if (b.behaviour === 'follow' && !focused(fol) && fol.dataset.v !== fkey) {
    const names = players.map(p => p.name);
    if (b.follow && !names.includes(b.follow)) names.unshift(b.follow);
    fol.innerHTML = names.map(n => `<option ${n === b.follow ? 'selected' : ''}>${esc(n)}</option>`).join('');
    fol.dataset.v = fkey;
  }
  const kb = q('killbtn');
  kb.innerHTML = b.dead ? '↺ Revive' : '☠ Kill'; kb.title = b.dead ? 'Bring it back at full health' : 'Down it until revived';
  el.querySelector('[data-a="heal"]').disabled = !!b.dead || b.status !== 'online';
  const tp = q('tp'), others = [...(botData?.players || []).map(p => p.name), ...(botData?.bots || []).filter(o => o.bid !== b.bid && o.status === 'online').map(o => o.name)];
  const tkey = others.join(',');
  if (!focused(tp) && tp.dataset.v !== tkey) {
    tp.innerHTML = `<option value="">⇢ Teleport…</option><option value="town">Town</option><option value="gate">Warden gate</option><option value="camp2">Mirelight Camp (F2)</option><option value="gate2">Sunken Gate (F2)</option><option value="camp3">Windbreak Camp (F3)</option><option value="gate3">Storm Gate (F3)</option>${others.length ? `<optgroup label="To a player">${others.map(n => `<option value="player:${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>` : ''}`;
    tp.dataset.v = tkey;
  }
  tp.disabled = !!b.dead;
  const rs = q('respawn');
  if (!rs.options.length) rs.innerHTML = `<option value="">⟳ Respawn as…</option>${CLASS_IDS.filter(c => c !== b.cls).map(c => `<option value="${c}">${esc(clsName(c))}</option>`).join('')}`;
  const lk = q('look');
  if (!lk.options.length) lk.innerHTML = `<option value="">◈ Look: none</option>${Object.entries(LOOKS).map(([id, l]) => `<option value="${id}">${esc(l.name || id)}</option>`).join('')}`;
  if (!focused(lk)) lk.value = b.look || '';
}

// ---------- PLAYERS ----------
let pData = null, sort = { k: 'lastSeen', asc: false }, pStatus = 'all';
function setupPlayers() {
  $('p-cls').innerHTML = `<option value="">All classes</option>${CLASS_IDS.map(c => `<option value="${c}">${esc(clsName(c))}</option>`).join('')}`;
  $('p-lmax').placeholder = MAX_LEVEL;
  for (const id of ['p-search', 'p-lmin', 'p-lmax']) $(id).oninput = renderPlayers;
  $('p-cls').onchange = renderPlayers;
  for (const b of $('p-status').children) b.onclick = () => { pStatus = b.dataset.v; for (const x of $('p-status').children) x.classList.toggle('on', x === b); renderPlayers(); };
  $('p-refresh').onclick = () => refreshPlayers();
  for (const th of document.querySelectorAll('#tab-players th[data-sort]')) th.onclick = () => {
    const k = th.dataset.sort;
    sort = { k, asc: sort.k === k ? !sort.asc : ['name', 'cls', 'account', 'area'].includes(k) };
    renderPlayers();
  };
  setInterval(() => { if (tab === 'players' && !document.hidden) refreshPlayers(); }, 5000);
}
async function refreshPlayers(quiet = false) {
  try { pData = await api('/api/admin/players'); } catch (e) { if (!quiet) toast(e.message); return; }
  const mine = pData.players.find(p => p.online && p.accountId === me?.account.id) || null;
  if ((mine?.name || null) !== (myChar?.name || null) || mine?.lvl !== myChar?.lvl) { myChar = mine; renderPresets(); }
  if (!quiet || tab === 'players') renderPlayers();
}
function renderPlayers() {
  if (!pData) return;
  const s = $('p-search').value.trim().toLowerCase(), c = $('p-cls').value;
  const lo = +$('p-lmin').value || 1, hi = +$('p-lmax').value || MAX_LEVEL;
  let rows = pData.players.filter(p => (pStatus === 'all' || (pStatus === 'online') === p.online) && (!c || p.cls === c) && p.lvl >= lo && p.lvl <= hi
    && (!s || p.name.toLowerCase().includes(s) || p.account.toLowerCase().includes(s)));
  const val = (p, k) => (k === 'access' ? (p.admin ? ACCESS_ADMIN : p.access) : k === 'online' ? (p.online ? 1 : 0) : k === 'lastSeen' || k === 'created' ? new Date(p[k]).getTime() : k === 'area' ? p.area || '' : k === 'cls' ? clsName(p.cls) : p[k]);
  rows.sort((a, b) => { const x = val(a, sort.k), y = val(b, sort.k); const r = typeof x === 'string' ? x.localeCompare(y) : x - y; return sort.asc ? r : -r; });
  for (const th of document.querySelectorAll('#tab-players th[data-sort]')) { th.classList.toggle('sorted', th.dataset.sort === sort.k); th.classList.toggle('asc', sort.asc); }
  const on = pData.players.filter(p => p.online).length;
  $('p-count').textContent = `${rows.length} shown · ${pData.players.length} characters · ${on} online`;
  $('p-rows').innerHTML = rows.map(p => `<tr class="click" data-id="${p.id}">
    <td><span class="who">${clsIcon(p.cls)}<b>${esc(p.name)}</b></span></td>
    <td><span class="cls-name" style="--cc:${clsColor(p.cls)}">${esc(clsName(p.cls))}</span></td>
    <td><span class="lv">${p.lvl}</span><span class="lvbar"><i style="width:${Math.round((p.lvl / MAX_LEVEL) * 100)}%;background:${clsColor(p.cls)}"></i></span></td>
    <td>${esc(p.account)}${p.admin ? ' <span class="pill adm">ADMIN</span>' : ''}</td>
    <td>${p.admin ? `<span class="pill adm" title="Admins count as ${ACCESS_ADMIN}">${ACCESS_ADMIN}</span>` : `<select class="acc" data-acct="${p.accountId}" title="Access level for account #${p.accountId} (all its characters). ${ACCESS.overrideBots}+ controls any bot.">${Array.from({ length: ACCESS_MAX - ACCESS_MIN + 1 }, (_, i) => i + ACCESS_MIN).map(v => `<option value="${v}" ${v === p.access ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</td>
    <td>${p.online ? '<span class="pill on">online</span>' : '<span class="pill">offline</span>'}</td>
    <td>${p.online ? `F${p.floor} · ${esc(p.area)}${p.party.length ? ` <span class="dim">(party: ${esc(p.party.join(', '))})</span>` : ''}` : '<span class="faint">—</span>'}</td>
    <td>${p.online ? 'now' : ago(p.lastSeen)}</td><td class="dim">${date(p.created)}</td></tr>`).join('') || '<tr><td colspan="9" class="dim" style="text-align:center;padding:30px">No characters match.</td></tr>';
  for (const tr of $('p-rows').querySelectorAll('tr[data-id]')) tr.onclick = e => { if (!e.target.closest('select.acc')) openEditor(+tr.dataset.id); };
  for (const sel of $('p-rows').querySelectorAll('select.acc')) sel.onchange = () => { // an account's access level (every character of it)
    const id = +sel.dataset.acct, level = +sel.value;
    act(() => api(`/api/admin/accounts/${id}/access`, { method: 'POST', body: { level } }), `Account #${id}: access level ${level}.`).then(r => { if (r) { for (const p of pData.players) if (p.accountId === id) p.access = level; renderPlayers(); } else renderPlayers(); });
  };
  $('p-extra').innerHTML = `<h2>Not in the list</h2><div class="dim">${pData.anon.length ? `Anonymous (unsaved) players online: ${pData.anon.map(a => `<span style="color:${clsColor(a.cls)}">${esc(a.name)}</span> (Lv ${a.lvl} ${esc(clsName(a.cls))}, ${esc(a.area)})`).join(', ')}.` : 'No anonymous players online.'} ${pData.bots} bot${pData.bots === 1 ? '' : 's'} online (see the Bots tab).</div>`;
}

// ---------- EDIT ----------
let ch = null; // the character being edited (as the server last sent it)
async function openEditor(id) {
  try { ch = (await api(`/api/admin/characters/${id}`)).character; } catch (e) { return toast(e.message); }
  axEdit = null;
  $('tabs').querySelector('[data-tab=edit]').disabled = false;
  show('edit');
  history.replaceState(null, '', `#edit=${id}`);
  renderEditor();
}
async function patch(body, okText = 'Saved.') {
  try {
    ch = (await api(`/api/admin/characters/${ch.id}`, { method: 'PATCH', body })).character;
    axEdit = null; // (an open affix editor closes once saved; on an error it stays open)
    renderEditor();
    toast(okText + (ch.online ? ' Applied live to the online player.' : ''), true);
  } catch (e) { toast(e.message); }
}
const setTag = it => (it.set && SETS[it.set] ? `<span class="settag" style="color:${SETS[it.set].color}">${esc(SETS[it.set].name)}</span>` : '');
const axLines = it => (it.ax || []).map(a => `<span class="ax${isTeamAffix(a) ? ' team' : ''}">◆ ${esc(affixText(a, ch?.cls))}</span>`).join('');
const itemLine = it => `<span class="nm" style="color:${RARITY[it.r]?.color || '#fff'}">${esc(it.name)}${it.la ? ' ★' : ''}${setTag(it)}${axLines(it)}</span><span class="st">${Object.entries(it.st || {}).map(([k, v]) => statLabel(k, v)).join(', ')}${it.cls ? ` · ${esc(clsName(it.cls))}` : ''}${it.slot === 'weapon' && it.cls ? ` · ${esc(styleLine(it).split(':')[0])}` : ''}</span>`;
// Affix + set editor under an item row (H2): kind, value, skill (skill affixes), set; saved with the editItem op.
let axEdit = null; // { u, ax: [...], set }
function axEditorHtml(it) {
  const E = axEdit, cls = ch.cls, skills = CLASSES[cls]?.skills || [];
  const rows = E.ax.map((a, i) => {
    const A = AFFIXES[a.k];
    const kinds = AFFIX_IDS.filter(k => AFFIXES[k].slots.includes(it.slot)).map(k => `<option value="${k}" ${k === a.k ? 'selected' : ''}>${k}</option>`).join('');
    const sk = A?.skill ? `<select data-axs="${i}">${skills.map(s => `<option value="${s.id}" ${s.id === a.s ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : '';
    return `<div class="axr"><select data-axk="${i}">${kinds}</select><input type="number" step="0.5" min="0.5" data-axv="${i}" value="${a.v}" style="width:70px" />${sk}<span class="dim" style="font-size:11px">${A ? `${esc(affixText({ ...a, c: cls }, cls))} · Epic roll ~${A.v[3]}` : ''}</span><button class="small danger" data-axdel="${i}">✕</button></div>`;
  }).join('');
  const sets = Object.keys(SETS).filter(id => SETS[id].pieces[it.slot]);
  return `<div class="axed">${rows || '<span class="faint">No affixes.</span>'}
    <div class="axr"><button class="small" data-axadd>+ Affix</button><button class="small" data-axroll>Roll fresh (by rarity)</button>
    <label class="dim" style="font-size:12px">Set <select data-axset><option value="">none</option>${sets.map(id => `<option value="${id}" ${E.set === id ? 'selected' : ''}>${esc(SETS[id].name)}</option>`).join('')}</select></label>
    <span class="grow"></span><button class="small primary" data-axsave>Save item</button><button class="small ghost" data-axcancel>Cancel</button></div></div>`;
}
const itemRow = (slotLabel, it, btns) => `<div class="it"><span class="slot">${slotLabel}</span>${itemLine(it)}${it.ks ? '' : `<button class="small" data-axopen="${it.u}">Affixes</button>`}${btns}</div>${axEdit?.u === it.u ? axEditorHtml(it) : ''}`;

function renderEditor() {
  const c = ch, inv = c.inv, st = c.stats;
  const num = (id, v, min = 0, max = '') => `<input type="number" id="${id}" value="${v ?? 0}" min="${min}" ${max !== '' ? `max="${max}"` : ''} />`;
  const xpNext = c.lvl >= MAX_LEVEL ? 0 : xpToNext(c.lvl);
  $('e-body').innerHTML = `
  <div class="lead" style="--cc:${clsColor(c.cls)}">${clsIcon(c.cls)}
    <div><h2>${esc(c.name)}</h2><div class="sub"><span class="cls-name">Lv ${c.lvl} ${esc(clsName(c.cls))}</span>
      ${c.online ? `<span class="pill on">online · F${c.floor} · ${esc(c.area)}</span>` : '<span class="pill">offline</span>'}
      <span>account: ${esc(c.account.label)} (#${c.account.id})${c.account.admin ? ' <span class="pill adm">ADMIN</span>' : ''}</span>
      <span class="faint">created ${date(c.created_at)} · last seen ${c.online ? 'now' : ago(c.updated_at)}</span></div></div>
    <span class="grow"></span><button id="e-max" class="primary" title="Max level, Floors 2 and 3, Mastery 5 + evolutions, all talents, a full boss set with top affixes, 20 of each consumable">⚡ Maxed preset</button><button id="e-reload" class="ghost">↻ Reload</button><button id="e-back">← Players</button></div>
  <div class="secnav"><a href="#" data-go="e-sec-char">Character</a><a href="#" data-go="e-sec-cons">Consumables &amp; materials</a><a href="#" data-go="e-sec-titles">Titles &amp; stats</a><a href="#" data-go="e-sec-mastery">Skill mastery</a><a href="#" data-go="e-sec-items">Items</a><a href="#" data-go="e-sec-raw">Raw JSON</a><a href="#" data-go="e-sec-danger" style="color:#fca5a5">Delete</a></div>
  <div class="grid">
    <section class="card esec" id="e-sec-char"><h2>Character</h2>
      <div class="row"><label class="f">Name<input id="e-name" value="${esc(c.name)}" maxlength="16" /></label><button id="e-rename" style="margin-bottom:10px">Rename</button></div>
      <div class="row"><label class="f">Class<select id="e-cls" ${c.online ? 'disabled title="Only while offline"' : ''}>${CLASS_IDS.map(k => `<option value="${k}" ${k === c.cls ? 'selected' : ''}>${esc(clsName(k))}</option>`).join('')}</select></label>
      ${c.online ? '<span class="dim" style="font-size:12px;margin-bottom:12px">class changes only while offline</span>' : '<button id="e-setcls" style="margin-bottom:10px">Change class</button>'}</div>
      <label class="f">Level (1–${MAX_LEVEL})${num('e-lvl', c.lvl, 1, MAX_LEVEL)}</label>
      <label class="f"><span>XP <span id="e-xpmax">(of ${xpNext})</span></span>${num('e-xp', c.xp)}</label>
      <label class="f">Gold${num('e-gold', c.gold)}</label>
      <div><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="e-f2" ${st.floor2 ? 'checked' : ''} /> Floor 2 unlocked</label>
      ${!st.floor2 && st.wardenKills > 0 ? '<span class="dim" style="font-size:12px"> (also unlocked by its Warden kills)</span>' : ''}
      <label style="display:inline-flex;gap:6px;align-items:center;margin-left:14px"><input type="checkbox" id="e-f3" ${st.floor3 ? 'checked' : ''} /> Floor 3 unlocked</label>
      ${!st.floor3 && st.sovereignKills > 0 ? '<span class="dim" style="font-size:12px"> (also unlocked by its Sovereign kills)</span>' : ''}</div>
    </section>
    <section class="card esec" id="e-sec-cons"><h2>Consumables &amp; materials</h2>
      <div>${CONSUMABLE_IDS.map(k => `<label class="f">${esc(CONSUMABLES[k].name)}${num(`e-cons-${k}`, inv.cons?.[k] || 0, 0, 999)}</label>`).join('')}</div>
      <div>${MAT_IDS.map(k => `<label class="f" style="color:${MATS[k].color}">${esc(MATS[k].name)}${num(`e-mat-${k}`, inv.mats?.[k] || 0, 0, 99999)}</label>`).join('')}</div>
    </section>
    <section class="card esec" id="e-sec-titles"><h2>Titles</h2>
      <div class="titles">${TITLES.map(t => `<label style="color:${t.color}"><input type="checkbox" data-title="${t.id}" ${st.titles.includes(t.id) ? 'checked' : ''} />${esc(t.name)}</label>`).join('')}</div>
      <label class="f" style="margin-top:6px">Active title<select id="e-active"><option value="">(none: Newcomer)</option>${TITLES.map(t => `<option value="${t.id}" ${st.activeTitle === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <h2 style="margin-top:8px">Lifetime stats</h2>
      <div>${STAT_KEYS.filter(k => k !== 'floor2' && k !== 'floor3').map(k => `<label class="f">${k}${num(`e-st-${k}`, st[k] || 0)}</label>`).join('')}</div>
    </section>
  </div>
  <section class="card esec" id="e-sec-mastery"><h2>Skill mastery &amp; evolutions</h2>
    <table><thead><tr><th>Skill</th><th>Mastery</th><th>Points</th><th>Evolution (Mastery ${MASTERY.evolveAt}+)</th></tr></thead><tbody>
    ${Object.entries(c.mastery).map(([sk, e]) => { const def = CLASSES[c.cls].skills.find(s => s.id === sk), B = BRANCHES[sk]; return `<tr>
      <td><b>${esc(def?.name || sk)}</b></td>
      <td><select data-mlvl="${sk}">${[1, 2, 3, 4, 5].map(l => `<option ${masteryLevel(e.pts) === l ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input type="number" data-mpts="${sk}" value="${e.pts}" min="0" style="width:100px" /></td>
      <td><select data-mbr="${sk}"><option value="">none</option>${B ? ['A', 'B'].map(k => `<option value="${k}" ${e.br === k ? 'selected' : ''}>${k}: ${esc(B[k].name)}</option>`).join('') : ''}</select></td></tr>`; }).join('')}
    </tbody></table>
    <div class="dim" style="font-size:12px;margin-top:6px">Picking a mastery level sets the points to that level's threshold (${MASTERY.need.slice(1).join(' / ')}); or type exact points.</div>
  </section>
  <section class="card esec" id="e-sec-talents"><h2>Talents <span class="dim" style="font-size:12px;font-weight:400">${spentOf(c.talents || {})} of ${pointsAt(c.lvl)} points spent (1 per level from 2)</span></h2>
    ${TREES[c.cls] ? `<div class="grid">${TREES[c.cls].branches.map(b => `<div><b style="color:${b.color}">${esc(b.name)}</b>${b.nodes.map(nd => `<label class="f" style="display:flex;justify-content:space-between;gap:8px;align-items:center">${esc(nd.name)}${nd.keystone ? ' ★' : ''} <span class="dim" style="font-size:11px">T${nd.tier + 1}</span><input type="number" data-tal="${nd.id}" value="${c.talents?.[nd.id] || 0}" min="0" max="${nd.max}" style="width:60px" /></label>`).join('')}</div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button id="t-save" class="primary">Save talents</button><button id="t-reset">Reset talents (refund all)</button><span class="dim" style="font-size:12px">Checked against the tree: tier gates, prerequisites, max ranks and the level's points.</span></div>` : '<div class="dim">No talent tree for this class.</div>'}
  </section>
  <div class="grid" id="e-sec-items">
    <section class="card items esec"><h2>Equipped</h2>
      ${SLOTS.map(s => (inv.eq[s] ? itemRow(s, inv.eq[s], `<button class="small" data-uneq="${s}">To bag</button><button class="small danger" data-rmu="${inv.eq[s].u}">Remove</button>`) : `<div class="it"><span class="slot">${s}</span><span class="nm faint">—</span></div>`)).join('')}
      <h2 style="margin-top:14px">Bag (${inv.bag.length}/24)</h2>
      ${inv.bag.map(it => itemRow(it.slot, it, `<button class="small" data-eq="${it.u}">Equip</button><button class="small danger" data-rmu="${it.u}">Remove</button>`)).join('') || '<div class="faint">Empty.</div>'}
    </section>
    <section class="card esec"><h2>Add an item</h2>
      <div class="row">
        <label class="f">Slot<select id="a-slot">${SLOTS.map(s => `<option>${s}</option>`).join('')}</select></label>
        <label class="f">Rarity<select id="a-r">${RARITY.slice(0, 4).map((r, i) => `<option value="${i}" style="color:${r.color}">${r.name}</option>`).join('')}</select></label>
        <label class="f" id="a-cls-w">Weapon class<select id="a-cls">${CLASS_IDS.map(k => `<option value="${k}" ${k === c.cls ? 'selected' : ''}>${esc(clsName(k))}</option>`).join('')}</select></label>
        <label class="f" id="a-style-w">Weapon style<select id="a-style"></select></label>
        <label class="f hidden" id="a-charm-w">Charm affix<select id="a-charm"><option value="">random</option><option value="crit">Keenness (crit)</option><option value="haste">Haste</option><option value="sw">the Switch</option></select></label>
        <label class="f" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" id="a-ax" checked /> roll affixes</label>
        <button id="a-add" style="margin-bottom:10px">Add to bag</button>
      </div>
      <h2 style="margin-top:6px">Add a set piece</h2>
      <div class="row">
        <label class="f">Set<select id="s-set">${Object.keys(SETS).map(id => `<option value="${id}" ${id === bestSetFor(c.cls) ? 'selected' : ''} style="color:${SETS[id].color}">${esc(SETS[id].name)} (${esc(SETS[id].from)})</option>`).join('')}</select></label>
        <label class="f">Piece<select id="s-slot"></select></label>
        <button id="s-add" style="margin-bottom:10px">Add to bag</button>
      </div>
      <div class="dim" style="font-size:12px" id="s-bonus"></div>
      <div class="row"><button id="a-la1" style="color:${RARITY[4].color}">+ Horn of the Warden</button><button id="a-la2" style="color:${RARITY[4].color}">+ Sovereign's Tidecloak</button><button id="a-la3" style="color:${RARITY[4].color}">+ Stormheart</button></div>
    </section>
  </div>
  <section class="card esec" id="e-sec-raw"><h2>Advanced: raw JSON</h2>
    <div class="dim" style="font-size:12px;margin-bottom:8px">Edit the stored inventory, stats, skill mastery and talents directly (validated on the server; unknown stats keys are kept).</div>
    <div class="grid" style="margin:0"><div><b>inv</b><textarea id="r-inv" spellcheck="false"></textarea></div><div><b>stats</b><textarea id="r-stats" spellcheck="false"></textarea></div><div><b>mastery</b><textarea id="r-mastery" spellcheck="false"></textarea></div><div><b>talents</b><textarea id="r-talents" spellcheck="false"></textarea></div></div>
    <div class="row c" style="margin-top:8px"><button id="r-apply" class="primary">Apply raw JSON</button><span id="r-err" style="color:var(--bad)"></span></div>
  </section>
  <section class="card esec danger-zone" id="e-sec-danger"><h2>Delete character</h2>
    <div class="row"><label class="f"><span>Type <b style="color:#fff">${esc(c.name)}</b> to confirm</span><input id="d-name" autocomplete="off" /></label><button class="danger" id="d-go" style="margin-bottom:10px">Delete forever</button></div>
  </section>
  <div class="body-pad"></div>
  <div class="savebar"><button class="primary" id="e-save">Save changes</button><span class="dim" style="font-size:12px">Level, XP, gold, consumables, materials, titles, stats, mastery and the Floor 2 / 3 flags · <b style="color:var(--text)">${esc(c.name)}</b>${c.online ? ' (online: applied live)' : ''}</span></div>`;
  $('r-inv').value = JSON.stringify(inv, null, 2);
  $('r-stats').value = JSON.stringify(st, null, 2);
  $('r-mastery').value = JSON.stringify(c.mastery, null, 2);
  $('r-talents').value = JSON.stringify(c.talents || {}, null, 2);
  wireEditor();
}

function wireEditor() {
  const c = ch;
  for (const a of document.querySelectorAll('.secnav a')) a.onclick = e => { e.preventDefault(); $(a.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('e-back').onclick = () => show('players');
  $('e-reload').onclick = () => openEditor(c.id);
  $('e-max').onclick = () => {
    if (!confirm(`Max out ${c.name}?\n\nLevel ${MAX_LEVEL}, Floors 2 and 3 unlocked, every skill Mastery 5 with an evolution, all talent points spent (recommended path; current talents are replaced), an Epic weapon with top rolls (same style), a full ${SETS[bestSetFor(c.cls)].name} set with top rolls and 3 top affixes per piece (the weapon keeps its style), the three Last Attack items in the bag if missing, and 20 of each consumable. Worn gear goes to the bag if there's room.`)) return;
    patch({ preset: 'maxed' }, `${c.name} is maxed.`);
  };
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
      stats: Object.fromEntries(STAT_KEYS.filter(k => k !== 'floor2' && k !== 'floor3').map(k => [k, +$(`e-st-${k}`).value])),
      floor2: $('e-f2').checked, floor3: $('e-f3').checked, titles, activeTitle: titles.includes(active) ? active : null,
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
  const slotVis = () => { $('a-cls-w').classList.toggle('hidden', $('a-slot').value !== 'weapon'); $('a-style-w').classList.toggle('hidden', $('a-slot').value !== 'weapon'); $('a-charm-w').classList.toggle('hidden', $('a-slot').value !== 'charm'); };
  const styleOpts = () => { $('a-style').innerHTML = (CLASS_STYLES[$('a-cls').value] || []).map(id => `<option value="${id}">${esc(STYLES[id].name)}${STYLES[id].def ? ' (default)' : ''}</option>`).join(''); }; // weapon styles
  $('a-cls').onchange = styleOpts; styleOpts();
  $('a-slot').onchange = slotVis; slotVis();
  $('a-add').onclick = () => patch({ ops: [{ op: 'addItem', slot: $('a-slot').value, r: +$('a-r').value, cls: $('a-cls').value, style: $('a-style').value, charm: $('a-charm').value, ax: $('a-ax').checked }] }, 'Item added.');
  // set pieces
  const setOpts = () => {
    const id = $('s-set').value, S = SETS[id];
    $('s-slot').innerHTML = `<option value="all">Full set (${setSlots(id).length})</option>` + setSlots(id).map(s => `<option value="${s}">${esc(S.pieces[s].name || `${S.name} weapon`)}</option>`).join('');
    $('s-bonus').innerHTML = Object.entries(S.bonus).map(([n, fx]) => `<b>${n} pieces:</b> ${fx.map(e => esc(e.desc || (e.stat ? affixText({ k: e.stat, v: e.v }, c.cls) : `${e.sk} +${e.dmg}% damage`))).join('; ')}`).join('<br>');
  };
  $('s-set').onchange = setOpts; setOpts();
  $('s-add').onclick = () => patch({ ops: [{ op: 'addSet', set: $('s-set').value, slot: $('s-slot').value }] }, 'Set piece added.');
  // affix editor
  const findIt = u => [...c.inv.bag, ...SLOTS.map(s => c.inv.eq[s]), c.inv.eq.weapon2].find(it => it?.u === u);
  for (const b of document.querySelectorAll('[data-axopen]')) b.onclick = () => {
    const it = findIt(+b.dataset.axopen);
    axEdit = axEdit?.u === it.u ? null : { u: it.u, ax: (it.ax || []).map(a => ({ ...a })), set: it.set || '' };
    renderEditor();
  };
  if (axEdit) {
    const it = findIt(axEdit.u), E = axEdit, rr = () => { const y = scrollY; renderEditor(); scrollTo(0, y); };
    if (!it) axEdit = null;
    else {
      const skillsOf = k => (AFFIXES[k]?.skill ? CLASSES[c.cls]?.skills || [] : []);
      for (const el of document.querySelectorAll('[data-axk]')) el.onchange = () => { const a = E.ax[+el.dataset.axk]; a.k = el.value; a.v = AFFIXES[a.k].v[Math.min(3, it.r)]; if (AFFIXES[a.k].skill) { a.c = c.cls; a.s = skillsOf(a.k)[0]?.id; } else { delete a.s; delete a.c; } rr(); };
      for (const el of document.querySelectorAll('[data-axv]')) el.oninput = () => { E.ax[+el.dataset.axv].v = +el.value; };
      for (const el of document.querySelectorAll('[data-axs]')) el.onchange = () => { E.ax[+el.dataset.axs].s = el.value; E.ax[+el.dataset.axs].c = c.cls; rr(); };
      for (const el of document.querySelectorAll('[data-axdel]')) el.onclick = () => { E.ax.splice(+el.dataset.axdel, 1); rr(); };
      document.querySelector('[data-axadd]').onclick = () => {
        if (E.ax.length >= 4) return toast('At most 4 affixes.');
        const k = AFFIX_IDS.find(x => AFFIXES[x].slots.includes(it.slot) && !E.ax.some(a => a.k === x));
        const a = { k, v: AFFIXES[k].v[Math.min(3, it.r)] };
        if (AFFIXES[k].skill) { a.c = c.cls; a.s = skillsOf(k)[0]?.id; }
        E.ax.push(a); rr();
      };
      document.querySelector('[data-axset]').onchange = e => { E.set = e.target.value; };
      document.querySelector('[data-axroll]').onclick = () => { patch({ ops: [{ op: 'editItem', u: E.u, ax: 'roll' }] }, 'Affixes rolled.'); };
      document.querySelector('[data-axsave]').onclick = () => { patch({ ops: [{ op: 'editItem', u: E.u, ax: E.ax, set: E.set || null }] }, 'Item saved.'); };
      document.querySelector('[data-axcancel]').onclick = () => { axEdit = null; rr(); };
    }
  }
  $('a-la1').onclick = () => patch({ ops: [{ op: 'addLastAttack', which: 1 }] }, 'Item added.');
  $('a-la2').onclick = () => patch({ ops: [{ op: 'addLastAttack', which: 2 }] }, 'Item added.');
  $('a-la3').onclick = () => patch({ ops: [{ op: 'addLastAttack', which: 3 }] }, 'Item added.');
  $('r-apply').onclick = () => {
    let rawInv, rawStats, rawMastery;
    try { rawInv = JSON.parse($('r-inv').value); } catch (e) { $('r-err').textContent = `inv: ${e.message}`; return; }
    try { rawStats = JSON.parse($('r-stats').value); } catch (e) { $('r-err').textContent = `stats: ${e.message}`; return; }
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
      toast(`${c.name} was deleted.`, true);
      ch = null; $('tabs').querySelector('[data-tab=edit]').disabled = true;
      show('players');
    } catch (e) { toast(e.message); }
  };
}

boot();
