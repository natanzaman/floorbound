# Effects styles ("looks")

Owner ask (2026-11-22): a few distinct graphics variations to pick from, shown side by side; then the performance
cost of the picked ones with a 1-bot and a 2-bot team, against main. Not on main until he picks.

## What a look is
`public/fxlook.js` holds one table of numbers per look. A look changes only numbers the visuals pass already reads:
- **Bloom and colour grade** (`public/post.js`): threshold, strength, how much marked effects glow, blur steps (2-4),
  highlight roll-off, vignette; saturation, contrast, a tint on the light, a lift in the darks (four new uniforms in
  the final pass, which already ran).
- **Trails** (`public/vfx.js`): life, width, brightness, cross-section (soft body or a hard line at the tip), the
  colour at the blade and the colour the tail fades to.
- **Sparks and flashes** (`public/sparks.js`): count, size, speed, life, gravity, round or shard-shaped, colour.
- **Skill effects**: strength, hot cores, how tall shock walls stand, crescent size, rock counts, class-colour tint,
  the finisher gold, and **glow or paint** (`fx.solid`): glow adds light on top (main's way: bright on dark ground,
  washed out on bright ground); paint lets an effect cover what is behind it, so its colour holds on any ground.
  The switch is a blend factor (GL state), with the bloom mask scaled back so effects glow as much.

Nothing compiles, no buffer is resized and no draw call is added when a look is picked. The parts that can move the
cost: bloom `levels` (fewer = two small passes less each), spark counts (one pooled draw call either way), and how
much of the screen the effects cover (overdraw).

One change applies to every look, Classic too: a trail ribbon has 32 points instead of 20 (so a 0.4 s trail keeps
its whole length at 60 fps): 192 more vertices in the one trail mesh.

## The looks
`classic` (what main draws), `ember` (Ember Forge), `aether` (Aether Glass), `neon` (Neon Arcade), `golden` (Golden
Hour), `lean` (Clean Steel). Each one's note is in the table.

## Picking one
`?look=<id>`, Settings → Graphics → Effects style (saved in this browser), or `__fb.setLook(id)`. Low quality has no
bloom, trails or 3D effects, so there a look only changes sparks.

## Tools and tests
- `scripts/lookshots.mjs`: the same staged scenes in every look, frame-exact (a stepped clock), as stills or as
  frames for a clip.
- `test/fxlook.js`: the table is complete and in range, Classic is main's numbers, switching back clears a look.
- `test/visuals.mjs` still covers the pipeline (Classic).

## Open
- Which looks to keep (owner), then the cost on a real GPU and a phone: headless tests here use software rendering,
  which says nothing about GPU frame time.

## Art styles: characters and the world (`public/artlook.js`)
A second, separate pair of choices, shown to the owner next to the effects looks. Unlike a look they pick materials
and geometry, so they are fixed when the page loads (`?char=<id>&env=<id>`, or Settings → Graphics, then reload).
`classic` is what main draws for both.

- **Character styles** (`CHARS`: classic, cel, hero, soft, ink) apply to every rigged character: cel shading
  (`toon` light bands), an outline (the rig drawn again, back faces only, pushed out along its normals: it doubles
  that character's draw calls), a rim light, colour strength, and proportions (head, legs, arms, body: bones scaled
  after the animation pose, with the rig rescaled so the character stays about as tall as before).
- **World styles** (`ENVS`: classic, meadow, alpine, dusk) apply to Floor 1 only: a sky dome with a sun glow, clouds,
  tree shape, grass tufts, flowers, ground colour patches (each one instanced batch), smooth or cel shading for the
  scenery, and the light and fog colours. Floors 2 and 3 are not restyled.
- `scripts/artshots.mjs` shoots a class line-up and scenery views in every style, on the same stepped clock.
- `test/artlook.js`: the tables are complete and in range, Classic is main's numbers, unknown ids fall back.

Known gaps, to fix once styles are chosen: a heavy outline shows spikes at hard edges (needs smoothed normals), a
weapon swapped in after the rig is built has no outline, monsters are not outlined, and none of it has been measured
on a real GPU.
