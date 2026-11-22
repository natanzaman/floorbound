// Cross-feature fixes (loadouts x class change, the Academy x the 2nd weapon, private lines, guild vault x Academy
// weapons, towns x deleted characters). In process, no database.
// Usage: node test/crossfeature.js
import assert from 'node:assert/strict';

process.env.NAMED_ENABLED ??= '0';
const { Game } = await import('../server/game.js');
const { makeItem } = await import('../shared/items.js');
const { ACADEMY } = await import('../shared/academyyard.js');
const { TOWN_FLOORS } = await import('../shared/towns.js');

const g = new Game(); g.track = () => {};
const sock = () => ({ readyState: 1, send() {} });
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const priv = p => (p.pev || []).filter(e => e.t === 'sys').map(e => e.text);
const join = (name, cls, lvl = 20, weapon = null) => { g.joinWeapon = weapon; const p = g.addPlayer(sock(), name, cls); g.joinWeapon = null; p.lvl = lvl; g.recompute(p); return p; };

// ---------- loadouts across a class change; none during a trial ----------
{
  const p = join('Lo', 'swordsman');
  p.path = { stage: 'class', weapon: 'sword', trials: { swordsman: 1, guardian: 1 }, drills: {}, keep: {}, cohort: [], paid: {}, gear: {} };
  g.setTalents(p, { sw_feet: 2, sw_roll: 3 });
  const sword = p.inv.eq.weapon = makeItem('weapon', 2, 'swordsman', () => 0.5);
  p.lastCombat = -999; g.teleport(p, 0, 0);
  g.loadoutAction(p, { op: 'save', i: 0, name: 'Blade' });
  assert.equal(p.inv.loadouts[0].cls, 'swordsman', 'a loadout knows its class');
  p.inv.loadouts[1] = { n: 'Old', eq: { weapon: sword.u }, tal: { sw_feet: 1 } }; // (an older save: no cls)
  g.teleport(p, ACADEMY.x + 3, ACADEMY.z); p.gold = 1e5;
  g.handle(p, { type: 'academy', op: 'change', cls: 'guardian' });
  assert.equal(p.cls, 'guardian');
  g.setTalents(p, { gu_plate: 2 });
  g.teleport(p, 0, 0); p.lastCombat = -999; p.pev = [];
  g.loadoutAction(p, { op: 'use', i: 0 });
  assert.deepEqual(p.talents, { gu_plate: 2 }, 'a Swordsman loadout leaves the Guardian talents alone');
  assert.notEqual(p.inv.eq.weapon?.u, sword.u, 'and its sword stays in the bag');
  assert.ok(priv(p).some(t => /saved as a Swordsman/.test(t)), 'the player is told, privately');
  assert.ok(!g.events.some(e => e.t === 'sys' && /saved as a/.test(e.text)), 'not in the shared world');
  g.loadoutAction(p, { op: 'use', i: 1 });
  assert.deepEqual(p.talents, { gu_plate: 2 }, 'an older save: its talents name the class');
  p.loan = { cls: 'swordsman' }; p.pev = [];
  g.loadoutAction(p, { op: 'save', i: 2 }); assert.equal(p.inv.loadouts[2], null, 'no saving on loan');
  g.loadoutAction(p, { op: 'use', i: 0 }); assert.ok(priv(p).every(t => /class trial/.test(t)) && priv(p).length === 2, 'nor using');
  p.loan = null;
  ok('loadouts: saved with their class; another class\'s talents and gear stay out (told privately); none during a trial');
}

// ---------- the Academy and the 2nd weapon ----------
{
  const p = join('Two', 'swordsman', 20);
  p.path = { stage: 'class', weapon: 'sword', trials: { swordsman: 1, ranger: 1 }, drills: {}, keep: {}, cohort: [], paid: {}, gear: {} };
  const spare = makeItem('weapon', 2, 'swordsman', () => 0.5);
  p.inv.eq.weapon2 = spare; p.gold = 1e5;
  g.teleport(p, ACADEMY.x + 3, ACADEMY.z);
  g.handle(p, { type: 'academy', op: 'change', cls: 'ranger' });
  assert.equal(p.cls, 'ranger'); assert.equal(p.inv.eq.weapon2, null, 'the Swordsman spare left the slot');
  assert.ok(p.inv.bag.includes(spare), 'into the bag');
  // an Initiate's Academy weapon as the spare: gone at graduation
  const ini = join('Ini', 'swordsman', 6, 'sword');
  const loan = makeItem('weapon', 0, 'swordsman', () => 0.5); loan.ac = 1;
  ini.inv.eq.weapon2 = loan; ini.path.trials.swordsman = 1;
  g.teleport(ini, ACADEMY.x + 3, ACADEMY.z);
  g.handle(ini, { type: 'academy', op: 'graduate', cls: 'swordsman' });
  assert.equal(ini.path.stage, 'class'); assert.equal(ini.inv.eq.weapon2, null); assert.ok(!ini.inv.bag.includes(loan), 'an Academy spare is not kept');
  // a foreign spare that could not move: the swap says why
  const q = join('Sw', 'guardian', 20); q.inv.eq.weapon2 = makeItem('weapon', 2, 'ranger', () => 0.5); q.pev = [];
  g.swapWeapon(q);
  assert.ok(priv(q).includes('Your 2nd weapon is for another class.'));
  ok('class and weapon changes tidy the 2nd weapon (to the bag; an Academy one goes back); a foreign spare\'s swap says why');
}

// ---------- the guild vault refuses Academy weapons ----------
{
  const a = join('Gild', 'swordsman', 20); a.gold = 1000;
  g.handle(a, { type: 'guild', op: 'create', name: 'Testers', tag: 'TS' });
  assert.ok(g.guildOf(a), 'a guild to test with');
  {
    const it = makeItem('weapon', 0, 'swordsman', () => 0.5); it.ac = 1; a.inv.bag.push(it);
    g.handle(a, { type: 'guild', op: 'store', u: it.u });
    assert.ok(a.inv.bag.includes(it), 'it stays in the bag');
    ok('the guild vault refuses Academy weapons');
  }
}

// ---------- towns: a deleted character leaves the ballot and the office ----------
{
  const f = TOWN_FLOORS[0], T = g.town(f), key = 'c4242';
  T.el ||= { cands: [], votes: {}, contrib: {} };
  T.el.cands.push({ key, name: 'Gone', kind: 'player' }); T.el.votes[key] = key; T.el.votes.c7 = key;
  T.steward = { key, name: 'Gone', kind: 'player', ag: 'build', since: 0 }; T.tax = 5;
  g.townCharGone(4242);
  assert.ok(!T.el.cands.some(c => c.key === key) && !(key in T.el.votes) && !Object.values(T.el.votes).includes(key), 'off the ballot, votes gone');
  assert.equal(T.steward, null); assert.equal(T.tax, 0);
  ok('towns: a deleted character leaves the ballot, its votes and the stewardship');
}

console.log(`1..${n}`);
process.exit(0);
