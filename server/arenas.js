// Multi-area boss fights (docs/ROADMAP.md J2): the server side of shared/arenas.js. Generic over ARENAS (one entry per
// boss that has areas; the Storm Colossus first). The area is a STATE of the boss room (m.area), not a place: everyone
// stays on the same x,z footprint, the area only changes the room's colliders, hazards and look.
//
// The transition (per ARENAS[key].transitions, once per fight):
//   pending  the boss reached the phase. No new team-scale mechanic starts (colossusSpecials asks arenaHold); the fall
//            waits until none is active (Overload, a G4 move, a J1 trap), `gap` s have passed since the last one, and
//            the boss is free (no wind-up, not busy, not Grounded). Not during a director show (a cue forces it: 'fall').
//   crack    the warning: cracks spread, the ground rumbles. Beams and pending strikes are cleared (m.ep).
//   fall     m.area changes; everyone in the room is moved to a free spot of the new layout (out of its pillars, walls
//            and sludge), frozen (inputs, skills) through the landing; the boss is hidden and can't be hurt.
//   land     the landing pause: still frozen; a downed player's bleed-out is paused.
//   enter    the boss drops in (a shove around it on impact, no damage); then the fight resumes and the fire starts.
// A wipe (the boss resets) or its respawn puts the room back to area 0. After a kill it stays where the fight ended.
//
// In the new area: sludge (strong slow, no dodge; enforced here too), fire patches in fixed patterns (warning, burning,
// out; checked at 5 Hz), and pillars that block line of sight for beams (arenaCover). Events: { t: 'arena', k, s:
// 'crack' | 'fall' | 'land' | 'enter' | 'impact' | 'resume' | 'reset' | 'fire', id, a, d, ... }. Snapshot: w.f3.ar
// (arenaSnap: { key: [area, stage, left, fire pattern, fire state, fire left] }).
import { ARENAS, ARENA_KEYS, setArenaState, resetArenas, inRoom, freeSpot, sludgeAt, speedAt, firePatches, losBlocked, arenaRow, AREA_COLLIDERS, inCollider, resolveArea, serverOwnsArenas } from '../shared/arenas.js';
import { SPRINT_SPEED } from '../shared/data.js';

const r2 = v => Math.round(v * 100) / 100;
const FROZEN = new Set(['input', 'skill', 'dodge', 'jump', 'guard', 'use']); // what a falling / landing player can't do
const TIMERS = ['strikeT', 'gustT', 'beamT', 'harpyT', 'slamT', 'chargeT', 'spinT', 'rockT', 'sweepT', 'geyserT', 'waveT', 'volleyT']; // the boss's own moves
const TEAM_TIMERS = ['ovT', 'btT']; // team-scale mechanics: `gap` s after the fight resumes
const STATS = !!process.env.F3_STATS;
const SLOW = Math.max(1, Number(process.env.ARENA_SLOW) || 1); // testing aid (screenshot tours): the fall's stages last this many times longer
const timingOf = A => (SLOW === 1 ? A.timing : { ...A.timing, crack: A.timing.crack * SLOW, fall: A.timing.fall * SLOW, land: A.timing.land * SLOW, enter: A.timing.enter * SLOW, impact: A.timing.impact * SLOW });

