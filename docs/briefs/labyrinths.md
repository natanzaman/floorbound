# Labyrinths: one before each floor's boss (owner request, 2026-11-22)

Full research and per-floor plan: https://claude.ai/artifact/4RoTA6KwcrbLBKJAhtn3hv (Claude Doc, includes the six
changes taken from the Zombaze comparison). This brief covers what is built: **Floor 1's Undercrypt**.

## Owner decisions
- Every floor gets its own labyrinth with its own style, look, traps and events. Not all look like mazes (Floor 1 is a
  true dungeon maze; Floor 2 is planned as a forest that is still labyrinth-like).
- The key is **needed once per character**. One keyholder at the gate opens it for the party; characters who already
  beat the boss count as keyholders.
- From the Zombaze comparison (all six approved): separate seeds for walls / traps / mobs / loot; per-layer braid; loot
  favours dead ends but some sits on the main path; the two levers are an equal walk from the split, and the solo timer
  comes from that real walk; pressure builds the longer you stay in a layer and resets when it empties; one
  noise-hearing enemy per floor plus a throwable lure.

## Shape
Three layers, joined by stairs (teleports): an Approach that teaches the rule, the Depths that test it, and the Heart
with the mini-boss and the key. Layers live in their own patches of Floor 1's coordinate space (x 120..250), so
`floorOf()` still says Floor 1 and walls go through `walkable()` (players, prediction, mobs and bots all collide).

| Layer | Grid | What's there |
|---|---|---|
| The Catacombs | 5×5, braid 0.5 | Spike plates, Crypt Ghouls, chests, wall torches you light, a bell rope landmark |
| The Drowning Galleries | 7×7, braid 0.2 | Flooded cells (slow, loud), Tomb Wardens (hear noise), the breathing event, two bone levers that raise the portcullis |
| The Ossuary | 3×3 hall | The Gravekeeper (Grave Bell tolls: jump or roll the low ring), holds the Horn Key; stair up leaves you before the Chamber Gate |

- **Breathing** (Depths): every 70–110 s (sooner as pressure builds over 5 min in the layer) the torches gutter for 10 s
  and dead rise near each person (cap 9, gone after 45 s). Pressure resets when the layer empties.
- **Noise:** wading, lighting torches and fighting wake Tomb Wardens in range and send them to the sound.
  A **bone rattle** (from chests; you start with one) thrown with interact when nothing else is in reach draws them away.
- **Levers:** both pulled within the window raises the portcullis for 45 s; alone, the window is the walk between them
  at run speed ×1.25 plus 6 s, never under 15 s; with two or more it is 12 s (owner, 2026-11-22).
- **Checkpoint:** dying in the labyrinth brings you back at the last threshold you crossed.
- **Key lock:** `labGateOk` at the Chamber Gate; waived with `SPAWN_AT` or `LAB_GATE=0` (tests), and for bot-only groups.

## Files
`shared/labyrinth.js` (data, maze build, collision, steering, stairs), `server/labyrinth.js` (actions, noise,
breathing, keeper, gate lock, snapshot `lb`), `public/labyrinth.js` (scenery, atmosphere, prompts), plus hooks in
`shared/data.js`, `shared/items.js` (drops), `shared/bots/motor.js` (steering), `server/game.js`, `public/main.js`,
`public/world.js`, `public/guide.js`.

## Checks
`node test/labyrinth.js` (maze connectivity, collision, levers, loot placement, noise, key lock, keeper) and
`python3 test/labyrinth.py` (browser: stair, dark air and torch, walls hold you, a chest, the stairs down, the
Gravekeeper, out again). Test hooks (TEST_HOOKS=1): `{ type: 'test', labkey: f }`, `{ labgo: layer id | 'out' }`.

## Floors 2 and 3 (owner go-ahead, 2026-11-22)
Same engine, with what each floor changes:
- **Shifting ways** (`shift`): closed edges that open on a clock, set 0 or set 1 at a time. Each is a real shortcut, so
  the maze is connected in both phases; never round the portcullis (not touching the end cell). Steering keeps a
  next-hop table per phase (`nextBy`). A way shutting on someone pushes them out of its band (as the portcullis does).
- **Bridges** (`bridge`, Floor 3): an open edge strip is walkable only within `bridge` m of its middle; labSteer lines up
  with a bridge before crossing. **Wind** (`wind`): turns every `every` s; the client drifts you (×0.3 on isles, ×0.35
  guarding). No falling: walkable() keeps you on.
- **Events** (`breathe.kind`): `rise` (Floor 1), `wisps` (true and false wisps; a false one's dead end hides an
  ambush), `squall` (marked lightning strikes).
- **Keepers** (`KEEPERS`): the Mother of Mire (`dive`: under ×0.15 damage, ripples, burst, stranded ×1.5) and the Gale
  Matriarch (`lanes`: lane dive, perch ×1.6, gale pull toward the rim with rim damage). Both call help at half health.
- **Locks:** the Tide Lock (Sunken Gate) and Storm Lock (Storm Gate), `labGateOk` in `updateGate2/3`.
- **Looks:** designed and built by a Fable subagent to an interface (`AIR`, `COLORS`, `buildTerrain`, `buildEntry`,
  `makeMob`) in `public/labthicket.js` and `public/labcauseway.js`, about 20–28 draw calls a layer, no extra lights.
- **Simplified from the plan (guesses):** the sluice puzzle is the two-lever window (not drain one path / flood
  another); Kite Riders don't cut ropes; no falling off bridges; frogs, reed-hiding and drowsy spores left out.
- Checks: `node test/labyrinth.js` (16), `python3 test/labyrinth23.py` (browser, both floors).
