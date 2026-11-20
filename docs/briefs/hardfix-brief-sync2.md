# Brief: controls sync re-check fixes (batch 2026-11-19, hard review input finding 1, round 2)

Worktree: /Users/natanzamanzadeh/floorbound/.claude/worktrees/parallel-worktree-tasks-0648c6/wt/hardfix-input (branch feat/hardfix-input; node_modules symlinked). Do not commit.
Background: commit aafa478 rewrote public/controlsync.js (unsynced flag `fb_controls_unsynced`, retries, pagehide flush). A fix re-check found three issues. Fix them.

Files you may edit: public/controlsync.js, public/main.js (only the lines named below), test/controlsync.js.

1. BUG (account switch): the flag belongs to the browser, not the account. Signed in as A, a rebind whose PUT fails (or Sign out within 800 ms) leaves the flag set; Sign out (main.js ~263) then sign in as B: B's login() sees the flag, skips the GET and PUTs A's bindings onto B. B's saved copy is lost.
   Fix: give createControlSync an `account` option (`() => acct.me?.account?.id`, passed from main.js ~1038; default `() => null`). The flag value is the owning account id (String), or '?' when the id is not known yet (a change made with a stored token before /api/me answered; it belongs to that token's account). unsynced() is true only when the flag is '?' or equals the current account id. At the start of login(): a '?' flag is claimed for the current account; a flag for another account is removed (that account's pending change is lost locally anyway, since this browser now takes B's copy; never upload it to B, and never upload B's copy to A later).
2. MINOR (permanent refusal): a PUT refused with a non-retryable status other than 401 (400, 413) leaves the flag set forever: every later login skips the GET, flush throws, `live` never becomes true, nothing syncs in that browser again. Fix: in login(), when flushing an unsynced change fails with such a status, clear the flag and fall back to the GET (account copy wins as usual). 401 and retryable errors keep the current behaviour.
3. MINOR: the in-game logout (main.js ~351, `kind === 'logout'`) removes fb_session but leaves acct.token set, so the pagehide handler sends a keepalive PUT with a dead token. Set acct.token = null there too, as Sign out does.

Tests (test/controlsync.js, browser block, after ok 9; each must fail on aafa478's controlsync.js, check by temporarily using the old file and say so):
- account switch: create a second account B (same way the test creates the first: read the top of the file) whose server copy has jump = KeyJ. In the page set localStorage fb_controls jump = KeyU and fb_controls_unsynced = String(A's id), fb_session = B's token; reload. Assert B's server copy is still KeyJ, and local + live jump become KeyJ. Also: flag '?' with B's token uploads (local wins) as today.
- permanent refusal: as the current account, set the flag, route PUT to 413 once, reload: the account copy applies, the flag is gone, and a later rebind uploads (live).
Keep the existing 10 checks passing.

Commands (ports 37870-37879 only):
  DATABASE_URL=postgresql://localhost/fb_merge PORT=37871 node test/controlsync.js
  node test/controls.js
  node --check public/controlsync.js public/main.js
Report: files changed, what you did, test output lines copied, which new checks failed on the old code, open questions. Under 50 lines.
