// Effects styles ("looks"): one table of numbers per look for everything the visuals pass draws: bloom and the colour
// grade (public/post.js), weapon trails and the 3D skill effects (public/vfx.js), hit sparks and flashes
// (public/sparks.js). A look changes uniforms and per-effect numbers only: no shader is compiled, no buffer is
// resized and no draw call is added when one is picked, so switching costs nothing and the looks cost about the same
// to draw (bloom `levels` and spark counts are the only parts that move the cost at all).
// Pick one with ?look=<id>, Settings → Graphics → Effects style, or __fb.setLook(id). `classic` is what main ships.
//
//  bloom: threshold / knee / bright (how much of a near-white pixel glows) · mask (how much a marked effect glows) ·
//         strength (added back) · shoulder (highlight roll-off) · vignette · levels (2-4 blur steps: fewer = tighter, cheaper)
//  grade: sat, contrast (about mid grey), gain (multiplies the light: a tint on highlights), lift (added to the darks)
//  trail: life (s) · inner (where the ribbon starts along the weapon, 0-1: smaller = wider) · gain · body / tipPow / edge
//         (the ribbon's cross-section: floor brightness, how fast it rises to the tip, an extra hard line at the tip) ·
//         white (hot core) · head + headMix (the class colour at the blade pulled towards a colour) · hue (the tail's hue
//         shift, turns) · tail + tailMix (a colour the tail fades towards)
//  spark: n / size / speed / life multipliers · grav, drag · shape (0 soft round … 1 tall hard shard) · core (white-hot
//         middle) · flash (impact star size) · tint + tintMix (every spark's colour pulled towards a colour)
//  fx:    a (strength) · white (hot core) · tall (shock walls and pillars) · blade (crescent size) · rocks (count) ·
//         gold + goldMix (the finisher / Break / crit gold pulled towards a colour) ·
//         tint + tintMix (class colours pulled towards a colour) · vivid (class colours more saturated) ·
//         solid (0 = pure glow: light added on top, as main does it; 0.3-1 = paint: effects, trails and sparks cover
//         what is behind them by that much, so their colour stays on bright ground instead of washing out to white)
export const LOOKS = {
  classic: {
    name: 'Classic', note: 'What is live now.',
    bloom: { threshold: 0.78, knee: 0.2, bright: 0.55, mask: 1.0, strength: 0.85, shoulder: 0.8, vignette: 0.16, levels: 4 },
    grade: { sat: 1, contrast: 1, gain: [1, 1, 1], lift: [0, 0, 0] },
    trail: { life: 0.28, inner: 0.42, gain: 1, body: 0.22, tipPow: 2, edge: 0, white: 0.3, head: 0xffffff, headMix: 0, hue: 0, tail: 0xffffff, tailMix: 0 },
    spark: { n: 1, size: 1, speed: 1, life: 1, grav: 18, drag: 0.9, shape: 0, core: 0.5, flash: 1, tint: 0xffffff, tintMix: 0 },
    fx: { a: 1, white: 0.55, tall: 1, blade: 1, rocks: 1, tint: 0xffffff, tintMix: 0, vivid: 0, solid: 0, gold: 0xffd76a, goldMix: 0 },
  },
  ember: {
    name: 'Ember Forge', note: 'Warm and heavy: white-hot cores, trails that cool to orange, showers of falling sparks.',
    bloom: { threshold: 0.72, knee: 0.22, bright: 0.6, mask: 1.2, strength: 1.1, shoulder: 0.78, vignette: 0.26, levels: 4 },
    grade: { sat: 1.06, contrast: 1.08, gain: [1.06, 1.0, 0.9], lift: [0.0, 0.006, 0.02] },
    trail: { life: 0.36, inner: 0.32, gain: 1.9, body: 0.3, tipPow: 1.6, edge: 0.25, white: 0.55, hue: 0, tail: 0xff3a0a, tailMix: 0.85, head: 0xffb347, headMix: 0.65 },
    spark: { n: 2.2, size: 1.0, speed: 1.3, life: 1.8, grav: 26, drag: 0.93, shape: 0, core: 0.8, flash: 1.15, tint: 0xff5a10, tintMix: 0.55 },
    fx: { a: 1.05, white: 0.7, tall: 1.15, blade: 1.05, rocks: 1.5, tint: 0xff9a3c, tintMix: 0.22, vivid: 0, solid: 0.55, gold: 0xff6a14, goldMix: 0.7 },
  },
  aether: {
    name: 'Aether Glass', note: 'Crisp and cool: thin razor trails, shard-shaped sparks that hang in the air, tight bloom.',
    bloom: { threshold: 0.84, knee: 0.14, bright: 0.45, mask: 0.95, strength: 0.75, shoulder: 0.84, vignette: 0.1, levels: 3 },
    grade: { sat: 0.95, contrast: 1.06, gain: [0.95, 1.0, 1.07], lift: [0.0, 0.006, 0.018] },
    trail: { life: 0.24, inner: 0.72, gain: 1.6, body: 0.1, tipPow: 3.5, edge: 0.9, white: 0.75, hue: 0, tail: 0x9fe8ff, tailMix: 0.5 },
    spark: { n: 1.2, size: 1.3, speed: 1.45, life: 0.95, grav: 5, drag: 0.86, shape: 1, core: 0.7, flash: 0.85, tint: 0x9fe8ff, tintMix: 0.8 },
    fx: { a: 0.9, white: 0.8, tall: 0.9, blade: 1.0, rocks: 0.8, tint: 0xffffff, tintMix: 0.3, vivid: 0, gold: 0xd6f4ff, goldMix: 0.85 },
  },
  neon: {
    name: 'Neon Arcade', note: 'Loud and saturated: long two-colour trails, big flashes, strong bloom.',
    bloom: { threshold: 0.7, knee: 0.25, bright: 0.6, mask: 1.35, strength: 1.3, shoulder: 0.76, vignette: 0.22, levels: 4 },
    grade: { sat: 1.22, contrast: 1.1, gain: [1.0, 0.99, 1.03], lift: [0.014, 0.0, 0.03] },
    trail: { life: 0.42, inner: 0.36, gain: 2.2, body: 0.35, tipPow: 1.4, edge: 0.4, white: 0.35, hue: 0.14, tail: 0xff3df2, tailMix: 0.35 },
    spark: { n: 1.4, size: 1.3, speed: 1.15, life: 1.25, grav: 14, drag: 0.9, shape: 0.35, core: 0.45, flash: 1.45, tint: 0x3df2ff, tintMix: 0.6 },
    fx: { a: 1.15, white: 0.45, tall: 1.1, blade: 1.15, rocks: 1, tint: 0xffffff, tintMix: 0, vivid: 0.35, solid: 0.9, gold: 0xff3df2, goldMix: 0.75 },
  },
  golden: {
    name: 'Golden Hour', note: 'Soft and sunlit: the whole scene glows a little, warm light, gentle effects.',
    bloom: { threshold: 0.56, knee: 0.34, bright: 0.85, mask: 0.9, strength: 0.95, shoulder: 0.7, vignette: 0.2, levels: 4 },
    grade: { sat: 1.1, contrast: 0.98, gain: [1.08, 1.02, 0.9], lift: [0.022, 0.012, 0.0] },
    trail: { life: 0.3, inner: 0.4, gain: 1.3, body: 0.25, tipPow: 2, edge: 0, white: 0.4, hue: 0, tail: 0xffd98a, tailMix: 0.45 },
    spark: { n: 1.1, size: 1.1, speed: 0.95, life: 1.2, grav: 12, drag: 0.9, shape: 0, core: 0.6, flash: 1.1, tint: 0xffc66a, tintMix: 0.4 },
    fx: { a: 0.95, white: 0.6, tall: 1, blade: 1, rocks: 1, tint: 0xffe2a8, tintMix: 0.18, vivid: 0, gold: 0xffb84a, goldMix: 0.5 },
  },
  lean: {
    name: 'Clean Steel', note: 'Quiet and sharp: short trails, fewer sparks, light bloom. The cheapest to draw.',
    bloom: { threshold: 0.82, knee: 0.16, bright: 0.45, mask: 0.8, strength: 0.6, shoulder: 0.84, vignette: 0.1, levels: 2 },
    grade: { sat: 1.0, contrast: 1.04, gain: [1, 1, 1], lift: [0, 0, 0] },
    trail: { life: 0.2, inner: 0.55, gain: 1.2, body: 0.15, tipPow: 2.6, edge: 0.3, white: 0.5, hue: 0, tail: 0xffffff, tailMix: 0.2 },
    spark: { n: 0.65, size: 0.9, speed: 1.1, life: 0.8, grav: 18, drag: 0.9, shape: 0.6, core: 0.6, flash: 0.85, tint: 0xffffff, tintMix: 0.5 },
    fx: { a: 0.9, white: 0.6, tall: 0.85, blade: 0.95, rocks: 0.7, tint: 0xffffff, tintMix: 0, vivid: 0, solid: 0.7, gold: 0xffffff, goldMix: 0.6 },
  },
};
export const LOOK_IDS = Object.keys(LOOKS);

/** The live look (mutated in place by setLook; post.js, vfx.js and sparks.js read it whenever they need a number). */
export const FXL = { id: 'classic', rev: 0, bloom: {}, grade: {}, trail: {}, spark: {}, fx: {} };
export function setLook(id) {
  const L = LOOKS[id] || LOOKS.classic;
  FXL.id = LOOKS[id] ? id : 'classic'; FXL.rev++;
  for (const k of ['bloom', 'grade', 'trail', 'spark', 'fx']) { for (const key in FXL[k]) delete FXL[k][key]; Object.assign(FXL[k], LOOKS.classic[k], L[k]); }
  return FXL;
}
setLook('classic');
