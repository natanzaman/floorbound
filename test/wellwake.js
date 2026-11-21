// The well awakens (docs/briefs/well-awakens.md): Floor 1's well (the town fountain) is a dormant waypoint until the
// character has Floor 2 unlocked: no warp there before, warp after (a Warden kill or the floor2 flag), the same check
// the bots use; the other waypoints are as before. Also the film side: the `wake` cine op and director verb, the
// `well` landmark, and Episode 1's sheet using them. (The client shot itself: test/wellwake.py, Playwright.)
// Usage: node test/wellwake.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../server/game.js';
import { WAYPOINTS, nearWaypoint, nearAwakeWaypoint, waypointAwake, floorUnlocked, floorOf } from '../shared/floor2.js';
import { parseSheet, validateSheet, LANDMARKS, VERBS } from '../server/director-sheet.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const quiet = f => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const newGame = () => quiet(() => new Game());
const well = WAYPOINTS.find(w => w.floor === 1), fire = WAYPOINTS.find(w => w.floor === 2);
const at = (p, w) => { p.x = w.x; p.z = w.z + w.r + 0.9; };

// ---------- the rule (data) ----------
{
  assert.equal(well.kind, 'fountain'); assert.equal(well.wakes, 2);
  assert.ok(well.woke.some(t => t === 'A bright light emits from the well.'), 'its line');
  assert.ok(WAYPOINTS.filter(w => w !== well).every(w => !w.wakes), 'the camp waypoints never sleep');
  assert.equal(waypointAwake(well, {}), false); assert.equal(waypointAwake(well, undefined), false);
  assert.equal(waypointAwake(well, { wardenKills: 1 }), true); assert.equal(waypointAwake(well, { floor2: 1 }), true);
  assert.equal(waypointAwake(fire, {}), true);
  assert.equal(nearWaypoint(0, 3.9), well, 'still the spot');
  assert.equal(nearAwakeWaypoint({}, 0, 3.9), undefined, 'but asleep without Floor 2');
  assert.equal(nearAwakeWaypoint({ floor2: 1 }, 0, 3.9), well);
  ok('WAYPOINTS: the well sleeps until Floor 2 opens (wakes: 2), the camps never sleep');
}

// ---------- the server's warp ----------
{
  process.env.TEST_HOOKS = '1';
  const g = newGame();
  const p = g.addPlayer(null, 'Wren', 'swordsman'); p.lvl = 10; g.recompute(p);
  at(p, well); g.events = [];
  const x0 = p.x, z0 = p.z;
  quiet(() => g.warp(p, 2));
  assert.ok(p.x === x0 && p.z === z0 && !g.events.some(e => e.t === 'warp'), 'no warp from the sleeping well');
  quiet(() => g.warp(p, 1));
  assert.ok(!g.events.some(e => e.t === 'warp'));
  // the first Warden kill (TEST_HOOKS clear: every player a fighter)
  quiet(() => g.handle(p, { type: 'test', clear: 1 }));
  assert.ok(floorUnlocked(p.stats, 2), 'the Warden kill opens Floor 2');
  assert.ok(waypointAwake(well, p.stats), 'and wakes the well');
  at(p, well); g.events = [];
  quiet(() => g.warp(p, 2));
  assert.equal(floorOf(p.x), 2, 'now the well takes you to Floor 2');
  at(p, fire);
  quiet(() => g.warp(p, 1));
  assert.equal(floorOf(p.x), 1, 'and the camp fire brings you back');
  // the floor2 flag (bots, the admin page, journey runs) wakes it too
  const b = g.addPlayer(null, 'Bot', 'ranger'); b.stats.floor2 = 1; at(b, well);
  quiet(() => g.warp(b, 2));
  assert.equal(floorOf(b.x), 2, 'the floor2 flag wakes it (bots)');
  ok('warp: nothing at the sleeping well; after the Warden kill or with the floor2 flag it warps; the camps as before');
}

// ---------- the message ----------
{
  const g = newGame();
  const p = g.addPlayer(null, 'Pell', 'lancer');
  const sys = [];
  g.sys = (t, id) => sys.push([t, id]);
  const w = [...g.mobs.values()].find(m => m.type === 'warden');
  w.contributors.add(p.id);
  quiet(() => g.f2WardenKilled(w));
  assert.ok(sys.some(([t, id]) => id === p.id && /well/.test(t) && /waypoint/.test(t)), 'the unlock message names the well');
  ok('the unlock message points at the well');
}

// ---------- film: the wake cue ----------
{
  assert.ok(LANDMARKS.well && LANDMARKS.well.at[0] === LANDMARKS.waypoint.at[0], 'well landmark');
  assert.ok(VERBS.wake && VERBS.wake.api === 'cine');
  const g = newGame(); g.events = [];
  assert.equal(g.cineState().wake, false);
  g.cine('wake', { on: true });
  assert.equal(g.cineState().wake, true);
  assert.deepEqual(g.events.find(e => e.t === 'cine' && e.op === 'wake'), { t: 'cine', op: 'wake', on: true });
  g.cine('reset'); assert.equal(g.cineState().wake, false);
  const ep1 = fs.readFileSync(new URL('../docs/story/ep1-first-line.yaml', import.meta.url), 'utf8');
  assert.ok(!/waystone/.test(ep1));
  const sh = parseSheet(ep1).sheet, v = validateSheet(sh, { has: () => true });
  assert.equal(v.errors.length, 0, JSON.stringify(v.errors));
  const cues = sh.scenes.flatMap(s => s.cues);
  assert.ok(cues.some(c => c.do === 'wake') && cues.some(c => c.do === 'title' && /bright light emits from the well/.test(c.sub)), 'Episode 1 has the beat');
  ok('film: `wake` cue (kept in the picture state, cleared by reset), `well` landmark, Episode 1 uses them and validates');
}

console.log(`\nall ${n} passed`);
process.exit(0);
