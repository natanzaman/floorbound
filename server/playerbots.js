// Player-owned bots: players add bots from the in-game Players panel (P → Bots tab), on top of the admin-managed
// BotManager (server/botmanager.js). This module only uses BotManager's API (add / edit / remove / list / view /
// joinParty / livePlayer) plus two small hooks: index.js routes { type: 'pbot' } messages here, and roster entries of
// owned bots get the owner's name.
//
// Protocol (client → server):  { type: 'pbot', op: 'list' }
//                               { type: 'pbot', op: 'add', cls, skill (1-5, default 4), name? }
//                               { type: 'pbot', op: 'edit', bid, skill?, mode? ('follow'|'field'|'warden'|'stay'), name? }
//                               { type: 'pbot', op: 'dismiss', bid }
// Replies (server → client):   { type: 'pbot', op, ok: true, msg?, list }  or  { type: 'pbot', op, ok: false, error, list? }
//   list = { bots: [...], mine, max, total, cap, admin, partyMax }  (every bot in the world, your own first)
//
// Rules: up to PLAYER_BOT_MAX bots per player (default 3), counted against the global MAX_BOTS; a new bot is made at
// the owner's level with a premade loadout (shared/playerbots.js), joins the owner's party (made if needed, never past
// PARTY_MAX) and follows them. Only the owner (or an admin: accounts.is_admin / ADMIN_DISCORD_IDS) can edit or dismiss
// it. When the owner leaves, their bots wait PLAYER_BOT_GRACE seconds (default 60) for a reconnect, then go.
import { CLASSES, MAX_LEVEL, PARTY_MAX } from '../shared/data.js';
import { makeItem, SLOTS } from '../shared/items.js';
import { MASTERY, masteryLevel } from '../shared/mastery.js';
import { clampSkill, skillName } from '../shared/botskill.js';
import { MODES, loadoutFor, charmFor, defaultBranch, cleanBotName } from '../shared/playerbots.js';
import * as db from './db.js';
import { isAdmin } from './admin.js';

class PbError extends Error {}
const fail = msg => { throw new PbError(msg); };
const OTHER_DOING = { follow: 'Following', field: 'Farming the field', warden: 'Heading for the Warden', floor2: 'On Floor 2', auto: 'Levelling up' };

export class PlayerBots {
  constructor(game, mgr, { max = Number(process.env.PLAYER_BOT_MAX) || 3, grace = Number(process.env.PLAYER_BOT_GRACE) || 60 } = {}) {
    this.game = game; this.mgr = mgr; this.max = max; this.grace = grace;
    this.owned = new Map(); // bid -> { bid, ownerId, charId, anonName, ownerName, mode, outfitted, wantParty, lastParty, goneAt, goneT }
    // Hook: owned bots carry their owner's name (and what they were told to do) in the roster.
    const roster = game.roster.bind(game);
    game.roster = () => {
      const byId = new Map();
      for (const rec of this.owned.values()) { const e = this.entry(rec.bid), p = e && mgr.livePlayer(e); if (p) byId.set(p.id, rec); }
      return roster().map(r => { const rec = r.bot && byId.get(r.id); return rec ? { ...r, owner: rec.ownerName, mode: rec.mode } : r; });
    };
    this.timer = setInterval(() => this.upkeep(), 500);
    this.timer.unref?.();
  }

  // ---------- lookups ----------
  entry(bid) { return this.mgr.bots.find(e => e.bid === bid && !e.b.closed) || null; }
  isMine(p, rec) { return !!rec && (rec.ownerId === p.id || (!!rec.charId && rec.charId === p.charId)); }
  mine(p) { return [...this.owned.values()].filter(rec => this.isMine(p, rec)); }
  ownerOf(rec) { // the owner, if online (and re-adopts a reconnected owner)
    const g = this.game;
    const o = g.players.get(rec.ownerId);
    if (o && !o.bot && (rec.charId ? o.charId === rec.charId : !o.charId && o.name.toLowerCase() === rec.anonName)) return o;
    for (const q of g.players.values()) {
      if (q.bot) continue;
      if (rec.charId ? q.charId === rec.charId : !q.charId && q.name.toLowerCase() === rec.anonName && rec.goneAt && q.joinedAt >= rec.goneT) return q;
    }
    return null;
  }

