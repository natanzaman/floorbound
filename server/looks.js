// Looks (docs/ROADMAP.md I2; data: shared/looks.js, client: public/looks.js).
//   setLook(entity, id)   give any entity with an id (a player, a bot, a Named, a mob) a look, or clear it (null).
//                         Returns whether it changed. Unknown ids are refused.
//   looksSnap()           [[entityId, lookId], ...] in every snapshot while any is worn (w.looks, left out when empty),
//                         so late joiners and spectators see it too, and the player rows bots index into stay as they are.
// Opt-in: nothing has a look until something calls setLook (the Named: shared/named.js; an admin on a bot; TEST_HOOKS).
import { isLook } from '../shared/looks.js';

export const LookMethods = {
  setLook(e, id) {
    if (id === 'none' || id === '') id = null;
    if (!e || (id != null && !isLook(id))) return false;
    if ((e.look || null) === (id ?? null)) return false;
    e.look = id ?? null;
    return true;
  },
  looksSnap() {
    const out = [];
    for (const p of this.players.values()) if (p.look) out.push([p.id, p.look]);
    for (const m of this.mobs.values()) if (m.look && !m.dead && !m.hidden) out.push([m.id, m.look]);
    return out.length ? out : undefined; // undefined: JSON.stringify leaves the key out
  },
};

export function installLooks(Game) {
  const P = Game.prototype;
  Object.assign(P, LookMethods);
  const handle = P.handle;
  P.handle = function (p, msg) { // testing aid (TEST_HOOKS=1 only): { type: 'test', look: id | null } wears a look yourself
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.look !== undefined && p) { this.setLook(p, msg.look); return; }
    return handle.call(this, p, msg);
  };
}
