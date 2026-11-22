# Speed batch (2026-11-22): CPU, bandwidth, loading

Owner's ask: fast, efficient, low lag and latency, low compute, while keeping the look. Review behind it:
[engine performance and Rust review](https://claude.ai/artifact/V17inG6C73SBHPNBq1pqoU) (no Rust: the waste was in plain JS).

## What changes
1. **Bots share one decoded world** (`shared/bots/brain.js` decodeWorld). The server already parses the world once a
   tick for its in-process bots; each bot then rebuilt its own mob and player objects (about 15% of server CPU at 30
   bots, plus garbage). Now the decoded arrays are cached per snapshot and shared, read-only.
2. **Bots perceive like players** (`perceivable`, `AWARE` = 120 m): a bot's `b.mobs` holds the mobs on its floor within
   120 m, its floor's boss, and whatever it was told to attack or is fighting. Players stay whole (party, follow,
   revive and rescue need them, and the list is shared, so it costs nothing per bot).
3. **Interest management for browsers** (`Game.viewFor`, `VIEW` = 140 m in, 165 m out): a browser's snapshot holds the
   players and mobs on its floor within range, its party and its duel wherever they are, and its floor's boss. Two radii
   stop entities popping at the edge (`p.inView` remembers who is shown). The fog closes in from 70 m and hides all by
   230 m. A director show sends everything. Spectators and bots on sockets still get the whole world.
4. **Static files** (`server/static.js`): gzip (compressed once, off the game loop, kept in memory), ETag + 304, and
   `max-age` a day for models, sounds and Three.js (`/vendor/`); code and pages revalidate on every load so a deploy
   shows at once. Three.js is served minified. A first visit: about 5.3 MB → 1.9 MB; a repeat visit: 304s only, and
   none at all for models and Three.js within a day. No service worker: the browser's HTTP cache does the job without
   the risk of a stuck old version after a deploy.
5. **Obstacle grid** (`shared/data.js` resolveCollision): obstacles bucketed on an 8 m grid, visited in the old order,
   so results are identical (test/collision.js) and a call is about 16 times faster (client prediction too). The
   labyrinth layers keep their own grid and next-hop tables (`shared/labyrinth.js`, the labyrinth branch).
6. **Smaller things:** `Game.update` no longer copies the scheduled list twice a tick; the Quake Ring resizes its two
   rings in place instead of building new geometry every frame; swing arcs share one wedge geometry per width.

## Not done (and why)
- Binary snapshots: bigger change across server, client and bots; revisit if bandwidth is still a problem after (3).
- WebSocket compression: CPU per player per tick, the free plan's scarcest resource.
- Shared bot perception for targeting (per-floor nearest lists): next if bots still dominate a profile.

## Tests
`node test/worldsleep.js` (viewFor), `node test/collision.js` (grid parity and speed), the bot suites, and
`scripts/perfbench.js` before and after.