  async adminOf(p) { // accounts.is_admin (or ADMIN_DISCORD_IDS), cached for 30 s
    if (!p.accountId || !db.enabled) return false;
    const c = p.pbAdmin;
    if (c && Date.now() - c.at < 30000) return c.v;
    let v = false;
    try { const [a] = await db.q('SELECT id, discord_id FROM accounts WHERE id = $1', [p.accountId]); v = !!a && await isAdmin(a); } catch { v = false; }
    p.pbAdmin = { v, at: Date.now() };
    return v;
  }

  // ---------- messages ----------
  reply(p, o) { if (p.ws?.readyState === 1) p.ws.send(JSON.stringify({ type: 'pbot', ...o })); }

  async handle(p, msg) {
    if (!p || p.bot) return;
    const op = String(msg.op || '');
    const now = Date.now();
    if (op === 'list') { // polled while the Bots tab is open
      if (now - (p.pbListAt || 0) < 250) return;
      p.pbListAt = now;
      return this.reply(p, { op, ok: true, list: this.list(p, await this.adminOf(p)) });
    }
    const r = (p.pbRate ||= { n: 0, at: now });
    if (now - r.at > 5000) { r.n = 0; r.at = now; }
    if (++r.n > 10) return this.reply(p, { op, ok: false, error: 'Slow down a little.' });
    const admin = await this.adminOf(p);
    try {
      let out;
      if (op === 'add') out = this.add(p, msg);
      else if (op === 'edit') out = this.edit(p, msg, admin);
      else if (op === 'dismiss') out = this.dismiss(p, msg, admin);
      else fail('Unknown bot command.');
      this.reply(p, { op, ok: true, ...out, list: this.list(p, admin) });
    } catch (e) {
      if (!(e instanceof PbError) && !e.code) console.error('pbot', e);
      this.reply(p, { op, ok: false, error: e.message || 'Something went wrong.', list: this.list(p, admin) });
    }
  }

  // ---------- add ----------
  add(p, msg) {
    const g = this.game;
    const cls = String(msg.cls || '');
    if (!CLASSES[cls]) fail('Pick a class.');
    const skill = msg.skill === undefined ? clampSkill() : Number(msg.skill);
    if (!Number.isInteger(skill) || skill < 1 || skill > 5) fail('Skill level must be 1-5.');
    const name = cleanBotName(msg.name);
    if (msg.name && String(msg.name).trim() && name.length < 2) fail('Bot names are 2-16 letters, numbers, spaces, _ . -');
    if (p.dead) fail('Wait until you are back on your feet.');
    const mine = this.mine(p);
    if (mine.length >= this.max) fail(`You already have ${this.max} bots (the most you can have). Dismiss one first.`);
    const party = g.partyOf(p);
    const pending = mine.filter(rec => { const e = this.entry(rec.bid), b = e && this.mgr.livePlayer(e); return !b || !party || b.party !== party.id; }).length;
    if ((party ? party.members.length : 1) + pending >= PARTY_MAX) fail(`Your party is full (${PARTY_MAX}/${PARTY_MAX}). Make room before adding a bot.`);
    if (this.mgr.count() >= this.mgr.max) fail(`The server's bot limit is reached (${this.mgr.max}). Try again later.`);
    const lvl = Math.min(MAX_LEVEL, Math.max(1, p.lvl | 0));
    let view;
    try { view = this.mgr.add({ cls, name, lvl, behaviour: 'follow', follow: p.name, skill }); }
    catch (e) { fail(e.message); }
    const e = this.entry(view.bid);
    if (e) e.partied = true; // party joining is ours (upkeep), not BotManager's
    this.owned.set(view.bid, {
      bid: view.bid, ownerId: p.id, charId: p.charId || 0, anonName: p.charId ? '' : p.name.toLowerCase(), ownerName: p.name,
      mode: 'follow', outfitted: false, wantParty: true, lastParty: 0, goneAt: 0, goneT: 0,
    });
    g.rosterDirty = true;
    return { msg: `${view.name} the ${CLASSES[cls].name} (Lv ${lvl}, ${skillName(skill)}) is on the way.`, bid: view.bid };
  }

  // ---------- edit / dismiss ----------
  manageable(p, bid, admin) {
    bid = Number(bid);
    const e = this.entry(bid);
    if (!e) fail('That bot is gone.');
    const rec = this.owned.get(bid);
    if (!admin && !this.isMine(p, rec)) fail(rec ? `That's ${rec.ownerName}'s bot.` : 'Only admins can manage that bot.');
    return { e, rec };
  }

