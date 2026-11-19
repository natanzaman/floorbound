// The Named (docs/ROADMAP.md I1): shared/named.js rules, server/named.js in process, then a real server.
//   pure        tiers, daily caps (10:00 UTC reset), talk's own cap, the one loss, invite / call thresholds, level rule
//   in process  presence (only with a human online, parked during a show), their own bot kind, level + premade gear,
//               invites by tier, one Named per party, going home (disband, 10 quiet minutes), Sworn calls + cooldown,
//               every friendship source, the loss, humans-first rules (killing blow, XP / loot, MVP), clears apart in
//               the Hall, boss plans (never near a human), the loner's raid whisper, persistence through a store,
//               tracking, the kill switch
//   server      a real server on PORT (default 5320): nobody online = no Named; the Friends list; not in the Bots tab;
//               admin "remove all" leaves them; the admin API; a director show parks them; tick p95 with 2 humans +
//               6 player bots + 5 Named. With DATABASE_URL: migrations run twice, friendship and level survive a
//               restart, the level follows non-admin characters, a Named-only fight isn't tracked.
//               (The Postgres checks need a local test database: they clear named_chars and the Heroes' record.)
//   WARDEN=1    also: the Hearthward clear the Warden on their own (about 3 minutes).
// Usage: node test/named.js   (PORT=53xx DATABASE_URL=postgresql://postgres:pg@localhost/fb_named WARDEN=1)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { BotManager } from '../server/botmanager.js';
import { NamedManager, makeNamedStore, namedOn } from '../server/named.js';
import * as hall from '../server/hall.js';
import { MAX_LEVEL, WORLD, GATE, CLASSES } from '../shared/data.js';
import { pointsAt } from '../shared/talents.js';
import { masteryLevel } from '../shared/mastery.js';
import { loadoutFor } from '../shared/playerbots.js';
import { buildCard } from '../shared/mvp.js';
import {
  NAMED, NAMED_BY_ID, TIERS, GAINS, RULES, GROUPS, tierIndex, tierOf, newFriendship, gainFriendship, loseFriendship, dailyLeft,
  canInvite, canSummon, namedLevel, dayKey, isNamedName, awayLine,
} from '../shared/named.js';

const PORT = Number(process.env.PORT) || 5320;
const DB_URL = process.env.DATABASE_URL || '';
const DB = /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(DB_URL) ? DB_URL : ''; // the Postgres checks clear the Named's tables: a local test database only
if (DB_URL && !DB) console.log('  (DATABASE_URL is not a local database: skipping the Postgres checks)');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }
async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}

process.on('uncaughtException', e => { console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });

// =====================================================================================================================
console.log('# pure rules (shared/named.js)');
{
  const hal = NAMED_BY_ID.halvard, cairn = NAMED_BY_ID.cairn, T0 = Date.UTC(2026, 10, 18, 12);
  ok(NAMED.length === 5 && NAMED.filter(x => x.group === 'heroes').length === 4 && NAMED.filter(x => x.group === 'loner').length === 1, 'five Named: a Heroes Party of four and one loner');
  ok(['Tank', 'Healer', 'Damage', 'Damage'].join() === NAMED.filter(x => x.group === 'heroes').map(x => x.role).join(), 'the Heroes are a tank, a healer and two damage');
  ok(TIERS.map(t => t.at).join() === '0,15,35,60,85' && tierOf(34.9).id === 'known' && tierOf(35).id === 'ally' && tierOf(100).id === 'sworn', 'tiers: Stranger 0, Known 15, Ally 35, Friend 60, Sworn 85');
  const r = newFriendship();
  let got = 0;
  for (let i = 0; i < 100; i++) got += gainFriendship(r, hal, 'fight', GAINS.fight, T0).d;
  ok(got === 18 && r.pts === 18 && dailyLeft(r, hal, T0) === 0, 'a Hero gives at most 18 points a day to a Stranger');
  ok(gainFriendship(r, hal, 'revive', GAINS.revive, T0 + 3600e3).d === 0, 'the cap is one per Named, whatever the source');
  ok(dayKey(Date.UTC(2026, 10, 19, 9, 59)) === dayKey(T0) && dayKey(Date.UTC(2026, 10, 19, 10, 0)) === dayKey(T0) + 1, 'the day rolls over at 10:00 UTC');
  ok(gainFriendship(r, hal, 'fight', 1, Date.UTC(2026, 10, 19, 9, 59)).d === 0 && gainFriendship(r, hal, 'fight', 1, Date.UTC(2026, 10, 19, 10, 1)).d === 1, 'more only after the reset');
  // pacing: capped sessions
  const pace = (def, tier) => { const x = newFriendship(); let s = 0, t = T0; while (tierIndex(x.pts) < tier && s < 60) { s++; for (let i = 0; i < 80; i++) gainFriendship(x, def, 'fight', 1, t); t += 86400e3; } return s; };
  ok(pace(hal, 2) === 2 && pace(hal, 3) === 5, 'a Hero: Ally in 2 capped sessions, Friend in 5');
  const lf = pace(cairn, 3);
  ok(lf >= 8 && lf <= 10, `the loner: Friend in 8-10 capped sessions (${lf})`);
  ok(gainFriendship(newFriendship(), cairn, 'heal', 4, T0).d === 1 && gainFriendship(newFriendship(), cairn, 'fight', 4, T0).d === 4, 'the loner counts fighting beside him in full, help he never asked for at a quarter');
  // talk (I3): its own cap, never across a tier
  const c = { ...newFriendship(), pts: 33 };
  let chat = 0;
  for (let i = 0; i < 10; i++) chat += gainFriendship(c, hal, 'chat', 1, T0).d;
  ok(Math.abs(chat - 1.99) < 0.011 && tierOf(c.pts).id === 'known', 'talk alone never crosses a tier');
  const c2 = { ...newFriendship(), pts: 20 };
  chat = 0; for (let i = 0; i < 10; i++) chat += gainFriendship(c2, hal, 'chat', 1, T0).d;
  ok(chat === RULES.chatDaily, 'talk gives at most 3 points a day');
  ok(gainFriendship({ ...newFriendship(), pts: 36 }, hal, 'chat', -5, T0).pts === 35, 'a negative nudge never costs a tier');
  // the one loss
  const l = { ...newFriendship(), pts: 40 };
  ok(loseFriendship(l, hal).d === -4 && l.pts === 36 && loseFriendship(l, hal).d === -1 && l.pts === 35 && loseFriendship(l, hal).d === 0, 'leaving a Hero downed costs 4, never below the tier you hold');
  ok(loseFriendship({ ...newFriendship(), pts: 70 }, cairn).d === -6, 'the loner minds more (6)');
  // thresholds
  ok(!canInvite(hal, 34.9) && canInvite(hal, 35) && !canInvite(cairn, 59) && canInvite(cairn, 60), 'a Hero joins an Ally; the loner only a Friend');
  ok(!canSummon(hal, 84) && canSummon(hal, 85) && canSummon(cairn, 85), 'only a Sworn friend can call them');
  // level
  ok(namedLevel([20, 12, 8, 3]) === 15 && namedLevel([10]) === 12 && namedLevel([]) === 3, 'level: the top-3 average + 2');
  ok(namedLevel([4, 4, 4], { floor: 15 }) === 15 && namedLevel([30, 30, 29]) === MAX_LEVEL && namedLevel([10], { offset: 5 }) === 15, 'never drops, never above the cap, the offset is adjustable');
  ok(isNamedName(' cairn ') && isNamedName('HALVARD') && !isNamedName('Cairnn'), 'their names are reserved');
  ok(awayLine('heroes', 600) === '' && /While you were away \(the last 5 hours\): The Hearthward .* level 14\./.test(awayLine('heroes', 5 * 3600, { lvlFrom: 12, lvlTo: 14 })), 'a "while you were away" line from the time gone and the level change');
}

