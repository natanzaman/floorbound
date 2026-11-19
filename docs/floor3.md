# Floor 3: The Gale Spires (design)

Roadmap task H4. Written before building; numbers are starting points, tuned with bot runs (section 9).

## 1. Theme
A wind-scoured mountaintop: the broken terraces of a sky temple, high above the cloud sea, at a golden late-afternoon light.
Pale limestone and bleached grass, banners torn by the wind, standing stones, collapsed aqueduct arches, and drifting
streaks of wind and cloud. Thunderheads gather over the summit, where the Storm Colossus stands.

Contrast with the floors below:

| | Floor 1 | Floor 2 | Floor 3 |
|---|---|---|---|
| Biome | forest and fields | night swamp | windswept cliff ruins |
| Light | bright day | dim teal mist | warm gold sun, long shadows, storm at the summit |
| Palette | greens | teal and violet | sand, slate, gold, electric blue |
| Ground | grass | mud, puddles, boardwalk | stone terraces, flagstone road |
| Danger | packs and archers | burrowers and homing orbs | knockback, flyers, armour, shields |

**Story beat (film team):** *Day 53. Above the cloud line the tower stops pretending to be a world: the stone ends in sky,
and a giant of storm-veined rock stands guard on the last terrace, as if it was carved to keep the bell from ever ringing a third time.*

## 2. Zone layout
Floor 3 lives 1200 units east of Floor 1 (everything with x > 900), on the same skeleton as Floors 1 and 2, so the
z-based heuristics (raid gate at z≈161, boss bar beyond z 120, music) work unchanged.

```
z 191  (O) The Eye of the Storm      boss plateau, r 27, ringed by storm pylons (wall)
z 161   =  The Storm Gate            raid gate, same 5 s ready check
z 150  |  corridor (x 1195-1205)
z 98-148   The Broken Aqueduct       acolytes, sentinels, harpies; aqueduct arches
z 26-98    The Windswept Steps        rams, harpies; standing stones and torn banners
z 0    (*) Windbreak Camp            safe zone, r 18: waystone, campfire, windbreak walls, Skill Shrine, Hall stone
```
- Field rect x 1132-1268, z -30..158; a flagstone road runs north up the middle (x 1200).
- Obstacles: standing stones and broken columns in the field, aqueduct piers in the upper field, pylons around the arena.

## 3. The camp: Windbreak Camp
A ring of stacked-stone windbreak walls around a brazier. Safe zone (no damage, fast regen) like Mirelight Camp: the waystone
(south of the brazier), tents in the lee of the walls, a Skill Shrine and a small Hall stone (latest Floor 3 clear, F6).
Deaths on Floor 3 respawn here.

## 4. Unlock and travel
- Floor 3 unlocks for a character who helped kill the Drowned Sovereign (`stats.sovereignKills > 0`, or the `floor3` flag).
- **Stairway:** for 60 s after a Sovereign kill a Stairway opens at the back of the Sunken Court (600, 207): step in, press F.
- **Waystones:** every town waystone lists Floors 1-3; Windbreak Camp gets its own (1200, -9).
- Recommended level 21+ for the field, 25+ for the Colossus. `SPAWN_AT=1200,150` spawns at the Storm Gate (and unlocks it).

## 5. Field enemies (one new mechanic each)
| Enemy | Lv | HP | Mechanic |
|---|---|---|---|
| **Crag Ram** | 21 | 1300 | **Knockback charge.** Lowers its horns (a lane telegraph), then charges through it; anyone hit is thrown back ~6 m. A Guardian guarding (or parrying) it **stops it dead and stuns it** for 2.5 s; a roll dodges it. |
| **Gale Harpy** | 22 | 800 | **Airborne.** Hovers out of reach: melee hits do only 35% while it's aloft (ranged hits from 6 m+ do full). It **dives** along a lane at someone, then sits **grounded** for 3 s, taking +25% damage. |
| **Storm Acolyte** | 23 | 700 | **Wind Ward.** Every ~12 s it channels a 2.2 s ward (a swirling ring) that shields itself and every ally within 12 m (30% of their max HP). **Interrupt it**: a Smite, a stun, a Break, or 3 hits during the channel. Otherwise it calls lightning strikes (circles) from range. |
| **Spire Sentinel** | 24 | 2000 | **Armoured.** Takes 55% less damage until it's **Broken**; then its shell cracks for 8 s (full damage, and the Switch). Slow; its stomp hits everything within 4.5 m (jump it or roll). |

## 6. Rare elites (the rare-spawn system, announced server-wide)
- **Skyrender** (rare Gale Harpy, Lv 26, 5200 HP): dives three times in a row, re-aiming each time, then lands for 4 s.
- **The Old Bastion** (rare Spire Sentinel, Lv 27, 7500 HP): armour 65%, a 6.5 m stomp, and when Broken it calls two Crag Rams.

## 7. The boss: the Storm Colossus
A stone giant of the temple, veins of blue lightning, a greatsword, a crown of storm. Health scales with the fighters who
walk in (like the Warden/Sovereign), Lv 28. Every move has a wind-up pose and a telegraph that fills toward impact.

