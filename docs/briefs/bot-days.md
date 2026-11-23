# Bot days: free bots that choose what to do (phase B of "bots that feel like real players")

Plan doc: https://claude.ai/artifact/ET4pP7qqX3hefDepXzmPmX (layer 2, the life layer). Owner's go for the brief:
2026-11-23 ("Merge, then start phase B"). Owner 2026-11-23: Jev decides for every bot with a day. Residents: yes, six, shown to him first (built after the merge).

## Goal
A free bot today farms the field for ever. A real player hunts for a while, runs low on potions, walks back to town,
sells what they picked up, buys potions, sits by the well, chats, heads out again with whoever is around, and now and
then tries the boss. Phase B gives a free bot that kind of day: it picks its own next thing from what it needs and who
it is, and you can always see and ask what it is doing and why.

Done when: a free bot left alone for an hour does at least five different things for reasons you can read on its
card, never stands stuck, and 30 such bots cost no more server CPU than 30 field-farming bots do today.

## Who gets a day
A bot with a new behaviour, **own** ("Lives its own day"): the default for a bot added out of a party and for a bot
that leaves one (today both get `field`). `field`, `warden`, `stay`, `tend`, `floor2`, `floor3` and `auto` stay as
they are for anyone who picks them. Never: a bot in a human's party, the Named, a director's actors.
`BOT_DAYS=0`: `own` behaves as `field` (today's game).

An order or a plan from a player always wins: the day pauses, and picks up again 20 s after the order ends. A town
raid (the ward) and a party invite it accepts work as today.

## How it chooses (`shared/bots/day.js`)
Utility scoring first (pure, no model call); the decision model then picks from the scored list (below). When a goal ends (and at most every 30 s on a goal that can be dropped) the bot scores every goal:

    score = need (0 to 1) x how much this bot cares (its traits) x a little luck (0.85 to 1.15)
            - a cool-down for what it just did

The top score becomes a **plan** built from the plan step menu (`b.setPlan`, `by: 0`), so the plan runner does the
work, `/b <name>: status` and the bot's card show the step, and nothing new moves the character.

Needs, each read from the bot's own state (no new saved data):

| Need | Rises with | Leads to |
|---|---|---|
| Supplies | fewer than 2 potions (cautious bots: fewer than 3) | restock |
| Bag | bag more than two thirds full | sell |
| Rest | minutes since it last sat down, deaths, long fights | rest |
| Change | minutes on the same goal in the same place (curious bots sooner) | wander, another hunting ground |
| Company | minutes since it was near anyone (sociable bots sooner) | hang out, group up |
| Ambition | level at or over the floor boss's level, good gear (aggressive bots sooner) | boss attempt, next floor |

Goals in this version:

| Goal | What you see |
|---|---|
| Hunt | farms a kind that fits its level (10 to 28 kills alone, more for a group: x1.4 per mate), on the field or its floor's wilds; changes ground between hunts |
| Restock | walks to the merchant, sells spare gear (never what it wears, keepsakes or Academy weapons), buys potions up to its own number (3 to 6), walks back |
| Rest | sits by the well or the cooking fire for one to four minutes; some go AFK a while (phase A's habit) |
| Wander | visits a place (smith, Hall, Academy, garden, the gate), looks around, moves on |
| Hang out | stands near other people in town, greets, bows, answers chat (the AI mind as today) |
| Help | a player in trouble within 40 m (low health, several mobs on them): joins that fight, says a line, goes back to its day. Cautious bots less, sociable bots more |
| Group up | two or three free bots with the same idea party up at the well and hunt together; at the boss's level they try the boss (a clear with no human in it stays quiet, as today) |
| Ask along | before a group hunt or boss try, a sociable bot may ask in chat ("anyone for wolves?"). It invites a player only after they say yes, and asks any one player at most once in 20 minutes |

New plan steps for this, also open to players (`/b go merchant then sell then buy 5 potions`): **sell** (spare gear, at
the merchant) and **buy** (potions, a count). Bots pay the same prices as players, town tax included.

### What it remembers
`b.day`: the goal, why (the top need), since when, and its last eight goals. It shows on the bot's card and the admin
page ("Restocking: out of potions"), goes into the AI mind's prompt so "what are you up to?" gets a true answer, and
gives the rule-based reply when the AI is off. Not saved across a restart.

## Bots nobody can see (CPU)
The free plan has 0.15 of a CPU. Built as planned (`thinkEvery` in `server/index.js`, `dayFloors` in
`server/botmanager.js`, `floorsFact` and the `travel` goal in `shared/bots/day.js`):
- Within 60 m of a player on its floor, in a boss room or fight, downed or dead: every tick (20 Hz), as today.
- Further off on a floor someone is on: every other tick (10 Hz), as today.
- **A floor with nobody on it:** every fourth tick (5 Hz) for any server bot there, and an `own` bot's day only scores
  the goals that keep that floor's monsters asleep: rest and restock (both in town, so `Game.activeFloors` leaves the
  floor out) and **travel**, where a sociable bot heads for the waypoint of a floor players are on ("Heading for the
  well: the floor is empty"). Hunting, wandering, hanging out and teaming up wait until someone is there. A bot's
  hunts also keep to the floors players are on (`dayFloors` feeds `pickKind`). Bots told to farm a floor (`floor2`,
  `auto`, ...) keep doing that as today, at 5 Hz while nobody is on it.
- Nobody online: the world sleeps, as today. `BOT_THINK=20` puts every bot back to 20 Hz.
- `scripts/perfbench.js` takes `FREE=10,30,60,100` (free bots added out of any party, one run each).

Measured here (2 humans in town, Named on, 45 s windows; this container, not Render, so read the two columns against
each other and not against the 0.15 limit):

| Free bots | CPU s/s, days on | CPU s/s, `BOT_DAYS=0` (field, as before) | tick p50 / p95, days on | snapshot KB/s |
|---|---|---|---|---|
| 10 | 0.073 | 0.075 | 1.5 / 2.3 ms | 105 |
| 30 | 0.113 | 0.099 | 1.9 / 2.8 ms | 140 |
| 60 | 0.166 | 0.146 | 2.4 / 3.8 ms | 198 |
| 100 (62 joined) | 0.170 | 0.146 | 2.6 / 4.1 ms | 204 |

Reading it: a day costs a little more than farming the field, not less. At 30 bots it is 0.113 against 0.099 (14%),
and `BOT_THINK=20` on both sides (every bot at 20 Hz) gives 0.135 against 0.128, so only half of that gap is the
chooser and the walking: the rest is where a day takes a bot. Field farmers sit 60 m+ from the players and think at
10 Hz; a bot living its day comes into town, stands next to the players and thinks at 20 Hz, which is the point of it.
The 5 Hz tier is what pays for the floors nobody is on. 30 bots fit the free plan either way (and this container is not
Render: read the columns against each other). Past about 62 bots the adds stop sticking in this container, so 100 was
really 62: `MAX_BOTS` stays 30.

## Residents (owner call: yes, 2026-11-23; built on top of the merged phase B)
Today a free bot exists only while the player who added it is online, so with nobody adding bots there is nobody to
have a day. So the server keeps bots of its own (`shared/residents.js`, `server/residents.js`) while at least one
player is online. The owner asked to see them first and whether they are one party: they are not; each lives its own
day, and the sociable ones team up with another free bot now and then, as any free bot does.

| Name | Class | Personality (rolled from the name) | Skill | Level |
| --- | --- | --- | --- | --- |
| Marlo | Guardian | Steady | 3 Average | the top online player's |
| Gideon | Cleric | Chatterbox | 3 Average | 90% of it |
| Talia | Lancer | Explorer | 3 Average | 85% |
| Pip | Berserker | Hothead | 2 Casual | 75% |
| Rosalind | Bard | Joker | 2 Casual | 65% |
| Brenna | Ranger | Quiet | 2 Casual | 55% |

- **When:** with a player online the missing ones join, one every 2 s tick (no burst); nobody online for
  `RESIDENT_GRACE` (60 s): they all leave (a quick reconnect keeps them). Nothing about them is saved.
- **Where and how:** behaviour `own`, free to travel; each joins at its level in that level's premade gear (the same
  as a player-added bot's: `premadeOutfit` in `server/playerbots.js`), next to the waypoint of the floor most players
  are on.
- **Whose:** nobody's (no creator, empty allow list), so anyone may invite or order one; the Bots list tags them
  "resident". They count toward `MAX_BOTS`: with the limit reached a resident waits for a slot.
- **Names:** a name a player has taken: the resident joins as "Pip 2", keeping Pip's personality.
- **Admin:** removing one (a row's remove, or "remove all") keeps it out for `RESIDENT_AWAY` (30 min), then it comes
  back. `GET /api/admin/bots` carries `residents` (who is in, and how long a removed one stays out).
- **Switch:** on by default only on Render (`RENDER` is set there, as `server/shutdown.js` uses), so test and local
  servers are as before; `RESIDENTS=<n>` keeps the first n anywhere, `RESIDENTS=0` none. Test: `test/residents.js`.

## A decision model picks the goal (built 2026-11-23; owner: for every bot with a day, not only those near players)
`server/ai/providers/decisions.js` talks to OpenRouter's decisions endpoint (`POST /api/alpha/decisions`), next to
today's three chat providers: one question, one answer with a probability per option, far cheaper and faster than a
chat model. `server/ai/daypick.js` is the caller; `installDayPick` hangs it on the bot manager, and every bot with a
day calls it through `b.dayPicker`. The question is a Choice over the goals that scored something, with the bot's
state, its personality numbers and its own scores as hints (`pickState`); the answer's probabilities are **rolled**,
not obeyed, so a 70/30 call goes the other way about 3 times in 10 and bots on the same floor do different things.
The plan is built exactly as before.
- **Settings:** `BOT_DAY_MODEL` (default `typesafe/jev-1.13`, the pinned version OpenRouter documents; a swap is one
  env var, and `~typesafe/jev-latest` follows the newest). `BOT_DAY_PICK=rules` turns it off; `=mock` is a decider in process (no key, no network) for local tries and tests.
  Also `BOT_DAY_WAIT_MS` (the bot really waits that long: the picker hands it over as `ask.wait`), `BOT_DAY_NEAR_S`, `BOT_DAY_FAR_S`, `BOT_DAY_CALLS_MIN`, `BOT_DAY_CONCURRENT`.
  The key comes from `OPENROUTER_API_KEY` (or `OPENROUTER_KEY`, `OPEN_ROUTER_API_KEY`) and is read per call, never kept.
  **Until that variable is set in Render, nothing is called and the bots' own scores decide**; the admin card says so.
- **When:** a bot near a player asks whenever a goal ends, at most every 30 s. Further off, at most once a minute. A
  bot alone on its floor (going home to rest) has nothing to decide and asks nothing.
- **Never waits:** the bot carries on while the call is out. No answer in 400 ms (`PICK_WAIT`), an error, no key or the
  cap reached: the scores decide, and a late answer is counted and dropped. Three failures in a row: rules for 5 min.
- **Cost:** Jev is billed on input tokens only, about $0.04/M in, so roughly $0.00002 a decision: about $0.001 per bot
  per hour of play. A cap of its own, `JEV_DAILY_USD` (default 0.50); at the cap the rules take over until midnight UTC.
- **The trace the owner asked for:** every goal records who decided it and the odds it was given (`d.by`, `d.odds`,
  `d.model`, and the same on each log entry), so a bot's story shows which picks were the model's.
- **Switch:** the card's **Turn off / Turn on** (`POST /api/admin/ai/day { on }`) swaps between the model and the
  scores at once, until the next restart: the blind test runs both ways without a deploy.
- **Admin:** a "Bot decisions" card under the companions one on `/admin.html` (Bots tab): the line, the key check, the
  per-model scoreboard (picks, answered, too late, failed, avg ms, $ per pick, what it picked) and the last few picks
  with their probabilities beside the bot's own scores. "Test decision" makes one real call.

## Built differently from the table above (2026-11-23)
- **Group up:** not "at the well": a bot walks up to another free bot wherever it is and invites it. Only bots living
  their own day are asked (`b.dayPeers`, from the server), so a bot a player told to stay or farm is never pulled away.
- **Boss tries:** a party of bots never goes for a boss by itself. Today a boss kill by ordinary bots alone is
  announced like a player's ("Floor cleared", the banner), and the quiet rule covers only the Named. A bold bot at the
  boss's level asks the players around instead ("Anyone up for the Warden?") and follows the one who says yes.

## After the independent review (2026-11-23)
- **One bot speaks up.** A bot that hears another bot's rescue line ("Hang on, Vex!") leaves that player to it, and one
  that hears "Anyone for wolves?" counts the players there as asked (`dayHeard`): before, every free bot in earshot said
  the same thing in the same second.
- A bot that leads a new group while on a hunt begun alone plans that hunt again, once, for the group.
- An invitation to a player who said yes is forgotten after 90 s; a stale "plan stopped" note no longer labels the
  next goal; a helper's nameplate says "Helping Vex", not "admin's order"; "Sold 2 things" gives no sum when gold
  was spent meanwhile.

## Not in this version
Crafting, gathering and gardens of their own, smith upgrades, trading with players, joining guilds, weapon swap,
saved lives across restarts, the proactive mind (phase C), learned movement (phase D), and growth (phase E, the
owner's idea, 2026-11-23: a Sonnet pass after a day with new history and an Opus pass every two weeks rewrite a
saved bot's profile, lessons and goal preferences, which the chooser here would read as hints; plan doc, "Growth").

## Build order
1. `sell` and `buy` plan steps and the bot's shop code.
2. The chooser, the solo goals (hunt, restock, rest, wander, hang out), `b.day`, the card and admin line, `own`.
3. Company: help, group up, boss tries, ask along.
4. Unseen bots: go home, think rates, perfbench with free bots.
5. Jev: the provider, the cap, the fallback. 6. Residents (owner's yes; after the merge, with its own review).
Then an independent review, fixes, the owner's OK, merge.

## Checks
- `node test/botdays.js` (new): scores are repeatable from a seed and stay in range; each need leads to its goal; no
  flip-flopping; an order pauses the day and it resumes; a real brain out of potions walks to the merchant, sells,
  buys, and has potions and less gold; ten minutes of a live free bot show three or more goals, no teleports and no
  minute stuck; `BOT_DAYS=0` equals today.
- `node test/daypick.js` (new): the request and the answer (odds, cost, a refusal, a made-up option, the key never in
  an error), the picker (who decided and the odds, the 70/30 roll over 200 seeds, a late answer, three failures, every
  skip gate, the state small and private), the day taking a model pick, and the admin route.
- Existing bot tests still pass (`botbrain`, `botplans`, `freebots`, `playerbots`, `personality`, `towns`, `named`).
- perfbench before and after.
- Blind test: friends spend 20 minutes around town and the field and guess who is a bot.
