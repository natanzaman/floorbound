// Staging hooks for the scene director (docs/ROADMAP.md F3): scripted boss moves, a reserved Last Attack, scripted deaths
// and revives, damage floors, twist overrides, labelled spawns and keepsake items. Mixed into Game (installStaging at the
// end of game.js). Small hooks elsewhere: game.js calls lastAttackHeld (damageMob, killMob) and protectHit (damagePlayer),
// and killMob keeps a staged mob down (no respawn) until clearStaging; newTwist (server/twists.js) reads this.twistOverride.
import { WORLD, WARDEN, SWEEP, MOBS, BITE, PACE, inArena, angleTo } from '../shared/data.js';
import { SOVEREIGN, floorOf, inArena2 } from '../shared/floor2.js';
import { SLOTS, keepsakeItem } from '../shared/items.js';
import { TWISTS } from '../shared/twists.js';

const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const WARDEN_MOVES = ['horn_sweep', 'slam', 'charge', 'quake', 'rockfall'];
export const SOVEREIGN_MOVES = ['tidal_wave', 'geyser', 'trident', 'deluge'];

const methods = {
  stage() { return (this.staged ||= { mobs: new Map(), dead: new Set(), protect: new Set(), reserved: new Set() }); },
  mobRef(m) { return typeof m === 'object' && m ? m : this.mobs.get(m | 0) || null; },
  playerRef(p) { return typeof p === 'object' && p ? p : this.players.get(p | 0) || null; },

  // ---------- forceBossMove(mob, move, targetId) -> bool ----------
  // Starts that attack's normal wind-up and telegraph now (same damage and rules), whatever its timers say.
  forceBossMove(mob, move, targetId) {
    const m = this.mobRef(mob);
    if (!m || m.dead) return false;
    const t = this.time;
    const ring = m.type === 'sovereign' ? p => inArena2(p.x, p.z) : p => inArena(p.x, p.z);
    let v = targetId != null ? this.players.get(targetId | 0) : null;
    if (v?.dead) v = null;
    if (!v) { // no (living) target given: the top threat, else the nearest fighter
      v = this.targetOf(m);
      if (!v) v = [...this.players.values()].filter(p => !p.dead && ring(p)).sort((a, b) => dist(a, m) - dist(b, m))[0] || null;
    }
    if (m.type === 'warden') {
      const W = this.twistW || WARDEN;
      if (v) m.face = angleTo(m.x, m.z, v.x, v.z);
      switch (move) {
        case 'horn_sweep':
          m.sweepFight = this.fight; m.sweepT = t + SWEEP.every[m.phase] * 0.85; // no natural sweep right after
          this.hornSweep(m);
          return true;
        case 'slam': {
          if (!v) return false;
          m.slamT = t + W.slam.every[m.phase];
          this.circleAttack(m, v.x, v.z, W.slam.r, W.slam.wind, m.def.atk * W.slam.mult, 'warden slam', true);
          return true;
        }
        case 'charge':
          if (!v) return false;
          m.windupAt = 0; m.chargeT = t + W.charge.every;
          this.hornCharge(m, v);
          return true;
        case 'quake':
          m.quakeT = t + W.quake.every[m.phase];
          this.quakeRing(m);
          return true;
        case 'rockfall': { // a circle under the target (first), every other fighter, and the usual strays
          m.rockT = t + W.rock.every;
          const spots = v ? [[v.x, v.z]] : [];
          for (const p of this.players.values()) if (p !== v && !p.dead && inArena(p.x, p.z)) spots.push([p.x, p.z]);
          for (let i = 0; i < W.rock.extra; i++) {
            const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 16;
            spots.push([WORLD.arena.x + Math.sin(a) * d, WORLD.arena.z + Math.cos(a) * d]);
          }
          for (const [x, z] of spots) this.circleAttack(m, x, z, W.rock.r, W.rock.wind, m.def.atk * W.rock.mult, 'rockfall', false, 'rock');
          return true;
        }
      }
      return false;
    }
    if (m.type === 'sovereign') {
      const S = SOVEREIGN;
      if (v) m.face = angleTo(m.x, m.z, v.x, v.z);
      switch (move) {
        case 'tidal_wave':
          m.waveT = t + S.wave.every[m.phase];
          this.tidalWave(m);
          return true;
        case 'geyser': {
          if (!v) return false;
          const G = S.geyser;
          m.geyserT = t + G.every[m.phase];
          this.f2Circle(m, v.x, v.z, G.r, G.wind, m.def.atk * G.mult, 'geyser');
          return true;
        }
        case 'trident': { // its sweep: the red wedge wind-up, resolved by its own AI (f2Sovereign)
          const [r, h] = BITE.sovereign;
          m.windupAt = t + S.sweep.wind; m.atkT = t + m.def.atkCd + S.sweep.wind - S.sweep.wind / PACE; m.busyUntil = Math.min(m.busyUntil || 0, t);
          this.events.push({ t: 'wind', id: m.id, d: S.sweep.wind, f: r2(m.face), r, h });
          return true;
        }
        case 'deluge':
          if (!this.deluge) {
            this.callDeluge(m); // its wind-up and flood line, then the flood
            this.events.push({ t: 'f2phase', id: m.id, n: 2 }); // the client's Deluge banner and roar
            this.sys('The Deluge! The outer court floods. Stay near the centre.');
          }
          return true;
      }
    }
    return false;
  },

  // ---------- reserveLastAttack(mob, playerId | null) ----------
  // Until cleared (null, or the mob dies), no one else's damage takes the mob below 1 HP.
  reserveLastAttack(mob, playerId) {
    const m = this.mobRef(mob);
    if (!m) return false;
    const id = playerId == null ? null : typeof playerId === 'object' ? playerId.id : playerId | 0;
    m.laFor = id || null;
    if (m.laFor) this.stage().reserved.add(m); else this.stage().reserved.delete(m);
    return true;
  },

  // game.js: true when this hit (by p) must leave the mob at 1 HP. A kill by the reserved player clears the reservation.
  lastAttackHeld(m, p) {
    if (!m.laFor) return false;
    if (p?.id === m.laFor) { m.laFor = null; this.staged?.reserved.delete(m); return false; }
    return true;
  },

  // ---------- scriptDeath(p, { respawn: false }) / scriptRevive(p) ----------
  // Dies the normal way (death animation, `pdie`) and stays down where they fell until scriptRevive or clearStaging.
  scriptDeath(pp, { respawn = false, src = '?' } = {}) {
    const p = this.playerRef(pp);
    if (!p || p.dead) return false;
    for (const b of [this.boss, this.sovereign]) { // fought this boss: still counts for the Hall of Clearers
      if (b && !b.dead && (b.threat.has(p.id) || this.fight?.ids.has(p.id) || this.fight2?.ids.has(p.id))) b.contributors.add(p.id);
    }
    p.hp = 0; p.dead = true;
    p.respawnAt = respawn ? this.time + 4 : Infinity;
    p.deaths++;
    if (this.fight?.ids.has(p.id)) this.fight.deaths++;
    if (p.guarding) this.guard(p, false);
    if (!respawn) this.stage().dead.add(p.id);
    this.events.push({ t: 'pdie', id: p.id, src, f: floorOf(p.x), ...(respawn ? {} : { stay: 1 }) });
    this.sys(`${p.name} was defeated.`);
    return true;
  },

  scriptRevive(pp) {
    const p = this.playerRef(pp);
    this.staged?.dead.delete(p?.id);
    if (!p || !p.dead) return false;
    p.dead = false; p.hp = p.maxHp; p.respawnAt = 0; p.lastHurt = this.time;
    this.teleport(p, p.x, p.z); // where they fell (re-syncs the client's position)
    return true;
  },

  // ---------- protect(p, minFrac | 0) ----------
  protect(pp, minFrac) {
    const p = this.playerRef(pp);
    if (!p) return false;
    const f = Math.max(0, Math.min(1, Number(minFrac) || 0));
    p.protectFrac = f;
    if (f) this.stage().protect.add(p.id); else this.staged?.protect.delete(p.id);
    return true;
  },

  // game.js damagePlayer: trim a hit so it can't take p below their protected floor (a hit at the floor does nothing).
  protectHit(p, amount) {
    if (!p.protectFrac) return amount;
    const floor = Math.max(1, Math.ceil(p.maxHp * p.protectFrac));
    return Math.min(amount, Math.max(0, p.hp - floor));
  },

  // ---------- setTwistOverride('off' | twistId | null) ----------
  // 'off': the current Warden has no twist and its next spawns roll none; an id forces that twist now and on respawns;
  // null: back to random (from the next spawn).
  setTwistOverride(v) {
    if (v !== null && v !== 'off' && !TWISTS[v]) return false;
    this.twistOverride = v;
    if (v === 'off' && this.twist) this.newTwist();
    if (v === 'off' && this.twist2) this.setTwist2(null); // the Sovereign's twist too (server/sovtwists.js; it rolls none while 'off')
    else if (v && v !== 'off' && this.twist?.id !== v) this.newTwist();
    return true;
  },

  // ---------- spawnMob(type, x, z, { label }) -> mob ----------
  // Any MOBS type, labelled and tracked; it doesn't respawn once killed, and clearStaging removes it.
  spawnMob(type, x, z, { label } = {}) {
    if (!MOBS[type]) return null;
    const m = this.addMob(type, +x || 0, +z || 0);
    if (m.def.f2) this.f2Init(m);
    m.sx = m.x; m.sz = m.z;
    m.staged = true; m.label = label ? String(label) : `${type}${m.id}`;
    this.stage().mobs.set(m.label, m);
    this.events.push({ t: 'fx', k: 'summon', x: r2(m.x), z: r2(m.z) });
    return m;
  },

  stagedMob(label) { return this.staged?.mobs.get(String(label)) || null; },

  // ---------- giveKeepsake(p, { name, slot, desc }) -> item ----------
  // A keepsake: no stats; can't be sold, salvaged, refined, reforged, dropped or deleted. Goes in the bag even when it's full.
  giveKeepsake(pp, { name, slot = 'charm', desc = '' } = {}) {
    const p = this.playerRef(pp);
    if (!p) return null;
    const it = keepsakeItem(name, SLOTS.includes(slot) ? slot : 'charm', desc);
    p.inv.bag.push(it);
    this.events.push({ t: 'loot', to: p.id, x: r2(p.x), z: r2(p.z), g: 0, items: [{ name: it.name, r: it.r }], pot: 0 });
    this.sys(`${p.name} received ${it.name}.`, p.id);
    this.invChanged(p);
    return it;
  },

  // ---------- clearStaging() ----------
  // Undo everything above: revive the scripted dead (where they lie), drop protection and reservations, remove spawns,
  // and give twists back to chance (from the next Warden spawn).
  clearStaging() {
    const S = this.staged;
    this.twistOverride = null;
    if (!S) return;
    for (const id of S.dead) { const p = this.players.get(id); if (p?.dead && p.respawnAt === Infinity) this.scriptRevive(p); }
    for (const id of S.protect) { const p = this.players.get(id); if (p) p.protectFrac = 0; }
    for (const m of S.reserved) m.laFor = null;
    for (const m of S.mobs.values()) {
      if (!this.mobs.has(m.id)) continue;
      if (!m.dead) this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: 0 });
      this.mobs.delete(m.id);
    }
    this.staged = null;
  },
};

export function installStaging(Game) { Object.assign(Game.prototype, methods); }
