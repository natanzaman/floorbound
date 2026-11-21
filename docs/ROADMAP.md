# Floorbound roadmap

Last updated 2026-11-20. Owner: Natan. Players: Natan and friends (play-testing, not public).

## Where things stand
Done and live:
- **Floor 1** (town, fields, the Horned Warden raid), **Floor 2** (Glimmering Mire, the Drowned Sovereign; level cap 20) and **Floor 3** (the Gale Spires, the Colossus, a two-area fight with the Undercroft).
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
  - players add as many bots as they like (P → Bots tab; only the server's `MAX_BOTS` caps them), in their party or roaming free;
  - every bot and the Named are in the Players list (invite, kick, despawn / respawn the Named);
  - orders come from a bot's party frame, the "All bots" button or the V wheel (your free bots by name too);
  - who may control a bot: its creator, access level 3+, its allow list, else anyone (`shared/accesslevels.js`).
- **Admin page:** players (with each account's access level), characters, bots (creator, allow list), a "Maxed" preset.
- **Controls (K, live 2026-11-20):** every control rebindable on the Controls screen (keyboard & mouse and controller pictures), synced to the account; controller play with an LB layer and pad menu navigation (wired Xbox pads on a Mac via WebUSB); accessibility options (toggles, sensitivity, reduce motion, UI scale, high contrast, colour-blind telegraphs, telegraph sound cue); scripted pad tests (`test/padtest.mjs`).
- **Boss fights (J, live):** rescue traps, multi-area fights, threat rules, and J3 timing tables per fight (`shared/bosstiming.js`), boss combos with after states, melee openings, `scripts/tuneboss.js` for tuning runs.
- **The Named:** the Hearthward NPC heroes and the loner Cairn.
- **Filming:** scene director with cue sheets (F; F7 paused).
- **Reconnect:** automatic after a server restart.

## Owner decisions (2026-11-17)
- **Do now:** sections A–E below.
- **Later:**
  - achievements, dailies/weekly board, cosmetics, deeper loot (affixes, sets, armor builds);
  - Floor 3 (Floor 2 is untested);
  - a paid Render plan (stay on free).
- ~~**Bots aren't "owned" as such.** A bot is linked to the party it serves. A player can add up to 3, but no admin or game action should leave a bot detached from its party or unaccounted for.~~ Replaced on 2026-11-20 (below).
- **Bot orders only via chat `/b <command>`** (and the clickable menus or V wheel). Ordinary chat must never trigger bot orders.
- **Hit-stop (freeze frame) only when a boss's big hit lands on *you*.** It's local to the victim and never shown to the whole party, never on player hits.

## Owner decisions (2026-11-20): bots and access levels (`feat/bots`, brief `docs/briefs/bots-access.md`)
- **Bots record their creator** (account / character, or player for anonymous ones). A bot may be **free**: out of any party, still tracked to its creator, doing the behaviour its creator set (farming the field until one is set). "Join my party" on the Add form (ticked by default) keeps today's behaviour. A bot that leaves a party (kicked, `/b leave`, the party broke up) roams instead of being dismissed. Admin actions still never detach a bot from its party.
- **No per-player cap** on bots; the server-wide `MAX_BOTS` (30, the Named outside it) stays.
- **Every bot is in the Players list** (Players tab → Bots), the Named included, with Invite to party and where it is; Kick out of your party; Despawn / Respawn for the Named (each one of a kind; back, they rejoin the party they left, or the same player when a party of two broke up; else they roam). Despawned survives a restart.
- **Access levels** 1-5 per account (`accounts.access_level`, set by devs on the admin page; never the character level). Everyone 1, admins count as 5. `shared/accesslevels.js` `ACTION_MIN` gives each gated action a minimum (all 1 now; raising one is one line); `ACCESS.overrideBots` = 3.
- **Who may control a bot** (command, invite, kick, despawn / respawn): the creator; else access 3+; else, if the bot has an allow list, only those on it; else anyone at the action's minimum. One pure function (`canControlBot`), unit-tested. Allow lists hold saved characters' ids (security review 2026-11-20: never display names), editable by the creator from the Players list. Nobody despawns a Named out of another player's party (access 3+ excepted). A creator's bots that are lent to another party or in a boss fight outlive the 60 s grace until free. Renaming / skill / behaviour / Dismiss stay with the creator (or access 3+).
- **The Named's invites need no tier** (`INVITE_NEEDS_TIER = false` in `shared/named.js`; the old gate is one flag away); friendship is otherwise unchanged, Sworn calls keep their tier, and one Named per party stays.

## Tasks
**Status 2026-11-20: A–K are done and merged** (specs kept below for reference), except F7 (film work, paused by the owner). What to do next and the owner calls waiting: `docs/NEXT.md`.

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

- **Movement names:** `forceBossMove` takes `horn_sweep`, `slam`, `charge`, `quake`, `rockfall` (Warden) and `tidal_wave`, `geyser`, `trident`, `deluge` (Sovereign); `hammerfall`, `lightning`, `gale_push`, `overload`, `tempest_beam` (Colossus, H4); `meteor`, `spread`, `tether` (team mechanics, any boss: G4); `vines`, `pillar`, `crystal` (rescue traps, any boss: J1).
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
   - **Landmarks:** `town_square`, `fountain`, `merchant`, `smith`, `skill_shrine`, `hall_of_clearers`, `waypoint` / `well` (old name `waystone`: the fountain), `north_road`, `raid_gate`, `arena_edge`, `arena_center`, `mire_camp`, `mire_shrine`, `drowned_wood`, `sunken_gate`, `sovereign_court`; or an actor id, a boss/spawn label, or `[x, z]`. Take coordinates from `shared/data.js`, `shared/floor2.js`, `shared/items.js`, `shared/crafting.js`, `shared/mastery.js`, `shared/titles.js`.
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

## H. Floor 2 polish, loot and builds, AI companions live, Floor 3 (owner request 2026-11-18)
Owner decisions: do H1–H4 in parallel. **Skip for now:** achievements, weekly board and cosmetics, and more film work (F7 stays where it is). Owner played Floor 2: "the boss is much easier than floor 1, but it plays nicely".

### Tracker
Same rules as F and G: set Status/Owner on `main` first, then mark it **done** with the merge commit. Merge under the `flock` lock and **push with `--force-with-lease`**.

| Task | Branch | Status | Owner | Merge |
|---|---|---|---|---|
| H1 Floor 2 polish + harder Sovereign | `feat/floor2polish` | done | agent floor2polish-2 | f5cfbac |
| H2 Loot and builds | `feat/loot` | done: affixes, Hornbound + Tidebound sets, drop tables in `shared/loot.js` (H1/H4 add entries there), Smith reroll, loadouts, admin affix/set editor + Maxed set, bots | agent loot-2 | 0c63276, 3f7298d |
| H3 AI companions: go live | `feat/ailive` | done | agent ailive-2 | c6bea00 |
| H4 Floor 3 | `feat/floor3` | done | agent floor3-2 | 5bfdd51 |

### Shared contracts for H
- **Loot tables are data** (H2 owns them in `shared/items.js` / new `shared/loot.js`): affixes, sets and drop tables keyed by source (`mob:<type>`, `boss:<id>`, `rare:<id>`). H1 and H4 add *entries* for their floor's bosses and mobs through those tables, never with custom drop code. If H2 hasn't merged yet, keep the floor's drops as today and leave a `TODO(H2)` note naming the set you'd add.
- **Floors are data where possible.** H4 follows the Floor 2 pattern (`shared/floor2.js`, `server/floor2.js`, `public/floor2world.js`, `public/floor2client.js`) as `floor3`. Where Floor 2 code hardcodes "floor 2", generalise it carefully (H1 touches the same files, so keep those diffs small and merge often).
- **G systems apply on every floor:** downed/revive, combos and Team Burst, threat/Cover/flanking, boss team mechanics (`server/bossteam.js`) and the MVP card all work in Floor 3 fights.
- **Film safety** as in G: director shows keep their rehearsed numbers.
- **Bots** play every new thing, scaled by capability.

### H1. Floor 2 polish + a harder Sovereign (`feat/floor2polish`)
1. **Bot play pass:** run bot parties through Floor 2 (fields, rare elites, the Sovereign) and fix what breaks: pathing in the Mire, Floor 2 mob mechanics, the Sovereign's moves, warp and camp. Report what you found.
2. **Sovereign wind-up poses and readable channels**, like the Warden's (task B): bone poses for the trident, geysers, Tidal Wave and Deluge, and telegraphs that fill up toward impact.
3. **Harder Sovereign:** the owner says it's much easier than the Warden. Tune its health and damage scaling like the G5 Warden pass, and add a twist pool if it has none. Target at skill 5:
   - trio: about 90–130 s, winning most runs;
   - 6 bots: about 90–140 s with a few downs;
   - skill 4: wipes sometimes.

   It should feel like a step up from the Warden.
4. **Accept when:** a bot play-pass report exists, Sovereign numbers are in range, pose screenshots are taken, and all tests pass.

### H2. Loot and builds (`feat/loot`)
1. **Affixes:** armor, charms and weapons roll 1–3 bonus stats by rarity, e.g. crit, haste, max HP, damage reduction, posture damage, healing done, threat, skill-specific bonuses ("+15% Whirl damage", "Taunt cooldown −2 s") and team bonuses ("+10% combo damage", "revive 20% faster"). Tooltips show them, and the Smith can reroll one affix for gold and materials.
2. **Sets:** 2–3 piece sets per boss (Warden and Sovereign now, Floor 3 via H4), with 2-piece and 3-piece bonuses. Sets drop from their boss (better odds for the Last Attack), and the bag and character sheet show set progress.
3. **Loadouts:** save up to 3 loadouts (gear, weapon style, talents) and swap at the Skill Shrine or in town, never mid-fight.
4. **Drop tables as data**, per the contract above. Rare elites get small chances at set pieces.
5. **Saving:** existing characters keep their items. Old items simply have no affixes. Make the database changes in `server/db.js` safe to run twice.
6. Update the admin page: the item editor shows and edits affixes and sets, and the "Maxed" preset gives a full set plus good affixes.
7. Bots use the premade setups (give their gear sensible affixes) and pick loot sensibly.
8. **Accept when:** tests cover affix rolls, set bonuses, reroll, loadout swap and save/load; old characters load fine; screenshots of the tooltip, the set progress and the loadout UI.

### H3. AI companions: go live (`feat/ailive`)
The owner is adding `ANTHROPIC_API_KEY` in Render (provider `anthropic`, model default).
1. **Bot memories survive restarts:** a small table (in `server/db.js`, safe to run twice) holding per bot and per player notes, capped and pruned.
2. **Admin "Test call" button:** one tiny real call that shows OK/error, latency and cost, so the owner can confirm the key works. Never show the key; show only the last 4 characters at most.
3. **In-game:**
   - a guide tip ("Talk to bots by name in chat: 'Lyra, hang back and heal me'");
   - a small indicator over a bot when its AI "mind" is thinking;
   - the bot's reply comes as a speech bubble (F1).
4. **Safety and budget:**
   - check the `AI_DAILY_USD` cap and the per-bot rate limits;
   - make sure it never turns on without a key;
   - with `AI_ENABLED=1` set, it turns on automatically after each deploy.
5. Update `docs/research/ai-companions.md` section 8 with the exact Render steps.
6. **Accept when:** mock tests cover memory persistence and the test-call path; with no key, behaviour is identical to today.

### H4. Floor 3 (`feat/floor3`)
1. **Design first:** write `docs/floor3.md` (theme, zone layout, a safe camp, 3–4 field mobs with one new mechanic each, 1–2 rare elites, the boss with 3 phases, how players unlock and warp there, level cap to 30), and commit it before building. Pick a theme that contrasts with the forest (Floor 1) and swamp (Floor 2), e.g. a wind-swept cliff or ruin, crystal caverns, or a burning forge. Write a short "story beat" line for the film team too.
2. **Build:**
   - the zone (world mesh, lighting and fog palette, camp, warp from the Floor 2 boss clear);
   - mobs, rare elites and the boss, with wind-up poses and readable telegraphs from day one;
   - a boss twist pool;
   - at least one new boss mechanic that uses the G team systems (e.g. a mechanic that needs a Switch or a Team Burst to survive, or a two-platform split).
3. **Progression:** level cap 30 with XP curve, mastery and talent points, and premade bot setups extending to 30. Floor 3 loot comes via H2's tables (a set for the boss).
4. **Tuning target at skill 5:**
   - trio: about 100–150 s;
   - 6 bots: about 100–160 s;
   - harder than the Sovereign after H1.
5. Update the guide, README and admin (warp, spawn Floor 3 bots), and the stats page knows Floor 3.
6. **Accept when:** a bot party at level 30 can warp there, clear the field and kill the boss; there's a screenshot tour of the zone and every boss telegraph; tests pass.

## I. The Named: AI characters who live in the tower (owner request 2026-11-18)
Persistent NPC characters who play the game like players do, and whom players can befriend. Owner decisions: build it; **not** the story cast (original characters); **one loner** at first, who must **look like a specific, recognisable character** (his own silhouette and gear, original design, not a copy of any existing IP); one **Heroes Party**.

**Principle:** systems are code; AI (the existing `server/ai/` mind layer) adds conversation, personality, memory, and *bounded* nudges. Combat stays fully coded (the bot brain at capability 5); the AI only sets intent.

### Tracker
Same rules as F/G/H (flock lock, push with `--force-with-lease`).

| Task | Branch | Status | Owner | Merge |
|---|---|---|---|---|
| I1 Named characters + friendship (code) | `feat/named` | done | agent named | 0058550, 8e70c2d, 3a0d087 |
| I2 The loner's look | `feat/lonerlook` | done: looks in `shared/looks.js` (Cairn + the Hearthward), `game.setLook`, snapshot `looks`, admin Look picker; I1 calls `setLook(p, def.look.id)` | agent lonerlook | f6686dc |
| I3 Personalities, talk, memory, nudges (AI) | `feat/namedai` | done: talk by name / @Name / Talk button, sheets, bounded nudges, memories, own budget slice; live check pending (no key locally: admin **Test Named talk**) | agent namedai | 49d3a31 |
| I4 Requests and invitations | `feat/namedquests` | done: requests (kill / bring / boss help) + outreach + phrasing hook; talk hands materials over | agent namedquests | e36cb22 |

- **I1 review fixes merged (274b300):** friendship load can't overwrite stored rows, one Named per party re-checked on accept and calls, Named-only clears are quiet on all floors, Friends tab only with `NAMED_ENABLED` on, bot names reserved, boss help counts healing done to others, shutdown awaits the Named's writes, plus the nice-to-haves.
- **I3/I4 glue merged (890343e):** requests, thank-yous and invitations are phrased by the AI in each Named's voice (count and target fixed by the template, same guard as talk, 10 a player a day on the Named slice, canned on any failure or after 3 s), and talk knows your active or recent request with that Named.

### Shared contracts for I (from the Fable plan review, 2026-11-18: these override the task text below where they differ)
- **Humans first.**
  - A Named never lands a boss's killing blow while a human contributor is alive (reuse `lastAttackHeld`).
  - A field mob a human damaged gives that human full XP and loot.
  - MVP titles go to humans first.
- **Clears.** A clear with no human contributor:
  - is never "first", rings no bell and gives no `floorClearsFirst`;
  - is listed apart (a "Heroes' record"), not in the fastest or recent lists.
- **Bosses.**
  - The Named start a boss only when no human is in or near the arena.
  - They never enter a human's fight unless partied with that human.
  - "Helped their fight" needs at least 10% of the damage or healing.
- **Presence.** The free Render plan sleeps when idle, so:
  - the Named are simulated only while at least 1 human is online, and only on a floor a human is on;
  - away time is summarised in code ("while you were away…");
  - there are no database writes with no humans online.
- **A separate bot kind** (`e.named`). The Named:
  - have reserved slots outside `MAX_BOTS`;
  - don't appear in the Bots tab and aren't removed by admin "remove all";
  - accept invites (`onInvite`) only by the tier rules (2026-11-20: off, `INVITE_NEEDS_TIER`; they are in the Players list's Bots section, not the Bots tab);
  - are parked during director shows;
  - are flagged `named` in tracking, and Named-only fights are not written.
- **Identity.** Friendship and memories are keyed by `charId`; anonymous players get session-only friendship. The Named's names are reserved against character names.
- **Kill switch:** `NAMED_ENABLED=0` leaves the game identical to today.

### Amendments to I1–I4 (from the review)
- **I1.2:** persist level and friendship only; gear is premade by level (`loadoutFor`). No schedules in v1.
- **I1.3:** level is the top-3 average of non-admin characters active in the last 14 days, +2, capped. It never drops.
- **I1.4 friendship:**
  - **Gains:** fighting within 25 m of them on a shared target, reviving them, healing or Covering them, and real help in their boss fight.
  - **Not in v1:** trade and gifts.
  - **The only loss:** leaving them downed within 40 m. A tier, once reached, is never lost.
  - **Daily cap:** per Named, resetting at 10:00 UTC.
  - **Pacing targets:** a Hero at Ally in about 2 sessions and Friend in about 5; the loner at Friend in about 8–10.
- **I1.5 invites and summons:**
  - An invited Hero leaves the Heroes for your party, and returns on disband or after 10 min idle.
  - One Named per human party.
  - Sworn summons are first-come, with a 10 min cooldown.
- **I1.5b (new):** at Friend, the loner whispers you an invite (a canned line) when he heads for a boss and you're online. At most 1 per hour, and none after a decline in that session.
- **I1.8 also accept when:**
  - tick p95 is under 25 ms with 2 humans + 6 player bots + 5 Named;
  - a director show runs with the Named parked.
- **I1/I2 split:** I1 lands a `shared/named.js` stub first; I2 only fills `look`.
- **I3:** a separate talk path and schema (`say`, `sentiment`, `remember`), not the party companion's intent, and it works outside a party. Each player can make at most 30 talk calls to the Named per day. Friendship from chat is capped at +3 per day and can't cross a tier by itself.
- **I4:** no dependency on I3: templates with canned text, AI phrasing optional. v1 templates are kill N, bring N materials, and help in a boss fight. Escort, spar and the keepsake are cut.

### I1. Named characters + friendship (`feat/named`)
1. **Data:** `shared/named.js` defines each Named: id, name, class, style, look (I2), group (`heroes` or `loner`), personality numbers (how fast friendship grows from each source, what lowers it, the threshold to accept invites), home zone, and a short persona text for I3.
   - The **Heroes Party** has 4 members (tank, healer, 2 damage). Give them original names and a party name.
   - The **Loner** is a solo character with slow trust that grows mostly from fighting beside him and never asking for help. He refuses parties until Friend.
2. **Living in the world:** they're server-run bots (reuse botmanager / brain at skill 5) that persist across restarts in Postgres (safe migration), log in on a schedule, farm, gear up through H2 loot, attempt bosses, and get carved in the Hall of Clearers.
   - The Heroes travel as their party; the loner roams alone.
3. **Level scaling:** they stay at the highest current player level (or the top-3 average) + 2, capped at the level cap. They level up as players do and never drop.
4. **Friendship per player (0–100) with tiers:** Stranger (0) → Known (15) → Ally (35) → Friend (60) → Sworn (85). Stored per player and character in Postgres.
   - **Gains:** fight near them, revive them, Cover/heal them, trade or gift, help in their boss fight, finish their request (I4).
   - **Losses:** stealing their Last Attack, abandoning them downed, attacking their target off-cue (pick sensible rules).
   - Each gain is capped per day so it can't be farmed.
5. **Invites by tier:**
   - **Ally:** a Hero accepts your party invite. The loner only accepts at Friend.
   - **Sworn:** they'll come when you call (`/b` order or menu) if they're online and free.
   - Everyone sees their normal party-full and busy rules.
6. **UI:** a **Friends** tab in the Players panel listing the Named with portrait colour, tier, bar and status (where they are, what they're doing). Tier-up toasts.
7. **Admin:** see and edit friendship, spawn and despawn the Named, set their level offset.
8. **Accept when:**
   - tests cover the tiers, daily caps, invite thresholds, level scaling and persistence;
   - a run shows the Heroes clearing the Warden on their own;
   - screenshots of the Friends tab.

**Built (I1):**
- **Who:** the Hearthward (Halvard, Guardian tank; Maribel, Cleric healer; Tovin, Ranger; Sennet, Lancer) and Cairn the loner (Lancer, Glaive: his look's lantern glaive). Data, rules and canned lines: `shared/named.js`.
- **Where:** `server/named.js` (`installNamed` wrappers on Game + `NamedManager`), `server/named-admin.js`, `public/named.js` (Friends tab), `public/admin-named.js`, tables `named_chars` and `named_friendship`, `floor_clears.heroes`. README "The Named" has every number.
- **Contract for I3 / I4:**
  - `game.namedFriendship(player, namedId)` → `{ pts, tier, tierIndex, tierName, left }` (or `null`: no such Named, a bot, or `NAMED_ENABLED=0`).
  - `game.addFriendship(player, namedId, amount, reason)` → `{ d, pts, tier, up }`. `reason` is a source: `chat` (already capped at +3 a day and never across a tier; negative amounts never cost a tier), `request`, or any `GAINS` key. Everything shares the one daily cap per Named, except `request` (I4 caps it itself).
  - `game.named` is the manager: `chars` (id → `{ def, lvl, e (the BotManager entry), … }`), `playerOf(st)`, `say(p, text)` (a speech bubble), `hostOf(p)`, `listFor(player)`. Each `def` has `persona`, `blurb`, `trust` and `namedLine(def, key, vars)` canned lines (`refuse`, `busy`, `taken`, `join`, `called`, `home`, `raid`).
  - The existing AI minds skip `e.named` entries (`server/ai/index.js`), so I3's talk path is the only one that speaks for them.
  - Client: `{ type: 'named', op: 'fr', … }` already drives tier-up banners; add ops beside `list` / `invite` / `call` in `NamedManager.handle`.
- **Cairn is a Glaive Lancer** (changed from Berserker after I2 gave his look a lantern glaive): the premade Lancer setup, Lancer talents and evolutions; alone he killed the Warden 3 of 3 times at levels 12, 16 and 20. His look's weapon carries its own standing clip (`weapon.idle` in `shared/looks.js`), so he holds the glaive upright on the Lancer rig too.
- **Left for later:** Floor 2 and 3 boss attempts by the Named are wired but only bot-tested on Floor 1; "attacking their target off-cue" and trade or gifts were cut by the review; the away line is flavour only.

### I2. The loner's look (`feat/lonerlook`)
Give the loner a **recognisable character look**, original and not copied from any anime or game. He needs a strong silhouette at distance:
- e.g. a long tattered coat or cloak, a hood or mask, a distinct hair colour, a signature weapon model (oversized or unusual), a colour scheme nobody else uses, and a subtle aura or trail.

Build it with the KayKit rig, procedural meshes and materials, the way `public/styles.js` builds weapon models. Make it data-driven (`look` in `shared/named.js`) so the Heroes can get distinct touches too (party colour, emblem). Show a portrait or swatch in the Friends tab and nameplate.

**Accept when:** close-up and in-world screenshots show him readable from 20 m away, and he looks like nobody else in the game.

**Built (I2):**
- **Cairn's look** (`cairn`): ash-pale tattered long coat over soot-black, a deep hood with a long tail and a dark band over the mouth, a half-mantle with his mark (three stacked stones), a hooked glaive with a caged wisp-lantern, and pale yellow-green wisp-light (motes and a short trail). He is the only colourless figure; nobody else carries that light. Nameplate: his colour, badge and "the Last Lamp".
- **The Hearthward** (`halvard`, `maribel`, `tovin`, `sennet` on the `hearthward` base): an ember cape with the hearth-flame emblem, a matching nameplate, a trim colour each (I1's portrait colours). Data only.
- **Where:** definitions in `shared/looks.js` (keyed by look id); `shared/named.js` points at them with `look: { id, color }`.
- **Contract for I1 / I3:**
  - Server: `game.setLook(p, def.look.id)` when a Named spawns (and again after any respawn). It works on any entity with an id and is listed in snapshots as `w.looks`. Nothing wears a look unless something calls it, so `NAMED_ENABLED=0` changes nothing.
  - Client: nothing to do for the model or nameplate. For lists (the Friends tab): `import { lookSwatch } from '/looks.js'`, then `lookSwatch(def.look.id, px)` returns the badge HTML (works for offline characters too).
- **Preview without I1:** admin page → a bot's **Look** picker; or `TEST_HOOKS=1` and `{ type: 'test', look: 'cairn' }`.
- **Screenshots:** `/home/claude/shots/i2-lonerlook/`.

### I3. Personalities, talk, memory, nudges (`feat/namedai`) — after I1
1. Each Named gets a persona sheet (voice, likes, dislikes, goals, secrets) in `shared/named.js`. It's fed to the AI mind with their friendship tier for the speaking player and their memories of that player.
2. Players talk to a Named by name in chat or through a "Talk" button (Friends tab or nameplate); replies come as speech bubbles.
3. After each exchange the AI returns a structured `sentiment` (−2…+2) and a reason. The code turns it into a **bounded** friendship change (e.g. ±1–3, daily cap) — the AI can never jump tiers.
4. Memories per Named per player (the existing `ai_memories` table) record what happened together.
5. Without a key or with AI off, the Named still work: canned lines by tier, and no friendship from chat.
6. **Accept when:** mock-provider tests cover tier-aware prompts, bounded nudges and fallback; there's a live check with the real key that costs cents.

**Built (I3):**
- **Where:** `server/ai/namedtalk.js` (talk path, schema `{ say, sentiment, reason, remember }`, prompt, limits, notes; wired by `installAI` when `game.named` exists), `server/ai/namedsheets.js` (server-only sheets: voice, likes, dislikes, goals, secret, canned lines by tier), budget slices in `server/ai/budget.js` (kind `named`), `ai_memories.kind` and `ai_spend.named_usd` migrations, Talk buttons in `public/named.js` and on a selected Named's nameplate (`public/main.js`), admin line + **Test Named talk** in `public/admin-ai.js`. README "The Named → Talking to them" has every number.
- **Hooks for I4:** `game.namedTalk` (null without the Named): `talk(p, st, text)` runs one exchange; `cannedLine(def, tier, who)`, `systemFor(def)`, `talkPrompt(ctx)`, `TALK_SCHEMA` and `sanitizeTalk` are exported to phrase a request in character; `budget.allow(null, 'named')` / `start` / `end(..., 'named')` keep it on the Named slice.
- **Left:** the live check against the real key (press **Test Named talk** on the admin page after deploy: about $0.0002); per-player daily talk counts live in memory (a restart resets them; the $ cap still holds).

### I4. Requests and invitations (`feat/namedquests`) — after I1 and I3
1. **Personal requests** from templates (kill N of a mob, bring N materials, help in a boss fight, escort or spar). The AI picks and phrases them in character; code tracks and rewards them (friendship, gold, a small unique keepsake at Sworn).
2. **Outreach:** at Friend and above, a Named may message you (whisper / chat) to invite you to a raid or a farm when you're online. Rate-limited, and polite if declined.
3. **Accept when:** tests cover request tracking and rewards and outreach rate limits.

**Built (I4):**
- **Where:** data and rules `shared/namedquests.js` (templates, `PERSONA`, `REQ`, `OUTREACH`, `phraseRequest`); `server/namedquests.js` (`new NamedQuests(named)` in `server/index.js` hooks the manager's `tick`, `handle`, `listFor`, `onMobDead`, `add`, `dropFriends`, `flush` on that instance; `server/named.js` is unchanged); `public/namedquests.js` (the request card in the Friends tab, toasts, the outreach card); table `named_requests` (per character and Named: the active request, next offer, today's request friendship).
- **Requests:** kill N (your floor, your level band; Named-only kills never count), bring N materials (Turn in within 12 m), help in their boss fight (real help in a kill). One active per Named, 24 h. Halvard kills + boss help, Maribel materials, Tovin kills (×1.5), Sennet boss help first, Cairn rarely (30% every 4 h) from Known. Rewards: gold (15 + 4 × level, boss ×2), sometimes a rolled item (`shared/loot.js` `rollGear`), friendship through `'request'`, which now skips the shared daily cap (`shared/named.js` `gainFriendship`) and is capped at 6 a day per Named by I4.
- **Outreach:** Heroes at Friend+ message a free, online player (farm or raid, Accept / Decline): 1 h per Hero, 15 min across all, none after a decline that session, none in a show or mid-boss; Accept = they join your party. Cairn's whisper unchanged.
- **Contract for I3:** `game.named.quests.phraser = async (def, req, player, moment) => text` replaces the canned line when it answers (moments: `offer`, `done`, `farm`, `raid`; errors or empty keep the canned line). `game.named.quests.turnIn(player, namedId, { talk: true })` hands materials over while talking; I3's talk path (`server/ai/namedtalk.js`) now calls it after a reply within 40 m. The phraser is not wired to the AI yet (canned lines for now).
- **Screenshots:** `/home/claude/shots/i4-namedquests/`.

## J. Interactive boss fights and threat rules (owner request 2026-11-19)
The owner's words, summarised:
- Boss fights should be more interactive, not just "the boss swings around and spams abilities". Players should have to run around and do things, and save each other: vines that root someone and others cut them free, a crystal prison others smash, a cone or beam of light someone is trapped in.
- From Floor 3 on, fights should have multiple **areas**, not only phases: the ground breaks, everyone falls into a new arena with new environment rules (sludge that slows you, fire patches to move around).
- Ranged players can still hang back and hit the boss, but melee players need **real openings** to get in without suicide, while staying the riskier, higher-damage role.
- Threat changes are listed in J4.

### Tracker
Same rules as F–I: flock lock, push with `--force-with-lease`.

| Task | Branch | Status | Owner | Merge |
|---|---|---|---|---|
| J1 Rescue mechanics | `feat/rescue` | done | agent rescue | db4a5a7 |
| J2 Multi-area boss fights (Floor 3 first) | `feat/arenas` | done | agent arenas | f0fdc9c |
| J3 Boss timing tables + melee openings + tuning harness | `feat/openings` | done (hard-review fixes 3a4c448) | batch 2026-11-19 | f9ece59 |
| J4 Threat rules | `feat/threatrules` | done | agent threatrules | 2e52b29 |

### Shared contracts for J
- **Every new mechanic** is telegraphed, has a guide tip and a first-few-times prompt, works with bots at all capability levels, respects the director (no surprise mechanics during a show unless a cue asks), and skips downed and dead players.
- **Solo stays fair.** A rescue mechanic either never targets a lone player, or the trapped player can free themselves more slowly (e.g. by mashing an action) so a solo player can't be soft-locked.
- **Credit** through `teamStat` (`rescue` key) and the MVP card ("Rescuer" title).
- **Data-driven:** mechanics are described in shared tables, with small server modules and client visuals. Bosses opt in per phase.

### Review amendments for J (Fable plan review, 2026-11-19: these override the task text below where they differ)
**Order and ownership.** J1, J2 and J4 run in parallel; **J3 runs after J1 and J2** and moves all boss timings (including theirs) into the tables.
- **J1** owns `server/bossteam.js` and a new `server/rescue.js`.
- **J2** owns `server/floor3.js` and `public/floor3world.js`.
- **J4** owns `server/threat.js` and the taunt cases in `game.js` / `mastery.js`.

**Shared contracts addendum**
- **One target picker.** `targetOf(m)` in `server/threat.js` is the only place targets are chosen: the lock holder, otherwise the top threat among living, non-trapped players. J4 builds it and replaces the copies in `game.js:~988`, `floor2.js:~68`, `floor3.js:~82`, `staging.js:~32`, talents' `topThreat` and threat's `topThreat`. J1 only sets `p.trap`.
- **One team-scale mechanic per boss at a time** (G4 moves, J1 traps, Overload, the J2 transition), at least 8 s apart. Traps are new `BOSSTEAM` moves, not a new timer. They:
  - need at least 2 free standing fighters;
  - never pick the boss's current target;
  - are off during director shows;
  - are available to `forceBossMove`.
- **Trap auto-release.** A trap releases harmlessly if no free ally remains to rescue. This covers solo play and a duo whose partner is down.
- **J2 area is a state, not a place.** `m.area` lives on the same x,z footprint and is sent in `f3Snap` so reconnects and late joiners get it. `inArena3` is unchanged. The fall is a client effect.
- **J2 rendering budget.** The lower arena keeps the same light count (recolour only). Fire uses emissive meshes, never new `PointLight`s, so shader warm-up still holds.

**J1 changes**
- **v1 traps, one per boss:**
  - Warden: vines (Thornbind);
  - Sovereign: Drowning Pillar;
  - Colossus: storm crystal.
- **Trap objects** are mobs flagged `prop`: no threat, XP, loot, posture or mastery, and they can't be taunted.
- **Hold E:** revive wins over freeing someone from a trap.
- **Cut:** "slows the boss's target swaps".
- **Cut from v1:** the J1.4 run-around objectives, since Overload already fills that role.

**J2 changes**
- **When the transition fires:**
  - It waits until nothing else is active (Overload, a wind-up, a G4 move, a trap), then clears beams and strikes.
  - It fires once, even if a burst skips a phase.
  - It resets on a wipe or respawn.
  - Bleed-out is paused during the landing.
- **Cut from v1:**
  - the third area;
  - the raised platform (the server has no heights).
- **Fire:** fixed patterns, at most 10 patches, checked at 5 Hz.

**J3 changes**
- **Melee is defined as `inFlankReach`.**
- **The opening bonus** is added to the flank bonus (not multiplied), doesn't apply while the boss is Grounded, and doesn't stack multiplicatively with Switch, Pincer or Grounded.
- **Gaps and openings are off during director shows.** Re-run the Episode 1 rehearsal after J4.

**J4 numbers** (`shared/threat.js`: `TAUNT`, `CLEAN`). These replace J4.2–J4.3; J4.3 is folded into the general cut.
- **Scope and lock length:** every mob the skill hits.
  - Taunt and War Cry lock for 6 s, Challenge for 8 s (× the Provoke talent's duration bonus, never more than cooldown − 3 s).
  - Phalanx sets the user to the top, with no lock and no cuts.
- **On taunt of m by T:**
  ```
  R = max(best non-taunter threat/s on m over the last 6 s, 2 × highest fighter atk)
  L = 24 × R
  every entry ×= L / max(top, 1); then T = L; others = min(v, 0.5 L)
  everyone's clean multiplier → ×1.0;  m.lock = { by: T, L, until }
  ```
  A steady damage dealer gains about 25% of L per lock.
- **During the lock:** the target is T, T's entry is frozen at L, and others build normally.
- **When the lock ends:** T = 0.9 L, and the target becomes the highest entry (a tie goes to T). The lock ends early if T is dead, downed, trapped or out of the room.
- **Re-taunt by anyone:** the same steps, from the current values. It replaces the lock.
- **Clean multiplier** (one per player; applies on bosses and elites):
  - It equals `min(2.5, 1 + 0.05 × cleanSecs)`.
  - `cleanSecs` only advances if the player damaged a boss or elite in the last 3 s.
  - It resets to 0 on any HP or shield loss (not on hits that were evaded, parried or Covered), a taunt, being downed, or the end of the fight.
  - It multiplies damage threat only, not heal threat.
- **Meter:**
  - During a lock, the percentage is `v / L` (shown up to 150); otherwise it's % of top.
  - `me.th = [bossId, pct, nextPct, mult×10, lockSecs, lockById]`.
- **Bots:**
  - Bot tanks don't taunt a mob held or locked by another Guardian (no ping-pong between two tanks).
  - Only bots at skill 4 and above ease off at 90%.
- **Accept when:** a skill-5 steady damage dealer ends a lock at 75–85%. Report the tank's share of boss time with and without taunting.

### J1. Rescue mechanics (`feat/rescue`)
A generic "trapped player" system plus three trap types. Each boss gets at least one:
1. **Vines (root):** the target is rooted and takes light damage over time. Teammates free them by hitting the vine (it has its own small HP bar) or by standing next to them and holding the interact key for ~1.5 s. The Warden (Floor 1, forest) gets this, e.g. "Thornbind".
2. **Crystal prison:** the target is encased (can't act, can't be hurt by the boss), and a crystal with HP spawns on them. Teammates must break it within ~8 s or the prison detonates and hurts the whole party. The Floor 3 Colossus gets this: storm crystal.
3. **Cone or beam of light:** the target is pinned inside a beam from the sky or the boss. Teammates break the beam at its source (a pylon or orb somewhere in the arena), or a Guardian body-blocks the beam with Cover or Guard. The beam ticks damage and slows the boss's target swaps. The Sovereign (Floor 2) gets a water or moonlight variant: "Drowning Pillar".
4. **Objectives that make people run:** in at least one phase per boss, a party-wide objective, e.g. light 3 braziers or pylons around the arena within a timer, or stand on plates together. Failing means a heavy party hit or an enrage.
5. **Bots:** they free trapped allies (skill-scaled reaction time and priority) and run objectives. The tank keeps the boss.
6. **Accept when:** tests cover each trap's free / fail / timeout path and the solo fallback; bot Warden, Sovereign and Colossus runs still clear at skill 5 with numbers reported; screenshots of each trap.

### J2. Multi-area boss fights (`feat/arenas`), Floor 3 first
1. **The Storm Colossus fight gets a second arena.** At a phase change the plateau cracks (telegraphed: rumble, cracks spreading, a few seconds' warning), and everyone falls to a lower area under the ruin: a different layout and lighting.
2. **Environment rules in the new area:**
   - **sludge pools:** strong slow, no dodge inside;
   - **fire patches or lightning-charged ground:** damage over time, spreading or moving in patterns;
   - **at least one cover or safe element:** a pillar to break line of sight from a beam, or a raised platform.
3. Falling does no damage. There's a short "landing" pause, then the fight resumes. The boss follows: it drops down with a big entrance.
4. Optional: a third area for the last phase (e.g. back up via a wind updraft).
5. The arenas are built in `public/floor3world.js` (or a new file). The server keeps both arena layouts and teleports or offsets everyone at the transition. Spectators and the director handle it.
6. Make it **generic** (an `arenas` list per boss with transitions per phase) so the Warden and the Sovereign can get one later.
7. **Accept when:** a bot party clears the Colossus through the fall and the new hazards (trio and 6 at skill 5, numbers reported); there's a screenshot tour of the fall and the lower arena; tests cover the transition (everyone moved, nobody stuck in walls, late joiners spawn in the right arena).

### J3. Boss timing tables and melee openings (`feat/openings`), after J1
The owner's intent: melee openings are really **the gaps between the boss's close-range and all-around attacks**. After certain abilities, or after a **sequence** of abilities, the boss pauses, walks a bit or is stunned, and melee gets in. Every one of these timings should be **defined in data**, so a boss's difficulty is tuned by changing numbers and re-running bots, not by rewriting AI code.

1. **Boss timing tables** (`shared/bosstiming.js`, or per-boss files in `shared/`), for the Warden, the Sovereign and the Colossus:
   - **Per ability:** wind-up (telegraph) time, active duration, damage (as a multiple of the boss's attack), radius/shape, **avoidability** (how it's avoided: roll, jump, block, parry, outrange, none, plus the safe-window timing), posture damage, cooldown, and **`after`**: the pause/recovery after the ability, with what the boss does then (`idle`, `walk`, `planted`, `stunned`, `exposed`).
   - **Per phase, sequences** (combos): ordered lists of abilities with **gaps between steps** and a **pause after the sequence** (the main melee opening), and weights for how often each sequence is chosen. Example: `[slam →0.6s→ slam →1.0s→ hornSweep] then 3.0s exposed`.
   - **Global difficulty knobs per boss:** `damageMul`, `windupMul`, `gapMul`, `pauseMul`, `cooldownMul`, so a boss is made easier or harder in one place. Add an optional per-party-size override.
   - Move the existing hard-coded timings (`shared/data.js` Warden constants, the floor 2 and floor 3 boss tuning) into these tables **without changing behaviour at first**. Test that the default tables reproduce today's numbers. Then tune.
2. **Openings:**
   - After a sequence (and after selected big abilities) the boss enters its `after` state for the table's time. In `exposed`/`stunned`/`planted` a glowing weak point shows, an **"OPENING"** tag appears over the boss (visible to everyone), and melee hits there get +25% damage and posture (in the table).
   - **No point-blank chaining:** add a minimum gap between close-range or all-around attacks (in the table), and make the boss favour telegraphed area moves over instant swings.
   - Melee stays the riskier, higher-damage role. Ranged stays steady but lower.
3. **Tuning harness** (`scripts/tuneboss.js`):
   - Runs bot parties (trio and 6, at skills 3/4/5) against a boss with given knob values.
   - Prints a table: kill rate, time, downs/deaths, damage share by role (melee vs ranged vs healer), how often each ability hit someone, and how much opening time melee actually used.
   - Can sweep one knob over a range (e.g. `--sweep pauseMul=0.6:1.4:0.2`) so we can pick values.
   - Optional: an admin page panel to view the current tables and live-override the knobs on a running server, for play-testing with friends. Overrides aren't saved unless exported.
4. **Bots** read the same tables: melee bots move in when an opening starts and step out before it ends, and they respect each ability's avoidability (roll vs jump vs outrange).
5. **Accept when:**
   - the default tables reproduce today's behaviour (tests);
   - a tuned pass on all three bosses gives a higher melee damage share without more melee deaths, with before/after numbers from the harness;
   - the README has a "Tuning bosses" section showing how to change a table and run the harness.

### J4. Threat rules (`feat/threatrules`)
Threat stays a raw number per player per enemy, but the rules below are stated in **percent of the current top threat** (100 = the top). The meter already shows "You 62% of top" (G3).
1. **Clean-damage multiplier.** While a player deals damage to a boss *without taking damage* from it, their threat multiplier grows over time:
   - e.g. ×1.0 rising by +0.1 every 2 s of clean damage, up to ×2.5;
   - it resets to ×1.0 when they take any damage from that boss or its mechanics.

   A ranged player who never gets hit therefore eventually pulls the boss. Show the multiplier on the threat meter (e.g. "×1.6") so players see it coming.
2. **Taunt (the Guardian's Taunt skill):**
   - The taunter becomes the top for the taunt's duration (the boss is locked on them), and their threat is set to the top value.
   - Every other player's threat on that boss is cut to 50% of the top, if it was above that, and everyone's clean-damage multiplier resets to ×1.0.
   - During the taunt, others still build threat, but the boss stays on the taunter even if someone passes 100%.
   - When the taunt ends, the taunter's threat drops to **90** on the taunt's scale: 90% of the lock value L, the top value set when the taunt started. Anyone who built above 0.9 × L during the taunt takes the boss; otherwise the tank keeps it. This creates a real "burst while it's taunted, but don't overdo it" rhythm.
   - A second taunt overrides the first: the new taunter becomes the locked top and the same cuts apply. The latest taunt wins.
3. **Losing aggro to a taunt.** A player who held the boss when someone else taunted it drops to 50% of the top (not 0 and not 100), then builds back up normally.
4. Keep healer threat (G3) and the "about to pull" warning at 90%. The threat meter shows "TAUNTED (Halvard) 3s" while a taunt lock is on.
5. Bots respect it: DPS bots ease off as their meter nears 90% during a taunt, and tanks re-taunt on cooldown when the boss turns.
6. **Accept when:** unit tests cover multiplier growth and reset, taunt cuts, taunt lock, the taunt-end handover at 90%, the double taunt, and losing aggro to a taunt; bot runs still clear with the Guardian holding the boss most of the time (report the share of boss time on the tank).

## K. Controls, controller support and accessibility (owner request 2026-11-19)
The owner's words, summarised:
- Add a **Controls** screen reached from the Esc menu (Esc → Controls, or a Controls tab next to Settings).
- At the top, an **Input device** choice: **Keyboard & Mouse** or **Controller**. Only one is active at a time, and the game takes input from that one.
- Below it, two tabs to edit the **Keyboard & Mouse** bindings and the **Controller** bindings.
- Each tab starts with a **cool, simply drawn picture** of the device (a keyboard plus mouse, or a controller):
  - Hovering a key or button "presses" or highlights it and shows what it's bound to.
  - Bound keys and buttons carry a ★ marker.
  - Clicking one shows its binding (or "Not bound"). Clicking again, or pressing Edit, picks a control from a list with a type-to-filter box.
- Scrolling down shows **a list of every control** with what it's bound to, editable from there too.
- **One key per control and one control per key.** The exception is **combos**: modifier chords (Ctrl+Z, Ctrl+Shift+Z) or two-key chords (Z+X together).
- **The number of controls should match what a controller can do**, including the combos it can do. Keyboard & Mouse may get a few extras or presets.
- **Verify it with bots that drive controller input.**

### Tracker
Same rules as F–J: flock lock, push with `--force-with-lease`.

| Task | Branch | Status | Owner | Merge |
|---|---|---|---|---|
| K1a Input contract + keyboard rewire + keys test | `feat/input` | done | agent input | 9103a86 |
| K1b Gamepad + focus navigation | `feat/gamepad` | done (real-pad check a0df2b8) | batch 2026-11-19 | 0fffadd |
| K2 Controls screen (pictures, lists, editing) | `feat/controlsui` | done (hard-review fixes 2a2fc9a) | batch 2026-11-19 | eb1a318 |
| K3 Accessibility options | `feat/access` | done | batch 2026-11-19 | b9b1607 |
| K4 Controller verification (scripted gamepad "bots") | `feat/padtest` | done | batch 2026-11-19 | 0bb37d8 |
| K5 Targeting modes + Cleave (Controls → Combat) | `feat/targeting` | built, awaiting merge | agent targeting | — |

### Shared contracts for K
- **Action list** (`shared/controls.js`): every game control has an id, label, group (Move, Camera, Combat, Skills, Items, Social, Menus) and type (`button`, `hold`, `axis`, `toggle`).
  - The set fits a controller: 4 face buttons, 2 bumpers, 2 triggers, 2 stick clicks, a 4-way d-pad and 2 menu buttons, plus **one modifier layer** (hold a bumper or trigger + face button or d-pad) for overflow, such as items and social.
  - Movement and camera are the two sticks. On keyboard and mouse they're WASD and the mouse.
  - A KBM-only extra is allowed if flagged (`kbmOnly`), e.g. chat, F3 overlay, screenshot.
- **Bindings** (`binding` = a key or button, optionally with modifiers or a second key for a chord):
  - one binding per action per device, and no binding used by two actions on the same device;
  - binding a taken key asks to **swap** or **unbind** the other action;
  - defaults per device; "Reset to defaults" per device;
  - saved in localStorage (try/catch), and also on the account when logged in (a small JSONB `settings` on `accounts`, with a migration safe to run twice), so bindings follow you across browsers.
- **Single active device:** the chosen device is the only input source for gameplay. An optional "auto-switch on use" setting is off by default.
  - Chat typing always uses the keyboard.
  - Esc and Start always open the menu, whatever the device.
- **No game logic changes.** Input produces the same calls as today (`useSkill`, `jump`, `dodge`, `guard`, `interact`, `send(...)`). Behaviour is identical with the default keyboard bindings.

### Review amendments for K (Fable plan review, 2026-11-19: these override the task text below where they differ)
**Order.** K1a lands the contract first: small and fast, since `main.js` is busy with J and perf work. After that, these run in parallel:
- **K1b:** gamepad + focus navigation, in new files;
- **K2:** `controlsui.js` + one Game Menu entry;
- **K3:** `settings.js`;
- **K4.**

**Must-fix rules**
1. **Keyboard regression test first.** `test/keys.mjs` lands before any refactor: it presses every current key and checks the resulting `send()` message or `__fb.state` change. It must pass unchanged after K1.
2. **Keyboard keeps today's keys.** It gets an `alt` slot (attack: click + J, bag: B + I, move: WASD + arrows). Actions can carry a `context`: revive (hold E) outranks turn-right (E) when a downed ally is in reach. "One key per control" applies to the main slot. The alt slot is optional and also conflict-checked.
3. **Chords without timing windows.** A key with its own press action can't be part of a chord, and the binding screen refuses it. On the pad, only LB is a modifier, and it has no action of its own.
4. **Device switching can't lock anyone out.**
   - If the pad disconnects, all holds release and input falls back to keyboard & mouse, with a toast.
   - Controller can only be selected while one is connected.
   - The mouse always works in menus; the keyboard always works for chat and Esc.
5. **No pointer lock under Controller,** and canvas clicks don't attack.
6. **Typing fields swallow game keys.** Gameplay actions are ignored when focus is in an input, textarea or select, or during IME composition. Rebind capture swallows everything, and Esc cancels it.
7. **Reserved keys are refused:** Ctrl+W/T/N, Ctrl+Shift+W/T/N, Ctrl+Tab, Cmd+Q/W, F5, F11, F12, Alt+F4. Esc and Start are fixed and can't be rebound. `preventDefault` only on bound keys.

**Should-fix rules**
- **Bind by `e.code`, not `e.key`** (Shift+1 and non-QWERTY layouts).
- **Gamepad reading:**
  - support `mapping === 'standard'`, polling `getGamepads()` every frame;
  - triggers via `buttons[6/7].value` with hysteresis;
  - non-standard pads get a "not recognised" note but can rebind by raw index;
  - button glyphs come from the pad id (Sony / Nintendo / else Xbox), with a manual override.
- **Menu navigation:** one `public/focusnav.js` does spatial navigation over the top panel, restoring focus by a stable `data-nav` key.
  - One panel registry (`open`, `close`, `top`, `isOpen`) replaces `ESC_PANELS` and `CURSOR_PANELS`.
  - v1 covers the Game Menu, Settings, Controls, Bag, Skill Tree, the MVP and death cards, and character select. Smith, Hall and Players stay mouse-only in v1.
- **Account sync:**
  - `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS settings JSONB`, capped at 8 KB, with a `v` field;
  - only bindings and accessibility sync; graphics, camera mode and active device stay local;
  - on login the server copy wins if present, otherwise local uploads; exception (hard review 2026-11-20): when this browser has changes for this account the server never got (`fb_controls_unsynced`), those go up instead; a pending change of another account is dropped, never uploaded;
  - unknown ids are dropped, and new actions get their defaults unless the key is taken.
- **K3 cuts:** "sprint" (sprinting is automatic) and "aim assist strength" (attacks already auto-aim). Reduce-motion is checked inside `shake()` and `slowMotion()`, exempting `cine.js`. The colour-blind telegraph palette and sound cues wait until J merges (telegraph colours are spread across files J is editing).
- **Touch** is a third, automatic device on the same action bus. The touch HUD hides while a pad is active.
- **Labels:** replace hard-coded key names with `input.label(action)`: skill bar, revive prompt, wheel hint and controls text in v1.
- **Detection prompt:** a one-time "Controller detected, switch?" toast.

**K4 changes**
- **Fake pad:** `addInitScript` overrides `navigator.getGamepads` with a 17-button, 4-axis standard pad, and dispatches a plain `Event('gamepadconnected')` with a `gamepad` property.
- **Timing:** each press is held for N polled frames using an `__fb.input.frames` counter, not milliseconds.
- **Quake Ring:** "survive a Quake Ring" becomes "jump registered during a ring".
- **Cut:** the Named chat step.
- **Unit tests:** binding resolution lives in DOM-free `shared/controls.js`, so plain node tests are the main regression net.

### K contract (K1a lands this first)
**Actions** (`shared/controls.js`: id, label, group, type, optional `context`, `kbmOnly`, `fixed`):

| Group | Actions |
|---|---|
| Axes | `move`, `look` |
| Combat | `attack` (hold), `skill1`, `skill2`, `skill3`, `dodge`, `jump`, `guard` (hold; Guardian), `cover` (Guardian), `teamBurst` |
| Target | `lockNext`, `selectAimed`, `clearTarget` |
| World | `interact`, `revive` (hold; context: downed ally in reach) |
| Items | `item1`, `item2`, `item3` |
| Menus | `bag`, `skillTree`, `players`, `botWheel` (hold), `menu` (fixed) |
| Keyboard & mouse only | `chat`, `perfOverlay`, `turnLeft`, `turnRight`, `zoom` |

**Default controller** (Xbox names; glyphs follow the pad):

| Button | Action | With LB held |
|---|---|---|
| Left stick / Right stick | Move / Camera | Right stick picks on the bot wheel |
| RT | Attack (hold) | |
| RB | Dodge | |
| LT | Guard / parry (hold) | |
| LB | Modifier | |
| A | Jump (menus: confirm) | Cover |
| X | Skill 1 | Team Burst |
| Y | Skill 2 | Bot wheel (hold) |
| B | Skill 3 (menus: back) | Select what you aim at |
| R3 | Lock on / next target | Clear target |
| L3 | Unbound | |
| D-pad Up / Left / Right | Potion / Tonic / Draught | Up: Skill Tree; Right: Players |
| D-pad Down | Interact; hold to revive | |
| View | Bag | |
| Start | Game Menu (fixed) | |

**Default keyboard & mouse** (same as today; bound by `e.code`):

| Action | Key | Alt |
|---|---|---|
| Move | WASD | Arrows |
| Camera | Mouse | Q / E turn, wheel zoom |
| Attack | Left click | J |
| Skills 1–3 | 1, 2, 3 | |
| Dodge / Jump | Shift / Space | |
| Guard / Cover | R / C | |
| Team Burst | T | |
| Lock on / next target | Tab | |
| Select / clear target | Ctrl+click / Ctrl+right-click | Cmd on Mac |
| Interact / Revive | F / hold E | |
| Items | 4, 5, 6 | |
| Bag / Skill Tree / Players | B / K / P | I (bag) |
| Bot wheel | V (hold) | |
| Chat / Menu / Overlay | Enter / Esc (fixed) / F3 | |

**K1a must land first**
1. `test/keys.mjs`: every key above, checking `send()` or state. It passes before and after the refactor.
2. `shared/controls.js` (DOM-free): actions, defaults, `resolve(bindings, held, event)`, the conflict check and the reserved-key list, with node unit tests.
3. `public/input.js`: `on(action, fn)`, `held(action)`, `axis('move'|'look')`, `label(action)`, `device` (`kbm`|`pad`|`touch`), `setBinding`, `capture()`, `readPads()`, `frames`. Exposed as `__fb.input`.
4. `main.js` calls the same functions as today through `input.on`. `keys` stays as a shim over `held()`.
5. A panel registry (`open`, `close`, `top`, `isOpen`) replaces `ESC_PANELS` and `CURSOR_PANELS`.
6. `renderSettings` moves to `public/settings.js`. Storage splits into `fb_settings` (local) and `fb_controls` (synced, with `v`).
7. The rules above: no pointer lock under Controller, typing fields swallow game keys, pad disconnect falls back to keyboard & mouse, and press-action keys can't be chord members.

**K1a as landed (notes for K1b–K4)**
- **Binding strings:** key codes (`KeyW`, `Digit1`, `ShiftLeft`), `Mouse0/1/2`, `Mouse`, `Wheel`; pad names `A B X Y LB RB LT RT View Start L3 R3 Up Down Left Right`, sticks `LS RS` (`PAD_BUTTONS` maps standard indices to names). Chords join with `+`, modifiers first (`Ctrl+Mouse0`, `LB+X`); a key axis lists up,left,down,right (`KeyW,KeyA,KeyS,KeyD`). Per device `{ action: [main, alt] }`; the pad's alt is always null.
- **`shared/controls.js`:** `resolve(bindings, held, { code }, ctx, device)` (most specific wins; a context action beats a plain one), `check()` (errors: `fixed reserved kbmOnly noAlt axis chord modifier`, plus `conflicts`), `assign(..., 'swap' | 'unbind')`, `merged` / `diff` / `validate`, `bindingLabel`.
- **`public/input.js` (`__fb.input`):** a `gate(action)` from main.js decides what may fire (joined; under the Game Menu only Esc). Under `pad` the keyboard keeps only Esc, chat and F3, canvas clicks don't attack and there is no pointer lock. `readPads()` is a stub returning `[]`, so `setDevice('pad')` is refused. K1b fills `readPads()` and polls it in `tick()` (main.js calls it every frame), resolves pad buttons against `bindings('pad')`, and makes `held()` / `axis()` read the pad. `setDevice` already releases holds; `gamepaddisconnected` already falls back with a log line. Contexts: main.js sets `downedAlly` every frame.
- **Storage:** `fb_controls` = `{ v: 1, kbm: {changes only}, pad: {changes only}, access: { sens, invertY } }` (K2 syncs this whole object); `fb_settings` = camera, graphics, overlays, `device` (local).
- **Panels:** `panels.register(id, { esc })`. K2 registers its Controls panel there. K1b's focus navigation reads `panels.top()`.
- **Not done yet:** labels. `input.label(action)` exists, but the skill bar, revive prompt, wheel hint and controls text still have the key names hard-coded (K1b / K2).
- **Intended changes:** keys bind by code (Shift+1 is skill 1; AZERTY players get physical WASD). Every text field swallows game keys, not just the chat. Bound keys get `preventDefault`.
- **Tests:** `node test/controls.js`; `PORT=67xx node test/keys.mjs` (Node Playwright: `npm i --no-save playwright`, or `PLAYWRIGHT=<.../playwright/index.mjs>`). Checks 1–21 are the old keyboard & mouse behaviour; 22–26 cover the new layer.

### K1. Input layer + controller support (`feat/input`)
1. **Replace scattered key handling** (many `e.key`/`e.code` checks in `public/main.js` and feature modules) with one input layer (`public/input.js`) that maps raw events to actions using the bindings. Feature modules subscribe to actions, not keys.
2. **Gamepad support** (Gamepad API, standard mapping) for the full action set:
   - left stick moves, right stick turns the camera, with deadzones, sensitivity and invert-Y;
   - triggers and bumpers, the d-pad, and stick clicks;
   - the modifier layer.
3. **Controller-specific play aids:**
   - **Targeting:** soft target-lock and cycle-target on a button, so you can lock on without a mouse.
   - **Radial menus:** the bot V-wheel and the skill/item radial work with the stick.
4. **Menus are fully controller-navigable:**
   - focus movement with the d-pad or stick, A to confirm, B to go back;
   - every panel the game opens works: Esc menu, Settings, Skill Tree, Bag, Smith, Players/Friends/Bots, party menus, the MVP card, the death screen, character select;
   - visible focus rings.
5. **On-screen prompts follow the active device:** the skill bar and guide hints show button glyphs (A/B/X/Y or ✕/○/□/△ depending on the controller id) when the controller is active.
6. **Accept when:** default keyboard behaviour is unchanged (existing Playwright flows still pass), and unit tests cover binding resolution, chords, conflicts and the modifier layer.

### K2. Controls screen (`feat/controlsui`)
1. Reached from the **Esc menu → Controls** (its own entry, next to Settings).
   - **Header:** an Input device toggle (Keyboard & Mouse / Controller), plus a live "Controller connected: …" status.
   - **Tabs:** Keyboard & Mouse | Controller.
2. **Device picture** (inline SVG, clean flat style matching the game UI):
   - **Keyboard & mouse:** a full keyboard plus a mouse with left, right and middle buttons and the wheel.
   - **Controller:** a generic gamepad with sticks, d-pad, face buttons, bumpers, triggers and menu buttons.
   - **Hover:** the key or button visibly presses down and a tooltip shows the bound control.
   - Bound keys show a ★ marker.
   - **Click:** a popover shows the control (or "Not bound") with an **Edit** button. Clicking again (or Edit) opens a list of controls with a **filter box**.
   - **Live feedback:** pressing a real key or button lights it up in the picture.
3. **List of all controls** below the picture, grouped (Move, Camera, Combat, Skills, Items, Social, Menus):
   - each row shows the control, its binding and a Rebind button;
   - Rebind listens for the next key, button or chord;
   - it handles conflicts (swap or unbind);
   - Reset to defaults per device.
4. **Works with the controller itself:** you can rebind the controller using the controller (focus navigation).
5. **Accept when:** screenshots of both tabs, hover, the popover, the filter, the rebind flow and the conflict prompt; tests cover save, load and account sync.

### K3. Accessibility options (`feat/access`), in Settings → Accessibility
- **Holds can become toggles:** guard, sprint and the bot wheel.
- **Camera:** sensitivity (mouse and stick) and invert-Y.
- **Reduce motion:** turns off camera shake, hit-stop and big screen flashes.
- **Text and UI scale**, plus a high-contrast mode for HUD text.
- **Colour-blind-friendly telegraphs:** an alternative telegraph and danger palette, or pattern overlays.
- **Sound cues** for telegraphs.
- **Aim assist / soft-lock strength** for the controller.
- Everything is saved with the bindings, with defaults that change nothing for current players.

### K4. Controller verification with scripted gamepad "bots" (`feat/padtest`)
1. A Playwright harness that fakes a gamepad: it overrides `navigator.getGamepads()` with a scripted virtual pad, standard mapping.
2. It plays a session through controller input only:
   - move along a path, turn the camera, lock on and cycle targets;
   - attack, use all skills, dodge, jump, guard/parry;
   - use an item;
   - open and navigate the Esc menu, Settings and the Controls screen, rebind a button and check it took effect, then close everything;
   - talk to a Named via the chat (keyboard fallback);
   - fight the Warden in a party with bots, and survive at least one Quake Ring by jumping on the pad.
3. It checks **game state** (positions, cooldowns, HP, server events), not frame timing, and runs in CI-like mode (`node test/padtest.mjs` or Python).
4. A second scripted pad checks the **modifier layer** and **chords**.
5. **Accept when:** the harness passes on the default controller layout and on a rebound layout. Report coverage: which actions were verified on the pad.

### K5. Targeting modes and Cleave (`feat/targeting`, owner request 2026-11-20)
Owner: "attacks always go to the nearest enemy even when I'm facing or locked on another". Plan and per-class notes:
`docs/briefs/targeting.md`. Amends the K3 cut "aim assist strength (attacks already auto-aim)": targeting is now a choice.
- **Controls → Combat** (fb_controls.combat `{ target, cleave, max }`, synced with the account; `shared/targeting.js`):
  - **Nearest**; **Locked or nearest** (default: the lock within max(14, skill range + 4) m, else the crosshair pick
    for bows and bolts, else the nearest: the old behaviour); **Cone** (nearest in a 120° cone where the camera looks,
    a lock inside the cone first; the server drops arc and line hits outside the cone, using the look sent with each
    skill); **Aimed** (no
    auto-targeting or homing: attacks go where the camera looks; projectiles fly straight with a 0.35 m wider hitbox
    and hit whatever is on the line; marks / pounces / leaps take the first enemy on the aim line).
  - **Cleave** on/off (default on) and **Max targets per hit** 1–8 (default 8). On: min(attack limit, max) enemies in
    the field of view (lock first, then nearest); off: one (the lock if inside, else the nearest). Area attacks (Bard
    chords, Hamstring, the Berserker's Cleave skill, ring basics) keep only their own limit.
- **Data:** `ATTACKS` (base field of view = the old hitArc half-angles; target limit `n`; `aoe` for crowd-control cones),
  weapon styles' `mods.fov` (x the half-angle; all 1 for now, so balance is unchanged), style steps may carry `n`.
- **Server:** `{ type: 'tprefs' }` on join and on change, validated; bots never send it and keep the old behaviour.
  The Ranger's server aim now keeps the locked target when it's in range and in the skill's cone.
- **Not affected:** spins, slams, ground circles, dashes and projectiles (single-target or piercing by design).
- **Open for the owner:** per-weapon `fov` values (wider-but-slower weapons), the target limits, whether bots should use
  the limits too, whether Cleave should also cover spins and slams.

### K validation with the owner (2026-11-19/20, branch `claude/floorbound-controller-validation-3256da`)
- **Played by the owner** on a wired SCUF (Xbox One protocol) on a Mac in Chrome: the whole play checklist passed (sticks, combat buttons, D-pad items and revive hold, LB layer, menu focus, rebinds kept across reload and account, unplug/replug, switching device mid-play).
- **Wired Xbox pads on a Mac:** macOS has no driver for many third-party Xbox pads (Chrome never sees them), so Controls → **Connect it** drives them over WebUSB (`public/xboxusb.js`, `shared/gip.js`); shown on Macs only, reopens by itself later.
- **Key hints follow the device** (skill bar, world prompts, server texts via `{key:action}` tokens, `public/keyname.js`); the Controls screen's tab follows a device switch; Xbox / PlayStation button pictures.
- **Owner decisions:** the controller picture stays mouse-only; play buttons stay swallowed while a navigable window is open (except Start); a held bot wheel that loses focus (or the device switches, or the pad drops) **cancels** instead of giving the pointed order; revive hold and Cover are verified by a scripted bot party (`test/padtest.mjs` section 5: the pad really revives a downed bot and really covers it), not by hand.

## Known issues and backlog
- **Performance (done, c8d8fb4):** server bots on in-process sockets, 10 Hz brains far from humans, the Named rest at home until a player is in the field (invites / calls / outreach wake them). Bench CPU 0.084-0.098 → 0.040-0.057 s/s with players in town, about -11% with everyone in the field (README → Performance, `scripts/perfbench.js`, `/status` cpu + bot counts). Next if needed: don't simulate floors nobody is on (Floor 2/3 mobs cost CPU with no one there).
- **Client performance + Game Menu (done, 43cd3d9):** F3 diagnostics overlay and ping chip, Settings → Graphics (Auto default / Low / Medium / High), snapshot interpolation ~100 ms behind with adaptive buffer (`shared/netsmooth.js`, `?netsim=120,60,2` to test, `?interp=0` old smoothing), shaders warmed at load and never recompiled mid-fight, DOM-on-change HUD; Esc / ☰ Game Menu (Resume, Settings, Controls & guide, Change character, Log out, Admin). Headless 6-bot Warden fight: High ≈ before (3 fps, GPU-bound in swiftshader), Low 2.1× faster (6.3 fps, 712 → 389 draw calls); remote motion wobble 2.75 → 0.96 m/s (good network), 4.69 → 0.59 (120±60 ms + 2% reorder). Next if needed: fewer draw calls (merge/instance static scenery; ~700 in a boss fight).
- **Perf review fixes (done, efe107c):** empty floors sleep (mob AI only where someone is) and each browser gets only its floor's mobs: CPU 0.028 → 0.005 s/s with nobody on, 0.053 → 0.036 with 4 players + 9 bots in town, 0.088 → 0.068 in the field; bytes 316 → 176 KB/s; plus the stall stutter fix (wall-clock `st`), Auto quality settling, character draw distance / shadows, MSAA only once High held, nameplates after close-ups, the anonymous-leave warning, `@Name` turn-ins on Floors 2–3 (README → Performance).
- Floor 2 is untested by the owner: do a play pass before any Floor 3 work.
- Bots ignore Floor 2 specifics? (check during C if cheap)
- `test/bots.js` is an old standalone smoke bot (records 0 hits): retire or update.

## History
Detailed per-feature notes are in README.md and the git log.
