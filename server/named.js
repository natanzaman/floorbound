// The Named (docs/ROADMAP.md I1): the Hearthward (a party of four) and Cairn the loner. Data and pure rules:
// shared/named.js. Two parts:
//
//  installNamed(Game)   small wrappers on Game (they do nothing without a manager: NAMED_ENABLED=0 is today's game):
//    humans first    a Named never lands a boss's killing blow while a human contributor stands in the arena
//                    (lastAttackHeld); a field mob a human damaged gives that human full XP and loot when a Named
//                    kills it; the Named take no XP, loot or share (game.js killMob leaves them out of the split)
//    clears          a clear with no human contributor is never "first", rings no bell and goes on the Hall's
//                    "Heroes' record" (rec.heroes, server/hall.js); with a Named in it, it's quiet too (quietClear: no
//                    floor counter, banner or Last Attack shout, one line)
//    friendship      game.namedFriendship(player, namedId) -> { pts, tier, tierName, left } | null
//                    game.addFriendship(player, namedId, amount, reason) -> { d, pts, tier, up } | null
//                    (reason: a GAINS key of shared/named.js, or 'downed'; I3 / I4 call these)
//    invites         a Named accepts a party invite (by tier only with INVITE_NEEDS_TIER, shared/named.js), a Sworn
//                    friend calls one with "/b <name>: come" (botCommand) or the Friends tab; { type: 'named' } messages
//                    (handle). Who may invite, kick, despawn or respawn one: shared/accesslevels.js (ctlBlock; their
//                    allow lists st.allow, kept in named_chars.allow)
//
//  NamedManager         runs them as server bots of their own kind (BotManager entries with e.named: reserved slots
//    outside MAX_BOTS, not in the Bots tab, never removed by "remove all"):
//    presence        only while a human is online, and only on a floor a human is on; parked (gone) during a
//                    director show; nothing is written to the database with nobody online. On top (PRESENCE in
//                    shared/named.js, CPU on the free plan): a group comes when a human is in its home area, stays while
//                    one has been near them lately, then goes home; an invite, a call or an accepted invitation wakes a
//                    resting group at once (the request is carried out when they're in); few humans online: a cap
//    level           the top-3 average of non-admin characters active in the last 14 days, + the offset; never drops.
//                    Gear, mastery and talents are the premade setup for that level (shared/playerbots.js)
//    plans           each group farms, and now and then goes for the boss of its floor, but only while no human is in
//                    or near the arena; an invited Hero leaves the Hearthward for your party and goes back when the
//                    party disbands or after 10 quiet minutes; several of the Named may join one human party (owner
//                    2026-11-21), never past PARTY_MAX (partyRoom)
//    despawn         each is unique (never a copy): a permitted player (or an admin) takes one out of the world and
//                    brings them back later (despawnBy / respawnBy, setEnabled); back, they rejoin the human party they
//                    left if it still exists with room (a party of two breaks up when they leave: then the same human,
//                    if they're in no other party), else they roam as before. Despawned survives a restart
//                    (named_chars.enabled); the party to rejoin is kept in memory (parties don't survive one either)
//    persistence     named_chars (level, offset, switch, allow list, last seen) and named_friendship (per character); anonymous
//                    players' friendship lasts for their session
//
// Client messages: { type: 'named', op: 'list' | 'invite' | 'call', id }. Replies: { type: 'named', op, list?, msg?,
// error? } and, when friendship changes, { type: 'named', op: 'fr', id, name, d, pts, tier, tierName, up, why }.
// Testing aids: TEST_HOOKS=1 accepts { type: 'test', friend: { id, pts } } (sets your friendship); NAMED_ALWAYS=1 keeps them in the world with nobody online (floor 1); NAMED_LEVEL=<n> is the least level
// they have; NAMED_BOSS_AFTER=<s> is how long they farm before their first boss attempt of a visit.
import { CLASSES, MAX_LEVEL, PARTY_MAX, areaName, inArena, inGateZone, inTown, resolveCollision } from '../shared/data.js';
import { F2, floorOf, inArena2, inGateZone2 } from '../shared/floor2.js';
import { F3, inArena3, inGateZone3 } from '../shared/floor3.js';
import { makeItem, SLOTS } from '../shared/items.js';
import { botAffixes } from '../shared/loot.js';
import { MASTERY } from '../shared/mastery.js';
import { loadoutFor, charmFor, defaultBranch } from '../shared/playerbots.js';
import {
  NAMED, NAMED_BY_ID, NAMED_MAX, NAMED_SKILL, LEVEL_OFFSET, LEVEL_DAYS, LEVEL_TOP, GROUPS, TIERS, GAINS, RULES,
  tierIndex, tierAt, tierProgress, lookColor, isNamedName, namedLine, newFriendship, gainFriendship, loseFriendship,
  dailyLeft, canInvite, canSummon, namedLevel, awayLine, nextReset, PRESENCE,
} from '../shared/named.js';
import { cleanAllow, accessOf, ACCESS } from '../shared/accesslevels.js'; // who may control them besides access 3+ (st.allow)

export const namedOn = () => process.env.NAMED_ENABLED !== '0';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const between = ([a, b]) => a + Math.random() * (b - a);
const isHuman = p => !!p && !p.bot;
const art = word => `${/^[AEIOU]/i.test(word) ? 'an' : 'a'} ${word}`;

// Where a group stands when it arrives on a floor, the boss room and its approach, and the level its boss wants.
const FLOORS = {
  1: { home: g => g.spawnPoint(), arena: inArena, near: (x, z) => inArena(x, z) || inGateZone(x, z) || (z > 132 && Math.abs(x) < 24), fight: 'fight', minLvl: 5, beh: { farm: 'field', boss: 'warden' } },
  2: { home: () => [F2.camp.x, F2.camp.z], arena: inArena2, near: (x, z) => inArena2(x, z) || inGateZone2(x, z) || (z > 132 && Math.abs(x - F2.x) < 24), fight: 'fight2', minLvl: 15, beh: { farm: 'floor2', boss: 'floor2' } },
  3: { home: () => [F3.camp.x, F3.camp.z], arena: inArena3, near: (x, z) => inArena3(x, z) || inGateZone3(x, z) || (z > 132 && Math.abs(x - F3.x) < 24), fight: 'fight3', minLvl: 25, beh: { farm: 'floor3', boss: 'floor3' } },
};
const inBossRoom = p => inArena(p.x, p.z) || inArena2(p.x, p.z) || inArena3(p.x, p.z);
const inHome = (home, p) => floorOf(p.x) === (home?.floor || 1) && !inTown(p.x, p.z); // a Named's home area: its floor, outside the town and camps

// ---------- Postgres (server/db.js makes the tables) ----------
export function makeNamedStore(q, { adminIds = [] } = {}) {
  return {
    loadChars: () => q('SELECT id, lvl, lvl_off, enabled, seen_at, allow FROM named_chars'),
    saveChar: r => q(`INSERT INTO named_chars (id, lvl, lvl_off, enabled, seen_at, allow, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (id) DO UPDATE SET lvl = EXCLUDED.lvl, lvl_off = EXCLUDED.lvl_off, enabled = EXCLUDED.enabled, seen_at = EXCLUDED.seen_at, allow = EXCLUDED.allow, updated_at = now()`,
      [r.id, r.lvl, r.off, r.enabled, r.seenAt ? new Date(r.seenAt) : null, JSON.stringify(r.allow || [])]),
    loadFriends: charId => q('SELECT named_id, pts, day, got, chat FROM named_friendship WHERE char_id = $1', [charId]),
    saveFriend: (charId, id, rec) => q(`INSERT INTO named_friendship (char_id, named_id, pts, day, got, chat, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (char_id, named_id) DO UPDATE SET pts = EXCLUDED.pts, day = EXCLUDED.day, got = EXCLUDED.got, chat = EXCLUDED.chat, updated_at = now()`,
      [charId, id, rec.pts, rec.day, rec.got, rec.chat]),
    listFriends: () => q(`SELECT f.char_id, c.name, c.lvl, f.named_id, f.pts, f.day, f.got FROM named_friendship f JOIN characters c ON c.id = f.char_id ORDER BY lower(c.name), f.named_id LIMIT 500`),
    charExists: async charId => (await q('SELECT 1 FROM characters WHERE id = $1', [charId])).length > 0,
    // the levels the Named follow: non-admin characters played lately, best first
    topLevels: async () => (await q(`SELECT c.lvl FROM characters c JOIN accounts a ON a.id = c.account_id
      WHERE NOT a.is_admin AND (a.discord_id IS NULL OR NOT (a.discord_id = ANY($1::text[]))) AND c.updated_at > now() - interval '${LEVEL_DAYS} days'
      ORDER BY c.lvl DESC LIMIT ${LEVEL_TOP}`, [adminIds])).map(r => r.lvl),
  };
}

