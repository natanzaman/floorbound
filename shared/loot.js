// Loot and builds: affixes, boss sets and the drop tables. Shared by the server (rolls, effects, drops) and the client
// (tooltips, set progress). The rules that use this data live in server/loot.js.
//
// ---------------------------------------------------------------------------------------------------------------
// HOW TO ADD A DROP ENTRY (Floor 2 / Floor 3 bosses and mobs: add entries here, never custom drop code)
//   Every kill looks up its source key: `boss:<type>` (a mob def with boss: true), `rare:<type>` (a rare named spawn),
//   otherwise `mob:<type>`. The entry in LOOT is merged over DROPS[type] (shared/items.js), so you only list what
//   differs. Fields (all optional):
//     gold: [min, max]          gold per eligible player
//     item: n | chance          n >= 1: that many items; below 1: the chance of one item
//     table: 'boss' | ...       rarity table name (TABLES in shared/items.js), or weights: [common, uncommon, rare, epic]
//     potion: chance | n        health potions
//     sets: [{ id, chance, la }] chance of one piece of set `id` per eligible player; `la`: the chance instead for whoever
//                               landed the Last Attack. A piece the player doesn't own yet is picked first.
//   Example (Floor 3):  LOOT['boss:stormking'] = { gold: [400, 520], item: 2, table: [0, 0, 30, 70], sets: [{ id: 'galeborn', chance: 0.2, la: 0.5 }] };
//                       LOOT['mob:harpy'] = { gold: [10, 16], item: 0.12, potion: 0.12, table: 'mire' };
//   Materials still come from MAT_DROPS (shared/crafting.js).
//
// HOW TO ADD A SET
//   SETS.<id> = { name, from (who drops it, for tooltips), color, r (rarity, default 3 = Epic), mul (base-stat multiplier,
//     default 1), affixes (rolled affixes per piece, default 2),
//     pieces: { weapon: {}, armor: { name }, charm: { name, charm: 'crit' | 'haste' | 'sw' } }   (2 or 3 slots)
//     bonus: { 2: [effects], 3: [effects] } }
//   Effects use the talent shape (shared/talents.js): { stat: <STAT_TEXT key or 'combo' | 'revive'>, v } (percent),
//   { sk: '<skill id | basic>', dmg: v }, or { key: '<id>', desc } for a custom rule (add it to SET_KEYS here and to
//   setKeyHooks in server/loot.js). The weapon piece takes the set name + the wielder's weapon noun ("Hornbound Blade").
//   Then add the set to its boss's LOOT entry (sets: [...]).
// ---------------------------------------------------------------------------------------------------------------
import { CLASSES } from './data.js';
import { SLOTS, DROPS, makeItem, rollRarity } from './items.js';
import { STYLES } from './styles.js';
import { recipeName } from './crafting.js';
import { STAT_TEXT, talentTotals } from './talents.js';

// ---------- affixes ----------
// it.ax = [{ k, v, s?, c? }]: k = affix id, v = value, s = skill id and c = class (skill affixes only).
// v: value by rarity [common, uncommon, rare, epic] (Last Attack items use epic), rolled ×0.8–1.2.
// w: roll weight (default 1); role: weight multiplier by the dropper's class role. slots: where it can roll.
export const AFFIXES = {
  atk: { slots: ['weapon', 'charm'], v: [2, 3, 5, 7] },
  crit: { slots: ['weapon', 'charm'], v: [2, 3, 4, 6] },
  haste: { slots: ['armor', 'charm'], v: [2, 3, 5, 7] },
  hp: { slots: ['armor', 'charm'], v: [3, 5, 7, 10] },
  dr: { slots: ['armor'], v: [1, 2, 3, 4] },
  posture: { slots: ['weapon', 'charm'], v: [5, 8, 11, 15] },
  sw: { slots: ['weapon', 'charm'], v: [6, 10, 14, 20] },
  broken: { slots: ['weapon'], v: [4, 6, 8, 12] },
  dodge: { slots: ['armor'], v: [4, 6, 8, 12], w: 0.6 },
  heal: { slots: ['weapon', 'armor', 'charm'], v: [4, 6, 9, 12], w: 0.3, role: { Healer: 6, Support: 4 } },
  threat: { slots: ['weapon', 'armor'], v: [10, 15, 20, 30], w: 0.3, role: { Tank: 6 } },
  skdmg: { slots: ['weapon', 'charm'], v: [6, 9, 12, 15], skill: 'dmg' },  // "+15% Whirl damage"
  skcd: { slots: ['armor', 'charm'], v: [0.5, 1, 1.5, 2], skill: 'cd' },   // "Taunt cooldown −2 s"
  combo: { slots: ['weapon', 'charm'], v: [4, 6, 8, 10], w: 0.7 },          // team: "+10% combo damage"
  revive: { slots: ['armor', 'charm'], v: [8, 12, 16, 20], w: 0.7 },        // team: "revive 20% faster"
};
export const AFFIX_IDS = Object.keys(AFFIXES);
// Affixes per rarity: Common has this chance of one; Uncommon 1, Rare 2, Epic 3. Last Attack items and keepsakes: none.
export const AFFIX_COUNT = [0.3, 1, 2, 3];
const TEAM = new Set(['combo', 'revive']);

