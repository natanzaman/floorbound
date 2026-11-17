// Admin page: the "AI companions" card on the Bots tab (server/ai/). Shows the status line (on/off, calls, spend
// estimate), a toggle, and the last few decisions. Self-contained so admin.js stays untouched; polls every 5 s while
// the page is visible. Keys are never shown: the server only says which env var it reads and whether it's set.
const token = localStorage.getItem('fb_session');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(method, body) {
  const r = await fetch('/api/admin/ai', { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

function mount() {
  const host = document.getElementById('tab-bots');
  if (!host || document.getElementById('ai-card')) return null;
  const el = document.createElement('div');
  el.className = 'card'; el.id = 'ai-card';
  el.innerHTML = `<h2>AI companions <span class="pill" id="ai-pill">…</span><span class="grow" style="flex:1"></span>
    <button class="small" id="ai-toggle" disabled>…</button></h2>
    <div id="ai-line" style="font-size:13px"></div>
    <div id="ai-more" class="dim" style="font-size:12px;margin-top:6px"></div>
    <ul id="ai-recent" style="margin:8px 0 0;padding-left:18px;font-size:12px"></ul>`;
  host.prepend(el);
  return el;
}

let last = null, busy = false;
function render(s, err) {
  const el = document.getElementById('ai-card') || mount();
  if (!el) return;
  const pill = document.getElementById('ai-pill'), btn = document.getElementById('ai-toggle');
  if (err) { document.getElementById('ai-line').textContent = err; pill.textContent = '?'; btn.disabled = true; return; }
  last = s;
  pill.textContent = s.active ? 'ON' : 'OFF';
  pill.className = `pill${s.active ? ' on' : ''}`;
  btn.textContent = s.on ? 'Turn off' : 'Turn on';
  btn.className = `small${s.on ? ' danger' : ' primary'}`;
  btn.disabled = busy || (!s.on && !s.keySet);
  btn.title = !s.keySet ? `Set ${s.provider ? s.keyEnv : 'AI_PROVIDER and its API key'} in Render first` : '';
  document.getElementById('ai-line').textContent = s.line;
  const bits = [];
  if (!s.provider) bits.push('Set AI_PROVIDER (anthropic, openai or gemini) and the matching key in Render → Environment. See docs/research/ai-companions.md.');
  else if (!s.keySet) bits.push(`The server reads the key from ${s.keyEnv}; it isn't set.`);
  if (s.provider) bits.push(`Minds: ${s.minds} · tokens ${s.tokensIn.toLocaleString()} in (${s.cachedIn.toLocaleString()} cached) / ${s.tokensOut.toLocaleString()} out · $${s.spendTotal.toFixed(4)} since restart · price $${s.price.in}/$${s.price.out} per 1M${s.priceKnown ? '' : ' (guess: set AI_PRICE_IN/OUT)'}`);
  if (s.paused) bits.push(`Paused ${s.paused.s} s: ${s.paused.why}`);
  const sk = Object.entries(s.skipped || {}).map(([k, v]) => `${k} ${v}`).join(', ');
  if (sk) bits.push(`Skipped: ${sk}`);
  if (s.lastError) bits.push(`Last error: ${s.lastError}`);
  document.getElementById('ai-more').innerHTML = bits.map(esc).join('<br>');
  document.getElementById('ai-recent').innerHTML = (s.recent || []).slice().reverse().map(d =>
    `<li><b>${esc(d.bot)}</b> ← ${esc(d.trig)}: ${d.say ? `“${esc(d.say)}”` : '<span class="faint">(quiet)</span>'}${d.order !== 'none' ? ` · order ${esc(d.order)}` : ''}${d.stance !== 'keep' ? ` · ${esc(d.stance)}` : ''}${d.focus ? ` · focus ${esc(d.focus)}` : ''} <span class="faint">${d.ms} ms · $${(d.cost || 0).toFixed(5)}</span></li>`).join('');
}

async function refresh() {
  if (document.hidden) return;
  const r = await api('GET').catch(() => null);
  if (!r) return render(null, 'Could not reach the server.');
  if (r.status === 401 || r.status === 403) { document.getElementById('ai-card')?.remove(); return; } // the main page shows the gate
  if (!r.ok) return render(null, r.j.error || `HTTP ${r.status}`);
  render(r.j);
}

document.addEventListener('click', async ev => {
  if (ev.target?.id !== 'ai-toggle' || !last || busy) return;
  busy = true; ev.target.disabled = true;
  const r = await api('POST', { on: !last.on }).catch(() => null);
  busy = false;
  if (r?.j?.line) render(r.j);
  if (r && !r.ok) document.getElementById('ai-more').textContent = r.j.error || 'Failed.';
});

if (token) { refresh(); setInterval(refresh, 5000); }
