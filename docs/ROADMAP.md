# Floorbound roadmap

Last updated 2026-11-17. Owner: Natan. Players: Natan and friends (play-testing, not public).

## Where things stand
Done and live:
- **Floor 1** (town, fields, the Horned Warden raid) and **Floor 2** (Glimmering Mire, the Drowned Sovereign; level cap 20).
- **Classes:** 7 (Swordsman, Guardian, Cleric, Ranger, Berserker, Lancer, Bard), each with 3 weapon styles and a 3-branch talent tree (Skill Tree window, K).
- **Skill mastery** with evolutions.
- **Combat:** posture/Break, perfect dodge, Guardian parry, Switch, Last Attack bonus.
- **Warden:**
  - three phases, hounds, horn charge, rockfall, Horn Sweep, and the Quake Ring (jump it, roll through it, or stand outside 15 m);
  - random per-fight twists;
  - health scales with the party's roles.
- **Items and economy:** items, merchant, bag, crafting/Smith.
- **Social:** party finder, guide, titles, Hall of Clearers, rare spawns.
- **Bots:**
  - each bot has its own brain, capability levels 1–5 and party teamwork;
  - players add up to 3 bots each (P → Bots tab);
  - orders come from a bot's party frame, the "All bots" button or the V wheel.
- **Admin page:** players, characters, bots, a "Maxed" preset.
- **Controls:** mouse-look camera with Settings.
- **Reconnect:** automatic after a server restart.

## Owner decisions (2026-11-17)
- **Do now:** sections A–E below.
- **Later:**
  - achievements, dailies/weekly board, cosmetics, deeper loot (affixes, sets, armor builds);
  - Floor 3 (Floor 2 is untested);
  - a paid Render plan (stay on free).
- **Bots aren't "owned" as such.** A bot is linked to the party it serves. A player can add up to 3, but no admin or game action should leave a bot detached from its party or unaccounted for.
- **Bot orders only via chat `/b <command>`** (and the clickable menus or V wheel). Ordinary chat must never trigger bot orders.
- **Hit-stop (freeze frame) only when a boss's big hit lands on *you*.** It's local to the victim and never shown to the whole party, never on player hits.

## Tasks
**Status 2026-11-17: A–E are done and merged** (specs kept below for reference). **Now: section F, "Season 1: filming"**: the game features the story in `docs/story/STORY.md` needs. Tracker at the top of F.

Each task has its own branch and worktree. Specs below; acceptance criteria are what "done" means.

### A. Combat text and boss-hit feel (`feat/feel-text`)
1. **Stagger and fade floating text.** No pile-ups: offset stacked texts and merge repeats (e.g. "Jumped!" ×3 → one). Shorter lifetimes, easing.
2. **Visibility rules:**
   - Reactions a player performs (Jumped!, Dodged!, Perfect Dodge, Parry, Evade, Switch success, mastery and talent procs on self) show only to that player.
   - Statuses and effects *on a target* (BROKEN, MARKED, Discord stacks, slows, Break on a boss) show to everyone.
   - Your own damage numbers show; other players' numbers are smaller and dimmer, or hidden past a cap.
   - The server tags events with `to`/`by` where needed; the client filters.
3. **Hit-stop when a boss's big hit lands on you.** About 60–90 ms, local only, with a small camera shake. Big hits are slam, charge, Horn Sweep, Quake Ring, rockfall and the Floor 2 boss's heavy attacks. Also add a camera shake when a stomp or Quake Ring lands near you.
4. **Accept when:** a Warden fight screenshot shows no stacked text; a second client doesn't see the first player's reactions; tests pass.

### B. Warden wind-ups, readable channels, jump air control (`feat/windup`)
1. **Real wind-up poses** for slam, horn charge, Horn Sweep and the Quake Ring stomp (rear up, crouch, horn lowered), built from bone or procedural poses on the KayKit rig. The Quake stomp currently borrows the "Cheer" and "Chop" animations.
2. **Slower channels** so players can read them and get ready: slower, more visible telegraphs, and longer wind-ups for the big attacks (roughly +25–40%), with clear telegraph decals. Re-tune so the fight stays about as hard. Targets with test/wardenskill.js:
   - 6 bots at skill 5: about 70–120 s, with a few deaths;
   - the default trio at skill 5: wins most runs.

   Also apply to the Floor 2 boss's channels where they exist.
