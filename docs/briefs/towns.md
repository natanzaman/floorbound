# Floor towns and Stewards (branch `feat/towns`)

Owner goal (phases 5 and 6 of the batch): each floor's town grows from Camp to City with what everyone does on that
floor, citizens fund its projects and defend it from raids, and a Steward governs it, chosen a different way on each
floor. Bots and the Named live in towns, vote, stand and defend. Graphics are on hold: posts, banners, stalls, stones.

## Design
- **One town per floor**, server-wide (all characters share it): the Town of Beginnings (Floor 1), Mirelight Camp
  (Floor 2), Windbreak Camp (Floor 3). Data in `TOWNS` (`shared/towns.js`): the **town board** (a post with a banner),
  the **ward** (where raiders march), where raiders gather, the gate waystone's place and (Floors 2-3) the trader stall.
- **Stages**: Camp 0, Village 1,500, Town 6,000, City 18,000 town XP (guess). **Town XP** comes from play on that floor
  (labyrinths count for their floor): a field kill 1, elite 4, rare 10, boss 80, labyrinth keeper 30, a gathering 1, a
  meal / brew / Smith job 2 (Floor 1: the Smith and the stations are there), a Named request 10, a bounty 25, 1 per 20
  gold donated, a raid won 150 + 50 a wave. Bots and the Named earn a quarter (`BOT_RATE`). **Quiet trickle**: 4 XP and
  2 treasury gold an hour, +1 each per bot citizen, so towns grow slowly with nobody online (caught up for at most 72 h
  after a restart, from the saved `trickleAt`).