// =====================================================================================================================
console.log('# in process (server/named.js on a Game)');
// The real BotManager with an in-process start(): a "bot" is just a player added here (no WebSocket, no brain).
function world({ store = null } = {}) {
  const g = new Game();
  const tracked = [];
  g.track = (p, kind, data) => { tracked.push({ p, kind, data }); };
  const cleared = [];
  g.onClear = rec => cleared.push(rec);
  const mgr = new BotManager(g, { url: 'ws://127.0.0.1:9/ws' });
  clearInterval(mgr.timer);
  mgr.start = function (roles, names, { lvl, behaviour, join }) {
    this.joining = true; this.joiningNamed = !!join?.named; // (as addBotPlayer)
    let p;
    try { p = g.addPlayer({ readyState: 1, send() {} }, names[0], roles[0]); } finally { this.joining = false; this.joiningNamed = false; }
    p.bot = true; p.lvl = lvl;
    g.recompute(p); p.hp = p.maxHp;
    if (join?.named) this.namedJoin?.(p, join.named);
    const e = { bid: this.nextBid++, behaviour, lvl, at: Date.now(), b: { id: p.id, name: p.name, cls: p.cls, closed: false, goal: 'Farming the field', cmd: null, t: 0 } };
    e.group = { configure: o => { e.b.cfg = o; }, drop: b => { b.closed = true; g.removePlayer(p); } };
    this.bots.push(e);
    return [{ bid: e.bid }];
  };
  const clock = { t: Date.UTC(2026, 10, 18, 12) };
  const nm = new NamedManager(g, mgr, { store, interval: 0, now: () => clock.t });
  const human = (name, lvl = 10, cls = 'swordsman', saved = null) => {
    const sent = [];
    const p = g.addPlayer({ readyState: 1, send: s => sent.push(JSON.parse(s)) }, name, cls, saved);
    p.lvl = lvl; g.recompute(p); p.hp = p.maxHp; p.sent = sent;
    return p;
  };
  const tick = (k = 1, secs = 1) => { for (let i = 0; i < k; i++) { clock.t += secs * 1000; nm.tick(); } };
  const P = id => nm.playerOf(nm.chars.get(id));
  const sys = p => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);
  const set = (h, id, pts) => { nm.recOf(h, id).pts = pts; };
  return { g, mgr, nm, clock, human, tick, P, sys, set, tracked, cleared };
}