  edit(p, msg, admin) {
    const { e, rec } = this.manageable(p, msg.bid, admin);
    const g = this.game;
    // validate first, so a bad field changes nothing
    let skill, mode, name;
    if (msg.skill !== undefined) { skill = Number(msg.skill); if (!Number.isInteger(skill) || skill < 1 || skill > 5) fail('Skill level must be 1-5.'); }
    if (msg.mode !== undefined) { mode = String(msg.mode); if (!MODES[mode]) fail('Unknown behaviour.'); }
    if (msg.name !== undefined) {
      name = cleanBotName(msg.name);
      if (name.length < 2) fail('Bot names are 2-16 letters, numbers, spaces, _ . -');
    }
    if (!this.mgr.livePlayer(e)) fail('That bot is still joining.');
    const said = [], was = e.b.name;
    if (name !== undefined && name !== e.b.name) { try { this.mgr.edit(e.bid, { name }); } catch (err) { fail(err.message); } said.push(`renamed to ${name}`); }
    if (skill !== undefined && skill !== e.b.skill) { this.mgr.edit(e.bid, { skill }); said.push(`skill ${skillName(skill)}`); }
    if (mode !== undefined) {
      const owner = rec ? this.ownerOf(rec) : p; // a server bot follows the admin who told it to
      this.setMode(e, mode, owner?.name || rec?.ownerName || p.name, { by: owner || p, adm: !this.isMine(p, rec) });
      if (rec) { rec.mode = mode; rec.wantParty = true; }
      said.push(MODES[mode].name.toLowerCase());
    }
    g.rosterDirty = true;
    return { msg: said.length ? `${was}: ${said.join(', ')}.` : 'Nothing changed.' };
  }

  // A mode is a BotManager behaviour + follow target. Set on the bot's brain directly (BotManager.edit would make a
  // follower leave the party, and 'stay' has no follow target): the same calls BotManager.edit makes. A brain that
  // takes party orders (b.command: follow / stay / farm / boss) also gets the matching order, so it holds even with
  // a human in its party.
  setMode(e, mode, followName, { by = null, adm = false } = {}) {
    const M = MODES[mode];
    const follow = M.follow ? followName : '';
    e.group.configure({ behaviour: M.behaviour, follow });
    e.behaviour = M.behaviour; e.follow = follow; e.partied = true;
    const p = this.mgr.livePlayer(e);
    if (p && M.behaviour === 'follow') p.stats.floor2 = 1; // followers use the waystones
    if (typeof e.b.command === 'function' && p && by) {
      const k = { follow: 'follow', stay: 'stay', field: 'farm', warden: 'boss' }[mode];
      try { e.b.command({ k, by: by.id, byName: by.name, followId: by.id, adm, group: [p.id] }); } catch (err) { console.error('pbot order', err); }
    }
  }

  dismiss(p, msg, admin) {
    const { e, rec } = this.manageable(p, msg.bid, admin);
    const name = e.b.name;
    this.mgr.remove(e.bid);
    this.owned.delete(e.bid);
    this.game.rosterDirty = true;
    const owner = rec && this.ownerOf(rec);
    if (owner && owner !== p) this.game.sys(`An admin dismissed your bot ${name}.`, owner.id);
    return { msg: `${name} was dismissed.` };
  }

  // ---------- list ----------
  list(p, admin = false) {
    const g = this.game, myParty = p.party || 0;
    const bots = this.mgr.bots.filter(e => !e.b.closed).map(e => {
      const v = this.mgr.view(e), rec = this.owned.get(e.bid), b = this.mgr.livePlayer(e);
      const mine = this.isMine(p, rec);
      const owner = rec ? (this.ownerOf(rec)?.name || rec.ownerName) : '';
      let doing;
      if (v.status !== 'online') doing = 'Joining…';
      else if (v.dead) doing = 'Down';
      else if (rec) doing = MODES[rec.mode].doing + (rec.mode === 'follow' ? ` ${owner}` : '');
      else doing = (OTHER_DOING[e.behaviour] || e.behaviour) + (e.behaviour === 'follow' && e.follow ? ` ${e.follow}` : '');
      if (rec && rec.goneAt) doing = `Waiting for ${owner} (${Math.max(0, Math.ceil(this.grace - (Date.now() - rec.goneAt) / 1000))} s)`;
      return {
        bid: v.bid, id: v.id, name: v.name, cls: v.cls, lvl: v.lvl, hp: v.hp, maxHp: v.maxHp, dead: v.dead, area: v.area, floor: v.floor,
        skill: v.skill, skillName: v.skillName, owner, mine, can: mine || admin, mode: rec?.mode || null, behaviour: e.behaviour, doing,
        party: v.party, myParty: !!(b && myParty && b.party === myParty), loadout: rec?.loadout || null,
        kit: (mine || admin) && b ? this.kit(b) : null,
      };
    });
    const rank = x => (x.mine ? 0 : x.owner ? 1 : 2);
    bots.sort((a, b) => rank(a) - rank(b) || a.bid - b.bid);
    return { bots, mine: this.mine(p).length, max: this.max, total: this.mgr.count(), cap: this.mgr.max, admin: !!admin, partyMax: PARTY_MAX };
  }

