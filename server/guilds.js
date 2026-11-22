// Guilds (docs/briefs/guilds.md; data and pure rules in shared/guilds.js). Installed onto Game.prototype.
//   create / invite / accept / leave / kick / promote / demote / transfer / disband   { type: 'guild', op, ... }
//   bank      gold (anyone deposits, officers+ withdraw) and a vault of bag items. Every move happens in one step of the
//             single-threaded game loop (all or nothing in memory; vault slots are taken by their id `v`, so the second
//             of two players taking the same item finds it gone), then is written in one transaction (guild row + the
//             character's gold and bag), inside the character's save lock (server/accounts.js charLock).
//   members   keyed c:<charId> (players, saved), n:<namedId> (the Named, saved), s:<playerId> (bots and anonymous
//             players: this session only; they drop out when they leave the world)
//   chat      { type: 'chat', ch: 'g' } → { type: 'gchat' } to the guild's online players only
//   quests    3 a week from shared/guilds.js; members' kills, labyrinth keepers, floor bosses, Switches with a guildmate;
//             bots and the Named count GUILD.botRate. Rewards: guild XP and gold into the bank. Levels unlock perks.
//   tags      roster rows carry g (the tag); Hall of Clearers rows too (guildTagClear)
// Persistence: makeGuildStore(q, tx, charLock) (server/index.js calls game.useGuildStore); without one guilds live in
// memory. Testing aids: game.guildNow (ms clock) can be replaced; TEST_HOOKS=1 accepts { type: 'test', guildEv } (quest credit).
import {
  GUILD, RANK, RANKS, can, cleanGuildName, cleanGuildTag, guildLevel, nextLevelXp, perksAt, GUILD_PERKS,
  QUEST_BY_ID, drawQuests, questMatches, questReward, weekOf, weekStart,
} from '../shared/guilds.js';
import { BAG_SIZE } from '../shared/items.js';
import { KEEPERS } from '../shared/labyrinth.js';
import { floorOf } from '../shared/floor2.js';
import { canInvite, newFriendship } from '../shared/named.js';

class GErr extends Error {}
const fail = msg => { throw new GErr(msg); };
const cleanGold = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

// ---------- the store (Postgres) ----------
export function makeGuildStore(q, tx, charLock = (id, fn) => fn()) {
  const row = g => [g.id, g.name, g.tag, g.xp, g.gold, JSON.stringify(g.vault), g.vseq, JSON.stringify(g.quests), g.plot ? JSON.stringify(g.plot) : null, new Date(g.created)];
  const UPSERT = `INSERT INTO guilds (id, name, tag, xp, gold, vault, vseq, quests, plot, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    ON CONFLICT (id) DO UPDATE SET name = $2, tag = $3, xp = $4, gold = $5, vault = $6, vseq = $7, quests = $8, plot = $9, updated_at = now()`;
  const MEMBER = `INSERT INTO guild_members (member, guild_id, char_id, named_id, rank, name, cls, joined_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (member) DO UPDATE SET guild_id = $2, rank = $5, name = $6, cls = $7`;
  const mrow = (gid, m) => [m.key, gid, m.charId || null, m.named || null, m.rank, m.name, m.cls || null, new Date(m.joined)];
  return {
    loadAll: async () => ({
      guilds: await q('SELECT id, name, tag, xp, gold, vault, vseq, quests, plot, created_at FROM guilds ORDER BY id'),
      members: await q('SELECT member, guild_id, char_id, named_id, rank, name, cls, joined_at FROM guild_members ORDER BY joined_at'),
    }),
    saveGuild: g => q(UPSERT, row(g)),
    saveMember: (gid, m) => q(MEMBER, mrow(gid, m)),
    dropMember: key => q('DELETE FROM guild_members WHERE member = $1', [key]),
    deleteGuild: id => q('DELETE FROM guilds WHERE id = $1', [id]),
    // A new guild with its leader, or a bank move: the guild row (and members) with the character's gold and bag, in one
    // transaction, inside that character's save lock.
    bank: (g, p, members = []) => {
      const run = () => tx(async t => {
        await t(UPSERT, row(g));
        for (const m of members) await t(MEMBER, mrow(g.id, m));
        if (p?.charId) await t('UPDATE characters SET gold = $2, inv = $3, updated_at = now() WHERE id = $1', [p.charId, Math.max(0, p.gold | 0), JSON.stringify(p.inv)]);
      });
      return p?.charId ? charLock(p.charId, run) : run();
    },
  };
}

