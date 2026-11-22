# Your bar over your head, and clearer hits (2026-11-22)

Owner's ask: "put a little health / stam(mana) bar above the user's character. Also make it a bit more noticeable when
a user gets/takes damage."

- **The bar** (`public/selfbar.js`): a small health bar above your own character (others already had one). Green,
  then amber under 60%, red under 30%. A pale "just lost" chunk drains after a hit. A thin blue line under it is
  stamina: Floorbound has no mana, so the line shows the dodge charge. It empties when you dodge and fills back up as
  the dodge recharges.
- **Getting hit:** the screen edges pulse red (stronger for a bigger share of your health, and for big hits), the bar
  shakes, your character flashes red, and a big hit (a "big" hit or 12%+ of your health) shows a larger red number.
  Under 30% health the edges keep a slow red pulse. Camera shake and hit-stop are unchanged (still off with Reduce motion).
- **Settings → Accessibility:** "Hide the bar over your character" and "No red damage flash".
- Client only; no server change.
- Test: `node test/selfbar.mjs` (desktop and phone; `SHOTS=<dir>` saves screenshots).
- Open: whether a real stamina or mana resource should exist (a design question for the classes/levels work).
