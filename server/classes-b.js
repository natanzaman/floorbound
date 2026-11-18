// Lancer and Bard skills, mixed into Game (installClassesB at the end of game.js). Data and tuning:
// shared/classes/lancer.js and shared/classes/bard.js; client visuals: public/classes-b.js; tests: test/classes-b.js.
//
// Game.useSkill hands every Lancer / Bard skill (base or evolved) to useClassSkillB. Everything else these classes need
// is layered on by wrapping a few existing methods (see installClassesB), so the rest of the game code is untouched:
//  - skillCd:  Anthem's haste (faster basic attacks, faster recharging skills)
//  - dmgMult:  War March's damage aura
//  - addPosture: Discord stacks (more posture damage per stack)
//  - moveMob / f2Move: slows (Dissonance, Hamstring, Lullaby, Feedback)
//  - bookBuffs / absorbHit: mastery credit for Anthem / War March and Crescendo's shields
//  - updateProjectiles: the per-tick upkeep (sonic bolts, songs, buff expiry, Crescendo build-up)
import { POSTURE, angleTo, resolveCollision, paced } from '../shared/data.js';
import { BRANCHES } from '../shared/mastery.js';
import { LANCE } from '../shared/classes/lancer.js';
import { SONG } from '../shared/classes/bard.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
export const CLASSES_B = ['lancer', 'bard'];

