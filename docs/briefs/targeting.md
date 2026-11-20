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
  attack; `aoe: true` for crowd-control cones and spins that ignore the Cleave toggle. Class tunes (BERSERKER_TUNE,
  LANCE, SONG) and style steps keep their own `r` / `half`.
- Weapon styles: `mods.fov` (x the half-angle of every arc attack of that style). All styles 1 today (no balance
  change); the hook is there for wider-but-slower weapons. A style step can carry its own `n`.
- Pure functions: `pickTarget` (the four modes), `inCone`, `capTargets` (lock first, then nearest), `rayPick`
  (first enemy along a line, for aimed marks / leaps), `cleanPrefs`, `attackFov`.

## Message
Client → server `{ type: 'tprefs', mode, cleave, max }` after every `welcome` and whenever fb_controls changes.
Validated by `cleanPrefs`; stored on `p.tprefs`. Bots never send it: `p.tprefs` stays null = today's behaviour
(no caps, no lock preference), so bots are unaffected.

## Where each mode is applied
Client (public/main.js `useSkill`, one `autoTarget(range)` for every class):
- the skill's engage range is today's (auto skills 6 / 9 / 11 m, style reach, Ranger / Berserker `aimRange`,
  Lancer / Bard `aimRange`).
- nearest: face the nearest enemy in range. lock: the locked target at any distance up to the lock range (no 14 m
  cutoff), else the nearest. cone: the locked target if inside the 120° cone around the camera's look, else the
  nearest inside the cone, else attack straight ahead. aimed: face the camera look (crosshair / right stick), no pick.
- Guardian guard facing (public/combat.js) uses the same `autoTarget(12)`; aimed: faces the camera look.
Server (server/targeting.js + small hooks):
- `aimA` (Ranger / Berserker server aim): aimed → none (no re-aim, no homing). lock / cone → the locked target
  when it is in range and inside the skill's cone (it used to lose to a nearer enemy off-axis).
- `pickFront` (marks, pounce, leap, Sky Lance, Challenge): aimed → `rayPick` along the aim; cone → half capped at 60°.
- Arrows (`fireArrowA`): aimed → no homing target, radius + AIM_PAD. Smite, Bard sonic bolts, style bolts: aimed →
  radius + AIM_PAD (they already fly straight).
- Cleave: `hitArc` and every hand-written arc loop (Executioner, Finisher, Hamstring, Bard chords, style arc / line
  / ring basics, the Lancer thrust line) go through `capHits(p, list, A)`: cleave on → at most min(A.n, max); off →
  one (the locked target if inside, else the nearest). `aoe` attacks ignore it. Circles (Whirl, slams, rain,
  leaps), dash lines (Rush, Charge) and projectiles are unchanged.

## Per class
- Swordsman / Guardian: slash / bash / burst / starburst / finisher arcs from ATTACKS; rush, smite, challenge,
  seismic turn by mode.
- Cleric: smite turns by mode; aimed: straight bolt with padded hitbox.
- Ranger: shot / pierce / sniper / volley / marks; server aimA and arrow homing follow the mode.
- Berserker: chop / cleave / executioner capped; pounce / leap use pickFront (ray in aimed).
- Lancer: thrust line capped; Sky Lance spot via pickFront; hamstring aoe.
- Bard: sonic bolts padded in aimed; chords aoe.
- Weapon styles: arc / line / ring basics capped (step `n`), bolt basics padded in aimed, `mods.fov`.

## Tests
- test/targeting.js: pure pickTarget (4 modes, cone edge, lock behind you, far lock), capTargets, cleanPrefs; server
  cleave on / off / cap, aimed straight arrows (no homing, walk-in hit, padded hitbox), lock preference in aimA, bots
  without prefs unchanged.
- Regression: combat, classes-a, classes-b, styles, controls, controlsync, bots, wardenskill quick run.
- test/targeting.py (Playwright): Combat options on the Controls screen, persist across reload.
