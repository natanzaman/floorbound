// Labyrinths (docs/briefs/labyrinths.md): the server side. Stairs between the field, the layers and the boss gate
// (thresholds: you come back to the last one you crossed if you die inside), spike plates, wading, torches, chests, the
// levers and the portcullis, noise and the lure, the floor's event with rising pressure, the mini-boss and its key, the
// key lock on the boss gate, and steering mobs through the maze. Data and geometry: shared/labyrinth.js. Client:
// public/labyrinth.js.
import { walkable, resolveCollision, inGateZone, DODGE } from '../shared/data.js';
import { LABS, LAB_FLOORS, LAYERS, KEEPER, NOISE, LURE, labAt, labSteer, hallCenter, startPoint, endPoint, inHall, inWater, trapState, onTrap, hasLabKey, stairsOf, leverWindow, labRun, portOpen, portSide, portOff, walkLab } from '../shared/labyrinth.js';

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const rr = ([a, b]) => a + Math.random() * (b - a);
// Testing aid: SPAWN_AT drops a tester past the content, so the key lock waives itself; LAB_GATE=0 turns it off.
const lockOn = () => process.env.LAB_GATE !== '0' && !process.env.SPAWN_AT;
const REACH = 2.6; // m: chests, levers, torches

export const LabMethods = {
  initLabs() {
    this.labs = {}; // per layer id: { since, breatheAt, gutterUntil, lever: [t, t], lit: Map(k -> until) }
    this.lures = []; this.labLoot = new Map(); // character -> { chest key: refills at (game time) }
    for (const L of LAYERS) {
      const S = this.labs[L.id] = { since: 0, breatheAt: 0, gutterUntil: 0, lever: [-99, -99], lit: new Map(), keeper: null };
      for (const [type, c] of L.mobCells) {
        const [cx, cz] = L.center(c);
        const m = this.addMob(type, cx + (Math.random() - 0.5) * 4, cz + (Math.random() - 0.5) * 4);
        m.labF = L.floor;
      }
      if (L.keeper) { const [hx, hz] = hallCenter(L); S.keeper = this.addMob(L.keeper, hx, hz + 4); S.keeper.labF = L.floor; }
    }
  },

  // ---------- interaction: { type: 'lab', a: 'stair' | 'chest' | 'lever' | 'torch' | 'lure', face } ----------
  labAct(p, a, face) {
    if (p.dead) return;
    if (a === 'stair') return this.labStair(p);
    if (a === 'lure') return this.labLure(p, face);
    const L = labAt(p.x, p.z); if (!L) return;
    const S = this.labs[L.id], t = this.time;
    const nearest = list => list?.filter(o => Math.hypot(p.x - o.x, p.z - o.z) < REACH + 0.5).sort((a, b) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z))[0];
    if (a === 'chest') {
      const c = nearest(L.chestList); if (!c) return;
      const who = p.charId ?? `anon:${p.name}`; // (per character, not per connection: reconnecting doesn't refill chests)
      if (!this.labLoot.has(who)) this.labLoot.set(who, {});
      const k = `${L.id}:${c.k}`, got = this.labLoot.get(who);
      if ((got[k] || -1e9) > t) return this.sys('You already emptied this chest. It fills again in a while.', p.id);
      got[k] = t + L.loot.cd;
      this.dropLoot(p, { type: c.deep ? 'cryptchestdeep' : 'cryptchest', def: {} });
      if (c.deep || Math.random() < 0.5) { p.labLures = Math.min(LURE.max, (p.labLures || 0) + 1); this.sys('A bone rattle: throw it to lure a Tomb Warden away.', p.id); }
      this.events.push({ t: 'lab', s: 'chest', to: p.id, l: L.id, k: c.k, lu: p.labLures || 0 });
      this.track(p, 'lab_chest', { l: L.id, deep: c.deep ? 1 : 0 });
    } else if (a === 'lever') {
      const lv = nearest(L.leverList); if (!lv || portOpen(L, t)) return;
      S.lever[lv.k] = t;
      const people = [...this.players.values()].filter(q => !q.dead && !q.bot && labAt(q.x, q.z) === L).length;
      const win = leverWindow(L, people), other = S.lever[1 - lv.k];
      this.events.push({ t: 'lab', s: 'lever', l: L.id, k: lv.k, d: r1(win) });
      if (t - other <= win) {
        labRun.portUp[L.id] = t + L.levers.open; S.lever = [-99, -99];
        this.events.push({ t: 'lab', s: 'port', l: L.id, d: L.levers.open });
        this.sys(`The portcullis grinds up. ${L.lab.layers[L.li + 1]?.name || 'The way on'} lies beyond.`);
        this.labNoise(L, ...endPoint(L), NOISE.torch);
      } else this.sys(`A lever clanks down. Pull the other within ${Math.round(win)} s.`, p.id);
    } else if (a === 'torch') {
      const tc = nearest(L.torchList); if (!tc || (S.lit.get(tc.k) || 0) > t) return;
      S.lit.set(tc.k, t + L.torches.lit);
      this.events.push({ t: 'lab', s: 'torch', l: L.id, k: tc.k });
      this.labNoise(L, tc.x, tc.z, NOISE.torch);
    }
  },

  labStair(p) {
    for (const f of LAB_FLOORS) {
      const lab = LABS[f];
      const st = stairsOf(lab).find(s => Math.hypot(p.x - s.x, p.z - s.z) < s.r + 0.5);
      if (!st) continue;
      let to;
      if (st.kind === 'in' || st.kind === 'down') { const [x, z] = startPoint(st.to); to = [x, z + 1.5]; p.labCk = { f, li: st.to.li }; }
      else if (st.kind === 'up') { if (st.to) { const [x, z] = endPoint(st.to); to = [x, z - 1.5]; p.labCk = { f, li: st.to.li }; } else { to = [lab.entry.x, lab.entry.z - 4.5]; p.labCk = null; } }
      else { to = [lab.exitTo.x, lab.exitTo.z]; p.labCk = null; }
      const [x, z] = resolveCollision(to[0] + (Math.random() - 0.5) * 2, to[1] + (Math.random() - 0.5) * 1.2);
      this.gate.ready.delete(p.id);
      if (st.kind === 'in') p.labLures = Math.max(p.labLures || 0, LURE.start);
      this.events.push({ t: 'labtp', id: p.id, f, k: st.kind, l: st.to?.id || '', x0: r2(p.x), z0: r2(p.z), lu: p.labLures || 0 });
      this.teleport(p, walkable(x, z) ? x : to[0], walkable(x, z) ? z : to[1]);
      if (st.kind === 'in') {
        this.sys(hasLabKey(p.stats, f) ? `You descend into ${lab.name}.` : `You descend into ${lab.name}. Somewhere below, the Gravekeeper keeps the ${lab.keyName}.`, p.id);
      }
      this.track(p, 'lab_stair', { f, k: st.kind, l: st.to?.id || '' });
      return;
    }
  },

  // ---------- noise: wakes the Tomb Wardens that hear it, and sends them to it ----------
  labNoise(L, x, z, r) {
    const t = this.time;
    for (const m of this.mobs.values()) {
      if (m.dead || !m.def.hears || labAt(m.x, m.z) !== L || Math.hypot(m.x - x, m.z - z) > r) continue;
      if (!m.labAwake || m.labAwake < t) this.events.push({ t: 'lab', s: 'wake', id: m.id });
      m.labAwake = t + NOISE.awake; m.labGo = [x, z];
    }
  },

  labLure(p, face) {
    const L = labAt(p.x, p.z);
    if (!L || !(p.labLures > 0)) return;
    const a = typeof face === 'number' && isFinite(face) ? face : p.face;
    let x = p.x, z = p.z;
    for (let d = 0.5; d <= LURE.throw; d += 0.5) { const nx = p.x + Math.sin(a) * d, nz = p.z + Math.cos(a) * d; if (!walkable(nx, nz) || labAt(nx, nz) !== L) break; x = nx; z = nz; }
    p.labLures--;
    this.lures.push({ x, z, L, until: this.time + LURE.secs, next: 0 });
    this.events.push({ t: 'lab', s: 'lure', x: r2(x), z: r2(z), x0: r2(p.x), z0: r2(p.z), d: LURE.secs, by: p.id, lu: p.labLures });
  },

  // ---------- per tick ----------
  updateLabs(dt) {
    const t = this.time;
    labRun.now = t;
    const byLayer = new Map(), risen = [];
    for (const m of this.mobs.values()) if (m.labTemp && !m.dead) risen.push(m);
    for (const p of this.players.values()) { if (p.dead) continue; const L = labAt(p.x, p.z); if (L) { if (!byLayer.has(L)) byLayer.set(L, []); byLayer.get(L).push(p); } }
    for (const L of LAYERS) {
      const S = this.labs[L.id], inside = byLayer.get(L) || [], humans = inside.filter(p => !p.bot);
      for (const p of inside) {
        // spike plates: up = hit once per cycle (a jump or a roll gets you through, like a Quake Ring)
        for (const tr of L.trapList) {
          if (!onTrap(tr, p.x, p.z) || trapState(L, tr, t) !== 2) continue;
          const cyc = Math.floor((t + tr.off) / L.traps.cycle), hits = p.labHits ||= {};
          if (hits[`${L.id}${tr.k}`] === cyc) continue;
          hits[`${L.id}${tr.k}`] = cyc;
          this.damagePlayer(p, p.maxHp * L.traps.dmg, { ground: true, src: 'spike trap' });
        }
        // noise from moving: wading through loud water (measured over half a second: per-tick positions are jittery)
        if (!p.labW || t - p.labW.t >= 0.5) {
          const w = p.labW, moved = w ? Math.hypot(p.x - w.x, p.z - w.z) / (t - w.t) : 0;
          p.labW = { t, x: p.x, z: p.z };
          if (w && t - w.t < 1 && moved > 1 && moved < DODGE.dist / DODGE.time * 0.9 && t >= (p.labNoiseT || 0) && L.water?.loud && inWater(L, p.x, p.z)) { // (not a teleport)
            p.labNoiseT = t + 1.2; this.labNoise(L, p.x, p.z, NOISE.wade);
          }
        }
      }
      // a fight is loud
      if (inside.length && t >= (S.fightT || 0)) {
        S.fightT = t + 2;
        for (const m of this.mobs.values()) if (!m.dead && m.threat.size && labAt(m.x, m.z) === L) this.labNoise(L, m.x, m.z, NOISE.fight);
      }
      // the floor's event, with rising pressure: the longer people stay in the layer, the sooner and harder it comes
      const B = L.breathe;
      if (!humans.length) { S.since = 0; S.breatheAt = 0; }
      else if (B) {
        if (!S.since) { S.since = t; S.breatheAt = t + rr(B.first); }
        if (t >= S.breatheAt) {
          const press = this.labPressure(L);
          S.breatheAt = t + rr(B.every) * (1 - (1 - B.press) * press); S.gutterUntil = t + B.secs;
          this.events.push({ t: 'lab', s: 'breathe', l: L.id, d: B.secs, p: r2(press) });
          let alive = risen.filter(m => m.labTemp === L.id).length;
          const rise = B.rise + (press >= 1 ? 1 : 0);
          for (const p of humans) for (let i = 0; i < rise && alive < B.cap; i++) {
            const spot = this.labSpot(p.x, p.z, 4, 8);
            if (spot) { this.labRise(L, B.type, spot[0], spot[1], t + B.ttl); alive++; }
          }
        }
      }
      for (const m of risen) { // the risen crumble when their time is up
        if (m.labTemp !== L.id || t < m.labTtl || m.threat.size) continue;
        this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: 0 });
        this.mobs.delete(m.id);
      }
      if (L.portEdge && !portOpen(L, t)) {
        for (const p of inside) if (portSide(L, p.x, p.z) === 0 && !walkLab(L, p.x, p.z)) this.labUnbar(L, p, true);
        for (const m of this.mobs.values()) if (!m.dead && m.labF && portSide(L, m.x, m.z) === 0 && labAt(m.x, m.z) === L && !walkLab(L, m.x, m.z)) this.labUnbar(L, m, false);
      }
      for (const [k, until] of S.lit) if (until <= t) S.lit.delete(k);
      if (S.keeper) this.updateKeeper(L, S, t);
    }
    // lures rattle: noise every second while they last
    for (const u of this.lures) if (t >= u.next) { u.next = t + 1; this.labNoise(u.L, u.x, u.z, NOISE.lure); }
    this.lures = this.lures.filter(u => u.until > t);
    this.updateTolls(t);
  },

  labUnbar(L, o, player) { // out from under the bars, to the nearer side
    const [i, j, d] = L.portEdge.split(','), line = d === 'E' ? L.x0 + (+i + 1) * L.cell : L.z0 + (+j + 1) * L.cell;
    const s = (d === 'E' ? o.x : o.z) >= line ? 1 : -1, [x, z] = portOff(L, o.x, o.z, s);
    if (player) this.teleport(o, x, z); else { o.x = x; o.z = z; }
  },

  labPressure(L) { const S = this.labs[L.id]; return L.breathe && S.since ? Math.min(1, (this.time - S.since) / L.breathe.pressAfter) : 0; },

  labSpot(x, z, d0, d1) { // a free floor spot d0..d1 m from (x, z), in the same layer
    const L = labAt(x, z);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, d = d0 + Math.random() * (d1 - d0);
      const [sx, sz] = resolveCollision(x + Math.sin(a) * d, z + Math.cos(a) * d, 0.9);
      if (labAt(sx, sz) === L && walkable(sx, sz)) return [sx, sz];
    }
    return null;
  },

  labRise(L, type, x, z, ttl) {
    const m = this.addMob(type, x, z);
    m.labF = L.floor; m.labTemp = L.id; m.labTtl = ttl;
    this.events.push({ t: 'lab', s: 'rise', x: r2(x), z: r2(z) });
    return m;
  },

  // ---------- the Tomb Warden: asleep until it hears something; then it goes to the sound and fights what it finds ----------
  labHearer(m) {
    const t = this.time;
    if (m.threat.size) { m.labAwake = Math.max(m.labAwake || 0, t + 3); return false; } // hit, or fighting: the normal AI
    if (!m.labAwake || t >= m.labAwake) { // asleep (or going back to its niche)
      m.labGo = null;
      if (Math.hypot(m.x - m.sx, m.z - m.sz) > 1) this.moveMob(m, m.sx, m.sz, m.def.speed * 0.6, 0.05, 0.5); else m.moving = false;
      return true;
    }
    for (const p of this.players.values()) if (this.validTarget(m, p) && Math.hypot(p.x - m.x, p.z - m.z) < 7) { m.threat.set(p.id, 1); return false; }
    if (m.labGo) { this.moveMob(m, m.labGo[0], m.labGo[1], m.def.speed, 0.05, 1.2); if (Math.hypot(m.x - m.labGo[0], m.z - m.labGo[1]) < 1.6) m.labGo = null; }
    else m.moving = false;
    return true;
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
      this.events.push({ t: 'lab', s: 'call', l: L.id, id: m.id });
      this.sys('The Gravekeeper rings for the dead. They answer.');
      for (let i = 0; i < K.call.n; i++) { const s = this.labSpot(m.x, m.z, 4, 9); if (s) this.labRise(L, K.call.type, s[0], s[1], t + 40); }
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

  // The Gravekeeper's key: everyone who fought it, or stands in its hall when it falls.
  labKeeperKilled(m) {
    const L = labAt(m.x, m.z) || LAYERS.find(l => this.labs[l.id].keeper === m), lab = L.lab, f = L.floor;
    m.deadUntil = this.time + (m.def.respawn || 75);
    for (const x of [...this.mobs.values()]) if (x.labTemp === L.id && !x.dead) { this.events.push({ t: 'die', id: x.id, x: r2(x.x), z: r2(x.z), b: 0 }); this.mobs.delete(x.id); }
    const got = [];
    for (const p of this.players.values()) {
      if (!m.contributors.has(p.id) && !(labAt(p.x, p.z) === L && !p.dead)) continue;
      const first = !hasLabKey(p.stats, f);
      p.stats[lab.key] = (p.stats[lab.key] || 0) + 1; p.dirty = true; this.invChanged(p);
      this.events.push({ t: 'labkey', id: p.id, f, first: first ? 1 : 0 });
      this.track(p, 'lab_key', { f, first });
      if (first && !p.bot) got.push(p.name);
    }
    this.sys(got.length ? `The Gravekeeper falls. ${got.join(', ')} found the ${lab.keyName}: the way to the Horned Warden is open.` : 'The Gravekeeper falls.');
  },

  // The boss gate's key lock: one character at the gate holding this floor's key opens it for everyone (a party of
  // only bots needs none: bot tests and bot runs).
  labGateOk(f, waiting) {
    if (!lockOn() || !LABS[f]) return true;
    const humans = waiting.filter(p => !p.bot);
    return !humans.length || humans.some(p => hasLabKey(p.stats, f));
  },

  // [server time, [[layer id, portcullis up until, lit torch ids, guttering s left, pressure]]]
  labSnap() {
    const t = this.time;
    return [r1(t), LAYERS.map(L => { const S = this.labs[L.id]; return [L.id, r1(labRun.portUp[L.id] || 0), [...S.lit.keys()], t < S.gutterUntil ? r1(S.gutterUntil - t) : 0, r2(this.labPressure(L))]; })];
  },
};

