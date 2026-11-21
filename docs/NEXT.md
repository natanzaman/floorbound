# Floorbound: what's next (handoff, 2026-11-20)

Start here, then use `docs/ROADMAP.md` for full specs and owner decisions. Everything in sections A–K is merged and live, except F7. The batch of 2026-11-19 (K1b gamepad + menu navigation, K2 Controls screen + account sync, K3 accessibility, K4 scripted pad tests, J3 boss timing tables + melee openings + `scripts/tuneboss.js`, small items) went out with a hard review (Opus high) and its fixes, plus a check on a real wired pad (SCUF on Mac Chrome, WebUSB). Batch log: `docs/briefs/progress-batch-2026-11-19.md`.

## Batch of 2026-11-20 (merged and pushed)
Plans: `docs/briefs/bots-access.md`, `docs/briefs/waypoint.md`, `docs/briefs/targeting.md`. Each branch had an independent review (Fable) and its fixes before merging.
- **Waypoints:** the waystone crystals are gone; the Floor 1 fountain, the Mirelight campfire and the Windbreak brazier are the warps (glow + "Press <key> to open the waypoint"). Old names stay as aliases. 2026-11-21: the well sleeps until a character unlocks Floor 2, then a short camera shot shows it waking ("A bright light emits from the well."; `public/wellwake.js`, plan `docs/briefs/well-awakens.md`); the story docs and `ep1-first-line.yaml` carry the beat (director verb `wake`, landmark `well`).
- **Targeting (ROADMAP K5):** Settings → Controls → Combat: Nearest / Locked or nearest (default) / Cone 120° / Aimed, Cleave on/off, max targets 1–8. Per-attack field of view and target limits in `shared/targeting.js`; skill messages carry the camera yaw (`look`) for the server's Cone filter. Bots send no prefs and play as before.
- **Bots + access levels:** Bots section in the Players list (invite, kick, Named despawn/respawn, creator allow-list editor), "Join my party" checkbox, free-roaming bots with a creator, no per-player cap (`MAX_BOTS` 30 global), `accounts.access_level` 1–5 (admins 5) with the admin-page picker, rules in `shared/accesslevels.js` (`canControlBot`). Allow lists hold saved character ids only. `INVITE_NEEDS_TIER = false` in `shared/named.js`.

## Owner calls from the 2026-11-20 batch: decided 2026-11-21 (`feat/tweaks`, brief `docs/briefs/tweaks-2026-11-21.md`)
- **Several of the Named per party: yes.** Any of the five can join one party, up to the normal 6 (open invites count);
  each is still one of a kind. Despawn / respawn rejoins a party that has other Named in it (room permitting).
- **Weapon field of view: done as recommended** (`mods.fov` in `shared/styles.js`): Mace & Shield and Halberd x1.15,
  Warhammer x1.2; Dual Blades and Twin Daggers x0.85, Twin Axes and Rapier x0.9; everything else 1. Values and reasoning:
  `docs/briefs/targeting.md`.
- **Unchanged (kept as is):** target limits (basic swings 4, finishers 6, Berserker Cleave 8, thrusts 3); bots keep the
  old behaviour (no limits); the Ranger crosshair pick in Locked or nearest; Aimed mode's lock still turns the camera
  (light aim assist); Cleave doesn't cover spins, slams or chords; no per-player cap on free bots.

## Owner calls waiting (nothing is blocked on them)
- **Melee share on bosses:** the J3 timing tables did not raise it. Options: a bigger `OPENING.dmg`, or bots that use openings more.
- **Colossus length:** fight HP is now x0.72 (`hpBase` 5750, `hpPer` 4550 in `shared/floor3.js`): about 105–125 s at bot skill 5. x0.80 (6400 / 5050) if it should run longer.
- **Riptide twist** wipes 6-bot parties on the Sovereign (older than J3). **Horn Sweep** is rare.
- **Eye checks:** the colour-blind telegraph palettes; UI-scale caps for the Hall, Smith and skill-point windows; the opening glow and callout.
- **Controller:** the controller picture on the Controls screen is mouse-only; Smith, Hall and Players stay mouse-only.

## Small follow-ups (done 2026-11-21)
- Flaky browser tests: on slow runs the test player was bitten down by wolves mid-check, so `keys.mjs`, `padsmoke.mjs` and `padtest.mjs` sections 1-3 now send `{ type: 'test', ward: 1 }` (TEST_HOOKS: nothing hurts you). A pad press is held for exactly k polled frames inside the page (no d-pad repeat overshoot), joining by pad walks to the class card by where it is (`P.seek`), the V tap is retried when a long frame makes it look like a hold, and the jump and "frames kept polling" checks no longer assume a frame rate. With 6 runs at once: keys 6/6 (3/6 before), padsmoke 3/3, padtest sections 1-3 3/3 (0/3 before). Section 4 (the Warden fight) failed its Quake Ring jump check in this cloud box on the old code too (2 of 2, and 2 of 2 with these changes): real-time, still run it alone and check it on the Mac. `filmsubs.mjs` imports `playwright` by name only (fails without a local install; film work is paused).
- Controls sync: newest change wins. Each change carries when it was made on the server's clock (`accounts.settings_at`); an older one that arrives late gets 409 and takes the newer copy.
- Forced boss swings (the Floor 3 hammerfall, staging's trident) use the fight table through `forceSwing` (server/openings.js): the cd with rage, the wind-up and the swing mark.
- `test/bots.js` retired.

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