{
  const { g, mgr, nm, clock, human, tick, P, sys, set, tracked, cleared } = world();
  tick(3);
  ok(nm.online().length === 0 && g.players.size === 0, 'nobody online: none of the Named are simulated');
  const nat = human('Natan', 10);
  tick(2);
  ok(nm.online().length === 5 && [...g.players.values()].filter(p => p.named).every(p => p.bot), 'a human comes online: all five appear, as bots');
  ok(mgr.count() === 0 && mgr.list().length === 0 && mgr.bots.length === 5, 'they hold their own reserved slots: not counted against MAX_BOTS, not in the admin bot list');
  ok(mgr.removeAll() === 0 && mgr.bots.length === 5, 'admin "remove all" leaves them alone');
  ok(g.roster().filter(r => r.named).length === 5 && g.roster().find(r => r.name === 'Natan').named === undefined, 'roster rows carry their id');
  const hp = P('halvard'), heroes = ['halvard', 'maribel', 'tovin', 'sennet'].map(P), cairn = P('cairn');
  ok(heroes.every(p => p.party && p.party === hp.party) && g.partyOf(hp).members.length === 4 && !cairn.party, 'the Hearthward travel as one party; the loner alone');
  tick(1);
  ok(heroes.every(p => p.lvl === 12) && cairn.lvl === 12, 'level: the top players + 2 (one level-10 player: 12)');
  const L = loadoutFor(12);
  ok(cairn.look === 'cairn' && hp.look === 'halvard' && g.looksSnap().length === 5 && !nat.look, 'each wears their own look (I2)');
  ok(heroes.every(p => p.inv.eq.weapon?.r === L.rarity && p.inv.eq.armor && p.inv.eq.charm) && cairn.inv.eq.weapon.style === 'glaive' && P('sennet').inv.eq.weapon.style === 'halberd', 'gear is the premade setup for their level, in their own weapon style');
  ok(cairn.cls === 'lancer' && cairn.style === 'glaive' && cairn.inv.eq.weapon.cls === 'lancer' && /Glaive/.test(cairn.inv.eq.weapon.name), 'Cairn is a Lancer with a Glaive (the weapon his look carries)');
  ok(Object.keys(cairn.mastery).sort().join() === CLASSES.lancer.skills.map(s => s.id).filter(id => cairn.mastery[id]).sort().join() && Object.values(cairn.mastery).every(x => masteryLevel(x.pts) === L.mastery && (!L.evolved || x.br)), 'his premade setup is a Lancer\'s: Lancer skills at the level\'s mastery, evolved');
  nat.lvl = 16; clock.t += 61000; tick(2);
  ok(P('halvard').lvl === 18 && P('halvard').inv.eq.weapon.r === loadoutFor(18).rarity, 'they level as the players do (gear follows)');
  nat.lvl = 4; clock.t += 61000; tick(2);
  ok(P('halvard').lvl === 18 && nm.chars.get('cairn').lvl === 18, 'and never drop');
  nat.lvl = 10;

  // ---- no XP, no loot ----
  const xp0 = hp.xp, bag0 = hp.inv.bag.length;
  g.giveXp(hp, 5000); g.dropLoot(hp, [...g.mobs.values()].find(m => m.type === 'wolf'));
  ok(hp.xp === xp0 && hp.lvl === 18 && hp.inv.bag.length === bag0 && g.giveItem(hp, { slot: 'charm', r: 1, name: 'x', st: {} }) === false, 'the Named take no XP, loot or items');

  // ---- invites by tier ----
  const inv = (h, id) => { g.events = []; h.sent.length = 0; g.invite(h, P(id).id); return P(id).invite?.from === h.id; };
  nat.x = hp.x + 2; nat.z = hp.z;
  ok(!inv(nat, 'halvard') && /only joins an Ally/.test(sys(nat).join()) && g.events.some(e => e.t === 'chat' && e.id === hp.id), 'a Stranger\'s invite is refused, in character');
  set(nat, 'halvard', 35);
  ok(inv(nat, 'halvard'), 'an Ally\'s invite reaches a Hero');
  g.accept(hp, nat.id);
  ok(hp.party === nat.party && !!nat.party, 'the Hero joins your party');
  tick(1);
  ok(['maribel', 'tovin', 'sennet'].map(P).every(p => p.party && p.party !== nat.party && p.party === P('maribel').party) && g.partyOf(P('maribel')).members.length === 3, 'and leaves the Hearthward, who carry on as three');
  ok(g.events.some(e => e.t === 'chat' && e.id === hp.id), 'with a line as he joins');
  set(nat, 'maribel', 90);
  ok(!inv(nat, 'maribel') && /One of the Named per party/.test(sys(nat).join()), 'one Named per human party');
  const ann = human('Ann', 9);
  set(ann, 'halvard', 90);
  ok(!inv(ann, 'halvard') && /in Natan's party/.test(sys(ann).join()), 'someone else can\'t invite him away');
  ok(nm.call(ann, 'halvard') !== '' , 'or call him away');
  // back on disband
  g.leaveParty(nat); tick(1);
  ok(hp.party === P('maribel').party && g.partyOf(hp).members.length === 4, 'the party disbands: he is back with the Hearthward');
  // back after 10 quiet minutes
  ok(inv(nat, 'halvard'), 'invited again'); g.accept(hp, nat.id); tick(1);
  g.time += RULES.partyIdle - 5; tick(1);
  const still = hp.party === nat.party;
  g.time += 10; tick(1);
  ok(still && !nat.party && /heads home/.test(sys(nat).join()), 'after 10 minutes without a fight he heads home');
  tick(1);
  // the loner
  set(nat, 'cairn', 59);
  ok(!inv(nat, 'cairn') && /only joins a Friend/.test(sys(nat).join()), 'the loner refuses an Ally');
  set(nat, 'cairn', 60);
  ok(inv(nat, 'cairn'), 'and accepts a Friend'); g.accept(cairn, nat.id);
  ok(cairn.party === nat.party, 'the loner in your party');
  g.leaveParty(nat); tick(1);
  ok(!cairn.party, 'alone again when it disbands');

  // ---- Sworn calls ----
  set(nat, 'tovin', 84);
  ok(/Sworn friend/.test(nm.call(nat, 'tovin')), 'a Friend can\'t call');
  set(nat, 'tovin', 85);
  nat.x = 40; nat.z = 60;
  ok(nm.call(nat, 'tovin') === '' && P('tovin').party === nat.party && Math.hypot(P('tovin').x - nat.x, P('tovin').z - nat.z) < 6, 'a Sworn friend calls: he joins and comes to you');
  g.leaveParty(nat); tick(1);
  set(ann, 'tovin', 90);
  ok(/Try again in \d+ min/.test(nm.call(ann, 'tovin')), 'first come: nobody can call him again for 10 minutes');
  clock.t += RULES.summonCd * 1000 + 1000;
  g.events = [];
  ok(g.botCommand(ann, { cmd: 'come', name: 'tovin' }) === false && P('tovin').party === ann.party && !!ann.party, '"/b tovin: come" is the same call');
  g.leaveParty(ann); tick(1);
  g.events = [];
  ok(g.botCommand(nat, { cmd: 'come', name: 'cairn' }) === false && !cairn.party && /only comes when a Sworn/.test(sys(nat).join()), 'and refused below Sworn');

  // ---- friendship sources ----
  const fresh = (h, id) => { const r = nm.recOf(h, id); Object.assign(r, newFriendship()); return r; };
  const wolf = () => { const m = [...g.mobs.values()].find(x => x.type === 'wolf' && !x.dead); m.hp = m.maxHp; m.contributors.clear(); return m; };
  const at = (p, x, z) => { p.x = x; p.z = z; };
  // fight: a shared target within 25 m; the Named's kill still pays the human in full
  let m = wolf(); fresh(nat, 'cairn');
  at(nat, m.x + 1, m.z); at(cairn, m.x - 1, m.z);
  nat.xp = 0; nat.lvl = 10; const gold0 = nat.gold;
  g.damageMob(m, nat, 1); m.hp = 2; g.events = []; nat.sent.length = 0;
  g.damageMob(m, cairn, 500);
  ok(m.dead && nm.peek(nat, 'cairn').pts === GAINS.fight, 'fighting beside the loner on a shared target: +0.5');
  ok(nat.xp === m.def.xp && g.events.some(e => e.t === 'loot' && e.to === nat.id) && nat.gold >= gold0, 'a Named\'s killing blow on a field mob you damaged: full XP and your own loot');
  ok(nat.sent.some(s => s.type === 'named' && s.op === 'fr' && s.id === 'cairn' && s.d === 0.5 && s.why === 'fight'), 'the client hears about it');
  m = wolf(); at(nat, m.x + 30, m.z); at(cairn, m.x - 1, m.z);
  g.damageMob(m, nat, 1); m.hp = 2; g.damageMob(m, cairn, 500);
  ok(nm.peek(nat, 'cairn').pts === GAINS.fight, 'not from further than 25 m');
  m = wolf(); at(nat, m.x + 1, m.z); at(cairn, m.x - 1, m.z); nat.xp = 0;
  g.damageMob(m, cairn, 1); m.hp = 2; g.damageMob(m, nat, 500);
  ok(nm.peek(nat, 'cairn').pts === 2 * GAINS.fight && nat.xp === m.def.xp, 'your own kill counts the same (and the Named takes no share of the XP)');
  // partied: the human's share is undiluted
  m = wolf(); fresh(nat, 'halvard'); set(nat, 'halvard', 40); g.invite(nat, hp.id); g.accept(hp, nat.id);
  at(nat, m.x + 1, m.z); at(hp, m.x - 1, m.z); nat.xp = 0;
  g.damageMob(m, nat, 1); m.hp = 2; g.damageMob(m, hp, 500);
  ok(nat.xp === m.def.xp && hp.xp === 0, 'in your party, a Named\'s kill still gives you the whole XP');
  // heal / cover / revive
  const before = nm.peek(nat, 'halvard').pts;
  hp.hp = Math.round(hp.maxHp * 0.4); g.healPlayer(hp, hp.maxHp * 0.2, nat, null);
  ok(nm.peek(nat, 'halvard').pts === before + GAINS.heal, 'healing them: +0.5');
  hp.hp = Math.round(hp.maxHp * 0.4); g.healPlayer(hp, hp.maxHp * 0.2, nat, null);
  hp.hp = Math.round(hp.maxHp * 0.4); g.healPlayer(hp, 1, nat, null);
  ok(nm.peek(nat, 'halvard').pts === before + GAINS.heal, 'not again within 6 s, and not for a sliver');
  nm.onCovered(hp, nat);
  ok(nm.peek(nat, 'halvard').pts === before + GAINS.heal + GAINS.cover, 'Covering them: +1');
  hp.downed = { at: g.time, until: g.time + 15, src: 'test', by: nat.id, prog: 1, need: 2 }; hp.hp = 0;
  g.completeRevive(hp, nat);
  ok(nm.peek(nat, 'halvard').pts === before + GAINS.heal + GAINS.cover + GAINS.revive && !hp.downed, 'reviving them: +4');
  // the loss: they bleed out with you standing within 40 m, in their party
  set(nat, 'halvard', 50);
  at(nat, hp.x + 10, hp.z);
  hp.downed = { at: g.time, until: g.time, src: 'test', by: 0, prog: 0, need: 2 }; hp.hp = 0;
  g.events = [];
  g.bleedOut(hp);
  ok(nm.peek(nat, 'halvard').pts === 46 && /bled out with you close by/.test(sys(nat).join()), 'leaving a Hero downed within 40 m: -4');
  hp.dead = false; hp.hp = hp.maxHp; set(nat, 'halvard', 36);
  hp.downed = { at: g.time, until: g.time, src: 'test', by: 0, prog: 0, need: 2 }; hp.hp = 0; g.bleedOut(hp);
  ok(nm.peek(nat, 'halvard').pts === 35, 'but never the tier itself');
  hp.dead = false; hp.hp = hp.maxHp; set(nat, 'halvard', 50); at(nat, hp.x + 45, hp.z);
  hp.downed = { at: g.time, until: g.time, src: 'test', by: 0, prog: 0, need: 2 }; hp.hp = 0; g.bleedOut(hp);
  ok(nm.peek(nat, 'halvard').pts === 50, 'not from beyond 40 m');
  hp.dead = false; hp.hp = hp.maxHp;
  // daily cap through the live path, and the contract for I3 / I4
  fresh(nat, 'maribel');
  for (let i = 0; i < 60; i++) g.addFriendship(nat, 'maribel', 1, 'fight');
  const fr = g.namedFriendship(nat, 'maribel');
  ok(fr.pts === 18 && fr.tier === 'known' && fr.left === 0 && g.addFriendship(nat.id, 'maribel', 5, 'revive').d === 0, 'game.addFriendship / game.namedFriendship: capped per day');
  ok(g.addFriendship(nat, 'maribel', 1, 'request').d === 1 && g.namedFriendship(nat, 'maribel').pts === 19, '(a finished request has its own cap, I4: server/namedquests.js)');
  clock.t += 86400e3;
  ok(g.addFriendship(nat, 'maribel', 30, 'fight').d === 18 && g.namedFriendship(nat, 'maribel').tier === 'ally', 'the next day more; a tier-up');
  ok(nat.sent.some(s => s.op === 'fr' && s.id === 'maribel' && s.up && s.tierName === 'Ally') && tracked.some(t => t.kind === 'named_tier' && t.data.named === 'maribel'), 'tier-ups are announced');
  ok(g.addFriendship(hp, 'maribel', 5, 'fight') === null && g.namedFriendship(hp, 'maribel') === null, 'bots have no friendship');

  // ---- boss help: at least 10% of the damage or healing ----
  g.leaveParty(nat); tick(1);
  fresh(nat, 'halvard'); fresh(ann, 'halvard'); fresh(nat, 'cairn');
  const f = { start: g.time - 60, ids: new Set([nat.id, ann.id, hp.id]), deaths: 0, team: new Map([[hp.id, { dmg: 800, tanked: 500 }], [nat.id, { dmg: 150 }], [ann.id, { dmg: 50, heal: 0 }]]) };
  nm.onFightEnd(f, 'kill');
  ok(nm.peek(nat, 'halvard').pts === GAINS.boss && nm.peek(ann, 'halvard').pts === 0 && nm.peek(nat, 'cairn').pts === 0, 'real help in their boss fight (15% of the damage): +8; a 5% passenger and absent Named: nothing');
  f.team.set(ann.id, { dmg: 0, heal: 300 });
  nm.onFightEnd(f, 'wipe');
  ok(nm.peek(ann, 'halvard').pts === 0, 'review #6: healing only herself is not real help');
  f.team.set(ann.id, { dmg: 0, heal: 300, healOther: 300 });
  nm.onFightEnd(f, 'wipe');
  ok(nm.peek(ann, 'halvard').pts === GAINS.bossTry, 'healing others counts; a wipe: +3');

  // ---- humans first on a boss ----
  const W = g.boss, A = WORLD.arena;
  for (const p of [nat, hp, P('tovin')]) at(p, A.x + (p.id % 3), A.z - 3);
  W.hp = W.maxHp; W.contributors.clear();
  g.damageMob(W, nat, 5); W.hp = 10;
  g.damageMob(W, P('tovin'), 9999);
  ok(!W.dead && W.hp === 1, 'a Named never lands the killing blow on a boss while a human who fought it stands in the arena');
  const bells = () => g.events.filter(e => e.t === 'bell').length;
  g.events = [];
  g.damageMob(W, nat, 9999);
  ok(W.dead && cleared.length === 1 && cleared[0].first === true && !cleared[0].heroes && bells() === 1 && nat.stats.floorClearsFirst === 1, 'the human\'s blow clears the floor: a first clear, the bell rings');
  ok(nat.inv.bag.some(it => it.la === 1) && !P('tovin').inv.bag.length, 'and the Last Attack Bonus is the human\'s');

  // ---- a clear with no human: the Heroes' record ----
  {
    const w2 = world();
    const h = w2.human('Solo', 10); w2.tick(3);
    const B = w2.g.boss, t = w2.P('tovin'), hh = w2.P('halvard');
    for (const p of [t, hh]) at(p, A.x + 1, A.z - 3);
    w2.g.damageMob(B, hh, 5); B.hp = 10; w2.g.events = [];
    w2.g.damageMob(B, t, 9999);
    const rec = w2.cleared[0];
    ok(B.dead && rec?.heroes === true && rec.first === false && !w2.g.hadFirstClear && !w2.g.events.some(e => e.t === 'bell') && !t.stats.floorClearsFirst, 'a clear by the Named alone: never "first", no bell');
    const said = w2.g.events.filter(e => e.t === 'sys' && !e.to).map(e => e.text);
    ok(w2.g.floorClears === 0 && !w2.g.events.some(e => e.t === 'clear' || e.t === 'la') && !said.some(x => /LAST ATTACK|cleared by/.test(x)) && said.includes('The Hearthward felled the Horned Warden.'), 'review #3: no floor counter, Last Attack shout, "Floor 1 cleared" line or clear banner; one quiet line');
    hall.add(rec);
    const msg = hall.message();
    ok(msg.heroes?.length === 1 && msg.heroes[0].players.length === 2 && !msg.first && !msg.recent.length && !msg.fastest.length && !hall.hasFirst(1), 'it goes on the Hall\'s "Heroes\' record", not in first / fastest / recent');
    // the next human clear is still the first
    B.dead = false; B.hp = B.maxHp; B.contributors.clear(); w2.g.fight = null;
    at(h, A.x, A.z - 3); w2.g.damageMob(B, h, 5); B.hp = 5; w2.g.events = []; w2.g.damageMob(B, h, 9999);
    ok(w2.cleared[1]?.first === true && w2.g.events.some(e => e.t === 'bell'), 'the first human clear after it is still the server first');
    // tracking: Named-only fights aren't written; mixed ones are flagged
    w2.tracked.length = 0;
    w2.g.trackFight(1, { start: w2.g.time - 50, ids: new Set(), who: [{ bot: true, cls: 'ranger', key: 's1', lvl: 12, named: 'tovin' }, { bot: true, cls: 'guardian', key: 's2', lvl: 12, named: 'halvard' }] }, 'kill', B);
    ok(!w2.tracked.some(x => x.kind === 'fight'), 'a fight of the Named alone is not written to play tracking');
    w2.g.trackFight(1, { start: w2.g.time - 50, ids: new Set(), who: [{ bot: false, cls: 'swordsman', key: 's9', lvl: 10 }, { bot: true, cls: 'ranger', key: 's1', lvl: 12, named: 'tovin' }] }, 'kill', B);
    const row = w2.tracked.find(x => x.kind === 'fight')?.data;
    ok(row?.humans === 1 && row.bots === 1 && row.named === 1, 'a mixed fight is, with the Named counted as bots and flagged');
    const tr = [];
    const g3 = new Game(); g3.track = (p, kind, d) => tr.push([kind, d]);
    const m3 = new BotManager(g3, { url: 'ws://127.0.0.1:9/ws' }); clearInterval(m3.timer);
    g3.track({ bot: true, named: 'cairn' }, 'death', { cause: 'wolf' }); g3.track({ bot: true }, 'session_start', {});
    ok(tr.length === 1 && tr[0][0] === 'bot_death' && tr[0][1].named === 'cairn', 'their deaths are bot deaths, flagged named; nothing else of theirs is tracked');
  }

  // ---- MVP: humans first ----
  const card = buildCard({ boss: 'W', floor: 1, result: 'kill', secs: 80, rows: [
    { id: 1, name: 'Halvard', cls: 'guardian', bot: true, named: 1, dmg: 900, tanked: 4000, lastAttack: 0 },
    { id: 2, name: 'Tovin', cls: 'ranger', bot: true, named: 1, dmg: 3000 },
    { id: 3, name: 'Natan', cls: 'swordsman', bot: false, dmg: 700, tanked: 200, lastAttack: 1 },
  ] });
  const natRow = card.rows.find(r => r.id === 3);
  ok(card.mvp === 3 && natRow.titles.includes('heavy') && natRow.titles.includes('lastword') && !card.rows.find(r => r.id === 2).titles.includes('heavy'), 'MVP and titles go to the human first');
  ok(card.rows.find(r => r.id === 1).titles.includes('unshakable'), 'the Named still get what everyone gets');
  const plain = buildCard({ boss: 'W', floor: 1, result: 'kill', secs: 80, rows: [{ id: 1, name: 'A', cls: 'guardian', bot: true, dmg: 900 }, { id: 3, name: 'N', cls: 'swordsman', dmg: 700 }] });
  ok(plain.mvp === 1, 'a card without the Named is as before');

  // ---- boss plans ----
  tick(2);
  const plan = nm.plans.heroes, lplan = nm.plans.loner;
  for (const id of ['halvard', 'maribel', 'tovin', 'sennet', 'cairn']) { const p = P(id); p.dead = false; p.hp = p.maxHp; at(p, 5, 60); }
  at(nat, 0, GATE.zone.z0 + 4); at(ann, 0, 30); // Natan stands at the raid gate
  plan.mode = 'farm'; plan.nextAt = clock.t - 1; plan.homeAt = 0; lplan.mode = 'farm'; lplan.nextAt = clock.t + 9e9; W.dead = true; g.fight = null;
  tick(2);
  ok(plan.mode === 'farm' && nm.chars.get('halvard').e.b.noBoss === true, 'they don\'t start a boss while a human is at the gate or in the arena');
  at(nat, 0, 30); tick(1);
  ok(plan.mode === 'boss' && nm.chars.get('halvard').e.behaviour === 'warden' && nm.chars.get('halvard').e.b.noBoss === false, 'the way is clear: the Hearthward head for the Warden');
  lplan.nextAt = clock.t - 1; tick(1);
  ok(lplan.mode === 'farm', 'one group at a boss at a time');
  at(nat, 0, GATE.zone.z0 + 4); tick(1);
  ok(plan.mode === 'farm' && nm.chars.get('halvard').e.behaviour === 'field', 'a human reaches the gate first: they turn back (never into a human\'s fight)');
  at(nat, 0, 30);

  // ---- 5b: the loner's raid whisper ----
  plan.nextAt = clock.t + 9e9;
  set(nat, 'cairn', 61); set(ann, 'cairn', 30);
  lplan.mode = 'farm'; lplan.nextAt = clock.t - 1; g.events = []; nat.invite = null;
  tick(1);
  ok(lplan.mode === 'boss' && nat.invite?.from === cairn.id && /Cairn whispers/.test(sys(nat).join()) && !ann.invite && !/whispers/.test(sys(ann).join()), 'heading for a boss, the loner whispers a Friend an invite (not an Ally)');
  g.accept(nat, cairn.id);
  ok(nat.party === cairn.party && nm.chars.get('cairn').e.b.cmd?.k === 'boss', 'accepted: you are in his party and he leads the way');
  g.leaveParty(nat); tick(1);
  lplan.mode = 'farm'; lplan.nextAt = clock.t - 1; g.events = []; nat.invite = null; tick(1);
  ok(lplan.mode === 'boss' && !nat.invite, 'at most one whisper an hour');
  clock.t += RULES.whisperCd * 1000 + 1000;
  lplan.mode = 'farm'; lplan.nextAt = clock.t - 1; g.events = []; tick(1);
  ok(nat.invite?.from === cairn.id, 'an hour later he asks again');
  g.handle(nat, { type: 'decline' });
  clock.t += RULES.whisperCd * 1000 + 1000;
  lplan.mode = 'farm'; lplan.nextAt = clock.t - 1; g.events = []; tick(1);
  ok(!nat.invite && nat.nmDeclined === true, 'declined: no more raid invites this session');

  // ---- messages ----
  nat.sent.length = 0; clock.t += 1000;
  g.handle(nat, { type: 'named', op: 'list' });
  const list = nat.sent.find(s => s.type === 'named' && s.op === 'list')?.list;
  const cr = list?.rows.find(r => r.id === 'cairn'), hr = list?.rows.find(r => r.id === 'halvard');
  ok(list?.rows.length === 5 && cr.tierName === 'Friend' && cr.online && cr.area && cr.doing && cr.invite.ok && !cr.call.ok && typeof cr.color === 'number' && hr.gname === GROUPS.heroes.name, 'the Friends list: tier, bar, where, what, and what you may ask of each');

  // ---- parked during a show; gone when nobody is online ----
  g.director = { running: true }; tick(1);
  ok(nm.online().length === 0 && nm.parked, 'a director show: the Named are parked');
  clock.t += 1000; nat.sent.length = 0; g.handle(nat, { type: 'named', op: 'list' });
  ok(nat.sent.find(s => s.op === 'list')?.list.rows.every(r => !r.online && /show/.test(r.doing)), 'and the Friends tab says so');
  g.director = { running: false }; tick(2);
  ok(nm.online().length === 5, 'back when it ends');
  nm.setEnabled('cairn', false); tick(1);
  ok(nm.online().length === 4 && !P('cairn'), 'admin despawn sends one home');
  nm.setEnabled('cairn', true); tick(2);
  ok(nm.online().length === 5, 'and spawn brings them back');
  nm.setOffset(5); clock.t += 61000; tick(2);
  ok(P('halvard').lvl === MAX_LEVEL || P('halvard').lvl >= 18, 'admin: the level offset');
  g.removePlayer(nat); g.removePlayer(ann);
  tick(1); tick(1, RULES.linger - 2);
  const lingering = nm.online().length;
  tick(1, 3);
  ok(lingering === 5 && nm.online().length === 0 && g.players.size === 0, 'the last human leaves: a few seconds later they are gone');

  // ---- names ----
  const fake = g.addPlayer({ readyState: 1, send() {} }, 'Cairn', 'swordsman');
  ok(!isNamedName(fake.name), 'an anonymous player can\'t take one of their names');
}

