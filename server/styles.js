// Weapon styles, mixed into Game (installStyles at the end of game.js). Data and tuning: shared/styles.js.
//  - p.style is resolved from the equipped weapon on every recompute (equip, unequip, level-up, refine, join).
//  - styleSkill() runs the styled basic attack (slot 0) for non-default styles; default styles fall through to game.js.
//  - Passives: Dual Blades (Switch -> skill cooldowns), Rapier (crit, counter damage), Mace (longer Breaks),
//    Spear (threat), Mace & Tome (heal on hit), Wand (bolts on a Broken enemy heal whoever Broke it).
//  - Newer classes: Crossbow (first bolt crits), Twin Daggers (marks on hit, Disengage resets on kill), Twin Axes (Rage),
//    Warhammer (longer Breaks), Halberd (slows on hit), Glaive (tip bonus), War Drum (party damage on 3+ Discord),
//    Flute (double Discord stacks). Their basic attacks live in server/classes-a.js / classes-b.js, which read the
//    style's overrides through styleNum (arrow / chop / thrust / bolt); styles with `basic` steps (Twin Daggers,
//    Halberd, War Drum) hand slot 0 back to styleSkill (styleOwnsBasic).
//  - Skill tweaks are numbers read in game.js and the class files through styleNum(p, key, default).
//  - Testing aids: START_STYLE=<id>|random equips that style's weapon on join (a comma list: each class takes the first
//    style in it that's one of its own, e.g. START_STYLE=daggers,drum for a dagger Ranger and a drum Bard);
//    BOT_STYLES=1 gives every anonymous (unsaved) player, bots included, a random style.
import { CLASSES } from '../shared/data.js';
import { BAG_SIZE, makeItem } from '../shared/items.js';
import { STYLES, STYLE_IDS, CLASS_STYLES, styleOf, validStyle } from '../shared/styles.js';
import { RANGER_TUNE } from '../shared/classes/ranger.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;

