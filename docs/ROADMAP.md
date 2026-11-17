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

## Known issues and backlog
- Floor 2 is untested by the owner: do a play pass before any Floor 3 work.
- Bots ignore Floor 2 specifics? (check during C if cheap)
- `test/bots.js` is an old standalone smoke bot (records 0 hits): retire or update.

## History
Detailed per-feature notes are in README.md and the git log.