// ---- review fixes (2026-11-18): one Named per party, quiet clears, names, boss help, humans first, plans ----
console.log('# review fixes');
{
  const { g, mgr, nm, clock, human, tick, P, sys, set } = world();
  const nat = human('Natan', 10); tick(3);
  const at = (p, x, z) => { p.x = x; p.z = z; };
  const near = (p, q) => at(p, q.x + 2, q.z);
  const hp = P('halvard'), mb = P('maribel'), tv = P('tovin'), cairn = P('cairn');
  // #2: two invites out before either accepts
  set(nat, 'halvard', 40); set(nat, 'maribel', 40); near(nat, hp);
  g.invite(nat, hp.id); g.invite(nat, mb.id);
  ok(hp.invite?.from === nat.id && mb.invite?.from === nat.id, 'two invites out at once');
  g.accept(hp, nat.id); g.events = [];
  g.accept(mb, nat.id);
  ok(hp.party === nat.party && mb.party !== nat.party && !mb.invite && /One of the Named per party/.test(sys(nat).join()) && g.events.some(e => e.t === 'chat' && e.id === mb.id), 'review #2: the second to accept is turned away (invite cleared, the "taken" line)');
  g.leaveParty(nat); tick(1);
  // an invite out, then a Sworn call
  set(nat, 'tovin', 90); g.invite(nat, mb.id);
  ok(/One of the Named per party/.test(nm.call(nat, 'tovin')) && (!nat.party || tv.party !== nat.party), 'review #2: a Sworn call while another Named has your invite: refused');
  mb.invite = null;
  // a call, then an old invite accepted
  g.invite(nat, mb.id); mb.invite.from = nat.id; const pend = { ...mb.invite }; mb.invite = null;
  ok(nm.call(nat, 'tovin') === '' && tv.party === nat.party, 'the call goes through once nothing is pending');
  mb.invite = pend; g.accept(mb, nat.id);
  ok(mb.party !== nat.party && !mb.invite, 'review #2: an invite accepted after a call: turned away');
  g.leaveParty(nat); tick(1);
  // nice-to-have: a failed call doesn't spend the cooldown
  clock.t += RULES.summonCd * 1000 + 1000;
  const join = mgr.joinParty; mgr.joinParty = () => {};
  ok(nm.call(nat, 'tovin') === 'failed', 'a call that fails to join…');
  mgr.joinParty = join;
  ok(nm.call(nat, 'tovin') === '' && tv.party === nat.party, '…spends no cooldown: the next call works');
  g.leaveParty(nat); tick(1);

  // #6 through the live path: self-healing isn't "healing done"
  const W = g.boss, A = WORLD.arena;
  const ann = human('Ann', 10, 'cleric');
  for (const p of [nat, ann]) at(p, A.x, A.z - 3);
  g.fight = { start: g.time, ids: new Set([nat.id, ann.id]), deaths: 0, hp: W.maxHp, team: new Map() };
  ann.hp = 10; g.healPlayer(ann, 200, ann, null);
  nat.hp = 10; g.healPlayer(nat, 50, ann, null);
  const row = g.fight.team.get(ann.id) || {};
  ok(row.heal > row.healOther && row.healOther > 0 && row.healOther <= 50, `review #6: healing counted apart for others (heal ${row.heal}, healOther ${row.healOther})`);
  g.fight = null;

  // nice-to-have: the held killing blow lets go after 20 s without a human hit
  W.dead = false; W.hp = W.maxHp; W.contributors.clear();
  at(tv, A.x + 1, A.z - 3);
  g.damageMob(W, nat, 5); W.hp = 10;
  g.damageMob(W, tv, 9999);
  ok(!W.dead, 'a human hit it just now: the blow is held');
  g.time += RULES.holdIdle + 1;
  g.damageMob(W, tv, 9999);
  ok(W.dead, 'nice-to-have: no human hit for 20 s: the Named may finish it');
  W.dead = false; W.hp = W.maxHp; W.contributors.clear(); g.fight = null;
  at(nat, 0, 30); at(ann, 0, 30);

  // nice-to-have: tag and leave
  const wolf = () => { const m = [...g.mobs.values()].find(x => x.type === 'wolf' && !x.dead); m.hp = m.maxHp; m.contributors.clear(); return m; };
  let m = wolf(); at(nat, m.x + 2, m.z); at(cairn, m.x - 1, m.z); nat.xp = 0;
  g.damageMob(m, nat, 1); at(nat, m.x + RULES.tagR + 5, m.z); m.hp = 2; g.damageMob(m, cairn, 500);
  ok(m.dead && nat.xp === 0, 'nice-to-have: tagged and ran 60 m+ away: no XP from a Named\'s kill');
  m = wolf(); at(nat, m.x + 2, m.z); nat.xp = 0;
  g.damageMob(m, nat, 1); at(nat, m.x + 40, m.z); m.hp = 2; g.damageMob(m, cairn, 500);
  ok(m.dead && nat.xp === m.def.xp, 'within 60 m: full XP');

  // nice-to-have: a hosted Named doesn't go home in the middle of a boss fight, wherever he stands
  set(nat, 'halvard', 40); at(nat, 0, 30); g.invite(nat, hp.id); g.accept(hp, nat.id); tick(1);
  g.fight = { start: g.time, ids: new Set([nat.id]), deaths: 0, hp: W.maxHp, team: new Map() };
  at(hp, 0, 30); g.time += RULES.partyIdle + 5; tick(1);
  ok(!!nat.party && hp.party === nat.party, 'nice-to-have: an active boss fight keeps him (not only standing in the room)');
  g.fight = null; g.time += 1; tick(1);
  ok(!nat.party && /heads home/.test(sys(nat).join()), 'it ends: he heads home');
  tick(1);

  // nice-to-have: never short-handed
  const plan = nm.plans.heroes;
  for (const id of ['halvard', 'maribel', 'tovin', 'sennet']) { const p = P(id); p.dead = false; p.hp = p.maxHp; at(p, 5, 60); }
  at(nat, 0, 30); at(ann, 0, 30); W.dead = true;
  plan.mode = 'boss'; plan.since = clock.t; plan.fought = false; plan.homeAt = 0;
  set(nat, 'sennet', 40); g.invite(nat, P('sennet').id); g.accept(P('sennet'), nat.id); tick(1);
  ok(P('sennet').party === nat.party && plan.mode === 'farm', 'nice-to-have: one of them goes off with a human: the march on the boss is called off');
  g.leaveParty(nat); tick(2);

  // nice-to-have: the gate check is immediate
  plan.mode = 'boss'; plan.fought = false;
  at(hp, 0, GATE.zone.z0 + 4); at(nat, 0, GATE.zone.z0 + 5);
  g.toggleReady(hp);
  ok(!g.gate.ready.has(hp.id) && plan.mode === 'farm' && nm.chars.get('halvard').e.b.noBoss, 'nice-to-have: a human at the gate: a Named can\'t ready, and they turn back at once');
  at(nat, 0, 30); plan.mode = 'boss';
  g.toggleReady(hp);
  ok(g.gate.ready.has(hp.id), 'no human there: he readies as before');
  g.gate.ready.clear(); at(hp, 5, 60);

  // #3: Floors 2 and 3, Named alone
  for (const [boss, key, clr, la, N2] of [[g.sovereign, 'floorClears2', 'clear2', 'la2', 'the Drowned Sovereign'], [g.colossus, 'floorClears3', 'clear3', 'la3', 'the Storm Colossus']]) {
    boss.contributors.clear(); boss.contributors.add(cairn.id); boss.hp = 1; boss.dead = false;
    g.events = []; const n0 = g[key];
    g.killMob(boss, cairn);
    const said = g.events.filter(e => e.t === 'sys' && !e.to).map(e => e.text);
    ok(boss.dead && g[key] === n0 && !g.events.some(e => e.t === clr || e.t === la) && !said.some(x => /LAST ATTACK|cleared by/.test(x)) && said.includes(`Cairn felled ${N2}.`), `review #3: ${N2} felled by a Named alone: a quiet line, no counter or banner`);
  }
  // bots alone (no Named) are announced as always
  const bot = human('Rook', 12); bot.bot = true;
  W.dead = false; W.hp = 1; W.contributors.clear(); W.contributors.add(bot.id); at(bot, A.x, A.z - 3); g.events = [];
  const c0 = g.floorClears;
  g.killMob(W, bot);
  ok(g.floorClears === c0 + 1 && g.events.some(e => e.t === 'clear'), 'player bots alone still clear with the banner (only the Named are quiet)');

  // #5: their names, for bots too
  let threw = '';
  try { mgr.add({ cls: 'ranger', name: 'Cairn', lvl: 5 }); } catch (e) { threw = e.message; }
  ok(/one of the Named/.test(threw), 'review #5: an admin bot can\'t be named after one of the Named');
  ok(mgr.uniqueName('Halvard') !== 'Halvard', 'nor get one as a picked name');
  const rook = mgr.add({ cls: 'ranger', name: 'Rook', lvl: 5, behaviour: 'field' });
  const rp = mgr.livePlayer(mgr.bots.find(e => e.bid === rook.bid)), rn = rp.name;
  threw = '';
  try { mgr.edit(rook.bid, { name: 'Sennet' }); } catch (e) { threw = e.message; }
  ok(/one of the Named/.test(threw) && rp.name === rn, 'review #5: nor renamed to one on the admin page');
  mgr.remove(rook.bid);
  mgr.joining = true; mgr.joiningNamed = false;
  let sneak;
  try { sneak = g.addPlayer({ readyState: 1, send() {} }, 'Maribel', 'cleric'); } finally { mgr.joining = false; }
  ok(sneak.name !== 'Maribel', 'review #5: a bot joining with one of their names (not the Named\'s own join) gets another');
  g.removePlayer(sneak);
}

