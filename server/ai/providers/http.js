// Shared HTTP bits for the provider adapters: plain fetch, JSON in and out, errors that never carry the key.
export class ProviderError extends Error {
  constructor(msg, { status = 0, retryAfter = 0, kind = 'error' } = {}) { super(msg); this.status = status; this.retryAfter = retryAfter; this.kind = kind; }
}

export function redact(text, key) {
  let s = String(text ?? '');
  if (key && key.length >= 6) s = s.split(key).join('***');
  return s.replace(/\b(sk-[\w-]{8,}|sk-ant-[\w-]{8,}|AIza[\w-]{20,})/g, '***').slice(0, 200);
}

export async function postJson(fetchFn, url, { headers, body, signal, key }) {
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) throw new ProviderError('timed out', { kind: 'timeout' });
    throw new ProviderError(`network: ${redact(e?.message || e, key)}`);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error?.message || j.message || j.error?.type || text; } catch {}
    const ra = Number(res.headers?.get?.('retry-after')) || 0;
    throw new ProviderError(`HTTP ${res.status}: ${redact(msg, key)}`, { status: res.status, retryAfter: ra, kind: res.status === 429 ? 'rate' : 'error' });
  }
  try { return JSON.parse(text); } catch { throw new ProviderError('bad JSON from provider'); }
}
