# Targeting modes and cleave (`feat/targeting`)

Owner request (2026-11-20): attacks always went to the nearest enemy even when facing or locked on another. Make
targeting a player choice under Controls → Combat, plus a Cleave toggle and a max-targets setting.

## Settings (fb_controls.combat, synced with the account)
`{ target: 'nearest' | 'lock' | 'cone' | 'aimed', cleave: bool, max: 1..8 }`. Defaults: `lock` (Locked or nearest,
closest to before), cleave on, max 8. Cleaned by `cleanPrefs` (shared/targeting.js) in `cleanControls`, so the
account copy holds only those values.

## Data (shared/targeting.js)
- `TARGET_MODES` with labels and one-line descriptions (Controls screen and guide).
- `CONE_HALF` = 60° (a 120° cone), `AIM_PAD` 0.35 m (aimed projectiles' hitbox over the visual), `LOCK_RANGE` 45 m.
- `ATTACKS`: per basic attack / ability: `r`, `half` (the base attack field of view, today's hitArc values) where the
  value used to be hard-coded in game.js / mastery.js, and `n` (its own target limit) for every arc / multi-hit
  attack. `aoe: true`: an area attack, Cleave and max targets don't apply (its own `n` still does): Bard chords,
  Hamstring, the Berserker's Cleave skill (a 180° sweep), all-round ring basics. `round: true`: all around you, Cone
  mode's filter doesn't apply (ring basics, Feedback). Class tunes (BERSERKER_TUNE,
  LANCE, SONG) and style steps keep their own `r` / `half`.
- Weapon styles: `mods.fov` (x the half-angle of every arc attack of that style). All styles 1 today (no balance
  change); the hook is there for wider-but-slower weapons. A style step can carry its own `n`.
- Pure functions: `pickTarget` (the four modes), `crosshairPick` (moved from public/classes-a.js `pick`), `inCone`,
  `capTargets` (lock first, then nearest, or nearest the aim line), `rayPick`
  (first enemy along a line, for aimed marks / leaps), `cleanPrefs`, `attackFov`.

## Message
Client → server `{ type: 'tprefs', mode, cleave, max }` after every `welcome` and whenever fb_controls changes.
Validated by `cleanPrefs`; stored on `p.tprefs`. Bots never send it: `p.tprefs` stays null = today's behaviour
(no caps, no lock preference), so bots are unaffected.

## Where each mode is applied
Client (public/main.js `useSkill`, one `autoTarget(range)` for every class):
- the skill's engage range is today's (auto skills 6 / 9 / 11 m, style reach, Ranger / Berserker `aimRange`,
  Lancer / Bard `aimRange`).
- nearest: face the nearest enemy in range. lock: the locked target within max(14, range + 4) m (as before: a slash
  doesn't spin to a boss 30 m away), else, for ranges over 12 m (bows, bolts), the crosshair pick (the enemy nearest
  the camera's line of sight within ~26°, else anything within 7 m: the old Ranger behaviour), else the nearest.
  cone (lock honoured within the same distance): the locked target if inside the 120° cone around the camera's look, else the
  nearest inside the cone, else attack straight ahead. aimed: face the camera look (crosshair / right stick), no pick.
- Guardian guard facing (public/combat.js) uses the same `autoTarget(12)`; aimed: faces the camera look.
Server (server/targeting.js + small hooks):
- `aimA` (Ranger / Berserker server aim): aimed → none (no re-aim, no homing). lock / cone → the locked target
  when it is in range and inside the skill's cone (it used to lose to a nearer enemy off-axis); with no lock, the
  old best-in-cone pick around the facing the client chose (so it keeps the crosshair pick).
- Every `skill` message carries `look` (the camera's yaw; finite, wrapped, else none).
- `pickFront` (marks, pounce, leap, Sky Lance, Challenge): aimed → `rayPick` along the aim; cone → half capped at 60°.
- Arrows (`fireArrowA`): aimed → no homing target, radius + AIM_PAD. Smite, Bard sonic bolts, style bolts: aimed →
  radius + AIM_PAD (they already fly straight).
- `capHits(p, list, A)`: `hitArc`, the hand-written arc loops (Executioner, Finisher, Hamstring, Bard chords via
  `arcTargets`), style arc / line / ring basics and the Lancer thrust line.
  1. Cone mode: drops enemies outside the cone around `p.aimYaw` (not for `round` attacks; old clients without `look`:
     no filter), even when no target was picked and for cleave hits.
  2. Cap: `aoe` → its own `n` only; else Cleave on → min(A.n, max), off → 1.
  3. Order when capped: the lock first (Locked or nearest, Cone), then the nearest; Nearest mode: nearest first;
     Aimed: the nearest to the aim line.
  Circles (Whirl, slams, rain, leaps, Warhammer's ring finisher), dash lines (Rush, Charge, Phantom: movement
  attacks) and projectiles are unchanged, Cone filter included.

## Per class
- Swordsman / Guardian: slash / bash / burst / starburst / finisher arcs from ATTACKS; rush, smite, challenge,
  seismic turn by mode.
- Cleric: smite turns by mode; aimed: straight bolt with padded hitbox.
- Ranger: shot / pierce / sniper / volley / marks; server aimA and arrow homing follow the mode.
- Berserker: chop / executioner capped, Cleave skill aoe (its own 8); pounce / leap use pickFront (ray in aimed).
- Lancer: thrust line capped; Sky Lance spot via pickFront; Hamstring aoe (cone-filtered).
- Bard: sonic bolts padded in aimed; chords aoe (cone-filtered; Feedback all-round).
- Weapon styles: arc / line basics capped (step `n`), ring basics aoe + round, bolt basics padded in aimed, `mods.fov`.

## Tests
- test/targeting.js: pure pickTarget (4 modes, cone edge, lock behind you, far lock), capTargets, cleanPrefs; server
  cleave on / off / cap, aimed straight arrows (no homing, walk-in hit, padded hitbox), lock preference in aimA, bots
  without prefs unchanged.
- Regression: combat, classes-a, classes-b, styles, controls, controlsync, bots, wardenskill quick run.
- test/targeting.py (Playwright): Combat options on the Controls screen, persist across reload.
