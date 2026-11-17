// In-process checks for the Tower Bell (ROADMAP F6): the first clear of a floor rings once, later clears don't,
// game.bellAuto = false holds the automatic ring, ringBell by hand works; banner words.
// Usage: node test/bell.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { bellBanner, numberWords, ordinalWords } from '../shared/bell.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

// ---------- words ----------
assert.deepEqual(bellBanner(1), ['THE FIRST BELL', 'Floor 1 has been cleared. Ninety-nine to go.']);
assert.deepEqual(bellBanner(2), ['THE SECOND BELL', 'Floor 2 has been cleared. Ninety-eight to go.']);
assert.deepEqual(bellBanner(100), ['THE HUNDREDTH BELL', 'Floor 100 has been cleared. Then home.']);
assert.deepEqual([3, 11, 12, 20, 21, 40, 42, 99].map(ordinalWords),
  ['third', 'eleventh', 'twelfth', 'twentieth', 'twenty-first', 'fortieth', 'forty-second', 'ninety-ninth']);
assert.deepEqual([0, 13, 70, 85].map(numberWords), ['zero', 'thirteen', 'seventy', 'eighty-five']);
ok('banner words: ordinals per floor, bells to go');

const g = new Game();
const clears = [];
g.onClear = rec => clears.push(rec);
const boss = type => [...g.mobs.values()].find(m => m.type === type);
const bells = () => { const b = g.events.filter(e => e.t === 'bell'); g.events = []; return b; };
const kill = (type, ...ps) => {
  const m = boss(type);
  m.dead = false; m.hp = 1; m.contributors.clear();
  for (const p of ps) m.contributors.add(p.id);
  g.killMob(m, ps[0]);
};
const a = g.addPlayer(null, 'Pell', 'rogue'), b = g.addPlayer(null, 'Bram', 'guardian');
g.events = [];

// ---------- automatic ring ----------
assert.equal(g.bellAuto, true, 'on by default');
kill('warden', a, b);
let r = bells();
assert.equal(r.length, 1, 'first Floor 1 clear rings');
assert.deepEqual(r[0], { t: 'bell', floor: 1, n: 1 });
assert.equal(clears.length, 1); assert.equal(clears[0].first, true);
assert.deepEqual(clears[0].players.map(p => p.name).sort(), ['Bram', 'Pell'], 'the Hall record keeps everyone who fought');
ok('the first Floor 1 clear rings the bell once');

kill('warden', b, a);
assert.equal(bells().length, 0); assert.equal(clears.length, 2);
ok('a later Floor 1 clear does not ring');

// ---------- held by the director ----------
g.bellAuto = false;
kill('sovereign', a);
assert.equal(bells().length, 0, 'held');
assert.equal(clears.at(-1).floor, 2); assert.equal(clears.at(-1).first, true);
ok('bellAuto = false holds the automatic ring (first Floor 2 clear)');

// ---------- by hand ----------
assert.equal(g.ringBell(2), true);
r = bells();
assert.deepEqual(r, [{ t: 'bell', floor: 2, n: 2 }]);
assert.equal(g.ringBell(1, { auto: true }), false, 'an auto ring is still held');
assert.equal(bells().length, 0);
g.bellAuto = true;
assert.equal(g.ringBell(1, { auto: true }), true);
assert.equal(bells()[0].n, 3);
ok('ringBell by hand works while held; auto rings again once released');

// a server whose Hall already has a first clear (loaded from the database) never auto-rings
const g2 = new Game();
g2.hadFirstClear = true; g2.events = [];
const w = [...g2.mobs.values()].find(m => m.type === 'warden'), p = g2.addPlayer(null, 'Juno', 'mage');
w.contributors.add(p.id); g2.killMob(w, p);
assert.equal(g2.events.filter(e => e.t === 'bell').length, 0);
ok('no ring when the Hall already had a first clear');

console.log(`bell: ${n} checks passed`);
process.exit(0);
