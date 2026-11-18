# Progress: film recorder 60 fps (append-only)

## 2026-11-18T01:40Z chat 1 (camera chat)
- Handoff written. Nothing started. Measurements in the handoff.

## 2026-11-18 chat 2 (recorder chat)
- No screen capture / loopback needed. Chose option 2 (CDP Page.startScreencast, re-timed to 60 fps by ffmpeg) + in-page WebAudio tap (MediaRecorder on a MediaStreamDestination, muxed with itsoffset). Game audio is all WebAudio (public/audio.js), so the tap catches it; speechSynthesis could not be tapped.
- Chromium flags added: --autoplay-policy=no-user-gesture-required, --disable-gpu-vsync, --disable-frame-rate-limit. A mouse click after join unlocks game audio.
- Test take1 (film only, s3, 40 s): screencast source 98 fps, output 60/1 H.264+AAC, 600/600 unique frames per 10 s (ffmpeg framemd5), mean audio -20.5 dB.
- sheets.sh now reads timing.json (video is film.mp4, no more wall-secs math).
- take2 (film + pov=Pell at once): source fell to ~33 fps per view (two pages share the renderer). So: one view per run for 60 fps; extra views only for rough review.
- take3 (film only, full s3, 156 s): source 96.6 fps, mp4 60/1, unique frames per 10 s: 600/600 @10 s, 600 @60 s, 597 @120 s; audio mean -19.3 dB. Copy: ~/Movies/floorbound-ep1/ep1-take6-scene3-film-60fps.mp4.
- Not verified: lip-level A/V sync (audio aligned by wall-clock only, offset ~0.1 s); speechSynthesis voices if the voice session uses them.
- Run from a dir with playwright installed (scripts/film has no package.json): copy record.mjs next to a playwright install.
