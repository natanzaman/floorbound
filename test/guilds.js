// Guilds (docs/briefs/guilds.md; shared/guilds.js, server/guilds.js).
//   pure        name and tag rules, ranks and permissions, levels and perks, the weekly draw, quest matching
//   in process  create (fee, unique), invites (players, bots by the access rule, the Named), ranks, kick, transfer,
//               leave, disband, chat (members only), the bank and vault (no duplicates, two takers at once), quests
//               (members, the bot rate, bosses, Switches with a guildmate), levels and perks (vault, XP), roster and
//               Hall tags, session members dropping out, a fake store (what gets written)
//   server      with DATABASE_URL (a local database): a real server on PORT (default 3810): create over the wire,
//               deposits and withdrawals racing, the vault, quest progress, the admin API, and all of it after a restart.
// Usage: node test/guilds.js   (PORT=38xx DATABASE_URL=postgresql://postgres:pg@localhost/fb_guilds)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js';
import { NamedManager } from '../server/named.js';
import {
  GUILD, RANK, can, cleanGuildName, cleanGuildTag, guildLevel, perksAt, drawQuests, questMatches, QUEST_BY_ID, GUILD_QUESTS,
  weekOf, weekStart, nearRegistrar, REGISTRAR,
} from '../shared/guilds.js';
import { makeItem, keepsakeItem } from '../shared/items.js';
import { walkable } from '../shared/data.js';
import { SETS } from '../shared/loot.js';
import { makeGuildStore } from '../server/guilds.js';
import { charLock } from '../server/accounts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3810;
const DB_URL = process.env.DATABASE_URL || '';
const DB = /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(DB_URL) ? DB_URL : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });

// ---------- pure ----------
ok(cleanGuildName('Knights of Aincrad').name === 'Knights of Aincrad', 'a plain name is fine');
ok(cleanGuildName('ab').error && cleanGuildName('x'.repeat(21)).error, 'names: 3 to 20 characters');
ok(cleanGuildName('<b>Evil</b>').error && cleanGuildName('two  spaces').error && cleanGuildName(' -edge').error && cleanGuildName('Bad"Quote').error, 'names: no markup, double spaces or odd edges');
ok(cleanGuildName("Wolf's Den-2").name === "Wolf's Den-2", "names: ' and - inside");
ok(cleanGuildTag('kob').tag === 'KOB' && cleanGuildTag('A').error && cleanGuildTag('ABCDE').error && cleanGuildTag('A1').error && cleanGuildTag('<a>').error, 'tags: 2-4 letters, upper case');
ok(can(RANK.officer, 'invite') && !can(RANK.member, 'invite') && can(RANK.member, 'deposit') && !can(RANK.officer, 'disband') && can(RANK.leader, 'disband') && !can(RANK.leader, 'nonsense'), 'permissions by rank; an unknown action is nobody\'s');
ok(guildLevel(0) === 1 && guildLevel(100) === 2 && guildLevel(1e9) === 10, 'guild levels 1-10');
ok(perksAt(1).vault === GUILD.vault && perksAt(10).vault === GUILD.vaultMax && perksAt(3).xp === 0.05 && perksAt(10).xp === 0.1 && perksAt(2).xp === 0, 'perks add up by level (vault 20 → 40, XP 5% → 10%)');
{
  const a = drawQuests(7, 2900), b = drawQuests(7, 2900), c = drawQuests(8, 2900);
  ok(a.length === 3 && JSON.stringify(a) === JSON.stringify(b), 'three quests a week, the same draw for the same guild and week');
  ok(new Set(a.map(q => q.id)).size === 3 && new Set(a.map(q => QUEST_BY_ID[q.id].kind)).size === 3, 'three different quests, different kinds');
  ok(JSON.stringify(a) !== JSON.stringify(c) || JSON.stringify(a) !== JSON.stringify(drawQuests(7, 2901)), 'another guild or week draws differently');
}
ok(questMatches(QUEST_BY_ID.boars, { kind: 'kill', mob: 'boar', floor: 1 }) && !questMatches(QUEST_BY_ID.boars, { kind: 'kill', mob: 'wolf', floor: 1 }), 'kill quests match their mobs');
ok(questMatches(QUEST_BY_ID.mire, { kind: 'kill', mob: 'x', floor: 2 }) && !questMatches(QUEST_BY_ID.mire, { kind: 'kill', mob: 'x', floor: 1 }) && questMatches(QUEST_BY_ID.rare, { kind: 'kill', rare: true }) && !questMatches(QUEST_BY_ID.rare, { kind: 'kill' }), 'floor and rare quests');
ok(weekStart(weekOf(Date.UTC(2026, 10, 23, 0, 0, 1))) === Date.UTC(2026, 10, 23) && new Date(Date.UTC(2026, 10, 23)).getUTCDay() === 1, 'weeks start Monday 00:00 UTC');
ok(walkable(REGISTRAR.x, REGISTRAR.z) && nearRegistrar(REGISTRAR.x + 1, REGISTRAR.z), 'the Registrar stands on open ground in town');

