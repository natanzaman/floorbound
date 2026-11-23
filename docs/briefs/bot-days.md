# Bot days: free bots that choose what to do (phase B of "bots that feel like real players")

Plan doc: https://claude.ai/artifact/ET4pP7qqX3hefDepXzmPmX (layer 2, the life layer). Owner's go for the brief:
2026-11-23 ("Merge, then start phase B"). **Not built yet: this brief waits for the owner's OK.**

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

## How it chooses (`shared/bots/day.js`, pure, no model call)
Utility scoring. When a goal ends (and at most every 30 s on a goal that can be dropped) the bot scores every goal:

    score = need (0 to 1) x how much this bot cares (its traits) x a little luck (0.85 to 1.15)
            + a small bonus for carrying on with what it is doing, - a cool-down for what it just did

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
| Hunt | farms a kind that fits its level (10 to 25 kills), on the field or its floor's wilds; changes ground between hunts |
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
The free plan has 0.15 of a CPU; 10 players and 30 bots use about 0.095 today.
- Within 60 m of a player: as today (20 times a second).
- Further off on the same floor and not in a fight: 5 times a second (10 today).
- **A floor with no player on it:** an `own` bot goes home to its town and rests there (no mob AI runs for it), and a
  sociable one travels to a floor where players are. So a day is played where someone can see it, the same rule the
  Named follow. Bots told to farm a floor (`floor2`, `auto`, ...) keep doing that as today.
- Nobody online: the world sleeps, as today.
- `scripts/perfbench.js` gets free bots (`FREE=30`): runs at 10, 30, 60 and 100 before and after, numbers in this brief.
  `MAX_BOTS` stays 30 until those numbers say what fits.

## Residents (owner call)
Today a free bot exists only while the player who added it is online, so with nobody adding bots there is nobody to
have a day. Proposal: the server keeps `RESIDENTS=6` bots of its own while at least one player is online: fixed names
and personalities, mixed classes, levels spread up to the active players' level, behaviour `own`, on floors where
players are. They count toward `MAX_BOTS`, show in the Bots list as the server's, and anyone may invite them.
`RESIDENTS=0` turns it off. Their levels and gold are not saved in this version.

## Jev trial (separate OK, after the rest works)
An OpenRouter provider next to today's three. For bots within 60 m of a player, Jev picks the next goal from the same
list, with the scores as hints; the scores decide on a slow or failed call. A flag switches it (`BOT_DAY_PICK=jev`),
spend counts in the daily AI budget. It stays only if the blind test can tell the difference.

## Not in this version
Crafting, gathering and gardens of their own, smith upgrades, trading with players, joining guilds, weapon swap,
saved lives across restarts, the proactive mind (phase C), learned movement (phase D).

## Build order
1. `sell` and `buy` plan steps and the bot's shop code.
2. The chooser, the solo goals (hunt, restock, rest, wander, hang out), `b.day`, the card and admin line, `own`.
3. Company: help, group up, boss tries, ask along.
4. Unseen bots: go home, think rates, perfbench with free bots.
5. Residents (if OK). 6. Jev trial (if OK).
Then an independent review, fixes, the owner's OK, merge.

## Checks
- `node test/botdays.js` (new): scores are repeatable from a seed and stay in range; each need leads to its goal; no
  flip-flopping; an order pauses the day and it resumes; a real brain out of potions walks to the merchant, sells,
  buys, and has potions and less gold; ten minutes of a live free bot show three or more goals, no teleports and no
  minute stuck; `BOT_DAYS=0` equals today.
- Existing bot tests still pass (`botbrain`, `botplans`, `freebots`, `playerbots`, `personality`, `towns`, `named`).
- perfbench before and after.
- Blind test: friends spend 20 minutes around town and the field and guess who is a bot.
