// Admin API (/api/admin/*) for the admin page (/admin.html), plus the public lobby list (/api/lobby).
//
// Admins: accounts with is_admin = true, or whose Discord user id is listed in ADMIN_DISCORD_IDS (comma-separated).
// Every /api/admin/* route checks the bearer session belongs to an admin (401 signed out, 403 not an admin).
//
// Character edits go to the live player when the character is online (then saved), otherwise straight to the DB.
// Skill mastery (characters.mastery, { skillId: { pts, br } }) is edited like the rest.
// Talents (characters.talents, { nodeId: rank }, shared/talents.js) too: validated against the tree and the level.
import * as db from './db.js';
import * as accounts from './accounts.js';
import { CLASSES, MAX_LEVEL, xpToNext, areaName } from '../shared/data.js';
import { SLOTS, BAG_SIZE, RARITY, CONSUMABLE_IDS, makeItem, lastAttackItem, lastAttackItem2, lastAttackItem3, newInventory } from '../shared/items.js';
import { STYLES } from '../shared/styles.js';
import { SETS, AFFIX_COUNT, cleanAffixes, rollAffixes, rollGear, makeSetPiece, setSlots, fitAffixes, bestSetFor } from '../shared/loot.js';
import { MAT_IDS } from '../shared/crafting.js';
import { STAT_KEYS, TITLE_BY_ID, newStats } from '../shared/titles.js';
import { floorOf } from '../shared/floor2.js';
import { MASTERY, BRANCHES, newMastery, masteryLevel } from '../shared/mastery.js';
import { newTalents, allocError, TREES, spendBlock, nodesOf, pointsAt } from '../shared/talents.js';
import { BEHAVIOURS } from './botmanager.js';
import { isNamedName } from '../shared/named.js';
import * as hall from './hall.js';
import * as track from './track.js';

const q = (...a) => db.q(...a);
const ADMIN_IDS = new Set((process.env.ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,14}[A-Za-z0-9]$/; // same rule as accounts.js
const LOBBY_DAYS = 30;

let game = null, bots = null;
export function init(ctx) { game = ctx.game; bots = ctx.bots; }

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 512 * 1024) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
});
const bearer = req => (req.headers.authorization || '').replace(/^Bearer /, '');
class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const int = (v, lo, hi, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Bad(`${what} must be a whole number from ${lo} to ${hi}.`);
  return n;
};
const clone = v => JSON.parse(JSON.stringify(v ?? null));

// Is this request from an admin? Returns the account, or null after answering 401/403.
async function requireAdmin(req, res) {
  const a = await accounts.accountFromToken(bearer(req));
  if (!a) { json(res, 401, { error: 'Signed out.' }); return null; }
  if (!(await isAdmin(a))) { json(res, 403, { error: 'Admins only.' }); return null; }
  return a;
}
export async function isAdmin(a) {
  if (a.discord_id && ADMIN_IDS.has(String(a.discord_id))) return true;
  const [row] = await q('SELECT is_admin FROM accounts WHERE id = $1', [a.id]);
  return !!row?.is_admin;
}

const livePlayers = () => [...game.players.values()];
const liveChar = id => livePlayers().find(p => p.charId === id) || null;
const partyNames = p => { const pa = p.party && game.parties.get(p.party); return pa ? pa.members.filter(id => id !== p.id).map(id => game.players.get(id)?.name).filter(Boolean) : []; };
const accountLabel = r => r.discord_name || (r.discord_id ? `discord ${r.discord_id}` : `guest #${r.account_id}`);

// ---------- character model ----------
async function loadFull(id) {
  const [r] = await q(`SELECT c.id, c.name, c.cls, c.lvl, c.xp, c.gold, c.inv, c.stats, c.mastery, c.talents, c.created_at, c.updated_at,
    a.id AS account_id, a.discord_id, a.discord_name, a.is_admin
    FROM characters c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`, [id]);
  return r || null;
}

