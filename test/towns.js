// Floor towns that grow, and their Stewards (docs/briefs/towns.md): node test/towns.js
//  1. pure rules: stages and XP, projects and unlocks, prices, the citizenship cooldown, raid outcome bounds, vote rules,
//     bot voting by friendship and agenda, the election rule of each floor (vote, contribution, the duel bracket)
//  2. in process: join at the board, donate and finish a project, bounties, stand and vote, close each floor's election,
//     the Steward's powers, raids won and lost (and off during a director show), bots holding the ward
//  3. with DATABASE_URL: a real server (TEST_HOOKS) on PORT (default 3361): join, donate (a project done), stand, vote,
//     close the election, a raid won; a restart keeps all of it
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOWNS, TOWN_FLOORS, STAGES, STAGE_MAX, stageOf, stageProgress, TXP, BOT_RATE, RAID, RAID_MOBS, raidLoss, raidWinXp, UNLOCKS,
  PROJECTS, projectOf, projectNeed, projectDone, openProjects, activeUnlocks, TAX, clampTax, priceMul, PRICE_FLOOR,
  CITIZEN_DISCOUNT, COOLDOWN, newCitizen, moveBlock, bountiesFor, BOUNTY_POOL, AGENDAS, BOT_CANDIDATES, NAMED_HOMES, LONERS,
  botVote, voteScore, tally, pickByVote, pickByContrib, seedBracket, paperDuel, stewardProject, stewardTax, DAY, isMat,
} from '../shared/towns.js';
import { MOBS, walkable, OBSTACLES } from '../shared/data.js';
import { NAMED_BY_ID } from '../shared/named.js';
import { SHOP, MERCHANT } from '../shared/items.js';
import { Game } from '../server/game.js';
import { townRecord, cleanTown } from '../server/towns.js';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

// ---------- 1. pure rules ----------
await t('stages: Camp, Village, Town, City at rising XP; the progress bar', () => {
  assert.deepEqual(STAGES.map(s => s.name), ['Camp', 'Village', 'Town', 'City']);
  assert.equal(STAGES[0].xp, 0);
  for (let i = 1; i < STAGES.length; i++) { assert.ok(STAGES[i].xp > STAGES[i - 1].xp); assert.equal(stageOf(STAGES[i].xp), i); assert.equal(stageOf(STAGES[i].xp - 1), i - 1); }
  assert.deepEqual(stageProgress(STAGES[1].xp + 10), { stage: 1, into: 10, need: STAGES[2].xp - STAGES[1].xp });
  assert.equal(stageProgress(1e9).need, 0);
  assert.ok(BOT_RATE > 0 && BOT_RATE < 1, 'bots count, at a reduced rate');
  assert.ok(TXP.boss > TXP.elite && TXP.elite > TXP.kill);
});

await t('projects: every floor starts with one at Camp; costs name real materials; unlocks are data', () => {
  for (const f of TOWN_FLOORS) {
    assert.ok(PROJECTS[f].some(pr => pr.stage === 0), `floor ${f} has a Camp project`);
    for (const pr of PROJECTS[f]) {
      assert.ok(UNLOCKS[pr.unlock], pr.id); assert.equal(projectOf(pr.id), pr);
      assert.ok(pr.cost.gold > 0 && pr.stage >= 0 && pr.stage <= STAGE_MAX, pr.id);
      for (const k of Object.keys(pr.cost.mats || {})) assert.ok(isMat(k), `${pr.id}: ${k}`);
    }
    for (const k of ['bounty', 'stock', 'gate', 'plot']) assert.ok(PROJECTS[f].some(pr => pr.unlock === k), `floor ${f}: ${k}`);
  }
  assert.ok(PROJECTS[2].some(pr => pr.unlock === 'trader' && pr.stage === 0), 'the camps build a trader first');
  assert.equal(projectOf('__proto__'), null);
  const pr = PROJECTS[1][0];
  assert.deepEqual(projectNeed(pr, {}), { gold: pr.cost.gold, mats: { ...pr.cost.mats } });
  assert.ok(!projectDone(pr, { gold: pr.cost.gold }));
  assert.ok(projectDone(pr, { gold: pr.cost.gold, mats: { ...pr.cost.mats } }));
  // an unlock counts once built and at its stage
  const later = PROJECTS[1].find(x => x.stage === 1);
  assert.ok(!openProjects(1, 0, []).includes(later) && openProjects(1, 1, []).includes(later));
  assert.ok(activeUnlocks(1, 1, [later.id])[later.unlock]);
  assert.ok(!activeUnlocks(1, 0, [later.id])[later.unlock], 'a town knocked back a stage loses the unlock (until it regrows)');
  for (const s of SHOP.filter(s => s.town)) assert.ok(TOWN_FLOORS.includes(s.town) && (s.r ?? 1) >= 1);
});