// Is the straight line between two points in layer L open floor all the way (0.5 m samples)?
function labClear(L, x0, z0, x1, z1) {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5);
  for (let k = 1; k < n; k++) if (!walkLab(L, x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n)) return false;
  return true;
}

export function installLabyrinth(Game) {
  Object.assign(Game.prototype, LabMethods);
  const P = Game.prototype;

  const handle = P.handle;
  P.handle = function (p, msg) {
    if (msg?.type === 'lab' && p) return this.labAct(p, String(msg.a), msg.face);
    // Testing aid (TEST_HOOKS=1 only): { type: 'test', labkey: f } gives the sender floor f's key; labkey: -f takes it.
    if (msg?.type === 'test' && process.env.TEST_HOOKS && p && msg.labkey) {
      const f = Math.abs(msg.labkey | 0), lab = LABS[f]; if (!lab) return;
      p.stats[lab.key] = msg.labkey > 0 ? 1 : 0; if (msg.labkey < 0) p.stats.wardenKills = 0;
      this.invChanged(p); return;
    }
    // { type: 'test', labgo: layer id | 'out' }: straight to that layer's threshold (or out before the gate), as a stair would.
    if (msg?.type === 'test' && process.env.TEST_HOOKS && p && typeof msg.labgo === 'string') {
      const lab = LABS[1], L = lab.layers.find(l => l.id === msg.labgo);
      const [x, z] = L ? startPoint(L) : [lab.exitTo.x, lab.exitTo.z];
      p.labCk = L ? { f: 1, li: L.li } : null;
      this.events.push({ t: 'labtp', id: p.id, f: 1, k: L ? 'down' : 'out', l: L?.id || '', x0: r2(p.x), z0: r2(p.z), lu: p.labLures || 0 });
      this.teleport(p, x, L ? z + 1.5 : z); return;
    }
    return handle.call(this, p, msg);
  };

  // The boss gate asks for the key before it counts anyone ready.
  const toggleReady = P.toggleReady;
  P.toggleReady = function (p) {
    if (p.x <= 300 && !this.gate.open && !this.gate.ready.has(p.id) && !this.labGateOk(1, [...this.players.values()].filter(q => q === p || (!q.dead && inGateZone(q.x, q.z))))) {
      const lab = LABS[1];
      this.sys(`The Chamber Gate is sealed with the Horn Lock. Find the ${lab.keyName} in ${lab.name}: the crypt stair is in the woods just west of the road.`, p.id);
      this.events.push({ t: 'lab', s: 'locked', f: 1, to: p.id });
      return;
    }
    return toggleReady.call(this, p);
  };

  // Mobs in a labyrinth go round its walls (next cell's centre on the way) and only chase people in the same layer.
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
    if (m.labF && p && labAt(p.x, p.z) !== labAt(m.x, m.z)) return false;
    return validTarget.call(this, m, p);
  };
  // No biting through a wall: a labyrinth mob's hit needs a clear line to you.
  const damagePlayer = P.damagePlayer;
  P.damagePlayer = function (p, amount, opts) {
    const m = opts?.mob, L = m?.labF && labAt(m.x, m.z);
    if (L && labAt(p.x, p.z) === L && !labClear(L, m.x, m.z, p.x, p.z)) return;
    return damagePlayer.apply(this, arguments);
  };

  // Knockback in a labyrinth stops at the first wall on the way (walls are thinner than a big push).
  const knockback = P.knockback;
  P.knockback = function (m, p, dist) {
    const L = labAt(m.x, m.z);
    if (L) {
      const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
      let free = 0;
      for (let s = 0.4; s <= dist + 1e-6; s += 0.4) { if (!walkLab(L, m.x + dx / d * s, m.z + dz / d * s)) break; free = s; }
      if (free < dist) { if (free < 0.4) { if (dist >= 1.5) m.windupAt = 0; return; } dist = free; }
    }
    return knockback.call(this, m, p, dist);
  };

  // Moves can't hop the shut portcullis between two position messages.
  const onInput = P.onInput;
  P.onInput = function (p, msg) {
    const L = labAt(p.x, p.z), x0 = p.x, z0 = p.z;
    const r = onInput.call(this, p, msg);
    if (L?.portEdge && !portOpen(L, this.time) && labAt(p.x, p.z) === L) {
      const a = portSide(L, x0, z0), b = portSide(L, p.x, p.z);
      if (a && b && a !== b) { p.x = x0; p.z = z0; }
    }
    return r;
  };
  const updateMob = P.updateMob;
  P.updateMob = function (m, dt) {
    if (m.def.hears && !m.dead && this.labHearer(m)) return;
    return updateMob.call(this, m, dt);
  };

  // Dying inside: back at the last threshold you crossed.
  const respawnPoint = P.respawnPoint;
  P.respawnPoint = function (p) {
    const L = labAt(p.x, p.z), ck = p.labCk;
    if (L && ck && ck.f === L.floor) { const to = LABS[ck.f].layers[ck.li]; if (to) { const [x, z] = startPoint(to); return [x, z + 1.5]; } }
    return respawnPoint.call(this, p);
  };

  const killMob = P.killMob;
  P.killMob = function (m, killer) {
    const r = killMob.call(this, m, killer);
    if (!m.dead) return r; // (held for a Last Attack elsewhere)
    if (m.labTemp) this.mobs.delete(m.id);
    else if (m.labF && m.def.elite && m.type === LAYERS.find(L => L.floor === m.labF && L.keeper)?.keeper) this.labKeeperKilled(m);
    return r;
  };
}