export const StyleMethods = {
  // Called after every recompute (see installStyles): resolve the style and its stat passives.
  applyStyle(p) {
    p.style = styleOf(p.inv?.eq?.weapon, p.cls);
    const mods = STYLES[p.style]?.mods || {};
    if (mods.crit) p.crit += mods.crit;
    p.threatMult = mods.threat || 1;
  },
  styleNum(p, key, def) { return STYLES[p?.style]?.mods?.[key] ?? def; },
  styleIdx(p) { return p.style ? STYLE_IDS.indexOf(p.style) : -1; },
  // Does the style replace the class's own basic attack (styleSkill handles slot 0)?
  styleOwnsBasic(p) { return !!STYLES[p?.style]?.basic; },

  // ---------- the styled basic attack ----------
  // Returns true when it handled the skill (useSkill then stops). atk already includes buffs.
  styleSkill(p, sk, slot, atk) {
    if (slot !== 0) return false;
    const B = STYLES[p.style]?.basic;
    if (!B) return false;
    const t = this.time;
    p.cds[0] = t + B.cd * (this.hasteB?.(p, 0) ?? 1); // replaces the class basic's cooldown (Anthem still speeds it up)
    p.combo = t - p.lastBasic < B.window ? (p.combo + 1) % B.steps.length : 0;
    p.lastBasic = t;
    const n = p.combo, st = B.steps[n];
    const strike = twin => {
      if (p.dead || !this.players.has(p.id)) return;
      const hit = this.styleStrike(p, st, B, atk, n, twin);
      if (hit.length) this.stylePassiveHit(p, hit, st);
    };
    strike(0);
    if (st.twin) this.schedule(st.twin, () => strike(1));
    return true;
  },

  // One strike of a combo step: the visual, then the hits. Returns the enemies hit.
  styleStrike(p, st, B, atk, n, twin) {
    const fx = { t: 'fx', k: 'sty', st: p.style, n, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), fin: st.fin ? 1 : 0, tw: twin ? 1 : 0 };
    const opts = m => ({ threat: B.threat, knock: st.knock || 0, heavy: !!st.heavy, frac: st.frac || null, interrupt: !!st.interrupt && m.windupAt > 0 });
    const amount = atk * st.mult, hit = [];
    const fx2 = Math.sin(p.face), fz = Math.cos(p.face);
    if (st.shape === 'arc') {
      fx.r = st.r; fx.h = st.half;
      for (const m of this.mobs.values()) if (this.targetable(m) && this.inArc(p, m, st.r, st.half)) hit.push(m);
    } else if (st.shape === 'line') {
      fx.r = st.len; fx.w = st.w;
      for (const m of this.mobs.values()) {
        if (!this.targetable(m)) continue;
        const vx = m.x - p.x, vz = m.z - p.z, along = vx * fx2 + vz * fz;
        if (along < -m.def.radius || along > st.len + m.def.radius) continue;
        if (Math.abs(vx * fz - vz * fx2) <= st.w + m.def.radius) hit.push(m);
      }
    } else if (st.shape === 'ring') {
      fx.r = st.r;
      for (const m of this.mobs.values()) if (this.targetable(m) && dist(m, p) <= st.r + m.def.radius) hit.push(m);
    } else if (st.shape === 'bolt') { // like Smite: the first enemy along the ray
      let best = null, bestT = st.len;
      for (const m of this.mobs.values()) {
        if (!this.targetable(m)) continue;
        const vx = m.x - p.x, vz = m.z - p.z, along = vx * fx2 + vz * fz;
        if (along < 0 || along > st.len + m.def.radius) continue;
        if (Math.abs(vx * fz - vz * fx2) < st.w + m.def.radius && along < bestT) { best = m; bestT = Math.max(0, along); }
      }
      fx.x2 = r2(p.x + fx2 * bestT); fx.z2 = r2(p.z + fz * bestT);
      if (best) hit.push(best);
    }
    this.events.push(fx);
    const aid = []; // Wand: enemies a teammate has Broken (checked before the hit)
    for (const m of hit) {
      if (st.shape === 'bolt' && this.time < m.staggerUntil && m.staggerBy !== p.id) aid.push(m.staggerBy);
      const sweet = st.sweet && dist(m, p) - m.def.radius >= st.sweet[0]; // Halberd: the tip of the reach
      if (sweet) (fx.tip ||= []).push(m.id);
      if (st.discord) this.addDiscord?.(m, p, st.discord); // War Drum (before the hit, so its posture counts the stack)
      this.damageMob(m, p, amount * (sweet ? st.sweet[1] : 1), opts(m));
    }
    if (aid.length) this.wandAid(p, aid);
    return hit;
  },

  // ---------- passives ----------
  // Mace & Tome: a press that lands heals the most hurt ally nearby (you included) a little.
  // Twin Daggers: a chance to mark; Halberd: slows.
  stylePassiveHit(p, hit, st) {
    const mc = this.styleNum(p, 'markChance', null), slow = this.styleNum(p, 'hookSlow', null);
    if (mc && this.markA) for (const m of hit) {
      const mk = m.markA;
      if (m.dead || (mk && this.time < mk.until) || Math.random() >= mc[0]) continue;
      this.markA(p, m, '', mc[1], RANGER_TUNE.mark.bonus, RANGER_TUNE.mark.sw);
      this.events.push({ t: 'fx', k: 'sty', st: p.style, ev: 'mark', id: p.id, m: m.id, x: r2(m.x), z: r2(m.z) });
    }
    if (slow && this.slowMob) for (const m of hit) if (!m.dead) this.slowMob(m, slow[0], slow[1]);
    const h = this.styleNum(p, 'tomeHeal', null);
    if (!h) return;
    const [frac, flat, range] = h;
    let target = null, low = 1;
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > range) continue;
      const f = o.hp / o.maxHp;
      if (f < low) { low = f; target = o; }
    }
    if (!target) return;
    const got = this.healPlayer(target, target.maxHp * frac + flat, p);
    if (got > 0) this.events.push({ t: 'fx', k: 'sty', st: 'tome', ev: 'heal', id: target.id, by: p.id, x: r2(target.x), z: r2(target.z) });
  },

  // Wand: a bolt on an enemy a teammate Broke heals that teammate.
  wandAid(p, ids) {
    const frac = this.styleNum(p, 'wandAid', 0);
    if (!frac) return;
    for (const id of new Set(ids)) {
      const o = this.players.get(id);
      if (!o || o.dead || o === p) continue;
      const got = this.healPlayer(o, o.maxHp * frac, p);
      if (got > 0) this.events.push({ t: 'fx', k: 'sty', st: 'wand', ev: 'aid', id: o.id, by: p.id, x: r2(o.x), z: r2(o.z) });
    }
  },

  // Dual Blades: every Switch you land shortens your skill cooldowns (called from damageMob).
  styleOnSwitch(p) {
    const cut = this.styleNum(p, 'switchCdr', 0);
    if (!cut) return;
    for (let i = 1; i < p.cds.length; i++) p.cds[i] = Math.max(this.time, p.cds[i] - cut);
    this.events.push({ t: 'fx', k: 'sty', st: p.style, ev: 'cdr', id: p.id, to: p.id, a: cut, x: r2(p.x), z: r2(p.z) });
  },

  // Mace & Shield: Breaks you cause last longer (called from breakMob in combat.js). Seconds to add.
  styleBreakBonus(p, m) {
    const b = this.styleNum(p, 'breakBonus', null);
    return b ? b[m.def.boss ? 1 : 0] : 0;
  },

  // Crossbow: the first bolt on an enemy you haven't hit yet crits (arrowHitA, server/classes-a.js).
  styleFirstCrit(p, m) { return !!this.styleNum(p, 'firstCrit', 0) && !m.contributors.has(p.id); },
  // Flute: every second bolt that lands adds 2 Discord stacks (server/classes-b.js).
  styleDiscordN(p) {
    const n = this.styleNum(p, 'fluteStacks', 0);
    if (!n) return 1;
    p.fluteN = (p.fluteN || 0) + 1;
    return p.fluteN % 2 ? 1 : n;
  },
  // War Drum: enemies carrying enough Discord from a drummer take more damage from everyone.
  styleTakenMult(m) {
    const D = m.discord;
    if (!D || this.time >= D.until) return 1;
    const w = this.styleNum(this.players.get(D.by), 'warDrums', null);
    return w && D.n >= w[0] ? 1 + w[1] : 1;
  },

  // ---------- testing aids ----------
  styleJoin(p, saved) {
    const want = process.env.START_STYLE;
    const list = CLASS_STYLES[p.cls];
    if (!list) return;
    let id = null;
    if (want === 'random' || (process.env.BOT_STYLES && !saved && !want)) id = list[Math.floor(Math.random() * list.length)];
    else if (want) id = want.split(',').map(s => s.trim()).find(s => validStyle(s, p.cls)) || null;
    if (id && (styleOf(p.inv.eq.weapon, p.cls) !== id || !p.inv.eq.weapon)) this.styleArm(p, id);
  },

  // Equip a fresh Uncommon weapon of a style (the old weapon goes to the bag if there's room).
  styleArm(p, id) {
    const it = makeItem('weapon', 1, p.cls, Math.random, undefined, id);
    const old = p.inv.eq.weapon;
    if (old && p.inv.bag.length < BAG_SIZE) p.inv.bag.push(old);
    p.inv.eq.weapon = it;
    this.recompute(p); this.invChanged(p);
    return it;
  },
};

