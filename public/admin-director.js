// Admin page: the Director tab (server/director.js, routes in server/director-admin.js). Pick a cue sheet from
// docs/story/*.yaml or paste one, Validate, Run (from a scene), Stop, and watch the live status. Self-contained: it fills
// #tab-director and polls once a second while that tab is shown.
const token = localStorage.getItem('fb_session');
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const host = $('tab-director');
host.innerHTML = `
  <style>
    .dir { display: grid; grid-template-columns: minmax(340px, 1.1fr) minmax(320px, 1fr); gap: 14px; }
    .dir textarea { width: 100%; min-height: 380px; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; resize: vertical; white-space: pre; }
    .dir .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
    .dir .probs { font-size: 12.5px; margin: 6px 0 0; padding-left: 18px; max-height: 220px; overflow: auto; }
    .dir .probs .e { color: #fecaca; } .dir .probs .w { color: #fde68a; } .dir .probs .a { color: #c4b5fd; }
    .dir .big { font-size: 20px; font-weight: 700; } .dir .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
    .dir .cues li, .dir .log li { margin: 2px 0; } .dir .log { max-height: 300px; overflow: auto; font-size: 12px; padding-left: 0; list-style: none; }
    .dir .log .bad { color: #fecaca; } .dir .actors { display: flex; flex-wrap: wrap; gap: 6px; }
    .dir .act { padding: 3px 8px; border: 1px solid var(--line); border-radius: 8px; font-size: 12px; } .dir .act.dead { opacity: .5; text-decoration: line-through; }
    .dir .st { padding: 2px 8px; border-radius: 7px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; background: rgba(255,255,255,.08); }
    .dir .st.running, .dir .st.casting { background: rgba(74,222,128,.2); color: #bbf7d0; } .dir .st.error { background: rgba(248,113,113,.2); color: #fecaca; }
    @media (max-width: 980px) { .dir { grid-template-columns: 1fr; } }
  </style>
  <div class="dir">
    <div class="card">
      <h2>Cue sheet</h2>
      <div class="row"><select id="d-sheets"><option value="">Pick a sheet from docs/story…</option></select><span class="grow" style="flex:1"></span>
        <button id="d-validate">Validate</button></div>
      <textarea id="d-text" spellcheck="false" placeholder="…or paste a cue sheet (YAML, format v1: docs/SCRIPT_BRIEF.md)"></textarea>
      <div id="d-check" class="dim" style="font-size:12.5px"></div>
      <ul id="d-probs" class="probs"></ul>
    </div>
    <div class="card">
      <h2>Show <span class="st" id="d-state">…</span> <span class="grow" style="flex:1"></span><a class="btn" href="/?spectate=1&film=1" target="_blank" rel="noopener">Open film view</a></h2>
      <div class="row">
        <label class="dim">From scene <select id="d-from"></select></label>
        <label class="dim" title="Run even if this server lacks a module some cues need (those cues are skipped)"><input type="checkbox" id="d-force" /> skip missing modules</label>
        <span class="grow" style="flex:1"></span>
        <button class="primary" id="d-run">Run</button><button class="danger" id="d-stop">Stop</button>
      </div>
      <div class="row"><span class="big mono" id="d-scene">–</span><span class="dim" id="d-elapsed"></span></div>
      <div class="actors" id="d-actors"></div>
      <h2 style="margin-top:12px">Running cues</h2><ul class="cues mono" id="d-cues"></ul>
      <h2 style="margin-top:12px">Log</h2><ul class="log mono" id="d-log"></ul>
    </div>
  </div>`;

const toast = (text, good) => { // the page's toasts (admin.js) if present
  const box = $('toasts'); if (!box) return alert(text);
  const el = document.createElement('div'); el.className = `toast ${good ? 'ok' : 'err'}`;
  el.innerHTML = `<span class="ti">${good ? '✔' : '✖'}</span><span>${esc(text)}</span>`; box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, good ? 2600 : 6000);
};
const where = p => (p.scene ? `scene ${p.scene}${p.cue ? `, cue ${p.cue}` : ''}` : 'sheet');

