// AI companions (server/ai/): the mind layer over the rule-based bot brain, with the mock provider and fake fetch.
// No network, no keys, no database. Covers: off = bots behave exactly as before; chat addressed by name -> structured
// intent -> say / order / stance / focus / memory; ignored chat (unnamed, /b, other party, bots); periodic check-ins;
// budgets, rate limits, timeouts and the error breaker; intent sanitising; the three HTTP adapters' request shapes and
// parsing; key redaction; the admin route and toggle; H3: memories and the day's spend surviving a restart (a fake
// store; with DATABASE_URL also the real tables), the admin test call, and the "thinking" indicator events.
// Usage: node test/ai-mind.js   (PORT for the admin-route check, default 4371; DATABASE_URL optional)
import http from 'node:http';
import { createBot } from '../shared/bots/brain.js';
import { registerBotHook } from '../shared/bots/registry.js';
import { readConfig } from '../server/ai/config.js';
import { Minds } from '../server/ai/mind.js';
import { mockProvider } from '../server/ai/providers/mock.js';
import { makeProvider } from '../server/ai/providers/index.js';
import { anthropicBody } from '../server/ai/providers/anthropic.js';
import { geminiBody } from '../server/ai/providers/gemini.js';
import { sanitizeIntent, INTENT_SCHEMA } from '../server/ai/intent.js';
import { priceOf, costOf } from '../server/ai/prices.js';
import { SYSTEM } from '../server/ai/prompt.js';
import { installAI } from '../server/ai/index.js';
import { makeStore } from '../server/ai/store.js';
import { thinkVisible } from '../public/bubbles.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const flush = () => sleep(5);
const FAKE_KEY = 'sk-test-0123456789abcdefFAKE'; // not a real key: only checks that keys never leak

// ---------- a real bot brain on a fake socket ----------
class FakeWS {
  constructor() { this.readyState = 1; this.sent = []; this.h = {}; }
  addEventListener(t, f) { (this.h[t] ||= []).push(f); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.emit('close'); }
  emit(t, data) { for (const f of this.h[t] || []) f(data === undefined ? {} : { data: JSON.stringify(data) }); }
}
// Natan (human, id 1) partied (7) with Lyra (cleric bot, id 2) and Rook (guardian bot, id 3); Vex (human, id 4) in party 9.
const ROSTER = [{ id: 1, name: 'Natan', cls: 'swordsman', bot: false }, { id: 2, name: 'Lyra', cls: 'cleric', bot: true }, { id: 3, name: 'Rook', cls: 'guardian', bot: true }, { id: 4, name: 'Vex', cls: 'ranger', bot: false }];
function makeBot(name = 'Lyra', id = 2, cls = 'cleric') {
  const b = createBot({ url: 'ws://test', WebSocket: FakeWS, cls, name, behaviour: 'follow', follow: 'Natan', skill: 5 });
  b.ws.emit('message', { type: 'welcome', id, x: 0, z: 0, seq: 0 });
  b.ws.emit('message', { type: 'roster', players: ROSTER });
  b.ws.emit('message', { type: 'inv', life: {}, cons: { potion: 3 } });
  return b;
}
const row = (id, x, z, hp, cls, party) => [id, x, z, 0, hp, 100, 5, cls, party, 0, 0, 0];
function snap(b, events = [], hp = 100) {
  b.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs: [], gate: [0, 0, 0], events,
    players: [row(1, 2, 2, 50, 0, 7), row(2, 0, 0, hp, 2, 7), row(3, 1, 0, 100, 1, 7), row(4, 30, 30, 100, 3, 9)] } });
}
const chat = (id, from, text, ch = 'p', party = 7) => ({ t: 'chat', id, from, text, ch, ...(ch === 'p' ? { party } : {}) });
const chats = b => b.ws.sent.filter(m => m.type === 'chat').map(m => m.text);

// One global hook (hooks can't be removed), dispatching to whichever mind a check installs.
let current = null;
registerBotHook('onEvent', (b, e) => current?.onEvent(b, e));

function setup({ env = {}, reply, provider, now } = {}) {
  const cfg = readConfig({ AI_PROVIDER: 'mock', AI_ENABLED: '1', AI_THINK_S: '0', ...env });
  const p = provider || mockProvider({ reply });
  const bots = [];
  const m = new Minds({ cfg, provider: p, listBots: () => bots, env: { ...env }, now, log: () => {} });
  current = m;
  return { m, p, bots, cfg };
}