3. **Jump air control.** Steer in the air, slightly weaker than on the ground, consistent between client prediction and the server. Bots use it to keep moving while airborne (reduces rockfall deaths mid-jump).
4. **Accept when:** a Playwright capture shows each wind-up pose; the Warden numbers are within target; the prediction test shows no rubber-banding while airborne.

### C. Bot and server fixes (`feat/botfix`)
1. **`/b <command>` only.** Chat orders require the `/b` prefix (aliases: `/bots`, `/b name: command` for one bot). Remove keyword parsing of ordinary chat. Add a `/b help` listing. Update the guide.
2. **Crescendo buff label.** It shows as "Blessed": the buff bit is shared. Give Bard Crescendo (and any other mislabeled buff) its own label and icon.
3. **Admin "Respawn as…"** on a bot that's in a player's party must keep it in that party: the same owner link, slot count and orders. No detached bots from any admin action; check delete, edit and respawn.
4. **Player-added bots level with their player.** Each bot keeps pace with the level of the player who added it, on join and as the player levels. Its gear, mastery and talents follow the premade setups.
5. **Update warning.** On SIGTERM (a Render deploy), broadcast "Update incoming: you'll reconnect in a moment". If a boss fight is running, delay shutdown until it ends or about 4 minutes pass, whichever is first. Then save everyone and exit. Render's zero-downtime deploy keeps the old instance serving while it drains. Check `render.yaml` for `maxShutdownDelaySeconds` (up to 300) and set it.
6. **Accept when:** tests cover `/b` parsing (plain chat never orders), respawn keeping the party link, bot level sync and the shutdown drain; README and guide are updated.

### D. Play tracking dashboard (`feat/tracking`)
Use the existing tracking (`server/track.js`, `/stats.html`) to answer:
- where people die (what killed them, by boss phase or twist);
- where they quit or get stuck (session length, last zone, level at drop-off);
- boss attempts until the first clear, per party;
- class, style and talent picks;
- bot vs player share.

Admin-only charts in `/stats.html` or a Stats tab in `/admin.html`. Add any missing events at low cost (no per-tick logging).

**Accept when:** test data shows up in each chart, the queries stay cheap on Neon, and there are tests.

### E. Smarter AI companions: research and prototype (`feat/ai-companions`)
The goal is bots you can talk to: natural replies in chat, tactical call-outs, remembering players, taking loose instructions ("hang back and heal me when I'm low"). The owner has credits on Claude, Gemini and OpenAI.
1. **Research** (`docs/research/ai-companions.md`):
   - current models and prices for low-latency chat across the three providers (use web search; cite sources);
   - latency, tool/function calling, rate limits;
   - cost estimates per hour of play for 1, 3 and 10 companions, at sensible call rates.
2. **Design:** the LLM acts as a slow "mind" on top of the existing fast rule-based brain. It reads compact game-state summaries every few seconds or on events, and returns structured intents: say, set a stance or order, pick a focus, react to the player. The rule-based brain still drives all combat; the LLM never runs per tick. Include safety, cost caps and fallback when there's no key or the API errors.
3. **Prototype:** `shared/bots/mind/` (or `server/ai/`) with a provider-agnostic adapter (anthropic, gemini, openai) chosen by env vars. API keys come only from environment variables the owner sets himself in Render; never commit or ask for keys. Also:
   - a mock provider for tests;
   - per-bot and global token budgets;
   - a toggle in the admin page.

   With no key set, nothing changes.
4. **Accept when:** the research doc has prices and sources, the mock-provider tests pass, and the bots behave exactly as today when disabled.

## F. Season 1: filming (the story's game features)
The story (`docs/story/STORY.md`) is three short episodes acted live by bots and filmed from a spectator view. Episode 1's screenplay and cue sheet are `docs/story/ep1-first-line.md` / `.yaml`. These tasks make it playable. F2 runs the show; F1, F3–F6 are what it drives.

### Tracker
One row per task. Whoever picks a task sets **Status** and **Owner** here first (commit on `main`), and marks it **done** (with the merge commit) when merged and pushed. Statuses: `todo` · `in progress` · `done` · `blocked: <why>`.

