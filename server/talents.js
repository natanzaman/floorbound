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
import { SONG } from '../shared/classes/bard.js';
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
      const why = spendBlock(p.cls, p.talents, p.lvl, id, this.subOfP?.(p));
      if (why) return this.sys(why, p.id);
      p.talents[id] = (p.talents[id] | 0) + 1;
      this.events.push({ t: 'talent', to: p.id, id: p.id, n: id, r: p.talents[id], op, k: n.keystone ? 1 : 0, x: r2(p.x), z: r2(p.z) });
      if (n.keystone) this.sys(`Keystone learned: ${n.name}!`, p.id);
      this.track(p, 'talent', { id, r: p.talents[id] });
    } else if (op === 'refund' || op === 'reset') {
      if (!this.atShrine(p)) return this.sys('Talent refunds are free at a Skill Shrine in town.', p.id);
      if (op === 'refund') {
        const why = refundBlock(p.cls, p.talents, id, this.subOfP?.(p));
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
  topThreat(m) { return this.targetOf(m)?.id || 0; }, // who m is after (server/threat.js targetOf)
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
    o.shield = { hp, max: hp, until: t + d, by: 0, k: 'talent' }; // k: shown as "Shield", not Aegis
    this.events.push({ t: 'buff', id: o.id, k: 'aegis', d });
  },

  // ---------- after a skill was used (from the useSkill wrapper) ----------
  // ev0 / z0: where this.events / this.zones stood before the skill ran (what it pushed comes after).
  afterSkill(p, sk, slot, ev0, z0) {
    const t = this.time, T = p.tal, key = slot === 0 ? 'basic' : sk.key || sk.id, mods = T.sk[key] || {};
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
    this.events.push({ t: 'tproc', k: 'relay', id: p.id, to: p.id, x: r2(p.x), z: r2(p.z), r: K.r });
  },
};

// Install the methods and the wrappers (after every other mixin, so the wrappers see the final methods).
export function installTalents(Game) {
  const P = Game.prototype;
  Object.assign(P, TalentMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // The skill being used (p._tsk) is visible to damageMob / hitCircle / hitArc while it runs; afterwards afterSkill.
  wrap('useSkill', function (orig, p, slot, face) {
    const sk = this.skillAt ? this.skillAt(p, slot | 0) : CLASSES[p.cls]?.skills[slot | 0]; // (slot 4: the signature skill, server/subclasses.js)
    if (!sk || !p.tal || sk.borrow) return orig.call(this, p, slot, face); // (a borrowed skill: its own call in here does this)
    const before = p.cds[slot], ev0 = this.events.length, z0 = this.zones.length;
    p._tsk = sk.key || sk.id; this._tp = p; // (_tp: schedule() hands the skill on to its delayed hits)
    try {
      orig.call(this, p, slot, face);
      if (p.cds[slot] !== before) { this.afterSkill(p, sk, slot, ev0, z0); this.afterSkillNew(p, sk, slot, ev0); } // it was used (a cooldown started)
    } finally { p._tsk = null; this._tp = null; }
  });

  wrap('skillCd', function (orig, p, sk, slot) {
    const cd = orig.call(this, p, sk, slot), m = p.tal?.sk[slot === 0 ? 'basic' : sk.id];
    return m?.cd ? cd * Math.max(0.4, 1 + m.cd / 100) : cd;
  });

  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    const T = p?.tal;
    if (!T || !this.targetable(m)) return orig.call(this, m, p, base, opts);
    const t = this.time, skId = opts.sk || opts.tsk || p._tsk, key = skId ? skKey(p.cls, skId) : null, mods = key ? T.sk[key] : null;
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
        const cap = Math.round(tg.maxHp * KEYS.overflow.cap), s = tg.shield, now = this.time;
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
    if (p.tal.keys.flow) for (let i = 1; i < 4; i++) if (p.cds[i] > t) p.cds[i] = Math.max(t, p.cds[i] - KEYS.flow.roll);
  });

  wrap('evadeHit', function (orig, p, src, mob) {
    const n = p.perfects || 0;
    orig.call(this, p, src, mob);
    if ((p.perfects || 0) > n && p.tal?.keys.flow) { // Flowing Blade: a perfect dodge resets Rush and Whirl
      for (const id of KEYS.flow.reset) { const i = slotOf(p, id); if (i > 0) p.cds[i] = this.time; }
      this.events.push({ t: 'tproc', k: 'flow', id: p.id, to: p.id, x: r2(p.x), z: r2(p.z) });
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
      this.events.push({ t: 'tproc', k: 'unbreak', id: p.id, to: p.id, x: r2(p.x), z: r2(p.z) });
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
      this.events.push({ t: 'tproc', k: 'rally', id: p.id, to: p.id, x: r2(p.x), z: r2(p.z), r: K.r });
    }
    return out;
  });

  wrap('killMob', function (orig, m, killer) {
    const out = orig.call(this, m, killer);
    if (killer?.tal?.keys.exec) { // Executioner: a kill resets Rush
      const i = slotOf(killer, 'rush');
      if (i > 0 && killer.cds[i] > this.time) { killer.cds[i] = this.time; this.events.push({ t: 'tproc', k: 'exec', id: killer.id, to: killer.id, x: r2(killer.x), z: r2(killer.z) }); }
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
        this.sys(`+${got} talent point${got > 1 ? 's' : ''} (${free} to spend): press {key:skillTree} to open your Skill Tree.`, p.id);
      }
    }
    return out;
  });

  installTalentsNew(P, wrap); // Ranger, Berserker, Lancer, Bard (below)
}


