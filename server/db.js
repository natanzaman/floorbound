// Postgres access (Neon in production). Accounts are optional: without DATABASE_URL the game
// runs in anonymous mode (local dev, bots) and nothing is saved.
import pg from 'pg';

const url = process.env.DATABASE_URL;
export const enabled = !!url;

const local = url && /@(localhost|127\.0\.0\.1)|host=\/|sslmode=disable/.test(url);
const pool = enabled ? new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 }) : null;

export const q = (text, params) => pool.query(text, params).then(r => r.rows);

export async function migrate() {
  if (!enabled) return;
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