| Task | Branch | Status | Owner | Merge |
|---|---|---|---|---|
| F1 Speech bubbles | `feat/bubbles` | done | agent bubbles | b8120ad |
| F2 Scene director | `feat/director` | done | agent director | 4530019 |
| F3 Staging hooks | `feat/staging` | done | agent staging | 497be53 |
| F4 Cinematic camera | `feat/cinecam` | done | agent cinecam | b343ff6 |
| F5 Poses | `feat/poses` | done | agent poses | 901b9d4 |
| F6 The Tower Bell and the engraved Hall | `feat/bell` | done | agent bell | f767ad7 |
| F7 Episode 1 dress rehearsal, then Ep 2/3 cue sheets | (on `main`) | in progress: Ep 1 rehearsed headless (3.3 min, all 4 scenes, no errors); recorded as video and the gate (s2) and Warden (s3) framing reworked (`claude/episode-1-camera-framing-pov`); to do: tune scene 3 dialogue vs live Warden, Eclipse-vs-floor-switch check, Ep 2/3 cue sheets | agent main | |
| F8 POV camera (per-character views) | `claude/episode-1-camera-framing-pov` | done | agent camera | a855ca2 |

### Shared contracts (read before starting any F task)
F2 calls the others through these names, so keep them exactly. Every server method is mixed into `Game.prototype` from its own module (like `server/combat.js`), installed in `server/game.js`. Every new event goes into `this.events` (broadcast in snapshots) unless noted.

| Owner | Server API (on `Game`) | Event(s) to clients |
|---|---|---|
| F1 | none (uses chat events: `say` = `{ t: 'chat', id, from, text, ch: 's', x, z }`) | (existing) `chat` |
| F3 | `forceBossMove(mob, move, targetId)` → bool · `reserveLastAttack(mob, playerId \| null)` · `scriptDeath(p, { respawn: false })` · `scriptRevive(p)` · `protect(p, minFrac \| 0)` · `setTwistOverride('off' \| twistId \| null)` · `spawnMob(type, x, z, { label })` → mob · `giveKeepsake(p, { name, slot, desc })` → item · `clearStaging()` | (existing) `pdie`, `die`, … |
| F4 | `cine(op, data)`; `cineState()` (current shot / light / letterbox / clean, sent to a spectator on join) | `{ t: 'cine', op: 'shot' \| 'slowmo' \| 'title' \| 'fade' \| 'letterbox' \| 'clean' \| 'light', … }` |
| F5 | `setPose(p, k)` (`'kneel' \| 'sit' \| 'bow' \| null`) | `{ t: 'pose', id, k }` (+ late joiners see current poses) |
| F6 | `ringBell(floor, { auto })`; `game.bellAuto` (true by default; F2 sets false during a show) | `{ t: 'bell', floor, n }` |
| F2 | `game.director` (server/director.js): `load(yamlText)`, `validate()`, `run({ from, force })`, `stop()`, `status()` | `emote` `{ t, id, a }` (cheer, block, cast, hit, die); otherwise uses F1/F3–F6 |

- **Movement names:** `forceBossMove` takes `horn_sweep`, `slam`, `charge`, `quake`, `rockfall` (Warden) and `tidal_wave`, `geyser`, `trident`, `deluge` (Sovereign); `meteor`, `spread`, `tether` (team mechanics, either boss: G4).
- **Merging (several agents at once):** merge into `main` and push under a lock, so two merges never interleave:
  `flock /home/claude/floorbound/.git/fb-merge.lock -c 'cd /home/claude/floorbound && git merge --no-ff feat/<name> && <run all tests> && git -c push.negotiate=true push --force-with-lease origin main'`.
  Resolve conflicts keeping both sides. If the push gets HTTP 429 from the proxy, wait 5 s and retry once. Then remove your worktree and branch, and update the tracker row.
- **Tests after merging:** your own new test, the existing tests for the files you touched, and `node test/combat.js` and `node test/feeltext.js` as a smoke check. DB tests need `DATABASE_URL` (see CLAUDE.md).

