// The Named's requests and invitations on the client (docs/ROADMAP.md I4; server/namedquests.js). Two parts:
//  requestCard(row)   the request card under a Named in the Friends tab (public/named.js): an offer to take, or the
//                     active request with a progress bar, time left, the reward, and Turn in / Drop
//  initQuests(ctx)    toasts for progress, a finished request (with what it paid) and an expired one; the outreach
//                     message (a Named at Friend+ inviting you to farm or raid) with Accept / Decline
// Buttons in the card use public/named.js's click handler: data-op="req" data-act="take | drop | turnin".
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RARITY_COLOR = ['#d1d5db', '#4ade80', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6'];
function timeLeft(mins) {
  if (!(mins > 0)) return 'ending';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

export function requestCard(r) {
  const q = r.req;
  if (!q) return '';
  if (q.state === 'none') return q.why ? `<div class="nq-none">${esc(q.why)}</div>` : '';
  const btn = (act, label, o = { ok: true }) => `<button data-op="req" data-act="${act}" data-id="${r.id}" ${o.ok ? '' : 'disabled'} title="${esc(o.ok ? '' : o.why)}">${label}</button>`;
  const reward = `${q.gold} gold${q.k === 'boss' ? ', a good chance of gear' : ', maybe gear'}${q.left > 0 ? ', friendship' : ''}`;
  if (q.state === 'offer') {
    return `<div class="nq-card offer"><div class="nq-head"><span class="nq-tag">Asks a favour</span><b>${esc(q.goal)}</b></div>
      <div class="nq-text">“${esc(q.text)}”</div>
      <div class="nq-meta">Reward: ${esc(reward)} · ${Math.round(q.ttl / 3600)}h to do it</div>
      <div class="nq-ctl">${btn('take', 'Take it')}</div></div>`;
  }
  const pct = Math.round((q.prog || 0) * 100);
  const count = q.k === 'boss' ? (q.got ? 'Done' : 'Not yet') : `${q.got} / ${q.n}${q.k === 'bring' ? ' in your bag' : ''}`;
  return `<div class="nq-card active"><div class="nq-head"><span class="nq-tag">Request</span><b>${esc(q.goal)}</b><small>${timeLeft(q.mins)}</small></div>
    <div class="nq-text">“${esc(q.text)}”</div>
    <div class="nq-bar"><div style="width:${pct}%"></div></div>
    <div class="nq-meta">${esc(count)} · Reward: ${esc(reward)}</div>
    <div class="nq-ctl">${q.turnIn ? btn('turnin', 'Turn in', q.turnIn) : ''}${btn('drop', 'Drop')}</div></div>`;
}

export function initQuests({ send, log, sfx }) {
  const toasts = document.createElement('div');
  toasts.id = 'nq-toasts';
  document.body.appendChild(toasts);
  function toast(html, cls = '', ms = 5000) {
    const el = document.createElement('div');
    el.className = `nq-toast ${cls}`;
    el.innerHTML = html;
    toasts.appendChild(el);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
  }

  const out = document.createElement('div');
  out.id = 'nq-out';
  out.className = 'panel hidden';
  document.body.appendChild(out);
  let outT = 0;
  function showOut(m) {
    out.innerHTML = `<div class="nq-out-from"><b>${esc(m.name)}</b> <small>${m.kind === 'raid' ? 'invites you to a raid' : 'invites you to hunt'}</small></div>
      <div class="nq-out-text">“${esc(m.text)}”</div>
      <div class="nq-out-ctl"><button data-yes="1">Accept</button><button data-yes="0">Decline</button></div>`;
    out.classList.remove('hidden');
    for (const b of out.querySelectorAll('button')) b.onclick = () => { send({ type: 'named', op: 'out', id: m.id, yes: b.dataset.yes === '1' }); out.classList.add('hidden'); sfx?.play('ui'); };
    clearTimeout(outT);
    outT = setTimeout(() => out.classList.add('hidden'), (m.ttl || 60) * 1000);
    sfx?.play('ui');
  }

  return {
    // true: handled (the caller still refreshes the Friends tab)
    onMessage(msg) {
      if (msg.op === 'out' && msg.kind) { showOut(msg); return true; }
      if (msg.op !== 'req' || !msg.ev) return false;
      if (msg.ev === 'progress') toast(`<b>${esc(msg.name)}</b> · ${esc(msg.goal)} <span class="nq-n">${msg.got} / ${msg.n}</span>`, 'small', 2500);
      else if (msg.ev === 'done') {
        const it = msg.item ? `, <span style="color:${RARITY_COLOR[msg.item.r] || '#fff'}">${esc(msg.item.name)}</span>` : '';
        toast(`<div class="nq-t-head">REQUEST DONE · ${esc(String(msg.name).toUpperCase())}</div><div>${esc(msg.goal)}</div>
          <div class="nq-t-pay">+${msg.gold} gold${it}${msg.fr > 0 ? `, +${msg.fr} friendship` : ''}</div>${msg.text ? `<div class="nq-t-line">“${esc(msg.text)}”</div>` : ''}`, 'done', 7000);
        sfx?.play('coin');
      } else if (msg.ev === 'expired') {
        toast(`<b>${esc(msg.name)}</b>'s request ran out: ${esc(msg.goal)}.`, 'small', 5000);
        log(`${msg.name}'s request ran out (${msg.goal}).`, 'sys');
      }
      return true;
    },
  };
}