// ---------- the manager ----------
export class NamedManager {
  constructor(game, mgr, { store = null, always = process.env.NAMED_ALWAYS === '1', presence = process.env.NAMED_PRESENCE !== '0', minLevel = Number(process.env.NAMED_LEVEL) || 1, bossAfter = Number(process.env.NAMED_BOSS_AFTER) || 0, now = Date.now, interval = 1000 } = {}) {
    this.game = game; this.mgr = mgr; this.store = store; this.always = always; this.now = now; this.minLevel = minLevel; this.bossAfter = bossAfter;
    this.presence = presence && !always; // (PRESENCE: off, they're present whenever a human is on their floor)
    this.pres = Object.fromEntries(Object.keys(GROUPS).map(k => [k, { seen: 0, wakeUntil: 0 }])); // group -> last time a human was near / in its home area; woken until
    this.pending = []; // invites, calls and accepted invitations waiting for a woken Named to come in: { id, hid, kind, at, out }
    this.chars = new Map(NAMED.slice(0, NAMED_MAX).map(def => [def.id, { def, lvl: 1, off: LEVEL_OFFSET, enabled: true, allow: [], rejoin: 0, e: null, pid: 0, seenAt: 0, seenSaved: 0, summonAt: -1e15, hostT: null, dirty: false }]));
    this.friends = new Map();   // player key -> Map(named id -> record)
    this.dirtyFr = new Set();   // `${charId}:${namedId}` waiting to be saved
    this.whisperAt = new Map(); // player key -> when the loner last whispered them
    this.plans = Object.fromEntries(Object.keys(GROUPS).map(k => [k, { mode: 'farm', nextAt: 0, since: 0, floor: 1, fought: false, homeAt: 0 }]));
    this.levels = { at: 0, list: [] };
    this.away = {};             // group -> the "while you were away" line of this visit
    this.emptyAt = 0; this.flushAt = 0; this.parked = false;
    game.named = this;
    mgr.nameReserved = isNamedName; // admin and player-added bots can't take their names (server/botmanager.js, playerbots.js, botedit.js)
    mgr.namedJoin = (p, id) => { const st = this.chars.get(id); if (st) { p.named = id; this.outfit(st, p); } }; // in their own gear and look from the first snapshot
    const roster = game.roster.bind(game); // roster rows of the Named carry their id (nameplates, the Friends tab)
    game.roster = () => roster().map(r => { const id = game.players.get(r.id)?.named; return id ? { ...r, named: id } : r; });
    if (interval) { this.timer = setInterval(() => this.upkeep(), interval); this.timer.unref?.(); }
  }

  async useStore(store) {
    this.store = store;
    try {
      for (const r of await store.loadChars()) {
        const st = this.chars.get(r.id);
        if (!st) continue;
        st.lvl = Math.max(st.lvl, Math.min(MAX_LEVEL, r.lvl | 0)); st.off = r.lvl_off | 0; st.enabled = r.enabled !== false;
        st.allow = cleanAllow(r.allow || []); if (st.e) st.e.allow = st.allow;
        st.seenAt = st.seenSaved = r.seen_at ? new Date(r.seen_at).getTime() : 0;
      }
    } catch (e) { console.error('[named] load failed:', e.message); }
  }

  // ---------- lookups ----------
  humans() { return this.mgr.realPlayers(); }
  playerOf(st) { return st?.e ? this.mgr.livePlayer(st.e) : null; }
  online() { return [...this.chars.values()].filter(st => this.playerOf(st)); }
  stOf(p) { return p?.named ? this.chars.get(p.named) || null : null; }
  byName(name) {
    const lower = String(name || '').trim().toLowerCase();
    if (!lower) return null;
    const all = [...this.chars.values()];
    const hit = all.find(st => st.def.name.toLowerCase() === lower || st.def.id === lower);
    if (hit || lower.length < 3) return hit || null;
    const pre = all.filter(st => st.def.name.toLowerCase().startsWith(lower));
    return pre.length === 1 ? pre[0] : null;
  }
  hostOf(p) { // a human in p's party
    const party = this.game.partyOf(p);
    return party ? party.members.map(id => this.game.players.get(id)).find(isHuman) || null : null;
  }
  // Room in h's party for one more of the Named ('' = room): several may join one party (owner 2026-11-21), never past
  // PARTY_MAX, counting the other Named who hold h's invite (they could accept at any moment).
  partyRoom(h, st) {
    const party = this.game.partyOf(h), size = party?.members.length || 1;
    const open = this.online().filter(o => { const q = o !== st && this.playerOf(o); return q && q.invite?.from === h.id && !(party && q.party === party.id); }).length;
    return size + open >= PARTY_MAX ? 'Your party is full.' : '';
  }
  humanIn(ids) { for (const id of ids) if (isHuman(this.game.players.get(id))) return true; return false; }
  say(p, text) { if (p && text) this.game.events.push({ t: 'chat', id: p.id, from: p.name, text, ch: 's', x: r2(p.x), z: r2(p.z) }); }
  send(h, o) { if (h?.ws?.readyState === 1) h.ws.send(JSON.stringify({ type: 'named', ...o })); }