const methods = {
  // ---------- dispatch (called from Game.useSkill once cooldown / level checks pass) ----------
  // Returns true when the skill belonged to a Lancer / Bard (handled here, used or not).
  useClassSkillB(p, sk, slot, { S, pow = 1, br = null, cd }) {
    if (!CLASSES_B.includes(p.cls) || (slot === 0 && this.styleOwnsBasic(p))) return false; // Halberd, War Drum: styleSkill
    const ev = br ? BRANCHES[sk.id]?.[br]?.id : null, fn = SKILLS[ev || sk.id];
    if (!fn) return true;
    const c = { S, pow, ev, sk, atk: p.atk * this.dmgMult(p) * pow };
    if (fn.call(this, p, c) !== false) p.cds[slot] = this.time + cd;
    return true;
  },

  cbFx(p, ev, extra = {}) { this.events.push({ t: 'fx', k: 'cb', ev, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), ...extra }); },
  cbAlive(p) { return !p.dead && this.players.has(p.id); },

  // ---------- Lancer helpers ----------
  // Enemies in a narrow line in front of p, up to `reach` from p to their near edge. The spear tip (near edge 2.4 m+
  // away) deals +30% (Glaive: 3.4 m+, +50%; Honed Tip talent: +10% per rank). Returns the ids hit at the tip.
  spearLine(p, reach, width, amount, opts, L = LANCE) {
    const dx = Math.sin(p.face), dz = Math.cos(p.face), tip = [];
    const sweetMult = L.sweetMult + 0.1 * (p.tal?.keys.honedtip || 0);
    for (const m of [...this.mobs.values()]) {
      if (!this.targetable(m)) continue;
      const vx = m.x - p.x, vz = m.z - p.z, along = vx * dx + vz * dz, perp = Math.abs(vx * dz - vz * dx);
      if (along < -0.3 || along - m.def.radius > reach || perp > width + m.def.radius) continue;
      const sweet = along - m.def.radius >= L.sweetFrom;
      if (sweet) tip.push(m.id);
      this.damageMob(m, p, amount * (sweet ? sweetMult : 1), opts);
    }
    return tip;
  },
  // How far p can dash along its facing (0.5 m steps): stops before anything unwalkable (walls, a closed gate)
  // and short of trees, rocks and houses.
  lanceDash(p, len, face = p.face) {
    let tx = p.x, tz = p.z;
    for (let i = 1; i <= Math.round(len / 0.5); i++) {
      const nx = p.x + Math.sin(face) * i * 0.5, nz = p.z + Math.cos(face) * i * 0.5;
      if (!this.walk(nx, nz)) break;
      const [cx, cz] = resolveCollision(nx, nz);
      if (Math.hypot(cx - nx, cz - nz) > 0.05) break;
      tx = nx; tz = nz;
    }
    return [tx, tz];
  },
  // Sky Lance landing spot: the near edge of the closest enemy in front (within range), else `fwd` m ahead.
  // A leap clears trees but not walls or a closed gate: the spot is pulled back until the whole flight is walkable.
  skySpot(p, range, fwd) {
    const m = this.pickFront(p, range, 0.55);
    let a = p.face, d = fwd;
    if (m) { a = angleTo(p.x, p.z, m.x, m.z); d = Math.max(0, dist(p, m) - m.def.radius - 0.6); }
    let lx = p.x, lz = p.z;
    for (let i = 1; i <= Math.round(d / 0.5); i++) {
      const nx = p.x + Math.sin(a) * i * 0.5, nz = p.z + Math.cos(a) * i * 0.5;
      if (!this.walk(nx, nz)) break;
      lx = nx; lz = nz;
    }
    [lx, lz] = resolveCollision(lx, lz);
    if (!this.walk(lx, lz)) { lx = p.x; lz = p.z; }
    return { x: lx, z: lz, m, face: a };
  },
  // Leap: airborne (ground attacks miss, like a jump) until it lands `air` s later.
  skyLeap(p, c, spot, land) {
    const t = this.time, air = paced(LANCE.sky.air);
    p.face = spot.face; p.airFrom = t; p.airUntil = t + air;
    this.cbFx(p, 'skymark', { s: c.S, ev2: c.ev || 'skylance', x2: r2(spot.x), z2: r2(spot.z), d: air, r: c.ev === 'meteor' ? LANCE.meteor.r : c.ev === 'pinning' ? LANCE.pin.r : LANCE.sky.r });
    this.schedule(air, () => {
      if (!this.cbAlive(p)) return;
      this.teleport(p, spot.x, spot.z);
      land();
    });
  },
  slowMob(m, v, secs) {
    const t = this.time;
    if (m.def.boss) v *= 0.5; // bosses shrug off half of it
    m.slowV = t < (m.slowUntil || 0) ? Math.max(m.slowV || 0, v) : v;
    m.slowUntil = Math.max(m.slowUntil || 0, t + secs);
  },
  slowMult(m) { return this.time < (m.slowUntil || 0) ? 1 - (m.slowV || 0) : 1; },

  // ---------- Bard helpers ----------
  addDiscord(m, p, n = 1) {
    if (!m || m.dead) return;
    const t = this.time, D = SONG.discord, had = t < (m.discord?.until || 0) ? m.discord.n : 0;
    m.discord = { n: Math.min(D.max, had + n), until: t + D.dur, by: p.id };
    this.events.push({ t: 'fx', k: 'cb', ev: 'discord', m: m.id, n: m.discord.n, d: D.dur });
  },
  discordOf(m) { return this.time < (m.discord?.until || 0) ? m.discord.n : 0; },
  clearDiscord(m) { if (m.discord) { m.discord = null; this.events.push({ t: 'fx', k: 'cb', ev: 'discord', m: m.id, n: 0 }); } },
  // Anthem's haste: x0.8 on the basic attack, x0.85 on other skills.
  hasteB(p, slot) {
    if (this.time >= (p.anthem?.until || 0)) return 1;
    return 1 - (slot === 0 ? SONG.anthem.haste : SONG.anthem.skillHaste) * (p.anthem.pow || 1);
  },
  // A cone (or a full circle with half = PI) of sound from p. Interrupts wind-ups, adds Discord, optionally slows.
  chord(p, c, { r, half, mult, stacks = 1, slow = 0, slowFor = 0, knock = 0 }) {
    let n = 0;
    for (const m of [...this.mobs.values()]) {
      if (!this.targetable(m) || !this.inArc(p, m, r, half)) continue;
      const winding = !!(m.windupAt > 0 || m.sweepPending);
      n++;
      this.addDiscord(m, p, stacks);
      if (slow) this.slowMob(m, slow, slowFor);
      this.damageMob(m, p, c.atk * mult, { sk: c.S, interrupt: winding, knock, threat: 1.2 });
      if (winding) this.events.push({ t: 'fx', k: 'cb', ev: 'interrupt', m: m.id, id: p.id });
    }
    return n;
  },
  // Party song (Anthem / War March / Lullaby): an aura around the bard for its duration.
  songTick(p) {
    const s = p.song, t = this.time;
    if (!s) return;
    if (t >= s.until || !this.cbAlive(p)) { p.song = null; this.cbFx(p, 'songEnd', { kind: s.kind }); return; }
    if (t < s.next) return;
    s.next = t + SONG.anthem.tick;
    if (s.kind === 'lullaby') {
      const L = SONG.lullaby, stack = t >= s.stackT;
      if (stack) s.stackT = t + L.every;
      for (const m of [...this.mobs.values()]) {
        if (!this.targetable(m) || dist(m, p) > L.r + m.def.radius) continue;
        this.slowMob(m, L.slow * s.pow, 1);
        if (stack) {
          this.addDiscord(m, p, 1);
          if (m.threat.size) this.masteryGain(p, s.S, 0.4); // an enemy in the fight held down by the song
        }
      }
      return;
    }
    const key = s.kind === 'warmarch' ? 'march' : 'anthem';
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > SONG.anthem.r) continue;
      const had = t < (o[key]?.until || 0) && o[key].by === p.id;
      o[key] = { until: Math.min(s.until, t + SONG.anthem.tick + 0.5), by: p.id, sk: s.S, pow: s.pow, v: key === 'march' ? SONG.warmarch.dmg * s.pow : SONG.anthem.speed };
      if (!had) this.events.push({ t: 'buff', id: o.id, k: key, d: r2(s.until - t), by: p.id });
    }
  },
  // Crescendo burst (after its build-up): kind 'crescendo' | 'finale' | 'encore'.
  crescBurst(p, kind, c) {
    p.cresc = null;
    if (!this.cbAlive(p)) return;
    const t = this.time, C = { ...SONG.crescendo, ...(kind === 'finale' ? SONG.finale : kind === 'encore' ? SONG.encore : {}) };
    this.cbFx(p, 'crescBurst', { kind, r: C.r, er: kind === 'encore' ? 0 : C.er });
    if (kind !== 'finale') { // the party: shield + damage buff (+ a heal for Encore)
      for (const o of this.players.values()) {
        if (o.dead || dist(o, p) > C.r) continue;
        const hp = Math.round(o.maxHp * C.shield * c.pow);
        if (!(o.shield && t < o.shield.until && o.shield.hp > hp)) o.shield = { hp, max: hp, until: t + C.dur, by: p.id, sk: c.S, k: 'cresc' }; // k: its own HUD label
        const v = C.dmg * c.pow;
        if (!(t < o.dmg.until && o.dmg.v > v)) o.dmg = { until: t + C.dur, v, by: p.id, sk: c.S, cresc: true }; // (not Blessed: own HUD bit)
        if (kind === 'encore') this.healPlayer(o, o.maxHp * C.heal * c.pow, p, c.S);
        this.events.push({ t: 'buff', id: o.id, k: 'cresc', d: C.dur, by: p.id });
      }
    }
    if (kind === 'encore') return;
    for (const m of [...this.mobs.values()]) { // enemies: damage, and a BREAK when they carry enough Discord
      if (!this.targetable(m) || dist(m, p) > C.er + m.def.radius) continue;
      const n = this.discordOf(m), bi = m.def.boss ? 1 : 0;
      this.damageMob(m, p, c.atk * C.mult, { sk: c.S, heavy: true, threat: 1.5 });
      if (m.dead || !this.mobs.has(m.id)) continue;
      if (n >= C.need[bi] && t >= m.staggerUntil) { m.posture = 0; this.breakMob(m, p, false, c.S); }
      else if (n) this.addPosture(m, p, 0, { frac: bi ? [0, C.frac[1] * n] : [C.frac[0] * n, 0], sk: c.S });
      this.clearDiscord(m);
    }
  },

  // ---------- per tick (via updateProjectiles) ----------
  updateClassesB(dt) {
    const t = this.time;
    // sonic bolts
    if (this.cbShots?.length) {
      for (const pr of this.cbShots) {
        const owner = this.players.get(pr.by);
        if (!owner) { pr.ttl = 0; continue; }
        for (let k = 0; k < 2 && pr.ttl > 0; k++) { // two half-steps so a fast bolt can't skip past a small enemy
          pr.x += pr.vx * dt / 2; pr.z += pr.vz * dt / 2; pr.ttl -= dt / 2;
          const [cx, cz] = resolveCollision(pr.x, pr.z, 0.1);
          if (cx !== pr.x || cz !== pr.z || !this.walk(pr.x, pr.z)) { pr.ttl = 0; break; } // a tree, rock or wall
          for (const m of this.mobs.values()) {
            if (!this.targetable(m) || Math.hypot(m.x - pr.x, m.z - pr.z) > (pr.rad ?? SONG.bolt.radius) + m.def.radius) continue;
            this.addDiscord(m, owner, this.styleDiscordN(owner)); // (Flute: every second hit adds 2)
            this.damageMob(m, owner, pr.amount, { threat: 1, tsk: 'sonic' }); // tsk: talents count it as the basic attack
            pr.ttl = 0; pr.hit = m.id;
            break;
          }
        }
        if (pr.ttl <= 0) this.events.push({ t: 'fx', k: 'cb', ev: 'sonicEnd', pid: pr.id, id: pr.by, x: r2(pr.x), z: r2(pr.z), m: pr.hit || 0 });
      }
      this.cbShots = this.cbShots.filter(pr => pr.ttl > 0);
    }
    for (const p of this.players.values()) {
      if (p.song) this.songTick(p);
      for (const key of ['anthem', 'march']) {
        if (p[key] && (t >= p[key].until || p.dead)) { p[key] = null; this.events.push({ t: 'buff', id: p.id, k: key, end: 1 }); }
      }
      if (p.cresc && (p.dead || !this.players.has(p.id))) p.cresc = null;
    }
  },
};