await t('town objects sit on walkable ground, clear of the scenery; raiders gather on walkable ground', () => {
  for (const f of TOWN_FLOORS) {
    const T = TOWNS[f];
    for (const k of ['board', 'ward', 'gate', 'trader']) {
      const o = T[k]; if (!o) continue;
      assert.ok(walkable(o.x, o.z), `${f} ${k}`);
      for (const ob of OBSTACLES) assert.ok(Math.hypot(ob.x - o.x, ob.z - o.z) >= ob.r + 1.5, `${f} ${k} clear of a ${ob.kind}`);
    }
    for (let i = 0; i <= 4; i++) assert.ok(walkable(T.raidFrom.x[0] + (i / 4) * (T.raidFrom.x[1] - T.raidFrom.x[0]), T.raidFrom.z), `${f} raidFrom ${i}`);
    for (const k of [...RAID_MOBS[f].mobs, RAID_MOBS[f].elite]) assert.ok(MOBS[k], `${f}: ${k}`);
    for (const b of BOUNTY_POOL[f]) assert.ok(MOBS[b.mob], b.mob);
  }
});

await t('prices: tax and discounts within limits, never below the floor; no subsidy from an empty treasury', () => {
  assert.equal(clampTax(0.5), TAX.max); assert.equal(clampTax(-1), TAX.min); assert.equal(clampTax('x'), 0); assert.equal(clampTax(0.034), 0.03);
  assert.equal(priceMul({}), 1);
  assert.equal(priceMul({ citizen: true }), 1 - CITIZEN_DISCOUNT);
  assert.equal(priceMul({ tax: 0.1 }), 1.1);
  assert.equal(priceMul({ tax: -0.05, citizen: true, subsidyOk: false }), 1 - CITIZEN_DISCOUNT);
  assert.ok(priceMul({ tax: -0.05, citizen: true, market: 0.5 }) >= PRICE_FLOOR);
});

await t('citizenship: one home, the first join free, then 7 days between moves; records clean up', () => {
  const now = 1_700_000_000_000, c = newCitizen();
  assert.equal(c.home, 0);
  assert.equal(moveBlock(c, 1, now), '');
  c.home = 1; c.moved = now;
  assert.match(moveBlock(c, 1, now), /already live/);
  assert.match(moveBlock(c, 2, now + DAY), /move again in 6 days/);
  assert.equal(moveBlock(c, 2, now + COOLDOWN), '');
  assert.match(moveBlock(c, 9, now), /No such town/);
  assert.deepEqual(newCitizen({ home: 7, moved: -5, given: 'x' }), { home: 0, moved: 0, given: 0, bounty: { day: 0, f: {} } });
  assert.equal(newCitizen({ home: 2, moved: 5 }).home, 2);
});

await t('raids: a loss never drops more than a stage nor below Camp; a win pays; bigger with more players', () => {
  assert.equal(raidLoss(0), 0);
  assert.ok(raidLoss(50) <= 50);
  for (let s = 0; s <= STAGE_MAX; s++) for (const into of [0, 1, 200, 3000]) {
    const xp = STAGES[s].xp + into, after = xp - raidLoss(xp);
    assert.ok(after >= STAGES[Math.max(0, s - 1)].xp, `stage ${s}+${into}: at most one stage`);
    assert.ok(after >= 0 && raidLoss(xp) >= 0);
  }
  assert.ok(raidLoss(STAGES[2].xp + 2000) > 0);
  assert.ok(raidWinXp(RAID.waves) > raidWinXp(1));
  assert.ok(RAID.every[0] >= 2 && RAID.every[1] <= 5, 'every few days');
});

await t('bounties: three a day, the same for everyone, from the floor\'s pool', () => {
  const a = bountiesFor(2, 100), b = bountiesFor(2, 100), c = bountiesFor(2, 101);
  assert.deepEqual(a, b); assert.equal(a.length, 3); assert.equal(new Set(a.map(x => x.mob)).size, 3);
  assert.ok(a.every(x => BOUNTY_POOL[2].includes(x)));
  assert.ok([...Array(10)].some((_, i) => JSON.stringify(bountiesFor(2, 101 + i)) !== JSON.stringify(a)) || c);
});

await t('votes: one per voter, changeable (a map); ties by what was given, then who stood first', () => {
  const cands = [{ key: 'a', at: 1, contrib: 0 }, { key: 'b', at: 2, contrib: 300 }, { key: 'c', at: 3, contrib: 0 }];
  const votes = { v1: 'a', v2: 'b', v3: 'zz' };
  votes.v1 = 'c'; // changed
  const tl = tally(votes, cands);
  assert.deepEqual(tl, { a: 0, b: 1, c: 1 });
  assert.equal(pickByVote(cands, tl), 'b', 'tie on votes: the bigger giver');
  assert.equal(pickByVote(cands, { a: 2, b: 1 }), 'a');
  assert.equal(pickByContrib(cands, { a: 5 }), 'b', 'Floor 2: contribution, whatever the votes');
  assert.equal(pickByContrib([{ key: 'x', at: 5 }, { key: 'y', at: 4 }]), 'y', 'nobody gave: who stood first');
});

