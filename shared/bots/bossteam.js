// Bots and the boss team mechanics (docs/ROADMAP.md G4, server/bossteam.js): stack into the shared meteor, spread out
// from SPREAD markers, run a tether apart. The 'bt' events go through the bot's capability perception first
// (shared/botskill.js: a lower level sees them late or misses them); moveToward adds its positioning noise.
// The brain asks mechSpot(b) for a spot each turn after dodging telegraphs (a red circle still comes first).
import { WORLD, walkable, inArena } from '../data.js';
import { F2, inArena2, onFloor2 } from '../floor2.js';
import { F3, inArena3, onFloor3 } from '../floor3.js';
import { registerBotHook, roleOf } from './registry.js';

const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

registerBotHook('onEvent', (b, e) => {
  const S = (b.bt ||= {});
  if (e.t === 'bt') {
    if (e.k === 'stack') S.stack = { id: e.id, r: e.r, at: b.t + e.d };
    else if (e.k === 'spread') S.spread = { ids: e.ids, r: e.r, at: b.t + e.d };
    else if (e.k === 'tether') S.tether = { a: e.a, b: e.b, need: e.need, until: b.t + e.d };
  } else if (e.t === 'btend') {
    if (e.k === 'stack' && S.stack?.id === e.id) S.stack = null;
    if (e.k === 'spread') S.spread = null;
    if (e.k === 'tether' && S.tether?.a === e.a && S.tether?.b === e.b) S.tether = null;
  }
});

const room = b => (onFloor3(b.x) ? { x: F3.arena.x, z: F3.arena.z, r: F3.arena.r, in: inArena3 } : onFloor2(b.x) ? { x: F2.arena.x, z: F2.arena.z, r: F2.arena.r, in: inArena2 } : { x: WORLD.arena.x, z: WORLD.arena.z, r: WORLD.arena.r, in: inArena });
const inside = (b, R, x, z, margin = 2) => d2(x, z, R.x, R.z) < R.r - margin && walkable(x, z, !b.gateOpen);
const pos = (b, id) => (id === b.id ? { id, x: b.x, z: b.z, dead: b.dead, cls: b.cls } : b.players.find(p => p.id === id) || null);
const isTank = (b, p) => (p.id === b.id ? b.role : roleOf(p.cls)) === 'tank';

// Where this bot should be for an active team mechanic, or null (no mechanic for it: fight as usual). Its own spot means
// "hold here" (the brain then keeps it from walking off, but it still attacks and casts).
export function mechSpot(b) {
  const S = b.bt;
  if (!S || b.dead) return null;
  const R = room(b);
  if (!R.in(b.x, b.z)) return null;
  const live = b.players.filter(p => !p.dead && p.id !== b.id && R.in(p.x, p.z));
  // Tether: get `need` m from the other end (a tank holding the boss stays; the other end runs).
  const te = S.tether;
  if (te && te.until > b.t && (te.a === b.id || te.b === b.id)) {
    const o = pos(b, te.a === b.id ? te.b : te.a);
    if (o && !o.dead && d2(b.x, b.z, o.x, o.z) < te.need + 0.5 && !(isTank(b, { id: b.id }) && !isTank(b, o))) {
      const a0 = Math.atan2(b.x - o.x, b.z - o.z), want = te.need + 2.5;
      for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2]) {
        const x = o.x + Math.sin(a0 + off) * want, z = o.z + Math.cos(a0 + off) * want;
        if (inside(b, R, x, z)) return [x, z];
      }
      return [R.x + (R.x - o.x), R.z + (R.z - o.z)]; // across the room from it
    }
  }
  // Spread: carriers keep `r` m from everyone; the rest keep `r` m from every carrier. A marked tank holds the boss.
  const sp = S.spread;
  if (sp && sp.at > b.t - 0.1) {
    const mine = sp.ids.includes(b.id);
    const threats = mine ? live : live.filter(p => sp.ids.includes(p.id));
    const safe = sp.r + 1.2;
    if (!(mine && b.role === 'tank') && threats.some(p => d2(p.x, p.z, b.x, b.z) < safe)) {
      let best = null, bs = Infinity;
      for (const rad of [3, 5, 7, 9, 11, 13]) for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, x = b.x + Math.sin(a) * rad, z = b.z + Math.cos(a) * rad;
        if (!inside(b, R, x, z)) continue;
        let s = rad * 0.5;
        for (const p of threats) { const d = d2(p.x, p.z, x, z); if (d < safe + 0.5) s += (safe + 0.5 - d) * 10; }
        if (s < bs) { bs = s; best = [x, z]; }
      }
      if (best) return best;
    }
  }
  // Shared meteor: the carrier walks to the tank (else the party's middle) and holds still for the last moment;
  // everyone else gets inside the circle around the carrier.
  const st = S.stack;
  if (st && st.at > b.t - 0.1) {
    if (st.id === b.id) {
      if (st.at - b.t < 0.7) return [b.x, b.z]; // hold still (no kiting) so the circle lands on the group
      const mates = live.filter(p => !b.party || p.party === b.party);
      const tank = mates.find(p => isTank(b, p));
      const to = tank || (mates.length ? { x: mates.reduce((s, p) => s + p.x, 0) / mates.length, z: mates.reduce((s, p) => s + p.z, 0) / mates.length } : null);
      return to && d2(b.x, b.z, to.x, to.z) > 1.8 ? [to.x, to.z] : [b.x, b.z];
    }
    const c = pos(b, st.id);
    if (c && !c.dead) {
      const d = d2(b.x, b.z, c.x, c.z), k = st.r - 1.6;
      if (d > st.r - 1.1) return d > 0.01 ? [c.x + ((b.x - c.x) / d) * k, c.z + ((b.z - c.z) / d) * k] : [c.x, c.z];
      return [b.x, b.z]; // inside: stay (no chasing the boss or kiting out of it), still swinging and casting
    }
  }
  return null;
}