**Phase 1 (100-66%):**
- **Hammerfall** (basic): greatsword chop on a wedge in front.
- **Lightning Strikes:** circles under fighters (+strays); 1.7 s to step out.
- **Gale Push:** a wide cone in front after a 1.5 s wind-up (sword drawn back, wind gathering): damage and a 7 m shove. Roll through it or stand behind/beside.

**Phase 2 (66-33%), adds:**
- **OVERLOAD** (the team mechanic, section 7.1).
- **Gale Harpies:** two harpies drop in every ~26 s (max 3).
- Lightning Strikes add more strays.

**Phase 3 (<33%), adds:**
- **Tempest Beam:** the Colossus plants its sword and a beam of lightning sweeps a full circle around it (about 7 s per
  turn). **Jump over it** as it passes you, or roll through it. Bigger hit than a Quake Ring.
- Overload comes more often.

G4 team mechanics (shared meteor, spread, tether) join the rotation from phase 1 with 2+ fighters.

### 7.1 Overload (uses the G team systems)
The Colossus kneels, raises its sword and **channels for 8 s**; a bar fills over the boss. Its guard is open: posture
starts half full. To stop it:
- **Break it, then land a Switch** (a different player hits it while Broken), or
- **fire a Team Burst** into it (2+ joiners), or
- **solo**: a Break alone is enough.

**Stopped:** the Colossus is **Grounded**: stunned 4 s, then takes +30% damage for 8 s. Banner and a big crack of light.
**Not stopped: THUNDERCLAP** hits everyone in the arena for 55% of their max health (Shield Wall, Sanctuary, Aegis, guard
all help; i-frames don't), and the Colossus is **Charged** (+25% damage) for 15 s.

Bots: during Overload every bot may Break (tanks and DPS spend their Break skills) and joins any Team Burst.

### 7.2 Twist pool (rolled per Colossus spawn, shown on the gate panel and boss bar)
| Twist | Effect | Reward |
|---|---|---|
| **Tailwind** | Gale Push throws 50% farther and comes more often | +1 loot roll |
| **Thunderhead** | +2 Lightning Strike strays, and strikes chain once (strike again 1.2 s later) | +50% gold |
| **Stoneskin** | 35% less damage taken outside a Break or Grounded; Grounded lasts 2 s longer | +1 loot roll |
| **Static** | Overload from phase 1, channel 1.5 s shorter | +1 loot roll, +50% gold |
| **Calm** | no twist | none |

### 7.3 Rewards
Last Attack Bonus: **Stormheart** (charm, Legendary: +12% attack, +8% crit, +8% faster cooldowns). Everyone who fought:
gold and two Rare/Epic items (table `boss3`). Title **Stormbreaker** (help defeat the Storm Colossus). First server clear
rings **THE THIRD BELL**.

**Loot sets (H2):** once `shared/loot.js` lands, add the **Stormforged** set (3 pieces: Stormforged Greatblade / Plate /
Sigil; 2-piece: +10% posture damage; 3-piece: Switches against a Broken boss deal +20% and refund 2 s of your Break skill)
as `boss:colossus`, and Floor 3 mob entries (`mob:ram`, `mob:harpy`, `mob:acolyte`, `mob:sentinel`, rares `rare:skyrender`,
`rare:bastion`). Until then, drops use today's `DROPS` table with a `TODO(H2)` note.

## 8. Progression to level 30
- `MAX_LEVEL` 30; the XP curve stays `50 × level` (Lv 20→30 takes 12,250 XP; Floor 3 mobs give 230-380).
- Talent points: one per level (29 at 30); every class's bot spending path extends into its second branch.
- Mastery: unchanged (it levels by use); premade bot loadouts gain a Lv 25 row (Epic gear, Mastery 5).
- Progression track milestones: Lv 21 Floor 3, Lv 25 the Storm Colossus, Lv 30 max.

## 9. Tuning targets (bots at capability 5, Lv 30)
- trio (Guardian, Swordsman, Cleric): about 100-150 s, winning most runs;
- 6 bots: about 100-160 s;
- a clear step up from the Sovereign (H1's targets: 90-130 s / 90-140 s).
`node test/floor3boss.js` (like `test/wardenskill.js`) runs it and reports Overloads stopped / Thunderclaps, beam hits and jumps.

## 10. Client
- `public/floor3world.js`: terrain, terraces, ruins, camp, the arena with pylons and a storm sky over it, atmosphere
  (warm gold fog, low clouds below the cliff edge), the Colossus rig (knight, stone tint, lightning veins) and block models
  for the field enemies.
- `public/floor3client.js`: snapshot (`w.f3`: gate, harpies aloft, wards, Overload bar, beam), events (`f3fx`, `f3beam`,
  `f3phase`, `la3`, `clear3`, `gate3`), callouts and banners, the Stairway from the Sunken Court.
- Wind-up poses: `ramCharge` (crouch), Colossus `gust` (sword drawn back), `overload` (kneel, sword raised), `beam`
  (sword planted), `strike` (arm raised).

## 11. Code layout (Floor 2 pattern)
`shared/floor3.js` (map, enemies, tuning; appended into `data.js`), `server/floor3.js` (AI, Colossus, gate, Stairway),
`public/floor3world.js`, `public/floor3client.js`. Floor-2-only checks are generalised with `floorOf(x)` (1 / 2 / 3).
