// The town Smith: materials, refine, salvage, reforge and recipes. Mixed into Game (see the end of game.js).
import { CLASSES } from '../shared/data.js';
import { BAG_SIZE, RARITY, makeItem } from '../shared/items.js';
import {
  SMITH, MATS, rollMats, nearSmithAt, refineCost, applyRefine, salvageYield, reforgeCost, charmAffix, CHARM_AFFIXES,
  RECIPE_BY_ID, recipeName, canAfford,
} from '../shared/crafting.js';

const r2 = v => Math.round(v * 100) / 100;

export const SmithMethods = {
  nearSmith(p) { return !p.dead && nearSmithAt(p.x, p.z); },
  matsOf(p) { return (p.inv.mats ||= {}); }, // old saves have no mats

  giveMats(p, mats) {
    const have = this.matsOf(p);
    for (const [k, v] of Object.entries(mats)) if (MATS[k] && v > 0) have[k] = (have[k] || 0) + v;
  },

  // Personal material drops for a kill (called from dropLoot). Returns { mat: n } for the loot event.
  dropMats(p, m) {
    const mats = rollMats(m.type);
    this.giveMats(p, mats);
    return mats;
  },

  // Deduct a cost the caller already checked with canAfford.
  smithPay(p, cost) {
    p.gold -= cost.gold;
    const have = this.matsOf(p);
    for (const [k, v] of Object.entries(cost.mats || {})) have[k] = (have[k] || 0) - v;
  },

  // Find an item by uid in the bag or (when allowed) equipped.
  smithFind(p, u, equipped = true) {
    u = u | 0;
    const i = p.inv.bag.findIndex(it => it.u === u);
    if (i >= 0) return { it: p.inv.bag[i], i, eq: null };
    if (equipped) for (const [slot, it] of Object.entries(p.inv.eq)) if (it && it.u === u) return { it, i: -1, eq: slot };
    return null;
  },

  smithCheck(p, cost) {
    if (!this.nearSmith(p)) return false;
    if (!cost) return false;
    if (!canAfford(p.gold, this.matsOf(p), cost)) { this.sys(cost.gold > p.gold ? 'Not enough gold.' : 'Not enough materials.', p.id); return false; }
    return true;
  },

  forged(p, a, it) {
    this.events.push({ t: 'forge', id: p.id, a, x: r2(SMITH.x), z: r2(SMITH.z), r: it?.r ?? 0, name: it?.name || '' });
    this.track(p, 'craft', { action: a, r: it?.r ?? 0, ...(it?.lv ? { lv: it.lv } : {}), ...(it?.cr ? { id: it.cr } : {}) });
    this.invChanged(p);
    return true;
  },

  // Client message: { type: 'smith', a: 'refine'|'salvage'|'reforge'|'craft', u, mode, id }
  smith(p, msg) {
    switch (msg.a) {
      case 'refine': return this.refine(p, msg.u);
      case 'salvage': return this.salvage(p, msg.u);
      case 'reforge': return this.reforge(p, msg.u, String(msg.mode || 'stats'));
      case 'craft': return this.craft(p, String(msg.id || ''), msg.cls);
    }
    return false;
  },

  refine(p, u) {
    if (!this.nearSmith(p)) return false;
    const f = this.smithFind(p, u);
    if (!f) return false;
    const it = f.it;
    if (it.cls && it.cls !== p.cls) { this.sys('The Smith only refines weapons you can wield.', p.id); return false; }
    const cost = refineCost(it);
    if (!cost) { this.sys(`${it.name} is already fully refined.`, p.id); return false; }
    if (!this.smithCheck(p, cost)) return false;
    this.smithPay(p, cost);
    it.lv = (it.lv || 0) + 1;
    applyRefine(it);
    if (f.eq) this.recompute(p);
    this.sys(`Refined: ${it.name}`, p.id);
    return this.forged(p, 'refine', it);
  },

  salvage(p, u) {
    if (!this.nearSmith(p)) return false;
    const f = this.smithFind(p, u, false); // bag items only
    if (!f) return false;
    const out = salvageYield(f.it);
    if (!out) { this.sys(`${f.it.name} can't be salvaged.`, p.id); return false; }
    p.inv.bag.splice(f.i, 1);
    this.giveMats(p, out);
    this.sys(`Salvaged ${f.it.name}: ${Object.entries(out).map(([k, v]) => `${v} ${MATS[k].name}`).join(', ')}`, p.id);
    return this.forged(p, 'salvage', f.it);
  },

  reforge(p, u, mode) {
    if (!this.nearSmith(p)) return false;
    const f = this.smithFind(p, u);
    if (!f) return false;
    const it = f.it;
    if (it.cls && it.cls !== p.cls) { this.sys('The Smith only reforges weapons you can wield.', p.id); return false; }
    const cost = reforgeCost(it, mode);
    if (!cost) { this.sys(`${it.name} can't be reforged that way.`, p.id); return false; }
    if (!this.smithCheck(p, cost)) return false;
    this.smithPay(p, cost);
    const cur = it.slot === 'charm' ? charmAffix(it) : undefined;
    let kind = cur;
    if (mode === 'affix') { const others = CHARM_AFFIXES.filter(k => k !== cur); kind = others[Math.floor(Math.random() * others.length)]; }
    const fresh = makeItem(it.slot, it.r, it.cls || p.cls, Math.random, kind);
    it.b = { ...fresh.st };
    if (it.slot === 'charm') it.bn = fresh.name;
    applyRefine(it);
    if (f.eq) this.recompute(p);
    this.sys(`Reforged: ${it.name}`, p.id);
    return this.forged(p, 'reforge', it);
  },

  craft(p, id, cls) {
    if (!this.nearSmith(p)) return false;
    const rc = RECIPE_BY_ID[id];
    if (!rc) return false;
    if (rc.cls && cls && cls !== p.cls) { this.sys(`Only a ${CLASSES[cls]?.name || 'different class'} could wield that. The Smith forges for your class.`, p.id); return false; }
    if (p.inv.bag.length >= BAG_SIZE) { this.sys('Your bag is full.', p.id); return false; }
    const cost = { gold: rc.gold, mats: rc.mats };
    if (!this.smithCheck(p, cost)) return false;
    this.smithPay(p, cost);
    const it = makeItem(rc.slot, rc.r, p.cls); // fresh uid; name and stats are the recipe's
    it.name = recipeName(rc, p.cls);
    it.st = { ...rc.st };
    it.cr = rc.id;
    if (!rc.cls) delete it.cls;
    p.inv.bag.push(it);
    this.sys(`Forged: ${it.name} (${RARITY[it.r].name})`, p.id);
    return this.forged(p, 'craft', it);
  },
};