### F1. Speech bubbles (`feat/bubbles`)
1. **Bubbles above heads** for chat lines from characters: `say` (`/s`) to everyone in range (40 m), party chat to party members, global chat to everyone. Spectators see all of them. Bot chatter gets bubbles too. `/b` orders never show.
2. **Look:** a rounded light panel with a tail, anchored above the nameplate, max ~260 px wide, word-wrapped, readable on a phone. Fades in, holds 2–5 s by length (≈ 1.6 s + 0.07 s per character, clamped), fades out. A new line from the same speaker replaces the old one. Hidden when the speaker is off screen or behind the camera; shrinks with distance a little, never below readable.
3. **Settings:** a "Speech bubbles" toggle (on by default) in the existing Settings panel. The chat log still logs everything.
4. **Accept when:** a Playwright capture shows a bubble over a bot's head after a `/s` line and over a spectator's view of party chat; `node test/bubbles.js` (pure logic: duration, replace, who sees what) passes; guide and README mention it.

### F2. Scene director (`feat/director`)
Plays a cue sheet (YAML, format below) with bot actors inside the server, for filming.
1. **Cue sheet format v1** (document it in `docs/SCRIPT_BRIEF.md`, replacing the old draft; fix that file's facts: the raid gate counts down 5 s):
   - Top: `title`, `cast: [{ id, name, class, style, level, skill (capability, default 5) }]`, `scenes: [...]`.
   - Scene: `id`, `place` (`town`, `raid_gate`, `warden_arena`, `fields`, `mire`, `mire_camp`, `drowned_wood`, `sunken_gate`, `sovereign_lair`), `light` (`day` | `eclipse`), `marks: { actorId: landmark | [x, z] }` (actors are teleported there when the scene starts, in a small fan so they don't stack), `absent: [ids]` (left out of the scene: hidden or parked out of view), `cues: [...]`.
   - Cue: `who` (actor id, `all`, a list, or a boss/mob: `warden`, `sovereign`, a `spawn` label), `do`, verb arguments, optional `id` (label), `after` (`prev` or a label), `delay` (s), `hold` (s).
   - **Timing:** a cue starts together with the previous cue; `after: prev` starts it when the previous cue finishes, `after: <label>` when that cue finishes; `delay` waits after the trigger. A cue finishes when its action is done: movement arrived, `say` after its hold (default from length, 2–5 s), `fight`/`skill`/`wait` when `until` is true, instant verbs at once. A scene ends when all its cues have finished; then the next scene starts.
   - **Landmarks:** `town_square`, `fountain`, `merchant`, `smith`, `skill_shrine`, `hall_of_clearers`, `waystone`, `north_road`, `raid_gate`, `arena_edge`, `arena_center`, `mire_camp`, `mire_shrine`, `drowned_wood`, `sunken_gate`, `sovereign_court`; or an actor id, a boss/spawn label, or `[x, z]`. Take coordinates from `shared/data.js`, `shared/floor2.js`, `shared/items.js`, `shared/crafting.js`, `shared/mastery.js`, `shared/titles.js`.
   - **Conditions** (`until`): `<target>_hp < N%`, `<target>_dead`, `<target>_broken`, `gate_open`, `t > N` (seconds into the scene). Targets: `warden`, `sovereign`, actor ids, spawn labels.
   - **Verbs.** Movement: `walk_to`, `run_to`, `follow`, `face`, `hold`, `dodge`, `jump`, `teleport`. Combat: `fight` (target, until: the bot's own brain fights, focused on the target), `skill` (`skill`: a skill id like `taunt`, `wall`, `burst`, `sanct`, or slot 1–3; `target`; optional `until`, re-pressed when ready), `guard`, `parry`, `use_item`, `ready`. Body: `say` (`text`, `ch`: `say` default, or `party`), `emote` (`cheer`, `block`, `cast`, `hit`, `die`), `pose` (F5: `kneel`, `sit`, `bow`, `none`). Lifecycle: `die` (`respawn: false`), `revive`, `wait` (`secs` or `until`). Staging (F3): `boss_move`, `reserve_last_attack`, `twists`, `spawn`, `give_item`, `protect`. Picture (F4): `camera` (`shot`: `close_up`, `medium`, `wide`, `over_shoulder` (+ `from`), `follow`, `orbit`, `crane`, `free`; `target`; `secs`), `slowmo`, `title`, `fade`, `letterbox`, `clean`, `light`. World (F6): `bell`.
2. **Actors:** each cast member is a server bot (`BotManager`) with that exact name, class, level, weapon style, capability, all in one party. A **script layer** on the bot brain (`b.script`, checked first in `think`) runs the current scripted action (walk, face, hold, say, skill, pose…); when it's empty or a `fight` cue is running, the normal brain plays (focused on the cue's target). Scripted bots never wander, never chatter on their own (`quiet`), never ready up unless told, and the brain's dodging still works in fights.
3. **Safety for takes:** while a show runs, every actor is `protect`ed (can't drop below 10% health) unless a cue kills them; the automatic bell is held (`game.bellAuto = false`); twists follow the sheet; `stop()` (or a crash in a cue) removes the actors, clears staging, poses and cine state, and restores everything.
4. **Validation:** `validate()` lists every problem with its scene/cue index: unknown verbs, actors, landmarks, conditions, a verb whose API (F3–F6) is missing on this server. Unknown fields are warnings.
5. **Admin page:** a **Director** tab in `/admin.html`: pick a sheet from `docs/story/*.yaml` (served read-only by an admin route) or paste one, Validate, Run (from scene N), Stop, and a live status (scene, running cues, elapsed). A button opens the film view `/?spectate=1&film=1`.
6. **Filming notes** in `docs/story/FILMING.md`: run a server without `DATABASE_URL` (blank Hall), `?spectate=1&film=1`, screen-record, then Run.
7. **Accept when:** `node test/director.js` passes (parse and validate `docs/story/ep1-first-line.yaml` with no errors; timing rules: together / `after: prev` / labels / `delay`; a short in-process sheet moves an actor, says a line, and finishes); `FULL=1 node test/director.js` runs Episode 1 end to end on its own server and checks: every scene finished, Bram dead and never respawned, Pell landed the Last Attack, the bell rang once, no actor died unscripted.

### F3. Staging hooks (`feat/staging`) → `server/staging.js`
1. **`forceBossMove(mob, move, targetId)`:** starts that attack's normal wind-up and telegraph now, aimed at the target (the Warden's Horn Sweep, slam, horn charge, Quake Ring, rockfall; the Sovereign's Tidal Wave, geyser, trident sweep, Deluge), whatever its timers say. Same damage and rules as the real move.
2. **`reserveLastAttack(mob, playerId)`:** until cleared, damage from anyone else can't take the mob below 1 HP; the reserved player's hit can kill it (and gets the Last Attack Bonus). Cleared on death or `null`.
3. **`scriptDeath(p, { respawn: false })`:** the character dies the normal way (death animation, `pdie`), stays down where they fell, and doesn't respawn until `scriptRevive(p)` (or `clearStaging`). Counts as a fighter for the Hall of Clearers if they fought. **`protect(p, minFrac)`:** damage can't take them below that fraction (0 turns it off).
4. **`setTwistOverride('off' | id | null)`:** `off` = the current Warden has no twist and the next spawn rolls none; an id forces one; `null` back to random.
5. **`spawnMob(type, x, z, { label })`:** any mob type from `MOBS` (including Mire Matron, Bog Lurker), labelled, tracked, removed by `clearStaging`.
6. **`giveKeepsake(p, { name, slot, desc })`:** a new item rarity `keepsake` (no stats; can't be sold, salvaged, refined or dropped; its own colour; the tooltip shows `desc`). Saved like any item.
7. **Accept when:** `node test/staging.js` (in-process) checks each hook, including that a reserved Warden survives everyone else's damage at 1 HP and dies to the reserved player, and that a scripted death never respawns.

### F4. Cinematic camera (`feat/cinecam`) → `public/cine.js`, server `cine()`
1. **Film view:** `/?spectate=1&film=1` is a spectator that obeys `cine` events. Without `film=1`, spectators ignore shots (they keep the auto framing) but still get light, titles and fades.
2. **Shots** (smooth, eased moves; hold until the next shot): `close_up` (head and shoulders, ~3 m), `medium` (~6 m), `wide` (~16 m, high), `over_shoulder` (behind `from`, looking at `target`), `follow` (behind and above the target, keeps the action framed), `orbit` (slow circle), `crane` (rises and pulls back), `free` (back to the auto spectator framing). Targets: a player id, a mob id, or `[x, z]` (the server resolves names).
3. **`slowmo`** (reuse `slowMotion` in main.js), **`title`** (big centred text + optional subtitle, fades), **`fade`** (to black / in), **`letterbox`** (2.39:1 bars), **`clean`** (hide HUD, chat log, skill bar, party frames, minimap; keep nameplates, health bars and bubbles), **`light`** (`eclipse` / `day` for the whole world; reuse the Eclipse twist's darkness from `public/twists.js`).
4. **Late join:** the server keeps the current cine state and sends it to a spectator when it joins.
5. **Accept when:** a Playwright capture (swiftshader, judged by state) shows each shot framing its target, letterbox, title and clean feed; `node test/cine.js` (server side: state kept, sent on join) passes.

### F5. Poses (`feat/poses`)
1. **Procedural poses** on the KayKit rigs (bone rotations, like the Warden's wind-up poses in `public/world.js`): `kneel` (one knee down, head lowered), `sit` (on the ground, arms on knees), `bow` (head and shoulders bowed, standing). Eased in and out (~0.4 s), hold while the pose is set, work for every class model and weapon style.
2. **Server:** `setPose(p, k)` stores the pose and sends `{ t: 'pose', id, k }`; it clears itself when the character moves, attacks, uses a skill, dodges, jumps or dies. Late joiners (spectators) see current poses.
3. **Players can use them too:** chat `/kneel`, `/sit`, `/bow` (and `/stand`), listed in the guide.
4. **Accept when:** a Playwright capture shows each pose on a knight, mage, rogue and barbarian rig; `node test/poses.js` (server: set, clear on move, late join) passes.

### F6. The Tower Bell and the engraved Hall (`feat/bell`)
A real game feature, not just for the film.
1. **The bell:** when a floor is cleared for the first time on the server, a bell rings for everyone on every floor: a deep, long synthesized toll (`public/audio.js`), a slow camera sway, and a banner: *"THE FIRST BELL"* / *"Floor 1 has been cleared. Ninety-nine to go."* (ordinal per floor). `ringBell(floor, { auto })`; the auto ring is skipped while `game.bellAuto` is false (the director rings it by hand).
2. **The engraved Hall:** the 3D Hall of Clearers tablet shows the names of the latest Floor 1 clear on its face (canvas texture, carved look; blank when there's none, which is how Ep 1 opens), updated live when a clear happens. Its back carries the line *"A HUNDRED BELLS. THEN HOME."* Floor 2 gets the same on Mirelight Camp's side if there's a stone there; otherwise add a small stone by the camp shrine.
3. **Accept when:** `node test/bell.js` (first clear rings once, later clears don't, `bellAuto=false` holds it, manual ring works) passes; a Playwright capture shows the engraved names after a scripted clear; guide and README updated.

### F7. Episode 1 dress rehearsal (after F1–F6)
Run `docs/story/ep1-first-line.yaml` end to end in the film view, fix what breaks, record timings (aim 3–4 min), and list anything the owner should decide. Then write the cue sheets for Episodes 2 and 3 from `STORY.md` (they need Floor 2: Mirelight Camp at night, the Mire Matron's Call, the Sovereign's Tidal Wave and Deluge).
- **Framing pass (2026-11-17):** Ep 1 recorded as 60 fps video (`scripts/film/record.mjs`, contact sheets `scripts/film/sheets.sh`). Fixed in `public/cine.js` `aim()`, for every shot: line of sight (walls, bodies, camera inside a body), widen until the subject fits, a fighter facing a boss gets a two-shot (side-on or behind the shoulder), a fallen subject is framed on the ground.

### F8. POV camera (per-character views)
1. **POV view:** `/?spectate=1&pov=<name>` follows one character with their own game camera (behind, a little above, over the right shoulder, turning with them); `&eyes=1` is first person (their model hidden). It ignores director shots and obeys light, fades, titles, letterbox and clean. When the character is down the camera rises above them.
2. **Director shots** `pov` and `eyes` (`target`: an actor) cut the film view into a character's view.
3. **Admin Director** lists a POV link (and first-person link) per cast member, to record several windows at once.
4. **Accept when:** a recorded take shows each view; `node test/cine.js` and `node test/director.js` pass.

## G. Team combat (owner request 2026-11-17)
Friends are playing and like it. Keep the new-player helpers. Goal: solo still works, but a team gets **more**: more ways to save, set up and pay off each other. Owner picked G1–G5 and added: **healers also build threat by healing**. (Pings were offered and not picked.)

### Tracker
Same rules as F: set Status/Owner on `main` before starting, mark **done** with the merge commit. Merge with the `flock` lock from the F section's "Shared contracts" block.

| Task | Branch | Status | Owner | Merge |
|---|---|---|---|---|
| G1 Downed + revive | `feat/revive` | done | agent revive | 0da0221 |
| G2 Skill combos + Team Burst | `feat/teamburst` | done | agent teamburst | b767a11 |
| G3 Threat you can see, healer threat, Cover, flanking | `feat/threat` | done | agent threat | 56ce6d9 |
| G4 Boss team mechanics | `feat/bossteam` | done | agent bossteam | 2bdaf88 |
| G5 Post-fight MVP card + balance pass | `feat/mvp` | done | agent mvp | ceda318 |

### Shared contracts for G
- **Team stat events.** Each G feature also calls `this.teamStat(p, key, n = 1)` (G2 defines it in `server/teamplay.js`; until merged, guard with `this.teamStat?.(…)`). Keys: `revive`, `save` (healing/cover/shield that stopped a hit that would have downed someone), `switch`, `break`, `combo`, `burst`, `cover`, `flank`, `heal`, `dmg`, `tanked` (damage taken while top threat), `lastAttack`, `mechanic` (did a G4 team mechanic right). G5 reads these.
- **Film safety.** The director (F2) and staging (F3) use `scriptDeath` / `scriptRevive`. Scripted deaths must stay instant deaths (no downed state). Downed state, Team Burst prompts and new boss mechanics stay out of the way while `game.director` is running a show unless a cue asks for them (`forceBossMove` may gain the G4 moves).
- **Bots take part** in every G feature, scaled by capability (`shared/botskill.js`): they revive, cash in combos, join a Team Burst, stand in or spread for G4 mechanics, and Guardians Cover.
- **Readable for new players.** Every new mechanic gets a one-line guide tip (`public/guide.js`) and a short on-screen prompt the first few times.

### G1. Downed + revive (`feat/revive`)
1. At 0 HP **in a party with someone alive nearby**, you go **downed** for ~15 s instead of dying: you can crawl slowly, can't attack, and a bleed-out ring shows. Solo (no living partymate within ~40 m) you die as today.
2. A partymate holds **E** next to you (≈2.5 s channel, broken if they take a heavy hit or move away) to revive you at ~35% HP with a brief i-frame. Cleric **Heal** on a downed ally speeds the channel. Each revive in one fight takes longer (anti-cheese). Enemies keep attacking downed players but bosses prefer standing ones.
3. Whole party downed = wipe as today. Bleed-out = normal death and respawn.
4. Bots revive (priority by role: Cleric first, then whoever is closest and safe), at speed/accuracy scaled by capability.
5. UI: downed overlay with bleed-out timer, "Hold E to revive <name>" prompt, a downed marker above the body visible to the party (through walls), party frame shows DOWNED.
6. **Accept when:** tests cover downed → revive, bleed-out, solo death, wipe, scripted deaths unaffected; a bot party revives each other in a Warden run (report revives/run).

### G2. Skill combos between players + Team Burst (`feat/teamburst`)
1. **Combos (setup → payoff by a different player within ~2.5 s):** data-driven table in `shared/teamplay.js`. Starter set (adjust to the real skill ids):
   - Lancer launch / Sky Lance → Ranger shot or any ranged hit = **Skewer** (bonus damage, posture).
   - Guardian stun (Shield Bash / slam) → Berserker heavy or Swordsman Burst Combo = **Execute** (crit + posture).
   - Bard Discord stacks ≥3 → any Break = **Shatter Chorus** (party heal + damage burst).
   - Ranger Mark → Lancer charge/thrust = **Pin** (root 1.5 s).
   - Cleric Sanctuary/Blessing → ally Switch inside it = **Sanctified Switch** (longer Break window).
   - Show a **chain counter** above the target ("Combo ×2 · Skewer") visible to everyone (it's a target effect), payoff flash for the pair.
2. **Team Burst gauge:** a shared party bar (party frame top) filled by combos, Switches, Breaks, parries, revives and saves; drains slowly out of combat. When full, any member presses **T** to start a ~3 s **sync window**; every member who presses T in the window joins. Effect scales with joiners (2 = strong, 4+ = huge): a combined finisher on the current target (big damage, full posture break, short party buff) with a team-coloured burst. Solo: gauge fills slower and gives a weaker solo burst.
3. Define `teamStat` (see contracts) and record per-fight counters for G5.
4. Bots: try to land payoffs on partners' setups and join a Team Burst window (skill-scaled chance/delay).
5. **Accept when:** tests cover each combo trigger/timeout, gauge fill/drain, sync window joining and scaling; a bot run reports combos and bursts per fight.

### G3. Threat you can see, healer threat, Cover, flanking (`feat/threat`)
1. **Visible threat:** the boss (and elites) show who they're targeting (a line/marker on the target, and the name on the boss bar). Your own threat meter vs the top (small bar under the boss bar: "You 62% of top"), warning colour at ≥90% ("about to pull").
2. **Healer threat:** healing (and shields) adds threat to every enemy currently fighting the party, split across them (~0.5× of the healed amount). Overheal adds none. Tune so a careless Cleric can pull the boss off a Guardian who isn't taunting.
3. **Cover (Guardian):** a new action (e.g. **F** or a talent-free base skill slot if one is free; pick what fits the existing kit) — dash up to ~8 m to an ally and take the next hit meant for them within ~1.5 s (damage reduced by the Guardian's guard). Cooldown ~12 s. Bots: Guardians Cover a low-HP ally targeted by a big hit.
4. **Flanking / pincer:** hitting an enemy from behind (back 120°) gives a small bonus (+10% damage, +posture); if another party member is on the opposite side (≥120° apart around the enemy) both get **Pincer** (+20% damage, +posture). Show a subtle "Pincer" tag to the two players (reaction = only to them). Bots: melee DPS bots try to take the side opposite the tank.
5. **Accept when:** tests cover healer threat math, threat UI data in snapshots, Cover redirecting a hit, flank/pincer angles; a bot run still clears the Warden.

### G4. Boss team mechanics (`feat/bossteam`)
Warden first (Floor 2 boss if time allows). Each is telegraphed, has a guide tip, and only appears with 2+ party members alive (solo fights unchanged):
1. **Shared meteor (stack):** a marked spot/target; damage splits between everyone inside the circle. 1 person = near-lethal, 3+ = light. Big "STACK" marker.
2. **Spread markers:** 2–3 players get a marker; on expiry each explodes in a radius, hurting anyone else inside. "SPREAD" marker on the marked players.
3. **Tether:** links two players; it deals ticking damage until they move ≥ ~15 m apart (or a Guardian Covers it? optional). Visible beam between them.
4. Mix into the phase rotation (and twists if it fits); add to `forceBossMove` names (`meteor`, `spread`, `tether`).
5. Bots stack, spread and break tethers (skill-scaled).
6. **Accept when:** tests cover damage split, spread overlap, tether break distance, solo unchanged; Warden runs with bots (trio and 6) still clear at skill 5 with numbers reported.

### G5. Post-fight MVP card (`feat/mvp`) — after G1–G3 merge
After a boss kill (or a wipe), show every fighter a card: party damage, healing, tanked, Switches, Breaks, combos, bursts, revives, saves, covers, mechanics, Last Attack — with fun titles ("Lifeline": most revives/saves, "Wall": most tanked, "Conductor": most combos, "Last Word": Last Attack…). Shared to the whole party; stored in tracking (`server/trackgame.js`) so `/stats.html` can show it later. **Accept when:** a bot run shows a card with sensible numbers.

## Known issues and backlog
- Floor 2 is untested by the owner: do a play pass before any Floor 3 work.
- Bots ignore Floor 2 specifics? (check during C if cheap)
- `test/bots.js` is an old standalone smoke bot (records 0 hits): retire or update.

## History
Detailed per-feature notes are in README.md and the git log.
