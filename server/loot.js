// Loot and builds (H2), mixed into Game by installLoot(Game) at the end of game.js. Data: shared/loot.js.
//  - dropLoot: personal drops from the data-driven tables (LOOT over DROPS), affixes on every gear drop, set pieces
//    (better odds for the Last Attack; the killer is remembered by the killMob wrapper).
//  - recompute wrapper: p.tal = talent totals + worn gear (affixes and set bonuses), so every talent hook (posture,
//    healing, threat, skill damage, dodge, Broken damage) reads gear too. Extra keys: stat.combo (server/teamplay.js),
//    stat.revive (server/revive.js), p.tal.gear.cds (flat skill cooldown cuts) and p.tal.gear.keys (set rules).
//  - Set rules: Rampart (breakMob), Undertow (damageMob, a Switch hit).
//  - Loadouts: up to LOADOUTS saved builds (worn gear by uid + talents) in p.inv.loadouts (saved with the inventory);
//    { type: 'loadout', op: 'save' | 'use' | 'clear' | 'rename', i, name }. Swapping only in town (a camp counts),
//    never within LOADOUT_CALM seconds of combat, never downed or dead.
//  - The Smith's affix reroll (server/smith.js calls rerollAx).
//  - Bots equip what they loot when it's clearly better for their role.
import { inTown } from '../shared/data.js';
import { SLOTS } from '../shared/items.js';
import {
  lootFor, sourceOf, rollTable, rollGear, makeSetPiece, pickSetSlot, buildTotals, rerollAffix, rerollCost, affixText,
  gearScore, SETS, SET_KEYS, SKCD_FLOOR,
} from '../shared/loot.js';
import { canAfford } from '../shared/crafting.js';

const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const rint = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
export const LOADOUTS = 3;
export const LOADOUT_CALM = 8; // seconds out of combat before a swap

