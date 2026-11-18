# Ability pacing: inventory (before the change, 2026-11-17)

Written before any code change (brief: docs/handoffs/ability-pacing-brief.md). Times in seconds at today's speed.

## How it works today
- **Player skills resolve on the press.** `useSkill` (server/game.js:567) sets `p.cds[slot] = now + cd` and runs the skill in the
  same tick: single-hit skills land instantly; multi-part skills `schedule()` their later hits. So **cooldowns start on the press**,
  not when the skill finishes. The client shows the server's cooldowns (snapshot `cds`), so it follows whatever the server does.
- **Client animation** is a one-shot clip per skill at a sped-up time scale (main.js SKILL_ANIM, classes-a.js, classes-b.js,
  styles.js tables; 1.2x to 2.8x). Hit flashes are short: arc 0.22, ring 0.25 to 0.6, line 0.25 to 0.5, heal 0.8.
- **Bosses**: every big move has a wind-up `wind` (shared/data.js WARDEN, SWEEP; shared/floor2.js SOVEREIGN) sent to clients and
  bots as the event's `d`, so telegraphs, wind-up poses and bot dodges all follow the server value. The next use of a move is
  timed from the START of its wind-up (`m.slamT = t + every`), so a longer wind-up would eat into the rest after the hit.
- Reaction windows (perfect dodge 0.2, parry 0.2, dodge i-frames 0.42) are measured around the moment a hit lands, not the wind-up.

## Player skills (server timings)
| Class | Skill | Kind | Use time today (press to last own hit) | Cooldown | Cd starts |
|---|---|---|---|---|---|
| Swordsman | Slash (basic) | instant, 3-step combo | 0 | 0.55 | press |
| Swordsman | Rush | instant dash + line hit | 0 | 6 | press |
| Swordsman | Whirl | instant circle | 0 | 8 | press |
| Swordsman | Burst Combo | 4 hits (6 with Dual Blades) | 0.2 gaps: 0.6 (1.0) | 14 | press |
| Guardian | Bash (basic) | instant combo | 0 | 0.7 | press |
| Guardian | Taunt / Shield Wall | instant (+4 s buff) | 0 | 10 / 14 | press |
| Guardian | Ground Slam | instant circle | 0 | 12 | press |
| Cleric | Smite (basic) | instant bolt | 0 | 0.8 | press |
| Cleric | Heal / Blessing | instant | 0 | 4 / 20 | press |
| Cleric | Sanctuary | instant zone (5 s heal zone) | 0 | 18 | press |
| Ranger | Shot (basic) | projectile | 0 (arrow flies) | 0.6 | press |
| Ranger | Piercing Shot | draw, then arrow | draw 0.45 | 7 | press |
| Ranger | Rain of Arrows (evo) | volley, rain lands later | 0 for the archer; rain 0.6 + 5 x 0.3 | 7 | press |
| Ranger | Sniper Shot (evo) | long draw | draw 1.1 | 9.1 | press |
| Ranger | Disengage / Snare / Tumble | instant leap back | 0 | 9 | press |
| Ranger | Hunter's Mark / evos | instant | 0 | 16 | press |
| Berserker | Axe Chop (basic) | instant combo | 0 | 0.85 | press |
| Berserker | Cleave | instant (+0.22 twin with Twin Axes) | 0 (0.22) | 6 | press |
| Berserker | Whirling Axe (evo) | 2 spins | gap 0.35 | 6 | press |
| Berserker | Leap Slam / Earthshatter | leap, then land | 0.55 / 0.8 | 10 | press |
| Berserker | Pounce (evo) | instant | 0 | 7 | press |
| Berserker | Bloodrage / Frenzy / Warblood | instant (+buff) | 0 | 20 | press |
| Lancer | Thrust (basic) | instant combo | 0 | 0.6 | press |
| Lancer | Lance Charge / Comet | instant dash | 0 | 7 | press |
| Lancer | Hit & Run (evo) | dash, spring back | back 0.35 | 7 | press |
| Lancer | Sweep / Hamstring | instant | 0 | 9 | press |
| Lancer | Cyclone (evo) | 2 spins | gap 0.3 | 9 | press |
| Lancer | Sky Lance / Meteor / Pinning | leap, then crash | air 0.7 | 14 | press |
| Bard | Sonic Bolt (basic) | projectile | 0 | 0.7 | press |
| Bard | Anthem / Dissonance | instant (+song / slow) | 0 | 18 / 10 | press |
| Bard | Crescendo | channel, then burst | build 3.0 | 22 | press |
| Swordsman evo | Phantom Rush | dash, afterimage hit | 0.4 | 6 | press |
| Swordsman evo | Vortex | pull, then spin | 0.25 | 8 | press |
| Swordsman evo | Blade Ring | 4 ticks around you | 3 x 0.5 = 1.5 | 8 | press |
| Swordsman evo | Starburst | 6 hits | 5 x 0.15 = 0.75 | 14 | press |
| Swordsman evo | Finisher | 2 hits | 0.3 | 14 | press |
| Guardian evo | Seismic Slam | wave, 4 segments | 3 x 0.1 = 0.3 | 12 | press |
| Styles | twin-strike basics (e.g. Twin Axes, Warhammer) | 2nd hit | twin 0.12 to 0.14 | basic cd | press |

