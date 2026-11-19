// Postgres access (Neon in production). Accounts are optional: without DATABASE_URL the game
// runs in anonymous mode (local dev, bots) and nothing is saved.
import pg from 'pg';

// Accept the raw URL, or a pasted snippet such as  psql 'postgresql://...'  (Neon's "Copy snippet").
const raw = (process.env.DATABASE_URL || '').trim();
const url = (raw.match(/postgres(?:ql)?:\/\/[^\s'"]+/) || [raw])[0] || '';
export let enabled = !!url;

const local = url && /(@|\/\/)(localhost|127\.0\.0\.1)([:/]|$)|host=\/|sslmode=disable/.test(url); // (also postgresql://localhost/db, no user)
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
  await q(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS gold INT NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS inv JSONB`);
  await q(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS stats JSONB`);
  await q(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS mastery JSONB`); // skill mastery + chosen evolutions
  await q(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS talents JSONB`); // talent tree ranks { nodeId: rank } (shared/talents.js)
  await q(`CREATE TABLE IF NOT EXISTS floor_clears (
    id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), floor INT NOT NULL, secs INT NOT NULL,
    players JSONB, last_attack TEXT, deaths INT NOT NULL DEFAULT 0)`);
  await q(`CREATE INDEX IF NOT EXISTS floor_clears_secs ON floor_clears (secs, id)`);
  await q(`CREATE TABLE IF NOT EXISTS play_events (
    id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), account_id INT, char_id INT, sid TEXT,
    kind TEXT NOT NULL, data JSONB)`);
  await q(`CREATE INDEX IF NOT EXISTS play_events_kind_at ON play_events (kind, at)`);
  await q(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`); // admin page (server/admin.js)
  // AI companions (server/ai/store.js): each bot's notes about each player (capped, pruned), and spend per UTC day
  await q(`CREATE TABLE IF NOT EXISTS ai_memories (
    bot TEXT NOT NULL, player TEXT NOT NULL, notes JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (bot, player))`);
  await q(`CREATE INDEX IF NOT EXISTS ai_memories_updated ON ai_memories (updated_at)`);
  await q(`CREATE TABLE IF NOT EXISTS ai_spend (
    day DATE PRIMARY KEY, usd DOUBLE PRECISION NOT NULL DEFAULT 0, calls INT NOT NULL DEFAULT 0)`);
  // Talk with the Named (server/ai/namedtalk.js): their notes about player characters live beside the companions' (kind
  // 'named', capped and pruned apart), and the day's spend keeps the part that was Named talk.
  await q(`ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'bot'`);
  await q(`CREATE INDEX IF NOT EXISTS ai_memories_kind ON ai_memories (kind, updated_at)`);
  await q(`ALTER TABLE ai_spend ADD COLUMN IF NOT EXISTS named_usd DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE ai_spend ADD COLUMN IF NOT EXISTS named_calls INT NOT NULL DEFAULT 0`);
  // The Named (server/named.js): each character's level and switch, and each player character's friendship with them.
  // Their own clears are kept apart in the Hall (floor_clears.heroes).
  await q(`CREATE TABLE IF NOT EXISTS named_chars (
    id TEXT PRIMARY KEY, lvl INT NOT NULL DEFAULT 1, lvl_off INT NOT NULL DEFAULT 2, enabled BOOLEAN NOT NULL DEFAULT true,
    seen_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS named_friendship (
    char_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE, named_id TEXT NOT NULL,
    pts REAL NOT NULL DEFAULT 0, day INT NOT NULL DEFAULT 0, got REAL NOT NULL DEFAULT 0, chat REAL NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (char_id, named_id))`);
  await q(`ALTER TABLE floor_clears ADD COLUMN IF NOT EXISTS heroes BOOLEAN NOT NULL DEFAULT false`);
  // The Named's requests (server/namedquests.js): each character's active request per Named (null: none), when the
  // next offer is due (ms), and the request friendship earned today (its own cap).
  await q(`CREATE TABLE IF NOT EXISTS named_requests (
    char_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE, named_id TEXT NOT NULL, req JSONB,
    next_at BIGINT NOT NULL DEFAULT 0, day INT NOT NULL DEFAULT 0, got REAL NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (char_id, named_id))`);
  // Controls that follow the account (roadmap K2): the browser's whole fb_controls object (bindings + accessibility),
  // capped at 8 KB (server/accounts.js /api/settings).
  await q(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS settings JSONB`);
}