// ---------- in process ----------
const fresh = () => { const g = new Game(); g.track = () => {}; return g; };
const sock = () => { const s = { readyState: 1, out: [], send(m) { s.out.push(JSON.parse(m)); } }; return s; };
const add = (g, name, extra = {}) => { const p = g.addPlayer(sock(), name, 'swordsman'); Object.assign(p, extra); p.gold = 1000; return p; };
const reply = p => p.ws.out.filter(m => m.type === 'guild').at(-1);
const act = (g, p, op, o = {}) => { g.handle(p, { type: 'guild', op, ...o }); return reply(p); };
const run = (g, secs) => { for (let i = 0; i < Math.round(secs * 20); i++) g.update(0.05); };
const sysTo = (g, p) => [...g.events, ...(p.pev || [])].filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text); // (pev: private lines, Game.priv)
{
  const g = fresh();
  const a = add(g, 'Ann'), b = add(g, 'Bo'), c = add(g, 'Cy');
  let r = act(g, a, 'create', { name: 'Knights', tag: 'kn' });
  ok(r.ok && r.view.guild?.tag === 'KN' && r.view.guild.rank === RANK.leader && a.gold === 1000 - GUILD.fee, `create: the fee is paid, the founder leads (${r.msg})`);
  ok(!act(g, b, 'create', { name: 'knights', tag: 'XY' }).ok && !act(g, b, 'create', { name: 'Other', tag: 'KN' }).ok, 'name and tag are unique (ignoring case)');
  const poor = add(g, 'Poor'); poor.gold = 10;
  ok(/costs/.test(act(g, poor, 'create', { name: 'Poor Guild', tag: 'PG' }).error) && poor.gold === 10, 'no guild without the fee');
  ok(!act(g, b, 'invite', { name: 'Cy' }).ok, 'someone outside the guild can\'t invite');
  r = act(g, a, 'invite', { name: 'Bo' });
  ok(r.ok && b.ginvite?.gid === r.view.guild.id && (b.pev || []).some(e => e.t === 'ginvite' && e.to === b.id && e.tag === 'KN') && !g.events.some(e => e.t === 'ginvite'), 'an invite waits on the player (a ginvite card)');
  ok(!act(g, c, 'accept', {}).ok, 'no invite: nothing to accept');
  r = act(g, b, 'accept', { gid: b.ginvite.gid });
  ok(r.ok && g.guildOf(b) === g.guildOf(a) && r.view.guild.rank === RANK.member, 'accepted: a Member');
  act(g, a, 'invite', { pid: c.id }); act(g, c, 'decline');
  ok(!g.guildOf(c) && !c.ginvite && sysTo(g, a).some(t => /declined/.test(t)), 'decline tells the inviter');
  ok(!act(g, b, 'invite', { pid: c.id }).ok, 'a Member can\'t invite');
  const keyB = g.guildKey(b);
  ok(act(g, a, 'promote', { key: keyB }).ok && g.guildMember(b).rank === RANK.officer, 'the leader promotes to Officer');
  ok(act(g, b, 'invite', { pid: c.id }).ok, 'an Officer can invite');
  act(g, c, 'accept'); ok(g.guildOf(c) === g.guildOf(a), 'Cy joined');
  ok(!act(g, b, 'kick', { key: g.guildKey(a) }).ok && g.guildOf(a), 'an Officer can\'t kick the leader');
  ok(!act(g, b, 'demote', { key: g.guildKey(c) }).ok, 'only the leader changes ranks');
  ok(act(g, b, 'kick', { key: g.guildKey(c) }).ok && !g.guildOf(c) && sysTo(g, c).some(t => /removed/.test(t)), 'an Officer kicks a Member');
  ok(!act(g, a, 'leave').ok && g.guildOf(a), 'the leader can\'t leave while others remain');
  // roster tags
  const row = g.roster().find(x => x.id === a.id);
  ok(row.g === 'KN' && !g.roster().find(x => x.id === c.id).g, 'roster rows carry the tag');
  // Hall tags
  const rec = g.guildTagClear({ floor: 1, players: [{ name: 'Ann', cls: 'swordsman', lvl: 5 }, { name: 'Cy', cls: 'swordsman', lvl: 5 }] });
  ok(rec.players[0].g === 'KN' && !rec.players[1].g, 'Hall rows show members\' tags');
  // chat: only members get it
  for (const p of [a, b, c]) p.ws.out.length = 0;
  g.handle(b, { type: 'chat', text: '/g hello <guild>' });
  ok(a.ws.out.some(m => m.type === 'gchat' && m.text === 'hello <guild>' && m.from === 'Bo') && b.ws.out.some(m => m.type === 'gchat') && !c.ws.out.some(m => m.type === 'gchat'), '/g reaches members only');
  ok(!g.events.some(e => e.t === 'chat' && /hello/.test(e.text)), 'guild chat never goes into the shared snapshot');
  g.handle(c, { type: 'chat', ch: 'g', text: 'me too' });
  ok(!a.ws.out.some(m => m.type === 'gchat' && m.text === 'me too'), 'a non-member\'s guild chat goes nowhere');
  // transfer + disband
  ok(!act(g, a, 'transfer', { key: 'c:999' }).ok, 'transfer: an unknown member');
  ok(act(g, a, 'transfer', { key: keyB }).ok && g.guildMember(b).rank === RANK.leader && g.guildMember(a).rank === RANK.officer, 'transfer: Bo leads, Ann is an Officer');
  ok(act(g, a, 'leave').ok && !g.guildOf(a), 'the old leader can leave now');
  ok(act(g, b, 'deposit', { gold: 100 }).ok, 'deposit before disbanding');
  const gold0 = b.gold;
  r = act(g, b, 'disband');
  ok(r.ok && !g.guildOf(b) && g.guilds.size === 0 && b.gold === gold0 + 100, 'disband: the bank\'s gold goes to the leader');
}

