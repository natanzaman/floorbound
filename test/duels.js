// Duels (docs/briefs/duels.md; server/duels.js, shared/duels.js), in process: challenge / accept / decline, the
// countdown, stand-ins only opponents can hit, each rule (First Strike, Half Health, Last Stand), nobody dies, health
// back at the end, the ring, yielding, healing from outside, team duels (every party member, lined up), a bot
// accepting by itself, town duels, the clock, chat commands, and the snapshot rows.
// Usage: node test/duels.js
import { Game } from '../server/game.js';
import { MOBS, MOB_IDS, inTown, WORLD } from '../shared/data.js';
import { DUEL, DUEL_RULES, decideOnTime, parseDuelChat, readDuels, foeMobs } from '../shared/duels.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }

const fresh = () => { const g = new Game(); g.track = () => {}; return g; };
const add = (g, name, cls = 'swordsman', x = 0, z = 60, lvl = 10) => {
  const p = g.addPlayer({ readyState: 1, send() {} }, name, cls);
  p.lvl = lvl; g.recompute(p); p.hp = p.maxHp; g.teleport(p, x, z); p.face = 0;
  return p;
};
const run = (g, secs) => { for (let i = 0; i < Math.round(secs * 20); i++) g.update(0.05); };
const sysTo = (g, p) => g.events.filter(e => e.t === 'sys' && e.to === p.id).map(e => e.text);
const proxyOf = (g, p) => [...g.mobs.values()].find(m => m.def.duel && m.duelOf === p.id);
const start = (g, a, b, rule = 'half', team = false) => { g.duelAsk(a, { id: b.id, rule, team }); return g.duelAccept(b); };
const clearMobs = g => { for (const m of [...g.mobs.values()]) if (!m.def.duel) g.mobs.delete(m.id); g.boss = null; };

// ---------- data ----------
ok(MOB_IDS.includes('duelist') && MOBS.duelist.duel, 'the duelist stand-in is a mob type, appended last');
ok(decideOnTime([[{ hp: 5, maxHp: 10, out: false }], [{ hp: 9, maxHp: 10, out: true }]]) === 0, 'on time: more fighters still in wins');
ok(decideOnTime([[{ hp: 5, maxHp: 10 }], [{ hp: 8, maxHp: 10 }]]) === 1, 'on time: level numbers, more health left wins');
ok(decideOnTime([[{ hp: 5, maxHp: 10 }], [{ hp: 5, maxHp: 10 }]]) === -1, 'on time: dead level is a draw');
ok(parseDuelChat('/duel Lyra team last')?.name === 'Lyra' && parseDuelChat('/duel Lyra team last').team && parseDuelChat('/duel Lyra team last').rule === 'last', 'chat: /duel <name> team last');
ok(parseDuelChat('/duel accept').op === 'accept' && parseDuelChat('/yield').op === 'yield' && parseDuelChat('/duel').op === 'help' && parseDuelChat('hello') === null, 'chat: accept, yield, help, plain chat');

