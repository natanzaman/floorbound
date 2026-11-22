# The Academy: Initiates, class trials, drills, ranks and cohorts (owner request, 2026-11-22)

## Owner decisions (2026-11-22)
- "Everyone starts as an Initiate, and then you choose your weapon: ranged (bow), sword, spear, wand and staff. Those are
  your basic attacks. Then you get abilities to spec into depending on the weapon you're using, academy this, academy
  that. You get some basic abilities, and then they upgrade into whatever class you start specking into."
- Bots go to school too (they can act as citizens).
- A hybrid path exists in the owner's plans for much later. It is never advertised: players assume they pick one class
  tree. Nothing about it is built here or mentioned in the UI, guide, README or story.

## What is built (and the choices made)
### 1. Initiates
- New characters pick a name and a **weapon**: sword, spear, bow, staff or wand (`shared/academy.js` `WEAPONS`, with a
  blurb and the classes it leads to). The character carries a path record, `characters.path` (JSONB):
  `{ stage: 'initiate' | 'class', weapon, trials: { cls: medal }, drills: { id: medal }, keep: { cls: { mastery, talents } }, cohort, armed, enrolled }`
  (medals 1 bronze, 2 silver, 3 gold). **`path` null = a character made before the Academy: graduated in its class, nothing changes.**
- An Initiate fights with its weapon's **base class and style** so combat stays one code path:
  sword → Swordsman (One-Handed Sword), spear → Lancer (Spear), bow → Ranger (Longbow), staff → Cleric (Staff),
  wand → Cleric (Wand). Wand stays on the Cleric because the Wand is already a Cleric weapon style (fast 12 m bolts that
  interrupt); the Bard has no wand-like style (lyre, drum, flute), so a Bard base would need a new style for no gain.
  `characters.cls` holds the base class while an Initiate.
- **The Initiate kit:** the basic attack and the first two abilities under plain names (`INITIATE_NAMES`: a sword's
  Rush is "Lunge", Whirl "Spin"; a spear's Lance Charge "Dash Strike", and so on), at **x0.85 power** (attack and
  healing, `INITIATE.pow`), and **no level-3 skill** (shown locked: "Academy"). The **talent tree is locked**; points
  bank up by level as always (`pointsAt`), so they are all there at graduation. **Mastery still accrues**.
- Starter weapon: a Common weapon of the base class and style, equipped once (`path.armed`).
- **Academy weapons** (`it.ac`): the starter and any weapon a weapon or class change hands out. Worth nothing; never
  sold, salvaged, dropped or worked by the Smith; one swapped out goes back to the Academy (not to the bag), so switching
  mints nothing. A switch that would push a real weapon into a full bag is refused (nothing is ever auto-sold). The
  graduation weapon is yours (untagged). Weapon changes are 5 s apart.
- Nameplate and Players list: "Initiate · Sword". The snapshot row is unchanged (class index of the base class, style
  index); the roster carries `ini` (weapon id) and `rk` (rank index). No wire index moved.
- Anonymous mode: the join form picks a weapon too (memory-only path). Joins that send a `cls` (bots, tests, old
  links) stay graduated in that class. **Bots, the Named, director actors and premade bot setups are unchanged.**

### 2. The Academy (Town of Beginnings)
- A small stone hall west of the square (`ACADEMY` at (-21, -3)), simple geometry and a floating label like the Hall
  and Smith; F opens the **Academy panel** (pad-navigable: `data-nav`, registered with `panels`).
- Panel: your path and rank, class trials (by your weapon while an Initiate; every class once graduated), drills,
  medals, the armory (change weapon, free while an Initiate), graduation, change class, the hall heads, cohort.
- **Graduating:** needs a passed trial (bronze or better) for that class and a confirm (you may pass several trials
  first). Then: class set; the matching style's weapon granted and equipped (Uncommon; `GRAD_STYLE`: Guardian from a
  spear gets Spear & Shield, from a sword Sword & Shield; Cleric keeps Staff or Wand); full names, full power, the
  level-3 skill; the talent tree opens with every banked point; a "GRADUATED" callout and a chat line.
- **Changing class later** (graduates): any class whose trial you passed, for a gold fee (`CHANGE_FEE`: 100 + 20 per
  level). **Mastery and talents are kept per class** (`path.keep[cls]`): switching back restores them.
- Legacy characters (path null) get a graduated path record the first time they do anything at the Academy.

### 3. Class trials (the yard)
- The yard is four walled pens in their own patch of Floor 1's coordinate space (x 215..250, z 80..300, like the
  labyrinth layers), so `walkable()` holds everyone in (players, prediction, mobs). One trial or drill per pen; the
  mobs are yours alone (`m.trial`), give no XP or loot, and their health scales with your attack.
- **Try before you commit:** a trial loans that class's full kit (class, skills, full power, the level-3 skill; no
  talents). Saves never write the loan (`p.loan`). Leaving the pen, dying, timing out or disconnecting ends it.
- From **level 5** an Initiate may try any class its weapon leads to: sword → Swordsman, Guardian, Berserker; spear →
  Lancer, Guardian; bow → Ranger; staff and wand → Cleric, Bard. The armory changes weapon for free while an Initiate,
  so every class is reachable.

