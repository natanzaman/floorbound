# Duels (owner request, 2026-11-22)

> "Duels against other characters is great idea please. It can either be a solo pvp or team pvp. For team, all
> members of each of the challengers and challenged party is included and makes up a team."

Should work against other players, bots and the Named. Hard mode is pushed off for now.

## Rules (data in `shared/duels.js`)
- **Win rule, picked by the challenger** (a guess: the owner didn't choose one; easy to change in `DUEL_RULES`):
  - **First Strike:** the first clean hit wins (a dodge, parry or shield that stops all of it doesn't count).
  - **Half Health (default):** out at half health.
  - **Last Stand:** out at 1 health.
  - Nobody dies or goes down to a duel hit (a hit is trimmed at the rule's floor, 1 health at least), and at the end
    everyone gets back at least the health they started with. Mastery, threat, posture, loot and team stats don't
    count duel hits.
- **Solo or team.** Team: everyone in the challenger's party against everyone in the challenged player's party
  (same floor, up, not in another duel; the rest are told they sit it out). Both need a party, two different ones.
  Partymates can still duel each other solo (sparring).
- **Challenge:** within 30 m on the same floor, not in a boss room, nobody trapped or down. The challenge waits 30 s.
  A bot or one of the Named accepts by itself after 1-2.5 s.
- **Ring:** 22 m (solo) / 32 m (team) around the duel's centre. Team duels line each side up 7 m from the centre
  (anyone too far away is brought in). Outside the ring for 2 s = out. Leaving the floor or the game = out.
  Going down to a monster = out.
- **Clock:** 3 s countdown (no hits count), then 2 min (solo) / 3 min (team). On time: more fighters still in wins,
  then more health left (above the rule's floor), else a draw.
- **During a duel:** only your own side can heal you; no fast town regeneration. Duels work in town (the only place
  where hits from players land; monsters still can't hurt you there).
- **Damage:** a player's attack against a player does `DUEL.pvp` = 0.25 of its damage against a monster, then goes
  through the normal player damage path (dodge i-frames, guard, parry, shields, damage reduction, crits, the perfect
  dodge counter). Tuned with bot duels at level 12: Half Health takes about 5-15 s of fighting, Last Stand up to a
  minute for tanky pairs.

## How it works
- **Server (`server/duels.js`):** each live fighter carries a "duelist" stand-in mob (appended to `MOB_IDS`) that
  follows them, so every attack in the game (arcs, lines, arrows, traps, zones, evolved skills, talents) reaches an
  opponent the way it reaches a monster. A hit on a stand-in never runs the rest of `damageMob`: `duelHit` turns it
  into `damagePlayer(owner, …, { src: 'duel', duel: attacker })` when the attacker is a live opponent, and does
  nothing otherwise. During a skill press only the presser's opponents' stand-ins are targetable (`_duelAtk`), so
  nobody else's auto-aim or Cleave picks them. Snapshot: `w.du` (`readDuels`). Stats: `duels`, `duelWins`. Tracking
  event `duel`.
- **Small hooks in `server/game.js`:** `damagePlayer` takes `duel` (hits land in town), town regen pauses for `p.duel`,
  stand-ins skip the mob separation pass, `du` in the snapshot.
- **Client (`public/duels.js`):** Duel buttons in the Players list (players, bots and the Named), the picker (rule,
  Solo / Party vs party), the challenge card (Accept / Decline), the duel bar (rule, clock, both sides' health with the
  rule's line), a ring on the ground, red name plates and a red ring/marker on opponents, countdown, FIGHT!, VICTORY /
  DEFEAT / DRAW, a one-time guide tip. Only your live opponents' stand-ins are drawn and targetable; the target frame
  shows the opponent's name.
- **Bots (`shared/bots/brain.js`):** read `w.du`; only their live opponents' stand-ins are targets; during the
  countdown they step into the ring and face the other side; no leash, no travel while duelling.
- **Chat:** `/duel <name> [first|half|last] [team]`, `/duel accept`, `/duel decline`, `/duel cancel`, `/yield`,
  `/duel help`. Never shown as chat.

## Review fixes (independent review, same day)
- Stand-ins fail closed: only a known attacker's live opponents can target one. Skill presses set the attacker, and
  their scheduled hits keep it; arrows, sonic bolts, traps, Consecrate and Minefield pass their owner
  (`targetable(m, owner)`). Before: a Ranger's arrow hit their own stand-in first, Burst hit yourself, bystanders'
  arrows stopped on duellists.
- You need more than the rule's floor to start; a monster hit that takes a fighter to the floor puts them out.
- Only the health duel hits took comes back at the end (no free heal by starting a duel and yielding); a downed
  fighter gets nothing back.
- Guardian Spirit doesn't fire on duel hits; no fast town regeneration at all mid-duel.
- Challenges: one every 4 s per player; the challenge card no longer frees the mouse (Esc does, or /duel accept); a
  bot won't accept a team duel for a party with players in it.
- Bots step back into the ring when a chase takes them near its edge.
- Still open (low): shields and damage buffs from bystanders still help a duellist; a parry against a duel hit works
  from any angle.

## Not in this version
- Knockback, stuns, roots and pulls don't move or stop a player (damage only).
- No duel ranking or ladder; no betting; no spectator seats beyond watching nearby.

## Checks
`node test/duels.js` (in process: rules, ring, yield, healing, town, team, bots, clock, chat),
`node test/duelbots.js` (real bot brains on a real server: four class pairs and a 2 v 2),
`node test/duels.mjs` (browser: two players, Players → Duel, picker, card, bar, ring, red plate, VICTORY).
