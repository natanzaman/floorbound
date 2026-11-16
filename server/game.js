// Authoritative world simulation: players, mobs, the floor boss, combat, XP and parties.
import {
  WORLD, CLASSES, CLASS_IDS, MOBS, MOB_IDS, MAX_LEVEL, PARTY_MAX, PLAYER_SPEED, SPRINT_SPEED, DODGE, SWITCH,
  inTown, inArena, walkable, resolveCollision, rng, angleTo, wrapAngle, xpToNext, statsFor,
} from '../shared/data.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

export class Game {
  constructor() {
    this.players = new Map();
    this.mobs = new Map();
    this.parties = new Map();
    this.zones = [];
    this.scheduled = [];
    this.events = [];
    this.nextId = 1;
    this.time = 0;
    this.floorClears = 0;
    this.spawnMobs();
  }

  id() { return this.nextId++; }

  // ---------- setup ----------
  spawnMobs() {
    const r = rng(7);
    for (let i = 0; i < 14; i++) this.addMob('boar', -60 + r() * 120, 38 + r() * 55);
    for (let i = 0; i < 10; i++) this.addMob('wolf', -60 + r() * 120, 100 + r() * 45);
    this.boss = this.addMob('warden', WORLD.arena.x, WORLD.arena.z + 4);
  }

  addMob(type, x, z) {
    const def = MOBS[type];
    [x, z] = resolveCollision(x, z, def.radius);
    const m = {
      id: this.id(), type, def, sx: x, sz: z, x, z, face: Math.random() * 6.28,
      hp: def.hp, maxHp: def.hp, dead: false, deadUntil: 0, threat: new Map(),
      atkT: 0, windupAt: 0, stunUntil: 0, wanderT: Math.random() * 4, wx: x, wz: z,
      contributors: new Set(), phase: 0, slamT: 0, spinT: 0, moving: false,
      staggerUntil: 0, staggerBy: 0, staggerCd: 0, switched: false,
    };
    this.mobs.set(m.id, m);
    return m;
  }

  spawnPoint() {
    if (process.env.SPAWN_AT) { const [x, z] = process.env.SPAWN_AT.split(',').map(Number); return [x, z]; } // testing aid
    const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 3;
    return resolveCollision(Math.sin(a) * d, Math.cos(a) * d);
  }

  addPlayer(ws, name, cls) {
    if (!CLASSES[cls]) cls = 'swordsman';
    name = String(name || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || `Player${this.nextId}`;
    const [x, z] = this.spawnPoint();
    const p = {
      id: this.id(), ws, name, cls, lvl: 1, xp: 0, x, z, face: 0, dead: false, respawnAt: 0,
      cds: [0, 0, 0, 0], dr: { until: 0, v: 0 }, dmg: { until: 0, v: 0 }, party: null,
      posSeq: 0, lastMoveT: this.time, lastHurt: -99, invite: null, dodgeCd: 0, rollUntil: 0, iframeUntil: 0, combo: 0, lastBasic: -9,
    };
    p.lvl = Math.min(MAX_LEVEL, Math.max(1, Number(process.env.START_LEVEL) || 1)); // START_LEVEL is a testing aid
    Object.assign(p, statsFor(cls, p.lvl));
    p.hp = p.maxHp;
    this.players.set(p.id, p);
    this.sys(`${p.name} the ${CLASSES[cls].name} entered the tower.`);
    return p;
  }

  removePlayer(p) {
    this.leaveParty(p);
    this.players.delete(p.id);
    this.sys(`${p.name} left.`);
  }

  // ---------- messaging helpers ----------
  sys(text, to) { this.events.push({ t: 'sys', text, to }); }
  schedule(delay, fn) { this.scheduled.push({ at: this.time + delay, fn }); }
  teleport(p, x, z) {
    p.x = x; p.z = z; p.posSeq++;
    this.events.push({ t: 'tp', id: p.id, x: r2(x), z: r2(z), s: p.posSeq });
  }

  // ---------- input ----------
  handle(p, msg) {
    switch (msg.type) {
      case 'input': return this.onInput(p, msg);
      case 'skill': return this.useSkill(p, msg.slot | 0, msg.face);
      case 'dodge': return this.dodge(p, msg.face);
      case 'chat': {
        const text = String(msg.text || '').slice(0, 200).trim();
        if (text) this.events.push({ t: 'chat', from: p.name, id: p.id, text });
        return;
      }
      case 'invite': return this.invite(p, msg.id);
      case 'accept': return this.accept(p, msg.from);
      case 'decline': p.invite = null; return;
      case 'leave': return this.leaveParty(p);
    }
  }

  onInput(p, msg) {
    if (typeof msg.face === 'number' && isFinite(msg.face)) p.face = wrapAngle(msg.face);
    if (p.dead || msg.seq !== p.posSeq) return;
    let x = +msg.x, z = +msg.z;
    if (!isFinite(x) || !isFinite(z)) return;
    const dt = Math.min(0.5, this.time - p.lastMoveT);
    p.lastMoveT = this.time;
    const rolling = this.time < p.rollUntil + 0.15;
    const maxD = (rolling ? DODGE.dist / DODGE.time : SPRINT_SPEED) * dt * 1.3 + 0.35;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > maxD) { x = p.x + (dx / d) * maxD; z = p.z + (dz / d) * maxD; }
    if (!walkable(x, z)) return;
    p.x = x; p.z = z;
  }