// ---------- bank and vault ----------
{
  const g = fresh();
  const a = add(g, 'Ann'), b = add(g, 'Bo'), m = add(g, 'Mo');
  act(g, a, 'create', { name: 'Vaulters', tag: 'VLT' });
  for (const p of [b, m]) { act(g, a, 'invite', { pid: p.id }); act(g, p, 'accept'); }
  act(g, a, 'promote', { key: g.guildKey(b) });
  const G = g.guildOf(a);
  ok(act(g, m, 'deposit', { gold: 250 }).ok && G.gold === 250 && m.gold === 750, 'a Member deposits');
  ok(!act(g, m, 'deposit', { gold: 5000 }).ok && !act(g, m, 'deposit', { gold: -5 }).ok && !act(g, m, 'deposit', { gold: 'x' }).ok && G.gold === 250, 'no deposits beyond your gold, negative or junk');
  ok(!act(g, m, 'withdraw', { gold: 10 }).ok && G.gold === 250, 'a Member can\'t withdraw');
  // two officers withdraw at once: the bank never goes below zero, gold is only moved
  const total0 = G.gold + a.gold + b.gold;
  const ra = act(g, a, 'withdraw', { gold: 200 }), rb = act(g, b, 'withdraw', { gold: 200 });
  ok(ra.ok !== rb.ok && G.gold === 50 && G.gold + a.gold + b.gold === total0, 'two withdrawals of 200 from 250: one goes through, nothing made or lost');
  // too many bank moves in a row
  const spam = add(g, 'Spam'); act(g, a, 'invite', { pid: spam.id }); act(g, spam, 'accept');
  let refused = 0; for (let i = 0; i < GUILD.bankOps + 5; i++) if (/Easy there/.test(act(g, spam, 'deposit', { gold: 1 }).error || '')) refused++;
  ok(refused === 5, `at most ${GUILD.bankOps} bank moves per 10 s per player`);
  run(g, 10.5); ok(act(g, spam, 'deposit', { gold: 1 }).ok, '…then it opens again');
  // the vault
  const it = makeItem('weapon', 2, 'swordsman'), it2 = makeItem('armor', 1, 'swordsman');
  m.inv.bag.push(it, it2);
  ok(act(g, m, 'store', { u: it.u }).ok && !m.inv.bag.includes(it) && G.vault.length === 1 && G.vault[0].it === it, 'store: the item leaves the bag and enters the vault');
  ok(!act(g, m, 'store', { u: it.u }).ok && G.vault.length === 1, 'storing it again: it isn\'t in your bag any more');
  const ks = keepsakeItem('Locket', 'charm', 'x');
  if (ks) { m.inv.bag.push(ks); ok(!act(g, m, 'store', { u: ks.u }).ok, 'a keepsake stays with you'); }
  ok(!act(g, m, 'take', { v: G.vault[0].v }).ok && G.vault.length === 1, 'a Member can\'t take from the vault');
  const v = G.vault[0].v;
  const t1 = act(g, a, 'take', { v }), t2 = act(g, b, 'take', { v });
  const copies = [a, b, m].reduce((s, p) => s + p.inv.bag.filter(x => x === it).length, 0) + G.vault.filter(s => s.it === it).length;
  ok(t1.ok && !t2.ok && /no longer/.test(t2.error) && copies === 1, 'two officers take the same item at once: the first gets it, exactly one copy exists');
  // full vault and full bag
  G.vault = Array.from({ length: g.guildVaultCap(G) }, (_, i) => ({ v: 1000 + i, it: makeItem('armor', 0, 'swordsman') }));
  ok(!act(g, m, 'store', { u: it2.u }).ok && m.inv.bag.includes(it2), 'a full vault refuses (the item stays in the bag)');
  while (b.inv.bag.length < 24) b.inv.bag.push(makeItem('armor', 0, 'swordsman'));
  ok(!act(g, b, 'take', { v: 1000 }).ok && G.vault.length === g.guildVaultCap(G), 'a full bag refuses (the item stays in the vault)');
  // the same item id in two bags
  b.inv.bag.length = 0; b.inv.bag.push({ ...makeItem('armor', 0, 'swordsman'), u: G.vault[0].it.u });
  act(g, b, 'take', { v: G.vault[0].v });
  ok(new Set(b.inv.bag.map(x => x.u)).size === b.inv.bag.length, 'an item taken out never shares an id with one in the bag');
  // disband needs an empty vault
  ok(/vault/.test(act(g, a, 'disband')?.error || act(g, b, 'disband')?.error || ''), 'disband waits for an empty vault');
}

