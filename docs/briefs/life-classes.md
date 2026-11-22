# Life classes (branch `feat/life`)

Owner goal (approved): a second track beside the combat class, so a player who would rather farm still helps the raid.
Herbs, ore, fish and crops become meals (fight buffs), potions and Smith gear. Graphics are on hold: simple shapes only.

## Design
- **Life skills**, levels 1-10, earned by doing them: Herbalist, Miner, Fisher, Farmer (gathering), Cook, Alchemist
  (making) and Smith (levels from every Smith action: refine, salvage, reforge, craft, affix reroll; known from the start).
  The others are learned, free, at the **Life Hall** in the Town of Beginnings (a small booth just east of the plaza, toward the south, kept
  separate so it can move under the Academy later). No limit on how many you learn.
- **Gathering spots** placed by data (`SPOTS` in `shared/life.js`): herb patches, ore veins and fishing pools in the
  fields of Floors 1-3 (11-14 per floor), plus six rare ones in the labyrinths (glowing ring). Each spot type has a
  skill level gate, XP and a yield table; every BONUS_EVERY (3) levels above the gate adds one to the main yield.
  - Herb / ore: interact, stand still 2.5 / 3.5 s. Walking off (1.2 m) or being hit stops it.
  - Fishing: interact, the bite comes after 2-5 s ("A BITE!"), strike (interact) within 1.2 s (+0.35 s for the round
    trip). Too soon or too late: the fish gets away and the pool is not used up.
  - **Depletion is per player** (decision): a spot you emptied refills for you after 2.5-4 min; nobody else's gathering
    (players, bots, the Named) touches yours, so nobody can take your spot. Timers are wall-clock ms, saved.
- **Garden**: each character has their own 6-tile plot in the town garden (west of the plaza). Instanced per character:
  everyone sees their own crops on the same tiles. Plant seeds (the merchant sells three kinds; herb patches drop some;
  Moonroot seeds only from Floor 3 and labyrinth herbs), crops grow in real wall-clock time (20 min to 6 h) and keep
  growing while you're offline and across restarts. Harvest when ripe (a seed back sometimes); Clear an unwanted crop.
  - **Tending**: while at least one of your own bots is within 14 m of the garden (ordered `/b tend`, the Players →
    Bots behaviour "Tend my garden", or just idling there), your crops grow 1.25x as fast (doesn't stack). Online only.
- **Cooking** at the cooking fire, **alchemy** at the alchemy bench (both in town). Recipes are data. Meals are fight
  buffs, one at a time (eating replaces): regen (% max health a second, also in fights), +posture damage, +damage,
  +max health; 15-20 min, counted only while online. Alchemy makes the existing consumables (Health Potion, Battle
  Tonic, Ironbark Draught): no duplicate potion types. 3+ levels above a recipe: a quarter of batches come out double.
- **Smith**: two new Smith recipes take ore (Ore-Forged Mail: iron + copper; Stormite weapon: stormite + silver).
- **Materials** are plain ids in `inv.mats` (merged into `MATS`, `shared/crafting.js`), so a later town-project
  system (Phase 5 "floor towns") can ask for them by id. A life material stack stops at 99 (`STACK_MAX`).

## Data (`shared/life.js`)
`LIFE_SKILLS`, `LIFE_XP` (total XP per level: 0, 0, 60, 160, 320, 540, 840, 1240, 1760, 2420, 3250), `XP_SMITH`,
`LIFE_MATS` (cat: herb, ore, fish, crop, seed, food), `FOODS`, `SPOT_KINDS`, `SPOT_TYPES`, `SPOTS`, the stations
(`LIFE_HALL`, `COOK_FIRE`, `ALCH_BENCH`, `GARDEN`), `CROPS`, `TEND`, `LIFE_RECIPES`, `newLife(saved)` (sanitises a record).
Seeds in `SHOP` (`shared/items.js`, kind `mat`).

## Wire
- Client → server `{ type: 'life', a }`: `learn {id}`, `gather {id}`, `hook`, `cancel`, `plant {tile, seed}`,
  `harvest {tile?}`, `uproot {tile}`, `make {id}`, `eat {id}`. All checked on the server (station / spot reach + 1.5 m,
  skill learned and level, materials, stack room); messages closer than 0.12 s are dropped (a strike always gets through).
- Server → client `{ type: 'life', skills, learned, spots: {id: secs left}, plot: [{c, g (0..1), left (s)} | null],
  food: {id, left (s)} | null, act: {k, id, secs, left, bite} | null, tend }` on join and whenever it changes.
- Events: `lifebite` (to: you), `lifelvl` (to, sk, lvl), `lifegot`, `lifemade`. Results come as system lines.
- Bots: `botcmd` cmd `tend` carries the garden's x, z; the brain holds there (`stay` with fixed coordinates).
- Test hook (TEST_HOOKS): `{ type: 'test', life: { skip: ms, tp: [x, z] } }` moves the life clock / teleports.

## DB
`ALTER TABLE characters ADD COLUMN IF NOT EXISTS life JSONB` (`server/db.js`, safe twice):
`{ skills: {id: xp}, learned: [ids], plot: [tile | null] x6, food: {id, left ms} | null, spots: {spotId: readyAt ms} }`.
Saved with the character (`server/accounts.js`); anonymous players keep it in memory only.

## Files
`shared/life.js` (data), `server/life.js` (rules; `installLife` after the talents, the Smith and dmgMult: wraps
addPlayer, handle, update, recompute, dmgMult, postureMul, forged), `public/life.js` (markers, prompts, gathering bar,
the Life panel with Skills / Garden / Cooking / Alchemy / Meals tabs, pad-driven via `data-nav`), small hooks in
`server/game.js` (merchant seeds, `/b tend`), `server/index.js` (join + life message), `server/accounts.js`,
`server/playerbots.js` (`b.pbOwner`, the tend mode), `shared/playerbots.js` (MODES.tend), `shared/bots/social.js`,
`shared/bots/brain.js` (`tend`), `shared/crafting.js` (MATS, ore recipes), `public/main.js` (wiring, bag Eat button,
merchant seeds), `public/gamemenu.js` (Life skills), `public/smith.js`, `public/guide.js`, `public/style.css`.

## Tests
`test/life.js`: pure rules (XP curve, yields, growth timing, recipes and data tables, spots clear of scenery, lab
spots off starts / ends / traps / levers / chests), an in-process game with an injected clock (learn, gather with
per-player refill, interrupts, level gate, stack cap, fishing windows, seeds, plant / grow / tend / harvest, cooking,
alchemy, meals and their buffs, Smith XP, rate limit) and, with DATABASE_URL, a real server: gather, plant, restart,
skip time, harvest, cook, eat, restart again: all of it persists. Browser check: `test/life.py`.

## Not done (cheap follow-ups)
- Free bots and the Named don't gather in the field yet (optional in the ask; per-player depletion means they never
  could take a player's spot anyway).
- No Smith-level perks yet (it only levels); no bonus for higher Cook / Alchemist beyond double batches.
- Fishing has no art beyond a pool disc and a bobbing float.
