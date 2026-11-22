// Player-made bots: players add bots from the in-game Players panel (P → Bots tab), on top of the admin-managed
// BotManager (server/botmanager.js). This module only uses BotManager's API (add / edit / remove / list / view /
// joinParty / livePlayer / controlBlock / roam) plus small hooks: index.js routes { type: 'pbot' } messages here, and
// roster entries of player-made bots get their creator's name. It also serves the Players list's Bots section: every
// bot in the world and the Named (game.named), with invite / kick / despawn / respawn.
//
// Protocol (client → server):  { type: 'pbot', op: 'list' }
//                               { type: 'pbot', op: 'add', cls, skill (1-5, default 4), name?, party? (default true) }
//                               { type: 'pbot', op: 'edit', bid, skill?, mode? ('follow'|'field'|'warden'|'stay'), name? }
//                               { type: 'pbot', op: 'dismiss', bid }
//                               { type: 'pbot', op: 'invite' | 'kick', bid } or { …, named: id }
//                               { type: 'pbot', op: 'despawn' | 'respawn', named: id }
//                               { type: 'pbot', op: 'allow', bid, set: 'me' | 'open' } or { …, add | remove: name }
//                               { type: 'pbot', op: 'rows' }  the slim list for the Players tab's Bots section
//                               (any op may carry view: 'rows': the reply then carries rows, not list)
// Replies (server → client):   { type: 'pbot', op, ok: true, msg?, list }  or  { type: 'pbot', op, ok: false, error, list? }
//   list = { bots: [...], named: [...], mine, total, cap, admin, partyMax }  (every bot in the world, your own first)
//
// Rules (owner decisions 2026-11-20): no per-player cap, only the server's MAX_BOTS. A bot records its creator. Added
// with "Join my party" (the default) it joins its creator's party (made if needed, never past PARTY_MAX) and follows
// them, into any party they join; unticked it roams free of any party ("free"), doing its creator's chosen behaviour
// (farming the field until they pick one). A bot that leaves a party (kicked, a /b leave order, invited away, the party
// broke up) roams the same way; inviting it back puts it in your party. It levels with its creator (no XP of its own:
// on join and whenever the creator levels it takes their level and that level's premade gear, mastery and talents).
// Who may command, invite, kick it: shared/accesslevels.js canControlBot (creator, access 3+, its allow list, else
// anyone at the action's minimum). Renaming, skill, behaviour and Dismiss: its creator, or access 3+ (admins are 5).
// When the creator leaves, their bots wait PLAYER_BOT_GRACE seconds (default 60) for a reconnect (the same saved character;
// an anonymous creator's session can't come back), then go once free (not in a party with a human, not in a boss fight); the creator
// hears about any bot of theirs an admin removes. Admin "Respawn as…" keeps the bot id (BotManager), so the creator link
// survives it.
import { CLASSES, MAX_LEVEL, PARTY_MAX } from '../shared/data.js';
import { makeItem, SLOTS } from '../shared/items.js';
import { botAffixes } from '../shared/loot.js';
import { MASTERY, masteryLevel } from '../shared/mastery.js';
import { clampSkill, skillName } from '../shared/botskill.js';
import { MODES, loadoutFor, charmFor, defaultBranch, cleanBotName } from '../shared/playerbots.js';
import { inArena } from '../shared/data.js';
import { inArena2 } from '../shared/floor2.js';
import { inArena3 } from '../shared/floor3.js';
import { canManageBot, accessOf, minAccess, cleanAllow, allowLabel, ALLOW_CREATOR } from '../shared/accesslevels.js';
import * as db from './db.js';
import { GARDEN } from '../shared/life.js';
import { floorOf } from '../shared/floor2.js';
import { isAdmin } from './admin.js';
import { resolveAllow } from './accounts.js';
import { WEAPONS, COHORT, COHORT_MAX, COHORT_NAMES, cohortClasses, isInitiate } from '../shared/academy.js';

class PbError extends Error {}
const fail = msg => { throw new PbError(msg); };
const inBossRoom = p => inArena(p.x, p.z) || inArena2(p.x, p.z) || inArena3(p.x, p.z);
const OTHER_DOING = { follow: 'Following', field: 'Farming the field', warden: 'Heading for the Warden', floor2: 'On Floor 2', auto: 'Levelling up' };

