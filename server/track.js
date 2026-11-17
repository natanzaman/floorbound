// Play tracking: a small events table in Postgres, written in batches, plus aggregate stats.
// Nothing here identifies a person beyond the account/character ids the game already stores.
import * as db from './db.js';

const queue = [];
const MAX_QUEUE = 5000;

export function record(p, kind, data = {}) {
  if (!db.enabled) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push([p?.accountId ?? null, p?.charId ?? null, p?.sid ?? null, kind, JSON.stringify(data)]);
}

export async function flush() {
  if (!db.enabled || !queue.length) return;
  const batch = queue.splice(0, 500);
  const vals = [], params = [];
  batch.forEach((row, i) => { vals.push(`($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}::jsonb)`); params.push(...row); });
  try { await db.q(`INSERT INTO play_events (account_id, char_id, sid, kind, data) VALUES ${vals.join(',')}`, params); }
  catch (e) { console.error('track flush failed', e.message); }
}
setInterval(flush, 5000).unref();

// Floor of a death row: the `floor` field (added with Floor 2), else guessed from the cause for older rows.
const DEATH_FLOOR = `coalesce((data->>'floor')::int,
  CASE WHEN data->>'cause' ~ '^(sovereign|lurker|wisp|shieldback|matron|thrall|tidal wave|mire pool|the deluge)' THEN 2 ELSE 1 END)`;
// Boss fights: Floor 1 (the Horned Warden) is tracked as boss_start/boss_end, Floor 2 (the Drowned Sovereign) as boss2_*.
const BOSS_KINDS = { 1: ['boss_start', 'boss_end'], 2: ['boss2_start', 'boss2_end'] };

// Aggregates for the last N days (default 7). Numbers only, no names.
export async function stats(days = 7) {
  if (!db.enabled) return { enabled: false };
  const since = `now() - make_interval(days => ${Math.max(1, Math.min(90, days | 0))})`;
  const one = async (sql) => (await db.q(sql))[0] || {};
  const [sessions, firsts, bossRows, deaths, deathFloors, retention, lengths, guide, loot] = await Promise.all([
    one(`SELECT count(*)::int AS sessions, count(DISTINCT char_id)::int AS characters, count(DISTINCT account_id)::int AS accounts
         FROM play_events WHERE kind = 'session_start' AND at > ${since}`),
    one(`SELECT
           count(*) FILTER (WHERE kind = 'first_kill')::int AS first_kill,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (data->>'secs')::float) FILTER (WHERE kind = 'first_kill') AS first_kill_secs,
           count(DISTINCT sid) FILTER (WHERE kind = 'party_join')::int AS sessions_with_party,
           count(DISTINCT sid) FILTER (WHERE kind = 'party_join' AND data->>'via' = 'finder')::int AS via_finder,
           count(DISTINCT sid) FILTER (WHERE kind = 'boss_start')::int AS sessions_reached_boss
         FROM play_events WHERE at > ${since}`),
    // one row per floor: kills, wipes, median kill time, sessions that reached the boss
    db.q(`SELECT CASE WHEN kind LIKE 'boss2_%' THEN 2 ELSE 1 END AS floor,
                count(*) FILTER (WHERE kind IN ('boss_end', 'boss2_end') AND data->>'sys' IS NULL AND data->>'result' = 'kill')::int AS kills,
                count(*) FILTER (WHERE kind IN ('boss_end', 'boss2_end') AND data->>'sys' IS NULL AND data->>'result' = 'wipe')::int AS wipes,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY (data->>'secs')::float)
                  FILTER (WHERE kind IN ('boss_end', 'boss2_end') AND data->>'sys' IS NULL AND data->>'result' = 'kill') AS kill_secs,
                count(DISTINCT sid) FILTER (WHERE kind IN ('boss_start', 'boss2_start'))::int AS sessions_reached_boss
         FROM play_events WHERE kind IN ('boss_start', 'boss_end', 'boss2_start', 'boss2_end') AND at > ${since} GROUP BY 1`),
    db.q(`SELECT data->>'cause' AS cause, ${DEATH_FLOOR} AS floor, count(*)::int AS n FROM play_events
          WHERE kind = 'death' AND at > ${since} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`),
    db.q(`SELECT ${DEATH_FLOOR} AS floor, count(*)::int AS n FROM play_events WHERE kind = 'death' AND at > ${since} GROUP BY 1 ORDER BY 1`),
    one(`WITH d AS (SELECT char_id, count(DISTINCT date_trunc('day', at)) AS days FROM play_events
                    WHERE kind = 'session_start' AND char_id IS NOT NULL AND at > ${since} GROUP BY 1)
         SELECT count(*)::int AS characters, count(*) FILTER (WHERE days >= 2)::int AS came_back FROM d`),
    one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (data->>'secs')::float) AS median_secs,
                avg((data->>'secs')::float) AS mean_secs, count(*)::int AS ended
         FROM play_events WHERE kind = 'session_end' AND at > ${since}`),
    db.q(`SELECT (data->>'step')::int AS step, count(DISTINCT coalesce(char_id::text, sid))::int AS n FROM play_events
          WHERE kind = 'guide' AND at > ${since} GROUP BY 1 ORDER BY 1`),
    db.q(`SELECT (data->>'r')::int AS rarity, count(*)::int AS n FROM play_events
          WHERE kind = 'loot' AND at > ${since} GROUP BY 1 ORDER BY 1`),
  ]);
  const floors = {};
  for (const f of Object.keys(BOSS_KINDS)) {
    const r = bossRows.find(x => x.floor === +f) || {};
    floors[f] = { kills: r.kills || 0, wipes: r.wipes || 0, kill_secs: r.kill_secs ?? null, sessions_reached_boss: r.sessions_reached_boss || 0,
      deaths: deathFloors.find(x => x.floor === +f)?.n || 0 };
  }
  const boss = { kills: floors[1].kills, wipes: floors[1].wipes, kill_secs: floors[1].kill_secs }; // Floor 1, as before
  return { enabled: true, days, sessions, firsts, boss, floors, deaths, retention, lengths, guide, loot };
}
