# Progress: ability pacing (append-only)

## 2026-11-17 step 1: inventory
- Session local (worktree floorbound-ability-pacing-ccacd8, branch claude/floorbound-ability-pacing-ccacd8, base 1fc8892).
- Wrote docs/handoffs/ability-pacing-table.md before any code change. Finding: player cooldowns start on the press; boss repeat
  timers start at the wind-up start; clients and bots read wind-ups from event `d`, so server pacing carries over.
- Baseline bot run started: ROLES=guardian,ranger,cleric,swordsman,lancer BOT_SKILL=5 RUNS=4 PORT=3671 -> docs/handoffs/ability-pacing-data/before.txt
- Next: PACE knob in shared/data.js, server use-time + cd-after-use wrapper, client clip speeds and flash lifetimes.
