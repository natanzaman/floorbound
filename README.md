# Floorbound

A co-op 3D action RPG that runs in the browser. You and your friends are stuck in a 100-floor tower: fight through the field, beat the floor boss together, clear the floor.

This is the **Floors 1–2 prototype**: town hub, open field with mobs, the Horned Warden boss, a second floor (the Glimmering Mire and the Drowned Sovereign), 5 classes, parties, levels 1–20, and a real-time authoritative server.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can join at `http://<your-computer's-LAN-IP>:3000`.

## Play with friends over the internet

The server is a single Node process with WebSockets, so any host that runs Node and allows WebSockets works.

- **Render:** push this folder to a GitHub repo, then on render.com create a *Blueprint* from the repo (it reads `render.yaml`). Share the URL it gives you.
  - **Updates (deploys):** Render keeps the old instance serving while the new one starts, then sends it SIGTERM. The server then tells everyone *"Update incoming: you'll reconnect in a moment"*; if a boss fight with players in it is running (Warden or Sovereign engaged, a player in the chamber) it waits for the fight to end, at most 4 minutes; then it saves every character and exits, and clients reconnect to the new instance. `render.yaml` sets `maxShutdownDelaySeconds: 300` (Render's maximum, default 30) so the wait isn't cut short; it only applies if the service is managed by the Blueprint (otherwise set it in the dashboard or API, if your plan offers it). The server runs as `node server/index.js` (not `npm start`) so the signal reaches it. Off Render (no `RENDER` env var) Ctrl+C saves and exits at once; `SHUTDOWN_HOLD_MS` overrides the wait. Code: `server/shutdown.js`; test: `node test/shutdown.js`.
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
| Jump | Space (hop over the boss's slams and Quake Rings; you keep your momentum and can steer in the air, a little less sharply than on the ground) | Jump button |
| Guard / parry (Guardian) | Hold R to guard; tap R just before a hit to parry | — |
| Select a character (enemy or ally) | Hold Ctrl (Cmd on Mac) to preview, Ctrl+click to select; Ctrl+right-click to deselect | Lock on button (enemies) |
| Lock on / cycle enemies | Tab (Esc to clear) | Lock on button |
| Chat | Enter (`/p` party, `/s` nearby, `/b` bot orders); lines also show as speech bubbles over the speaker's head (Settings → Speech bubbles turns them off) | Chat button |
| Pose | Chat `/kneel`, `/sit`, `/bow`; `/stand`, moving, attacking, a skill, dodging, jumping or guarding stands you up | Chat button |
| Party | Players button (P) → Find party, or Invite | Players button → Find party / Invite |
| Team Burst | T: when the party bar at the top of the party frames is full, start a 3 s sync window; partners press T to join | Tap the full bar (or the prompt) |
| Order your party's bots | Hold V (command wheel), or chat `/b stay`, `/b Lyra: heal` (`/b help` lists them) | ⌘ Bot orders under the party frames |
| Items | 4 potion, 5 tonic, 6 draught; B bag | Potion button; Bag button |
| Skill Tree (progression, talents, mastery, evolutions) | K, or the Skills button (Esc closes) | Skills button |
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
| The Horned Warden (boss) | 10 | Three phases. 100–66%: cleaves and ground slams. 66–33%: adds hounds and a horn charge down a red lane. Below 33%: enraged spin and rockfall circles under everyone. Every big attack has its own wind-up pose, held long enough to read and get ready: it rears up with the axe overhead (ground slam), crouches with its horns lowered (horn charge), coils round with the axe wound back (Horn Sweep, spin), or lifts a knee high (Quake Ring stomp). In every phase (more often later): the perilous **Horn Sweep** and the **Quake Ring**: it rears up on one leg and stomps (an amber circle marks how far the rings reach), then a low shockwave rolls out across the floor; **jump** as the wavefront reaches you (airborne = no damage, "Jumped!"), roll through it, or stand outside the amber circle. One ring per stomp in phase 1, two in phase 2, three in phase 3. |

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

A portcullis blocks the corridor to the Warden's chamber. Everyone standing at the gate presses **F** (or taps Ready); when all of them are ready, it counts down 5 seconds and rises. It closes again once the chamber is empty. The Warden scales to the fighters inside when the fight starts: health by the party's size and make-up (each fighter weighted by role, damage dealers most, then raised to a power, so a full party of six with three damage dealers and a Bard faces about 3.3× the health of a Guardian/Swordsman/Cleric trio), damage by size (+12% per fighter above three), and both by level when the party's average is above 10 (+12% health and +6% damage per level). Slams target one fighter per three in the chamber. Tuning: `WARDEN` in `shared/data.js`. Whoever lands the killing blow gets the **Last Attack Bonus**: the unique *Horn of the Warden* charm.

## Warden twists

Every time the Horned Warden spawns (server start, and each respawn after a kill) it rolls one **twist**, never the same one twice in a row. The twist is announced to the whole server, shown on the raid gate panel and under the boss bar, and pays a bonus to everyone who fought when the Warden dies under it.

| Twist | What changes | Kill bonus |
| --- | --- | --- |
| Packmaster | Hounds from the start of the fight, up to 5 at once; the Warden's howl sends them into a frenzy. | +1 loot roll |
| Twin Horns | Horn charges come in pairs (the second re-aims at someone else) and start in phase 1. | +50% gold |
| Quaking | Every ground slam leaves cracked ground for 6 s that hurts while you stand in it, and every Quake Ring stomp sends one more ring. | +50% gold |
| Thornbound | The Warden raises stone Thorn Totems at the chamber edge; they shoot thorns until you break them (or 45 s pass). | +1 loot roll |
| Ironhide | Takes 40% less damage unless Broken; Broken windows last 1.6 s longer. Break it, then Switch. | +1 loot roll |
| Berserk | Enraged from the first second (every phase-3 attack), but 25% less health. | +1 loot roll, +50% gold |
| Eclipse | The chamber goes dark and every telegraph gives 15% less warning. | +2 loot rolls, +100% gold |
| Echo | Every slam and rockfall strikes again in the same spot 1.5 s later (purple circle). | +1 loot roll |

The table lives in `shared/twists.js`, server behaviour in `server/twists.js`, client visuals in `public/twists.js`. `WARDEN_TWIST=<id>` forces one (testing aid), e.g. `WARDEN_TWIST=eclipse START_LEVEL=10 SPAWN_AT=0,150 npm start`.

## Rare spawns

Every 6–10 minutes one named rare appears somewhere on Floor 1, announced to the whole server with a beam and a direction hint: **Old Tusk** (giant boar, Verdant Field), **Ghostfang** (white alpha wolf, Wolf Woods) or **Thornmother** (giant spitter, fires 3-thorn fans). Everyone who damages it gets their own Rare-weighted loot roll. It wanders off after 5 minutes if nobody fights it. `RARE_SOON=1` spawns the first one after ~10 s (testing).

## Titles and the Hall of Clearers

Characters keep lifetime stats and earn titles (Warden Slayer, Last Attacker, Switch Master, Boarbane, Wolfsbane, Frontliner, Undying, Veteran). Pick the one you wear in the bag (B); it shows under your name. The stone **Hall of Clearers** in town (press F) lists the server's first Floor 1 clear, the fastest clears and the latest ones.

The stone itself is engraved: its face carries the names of the latest Floor 1 clear (everyone who fought, the fallen too), updated live for everyone the moment a clear happens; it's blank until the first one. Its back reads *A HUNDRED BELLS. THEN HOME.* Floor 2 has a smaller stone by Mirelight Camp's Skill Shrine with the latest Floor 2 clear.

**The Tower Bell.** The first time a floor is cleared on the server, a bell tolls for everyone on every floor: one deep, long synthesized toll, a slow camera sway and a banner (*THE FIRST BELL · Floor 1 has been cleared. Ninety-nine to go.*; *THE SECOND BELL* for Floor 2, and so on). Later clears don't ring it. Server: `ringBell(floor, { auto })` in `server/bell.js` (event `{ t: 'bell', floor, n }`); `game.bellAuto = false` holds the automatic ring so the scene director can ring it by hand. Client: `public/bell.js` (toll in `public/audio.js`), banner words in `shared/bell.js`. With `TEST_HOOKS=1`, a player's `{ type: 'test', clear: 1 | 2 }` kills that floor's boss at once (a scripted clear for tests). `node test/bell.js` checks the rules.

## Items

- **Gear:** weapon (+damage), armour (+health, and less damage taken at Rare+), charm (crit, cooldowns or Switch damage). Rarities: Common, Uncommon, Rare, Epic, plus the gold Last Attack item. Weapons are class-specific and come in three **weapon styles** per class (see below).
- **Drops are personal:** every party member nearby rolls their own gold, potions and gear. Alphas always drop Uncommon+; the Warden drops two Rare+ items for everyone who fought.
- **Consumables:** Health Potion (40% health), Battle Tonic (+15% damage, 30 s), Ironbark Draught (−15% damage taken, 30 s). New characters start with 3 potions.
- **Merchant** in town (press F at the stall): buy consumables and Uncommon gear (including a weapon in your class's alternate style), sell items.
- **Keepsakes** (pink): story items handed out by a scene (e.g. *Bram's Buckle*). No stats, a line of text instead; they can be worn but never sold, salvaged, refined, reforged, dropped or deleted.

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

**Admin dashboard** (the lower half of /stats.html, admin accounts only; JSON at `/api/admin/stats?days=7`, cached for a minute): where people die (cause by boss phase, deaths per Warden twist, a Players / Bots / Both switch), where they quit or get stuck (session lengths, level and zone of each player's last session, split into dropped off for 3+ days vs still playing), boss attempts until the first clear per party, class / style / talent picks, and bots vs players (share of boss fighters and deaths, fights by players only / mixed / bots only, bots players add). The extra rows it needs are cheap: one `fight` row per boss fight (`server/trackgame.js`), a `bot_death` per bot death, a `pbot_add` per added bot, and zone / class / style / party on `session_end`. Every query reads `play_events` through its `(kind, at)` index. Test data: `DATABASE_URL=<local db> node scripts/seed-tracking.js` (live bot fights plus two weeks of made-up history); tests: `test/trackstats.js`.

## Combat: posture, Break and Switch

- **Dodge roll** gives a short window of invulnerability; roll through the boss's red circles.
- **Posture:** every enemy has a thin yellow posture bar under its health (nameplate, target frame, boss bar). Every hit fills it in proportion to the damage; heavy hits and combo finishers fill it twice as fast; Break skills (Ground Slam, the Burst Combo finisher) fill about half of it on normal enemies (less on the boss); a Smite that lands while the enemy winds up an attack fills a big chunk and interrupts it. Posture drains slowly after 2.5 s without being hit.
- **Break:** when posture is full the enemy is BROKEN: stunned for a moment (yellow dizzy ring), its wind-up is cancelled, and its posture resets. The Warden can be broken again as soon as its posture refills.
- **Switch:** the first hit from a *teammate* on a broken enemy does 2.5x damage, and follow-up hits do 1.4x. You can't Switch your own Break. Charms of the Switch boost this further.
- **Perfect dodge:** start a roll at most ~0.2 s before a hit lands and it's PERFECT: a brief slow-motion flash, heavy posture damage to the attacker, and for 1.5 s your next hit does +50% damage and double posture damage.
- **Guard and parry (Guardian, R):** hold R to guard: hits from the front (±70°) take 70% less damage, but you can't attack and you move at half speed. Press R at most ~0.2 s before a frontal hit lands to **parry** it: no damage at all, and big posture damage to the attacker. Mashing R doesn't parry.
- **Perilous attacks:** the Warden's **Horn Sweep** shows an orange/gold circle around it with a "!" glint and its own warning horn (about 1.2 s). Anyone inside takes about 80% of their max health: Shield Wall, Taunt, guarding, gear and jumping don't reduce it. Roll through it (i-frames) or parry it. Breaking the Warden during the wind-up cancels it. It comes every ~12 s in phase 1, more often later (never while a Quake Ring is still rolling out near the Warden).
- **Combat text and hit feel:** floating texts on the same character stagger into lanes and repeats merge ("Jumped! ×3"). Your own reactions (Jumped!, Dodged!, PERFECT, PARRY!, COUNTER, Switch, talent/style procs) show only to you; effects on a target (BROKEN, MARKED, PINNED, Discord) show to everyone; other players' damage numbers are small and dim, with only a few on screen at once. When a boss's big hit (Warden slam, charge, Horn Sweep, Quake Ring, rockfall; the Sovereign's trident, geysers, Tidal Wave) lands on you, your screen alone freezes for ~75 ms with a small shake; stomps and Quake Rings shake the camera more the closer they land. Player hits never hit-stop.

## Team combat: combos and the Team Burst

- **Skill combos:** one player sets an enemy up, a *different* player pays it off within 2.5 s (data: `shared/teamplay.js`; server: `server/teamplay.js`). The same combo lands on the same enemy at most once per 5 s.

  | Combo | Setup | Payoff | Effect |
  | --- | --- | --- | --- |
  | **Skewer** | Lancer Sky Lance or Sweep (launch) | any ranged hit (Ranger, Cleric Smite, Bard Sonic Bolt / Dissonance) | ×1.6 damage, extra posture |
  | **Execute** | Guardian Ground Slam or Bash finisher (stun) | Berserker heavy hit, or Swordsman Burst Combo | always a crit, ×1.3, extra posture |
  | **Pin** | Ranger Hunter's Mark (or a heavy arrow on their own mark) | Lancer Thrust or Lance Charge | rooted 1.5 s (a boss is slowed), ×1.2 |
  | **Shatter Chorus** | Bard Discord, 3+ stacks | anyone else's Break | the breaker's party near it heals 12%, the chord bursts for 2.5× the Bard's attack |
  | **Sanctified Switch** | Cleric Sanctuary (standing in it) or Blessing | a Switch | the Broken window lasts 1.5 s longer |

  A partner's setup you can cash in shows "→ Skewer" over the target (only to you). Every combo shows a chain counter over the target for everyone ("Combo ×2 · Skewer", combos within 6 s of each other chain); the two players who made it get a bright flash, a white ring and the combo's name.
- **Team Burst:** a shared bar at the top of the party frames (solo players get their own, filling at half speed). Combos (+8), Switches (+5), Breaks (+4), parries (+4), perfect dodges (+2), revives (+15) and saves (+8) fill it; parties over 3 fill a little slower; it drains when nobody has fought for 6 s. When it's full anyone presses **T** (or taps the bar): a 3 s **sync window** opens and every member who presses T joins (it fires early once everyone's in). The finisher hits your locked target, the boss you're fighting or the nearest enemy you're fighting: each joiner deals 6× their attack × power (2 joiners ×1, 3 ×1.3, 4 ×1.6, 5 ×1.8, 6 ×2), a full posture **BREAK** (a Switch window for everyone), and the team near the starter gets +8–25% damage for 6 s. Solo: no window, ×0.6 power and a posture chunk instead of a Break. Off during a filmed director show.
- **Bots** cash in partners' setups (Lancer charges a marked target, Swordsman bursts and Berserker leaps on a stunned one; capability 1–5: 15–100% notice), join a sync window (35–100%, 0.15–2.8 s late) and start one with a full bar on a boss or elite (a human in the party gets 5 s to start it first).
- **Team stats (for the post-fight card):** `teamStat(p, key, n)` records per-fight counters on the boss fight record (`fight.team` / `fight2.team`: player id → { dmg, heal, tanked, switch, break, combo, setup, burst, parry, perfect, lastAttack, revive, save, cover, flank, mechanic }); `game.teamStats(fight)` reads them.

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
| Lance Charge | **Comet Charge**: 13 m, ends in a posture shockwave (co-op) | **Hit & Run**: 6 m, harder, then you spring back to where you started |
| Sweep (Lancer) | **Cyclone Sweep**: two wide spins (5.5 m), more damage, no stagger | **Hamstring**: frontal half-circle, longer knockdown, 50% slow, more posture (co-op) |
| Sky Lance | **Meteor Lance**: wider (5.5 m), more damage, no Break posture | **Pinning Lance**: lands on one enemy: instant BREAK + rooted (a boss: a huge posture chunk) (co-op) |
| Anthem | **War March**: allies near you +12% damage instead of speed/haste (co-op) | **Lullaby**: enemies within 10 m 35% slower, a Discord stack every 2 s; no ally buff |
| Dissonance | **Shattering Chord**: a narrow 10 m beam, more damage, 2 Discord stacks, no slow (co-op) | **Feedback**: a 5 m blast all around that hurls enemies away and slows them |
| Crescendo | **Grand Finale**: builds in 1.5 s, big damage within 10 m, Breaks at 3+ stacks (bosses 4); no shield/buff (co-op) | **Encore**: 30% shields, +20% damage for 10 s and a 15% heal; no damage or Break |

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
| Ranger | **Longbow** (default) | Arrows from range, every 3rd harder, weak point-blank | — | — |
| | **Crossbow** | Slower (1 s), x1.75 bolts that punch through one extra enemy | Your first bolt on an enemy you haven't hit yet crits | Piercing Shot (and evolutions) draws 40% faster |
| | **Twin Daggers** | Melee instead of the bow: fast 4-hit combo (0.4 s), the 4th a double stab | Dagger hits have a 12% chance to put a 4 s Hunter's Mark on the enemy | Disengage is ready again whenever you kill an enemy |
| Berserker | **Greataxe** (default) | Slow, heavy 3-hit combo, big posture | — | — |
| | **Twin Axes** | Faster (0.55 s), lighter, less posture (only the 3rd swing is heavy) | You build Rage 30% faster | Cleave strikes twice (2nd sweep at 60%) |
| | **Warhammer** | Slowest (1.25 s), every blow heavy with a posture chunk; the 3rd smashes all around you | Breaks you cause last 1 s longer (0.5 s on bosses) | Leap Slam (and evolutions) lands 35% wider |
| Lancer | **Spear** (default) | Thrusts along a 4.6–5.4 m line, +30% at the tip | — | — |
| | **Halberd** | Sweeping arcs (4 m, the 3rd 4.6 m and wide) instead of lines; still +30% at the tip | The hooked blade slows everything you hit by 25% for 2 s (half on bosses) | Sweep radius +30% |
| | **Glaive** | The longest thrusts (5.6–6.4 m), a little slower (0.7 s) | Tip hits (3.4 m+) deal +50% instead of +30% | Lance Charge dashes 12 m (9 m) |
| Bard | **Lyre** (default) | Sonic Bolt: 11 m, a Discord stack per hit | — | — |
| | **War Drum** | Short-range shockwaves all around (3.4 m, the 3rd 4.4 m and interrupts) that add Discord to everything hit | Enemies with 3+ Discord stacks from you take 10% more damage from your whole party | Anthem (and evolutions) plays 40% longer |
| | **Flute** | Quick (0.45 s), long-range (16 m), lighter bolts | Every second bolt that lands adds 2 Discord stacks | Dissonance (and Shattering Chord) cone 50% wider |

- **Getting one:** weapon drops roll a style (the class default half the time, otherwise one of the other two); the merchant sells the default Uncommon weapon plus one in your class's alternate style (Dual Blades, Mace & Shield, Mace & Tome, Crossbow, Twin Axes, Halberd, War Drum); the Smith has a recipe per non-default style (Twinfang Dual Blades, Thornneedle Rapier, Tuskmaul and Hornmaul Mace & Shield, Packpike Spear & Shield, Hymnal Mace & Tome, Resinlight Wand, Tuskbolt Crossbow, Fangpair Twin Daggers, Peltcleaver Twin Axes, Tuskhammer Warhammer, Resinhook Halberd, Fangreach Glaive, Direhide War Drum, Resinsong Flute), shown only to that style's class; the admin editor's *Add item* has a style picker. Names follow the style ("Tempered Dual Blades", "Duskglass Rapier", "Iron Mace & Shield", "Ash Wand", "Galeshot Crossbow", "Galeglass Halberd"). Weapons stay class-locked; refining and reforging keep the style.
- **Server-authoritative:** the server resolves the style from the equipped weapon on every equip/recompute and sends it as the 12th field of each snapshot player row (an index into `STYLE_IDS`, -1 for none), so everyone renders the right weapon. Style skill tweaks apply to the base skills, not to their Mastery 3 evolutions.
- **Visuals:** each style has its own held weapon, animations and hit effects: two swords (the KayKit knight's sword mirrored into the off hand) with crossing arcs; a needle-thin rapier with white thrust lines; a flanged mace with the round shield and an orange shockwave ring; a long spear with the square shield and amber thrust lines; a gold mace with the spellbook and a golden shockwave; the KayKit wand with quick violet bolts. The newer classes: a stocked crossbow with short iron bolts and amber hit bursts; teal-steel twin daggers with crossing slashes; the barbarian's two hatchets with crossing orange arcs; a stone warhammer with dull arcs and a ground-crack ring; a red-trimmed halberd with wide steel arcs; a violet-trimmed glaive with long violet streaks and a crescent at the tip; a frame drum on the arm and a beater with amber sound rings; a wooden flute with small green-gold bolts. The rapier, maces, spear, crossbow, daggers, warhammer, polearms, drum and flute are built from Three.js geometry (`public/styles.js`); the swords, shields, spellbook, wand and hatchets come from the KayKit Adventurers models already in `public/models` (CC0).
- **Code:** data and tuning `shared/styles.js`; server `server/styles.js` (mixed into Game; game.js reads the skill tweaks through `styleNum`); client `public/styles.js`. The newer classes keep their basic attacks in `server/classes-a.js` / `classes-b.js`: a style either brings its own combo steps (Twin Daggers, Halberd, War Drum: the class hands slot 0 to `styleSkill`) or tunes the class attack through `styleNum` overrides (`arrow`, `chop`, `thrust`, `bolt`, `basicCd`), so Rage, the Lancer's tip bonus and Discord keep working. Tests: `node test/styles.js`, `node test/newclass.js` (add `DATABASE_URL=... PORT=3583` / `PORT=3652` for the save/load round trips).
- **Bots:** a bot reads its style from its own snapshot row and fights at that style's range (`shared/bots/style.js` derives the reach, tip bonus and shape from the style data): a Twin Daggers Ranger goes into melee, a War Drum Bard stands inside its shockwave, a Glaive Lancer holds its tip, a Flute Bard shoots from further out, a Mace & Tome Cleric joins the melee. `STATS=1 ROLES=guardian,ranger,bard,cleric START_STYLE=daggers,drum node test/wardenskill.js` prints each bot's damage and how many styled swings landed.
- **Testing aids:** `START_STYLE=<id>` (`sword`, `dual`, `rapier`, `shield`, `mace`, `spear`, `staff`, `tome`, `wand`, `longbow`, `crossbow`, `daggers`, `greataxe`, `twinaxes`, `warhammer`, `lance`, `halberd`, `glaive`, `lyre`, `drum`, `flute`) equips that style's weapon on everyone of that class who joins (a comma list arms each class with the first of its own styles listed: `START_STYLE=daggers,drum`); `START_STYLE=random` a random style for everyone. `BOT_STYLES=1` gives every anonymous player (bots included: `test/team.js` and the admin page's server bots) a random style:

```bash
BOT_STYLES=1 START_LEVEL=10 SPAWN_AT=0,150 npm start
node test/team.js
```
## Talent tree

Every level from 2 gives a **talent point** (19 at level 20). Spend them in your class's tree: press **K** (or the Skills button; F at a Skill Shrine) to open the **Skill Tree** window. It has three panes:

- **Progression:** levels 1–20 on a track with what each one brings (skills, talent points, when each tier can open, the Raid Gate, the Warden and Floor 2, the Sovereign), your level and XP, and the class's growth. Click a level for its details.
- **Talents:** the class's three branches as a star chart. Hover a node for its exact numbers now and at the next rank; click to learn it (anywhere); right-click to refund a rank. **Respec** (refund everything) and refunds are free but only at a **Skill Shrine** in town, like changing an evolution.
- **Abilities:** each skill's unlock level, mastery and progress, both evolutions (pick or switch them here) and every talent that changes it, with its current cooldown.

Rules: each branch has 5 tiers; a tier opens after 0 / 3 / 6 / 10 / 14 points in the tiers above it. A line means a node needs a point in a node it hangs from. Nodes have 1–3 ranks. The diamond at the bottom of each branch is its **keystone**, which changes how you play. A gold badge on the Skills button counts unspent points, and the first point shows a one-time tip.

| Class | Branch | Theme | Keystone |
| --- | --- | --- | --- |
| Swordsman | Blade | damage, crits, finishers | **Executioner**: +35% damage to enemies below 35% health; every kill resets Rush |
| | Tempo | dodges, speed, cooldowns, counters | **Flowing Blade**: each roll takes 1 s off your cooldowns; a perfect dodge resets Rush and Whirl |
| | Link | Switch damage, set-ups, party buffs | **Relay Strike** (co-op): landing a Switch gives you and allies within 12 m +15% damage for 6 s and resets Burst Combo |
| Guardian | Bulwark | guard, parry, damage reduction | **Unbreakable**: a parry heals 10% and strikes back for 2x attack (Shield Riposte above it: parries open a counter window) |
| | Warlord | threat, taunts, posture | **Juggernaut**: Taunt fills 25% posture of everything it taunts; +40% posture on enemies attacking you |
| | Vanguard | shield-bash offense, protecting allies, Switch set-ups | **Rallying Bash** (co-op): the Bash finisher stuns and fills posture; your Breaks shield allies within 10 m (10% health) |
| Cleric | Mercy | healing and shields | **Overflow**: overhealing becomes a shield (up to 25% health) |
| | Judgement | Smite, damage, interrupts | **Wrath**: Smite pierces everything in a 14 m line |
| | Grace | buffs, party support, cleansing | **Guardian Spirit** (co-op): once a minute an ally within 15 m who would die is saved at 30% health; Cleansing Light makes Blessing purify |
| Ranger | Marksman | charged shots, piercing, crits, range | **Dead Shot**: Piercing Shot (and evolutions) always crits; crits from your other arrows take 1 s off it (Longshot above it: +10%/rank beyond 12 m) |
| | Trapper | traps, slows, control | **Minefield**: caltrops and snares explode when they spring or run out (1.5x attack + a posture chunk); Pinning Arrow: the 3rd arrow slows |
| | Pack Hunter | Hunter's Mark, party bonuses, Switch | **Pack Leader** (co-op): a Switch on your mark refreshes it, readies Piercing Shot and gives everyone within 12 m +10% damage for 5 s (Deep Mark: mark +5%/rank) |
| Berserker | Carnage | Rage damage, cleaves, executions | **Massacre**: kills give 15 Rage and reset Cleave; Cleave +30% on enemies below 35% (Fury: +10% Rage/rank; Red Mist: up to +8%/rank damage at full Rage) |
| | Bloodlust | lifesteal, sustain, Bloodrage | **Sanguine Frenzy**: kills extend Bloodrage/Frenzy by 1.5 s, +25% posture while it's on, heal 15% when it ends (Leech 2%/rank; Second Wind: -6%/rank damage below 35%) |
| | Warcry | posture, staggers, team-ups | **Warcry** (co-op): your Breaks give you and allies within 12 m +12% damage for 6 s and ready Leap Slam (every 8 s at most) |
| Lancer | Dragoon | Sky Lance, aerial strikes, posture | **Dragoon**: tip thrusts take 0.5 s off Sky Lance; Sky Lance (and evolutions) +40% posture (Honed Tip: tip +10%/rank) |
| | Skirmisher | Lance Charge, mobility, reach | **Hit and Fade**: rolls take 1.5 s off Lance Charge, a perfect dodge resets it; the first thrust within 3 s of a charge +40% |
| | Phalanx | Sweep, control, protecting allies, Switch | **Phalanx** (co-op): Sweep (and evolutions) shields allies within 8 m (12% health, 5 s) and turns what it hits on you |
| Bard | Maestro | song duration and strength, Anthem | **Maestro**: basic hits that land extend your song 0.5 s (up to +6 s); allies under your song +8% damage (Resonant Voice: songs +5%/rank; Soothing Song: 1%/rank health per second) |
| | Discord | Discord stacks, debuffs, Breaks | **Cacophony**: basic hits spread a Discord stack to enemies within 3 m; Crescendo / Grand Finale need one stack fewer to Break (Lingering Discord +1.5 s/rank; Resonance +2%/rank damage per stack) |
| | Harmony | shields, party sustain, haste | **Symphony** (co-op): an ally landing a Switch within 12 m gets an 8% shield and your Crescendo recharges 2 s (Bulwark Chord: Crescendo's shield +5%/rank) |

Other nodes give stats (attack, health, crit, cooldown speed, damage reduction, Switch damage, posture damage, healing, move speed, dodge cooldown, counter damage, threat, guard block, damage to Broken enemies), per-skill changes (cooldown, damage, finisher, radius, duration for skills 1–3 and the basic attack) and party auras (allies within 12 m deal more, take less, or Switch harder).

Talents are saved with the character (a `talents` JSONB column, `{ nodeId: rank }`); anonymous players keep them until they leave. Lowering a character's level below the points it has spent (admin) refunds them. The bot party spends along a role path (tank: Bulwark, DPS: Blade, healer: Mercy; Ranger: Marksman, Berserker: Carnage, Lancer: Dragoon, Bard: Harmony). The admin editor has a Talents section and the raw JSON editor includes them.

**Adding a class or changing a tree is data only:** add an entry to `TREES` in `shared/talents.js` (branches → nodes with `tier`, `x`, `max`, `req`, `fx`, optional `touches` for the Abilities pane, plus a `bot` path); a class without an entry just shows "no talent tree yet". Effect kinds are listed at the top of that file; keystones are `{ key }` rules in `server/talents.js`. The server applies everything (hooks in `recompute`, `addPosture`, `damagePlayer` and `addPlayer`, plus wrappers around `useSkill`, `skillCd`, `damageMob`, `healPlayer`, `hitCircle`/`hitArc`, `dodge`, `evadeHit`, `guardHit`, `breakMob`, `killMob` and `giveXp`, installed last in `game.js`). The newer classes' keystones sit in their own section of `server/talents.js` (wrappers around their class methods: `fireArrowA`/`arrowHitA`, `markA`, `gainRageA`, `updateTrapsA`, `startSong`/`songTick`, `addDiscord`, `crescBurst`, ...); `schedule` is wrapped too, so a delayed hit (Rain of Arrows, Leap Slam, Sky Lance's landing, Crescendo) keeps the skill that queued it and its per-skill damage / radius talents, and arrows and sonic bolts count as the basic attack. The window is `public/talents.js`. Tests: `node test/talents.js` (add `DATABASE_URL=...` for the save/load round trip), `node test/newclass.js` (the newer classes' trees and styles).

## Classes

| Class | Role | Skills |
| --- | --- | --- |
| Swordsman | Damage | Slash, Rush (dash strike), Whirl (spin), Burst Combo (Lv 3) |
| Guardian | Tank | Bash, Taunt, Shield Wall, Ground Slam (Lv 3, stuns) |
| Cleric | Healer | Smite (ranged), Heal, Blessing (+25% damage), Sanctuary (Lv 3) |
| Lancer | Damage | Thrust (3-hit spear combo along a 4.6 m line; +30% near the tip of your reach), Lance Charge (9 m dash through a line, stops short of walls and trees), Sweep (trips everything within 4.5 m: stagger + posture), Sky Lance (Lv 3: leap onto a spot up to 10 m away, marked for allies; airborne in flight; Breaks) |
| Bard | Support | Sonic Bolt (11 m projectile; each hit adds a Discord stack, max 5: +10% posture damage per stack), Anthem (8 s aura: you and allies within 12 m move 20% faster, attack 20% faster, skills recharge 15% faster), Dissonance (7 m cone: slows 40% for 4 s and INTERRUPTS wind-ups), Crescendo (Lv 3: builds 3 s, then allies get a 20% shield and +15% damage for 6 s, shown as *♪ Crescendo* / *♫ Crescendo shield* under your health, and enemies within 8 m with 3+ Discord (bosses 5) are BROKEN) |
| Ranger | Damage | Shot (bow; real arrows, every 3rd hits harder, weak point-blank), Piercing Shot (charged, pierces a line, big posture), Disengage (leap back + slowing caltrops), Hunter's Mark (Lv 3; party +15% damage, Switches +30% on the target) |
| Berserker | Damage | Axe Chop (heavy 2H combo, big posture), Cleave (wide arc, up to 2x at full Rage), Leap Slam (telegraphed landing, stagger), Bloodrage (Lv 3; spends Rage + 10% health: lifesteal, faster swings, cuts through wind-ups) |

**Rage** (Berserker): 0-100, built by dealing and taking damage, drains after 4 s out of combat; shown as a red bar under your health, in party frames and on nameplates. The Berserker has no guard and takes 10% more damage. Each Ranger / Berserker skill has two evolutions like the others (Rain of Arrows / Sniper Shot, Snare Trap / Tumble Volley, Pack Hunter / Deadeye; Whirling Axe / Executioner, Earthshatter / Pounce, Frenzy / Warblood). Data and tuning: `shared/classes/ranger.js`, `shared/classes/berserker.js`; server `server/classes-a.js`; client `public/classes-a.js`; bot brains `shared/classes/bots-a.js`; tests `node test/classes-a.js`.

## Project layout

```
shared/data.js   classes, skills, mobs, map, collision — used by server AND client
shared/floor2.js Floor 2: map, waystones, enemies, Sovereign tuning (appended into data.js)
server/floor2.js Floor 2 AI (Shieldback, Wisp, Lurker, Matron, Sovereign), Sunken Gate, waystones/Stairway
public/floor2world.js, public/floor2client.js  Floor 2 scene, models, effects, waystone UI
server/game.js   authoritative simulation: combat, AI, boss, XP, parties
server/combat.js posture/Break, perfect dodge, guard/parry, Horn Sweep, Quake Rings (mixed into Game)
server/poses.js  kneel / sit / bow: setPose, /kneel /sit /bow /stand chat, cleared by moving or acting (public/poses.js on the client)
server/teamplay.js  skill combos between players, the Team Burst gauge and sync window, teamStat() per-fight counters (tables: shared/teamplay.js; client: public/teamplay.js; bots: shared/bots/teamplay.js)
server/index.js  static file server + WebSocket server (20 ticks/sec)
server/shutdown.js  deploy drain on SIGTERM: "Update incoming", waits out a boss fight (4 min max), saves, exits
public/          Three.js client (no build step): main.js, world.js, style.css
public/models/   rigged character models (glTF) with shared animations
test/bots.js     headless bot players for load/gameplay testing
test/combat.js   in-process checks for posture, perfect dodge, guard/parry and the Horn Sweep (node test/combat.js)
test/bubbles.js  speech bubble logic: duration, one per speaker, who sees which line (public/bubbles.js)
test/teamplay.js  combos (each trigger, timeout, chain), Team Burst gauge fill/drain, sync window joining and scaling, team stats
test/feeltext.js in-process checks for who sees combat text (`to` tags on reactions) and which boss hits hit-stop their victim
test/warden3.js  in-process checks for the Quake Ring (jump / roll / out of reach), Warden scaling and bot jump timing per capability
test/aircontrol.js  jump air control: the shared air step, client prediction vs the server's movement check while airborne, bots steering mid-jump
shared/bots/     one brain per bot: brain.js (decision loop, party teamwork, orders), motor.js (moving, dodging), registry.js (per-class plug-ins), classes.js (Guardian, Swordsman, Cleric), social.js (orders, /b chat parsing, chatter)
shared/teambots.js  startTeam(): a few bots in one party; used by test/team.js, public/bots.html and server/botmanager.js
public/botwheel.js  the bot command wheel (V)
shared/mastery.js, server/mastery.js, public/mastery.js  skill mastery and evolutions; test/evolve.js
shared/classes/   Lancer and Bard data, tuning, evolutions (lancer.js, bard.js) and bot brains (bots-b.js)
server/classes-b.js, public/classes-b.js  Lancer / Bard skills (mixed into Game) and their rigs + visuals; test/classes-b.js
shared/styles.js, server/styles.js, public/styles.js  weapon styles; test/styles.js, test/newclass.js (newer classes)
shared/talents.js, server/talents.js, public/talents.js  talent trees and the Skill Tree window; test/talents.js
server/director.js, server/director-sheet.js  the scene director (filming): plays a YAML cue sheet with bot actors (format: docs/SCRIPT_BRIEF.md); routes in server/director-admin.js, the admin page's Director tab public/admin-director.js, the bots' script layer shared/bots/script.js; test/director.js
server/staging.js  staging hooks for the scene director (filming): forceBossMove, reserveLastAttack, scriptDeath/scriptRevive, protect, setTwistOverride, spawnMob, giveKeepsake, clearStaging; test/staging.js
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

Open **/admin.html** in the browser where you play (it uses the game's saved session). It needs accounts (`DATABASE_URL`); the one exception is the **Director** tab (scene director, see Testing), which a server without a database serves to localhost.

**Becoming an admin**, either way:

- Set the flag in the database: `UPDATE accounts SET is_admin = true WHERE id = <your account id>;` (the admin page shows your account id when you're not an admin yet; for a Discord account you can match on `discord_id`).
- Or list Discord user ids in `ADMIN_DISCORD_IDS` (comma-separated), e.g. `ADMIN_DISCORD_IDS=123456789012345678,234567890123456789`. Those accounts are admins while the variable is set.

Every `/api/admin/*` route checks that the session belongs to an admin (401 signed out, 403 otherwise). Nothing admin-only goes over the game WebSocket.

A summary strip sits on top: players online (signed in / anonymous), bots running, server uptime, the current Warden twist, and the latest floor clears (time, party, deaths). Successes and errors show as toasts.

The page has three tabs:

- **Bots:** bots that run inside the server (no browser tab needed), shown as cards with class-colour accents. **Presets** add common setups in one click: *Party of 3 for me* (a Guardian, Swordsman and Cleric that follow your online character at its level), *Warden test team* (Lv 10, straight to the Warden), *Field farmers* (one of each class, Lv 3), *Novice crowd* (four Lv 1 newcomers at capability 1-2). Or add one bot (class, optional name, starting level, **capability**, behaviour: *follow* an online player, fighting alongside them in their party; *farm the field* near town; *go fight the Warden*; *Floor 2*; or *level up, then the Warden*), or a whole team (three bots, one per role, put into one party: each still has its own brain). Bots are anonymous (never saved), marked as bots in the roster (BOT tag in the game), left out of play tracking (except their deaths, kept apart as `bot_death`, and the boss fights they are in), and capped at 30 (`MAX_BOTS`). A follower that falls far behind (or is on another floor) appears next to its player.
  - **Edit live** on each card: rename (click the name, Enter; names are unique), level stepper (stats recomputed, healed to full), capability 1-5, behaviour and follow target (only that bot: every bot has its own brain). Each card shows the bot's role, current goal (*Following Natan*, *Fighting The Horned Warden with Brann*, *Waiting at the raid gate*…), the order it is on and its party. Actions: **⌘ Order…** (follow / regroup on a player, hold here, ready up, use a potion, go farm, do the boss, status, leave party: the same orders a party gives), **Heal** to full, **Kill** (stays down until **Revive**d), **Teleport** to town, the Warden gate or any player, **Respawn as…** another class (the same bot, re-made as that class: same bot id, name, level, capability, behaviour, party and current order; a player's bot stays theirs, in their party, on the same slot), Remove (a player's bot: they're told and the slot is freed). *Remove all* clears them.
  - **Bots are linked to the party they serve; no admin action leaves one detached.** A behaviour edit keeps the bot in its party (with a player in it, it also gets the matching order: *farm the field* → go farm, *Warden* → do the boss, *follow* → follow); following a player outside its party moves it straight into theirs (refused if that party is full, or if the bot is a player's, which also level with their player, so their level can't be edited). Cards of player-added bots say who added them.
  - **Capability levels** (`shared/botskill.js`, default 4) make bots play like people of different skill, for boss tuning and for a livelier world. The bot brain stays the same; capability adds reaction delays to everything it *sees* (telegraphs, charge lanes, Tidal Waves, Quake Rings, the Horn Sweep, a teammate's Break), misjudged or missed dodges, Horn Sweep roll/parry and Quake Ring jump timing error, slower skill rotations, a minimum gap between presses, positioning error in fights, a lower potion threshold (and forgetting potions), and missing Switch windows:

    | Level | Name | Reaction | Misjudged telegraphs (half missed outright) | Horn Sweep perfect / safe | Quake Ring cleared | Skills pressed after | Notes |
    |---|---|---|---|---|---|---|---|
    | 5 | Perfect | instant | 0% | 100% / 100% | 100% | at once | the classic bots |
    | 4 | Skilled | 0.15-0.25 s | 10% | ~46% / ~92% | ~86% | 0.1-0.5 s | good rotations, potions at 35% |
    | 3 | Average | 0.25-0.38 s | 25% | ~22% / ~80% | ~60% | 0.5-1.5 s | ±1.4 m positioning, forgets potions 20% of the time, misses 40% of Switches |
    | 2 | Casual | 0.38-0.52 s | 45% | ~12% / ~60% | ~33% | 1.2-3 s | potions at 20%, rarely Switches |
    | 1 | Novice | 0.6-0.85 s | 70% | ~6% / ~31% | ~12% | 2.5-6 s | mashes the basic attack, ±3 m positioning, stands in fire |

    Test runners take it too: `BOT_SKILL=3 node test/team.js`, and `BOT_SKILL=3 RUNS=2 node test/wardenskill.js` (its own server, Lv 10 party at the raid gate; prints kill/wipe, fight time, deaths and Quake Rings jumped / rolled / hit per run; `ROLES=guardian,ranger,berserker,lancer,bard,cleric` for a full party).
- **Players:** every saved character merged with the live game: class (icon and colour), level, account (Discord name or `guest #id`), online/offline, current floor and area, last seen and created. Search, filter by status, class and level range, and sort (click a column).
- **Edit** (click a character), in sections with a jump bar and a sticky *Save changes* bar: level and XP, gold, consumables, materials, equipped and bag items (remove, equip, add any slot/rarity/class, add the Last Attack items), titles earned and worn, lifetime stats, skill mastery (level/points and evolution branch per skill), the Floor 2 unlock, rename, class change (offline only; a weapon for the old class goes back to the bag), delete (type the name to confirm), and an **Advanced: raw JSON** editor for the stored inventory, stats and mastery (validated; unknown stats keys are kept). If the character is online, the edit is applied to the live player straight away (they get "An admin updated your character") and saved.

Bot API (admin only): `GET/POST/DELETE /api/admin/bots`, `POST /api/admin/bots/team` (both take `skill` 1-5), `PATCH /api/admin/bots/:bid` (`name`, `lvl`, `skill`, `behaviour`, `follow`), `POST /api/admin/bots/:bid/{teleport|kill|revive|heal|respawn|command}` (`teleport`: `{ to: 'town' | 'gate' | 'player', name }`; `respawn`: `{ cls }`; `command`: `{ cmd, name }`, an order as below, `name` the player for follow / come / heal), `DELETE /api/admin/bots/:bid`; `GET /api/admin/summary` for the strip.

The in-game **Players** panel (P) has two tabs: **Players** (real players online, and characters seen in the last 30 days: `GET /api/lobby`, name, class, level, last seen, no account details) and **Bots** (see [Bots in game](#bots-in-game)).

Code: `server/admin.js` (routes), `server/botmanager.js` (bots; brains in `shared/bots/`), `server/botedit.js` (live bot edits and actions), `shared/botskill.js` (capability levels), `public/admin.html` + `public/admin.js`. Tests: `DATABASE_URL=... node test/admin.js` (own server on port 3572), `DATABASE_URL=... node test/adminbots.js` (bot edits/actions, port 3624), `node test/botskill.js` (capability profile), `DATABASE_URL=... node test/botbrain.js` (party teamwork, `/b` orders and respawn in a party, port 3632).

### Bots: one brain each, party teamwork, orders

Every bot (admin page, `/bots.html`, `test/team.js`) is its own connection with its **own brain** (`shared/bots/brain.js`): its own role from its class (tank / DPS / healer / support), behaviour, capability level and goal, decided on every snapshot. There is no shared team brain: *Add team* just adds three bots and puts them into one party, and editing one bot never changes another.

Teamwork comes from the party as each bot sees it, **real players included**:

- **Cohesion:** a bot sticks with its party's leader: a human in the party (the one who last gave an order, else the first), otherwise the party's tank bot (else the first bot). Followers fan out behind the leader, sprint to catch up, drop a fight more than 24 m from the leader (never a boss fight) and regroup after deaths; a bot leader waits for bots that fell behind. At the raid gate they wait until the whole party is there, then ready up (with a human in the party: once someone has readied, or when told to). A bot far behind its human (or on another floor) appears next to them.
- **Assist:** bots fight what the party fights: whatever is attacking a party member, what the leader or a human is hitting, the target a human has **locked** (the client reports it to the server, which tells the party), Broken enemies (Switch on anyone's Break, humans' included), marked enemies, the Thorn Totem in the Warden fight. They don't pull extra packs on their own.
- **Roles:** the tank taunts whatever is on a non-tank and keeps threat (Ground Slam to Break, Bash to Switch); the healer heals the most hurt party member (a "heal me" first) from behind the tank, interrupts with Smite, blesses once the fight is on; DPS wait for the tank to hold the target, flank it and Switch in.
- **Social (scripted, rate-limited, party chat only; say chat when not in a party):** greetings on joining a human's party ("Hey! Lyra here, I'll keep you alive."), call-outs (pulling the Warden, low HP, out of potions, Breaks, "Nice Switch!"), thanks for heals, wipes, boss kills, level-ups and grats. Lower capability bots chat less. Bots accept party invites from players (not when already partied with someone else) and form their own parties.

**Orders.** Party members order the bots in their party (admins: any bot, by name) with **`/b` chat orders** or the **command wheel**: hold **V** (or press *⌘ Bot orders* under the party frames), point at an order and release V, or click it; the chips under the wheel pick all bots or one. Only lines starting with `/b` (or `/bot`, `/bots`) are orders: **ordinary chat never orders bots**. `/b <order>` orders every bot in your party, `/b <name>: <order>` (or `/b <name> <order>`) one bot; a unique start of the name is enough (`/b ly: heal`). `/b help` lists the orders; a `/b` line is never shown as chat (you get a short confirmation, the bots answer in party chat). Parsing: `parseBotChat` in `shared/bots/social.js`; the server turns the line into the same `botcmd` event as the wheel (`server/game.js` `botChat`).

| Order | `/b` words | What the bot does |
|---|---|---|
| follow | follow, f | follows you (and fights with you) |
| stay | stay, hold, wait, stop | holds its spot, fights only what comes to it |
| come | come, regroup, rally | runs to you, then follows |
| attack | attack, kill, focus | attacks the target you have locked (Tab) |
| heal | heal | healers keep you topped up for 45 s (others say they can't) |
| farm | farm, grind | farms the field (the tank leads the bots told) |
| boss | boss, warden, sovereign | heads to the Warden, waits for the party at the gate, readies |
| ready | ready | readies at the raid gate |
| potion | potion, pot, drink | drinks a potion (or says it's out) |
| leave | leave, dismiss | leaves the party (a bot a player added goes home: it's dismissed) |
| status | status, report | answers with HP, level, potions and what it is doing |

Chat channels: plain text goes to everyone, `/p text` to your party, `/s text` to players within 40 m. `/kneel`, `/sit`, `/bow` and `/stand` set a pose instead (never shown as chat).

**Poses** (`server/poses.js`, `public/poses.js`): `setPose(p, 'kneel' | 'sit' | 'bow' | null)` stores `p.pose` and sends `{ t: 'pose', id, k }`; every snapshot lists held poses as `w.poses = [[id, k], ...]` (left out when nobody is posed; the player rows are unchanged), so late joiners and spectators see them. Moving, a used skill or attack, a dodge, a jump, guarding, a teleport or death clears the pose. The client eases the rig into a procedural pose over 0.4 s (bone rotations layered over the plain Idle clip, `POSES` in `public/world.js`, like the Warden's wind-ups) and drops it the moment your own character moves.

**Speech bubbles** (`public/bubbles.js`): every chat line also pops up over the speaker's head, bots' chatter included, to whoever would see it in the log (say within 40 m, party chat to the party, global to everyone; spectators see all of it; `/b` orders never). A rounded panel above the nameplate (max ~260 px, word-wrapped), it fades in, holds ≈ 1.6 s + 0.07 s per character (2–5 s; a `hold` in seconds on the chat event wins, for the scene director), and fades out; a new line from the same speaker replaces the old one. Hidden when the speaker is off screen, a little smaller far away. Settings → Speech bubbles turns them off (the chat log still has everything). Test: `node test/bubbles.js`.

**Class plug-ins** (`shared/bots/registry.js`): a class's bot logic is `registerClassBrain(cls, { role, name, parry, combat(b, tgt, ctx), idle(b, ctx), onEvent(b, e), onLevel(b, lvl, ctx) })`; the brain handles perception, dodging, party, targets, orders and chatter, the plug-in only plays its kit against the target it is given (`ctx`: `useSkill`, `moveToward`, `switchOpen`, `dodge`, `ready`, `anchor`, `tank`, `hurt`, `healFocus`, `party`, `say`...). Systems that run on level-up (talents, weapon styles) hook in with `registerBotHook('onLevel', (b, lvl, ctx) => ...)`.

## Bots in game

Players can add their own bots from the **Players** panel (P) → **Bots** tab, no admin page needed:

- **The list** shows every bot in the world, your own first: name (class colour), level, class, skill level, owner (or *server bot* for admin-added ones), party, area and what it's doing (*Following Ann*, *Farming the field*, *Heading for the Warden*, *Holding position*, *Down*, *Waiting for Ann (42 s)*). Your bots also show their gear and mastery. The header reads **Your bots (n/3)** and how many bots the server runs.
- **Add a bot:** pick a setup (one per class, labelled by role: *Tank · Guardian*, *Healer · Cleric*, *Damage · Swordsman*, and any class added later), a skill level 1-5 (*Novice, Casual, Average, Skilled, Perfect*; default 4, see the capability table above) and optionally a name. The bot joins **at your level**, with a **premade loadout**, **joins your party** (one is made if you have none) and **follows you**.
- **Your bots:** change the skill level, the behaviour (*Follow me*, *Farm nearby*, *Go to the Warden*, *Stay here*: holds its ground and fights what comes close), **Rename**, **Dismiss** (click twice). Admins (`accounts.is_admin` / `ADMIN_DISCORD_IDS`) can manage any bot from this tab.
- **They level with you:** a bot gets no XP of its own; when it joins and whenever you level up it takes your level and that level's premade gear, mastery and talents (table below).
- **Limits:** up to 3 bots per player (`PLAYER_BOT_MAX`), counted against the server's `MAX_BOTS` (30); not past a full party (6). Anonymous players can add bots too, with the same limits. Bots stay in your party: when you join another party they follow you into it (if there's room); leaving the party yourself is respected. A bot that leaves your party (`/b <name>: leave`) goes home (dismissed, the slot is freed). An admin's *Respawn as…* keeps your bot yours, in your party, with its orders; if an admin removes it you're told.
- **When you leave**, your bots wait `PLAYER_BOT_GRACE` seconds (60) for you to come back (same character, or the same name for an anonymous player), then they're removed.

Premade loadout by level (gear: class weapon, armour, and a charm for the role: *Haste* for tanks and healers, *Keenness* (crit) for damage; mid-roll stats):

| Level | Gear | Skill mastery |
|---|---|---|
| 1-4 | Common | 1 |
| 5 | Uncommon | 1 |
| 6-9 | Uncommon | 2 (-10% cooldowns) |
| 10-14 | Rare | 3, evolved |
| 15-17 | Epic | 3, evolved |
| 18-20 | Epic | 4 (+10% effect) |

Evolutions picked for how bots play: Shoulder Charge, Vortex, Finisher; War Cry, Iron Skin, Quake; Renew, Zeal, Haven (other skills: their co-op branch). Talents: the bot spends its points along its class's `bot` path (`shared/talents.js`), re-checked on every level change (`BotManager.setLevel`).

Protocol (WebSocket, validated server-side: ownership, limits, class, skill, name, behaviour; 10 orders per 5 s):

```
→ { type: 'pbot', op: 'list' }
→ { type: 'pbot', op: 'add', cls, skill?, name? }
→ { type: 'pbot', op: 'edit', bid, skill?, mode?: 'follow' | 'field' | 'warden' | 'stay', name? }
→ { type: 'pbot', op: 'dismiss', bid }
← { type: 'pbot', op, ok, msg | error, list: { bots: [...], mine, max, total, cap, admin, partyMax } }
```

Roster entries of owned bots carry `owner` (name) and `mode`. Code: `server/playerbots.js` (on top of `BotManager`'s add / edit / remove), `shared/playerbots.js` (setups, behaviours, loadout table), `public/playerbots.js` (tabs and the Bots tab). Test: `node test/playerbots.js` (own server on port 3641; level sync, `/b` leave; with `DATABASE_URL` it also checks admin access and that admin respawn / edit / remove keep a player's bot linked to its party).

### AI companions (optional, off by default)

An LLM "mind" can sit on top of a bot's rule-based brain.
- **What it does:** party bots answer when you **name them in chat** ("Rook, hang back and heal me when I'm low") and make the odd call-out.
- **Intents only:** the model returns one structured intent (a chat line, an order, a stance, a focus player, a memory). The brain still does all the moving and fighting.
- **Off by default:** it's off unless `AI_PROVIDER` (`anthropic`, `openai`, `gemini` or `mock`) and that provider's key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`) are set in the environment. Then an admin turns it on from **/admin.html → Bots → AI companions**, or it starts on with `AI_ENABLED=1`.
- **Off means unchanged:** when it's off, bots behave exactly as before.
- **Caps:** per-bot and global caps (calls, tokens, a daily `$` cap `AI_DAILY_USD`), timeouts and an error breaker keep cost and failures contained. If the model is unavailable, the bot just plays on.
- **More:** models, prices, costs per hour and the Render setup are in `docs/research/ai-companions.md`.
- **Code and test:** code in `server/ai/` (adapters in `server/ai/providers/`), the admin card is `public/admin-ai.js`, and the test is `node test/ai-mind.js` (mock provider and fake HTTP, no keys).

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
node test/team.js                           # Brann (tank), Kael (DPS), Lyra (healer): three bots, one party
# open http://localhost:3000/?spectate=1
```

**On any server (including the live one):** open `/bots.html` to add bot parties from your browser (`/bots.html?teams=2` for two), then watch at `/?spectate=1` or play alongside them. Keep the bots tab open.

`?spectate=1` works on any server: it watches without joining and frames the whole group.

**Film view** (`/?spectate=1&film=1`, for the Season 1 episodes, `docs/story/`): a spectator whose camera obeys the scene director. The server keeps a picture state, `game.cine(op, data)` (`server/cine.js`, client `public/cine.js`), and sends it to anyone who joins mid-take:
- `shot` `{ shot, target, from, secs }`: `close_up` (~3 m, head and shoulders), `medium` (~6 m), `wide` (~16 m, high), `over_shoulder` (behind `from`, looking at `target`), `follow` (behind and above), `orbit` (slow circle), `crane` (rises and pulls back over ~7 s), `free` (back to the auto framing), `pov` (that character's own game camera, behind and above, turning with them) and `eyes` (first person). Targets: `{ pid }` a player, `{ mid }` a mob, `{ x, z }` a point. `secs` is how long the camera takes to get there (0 = cut); the shot holds until the next one. Giants (the Warden) get a wider frame. The framing keeps a clear line of sight: it moves around walls and bodies, widens until the subject fits, frames a fighter together with the boss they face (side-on or behind the shoulder), and looks down at a fallen subject.
- **POV views** (F8): `/?spectate=1&pov=<name>` rides one character's own game camera; add `&eyes=1` for first person. It ignores the director's shots but gets the rest of the picture (light, fades, titles, letterbox, clean feed); when the character goes down the camera rises above them. The admin Director lists a link per cast member, for a multi-camera take.
- `slowmo` `{ secs, scale }`, `title` `{ text, sub, secs }`, `fade` `{ to: 'black' | 'in', secs }`, `letterbox` `{ on }` (2.39:1 bars), `clean` `{ on }` (hides the HUD, chat, skill bar, party frames and head markers; keeps nameplates, health bars, bubbles and banners), `light` `{ light: 'eclipse' | 'day' | null }` (the Eclipse darkness everywhere, forced daylight, or back to normal), `reset`.
- Plain spectators ignore shots, letterbox and clean, but get light, titles, fades and slow motion. Players only get the light.

**Scene director** (`server/director.js`, filming the Season 1 episodes): plays a cue sheet (YAML, format v1 in `docs/SCRIPT_BRIEF.md`; Episode 1 is `docs/story/ep1-first-line.yaml`) with bot actors inside the server.
- **Actors:** each cast member is a server bot with its exact name, class, level, weapon style and capability, all in one party, with premade gear for its level and no XP. A script layer on the bot brain (`b.script`, `shared/bots/script.js`) makes them stand, walk, run, face, follow and talk on cue; a `fight` cue hands them back to their normal brain, focused on the target (they still dodge and heal). They never wander, chatter on their own or ready up unless told.
- **Cues:** a cue starts together with the previous one, `after: prev` when it finishes, `after: <id>` when that cue finishes, plus `delay`; `until` conditions (`warden_hp < 66%`, `warden_dead`, `warden_broken`, `gate_open`, `t > 10`). Verbs cover movement, combat, speech (bubbles), emotes, poses, scripted deaths, staging (`server/staging.js`), the camera (`server/cine.js`) and the bell.
- **Safety for takes:** while a show runs, actors can't drop below 10% health unless a cue kills them, the automatic first-clear bell is held, twists follow the sheet; Stop (or an error) removes the actors and resets staging, poses and the picture.
- **Admin page → Director:** pick a sheet from `docs/story/*.yaml` or paste one, Validate (every problem with its scene and cue), Run (from any scene), Stop, live status. A server without a database (the filming setup) shows only this tab, from localhost. How to film: `docs/story/FILMING.md`.
- **Test:** `node test/director.js` (sheet validation, timing rules, a short in-process show); `FULL=1 node test/director.js` plays Episode 1 end to end on its own server (port 3712, about 4 min).

Other testing aids: `SPAWN_AT=0,172` spawns players at the chamber gate. `TEST_HOOKS=1` lets a client set its own health (`{ type: 'test', hurt: 0.4 }`, for test/botbrain.js) or gain XP (`{ type: 'test', xp: 850 }`, for the bot level sync in test/playerbots.js and test/shutdown.js). `WARDEN_TWIST=<id>` forces a Warden twist (see above). `MAX_PLAYERS` caps the server (default 64).

Floor 2: `SPAWN_AT=600,150` spawns at the Sunken Gate (spawning on Floor 2 also unlocks it; deaths respawn there too). The bot party goes to Floor 2 with `FLOOR=2`: from Floor 1 they kill the Warden and take the Stairway (or use the town waystone if already unlocked), farm the Mire until level 15, then fight the Sovereign.

```bash
START_LEVEL=16 SPAWN_AT=600,150 npm start
FLOOR=2 node test/team.js                   # the party takes on the Drowned Sovereign
```

Measured on the prototype: 40 bots used about 5% of one CPU core, about 50 KB/s down per player.

## Credits

Character models and animations: [KayKit Adventurers Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)), CC0. The models were trimmed to the animations the game uses.
The Lancer (knight rig) and the Bard (rogue rig) are tinted versions of the same models; their spear, lyre and beret are simple geometry built in `public/classes-b.js`.

## Next steps

See the design doc for the full roadmap: Floors 3–5, zone servers for hundreds of players. Stage C (skill mastery and evolutions) is done in spirit: see above.
