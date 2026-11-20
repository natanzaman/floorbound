// Admin API for the Named (server/named.js), used by "The Named" card on the admin page's Bots tab (public/admin-named.js).
//   GET   /api/admin/named                   the five characters (online, level, offset, where, what), the levels they
//                                            follow, and every character's friendship with them
//   POST  /api/admin/named/<id>/spawn        let one back into the world ("all" for everyone); they only appear while
//   POST  /api/admin/named/<id>/despawn      a player is online. Despawn sends one home until spawned again.
//                                            (back, one rejoins the player's party they were in when despawned, if it's
//                                            still there with room; the switch survives a restart)
//   POST  /api/admin/named/<id>/allow        { allow: [names or character ids] | 'a, b' }  who may control them (saved characters only)
//                                            besides access 3+ (shared/accesslevels.js); [] = anyone
//   POST  /api/admin/named/offset            { off, reset? }  levels above the top players (reset: work it out afresh)
//   POST  /api/admin/named/friendship        { charId, id, pts }  set one character's friendship (0-100)
// Admins only (the same check as the Director: a server without accounts answers the same machine).
import { directorAuth } from './director-admin.js';
import { resolveAllow } from './accounts.js';
import { NAMED_BY_ID, TIERS, tierIndex } from '../shared/named.js';

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 16 * 1024) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
});

export function installNamedAdmin({ server, named }, { auth = directorAuth } = {}) {
  server.prependListener('request', (req, res) => {
    if (!/^\/api\/admin\/named(\/|\?|$)/.test(req.url)) return;
    res.handled = true; // (claimed before the main handler)
    handle(req, res).catch(err => { console.error('[named] admin', err); if (!res.headersSent) json(res, 500, { error: 'Server error.' }); });
  });

  async function friends() { // one row per character: { charId, name, lvl, f: { namedId: pts } }
    const by = new Map();
    const row = (charId, name, lvl) => { if (!by.has(charId)) by.set(charId, { charId, name, lvl, f: {} }); return by.get(charId); };
    if (named.store) for (const r of await named.store.listFriends()) row(r.char_id, r.name, r.lvl).f[r.named_id] = +r.pts;
    for (const p of named.humans()) { // online: the live numbers (anonymous players too, without an id)
      const m = named.friends.get(named.keyOf(p));
      if (!m?.size) continue;
      const r = p.charId ? row(p.charId, p.name, p.lvl) : row(`s${p.id}`, `${p.name} (anonymous)`, p.lvl);
      r.online = true;
      for (const [id, rec] of m) r.f[id] = rec.pts;
    }
    return [...by.values()];
  }

  async function handle(req, res) {
    const code = await auth(req);
    if (code) return json(res, code, { error: code === 401 ? 'Signed out.' : code === 403 ? 'Admins only.' : 'Admin needs accounts (set DATABASE_URL).' });
    const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/\/$/, ''), m = req.method;
    if (!named) return json(res, 200, { on: false, chars: [], friends: [], tiers: TIERS });
    try {
      if (p === '/api/admin/named' && m === 'GET') return json(res, 200, { ...named.adminView(), friends: await friends(), tiers: TIERS });
      if (m !== 'POST') return json(res, 404, { error: 'Unknown route.' });
      const body = await readBody(req);
      if (!body) return json(res, 400, { error: 'Bad JSON.' });
      let mm;
      if ((mm = p.match(/^\/api\/admin\/named\/([a-z]+)\/(spawn|despawn)$/))) {
        const ids = mm[1] === 'all' ? Object.keys(NAMED_BY_ID) : [mm[1]];
        if (!ids.every(id => NAMED_BY_ID[id])) return json(res, 404, { error: 'Nobody by that name.' });
        for (const id of ids) named.setEnabled(id, mm[2] === 'spawn');
        return json(res, 200, named.adminView());
      }
      if ((mm = p.match(/^\/api\/admin\/named\/([a-z]+)\/allow$/))) {
        if (!NAMED_BY_ID[mm[1]]) return json(res, 404, { error: 'Nobody by that name.' });
        named.setAllow(mm[1], await resolveAllow(body.allow ?? [])); // names -> character ids (unknown: 400)
        return json(res, 200, named.adminView());
      }
      if (p === '/api/admin/named/offset') {
        const off = Number(body.off);
        if (!Number.isInteger(off) || off < -10 || off > 30) return json(res, 400, { error: 'The offset is a whole number from -10 to 30.' });
        named.setOffset(off, { reset: !!body.reset });
        return json(res, 200, named.adminView());
      }
      if (p === '/api/admin/named/friendship') {
        const charId = Number(body.charId), pts = Number(body.pts);
        if (!Number.isInteger(charId) || charId < 1 || !NAMED_BY_ID[body.id] || !(pts >= 0 && pts <= 100)) return json(res, 400, { error: 'Give a character id, one of the Named and 0-100 points.' });
        if (named.store && !(await named.store.charExists(charId))) return json(res, 404, { error: 'No such character.' });
        const out = await named.setFriendship(charId, body.id, pts);
        return json(res, 200, { ...out, tierIndex: tierIndex(out.pts) });
      }
      return json(res, 404, { error: 'Unknown route.' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
}
