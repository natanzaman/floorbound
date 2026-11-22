// Admin page: the "Towns" card on the Bots tab (server/towns.js, /api/admin/towns). One row per floor town: stage and
// XP (set either), treasury, project, Steward, the raid timer (start or end a raid now) and the election (close it now).
// Self-contained so admin.js stays untouched; polls every 5 s while the page is visible.
const token = localStorage.getItem('fb_session');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => (s <= 0 ? 'now' : s >= 86400 ? `${(s / 86400).toFixed(1)} d` : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);

async function api(method = 'GET', path = '', body) {
  const r = await fetch(`/api/admin/towns${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
}

function mount() {
  const host = document.getElementById('tab-bots');
  if (!host) return null;
  let el = document.getElementById('tw-card');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'card'; el.id = 'tw-card';
  el.innerHTML = `<style>#tw-card th { position: static; }</style><h2>Towns <span class="pill" id="tw-pill">…</span></h2>
    <div id="tw-rows"></div><div id="tw-msg" style="font-size:12.5px;margin-top:6px"></div>`;
  host.appendChild(el);
  return el;
}

let busy = false;
function render(s, err) {
  const el = mount();
  if (!el) return;
  const $ = id => document.getElementById(id);
  if (err) { $('tw-msg').textContent = err; return; }
  $('tw-pill').textContent = s.towns.filter(t => t.raid).length ? 'RAID ON' : `${s.towns.length} towns`;
  $('tw-pill').className = `pill${s.towns.some(t => t.raid) ? ' on' : ''}`;
  if (el.querySelector('#tw-rows input:focus, #tw-rows select:focus')) return;
  $('tw-rows').innerHTML = `<table style="width:100%"><thead><tr><th>Floor</th><th>Stage</th><th>XP</th><th>Treasury</th><th>Project</th><th>Steward</th><th>Raid</th><th>Election</th></tr></thead><tbody>${s.towns.map(t => `<tr>
    <td><b>${t.f}</b> <span class="dim">${esc(t.name)}</span><br><span class="dim" style="font-size:11px">${t.citizens} players, ${t.bots} bots live here</span></td>
    <td><select data-stage="${t.f}">${s.stages.map((st, i) => `<option value="${i}" ${i === t.stage ? 'selected' : ''}>${esc(st.name)}</option>`).join('')}</select></td>
    <td><input type="number" min="0" step="50" value="${t.xp}" data-xp="${t.f}" style="width:80px" /></td>
    <td>${t.treasury}g <span class="dim">tax ${Math.round(t.tax * 100)}%</span></td>
    <td>${t.cur ? esc(t.cur) : '<span class="faint">none</span>'}<br><span class="dim" style="font-size:11px">built: ${t.done.length ? esc(t.done.join(', ')) : 'nothing'}</span></td>
    <td>${t.steward ? `${esc(t.steward.name)} <span class="dim">${esc(t.steward.kind)}</span>` : '<span class="faint">nobody</span>'}</td>
    <td>${t.raid ? `<b>${t.raid[1] ? `wave ${t.raid[2]}/${t.raid[3]}, ward ${t.raid[4]}%` : 'warning'}</b> <button class="small" data-op="${t.f}:endraid:1">Win</button><button class="small danger" data-op="${t.f}:endraid:0">Lose</button>` : `in ${fmt(t.raidIn)} <button class="small" data-op="${t.f}:raid">Raid now</button>`}</td>
    <td>${t.el.tour ? 'tournament on' : `${t.el.cands.length} standing, ${t.el.votes} votes, closes in ${fmt(t.el.closesIn)}`} ${t.el.tour ? '' : `<button class="small" data-op="${t.f}:close">Close now</button>`}${t.last ? `<br><span class="dim" style="font-size:11px">last: ${esc(t.last.name)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

async function refresh() {
  if (document.hidden || busy) return;
  const r = await api().catch(() => null);
  if (!r) return render(null, 'Could not reach the server.');
  if (r.status === 401 || r.status === 403 || r.status === 503) { document.getElementById('tw-card')?.remove(); return; } // the main page shows the gate
  if (!r.ok) return render(null, r.j.error || `HTTP ${r.status}`);
  render(r.j);
}
const say = (text, bad) => { const m = document.getElementById('tw-msg'); if (m) { m.textContent = text || ''; m.style.color = bad ? 'var(--bad)' : 'var(--dim)'; } };
async function act(f, body) {
  busy = true;
  const r = await api('POST', `/${f}`, body).catch(() => null);
  busy = false;
  say(r?.ok ? 'Done.' : r?.j?.error || 'Could not reach the server.', !r?.ok);
  if (r?.ok) render(r.j); else refresh();
}

document.addEventListener('click', ev => {
  const b = ev.target?.closest?.('#tw-card button[data-op]');
  if (!b || busy) return;
  const [f, op, won] = b.dataset.op.split(':');
  if (op === 'close' && !confirm('Close this election now and seat the winner?')) return;
  act(f, { op, won: won === '1' });
});
document.addEventListener('change', ev => {
  const d = ev.target?.dataset;
  if (d?.stage) return act(d.stage, { op: 'stage', stage: Number(ev.target.value) });
  if (d?.xp) return act(d.xp, { op: 'xp', xp: Number(ev.target.value) });
});

if (token) { refresh(); setInterval(refresh, 5000); }
