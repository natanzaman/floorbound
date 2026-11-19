# Floorbound: what's next (handoff, 2026-11-19)

Start here, then use `docs/ROADMAP.md` for full specs and owner decisions. Everything in sections A–J is merged and live, except J3 and F7.

## Ready to run now (in parallel, each in its own worktree)
| Task | Spec | Notes |
|---|---|---|
| **K1b** Gamepad + menu focus navigation | ROADMAP K: "Review amendments for K", "K contract" and "K1a as landed" | `readPads()` in `public/input.js` is a stub; fill it and poll it from `tick()`. Use `panels.top()` for focus. |
| **K2** Controls screen (keyboard and controller pictures, binding list, rebind) | ROADMAP K2 + amendments | Use `check()`, `assign(…,'swap'\|'unbind')` and `capture()` from `shared/controls.js` / `public/input.js`. Register the panel with `panels.register`. Account sync: an `accounts.settings` JSONB column holding all of `fb_controls`. |
| **K3** Accessibility options | ROADMAP K3 + amendments | Put them in `fb_controls.access`. Reduce-motion gates `shake()` / `slowMotion()` but not `cine.js`. The colour-blind palette is cleared to start now that J has merged. |
| **K4** Scripted controller "bots" (Playwright fake gamepad) | ROADMAP K4 + amendments | Start once K1b lands. `__fb.input.frames` counts frames, so presses can be held for a set number of them. Copy the pointer-lock stub and helpers from `test/keys.mjs`. |
| **J3** Boss timing tables + melee openings + tuning harness | ROADMAP J3 + "Review amendments for J" | J1 and J2 have merged, so it can start. Also handle: Colossus fights now run long (~130–170 s, the top of the target), and bots never dodge Gale Push (6-bot parties died to it under the Tailwind twist). |

After K1b–K4 and J3, run a **Fable review of the code** (the owner asked for this on every big feature: review the plan → build → review the code).

## Small items
- HUD corner readout: show **"62 fps · 45 ms"**, not just ping. It already toggles in Settings; F3 is the full overlay.
- `test/threat.js` is flaky (a random-damage race on "tank lost it most of the time"). Loosen the bound or average over more runs.
- Replace hard-coded key names with `input.label(action)` in the skill bar, the revive prompt, the wheel hint and the controls text (part of K2).

## Still open from earlier
- **F7** film work (Episode 1 tuning, Episode 2/3 cue sheets). Paused by the owner.
- Skipped for now: achievements, the weekly board and cosmetics.

## Running locally on the Mac (`~/floorbound`)
- `npm install`, then `npm start` (anonymous mode, no DB) and open http://localhost:3000.
- **DB tests:**
  1. `brew install postgresql@17 && brew services start postgresql@17`
  2. `createdb fb_x`
  3. set `DATABASE_URL=postgresql://localhost/fb_x`

  Production is Neon: never point tests at it.
- **Browser tests:** Python Playwright (`pip install playwright && playwright install chromium`). The Node Playwright version for `.mjs` tests is `npm i --no-save playwright`.
- **Avoid these test ports:** 6665–6669 and 6679, which Node's fetch refuses.
- **Pushing:** use `git push --force-with-lease origin main`, which auto-deploys to Render (a free plan that the owner wants to stay on).