function view(r) {
  const p = liveChar(r.id);
  const src = p || r;
  const inv = src.inv && Array.isArray(src.inv.bag) ? src.inv : newInventory();
  inv.mats ||= {};
  return {
    id: r.id, name: p ? p.name : r.name, cls: p ? p.cls : r.cls, lvl: src.lvl, xp: src.xp, next: xpToNext(src.lvl), gold: src.gold,
    inv, stats: { ...(src.stats || {}), ...newStats(src.stats) }, mastery: newMastery(src.mastery, p ? p.cls : r.cls), talents: newTalents(src.talents, p ? p.cls : r.cls, src.lvl), online: !!p,
    area: p ? areaName(p.x, p.z) : null, floor: p ? floorOf(p.x) : null, party: p ? partyNames(p) : [],
    account: { id: r.account_id, label: accountLabel(r), discord: r.discord_name || null, admin: !!r.is_admin },
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

// Validate one gear item (from the raw JSON editor). Returns a clean copy.
function cleanItem(it, where) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) throw new Bad(`${where}: not an item object.`);
  if (!SLOTS.includes(it.slot)) throw new Bad(`${where}: slot must be one of ${SLOTS.join(', ')}.`);
  if (!Number.isInteger(it.r) || !RARITY[it.r]) throw new Bad(`${where}: r (rarity) must be 0..${RARITY.length - 1}.`);
  if (typeof it.name !== 'string' || !it.name) throw new Bad(`${where}: needs a name.`);
  if (!it.st || typeof it.st !== 'object' || Object.values(it.st).some(v => typeof v !== 'number' || !isFinite(v))) throw new Bad(`${where}: st must be an object of numbers.`);
  if (it.cls !== undefined && !CLASSES[it.cls]) throw new Bad(`${where}: unknown class ${it.cls}.`);
  if (it.style !== undefined && (STYLES[it.style]?.cls !== it.cls || it.slot !== 'weapon')) throw new Bad(`${where}: style ${it.style} isn't a ${CLASSES[it.cls]?.name || '?'} weapon style.`);
  const out = clone(it);
  checkLoot(out, where);
  return out;
}
// Affixes and set of an item (shared/loot.js): validated in place.
function checkLoot(it, where) {
  if (it.set != null && !SETS[it.set]?.pieces[it.slot]) throw new Bad(`${where}: ${it.set} has no ${it.slot} piece (sets: ${Object.keys(SETS).join(', ')}).`);
  if (it.set == null) delete it.set;
  try { const ax = cleanAffixes(it.ax, it.slot); if (ax?.length) it.ax = ax; else delete it.ax; } catch (e) { throw new Bad(`${where}: ${e}`); }
}

// Normalise and validate a whole inventory; gives every item a unique u.
function cleanInv(inv) {
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) throw new Bad('inv must be an object.');
  if (!Array.isArray(inv.bag)) throw new Bad('inv.bag must be an array.');
  if (inv.bag.length > BAG_SIZE) throw new Bad(`The bag holds at most ${BAG_SIZE} items.`);
  if (!inv.eq || typeof inv.eq !== 'object') throw new Bad('inv.eq must be an object.');
  const out = { ...clone(inv), bag: inv.bag.map((it, i) => cleanItem(it, `bag[${i}]`)), eq: {}, cons: {}, mats: {} };
  if (inv.loadouts !== undefined && (!Array.isArray(inv.loadouts) || inv.loadouts.length > 3)) throw new Bad('inv.loadouts must be a list of at most 3 (null or { n, eq, tal }).');
  for (const s of SLOTS) {
    const it = inv.eq[s];
    if (it == null) { out.eq[s] = null; continue; }
    const c = cleanItem(it, `eq.${s}`);
    if (c.slot !== s) throw new Bad(`eq.${s} holds a ${c.slot}.`);
    out.eq[s] = c;
  }
  for (const k of Object.keys(inv.cons || {})) if (!CONSUMABLE_IDS.includes(k)) throw new Bad(`Unknown consumable ${k}.`);
  for (const k of CONSUMABLE_IDS) out.cons[k] = int(inv.cons?.[k] ?? 0, 0, 999, `cons.${k}`);
  for (const k of Object.keys(inv.mats || {})) if (!MAT_IDS.includes(k)) throw new Bad(`Unknown material ${k}.`);
  for (const k of MAT_IDS) { const n = int(inv.mats?.[k] ?? 0, 0, 99999, `mats.${k}`); if (n) out.mats[k] = n; }
  const seen = new Set();
  let u = Date.now() % 1e6 + 5e5;
  for (const it of [...out.bag, ...SLOTS.map(s => out.eq[s]).filter(Boolean)]) {
    if (!Number.isInteger(it.u) || seen.has(it.u)) it.u = ++u;
    while (seen.has(it.u)) it.u = ++u;
    seen.add(it.u);
  }
  return out;
}

