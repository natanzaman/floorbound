// Accounts, sessions, characters and "Sign in with Discord".
//
// - Guest: POST /api/guest gives a session token, kept in the browser. No password, no email.
// - Discord: /auth/discord -> Discord -> /auth/discord/callback -> back to the game with a session.
//   Signing in with Discord while playing as a guest links (or merges) the guest's characters.
// - Up to MAX_CHARACTERS characters per account; names are unique across the server.
import crypto from 'node:crypto';
import { q, enabled } from './db.js';
import { CLASSES, MAX_LEVEL } from '../shared/data.js';

export const MAX_CHARACTERS = 4;
const DISCORD_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_SECRET = process.env.DISCORD_CLIENT_SECRET;
export const discordEnabled = enabled && !!DISCORD_ID && !!DISCORD_SECRET;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

async function newSession(accountId) {
  const token = newToken();
  await q('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [sha(token), accountId]);
  return token;
}

export async function accountFromToken(token) {
  if (!enabled || !token || typeof token !== 'string' || token.length > 100) return null;
  const rows = await q(
    `UPDATE sessions s SET last_used = now() FROM accounts a
     WHERE s.token_hash = $1 AND a.id = s.account_id
     RETURNING a.id, a.discord_id, a.discord_name, a.discord_avatar`, [sha(token)]);
  return rows[0] || null;
}

export async function listCharacters(accountId) {
  return q('SELECT id, name, cls, lvl, xp FROM characters WHERE account_id = $1 ORDER BY created_at', [accountId]);
}

export async function loadCharacter(accountId, charId) {
  const rows = await q('SELECT id, name, cls, lvl, xp FROM characters WHERE id = $1 AND account_id = $2', [charId | 0, accountId]);
  return rows[0] || null;
}

export async function saveCharacter(charId, lvl, xp) {
  await q('UPDATE characters SET lvl = $2, xp = $3, updated_at = now() WHERE id = $1', [charId, Math.min(MAX_LEVEL, lvl), xp]);
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,14}[A-Za-z0-9]$/;

// ---------- HTTP routes ----------
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 4096) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});
const bearer = req => (req.headers.authorization || '').replace(/^Bearer /, '');
const origin = req => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

const oauthStates = new Map(); // state -> { link, at }
setInterval(() => { const cut = Date.now() - 10 * 60e3; for (const [k, v] of oauthStates) if (v.at < cut) oauthStates.delete(k); }, 60e3).unref();