// ---------- bots, the Named, session members ----------
{
  const g = fresh();
  const mgr = new BotManager(g, { url: () => 'ws://127.0.0.1:1/ws' }); // (no bots started: only its access rule is used)
  const a = add(g, 'Ann'), z = add(g, 'Zed');
  act(g, a, 'create', { name: 'Bot Friends', tag: 'BF' });
  const bot = add(g, 'Clank', { bot: true }), other = add(g, 'Gear', { bot: true });
  mgr.bots.push({ bid: 1, b: { id: bot.id, name: 'Clank' }, creator: { pid: a.id, name: 'Ann' }, allow: [] });
  mgr.bots.push({ bid: 2, b: { id: other.id, name: 'Gear' }, creator: { pid: z.id, name: 'Zed' }, allow: [{ id: 'creator', name: 'just the creator' }] });
  ok(act(g, a, 'invite', { pid: bot.id }).ok, 'invite your own bot');
  ok(/only takes orders/.test(act(g, a, 'invite', { pid: other.id }).error), 'someone else\'s "just me" bot: the access rule says no');
  run(g, 2.5);
  ok(g.guildOf(bot) && g.guildKey(bot) === `s:${bot.id}`, 'the bot accepts by itself, as a session member');
  // quest credit: a bot's kill counts botRate
  const G = g.guildOf(a);
  G.quests = { week: weekOf(Date.now()), list: [{ id: 'boars', got: 0, done: false }, { id: 'boss', got: 0, done: false }, { id: 'switch', got: 0, done: false }] };
  const boar = [...g.mobs.values()].find(m => m.type === 'boar');
  g.killMob(boar, bot); boar.dead = false; boar.hp = boar.maxHp;
  ok(G.quests.list[0].got === GUILD.botRate, `a bot's kill counts ${GUILD.botRate}`);
  g.killMob(boar, a); boar.dead = false; boar.hp = boar.maxHp;
  ok(G.quests.list[0].got === 1 + GUILD.botRate, 'a player\'s kill counts 1');
  const wolf = [...g.mobs.values()].find(m => m.type === 'wolf'); g.killMob(wolf, a);
  ok(G.quests.list[0].got === 1 + GUILD.botRate, 'a wolf doesn\'t count for the boar quest');
  // finishing a quest: guild XP and gold
  G.quests.list[0].got = QUEST_BY_ID.boars.n - 1; const xp0 = G.xp, gold0 = G.gold;
  g.killMob(boar, a);
  ok(G.quests.list[0].done && G.xp === xp0 + QUEST_BY_ID.boars.xp && G.gold === gold0 + QUEST_BY_ID.boars.gold && a.ws.out.some(m => m.type === 'gchat' && m.sys && /Guild quest done/.test(m.text)) && !g.events.some(e => /Guild quest done/.test(e.text || '')), 'a finished quest pays guild XP and gold into the bank (the notice goes to members only)');
  // a Switch with a guildmate in your party (the bot), not without
  g.bumpStat(a, 'switches');
  ok(G.quests.list[2].got === 0, 'a Switch with no guildmate in your party doesn\'t count');
  const party = { id: g.id(), members: [a.id, bot.id] }; g.parties.set(party.id, party); a.party = bot.party = party.id;
  g.bumpStat(a, 'switches');
  ok(G.quests.list[2].got === 1, 'a Switch with a guildmate in your party counts');
  // a boss with a member in the fight; bots alone count less
  const boss = g.boss; boss.contributors = new Set([bot.id]);
  g.killMob(boss, bot);
  ok(G.quests.list[1].got === GUILD.botRate, 'a boss beaten with only a guild bot in it counts the bot rate');
  // XP perk with a guildmate in the party
  G.xp = 300; // level 3: +5%
  const x0 = a.xp; a.lvl = 5; g.giveXp(a, 100);
  ok(a.xp - x0 === 105 || a.lvl > 5, `+5% XP with a guildmate in the party (got ${a.xp - x0})`);
  // the bot leaves the world: out of the guild
  g.removePlayer(bot);
  ok(!G.members.has(`s:${bot.id}`), 'a session member drops out when it leaves the world');
  // only bots left: the guild goes when its last player leaves
  const b2 = add(g, 'Clonk', { bot: true }); mgr.bots.push({ bid: 3, b: { id: b2.id, name: 'Clonk' }, creator: { pid: a.id, name: 'Ann' }, allow: [] });
  act(g, a, 'invite', { pid: b2.id }); run(g, 2.5);
  ok(g.guildOf(b2), 'another bot joins');
  G.vault = [];
  ok(act(g, a, 'leave').ok === false, 'the leader with a bot still in: transfer or disband');
  ok(act(g, a, 'disband').ok && !g.guildOf(b2) && !g.guilds.size, 'disband takes the bots out too');
  ok(g.roster().every(r => !r.g), 'no tags after disbanding');
}
{ // the Named
  const g = fresh();
  const mgr = new BotManager(g, { url: () => 'ws://127.0.0.1:1/ws' });
  const N = new NamedManager(g, mgr, { interval: 0 });
  const a = add(g, 'Ann');
  act(g, a, 'create', { name: 'Heroes Club', tag: 'HC' });
  const id = [...N.chars.keys()][0], st = N.chars.get(id);
  let r = act(g, a, 'invite', { named: id });
  ok(r.ok, `invite one of the Named by id, resting or not (${r.msg || r.error})`);
  run(g, 2.5);
  ok(g.guildOf(a).members.has(`n:${id}`) && g.guildOf(a).members.get(`n:${id}`).named === id, `${st.def.name} joined, kept by their Named id`);
  ok(!act(g, a, 'invite', { named: id }).ok, 'one guild at a time for them too');
  st.allow = [{ id: '424242', name: 'Someone' }];
  const id2 = [...N.chars.keys()][1]; N.chars.get(id2).allow = st.allow;
  ok(/only takes orders/.test(act(g, a, 'invite', { named: id2 }).error || ''), 'the Named\'s allow list applies (canControlBot)');
  ok(act(g, a, 'kick', { key: `n:${id}` }).ok && !g.guildOf(a).members.has(`n:${id}`), 'the leader can remove one of the Named');
  N.stop?.();
}
{ // a fake store: what gets written, and a database needs a saved character
  const g = fresh();
  const w = [];
  const store = { loadAll: async () => ({ guilds: [{ id: 5, name: 'Old Guard', tag: 'OG', xp: 120, gold: 40, vault: [], vseq: 0, quests: null, plot: null, created_at: new Date() }], members: [{ member: 'c:77', guild_id: 5, char_id: 77, named_id: null, rank: 1, name: 'Vet', cls: 'cleric', joined_at: new Date() }] }),
    saveGuild: async x => w.push(['guild', x.id]), saveMember: async (id, m) => w.push(['member', m.key]), dropMember: async k => w.push(['drop', k]), deleteGuild: async id => w.push(['delete', id]),
    bank: async (x, c, ms = []) => w.push(['bank', x.id, c?.id || 0, ms.map(m => m.key).join(',')]) };
  await g.useGuildStore(store);
  const OG = g.guilds.get(5);
  ok(OG && OG.members.get('c:77').rank === RANK.leader && g.guildSeq === 6, 'loading: a guild whose leader is gone gets one (the Officer); new ids follow the old');
  const anon = add(g, 'Anon');
  ok(/saved character/.test(act(g, anon, 'create', { name: 'Anon Guild', tag: 'AG' }).error), 'with a database, a guest without a saved character can\'t found one');
  const s = add(g, 'Saved', { charId: 9 });
  act(g, s, 'create', { name: 'Saved Guild', tag: 'SG' });
  await g.guildQ;
  ok(w.some(x => x[0] === 'bank' && x[1] === 6 && x[2] === 9 && x[3] === 'c:9'), 'founding writes the guild, its leader and the fee in one transaction');
  act(g, s, 'deposit', { gold: 10 }); await g.guildQ;
  ok(w.filter(x => x[0] === 'bank' && x[2] === 9).length === 2, 'a deposit is one bank transaction with the character');
  act(g, s, 'invite', { pid: anon.id });
  ok(!anon.ginvite, 'with a database, a guest without a saved character can\'t be invited');
}

