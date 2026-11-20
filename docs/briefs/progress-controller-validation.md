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