// Lifetime stats: known keys normalised (numbers, titles), anything else (e.g. skill mastery) kept as-is.
function cleanStats(st) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) throw new Bad('stats must be an object.');
  for (const k of STAT_KEYS) if (st[k] !== undefined && (typeof st[k] !== 'number' || st[k] < 0)) throw new Bad(`stats.${k} must be a number ≥ 0.`);
  if (st.titles !== undefined && !Array.isArray(st.titles)) throw new Bad('stats.titles must be an array.');
  return { ...clone(st), ...newStats(st) };
}

// Apply an edit body to a working copy c = { name, cls, lvl, xp, gold, inv, stats }.
function applyEdit(c, body, online) {
  if (body.rawInv !== undefined) c.inv = cleanInv(body.rawInv);
  if (body.rawStats !== undefined) c.stats = cleanStats(body.rawStats);
  if (body.rawMastery !== undefined) {
    if (!body.rawMastery || typeof body.rawMastery !== 'object' || Array.isArray(body.rawMastery)) throw new Bad('mastery must be an object.');
    c.mastery = newMastery(body.rawMastery, c.cls);
  }
  const talentsIn = body.rawTalents !== undefined ? body.rawTalents : body.talents; // { nodeId: rank } (raw editor or the talents section)
  if (talentsIn !== undefined) {
    if (!talentsIn || typeof talentsIn !== 'object' || Array.isArray(talentsIn)) throw new Bad('talents must be an object of { nodeId: rank }.');
    c.talents = Object.fromEntries(Object.entries(talentsIn).filter(([, r]) => r !== 0).map(([k, r]) => [k, Number(r)]));
    const err = allocError(c.cls, c.talents);
    if (err) throw new Bad(`talents: ${err}`);
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(name)) throw new Bad('Names are 3–16 letters or numbers (spaces, _ . - allowed inside).');
    if (process.env.NAMED_ENABLED !== '0' && isNamedName(name)) throw new Bad('That name belongs to one of the Named.', 409);
    c.name = name;
  }
  if (body.cls !== undefined && body.cls !== c.cls) {
    if (!CLASSES[body.cls]) throw new Bad('Unknown class.');
    if (online) throw new Bad('Change the class while the character is offline.');
    c.cls = body.cls;
    c.mastery = newMastery(c.mastery, c.cls); // the new class's skills (start fresh)
    c.talents = {}; // a different tree
    const w = c.inv.eq.weapon; // a weapon for the old class goes back to the bag
    if (w?.cls && w.cls !== c.cls) {
      if (c.inv.bag.length >= BAG_SIZE) throw new Bad('Bag full: make room for the old weapon first.');
      c.inv.bag.push(w); c.inv.eq.weapon = null;
    }
  }
  if (body.lvl !== undefined) c.lvl = int(body.lvl, 1, MAX_LEVEL, 'Level');
  if (body.xp !== undefined) c.xp = int(body.xp, 0, 1e9, 'XP');
  if (c.lvl >= MAX_LEVEL) c.xp = 0; else c.xp = Math.min(c.xp, xpToNext(c.lvl) - 1);
  if (body.gold !== undefined) c.gold = int(body.gold, 0, 1e9, 'Gold');
  if (body.cons) for (const [k, v] of Object.entries(body.cons)) { if (!CONSUMABLE_IDS.includes(k)) throw new Bad(`Unknown consumable ${k}.`); c.inv.cons[k] = int(v, 0, 999, k); }
  if (body.mats) for (const [k, v] of Object.entries(body.mats)) {
    if (!MAT_IDS.includes(k)) throw new Bad(`Unknown material ${k}.`);
    const n = int(v, 0, 99999, k);
    c.inv.mats ||= {};
    if (n) c.inv.mats[k] = n; else delete c.inv.mats[k];
  }
  if (body.stats) for (const [k, v] of Object.entries(body.stats)) {
    if (!STAT_KEYS.includes(k)) throw new Bad(`Unknown stat ${k}.`);
    c.stats[k] = int(v, 0, 1e9, k);
  }
  if (body.floor2 !== undefined) c.stats.floor2 = body.floor2 ? 1 : 0;
  if (body.floor3 !== undefined) c.stats.floor3 = body.floor3 ? 1 : 0;
  if (body.titles !== undefined) {
    if (!Array.isArray(body.titles)) throw new Bad('titles must be a list.');
    c.stats.titles = [...new Set(body.titles.filter(id => TITLE_BY_ID[id]))];
    if (c.stats.activeTitle && !c.stats.titles.includes(c.stats.activeTitle)) c.stats.activeTitle = null;
  }
  if (body.activeTitle !== undefined) {
    const t = body.activeTitle || null;
    if (t && !c.stats.titles.includes(t)) throw new Bad('The active title must be one the character has earned.');
    c.stats.activeTitle = t;
  }
  if (body.mastery) { // { skillId: { lvl (1..5) or pts, br: 'A' | 'B' | null } }
    for (const [sk, v] of Object.entries(body.mastery)) {
      const e = c.mastery[sk];
      if (!e || !v || typeof v !== 'object') throw new Bad(`${sk} is not a ${CLASSES[c.cls].name} skill.`);
      if (v.pts !== undefined) e.pts = int(v.pts, 0, 1e7, `${sk} points`);
      if (v.lvl !== undefined) { const l = int(v.lvl, 1, MASTERY.max, `${sk} mastery`); if (masteryLevel(e.pts) !== l) e.pts = MASTERY.need[l]; }
      if (v.br !== undefined) {
        if (v.br !== null && v.br !== 'A' && v.br !== 'B') throw new Bad('Branch must be A, B or none.');
        if (v.br && !BRANCHES[sk]) throw new Bad(`${sk} has no evolutions.`);
        e.br = v.br;
      }
    }
  }
  if (body.preset === 'maxed') maxOut(c);
  for (const op of Array.isArray(body.ops) ? body.ops : []) applyOp(c, op);
  if (allocError(c.cls, c.talents, c.lvl)) { // more points than the level gives
    if (talentsIn !== undefined) throw new Bad(`talents: ${allocError(c.cls, c.talents, c.lvl)}`);
    c.talents = {}; // the level went down: refund everything
  }
}

