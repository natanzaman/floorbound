```markdown
# Handoff: film recorder at 60 fps (scripts/film), chat 1 → 2, 2026-11-18

## Purpose
scripts/film/record.mjs records Episode 1 takes headless so the camera framing can be reviewed as real video (F7/F8,
docs/ROADMAP.md). Natan watched take 4 and found it "very laggy". Goal: test recordings that play smoothly at 60 fps
(or at least a steady frame rate with no stutter) and carry the game's audio (Natan 2026-11-18: "also theres no audio?"; a
parallel session adds character voices, so audio matters). Playwright video has no audio: option 4 (screen capture) or a WebAudio tap. Dev tool only; the real episode is recorded with OBS (docs/story/FILMING.md).
Rule: small focused diffs; don't touch game code unless the measurement shows the game itself stutters.

## Git state (2026-11-18 ~01:40Z)
- Main repo /Users/natanzamanzadeh/floorbound, branch main at a16a83a (= origin/main), clean. Camera work merged (a855ca2).
- Old worktree /Users/natanzamanzadeh/floorbound/.claude/worktrees/episode-1-camera-framing-pov-2a66d4, branch
  claude/episode-1-camera-framing-pov-2a66d4 (merged; this handoff commit on top). Start new work on a fresh branch from main,
  e.g. `git switch -c claude/film-recorder-60fps origin/main` in this worktree (node_modules is installed here).
- Push needs the gh helper: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main`.

## What we measured (take 4, 2026-11-17)
- Game render rate in the film page before Run: `film fps 60.5` (rAF count, record.mjs line 24).
- Video: Playwright `recordVideo` writes 1280x720 at a fixed 25 fps (ffprobe r_frame_rate 25/1, 5759 frames).
- Distinct frames/s (ffmpeg mpdecimate over 10 s): 19.2 at 20 s, 25.0 at 100 s, 25.0 at 170 s. Four pages rendered at once
  (film, spec, pov=Pell + director) in one headless Chromium.
- Not yet known: whether actors themselves move jerkily (20 Hz snapshots + client interpolation). Asked Natan; no answer yet.

## Files
- scripts/film/record.mjs (54 lines): args `<port> <outdir> <sheet.yaml> [fromScene] [maxSecs] [extraViews]`; opens pages
  film (`/?spectate=1&film=1`), spec, extra views; loads + runs the sheet via the admin director API; writes <view>.webm,
  track.jsonl (camera/shot state every 0.25 s), director-log.txt; prints `wall secs`.
- scripts/film/sheets.sh: contact sheets per scene (maps wall time to video time with `dur - wall`).
- Working copy with Playwright 1.65.1 + Chromium: SP=/private/tmp/claude-501/-Users-natanzamanzadeh-floorbound--claude-worktrees-episode-1-camera-framing-pov-2a66d4/fa289b5e-0881-4823-ad07-2b58ce5c0696/scratchpad/pw
  (may be wiped: `mkdir -p $SP/pw && cd $SP/pw && npm init -y && npm i playwright && npx playwright install chromium`, copy the scripts in).
- Natan's copies: ~/Movies/floorbound-ep1/ (ep1-take4-film.mp4, ep1-take4-pov-pell.mp4, ep1-take5-scene3-film.webm).

## Options to evaluate (pick by measurement, not by guess)
1. One view per run (no parallel pages) - removes the dips, still capped at 25 fps.
2. CDP `Page.startScreencast` with frame timestamps, encode with ffmpeg at the real timing (or resample to 60): still bound by
   headless compositor speed.
3. In-page `canvas.captureStream(60)` + MediaRecorder: smooth WebGL, but misses DOM overlays (titles, letterbox bars, bubbles,
   nameplates, fade). Would need overlays drawn another way: probably a no.
4. Headed Chromium window + ffmpeg avfoundation screen/window capture at 60 fps: closest to OBS; needs macOS Screen Recording
   permission for the terminal (Natan grants it; never toggle system settings yourself).
5. Deterministic: virtual time / fixed-step frames (game clock vs 20 Hz server makes this hard): last resort.

## Exact commands
- Server: `cd <worktree> && PORT=3716 nohup node server/index.js > $SP/takeN/server.log 2>&1 & echo $! > $SP/server.pid` (fresh per full take; kill by PID).
- Record: `cd $SP/pw && node record.mjs 3716 $SP/takeN <worktree>/docs/story/ep1-first-line.yaml 2 300 ""` (scene index 2 = s3 only, ~2.5 min).
- Smoothness check: `ffmpeg -ss 20 -t 10 -i <video> -vf 'mpdecimate,showinfo' -f null - 2>&1 | grep -c "Parsed_showinfo.*pts_time"` (÷10 = distinct fps).

## Next chat
Scope: measure, pick an option, update scripts/film/record.mjs (+ sheets.sh if timing changes), record an s3 take, give Natan an
MP4 in ~/Movies/floorbound-ep1/ with the measured distinct fps. Commit on a new branch, merge to main (no PR), push.
Progress log: docs/handoffs/film-recorder-progress.md (append-only). Report to Natan directly (no parent session).
```
