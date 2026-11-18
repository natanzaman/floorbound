// In-process checks for the boss team mechanics (server/bossteam.js, docs/ROADMAP.md G4): the shared meteor's damage
// split, spread overlap, tether break distance, solo fights unchanged, film safety, forceBossMove's new moves, the
// teamStat 'mechanic' key, the Sovereign, and where bots go (shared/bots/bossteam.js).
// Usage: node test/bossteam.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WORLD } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { BOSSTEAM } from '../shared/bossteam.js';
import { parseSheet, validateSheet } from '../server/director-sheet.js';
import { mechSpot } from '../shared/bots/bossteam.js';
import { runHooks } from '../shared/bots/registry.js';
import { perceive } from '../shared/botskill.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const newGame = () => { const l = console.log; console.log = () => {}; try { return new Game(); } finally { console.log = l; } };
const A = WORLD.arena;

function setup(classes = ['guardian', 'swordsman', 'cleric']) {
  const g = newGame();
  g.twistW = null; g.twist = null;
  const W = g.boss;
  W.x = A.x; W.z = A.z + 6; W.engaged = true; W.phase = 0;
  g.fight = { start: 0, ids: new Set(), deaths: 0, hp: W.maxHp };
  const ps = classes.map((c, i) => {
    const p = g.addPlayer(null, `P${i}`, c);
    p.lvl = 10; g.recompute(p); p.hp = p.maxHp; p.x = A.x + i * 8 - 8; p.z = A.z - 4;
    W.threat.set(p.id, 1); g.fight.ids.add(p.id);
    return p;
  });
  const stats = [];
  g.teamStat = (p, key, k = 1) => stats.push([p.id, key, k]);
  g.time = 20; g.events = [];
  return { g, W, ps, stats };
}
function advance(g, dt) { // time + scheduled callbacks only (no AI, nobody moves)
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
  }
}
const lost = p => 1 - p.hp / p.maxHp;
const full = ps => { for (const p of ps) { p.hp = p.maxHp; p.dead = false; p.iframeUntil = 0; } };
const take = (g, t, k) => { const out = g.events.filter(e => e.t === t && (!k || e.k === k)); return out; };

// ---------- shared meteor: damage split ----------
{
  const { g, W, ps, stats } = setup(['swordsman', 'swordsman', 'swordsman', 'swordsman']);
  const M = BOSSTEAM.meteor;
  // alone: the other three stand far away
  ps.forEach((p, i) => { p.x = A.x + (i ? 12 : 0) * (i % 2 ? 1 : -1); p.z = A.z - 4 + (i > 2 ? 10 : 0); });
  W.slamT = g.time + 1; W.chargeT = g.time + 2; W.quakeT = g.time + 1;
  assert.equal(g.forceBossMove(W, 'meteor', ps[0].id), true);
  assert.ok(W.slamT >= g.time + M.wind && W.chargeT >= g.time + M.wind, 'the Warden channels it: slams and charges wait');
  assert.equal(W.quakeT, g.time + 1, 'Quake Rings go on');
  const st = take(g, 'bt', 'stack')[0];
  assert.ok(st && st.id === ps[0].id && st.r === M.r && st.d === M.wind, 'STACK marker on the target');
  advance(g, M.wind + 0.1);
  const soloLoss = lost(ps[0]);
  assert.ok(soloLoss > 0.75, `alone: near-lethal (${(soloLoss * 100).toFixed(0)}%)`);
  assert.ok(ps.slice(1).every(p => p.hp === p.maxHp), 'nobody else hit');
  assert.equal(take(g, 'btend', 'stack')[0].n, 1);
  assert.equal(stats.length, 0, 'no mechanic credit for a solo soak');

  // three in the circle: light; the fourth outside takes nothing
  full(ps); g.events = [];
  ps[0].x = A.x; ps[0].z = A.z; ps[1].x = A.x + 1.5; ps[1].z = A.z; ps[2].x = A.x; ps[2].z = A.z + 2; ps[3].x = A.x + 10; ps[3].z = A.z;
  g.forceBossMove(W, 'meteor', ps[0].id);
  ps[2].iframeUntil = g.time + 99; // rolling doesn't dodge it
  advance(g, M.wind + 0.1);
  const per = M.total / Math.pow(3, M.split);
  for (const p of ps.slice(0, 3)) assert.ok(Math.abs(lost(p) - per) < 0.05, `3 stacked: ~${(per * 100).toFixed(0)}% each (got ${(lost(p) * 100).toFixed(0)}%)`);
  assert.ok(ps[3].hp === ps[3].maxHp, 'outside: nothing');
  assert.equal(take(g, 'btend', 'stack')[0].n, 3);
  assert.equal(stats.filter(s => s[1] === 'mechanic').length, 3, 'teamStat mechanic for each stacker');
  assert.ok(ps[2].iframeUntil > g.time, 'i-frames restored afterwards');
  ok(`meteor: alone ${(soloLoss * 100).toFixed(0)}% of max HP, three stacked ~${(per * 100).toFixed(0)}% each; i-frames don't dodge it; the boss channels it`);

  // the circle follows its carrier until it lands
  full(ps); g.events = [];
  g.forceBossMove(W, 'meteor', ps[3].id);
  advance(g, M.wind - 1);
  ps[3].x = A.x - 10; ps[3].z = A.z + 5; // walks off
  advance(g, 1.1);
  const end = take(g, 'btend', 'stack')[0];
  assert.ok(Math.abs(end.x - ps[3].x) < 0.01 && Math.abs(end.z - ps[3].z) < 0.01, 'lands where the carrier is');
  ok('meteor: the circle follows its carrier');
}

