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

// ---------- admin dashboard (/api/admin/stats, the admin part of /stats.html) ----------
// Every query reads play_events by (kind, at) (the play_events_kind_at index) or the small characters table, and
// returns grouped rows, never raw events. Results are cached for a minute per window so a refresh storm stays cheap.
const QUIT_DAYS = 3; // a character whose last session ended longer ago than this counts as "dropped off"
const LEN_BUCKETS = [120, 300, 900, 1800, 3600]; // session length buckets (seconds): <2m, 2-5m, 5-15m, 15-30m, 30-60m, 60m+
const detailCache = new Map();
const PARTY_KEY = `CASE WHEN jsonb_array_length(coalesce(data->'party', '[]')) > 0
    THEN (SELECT string_agg(x, ',' ORDER BY x) FROM jsonb_array_elements_text(data->'party') x)
    ELSE 'bots:' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM jsonb_array_elements_text(data->'botCls') x), '') END`;

export const DETAIL_SQL = {
  // where people (and bots) die: cause x boss floor x phase x twist
  deaths: `SELECT kind = 'bot_death' AS bot, data->>'cause' AS cause, coalesce((data->>'boss')::int, 0) AS boss,
      (data->>'phase')::int AS phase, data->>'twist' AS twist, count(*)::int AS n
    FROM play_events WHERE kind IN ('death', 'bot_death') AND at > now() - make_interval(days => $1) GROUP BY 1, 2, 3, 4, 5`,
  // boss fights: one row per fight; by floor, twist and who fought (players only / mixed / bots only)
  fights: `SELECT (data->>'floor')::int AS floor, data->>'twist' AS twist,
      CASE WHEN (data->>'humans')::int = 0 THEN 'bots' WHEN (data->>'bots')::int = 0 THEN 'players' ELSE 'mixed' END AS comp,
      count(*)::int AS fights, count(*) FILTER (WHERE data->>'result' = 'kill')::int AS kills,
      sum((data->>'humans')::int)::int AS humans, sum((data->>'bots')::int)::int AS bots,
      sum((data->>'deaths')::int)::int AS deaths, sum((data->>'botDeaths')::int)::int AS bot_deaths,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (data->>'secs')::float) FILTER (WHERE data->>'result' = 'kill') AS kill_secs
    FROM play_events WHERE kind = 'fight' AND at > now() - make_interval(days => $1) GROUP BY 1, 2, 3`,
  // attempts until the first clear, per party (the set of characters / guests; bot-only parties by their classes).
  // Counted over all time, so a party that cleared before the window isn't shown as clearing on its first try;
  // only parties that fought inside the window are listed.
  attempts: `WITH f AS (SELECT at, (data->>'floor')::int AS floor, data->>'result' AS result, (data->>'hpLeft')::int AS hp,
        (data->>'bots')::int AS bots, ${PARTY_KEY} AS party FROM play_events WHERE kind = 'fight'),
      o AS (SELECT *, min(at) FILTER (WHERE result = 'kill') OVER (PARTITION BY party, floor) AS first_kill FROM f)
    SELECT party, floor, count(*) FILTER (WHERE first_kill IS NULL OR at <= first_kill)::int AS attempts, min(first_kill) AS first_kill,
      count(*)::int AS fights, count(*) FILTER (WHERE result = 'kill')::int AS kills,
      min(hp) FILTER (WHERE result = 'wipe' AND (first_kill IS NULL OR at < first_kill)) AS best_hp_left, max(bots)::int AS bots,
      min(at) AS first_at, max(at) AS last_at
    FROM o GROUP BY 1, 2 HAVING max(at) > now() - make_interval(days => $1) ORDER BY last_at DESC LIMIT 40`,
  // the latest boss fights with their post-fight MVP card (server/mvp.js; older rows have none)
  recent: `SELECT at, (data->>'floor')::int AS floor, data->>'result' AS result, (data->>'secs')::int AS secs, (data->>'hpLeft')::int AS hp_left,
      (data->>'humans')::int AS humans, (data->>'bots')::int AS bots, data->'mvp' AS mvp
    FROM play_events WHERE kind = 'fight' AND at > now() - make_interval(days => $1) ORDER BY at DESC LIMIT 15`,
  // session length histogram
  lengths: `SELECT width_bucket((data->>'secs')::float, ARRAY[${LEN_BUCKETS.join(',')}]::float[]) AS b, count(*)::int AS n
    FROM play_events WHERE kind = 'session_end' AND at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY 1`,
  // each character's (or guest's) last session in the window: where it ended, at what level, and whether they came back
  dropoff: `WITH last AS (SELECT DISTINCT ON (coalesce(char_id::text, sid)) at, data->>'zone' AS zone, (data->>'lvl')::int AS lvl, char_id
        FROM play_events WHERE kind = 'session_end' AND at > now() - make_interval(days => $1) ORDER BY coalesce(char_id::text, sid), at DESC)
    SELECT coalesce(zone, '?') AS zone, lvl, at < now() - make_interval(days => ${QUIT_DAYS}) AS gone, char_id IS NULL AS guest, count(*)::int AS n
    FROM last GROUP BY 1, 2, 3, 4`,
  // play time by class and weapon style (from session_end)
  played: `SELECT data->>'cls' AS cls, data->>'style' AS style, count(*)::int AS sessions,
      count(DISTINCT coalesce(char_id::text, sid))::int AS players, round(sum((data->>'secs')::float) / 60)::int AS mins
    FROM play_events WHERE kind = 'session_end' AND data ? 'cls' AND at > now() - make_interval(days => $1) GROUP BY 1, 2`,
  // current picks of the characters played in the window: class, weapon style, talent ranks
  chars: `SELECT cls, inv->'eq'->'weapon'->>'style' AS style, count(*)::int AS n FROM characters
    WHERE updated_at > now() - make_interval(days => $1) GROUP BY 1, 2`,
  talents: `SELECT c.cls, t.key AS node, count(*)::int AS n FROM characters c, jsonb_each(coalesce(c.talents, '{}')) t
    WHERE c.updated_at > now() - make_interval(days => $1) AND jsonb_typeof(t.value) = 'number' AND (t.value)::int > 0 GROUP BY 1, 2`,
  // bots players add, and how many sessions ended with bots in the party
  pbots: `SELECT data->>'cls' AS cls, count(*)::int AS adds, count(DISTINCT coalesce(char_id::text, sid))::int AS players
    FROM play_events WHERE kind = 'pbot_add' AND at > now() - make_interval(days => $1) GROUP BY 1`,
  botSessions: `SELECT count(*)::int AS sessions, count(*) FILTER (WHERE (data->>'pbots')::int > 0)::int AS with_bots
    FROM play_events WHERE kind = 'session_end' AND data ? 'pbots' AND at > now() - make_interval(days => $1)`,
};