// "Maxed" preset: max level, Floors 2 and 3, every skill Mastery 5 (evolved), all talent points spent, best gear, a stock of consumables.
// Talents follow the class's recommended path (TREES[cls].bot), then any points left go to the first node that accepts one.
// Gear: a full boss set for the class role (shared/loot.js bestSetFor; the weapon keeps the worn weapon's style), top stat
// rolls and 3 top role-fit affixes per piece. What was worn goes to the bag while there's room, then the two Last Attack
// items if the character doesn't have them.
function maxOut(c) {
  c.lvl = MAX_LEVEL; c.xp = 0; c.stats.floor2 = 1; c.stats.floor3 = 1;
  for (const [sk, e] of Object.entries(c.mastery)) { e.pts = Math.max(e.pts | 0, MASTERY.need[MASTERY.max]); if (!e.br && BRANCHES[sk]) e.br = 'A'; }
  const t = {}, total = pointsAt(c.lvl), want = {};
  for (const id of TREES[c.cls]?.bot || []) { want[id] = (want[id] || 0) + 1; if ((t[id] | 0) < want[id] && !spendBlock(c.cls, t, c.lvl, id)) t[id] = (t[id] | 0) + 1; }
  for (let more = true; more;) { more = false; for (const n of nodesOf(c.cls)) if (!spendBlock(c.cls, t, c.lvl, n.id)) { t[n.id] = (t[n.id] | 0) + 1; more = true; break; } }
  if (Object.values(t).reduce((a, r) => a + r, 0) <= total) c.talents = t;
  const worn = c.inv.eq.weapon, style = worn?.cls === c.cls ? worn.style : undefined;
  const top = () => 0.999; // the highest roll for every stat
  const set = bestSetFor(c.cls), gear = {};
  for (const s of SLOTS) gear[s] = SETS[set].pieces[s] ? makeSetPiece(set, s, c.cls, top, style) : makeItem(s, 3, s === 'weapon' ? c.cls : undefined, top, undefined, s === 'weapon' ? style : undefined);
  for (const s of SLOTS) {
    fitAffixes(gear[s], c.cls, AFFIX_COUNT[3], 0.999);
    const old = c.inv.eq[s];
    if (old && c.inv.bag.length < BAG_SIZE) c.inv.bag.push(old);
    gear[s].u = freeU(c.inv); c.inv.eq[s] = gear[s];
  }
  const owns = la => [...c.inv.bag, ...SLOTS.map(s => c.inv.eq[s])].some(it => it?.la === la);
  for (const [la, make] of [[1, lastAttackItem], [2, lastAttackItem2], [3, lastAttackItem3]]) if (!owns(la) && c.inv.bag.length < BAG_SIZE) giveToBag(c, make());
  for (const k of CONSUMABLE_IDS) c.inv.cons[k] = Math.max(c.inv.cons[k] | 0, 20);
}

