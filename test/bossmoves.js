// In-process checks for single boss moves (docs/ROADMAP.md J3 hard review): the Sovereign's Brackish Pools.
// Usage: node test/bossmoves.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { F2 } from '../shared/floor2.js';

let n = 0, failed = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok ${++n} - ${name}`); } catch (e) { failed++; console.log(`  not ok ${++n} - ${name}\n    ${e.message.split('\n')[0]}`); } };
const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

// ---- 1. The Sovereign's pools: the first one lands on one fighter (x and z from the same pick) ----
check('the Sovereign\'s first pool lands on one fighter, not between two', () => {
  const g = quiet(() => new Game());
  quiet(() => g.setTwist2(null));
  const s = g.sovereign, ps = [0, 1].map(i => { const p = quiet(() => g.addPlayer(null, `S${i}`, 'guardian')); p.x = F2.arena.x - 6 + i * 12; p.z = F2.arena.z - 6 + i * 12; return p; });
  let i = 0; const pick = () => ps[i++ % 2]; // a different fighter on every call
  g.pools = [];
  g.sovMove(s, 'pools', ps[0], ps, pick);
  const first = g.pools[0];
  assert.ok(first, 'a pool');
  assert.ok(ps.some(p => p.x === first.x && p.z === first.z), `on a fighter (${first.x}, ${first.z}; fighters ${ps.map(p => `${p.x}, ${p.z}`).join(' / ')})`);
});

if (failed) { console.log(`${failed} of ${n} failed`); process.exit(1); }
console.log(`all ${n} passed`);