// ---------- 1. off: bots behave exactly as before ----------
{
  // Same seeded run three times: no mind at all, mind installed but off (no provider), provider set but no key.
  const seed = s => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const run = minds => {
    current = minds;
    const real = Math.random; Math.random = seed(42);
    try {
      const b = makeBot();
      if (minds) minds.listBots = () => [b];
      for (let i = 0; i < 40; i++) {
        snap(b, i === 5 ? [chat(1, 'Natan', 'Lyra, could you hang back a bit?')] : i === 9 ? [{ t: 'botcmd', by: 1, byName: 'Natan', party: 7, cmd: 'heal', name: 'Lyra' }] : [], i > 20 ? 40 : 100);
        minds?.tick();
      }
      return JSON.stringify({ sent: b.ws.sent, cmd: b.cmd, heal: b.healFocus, back: b.backOff ?? null, keys: Object.keys(b).sort() });
    } finally { Math.random = real; }
  };
  const base = run(null);
  const off = new Minds({ cfg: readConfig({}), provider: null, log: () => {} });
  const cfgNoKey = readConfig({ AI_PROVIDER: 'anthropic', AI_ENABLED: '1' });
  const noKey = new Minds({ cfg: cfgNoKey, provider: makeProvider(cfgNoKey, { env: {} }), env: {}, log: () => {} });
  ok(run(off) === base, 'no AI_PROVIDER: the bot sends and does exactly what it did without the mind layer');
  ok(run(noKey) === base && !noKey.active(), 'provider set but no key: still exactly the same, and the mind stays inactive');
  ok(base.includes('Got you, Natan.'), '(sanity: the scripted run exercised the brain: a /b heal order fired)');
  const r = noKey.setEnabled(true);
  ok(!r.ok && /ANTHROPIC_API_KEY/.test(r.error), `can't switch on without a key: "${r.error}"`);
  ok(/no key/.test(noKey.status().line) && noKey.status().keySet === false, 'status line says the key is missing');
  const cfgOff = readConfig({ AI_PROVIDER: 'mock' });
  ok(cfgOff.startOn === false && new Minds({ cfg: cfgOff, provider: mockProvider(), log: () => {} }).active() === false, 'with a provider but no AI_ENABLED=1 it starts off (admin toggle turns it on)');
  current = null;
}