await t('bot and Named voters: agenda, friendship and party time; loners only vote for a friend', () => {
  const cands = [{ key: 'c1', ag: 'build' }, { key: 'c2', ag: 'defend' }, { key: 'n:halvard', ag: 'defend' }];
  assert.equal(botVote({ key: 'b:x', lean: 'build' }, cands), 'c1', 'agenda alone');
  assert.equal(botVote({ key: 'n:maribel', lean: 'build', fr: { c2: 60 } }, cands), 'c2', 'friendship beats agenda');
  assert.equal(botVote({ key: 'b:y', lean: 'build', rap: { c2: 3600 } }, cands), 'c2', 'party time beats agenda');
  assert.equal(botVote({ key: 'b:z', lean: 'trade', creator: 'c2' }, cands), 'c2', 'a bot backs its creator');
  assert.equal(botVote({ key: 'n:halvard', lean: 'build', fr: { c1: 100 } }, cands), 'n:halvard', 'a candidate votes for itself');
  assert.equal(botVote({ key: 'n:cairn', lean: 'trade', min: LONERS.cairn }, cands), '', 'the loner stays home');
  assert.equal(botVote({ key: 'n:cairn', lean: 'trade', min: LONERS.cairn, fr: { c1: 70 } }, cands), 'c1');
  assert.ok(voteScore({ key: 'v', lean: 'build' }, { key: 'c', ag: 'trade', contrib: 1e9 }) < 10, 'gifts count, capped');
});

await t('Floor 3 bracket: single elimination with byes for the top seeds; paper duels are fixed', () => {
  const C = k => ({ key: k, at: k.charCodeAt(0), contrib: 0 });
  assert.deepEqual(seedBracket([C('a'), C('b')], {}), [['a', 'b']]);
  const three = seedBracket([C('a'), C('b'), C('c')], { c: 3, b: 2 });
  assert.deepEqual(three, [['c', ''], ['b', 'a']], 'the top seed gets the bye');
  assert.equal(seedBracket([C('a'), C('b'), C('c'), C('d'), C('e')], {}).length, 4);
  const a = { key: 'a', lvl: 20 }, b = { key: 'b', lvl: 1 };
  assert.equal(paperDuel(a, b, 1), 'a'); assert.equal(paperDuel(b, a, 1), 'a');
  assert.equal(paperDuel({ key: 'x', lvl: 5 }, { key: 'y', lvl: 5 }, 3), paperDuel({ key: 'x', lvl: 5 }, { key: 'y', lvl: 5 }, 3));
});

await t('candidates and homes: data names real Named; bot Stewards pick by agenda within the limits', () => {
  for (const f of TOWN_FLOORS) {
    assert.ok(BOT_CANDIDATES[f].length >= 1 && BOT_CANDIDATES[f].length <= 2);
    for (const c of BOT_CANDIDATES[f]) { assert.ok(AGENDAS[c.ag]); if (c.named) { assert.ok(NAMED_BY_ID[c.named], c.named); assert.equal(c.key, `n:${c.named}`); } }
  }
  for (const id of Object.keys(NAMED_HOMES)) assert.ok(NAMED_BY_ID[id], id);
  for (const ag of Object.keys(AGENDAS)) { const x = stewardTax(ag); assert.ok(x >= TAX.min && x <= TAX.max); }
  const open = openProjects(1, 3, []);
  assert.equal(projectOf(stewardProject('defend', open)).unlock, 'gate');
  assert.equal(stewardProject('build', []), '');
});

// ---------- 2. in process ----------
const ws = { readyState: 1, send() {} };
const g = new Game();
let clock = 1_700_000_000_000;
g.townClock = () => clock;
g.townRand = () => 0.5;
g.track = () => {};
for (const m of g.mobs.values()) { m.dead = true; m.deadUntil = Infinity; } // (no bites mid-test)
const sysTo = p => [...g.events, ...(p.pev || [])].filter(e => e.t === 'sys' && (e.to === p.id || e.to == null)).map(e => e.text); // (pev: private lines, Game.priv)
const step = secs => { for (let i = 0; i < Math.round(secs * 20); i++) g.update(0.05); };
const act = (p, msg) => { g.time += 0.2; return g.handle(p, { type: 'town', ...msg }); }; // (past the rate limit)
const atBoard = (p, f) => { p.x = TOWNS[f].board.x + 1; p.z = TOWNS[f].board.z + 1.5; };
let charSeq = 9000;
const fresh = (f = 1) => { const p = g.addPlayer(ws, `T${g.nextId}`, 'swordsman'); p.charId = ++charSeq; p.lvl = 10; p.testWard = true; atBoard(p, f); p.inv.mats = {}; g.events.length = 0; return p; };
const newCycle = f => { clock += 1000; g.electionOpen(f, g.townNow(), true); }; // (citizens from before it opened may take part)