// ---------- spread: overlap ----------
{
  const { g, W, ps, stats } = setup(['ranger', 'swordsman', 'cleric', 'berserker']);
  const S = BOSSTEAM.spread;
  // two carriers 3 m apart (overlapping), a bystander inside one, one player far away
  ps[0].x = A.x; ps[0].z = A.z; ps[1].x = A.x + 3; ps[1].z = A.z; ps[2].x = A.x - 4; ps[2].z = A.z; ps[3].x = A.x; ps[3].z = A.z - 15;
  assert.equal(g.btSpread(W, [ps[0], ps[1]]), true);
  const sp = take(g, 'bt', 'spread')[0];
  assert.deepEqual(sp.ids, [ps[0].id, ps[1].id]); assert.equal(sp.r, S.r);
  advance(g, S.wind + 0.1);
  const e = take(g, 'btend', 'spread')[0];
  assert.deepEqual(e.clean, [], 'nobody clean');
  assert.ok(Math.abs(lost(ps[0]) - (S.hit + S.self)) < 0.06, `carrier caught by the other carrier (${(lost(ps[0]) * 100).toFixed(0)}%)`);
  assert.ok(Math.abs(lost(ps[1]) - (S.hit + S.self)) < 0.06);
  assert.ok(Math.abs(lost(ps[2]) - S.hit) < 0.05, 'bystander inside one burst');
  assert.equal(ps[3].hp, ps[3].maxHp, 'far away: untouched');
  assert.equal(stats.length, 0);

  // spread out properly: carriers only take their own small hit, both credited
  full(ps); g.events = [];
  ps[0].x = A.x - 10; ps[0].z = A.z; ps[1].x = A.x + 10; ps[1].z = A.z; ps[2].x = A.x; ps[2].z = A.z - 10; ps[3].x = A.x; ps[3].z = A.z + 10;
  g.btSpread(W, [ps[0], ps[1]]);
  advance(g, S.wind + 0.1);
  assert.deepEqual(take(g, 'btend', 'spread')[0].clean.sort(), [ps[0].id, ps[1].id].sort());
  assert.ok(lost(ps[0]) < S.self + 0.03 && lost(ps[0]) > 0, 'carrier: its own small hit');
  assert.ok(ps[2].hp === ps[2].maxHp && ps[3].hp === ps[3].maxHp);
  assert.equal(stats.filter(s => s[1] === 'mechanic').length, 2);
  ok('spread: overlapping carriers and bystanders get hit; spread out = only the small self hit, credited');

  // marker count by party size
  full(ps); g.events = [];
  g.forceBossMove(W, 'spread', ps[2].id);
  const s2 = take(g, 'bt', 'spread')[0];
  assert.equal(s2.ids.length, 2); assert.equal(s2.ids[0], ps[2].id, 'forced target carries the first marker');
  assert.equal(S.n(6), 3);
  advance(g, S.wind + 0.1);
  ok('spread: 2 markers (3 with 5+ fighters), forced target first');
}

