// Clutch moments (docs/briefs/combat-quickwins.md 4, server/clutch.js): the LAST STAND callout, and the finisher's
// slow-motion beat for everyone in the fight when a floor boss falls to a Team Burst or the Last Attack (visual only;
// main.js slowMotion skips it under Settings → Reduce motion).
import { FINISHER, LAST_STAND } from '/shared/clutch.js';

export function initClutch({ state, players, fx, sfx, callout, floatNum, slowMotion }) {
  function event(e) {
    if (e.t === 'lstand') {
      const p = players.get(e.id);
      if (p) floatNum(p.model.group.position, 2.3, 'LAST STAND', 'crit');
      fx.ring(e.x, e.z, 2.2, 0xfde047, 0.6);
      if (e.id === state.myId) { callout('LAST STAND', `A clutch save: ${LAST_STAND.invuln} s untouchable. Get out!`, 1.8); sfx.play('switch', null, 1.2); }
      return true;
    }
    if (e.t === 'finisher') {
      if (!state.spectator && !(e.ids || []).includes(state.myId)) return true;
      slowMotion(FINISHER.secs, FINISHER.scale); // (nothing under Reduce motion)
      if (e.tb) callout('TEAM FINISHER', 'The Team Burst brought it down!', 1.6);
      return true;
    }
    return false;
  }
  return { event };
}
