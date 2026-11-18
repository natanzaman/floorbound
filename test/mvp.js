// The post-fight MVP card (docs/ROADMAP.md G5): shared/mvp.js (titles, MVP, compact copy), server/mvp.js (card at the
// end of a Warden / Sovereign kill or wipe, downs and deaths, director shows, tracking row), the director verb `mvp`.
// Usage: node test/mvp.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WORLD } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { buildCard, compactCard, MVP_KEYS, MVP_TITLES, headline, fmtSecs } from '../shared/mvp.js';
import { parseSheet, validateSheet } from '../server/director-sheet.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

// ---------- pure: titles, MVP, compact ----------
{
  const rows = [
    { id: 1, name: 'Kael', cls: 'guardian', bot: false, lvl: 10, dmg: 900, tanked: 2400, cover: 2, save: 1, switch: 3 },
    { id: 2, name: 'Mira', cls: 'cleric', bot: true, lvl: 10, dmg: 300, heal: 2100, revive: 2, save: 1, down: 0 },
    { id: 3, name: 'Rook', cls: 'berserker', bot: true, lvl: 10, dmg: 3100, combo: 4, break: 2, down: 1, death: 1 },
    { id: 4, name: 'Vex', cls: 'lancer', bot: false, lvl: 10, dmg: 2500, combo: 1, setup: 8, flank: 5, lastAttack: 1, mechanic: 3 },
  ];
  const c = buildCard({ boss: 'The Horned Warden', floor: 1, result: 'kill', secs: 84, rows });
  const by = id => c.rows.find(r => r.id === id);
  assert.equal(c.rows.length, 4);
  for (const r of c.rows) for (const k of MVP_KEYS) assert.equal(typeof r[k], 'number', `${k} filled in`);
  assert.ok(by(4).titles.includes('lastword') && by(4).titles[0] === 'lastword', 'Last Word heads the Last Attack');
  assert.ok(by(2).titles.includes('lifeline'), 'Lifeline: revives + saves');
  assert.ok(by(1).titles.includes('wall'), 'Wall: most tanked');
  assert.ok(by(4).titles.includes('conductor'), 'Conductor: combos + half the setups');
  assert.ok(by(3).titles.includes('breaker') && by(3).titles.includes('heavy'), 'Breaker and Heavy Hitter');
  assert.ok(by(4).titles.includes('flanker') && by(4).titles.includes('clockwork'));
  assert.ok(by(2).titles.includes('mender') && by(1).titles.includes('bodyguard'));
  assert.ok(!by(3).titles.includes('unshakable') && by(1).titles.includes('unshakable') && by(2).titles.includes('unshakable'), 'Unshakable: everyone who never went down');
  for (const t of MVP_TITLES.filter(t => !t.each)) assert.ok(c.rows.filter(r => r.titles.includes(t.k)).length <= 1, `${t.name}: one holder`);
  assert.equal(c.mvp, c.rows[0].id); assert.ok(c.rows.every((r, i) => !i || r.score <= c.rows[i - 1].score), 'best first');
  assert.ok(by(3).top.includes('dmg') && by(1).top.includes('tanked') && !by(3).top.includes('death'));
  assert.deepEqual(headline(by(4)), { name: 'Last Word', why: 'landed the Last Attack' });
  assert.equal(headline(by(2)).why, '2 revives, 1 save');
  const cc = compactCard(c);
  assert.equal(cc.mvp, by(c.mvp).name);
  assert.deepEqual(cc.rows.find(r => r.n === 'Mira'), { n: 'Mira', c: 'cleric', b: 1, s: { dmg: 300, heal: 2100, revive: 2, save: 1 }, t: by(2).titles });
  assert.ok(JSON.stringify(cc).length < 1200, 'compact enough for a tracking row');
  // a solo fight: no Unshakable, no "led" highlights; a title needs its minimum
  const solo = buildCard({ boss: 'B', floor: 1, result: 'wipe', secs: 30, rows: [{ id: 9, name: 'S', cls: 'swordsman', dmg: 50, flank: 1 }] });
  assert.deepEqual(solo.rows[0].titles, ['heavy']); assert.deepEqual(solo.rows[0].top, []);
  assert.equal(headline({ titles: [] }).name, 'Steady Hand');
  // spreading: a close second without a title takes it from a fighter who already has one; Last Word never moves
  const sp = buildCard({ boss: 'B', floor: 1, result: 'kill', secs: 60, rows: [
    { id: 1, name: 'A', cls: 'lancer', dmg: 4400, break: 9, combo: 8, lastAttack: 1 },
    { id: 2, name: 'B', cls: 'ranger', dmg: 4300, combo: 7 },
    { id: 3, name: 'C', cls: 'bard', dmg: 1000, break: 2 },
  ] });
  const t = id => sp.rows.find(r => r.id === id).titles;
  assert.ok(t(1).includes('lastword') && t(1).includes('breaker'), 'A: Last Word; Breaker stays (C is far behind)');
  assert.ok(t(2).includes('conductor') && !t(1).includes('conductor'), 'Conductor goes to B (7 vs 8: close, B had none)');
  assert.ok(!t(2).includes('heavy') && t(1).includes('heavy'), 'B has a title now: Heavy Hitter stays with A');
  assert.equal(fmtSecs(84), '1:24'); assert.equal(fmtSecs(59.6), '1:00');
  ok('titles (one holder each, Unshakable for all who stayed up), MVP order, stat leaders, compact copy');
}

