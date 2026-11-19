// Looks (docs/ROADMAP.md I2): a character's own, recognisable appearance, as data. The home of every look definition.
//   server/looks.js   game.setLook(entity, id): stores the look id and lists it in snapshots (w.looks), so every client
//                     sees it. Works for any entity with an id (players, bots, the Named, mobs). Opt-in: nothing has a
//                     look unless something calls setLook.
//   public/looks.js   builds the look on the client from this table (the KayKit rig plus procedural meshes, the way
//                     public/styles.js builds weapons), the nameplate treatment and the swatch for UI lists.
// shared/named.js refers to a look by its id (look: { id: 'cairn', color }); the ids here are the Named's own ids.
//
// A look: { name, base, scale, hide, tint, hair, cloak, weapon, aura, plate, swatch, emblem }. Every field is optional.
//   base     another look id to start from (a party's shared colours; the member's own fields win, one level deep per key)
//   scale    model height factor
//   hide     rig attachments to hide, by the end of their name ('Cape' hides Rogue_Cape, Knight_Cape, ...)
//   tint     { ramp: [dark, light], amount, keepSkin }: the rig's texture remapped onto a two-colour ramp (amount 0-1),
//            leaving skin tones alone; or { color } to multiply
//   hair     { kind: 'hood', color, lining, tail: { len, color }, mask }: headwear (mask: a band over the lower face)
//   cloak    { kind: 'coat' | 'cape', color, lining, ... }; a coat can carry a one-shoulder mantle (mark: an emblem on
//            it); a cape has an emblem on the back
//   weapon   { model, ...colours, offhand: 'hide' | 'keep' }: replaces the held weapon model (the style still plays)
//   aura     { color, ground: { r, opacity }, motes: { rate, life, size, rise }, trail: { rate, life, size } }
//   plate    { color, glow, title }: nameplate colour and a title line under the name (the swatch sits before the name)
//   swatch   { bg, fg, accent }: the round badge in UI lists and nameplates, with the emblem
//   emblem   an emblem shape id (public/looks.js EMBLEMS): on swatches (capes and mantles name theirs)
// Colours are 0xRRGGBB numbers.

const WISP = 0xd8ff5a, ASH = 0xd9d4c7, SOOT = 0x1c1b22;
const EMBER = 0xff6f59, CREAM = 0xfff1d6;

export const LOOKS = {
  // Cairn, the loner: an ash-pale hunter who walks alone. A long tattered coat over soot-black, a deep hood with a long
  // tail down the back and a dark band over the mouth, a dark half-mantle on the left shoulder bearing his mark (three
  // stacked stones, faintly lit), and a hooked glaive with a caged wisp-lantern swinging from the hook. Wisp-light (a pale
  // yellow-green nobody else carries) drifts up from the lantern and trails behind him. The one colourless figure in a
  // colourful world.
  cairn: {
    name: 'Cairn, the Last Lamp',
    scale: 1.1,
    hide: ['Cape', 'Hat', 'Helmet'],
    tint: { ramp: [SOOT, 0x9d988c], amount: 0.92, keepSkin: true },
    hair: { kind: 'hood', color: ASH, lining: SOOT, tail: { len: 1.5, color: ASH }, mask: SOOT },
    cloak: {
      kind: 'coat', color: ASH, lining: SOOT, length: 0.5, flare: 0.5, tails: 7, ragged: 0.45, collar: { color: ASH, height: 0.2 },
      mantle: { side: 'l', color: 0x26232c, trim: ASH, length: 0.62, mark: 'cairn', markColor: WISP },
    },
    weapon: { model: 'lanternglaive', haft: 0x2a2730, steel: 0xe9e6dc, cage: 0x3a3d45, flame: WISP, offhand: 'hide' },
    aura: { color: WISP, ground: { r: 1.5, opacity: 0.16 }, motes: { rate: 3, life: 1.6, size: 0.07, rise: 0.55 }, trail: { rate: 9, life: 1.1, size: 0.11 } },
    plate: { color: '#e6ff8f', glow: '#a3c520', title: 'the Last Lamp' },
    swatch: { bg: SOOT, fg: ASH, accent: WISP },
    emblem: 'cairn',
  },

  // The Hearthward (the Heroes Party): light touches only. A short ember-coloured cape with the hearth-flame emblem, a
  // matching nameplate, and one trim colour each. Their own rigs and weapons stay.
  hearthward: {
    name: 'The Hearthward',
    hide: ['Cape'],
    cloak: { kind: 'cape', color: EMBER, trim: CREAM, length: 0.52, emblem: 'hearth', emblemColor: CREAM },
    plate: { color: '#ffb4a6', glow: '#c2410c', title: 'Hearthward' },
    swatch: { bg: EMBER, fg: CREAM, accent: CREAM },
    emblem: 'hearth',
  },
  halvard: { base: 'hearthward', name: 'Halvard of the Hearthward', cloak: { trim: 0xe0a53a, length: 0.6 }, swatch: { accent: 0xe0a53a } },
  maribel: { base: 'hearthward', name: 'Maribel of the Hearthward', cloak: { trim: 0x7fd6a4 }, swatch: { accent: 0x7fd6a4 } },
  tovin: { base: 'hearthward', name: 'Tovin of the Hearthward', cloak: { trim: 0x4fc3d9, length: 0.46 }, swatch: { accent: 0x4fc3d9 } },
  sennet: { base: 'hearthward', name: 'Sennet of the Hearthward', cloak: { trim: 0xb18cf2, length: 0.56 }, swatch: { accent: 0xb18cf2 } },
};