- **Projects** (`PROJECTS`, per floor, in a default order; each needs a stage): gold plus materials by id (any `MATS`
  id, life materials included). Citizens and anyone else give at the board (only what the project still needs is taken);
  the treasury pays gold into the current project once a second; bot and Named candidates pledge 40 gold a day.
  Finishing one turns on an **unlock** (`UNLOCKS`): a camp trader (the Merchant's wares, Floors 2-3), better stock
  (Rare gear, Moonroot seeds at that town's merchant), the bounty board (3 daily bounties on that floor's monsters),
  irrigation (citizens' crops grow 15% faster while they play), the gate waystone (warp to the raid gate from any awake
  waypoint), a guild-hall plot (`plotSlots`: the hook for guilds later), the market square (5% off for everyone).
  An unlock is live while the town is at its project's stage (a town knocked back by a raid loses it until it regrows).
- **Citizenship** (`characters.town`): one home town; joining at its board is free; 7 days between moves. Citizens get
  5% off at that town's merchant (and the Smith, on Floor 1) and a vote. The Named have fixed homes (`NAMED_HOMES`);
  free bots live where their creator lives (else the floor they're on). They count as citizens and vote.
- **Prices** (`priceMul`): list price x (1 + tax - citizen 5% - market 5%), never under 80%. A Steward's discount
  (negative tax) is paid from the treasury and stops when it's empty. Tax goes to the treasury.
- **Raids** (PvE only), every 2.5-4 real days per town (first 1-2 days after a town is made). One falls due but only
  starts while a human is on that floor, and never during a director show. 60 s warning (banner, horn, HUD), then 3
  waves 30 s apart with 3 s red ground telegraphs where they'll appear. Raiders march on the ward and hit it; anyone in
  reach pulls them off. Ward health 3,000 + 1,200 per human on the floor; raiders a wave 4 + 2 per human. Win: kill every
  wave. Lose: the ward falls or 7 minutes run out: the town loses 12% of its stage band (at least 100), never more than
  one stage and never below Camp. Nobody human on the floor for 60 s: the raid withdraws, back in 6 h. Free bots and the
  Named on the floor (not in a human's party) are ordered to hold the ward (`defend` command) and released after.
  `TOWN_RAIDS=0` turns automatic raids off.
- **Elections** (`ELECTION`): a cycle of 7 days. Candidates: citizens who stand at the board (agenda: Build, Defend or
  Trade, and a one-line platform) plus 1-2 bot or Named candidates per town (`BOT_CANDIDATES`). Citizens vote, one vote
  per character per cycle, changeable until it closes. Bots and the Named vote by plain rules (`botVote`): agenda match,
  friendship points with a player candidate (the Named), party time with a candidate this cycle (rapport), a bot's
  creator, a little for what a candidate gave; a candidate votes for itself; the loner Cairn only votes for a friend.
  - Floor 1: by vote (ties: what they gave, then who stood first).
  - Floor 2: by contribution (most given to town projects this cycle; bot candidates' pledges count).
  - Floor 3: a single-elimination duel tournament (seeded by votes, byes for the top seeds), using the duel system
    (`server/duels.js`, rule `half`). A match needs both online and free; one who is online but busy gets 2 minutes; one
    who's away loses by walkover; both away (or an NPC candidate): decided on paper (level, what they gave, a fixed coin).
  - **Platforms**: the Named write theirs through the AI mind when it's on and within the day's budget (one call per Named
    per election, `namedtalk.platform`); otherwise (and NPC candidates always) a line from `PLATFORMS`. No AI per vote.
- **The Steward**: chooses the next project (what was given moves to the treasury, materials stay given), sets the tax
  from -5% to +10% in 1% steps, pins a message on the board. A bot Steward governs by its agenda at once
  (`stewardProject`, `stewardTax`, `stewardMsg`). The Steward's name shows over the board.

## Wire
- Client → server `{ type: 'town', op, f, ... }`: `state` (send me the panel), `join`, `donate { gold, mats }`,
  `stand { ag, plat }`, `withdraw`, `vote { k }`, `steward { project | tax | msg }`, `claim { i }` (a bounty), `gate`
  (from the waypoint panel). Everything but `state` and `gate` needs the player at that town's board; 0.15 s apart.
- Server → client `{ type: 'towns', towns: [...], me: { home, move, given } }` when `p.townsDirty` (set for everyone at
  most once a second after a change); raids in the snapshot `w.tr: [[floor, fighting, wave, waves, ward%, secs, raiders]]`;
  events `traid` (warn, tele with points, won, lost, gone), `townup`, `townbuilt`, `steward`.
- Test hooks (TEST_HOOKS=1) `{ type: 'test', town: { skip: ms, xp: [f, n], mats: { id: n }, close: f, paper: 1, raid: f, raidEnd: [f, won] } }`.

## DB
- `towns (floor INT PRIMARY KEY, xp, stage, treasury, projects JSONB, data JSONB, updated_at)`: one row per town, saved
  every 10 s when changed (`TOWN_SAVE_MS`) and on shutdown. `characters.town JSONB`: home, moved, given, today's bounty
  progress. Both `IF NOT EXISTS` (safe to run twice). Citizen counts come from `characters.town` at start.

## Files
- `shared/towns.js`: every table and pure rule. `server/towns.js`: the module on `Game.prototype` (wraps addPlayer,
  handle, update, updateMob, killMob, labKeeperKilled, lifeDone, lifeMake, forged, smithCheck/smithPay, nearMerchant,
  duelEnd). `server/towns-admin.js`: `/api/admin/towns`. `public/towns.js`: boards, stalls, stones, the ward, the Town
  panel (Town, Election, Bounties, Steward; pad-driven), raid HUD and labels. `public/admin-towns.js`: the admin card.
  Small hooks in `server/game.js` (buy), `server/accounts.js`, `server/db.js`, `server/index.js`, `server/botmanager.js`,
  `shared/bots/brain.js` (defend / release), `server/ai/namedtalk.js` (platform), `public/main.js`, `public/smith.js`,
  `public/floor2client.js` (gate rows), `shared/items.js` (town stock).

## Cost
- Per tick: only raid marches (raiders' AI) and a ward check. Everything else once a second: a pass over players,
  then per town a few comparisons. Empty floors: no raid starts, a running one withdraws.

## Tests
`node test/towns.js` (pure rules, in process, and with `DATABASE_URL` a real server run across a restart).

## Guesses to tune
Stage XP, every TXP value, BOT_RATE, the trickle, project costs, the raid numbers (interval, ward health, wave size,
loss share, time limit), tax limits, the citizen and market discounts, bounty sizes and gold, vote weights (`VOTE`),
the pledge, the tournament wait.
