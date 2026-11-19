// AI companions: what survives a restart (Postgres, tables made in server/db.js).
//   ai_memories (bot, player) -> notes   the mind's short notes about each player, per bot (capped and pruned)
//                                        kind 'bot': companions (bot name, player name); kind 'named': the Named's
//                                        notes about player characters ('named:<id>', 'c<charId>'), capped apart
//   ai_spend    (day)         -> usd     estimated spend per UTC day, so AI_DAILY_USD holds across deploys
//                                        (named_usd / named_calls: the part spent on Named talk)
// makeStore(q) takes db.q (or a fake in tests). Every method is best-effort: callers catch and log, and a database
// problem never stops a bot from playing.
export const MEM_ROWS = 400;     // most (bot, player) rows kept (newest first), same cap as the in-memory Memory
export const MEM_TTL_DAYS = 90;  // rows untouched this long are dropped
export const NAMED_MEM_ROWS = 2000;   // the Named's notes: most (Named, character) rows kept
export const NAMED_MEM_TTL_DAYS = 180;

export function makeStore(q) {
  return {
    async loadMemories() {
      const rows = await q(`SELECT bot, player, notes FROM ai_memories WHERE kind = 'bot' ORDER BY updated_at DESC LIMIT ${MEM_ROWS}`);
      rows.reverse(); // (oldest first, the newest MEM_ROWS)
      return rows.map(r => ({ bot: r.bot, player: r.player, notes: Array.isArray(r.notes) ? r.notes.map(String) : [] }));
    },
    // rows: [{ bot, player, notes }] (keys already lower-case). One statement for the batch.
    async saveMemories(rows) {
      if (!rows.length) return;
      await q(`INSERT INTO ai_memories (bot, player, notes, updated_at)
        SELECT r.bot, r.player, r.notes, now() FROM jsonb_to_recordset($1::jsonb) AS r(bot TEXT, player TEXT, notes JSONB)
        ON CONFLICT (bot, player) DO UPDATE SET notes = EXCLUDED.notes, updated_at = now()`, [JSON.stringify(rows)]);
    },
    async pruneMemories(max = MEM_ROWS, days = MEM_TTL_DAYS) {
      await q(`DELETE FROM ai_memories WHERE kind = 'bot' AND updated_at < now() - make_interval(days => $1::int)`, [days]);
      await q(`DELETE FROM ai_memories WHERE kind = 'bot' AND (bot, player) NOT IN (SELECT bot, player FROM ai_memories WHERE kind = 'bot' ORDER BY updated_at DESC LIMIT $1::int)`, [max]);
    },
    // The Named's notes (server/ai/namedtalk.js): rows { named, key ('c<charId>'), notes }, newest NAMED_MEM_ROWS.
    async loadNamedMemories() {
      const rows = await q(`SELECT bot, player, notes FROM ai_memories WHERE kind = 'named' ORDER BY updated_at DESC LIMIT ${NAMED_MEM_ROWS}`);
      return rows.reverse().map(r => ({ named: String(r.bot).replace(/^named:/, ''), key: r.player, notes: Array.isArray(r.notes) ? r.notes.map(String) : [] }));
    },
    async saveNamedMemories(rows) {
      if (!rows.length) return;
      await q(`INSERT INTO ai_memories (bot, player, notes, kind, updated_at)
        SELECT 'named:' || r.named, r.key, r.notes, 'named', now() FROM jsonb_to_recordset($1::jsonb) AS r(named TEXT, key TEXT, notes JSONB)
        ON CONFLICT (bot, player) DO UPDATE SET notes = EXCLUDED.notes, kind = 'named', updated_at = now()`, [JSON.stringify(rows)]);
    },
    async pruneNamedMemories(max = NAMED_MEM_ROWS, days = NAMED_MEM_TTL_DAYS) {
      await q(`DELETE FROM ai_memories WHERE kind = 'named' AND updated_at < now() - make_interval(days => $1::int)`, [days]);
      await q(`DELETE FROM ai_memories WHERE kind = 'named' AND (bot, player) NOT IN (SELECT bot, player FROM ai_memories WHERE kind = 'named' ORDER BY updated_at DESC LIMIT $1::int)`, [max]);
    },
    async loadSpend(day) {
      const r = await q(`SELECT usd FROM ai_spend WHERE day = $1::date`, [day]);
      return Number(r[0]?.usd) || 0;
    },
    async loadNamedSpend(day) {
      const r = await q(`SELECT named_usd FROM ai_spend WHERE day = $1::date`, [day]);
      return Number(r[0]?.named_usd) || 0;
    },
    // Adds (not sets) so two instances overlapping during a deploy never undercount. namedUsd / namedCalls: the part of
    // usd / calls that was Named talk.
    async addSpend(day, usd, calls, namedUsd = 0, namedCalls = 0) {
      if (!(usd > 0) && !(calls > 0)) return;
      await q(`INSERT INTO ai_spend (day, usd, calls, named_usd, named_calls) VALUES ($1::date, $2, $3, $4, $5)
        ON CONFLICT (day) DO UPDATE SET usd = ai_spend.usd + EXCLUDED.usd, calls = ai_spend.calls + EXCLUDED.calls,
          named_usd = ai_spend.named_usd + EXCLUDED.named_usd, named_calls = ai_spend.named_calls + EXCLUDED.named_calls`, [day, usd, calls | 0, namedUsd || 0, namedCalls | 0]);
    },
  };
}
