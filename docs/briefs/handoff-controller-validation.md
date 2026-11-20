# Handoff: controller validation chat 4, 2026-11-20

## Purpose
Natan wants to play Floorbound with a real controller. Validate gamepad input + configuration end to end with him
playing, fix what fails, keep keyboard + mouse unchanged. Task brief = the first message of this session (spawned by
session local_dbcc11fe-310c-4091-b93a-d3725051310e, the batch-2026-11-19 hub). Specs: docs/ROADMAP.md section K
(K1b, K2, K3, K4 + amendments). Natan reads on his phone: short, outcome-first. Progress log (append-only):
docs/briefs/progress-controller-validation.md.

## Git (2026-11-20T07:15Z)
- Worktree: /Users/natanzamanzadeh/floorbound/.claude/worktrees/floorbound-controller-validation-3256da
- Branch claude/floorbound-controller-validation-3256da, HEAD bc6e290, status clean (node_modules symlink, ignored).
- Base 0bb37d8 (integration branch claude/parallel-worktree-tasks-0648c6, K1b-K4). NOT pushed, NOT merged.
- Commits: 94cf640 picture switch; 10a637c WebUSB driver; 96823e2 USB reset; afcc519 key hints follow device;
  a56fa24 README; 2096215 review fixes; 8eab057 wheel cancel on forced let-go + padtest section 5; bc6e290 progress.

## What works (Natan confirmed on his SCUF, Mac, Chrome)
- Wired SCUF via WebUSB (Controls → Connect it, reopens by itself later). Played with it.
- Key hints follow the device (skill bar, world prompts, server text), and the Controls tab follows a switch.

## What changed (all chats)
- public/xboxusb.js (WebUSB GIP driver: start() merges overlapping opens via `starting`, lowest free index, stall cap
  5 then close + reopen once per 10 s, never after a usb 'disconnect'; needed() = Mac only), shared/gip.js.
- public/keyname.js: keyName / keyHtml / tapping (touch device not on a pad) / keyText ({key:action} server tokens);
  unbound pad action -> "<Label> (unbound)". main.js setKeySource(input, isTouch).
- public/input.js: onLabels(fn) on device / pad kind / setGlyphs / setBinding / resetBindings / reload.
- main.js labelBar() relabels skill-bar chips in place (input.onLabels); controlsChanged removed.
- public/controlsui.js: picture switch; tab follows input.onDevice; "Connect it" only when xboxUsb.needed().
- Prompts converted: ground, smith, mastery, talents, teamplay, floor2client, floor3client, rescue, revive, settings,
  combat (guard title), guide.js K fallback; server/mastery, revive, rescue, talents sys texts use {key:...}.
- README controller paragraph + file list. Tests: test/xboxusb.js (new, 4), test/padsmoke.mjs check 9.

## Checks (on 2096215 unless noted)
- xboxusb 4/4, gip 5/5, controls 12/12, gamepad 6, revive 11, rescue 17, padsmoke.mjs 9/9, controlsui.mjs 18/18.
- afcc519: keys.mjs 26/26, padnav.mjs 8/8, focusnav 5, teamplay 14, talents 17.
- Review: code-reviewer Opus high on 0bb37d8..a56fa24: 2 bugs (double open; touch kbm prompts) + 5 minor, all fixed;
  fix re-check (Opus medium): all 7 fixed, 4 minors, also fixed (late close race, guide K fallback, WeakMap, test).

## Next steps
1-3 DONE (Natan 2026-11-20: "All passed, items ok"; wheel cancel + scripted revive/Cover in 8eab057, reviewed).
4. Merge: blocked until the base 0bb37d8 is in origin/main (the hub's K1b-K4 integration), or the hub takes this branch
   into its integration branch. Asked the hub (local_dbcc11fe-310c-4091-b93a-d3725051310e) which. If main: `git fetch &&
   git merge-base --is-ancestor 0bb37d8 origin/main`, `git rebase --rebase-merges origin/main`, rerun tests, merge into
   main, `git push --force-with-lease --force-if-includes origin HEAD:main`.
5. Follow-up: keys.mjs flaky ready(0) timeout in the classic-camera check (keys.mjs:285), fails on 2096215 too.

## Local server for Natan
- PORT=38010 START_LEVEL=10 SPAWN_AT=0,150 (PID 10536, restarted 2026-11-20T00:40Z on 2096215), serves public/ from
  disk (reload picks up edits). Server-side edits (server/*.js sys texts) need a restart:
  `kill <pid>; PORT=38010 START_LEVEL=10 SPAWN_AT=0,150 nohup node server/index.js > <scratchpad>/srv38010.log 2>&1 &`

## Test commands
- `node test/xboxusb.js` `node test/gip.js` `node test/controls.js` `node test/gamepad.js` `node test/revive.js`
  `node test/rescue.js` `node test/teamplay.js` `node test/focusnav.js`
- `PORT=380xx node test/padsmoke.mjs` | `controlsui.mjs` | `keys.mjs` | `padnav.mjs` | `padtest.mjs` (one at a time)

## Not verified
- Prompt changes on a real phone; WebUSB retry path on real hardware; server restart for {key:} texts on 38010.
