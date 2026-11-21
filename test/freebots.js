// Bots in the Players list, free bots, access levels and the Named's despawn / respawn (docs/briefs/bots-access.md).
//   in process  orders by name to a free bot, allow lists (party orders skip the bots you may not order), creator and
//               access 3+ overrides, plain invites to a bot gated the same way; the Named: list rows, invites with no
//               tier (INVITE_NEEDS_TIER = false), despawn / respawn by a player (permission, never a copy, back into
//               the party they left; that party gone: they roam), kick; several of the Named in one party (invite
//               two, one despawns and rejoins beside the other, the party limit: no rejoining a full party)
//   server      a real server on PORT (default 3741): a bot added without joining the party roams and farms; no
//               per-player cap; invite it from the list (it joins), kick it (it roams), /b orders to a free bot; the
//               list's Named rows: invite a Stranger's way, despawn and respawn (rejoins your party)
//   DATABASE_URL  also: the access_level migration (default 1, runs twice), the admin sets a level (live), an allow
//               list set by the admin refuses others until their access level is 3, and a despawned Named stays
//               despawned after a restart
// Usage: node test/freebots.js   (PORT=37xx DATABASE_URL=postgresql://postgres:pg@localhost/fb_bots)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js';
import { PlayerBots } from '../server/playerbots.js';
import { NamedManager } from '../server/named.js';
import { CLASS_IDS } from '../shared/data.js';
import { INVITE_NEEDS_TIER } from '../shared/named.js';

