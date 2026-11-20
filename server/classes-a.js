// Ranger and Berserker, mixed into Game (see the end of game.js). Class data and tuning: shared/classes/.
//  - classSkillA(): useSkill hands every Ranger / Berserker skill (basic attack, the three skills and their six
//    evolutions each) to this file; the cooldown is set here too (Bloodrage speeds up the basic attack).
//  - Player projectiles (arrows): real travel time, hit the first enemy in the path (Piercing Shot: all of them),
//    gentle homing toward the target picked when fired, weaker at point-blank range.
//  - Ground traps (caltrops slow, Snare Trap roots), Hunter's Mark (party damage + stronger Switches on the target),
//    Rage (built by dealing and taking damage, decays out of combat; broadcast as 'rageA' events) and Bloodrage.
// Hooks in game.js: useSkill (dispatch), damageMob (hitMultA / afterHitA), damagePlayer (hurtModA / onHurtA),
// update (updateClassesA), moveMob + server/floor2.js f2Move (mobSlowA).
import { angleTo, wrapAngle, resolveCollision, paced } from '../shared/data.js';
import { MASTERY, BRANCHES } from '../shared/mastery.js';
import { RANGER_TUNE as RT } from '../shared/classes/ranger.js';
import { RAGE, BERSERKER_TUNE as BT } from '../shared/classes/berserker.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Distance from (px, pz) to the segment (x0, z0)-(x1, z1), and how far along it [0..1] the closest point is.
function segDist(px, pz, x0, z0, x1, z1) {
  const lx = x1 - x0, lz = z1 - z0, len2 = lx * lx + lz * lz;
  const k = len2 > 1e-9 ? clamp(((px - x0) * lx + (pz - z0) * lz) / len2, 0, 1) : 0;
  return [Math.hypot(px - (x0 + lx * k), pz - (z0 + lz * k)), k];
}
export const CLASSES_A = new Set(['ranger', 'berserker']);