  // ---------- friendship ----------
  keyOf(p) { return p.charId || `s${p.id}`; } // anonymous players: this session only
  // m.loaded: the stored rows are in (until then nothing of this player's is saved, so a failed or slow load can't
  // overwrite what's stored); a failed load is tried again from tick.
  friendsOf(p) {
    const key = this.keyOf(p);
    let m = this.friends.get(key);
    if (!m) { this.friends.set(key, m = new Map()); m.loaded = !(p.charId && this.store); }
    if (!m.loaded && !m.loading && this.now() - (m.failAt || -1e15) >= RULES.loadRetry * 1000) this.loadFriends(p.charId, key, m);
    return m;
  }
  loadFriends(charId, key, m) {
    m.loading = true;
    return Promise.resolve().then(() => this.store.loadFriends(charId)).then(rows => {
      m.loading = false;
      if (this.friends.get(key) !== m) return;
      for (const r of rows) {
        if (!this.chars.has(r.named_id)) continue;
        const had = m.get(r.named_id), rec = { pts: +r.pts || 0, day: r.day | 0, got: +r.got || 0, chat: +r.chat || 0 };
        if (had?.abs) continue; // (set outright meanwhile: the admin page, a test)
        if (had) { // earned before the load finished: added on top of what's stored, and saved
          rec.pts = Math.min(100, rec.pts + had.pts);
          if (rec.day === had.day) { rec.got += had.got; rec.chat += had.chat; } else if (had.day > rec.day) { rec.day = had.day; rec.got = had.got; rec.chat = had.chat; }
          this.dirtyFr.add(`${charId}:${r.named_id}`);
        }
        m.set(r.named_id, rec);
      }
      m.loaded = true;
    }, e => { m.loading = false; m.failAt = this.now(); console.error('[named] friendship load failed:', e.message); });
  }
  recOf(p, id) { const m = this.friendsOf(p); let rec = m.get(id); if (!rec) m.set(id, rec = newFriendship()); return rec; }
  peek(p, id) { return this.friends.get(this.keyOf(p))?.get(id) || null; }
  friendship(p, id) {
    const st = this.chars.get(id);
    if (!st || !isHuman(p)) return null;
    const rec = this.peek(p, id) || (this.friendsOf(p), newFriendship()), i = tierIndex(rec.pts);
    return { pts: rec.pts, tier: TIERS[i].id, tierIndex: i, tierName: TIERS[i].name, left: dailyLeft(rec, st.def, this.now()) };
  }
  // amount: base points for a GAINS source (scaled by the character's rate, cut to the daily cap); reason 'downed': the loss.
  add(p, id, amount, reason = 'fight') {
    const st = this.chars.get(id);
    if (!st || !isHuman(p)) return null;
    const rec = this.recOf(p, id);
    const r = reason === 'downed' ? loseFriendship(rec, st.def, 'downed') : gainFriendship(rec, st.def, reason, +amount || 0, this.now());
    if (!r.d) return r;
    if (p.charId) this.dirtyFr.add(`${p.charId}:${id}`);
    this.send(p, { op: 'fr', id, name: st.def.name, d: r.d, pts: r.pts, tier: TIERS[r.tier].id, tierName: TIERS[r.tier].name, up: r.up, why: reason });
    if (r.up) this.game.track(p, 'named_tier', { named: id, tier: TIERS[r.tier].id });
    return r;
  }
  dropFriends(p) { // a player leaves: save theirs, forget the cache
    this.flushFriends(p.charId || 0);
    this.friends.delete(this.keyOf(p));
    this.whisperAt.delete(`s${p.id}`);
  }
  // Both return a promise of the writes they started (shutdown waits for them).
  flushFriends(only = 0) {
    if (!this.store) { this.dirtyFr.clear(); return Promise.resolve(); }
    const writes = [];
    for (const key of [...this.dirtyFr]) {
      const [cid, id] = key.split(':'), charId = +cid;
      if (only && charId !== only) continue;
      const m = this.friends.get(charId);
      if (m && !m.loaded) continue; // not until the stored rows are in (merged, then saved)
      this.dirtyFr.delete(key);
      const rec = m?.get(id);
      if (rec) writes.push(this.store.saveFriend(charId, id, { ...rec }).catch(e => { this.dirtyFr.add(key); console.error('[named] friendship save failed:', e.message); }));
    }
    return Promise.all(writes);
  }
  flushChars() {
    if (!this.store) return Promise.resolve();
    const writes = [];
    for (const st of this.chars.values()) {
      if (!st.dirty) continue;
      st.dirty = false; st.seenSaved = st.seenAt;
      writes.push(this.store.saveChar({ id: st.def.id, lvl: st.lvl, off: st.off, enabled: st.enabled, seenAt: st.seenAt, allow: st.allow }).catch(e => { st.dirty = true; console.error('[named] save failed:', e.message); }));
    }
    return Promise.all(writes);
  }
  async flush() { await Promise.allSettled([this.flushFriends(), this.flushChars()]); } // (shutdown: only what's still waiting)

  // ---------- invites and calls ----------
  // Who may control this Named (shared/accesslevels.js: no creator; access 3+, their allow list, else the action's minimum).
  ctlBlock(h, st, action) { return this.mgr.controlBlock?.(h, { creator: null, allow: st.allow, name: st.def.name }, action) || ''; }
  // Why this human can't invite this Named right now ('' = they can).
  inviteBlock(h, st) {
    const def = st.def, p = this.playerOf(st);
    const ctl = this.ctlBlock(h, st, 'botInvite');
    if (ctl) return ctl;
    if (!st.enabled) return `${def.name} is out of the world (despawned). Respawn them first.`;
    if (!p && !this.resting(st)) return `${def.name} isn't around right now.`;
    if (p && h.party && p.party === h.party) return `${def.name} is already in your party.`;
    const rec = this.peek(h, def.id) || newFriendship();
    if (!canInvite(def, rec.pts)) return `${def.name} only joins ${art(TIERS[tierAt(def.trust.invite)].name)} (you: ${TIERS[tierIndex(rec.pts)].name}).`;
    return (p && this.freeBlock(h, st, p)) || this.partyRoom(h, st);
  }
  freeBlock(h, st, p) { // busy rules, the same for an invite and a call
    const def = st.def, host = this.hostOf(p);
    if (p.dead || p.downed) return `${def.name} is down.`;
    if (host && host !== h) return `${def.name} is in ${host.name}'s party.`;
    const f = this.game.activeFightOf?.(p);
    if (f && inBossRoom(p)) return `${def.name} is in a boss fight.`;
    return '';
  }
  callBlock(h, st) {
    const def = st.def, p = this.playerOf(st), now = this.now();
    const ctl = this.ctlBlock(h, st, 'botInvite'); // (a call brings them into your party: the invite rule)
    if (ctl) return ctl;
    if (!p && !this.resting(st)) return `${def.name} isn't around right now.`;
    if (p && h.party && p.party === h.party) return `${def.name} is already with you.`;
    const rec = this.peek(h, def.id) || newFriendship();
    if (!canSummon(def, rec.pts)) return `${def.name} only comes when ${art(TIERS[tierAt(def.trust.summon)].name)} friend calls.`;
    const left = st.summonAt + RULES.summonCd * 1000 - now;
    if (left > 0) return `${def.name} was called away a moment ago. Try again in ${Math.ceil(left / 60000)} min.`;
    if (h.dead || h.downed) return 'Wait until you are back on your feet.';
    return (p && this.freeBlock(h, st, p)) || this.partyRoom(h, st);
  }
  // game.invite(h, a Named): true = let the invite through (the bot accepts it).
  onInvite(h, t) {
    const st = this.stOf(t);
    if (!st) return true;
    const why = this.inviteBlock(h, st);
    if (!why) return true;
    const rec = this.peek(h, st.def.id) || newFriendship();
    const key = this.ctlBlock(h, st, 'botInvite') ? '' : !canInvite(st.def, rec.pts) ? 'refuse' : /boss fight|party\.$/.test(why) ? 'busy' : '';
    if (key && dist(h, t) < 40) this.say(t, namedLine(st.def, key, { who: h.name }));
    this.game.sys(why, h.id);
    return false;
  }
  // A Sworn friend calls: the Named joins their party and comes to them. Returns '' or why not.
  call(h, id) {
    const st = this.chars.get(id), g = this.game;
    if (!st || !isHuman(h)) return 'Nobody by that name.';
    const why = this.callBlock(h, st);
    if (why) { g.sys(why, h.id); return why; }
    if (!this.playerOf(st)) { this.wake(st, h, 'call'); g.sys(`${st.def.name} heard your call and is on the way.`, h.id); return ''; } // resting: they come in, then answer (runPending)
    const p = this.playerOf(st);
    this.mgr.joinParty(p, h);
    if (p.party !== h.party || !h.party) { g.sys(`${st.def.name} couldn't join your party.`, h.id); return 'failed'; }
    st.summonAt = this.now(); // (spent only on a call that worked)
    this.mgr.catchUp(p, h);
    this.say(p, namedLine(st.def, 'called', { who: h.name }));
    g.sys(`${st.def.name} answers your call.`, h.id);
    return '';
  }
  onDecline(h, np) { if (this.stOf(np)?.def.group === 'loner') h.nmDeclined = true; } // no more raid invites this session
  onAccept(h, np) { // someone took the loner's raid invite: he still leads the way
    const st = this.stOf(np), plan = st && this.plans[st.def.group];
    if (st && plan?.mode === 'boss' && st.e) st.e.b.cmd = { k: 'boss', by: 0, byName: st.def.name, adm: true, at: st.e.b.t, group: [np.id], nm: 1 };
  }

