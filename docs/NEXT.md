# Floorbound: what's next (handoff, 2026-11-20)

Start here, then use `docs/ROADMAP.md` for full specs and owner decisions. Everything in sections A–K is merged and live, except F7. The batch of 2026-11-19 (K1b gamepad + menu navigation, K2 Controls screen + account sync, K3 accessibility, K4 scripted pad tests, J3 boss timing tables + melee openings + `scripts/tuneboss.js`, small items) went out with a hard review (Opus high) and its fixes, plus a check on a real wired pad (SCUF on Mac Chrome, WebUSB). Batch log: `docs/briefs/progress-batch-2026-11-19.md`.

## Batch of 2026-11-20 (merged and pushed)
Plans: `docs/briefs/bots-access.md`, `docs/briefs/waypoint.md`, `docs/briefs/targeting.md`. Each branch had an independent review (Fable) and its fixes before merging.
- **Waypoints:** the waystone crystals are gone; the Floor 1 fountain, the Mirelight campfire and the Windbreak brazier are the warps (glow + "Press <key> to open the waypoint"). Old names stay as aliases. 2026-11-21: the well sleeps until a character unlocks Floor 2, then a short camera shot shows it waking ("A bright light emits from the well."; `public/wellwake.js`, plan `docs/briefs/well-awakens.md`); the story docs and `ep1-first-line.yaml` carry the beat (director verb `wake`, landmark `well`).
- **Targeting (ROADMAP K5):** Settings → Controls → Combat: Nearest / Locked or nearest (default) / Cone 120° / Aimed, Cleave on/off, max targets 1–8. Per-attack field of view and target limits in `shared/targeting.js`; skill messages carry the camera yaw (`look`) for the server's Cone filter. Bots send no prefs and play as before.
- **Bots + access levels:** Bots section in the Players list (invite, kick, Named despawn/respawn, creator allow-list editor), "Join my party" checkbox, free-roaming bots with a creator, no per-player cap (`MAX_BOTS` 30 global), `accounts.access_level` 1–5 (admins 5) with the admin-page picker, rules in `shared/accesslevels.js` (`canControlBot`). Allow lists hold saved character ids only. `INVITE_NEEDS_TIER = false` in `shared/named.js`.

## Combos 2.0 and the visuals pass (2026-11-22, branch `claude/project-thread-2sti63`, plan `docs/briefs/combos-visuals.md`)
- Skill chains (x2-x4, named links), self-combos, a setup for every class (Cross Cut, Aftershock, Verdict, Downbeat;
  every pair of classes has a combo), bots that open setups and call them out, the **Set me up** order, class-flavoured
  Team Bursts (7 traits, 28 named finishers). Visuals by a Fable agent: weapon trails, pooled sparks, bloom on
  Medium/High, 3D skill effects, attack accents, camera kick. Fable review: 8 issues, all fixed.
- Bosses +20% health (Warden) / +35% (Sovereign, Colossus) so fights stay as long (owner's pick). Bot runs, 6 bots,
  skill 5, `scripts/tuneboss.js` 3 runs each, main → this batch: Warden 99 → 96 s, Sovereign 151 → 158 s, Colossus 137 → 150 s.
- Not measured: frame cost on a real GPU (headless software rendering: Medium/High frames +9-12%, draw calls +2%).
  Worth a look on the Mac: trails on the 2H axe and spear, the attack accents, bloom.

## Duels (2026-11-22, branch `claude/project-thread-yae5hc`, plan `docs/briefs/duels.md`)
- Solo or party vs party duels with players, bots and the Named: Players → Duel or `/duel <name>`. Rules First Strike,
  Half Health (default), Last Stand; nobody dies, health back after; ring, clock, `/yield`. Hard mode pushed off.
- **Owner calls waiting:** the default rule (Half Health was a guess), `DUEL.pvp` 0.25, the 2 / 3 min clock, whether
  knockback and stuns should move players in duels (not in v1), a duel ladder.

## Guilds (2026-11-22, branch `feat/guilds`, plan `docs/briefs/guilds.md`)
- Found a guild (Players → Guild or the Guild Registrar in town, 300 gold), ranks Leader / Officer / Member, invites
  (players get a card; bots and the Named accept by themselves), `/g` chat, `[TAG]` on nameplates, the Players list and
  the Hall, a shared bank and a 20-slot vault (atomic with your bag, one transaction), 3 weekly guild quests (bots count
  a quarter), guild levels 1-10 with perks, admin list + disband. Tables `guilds`, `guild_members`.
- **Owner calls waiting:** the fee (300), the quest list and rewards, the perks, whether the Registrar should be the only
  place to found one, whether bots may hold Officer rank (they can now; they do nothing with it).
- Not built: the guild hall plot (`guilds.plot`, Phase 5 floor towns).

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
- **Boss rebalance, 2026-11-21 (`claude/project-thread-7n6amu`, owner rule: only if harder and cleaner):** the Horn Sweep now also ends a weighted combo in Warden phases 2 and 3 (slam or charge, then the Sweep): ~2.5 → ~3.7 per fight, Warden 95 s / 0 deaths → 120 s / 1 death (6 bots, skill 5). Colossus fight HP x0.80 (6400 / 5050). Riptide: bots hugging the Sovereign rolled too early (the boss blocks the roll, the band outlasts the i-frames), so the second wall hit them; bots now roll later there (`shared/bots/motor.js` waveDodge): wave hits 22 → 12 per fight, deaths 10 → 5. The boss itself is unchanged.
- **Melee share on bosses:** still open. A bigger `OPENING.dmg` was not done: it shortens fights (easier). Bots using openings more is the remaining option (bot-only).
- **Eye checks:** the colour-blind telegraph palettes; UI-scale caps for the Hall, Smith and skill-point windows; the opening glow and callout.
- **Controller:** the controller picture on the Controls screen is mouse-only; Smith, Hall and Players stay mouse-only.

## Small follow-ups (done 2026-11-21)
- Flaky browser tests: on slow runs the test player was bitten down by wolves mid-check, so `keys.mjs`, `padsmoke.mjs` and `padtest.mjs` sections 1-3 now send `{ type: 'test', ward: 1 }` (TEST_HOOKS: nothing hurts you). A pad press is held for exactly k polled frames inside the page (no d-pad repeat overshoot), joining by pad walks to the class card by where it is (`P.seek`), the V tap is retried when a long frame makes it look like a hold, and the jump and "frames kept polling" checks no longer assume a frame rate. With 6 runs at once: keys 6/6 (3/6 before), padsmoke 3/3, padtest sections 1-3 3/3 (0/3 before). Section 4 (the Warden fight) now times each jump from this box's measured press-to-echo delay (it was landing about a second late here); `filmsubs.mjs` takes `PLAYWRIGHT` like the other browser tests and warms its two voice files first (a slow box decoded the first one past the 1.2 s cutoff).
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
