// In-process checks for skill combos between players and the Team Burst (server/teamplay.js, docs/ROADMAP.md G2).
// Usage: node test/teamplay.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { angleTo } from '../shared/data.js';
import { COMBO, COMBOS, BURST, hitInfo, payoffFor, setupsOf, canPay, nextChain, burstPower, burstFillScale } from '../shared/teamplay.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

// ---------- pure table helpers ----------
{
  assert.deepEqual(setupsOf(hitInfo('lancer', 'skylance')), ['launch']);
  assert.deepEqual(setupsOf(hitInfo('guardian', 'gslam', { stun: 1.5, heavy: true })), ['stun']);
  assert.deepEqual(setupsOf(hitInfo('guardian', 'bash', { heavy: true })), ['stun'], 'Bash finisher stuns');
  assert.deepEqual(setupsOf(hitInfo('guardian', 'bash')), [], 'a plain Bash swing does not');
  assert.deepEqual(setupsOf(hitInfo('ranger', 'shot', { ownMark: true, heavy: true })), ['mark'], 'a heavy arrow on its own mark');
  assert.deepEqual(setupsOf(hitInfo('ranger', 'shot', { ownMark: true })), [], 'not every arrow');
  assert.deepEqual(setupsOf(hitInfo('lancer', null)), [], 'lingering effects open nothing');
  const set = { launch: { by: 1, at: 10 } };
  assert.equal(payoffFor(set, hitInfo('ranger', 'shot'), 2, 11)?.id, 'skewer');
  assert.equal(payoffFor(set, hitInfo('cleric', 'smite'), 2, 11)?.id, 'skewer', 'Smite is ranged');
  assert.equal(payoffFor(set, hitInfo('swordsman', 'slash'), 2, 11), null, 'melee does not skewer');
  assert.equal(payoffFor(set, hitInfo('ranger', 'shot'), 1, 11), null, 'the setter cannot pay its own setup');
  assert.equal(payoffFor(set, hitInfo('ranger', 'shot'), 2, 10 + COMBO.window + 0.05), null, 'timed out');
  assert.equal(payoffFor(set, hitInfo('ranger', 'shot'), 2, 11, { skewer: 8 }), null, 'the same combo on the same target: once per 5 s');
  assert.equal(payoffFor(set, hitInfo('ranger', 'shot'), 2, 11, { skewer: 5 })?.id, 'skewer');
  assert.ok(canPay('ranger', 'skewer') && canPay('bard', 'skewer') && !canPay('guardian', 'skewer'));
  assert.ok(canPay('berserker', 'execute') && canPay('swordsman', 'execute') && canPay('lancer', 'pin'));
  assert.deepEqual(nextChain(nextChain(null, 1), 3), { n: 2, at: 3 });
  assert.deepEqual(nextChain({ n: 4, at: 1 }, 1 + COMBO.chain + 0.5), { n: 1, at: 1 + COMBO.chain + 0.5 });
  assert.ok(burstPower(2) > burstPower(1) && burstPower(4) > burstPower(2) * 1.3 && burstPower(6) > burstPower(4));
  ok('combo table: setups, payoffs by class/skill, setter excluded, window, chain, burst power');
}

// ---------- in-process game ----------
const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
function advance(dt) { // time, scheduled callbacks and the team upkeep only (no AI)
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    const step = Math.min(0.05, end - g.time);
    g.time += step;
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateTeamplay(step);
  }
}
const X = 0, Z = 70;
const mk = (name, cls) => { const p = g.addPlayer(null, name, cls); p.x = X; p.z = Z - 2; p.lvl = 10; g.recompute(p); p.hp = p.maxHp; p.crit = 0; return p; };
const lan = mk('Lan', 'lancer'), rang = mk('Rang', 'ranger'), gua = mk('Gua', 'guardian'), ber = mk('Ber', 'berserker');
const swo = mk('Swo', 'swordsman'), cle = mk('Cle', 'cleric'), bar = mk('Bar', 'bard');
const all = [lan, rang, gua, ber, swo, cle, bar];
const party = { id: g.id(), members: all.slice(0, 6).map(p => p.id) }; // the bard plays solo unless noted
g.parties.set(party.id, party);
for (const id of party.members) g.players.get(id).party = party.id;
g.time = 100;
let mob = null;
const freshMob = (type = 'wolf') => {
  if (mob) g.mobs.delete(mob.id);
  mob = g.addMob(type, X, Z + 1);
  mob.face = angleTo(mob.x, mob.z, X, Z - 2); // facing the players: no flank bonus (server/threat.js)
  mob.maxHp = mob.hp = 1e6; mob.posture = 0; mob.staggerUntil = 0; mob.stunUntil = 0; mob.def = { ...mob.def, posture: 1e9 }; // no accidental Breaks
  return mob;
};
const hitBy = (p, base, opts) => { flush(); const k = events.length; g.damageMob(mob, p, base, opts); flush(); return events.slice(k).find(e => e.t === 'hit' && e.by === p.id && e.id === mob.id); };
const combos = () => ev('combo');

