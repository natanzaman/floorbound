// Rescue mechanics (docs/ROADMAP.md J1): one boss trap per boss, freed by the rest of the party. Tuning in
// shared/rescue.js. Mixed into Game by installRescue (after the Named, before pacing: its damageMob / damagePlayer
// wrappers sit outside every feature's, so a trap object's hits never reach threat, mastery, talents, team stats,
// loot or the Named, and an encased player is safe from everything but the crystal itself).
//
//  - Traps are boss team moves (server/bossteam.js btStart -> trapStart): 'vines' (the Warden's Thornbind), 'pillar'
//    (the Sovereign's Drowning Pillar), 'crystal' (the Colossus's storm crystal). bossTeam starts one in turn with the
//    G4 moves; forceBossMove takes the same names. A telegraph ('trap' event) runs `wind` s, then the trap lands.
//  - The trapped player carries p.trap = { k, boss, at, until, prop, x, z, by, prog, blockT, next, a }: rooted (onInput
//    keeps them in place, no rolls; jumping in place is fine), and for the crystal also unable to act and safe from all damage but the
//    detonation. Target picks skip trapped players (game.js / floor2 / floor3 / staging / talents / threat: J4's
//    targetOf in server/threat.js replaces them).
//  - The trap object is a `prop` mob (shared/rescue.js RESCUE_MOBS) with its own HP bar: no threat (its threat map
//    ignores writes, so no taunt sticks), no contributors, XP, loot, posture, mastery or kill credit. Breaking it frees
//    the player. Vines also free with a partymate's 1.5 s hold-E channel ({ type: 'free', on, id }); a revive in reach
//    wins over it. A Guardian blocks the Drowning Pillar by Covering its victim or guarding on the orb→victim line.
//  - Ends: 'freed' (teamStat(freer, 'rescue')), 'timeout' (vines wither, the pillar drains away), 'boom' (the crystal
//    detonates on the room), 'down' / 'dead' (the victim fell), 'alone' (no free ally left: released harmlessly),
//    'off' (the fight ended).
// Events: { t: 'trap', k, id, d, boss } telegraph · { t: 'trapon', k, id, prop, x, z, sx, sz, d, boss } landed ·
//         { t: 'free', id, by } / { t: 'free', id, by, end: 1 } hold-E channel · { t: 'trapend', k, id, why, by, x, z }.
// Snapshot: w.trap = rows (shared/rescue.js readTraps), left out when nobody is trapped.
import { WORLD, walkable } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { F3 } from '../shared/floor3.js';
import { DOWNED } from '../shared/revive.js';
import { RESCUE, TRAP_MOVES, PROP_OF, HELP_EXP } from '../shared/rescue.js';

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SRC = { vines: 'thornbind', pillar: 'drowning pillar', crystal: 'storm crystal' };

// A trap object's threat map and contributor set ignore writes: taunts, aggro, heal threat and kill credit never land.
class NoThreat extends Map { set() { return this; } }
class NoCredit extends Set { add() { return this; } }

