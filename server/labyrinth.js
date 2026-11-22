// Labyrinths (docs/briefs/labyrinths.md): the server side. Stairs in and out, spike plates, the floor's event (Floor 1:
// the crypt breathes), the mini-boss and its key, the key lock on the boss gate, and steering mobs through the maze.
// Data and geometry: shared/labyrinth.js. Client: public/labyrinth.js.
import { walkable, resolveCollision, inGateZone } from '../shared/data.js';
import { LABS, LAB_FLOORS, KEEPER, labAt, labSteer, cellCenter, hallCenter, startPoint, endPoint, inHall, trapState, onTrap, hasLabKey } from '../shared/labyrinth.js';

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const rr = ([a, b]) => a + Math.random() * (b - a);
// Testing aid: SPAWN_AT drops a tester past the content, so the key lock waives itself; LAB_GATE=0 turns it off.
const lockOn = () => process.env.LAB_GATE !== '0' && !process.env.SPAWN_AT;

export const LabMethods = {
  initLabs() {
    this.labs = {};
    for (const f of LAB_FLOORS) {
      const L = LABS[f], S = this.labs[f] = { breatheAt: 0, gutterUntil: 0, keeper: null, inside: 0 };
      for (const [type, c] of L.mobCells) {
        const [cx, cz] = cellCenter(L, c);
        const m = this.addMob(type, cx + (Math.random() - 0.5) * 4, cz + (Math.random() - 0.5) * 4);
        m.labF = f;
      }
      const [hx, hz] = hallCenter(L);
      S.keeper = this.addMob(L.keeper, hx, hz + 3);
      S.keeper.labF = f;
    }
  },

  // ---------- stairs ----------
  // a: 'in' (the stair in the field, down to the start), 'out' (back up from the start), 'up' (the stair at the end, out
  // to the boss gate)
  labStair(p, a) {
    if (p.dead) return;
    for (const f of LAB_FLOORS) {
      const L = LABS[f], [sx, sz] = startPoint(L), [ex, ez] = endPoint(L);
      const near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r + 0.5; // (a little extra reach for lag)
      let to = null;
      if (a === 'in' && near(L.entry.x, L.entry.z, L.entry.use)) to = [sx, sz - 1.5];
      else if (a === 'out' && near(sx, sz, L.use)) to = [L.back.x, L.back.z];
      else if (a === 'up' && near(ex, ez, L.use)) to = [L.exitTo.x, L.exitTo.z];
      if (!to) continue;
      const [x, z] = resolveCollision(to[0] + (Math.random() - 0.5) * 2, to[1] + (Math.random() - 0.5) * 2);
      this.gate.ready.delete(p.id);
      this.events.push({ t: 'labtp', id: p.id, f, a, x0: r2(p.x), z0: r2(p.z) });
      this.teleport(p, walkable(x, z) ? x : to[0], walkable(x, z) ? z : to[1]);
      if (a === 'in') {
        this.sys(hasLabKey(p.stats, f) ? `You descend into ${L.name}.` : `You descend into ${L.name}. Somewhere below, the Gravekeeper keeps the ${L.keyName}.`, p.id);
        this.track(p, 'lab_in', { f });
      } else this.track(p, 'lab_out', { f, a });
      return;
    }
  },

  // ---------- per tick ----------
  updateLabs(dt) {
    const t = this.time;
    for (const f of LAB_FLOORS) {
      const L = LABS[f], S = this.labs[f];
      const inside = [...this.players.values()].filter(p => !p.dead && labAt(p.x, p.z) === L);
      const humans = inside.filter(p => !p.bot);
      // spike plates: up = hit once per cycle (a jump or a roll gets you through, like a Quake Ring)
      for (const p of inside) {
        for (const tr of L.trapList) {
          if (!onTrap(tr, p.x, p.z) || trapState(L, tr, t) !== 2) continue;
          const cyc = Math.floor((t + tr.off) / L.traps.cycle), hits = p.labHits ||= {};
          if (hits[tr.k] === cyc) continue;
          hits[tr.k] = cyc;
          this.damagePlayer(p, p.maxHp * L.traps.dmg, { ground: true, src: 'spike trap' });
        }
      }
      // the crypt breathes: torches gutter and the dead rise near whoever is down here
      if (!humans.length) S.breatheAt = 0;
      else if (!S.breatheAt) S.breatheAt = t + rr(L.breathe.first);
      else if (t >= S.breatheAt) {
        const B = L.breathe;
        S.breatheAt = t + rr(B.every); S.gutterUntil = t + B.secs;
        this.events.push({ t: 'lab', s: 'breathe', f, d: B.secs });
        let alive = [...this.mobs.values()].filter(m => m.labTemp === f && !m.dead).length;
        for (const p of humans) for (let i = 0; i < B.rise && alive < B.cap; i++) {
          const spot = this.labSpot(p.x, p.z, 4, 8);
          if (!spot || inHall(L, ...spot)) continue;
          this.labRise(f, B.type, spot[0], spot[1], t + B.ttl); alive++;
        }
      }
      for (const m of [...this.mobs.values()]) { // the risen crumble when their time is up
        if (m.labTemp !== f || m.dead || t < m.labTtl || m.threat.size) continue;
        this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: 0 });
        this.mobs.delete(m.id);
      }
      this.updateKeeper(L, S, t);
      this.updateTolls(t);
    }
  },

  labSpot(x, z, d0, d1) { // a free floor spot d0..d1 m from (x, z), in the same labyrinth
    const L = labAt(x, z);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, d = d0 + Math.random() * (d1 - d0);
      const [sx, sz] = resolveCollision(x + Math.sin(a) * d, z + Math.cos(a) * d, 0.9);
      if (labAt(sx, sz) === L && walkable(sx, sz)) return [sx, sz];
    }
    return null;
  },

  labRise(f, type, x, z, ttl) {
    const m = this.addMob(type, x, z);
    m.labF = f; m.labTemp = f; m.labTtl = ttl;
    this.events.push({ t: 'lab', s: 'rise', f, x: r2(x), z: r2(z) });
    return m;
  },

  // ---------- the mini-boss ----------
  updateKeeper(L, S, t) {
    const m = S.keeper;
    if (!m || m.dead) return;
    if (!m.threat.size) { // nobody on it: it settles back and heals (a fresh try every time)
      if (m.labEngaged && t - (m.labQuiet ||= t) > 6) { m.hp = m.maxHp; m.labEngaged = false; m.labCalled = false; m.labQuiet = 0; }
      return;
    }
    m.labQuiet = 0;
    const K = KEEPER;
    if (!m.labEngaged) { m.labEngaged = true; m.tollT = t + K.toll.first; m.labCalled = false; }
    if (!m.labCalled && m.hp <= m.maxHp * K.call.at) { // calls up the dead, once
      m.labCalled = true;
      this.events.push({ t: 'lab', s: 'call', f: L.floor, id: m.id });
      this.sys('The Gravekeeper rings for the dead. They answer.');
      for (let i = 0; i < K.call.n; i++) { const s = this.labSpot(m.x, m.z, 4, 9); if (s) this.labRise(L.floor, K.call.type, s[0], s[1], t + 40); }
    }
    if (t >= m.tollT && !m.windupAt && t >= (m.stunUntil || 0)) { // the Grave Bell: a ring of force (jump it or roll through)
      const T = K.toll;
      m.tollT = t + T.every;
      const q = { id: this.id(), x: m.x, z: m.z, start: t + T.wind, r: 0, sp: T.speed, w: T.band, max: T.r, atk: m.def.atk * T.mult, hit: new Set(), m };
      (this.tolls ||= []).push(q);
      m.atkT = Math.max(m.atkT, t + T.wind + 0.6); // no swing while it rings
      this.events.push({ t: 'quake', id: q.id, by: m.id, x: r2(q.x), z: r2(q.z), d: T.wind, sp: T.speed, w: T.band, max: T.r, g: 1, i: 0, n: 1 });
    }
  },

  updateTolls(t) {
    if (!this.tolls?.length) return;
    for (const q of this.tolls) {
      if (t < q.start || q.m.dead) continue;
      const prev = q.r;
      q.r = Math.min(q.max, (t - q.start) * q.sp);
      for (const p of this.players.values()) {
        if (p.dead || q.hit.has(p.id) || labAt(p.x, p.z) !== labAt(q.x, q.z)) continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < prev - q.w || d > q.r + q.w) continue;
        q.hit.add(p.id); // (once per ring; damagePlayer turns a jump or a roll into an evade)
        this.damagePlayer(p, q.atk, { ground: true, src: 'grave bell', mob: q.m });
      }
    }
    this.tolls = this.tolls.filter(q => q.r < q.max && !q.m.dead);
  },

  // The Gravekeeper's key: everyone who fought it, or stands in the Ossuary when it falls.
  labKeeperKilled(m) {
    const f = m.labF, L = LABS[f], S = this.labs[f];
    m.deadUntil = this.time + (m.def.respawn || 75);
    for (const x of [...this.mobs.values()]) if (x.labTemp === f && !x.dead && inHall(L, x.x, x.z)) { this.events.push({ t: 'die', id: x.id, x: r2(x.x), z: r2(x.z), b: 0 }); this.mobs.delete(x.id); }
    const got = [];
    for (const p of this.players.values()) {
      if (!m.contributors.has(p.id) && !(labAt(p.x, p.z) === L && inHall(L, p.x, p.z) && !p.dead)) continue;
      const first = !hasLabKey(p.stats, f);
      p.stats[L.key] = (p.stats[L.key] || 0) + 1; p.dirty = true; this.invChanged(p);
      this.events.push({ t: 'labkey', id: p.id, f, first: first ? 1 : 0 });
      this.track(p, 'lab_key', { f, first });
      if (first && !p.bot) got.push(p.name);
    }
    this.sys(got.length ? `The Gravekeeper falls. ${got.join(', ')} found the ${L.keyName}: the way to the ${f === 1 ? 'Horned Warden' : 'boss'} is open.` : 'The Gravekeeper falls.');
    S.gutterUntil = 0;
  },

  // The boss gate's key lock: one character at the gate holding this floor's key opens it for everyone (a party of
  // only bots needs none: bot tests and bot runs).
  labGateOk(f, waiting) {
    if (!lockOn() || !LABS[f]) return true;
    const humans = waiting.filter(p => !p.bot);
    return !humans.length || humans.some(p => hasLabKey(p.stats, f));
  },

  labSnap() {
    const S = this.labs?.[1];
    return [r1(this.time), S && this.time < S.gutterUntil ? r1(S.gutterUntil - this.time) : 0];
  },
};