// ---------- 2. chat by name -> one structured intent ----------
{
  const { m, p, bots } = setup({ reply: () => ({ say: "Sure, I'll hang back and keep you up.", order: 'follow', stance: 'defensive', focus: 'Natan', remember: 'Natan likes to tank' }) });
  const b = makeBot(); bots.push(b);
  snap(b);
  snap(b, [chat(1, 'Natan', 'Lyra, could you hang back and heal me when I am low?')]);
  await flush();
  ok(p.calls.length === 1, 'one call for one addressed line');
  const u = p.calls[0]?.user || '';
  ok(/Trigger: Natan spoke to you/.test(u) && /Natan \(human, Swordsman/.test(u) && /Rook \(bot, Guardian/.test(u), 'the prompt carries the trigger and the party as the bot sees it');
  ok(p.calls[0]?.schema === INTENT_SCHEMA && p.calls[0]?.system === SYSTEM, 'structured-output schema and the shared system prompt are sent');
  ok(chats(b).includes("Sure, I'll hang back and keep you up."), 'the model\'s line goes to party chat');
  ok(!chats(b).some(t => /^(On you|Following|Right behind)/.test(t)), 'the canned order acknowledgement is replaced by the model\'s line');
  ok(b.cmd?.k === 'follow' && b.cmd.by === 1, 'order "follow" went through b.command (by Natan)');
  ok(b.healFocus?.id === 1, 'focus "Natan" makes the healer keep Natan up');
  ok(m.st(b).stance === 'defensive', 'stance set to defensive');
  ok(m.memory.get('Lyra', 'Natan').includes('Natan likes to tank'), 'memory noted');
  snap(b, [chat(1, 'Natan', 'lyra how are you holding up?')]);
  await sleep(10);
  ok(p.calls.length === 1, 'a second line within the per-bot gap waits (pending)');
  const t0 = m.budget.bot(b).last; m.budget.bot(b).last = t0 - 10000; // as if the gap passed
  m.tick(); await flush();
  ok(p.calls.length === 2 && /What you remember about Natan: Natan likes to tank/.test(p.calls[1].user), 'the pending line is answered after the gap, with the memory in the prompt');

  // stance effect: defensive steps out of a fight early when hurt
  b.tgtId = 99; b.hp = 40; b.backOff = 0; b.t += 10;
  m.steer(b, m.st(b));
  ok(b.backOff > b.t, 'defensive stance: hurt in a fight -> the brain steps back (b.backOff)');
  current = null;
}

// ---------- 3. chat that must NOT trigger a call ----------
{
  const { p, bots } = setup();
  const b = makeBot(); bots.push(b);
  snap(b, [chat(1, 'Natan', 'nice weather today')]);
  snap(b, [chat(1, 'Natan', '/b Lyra stay')]);
  snap(b, [chat(4, 'Vex', 'Lyra, come here', 's')]);       // not in her party
  snap(b, [chat(4, 'Vex', 'Lyra, follow me', 'p', 9)]);     // another party's chat
  snap(b, [chat(3, 'Rook', 'Lyra, nice heal')]);           // a bot
  snap(b, [chat(1, 'Natan', 'Lyrafan says hi')]);          // not her name as a word
  await flush();
  ok(p.calls.length === 0, 'unnamed chat, /b commands, outsiders, other parties, bots and partial names never call the model');
  snap(b, [chat(1, 'Natan', 'LYRA! you there?', 's')]);
  await flush();
  ok(p.calls.length === 1, 'a party member naming her in say chat does');
  current = null;
}

// ---------- 4. periodic check-ins ----------
{
  let t = 1e6;
  const { m, p, bots } = setup({ env: { AI_THINK_S: '10' }, now: () => t, reply: () => ({ say: 'Watch the wolves!', order: 'stay', stance: 'aggressive', focus: 'Natan', remember: 'x' }) });
  const b = makeBot(); bots.push(b);
  snap(b);
  m.tick(); await flush();
  ok(p.calls.length === 1 && /periodic check-in/.test(p.calls[0].user), 'a check-in call while partied with a human');
  ok(chats(b).includes('Watch the wolves!'), 'its call-out is said');
  ok(b.cmd?.k !== 'stay' && m.st(b).stance === 'balanced' && !m.st(b).focusId && !m.memory.size, 'unprompted: no order, stance, focus or memory from the model');
  t += 11e3; m.tick(); await flush();
  ok(p.calls.length === 1, 'nothing changed: no new check-in');
  snap(b, [], 30); t += 1e3; m.tick(); await flush();
  ok(p.calls.length === 2, 'state changed (HP): a new check-in');
  ok(chats(b).filter(x => x === 'Watch the wolves!').length === 1, 'unprompted lines are rate-limited (20 s)');
  // a bot with no human in its party has no mind
  const solo = makeBot('Wren', 5); bots.splice(0, bots.length, solo);
  solo.ws.emit('message', { type: 'snap', me: { cds: [0, 0, 0, 0], dodge: 0, lvl: 5, ccd: {} }, w: { mobs: [], gate: [0, 0, 0], events: [], players: [row(5, 0, 0, 100, 2, 8), row(3, 1, 0, 100, 1, 8)] } });
  t += 60e3; m.tick(); await flush();
  ok(p.calls.length === 2, 'bots without a human in the party never call the model');
  current = null;
}

// ---------- 5. budgets and rate limits ----------
{
  let t = 2e6;
  // Sonnet prices, 100k tokens per call: $0.2+ a call against a $0.30/day cap.
  const big = mockProvider({ reply: () => ({ say: 'ok', order: 'none', stance: 'keep', focus: '', remember: '' }) });
  const call0 = big.call; big.call = async req => ({ ...(await call0(req)), usage: { in: 100000, cacheRead: 0, cacheWrite: 0, out: 1000 } });
  const { m, bots } = setup({ env: { AI_MODEL: 'claude-sonnet-5-5', AI_DAILY_USD: '0.3', AI_BOT_MIN_GAP_S: '1' }, provider: big, now: () => t });
  m.price = priceOf('claude-sonnet-5-5');
  const b = makeBot(); bots.push(b); snap(b);
  for (let i = 0; i < 4; i++) { snap(b, [chat(1, 'Natan', `Lyra ${i}?`)]); await flush(); t += 2000; }
  ok(big.calls.length === 2 && m.status().spendToday >= 0.3, `daily USD cap stops calls (2 calls, $${m.status().spendToday})`);
  ok(m.stats.skipped['daily budget used'] >= 1 && /\$0\.4200 today of \$0\.30/.test(m.line()), `status line shows spend vs cap: "${m.line()}"`);
  t += 86400e3; snap(b, [chat(1, 'Natan', 'Lyra, new day?')]); await flush();
  ok(big.calls.length === 3, 'the cap resets on a new UTC day');
  current = null;
}
{
  let t = 3e6;
  const { m, p, bots } = setup({ env: { AI_MAX_CALLS_MIN: '2', AI_BOT_MIN_GAP_S: '0.5' }, now: () => t });
  const b = makeBot(); bots.push(b); snap(b);
  for (let i = 0; i < 4; i++) { snap(b, [chat(1, 'Natan', `Lyra ${i}?`)]); await flush(); t += 1000; }
  ok(p.calls.length === 2 && m.stats.skipped['rate limit'] >= 1, 'global calls-per-minute limit');
  t += 61e3; m.tick(); await flush();
  ok(p.calls.length === 2 && !m.st(b).pending, 'a line left waiting over 20 s is dropped (the bot just plays on)');
  snap(b, [chat(1, 'Natan', 'Lyra, now?')]); await flush();
  ok(p.calls.length === 3, 'a minute later calls go through again');
  current = null;
}
{
  let t = 4e6;
  const { m, p, bots } = setup({ env: { AI_BOT_TOKENS_HOUR: '1000', AI_BOT_MIN_GAP_S: '0.5' }, now: () => t });
  const b = makeBot(); bots.push(b); snap(b);
  for (let i = 0; i < 4; i++) { snap(b, [chat(1, 'Natan', `Lyra ${i}?`)]); await flush(); t += 1000; }
  ok(p.calls.length === 2 && m.stats.skipped['bot token budget used'] >= 1, 'per-bot token budget per hour (two ~900-token calls use up 1000)');
  t += 3601e3; snap(b, [chat(1, 'Natan', 'Lyra?')]); await flush();
  ok(p.calls.length === 3, 'the per-bot budget refills after an hour');
  current = null;
}
{
  const slow = mockProvider({ delayMs: 200 });
  const { p, bots } = setup({ env: { AI_MAX_CONCURRENT: '1', AI_BOT_MIN_GAP_S: '0.5' }, provider: slow });
  const a = makeBot('Lyra', 2), c = makeBot('Rook', 3, 'guardian'); bots.push(a, c); snap(a); snap(c);
  snap(a, [chat(1, 'Natan', 'Lyra?')]); snap(c, [chat(1, 'Natan', 'Rook?')]);
  await flush();
  ok(p.calls.length === 1, 'calls in flight are capped (AI_MAX_CONCURRENT=1)');
  await sleep(250); current.tick(); await sleep(250);
  ok(p.calls.length === 2, 'the other bot goes once the first call is done');
  current = null;
}

// ---------- 6. timeouts, errors, the breaker ----------
{
  const never = { name: 'mock', model: 'mock', calls: [], call(req) { this.calls.push(req); return new Promise(() => {}); } }; // ignores the abort signal
  const { m, bots } = setup({ env: { AI_TIMEOUT_MS: '500' }, provider: never });
  const b = makeBot(); bots.push(b); snap(b);
  const before = JSON.stringify({ cmd: b.cmd, heal: b.healFocus, chats: chats(b) });
  snap(b, [chat(1, 'Natan', 'Lyra, what do you think?')]);
  await sleep(650);
  ok(m.stats.timeouts === 1 && m.budget.inFlight === 0 && !m.st(b).busy, 'a hung API call times out and frees its slot');
  ok(JSON.stringify({ cmd: b.cmd, heal: b.healFocus, chats: chats(b) }) === before, '...and the bot just keeps playing on its brain');
  current = null;
}
{
  let t = 5e6;
  const bad = mockProvider({ fail: () => Object.assign(new Error(`HTTP 500: upstream said ${FAKE_KEY}`), { kind: 'error' }) });
  const { m, bots } = setup({ env: { AI_BOT_MIN_GAP_S: '0.5' }, provider: bad, now: () => t });
  const b = makeBot(); bots.push(b); snap(b);
  for (let i = 0; i < 6; i++) { snap(b, [chat(1, 'Natan', `Lyra ${i}`)]); await flush(); t += 1000; }
  ok(bad.calls.length === 5 && m.status().paused && /errors in a row/.test(m.status().paused.why), '5 errors in a row pause all calls for 2 minutes');
  ok(!JSON.stringify(m.status()).includes(FAKE_KEY), 'an error that echoes a key is redacted in the status');
  t += 121e3; snap(b, [chat(1, 'Natan', 'Lyra?')]); await flush();
  ok(bad.calls.length === 6, 'calls resume after the pause');
  current = null;
}
{ // a garbage reply is sanitised, never acted on blindly
  const { p, bots, m } = setup({ reply: () => ({ say: 'join my discord at www.example.com', order: 'leave', stance: 'berserk', focus: 'Nobody', remember: 'http://x.io' }) });
  const b = makeBot(); bots.push(b); snap(b);
  const cmd = b.cmd;
  snap(b, [chat(1, 'Natan', "Lyra, what's your discord?")]); await flush();
  ok(p.calls.length === 1 && b.cmd === cmd && !chats(b).some(x => /www|leav/i.test(x)) && m.st(b).stance === 'balanced' && !m.memory.size, 'links, unknown orders ("leave"), stances and focus names are dropped');
  current = null;
}

// ---------- 7. intent sanitising ----------
{
  const s = sanitizeIntent({ say: `  Hi\n\tthere ${'x'.repeat(300)}`, order: 'ATTACK', stance: 'Defensive', focus: 'Natan', remember: 'likes boars' });
  ok(s.say.startsWith('Hi there') && s.say.length === 160 && s.order === 'attack' && s.stance === 'defensive', 'whitespace, length and case normalised');
  ok(JSON.stringify(sanitizeIntent(null)) === JSON.stringify({ say: '', order: 'none', stance: 'keep', focus: '', remember: '' }), 'null -> a do-nothing intent');
}

// ---------- 8. adapters (fake fetch: request shape, parsing, usage, redaction) ----------
function fakeFetch(answer) {
  const f = async (url, init) => { f.reqs.push({ url, init, body: JSON.parse(init.body) }); const a = typeof answer === 'function' ? answer(f.reqs.length) : answer; return { ok: a.status === 200, status: a.status, headers: { get: () => null }, text: async () => JSON.stringify(a.body) }; };
  f.reqs = [];
  return f;
}
const REQ = { system: SYSTEM, user: 'hi', schema: INTENT_SCHEMA, maxTokens: 300 };
const INTENT = { say: 'Hi!', order: 'none', stance: 'keep', focus: '', remember: '' };
{
  const env = { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: FAKE_KEY };
  const cfg = readConfig(env);
  const f = fakeFetch({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify(INTENT) }], stop_reason: 'end_turn', usage: { input_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0, output_tokens: 40 } } });
  const r = await makeProvider(cfg, { env, fetch: f }).call(REQ);
  const q = f.reqs[0];
  ok(cfg.model === 'claude-haiku-5-5' && q.url === 'https://api.anthropic.com/v1/messages' && q.init.headers['x-api-key'] === FAKE_KEY && q.init.headers['anthropic-version'], 'anthropic: default Haiku 5.5, Messages API, key from ANTHROPIC_API_KEY');
  ok(q.body.output_config.format.type === 'json_schema' && q.body.output_config.effort === 'low' && q.body.thinking?.type === 'disabled' && q.body.system[0].cache_control?.type === 'ephemeral', 'anthropic: JSON-schema output, effort low, thinking off, cached system prompt');
  ok(r.intent.say === 'Hi!' && r.usage.in === 300 && r.usage.cacheRead === 800 && r.usage.out === 40, 'anthropic: intent and usage parsed');
  const usd = costOf(r.usage, priceOf('claude-haiku-5-5'));
  ok(Math.abs(usd - (300 * 0.1 + 800 * 0.01 + 40 * 0.5) / 1e6) < 1e-12, `anthropic: cost estimate ($${usd.toFixed(7)} for the call)`);
  ok(anthropicBody({ model: 'claude-sonnet-5-5', system: 's', user: 'u', schema: {}, maxTokens: 9, effort: 'low' }).thinking.type === 'between_tools' && !anthropicBody({ model: 'claude-opus-5-5', system: 's', user: 'u', schema: {}, maxTokens: 9, effort: 'low' }).thinking && !('effort' in anthropicBody({ model: 'claude-haiku-4-5', system: 's', user: 'u', schema: {}, maxTokens: 9, effort: 'low' }).output_config), 'anthropic: Sonnet 5.5 answers first, Opus thinks, Haiku 4.5 gets no effort field');
  const f401 = fakeFetch({ status: 401, body: { error: { message: `invalid x-api-key ${FAKE_KEY}` } } });
  let err = null; try { await makeProvider(cfg, { env, fetch: f401 }).call(REQ); } catch (e) { err = e; }
  ok(err && /HTTP 401/.test(err.message) && !err.message.includes(FAKE_KEY), `errors never carry the key: "${err?.message}"`);
  let nokey = null; try { await makeProvider(cfg, { env: {}, fetch: f }).call(REQ); } catch (e) { nokey = e; }
  ok(nokey?.kind === 'nokey' && f.reqs.length === 1, 'no key: no request is made');
}
{
  const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: FAKE_KEY };
  const cfg = readConfig(env);
  const f = fakeFetch({ status: 200, body: { status: 'completed', output: [
    { type: 'reasoning' },
    { type: 'message', phase: 'commentary', content: [{ type: 'output_text', text: 'We need output JSON schema.' }] },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(INTENT) }] },
  ], usage: { input_tokens: 1100, input_tokens_details: { cached_tokens: 1024 }, output_tokens: 50 } } });
  const r = await makeProvider(cfg, { env, fetch: f }).call(REQ);
  const q = f.reqs[0];
  ok(cfg.model === 'gpt-6-luna' && q.url === 'https://api.openai.com/v1/responses' && q.init.headers.authorization === `Bearer ${FAKE_KEY}`, 'openai: default gpt-6-luna, Responses API, bearer key from OPENAI_API_KEY');
  ok(q.body.text.format.type === 'json_schema' && q.body.text.format.strict === true && q.body.reasoning.effort === 'none' && q.body.store === false, 'openai: strict JSON schema, reasoning none, not stored');
  ok(r.intent.say === 'Hi!' && r.usage.in === 76 && r.usage.cacheRead === 1024, 'openai: skips the stray "commentary" item; cached tokens split out');
}
{
  const env = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: FAKE_KEY };
  const cfg = readConfig(env);
  const ans = { status: 200, body: { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: JSON.stringify(INTENT) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 30, thoughtsTokenCount: 12 } } };
  const f = fakeFetch(i => (i === 1 ? { status: 400, body: { error: { message: 'Invalid JSON payload received. Unknown name "responseJsonSchema"' } } } : ans));
  const prov = makeProvider(cfg, { env, fetch: f });
  const r = await prov.call(REQ);
  const [q1, q2] = f.reqs;
  ok(cfg.model === 'gemini-3.1-flash-lite' && q1.url.endsWith('/models/gemini-3.1-flash-lite:generateContent') && q1.init.headers['x-goog-api-key'] === FAKE_KEY, 'gemini: default 3.1 Flash-Lite, generateContent, key from GEMINI_API_KEY');
  ok(q1.body.generationConfig.responseJsonSchema && q1.body.generationConfig.thinkingConfig.thinkingLevel === 'minimal' && q1.body.systemInstruction, 'gemini: JSON schema, minimal thinking, system instruction');
  ok(q2?.body.generationConfig.responseFormat?.text?.schema && !q2.body.generationConfig.responseJsonSchema, 'gemini: falls back to the responseFormat shape if the API rejects the old field');
  ok(r.intent.say === 'Hi!' && r.usage.out === 42, 'gemini: skips thought parts; thinking tokens billed as output');
  ok(geminiBody({ model: 'gemini-2.5-flash-lite', system: 's', user: 'u', schema: {}, maxTokens: 9, effort: 'minimal' }).generationConfig.thinkingConfig.thinkingBudget === 0, 'gemini 2.5 Flash-Lite: thinking budget 0');
  ok(readConfig({ AI_PROVIDER: 'gemini', GOOGLE_API_KEY: 'x' }).keyEnvs.includes('GOOGLE_API_KEY') && readConfig({ AI_PROVIDER: 'openai', AI_KEY_ENV: 'FB_OPENAI' }).keyEnvs[0] === 'FB_OPENAI', 'key env names: GEMINI_API_KEY or GOOGLE_API_KEY; AI_KEY_ENV overrides');
}
{
  ok(priceOf('claude-haiku-5-5-20261007').known && priceOf('claude-haiku-5-5-20261007').in === 0.1, 'prices: dated snapshot ids match their model');
  ok(!priceOf('some-new-model', {}).known && priceOf('some-new-model', { AI_PRICE_IN: '0.2', AI_PRICE_OUT: '1' }).out === 1, 'prices: unknown model -> high guess, or AI_PRICE_IN/OUT');
  ok(SYSTEM.length / 4 >= 512, `system prompt is cacheable on Haiku/Sonnet 5.5 (~${Math.round(SYSTEM.length / 4)} tokens >= 512)`);
}

