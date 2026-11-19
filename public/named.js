// The Friends tab of the Players panel: the Named (shared/named.js, server/named.js) with your standing with each of
// them: portrait colour, tier, a bar toward the next tier, what's left of today's limit, where they are and what
// they're doing, and Talk / Invite / Call buttons. Tier-ups get a banner; the one loss (leaving them downed) a log line.
// Talk (I3, server/ai/namedtalk.js): fills the chat box with "@Name " (touch: asks for the line); replies from afar come
// back as { op: 'talk', id, name, text, you } and go in the chat log.
// A tab for public/playerbots.js (addTab): { id, label, root, show(), onMessage(msg) }. { type: 'named' } messages.
import { CLASSES } from '/shared/data.js';
import { TIERS, GROUPS, NAMED_BY_ID } from '/shared/named.js';
import { lookSwatch } from '/looks.js'; // each character's badge (I2)
import { requestCard, initQuests } from '/namedquests.js'; // their requests and invitations (I4)

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = v => `#${(v >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
const TIER_COLOR = ['#94a3b8', '#7dd3fc', '#4ade80', '#fbbf24', '#f472b6'];
const WHY = { fight: 'fought beside them', revive: 'revived them', heal: 'healed them', cover: 'Covered them', boss: 'helped fell their boss', bossTry: 'stood with them against a boss', request: 'kept your word', chat: 'had a good talk with them', admin: 'set by an admin' };

// Start a line to a Named: "@Name " in the chat box (focused), or a prompt where there's no chat box (touch).
export function talkTo(name, send) {
  const ci = document.getElementById('chat-input');
  document.getElementById('players')?.classList.add('hidden');
  if (ci && ci.offsetParent !== null) { document.exitPointerLock?.(); ci.value = `@${name} `; ci.focus(); return; }
  const t = prompt(`Say to ${name}:`);
  if (t && t.trim()) send({ type: 'chat', text: `@${name} ${t.trim()}` });
}

export function initNamed({ $, send, state, log, sfx, banner }) {
  const ui = { data: null, at: 0, sig: '', note: null, last: null };
  const quests = initQuests({ send, log, sfx }); // requests and invitations (public/namedquests.js)
  const root = document.createElement('div');
  root.className = 'nf';
  const visible = () => root.isConnected && !$('players').classList.contains('hidden');

  function poll(force) {
    if (!api.on || !state.joined || state.spectator) return; // (api.on: the server runs the Named; set on welcome)
    if (!force && Date.now() - ui.at < 1900) return;
    ui.at = Date.now();
    send({ type: 'named', op: 'list' });
  }
  setInterval(() => { if (visible()) poll(); }, 2000);

  root.addEventListener('click', e => {
    const b = e.target.closest('button[data-op]');
    if (!b || b.disabled) return;
    if (b.dataset.op === 'talk') { sfx?.play('ui'); return talkTo(NAMED_BY_ID[b.dataset.id]?.name || b.dataset.id, send); }
    send({ type: 'named', op: b.dataset.op, id: b.dataset.id, ...(b.dataset.act ? { act: b.dataset.act } : {}) });
    sfx?.play('ui');
    b.disabled = true;
  });

  function row(r) {
    const c = hex(r.color), tc = TIER_COLOR[r.tier] || TIER_COLOR[0];
    const pct = Math.round(r.prog * 100), hp = r.maxHp ? Math.round((r.hp / r.maxHp) * 100) : 0;
    const toNext = r.next ? `${r.pts.toFixed(r.pts % 1 ? 1 : 0)} / ${r.next.at} to ${esc(r.next.name)}` : 'As close as it gets';
    const today = r.next ? (r.left > 0 ? ` · +${r.left.toFixed(r.left % 1 ? 1 : 0)} more today` : ' · enough for today') : '';
    const where = r.online ? `${esc(r.doing)}${r.area ? ` · ${esc(r.area)}` : ''}` : esc(r.doing);
    const btn = (op, label, o, at) => (r.mine && op === 'invite' ? '' : `<button data-op="${op}" data-id="${r.id}" ${o.ok ? '' : 'disabled'} title="${esc(o.ok ? '' : o.why)}">${label}${o.ok || r.tier >= TIERS.findIndex(t => t.name === at) ? '' : ` <small>${esc(at)}</small>`}</button>`);
    return `<div class="nf-row ${r.online ? '' : 'off'}" style="--c:${c};--t:${tc}">
      <div class="nf-top">${lookSwatch(NAMED_BY_ID[r.id]?.look?.id, 18) || `<span class="nf-sw" data-named="${r.id}"></span>`}<b>${esc(r.name)}</b><small>Lv ${r.lvl} ${esc(CLASSES[r.cls]?.name || r.cls)} · ${esc(r.role)}</small><span class="nf-tier">${esc(r.tierName)}</span></div>
      <div class="nf-blurb">${esc(r.blurb)}</div>
      <div class="nf-bar"><div style="width:${pct}%"></div></div>
      <div class="nf-pts">${toNext}${today}</div>
      <div class="nf-where">${r.online ? `<span class="nf-hp" title="Health ${hp}%"><i style="width:${hp}%"></i></span>` : ''}${where}</div>
      <div class="nf-ctl"><button data-op="talk" data-id="${r.id}" ${r.online ? '' : 'disabled'} title="${r.online ? `Say something to ${esc(r.name)}` : `${esc(r.name)} isn't around`}">Talk</button>${btn('invite', 'Invite', r.invite, r.inviteAt)}${r.mine ? '<span class="tag">Party</span>' : btn('call', 'Call', r.call, r.callAt)}</div>
      ${requestCard(r)}
    </div>`;
  }

  function draw() {
    const d = ui.data;
    if (!d) { root.innerHTML = '<div class="nf-empty">Asking around…</div>'; ui.sig = ''; return; }
    const n = ui.note && Date.now() - ui.note.at < 7000 ? ui.note : null;
    const sig = JSON.stringify([d.rows, d.away, n?.text]);
    if (sig === ui.sig) return;
    ui.sig = sig;
    const groups = Object.keys(GROUPS).map(g => {
      const rows = d.rows.filter(r => r.group === g);
      if (!rows.length) return '';
      const head = GROUPS[g].party ? `<b>${esc(GROUPS[g].name)}</b><small>${esc(GROUPS[g].motto || '')}</small>` : '<b>The loner</b><small>Trust comes slowly here.</small>';
      return `<div class="nf-group">${head}</div>${rows.map(row).join('')}`;
    }).join('');
    const reset = d.reset ? new Date(d.reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    root.innerHTML = `${n ? `<div class="nf-note ${n.err ? 'err' : ''}">${esc(n.text)}</div>` : ''}
      ${(d.away || []).map(a => `<div class="nf-away">${esc(a)}</div>`).join('')}${groups}
      <div class="nf-foot">Friendship grows when you fight beside them on the same enemy, revive, heal or Cover them, and truly help in their boss fights. It only drops if you leave them downed. Talk to them by name nearby, or with Talk / <i>@name</i> from anywhere: a good talk helps a little, never past a tier. Each has a daily limit${reset ? ` (resets at ${reset})` : ''}. ${esc(d.rows[0]?.inviteAt || 'Ally')}s can invite a Hero, Sworn friends can call one from anywhere: <i>/b name: come</i>. They ask favours too: take one here, finish it for gold and friendship; hand materials over in person (or by talking to them).</div>`;
  }

  function onFriendship(m) {
    if (ui.data) { const r = ui.data.rows.find(x => x.id === m.id); if (r) { r.pts = m.pts; r.tierName = m.tierName; } }
    if (m.up) {
      const line = `${m.name} now counts you as ${/^[AEIOU]/.test(m.tierName) ? 'an' : 'a'} ${m.tierName}.`;
      banner(`${String(m.tierName).toUpperCase()} · ${String(m.name).toUpperCase()}`, line);
      sfx?.play('levelup');
      log(line, 'sys');
    } else if (m.d < 0) log(`${m.name} thinks a little less of you (${m.d}).`, 'sys');
    else if (m.d > 0 && WHY[m.why] && Date.now() - (ui.last?.[m.id] || 0) > 60000) { // a quiet line now and then, not on every hit
      (ui.last ||= {})[m.id] = Date.now();
      log(`${m.name} noticed: you ${WHY[m.why]}.`, 'sys');
    }
    if (visible()) poll(true);
  }

  const api = {
    on: false,
    id: 'friends',
    label: () => 'Friends',
    root,
    show() { poll(); draw(); },
    onMessage(msg) {
      if (msg.type !== 'named') return false;
      if (msg.op === 'fr') { onFriendship(msg); return true; }
      if (msg.op === 'talk') { log(`You → ${msg.name}: ${msg.you}`, 'me'); log(`${msg.name} (from afar): ${msg.text}`, 'pm'); return true; }
      if (quests.onMessage(msg)) { if (visible()) poll(true); return true; }
      if (msg.list) ui.data = msg.list;
      const text = msg.error || msg.msg;
      if (text && msg.op !== 'list') { ui.note = { text, err: !!msg.error, at: Date.now() }; if (msg.error) log(text, 'sys'); }
      if (visible()) draw();
      return true;
    },
  };
  return api;
}