// Skewer: a Lancer launch, then a ranged hit by someone else within 2.5 s: x1.6 damage and posture.
{
  freshMob(); clear();
  hitBy(lan, 50, { sk: 'skylance', heavy: true, stun: 0.5, brk: false });
  assert.equal(ev('tsetup').filter(e => e.k === 'launch' && e.id === mob.id && e.by === lan.id).length, 1, 'setup event (a target effect: no `to`)');
  assert.ok(!('to' in ev('tsetup')[0]));
  advance(1.2);
  const p0 = mob.posture, h = hitBy(rang, 100, { tsk: 'shot', threat: 1 });
  const c = combos();
  assert.equal(c.length, 1); assert.equal(c[0].k, 'skewer'); assert.equal(c[0].by, rang.id); assert.equal(c[0].from, lan.id); assert.equal(c[0].n, 1);
  const M = COMBOS.skewer.mult * 100;
  assert.ok(h.a >= M * 0.9 && h.a <= M * 1.1 + 1, `x${COMBOS.skewer.mult} damage (${h.a})`);
  assert.ok(mob.posture - p0 > M * 0.9 + 1, 'extra posture');
  assert.equal(mob.tbSet.launch, undefined, 'the setup is spent');
  clear(); hitBy(rang, 100, { tsk: 'shot' });
  assert.equal(combos().length, 0, 'one payoff per setup');
  ok('Skewer: Lancer launch -> ranged hit by a partner (event, bonus damage, posture, spent)');
}
{
  freshMob(); clear();
  hitBy(lan, 50, { sk: 'lsweep', heavy: true, stun: 0.6 });
  advance(COMBO.window + 0.1);
  hitBy(rang, 100, { tsk: 'shot' });
  assert.equal(combos().length, 0);
  clear(); hitBy(lan, 50, { sk: 'lsweep', heavy: true }); hitBy(lan, 50, { tsk: 'lthrust' }); hitBy(swo, 50, { tsk: 'slash' });
  assert.equal(combos().length, 0, 'neither the setter nor a melee hit skewers');
  ok('Skewer times out after 2.5 s; setter / melee hits do not pay it off');
}

// Execute: a Guardian stun, then a Berserker heavy: always a crit, extra posture.
{
  freshMob(); clear();
  hitBy(gua, 40, { sk: 'gslam', stun: 1.5, heavy: true });
  const h = hitBy(ber, 100, { tsk: 'chop', heavy: true });
  assert.equal(combos()[0]?.k, 'execute'); assert.equal(h.c, 1, 'forced crit'); assert.equal(ber.crit, 0, 'crit restored');
  clear(); freshMob();
  hitBy(gua, 40, { tsk: 'bash', heavy: true }); // Bash finisher
  advance(2.6); hitBy(ber, 100, { tsk: 'chop', heavy: true });
  assert.equal(combos().length, 0, 'timed out');
  ok('Execute: Guardian stun -> Berserker heavy (forced crit); times out');
}
{ // the real skills end to end: Ground Slam then Burst Combo (its hits come 0.2 s apart)
  freshMob(); clear();
  for (const p of [gua, swo]) { p.x = X; p.z = Z - 1.5; p.face = 0; p.cds = p.cds.map(() => 0); }
  g.useSkill(gua, 3, 0);
  assert.ok(ev('tsetup').some(e => e.k === 'stun' && e.by === gua.id), 'Ground Slam opens a stun');
  mob.x = X; mob.z = Z + 1; // (the slam knocked it back)
  g.useSkill(swo, 3, 0); advance(1);
  const c = combos();
  assert.equal(c.length, 1, 'one Execute'); assert.equal(c[0].k, 'execute'); assert.equal(c[0].by, swo.id); assert.equal(c[0].from, gua.id);
  ok('Execute with the real skills: Ground Slam -> Burst Combo');
}

