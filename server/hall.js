// Hall of Clearers: every Warden kill, kept in Postgres (floor_clears) when there is a database,
// plus an in-memory cache (server first, fastest 5, latest 20) so the board works without one.
import * as db from './db.js';

const RECENT = 20, FASTEST = 5;
const cache = { first: null, fastest: [], recent: [] };

const fromRow = r => ({ at: new Date(r.at).toISOString(), floor: r.floor, secs: r.secs, players: r.players || [], lastAttack: r.last_attack, deaths: r.deaths });

export async function load() {
  if (!db.enabled) return;
  try {
    const [first] = await db.q('SELECT * FROM floor_clears ORDER BY id LIMIT 1');
    cache.first = first ? fromRow(first) : null;
    cache.fastest = (await db.q('SELECT * FROM floor_clears ORDER BY secs, id LIMIT $1', [FASTEST])).map(fromRow);
    cache.recent = (await db.q('SELECT * FROM floor_clears ORDER BY id DESC LIMIT $1', [RECENT])).map(fromRow);
  } catch (e) { console.error('hall load failed', e.message); }
}

export const hasFirst = () => !!cache.first;

// rec = { floor, secs, players: [{ name, cls, lvl }], lastAttack, deaths }
export function add(rec) {
  const r = { at: new Date().toISOString(), floor: rec.floor | 0 || 1, secs: Math.max(0, rec.secs | 0), players: rec.players || [], lastAttack: rec.lastAttack || null, deaths: rec.deaths | 0 };
  if (!cache.first) cache.first = r;
  cache.recent.unshift(r);
  cache.recent.length = Math.min(cache.recent.length, RECENT);
  cache.fastest.push(r);
  cache.fastest.sort((a, b) => a.secs - b.secs);
  cache.fastest.length = Math.min(cache.fastest.length, FASTEST);
  if (db.enabled) {
    db.q('INSERT INTO floor_clears (floor, secs, players, last_attack, deaths) VALUES ($1, $2, $3, $4, $5)',
      [r.floor, r.secs, JSON.stringify(r.players), r.lastAttack, r.deaths]).catch(e => console.error('hall insert failed', e.message));
  }
}

export const message = () => ({ type: 'hall', first: cache.first, fastest: cache.fastest, recent: cache.recent.slice(0, 10) });
