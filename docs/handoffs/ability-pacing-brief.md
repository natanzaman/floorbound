# Brief: slower, more visible abilities — players and bosses (2026-11-18)

## Purpose
Floorbound (co-op 3D browser game, authoritative Node server at 20 Hz, Three.js client) is played by Natan and friends and filmed
for a Season 1 series. Watching a take, Natan found abilities resolve too fast to read on screen. Goal: abilities visibly "being
used": longer wind-ups / cast animations / effect durations, for players and bosses (the Horned Warden, Floor 2 bosses).
Read docs/ROADMAP.md, README.md (combat + classes sections), shared/ data tables (skills, styles, talents), server/combat.js,
server/classes-*.js, the boss code (grep "horn_sweep", "telegraph"), and the client animation side (public/main.js, world.js).

## Natan's decisions (2026-11-18, quoted)
- On "slow wind-ups and attack animations ~30% for players and the Warden in the real game":
  "no need to adjust dmg and cooldowns much. cooldown starts when the ability finishes being used. dmg, i wouldnt say so unless
  you think its good. bc the cooldowns still have to happen so its not like people are spamming the abilties ever."
- So: real game, not film-only; damage unchanged by default; cooldown should start when the ability finishes (check how it works
  today and change it if it starts on press).

## Approach
1. Inventory: list every player skill and boss move with its current wind-up / cast / active time, cooldown and how cooldown starts.
   Write the table to docs/handoffs/ability-pacing-table.md before changing anything.
2. Data-driven: one tuning knob (e.g. a `pace` multiplier in shared tuning, default ~1.3) applied to wind-ups, cast and effect
   durations, client animation speeds and telegraph times, rather than per-skill edits; per-skill overrides only where 1.3 looks wrong.
3. Keep gameplay sane: server and client timings stay in sync; dodge/parry windows and boss telegraphs scale together so fights
   stay fair; bots (shared/bots/) still use skills correctly.
4. Note any damage-rate change worth making in the report as a recommendation, don't apply it unasked.

## Done when
Tests pass: `node test/combat.js`, and every test that touches skills/bosses (grep test/ for the files you changed), plus a bot
boss run `ROLES=guardian,ranger,cleric,swordsman,lancer BOT_SKILL=5 RUNS=2 PORT=36xx node test/wardenskill.js` before and after
(report win rate and fight length both times). Guide (public/guide.js) and README updated where timings are stated. Opus-high
review (code-reviewer, fresh context, brief + diff), fixes, merge straight into main (rebase first), push (`git -c credential.helper=
-c 'credential.helper=!gh auth git-credential' push origin main`) — every push restarts the live server, so push once at the end.
Don't touch public/cine.js, speech bubbles or scripts/film/ (other sessions own them).