## Boss moves
| Boss | Move | Wind-up (telegraph) | Repeat | Timed from |
|---|---|---|---|---|
| Warden | Cleave (basic swing) | 0.75 | atkCd 2.0 (x0.7 enraged) | wind-up start |
| Warden | Ground Slam | 1.6 | every 6.5 / 5 / 3.75 by phase | wind-up start |
| Warden | Horn Charge | 1.5 (+0.3 dash) | 9.5 | wind-up start |
| Warden | Spin (phase 3) | 1.85 | 8 | wind-up start |
| Warden | Rockfall (phase 3) | 1.6 | 6 | wind-up start |
| Warden | Quake Ring | 2.0, rings 0.95 apart | 15 / 12 / 9.5 | wind-up start |
| Warden | Horn Sweep (perilous) | 1.2 | 12.5 / 9.5 / 7.5 | wind-up start |
| Warden twists | Eclipse: every wind x0.85; Echo: repeat 1.5 later; Twin Horns: second charge | follow WARDEN | | |
| Sovereign | Trident sweep | 1.1 | atkCd | wind-up start |
| Sovereign | Geysers | 1.65 | 7 / 6 / 5 | wind-up start |
| Sovereign | Tidal Wave | 2.3 | 15 / 11 | wind-up start |
| Field mobs | bites 0.45 (F2: 0.5 / 0.7), thorns 0.75, orbs 0.9, lurker 1.1 | | | |

## Plan (one knob)
- `PACE = 1.3` in shared/data.js (read by server, client and bots).
- Player skills: every existing use time above x PACE (draws, leaps, gaps between hits, channels, twin strikes), and the
  cooldown starts when that use time ends. Instant skills stay instant (use time 0), so their cooldown is unchanged.
  Basic attacks keep their rhythm (their cooldown is the swing interval). Buff and zone durations (Taunt 4 s, Sanctuary 5 s,
  songs) are effects, not use time: unchanged, so no hidden healing or damage buff.
- Client: skill clips play at speed / PACE; hit flashes (arc, ring, line, heal) last x PACE.
- Bosses (Warden, Sovereign): every wind-up x PACE; quake ring spacing x PACE; the repeat timer grows by the same extra
  wind-up, so the rest after each move is unchanged. Telegraphs, poses and bot dodges follow automatically (they read `d`).
  The strike clip after a boss wind-up also plays at speed / PACE. Reaction windows stay as they are (they are around the
  instant the hit lands, which does not move relative to the telegraph).
- Field mobs: unchanged (out of scope: "player skills and boss moves").
- Damage: unchanged.
