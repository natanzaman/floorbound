// Ability pacing (PACE in shared/data.js): a skill's cooldown starts when the skill has finished being used, that is
// when its last own delayed hit lands (a draw, a leap, the gaps of a combo), not on the press.
// Installed LAST at the end of server/game.js (after installTalents), so:
//  - this useSkill wrapper runs outside every other one (talents, classes) and sees the final cooldown;
//  - this schedule wrapper sees each delayed hit first, then passes it on to talents.js's schedule wrapper (which hands
//    the skill id on to the delayed hit), so talents keep working.
// Rules:
//  - While a skill runs, schedule() records the longest delay; afterwards, if a skill in slots 1-3 started its
//    cooldown, the cooldown is pushed back by that delay. Instant skills schedule nothing, so they are unchanged.
//  - Basic attacks (slot 0) are exempt: their cooldown is the swing rhythm.
//  - effectLater(delay, fn): schedule a lingering effect that is not use time (Rain of Arrows' falling rain).
export function installPacing(Game) {
  const P = Game.prototype;
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  P.effectLater = function (delay, fn) {
    const cap = this._useCap;
    this._useCap = null;
    try { return this.schedule(delay, fn); } finally { this._useCap = cap; }
  };

  wrap('schedule', function (orig, delay, fn) {
    const cap = this._useCap;
    if (cap && delay > cap.max) cap.max = delay;
    return orig.call(this, delay, fn);
  });

  wrap('useSkill', function (orig, p, slot, face) {
    const prev = this._useCap, cap = { max: 0 }, before = p?.cds?.[slot];
    this._useCap = cap;
    try {
      const r = orig.call(this, p, slot, face);
      if (slot > 0 && cap.max > 0 && p.cds[slot] !== before && p.cds[slot] > this.time) p.cds[slot] += cap.max;
      return r;
    } finally { this._useCap = prev; }
  });
}