// Skills a damage affix can name (basic attack first), by class; any other class: every skill.
const SKILL_DMG = {
  swordsman: ['slash', 'rush', 'whirl', 'burst'], guardian: ['bash', 'gslam'], cleric: ['smite'],
  ranger: ['shot', 'pierce', 'disengage'], berserker: ['chop', 'cleave', 'leap'], lancer: ['lthrust', 'lcharge', 'lsweep', 'skylance'],
  bard: ['sonic', 'dissonance', 'crescendo'],
};
export const SKCD_MIN = 6;      // cooldown affixes only name skills with at least this cooldown (s)
export const SKCD_FLOOR = 0.6;  // and never take a cooldown below this fraction of the original
const skillsFor = (cls, kind) => {
  const sk = CLASSES[cls]?.skills || [];
  if (kind === 'cd') return sk.slice(1).filter(s => s.cd >= SKCD_MIN).map(s => s.id);
  return SKILL_DMG[cls] || sk.map(s => s.id);
};
export const skillName = (cls, id) => CLASSES[cls]?.skills.find(s => s.id === id)?.name || id;
const skillKey = (cls, id) => (CLASSES[cls]?.skills[0]?.id === id ? 'basic' : id);

const EXTRA_TEXT = {
  combo: v => `+${v}% combo damage`,
  revive: v => `revive allies ${v}% faster`,
};
const statText = (k, v) => (EXTRA_TEXT[k] || STAT_TEXT[k] || (x => `${k} ${x}`))(v);

// One affix as text. cls: the viewer's class (a skill affix for another class says which).
export function affixText(a, cls) {
  if (a.k === 'skdmg' || a.k === 'skcd') {
    const nm = skillName(a.c, a.s), other = cls && a.c && a.c !== cls ? ` (${CLASSES[a.c]?.name || a.c})` : '';
    return a.k === 'skdmg' ? `+${a.v}% ${nm} damage${other}` : `${nm} cooldown −${a.v} s${other}`;
  }
  return statText(a.k, a.v);
}
export const isTeamAffix = a => TEAM.has(a.k);

const rarityIdx = r => Math.max(0, Math.min(3, r | 0));
function rollValue(k, r, rnd) {
  const base = AFFIXES[k].v[rarityIdx(r)];
  if (k === 'skcd') return Math.max(0.5, Math.round(base * (0.8 + rnd() * 0.4) * 2) / 2);
  return Math.max(1, Math.round(base * (0.8 + rnd() * 0.4)));
}

// Roll one affix for a slot that isn't in `taken` (affix ids). cls: whose skills a skill affix names (and whose role
// weights apply). Returns null when nothing fits.
export function rollAffix(slot, r, cls, rnd = Math.random, taken = []) {
  const role = CLASSES[cls]?.role || 'Damage';
  const pool = AFFIX_IDS.filter(k => AFFIXES[k].slots.includes(slot) && !taken.includes(k) && (!AFFIXES[k].skill || skillsFor(cls, AFFIXES[k].skill).length));
  const w = pool.map(k => (AFFIXES[k].w ?? 1) * (AFFIXES[k].role?.[role] ?? 1));
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  let k = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x < 0) { k = pool[i]; break; } }
  if (!k) return null;
  const a = { k, v: rollValue(k, r, rnd) };
  if (AFFIXES[k].skill) { const list = skillsFor(cls, AFFIXES[k].skill); a.s = list[Math.floor(rnd() * list.length)]; a.c = cls; }
  return a;
}