export const LootMethods = {
  // Personal loot: every eligible player rolls their own drops.
  dropLoot(p, m) {
    const d = lootFor(sourceOf(m));
    if (!d || !p) return;
    const gold = rint(d.gold);
    p.gold += gold;
    const items = [];
    const give = (it, slot) => {
      if (this.giveItem(p, it)) items.push({ name: it.name, r: it.r, ...(it.set ? { set: it.set } : {}) });
      if (it.r >= 2 || it.set) this.track(p, 'loot', { r: it.r, slot, mob: m.type, ...(it.set ? { set: it.set } : {}) });
    };
    const n = d.item >= 1 ? d.item : Math.random() < d.item ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
      give(rollGear(slot, rollTable(d.table), p.cls, Math.random, undefined, 'roll'), slot); // weapons roll a style
    }
    for (const s of d.sets || []) {
      if (!SETS[s.id]) continue;
      const chance = this._laBy === p.id && s.la !== undefined ? s.la : s.chance;
      if (!(Math.random() < chance)) continue;
      const slot = pickSetSlot(s.id, p.inv);
      const it = makeSetPiece(s.id, slot, p.cls);
      if (it) { give(it, slot); this.sys(`Set piece: ${it.name} (${SETS[s.id].name})!`, p.id); }
    }
    let pot = 0;
    const pc = d.potion >= 1 ? d.potion : Math.random() < d.potion ? 1 : 0;
    if (pc) { p.inv.cons.potion = (p.inv.cons.potion || 0) + pc; pot = pc; }
    const mats = this.dropMats(p, m);
    this.events.push({ t: 'loot', to: p.id, x: r2(m.x), z: r2(m.z), g: gold, items, pot, mats });
    this.invChanged(p);
    if (p.bot && items.length) this.botLoot(p);
  },

  // A bot wears what it just looted when it's clearly better for its role (never during a director show).
  botLoot(p) {
    if (this.director?.running) return;
    for (const slot of SLOTS) {
      const cur = p.inv.eq[slot];
      if (cur?.ks) continue;
      let best = null, bs = gearScore(cur, p.cls) * 1.05 + (cur ? 0.01 : 0);
      for (const it of p.inv.bag) {
        if (it.slot !== slot || it.ks || (it.cls && it.cls !== p.cls)) continue;
        const s = gearScore(it, p.cls);
        if (s > bs) { best = it; bs = s; }
      }
      if (best) this.equip(p, best.u);
    }
  },

  // ---------- loadouts ----------
  loadoutBlock(p) {
    if (p.dead || p.downed) return "You can't change loadouts now.";
    if (!inTown(p.x, p.z)) return 'Swap loadouts in town or at a camp (by a Skill Shrine).';
    if (this.time - (p.lastCombat ?? -99) < LOADOUT_CALM) return 'Catch your breath first: no loadout swaps mid-fight.';
    return '';
  },

  loadoutAction(p, msg) {
    const i = msg.i | 0, op = String(msg.op || '');
    if (i < 0 || i >= LOADOUTS) return;
    const L = (p.inv.loadouts ||= []);
    while (L.length < LOADOUTS) L.push(null);
    const label = n => L[n]?.n || `Loadout ${n + 1}`;
    if (op === 'save') {
      const name = String(msg.name ?? L[i]?.n ?? '').replace(/[<>]/g, '').trim().slice(0, 20) || `Loadout ${i + 1}`;
      L[i] = { n: name, eq: Object.fromEntries(SLOTS.map(s => [s, p.inv.eq[s]?.u ?? null])), tal: { ...(p.talents || {}) } };
      this.sys(`Saved ${name}: your worn gear and talents.`, p.id);
      this.track(p, 'loadout', { op, i });
    } else if (op === 'rename') {
      if (!L[i]) return;
      L[i].n = String(msg.name || '').replace(/[<>]/g, '').trim().slice(0, 20) || `Loadout ${i + 1}`;
    } else if (op === 'clear') {
      if (!L[i]) return;
      this.sys(`Cleared ${label(i)}.`, p.id);
      L[i] = null;
    } else if (op === 'use') {
      const lo = L[i];
      if (!lo) return;
      const why = this.loadoutBlock(p);
      if (why) return this.sys(why, p.id);
      const missing = this.applyLoadout(p, lo);
      this.sys(`${label(i)} equipped.${missing.length ? ` Missing: ${missing.join(', ')} (sold or salvaged?).` : ''}`, p.id);
      this.events.push({ t: 'equip', id: p.id });
      this.events.push({ t: 'loadout', to: p.id, id: p.id, i, x: r2(p.x), z: r2(p.z) });
      this.track(p, 'loadout', { op, i, missing: missing.length });
    } else return;
    this.invChanged(p);
  },

  // Wear the loadout's items (from the bag; what was worn goes back in its place) and set its talents.
  // Returns the slots whose item is gone.
  applyLoadout(p, lo) {
    const missing = [];
    for (const slot of SLOTS) {
      const u = lo.eq?.[slot];
      if (!u || p.inv.eq[slot]?.u === u) continue;
      const i = p.inv.bag.findIndex(it => it.u === u);
      const it = p.inv.bag[i];
      if (!it || it.slot !== slot || (it.cls && it.cls !== p.cls)) { missing.push(slot); continue; }
      p.inv.bag.splice(i, 1);
      const old = p.inv.eq[slot];
      if (old) p.inv.bag.splice(i, 0, old);
      p.inv.eq[slot] = it;
    }
    const same = JSON.stringify(Object.entries(lo.tal || {}).sort()) === JSON.stringify(Object.entries(p.talents || {}).sort());
    if (lo.tal && !same && this.setTalents) this.setTalents(p, lo.tal); // sanitised; recomputes
    else this.recompute(p);
    return missing;
  },

  // ---------- the Smith: reroll one affix ----------
  rerollAx(p, u, i) {
    if (!this.nearSmith(p)) return false;
    const f = this.smithFind(p, u);
    if (!f) return false;
    const it = f.it;
    if (it.cls && it.cls !== p.cls) { this.sys('The Smith only rerolls weapons you can wield.', p.id); return false; }
    const cost = rerollCost(it);
    if (!cost || !it.ax?.[i | 0]) { this.sys(`${it.name} has no affix to reroll.`, p.id); return false; }
    if (!canAfford(p.gold, this.matsOf(p), cost)) { this.sys(cost.gold > p.gold ? 'Not enough gold.' : 'Not enough materials.', p.id); return false; }
    const old = affixText(it.ax[i | 0], p.cls);
    const a = rerollAffix(it, i | 0, p.cls);
    if (!a) { this.sys('Nothing else can roll on that item.', p.id); return false; }
    this.smithPay(p, cost);
    if (f.eq) this.recompute(p);
    this.sys(`Rerolled: ${old} → ${affixText(a, p.cls)}`, p.id);
    return this.forged(p, 'reroll', it);
  },
};