export async function detail(days = 7, { fresh = false } = {}) {
  if (!db.enabled) return { enabled: false };
  days = Math.max(1, Math.min(90, days | 0));
  const hit = detailCache.get(days);
  if (!fresh && hit && Date.now() - hit.t < 60000) return hit.v;
  const keys = Object.keys(DETAIL_SQL);
  const rows = await Promise.all(keys.map(k => db.q(DETAIL_SQL[k], [days])));
  const r = Object.fromEntries(keys.map((k, i) => [k, rows[i]]));
  // party names for the attempts table (character ids only; guests stay "Guest")
  const ids = [...new Set(r.attempts.flatMap(a => a.party.startsWith('bots:') ? [] : a.party.split(',').filter(k => k[0] === 'c').map(k => +k.slice(1))))];
  const names = ids.length ? new Map((await db.q('SELECT id, name, cls FROM characters WHERE id = ANY($1::int[])', [ids])).map(c => [c.id, { name: c.name, cls: c.cls }])) : new Map();
  const attempts = r.attempts.map(a => ({
    floor: a.floor, attempts: a.attempts, cleared: !!a.first_kill, first_kill: a.first_kill, fights: a.fights, kills: a.kills,
    best_hp_left: a.best_hp_left, bots: a.bots, first_at: a.first_at, last_at: a.last_at,
    members: a.party.startsWith('bots:') ? a.party.slice(5).split(',').filter(Boolean).map(cls => ({ cls, bot: true }))
      : a.party.split(',').map(k => (k[0] === 'c' && names.get(+k.slice(1))) || { name: 'Guest' }),
  }));
  const v = { enabled: true, days, quitDays: QUIT_DAYS, lenBuckets: LEN_BUCKETS, ...r, attempts, botSessions: r.botSessions[0] || {} };
  detailCache.set(days, { t: Date.now(), v });
  return v;
}
