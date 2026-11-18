# Brief: film dialogue — subtitles + free character voices (2026-11-18)

## Purpose
Season 1 episodes are filmed from the film view (`/?spectate=1&film=1`) while the scene director (server/director.js) plays a
cue sheet (docs/story/ep1-first-line.yaml) with bot actors. Natan watched take 4: speech bubbles are hard to read, especially
when the camera zooms in, and they vanish too fast. He also wants voice-overs. Read docs/ROADMAP.md (§F), docs/story/FILMING.md,
docs/SCRIPT_BRIEF.md (cue format, `say` verb), public/cine.js (film view), and the bubble code (F1: grep "bubble" in public/).

## Natan's decisions (2026-11-18, quoted)
- Subtitles: "1. good" to: in the film view, show each spoken line as a subtitle at the bottom (in the letterbox bar), held for
  reading time (~3 s + a bit per word). Players keep normal bubbles.
- Voices: "3. ok pls do it if possible" to: pre-generate one audio file per line (a distinct voice per character, a deep one
  for the Warden); the film view plays it when the line is said, so recordings and live viewers hear it.
- "4. no paid for now i guess then. maybe we can look into a free good nlp ai voice generator if possible please"

## Part A: subtitles (do first)
- Film view only (FILM in cine.js, incl. POV views): bottom-centred caption "Name: line", readable font with shadow, inside the
  lower letterbox bar when it's on, above the bottom edge when off. Hold = max(cue `hold`, 2.5 s + 0.06 s per character); a new
  line replaces the old one; respect fade-to-black (hide under it). Hide in-world bubbles in the film view? Decide by looking: keep
  them if they don't clutter. Plain players unchanged.
- Test: extend test/cine.js or a Playwright check (CLAUDE.md browser method) that a `say` produces a caption with the text.

## Part B: free voices
- No paid services (no ElevenLabs credits unless Natan types `yes paid $<cap>`). Evaluate free/local TTS on this Mac (Apple
  silicon): Kokoro-82M (Apache-2.0, kokoro-onnx or the `kokoro` pip package) first; Piper as fallback; macOS `say` only as last
  resort. Check licences allow use in a public video. Install into a venv in the scratchpad or `tools/tts/` (gitignored), not globally.
- Script `scripts/film/voices.mjs|py`: reads a cue sheet, generates one file per `say` line to `public/voice/<episode>/<hash>.mp3`
  (opus/mp3, small), voice per cast id from a map in the sheet or a side file (`docs/story/ep1-voices.yaml`), skips unchanged lines.
- Client: film view (and plain spectators) play the line's file when the `say` event arrives (server may send a `voice` key, or the
  client hashes speaker+text). Uses the existing audio context (public/audio.js) and volume; no voices for players.
- Let Natan pick voices: render a short sample per character into ~/Movies/floorbound-ep1/voice-samples/ and list them in the report.

## Done when
Subtitles and voices work in a recorded s1 take (Natan's recorder: scripts/film/record.mjs — no audio in Playwright video; check
voices by state/logs and by playing the files), tests pass (`node test/director.js`, `PORT=37xx node test/cine.js`, smoke
`node test/combat.js`), README + docs/story/FILMING.md + docs/SCRIPT_BRIEF.md updated, Opus-high review (code-reviewer, fresh
context, brief + diff), fixes, merge straight into main (rebase first), push (`git -c credential.helper= -c
'credential.helper=!gh auth git-credential' push origin main`). Don't touch scripts/film/record.mjs (another session owns it)
or combat/ability timing files (another session).