{ // review fixes: a bank move is written from a snapshot taken at the move, in order with the character's own saves
  const g = fresh();
  const log = [];
  let hold; const gate = new Promise(r => { hold = r; });
  const fakeTx = async fn => { const stmts = []; await fn(async (t, v) => stmts.push([t.split(' ')[0], v])); log.push(['tx', stmts]); };
  const fakeQ = async (t, v) => { log.push(['q', t.split(' ')[0], v]); return []; };
  const store = makeGuildStore(fakeQ, fakeTx, charLock);
  store.loadAll = async () => ({ guilds: [], members: [] });
  await g.useGuildStore(store);
  const s = add(g, 'Saver', { charId: 4242 });
  act(g, s, 'create', { name: 'Snap Guild', tag: 'SNP' }); await g.guildQ;
  const G = g.guildOf(s);
  log.length = 0;
  // a character save asked for before the move (still waiting for its lock), the move, then more changes in memory
  const before = charLock(4242, async () => { await gate; log.push(['save-before']); });
  act(g, s, 'deposit', { gold: 100 });
  const goldAtMove = s.gold, bankAtMove = G.gold;
  s.gold += 5000; G.gold += 7000; // (changes after the move: a later write's business)
  const after = charLock(4242, async () => { log.push(['save-after']); });
  hold(); await before; await after; await g.guildQ;
  const i0 = log.findIndex(x => x[0] === 'save-before'), i1 = log.findIndex(x => x[0] === 'tx'), i2 = log.findIndex(x => x[0] === 'save-after');
  ok(i0 >= 0 && i0 < i1 && i1 < i2, `the move's transaction lands after a save asked before it and before one asked after it (${log.map(x => x[0]).join(' → ')})`);
  const tx = log[i1]?.[1] || [], up = tx.find(x => x[0] === 'UPDATE'), gr = tx.find(x => x[0] === 'INSERT');
  ok(up && up[1][1] === goldAtMove && gr && gr[1][4] === bankAtMove, `the transaction carries the values of the move (character ${up?.[1][1]} = ${goldAtMove}, bank ${gr?.[1][4]} = ${bankAtMove}), not later ones`);
  // a debounced guild save copies the row when it is queued
  log.length = 0; G.xp = 55; g.guildDirty(G); const p1 = g.guildFlush(); G.xp = 99; await p1;
  const gs = log.find(x => x[0] === 'q' && x[1] === 'INSERT');
  ok(gs && gs[2][3] === 55, 'a guild save writes the row as it was when queued');
  // a bank move takes over a pending debounced save (one row write, in order)
  log.length = 0; g.guildDirty(G); act(g, s, 'deposit', { gold: 1 }); await g.guildQ;
  ok(!G.saveT && log.filter(x => x[0] === 'tx').length === 1, 'a bank move carries the whole row: no debounced save left behind it');
}
{ // review fixes: no guild credit for fights that aren't real
  const g = fresh(); const a = add(g, 'Ann');
  act(g, a, 'create', { name: 'Fair Play', tag: 'FP' });
  const G = g.guildOf(a);
  G.quests = { week: weekOf(Date.now()), list: [{ id: 'boars', got: 0, done: false }, { id: 'boss', got: 0, done: false }, { id: 'lab', got: 0, done: false }] };
  const boar = [...g.mobs.values()].find(m => m.type === 'boar');
  for (const flag of ['trial', 'tough', 'temp', 'labTemp']) {
    boar[flag] = flag === 'trial' ? a.id : 1; boar.dead = false; boar.hp = boar.maxHp;
    g.killMob(boar, a); delete boar[flag];
  }
  ok(G.quests.list[0].got === 0, 'Academy trial and training enemies, summons and labyrinth risers earn no kill credit');
  boar.dead = false; boar.hp = boar.maxHp; g.killMob(boar, a);
  ok(G.quests.list[0].got === 1, '(a real boar still counts)');
}
{ // review fixes: a deleted character leaves its guild; loading applies the same rules; unknown quest ids
  const g = fresh();
  const store = { loadAll: async () => ({
    guilds: [
      { id: 1, name: 'Bots Only', tag: 'BO', xp: 0, gold: 0, vault: [], vseq: 0, quests: null, plot: null, created_at: new Date() },
      { id: 2, name: 'Old Quests', tag: 'OQ', xp: 0, gold: 0, vault: [], vseq: 0, quests: { week: weekOf(Date.now()), list: [{ id: 'gone-quest', got: 3, done: false }, { id: 'boars', got: 2, done: false }] }, plot: null, created_at: new Date() },
      { id: 3, name: 'Two Players', tag: 'TP', xp: 0, gold: 0, vault: [], vseq: 0, quests: null, plot: null, created_at: new Date() },
    ],
    members: [
      { member: 'n:kirito', guild_id: 1, char_id: null, named_id: 'kirito', rank: 2, name: 'Kirito', cls: 'swordsman', joined_at: new Date() },
      { member: 'c:21', guild_id: 2, char_id: 21, named_id: null, rank: 2, name: 'Q', cls: 'cleric', joined_at: new Date() },
      { member: 'c:31', guild_id: 3, char_id: 31, named_id: null, rank: 2, name: 'Lead', cls: 'cleric', joined_at: new Date(1000) },
      { member: 'c:32', guild_id: 3, char_id: 32, named_id: null, rank: 0, name: 'Second', cls: 'cleric', joined_at: new Date(2000) },
      { member: 'n:asuna', guild_id: 3, char_id: null, named_id: 'asuna', rank: 1, name: 'Asuna', cls: 'swordsman', joined_at: new Date(500) },
    ] }),
  saveGuild: async () => {}, saveMember: async () => {}, dropMember: async () => {}, deleteGuild: async () => {}, bank: async () => {} };
  await g.useGuildStore(store);
  ok(!g.guilds.has(1), 'loading: a guild with only the Named (no player) left is deleted, as at runtime');
  const q = add(g, 'Q', { charId: 21 });
  let v;
  try { v = g.guildView(q); } catch (e) { v = null; }
  ok(v?.guild?.quests.length === 1 && v.guild.quests[0].id === 'boars' && v.guild.quests[0].got === 2, 'a stored quest id the table no longer has is dropped (no crash in the view)');
  g.guildCharGone(31);
  const T = g.guilds.get(3);
  ok(T && !T.members.has('c:31') && T.members.get('c:32').rank === RANK.leader, 'a deleted leader\'s character: the next player leads (not one of the Named)');
  g.guildCharGone(32);
  ok(!g.guilds.has(3) && !g.guildIdx.has('n:asuna'), 'the last player\'s character deleted: the guild is no more');
}
{ // review nits: an item taken out never shares an id with worn gear; invites are throttled; the test hook keeps other fields
  const g = fresh(); const a = add(g, 'Ann');
  act(g, a, 'create', { name: 'Nit Pickers', tag: 'NP' });
  const G = g.guildOf(a), worn = { ...makeItem('armor', 0, 'swordsman'), u: 5555 }; a.inv.eq[worn.slot] = worn;
  if (worn) {
    G.vault.push({ v: ++G.vseq, it: { ...makeItem('armor', 0, 'swordsman'), u: worn.u }, by: 'x' });
    act(g, a, 'take', { v: G.vseq });
    const ids = [...a.inv.bag, ...Object.values(a.inv.eq).filter(Boolean)].map(x => x.u);
    ok(new Set(ids).size === ids.length, 'an item taken out never shares an id with gear you wear');
  } else ok(false, 'worn gear');
  let refused = 0; for (let i = 0; i < GUILD.inviteOps + 3; i++) if (/Easy there/.test(act(g, a, 'invite', { name: 'Nobody' }).error || '')) refused++;
  ok(refused === 3, `at most ${GUILD.inviteOps} invites per 10 s per player`);
  const hooks = process.env.TEST_HOOKS; process.env.TEST_HOOKS = '1';
  const gold0 = a.gold; g.handle(a, { type: 'test', guildEv: { kind: 'switch' }, gold: 7 });
  if (hooks === undefined) delete process.env.TEST_HOOKS; else process.env.TEST_HOOKS = hooks;
  ok(a.gold === gold0 + 7, 'the guildEv test hook doesn\'t swallow the message\'s other test fields');
  ok(/member of the guild in the fight/.test(QUEST_BY_ID.boss.desc), 'the boss quest says what counts (a member of the guild in the fight)');
}

