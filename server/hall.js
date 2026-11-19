// Hall of Clearers: every Warden kill, kept in Postgres (floor_clears) when there is a database,
// plus an in-memory cache (server first, fastest 5, latest 20) so the board works without one.
// Clears by the Named alone (rec.heroes: no human fought, server/named.js) are kept apart as the "Heroes' record":
// never first, fastest or recent.
import * as db from './db.js';

const RECENT = 20, FASTEST = 5, HEROES = 5;
let heroes = []; // the latest clears by the Named alone, every floor
const caches = new Map(); // floor -> { first, fastest, recent }
const cacheFor = f => { if (!caches.has(f)) caches.set(f, { first: null, fastest: [], recent: [] }); return caches.get(f); };
const cache = cacheFor(1);
export const FLOORS = [1, 2];

const fromRow = r => ({ at: new Date(r.at).toISOString(), floor: r.floor, secs: r.secs, players: r.players || [], lastAttack: r.last_attack, deaths: r.deaths, ...(r.heroes ? { heroes: true } : {}) });

export async function load() {
  if (!db.enabled) return;
  try {
    for (const f of FLOORS) {
      const cache = cacheFor(f);
      const [first] = await db.q('SELECT * FROM floor_clears WHERE floor = $1 AND NOT heroes ORDER BY id LIMIT 1', [f]);
      cache.first = first ? fromRow(first) : null;
      cache.fastest = (await db.q('SELECT * FROM floor_clears WHERE floor = $1 AND NOT heroes ORDER BY secs, id LIMIT $2', [f, FASTEST])).map(fromRow);
      cache.recent = (await db.q('SELECT * FROM floor_clears WHERE floor = $1 AND NOT heroes ORDER BY id DESC LIMIT $2', [f, RECENT])).map(fromRow);
    }
    heroes = (await db.q('SELECT * FROM floor_clears WHERE heroes ORDER BY id DESC LIMIT $1', [HEROES])).map(fromRow);
  } catch (e) { console.error('hall load failed', e.message); }
}

export const hasFirst = (f = 1) => !!cacheFor(f).first;

// rec = { floor, secs, players: [{ name, cls, lvl }], lastAttack, deaths }
export function add(rec) {
  const r = { at: new Date().toISOString(), floor: rec.floor | 0 || 1, secs: Math.max(0, rec.secs | 0), players: rec.players || [], lastAttack: rec.lastAttack || null, deaths: rec.deaths | 0, ...(rec.heroes ? { heroes: true } : {}) };
  if (r.heroes) { heroes.unshift(r); heroes.length = Math.min(heroes.length, HEROES); }
  else {
    const cache = cacheFor(r.floor);
    if (!cache.first) cache.first = r;
    cache.recent.unshift(r);
    cache.recent.length = Math.min(cache.recent.length, RECENT);
    cache.fastest.push(r);
    cache.fastest.sort((a, b) => a.secs - b.secs);
    cache.fastest.length = Math.min(cache.fastest.length, FASTEST);
  }
  if (db.enabled) {
    db.q('INSERT INTO floor_clears (floor, secs, players, last_attack, deaths, heroes) VALUES ($1, $2, $3, $4, $5, $6)',
      [r.floor, r.secs, JSON.stringify(r.players), r.lastAttack, r.deaths, !!r.heroes]).catch(e => console.error('hall insert failed', e.message));
  }
}

// Floor 1 at the top level (as before); other floors under `floors`.
export const message = () => ({
  type: 'hall', first: cache.first, fastest: cache.fastest, recent: cache.recent.slice(0, 10), ...(heroes.length ? { heroes } : {}),
  floors: Object.fromEntries(FLOORS.filter(f => f > 1).map(f => { const c = cacheFor(f); return [f, { first: c.first, fastest: c.fastest, recent: c.recent.slice(0, 10) }]; })),
});