// Pin: a Ranger's Hunter's Mark, then a Lancer charge / thrust: rooted 1.5 s (a boss is only slowed).
{
  freshMob(); clear();
  g.markA(rang, mob, '', 10, 0.15, 1.3);
  assert.ok(ev('tsetup').some(e => e.k === 'mark'));
  hitBy(lan, 60, { sk: 'lcharge', knock: 1 });
  assert.equal(combos()[0]?.k, 'pin');
  assert.ok(mob.stunUntil >= g.time + 1.45 && mob.rootA >= g.time + 1.45, 'rooted');
  clear(); freshMob(); g.markA(rang, mob, '', 10, 0.15, 1.3); advance(3); hitBy(lan, 60, { tsk: 'lthrust' });
  assert.equal(combos().length, 0, 'the mark alone opens it for 2.5 s');
  hitBy(rang, 30, { tsk: 'shot', heavy: true }); hitBy(lan, 60, { tsk: 'lthrust' }); // the Ranger's heavy arrow on its own mark re-opens it
  assert.equal(combos()[0]?.k, 'pin');
  ok('Pin: Hunter\'s Mark (or the Ranger hitting its marked target) -> Lancer thrust / charge roots; times out');
}

// Shatter Chorus: 3+ Discord stacks from a Bard, Broken by someone else: party heal + a burst of damage.
{
  freshMob(); clear();
  g.addDiscord(mob, bar, 3);
  for (const p of all) p.hp = Math.round(p.maxHp * 0.5);
  const hp = mob.hp;
  g.breakMob(mob, swo, false, null);
  const c = combos();
  assert.equal(c.length, 1); assert.equal(c[0].k, 'chorus'); assert.equal(c[0].by, swo.id); assert.equal(c[0].from, bar.id);
  assert.ok(swo.hp > swo.maxHp * 0.5 && gua.hp > gua.maxHp * 0.5 && bar.hp > bar.maxHp * 0.5, 'the breaker\'s party and the bard heal');
  assert.ok(mob.hp < hp, 'the chord bursts');
  clear(); freshMob(); g.addDiscord(mob, bar, 2); g.breakMob(mob, swo, false, null);
  assert.equal(combos().length, 0, 'needs 3 stacks');
  clear(); freshMob(); g.addDiscord(mob, bar, 5); g.breakMob(mob, bar, false, null);
  assert.equal(combos().length, 0, 'the Bard\'s own Break (Crescendo) is not a combo');
  for (const p of all) p.hp = p.maxHp;
  ok('Shatter Chorus: Bard Discord >= 3 -> another player\'s Break (heal + burst)');
}

// Sanctified Switch: a Switch inside a Cleric's Sanctuary (or under Blessing) lengthens the Broken window.
{
  freshMob(); clear();
  g.zones.push({ x: swo.x, z: swo.z, r: 6, until: g.time + 5, next: g.time + 9, owner: cle.id, sk: 'sanct', heal: 0.06 });
  g.breakMob(mob, gua, false, null);
  const until = mob.staggerUntil;
  const h = hitBy(swo, 50, { tsk: 'slash' });
  assert.equal(h.sw, 1, 'a Switch');
  const c = combos().find(e => e.k === 'sanctified');
  assert.ok(c && c.by === swo.id && c.from === cle.id && c.ext === COMBOS.sanctified.extend);
  assert.ok(Math.abs(mob.staggerUntil - (until + COMBOS.sanctified.extend)) < 1e-6, 'longer Broken window');
  g.zones = [];
  clear(); freshMob(); swo.dmg = { until: g.time + 8, v: 0.25, by: cle.id, sk: 'bless' };
  g.breakMob(mob, gua, false, null); hitBy(swo, 50, { tsk: 'slash' });
  assert.ok(combos().some(e => e.k === 'sanctified'), 'under Blessing');
  clear(); freshMob(); swo.dmg = { until: 0, v: 0 };
  g.breakMob(mob, gua, false, null); hitBy(swo, 50, { tsk: 'slash' });
  assert.equal(combos().filter(e => e.k === 'sanctified').length, 0, 'not without the Cleric');
  ok('Sanctified Switch: in Sanctuary / under Blessing, the Switch lengthens Broken');
}