// ---- persistence through a store (in memory here; Postgres below) ----
{
  const db = { chars: new Map(), fr: new Map(), writes: 0, levels: [9, 7, 5, 2] };
  const store = {
    loadChars: async () => [...db.chars.values()],
    saveChar: async r => { db.writes++; db.chars.set(r.id, { id: r.id, lvl: r.lvl, lvl_off: r.off, enabled: r.enabled, seen_at: r.seenAt ? new Date(r.seenAt) : null }); },
    loadFriends: async charId => [...db.fr.entries()].filter(([k]) => k.startsWith(`${charId}:`)).map(([k, v]) => ({ named_id: k.split(':')[1], ...v })),
    saveFriend: async (charId, id, rec) => { db.writes++; db.fr.set(`${charId}:${id}`, { ...rec }); },
    listFriends: async () => [], charExists: async () => true,
    topLevels: async () => db.levels.slice(0, 3),
  };
  let w = world({ store });
  await w.nm.useStore(store);
  const sara = w.human('Sara', 3, 'cleric', { charId: 77, accountId: 5, lvl: 3, xp: 0, gold: 0 });
  w.tick(2); await sleep(20); w.tick(2);
  ok(w.P('halvard')?.lvl === 9, 'with accounts the level follows the store\'s top characters (9, 7, 5 -> 7 + 2), not who happens to be online');
  w.g.addFriendship(sara, 'cairn', 6, 'fight'); w.g.addFriendship(sara, 'halvard', 12, 'revive');
  w.clock.t += 4000; w.tick(1); await sleep(20);
  ok(db.fr.get('77:cairn')?.pts === 6 && db.fr.get('77:halvard')?.pts === 12 && db.chars.get('halvard')?.lvl === 9, 'friendship and level are saved');
  const anon = w.human('Guest', 5);
  w.g.addFriendship(anon, 'cairn', 3, 'fight');
  w.clock.t += 4000; w.tick(1); await sleep(20);
  ok(![...db.fr.keys()].some(k => !k.startsWith('77:')) && w.nm.peek(anon, 'cairn').pts === 3, 'an anonymous player\'s friendship lasts for the session only');
  w.g.removePlayer(anon); w.g.removePlayer(sara);
  await sleep(20);
  const writes = db.writes;
  w.tick(30, 2); await sleep(20);
  ok(db.writes === writes && w.nm.online().length === 0, 'nothing is written with nobody online');
  // a restart
  db.levels = [2];
  w = world({ store });
  await w.nm.useStore(store);
  const sara2 = w.human('Sara', 3, 'cleric', { charId: 77, accountId: 5, lvl: 3, xp: 0, gold: 0 });
  w.tick(2); await sleep(20); w.tick(2);
  ok(w.g.namedFriendship(sara2, 'cairn').pts === 6 && w.g.namedFriendship(sara2, 'halvard').pts === 12, 'after a restart the friendship is back');
  ok(w.P('halvard').lvl === 9 && w.nm.chars.get('cairn').lvl === 9, 'and their level never dropped (the top players are level 2 now)');
  ok(w.nm.peek(w.human('Guest', 5), 'cairn') === null, 'the anonymous one starts over');
}

