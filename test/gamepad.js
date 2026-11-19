// Gamepad reading (shared/gamepad.js, roadmap K1b): deadzones, trigger hysteresis, button edges, the LB modifier
// layer and contexts on the default controller bindings, camera sensitivity / invert-Y, glyph families and labels.
// Pure logic, no browser. Usage: node test/gamepad.js
import assert from 'node:assert/strict';
import { merged } from '../shared/controls.js';
import {
  deadzone, trigger, readButtons, readSticks, padEdges, pressAction, lookFrom, glyphFamily, padLabel, buttonGlyph,
  DEADZONE, TRIGGER_ON, TRIGGER_OFF,
} from '../shared/gamepad.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
// a 17-button, 4-axis standard pad; down: names or indices held; vals: analogue values by index
const NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'Home'];
const fakePad = ({ down = [], vals = {}, axes = [0, 0, 0, 0], mapping = 'standard', id = 'Xbox Wireless Controller' } = {}) => ({
  id, mapping, index: 0, connected: true, axes,
  buttons: NAMES.map((nm, i) => {
    const v = vals[i] ?? (down.includes(nm) ? 1 : 0);
    return { pressed: i === 6 || i === 7 ? v > 0.1 : v > 0.5, value: v };
  }),
});

// ---- deadzone ----
{
  assert.deepEqual(deadzone(0.1, 0.1), { x: 0, y: 0 }, 'inside the zone: nothing');
  assert.deepEqual(deadzone(DEADZONE, 0), { x: 0, y: 0 }, 'on the edge: nothing');
  const full = deadzone(1, 0);
  assert.ok(close(full.x, 1) && full.y === 0, 'full tilt: 1');
  const half = deadzone(0, -(DEADZONE + (1 - DEADZONE) / 2));
  assert.ok(close(half.y, -0.5) && half.x === 0, 'rescaled from the edge');
  const diag = deadzone(0.9, 0.9);
  assert.ok(close(Math.hypot(diag.x, diag.y), 1) && close(diag.x, diag.y), 'radial: diagonals cap at 1, keep the direction');
  assert.deepEqual(deadzone(undefined, NaN), { x: 0, y: 0 }, 'missing axes read as 0');
  ok('stick deadzone: radial, rescaled, capped');
}

// ---- trigger hysteresis ----
{
  assert.equal(trigger(false, TRIGGER_ON - 0.01), false, 'up: needs ON to press');
  assert.equal(trigger(false, TRIGGER_ON), true, 'up: presses at ON');
  assert.equal(trigger(true, (TRIGGER_ON + TRIGGER_OFF) / 2), true, 'down: stays down between OFF and ON');
  assert.equal(trigger(true, TRIGGER_OFF), false, 'down: lets go at OFF');
  // through readButtons: a trigger wobbling around 0.45 after a press doesn't flicker
  let held = new Set(), seen = [];
  for (const v of [0.2, 0.6, 0.45, 0.4, 0.45, 0.31, 0.29, 0.45]) { held = readButtons(fakePad({ vals: { 7: v } }), held); seen.push(held.has('RT')); }
  assert.deepEqual(seen, [false, true, true, true, true, true, false, false]);
  ok('triggers: press at 0.5, release under 0.3, no flicker in between');
}

// ---- buttons, edges, sticks ----
{
  const h = readButtons(fakePad({ down: ['A', 'LB', 'Down'] }));
  assert.deepEqual([...h].sort(), ['A', 'Down', 'LB']);
  assert.deepEqual(padEdges(new Set(['A', 'LB']), new Set(['LB', 'X'])), [{ name: 'A', down: false }, { name: 'X', down: true }]);
  assert.deepEqual(padEdges(h, h), [], 'nothing changed: no edges');
  const s = readSticks(fakePad({ axes: [0, -1, 1, 0] }));
  assert.ok(close(s.LS.y, -1) && s.LS.x === 0, 'left stick: axes 0, 1'); assert.ok(close(s.RS.x, 1) && s.RS.y === 0, 'right stick: axes 2, 3');
  assert.deepEqual(readSticks(fakePad({ axes: [0.1, 0.1, -0.15, 0.05] })), { LS: { x: 0, y: 0 }, RS: { x: 0, y: 0 } }, 'resting drift: still');
  // a pad with old-style number buttons, and one with more buttons than the standard 17
  const odd = { buttons: [1, 0, 0.7], axes: [] };
  assert.deepEqual([...readButtons(odd)], ['A', 'X']);
  assert.ok(readButtons({ buttons: [...fakePad().buttons, { pressed: true, value: 1 }] }).has('B17'), 'extra buttons by raw index');
  assert.deepEqual(readSticks({}), { LS: { x: 0, y: 0 }, RS: { x: 0, y: 0 } }, 'no axes: still');
  ok('buttons by standard index, edges both ways, sticks after the deadzone');
}

