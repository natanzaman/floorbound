// Items dropped on the ground: anyone can pick them up; they vanish after a few minutes.
import { BAG_SIZE } from '../shared/items.js';

export const GROUND = { life: 180, max: 80, reach: 2.4, ownerLock: 2 };
const r2 = v => Math.round(v * 100) / 100;

export const GroundMethods = {
  dropItem(p, u) {
    if (p.dead) return;
    const i = p.inv.bag.findIndex(it => it.u === u);
    if (i < 0) return;
    const [it] = p.inv.bag.splice(i, 1);
    this.ground ||= new Map();
    let x = p.x + Math.sin(p.face || 0) * 1.1, z = p.z + Math.cos(p.face || 0) * 1.1;
    if (!this.walk(x, z)) { x = p.x; z = p.z; }
    const id = this.id();
    this.ground.set(id, { id, it, x, z, until: this.time + GROUND.life, by: p.id, byUntil: this.time + GROUND.ownerLock });
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
    if (g.it.cls && g.it.cls !== p.cls) { /* still allowed: it can be sold, salvaged or passed on */ }
    if (p.inv.bag.length >= BAG_SIZE) return this.sys('Your bag is full.', p.id);
    this.ground.delete(id);
    this.groundDirty = true;
    p.inv.bag.push(g.it);
    this.sys(`Picked up ${g.it.name}.`, p.id);
    this.events.push({ t: 'gpick', id: p.id, x: r2(g.x), z: r2(g.z) });
    this.track(p, 'pickup', { r: g.it.r, own: g.by === p.id ? 1 : 0 });
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
    return [...(this.ground?.values() || [])].map(g => [g.id, r2(g.x), r2(g.z), g.it.r, g.it.name]);
  },
};