| Class | Trial | Score | Bronze / Silver / Gold |
|---|---|---|---|
| Swordsman | Break the Training Golem, then bring it down (45 s) | seconds | 45 / 30 / 20 |
| Guardian | Hold three Training Wolves off the Ward Post for 30 s (wolves nobody holds gnaw it) | Ward % left | 50 / 75 / 90 |
| Berserker | Fell six Training Dummies (40 s) | seconds | 40 / 30 / 20 |
| Lancer | Tip-of-reach hits on advancing dummies (30 s) | hits | 8 / 12 / 16 |
| Ranger | Down strafing targets (30 s) | kills | 5 / 8 / 11 |
| Cleric | Keep the Ward Post alive 30 s under damage (your heals mend it) | Ward % left | alive / 50 / 70 |
| Bard | Keep your ally buffed 30 s: a song 1 pt/s, a Crescendo 2 pt/s | points | 14 / 22 / 30 |

The "ally" in the Guardian, Cleric and Bard trials is the **Ward Post**, a training post with its own health bar (not a
player). The Swordsman goal is Break + kill rather than a Switch: a Switch needs a second player, and trials are solo.

### 4. Drills (open to everyone)
| Drill | What it teaches | Score | Bronze / Silver / Gold |
|---|---|---|---|
| Perfect Dodge | roll into a golem's swing at the last moment (40 s) | perfect dodges | 3 / 5 / 8 |
| Break, then Switch | Break the golem, hit it while Broken (45 s; in a party that hit is the Switch) | punished Breaks | 1 / 2 / 3 |
| Read the Wind-up | 30 s beside golem and wolves: get out of every telegraph | hits taken (fewer is better) | 4 / 2 / 0 |
| Interrupt the Cast | big hits (knockback, Smite, Dissonance...) mid cast stop it (40 s) | interrupts | 2 / 4 / 6 |
| Revive Under Fire | stand by the fallen dummy 3 s to revive it; a hit resets you (45 s) | revives | 2 / 3 / 4 |
| Skill Chain | link your skills on dummies (40 s) | best chain | x2 / x3 / x4 |

Each medal tier pays once (`DRILL_REWARD`: 25 gold; 50 gold + a tonic; 100 gold + a draught); reaching gold first pays
all three.

### 5. Class rank
Novice / Adept / Expert / Master from medal points (bronze 1, silver 2, gold 3, best per trial and drill) and floors
cleared (Warden, Sovereign, Colossus kills): `RANKS` (Adept 6 pts; Expert 16 pts and a floor; Master 30 pts and all
three floors). Shown on the nameplate and the Players list from Adept up (Novice is the default and not shown, so bots
and newcomers aren't all labelled), in the Academy panel, and carved next to the name in the Hall of Clearers
(every clear record stores each name's rank at the time; the Hall shows it).

### 6. The Named teach
Each class hall has a head from the Named whose class fits (`HEADS`): Guardian and Swordsman, Halvard; Cleric and Bard,
Maribel; Ranger, Tovin; Lancer, Sennet; Berserker, Cairn. Talk at the Academy gives a static line per head (cheap, no AI
calls). Passing a head's class trial adds friendship (`HEAD_FRIENDSHIP` x the medal) when the Named are on.

### 7. Cohorts (bot classmates)
On a character's first Academy visit while an Initiate, two bot classmates join as the player's own free-bot-system bots
(creator = the player, `shared/accesslevels.js` rules, the global `MAX_BOTS` caps; partied when there is room). They are
Initiates with complementary weapons (`COHORT`), level with the player (the existing level sync), and graduate when the
player graduates, into classes that complement the player's role (`COHORT_CLASSES`). Re-summon at the Academy if
dismissed; at most two per character (`path.cohort` keeps their names).

## Files
`shared/academy.js` (data and pure rules), `server/academy.js` (path, kit, Academy actions, trials and drills, cohorts,
ranks; `installAcademy`), `public/academy.js` (building, yard, panel, trial HUD, mob looks), hooks in
`server/game.js` (initPath, pathStats, the level-3 notice, the join line), `server/index.js` (weapon joins, the `path`
message), `server/accounts.js` + `server/db.js` (the column, create with a weapon, save cls and path),
`server/admin.js` + `public/admin.js` (show and set the path), `shared/data.js` (yard walls, mob types),
`shared/bots/brain.js` (a bot follows a class change), `public/main.js`, `public/world.js`, `public/guide.js`.

## Checks
`node test/academy.js`: pure rules (weapons, kit names, trial medals, ranks, fees, cohort picks), an in-process trial
(Initiate kit and power, level 5 gate, a loaned kit, pass, graduate, talents open, change class keeps talents), and with
`DATABASE_URL` a server run (create an Initiate with a weapon, level to 5, pass a trial by test hook, graduate, the
path survives a restart, an old character with path null loads unchanged). Browser: `python3 test/academy.py`
(creation screen and Academy panel; screenshots in `docs/briefs/academy-shots/`).
Test hooks (TEST_HOOKS=1): `{ type: 'test', trialWin: medal }` finishes your running trial or drill with that medal.