// ---------- 9. admin route + toggle ----------
{
  const PORT = Number(process.env.PORT) || 4371;
  const server = http.createServer((req, res) => { if (res.handled) return; res.writeHead(404); res.end('nope'); });
  const env = { AI_PROVIDER: 'mock' };
  const minds = installAI({ bots: { bots: [] }, server }, { env, provider: mockProvider(), tickMs: 0, log: () => {}, auth: async req => (req.headers.authorization === 'Bearer admin' ? 0 : req.headers.authorization === 'Bearer user' ? 403 : 401) });
  await new Promise(r => server.listen(PORT, r));
  const call = async (method, tok, body) => { const r = await fetch(`http://localhost:${PORT}/api/admin/ai`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  ok((await call('GET')).status === 401 && (await call('GET', 'user')).status === 403, 'admin route: signed out 401, non-admin 403');
  const g = await call('GET', 'admin');
  ok(g.status === 200 && g.j.on === false && /AI companions: off/.test(g.j.line), `status: "${g.j.line}"`);
  const p = await call('POST', 'admin', { on: true });
  ok(p.status === 200 && p.j.active === true && minds.active(), 'admin toggle turns it on');
  ok((await call('POST', 'admin', { on: 'yes' })).status === 400, 'bad toggle body: 400');
  const other = await fetch(`http://localhost:${PORT}/api/admin/players`);
  ok(other.status === 404, 'other routes are left to the main handler');
  server.close();
  current = null;
}

// ---------- 10. memories and spend survive a restart (fake store with the real store's interface) ----------
function fakeStore() {
  const st = { mem: new Map(), spend: new Map(), saves: 0, fail: false };
  st.api = {
    async loadMemories() { return [...st.mem.values()].map(r => ({ ...r, notes: [...r.notes] })); },
    async saveMemories(rows) { if (st.fail) throw new Error(`db down ${FAKE_KEY}`); st.saves++; for (const r of rows) st.mem.set(`${r.bot}|${r.player}`, { ...r, notes: [...r.notes] }); },
    async pruneMemories() {},
    async loadSpend(day) { return st.spend.get(day)?.usd || 0; },
    async addSpend(day, usd, calls) { const r = st.spend.get(day) || { usd: 0, calls: 0 }; r.usd += usd; r.calls += calls; st.spend.set(day, r); },
  };
  return st;
}
{
  let t = Date.UTC(2026, 10, 18, 12);
  const db = fakeStore();
  const big = mockProvider({ reply: () => ({ say: 'Got it.', order: 'none', stance: 'keep', focus: '', remember: 'Natan hates spiders' }) });
  const call0 = big.call; big.call = async req => ({ ...(await call0(req)), usage: { in: 100000, cacheRead: 0, cacheWrite: 0, out: 1000 } });
  const env = { AI_MODEL: 'claude-sonnet-5-5', AI_DAILY_USD: '0.5', AI_BOT_MIN_GAP_S: '1' };
  const a = setup({ env, provider: big, now: () => t });
  a.m.price = priceOf('claude-sonnet-5-5');
  ok(await a.m.useStore(db.api, { flushMs: 0 }) && a.m.status().saved, 'a mind with a provider uses the store');
  const b = makeBot(); a.bots.push(b); snap(b);
  snap(b, [chat(1, 'Natan', 'Lyra, I hate spiders')]); await flush(); t += 2000;
  snap(b, [chat(1, 'Natan', 'Lyra, ready?')]); await flush(); t += 2000;
  ok(big.calls.length === 2 && a.m.budget.daySpend > 0.4, `two calls spent $${a.m.budget.daySpend.toFixed(2)} of the $0.50 cap`);
  db.fail = true; await a.m.flush();
  ok(db.mem.size === 0 && a.m.memory.dirty.size === 1, 'a failed save keeps the change for the next try');
  db.fail = false; await a.m.flush();
  ok(db.mem.get('lyra|natan')?.notes.includes('Natan hates spiders') && a.m.memory.dirty.size === 0, 'flush saves the changed memory (bot, player, notes)');
  const day = new Date(t).toISOString().slice(0, 10);
  ok(Math.abs(db.spend.get(day).usd - a.m.budget.totalSpend) < 1e-9 && db.spend.get(day).calls === 2, 'flush adds the spend since the last save');
  await a.m.flush();
  ok(db.spend.get(day).calls === 2 && db.saves === 1, 'nothing new: nothing written twice');
  // "restart": a fresh mind on the same store
  const c = setup({ env, provider: big, now: () => t });
  c.m.price = priceOf('claude-sonnet-5-5');
  await c.m.useStore(db.api, { flushMs: 0 });
  ok(c.m.memory.get('Lyra', 'Natan').includes('Natan hates spiders'), 'after a restart Lyra still remembers Natan');
  ok(Math.abs(c.m.budget.daySpend - a.m.budget.totalSpend) < 1e-9, `after a restart today's spend is restored ($${c.m.budget.daySpend.toFixed(2)})`);
  const b2 = makeBot(); c.bots.push(b2); snap(b2);
  snap(b2, [chat(1, 'Natan', 'Lyra, one more?')]); await flush(); t += 2000;
  snap(b2, [chat(1, 'Natan', 'Lyra, and another?')]); await flush();
  ok(big.calls.length === 3 && c.m.stats.skipped['daily budget used'] >= 1, 'AI_DAILY_USD holds across a restart (one more call, then capped)');
  ok(/What you remember about Natan: Natan hates spiders/.test(big.calls[2].user), 'the remembered note reaches the prompt after the restart');
  const off = new Minds({ cfg: readConfig({}), provider: null, log: () => {} });
  ok(!(await off.useStore(db.api, { flushMs: 0 })) && !off.status().saved, 'no AI_PROVIDER: the store is never touched');
  const mem = new (a.m.memory.constructor)(3);
  mem.load([{ bot: 'A', player: 'x', notes: ['1'] }, { bot: 'B', player: 'x', notes: ['2'] }, { bot: 'C', player: 'x', notes: ['3'] }, { bot: 'D', player: 'x', notes: ['4'] }]);
  ok(mem.size === 3 && !mem.get('A', 'x').length && mem.get('D', 'x')[0] === '4' && mem.dirty.size === 0, 'loading respects the cap (keeps the newest) and marks nothing dirty');
  current = null;
}

// ---------- 11. admin test call ----------
{
  const env = { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: FAKE_KEY };
  const cfg = readConfig(env);
  const f = fakeFetch({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify({ ...INTENT, say: 'Loud and clear!' }) }], stop_reason: 'end_turn', usage: { input_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 30 } } });
  const m = new Minds({ cfg, provider: makeProvider(cfg, { env, fetch: f }), env, log: () => {} });
  const r = await m.testCall();
  ok(r.ok && r.say === 'Loud and clear!' && r.ms >= 0 && Math.abs(r.cost - (900 * 0.1 + 30 * 0.5) / 1e6) < 1e-12, `test call: OK, ${r.ms} ms, $${r.cost?.toFixed(6)}, reply "${r.say}"`);
  ok(f.reqs.length === 1 && f.reqs[0].body.model === 'claude-haiku-5-5' && f.reqs[0].body.output_config.format.type === 'json_schema' && f.reqs[0].body.thinking?.type === 'disabled', 'it is one real-shaped request (default model, JSON schema, thinking off)');
  ok(r.key === `…${FAKE_KEY.slice(-4)}` && !JSON.stringify(m.status()).includes(FAKE_KEY.slice(0, -4)), `the key shows as its last 4 characters at most ("${r.key}")`);
  ok(!m.on && m.status().lastTest?.ok && m.budget.daySpend === r.cost, 'works while companions are off; its cost counts toward the day');
  ok(!(await m.testCall()).ok, 'a second test right away is refused (a few seconds apart)');
  const bad = fakeFetch({ status: 401, body: { error: { message: `invalid x-api-key ${FAKE_KEY}` } } });
  const m2 = new Minds({ cfg, provider: makeProvider(cfg, { env, fetch: bad }), env, log: () => {} });
  const r2 = await m2.testCall();
  ok(!r2.ok && /HTTP 401/.test(r2.error) && !JSON.stringify(m2.status()).includes(FAKE_KEY) && m2.budget.fails === 0, `a bad key: error shown, redacted, breaker untouched ("${r2.error}")`);
  const cfgNo = readConfig({ AI_PROVIDER: 'anthropic' });
  const fn = fakeFetch({ status: 200, body: {} });
  const m3 = new Minds({ cfg: cfgNo, provider: makeProvider(cfgNo, { env: {}, fetch: fn }), env: {}, log: () => {} });
  const r3 = await m3.testCall();
  ok(!r3.ok && /ANTHROPIC_API_KEY/.test(r3.error) && fn.reqs.length === 0, `no key: no request, says which variable ("${r3.error}")`);
  const m4 = new Minds({ cfg: readConfig({}), provider: null, log: () => {} });
  ok(!(await m4.testCall()).ok, 'no provider: refused');
  const slow = mockProvider({ delayMs: 2000 });
  const m5 = new Minds({ cfg: readConfig({ AI_PROVIDER: 'mock', AI_TIMEOUT_MS: '500' }), provider: slow, log: () => {} });
  const r5 = await m5.testCall();
  ok(!r5.ok && /timed out/.test(r5.error) && !m5.testing && m5.budget.inFlight === 0, 'a hung test call times out and frees its slot');
}

