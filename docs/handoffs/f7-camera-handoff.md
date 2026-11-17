```markdown
# Handoff: F7 camera framing + F8 POV camera, chat 1 (2026-11-17)

## Purpose
Episode 1 ("First Line") is filmed from the film view (`/?spectate=1&film=1`) while the scene director runs bot actors.
Natan asked (this chat's task): read ROADMAP F7 and docs/story/FILMING.md; run Ep 1 on a local server (no DB); record the
film view and a plain spectator view as real video; review; fix camera framing in the gate scene (s2) and the Warden
fight (s3); then add F8, a per-character POV camera. Full picture: docs/ROADMAP.md §F, docs/story/FILMING.md, public/cine.js.
Rule that steers choices: small focused diffs, data-driven, keep guide/README in step (project CLAUDE.md).

## Git state (2026-11-17T23:59Z)
- Worktree: /Users/natanzamanzadeh/floorbound/.claude/worktrees/episode-1-camera-framing-pov-2a66d4
- Branch: claude/episode-1-camera-framing-pov-2a66d4, base ef29a8a (main). WIP commit on top: see progress log.
- Main repo: /Users/natanzamanzadeh/floorbound (main). Project CLAUDE.md says merge straight into main, run tests, push.
- node_modules: installed in the worktree by `npm ci` (not committed).

## Checks run (on the WIP code, 2026-11-17 ~23:58Z)
- `node test/director.js` -> `all 38 passed`
- `PORT=3742 node test/cine.js` -> `# 11 passed`
- NOT yet run: the reworked framing in a real take (take 2), any POV-view take.

## Take 1 (old code, base ef29a8a): findings
Recorded with scripts/film/record.mjs, 60 fps headless Chromium (Metal). Ep 1 ran 208 s, all 4 scenes, no `!` lines.
Videos + contact sheets: /private/tmp/claude-501/-Users-natanzamanzadeh-floorbound--claude-worktrees-episode-1-camera-framing-pov-2a66d4/fa289b5e-0881-4823-ad07-2b58ce5c0696/scratchpad/take1/ (film.webm, spec.webm, sheet-*.png, track.jsonl, director-log.txt)
- Letterbox is fine (in contact sheets the bars blend into the black tile gaps; verified with a single frame).
- s2 gate: G1 `medium` on Bram is blocked by Tamsin's hat / shields of the clustered actors (all marked at raid_gate).
  G2 the second `wide` on raid_gate sat behind a wall/post (dark slabs fill the frame). G3 `follow` Corvin through the gate OK-ish.
- s3 Warden: W1 `follow` Bram: Warden's head cut off, Bram tiny, frame mostly floor telegraphs.
  W2 `close_up` Bram after the sweep: camera INSIDE the Warden (screen solid red ~4 s). W3 Bram's death: close-up stays at
  standing eye height, frames empty air. W4 `follow` Corvin: walls dominate, camera inside the Warden again (~1:04).
  W5 `close_up` Pell for ~30 s of the clutch: back of Pell's helmet, Warden never in frame.
  The Warden looks pale/white while 5 attack it: that is the hit flash (main.js e.flash), gameplay, left alone.
- s1 (not in scope, cheap): the opening `close_up` on hall_of_clearers lasts ~1 s because the next camera cue starts with
  Corvin's `say` (delay 1). Fix idea: Corvin's say `delay: 4`. Also: a retake on the same server shows the engraved
  names in s1 (Hall already cleared); FILMING.md should say restart the server before a full retake.

## What changed (uncommitted before the WIP commit)
- public/cine.js: F8 (`pov` URL param, `eyes=1`, shots `pov`/`eyes`, aimPov, hide model in eyes, RISE when the character is down);
  framing rework in aim(): blockers() line-of-sight (walls via occluders raycast, bodies, camera-inside-body), fits()
  widen-to-fit, bossNear() boss-aware close_up/medium/follow (side-on / behind-shoulder, look between subject and boss),
  fallen subject (S.down: look at 0.3 m, camera higher), pushOut() of big bodies, per-shot state reset in shot().