// Give an item its affixes (n: how many; default by rarity). Last Attack items and keepsakes get none.
export function rollAffixes(it, cls, rnd = Math.random, n) {
  if (it.la || it.ks) return it;
  if (n === undefined) { const c = AFFIX_COUNT[rarityIdx(it.r)]; n = c < 1 ? (rnd() < c ? 1 : 0) : c; }
  const ax = [];
  for (let i = 0; i < n; i++) { const a = rollAffix(it.slot, it.r, it.cls || cls, rnd, ax.map(x => x.k)); if (a) ax.push(a); }
  if (ax.length) it.ax = ax; else delete it.ax;
  return it;
}

// A fresh gear item with affixes (drops, the shop, twist rewards, the Smith's recipes).
export function rollGear(slot, rarity, cls, rnd = Math.random, charmKind, style) {
  return rollAffixes(makeItem(slot, rarity, cls, rnd, charmKind, style), cls, rnd);
}

// Reroll affix i of an item into a different affix (the Smith). Returns the new affix or null.
export function rerollAffix(it, i, cls, rnd = Math.random) {
  const ax = it.ax || [];
  if (!ax[i]) return null;
  const taken = ax.map(a => a.k); // a different kind from every affix on it (so it really changes)
  const a = rollAffix(it.slot, it.r, it.cls || ax[i].c || cls, rnd, taken);
  if (!a) return null;
  ax[i] = a;
  return a;
}
// Smith cost to reroll one affix (null: the item has none, or can't be touched).
export function rerollCost(it) {
  if (!it?.ax?.length || it.ks || it.la) return null;
  const r = rarityIdx(it.r);
  const mats = { ess: [1, 1, 2, 2][r] };
  if (r >= 3) mats.prism = 1;
  return { gold: [20, 40, 80, 160][r] * (it.set ? 2 : 1), mats };
}

// Validate affixes from outside (admin editor). Returns a clean list or throws a message string.
export function cleanAffixes(ax, slot) {
  if (ax == null) return undefined;
  if (!Array.isArray(ax) || ax.length > 4) throw 'ax must be a list of at most 4 affixes.';
  return ax.map((a, i) => {
    const A = AFFIXES[a?.k];
    if (!A) throw `ax[${i}]: unknown affix ${a?.k}.`;
    if (slot && !A.slots.includes(slot)) throw `ax[${i}]: ${a.k} doesn't roll on a ${slot}.`;
    const v = Number(a.v);
    if (!isFinite(v) || v <= 0 || v > A.v[3] * 3) throw `ax[${i}]: value must be 0–${A.v[3] * 3}.`;
    const out = { k: a.k, v: Math.round(v * 2) / 2 };
    if (A.skill) {
      if (!CLASSES[a.c] || !CLASSES[a.c].skills.some(s => s.id === a.s)) throw `ax[${i}]: needs a class (c) and one of its skills (s).`;
      out.s = a.s; out.c = a.c;
    }
    return out;
  });
}

// ---------- sets ----------
export const SETS = {
  hornbound: {
    name: 'Hornbound', from: 'the Horned Warden', color: '#f59e0b',
    pieces: { weapon: {}, armor: { name: 'Hornbound Plate' }, charm: { name: 'Hornbound Totem', charm: 'crit' } },
    bonus: {
      2: [{ stat: 'posture', v: 15 }, { stat: 'broken', v: 8 }],
      3: [{ stat: 'atk', v: 5 }, { key: 'rampart', desc: 'Rampart: when you Break an enemy, you and allies within 12 m deal +10% damage for 6 s.' }],
    },
  },
  tidebound: {
    name: 'Tidebound', from: 'the Drowned Sovereign', color: '#22d3ee',
    pieces: { weapon: {}, armor: { name: 'Tidebound Mantle' }, charm: { name: 'Tidebound Pearl', charm: 'haste' } },
    bonus: {
      2: [{ stat: 'heal', v: 10 }, { stat: 'hp', v: 8 }],
      3: [{ stat: 'combo', v: 15 }, { stat: 'revive', v: 25 }, { key: 'undertow', desc: 'Undertow: your Switch hits heal you and allies within 12 m for 4% of their max health.' }],
    },
  },
};
// Tuning for the custom set rules (server/loot.js setKeyHooks).
export const SET_KEYS = {
  rampart: { r: 12, dmg: 0.1, d: 6 },
  undertow: { r: 12, heal: 0.04, cd: 2 },
};
export const setSlots = id => SLOTS.filter(s => SETS[id]?.pieces[s]);
export const setSize = id => setSlots(id).length;