  // { type: 'named' } from a client
  handle(p, msg) {
    if (!isHuman(p)) return;
    const now = this.now(), op = String(msg.op || '');
    if (op === 'list') {
      if (now - (p.nmListAt || 0) < 400) return;
      p.nmListAt = now;
      return this.send(p, { op, list: this.listFor(p) });
    }
    const r = (p.nmRate ||= { n: 0, at: now });
    if (now - r.at > 5000) { r.n = 0; r.at = now; }
    if (++r.n > 8) return this.send(p, { op, error: 'Slow down a little.' });
    const st = this.chars.get(String(msg.id || ''));
    if (!st) return this.send(p, { op, error: 'Nobody by that name.' });
    if (op === 'invite') {
      const t = this.playerOf(st);
      if (!t && this.resting(st)) { // resting: wake them; the invite goes out once they're in (runPending)
        const why = this.inviteBlock(p, st);
        if (!why) this.wake(st, p, 'invite');
        return this.send(p, { op, ...(why ? { error: why } : { msg: `${st.def.name} is on the way: your invite goes out when they arrive.` }), list: this.listFor(p) });
      }
      if (!t) return this.send(p, { op, error: `${st.def.name} isn't around right now.`, list: this.listFor(p) });
      const why = this.inviteBlock(p, st);
      this.game.invite(p, t.id); // (the gate in installNamed answers a refusal in character)
      return this.send(p, { op, ...(why ? { error: why } : { msg: `Invited ${st.def.name}.` }), list: this.listFor(p) });
    }
    if (op === 'call') {
      const why = this.call(p, st.def.id);
      return this.send(p, { op, ...(why ? { error: why } : { msg: `${st.def.name} is on the way.` }), list: this.listFor(p) });
    }
    this.send(p, { op, error: 'Unknown request.' });
  }

  // The Friends tab: every Named with this player's standing.
  listFor(h) {
    const now = this.now();
    const rows = [...this.chars.values()].map(st => {
      const def = st.def, p = this.playerOf(st), rec = this.peek(h, def.id) || newFriendship(), i = tierIndex(rec.pts);
      const host = p && this.hostOf(p), mine = !!(p && h.party && p.party === h.party);
      let doing;
      if (!p) doing = !st.enabled ? 'Away' : this.parked ? 'Resting (a show is on)' : this.resting(st) ? 'Resting at home (comes if you invite or call)' : 'Elsewhere in the tower';
      else if (p.dead) doing = 'Down';
      else if (mine) doing = 'With you';
      else if (host) doing = `With ${host.name}`;
      else doing = st.e.b.goal || 'Wandering';
      const ib = this.inviteBlock(h, st), cb = this.callBlock(h, st);
      return {
        id: def.id, name: def.name, cls: def.cls, role: def.role, group: def.group, gname: GROUPS[def.group].name, color: lookColor(def), blurb: def.blurb,
        online: !!p, resting: this.resting(st), lvl: p?.lvl ?? st.lvl, hp: p?.hp ?? 0, maxHp: p?.maxHp ?? 0, area: p ? areaName(p.x, p.z) : '', floor: p ? floorOf(p.x) : 0, doing, mine,
        pts: rec.pts, tier: i, tierName: TIERS[i].name, prog: r2(tierProgress(rec.pts)), next: TIERS[i + 1] ? { name: TIERS[i + 1].name, at: TIERS[i + 1].at } : null,
        left: dailyLeft(rec, def, now), inviteAt: TIERS[tierAt(def.trust.invite)].name, callAt: TIERS[tierAt(def.trust.summon)].name,
        invite: ib ? { ok: false, why: ib } : { ok: true }, call: cb ? { ok: false, why: cb } : { ok: true },
      };
    });
    return { rows, away: Object.values(this.away).filter(Boolean), reset: nextReset(now), motto: GROUPS.heroes.motto };
  }

  // ---------- spawning ----------
  spawn(st, floor) {
    const def = st.def, F = FLOORS[floor] || FLOORS[1];
    const [view] = this.mgr.start([def.cls], [def.name], { lvl: st.lvl, behaviour: F.beh.farm, follow: '', skill: NAMED_SKILL, join: { named: def.id, f2: 1, f3: 1 } });
    const e = this.mgr.bots.find(x => x.bid === view.bid);
    e.named = def.id; e.b.noBoss = true; e.allow = st.allow; e.creator = null; // (one of a kind: nobody's creation)
    st.e = e; st.pid = 0; st.hostT = null; st.fresh = true;
  }
  despawn(st) {
    if (!st.e) return;
    this.mgr.remove(st.e.bid);
    st.e = null; st.pid = 0; st.hostT = null;
    this.game.rosterDirty = true;
  }
  despawnAll() {
    let any = false;
    for (const st of this.chars.values()) if (st.e) { this.despawn(st); any = true; }
    if (any) { this.away = {}; for (const plan of Object.values(this.plans)) Object.assign(plan, { mode: 'farm', nextAt: 0, fought: false, homeAt: 0 }); }
  }
  place(p, floor) {
    const F = FLOORS[floor];
    if (!F) return;
    const [hx, hz] = F.home(this.game), a = Math.random() * Math.PI * 2;
    const [x, z] = resolveCollision(hx + Math.sin(a) * 2.5, hz + Math.cos(a) * 2.5);
    this.game.teleport(p, x, z);
  }
  // The premade setup for their level (like a player-added bot's), with their own weapon style.
  outfit(st, p) {
    const g = this.game, L = loadoutFor(p.lvl), role = CLASSES[p.cls]?.role || 'Damage', mid = () => 0.5;
    p.inv.eq = { weapon: makeItem('weapon', L.rarity, p.cls, mid, undefined, st.def.style), armor: makeItem('armor', L.rarity, p.cls, mid), charm: makeItem('charm', L.rarity, p.cls, mid, charmFor(role)) };
    p.inv.bag = [];
    for (const s of SLOTS) botAffixes(p.inv.eq[s], p.cls);
    const pts = MASTERY.need[L.mastery] || 0;
    for (const [sk, m] of Object.entries(p.mastery || {})) {
      m.pts = Math.max(m.pts || 0, pts);
      if (L.evolved && !m.br) m.br = defaultBranch(sk);
    }
    g.autoSpendTalents?.(p);
    g.recompute(p); p.hp = p.maxHp;
    p.invDirty = true; p.masteryDirty = true; p.masteryNow = true;
    g.setLook?.(p, st.def.look?.id); // their look (I2: shared/looks.js), on every join
    st.pid = p.id; st.outfitLvl = p.lvl;
  }