  kit(b) { // what an owner sees: equipped gear and skill mastery
    return {
      gear: SLOTS.map(slot => b.inv.eq[slot]).filter(Boolean).map(it => ({ slot: it.slot, name: it.name, r: it.r, st: it.st })),
      mastery: Object.entries(b.mastery || {}).map(([sk, m]) => ({ sk, lvl: masteryLevel(m.pts), br: m.br || null })),
    };
  }

  // ---------- premade loadout ----------
  outfit(b, rec) {
    const g = this.game, L = loadoutFor(b.lvl), role = CLASSES[b.cls]?.role || 'Damage', mid = () => 0.5; // mid-roll stats
    const make = (slot, kind) => {
      try { return makeItem(slot, L.rarity, b.cls, mid, kind); }
      catch { const it = makeItem(slot, L.rarity, 'swordsman', mid, kind); it.cls = b.cls; it.name = `${CLASSES[b.cls].name}'s Weapon`; return it; } // a class without weapon names yet
    };
    b.inv.eq = { ...b.inv.eq, weapon: make('weapon'), armor: make('armor'), charm: make('charm', charmFor(role)) };
    const pts = MASTERY.need[L.mastery] || 0;
    for (const [sk, m] of Object.entries(b.mastery || {})) {
      m.pts = Math.max(m.pts || 0, pts);
      if (L.evolved && !m.br) m.br = defaultBranch(sk);
    }
    g.autoSpendTalents?.(b); // talent tree, if there is one
    g.recompute(b); b.hp = b.maxHp;
    b.invDirty = true; b.masteryDirty = true; b.masteryNow = true;
    rec.outfitted = true;
    rec.loadout = { rarity: L.rarityName, mastery: L.mastery, evolved: L.evolved };
  }

  // ---------- twice a second: loadouts, parties, owners leaving ----------
  upkeep() {
    const g = this.game, now = Date.now();
    for (const rec of [...this.owned.values()]) {
      const e = this.entry(rec.bid);
      if (!e) { this.owned.delete(rec.bid); g.rosterDirty = true; continue; } // removed elsewhere (admin page)
      const b = this.mgr.livePlayer(e);
      if (b && !rec.outfitted) this.outfit(b, rec);
      const owner = this.ownerOf(rec);
      if (!owner) {
        if (!rec.goneAt) { rec.goneAt = now; rec.goneT = g.time; }
        if (now - rec.goneAt >= this.grace * 1000) { this.mgr.remove(rec.bid); this.owned.delete(rec.bid); g.rosterDirty = true; }
        continue;
      }
      if (rec.goneAt || owner.id !== rec.ownerId) { // the owner is back
        rec.goneAt = 0; rec.ownerId = owner.id; rec.ownerName = owner.name; rec.wantParty = true; rec.lastParty = 0;
        if (rec.mode === 'follow') this.setMode(e, 'follow', owner.name, { by: owner });
        g.rosterDirty = true;
      }
      if (!b) continue;
      this.syncParty(b, owner, rec);
    }
  }

  // Keep the bot in its owner's party: when added, when the owner comes back, and when the owner joins another party.
  // Leaving the party yourself is respected (the bots don't drag you back into one).
  syncParty(b, owner, rec) {
    const g = this.game, party = g.partyOf(owner);
    if (party && b.party === party.id) { rec.wantParty = false; rec.lastParty = party.id; return; }
    if (!(party ? party.id !== rec.lastParty : rec.wantParty)) return;
    rec.wantParty = false; rec.lastParty = party?.id || 0;
    if (party && party.members.length >= PARTY_MAX) { g.sys(`Your party is full: ${b.name} stays out of it.`, owner.id); return; }
    this.mgr.joinParty(b, owner); // (makes a party with the owner if needed)
    rec.lastParty = g.partyOf(owner)?.id || 0;
  }

  removeAll() { for (const bid of [...this.owned.keys()]) this.mgr.remove(bid); this.owned.clear(); }
}
