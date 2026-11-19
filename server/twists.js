// Warden twists: server behaviour. These are Game methods (mixed into Game.prototype at the end of game.js);
// game.js only calls them from small hooks in bossSpecials, circleAttack, hornCharge, damageMob, killMob,
// updateMob (boss engage / wipe reset / respawn) and snapshot. The twist table lives in shared/twists.js.
import { WORLD, WARDEN, MOBS, inArena } from '../shared/data.js';
import { DROPS, SLOTS, makeItem, rollRarity } from '../shared/items.js';
import { TWISTS, TOTEM, rewardText, rollTwist } from '../shared/twists.js';
import { SOV_TWISTS } from '../shared/floor2.js';

const r2 = v => Math.round(v * 100) / 100;
const TOTEM_DEF = { ...MOBS.spitter, ...TOTEM };

export const TwistMethods = {
  // Roll (or force with WARDEN_TWIST) the twist for the next Warden fight and announce it server-wide.
  // this.twistOverride (setTwistOverride, server/staging.js): 'off' = no twist, a twist id = that one.
  newTwist() {
    if (this.twistOverride === 'off') { this.twist = null; this.twistW = { ...WARDEN }; this.cracks = []; this.events.push({ t: 'twist', id: null }); return; }
    const id = rollTwist(this.twist?.id, this.twistOverride || process.env.WARDEN_TWIST);
    const T = TWISTS[id];
    this.twist = { id, name: T.name };
    this.cracks = [];
    // The Warden's attack config for this twist (bossSpecials and hornCharge read this.twistW).
    const W = { ...WARDEN };
    if (id === 'packmaster') W.hounds = { ...WARDEN.hounds, ...T.hounds };
    if (id === 'quaking') W.quake = { ...WARDEN.quake, rings: WARDEN.quake.rings.map(n => n + T.rings) };
    if (id === 'eclipse') {
      for (const [k, v] of Object.entries(WARDEN)) if (v && typeof v.wind === 'number') W[k] = { ...v, wind: r2(v.wind * T.wind) };
    }
    this.twistW = W;
    this.events.push({ t: 'twist', id });
    this.sys(`The Horned Warden stirs · Twist: ${T.name}. ${T.desc} Reward: ${rewardText(id)}.`);
    if (!this.twistLogged) { this.twistLogged = true; console.log(`Warden twist: ${id}`); }
  },

  twistDef() { return TWISTS[this.twist?.id] || null; },

  // Boss engage (updateMob): per-twist timers, Berserk's health and phase.
  twistEngage(m) {
    const id = this.twist?.id, T = TWISTS[id], t = this.time;
    this.cracks = [];
    m.twin2 = false; m.twExt = 0;
    if (!T) return;
    if (id === 'packmaster') { m.packT = t + T.hounds0.first; m.frenzyT = t + T.frenzy.first; }
    if (id === 'twinhorns') m.twinT = t + T.first;
    if (id === 'thornbound') m.totemT = t + T.totems.first;
    if (id === 'berserk') {
      m.maxHp = m.hp = Math.round(m.maxHp * T.hp);
      m.phase = 2;
      m.houndT = t + 3; m.chargeT = t + 7; m.spinT = t + 4; m.rockT = t + 9;
      this.events.push({ t: 'enrage', id: m.id });
      this.sys('The Horned Warden is BERSERK! Every attack, right from the start.');
    }
  },

  // Called at the end of bossSpecials every tick the Warden is fighting.
  twistSpecials(m, pick) {
    const id = this.twist?.id, T = TWISTS[id], t = this.time;
    if (!T) return;
    if (id === 'packmaster') {
      if (m.phase === 0 && t >= m.packT) { m.packT = t + T.hounds0.every; this.twistHounds(m, T.hounds0.n, T.hounds.max, pick); }
      if (t >= m.frenzyT) {
        m.frenzyT = t + T.frenzy.every;
        let n = 0;
        for (const h of this.mobs.values()) if (h.temp && !h.totem && !h.dead) { h.frenzyUntil = t + T.frenzy.d; n++; }
        if (n) this.events.push({ t: 'howl', id: m.id, n, r: 12 });
      }
    } else if (id === 'twinhorns') {
      const W = (this.twistW || WARDEN).charge;
      if (m.phase === 0 && t >= m.twinT && t >= m.busyUntil && !m.windupAt) { m.twinT = t + W.every; /* W.every is paced already (paceMoves): the rest after the charge stays as before */ this.hornCharge(m, pick()); }
    } else if (id === 'thornbound') {
      const S = T.totems;
      if (t >= m.totemT) { m.totemT = t + S.every; this.twistTotems(m, S, pick); }
      for (const h of [...this.mobs.values()]) {
        if (!h.totem || h.dead || t - h.bornAt < S.life) continue;
        this.events.push({ t: 'die', id: h.id, x: r2(h.x), z: r2(h.z), b: 0 });
        this.mobs.delete(h.id);
      }
    }
  },

  // Same as the Warden's own hound summon, with a different count/cap (Packmaster's early hounds).
  twistHounds(m, n, max, pick) {
    let alive = 0; for (const h of this.mobs.values()) if (h.temp && !h.totem && !h.dead) alive++;
    for (let i = 0; i < n && alive < max; i++, alive++) {
      const a = Math.random() * Math.PI * 2;
      const h = this.addMob('hound', WORLD.arena.x + Math.sin(a) * 18, WORLD.arena.z + Math.cos(a) * 18);
      h.temp = true; h.sx = h.x; h.sz = h.z;
      const v = pick(); if (v) h.threat.set(v.id, 5);
      this.events.push({ t: 'fx', k: 'summon', x: r2(h.x), z: r2(h.z) });
    }
  },

  // Thornbound: stone Thorn Totems (temporary spitters) at the chamber edge, spread around the ring.
  twistTotems(m, S, pick) {
    let alive = 0; for (const h of this.mobs.values()) if (h.totem && !h.dead) alive++;
    let n = 0; for (const p of this.players.values()) if (!p.dead && inArena(p.x, p.z)) n++;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < S.n && alive < S.max; i++, alive++) {
      const a = base + (i / S.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const h = this.addMob('spitter', WORLD.arena.x + Math.sin(a) * S.dist, WORLD.arena.z + Math.cos(a) * S.dist);
      h.def = TOTEM_DEF;
      h.hp = h.maxHp = TOTEM.hp + TOTEM.hpPer * Math.max(1, n);
      h.temp = true; h.totem = true; h.sx = h.x; h.sz = h.z; h.bornAt = this.time; h.atkT = this.time + 2;
      const v = pick(); if (v) h.threat.set(v.id, 1);
      this.events.push({ t: 'fx', k: 'summon', x: r2(h.x), z: r2(h.z) });
    }
    this.sys('The Warden raises Thorn Totems at the chamber edge! Break them.');
  },

  // Top of circleAttack (slams, rockfall): Echo repeats it, Quaking cracks the ground where a slam lands.
  twistCircle(m, x, z, r, wind, amount, src, ground, kind) {
    const id = this.twist?.id, T = TWISTS[id];
    if (!T || m !== this.boss) return;
    if (id === 'echo' && kind !== 'echo') {
      this.schedule(T.delay, () => { if (!m.dead && m.engaged) this.circleAttack(m, x, z, r, wind, amount, `${src} echo`, ground, 'echo'); });
    }
    if (id === 'quaking' && src === 'warden slam') {
      this.schedule(wind, () => { if (!m.dead && m.engaged) this.twistCrack(m, x, z, r * T.crack.rk); });
    }
  },

  twistCrack(m, x, z, r) {
    const C = TWISTS.quaking.crack, c = { x, z, r };
    this.cracks.push(c);
    this.events.push({ t: 'tele', k: 'crack', x: r2(x), z: r2(z), r: r2(r), d: C.d }); // bots step out of 'tele' circles
    const ticks = Math.round(C.d / C.tick);
    for (let i = 1; i <= ticks; i++) {
      this.schedule(i * C.tick, () => {
        if (m.dead || !this.cracks.includes(c)) return;
        for (const p of this.players.values()) {
          if (!p.dead && Math.hypot(p.x - x, p.z - z) <= r) this.damagePlayer(p, m.def.atk * C.mult, { src: 'cracked ground' });
        }
        if (i === ticks) this.cracks = this.cracks.filter(o => o !== c);
      });
    }
  },

  // End of hornCharge: Twin Horns follows every charge with a second one at someone else.
  twistCharge(m, v) {
    if (this.twist?.id !== 'twinhorns') return;
    if (m.twin2) { m.twin2 = false; return; }
    const W = (this.twistW || WARDEN).charge, delay = W.wind + 0.45 + TWISTS.twinhorns.gap;
    m.busyUntil = Math.max(m.busyUntil || 0, this.time + delay + 0.1);
    this.schedule(delay, () => {
      if (m.dead || !m.engaged || this.time < m.stunUntil) return; // a Break cancels the second horn
      const fighters = [...this.players.values()].filter(p => !p.dead && inArena(p.x, p.z));
      const others = fighters.filter(p => p !== v);
      const pool = others.length ? others : fighters;
      const nv = pool[Math.floor(Math.random() * pool.length)];
      if (!nv) return;
      m.twin2 = true;
      this.hornCharge(m, nv);
    });
  },

  // The armour twist this boss has: the Warden's Ironhide or the Sovereign's Coral Hide (server/sovtwists.js), else null.
  hideTwist(m) {
    if (m === this.boss) return this.twist?.id === 'ironhide' ? TWISTS.ironhide : null;
    if (m === this.sovereign) return this.twist2?.id === 'coralhide' ? SOV_TWISTS.coralhide : null;
    return null;
  },

  // damageMob, before the damage roll: Ironhide's / Coral Hide's armour (none while Broken).
  twistTaken(m) {
    const T = this.hideTwist(m);
    if (!T) return 1;
    return this.time < m.staggerUntil ? 1 : T.taken;
  },

  // End of damageMob: Ironhide's (Coral Hide's) Broken windows last longer (works for any source of the stagger).
  twistAfterHit(m) {
    const t = this.time, T = this.hideTwist(m);
    if (!T || t >= m.staggerUntil || m.twExt === m.staggerUntil) return;
    m.staggerUntil += T.breakBonus;
    m.stunUntil = Math.max(m.stunUntil, m.staggerUntil);
    m.twExt = m.staggerUntil;
    const ev = this.events.findLast?.(e => e.t === 'stagger' && e.id === m.id);
    if (ev) ev.d = r2(m.staggerUntil - t); // the break event of this same tick: show the longer window
  },

  // killMob (Warden): the twist's reward bonus for everyone who fought.
  twistKill(m) {
    this.cracks = [];
    const id = this.twist?.id, T = TWISTS[id];
    if (!T) return;
    const R = T.reward, D = DROPS.warden;
    for (const pid of m.contributors) {
      const p = this.players.get(pid);
      if (!p) continue;
      const items = [];
      for (let i = 0; i < (R.loot || 0); i++) {
        const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
        const it = makeItem(slot, rollRarity(D.table), p.cls, Math.random, undefined, 'roll'); // weapons roll a style
        if (this.giveItem(p, it)) items.push({ name: it.name, r: it.r });
        if (it.r >= 2) this.track(p, 'loot', { r: it.r, slot, mob: 'warden', twist: id });
      }
      const gold = R.gold ? Math.round(((D.gold[0] + D.gold[1]) / 2) * R.gold) : 0;
      p.gold += gold;
      this.events.push({ t: 'loot', to: p.id, x: r2(m.x), z: r2(m.z), g: gold, items, pot: 0 });
      this.sys(`Twist bonus (${T.name}): ${[items.length && `+${items.length} item${items.length > 1 ? 's' : ''}`, gold && `+${gold} gold`].filter(Boolean).join(', ')}`, p.id);
      this.invChanged(p);
    }
  },

  // updateMob wipe reset: drop lingering twist hazards (adds/totems go with clearHounds).
  twistReset(m) {
    this.cracks = [];
    m.twin2 = false; m.twExt = 0;
  },
};
