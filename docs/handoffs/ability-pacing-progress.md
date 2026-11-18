# Progress: ability pacing (append-only)

## 2026-11-17 step 1: inventory
- Session local (worktree floorbound-ability-pacing-ccacd8, branch claude/floorbound-ability-pacing-ccacd8, base 1fc8892).
- Wrote docs/handoffs/ability-pacing-table.md before any code change. Finding: player cooldowns start on the press; boss repeat
  timers start at the wind-up start; clients and bots read wind-ups from event `d`, so server pacing carries over.
- Baseline bot run started: ROLES=guardian,ranger,cleric,swordsman,lancer BOT_SKILL=5 RUNS=4 PORT=3671 -> docs/handoffs/ability-pacing-data/before.txt
- Next: PACE knob in shared/data.js, server use-time + cd-after-use wrapper, client clip speeds and flash lifetimes.

## 2026-11-17 step 2: implementation delegated
- Commit 6b2d62d on claude/floorbound-ability-pacing-ccacd8: table + handoff + this log.
- Two implementer agents in their own worktrees (cut from 6b2d62d): server/shared (Opus medium; adds server/pacing.js, test/pacing.js)
  and client + docs (Sonnet; public/*, README, guide). Disjoint files except two identical PACE lines in shared/data.js.
- Baseline bot runs still going on this worktree (do not edit tracked code here until before.txt has EXIT).
- Next: merge both agent branches here, run tests, after-runs (PORT 3672) -> after.txt, code-reviewer Opus high.

## 2026-11-17 note
- Push rule from Natan (via the starter session, in ~/.claude/CLAUDE.md): push with --force-with-lease --force-if-includes; handoff push line updated.

## 2026-11-17 client agent done (uncommitted in worktree agent-a2071b55cbce5235b)
- public main/world/classes-a/classes-b/styles/floor2client + README + shared/data.js PACE lines; node --check passed; no browser check.
- Its worktree is NOT cut from 6b2d62d (no handoff docs there): merge by copying its diff, not its branch.
- Open: Dodge_* clips for Disengage/Snare/Tumble left unpaced (ok); Effects.ring/line now stretch every caller incl. any server-timed life: review must check callers.

## 2026-11-17 baseline done (code 6b2d62d = 1fc8892 code)
- before.txt: 4/4 kills, avg kill 87 s (70/76/90/110), avg deaths 1.0, Quake Rings cleared 92% of 333.
- Next: wait for server agent; then apply both agent diffs here, tests, after-runs PORT 3672.
