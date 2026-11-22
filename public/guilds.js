// Guilds, the client side (docs/briefs/guilds.md; server/guilds.js, shared/guilds.js): the Guild tab of the Players
// window (found a guild, answer an invite, members and ranks, invite players / bots / the Named, the bank and vault,
// this week's quests, perks, leave / disband), the invite card (a ginvite event), guild chat lines ({ type: 'gchat' }),
// and the Guild Registrar's label in the Town of Beginnings (interact opens the tab).
// A tab for public/playerbots.js (addTab): { id, label, root, show() }. { type: 'guild' } messages.
import { CLASSES } from '/shared/data.js';
import { RARITY } from '/shared/items.js';
import { GUILD, RANK, RANKS, can, REGISTRAR, nearRegistrar } from '/shared/guilds.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clsName = cls => CLASSES[cls]?.name || cls || '';

export function initGuilds({ $, send, state, log, sfx, project, keyHtml, tapping, openTab, tip = () => {} }) {
  const ui = { view: null, at: 0, note: null, sig: '', confirm: '' };
  const root = document.createElement('div');
  root.className = 'gd';
  const visible = () => root.isConnected && !$('players').classList.contains('hidden');
  const ask = (op, o = {}) => { send({ type: 'guild', op, ...o }); sfx?.play('ui'); };
  function poll(force) {
    if (!state.joined || state.spectator) return;
    if (!force && Date.now() - ui.at < 1900) return;
    ui.at = Date.now();
    send({ type: 'guild', op: 'view' });
  }
  setInterval(() => { if (visible()) poll(); }, 2000);

  // typing in the tab's fields must not move the character or toggle panels
  root.addEventListener('keydown', e => {
    if (!/^(INPUT|SELECT)$/.test(e.target.tagName)) return;
    e.stopPropagation();
    if (e.key === 'Escape') e.target.blur();
    if (e.key === 'Enter') root.querySelector(`button[data-go="${e.target.dataset.f}"]`)?.click();
  });
  // a redraw between a button's mousedown and mouseup would swallow the click: hold redraws while a button is pressed
  root.addEventListener('pointerdown', () => { ui.down = true; });
  addEventListener('pointerup', () => { if (ui.down) { ui.down = false; setTimeout(draw, 0); } }, true);
  const val = f => root.querySelector(`[data-f="${f}"]`)?.value.trim() || '';
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'create') return ask('create', { name: val('gname'), tag: val('gtag') });
    if (a === 'accept' || a === 'decline') return ask(a, { gid: +b.dataset.gid });
    if (a === 'invite') { const n = val('iname'); if (n) ask('invite', { name: n }); return; }
    if (a === 'invpick') {
      const v = val('ipick'); if (!v) return;
      return ask('invite', v.startsWith('n:') ? { named: v.slice(2) } : { pid: +v.slice(2) });
    }
    if (a === 'deposit' || a === 'withdraw') { const g = Math.floor(Number(val('gold'))); if (g > 0) ask(a, { gold: g }); return; }
    if (a === 'store') return ask('store', { u: +b.dataset.u });
    if (a === 'take') return ask('take', { v: +b.dataset.v });
    if (['kick', 'promote', 'demote', 'transfer', 'leave', 'disband'].includes(a)) {
      const k = `${a}:${b.dataset.key || ''}`;
      if (['kick', 'transfer', 'leave', 'disband'].includes(a) && ui.confirm !== k) { // a second click to be sure
        ui.confirm = k; b.textContent = 'Sure?'; setTimeout(() => { if (ui.confirm === k) { ui.confirm = ''; ui.sig = ''; draw(); } }, 3000); return;
      }
      ui.confirm = '';
      return ask(a, b.dataset.key ? { key: b.dataset.key } : {});
    }
  });

  // ---------- drawing ----------
  const itemRow = (it, btn) => `<div class="gd-it"><b style="color:${RARITY[it.r]?.color || '#ddd'}">${esc(it.name)}</b><small>${esc(it.slot)}${it.cls ? ` · ${esc(clsName(it.cls))}` : ''}</small>${btn}</div>`;
  function noGuild(v) {
    const inv = v.invite ? `<div class="gd-card"><b>[${esc(v.invite.tag)}] ${esc(v.invite.name)}</b> invited you${v.invite.from ? ` (from ${esc(v.invite.from)})` : ''}.<div class="gd-btns"><button data-a="accept" data-gid="${v.invite.gid}">Accept</button><button data-a="decline" data-gid="${v.invite.gid}">Decline</button></div></div>` : '';
    if (v.needsChar) return `${inv}<div class="gd-empty">Guilds keep their members by saved character: sign in and play a saved character to found or join one.</div>`;
    return `${inv}<div class="gd-sect"><b>Found a guild</b><small>${GUILD.fee} gold · you lead it</small></div>
      <input data-f="gname" maxlength="20" placeholder="Guild name (3-20)" autocomplete="off" spellcheck="false" />
      <input data-f="gtag" maxlength="4" placeholder="Tag (2-4 letters)" autocomplete="off" spellcheck="false" style="width:9em" />
      <button data-a="create" data-go="gtag" ${state.gold < GUILD.fee ? 'disabled title="Not enough gold"' : ''}>Found guild (${GUILD.fee} gold)</button>
      <div class="gd-foot">A guild is a home for friends, bots and the Named: guild chat (<i>/g text</i>), a shared bank and vault, weekly guild quests and perks as it levels. You can also visit the Guild Registrar in the Town of Beginnings.</div>`;
  }
  function inGuild(v) {
    const G = v.guild, my = G.rank;
    const pct = G.next ? Math.round(((G.xp) / G.next) * 100) : 100;
    const mbtn = m => {
      if (m.me) return '';
      const out = [];
      if (can(my, 'promote') && m.rank === RANK.member) out.push(`<button data-a="promote" data-key="${esc(m.key)}">Promote</button>`);
      if (can(my, 'demote') && m.rank === RANK.officer) out.push(`<button data-a="demote" data-key="${esc(m.key)}">Demote</button>`);
      if (can(my, 'transfer') && m.kind === 'player') out.push(`<button data-a="transfer" data-key="${esc(m.key)}" title="Make them the leader">${ui.confirm === `transfer:${m.key}` ? 'Sure?' : 'Lead'}</button>`);
      if (can(my, 'kick') && m.rank < my) out.push(`<button class="danger" data-a="kick" data-key="${esc(m.key)}">${ui.confirm === `kick:${m.key}` ? 'Sure?' : 'Remove'}</button>`);
      return out.join('');
    };
    const members = G.members.map(m => `<div class="gd-m ${m.online ? '' : 'off'}"><span><b>${esc(m.name)}</b> <small>${esc(clsName(m.cls))}${m.lvl ? ` · Lv ${m.lvl}` : ''}</small>${m.kind === 'bot' ? '<span class="tag">BOT</span>' : m.kind === 'named' ? '<span class="tag nmtag">NAMED</span>' : ''}<span class="gd-rank r${m.rank}">${esc(RANKS[m.rank]?.name)}</span>${m.online ? '' : '<small class="gd-offl"> · away</small>'}</span><span class="gd-btns">${mbtn(m)}</span></div>`).join('');
    const invite = can(my, 'invite') ? `<div class="gd-sect"><b>Invite</b><small>players answer a card; bots and the Named accept by themselves</small></div>
      <div class="gd-row"><input data-f="iname" maxlength="24" placeholder="Player's name" autocomplete="off" spellcheck="false" /><button data-a="invite" data-go="iname">Invite</button></div>
      ${G.cands.length ? `<div class="gd-row"><select data-f="ipick"><option value="">Pick someone nearby, a bot or one of the Named…</option>${G.cands.map(c => `<option value="${c.named ? `n:${esc(c.named)}` : `p:${c.pid}`}">${esc(c.name)}${c.named ? ' (the Named)' : c.bot ? ' (bot)' : ''}</option>`).join('')}</select><button data-a="invpick">Invite</button></div>` : ''}` : '';
    const bag = (state.inv?.bag || []).filter(it => !it.ks);
    const vault = `<div class="gd-sect"><b>Vault ${G.vault.length}/${G.vaultCap}</b><small>${can(my, 'take') ? 'take items out' : 'officers take items out'}</small></div>
      ${G.vault.length ? G.vault.map(s => itemRow(s.it, can(my, 'take') ? `<button data-a="take" data-v="${s.v}">Take</button>` : '')).join('') : '<div class="gd-empty">Empty.</div>'}
      <details class="gd-bag"><summary>Store from your bag (${bag.length})</summary>${bag.length ? bag.map(it => itemRow(it, `<button data-a="store" data-u="${it.u}" ${G.vault.length >= G.vaultCap ? 'disabled' : ''}>Store</button>`)).join('') : '<div class="gd-empty">Nothing to store.</div>'}</details>`;
    const quests = G.quests.map(q => `<div class="gd-q ${q.done ? 'done' : ''}"><div><b>${esc(q.name)}</b><small>${esc(q.desc)}</small></div><div class="gd-bar"><div style="width:${Math.min(100, Math.round((q.got / q.n) * 100))}%"></div></div><small>${q.done ? 'Done' : `${q.got} / ${q.n}`} · +${q.xp} guild XP, +${q.gold} gold to the bank</small></div>`).join('');
    const resets = new Date(G.resets).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `<div class="gd-head"><b class="gd-tag">[${esc(G.tag)}]</b> <b>${esc(G.name)}</b><span class="gd-rank r${my}">${esc(G.rankName)}</span></div>
      <div class="gd-lvl">Guild level ${G.lvl}${G.next ? ` · ${G.xp} / ${G.next} XP` : ' (max)'}<div class="gd-bar"><div style="width:${pct}%"></div></div></div>
      <div class="gd-sect"><b>Members (${G.members.length}/${GUILD.maxMembers})</b><small>chat: /g text</small></div>${members}
      ${invite}
      <div class="gd-sect"><b>Bank: ${G.gold} gold</b><small>you have ${state.gold ?? 0}</small></div>
      <div class="gd-row"><input data-f="gold" type="number" min="1" step="1" placeholder="Gold" style="width:7em" /><button data-a="deposit" data-go="gold">Deposit</button>${can(my, 'withdraw') ? '<button data-a="withdraw">Withdraw</button>' : ''}</div>
      ${vault}
      <div class="gd-sect"><b>This week's guild quests</b><small>new ones ${esc(resets)}; bots count a quarter</small></div>${quests}
      <details class="gd-perks"><summary>Perks</summary>${G.perks.map(k => `<div class="${k.on ? 'on' : ''}">Lv ${k.lvl}: ${esc(k.text)}${k.on ? ' ✓' : ''}</div>`).join('')}</details>
      <div class="gd-btns gd-end">${my === RANK.leader ? `<button class="danger" data-a="disband">${ui.confirm === 'disband:' ? 'Sure?' : 'Disband guild'}</button>` : `<button class="danger" data-a="leave">${ui.confirm === 'leave:' ? 'Sure?' : 'Leave guild'}</button>`}</div>`;
  }
  function draw() {
    const v = ui.view;
    if (!v) { root.innerHTML = '<div class="gd-empty">Asking the Registrar…</div>'; ui.sig = ''; return; }
    const n = ui.note && Date.now() - ui.note.at < 7000 ? ui.note : null;
    const sig = JSON.stringify([v, n?.text, ui.confirm, (state.inv?.bag || []).map(i => i.u), state.gold]);
    if (sig === ui.sig) return;
    const focus = document.activeElement;
    if ((root.contains(focus) && /^(INPUT|SELECT)$/.test(focus.tagName)) || ui.down) return; // (typing or pressing: redraw after)
    ui.sig = sig;
    const keep = {}; for (const el of root.querySelectorAll('[data-f]')) keep[el.dataset.f] = el.value;
    const bagOpen = root.querySelector('.gd-bag')?.open, perksOpen = root.querySelector('.gd-perks')?.open;
    root.innerHTML = `${n ? `<div class="pb-note ${n.err ? 'err' : 'okay'}">${esc(n.text)}</div>` : ''}${v.guild ? inGuild(v) : noGuild(v)}`;
    for (const el of root.querySelectorAll('[data-f]')) if (keep[el.dataset.f] != null && el.tagName === 'INPUT') el.value = keep[el.dataset.f];
    if (bagOpen) root.querySelector('.gd-bag')?.setAttribute('open', '');
    if (perksOpen) root.querySelector('.gd-perks')?.setAttribute('open', '');
  }

  // ---------- the invite card ----------
  function card(e) {
    const el = document.createElement('div');
    el.className = 'panel gd-invite';
    el.innerHTML = `<div><b>${esc(e.from)}</b> invites you to the guild <b>[${esc(e.tag)}] ${esc(e.name)}</b></div><button data-x="1">Accept</button><button data-x="0">Decline</button>`;
    el.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; ask(b.dataset.x === '1' ? 'accept' : 'decline', { gid: e.gid }); el.remove(); };
    document.body.appendChild(el);
    setTimeout(() => el.remove(), GUILD.inviteFor * 1000);
  }

  // ---------- the Registrar's label ----------
  const lbl = document.createElement('div'); lbl.className = 'lbl npc'; lbl.style.display = 'none';
  $('labels')?.appendChild(lbl);
  const near = () => !state.dead && state.joined && !state.spectator && nearRegistrar(state.x, state.z);
  function frame() {
    if (!state.joined || state.spectator) { lbl.style.display = 'none'; return; }
    const d = Math.hypot(state.x - REGISTRAR.x, state.z - REGISTRAR.z), sp = d < 22 && project(REGISTRAR.x, 3.6, REGISTRAR.z);
    if (!sp) { lbl.style.display = 'none'; return; }
    lbl.style.display = ''; lbl.style.left = `${sp[0]}px`; lbl.style.top = `${sp[1]}px`;
    const html = `Guild Registrar${near() ? `<br><small>${tapping() ? 'tap Guild' : `press ${keyHtml('interact')} for guilds`}</small>` : ''}`;
    if (lbl.innerHTML !== html) lbl.innerHTML = html;
  }

  const api = {
    id: 'guild',
    label: () => 'Guild',
    root,
    show() { poll(); draw(); tip('guild'); },
    near, frame,
    open() { openTab('guild'); poll(true); },
    onEvent(e) { if (e.t === 'ginvite' && e.to === state.myId) { card(e); sfx?.play('ui'); } },
    onMessage(msg) {
      if (msg.type === 'gchat') { log(`[Guild] ${msg.from}: ${msg.text}`, msg.id === state.myId ? 'me guild' : 'guild'); return true; }
      if (msg.type !== 'guild') return false;
      if (msg.view) ui.view = msg.view;
      const text = msg.error || msg.msg;
      if (text && msg.op !== 'view') { ui.note = { text, err: !msg.ok, at: Date.now() }; log(text, 'sys'); }
      if (visible()) draw();
      return true;
    },
  };
  return api;
}
