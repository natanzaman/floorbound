# Brief: write a short script that Floorbound's bots can act out

Paste this whole file into the scriptwriting chat. It describes what the game can stage today and the **cue sheet format v1** that the in-game scene director (`server/director.js`) plays.

## What we're doing
**Floorbound** is our co-op 3D browser game, inspired by Sword Art Online. Players are trapped in a tower of floors, clearing each floor's boss to climb. We film **short episodes (2–4 minutes on screen)** acted live in the game by bot actors, from a spectator "film view". The story bible is `docs/story/STORY.md`; Episode 1 is `docs/story/ep1-first-line.md` (screenplay) and `.yaml` (cue sheet).

Please write:
1. **A readable screenplay** (scene heading, action lines, dialogue).
2. **A cue sheet** in the format below. It runs as written: the director validates it and reports every problem with its scene and cue number.

Keep it **in the spirit of SAO with original characters, names and places**. The tone can echo it: trapped in a game, death is real, a raid party forms, a sacrifice, a clutch "Switch!".

## Cast: what a character can be
- **Up to 6 actors.** Each is a server bot with your chosen name (2–16 letters, digits, spaces, `_ . -`), class, level (1–20), weapon style and capability (1–5; 5 = flawless, the default). All actors are in one party.
- **Classes and weapon styles** (style ids in brackets; the first is the default):

| Class | Role | Styles |
|---|---|---|
| Swordsman | damage | One-Handed Sword (`sword`), Dual Blades (`dual`), Rapier (`rapier`) |
| Guardian | tank | Sword & Shield (`shield`), Mace & Shield (`mace`), Spear & Shield (`spear`) |
| Cleric | healer | Staff (`staff`), Tome (`tome`), Wand (`wand`) |
| Ranger | damage | Longbow (`longbow`), Crossbow (`crossbow`), Twin Daggers (`daggers`) |
| Berserker | damage | Greataxe (`greataxe`), Twin Axes (`twinaxes`), Warhammer (`warhammer`) |
| Lancer | damage | Lance (`lance`), Halberd (`halberd`), Glaive (`glaive`) |
| Bard | support | Lyre (`lyre`), War Drum (`drum`), Flute (`flute`) |

- **Each actor shows** a name and level above their head and a health bar. Actors get premade gear for their level and gain no XP during a show (levels hold).
- **Skills by id** (for the `skill` verb): Swordsman `rush`, `whirl`, `burst` (Lv 3, Breaks); Guardian `taunt`, `wall`, `gslam` (Lv 3, Breaks); Cleric `heal`, `bless`, `sanct` (Lv 3); the newer classes' ids are in `shared/classes/*.js`. Or a slot number 1–3.

## Places (sets) and landmarks
**Scene places:** `town`, `raid_gate`, `warden_arena`, `fields` (Floor 1); `mire`, `mire_camp`, `drowned_wood`, `sunken_gate`, `sovereign_lair` (Floor 2).

**Landmarks** (for `to:`, `marks`, `target:`):

| Landmark | Where |
|---|---|
| `town_square` | the plaza north of the fountain |
| `fountain` | around the town fountain (actors stand in a ring) |
| `merchant`, `smith`, `skill_shrine`, `hall_of_clearers` | in front of each (actors stand in a row facing it) |
| `well`, `waypoint` | the town fountain (the story calls it the well), which is the town's waypoint once Floor 1 falls (a ring, like `fountain`; `waystone` is its old name and still works) |
| `north_road` | the road out of town to the fields |
| `raid_gate` | before the Warden's raid gate (inside its ready zone) |
| `arena_edge`, `arena_center` | the Warden's arena: just inside, facing the centre; the centre |
| `mire_camp`, `mire_shrine` | Mirelight Camp's fire; its Skill Shrine (Floor 2) |
| `drowned_wood`, `sunken_gate`, `sovereign_court` | Floor 2's woods, raid gate, and the Sunken Court's edge |

A target can also be an **actor id** (walk to them, face them), **`warden`**, **`sovereign`**, a **spawn label**, or a point **`[x, z]`**.

- **The raid gate** opens after a ready check: once everyone at the gate is ready (or 20 s after the first one readies), it **counts down 5 s** and rises.
- **Lighting:** `day` or `eclipse` (dark sky, dimmed world), per scene.
- **The Hall of Clearers** is a stone tablet in town; the latest Floor 1 clear is engraved on its face (blank until someone clears). Its back reads *"A HUNDRED BELLS. THEN HOME."*
- **The Tower Bell** rings across every floor the first time a floor is cleared (the director rings it by hand during a show).

