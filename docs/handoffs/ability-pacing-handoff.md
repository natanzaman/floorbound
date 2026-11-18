# Handoff: ability pacing (slower, readable abilities: one PACE knob)

## Purpose
Natan watched a filmed take and found abilities resolve too fast to read. He wants them ~30% slower in the REAL game (not film-only),
for player skills and boss moves. Quoted (2026-11-18): "no need to adjust dmg and cooldowns much. cooldown starts when the ability
finishes being used. dmg, i wouldnt say so unless you think its good. bc the cooldowns still have to happen so its not like people
are spamming the abilties ever." Brief: docs/handoffs/ability-pacing-brief.md. Inventory: docs/handoffs/ability-pacing-table.md.
Progress log (append-only): docs/handoffs/ability-pacing-progress.md. Report recipient: Natan directly (session local_f125252f-0be1-4095-af79-f5ba8ad6836a started us).

## Git
Worktree /Users/natanzamanzadeh/floorbound/.claude/worktrees/floorbound-ability-pacing-ccacd8, branch claude/floorbound-ability-pacing-ccacd8,
base 1fc8892. node_modules installed by `npm ci` (gitignored). Do NOT touch public/cine.js, public/bubbles.js, scripts/film/.

## Design (decided; reverse by setting PACE = 1)
1. Knob, shared/data.js (near TICK_RATE):
   `export const PACE = 1.3;` and `export const paced = s => Math.round(s * PACE * 1000) / 1000;`
   plus `export function paceMoves(tbl, opts)` used to pace boss move tables in place (see 4).
2. Player skills, server: every EXISTING use time is x PACE; instant skills stay instant.
   Sites (wrap the delay with paced(), or pace the tuning table key in shared at definition, whichever keeps client and server
   in sync; the client reads these from event `d`, so either works):
   - server/game.js burst `this.schedule(i * 0.2` -> `i * paced(0.2)`.
   - shared/classes/ranger.js RANGER_TUNE: pierce.draw, sniper.draw, rain.delay, rain.every (descriptions: "half a second" ok;
     Rain "for 1.5 s" -> "about 2 s"). Not snare.arm (trap arming), not durations.
   - server/classes-a.js: Twin Axes cleave twin `g.schedule(0.22` -> paced(0.22); BERSERKER_TUNE whirlaxe.gap, leap.delay,
     earthshatter.delay (x PACE, in the table).
   - shared/classes/lancer.js LANCE: sky.air, hitrun.back, cyclone.gap.
   - Bard Crescendo build (3 s) is NOT paced (already a 3 s channel; desc says "builds for 3 s"): explicit exception.
   - server/mastery.js evolved skills: phantom 0.4, vortex 0.25, bladering i*0.5, starburst i*0.15, finisher i*0.3,
     seismic i*0.1 -> paced(...).
   - server/styles.js styled basic twin: `this.schedule(st.twin` -> paced(st.twin).
   - Buff/zone/song durations (Taunt 4 s, Wall 4 s, Bless 8 s, Sanctuary 5 s, Anthem, marks, traps): NOT paced (effects, not use).
3. Cooldown starts when the ability finishes being used (today: on the press, game.js:567 useSkill sets p.cds[slot]=now+cd).
   New module server/pacing.js, `installPacing(Game)`, installed LAST in game.js (after installTalents), wrapping `useSkill`:
   - before the call: `this._useCap = { max: 0 }`; wrap `schedule` so that while `_useCap` is set it records max(delay).
   - after the call (finally: clear _useCap): if `slot > 0` and `p.cds[slot] !== before` and `p.cds[slot] > this.time`,
     add `max` to `p.cds[slot]` (so the cooldown runs from the end of the last own hit).
   - Slot 0 (basic attacks) is exempt: its cooldown is the swing interval; keep the rhythm.
   - Lingering world effects are not "use": Rain of Arrows' falling rain. Give it a way out, e.g. `this.effectLater(delay, fn)`
     = schedule with _useCap temporarily null (talents.js wraps schedule to hand on the skill id; keep that working:
     effectLater must call this.schedule). Rain's cd then starts on the loose, as today.
   - Crescendo: its 3 s build is use, so its cd starts after the burst (adds 3 s to a 22 s cycle; fine, matches the rule).
   - Check server/director.js:523 (scene director calls g.useSkill) still works.
4. Bosses (Warden + Sovereign), shared tables, paced at definition with paceMoves:
   - every `wind` x PACE; quake.gap x PACE; the move's repeat `every` (number or per-phase array) += wind*(PACE-1) so the rest
     after the hit is unchanged (timers are set at wind-up start today: m.slamT = t + every). `first` timers unchanged.
     WARDEN: slam, charge, cleave, spin, rock, quake (+gap). SWEEP: wind, every. SOVEREIGN: sweep, geyser, wave.
   - Warden cleave and Sovereign sweep repeat on def.atkCd from the wind-up start (game.js ~1037, floor2.js ~289): add the
     extra wind (wind - wind/PACE) to m.atkT for bosses only.
   - Horn Charge dash steps game.js `W.wind + i * 0.1` -> paced(0.1); twists.js twin-horns delay uses W.wind (already paced).
   - Twists (shared/twists.js / server/twists.js:25) multiply WARDEN winds by Eclipse 0.85: they inherit the paced values. Check.
   - Field mobs (bites, thorns, orbs, lurkers, F2 mobs), rares: unchanged.
   - Reaction windows (PERFECT.window, GUARD.parry, DODGE) unchanged: they sit around the landing instant.
5. Client (public/, not cine.js): import PACE from /shared/data.js.
   - Skill clips at speed / PACE: main.js playSkillAnim (SKILL_ANIM), classes-a.js anim table (~line 89), classes-b.js playAnim
     (~191), styles.js combo anim table (~17), mastery evolved anims (go through ctx.playAnim = playSkillAnim).
   - Boss: world.js WINDUPS clip [name, speed, lead] -> speed / PACE, lead x PACE (map at definition); main.js:473 cleave shot
     and :498 bossShot F2 strike speed / PACE (its delay uses e.d already).
   - Hit flashes x PACE: world.js Effects.arc (0.22), ring (life), line (life), heal (0.8). NOT zone/telegraph/wedge/shield/
     aimLine (their life is a gameplay time from the server).
   - Leave rolls, jumps, hit reactions, deaths, emotes, potions alone.
6. Docs: public/guide.js and README.md where timings are stated (Rain 1.5 s, draw times, cooldown start).

## Checks
- `node test/combat.js` and every test that touches the changed files (grep test/ for the module names): classes-a, classes-b,
  talents, styles, warden3, newclass, botbrain, bots, evolve, playerbots, poses, team.
- Bot runs before/after: `ROLES=guardian,ranger,cleric,swordsman,lancer BOT_SKILL=5 RUNS=4 PORT=36xx node test/wardenskill.js`
  (before: docs/handoffs/ability-pacing-data/before.txt).
- Then code-reviewer (Opus high, fresh: brief + diff), fixes, rebase on main, merge --no-ff into main, run tests, push once:
  `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push --force-with-lease --force-if-includes origin main` (Natan's rule, 2026-11-18: never a plain push).

## Not verified
- Clip lengths read from public/models/knight.glb: slash clips ~1.0 s at 2.0x = 0.5 s; paced 0.65 s vs 0.55 cd: the next swing
  cuts the tail of the last (fine). Browser look not checked.

## Next chat
Read this file and the progress log, then continue from the progress log's last "Next:" line.