function freeU(inv) {
  const used = new Set([...inv.bag, ...SLOTS.map(s => inv.eq[s]).filter(Boolean)].map(it => it.u));
  let u = Date.now() % 1e6 + 7e5;
  while (used.has(u)) u++;
  return u;
}
function giveToBag(c, it) {
  if (c.inv.bag.length >= BAG_SIZE) throw new Bad('The bag is full.');
  it.u = freeU(c.inv);
  c.inv.bag.push(it);
}

function applyOp(c, op) {
  switch (op?.op) {
    case 'addItem': {
      if (!SLOTS.includes(op.slot)) throw new Bad('Pick a slot.');
      const r = int(op.r, 0, 3, 'Rarity');
      const cls = op.slot === 'weapon' ? (CLASSES[op.cls] ? op.cls : c.cls) : undefined;
      const charm = ['crit', 'haste', 'sw'].includes(op.charm) ? op.charm : undefined;
      const style = cls && STYLES[op.style]?.cls === cls ? op.style : undefined; // weapon style (shared/styles.js)
      return giveToBag(c, op.ax === false ? makeItem(op.slot, r, cls, Math.random, charm, style) : rollGear(op.slot, r, cls || c.cls, Math.random, charm, style)); // affixes by rarity unless ax: false
    }
    case 'addSet': { // { set, slot: 'weapon' | 'armor' | 'charm' | 'all', style }
      if (!SETS[op.set]) throw new Bad('Unknown set.');
      const slots = op.slot === 'all' ? setSlots(op.set) : [op.slot];
      if (!slots.every(s => SETS[op.set].pieces[s])) throw new Bad(`${SETS[op.set].name} has no ${op.slot} piece.`);
      if (c.inv.bag.length + slots.length > BAG_SIZE) throw new Bad('The bag is full.');
      const style = STYLES[op.style]?.cls === c.cls ? op.style : undefined;
      for (const s of slots) giveToBag(c, makeSetPiece(op.set, s, c.cls, Math.random, style));
      return;
    }
    case 'editItem': { // { u, ax: [{ k, v, s?, c? }] | 'roll', set: id | null }: an item's affixes and set
      const it = [...c.inv.bag, ...SLOTS.map(s => c.inv.eq[s])].find(x => x && x.u === (op.u | 0));
      if (!it) throw new Bad('No such item.');
      if (it.ks) throw new Bad('Keepsakes have no affixes.');
      if (op.ax === 'roll') { const t = rollAffixes({ ...it, la: 0 }, it.cls || c.cls); it.ax = t.ax; } // fresh affixes by rarity (Last Attack items too)
      else if (op.ax !== undefined) it.ax = op.ax;
      if (op.set !== undefined) it.set = op.set || null;
      checkLoot(it, 'item');
      return;
    }
    case 'addLastAttack': return giveToBag(c, op.which === 3 ? lastAttackItem3() : op.which === 2 ? lastAttackItem2() : lastAttackItem());
    case 'removeItem': {
      const u = op.u | 0;
      const i = c.inv.bag.findIndex(it => it.u === u);
      if (i >= 0) return void c.inv.bag.splice(i, 1);
      const s = SLOTS.find(s => c.inv.eq[s]?.u === u);
      if (s) return void (c.inv.eq[s] = null);
      throw new Bad('No such item.');
    }
    case 'equip': { // bag -> worn (whatever was worn goes to the bag)
      const i = c.inv.bag.findIndex(it => it.u === (op.u | 0));
      if (i < 0) throw new Bad('No such bag item.');
      const it = c.inv.bag[i];
      if (it.cls && it.cls !== c.cls) throw new Bad(`Only a ${CLASSES[it.cls].name} can use that.`);
      c.inv.bag.splice(i, 1);
      if (c.inv.eq[it.slot]) c.inv.bag.push(c.inv.eq[it.slot]);
      c.inv.eq[it.slot] = it;
      return;
    }
    case 'unequip': {
      if (!SLOTS.includes(op.slot) || !c.inv.eq[op.slot]) throw new Bad('Nothing worn there.');
      if (c.inv.bag.length >= BAG_SIZE) throw new Bad('The bag is full.');
      c.inv.bag.push(c.inv.eq[op.slot]); c.inv.eq[op.slot] = null;
      return;
    }
    default: throw new Bad(`Unknown op ${op?.op}.`);
  }
}