export const GuildMethods = {
  guildInit() {
    if (this.guilds) return;
    this.guilds = new Map(); this.guildIdx = new Map(); this.guildSeq = 1; this.guildQ = Promise.resolve(); this.guildStore = null;
  },
  guildNow() { return Date.now(); },
  // ---------- persistence ----------
  async useGuildStore(store) {
    this.guildInit();
    let rows;
    try { rows = await store.loadAll(); } catch (e) { console.error('[guilds] load failed, guilds stay in memory:', e.message); return; }
    this.guildStore = store;
    const { guilds, members } = rows;
    for (const r of guilds) {
      const g = { id: r.id, name: r.name, tag: r.tag, xp: r.xp | 0, gold: Number(r.gold) || 0, vault: Array.isArray(r.vault) ? r.vault : [], vseq: r.vseq | 0, quests: r.quests || null, plot: r.plot || null, created: new Date(r.created_at).getTime(), members: new Map() };
      this.guilds.set(g.id, g); this.guildSeq = Math.max(this.guildSeq, g.id + 1);
    }
    for (const r of members) {
      const g = this.guilds.get(r.guild_id);
      if (!g) continue;
      const m = { key: r.member, name: r.name, cls: r.cls, rank: r.rank | 0, joined: new Date(r.joined_at).getTime(), ...(r.char_id ? { charId: r.char_id } : {}), ...(r.named_id ? { named: r.named_id } : {}) };
      g.members.set(m.key, m); this.guildIdx.set(m.key, g.id);
    }
    for (const g of [...this.guilds.values()]) { // a leader's character was deleted: hand it on; nobody left: gone
      if (!g.members.size) { this.guildDelete(g); continue; }
      if (![...g.members.values()].some(m => m.rank === RANK.leader)) { const m = this.guildHeir(g); if (m) { m.rank = RANK.leader; this.guildWrite(s => s.saveMember(g.id, m)); } }
    }
  },
  guildWrite(fn) { // one queue for every guild write (newest state wins: each write reads memory when it runs)
    const s = this.guildStore;
    if (!s) return Promise.resolve();
    this.guildQ = this.guildQ.then(() => fn(s)).catch(e => console.error('[guilds] save failed:', e.message));
    return this.guildQ;
  },
  guildDirty(g) {
    if (!this.guildStore || g.saveT) return;
    g.saveT = setTimeout(() => { g.saveT = null; if (this.guilds.get(g.id) === g) this.guildWrite(s => s.saveGuild(g)); }, 3000);
    g.saveT.unref?.();
  },
  guildBankWrite(g, p, members) {
    if (!this.guildStore) return;
    if (p) p.dirty = true; // (the character's own save writes it too; the transaction makes the pair atomic)
    const s = this.guildStore;
    const go = () => s.bank(g, p?.charId ? p : null, members).catch(e => { console.error('[guilds] bank save failed:', e.message); this.guildDirty(g); });
    this.guildQ = this.guildQ.then(go);
  },
  async guildFlush() {
    for (const g of this.guilds?.values() || []) if (g.saveT) { clearTimeout(g.saveT); g.saveT = null; this.guildWrite(s => s.saveGuild(g)); }
    await this.guildQ;
  },

  // ---------- lookups ----------
  guildKey(p) { return p.named ? `n:${p.named}` : p.charId ? `c:${p.charId}` : `s:${p.id}`; },
  guildOf(p) { if (!p || !this.guilds) return null; const id = this.guildIdx.get(this.guildKey(p)); return id ? this.guilds.get(id) || null : null; },
  guildMember(p) { const g = this.guildOf(p); return g ? g.members.get(this.guildKey(p)) : null; },
  guildPlayerOf(m) { // the member's player in the world, or null
    if (m.key.startsWith('s:')) return this.players.get(+m.key.slice(2)) || null;
    for (const o of this.players.values()) if ((m.charId && o.charId === m.charId && !o.bot) || (m.named && o.named === m.named)) return o;
    return null;
  },
  guildOnline(g) { return [...g.members.values()].map(m => this.guildPlayerOf(m)).filter(Boolean); },
  guildTagOf(p) { return this.guildOf(p)?.tag || null; },
  guildNeedsChar() { return !!this.guildStore; }, // with a database a human needs a saved character
  guildLevelOf(g) { return guildLevel(g.xp); },
  guildVaultCap(g) { return perksAt(guildLevel(g.xp)).vault; },
  guildTell(g, text, except = 0) { for (const o of this.guildOnline(g)) if (!o.bot && o.id !== except) this.sys(text, o.id); },
  guildHuman(m) { return !!m.charId || (m.key.startsWith('s:') && !this.players.get(+m.key.slice(2))?.bot); },
  guildHeir(g) { // the next leader: a saved player (or any human without a database), highest rank, then the oldest
    const ok = m => this.guildHuman(m) && m.rank !== RANK.leader;
    return [...g.members.values()].filter(ok).sort((a, b) => b.rank - a.rank || a.joined - b.joined)[0] || null;
  },
  guildWeek(g) {
    const w = weekOf(this.guildNow());
    if (g.quests?.week !== w || !Array.isArray(g.quests?.list)) { g.quests = { week: w, list: drawQuests(g.id, w) }; this.guildDirty(g); }
    return g.quests;
  },

  // ---------- membership ----------
  guildAddMember(g, p, rank = RANK.member, write = true) {
    const key = this.guildKey(p);
    const m = { key, name: p.name, cls: p.cls, rank, joined: this.guildNow(), ...(p.charId && !p.bot ? { charId: p.charId } : {}), ...(p.named ? { named: p.named } : {}) };
    g.members.set(key, m); this.guildIdx.set(key, g.id);
    if (write && !key.startsWith('s:')) this.guildWrite(s => s.saveMember(g.id, m));
    this.rosterDirty = true;
    return m;
  },
  guildRemoveMember(g, key) {
    if (!g.members.delete(key)) return;
    this.guildIdx.delete(key);
    if (!key.startsWith('s:')) this.guildWrite(s => s.dropMember(key));
    this.rosterDirty = true;
    if (![...g.members.values()].some(m => this.guildHuman(m))) return void this.guildDelete(g, 'The guild has no players left and is no more.'); // only bots and the Named left
    if (![...g.members.values()].some(m => m.rank === RANK.leader)) {
      const h = this.guildHeir(g);
      if (!h) return void this.guildDelete(g, 'The guild has no one to lead it and is no more.');
      h.rank = RANK.leader;
      if (!h.key.startsWith('s:')) this.guildWrite(s => s.saveMember(g.id, h));
      this.guildTell(g, `${h.name} now leads [${g.tag}] ${g.name}.`);
    }
  },
  guildDelete(g, why = '') {
    if (why) this.guildTell(g, why);
    for (const key of g.members.keys()) this.guildIdx.delete(key);
    g.members.clear();
    if (g.saveT) { clearTimeout(g.saveT); g.saveT = null; }
    this.guilds.delete(g.id);
    this.guildWrite(s => s.deleteGuild(g.id));
    this.rosterDirty = true;
  },

  // ---------- actions (each returns a line for the player, or throws GErr with why not) ----------
  guildCreate(p, name, tag) {
    if (p.bot) fail('Bots can\'t found guilds.');
    if (this.guildNeedsChar() && !p.charId) fail('Sign in and play a saved character to found a guild.');
    if (this.guildOf(p)) fail('You are already in a guild. Leave it first.');
    const n = cleanGuildName(name); if (n.error) fail(n.error);
    const t = cleanGuildTag(tag); if (t.error) fail(t.error);
    for (const g of this.guilds.values()) {
      if (g.name.toLowerCase() === n.name.toLowerCase()) fail('That guild name is taken.');
      if (g.tag === t.tag) fail('That tag is taken.');
    }
    if (p.gold < GUILD.fee) fail(`Founding a guild costs ${GUILD.fee} gold (you have ${p.gold}).`);
    p.gold -= GUILD.fee; this.invChanged(p);
    const g = { id: this.guildSeq++, name: n.name, tag: t.tag, xp: 0, gold: 0, vault: [], vseq: 0, quests: null, plot: null, created: this.guildNow(), members: new Map() };
    this.guilds.set(g.id, g);
    this.guildWeek(g);
    const m = this.guildAddMember(g, p, RANK.leader, false);
    p.ginvite = null;
    this.guildBankWrite(g, p, m.charId ? [m] : []); // the guild, its leader and the fee in one transaction
    this.track(p, 'guild_create', { gid: g.id });
    return `You founded [${g.tag}] ${g.name}. Invite friends, bots and the Named from the Guild tab.`;
  },
  guildResolve(p, { name, pid, named } = {}) { // → { player } | { st } (one of the Named, maybe resting)
    const N = this.named;
    if (named) { const st = N?.chars.get(String(named)); if (!st) fail('Nobody by that name.'); return { st, player: N.playerOf(st) }; }
    const t = pid ? this.players.get(pid | 0) : this.findByName?.(String(name || '').slice(0, 24));
    if (t) return { player: t, st: t.named ? N?.chars.get(t.named) : null };
    const st = name && N?.byName(name);
    if (st) return { st, player: N.playerOf(st) };
    fail(name ? `Nobody called "${String(name).slice(0, 20)}" is here.` : 'Invite whom?');
  },
  guildInvite(p, who) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g) fail('You are not in a guild.');
    if (!can(me.rank, 'invite')) fail('Only officers and the leader can invite.');
    if (g.members.size >= GUILD.maxMembers) fail(`The guild is full (${GUILD.maxMembers}).`);
    const { player: t, st } = this.guildResolve(p, who);
    if (t === p) fail('You are already in it.');
    const N = this.named;
    if (st) { // one of the Named: the party-invite rules (who may invite them, friendship), then they answer by themselves
      const key = `n:${st.def.id}`;
      if (this.guildIdx.has(key)) fail(`${st.def.name} is already in a guild.`);
      const why = N.ctlBlock(p, st, 'guildInvite');
      if (why) fail(why);
      if (!canInvite(st.def, (N.peek(p, st.def.id) || newFriendship()).pts)) fail(`${st.def.name} doesn't know you well enough yet.`);
      this.guildBotAnswer(g, p, () => (N.playerOf(st) || { named: st.def.id, name: st.def.name, cls: st.def.cls, bot: true, id: 0 }), key);
      return `You invited ${st.def.name} to [${g.tag}].`;
    }
    if (this.guildOf(t)) fail(`${t.name} is already in a guild.`);
    if (t.bot) {
      const why = this.botControl?.(p, t, 'guildInvite');
      if (why) fail(why);
      this.guildBotAnswer(g, p, () => (this.players.get(t.id) === t ? t : null), `s:${t.id}`);
      return `You invited ${t.name} to [${g.tag}].`;
    }
    if (this.guildNeedsChar() && !t.charId) fail(`${t.name} isn't playing a saved character, so they can't join a guild.`);
    t.ginvite = { gid: g.id, from: p.id, at: this.time };
    this.events.push({ t: 'ginvite', to: t.id, gid: g.id, name: g.name, tag: g.tag, from: p.name });
    this.sys(`${p.name} invites you to the guild [${g.tag}] ${g.name}. Players → Guild to answer.`, t.id);
    return `You invited ${t.name} to [${g.tag}].`;
  },
  guildBotAnswer(g, p, getPlayer, key) { // a bot or one of the Named accepts after a moment, if nothing changed
    const [lo, hi] = GUILD.botAnswer;
    this.schedule(lo + Math.random() * (hi - lo), () => {
      const t = getPlayer();
      if (!t || this.guilds.get(g.id) !== g || this.guildIdx.has(key) || g.members.size >= GUILD.maxMembers) return;
      const inv = this.players.get(p.id) === p ? p : null;
      if (inv && !can(g.members.get(this.guildKey(inv))?.rank ?? -1, 'invite')) return; // (the inviter lost the rank or left)
      this.guildAddMember(g, t);
      this.guildTell(g, `${t.name} joined the guild.`);
    });
  },
  guildAccept(p, gid) {
    const inv = p.ginvite;
    if (!inv || (gid && inv.gid !== (gid | 0)) || this.time - inv.at > GUILD.inviteFor) { p.ginvite = null; fail('No guild invite to accept.'); }
    p.ginvite = null;
    const g = this.guilds.get(inv.gid);
    if (!g) fail('That guild is no more.');
    if (this.guildOf(p)) fail('You are already in a guild.');
    if (g.members.size >= GUILD.maxMembers) fail('That guild is full.');
    this.guildAddMember(g, p);
    this.guildTell(g, `${p.name} joined the guild.`, p.id);
    return `Welcome to [${g.tag}] ${g.name}.`;
  },
  guildDecline(p) {
    const inv = p.ginvite;
    if (!inv) fail('No guild invite.');
    p.ginvite = null;
    const from = this.players.get(inv.from);
    if (from) this.sys(`${p.name} declined the guild invite.`, from.id);
    return 'Invite declined.';
  },
  guildLeave(p) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g) fail('You are not in a guild.');
    if (me.rank === RANK.leader && g.members.size > 1) fail('Hand leadership to someone first (Transfer), or disband the guild.');
    if (me.rank === RANK.leader) return this.guildDisband(p);
    this.guildRemoveMember(g, me.key);
    this.guildTell(g, `${p.name} left the guild.`);
    return `You left [${g.tag}].`;
  },
  guildTarget(g, key) { const m = g.members.get(String(key || '')); if (!m) fail('No such member.'); return m; },
  guildKick(p, key) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g) fail('You are not in a guild.');
    const m = this.guildTarget(g, key);
    if (!can(me.rank, 'kick') || m.rank >= me.rank) fail('You can only remove members below your rank.');
    this.guildRemoveMember(g, m.key);
    const t = this.guildPlayerOf(m);
    if (t && !t.bot) this.sys(`You were removed from [${g.tag}] ${g.name}.`, t.id);
    this.guildTell(g, `${m.name} was removed from the guild by ${p.name}.`);
    return `${m.name} is out of the guild.`;
  },
  guildRank(p, key, up) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g) fail('You are not in a guild.');
    if (!can(me.rank, up ? 'promote' : 'demote')) fail('Only the leader can change ranks.');
    const m = this.guildTarget(g, key);
    if (m === me || m.rank === RANK.leader) fail('Use Transfer to hand on leadership.');
    if (up ? m.rank !== RANK.member : m.rank !== RANK.officer) fail(up ? `${m.name} is already an officer.` : `${m.name} is a member already.`);
    m.rank = up ? RANK.officer : RANK.member;
    if (!m.key.startsWith('s:')) this.guildWrite(s => s.saveMember(g.id, m));
    this.guildTell(g, `${m.name} is now ${up ? 'an Officer' : 'a Member'}.`);
    return '';
  },
  guildTransfer(p, key) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g) fail('You are not in a guild.');
    if (!can(me.rank, 'transfer')) fail('Only the leader can hand on leadership.');
    const m = this.guildTarget(g, key);
    if (m === me) fail('You lead it already.');
    const t = this.guildPlayerOf(m);
    if (m.named || (this.guildStore ? !m.charId : !t || t.bot)) fail('Only a player can lead a guild.');
    m.rank = RANK.leader; me.rank = RANK.officer;
    for (const x of [m, me]) if (!x.key.startsWith('s:')) this.guildWrite(s => s.saveMember(g.id, x));
    this.guildTell(g, `${m.name} now leads [${g.tag}] ${g.name}.`);
    this.rosterDirty = true;
    return '';
  },
  guildDisband(p) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g) fail('You are not in a guild.');
    if (!can(me.rank, 'disband')) fail('Only the leader can disband the guild.');
    if (g.vault.length) fail('Empty the vault first (take every item out).');
    const gold = g.gold;
    g.gold = 0;
    if (gold) { p.gold += gold; this.invChanged(p); }
    this.guildBankWrite(g, p); // (the leader's gold first, then the guild goes)
    this.guildTell(g, `[${g.tag}] ${g.name} has been disbanded.`, p.id);
    this.guildDelete(g);
    return `You disbanded [${g.tag}] ${g.name}.${gold ? ` The bank's ${gold} gold is yours.` : ''}`;
  },
  // Admin (server/admin.js): disband any guild; its bank and vault go with it.
  guildDisbandAdmin(id) {
    const g = this.guilds?.get(id | 0);
    if (!g) return false;
    this.guildDelete(g, `[${g.tag}] ${g.name} was disbanded by an admin.`);
    return true;
  },

  // ---------- the bank ----------
  guildDeposit(p, amount) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g || p.bot) fail('You are not in a guild.');
    if (!can(me.rank, 'deposit')) fail('You can\'t deposit.');
    const n = cleanGold(amount);
    if (!n) fail('Deposit how much?');
    if (n > p.gold) fail(`You have ${p.gold} gold.`);
    if (g.gold + n > GUILD.goldMax) fail('The bank can\'t hold that much.');
    p.gold -= n; g.gold += n;
    this.invChanged(p);
    this.guildBankWrite(g, p);
    return `Deposited ${n} gold. The bank holds ${g.gold}.`;
  },
  guildWithdraw(p, amount) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g || p.bot) fail('You are not in a guild.');
    if (!can(me.rank, 'withdraw')) fail('Only officers and the leader can withdraw.');
    const n = cleanGold(amount);
    if (!n) fail('Withdraw how much?');
    if (n > g.gold) fail(`The bank holds ${g.gold} gold.`);
    g.gold -= n; p.gold += n;
    this.invChanged(p);
    this.guildBankWrite(g, p);
    this.guildTell(g, `${p.name} withdrew ${n} gold from the bank.`, p.id);
    return `Withdrew ${n} gold.`;
  },
  guildStoreItem(p, u) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g || p.bot) fail('You are not in a guild.');
    if (!can(me.rank, 'store')) fail('You can\'t use the vault.');
    const i = p.inv.bag.findIndex(it => it.u === Number(u));
    if (i < 0) fail('That item isn\'t in your bag.');
    if (p.inv.bag[i].ks) fail('A keepsake stays with you.');
    if (g.vault.length >= this.guildVaultCap(g)) fail(`The vault is full (${this.guildVaultCap(g)} slots).`);
    const [it] = p.inv.bag.splice(i, 1);
    g.vault.push({ v: ++g.vseq, it, by: p.name });
    this.invChanged(p);
    this.guildBankWrite(g, p);
    return `${it.name} is in the vault.`;
  },
  guildTakeItem(p, v) {
    const g = this.guildOf(p), me = this.guildMember(p);
    if (!g || p.bot) fail('You are not in a guild.');
    if (!can(me.rank, 'take')) fail('Only officers and the leader can take from the vault.');
    const i = g.vault.findIndex(s => s.v === Number(v));
    if (i < 0) fail('That item is no longer in the vault.');
    if (p.inv.bag.length >= BAG_SIZE) fail('Your bag is full.');
    const [{ it }] = g.vault.splice(i, 1);
    if (p.inv.bag.some(o => o.u === it.u)) it.u = Math.max(...p.inv.bag.map(o => o.u | 0), it.u | 0) + 1; // (item ids are per bag: keep them apart)
    p.inv.bag.push(it);
    this.invChanged(p);
    this.guildBankWrite(g, p);
    this.guildTell(g, `${p.name} took ${it.name} from the vault.`, p.id);
    return `${it.name} is in your bag.`;
  },

  // ---------- chat ----------
  guildChat(p, text) {
    const g = this.guildOf(p);
    if (!g) return void this.sys('You are not in a guild.', p.id);
    const msg = JSON.stringify({ type: 'gchat', from: p.name, id: p.id, tag: g.tag, text });
    for (const o of this.guildOnline(g)) if (!o.bot && o.ws?.readyState === 1) o.ws.send(msg);
  },

  // ---------- quests ----------
  // A member did something (ev: { kind, mob, floor, rare }); a bot's or one of the Named's counts GUILD.botRate.
  guildCredit(p, ev, amount = 1) {
    const g = this.guildOf(p);
    if (!g) return;
    this.guildProgress(g, ev, amount * (p.bot ? GUILD.botRate : 1));
  },
  guildProgress(g, ev, amount) {
    const Q = this.guildWeek(g);
    let changed = false;
    for (const s of Q.list) {
      const q = QUEST_BY_ID[s.id];
      if (s.done || !questMatches(q, ev)) continue;
      s.got = Math.round((s.got + amount) * 100) / 100; changed = true;
      if (s.got >= q.n) {
        s.done = true;
        const lvl0 = guildLevel(g.xp), r = questReward(q, lvl0);
        g.xp += r.xp; g.gold = Math.min(GUILD.goldMax, g.gold + r.gold);
        this.guildTell(g, `Guild quest done: ${q.name}! +${r.xp} guild XP, +${r.gold} gold to the bank.`);
        const lvl = guildLevel(g.xp);
        if (lvl > lvl0) {
          const perks = GUILD_PERKS.filter(k => k.lvl > lvl0 && k.lvl <= lvl).map(k => k.text);
          this.guildTell(g, `[${g.tag}] reached guild level ${lvl}!${perks.length ? ` ${perks.join('; ')}.` : ''}`);
        }
      }
    }
    if (changed) this.guildDirty(g);
  },

  // ---------- views ----------
  guildView(p) {
    const g = this.guildOf(p), N = this.named;
    const inv = p.ginvite && this.time - p.ginvite.at <= GUILD.inviteFor ? this.guilds.get(p.ginvite.gid) : null;
    const base = { fee: GUILD.fee, needsChar: this.guildNeedsChar() && !p.charId, invite: inv ? { gid: inv.id, name: inv.name, tag: inv.tag, from: this.players.get(p.ginvite.from)?.name || '' } : null };
    if (!g) return { ...base, guild: null };
    const me = g.members.get(this.guildKey(p)), lvl = guildLevel(g.xp), Q = this.guildWeek(g);
    const members = [...g.members.values()].sort((a, b) => b.rank - a.rank || a.joined - b.joined).map(m => {
      const o = this.guildPlayerOf(m);
      return { key: m.key, name: m.name, cls: m.cls, rank: m.rank, kind: m.named ? 'named' : m.charId ? 'player' : o?.bot ? 'bot' : 'player', online: !!o, lvl: o?.lvl || 0, me: m === me };
    });
    // Who you could invite: online players and bots in no guild, and the Named (the Guild tab's picker)
    const cands = [];
    if (can(me.rank, 'invite')) {
      for (const o of this.players.values()) if (o !== p && !o.named && !this.guildOf(o) && (!o.bot || !this.botControl?.(p, o, 'guildInvite'))) cands.push({ pid: o.id, name: o.name, bot: o.bot ? 1 : 0 });
      for (const st of N?.chars.values() || []) if (!this.guildIdx.has(`n:${st.def.id}`) && !N.ctlBlock(p, st, 'guildInvite')) cands.push({ named: st.def.id, name: st.def.name });
    }
    return {
      ...base,
      guild: {
        id: g.id, name: g.name, tag: g.tag, lvl, xp: g.xp, next: nextLevelXp(lvl), gold: g.gold, rank: me.rank, rankName: RANKS[me.rank].name,
        perks: GUILD_PERKS.map(k => ({ lvl: k.lvl, text: k.text, on: lvl >= k.lvl })),
        vault: g.vault.map(s => ({ v: s.v, it: s.it, by: s.by })), vaultCap: this.guildVaultCap(g),
        members, cands: cands.slice(0, 60),
        quests: Q.list.map(s => { const q = QUEST_BY_ID[s.id]; return { id: s.id, name: q.name, desc: q.desc, got: Math.floor(s.got), n: q.n, done: s.done, ...questReward(q, lvl) }; }),
        resets: weekStart(Q.week + 1),
        plot: g.plot, // (Phase 5 floor towns: a guild hall plot; null for now)
      },
    };
  },
  guildsAdmin() {
    return [...(this.guilds?.values() || [])].map(g => ({
      id: g.id, name: g.name, tag: g.tag, lvl: guildLevel(g.xp), xp: g.xp, gold: g.gold, vault: g.vault.length, created: new Date(g.created).toISOString(),
      members: [...g.members.values()].sort((a, b) => b.rank - a.rank || a.joined - b.joined).map(m => ({ key: m.key, name: m.name, rank: RANKS[m.rank]?.name, kind: m.named ? 'named' : m.charId ? 'player' : 'session', online: !!this.guildPlayerOf(m) })),
    }));
  },
  // Hall of Clearers: each clearer's guild tag (rec.players: [{ name, cls, lvl }]).
  guildTagClear(rec) {
    if (!this.guilds?.size || !Array.isArray(rec?.players)) return rec;
    const byName = new Map([...this.players.values()].map(o => [o.name, o]));
    return { ...rec, players: rec.players.map(x => { const o = byName.get(x.name), tag = o && this.guildTagOf(o); return tag ? { ...x, g: tag } : x; }) };
  },

  // ---------- messages ----------
  guildHandle(p, msg) {
    const op = String(msg.op || '');
    let text = '', ok = true;
    try {
      switch (op) {
        case 'view': break;
        case 'create': text = this.guildCreate(p, msg.name, msg.tag); break;
        case 'invite': text = this.guildInvite(p, { name: msg.name, pid: msg.pid, named: msg.named }); break;
        case 'accept': text = this.guildAccept(p, msg.gid); break;
        case 'decline': text = this.guildDecline(p); break;
        case 'leave': text = this.guildLeave(p); break;
        case 'kick': text = this.guildKick(p, msg.key); break;
        case 'promote': text = this.guildRank(p, msg.key, true); break;
        case 'demote': text = this.guildRank(p, msg.key, false); break;
        case 'transfer': text = this.guildTransfer(p, msg.key); break;
        case 'disband': text = this.guildDisband(p); break;
        case 'deposit': text = this.guildDeposit(p, msg.gold); break;
        case 'withdraw': text = this.guildWithdraw(p, msg.gold); break;
        case 'store': text = this.guildStoreItem(p, msg.u); break;
        case 'take': text = this.guildTakeItem(p, msg.v); break;
        default: return;
      }
    } catch (e) {
      if (!(e instanceof GErr)) throw e;
      ok = false; text = e.message;
    }
    if (!p.bot && p.ws?.readyState === 1) p.ws.send(JSON.stringify({ type: 'guild', op, ok, ...(ok ? { msg: text } : { error: text }), view: this.guildView(p) }));
    return ok;
  },
};