const methods = {
  arenaInit() { resetArenas(); serverOwnsArenas(true); },
  arenaBoss(key) { return this[ARENAS[key].game] || null; },
  arenaKeyOf(m) { return m && ARENAS[m.type] && this.arenaBoss(m.type) === m ? m.type : null; },
  arenaRt(m) { return (m.ar ||= { stage: 0, until: 0, tr: -1, done: new Set(), mechT: -1e9, fire: null, fight: null }); },
  // 0: nothing; 1: a fall is pending (start no team-scale mechanic); 2: the fall is running (the boss does nothing else).
  arenaHold(m) {
    const R = m?.ar;
    if (!R || !R.stage) return 0;
    if (R.stage >= 2) return 2;
    return this.director?.running ? 0 : 1;
  },
  // The boss is out of reach (falling, landing, dropping in): no damage to it.
  arenaHidden(m) { const s = m?.ar?.stage || 0; return s >= 3; },

  // A team-scale mechanic is running on this boss: Overload, a G4 move, a J1 trap on someone in the room.
  arenaMechActive(key, m) {
    if (m.ov || (this.btActive || []).some(a => a.m === m)) return true;
    for (const p of this.players.values()) if (p.trap && !p.dead && inRoom(ARENAS[key], p.x, p.z)) return true;
    return false;
  },
  arenaPlayers(key, all = false) { const A = ARENAS[key]; return [...this.players.values()].filter(p => !p.dead && inRoom(A, p.x, p.z) && (all || !p.downed)); },

  // ---------- per tick ----------
  updateArenas(dt) {
    const t = this.time;
    for (const key of ARENA_KEYS) {
      const m = this.arenaBoss(key);
      if (!m) continue;
      const A = ARENAS[key], T = A.timing, R = this.arenaRt(m);
      const fight = this[A.fight] || null; // the fight's own record: a new one (or none, alive) means a wipe or a respawn
      if (!m.dead && fight !== R.fight) { if (m.area || R.stage || R.done.size || R.fire) this.arenaReset(key, m); R.fight = fight; }
      if (m.dead) { if (R.stage) { R.stage = 0; this.arenaUnfreeze(key); } R.fire = null; this.arenaPublish(key, m); continue; } // killed: the room stays as it is until the respawn
      if (!m.engaged) { this.arenaPublish(key, m); continue; }
      if (this.arenaMechActive(key, m)) R.mechT = t;
      if (!R.stage) {
        const i = A.transitions.findIndex((tr, k) => !R.done.has(k) && (m.phase || 0) >= tr.phase && tr.to !== (m.area || 0));
        if (i >= 0) { R.stage = 1; R.tr = i; }
      }
      if (R.stage === 1) {
        const free = t >= (m.busyUntil || 0) && !m.windupAt && !m.ov && t >= (m.stunUntil || 0) && t >= (m.groundedUntil || 0);
        if (!this.director?.running && free && !this.arenaMechActive(key, m) && t - R.mechT >= T.gap) this.arenaCrack(key, m);
      } else if (R.stage >= 2 && t >= R.until) this.arenaNext(key, m);
      if (R.stage === 3 || R.stage === 4) { // the landing: bleed-out waits
        for (const p of this.arenaPlayers(key, true)) if (p.downed) p.downed.until += dt;
      }
      if (!R.stage) this.arenaFire(key, m);
      this.arenaPublish(key, m);
    }
  },

  arenaPublish(key, m) {
    const R = this.arenaRt(m), F = R.fire, t = this.time;
    setArenaState(key, { area: m.area || 0, stage: R.stage, left: R.stage >= 2 ? Math.max(0, R.until - t) : 0, fi: F?.i || 0, fk: F?.k || 0, fleft: F ? Math.max(0, F.until - t) : 0 });
  },

  // Start the fall now: forced (a director cue, testing) or when the pending fall is clear to go.
  arenaCrack(key, m, to = null) {
    const A = ARENAS[key], T = timingOf(A), R = this.arenaRt(m), t = this.time;
    if (to === null) to = A.transitions[R.tr]?.to ?? 1;
    R.to = to; R.stage = 2; R.until = t + T.crack; R.fight = this[A.fight] || null;
    m.ep = (m.ep || 0) + 1; // scheduled strikes and gusts check it (server/floor3.js): they fizzle
    m.windupAt = 0; m.busyUntil = t + T.crack + T.fall + T.land + T.enter;
    if (this.beams) this.beams = this.beams.filter(b => b.m !== m); // the Tempest Beam
    const resume = m.busyUntil;
    for (const k of TIMERS) if (typeof m[k] === 'number' && m[k] < resume + 2) m[k] = resume + 2 + Math.random() * 2;
    for (const k of TEAM_TIMERS) if (typeof m[k] === 'number' && m[k] < resume + T.gap) m[k] = resume + T.gap;
    R.fire = null;
    this.events.push({ t: 'arena', k: key, s: 'crack', id: m.id, a: to, d: T.crack, x: r2(m.x), z: r2(m.z) });
    this.sys(`The ground cracks beneath ${m.def.name.replace(/^The /, 'the ')}! Brace yourselves: the floor is giving way!`);
    if (STATS) console.log(`[arena] crack ${key} -> ${A.areas[to]?.id} at ${Math.round((100 * m.hp) / m.maxHp)}%`);
    return true;
  },

  arenaNext(key, m) {
    const A = ARENAS[key], T = timingOf(A), R = this.arenaRt(m), t = this.time;
    if (R.stage === 2) { // the fall: everyone drops into the new area
      R.stage = 3; R.until = t + T.fall;
      m.area = R.to; R.done.add(R.tr);
      setArenaState(key, { area: m.area, stage: 3 });
      const frozen = t + T.fall + T.land;
      for (const p of this.arenaPlayers(key, true)) {
        const [x, z] = freeSpot(key, m.area, p.x, p.z, 0.6);
        this.teleport(p, x, z);
        p.arenaFrozen = frozen;
        if (p.roll) p.rollUntil = 0;
      }
      for (const o of this.mobs.values()) {
        if (o === m || o.dead || !inRoom(A, o.x, o.z)) continue;
        [o.x, o.z] = freeSpot(key, m.area, o.x, o.z, (o.def.radius || 1) * 0.8);
        o.stunUntil = Math.max(o.stunUntil || 0, t + T.fall + T.land + T.enter); o.windupAt = 0;
      }
      if (this.charges) this.charges = this.charges.filter(c => !inRoom(A, c.m.x, c.m.z));
      [m.x, m.z] = freeSpot(key, m.area, m.x, m.z, m.def.radius);
      this.events.push({ t: 'arena', k: key, s: 'fall', id: m.id, a: m.area, d: T.fall, land: T.land });
      const area = A.areas[m.area];
      this.sys(`You fall into ${area?.name || 'the depths'}! ${area?.blurb || ''}`.trim());
    } else if (R.stage === 3) {
      R.stage = 4; R.until = t + T.land;
      this.events.push({ t: 'arena', k: key, s: 'land', id: m.id, a: m.area, d: T.land });
    } else if (R.stage === 4) { // the boss drops in
      R.stage = 5; R.until = t + T.enter;
      this.arenaUnfreeze(key);
      this.events.push({ t: 'arena', k: key, s: 'enter', id: m.id, a: m.area, d: T.enter, x: r2(m.x), z: r2(m.z), i: T.impact });
      const ep = m.ep;
      this.schedule(T.impact, () => {
        if (m.dead || !m.engaged || m.ep !== ep) return;
        this.events.push({ t: 'arena', k: key, s: 'impact', id: m.id, x: r2(m.x), z: r2(m.z), r: T.shoveR });
        for (const p of this.arenaPlayers(key)) {
          const d = Math.hypot(p.x - m.x, p.z - m.z);
          if (d > T.shoveR || !this.shove) continue;
          const ux = d > 0.1 ? (p.x - m.x) / d : 0, uz = d > 0.1 ? (p.z - m.z) / d : 1;
          this.shove(p, ux, uz, T.shove * (1 - d / (T.shoveR + 2)), (x, z) => inRoom(A, x, z));
        }
      });
    } else { // the fight goes on in the new area
      R.stage = 0; R.until = 0;
      const F = A.areas[m.area]?.fire;
      R.fire = F ? { i: 0, k: 0, until: t + T.after, tickT: 0 } : null;
      this.events.push({ t: 'arena', k: key, s: 'resume', id: m.id, a: m.area });
      if (STATS) console.log(`[arena] resume ${key} in ${A.areas[m.area]?.id}`);
    }
  },

  arenaUnfreeze(key) { for (const p of this.players.values()) if (p.arenaFrozen) p.arenaFrozen = 0; },

  arenaReset(key, m) {
    const R = this.arenaRt(m), was = m.area || R.stage;
    m.area = 0; R.stage = 0; R.until = 0; R.tr = -1; R.done.clear(); R.fire = null; R.mechT = -1e9;
    this.arenaUnfreeze(key);
    setArenaState(key, { area: 0, stage: 0, left: 0, fi: 0, fk: 0, fleft: 0 });
    if (was) this.events.push({ t: 'arena', k: key, s: 'reset', id: m.id, a: 0 });
  },

  // Fire patterns: warning (patches glow), burning (damage at `tick` s to anyone standing in one), out, next pattern.
  arenaFire(key, m) {
    const R = this.arenaRt(m), F = R.fire, t = this.time;
    const def = ARENAS[key].areas[m.area || 0]?.fire;
    if (!F || !def) return;
    if (t >= F.until) {
      if (F.k === 0) { F.k = 1; F.until = t + def.warn; }
      else if (F.k === 1) { F.k = 2; F.until = t + def.live; F.tickT = t; }
      else { F.k = 0; F.until = t + def.rest; F.i = (F.i + 1) % def.spots.length; }
      this.events.push({ t: 'arena', k: key, s: 'fire', id: m.id, i: F.i, f: F.k, d: r2(F.until - t) });
      setArenaState(key, { fi: F.i, fk: F.k });
    }
    if (F.k !== 2 || t < F.tickT) return;
    F.tickT = t + def.tick;
    const spots = def.spots[F.i];
    for (const p of this.arenaPlayers(key)) {
      if (!spots.some(s => Math.hypot(p.x - s.x, p.z - s.z) < s.r)) continue;
      this.damagePlayer(p, p.maxHp * def.dmg, { ground: true, src: 'fire', mob: m });
      if (STATS) console.log('[arena] fire hit');
    }
  },

  // Line of sight from (x0, z0) to a player blocked by the area's pillars or walls (the Tempest Beam passes them by).
  arenaCover(x0, z0, p) { return AREA_COLLIDERS.length > 0 && losBlocked(x0, z0, p.x, p.z); },

  arenaSnap() { const out = {}; for (const k of ARENA_KEYS) out[k] = arenaRow(k); return out; },

  // Testing / the director: start a boss's fall now (to area `to`, default its next transition). True if it started.
  arenaForce(m, to = null) {
    const key = this.arenaKeyOf(m);
    if (!key || m.dead || !m.engaged) return false;
    const R = this.arenaRt(m), A = ARENAS[key];
    if (R.stage >= 2) return false;
    if (to === null) {
      const i = A.transitions.findIndex((tr, k) => !R.done.has(k) && tr.to !== (m.area || 0));
      if (i < 0) return false;
      R.tr = i;
    } else R.tr = A.transitions.findIndex(tr => tr.to === to);
    return this.arenaCrack(key, m, to ?? A.transitions[R.tr].to);
  },
};

