# Brief: write a short script that Floorbound's bots can act out

Paste this whole file into the scriptwriting chat.

## What we're doing
**Floorbound** is our co-op 3D browser game, inspired by Sword Art Online. Players are trapped in a tower of floors, clearing each floor's boss to climb. We want a **short scene (2–4 minutes on screen)** that the game's AI bots can act out live in the game while we film it. We'll then improve the game where the script needs it.

Please write:
1. **A readable screenplay version** (scene heading, action lines, dialogue).
2. **A cue sheet** in the exact format at the bottom, which we'll turn into an in-game "director" that drives the bots.

Keep it **in the spirit of SAO with original characters, names and places**, not Kirito/Asuna or scenes copied from the show. The tone can echo it: trapped in a game, death is real, a raid party forms, a sacrifice, a clutch "Switch!".

## Cast: what a character can be
- **Up to 6 actors.** Each is a bot or a real player.
- **Classes and their look:**

| Class | Role | Look |
|---|---|---|
| Swordsman | damage | knight, one-handed sword |
| Guardian | tank | shield |
| Cleric | healer | mage robe, staff |
| Ranger | damage | bow |
| Berserker | damage | barbarian, greataxe |
| Lancer | damage | spear |
| Bard | support | lyre |

- **Weapon variants:** each class can carry a different weapon style, e.g. a Ranger with twin daggers or a crossbow, a Bard with a war drum or flute, a Berserker with a warhammer.
- **Each actor shows:** a name and a level above their head, and a health bar. Players' names are freely chosen.

## Places (sets)
- **Town of Beginnings** (Floor 1): the safe town where everyone starts.
  - Merchant, Smith (forge).
  - Skill Shrine.
  - Hall of Clearers: a monument listing every party that beat a boss.
  - Warp to Floor 2.
- **The fields and forest** outside town: grassland and trees.
- **The raid gate:** a large gate before the boss arena. It opens 20 s after a party readies up.
- **The Warden's arena:** a circular boss room with stone pillars.
- **Floor 2, the Glimmering Mire:** a swamp with glowing light.
  - Mirelight Camp: a safe camp.
  - The Drowned Sovereign's lair: the Floor 2 boss.
- **Lighting:** we can do normal daylight, or the "Eclipse" look (dark sky and dimmed arena). Other times of day or weather would be new work.

## Creatures
- **Floor 1:**
  - **Field enemies:** Forest Boar, Dire Wolf, Alpha Wolf (elite), Bramble Spitter (stationary plant that spits).
  - **Rare elites:** Old Tusk, Ghostfang, Thornmother.
  - **Boss: The Horned Warden** (horned giant beast).
    - Attacks: charges, ground slams, a spinning Horn Sweep you must dodge or block, falling rocks, and expanding shockwave rings ("Quake Ring") that you jump over.
    - Calls in hounds.
    - Three phases.
- **Floor 2:**
  - **Field enemies:** Mire Shieldback, Bog Lurker, Mire Matron.
  - **Boss:** The Drowned Sovereign.

## What actors can do today
- **Move:**
  - walk or run to a spot, follow someone, face someone, stand still;
  - dodge-roll, jump;
  - hold position, regroup.
- **Fight:**
  - attack a target, use their class skills (e.g. Swordsman Rush/Whirl/Burst Combo, Guardian Taunt/Shield Wall, Cleric Heal/Blessing/Sanctuary, Bard songs);
  - guard, and the Guardian's parry;
  - Break a boss and call "Switch!" (one fighter staggers the boss, another steps in for the big hit);
  - land the Last Attack.
- **Animations:** idle, walk, run, several sword swings, two-handed swings and spins, stab, block, block-attack, cast and raise-staff spells, dodge roll, jump, two hit reactions, a death collapse, and a "Cheer" (arms raised). No sitting, kneeling, hugging, crying or waving yet: those would be new work.
- **Talk:** party chat with names. We will add **speech bubbles above heads** for chat lines.
- **Die and respawn:** a character can be killed and respawns in town.
- **Items:** potions, equipping gear, buying from the merchant, crafting at the Smith.
- **Camera:** a free spectator camera follows the action. Specific camera moves (pans, close-ups, slow-motion) are new work, so mark them separately.

## Constraints that make it actable
- **Few lines per beat.** Each line is shown in a speech bubble for 2–5 s, so aim for about 12 words per line or fewer.
- **Combat is live, not choreographed.** Write beats like "they fight the Warden until its health is half", not exact swing-by-swing moves. Bosses and enemies act on their own AI.
- **Endings must be achievable.** Defeating a boss works. Fake deaths need a cue, which we can script, e.g. "Rook collapses (scripted death)".
- **Mark anything we'd need to build** with `[NEW]`, e.g. kneel animation, camera close-up, rain, a cutscene title card, a non-hostile NPC, a custom item.

## Cue sheet format
Give the cue sheet as YAML in this shape. Times are optional; `after` chains cues.

```yaml
title: "The Third Bell"
cast:
  - { id: rook,  name: "Rook",  class: guardian, style: default, level: 10 }
  - { id: wren,  name: "Wren",  class: cleric,   level: 10 }
  - { id: kade,  name: "Kade",  class: swordsman, style: dual, level: 10 }
set: { place: town, light: day }            # town | fields | raid_gate | warden_arena | mire | mire_camp | sovereign_lair; light: day | eclipse
scenes:
  - id: s1
    place: town
    cues:
      - { who: kade, do: walk_to, to: hall_of_clearers }
      - { who: kade, do: say, text: "Nobody's cleared it. Not in forty days.", hold: 3 }
      - { who: rook, do: walk_to, to: kade, after: prev }
      - { who: rook, do: say, text: "Then we'll be the first." }
      - { who: all,  do: emote, anim: cheer }
      - { do: camera, shot: wide_on, target: kade, "[NEW]": true }
  - id: s2
    place: warden_arena
    cues:
      - { who: all, do: fight, target: warden, until: "warden_hp < 50%" }
      - { who: rook, do: say, text: "Switch!" }
      - { who: kade, do: skill, skill: burst, target: warden }
```

Allowed `do` verbs:
- **Movement:** `walk_to`, `run_to`, `follow`, `face`, `hold`, `dodge`, `jump`.
- **Combat:** `fight`, `skill`, `guard`, `parry`, `use_item`.
- **Talk and body:** `say`, `emote` (anim: cheer, block, cast, hit, die).
- **Lifecycle and staging:** `die` (scripted), `respawn`, `wait`, `camera`.
- **Anything else:** mark it `[NEW]`.

Places for `to:` can be a character id or a landmark:
- `town_square`, `merchant`, `smith`, `skill_shrine`, `hall_of_clearers`, `warp`;
- `raid_gate`, `arena_center`, `mire_camp`.
