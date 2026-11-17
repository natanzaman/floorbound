// Talent trees, mixed into Game by installTalents(Game) at the end of game.js. Data and rules: shared/talents.js.
//
// State: p.talents = { nodeId: rank } (saved in characters.talents), p.tal = its summed effects (talentTotals).
// Messages: { type: 'talent', op: 'spend' | 'refund' | 'reset', id } in; { type: 'talents', r, pts } out (index.js).
// Spending works anywhere; refunds and a full respec are free but only at a Skill Shrine in town (atShrine, server/mastery.js).
//
// Where the effects apply (all server-side):
//  - hooks inside existing code: recompute() -> talentStats (atk/hp/crit/haste/dr/sw), addPosture() -> postureMul,
//    damagePlayer() -> talentHurt (guard block, ally auras, Guardian Spirit), addPlayer() -> initTalents.
//  - wrappers installed below around Game methods (the original always runs; the wrapper adjusts inputs or reacts after):
//    useSkill (current skill + duration/radius mods + skill keystones), skillCd (cooldown mods), damageMob (damage mods,
//    threat, auras, Executioner, Relay Strike, Rallying Bash), healPlayer (healing, Overflow), hitCircle/hitArc (radius),
//    dodge (dodge cooldown, Flowing Blade), evadeHit (perfect dodge -> Flowing Blade), guardHit (parry -> Shield Riposte,
//    Unbreakable), breakMob (Rallying Bash shields), killMob (Executioner), giveXp (talent point notices).
import { CLASSES, DODGE, PERFECT, GUARD } from '../shared/data.js';
import { TALENTS, KEYS, newTalents, talentTotals, pointsAt, spentOf, spendBlock, refundBlock, nodeDef, skKey } from '../shared/talents.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const slotOf = (p, id) => (CLASSES[p.cls]?.skills || []).findIndex(s => s.id === id);