  // ---------- level ----------
  refreshLevels(humans) {
    this.levels.at = this.now();
    const live = humans.filter(h => !h.admin && !(h.charId && this.store)).map(h => h.lvl); // unsaved players count as they are
    const apply = list => {
      this.levels.list = list;
      for (const st of this.chars.values()) {
        const lvl = namedLevel(list, { offset: st.off, floor: Math.max(st.lvl, this.minLevel) });
        if (lvl !== st.lvl) { st.lvl = lvl; st.dirty = true; }
      }
    };
    if (!this.store) return apply(live);
    this.store.topLevels().then(db => apply([...db, ...live])).catch(e => console.error('[named] levels failed:', e.message));
  }
  // admin: the offset above the top players (reset: work the level out afresh instead of never dropping)
  setOffset(off, { reset = false, id = null } = {}) {
    for (const st of this.chars.values()) {
      if (id && st.def.id !== id) continue;
      st.off = Math.max(-10, Math.min(MAX_LEVEL, off | 0));
      if (reset) st.lvl = 1;
      st.lvl = namedLevel(this.levels.list, { offset: st.off, floor: st.lvl });
      st.dirty = true;
      if (reset) this.despawn(st); // back at the new level
    }
    this.flushChars();
  }
  // Out of the world (on = false) or back (true): the admin page, or a permitted player (despawnBy / respawnBy). Out,
  // they remember the human party they were in; back, they rejoin it (rejoinHost; then their group wakes at once), else
  // they roam as before. `by`: the player who brought them back (wakes them too).
  setEnabled(id, on, by = null) {
    const st = this.chars.get(id), g = this.game;
    if (!st) return false;
    if (!on && st.enabled) { const p = this.playerOf(st), host = p && this.hostOf(p); st.rejoin = host ? { party: p.party, host: host.id } : 0; }
    const was = st.enabled;
    st.enabled = !!on; st.dirty = true;
    if (!on) this.despawn(st);
    else if (!was) {
      const host = this.rejoinHost(st.rejoin);
      st.rejoin = 0;
      if (host) this.wake(st, host.h, 'rejoin', { party: host.party });
      else if (isHuman(by)) this.wake(st, by, 'respawn');
    }
    this.flushChars();
    return true;
  }
  // The party a respawned Named goes back to: the one they left, if it's still there with a human and room (other
  // Named in it are fine); or (a party of two breaks up when they leave) the human they were with, still online and in no party: a new
  // party with them. Else none: they roam. -> { h, party (0: make one with h) } | null
  rejoinHost(r) {
    const g = this.game;
    if (!r) return null;
    const party = g.parties.get(r.party), h = g.players.get(r.host);
    if (party) {
      const host = party.members.map(i => g.players.get(i)).find(isHuman);
      return host && party.members.length < PARTY_MAX ? { h: host, party: party.id } : null;
    }
    return isHuman(h) && !h.party ? { h, party: 0 } : null;
  }
  // A player despawns / respawns one (the Players list): '' or why not.
  despawnBy(h, id) {
    const st = this.chars.get(id);
    if (!st) return 'Nobody by that name.';
    const why = this.ctlBlock(h, st, 'botDespawn');
    if (why) return why;
    if (!st.enabled) return `${st.def.name} is already out of the world.`;
    const p = this.playerOf(st);
    const other = this.othersParty(h, p);
    if (other) return other;
    if (p && inBossRoom(p) && this.game.activeFightOf?.(p)) return `${st.def.name} is in a boss fight.`;
    this.setEnabled(id, false);
    return '';
  }
  // Despawning one who is in someone else's party: only access 3+ (no griefing another player's party). '' = fine.
  othersParty(h, p) {
    const host = p && this.hostOf(p);
    if (!host || host.id === h.id || (h.party && p.party === h.party) || accessOf(h) >= ACCESS.overrideBots) return '';
    return `${p.name} is in ${host.name}'s party.`;
  }
  respawnBy(h, id) {
    const st = this.chars.get(id);
    if (!st) return 'Nobody by that name.';
    const why = this.ctlBlock(h, st, 'botRespawn');
    if (why) return why;
    if (st.enabled) return `${st.def.name} is already in the world (each of the Named is one of a kind).`;
    if (this.parked) return 'A show is being filmed: try again after it.';
    this.setEnabled(id, true, h);
    return '';
  }
  // admin: who may control one besides access 3+ (names or character ids; [] = anyone at the action's minimum)
  setAllow(id, list) {
    const st = this.chars.get(id);
    if (!st) return null;
    st.allow = cleanAllow(list); st.dirty = true;
    if (st.e) st.e.allow = st.allow;
    this.flushChars();
    return st.allow;
  }
  // The Players list's Bots section: each Named, where they are, and what this player may do (ok / why).
  botRows(h) {
    const g = this.game;
    return [...this.chars.values()].map(st => {
      const def = st.def, p = this.playerOf(st), mine = !!(p && h.party && p.party === h.party);
      const party = p && g.partyOf(p), host = p && this.hostOf(p);
      const state = !st.enabled ? 'despawned' : p ? 'online' : this.parked ? 'parked' : this.resting(st) ? 'resting' : 'away';
      const where = state === 'despawned' ? 'Out of the world (despawned)' : state === 'resting' ? 'Resting at home' : state === 'parked' ? 'Resting (a show is on)' : state === 'away' ? 'Away'
        : mine ? 'In your party' : host ? `In ${host.name}'s party` : party ? `With ${GROUPS[def.group].name}` : 'Roaming';
      const c = why => (why ? { ok: false, why } : { ok: true });
      const ib = mine ? 'Already in your party.' : this.inviteBlock(h, st);
      const kb = !mine ? 'Not in your party.' : this.ctlBlock(h, st, 'botKick');
      const db = !st.enabled ? 'Already out of the world.' : this.ctlBlock(h, st, 'botDespawn') || this.othersParty(h, p) || (p && inBossRoom(p) && g.activeFightOf?.(p) ? `${def.name} is in a boss fight.` : '');
      const rb = st.enabled ? 'Already in the world.' : this.ctlBlock(h, st, 'botRespawn') || (this.parked ? 'A show is being filmed.' : '');
      return {
        id: def.id, name: def.name, cls: def.cls, role: def.role, group: def.group, gname: GROUPS[def.group].name, color: lookColor(def),
        lvl: p?.lvl ?? st.lvl, dead: !!p?.dead, state, where, myParty: mine, lead: host?.name || '',
        ctl: { invite: c(ib), kick: c(kb), despawn: c(db), respawn: c(rb) },
      };
    });
  }
  // admin: set a character's friendship (online: the live record too)
  async setFriendship(charId, id, pts) {
    const st = this.chars.get(id);
    if (!st) throw new Error('Unknown Named.');
    pts = Math.max(0, Math.min(100, r2(+pts || 0)));
    const live = this.humans().find(p => p.charId === charId);
    let rec;
    if (live) { rec = this.recOf(live, id); rec.pts = pts; rec.abs = true; this.send(live, { op: 'fr', id, name: st.def.name, d: 0, pts, tier: TIERS[tierIndex(pts)].id, tierName: TIERS[tierIndex(pts)].name, up: false, why: 'admin' }); }
    else rec = { ...newFriendship(), pts };
    if (this.store) await this.store.saveFriend(charId, id, rec);
    return { charId, id, pts, tier: TIERS[tierIndex(pts)].name };
  }
  adminView() {
    return {
      on: true, always: this.always, parked: this.parked, humans: this.humans().length, levels: this.levels.list, max: NAMED_MAX,
      chars: [...this.chars.values()].map(st => {
        const p = this.playerOf(st), host = p && this.hostOf(p);
        return { id: st.def.id, name: st.def.name, cls: st.def.cls, style: p?.style || st.def.style, talents: p ? Object.values(p.talents || {}).reduce((s, r) => s + (r | 0), 0) : 0, group: st.def.group, gname: GROUPS[st.def.group].name, lvl: p?.lvl ?? st.lvl, off: st.off, enabled: st.enabled, online: !!p, area: p ? areaName(p.x, p.z) : '', doing: p ? (p.dead ? 'Down' : st.e.b.goal || '') : '', host: host?.name || '', plan: this.plans[st.def.group].mode, allow: st.allow };
      }),
    };
  }

  // ---------- once a second ----------
  upkeep() { try { this.tick(); } catch (e) { console.error('[named]', e); } }
  tick() {
    const g = this.game, now = this.now(), humans = this.humans();
    for (const st of this.chars.values()) if (st.e && (st.e.b.closed || !this.mgr.bots.includes(st.e))) { st.e = null; st.pid = 0; } // removed elsewhere
    if (!humans.length && !this.always) { // nobody online: nothing is simulated (and nothing written)
      if (!this.emptyAt) this.emptyAt = now;
      if (now - this.emptyAt >= RULES.linger * 1000) this.despawnAll();
      return;
    }
    this.emptyAt = 0;
    for (const h of humans) this.friendsOf(h);
    if (now - this.levels.at > 60000) this.refreshLevels(humans);
    this.parked = !!g.director?.running;
    if (this.parked) return this.despawnAll(); // a show is being filmed
    for (const group of Object.keys(GROUPS)) this.runGroup(group, humans, now);
    if (this.pending.length) this.runPending(now);
    for (const st of this.chars.values()) if (st.e && now - st.seenSaved > 120000) { st.seenAt = now; st.dirty = true; }
    if (humans.length && now - this.flushAt > 3000) { this.flushAt = now; this.flushFriends(); this.flushChars(); }
  }

