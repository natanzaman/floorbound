// Command wheel for the bots in your party (shared/bots/social.js lists the orders; bots obey in shared/bots/brain.js).
// Hold V (or press the Bots button under the party frames): the cursor is freed, point at an order and release V, or
// click it. A quick tap of V keeps the wheel open until you click an order or press Esc / V again.
// Settings → Toggle the bot wheel (toggleMode()): a press opens it, the next press gives the order pointed at (else closes).
// The chips under the wheel pick who gets the order: all your bots, or one of them. Your free bots (made by you, not
// in your party: roster `cid`) get a chip too; their orders always go by name (the server checks who may give them).
import { BOT_COMMANDS } from '/shared/bots/social.js';

// keyLabel(action): the key the hint names (input.label: follows the player's bindings). toggleMode(): the hint's wording.
export function initBotWheel({ send, state, players, log, keyLabel = () => 'V', toggleMode = () => false }) {
  const el = document.createElement('div');
  el.id = 'botwheel'; el.className = 'hidden';
  document.getElementById('hud').appendChild(el);
  let who = '', hover = null, openedAt = 0, key = false;

  const partyBots = () => (state.party ? [...players.values()].filter(p => p.party === state.party && p.id !== state.myId && state.roster.get(p.id)?.bot) : [])
    .map(p => ({ id: p.id, name: state.roster.get(p.id).name, dead: p.dead }));
  const freeBots = () => [...state.roster.entries()].filter(([id, r]) => r.bot && r.cid === state.myId && !(state.party && players.get(id)?.party === state.party))
    .map(([id, r]) => ({ id, name: r.name, dead: !!players.get(id)?.dead, free: true }));
  const allBots = () => [...partyBots(), ...freeBots()];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render() {
    const bots = allBots(), party = partyBots();
    if (who && !bots.some(b => b.name === who)) who = '';
    if (!who && !party.length && bots.length) who = bots[0].name; // only free bots: one at a time
    const cmds = Object.entries(BOT_COMMANDS).filter(([, c]) => c.wheel !== false), n = cmds.length, R = 158;
    el.innerHTML = `<div class="ring">${cmds.map(([id, c], i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return `<button class="wcmd" data-c="${id}" style="left:${Math.round(Math.cos(a) * R)}px;top:${Math.round(Math.sin(a) * R)}px" ${bots.length ? '' : 'disabled'}><span class="ic">${c.icon}</span>${esc(c.label)}</button>`;
    }).join('')}<div class="hub"><b>${bots.length ? 'ORDERS' : 'NO BOTS'}</b><small>${bots.length ? esc(who || 'all bots') : 'in your party'}</small></div></div>
    <div class="who">${bots.length ? `${party.length ? `<button data-w="" class="${who ? '' : 'on'}">All bots</button>` : ''}${bots.map(b => `<button data-w="${esc(b.name)}" class="${who === b.name ? 'on' : ''} ${b.dead ? 'dead' : ''}" ${b.free ? 'title="Your bot, roaming outside your party"' : ''}>${esc(b.name)}${b.free ? ' ↗' : ''}</button>`).join('')}${party.length ? `<button data-c="leave" class="dismiss" title="Ask ${esc(who || 'every bot')} to leave the party (it roams on its own)">Leave party</button>` : ''}`
      : `<span>Invite bots from the Players panel (${esc(keyLabel('players'))}), or ask an admin for a party of bots.</span>`}</div>
    <div class="hint">${toggleMode() ? 'Press' : 'Release'} ${esc(keyLabel('botWheel'))}${toggleMode() ? ' again' : ''} on an order or click it · Esc to close · or type /b stay, /b Lyra: heal (/b help)</div>`;
  }

  function open() {
    if (!state.joined || state.spectator) return;
    render(); el.classList.remove('hidden'); openedAt = performance.now(); hover = null;
  }
  function close() { el.classList.add('hidden'); hover = null; key = false; }
  const isOpen = () => !el.classList.contains('hidden');
  function issue(cmd) {
    const c = BOT_COMMANDS[cmd];
    if (!c || !allBots().length) return;
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

  // Small order menu next to a party frame: one bot (name) or all bots ('').
  const menuEl = document.createElement('div');
  menuEl.id = 'botmenu'; menuEl.className = 'panel hidden';
  document.getElementById('hud').appendChild(menuEl);
  let menuWho = '';
  function menu(rect, name = '') {
    if (!state.joined || state.spectator || !partyBots().length) return;
    menuWho = name;
    const cmds = Object.entries(BOT_COMMANDS);
    menuEl.innerHTML = `<div class="bm-head"><b>${esc(name || 'All bots')}</b><button class="bm-x" title="Close">✕</button></div>`
      + `<div class="bm-grid">${cmds.map(([id, c]) => `<button data-mc="${id}" class="${id === 'leave' ? 'dismiss' : ''}"><span class="ic">${c.icon}</span>${esc(id === 'leave' ? (name ? 'Dismiss' : 'Dismiss all') : c.label)}</button>`).join('')}</div>`;
    menuEl.classList.remove('hidden');
    const top = Math.min(innerHeight - menuEl.offsetHeight - 10, Math.max(10, rect.top));
    menuEl.style.left = `${Math.round(rect.right + 8)}px`; menuEl.style.top = `${Math.round(top)}px`;
  }
  const menuOpen = () => !menuEl.classList.contains('hidden');
  const closeMenu = () => menuEl.classList.add('hidden');
  menuEl.addEventListener('click', e => {
    if (e.target.closest('.bm-x')) return closeMenu();
    const c = e.target.closest('[data-mc]'); if (!c) return;
    const cmd = c.dataset.mc;
    send({ type: 'botcmd', cmd, ...(menuWho ? { name: menuWho } : {}) });
    log(`→ ${menuWho || 'Bots'}: ${BOT_COMMANDS[cmd].label}`, 'party');
    closeMenu();
  });
  addEventListener('pointerdown', e => { if (menuOpen() && !menuEl.contains(e.target) && !e.target.closest?.('#party')) closeMenu(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen()) closeMenu(); });

  return {
    open, close, isOpen, el, menu, menuOpen, closeMenu,
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
    toggle() { // (toggle mode) closed: open it; open: give the order pointed at, else close
      if (!isOpen()) return open();
      if (hover) issue(hover);
      if (isOpen()) close(); // (nothing pointed at, or no bots to give it to)
    },
    cancel() { // a held keyboard wheel when the window loses focus (main.js blur): close it without an order. (Device switch,
      // pad gone, reload: those arrive as cancel ups and main.js closes the wheel.)
      if (!key) return;
      key = false; close();
    },
    hasBots: () => allBots().length > 0,
    point(x, y) { // a stick (x right, y down): highlight the order it points at; release the button (toggle: press it again) to give it (K1b)
      if (!isOpen() || Math.hypot(x, y) < 0.5) return;
      const btns = [...el.querySelectorAll('.wcmd:not([disabled])')], want = Math.atan2(y, x);
      const off = b => Math.abs(Math.atan2(Math.sin(Math.atan2(parseFloat(b.style.top), parseFloat(b.style.left)) - want), Math.cos(Math.atan2(parseFloat(b.style.top), parseFloat(b.style.left)) - want)));
      const best = btns.sort((a, b) => off(a) - off(b))[0];
      for (const b of btns) b.classList.toggle('pick', b === best);
      hover = best ? best.dataset.c : null;
    },
  };
}