await t('towns start as Camps with a project and an election with bot and Named candidates', () => {
  const all = g.townsAll();
  for (const f of TOWN_FLOORS) {
    const T = all[f];
    assert.equal(stageOf(T.xp), 0); assert.ok(projectOf(T.cur)); assert.ok(T.raidNext > clock + DAY * 0.9);
    assert.deepEqual(T.el.cands.map(c => c.key), BOT_CANDIDATES[f].map(c => c.key));
    assert.ok(T.el.cands.every(c => c.plat.length > 5));
  }
});

await t('join at the board only; the cooldown holds; a citizen pays less', () => {
  const p = fresh();
  p.x = 60; p.z = 60;
  assert.equal(act(p, { op: 'join', f: 1 }), false, 'away from the board');
  atBoard(p, 1);
  assert.equal(act(p, { op: 'join', f: 1 }), true);
  assert.equal(p.town.home, 1); assert.equal(g.town(1).citizens, 1);
  assert.ok(g.townsMsg(p).towns[0].mul < 1);
  atBoard(p, 2);
  assert.equal(act(p, { op: 'join', f: 2 }), false);
  assert.ok(sysTo(p).some(s => /move again/.test(s)));
  clock += COOLDOWN;
  assert.equal(act(p, { op: 'join', f: 2 }), true);
  assert.equal(g.town(1).citizens, 0); assert.equal(g.town(2).citizens, 1);
  assert.equal(townRecord(p).home, 2);
  // a merchant price: the town's multiplier
  p.x = MERCHANT.x; p.z = MERCHANT.z + 1;
  const s = SHOP.find(x => x.kind === 'cons');
  assert.equal(g.shopPrice(p, s, 100), 100, 'not a Floor 1 citizen any more');
});

await t('donate gold and materials: only what the project needs; it finishes and unlocks; XP to the town', () => {
  const p = fresh(), T = g.town(1), pr = projectOf(T.cur);
  act(p, { op: 'join', f: 1 });
  p.gold = 10_000;
  const mats = Object.fromEntries(Object.entries(pr.cost.mats).map(([k, v]) => [k, v + 5]));
  p.inv.mats = { ...mats };
  const xp0 = T.xp;
  act(p, { op: 'donate', f: 1, gold: 99_999, mats: { ...mats, nope: 4, __proto__: 3 } });
  assert.ok(T.done.includes(pr.id), 'built');
  assert.equal(p.gold, 10_000 - pr.cost.gold, 'only what it needed');
  for (const [k, v] of Object.entries(pr.cost.mats)) assert.equal(p.inv.mats[k], mats[k] - v);
  assert.ok(T.xp > xp0); assert.ok(g.unlocksOf(1)[pr.unlock]);
  assert.ok(g.events.some(e => e.t === 'townbuilt' && e.id === pr.id));
  assert.ok(T.el.contrib[g.townKey(p)] > 0 && p.town.given > 0);
  assert.equal(T.cur, '', 'the next projects need a Village');
  assert.equal(act(p, { op: 'donate', f: 1, gold: 5 }), false);
});

await t('town XP: players full, bots a share; a Village opens the next projects', () => {
  const T = g.town(1), p = fresh(), b = fresh();
  b.bot = true;
  const x0 = T.xp;
  g.townXp(1, 100, p); assert.equal(T.xp, x0 + 100);
  g.townXp(1, 100, b); assert.equal(T.xp, x0 + 100 + 100 * BOT_RATE);
  g.events.length = 0;
  g.townXp(1, STAGES[1].xp);
  assert.equal(stageOf(T.xp), 1);
  assert.ok(g.events.some(e => e.t === 'townup' && e.f === 1));
  assert.ok(projectOf(T.cur)?.stage <= 1);
  const m = g.addMob('boar', 0, 60), k0 = T.xp;
  g.killMob(m, p);
  assert.equal(T.xp, k0 + TXP.kill, 'a kill on Floor 1');
});

await t('bounties: kills on the floor count; claim at the board for gold and town XP', () => {
  const p = fresh(), f = 1, list = bountiesFor(f, Math.floor((clock - 10 * 3600e3) / DAY));
  assert.ok(g.unlocksOf(f).bounty);
  const b0 = list[0];
  for (let i = 0; i < b0.n; i++) g.bountyKill(p, { type: b0.mob }, f);
  const gold = p.gold, x0 = g.town(f).xp;
  assert.equal(act(p, { op: 'claim', f, i: 0 }), true);
  assert.equal(p.gold, gold + b0.gold); assert.ok(g.town(f).xp > x0);
  assert.equal(act(p, { op: 'claim', f, i: 0 }), false, 'once a day');
  assert.equal(act(p, { op: 'claim', f, i: 1 }), false, 'not done yet');
});

