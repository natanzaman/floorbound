# Bot plans: a short list of steps a bot carries out

Owner ask (2026-11-22): the AI should be able to control a bot's actions, perform tasks, and "create a sequence/series
of actions to perform". Today an order is one step (`/b follow`, the wheel, or the AI mind's `order`). A **plan** is up
to 8 steps from a fixed menu, each with an end condition. The rule-based brain still plays every tick: a plan only
decides *what the bot is doing now*, exactly as an order does. Phase B (the life layer) will reuse the same steps for
free bots' own days.

## The steps (`shared/bots/plan.js` `STEPS`)

| Step | Arguments | Runs as | Done when | Time limit |
|---|---|---|---|---|
| `goto` | a place | walk there (waypoint travel if it is on another floor) | within reach of it | 4 min, then the plan stops |
| `come` | | run to the player who gave the plan | within 6 m (its place in the formation) | 2 min, then the plan stops |
| `follow` | seconds (default 60) | follow that player | time is up; as the last step: stays following | |
| `wait` | seconds (default 20) | hold this spot | time is up | |
| `guard` | a place, seconds (default 120) | hold the place, fight what comes within 14 m | time is up (counted from arrival) | 4 min to get there |
| `farm` | a monster (optional), a count (default 10) | the farm order; with a monster: hunt that kind | the party killed that many | 15 min, then moves on |
| `boss` | | the boss order | the floor's boss dies | 20 min, then the plan stops |
| `attack` | | attack the player's locked target | it dies or is gone | 2 min, then moves on |
| `tend` | seconds (default 180) | hold at the town garden (Floor 1) | time is up | |
| `say` | a line | party / say chat | said | |
| `emote` | sit, bow, kneel or hop; seconds (default 4) | the pose, then stand | time is up | |
| `skill` | slot 1 to 4 | press that skill once | pressed | 10 s, then moves on |

Places (`PLACES`): the well, smith, merchant, hall, academy, garden, life hall, cooking fire, alchemy bench, registrar,
field, gate (Floor 1); the camp (Floors 2 and 3); `here` (where the player stood when they gave the plan).
Monsters: any non-boss, non-prop kind by id or name ("boars", "dire wolves").

Not in this version: crafting, buying and selling (bots have no shop or crafting code yet), and gathering.

## Rules

- **Fights interrupt, then the plan carries on.** Steps drive `b.cmd`, so the brain's own targeting, dodging, potions,
  revives and rescues are untouched. A town raid's `defend` pauses the plan; `release` resumes it.
- **Orders override.** Any new order (wheel, `/b`, an AI `order`) other than status, potion and heal ends the plan.
  `/b cancel` ends the plan and the current order.
- **Who may give one:** the same checks as an order (`game.botCommand` → `botControl`, `shared/accesslevels.js`). The
  AI mind makes a plan only for a human party member who spoke to the bot, as with its orders today.
- **Limits:** 8 steps, `repeat` up to 5 times, 30 minutes for a whole plan, every step has its own limit above. A plan
  ends if the player who gave it leaves the party (party plans) and never survives a despawn.
- **Talk:** the bot says the plan when it takes it ("Plan: 1) 10 Forest Boars 2) the smith 3) back to you"), a short
  line when a long step starts, and when it is done or has to stop. One bot speaks for a group order.
- **Neutral for everything else:** no plan = today's behaviour, byte for byte. Director actors and scripted bots
  never take one.

## How a plan arrives

1. **Chat:** `/b farm 10 boars then go smith then come`. Steps are split on `then`, `;` or `>`. `/b <name>: ...` for
   one bot. A plain single order word (`/b farm`) is still the old order. `repeat 3` as the last step repeats the list.
2. **The AI mind:** `INTENT_SCHEMA` gains `plan`: a list of `{ do, what, n }` (the step, its place / monster / line /
   pose, and its count / seconds / slot). `cleanPlan()` is the only way it reaches the game: unknown steps, places or
   monsters are dropped. The prompt lists the menu; `summarize()` shows the running plan and its progress.
3. **Code:** `b.setPlan(steps, { by, byName, at })` (phase B will call this). The bot's goal text, shown on the admin page, carries the plan's progress.

The server validates a chat plan with the same `cleanPlan()` before it is broadcast as a `botcmd` event
(`cmd: 'plan'`, `plan`, `at`).

## Code

- `shared/bots/plan.js` (new): `STEPS`, `PLACES`, `mobKind()`, `parsePlan(text)`, `cleanPlan(raw)`, `planText()`,
  `planHelp()`, and the runner `planTurn(b, P, command)` + `planEvent(b, e)` + `setPlan` / `endPlan`.
- `shared/bots/brain.js`: `b.setPlan`, `planTurn` before `decideMode`, kills and boss deaths to `planEvent`, a
  `quiet` flag on `command()`, `cancel`, the `mob` filter for farm, `guard` targeting, a `stop` distance and floor
  travel for `stay`, plan progress in status and the goal text.
- `shared/bots/social.js`: `parseBotChat` returns `{ plan, name }` for a line with several steps or arguments;
  `cancel` order.
- `server/game.js`: `botCommand` accepts `cmd: 'plan'`; `/b help` lists the plan steps.
- `server/ai/intent.js`, `prompt.js`, `mind.js`, `providers/mock.js`: `plan` in the intent. `server/ai/index.js` gives the mind `mayOrder` (the `/b` rule, `game.botControl`), checked for its orders and plans. `AI_MAX_OUT_TOKENS` defaults to 500 (was 300) so a plan of 8 steps fits.
- `public/guide.js`, `README.md`: how to use it.

## Checks

- `test/botplans.js`: parsing, cleaning, every step's start and end on a fake bot, limits, override, cancel, the
  commander leaving, repeat, AI intent → plan (mock provider); then a live server: a party bot runs
  `wait → goto smith → emote → come`, and a farm step counts kills.
- Existing bot tests (`botbrain`, `playerbots`, `freebots`, `ai-mind`, `adminbots`, `personality`, `named`,
  `teamplay`, `towns`, `life`) still pass.
- Independent code review before merging.