const methods = {
  trapFree(p) { return !!p && !p.dead && !p.downed && !p.trap; },
  // Everyone alive in the boss's room (trapped and downed included).
  trapRoom(m) { const ring = this.btRoom(m); return [...this.players.values()].filter(p => !p.dead && ring(p.x, p.z)); },
  roomCentre(m) { const A = m.type === 'colossus' ? F3.arena : m.type === 'sovereign' ? F2.arena : WORLD.arena; return A; },
  // The player the boss is after: J4's targetOf when it exists, else the top threat among free players.
  bossTargetId(m) {
    if (this.targetOf) return this.targetOf(m)?.id ?? 0;
    let id = 0, top = -1;
    for (const [pid, v] of m.threat) { const p = this.players.get(pid); if (this.trapFree(p) && v > top) { top = v; id = pid; } }
    return id;
  },
  trapActive(m) { return (this.btActive || []).some(a => a.m === m && TRAP_MOVES.includes(a.k)); },

  // ---------- start (bossteam btStart, forceBossMove) ----------
  // forced: a forceBossMove (may aim at the boss's own target). Returns whether the telegraph started.
  trapStart(m, k, targetId = null, forced = false) {
    const T = RESCUE[k];
    if (!T || !TRAP_MOVES.includes(k) || m.dead) return false;
    if (this.trapActive(m)) return false;
    const free = this.trapRoom(m).filter(p => this.trapFree(p));
    if (free.length < RESCUE.minFree) return false;
    const tgt = this.bossTargetId(m);
    let v = targetId != null ? free.find(p => p.id === (targetId | 0)) : null;
    if (v && v.id === tgt && !forced) v = null;
    if (!v) { const pool = free.filter(p => p.id !== tgt); v = pool[Math.floor(Math.random() * pool.length)]; }
    if (!v) return false;
    const key = this.btFight(m);
    const a = this.btAdd({ k, m, id: v.id });
    this.events.push({ t: 'trap', k, id: v.id, d: T.wind, boss: m.id });
    this.schedule(T.wind, () => this.trapLand(a, key));
    return true;
  },

  trapLand(a, key) {
    const m = a.m, k = a.k, T = RESCUE[k], p = this.players.get(a.id), t = this.time;
    const allies = p ? this.trapRoom(m).filter(o => o !== p && this.trapFree(o)) : [];
    if (!this.btLive(m, key) || !this.trapFree(p) || !this.btRoom(m)(p.x, p.z) || !allies.length) {
      this.btDone(a);
      this.events.push({ t: 'trapend', k, id: a.id, why: 'off', by: 0 });
      return;
    }
    this.stopFree(p); this.stopRevive?.(p);
    if (p.guarding && k === 'crystal') this.guard(p, false);
    this.clearPose?.(p);
    // the trap object: on the victim (vines, crystal) or out in the room (the pillar's orb)
    let [sx, sz] = [p.x, p.z];
    if (k === 'pillar') [sx, sz] = this.pillarSpot(m, p);
    const prop = this.addMob(PROP_OF[k], sx, sz);
    const tgt = this.bossTargetId(m), helpers = Math.max(1, allies.filter(o => o.id !== tgt).length);
    const hp = Math.max(30, Math.round(T.hits * Math.pow(helpers, HELP_EXP) * allies.reduce((s, o) => s + (o.atk || 10), 0) / allies.length));
    Object.assign(prop, { x: sx, z: sz, sx, sz, hp, maxHp: hp, threat: new NoThreat(), contributors: new NoCredit(), trapOf: p.id, face: 0 });
    const secs = k === 'crystal' ? T.fuse : T.max;
    p.trap = { k, boss: m.id, key, at: t, until: t + secs, prop: prop.id, x: p.x, z: p.z, by: 0, prog: 0, blockT: 0, blocked: false, next: t + (T.tick || 0), a };
    this.teleport(p, p.x, p.z); // stale inputs from before the root are dropped
    this.btChannel(m, RESCUE.channel); // the boss's big telegraphed attacks wait a moment: time to react
    this.events.push({ t: 'trapon', k, id: p.id, prop: prop.id, x: r2(p.x), z: r2(p.z), sx: r2(sx), sz: r2(sz), d: secs, boss: m.id });
    const name = p.name;
    this.sys(k === 'vines' ? `${name} is caught in Thornbind! Cut the vines or hold E next to them.`
      : k === 'pillar' ? `${name} is pinned in a Drowning Pillar! Break the orb that feeds it, or a Guardian can block it.`
      : `${name} is sealed in a storm crystal! Break it within ${T.fuse} s or it explodes on everyone.`);
  },

  // The pillar's orb: src m from the victim, inside the room, on open ground (away from the boss when it can).
  pillarSpot(m, p) {
    const A = this.roomCentre(m), [lo, hi] = RESCUE.pillar.src;
    const away = Math.atan2(p.x - m.x, p.z - m.z);
    for (let i = 0; i < 40; i++) {
      const a = away + (Math.random() - 0.5) * (i < 20 ? 2.4 : 6.28), d = lo + Math.random() * (hi - lo);
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (Math.hypot(x - A.x, z - A.z) < A.r - 3.5 && walkable(x, z)) return [x, z];
    }
    const a = Math.atan2(A.x - p.x, A.z - p.z); // fall back: toward the room's middle
    return [p.x + Math.sin(a) * lo, p.z + Math.cos(a) * lo];
  },

  // ---------- end ----------
  trapEnd(p, why, by = null) {
    const tr = p?.trap;
    if (!tr) return;
    p.trap = null;
    const prop = this.mobs.get(tr.prop);
    if (prop) { this.mobs.delete(prop.id); if (why !== 'freed') this.events.push({ t: 'die', id: prop.id, x: r2(prop.x), z: r2(prop.z), b: 0, prop: 1 }); }
    if (tr.by) this.stopFree(this.players.get(tr.by));
    this.btDone(tr.a);
    this.events.push({ t: 'trapend', k: tr.k, id: p.id, why, by: by?.id || 0, x: r2(p.x), z: r2(p.z) });
    if (why === 'freed' && by) {
      this.teamStat?.(by, 'rescue');
      by.rescues = (by.rescues || 0) + 1;
      if (by !== p) this.sys(`${by.name} freed ${p.name}!`);
    }
  },

  // ---------- trap objects ----------
  propTick(m) { // a trap object stays where it was put; one whose trap is gone vanishes
    m.moving = false; m.x = m.sx; m.z = m.sz;
    const v = this.players.get(m.trapOf);
    if (!v?.trap || v.trap.prop !== m.id) this.mobs.delete(m.id);
    return false;
  },
  // A hit on a trap object: damage only (no crit, threat, posture, mastery, Switch, talents or team stats).
  hitProp(m, p, base, { heavy = false } = {}) {
    if (!this.targetable(m) || !p) return;
    const own = p.id === m.trapOf;
    const amount = Math.max(1, Math.round((Number(base) || 0) * (0.9 + Math.random() * 0.2) * (own ? RESCUE.ownHit : 1)));
    m.hp -= amount;
    p.lastCombat = this.time;
    this.events.push({ t: 'hit', id: m.id, a: amount, c: 0, by: p.id, sw: 0, h: heavy ? 1 : 0, prop: 1 });
    if (m.hp > 0) return;
    m.dead = true; m.hp = 0;
    this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: 0, prop: 1 });
    this.mobs.delete(m.id);
    const v = this.players.get(m.trapOf);
    if (v?.trap?.prop === m.id) this.trapEnd(v, 'freed', p);
  },

  // ---------- hold E (vines) ----------
  // r starts freeing: id = the trapped player (0: the nearest one in reach). A revive in reach wins (starts instead).
  startFree(r, id = 0) {
    if (!this.trapFree(r)) return false;
    if (r.reviving) return false;
    if (this.startRevive && [...this.players.values()].some(o => o.downed && !o.dead && !o.downed.by && o.party && o.party === r.party && o !== r && dist(o, r) <= DOWNED.reach)) {
      this.startRevive(r, 0); // revive wins over freeing
      return false;
    }
    let p = id ? this.players.get(id | 0) : null;
    if (!p) { let bd = RESCUE.vines.reach; for (const o of this.players.values()) if (o.trap?.k === 'vines' && o !== r && dist(o, r) <= bd) { bd = dist(o, r); p = o; } }
    const tr = p?.trap;
    if (!tr || tr.k !== 'vines' || p === r || dist(p, r) > RESCUE.vines.reach) return false;
    if (r.freeing?.id === p.id) return true;
    if (tr.by && tr.by !== r.id) return false; // someone else is on it
    this.stopFree(r);
    if (r.guarding) this.guard(r, false);
    r.freeing = { id: p.id, at: this.time };
    tr.by = r.id;
    this.events.push({ t: 'free', id: p.id, by: r.id, d: RESCUE.vines.hold });
    return true;
  },
  stopFree(r) {
    const F = r?.freeing;
    if (!F) return;
    r.freeing = null;
    const p = this.players.get(F.id);
    if (p?.trap && p.trap.by === r.id) { p.trap.by = 0; this.events.push({ t: 'free', id: p.id, by: r.id, end: 1 }); }
  },

  // ---------- every tick ----------
  updateRescue(dt) {
    const t = this.time;
    for (const r of this.players.values()) if (r.freeing && (!this.trapFree(r) || this.players.get(r.freeing.id)?.trap?.by !== r.id)) this.stopFree(r);
    for (const p of [...this.players.values()]) {
      const tr = p.trap;
      if (!tr) continue;
      const m = this.mobs.get(tr.boss), T = RESCUE[tr.k];
      if (p.dead) { this.trapEnd(p, 'dead'); continue; }
      if (p.downed) { this.trapEnd(p, 'down'); continue; }
      if (!m || !this.btLive(m, tr.key) || !this.mobs.has(tr.prop)) { this.trapEnd(p, 'off'); continue; }
      const room = this.trapRoom(m), allies = room.filter(o => o !== p && this.trapFree(o));
      if (!allies.length) { this.trapEnd(p, 'alone'); continue; } // nobody left to rescue them: let go
      if (dist(p, tr) > 0.6) this.teleport(p, tr.x, tr.z); // rooted (a dash or a shove doesn't carry them off)
      // hold-E channel (vines)
      if (tr.by) {
        const r = this.players.get(tr.by);
        if (!(this.trapFree(r) && r.freeing?.id === p.id && dist(r, p) <= T.leash)) { if (r) this.stopFree(r); else tr.by = 0; }
      }
      if (tr.by) { tr.prog += dt; if (tr.prog >= T.hold) { this.trapEnd(p, 'freed', this.players.get(tr.by)); continue; } }
      else if (tr.prog > 0) tr.prog = Math.max(0, tr.prog - dt);
      // the Drowning Pillar: a Guardian's Cover on the victim ends it; guarding on the orb→victim line blocks it
      if (tr.k === 'pillar') {
        const cov = p.cover && t < p.cover.until ? this.players.get(p.cover.by) : null;
        if (cov?.cls === 'guardian' && this.trapFree(cov)) { this.trapEnd(p, 'freed', cov); continue; }
        const orb = this.mobs.get(tr.prop), g = orb && this.pillarBlocker(orb, p, allies);
        tr.blocked = !!g;
        if (g) { tr.blockT += dt; if (tr.blockT >= T.block) { this.trapEnd(p, 'freed', g); continue; } }
      }
      if (t >= tr.until) {
        if (tr.k === 'crystal') { this.crystalBoom(p, m, room); continue; }
        this.trapEnd(p, 'timeout'); continue; // the vines wither / the pillar drains away
      }
      if (T.tick && t >= tr.next) {
        tr.next = t + T.tick;
        if (!tr.blocked) this.btHit(p, T.dot, SRC[tr.k]);
      }
    }
  },

  // A guarding Guardian standing on the line between the orb and the victim (not on either end).
  pillarBlocker(orb, p, allies) {
    const lx = p.x - orb.x, lz = p.z - orb.z, len2 = lx * lx + lz * lz || 1;
    for (const g of allies) {
      if (g.cls !== 'guardian' || !g.guarding) continue;
      const k = ((g.x - orb.x) * lx + (g.z - orb.z) * lz) / len2;
      if (k < 0.05 || k > 1.05) continue;
      if (Math.hypot(g.x - (orb.x + lx * k), g.z - (orb.z + lz * k)) <= RESCUE.pillar.lane) return g;
    }
    return null;
  },

  crystalBoom(p, m, room) {
    const C = RESCUE.crystal;
    this.events.push({ t: 'fx', k: 'boom', x: r2(p.x), z: r2(p.z), r: 8 });
    this.trapEnd(p, 'boom');
    for (const o of room) if (!o.dead && !o.downed) this.btHit(o, C.boom, SRC.crystal);
  },

  trapSnap() {
    let out;
    for (const p of this.players.values()) {
      const tr = p.trap;
      if (tr) (out ||= []).push([p.id, TRAP_MOVES.indexOf(tr.k), r1(Math.max(0, tr.until - this.time)), tr.k === 'vines' ? r2(Math.min(1, tr.prog / RESCUE.vines.hold)) : tr.k === 'pillar' ? r2(Math.min(1, tr.blockT / RESCUE.pillar.block)) : 0, tr.by || 0, tr.prop, tr.blocked ? 1 : 0]);
    }
    return out;
  },
};

