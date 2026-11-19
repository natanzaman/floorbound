// Floor 3 — The Gale Spires: server-side AI (Crag Ram, Gale Harpy, Storm Acolyte, Spire Sentinel, the rares Skyrender
// and the Old Bastion), the Storm Colossus (its phases, Overload, Tempest Beam, twists), the Storm Gate, the Stairway up
// from the Sunken Court, travel and respawn on Floor 3. Design: docs/floor3.md. Tuning: shared/floor3.js.
// installFloor3(Game) mixes the methods into Game.prototype and wraps a few Floor 2 / travel methods (warp, respawn,
// the Sovereign's kill) so Floor 2's own file stays as it is.
import { BITE, PACE, CLASSES, MOBS, GUARD, inTown, walkable, resolveCollision, rng, angleTo, wrapAngle } from '../shared/data.js';
import {
  F3, F3_SPAWNS, GATE3, STAIRWAY3, COLOSSUS, RAM, HARPY, ACOLYTE, SENTINEL, F3_TWISTS, F3_TWIST_IDS, FLOOR_NAMES,
  inArena3, inCamp3, inGateZone3, onFloor3,
} from '../shared/floor3.js';
import { floorUnlocked, floorOf, nearWaystone } from '../shared/floor2.js';
import { lastAttackItem3, rollRarity, SLOTS } from '../shared/items.js';
import { rollGear } from '../shared/loot.js'; // drops and the Stormforged set: data in shared/loot.js (LOOT)

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const COLOSSUS_MOVES = ['hammerfall', 'lightning', 'gale_push', 'overload', 'tempest_beam']; // forceBossMove names (director boss_move)
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const F3STATS = !!process.env.F3_STATS; // test/floor3boss.js: count Overloads stopped / Thunderclaps, beam jumps / hits

