# Progress: controller validation
- 2026-11-19 chat 1: SCUF Xbox One wired on Mac invisible to Chrome (no macOS driver for vendor 2e95). Added
  Xbox/PlayStation picture switch (94cf640), WebUSB GIP driver (10a637c), USB reset on open (96823e2; libusb probe
  showed the pad only answers power-on after a reset). gip 5/5, controlsui 18/18. Waiting on Natan to retest in Chrome.
- 2026-11-19 chat 1 end: Natan confirmed the wired SCUF WORKS in Chrome after 96823e2 (light solid, buttons light up).
  Next: handoff "Next steps" 2 onward (checklist, open items, guide line, tests, review, merge). State: HEAD 7ea7369+this.