// Chain counter on the target.
{
  freshMob(); clear();
  hitBy(lan, 50, { sk: 'skylance', heavy: true }); hitBy(rang, 50, { tsk: 'shot' });
  advance(2); hitBy(gua, 40, { sk: 'gslam', stun: 1.5 }); hitBy(ber, 50, { tsk: 'chop', heavy: true });
  assert.deepEqual(combos().map(e => e.n), [1, 2], 'Combo x2');
  clear(); advance(COMBO.chain + 0.5); hitBy(gua, 40, { sk: 'gslam', stun: 1.5 }); hitBy(ber, 50, { tsk: 'chop', heavy: true });
  assert.deepEqual(combos().map(e => e.n), [1], 'the chain resets');
  ok('chain counter: x2 within 6 s, resets after');
}

// ---------- Team Burst gauge ----------
const tb = p => g.tb?.get(g.teamKey(p))?.g || 0;
{
  g.tb = new Map();
  const sc = burstFillScale(6), near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(burstFillScale(2) === 1 && burstFillScale(3) === 1 && sc < 0.75, 'big parties fill a little slower');
  g.teamStat(gua, 'combo');
  assert.ok(near(tb(gua), BURST.fill.combo * sc));
  g.teamStat(swo, 'switch'); g.teamStat(cle, 'break'); g.teamStat(gua, 'parry'); g.teamStat(lan, 'revive'); g.teamStat(rang, 'save');
  const F = BURST.fill, want = (F.combo + F.switch + F.break + F.parry + F.revive + F.save) * sc;
  assert.ok(near(tb(gua), want), 'switches, breaks, parries, revives, saves fill the party bar');
  g.teamStat(gua, 'dmg', 5000); g.teamStat(gua, 'heal', 500);
  assert.ok(near(tb(gua), want), 'damage and healing are counted, not filled');
  g.teamStat(bar, 'combo');
  assert.equal(tb(bar), BURST.fill.combo * BURST.soloFill, 'solo fills slower');
  for (let i = 0; i < 30; i++) g.teamStat(gua, 'combo');
  assert.equal(tb(gua), BURST.max, 'capped');
  for (const p of all) p.lastCombat = g.time;
  advance(2); assert.equal(tb(gua), BURST.max, 'no drain in combat');
  for (const p of all) p.lastCombat = g.time - BURST.idle - 1;
  advance(1); assert.ok(Math.abs(tb(gua) - (BURST.max - BURST.drain)) < 0.01, 'drains out of combat');
  advance(30); assert.equal(g.tb.has(g.teamKey(gua)), false, 'empty gauges are dropped');
  ok('gauge: fill per team stat, solo x0.5, cap, drain out of combat');
}

