// Command wheel for the bots in your party (shared/bots/social.js lists the orders; bots obey in shared/bots/brain.js).
// Hold V (or press the Bots button under the party frames): the cursor is freed, point at an order and release V, or
// click it. A quick tap of V keeps the wheel open until you click an order or press Esc / V again.
// The chips under the wheel pick who gets the order: all your bots, or one of them.
import { BOT_COMMANDS } from '/shared/bots/social.js';

export function initBotWheel({ send, state, players, log }) {
  const el = document.createElement('div');
  el.id = 'botwheel'; el.className = 'hidden';
  document.getElementById('hud').appendChild(el);
  let who = '', hover = null, openedAt = 0, key = false;

  const partyBots = () => (state.party ? [...players.values()].filter(p => p.party === state.party && p.id !== state.myId && state.roster.get(p.id)?.bot) : [])
    .map(p => ({ id: p.id, name: state.roster.get(p.id).name, dead: p.dead }));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render() {
    const bots = partyBots();
    if (who && !bots.some(b => b.name === who)) who = '';
    const cmds = Object.entries(BOT_COMMANDS).filter(([, c]) => c.wheel !== false), n = cmds.length, R = 128;
    el.innerHTML = `<div class="ring">${cmds.map(([id, c], i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return `<button class="wcmd" data-c="${id}" style="left:${Math.round(Math.cos(a) * R)}px;top:${Math.round(Math.sin(a) * R)}px" ${bots.length ? '' : 'disabled'}><span class="ic">${c.icon}</span>${esc(c.label)}</button>`;
    }).join('')}<div class="hub"><b>${bots.length ? 'ORDERS' : 'NO BOTS'}</b><small>${bots.length ? esc(who || 'all bots') : 'in your party'}</small></div></div>
    <div class="who">${bots.length ? `<button data-w="" class="${who ? '' : 'on'}">All bots</button>${bots.map(b => `<button data-w="${esc(b.name)}" class="${who === b.name ? 'on' : ''} ${b.dead ? 'dead' : ''}">${esc(b.name)}</button>`).join('')}<button data-c="leave" class="dismiss" title="Ask ${esc(who || 'every bot')} to leave the party">Dismiss</button>`
      : '<span>Invite bots from the Players panel (P), or ask an admin for a party of bots.</span>'}</div>
    <div class="hint">Release V on an order or click it · Esc to close · chat works too: "Brann follow me", "all stay", "Lyra heal me"</div>`;
  }

  function open() {
    if (!state.joined || state.spectator) return;
    render(); el.classList.remove('hidden'); openedAt = performance.now(); hover = null;
  }
  function close() { el.classList.add('hidden'); hover = null; key = false; }
  const isOpen = () => !el.classList.contains('hidden');
  function issue(cmd) {
    const c = BOT_COMMANDS[cmd];
    if (!c || !partyBots().length) return;
    send({ type: 'botcmd', cmd, ...(who ? { name: who } : {}) });
    log(`→ ${who || 'Bots'}: ${c.label}`, 'party');
    close();
  }

  el.addEventListener('pointerover', e => { const b = e.target.closest('.wcmd'); hover = b ? b.dataset.c : null; });
  el.addEventListener('pointerout', e => { if (e.target.closest('.wcmd') && !e.relatedTarget?.closest?.('.wcmd')) hover = null; });
  el.addEventListener('click', e => {
    const w = e.target.closest('[data-w]');
    if (w) { who = w.dataset.w; render(); return; }
    const c = e.target.closest('[data-c]');
    if (c && !c.disabled) issue(c.dataset.c);
  });
  // the wheel covers the screen: a click outside the ring closes it
  el.addEventListener('pointerdown', e => { if (e.target === el) close(); });

  return {
    open, close, isOpen, el,
    keydown(e) { // V pressed (not repeating)
      if (isOpen() && !key) { close(); return; } // second tap closes
      key = true; open();
    },
    keyup() {
      if (!key) return;
      key = false;
      if (hover) issue(hover);
      else if (performance.now() - openedAt > 350) close(); // held and released on nothing: cancel
    },
    hasBots: () => partyBots().length > 0,
  };
}