export class PlayerBots {
  constructor(game, mgr, { grace = Number(process.env.PLAYER_BOT_GRACE) || 60 } = {}) {
    this.game = game; this.mgr = mgr; this.grace = grace;
    // bid -> { bid, ownerId, charId, accountId, anonName, ownerName (the creator), name, mode, partied (follows its creator's
    //          party), inParty (the party it was last seen in), pid, wantParty, lastParty, seenIn, goneAt, goneT }
    this.owned = new Map();
    mgr.ownedRec = bid => this.owned.get(bid) || null; // BotManager / admin edits know a bot was player-added
    game.academyBots = this; // the Academy's cohorts: addCohort / graduateCohort (server/academy.js)
    // Player-added bots get no XP of their own: they level with their owner (syncLevel).
    const giveXp = game.giveXp.bind(game);
    game.giveXp = (p, amount) => (p?.bot && p.pbOwned ? undefined : giveXp(p, amount));
    // Hook: player-made bots carry their creator's name and player id (and what they were told to do) in the roster.
    const roster = game.roster.bind(game);
    game.roster = () => {
      const byId = new Map();
      for (const rec of this.owned.values()) { const e = this.entry(rec.bid), p = e && mgr.livePlayer(e); if (p) byId.set(p.id, rec); }
      return roster().map(r => { const rec = r.bot && byId.get(r.id); return rec ? { ...r, owner: rec.ownerName, cid: rec.ownerId, mode: rec.mode } : r; }); // (cid: the creator's player id: the wheel lists your free bots)
    };
    this.timer = setInterval(() => this.upkeep(), 500);
    this.timer.unref?.();
  }