export function installLabyrinth(Game) {
  Object.assign(Game.prototype, LabMethods);
  const P = Game.prototype;

  const handle = P.handle;
  P.handle = function (p, msg) {
    if (msg?.type === 'lab' && p) return this.labStair(p, String(msg.a));
    // Testing aid (TEST_HOOKS=1 only): { type: 'test', labkey: f } gives the sender floor f's key; labkey: -f takes it.
    if (msg?.type === 'test' && process.env.TEST_HOOKS && p && msg.labkey) {
      const f = Math.abs(msg.labkey | 0), L = LABS[f]; if (!L) return;
      p.stats[L.key] = msg.labkey > 0 ? 1 : 0; if (msg.labkey < 0) p.stats.wardenKills = 0;
      this.invChanged(p); return;
    }
    return handle.call(this, p, msg);
  };

  // The boss gate asks for the key before it counts anyone ready.
  const toggleReady = P.toggleReady;
  P.toggleReady = function (p) {
    if (p.x <= 300 && !this.gate.open && !this.gate.ready.has(p.id) && !this.labGateOk(1, [...this.players.values()].filter(q => q === p || (!q.dead && inGateZone(q.x, q.z))))) {
      const L = LABS[1];
      this.sys(`The Chamber Gate is sealed with the Horn Lock. Find the ${L.keyName} in ${L.name}: the crypt stair is in the woods just west of the road.`, p.id);
      this.events.push({ t: 'lab', s: 'locked', f: 1, to: p.id });
      return;
    }
    return toggleReady.call(this, p);
  };

  // Mobs in a labyrinth go round its walls (next cell's centre on the way) and only chase people in the same one.
  const moveMob = P.moveMob;
  P.moveMob = function (m, tx, tz, speed, dt, stopAt) {
    if (m.labF) {
      const [sx, sz] = labSteer(m.x, m.z, tx, tz);
      if (sx !== tx || sz !== tz) return moveMob.call(this, m, sx, sz, speed, dt, 0.2);
    }
    return moveMob.call(this, m, tx, tz, speed, dt, stopAt);
  };
  const validTarget = P.validTarget;
  P.validTarget = function (m, p) {
    if (m.labF && p && labAt(p.x, p.z) !== LABS[m.labF]) return false;
    return validTarget.call(this, m, p);
  };

  const killMob = P.killMob;
  P.killMob = function (m, killer) {
    const r = killMob.call(this, m, killer);
    if (!m.dead) return r; // (held for a Last Attack elsewhere)
    if (m.labTemp) this.mobs.delete(m.id);
    else if (m.labF && m.type === LABS[m.labF].keeper) this.labKeeperKilled(m);
    return r;
  };
}