// ---------- in-process game ----------
const g = quiet(() => new Game());
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const rows = [];
g.track = (p, kind, data) => rows.push({ p, kind, data });
const A = WORLD.arena;
const mk = (name, cls, bot = false) => { const p = quiet(() => g.addPlayer(null, name, cls)); p.x = A.x; p.z = A.z - 4; p.lvl = 10; g.recompute(p); p.hp = p.maxHp; p.bot = bot; return p; };
const gua = mk('Kael', 'guardian'), cle = mk('Mira', 'cleric', true), ber = mk('Rook', 'berserker', true);
const party = { id: g.id(), members: [gua.id, cle.id, ber.id] };
g.parties.set(party.id, party);
for (const id of party.members) g.players.get(id).party = party.id;
g.time = 500;
const b = g.boss;

// A Warden kill: damage, a heal, a down and a revive, the Last Attack; the card goes to the three fighters.
{
  g.startFight(b);
  assert.ok(g.fight.meta.size === 3);
  g.damageMob(b, ber, 120, {});
  g.damageMob(b, gua, 40, {});
  g.teamStat(gua, 'tanked', 300); g.teamStat(gua, 'cover'); g.teamStat(cle, 'revive');
  ber.iframeUntil = 0; ber.hp = 5; quiet(() => g.damagePlayer(ber, 9999, { src: 'warden slam' }));
  assert.ok(ber.downed, 'downed with partymates near');
  quiet(() => g.damagePlayer(ber, 10, { src: 'warden slam' })); // a hit on a downed player is not a second down
  g.time += 30;
  b.hp = 1; quiet(() => g.damageMob(b, gua, 500, {}));
  assert.ok(b.dead || b.hp <= 0, 'Warden dead');
  assert.equal(g.fight, null);
  const e = ev('mvp');
  assert.equal(e.length, 1, 'one card');
  assert.deepEqual(e[0].ids.sort(), [gua.id, cle.id, ber.id].sort());
  assert.equal(e[0].d, 5); assert.ok(!e[0].all);
  const c = e[0].card, row = id => c.rows.find(r => r.id === id);
  assert.equal(c.result, 'kill'); assert.equal(c.floor, 1); assert.equal(c.boss, 'The Horned Warden'); assert.ok(c.secs >= 30);
  assert.ok(row(ber.id).dmg > 50 && row(ber.id).down === 1 && !row(ber.id).death, 'Rook: damage, one down');
  assert.equal(row(gua.id).lastAttack, 1); assert.ok(row(gua.id).titles.includes('lastword'));
  assert.equal(row(gua.id).tanked, 300); assert.equal(row(gua.id).cover, 1);
  assert.ok(row(cle.id).bot && row(cle.id).titles.includes('lifeline'));
  assert.ok(!row(ber.id).titles.includes('unshakable') && row(gua.id).titles.includes('unshakable'));
  const fr = rows.filter(r => r.kind === 'fight').at(-1).data;
  assert.equal(fr.result, 'kill'); assert.ok(fr.mvp && fr.mvp.rows.length === 3, 'the fight row carries the card');
  assert.ok(fr.mvp.rows.find(r => r.n === 'Rook').b === 1 && fr.mvp.rows.find(r => r.n === 'Rook').s.down === 1);
  assert.equal(g.lastCard, c);
  ok('Warden kill: one card to every fighter (5 s after), damage / tanked / Covers / revives / downs / Last Attack, titles, bots marked, kept in the fight row');
}

// A wipe: deaths count; the card shows sooner.
{
  events = []; b.dead = false; b.hp = b.maxHp; g.mobs.set(b.id, b);
  for (const p of [gua, cle, ber]) { p.dead = false; p.downed = null; p.hp = p.maxHp; p.x = A.x; p.z = A.z - 4; }
  g.time += 10;
  g.startFight(b);
  g.damageMob(b, ber, 80, {});
  g.time += 20;
  for (const p of [gua, cle, ber]) { p.iframeUntil = 0; quiet(() => g.killPlayer(p, 'warden slam')); }
  quiet(() => g.killPlayer(ber, 'again')); // already dead: no second death
  g.endFight('wipe', b);
  const e = ev('mvp');
  assert.equal(e.length, 1); assert.equal(e[0].d, 3);
  const c = e[0].card;
  assert.equal(c.result, 'wipe');
  assert.ok(c.rows.every(r => r.death === 1), 'one death each');
  assert.ok(c.rows.every(r => !r.titles.includes('unshakable')));
  ok('wipe: deaths per fighter, no Unshakable, shown after 3 s');
}