  runGroup(group, humans, now) {
    const g = this.game, plan = this.plans[group], members = [...this.chars.values()].filter(st => st.def.group === group);
    // the floor the group keeps to: where the humans are
    const count = {};
    for (const h of humans) { const f = floorOf(h.x); count[f] = (count[f] || 0) + 1; }
    const busy = members.some(st => { const p = this.playerOf(st); return p && !p.dead && inBossRoom(p) && !this.hostOf(p); });
    if (!count[plan.floor] && humans.length && !busy) plan.floor = +Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const floor = plan.floor, F = FLOORS[floor];
    const present = !!F && (this.always || (this.presence ? this.wanted(group, members, humans, now) : !!count[floor]));
    const free = [];
    for (const st of members) {
      let p = this.playerOf(st);
      const host = p && this.hostOf(p);
      if (!(st.enabled && (present || host))) { this.despawn(st); continue; }
      if (!st.e) { this.noteAway(group, st, now); this.spawn(st, floor); continue; }
      if (!p) continue; // still joining
      if (st.fresh) { st.fresh = false; if (st.pid !== p.id) this.outfit(st, p); if (floor !== floorOf(p.x)) this.place(p, floor); g.rosterDirty = true; }
      if (p.lvl < st.lvl) { this.mgr.setLevel(st.e, st.lvl); this.outfit(st, p); }
      if (host) this.withHost(st, p, host); else { st.hostT = null; if (st.e.b.cmd?.nm) st.e.b.cmd = null; free.push([st, p]); }
    }
    if (!present && !members.some(st => st.e)) Object.assign(plan, { mode: 'farm', nextAt: 0, fought: false, homeAt: 0 }); // gone home: a fresh plan next visit
    if (this.away[group] === undefined && free.length) this.tellAway(group, members, humans, now);
    if (!free.length) return;
    // on the right floor, in one party (the Hearthward) or none (the loner)
    const lead = free[0][1];
    const own = p => { const party = g.partyOf(p); return !party || party.members.every(id => g.players.get(id)?.named && this.stOf(g.players.get(id))?.def.group === group); };
    for (const [st, p] of free) {
      if (!p.dead && F && floorOf(p.x) !== floor && !inBossRoom(p) && now - (st.placedAt || 0) > 5000) { st.placedAt = now; this.place(p, floor); }
      if (p.party && (!GROUPS[group].party || !own(p))) g.leaveParty(p); // (what's left of a player's party)
      if (GROUPS[group].party && p !== lead && (!p.party || p.party !== lead.party)) this.mgr.joinParty(p, lead);
    }
    this.plan(group, plan, F, free, members, humans, now);
    const beh = F.beh[plan.mode] || F.beh.farm;
    for (const [st] of free) {
      const e = st.e;
      if (e.behaviour !== beh) { e.group.configure({ behaviour: beh, follow: '' }); e.behaviour = beh; }
      e.b.noBoss = plan.mode !== 'boss';
    }
  }

  // ---------- presence (PRESENCE) ----------
  // Should this group be in the world now? Woken; or already in and a human near them (or in their home area) within
  // the last PRESENCE.idle s, or in a boss fight; or out, a human in their home area, and room under the cap.
  wanted(group, members, humans, now) {
    const ps = this.pres[group], live = members.map(st => this.playerOf(st)).filter(p => p && !this.hostOf(p)); // (one in a human's party stays anyway: not the rest's reason)
    const home = humans.some(h => inHome(members[0].def.home, h));
    const near = humans.some(h => live.some(p => floorOf(p.x) === floorOf(h.x) && dist(p, h) <= PRESENCE.near));
    if (home || near) ps.seen = now;
    if (now < ps.wakeUntil) return true;
    if (members.some(st => st.e)) return now - ps.seen < PRESENCE.idle * 1000 || live.some(p => !p.dead && (inBossRoom(p) || this.game.activeFightOf?.(p)));
    return home && this.capRoom(group, humans.length);
  }
  // With few humans online, at most PRESENCE.cap[humans] Named in the world (not counting those in a human's party);
  // a party group (the Hearthward) counts as one.
  capRoom(group, nHumans) {
    const cap = PRESENCE.cap[nHumans];
    if (cap === undefined) return true;
    const unitsOf = g => (GROUPS[g].party ? 1 : 0);
    let used = 0;
    for (const g of Object.keys(GROUPS)) {
      if (g === group) continue;
      const free = [...this.chars.values()].filter(st => st.def.group === g && st.e && !(this.playerOf(st) && this.hostOf(this.playerOf(st))));
      if (free.length) used += unitsOf(g) || free.length;
    }
    const mine = unitsOf(group) || [...this.chars.values()].filter(st => st.def.group === group && st.enabled).length;
    return used + mine <= cap;
  }
  // Resting: enabled and not in the world only because nobody is near (a human is online, no show on). An invite,
  // a call or an accepted invitation wakes them (wake).
  resting(st) { return !!st && this.presence && st.enabled && !st.e && !this.parked && this.humans().length > 0; }
  // A stand-in for a resting Named (I3's talk: answered from afar, never "near").
  restingView(st) { return this.resting(st) ? { id: 0, x: 0, z: 70, lvl: st.lvl, hp: 1, maxHp: 1, party: 0, dead: false, downed: null, resting: true } : null; }
  wake(st, h, kind, extra = {}) {
    const group = st.def.group, now = this.now(), ps = this.pres[group];
    ps.wakeUntil = now + PRESENCE.wake * 1000; ps.seen = now;
    this.pending = this.pending.filter(q => !(q.hid === h.id && q.id === st.def.id));
    this.pending.push({ id: st.def.id, hid: h.id, kind, at: now, ...extra });
    this.runGroup(group, this.humans(), now); // in at once (the request goes through once they've joined)
  }
  runPending(now) {
    for (const q of this.pending.splice(0)) {
      const st = this.chars.get(q.id), h = this.game.players.get(q.hid), p = this.playerOf(st);
      if (!h || !isHuman(h) || now - q.at > 20000) continue; // (gone, or they never came)
      if (!p || st.fresh) { this.pending.push(q); continue; }
      const name = st.def.name;
      if (q.kind === 'invite') {
        const why = this.inviteBlock(h, st);
        this.game.invite(h, p.id);
        this.send(h, { op: 'invite', ...(why ? { error: why } : { msg: `Invited ${name}.` }), list: this.listFor(h) });
      } else if (q.kind === 'call') {
        const why = this.call(h, q.id);
        this.send(h, { op: 'call', ...(why ? { error: why } : { msg: `${name} is on the way.` }), list: this.listFor(h) });
      } else if (q.kind === 'out') this.quests?.join?.(h, st, q.out);
      else if (q.kind === 'rejoin') { // respawned: back into the party they left (rejoinHost: still there, or with the same human)
        const party = q.party && this.game.parties.get(q.party);
        if (party ? party.members.includes(h.id) && party.members.length < PARTY_MAX : !h.party) this.mgr.joinParty(p, h); // (withHost says hello)
      }
    }
  }

  // In a human's party: stay while there's fighting, go home after RULES.partyIdle quiet seconds.
  withHost(st, p, host) {
    const g = this.game;
    st.e.b.noBoss = false;
    if (st.hostT == null) { st.hostT = g.time; this.say(p, namedLine(st.def, 'join', { who: host.name })); }
    const party = g.partyOf(p);
    let last = st.hostT;
    for (const id of party.members) { const o = g.players.get(id); if (o) last = Math.max(last, o.lastCombat ?? -1e9, o.lastHurt ?? -1e9); }
    if (g.time - last < RULES.partyIdle || party.members.some(id => { const o = g.players.get(id); return o && !o.dead && g.activeFightOf?.(o); })) return; // (never in the middle of a boss fight)
    this.say(p, namedLine(st.def, 'home', { who: host.name }));
    for (const id of party.members) if (isHuman(g.players.get(id))) g.sys(`${st.def.name} heads home after a quiet while.`, id);
    g.leaveParty(p);
    st.hostT = null;
  }

