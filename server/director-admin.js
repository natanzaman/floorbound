// Admin API for the scene director (server/director.js), used by the Director tab of /admin.html (public/admin-director.js).
//   GET  /api/admin/director              status, plus the loaded sheet's text and its validation
//   GET  /api/admin/director/sheets       the cue sheets in docs/story/*.yaml (read-only)
//   GET  /api/admin/director/sheets/<f>   one sheet's text
//   POST /api/admin/director/load         { text }            parse + validate (doesn't run)
//   POST /api/admin/director/run          { from, force }     from: scene id or 0-based index
//   POST /api/admin/director/stop
// Admins only. A server without a database (no accounts at all: the local filming setup, docs/story/FILMING.md) accepts
// these from the same machine (loopback) instead.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import * as accounts from './accounts.js';
import { isAdmin } from './admin.js';

const STORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/story');
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 256 * 1024) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
});
const loopback = req => /^(127\.|::1$|::ffff:127\.)/.test(req.socket?.remoteAddress || '');

// 0 = allowed, else an HTTP status
export async function directorAuth(req) {
  if (!db.enabled) return loopback(req) ? 0 : 503;
  const a = await accounts.accountFromToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!a) return 401;
  return (await isAdmin(a)) ? 0 : 403;
}

export function installDirectorAdmin({ server, director }, { auth = directorAuth } = {}) {
  server.prependListener('request', (req, res) => {
    if (!/^\/api\/admin\/director(\/|\?|$)/.test(req.url)) return;
    res.handled = true; // (claimed before the main handler)
    handle(req, res).catch(err => { console.error('[director] admin', err); if (!res.headersSent) json(res, 500, { error: 'Server error.' }); });
  });

  async function handle(req, res) {
    const code = await auth(req);
    if (code) return json(res, code, { error: code === 401 ? 'Signed out.' : code === 403 ? 'Admins only.' : 'This server has no accounts: use the Director from the same machine (localhost).' });
    const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/\/$/, ''), m = req.method;
    try {
      if (p === '/api/admin/director' && m === 'GET') {
        return json(res, 200, { ...director.status(), text: director.text, check: director.sheet ? director.validate() : null, local: !db.enabled });
      }
      if (p === '/api/admin/director/sheets' && m === 'GET') {
        const files = (await fs.readdir(STORY).catch(() => [])).filter(f => /\.ya?ml$/.test(f)).sort();
        return json(res, 200, { sheets: files });
      }
      let mm;
      if ((mm = p.match(/^\/api\/admin\/director\/sheets\/([\w.-]+\.ya?ml)$/)) && m === 'GET') {
        const text = await fs.readFile(path.join(STORY, mm[1]), 'utf8').catch(() => null);
        return text === null ? json(res, 404, { error: 'No such sheet.' }) : json(res, 200, { name: mm[1], text });
      }
      if (m === 'POST' && ['/api/admin/director/load', '/api/admin/director/run', '/api/admin/director/stop'].includes(p)) {
        const body = await readBody(req);
        if (!body) return json(res, 400, { error: 'Bad JSON.' });
        if (p.endsWith('/load')) return json(res, 200, director.load(String(body.text ?? '')));
        if (p.endsWith('/run')) return json(res, 200, director.run({ from: body.from ?? 0, force: !!body.force }));
        return json(res, 200, director.stop('Stopped from the admin page.'));
      }
      return json(res, 404, { error: 'Unknown director route.' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
}