const PORT = Number(process.env.PORT) || 3741;
const DB = process.env.DATABASE_URL || '';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------------- in process ----------------
if (DB) await (await import('../server/db.js')).migrate(); // (the allow-list checks below read characters: on a brand-new database the tables come first)
{
  const g = new Game();
  g.track = () => {};
  const mgr = new BotManager(g, { url: 'ws://127.0.0.1:9/ws' });
  clearInterval(mgr.timer);
  mgr.start = function (roles, names, { lvl, behaviour, follow, join }) { // a bot with no socket (as test/named.js)
    this.joining = true; this.joiningNamed = !!join?.named;
    let p;
    try { p = g.addPlayer({ readyState: 1, send() {} }, names[0], roles[0]); } finally { this.joining = false; this.joiningNamed = false; }
    p.bot = true; p.lvl = lvl || 1; g.recompute(p); p.hp = p.maxHp;
    if (join?.named) this.namedJoin?.(p, join.named);
    const e = { bid: this.nextBid++, behaviour, follow, lvl, at: Date.now(), creator: null, allow: [], b: { id: p.id, name: p.name, cls: p.cls, closed: false, goal: '', cmd: null, t: 0, skill: 4, configure(o) { this.cfg = o; } } };
    e.group = { configure: o => { e.b.cfg = o; }, drop: b => { b.closed = true; g.removePlayer(p); } };
    this.bots.push(e);
    return [{ bid: e.bid }];
  };
  const pb = new PlayerBots(g, mgr);
  clearInterval(pb.timer);
  const clock = { t: Date.UTC(2026, 10, 20, 12) };
  const nm = new NamedManager(g, mgr, { interval: 0, now: () => clock.t, always: true });
  const human = (name, extra = {}) => { const sent = []; const p = g.addPlayer({ readyState: 1, send: s => sent.push(JSON.parse(s)) }, name, 'swordsman'); p.lvl = 10; g.recompute(p); p.sent = sent; Object.assign(p, extra); return p; };
  const sys = p => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);
  const cmds = () => g.events.filter(e => e.t === 'botcmd');
  const reply = p => p.sent.filter(m => m.type === 'pbot').at(-1);
  const tick = (k = 1) => { for (let i = 0; i < k; i++) { clock.t += 1000; nm.tick(); pb.upkeep(); } };

  const ann = human('Ann', { charId: 0 }), bob = human('Bob', { charId: 21 }), cy = human('Cy', { charId: 22 }); // (Ann anonymous; Bob and Cy saved characters)
  const AL = (...ps) => ps.map(p => ({ id: String(p.charId), name: p.name })); // an allow list (resolved: character ids)
  tick(2);
  // Ann adds a free bot and a partied one
  pb.add(ann, { cls: 'guardian', name: 'Rook', party: false });
  pb.add(ann, { cls: 'cleric', name: 'Lyra' });
  tick(1);
  const rook = [...g.players.values()].find(p => p.name === 'Rook'), lyra = [...g.players.values()].find(p => p.name === 'Lyra');
  const eRook = mgr.entryOf(rook), eLyra = mgr.entryOf(lyra);
  ok(eRook.creator?.pid === ann.id && eRook.creator.name === 'Ann' && eRook.allow.length === 0, 'a bot records its creator (and an empty allow list)');
  ok(!rook.party && lyra.party && lyra.party === ann.party && eRook.behaviour === 'field', 'unticked: Rook roams and farms; ticked: Lyra joins Ann\'s party');

  // orders by name to a free bot
  g.events = [];
  ok(g.botCommand(bob, { cmd: 'stay', name: 'rook' }) === 'Rook' && cmds()[0]?.free === 1 && cmds()[0].name === 'Rook', 'anyone (empty allow list) orders a free bot by name: the event carries free');
  eRook.allow = AL(cy);
  g.events = [];
  ok(g.botCommand(bob, { cmd: 'stay', name: 'Rook' }) === false && !cmds().length && /only takes orders/.test(sys(bob).join()), 'with an allow list, Bob is refused');
  g.events = [];
  ok(g.botCommand(cy, { cmd: 'stay', name: 'Rook' }) === 'Rook' && g.botCommand(ann, { cmd: 'follow', name: 'Rook' }) === 'Rook', 'Cy (listed) and Ann (its creator) may');
  const fakeCy = human('Cy'), num = human('22'); // an anonymous "Cy", and a player named after Cy's character id
  g.events = [];
  ok(g.botCommand(fakeCy, { cmd: 'stay', name: 'Rook' }) === false && g.botCommand(num, { cmd: 'stay', name: 'Rook' }) === false, 'an anonymous player named "Cy", or one named "22", does not pass Cy\'s entry');
  g.removePlayer(fakeCy); g.removePlayer(num);
  bob.access = 3; g.events = [];
  ok(g.botCommand(bob, { cmd: 'stay', name: 'Rook' }) === 'Rook', 'access 3 overrides the list');
  bob.access = 1;
  g.events = [];
  ok(g.botCommand(bob, { cmd: 'stay', name: 'Lyra' }) === false && /no free bot/.test(sys(bob).join()), 'a bot in a human\'s party is not free: no orders from outside');
  ok(g.botCommand(bob, { cmd: 'stay' }) === false && /Invite some bots/.test(sys(bob).join()), 'no party and no name: told how');
  // party orders skip the bots you may not order
  g.invite(ann, bob.id); g.accept(bob, ann.id);
  eLyra.allow = AL(cy);
  g.events = [];
  ok(g.botCommand(bob, { cmd: 'follow' }) === false && /only takes orders/.test(sys(bob).join()), 'Bob\'s party order: Lyra (allow: Cy) is his only bot, so it\'s refused');
  pb.add(ann, { cls: 'ranger', name: 'Tamsin' }); tick(1);
  const tam = [...g.players.values()].find(p => p.name === 'Tamsin');
  g.events = [];
  ok(tam.party === ann.party && g.botCommand(bob, { cmd: 'follow' }) === true && JSON.stringify(cmds()[0].no) === JSON.stringify([lyra.id]), 'with Tamsin too: the order goes, skipping Lyra (no: [Lyra])');
  // a plain invite to a bot: the same rule
  eRook.allow = AL(bob);
  g.events = []; g.invite(cy, rook.id);
  ok(!rook.invite && /only takes orders/.test(sys(cy).join()), 'a plain party invite to an allow-listed bot is refused too');
  eRook.allow = [];

  // the list: invite from it, kick
  pb.invite(cy, { bid: eRook.bid }, false);
  ok(rook.party && rook.party === cy.party && !pb.owned.get(eRook.bid).partied, 'Cy invites Rook from the list: it joins her party (still Ann\'s bot, not following her)');
  ok(ann.sent.length >= 0 && sys(ann).some(t => /invited your bot Rook/.test(t)), 'Ann is told');
  pb.kick(cy, { bid: eRook.bid }, false); tick(1);
  ok(!rook.party && eRook.behaviour === 'field' && pb.owned.get(eRook.bid).mode === 'field', 'Cy kicks it: it roams and farms');
  let threw = ''; try { pb.kick(cy, { bid: eRook.bid }, false); } catch (e) { threw = e.message; }
  ok(/isn't in your party/.test(threw), 'kicking a bot not in your party: refused');
  pb.invite(ann, { bid: eRook.bid }, false);
  ok(rook.party === ann.party && pb.owned.get(eRook.bid).partied && pb.owned.get(eRook.bid).mode === 'follow', 'Ann invites it back: it serves her party again');
  // /b leave: it roams (not dismissed)
  g.leaveParty(tam); tick(1);
  ok(pb.owned.has(mgr.entryOf(tam).bid) && !tam.party && pb.owned.get(mgr.entryOf(tam).bid).mode === 'field' && /roams on its own/.test(sys(ann).join()), 'a bot that leaves its creator\'s party roams on (still listed, farming)');

  // the Named
  ok(INVITE_NEEDS_TIER === false, 'INVITE_NEEDS_TIER is off');
  const L = pb.list(cy);
  const cairnRow = L.named.find(r => r.id === 'cairn');
  ok(L.named.length === 5 && cairnRow.state === 'online' && cairnRow.ctl.invite.ok && cairnRow.ctl.despawn.ok && !cairnRow.ctl.respawn.ok && /Roaming/.test(cairnRow.where), 'the list has the five Named: Cairn roams, a Stranger may invite or despawn him');
  ok(L.named.find(r => r.id === 'halvard').where === 'With The Hearthward', 'the Hearthward: with their party');
  g.leaveParty(cy);
  pb.namedOp(cy, 'invite', 'cairn', false);
  const cairn = () => nm.playerOf(nm.chars.get('cairn'));
  ok(cairn().invite?.from === cy.id, 'a Stranger invites Cairn from the list (no tier needed)');
  g.accept(cairn(), cy.id); tick(1);
  ok(cairn().party && cairn().party === cy.party, 'he joins Cy\'s party');
  ok(/in Cy's party/.test(nm.despawnBy(bob, 'cairn')) && !pb.list(bob).named.find(r => r.id === 'cairn').ctl.despawn.ok, 'Bob may not despawn him out of Cy\'s party (no griefing)');
  ok(nm.othersParty({ ...bob, access: 3 }, cairn()) === '', '...access 3+ may');
  nm.chars.get('cairn').allow = AL(bob);
  ok(/only takes orders/.test(nm.despawnBy(cy, 'cairn')), 'his allow list (Bob): Cy may not despawn him');
  nm.chars.get('cairn').allow = [];
  const party = cy.party;
  ok(nm.despawnBy(cy, 'cairn') === '' && !cairn() && !nm.chars.get('cairn').enabled && nm.chars.get('cairn').rejoin?.host === cy.id && !g.parties.get(party), 'Cy despawns him: out of the world, remembering her party');
  tick(2);
  ok(!cairn() && pb.list(cy).named.find(r => r.id === 'cairn').state === 'despawned', 'he stays out (the list says despawned)');
  ok(/already out/.test(nm.despawnBy(cy, 'cairn')), 'no despawning twice');
  ok(nm.respawnBy(cy, 'cairn') === '' && /already in the world/.test(nm.respawnBy(cy, 'cairn')), 'Cy respawns him; a second respawn (a copy) is refused');
  tick(2);
  ok(cairn() && cairn().party && cairn().party === cy.party && [...g.players.values()].filter(p => p.named === 'cairn').length === 1, 'back, he is in a party with Cy again (theirs broke up when he left: a new one with her; one Cairn only)');
  // in a party of three it survives his leaving: back into that very party
  g.invite(cy, ann.id); g.accept(ann, cy.id);
  const p3 = cy.party;
  nm.despawnBy(cy, 'cairn'); tick(1);
  ok(g.parties.get(p3) && nm.chars.get('cairn').rejoin?.party === p3, 'Cy, Ann and Cairn: he leaves, the party stays');
  nm.respawnBy(ann, 'cairn'); tick(3);
  ok(cairn()?.party === p3, 'Ann respawns him: back in that same party');
  // that party gone and Cy in another: he roams
  nm.despawnBy(cy, 'cairn');
  for (const id of [...(g.parties.get(p3)?.members || [])]) g.leaveParty(g.players.get(id)); // (everyone, Ann's bots too)
  g.leaveParty(bob); g.invite(bob, cy.id); g.accept(cy, bob.id);
  ok(!g.parties.get(p3) && cy.party, 'the party is gone, Cy is in Bob\'s');
  nm.respawnBy(cy, 'cairn'); tick(3);
  ok(cairn() && !cairn().party, 'respawned with that party gone: he roams as before');
  g.leaveParty(cy);
  // kick a Named
  g.invite(cy, cairn().id); g.accept(cairn(), cy.id); tick(1);
  pb.namedOp(cy, 'kick', 'cairn', false); tick(1);
  ok(!cairn().party, 'kick him from the party: back on his own');

  // several of the Named in one party (owner 2026-11-21), within the party limit
  const hal = () => nm.playerOf(nm.chars.get('halvard')), NP = id => nm.playerOf(nm.chars.get(id));
  const opWhy = (op, id) => { try { pb.namedOp(cy, op, id, false); return ''; } catch (e) { return e.message; } };
  opWhy('invite', 'cairn'); g.accept(cairn(), cy.id);
  opWhy('invite', 'halvard'); g.accept(hal(), cy.id); tick(1);
  const pc = cy.party;
  ok(pc && cairn().party === pc && hal().party === pc && g.partyOf(cy).members.length === 3, 'Cy invites Cairn and Halvard from the list: both in her party');
  ok(pb.list(cy).named.find(r => r.id === 'maribel').ctl.invite.ok, 'the list still offers a third');
  nm.despawnBy(cy, 'halvard'); tick(1);
  ok(!hal() && g.parties.get(pc) && cairn().party === pc && nm.chars.get('halvard').rejoin?.party === pc, 'Halvard despawns: Cairn and the party stay');
  nm.respawnBy(cy, 'halvard'); tick(3);
  ok(hal()?.party === pc && cairn().party === pc && [...g.players.values()].filter(p => p.named === 'halvard').length === 1, 'respawned, Halvard rejoins beside Cairn (one of him only)');
  opWhy('invite', 'maribel'); g.accept(NP('maribel'), cy.id); opWhy('invite', 'tovin'); g.accept(NP('tovin'), cy.id);
  g.leaveParty(bob); g.invite(cy, bob.id); g.accept(bob, cy.id); tick(1);
  ok(g.partyOf(cy)?.members.length === 6 && g.partyOf(cy).members.filter(id => g.players.get(id)?.named).length === 4, 'Cy, Bob and four of the Named: a full party');
  ok(/full/.test(pb.list(cy).named.find(r => r.id === 'sennet').ctl.invite.why || '') && /full/.test(opWhy('invite', 'sennet')) && NP('sennet').party !== pc, 'a fifth: the party is full (list and invite)');
  nm.despawnBy(cy, 'tovin'); tick(1);
  const dee = human('Dee'); g.invite(cy, dee.id); g.accept(dee, cy.id);
  ok(g.partyOf(cy).members.length === 6 && !NP('tovin'), 'Tovin despawned, Dee takes his place: six again');
  nm.respawnBy(cy, 'tovin'); tick(3);
  ok(NP('tovin') && NP('tovin').party !== pc && g.partyOf(cy).members.length === 6, 'respawned into a full party: Tovin doesn\'t rejoin it (back with the Hearthward)');
  for (const id of [...(g.parties.get(pc)?.members || [])]) g.leaveParty(g.players.get(id));
  g.removePlayer(dee); tick(2);
  ok(!cy.party && !cairn().party && ['halvard', 'maribel', 'tovin', 'sennet'].every(id => NP(id).party && NP(id).party === hal().party), 'the party breaks up: Cairn alone, the Hearthward together again');

  // kick: never out of a boss fight
  const { inArena } = await import('../shared/data.js');
  let az = 0; for (let z = 120; z < 300 && !az; z++) if (inArena(0, z)) az = z;
  g.invite(cy, rook.id); g.accept(rook, cy.id);
  const keep = [rook.x, rook.z]; rook.x = 0; rook.z = az; g.activeFightOf = p => (p === rook ? { ids: new Set([rook.id]) } : null);
  threw = ''; try { pb.kick(cy, { bid: eRook.bid }, false); } catch (e) { threw = e.message; }
  ok(az && /boss fight/.test(threw) && rook.party === cy.party, 'kick in a boss fight: refused');
  delete g.activeFightOf; [rook.x, rook.z] = keep;

  // the allow list from the Players list: creator (or access 3+) only
  threw = ''; try { await pb.allow(bob, { bid: eRook.bid, set: 'me' }, false); } catch (e) { threw = e.message; }
  ok(/Only its creator/.test(threw), 'Bob can\'t change who may control Ann\'s bot');
  let out = await pb.allow(ann, { bid: eRook.bid, set: 'me' }, false);
  ok(/only you/.test(out.msg) && eRook.allow.length === 1 && eRook.allow[0].id === 'creator' && /only takes orders/.test(mgr.controlBlock(cy, eRook, 'botKick')) && !mgr.controlBlock(ann, eRook, 'botKick'), '"Just me": Cy may no longer kick it, Ann still can');
  threw = ''; try { await pb.allow(ann, { bid: eRook.bid, add: 'Cy' }, false); } catch (e) { threw = e.message; }
  ok(/no accounts|No saved character/.test(threw), `adding a name needs a saved character ("${threw}")`);
  out = await pb.allow(ann, { bid: eRook.bid, set: 'open' }, false);
  ok(eRook.allow.length === 0 && /anyone/.test(out.msg), '"Anyone" opens it again');
  // the slim rows for the Players tab
  const R = pb.rows(ann);
  const rr = R.bots.find(b => b.bid === eRook.bid);
  ok(rr && rr.canAllow && rr.allow === 'anyone' && !('kit' in rr) && !('loadout' in rr) && R.named.length === 5 && !('canAllow' in pb.rows(cy).bots.find(b => b.bid === eRook.bid)), 'rows: only what a row shows (no kit), the allow controls for the creator only');

  // the creator leaves: a bot lent to someone's party stays until it's free, then goes
  pb.grace = 0;
  g.removePlayer(ann); tick(1);
  ok(pb.owned.has(eRook.bid) && rook.party === cy.party, 'Ann leaves: Rook, in Cy\'s party, stays');
  g.leaveParty(rook); tick(1);
  ok(!pb.owned.has(eRook.bid), 'free again: it goes');
  // an admin bot edit on a Named entry sets their own list: it survives a despawn / respawn
  const ce = mgr.entryOf(nm.playerOf(nm.chars.get('cairn')));
  mgr.edit(ce.bid, { allow: AL(bob) });
  nm.despawnBy(bob, 'cairn'); nm.respawnBy(bob, 'cairn'); tick(3);
  const ce2 = mgr.entryOf(nm.playerOf(nm.chars.get('cairn')));
  ok(ce2 && ce2 !== ce && ce2.allow[0]?.id === '21' && nm.chars.get('cairn').allow[0]?.id === '21', 'admin edit of a Named\'s allow list is theirs: kept across a respawn');
  for (const t of [pb.timer, mgr.timer]) clearInterval(t);
}

