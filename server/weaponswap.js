// Two weapons, swap mid-fight (docs/briefs/combat-quickwins.md 3), mixed into Game by installWeaponSwap (end of game.js).
//  - inv.eq.weapon2: a second weapon of your class. Old saves have none (undefined = empty). gearStats and the style
//    read only inv.eq.weapon (SLOTS), so the spare gives nothing until it is swapped in.
//  - { type: 'equip2', u }: a weapon from the bag into the second slot (the old spare goes back to the bag).
//    { type: 'unequip', slot: 'weapon2' } takes it off (game.js unequip). { type: 'swap' }: trade the two.
//  - A swap: SWAP.cd s apart, never downed, dead, guarding, rolling, airborne, trapped, posing, in a boss arena's fall,
//    within SWAP.busy s of a skill press or while a skill is still being used (its own delayed hits: p.useUntil);
//    cooldowns carry over; the basic combo restarts.
//  - A swap between two styles is a step in skill chains, but only once a hit lands after it in the new style
//    (p.swapPend, checked by server/chains.js through swapLanded): the step is booked at the swap's own time, so the
//    hit that proves it is still a step of its own. A swap between two weapons of one style is never a step.
//  - A loadout that wears the spare as its weapon swaps the two (applyLoadout wrapper).
// Events: { t: 'wswap', id, st (the new style id) }.
import { SWAP } from '../shared/styles.js';
import { CHAIN } from '../shared/chains.js';
import { ARENAS, inRoom } from '../shared/arenas.js';

const methods = {
  equip2(p, u) {
    const i = p.inv.bag.findIndex(it => it.u === u);
    if (i < 0) return;
    const it = p.inv.bag[i];
    if (it.slot !== 'weapon') return;
    if (it.cls && it.cls !== p.cls) return this.sys('Your second weapon must be one of your own class.', p.id);
    p.inv.bag.splice(i, 1);
    const old = p.inv.eq.weapon2;
    if (old) p.inv.bag.splice(i, 0, old);
    p.inv.eq.weapon2 = it;
    this.invChanged(p);
  },
  swapBlock(p) {
    const t = this.time;
    if (p.dead || p.downed || p.guarding || p.trap || p.pose) return 'busy';
    if (t < (p.rollUntil || 0) || t < (p.airUntil || 0) || t < (p.useUntil || 0)) return 'busy'; // mid-roll, mid-jump, mid-skill
    if (this.inArenaFall(p)) return 'busy';
    if (!p.inv?.eq?.weapon2) return 'none';
    if (t < (p.swapCd || 0)) return 'cd';
    for (const at of Object.values(p.chPress || {})) if (t - at < SWAP.busy) return 'busy';
    return null;
  },
  swapWeapon(p) {
    const why = this.swapBlock(p);
    if (why) { if (why === 'none') this.sys('No second weapon: equip one as your 2nd weapon from the bag.', p.id); return false; }
    const eq = p.inv.eq, t = this.time, from = p.style || '';
    if (eq.weapon2.cls && eq.weapon2.cls !== p.cls) return false; // (a class change left a foreign spare: unequip it)
    [eq.weapon, eq.weapon2] = [eq.weapon2, eq.weapon || null];
    p.swapCd = t + SWAP.cd;
    p.combo = 0; p.lastBasic = -9;
    this.recompute(p); this.invChanged(p);
    this.events.push({ t: 'wswap', id: p.id, st: p.style || '' });
    p.swapPend = !this.duelOf?.(p) && (p.style || '') !== from ? { at: t, from } : null; // a chain step once a hit lands
    return true;
  },
  // A boss arena's fall (server/arenas.js) is running in the room p stands in.
  inArenaFall(p) {
    for (const key of Object.keys(ARENAS)) {
      const m = this.arenaBoss?.(key);
      if (m && !m.dead && this.arenaHold?.(m) === 2 && inRoom(ARENAS[key], p.x, p.z)) return true;
    }
    return false;
  },
  // A hit of p's landed (server/chains.js): a pending swap into another style becomes a chain step, booked at its own time.
  swapLanded(p, m) {
    const s = p.swapPend;
    p.swapPend = null;
    if (!s || this.time - s.at > CHAIN.window || (p.style || '') === s.from) return null;
    return this.chainNote?.(p, SWAP.step, m, s.at);
  },
};

export function installWeaponSwap(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const handle = P.handle;
  P.handle = function (p, msg) {
    if (msg?.type === 'swap') return this.swapWeapon(p);
    if (msg?.type === 'equip2') return this.equip2(p, msg.u | 0);
    return handle.call(this, p, msg);
  };
  // p.useUntil: a skill is in use until its last own delayed hit (the same delays server/pacing.js reads; effectLater
  // effects such as falling rain clear this._useCap first, so they don't count).
  const useSkill = P.useSkill, schedule = P.schedule;
  P.useSkill = function (p, slot, face) {
    const prev = this._swapUse, cap = { max: 0 }, before = p?.cds?.[slot];
    this._swapUse = cap;
    try {
      const out = useSkill.call(this, p, slot, face);
      if (p && p.cds?.[slot] !== before && cap.max > 0) p.useUntil = Math.max(p.useUntil || 0, this.time + cap.max);
      return out;
    } finally { this._swapUse = prev; }
  };
  P.schedule = function (delay, fn) {
    const cap = this._swapUse;
    if (cap && this._useCap !== null && delay > cap.max) cap.max = delay;
    return schedule.call(this, delay, fn);
  };
  const applyLoadout = P.applyLoadout;
  if (applyLoadout) P.applyLoadout = function (p, lo) {
    const eq = p.inv.eq, u = lo?.eq?.weapon;
    if (u && eq.weapon2?.u === u && eq.weapon?.u !== u) [eq.weapon, eq.weapon2] = [eq.weapon2, eq.weapon || null]; // the spare is the loadout's weapon
    return applyLoadout.call(this, p, lo);
  };
}