export const TalentMethods = {
  // ---------- state ----------
  initTalents(p, raw) {
    p.talents = newTalents(raw, p.cls, p.lvl);
    p.tal = talentTotals(p.cls, p.talents);
    p.talentsDirty = true;
  },
  talentsMsg(p) { return { type: 'talents', r: p.talents, pts: pointsAt(p.lvl) }; },
  // Replace the whole allocation (admin edits, tests). Sanitised: an illegal one becomes a free reset.
  setTalents(p, alloc) { p.talents = newTalents(alloc, p.cls, p.lvl); this.talentsUpdated(p); },
  talentsUpdated(p) {
    p.tal = talentTotals(p.cls, p.talents);
    this.recompute(p); // keeps the health fraction
    p.talentsDirty = true; p.dirty = true;
    this.invChanged(p); // the bag shows the totals
  },

  // { type: 'talent', op, id }
  talentAction(p, msg) {
    const op = String(msg.op || 'spend'), id = String(msg.id || '');
    const n = nodeDef(id);
    if (op === 'spend') {
      const why = spendBlock(p.cls, p.talents, p.lvl, id);
      if (why) return this.sys(why, p.id);
      p.talents[id] = (p.talents[id] | 0) + 1;
      this.events.push({ t: 'talent', to: p.id, id: p.id, n: id, r: p.talents[id], op, k: n.keystone ? 1 : 0, x: r2(p.x), z: r2(p.z) });
      if (n.keystone) this.sys(`Keystone learned: ${n.name}!`, p.id);
      this.track(p, 'talent', { id, r: p.talents[id] });
    } else if (op === 'refund' || op === 'reset') {
      if (!this.atShrine(p)) return this.sys('Talent refunds are free at a Skill Shrine in town.', p.id);
      if (op === 'refund') {
        const why = refundBlock(p.cls, p.talents, id);
        if (why) return this.sys(why, p.id);
        if (!--p.talents[id]) delete p.talents[id];
      } else {
        if (!spentOf(p.talents)) return;
        p.talents = {};
        this.sys('Talents reset: all points refunded.', p.id);
      }
      this.events.push({ t: 'talent', to: p.id, id: p.id, n: id, op });
      this.track(p, 'talent_refund', { op, id });
    } else return;
    this.talentsUpdated(p);
  },

  // ---------- stats (called at the end of recompute) ----------
  talentStats(p) {
    const s = p.tal?.stat;
    if (!s) return;
    if (s.atk) p.atk *= 1 + s.atk / 100;
    if (s.hp) p.maxHp = Math.round(p.maxHp * (1 + s.hp / 100));
    if (s.crit) p.crit += s.crit / 100;
    if (s.haste) p.haste = Math.min(TALENTS.caps.haste / 100, p.haste + s.haste / 100);
    if (s.sw) p.swPow += s.sw / 100;
    if (s.dr) p.gearDr = Math.min(TALENTS.caps.dr / 100, p.gearDr + s.dr / 100);
  },

  // The strongest aura of a kind around p (from p itself or any ally within TALENTS.auraR), in percent.
  auraOf(p, kind) {
    let best = 0;
    for (const o of this.players.values()) {
      const v = o.tal?.aura[kind];
      if (!v || v <= best || o.dead || dist(o, p) > TALENTS.auraR) continue;
      best = v;
    }
    return best;
  },
  topThreat(m) {
    let id = 0, top = -1;
    for (const [pid, v] of m.threat) if (v > top) { top = v; id = pid; }
    return id;
  },
  // addPosture: posture damage talents (Pressure, Crushing Blows, ...) and Juggernaut.
  postureMul(p, m) {
    const T = p?.tal;
    if (!T) return 1;
    let k = 1 + (T.stat.posture || 0) / 100;
    if (T.keys.jugg && this.topThreat(m) === p.id) k *= 1 + KEYS.jugg.posture;
    return k;
  },
  // Radius multiplier for the skill being used right now (hitCircle / hitArc during useSkill).
  tRadius(p) {
    const id = p?._tsk;
    const m = id && p.tal?.sk[skKey(p.cls, id)];
    return m?.radius ? 1 + m.radius / 100 : 1;
  },

  // ---------- incoming damage (damagePlayer, after shields) ----------
  talentHurt(p, amount, guard, peril) {
    if (!(amount > 0)) return amount;
    const T = p.tal;
    if (guard && T?.stat.guard) { // Stalwart Guard: a bigger share blocked
      const block = Math.min(TALENTS.caps.guard, GUARD.dr * 100 + T.stat.guard) / 100;
      amount = Math.max(1, Math.round((amount * (1 - block)) / (1 - GUARD.dr)));
    }
    if (!peril) { const a = this.auraOf(p, 'dr'); if (a) amount = Math.max(1, Math.round(amount * (1 - a / 100))); } // Cover, Graceful Presence
    if (amount >= p.hp && this.spiritSave(p)) return 0;
    return amount;
  },
  // Guardian Spirit: a cleric with the keystone nearby saves a lethal hit (once every KEYS.spirit.cd seconds).
  spiritSave(p) {
    const K = KEYS.spirit, t = this.time;
    for (const c of this.players.values()) {
      if (!c.tal?.keys.spirit || c.dead || t < (c.spiritT || 0) || dist(c, p) > K.r) continue;
      c.spiritT = t + K.cd;
      const before = p.hp;
      p.hp = Math.max(p.hp, Math.round(p.maxHp * K.hp));
      p.lastHurt = t; p.lastCombat = t;
      if (p.hp > before) this.events.push({ t: 'heal', id: p.id, a: p.hp - before });
      this.events.push({ t: 'tproc', k: 'spirit', id: p.id, by: c.id, x: r2(p.x), z: r2(p.z) });
      this.sys(c === p ? 'Guardian Spirit saved you!' : `${c.name}'s Guardian Spirit saved you!`, p.id);
      if (c !== p) this.sys(`Guardian Spirit saved ${p.name}! (ready again in ${K.cd} s)`, c.id);
      return true;
    }
    return false;
  },

  // A shield like Aegis (p.shield; absorbHit soaks it first). by 0: no Blessing mastery for it.
  talentShield(o, hp, d) {
    const t = this.time, s = o.shield;
    hp = Math.round(hp);
    if (s && t < s.until && s.hp > 0) { s.hp = Math.max(s.hp, hp); s.max = Math.max(s.max, hp); s.until = Math.max(s.until, t + d); return; }
    o.shield = { hp, max: hp, until: t + d, by: 0 };
    this.events.push({ t: 'buff', id: o.id, k: 'aegis', d });
  },

  // ---------- after a skill was used (from the useSkill wrapper) ----------
  // ev0 / z0: where this.events / this.zones stood before the skill ran (what it pushed comes after).
  afterSkill(p, sk, slot, ev0, z0) {
    const t = this.time, T = p.tal, key = slot === 0 ? 'basic' : sk.id, mods = T.sk[key] || {};
    const evs = this.events.slice(ev0);
    if (mods.dur) { // buffs, shields, zones last longer
      const k = 1 + mods.dur / 100, ext = u => t + (u - t) * k;
      for (const e of evs) {
        if (e.t === 'fx' && e.id === p.id && e.d) { e.d = r2(e.d * k); continue; }
        if (e.t !== 'buff' || !e.d || e.end) continue;
        const o = this.players.get(e.id);
        if (!o) continue;
        e.d = r2(e.d * k);
        if ((e.k === 'dr' || e.k === 'wall' || e.k === 'iron') && o.dr.by === p.id) o.dr.until = ext(o.dr.until);
        if ((e.k === 'bless' || e.k === 'zeal') && o.dmg.by === p.id) o.dmg.until = ext(o.dmg.until);
        if (e.k === 'cry' && o.cry.by === p.id) o.cry.until = ext(o.cry.until);
        if (e.k === 'aegis' && o.shield) o.shield.until = ext(o.shield.until);
        if (e.k === 'iron' && o.iron) o.iron.until = ext(o.iron.until);
        if (e.k === 'bulwark' && o.bulwark) { o.bulwark.until = ext(o.bulwark.until); this.bulwarkT = Math.max(this.bulwarkT || 0, o.bulwark.until); }
        if (e.k === 'purify') o.purifyUntil = ext(o.purifyUntil);
      }
      for (const zn of this.zones.slice(z0)) if (zn.owner === p.id) zn.until = ext(zn.until);
    }
    if (mods.radius) { // zones and their visuals (the hits themselves were scaled by the hitCircle/hitArc wrappers)
      const k = 1 + mods.radius / 100;
      for (const zn of this.zones.slice(z0)) if (zn.owner === p.id) zn.r *= k;
      for (const e of evs) if (e.t === 'fx' && e.id === p.id && e.r && e.k !== 'bolt') e.r = r2(e.r * k);
    }
    // Wrath: Smite pierces through everything in a 14 m line.
    if (key === 'basic' && sk.id === 'smite' && T.keys.wrath) {
      const K = KEYS.wrath, dx = Math.sin(p.face), dz = Math.cos(p.face);
      const hit = new Set(evs.filter(e => e.t === 'hit' && e.by === p.id).map(e => e.id));
      const bolt = evs.find(e => e.t === 'fx' && e.k === 'bolt' && e.id === p.id);
      if (bolt) { bolt.x2 = r2(p.x + dx * K.range); bolt.z2 = r2(p.z + dz * K.range); bolt.pierce = 1; }
      for (const m of [...this.mobs.values()]) {
        if (!this.targetable(m) || hit.has(m.id)) continue;
        const vx = m.x - p.x, vz = m.z - p.z, along = vx * dx + vz * dz;
        if (along < 0 || along > K.range + m.def.radius || Math.abs(vx * dz - vz * dx) > K.width + m.def.radius) continue;
        this.damageMob(m, p, p.atk * this.dmgMult(p) * 1.1 * (hit.size ? K.after : 1), { interrupt: m.windupAt > 0 });
        hit.add(m.id);
      }
    }
    // Juggernaut: Taunt (any evolution) fills the posture of every enemy now fixed on you.
    if (sk.id === 'taunt' && T.keys.jugg) {
      for (const m of [...this.mobs.values()]) {
        if (!this.targetable(m) || dist(m, p) > 11 + m.def.radius || this.topThreat(m) !== p.id) continue;
        this.addPosture(m, p, 0, { frac: KEYS.jugg.frac, sk: 'taunt' });
      }
    }
    // Cleansing Light: Blessing / Zeal / Aegis also purify.
    if (sk.id === 'bless' && T.keys.cleanse) {
      for (const e of evs) {
        if (e.t !== 'buff' || !['bless', 'zeal', 'aegis'].includes(e.k) || e.end) continue;
        const o = this.players.get(e.id);
        if (!o || o.dead) continue;
        o.purifyUntil = Math.max(o.purifyUntil || 0, t + KEYS.cleanse.d); o.purifyBy = p.id;
        this.events.push({ t: 'buff', id: o.id, k: 'purify', d: KEYS.cleanse.d });
      }
    }
  },

  // Relay Strike: a Switch buffs everyone nearby and resets Burst Combo.
  relayStrike(p) {
    const K = KEYS.relay, t = this.time;
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > K.r) continue;
      o.relay = { until: t + K.d, v: K.dmg };
    }
    const i = slotOf(p, K.reset);
    if (i > 0) p.cds[i] = t;
    this.events.push({ t: 'tproc', k: 'relay', id: p.id, x: r2(p.x), z: r2(p.z), r: K.r });
  },
};

