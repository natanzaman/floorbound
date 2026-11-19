// Menu focus navigation (public/focusnav.js, roadmap K1b): the DOM-free parts. Picking the nearest element in a
// direction from rects, the stick as a direction, held-direction repeat, item keys. Usage: node test/focusnav.js
import assert from 'node:assert/strict';
import { pickNext, stickDir, repeatStep, navKey, REPEAT_DELAY, REPEAT_RATE } from '../public/focusnav.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const R = (id, x, y, w = 100, h = 30) => ({ id, x, y, w, h });
const id = r => r?.id ?? null;

// ---- a vertical menu (the Game Menu) ----
{
  const menu = ['resume', 'settings', 'controls', 'char'].map((k, i) => R(k, 100, 100 + i * 40));
  assert.equal(id(pickNext(null, menu, 'Down')), 'resume', 'nothing focused: the first in reading order');
  assert.equal(id(pickNext(null, [...menu].reverse(), 'Down')), 'resume', '(whatever the DOM order)');
  assert.equal(id(pickNext(menu[0], menu, 'Down')), 'settings');
  assert.equal(id(pickNext(menu[1], menu, 'Up')), 'resume');
  assert.equal(pickNext(menu[3], menu, 'Down'), null, 'the bottom: stays (no wrap)');
  assert.equal(pickNext(menu[0], menu, 'Left'), null, 'nothing to the left');
  assert.equal(pickNext(menu[0], [], 'Down'), null);
  ok('a column: down / up step one item; edges stay put; no focus starts at the top');
}

// ---- a grid and offset rows (the Bag, class cards) ----
{
  // a row of three cards over a wide button
  const cards = [R('a', 0, 0, 90, 120), R('b', 100, 0, 90, 120), R('c', 200, 0, 90, 120)], enter = R('enter', 0, 140, 290, 30);
  const all = [...cards, enter];
  assert.equal(id(pickNext(cards[0], all, 'Right')), 'b');
  assert.equal(id(pickNext(cards[1], all, 'Right')), 'c');
  assert.equal(id(pickNext(cards[2], all, 'Left')), 'b');
  assert.equal(id(pickNext(cards[2], all, 'Down')), 'enter', 'the wide button below, though its centre is off to the side');
  assert.equal(id(pickNext(enter, all, 'Up')), 'b', 'up from a wide button: the one straight above its centre');
  // a row's buttons: straight below beats nearer but off to the side
  const row1 = [R('eq1', 300, 0, 60, 20), R('drop1', 370, 0, 60, 20)], row2 = [R('eq2', 300, 60, 60, 20), R('drop2', 370, 60, 60, 20)], near = R('side', 450, 25, 60, 20);
  const bag = [...row1, ...row2, near];
  assert.equal(id(pickNext(row1[1], bag, 'Down')), 'drop2', 'straight below beats a nearer one off to the side');
  assert.equal(id(pickNext(row2[0], bag, 'Right')), 'drop2');
  assert.equal(id(pickNext(row1[1], bag, 'Right')), 'side', 'right: the one that overlaps sideways if any');
  ok('grids and offset rows: straight lines first, sideways overlap beats distance');
}

// ---- the stick and repeat ----
{
  assert.equal(stickDir({ x: 0, y: 0 }), null);
  assert.equal(stickDir({ x: 0.3, y: -0.4 }), null, 'a small tilt: no direction');
  assert.equal(stickDir({ x: 0.2, y: -0.9 }), 'Up', 'y down convention: pushed up');
  assert.equal(stickDir({ x: 0.2, y: 0.9 }), 'Down');
  assert.equal(stickDir({ x: 0.8, y: 0.6 }), 'Right', 'the larger axis wins');
  assert.equal(stickDir({ x: -0.7, y: 0 }), 'Left');
  assert.equal(stickDir(undefined), null);
  const r = { dir: null, next: 0 };
  assert.equal(repeatStep(r, null, 0), false, 'nothing held');
  assert.equal(repeatStep(r, 'Down', 1000), true, 'a new direction moves at once');
  assert.equal(repeatStep(r, 'Down', 1000 + REPEAT_DELAY - 1), false, 'held: waits the delay');
  assert.equal(repeatStep(r, 'Down', 1000 + REPEAT_DELAY), true, 'then repeats');
  assert.equal(repeatStep(r, 'Down', 1000 + REPEAT_DELAY + REPEAT_RATE - 1), false);
  assert.equal(repeatStep(r, 'Down', 1000 + REPEAT_DELAY + REPEAT_RATE), true, 'every rate while held');
  assert.equal(repeatStep(r, 'Right', 1000 + REPEAT_DELAY + REPEAT_RATE + 5), true, 'a change of direction: at once');
  assert.equal(repeatStep(r, null, 3000), false, 'let go');
  assert.equal(repeatStep(r, 'Right', 3001), true, 'pressed again: at once');
  ok('stick direction past half tilt; a held direction repeats after a delay');
}

// ---- item keys (focus restore) ----
{
  const el = (tag, o = {}) => ({ tagName: tag, dataset: o.data || {}, id: o.id || '', name: o.name, value: o.value, textContent: o.text || '', getAttribute: () => null });
  assert.equal(navKey(el('BUTTON', { data: { nav: 'play-3', id: '3' } })), 'play-3', 'data-nav first');
  assert.equal(navKey(el('BUTTON', { id: 'enter' })), '#enter');
  assert.equal(navKey(el('BUTTON', { data: { a: 'equip', u: '12' } })), 'BUTTON?a=equip&u=12', 'data-* attributes, sorted');
  assert.equal(navKey(el('BUTTON', { data: { u: '12', a: 'equip' } })), 'BUTTON?a=equip&u=12');
  assert.notEqual(navKey(el('BUTTON', { data: { a: 'equip', u: '12' } })), navKey(el('BUTTON', { data: { a: 'drop', u: '12' } })));
  assert.equal(navKey(el('INPUT', { name: 'gq', value: 'low' })), 'INPUT:gq=low', 'radios: name and value');
  assert.equal(navKey(el('BUTTON', { text: '  Resume ' })), 'BUTTON"Resume', 'else the text');
  ok('item keys: data-nav, id, data-*, name / value, text');
}

console.log(`focusnav: ${n} passed`);