// ---------- tether: break distance ----------
{
  const { g, W, ps, stats } = setup(['ranger', 'cleric']);
  const T = BOSSTEAM.tether;
  ps[0].x = A.x; ps[0].z = A.z; ps[1].x = A.x + 4; ps[1].z = A.z;
  assert.equal(g.forceBossMove(W, 'tether', ps[0].id), true);
  const te = take(g, 'bt', 'tether')[0];
  assert.deepEqual([te.a, te.b], [ps[0].id, ps[1].id]); assert.equal(te.need, T.need);
  advance(g, T.grace - 0.2);
  assert.ok(ps.every(p => p.hp === p.maxHp), 'grace: no damage yet');
  advance(g, 2);
  const mid = ps.map(lost);
  assert.ok(mid.every(l => l > 0.05), 'ticks while close');
  ps[1].x = A.x + T.need - 0.5; advance(g, 1);
  assert.equal(take(g, 'btend', 'tether').length, 0, `${T.need - 0.5} m: still linked`);
  ps[1].x = A.x + T.need + 0.1; advance(g, T.tick + 0.05);
  const end = take(g, 'btend', 'tether')[0];
  assert.ok(end && end.ok === 1, `broken at >= ${T.need} m`);
  const after = ps.map(p => p.hp); advance(g, 3);
  assert.deepEqual(ps.map(p => p.hp), after, 'no damage after it breaks');
  assert.equal(stats.filter(s => s[1] === 'mechanic').length, 2, 'both ends credited');

  full(ps); g.events = []; stats.length = 0; ps[1].x = A.x + 3;
  g.forceBossMove(W, 'tether', ps[1].id);
  advance(g, T.max + 0.3);
  const fail = take(g, 'btend', 'tether')[0];
  assert.ok(fail && fail.ok === 0, 'never broken: ends after its max');
  assert.ok(ps.every(p => lost(p) > 0.5), 'and hurt a lot');
  assert.equal(stats.length, 0);
  ok(`tether: ticks after ${T.grace} s, breaks at ${T.need} m (both credited), ends unbroken after ${T.max} s`);
}