// Returns true if it handled the request.
export async function handle(req, res, url) {
  if (url.pathname === '/api/config') return json(res, 200, { accounts: enabled, discord: discordEnabled, maxCharacters: MAX_CHARACTERS }), true;
  if (!enabled) return false;
  try {
    if (url.pathname === '/api/guest' && req.method === 'POST') {
      const [a] = await q('INSERT INTO accounts DEFAULT VALUES RETURNING id');
      return json(res, 200, { token: await newSession(a.id) }), true;
    }
    if (url.pathname === '/api/me') {
      const a = await accountFromToken(bearer(req));
      if (!a) return json(res, 401, { error: 'signed out' }), true;
      return json(res, 200, {
        account: { id: a.id, discord: a.discord_name, avatar: a.discord_avatar && a.discord_id ? `https://cdn.discordapp.com/avatars/${a.discord_id}/${a.discord_avatar}.png?size=64` : null },
        characters: await listCharacters(a.id),
      }), true;
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      await q('DELETE FROM sessions WHERE token_hash = $1', [sha(bearer(req))]);
      return json(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/characters' && req.method === 'POST') {
      const a = await accountFromToken(bearer(req));
      if (!a) return json(res, 401, { error: 'signed out' }), true;
      const { name: raw, cls } = await readBody(req);
      const name = String(raw || '').trim().replace(/\s+/g, ' ');
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'Names are 3–16 letters or numbers (spaces, _ . - allowed inside).' }), true;
      if (!CLASSES[cls]) return json(res, 400, { error: 'Pick a class.' }), true;
      const [{ n }] = await q('SELECT count(*)::int AS n FROM characters WHERE account_id = $1', [a.id]);
      if (n >= MAX_CHARACTERS) return json(res, 400, { error: `You can have up to ${MAX_CHARACTERS} characters.` }), true;
      try {
        const [c] = await q('INSERT INTO characters (account_id, name, cls) VALUES ($1, $2, $3) RETURNING id, name, cls, lvl, xp', [a.id, name, cls]);
        return json(res, 200, { character: c }), true;
      } catch (e) {
        if (e.code === '23505') return json(res, 409, { error: 'That name is taken.' }), true;
        throw e;
      }
    }
    const del = url.pathname.match(/^\/api\/characters\/(\d+)$/);
    if (del && req.method === 'DELETE') {
      const a = await accountFromToken(bearer(req));
      if (!a) return json(res, 401, { error: 'signed out' }), true;
      await q('DELETE FROM characters WHERE id = $1 AND account_id = $2', [+del[1], a.id]);
      return json(res, 200, { ok: true }), true;
    }

    // ---------- Sign in with Discord ----------
    if (url.pathname === '/auth/discord') {
      if (!discordEnabled) return json(res, 404, { error: 'Discord sign-in is not set up on this server.' }), true;
      const state = newToken();
      oauthStates.set(state, { link: url.searchParams.get('link') || null, at: Date.now() });
      const p = new URLSearchParams({ client_id: DISCORD_ID, redirect_uri: `${origin(req)}/auth/discord/callback`, response_type: 'code', scope: 'identify', state, prompt: 'none' });
      res.writeHead(302, { location: `https://discord.com/oauth2/authorize?${p}` }); res.end();
      return true;
    }
    if (url.pathname === '/auth/discord/callback') {
      const st = oauthStates.get(url.searchParams.get('state') || '');
      oauthStates.delete(url.searchParams.get('state') || '');
      const code = url.searchParams.get('code');
      if (!st || !code) { res.writeHead(302, { location: '/#signin=cancelled' }); res.end(); return true; }
      const tok = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: DISCORD_ID, client_secret: DISCORD_SECRET, grant_type: 'authorization_code', code, redirect_uri: `${origin(req)}/auth/discord/callback` }),
      }).then(r => r.json());
      if (!tok.access_token) { res.writeHead(302, { location: '/#signin=failed' }); res.end(); return true; }
      const me = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
      if (!me.id) { res.writeHead(302, { location: '/#signin=failed' }); res.end(); return true; }
      const display = me.global_name || me.username;
      let [acct] = await q('SELECT id FROM accounts WHERE discord_id = $1', [me.id]);
      const guest = st.link ? await accountFromToken(st.link) : null;
      if (guest && !guest.discord_id) {
        if (!acct) { // the guest account becomes this Discord account
          await q('UPDATE accounts SET discord_id = $2 WHERE id = $1', [guest.id, me.id]);
          acct = { id: guest.id };
        } else { // already have a Discord account: bring the guest's characters over
          await q('UPDATE characters SET account_id = $1 WHERE account_id = $2', [acct.id, guest.id]);
          await q('DELETE FROM accounts WHERE id = $1', [guest.id]);
        }
      }
      if (!acct) [acct] = await q('INSERT INTO accounts (discord_id) VALUES ($1) RETURNING id', [me.id]);
      await q('UPDATE accounts SET discord_name = $2, discord_avatar = $3, last_seen = now() WHERE id = $1', [acct.id, display, me.avatar || null]);
      const session = await newSession(acct.id);
      res.writeHead(302, { location: `/#session=${session}` }); res.end();
      return true;
    }
  } catch (e) {
    console.error('accounts error', e);
    json(res, 500, { error: 'Server error' });
    return true;
  }
  return false;
}