export function installArenas(Game) {
  Object.assign(Game.prototype, methods);
  const P = Game.prototype;
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('update', function (orig, dt, ...a) {
    const r = orig.call(this, dt, ...a);
    this.updateArenas(dt);
    return r;
  });

  // Falling / landing: no moving, skills, rolls or potions (the client freezes too).
  wrap('handle', function (orig, p, msg) {
    if (p && p.arenaFrozen > this.time && FROZEN.has(msg?.type)) return;
    return orig.call(this, p, msg);
  });

  // Sludge: a strong slow (the move is clamped), and the active area's walls and pillars hold even a stale client.
  wrap('onInput', function (orig, p, msg) {
    if (!p.dead && msg && msg.seq === p.posSeq && AREA_COLLIDERS.length) {
      const slow = speedAt(p.x, p.z);
      if (slow < 1) {
        const x = +msg.x, z = +msg.z, dt = Math.min(0.5, this.time - p.lastMoveT);
        const maxD = SPRINT_SPEED * slow * dt * 1.3 + 0.2, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
        if (isFinite(d) && d > maxD) msg = { ...msg, x: p.x + (dx / d) * maxD, z: p.z + (dz / d) * maxD };
      }
    }
    const r = orig.call(this, p, msg);
    if (AREA_COLLIDERS.length && !p.dead && inCollider(p.x, p.z, -0.25)) { const [x, z] = resolveArea(p.x, p.z, 0.45); this.teleport(p, x, z); }
    return r;
  });

  // No rolling in sludge.
  wrap('dodge', function (orig, p, ...a) {
    if (p && !p.dead && sludgeAt(p.x, p.z)) return;
    return orig.call(this, p, ...a);
  });

  // forceBossMove 'fall' (the director's boss_move, testing): start the boss's fall now.
  wrap('forceBossMove', function (orig, mob, move, targetId) {
    if (move === 'fall') { const m = this.mobRef?.(mob) ?? mob; return !!(m && this.arenaForce(m)); }
    return orig ? orig.call(this, mob, move, targetId) : false;
  });

  // Testing aids (TEST_HOOKS=1): { type: 'test', fall: 1 } starts the Colossus's fall; { protect: f } keeps you above
  // that fraction of your health (screenshot tours).
  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'test' && process.env.TEST_HOOKS && p && msg.protect !== undefined) { this.protect?.(p, +msg.protect || 0); return; }
    if (msg?.type === 'test' && process.env.TEST_HOOKS && p && msg.fall) {
      const m = this.colossus;
      if (m && !m.engaged && !m.dead) this.engageColossus?.(m);
      if (m) this.arenaForce(m);
      return;
    }
    return orig.call(this, p, msg);
  });
}