export function installStyles(Game) {
  Object.assign(Game.prototype, StyleMethods);
  // Wrap (rather than edit) recompute and addPlayer, so they stay merge-friendly.
  const recompute = Game.prototype.recompute;
  Game.prototype.recompute = function (p) { recompute.call(this, p); this.applyStyle(p); };
  // Styles that slow or speed up a class's own basic attack (Crossbow, Twin Axes, Warhammer, Glaive, Flute).
  const skillCd = Game.prototype.skillCd;
  Game.prototype.skillCd = function (p, sk, slot) { const cd = skillCd.call(this, p, sk, slot); return slot === 0 ? cd * this.styleNum(p, 'basicCd', 1) : cd; };
  // War Drum: more damage to enemies in deep Discord. Twin Daggers: Disengage resets on a kill.
  const damageMob = Game.prototype.damageMob;
  Game.prototype.damageMob = function (m, p, base, opts) { return damageMob.call(this, m, p, m && !m.dead && m.discord ? base * this.styleTakenMult(m) : base, opts); };
  const killMob = Game.prototype.killMob;
  Game.prototype.killMob = function (m, killer) {
    const out = killMob.call(this, m, killer), id = this.styleNum(killer, 'killReset', null);
    if (id) { const i = (CLASSES[killer.cls]?.skills || []).findIndex(s => s.id === id); if (i > 0 && killer.cds[i] > this.time) { killer.cds[i] = this.time; this.events.push({ t: 'fx', k: 'sty', st: killer.style, ev: 'reset', id: killer.id, to: killer.id, x: r2(killer.x), z: r2(killer.z) }); } }
    return out;
  };
  const addPlayer = Game.prototype.addPlayer;
  Game.prototype.addPlayer = function (ws, name, cls, saved = null) {
    const p = addPlayer.call(this, ws, name, cls, saved);
    this.styleJoin(p, saved);
    return p;
  };
}
