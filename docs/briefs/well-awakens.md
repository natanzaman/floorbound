# The well awakens (owner request, 2026-11-21)

> "The story should update to notice the well is a portal on Floor 1 after the boss is killed for the first time and
> the portal appears. It should also be like 'A bright light emits from the well' and a short camera shot of it
> starting to glow."

Builds on `docs/briefs/waypoint.md` (the town centrepieces are the waypoints).

## In game
- **Rule (data):** `shared/floor2.js` WAYPOINTS: Floor 1's well (the fountain) gets `wakes: 2` (dormant until the
  character has Floor 2 unlocked, the same `floorUnlocked` check as the warp and the bots) and `woke` (its callout
  text). `waypointAwake(w, stats)`, `nearAwakeWaypoint(stats, x, z, pad)`. The camp waypoints have no `wakes`: they
  never sleep (so a test spawn on Floor 2 can always get home).
- **Server:** both warps (`server/floor2.js`, `server/floor3.js`) use `nearAwakeWaypoint(p.stats, …)`: interact at the
  sleeping well does nothing. Unlock message names the well. Bot travel skips a sleeping waypoint (never happens:
  bots that travel have the flags).
- **Client:** `public/wellwake.js` (new). Per viewer: until your inv says Floor 2 is open, no glow, label or prompt at
  the well (`floor2world.js` takes a per-waypoint `lit`/`flare`; `floor2client.js` hides label/prompt/interact).
  When it flips (inv after the first Warden kill, or the floor2 flag), on your screen, 2.5 s later (after the kill's
  slow-mo): dip to black, cut to the well, slow push-in while its glow fades up from nothing with a burst and a light
  column, callout **THE WELL AWAKENS / A bright light emits from the well.**, dip, back to you (3.8 s). Then the
  one-time `waypoint` guide tip.
  - Skip: any fresh key, click, tap or pad button (that press does nothing else). Movement and attacks pause during it.
  - Busy (dead, downed, rooted, falling, Game Menu, the MVP card, typing in chat, hit or hurt in the last 4 s, a live
    boss within 40 m): **queued** until free, up to 90 s and only
    while still on Floor 1; otherwise dropped and the glow simply fades in. Anything coming up mid-shot ends it.
  - The MVP card (5 s after a kill) is held while the shot plays and shows right after it. The waypoint tip comes once
    you're free and no other tip is up (a shot cut short by going down: once you're up). The well also wakes for a
    character with a higher floor open (dev/admin flags). Function keys and Ctrl/Cmd/Alt shortcuts don't skip.
  - Reduce motion: still frame of the well (dip cuts, no push-in, no light column).
  - Joining with Floor 2 already open: no shot. Spectators: waypoints lit. Film view: sleeps until the director's
    `wake` cue (new cine op + director verb), cleared by `reset`.

## Story
- STORY.md (rules + places + Ep 1 beat), ep1 screenplay (cutaway to the well after the Last Attack; "walk to the
  well"), `ep1-first-line.yaml` (`well` landmark, `wake` cue, title card, short wide shot), ep2/ep3 waystone lines,
  SCRIPT_BRIEF (`well`, `wake`).

## Checks
`test/wellwake.js` (rule, warp before/after, flag, film cue, ep1 validates), floor3, director, cine, combat, botbrain,
playerbots; Playwright `test/wellwake.py`: no prompt/glow before, TEST_HOOKS clear 1 → shot runs, text shows, skip
returns control, interact opens the waypoint; Reduce motion variant.