export function installRescue(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; if (!orig) return; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // Hits on a trap object never reach the rest of damageMob (threat, posture, mastery, talents, team stats, the Named).
  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    if (m?.def?.prop) return this.hitProp(m, p, base, opts);
    return orig.call(this, m, p, base, opts);
  });

  // Encased in a storm crystal: nothing hurts you but the crystal. A freer loses the channel to a heavy hit.
  wrap('damagePlayer', function (orig, p, base, opts = {}) {
    if (p?.trap?.k === 'crystal' && opts.src !== SRC.crystal) return;
    const hp0 = p.hp, out = orig.call(this, p, base, opts);
    if (p.freeing && (p.dead || p.downed || hp0 - p.hp >= DOWNED.heavy * p.maxHp || (p.hp < hp0 && this.bigHit?.(opts.src)))) this.stopFree(p);
    return out;
  });

  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'free') { if (msg.on) this.startFree(p, msg.id | 0); else this.stopFree(p); return; }
    // Testing aid (TEST_HOOKS=1 only): { type: 'test', trap: 'vines' | 'pillar' | 'crystal', id, hold } engages the boss
    // of your room and forces that trap on player id (default: you); hold: the boss stands still and the trap lasts 60 s
    // longer (screenshots).
    if (msg?.type === 'test' && process.env.TEST_HOOKS && TRAP_MOVES.includes(msg.trap) && p) {
      const m = [this.boss, this.sovereign, this.colossus].find(b => b && !b.dead && this.btRoom(b)(p.x, p.z));
      if (!m) return;
      if (!m.engaged) {
        if (m.type === 'colossus') this.engageColossus(m);
        else { m.engaged = true; if (m.type === 'warden') { this.scaleWarden(m); this.startFight(m); } else { this.scaleSovereign(m); this.startFight2(m); } }
      }
      for (const o of this.trapRoom(m)) if (!m.threat.has(o.id)) m.threat.set(o.id, 1);
      if (msg.hold) m.stunUntil = this.time + 600;
      if (this.forceBossMove(m, msg.trap, msg.id ? msg.id | 0 : p.id) && msg.hold) {
        const id = msg.id ? msg.id | 0 : p.id;
        this.schedule(RESCUE[msg.trap].wind + 0.05, () => { const v = this.players.get(id); if (v?.trap) v.trap.until += 60; });
      }
      return;
    }
    if (msg?.type === 'cover' && p?.trap?.k === 'crystal') return;
    return orig.call(this, p, msg);
  });

  // Rooted: the position stays put (facing still turns).
  wrap('onInput', function (orig, p, msg) {
    if (p?.trap && msg && typeof msg === 'object') msg = { ...msg, x: p.trap.x, z: p.trap.z };
    return orig.call(this, p, msg);
  });
  // Trapped: no rolls (a jump in place is fine); encased: no jumps, skills, guard or items either. Freeing: any of these breaks the channel.
  const blocked = { dodge: () => true, jump: k => k === 'crystal', useItem: k => k === 'crystal', warp: () => false }; // (a jump in place still clears a Quake Ring)
  for (const name of Object.keys(blocked)) {
    wrap(name, function (orig, p, ...a) {
      if (p?.trap && blocked[name](p.trap.k)) return;
      this.stopFree(p);
      return orig.call(this, p, ...a);
    });
  }
  wrap('useSkill', function (orig, p, ...a) {
    if (p?.trap?.k === 'crystal') return;
    this.stopFree(p);
    return orig.call(this, p, ...a);
  });
  wrap('guard', function (orig, p, on, ...a) {
    if (on && p?.trap?.k === 'crystal') return;
    if (on) this.stopFree(p);
    return orig.call(this, p, on, ...a);
  });
  // A revive started by someone who was freeing: the revive wins.
  wrap('startRevive', function (orig, r, ...a) {
    const ok = orig.call(this, r, ...a);
    if (ok && r?.freeing) this.stopFree(r);
    return ok;
  });

  // Boss team mechanics (G4) pick free players only (a trapped player can't stack, spread or run a tether).
  wrap('btFighters', function (orig, ...a) { return orig.apply(this, a).filter(p => !p.trap); });

  // Overload (the Colossus, server/floor3.js) is a team-scale mechanic too: it waits for a trap or G4 move and the gap.
  wrap('startOverload', function (orig, m, ...a) {
    if (!this.btForcing && this.btBusy?.(m)) { m.ovT = this.time + 1; return; }
    return orig.call(this, m, ...a);
  });
  wrap('updateOverload', function (orig, m, ...a) {
    const was = !!m?.ov, out = orig.call(this, m, ...a);
    if (was && !m.ov) m.btGapUntil = Math.max(m.btGapUntil || 0, this.time + RESCUE.gap);
    return out;
  });
  wrap('forceBossMove', function (orig, ...a) {
    const prev = this.btForcing;
    this.btForcing = true;
    try { return orig.apply(this, a); } finally { this.btForcing = prev; }
  });

  wrap('update', function (orig, dt, ...a) {
    const r = orig.call(this, dt, ...a);
    this.updateRescue(dt);
    return r;
  });

  // Film safety: a scripted death or revive clears any trap on that player.
  for (const name of ['scriptDeath', 'scriptRevive']) wrap(name, function (orig, pp, ...a) {
    const p = this.playerRef?.(pp);
    if (p?.trap) this.trapEnd(p, 'off');
    return orig.call(this, pp, ...a);
  });
}