// ---- review #1: a failed or slow friendship load never overwrites what's stored; #7: flush waits for its writes ----
{
  const db = new Map([['42:cairn', { pts: 60, day: 0, got: 0, chat: 0 }], ['42:halvard', { pts: 30, day: 0, got: 0, chat: 0 }]]);
  let fail = 1, gate = null, writes = 0;
  const store = {
    loadChars: async () => [],
    saveChar: async () => {},
    loadFriends: async charId => {
      if (fail-- > 0) throw new Error('connection reset');
      if (gate) await gate.p;
      return [...db.entries()].filter(([k]) => k.startsWith(`${charId}:`)).map(([k, v]) => ({ named_id: k.split(':')[1], ...v }));
    },
    saveFriend: (charId, id, rec) => new Promise(r => setTimeout(() => { writes++; db.set(`${charId}:${id}`, { ...rec }); r(); }, 30)),
    listFriends: async () => [], charExists: async () => true, topLevels: async () => [],
  };
  const w = world({ store });
  await w.nm.useStore(store);
  const kai = w.human('Kai', 5, 'swordsman', { charId: 42, accountId: 9, lvl: 5, xp: 0, gold: 0 });
  w.tick(2); await sleep(20);
  ok(w.nm.friends.get(42)?.loaded === false, 'the first load fails: the cache is marked not loaded');
  w.g.addFriendship(kai, 'cairn', 1, 'fight');
  w.clock.t += 4000; w.tick(1); await sleep(60);
  ok(db.get('42:cairn').pts === 60 && writes === 0, 'review #1: a gain after a failed load is not saved over the stored row (60 stays 60)');
  w.clock.t += RULES.loadRetry * 1000; w.tick(1); await sleep(20);
  ok(w.nm.friends.get(42).loaded && w.nm.peek(kai, 'cairn').pts === 61 && w.nm.peek(kai, 'halvard').pts === 30, 'review #1: the load is tried again from tick; the earlier gain is merged on top (61), the rest as stored');
  w.clock.t += 4000; w.tick(1); await sleep(60);
  ok(db.get('42:cairn').pts === 61 && db.get('42:halvard').pts === 30, 'review #1: the merged record is marked dirty and saved');
  // a slow load: a gain flushed before it returns
  w.g.removePlayer(kai); await sleep(60);
  let open; gate = { p: new Promise(r => { open = r; }) };
  const kai2 = w.human('Kai', 5, 'swordsman', { charId: 42, accountId: 9, lvl: 5, xp: 0, gold: 0 });
  w.tick(1);
  w.g.addFriendship(kai2, 'halvard', 2, 'fight');
  w.clock.t += 4000; w.tick(1); await sleep(60);
  ok(db.get('42:halvard').pts === 30, 'review #1: a slow load: nothing is saved before it returns');
  open(); await sleep(20);
  w.clock.t += 4000; w.tick(1); await sleep(60);
  ok(w.nm.peek(kai2, 'halvard').pts === 32 && db.get('42:halvard').pts === 32 && db.get('42:cairn').pts === 61, 'review #1: when it returns the gain is merged (30 + 2) and saved; the rest untouched');
  // #7: flush() resolves only once the writes are done
  gate = null;
  w.g.addFriendship(kai2, 'halvard', 1, 'fight');
  w.nm.chars.get('cairn').dirty = true;
  const before = writes;
  const done = w.nm.flush();
  ok(writes === before && typeof done?.then === 'function', 'review #7: flush() starts the writes and returns a promise');
  await done;
  ok(writes === before + 1 && db.get('42:halvard').pts === 33, 'review #7: and resolves after they land (shutdown waits for it)');
}

