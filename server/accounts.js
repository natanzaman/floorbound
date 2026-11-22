// Accounts, sessions, characters and "Sign in with Discord".
//
// - Guest: POST /api/guest gives a session token, kept in the browser. No password, no email.
// - Discord: /auth/discord -> Discord -> /auth/discord/callback (a tiny page) -> POST /api/discord -> session.
//   Uses Discord's token flow, so no client secret is needed: the server asks Discord who the token
//   belongs to and checks it was issued to OUR app before trusting it.
//   Signing in with Discord while playing as a guest links (or merges) the guest's characters.
// - Up to MAX_CHARACTERS characters per account; names are unique across the server.
import crypto from 'node:crypto';
import * as db from './db.js';
const q = (...a) => db.q(...a);
import { MAX_LEVEL } from '../shared/data.js';
import { isNamedName } from '../shared/named.js';
import { WEAPONS, newPath, isWeapon, isClass } from '../shared/academy.js';
import { cleanControls, CONTROLS_MAX_BYTES } from '../shared/controls.js';
import { cleanAllow, ALLOW_CREATOR, ALLOW_MAX } from '../shared/accesslevels.js';

export const MAX_CHARACTERS = 8;
const DISCORD_ID = process.env.DISCORD_CLIENT_ID;
export const discordOn = () => db.enabled && !!DISCORD_ID;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