// ---------- the skills (this = the Game; c = { S, pow, ev, sk, atk }) ----------
const SKILLS = {
  // ----- Lancer -----
  lthrust(p, c) {
    const t = this.time, sty = this.styleNum(p, 'thrust', null), L = sty ? { ...LANCE, ...sty } : LANCE; // Glaive (shared/styles.js)
    p.combo = t - p.lastBasic < 1.0 ? (p.combo + 1) % 3 : 0;
    p.lastBasic = t;
    const fin = p.combo === 2, reach = fin ? L.finReach : L.reach;
    const tip = this.spearLine(p, reach, L.width, c.atk * (fin ? L.finMult : L.mult), { knock: fin ? 1.2 : 0.3, heavy: fin }, L);
    this.cbFx(p, 'thrust', { s: 'lthrust', n: p.combo, r: reach, tip, sty: sty ? p.style : undefined });
  },
  lcharge(p, c) {
    const x0 = p.x, z0 = p.z, [tx, tz] = this.lanceDash(p, LANCE.charge.len * this.styleNum(p, 'chargeLen', 1)); // Glaive: longer
    this.cbFx(p, 'charge', { s: c.S, x2: r2(tx), z2: r2(tz) });
    this.hitLine(p, x0, z0, tx, tz, LANCE.charge.width, c.atk * LANCE.charge.mult, { knock: LANCE.charge.knock, sk: c.S });
    this.teleport(p, tx, tz);
  },
  lsweep(p, c) {
    const W = LANCE.sweep, R = W.r * this.styleNum(p, 'sweepR', 1); // Halberd: wider
    this.cbFx(p, 'sweep', { s: c.S, r: r2(R) });
    this.hitCircle(p, p.x, p.z, R, c.atk * W.mult, { stun: W.stun, heavy: true, frac: W.frac, knock: 0.3, sk: c.S });
  },
  skylance(p, c) {
    const S = LANCE.sky, spot = this.skySpot(p, S.range, S.fwd);
    this.skyLeap(p, c, spot, () => {
      this.cbFx(p, 'skyland', { r: S.r });
      this.hitCircle(p, spot.x, spot.z, S.r, c.atk * S.mult, { brk: true, heavy: true, stun: S.stun, knock: 1, threat: 1.5, sk: c.S });
    });
  },
  // Lancer evolutions
  comet(p, c) { // longer charge, ends in a posture shockwave
    const C = LANCE.comet, x0 = p.x, z0 = p.z, [tx, tz] = this.lanceDash(p, C.len);
    this.cbFx(p, 'comet', { s: c.S, x2: r2(tx), z2: r2(tz), r: C.r });
    this.hitLine(p, x0, z0, tx, tz, LANCE.charge.width, c.atk * C.mult, { knock: 0.6, sk: c.S });
    this.teleport(p, tx, tz);
    this.hitCircle(p, tx, tz, C.r, c.atk * C.waveMult, { heavy: true, frac: C.frac, knock: 1.2, sk: c.S });
  },
  hitrun(p, c) { // short hard charge, then spring back
    const H = LANCE.hitrun, x0 = p.x, z0 = p.z, [tx, tz] = this.lanceDash(p, H.len);
    this.cbFx(p, 'hitrun', { s: c.S, x2: r2(tx), z2: r2(tz) });
    this.hitLine(p, x0, z0, tx, tz, LANCE.charge.width, c.atk * H.mult, { knock: 0.8, heavy: true, sk: c.S });
    this.teleport(p, tx, tz);
    this.schedule(paced(H.back), () => {
      if (!this.cbAlive(p)) return;
      this.cbFx(p, 'hitrunBack', { x2: r2(x0), z2: r2(z0) });
      this.teleport(p, x0, z0);
    });
  },
  cyclone(p, c) { // two wide spins, no stagger
    const C = LANCE.cyclone;
    for (let i = 0; i < C.spins; i++) {
      this.schedule(i * paced(C.gap), () => {
        if (!this.cbAlive(p)) return;
        this.cbFx(p, 'cyclone', { s: i ? undefined : c.S, n: i, r: C.r });
        this.hitCircle(p, p.x, p.z, C.r, p.atk * this.dmgMult(p) * c.pow * C.mult, { knock: 0.4, sk: c.S });
      });
    }
  },
  hamstring(p, c) { // a frontal half-circle: knocked down longer, slowed, more posture
    const H = LANCE.hamstring;
    this.cbFx(p, 'hamstring', { s: c.S, r: H.r });
    for (const m of [...this.mobs.values()]) {
      if (!this.targetable(m) || !this.inArc(p, m, H.r, H.half)) continue;
      this.slowMob(m, H.slow, H.slowFor);
      this.damageMob(m, p, c.atk * H.mult, { stun: H.stun, heavy: true, frac: H.frac, sk: c.S });
    }
  },
  meteor(p, c) { // wider, harder crash, no Break chunk
    const M = LANCE.meteor, spot = this.skySpot(p, LANCE.sky.range, LANCE.sky.fwd);
    this.skyLeap(p, c, spot, () => {
      this.cbFx(p, 'meteorLand', { r: M.r });
      this.hitCircle(p, spot.x, spot.z, M.r, c.atk * M.mult, { stun: M.stun, knock: 1.5, threat: 1.5, sk: c.S });
    });
  },
  pinning(p, c) { // land on one enemy and pin it: instant Break on normal enemies, a big chunk on a boss
    const P = LANCE.pin, spot = this.skySpot(p, LANCE.sky.range, LANCE.sky.fwd);
    this.skyLeap(p, c, spot, () => {
      let m = spot.m && this.targetable(spot.m) && dist(spot.m, spot) <= spot.m.def.radius + 2.5 ? spot.m : null;
      if (!m) { let bd = Infinity; for (const o of this.mobs.values()) { const d = dist(o, spot); if (this.targetable(o) && d <= P.r + o.def.radius && d < bd) { bd = d; m = o; } } }
      this.cbFx(p, 'pinLand', { r: P.r, m: m?.id || 0 });
      if (m) this.damageMob(m, p, c.atk * P.mult, { heavy: true, frac: P.frac, stun: m.def.boss ? 0 : P.root, threat: 2, sk: c.S });
    });
  },

  // ----- Bard -----
  sonic(p, c) {
    const sty = this.styleNum(p, 'bolt', null), B = sty ? { ...SONG.bolt, ...sty } : SONG.bolt, dx = Math.sin(p.face), dz = Math.cos(p.face); // Flute
    const pr = { id: this.id(), by: p.id, x: p.x + dx * 0.7, z: p.z + dz * 0.7, vx: dx * B.speed, vz: dz * B.speed, ttl: B.range / B.speed, amount: c.atk * B.mult, rad: B.radius };
    (this.cbShots ||= []).push(pr);
    p.lastCombat = this.time;
    this.cbFx(p, 'sonic', { s: 'sonic', pid: pr.id, x: r2(pr.x), z: r2(pr.z), vx: r2(pr.vx), vz: r2(pr.vz), ttl: r2(pr.ttl), sty: sty ? p.style : undefined });
  },
  anthem(p, c) { this.startSong(p, c, 'anthem'); },
  warmarch(p, c) { this.startSong(p, c, 'warmarch'); },
  lullaby(p, c) { this.startSong(p, c, 'lullaby'); },
  dissonance(p, c) {
    const D = SONG.dissonance, half = D.half * this.styleNum(p, 'chordHalf', 1); // Flute: a wider cone
    this.cbFx(p, 'dissonance', { s: c.S, r: D.r, h: r2(half) });
    this.chord(p, c, { r: D.r, half, mult: D.mult, slow: D.slow, slowFor: D.slowFor });
  },
  shatter(p, c) {
    const D = SONG.shatter, half = D.half * this.styleNum(p, 'chordHalf', 1);
    this.cbFx(p, 'shatter', { s: c.S, r: D.r, h: r2(half) });
    this.chord(p, c, { r: D.r, half, mult: D.mult, stacks: D.stacks });
  },
  feedback(p, c) {
    const D = SONG.feedback;
    this.cbFx(p, 'feedback', { s: c.S, r: D.r });
    this.chord(p, c, { r: D.r, half: Math.PI, mult: D.mult, knock: D.knock, slow: D.slow, slowFor: D.slowFor });
  },
  crescendo(p, c) { this.startCresc(p, c, 'crescendo'); },
  finale(p, c) { this.startCresc(p, c, 'finale'); },
  encore(p, c) { this.startCresc(p, c, 'encore'); },
};