export function installLoot(Game) {
  const P = Game.prototype;
  Object.assign(P, LootMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // Talent totals + worn gear, before the stats are worked out.
  wrap('recompute', function (orig, p) {
    if (p?.inv) p.tal = buildTotals(p.cls, p.talents, p.inv.eq);
    return orig.call(this, p);
  });

  // Remember who landed the killing blow while the drops are handed out (set pieces: better odds for the Last Attack).
  wrap('killMob', function (orig, m, killer) {
    const prev = this._laBy;
    this._laBy = killer?.id;
    try { return orig.call(this, m, killer); } finally { this._laBy = prev; }
  });

  // Flat cooldown affixes ("Taunt cooldown −2 s"), never below SKCD_FLOOR of the cooldown.
  wrap('skillCd', function (orig, p, sk, slot) {
    const cd = orig.call(this, p, sk, slot), cut = p?.tal?.gear?.cds?.[sk?.id];
    return cut && slot > 0 ? Math.max(cd * SKCD_FLOOR, cd - cut) : cd;
  });

  // Rampart (Hornbound 3): a Break buffs you and the allies around you.
  wrap('breakMob', function (orig, m, p, interrupt, sk) {
    const out = orig.call(this, m, p, interrupt, sk);
    if (p?.tal?.gear?.keys.rampart && !p.dead) {
      const K = SET_KEYS.rampart;
      for (const o of this.players.values()) if (!o.dead && dist(o, p) <= K.r) this.teamBuff?.(o, K.dmg, K.d);
      this.events.push({ t: 'tproc', k: 'rampart', id: p.id, to: p.id, x: r2(p.x), z: r2(p.z), r: K.r });
    }
    return out;
  });

  // Undertow (Tidebound 3): a Switch hit heals you and the allies around you.
  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    if (!p?.tal?.gear?.keys.undertow) return orig.call(this, m, p, base, opts);
    const ev0 = this.events.length, out = orig.call(this, m, p, base, opts);
    const K = SET_KEYS.undertow;
    if (!p.dead && this.time >= (p.undertowT || 0) && this.events.slice(ev0).some(e => e.t === 'hit' && e.by === p.id && e.sw)) {
      p.undertowT = this.time + K.cd;
      for (const o of this.players.values()) if (!o.dead && !o.downed && o.hp < o.maxHp && dist(o, p) <= K.r) this.healPlayer(o, o.maxHp * K.heal, p, null);
      this.events.push({ t: 'tproc', k: 'undertow', id: p.id, to: p.id, x: r2(p.x), z: r2(p.z), r: K.r });
    }
    return out;
  });

  // { type: 'loadout' } messages; TEST_HOOKS=1 only: { type: 'test', giveSet: id } puts a full set in the bag (screenshots).
  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'loadout') return this.loadoutAction(p, msg);
    if (msg?.type === 'test' && process.env.TEST_HOOKS && SETS[msg.giveSet]) {
      for (const s of SLOTS) { const it = makeSetPiece(msg.giveSet, s, p.cls); if (it) this.giveItem(p, it); }
      this.invChanged(p);
    }
    return orig.call(this, p, msg);
  });

  // The inventory message carries the loadouts.
  wrap('invFor', function (orig, p) {
    const out = orig.call(this, p);
    out.lo = (p.inv.loadouts || []).slice(0, LOADOUTS);
    return out;
  });
}

