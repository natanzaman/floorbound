// Players panel tabs (Players | Bots) and the Bots tab: every bot in the world (your own first) and a form to add
// your own bots (server/playerbots.js, { type: 'pbot' } messages). main.js calls render() from renderPlayers() when
// the Bots tab is open and puts tabsHtml() / bindTabs() on the Players tab, plus listHtml() / bindList(): the Players
// tab's Bots section (every bot and the Named, where they are, Invite / Kick / Despawn / Respawn; polled while the
// panel is open; refresh() redraws it). Other modules add their own tab with addTab({ id, label(), root, show() })
// (the Friends tab: public/named.js).
import { CLASSES } from '/shared/data.js';
import { RARITY } from '/shared/items.js';
import { BRANCHES } from '/shared/mastery.js';
import { MODES, MODE_IDS, SKILL_LEVELS, SKILL_DEFAULT, setups, loadoutFor } from '/shared/playerbots.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = cls => `#${(CLASSES[cls]?.color ?? 0x94a3b8).toString(16).padStart(6, '0')}`;
const clsName = cls => CLASSES[cls]?.name || cls;

export function initPlayerBots({ $, send, state, players, log, sfx, rerender, refresh = () => {} }) {
  const ui = {
    tab: 'players', data: null, sig: '', at: 0,
    form: { cls: setups()[0]?.cls, skill: SKILL_DEFAULT, name: '', party: true },
    note: null, // { text, err, at }
    confirm: 0, // bid waiting for a second Dismiss click
  };
  const extra = []; // tabs added by other modules

  // ---------- persistent DOM (so the form keeps its state between refreshes) ----------
  const root = document.createElement('div');
  root.className = 'pb';
  root.innerHTML = `
    <div class="pb-head"><b class="pb-count">Your bots</b><small class="pb-cap"></small></div>
    <div class="pb-note hidden"></div>
    <div class="pb-mine"></div>
    <details class="pb-add" open>
      <summary><b>Add a bot</b></summary>
      <div class="pb-setups"></div>
      <div class="pb-lbl">Skill level</div>
      <div class="pb-skill"></div>
      <div class="pb-skilldesc"></div>
      <input class="pb-name" maxlength="16" placeholder="Name (optional)" autocomplete="off" spellcheck="false" />
      <label class="pb-party"><input type="checkbox" class="pb-partybox" checked /> Join my party <small>(untick: it roams and lives its own day)</small></label>
      <div class="pb-preview"></div>
      <button class="pb-go">Add bot</button>
      <div class="pb-why"></div>
    </details>
    <div class="pb-others"></div>`;
  const q = s => root.querySelector(s);
  const set = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } }; // only touch the DOM on a change
  // keys typed into the form (or arrow keys on a select) must not move the character / toggle panels
  root.addEventListener('keydown', e => {
    if (!/^(INPUT|SELECT)$/.test(e.target.tagName)) return;
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.classList.contains('pb-name')) add();
    if (e.key === 'Escape') e.target.blur();
  });
  q('.pb-name').oninput = e => { ui.form.name = e.target.value; };
  q('.pb-partybox').onchange = e => { ui.form.party = e.target.checked; drawForm(); };
  q('.pb-go').onclick = () => add();
  q('.pb-setups').onclick = e => { const b = e.target.closest('[data-cls]'); if (b) { ui.form.cls = b.dataset.cls; drawForm(); } };
  q('.pb-skill').onclick = e => { const b = e.target.closest('[data-sk]'); if (b) { ui.form.skill = +b.dataset.sk; drawForm(); } };
  for (const sel of ['.pb-mine', '.pb-others']) {
    q(sel).addEventListener('change', e => { const t = e.target, bid = +t.closest('[data-bid]')?.dataset.bid; if (bid && t.dataset.k) edit(bid, { [t.dataset.k]: t.dataset.k === 'skill' ? +t.value : t.value }); });
    q(sel).addEventListener('click', e => {
      const t = e.target.closest('button[data-k]'), bid = +t?.closest('[data-bid]')?.dataset.bid;
      if (!t || !bid) return;
      if (t.dataset.k === 'rename') {
        const b = ui.data?.bots.find(x => x.bid === bid);
        const n = prompt('New name for the bot (2-16 letters, numbers, spaces, _ . -)', b?.name || '');
        if (n && n.trim()) edit(bid, { name: n.trim() });
      }
      if (t.dataset.k === 'dismiss') {
        if (ui.confirm !== bid) { ui.confirm = bid; setTimeout(() => { if (ui.confirm === bid) { ui.confirm = 0; ui.sig = ''; draw(); } }, 3000); ui.sig = ''; return draw(); }
        ui.confirm = 0; send({ type: 'pbot', op: 'dismiss', bid }); sfx?.play('ui');
      }
    });
  }

  function add() {
    if (!ui.form.cls) return;
    send({ type: 'pbot', op: 'add', cls: ui.form.cls, skill: ui.form.skill, party: ui.form.party, ...(ui.form.name.trim() ? { name: ui.form.name.trim() } : {}) });
    sfx?.play('ui');
  }
  function edit(bid, o) { send({ type: 'pbot', op: 'edit', bid, ...o }); sfx?.play('ui'); }
  function poll(force) {
    if (!state.joined || state.spectator) return;
    if (!force && Date.now() - ui.at < 1400) return;
    ui.at = Date.now();
    send({ type: 'pbot', op: 'list' });
  }
  setInterval(() => { if (visible()) poll(); }, 1500);
  setInterval(() => { if (listVisible()) pollRows(); }, 3000); // the Players tab's Bots section: the slim rows op
  function pollRows(force) {
    if (!state.joined || state.spectator) return;
    if (!force && Date.now() - (ui.rowsAt || 0) < 2800) return;
    ui.rowsAt = Date.now();
    send({ type: 'pbot', op: 'rows' });
  }
  const visible = () => ui.tab === 'bots' && !$('players').classList.contains('hidden');
  const listVisible = () => ui.tab === 'players' && !$('players').classList.contains('hidden'); // the Players tab's Bots section

  // ---------- drawing ----------
  function myPartySize() { let n = 0; if (!state.party) return 1; for (const e of players.values()) if (e.party === state.party) n++; return Math.max(1, n); }

  function drawForm() {
    const d = ui.data;
    set(q('.pb-setups'), setups().map(s => `<button data-cls="${s.cls}" class="${s.cls === ui.form.cls ? 'on' : ''}" style="--c:${hex(s.cls)}"><b>${esc(s.role)}</b><small>${esc(clsName(s.cls))}</small></button>`).join(''));
    set(q('.pb-skill'), SKILL_LEVELS.map(s => `<button data-sk="${s.v}" class="${s.v === ui.form.skill ? 'on' : ''}" title="${esc(s.name)}"><b>${s.v}</b><small>${esc(s.name)}</small></button>`).join(''));
    q('.pb-skilldesc').textContent = skillBlurb(ui.form.skill);
    const L = loadoutFor(state.lvl);
    set(q('.pb-preview'), `Joins at <b>Lv ${L.lvl}</b> (yours) · <span style="color:${RARITY[L.rarity].color}">${L.rarityName} gear</span> · Mastery ${L.mastery}${L.evolved ? ' (evolved)' : ''}`);
    let why = '';
    if (d && d.total >= d.cap) why = `The server's bot limit is reached (${d.cap}).`;
    else if (d && ui.form.party && myPartySize() + pendingMine() >= d.partyMax) why = `Your party is full (${d.partyMax}/${d.partyMax}). Untick "Join my party" to add it anyway.`;
    q('.pb-go').disabled = !!why || state.dead;
    q('.pb-go').textContent = `Add ${clsName(ui.form.cls)} bot`;
    q('.pb-why').textContent = why;
  }
  function pendingMine() { return (ui.data?.bots || []).filter(b => b.mine && b.partied && !b.myParty).length; }
  const SKILL_BLURB = { 1: 'Slow reactions, stands in fire, mashes the basic attack.', 2: 'Late dodges and potions, rarely Breaks or Switches.', 3: 'Decent, but misses some dodges and Switch windows.', 4: 'Quick reactions and good rotations. Recommended.', 5: 'Instant reactions, perfect dodges, optimal rotations.' };
  const skillBlurb = v => SKILL_BLURB[v] || '';

  function botRow(b, full) {
    const c = hex(b.cls), pc = b.maxHp ? Math.round((b.hp / b.maxHp) * 100) : 0;
    const tags = `${b.myParty ? '<span class="tag">Party</span>' : ''}${b.dead ? '<span class="tag dead">Down</span>' : ''}${b.floor === 2 ? '<span class="tag f2">F2</span>' : ''}`;
    const who = b.mine ? '' : b.owner ? `<span class="pb-own">${esc(b.owner)}'s</span>` : '<span class="pb-own adm">server bot</span>';
    const party = !b.myParty && b.party?.length ? ` · party: ${esc(b.party.slice(0, 3).join(', '))}${b.party.length > 3 ? '…' : ''}` : '';
    let html = `<div class="pb-bot ${b.mine ? 'mine' : ''} ${full ? '' : 'compact'}" data-bid="${b.bid}" style="--c:${c}">
      <div class="pb-top"><span class="pb-dot"></span><b class="nm">${esc(b.name)}</b><small>Lv ${b.lvl} ${esc(clsName(b.cls))}</small>${tags}${who}</div>
      <div class="pb-doing">${esc(b.doing)}${b.area && b.area !== 'joining…' ? ` · ${esc(b.area)}` : ''}${party} · <span class="pb-sk">${esc(b.skillName)}</span></div>`;
    if (full) html += `<div class="pb-hp"><div style="width:${pc}%"></div></div>`;
    if (full && b.kit) {
      const gear = b.kit.gear.map(g => `<span style="color:${RARITY[g.r]?.color || '#ddd'}" title="${esc(g.name)}">${esc(g.name)}</span>`).join(' · ');
      const evo = b.kit.mastery.filter(m => m.br && !BRANCHES[m.sk]?.A?.sig).map(m => BRANCHES[m.sk]?.[m.br]?.name).filter(Boolean);
      const km = b.kit.mastery.filter(m => !BRANCHES[m.sk]?.A?.sig), ml = km.length ? Math.min(...km.map(m => m.lvl)) : 1; // (class skills: a signature skill only counts once specialised)
      html += `<div class="pb-kit">${gear}<br><span>Mastery ${ml}${evo.length ? ` · ${esc(evo.join(', '))}` : ''}</span></div>`;
    }
    if (b.can) {
      const modeSel = b.mode || (b.behaviour === 'follow' ? 'follow' : MODES[b.behaviour] ? b.behaviour : '');
      html += `<div class="pb-ctl">
        <select data-k="skill" title="Skill level">${SKILL_LEVELS.map(s => `<option value="${s.v}" ${s.v === b.skill ? 'selected' : ''}>${s.v} ${esc(s.name)}</option>`).join('')}</select>
        <select data-k="mode" title="Behaviour">${modeSel ? '' : '<option selected disabled>…</option>'}${MODE_IDS.map(m => `<option value="${m}" ${m === modeSel ? 'selected' : ''}>${esc(b.mine || b.owner ? MODES[m].name.replace(' me', b.mine ? ' me' : ` ${b.owner}`) : MODES[m].name)}</option>`).join('')}</select>
        <button data-k="rename" title="Rename">Rename</button>
        <button data-k="dismiss" class="danger">${ui.confirm === b.bid ? 'Sure?' : 'Dismiss'}</button>
      </div>`;
    }
    return html + '</div>';
  }

  function draw() {
    const d = ui.data;
    drawForm();
    q('.pb-count').textContent = `Your bots (${d?.mine ?? 0})`;
    q('.pb-cap').textContent = d ? `${d.total}/${d.cap} on the server${d.admin ? ' · admin' : ''}` : '';
    const n = ui.note && Date.now() - ui.note.at < 8000 ? ui.note : null;
    q('.pb-note').className = `pb-note ${n ? (n.err ? 'err' : 'okay') : 'hidden'}`;
    q('.pb-note').textContent = n?.text || '';
    if (!d) { set(q('.pb-mine'), '<div class="pb-empty">Loading…</div>'); return; }
    // don't rebuild the lists while a dropdown in them is open
    const busy = root.contains(document.activeElement) && document.activeElement.tagName === 'SELECT';
    const sig = JSON.stringify([d.bots, ui.confirm]);
    if (busy || sig === ui.sig) return;
    ui.sig = sig;
    const mine = d.bots.filter(b => b.mine), others = d.bots.filter(b => !b.mine);
    set(q('.pb-mine'), mine.length ? mine.map(b => botRow(b, true)).join('') : '<div class="pb-empty">No bots yet. Add one below: it joins your party at your level and follows you (or roams on its own).</div>');
    set(q('.pb-others'), others.length ? `<div class="pb-sub"><b>Other bots (${others.length})</b></div>${others.map(b => botRow(b, false)).join('')}` : '');
  }

  // ---------- the Players tab's Bots section ----------
  // Every bot (player-made and server bots) and the Named: where they are, and buttons for what you may do (a disabled
  // button says why in its tooltip). Invite / Kick: { type: 'pbot', op, bid | named }; Despawn / Respawn: the Named.
  const btn = (op, label, c, key, cls = '') => `<button data-pl="${op}" ${key} class="${cls}" ${c?.ok ? '' : 'disabled'} title="${esc(c?.ok ? '' : c?.why || '')}">${label}</button>`;
  // Duel: a bot or one of the Named that's in the world and up (main.js binds [data-duel]: public/duels.js challenge)
  const duelBtn = r => (r.pid && !r.dead && r.pid !== state.myId ? `<button data-duel="${r.pid}" title="Challenge to a duel (it accepts)">Duel</button>` : '');
  function listRow(b) {
    const tag = b.mine ? '<span class="pb-own">yours</span>' : b.creator ? `<span class="pb-own">${esc(b.creator)}'s</span>` : b.resident ? '<span class="pb-own adm" title="Lives here: one of the server\'s own bots, living its own day. Anyone may invite it.">resident</span>' : '<span class="pb-own adm">server bot</span>';
    const where = b.where?.k === 'party' && b.myParty ? 'In your party' : b.where?.text || '';
    const key = `data-bid="${b.bid}"`, ok = { ok: true };
    const right = (b.myParty ? btn('kick', 'Kick', b.ctl.kick, key, 'danger') : btn('invite', 'Invite to party', b.ctl.invite, key)) + duelBtn(b);
    // who may order / invite / kick it (its creator, or access 3+): Just me, Anyone, + name, - name (saved characters)
    const allow = b.canAllow ? `<small class="pl-where">Who may order it: ${esc(b.allow)}</small><span class="pl-btns pl-allow">${b.allow === 'just the creator' ? btn('allow', 'Anyone', ok, `${key} data-set="open"`) : btn('allow', 'Just me', ok, `${key} data-set="me"`)}${btn('allow', '+ Name', ok, `${key} data-set="add"`)}${b.allowList?.length ? btn('allow', '− Name', ok, `${key} data-set="remove"`) : ''}</span>` : '';
    return `<div class="p pl-bot" style="--c:${hex(b.cls)}"><span><span class="pb-dot"></span> ${esc(b.name)} <small style="opacity:.6">Lv ${b.lvl} ${esc(clsName(b.cls))}</small><span class="tag">BOT</span>${tag}<br><small class="pl-where">${esc(where)}${b.dead ? ' · down' : ''}</small></span><span class="pl-btns">${right}</span>${allow}</div>`;
  }
  function namedRow(n) {
    const key = `data-named="${n.id}"`, c = `#${(n.color >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
    const btns = n.state === 'despawned' ? btn('respawn', 'Respawn', n.ctl.respawn, key)
      : `${n.myParty ? btn('kick', 'Kick', n.ctl.kick, key, 'danger') : btn('invite', 'Invite to party', n.ctl.invite, key)}${duelBtn(n)}${btn('despawn', 'Despawn', n.ctl.despawn, key, 'danger')}`;
    return `<div class="p pl-bot ${n.state === 'online' ? '' : 'off'}" style="--c:${c}"><span><span class="pb-dot"></span> ${esc(n.name)} <small style="opacity:.6">Lv ${n.lvl} ${esc(clsName(n.cls))}</small><span class="tag nmtag">${esc(n.group === 'loner' ? 'LONE SOLDIER' : n.gname.toUpperCase())}</span><br><small class="pl-where">${esc(n.where)}${n.dead ? ' · down' : ''}</small></span><span class="pl-btns">${btns}</span></div>`;
  }
  function listHtml() {
    pollRows(); // (at most every 2.8 s)
    const d = ui.rows;
    if (!d) return `<details class="sect" open data-sect="bots"><summary><b>Bots</b></summary><div class="pb-empty">Loading…</div></details>`;
    const rows = [...(d.named || []).map(namedRow), ...d.bots.map(listRow)];
    return `<details class="sect" ${ui.listOpen !== false ? 'open' : ''} data-sect="bots"><summary><b>Bots (${rows.length})</b> <small style="opacity:.6">invite to your party</small></summary>${rows.join('') || '<div class="pb-empty">No bots in the world. Add one on the Bots tab.</div>'}</details>`;
  }
  function bindList(panel) {
    const sect = panel.querySelector('details[data-sect="bots"]');
    if (!sect) return;
    sect.ontoggle = () => { ui.listOpen = sect.open; };
    for (const b of sect.querySelectorAll('button[data-pl]')) b.onclick = () => {
      if (b.disabled) return;
      const op = b.dataset.pl;
      if (op === 'despawn' && ui.confirmNm !== b.dataset.named) { ui.confirmNm = b.dataset.named; b.textContent = 'Sure?'; setTimeout(() => { ui.confirmNm = null; }, 3000); return; }
      ui.confirmNm = null;
      let extra = {};
      if (op === 'allow') {
        const set = b.dataset.set;
        if (set === 'add' || set === 'remove') {
          const nm = prompt(set === 'add' ? 'Let which character order this bot? (a saved character\'s name)' : 'Take whom off the list?', '');
          if (!nm || !nm.trim()) return;
          extra = { [set]: nm.trim() };
        } else extra = { set };
      }
      send({ type: 'pbot', op, view: 'rows', ...extra, ...(b.dataset.named ? { named: b.dataset.named } : { bid: +b.dataset.bid }) });
      sfx?.play('ui');
      b.disabled = true; b.textContent = op === 'invite' ? 'Sent' : '…';
    };
  }

  // ---------- public ----------
  return {
    get tab() { return ui.tab; },
    listHtml, bindList,
    tabsHtml(nPlayers, nBots) {
      return `<div class="pb-tabs"><button data-tab="players" class="${ui.tab === 'players' ? 'on' : ''}">Players${nPlayers !== undefined ? ` (${nPlayers})` : ''}</button><button data-tab="bots" class="${ui.tab === 'bots' ? 'on' : ''}">Bots${nBots ? ` (${nBots})` : ''}</button>${extra.map(t => `<button data-tab="${t.id}" class="${ui.tab === t.id ? 'on' : ''}">${esc(t.label())}</button>`).join('')}</div>`;
    },
    bindTabs(panel) {
      if (ui.tab === 'players') panel.classList.remove('wide');
      for (const b of panel.querySelectorAll('.pb-tabs [data-tab]')) b.onclick = () => {
        if (ui.tab === b.dataset.tab) return;
        ui.tab = b.dataset.tab; ui.sig = ''; sfx?.play('ui');
        if (ui.tab === 'bots') poll(true);
        rerender();
      };
    },
    addTab(t) { if (!extra.includes(t)) extra.push(t); },
    select(id) { if (id === 'players' || id === 'bots' || extra.some(t => t.id === id)) { ui.tab = id; ui.sig = ''; } }, // open on a tab (the Guild Registrar)
    setTab(t, on) { // add or take away an added tab (the Friends tab follows the server's switch)
      if (on) return this.addTab(t);
      const i = extra.indexOf(t);
      if (i < 0) return;
      extra.splice(i, 1);
      if (ui.tab === t.id) ui.tab = 'players';
      t.root.remove();
    },
    // The Bots tab, or an added tab (each keeps its DOM between calls).
    render(panel, nPlayers, nBots) {
      panel.classList.add('wide');
      const other = extra.find(t => t.id === ui.tab), body = other ? other.root : root;
      const tabs = panel.querySelector(':scope > .pb-tabs');
      if (!tabs || panel.lastElementChild !== body) {
        panel.innerHTML = ui.tabsH = this.tabsHtml(nPlayers, nBots);
        panel.appendChild(body);
        ui.sig = '';
      } else { const h = this.tabsHtml(nPlayers, nBots); if (ui.tabsH !== h) { ui.tabsH = h; tabs.outerHTML = h; } }
      this.bindTabs(panel);
      if (other) return other.show();
      poll();
      draw();
    },
    onMessage(msg) {
      if (msg.type !== 'pbot') return false;
      if (msg.list) ui.data = msg.list;
      if (msg.rows) ui.rows = msg.rows;
      if (msg.op !== 'list') {
        const text = msg.ok ? msg.msg : msg.error;
        if (text) { ui.note = { text, err: !msg.ok, at: Date.now() }; log(text, 'sys'); }
        if (msg.ok && msg.op === 'add') { ui.form.name = ''; q('.pb-name').value = ''; }
        ui.sig = '';
      }
      if (visible()) draw();
      else if (listVisible()) (msg.op === 'list' || msg.op === 'rows' ? refresh : rerender)(); // (a reply: rebuild, so a "Sent" button comes back)
      return true;
    },
  };
}
