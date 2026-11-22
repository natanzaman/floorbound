// Items dropped on the ground: anyone can pick them up; they vanish after a few minutes.
import { BAG_SIZE, CONSUMABLES } from '../shared/items.js';
import { MATS } from '../shared/crafting.js';

export const GROUND = { life: 180, max: 80, reach: 2.4, ownerLock: 2 };
const r2 = v => Math.round(v * 100) / 100;

export const GroundMethods = {
  dropItem(p, u) {
    if (p.dead) return;
    const i = p.inv.bag.findIndex(it => it.u === u);
    if (i < 0) return;
    if (p.inv.bag[i].ks) return this.sys('A keepsake stays with you.', p.id);
    if (p.inv.bag[i].ac) return this.sys('Academy weapons stay with you (discard it if you want it gone).', p.id);
    const [it] = p.inv.bag.splice(i, 1);
    this.ground ||= new Map();
    let x = p.x + Math.sin(p.face || 0) * 1.1, z = p.z + Math.cos(p.face || 0) * 1.1;
    if (!this.walk(x, z)) { x = p.x; z = p.z; }
    const id = this.id();
    this.ground.set(id, { id, it, name: it.name, r: it.r, x, z, until: this.time + GROUND.life, by: p.id, byUntil: this.time + GROUND.ownerLock });
    if (this.ground.size > GROUND.max) this.ground.delete(this.ground.keys().next().value); // oldest goes first
    this.groundDirty = true;
    this.sys(`Dropped ${it.name}. Anyone can pick it up for the next 3 minutes.`, p.id);
    this.events.push({ t: 'gdrop', id: p.id, x: r2(x), z: r2(z), r: it.r });
    this.track(p, 'drop', { r: it.r, slot: it.slot });
    this.invChanged(p);
  },

  pickUp(p, id) {
    const g = this.ground?.get(id);
    if (!g || p.dead) return;
    if (Math.hypot(p.x - g.x, p.z - g.z) > GROUND.reach + 1) return;
    if (g.by === p.id && this.time < g.byUntil) return;
    if (g.stack) { // potions or materials: no bag slot needed
      if (g.stack.kind !== 'cons' && this.lifeRoom && !this.lifeRoom(p, g.stack.id, g.stack.n)) return this.sys(`You can't carry that many ${g.name}: a life material stack stops at 99.`, p.id); // (server/life.js)
      const pool = g.stack.kind === 'cons' ? p.inv.cons : (p.inv.mats ||= {});
      pool[g.stack.id] = (pool[g.stack.id] || 0) + g.stack.n;
    } else {
      if (p.inv.bag.length >= BAG_SIZE) return this.sys('Your bag is full.', p.id);
      p.inv.bag.push(g.it);
    }
    this.ground.delete(id);
    this.groundDirty = true;
    this.sys(`Picked up ${g.name}.`, p.id);
    this.events.push({ t: 'gpick', id: p.id, x: r2(g.x), z: r2(g.z) });
    this.track(p, 'pickup', { r: g.r, own: g.by === p.id ? 1 : 0, stack: g.stack ? 1 : 0 });
    this.invChanged(p);
  },

  // Potions and materials: drop or delete n of them (n <= what you have).
  stackOf(p, kind, sid) {
    const pool = kind === 'cons' ? (CONSUMABLES[sid] ? p.inv.cons : null) : kind === 'mat' ? (MATS[sid] ? (p.inv.mats ||= {}) : null) : null;
    return pool && pool[sid] > 0 ? pool : null;
  },
  stackName(kind, sid, n) { return `${kind === 'cons' ? CONSUMABLES[sid].name : MATS[sid].name}${n > 1 ? ` ×${n}` : ''}`; },

  dropStack(p, kind, sid, n) {
    if (p.dead) return;
    const pool = this.stackOf(p, kind, sid);
    if (!pool) return;
    n = Math.max(1, Math.min(pool[sid], n | 0 || 1));
    pool[sid] -= n;
    this.ground ||= new Map();
    let x = p.x + Math.sin(p.face || 0) * 1.1, z = p.z + Math.cos(p.face || 0) * 1.1;
    if (!this.walk(x, z)) { x = p.x; z = p.z; }
    const id = this.id(), name = this.stackName(kind, sid, n);
    this.ground.set(id, { id, stack: { kind, id: sid, n }, name, r: 0, x, z, until: this.time + GROUND.life, by: p.id, byUntil: this.time + GROUND.ownerLock });
    if (this.ground.size > GROUND.max) this.ground.delete(this.ground.keys().next().value);
    this.groundDirty = true;
    this.sys(`Dropped ${name}.`, p.id);
    this.events.push({ t: 'gdrop', id: p.id, x: r2(x), z: r2(z), r: 0 });
    this.invChanged(p);
  },

  discardStack(p, kind, sid, n) {
    const pool = this.stackOf(p, kind, sid);
    if (!pool) return;
    n = Math.max(1, Math.min(pool[sid], n | 0 || 1));
    pool[sid] -= n;
    this.sys(`Deleted ${this.stackName(kind, sid, n)}.`, p.id);
    this.invChanged(p);
  },

  updateGround() {
    if (!this.ground?.size) return;
    for (const [id, g] of this.ground) if (this.time >= g.until) { this.ground.delete(id); this.groundDirty = true; }
  },

  // Sent with the snapshot when the list changes, and once a second for new arrivals.
  groundSnap() {
    if (!this.groundDirty && this.time - (this.groundSentAt || -9) < 1) return undefined;
    this.groundDirty = false; this.groundSentAt = this.time;
    return [...(this.ground?.values() || [])].map(g => [g.id, r2(g.x), r2(g.z), g.r, g.name]);
  },
};