// ---------- a real server (Postgres) ----------
if (DB) {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: DB });
  const sql = (t, p) => pool.query(t, p).then(r => r.rows);
  let srv = null, log = '';
  const start = async () => {
    log = '';
    srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, NAMED_ENABLED: '0', TEST_HOOKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
    const end = Date.now() + 20000;
    while (!/running on/.test(log)) { if (Date.now() > end) throw new Error(`server did not start:\n${log}`); await sleep(100); }
  };
  const stop = async () => { if (!srv) return; const done = new Promise(r => srv.on('exit', r)); srv.kill('SIGINT'); await done; srv = null; };
  const http = async (method, p, token, body) => { const r = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const client = (join) => new Promise((resolve, reject) => {
    const c = { last: {}, guild: [], gchat: [], inv: null };
    c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    c.ws.on('open', () => c.ws.send(JSON.stringify(join)));
    c.ws.on('message', raw => {
      const m = JSON.parse(raw.toString()); c.last[m.type] = m;
      if (m.type === 'welcome') { c.id = m.id; resolve(c); }
      if (m.type === 'guild') c.guild.push(m);
      if (m.type === 'gchat') c.gchat.push(m);
      if (m.type === 'inv') c.inv = m;
      if (m.type === 'denied') reject(new Error(m.reason));
    });
    c.send = o => c.ws.send(JSON.stringify(o));
    c.ask = async (o) => { const k = c.guild.length; c.send({ type: 'guild', ...o }); const end = Date.now() + 5000; while (c.guild.length <= k) { if (Date.now() > end) throw new Error(`no reply to ${o.op}`); await sleep(20); } return c.guild[k]; };
  });
  const until = async (fn, ms = 5000, what = '') => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); } throw new Error(`timed out: ${what}`); };
  try {
    await sql('DROP TABLE IF EXISTS guild_members'); await sql('DROP TABLE IF EXISTS guilds');
    await start();
    await stop(); await start(); // migrations run twice
    ok(true, 'migrations run twice');
    const tag = Math.random().toString(36).slice(2, 6);
    const tokA = (await http('POST', '/api/guest')).body.token, tokB = (await http('POST', '/api/guest')).body.token;
    const ca = (await http('POST', '/api/characters', tokA, { name: `Gla${tag}`, cls: 'swordsman' })).body.character;
    const cb = (await http('POST', '/api/characters', tokB, { name: `Glb${tag}`, cls: 'cleric' })).body.character;
    await sql('UPDATE characters SET gold = 2000 WHERE id = ANY($1)', [[ca.id, cb.id]]);
    let A = await client({ type: 'join', session: tokA, character: ca.id }), B = await client({ type: 'join', session: tokB, character: cb.id });
    let r = await A.ask({ op: 'create', name: `Guild ${tag}`, tag: 'TST' });
    ok(r.ok && r.view.guild.tag === 'TST', 'create over the wire');
    r = await A.ask({ op: 'invite', name: `Glb${tag}` });
    ok(r.ok, 'invite over the wire');
    r = await B.ask({ op: 'accept' });
    ok(r.ok && r.view.guild.name === `Guild ${tag}`, 'accept over the wire');
    await until(() => A.last.roster?.players.find(p => p.id === B.id)?.g === 'TST', 3000, 'roster tag');
    ok(true, 'the roster carries the tag');
    await B.ask({ op: 'view' });
    B.send({ type: 'chat', text: '/g hi guild' });
    await until(() => A.gchat.some(m => m.text === 'hi guild'), 3000, 'guild chat');
    ok(true, '/g chat arrives');
    await A.ask({ op: 'promote', key: `c:${cb.id}` });
    // deposits and withdrawals racing
    for (let i = 0; i < 10; i++) { A.send({ type: 'guild', op: 'deposit', gold: 50 }); B.send({ type: 'guild', op: 'deposit', gold: 30 }); }
    await until(() => A.guild.filter(m => m.op === 'deposit').length >= 10 && B.guild.filter(m => m.op === 'deposit').length >= 10, 5000, 'deposits');
    const bank0 = (await A.ask({ op: 'view' })).view.guild.gold;
    for (let i = 0; i < 10; i++) { A.send({ type: 'guild', op: 'withdraw', gold: 60 }); B.send({ type: 'guild', op: 'withdraw', gold: 60 }); }
    await until(() => A.guild.filter(m => m.op === 'withdraw').length >= 10 && B.guild.filter(m => m.op === 'withdraw').length >= 10, 5000, 'withdrawals');
    const okW = A.guild.concat(B.guild).filter(m => m.op === 'withdraw' && m.ok).length;
    r = await A.ask({ op: 'view' });
    ok(bank0 === 800 && okW === 13 && r.view.guild.gold === 800 - 13 * 60, `20 withdrawals of 60 from ${bank0} racing: ${okW} went through, the bank holds ${r.view.guild.gold}`);
    // the vault: buy a piece of gear, store it, two officers take it at once
    await until(() => A.inv, 3000, 'inventory');
    const n0 = A.inv.bag.length;
    A.send({ type: 'test', giveSet: Object.keys(SETS)[0] }); await until(() => A.inv.bag.length > n0, 3000, 'gear in the bag');
    const stored = A.inv.bag.at(-1);
    r = await A.ask({ op: 'store', u: stored.u });
    await until(() => !A.inv.bag.some(x => x.u === stored.u), 2000, 'left the bag');
    ok(r.ok && r.view.guild.vault.length === 1 && r.view.guild.vault[0].it.name === stored.name, 'store an item over the wire: it leaves the bag');
    const v = r.view.guild.vault[0].v;
    A.send({ type: 'guild', op: 'take', v }); B.send({ type: 'guild', op: 'take', v });
    await until(() => A.guild.some(m => m.op === 'take') && B.guild.some(m => m.op === 'take'), 3000, 'takes');
    const takes = [A, B].map(c => c.guild.filter(m => m.op === 'take').at(-1));
    ok(takes.filter(t => t.ok).length === 1, 'two takers of one vault item over the wire: exactly one gets it');
    const holder = takes[0].ok ? A : B;
    await until(() => holder.inv.bag.some(x => x.name === stored.name && x.st && JSON.stringify(x.st) === JSON.stringify(stored.st)), 2000, 'item in the taker\'s bag');
    r = await holder.ask({ op: 'store', u: holder.inv.bag.find(x => x.name === stored.name && JSON.stringify(x.st) === JSON.stringify(stored.st)).u });
    ok(r.ok && r.view.guild.vault.length === 1, 'stored back');
    // quest progress (the testing aid counts a kill toward this week's quests)
    const q0 = r.view.guild.quests.find(q => q.id !== 'boss' && q.id !== 'lab' && q.id !== 'switch') || r.view.guild.quests[0];
    const ev = { kill: { kind: 'kill', mob: 'boar', floor: 1 } };
    const QDEF = GUILD_QUESTS.find(q => q.id === q0.id);
    const evFor = q => q.kind === 'kill' ? { kind: 'kill', mob: q.mobs?.[0] || 'boar', floor: q.floor || 1, rare: !!q.rare } : { kind: q.kind };
    A.send({ type: 'test', guildEv: { ...evFor(QDEF), n: 1 } }); B.send({ type: 'test', guildEv: { ...evFor(QDEF), n: 1 } });
    await sleep(300);
    r = await A.ask({ op: 'view' });
    const got = r.view.guild.quests.find(q => q.id === q0.id).got;
    ok(got === 2 || (QDEF.n <= 2 && r.view.guild.quests.find(q => q.id === q0.id).done), `members' actions move a quest (${QDEF.name}: ${got})`);
    void ev;
    const gold1 = r.view.guild.gold;
    const gA = A.inv.gold, gB = B.inv.gold;
    // admin list
    const meA = await http('GET', '/api/admin/me', tokA);
    await sql('UPDATE accounts SET is_admin = true WHERE id = $1', [meA.body.account.id]);
    const list = await http('GET', '/api/admin/guilds', tokA);
    ok(list.status === 200 && list.body.guilds.some(x => x.tag === 'TST' && x.members.length === 2), 'the admin page lists guilds with members');
    ok((await http('GET', '/api/admin/guilds', tokB)).status === 403, 'non-admins get 403');
    A.ws.close(); B.ws.close();
    await sleep(500);
    await stop(); await start();
    A = await client({ type: 'join', session: tokA, character: ca.id });
    r = await A.ask({ op: 'view' });
    const G = r.view.guild;
    ok(G && G.tag === 'TST' && G.gold === gold1 && G.vault.length === 1 && G.vault[0].it.name === stored.name && G.members.length === 2 && G.members.find(m => m.key === `c:${cb.id}`).rank === RANK.officer, 'after a restart: the guild, its bank, vault, members and ranks are all there');
    await until(() => A.inv, 2000, 'inv');
    ok(A.inv.gold === gA, `the character's gold matches what the bank moves left (${A.inv.gold} = ${gA})`);
    ok(G.quests.find(q => q.id === q0.id).got === got, 'quest progress is still there');
    const inBags = (A.inv.bag.filter(x => x.name === stored.name && JSON.stringify(x.st) === JSON.stringify(stored.st)).length);
    ok(inBags === 0, 'the stored item is in the vault and not back in the bag');
    void gB;
    // B deletes their character: out of the guild at once (and in the database)
    ok((await http('DELETE', `/api/characters/${cb.id}`, tokB)).status === 200, 'B deletes their character');
    r = await A.ask({ op: 'view' });
    ok(r.view.guild.members.length === 1 && !r.view.guild.members.some(m => m.key === `c:${cb.id}`), 'a deleted character leaves its guild');
    ok(!(await sql('SELECT 1 FROM guild_members WHERE member = $1', [`c:${cb.id}`])).length, '(and its member row is gone)');
    const dbg = await http('DELETE', `/api/admin/guilds/${G.id}`, tokA);
    ok(dbg.status === 200, 'the admin disbands it');
    await until(async () => !(await sql('SELECT 1 FROM guilds WHERE id = $1', [G.id])).length, 3000, 'deleted');
    ok(!(await sql('SELECT 1 FROM guild_members WHERE guild_id = $1', [G.id])).length, 'its members go with it');
    A.ws.close();
  } catch (e) { failed++; console.log(`  NOT OK - ${e.message}\n${log.slice(-2000)}`); }
  await stop();
  await pool.end();
} else console.log('  (no local DATABASE_URL: skipping the server checks)');

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