// ---------- solo, Half Health ----------
{
  const g = fresh(); clearMobs(g);
  const a = add(g, 'Ann', 'swordsman', 0, 60), b = add(g, 'Bo', 'swordsman', 0, 64), c = add(g, 'Cy', 'swordsman', 3, 62);
  ok(!g.duelAsk(a, { id: a.id }), 'no duelling yourself');
  ok(g.duelAsk(a, { id: b.id, rule: 'half' }) && b.duelAsk?.from === a.id, 'a challenge waits on the other player');
  ok(g.events.some(e => e.t === 'duelask' && e.to === b.id), 'the challenged player gets a duelask event');
  ok(g.duelDecline(b) && !b.duelAsk && sysTo(g, a).some(t => /declined/.test(t)), 'decline tells the challenger');
  const d = start(g, a, b, 'half');
  ok(d && a.duel === d.id && b.duel === d.id && d.state === 'count', 'accepted: a countdown starts');
  ok(!proxyOf(g, b), 'no stand-ins during the countdown');
  const hp0 = b.hp;
  g.useSkill(a, 0, 0); // a swing at b during the countdown
  ok(b.hp === hp0, 'nothing lands before FIGHT');
  run(g, DUEL.count + 0.1);
  ok(d.state === 'live' && proxyOf(g, b) && proxyOf(g, a), 'FIGHT: each fighter carries a stand-in');
  const pb = proxyOf(g, b);
  ok(Math.hypot(pb.x - b.x, pb.z - b.z) < 0.01, 'the stand-in sits on its player');
  // a bystander's attack does nothing to a duellist
  c.face = Math.atan2(b.x - c.x, b.z - c.z);
  g.damageMob(pb, c, 50, {});
  ok(b.hp === hp0, 'a bystander can\'t hurt a duellist');
  g._duelAtk = c; ok(!g.targetable(pb), 'a bystander\'s skill can\'t target a duellist\'s stand-in'); g._duelAtk = a; ok(g.targetable(pb), 'an opponent\'s can'); g._duelAtk = null;
  // a real swing from a reaches b's stand-in
  a.face = Math.atan2(b.x - a.x, b.z - a.z); g.teleport(a, b.x, b.z - 2); run(g, 0.05);
  a.cds[0] = 0; g.useSkill(a, 0, a.face);
  ok(b.hp < hp0, `a basic swing hurts the opponent (${hp0} → ${b.hp})`);
  ok(g.events.some(e => e.t === 'hit' && e.id === pb.id && e.du && e.by === a.id), 'a hit event on the stand-in, from the attacker');
  // pound b to half
  for (let i = 0; i < 200 && d.state !== 'done'; i++) g.damageMob(proxyOf(g, b) || pb, a, 40, {});
  ok(d.state === 'done' && d.won === 0, 'Half Health: b out at half, a wins');
  ok(!b.dead && b.hp >= hp0, `nobody dies, and b gets their health back (${b.hp}/${b.maxHp})`);
  ok(!a.duel && !b.duel && !proxyOf(g, a) && !proxyOf(g, b), 'stand-ins gone, both free');
  ok((a.stats.duelWins | 0) === 1 && (b.stats.duels | 0) === 1, 'stats: duels and duel wins');
  ok(g.events.some(e => e.t === 'sys' && !e.to && /Ann won a duel against Bo \(Half Health\)/.test(e.text)), 'the result is announced to everyone');
  const rows = readDuels(JSON.parse(g.snapshot()).du);
  ok(rows.length === 1 && rows[0].state === 2 && rows[0].won === 0, 'the snapshot keeps the result a moment (w.du)');
  run(g, DUEL.linger + 0.2);
  ok(!JSON.parse(g.snapshot()).du, 'then it\'s gone');
}

// ---------- First Strike, Last Stand ----------
for (const rule of ['first', 'last']) {
  const g = fresh(); clearMobs(g);
  const a = add(g, 'Ann', 'swordsman', 0, 60), b = add(g, 'Bo', 'guardian', 0, 63);
  const d = start(g, a, b, rule);
  run(g, DUEL.count + 0.1);
  let hits = 0;
  for (; hits < 400 && d.state !== 'done'; hits++) g.damageMob(proxyOf(g, b), a, 30, {});
  ok(d.won === 0, `${DUEL_RULES[rule].name}: a wins`);
  if (rule === 'first') ok(hits === 1, 'First Strike: one clean hit is enough');
  else ok(hits > 3, `Last Stand: down to 1 health first (${hits} hits)`);
  ok(!b.dead, `${DUEL_RULES[rule].name}: nobody dies`);
}

// ---------- dodges count for nothing in First Strike ----------
{
  const g = fresh(); clearMobs(g);
  const a = add(g, 'Ann', 'swordsman', 0, 60), b = add(g, 'Bo', 'swordsman', 0, 63);
  const d = start(g, a, b, 'first');
  run(g, DUEL.count + 0.1);
  g.dodge(b, 0);
  g.damageMob(proxyOf(g, b), a, 30, {});
  ok(d.state === 'live' && b.hp === b.maxHp, 'a dodged hit doesn\'t count');
}