// ======================================================================================================
// The newer classes (Ranger, Berserker, Lancer, Bard): their keystones and special nodes. Same pattern: methods
// plus wrappers around existing Game methods (the original always runs). Their class code lives in
// server/classes-a.js / classes-b.js; these hooks only read and adjust what those methods do.
//  - schedule: a delayed hit (Rain of Arrows, Leap Slam, Sky Lance, Crescendo, ...) keeps the skill that queued it, so
//    per-skill damage / radius talents reach it too.
//  - afterSkillNew (from the useSkill wrapper): durations / radii of songs, traps, marks, Bloodrage; Hit and Fade,
//    Phalanx, Dragoon.
//  - damageMob: Red Mist, Massacre, Resonance, Maestro, Hit and Fade, Leech, Pinning Arrow, Cacophony, Pack Leader,
//    Symphony. fireArrowA / arrowHitA: arrows remember their skill; Longshot, Dead Shot.
//  - markA (Deep Mark), gainRageA (Fury), killMob (Massacre, Sanguine Frenzy), talentHurt (Second Wind),
//    postureMul (Sanguine Frenzy), addPosture (Dragoon), updateClassesA (Sanguine heal), updateTrapsA (Minefield),
//    breakMob (Warcry), dodge / evadeHit (Hit and Fade), startSong (Resonant Voice), songTick (Soothing Song),
//    addDiscord (Lingering Discord), crescBurst (Cacophony, Bulwark Chord).
export const TalentMethodsNew = {
  // A short party damage buff (Pack Leader, Warcry): the p.relay slot Relay Strike uses; the stronger one stays.
  teamBuff(o, v, d) {
    const t = this.time, r = o.relay;
    if (r && t < r.until && r.v > v) return;
    o.relay = { until: Math.max(t + d, r && r.v === v ? r.until : 0), v };
  },
  cdCut(p, skId, secs) { const i = slotOf(p, skId); if (i > 0 && p.cds[i] > this.time) p.cds[i] = Math.max(this.time, p.cds[i] - secs); },
  cdReset(p, skId) { const i = slotOf(p, skId); if (i > 0) p.cds[i] = Math.min(p.cds[i], this.time); },
  tproc(p, k, extra = {}) { this.events.push({ t: 'tproc', k, id: p.id, to: p.id, x: r2(p.x), z: r2(p.z), ...extra }); },

  afterSkillNew(p, sk, slot, ev0) {
    if (!['ranger', 'berserker', 'lancer', 'bard'].includes(p.cls)) return;
    const t = this.time, T = p.tal, key = slot === 0 ? 'basic' : sk.key || sk.id, mods = T.sk[key] || {};
    const evs = this.events.slice(ev0);
    if (mods.dur || mods.radius) {
      const k = 1 + (mods.dur || 0) / 100, kr = 1 + (mods.radius || 0) / 100, ext = u => t + (u - t) * k;
      for (const tr of this.trapList || []) { // caltrops, snares
        if (tr.owner !== p.id || tr._tal) continue;
        tr._tal = 1; tr.until = ext(tr.until); tr.r *= kr;
      }
      if (mods.dur) {
        if (p.song && evs.some(e => e.k === 'cb' && e.ev === 'song' && e.id === p.id)) p.song.until = ext(p.song.until); // (the fx's d is scaled by afterSkill)
        for (const e of evs) {
          if (e.t === 'markA' && e.by === p.id) { const m = this.mobs.get(e.id); if (m?.markA) { m.markA.until = ext(m.markA.until); m.markA.dur = (m.markA.dur || e.d) * k; e.d = r2(e.d * k); } }
          if (e.t === 'brA' && !e.end && e.d) {
            const o = this.players.get(e.id);
            if (o === p && p.brA) p.brA.until = ext(p.brA.until);
            if (e.k === 'warblood' && o?.lsA?.by === p.id) o.lsA.until = ext(o.lsA.until);
            e.d = r2(e.d * k);
          }
        }
      }
    }
    // Hit and Fade: the first thrust after a charge hits harder.
    if (T.keys.fade && sk.id === 'lcharge') p.fadeUntil = t + KEYS.fade.window;
    else if (T.keys.fade && key === 'basic' && p.fadeUntil > t && evs.some(e => e.t === 'hit' && e.by === p.id)) p.fadeUntil = 0;
    // Dragoon: a thrust that lands at the tip shortens Sky Lance.
    if (T.keys.dragoon && key === 'basic' && evs.some(e => e.k === 'cb' && e.ev === 'thrust' && e.tip?.length)) this.cdCut(p, KEYS.dragoon.sk, KEYS.dragoon.cdr);
    // Phalanx: Sweep shields the line and pulls what it hit off your allies.
    if (T.keys.phalanx && sk.id === 'lsweep') {
      const K = KEYS.phalanx, fx = evs.find(e => e.k === 'cb' && e.id === p.id && e.r);
      for (const o of this.players.values()) if (!o.dead && dist(o, p) <= K.r) this.talentShield(o, o.maxHp * K.shield, K.d);
      const r = fx?.r || 4.5;
      for (const m of this.mobs.values()) {
        if (!this.targetable(m) || dist(m, p) > r + m.def.radius || !m.threat.size || this.topThreat(m) === p.id) continue;
        this.threatToTop(m, p); // Phalanx: to the top, no lock, no cuts (server/threat.js)
      }
      this.tproc(p, 'phalanx', { r: K.r });
    }
  },

  // Minefield: a trap that sprang or ran out explodes.
  mineBlast(tr) {
    const p = this.players.get(tr.owner), K = KEYS.minefield;
    if (!p?.tal?.keys.minefield || p.dead) return;
    this.events.push({ t: 'tproc', k: 'minefield', id: p.id, to: p.id, x: r2(tr.x), z: r2(tr.z), r: r2(tr.r) });
    for (const m of [...this.mobs.values()]) {
      if (!this.targetable(m, p) || Math.hypot(m.x - tr.x, m.z - tr.z) > tr.r + m.def.radius) continue;
      this.damageMob(m, p, p.atk * this.dmgMult(p) * K.mult, { sk: tr.sk, heavy: true, frac: K.frac, threat: 0.8 });
    }
  },
};

