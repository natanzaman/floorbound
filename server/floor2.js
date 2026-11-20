// Floor 2 — The Glimmering Mire: server-side AI, the Drowned Sovereign, the second raid gate, the waypoints and the Stairway.
// Installed onto Game.prototype by server/game.js (Object.assign), so `this` is the Game.
import { BITE, PACE, CLASSES, MOBS, inTown, walkable, resolveCollision, rng, angleTo, wrapAngle } from '../shared/data.js';
import {
  F2, F2_SPAWNS, F2_MATRONS, GATE2, SOVEREIGN, ORB, WISP, LURK, MATRON, STAIRWAY,
  inArena2, inCamp2, inGateZone2, nearWaypoint, floorUnlocked, floorOf,
} from '../shared/floor2.js';
import { lastAttackItem2 } from '../shared/items.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
// The Sovereign's own timer per move (a combo step pushes it back: server/openings.js bossCombo)
const SOV_TIMERS = { geyser: 'geyserT', wave: 'waveT', thralls: 'thrallT', pools: 'poolT', volley: 'volleyT' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const QSTATS = !!process.env.QUAKE_STATS; // test/wardenskill.js BOSS=sovereign: count Tidal Wave evades / hits, geyser hits, Deluge ticks
const qlog = k => QSTATS && console.log(`[wave] ${k}`);

export const F2Methods = {
  // ---------- setup ----------
  initFloor2() {
    this.gate2 = { open: false, ready: new Set(), countAt: 0, emptySince: 0, firstReadyAt: 0 };
    this.orbs = []; this.pools = []; this.waves = [];
    this.portal = null; this.fight2 = null; this.deluge = false; this.floorClears2 = 0;
    const r = rng(11);
    for (const [type, n, xs, zs] of F2_SPAWNS) {
      for (let i = 0; i < n; i++) {
        let x, z, k = 0;
        do { x = xs[0] + r() * (xs[1] - xs[0]); z = zs[0] + r() * (zs[1] - zs[0]); } while (++k < 20 && Math.abs(x - F2.x) < 6);
        this.f2Init(this.addMob(type, x, z));
      }
    }
    for (const [x, z] of F2_MATRONS) this.f2Init(this.addMob('matron', x, z));
    this.sovereign = this.addMob('sovereign', F2.arena.x, F2.arena.z + 4);
    this.newTwist2(); // Sovereign twist for the first fight (server/sovtwists.js)
  },

  f2Init(m) {
    if (m.type === 'lurker') { m.hidden = true; m.erupt = null; m.huntSince = 0; m.eruptT = 0; }
    m.engaged = false;
    return m;
  },

  // ---------- shared mob helpers ----------
  f2Valid(m, p) {
    if (!p || p.dead || p.x <= F2.split || inTown(p.x, p.z)) return false;
    if (m.def.boss || m.temp2) return inArena2(p.x, p.z); // the Sovereign and its thralls stay in the court
    return dist(m, p) < 40;
  },

  // Common upkeep. Returns false (dead or stunned: skip this tick), null (no target) or the target player.
  f2Pre(m) {
    const t = this.time, def = m.def;
    m.moving = false;
    if (m.dead) {
      if (m.temp2) { this.mobs.delete(m.id); return false; }
      if (t >= m.deadUntil) {
        Object.assign(m, { dead: false, hp: def.hp, maxHp: def.hp, x: m.sx, z: m.sz, phase: 0, windupAt: 0, stunUntil: 0, busyUntil: 0 });
        m.threat.clear(); m.contributors.clear(); this.f2Init(m);
        if (def.boss) { this.sys('The Drowned Sovereign rises again in the Sunken Court.'); this.newTwist2(); }
      }
      return false;
    }
    for (const pid of [...m.threat.keys()]) if (!this.f2Valid(m, this.players.get(pid))) m.threat.delete(pid);
    if (def.aggro > 0) {
      for (const p of this.players.values()) if (!m.threat.has(p.id) && this.f2Valid(m, p) && dist(m, p) <= def.aggro) m.threat.set(p.id, 1);
    }
    if (!def.boss && !m.temp2 && Math.hypot(m.x - m.sx, m.z - m.sz) > 35) m.threat.clear();
    const target = this.targetOf(m); // the one target picker (server/threat.js)
    if (t < m.stunUntil) return false;
    return target;
  },

  f2Move(m, tx, tz, speed, dt, stopAt, keepFace = false) {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d <= stopAt) return false;
    speed *= this.mobSlowA?.(m) ?? 1; // caltrops (server/classes-a.js)
    const step = Math.min(d - stopAt, speed * dt);
    let nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
    [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
    if (inCamp2(nx, nz, 2)) return false;
    if ((m.def.boss || m.temp2) && !inArena2(nx, nz)) return false;
    if (!walkable(nx, nz)) return false;
    if (!keepFace) m.face = Math.atan2(dx, dz);
    m.x = nx; m.z = nz; m.moving = true;
    return true;
  },

  f2Wander(m, dt) {
    const t = this.time;
    if (t >= m.wanderT) {
      m.wanderT = t + 3 + Math.random() * 4;
      const a = Math.random() * 6.28, d = Math.random() * (m.def.boss ? 2 : 6);
      m.wx = m.sx + Math.sin(a) * d; m.wz = m.sz + Math.cos(a) * d;
    }
    this.f2Move(m, m.wx, m.wz, m.def.speed * 0.35, dt, 0.3);
  },

  f2Turn(m, want, dt) {
    if (!m.def.turn) { m.face = want; return; }
    m.face = wrapAngle(m.face + clamp(wrapAngle(want - m.face), -m.def.turn * dt, m.def.turn * dt));
  },

  matronNear(m) {
    for (const a of this.mobs.values()) if (a.type === 'matron' && !a.dead && dist(a, m) < MATRON.auraR) return true;
    return false;
  },

  // A melee hit on the wedge in front of the mob (shown as a red wedge during the wind-up).
  f2Bite(m) {
    const [reach, half] = BITE[m.type] || [m.def.range + 1, 0.6];
    const atk = m.def.atk * (m.type === 'lurker' && this.matronNear(m) ? 1 + MATRON.aura : 1) * (m.type === 'sovereign' ? (m.tm || this.sovS || SOVEREIGN).sweep.mult : 1);
    if (!m.def.boss) {
      let nx = m.x + Math.sin(m.face) * 0.7, nz = m.z + Math.cos(m.face) * 0.7;
      [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
      if (walkable(nx, nz) && !inCamp2(nx, nz, 2) && (!m.temp2 || inArena2(nx, nz))) { m.x = nx; m.z = nz; }
    }
    this.events.push({ t: 'fx', k: 'marc', id: m.id, x: r2(m.x), z: r2(m.z), f: r2(m.face), r: reach * 0.8, small: m.def.boss ? 0 : 1 });
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = dist(m, p);
      if (d > reach + 0.4) continue;
      if (d > m.def.radius + 0.6 && Math.abs(wrapAngle(angleTo(m.x, m.z, p.x, p.z) - m.face)) > half) continue;
      this.damagePlayer(p, atk, { src: m.def.boss ? 'sovereign trident' : `${m.type} bite` });
    }
  },

  // Called from damageMob for Floor 2 mobs: burrowed lurkers can't be hit; a Shieldback's front shell blocks most damage.
  f2DamageMod(m, p, base) {
    if (m.hidden) return 0;
    if (m.def.shell && this.time >= m.staggerUntil) {
      const rel = Math.abs(wrapAngle(angleTo(m.x, m.z, p.x, p.z) - m.face));
      if (rel < 1.05) { this.events.push({ t: 'blocked', id: m.id, by: p.id, to: p.id }); return base * m.def.shell; }
    }
    return base;
  },

  // ---------- AIs (MOBS[type].ai) ----------
  // Melee brutes: Shieldback (turns slowly: flank it), Drowned Thrall, and the base of the Matron / surfaced Lurker.
  f2Brute(m, dt, target) {
    if (target === undefined) target = this.f2Pre(m);
    if (target === false) return;
    const t = this.time, def = m.def;
    if (!target) { m.windupAt = 0; this.f2Wander(m, dt); return; }
    if (m.windupAt) { if (t >= m.windupAt) { m.windupAt = 0; this.f2Bite(m); } return; }
    const want = angleTo(m.x, m.z, target.x, target.z);
    this.f2Turn(m, want, dt);
    const d = dist(m, target);
    if (d > def.range + 0.4) this.f2Move(m, target.x, target.z, def.speed, dt, def.range, !!def.turn);
    else if (t >= m.atkT && Math.abs(wrapAngle(want - m.face)) < 0.6) {
      const wind = def.shell ? 0.7 : 0.5;
      const [r, h] = BITE[m.type];
      m.windupAt = t + wind; m.atkT = t + def.atkCd;
      this.events.push({ t: 'wind', id: m.id, d: wind, f: r2(m.face), r, h });
    }
  },

  // Will-o'-Wisp: keeps its distance, blinks away when approached, fires slow homing orbs after a telegraphed aim.
  f2Wisp(m, dt) {
    const target = this.f2Pre(m);
    if (target === false) return;
    const t = this.time, def = m.def;
    if (!target) { m.windupAt = 0; this.f2Wander(m, dt); return; }
    if (m.windupAt) {
      if (t >= m.windupAt) { m.windupAt = 0; const v = this.players.get(m.aimId); if (v && !v.dead) this.spawnOrb(m, v); }
      return;
    }
    let near = null, nd = WISP.blinkR;
    for (const p of this.players.values()) if (this.f2Valid(m, p) && dist(m, p) < nd) { nd = dist(m, p); near = p; }
    if (near && t >= (m.blinkT || 0) && this.wispBlink(m, near)) return;
    const d = dist(m, target);
    m.face = angleTo(m.x, m.z, target.x, target.z);
    if (d > WISP.keep[1]) this.f2Move(m, target.x, target.z, def.speed, dt, WISP.keep[1] - 1, true);
    else if (d < WISP.keep[0] && Math.hypot(m.x - m.sx, m.z - m.sz) < WISP.leash) this.f2Move(m, m.x * 2 - target.x, m.z * 2 - target.z, def.speed * 0.7, dt, 0, true);
    if (t >= m.atkT && d <= def.range) {
      m.windupAt = t + ORB.wind; m.atkT = t + def.atkCd; m.aimId = target.id;
      this.events.push({ t: 'wind', id: m.id, d: ORB.wind, f: r2(m.face), ax: r2(target.x), az: r2(target.z) });
    }
  },

  wispBlink(m, from) {
    const t = this.time;
    for (let i = 0; i < 12; i++) {
      const away = angleTo(from.x, from.z, m.x, m.z) + (Math.random() - 0.5) * 2.2;
      const d = WISP.blinkDist[0] + Math.random() * (WISP.blinkDist[1] - WISP.blinkDist[0]);
      let x = m.x + Math.sin(away) * d, z = m.z + Math.cos(away) * d;
      [x, z] = resolveCollision(x, z, m.def.radius);
      if (!walkable(x, z) || inCamp2(x, z, 3) || Math.hypot(x - m.sx, z - m.sz) > WISP.leash) continue;
      this.events.push({ t: 'f2fx', k: 'blink', id: m.id, x: r2(m.x), z: r2(m.z), x2: r2(x), z2: r2(z) });
      m.x = x; m.z = z; m.blinkT = t + WISP.blinkCd; m.windupAt = 0;
      return true;
    }
    m.blinkT = t + 1;
    return false;
  },

  spawnOrb(m, v, off = 0, mult = 1) {
    const a = angleTo(m.x, m.z, v.x, v.z) + off, o0 = m.def.radius + 0.5;
    const o = { id: this.id(), x: m.x + Math.sin(a) * o0, z: m.z + Math.cos(a) * o0, a, tid: v.id, ttl: ORB.ttl, atk: m.def.atk * mult, src: m.def.boss ? 'sovereign orb' : 'wisp orb' };
    this.orbs.push(o);
    this.events.push({ t: 'f2fx', k: 'orb', id: m.id, x: r2(o.x), z: r2(o.z) });
  },

  // Bog Lurker: burrowed and untouchable; erupts under anyone who stands still too long (or under its quarry after a while),
  // fights on the surface for a few seconds, then burrows again.
  f2Lurker(m, dt) {
    const target = this.f2Pre(m);
    if (target === false) return;
    const t = this.time;
    if (!m.hidden) {
      if (t >= m.upUntil && !m.windupAt) {
        m.hidden = true; m.eruptT = t + LURK.cd * 0.5; m.huntSince = t;
        this.events.push({ t: 'f2fx', k: 'burrow', id: m.id, x: r2(m.x), z: r2(m.z) });
        return;
      }
      return this.f2Brute(m, dt, target);
    }
    if (m.erupt) { if (t >= m.erupt.at) this.lurkerErupt(m); return; }
    if (!target) { m.huntSince = 0; this.f2Wander(m, dt); return; }
    if (!m.huntSince) m.huntSince = t;
    this.f2Move(m, target.x, target.z, LURK.speed, dt, 3);
    if (t < (m.eruptT || 0)) return;
    const called = t < (m.calledUntil || 0);
    let victim = null;
    for (const p of this.players.values()) {
      if (!this.f2Valid(m, p) || dist(m, p) > m.def.aggro + 2) continue;
      if (called || t - (p.stillSince ?? t) >= LURK.still) { victim = p; break; }
    }
    if (!victim && t - m.huntSince > LURK.hunt) victim = target;
    if (!victim) return;
    m.erupt = { at: t + LURK.wind, x: victim.x, z: victim.z };
    this.events.push({ t: 'tele', x: r2(victim.x), z: r2(victim.z), r: LURK.r, d: LURK.wind, k: 'lurk' });
  },

  lurkerErupt(m) {
    const t = this.time, { x, z } = m.erupt;
    m.erupt = null;
    [m.x, m.z] = resolveCollision(x, z, m.def.radius);
    m.hidden = false; m.upUntil = t + LURK.up; m.eruptT = t + LURK.cd; m.atkT = t + 0.9; m.huntSince = 0;
    this.events.push({ t: 'f2fx', k: 'erupt', id: m.id, x: r2(x), z: r2(z), r: LURK.r });
    const atk = m.def.atk * LURK.mult * (this.matronNear(m) ? 1 + MATRON.aura : 1);
    for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.z - z) <= LURK.r + 0.3) this.damagePlayer(p, atk, { ground: true, src: 'lurker eruption' });
  },

  // Mire Matron (elite): a brute that calls the lurkers around her up under her target; lurkers near her hit harder.
  f2Matron(m, dt) {
    const target = this.f2Pre(m);
    if (target === false) return;
    const t = this.time;
    if (target && !m.windupAt) {
      if (!m.callT) m.callT = t + 4;
      if (t >= m.callT) {
        m.callT = t + MATRON.callEvery;
        let n = 0;
        for (const l of this.mobs.values()) {
          if (l.type !== 'lurker' || l.dead || dist(l, m) > MATRON.callR) continue;
          l.calledUntil = t + 3; l.eruptT = Math.min(l.eruptT || 0, t);
          l.threat.set(target.id, Math.max(l.threat.get(target.id) || 0, 5)); n++;
        }
        this.events.push({ t: 'f2fx', k: 'call', id: m.id, x: r2(m.x), z: r2(m.z), r: MATRON.callR, n });
      }
    }
    if (!target) m.callT = 0;
    this.f2Brute(m, dt, target);
  },

  // ---------- the Drowned Sovereign ----------
  f2Sovereign(m, dt) {
    const target = this.f2Pre(m);
    if (target === false) return;
    const t = this.time, def = m.def;
    let S = m.tm || this.sovS || SOVEREIGN;
    if (!target) {
      m.windupAt = 0;
      if (m.engaged || m.hp < m.maxHp) this.resetSovereign(m);
      this.f2Wander(m, dt);
      return;
    }
    if (!m.engaged) { // scale to the group that walks in
      m.engaged = true;
      m.phase = 0; m.busyUntil = 0; m.geyserT = t + SOVEREIGN.geyser.first; m.waveT = m.thrallT = m.poolT = m.volleyT = Infinity; // (first-use delays: shared/bosstiming.js)
      this.twistEngage2(m); // Sovereign twist timers (server/sovtwists.js)
      this.scaleSovereign(m);
      S = this.bossTable(m, this.sovS || SOVEREIGN, [...this.players.values()].filter(p => !p.dead && inArena2(p.x, p.z)).length); // m.tm (server/openings.js)
      this.startFight2(m);
    }
    this.sovereignSpecials(m, target);
    if (t < m.busyUntil) return;
    if (m.windupAt) { if (t >= m.windupAt) { m.windupAt = 0; this.f2Bite(m); } return; }
    m.face = angleTo(m.x, m.z, target.x, target.z);
    const d = dist(m, target);
    if (d > def.range + 0.4) this.f2Move(m, target.x, target.z, def.speed * (m.phase === 2 ? 1.15 : 1), dt, def.range);
    else if (t >= m.atkT && this.swingReady(m)) {
      const [r, h] = BITE.sovereign;
      m.windupAt = t + S.sweep.wind; this.swingStart(m, S.sweep.wind); m.atkT = t + S.sweep.cd * (m.phase === 2 ? S.sweep.rage : 1) + S.sweep.wind * (1 - 1 / PACE); // the table's cd (cooldownMul) + the paced extra wind-up; swingStart: no point-blank chaining (server/openings.js)
      this.events.push({ t: 'wind', id: m.id, d: S.sweep.wind, f: r2(m.face), r, h });
    }
  },

  // Health from the party's role weight (like the Warden: server/game.js scaleWarden), damage from the party size, both
  // from the party's average level above the Sovereign's. A director show keeps the scaling it was staged with (S.show).
  scaleSovereign(m) {
    const S = this.director?.running ? { ...SOVEREIGN, ...SOVEREIGN.show } : SOVEREIGN, def = MOBS.sovereign;
    const ps = [...this.players.values()].filter(p => !p.dead && inArena2(p.x, p.z));
    const weight = S.hpRole ? Math.max(0.5, ps.reduce((s, p) => s + (S.hpRole[CLASSES[p.cls]?.role] ?? 1), 0)) : Math.max(1, ps.length);
    const avg = ps.length ? ps.reduce((s, p) => s + p.lvl, 0) / ps.length : def.level, over = Math.max(0, avg - def.level);
    m.maxHp = m.hp = Math.round((S.hpBase + S.hpPer * Math.pow(weight, S.hpExp)) * (1 + S.hpLvl * over));
    const atk = (S.atk ?? def.atk) * (1 + S.atkLvl * over) * (1 + S.atkPer * Math.max(0, ps.length - 3));
    m.def = { ...def, atk: Math.round(atk * 10) / 10 };
  },

  sovereignSpecials(m, target) {
    const t = this.time, S = m.tm || this.sovS || SOVEREIGN, f = m.hp / m.maxHp;
    const want = f < S.phases[1] ? 2 : f < S.phases[0] ? 1 : 0;
    while (m.phase < want) {
      m.phase++;
      this.dropAfter(m); // the last phase's combo and after state end, and its hold, before the Deluge call's (server/openings.js)
      this.events.push({ t: 'f2phase', id: m.id, n: m.phase });
      if (m.phase === 1) {
        this.sys('The Drowned Sovereign calls the tide! Roll THROUGH the Tidal Wave.');
        m.waveT = Math.min(m.waveT, t + S.wave.first); m.thrallT = Math.min(m.thrallT, t + SOVEREIGN.thralls.first); m.poolT = t + SOVEREIGN.pools.first;
      } else {
        this.sys('The Deluge! The outer court floods. Stay near the centre.');
        this.callDeluge(m); m.volleyT = t + SOVEREIGN.volley.first + S.deluge.wind; m.waveT = Math.min(m.waveT, t + SOVEREIGN.wave.firstAfterDeluge + S.deluge.wind);
      }
    }
    const fighters = [...this.players.values()].filter(p => !p.dead && inArena2(p.x, p.z));
    const pick = () => fighters[Math.floor(Math.random() * fighters.length)] || target;
    // Combos (the table's sequences), and the after state that follows one: its own timers wait (server/openings.js)
    if (this.bossCombo(m, k => this.sovMove(m, k, target, fighters, pick), SOV_TIMERS)) return;
    const free = t >= m.busyUntil && !m.windupAt;

    // Geysers: circles under fighters plus strays (roll or jump out)
    if (t >= m.geyserT && t >= m.busyUntil) { m.geyserT = t + S.geyser.every[m.phase]; this.sovMove(m, 'geyser', target, fighters, pick); }
    if (t >= m.waveT && free && S.wave.every[m.phase] > 0) { m.waveT = t + S.wave.every[m.phase]; this.tidalWave(m); } // (High Tide: from phase 1)
    if (t >= m.thrallT) { m.thrallT = t + S.thralls.every; this.sovMove(m, 'thralls', target, fighters, pick); } // phase 2 on (Drowned Host: from the start)
    if (m.phase >= 1 && t >= m.poolT) { m.poolT = t + S.pools.every; this.sovMove(m, 'pools', target, fighters, pick); }
    this.bossTeam?.(m, fighters); // team mechanics: shared meteor, spread, tether (server/bossteam.js)
    if (m.phase >= 2 && t >= m.volleyT && free) { m.volleyT = t + S.volley.every; this.sovMove(m, 'volley', target, fighters, pick); }
  },

  /** One of the Sovereign's moves, now (its own timer or a combo step). Returns when it ends (absolute s). */
  sovMove(m, k, target, fighters, pick) {
    const t = this.time, S = m.tm || this.sovS || SOVEREIGN;
    const rndSpot = (rmax = 20) => { const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * (rmax - 3); return [F2.arena.x + Math.sin(a) * d, F2.arena.z + Math.cos(a) * d]; };
    if (k === 'geyser') {
      const G = S.geyser, spots = [];
      const v = pick(); spots.push([v.x, v.z]);
      if (m.phase >= 1 && fighters.length > 1) { const w = pick(); if (w !== v) spots.push([w.x, w.z]); }
      for (let i = 0; i < G.extra[m.phase]; i++) spots.push(rndSpot());
      for (const [x, z] of spots) this.f2Circle(m, x, z, G.r, G.wind, m.def.atk * G.mult, 'geyser');
      this.areaHold(m, t + G.wind);
      return t + G.wind;
    }
    if (k === 'wave') return this.tidalWave(m);
    if (k === 'thralls') {
      const T = S.thralls;
      let alive = 0; for (const h of this.mobs.values()) if (h.temp2 && !h.dead) alive++;
      for (let i = 0; i < T.n && alive < T.max; i++, alive++) {
        const a = Math.random() * Math.PI * 2;
        const h = this.addMob('thrall', F2.arena.x + Math.sin(a) * 19, F2.arena.z + Math.cos(a) * 19);
        h.temp2 = true; h.sx = h.x; h.sz = h.z;
        const v = pick(); if (v) h.threat.set(v.id, 5);
        this.events.push({ t: 'f2fx', k: 'rise', x: r2(h.x), z: r2(h.z) });
      }
      return t;
    }
    if (k === 'pools') {
      const P = S.pools;
      for (let i = 0; i < P.n; i++) {
        if (this.pools.length >= P.max) this.pools.shift();
        const v = i === 0 && pick(), [x, z] = v ? [v.x, v.z] : rndSpot(18); // the first on one fighter
        this.pools.push({ id: this.id(), x, z, r: P.r, armAt: t + P.arm, until: t + P.life, next: t + P.arm });
        this.events.push({ t: 'tele', x: r2(x), z: r2(z), r: P.r, d: P.arm, k: 'pool' });
      }
      return t;
    }
    if (k === 'volley') {
      const V = S.volley;
      for (let i = 0; i < V.n; i++) {
        const v = fighters.length ? fighters[i % fighters.length] : target;
        this.spawnOrb(m, v, (i - (V.n - 1) / 2) * V.fan, V.mult);
      }
      return t;
    }
    return t;
  },

  f2Circle(m, x, z, r, wind, amount, src) {
    this.events.push({ t: 'tele', x: r2(x), z: r2(z), r, d: wind, k: src });
    this.schedule(wind, () => {
      if (m.dead || !m.engaged) return;
      this.events.push({ t: 'f2fx', k: src, x: r2(x), z: r2(z), r });
      if (src === 'geyser') this.twistGeyser2(x, z); // Brackish: a mire pool where it burst
      for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.z - z) <= r) { if (src === 'geyser') qlog('geyser'); this.damagePlayer(p, amount, { ground: true, src: `sovereign ${src}` }); }
    });
  },

  // The must-dodge: a ring of water that sweeps out across the whole court. Only a dodge roll's i-frames get you through it.
  tidalWave(m) {
    const W = (m.tm || this.sovS || SOVEREIGN).wave, t = this.time;
    m.windupAt = 0; const end = this.bossAfter(m, W, t + W.wind); // + its after pause (shared/bosstiming.js)
    const w = { id: this.id(), x: m.x, z: m.z, start: t + W.wind, r: 0, hit: new Set(), ev: new Set(), atk: m.def.atk * W.mult, max: F2.arena.r * 2 + 2, m };
    this.waves.push(w);
    this.events.push({ t: 'f2wave', id: w.id, by: m.id, x: r2(w.x), z: r2(w.z), d: W.wind, sp: W.speed, w: W.width, max: w.max });
    this.twistWave2(m, w); // Riptide: a second wave behind it
    return end;
  },

  // The Deluge: the Sovereign calls it (a wind-up pose and a flood line filling in from the wall to the safe ring),
  // then the outer court floods for the rest of the fight (delugeAt: when the call lands; delugeT: the next damage tick).
  callDeluge(m) {
    const D = (m.tm || this.sovS || SOVEREIGN).deluge, t = this.time;
    m.busyUntil = Math.max(m.busyUntil, t + D.wind); m.windupAt = 0;
    this.deluge = true; this.delugeAt = this.delugeT = t + D.wind;
    this.events.push({ t: 'f2fx', k: 'dcall', id: m.id, x: F2.arena.x, z: F2.arena.z, r: D.r, r2: F2.arena.r, d: D.wind });
  },

  resetSovereign(m) {
    this.endFight2('wipe', m);
    m.hp = m.maxHp = m.def.hp; m.phase = 0; m.engaged = false; m.contributors.clear(); m.busyUntil = 0;
    this.clearF2Fight();
    this.events.push({ t: 'f2fx', k: 'reset', id: m.id });
  },

  clearF2Fight() {
    for (const h of [...this.mobs.values()]) {
      if (!h.temp2) continue;
      if (!h.dead) this.events.push({ t: 'die', id: h.id, x: r2(h.x), z: r2(h.z), b: 0 });
      this.mobs.delete(h.id);
    }
    this.deluge = false; this.pools = []; this.waves = [];
    this.orbs = this.orbs.filter(o => o.src !== 'sovereign orb');
  },

  startFight2(m) {
    const ids = [...this.players.values()].filter(p => !p.dead && inArena2(p.x, p.z)).map(p => p.id);
    this.fight2 = { start: this.time, ids: new Set(ids), deaths: 0, hp: m.maxHp };
    for (const id of ids) this.track(this.players.get(id), 'boss2_start', { players: ids.length, hp: m.maxHp });
  },

  endFight2(result, m) {
    const f = this.fight2;
    if (!f) return;
    this.fight2 = null;
    const data = { result, secs: Math.round(this.time - f.start), players: f.ids.size, deaths: f.deaths, hpLeft: result === 'wipe' ? Math.round((m.hp / m.maxHp) * 100) : 0, phase: m.phase };
    let first = true;
    for (const id of f.ids) { const p = this.players.get(id); if (p) { this.track(p, 'boss2_end', first ? data : { ...data, sys: 1 }); first = false; } }
  },

  // Called from killMob (after the shared bookkeeping) when the Sovereign dies.
  killSovereign(m, killer) {
    const ids = new Set([...m.contributors, ...(this.fight2?.ids || [])]);
    const names = [];
    for (const id of ids) {
      const p = this.players.get(id);
      if (p) { names.push(p.name); this.giveXp(p, m.def.xp); this.dropLoot(p, m); }
    }
    this.twistKill2(m, ids); // Sovereign twist reward (server/sovtwists.js)
    const quiet = this.quietClear?.(ids, 'the Drowned Sovereign'); // the Named alone: one quiet line (server/named.js)
    if (this.giveItem(killer, lastAttackItem2())) this.invChanged(killer);
    if (!quiet) {
      this.events.push({ t: 'la2', id: killer.id, name: killer.name, x: r2(m.x), z: r2(m.z) });
      this.sys(`LAST ATTACK BONUS: ${killer.name} landed the final blow and earned the Sovereign's Tidecloak!`);
    }
    this.clearF2Fight();
    if (quiet) this.sys(quiet);
    else {
      this.floorClears2++;
      this.events.push({ t: 'clear2', names, n: this.floorClears2 });
      this.sys(`The Drowned Sovereign has fallen! Floor 2 cleared by ${names.join(', ')}.`);
    }
    this.recordClear2(m, killer, ids);
    this.endFight2('kill', m);
    m.engaged = false;
  },

  recordClear2(m, killer, ids) {
    const f = this.fight2, first = !this.hadFirstClear2;
    this.hadFirstClear2 = true;
    const party = [];
    for (const id of ids) {
      const p = this.players.get(id);
      if (!p) continue;
      party.push({ name: p.name, cls: p.cls, lvl: p.lvl });
      p.stats.sovereignKills = (p.stats.sovereignKills || 0) + 1; p.dirty = true;
      this.checkTitles(p);
    }
    if (first) this.ringBell(2, { auto: true }); // the Tower Bell (server/bell.js)
    this.onClear?.({ floor: 2, secs: f ? Math.round(this.time - f.start) : 0, players: party, lastAttack: killer.name, deaths: f?.deaths || 0, first });
  },

  // Called from killMob when the Horned Warden dies: unlock Floor 2 for everyone who fought, and open the Stairway.
  f2WardenKilled(m) {
    for (const id of m.contributors) {
      const p = this.players.get(id);
      if (!p) continue;
      if (!floorUnlocked(p.stats, 2)) this.sys('Floor 2 — The Glimmering Mire is open to you. Step into the Stairway (F), or use the waypoint at the town fountain.', p.id);
      p.stats.floor2 = 1; p.dirty = true; this.invChanged(p);
    }
    this.portal = { x: STAIRWAY.x, z: STAIRWAY.z, until: this.time + STAIRWAY.secs };
    this.events.push({ t: 'stair', x: STAIRWAY.x, z: STAIRWAY.z, d: STAIRWAY.secs });
  },

  // ---------- travel ----------
  campPoint(f) {
    const a = Math.random() * Math.PI * 2, d = f === 2 ? 4 + Math.random() * 3 : 5 + Math.random() * 3;
    const c = f === 2 ? F2.camp : { x: 0, z: 0 };
    return resolveCollision(c.x + Math.sin(a) * d, c.z + Math.cos(a) * d);
  },

  // Death on Floor 2 sends you back to Mirelight Camp (or to SPAWN_AT when that testing aid points at Floor 2).
  respawnPoint(p) {
    if (p.x <= F2.split) return null;
    if (process.env.SPAWN_AT) { const [x, z] = process.env.SPAWN_AT.split(',').map(Number); if (x > F2.split) return [x, z]; }
    return this.campPoint(2);
  },

  warp(p, f) {
    f = f | 0;
    if (p.dead || (f !== 1 && f !== 2)) return;
    const t = this.time, ws = nearWaypoint(p.x, p.z, 0.5); // a town's centrepiece (a little extra reach for lag)
    const atStair = f === 2 && this.portal && t < this.portal.until && Math.hypot(p.x - this.portal.x, p.z - this.portal.z) < STAIRWAY.use;
    if (!ws && !atStair) return;
    if (!floorUnlocked(p.stats, f)) return this.sys('Floor 2 is sealed. Help defeat the Horned Warden to open it.', p.id);
    if (!atStair && floorOf(p.x) === f) return this.sys(`You are already on Floor ${f}.`, p.id);
    const [x, z] = this.campPoint(f);
    this.events.push({ t: 'warp', id: p.id, x0: r2(p.x), z0: r2(p.z), x: r2(x), z: r2(z), f });
    this.gate.ready.delete(p.id); this.gate2.ready.delete(p.id);
    this.teleport(p, x, z);
    this.sys(`${p.name} travelled to ${f === 2 ? 'Floor 2 — The Glimmering Mire' : 'Floor 1 — the Town of Beginnings'}.`, p.id);
    this.track(p, 'warp', { f, via: atStair ? 'stairway' : 'waypoint' });
  },

  // ---------- Floor 2's raid gate ----------
  toggleReady2(p) {
    const g = this.gate2;
    if (p.dead || g.open || !inGateZone2(p.x, p.z)) return;
    if (g.ready.has(p.id)) g.ready.delete(p.id);
    else { g.ready.add(p.id); this.track(p, 'gate2_ready', {}); }
  },

  updateGate2() {
    const g = this.gate2, t = this.time;
    const waiting = [...this.players.values()].filter(p => !p.dead && inGateZone2(p.x, p.z));
    for (const id of g.ready) if (!waiting.some(p => p.id === id)) g.ready.delete(id);
    if (!g.open) {
      if (!g.ready.size) g.firstReadyAt = 0; else if (!g.firstReadyAt) g.firstReadyAt = t;
      const allReady = waiting.length > 0 && (g.ready.size === waiting.length || (g.firstReadyAt && t - g.firstReadyAt >= GATE2.force));
      if (allReady && !g.countAt) { g.countAt = t + GATE2.count; this.events.push({ t: 'gate2', s: 'count', d: GATE2.count }); }
      else if (!allReady && g.countAt) { g.countAt = 0; this.events.push({ t: 'gate2', s: 'cancel' }); }
      if (g.countAt && t >= g.countAt) {
        g.open = true; g.countAt = 0; g.ready.clear(); g.emptySince = 0;
        this.events.push({ t: 'gate2', s: 'open' });
        this.sys('The Sunken Gate rises. The Drowned Sovereign awaits.');
      }
      return;
    }
    const inside = [...this.players.values()].some(p => !p.dead && (inArena2(p.x, p.z) || (Math.abs(p.x - GATE2.x) < 7 && p.z > GATE2.band[0] - 1)));
    const s = this.sovereign, busy = s && !s.dead && s.threat.size > 0;
    if (inside || busy) { g.emptySince = 0; return; }
    if (!g.emptySince) g.emptySince = t;
    if (t - g.emptySince > 15) { g.open = false; g.emptySince = 0; this.events.push({ t: 'gate2', s: 'close' }); }
  },

  // ---------- per-tick Floor 2 upkeep (called from Game.update) ----------
  updateFloor2(dt) {
    const t = this.time;
    for (const p of this.players.values()) {
      // standing-still tracking (Bog Lurkers punish it)
      if (p.stillX === undefined || Math.hypot(p.x - p.stillX, p.z - p.stillZ) > LURK.moved) { p.stillX = p.x; p.stillZ = p.z; p.stillSince = t; }
      if (p.x > F2.split && !floorUnlocked(p.stats, 2)) { p.stats.floor2 = 1; p.dirty = true; this.invChanged(p); } // e.g. SPAWN_AT on Floor 2
      if (p.dead && !p.f2Dead) {
        p.f2Dead = true;
        const f = this.fight2;
        if (f && (f.ids.has(p.id) || inArena2(p.x, p.z))) f.deaths++;
      } else if (!p.dead) p.f2Dead = false;
    }
    this.updateGate2();

    // homing orbs
    for (const o of this.orbs) {
      const v = this.players.get(o.tid);
      if (v && !v.dead) o.a = wrapAngle(o.a + clamp(wrapAngle(angleTo(o.x, o.z, v.x, v.z) - o.a), -ORB.turn * dt, ORB.turn * dt));
      o.x += Math.sin(o.a) * ORB.speed * dt; o.z += Math.cos(o.a) * ORB.speed * dt; o.ttl -= dt;
      const [cx, cz] = resolveCollision(o.x, o.z, 0.1);
      if (cx !== o.x || cz !== o.z || !walkable(o.x, o.z)) o.ttl = 0; // hit a tree, crystal or wall
      for (const p of this.players.values()) {
        if (p.dead || o.ttl <= 0) continue;
        if (Math.hypot(p.x - o.x, p.z - o.z) < ORB.radius + 0.45) { this.damagePlayer(p, o.atk, { src: o.src }); o.ttl = 0; }
      }
      if (o.ttl <= 0) this.events.push({ t: 'f2fx', k: 'opop', x: r2(o.x), z: r2(o.z) });
    }
    this.orbs = this.orbs.filter(o => o.ttl > 0);

    // tidal waves: damage anyone in the band who isn't rolling (i-frames) as it sweeps past
    const W = this.sovereign?.tm?.wave || SOVEREIGN.wave; // (the fight's table: server/openings.js)
    for (const w of this.waves) {
      if (t < w.start) continue;
      const prev = w.r;
      w.r = (t - w.start) * W.speed;
      for (const p of this.players.values()) {
        if (p.dead || w.hit.has(p.id) || !inArena2(p.x, p.z)) continue;
        const d = Math.hypot(p.x - w.x, p.z - w.z);
        if (d < prev - W.width || d > w.r + W.width) continue;
        if (t < p.iframeUntil) { if (!w.ev.has(p.id)) { w.ev.add(p.id); qlog('evade'); this.damagePlayer(p, w.atk, { src: 'tidal wave' }); } continue; } // shows "Dodged!"
        w.hit.add(p.id); qlog('hit');
        this.damagePlayer(p, w.atk, { src: 'tidal wave' });
      }
    }
    this.waves = this.waves.filter(w => w.r < w.max && !w.m.dead);

    // mire pools and the Deluge: damage over time
    const s = this.sovereign, P = (s?.tm || SOVEREIGN).pools, D = (s?.tm || SOVEREIGN).deluge;
    for (const pl of this.pools) {
      if (t < pl.next) continue;
      pl.next = t + P.tick;
      for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - pl.x, p.z - pl.z) <= pl.r) this.damagePlayer(p, s.def.atk * P.mult, { src: 'mire pool' });
    }
    this.pools = this.pools.filter(pl => t < pl.until);
    if (this.deluge && t >= (this.delugeT || 0)) {
      this.delugeT = t + D.tick;
      for (const p of this.players.values()) {
        if (p.dead || !inArena2(p.x, p.z)) continue;
        if (Math.hypot(p.x - F2.arena.x, p.z - F2.arena.z) > D.r) { qlog('deluge'); this.damagePlayer(p, s.def.atk * D.mult, { src: 'the deluge' }); }
      }
    }
    if (this.portal && t >= this.portal.until) this.portal = null;
  },

  // Floor 2 state for the snapshot (w.f2).
  f2Snap() {
    const g = this.gate2, t = this.time;
    const waiting = [...this.players.values()].filter(p => !p.dead && inGateZone2(p.x, p.z)).length;
    const bur = [];
    for (const m of this.mobs.values()) if (m.hidden && !m.dead) bur.push([r1(m.x), r1(m.z), m.erupt ? 1 : 0]);
    return {
      gate: [g.open ? 1 : 0, waiting, g.ready.size, g.countAt ? r1(Math.max(0, g.countAt - t)) : 0],
      ph: this.sovereign?.phase || 0,
      orbs: this.orbs.map(o => [o.id, r1(o.x), r1(o.z)]),
      pools: this.pools.map(p => [p.id, r1(p.x), r1(p.z), p.r, t >= p.armAt ? 1 : 0]),
      bur, del: this.deluge && t >= (this.delugeAt || 0) ? 1 : 0, dcall: this.deluge && t < (this.delugeAt || 0) ? 1 : 0, // the flood; the Deluge being called
      tw: this.twist2?.id || null, // the Sovereign's twist (server/sovtwists.js)
      stair: this.portal ? [this.portal.x, this.portal.z, r1(this.portal.until - t)] : 0,
    };
  },
};