// ---------- the ring, yielding, outside healing, town ----------
{
  const g = fresh(); clearMobs(g);
  const a = add(g, 'Ann', 'swordsman', 0, 60), b = add(g, 'Bo', 'cleric', 0, 63), c = add(g, 'Cy', 'cleric', 2, 62);
  let d = start(g, a, b, 'half');
  run(g, DUEL.count + 0.1);
  g.damageMob(proxyOf(g, a), b, 20, {});
  const hpA = a.hp;
  g.healPlayer(a, 50, c);
  ok(a.hp === hpA, 'a bystander can\'t heal a duellist');
  g.teleport(b, 0, 63 + d.r + 5);
  run(g, DUEL.grace + 0.2);
  ok(d.state === 'done' && d.won === 0, 'out of the ring too long: forfeit');
  d = start(g, a, b, 'half');
  run(g, DUEL.count + 0.1);
  ok(g.duelYield(a) && d.state === 'done' && d.won === 1, '/yield gives the duel away');
  // a duel in town: hits land, no town regeneration while it's on
  const T = WORLD.town;
  g.teleport(a, T.x, T.z + 2); g.teleport(b, T.x + 2, T.z + 2); run(g, 0.05);
  ok(inTown(a.x, a.z), '(both in town)');
  d = start(g, a, b, 'last');
  run(g, DUEL.count + 0.1);
  g.damageMob(proxyOf(g, b), a, 40, {});
  const hit = b.hp;
  ok(hit < b.maxHp, 'duel hits land in town');
  run(g, 2);
  ok(b.hp === hit, 'no town regeneration mid-duel');
}

// ---------- team duel ----------
{
  const g = fresh(); clearMobs(g);
  const a1 = add(g, 'A1', 'swordsman', 0, 60), a2 = add(g, 'A2', 'cleric', -40, 90), b1 = add(g, 'B1', 'guardian', 0, 66), b2 = add(g, 'B2', 'ranger', 1, 67), x = add(g, 'X', 'swordsman', 5, 62);
  g.invite(a1, a2.id); g.accept(a2, a1.id); g.invite(b1, b2.id); g.accept(b2, b1.id);
  ok(a1.party && a1.party === a2.party && b1.party === b2.party && a1.party !== b1.party, '(two parties)');
  ok(!g.duelAsk(a1, { id: a2.id, team: true }), 'no team duel inside one party');
  const d = start(g, a1, b1, 'half', true);
  ok(d && d.team && d.f.size === 4 && !d.f.has(x.id), 'team duel: both whole parties, nobody else');
  ok(Math.hypot(a2.x - d.x, a2.z - d.z) < d.r, 'a far party member is lined up inside the ring');
  run(g, DUEL.count + 0.1);
  g.damageMob(proxyOf(g, a2), a1, 30, {});
  ok(a2.hp === a2.maxHp, 'no hitting your own side');
  for (let i = 0; i < 300 && d.state !== 'done'; i++) { g.damageMob(proxyOf(g, b1), a1, 30, {}); g.damageMob(proxyOf(g, b2), a2, 30, {}); }
  ok(d.won === 0, 'side A wins when both of B are out');
}

// ---------- a bot accepts by itself; chat commands ----------
{
  const g = fresh(); clearMobs(g);
  const a = add(g, 'Ann', 'swordsman', 0, 60), bot = add(g, 'Botty', 'berserker', 0, 63);
  bot.bot = true;
  g.handle(a, { type: 'chat', text: '/duel bott first' });
  ok(bot.duelAsk?.rule === 'first', 'chat /duel by name start (case-insensitive), with a rule');
  ok(!g.events.some(e => e.t === 'chat' && /\/duel/.test(e.text || '')), 'the command never shows as chat');
  run(g, DUEL.botAnswer[1] + 0.2);
  ok(g.duelOf(bot)?.state === 'count' || g.duelOf(bot)?.state === 'live', 'the bot accepted by itself');
  const rows = readDuels(JSON.parse(g.snapshot()).du);
  run(g, DUEL.count);
  const live = readDuels(JSON.parse(g.snapshot()).du);
  ok(foeMobs(live, bot.id).has(proxyOf(g, a)?.id) && !foeMobs(live, bot.id).has(proxyOf(g, bot)?.id), 'foeMobs: the bot sees only its opponent\'s stand-in');
  ok(rows.length === 1 && foeMobs(rows, a.id).size === 0, 'no foes during the countdown');
}

// ---------- the clock ----------
{
  const g = fresh(); clearMobs(g);
  const a = add(g, 'Ann', 'swordsman', 0, 60), b = add(g, 'Bo', 'swordsman', 0, 63);
  const d = start(g, a, b, 'last');
  run(g, DUEL.count + 0.1);
  g.damageMob(proxyOf(g, b), a, 20, {});
  d.endAt = g.time + 0.1;
  run(g, 0.3);
  ok(d.state === 'done' && d.won === 0, 'time: more health left wins');
}

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