await t('Floor 1 election: citizens stand and vote (changeable); the vote picks a player Steward', () => {
  const T = g.town(1), a = fresh(), c = fresh(), out = fresh(), low = fresh(), anon = fresh(), late = fresh();
  low.lvl = 2; anon.charId = 0;
  for (const p of [a, c, low]) act(p, { op: 'join', f: 1 });
  assert.equal(act(anon, { op: 'join', f: 1 }), false, 'no citizenship without a saved character (a server with accounts)');
  assert.equal(act(a, { op: 'stand', f: 1, ag: 'trade' }), false, 'joined after this election opened');
  newCycle(1);
  act(late, { op: 'join', f: 1 });
  assert.equal(act(out, { op: 'stand', f: 1, ag: 'trade' }), false, 'only citizens stand');
  assert.equal(act(low, { op: 'stand', f: 1, ag: 'trade' }), false, 'a minimum level');
  assert.equal(act(late, { op: 'vote', f: 1, k: 'n:halvard' }), false, 'moved in after it opened: the next one');
  assert.equal(act(a, { op: 'stand', f: 1, ag: 'trade', plat: '  Lower <b>prices</b>\n now ' }), true);
  const me = T.el.cands.find(x => x.key === g.townKey(a));
  assert.equal(me.plat, 'Lower bprices/b now');
  assert.equal(act(out, { op: 'vote', f: 1, k: me.key }), false, 'only citizens vote');
  act(c, { op: 'vote', f: 1, k: 'n:halvard' });
  act(c, { op: 'vote', f: 1, k: me.key });
  act(a, { op: 'vote', f: 1, k: me.key });
  assert.equal(Object.values(T.el.votes).filter(k => k === me.key).length, 2, 'one vote each, changed');
  const n0 = T.el.n;
  g.electionClose(1);
  assert.equal(T.steward.key, me.key); assert.equal(T.steward.kind, 'player');
  assert.equal(T.last.how, 'vote'); assert.equal(T.el.n, n0 + 1, 'a new cycle opens');
  assert.equal(Object.keys(T.el.votes).length, 0);
  assert.equal(g.townsMsg(a).towns[0].steward.me, 1);
});

await t('the Steward: next project, tax within limits (to the treasury), a pinned message; nobody else', () => {
  const T = g.town(1), st = [...g.players.values()].find(p => g.townKey(p) === T.steward.key), other = fresh();
  atBoard(st, 1);
  assert.equal(act(other, { op: 'steward', f: 1, tax: 0.1 }), false);
  act(st, { op: 'steward', f: 1, tax: 0.5, msg: 'Bring ore to the board <3' });
  assert.equal(T.tax, TAX.max); assert.equal(T.msg, 'Bring ore to the board 3');
  const open = openProjects(1, stageOf(T.xp), T.done).filter(pr => pr.id !== T.cur);
  if (open.length) { T.given.gold = 40; const tr = T.treasury; act(st, { op: 'steward', f: 1, project: open[0].id }); assert.equal(T.cur, open[0].id); assert.equal(T.treasury, tr + 40, 'what was given is kept'); }
  const tr = T.treasury; g.townTaxOn(1, 200); assert.equal(T.treasury, tr + 20);
  st.x = MERCHANT.x; st.z = MERCHANT.z + 1;
  assert.equal(g.shopPrice(st, SHOP[0], 100), Math.round(100 * (1 + TAX.max - CITIZEN_DISCOUNT)));
  act(st, { op: 'steward', f: 1, tax: 0 });
});

await t('Floor 2 election: the biggest giver wins, whatever the votes', () => {
  const T = g.town(2), rich = fresh(2), loud = fresh(2);
  clock += COOLDOWN;
  for (const p of [rich, loud]) act(p, { op: 'join', f: 2 });
  newCycle(2);
  for (const p of [rich, loud]) act(p, { op: 'stand', f: 2, ag: 'build' });
  T.el.contrib[g.townKey(rich)] = 5000;
  act(loud, { op: 'vote', f: 2, k: g.townKey(loud) });
  g.electionClose(2);
  assert.equal(T.steward.key, g.townKey(rich)); assert.equal(T.last.how, 'contrib');
});

await t('Floor 3 election: a duel tournament between the candidates (on paper when nobody can fight)', () => {
  const T = g.town(3);
  g.electionClose(3, { paper: true });
  assert.ok(T.steward && BOT_CANDIDATES[3].some(c => c.key === T.steward.key));
  assert.equal(T.last.how, 'duel'); assert.equal(T.tour, null);
  // a bot Steward governs by its agenda at once
  assert.equal(T.tax, stewardTax(T.steward.ag)); assert.ok(T.msg);
});

