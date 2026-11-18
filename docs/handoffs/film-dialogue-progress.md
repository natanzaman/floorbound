# Progress: film dialogue (append-only)

## 2026-11-18T02:03Z Parts A + B built, commit 352fe92 on claude/floorbound-film-dialogue-e55008
- A: public/cine.js #cine-sub (z 55: above bars, under fade), say() on director lines (chat events with hold); subtitleHold/isCueLine in public/bubbles.js; bubbles off when cine.film (decided by screenshot: medium shot pushes the bubble behind the top bar).
- Server: director say sets e.hold and e.voice (ep<N>/<sha1(castId\ntext)[:12]>) only when public/voice/<..>.mp3 exists.
- B: Kokoro-82M (kokoro-onnx 0.6.1, onnxruntime 1.32, Python 3.13 venv in tools/tts, models 325 MB + 28 MB). Ep1: 32 lines in 60 s, 596 KB. Samples: 18 files in ~/Movies/floorbound-ep1/voice-samples.
- Client: Sound.voice(name) in public/audio.js (voices gain, cut previous line, skip when ctx locked, heard[] log).
- Checks: node test/bubbles.js ok; node test/director.js all 43 passed; PORT=3793 node test/cine.js 11 passed; node test/combat.js 19 passed; PORT=3792 node test/filmsubs.mjs 7 ok.
- Next: Opus-high review, fixes, rebase, merge, push.

## 2026-11-17 review, fixes, merge (push blocked)
- Review (code-reviewer, Opus high): 0 serious, 1 bug (slow older voice line could cut a newer one / play late), 5 minor. All fixed in 9af207b (rebased): seq token + 1.2 s staleness + Sound.hush() on reset / fade to black; subtitle bottom-anchored; manifest moved to docs/story/ep1-voices.manifest.json; voices.mjs arg check, tmp-then-copy, try/finally; test cleanup; .mp3 served as audio/mpeg. Regression: filmsubs ok 8. No fix re-check (no serious finding).
- After rebase on origin/main 2f6b351: bubbles ok; director all 43 passed; cine 11 passed; combat 19 passed; filmsubs 8 ok.
- Merge commit 30b8eb5 (--no-ff, fast-forward of origin/main 2f6b351), kept on local branch film-dialogue-merge. Push with --force-with-lease --force-if-includes was rejected by git, a retry with an explicit lease was blocked by the session's permission classifier. NOT pushed. Next: Natan pushes 30b8eb5 to main, or allows the push.

## 2026-11-17 pushed
- Push of 30b8eb5/47ba226 was refused: --force-if-includes checks the local main reflog (stale in the main checkout), then the lease caught a new remote commit (6b4ab5d, film recorder). Rebased on 6b4ab5d, rechecked (bubbles ok; director all 43 passed; cine 11 passed; combat 19 passed; filmsubs all ok), merged in the main checkout: bd41505, pushed 6b4ab5d..bd41505. Lesson: merge and push from the checkout that owns main.

## 2026-11-17 recorded take (done criterion)
- node scripts/film/record.mjs 3811 ~/Movies/floorbound-ep1/take-dialogue-s1 docs/story/ep1-first-line.yaml s1 110: film.mp4 116.6 s, audio track present; 18 subtitles in track.jsonl (s1-s3); audio during first line mean -19.6 dB vs -37.6 dB before it (voice audible). Natan kept the default voices.
- Sheet timing issue (not changed, sheet owner): s1 Pell "Wait! I heard you need a fifth." (31.7 s) is replaced 0.3 s later by Juno "You are level eight." because the face cue between them has no after, so Juno after: prev fires at once. Fix: id on Pell line, Juno after: <id>.