  // ---------- dodge roll ----------
  dodge(p, face) {
    if (p.dead || this.time < p.dodgeCd) return;
    if (typeof face !== 'number' || !isFinite(face)) face = p.face;
    p.dodgeCd = this.time + DODGE.cd;
    p.rollUntil = this.time + DODGE.time;
    p.iframeUntil = this.time + DODGE.iframes;
    p.face = wrapAngle(face);
    this.events.push({ t: 'roll', id: p.id, f: r2(p.face) });
  }

  // ---------- parties ----------
  partyOf(p) { return p.party ? this.parties.get(p.party) : null; }

  invite(p, targetId) {
    const t = this.players.get(targetId);
    if (!t || t === p) return;
    const party = this.partyOf(p);
    if (party && party.members.length >= PARTY_MAX) return this.sys('Your party is full.', p.id);
    if (t.party && t.party === p.party) return;
    t.invite = { from: p.id, at: this.time };
    this.events.push({ t: 'invite', to: t.id, from: p.id, name: p.name });
    this.sys(`Invited ${t.name} to your party.`, p.id);
  }

  accept(p, fromId) {
    const inviter = this.players.get(fromId);
    if (!inviter || !p.invite || p.invite.from !== fromId) return;
    p.invite = null;
    let party = this.partyOf(inviter);
    if (!party) {
      party = { id: this.id(), members: [inviter.id] };
      this.parties.set(party.id, party);
      inviter.party = party.id;
    }
    if (party.members.length >= PARTY_MAX) return this.sys('That party is full.', p.id);
    this.leaveParty(p);
    party.members.push(p.id);
    p.party = party.id;
    for (const id of party.members) this.sys(`${p.name} joined the party.`, id);
  }

  leaveParty(p) {
    const party = this.partyOf(p);
    p.party = null;
    if (!party) return;
    party.members = party.members.filter(id => id !== p.id);
    for (const id of party.members) this.sys(`${p.name} left the party.`, id);
    if (party.members.length <= 1) {
      for (const id of party.members) { const m = this.players.get(id); if (m) m.party = null; }
      this.parties.delete(party.id);
    }
  }

  // ---------- skills ----------
  dmgMult(p) { return this.time < p.dmg.until ? 1 + p.dmg.v : 1; }

  useSkill(p, slot, face) {
    if (p.dead) return;
    const sk = CLASSES[p.cls].skills[slot];
    if (!sk || p.lvl < sk.lvl || this.time < p.cds[slot]) return;
    if (typeof face === 'number' && isFinite(face)) p.face = wrapAngle(face);
    p.cds[slot] = this.time + sk.cd;
    const atk = p.atk * this.dmgMult(p);
    const fx = (k, extra = {}) => this.events.push({ t: 'fx', k, s: sk.id, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), ...extra });
    const t = this.time;

