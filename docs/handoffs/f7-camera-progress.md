# Progress: F7 camera framing + F8 POV (append-only)

## 2026-11-17T23:59Z chat 1
- Take 1 recorded and reviewed (findings in the handoff). Framing rework + F8 written, untested in a take.
- Commit a6debd7 on claude/episode-1-camera-framing-pov-2a66d4: WIP (cine.js aim rework, F8 POV, server SHOTS, admin POV links, tests, scripts/film).
- Checks at a6debd7: node test/director.js -> "all 38 passed"; PORT=3742 node test/cine.js -> "# 11 passed".
- Test server on 3711 stopped. State now: nothing running.
- Next: take 2 with POV views (commands in handoff), review s2/s3, tune, docs, review, merge.

## 2026-11-18 chat 2
- Take 2 (port 3712, scratchpad fa289b5e…/take2): 208 s, all scenes, no `!`. s2 medium on Bram now clean (whole party in frame).
  s3 `follow` shots sat 31-50 m out, outside the arena wall. Root cause: aim() widen loop passed V3 to fits(), which uses V3 as scratch
  -> camera pos overwritten, fit never passed, dist always maxed (1.12^12). POV Pell/Bram-eyes worked (rise on death OK); POV sometimes inside the Warden.
- Fixes in public/cine.js: dedicated V5 for the widen loop; wallClamp() spring arm (look->camera ray vs occluders, eased S.d, in 6/s out 1.5/s);
  POV arm shortened while inside a big body (insideBig()).
- Docs: README (shots pov/eyes, framing, POV views), ROADMAP (F7 row, F8 row + section), FILMING (POV views, restart before a full take), SCRIPT_BRIEF shot list.
- ep1 s1: Corvin's first line delay 1->3 and the wide cut `after: prev`, so the stone close-up holds through the line.
- Checks: node test/director.js -> "all 38 passed"; PORT=3742 node test/cine.js -> "# 11 passed".
- Take 3 recording (port 3713, take3/, film + spec + pov=Pell).
- Take 3 (3713): follow 13-15 m from look (was 31-50), inside the arena. Left: boss close-ups showed the subject's back (two-shot angle 1.15 rad from behind),
  and the spring arm could pull the camera onto the subject's back when every in-band angle hit a wall.
- Fix: two-shot angle close_up 1.6 (profile), medium 1.35; angle search over all OFFS with +1.2 penalty outside ±1.1 for a boss two-shot.
- Take 4 (3714, take4/): 223 s, 0 `!` lines; s3 Pell close-ups side-on with the Warden, end medium shows Pell + Bram's body. Accepted.
- Noted for Natan (not camera): a wild Dire Wolf attacks the cast at the raid gate during s2 dialogue (takes 2-4).