// ---------- solo unchanged; rotation; film safety ----------
{
  const { g, W, ps } = setup(['swordsman']);
  for (let i = 0; i < 200 * 20; i++) { g.time += 0.05; g.bossTeam(W, g.btFighters(W)); } // 200 s of rotation, one fighter
  assert.equal(take(g, 'bt').length, 0, 'solo: no team mechanics');
  assert.equal(g.forceBossMove(W, 'tether', ps[0].id), false, 'a tether needs two');
  ok('solo fights: no team mechanics (and no solo tether)');

  const { g: g2, W: W2 } = setup(['guardian', 'ranger']);
  let firstAt = null;
  for (let i = 0; i < 120 * 20; i++) {
    g2.time += 0.05; g2.bossTeam(W2, g2.btFighters(W2)); advance(g2, 0);
    const due = g2.scheduled.filter(s => s.at <= g2.time); g2.scheduled = g2.scheduled.filter(s => s.at > g2.time); for (const s of due) s.fn();
    if (firstAt === null && take(g2, 'bt').length) firstAt = g2.time - 20;
    for (const p of g2.players.values()) { p.hp = p.maxHp; p.dead = false; }
  }
  const kinds = take(g2, 'bt').map(e => e.k);
  assert.ok(Math.abs(firstAt - BOSSTEAM.warden.first) < 0.2, `first after ${BOSSTEAM.warden.first} s (got ${firstAt})`);
  assert.ok(kinds.length >= 4 && kinds.every(k => k === 'stack' || k === 'spread'), `phase 1: stack / spread only (${kinds.join(',')})`);
  ok(`duo: first team mechanic ${firstAt.toFixed(1)} s in, then every ~${BOSSTEAM.warden.every[0]} s (${kinds.join(', ')})`);

  W2.phase = 2; g2.events = [];
  for (let i = 0; i < 80 * 20; i++) {
    g2.time += 0.05; g2.bossTeam(W2, g2.btFighters(W2));
    const due = g2.scheduled.filter(s => s.at <= g2.time); g2.scheduled = g2.scheduled.filter(s => s.at > g2.time); for (const s of due) s.fn();
    for (const p of g2.players.values()) { p.hp = p.maxHp; p.dead = false; }
  }
  assert.ok(take(g2, 'bt', 'tether').length >= 1, 'phase 3 adds tethers');
  ok('phase 3: tethers in the mix');

  g2.director = { running: true }; g2.events = [];
  for (let i = 0; i < 80 * 20; i++) { g2.time += 0.05; g2.bossTeam(W2, g2.btFighters(W2)); }
  assert.equal(take(g2, 'bt').length, 0, 'none during a show');
  assert.equal(g2.forceBossMove(W2, 'meteor'), true, 'a cue can still force one');
  ok('director show: no natural team mechanics; forceBossMove still starts one');

  // a wipe (new fight) cancels what's pending
  g2.director = null; g2.events = [];
  g2.forceBossMove(W2, 'spread');
  g2.fight = { start: g2.time, ids: new Set(), deaths: 0 };
  const hp = [...g2.players.values()].map(p => p.hp);
  advance(g2, BOSSTEAM.spread.wind + 0.2);
  assert.deepEqual([...g2.players.values()].map(p => p.hp), hp, 'stale mechanic does nothing');
  assert.ok(take(g2, 'btend', 'spread').some(e => e.off), 'and tells clients to clear it');
  ok('a reset fight cancels pending mechanics');
}

// ---------- the Sovereign ----------
{
  const g = newGame();
  const S = g.sovereign, a = g.addPlayer(null, 'Juno', 'ranger'), b = g.addPlayer(null, 'Ivo', 'cleric');
  for (const [p, dx] of [[a, -2], [b, 2]]) { p.x = F2.arena.x + dx; p.z = F2.arena.z - 6; S.threat.set(p.id, 1); }
  S.engaged = true; g.fight2 = { start: 0, ids: new Set([a.id, b.id]), deaths: 0 };
  g.time = 30; g.events = [];
  for (const mv of ['meteor', 'spread', 'tether']) assert.equal(g.forceBossMove(S, mv, a.id), true, mv);
  assert.equal(take(g, 'bt').length, 3);
  advance(g, 6);
  assert.ok(a.hp < a.maxHp, 'lands on Floor 2');
  ok('Sovereign: meteor, spread, tether');
}

// ---------- director sheets accept the new moves ----------
{
  const sheet = parseSheet(`title: t\ncast: [{ id: a, name: Ayla, class: swordsman, level: 10 }]\nscenes:\n  - id: s1\n    place: warden_arena\n    cues:\n      - { who: warden, do: boss_move, move: meteor, target: a }\n      - { who: warden, do: boss_move, move: tether }\n`);
  assert.ok(sheet.sheet, sheet.error);
  const { errors } = validateSheet(sheet.sheet);
  assert.deepEqual(errors, [], JSON.stringify(errors));
  const bad = validateSheet(parseSheet(`title: t\ncast: [{ id: a, name: Ayla, class: swordsman, level: 10 }]\nscenes:\n  - id: s1\n    place: warden_arena\n    cues:\n      - { who: warden, do: boss_move, move: nope }\n`).sheet);
  assert.ok(bad.errors.length, 'an unknown move is still an error');
  ok('director: boss_move meteor / spread / tether validate');
}