Object.assign(methods, {
  startSong(p, c, kind) {
    const t = this.time, d = SONG.anthem.dur * this.styleNum(p, 'songDur', 1); // War Drum: longer songs
    p.song = { kind, until: t + d, next: t, stackT: t, S: c.S, pow: c.pow };
    this.cbFx(p, 'song', { s: c.S, kind, d, r: kind === 'lullaby' ? SONG.lullaby.r : SONG.anthem.r });
    this.songTick(p);
  },
  startCresc(p, c, kind) {
    const C = { ...SONG.crescendo, ...(kind === 'finale' ? SONG.finale : kind === 'encore' ? SONG.encore : {}) };
    const tok = (p.crescTok || 0) + 1;
    p.crescTok = tok; p.cresc = { kind, until: this.time + C.build };
    this.cbFx(p, 'cresc', { s: c.S, kind, d: C.build, r: kind === 'encore' ? C.r : C.er });
    this.schedule(C.build, () => {
      if (p.crescTok !== tok || !p.cresc) { this.cbFx(p, 'crescFizzle', {}); return; } // the bard went down mid-song
      this.crescBurst(p, kind, { ...c, atk: p.atk * this.dmgMult(p) * c.pow });
    });
  },
});

// Wrap an existing Game method: wrap(proto, 'name', orig => function (...a) { ... }).
function wrap(proto, name, make) {
  const orig = proto[name];
  if (typeof orig !== 'function') throw new Error(`classes-b: Game.${name} is missing`);
  proto[name] = make(orig);
}

