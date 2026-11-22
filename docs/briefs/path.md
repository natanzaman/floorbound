# The Path: leveling, class trees and evolutions (owner request, 2026-11-22)

Proposal doc: https://claude.ai/artifact/8zLTfqSNgniwMuyoQMHPnV · mockups: https://claude.ai/artifact/5voHDNCs7KJ4UnmQiTJ6ch

## Owner decisions
- "Think about how the levels work: speccing into a certain class and getting certain abilities and evolving them, and
  enhancing your character with character tree upgrades, and the UI/UX for those trees, abilities, enhancements and
  evolutions should be really cool and easy and make it feel really individual for the type of character."
- Approved: **all three phases** (decision card, 2026-11-22). Build 1, then 2, then 3; independent review; ask before
  pushing to main.
- The hidden hybrid path stays hidden: no station, no UI text, no guide line (see `docs/briefs/subclasses.md`).

## Phase 1: the Path window (UI; no rule or balance change)
- The Skill Tree window (K, the HUD button, F at a Skill Shrine) becomes **Path**: tabs **Path**, **Abilities**,
  **Talents**. Ids stay (`#talentsp`, `.tn`, `.tt`, `data-tab`) so pad navigation and tests keep working.
- Header: the class sigil (`public/treeshapes.js`), name, subclass (or class), level, XP bar, the points pill.
- **Path tab:** the journey (Initiate 1 → class 5 → subclass 15 → subclass II 22 → crown 30, each station showing what it
  gave or gives), "Coming up" (an open keystone, a skill near its evolution, the next level reward, the next boss),
  "Your build" (name + five-axis shape) and the five skill slots with their stage.
- **Talents tab:** each class tree drawn in its own shape (Swordsman blade, Guardian shield, Cleric halo, Ranger bow,
  Berserker axe, Lancer spear, Bard lyre) from a per-class layout function; the rules (3 branches, 5 tiers, keystones)
  are unchanged. Nodes show icon, rank and a short name. A side card shows the selected/hovered node: one plain line,
  then the details. **Plan, then confirm:** clicks queue ranks (gold "+n"), right-click takes a planned rank back,
  Confirm sends `{ type: 'talent', op: 'spendMany', ids }` (the server validates the whole list, then applies it), Undo
  clears. **Suggested path** toggle: dotted rings on the subclass branch first, then the class's bot order.
- **Build identity** (`buildShape`, `buildName` in `shared/talents.js`): every effect carries a tag (Power, Tempo,
  Guard, Team, Control); the top tag names the build ("Tempo Duelist"). The roster carries `bt` (top tag) so the
  Players list shows it.
- **Abilities tab:** the skill bar on the left; the chosen skill on the right: one-line summary, a shape diagram, the
  mastery track, and a Base → Evolved → Awakened strip; the basic attack shows its weapon styles.
- **Moments:** the evolution choice becomes a centred two-card overlay with diagrams (keys 1 and 2), shown only out of
  combat (4 s after the last hit); a level-up banner lists the gains (points, new nodes, health, attack).

## Phase 2: small rules
- **Signature mastery:** the signature skill (slot 5) earns mastery like slots 1-3 (`p.mastery.sig`), Mastery 2 -10%
  cooldown, Mastery 3 evolves into one of two forms (`SIG_EVOS` in `shared/subclasses.js`: number overrides on `n` plus
  an optional effect from the shared effect library), Mastery 4 +10%, Mastery 5 awakens (Phase 3).
- **Initiate plan mode:** an Initiate plans points for each class its weapon leads to (`path.plan = { cls: alloc }`,
  `{ type: 'talent', op: 'plan', cls, r }`); on graduation the plan for that class is spent (if still legal).

## Phase 3: content
- **Effect library** (`shared/effects.js` data, `server/effects.js` engine): small, data-driven actions (posture,
  slow, stun, mark, burn, burst, pull, shield allies, heal, team damage, cooldown cut, damage reduction) fired on
  hooks (a skill's cast, its hits, its heals; and for talents: crit, kill, dodge, perfect dodge, Break, Switch).
- **Awakenings:** at Mastery 5 the chosen evolution gains one extra rule (`AWAKEN` in `shared/mastery.js`: 2 per skill,
  42 in all) plus the signature skill's 28 (14 x 2).
- **Subclass II (level 22)** and **Crown (level 30)**: three more nodes per subclass (`SUB2_NODES` in
  `shared/talents.js`, `lvl` field, tier 3 and a tier 4 keystone; they never count for tier gates).
- **Rule nodes:** about half of the pure stat nodes get a small proc rider (and a smaller stat), so under 20% of nodes
  are plain stat bumps.
- Bots: spend orders cover the new nodes; bots pick signature evolutions by role.
- Balance: `scripts/tuneboss.js --boss sovereign,colossus --party 6 --skills 5 --runs 3` before and after; if a fight
  moves more than 10%, tune the new effects, not the bosses.

## Tests
`node test/path.js` (new: layouts, plan/spendMany, build identity, sig mastery, plan mode, effect engine, awakenings,
subclass II and crown nodes), plus the existing `talents`, `academy`, `subclasses`, `newclass`, `crossfeature`;
`python3 test/path.py` (screenshots of each tab for each class in `docs/briefs/path-shots/`).