  // Farm, and now and then the boss, but never near a human who isn't with them.
  plan(group, plan, F, free, members, humans, now) {
    const g = this.game, floor = plan.floor, fight = g[F.fight];
    const ours = !!fight && free.some(([, p]) => fight.ids.has(p.id));
    const inside = free.some(([, p]) => !p.dead && F.arena(p.x, p.z));
    const nearHuman = humans.some(h => floorOf(h.x) === floor && F.near(h.x, h.z));
    const farm = wait => { plan.mode = 'farm'; plan.nextAt = now + wait * 1000; plan.fought = false; };
    if (!plan.nextAt) plan.nextAt = now + (this.bossAfter || between(RULES.bossFirst)) * 1000;
    if (plan.homeAt && now >= plan.homeAt) { // back out of the chamber after their fight
      plan.homeAt = 0;
      for (const [, p] of free) if (!p.dead && (F.arena(p.x, p.z) || F.near(p.x, p.z))) this.place(p, floor);
    }
    if (plan.mode === 'farm') {
      const all = free.length === members.filter(st => st.enabled).length;
      const fit = free.every(([, p]) => !p.dead && !p.downed && p.lvl >= F.minLvl);
      const taken = Object.entries(this.plans).some(([k, o]) => k !== group && o.floor === floor && (o.mode === 'boss' || o.homeAt)); // one group at a boss at a time
      if (now < plan.nextAt || !all || !fit || nearHuman || fight || plan.homeAt || taken) return;
      plan.mode = 'boss'; plan.since = now; plan.fought = false;
      if (group === 'loner') this.raidWhispers(free[0][0], free[0][1], humans, now);
      return;
    }
    if (!ours && !plan.fought && free.length < members.filter(st => st.enabled).length) return farm(RULES.bossRetry); // one of them went off with a human: never short-handed
    if (ours || inside) { plan.fought = plan.fought || ours; if (!ours && plan.fought) { farm(between(RULES.bossEvery)); plan.homeAt = now + 12000; } return; }
    if (plan.fought) { farm(between(RULES.bossEvery)); plan.homeAt = now + 12000; return; } // it's over (a kill, or a wipe sent them to town)
    if (nearHuman || fight) return this.turnBack(group, RULES.bossRetry); // a human's fight, or a human at the gate: not theirs to join
    if (now - plan.since > RULES.bossGiveUp * 1000) farm(between(RULES.bossEvery));
  }

  // A Named at the raid gate (installNamed's toggleReady): a human at that boss's gate or in its room, and this one
  // isn't with them: turn the whole group back now, not at the next plan.
  gateBlocked(p) {
    const st = this.stOf(p), floor = floorOf(p.x), F = FLOORS[floor];
    if (!st || !F || this.hostOf(p)) return false;
    if (!this.humans().some(h => floorOf(h.x) === floor && F.near(h.x, h.z))) return false;
    this.turnBack(st.def.group, RULES.bossRetry);
    return true;
  }
  turnBack(group, wait) {
    const plan = this.plans[group], g = this.game;
    if (plan.mode === 'boss') Object.assign(plan, { mode: 'farm', nextAt: this.now() + wait * 1000, fought: false });
    for (const st of this.chars.values()) {
      const p = this.playerOf(st);
      if (st.def.group !== group || !p || this.hostOf(p)) continue;
      for (const gate of [g.gate, g.gate2, g.gate3]) gate?.ready.delete(p.id);
      st.e.b.noBoss = true;
    }
  }

  // 5b: the loner heads for a boss and tells his friends, once an hour at most, never after a "no" this session.
  raidWhispers(st, p, humans, now) {
    const def = st.def;
    for (const h of humans) {
      if (h.dead || h.nmDeclined || (h.party && h.party === p.party)) continue;
      const rec = this.peek(h, def.id);
      if (!rec || tierIndex(rec.pts) < tierAt('friend')) continue;
      const key = this.keyOf(h);
      if (now - (this.whisperAt.get(key) || -1e15) < RULES.whisperCd * 1000) continue;
      this.whisperAt.set(key, now);
      this.game.sys(`${def.name} whispers: "${namedLine(def, 'raid', { who: h.name })}"`, h.id);
      this.game.invite(p, h.id);
    }
  }

  // "While you were away": worked out from how long they were gone, never simulated.
  noteAway(group, st, now) { if (st.awayFrom === undefined) { st.awayFrom = st.seenAt || 0; st.lvlWas = st.lvl; } }
  tellAway(group, members, humans, now) {
    const st = members.find(m => m.awayFrom) || null;
    const line = st ? awayLine(group, (now - st.awayFrom) / 1000, { lvlFrom: st.lvlWas, lvlTo: st.lvl }) : '';
    this.away[group] = line;
    for (const m of members) { m.awayFrom = undefined; m.seenAt = now; }
    if (line) for (const h of humans) this.game.sys(line, h.id);
  }

  // ---------- hooks from installNamed ----------
  // A field mob died: friendship for fighting beside them, and a human who damaged it loses nothing to a Named's kill.
  onMobDead(m, killer) {
    const g = this.game;
    if (m.def.boss || m.temp || !m.contributors?.size) return;
    const named = [], humans = [];
    for (const id of m.contributors) { const p = g.players.get(id); if (p?.named) named.push(p); else if (isHuman(p)) humans.push(p); }
    if (!named.length || !humans.length) return;
    const n = GAINS.fight * (m.def.elite || m.rare ? RULES.eliteMult : 1);
    for (const h of humans) for (const p of named) if (dist(h, p) <= RULES.fightR) this.add(h, p.named, n, 'fight');
    if (!killer?.named || m.rare) return; // (a rare already pays every contributor in full)
    const party = g.partyOf(killer);
    for (const h of humans) {
      if (h.dead || dist(h, m) > RULES.tagR || (party?.members.includes(h.id) && dist(h, m) <= 30)) continue; // (already paid, undiluted; or long gone)
      g.giveXp(h, m.def.xp); g.dropLoot(h, m);
    }
  }
  // A boss fight ended: real help (at least RULES.bossShare of the damage, or of the healing done to others: healOther,
  // counted by installNamed's healPlayer wrap) in a fight the Named were in.
  onFightEnd(f, result) {
    const g = this.game;
    if (!f?.team || (result !== 'kill' && result !== 'wipe')) return;
    const named = [], rows = [];
    let dmg = 0, heal = 0;
    for (const [id, row] of f.team) {
      const p = g.players.get(id);
      dmg += row.dmg || 0; heal += row.healOther || 0;
      if (p?.named) named.push(p); else if (isHuman(p)) rows.push([p, row]);
    }
    for (const p of named) { const b = this.stOf(p)?.e?.b; if (b?.cmd?.nm) b.cmd = null; } // the loner's raid is over
    if (!named.length) return;
    for (const [h, row] of rows) {
      if (!((dmg > 0 && (row.dmg || 0) / dmg >= RULES.bossShare) || (heal > 0 && (row.healOther || 0) / heal >= RULES.bossShare))) continue;
      for (const p of named) this.add(h, p.named, result === 'kill' ? GAINS.boss : GAINS.bossTry, result === 'kill' ? 'boss' : 'bossTry');
    }
  }
  onRevived(p, r) { if (p.named && isHuman(r)) this.add(r, p.named, GAINS.revive, 'revive'); }
  onHealed(tg, by, got) {
    if (!tg.named || !isHuman(by) || got < RULES.healMin * tg.maxHp) return;
    const t = this.game.time, last = (by.nmHealT ||= {});
    if (t - (last[tg.named] ?? -99) < RULES.healGap) return;
    last[tg.named] = t;
    this.add(by, tg.named, GAINS.heal, 'heal');
  }
  onCovered(p, guard) { if (p.named && isHuman(guard)) this.add(guard, p.named, GAINS.cover, 'cover'); }
  // The only loss: they bled out with you standing near, in their party, and not even trying.
  onBledOut(p, mates) {
    const st = this.stOf(p);
    if (!st) return;
    for (const h of mates) {
      const r = this.add(h, p.named, 0, 'downed');
      if (r?.d) this.game.sys(`${st.def.name} bled out with you close by. ${namedLine(st.def, 'downed', { who: h.name })}`, h.id);
    }
  }
}