// ---------------- a real server ----------------
function client(name, cls = 'swordsman', join = {}) {
  const c = { name, pl: new Map(), roster: [], sys: [], replies: [], seq: 0, msgs: [] };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'join', name, cls, ...join })));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'welcome') Object.assign(c, { id: m.id });
    if (m.type === 'roster') c.roster = m.players;
    if (m.type === 'pbot') c.replies.push(m);
    if (m.type === 'snap') {
      c.pl = new Map(m.w.players.map(p => [p[0], { x: p[1], z: p[2], lvl: p[6], cls: CLASS_IDS[p[7]], party: p[8], dead: !!p[9] }]));
      for (const e of m.w.events) if (e.t === 'sys' && (!e.to || e.to === c.id)) c.sys.push(e.text);
    }
  });
  c.send = o => c.ws.send(JSON.stringify(o));
  c.pbot = async (o, ms = 4000) => { const k = c.replies.length; c.send({ type: 'pbot', ...o }); return until(() => c.replies.slice(k).find(r => r.op === o.op), ms, `pbot ${o.op} reply`); };
  c.list = async () => { await sleep(260); return (await c.pbot({ op: 'list' })).list; };
  c.me = () => c.pl.get(c.id);
  return c;
}
function startServer() {
  const env = { ...process.env, PORT: String(PORT), START_LEVEL: '10', MAX_BOTS: '12', TEST_HOOKS: '1', NAMED_ALWAYS: '1', PLAYER_BOT_GRACE: '30' };
  if (!DB) delete env.DATABASE_URL;
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; }); srv.stderr.on('data', d => { srv.log += d; });
  srv.ready = until(() => /running on/.test(srv.log), 15000, 'server start');
  return srv;
}
const call = async (method, p, token, body) => { const res = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => ({})) }; };