function showCheck(r) {
  const errs = r.errors || [], warns = r.warnings || [];
  const api = errs.filter(e => e.api), hard = errs.filter(e => !e.api);
  $('d-check').innerHTML = r.error ? `<b style="color:#fecaca">${esc(r.error)}</b>` : `${esc(r.title || 'Untitled')}: ${r.scenes?.length ?? '?'} scenes · <b>${hard.length}</b> errors · <b>${api.length}</b> need a missing module · ${warns.length} warnings`;
  $('d-probs').innerHTML = [...hard.map(e => `<li class="e">${esc(where(e))}: ${esc(e.msg)}</li>`), ...api.map(e => `<li class="a">${esc(where(e))}: ${esc(e.msg)}</li>`), ...warns.map(w => `<li class="w">${esc(where(w))}: ${esc(w.msg)}</li>`)].join('');
  if (r.scenes) $('d-from').innerHTML = r.scenes.map((s, i) => `<option value="${i}">${i + 1}. ${esc(s)}</option>`).join('');
  $('d-force').checked = !hard.length && api.length > 0;
}

async function load() {
  const r = await api('/api/admin/director/load', { text: $('d-text').value });
  showCheck(r);
  return r;
}

$('d-sheets').onchange = async () => {
  const f = $('d-sheets').value;
  if (!f) return;
  try { $('d-text').value = (await api(`/api/admin/director/sheets/${encodeURIComponent(f)}`)).text; await load(); } catch (e) { toast(e.message); }
};
$('d-validate').onclick = () => load().then(r => toast(r.ok ? 'No errors.' : `${r.errors.length} problem(s): see the list.`, r.ok)).catch(e => toast(e.message));
$('d-run').onclick = async () => {
  try {
    const r = await load();
    if ((r.errors || []).some(e => !e.api)) return toast('Fix the errors first.');
    await api('/api/admin/director/run', { from: Number($('d-from').value) || 0, force: $('d-force').checked });
    toast('Rolling.', true); poll();
  } catch (e) { toast(e.message); }
};
$('d-stop').onclick = () => api('/api/admin/director/stop', {}).then(() => { toast('Stopped: actors sent home.', true); poll(); }).catch(e => toast(e.message));

let first = true;
async function poll() {
  let s;
  try { s = await api('/api/admin/director'); } catch (e) { $('d-state').textContent = '?'; return; }
  $('d-state').textContent = s.state; $('d-state').className = `st ${s.state}`;
  if (first) {
    first = false;
    if (s.text) { $('d-text').value = s.text; if (s.check) showCheck({ ...s.check, title: s.title, scenes: s.scenes }); }
    try { const L = await api('/api/admin/director/sheets'); $('d-sheets').innerHTML += L.sheets.map(f => `<option>${esc(f)}</option>`).join(''); } catch {}
  }
  const running = s.state === 'running' || s.state === 'casting';
  $('d-run').disabled = running; $('d-stop').disabled = !running && s.state !== 'done' && s.state !== 'error';
  $('d-scene').textContent = s.scene ? `${s.scene.i + 1}/${s.scenes.length} · ${s.scene.id} · ${s.scene.place}` : s.state === 'casting' ? 'casting…' : '–';
  $('d-elapsed').textContent = s.scene ? `${s.scene.secs.toFixed(0)} s in scene · ${s.elapsed.toFixed(0)} s total · ${s.scene.done}/${s.scene.cues} cues` : s.error ? s.error : '';
  $('d-actors').innerHTML = s.actors.map(a => `<span class="act${a.dead ? ' dead' : ''}" title="${esc(a.cls)}">${esc(a.name)} <span class="dim">Lv ${a.lvl} · ${a.maxHp ? Math.round(a.hp / a.maxHp * 100) : 0}%${a.absent ? ' · absent' : ''} · ${esc(a.doing)}</span></span>`).join('');
  $('d-cues').innerHTML = s.running.map(c => `<li>#${c.n} ${esc(c.do)}${c.who ? ` <b>${esc([].concat(c.who).join(', '))}</b>` : ''} <span class="dim">${esc(typeof c.text === 'object' ? JSON.stringify(c.text) : c.text)} · ${c.secs.toFixed(1)} s</span></li>`).join('') || '<li class="dim">none</li>';
  $('d-log').innerHTML = s.log.slice().reverse().map(l => `<li class="${l.text.startsWith('!') ? 'bad' : ''}">${l.t.toFixed(1)} ${l.scene ? `[${esc(l.scene)}] ` : ''}${esc(l.text)}</li>`).join('');
}

let timer = null;
addEventListener('admin-tab', e => {
  clearInterval(timer); timer = null;
  if (e.detail === 'director') { poll(); timer = setInterval(() => { if (!document.hidden) poll(); }, 1000); }
});