// A new piece of a set for slot (the weapon is made for cls and rolls a weapon style).
export function makeSetPiece(id, slot, cls, rnd = Math.random) {
  const S = SETS[id], P = S?.pieces[slot];
  if (!P) return null;
  const it = makeItem(slot, S.r ?? 3, cls, rnd, P.charm, slot === 'weapon' ? 'roll' : undefined);
  if (S.mul && S.mul !== 1) for (const k of Object.keys(it.st)) it.st[k] = Math.round(it.st[k] * S.mul);
  if (slot === 'weapon') it.name = it.style && STYLES[it.style] && !STYLES[it.style].def ? `${S.name} ${STYLES[it.style].noun}` : recipeName({ cls: true, name: S.name }, cls);
  else it.name = P.name;
  it.set = id;
  return rollAffixes(it, cls, rnd, S.affixes ?? 2);
}

// { setId: pieces worn }
export function setCounts(eq) {
  const n = {};
  for (const s of SLOTS) { const id = eq?.[s]?.set; if (id && SETS[id]) n[id] = (n[id] || 0) + 1; }
  return n;
}
// Text of one bonus tier, e.g. ['+15% posture damage', '+8% damage to Broken enemies'].
export const effectLine = (e, cls) => (e.key ? e.desc : e.sk ? `${e.sk === 'basic' ? 'basic attack' : skillName(cls, e.sk)}: +${e.dmg}% damage` : statText(e.stat, e.v));
export const bonusLines = (id, tier, cls) => (SETS[id]?.bonus[tier] || []).map(e => effectLine(e, cls));
// Set progress for the UI: [{ id, name, color, have, size, tiers: [{ n, on, lines }] }] for every set with a piece worn
// (or every set when all = true).
export function setProgress(eq, cls, all = false) {
  const n = setCounts(eq);
  return Object.entries(SETS).filter(([id]) => all || n[id]).map(([id, S]) => ({
    id, name: S.name, color: S.color, from: S.from, have: n[id] || 0, size: setSize(id),
    tiers: Object.keys(S.bonus).map(Number).sort((a, b) => a - b).map(t => ({ n: t, on: (n[id] || 0) >= t, lines: bonusLines(id, t, cls) })),
  }));
}

// ---------- effects of worn gear ----------
// The affixes and active set bonuses of worn gear, in the talent-totals shape (shared/talents.js) plus
// cds { skillId: seconds off } and keys { setRule: 1 }.
export function gearFx(eq, cls) {
  const T = { stat: {}, sk: {}, cds: {}, keys: {} };
  const add = (k, v) => { T.stat[k] = (T.stat[k] || 0) + v; };
  for (const s of SLOTS) {
    for (const a of eq?.[s]?.ax || []) {
      if (!AFFIXES[a.k]) continue;
      if (a.k === 'skdmg') { if (a.c === cls) { const m = (T.sk[skillKey(cls, a.s)] ||= {}); m.dmg = (m.dmg || 0) + a.v; } }
      else if (a.k === 'skcd') { if (a.c === cls) T.cds[a.s] = (T.cds[a.s] || 0) + a.v; }
      else add(a.k, a.v);
    }
  }
  for (const [id, n] of Object.entries(setCounts(eq))) {
    for (const [tier, fx] of Object.entries(SETS[id].bonus)) {
      if (n < +tier) continue;
      for (const e of fx) {
        if (e.stat) add(e.stat, e.v);
        else if (e.sk) { const m = (T.sk[e.sk] ||= {}); for (const k of ['cd', 'dmg', 'fin', 'radius', 'dur']) if (e[k]) m[k] = (m[k] || 0) + e[k]; }
        else if (e.key) T.keys[e.key] = 1;
      }
    }
  }
  return T;
}

// Talent totals plus worn gear (what server/talents.js reads as p.tal). Talent keys stay; set rules go in .gear.
export function buildTotals(cls, talents, eq) {
  const T = talentTotals(cls, talents), G = gearFx(eq, cls);
  for (const [k, v] of Object.entries(G.stat)) T.stat[k] = (T.stat[k] || 0) + v;
  for (const [key, m] of Object.entries(G.sk)) { const o = (T.sk[key] ||= {}); for (const [k, v] of Object.entries(m)) o[k] = (o[k] || 0) + v; }
  T.gear = { cds: G.cds, keys: G.keys, stat: G.stat };
  return T;
}

