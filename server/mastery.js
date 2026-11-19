// Skill mastery and evolutions, mixed into Game (see the end of game.js). Tuning and branch names: shared/mastery.js.
//  - Mastery points come from EFFECTIVE use only (hooks in damageMob, healPlayer, damagePlayer, addPosture/breakMob).
//  - useEvolved() runs the 18 evolved skills; useSkill() hands a skill over when its branch is active (Mastery 3+).
//  - Lasting effects: Renew (heal over time), Bulwark (stand still), Aegis shields, Iron Skin reflect, Challenge,
//    War Cry, Zeal, Purify (Miracle), Haven / Consecrate zones.
import { CLASSES, angleTo, wrapAngle, resolveCollision, inTown, paced } from '../shared/data.js';
import { MASTERY, BRANCHES, newMastery, masteryLevel, activeBranch, masteryCd, masteryPow, nearShrine } from '../shared/mastery.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const HAZARDS = new Set(['mire pool', 'cracked ground', 'the deluge']); // lingering ground hazards (Miracle purifies)
const inFront = (g, a, half) => Math.abs(wrapAngle(angleTo(g.x, g.z, a.x, a.z) - g.face)) <= half;

export const MasteryMethods = {
  // ---------- state ----------
  initMastery(p, raw) {
    p.mastery = newMastery(raw, p.cls, Number(process.env.MASTERY) || 0); // MASTERY=3 is a testing aid
    p.masteryDirty = true;
    p.cry = { until: 0, v: 0 }; p.shield = null; p.bulwark = null; p.iron = null; p.renew = null; p.purifyUntil = 0;
  },
  mEntry(p, skId) { return p.mastery?.[skId] || null; },
  branchOf(p, skId) { return activeBranch(this.mEntry(p, skId)); },
  skillPow(p, skId) { return masteryPow(this.mEntry(p, skId)); },
  // Cooldown for a skill slot: mastery (-10% at 2), branch (Miracle is longer), gear haste, Zeal.
  skillCd(p, sk, slot) {
    if (slot === 0) return sk.cd;
    let cd = masteryCd(sk, this.mEntry(p, sk.id)) * (1 - p.haste);
    if (p.dmg.zeal && this.time < p.dmg.until) cd *= 0.75;
    return cd;
  },
  masteryMsg(p) { return { type: 'mastery', m: p.mastery }; },
  atShrine(p) { return !p.dead && inTown(p.x, p.z) && !!nearShrine(p.x, p.z, 0.5); },

  // ---------- gaining mastery ----------
  // kind: a MASTERY.w key (amount is raw damage/healing/prevented damage, divided by the user's attack) or 'flat' (points).
  masteryGain(p, skId, amount, kind = 'flat') {
    const e = p && this.mEntry(p, skId);
    if (!e || !(amount > 0)) return;
    const pts = kind === 'flat' ? amount : (amount / Math.max(1, p.atk)) * (MASTERY.w[kind] || 0);
    if (!(pts > 0)) return;
    const before = masteryLevel(e.pts);
    e.pts = Math.round((e.pts + pts) * 100) / 100;
    p.masteryDirty = true; p.dirty = true;
    const lvl = masteryLevel(e.pts);
    if (lvl <= before) return;
    const evo = lvl >= MASTERY.evolveAt && before < MASTERY.evolveAt && !e.br;
    p.masteryNow = true; // send the panel data right away
    this.events.push({ t: 'mlvl', to: p.id, id: p.id, sk: skId, lvl, evo: evo ? 1 : 0 });
    const name = this.skillOf(p, skId)?.name || skId;
    this.sys(evo ? `${name} reached Mastery ${lvl}: it can EVOLVE! Press K to choose.` : `${name} reached Mastery ${lvl}.`, p.id);
    this.track(p, 'mastery', { skill: skId, lvl });
  },
  creditBy(who, skId, amount, kind) {
    const p = typeof who === 'object' ? who : this.players.get(who);
    if (p) this.masteryGain(p, skId, amount, kind);
  },
  skillOf(p, skId) { return CLASSES[p.cls]?.skills.find(s => s.id === skId) || null; },

  // ---------- choosing a branch ----------
  // The first pick works anywhere once the skill reaches Mastery 3; changing it needs a Skill Shrine in town (free).
  chooseBranch(p, skId, br) {
    const e = this.mEntry(p, skId);
    if (!e || (br !== 'A' && br !== 'B') || !BRANCHES[skId]) return;
    if (masteryLevel(e.pts) < MASTERY.evolveAt) return this.sys('That skill evolves at Mastery 3.', p.id);
    if (e.br === br) return;
    if (e.br && !this.atShrine(p)) return this.sys('You can change an evolution at a Skill Shrine in town.', p.id);
    const first = !e.br;
    e.br = br;
    p.masteryDirty = true; p.masteryNow = true; p.dirty = true;
    const b = BRANCHES[skId][br];
    this.events.push({ t: 'evolve', to: p.id, id: p.id, sk: skId, br, name: b.name, first: first ? 1 : 0, x: r2(p.x), z: r2(p.z) });
    this.sys(`${this.skillOf(p, skId)?.name || skId} evolved into ${b.name}!`, p.id);
    this.track(p, 'evolve', { skill: skId, branch: br, repick: !first });
  },

  // ---------- helpers for evolved skills ----------
  dashEnd(p, steps = 16) {
    let tx = p.x, tz = p.z;
    for (let i = 1; i <= steps; i++) {
      const nx = p.x + Math.sin(p.face) * i * 0.5, nz = p.z + Math.cos(p.face) * i * 0.5;
      if (!this.walk(nx, nz)) break;
      [tx, tz] = resolveCollision(nx, nz);
    }
    return [tx, tz];
  },
  // Nearest targetable enemy within range and within `half` radians of facing.
  pickFront(p, range, half) {
    let best = null, bd = Infinity;
    for (const m of this.mobs.values()) {
      if (!this.targetable(m)) continue;
      const d = dist(m, p);
      if (d > range + m.def.radius || (d > m.def.radius + 0.5 && !inFront(p, m, half))) continue;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  },
  // Drag an enemy toward a point, stopping `keep` metres short. Bosses and rooted enemies don't move; elites move half as far.
  dragToward(m, p, amount, keep = 1.4) {
    if (m.def.boss || !(m.def.speed > 0)) return false;
    const d = dist(m, p), want = m.def.radius + keep;
    if (d <= want) return false;
    const step = Math.min(d - want, amount) * (m.def.elite ? 0.5 : 1);
    let nx = m.x + ((p.x - m.x) / d) * step, nz = m.z + ((p.z - m.z) / d) * step;
    [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
    if (!this.walk(nx, nz) || inTown(nx, nz)) return false;
    m.x = nx; m.z = nz; m.windupAt = 0; // yanked out of its wind-up
    return true;
  },
  allyList(p, r) { return [...this.players.values()].filter(o => !o.dead && dist(o, p) <= r); },
  mostHurt(p, r) {
    let target = p, low = p.hp / p.maxHp;
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > r) continue;
      const f = o.hp / o.maxHp;
      if (f < low) { low = f; target = o; }
    }
    return target;
  },

  // ---------- the 18 evolved skills ----------
  // Returns false when the skill can't be used right now (no cooldown is spent), e.g. Challenge with no enemy in reach.
  useEvolved(p, sk, br, pow) {
    const t = this.time, S = sk.id, ev = BRANCHES[S][br].id;
    const atk = p.atk * this.dmgMult(p) * pow;
    const fx = (extra = {}) => this.events.push({ t: 'fx', k: 'evo', ev, s: S, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), ...extra });
    const alive = () => !p.dead && this.players.has(p.id);
    switch (ev) {
      // ----- Swordsman -----
      case 'phantom': { // dash through; an afterimage strikes the same path 0.4 s later
        const x0 = p.x, z0 = p.z, [tx, tz] = this.dashEnd(p);
        fx({ x2: r2(tx), z2: r2(tz) });
        this.hitLine(p, x0, z0, tx, tz, 1.8, atk * 1.35, { sk: S });
        this.teleport(p, tx, tz);
        this.effectLater(paced(0.4), () => { // the player has already dashed through: not use time
          if (!alive()) return;
          this.events.push({ t: 'fx', k: 'evo', ev: 'phantom2', id: p.id, x: r2(x0), z: r2(z0), x2: r2(tx), z2: r2(tz) });
          this.hitLine(p, x0, z0, tx, tz, 1.8, atk * 0.8, { sk: S, knock: 1.2 });
        });
        break;
      }
      case 'shoulder': { // stop on the first enemy in the path: heavy posture damage
        const dx = Math.sin(p.face), dz = Math.cos(p.face);
        let hit = null, along = Infinity;
        for (const m of this.mobs.values()) {
          if (!this.targetable(m)) continue;
          const vx = m.x - p.x, vz = m.z - p.z, a = vx * dx + vz * dz;
          if (a < -0.5 || a > 8 + m.def.radius || Math.abs(vx * dz - vz * dx) > 1.3 + m.def.radius) continue;
          if (a < along) { along = a; hit = m; }
        }
        const stop = hit ? Math.max(0, along - hit.def.radius - 0.8) : 8;
        const [tx, tz] = this.dashEnd(p, Math.floor(stop / 0.5));
        fx({ x2: r2(tx), z2: r2(tz), m: hit?.id || 0 });
        this.teleport(p, tx, tz);
        if (hit) this.damageMob(hit, p, atk * 1.3, { sk: S, heavy: true, knock: 2.2, stun: 0.8, frac: [0.4, 0.14], threat: 1.5 });
        break;
      }
      case 'vortex': { // pull enemies in, then spin
        const R = 7.5;
        for (const m of this.mobs.values()) if (this.targetable(m) && dist(m, p) <= R + m.def.radius) this.dragToward(m, p, R);
        fx({ r: R });
        this.schedule(paced(0.25), () => {
          if (!alive()) return;
          this.events.push({ t: 'fx', k: 'evo', ev: 'vortex2', id: p.id, x: r2(p.x), z: r2(p.z), r: 4.2 });
          this.hitCircle(p, p.x, p.z, 4.2, atk * 1.4, { sk: S, knock: 0.4 });
        });
        break;
      }
      case 'bladering': { // a smaller ring that spins with you for 1.5 s
        const tick = i => {
          if (!alive()) return;
          this.events.push({ t: 'fx', k: 'evo', ev: 'bladering', s: i ? undefined : S, id: p.id, x: r2(p.x), z: r2(p.z), r: 3.2, n: i });
          this.hitCircle(p, p.x, p.z, 3.2, atk * 0.45, { sk: S, knock: 0.25 });
        };
        tick(0);
        for (let i = 1; i < 4; i++) this.effectLater(i * paced(0.5), () => tick(i)); // the player keeps moving: not use time
        break;
      }
      case 'starburst': // 6 hits, more damage, no Break chunk
        for (let i = 0; i < 6; i++) {
          this.schedule(i * paced(0.15), () => {
            if (!alive()) return;
            const fin = i === 5;
            this.events.push({ t: 'fx', k: 'evo', ev: 'starburst', s: S, n: i, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), r: 3.2 });
            this.hitArc(p, 3.2, 0.9, p.atk * this.dmgMult(p) * pow * (fin ? 1.6 : 0.85), fin ? { sk: S, knock: 2.2, heavy: true } : { sk: S, knock: 0.2 });
          });
        }
        break;
      case 'finisher': // 2 hits; the second fills posture on an enemy above 50% health
        for (let i = 0; i < 2; i++) {
          this.schedule(i * paced(0.3), () => {
            if (!alive()) return;
            this.events.push({ t: 'fx', k: 'evo', ev: 'finisher', s: S, n: i, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), r: 3.4 });
            const A = p.atk * this.dmgMult(p) * pow;
            if (i === 0) { this.hitArc(p, 3.2, 0.9, A, { sk: S, knock: 0.2 }); return; }
            for (const m of [...this.mobs.values()]) {
              if (!this.targetable(m) || !this.inArc(p, m, 3.4, 0.9)) continue;
              const high = m.hp / m.maxHp > 0.5;
              this.damageMob(m, p, A * 2, { sk: S, heavy: true, knock: 2, frac: high ? [1, 0.45] : null, brk: !high });
            }
          });
        }
        break;

      // ----- Guardian -----
      case 'challenge': { // one enemy: it deals 30% less to everyone but you
        const m = this.pickFront(p, 10, 1.0) || this.pickFront(p, 6, Math.PI);
        if (!m) return false;
        this.tauntMob(m, p, 'challenge'); // lock + cuts (server/threat.js)
        m.weakUntil = t + 5; m.weakBy = p.id; this.weakT = Math.max(this.weakT || 0, t + 5);
        fx({ m: m.id, x2: r2(m.x), z2: r2(m.z) });
        this.damageMob(m, p, atk * 0.8, { sk: S, heavy: true, threat: 2 });
        p.dr = { until: t + 4, v: 0.3 * pow, by: p.id, sk: S };
        this.events.push({ t: 'buff', id: p.id, k: 'dr', d: 4 });
        break;
      }
      case 'warcry': { // wider taunt that drags enemies in + a party damage buff
        const R = 11;
        fx({ r: R });
        for (const m of [...this.mobs.values()]) {
          if (!this.targetable(m) || dist(m, p) > R + m.def.radius) continue;
          this.tauntMob(m, p, 'warcry');
          this.dragToward(m, p, 2.5, 1.8);
        }
        this.hitCircle(p, p.x, p.z, R, atk * 0.4, { sk: S });
        p.dr = { until: t + 4, v: 0.2 * pow, by: p.id, sk: S };
        for (const o of this.allyList(p, 12)) {
          o.cry = { until: t + 6, v: 0.1 * pow, by: p.id, sk: S };
          this.events.push({ t: 'buff', id: o.id, k: 'cry', d: 6 });
        }
        break;
      }
      case 'bulwark': // stand still: block the front, for you and the allies behind you
        p.bulwark = { until: t + 5, x: p.x, z: p.z, v: Math.min(0.9, 0.8 * pow), ally: Math.min(0.7, 0.6 * pow) };
        this.bulwarkT = Math.max(this.bulwarkT || 0, t + 5);
        this.events.push({ t: 'buff', id: p.id, k: 'bulwark', d: 5, f: r2(p.face) });
        fx();
        break;
      case 'ironskin': // move freely: less damage, reflect part of every hit
        p.dr = { until: t + 6, v: 0.35 * pow, by: p.id, sk: S };
        p.iron = { until: t + 6, frac: 0.3 * pow };
        this.events.push({ t: 'buff', id: p.id, k: 'iron', d: 6 });
        fx();
        break;
      case 'quake': { // bigger area, launches enemies
        const R = 7;
        fx({ r: R });
        for (const m of [...this.mobs.values()]) {
          if (!this.targetable(m) || dist(m, p) > R + m.def.radius) continue;
          if (!m.def.boss) m.launchUntil = t + 0.9;
          this.damageMob(m, p, atk * 1.15, { sk: S, stun: 1.8, threat: 1.5, brk: true, heavy: true });
        }
        break;
      }
      case 'seismic': { // a shockwave that travels 12 m forward
        const dx = Math.sin(p.face), dz = Math.cos(p.face), x0 = p.x, z0 = p.z, seg = 3, hit = new Set();
        let blocked = false;
        for (let i = 0; i < 4; i++) {
          this.effectLater(i * paced(0.1), () => { // the wave travels on its own: not use time
            if (blocked || !alive()) return;
            const ax = x0 + dx * seg * i, az = z0 + dz * seg * i, bx = ax + dx * seg, bz = az + dz * seg;
            if (!this.walk(bx, bz)) { blocked = true; return; }
            this.events.push({ t: 'fx', k: 'evo', ev: 'seismic', s: i ? undefined : S, n: i, id: p.id, x: r2(ax), z: r2(az), x2: r2(bx), z2: r2(bz) });
            for (const m of [...this.mobs.values()]) {
              if (!this.targetable(m) || hit.has(m.id)) continue;
              const k = Math.max(0, Math.min(1, ((m.x - ax) * dx + (m.z - az) * dz) / seg));
              if (Math.hypot(m.x - (ax + dx * seg * k), m.z - (az + dz * seg * k)) > 1.7 + m.def.radius) continue;
              hit.add(m.id);
              this.damageMob(m, p, atk * 1.3, { sk: S, stun: 1, threat: 1.5, brk: true, heavy: true, knock: 0.8 });
            }
          });
        }
        break;
      }

      // ----- Cleric -----
      case 'renew': { // smaller heal over 6 s on the two most hurt allies
        const list = this.allyList(p, 15).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, 2);
        for (const o of list) {
          const per = ((o.maxHp * 0.24 + 6 + p.lvl) * pow) / 6;
          o.renew = { by: p.id, per, left: 5, next: t + 1 };
          this.healPlayer(o, per, p, S); // the first tick lands at once
          this.events.push({ t: 'fx', k: 'evo', ev: 'renew', s: S, by: p.id, id: o.id, x: r2(o.x), z: r2(o.z) });
          this.events.push({ t: 'buff', id: o.id, k: 'renew', d: 6 });
        }
        break;
      }
      case 'miracle': { // big heal + purify
        const o = this.mostHurt(p, 15);
        this.healPlayer(o, (o.maxHp * 0.6 + 20 + p.lvl * 4) * pow, p, S);
        o.purifyUntil = t + 4; o.purifyBy = p.id;
        this.events.push({ t: 'fx', k: 'evo', ev: 'miracle', s: S, by: p.id, id: o.id, x: r2(o.x), z: r2(o.z) });
        this.events.push({ t: 'buff', id: o.id, k: 'purify', d: 4 });
        break;
      }
      case 'zeal': // +damage and faster cooldowns
        fx({ r: 15 });
        for (const o of this.allyList(p, 15)) {
          o.dmg = { until: t + 8, v: 0.15 * pow, by: p.id, sk: S, zeal: true };
          for (let i = 1; i < o.cds.length; i++) if (o.cds[i] > t) o.cds[i] = t + (o.cds[i] - t) * 0.75;
          this.events.push({ t: 'buff', id: o.id, k: 'zeal', d: 8 });
        }
        break;
      case 'aegis': // a damage shield on every ally nearby
        fx({ r: 15 });
        for (const o of this.allyList(p, 15)) {
          o.shield = { hp: Math.round(o.maxHp * 0.25 * pow), max: Math.round(o.maxHp * 0.25 * pow), until: t + 8, by: p.id };
          this.events.push({ t: 'buff', id: o.id, k: 'aegis', d: 8 });
        }
        break;
      case 'haven': // allies inside take less damage
        this.zones.push({ kind: 'haven', x: p.x, z: p.z, r: 6, until: t + 6, next: t, owner: p.id, sk: S, heal: 0.035 * pow, dr: 0.25 });
        fx({ r: 6, d: 6 });
        break;
      case 'consecrate': // burns enemies inside and fills their posture
        this.zones.push({ kind: 'consecrate', x: p.x, z: p.z, r: 6, until: t + 5, next: t, owner: p.id, sk: S, dmg: atk * 0.3, frac: [0.07, 0.025] });
        fx({ r: 6, d: 5 });
        break;
      default: return false;
    }
    return true;
  },

  // ---------- per-tick upkeep ----------
  // A Sanctuary-type zone ticks every 0.5 s (game.js update).
  zoneTick(zn) {
    const owner = this.players.get(zn.owner);
    if (zn.kind === 'consecrate') {
      if (!owner) return;
      for (const m of [...this.mobs.values()]) {
        if (this.targetable(m) && Math.hypot(m.x - zn.x, m.z - zn.z) <= zn.r + m.def.radius) this.damageMob(m, owner, zn.dmg, { sk: zn.sk, frac: zn.frac, threat: 0.6 });
      }
      return;
    }
    for (const o of this.players.values()) {
      if (!o.dead && Math.hypot(o.x - zn.x, o.z - zn.z) <= zn.r) this.healPlayer(o, o.maxHp * (zn.heal ?? 0.06), owner, zn.sk || 'sanct');
    }
  },

  updateMastery() {
    const t = this.time;
    for (const p of this.players.values()) {
      if (p.renew) {
        const rn = p.renew;
        if (p.dead) p.renew = null;
        else {
          while (rn.left > 0 && t >= rn.next) { rn.left--; rn.next += 1; this.healPlayer(p, rn.per, this.players.get(rn.by), 'heal'); }
          if (rn.left <= 0) p.renew = null;
        }
      }
      if (p.bulwark && (t >= p.bulwark.until || p.dead || Math.hypot(p.x - p.bulwark.x, p.z - p.bulwark.z) > 0.9)) {
        p.bulwark = null;
        this.events.push({ t: 'buff', id: p.id, k: 'bulwark', end: 1 });
      }
      if (p.shield && t >= p.shield.until) p.shield = null;
    }
  },

  // ---------- incoming damage ----------
  // Miracle's purify: lingering ground hazards don't touch you.
  purified(p, src, base) {
    if (this.time >= (p.purifyUntil || 0) || !HAZARDS.has(src)) return false;
    this.events.push({ t: 'evade', id: p.id, to: p.id, k: 'purify' });
    this.creditBy(p.purifyBy, 'heal', base, 'prevent');
    return true;
  },

  // Challenge and Bulwark cut a hit before damage reduction; Iron Skin reflects it. Books the prevented damage.
  // Returns { mult, haven (zone or null), attacker, reflect }.
  hitMods(p, raw, src, mob) {
    const t = this.time, out = { mult: 1, haven: null, attacker: null, reflect: false };
    const iron = p.iron && t < p.iron.until;
    if (mob || (this.weakT || 0) > t || (this.bulwarkT || 0) > t || iron) out.attacker = this.attackerOf(p, src, mob);
    const a = out.attacker;
    if (a && t < (a.weakUntil || 0) && a.weakBy !== p.id) { // Challenge
      out.mult *= 0.7;
      this.creditBy(a.weakBy, 'taunt', raw * 0.3, 'prevent');
    }
    if (a && (this.bulwarkT || 0) > t) { // Bulwark: the guardian's front, and allies standing behind them
      let best = 0, by = null;
      for (const g of this.players.values()) {
        const b = g.bulwark;
        if (!b || g.dead || t >= b.until || !inFront(g, a, 1.4)) continue;
        let cut = 0;
        if (g === p) cut = b.v;
        else if (dist(g, p) <= 7 && (p.x - g.x) * Math.sin(g.face) + (p.z - g.z) * Math.cos(g.face) < 0.3) cut = b.ally;
        if (cut > best) { best = cut; by = g; }
      }
      if (by) {
        this.creditBy(by, 'wall', raw * out.mult * best, 'prevent');
        out.mult *= 1 - best;
        this.events.push({ t: 'block', id: p.id, to: p.id, by: by.id });
      }
    }
    for (const zn of this.zones) { // Haven
      if (zn.kind === 'haven' && t < zn.until && Math.hypot(p.x - zn.x, p.z - zn.z) <= zn.r) { out.haven = zn; break; }
    }
    out.reflect = !!(iron && a);
    return out;
  },

  // Credit Taunt / Shield Wall / Iron Skin (p.dr) and Haven for the damage their reduction took off a hit.
  bookDr(p, pre, skDr, haven, dr) {
    if (skDr > 0 && p.dr.sk) this.creditBy(p.dr.by, p.dr.sk, pre * Math.min(skDr, dr), 'prevent');
    if (haven) this.creditBy(haven.owner, haven.sk, pre * Math.min(haven.dr, Math.max(0, dr - skDr)), 'prevent');
  },

  reflectHit(p, a, raw) {
    if (!a || a.dead) return;
    this.damageMob(a, p, raw * p.iron.frac, { sk: 'wall', threat: 2 });
  },

  // Aegis: the shield soaks the hit first. Returns what's left.
  absorbHit(p, amount) {
    const s = p.shield;
    if (!s || this.time >= s.until || s.hp <= 0) return amount;
    const a = Math.min(s.hp, amount);
    s.hp -= a;
    this.creditBy(s.by, 'bless', a, 'prevent');
    this.events.push({ t: 'absorb', id: p.id, a });
    if (s.hp <= 0) { p.shield = null; this.events.push({ t: 'buff', id: p.id, k: 'aegis', end: 1 }); }
    return amount - a;
  },

  // Credit Blessing / Zeal / War Cry for the extra damage a buffed player dealt.
  bookBuffs(p, dealt) {
    const t = this.time, mult = this.dmgMult(p);
    if (t < p.dmg.until && p.dmg.by) this.creditBy(p.dmg.by, p.dmg.sk, (dealt * p.dmg.v) / mult, 'buff');
    if (t < p.cry.until && p.cry.by) this.creditBy(p.cry.by, p.cry.sk, (dealt * p.cry.v) / mult, 'buff');
  },
};
