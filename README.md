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
| Select a character (enemy or ally) | Ctrl+click it (Cmd+click on Mac); Ctrl+click empty ground to clear | Lock on button (enemies) |
| Lock on / cycle enemies | Tab (Esc to clear) | Lock on button |
| Chat | Enter | Chat button |
| Party | Players button (P) → Find party, or Invite | Players button → Find party / Invite |
| Items | 4 potion, 5 tonic, 6 draught; B bag | Potion button; Bag button |
| Interact (merchant, Smith, raid gate) | F | Trade / Forge / Ready button |
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
| The Horned Warden (boss) | 10 | Three phases. 100–66%: cleaves and ground slams. 66–33%: adds hounds and a horn charge down a red lane. Below 33%: enraged spin and rockfall circles under everyone. |

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

With a database, the server records play events (session start/end, first kill, deaths and their cause, party joins, guide steps, boss attempts, rare drops) in `play_events`. See the aggregates at **/stats.html** (raw JSON at `/api/stats?days=7`).

## Combat: Break and Switch

- **Dodge roll** gives a short window of invulnerability; roll through the boss's red circles.
- **Break** an enemy with Ground Slam (Guardian), the Burst Combo finisher (Swordsman), or a Smite that lands while it's winding up an attack (Cleric). It's stunned for a moment and shows a yellow dizzy ring.
- **Switch:** the first hit from a *teammate* on a broken enemy does 2.5x damage, and follow-up hits do 1.4x. You can't Switch your own Break. Charms of the Switch boost this further.

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
server/index.js  static file server + WebSocket server (20 ticks/sec)
public/          Three.js client (no build step): main.js, world.js, style.css
public/models/   rigged character models (glTF) with shared animations
test/bots.js     headless bot players for load/gameplay testing
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
