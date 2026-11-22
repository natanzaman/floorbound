# Floorbound: notes for Claude

A Sword Art Online-inspired co-op 3D browser game. The owner (Natan) builds it with a few friends who play-test.
Start every session by reading `docs/NEXT.md` (what to do next, local setup), then `docs/ROADMAP.md` (full specs, the owner's decisions and the task trackers).

## Stack
- **Server:** Node 20, `ws`, authoritative at 20 Hz (`server/index.js` → `server/game.js`).
  - Feature modules install themselves onto `Game.prototype`: combat, twists, floor2, floor3, arenas, bossteam, rescue, revive, threat, teamplay, chains (skill chains), mvp, poses, looks, openings (J3 combos, after states, melee openings), mastery, talents, styles, classes-a, classes-b, smith, hall, ground, playerbots.
  - Boss timings live in tables (`shared/bosstiming.js`, `shared/pace.js`); `scripts/tuneboss.js` runs bot fights for tuning (README → Tuning bosses).
  - The Named (`shared/named.js`, `server/named.js`): NPC heroes (the Hearthward) and the loner Cairn, a separate bot kind (`e.named`), off with `NAMED_ENABLED=0`. Several may join one party (up to 6); each is unique and can be despawned/respawned.
  - Bots and access levels: bots record a creator and can roam free (not in a party); no per-player cap (`MAX_BOTS` global). `accounts.access_level` 1–5 ("access level", never character level; admins count as 5); per-action minimums and `canControlBot` in `shared/accesslevels.js` (creator → access ≥ 3 → allow list of saved character ids → empty list = anyone). Plan: `docs/briefs/bots-access.md`.
  - Targeting and Cleave (`shared/targeting.js`, `server/targeting.js`): four player modes (nearest, locked or nearest, cone, aimed), per-attack field of view and target limits, weapon `mods.fov` in `shared/styles.js`; prefs arrive in a `tprefs` message, skills carry the camera yaw (`look`). Bots send no prefs and keep the old behaviour. Plan: `docs/briefs/targeting.md`.
  - Floor travel: each town's centrepiece is its waypoint (`WAYPOINTS` in `shared/floor2.js`; old waystone names are aliases). Floor 1's well sleeps until the character unlocks Floor 2, then `public/wellwake.js` plays the "well awakens" shot. Plans: `docs/briefs/waypoint.md`, `docs/briefs/well-awakens.md`.
- **Client:** Three.js ES modules with no build step (`public/`).
  - `main.js` wires everything together: HUD, input, prediction, snapshot handling.
  - `world.js`, `floor2world.js` and `floor3world.js` build the scenery.
  - Input: `shared/controls.js` (actions, bindings, rules) → `public/input.js` (keys, mouse, pad; `__fb.input`), `shared/gamepad.js`, `public/focusnav.js` (pad menus), `public/controlsui.js` (Controls screen), `public/controlsync.js` (account copy), `public/keyname.js` (prompts name the active device's key), `public/xboxusb.js` (WebUSB wired pads on Mac).
  - Feature modules mirror the server ones. Visuals pass (`docs/briefs/combos-visuals.md`): `public/vfx.js` (trails, 3D skill effects, camera kick, chain counter), `public/post.js` (bloom + tone mapping, Medium/High), `public/sparks.js`.
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
  - **Always push with lease:** `git push --force-with-lease origin main` (never a bare `--force`). If the lease is rejected, someone else pushed: pull, re-merge, re-test, push again. (In the cloud workspace a lease push may be blocked by the sandbox; a plain fast-forward `git push origin main` is the safe fallback.)
  - **Feature flow the owner expects:** plan each feature (a brief in `docs/briefs/`), build, independent code review, fix, merge into `main`, deploy.
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
  - New feature tests: `accesslevels`, `freebots`, `targeting` (+ `targeting.py`), `wellwake` (+ `wellwake.py`).
- **Style:** small, focused diffs that respect existing patterns. Data-driven over per-case hardcoding. Keep the in-game guide (`public/guide.js`) and README in step with mechanics.
- **Talking to the owner:** concise and outcome-first, in plain words. He reads on his phone.
