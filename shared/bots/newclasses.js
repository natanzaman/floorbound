// Plug-ins for the classes added after the per-bot brain: Ranger / Berserker (shared/classes/bots-a.js) and
// Lancer / Bard (shared/classes/bots-b.js). Their combat logic is unchanged; this only adapts it to the registry.
import { registerClassBrain } from './registry.js';
import { TEAM_NAMES_A, onEventA, brainA } from '../classes/bots-a.js';
import { CLASS_BRAINS_B, TEAM_NAMES_B, botEventB } from '../classes/bots-b.js';

for (const c of ['ranger', 'berserker']) {
  registerClassBrain(c, { role: 'dps', name: TEAM_NAMES_A[c], combat: (b, t, ctx) => brainA(b, t, ctx), onEvent: onEventA });
}
// bots-b brains take (ctx, b, tgt, dodge) and expect ctx.anchor to be a function.
const wrap = fn => (b, t, ctx) => (fn({ ...ctx, anchor: () => ctx.anchor }, b, t, ctx.dodge), true);
registerClassBrain('lancer', { role: 'dps', name: TEAM_NAMES_B.lancer, combat: wrap(CLASS_BRAINS_B.lancer), onEvent: botEventB });
registerClassBrain('bard', { role: 'support', name: TEAM_NAMES_B.bard, combat: wrap(CLASS_BRAINS_B.bard), onEvent: botEventB });