async function editCharacter(id, body) {
  const r = await loadFull(id);
  if (!r) throw new Bad('No such character.', 404);
  let p = liveChar(id);
  const src = p || r;
  const c = {
    name: p ? p.name : r.name, cls: p ? p.cls : r.cls, lvl: src.lvl, xp: src.xp, gold: src.gold,
    inv: clone(src.inv && Array.isArray(src.inv.bag) ? src.inv : newInventory()), stats: { ...clone(src.stats || {}), ...newStats(src.stats) },
    mastery: newMastery(clone(src.mastery), p ? p.cls : r.cls), talents: newTalents(clone(src.talents), p ? p.cls : r.cls, src.lvl),
  };
  c.inv.mats ||= {};
  applyEdit(c, body, !!p);
  if (c.name !== (p ? p.name : r.name)) { // rename (names are unique, case-insensitive)
    try { await q('UPDATE characters SET name = $2 WHERE id = $1', [id, c.name]); }
    catch (e) { if (e.code === '23505') throw new Bad('That name is taken.', 409); throw e; }
  }
  p = liveChar(id); // (it may have come online meanwhile)
  if (p) {
    // Online: change the live player first (so the periodic save can't write old values back), then save.
    const lvlChanged = p.lvl !== c.lvl;
    Object.assign(p, { name: c.name, lvl: c.lvl, xp: c.xp, gold: c.gold, inv: c.inv, stats: c.stats, mastery: c.mastery });
    game.setTalents(p, c.talents); // re-sends the Skill Tree data
    p.masteryDirty = p.masteryNow = true; // re-send the Skills panel data
    game.recompute(p);
    if (lvlChanged) p.hp = p.maxHp;
    game.invChanged(p);
    game.rosterDirty = true; // name / title
    game.sys('An admin updated your character.', p.id);
    p.dirty = false;
    await accounts.saveCharacter(p);
  } else {
    await q('UPDATE characters SET cls = $2, lvl = $3, xp = $4, gold = $5, inv = $6, stats = $7, mastery = $8, talents = $9 WHERE id = $1',
      [id, c.cls, c.lvl, c.xp, c.gold, JSON.stringify(c.inv), JSON.stringify(c.stats), JSON.stringify(c.mastery), JSON.stringify(c.talents)]);
  }
  return view(await loadFull(id));
}