// ---------- bots: where they go ----------
{
  const R = WORLD.arena;
  const bot = (id, x, z, extra = {}) => ({ id, x, z, t: 10, dead: false, role: 'dps', cls: 'swordsman', party: 1, gateOpen: true, players: [], ...extra });
  const row = (id, x, z, cls = 'swordsman') => ({ id, x, z, dead: false, party: 1, cls });
  const ev = (b, e) => runHooks('onEvent', b, e);

  // stack: a bot far from the carrier walks into the circle
  let b = bot(1, R.x - 8, R.z);
  b.players = [row(1, b.x, b.z), row(2, R.x + 2, R.z), row(3, R.x + 3, R.z, 'guardian')];
  ev(b, { t: 'bt', k: 'stack', id: 2, r: 3.6, d: 4.5 });
  let s = mechSpot(b);
  assert.ok(s && Math.hypot(s[0] - (R.x + 2), s[1] - R.z) < 3.6 - 1, 'into the circle around the carrier');
  b.x = s[0]; b.z = s[1];
  assert.deepEqual(mechSpot(b), [b.x, b.z], 'inside: holds its spot');
  ev(b, { t: 'btend', k: 'stack', id: 2 });
  assert.equal(b.bt.stack, null);

  // the carrier walks to its tank
  b = bot(2, R.x + 8, R.z); b.players = [row(2, b.x, b.z), row(3, R.x - 2, R.z, 'guardian')];
  ev(b, { t: 'bt', k: 'stack', id: 2, r: 3.6, d: 4.5 });
  s = mechSpot(b); assert.ok(s && Math.hypot(s[0] - (R.x - 2), s[1] - R.z) < 0.01, 'carrier: to the tank');

  // spread: a carrier leaves everyone's radius; a bystander leaves the carrier's
  b = bot(1, R.x, R.z); b.players = [row(1, R.x, R.z), row(2, R.x + 2, R.z), row(3, R.x - 2, R.z + 1)];
  ev(b, { t: 'bt', k: 'spread', ids: [1, 4], r: 6, d: 5.5 });
  s = mechSpot(b);
  assert.ok(s && b.players.slice(1).every(p => Math.hypot(p.x - s[0], p.z - s[1]) > 6), 'carrier: clear of everyone');
  const by = bot(2, R.x + 2, R.z); by.players = b.players;
  ev(by, { t: 'bt', k: 'spread', ids: [1, 4], r: 6, d: 5.5 });
  s = mechSpot(by);
  assert.ok(s && Math.hypot(s[0] - R.x, s[1] - R.z) > 6, 'bystander: out of the carrier\'s burst');
  const tank = bot(3, R.x - 2, R.z + 1, { role: 'tank', cls: 'guardian' }); tank.players = b.players;
  ev(tank, { t: 'bt', k: 'spread', ids: [3, 4], r: 6, d: 5.5 });
  assert.equal(mechSpot(tank), null, 'a marked tank holds the boss');

  // tether: the non-tank end runs >= need away; the tank end stays
  b = bot(1, R.x, R.z); b.players = [row(1, R.x, R.z), row(3, R.x + 3, R.z, 'guardian')];
  ev(b, { t: 'bt', k: 'tether', a: 1, b: 3, need: 15, d: 11 });
  s = mechSpot(b);
  assert.ok(s && Math.hypot(s[0] - (R.x + 3), s[1] - R.z) >= 15 && Math.hypot(s[0] - R.x, s[1] - R.z) < R.r, 'runs ≥ 15 m from the other end, inside the room');
  const t2 = bot(3, R.x + 3, R.z, { role: 'tank', cls: 'guardian' }); t2.players = b.players;
  ev(t2, { t: 'bt', k: 'tether', a: 1, b: 3, need: 15, d: 11 });
  assert.equal(mechSpot(t2), null, 'the tank end holds');

  // capability: a skill 1 bot misses some
  let missed = 0;
  for (let i = 0; i < 400; i++) { const x = { t: 0, skill: 1 }; const seen = perceive(x, [{ t: 'bt', k: 'stack', id: 2, r: 3.6, d: 4.5 }]); x.t = 5; const later = perceive(x, []); if (!seen.length && !later.length) missed++; }
  assert.ok(missed > 60 && missed < 220, `skill 1 misses some (${missed}/400)`);
  ok('bots: stack into the circle (carrier to the tank), spread out, run tethers apart; capability misses some');
}

console.log(`bossteam: ${n} checks passed`);
