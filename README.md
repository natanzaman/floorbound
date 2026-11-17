# Floorbound

A co-op 3D action RPG that runs in the browser. You and your friends are stuck in a 100-floor tower: fight through the field, beat the floor boss together, clear the floor.

This is the **Floors 1–2 prototype**: town hub, open field with mobs, the Horned Warden boss, a second floor (the Glimmering Mire and the Drowned Sovereign), 3 classes, parties, levels 1–20, and a real-time authoritative server.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can join at `http://<your-computer's-LAN-IP>:3000`.

## Play with friends over the internet

The server is a single Node process with WebSockets, so any host that runs Node and allows WebSockets works.

- **Render:** push this folder to a GitHub repo, then on render.com create a *Blueprint* from the repo (it reads `render.yaml`). Share the URL it gives you.
- **Railway / Fly.io:** deploy the repo (a `Dockerfile` is included). The server listens on `$PORT`.
- **Quick test without deploying:** run it locally and expose it with a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

Note: Vercel and Netlify won't work as-is, since they don't host long-running WebSocket servers.

## Controls

| Action | Desktop | Phone |
| --- | --- | --- |
| Move | WASD / arrows | Left side of the screen (joystick) |
| Look | Move the mouse (click the game to capture the cursor, Esc to free it); Q/E; wheel to zoom. Settings → Classic switches to right-drag + screen-edge turning | Drag the right side |
| Move | WASD: the character keeps facing where the camera looks, so S walks backwards and A/D strafe (also while locked on) | Left stick |
| Basic attack | Left click or J (hold) | Big round button (hold) |
| Skills | 1, 2, 3 | Small buttons |
| Dodge roll | Shift | Dodge button |
| Jump | Space (hop over the boss's slams) | Jump button |
| Guard / parry (Guardian) | Hold R to guard; tap R just before a hit to parry | — |
| Select a character (enemy or ally) | Ctrl+click it (Cmd+click on Mac); Ctrl+click empty ground to clear | Lock on button (enemies) |
| Lock on / cycle enemies | Tab (Esc to clear) | Lock on button |
| Chat | Enter | Chat button |
| Party | Players button (P) → Find party, or Invite | Players button → Find party / Invite |
| Items | 4 potion, 5 tonic, 6 draught; B bag | Potion button; Bag button |
| Skills panel (mastery, evolutions) | K, or the Skills button | Skills button |
| Interact (merchant, Smith, Skill Shrine, raid gate) | F | Trade / Forge / Skills / Ready button |
| Sound on/off | Sound button | Sound button |

Attacks auto-aim at your locked target, or the nearest enemy. Basic attacks are 3-hit combos with a heavy, knockback finisher. You sprint automatically after 3 seconds out of combat. All sound effects and music are synthesized in the browser (`public/audio.js`), so there are no audio files.

## Floor 1 enemies

| Enemy | Level | What it does |
| --- | --- | --- |
| Forest Boar | 2 | Passive until hit. Charges with a short bite. |
| Dire Wolf | 5 | Hunts in packs. Every bite shows a red wedge first: step out of it. |
| Bramble Spitter | 4 | Rooted plant. Draws a red line, then fires a thorn along it: sidestep or roll. |
| Alpha Wolf (elite) | 7 | Leads a pack: nearby wolves hit 25% harder. Howls to send the pack into a frenzy. |
| Warden's Hound | 8 | Summoned by the Warden in phase 2. Stays in the chamber. |
| The Horned Warden (boss) | 10 | Three phases. 100–66%: cleaves and ground slams. 66–33%: adds hounds and a horn charge down a red lane. Below 33%: enraged spin and rockfall circles under everyone. In every phase (more often later): the perilous **Horn Sweep**. |

## Floor 2 — The Glimmering Mire

A misty marsh of dead trees, shallow water and glowing crystals, for levels 11–18. It sits in the same world as Floor 1 (600 m east), with its own camp, field, raid gate and boss court.

- **Unlocking it:** help kill the Horned Warden (anyone who damaged it or healed in the fight). That unlocks Floor 2 for the character for good (saved with the character's stats; anonymous players keep it until they leave). Characters that had already killed the Warden are unlocked automatically.
- **Getting there:** a **waystone** stands in each town (Town of Beginnings, just south of the fountain; Mirelight Camp, Floor 2's safe zone). Press **F** at it to pick a floor you've unlocked. Right after a Warden kill a glowing **Stairway** also opens at the back of the Warden's chamber for 60 s: step in and press F.
- **Dying on Floor 2** sends you back to Mirelight Camp.
- The field takes a party from about level 10 to 15; the boss is meant for level 15+ parties.

| Enemy | Level | What it does |
| --- | --- | --- |
| Mire Shieldback | 12 | Turtle brute that turns slowly. Its pale front shell **blocks 80%** of damage from the front (shows BLOCKED): hit it from the side or behind, or Break it. |
| Will-o'-Wisp | 11 | Floats at range and **blinks away** when you get close. Draws a red aim line, then fires a slow **homing orb**: outrun it, turn hard, or roll through it. |
| Bog Lurker | 13 | Burrowed and untouchable (a ring of bubbling mud). **Erupts under anyone who stands still** for about 2 s (red circle under you), then fights on the surface for a few seconds before burrowing again. Keep moving. |
| Mire Matron (elite) | 15 | Leads the lurkers of the Drowned Wood: lurkers near her hit 25% harder, and her **Call of the Mire** sends every lurker nearby up under her target at once. |
| Drowned Thrall | 16 | Summoned by the Sovereign in phase 2. Stays in the court. |
| **The Drowned Sovereign** (boss) | 18 | Three phases, each adding attacks. 100–66%: trident sweeps (red wedge) and **geysers** (red circles; roll or jump). 66–33%: + the **Tidal Wave**, a ring of water that sweeps the whole court. You can't outrun it: **dodge-roll through it** as it reaches you (very heavy damage otherwise); + Drowned Thralls and purple **mire pools** that hurt while you stand in them. Below 33%: + **the Deluge** (the outer court floods: stay inside the bright ring) and volleys of homing orbs; waves come faster. |

Behind the Sunken Gate (same ready check as Floor 1's raid gate), the Sovereign's health scales with the party. Floor 2 clears go to their own section of the Hall of Clearers. The **Last Attack Bonus** is the *Sovereign's Tidecloak* (armour: +30% health, 10% less damage taken, 6% faster cooldowns); Floor 2 enemies drop from better loot tables, and the Sovereign drops two Rare/Epic items for everyone who fought. New title: **Mirebreaker** (help defeat the Drowned Sovereign).

## The raid gate and the Last Attack Bonus

A portcullis blocks the corridor to the Warden's chamber. Everyone standing at the gate presses **F** (or taps Ready); when all of them are ready, it counts down 5 seconds and rises. It closes again once the chamber is empty. Boss health scales with the number of players inside when the fight starts. Whoever lands the killing blow gets the **Last Attack Bonus**: the unique *Horn of the Warden* charm.

## Warden twists

Every time the Horned Warden spawns (server start, and each respawn after a kill) it rolls one **twist**, never the same one twice in a row. The twist is announced to the whole server, shown on the raid gate panel and under the boss bar, and pays a bonus to everyone who fought when the Warden dies under it.

| Twist | What changes | Kill bonus |
| --- | --- | --- |
| Packmaster | Hounds from the start of the fight, up to 5 at once; the Warden's howl sends them into a frenzy. | +1 loot roll |
| Twin Horns | Horn charges come in pairs (the second re-aims at someone else) and start in phase 1. | +50% gold |
| Quaking | Every ground slam leaves cracked ground for 6 s that hurts while you stand in it. | +50% gold |
| Thornbound | The Warden raises stone Thorn Totems at the chamber edge; they shoot thorns until you break them (or 45 s pass). | +1 loot roll |
| Ironhide | Takes 40% less damage unless Broken; Broken windows last 1.6 s longer. Break it, then Switch. | +1 loot roll |
| Berserk | Enraged from the first second (every phase-3 attack), but 25% less health. | +1 loot roll, +50% gold |
| Eclipse | The chamber goes dark and every telegraph gives 25% less warning. | +2 loot rolls, +100% gold |
| Echo | Every slam and rockfall strikes again in the same spot 1.5 s later (purple circle). | +1 loot roll |

The table lives in `shared/twists.js`, server behaviour in `server/twists.js`, client visuals in `public/twists.js`. `WARDEN_TWIST=<id>` forces one (testing aid), e.g. `WARDEN_TWIST=eclipse START_LEVEL=10 SPAWN_AT=0,150 npm start`.

## Rare spawns

Every 6–10 minutes one named rare appears somewhere on Floor 1, announced to the whole server with a beam and a direction hint: **Old Tusk** (giant boar, Verdant Field), **Ghostfang** (white alpha wolf, Wolf Woods) or **Thornmother** (giant spitter, fires 3-thorn fans). Everyone who damages it gets their own Rare-weighted loot roll. It wanders off after 5 minutes if nobody fights it. `RARE_SOON=1` spawns the first one after ~10 s (testing).

## Titles and the Hall of Clearers

Characters keep lifetime stats and earn titles (Warden Slayer, Last Attacker, Switch Master, Boarbane, Wolfsbane, Frontliner, Undying, Veteran). Pick the one you wear in the bag (B); it shows under your name. The stone **Hall of Clearers** in town (press F) lists the server's first Floor 1 clear, the fastest clears and the latest ones.

## Items

- **Gear:** weapon (+damage), armour (+health, and less damage taken at Rare+), charm (crit, cooldowns or Switch damage). Rarities: Common, Uncommon, Rare, Epic, plus the gold Last Attack item. Weapons are class-specific and come in three **weapon styles** per class (see below).
- **Drops are personal:** every party member nearby rolls their own gold, potions and gear. Alphas always drop Uncommon+; the Warden drops two Rare+ items for everyone who fought.
- **Consumables:** Health Potion (40% health), Battle Tonic (+15% damage, 30 s), Ironbark Draught (−15% damage taken, 30 s). New characters start with 3 potions.
- **Merchant** in town (press F at the stall): buy consumables and Uncommon gear (including a weapon in your class's alternate style), sell items.

## Crafting

- **Materials** drop alongside loot (personal rolls, kept in a Materials pouch that doesn't use bag slots): Boar Tusk (boars), Wolf Pelt (wolves), Thorn Resin (spitters), Alpha Fang (alphas), Rare Core (Old Tusk, Ghostfang, Thornmother) and 2–4 Horn Shards from the Warden.
- **The Smith** works the forge on the south side of the plaza (press F, or tap Forge). Four tabs:
  - **Refine** a bag or worn item from +1 to +5. Each level adds +10% of its base stats and never fails. Weapons take Tusks and Fangs, armour Pelts and Fangs, charms Resin and Rare Cores; +3 and up also need Essence, +4 and +5 need Horn Shards. Gold cost rises with level and rarity.
  - **Craft** named gear with fixed, top-of-range stats: Tuskbreaker (weapon for your class) · Pelt Mantle · Resin Charm of Haste · Fang Sigil (Switch) · Keen Fang Charm (Rare), and Hornplate · Warden-Forged weapon · Thornheart Talisman (Epic, need Horn Shards, Rare Cores or a Prism).
  - **Salvage** a bag item into Dust (Common), Essence (Uncommon, Rare) or Essence + Prism (Epic); refined items return half their main materials. The Last Attack charm can't be salvaged.
  - **Reforge** an item's stats within its rarity range, or give a charm a different affix, for Essence and gold (Epics also take a Prism). Crafted and Last Attack items are fixed.
- Everything is validated on the server and saved with the character. Tuning lives in `shared/crafting.js` (drops, costs, recipes); the server side is `server/smith.js`, the forge and panel `public/smith.js`. Tests: `node test/craft.js`.

## New players and the party finder

New characters get a short step-by-step guide card (move, hit, dodge, kill, bag, party, Switch, raid gate, boss) plus one-time tips the first time they see each attack type. **Find party** puts you in the party finder: solo players are matched together, or into any party that has turned on recruiting.

## Play tracking

With a database, the server records play events (session start/end, first kill, deaths and their cause, party joins, guide steps, boss attempts, rare drops) in `play_events`. See the aggregates at **/stats.html** (raw JSON at `/api/stats?days=7`): boss kills, wipes, median kill time and sessions that reached the boss for each floor side by side, and what kills players on each floor.

## Combat: posture, Break and Switch

- **Dodge roll** gives a short window of invulnerability; roll through the boss's red circles.
- **Posture:** every enemy has a thin yellow posture bar under its health (nameplate, target frame, boss bar). Every hit fills it in proportion to the damage; heavy hits and combo finishers fill it twice as fast; Break skills (Ground Slam, the Burst Combo finisher) fill about half of it on normal enemies (less on the boss); a Smite that lands while the enemy winds up an attack fills a big chunk and interrupts it. Posture drains slowly after 2.5 s without being hit.
- **Break:** when posture is full the enemy is BROKEN: stunned for a moment (yellow dizzy ring), its wind-up is cancelled, and its posture resets. The Warden can be broken again as soon as its posture refills.
- **Switch:** the first hit from a *teammate* on a broken enemy does 2.5x damage, and follow-up hits do 1.4x. You can't Switch your own Break. Charms of the Switch boost this further.
- **Perfect dodge:** start a roll at most ~0.2 s before a hit lands and it's PERFECT: a brief slow-motion flash, heavy posture damage to the attacker, and for 1.5 s your next hit does +50% damage and double posture damage.
- **Guard and parry (Guardian, R):** hold R to guard: hits from the front (±70°) take 70% less damage, but you can't attack and you move at half speed. Press R at most ~0.2 s before a frontal hit lands to **parry** it: no damage at all, and big posture damage to the attacker. Mashing R doesn't parry.
- **Perilous attacks:** the Warden's **Horn Sweep** shows an orange/gold circle around it with a "!" glint and its own warning horn (about 0.9 s). Anyone inside takes about 80% of their max health: Shield Wall, Taunt, guarding, gear and jumping don't reduce it. Roll through it (i-frames) or parry it. Breaking the Warden during the wind-up cancels it. It comes every ~18 s in phase 1, more often later.

## Skill mastery and evolutions

Each class skill on 1, 2 and 3 (not the basic attack) has its own **Mastery** level from 1 to 5, raised by **using it well**, not by pressing it: the damage and posture it deals, Breaks it causes, Switches it sets up or lands, damage it prevents (Taunt, Shield Wall, Haven, Aegis), healing it does (overheal doesn't count) and the extra damage allies deal while it buffs them (Blessing). A whiff gives nothing. Points are measured in "attacks' worth" (amount / your attack power), so the pace doesn't change with level or gear: a skill you use often reaches Mastery 3 after roughly 30–45 minutes of normal play, Mastery 5 after a few hours.

- **Mastery 2:** -10% cooldown. **Mastery 4:** +10% effect (damage, healing, shields, buffs).
- **Mastery 3: the skill evolves.** You pick one of two branches that change how it plays (a prompt appears, or press **K**). The first pick works anywhere; changing it later is free but only at a **Skill Shrine**: a violet crystal in each town (Town of Beginnings, beside the Hall of Clearers; Mirelight Camp on Floor 2, by the tents). Press **F** there, or tap Skills.
- The **Skills panel** (K, the Skills button, or the shrine) lists each skill's mastery, progress, upgrades and both branch cards with the active one highlighted. Evolved skills keep their slot and show their new name on the skill bar.

| Skill | A | B |
| --- | --- | --- |
| Rush | **Phantom Rush**: dash through, an afterimage strikes the path again 0.4 s later | **Shoulder Charge**: stop on the first enemy, heavy posture damage and a stun (co-op) |
| Whirl | **Vortex**: pull enemies within 7 m in, then spin (co-op) | **Blade Ring**: smaller ring that spins with you for 1.5 s while you move |
| Burst Combo | **Starburst**: 6 hits, more damage, no Break | **Finisher**: 2 hits; above 50% health the second fills posture, instant BREAK (co-op) |
| Taunt | **Challenge**: one enemy deals 30% less to everyone but you for 5 s (co-op) | **War Cry**: 11 m taunt that drags enemies in, allies +10% damage for 6 s (co-op) |
| Shield Wall | **Bulwark**: stand still: -80% from the front, allies behind you -60% (co-op) | **Iron Skin**: move freely, -35% for 6 s, reflects 30% of each hit |
| Ground Slam | **Quake**: 7 m, launches enemies, longer stun | **Seismic Line**: a shockwave travelling 12 m forward, Breaks along its path (co-op) |
| Heal | **Renew**: smaller heal over 6 s on the two most hurt allies | **Miracle**: big heal + purify (immune to mire pools, cracked ground, the Deluge for 4 s), 2.5x cooldown |
| Blessing | **Zeal**: allies +15% damage, cooldowns 25% faster for 8 s (co-op) | **Aegis**: shields absorbing 25% of each ally's health for 8 s |
| Sanctuary | **Haven**: allies inside take 25% less damage, smaller heal | **Consecrate**: burns enemies inside and fills their posture for a Switch, no heal (co-op) |

Mastery and branches are saved with the character (a `mastery` JSONB column); anonymous players keep them until they leave. Tuning (thresholds, weights, branch names) lives in `shared/mastery.js`; the server side is `server/mastery.js` (`useEvolved` runs the 18 evolutions), the Skills panel, shrines and visuals `public/mastery.js`. Tests: `node test/evolve.js` (add `DATABASE_URL=...` for the save/load round trip). Testing aids: `MASTERY=3` (or 5) starts every skill at that mastery; the bot party picks random branches, or `BRANCH=A` / `BRANCH=B`:

```bash
MASTERY=3 START_LEVEL=10 SPAWN_AT=0,150 npm start
BRANCH=B node test/team.js                  # every skill evolved into branch B
```

## Weapon styles

Every class fights in one of three **weapon styles**, set by the weapon you wear (no weapon, or a weapon without a style, is the class default). A style changes how the basic attack plays, adds one passive and tweaks one skill. You see it on the character (the weapon in their hands, for everyone), in the bag and tooltips (style name, passive, skill tweak), and on the basic-attack button's tooltip.

| Class | Style | Basic attack | Passive | Skill tweak |
| --- | --- | --- | --- | --- |
| Swordsman | **One-Handed Sword** (default) | 3-hit combo, knockback finisher | — | — |
| | **Dual Blades** | Faster 4-hit combo (0.4 s), lighter hits; the 4th is a double strike with extra posture | Each Switch you land cuts your skill cooldowns by 0.5 s | Burst Combo strikes 6 times |
| | **Rapier** | Thrusts that reach 4.6–5.4 m and pierce everything in a line; +10% crit | Perfect-dodge counters deal 40% more | Rush lunges 12 m (8 m) |
| Guardian | **Sword & Shield** (default) | 3-hit combo with extra threat | — | — |
| | **Mace & Shield** | Slow (0.95 s), heavy blunt blows, double posture; the 3rd sends a shockwave with a big posture chunk | Breaks you cause last 1.2 s longer (0.6 s on bosses) | Ground Slam radius +20% |
| | **Spear & Shield** | Long pokes (4.8–5.6 m) through everything in a line | +50% threat from everything you do | Taunt range +30% |
| Cleric | **Staff** (default) | Smite: a 10 m bolt that interrupts wind-ups | — | — |
| | **Mace & Tome** | Melee 3-hit combo; the 3rd blow is Smite as a shockwave all around you (interrupts) | Every press that lands heals the most hurt ally within 12 m (3% of their health + 2) | Smite becomes the melee shockwave |
| | **Wand** | Faster (0.5 s), longer (12 m), weaker bolts; still interrupt | Bolts on an enemy a teammate Broke heal that teammate (5% of their health) | Heal reaches 22.5 m (15 m) |

- **Getting one:** weapon drops roll a style (the class default half the time, otherwise one of the other two); the merchant sells the default Uncommon weapon plus one in your class's alternate style (Dual Blades, Mace & Shield, Mace & Tome); the Smith has a recipe per non-default style (Twinfang Dual Blades, Thornneedle Rapier, Tuskmaul and Hornmaul Mace & Shield, Packpike Spear & Shield, Hymnal Mace & Tome, Resinlight Wand), shown only to that style's class; the admin editor's *Add item* has a style picker. Names follow the style ("Tempered Dual Blades", "Duskglass Rapier", "Iron Mace & Shield", "Ash Wand"). Weapons stay class-locked; refining and reforging keep the style.
- **Server-authoritative:** the server resolves the style from the equipped weapon on every equip/recompute and sends it as the 12th field of each snapshot player row (an index into `STYLE_IDS`, -1 for none), so everyone renders the right weapon. Style skill tweaks apply to the base skills, not to their Mastery 3 evolutions.
- **Visuals:** each style has its own held weapon, animations and hit effects: two swords (the KayKit knight's sword mirrored into the off hand) with crossing arcs; a needle-thin rapier with white thrust lines; a flanged mace with the round shield and an orange shockwave ring; a long spear with the square shield and amber thrust lines; a gold mace with the spellbook and a golden shockwave; the KayKit wand with quick violet bolts. The rapier, maces and spear are built from Three.js geometry (`public/styles.js`); the swords, shields, spellbook and wand come from the KayKit Adventurers models already in `public/models` (CC0).
- **Code:** data and tuning `shared/styles.js`; server `server/styles.js` (mixed into Game; game.js reads the skill tweaks through `styleNum`); client `public/styles.js`. Test: `node test/styles.js` (add `DATABASE_URL=... PORT=3583` for the save/load round trip).
- **Testing aids:** `START_STYLE=<id>` (`sword`, `dual`, `rapier`, `shield`, `mace`, `spear`, `staff`, `tome`, `wand`) equips that style's weapon on everyone of that class who joins; `START_STYLE=random` a random style for everyone. `BOT_STYLES=1` gives every anonymous player (bots included: `test/team.js` and the admin page's server bots) a random style:

```bash
BOT_STYLES=1 START_LEVEL=10 SPAWN_AT=0,150 npm start
node test/team.js
```

## Classes

| Class | Role | Skills |
| --- | --- | --- |
| Swordsman | Damage | Slash, Rush (dash strike), Whirl (spin), Burst Combo (Lv 3) |
| Guardian | Tank | Bash, Taunt, Shield Wall, Ground Slam (Lv 3, stuns) |
| Cleric | Healer | Smite (ranged), Heal, Blessing (+25% damage), Sanctuary (Lv 3) |

## Project layout

```
shared/data.js   classes, skills, mobs, map, collision — used by server AND client
shared/floor2.js Floor 2: map, waystones, enemies, Sovereign tuning (appended into data.js)
server/floor2.js Floor 2 AI (Shieldback, Wisp, Lurker, Matron, Sovereign), Sunken Gate, waystones/Stairway
public/floor2world.js, public/floor2client.js  Floor 2 scene, models, effects, waystone UI
server/game.js   authoritative simulation: combat, AI, boss, XP, parties
server/combat.js posture/Break, perfect dodge, guard/parry, Horn Sweep (mixed into Game)
server/index.js  static file server + WebSocket server (20 ticks/sec)
public/          Three.js client (no build step): main.js, world.js, style.css
public/models/   rigged character models (glTF) with shared animations
test/bots.js     headless bot players for load/gameplay testing
test/combat.js   in-process checks for posture, perfect dodge, guard/parry and the Horn Sweep (node test/combat.js)
shared/teambots.js  bot brains: role-playing party (tank / DPS / healer) and single bots; used by test/team.js, public/bots.html and server/botmanager.js
shared/mastery.js, server/mastery.js, public/mastery.js  skill mastery and evolutions; test/evolve.js
shared/styles.js, server/styles.js, public/styles.js  weapon styles; test/styles.js
server/admin.js  admin API (/api/admin/*) and /api/lobby; server/botmanager.js runs bots inside the server; public/admin.html the admin page
```

Tuning lives in `shared/data.js` (class HP/ATK, cooldowns, mob stats). New skills are a `case` in `Game.useSkill` plus an entry in `CLASSES`.

## Accounts and saved characters

Set `DATABASE_URL` (any Postgres; the live game uses Neon) to turn on accounts. Tables are created automatically on startup.

- **Play as guest:** a guest account is saved in that browser (no password, no email).
- **Sign in with Discord:** set `DISCORD_CLIENT_ID` (the app's public Application ID) and add the redirect URL `https://YOUR-HOST/auth/discord/callback` in the Discord app's OAuth2 settings. No client secret needed: the server checks each sign-in token with Discord and confirms it was issued to this app. Signing in while playing as a guest links the guest's characters to Discord.
- Up to 4 characters per account; names are unique. Level and XP save every 15 s, on level-up and on disconnect.

Without `DATABASE_URL` the game runs in anonymous mode (pick a name and play, nothing saved), which is handy for local development.

## Admin

Open **/admin.html** in the browser where you play (it uses the game's saved session). It needs accounts (`DATABASE_URL`).

**Becoming an admin**, either way:

- Set the flag in the database: `UPDATE accounts SET is_admin = true WHERE id = <your account id>;` (the admin page shows your account id when you're not an admin yet; for a Discord account you can match on `discord_id`).
- Or list Discord user ids in `ADMIN_DISCORD_IDS` (comma-separated), e.g. `ADMIN_DISCORD_IDS=123456789012345678,234567890123456789`. Those accounts are admins while the variable is set.

Every `/api/admin/*` route checks that the session belongs to an admin (401 signed out, 403 otherwise). Nothing admin-only goes over the game WebSocket.

The page has three tabs:

- **Bots:** bots that run inside the server (no browser tab needed). Add one bot (class, optional name, starting level, behaviour: *follow* an online player, fighting alongside them in their party; *farm the field* near town; *go fight the Warden*; *Floor 2*; or the classic *level up, then the Warden*), or a whole team (Guardian, Swordsman, Cleric). Each bot shows its level, health, floor/area, party and behaviour, with a Remove button; *Remove all bots* clears them. Bots are anonymous (never saved), marked as bots in the roster (BOT tag in the game), left out of play tracking, and capped at 30 (`MAX_BOTS`). A follower that falls far behind (or is on another floor) appears next to its player.
- **Players:** every saved character merged with the live game: class, level, account (Discord name or `guest #id`), online/offline, current floor and area, last seen and created. Search, filter and sort (click a column).
- **Edit** (click a character): level and XP, gold, consumables, materials, equipped and bag items (remove, equip, add any slot/rarity/class, add the Last Attack items), titles earned and worn, lifetime stats, skill mastery (level/points and evolution branch per skill), the Floor 2 unlock, rename, class change (offline only; a weapon for the old class goes back to the bag), delete (type the name to confirm), and an **Advanced: raw JSON** editor for the stored inventory, stats and mastery (validated; unknown stats keys are kept). If the character is online, the edit is applied to the live player straight away (they get "An admin updated your character") and saved.

The in-game **Players** panel (P) lists real players online, the bots (collapsed), and characters seen in the last 30 days (`GET /api/lobby`: name, class, level, last seen, no account details).

Code: `server/admin.js` (routes), `server/botmanager.js` (bots), `public/admin.html` + `public/admin.js`. Test: `DATABASE_URL=... node test/admin.js` (starts its own server on port 3572).

## Testing

```bash
npm start                                   # terminal 1
node test/bots.js 6 60 field                # 6 bots grind the field for 60s
START_LEVEL=6 npm start                     # start players at Lv 6 (testing aid)
node test/bots.js 6 90 boss                 # bots party up and fight the Warden
```

Watch a role-playing party (tank, DPS, healer) clear the floor, with a spectator camera:

```bash
START_LEVEL=6 SPAWN_AT=-26,116 npm start
node test/team.js                           # Brann (tank), Kael (DPS), Lyra (healer)
# open http://localhost:3000/?spectate=1
```

**On any server (including the live one):** open `/bots.html` to add bot parties from your browser (`/bots.html?teams=2` for two), then watch at `/?spectate=1` or play alongside them. Keep the bots tab open.

`?spectate=1` works on any server: it watches without joining and frames the whole group.

Other testing aids: `SPAWN_AT=0,172` spawns players at the chamber gate. `WARDEN_TWIST=<id>` forces a Warden twist (see above). `MAX_PLAYERS` caps the server (default 64).

Floor 2: `SPAWN_AT=600,150` spawns at the Sunken Gate (spawning on Floor 2 also unlocks it; deaths respawn there too). The bot party goes to Floor 2 with `FLOOR=2`: from Floor 1 they kill the Warden and take the Stairway (or use the town waystone if already unlocked), farm the Mire until level 15, then fight the Sovereign.

```bash
START_LEVEL=16 SPAWN_AT=600,150 npm start
FLOOR=2 node test/team.js                   # the party takes on the Drowned Sovereign
```

Measured on the prototype: 40 bots used about 5% of one CPU core, about 50 KB/s down per player.

## Credits

Character models and animations: [KayKit Adventurers Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)), CC0. The models were trimmed to the animations the game uses.

## Next steps

See the design doc for the full roadmap: Floors 3–5, zone servers for hundreds of players. Stage C (skill mastery and evolutions) is done in spirit: see above.
