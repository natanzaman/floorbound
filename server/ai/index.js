// AI companions: wiring. server/index.js calls installAI({ game, bots, server }) once.
//   - registers the mind on the bot brain's onEvent hook (shared/bots/registry.js)
//   - ticks the minds once a second (BotManager's bots)
//   - serves GET /api/admin/ai (status), POST /api/admin/ai { on } (toggle) and POST /api/admin/ai/test (one tiny real
//     call: OK/error, latency, cost) and POST /api/admin/ai/named-test (the same for Named talk, in Cairn's voice),
//     admins only
//   - tells clients when a bot is thinking about a line said to it ({ t: 'mind', id, on, party } in game.events)
//   - memories and the day's spend survive restarts once index.js calls minds.useStore(makeStore(db.q)) after migrate
// Nothing here runs a model unless AI_PROVIDER, its key and the toggle are all set (the test call needs provider + key).
import { registerBotHook } from '../../shared/bots/registry.js';
import { readConfig } from './config.js';
import { makeProvider } from './providers/index.js';
import { Minds } from './mind.js';
import { installNamedTalk } from './namedtalk.js'; // talking to the Named (I3)
import * as accounts from '../accounts.js';
import { isAdmin } from '../admin.js';

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 4096) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
});

async function adminAuth(req) {
  const a = await accounts.accountFromToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!a) return 401;
  return (await isAdmin(a)) ? 0 : 403;
}

// opts (tests): env, provider, auth(req) -> 0 | 401 | 403, now, log, tickMs (0 = no timer)
export function installAI({ game = null, bots, server = null }, opts = {}) {
  const env = opts.env || process.env;
  const cfg = readConfig(env);
  const provider = opts.provider || makeProvider(cfg, { env });
  const listBots = () => (bots?.bots || []).filter(e => !e.b.closed && !e.director && !e.named).map(e => e.b); // (never the director's actors)
  const onThink = game ? (b, on) => { if (b.id) game.events.push({ t: 'mind', id: b.id, on: on ? 1 : 0, party: b.party || 0 }); } : null;
  const minds = new Minds({ cfg, provider, listBots, env, now: opts.now, log: opts.log, onThink });
  if (game) game.aiOn = () => minds.active(); // (welcome: lets the client show the "talk to bots by name" tip)
  if (game?.named) minds.namedTalk = installNamedTalk({ game, minds }); // (NAMED_ENABLED=0: no Named, nothing to talk to)
  registerBotHook('onEvent', (b, e) => minds.onEvent(b, e));
  const tickMs = opts.tickMs ?? 1000;
  if (tickMs) { const t = setInterval(() => { try { minds.tick(); } catch (err) { console.error('[ai] tick', err); } }, tickMs); t.unref?.(); minds.timer = t; }

  const auth = opts.auth || adminAuth;
  if (server) {
    // Runs before the main request handler; claims /api/admin/ai synchronously (res.handled) so it isn't 404'd.
    server.prependListener('request', (req, res) => {
      if (!req.url.startsWith('/api/admin/ai') || !/^\/api\/admin\/ai(\/test|\/named-test)?\/?(\?.*)?$/.test(req.url)) return;
      res.handled = true;
      handle(req, res).catch(err => { console.error('[ai] admin', err); if (!res.headersSent) json(res, 500, { error: 'Server error.' }); });
    });
  }
  async function handle(req, res) {
    const code = await auth(req);
    if (code) return json(res, code, { error: code === 401 ? 'Signed out.' : 'Admins only.' });
    if (/^\/api\/admin\/ai\/named-test/.test(req.url)) {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST.' });
      if (!minds.namedTalk) return json(res, 400, { error: 'The Named are off (NAMED_ENABLED=0).', ...minds.status() });
      const r = await minds.namedTalk.testCall();
      return json(res, 200, { test: r, ...minds.status() });
    }
    if (/^\/api\/admin\/ai\/test/.test(req.url)) {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST.' });
      const r = await minds.testCall();
      return json(res, 200, { test: r, ...minds.status() });
    }
    if (req.method === 'GET') return json(res, 200, minds.status());
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body.on !== 'boolean') return json(res, 400, { error: 'Send { "on": true | false }.' });
      const r = minds.setEnabled(body.on);
      return json(res, r.ok ? 200 : 400, r.ok ? minds.status() : { error: r.error, ...minds.status() });
    }
    return json(res, 405, { error: 'GET or POST.' });
  }
  return minds;
}
