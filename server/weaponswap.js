// Two weapons, swap mid-fight (docs/briefs/combat-quickwins.md 3), mixed into Game by installWeaponSwap (end of game.js).
//  - inv.eq.weapon2: a second weapon of your class. Old saves have none (undefined = empty). gearStats and the style
//    read only inv.eq.weapon (SLOTS), so the spare gives nothing until it is swapped in.
//  - { type: 'equip2', u }: a weapon from the bag into the second slot (the old spare goes back to the bag).
//    { type: 'unequip', slot: 'weapon2' } takes it off (game.js unequip). { type: 'swap' }: trade the two.
//  - A swap: SWAP.cd s apart, never downed, dead, guarding or within SWAP.busy s of a skill press (mid-skill);
//    cooldowns carry over; the basic combo restarts; it is a step in skill chains (server/chains.js chainNote).
// Events: { t: 'wswap', id, st (the new style id) }.
import { SWAP } from '../shared/styles.js';

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
    if (p.dead || p.downed || p.guarding) return 'busy';
    if (!p.inv?.eq?.weapon2) return 'none';
    const t = this.time;
    if (t < (p.swapCd || 0)) return 'cd';
    for (const at of Object.values(p.chPress || {})) if (t - at < SWAP.busy) return 'busy';
    return null;
  },
  swapWeapon(p) {
    const why = this.swapBlock(p);
    if (why) { if (why === 'none') this.sys('No second weapon: equip one as your 2nd weapon from the bag.', p.id); return false; }
    const eq = p.inv.eq, t = this.time;
    if (eq.weapon2.cls && eq.weapon2.cls !== p.cls) return false; // (a class change left a foreign spare: unequip it)
    [eq.weapon, eq.weapon2] = [eq.weapon2, eq.weapon || null];
    p.swapCd = t + SWAP.cd;
    p.combo = 0; p.lastBasic = -9;
    this.recompute(p); this.invChanged(p);
    this.events.push({ t: 'wswap', id: p.id, st: p.style || '' });
    if (!this.duelOf?.(p)) this.chainNote?.(p, SWAP.step, null);
    return true;
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
}