// ---------- 12. the "thinking" indicator ----------
{
  const game = { events: [] };
  const env = { AI_PROVIDER: 'mock', AI_ENABLED: '1', AI_THINK_S: '10' };
  const p = mockProvider({ delayMs: 50 });
  const bots = { bots: [] };
  const minds = installAI({ game, bots }, { env, provider: p, tickMs: 0, log: () => {} }); // (registers its own onEvent hook)
  current = null;
  const b = makeBot(); bots.bots.push({ b }); snap(b);
  ok(game.aiOn?.() === true, 'game.aiOn() tells the welcome message companions are on');
  snap(b, [chat(1, 'Natan', 'Lyra, you there?')]);
  await flush();
  ok(game.events.some(e => e.t === 'mind' && e.id === 2 && e.on === 1 && e.party === 7), 'a line said to a bot: { t: "mind", on: 1 } for its party');
  await sleep(80);
  ok(game.events.filter(e => e.t === 'mind').at(-1)?.on === 0, '...and on: 0 when the answer is in');
  game.events.length = 0; minds.budget.bot(b).last = -1e9; minds.st(b).lastThink = -1e9;
  minds.tick(); await sleep(80);
  ok(p.calls.length === 2 && !game.events.some(e => e.t === 'mind'), 'periodic check-ins show no indicator');
  const party = { t: 'mind', id: 2, on: 1, party: 7 };
  ok(thinkVisible(party, { party: 7 }) && !thinkVisible(party, { party: 9 }) && !thinkVisible(party, { party: 0 }) && thinkVisible(party, { spectator: true }), 'client: its party and spectators see the dots, nobody else');
  const offGame = { events: [] };
  const offMinds = installAI({ game: offGame, bots: { bots: [{ b }] } }, { env: {}, tickMs: 0, log: () => {} });
  minds.setEnabled(false);
  snap(b, [chat(1, 'Natan', 'Lyra, you there?')]); offMinds.tick(); await flush();
  ok(offGame.events.length === 0 && offGame.aiOn() === false, 'no provider: no events, aiOn false');
  current = null;
}