// ---------- wrappers on Game ----------
export function installNamed(Game) {
  const P = Game.prototype;
  const wrap = (name, fn) => { const orig = P[name]; if (orig) P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // The contract for I3 / I4.
  P.namedFriendship = function (player, namedId) {
    const p = typeof player === 'object' ? player : this.players.get(player);
    return this.named?.friendship(p, namedId) || null;
  };
  P.addFriendship = function (player, namedId, amount, reason) {
    const p = typeof player === 'object' ? player : this.players.get(player);
    return this.named?.add(p, namedId, amount, reason) || null;
  };

  // Their names are theirs: an anonymous player who types one gets a default name instead.
  wrap('addPlayer', function (orig, ws, name, cls, saved = null) {
    const mgr = this.named?.mgr;
    if (this.named && !saved && !(mgr.joining && mgr.joiningNamed) && isNamedName(name)) name = ''; // (a bot too, unless it's the Named's own join)
    return orig.call(this, ws, name, cls, saved);
  });
  wrap('removePlayer', function (orig, p, ...a) {
    if (this.named && !p.bot) this.named.dropFriends(p);
    return orig.call(this, p, ...a);
  });

  // No XP, loot or items of their own: their level follows the players and their gear is premade.
  wrap('giveXp', function (orig, p, amount) { return p?.named ? undefined : orig.call(this, p, amount); });
  wrap('dropLoot', function (orig, p, m) { return p?.named ? undefined : orig.call(this, p, m); });
  wrap('giveItem', function (orig, p, it) { return p?.named ? false : orig.call(this, p, it); });

  // Humans first: no killing blow on a boss while a human who fought it still stands in the arena.
  wrap('lastAttackHeld', function (orig, m, p) {
    if (orig.call(this, m, p)) return true;
    if (!this.named || !p?.named || !m?.def?.boss) return false;
    if (!(this.time - (m.nmHumanHit ?? -1e9) <= RULES.holdIdle)) return false; // no human has hit it for a while: theirs to finish
    const room = m.def.f3boss ? inArena3 : m.def.f2boss ? inArena2 : inArena;
    for (const id of m.contributors) { const h = this.players.get(id); if (isHuman(h) && !h.dead && room(h.x, h.z)) return true; }
    return false;
  });
  wrap('damageMob', function (orig, m, p, ...a) {
    if (this.named && m?.def?.boss && isHuman(p)) m.nmHumanHit = this.time; // (lastAttackHeld above)
    return orig.call(this, m, p, ...a);
  });
  wrap('killMob', function (orig, m, killer) {
    const out = orig.call(this, m, killer);
    if (this.named && m.dead) this.named.onMobDead(m, killer);
    return out;
  });

  // A boss felled by the Named with no human in it: no floor counter, no LAST ATTACK BONUS or "Floor N cleared"
  // announcement, no clear banner; one quiet line instead (game.js killMob, floor2.js killSovereign, floor3.js
  // killColossus call this). Returns that line, or '' for a clear announced as always (bots alone included).
  P.quietClear = function (ids, boss) {
    const N = this.named;
    if (!N || N.humanIn(ids)) return '';
    const named = [...ids].map(id => this.players.get(id)).filter(o => o?.named);
    if (!named.length) return '';
    const groups = new Set(named.map(o => N.stOf(o)?.def.group));
    const who = groups.size === 1 && groups.has('heroes') && GROUPS.heroes.party ? GROUPS.heroes.name : named.map(o => o.name).join(' and ');
    return `${who} felled ${boss}.`;
  };
  // A clear with no human in it is the Heroes' own record: never first, no bell.
  const heroesClear = (name, flag, idsOf) => wrap(name, function (orig, m, killer, ...a) {
    if (!this.named || this.named.humanIn(idsOf(m, a))) return orig.call(this, m, killer, ...a);
    const had = this[flag], onClear = this.onClear;
    this[flag] = true;
    this.onClear = rec => onClear?.({ ...rec, first: false, heroes: true });
    try { return orig.call(this, m, killer, ...a); } finally { this[flag] = had; this.onClear = onClear; }
  });
  heroesClear('recordClear', 'hadFirstClear', m => m.contributors);
  heroesClear('recordClear2', 'hadFirstClear2', (m, a) => a[0] || m.contributors);
  heroesClear('recordClear3', 'hadFirstClear3', (m, a) => a[0] || m.contributors);

  // Friendship sources.
  for (const [end, field] of [['endFight', 'fight'], ['endFight2', 'fight2'], ['endFight3', 'fight3']]) {
    wrap(end, function (orig, result, ...a) {
      const f = this[field], out = orig.call(this, result, ...a);
      if (this.named && f && !this[field]) this.named.onFightEnd(f, result);
      return out;
    });
  }
  wrap('completeRevive', function (orig, p, r) {
    const out = orig.call(this, p, r);
    if (this.named && r) this.named.onRevived(p, r);
    return out;
  });
  wrap('healPlayer', function (orig, tg, amount, by, sk) {
    const got = orig.call(this, tg, amount, by, sk);
    if (this.named && got > 0 && by?.id && tg && tg !== by) this.teamStat?.(by, 'healOther', got); // (boss help counts this, not self-healing)
    if (this.named && tg?.named && by && got > 0) this.named.onHealed(tg, by, got);
    return got;
  });
  wrap('damagePlayer', function (orig, p, base, opts) {
    if (!this.named || !p?.named || !p.cover) return orig.call(this, p, base, opts);
    const n = this.events.length, out = orig.call(this, p, base, opts);
    for (let i = n; i < this.events.length; i++) { const e = this.events[i]; if (e.t === 'covered' && e.w === p.id) this.named.onCovered(p, this.players.get(e.id)); }
    return out;
  });
  wrap('bleedOut', function (orig, p) {
    let mates = null;
    if (this.named && p?.named) mates = this.standingMates(p, RULES.downR).filter(h => isHuman(h) && h.reviving?.id !== p.id && p.downed?.by !== h.id);
    const out = orig.call(this, p);
    if (mates?.length) this.named.onBledOut(p, mates);
    return out;
  });

  // Invites by tier, the loner's raid invite, calls.
  wrap('invite', function (orig, p, targetId) {
    const N = this.named, t = this.players.get(targetId);
    if (N && t?.named && t !== p && !p.named && (p.bot || !N.onInvite(p, t))) return;
    return orig.call(this, p, targetId);
  });
  wrap('accept', function (orig, p, fromId) {
    const N = this.named, from = N && this.players.get(fromId);
    if (p?.named && isHuman(from) && p.invite?.from === fromId && !N.onInvite(from, p)) { p.invite = null; return; } // (things changed since the invite: the party filled up, they're busy)
    const out = orig.call(this, p, fromId);
    if (from?.named && isHuman(p) && p.party && p.party === from.party) N.onAccept(p, from);
    return out;
  });
  wrap('handle', function (orig, p, msg) {
    const N = this.named;
    if (N) {
      if (msg.type === 'named') return N.handle(p, msg);
      if (msg.type === 'test' && process.env.TEST_HOOKS && msg.friend && N.chars.has(msg.friend.id) && !p.bot) { // testing aid: { friend: { id, pts } } sets your friendship
        if (msg.friend.add) return void N.add(p, msg.friend.id, +msg.friend.add, String(msg.friend.why || 'fight')); // …or { id, add, why }: a gain through the rules
        Object.assign(N.recOf(p, msg.friend.id), { pts: Math.max(0, Math.min(100, +msg.friend.pts || 0)), abs: true });
        if (p.charId) N.dirtyFr.add(`${p.charId}:${msg.friend.id}`);
        return;
      }
      if (msg.type === 'decline' && p.invite) { const from = this.players.get(p.invite.from); if (from?.named) N.onDecline(p, from); }
    }
    return orig.call(this, p, msg);
  });
  // The raid gate: a Named not with a human never readies while a human is at that boss's gate or in its room (the
  // plan's once-a-second check could be a second late); the group turns back at once.
  wrap('toggleReady', function (orig, p, ...a) {
    const gate = p?.x > F3.split ? this.gate3 : p?.x > F2.split ? this.gate2 : this.gate;
    if (this.named && p?.named && !gate?.ready.has(p.id) && this.named.gateBlocked(p)) return;
    return orig.call(this, p, ...a);
  });
  // "/b <name>: come" (or follow) to a Named who isn't in your party: a Sworn friend's call.
  wrap('botCommand', function (orig, p, msg) {
    const N = this.named, cmd = String(msg?.cmd || '');
    if (N && msg?.name && isHuman(p) && (cmd === 'come' || cmd === 'follow')) {
      const lower = String(msg.name).toLowerCase(), party = this.partyOf(p);
      const mate = party?.members.some(id => id !== p.id && this.players.get(id)?.name.toLowerCase().startsWith(lower));
      const st = mate ? null : N.byName(msg.name);
      if (st) { N.call(p, st.def.id); return false; }
    }
    return orig.call(this, p, msg);
  });
}
