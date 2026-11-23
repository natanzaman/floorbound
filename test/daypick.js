// The free bots' decision model (docs/briefs/bot-days.md, server/ai/daypick.js): a decision model picks what a bot
// does next, the bot rolls from the odds it gives back, and the rules decide whenever the model is off, slow, broken
// or over its cap. Unit checks: the OpenRouter Decisions request and answer (shape, refusals, odd answers), the
// picker's gates (rules only, no key, a quiet floor, the per-bot cooldown, the daily cap, the breaker), the roll, what
// a pick records (who decided, the odds, the model), the day taking a model's pick on a stub bot, and the admin route.
// Usage: node test/daypick.js
import assert from 'node:assert/strict';
import http from 'node:http';
import { decisionsBody, decisionsParse, decisionsProvider, DECISIONS_URL } from '../server/ai/providers/decisions.js';
import { DayPickers, pickState } from '../server/ai/daypick.js';
import { readDayConfig, DAY_MODEL } from '../server/ai/config.js';
import { installAI } from '../server/ai/index.js';
import { GOALS, GOAL_IDS, PICK_WAIT, facts, scoreGoals, dayTurn, dayLog } from '../shared/bots/day.js';
import { planTurn } from '../shared/bots/planrun.js';
import { rng } from '../shared/bots/personality.js';