// Each skill / evolution: (game, player, c) -> false to refuse (no cooldown), a number to scale the cooldown, or nothing.
// c = { S: skill credited with mastery, pow: Mastery 4 bonus, atk: attack x buffs x pow, t: now, alive(), atkNow() }
const SKILLS = {
  // ---------- Ranger ----------
  shot(g, p, c) {
    const A = { ...RT.arrow, ...g.styleNum(p, 'arrow', null) }; // weapon styles (shared/styles.js): Crossbow
    p.combo = c.t - p.lastBasic < A.combo ? (p.combo + 1) % 3 : 0;
    p.lastBasic = c.t;
    const fin = p.combo === 2, tg = g.aimA(p, A.range, A.cone);
    if (tg) p.face = angleTo(p.x, p.z, tg.x, tg.z);
    g.fxA(p, 'shot', { s: 'shot', n: p.combo, fin: fin ? 1 : 0, sty: g.styleNum(p, 'arrow', null) ? p.style : undefined });
    g.fireArrowA(p, { tg, sp: A.speed, pierceN: A.pierceN, dmg: c.atk * A.mult[p.combo], k: fin ? A.kFin || 'heavy' : A.k || 'shot', opts: { heavy: fin, threat: 1 } });
  },
  pierce(g, p, c) {
    const P = RT.pierce, draw = paced(P.draw) * g.styleNum(p, 'drawMul', 1); // Crossbow: a faster draw
    g.fxA(p, 'draw', { s: 'pierce', d: r2(draw), r: P.range });
    g.schedule(draw, () => {
      if (!c.alive()) return;
      const tg = g.aimA(p, P.range, 0.3);
      if (tg) p.face = angleTo(p.x, p.z, tg.x, tg.z);
      g.fxA(p, 'loose', { r: P.range });
      g.fireArrowA(p, { sp: P.speed, range: P.range, rad: P.radius, pierce: true, k: 'pierce', dmg: c.atkNow() * P.mult, opts: { sk: c.S, heavy: true, frac: P.frac, knock: 0.8 } });
    });
  },
  rainofarrows(g, p, c) {
    const R = RT.rain, delay = paced(R.delay), every = paced(R.every), tg = g.aimA(p, R.range, 0.5);
    const cx = tg ? tg.x : p.x + Math.sin(p.face) * R.ahead, cz = tg ? tg.z : p.z + Math.cos(p.face) * R.ahead;
    if (tg) p.face = angleTo(p.x, p.z, tg.x, tg.z);
    g.fxA(p, 'rain', { s: 'pierce', x2: r2(cx), z2: r2(cz), r: R.r, d: r2(delay + R.ticks * every) });
    for (let i = 0; i < R.ticks; i++) {
      g.effectLater(delay + i * every, () => { // the rain lingers after the volley: not use time (server/pacing.js)
        if (!c.alive()) return;
        g.hitCircle(p, cx, cz, R.r, c.atkNow() * R.mult, { sk: c.S, frac: R.frac, threat: 0.6 });
      });
    }
  },
  snipershot(g, p, c) {
    const N = RT.sniper, draw = paced(N.draw) * g.styleNum(p, 'drawMul', 1);
    g.fxA(p, 'draw', { s: 'pierce', d: r2(draw), r: N.range, big: 1 });
    g.schedule(draw, () => {
      if (!c.alive()) return;
      const tg = g.aimA(p, N.range, 0.3);
      if (tg) p.face = angleTo(p.x, p.z, tg.x, tg.z);
      g.fxA(p, 'loose', { r: N.range, big: 1 });
      g.fireArrowA(p, { tg, sp: N.speed, range: N.range, rad: 0.45, k: 'sniper', dmg: c.atkNow() * N.mult, opts: { sk: c.S, heavy: true, frac: N.frac, knock: 1.5, threat: 1.5 } });
    });
  },
  disengage(g, p, c) {
    const D = RT.disengage, T = D.trap, x0 = p.x, z0 = p.z;
    const [ex, ez] = g.lineEndA(p, p.face + Math.PI, D.dist);
    g.trapsA().push({ kind: 'caltrops', x: x0, z: z0, r: T.r, until: c.t + T.dur, next: c.t, owner: p.id, sk: c.S, dmg: c.atk * T.dmg, slow: T.slow, bossSlow: T.bossSlow });
    g.fxA(p, 'disengage', { s: 'disengage', x0: r2(x0), z0: r2(z0), x2: r2(ex), z2: r2(ez), r: T.r, d: T.dur });
    g.teleport(p, ex, ez);
    const tg = g.aimA(p, RT.arrow.range + 6, 0.5);
    if (tg) p.face = angleTo(p.x, p.z, tg.x, tg.z);
    g.fireArrowA(p, { tg, dmg: c.atk * D.mult, k: 'shot', opts: { sk: c.S } });
  },
  snaretrap(g, p, c) {
    const N = RT.snare, x0 = p.x, z0 = p.z;
    const [ex, ez] = g.lineEndA(p, p.face + Math.PI, N.hop);
    g.trapsA().push({ kind: 'snare', x: x0, z: z0, r: N.r, until: c.t + N.dur, armAt: c.t + N.arm, owner: p.id, sk: c.S, dmg: c.atk * N.mult });
    g.fxA(p, 'snare', { s: 'disengage', x0: r2(x0), z0: r2(z0), x2: r2(ex), z2: r2(ez), r: N.r, d: N.dur });
    g.teleport(p, ex, ez);
  },
  tumblevolley(g, p, c) {
    const V = RT.tumble;
    const [ex, ez] = g.lineEndA(p, p.face + Math.PI, V.dist);
    g.fxA(p, 'tumble', { s: 'disengage', x0: r2(p.x), z0: r2(p.z), x2: r2(ex), z2: r2(ez) });
    g.teleport(p, ex, ez);
    const tg = g.aimA(p, RT.arrow.range + 6, 0.5);
    if (tg) p.face = angleTo(p.x, p.z, tg.x, tg.z);
    for (let i = 0; i < V.n; i++) g.fireArrowA(p, { a: p.face + (i - (V.n - 1) / 2) * V.spread, dmg: c.atk * V.mult, k: 'shot', opts: { sk: c.S } });
  },
  mark(g, p, c) {
    const M = RT.mark, tg = g.markPickA(p, M.range);
    if (!tg) { g.sys('No enemy in sight to mark.', p.id); return false; }
    p.face = angleTo(p.x, p.z, tg.x, tg.z);
    g.fxA(p, 'mark', { s: 'mark', m: tg.id, x2: r2(tg.x), z2: r2(tg.z) });
    g.markA(p, tg, '', M.dur, M.bonus * c.pow, M.sw);
  },
  packhunter(g, p, c) {
    const K = RT.pack, tg = g.markPickA(p, RT.mark.range);
    if (!tg) { g.sys('No enemy in sight to mark.', p.id); return false; }
    p.face = angleTo(p.x, p.z, tg.x, tg.z);
    const others = [...g.mobs.values()].filter(m => m !== tg && g.targetable(m) && dist(m, tg) <= K.r).sort((a, b) => dist(a, tg) - dist(b, tg)).slice(0, K.n - 1);
    g.fxA(p, 'mark', { s: 'mark', m: tg.id, x2: r2(tg.x), z2: r2(tg.z), pack: 1 });
    for (const m of [tg, ...others]) g.markA(p, m, 'pack', K.dur, K.bonus * c.pow, K.sw);
  },
  deadeye(g, p, c) {
    const E = RT.deadeye, tg = g.markPickA(p, RT.mark.range);
    if (!tg) { g.sys('No enemy in sight to mark.', p.id); return false; }
    p.face = angleTo(p.x, p.z, tg.x, tg.z);
    g.fxA(p, 'mark', { s: 'mark', m: tg.id, x2: r2(tg.x), z2: r2(tg.z), dead: 1 });
    g.markA(p, tg, 'deadeye', E.dur, 0, 1, E.self * c.pow);
  },

  // ---------- Berserker ----------
  chop(g, p, c) {
    const C = { ...BT.chop, ...g.styleNum(p, 'chop', null) }; // weapon styles (shared/styles.js): Twin Axes, Warhammer
    p.combo = c.t - p.lastBasic < C.combo ? (p.combo + 1) % 3 : 0;
    p.lastBasic = c.t;
    const fin = p.combo === 2, ring = fin && C.fin.ring;
    g.fxA(p, 'chop', { s: 'chop', n: p.combo, r: ring || C.r, fin: fin ? 1 : 0, sty: g.styleNum(p, 'chop', null) ? p.style : undefined });
    const opts = { heavy: C.heavy ? C.heavy[p.combo] : true, knock: fin ? C.fin.knock : 0.3, frac: fin ? C.fin.frac : C.frac || null };
    if (ring) g.hitCircle(p, p.x, p.z, ring, c.atk * C.mult[p.combo], opts); // Warhammer: the third blow smashes all around
    else { const A = g.atkFov(p, fin ? 'chopFin' : 'chop', { r: C.r, half: C.half }); g.hitArc(p, A.r, A.half, c.atk * C.mult[p.combo], { ...opts, atk: A }); }
    return g.raging(p) ? p.brA.haste : 1; // Bloodrage / Frenzy: faster swings
  },
  cleave(g, p, c) {
    const C = BT.cleave, rage = p.rage || 0, twin = g.styleNum(p, 'cleaveTwin', 0); // Twin Axes: a second sweep
    const A = g.atkFov(p, 'cleave', { r: C.r, half: C.half });
    g.fxA(p, 'cleave', { s: 'cleave', r: A.r, h: r2(A.half), rage: Math.round(rage) });
    g.hitArc(p, A.r, A.half, c.atk * (C.mult + (C.rage * rage) / 100), { sk: c.S, heavy: true, knock: 1.2, atk: A });
    if (twin) g.schedule(paced(0.22), () => {
      if (!c.alive()) return;
      g.fxA(p, 'cleave', { r: A.r, h: r2(A.half), rage: Math.round(p.rage || 0), tw: 1 });
      g.hitArc(p, A.r, A.half, c.atkNow() * twin * (C.mult + (C.rage * (p.rage || 0)) / 100), { sk: c.S, heavy: true, knock: 0.6, atk: A });
    });
  },
  whirlingaxe(g, p, c) {
    const W = BT.whirlaxe;
    for (let i = 0; i < W.hits; i++) {
      g.schedule(i * paced(W.gap), () => {
        if (!c.alive()) return;
        g.fxA(p, 'whirl', { s: i ? undefined : 'cleave', n: i, r: W.r });
        g.hitCircle(p, p.x, p.z, W.r, c.atkNow() * (W.mult + (W.rage * (p.rage || 0)) / 100), { sk: c.S, heavy: i === W.hits - 1, knock: 0.6 });
      });
    }
  },
  executioner(g, p, c) {
    const X = BT.executioner, rage = p.rage || 0, A = g.atkFov(p, 'executioner', { r: X.r, half: X.half });
    p.rage = Math.max(0, rage - X.cost);
    g.fxA(p, 'execute', { s: 'cleave', r: A.r, h: r2(A.half) });
    for (const m of g.arcTargets(p, A.r, A.half, A)) {
      const low = m.hp / m.maxHp < X.low;
      g.damageMob(m, p, c.atk * (X.mult + (X.rage * rage) / 100) * (low ? X.lowMult : 1), { sk: c.S, heavy: true, knock: 1.5 });
    }
  },
  leap(g, p, c) { return g.leapA(p, c, BT.leap, {}); },
  earthshatter(g, p, c) { return g.leapA(p, c, { ...BT.leap, ...BT.earthshatter }, { brk: true }); },
  pounce(g, p, c) {
    const P = BT.pounce, tg = g.aimA(p, P.range, 0.6) || g.pickFront(p, P.range, 0.9);
    if (!tg) { g.sys('Nothing in reach to pounce on.', p.id); return false; }
    const a = angleTo(p.x, p.z, tg.x, tg.z);
    const [lx, lz] = g.lineEndA(p, a, Math.max(0, dist(p, tg) - tg.def.radius - 0.8));
    p.face = a;
    g.fxA(p, 'pounce', { s: 'leap', x0: r2(p.x), z0: r2(p.z), x2: r2(lx), z2: r2(lz), m: tg.id });
    g.teleport(p, lx, lz);
    g.damageMob(tg, p, c.atk * P.mult, { sk: c.S, heavy: true, frac: P.frac, knock: 1.5, stun: 0.5, threat: 1.5 });
    g.gainRageA(p, P.rage);
  },
  bloodrage(g, p, c) {
    const B = BT.bloodrage, rage = p.rage || 0;
    if (rage < B.min) { g.sys(`Bloodrage needs at least ${B.min} Rage.`, p.id); return false; }
    const dur = B.dur[0] + ((B.dur[1] - B.dur[0]) * rage) / RAGE.max;
    p.rage = 0;
    g.payHpA(p, B.hp);
    p.brA = { until: c.t + dur, ls: B.ls * c.pow, haste: B.haste, cut: true, k: 'bloodrage' };
    g.events.push({ t: 'brA', id: p.id, to: p.id, k: 'bloodrage', d: r2(dur) });
    g.fxA(p, 'roar', { s: 'bloodrage' });
  },
  frenzy(g, p, c) {
    const F = BT.frenzy;
    g.payHpA(p, F.hp);
    p.brA = { until: c.t + F.dur, ls: 0, haste: F.haste, cut: true, k: 'frenzy' };
    g.events.push({ t: 'brA', id: p.id, to: p.id, k: 'frenzy', d: F.dur });
    g.fxA(p, 'roar', { s: 'bloodrage', frenzy: 1 });
  },
  warblood(g, p, c) {
    const W = BT.warblood, rage = p.rage || 0;
    if (rage < W.min) { g.sys(`Warblood needs at least ${W.min} Rage.`, p.id); return false; }
    p.rage = 0;
    g.healPlayer(p, p.maxHp * W.heal * rage * c.pow, p, c.S);
    for (const o of g.allyList(p, W.r)) {
      o.lsA = { until: c.t + W.dur, v: W.ls * c.pow, by: p.id };
      g.events.push({ t: 'brA', id: o.id, to: o.id, k: 'warblood', d: W.dur });
    }
    g.fxA(p, 'warblood', { s: 'bloodrage', r: W.r });
  },
};

