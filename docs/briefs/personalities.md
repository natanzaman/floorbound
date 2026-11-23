# Bot personalities (phase A of "bots that feel like real players")

Plan doc: https://claude.ai/artifact/ET4pP7qqX3hefDepXzmPmX (layers 1-5, phases A-D). Owner's go: 2026-11-23 ("continue").

## Goal
Two bots of the same class and capability should not play, move or talk alike. A bot gets a personality once, from its
name (the same name always rolls the same one), and every layer reads it: the fight brain, movement, idle time, chat and
the AI mind's prompt. No AI cost; nothing here calls a model.

## The data (`shared/bots/personality.js`)
- Seven traits, 0 to 1: aggression, caution, patience, sociability, chattiness, playfulness, curiosity.
- Archetypes with trait centres and a voice: Steady, Hothead, Careful, Chatterbox, Joker, Quiet, Explorer. A roll picks
  one (weighted) from a seeded random of the name and jitters each trait by up to ±0.15.
- `rollPersonality(name)`, `personaOf(id)` (an admin pick), `describePersona(p)` (one line for the admin page and the
  AI prompt). `BOT_PERSONA=0` gives every bot the neutral profile (all traits 0.5, no habits): old behaviour, for tuning.

## What reads it (small, bounded effects)
| Where | Effect |
| --- | --- |
| Potion threshold (`botskill.potionAt`) | ± up to 0.08 HP by caution |
| Low-HP back-off (`brain.upkeep`) | 0.2 to 0.36 HP by caution; a hothead (aggression > 0.75) only below 0.15 |
| DPS waits for the tank (`makeCtx` ready) | 0.6 to 1.8 s by patience (was 1.2 s) |
| Formation behind the anchor (`idle`) | own slot offset and distance (2.6 to 4.6 m) by sociability, so bots don't line up |
| Walking while calm (`motor.moveToward`) | a gentle weave off the straight line, and turning at a capped rate; never in a fight, dodge or arena |
| Chat (`social.say`) | chance x chattiness (0.35 to 1.4); a voice adds its own lines for greetings, wipes, kills, level-ups |
| Idle habits (`shared/bots/idle.js`) | look around, fidget a step, hop (playful), sit when the party has waited a while, bow to a human who joins (sociable), short AFKs (free bots only, never with a human) |
| AI mind (`server/ai/prompt.js`) | the persona line goes into the prompt so the voice matches the play |
| Admin page | persona tag on each bot card; a picker to change it (kept for this server run) |

Idle habits run only when the bot has no target, isn't dodging, isn't in a boss room or a duel, and isn't scripted.

## Not in this phase
Life goals (phase B), proactive mind (C), learned movement (D). Persona picks aren't saved across restarts (the seeded
default is stable, so a bot keeps its personality anyway).

## Checks
- `node test/personality.js` (new): determinism, ranges, the neutral switch, idle habits stay out of fights, the chat
  multiplier.
- Existing bot tests (`botbrain`, `botskill`, `team`, `freebots`, `playerbots`, `teamplay`, `wardenskill`) still pass.
- Boss runs (`scripts/tuneboss.js`) before and after: kill times within the usual spread.
