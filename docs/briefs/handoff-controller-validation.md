```markdown
# Handoff: controller validation chat 1, 2026-11-19

## Purpose
Natan wants to play Floorbound with a real controller. Validate gamepad input + configuration end to end with him
playing (checklist below), fix what fails, keep keyboard + mouse unchanged. Task brief = the first message of this
session (spawned by session local_dbcc11fe-310c-4091-b93a-d3725051310e, the batch-2026-11-19 hub). Specs: docs/ROADMAP.md
section K (K1b, K2, K3, K4 + amendments); docs/briefs/progress-batch-2026-11-19.md (last entries). Natan reads on his phone:
short, outcome-first.

## Git (2026-11-19T23:54Z)
- Worktree: /Users/natanzamanzadeh/floorbound/.claude/worktrees/floorbound-controller-validation-3256da
- Branch claude/floorbound-controller-validation-3256da, HEAD 96823e2, status clean (node_modules is a symlink to
  ../parallel-worktree-tasks-0648c6/node_modules, untracked/ignored).
- Base 0bb37d8 (integration branch claude/parallel-worktree-tasks-0648c6, K1b-K4 merged). NOT pushed, NOT merged.
- My commits: 94cf640 (Xbox/PlayStation picture switch), 10a637c (WebUSB wired Xbox driver), 96823e2 (USB reset on open).

## What changed
- public/controlsui.js: Controller tab has an Xbox | PlayStation switch (.cu-style, data-glyph xbox|sony|auto) that
  sets input.setGlyphs(); auto = detected family (input.pad.family). PAD_KEYS_SONY layout + touchpad; padStyle,
  padTitle; all pad labels in list/prompt/tooltip/messages via padLabel(b, input.glyphs) (lab()). Header shows
  "Wired Xbox controller with a blinking light (a Mac)? Connect it" (data-a=usb) when no pad and navigator.usb.
- public/input.js: get glyphPick ('auto'|family); readPads() also lists xboxusb pads().
- public/style.css: .cu-style, .cu-usb, .cu-touch.
- shared/gip.js (new): GIP parser (xpad layout), powerOn, ackFor, blankPad. test/gip.js (new, 5 checks).
- public/xboxusb.js (new): WebUSB driver. Opens GIP interface (ff/47/d0), claims, USB reset once per pad per 10 s,
  reclaims, read loop (transferIn), wakes on announce 0x02 (fallback after 1 s), acks, parseGip. getDevices() on load
  and usb 'connect' reopen allowed pads. window.__xboxusb.log = debug log.
- test/controlsui.mjs: new check 17 (Xbox/PlayStation switch). Now 18 checks.

## Findings (SCUF Xbox One wired, Natan's Mac, macOS 15.7.3, Chrome)
- USB data works: system_profiler shows "Controller", vendor 0x2e95 product 0x0504, maker "Microsoft". macOS/Chrome
  have no driver for non-Microsoft GIP pads -> never in getGamepads(), light blinks.
- Interfaces: itf0 alt0/alt1 ff/47/d0 EP out 0x02 / in 0x82 (interrupt, 64); itf1 audio iso; itf2 bulk.
- With libusb (node `usb`, scratchpad/usbdbg/probe3.mjs): power-on alone -> NO packets. After dev.reset(): pad sends
  announce `02 20 09 1c ... 95 2e 04 05 ...`, power-on `05 20 00 01 00` -> input packets `20 00 01 2c ...` + status
  `03 20 .. 04 83 01 00 00`. So the reset is the fix; Chrome version (96823e2) NOT yet verified by Natan.
- Natan also has an Xbox Elite Series 2 paired by Bluetooth (needs batteries; he has none now).
- Chrome holds the pad while a game tab has it open: libusb claim -> LIBUSB_ERROR_ACCESS. Close the tab to probe.

## Checks (on 96823e2 / 94cf640)
- `node test/gip.js` -> "gip: all 5 checks passed" (96823e2)
- `PORT=38020 node test/controlsui.mjs` -> "controlsui: all 18 checks passed" (10a637c)
- Not yet run after my changes: test/padnav.mjs, padsmoke.mjs, padtest.mjs, keys.mjs, gamepad.js, focusnav.js, controls.js.

## Local server for Natan
- PORT=38010 START_LEVEL=10 SPAWN_AT=0,150, PID 98750, log scratchpad/srv38010.log; serves public/ from disk
  (reload picks up edits, no restart). URL http://localhost:38010. Ports 38000-38099 only.

## Next steps
1. Natan: reload in Chrome, Controls -> Connect it (or it reopens by itself) -> light solid? buttons light up?
   If not: read window.__xboxusb.log (ask him to paste it from DevTools console, or Claude in Chrome if connected).
2. Checklist with Natan, record pass/fail: detection+prompt; picture/glyphs; dead zones/drift; padSens; triggers;
   move/camera/lock-on R3/attack RT hold/skills/dodge/jump/guard LT/items/interact+revive; LB chords (Team Burst,
   Cover, bot wheel, select target, Skill Tree, Players); menu focus nav in Game Menu, Settings, Bag, Skill Tree,
   Players, Controls (incl. conflict prompt); rebind on Controller tab persists across reload + account sync;
   unplug/replug; switching kbm <-> pad mid-play. Optional F3 pad readout.
3. Open items to settle with Natan (recommend, then act): controller picture mouse-only (list is pad-reachable);
   pad play buttons swallowed while a navigable window is open (except Start); bot wheel open on blur sends the
   pointed order; revive hold on pad + Cover on non-Guardian unverified in play.
4. Add guide line (public/guide.js + README): wired third-party Xbox pads on a Mac need Chrome/Edge + Controls ->
   Connect it; Windows works natively.
5. Fix failures with fake-pad regression tests; run all pad + keys tests (browser ones one at a time).
6. code-reviewer (Opus, medium) on `git diff 0bb37d8..HEAD`; xboxusb.js is device I/O: look for reset loops.
7. Merge: wait until `git fetch && git merge-base --is-ancestor 0bb37d8 origin/main`; then
   `git rebase --rebase-merges origin/main`, rerun tests, merge into main,
   `git push --force-with-lease --force-if-includes origin HEAD:main`. Note validation in ROADMAP K.
8. Report once to local_dbcc11fe-310c-4091-b93a-d3725051310e (SendMessage, 3-5 lines + this handoff path).

## Not verified
- WebUSB reset path in Chrome on the real SCUF (reset may re-enumerate; guarded by the 10 s key).
- Anything on a real pad in play.
```