async function newSession(accountId) {
  const token = newToken();
  await q('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [sha(token), accountId]);
  return token;
}

export async function accountFromToken(token) {
  if (!db.enabled || !token || typeof token !== 'string' || token.length > 100) return null;
  const rows = await q(
    `UPDATE sessions s SET last_used = now() FROM accounts a
     WHERE s.token_hash = $1 AND a.id = s.account_id
     RETURNING a.id, a.discord_id, a.discord_name, a.discord_avatar, a.access_level`, [sha(token)]);
  return rows[0] || null;
}

// An allow list from what someone typed or sent (shared/accesslevels.js): names or character ids (a comma / newline
// list, or an array; entries already resolved, { id, name }, are checked again), and 'creator' / 'me' for "Just me".
// Every name or id must be a saved character (case-insensitive name): an unknown one throws, so a typo never opens a
// bot up or names a stranger. Returns cleanAllow entries { id, name }. Without accounts only "Just me" (or empty) works.
export async function resolveAllow(input) {
  const raw = (Array.isArray(input) ? input : String(input ?? '').split(/[,\n]/)).map(v => (typeof v === 'object' && v ? String(v.id ?? v.name ?? '') : String(v ?? '')).trim()).filter(Boolean);
  if (raw.length > ALLOW_MAX) throw new AllowError(`At most ${ALLOW_MAX} names.`);
  const out = [], want = [];
  for (const v of raw) {
    if (/^(creator|me|just me|just the creator)$/i.test(v)) out.push({ id: ALLOW_CREATOR });
    else want.push(v);
  }
  if (want.length) {
    if (!db.enabled) throw new AllowError('Allow lists name saved characters, and this server has no accounts.');
    const ids = want.filter(v => /^#?\d{1,10}$/.test(v)).map(v => Number(v.replace('#', '')));
    const names = want.filter(v => !/^#?\d{1,10}$/.test(v)).map(v => v.toLowerCase());
    const rows = await q('SELECT id, name FROM characters WHERE id = ANY($1::int[]) OR lower(name) = ANY($2::text[])', [ids, names]);
    for (const v of want) {
      const n = v.replace('#', ''), r = rows.find(r => (/^\d+$/.test(n) && r.id === Number(n)) || r.name.toLowerCase() === v.toLowerCase());
      if (!r) throw new AllowError(`No saved character called "${v.slice(0, 20)}".`);
      out.push({ id: String(r.id), name: r.name });
    }
  }
  return cleanAllow(out);
}
export class AllowError extends Error { constructor(msg) { super(msg); this.code = 400; } }

export async function listCharacters(accountId) {
  return q('SELECT id, name, cls, lvl, xp, path FROM characters WHERE account_id = $1 ORDER BY created_at', [accountId]);
}

export async function loadCharacter(accountId, charId) {
  const rows = await q('SELECT id, name, cls, lvl, xp, gold, inv, stats, mastery, talents, path FROM characters WHERE id = $1 AND account_id = $2', [charId | 0, accountId]);
  return rows[0] || null;
}

// p: an in-game player with charId, lvl, xp, gold, inv, stats (lifetime stats + titles), mastery (skill mastery + evolutions), talents (talent tree),
// cls and path (the Academy: an Initiate or graduated; null for characters from before it). During a class trial the
// loaned kit is never saved: p.loan holds the real class, mastery and talents (server/academy.js).
export async function saveCharacter(p) {
  const real = p.loan || p;
  await q('UPDATE characters SET lvl = $2, xp = $3, gold = $4, inv = $5, stats = $6, mastery = $7, talents = $8, cls = $9, path = $10, updated_at = now() WHERE id = $1',
    [p.charId, Math.min(MAX_LEVEL, p.lvl), p.xp, Math.max(0, p.gold | 0), JSON.stringify(p.inv), JSON.stringify(p.stats || null), JSON.stringify(real.mastery || null), JSON.stringify(real.talents || null), real.cls || p.cls, p.path ? JSON.stringify(p.path) : null]);
}

// Controls that follow the account (roadmap K2): the whole fb_controls object, cleaned (unknown ids dropped), with a
// `v` field, at most CONTROLS_MAX_BYTES. null: nothing saved yet.
export async function loadSettings(accountId) {
  return (await loadSettingsAt(accountId)).settings;
}
// { settings, at }: the saved copy and when its change was made (ms, server clock; 0: not known).
export async function loadSettingsAt(accountId) {
  const rows = await q('SELECT settings, settings_at FROM accounts WHERE id = $1', [accountId]);
  return { settings: rows[0]?.settings ?? null, at: Number(rows[0]?.settings_at) || 0 };
}
// Returns { ok, settings, at } or { error, code } (400: not a controls object / no v; 413: too big; 409: the saved copy's
// change is newer than this one, with that copy as { settings, at }). `at`: when the change was made (ms, server clock,
// as the browser estimates it); a change from the future counts as now. No `at` (an older page): saved, as now.
export async function storeSettings(accountId, raw, at) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Number.isInteger(raw.v)) return { error: 'Not a controls object.', code: 400 };
  if (Buffer.byteLength(JSON.stringify(raw)) > CONTROLS_MAX_BYTES) return { error: 'Settings too big.', code: 413 };
  const clean = cleanControls(raw);
  if (Buffer.byteLength(JSON.stringify(clean)) > CONTROLS_MAX_BYTES) return { error: 'Settings too big.', code: 413 };
  const now = Date.now(), when = Number.isFinite(at) && at > 0 ? Math.min(Math.round(at), now) : now;
  // Saved only when no newer change is there (one statement, so two uploads at once can't both win).
  const rows = await q(`UPDATE accounts SET settings = $2, settings_at = $3 WHERE id = $1 AND (settings_at IS NULL OR settings_at <= $3)
    RETURNING id`, [accountId, JSON.stringify(clean), when]);
  if (rows.length) return { ok: true, settings: clean, at: when };
  const cur = await loadSettingsAt(accountId);
  if (!cur.at) return { error: 'No such account.', code: 404 };
  return { error: 'A newer copy is saved.', code: 409, ...cur };
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,14}[A-Za-z0-9]$/;

// ---------- HTTP routes ----------
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 4096) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});
// (a body over max: { tooBig } once it has arrived, so the 413 still gets out; far over it, the connection is cut)
const readCapped = (req, max) => new Promise(resolve => {
  let s = '', n = 0;
  req.on('data', c => { n += c.length; if (n <= max) s += c; else if (n > max * 8) req.destroy(); });
  req.on('end', () => { if (n > max) return resolve({ tooBig: true }); try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});
const bearer = req => (req.headers.authorization || '').replace(/^Bearer /, '');
const origin = req => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>Signing in…</title>
<body style="background:#0b1020;color:#eef3ff;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">Signing in…
<script>
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get('access_token')) location.replace('/#signin=cancelled');
  else fetch('/api/discord', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: h.get('access_token'), state: h.get('state') }) })
    .then(r => r.json()).then(b => location.replace(b.session ? '/#session=' + b.session : '/#signin=failed'))
    .catch(() => location.replace('/#signin=failed'));