async function deleteCharacter(id) {
  const p = liveChar(id);
  if (p) { // kick them first (no save: the row is about to go)
    p.charId = 0;
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'denied', reason: 'This character was deleted by an admin.' }));
    game.removePlayer(p);
    game.rosterDirty = true;
    p.ws.close();
  }
  const rows = await q('DELETE FROM characters WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

// ---------- players list ----------
async function playersList() {
  const rows = await q(`SELECT c.id, c.name, c.cls, c.lvl, c.created_at, c.updated_at,
    a.id AS account_id, a.discord_id, a.discord_name, a.is_admin
    FROM characters c JOIN accounts a ON a.id = c.account_id ORDER BY c.updated_at DESC LIMIT 5000`);
  const live = new Map(livePlayers().filter(p => p.charId).map(p => [p.charId, p]));
  const out = rows.map(r => {
    const p = live.get(r.id);
    return {
      id: r.id, name: p ? p.name : r.name, cls: r.cls, lvl: p ? p.lvl : r.lvl, account: accountLabel(r), accountId: r.account_id, admin: !!r.is_admin,
      online: !!p, area: p ? areaName(p.x, p.z) : null, floor: p ? floorOf(p.x) : null, party: p ? partyNames(p) : [],
      lastSeen: p ? new Date().toISOString() : r.updated_at, created: r.created_at,
    };
  });
  // Anonymous (unsaved) players who are online right now
  const anon = livePlayers().filter(p => !p.charId && !p.bot).map(p => ({ gameId: p.id, name: p.name, cls: p.cls, lvl: p.lvl, area: areaName(p.x, p.z), floor: floorOf(p.x) }));
  const nbots = livePlayers().filter(p => p.bot && !p.named).length; // (the Named have their own card: server/named.js)
  return { players: out, anon, bots: nbots };
}

// ---------- dashboard summary strip ----------
function summary() {
  const live = livePlayers(), h = hall.message();
  const clears = [...(h.recent || []), ...(h.floors?.[2]?.recent || [])].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6)
    .map(r => ({ at: r.at, floor: r.floor, secs: r.secs, deaths: r.deaths, players: r.players.map(p => ({ name: p.name, cls: p.cls })), lastAttack: r.lastAttack }));
  return {
    players: live.filter(p => !p.bot).length, accounts: live.filter(p => !p.bot && p.charId).length, bots: live.filter(p => p.bot && !p.named).length, named: live.filter(p => p.named).length, maxBots: bots.max,
    uptime: Math.round(process.uptime()), floorClears: game.floorClears,
    twist: game.twist ? { id: game.twist.id, name: game.twist.name } : null, clears,
  };
}

