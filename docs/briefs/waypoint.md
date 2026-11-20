# Waypoint: the town centrepiece is the warp (owner request, 2026-11-20)

Remove the separate waystone crystals. Each floor's town centrepiece becomes its **waypoint**: walk up, press interact,
the existing floor picker opens (same unlock rules).

| Floor | Centrepiece | Collision r | Use distance |
|---|---|---|---|
| 1 Town of Beginnings | fountain (0, 0) | 3 | 4.4 (stops short of the Merchant's reach at 9, 3) |
| 2 Mirelight Camp | campfire (600, 0) | 1.3 | 3.2 |
| 3 Windbreak Camp | brazier (1200, 0) | 1.2 | 3.2 |

## Plan
- **Data** (`shared/floor2.js`, `shared/floor3.js`): `WAYPOINTS` (floor, x, z, r, use, kind, name) replaces `WAYSTONES`;
  `nearWaypoint(x, z, pad)` uses each waypoint's own `use`. Old names (`WAYSTONES`, `WAYSTONE3`, `nearWaystone`) stay
  as aliases. The waystone obstacles go (the fountain, campfire and brazier are already obstacles; removing them moves
  no other obstacle: the seeded scatter never reached z < 26).
- **Server** (`server/floor2.js`, `server/floor3.js`): warp checks `nearWaypoint` with a 0.5 m pad for lag; track
  `via: 'waypoint'`; unlock messages name the waypoint.
- **Client**: the crystal models go; `floor2world.js` adds a soft additive glow ring on the ground round each
  centrepiece (no extra lights), brighter when you're in reach, gently pulsing unless Reduce motion is on.
  `floor2client.js`: label "Waypoint" over each, and when close "Press <key> to open the waypoint" (keyHtml), or
  "tap Warp" on touch. Panel title WAYPOINT. A one-time guide tip the first time you stand at one with Floor 2 open.
- **Bots** (`shared/bots/brain.js`): walk to the near side of the centrepiece (r + 0.8: just outside its collision ring, inside
  its use distance), then warp.
- **Director**: `waypoint` landmark (= the fountain spot); `waystone` stays as an alias so Episode 1's sheet still runs.
- **Docs/README/tests**: wording; `test/floor3.js` uses the new names. Story text (docs/story) is left for the owner.

## Checks
`node test/floor3.js`, director/botbrain/playerbots tests, a bot party walking town -> waypoint -> Floor 2 / Floor 3,
and a Playwright check at the fountain and Floor 2's campfire (interactKind 'warp', prompt text, panel opens).