</script>`;

const oauthStates = new Map(); // state -> { link, at }
setInterval(() => { const cut = Date.now() - 10 * 60e3; for (const [k, v] of oauthStates) if (v.at < cut) oauthStates.delete(k); }, 60e3).unref();

// Returns true if it handled the request.
export async function handle(req, res, url) {
  if (url.pathname === '/api/config') return json(res, 200, { accounts: db.enabled, discord: discordOn(), maxCharacters: MAX_CHARACTERS }), true;
  if (!db.enabled) return false;
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
    if (url.pathname === '/api/settings') { // GET: { settings, at, now } (null: none yet) · PUT { settings, at }: save (409: a newer copy)
      const a = await accountFromToken(bearer(req));
      if (!a) return json(res, 401, { error: 'signed out' }), true;
      if (req.method === 'GET') return json(res, 200, { ...await loadSettingsAt(a.id), now: Date.now() }), true;
      if (req.method !== 'PUT') return json(res, 405, { error: 'GET or PUT' }), true;
      const body = await readCapped(req, CONTROLS_MAX_BYTES + 512); // (the 8 KB object plus its { "settings": } wrapper)
      if (body.tooBig) return json(res, 413, { error: 'Settings too big.' }), true;
      const r = await storeSettings(a.id, body.settings, body.at);
      if (r.code === 409) return json(res, 409, { error: r.error, settings: r.settings, at: r.at, now: Date.now() }), true; // (the newer copy, to apply)
      return json(res, r.code || 200, r.error ? { error: r.error } : { ok: true, at: r.at, now: Date.now() }), true;
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      await q('DELETE FROM sessions WHERE token_hash = $1', [sha(bearer(req))]);
      return json(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/characters' && req.method === 'POST') {
      const a = await accountFromToken(bearer(req));
      if (!a) return json(res, 401, { error: 'signed out' }), true;
      const { name: raw, cls: clsIn, weapon } = await readBody(req); // a weapon: a new Initiate (docs/briefs/academy.md); a cls alone: graduated in it (admin tools, tests)
      const cls = isWeapon(weapon) ? WEAPONS[weapon].base : clsIn, path = isWeapon(weapon) ? JSON.stringify(newPath(weapon)) : null;
      const name = String(raw || '').trim().replace(/\s+/g, ' ');
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'Names are 3–16 letters or numbers (spaces, _ . - allowed inside).' }), true;
      if (!isClass(cls)) return json(res, 400, { error: 'Pick a weapon.' }), true;
      if (process.env.NAMED_ENABLED !== '0' && isNamedName(name)) return json(res, 409, { error: 'That name is taken.' }), true; // the Named's names are theirs (shared/named.js)
      const [{ n }] = await q('SELECT count(*)::int AS n FROM characters WHERE account_id = $1', [a.id]);
      if (n >= MAX_CHARACTERS) return json(res, 400, { error: `You can have up to ${MAX_CHARACTERS} characters.` }), true;
      try {
        const [c] = await q('INSERT INTO characters (account_id, name, cls, path) VALUES ($1, $2, $3, $4) RETURNING id, name, cls, lvl, xp, path', [a.id, name, cls, path]);
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
      if (!discordOn()) return json(res, 404, { error: 'Discord sign-in is not set up on this server.' }), true;
      const state = newToken();
      oauthStates.set(state, { link: url.searchParams.get('link') || null, at: Date.now() });
      const p = new URLSearchParams({ client_id: DISCORD_ID, redirect_uri: `${origin(req)}/auth/discord/callback`, response_type: 'token', scope: 'identify', state, prompt: 'none' });
      res.writeHead(302, { location: `https://discord.com/oauth2/authorize?${p}` }); res.end();
      return true;
    }
    if (url.pathname === '/auth/discord/callback') { // Discord puts the token in the URL fragment, which only the browser sees
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(CALLBACK_PAGE);
      return true;
    }
    if (url.pathname === '/api/discord' && req.method === 'POST') {
      if (!discordOn()) return json(res, 404, { error: 'Discord sign-in is not set up.' }), true;
      const { access_token, state } = await readBody(req);
      const st = oauthStates.get(state || '');
      oauthStates.delete(state || '');
      if (!st || !access_token) return json(res, 400, { error: 'Sign-in expired, try again.' }), true;
      // Who does this token belong to, and was it issued to our app?
      const info = await fetch('https://discord.com/api/oauth2/@me', { headers: { authorization: `Bearer ${access_token}` } }).then(r => r.json());
      const me = info.user;
      if (!me?.id || info.application?.id !== DISCORD_ID) return json(res, 401, { error: 'Discord sign-in failed.' }), true;
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
      return json(res, 200, { session: await newSession(acct.id) }), true;
    }
  } catch (e) {
    console.error('accounts error', e);
    json(res, 500, { error: 'Server error' });
    return true;
  }
  return false;
}