- public/main.js:69 passes `occluders` to initCine.
- server/cine.js:8 and server/director-sheet.js:62 SHOTS += 'pov','eyes'; director-sheet.js:280 pov/eyes need an actor target.
- server/director.js status() += `cast` (names); public/admin-director.js: "POV views" links row (#d-povs).
- test/cine.js (+F8 assert), test/director.js (+pov/eyes validation cases).
- scripts/film/record.mjs, scripts/film/sheets.sh: the recorder and contact-sheet tools (need Playwright: below).

## Files the next step reads or edits
- public/cine.js (whole file, ~330 lines): SHOTS ~line 15-30, find ~115, aimPov ~136, helpers + aim ~157-290, frame after.
- docs/story/ep1-first-line.yaml: s2 lines ~57-75, s3 ~77-130 (camera cues).
- docs/ROADMAP.md: tracker table ~line 101-110 (add F8 row; update F7 row), add "### F8" section after F7 (~line 180).
- docs/story/FILMING.md (POV views, restart-before-retake note), docs/SCRIPT_BRIEF.md (shot list: add pov, eyes),
  public/guide.js and README.md (mention POV views if they list film shots: grep "over_shoulder").
- scripts/film/record.mjs, scripts/film/sheets.sh

## Decisions (reversible)
- POV view = spectator with `pov=<name>`: rides the character's game camera (behind/above/right shoulder), `eyes=1` first
  person; ignores director shots, obeys light/fade/title/letterbox/clean. Director shots `pov`/`eyes` for the film view.
  Reverse: drop the POV block in cine.js and the two SHOTS entries.
- Framing fixes are in code (general), not per-cue hacks. Optional sheet tweak still open: s2 `medium` on Bram ->
  `over_shoulder target: bram from: pell` if take 2 still looks crowded.

## Subagents/sessions: none started.

## Exact commands
- Playwright lives in the scratchpad: SP=/private/tmp/claude-501/-Users-natanzamanzadeh-floorbound--claude-worktrees-episode-1-camera-framing-pov-2a66d4/fa289b5e-0881-4823-ad07-2b58ce5c0696/scratchpad ; `$SP/pw` has node_modules/playwright 1.65.1 (Chromium installed). If gone: `mkdir -p $SP/pw && cd $SP/pw && npm init -y && npm i playwright && npx playwright install chromium`, then copy scripts/film/record.mjs there.
- Server (fresh each full take): `cd <worktree> && PORT=3712 nohup node server/index.js > $SP/take2/server.log 2>&1 & echo $! > $SP/server.pid`
- Record (run in background, ~4 min): `cd $SP/pw && node record.mjs 3712 $SP/take2 <worktree>/docs/story/ep1-first-line.yaml 0 540 "pov=Pell,pov=Bram&eyes=1" > $SP/take2/rec.out 2>&1`
  (args: port outdir sheet fromScene maxSecs extraViews; extra views become /?spectate=1&film=1&<q>; writes film.webm, spec.webm, <view>.webm, track.jsonl, director-log.txt)
- Contact sheet: `zsh $SP/pw/sheets.sh $SP/take2 film s3 2` -> $SP/take2/sheet-film-s3.png (view it with Read)
- Tests: `node test/director.js` ; `PORT=3742 node test/cine.js` ; smoke `node test/combat.js` ; `node test/feeltext.js`

## Not verified
- The new aim() framing and the POV views have never rendered in a take. Possible pitfalls: blockers() cost per 0.4 s,
  boss two-shot widening too far (dist cap 12 iterations x1.12), over_shoulder flip flicker, `e.def` on player entities (undefined, OK).

## Next chat
Scope: take 2 (fresh server) with film + spec + POV views; review s2/s3 sheets; tune; then docs (ROADMAP F8 section + tracker,
FILMING.md, SCRIPT_BRIEF.md, guide/README), Opus-high code review in fresh context (brief + diff), tests, commit, merge to
main (rebase first), push. Report to Natan directly (no parent session). Read docs/handoffs/f7-camera-progress.md first.
```