await t('Floor 3 tournament: an online candidate fights; one who stays away loses by walkover', () => {
  const T = g.town(3), p = fresh(3);
  clock += COOLDOWN;
  act(p, { op: 'join', f: 3 }); newCycle(3); act(p, { op: 'stand', f: 3, ag: 'defend' });
  for (const c of T.el.cands) if (c.kind !== 'player') c.at = 1e15; // (the player is top seed: it meets a Named who isn't in the world)
  T.el.contrib[g.townKey(p)] = 900;
  g.electionClose(3);
  assert.ok(T.tour);
  // a restart mid-tournament: no stored duel is trusted, and the wait restarts on the wall clock
  const saved = cleanTown(3, { xp: T.xp, projects: {}, data: { el: T.el, tour: { ...T.tour, live: { id: 77 }, at: 5 } } }, clock);
  assert.equal(saved.tour.live, null); assert.equal(saved.tour.at, clock);
  clock += 1000; g.tourRun(T);
  const r0 = T.tour?.rounds[0] || [];
  assert.ok(!T.tour || r0.some(m => m.includes(g.townKey(p))));
  for (let i = 0; i < 6 && T.tour; i++) { clock += 200e3; g.tourRun(T); }
  assert.equal(T.tour, null);
  assert.equal(T.steward.key, g.townKey(p), 'walkovers: the only one who came');
});

await t('Floor 3 tournament: a candidate who withdraws (or moves away) loses by walkover', () => {
  const T = g.town(3), a = fresh(3), b = fresh(3);
  clock += COOLDOWN;
  for (const p of [a, b]) act(p, { op: 'join', f: 3 });
  newCycle(3);
  for (const p of [a, b]) act(p, { op: 'stand', f: 3, ag: 'build' });
  T.el.cands = T.el.cands.filter(c => c.kind === 'player');
  g.electionClose(3);
  assert.ok(T.tour);
  assert.equal(act(a, { op: 'stand', f: 3, ag: 'trade' }), false, 'no standing mid-tournament');
  act(b, { op: 'withdraw', f: 3 });
  g.tourRun(T);
  assert.equal(T.tour, null); assert.equal(T.steward.key, g.townKey(a));
});

await t('a Steward who moves to another town gives up the office (tax back to 0)', () => {
  const T = g.town(3), st = [...g.players.values()].find(p => g.townKey(p) === T.steward.key);
  T.tax = 0.08;
  clock += COOLDOWN; atBoard(st, 1);
  assert.equal(act(st, { op: 'join', f: 1 }), true);
  assert.equal(T.steward, null); assert.equal(T.tax, 0);
});

await t('donations: town XP keeps its fractions (no rounding a 1-gold gift up)', () => {
  const T = g.town(2), p = fresh(2);
  T.cur = PROJECTS[2].find(pr => !T.done.includes(pr.id) && pr.stage <= stageOf(T.xp))?.id || T.cur;
  if (!projectOf(T.cur)) { T.done = []; T.cur = PROJECTS[2][0].id; T.given = { gold: 0, mats: {} }; }
  p.gold = 100;
  const x0 = T.xp;
  for (let i = 0; i < 5; i++) act(p, { op: 'donate', f: 2, gold: 1 });
  assert.ok(Math.abs(T.xp - x0 - 5 / TXP.donate) < 1e-9, `${T.xp - x0}`);
});

await t('bot voters: seen long enough (or here at the close); per creator a capped number, one with the creator\'s weight', () => {
  const T = g.town(2), E = T.el;
  E.seen = {};
  for (let i = 0; i < 5; i++) E.seen[`b:Spam${i}`] = { lean: 'trade', creator: 'c42', t: 99999 };
  E.seen['b:Brief'] = { lean: 'trade', creator: 'c43', t: 5 };
  const voters = g.botVoters(T).filter(v => v.key.startsWith('b:'));
  assert.equal(voters.length, 2, 'two per creator; the brief visitor not at all');
  assert.deepEqual(voters.map(v => v.creator), ['c42', '']);
});

await t('saving: one flush at a time; a change made meanwhile is saved by the next', async () => {
  const saved = [];
  let release;
  g.townStore = { save: r => { saved.push(r.floor); return new Promise(res => { release = res; }); } };
  for (const T of Object.values(g.towns)) T.dirty = false;
  g.town(1).dirty = true;
  const a = g.townsFlush();
  g.town(1).dirty = true; // changed while the first write is in flight
  const b = g.townsFlush();
  assert.deepEqual(saved, [1]);
  release(); await new Promise(r => setTimeout(r, 0));
  release(); await a; await b;
  assert.deepEqual(saved, [1, 1]); assert.equal(g.town(1).dirty, false);
  g.townStore = null;
});

await t('the towns message: an open panel gets every change, others only what shows outside it', () => {
  const watcher = fresh(), idle = fresh();
  for (const T of Object.values(g.towns)) { if (T.raid) g.raidEnd(T, 'gone'); T.raidNext = clock + 30 * DAY; T.tour = null; T.el.closes = clock + 30 * DAY; }
  act(watcher, { op: 'state', watch: 1 });
  step(1.2);
  for (const p of [watcher, idle]) p.townsDirty = false;
  g.townChanged(g.town(2)); g.town(2).el.voted = 1; step(1.2);
  assert.equal(watcher.townsDirty, true); assert.equal(idle.townsDirty, false);
  watcher.townsDirty = false;
  g.townSetXp(2, STAGES[STAGE_MAX].xp); step(1.2);
  assert.equal(idle.townsDirty, true, 'a new stage shows to everyone');
  for (const p of [watcher, idle]) g.players.delete(p.id);
});