// ---------- 13. the real tables (only with DATABASE_URL) ----------
if (process.env.DATABASE_URL) {
  const db = await import('../server/db.js');
  await db.migrate(); await db.migrate();
  ok(db.enabled, 'migrations run twice without error');
  await db.q('DELETE FROM ai_memories'); await db.q('DELETE FROM ai_spend');
  const store = makeStore(db.q);
  await store.saveMemories([{ bot: 'lyra', player: 'natan', notes: ['likes to tank', "it's \"quoted\""] }, { bot: 'rook', player: 'natan', notes: ['x'] }]);
  await store.saveMemories([{ bot: 'lyra', player: 'natan', notes: ['likes to tank', 'hates spiders'] }]);
  const rows = await store.loadMemories();
  ok(rows.length === 2 && rows.find(r => r.bot === 'lyra')?.notes.join() === 'likes to tank,hates spiders', 'save, upsert and load memories');
  await db.q(`UPDATE ai_memories SET updated_at = now() - interval '100 days' WHERE bot = 'rook'`);
  for (let i = 0; i < 5; i++) await store.saveMemories([{ bot: `b${i}`, player: 'p', notes: ['n'] }]);
  await store.pruneMemories(4, 90);
  const left = (await store.loadMemories()).map(r => r.bot);
  ok(!left.includes('rook') && left.length === 4, `prune drops old rows and keeps the newest N (${left.join(',')})`);
  await store.addSpend('2026-11-18', 0.25, 3); await store.addSpend('2026-11-18', 0.5, 2);
  ok(Math.abs((await store.loadSpend('2026-11-18')) - 0.75) < 1e-9 && (await store.loadSpend('2026-11-17')) === 0, 'spend adds up per day');
  // a whole restart through the store
  const cfg = readConfig({ AI_PROVIDER: 'mock' });
  const m1 = new Minds({ cfg, provider: mockProvider(), log: () => {} });
  await m1.useStore(store, { flushMs: 0 });
  m1.memory.add('Wren', 'Vex', 'calls the boss Big Horns'); m1.budget.totalSpend = 0.01; m1.budget.calls = 1;
  await m1.flush();
  const m2 = new Minds({ cfg, provider: mockProvider(), log: () => {} });
  await m2.useStore(store, { flushMs: 0 });
  ok(m2.memory.get('wren', 'vex')[0] === 'calls the boss Big Horns', 'a memory written by one server is read by the next');
  await db.q('DELETE FROM ai_memories'); await db.q('DELETE FROM ai_spend');
} else console.log('  (skipping the database checks: no DATABASE_URL)');

console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
process.exit(failed ? 1 : 0);