const clients = [];
let srv = startServer();
try {
  await srv.ready;
  const tag = String(100 + Math.floor(Math.random() * 900));
  const A = client(`Ann${tag}`), B = client(`Bob${tag}`);
  clients.push(A, B);
  await until(() => A.id && B.id && A.me(), 6000, 'players joined');

  // no cap: five bots (four in the party, one free)
  const bids = [];
  for (const [i, cls] of ['guardian', 'cleric', 'ranger', 'swordsman', 'lancer'].entries()) {
    const r = await A.pbot({ op: 'add', cls, name: `F${i}${tag}`, party: i !== 4 });
    bids.push(r.bid);
    if (!r.ok) console.log('   ', r.error);
  }
  await sleep(2500);
  let L = await A.list();
  const free = L.bots.find(b => b.bid === bids[4]);
  ok(L.mine === 5 && L.bots.filter(b => b.mine && b.myParty).length === 4, 'no per-player cap: Ann has 5 bots, 4 in her party');
  ok(free && !free.myParty && free.where.k === 'roam' && /Farming/.test(free.doing) && free.ctl.invite.ok, `the unticked one roams and farms ("${free?.doing}"), and can be invited`);
  ok(Array.isArray(L.named) && L.named.length === 5 && L.named.every(r => r.ctl.invite.ok || r.myParty), 'the list carries the Named, each invitable');
  ok(A.roster.find(r => r.name === `F4${tag}`)?.cid === A.id, 'roster: the free bot carries its creator\'s id (the wheel lists it)');

  // /b orders to the free bot
  let s0 = A.sys.length;
  A.send({ type: 'chat', text: `/b F4${tag}: stay` });
  await until(() => A.sys.slice(s0).some(t => /Order to F4/.test(t)), 3000, 'order ack');
  ok(true, '/b <free bot>: stay goes through');

  // Bob invites Ann's free bot from the list, then kicks it
  let r = await B.pbot({ op: 'invite', bid: bids[4] });
  await until(() => { const id = B.roster.find(x => x.name === `F4${tag}`)?.id; return id && B.pl.get(id)?.party && B.pl.get(id).party === B.me()?.party; }, 5000, 'free bot in Bob\'s party');
  ok(r.ok && /joined your party/.test(r.msg), `Bob invites it from the list: "${r.msg}"`);
  await until(() => A.sys.some(t => /invited your bot/.test(t)), 3000, 'Ann told');
  r = await B.pbot({ op: 'kick', bid: bids[4] });
  await sleep(800);
  L = await B.list();
  ok(r.ok && L.bots.find(b => b.bid === bids[4]).where.k === 'roam', 'Bob kicks it: it roams again');
  // the party is full: no list invite past it
  await A.pbot({ op: 'add', cls: 'bard', name: `F5${tag}`, party: false });
  await sleep(1200);
  r = await A.pbot({ op: 'invite', bid: bids[4] });
  ok(r.ok, 'Ann invites her free bot back (6 of 6)');
  const sixth = (await A.list()).bots.find(b => b.name === `F5${tag}`);
  r = await A.pbot({ op: 'invite', bid: sixth.bid });
  ok(!r.ok && /party is full/.test(r.error), `a 7th: "${r.error}"`);
  await sleep(5000); // (the order rate limit)

  // the Named from the list: invite (as a Stranger), despawn, respawn (back into the party)
  for (const bid of bids.slice(0, 2)) await B.pbot({ op: 'kick', bid }).catch(() => {}); // (Bob isn't in Ann's party: refused, harmless)
  const C = client(`Cy${tag}`); clients.push(C);
  await until(() => C.id && C.me(), 5000, 'Cy joined');
  r = await C.pbot({ op: 'invite', named: 'halvard' });
  ok(r.ok, `Cy (a Stranger) invites Halvard from the list: "${r.msg || r.error}"`);
  const hal = () => C.roster.find(x => x.named === 'halvard')?.id;
  await until(() => C.me()?.party && C.pl.get(hal())?.party === C.me().party, 8000, 'Halvard in Cy\'s party');
  ok(true, '...he joins her party');
  r = await C.pbot({ op: 'despawn', named: 'halvard' });
  await until(() => !C.roster.some(x => x.named === 'halvard'), 5000, 'Halvard gone');
  L = await C.list();
  ok(r.ok && L.named.find(x => x.id === 'halvard').state === 'despawned' && L.named.find(x => x.id === 'halvard').ctl.respawn.ok, 'Cy despawns him: gone, the list offers Respawn');
  const cyParty = C.me()?.party;
  r = await C.pbot({ op: 'respawn', named: 'halvard' });
  await until(() => hal() && C.pl.get(hal())?.party && C.pl.get(hal()).party === C.me()?.party, 10000, 'Halvard back in Cy\'s party');
  ok(r.ok && C.roster.filter(x => x.named === 'halvard').length === 1, `respawned, he rejoins Cy's party (${cyParty ? 'the same one' : 'a new one'}), one of him only`);
  r = await C.pbot({ op: 'kick', named: 'halvard' });
  await until(() => !C.pl.get(hal())?.party || C.pl.get(hal()).party !== C.me()?.party, 5000, 'Halvard kicked');
  ok(r.ok, 'Cy kicks him: back with the Hearthward');

  if (DB) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: DB, ssl: false });
    const col = (await pool.query(`SELECT column_default, data_type FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'access_level'`)).rows[0];
    ok(col && /^1/.test(col.column_default) && col.data_type === 'smallint', 'migration: accounts.access_level SMALLINT, default 1');
    // an admin and a plain account
    const mk = async name => { const tok = (await call('POST', '/api/guest')).body.token; const ch = (await call('POST', '/api/characters', tok, { name, cls: 'cleric' })).body.character; const me = (await call('GET', '/api/me', tok)).body; return { tok, ch, acct: me.account.id }; };
    const adm = await mk(`Adm${tag}`), dan = await mk(`Dan${tag}`);
    await pool.query('UPDATE accounts SET is_admin = true WHERE id = $1', [adm.acct]);
    ok((await pool.query('SELECT access_level FROM accounts WHERE id = $1', [dan.acct])).rows[0].access_level === 1, 'a new account starts at access level 1');
    const D = client(`Dan${tag}`, 'cleric', { session: dan.tok, character: dan.ch.id }); clients.push(D);
    await until(() => D.id, 5000, 'Dan joined');
    let pl = (await call('GET', '/api/admin/players', adm.tok)).body.players;
    ok(pl.find(p => p.id === dan.ch.id)?.access === 1 && pl.find(p => p.id === adm.ch.id)?.admin, 'admin players list: Dan at 1, the admin flagged');
    // an allow list on Ann's free bot: Dan is refused until his level is 3
    let res = await call('PATCH', `/api/admin/bots/${bids[4]}`, adm.tok, { allow: `Nobody${tag}` });
    ok(res.status === 400 && /No saved character/.test(res.body.error), `an unknown name is refused: "${res.body.error}"`);
    res = await call('PATCH', `/api/admin/bots/${bids[4]}`, adm.tok, { allow: `adm${tag}` });
    ok(res.status === 200 && res.body.bot.allow.length === 1 && res.body.bot.allow[0].id === String(adm.ch.id) && res.body.bot.allow[0].name === `Adm${tag}` && res.body.bot.creator === A.name, 'admin sets an allow list by name: stored as the character id; the admin view shows the creator');
    ok((await C.list()).bots.find(b => b.bid === bids[4]).creator === A.name, 'players see the creator of a player-made bot');
    await A.pbot({ op: 'kick', bid: bids[4] }); await sleep(800);
    s0 = D.sys.length;
    D.send({ type: 'chat', text: `/b F4${tag}: stay` });
    await until(() => D.sys.slice(s0).some(t => /only takes orders/.test(t)), 3000, 'Dan refused');
    ok(true, 'Dan (access 1, not on the list) may not order it');
    res = await call('POST', `/api/admin/accounts/${dan.acct}/access`, adm.tok, { level: 3 });
    ok(res.status === 200 && res.body.level === 3, 'admin sets Dan\'s account to access level 3');
    ok((await call('POST', `/api/admin/accounts/${dan.acct}/access`, adm.tok, { level: 6 })).status === 400 && (await call('POST', `/api/admin/accounts/${dan.acct}/access`, D.tok || dan.tok, { level: 5 })).status === 403, 'out of range: 400; not an admin: 403');
    pl = (await call('GET', '/api/admin/players', adm.tok)).body.players;
    ok(pl.find(p => p.id === dan.ch.id)?.access === 3, 'the players list shows 3');
    await sleep(300);
    s0 = D.sys.length;
    D.send({ type: 'chat', text: `/b F4${tag}: stay` });
    await until(() => D.sys.slice(s0).some(t => /Order to F4/.test(t)), 3000, 'Dan allowed');
    ok(true, '...and at once (online) he may order it: access 3 overrides the list');
    // the Named's allow list over the admin API
    res = await call('POST', '/api/admin/named/cairn/allow', adm.tok, { allow: `Dan${tag}` });
    ok(res.status === 200 && res.body.chars.find(c => c.id === 'cairn').allow[0]?.id === String(dan.ch.id), 'admin sets Cairn\'s allow list (Dan, by character id)');
    // Ann (the creator) adds Dan by name from the Players list, then "Just me"
    let ar = await A.pbot({ op: 'allow', bid: bids[4], add: `dan${tag}`, view: 'rows' });
    ok(ar.ok && ar.rows.bots.find(b => b.bid === bids[4]).allowList.includes(`Dan${tag}`), `in game: Ann adds Dan by name ("${ar.msg || ar.error}")`);
    ar = await A.pbot({ op: 'allow', bid: bids[4], add: `Ghost${tag}`, view: 'rows' });
    ok(!ar.ok && /No saved character/.test(ar.error), 'an unknown name is refused in game too');
    ar = await B.pbot({ op: 'allow', bid: bids[4], set: 'open', view: 'rows' });
    ok(!ar.ok && /Only its creator/.test(ar.error), 'Bob may not change it');
    L = await C.list();
    ok(!L.named.find(x => x.id === 'cairn').ctl.despawn.ok, 'Cy (not on it) may no longer despawn him');
    await call('POST', '/api/admin/named/cairn/allow', adm.tok, { allow: [] });
    // despawned survives a restart
    r = await C.pbot({ op: 'despawn', named: 'cairn' });
    ok(r.ok, 'Cy despawns Cairn');
    await sleep(3500); // (the Named's writes: every 3 s)
    for (const c of clients) c.ws.close();
    clients.length = 0;
    srv.kill(); await sleep(800);
    srv = startServer(); await srv.ready;
    const E = client(`Eve${tag}`); clients.push(E);
    await until(() => E.id, 5000, 'Eve joined');
    await sleep(3000);
    L = await E.list();
    ok(L.named.find(x => x.id === 'cairn').state === 'despawned' && !E.roster.some(x => x.named === 'cairn') && E.roster.filter(x => x.named).length === 4, 'after a restart Cairn is still out of the world (the others are in)');
    r = await E.pbot({ op: 'respawn', named: 'cairn' });
    await until(() => E.roster.some(x => x.named === 'cairn'), 6000, 'Cairn back');
    ok(r.ok, 'respawned: he roams again');
    await sleep(3500);
    await pool.end();
  } else console.log('  (access-level and restart checks skipped: set DATABASE_URL)');
} catch (e) {
  failed++; console.log('  NOT OK -', e.message);
} finally {
  for (const c of clients) c.ws.close();
  srv.kill();
  if (/\[uncaught|pbot Error|TypeError|ReferenceError/.test(srv.log)) { failed++; console.log('server log:\n' + srv.log); }
  console.log(failed ? `\n${failed} FAILED of ${n}` : `\nall ${n} passed`);
  process.exit(failed ? 1 : 0);
}