await t('raids: a warning, waves with telegraphs; an undefended ward falls and the town loses XP (bounded)', () => {
  const f = 1, T = g.town(f), p = fresh(f);
  p.x = 0; p.z = 0; // (in town: raiders don't target the player there, they march on the ward)
  g.townSetXp(f, STAGES[2].xp + 500);
  const xp0 = T.xp;
  g.events.length = 0;
  assert.ok(g.raidStart(f, { warn: 2 }));
  assert.equal(g.raidStart(f), false, 'one at a time');
  assert.ok(g.events.some(e => e.t === 'traid' && e.s === 'warn'));
  assert.equal(g.raidSnap()[0][1], 0, 'warning');
  step(6);
  assert.ok(g.events.some(e => e.t === 'traid' && e.s === 'tele' && e.pts.length >= RAID.perWave[0]));
  for (let i = 0; i < 400 && T.raid; i++) step(1);
  assert.equal(T.raid, null, 'over');
  assert.equal(T.raidLast.won, false);
  assert.ok(T.xp < xp0 && T.xp >= STAGES[1].xp, 'lost XP, at most a stage');
  assert.ok(![...g.mobs.values()].some(m => m.raid), 'raiders gone');
  assert.ok(T.raidNext - clock >= RAID.every[0] * DAY - 1);
});

await t('raids: beaten, the town gains XP; none during a director show; none when nobody is on the floor', () => {
  const f = 2, T = g.town(f), p = fresh(f);
  p.x = 600; p.z = 0;
  g.raidStart(f, { warn: 0 }); step(1.2);
  const xp0 = T.xp;
  g.raidEnd(T, 'won');
  assert.ok(T.xp > xp0 && T.raidLast.won);
  g.director = { running: true };
  assert.equal(g.raidStart(f), false);
  g.director = null;
  // nobody on Floor 3: due, but it waits
  for (const q of g.players.values()) if (q.x > 900) q.x = 0;
  g.town(3).raidNext = 0; step(1.2);
  assert.ok(!g.town(3).raid);
});

await t('free bots on the floor hold the ward during a raid and are released after', () => {
  const cmds = [], b = fresh(1);
  b.bot = true; b.x = 3; b.z = 3;
  const e = { b: { command: c => cmds.push(c.k), closed: false }, director: false };
  g.botMgr = { bots: [e], livePlayer: () => b, entryOf: () => e };
  g.raidStart(1, { warn: 0 }); step(1.2);
  assert.deepEqual(cmds, ['defend']);
  g.raidEnd(g.town(1), 'gone');
  assert.deepEqual(cmds, ['defend', 'release']);
  g.botMgr = null; g.players.delete(b.id);
});

await t('time passes with nobody around: a slow trickle, and the election closes by itself', () => {
  const T = g.town(2), xp0 = T.xp, n0 = T.el.n;
  clock = T.el.closes + 1000; step(1.2);
  assert.ok(T.xp > xp0, 'the quiet trickle');
  assert.equal(T.el.n, n0 + 1);
});

await t('records survive cleaning; junk falls back to fresh values', () => {
  const T = cleanTown(1, { xp: 2000, treasury: 5, projects: { done: ['f1bounty', 'nope'], cur: 'f1stock', given: { gold: 3, mats: { copper: 2, zz: 9 } } }, data: { tax: 9, msg: '<x>', steward: { key: 'c1', name: 'A', kind: 'player', ag: 'trade' } } }, clock);
  assert.deepEqual(T.done, ['f1bounty']); assert.equal(T.cur, 'f1stock'); assert.deepEqual(T.given, { gold: 3, mats: { copper: 2 } });
  assert.equal(T.tax, TAX.max); assert.equal(T.msg, 'x'); assert.equal(T.steward.name, 'A');
  assert.equal(cleanTown(2, null, clock).xp, 0);
});

