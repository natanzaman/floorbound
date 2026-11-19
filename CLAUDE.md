# Floorbound: notes for Claude

A Sword Art Online-inspired co-op 3D browser game. The owner (Natan) builds it with a few friends who play-test.
Start every session by reading `docs/ROADMAP.md`: it holds the current plan, the owner's decisions and the task specs.

## Stack
- **Server:** Node 20, `ws`, authoritative at 20 Hz (`server/index.js` → `server/game.js`).
  - Feature modules install themselves onto `Game.prototype`: combat, twists, floor2, mastery, talents, styles, classes-a, classes-b, smith, hall, ground, playerbots.
  - The Named (`shared/named.js`, `server/named.js`): NPC heroes (the Hearthward) and the loner Cairn, a separate bot kind (`e.named`), off with `NAMED_ENABLED=0`.
- **Client:** Three.js ES modules with no build step (`public/`).
  - `main.js` wires everything together: HUD, input, prediction, snapshot handling.
  - `world.js` and `floor2world.js` build the scenery.
  - Feature modules mirror the server ones.
- **Shared** (`shared/`): data and tuning, item, talent, style, mastery and twist tables, and the bot code.
  - `shared/bots/`: brain, motor, registry, social, classes, style.
  - `shared/botskill.js`: capability levels 1–5.
- **Persistence:** Postgres (Neon in production). Characters carry JSONB columns `inv`, `stats`, `mastery`, `talents`. Migrations live in `server/db.js`. Without `DATABASE_URL` the game runs in anonymous mode.
- **Deploy:** Render free plan, service `floorbound` (Docker), with auto-deploy on every push to `main`.
  - The owner wants to stay on the free plan.
  - Every push restarts the live server; clients auto-reconnect.
- **Admin:** `/admin.html`, for admin accounts only (account id 2, "Jewsy"). Play stats: `/stats.html`.

## Working rules
- **Parallel work:** each agent works in its own git worktree on its own branch.
  - Create one with `git worktree add -b feat/<name> /home/claude/wt/<name> main`, then `ln -s <repo>/node_modules <wt>/node_modules`.
  - Merge straight into `main` (no PRs), resolving conflicts by keeping both sides.
  - After merging, run all tests, push, then remove the worktree and branch.
  - **Always push with lease:** `git push --force-with-lease origin main` (never a bare `--force`). If the lease is rejected, someone else pushed: pull, re-merge, re-test, push again.
- **Commits:** the owner has granted standing commit and push access. Commit messages end with the session's attribution lines.
- **Safety:**
  - Never type passwords, keys or tokens.
  - The owner solves CAPTCHAs.
  - Accepting terms or OAuth needs his explicit OK.
  - Destructive SQL on production needs his OK.
- **Tests:** `node test/<name>.js`. DB tests need `DATABASE_URL`, e.g. a local Postgres database (`su postgres -c "createdb fb_x"`, `postgresql://postgres:pg@localhost/fb_x`; `service postgresql start` if it's down).
  - Bot boss runs: `ROLES=guardian,ranger,... BOT_SKILL=5 RUNS=2 PORT=36xx node test/wardenskill.js`. Also accepts `START_STYLE`, `STATS=1`, `LOG_TALENTS=1`.
  - Browser checks: Python Playwright with swiftshader. Start a server with `PORT=xxxx START_LEVEL=10 SPAWN_AT=0,150 node server/index.js`. Headless rendering is slow, so judge by game state, not by frame timing.
  - Use unique ports and kill test servers by PID (use `nohup node … &` with `$!`, not a `cd && …` subshell).
- **Style:** small, focused diffs that respect existing patterns. Data-driven over per-case hardcoding. Keep the in-game guide (`public/guide.js`) and README in step with mechanics.
- **Talking to the owner:** concise and outcome-first, in plain words. He reads on his phone.
