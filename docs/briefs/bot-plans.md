# Bot plans: a short list of steps a bot carries out

Owner ask (2026-11-22): the AI should be able to control a bot's actions, perform tasks, and "create a sequence/series
of actions to perform". Today an order is one step (`/b follow`, the wheel, or the AI mind's `order`). A **plan** is up
to 8 steps from a fixed menu, each with an end condition. The rule-based brain still plays every tick: a plan only
decides *what the bot is doing now*, exactly as an order does. Phase B (the life layer) will reuse the same steps for
free bots' own days.

## The steps (`shared/bots/plan.js` `STEPS`)

| Step | Arguments | Runs as | Done when | Time limit |
|---|---|---|---|---|
| `goto` | a place | walk there (waypoint travel if it is on another floor) | within reach of it; as the last step: stays there | 4 min, then the plan stops |
| `come` | | run to the player who gave the plan | within 6 m (its place in the formation) | 2 min, then the plan stops |
| `follow` | seconds (default 60) | follow that player | time is up; as the last step: stays following | |
| `wait` | seconds (default 20) | hold this spot | time is up; as the last step with no time: stays waiting | |
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
- **Orders override.** Any new order (wheel, `/b`, an AI `order`) that takes effect ends the plan; status, potion,
  heal, ready, set me up and an order the bot can't carry out (attack with nothing locked) don't. `/b cancel` ends
  the plan and the current order.
- **Where a plan leaves the bot.** After the last step the bot is free again (a follower goes back to its player),
  except when that step is `goto`, or `wait` / `follow` with no time: then the order stays and the bot waits there (or
  keeps following). A bot waiting at a place a plan sent it to is not pulled back by the server's catch-up for
  followers (`cmd.post`, `server/botmanager.js`), and neither is a bot in the middle of a plan.
- **Clocks wait.** A step's time and its limits don't run while the bot is dead, downed, frozen in a boss arena or
  defending a town in a raid; kills made in a raid don't count for a farm step.
- **A bot's line is never a command.** A `say` step (and every line a bot says, the AI mind's too) has any leading
  slashes removed, and the server drops a slash command (other than the four poses) or a `botcmd` coming from a bot's
  own socket (`botMayNotSend`, `shared/bots/social.js`). Bots pass every who-may-order check, so without this a
  player could order bots that are not theirs through a bot they may order.
- **Who may give one:** the same checks as an order (`game.botCommand` → `botControl`, `shared/accesslevels.js`). The
  AI mind makes a plan only for a human party member who spoke to the bot, as with its orders today.
- **Limits:** 8 steps, `repeat` up to 5 times, 30 minutes for a whole plan, every step has its own limit above. A plan
  ends if the player who gave it leaves the party (party plans) and never survives a despawn.
- **Talk:** the bot says the plan when it takes it ("Plan: 1) 10 Forest Boars 2) go to the smith 3) come back to you"),
  a short line when a long step starts, and when it is done or has to stop. One bot speaks for a group order (its `say`
  steps too); another bot of the group that has to stop says why only if nobody else just did.
- **Neutral for everything else:** no plan = today's behaviour, byte for byte. Director actors and scripted bots
  never take one.

## How a plan arrives

1. **Chat:** `/b farm 10 boars then go smith then come`. Steps are split on `then`, `;`, `>`, and `and` before a step
   word; a line to say runs to the next `;`, `>` or `then <step>`. `/b <name>: ...` for one bot (the server passes the
   names of the speaker's own party bots to the parser, so a bot called Bow or Hop is a name; one called Stay or Farm
   needs the colon form, as before). A plain single order stays the old order: `/b farm`,
   and also a single step whose words mean nothing to a plan and hold no number (`/b farm here`, `/b kill it`; `kill`
   needs a count to be a hunt). `repeat 3` as the last step repeats the list. Times add up (`1m30s`).
2. **The AI mind:** `INTENT_SCHEMA` gains `plan`: a list of `{ do, what, n }` (the step, its place / monster / line /
   pose, and its count / seconds / slot). `cleanPlan()` is the only way it reaches the game: an AI plan is cut at its first unknown step, place
   or monster (never carried out with a hole in it). The model is told `[]` keeps a running plan; the same plan again
   from the model does not restart it. The prompt lists the menu; `summarize()` shows the running plan and its progress.
3. **Code:** `b.setPlan(steps, { by, byName, at })` (phase B will call this). The bot's goal text, shown on the admin page, carries the plan's progress.

The server validates a chat plan with the same `cleanPlan()` before it is broadcast as a `botcmd` event
(`cmd: 'plan'`, `plan`, `at`).

## Code

- `shared/bots/plan.js` (new): `STEPS`, `PLACES`, `mobKind()`, `parsePlan(text)`, `cleanPlan(raw)`, `planText()`,
  `planHelp()`. No bot code: the client loads it through `social.js`.
- `shared/bots/planrun.js` (new): the runner, `planTurn(b, P, api)` + `planEvent(b, e, ...)` + `setPlan` / `endPlan` /
  `planNote`.
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
- Independent code review before merging: done 2026-11-23, 14 findings, all fixed (a `say` step could carry a slash
  command past the who-may-order check; player-added bots were pulled back from far places; one-shot kills not
  counted; old single orders such as `/b kill it` changed meaning; and smaller ones). Each has a check in
  `test/botplans.js`. A second review of the fixes found no way left to pass a command through a bot, and five smaller
  items (a bot's name must not change what a plain order means; a kept post on another floor; old hits counting as
  kills), fixed too.