export const ClassesAMethods = {
  // ---------- dispatch (from useSkill) ----------
  // Returns true when p is a Ranger / Berserker: the skill was handled here (used or refused).
  classSkillA(p, slot, sk) {
    if (!CLASSES_A.has(p.cls) || (slot === 0 && this.styleOwnsBasic(p))) return false; // Twin Daggers: game.js / styleSkill
    const t = this.time;
    const S = slot > 0 ? sk.id : undefined, pow = slot > 0 ? this.skillPow(p, sk.id) : 1, br = slot > 0 ? this.branchOf(p, sk.id) : null;
    const id = br ? BRANCHES[sk.id][br].id : sk.id, fn = SKILLS[id];
    if (!fn) return true;
    const cd = this.skillCd(p, sk, slot); // mastery, branch, gear haste, Zeal
    const c = { S, pow, t, atk: p.atk * this.dmgMult(p) * pow, alive: () => !p.dead && this.players.has(p.id), atkNow: () => p.atk * this.dmgMult(p) * pow };
    p.cds[slot] = t + cd; // set first (a refused skill puts it back)
    const r = fn(this, p, c);
    if (r === false) p.cds[slot] = 0;
    else if (typeof r === 'number') p.cds[slot] = t + cd * r;
    return true;
  },

  fxA(p, v, extra = {}) {
    this.events.push({ t: 'fx', k: 'ca', v, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), ...extra });
  },

  // Best enemy to shoot at: within range, inside the cone around the facing (wider for big or close enemies).
  // Targeting modes (server/targeting.js): Aimed never auto-aims (none: the shot flies along the aim, no homing);
  // Locked or nearest / Cone: the locked enemy when it's in range and inside the cone (a nearer one off-axis used to win).
  aimA(p, range, cone) {
    if (this.aimedMode?.(p)) return null;
    const lk = this.lockedFor?.(p);
    if (lk) {
      const d = dist(lk, p), ang = Math.abs(wrapAngle(angleTo(p.x, p.z, lk.x, lk.z) - p.face));
      if (d <= range + lk.def.radius && ang <= cone + Math.atan2(lk.def.radius, Math.max(d, 0.5))) return lk;
    }
    let best = null, bs = Infinity;
    for (const m of this.mobs.values()) {
      if (!this.targetable(m)) continue;
      const d = dist(m, p);
      if (d > range + m.def.radius) continue;
      const ang = Math.abs(wrapAngle(angleTo(p.x, p.z, m.x, m.z) - p.face));
      if (ang > cone + Math.atan2(m.def.radius, Math.max(d, 0.5))) continue;
      const s = ang * 4 + d / range;
      if (s < bs) { bs = s; best = m; }
    }
    return best;
  },

  // What a Hunter's Mark lands on: the aimed enemy in range, else anything close in front (pickFront: Cone mode keeps
  // it in the cone). Aimed mode: the first enemy along the aim line, out to the mark's full range.
  markPickA(p, range) { return this.aimedMode?.(p) ? this.aimedPick(p, range) : this.aimA(p, range, 0.6) || this.pickFront(p, 10, Math.PI); },

  // Furthest walkable point up to `len` m from p along angle `a` (stops at walls, trees and a shut gate).
  lineEndA(p, a, len) {
    let tx = p.x, tz = p.z;
    const steps = Math.floor(len / 0.5);
    for (let i = 1; i <= steps; i++) {
      const nx = p.x + Math.sin(a) * i * 0.5, nz = p.z + Math.cos(a) * i * 0.5;
      if (!this.walk(nx, nz)) break;
      [tx, tz] = resolveCollision(nx, nz);
    }
    return [tx, tz];
  },

  // ---------- arrows ----------
  arrowsA() { return (this.arrowList ||= []); },
  // o: { a (angle, default p.face), tg (mob to steer toward), sp, range, rad, dmg, opts (damageMob), pierce, pierceN (extra
  //   enemies it passes through: Crossbow), k (visual) }
  fireArrowA(p, o) {
    const A = RT.arrow;
    if (this.aimedMode?.(p)) o = { ...o, tg: null, rad: (o.rad ?? A.radius) + this.aimPad(p) }; // aimed: straight, no homing, a bigger hitbox
    const ar = {
      id: this.id(), by: p.id, x: p.x, z: p.z, ox: p.x, oz: p.z, a: o.a ?? p.face, tg: o.tg?.id || 0,
      sp: o.sp || A.speed, range: (o.range || A.range) + (o.tg ? o.tg.def.radius : 0), rad: o.rad ?? A.radius, trav: 0,
      dmg: o.dmg, opts: o.opts || {}, pierce: !!o.pierce, left: o.pierceN || 0, hit: new Set(), k: o.k || 'shot',
    };
    this.arrowsA().push(ar);
    this.events.push({ t: 'aproj', id: ar.id, by: p.id, x: r2(ar.x), z: r2(ar.z), a: r2(ar.a), sp: ar.sp, r: r2(ar.range), tg: ar.tg, k: ar.k });
    return ar;
  },

  updateArrowsA(dt) {
    const list = this.arrowList;
    if (!list?.length) return;
    for (const a of list) {
      const p = this.players.get(a.by);
      if (!p) { a.done = true; this.events.push({ t: 'apend', id: a.id, x: r2(a.x), z: r2(a.z) }); continue; }
      if (a.tg) { // steer gently toward the target picked when fired
        const m = this.mobs.get(a.tg);
        if (this.targetable(m)) a.a += clamp(wrapAngle(angleTo(a.x, a.z, m.x, m.z) - a.a), -RT.arrow.homing * dt, RT.arrow.homing * dt);
        else a.tg = 0;
      }
      const step = Math.min(a.sp * dt, a.range - a.trav);
      const x1 = a.x + Math.sin(a.a) * step, z1 = a.z + Math.cos(a.a) * step;
      const hits = [];
      for (const m of this.mobs.values()) {
        if (!this.targetable(m) || a.hit.has(m.id)) continue;
        const [d, k] = segDist(m.x, m.z, a.x, a.z, x1, z1);
        if (d <= m.def.radius + a.rad) hits.push([k, m]);
      }
      hits.sort((u, v) => u[0] - v[0]);
      let hitAt = null;
      for (const [k, m] of hits) {
        a.hit.add(m.id);
        this.arrowHitA(a, p, m);
        if (!a.pierce && !(a.left-- > 0)) { hitAt = k; break; }
      }
      if (hitAt !== null) {
        a.x += (x1 - a.x) * hitAt; a.z += (z1 - a.z) * hitAt; a.done = true;
      } else {
        a.x = x1; a.z = z1; a.trav += step;
        const [cx, cz] = resolveCollision(x1, z1, 0.1);
        if (cx !== x1 || cz !== z1 || !this.walk(x1, z1) || a.trav >= a.range - 1e-6) a.done = true; // a tree, a wall, or out of range
      }
      if (a.done) this.events.push({ t: 'apend', id: a.id, x: r2(a.x), z: r2(a.z), h: hitAt !== null ? 1 : 0 });
    }
    this.arrowList = list.filter(a => !a.done);
  },

  arrowHitA(a, p, m) {
    const [c0, c1, cm] = RT.arrow.close;
    const d = Math.max(0, Math.hypot(m.x - a.ox, m.z - a.oz) - m.def.radius); // point-blank falloff
    let dmg = a.dmg * (d <= c0 ? cm : d >= c1 ? 1 : cm + ((1 - cm) * (d - c0)) / (c1 - c0));
    const mk = m.markA, dead = mk && mk.dead && mk.by === p.id && this.time < mk.until; // Deadeye: always crits, +20%
    if (dead) dmg *= 1 + mk.self;
    const crit = p.crit;
    if (dead || this.styleFirstCrit(p, m)) p.crit = 1; // (Crossbow: the first bolt on a new target)
    this.damageMob(m, p, dmg, a.opts);
    p.crit = crit;
  },

  // ---------- traps (caltrops, snares) ----------
  trapsA() { return (this.trapList ||= []); },
  updateTrapsA() {
    const list = this.trapList;
    if (!list?.length) return;
    const t = this.time;
    for (const tr of list) {
      const owner = this.players.get(tr.owner);
      const inside = [...this.mobs.values()].filter(m => this.targetable(m) && Math.hypot(m.x - tr.x, m.z - tr.z) <= tr.r + m.def.radius);
      if (tr.kind === 'caltrops') {
        for (const m of inside) m.slowA = { until: t + 0.3, v: m.def.boss ? tr.bossSlow : tr.slow };
        if (t >= tr.next) {
          tr.next = t + RT.disengage.trap.tick;
          if (owner) for (const m of inside) { this.damageMob(m, owner, tr.dmg, { sk: tr.sk, threat: 0.5 }); this.masteryGain(owner, tr.sk, 0.15); }
        }
      } else if (tr.kind === 'snare' && t >= tr.armAt && inside.length) {
        const N = RT.snare;
        this.events.push({ t: 'fx', k: 'ca', v: 'snared', id: tr.owner, x: r2(tr.x), z: r2(tr.z), r: tr.r });
        for (const m of inside.slice(0, N.max)) {
          if (!m.def.boss) { m.stunUntil = Math.max(m.stunUntil, t + N.root); m.windupAt = 0; m.rootA = t + N.root; }
          if (owner) this.damageMob(m, owner, tr.dmg, { sk: tr.sk, heavy: true, frac: N.frac, threat: 1.2 });
        }
        tr.until = 0; // sprung
      }
    }
    this.trapList = list.filter(tr => t < tr.until);
  },
  // Movement multiplier for a mob (caltrops). Called from moveMob / f2Move.
  mobSlowA(m) { return this.time < (m.slowA?.until || 0) ? m.slowA.v : 1; },

  // ---------- Hunter's Mark ----------
  markA(p, m, kind, dur, bonus, sw, self = 0) {
    m.markA = { by: p.id, until: this.time + dur, bonus, sw, dead: kind === 'deadeye', self };
    this.events.push({ t: 'markA', id: m.id, by: p.id, d: dur, k: kind });
  },
  // damageMob: extra damage multiplier on this hit (a party mark, and its stronger Switch).
  hitMultA(m, p, sw) {
    const mk = m.markA;
    if (!mk || mk.dead || this.time >= mk.until) return 1;
    return (1 + mk.bonus) * (sw ? mk.sw : 1);
  },
  // damageMob, after the damage: Mark mastery, Rage, lifesteal, Bloodrage cutting through wind-ups.
  afterHitA(m, p, dealt, sw) {
    const t = this.time, mk = m.markA;
    if (mk && !mk.dead && t < mk.until && dealt > 0) {
      this.creditBy(mk.by, 'mark', (dealt * mk.bonus) / (1 + mk.bonus), 'buff');
      if (sw) this.creditBy(mk.by, 'mark', MASTERY.setup);
    }
    if (p.cls === 'berserker' && dealt > 0) {
      this.gainRageA(p, Math.min(RAGE.hitCap, (dealt / Math.max(1, p.atk)) * RAGE.hit));
      if (this.raging(p)) {
        const b = p.brA;
        if (b.ls) this.healPlayer(p, dealt * b.ls, p, 'bloodrage');
        else this.masteryGain(p, 'bloodrage', dealt * 0.3, 'dmg'); // Frenzy: credit the extra swings
        if (b.cut && !m.def.boss && !m.def.elite) m.windupAt = 0;
      }
    }
    if (p.lsA && t < p.lsA.until && dealt > 0) this.healPlayer(p, dealt * p.lsA.v, this.players.get(p.lsA.by) || null, 'bloodrage'); // Warblood
  },

  // ---------- Rage / Bloodrage ----------
  raging(p) { return !!p.brA && this.time < p.brA.until; },
  gainRageA(p, v) {
    if (p.cls !== 'berserker' || !(v > 0)) return;
    p.rage = Math.min(RAGE.max, (p.rage || 0) + v * this.styleNum(p, 'rageGain', 1)); // Twin Axes: +30%
    p.rageAt = this.time;
  },
  payHpA(p, frac) { p.hp = Math.max(1, p.hp - Math.round(p.maxHp * frac)); },
  // damagePlayer: the Berserker's thin armour.
  hurtModA(p, amount) { return p.cls === 'berserker' ? Math.max(1, Math.round(amount * BT.taken)) : amount; },
  onHurtA(p, amount) { if (p.cls === 'berserker') this.gainRageA(p, (amount / p.maxHp) * RAGE.hurt); },

  leapA(p, c, L, { brk = false }) {
    const R = L.r * this.styleNum(p, 'leapR', 1), hitR = R * (this.tRadius?.(p) ?? 1); // Warhammer, talents (the fx radius is scaled by server/talents.js)
    const tg = this.aimA(p, L.range, 0.6) || this.pickFront(p, L.range, 0.9);
    let lx, lz;
    if (tg) { const a = angleTo(p.x, p.z, tg.x, tg.z); p.face = a; [lx, lz] = this.lineEndA(p, a, Math.max(0, dist(p, tg) - tg.def.radius - 0.8)); }
    else [lx, lz] = this.lineEndA(p, p.face, L.ahead);
    const delay = paced(L.delay);
    p.airFrom = c.t; p.airUntil = c.t + delay + 0.05; // airborne: ground slams pass under
    this.fxA(p, 'leap', { s: 'leap', x0: r2(p.x), z0: r2(p.z), x2: r2(lx), z2: r2(lz), r: r2(R), d: delay, big: brk ? 1 : 0 });
    this.schedule(delay, () => {
      if (!c.alive()) return;
      this.teleport(p, lx, lz);
      this.events.push({ t: 'fx', k: 'ca', v: 'slam', id: p.id, x: r2(lx), z: r2(lz), r: r2(hitR), big: brk ? 1 : 0 });
      const now = this.time;
      for (const m of [...this.mobs.values()]) {
        if (!this.targetable(m) || Math.hypot(m.x - lx, m.z - lz) > hitR + m.def.radius) continue;
        if (!m.def.boss) m.launchUntil = now + 0.7;
        this.damageMob(m, p, c.atkNow() * L.mult, { sk: c.S, stun: L.stun, heavy: true, knock: 1, threat: 1.3, ...(brk ? { brk: true } : { frac: L.frac }) });
      }
    });
  },

  // ---------- per tick ----------
  updateClassesA(dt) {
    this.updateArrowsA(dt);
    this.updateTrapsA();
    const t = this.time;
    let list = null;
    for (const p of this.players.values()) {
      if (p.brA && t >= p.brA.until) { p.brA = null; this.events.push({ t: 'brA', id: p.id, end: 1 }); }
      if (p.lsA && t >= p.lsA.until) p.lsA = null;
      if (p.cls !== 'berserker') continue;
      if (p.dead) p.rage = 0;
      else if (p.rage > 0 && t - (p.rageAt || 0) > RAGE.decayAfter && !this.raging(p)) p.rage = Math.max(0, p.rage - RAGE.decay * dt);
      (list ||= []).push([p.id, Math.round(p.rage || 0), this.raging(p) ? 1 : 0]);
    }
    // Rage for every Berserker, 4x a second (and whenever it changes): the client's bars under health.
    if (!list) return;
    const key = JSON.stringify(list);
    if (t >= (this.rageSendT || 0) && (key !== this.rageKey || t >= (this.rageFullT || 0))) {
      this.events.push({ t: 'rageA', l: list });
      this.rageKey = key; this.rageSendT = t + 0.25; this.rageFullT = t + 2;
    }
  },
};
