# Brief: J3 review fixes, part A (boss combo state machine)
Worktree: /Users/natanzamanzadeh/floorbound/.claude/worktrees/parallel-worktree-tasks-0648c6/wt/openings (branch feat/openings, HEAD 30edaf0). Work ONLY there. Do NOT commit. Another implementer (part B) edits other files in the same worktree at the same time: touch only the files listed below.
Findings: docs/briefs/reviews/j3-soft-review.md (in the ROOT worktree, one level up from wt/: ../../docs/briefs/reviews/j3-soft-review.md) findings 1, 2, 5. Specs: ROOT docs/ROADMAP.md section J3 (around lines 463-620).

## Do
1. Finding 1: combos ignore the "boss waits" delays after team mechanics (server/bossteam.js btChannel ~:82-85), traps and the Colossus fall (server/arenas.js TIMERS ~:25, :96). Make m.comboT (and any in-flight m.seq) respect those waits (push comboT with the other timers, and/or refuse a combo start while a meteor/spread is active for m or m.btChanUntil > t).
2. Finding 2: later combo steps ignore busyUntil (server/openings.js ~:88-95, server/twists.js ~:139-146 Twin Horns). In bossCombo, when t >= q.next && t < m.busyUntil, push q.next = m.busyUntil. Twin Horns' second horn from a combo step must not overlap the next step (skip it or wait). Drop m.seq / m.after on a phase change (Sovereign Deluge at 33%: next step waits until the Deluge is done; 'planted' must not stick).
3. Finding 5: combo start must wait for closeReady(m, steps[0]) like single moves do.
Each finding: write the regression test FIRST in a new file test/j3combo.js (in-process, style of test/bosstiming.js and test/bossteam.js: `new Game()`, pin RNG, tick), see it fail on the current code, then fix. Tests named in the review: Colossus engaged, comboT due, btMeteor(m,p), tick: m.seq null until land + BOSSTEAM.channel; same after arenaCrack: no combo before resume + T.resume; Twin Horns forced, Warden p1, combo {steps:['charge','slam']}: no slam circle before the second tele k:'line' lands; Sovereign combo crossing 33% HP: next step waits until delugeAt; combo start waits for closeReady.

## Files you may edit
server/openings.js, server/bossteam.js, server/arenas.js, server/twists.js, test/j3combo.js (new). Nothing else (part B owns server/game.js, server/floor2.js, server/floor3.js, shared/*, public/*, test/bosstiming.js).

## Done when
test/j3combo.js passes (and each case failed before its fix), and these pass, each with its own PORT in 37400-37459 where it takes one: node test/j3combo.js, test/bosstiming.js, test/bossteam.js, test/warden3.js, test/arenas.js, test/rescue.js, test/revive.js, test/director.js, test/pacing.js, test/combat.js, test/threat.js, test/sovtwists.js, test/floor3.js. If a test fails because of part B's concurrent edits (files you did not touch), say so, do not fix it.
Report: per finding what changed (file:line), the test result lines copied, anything not verified, open questions. No design decisions: report them.