// ---------- drop tables ----------
// Extra or overriding fields per source (see the note at the top). Merged over DROPS[type] from shared/items.js.
export const LOOT = {
  'boss:warden': { sets: [{ id: 'hornbound', chance: 0.2, la: 0.5 }] },
  'boss:sovereign': { sets: [{ id: 'tidebound', chance: 0.2, la: 0.5 }] },
  'rare:oldtusk': { sets: [{ id: 'hornbound', chance: 0.04 }] },
  'rare:ghostfang': { sets: [{ id: 'hornbound', chance: 0.04 }] },
  'rare:thornmother': { sets: [{ id: 'hornbound', chance: 0.04 }] },
  'mob:matron': { sets: [{ id: 'tidebound', chance: 0.03 }] }, // the Mire Matron (Floor 2's elite)
};
export const sourceOf = m => `${m.def?.boss ? 'boss' : m.rare ? 'rare' : 'mob'}:${m.type}`;
export function lootFor(src) {
  const type = src.slice(src.indexOf(':') + 1), base = DROPS[type], e = LOOT[src];
  if (!base && !e) return null;
  return { gold: [0, 0], item: 0, potion: 0, table: 'field', ...base, ...e };
}
// Rarity from a table name or explicit weights.
export function rollTable(table, rnd = Math.random) {
  if (!Array.isArray(table)) return rollRarity(table, rnd);
  let x = rnd() * table.reduce((a, b) => a + b, 0);
  for (let i = 0; i < table.length; i++) { x -= table[i]; if (x < 0) return i; }
  return 0;
}
// Which set piece to give: one the player doesn't own yet (worn or in the bag) if any, else any.
export function pickSetSlot(id, inv, rnd = Math.random) {
  const own = new Set([...(inv?.bag || []), ...SLOTS.map(s => inv?.eq?.[s])].filter(it => it?.set === id).map(it => it.slot));
  const all = setSlots(id), missing = all.filter(s => !own.has(s)), list = missing.length ? missing : all;
  return list[Math.floor(rnd() * list.length)];
}

// ---------- bots: how much an item is worth to a role ----------
const ROLE_W = {
  Tank: { hp: 1.2, dr: 3, threat: 0.3, haste: 0.8, revive: 0.2, skcd: 3 },
  Healer: { heal: 1.4, haste: 1.2, hp: 0.6, revive: 0.5, skcd: 3, dr: 1 },
  Support: { haste: 1.2, sw: 0.3, combo: 0.8, heal: 0.6, hp: 0.5, skcd: 3 },
  Damage: { atk: 2, crit: 1.6, posture: 0.4, sw: 0.4, broken: 0.6, skdmg: 0.6, combo: 0.5, hp: 0.3 },
};
const BASE_W = { atk: 1.5, hp: 0.6, dr: 1.5, crit: 1, haste: 1, sw: 0.25 };
export function gearScore(it, cls) {
  if (!it) return 0;
  const W = ROLE_W[CLASSES[cls]?.role] || ROLE_W.Damage;
  let s = 0;
  for (const [k, v] of Object.entries(it.st || {})) s += v * (W[k] ?? BASE_W[k] ?? 0.3);
  for (const a of it.ax || []) s += a.v * (W[a.k] ?? 0.3) * ((a.k === 'skdmg' || a.k === 'skcd') && a.c !== cls ? 0 : 1);
  return s;
}
// Affixes a premade bot item gets: the best fits for its role, mid rolls (deterministic).
const BOT_AX = {
  Tank: { weapon: ['threat', 'posture'], armor: ['hp', 'dr', 'haste'], charm: ['hp', 'haste', 'revive'] },
  Healer: { weapon: ['heal', 'crit'], armor: ['heal', 'haste', 'hp'], charm: ['heal', 'haste', 'revive'] },
  Support: { weapon: ['combo', 'sw'], armor: ['haste', 'hp', 'heal'], charm: ['haste', 'combo', 'sw'] },
  Damage: { weapon: ['atk', 'crit', 'posture'], armor: ['hp', 'haste', 'dr'], charm: ['atk', 'crit', 'combo'] },
};
export function botAffixes(it, cls) {
  const role = CLASSES[cls]?.role || 'Damage', want = (BOT_AX[role] || BOT_AX.Damage)[it.slot] || [];
  const c = AFFIX_COUNT[rarityIdx(it.r)], n = c < 1 ? 0 : c;
  const ax = want.filter(k => AFFIXES[k].slots.includes(it.slot)).slice(0, n).map(k => ({ k, v: rollValue(k, it.r, () => 0.5) }));
  if (ax.length) it.ax = ax; else delete it.ax;
  return it;
}