  // ---------- lookups ----------
  entry(bid) { return this.mgr.bots.find(e => e.bid === bid && !e.b.closed) || null; }
  // Access: managing (edit / dismiss) and controlling (shared/accesslevels.js). Admin status is cached on p (adminOf).
  actor(p, admin) { return admin && !p.admin ? { ...p, admin: true } : p; }
  canManage(p, e, admin) { return canManageBot(this.actor(p, admin), { creator: e?.creator }); }
  isMine(p, rec) { return !!rec && (rec.ownerId === p.id || (!!rec.charId && rec.charId === p.charId)); }
  mine(p) { return [...this.owned.values()].filter(rec => this.isMine(p, rec)); }
  // The creator, if online. A saved character who reconnects is re-adopted (same character id); an anonymous creator
  // only while the very same session is on (a name proves nothing: anyone can join as "Ann"), so their bots go after
  // the grace period.
  ownerOf(rec) {
    const g = this.game;
    const o = g.players.get(rec.ownerId);
    if (o && !o.bot && (rec.charId ? o.charId === rec.charId : !o.charId && !rec.goneAt)) return o;
    if (!rec.charId) return null;
    for (const q of g.players.values()) if (!q.bot && q.charId === rec.charId) return q;
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
    if (op === 'list' || op === 'rows') { // polled while the Bots tab is open (list), or the Players tab's Bots section (rows: slim)
      if (now - (p.pbListAt || 0) < 250) return;
      p.pbListAt = now;
      const admin = await this.adminOf(p);
      return this.reply(p, op === 'rows' ? { op, ok: true, rows: this.rows(p, admin) } : { op, ok: true, list: this.list(p, admin) });
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
      else if (op === 'invite') out = msg.named ? this.namedOp(p, 'invite', msg.named, admin) : this.invite(p, msg, admin);
      else if (op === 'kick') out = msg.named ? this.namedOp(p, 'kick', msg.named, admin) : this.kick(p, msg, admin);
      else if (op === 'despawn' || op === 'respawn') out = this.namedOp(p, op, msg.named, admin);
      else if (op === 'allow') out = await this.allow(p, msg, admin);
      else fail('Unknown bot command.');
      this.reply(p, { op, ok: true, ...out, ...this.after(p, msg, admin) });
    } catch (e) {
      if (!(e instanceof PbError) && !e.code) console.error('pbot', e);
      this.reply(p, { op, ok: false, error: e.message || 'Something went wrong.', ...this.after(p, msg, admin) });
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
    if (this.mgr.nameReserved?.(name)) fail(`${name} is one of the Named: pick another name.`);
    if (p.dead) fail('Wait until you are back on your feet.');
    if (accessOf(p) < minAccess('botAdd')) fail(`You need access level ${minAccess('botAdd')} to add bots.`);
    const partied = msg.party !== false; // "Join my party" (ticked by default); unticked: it roams free of any party
    const mine = this.mine(p), party = g.partyOf(p);
    if (partied) {
      const pending = mine.filter(rec => { if (!rec.partied) return false; const e = this.entry(rec.bid), b = e && this.mgr.livePlayer(e); return !b || !party || b.party !== party.id; }).length;
      if ((party ? party.members.length : 1) + pending >= PARTY_MAX) fail(`Your party is full (${PARTY_MAX}/${PARTY_MAX}). Make room, or add it without joining your party.`);
    }
    if (this.mgr.count() >= this.mgr.max) fail(`The server's bot limit is reached (${this.mgr.max}). Try again later.`);
    const lvl = Math.min(MAX_LEVEL, Math.max(1, p.lvl | 0));
    const mode = partied ? 'follow' : 'field', M = MODES[mode];
    let view;
    try { view = this.mgr.add({ cls, name, lvl, behaviour: M.behaviour, follow: M.follow ? p.name : '', skill, creator: { charId: p.charId || 0, accountId: p.accountId || 0, pid: p.id, name: p.name } }); }
    catch (e) { fail(e.message); }
    const e = this.entry(view.bid);
    if (e) e.partied = true; // party joining is ours (upkeep), not BotManager's
    this.owned.set(view.bid, {
      bid: view.bid, ownerId: p.id, charId: p.charId || 0, accountId: p.accountId || 0, anonName: p.charId ? '' : p.name.toLowerCase(), ownerName: p.name,
      name: view.name, mode, partied, inParty: 0, pid: 0, wantParty: partied, lastParty: 0, seenIn: 0, goneAt: 0, goneT: 0,
    });
    g.rosterDirty = true;
    g.track(p, 'pbot_add', { cls, skill, lvl, party: partied }); // stats dashboard: bot vs player share
    return { msg: `${view.name} the ${CLASSES[cls].name} (Lv ${lvl}, ${skillName(skill)}) ${partied ? 'is on the way.' : 'is out on its own (not in your party): farming the field until you give it a behaviour.'}`, bid: view.bid };
  }

  // ---------- edit / dismiss ----------
  manageable(p, bid, admin) {
    bid = Number(bid);
    const e = this.entry(bid);
    if (!e || e.named) fail('That bot is gone.');
    const rec = this.owned.get(bid);
    if (!this.isMine(p, rec) && !this.canManage(p, e, admin)) fail(rec ? `That's ${rec.ownerName}'s bot.` : 'Only admins can manage that bot.');
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
      if (this.mgr.nameReserved?.(name)) fail(`${name} is one of the Named: pick another name.`);
    }
    if (!this.mgr.livePlayer(e)) fail('That bot is still joining.');
    if (mode && MODES[mode].tend && floorOf(this.mgr.livePlayer(e).x) !== 1) fail(`${e.b.name} is on another floor: bring it to Floor 1 to tend your garden.`); // (before any change)
    const said = [], was = e.b.name;
    if (name !== undefined && name !== e.b.name) { try { this.mgr.edit(e.bid, { name }); } catch (err) { fail(err.message); } said.push(`renamed to ${name}`); }
    if (skill !== undefined && skill !== e.b.skill) { this.mgr.edit(e.bid, { skill }); said.push(`skill ${skillName(skill)}`); }
    if (mode !== undefined) {
      const owner = rec ? this.ownerOf(rec) : p; // a server bot follows the admin who told it to
      this.setMode(e, mode, owner?.name || rec?.ownerName || p.name, { by: owner || p, adm: !this.isMine(p, rec) });
      if (rec) { rec.mode = mode; rec.wantParty = rec.partied; }
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
    if (p && M.behaviour === 'follow') p.stats.floor2 = 1; // followers use the waypoints
    if (M.tend && typeof e.b.command === 'function' && p) { // walk to the garden and stay there (server/life.js lifeTend)
      if (floorOf(p.x) !== 1) return; // (edit() refuses this first)
      try { e.b.command({ k: 'tend', x: GARDEN.x + 4, z: GARDEN.z + 3, by: 0, byName: by?.name || '', group: [p.id] }); } catch (err) { console.error('pbot order', err); }
      return;
    }
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

  after(p, msg, admin) { return msg.view === 'rows' ? { rows: this.rows(p, admin) } : { list: this.list(p, admin) }; } // (the list the sender looks at)

  // ---------- allow list (the Players list: creator or access 3+) ----------
  // { bid, set: 'me' | 'open' } or { bid, add: name } / { bid, remove: name }. Names must be saved characters (resolved to
  // character ids: server/accounts.js resolveAllow); "Just me" leaves only the creator (and access 3+).
  async allow(p, msg, admin) {
    const e = this.entry(Number(msg.bid));
    if (!e || e.named) fail('That bot is gone.');
    if (!this.canManage(p, e, admin)) fail('Only its creator can change who may control it.');
    const cur = (e.allow || []).filter(a => a.id !== ALLOW_CREATOR);
    let next;
    if (msg.set === 'me') next = [{ id: ALLOW_CREATOR }];
    else if (msg.set === 'open') next = [];
    else if (msg.add) {
      let add;
      try { add = await resolveAllow([String(msg.add).slice(0, 24)]); } catch (err) { fail(err.message); }
      next = [...cur, ...add];
    } else if (msg.remove) {
      const lower = String(msg.remove).trim().toLowerCase();
      next = cur.filter(a => a.name.toLowerCase() !== lower && a.id !== lower.replace('#', ''));
      if (next.length === cur.length) fail(`${String(msg.remove).slice(0, 20)} isn't on the list.`);
      if (!next.length && e.allow?.length) next = [{ id: ALLOW_CREATOR }]; // (the last name off a closed list: still closed)
    } else fail('Say who.');
    if (!this.entry(e.bid)) fail('That bot is gone.'); // (gone while the names were looked up)
    e.allow = cleanAllow(next);
    const names = e.allow.filter(a => a.id !== ALLOW_CREATOR).map(a => a.name);
    return { msg: `${e.b.name}: ${!e.allow.length ? 'anyone' : names.length ? `only you and ${names.join(', ')}` : 'only you'} may order, invite or kick it.` };
  }

  // ---------- invite / kick (the Players list) ----------
  // Into your party, straight from wherever it is (its old party, or roaming): the party-size rule, never out of a boss fight.
  invite(p, msg, admin) {
    const g = this.game, e = this.entry(Number(msg.bid));
    if (!e || e.named) fail('That bot is gone.');
    const b = this.mgr.livePlayer(e);
    if (!b) fail('That bot is still joining.');
    if (b.party && b.party === p.party) fail(`${b.name} is already in your party.`);
    const why = this.mgr.controlBlock(this.actor(p, admin), e, 'botInvite');
    if (why) fail(why);
    if (b.dead) fail(`${b.name} is down right now.`);
    if (inBossRoom(b) && g.activeFightOf?.(b)) fail(`${b.name} is in a boss fight.`);
    if ((g.partyOf(p)?.members.length || 1) >= PARTY_MAX) fail(`Your party is full (${PARTY_MAX}/${PARTY_MAX}).`);
    this.mgr.joinParty(b, p); // (leaves its old party)
    if (!b.party || b.party !== p.party) fail(`${b.name} couldn't join your party.`);
    const rec = this.owned.get(e.bid);
    if (rec) {
      if (this.isMine(p, rec)) { // back with its creator: it serves your party again
        Object.assign(rec, { partied: true, mode: 'follow', wantParty: false, lastParty: b.party, seenIn: b.party });
        this.setMode(e, 'follow', p.name, { by: p });
      } else rec.partied = false; // someone else's party: it follows them there (its brain: a human in the party leads)
      rec.inParty = b.party;
      const o = this.ownerOf(rec);
      if (o && o !== p) g.sys(`${p.name} invited your bot ${b.name} into their party.`, o.id);
    }
    g.rosterDirty = true;
    return { msg: `${b.name} joined your party.` };
  }
  // Out of your party: it roams (farms the field) until someone invites it again.
  kick(p, msg, admin) {
    const g = this.game, e = this.entry(Number(msg.bid));
    if (!e || e.named) fail('That bot is gone.');
    const b = this.mgr.livePlayer(e);
    if (!b || !p.party || b.party !== p.party) fail(`${b?.name || 'That bot'} isn't in your party.`);
    const why = this.mgr.controlBlock(this.actor(p, admin), e, 'botKick');
    if (why) fail(why);
    if (inBossRoom(b) && g.activeFightOf?.(b)) fail(`${b.name} is in a boss fight.`);
    this.freeBot(e, b);
    g.rosterDirty = true;
    return { msg: `${b.name} left your party and roams on its own.` };
  }
  // A bot whose creator left stays while it's useful to someone: in a party with a human, or in a boss fight.
  busy(b) {
    if (!b) return false;
    const party = this.game.partyOf(b);
    return !!(party?.members.some(id => { const o = this.game.players.get(id); return o && !o.bot; }) || (inBossRoom(b) && this.game.activeFightOf?.(b)));
  }
  freeBot(e, b) { // out of its party, roaming
    const rec = this.owned.get(e.bid);
    if (b.party) this.game.leaveParty(b);
    if (rec) { Object.assign(rec, { partied: false, mode: 'field', inParty: 0, wantParty: false }); this.setMode(e, 'field', '', {}); }
    else this.mgr.roam(e);
  }
  // The Named (server/named.js): invite (their own rules: party room, busy; INVITE_NEEDS_TIER), kick, despawn, respawn.
  namedOp(p, op, id, admin) {
    const N = this.game.named;
    if (!N) fail('The Named are not in this world.');
    const st = N.chars.get(String(id || ''));
    if (!st) fail('Nobody by that name.');
    const who = this.actor(p, admin), name = st.def.name;
    if (op === 'invite') {
      const t = N.playerOf(st);
      const why = N.inviteBlock(who, st);
      if (why) fail(why);
      if (!t) { N.wake(st, p, 'invite'); return { msg: `${name} is on the way: your invite goes out when they arrive.` }; }
      this.game.invite(p, t.id); // (their own brain accepts)
      return { msg: `Invited ${name}.` };
    }
    if (op === 'kick') {
      const t = N.playerOf(st);
      if (!t || !p.party || t.party !== p.party) fail(`${name} isn't in your party.`);
      const why = N.ctlBlock(who, st, 'botKick');
      if (why) fail(why);
      if (inBossRoom(t) && this.game.activeFightOf?.(t)) fail(`${name} is in a boss fight.`);
      this.game.leaveParty(t); // (back to their own: the Hearthward, or alone)
      return { msg: `${name} left your party.` };
    }
    const why = op === 'despawn' ? N.despawnBy(who, id) : N.respawnBy(who, id);
    if (why) fail(why);
    return { msg: op === 'despawn' ? `${name} left the world. Respawn them from this list whenever you like.` : `${name} is coming back.` };
  }

  // ---------- list ----------
  // Where a bot is, for the Players list: your party, someone's party (its leader: the first human, else the first
  // member), or roaming.
  where(b) {
    const g = this.game, party = b && g.partyOf(b);
    if (!b) return { k: 'joining', text: 'Joining…' };
    if (!party) return { k: 'roam', text: 'Roaming' };
    const ids = party.members.filter(id => id !== b.id), lead = ids.map(id => g.players.get(id)).find(o => o && !o.bot) || g.players.get(ids[0]);
    return { k: 'party', text: lead ? `In ${lead.name}'s party` : 'In a party', lead: lead?.name || '' };
  }
  // ok / why for one of the list's buttons
  ctl(why) { return why ? { ok: false, why } : { ok: true }; }

  list(p, admin = false) {
    const g = this.game, myParty = p.party || 0, who = this.actor(p, admin);
    const bots = this.mgr.bots.filter(e => !e.b.closed && !e.named).map(e => { // (the Named have the Friends tab)
      const v = this.mgr.view(e), rec = this.owned.get(e.bid), b = this.mgr.livePlayer(e);
      const mine = this.isMine(p, rec), inMine = !!(b && myParty && b.party === myParty);
      const inv = !b ? 'Still joining.' : inMine ? 'Already in your party.' : this.mgr.controlBlock(who, e, 'botInvite') || (b.dead ? 'Down right now.' : '');
      const kick = !inMine ? 'Not in your party.' : this.mgr.controlBlock(who, e, 'botKick');
      const owner = rec ? (this.ownerOf(rec)?.name || rec.ownerName) : '';
      let doing;
      if (v.status !== 'online') doing = 'Joining…';
      else if (v.dead) doing = 'Down';
      else if (rec) doing = MODES[rec.mode].doing + (rec.mode === 'follow' ? ` ${rec.partied || b?.party ? owner : `${owner} (not in a party)`}` : '');
      else doing = (OTHER_DOING[e.behaviour] || e.behaviour) + (e.behaviour === 'follow' && e.follow ? ` ${e.follow}` : '');
      if (rec && rec.goneAt) doing = `Waiting for ${owner} (${Math.max(0, Math.ceil(this.grace - (Date.now() - rec.goneAt) / 1000))} s)`;
      return {
        bid: v.bid, id: v.id, name: v.name, cls: v.cls, lvl: v.lvl, hp: v.hp, maxHp: v.maxHp, dead: v.dead, area: v.area, floor: v.floor,
        skill: v.skill, skillName: v.skillName, owner, creator: owner, mine, can: mine || this.canManage(p, e, admin), mode: rec?.mode || null, behaviour: e.behaviour, doing, // (creator: '' for an admin-made bot, a server bot to players; its creator stays for the rules)
        party: v.party, myParty: inMine, loadout: rec?.loadout || null, partied: !!rec?.partied, where: this.where(b),
        kit: (mine || this.canManage(p, e, admin)) && b ? this.kit(b) : null,
        ctl: { invite: this.ctl(inv), kick: this.ctl(kick) },
      };
    });
    const rank = x => (x.mine ? 0 : x.owner ? 1 : 2);
    bots.sort((a, b) => rank(a) - rank(b) || a.bid - b.bid);
    const named = g.named ? g.named.botRows(who) : [];
    return { bots, named, mine: this.mine(p).length, total: this.mgr.count(), cap: this.mgr.max, admin: !!admin, partyMax: PARTY_MAX };
  }

  // The Players tab's Bots section: only what a row shows (polled every 3 s), the Named too.
  rows(p, admin = false) {
    const myParty = p.party || 0, who = this.actor(p, admin);
    const bots = this.mgr.bots.filter(e => !e.b.closed && !e.named).map(e => {
      const rec = this.owned.get(e.bid), b = this.mgr.livePlayer(e), mine = this.isMine(p, rec), inMine = !!(b && myParty && b.party === myParty);
      const inv = !b ? 'Still joining.' : inMine ? 'Already in your party.' : this.mgr.controlBlock(who, e, 'botInvite') || (b.dead ? 'Down right now.' : '');
      const kick = !inMine ? 'Not in your party.' : this.mgr.controlBlock(who, e, 'botKick');
      return {
        bid: e.bid, pid: b?.id || 0, name: b?.name || e.b.name, cls: e.b.cls, lvl: b?.lvl ?? e.lvl, dead: !!b?.dead, mine, creator: rec ? (this.ownerOf(rec)?.name || rec.ownerName) : '',
        myParty: inMine, where: this.where(b), ctl: { invite: this.ctl(inv), kick: this.ctl(kick) },
        ...(rec && this.canManage(p, e, admin) ? { allow: !e.allow?.length ? 'anyone' : e.allow.every(a => a.id === ALLOW_CREATOR) ? 'just the creator' : allowLabel(e.allow.filter(a => a.id !== ALLOW_CREATOR)), allowList: (e.allow || []).filter(a => a.id !== ALLOW_CREATOR).map(a => a.name), canAllow: true } : {}),
      };
    });
    const rank = x => (x.mine ? 0 : x.creator ? 1 : 2);
    bots.sort((a, b) => rank(a) - rank(b) || a.bid - b.bid);
    return { bots, named: this.game.named ? this.game.named.botRows(who) : [] };
  }

  kit(b) { // what an owner sees: equipped gear and skill mastery
    return {
      gear: SLOTS.map(slot => b.inv.eq[slot]).filter(Boolean).map(it => ({ slot: it.slot, name: it.name, r: it.r, st: it.st, ...(it.ax ? { ax: it.ax } : {}), ...(it.set ? { set: it.set } : {}) })),
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
    for (const s of SLOTS) botAffixes(b.inv.eq[s], b.cls); // role-fit affixes, mid rolls (shared/loot.js)
    const pts = MASTERY.need[L.mastery] || 0;
    for (const [sk, m] of Object.entries(b.mastery || {})) {
      m.pts = Math.max(m.pts || 0, pts);
      if (L.evolved && !m.br) m.br = defaultBranch(sk);
    }
    g.autoSpendTalents?.(b); // talent tree, if there is one
    g.botSpecialise?.(b); // its role's subclass from level 15 (shared/subclasses.js BOT_SUB, server/subclasses.js)
    g.recompute(b); b.hp = b.maxHp;
    b.invDirty = true; b.masteryDirty = true; b.masteryNow = true;
    b.pbOwned = true; // (no XP of its own)
    rec.pid = b.id;
    rec.loadout = { rarity: L.rarityName, mastery: L.mastery, evolved: L.evolved };
  }

  // ---------- cohorts: the Academy's bot classmates (docs/briefs/academy.md) ----------
  // Two per character at most (path.cohort keeps their names), the player's own bots (creator = the player), Initiates
  // with the weapons COHORT gives the player's weapon; graduated players get them graduated (cohortClasses).
  cohortOf(p) { return this.mine(p).filter(rec => rec.cohort && this.entry(rec.bid)); }
  addCohort(path, p) {
    const weapons = COHORT[path.weapon] || COHORT.sword, have = this.cohortOf(p), out = [];
    const grad = !isInitiate(path) ? cohortClasses(p.cls, weapons) : null;
    for (let i = 0; i < COHORT_MAX; i++) {
      if (have.some(rec => rec.cohort.slot === i)) continue;
      const w = weapons[i], cls = grad ? grad[i] : WEAPONS[w].base;
      const name = path.cohort[i] || COHORT_NAMES[(p.id * 7 + i * 5 + Math.floor(Math.random() * COHORT_NAMES.length)) % COHORT_NAMES.length];
      let r = null;
      try { r = this.add(p, { cls, name, skill: 3, party: true }); }
      catch { try { r = this.add(p, { cls, name, skill: 3, party: false }); } catch (e) { this.game.sys(`A classmate couldn't come: ${e.message}`, p.id); continue; } }
      const rec = this.owned.get(r.bid);
      if (!rec) continue;
      rec.cohort = { slot: i, weapon: w, cls: grad ? cls : null };
      path.cohort[i] = rec.name; out.push(rec.name);
    }
    return out;
  }
  // The player graduated: their classmates graduate with them, into classes that fill the roles the player's lacks.
  graduateCohort(p) {
    const recs = this.cohortOf(p).sort((a, b) => a.cohort.slot - b.cohort.slot);
    if (!recs.length) return;
    const classes = cohortClasses(p.cls, recs.map(r => r.cohort.weapon)), names = [];
    recs.forEach((rec, i) => {
      rec.cohort.cls = classes[i];
      const e = this.entry(rec.bid), b = e && this.mgr.livePlayer(e);
      if (!b) return;
      this.game.graduate(b, classes[i], { quiet: true });
      this.outfit(b, rec); // the new class's premade gear, mastery and talents
      b.inv.bag = b.inv.bag.filter(it => it.slot !== 'weapon'); // (the weapons graduating swapped out: bots carry none)
      names.push(`${b.name} (${CLASSES[classes[i]].name})`);
    });
    if (names.length) this.game.sys(`Your classmates graduate with you: ${names.join(', ')}.`, p.id);
  }

  // ---------- twice a second: loadouts, parties, owners leaving ----------
  upkeep() {
    const g = this.game, now = Date.now();
    for (const rec of [...this.owned.values()]) {
      const e = this.entry(rec.bid);
      if (!e) { // removed elsewhere (admin page): still accounted for, and the owner hears about it
        this.owned.delete(rec.bid); g.rosterDirty = true;
        const o = this.ownerOf(rec);
        if (o) g.sys(`Your bot ${rec.name} was removed by an admin.`, o.id);
        continue;
      }
      const b = this.mgr.livePlayer(e);
      if (b) rec.name = b.name;
      const owner = this.ownerOf(rec);
      if (b && owner && b.lvl !== owner.lvl) this.mgr.setLevel(e, owner.lvl); // on join, and as the owner levels
      if (b && (rec.pid !== b.id || rec.loadoutLvl !== b.lvl)) { // a new bot (added, or respawned as another class), or a new level
        if (rec.pid !== b.id) { rec.wantParty = true; rec.lastParty = 0; rec.seenIn = 0; g.rosterDirty = true; } // (roster: its owner tag)
        this.outfit(b, rec);
        if (rec.cohort) g.cohortSetup?.(b, rec.cohort); // an Academy classmate: an Initiate with its weapon, or its class (server/academy.js)
        rec.loadoutLvl = b.lvl;
      }
      if (!owner) {
        if (!rec.goneAt) { rec.goneAt = now; rec.goneT = g.time; }
        if (now - rec.goneAt >= this.grace * 1000 && !this.busy(b)) { this.mgr.remove(rec.bid); this.owned.delete(rec.bid); g.rosterDirty = true; }
        continue; // (busy: lent to someone's party, or in a boss fight: it goes once it's free)
      }
      if (rec.goneAt || owner.id !== rec.ownerId) { // the owner is back
        rec.goneAt = 0; rec.ownerId = owner.id; rec.ownerName = owner.name; rec.wantParty = rec.partied; rec.lastParty = 0;
        if (rec.mode === 'follow' && (rec.partied || !b?.party)) this.setMode(e, 'follow', owner.name, { by: owner });
        g.rosterDirty = true;
      }
      if (e.creator) { e.creator.pid = owner.id; e.creator.name = owner.name; } // (an anonymous creator who reconnected)
      if (!b) continue;
      b.pbOwner = owner.id; // (life classes: its creator's garden, server/life.js lifeTend)
      if (rec.partied) {
        if (this.syncParty(b, owner, rec) === 'left') { // it left the party it served (a /b leave order): it roams on its own
          this.freeBot(e, b);
          g.sys(`${b.name} left your party and roams on its own. Invite it back from the Players list (Bots).`, owner.id);
        }
      } else if (b.party && b.party === owner.party) { // invited back into its creator's party (a plain invite)
        Object.assign(rec, { partied: true, mode: 'follow', wantParty: false, lastParty: b.party, seenIn: b.party });
        this.setMode(e, 'follow', owner.name, { by: owner });
      } else if (!b.party && rec.inParty) this.freeBot(e, b); // its party broke up, or it was sent off: back to roaming
      rec.inParty = b.party || 0;
    }
  }

  // Keep the bot in its owner's party: when added, when the owner comes back, and when the owner joins another party.
  // Leaving the party yourself is respected (the bots don't drag you back into one).
  syncParty(b, owner, rec) {
    const g = this.game, party = g.partyOf(owner);
    if (party && b.party === party.id) { rec.wantParty = false; rec.lastParty = rec.seenIn = party.id; return; }
    if (party && rec.seenIn === party.id) return 'left'; // was in this party with its owner, and left it
    rec.seenIn = 0;
    if (!(party ? party.id !== rec.lastParty : rec.wantParty)) return;
    rec.wantParty = false; rec.lastParty = party?.id || 0;
    if (party && party.members.length >= PARTY_MAX) { g.sys(`Your party is full: ${b.name} stays out of it.`, owner.id); return; }
    this.mgr.joinParty(b, owner); // (makes a party with the owner if needed)
    rec.lastParty = g.partyOf(owner)?.id || 0;
  }

  removeAll() { for (const bid of [...this.owned.keys()]) this.mgr.remove(bid); this.owned.clear(); }
}
