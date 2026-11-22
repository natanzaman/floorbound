# Phase 1 combat quick wins (owner-approved, 2026-11-22)

Four small additions that give each role a clear job in a fight. Data first (tables in `shared/`), one server module per
feature installed onto `Game.prototype`, a small client module each, no new models or art (visuals are on hold: HUD
feedback only). Director film shows run unchanged: every feature here is off while `director.running`.

## 1. Breakable boss parts (`shared/bossparts.js`, `server/bossparts.js`, `public/bossparts.js`)
- `BOSS_PARTS[boss].parts`: `{ id, name, call, arc: [from, to] (degrees from the boss's facing; + is its left), hp
  (share of the fight's max health), loot (a LOOT key), tm (changes to the fight's move table), off (moves it stops) }`;
  `all`: what happens once every part is broken (the Colossus's kneel).
  - Warden: **Horns** (front, -60..60), 8%: the Horn Sweep stops for the rest of the fight; the horn charge winds up x1.35.
  - Sovereign: **Trident hand** (its right side, -125..-15), 8%: the trident sweep winds up x1.3; one geyser fewer.
  - Colossus: **Left knee** (60..180) and **Right knee** (-180..-60), 6% each: both broken = it kneels for 6 s, taking
    +25% damage, once per fight (waits for Overload / the fall to the Undercroft to end first).
- Part damage: every hit on the boss from inside a part's arc (attacker's position vs the boss's facing) adds its damage
  x1.5 when the attacker is within 5 m of the boss's edge (melee), x0.5 from farther (arrows, bolts, spells). Melee gets
  a clear job. Each hit counts its own damage once (a hit nested inside another, such as a Shatter Chorus out of a
  Break, is not counted again in the outer one).
- A broken part: `bpart` event (callout "HORNS BROKEN" etc.) and the effect applies to the fight's move table `m.tm`
  (a copy; the next fight starts clean from `bossTable`). The bonus personal loot roll from
  `LOOT['part:<boss>_<part>']` (shared/loot.js; `sourceOf` knows `def.part`) is paid when the boss dies, to each
  fighter in the arena, for every part broken in that winning fight: a reset fight (wipe, walk-out) pays nothing, so
  parts can't be farmed. Part state is made when the boss engages (pips from the start). The kneel drops the
  Colossus's strikes and gusts already under way.
- Snapshot `w.bp`: `[[boss id, [part health % ...], kneel s left]]` while a boss with parts is engaged.
- Client: one small pip bar per part under the boss bar (grey when broken), the callout, a KNEELING line on the bar.
- Bots (skill 4-5, melee, not the tank): stand in an unbroken part's arc when it's safe (side / rear parts any time;
  a front part only while the boss is Broken or in an opening).
- Check: `scripts/tuneboss.js` before / after (6 bots, skill 5): fights may not shrink by more than ~10%.

## 2. Enemies that force a role (`shared/mobroles.js`, `server/mobroles.js`)
Appended to the mob tables (ids only appended: indices are wire format), small counts, existing telegraphs and models
(`def.look`: the client draws an existing model, `lookScale`). Spawned from one table (`ROLE_SPAWNS`) after every floor
and the labyrinths are set up, so every older mob keeps its id. During a director show they sit out (and plate and the
heal channel are off), so filmed episodes are unchanged.
- **Ironhide Boar** (Floor 1, 3 in the meadow): `plate: 0.7` (70% less damage) until its posture Breaks, then x1.25
  while Broken. Posture builds from the uncut damage, so every class can Break it. Teaches Break. ARMOURED / PLATE
  CRACKED tags.
- **Mire Bulwark** (Floor 2, 4): the Shieldback's `shell` (0.15) over a wider front (`shellArc`), and a Break drops the
  shield for `shieldBreak` 6 s. Flank it or Break the shield.
- **Gale Harrier** (Floor 3, 4): the harpy AI with `aloft: 0`: melee can't touch it while it hovers; it can during its
  swoop (`swoopHit`), after it lands, and from a jump; arrows, bolts and spells (6 m+) hit it any time.
- **Mire Hexer** (Floor 2, 4): keeps its distance, throws a slow hex circle, and channels a heal on allies near it
  (2.4 s wind-up with a ring telegraph, `chan` event). Interrupt it (a stun, a Break, an interrupting hit such as Smite,
  a knock-back of 1.5 m+, or 3 hits during the channel) and it is stunned 2.5 s. It never mends another caster or an
  elite, and one mob is mended at most once every 10 s.
- XP / loot in `DROPS`. Bots: melee flank shielded mobs (skill 3+), ranged prefer flyers, melee skip hovering flyers,
  Break skills on armoured mobs, interrupt channelling casters (skill 4+).

## 3. Two weapons, swap mid-fight (`server/weaponswap.js`, shared `SWAP` in `shared/styles.js`)
- `inv.eq.weapon2`: a second weapon of your class (old saves simply have none). Only the active weapon gives stats and
  the style. Bag: "Equip as 2nd weapon" on a weapon, the 2nd slot shows under the worn gear (click to take it off).
- Swap action (`swap`, default X / pad LB+Down, rebindable): `{ type: 'swap' }`. 1 s cooldown, not while downed,
  guarding, rolling, airborne, trapped, in a pose, in a boss arena's fall, within 0.35 s of a skill press or while a
  skill's own delayed hits are still coming (mid-skill). Cooldowns carry over. A swap between two styles is a chain
  step (`swap`) once a hit lands after it in the new style (booked at the swap's time), so a chain can cross styles;
  a swap that isn't followed by a hit, or between two weapons of one style, is no step. A loadout that wears the spare
  swaps the two. Bots: not in v1 (optional in the plan; skipped).

## 4. Clutch moments (`shared/clutch.js`, `server/clutch.js`, `public/clutch.js`)
- **Last Stand**: a hit that would down or kill you within 10 s of your last perfect dodge or parry leaves you at 1 HP
  with 1.5 s of invulnerability and a LAST STAND callout. Once per fight (boss fight id; field: once per 90 s). Not in
  duels or towns.
- **Finisher**: every floor boss kill (the Last Attack is always the killing blow, so this is every kill outside a
  director show): `finisher` event to everyone in that fight; the client plays one slow-motion beat (visual only; not
  a second one on top of the boss's own death beat) unless Reduce motion is on. A kill by a Team Burst also gets a
  TEAM FINISHER callout.

## Tests
`test/combatqw.js`: tables, arcs, part damage, effects on a table, the loot source, the swap rules, Last Stand, and a
server run (a Warden fight driven by hand: horns break, sweep stops; an Ironhide Boar's plate; a swap). Plus the
existing combat / styles / chains / controls / team / boss runs.