    switch (sk.id) {
      case 'slash':
      case 'bash': {
        p.combo = t - p.lastBasic < 1.0 ? (p.combo + 1) % 3 : 0;
        p.lastBasic = t;
        const fin = p.combo === 2, threat = sk.id === 'bash' ? 2.5 : 1;
        fx('arc', { r: fin ? 3.5 : 3, n: p.combo, c: fin || sk.id === 'bash' ? 'gold' : undefined, fin: fin ? 1 : 0 });
        this.hitArc(p, fin ? 3.5 : 3, fin ? 1.3 : 1.05, atk * (fin ? 1.6 : 1), { threat, knock: fin ? 2 : 0.35, heavy: fin });
        break;
      }
      case 'rush': {
        let tx = p.x, tz = p.z;
        for (let i = 1; i <= 16; i++) {
          const nx = p.x + Math.sin(p.face) * i * 0.5, nz = p.z + Math.cos(p.face) * i * 0.5;
          if (!walkable(nx, nz)) break;
          [tx, tz] = resolveCollision(nx, nz);
        }
        fx('rush', { x2: r2(tx), z2: r2(tz) });
        this.hitLine(p, p.x, p.z, tx, tz, 1.8, atk * 1.6, { knock: 1.5 });
        this.teleport(p, tx, tz);
        break;
      }
      case 'whirl': fx('ring', { r: 4 }); this.hitCircle(p, p.x, p.z, 4, atk * 1.4, { knock: 1.2 }); break;
      case 'burst':
        for (let i = 0; i < 4; i++) {
          this.schedule(i * 0.2, () => {
            if (p.dead || !this.players.has(p.id)) return;
            this.events.push({ t: 'fx', k: 'arc', s: 'burst', n: i, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), r: 3.2, c: i === 3 ? 'gold' : undefined });
            this.hitArc(p, 3.2, 0.9, p.atk * this.dmgMult(p) * (i === 3 ? 1.6 : 0.9), i === 3 ? { brk: true, knock: 2.5, heavy: true } : { knock: 0.3 });
          });
        }
        break;
      case 'taunt': {
        fx('ring', { r: 8, c: 'gold' });
        for (const m of this.mobs.values()) {
          if (m.dead || dist(m, p) > 8 + m.def.radius) continue;
          let top = 0; for (const v of m.threat.values()) top = Math.max(top, v);
          m.threat.set(p.id, top + 100);
        }
        this.hitCircle(p, p.x, p.z, 8, atk * 0.5);
        p.dr = { until: t + 4, v: 0.3 };
        this.events.push({ t: 'buff', id: p.id, k: 'dr', d: 4 });
        break;
      }
      case 'wall': p.dr = { until: t + 4, v: 0.6 }; this.events.push({ t: 'buff', id: p.id, k: 'wall', d: 4 }); fx('shield'); break;
      case 'gslam': fx('ring', { r: 5, c: 'gold' }); this.hitCircle(p, p.x, p.z, 5, atk * 1.3, { stun: 1.5, threat: 1.5, brk: true, knock: 2, heavy: true }); break;
      case 'smite': {
        const range = 10, dx = Math.sin(p.face), dz = Math.cos(p.face);
        let best = null, bestT = range;
        for (const m of this.mobs.values()) {
          if (m.dead) continue;
          const vx = m.x - p.x, vz = m.z - p.z, along = vx * dx + vz * dz;
          if (along < 0 || along > range + m.def.radius) continue;
          const perp = Math.abs(vx * dz - vz * dx);
          if (perp < 1.2 + m.def.radius && along < bestT) { best = m; bestT = Math.max(0, along); }
        }
        fx('bolt', { x2: r2(p.x + dx * bestT), z2: r2(p.z + dz * bestT) });
        if (best) this.damageMob(best, p, atk * 1.1, { brk: best.windupAt > 0, interrupt: true });
        break;
      }
      case 'heal': {
        let target = p, low = p.hp / p.maxHp;
        for (const o of this.players.values()) {
          if (o.dead || dist(o, p) > 15) continue;
          const f = o.hp / o.maxHp;
          if (f < low) { low = f; target = o; }
        }
        this.healPlayer(target, target.maxHp * 0.3 + 10 + p.lvl * 2, p);
        this.events.push({ t: 'fx', k: 'heal', s: 'heal', by: p.id, id: target.id, x: r2(target.x), z: r2(target.z) });
        break;
      }
      case 'bless': {
        fx('ring', { r: 15, c: 'light' });
        for (const o of this.players.values()) {
          if (o.dead || dist(o, p) > 15) continue;
          o.dmg = { until: t + 8, v: 0.25 };
          this.events.push({ t: 'buff', id: o.id, k: 'bless', d: 8 });
        }
        break;
      }
      case 'sanct': {
        this.zones.push({ x: p.x, z: p.z, r: 6, until: t + 5, next: t, owner: p.id });
        fx('zone', { r: 6, d: 5 });
        break;
      }
    }
  }

  inArc(p, m, range, half) {
    const d = dist(p, m);
    if (d > range + m.def.radius) return false;
    if (d < m.def.radius + 0.5) return true;
    return Math.abs(wrapAngle(angleTo(p.x, p.z, m.x, m.z) - p.face)) <= half;
  }

  hitArc(p, range, half, amount, opts) {
    for (const m of this.mobs.values()) if (!m.dead && this.inArc(p, m, range, half)) this.damageMob(m, p, amount, opts);
  }

  hitCircle(p, x, z, r, amount, opts) {
    for (const m of this.mobs.values()) {
      if (!m.dead && Math.hypot(m.x - x, m.z - z) <= r + m.def.radius) this.damageMob(m, p, amount, opts);
    }
  }

  hitLine(p, x0, z0, x1, z1, width, amount, opts) {
    const lx = x1 - x0, lz = z1 - z0, len2 = lx * lx + lz * lz || 1;
    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      const tt = Math.max(0, Math.min(1, ((m.x - x0) * lx + (m.z - z0) * lz) / len2));
      if (Math.hypot(m.x - (x0 + lx * tt), m.z - (z0 + lz * tt)) <= width + m.def.radius) this.damageMob(m, p, amount, opts);
    }
  }

  damageMob(m, p, base, { threat = 1, stun = 0, brk = false, interrupt = false, knock = 0, heavy = false } = {}) {
    if (m.dead) return;
    const t = this.time;
    p.lastCombat = t;
    const crit = Math.random() < 0.1;
    // Switch: a staggered enemy takes extra damage from anyone but the player who broke it
    let mult = 1, sw = 0;
    if (t < m.staggerUntil && p.id !== m.staggerBy) {
      if (!m.switched) { mult = SWITCH.first; sw = 1; m.switched = true; } else mult = SWITCH.follow;
    }
    const amount = Math.max(1, Math.round(base * (0.9 + Math.random() * 0.2) * (crit ? 1.5 : 1) * mult));
    m.hp -= amount;
    if (sw) {
      this.events.push({ t: 'switch', id: m.id, by: p.id, from: m.staggerBy, a: amount });
      const from = this.players.get(m.staggerBy);
      if (from) this.giveXp(from, 5); // a little thank-you for setting it up
    }
    m.threat.set(p.id, (m.threat.get(p.id) || 0) + amount * threat);
    m.contributors.add(p.id);
    if (stun && !m.def.boss) m.stunUntil = t + stun;
    if (stun && m.def.boss) m.stunUntil = Math.max(m.stunUntil, t + stun * 0.3);
    this.events.push({ t: 'hit', id: m.id, a: amount, c: crit ? 1 : 0, by: p.id, sw, h: heavy ? 1 : 0 });
    if (m.hp <= 0) return this.killMob(m, p);
    if (knock && !m.def.boss) this.knockback(m, p, knock);
    if (brk && t >= m.staggerUntil && (!m.def.boss || t >= m.staggerCd)) {
      const dur = m.def.boss ? SWITCH.bossWindow : SWITCH.window;
      m.staggerUntil = t + dur; m.staggerBy = p.id; m.switched = false;
      m.stunUntil = Math.max(m.stunUntil, t + dur);
      m.windupAt = 0; // a break cancels the attack it was winding up
      if (m.def.boss) m.staggerCd = t + SWITCH.bossCd;
      this.events.push({ t: 'stagger', id: m.id, by: p.id, d: dur, i: interrupt ? 1 : 0 });
    }
  }

  knockback(m, p, dist) {
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
    for (let k = 4; k >= 1; k--) { // try the full push, then shorter ones if something is in the way
      let nx = m.x + (dx / d) * dist * (k / 4), nz = m.z + (dz / d) * dist * (k / 4);
      [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
      if (walkable(nx, nz) && Math.hypot(nx - WORLD.town.x, nz - WORLD.town.z) > WORLD.town.r + 2) { m.x = nx; m.z = nz; break; }
    }
    if (dist >= 1.5) m.windupAt = 0; // big hits interrupt small enemies' attacks
  }

  killMob(m, killer) {
    m.dead = true; m.hp = 0;
    m.deadUntil = this.time + (m.def.boss ? 60 : 15);
    this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: m.def.boss ? 1 : 0 });
    if (m.def.boss) {
      const names = [];
      for (const id of m.contributors) {
        const p = this.players.get(id);
        if (p) { names.push(p.name); this.giveXp(p, m.def.xp); }
      }
      this.floorClears++;
      this.events.push({ t: 'clear', names, n: this.floorClears });
      this.sys(`The Horned Warden has fallen! Floor 1 cleared by ${names.join(', ')}. Floor 2 unlocks in a future update.`);
      return;
    }
    const party = this.partyOf(killer);
    const ids = party ? party.members : [killer.id];
    const recips = ids.map(id => this.players.get(id)).filter(p => p && !p.dead && dist(p, m) <= 30);
    if (!recips.length) recips.push(killer);
    const share = Math.round((m.def.xp * (1 + 0.2 * (recips.length - 1))) / recips.length);
    for (const p of recips) this.giveXp(p, share);
  }

  giveXp(p, amount) {
    if (p.lvl >= MAX_LEVEL) return;
    p.xp += amount;
    this.events.push({ t: 'xp', to: p.id, a: amount });
    while (p.lvl < MAX_LEVEL && p.xp >= xpToNext(p.lvl)) {
      p.xp -= xpToNext(p.lvl);
      p.lvl++;
      Object.assign(p, statsFor(p.cls, p.lvl));
      p.hp = p.maxHp;
      this.events.push({ t: 'lvl', id: p.id, lvl: p.lvl });
      const unlocked = CLASSES[p.cls].skills.find(s => s.lvl === p.lvl);
      if (unlocked) this.sys(`New skill unlocked: ${unlocked.name}!`, p.id);
    }
    if (p.lvl >= MAX_LEVEL) p.xp = 0;
  }

  healPlayer(t, amount, by) {
    if (t.dead) return;
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + Math.round(amount));
    if (t.hp > before) this.events.push({ t: 'heal', id: t.id, a: t.hp - before });
    if (by && this.boss && !this.boss.dead && this.boss.threat.size && inArena(t.x, t.z)) this.boss.contributors.add(by.id);
  }

  damagePlayer(p, base) {
    if (p.dead || inTown(p.x, p.z)) return;
    if (this.time < p.iframeUntil) { this.events.push({ t: 'evade', id: p.id }); return; }
    const dr = this.time < p.dr.until ? p.dr.v : 0;
    const amount = Math.max(1, Math.round(base * (0.9 + Math.random() * 0.2) * (1 - dr)));
    p.hp -= amount;
    p.lastHurt = this.time; p.lastCombat = this.time;
    this.events.push({ t: 'hurt', id: p.id, a: amount });
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true; p.respawnAt = this.time + 4;
      p.xp = Math.max(0, p.xp - Math.round(xpToNext(p.lvl) * 0.1));
      this.events.push({ t: 'pdie', id: p.id });
      this.sys(`${p.name} was defeated.`);
    }
  }

  // ---------- simulation ----------
  update(dt) {
    this.time += dt;
    const t = this.time;

    const due = this.scheduled.filter(s => s.at <= t);
    this.scheduled = this.scheduled.filter(s => s.at > t);
    for (const s of due) s.fn();

    for (const p of this.players.values()) {
      if (p.dead) {
        if (t >= p.respawnAt) {
          p.dead = false; p.hp = p.maxHp;
          const [x, z] = this.spawnPoint();
          this.teleport(p, x, z);
        }
        continue;
      }
      const town = inTown(p.x, p.z);
      if (p.hp < p.maxHp && (town || t - p.lastHurt > 6)) {
        p.regenAcc = (p.regenAcc || 0) + p.maxHp * (town ? 0.1 : 0.02) * dt;
        if (p.regenAcc >= 1) { const a = Math.floor(p.regenAcc); p.regenAcc -= a; p.hp = Math.min(p.maxHp, p.hp + a); }
      }
      if (p.invite && t - p.invite.at > 30) p.invite = null;
    }

    for (const zn of this.zones) {
      if (t >= zn.next) {
        zn.next = t + 0.5;
        for (const p of this.players.values()) {
          if (!p.dead && Math.hypot(p.x - zn.x, p.z - zn.z) <= zn.r) this.healPlayer(p, p.maxHp * 0.06, this.players.get(zn.owner));
        }
      }
    }
    this.zones = this.zones.filter(zn => t < zn.until);

    for (const m of this.mobs.values()) this.updateMob(m, dt);

    // keep mobs from stacking
    const list = [...this.mobs.values()].filter(m => !m.dead);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.def.radius + b.def.radius;
      if (d < min && d > 1e-3) {
        const push = (min - d) / 2, ux = dx / d, uz = dz / d;
        if (!a.def.boss) { a.x -= ux * push; a.z -= uz * push; }
        if (!b.def.boss) { b.x += ux * push; b.z += uz * push; }
      }
    }
  }

  validTarget(m, p) {
    if (!p || p.dead || inTown(p.x, p.z)) return false;
    if (m.def.boss) return inArena(p.x, p.z);
    return dist(m, p) < 40;
  }

  updateMob(m, dt) {
    const t = this.time, def = m.def;
    m.moving = false;
    if (m.dead) {
      if (t >= m.deadUntil) {
        Object.assign(m, { dead: false, hp: m.maxHp, x: m.sx, z: m.sz, phase: 0, windupAt: 0, stunUntil: 0 });
        m.threat.clear(); m.contributors.clear();
        if (def.boss) this.sys('The Horned Warden stirs again in its chamber.');
      }
      return;
    }

    for (const pid of [...m.threat.keys()]) if (!this.validTarget(m, this.players.get(pid))) m.threat.delete(pid);
    if (def.aggro > 0) {
      for (const p of this.players.values()) {
        if (!m.threat.has(p.id) && this.validTarget(m, p) && dist(m, p) <= def.aggro) m.threat.set(p.id, 1);
      }
    }
    if (!def.boss && Math.hypot(m.x - m.sx, m.z - m.sz) > 35) m.threat.clear();

    let target = null, top = -1;
    for (const [pid, v] of m.threat) if (v > top) { top = v; target = this.players.get(pid); }

    if (t < m.stunUntil) return;

    if (!target) {
      m.windupAt = 0;
      if (def.boss && m.hp < m.maxHp) { // reset the fight
        m.hp = m.maxHp; m.phase = 0; m.contributors.clear();
      }
      m.engaged = false;
      if (t >= m.wanderT) {
        m.wanderT = t + 3 + Math.random() * 4;
        const a = Math.random() * 6.28, d = Math.random() * (def.boss ? 2 : 6);
        m.wx = m.sx + Math.sin(a) * d; m.wz = m.sz + Math.cos(a) * d;
      }
      this.moveMob(m, m.wx, m.wz, def.speed * 0.35, dt, 0.3);
      return;
    }

    if (def.boss && !m.engaged) { // scale the boss to the group that walks in
      m.engaged = true;
      let n = 0; for (const p of this.players.values()) if (!p.dead && inArena(p.x, p.z)) n++;
      m.maxHp = m.hp = def.hp - 900 + 700 * Math.max(1, n);
    }
    const enraged = def.boss && m.phase === 1;
    if (def.boss) this.bossSpecials(m, target);

    // finish a wind-up attack
    if (m.windupAt) {
      if (t >= m.windupAt) {
        m.windupAt = 0;
        if (def.boss) {
          for (const p of this.players.values()) {
            if (p.dead) continue;
            const d = dist(m, p);
            if (d <= def.range + 1 && Math.abs(wrapAngle(angleTo(m.x, m.z, p.x, p.z) - m.face)) < 1.3) this.damagePlayer(p, def.atk);
          }
          this.events.push({ t: 'fx', k: 'marc', id: m.id, x: r2(m.x), z: r2(m.z), f: r2(m.face), r: def.range + 1 });
        } else if (dist(m, target) <= def.range + 1.2) {
          this.damagePlayer(target, def.atk);
        }
      }
      return;
    }

    const d = dist(m, target);
    m.face = angleTo(m.x, m.z, target.x, target.z);
    if (d > def.range + 0.4) {
      this.moveMob(m, target.x, target.z, def.speed * (enraged ? 1.25 : 1), dt, def.range);
    } else if (t >= m.atkT) {
      const wind = def.boss ? 0.6 : 0.45;
      m.windupAt = t + wind;
      m.atkT = t + def.atkCd * (enraged ? 0.7 : 1);
      this.events.push({ t: 'wind', id: m.id, d: wind });
    }
  }

  bossSpecials(m, target) {
    const t = this.time;
    if (m.phase === 0 && m.hp < m.maxHp * 0.5) {
      m.phase = 1;
      this.events.push({ t: 'enrage', id: m.id });
      this.sys('The Horned Warden is enraged!');
      m.spinT = t + 3;
    }
    if (!m.slamT || m.slamT < t - 20) m.slamT = t + 5;
    if (t >= m.slamT) {
      m.slamT = t + (m.phase ? 5 : 8);
      const ids = [...m.threat.keys()];
      const victim = this.players.get(ids[Math.floor(Math.random() * ids.length)]) || target;
      const x = victim.x, z = victim.z, r = 5.5, d = 1.2;
      this.events.push({ t: 'tele', x: r2(x), z: r2(z), r, d });
      this.schedule(d, () => {
        if (m.dead) return;
        this.events.push({ t: 'fx', k: 'boom', x: r2(x), z: r2(z), r });
        for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.z - z) <= r) this.damagePlayer(p, m.def.atk * 1.8);
      });
    }
    if (m.phase === 1 && t >= m.spinT) {
      m.spinT = t + 9;
      const r = 8, d = 1.4;
      this.events.push({ t: 'tele', x: r2(m.x), z: r2(m.z), r, d, follow: m.id });
      this.schedule(d, () => {
        if (m.dead) return;
        this.events.push({ t: 'fx', k: 'boom', x: r2(m.x), z: r2(m.z), r });
        for (const p of this.players.values()) if (!p.dead && dist(p, m) <= r) this.damagePlayer(p, m.def.atk * 1.4);
      });
    }
  }

  moveMob(m, tx, tz, speed, dt, stopAt) {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d <= stopAt) return;
    const step = Math.min(d - stopAt, speed * dt);
    let nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
    [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
    if (Math.hypot(nx - WORLD.town.x, nz - WORLD.town.z) < WORLD.town.r + 2) return;
    if (m.def.boss && !inArena(nx, nz)) return;
    if (!walkable(nx, nz)) return;
    m.face = Math.atan2(dx, dz);
    m.x = nx; m.z = nz; m.moving = true;
  }

  // ---------- networking ----------
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      const buffs = (this.time < p.dr.until ? 1 : 0) | (this.time < p.dmg.until ? 2 : 0);
      players.push([p.id, r2(p.x), r2(p.z), r2(p.face), p.hp, p.maxHp, p.lvl, CLASS_IDS.indexOf(p.cls), p.party || 0, p.dead ? 1 : 0, buffs]);
    }
    const mobs = [];
    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      mobs.push([m.id, MOB_IDS.indexOf(m.type), r2(m.x), r2(m.z), r2(m.face), m.hp, m.maxHp, (m.moving ? 1 : 0) | (m.threat.size ? 2 : 0) | (m.phase ? 4 : 0) | (this.time < m.stunUntil ? 8 : 0) | (m.windupAt ? 16 : 0) | (this.time < m.staggerUntil ? 32 : 0)]);
    }
    const out = JSON.stringify({ players, mobs, events: this.events });
    this.events = [];
    return out;
  }

  meFor(p) {
    return {
      xp: p.xp, next: xpToNext(p.lvl), lvl: p.lvl,
      cds: p.cds.map(c => Math.max(0, r2(c - this.time))),
      dodge: Math.max(0, r2(p.dodgeCd - this.time)),
    };
  }

  roster() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, cls: p.cls }));
  }
}