// ---- resolving presses on the default controller (the LB layer, contexts) ----
{
  const P = merged('pad', {});
  const act = (name, held = [], ctx = []) => pressAction(P, new Set([...held, name]), name, new Set(ctx))?.action ?? null;
  assert.equal(act('A'), 'jump');
  assert.equal(act('A', ['LB']), 'cover', 'LB+A: cover');
  assert.equal(act('X'), 'skill1');
  assert.equal(act('X', ['LB']), 'teamBurst');
  assert.equal(act('Y'), 'skill2');
  assert.equal(act('Y', ['LB']), 'botWheel');
  assert.equal(act('B'), 'skill3');
  assert.equal(act('B', ['LB']), 'selectAimed');
  assert.equal(act('R3'), 'lockNext');
  assert.equal(act('R3', ['LB']), 'clearTarget');
  assert.equal(act('RT'), 'attack'); assert.equal(act('LT'), 'guard'); assert.equal(act('RB'), 'dodge');
  assert.equal(act('Up'), 'item1'); assert.equal(act('Left'), 'item2'); assert.equal(act('Right'), 'item3');
  assert.equal(act('Up', ['LB']), 'skillTree'); assert.equal(act('Right', ['LB']), 'players');
  assert.equal(act('Left', ['LB']), 'item2', 'LB with an unbound combo: the plain action');
  assert.equal(act('Down'), 'interact');
  assert.equal(act('Down', [], ['downedAlly']), 'revive', 'D-pad down next to a downed ally: revive');
  assert.equal(act('View'), 'bag'); assert.equal(act('Start'), 'menu');
  assert.equal(act('LB'), null, 'LB alone does nothing');
  assert.equal(act('L3'), null, 'L3 unbound');
  assert.equal(act('X', ['RB']), 'skill1', 'only LB is a modifier');
  // rebound: the pad follows the player's bindings
  const R = merged('pad', { skill1: ['RB'], dodge: ['X'] });
  assert.equal(pressAction(R, new Set(['RB']), 'RB')?.action, 'skill1');
  assert.equal(pressAction(R, new Set(['X']), 'X')?.action, 'dodge');
  ok('default controller: every button, the LB layer, the revive context, rebinding');
}

// ---- camera stick: sensitivity, invert-Y ----
{
  assert.deepEqual(lookFrom({ x: 0.5, y: -1 }), { x: 0.5, y: 1 }, 'stick up = look up');
  assert.deepEqual(lookFrom({ x: 0.5, y: -1 }, { sens: 2 }), { x: 1, y: 2 });
  assert.deepEqual(lookFrom({ x: 0.5, y: -1 }, { invertY: true }), { x: 0.5, y: -1 });
  assert.deepEqual(lookFrom({ x: 1, y: 0 }, { sens: 'x' }), { x: 1, y: -0 }, 'a bad sensitivity reads as 1');
  ok('camera stick: sensitivity and invert-Y');
}

// ---- glyphs ----
{
  assert.equal(glyphFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  assert.equal(glyphFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'sony');
  assert.equal(glyphFamily('054c-09cc-Wireless Controller'), 'sony');
  assert.equal(glyphFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'nintendo');
  assert.equal(glyphFamily('Generic USB Joystick'), 'xbox', 'anything else: Xbox names');
  assert.equal(glyphFamily(undefined), 'xbox');
  assert.equal(buttonGlyph('A', 'sony'), '✕'); assert.equal(buttonGlyph('Y', 'sony'), '△');
  assert.equal(buttonGlyph('A', 'nintendo'), 'B', 'Nintendo: the bottom button is B');
  assert.equal(padLabel('LB+X', 'xbox'), 'LB+X');
  assert.equal(padLabel('LB+X', 'sony'), 'L1+□');
  assert.equal(padLabel('Down', 'sony'), 'D-pad ↓');
  assert.equal(padLabel('RT', 'nintendo'), 'ZR');
  assert.equal(padLabel(null), 'Not bound');
  ok('glyph family from the pad id; labels per family');
}

console.log(`gamepad: ${n} passed`);