export function installGuilds(Game) {
  const P = Game.prototype;
  Object.assign(P, GuildMethods);
  const wrap = (name, fn) => { const orig = P[name]; if (orig) P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('handle', function (orig, p, msg) {
    this.guildInit();
    if (msg?.type === 'guild') return this.guildHandle(p, msg);
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.guildEv) return void this.guildCredit(p, { kind: String(msg.guildEv.kind), mob: String(msg.guildEv.mob || ''), floor: msg.guildEv.floor | 0, rare: !!msg.guildEv.rare }, Math.min(1000, Math.max(0, +msg.guildEv.n || 1))); // testing aid: { guildEv: { kind, mob, floor, n } } counts toward guild quests
    if (msg?.type === 'chat') { // "/g text" or ch 'g': guild chat (only the guild's online players get it)
      let text = String(msg.text || '').slice(0, 200).trim();
      const m = text.match(/^\/(g|guild)\s+([\s\S]*)$/i);
      if (m || msg.ch === 'g') { text = (m ? m[2] : text).trim(); if (text) this.guildChat(p, text); return; }
    }
    return orig.call(this, p, msg);
  });
  wrap('roster', function (orig) {
    const rows = orig.call(this);
    if (!this.guilds?.size) return rows;
    return rows.map(r => { const tag = this.guildTagOf(this.players.get(r.id)); return tag ? { ...r, g: tag } : r; });
  });
  wrap('removePlayer', function (orig, p, ...a) {
    const out = orig.call(this, p, ...a);
    if (this.guilds) { // session members (bots, anonymous players) drop out with them
      const g = this.guildOf(p), key = `s:${p.id}`;
      if (g && g.members.has(key)) { this.guildRemoveMember(g, key); if (this.guilds.has(g.id)) this.guildTell(g, `${p.name} left the guild.`); }
    }
    return out;
  });
  // +XP when grouped with a guildmate (a perk from level 3)
  wrap('giveXp', function (orig, p, amount) {
    const g = p && !p.bot && this.guildOf(p);
    if (g && amount > 0) {
      const bonus = perksAt(guildLevel(g.xp)).xp, party = bonus && this.partyOf(p);
      if (party && party.members.some(id => id !== p.id && this.guildOf(this.players.get(id)) === g)) amount = Math.round(amount * (1 + bonus));
    }
    return orig.call(this, p, amount);
  });
  // Quest credit: kills (the killer), labyrinth keepers and floor bosses (each guild with a member in the fight, once)
  wrap('killMob', function (orig, m, killer) {
    const fought = m?.def?.boss || (m?.labF && KEEPERS[m.type]) ? [...m.contributors] : null;
    const out = orig.call(this, m, killer);
    if (!this.guilds?.size || !m.dead || !killer || m.def.duel) return out;
    this.guildCredit(killer, { kind: 'kill', mob: m.type, floor: floorOf(m.x), rare: !!(m.rare || m.def.rare) });
    if (fought && !m.temp) {
      const kind = m.def.boss ? 'boss' : 'lab', seen = new Map();
      for (const id of fought) { const o = this.players.get(id), g = o && this.guildOf(o); if (g) seen.set(g, seen.get(g) || !o.bot); }
      for (const [g, human] of seen) this.guildProgress(g, { kind }, human ? 1 : GUILD.botRate);
    }
    return out;
  });
  // A Switch with a guildmate in your party
  wrap('bumpStat', function (orig, p, k, n = 1) {
    const out = orig.call(this, p, k, n);
    if (k === 'switches' && this.guilds?.size) {
      const g = this.guildOf(p), party = g && this.partyOf(p);
      if (party && party.members.some(id => id !== p.id && this.guildOf(this.players.get(id)) === g)) this.guildCredit(p, { kind: 'switch' }, n);
    }
    return out;
  });
}

