# Floorbound: what's next (handoff, 2026-11-20)

Start here, then use `docs/ROADMAP.md` for full specs and owner decisions. Everything in sections A–K is merged and live, except F7. The batch of 2026-11-19 (K1b gamepad + menu navigation, K2 Controls screen + account sync, K3 accessibility, K4 scripted pad tests, J3 boss timing tables + melee openings + `scripts/tuneboss.js`, small items) went out with a hard review (Opus high) and its fixes, plus a check on a real wired pad (SCUF on Mac Chrome, WebUSB). Batch log: `docs/briefs/progress-batch-2026-11-19.md`.

## Batch of 2026-11-20 (merged and pushed)
Plans: `docs/briefs/bots-access.md`, `docs/briefs/waypoint.md`, `docs/briefs/targeting.md`. Each branch had an independent review (Fable) and its fixes before merging.
- **Waypoints:** the waystone crystals are gone; the Floor 1 fountain, the Mirelight campfire and the Windbreak brazier are the warps (glow + "Press <key> to open the waypoint"). Old names stay as aliases. Story docs and `ep1-first-line.yaml` still say "waystone" (left for the film work).
- **Targeting (ROADMAP K5):** Settings → Controls → Combat: Nearest / Locked or nearest (default) / Cone 120° / Aimed, Cleave on/off, max targets 1–8. Per-attack field of view and target limits in `shared/targeting.js`; skill messages carry the camera yaw (`look`) for the server's Cone filter. Bots send no prefs and play as before.
- **Bots + access levels:** Bots section in the Players list (invite, kick, Named despawn/respawn, creator allow-list editor), "Join my party" checkbox, free-roaming bots with a creator, no per-player cap (`MAX_BOTS` 30 global), `accounts.access_level` 1–5 (admins 5) with the admin-page picker, rules in `shared/accesslevels.js` (`canControlBot`). Allow lists hold saved character ids only. `INVITE_NEEDS_TIER = false` in `shared/named.js`.

## Owner calls from the 2026-11-20 batch
- Ranger in Locked or nearest with no lock uses the old crosshair pick (fixed in review); OK?
- Attack target limits (basic swings 4, finishers 6, Berserker Cleave 8, thrusts 3): right? Should bots use them?
- Which weapons get a wider/narrower attack field of view (all 1 now)? Should Cleave cover spins/slams/chords?
- Aimed mode: a lock still turns the camera (light aim assist). Keep?
- One Named per party still applies; allow several? One player can fill all 30 bot slots with free bots; add a per-player cap on free bots?

## Owner calls waiting (nothing is blocked on them)
- **Melee share on bosses:** the J3 timing tables did not raise it. Options: a bigger `OPENING.dmg`, or bots that use openings more.
- **Colossus length:** fight HP is now x0.72 (`hpBase` 5750, `hpPer` 4550 in `shared/floor3.js`): about 105–125 s at bot skill 5. x0.80 (6400 / 5050) if it should run longer.
- **Riptide twist** wipes 6-bot parties on the Sovereign (older than J3). **Horn Sweep** is rare.
- **Eye checks:** the colour-blind telegraph palettes; UI-scale caps for the Hall, Smith and skill-point windows; the opening glow and callout.
- **Controller:** the controller picture on the Controls screen is mouse-only; Smith, Hall and Players stay mouse-only.

## Small follow-ups
- `test/keys.mjs` classic-camera check (around line 285) sometimes times out at `ready(0)`; it fails on older code too. `padsmoke.mjs` / `padtest.mjs` are load-sensitive: run them alone.
- Controls sync: if a rebind in browser A is closed within 800 ms, then B edits, then A comes back, A's older copy wins (needs a server timestamp).
- `shared/floor3.js` forced hammerfall (director/testing only) and `server/staging.js` still read `def.atkCd`, not the J3 tables.

## Still open from earlier
- **F7** film work (Episode 1 tuning, Episode 2/3 cue sheets). Paused by the owner.
- Skipped for now: achievements, the weekly board and cosmetics.

## Running locally on the Mac (`~/floorbound`)
- `npm install`, then `npm start` (anonymous mode, no DB) and open http://localhost:3000.
- **DB tests:**
  1. `brew install postgresql@17 && brew services start postgresql@17`
  2. `createdb fb_x`
  3. set `DATABASE_URL=postgresql://localhost/fb_x`

  Production is Neon: never point tests at it.
- **Browser tests:** Python Playwright (`pip install playwright && playwright install chromium`). The Node Playwright version for `.mjs` tests is `npm i --no-save playwright`.
- **Avoid these test ports:** 6665–6669 and 6679, which Node's fetch refuses.
- **Pushing:** `git push --force-with-lease --force-if-includes origin HEAD:main`, which auto-deploys to Render (a free plan that the owner wants to stay on). On this Mac git has no GitHub login in the keychain: add `-c credential.helper= -c credential.helper='!gh auth git-credential'` (gh is signed in). The global pre-push hook refuses a merge on main's first-parent line whose merged branch doesn't contain its first parent: when an integration branch holds its own merges, merge it with `--no-ff` onto a detached `origin/main` and push that (as e2fb80c did).
- **Live site check:** the Render connector needs Natan to pick a workspace first; ask him.