// No card: a fight nobody hit, or a very short one.
{
  events = []; g.time += 10;
  for (const p of [gua, cle, ber]) { p.dead = false; p.hp = p.maxHp; }
  g.startFight(b); g.time += 20; g.endFight('wipe', b);
  assert.equal(ev('mvp').length, 0, 'no damage, no card');
  assert.ok(!rows.filter(r => r.kind === 'fight').at(-1).data.mvp);
  g.startFight(b); g.damageMob(b, ber, 10, {}); g.time += 2; g.endFight('wipe', b);
  assert.equal(ev('mvp').length, 0, 'under 5 s, no card');
  ok('no card for a fight without damage or a few seconds long');
}

// A director show: no card unless a cue asks; the `mvp` verb shows the last one to everyone (film view too).
{
  events = []; g.time += 10;
  const last = g.lastCard;
  g.director = { running: true };
  g.startFight(b); g.damageMob(b, ber, 60, {}); g.time += 12; g.endFight('wipe', b);
  assert.equal(ev('mvp').length, 0, 'no card during a show');
  assert.notEqual(g.lastCard, last, 'kept for a cue');
  assert.ok(rows.filter(r => r.kind === 'fight').at(-1).data.mvp, 'still tracked');
  assert.equal(g.showMvp({ secs: 12 }), true);
  const e = ev('mvp');
  assert.equal(e.length, 1); assert.equal(e[0].all, 1); assert.equal(e[0].secs, 12); assert.equal(e[0].d, 0);
  g.director = null;
  const sheet = parseSheet(`title: t
cast: [{ id: a, name: Aldo, class: guardian }]
scenes:
  - id: s
    place: warden_arena
    cues:
      - { do: mvp, secs: 10 }`);
  const v = validateSheet(sheet.sheet, { has: name => typeof g[name] === 'function' });
  assert.deepEqual(v.errors, [], 'the mvp verb validates');
  ok('director show: no card, kept as lastCard and tracked; showMvp / the `mvp` cue sends it to everyone');
}

// The Sovereign (Floor 2): the same card.
{
  events = []; g.time += 10;
  const s = g.sovereign;
  for (const p of [gua, cle, ber]) { p.dead = false; p.hp = p.maxHp; p.x = F2.arena.x; p.z = F2.arena.z - 4; }
  g.startFight2(s);
  g.damageMob(s, ber, 100, {}); g.teamStat(cle, 'heal', 250); g.teamStat(ber, 'mechanic'); g.teamStat(ber, 'flank', 3);
  g.time += 40;
  g.endFight2('wipe', s);
  const e = ev('mvp');
  assert.equal(e.length, 1);
  const c = e[0].card;
  assert.equal(c.floor, 2); assert.equal(c.boss, 'The Drowned Sovereign');
  assert.equal(c.rows.find(r => r.id === cle.id).heal, 250); assert.equal(c.rows.find(r => r.id === ber.id).flank, 3);
  ok('Sovereign fights get the same card');
}

// A fighter who logs off before the end keeps their row.
{
  events = []; g.time += 10;
  for (const p of [gua, cle, ber]) { p.dead = false; p.hp = p.maxHp; p.x = A.x; p.z = A.z - 4; }
  b.hp = b.maxHp;
  g.startFight(b); g.damageMob(b, gua, 50, {}); g.damageMob(b, cle, 30, {}); g.time += 10;
  const id = cle.id;
  quiet(() => g.removePlayer(cle));
  g.endFight('wipe', b);
  const c = ev('mvp')[0].card;
  assert.ok(c.rows.find(r => r.id === id && r.name === 'Mira' && r.dmg > 0));
  ok('a fighter who left mid-fight keeps their row');
}

// TEST_HOOKS: a given card to the asking player (screenshots).
{
  events = [];
  process.env.TEST_HOOKS = '1';
  g.handle(gua, { type: 'test', mvpCard: { rows: [{ id: gua.id }] } });
  const e = ev('mvp');
  assert.equal(e.length, 1); assert.deepEqual(e[0].ids, [gua.id]);
  delete process.env.TEST_HOOKS;
  ok('TEST_HOOKS mvpCard preset');
}

// Balance pass: a director show keeps the Warden scaling its episodes were rehearsed against.
{
  const { WARDEN } = await import('../shared/data.js');
  const live = (g.scaleWarden(b), [b.maxHp, b.def.atk]);
  g.director = { running: true }; g.scaleWarden(b); const show = [b.maxHp, b.def.atk]; g.director = null;
  assert.ok(show[0] < live[0] && show[1] < live[1], `show ${show} vs live ${live}`);
  assert.equal(WARDEN.show.hpExp, 1.8);
  g.scaleWarden(b);
  ok('a director show scales the Warden the pre-balance way');
}

console.log(`mvp: ${n} ok`);
process.exit(0);
