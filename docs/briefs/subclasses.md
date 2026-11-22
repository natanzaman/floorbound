# Subclasses: specialise at level 15 (Phase 3, owner request, 2026-11-22)

## Owner decisions
- Phase 3 of the Academy: **specialisation at level 15, two subclasses per class**.
- A hidden hybrid path exists. **It is never advertised**: no UI list, guide, README, tooltip or story text names it.
  It lives only in the code, this brief and the tests. Players assume they pick one class tree.

## What is built
### Subclasses
- `shared/subclasses.js` `SUBCLASSES`: 14 entries `{ cls, branch, name, blurb, skill }`. Each is built on one talent
  branch of its class and adds two nodes to it (`SUB_NODES` in `shared/talents.js`, tier 2 at x -1 and +1, `sub` field,
  `req` on that branch's tier-1 side node). Sub nodes do not count for tier gates (`spentAbove` skips them) and are
  dropped by `newTalents` / refused by `allocError` / `spendBlock` when the character is not in that subclass.
- Their talent effects aim at the signature skill with the skill key `'sig'` (damage and cooldown, or cooldown only for
  support skills); the client shows that key as "Signature skill".
- **Choosing:** the Academy panel's Specialise section, shown to graduates (never Initiates) from `SPEC.lvl` (15). The
  section lists the class's two options with their blurb, branch and skill; a pick asks to confirm. The first pick is
  free; a change costs `200 + 20 × level` gold (`specFee`). Picking sets slot 5's cooldown to 5 s.
- **Where it lives:** `path.subs = { cls: subId }` (one per class, so a class change keeps each class's pick).
  `cleanPath` keeps `subs` (and the hidden fields below). Legacy characters (`path` null) get a path record on their
  first pick, like any other Academy action.
- **The signature skill** sits in a new **slot 5** (`p.cds[4]`). `useSkill(p, 4)` goes to `useSignature`
  (server/subclasses.js `SIG_FNS`): cooldown × haste × the `'sig'` talent cooldown mod. The 14 skills reuse existing
  fx kinds (`ring`, `arc`, `line`, `burst`, dash) with their own colours, so they read on screen without new art.
- **Controls:** new action `skill4` ("Signature skill"), default G on keyboard (X is the weapon swap), LB+RT on the pad, rebindable on the
  Controls screen. HUD: a gold fifth button with a tooltip (name, cooldown, description); on touch it sits in the
  skill grid's second row. Every 4-slot array (`cds`, the client's `ready` / `lastPress`) is now 5 long.
- **Not covered on purpose:** signature skills earn no mastery (no evolutions), and nothing outside their own talents
  shortens slot 5: skill chains, the Team Burst, Zeal, Encore, the Dual Blades switch cut and the Flow keystone all
  loop over slots 1-3 only. Cheap to add later if wanted.
- **Where it works:** not inside a trial or drill pen (the yard's own kit). Buffs and heals reach players near you,
  never the other side of a duel (`sigAllies`). Aimed targeting works through `pickFront` (`skySpot`).
- **Private lines:** the spec banners and every refusal or notice to one player go to that player's socket only
  (`Game.priv` / `sysPriv`: the snapshot's `pe` field), never into the shared world.
- **Show:** nameplates and the Players list show the subclass name instead of the class (`rosterPath` / plate tag);
  the Skill Tree shows the two subclass nodes in their branch (only your own subclass's), tooltip "specialisation".
- **Admin:** a Subclass select and "Set subclass" in the character editor (blank clears it); a path edit drops another
  subclass's talent nodes.

| Class | Subclass | Branch | Signature skill | Cooldown |
| --- | --- | --- | --- | --- |
| Swordsman | Duelist | tempo | Flash Step | 18 s |
| Swordsman | Vanguard | link | Rallying Cut | 24 s |
| Guardian | Bulwark Knight | bulwark | Aegis of the Line | 32 s |
| Guardian | Warlord | warlord | Conqueror's Roar | 24 s |
| Cleric | Lightbringer | mercy | Dawnburst | 30 s |
| Cleric | Inquisitor | judgement | Judgement Ray | 16 s |
| Ranger | Sharpshooter | marksman | Deadeye Shot | 18 s |
| Ranger | Trapmaster | trapper | Snare Field | 24 s |
| Berserker | Reaver | carnage | Rampage | 20 s |
| Berserker | Blood Knight | bloodlust | Crimson Pact | 18 s |
| Lancer | Dragoon | dragoon | Wyvern Dive | 22 s |
| Lancer | Phalanx | phalanx | Spear Wall | 26 s |
| Bard | Virtuoso | maestro | Encore | 40 s |
| Bard | Siren | discord | Siren's Wail | 22 s |

### Bots and the Named
- Premade bots pick by role at level 15+ (`BOT_SUB`: Duelist, Bulwark Knight, Lightbringer, Sharpshooter, Reaver,
  Dragoon, Virtuoso): `botSpecialise` in the player-bot outfit, and `createBot` sends `sub` on join so anonymous bot
  joins get it too. The brain learns its subclass from `me.sub` and uses slot 5 through `sigTurn`
  (`shared/bots/subclass.js`): melee skills in reach of the target, ranged ones in range, crowd skills with 2+ enemies
  close (or a boss), party buffs and heals when allies are near (heals at low party health). Sub nodes are spent first.
- The Named: Halvard Bulwark Knight, Maribel Lightbringer, Tovin Sharpshooter, Sennet Phalanx, Cairn Dragoon
  (`sub` in `shared/named.js`).
- Server-run bots (`botmanager.addBotPlayer`) specialise on joining at 15+; the Named do it in their outfit. Director
  film actors are untouched (their join carries `actor`).

### The hidden path (never advertised)
- **Server only:** its id, rules, name and texts live in `server/wander.js` (`WANDER`, `canFind`, `borrowFrom`,
  `cleanBorrow`, `keepWander`, `wanderBlock`, `borrowedTotals`). No file the browser loads (public/ and every shared file
  it imports) names it; `test/subclasses.js` walks the imports and checks. Shared `cleanPath` drops its fields;
  the server puts them back with `keepWander` (on load and on admin edits).
- Id `wanderer`. It is found at an unlisted **lectern** 4.5 m behind the Academy
  hall (`LECTERN` in `shared/academyyard.js`; the interact bar says "Read"). Reading it does nothing unless the
  character is a graduate of level 15+ who has passed the trials of **2+ different classes** (`canFind`); then
  `path.found = 1` and a third option appears in the Specialise section.
- The option's text is sent by the server only once found (`specMsg` `hid`), so the client bundle holds none of it.
- The pick: keep your class, take **one skill** (slot 1 or 2 of another class whose trial you passed) into slot 5 and
  the **first tier of one talent branch** of that class (every tier-0 node at max rank), both at **80% power**
  (`WANDER.pow`, `tierPow`). No signature skill, no sub nodes. Stored as `path.wb = { cls: { c, sk, br } }`.
- Server enforcement (`wanderBlock`): not found gets the same answer as any unknown id; an Initiate, under level 15, a class not passed, the own class, a skill
  outside slots 1-2, an unknown branch or too little gold are all refused. A borrowed skill runs through the other
  class's own code (`useBorrowed` swaps `p.cls` for the call and restores it and every cooldown), at 80% via `skillPow`.
- It never shows on plates, the Players list or `me.sub` (the class shows).

## Balance
`scripts/tuneboss.js --boss sovereign,colossus --party 6 --skills 5 --runs 3` (bots at level 18+, each specialised by
role) before and after: Sovereign 153 s (145-158) → 147 s (124-165), Colossus 145 s (124-163) → 149 s (127-164), every
fight a kill. Both within 5%, so no skill was tuned. Bosses are not touched; if a later change moves a fight more than
10%, tune the signature skills (`n` in `shared/subclasses.js`), not the bosses.

## Tests
`node test/subclasses.js`: pure rules, in-process specialise / slot 5 / fee / talents / hidden-path enforcement, bots
and the Named, and with `DATABASE_URL` a server run (graduate, level 15, specialise, slot 5, restart, still there; an
old character and an Initiate unchanged).