function installTalentsNew(P, wrap) {
  Object.assign(P, TalentMethodsNew);

  // Delayed hits keep the skill that queued them (p._tsk), so damage / radius talents for that skill apply.
  wrap('schedule', function (orig, delay, fn) {
    const p = this._tp, id = p?._tsk;
    if (!id) return orig.call(this, delay, fn);
    return orig.call(this, delay, () => { const o = p._tsk; p._tsk = id; try { fn(); } finally { p._tsk = o; } });
  });

  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    const T = p?.tal;
    if (!T || !this.targetable(m)) return orig.call(this, m, p, base, opts);
    const t = this.time, K = T.keys, skId = opts.sk || opts.tsk || p._tsk, key = skId ? skKey(p.cls, skId) : null;
    let mul = 1;
    if (K.redmist) mul *= 1 + KEYS.redmist.dmg * K.redmist * Math.min(1, (p.rage || 0) / 100);
    if (K.massacre && skId === 'cleave' && m.hp / m.maxHp < KEYS.massacre.below) mul *= 1 + KEYS.massacre.dmg;
    if (K.resonance) { const n = this.discordOf?.(m) || 0; if (n) mul *= 1 + KEYS.resonance.dmg * K.resonance * n; }
    if (K.fade && key === 'basic' && t < (p.fadeUntil || 0)) mul *= 1 + KEYS.fade.dmg;
    for (const s of [p.anthem, p.march]) { // Maestro: allies under the song hit harder
      if (!s || t >= s.until) continue;
      if (this.players.get(s.by)?.tal?.keys.maestro) { mul *= 1 + KEYS.maestro.dmg; break; }
    }
    let crit = null;
    if (K.deadshot && skId === KEYS.deadshot.sk) { crit = p.crit; p.crit = 1; } // Dead Shot: Piercing Shot always crits
    const ev0 = this.events.length;
    let out;
    try { out = orig.call(this, m, p, base * mul, opts); } finally { if (crit !== null) p.crit = crit; }
    const evs = this.events.slice(ev0), hit = evs.find(e => e.t === 'hit' && e.id === m.id && e.by === p.id);
    if (!hit) return out;
    if (K.leech && !p.dead) this.healPlayer(p, hit.a * KEYS.leech.ls * K.leech, p, null);
    if (K.pinshot && key === 'basic' && opts.heavy && p.cls === 'ranger' && !m.dead) this.slowMob?.(m, KEYS.pinshot.slow, KEYS.pinshot.d);
    if (key === 'basic' && p.cls === 'bard' && !m.dead) {
      if (K.maestro && p.song && t < p.song.until && p.song.kind !== 'lullaby') { // Maestro: the song goes on
        const s = p.song; s.cap ??= s.until + KEYS.maestro.max;
        if (s.until < s.cap) {
          s.until = Math.min(s.cap, s.until + KEYS.maestro.ext); this.tproc(p, 'maestro');
          this.cbFx?.(p, 'songExt', { kind: s.kind, d: r2(s.until - t) }); // the new end: clients stretch the song ring and buff timers
        }
      }
      if (K.cacophony) for (const o of [...this.mobs.values()]) { // Cacophony: the discord spreads
        if (o !== m && this.targetable(o) && dist(o, m) <= KEYS.cacophony.r + o.def.radius) this.addDiscord(o, p, 1);
      }
    }
    if (hit.sw) { // a Switch: Pack Leader (the marker), Symphony (bards near the striker)
      const mk = m.markA, rg = mk && t < mk.until && !mk.dead ? this.players.get(mk.by) : null;
      if (rg?.tal?.keys.packlead && !rg.dead) {
        const PK = KEYS.packlead;
        mk.until = t + (mk.dur || 8);
        this.events.push({ t: 'markA', id: m.id, by: rg.id, d: r2(mk.until - t), k: '' });
        this.cdReset(rg, PK.reset);
        for (const o of this.players.values()) if (!o.dead && dist(o, m) <= PK.r + m.def.radius) this.teamBuff(o, PK.dmg, PK.d);
        this.events.push({ t: 'tproc', k: 'packlead', id: rg.id, to: rg.id, x: r2(m.x), z: r2(m.z), r: PK.r });
      }
      for (const b of this.players.values()) {
        if (!b.tal?.keys.symphony || b.dead || b === p || dist(b, p) > KEYS.symphony.r) continue;
        const SK = KEYS.symphony;
        this.talentShield(p, p.maxHp * SK.shield, SK.d);
        this.cdCut(b, SK.sk, SK.cdr);
        this.events.push({ t: 'tproc', k: 'symphony', id: p.id, by: b.id, x: r2(p.x), z: r2(p.z) });
      }
    }
    return out;
  });

  // Arrows remember the skill that fired them (for 'basic' / per-skill talents when they land later).
  wrap('fireArrowA', function (orig, p, o) {
    if (p._tsk && !o.opts?.sk) o = { ...o, opts: { ...(o.opts || {}), tsk: p._tsk } };
    return orig.call(this, p, o);
  });
  wrap('arrowHitA', function (orig, a, p, m) {
    const K = p.tal?.keys;
    if (!K || (!K.longshot && !K.deadshot)) return orig.call(this, a, p, m);
    const d0 = a.dmg;
    if (K.longshot && Math.hypot(m.x - a.ox, m.z - a.oz) - m.def.radius > KEYS.longshot.from) a.dmg *= 1 + KEYS.longshot.dmg * K.longshot;
    const ev0 = this.events.length;
    try { return orig.call(this, a, p, m); } finally {
      a.dmg = d0;
      if (K.deadshot && a.opts?.sk !== KEYS.deadshot.sk && this.events.slice(ev0).some(e => e.t === 'hit' && e.by === p.id && e.c)) this.cdCut(p, KEYS.deadshot.sk, KEYS.deadshot.refund);
    }
  });

  wrap('markA', function (orig, p, m, kind, dur, bonus, sw, self) {
    const r = p.tal?.keys.deepmark;
    if (r && kind !== 'deadeye') bonus += KEYS.deepmark.bonus * r;
    const out = orig.call(this, p, m, kind, dur, bonus, sw, self);
    if (m.markA) m.markA.dur = dur;
    return out;
  });

  wrap('gainRageA', function (orig, p, v) { return orig.call(this, p, p.tal?.keys.fury ? v * (1 + KEYS.fury.rage * p.tal.keys.fury) : v); });

  wrap('killMob', function (orig, m, killer) {
    const out = orig.call(this, m, killer), K = killer?.tal?.keys;
    if (!K) return out;
    if (K.massacre) { this.gainRageA(killer, KEYS.massacre.rage); this.cdReset(killer, KEYS.massacre.reset); this.tproc(killer, 'massacre'); }
    if (K.sanguine && this.raging?.(killer)) {
      killer.brA.until += KEYS.sanguine.ext;
      this.events.push({ t: 'brA', id: killer.id, to: killer.id, k: killer.brA.k, d: r2(killer.brA.until - this.time) });
    }
    return out;
  });

  wrap('talentHurt', function (orig, p, amount, guard, peril) {
    const r = p.tal?.keys.secondwind;
    if (r && amount > 0 && p.hp / p.maxHp < KEYS.secondwind.below) amount = Math.max(1, Math.round(amount * (1 - KEYS.secondwind.dr * r)));
    return orig.call(this, p, amount, guard, peril);
  });

  wrap('postureMul', function (orig, p, m) {
    const k = orig.call(this, p, m);
    return p?.tal?.keys.sanguine && this.raging?.(p) ? k * (1 + KEYS.sanguine.posture) : k;
  });
  wrap('addPosture', function (orig, m, p, amount, opts = {}) {
    if (!p?.tal?.keys.dragoon || opts.sk !== KEYS.dragoon.sk) return orig.call(this, m, p, amount, opts);
    const k = 1 + KEYS.dragoon.posture;
    return orig.call(this, m, p, amount * k, { ...opts, frac: opts.frac ? opts.frac.map(v => v * k) : opts.frac });
  });

  // Sanguine Frenzy: heal when Bloodrage / Frenzy ends.
  wrap('updateClassesA', function (orig, dt) {
    const on = [];
    for (const p of this.players.values()) if (p.brA && p.tal?.keys.sanguine) on.push(p);
    const out = orig.call(this, dt);
    for (const p of on) if (!p.brA && !p.dead) { this.healPlayer(p, p.maxHp * KEYS.sanguine.heal, p, null); this.tproc(p, 'sanguine'); }
    return out;
  });
  // Minefield: traps that are gone after the tick (sprung or run out) explode.
  wrap('updateTrapsA', function (orig) {
    const before = this.trapList?.slice() || [];
    const out = orig.call(this);
    if (before.length) { const now = new Set(this.trapList); for (const tr of before) if (!now.has(tr)) this.mineBlast(tr); }
    return out;
  });

  wrap('breakMob', function (orig, m, p, interrupt, sk) {
    const out = orig.call(this, m, p, interrupt, sk), K = KEYS.warcry;
    if (p?.tal?.keys.warcry && this.time >= (p.warcryT || 0)) {
      p.warcryT = this.time + K.every;
      for (const o of this.players.values()) if (!o.dead && dist(o, p) <= K.r) this.teamBuff(o, K.dmg, K.d);
      this.cdReset(p, K.reset);
      this.tproc(p, 'warcry', { r: K.r });
    }
    return out;
  });

  wrap('dodge', function (orig, p, face) {
    const before = p.dodgeCd;
    orig.call(this, p, face);
    if (p.dodgeCd !== before && p.tal?.keys.fade) this.cdCut(p, KEYS.fade.sk, KEYS.fade.roll);
  });
  wrap('evadeHit', function (orig, p, src, mob) {
    const n = p.perfects || 0;
    orig.call(this, p, src, mob);
    if ((p.perfects || 0) > n && p.tal?.keys.fade) { this.cdReset(p, KEYS.fade.sk); this.tproc(p, 'fade'); }
  });

  wrap('startSong', function (orig, p, c, kind) {
    const r = p.tal?.keys.voice;
    return orig.call(this, p, r ? { ...c, pow: c.pow * (1 + KEYS.voice.pow * r) } : c, kind);
  });
  wrap('songTick', function (orig, p) {
    const s = p.song, next = s?.next;
    const out = orig.call(this, p);
    const r = p.tal?.keys.soothe;
    if (r && s && p.song === s && s.next !== next && s.kind !== 'lullaby') { // a tick of Anthem / War March
      const k = (s.next - this.time) * KEYS.soothe.heal * r; // per second -> per tick
      for (const o of this.players.values()) if (!o.dead && dist(o, p) <= 12 && o.hp < o.maxHp) this.healPlayer(o, o.maxHp * k, p, null);
    }
    return out;
  });
  wrap('addDiscord', function (orig, m, p, n) {
    const out = orig.call(this, m, p, n), r = p?.tal?.keys.linger;
    if (r && m?.discord) m.discord.until += KEYS.linger.d * r;
    return out;
  });
  wrap('crescBurst', function (orig, p, kind, c) {
    const K = p.tal?.keys || {}, er = kind === 'finale' ? SONG.finale.er : SONG.crescendo.er;
    if (K.cacophony && kind !== 'encore') { // one stack fewer needed: lend one to everything in the blast already in discord
      for (const m of this.mobs.values()) if (this.targetable(m) && dist(m, p) <= er + m.def.radius && this.discordOf(m) > 0) m.discord.n += KEYS.cacophony.need;
    }
    const before = new Map([...this.players.values()].map(o => [o, o.shield]));
    const out = orig.call(this, p, kind, c);
    if (K.crescshield && kind !== 'finale') { // Bulwark Chord: the shields it just gave are bigger
      for (const o of this.players.values()) {
        const s = o.shield;
        if (o.dead || !s || s === before.get(o) || s.by !== p.id) continue;
        const add = Math.round(o.maxHp * KEYS.crescshield.shield * K.crescshield);
        s.hp += add; s.max += add;
      }
    }
    return out;
  });
}
