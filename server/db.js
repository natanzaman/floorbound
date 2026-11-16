// Postgres access (Neon in production). Accounts are optional: without DATABASE_URL the game
// runs in anonymous mode (local dev, bots) and nothing is saved.
import pg from 'pg';

// Accept the raw URL, or a pasted snippet such as  psql 'postgresql://...'  (Neon's "Copy snippet").
const raw = (process.env.DATABASE_URL || '').trim();
const url = (raw.match(/postgres(?:ql)?:\/\/[^\s'"]+/) || [raw])[0] || '';
export let enabled = !!url;

const local = url && /@(localhost|127\.0\.0\.1)|host=\/|sslmode=disable/.test(url);
// Let our ssl setting win over sslmode/channel_binding in the URL (Neon requires TLS either way).
const cleanUrl = local ? url : url.replace(/([?&])(sslmode|channel_binding)=[^&]*&?/g, '$1').replace(/[?&]$/, '');
const pool = enabled ? new pg.Pool({
  connectionString: cleanUrl, ssl: local ? false : { rejectUnauthorized: false }, max: 5,
  connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
}) : null;
pool?.on('error', err => console.error('Postgres pool error:', err.message));

export const q = (text, params) => pool.query(text, params).then(r => r.rows);

export async function migrate() {
  if (!enabled) return;
  let host = '?';
  try { host = new URL(cleanUrl).hostname || 'local socket'; } catch { host = 'unreadable DATABASE_URL (expected postgresql://...)'; }
  console.log(`Connecting to database at ${host}`);
  try { await setup(); console.log('Database connected.'); }
  catch (err) { // keep the game up without accounts rather than crash-looping
    console.error('Database unavailable, running without accounts:', err.message);
    enabled = false;
  }
}

async function setup() {
  await q(`CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY, discord_id TEXT UNIQUE, discord_name TEXT, discord_avatar TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS characters (
    id SERIAL PRIMARY KEY, account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, cls TEXT NOT NULL, lvl INT NOT NULL DEFAULT 1, xp INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS characters_name_unique ON characters (lower(name))`);
}
