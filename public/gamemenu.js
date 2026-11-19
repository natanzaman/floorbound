// The Game Menu (Esc, or ☰ on phones): Resume, Settings, Controls (the bindings screen, public/controlsui.js), Controls & guide, Change character, Log out, and the admin
// page for admins. It does NOT pause anything (multiplayer): main.js only blocks your movement and attacks while it's
// open. Leaving (change character / log out) is main.js's leave(kind); it asks first when you're downed, partied or
// in a boss fight.
export function initGameMenu({ state, isTouch, guide, controls, steps, openSettings, openControls, lockCursor, leave, accounts, checkAdmin, sfx }) {
  const back = document.createElement('div'); back.id = 'gamemenu'; back.className = 'hidden'; back.dataset.nav = 'gamemenu'; // (data-nav: the controller can drive it, public/focusnav.js)
  back.innerHTML = '<div class="gm-box panel" role="dialog" aria-label="Game Menu"></div>';
  document.body.appendChild(back);
  const box = back.firstChild;
  let open = false, view = 'main', admin = null, openedAt = 0;

  function render() {
    const spec = !!state.spectator, acc = accounts();
    if (view === 'controls') {
      box.innerHTML = `<div class="gm-top"><b>Controls &amp; guide</b><button class="gm-x" data-a="back">Back</button></div>
        <div class="gm-scroll"><p>${controls()}</p><h4>Guide</h4>${steps().map((s, i) => `<p><b>${i + 1}. ${s.title}</b><br>${s.text}</p>`).join('')}</div>
        <button class="gm-b" data-a="guide">Show the guide card again</button>`;
      return;
    }
    box.innerHTML = `<div class="gm-top"><b>Game Menu</b></div>
      <small class="gm-run">The game is still running: it doesn't pause for anyone.</small>
      <button class="gm-b primary" data-a="resume">Resume</button>
      <button class="gm-b" data-a="settings">Settings</button>
      ${openControls ? '<button class="gm-b" data-a="bindings">Controls</button>' : ''}
      ${spec ? '' : '<button class="gm-b" data-a="controls">Controls &amp; guide</button>'}
      <button class="gm-b" data-a="char">${spec ? 'Leave spectator view' : acc ? 'Change character' : 'Change name or class'}</button>
      ${acc ? '<button class="gm-b" data-a="logout">Log out</button>' : ''}
      ${admin ? '<a class="gm-b gm-admin" href="/admin.html" target="_blank" rel="noopener">Admin page</a>' : ''}`;
  }

  function show() {
    if (open) return;
    open = true; view = 'main'; openedAt = performance.now();
    render(); back.classList.remove('hidden'); sfx?.play('ui');
    if (admin === null && accounts()) { admin = false; checkAdmin().then(v => { admin = !!v; if (open && view === 'main') render(); }).catch(() => {}); }
  }
  function close(resume = false) {
    if (!open) return;
    open = false; back.classList.add('hidden');
    if (resume) lockCursor(); // (a click: allowed to capture the mouse again)
  }

  back.addEventListener('click', e => {
    if (e.target === back) return close(true); // click outside the box: resume
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'resume') close(true);
    else if (a === 'settings') { close(); openSettings(); }
    else if (a === 'bindings') { close(); openControls(); }
    else if (a === 'controls') { view = 'controls'; render(); }
    else if (a === 'back') { view = 'main'; render(); }
    else if (a === 'guide') { guide.off = false; if (guide.key) guide.save(); guide.render(); close(true); }
    else if (a === 'char') leave(state.spectator ? 'spectate' : 'char');
    else if (a === 'logout') leave('logout');
  });

  return {
    open: show, close, isOpen: () => open,
    justOpened: () => performance.now() - openedAt < 400, // (the Esc that left pointer lock may still arrive as a keydown)
    get touchButton() { return isTouch; },
  };
}
