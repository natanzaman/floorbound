# Progress: controller validation
- 2026-11-19 chat 1: SCUF Xbox One wired on Mac invisible to Chrome (no macOS driver for vendor 2e95). Added
  Xbox/PlayStation picture switch (94cf640), WebUSB GIP driver (10a637c), USB reset on open (96823e2; libusb probe
  showed the pad only answers power-on after a reset). gip 5/5, controlsui 18/18. Waiting on Natan to retest in Chrome.
- 2026-11-19 chat 1 end: Natan confirmed the wired SCUF WORKS in Chrome after 96823e2 (light solid, buttons light up).
  Next: handoff "Next steps" 2 onward (checklist, open items, guide line, tests, review, merge). State: HEAD 7ea7369+this.
- 2026-11-19 chat 2: Natan played with the SCUF. Fixed his two reports in afcc519: (1) key hints now follow the device
  (public/keyname.js read at draw time; skill bar relabels via new input.onLabels on device / pad kind / picture /
  binding change; ~15 hardcoded F/E/K/T/V/Shift/Space prompts and 4 server sys texts ({key:action} tokens));
  (2) the open Controls screen's tab follows a device switch. Checks on afcc519: padsmoke 9/9 (new check 9), controlsui
  18/18, keys 26/26, padnav 8/8, controls 12, gamepad 6, gip 5, revive 11, talents 17, rescue 17, teamplay 14,
  focusnav 5. Next: handoff steps 2-8 (rest of checklist with Natan, open items, guide line, review, merge).
- 2026-11-20T00:40Z chat 2: README a56fa24. Review (Opus high, 0bb37d8..a56fa24): 2 bugs (wired pad opened twice -> stuck buttons;
  touch device on kbm after a pad named keys) + 5 minor; fixed in 2096215 with test/xboxusb.js (4 checks; fails on the old
  driver: "one read loop", actual 2). Fix re-check (Opus medium): all fixed, 4 minors also fixed in 2096215. Checks on 2096215:
  - xboxusb 4/4, gip 5/5, controls 12/12, gamepad 6, revive 11, rescue 17, padsmoke.mjs 9/9, controlsui.mjs 18/18. Local server restarted (PID 10536). Sent Natan the play checklist + 4 open items; waiting on his reply.
  State: clearing to handoff (context 248k). Next: handoff Next steps 1-5.
- 2026-11-20 chat 3: Natan: "All passed, items ok" (whole play checklist + the 4 open items). Commit 8eab057: forced let-go
  (blur, device switch, pad gone, input.reload) cancels a held bot wheel; under Controller a key no longer lets go of a pad
  hold; padtest section 5 (pad Cover on a bot: server cover event; pad revive of a downed bot: server revived event; TEST_HOOKS
  down hook takes a partymate id); focus-lost/reload checks in keys.mjs + padtest s3 (fail on old code); ROADMAP K validation
  note; README. Review Opus high: 0 serious, 3 minor, all fixed in 8eab057 (section 5 ran 3x green by the reviewer).
  Checks: padtest full 40/40 (s1-5, before the 3 minor fixes), padtest s3 6/6 after; padsmoke 9/9, controlsui 18/18,
  padnav 8/8, access 13/13; xboxusb 4, gip 5, controls 12, gamepad 6, revive 11, rescue 17, teamplay 14, focusnav 5,
  talents 17. keys.mjs 26/26 in 3 of 6 runs: the misses time out at ready(0) in the classic-camera check (keys.mjs:285),
  and unchanged HEAD 2096215 fails there 3/3 too: an existing flaky wait, not this change (follow-up).
  Merge: base 0bb37d8 still NOT in origin/main (checked 2026-11-20); waiting for the K1b-K4 integration to land.