export const F3Methods = {
  // ---------- setup ----------
  initFloor3() {
    this.gate3 = { open: false, ready: new Set(), countAt: 0, emptySince: 0, firstReadyAt: 0 };
    this.portal3 = null; this.fight3 = null; this.floorClears3 = 0; this.beams = []; this.charges = [];
    const r = rng(13);
    for (const [type, n, xs, zs] of F3_SPAWNS) {
      for (let i = 0; i < n; i++) {
        let x, z, k = 0;
        do { x = xs[0] + r() * (xs[1] - xs[0]); z = zs[0] + r() * (zs[1] - zs[0]); } while (++k < 20 && Math.abs(x - F3.x) < 6);
        this.f3Init(this.addMob(type, x, z));
      }
    }
    this.colossus = this.addMob('colossus', F3.arena.x, F3.arena.z + 4);
    this.f3Init(this.colossus);
    this.newTwist3();
  },

  f3Init(m) {
    m.engaged = false; m.state = null; m.ward = 0; m.wardUntil = 0; m.chan = null; m.crackedUntil = 0; m.crackFrom = 0;
    m.groundedUntil = 0; m.chargedUntil = 0; m.ov = null; m.diveLeft = 0; m.aloft = !!m.def.fly;
    return m;
  },

  // ---------- the Colossus's twists (one per spawn, like the Warden's) ----------
  newTwist3() {
    const forced = process.env.F3_TWIST; // testing aid: a twist id, or 'calm'
    const id = F3_TWISTS[forced] ? forced : F3_TWIST_IDS[Math.floor(Math.random() * F3_TWIST_IDS.length)];
    this.twist3 = { id };
    if (process.env.F3_STATS) console.log(`Colossus twist: ${id}`);
  },
  twist3Def() { return F3_TWISTS[this.twist3?.id] || F3_TWISTS.calm; },

  // ---------- shared mob helpers ----------
  f3Valid(m, p) {
    if (!p || p.dead || !onFloor3(p.x) || inTown(p.x, p.z)) return false;
    if (m.def.boss || m.temp3) return inArena3(p.x, p.z); // the Colossus and its harpies stay on the plateau
    return dist(m, p) < 40;
  },

  // Common upkeep. Returns false (dead or stunned: skip this tick), null (no target) or the target player.
  f3Pre(m) {
    const t = this.time, def = m.def;
    m.moving = false;
    if (m.dead) {
      if (m.temp3 || m.summoned) { this.mobs.delete(m.id); return false; }
      if (t >= m.deadUntil) {
        const base = MOBS[m.type];
        Object.assign(m, { dead: false, def: base, hp: base.hp, maxHp: base.hp, x: m.sx, z: m.sz, phase: 0, windupAt: 0, stunUntil: 0, busyUntil: 0 });
        m.threat.clear(); m.contributors.clear(); this.f3Init(m);
        if (def.boss) { this.newTwist3(); this.sys('The Storm Colossus stands again at the summit.'); }
      }
      return false;
    }
    for (const pid of [...m.threat.keys()]) if (!this.f3Valid(m, this.players.get(pid))) m.threat.delete(pid);
    if (def.aggro > 0) {
      for (const p of this.players.values()) if (!m.threat.has(p.id) && this.f3Valid(m, p) && dist(m, p) <= def.aggro) m.threat.set(p.id, 1);
    }
    if (!def.boss && !m.temp3 && Math.hypot(m.x - m.sx, m.z - m.sz) > 35) m.threat.clear();
    let target = null, top = -Infinity;
    for (const [pid, v] of m.threat) { const w = this.players.get(pid)?.trap ? v - 1e12 : v; if (w > top) { top = w; target = this.players.get(pid); } } // trapped players last (J1)
    if (t < m.stunUntil) return false;
    return target;
  },

  f3Move(m, tx, tz, speed, dt, stopAt, keepFace = false) {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d <= stopAt) return false;
    speed *= this.mobSlowA?.(m) ?? 1; // caltrops (server/classes-a.js)
    const step = Math.min(d - stopAt, speed * dt);
    let nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
    [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
    if (!this.f3Free(m, nx, nz)) return false;
    if (!keepFace) m.face = Math.atan2(dx, dz);
    m.x = nx; m.z = nz; m.moving = true;
    return true;
  },
  f3Free(m, x, z) { return walkable(x, z) && !inCamp3(x, z, 2) && (!(m.def.boss || m.temp3) || inArena3(x, z)); },

  f3Wander(m, dt) {
    const t = this.time;
    if (t >= m.wanderT) {
      m.wanderT = t + 3 + Math.random() * 4;
      const a = Math.random() * 6.28, d = Math.random() * (m.def.boss ? 2 : 6);
      m.wx = m.sx + Math.sin(a) * d; m.wz = m.sz + Math.cos(a) * d;
    }
    this.f3Move(m, m.wx, m.wz, m.def.speed * 0.35, dt, 0.3);
  },

  f3Atk(m) { return m.def.atk * (this.time < m.chargedUntil ? COLOSSUS.overload.chargedMult : 1); },

  // A melee hit on the wedge in front of the mob (shown as a red wedge during the wind-up).
  f3Bite(m) {
    const [reach, half] = BITE[m.type] || [m.def.range + 1, 0.6];
    this.events.push({ t: 'fx', k: 'marc', id: m.id, x: r2(m.x), z: r2(m.z), f: r2(m.face), r: reach * 0.8, small: m.def.boss ? 0 : 1 });
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = dist(m, p);
      if (d > reach + 0.4) continue;
      if (d > m.def.radius + 0.6 && Math.abs(wrapAngle(angleTo(m.x, m.z, p.x, p.z) - m.face)) > half) continue;
      this.damagePlayer(p, this.f3Atk(m), { src: m.def.boss ? 'colossus hammerfall' : `${m.type} strike`, mob: m });
    }
  },

  // A brute's turn: chase, wind up a bite in range, land it. (Rams, grounded harpies, sentinels, the Colossus's harpies.)
  f3Brute(m, dt, target, wind = 0.55) {
    const t = this.time, def = m.def;
    if (!target) { m.windupAt = 0; this.f3Wander(m, dt); return; }
    if (m.windupAt) { if (t >= m.windupAt) { m.windupAt = 0; this.f3Bite(m); } return; }
    const want = angleTo(m.x, m.z, target.x, target.z), d = dist(m, target);
    m.face = want;
    if (d > def.range + 0.4) this.f3Move(m, target.x, target.z, def.speed, dt, def.range);
    else if (t >= m.atkT) {
      const [r, h] = BITE[m.type] || [def.range + 1, 0.6];
      m.windupAt = t + wind; m.atkT = t + def.atkCd;
      this.events.push({ t: 'wind', id: m.id, d: wind, f: r2(m.face), r, h });
    }
  },

  // Throw a player back `d` m along (ux, uz): the longest clear step (walls, trees, the plateau's edge for boss fights).
  shove(p, ux, uz, d, inRoom = null) {
    if (p.dead || p.downed) return;
    for (let k = 4; k >= 1; k--) {
      let x = p.x + ux * d * (k / 4), z = p.z + uz * d * (k / 4);
      [x, z] = resolveCollision(x, z);
      if (!walkable(x, z, true) || (inRoom && !inRoom(x, z))) continue;
      this.teleport(p, x, z);
      this.events.push({ t: 'f3fx', k: 'shove', id: p.id, x: r2(x), z: r2(z) });
      return;
    }
  },

  // Called from damageMob for Floor 3 mobs: a harpy aloft, a sentinel's armour, a Wind Ward, the Colossus's twist /
  // Grounded / Overload. Returns the damage to apply (0 = fully absorbed).
  f3DamageMod(m, p, base) {
    const t = this.time;
    if (m.aloft && m.state !== 'grounded' && dist(m, p) < HARPY.rangedD + m.def.radius) {
      base *= HARPY.aloft;
      this.events.push({ t: 'f3fx', k: 'aloft', id: m.id, to: p.id });
    }
    if (m.def.armor && t >= m.crackedUntil && t >= m.staggerUntil) {
      base *= 1 - m.def.armor;
      this.events.push({ t: 'f3fx', k: 'armor', id: m.id, to: p.id });
    }
    if (m.chan) m.chan.hits++;
    if (m.def.f3boss) {
      if (m.ov && this._tbIn) m.ov.burst = true; // a Team Burst landed during Overload (server/teamplay.js)
      if (t < m.groundedUntil) base *= COLOSSUS.overload.weak; // Grounded after a stopped Overload
      const tw = this.twist3Def();
      if (tw.taken && t >= m.staggerUntil && t >= m.groundedUntil) base *= tw.taken;
    }
    if (m.ward > 0 && t < m.wardUntil) {
      const soak = Math.min(m.ward, base);
      m.ward -= soak; base -= soak;
      if (m.ward <= 0) this.events.push({ t: 'f3fx', k: 'wardbreak', id: m.id, x: r2(m.x), z: r2(m.z) });
      else this.events.push({ t: 'f3fx', k: 'warded', id: m.id, to: p.id });
    }
    return base;
  },

  // ---------- AIs (MOBS[type].ai) ----------
  // Crag Ram: lowers its horns (a lane telegraph) and charges through it; anyone hit is thrown back. A Guardian guarding
  // it head-on stops it dead: the ram is stunned.
  f3Ram(m, dt) {
    const target = this.f3Pre(m);
    if (target === false) return;
    const t = this.time;
    if (m.state === 'charge') return; // moving along its lane: updateFloor3 drives it
    if (m.state === 'wind') { if (t >= m.windAt) this.ramGo(m); return; }
    if (!target) { m.chargeT = 0; return this.f3Brute(m, dt, null); }
    if (!m.chargeT) m.chargeT = t + RAM.first;
    const d = dist(m, target);
    if (t >= m.chargeT && !m.windupAt && d > RAM.minD && d < RAM.len - 1) {
      m.chargeT = t + RAM.every;
      const a = angleTo(m.x, m.z, target.x, target.z);
      m.face = a; m.state = 'wind'; m.windAt = t + RAM.wind;
      m.lane = { x0: m.x, z0: m.z, ux: Math.sin(a), uz: Math.cos(a) };
      this.events.push({ t: 'tele', k: 'line', id: m.id, x: r2(m.x), z: r2(m.z), x2: r2(m.x + Math.sin(a) * RAM.len), z2: r2(m.z + Math.cos(a) * RAM.len), w: RAM.width, d: RAM.wind });
      return;
    }
    this.f3Brute(m, dt, target);
  },
  ramGo(m) {
    m.state = 'charge';
    this.charges.push({ m, ...m.lane, len: RAM.len, sp: RAM.speed, w: RAM.width, done: 0, hit: new Set(), kind: 'ram' });
    this.events.push({ t: 'f3fx', k: 'charge', id: m.id, x: r2(m.x), z: r2(m.z) });
  },

  // Gale Harpy (and Skyrender): hovers out of melee reach, dives along a lane, then sits grounded and vulnerable.
  f3Harpy(m, dt) {
    const target = this.f3Pre(m);
    if (target === false) return;
    const t = this.time, def = m.def;
    if (m.state === 'dive' || m.state === 'chain') return; // updateFloor3 drives the dive; Skyrender re-aims between dives
    if (m.state === 'grounded') {
      if (t >= m.groundUntil) { m.state = null; m.aloft = true; m.windupAt = 0; this.events.push({ t: 'f3fx', k: 'lift', id: m.id, x: r2(m.x), z: r2(m.z) }); return; }
      return this.f3Brute(m, dt, target, 0.5);
    }
    if (m.state === 'wind') {
      if (t < m.windAt) return;
      m.state = 'dive';
      this.charges.push({ m, ...m.lane, len: HARPY.len, sp: HARPY.speed, w: HARPY.width, done: 0, hit: new Set(), kind: 'dive' });
      this.events.push({ t: 'f3fx', k: 'dive', id: m.id, x: r2(m.x), z: r2(m.z) });
      return;
    }
    if (!target) { m.diveT = 0; m.aloft = true; this.f3Wander(m, dt); return; }
    if (!m.diveT) m.diveT = t + HARPY.first;
    const d = dist(m, target);
    m.face = angleTo(m.x, m.z, target.x, target.z);
    if (t >= m.diveT && d < HARPY.len - 1) return this.harpyAim(m, target, def.dives || 1);
    // circle at a distance, above the fight
    if (d > HARPY.keep[1]) this.f3Move(m, target.x, target.z, def.speed, dt, HARPY.keep[1] - 1, true);
    else if (d < HARPY.keep[0] && Math.hypot(m.x - m.sx, m.z - m.sz) < HARPY.leash) this.f3Move(m, m.x * 2 - target.x, m.z * 2 - target.z, def.speed * 0.7, dt, 0, true);
    else { const a = m.face + Math.PI / 2; this.f3Move(m, m.x + Math.sin(a) * 2, m.z + Math.cos(a) * 2, def.speed * 0.4, dt, 0, true); }
  },
  harpyAim(m, v, left) {
    const t = this.time, a = angleTo(m.x, m.z, v.x, v.z);
    m.diveLeft = left; m.state = 'wind'; m.windAt = t + HARPY.wind * (left < (m.def.dives || 1) ? 0.75 : 1); m.face = a;
    const len = Math.min(HARPY.len, dist(m, v) + 3);
    m.lane = { x0: m.x, z0: m.z, ux: Math.sin(a), uz: Math.cos(a), len };
    this.events.push({ t: 'tele', k: 'line', id: m.id, x: r2(m.x), z: r2(m.z), x2: r2(m.x + Math.sin(a) * len), z2: r2(m.z + Math.cos(a) * len), w: HARPY.width, d: r2(m.windAt - t) });
  },
  harpyLand(m) {
    const t = this.time;
    if (m.diveLeft > 1) { // Skyrender: re-aim at someone (new) and dive again
      const v = [...this.players.values()].filter(p => this.f3Valid(m, p)).sort((a, b) => dist(a, m) - dist(b, m))[0];
      if (v) { m.diveLeft--; m.aloft = true; this.schedule(HARPY.chain, () => { if (!m.dead && m.state === 'chain') this.harpyAim(m, v, m.diveLeft); }); m.state = 'chain'; return; }
    }
    m.state = 'grounded'; m.aloft = false; m.groundUntil = t + (m.def.rare ? HARPY.groundedRare : HARPY.grounded);
    m.diveT = t + (m.def.rare ? HARPY.every * 0.8 : HARPY.every); m.atkT = t + 0.6;
    this.events.push({ t: 'f3fx', k: 'land', id: m.id, x: r2(m.x), z: r2(m.z), d: r2(m.groundUntil - t) });
  },

  // Storm Acolyte: keeps its distance, calls lightning under its target, and channels a Wind Ward over its allies.
  f3Acolyte(m, dt) {
    const t = this.time;
    if (m.chan && (!m.windupAt || t < m.stunUntil || t < m.staggerUntil || m.chan.hits >= ACOLYTE.breakHits || m.dead)) { // interrupted
      m.chan = null; m.windupAt = 0; m.wardT = t + ACOLYTE.wardEvery * 0.6;
      this.events.push({ t: 'f3fx', k: 'interrupt', id: m.id, x: r2(m.x), z: r2(m.z) });
    }
    const target = this.f3Pre(m);
    if (target === false) return;
    const def = m.def;
    if (m.chan) { if (t >= m.chan.until) this.acolyteWard(m); return; }
    if (!target) { m.wardT = 0; m.windupAt = 0; this.f3Wander(m, dt); return; }
    if (!m.wardT) m.wardT = t + ACOLYTE.wardFirst;
    if (t >= m.wardT) { // channel the ward (an interruptible wind-up)
      m.wardT = t + ACOLYTE.wardEvery;
      m.chan = { until: t + ACOLYTE.channel, hits: 0 }; m.windupAt = m.chan.until;
      this.events.push({ t: 'f3fx', k: 'chan', id: m.id, x: r2(m.x), z: r2(m.z), d: ACOLYTE.channel, r: ACOLYTE.wardR });
      return;
    }
    const d = dist(m, target);
    m.face = angleTo(m.x, m.z, target.x, target.z);
    if (d > ACOLYTE.keep[1]) this.f3Move(m, target.x, target.z, def.speed, dt, ACOLYTE.keep[1] - 1, true);
    else if (d < ACOLYTE.keep[0] && Math.hypot(m.x - m.sx, m.z - m.sz) < ACOLYTE.leash) this.f3Move(m, m.x * 2 - target.x, m.z * 2 - target.z, def.speed * 0.8, dt, 0, true);
    if (t >= m.atkT && d <= def.range) {
      m.atkT = t + def.atkCd;
      this.f3Circle(m, target.x, target.z, ACOLYTE.boltR, ACOLYTE.boltWind, def.atk * ACOLYTE.boltMult, 'bolt', 'acolyte lightning');
    }
  },
  acolyteWard(m) {
    const t = this.time, ids = [];
    m.chan = null; m.windupAt = 0;
    for (const a of this.mobs.values()) {
      if (a.dead || a.def.boss || !a.def.f3 || dist(a, m) > ACOLYTE.wardR) continue;
      a.ward = Math.round(a.maxHp * ACOLYTE.shield); a.wardUntil = t + ACOLYTE.shieldD; ids.push(a.id);
    }
    this.events.push({ t: 'f3fx', k: 'ward', id: m.id, x: r2(m.x), z: r2(m.z), r: ACOLYTE.wardR, ids });
  },

  // Spire Sentinel (and the Old Bastion): armoured until Broken; a stomp around itself. The Bastion calls rams when Broken.
  f3Sentinel(m, dt) {
    const target = this.f3Pre(m), t = this.time;
    if (m.staggerUntil > m.crackFrom) { // Broken: the armour cracks
      m.crackFrom = m.staggerUntil; m.crackedUntil = t + SENTINEL.crack;
      this.events.push({ t: 'f3fx', k: 'crack', id: m.id, x: r2(m.x), z: r2(m.z), d: SENTINEL.crack });
      if (m.def.calls) this.bastionCall(m);
    }
    if (target === false) return;
    if (m.stompAt) {
      if (t < m.stompAt) return;
      m.stompAt = 0;
      return;
    }
    if (!target) { m.stompT = 0; return this.f3Brute(m, dt, null); }
    if (!m.stompT) m.stompT = t + SENTINEL.stompFirst;
    const R = m.def.rare ? SENTINEL.stompRBig : SENTINEL.stompR;
    if (t >= m.stompT && !m.windupAt && dist(m, target) < R + 1) {
      m.stompT = t + SENTINEL.stompEvery; m.stompAt = t + SENTINEL.stompWind;
      this.events.push({ t: 'tele', x: r2(m.x), z: r2(m.z), r: R, d: SENTINEL.stompWind, k: 'stomp', follow: m.id, id: m.id });
      this.schedule(SENTINEL.stompWind, () => {
        if (m.dead) return;
        this.events.push({ t: 'f3fx', k: 'stomp', id: m.id, x: r2(m.x), z: r2(m.z), r: R });
        for (const p of this.players.values()) if (!p.dead && dist(p, m) <= R) this.damagePlayer(p, this.f3Atk(m) * SENTINEL.stompMult, { ground: true, src: `${m.type} stomp`, mob: m });
      });
      return;
    }
    this.f3Brute(m, dt, target, 0.7);
  },
  bastionCall(m) {
    let alive = 0; for (const a of this.mobs.values()) if (a.summoned && !a.dead) alive++;
    for (let i = 0; i < m.def.calls && alive < 4; i++, alive++) {
      const a = Math.random() * Math.PI * 2;
      let [x, z] = resolveCollision(m.x + Math.sin(a) * 9, m.z + Math.cos(a) * 9, 1.2);
      if (!walkable(x, z)) [x, z] = [m.x, m.z];
      const r = this.addMob('ram', x, z);
      this.f3Init(r); r.summoned = true; r.sx = r.x; r.sz = r.z;
      for (const [pid, v] of m.threat) r.threat.set(pid, v * 0.5);
      this.events.push({ t: 'f3fx', k: 'call', id: m.id, x: r2(x), z: r2(z) });
    }
  },

  f3Circle(m, x, z, r, wind, amount, kind, src) {
    this.events.push({ t: 'tele', x: r2(x), z: r2(z), r, d: wind, k: kind });
    this.schedule(wind, () => {
      if (m.dead) return;
      this.events.push({ t: 'f3fx', k: kind, x: r2(x), z: r2(z), r });
      for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.z - z) <= r) this.damagePlayer(p, amount, { ground: true, src, mob: m });
    });
  },

  // ---------- the Storm Colossus ----------
  f3Colossus(m, dt) {
    const target = this.f3Pre(m);
    if (target === false) return;
    const t = this.time, C = COLOSSUS, def = m.def;
    if (!target) {
      m.windupAt = 0;
      if (m.engaged || m.hp < m.maxHp) this.resetColossus(m);
      this.f3Wander(m, dt);
      return;
    }
    if (!m.engaged) this.engageColossus(m);
    this.colossusSpecials(m, target);
    if (t < m.busyUntil || m.ov) return;
    if (m.windupAt) { if (t >= m.windupAt) { m.windupAt = 0; this.f3Bite(m); } return; }
    m.face = angleTo(m.x, m.z, target.x, target.z);
    const d = dist(m, target);
    if (d > def.range + 0.4) this.f3Move(m, target.x, target.z, def.speed * (m.phase === 2 ? 1.15 : 1), dt, def.range);
    else if (t >= m.atkT) {
      const [r, h] = BITE.colossus;
      m.windupAt = t + C.cleave.wind; m.atkT = t + def.atkCd * (m.phase === 2 ? 0.85 : 1) + C.cleave.wind * (1 - 1 / PACE);
      this.events.push({ t: 'wind', id: m.id, d: C.cleave.wind, f: r2(m.face), r, h });
    }
  },

  // Scale to the fighters who walk in: health by party weight (role) and level, damage by headcount.
  engageColossus(m) {
    const t = this.time, C = COLOSSUS, tw = this.twist3Def();
    const ps = [...this.players.values()].filter(p => !p.dead && inArena3(p.x, p.z));
    const weight = Math.max(0.6, ps.reduce((s, p) => s + (C.hpRole[CLASSES[p.cls]?.role] ?? 1), 0));
    const avg = ps.length ? ps.reduce((s, p) => s + p.lvl, 0) / ps.length : m.def.level, over = Math.max(0, avg - MOBS.colossus.level);
    m.engaged = true;
    m.maxHp = m.hp = Math.round((C.hpBase + C.hpPer * Math.pow(weight, C.hpExp)) * (1 + C.hpLvl * over));
    m.def = { ...MOBS.colossus, atk: Math.round(MOBS.colossus.atk * (1 + C.atkPer * Math.max(0, ps.length - 3)) * 10) / 10 };
    m.phase = 0; m.busyUntil = 0; m.ov = null; m.groundedUntil = 0; m.chargedUntil = 0;
    m.strikeT = t + C.strike.first; m.gustT = t + C.gust.first - (tw.gustSooner || 0);
    m.ovT = tw.from === 0 ? t + 14 : Infinity; m.harpyT = m.beamT = Infinity;
    this.startFight3(m);
  },

  colossusSpecials(m, target) {
    const t = this.time, C = COLOSSUS, f = m.hp / m.maxHp, tw = this.twist3Def();
    const want = f < C.phases[1] ? 2 : f < C.phases[0] ? 1 : 0;
    while (m.phase < want) {
      m.phase++;
      this.events.push({ t: 'f3phase', id: m.id, n: m.phase });
      if (m.phase === 1) {
        this.sys('The Storm Colossus crackles with power! When it kneels to OVERLOAD: Break it, then Switch (or Team Burst).');
        m.ovT = Math.min(m.ovT, t + C.overload.first); m.harpyT = t + C.harpies.first;
      } else {
        this.sys('The Tempest Beam! Jump over the lightning as it sweeps past you.');
        m.beamT = t + C.beam.first; m.ovT = Math.min(m.ovT, t + C.overload.every[2] * 0.6);
      }
    }
    const fighters = [...this.players.values()].filter(p => !p.dead && inArena3(p.x, p.z));
    const pick = () => fighters[Math.floor(Math.random() * fighters.length)] || target;
    const free = t >= m.busyUntil && !m.windupAt && !m.ov;
    if (m.ov) return; // channelling Overload: nothing else (updateFloor3 resolves it)

    // Overload: phase 2+ (phase 1 with Static)
    if (t >= m.ovT && free && !this.director?.running) { this.startOverload(m, fighters); return; }
    // Tempest Beam (phase 3)
    if (m.phase >= 2 && t >= m.beamT && free) { m.beamT = t + C.beam.every[2]; this.tempestBeam(m); return; }
    // Gale Push: a cone in front, then a shove
    if (t >= m.gustT && free) { m.gustT = t + C.gust.every[m.phase] - (tw.gustSooner || 0); this.galePush(m, target); return; }
    // Lightning Strikes: under fighters plus strays
    if (t >= m.strikeT && t >= m.busyUntil) this.lightningStrikes(m, fighters, target);
    // Gale Harpies drop in (phase 2+)
    if (m.phase >= 1 && t >= m.harpyT) {
      const H = C.harpies;
      m.harpyT = t + H.every;
      let alive = 0; for (const h of this.mobs.values()) if (h.temp3 && !h.dead) alive++;
      for (let i = 0; i < H.n && alive < H.max; i++, alive++) {
        const a = Math.random() * Math.PI * 2;
        const h = this.addMob('harpy', F3.arena.x + Math.sin(a) * 18, F3.arena.z + Math.cos(a) * 18);
        this.f3Init(h); h.temp3 = true; h.sx = h.x; h.sz = h.z;
        const v = pick(); if (v) h.threat.set(v.id, 5);
        this.events.push({ t: 'f3fx', k: 'swoop', id: h.id, x: r2(h.x), z: r2(h.z) });
      }
    }
    this.bossTeam?.(m, fighters); // team mechanics: shared meteor, spread, tether (server/bossteam.js)
  },

  lightningStrikes(m, fighters, target) {
    const t = this.time, S = COLOSSUS.strike, tw = this.twist3Def();
    const pick = () => fighters[Math.floor(Math.random() * fighters.length)] || target;
    const rndSpot = (rmax = 20) => { const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * (rmax - 3); return [F3.arena.x + Math.sin(a) * d, F3.arena.z + Math.cos(a) * d]; };
    m.strikeT = t + S.every[m.phase];
    const spots = [];
    const v = pick(); spots.push([v.x, v.z]);
    if (m.phase >= 1 && fighters.length > 1) { const w = pick(); if (w !== v) spots.push([w.x, w.z]); }
    for (let i = 0; i < S.extra[m.phase] + (tw.extra || 0); i++) spots.push(rndSpot());
    this.events.push({ t: 'f3fx', k: 'raise', id: m.id, d: S.wind }); // its free hand to the sky
    for (const [x, z] of spots) {
      this.f3Circle(m, x, z, S.r, S.wind, this.f3Atk(m) * S.mult, 'strike', 'colossus lightning');
      if (tw.chain) this.schedule(tw.chain, () => { if (!m.dead && m.engaged) this.f3Circle(m, x, z, S.r, S.wind * 0.6, this.f3Atk(m) * S.mult * 0.7, 'strike', 'colossus lightning'); });
    }
  },

  galePush(m, target) {
    const G = COLOSSUS.gust, t = this.time, tw = this.twist3Def();
    m.face = angleTo(m.x, m.z, target.x, target.z); m.busyUntil = t + G.wind + 0.45; m.windupAt = 0;
    const face = m.face;
    this.events.push({ t: 'f3fx', k: 'gust', id: m.id, x: r2(m.x), z: r2(m.z), f: r2(face), r: G.r, h: G.half, d: G.wind });
    this.schedule(G.wind, () => {
      if (m.dead || !m.engaged) return;
      this.events.push({ t: 'f3fx', k: 'gusthit', id: m.id, x: r2(m.x), z: r2(m.z), f: r2(face), r: G.r, h: G.half });
      for (const p of this.players.values()) {
        if (p.dead || !inArena3(p.x, p.z)) continue;
        const d = dist(m, p);
        if (d > G.r + 0.5 || (d > m.def.radius + 0.8 && Math.abs(wrapAngle(angleTo(m.x, m.z, p.x, p.z) - face)) > G.half)) continue;
        const iframed = t + G.wind <= p.iframeUntil || this.time < p.iframeUntil;
        this.damagePlayer(p, this.f3Atk(m) * G.mult, { src: 'gale push', mob: m });
        if (!iframed && !p.dead) { const a = angleTo(m.x, m.z, p.x, p.z); this.shove(p, Math.sin(a), Math.cos(a), G.shove * (tw.shove || 1), inArena3); }
      }
    });
  },

  // Overload: the Colossus kneels and channels; its guard is open (posture half full). Break it and land a Switch (or a
  // Team Burst; solo: a Break) before the channel ends, or Thunderclap hits everyone on the plateau.
  startOverload(m, fighters) {
    const O = COLOSSUS.overload, t = this.time, tw = this.twist3Def();
    const secs = O.channel - (tw.shorter || 0);
    m.ovT = t + (O.every[m.phase] || O.every[1]) + secs;
    m.windupAt = 0; m.busyUntil = t + secs;
    m.ov = { start: t, until: t + secs, seen: m.staggerUntil, broke: false, burst: false, solo: fighters.length < 2 };
    m.posture = Math.max(m.posture || 0, this.postureCap(m) * O.posture);
    this.events.push({ t: 'f3ov', s: 'start', id: m.id, d: secs, solo: m.ov.solo ? 1 : 0 });
    this.sys(m.ov.solo ? 'OVERLOAD! Break the Colossus before the storm breaks!' : 'OVERLOAD! Break the Colossus, then SWITCH (or Team Burst) before the storm breaks!');
  },

  updateOverload(m) {
    const ov = m.ov, t = this.time, O = COLOSSUS.overload;
    if (!ov) return;
    if (m.dead || !m.engaged) { m.ov = null; return; }
    if (m.staggerUntil > ov.seen) { ov.seen = m.staggerUntil; ov.broke = true; }
    const stopped = ov.broke && (ov.solo || m.switched || ov.burst);
    if (stopped) {
      const tw = this.twist3Def(), stun = O.stun + (tw.stun || 0);
      m.ov = null; m.busyUntil = 0;
      m.stunUntil = Math.max(m.stunUntil, t + stun); m.groundedUntil = t + stun + O.weakD;
      this.events.push({ t: 'f3ov', s: 'stop', id: m.id, d: stun + O.weakD, by: ov.burst ? 'burst' : ov.solo ? 'break' : 'switch' });
      if (F3STATS) console.log(`[ov] stop ${ov.burst ? 'burst' : ov.solo ? 'break' : 'switch'} after ${r1(t - ov.start)}s`);
      this.sys('The Colossus is GROUNDED! Hit it hard while it\'s down.');
      for (const p of this.players.values()) if (!p.dead && inArena3(p.x, p.z)) this.teamStat?.(p, 'mechanic');
      return;
    }
    if (t < ov.until) return;
    m.ov = null; m.busyUntil = t + 0.6; m.chargedUntil = t + O.charged;
    this.events.push({ t: 'f3ov', s: 'clap', id: m.id, x: r2(m.x), z: r2(m.z) });
    if (F3STATS) console.log(`[ov] clap (broke ${ov.broke ? 1 : 0})`);
    this.sys('THUNDERCLAP! The Colossus is Charged: it hits harder for a while.');
    for (const p of this.players.values()) {
      if (p.dead || !inArena3(p.x, p.z)) continue;
      const keep = p.iframeUntil; p.iframeUntil = 0; // a roll doesn't dodge the whole sky
      try { this.damagePlayer(p, p.maxHp * O.clap, { src: 'thunderclap', mob: m }); } finally { if (keep > t && !p.dead) p.iframeUntil = keep; }
    }
  },

  // Tempest Beam: the sword planted, a beam of lightning sweeps a full turn around it. Jump it or roll through it.
  tempestBeam(m) {
    const B = COLOSSUS.beam, t = this.time, dir = Math.random() < 0.5 ? 1 : -1;
    m.busyUntil = t + B.wind + B.turn + 0.4; m.windupAt = 0;
    const b = { id: this.id(), m, x: m.x, z: m.z, a0: m.face, dir, start: t + B.wind, turn: B.turn, prev: m.face, hit: new Set(), atk: this.f3Atk(m) * B.mult };
    this.beams.push(b);
    this.events.push({ t: 'f3beam', id: b.id, by: m.id, x: r2(b.x), z: r2(b.z), a0: r2(b.a0), dir, d: B.wind, turn: B.turn, len: B.len, w: B.w, from: B.from });
  },

  resetColossus(m) {
    this.endFight3('wipe', m);
    m.def = MOBS.colossus; m.hp = m.maxHp = m.def.hp; m.phase = 0; m.engaged = false; m.contributors.clear(); m.busyUntil = 0; m.ov = null;
    m.groundedUntil = 0; m.chargedUntil = 0;
    this.clearF3Fight();
    this.events.push({ t: 'f3fx', k: 'reset', id: m.id });
  },

  clearF3Fight() {
    for (const h of [...this.mobs.values()]) {
      if (!h.temp3) continue;
      if (!h.dead) this.events.push({ t: 'die', id: h.id, x: r2(h.x), z: r2(h.z), b: 0 });
      this.mobs.delete(h.id);
    }
    this.beams = [];
  },

  startFight3(m) {
    const ids = [...this.players.values()].filter(p => !p.dead && inArena3(p.x, p.z)).map(p => p.id);
    this.fight3 = { start: this.time, ids: new Set(ids), deaths: 0, hp: m.maxHp };
    for (const id of ids) this.track(this.players.get(id), 'boss3_start', { players: ids.length, hp: m.maxHp, twist: this.twist3?.id });
  },

  endFight3(result, m) {
    const f = this.fight3;
    if (!f) return;
    this.fight3 = null;
    const data = { result, secs: Math.round(this.time - f.start), players: f.ids.size, deaths: f.deaths, hpLeft: result === 'wipe' ? Math.round((m.hp / m.maxHp) * 100) : 0, phase: m.phase, twist: this.twist3?.id };
    let first = true;
    for (const id of f.ids) { const p = this.players.get(id); if (p) { this.track(p, 'boss3_end', first ? data : { ...data, sys: 1 }); first = false; } }
  },

  // Called from killMob (after the shared bookkeeping) when the Colossus dies.
  killColossus(m, killer) {
    const ids = new Set([...m.contributors, ...(this.fight3?.ids || [])]);
    const names = [], rw = this.twist3Def().reward || {};
    for (const id of ids) {
      const p = this.players.get(id);
      if (!p) continue;
      names.push(p.name); this.giveXp(p, m.def.xp); this.dropLoot(p, m);
      for (let i = 0; i < (rw.loot || 0); i++) { // twist reward: extra Rare+ rolls
        const it = rollGear(SLOTS[Math.floor(Math.random() * SLOTS.length)], Math.max(2, rollRarity('boss3')), p.cls, Math.random, undefined, 'roll');
        if (this.giveItem(p, it)) this.invChanged(p);
      }
      if (rw.gold) { p.gold += Math.round(470 * rw.gold); p.dirty = true; }
    }
    const quiet = this.quietClear?.(ids, 'the Storm Colossus'); // the Named alone: one quiet line (server/named.js)
    if (this.giveItem(killer, lastAttackItem3())) this.invChanged(killer);
    if (!quiet) {
      this.events.push({ t: 'la3', id: killer.id, name: killer.name, x: r2(m.x), z: r2(m.z) });
      this.sys(`LAST ATTACK BONUS: ${killer.name} landed the final blow and earned the Stormheart!`);
    }
    this.clearF3Fight();
    if (quiet) this.sys(quiet);
    else {
      this.floorClears3++;
      this.events.push({ t: 'clear3', names, n: this.floorClears3 });
      this.sys(`The Storm Colossus has fallen! Floor 3 cleared by ${names.join(', ')}.`);
    }
    this.recordClear3(m, killer, ids);
    this.endFight3('kill', m);
    m.engaged = false; m.ov = null;
  },

  recordClear3(m, killer, ids) {
    const f = this.fight3, first = !this.hadFirstClear3;
    this.hadFirstClear3 = true;
    const party = [];
    for (const id of ids) {
      const p = this.players.get(id);
      if (!p) continue;
      party.push({ name: p.name, cls: p.cls, lvl: p.lvl });
      p.stats.colossusKills = (p.stats.colossusKills || 0) + 1; p.dirty = true;
      this.checkTitles(p);
    }
    if (first) this.ringBell(3, { auto: true }); // the Tower Bell (server/bell.js): the third bell
    this.onClear?.({ floor: 3, secs: f ? Math.round(this.time - f.start) : 0, players: party, lastAttack: killer.name, deaths: f?.deaths || 0, first });
  },

  // After the Sovereign dies: unlock Floor 3 for everyone who fought, and open the Stairway in the Sunken Court.
  f3SovereignKilled(ids) {
    for (const id of ids) {
      const p = this.players.get(id);
      if (!p) continue;
      if (!floorUnlocked(p.stats, 3)) this.sys('Floor 3 — The Gale Spires is open to you. Step into the Stairway (F), or use a waystone.', p.id);
      p.stats.floor3 = 1; p.dirty = true; this.invChanged(p);
    }
    this.portal3 = { x: STAIRWAY3.x, z: STAIRWAY3.z, until: this.time + STAIRWAY3.secs };
    this.events.push({ t: 'stair', x: STAIRWAY3.x, z: STAIRWAY3.z, d: STAIRWAY3.secs, f: 3 });
  },

  // ---------- the Storm Gate ----------
  toggleReady3(p) {
    const g = this.gate3;
    if (p.dead || g.open || !inGateZone3(p.x, p.z)) return;
    if (g.ready.has(p.id)) g.ready.delete(p.id);
    else { g.ready.add(p.id); this.track(p, 'gate3_ready', {}); }
  },

  updateGate3() {
    const g = this.gate3, t = this.time;
    const waiting = [...this.players.values()].filter(p => !p.dead && inGateZone3(p.x, p.z));
    for (const id of g.ready) if (!waiting.some(p => p.id === id)) g.ready.delete(id);
    if (!g.open) {
      if (!g.ready.size) g.firstReadyAt = 0; else if (!g.firstReadyAt) g.firstReadyAt = t;
      const allReady = waiting.length > 0 && (g.ready.size === waiting.length || (g.firstReadyAt && t - g.firstReadyAt >= GATE3.force));
      if (allReady && !g.countAt) { g.countAt = t + GATE3.count; this.events.push({ t: 'gate3', s: 'count', d: GATE3.count }); }
      else if (!allReady && g.countAt) { g.countAt = 0; this.events.push({ t: 'gate3', s: 'cancel' }); }
      if (g.countAt && t >= g.countAt) {
        g.open = true; g.countAt = 0; g.ready.clear(); g.emptySince = 0;
        this.events.push({ t: 'gate3', s: 'open' });
        this.sys('The Storm Gate grinds open. The Storm Colossus awaits.');
      }
      return;
    }
    const inside = [...this.players.values()].some(p => !p.dead && (inArena3(p.x, p.z) || (Math.abs(p.x - GATE3.x) < 7 && p.z > GATE3.band[0] - 1)));
    const c = this.colossus, busy = c && !c.dead && c.threat.size > 0;
    if (inside || busy) { g.emptySince = 0; return; }
    if (!g.emptySince) g.emptySince = t;
    if (t - g.emptySince > 15) { g.open = false; g.emptySince = 0; this.events.push({ t: 'gate3', s: 'close' }); }
  },

  // ---------- per-tick Floor 3 upkeep (called from Game.update) ----------
  updateFloor3(dt) {
    const t = this.time;
    for (const p of this.players.values()) {
      if (p.x > F3.split && !p.dead && !floorUnlocked(p.stats, 3)) { p.stats.floor3 = 1; p.dirty = true; this.invChanged(p); } // e.g. SPAWN_AT on Floor 3
      if (p.dead && !p.f3Dead) {
        p.f3Dead = true;
        const f = this.fight3;
        if (f && (f.ids.has(p.id) || inArena3(p.x, p.z))) f.deaths++;
      } else if (!p.dead) p.f3Dead = false;
    }
    this.updateGate3();
    if (this.colossus) this.updateOverload(this.colossus);

    // charges (rams) and dives (harpies): move along the lane, hit what's in the way
    for (const c of this.charges) {
      const m = c.m;
      if (m.dead) { c.done = c.len; continue; }
      if (t < m.stunUntil) { c.done = c.len; continue; } // stopped dead (a guard)
      const step = Math.min(c.len - c.done, c.sp * dt);
      let nx = m.x + c.ux * step, nz = m.z + c.uz * step;
      [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
      if (!this.f3Free(m, nx, nz) || Math.hypot(nx - m.x, nz - m.z) < step * 0.3) c.done = c.len; // a wall or a tree
      else { m.x = nx; m.z = nz; m.moving = true; c.done += step; }
      for (const p of this.players.values()) {
        if (p.dead || c.hit.has(p.id) || dist(m, p) > c.w + m.def.radius * 0.6 + 0.5) continue;
        c.hit.add(p.id);
        if (c.kind === 'ram' && p.guarding && Math.abs(wrapAngle(angleTo(p.x, p.z, m.x, m.z) - p.face)) <= GUARD.arc) { // braced: stopped dead
          this.damagePlayer(p, this.f3Atk(m) * RAM.mult, { src: 'ram charge', mob: m });
          m.stunUntil = t + RAM.stun; c.done = c.len;
          this.events.push({ t: 'f3fx', k: 'braced', id: m.id, by: p.id, x: r2(m.x), z: r2(m.z) });
          this.teamStat?.(p, 'save');
          break;
        }
        const iframed = t < p.iframeUntil;
        this.damagePlayer(p, this.f3Atk(m) * (c.kind === 'ram' ? RAM.mult : HARPY.mult), { src: c.kind === 'ram' ? 'ram charge' : `${m.type} dive`, mob: m });
        if (c.kind === 'ram' && !iframed && !p.dead) this.shove(p, c.ux, c.uz, RAM.shove);
      }
      if (c.done >= c.len) {
        if (c.kind === 'ram') { m.state = null; m.atkT = t + 0.8; }
        else if (m.state === 'dive') this.harpyLand(m);
      }
    }
    this.charges = this.charges.filter(c => c.done < c.len);

    // the Tempest Beam: a line from the Colossus sweeping round; anyone it crosses who isn't airborne or rolling is hit
    const B = COLOSSUS.beam;
    for (const b of this.beams) {
      if (t < b.start) continue;
      const k = Math.min(1, (t - b.start) / b.turn), a = b.a0 + b.dir * B.sweep * k;
      for (const p of this.players.values()) {
        if (p.dead || b.hit.has(p.id) || !inArena3(p.x, p.z)) continue;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < B.from || d > B.len) continue;
        const ap = angleTo(b.x, b.z, p.x, p.z), tol = Math.atan2(B.w + 0.45, d);
        const from = wrapAngle(ap - b.prev) * b.dir, to = (a - b.prev) * b.dir; // how far round the beam must go to reach p, and went
        if (!(from > -tol && from <= to + tol)) continue;
        b.hit.add(p.id);
        if (F3STATS) console.log(`[beam] ${t < p.iframeUntil ? 'roll' : t >= p.airFrom && t < p.airUntil ? 'jump' : 'hit'}`);
        this.damagePlayer(p, b.atk, { ground: true, src: 'tempest beam', mob: b.m }); // airborne (jumping) or i-frames dodge it
      }
      b.prev = a; b.k = k;
    }
    this.beams = this.beams.filter(b => (b.k ?? 0) < 1 && !b.m.dead && b.m.engaged);
    if (this.portal3 && t >= this.portal3.until) this.portal3 = null;
  },

  // Floor 3 state for the snapshot (w.f3).
  f3Snap() {
    const g = this.gate3, t = this.time, c = this.colossus;
    const waiting = [...this.players.values()].filter(p => !p.dead && inGateZone3(p.x, p.z)).length;
    const air = [], ward = [], crk = [], chan = [], down = [];
    for (const m of this.mobs.values()) {
      if (m.dead || !m.def.f3) continue;
      if (m.aloft && m.state !== 'grounded' && m.state !== 'dive') air.push(m.id);
      if (m.state === 'grounded') down.push(m.id);
      if (m.ward > 0 && t < m.wardUntil) ward.push(m.id);
      if (m.def.armor && t < m.crackedUntil) crk.push(m.id);
      if (m.chan) chan.push([m.id, r1(Math.max(0, m.chan.until - t))]);
    }
    return {
      gate: [g.open ? 1 : 0, waiting, g.ready.size, g.countAt ? r1(Math.max(0, g.countAt - t)) : 0],
      ph: c?.phase || 0, tw: this.twist3?.id || null,
      ov: c?.ov ? [r1(Math.max(0, c.ov.until - t)), r1(c.ov.until - c.ov.start), c.ov.broke ? 1 : 0] : 0,
      gr: c && t < c.groundedUntil ? r1(c.groundedUntil - t) : 0, ch: c && t < c.chargedUntil ? r1(c.chargedUntil - t) : 0,
      air, ward, crk, chan, down,
      stair: this.portal3 ? [this.portal3.x, this.portal3.z, r1(this.portal3.until - t)] : 0,
    };
  },
};

