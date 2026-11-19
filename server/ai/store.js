// AI companions: what survives a restart (Postgres, tables made in server/db.js).
//   ai_memories (bot, player) -> notes   the mind's short notes about each player, per bot (capped and pruned)
//   ai_spend    (day)         -> usd     estimated spend per UTC day, so AI_DAILY_USD holds across deploys
// makeStore(q) takes db.q (or a fake in tests). Every method is best-effort: callers catch and log, and a database
// problem never stops a bot from playing.
export const MEM_ROWS = 400;     // most (bot, player) rows kept (newest first), same cap as the in-memory Memory
export const MEM_TTL_DAYS = 90;  // rows untouched this long are dropped

export function makeStore(q) {
  return {
    async loadMemories() {
      const rows = await q(`SELECT bot, player, notes FROM ai_memories ORDER BY updated_at ASC LIMIT ${MEM_ROWS}`);
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
      await q(`DELETE FROM ai_memories WHERE updated_at < now() - make_interval(days => $1::int)`, [days]);
      await q(`DELETE FROM ai_memories WHERE (bot, player) NOT IN (SELECT bot, player FROM ai_memories ORDER BY updated_at DESC LIMIT $1::int)`, [max]);
    },
    async loadSpend(day) {
      const r = await q(`SELECT usd FROM ai_spend WHERE day = $1::date`, [day]);
      return Number(r[0]?.usd) || 0;
    },
    // Adds (not sets) so two instances overlapping during a deploy never undercount.
    async addSpend(day, usd, calls) {
      if (!(usd > 0) && !(calls > 0)) return;
      await q(`INSERT INTO ai_spend (day, usd, calls) VALUES ($1::date, $2, $3)
        ON CONFLICT (day) DO UPDATE SET usd = ai_spend.usd + EXCLUDED.usd, calls = ai_spend.calls + EXCLUDED.calls`, [day, usd, calls | 0]);
    },
  };
}
