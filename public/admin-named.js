// Admin page: "The Named" card on the Bots tab (server/named.js, /api/admin/named). Shows the five characters (online,
// level, where, what they're doing, whose party), lets an admin send one home or let it back in (they only appear
// while a player is online), set how many levels above the top players they sit, and see and edit every character's
// friendship with them. Self-contained so admin.js stays untouched; polls every 5 s while the page is visible.
const token = localStorage.getItem('fb_session');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(method = 'GET', path = '', body) {
  const r = await fetch(`/api/admin/named${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
}

function mount() {
  const host = document.getElementById('tab-bots');
  if (!host || document.getElementById('nm-card')) return document.getElementById('nm-card');
  const el = document.createElement('div');
  el.className = 'card'; el.id = 'nm-card';
  el.innerHTML = `<style>#nm-card th { position: static; }</style><h2>The Named <span class="pill" id="nm-pill">…</span><span class="grow" style="flex:1"></span>
    <label class="dim" style="font-size:12px;display:inline-flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0">Levels above the top players
      <input type="number" id="nm-off" min="-10" max="30" style="width:64px" /></label>
    <button class="small" id="nm-off-set">Set</button>
    <button class="small" id="nm-off-reset" title="Work their level out afresh from the current top players (they never drop otherwise)">Reset level</button>
    <button class="small" data-nm="all/spawn">Spawn all</button><button class="small danger" data-nm="all/despawn">Despawn all</button></h2>
    <div id="nm-line" class="dim" style="font-size:12.5px;margin-bottom:8px"></div>
    <div id="nm-chars"></div>
    <details id="nm-fr" style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Friendship <span class="dim" id="nm-fr-n"></span></summary><div id="nm-friends" style="margin-top:8px"></div></details>
    <div id="nm-msg" style="font-size:12.5px;margin-top:6px"></div>`;
  host.prepend(el);
  return el;
}

let last = null, busy = false;
const tierOf = (tiers, pts) => { let t = tiers[0]; for (const x of tiers) if (pts >= x.at) t = x; return t; };

function render(s, err) {
  const el = mount();
  if (!el) return;
  const $ = id => document.getElementById(id);
  if (err) { $('nm-line').textContent = err; return; }
  last = s;
  $('nm-pill').textContent = !s.on ? 'OFF' : s.parked ? 'PARKED' : `${s.chars.filter(c => c.online).length}/${s.max} online`;
  $('nm-pill').className = `pill${s.on && s.chars.some(c => c.online) ? ' on' : ''}`;
  if (!s.on) { $('nm-line').textContent = 'Turned off on this server (NAMED_ENABLED=0).'; $('nm-chars').innerHTML = ''; return; }
  if (document.activeElement !== $('nm-off')) $('nm-off').value = s.chars[0]?.off ?? 2;
  $('nm-line').textContent = `${s.humans} player${s.humans === 1 ? '' : 's'} online${s.humans ? '' : ' (the Named only appear while someone is)'}${s.parked ? ' · parked: a director show is running' : ''} · they follow the top characters' levels: ${s.levels.length ? s.levels.join(', ') : 'nobody yet'}`;
  if (!el.querySelector('#nm-chars input:focus')) $('nm-chars').innerHTML = `<table style="width:100%"><thead><tr><th>Name</th><th>Group</th><th>Level</th><th>Where</th><th>Doing</th><th title="Who may invite, kick, despawn or respawn them (besides access 3+): names or character ids, comma-separated; empty = anyone">Allow</th><th></th></tr></thead><tbody>${s.chars.map(c => `<tr>
    <td><b>${esc(c.name)}</b> <span class="dim">${esc(c.cls)}</span></td><td class="dim">${esc(c.gname)}</td><td>${c.lvl}</td>
    <td>${c.online ? esc(c.area) : `<span class="faint">${c.enabled ? 'not in the world' : 'sent home'}</span>`}</td>
    <td>${c.online ? `${esc(c.doing)}${c.host ? ` <span class="pill team">with ${esc(c.host)}</span>` : ''}` : ''}</td>
    <td><input data-allow="${c.id}" value="${esc((c.allow || []).map(a => a.name).join(', '))}" placeholder="anyone" style="width:120px" spellcheck="false" /></td>
    <td style="text-align:right">${c.enabled ? `<button class="small danger" data-nm="${c.id}/despawn">Despawn</button>` : `<button class="small" data-nm="${c.id}/spawn">Spawn</button>`}</td></tr>`).join('')}</tbody></table>`;
  $('nm-fr-n').textContent = `(${s.friends.length} character${s.friends.length === 1 ? '' : 's'})`;
  if (!el.querySelector('#nm-friends input:focus')) {
    $('nm-friends').innerHTML = s.friends.length ? `<table style="width:100%"><thead><tr><th>Character</th>${s.chars.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${s.friends.map(f => `<tr>
      <td>${esc(f.name)} <span class="dim">Lv ${f.lvl}</span>${f.online ? ' <span class="pill on">online</span>' : ''}</td>
      ${s.chars.map(c => { const v = f.f[c.id] ?? 0, t = tierOf(s.tiers, v); return `<td>${typeof f.charId === 'number' ? `<input type="number" min="0" max="100" step="1" value="${v}" data-fr="${f.charId}:${c.id}" style="width:62px" title="${esc(t.name)}" />` : v} <span class="dim" style="font-size:11px">${esc(t.name)}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table>` : '<span class="dim">Nobody has met them yet.</span>';
  }
}

async function refresh() {
  if (document.hidden || busy) return;
  const r = await api().catch(() => null);
  if (!r) return render(null, 'Could not reach the server.');
  if (r.status === 401 || r.status === 403 || r.status === 503) { document.getElementById('nm-card')?.remove(); return; } // the main page shows the gate
  if (!r.ok) return render(null, r.j.error || `HTTP ${r.status}`);
  render(r.j);
}
const say = (text, bad) => { const m = document.getElementById('nm-msg'); if (m) { m.textContent = text || ''; m.style.color = bad ? 'var(--bad)' : 'var(--dim)'; } };
async function act(path, body) {
  busy = true;
  const r = await api('POST', path, body || {}).catch(() => null);
  busy = false;
  say(r?.ok ? 'Done.' : r?.j?.error || 'Could not reach the server.', !r?.ok);
  refresh();
}

document.addEventListener('click', ev => {
  const b = ev.target?.closest?.('#nm-card button');
  if (!b || busy) return;
  if (b.dataset.nm) return act(`/${b.dataset.nm}`);
  const off = Number(document.getElementById('nm-off').value);
  if (b.id === 'nm-off-set') return act('/offset', { off });
  if (b.id === 'nm-off-reset' && confirm('Work the Named\'s level out afresh? They may come back lower.')) return act('/offset', { off, reset: true });
});
document.addEventListener('change', ev => {
  if (ev.target?.dataset?.allow) return act(`/${ev.target.dataset.allow}/allow`, { allow: ev.target.value });
  const key = ev.target?.dataset?.fr;
  if (!key) return;
  const [charId, id] = key.split(':');
  act('/friendship', { charId: Number(charId), id, pts: Number(ev.target.value) });
});

if (token) { refresh(); setInterval(refresh, 5000); }