export function installFloor3(Game) {
  Object.assign(Game.prototype, F3Methods);
  const P = Game.prototype;
  // Travel: the Floor 3 waystone and the Stairway from the Sunken Court; Floors 1-2 go through Floor 2's warp.
  const warp = P.warp;
  P.warp = function (p, f) {
    f = f | 0;
    const t = this.time, atStair3 = this.portal3 && t < this.portal3.until && Math.hypot(p.x - this.portal3.x, p.z - this.portal3.z) < STAIRWAY3.use;
    if (f !== 3 || p.dead) return warp.call(this, p, f);
    const ws = nearWaystone(p.x, p.z);
    if (!ws && !atStair3) return;
    if (!floorUnlocked(p.stats, 3)) return this.sys('Floor 3 is sealed. Help defeat the Drowned Sovereign to open it.', p.id);
    if (!atStair3 && floorOf(p.x) === 3) return this.sys('You are already on Floor 3.', p.id);
    const [x, z] = this.campPoint(3);
    this.events.push({ t: 'warp', id: p.id, x0: r2(p.x), z0: r2(p.z), x: r2(x), z: r2(z), f: 3 });
    this.gate.ready.delete(p.id); this.gate2.ready.delete(p.id); this.gate3.ready.delete(p.id);
    this.teleport(p, x, z);
    this.sys(`${p.name} travelled to ${FLOOR_NAMES[3]}.`, p.id);
    this.track(p, 'warp', { f: 3, via: atStair3 ? 'stairway' : 'waystone' });
  };
  const campPoint = P.campPoint;
  P.campPoint = function (f) {
    if (f !== 3) return campPoint.call(this, f);
    const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 3;
    return resolveCollision(F3.camp.x + Math.sin(a) * d, F3.camp.z + 3 + Math.cos(a) * d);
  };
  // Death on Floor 3 sends you back to Windbreak Camp (or to SPAWN_AT when that testing aid points at Floor 3).
  const respawnPoint = P.respawnPoint;
  P.respawnPoint = function (p) {
    if (p.x <= F3.split) return respawnPoint.call(this, p);
    if (process.env.SPAWN_AT) { const [x, z] = process.env.SPAWN_AT.split(',').map(Number); if (x > F3.split) return [x, z]; }
    return this.campPoint(3);
  };
  // The Sovereign's kill unlocks Floor 3 and opens the Stairway up.
  const killSovereign = P.killSovereign;
  P.killSovereign = function (m, killer) {
    const ids = new Set([...m.contributors, ...(this.fight2?.ids || [])]);
    const out = killSovereign.call(this, m, killer);
    this.f3SovereignKilled(ids);
    return out;
  };

}

