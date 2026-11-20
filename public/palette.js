// One palette table for every telegraph and danger colour on the client (DOM-free, so node can test it: test/access.js).
// 'off' is the game's own colours, unchanged. 'deuter' (red-green) and 'trit' (blue-yellow) swap in colours that stay apart
// for that kind of colour blindness; both also turn on a dashed edge (see Effects.dashes in world.js) so colour is never
// the only cue. Settings → Accessibility sets the mode (applyAccess in public/settings.js).
export const PALETTE_MODES = ['off', 'deuter', 'trit'];
const TABLE = {
  //            off (today)  deuter     trit
  dangerEdge: [0xff2a2a, 0xffb000, 0xff2d7a], // ground telegraph edge, charge lane edge
  dangerFill: [0xff3b3b, 0xff7a00, 0xff4d94], // telegraph fill, wedge, aim line, charge lane fill
  dangerBase: [0x7f1d1d, 0x5a2d00, 0x6b0030],
  dangerCloser: [0xffd0c0, 0xffffff, 0xffd0e4], // the ring closing in on impact
  sweepEdge: [0xf59e0b, 0xfff3b0, 0xff9ec7],  // the Warden's Horn Sweep
  sweepInner: [0xfde047, 0xffffff, 0xffffff],
  sweepFill: [0xfb923c, 0xffd23f, 0xff6fa8],
  echoEdge: [0xc084fc, 0x6ea8ff, 0xf5f5f5],   // Warden twist: Echo strike
  echoFill: [0xa855f7, 0x3b82f6, 0xbdbdbd],
  trapVines: [0x65a30d, 0xe69f00, 0x65a30d],  // rescue traps (green vines are the red-green trap)
  trapPillar: [0x38bdf8, 0x38bdf8, 0xffffff],
  trapCrystal: [0x67e8f9, 0xffffff, 0xffffff],
};
const state = { mode: 'off', cues: false };

export function setPalette(mode) { state.mode = PALETTE_MODES.includes(mode) ? mode : 'off'; }
export const paletteMode = () => state.mode;
export const patterned = () => state.mode !== 'off'; // draw the dashed pattern cue
export function col(name) {
  const row = TABLE[name];
  if (!row) throw new Error(`palette: unknown colour ${name}`);
  return row[PALETTE_MODES.indexOf(state.mode)];
}
export function setTelegraphCues(on) { state.cues = !!on; }
export const telegraphCues = () => state.cues;
export const PALETTE_NAMES = Object.keys(TABLE);
// A short distinct chirp (audio.js 'cue') when a telegraph starts, if Settings → "Sound cue for attacks" is on.
export function cue(sfx, pos, vol = 1) { if (state.cues) sfx.play('cue', pos, vol); }
