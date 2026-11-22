// Admin API for the floor towns (server/towns.js), used by the "Towns" card on the admin page (public/admin-towns.js).
//   GET   /api/admin/towns                 every town: stage, XP, treasury, project, Steward, raid timer, election
//   POST  /api/admin/towns/<floor>         { op: 'stage', stage } | { op: 'xp', xp } | { op: 'close' } (close the election now)
//                                          | { op: 'raid' } (start a raid now, with its warning) | { op: 'endraid', won }
// Admins only (the same check as the Director: a server without accounts answers the same machine).
import { directorAuth } from './director-admin.js';
import { STAGES, TOWN_FLOORS } from '../shared/towns.js';

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 4 * 1024) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
});

export function installTownsAdmin({ server, game }, { auth = directorAuth } = {}) {
  server.prependListener('request', (req, res) => {
    if (!/^\/api\/admin\/towns(\/|\?|$)/.test(req.url)) return;
    res.handled = true; // (claimed before the main handler)
    handle(req, res).catch(err => { console.error('[towns] admin', err); if (!res.headersSent) json(res, 500, { error: 'Server error.' }); });
  });

  async function handle(req, res) {
    const code = await auth(req);
    if (code) return json(res, code, { error: code === 401 ? 'Signed out.' : code === 403 ? 'Admins only.' : 'Admin needs accounts (set DATABASE_URL).' });
    const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/\/$/, ''), m = req.method;
    if (p === '/api/admin/towns' && m === 'GET') return json(res, 200, { towns: game.townsAdmin(), stages: STAGES });
    const mm = p.match(/^\/api\/admin\/towns\/(\d+)$/);
    if (!mm || m !== 'POST') return json(res, 404, { error: 'Unknown route.' });
    const f = +mm[1];
    if (!TOWN_FLOORS.includes(f)) return json(res, 404, { error: 'No town on that floor.' });
    const body = await readBody(req);
    if (!body) return json(res, 400, { error: 'Bad JSON.' });
    const T = game.town(f);
    switch (body.op) {
      case 'stage': { const s = body.stage | 0; if (!STAGES[s]) return json(res, 400, { error: 'No such stage.' }); game.townSetXp(f, STAGES[s].xp); break; }
      case 'xp': { const x = +body.xp; if (!Number.isFinite(x) || x < 0) return json(res, 400, { error: 'XP must be 0 or more.' }); game.townSetXp(f, x); break; }
      case 'close': if (T.tour) return json(res, 409, { error: 'A tournament is already running.' }); game.electionClose(f); break;
      case 'raid': if (T.raid) return json(res, 409, { error: 'A raid is already on.' }); if (!game.raidStart(f)) return json(res, 409, { error: 'Not now: a director show is running.' }); break;
      case 'endraid': if (!T.raid) return json(res, 409, { error: 'No raid is on.' }); game.raidEnd(T, body.won ? 'won' : 'lost'); break;
      default: return json(res, 400, { error: 'Unknown op.' });
    }
    return json(res, 200, { towns: game.townsAdmin(), stages: STAGES });
  }
}