export function installClassesB(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  wrap(P, 'skillCd', orig => function (p, sk, slot) { return orig.call(this, p, sk, slot) * this.hasteB(p, slot); });
  wrap(P, 'dmgMult', orig => function (p) { return orig.call(this, p) * (this.time < (p.march?.until || 0) ? 1 + p.march.v : 1); });
  wrap(P, 'moveMob', orig => function (m, tx, tz, speed, ...rest) { return orig.call(this, m, tx, tz, speed * this.slowMult(m), ...rest); });
  wrap(P, 'f2Move', orig => function (m, tx, tz, speed, ...rest) { return orig.call(this, m, tx, tz, speed * this.slowMult(m), ...rest); });
  // Discord: every stack adds 10% to all posture the enemy takes (damage-based and the flat chunks alike).
  wrap(P, 'addPosture', orig => function (m, p, amount, opts = {}) {
    const n = m && !m.dead ? this.discordOf(m) : 0;
    if (!n) return orig.call(this, m, p, amount, opts);
    const k = n * SONG.discord.posture, bi = m.def.boss ? 1 : 0;
    const chunks = (opts.brk ? POSTURE.brk[bi] : 0) + (opts.interrupt ? POSTURE.smite[bi] : 0) + (opts.chunk ? POSTURE[opts.chunk][bi] : 0) + (opts.frac ? opts.frac[bi] : 0);
    const f = (opts.frac ? opts.frac[bi] : 0) + chunks * k;
    return orig.call(this, m, p, amount * (1 + k), { ...opts, frac: f ? (bi ? [0, f] : [f, 0]) : null });
  });
  // Anthem / War March mastery: the extra damage allies deal while the song is on them.
  wrap(P, 'bookBuffs', orig => function (p, dealt) {
    orig.call(this, p, dealt);
    const t = this.time;
    if (t < (p.anthem?.until || 0)) this.creditBy(p.anthem.by, p.anthem.sk, dealt * SONG.anthem.credit, 'buff');
    if (t < (p.march?.until || 0)) this.creditBy(p.march.by, p.march.sk, (dealt * p.march.v) / this.dmgMult(p), 'buff');
  });
  // Crescendo shields: credit the bard for what they soak.
  wrap(P, 'absorbHit', orig => function (p, amount) {
    const s = p.shield, left = orig.call(this, p, amount);
    if (s?.sk && amount > left) this.creditBy(s.by, s.sk, amount - left, 'prevent');
    return left;
  });
  wrap(P, 'updateProjectiles', orig => function (dt) { orig.call(this, dt); this.updateClassesB(dt); });
}