// Sync window: joining, scaling, early fire, solo.
function burstRun(joinIds, { solo = false } = {}) {
  freshMob(); g.tb = new Map(); clear();
  for (const p of all) { p.x = X; p.z = Z - 2; p.dead = false; p.lastCombat = g.time; p.target = mob.id; p.relay = null; }
  const starter = solo ? bar : g.players.get(joinIds[0]);
  g.tbState(g.teamKey(starter)).g = BURST.max;
  const hp = mob.hp;
  assert.equal(g.handle(starter, { type: 'burst' }), true);
  for (const id of joinIds.slice(1)) { advance(0.3); g.handle(g.players.get(id), { type: 'burst' }); }
  advance(BURST.sync + 0.2);
  return { lost: hp - mob.hp, ev: ev('tburst'), sync: ev('tbsync'), joins: ev('tbjoin') };
}
{
  g.tb = new Map(); g.tbState(g.teamKey(gua)).g = 50;
  assert.equal(g.handle(gua, { type: 'burst' }), false, 'not full: nothing');
  const two = burstRun([gua.id, swo.id]);
  assert.equal(two.sync.length, 1); assert.equal(two.sync[0].by, gua.id); assert.equal(two.sync[0].d, BURST.sync);
  assert.equal(two.joins.length, 1); assert.equal(two.joins[0].n, 2);
  assert.equal(two.ev.length, 1); assert.equal(two.ev[0].n, 2); assert.equal(two.ev[0].m, mob.id);
  assert.ok(mob.staggerUntil > g.time - BURST.sync, 'a full posture BREAK (a Switch window)');
  assert.ok(gua.relay?.v > 0 && cle.relay?.v > 0, 'party damage buff');
  assert.equal(tb(gua), 0, 'the gauge is spent');
  // a press after the window closed: nothing
  assert.equal(g.handle(cle, { type: 'burst' }), false);
  const four = burstRun([gua.id, swo.id, ber.id, lan.id]);
  assert.equal(four.ev[0].n, 4);
  const atk = ids => ids.reduce((s, p) => s + p.atk * g.dmgMult(p), 0);
  const per2 = two.lost / atk([gua, swo]), per4 = four.lost / atk([gua, swo, ber, lan]);
  assert.ok(per4 / per2 > 1.15, `4 joiners hit harder per head (${(per4 / per2).toFixed(2)}x)`);
  // everyone joined: fires at once
  freshMob(); g.tb = new Map(); clear();
  g.tbState(party.id).g = BURST.max;
  for (const p of all) { p.x = X; p.z = Z - 2; }
  for (const p of all.slice(0, 6)) g.handle(p, { type: 'burst' });
  assert.equal(ev('tburst').length, 1, 'fires early once every living member is in'); assert.equal(ev('tburst')[0].n, 6);
  // no enemy in reach: refused, the gauge is kept
  g.mobs.delete(mob.id); mob = null; g.tb = new Map(); clear();
  for (const p of all) p.target = 0;
  g.tbState(party.id).g = BURST.max;
  assert.equal(g.handle(gua, { type: 'burst' }), false, 'nothing to hit: refused');
  assert.equal(tb(gua), BURST.max, 'the gauge is kept');
  assert.ok(ev('sys').some(e => e.to === gua.id && /no enemy/.test(e.text)));
  // the presser's target (a hint with the press) wins over the fallbacks
  const other = g.addMob('boar', X + 3, Z + 2); other.maxHp = other.hp = 1e6;
  freshMob(); g.tb = new Map(); clear();
  g.tbState(party.id).g = BURST.max;
  g.handle(gua, { type: 'burst', m: other.id });
  advance(BURST.sync + 0.2);
  assert.equal(ev('tburst')[0].m, other.id, 'the target pressed on');
  assert.ok(other.hp < other.maxHp);
  g.mobs.delete(other.id);
  // solo: no window, weaker, no full break
  const solo = burstRun([bar.id], { solo: true });
  assert.equal(solo.sync.length, 0); assert.equal(solo.ev[0].n, 1);
  assert.ok(solo.lost / atk([bar]) < per2, 'solo is weaker per head');
  assert.ok(!(mob.staggerUntil > g.time - BURST.sync - 0.3), 'solo: a posture chunk, no forced Break');
  ok(`sync window: start, join, fire on timeout / when all are in; scales with joiners (2: ${Math.round(two.lost)}, 4: ${Math.round(four.lost)} dmg); solo burst`);
}

// ---------- per-fight team stats (for G5) ----------
{
  freshMob(); clear(); g.tb = new Map();
  g.fight = { start: g.time, ids: new Set(all.map(p => p.id)), deaths: 0, hp: 1 };
  hitBy(lan, 50, { sk: 'skylance', heavy: true }); hitBy(rang, 100, { tsk: 'shot' });
  g.breakMob(mob, gua, false, null); hitBy(swo, 50, { tsk: 'slash' });
  gua.hp = 10; g.healPlayer(gua, 40, cle, 'heal');
  const s = g.teamStats();
  assert.equal(s[rang.id].combo, 1); assert.equal(s[lan.id].setup, 1);
  assert.equal(s[gua.id].break, 1); assert.equal(s[swo.id].switch, 1);
  assert.ok(s[rang.id].dmg > 100 && s[swo.id].dmg > 0); assert.equal(s[cle.id].heal, 40);
  g.fight = null;
  g.teamStat(gua, 'revive');
  assert.equal(g.teamStats(null).length, undefined);
  ok('teamStat: per-fight rows (combo, setup, break, switch, dmg, heal) on the fight record');
}

// ---------- film safety ----------
{
  const d = g.director;
  g.director = { running: true }; g.tb = new Map();
  g.teamStat(gua, 'combo');
  assert.equal(tb(gua), 0, 'no gauge during a show');
  g.tbState(party.id).g = BURST.max;
  assert.equal(g.handle(gua, { type: 'burst' }), false, 'no Team Burst during a show');
  g.director = d;
  ok('a running director show: no gauge, no Team Burst');
}

// ---------- snapshot ----------
{
  g.tb = new Map(); g.tbState(party.id).g = 42;
  const w = JSON.parse(g.snapshot());
  assert.deepEqual(w.tb, [[party.id, 42, 0, []]]);
  g.tb = new Map();
  assert.equal(JSON.parse(g.snapshot()).tb, undefined, 'nothing to send: no field');
  ok('snapshot: w.tb [key, gauge, sync left, joined]');
}
console.log(`teamplay: ${n} checks passed`);