let n = 0, failed = 0;
const ok = (cond, what) => { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;
const FAKE_KEY = 'or-test-0123456789FAKE'; // not a real key: only checks it never leaks

// ---------- 1. the Decisions API ----------
{
  const body = decisionsBody({ model: 'typesafe/jev-1.13', state: { who: 'Rook' }, instructions: 'Pick one.', criteria: { hunt: 'Fight things.', rest: 'Sit down.' }, user: 'bot:3' });
  ok(body.model === 'typesafe/jev-1.13' && body.questions.next.type === 'choice' && J(Object.keys(body.questions.next.criteria)) === '["hunt","rest"]' && body.user === 'bot:3' && body.state.who === 'Rook',
    'the request: one choice question, the options as criteria, the bot as state');
  const good = { id: 'gen-dec-1', model: 'typesafe/jev-1.13-20260917', provider: 'TypeSafe', answers: { next: { type: 'choice', choice: 'rest', confidence: 0.8, probabilities: { hunt: 0.3, rest: 0.7 } } }, usage: { input_tokens: 476, output_tokens: 0, cost: 0.000019 } };
  const r = decisionsParse(good, ['hunt', 'rest']);
  ok(r.pick === 'rest' && r.odds.rest === 0.7 && r.odds.hunt === 0.3 && r.confidence === 0.8 && r.model === 'typesafe/jev-1.13-20260917' && r.usage.in === 476 && r.usage.cost === 0.000019,
    'the answer: the pick, a probability per option, the dated model and the cost');
  const noProbs = decisionsParse({ answers: { next: { type: 'choice', choice: 'hunt' } }, usage: { input_tokens: 10, output_tokens: 0 } }, ['hunt', 'rest']);
  ok(noProbs.pick === 'hunt' && J(noProbs.odds) === '{}' && noProbs.confidence === null && noProbs.usage.cost === null, 'probabilities, confidence and cost are optional');
  const extra = decisionsParse({ answers: { next: { type: 'choice', choice: 'hunt', probabilities: { hunt: 0.9, fly: 0.1, rest: 'x' } } }, usage: {} }, ['hunt', 'rest']);
  ok(J(extra.odds) === '{"hunt":0.9}', 'odds for options we never offered, and values that are not numbers, are dropped');
  const bad = [
    [{}, 'no answer in reply'],
    [{ answers: { next: { type: 'refusal' } } }, 'declined'],
    [{ answers: { next: { type: 'score', score: 2 } } }, 'unexpected answer type'],
    [{ answers: { next: { type: 'choice', choice: 'fly' } } }, 'not offered'],
  ];
  let msgs = '';
  for (const [j, want] of bad) { try { decisionsParse(j, ['hunt', 'rest']); msgs += `no error for ${J(j)}; `; } catch (e) { if (!e.message.includes(want)) msgs += `${e.message} != ${want}; `; } }
  ok(!msgs, `a missing, refused, odd or made-up answer is an error, never a pick (${msgs || 'all four'})`);
  ok(DECISIONS_URL === 'https://openrouter.ai/api/alpha/decisions' && readDayConfig({}).model === DAY_MODEL && DAY_MODEL === 'typesafe/jev-1.13', `the endpoint and the default model (${DAY_MODEL})`);
}
// the provider: the key goes in the header, never into an error
{
  let seen = null;
  const fetchFn = async (url, o) => { seen = { url, o }; return { ok: false, status: 401, text: async () => J({ error: { message: `bad key ${FAKE_KEY}` } }), headers: { get: () => null } }; };
  const p = decisionsProvider({ model: 'm/1', key: () => FAKE_KEY, fetch: fetchFn });
  let err = '';
  await p.decide({ state: 'x', instructions: 'i', criteria: { a: 'A' }, want: ['a'] }).catch(e => { err = e.message; });
  ok(seen.o.headers.authorization === `Bearer ${FAKE_KEY}` && seen.url === DECISIONS_URL && /HTTP 401/.test(err) && !err.includes(FAKE_KEY) && err.includes('***'), `the key is sent as a bearer token and never appears in an error (${err})`);
  const noKey = decisionsProvider({ model: 'm/1', key: () => '', fetch: fetchFn });
  const e2 = await noKey.decide({ state: 'x', instructions: 'i', criteria: {}, want: [] }).catch(e => e);
  ok(e2.kind === 'nokey', 'no key: it fails before any request');
}

// ---------- 2. the picker ----------
function stub(o = {}, t = {}) {
  const b = { id: 2, name: 'Rook', behaviour: 'own', t: 1000, x: 0, z: 60, hp: 100, maxHp: 100, dead: false, me: { lvl: 6 }, cls: 'swordsman', players: [{ id: 2, x: 0, z: 60 }], names: new Map(), mobs: [], allMobs: [], locks: new Map(), life: {},
    cons: { potion: 3 }, gold: 40, bag: [], cds: [0, 0, 0, 0, 0], sent: [], said: [], cmd: null, plan: null, persona: { id: 'test', t: { aggression: 0.5, caution: 0.5, patience: 0.5, sociability: 0.5, chattiness: 0.5, playfulness: 0.5, curiosity: 0.5, ...t } }, ...o };
  b.send = m => b.sent.push(m);
  return b;
}
const askOf = (b, extra = {}) => { // what the day hands the picker
  const f = { ...facts(b), ...extra };
  const got = { id: '', meta: null };
  return { bot: b.name, facts: f, traits: b.persona.t, scores: scoreGoals(b, f, rng(3)), done: (id, meta) => { got.id = id; got.meta = meta; return true; }, got };
};
// A stand-in decision model: answers after `ms` with these odds.
const fake = (odds, { ms = 0, model = 'stub/1', fail = null, cost = 0.00002 } = {}) => ({
  name: 'stub', model, calls: [],
  async decide(req) {
    this.calls.push(req);
    if (ms) await sleep(ms);
    if (fail) throw Object.assign(new Error(fail), { kind: fail === 'timed out' ? 'timeout' : 'error' });
    const pick = Object.entries(odds).sort((a, b) => b[1] - a[1])[0][0];
    return { pick, odds, confidence: 0.7, model, usage: { in: 400, out: 0, cost } };
  },
});
const pickers = (provider, env = {}, more = {}) => new DayPickers({ env: { BOT_DAY_PICK: 'mock', ...env }, provider, now: () => Date.now(), log: () => {}, ...more });

{
  const b = stub(), P = pickers(fake({ rest: 0.7, hunt: 0.3 }), {}, { rnd: () => 0.01 });
  const ask = askOf(b);
  ok(P.pick(b, ask) === true && P.asked === 1, 'the picker takes the question (the bot waits a moment for it)');
  await sleep(20);
  ok(ask.got.id === 'rest' && ask.got.meta.who === 'model' && ask.got.meta.odds === 0.7 && ask.got.meta.model === 'stub/1', `the answer comes back with who decided and the odds (${J(ask.got.meta)})`);
  const req = P.provider.calls[0];
  ok(J(Object.keys(req.criteria).sort()) === J([...req.want].sort()) && req.want.every(id => GOAL_IDS.includes(id)) && req.criteria[req.want[0]] === GOALS[req.want[0]].tell && /dungeon-crawler/.test(req.instructions),
    `only goals worth something are offered, each with its own line (${J(req.want)})`);
  ok(req.state.its_own_scores && req.state.now.potions === 3 && req.state.personality.careful === 0.5 && /level 6 swordsman/.test(req.state.who) && !J(req.state).includes('"x"'),
    `the state says who and how it is, with its own scores as a hint (${J(req.state).length} characters)`);
  const S = P.status();
  ok(S.answered === 1 && S.models[0].picks === 1 && S.models[0].goals.rest === 1 && S.spendToday > 0 && S.recent[0].probs.rest === 0.7 && /stub\/1 decides: 1 of 1 answered/.test(S.line),
    `the admin page gets per-model numbers and the last picks (${S.line})`);
}
{ // the roll: a 70/30 answer goes the other way about three times in ten
  const seen = { rest: 0, hunt: 0 };
  for (let i = 0; i < 200; i++) {
    const P = pickers(fake({ rest: 0.7, hunt: 0.3 }), {}, { rnd: () => (i + 0.5) / 200 });
    const b = stub(), ask = askOf(b);
    P.pick(b, ask); await sleep(2);
    seen[ask.got.id] = (seen[ask.got.id] || 0) + 1;
  }
  ok(seen.hunt > 45 && seen.hunt < 75 && seen.rest > 125, `a 70/30 answer is rolled, not obeyed (${seen.rest} rest, ${seen.hunt} hunt of 200)`);
}
{ // a late answer is counted and dropped; an error leaves it to the rules; three errors in a row stop it for a while
  const P = pickers(fake({ rest: 1 }, { ms: 30 }));
  const b = stub(), ask = { ...askOf(b), done: () => false }; // (the bot stopped waiting)
  P.pick(b, ask); await sleep(60);
  ok(P.late === 1 && P.status().models[0].late === 1 && P.status().recent[0].late === true, 'an answer that comes too late: counted, and the bot keeps what the scores chose');
  const E = pickers(fake({}, { fail: 'boom' }));
  for (let i = 0; i < 3; i++) { const q = stub({ id: 10 + i }); E.pick(q, askOf(q)); await sleep(5); }
  ok(E.errors === 3 && E.status().paused?.s > 250 && E.pick(stub({ id: 99 }), askOf(stub({ id: 99 }))) === false && /3 errors in a row/.test(E.status().paused.why),
    `three failures in a row: the rules decide for the next five minutes (${E.status().paused?.s} s left)`);
  const T = pickers(fake({}, { fail: 'timed out' }));
  const q = stub(); T.pick(q, askOf(q)); await sleep(5);
  ok(T.timeouts === 1 && T.errors === 0 && T.status().lastError === 'timed out', 'a timeout is counted apart from an error');
}
{ // the gates
  const off = new DayPickers({ env: { BOT_DAY_PICK: 'rules' }, log: () => {} });
  ok(!off.on() && off.pick(stub(), askOf(stub())) === false && /their own scores/.test(off.line()) && off.status().skipped['rules only'] === 1, `BOT_DAY_PICK=rules: nobody is asked (${off.line()})`);
  const noKey = new DayPickers({ env: {}, log: () => {} });
  ok(noKey.on() && !noKey.ready() && noKey.pick(stub(), askOf(stub())) === false && /no key is set/.test(noKey.line()) && noKey.status().keyEnv === 'OPENROUTER_API_KEY', `no key: the model is skipped, and the page says which variable to set (${noKey.line()})`);
  { // BOT_DAY_PICK=mock: a decider in process, no key and no network (local tries)
    const M = new DayPickers({ env: { BOT_DAY_PICK: 'mock' }, log: () => {} });
    const m = stub(), mask = askOf(m);
    ok(M.ready() && M.pick(m, mask) === true, 'BOT_DAY_PICK=mock answers in process, with no key');
    await sleep(120);
    const t = await M.testCall();
    ok(mask.got.meta?.who === 'model' && t.ok && t.cost === 0 && Math.abs(Object.values(t.odds).reduce((a, v) => a + v, 0) - 1) < 0.01,
      `the mock decider leans on the bot's own scores and costs nothing (${t.pick}, ${J(t.odds)})`);
  }
  const quiet = pickers(fake({ rest: 1 }));
  ok(quiet.pick(stub(), askOf(stub(), { quiet: true })) === false && quiet.status().skipped['nobody on this floor'] === 1, 'a bot alone on its floor is going home to rest: nothing to decide, nothing to pay for');
  const gap = pickers(fake({ rest: 1 }));
  const far = stub(), near = stub({ id: 3 });
  gap.pick(far, askOf(far)); await sleep(5);
  ok(gap.pick(far, askOf(far)) === false && gap.status().skipped['bot cooldown'] === 1, 'the same bot is not asked twice in a row (once a minute far from players)');
  const nearAsk = askOf(near, { humans: 1 });
  gap.pick(near, nearAsk); await sleep(5);
  gap.seen.set(near, Date.now() - 31000);
  ok(gap.pick(near, askOf(near, { humans: 1 })) === true, 'near a player it may ask again after 30 s');
  const cap = pickers(fake({ rest: 1 }), { JEV_DAILY_USD: '0.00002' });
  const c1 = stub(); cap.pick(c1, askOf(c1)); await sleep(5);
  ok(cap.daySpend > 0 && cap.pick(stub({ id: 4 }), askOf(stub({ id: 4 }))) === false && cap.status().skipped['daily cap'] === 1, `the day's cap (JEV_DAILY_USD) stops the calls, the bots play on (${cap.daySpend.toFixed(6)} spent)`);
  const busy = pickers(fake({ rest: 1 }, { ms: 50 }), { BOT_DAY_CONCURRENT: '1' });
  const b1 = stub(), b2 = stub({ id: 5 });
  busy.pick(b1, askOf(b1));
  ok(busy.pick(b2, askOf(b2)) === false && busy.status().skipped.busy === 1, 'only so many calls in flight at once');
  await sleep(80);
  const rate = pickers(fake({ rest: 1 }), { BOT_DAY_CALLS_MIN: '1' });
  const r1 = stub(); rate.pick(r1, askOf(r1)); await sleep(5);
  ok(rate.pick(stub({ id: 6 }), askOf(stub({ id: 6 }))) === false && rate.status().skipped['rate limit'] === 1, 'and so many calls a minute');
  const one = pickers(fake({ rest: 1 }));
  const flat = stub(); const fa = askOf(flat);
  for (const s of fa.scores) s.score = 0;
  one.pick(flat, fa); await sleep(5);
  ok(one.provider.calls.length === 1 && one.provider.calls[0].want.length === 2, 'with nothing scoring, it is still offered a real choice (rest or hunt)');
}
{ // the state never carries anything but the game (no keys, no player names beyond the bot's own)
  const b = stub({ name: 'Rook' }), st = pickState(b, askOf(b));
  const ask = askOf(stub({ name: 'Rook', players: [{ id: 2, x: 0, z: 60 }, { id: 9, x: 3, z: 60, name: 'Natan' }], names: new Map([[9, { name: 'Natan' }]]) }));
  const st2 = pickState(stub({ name: 'Rook' }), { ...ask, facts: { ...ask.facts, with: ['Natan'] } });
  ok(J(Object.keys(st).sort()) === J(['its_own_scores', 'now', 'personality', 'who']) && J(Object.keys(st.now).sort()) === J(['bag_items', 'deaths_lately', 'floor', 'gold', 'health', 'in_a_team_of', 'in_town', 'last_thing_it_did', 'minutes_on_the_same_thing', 'minutes_since_it_rested', 'minutes_since_it_saw_anyone', 'other_free_bots_about', 'people_nearby', 'players_nearby', 'potions', 'spare_gear'])
    && !J(st2).includes('Natan') && J(st).length < 1200, `the state is exactly these fields: small, and no player's name, id or account in it (${J(st).length} characters)`);
}

// ---------- 3. the day takes a model's pick ----------
{
  const api = { say: (b, k, v, o) => b.said.push(o?.text || k), command: (b, c) => { if (c.k === 'farm') b.cmd = { k: 'farm', group: c.group }; } };
  const PV = b => ({ all: [{ id: b.id }], mates: [], humans: [], botLeader: { id: b.id } });
  const P = pickers(fake({ rest: 0.6, hunt: 0.4 }), {}, { rnd: () => 0.01 });
  const b = stub();
  b.dayPicker = (bot, ask) => P.pick(bot, ask);
  const turn = (secs, r = rng(2)) => { for (let left = secs; left > 1e-9; left -= 0.5) { b.t += Math.min(0.5, left); dayTurn(b, PV(b), api, r); if (b.plan) planTurn(b, PV(b), api); } };
  turn(0.5);
  ok(!b.plan && !b.day.goal, 'the day waits a moment for the model');
  await sleep(20); turn(0.5);
  ok(b.day.goal === 'rest' && b.day.by === 'model' && b.day.odds === 0.6 && b.day.model === 'stub/1' && b.plan?.day === 'rest',
    `the model's pick becomes the goal, with who decided it and the odds (${b.day.goal}, ${b.day.by} ${b.day.odds})`);
  b.plan = null; // (as if the plan had run out: the day closes the goal and writes its log entry)
  b.dayPicker = () => false;
  turn(8);
  { // nobody to ask: the goal says the scores decided it, and what the winner scored
    const r = stub({ id: 7 });
    r.dayPicker = () => false;
    for (let i = 0; i < 20 && !r.day?.goal; i++) { r.t += 0.5; dayTurn(r, PV(r), api, rng(2)); }
    ok(r.day.goal && r.day.by === 'rules' && r.day.odds > 0 && r.day.model === '', `with the model off, the goal says the rules decided and what it scored (${r.day.goal}, ${r.day.by} ${r.day.odds})`);
  }
  const log = () => b.day.log[0];
  ok(log() && log().by === 'model' && log().odds === 0.6 && log().model === 'stub/1' && /Resting/.test(dayLog(b)), `every goal in the log keeps who decided it: the start of the trace (${dayLog(b, 1)})`);
  ok(PICK_WAIT === 0.4 && readDayConfig({}).waitMs === 400, 'the day and the picker agree on how long a bot waits (400 ms)');
  { // BOT_DAY_WAIT_MS is the bot's wait too (a slower model can be given longer; before, its answers were paid for and dropped)
    const slow = pickers(fake({ rest: 0.9, hunt: 0.1 }, { ms: 700 }), { BOT_DAY_WAIT_MS: '1500' }, { rnd: () => 0.01 });
    const w = stub({ id: 8 });
    w.dayPicker = (bot, ask) => slow.pick(bot, ask);
    const step = () => { w.t += 0.25; dayTurn(w, PV(w), api, rng(2)); };
    for (let i = 0; i < 4; i++) step(); // 1 s of bot time: past the default 0.4 s
    const waited = !w.day.goal && w.day.pending?.wait === 1.5;
    await sleep(800); step();
    ok(waited && w.day.goal === 'rest' && w.day.by === 'model' && slow.late === 0, `BOT_DAY_WAIT_MS=1500: the bot waits that long, and a 700 ms answer is taken (${w.day.goal}, ${w.day.by}, ${slow.late} late)`);
    const quick = pickers(fake({ rest: 0.9, hunt: 0.1 }, { ms: 700 }), {}, { rnd: () => 0.01 });
    const q = stub({ id: 9 });
    q.dayPicker = (bot, ask) => quick.pick(bot, ask);
    for (let i = 0; i < 4; i++) { q.t += 0.25; dayTurn(q, PV(q), api, rng(2)); }
    await sleep(800);
    ok(q.day.goal && q.day.by === 'rules' && quick.late === 1, `at the default 400 ms the same answer is late: the scores decided and it is counted (${q.day.goal}, ${quick.late} late)`);
  }
}

// ---------- 4. the admin route ----------
{
  const PORT = 3771;
  const server = http.createServer((req, res) => { if (!res.handled) { res.writeHead(404); res.end('no'); } });
  const bots = { bots: [] };
  const minds = installAI({ bots, server }, { env: { BOT_DAY_PICK: 'mock' }, provider: null, tickMs: 0, log: () => {}, auth: async req => (req.headers.authorization === 'Bearer admin' ? 0 : 401) });
  minds.dayPick.provider = fake({ hunt: 0.55, restock: 0.45 });
  minds.dayPick.cfg.how = 'mock';
  await new Promise(r => server.listen(PORT, r));
  const call = async (path, method = 'GET', tok = 'admin') => { const r = await fetch(`http://localhost:${PORT}/api/admin/ai${path}`, { method, headers: tok ? { authorization: `Bearer ${tok}` } : {} }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  ok((await call('/day', 'GET', null)).status === 401, 'the decisions card is admins only');
  const g = await call('/day');
  ok(g.status === 200 && g.j.how === 'mock' && typeof g.j.line === 'string' && Array.isArray(g.j.models), `GET /api/admin/ai/day: the decider's status (${g.j.line})`);
  const t = await call('/day-test', 'POST');
  ok(t.status === 200 && t.j.test.ok === true && t.j.test.pick === 'hunt' && t.j.test.odds.hunt === 0.55, `POST /api/admin/ai/day-test: one real decision (${t.j.test.pick}, ${J(t.j.test.odds)})`);
  const post = async (path, body) => { const r = await fetch(`http://localhost:${PORT}/api/admin/ai${path}`, { method: 'POST', headers: { authorization: 'Bearer admin', 'content-type': 'application/json' }, body: J(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const off = await post('/day', { on: false });
  const sk = stub({ id: 31 });
  ok(off.status === 200 && off.j.adminOff === true && /turned off/.test(off.j.line) && bots.dayPick(sk, askOf(sk)) === false && minds.dayPick.status().skipped['turned off'] === 1,
    `the card's switch: off, and nobody is asked (${off.j.line})`);
  const on = await post('/day', { on: true });
  ok(on.status === 200 && on.j.adminOff === false && (await post('/day', {})).status === 400, 'and on again; a body without { on } is refused');
  ok((await call('/day', 'DELETE')).status === 405 && (await call('')).status === 200, 'the method is checked, and the companions card still answers');
  ok(typeof bots.dayPick === 'function' && bots.dayPick(stub(), askOf(stub())) === true, 'installAI gives the bot manager the hook every bot with a day calls');
  server.close();
}

console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
process.exit(failed ? 1 : 0);
