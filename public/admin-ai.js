// Admin page: the "AI companions" card on the Bots tab (server/ai/). Shows the status line (on/off, calls, spend
// estimate), a toggle, a "Test call" button (one tiny real call: OK/error, latency, cost) and the last few decisions.
// Self-contained so admin.js stays untouched; polls every 5 s while the page is visible. Keys are never shown: the
// server says which env var it reads, whether it's set, and after a test call at most the key's last 4 characters.
const token = localStorage.getItem('fb_session');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(method, body, path = '') {
  const r = await fetch(`/api/admin/ai${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

function mount() {
  const host = document.getElementById('tab-bots');
  if (!host || document.getElementById('ai-card')) return null;
  const el = document.createElement('div');
  el.className = 'card'; el.id = 'ai-card';
  el.innerHTML = `<h2>AI companions <span class="pill" id="ai-pill">…</span><span class="grow" style="flex:1"></span>
    <button class="small" id="ai-test" disabled title="One tiny real call to check the key works (costs a fraction of a cent)">Test call</button>
    <button class="small" id="ai-toggle" disabled>…</button></h2>
    <div id="ai-line" style="font-size:13px"></div>
    <div id="ai-test-out" style="font-size:13px;margin-top:6px"></div>
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
  const tb = document.getElementById('ai-test');
  if (err) { document.getElementById('ai-line').textContent = err; pill.textContent = '?'; btn.disabled = true; tb.disabled = true; return; }
  last = s;
  pill.textContent = s.active ? 'ON' : 'OFF';
  pill.className = `pill${s.active ? ' on' : ''}`;
  btn.textContent = s.on ? 'Turn off' : 'Turn on';
  btn.className = `small${s.on ? ' danger' : ' primary'}`;
  btn.disabled = busy || (!s.on && !s.keySet);
  btn.title = !s.keySet ? `Set ${s.provider ? s.keyEnv : 'AI_PROVIDER and its API key'} in Render first` : '';
  tb.disabled = busy || s.testing || !s.keySet;
  tb.textContent = s.testing ? 'Testing…' : 'Test call';
  document.getElementById('ai-line').textContent = s.line;
  document.getElementById('ai-test-out').innerHTML = testLine(s.lastTest);
  const bits = [];
  if (!s.provider) bits.push('Set AI_PROVIDER (anthropic, openai or gemini) and the matching key in Render → Environment. See docs/research/ai-companions.md.');
  else if (!s.keySet) bits.push(`The server reads the key from ${s.keyEnv}; it isn't set.`);
  if (s.provider) bits.push(`Minds: ${s.minds} · tokens ${s.tokensIn.toLocaleString()} in (${s.cachedIn.toLocaleString()} cached) / ${s.tokensOut.toLocaleString()} out · $${s.spendTotal.toFixed(4)} since restart · price $${s.price.in}/$${s.price.out} per 1M${s.priceKnown ? '' : ' (guess: set AI_PRICE_IN/OUT)'}`);
  if (s.provider) bits.push(`Memories: ${s.memories}${s.saved ? ' (kept across restarts)' : ' (lost on restart: no database)'} · daily cap $${Number(s.dailyCap).toFixed(2)} (AI_DAILY_USD)`);
  if (s.paused) bits.push(`Paused ${s.paused.s} s: ${s.paused.why}`);
  const sk = Object.entries(s.skipped || {}).map(([k, v]) => `${k} ${v}`).join(', ');
  if (sk) bits.push(`Skipped: ${sk}`);
  if (s.lastError) bits.push(`Last error: ${s.lastError}`);
  document.getElementById('ai-more').innerHTML = bits.map(esc).join('<br>');
  document.getElementById('ai-recent').innerHTML = (s.recent || []).slice().reverse().map(d =>
    `<li><b>${esc(d.bot)}</b> ← ${esc(d.trig)}: ${d.say ? `“${esc(d.say)}”` : '<span class="faint">(quiet)</span>'}${d.order !== 'none' ? ` · order ${esc(d.order)}` : ''}${d.stance !== 'keep' ? ` · ${esc(d.stance)}` : ''}${d.focus ? ` · focus ${esc(d.focus)}` : ''} <span class="faint">${d.ms} ms · $${(d.cost || 0).toFixed(5)}</span></li>`).join('');
}

// The last test call: OK with latency, cost and the reply, or the error. The key shows as its last 4 characters at most.
function testLine(t) {
  if (!t) return '';
  const when = new Date(t.at).toLocaleTimeString();
  const who = t.provider ? `${esc(t.provider)}/${esc(t.model)}${t.key ? ` · key ${esc(t.key)}` : ''}` : '';
  if (t.ok) return `<span class="pill on">Test OK</span> ${t.ms} ms · $${(t.cost || 0).toFixed(6)} · ${who}${t.say ? ` · “${esc(t.say)}”` : ''} <span class="faint">${when}</span>`;
  return `<span class="pill">Test failed</span> ${esc(t.error)}${who ? ` · ${who}` : ''}${t.ms !== undefined ? ` · ${t.ms} ms` : ''} <span class="faint">${when}</span>`;
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
  if (ev.target?.id === 'ai-test' && !busy) {
    busy = true; ev.target.disabled = true; ev.target.textContent = 'Testing…';
    const r = await api('POST', {}, '/test').catch(() => null);
    busy = false;
    if (r?.j?.line) render(r.j);
    else document.getElementById('ai-test-out').textContent = r?.j?.error || 'Could not reach the server.';
    return;
  }
  if (ev.target?.id !== 'ai-toggle' || !last || busy) return;
  busy = true; ev.target.disabled = true;
  const r = await api('POST', { on: !last.on }).catch(() => null);
  busy = false;
  if (r?.j?.line) render(r.j);
  if (r && !r.ok) document.getElementById('ai-more').textContent = r.j.error || 'Failed.';
});

if (token) { refresh(); setInterval(refresh, 5000); }
