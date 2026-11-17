// Admin part of /stats.html: detailed play-tracking charts from /api/admin/stats (server/track.js detail()).
// Shown only to admin accounts (the game's session in localStorage fb_session); everyone else sees the public summary.
import { CLASSES } from '/shared/data.js';
import { STYLES } from '/shared/styles.js';
import { TWISTS } from '/shared/twists.js';
import { nodeDef } from '/shared/talents.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const token = localStorage.getItem('fb_session');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '%';
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '?');
const clsName = c => CLASSES[c]?.name || cap(c);
const clsColor = c => { const v = CLASSES[c]?.color; return typeof v === 'number' ? `#${v.toString(16).padStart(6, '0')}` : v || '#9cc4ff'; };
const styleName = s => STYLES[s]?.name || (s ? cap(s) : 'Default');
const twistName = t => (t ? TWISTS[t]?.name || cap(t) : 'No twist');
const BOSS = { 1: 'Warden', 2: 'Sovereign' };
const date = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Categorical slots (dark steps of the validated reference palette, checked on this page's surface).
const C = { s1: 'var(--s1)', s2: 'var(--s2)', s3: 'var(--s3)', s4: 'var(--s4)', muted: 'var(--s0)' };
const PHASE_SEG = [ // death context: outside a boss fight, then boss phase 1-3
  { k: 'field', label: 'Outside boss fights', color: C.muted }, { k: 0, label: 'Boss phase 1', color: C.s1 },
  { k: 1, label: 'Boss phase 2', color: C.s2 }, { k: 2, label: 'Boss phase 3', color: C.s3 },
];

// ---------- tiny chart kit (HTML/CSS bars, hover tooltips through data-tip) ----------
const legend = segs => `<div class="lg">${segs.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
// rows: [{ label (html), segs: [{ v, color, tip }], total? (text) }] as horizontal stacked bars on one scale
function hbars(rows, { lw = 200 } = {}) {
  if (!rows.length) return '<div class="sub">No data yet.</div>';
  const max = Math.max(1, ...rows.map(r => sum(r.segs, s => s.v)));
  return rows.map(r => {
    const tot = sum(r.segs, s => s.v);
    return `<div class="row"><span class="lbl" style="width:${lw}px">${r.label}</span><span class="bar"><span class="stack" style="width:${(tot / max) * 100}%">${r.segs.filter(s => s.v > 0)
      .map(s => `<div style="flex:${s.v};background:${s.color}" data-tip="${esc(s.tip)}"></div>`).join('')}</span></span><span class="n">${r.total ?? tot}</span></div>`;
  }).join('');
}
// cols: [{ label, segs: [{ v, color, tip }] }] as vertical stacked columns
function vbars(cols, { h = 140 } = {}) {
  if (!cols.some(c => sum(c.segs, s => s.v))) return '<div class="sub">No data yet.</div>';
  const max = Math.max(1, ...cols.map(c => sum(c.segs, s => s.v)));
  return `<div class="cols" style="height:${h + 34}px">${cols.map(c => {
    const tot = sum(c.segs, s => s.v);
    return `<div class="col"><span class="cv">${tot || ''}</span><span class="cstack" style="height:${(tot / max) * h}px">${c.segs.filter(s => s.v > 0).reverse()
      .map(s => `<div style="flex:${s.v};background:${s.color}" data-tip="${esc(s.tip)}"></div>`).join('')}</span><span class="cl">${esc(c.label)}</span></div>`;
  }).join('')}</div>`;
}
const tile = (v, label) => `<div class="card"><b>${v}</b><span>${label}</span></div>`;
const panel = (title, q, body) => `<div class="panel"><h3>${title}</h3><div class="q">${q}</div>${body}</div>`;

// ---------- 1. where people die ----------
function deathsSection(d, who) {
  const rows = d.deaths.filter(r => who === 'all' || (who === 'bots') === r.bot);
  const byCause = new Map();
  for (const r of rows) {
    const k = `${r.boss || 0}|${r.cause}`;
    if (!byCause.has(k)) byCause.set(k, { cause: r.cause, boss: r.boss, field: 0, 0: 0, 1: 0, 2: 0, n: 0 });
    const c = byCause.get(k);
    c[r.boss ? Math.min(2, r.phase | 0) : 'field'] += r.n; c.n += r.n;
  }
  const top = [...byCause.values()].sort((a, b) => b.n - a.n).slice(0, 12);
  const causeChart = hbars(top.map(c => ({
    label: `${c.boss ? `<span class="fl ${c.boss === 2 ? 'f2' : ''}">${BOSS[c.boss]}</span>` : ''}${esc(c.cause)}`,
    segs: PHASE_SEG.map(s => ({ v: c[s.k], color: s.color, tip: `${c.cause}: ${c[s.k]} ${s.k === 'field' ? 'outside boss fights' : `in ${BOSS[c.boss] || 'boss'} phase ${s.k + 1}`}` })),
  })));
  // boss deaths by phase: floor x phase grid, shaded by count
  const grid = { 1: [0, 0, 0], 2: [0, 0, 0] };
  for (const r of rows) if (r.boss) grid[r.boss][Math.min(2, r.phase | 0)] += r.n;
  const gmax = Math.max(1, ...Object.values(grid).flat());
  const phaseGrid = `<table class="pgrid"><thead><tr><th></th><th>Phase 1</th><th>Phase 2</th><th>Phase 3</th></tr></thead><tbody>${[1, 2].map(f =>
    `<tr><td>${BOSS[f]}</td>${grid[f].map((n, i) => `<td data-tip="${BOSS[f]} phase ${i + 1}: ${n} deaths" style="background:rgba(57,135,229,${(0.08 + 0.7 * n / gmax).toFixed(2)})">${n}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  // Warden twists: fights, kill rate, deaths per fight
  const tw = new Map();
  for (const f of d.fights.filter(f => f.floor === 1)) {
    const k = f.twist || '';
    const t = tw.get(k) || { twist: f.twist, fights: 0, kills: 0, deaths: 0, bot_deaths: 0 };
    t.fights += f.fights; t.kills += f.kills; t.deaths += f.deaths; t.bot_deaths += f.bot_deaths; tw.set(k, t);
  }
  const twRows = [...tw.values()].sort((a, b) => b.fights - a.fights);
  const dpf = t => (who === 'bots' ? t.bot_deaths : who === 'players' ? t.deaths : t.deaths + t.bot_deaths) / t.fights;
  const dmax = Math.max(0.01, ...twRows.map(dpf));
  const twistTable = twRows.length ? `<table class="tbl"><thead><tr><th>Twist</th><th>Fights</th><th>Kill rate</th><th>Deaths per fight</th></tr></thead><tbody>${twRows.map(t =>
    `<tr><td>${esc(twistName(t.twist))}</td><td>${t.fights}</td><td>${pct(t.kills, t.fights)}</td><td><span class="ib"><span style="width:${(dpf(t) / dmax) * 100}%;background:${C.s2}"></span></span>${dpf(t).toFixed(1)}</td></tr>`).join('')}</tbody></table>` : '<div class="sub">No Warden fights yet.</div>';
  return `<div class="two">
    ${panel('What kills them', 'Top causes of death, split by where it happened: out in the world, or which boss phase.', legend(PHASE_SEG) + causeChart)}
    <div>${panel('Boss deaths by phase', 'Which phase of each boss fight people die in.', phaseGrid)}
    ${panel('Warden twists', 'How each random twist changes the fight.', twistTable)}</div></div>`;
}

// ---------- 2. where they quit or get stuck ----------
function quitSection(d) {
  const LB = d.lenBuckets.map(s => s / 60), names = [`< ${LB[0]} min`, ...LB.slice(1).map((m, i) => `${LB[i]}–${m} min`), `${LB[LB.length - 1]}+ min`];
  const lenChart = vbars(names.map((label, i) => {
    const n = d.lengths.find(r => r.b === i)?.n || 0;
    return { label, segs: [{ v: n, color: C.s1, tip: `${n} sessions of ${label}` }] };
  }));
  const GONE = { label: `Dropped off (no play for ${d.quitDays}+ days)`, color: C.s2 }, ACTIVE = { label: 'Still playing', color: C.s1 };
  const zones = new Map();
  for (const r of d.dropoff) { const z = zones.get(r.zone) || { gone: 0, active: 0 }; z[r.gone ? 'gone' : 'active'] += r.n; zones.set(r.zone, z); }
  const zoneChart = hbars([...zones].sort((a, b) => (b[1].gone + b[1].active) - (a[1].gone + a[1].active)).map(([zone, z]) => ({
    label: esc(zone), segs: [{ v: z.gone, color: GONE.color, tip: `${zone}: ${z.gone} dropped off here` }, { v: z.active, color: ACTIVE.color, tip: `${zone}: ${z.active} still playing` }],
  })), { lw: 220 });
  const maxLvl = Math.max(1, ...d.dropoff.map(r => r.lvl || 1));
  const lvlChart = vbars(Array.from({ length: maxLvl }, (_, i) => {
    const at = d.dropoff.filter(r => (r.lvl || 1) === i + 1), g = sum(at.filter(r => r.gone), r => r.n), a = sum(at.filter(r => !r.gone), r => r.n);
    return { label: String(i + 1), segs: [{ v: g, color: GONE.color, tip: `Level ${i + 1}: ${g} dropped off` }, { v: a, color: ACTIVE.color, tip: `Level ${i + 1}: ${a} still playing` }] };
  }), { h: 120 });
  return `<div class="two">
    ${panel('Session length', 'How long one visit lasts.', lenChart)}
    ${panel('Level at drop-off', `Each player's level when their last session ended (guests included).`, legend([GONE, ACTIVE]) + lvlChart)}
  </div>${panel('Where the last session ended', 'The zone each player was in when they last logged off: a pile-up of drop-offs in one place means they got stuck there.', legend([GONE, ACTIVE]) + zoneChart)}`;
}

// ---------- 3. boss attempts until the first clear ----------
function attemptsSection(d) {
  const rows = d.attempts;
  const med = f => { const a = rows.filter(r => r.floor === f && r.cleared).map(r => r.attempts).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : '–'; };
  const amax = Math.max(1, ...rows.map(r => r.attempts));
  const who = r => r.members.map(m => m.bot ? `<span class="who"><i style="background:${clsColor(m.cls)}"></i>${esc(clsName(m.cls))} bot</span>`
    : `<span class="who"><i style="background:${clsColor(m.cls)}"></i>${esc(m.name)}</span>`).join('') + (r.bots && !r.members.some(m => m.bot) ? `<span class="tag">+${r.bots} bot${r.bots > 1 ? 's' : ''}</span>` : '');
  const table = rows.length ? `<table class="tbl"><thead><tr><th>Party</th><th>Boss</th><th>Attempts to first clear</th><th>Status</th></tr></thead><tbody>${rows.map(r =>
    `<tr><td>${who(r)}</td><td><span class="fl ${r.floor === 2 ? 'f2' : ''}">${BOSS[r.floor] || `F${r.floor}`}</span></td>
     <td><span class="ib"><span style="width:${(r.attempts / amax) * 100}%;background:${r.cleared ? C.s3 : C.s2}"></span></span>${r.attempts}</td>
     <td>${r.cleared ? `Cleared ${date(r.first_kill)}` : `Still trying${r.best_hp_left != null ? ` · best: boss at ${r.best_hp_left}%` : ''}`}</td></tr>`).join('')}</tbody></table>`
    : '<div class="sub">No boss fights yet.</div>';
  return `<div class="grid">${tile(med(1), 'median attempts to first Warden clear')}${tile(med(2), 'median attempts to first Sovereign clear')}
    ${tile(rows.filter(r => !r.cleared).length, 'parties still without a clear')}</div>
    ${panel('Per party', 'Every party (the same set of characters) that fought a boss in this window: how many tries its first clear took. Bot-only parties are listed by class.', table)}`;
}

// ---------- 4. class, style and talent picks ----------
function picksSection(d) {
  const by = new Map();
  for (const r of d.played) { const c = by.get(r.cls) || { mins: 0, players: 0, styles: new Map() }; c.mins += r.mins; c.players += r.players; c.styles.set(r.style, (c.styles.get(r.style) || 0) + r.players); by.set(r.cls, c); }
  const chars = new Map(); for (const r of d.chars) chars.set(r.cls, (chars.get(r.cls) || 0) + r.n);
  const classes = [...by].sort((a, b) => b[1].mins - a[1].mins);
  const classChart = hbars(classes.map(([cls, c]) => ({
    label: `<span class="who"><i style="background:${clsColor(cls)}"></i>${esc(clsName(cls))}</span>`, total: `${Math.round(c.mins / 6) / 10} h`,
    segs: [{ v: c.mins, color: C.s1, tip: `${clsName(cls)}: ${Math.round(c.mins)} min played by ${c.players} player(s); ${chars.get(cls) || 0} saved character(s)` }],
  })), { lw: 140 });
  const SLOTS = [C.s1, C.s2, C.s3, C.s4];
  const styleChart = classes.map(([cls, c]) => {
    const st = [...c.styles].sort((a, b) => b[1] - a[1]), tot = sum(st, s => s[1]);
    return `<div class="row"><span class="lbl" style="width:140px">${esc(clsName(cls))}</span><span class="bar tall"><span class="stack" style="width:100%">${st.map(([s, n], i) =>
      `<div style="flex:${n};background:${SLOTS[i % 4]}" data-tip="${esc(styleName(s))}: ${n} of ${tot} (${pct(n, tot)})"><em>${esc(styleName(s))}</em></div>`).join('')}</span></span><span class="n">${tot}</span></div>`;
  }).join('') || '<div class="sub">No data yet.</div>';
  const tal = new Map();
  for (const r of d.talents) { const a = tal.get(r.cls) || []; a.push(r); tal.set(r.cls, a); }
  const talCards = [...tal].sort((a, b) => (chars.get(b[0]) || 0) - (chars.get(a[0]) || 0)).map(([cls, a]) => {
    const n = chars.get(cls) || 1;
    return `<div class="tcard"><h4><i style="background:${clsColor(cls)}"></i>${esc(clsName(cls))} <small>${n} character${n > 1 ? 's' : ''}</small></h4>${a.sort((x, y) => y.n - x.n).slice(0, 5).map(r =>
      `<div class="trow" data-tip="${esc(nodeDef(r.node)?.name || r.node)}: learned by ${r.n} of ${n}"><span>${esc(nodeDef(r.node)?.name || r.node)}</span><span class="ib"><span style="width:${(r.n / n) * 100}%;background:${C.s1}"></span></span><b>${pct(r.n, n)}</b></div>`).join('')}</div>`;
  }).join('') || '<div class="sub">No talents learned yet.</div>';
  return `<div class="two">${panel('Classes', 'Time played per class (hover for players and saved characters).', classChart)}
    ${panel('Weapon styles', 'Which style players of each class fight with (players per style).', styleChart)}</div>
    ${panel('Talents', 'The most-learned talents per class, as a share of that class’s characters played in this window.', `<div class="tgrid">${talCards}</div>`)}`;
}

// ---------- 5. bots vs players ----------
function botsSection(d) {
  const f = d.fights, hum = sum(f, r => r.humans), bots = sum(f, r => r.bots);
  const pd = sum(d.deaths.filter(r => !r.bot), r => r.n), bd = sum(d.deaths.filter(r => r.bot), r => r.n);
  const adds = sum(d.pbots, r => r.adds), s = d.botSessions;
  const COMP = [['players', 'Players only', C.s1], ['mixed', 'Players + bots', C.s4], ['bots', 'Bots only', C.s2]];
  const compChart = hbars(COMP.map(([k, label, color]) => {
    const rows = f.filter(r => r.comp === k), n = sum(rows, r => r.fights), kills = sum(rows, r => r.kills);
    return { label: esc(label), total: `${n} · ${pct(kills, n)} won`, segs: [{ v: n, color, tip: `${label}: ${n} fights, ${kills} kills (${pct(kills, n)})` }] };
  }), { lw: 140 });
  const addChart = hbars(d.pbots.slice().sort((a, b) => b.adds - a.adds).map(r => ({
    label: `<span class="who"><i style="background:${clsColor(r.cls)}"></i>${esc(clsName(r.cls))}</span>`, segs: [{ v: r.adds, color: C.s3, tip: `${clsName(r.cls)} bots: added ${r.adds} times by ${r.players} player(s)` }],
  })), { lw: 140 });
  return `<div class="grid">${tile(pct(bots, hum + bots), `of boss-fight fighters were bots (${bots} of ${hum + bots})`)}${tile(pct(bd, pd + bd), `of deaths were bots (${bd} of ${pd + bd})`)}
    ${tile(pct(s.with_bots || 0, s.sessions || 0), 'of sessions ended with bots in the party')}${tile(adds, `bots added by players`)}</div>
    <div class="two">${panel('Boss fights by who fought', 'Fights and win rate for parties of players only, players with bots, and bots on their own.', compChart)}
    ${panel('Bots players add', 'Which classes players pick when they add a bot.', addChart)}</div>`;
}

// ---------- page ----------
let who = 'players', data = null;
function render() {
  const d = data;
  const sw = ['players', 'bots', 'all'].map(k => `<button data-who="${k}" class="${who === k ? 'on' : ''}">${{ players: 'Players', bots: 'Bots', all: 'Both' }[k]}</button>`).join('');
  $('adm').innerHTML = `<h1 class="adm">ADMIN · DETAILED</h1><div class="sub">Admins only. Last ${d.days} day${d.days > 1 ? 's' : ''}; updates at most once a minute.</div>
    <h2>Where people die <span class="seg">${sw}</span></h2>${deathsSection(d, who)}
    <h2>Where they quit or get stuck</h2>${quitSection(d)}
    <h2>Boss attempts until the first clear</h2>${attemptsSection(d)}
    <h2>Class, style and talent picks</h2>${picksSection(d)}
    <h2>Bots vs players</h2>${botsSection(d)}`;
  for (const b of $('adm').querySelectorAll('[data-who]')) b.onclick = () => { who = b.dataset.who; render(); };
}

async function load() {
  const el = $('adm');
  if (!token) { el.innerHTML = '<div class="sub note">Admins: sign in to the game in this browser, then reload this page for the detailed charts.</div>'; return; }
  const h = { authorization: `Bearer ${token}` };
  const me = await fetch('/api/admin/me', { headers: h }).then(r => r.json()).catch(() => ({}));
  if (!me.admin) { el.innerHTML = '<div class="sub note">Detailed charts are for admins only.</div>'; return; }
  const r = await fetch(`/api/admin/stats?days=${$('days').value}`, { headers: h });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.enabled) { el.innerHTML = `<div class="sub note">${esc(d.error || 'Tracking is off (no database).')}</div>`; return; }
  data = d; render();
}

// hover tooltips for every [data-tip]
const tipEl = $('tip');
document.addEventListener('mousemove', e => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { tipEl.style.display = 'none'; return; }
  tipEl.textContent = t.dataset.tip; tipEl.style.display = 'block';
  tipEl.style.left = `${Math.min(innerWidth - tipEl.offsetWidth - 8, e.clientX + 12)}px`; tipEl.style.top = `${e.clientY + 14}px`;
});
$('days').addEventListener('change', load);
load();