// ---- the kill switch ----
{
  const g = new Game();
  const a = g.addPlayer({ readyState: 1, send() {} }, 'Cairn', 'swordsman'), b = g.addPlayer({ readyState: 1, send() {} }, 'B', 'cleric');
  b.bot = true; g.invite(a, b.id);
  process.env.NAMED_ENABLED = '0';
  const off = !namedOn();
  delete process.env.NAMED_ENABLED;
  ok(off && namedOn() && !g.named && a.name === 'Cairn' && b.invite?.from === a.id && g.namedFriendship(a, 'cairn') === null && g.addFriendship(a, 'cairn', 5, 'fight') === null, 'NAMED_ENABLED=0: no manager, and every hook is a pass-through');
}

// =====================================================================================================================
console.log('# a real server');
const servers = new Set(); // (a failed check must not leave a server behind)
process.on('exit', () => { for (const s of servers) try { s.kill('SIGKILL'); } catch {} });
function startServer(env = {}) {
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', TEST_HOOKS: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; }); srv.stderr.on('data', d => { srv.log += d; });
  srv.ready = until(() => /running on/.test(srv.log), 15000, 'the server');
  srv.stop = () => new Promise(r => { servers.delete(srv); srv.once('exit', r); srv.kill('SIGKILL'); });
  servers.add(srv);
  return srv;
}
const api = async (p, method = 'GET', body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
function client(name, cls = 'swordsman', join = {}) {
  const c = { name, roster: [], sys: [], msgs: [], pl: new Map(), seq: 0, chat: [] };
  c.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'join', name, cls, ...join })));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'welcome') Object.assign(c, { id: m.id, x: m.x, z: m.z, seq: m.seq, welcome: m });
    else if (m.type === 'roster') c.roster = m.players;
    else if (m.type === 'snap') {
      c.pl = new Map(m.w.players.map(p => [p[0], { x: p[1], z: p[2], lvl: p[6], party: p[8] }]));
      for (const e of m.w.events) {
        if (e.t === 'sys' && (!e.to || e.to === c.id)) c.sys.push(e.text);
        if (e.t === 'chat') c.chat.push(e);
        if (e.t === 'tp' && e.id === c.id) Object.assign(c, { x: e.x, z: e.z, seq: e.s });
      }
    } else c.msgs.push(m);
  });
  c.send = o => c.ws.send(JSON.stringify(o));
  c.ask = async (o, type = o.type) => { const k = c.msgs.length; c.send(o); return until(() => c.msgs.slice(k).find(m => m.type === type && (!o.op || m.op === o.op)), 5000, `${type} ${o.op || ''} reply`); };
  c.named = () => c.roster.filter(r => r.named);
  c.close = () => c.ws.close();
  return c;
}

{
  const srv = startServer();
  await srv.ready;
  await sleep(2500);
  let v = await api('/api/admin/named');
  ok(v.on && v.chars.length === 5 && v.chars.every(c => !c.online) && v.humans === 0, 'nobody online: the admin view shows all five away');
  const a = client('Natan');
  await until(() => a.id, 5000, 'join');
  await until(() => a.named().length === 5, 8000, 'the Named to appear');
  ok(a.named().every(r => r.bot) && a.named().map(r => r.name).sort().join() === 'Cairn,Halvard,Maribel,Sennet,Tovin', 'a player joins: the five walk in');
  await until(() => { const ps = a.named().map(r => a.pl.get(r.id)); return ps.every(Boolean) && new Set(ps.filter((_, i) => a.named()[i].named !== 'cairn').map(p => p.party)).size === 1 && ps.every(p => p.lvl === 3); }, 8000, 'party + level');
  ok(true, 'the Hearthward share a party; with one level-1 player around they are level 3');
  const bots = await a.ask({ type: 'pbot', op: 'list' });
  ok(bots.list.bots.length === 0 && bots.list.total === 0, 'they are not in the Bots tab, and not counted as bots there');
  ok(a.welcome?.named === true, 'review #4: welcome says the Named are on (the client adds the Friends tab)');
  const pb = await a.ask({ type: 'pbot', op: 'add', cls: 'ranger', name: 'Cairn', skill: 3 });
  ok(!pb.ok && /one of the Named/.test(pb.error), 'review #5: a player-added bot can\'t be named after one of the Named');
  const list = (await a.ask({ type: 'named', op: 'list' })).list;
  ok(list.rows.length === 5 && list.rows.every(r => r.online && r.tierName === 'Stranger' && !r.invite.ok && !r.call.ok), 'the Friends list over the wire: five Strangers');
  const hal = a.named().find(r => r.named === 'halvard');
  a.sys.length = 0; a.send({ type: 'invite', id: hal.id });
  await until(() => a.sys.some(s => /only joins an Ally/.test(s)), 4000, 'the refusal');
  await sleep(400);
  ok(!a.pl.get(a.id).party, 'a Stranger\'s invite is refused');
  a.send({ type: 'test', friend: { id: 'halvard', pts: 40 } });
  await sleep(300);
  const inv = await a.ask({ type: 'named', op: 'invite', id: 'halvard' });
  await until(() => a.pl.get(a.id)?.party && a.pl.get(hal.id)?.party === a.pl.get(a.id).party, 6000, 'Halvard to join');
  ok(!inv.error && a.chat.some(e => e.id === hal.id), 'an Ally invites him from the Friends tab: his own brain accepts, he joins and says so');
  a.send({ type: 'leave' });
  await until(() => { const p = a.pl.get(hal.id), m = a.pl.get(a.named().find(r => r.named === 'maribel').id); return p?.party && p.party === m?.party; }, 6000, 'Halvard to go back');
  ok(true, 'you leave the party: he goes back to the Hearthward');
  v = await api('/api/admin/named/cairn/despawn', 'POST', {});
  await until(() => a.named().length === 4, 5000, 'Cairn to leave');
  v = await api('/api/admin/named/cairn/spawn', 'POST', {});
  await until(() => a.named().length === 5, 6000, 'Cairn to return');
  ok(true, 'admin: despawn and spawn one of them');
  v = await api('/api/admin/named/offset', 'POST', { off: 9, reset: true });
  await until(() => a.named().length === 5 && a.named().every(r => a.pl.get(r.id)?.lvl === 10), 12000, 'level 10');
  ok(v.chars.every(c => c.off === 9), 'admin: the level offset (1 + 9 = level 10)');
  const cv = await until(async () => { const c = (await api('/api/admin/named')).chars.find(x => x.id === 'cairn'); return c.online && c.talents === pointsAt(10) && c.style === 'glaive' && c; }, 15000, 'Cairn to spend his talents');
  ok(cv.cls === 'lancer' && cv.style === 'glaive' && cv.lvl === 10, `Cairn plays as a Glaive Lancer and spends every talent point in the Lancer tree (${cv.talents} at level 10)`);
  v = await api('/api/admin/named');
  ok(v.friends.some(f => f.online && f.f.halvard === 40) && v.chars.find(c => c.id === 'halvard').online, 'admin: the friendship table shows the live numbers');

  // a director show parks them
  const sheet = 'title: Park\ncast:\n  - { id: wren, name: "Wren", class: cleric, level: 4 }\nscenes:\n  - id: one\n    place: town\n    marks: { wren: fountain }\n    cues:\n      - { who: wren, do: say, text: "Quiet on set.", hold: 4 }\n';
  const loaded = await api('/api/admin/director/load', 'POST', { text: sheet });
  const ran = await api('/api/admin/director/run', 'POST', { from: 0, force: true });
  await until(() => a.named().length === 0, 6000, 'the Named to be parked');
  const mid = await api('/api/admin/named');
  ok(!loaded.error && !ran.error && mid.parked && a.roster.some(r => r.name === 'Wren'), 'a director show runs with the Named parked');
  await until(async () => !['casting', 'running'].includes((await api('/api/admin/director')).state), 30000, 'the show to end');
  await api('/api/admin/director/stop', 'POST', {});
  await until(() => a.named().length === 5, 8000, 'the Named to come back');
  ok(true, 'and they come back after it');

  // tick time: 2 humans + 6 player bots + 5 Named
  const b = client('Ann', 'cleric');
  await until(() => b.id, 5000, 'second join');
  for (const c of [a, b]) for (const cls of ['guardian', 'ranger', 'cleric']) { await c.ask({ type: 'pbot', op: 'add', cls, skill: 5 }); await sleep(120); }
  await until(() => a.roster.filter(r => r.bot && !r.named).length === 6, 8000, 'six player bots');
  for (const c of [a, b]) for (const bot of (await c.ask({ type: 'pbot', op: 'list' })).list.bots.filter(x => x.mine)) { await c.ask({ type: 'pbot', op: 'edit', bid: bot.bid, mode: 'field' }); await sleep(120); } // everyone out fighting
  const walk = setInterval(() => { for (const c of [a, b]) { if (!c.id) continue; c.x += 0.25; c.send({ type: 'input', x: +c.x.toFixed(2), z: +(c.z + 0).toFixed(2), face: 0, seq: c.seq }); } }, 100);
  await sleep(Number(process.env.PERF_SECS || 25) * 1000);
  clearInterval(walk);
  const st = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
  ok(st.players === 13 && st.tick.p95 < 25, `tick p95 with 2 humans + 6 player bots + 5 Named: ${st.tick.p95} ms (p50 ${st.tick.p50}, max ${st.tick.max}; needs < 25)`);
  a.close(); b.close();
  await until(async () => (await api('/api/admin/named')).chars.every(c => !c.online), 20000, 'the Named to leave');
  ok(true, 'everyone leaves: the Named go too');
  await srv.stop();
}
{ // NAMED_ENABLED=0: no Friends tab
  const srv = startServer({ NAMED_ENABLED: '0' });
  await srv.ready;
  const a = client('Natan');
  await until(() => a.id, 5000, 'join');
  ok(a.welcome && !('named' in a.welcome), 'review #4: NAMED_ENABLED=0: welcome has no named flag (no Friends tab, no polling)');
  a.close();
  await srv.stop();
}