// Install the methods and the wrappers (after every other mixin, so the wrappers see the final methods).
export function installTalents(Game) {
  const P = Game.prototype;
  Object.assign(P, TalentMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // The skill being used (p._tsk) is visible to damageMob / hitCircle / hitArc while it runs; afterwards afterSkill.
  wrap('useSkill', function (orig, p, slot, face) {
    const sk = CLASSES[p.cls]?.skills[slot | 0];
    if (!sk || !p.tal) return orig.call(this, p, slot, face);
    const before = p.cds[slot], ev0 = this.events.length, z0 = this.zones.length;
    p._tsk = sk.id;
    try {
      orig.call(this, p, slot, face);
      if (p.cds[slot] !== before) this.afterSkill(p, sk, slot, ev0, z0); // it was used (a cooldown started)
    } finally { p._tsk = null; }
  });

  wrap('skillCd', function (orig, p, sk, slot) {
    const cd = orig.call(this, p, sk, slot), m = p.tal?.sk[slot === 0 ? 'basic' : sk.id];
    return m?.cd ? cd * Math.max(0.4, 1 + m.cd / 100) : cd;
  });

  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    const T = p?.tal;
    if (!T || !this.targetable(m)) return orig.call(this, m, p, base, opts);
    const t = this.time, skId = opts.sk || p._tsk, key = skId ? skKey(p.cls, skId) : null, mods = key ? T.sk[key] : null;
    let mul = 1;
    if (mods?.dmg) mul *= 1 + mods.dmg / 100;
    if (mods?.fin && key === 'basic' && opts.heavy) mul *= 1 + mods.fin / 100;
    const broken = t < m.staggerUntil, sw = broken && p.id !== m.staggerBy;
    if (broken && T.stat.broken) mul *= 1 + T.stat.broken / 100;
    if (sw) { const a = this.auraOf(p, 'sw'); if (a) mul *= 1 + a / 100; } // Unity
    const aura = this.auraOf(p, 'atk'); // Battle Rhythm
    if (aura) mul *= 1 + aura / 100;
    if (t < (p.relay?.until || 0)) mul *= 1 + p.relay.v; // Relay Strike buff
    if (T.stat.counter && (t < (p.counterUntil || 0) || p.counterAt === t)) mul *= 1 + T.stat.counter / 100;
    if (T.keys.exec && m.hp / m.maxHp < KEYS.exec.below) mul *= 1 + KEYS.exec.dmg;
    if (T.stat.threat) opts = { ...opts, threat: (opts.threat ?? 1) * (1 + T.stat.threat / 100) };
    if (T.keys.rally && key === 'basic' && opts.heavy) opts = { ...opts, stun: Math.max(opts.stun || 0, KEYS.rally.stun), frac: opts.frac || KEYS.rally.frac };
    const ev0 = this.events.length;
    const out = orig.call(this, m, p, base * mul, opts);
    if (T.keys.relay && sw && this.events.slice(ev0).some(e => e.t === 'switch' && e.by === p.id)) this.relayStrike(p);
    return out;
  });

  wrap('healPlayer', function (orig, tg, amount, by, sk) {
    const T = by?.tal;
    if (T?.stat.heal) amount *= 1 + T.stat.heal / 100;
    const got = orig.call(this, tg, amount, by, sk);
    if (T?.keys.overflow && !tg.dead) { // Overflow: the overheal becomes a shield
      const over = Math.round(amount) - got;
      if (over > 0) {
        const cap = tg.maxHp * KEYS.overflow.cap, s = tg.shield, now = this.time;
        if (s && now < s.until && s.hp > 0) { s.hp = Math.min(Math.max(s.max, cap), s.hp + over); s.max = Math.max(s.max, s.hp); s.until = Math.max(s.until, now + KEYS.overflow.d); }
        else this.talentShield(tg, Math.min(cap, over), KEYS.overflow.d);
      }
    }
    return got;
  });

  wrap('hitCircle', function (orig, p, x, z, r, amount, opts) { return orig.call(this, p, x, z, r * this.tRadius(p), amount, opts); });
  wrap('hitArc', function (orig, p, range, half, amount, opts) { return orig.call(this, p, range * this.tRadius(p), half, amount, opts); });

  wrap('dodge', function (orig, p, face) {
    const before = p.dodgeCd;
    orig.call(this, p, face);
    if (p.dodgeCd === before || !p.tal) return; // no roll
    const t = this.time;
    if (p.tal.stat.dodge) p.dodgeCd = t + DODGE.cd * (1 - Math.min(50, p.tal.stat.dodge) / 100);
    if (p.tal.keys.flow) for (let i = 1; i < p.cds.length; i++) if (p.cds[i] > t) p.cds[i] = Math.max(t, p.cds[i] - KEYS.flow.roll);
  });

  wrap('evadeHit', function (orig, p, src, mob) {
    const n = p.perfects || 0;
    orig.call(this, p, src, mob);
    if ((p.perfects || 0) > n && p.tal?.keys.flow) { // Flowing Blade: a perfect dodge resets Rush and Whirl
      for (const id of KEYS.flow.reset) { const i = slotOf(p, id); if (i > 0) p.cds[i] = this.time; }
      this.events.push({ t: 'tproc', k: 'flow', id: p.id, x: r2(p.x), z: r2(p.z) });
    }
  });

  wrap('guardHit', function (orig, p, src, mob, peril) {
    const res = orig.call(this, p, src, mob, peril);
    if (res !== 'parry' || !p.tal) return res;
    const K = p.tal.keys;
    if (K.unbreak) { // heal and strike back
      this.healPlayer(p, p.maxHp * KEYS.unbreak.heal, p, null);
      const a = this.attackerOf(p, src, mob);
      if (a && this.targetable(a)) this.damageMob(a, p, p.atk * this.dmgMult(p) * KEYS.unbreak.hit, { heavy: true, threat: 2 });
      this.events.push({ t: 'tproc', k: 'unbreak', id: p.id, x: r2(p.x), z: r2(p.z) });
    }
    if (K.parryCounter) p.counterUntil = this.time + PERFECT.counter; // Shield Riposte: a counter window like a perfect dodge
    return res;
  });

  wrap('breakMob', function (orig, m, p, interrupt, sk) {
    const out = orig.call(this, m, p, interrupt, sk);
    const K = KEYS.rally;
    if (p?.tal?.keys.rally && this.time >= (p.rallyT || 0)) { // Rallying Bash: shields for the allies around
      p.rallyT = this.time + K.every;
      for (const o of this.players.values()) if (!o.dead && dist(o, p) <= K.r) this.talentShield(o, o.maxHp * K.shield, K.d);
      this.events.push({ t: 'tproc', k: 'rally', id: p.id, x: r2(p.x), z: r2(p.z), r: K.r });
    }
    return out;
  });

  wrap('killMob', function (orig, m, killer) {
    const out = orig.call(this, m, killer);
    if (killer?.tal?.keys.exec) { // Executioner: a kill resets Rush
      const i = slotOf(killer, 'rush');
      if (i > 0 && killer.cds[i] > this.time) { killer.cds[i] = this.time; this.events.push({ t: 'tproc', k: 'exec', id: killer.id, x: r2(killer.x), z: r2(killer.z) }); }
    }
    return out;
  });

  wrap('giveXp', function (orig, p, amount) {
    const l0 = p.lvl;
    const out = orig.call(this, p, amount);
    if (p.lvl > l0 && p.talents) {
      const got = pointsAt(p.lvl) - pointsAt(l0), free = pointsAt(p.lvl) - spentOf(p.talents);
      p.talentsDirty = true;
      if (got > 0) {
        this.events.push({ t: 'tpoint', to: p.id, n: free, got, lvl: p.lvl });
        this.sys(`+${got} talent point${got > 1 ? 's' : ''} (${free} to spend): press K to open your Skill Tree.`, p.id);
      }
    }
    return out;
  });
}