// ---------- 3. a real server with a database ----------
const DB = process.env.DATABASE_URL;
if (!DB) { console.log(`${n} town tests passed (DB part skipped: set DATABASE_URL)`); process.exit(0); }
const { default: WebSocket } = await import('ws');
const { default: pg } = await import('pg');
const PORT = Number(process.env.PORT) || 3361;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(40); }
  throw new Error(`timed out waiting for ${what}`);
}
function start() {
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), TEST_HOOKS: '1', MAX_BOTS: '0', NAMED_ENABLED: '0', TOWN_RAIDS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; }); srv.stderr.on('data', d => { srv.log += d; });
  srv.done = new Promise(r => srv.on('exit', r));
  return srv;
}
const call = async (method, p, token, body) => {
  const r = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
function client(join) {
  const c = { last: {}, sys: [] };
  c.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  c.ws.on('open', () => c.ws.send(JSON.stringify(join)));
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    c.last[m.type] = m;
    if (m.type === 'welcome') { c.id = m.id; c.ws.send(JSON.stringify({ type: 'test', ward: 1 })); }
    if (m.type === 'snap') { c.me = m.me; for (const e of m.w.events) if (e.t === 'sys' && (e.to === c.id || e.to == null)) c.sys.push(e.text); }
  });
  c.send = o => c.ws.send(JSON.stringify(o));
  c.closed = new Promise(r => c.ws.on('close', r));
  return c;
}
if (/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { const pool = new pg.Pool({ connectionString: DB }); await pool.query('DELETE FROM towns').catch(() => {}); await pool.end(); } // (fresh towns; a local test database only)
let srv = start();
try {
  await until(() => /running on/.test(srv.log), 15000, 'server start');
  const tok = (await call('POST', '/api/guest')).token;
  const ch = (await call('POST', '/api/characters', tok, { name: `Town${Math.random().toString(36).slice(2, 7)}`, cls: 'guardian' })).character;
  assert.ok(ch?.id, 'character made');
  { const pool = new pg.Pool({ connectionString: DB }); await pool.query('UPDATE characters SET gold = 2000, lvl = 6 WHERE id = $1', [ch.id]); await pool.end(); }
  let c = client({ type: 'join', session: tok, character: ch.id });
  globalThis.lastSys = () => c.sys.slice(-8).join(' / ');
  await until(() => c.last.towns, 8000, 'towns message on join');
  const town = f => c.last.towns.towns.find(x => x.f === f);
  const B = TOWNS[1].board;
  c.send({ type: 'test', life: { tp: [B.x + 1, B.z + 1.5] } }); await sleep(250);
  c.send({ type: 'town', op: 'join', f: 1 });
  await until(() => c.last.towns.me.home === 1, 4000, 'joined');
  const pr = projectOf(town(1).cur.id);
  c.send({ type: 'test', town: { mats: pr.cost.mats } }); await sleep(250);
  c.send({ type: 'town', op: 'donate', f: 1, gold: pr.cost.gold, mats: pr.cost.mats });
  await until(() => town(1).done.includes(pr.id), 4000, 'project built');
  await sleep(200);
  c.send({ type: 'town', op: 'stand', f: 1, ag: 'defend' }); await sleep(300);
  assert.ok(!town(1).el.cands.some(x => x.me) && /after this election opened/.test(town(1).why), 'new citizens wait for the next election');
  c.send({ type: 'test', town: { close: 1 } }); // (a new cycle: now a citizen from before it opened)
  await until(() => !town(1).why, 4000, 'eligible in the new cycle');
  c.send({ type: 'town', op: 'stand', f: 1, ag: 'defend', plat: 'Hold the ward.' });
  await until(() => town(1).el.cands.some(x => x.me), 4000, 'standing');
  await sleep(200);
  c.send({ type: 'town', op: 'vote', f: 1, k: town(1).el.cands.find(x => x.me).k });
  await until(() => town(1).el.my, 4000, 'voted');
  c.send({ type: 'test', town: { close: 1 } });
  await until(() => town(1).steward?.me, 4000, 'elected');
  c.send({ type: 'test', town: { raid: 1 } });
  await until(() => c.last.snap?.w?.tr?.length, 4000, 'raid on');
  const xp0 = town(1).xp;
  c.send({ type: 'test', town: { raidEnd: [1, 1] } });
  await until(() => town(1).raid.last?.won && town(1).xp > xp0, 4000, 'raid won');
  const before = town(1);
  // restart: the town, the citizen and the Steward come back
  c.ws.close(); await c.closed; await sleep(400);
  srv.kill('SIGTERM'); await srv.done;
  srv = start();
  await until(() => /running on/.test(srv.log), 15000, 'server restart');
  c = client({ type: 'join', session: tok, character: ch.id });
  await until(() => c.last.towns, 8000, 'towns after restart');
  const after = town(1);
  assert.equal(c.last.towns.me.home, 1);
  assert.ok(c.last.towns.me.move > 0, 'the move cooldown is kept');
  assert.ok(after.done.includes(pr.id));
  assert.equal(after.steward?.me, 1); assert.equal(after.steward.name, ch.name);
  assert.ok(Math.abs(after.xp - before.xp) <= 2, `XP kept (${before.xp} -> ${after.xp})`);
  assert.ok(after.raid.last?.won, 'the last raid is remembered');
  assert.equal(after.last.how, 'vote');
  assert.ok(after.cit.players >= 1, 'citizens counted from the characters');
  c.ws.close(); await c.closed;
  n++; console.log('ok DB: join, donate, stand, vote, elected, a raid won; a restart keeps it all');
} catch (e) {
  console.log(srv.log.slice(-3000));
  console.log('sys:', globalThis.lastSys?.());
  throw e;
} finally {
  srv.kill('SIGTERM'); await srv.done;
}
console.log(`${n} town tests passed`);
process.exit(0);
