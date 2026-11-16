# Floorbound

A co-op 3D action RPG that runs in the browser. You and your friends are stuck in a 100-floor tower: fight through the field, beat the floor boss together, clear the floor.

This is the **Floor 1 prototype**: town hub, open field with mobs, the Horned Warden boss, 3 classes, parties, levels 1–10, and a real-time authoritative server.

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
| Look | Right-click drag, or park the cursor at the left/right screen edge; Q/E; wheel to zoom | Drag the right side |
| Basic attack | Left click or J (hold) | Big round button (hold) |
| Skills | 1, 2, 3 | Small buttons |
| Dodge roll | Shift or K | Dodge button |
| Jump | Space (hop over the boss's slams) | Jump button |
| Guard / parry (Guardian) | Hold R to guard; tap R just before a hit to parry | — |
| Select a character (enemy or ally) | Ctrl+click it (Cmd+click on Mac); Ctrl+click empty ground to clear | Lock on button (enemies) |
| Lock on / cycle enemies | Tab (Esc to clear) | Lock on button |
| Chat | Enter | Chat button |
| Party | Players button (P) → Find party, or Invite | Players button → Find party / Invite |
| Items | 4 potion, 5 tonic, 6 draught; B bag | Potion button; Bag button |
| Interact (merchant, raid gate) | F | Trade / Ready button |
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

## The raid gate and the Last Attack Bonus

A portcullis blocks the corridor to the Warden's chamber. Everyone standing at the gate presses **F** (or taps Ready); when all of them are ready, it counts down 5 seconds and rises. It closes again once the chamber is empty. Boss health scales with the number of players inside when the fight starts. Whoever lands the killing blow gets the **Last Attack Bonus**: the unique *Horn of the Warden* charm.

## Rare spawns

Every 6–10 minutes one named rare appears somewhere on Floor 1, announced to the whole server with a beam and a direction hint: **Old Tusk** (giant boar, Verdant Field), **Ghostfang** (white alpha wolf, Wolf Woods) or **Thornmother** (giant spitter, fires 3-thorn fans). Everyone who damages it gets their own Rare-weighted loot roll. It wanders off after 5 minutes if nobody fights it. `RARE_SOON=1` spawns the first one after ~10 s (testing).

## Titles and the Hall of Clearers

Characters keep lifetime stats and earn titles (Warden Slayer, Last Attacker, Switch Master, Boarbane, Wolfsbane, Frontliner, Undying, Veteran). Pick the one you wear in the bag (B); it shows under your name. The stone **Hall of Clearers** in town (press F) lists the server's first Floor 1 clear, the fastest clears and the latest ones.

## Items

- **Gear:** weapon (+damage), armour (+health, and less damage taken at Rare+), charm (crit, cooldowns or Switch damage). Rarities: Common, Uncommon, Rare, Epic, plus the gold Last Attack item. Weapons are class-specific.
- **Drops are personal:** every party member nearby rolls their own gold, potions and gear. Alphas always drop Uncommon+; the Warden drops two Rare+ items for everyone who fought.
- **Consumables:** Health Potion (40% health), Battle Tonic (+15% damage, 30 s), Ironbark Draught (−15% damage taken, 30 s). New characters start with 3 potions.
- **Merchant** in town (press F at the stall): buy consumables and Uncommon gear, sell items.

## New players and the party finder

New characters get a short step-by-step guide card (move, hit, dodge, kill, bag, party, Switch, raid gate, boss) plus one-time tips the first time they see each attack type. **Find party** puts you in the party finder: solo players are matched together, or into any party that has turned on recruiting.

## Play tracking

With a database, the server records play events (session start/end, first kill, deaths and their cause, party joins, guide steps, boss attempts, rare drops) in `play_events`. See the aggregates at **/stats.html** (raw JSON at `/api/stats?days=7`).

## Combat: posture, Break and Switch

- **Dodge roll** gives a short window of invulnerability; roll through the boss's red circles.
- **Posture:** every enemy has a thin yellow posture bar under its health (nameplate, target frame, boss bar). Every hit fills it in proportion to the damage; heavy hits and combo finishers fill it twice as fast; Break skills (Ground Slam, the Burst Combo finisher) fill about half of it on normal enemies (less on the boss); a Smite that lands while the enemy winds up an attack fills a big chunk and interrupts it. Posture drains slowly after 2.5 s without being hit.
- **Break:** when posture is full the enemy is BROKEN: stunned for a moment (yellow dizzy ring), its wind-up is cancelled, and its posture resets. The Warden can be broken again as soon as its posture refills.
- **Switch:** the first hit from a *teammate* on a broken enemy does 2.5x damage, and follow-up hits do 1.4x. You can't Switch your own Break. Charms of the Switch boost this further.
- **Perfect dodge:** start a roll at most ~0.2 s before a hit lands and it's PERFECT: a brief slow-motion flash, heavy posture damage to the attacker, and for 1.5 s your next hit does +50% damage and double posture damage.
- **Guard and parry (Guardian, R):** hold R to guard: hits from the front (±70°) take 70% less damage, but you can't attack and you move at half speed. Press R at most ~0.2 s before a frontal hit lands to **parry** it: no damage at all, and big posture damage to the attacker. Mashing R doesn't parry.
- **Perilous attacks:** the Warden's **Horn Sweep** shows an orange/gold circle around it with a "!" glint and its own warning horn (about 0.9 s). Anyone inside takes about 80% of their max health: Shield Wall, Taunt, guarding, gear and jumping don't reduce it. Roll through it (i-frames) or parry it. Breaking the Warden during the wind-up cancels it. It comes every ~18 s in phase 1, more often later.

## Classes

| Class | Role | Skills |
| --- | --- | --- |
| Swordsman | Damage | Slash, Rush (dash strike), Whirl (spin), Burst Combo (Lv 3) |
| Guardian | Tank | Bash, Taunt, Shield Wall, Ground Slam (Lv 3, stuns) |
| Cleric | Healer | Smite (ranged), Heal, Blessing (+25% damage), Sanctuary (Lv 3) |

## Project layout

```
shared/data.js   classes, skills, mobs, map, collision — used by server AND client
server/game.js   authoritative simulation: combat, AI, boss, XP, parties
server/combat.js posture/Break, perfect dodge, guard/parry, Horn Sweep (mixed into Game)
server/index.js  static file server + WebSocket server (20 ticks/sec)
public/          Three.js client (no build step): main.js, world.js, style.css
public/models/   rigged character models (glTF) with shared animations
test/bots.js     headless bot players for load/gameplay testing
test/combat.js   in-process checks for posture, perfect dodge, guard/parry and the Horn Sweep (node test/combat.js)
shared/teambots.js  role-playing party bots (tank / DPS / healer), used by test/team.js and public/bots.html
```

Tuning lives in `shared/data.js` (class HP/ATK, cooldowns, mob stats). New skills are a `case` in `Game.useSkill` plus an entry in `CLASSES`.

## Accounts and saved characters

Set `DATABASE_URL` (any Postgres; the live game uses Neon) to turn on accounts. Tables are created automatically on startup.

- **Play as guest:** a guest account is saved in that browser (no password, no email).
- **Sign in with Discord:** set `DISCORD_CLIENT_ID` (the app's public Application ID) and add the redirect URL `https://YOUR-HOST/auth/discord/callback` in the Discord app's OAuth2 settings. No client secret needed: the server checks each sign-in token with Discord and confirms it was issued to this app. Signing in while playing as a guest links the guest's characters to Discord.
- Up to 4 characters per account; names are unique. Level and XP save every 15 s, on level-up and on disconnect.

Without `DATABASE_URL` the game runs in anonymous mode (pick a name and play, nothing saved), which is handy for local development.

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

Other testing aids: `SPAWN_AT=0,172` spawns players at the chamber gate. `MAX_PLAYERS` caps the server (default 64).

Measured on the prototype: 40 bots used about 5% of one CPU core, about 50 KB/s down per player.

## Credits

Character models and animations: [KayKit Adventurers Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)), CC0. The models were trimmed to the animations the game uses.

## Next steps

See the design doc for the full roadmap: saved characters, gear drops, Floors 2–5, zone servers for hundreds of players.
