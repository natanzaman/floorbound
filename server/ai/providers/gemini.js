// Google Gemini API (POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent) with JSON
// output constrained by a JSON Schema and the lowest thinking setting (Gemini 3.x thinkingLevel "minimal";
// Gemini 2.5 Flash / Flash-Lite thinkingBudget 0). Thought tokens are billed as output, so they count in the usage.
// The REST docs now also show generationConfig.responseFormat.text { mimeType, schema }: if the API rejects the
// responseMimeType / responseJsonSchema pair, the adapter switches to that shape once and remembers it.
import { postJson, ProviderError } from './http.js';
import { parseJsonObject } from '../intent.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export function geminiBody({ model, system, user, schema, maxTokens, effort, altFormat = false }) {
  const gen = { maxOutputTokens: maxTokens };
  if (altFormat) gen.responseFormat = { text: { mimeType: 'APPLICATION_JSON', schema } };
  else { gen.responseMimeType = 'application/json'; gen.responseJsonSchema = schema; }
  if (/^gemini-2\.5-flash/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
  else if (effort && /^gemini-[3-9]/.test(model)) gen.thinkingConfig = { thinkingLevel: effort };
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: gen,
  };
}

export function geminiParse(j) {
  const cand = j?.candidates?.[0];
  if (!cand) throw new ProviderError(`no answer${j?.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ''}`);
  const text = (cand.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  const intent = parseJsonObject(text);
  if (!intent) throw new ProviderError(cand.finishReason === 'MAX_TOKENS' ? 'output cut off (max tokens)' : `no JSON in reply${cand.finishReason && cand.finishReason !== 'STOP' ? ` (${cand.finishReason})` : ''}`);
  const u = j.usageMetadata || {}, cached = u.cachedContentTokenCount || 0;
  return { intent, usage: { in: Math.max(0, (u.promptTokenCount || 0) - cached), cacheRead: cached, cacheWrite: 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
}

export function geminiProvider({ model, key, effort, fetch: fetchFn = globalThis.fetch }) {
  let altFormat = false;
  return {
    name: 'gemini', model,
    async call({ system, user, schema, maxTokens, signal }) {
      const k = key();
      if (!k) throw new ProviderError('no API key', { kind: 'nokey' });
      const url = `${BASE}${encodeURIComponent(model)}:generateContent`;
      const send = () => postJson(fetchFn, url, { headers: { 'x-goog-api-key': k }, body: geminiBody({ model, system, user, schema, maxTokens, effort, altFormat }), signal, key: k });
      try { return geminiParse(await send()); }
      catch (e) {
        if (!altFormat && e.status === 400 && /responseJsonSchema|responseMimeType|Unknown name/i.test(e.message)) { altFormat = true; return geminiParse(await send()); }
        throw e;
      }
    },
  };
}