// After staging and boss team mechanics (game.js): forceBossMove (server/staging.js, the director's boss_move) learns the
// Colossus's own moves (G4 team moves and the other bosses fall through), plus testing aids.
export function installFloor3Moves(Game) {
  const P = Game.prototype;
  const force = P.forceBossMove;
  P.forceBossMove = function (mob, move, targetId) {
    const m = this.mobRef?.(mob) ?? mob;
    if (!m || m.dead || m.type !== 'colossus' || !COLOSSUS_MOVES.includes(move)) return force ? force.call(this, mob, move, targetId) : false;
    const fighters = [...this.players.values()].filter(p => !p.dead && inArena3(p.x, p.z));
    let v = targetId != null ? this.players.get(targetId | 0) : null;
    if (!v || v.dead) v = fighters.sort((a, b) => dist(a, m) - dist(b, m))[0] || null;
    const t = this.time, C = COLOSSUS;
    if (v) m.face = angleTo(m.x, m.z, v.x, v.z);
    switch (move) {
      case 'hammerfall': {
        const [r, h] = BITE.colossus;
        m.windupAt = t + C.cleave.wind; m.atkT = t + m.def.atkCd + C.cleave.wind; m.busyUntil = Math.min(m.busyUntil || 0, t);
        this.events.push({ t: 'wind', id: m.id, d: C.cleave.wind, f: r2(m.face), r, h });
        return true;
      }
      case 'lightning': this.lightningStrikes(m, fighters, v || m); return true;
      case 'gale_push': if (!v) return false; m.gustT = t + C.gust.every[m.phase]; this.galePush(m, v); return true;
      case 'overload': if (m.ov) return false; this.startOverload(m, fighters); return true;
      case 'tempest_beam': m.beamT = t + C.beam.every[2]; this.tempestBeam(m); return true;
    }
    return false;
  };
  // Testing aids (TEST_HOOKS=1 only): { type: 'test', tp: [x, z] } moves you there (screenshot tours); { unlock: 3 };
  // { type: 'test', f3move } forces one of the Colossus's moves (forceBossMove).
  const handle = P.handle;
  P.handle = function (p, msg) {
    if (msg?.type === 'test' && process.env.TEST_HOOKS && p) {
      if (Array.isArray(msg.tp)) { const [x, z] = msg.tp.map(Number); if (walkable(x, z)) this.teleport(p, x, z); return; }
      if (msg.unlock === 3) { p.stats.floor2 = 1; p.stats.floor3 = 1; p.dirty = true; this.invChanged(p); return; } // { unlock: 3 }: Floors 2 and 3 open (journey runs)
      if (msg.f3move && this.colossus) { if (!this.colossus.engaged && inArena3(p.x, p.z)) this.engageColossus(this.colossus); this.forceBossMove(this.colossus, msg.f3move, p.id); return; }
    }
    return handle.call(this, p, msg);
  };
}
