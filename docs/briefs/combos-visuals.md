# Combos 2.0 and the visuals pass (2026-11-22)

Owner's go (2026-11-22): solo skill chains, setups and payoffs for every class, bots that set you up, class-flavoured
Team Bursts, plus weapon trails, hit sparks, bloom, 3D skill effects, animation layering and camera kick. It must look
great **without adding lag** (the speed batch, `docs/briefs/perf-batch.md`, set the bar). Hard mode stays deferred.

Two branches, built in parallel and merged together:
- `claude/project-thread-2sti63` (gameplay): sections A–E, server + shared tables + bots + a minimal client (HUD text).
- `feat/visuals` (graphics, built by a Fable agent): section F, client only, rendering A–E's events richly.

## A. Skill chains (everyone, solo included) — `shared/chains.js`, `server/chains.js`
- A **chain** starts when one of your attacks lands: a basic-attack finisher (the heavy third/fourth press) or a slot 1–3
  skill. Firing a **different** link (another slot skill, or a basic finisher) within `CHAIN.window` s of the last
  step's first hit **links** it: the chain goes x2, x3, x4 (cap `CHAIN.max`).
- While a chain is live (`CHAIN.hold` s after the last link) your hits deal `1 + CHAIN.step * (n - 1)` damage.
  Reaching x3 or more takes `CHAIN.refund` s off your other skills' cooldowns (once per link) and fills the (Team) Burst
  gauge (`BURST.fill.chain`). Repeating the same step never links; the chain lapses after `hold`.
- **Arts:** named links per class (`CHAIN_ARTS`, data): `{ from, to, name, frac }` where from/to are skill ids or `'fin'`.
  A named link adds a posture chunk (`frac`) on its first hit and shows its name. Unnamed links just say "Chain x3".
- Bots chain too, scaled by capability (`BOT_CHAIN`: chance and the slots each class may chain into, with ranges).
- Event: `{ t: 'chain', id, n, k (art id or ''), s (skill id or 'fin'), x, z }`; `{ t: 'chainEnd', id }` when it lapses
  at x3+. Snapshot: nothing new (the client keeps the state from events).

## B. Self-combos — `shared/teamplay.js`
- Your own setup can be paid off by you at reduced strength (`COMBO.self` = 0.6 of the bonus: mult, posture, root,
  heal, burst). A partner's payoff stays the strong one. Per combo `self: [rules]` says which of the setter's own hits
  pay it (e.g. a Lancer's Thrust on its own launch). Event `combo` carries `self: 1`.

## C. A full co-op table — `shared/teamplay.js`
Every class opens one setup and pays off several, so **every pair of classes has at least one combo**:

| Setup (who opens it) | Opened by | Combo | Paid off by |
|---|---|---|---|
| Launched (Lancer) | Sky Lance, Sweep | Skewer | any ranged hit (Ranger, Cleric Smite, Bard bolts) |
| Stunned (Guardian) | Ground Slam, Bash finisher | Execute | Berserker heavy, Swordsman Burst Combo, Lancer Thrust finisher, Ranger heavy arrow |
| Marked (Ranger) | Mark + own heavy arrow | Pin | Lancer Thrust / Charge, Swordsman Rush, Berserker Leap Slam |
| Staggered (Swordsman) | Rush | Cross Cut | Berserker Cleave / heavy chop, Lancer Thrust / Charge |
| Grounded (Berserker) | Leap Slam | Aftershock | Guardian Ground Slam / Bash finisher, Swordsman Whirl |
| Judged (Cleric) | Smite interrupting a wind-up | Verdict | any melee heavy hit (crits) |
| Off-beat (Bard) | Dissonance | Downbeat | Ranger heavy arrow, Swordsman Rush, Lancer Sky Lance |
| (Bard Discord 3+) | — | Shatter Chorus | anyone's Break |
| (Cleric zone / Blessing) | — | Sanctified Switch | anyone's Switch |

## D. Bots set you up — `shared/bots/teamplay.js`
- A bot whose setup a partymate can pay off presses its setup skill (chance by capability, `BOT_TEAM.setup`) when that
  partner is close to the target, and calls it out once in a while (`tcall` event: a short line in a bubble over the
  bot, not the chat log; throttled per bot).
- New order **Set me up** (`setme`, V wheel and `/b setme`): for 30 s the bots in your party favour setups your class
  can pay off on your target and always call them.

## E. Class-flavoured Team Bursts — `shared/teamplay.js` `BURST_TRAITS`, `BURST_PAIRS`
- Each class brings a **trait** to the finisher (Swordsman extra blade hits, Guardian a party shield, Cleric a party
  heal, Ranger a volley around the target, Berserker extra damage, Lancer a root/slow, Bard cooldowns back). Every
  distinct class among the joiners adds its trait (solo: your own, full strength; a group: each at `BURST.traitMul`).
- The burst is **named** by its first two classes (`BURST_PAIRS`, 28 names: 21 pairs + 7 solo).
- Event `tburst` adds `cls` (the distinct classes, starter first) and `pk` (the pair id, e.g. `lancer+ranger`).

## F. Visuals (`feat/visuals`, client only)
Budget: Low looks and costs as today; Medium/High may spend a little more GPU but no new per-frame allocations, no
shader compiles mid-fight (warm everything in the existing warm-up list), pooled meshes for anything spawned per hit,
draw calls in a 6-bot boss fight not more than ~5% above today. Everything honours Settings → Accessibility Reduce
motion (no shake, no FOV kick) and the colour-blind telegraph palettes (danger colours stay distinct from skill colours).
1. **Weapon trails** for melee swings (ribbon following the weapon tip / swing arc, coloured by class and chain level).
2. **Hit sparks / impact flash** upgrade (heavier on finishers, crits, combos, Breaks).
3. **Bloom + tone mapping** on Medium/High (Three.js addons; off on Low; Auto quality's step-down turns it off).
4. **3D effects for big skills** (Whirl, Ground Slam, Sky Lance, Leap Slam, Burst Combo finisher, Rush, Piercing Shot…)
   instead of only flat ground shapes.
5. **Animation layering** for player skills (lunge, anticipation hold, follow-through, recoil on hit) using the existing
   PoseLayer approach, so skills that share a clip read differently.
6. **Camera kick** on your own finishers, chain x3+, combos you're in and Team Bursts (tiny; off with Reduce motion).
7. Rendering for A–E: chain counter near your character ("CHAIN x3 · Rising Edge"), the new combos, bot callouts as
   bubbles, a distinct look per burst trait / pair.

## Tests
`test/chains.js` (link rules, window, repeat, cap, hold, refund, arts, bots), `test/teamplay.js` extended (self-combos,
the new setups / payoffs, every pair covered, traits and pair names), bot runs (`test/team.js`, `test/wardenskill.js`)
reporting combos, chains and bursts per fight; a client frame-cost check before/after on the visuals branch.