if (DB) {
  console.log('# with Postgres');
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: DB });
  const q = (t, p) => pool.query(t, p).then(r => r.rows);
  let srv = startServer({ DATABASE_URL: DB });
  await srv.ready;
  ok(/Database connected/.test(srv.log), 'the migration runs');
  await srv.stop();
  await q(`DELETE FROM accounts WHERE discord_name LIKE 'named-test-%'`);
  await q('DELETE FROM named_chars'); await q('DELETE FROM floor_clears WHERE heroes'); // (what earlier runs left: the level never drops)
  srv = startServer({ DATABASE_URL: DB });
  await srv.ready;
  ok(/Database connected/.test(srv.log) && !/Database unavailable/.test(srv.log), 'and runs again on the same database');
  // two accounts: an admin with a level-20 character and a player with a level-9 one
  const tag = `t${Date.now() % 1e6}`;
  const [adm] = await q(`INSERT INTO accounts (discord_name, is_admin) VALUES ('named-test-admin', true) RETURNING id`);
  const [usr] = await q(`INSERT INTO accounts (discord_name) VALUES ('named-test-user') RETURNING id`);
  await q(`INSERT INTO characters (account_id, name, cls, lvl) VALUES ($1, $2, 'swordsman', 20)`, [adm.id, `Adm${tag}`]);
  await q(`INSERT INTO characters (account_id, name, cls, lvl, updated_at) VALUES ($1, $2, 'swordsman', 18, now() - interval '30 days')`, [usr.id, `Old${tag}`]);
  const [ch] = await q(`INSERT INTO characters (account_id, name, cls, lvl) VALUES ($1, $2, 'swordsman', 9) RETURNING id, name`, [usr.id, `Usr${tag}`]);
  // (characters other tests left in this database: out of the 14-day window while we look, put back at the end)
  const others = await q(`SELECT id, updated_at FROM characters WHERE account_id NOT IN ($1, $2) AND updated_at > now() - interval '15 days'`, [adm.id, usr.id]);
  await q(`UPDATE characters SET updated_at = now() - interval '30 days' WHERE id = ANY($1::int[])`, [others.map(o => o.id)]);
  const store = makeNamedStore(q);
  ok((await store.topLevels()).join() === '9', 'the levels they follow: non-admin characters played in the last 14 days');
  const token = (await import('node:crypto')).randomBytes(24).toString('hex');
  const hash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex');
  await q('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [hash, usr.id]);
  let c = client('x', 'swordsman', { session: token, character: ch.id });
  const joined = await until(() => c.id || c.msgs.find(m => m.type === 'denied'), 6000, 'the account join');
  if (!c.id) { ok(false, `account join (${JSON.stringify(joined)})`); }
  else {
    await until(() => c.named().length === 5 && c.named().every(r => c.pl.get(r.id)?.lvl === 11), 12000, 'level 11');
    ok(true, 'in the world they are level 11 (9 + 2): the admin\'s level 20 and the long-idle 18 don\'t count');
    c.send({ type: 'test', friend: { id: 'cairn', pts: 61.5 } }); c.send({ type: 'test', friend: { id: 'maribel', pts: 20 } });
    await until(async () => (await q('SELECT count(*)::int AS n FROM named_friendship WHERE char_id = $1', [ch.id]))[0].n === 2, 10000, 'the friendship rows');
    await until(async () => (await q('SELECT count(*)::int AS n FROM named_chars WHERE lvl = 11'))[0].n === 5, 10000, 'the level rows');
    ok(true, 'friendship (per character) and their level are in Postgres');
    c.close();
    await sleep(600);
    await srv.stop();
    await q('UPDATE characters SET lvl = 2 WHERE id = $1', [ch.id]);
    srv = startServer({ DATABASE_URL: DB });
    await srv.ready;
    c = client('x', 'swordsman', { session: token, character: ch.id });
    await until(() => c.id, 6000, 'rejoin');
    await sleep(1500);
    const list = (await c.ask({ type: 'named', op: 'list' })).list;
    ok(list.rows.find(r => r.id === 'cairn').pts === 61.5 && list.rows.find(r => r.id === 'cairn').tierName === 'Friend' && list.rows.find(r => r.id === 'maribel').tierName === 'Known', 'after a restart your friendship is as you left it');
    await until(() => c.named().length === 5 && c.named().every(r => c.pl.get(r.id)?.lvl === 11), 12000, 'level 11 again');
    ok(true, 'and they are still level 11 though the top player dropped to 2');
    const [bad] = await Promise.all([fetch(`http://127.0.0.1:${PORT}/api/characters`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'Halvard', cls: 'guardian' }) })]);
    ok(bad.status === 409, 'nobody can make a character with one of their names');
    c.close();
  }
  await sleep(500);
  await srv.stop();
  for (const o of others) await q('UPDATE characters SET updated_at = $2 WHERE id = $1', [o.id, o.updated_at]);
  await q(`DELETE FROM accounts WHERE discord_name LIKE 'named-test-%'`);
  await pool.end();
} else console.log('  (set DATABASE_URL for the Postgres checks)');

if (process.env.WARDEN) {
  console.log('# the Hearthward against the Warden, on their own');
  const srv = startServer({ NAMED_ALWAYS: '1', NAMED_LEVEL: process.env.NAMED_LEVEL || '12', NAMED_BOSS_AFTER: '15', TEST_HOOKS: '' });
  await srv.ready;
  const spec = { hall: null, clears: 0, la: null };
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'spectate' })));
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'hall') spec.hall = m;
    if (m.type === 'snap') for (const e of m.w.events) { if (e.t === 'clear') spec.banner = true; if (e.t === 'sys' && /^The Hearthward felled the Horned Warden/.test(e.text)) spec.clears++; if (e.t === 'la') spec.la = e.name; if (e.t === 'bell') spec.bell = true; }
  });
  const t0 = Date.now();
  await until(() => spec.clears > 0, 420000, 'the clear');
  await sleep(1000);
  ws.send(JSON.stringify({ type: 'hall' }));
  await until(() => spec.hall?.heroes?.length, 5000, 'the Hall');
  const rec = spec.hall.heroes[0];
  console.log(`  The Hearthward cleared the Warden in ${rec.secs} s with ${rec.deaths} deaths (${rec.players.map(p => `${p.name} Lv${p.lvl}`).join(', ')}; Last Attack: ${rec.lastAttack}); ${Math.round((Date.now() - t0) / 1000)} s after the server started`);
  ok(rec.players.length === 4 && rec.players.every(p => NAMED_BY_ID[p.name.toLowerCase()]?.group === 'heroes') && !spec.hall.first && !spec.bell && !spec.banner && !spec.la, 'the four Heroes cleared the Warden alone: on the Heroes\' record, no first clear, no bell, no banner (a quiet line)');
  ws.close();
  await srv.stop();
}

console.log(failed ? `named: ${failed} of ${n} FAILED` : `named: ${n} ok`);
process.exit(failed ? 1 : 0);
