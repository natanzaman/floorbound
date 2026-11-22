// Admin page: the Guilds card on the Players tab (server/guilds.js, GET / DELETE /api/admin/guilds). Every guild with
// its level, bank, vault and members (rank, player / the Named / session, online); Disband (two clicks; the bank and
// vault go with it). Self-contained so admin.js stays untouched; polls every 10 s while the page is visible.
const token = localStorage.getItem('fb_session');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(method = 'GET', path = '') {
  const r = await fetch(`/api/admin/guilds${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
}

function mount() {
  const host = document.getElementById('tab-players');
  if (!host) return null;
  let el = document.getElementById('gd-card');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'card'; el.id = 'gd-card';
  el.innerHTML = '<h2>Guilds <span class="pill" id="gd-pill">…</span></h2><div id="gd-list" class="dim" style="font-size:12.5px">Loading…</div><div id="gd-msg" style="font-size:12.5px;margin-top:6px"></div>';
  host.appendChild(el);
  el.addEventListener('click', async e => {
    const b = e.target.closest('button[data-gd]');
    if (!b) return;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Sure? (bank and vault are lost)'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Disband'; }, 4000); return; }
    const r = await api('DELETE', `/${+b.dataset.gd}`);
    document.getElementById('gd-msg').textContent = r.ok ? 'Disbanded.' : r.j.error || `Error ${r.status}`;
    load();
  });
  return el;
}

function render(list) {
  const el = mount();
  if (!el) return;
  document.getElementById('gd-pill').textContent = `${list.length}`;
  document.getElementById('gd-list').innerHTML = list.length ? `<table style="width:100%"><thead><tr><th>Guild</th><th>Level</th><th>Bank</th><th>Vault</th><th>Members</th><th></th></tr></thead><tbody>${list.map(g => `<tr>
    <td><b>[${esc(g.tag)}] ${esc(g.name)}</b><br><span class="faint">#${g.id} · since ${esc(new Date(g.created).toLocaleDateString())}</span></td>
    <td>${g.lvl} <span class="dim">(${g.xp} XP)</span></td><td>${g.gold}</td><td>${g.vault}</td>
    <td>${g.members.map(m => `<span class="pill${m.online ? ' on' : ''}${m.kind === 'named' ? ' team' : m.kind === 'session' ? ' bot' : ''}" title="${esc(m.kind)}">${esc(m.name)} · ${esc(m.rank)}</span>`).join(' ')}</td>
    <td><button class="small danger" data-gd="${g.id}">Disband</button></td></tr>`).join('')}</tbody></table>` : 'No guilds yet.';
}

async function load() {
  if (!token || document.hidden) return;
  if (document.getElementById('gd-card')?.querySelector('button[data-sure="1"]')) return; // (an admin mid-confirm)
  const r = await api().catch(() => null);
  if (r?.ok) render(r.j.guilds || []);
  else if (r && r.status !== 401 && r.status !== 403) { mount(); const m = document.getElementById('gd-list'); if (m) m.textContent = r.j.error || `Error ${r?.status}`; }
}
load();
setInterval(load, 10000);