export const LOOK_IDS = Object.keys(LOOKS); // snapshots send the index
export const isLook = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(LOOKS, id);

// A look with its base folded in (the look's own fields win; nested objects merge one level deep). null: no such look.
const cache = new Map();
export function lookOf(id) {
  if (!isLook(id)) return null;
  if (cache.has(id)) return cache.get(id);
  const own = LOOKS[id], base = isLook(own.base) && own.base !== id ? LOOKS[own.base] : null;
  const out = { id };
  for (const src of base ? [base, own] : [own]) {
    for (const [k, v] of Object.entries(src)) {
      if (k === 'base') continue;
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? { ...out[k], ...v } : v;
    }
  }
  cache.set(id, out);
  return out;
}

const PARTS = ['hair', 'cloak', 'weapon', 'aura', 'plate', 'swatch', 'tint'];
// Problems in the table (test/looks.js): unknown bases, parts that aren't objects, colours out of range.
export function validateLooks(table = LOOKS) {
  const errs = [];
  const colour = (id, k, v) => { if (!Number.isInteger(v) || v < 0 || v > 0xffffff) errs.push(`${id}.${k}: not a colour`); };
  for (const [id, l] of Object.entries(table)) {
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(id)) errs.push(`${id}: look ids are short lower-case words`);
    if (l.base !== undefined && (!table[l.base] || l.base === id || table[l.base].base)) errs.push(`${id}: bad base`);
    if (l.scale !== undefined && !(l.scale >= 0.8 && l.scale <= 1.3)) errs.push(`${id}.scale: 0.8 to 1.3`);
    if (l.hide !== undefined && !(Array.isArray(l.hide) && l.hide.every(s => typeof s === 'string'))) errs.push(`${id}.hide: a list of names`);
    for (const k of PARTS) {
      const v = l[k];
      if (v === undefined) continue;
      if (!v || typeof v !== 'object' || Array.isArray(v)) { errs.push(`${id}.${k}: not an object`); continue; }
      for (const [f, c] of Object.entries(v)) if (/^(color|lining|trim|haft|steel|cage|flame|mask|markColor|bg|fg|accent|emblemColor)$/.test(f) && k !== 'plate') colour(id, `${k}.${f}`, c);
    }
    if (l.plate) for (const f of ['color', 'glow']) if (l.plate[f] !== undefined && !/^#[0-9a-f]{6}$/i.test(l.plate[f])) errs.push(`${id}.plate.${f}: #rrggbb`);
  }
  return errs;
}