## Creatures
- **Floor 1:** Forest Boar, Dire Wolf, Alpha Wolf (elite), Bramble Spitter; rares Old Tusk, Ghostfang, Thornmother. **Boss: the Horned Warden**: three phases (66%, 33%), hounds from phase 2; slams, horn charges, a spinning **Horn Sweep** (dodge through it or parry it; shields don't help), rockfall, and **Quake Rings** (jump them). Mob ids for `spawn`: `boar`, `wolf`, `alpha`, `spitter`, `hound`, `oldtusk`, `ghostfang`, `thornmother`.
- **Floor 2:** Mire Shieldback (`shieldback`), Will-o'-Wisp (`wisp`), Bog Lurker (`lurker`), Mire Matron (`matron`, elite: calls lurkers up), Drowned Thrall (`thrall`). **Boss: the Drowned Sovereign**: trident sweeps and geysers; from 66% the **Tidal Wave** (roll through it), thralls and mire pools; below 33% the **Deluge** (the outer court floods) and homing orb volleys.

## What actors can do
- **Move:** walk or run to a spot, follow someone, face someone, stand still, dodge-roll, jump, appear somewhere (teleport).
- **Fight:** fight a target with their own combat brain (they dodge, heal and use skills as players would), press a given skill, guard and parry (Guardian), drink a potion, ready up at a raid gate. Break a boss and Switch; land the Last Attack.
- **Body:** speech bubbles above heads (`say`); emotes (`cheer`, `block`, `cast`, `hit`, `die`); poses (`kneel`, `sit`, `bow`).
- **Die:** a scripted death stays down (no respawn) until revived. During a show nobody else dies: actors never drop below 10% health unless a cue kills them.
- **Staging:** force a boss move now, reserve a boss's Last Attack for one actor, set the Warden's twist (or none), spawn a labelled mob, give a keepsake item (no stats, can't be sold or dropped).
- **Picture:** camera shots, slow motion, title cards, fades, letterbox, a clean feed (no HUD), day/Eclipse light, the town's well waking.

## Constraints that make it actable
- **Few words per line.** Bubbles hold 2–5 s (1.6 s + 0.07 s per character), so aim for about 12 words or fewer.
- **Combat is live, not choreographed.** Write beats like "they fight the Warden until it's below half"; bosses and enemies act on their own AI. Use staging verbs for the beats that must happen (a forced Horn Sweep, a reserved Last Attack, a scripted death).
- **Endings must be achievable:** defeating a boss works (it's live, so it takes as long as it takes: ~1–3 min for the Warden); a death needs a `die` cue.
- **Mark anything the game can't do yet** with `"[NEW]": true` on the cue and a note in the screenplay. The director refuses unknown verbs, so a `[NEW]` cue has to be built or cut before the sheet runs.

## Cue sheet format v1

```yaml
title: "First Line"
episode: 1
cast:
  - { id: corvin, name: "Corvin", class: swordsman, style: sword, level: 13 }      # skill: capability 1-5 (default 5)
  - { id: bram,   name: "Bram",   class: guardian,  style: shield, level: 12 }
scenes:
  - id: s1
    place: town                  # see Places
    light: day                   # day | eclipse
    marks: { corvin: hall_of_clearers, bram: fountain }   # actors appear here when the scene starts (a small fan if they share a spot)
    absent: []                   # actors left out of this scene (parked out of view; the dead stay where they lie)
    cues:
      - { do: fade, to: in, secs: 1.5 }
      - { who: corvin, do: face, to: hall_of_clearers }
      - { who: corvin, do: say, text: "Forty-one days.", hold: 4, after: prev, delay: 1 }
      - { id: arrive, who: bram, do: walk_to, to: corvin }
      - { who: bram, do: say, text: "Three raids tried.", after: arrive }
```

**Top:** `title`, `episode` (optional), `cast`, `scenes`. **Scene:** `id`, `place`, `light`, `marks`, `absent`, `cues`.

**Cue fields:** `who` (an actor id, a list `[a, b]`, `all` (everyone present), or for `boss_move` a boss/spawn label; director cues have none), `do` (the verb), the verb's arguments, and optionally:
- `id`: a label other cues can wait for;
- `after`: `prev` or a label;
- `delay`: seconds to wait after the trigger;
- `hold`: seconds the cue lasts at least (for `say`: how long the bubble holds; default by length; the film view's subtitle stays at least this long, longer if the line needs more reading time).

**Timing:**
- A cue **starts together with the previous cue**.
- `after: prev` starts it when the previous cue **finishes**; `after: <label>` when that cue finishes. A label must be on an earlier cue in the same scene.
- `delay` waits that long after the trigger.
- A cue **finishes** when its action is done: a move when the actor arrives; `say` after its hold; `fight`/`skill`/`wait` when their `until` is true; `fade`/`title`/`slowmo` after `secs`; `boss_move` when the move has landed; `dodge`/`jump` after the roll or jump; everything else at once. What an actor is doing carries on until a later cue changes it (after a `fight` ends, they keep fighting until told to `hold`, move, etc.).
- A scene ends when all its cues have finished; then the next scene starts.

**Conditions** (`until`): `<target>_hp < N%` (also `<=`, `>`, `>=`), `<target>_dead`, `<target>_broken` (staggered by a Break: the Switch window), `gate_open` (this floor's raid gate), `t > N` (seconds into the scene). Targets: `warden`, `sovereign`, actor ids, spawn labels.

**Verbs** (arguments; `*` = required):

| Group | Verb | Arguments | Notes |
|---|---|---|---|
| Movement | `walk_to`, `run_to` | `to*` | walk 3.4 m/s, run 7 m/s; to an actor or mob: stops in front of them |
| | `follow` | `to*` (actor or mob), `dist` | keeps following until another cue |
| | `face` | `to*` | |
| | `hold` | | stand still (stops fighting) |
| | `dodge` | `to` or `dir` (`left`/`right`/`back`/`forward`) | a dodge roll |
| | `jump` | | |
| | `teleport` | `to*` | appear there |
| Combat | `fight` | `target*` (boss/spawn), `until` | the actor's own brain fights, focused on the target |
| | `skill` | `skill*` (id or slot 1–3), `target`, `until` | closes in, presses it when ready; with `until`, fights and re-presses until true |
| | `guard` | `on` (default true) | Guardian only |
| | `parry` | | Guardian: a quick guard tap |
| | `use_item` | `item` (`potion` default, `tonic`, `draught`) | |
| | `ready` | | at a raid gate |
| Body | `say` | `text*`, `ch` (`say` default, heard nearby; `party`) | a speech bubble; in the film view a subtitle, plus the line's voice-over when made (`scripts/film/voices.mjs`; voices in `docs/story/ep<N>-voices.yaml`) |
| | `emote` | `anim*` (`cheer`, `block`, `cast`, `hit`, `die`) | |
| | `pose` | `k*` (`kneel`, `sit`, `bow`, `none`) | clears when the actor moves |
| Lifecycle | `die` | `respawn` (default false) | scripted death: stays down |
| | `revive` | | |
| | `wait` | `secs` or `until` | a director cue |
| Staging | `boss_move` | `move*`, `target` | `who: warden`: `horn_sweep`, `slam`, `charge`, `quake`, `rockfall`; `who: sovereign`: `tidal_wave`, `geyser`, `trident`, `deluge`; either boss: the team mechanics `meteor` (STACK on `target`), `spread` (`target` gets the first marker), `tether` (`target` + their nearest partymate; needs two fighters) |
| | `reserve_last_attack` | `target*`, `for` (actor; none clears it) | nobody else's damage takes it below 1 HP |
| | `twists` | `set*` (`off`, `random`, or a twist id) | the Warden's twist |
| | `spawn` | `type*`, `at*`, `label*` | a labelled mob; `who:`/`target:` can then name it |
| | `give_item` | `name*`, `slot` (`charm` default), `desc` | a keepsake |
| | `protect` | `min` (fraction, default 0.1; 0 = off) | actors are protected by default |
| Picture | `camera` | `shot*`, `target`, `from`, `secs` | shots: `close_up`, `medium`, `wide`, `over_shoulder` (+ `from`), `follow`, `orbit`, `crane`, `free`, `pov` and `eyes` (F8: that actor's own game camera, or first person; `target` must be an actor); `secs` = how long the camera takes to get there (0 = cut); the cue itself finishes at once |
| | `slowmo` | `secs`, `scale` | |
| | `title` | `text*`, `sub`, `secs` | |
| | `fade` | `to*` (`in`, `black`), `secs` | |
| | `letterbox`, `clean` | `on` (default true) | clean = no HUD (nameplates, bars and bubbles stay) |
| | `light` | `to*` (`day`, `eclipse`) | (or per scene: `light:`) |
| | `wake` | `on` (default true) | the film view's well wakes: its waypoint glow fades up from nothing (`on: false` or a stop puts it back to sleep). Until then it's dark, as it is for a player before their first Warden kill |
| World | `bell` | `floor` (default 1) | the Tower Bell |
| Team | `mvp` | `secs` (how long it stays up; default 25) | shows the last boss fight's post-fight MVP card to everyone, the film view included (a show gets no card otherwise) |

Unknown fields are warnings; unknown verbs, actors, landmarks, conditions and labels are errors, and so is a verb whose game module isn't on the server.