// ---------- routes ----------
export async function handle(req, res, url) {
  const path = url.pathname;
  if (path === '/api/lobby') { // public: recently seen characters for the in-game Players panel (no account details)
    if (!db.enabled) return json(res, 200, { offline: [] }), true;
    try {
      const online = new Set(livePlayers().filter(p => p.charId).map(p => p.charId));
      const rows = await q(`SELECT id, name, cls, lvl, updated_at FROM characters WHERE updated_at > now() - interval '${LOBBY_DAYS} days' ORDER BY updated_at DESC LIMIT 60`);
      return json(res, 200, { offline: rows.filter(r => !online.has(r.id)).slice(0, 40).map(r => ({ name: r.name, cls: r.cls, lvl: r.lvl, seen: r.updated_at })) }), true;
    } catch (e) { console.error('lobby error', e); return json(res, 500, { error: 'Server error' }), true; }
  }
  if (!path.startsWith('/api/admin/')) return false;
  if (!db.enabled) return json(res, 503, { error: 'Admin needs accounts (set DATABASE_URL).' }), true;
  try {
    if (path === '/api/admin/me') {
      const a = await accounts.accountFromToken(bearer(req));
      if (!a) return json(res, 401, { admin: false, error: 'Signed out.' }), true;
      return json(res, 200, { admin: await isAdmin(a), account: { id: a.id, discord: a.discord_name || null } }), true;
    }
    if (!(await requireAdmin(req, res))) return true;
    const m = req.method;
    let mm;

    if (path === '/api/admin/players' && m === 'GET') return json(res, 200, await playersList()), true;
    if (path === '/api/admin/summary' && m === 'GET') return json(res, 200, summary()), true;
    if (path === '/api/admin/stats' && m === 'GET') return json(res, 200, await track.detail(Number(url.searchParams.get('days')) || 7)), true; // stats dashboard (/stats.html)

    if ((mm = path.match(/^\/api\/admin\/characters\/(\d+)$/))) {
      const id = +mm[1];
      if (m === 'GET') {
        const r = await loadFull(id);
        return r ? json(res, 200, { character: view(r) }) : json(res, 404, { error: 'No such character.' }), true;
      }
      if (m === 'PATCH' || m === 'POST') {
        const body = await readBody(req);
        if (!body) return json(res, 400, { error: 'Bad JSON.' }), true;
        return json(res, 200, { character: await editCharacter(id, body) }), true;
      }
      if (m === 'DELETE') {
        const body = await readBody(req);
        const r = await loadFull(id);
        if (!r) return json(res, 404, { error: 'No such character.' }), true;
        if (body?.confirm !== r.name) return json(res, 400, { error: 'Type the character name to confirm.' }), true;
        return json(res, 200, { ok: await deleteCharacter(id) }), true;
      }
    }

    if (path === '/api/admin/bots' && m === 'GET') {
      return json(res, 200, {
        bots: bots.list(), max: bots.max, behaviours: BEHAVIOURS, skills: bots.skillTable(),
        players: bots.realPlayers().map(p => ({ id: p.id, name: p.name, cls: p.cls, lvl: p.lvl })),
      }), true;
    }
    if (path === '/api/admin/bots' && m === 'POST') {
      const b = await readBody(req) || {};
      return json(res, 200, { added: bots.add({ cls: b.cls, name: b.name, lvl: b.lvl, behaviour: b.behaviour, follow: b.follow, skill: b.skill }) }), true;
    }
    if (path === '/api/admin/bots/team' && m === 'POST') {
      const b = await readBody(req) || {};
      return json(res, 200, { added: bots.addTeam({ lvl: b.lvl, behaviour: b.behaviour || 'auto', follow: b.follow, skill: b.skill }) }), true;
    }
    if (path === '/api/admin/bots' && m === 'DELETE') return json(res, 200, { removed: bots.removeAll() }), true;
    if ((mm = path.match(/^\/api\/admin\/bots\/(\d+)$/)) && m === 'DELETE') {
      return bots.remove(+mm[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'No such bot.' }), true;
    }
    if ((mm = path.match(/^\/api\/admin\/bots\/(\d+)$/)) && m === 'PATCH') { // live edit: name, lvl, skill, behaviour, follow
      const b = await readBody(req);
      if (!b) return json(res, 400, { error: 'Bad JSON.' }), true;
      return json(res, 200, { bot: bots.edit(+mm[1], b) }), true;
    }
    if ((mm = path.match(/^\/api\/admin\/bots\/(\d+)\/(teleport|kill|revive|heal|respawn|command)$/)) && m === 'POST') {
      const b = await readBody(req) || {};
      return json(res, 200, { bot: bots.action(+mm[1], mm[2], b) }), true;
    }
    return json(res, 404, { error: 'Unknown admin route.' }), true;
  } catch (e) {
    if (e instanceof Bad || e.name === 'BotError') return json(res, e.code, { error: e.message }), true;
    if (e.message && /^(Pick|Unknown behaviour|Bot limit)/.test(e.message)) return json(res, 400, { error: e.message }), true;
    console.error('admin error', e);
    json(res, 500, { error: 'Server error' });
    return true;
  }
}
