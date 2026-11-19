// Controls (shared/controls.js): the action list, default bindings, resolving presses, chords, contexts, the conflict
// check, reserved keys, the chord rule, saving only what changed. Pure logic, no browser.
// Usage: node test/controls.js
import assert from 'node:assert/strict';
import {
  ACTIONS, ACTION, GROUPS, DEFAULTS, resolve, check, assign, merged, diff, validate, normalize, axisFromKeys,
  bindingHeld, bindingArmed, bindingLabel, keyName, actionsOn, RESERVED,
  cleanControls, loadBindings, syncPlan, CONTROLS_V, CONTROLS_MAX_BYTES,
} from '../shared/controls.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const H = (...k) => new Set(k);

// ---- the action list ----
{
  const ids = ACTIONS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const a of ACTIONS) {
    assert.ok(GROUPS.includes(a.group), `${a.id}: group`);
    assert.ok(['button', 'hold', 'axis', 'toggle'].includes(a.type), `${a.id}: type`);
    assert.ok(a.label, `${a.id}: label`);
  }
  for (const id of ['move', 'look', 'attack', 'skill1', 'skill2', 'skill3', 'dodge', 'jump', 'guard', 'cover', 'teamBurst', 'lockNext', 'selectAimed', 'clearTarget', 'interact', 'revive', 'item1', 'item2', 'item3', 'bag', 'skillTree', 'players', 'botWheel', 'menu', 'chat', 'perfOverlay', 'turnLeft', 'turnRight', 'zoom'])
    assert.ok(ACTION[id], `contract action ${id}`);
  assert.ok(ACTION.menu.fixed && ACTION.revive.context === 'downedAlly');
  for (const id of ['chat', 'perfOverlay', 'turnLeft', 'turnRight', 'zoom']) assert.ok(ACTION[id].kbmOnly, `${id} is keyboard & mouse only`);
  ok('every contract action is there, with a group, a type and a label');
}

// ---- defaults ----
{
  for (const dev of ['kbm', 'pad']) {
    assert.deepEqual(validate(DEFAULTS[dev], dev), [], `${dev} defaults are clean`);
    for (const a of ACTIONS) if (!(a.kbmOnly && dev === 'pad')) assert.ok(DEFAULTS[dev][a.id], `${dev} default for ${a.id}`);
  }
  for (const a of ACTIONS.filter(a => a.kbmOnly)) assert.equal(DEFAULTS.pad[a.id], undefined, `${a.id} has no pad binding`);
  // today's keys (roadmap K: default keyboard & mouse)
  const K = DEFAULTS.kbm;
  assert.deepEqual(K.move, ['KeyW,KeyA,KeyS,KeyD', 'ArrowUp,ArrowLeft,ArrowDown,ArrowRight']);
  assert.deepEqual(K.attack, ['Mouse0', 'KeyJ']);
  assert.deepEqual(K.bag, ['KeyB', 'KeyI']);
  assert.deepEqual([K.skill1[0], K.skill2[0], K.skill3[0], K.item1[0], K.item2[0], K.item3[0]], ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']);
  assert.deepEqual([K.jump[0], K.guard[0], K.cover[0], K.teamBurst[0], K.lockNext[0], K.interact[0], K.revive[0], K.skillTree[0], K.players[0], K.botWheel[0], K.menu[0], K.chat[0], K.perfOverlay[0], K.turnLeft[0], K.turnRight[0]],
    ['Space', 'KeyR', 'KeyC', 'KeyT', 'Tab', 'KeyF', 'KeyE', 'KeyK', 'KeyP', 'KeyV', 'Escape', 'Enter', 'F3', 'KeyQ', 'KeyE']);
  // the controller layout: face buttons, bumpers, triggers, stick clicks, d-pad, menu buttons, plus the LB layer
  const P = DEFAULTS.pad;
  assert.deepEqual([P.jump[0], P.skill1[0], P.skill2[0], P.skill3[0], P.attack[0], P.dodge[0], P.guard[0], P.lockNext[0], P.bag[0], P.menu[0]], ['A', 'X', 'Y', 'B', 'RT', 'RB', 'LT', 'R3', 'View', 'Start']);
  assert.deepEqual([P.cover[0], P.teamBurst[0], P.botWheel[0], P.selectAimed[0], P.clearTarget[0], P.skillTree[0], P.players[0]], ['LB+A', 'LB+X', 'LB+Y', 'LB+B', 'LB+R3', 'LB+Up', 'LB+Right']);
  assert.ok(!Object.values(P).flat().includes('LB'), 'LB has no action of its own');
  ok('defaults: today\'s keyboard keys, the contract controller layout, no conflicts');
}

// ---- resolving presses ----
{
  const K = DEFAULTS.kbm, P = DEFAULTS.pad;
  const r = (held, code, ctx, dev = 'kbm') => resolve(dev === 'kbm' ? K : P, held, { code }, ctx, dev)?.action ?? null;
  assert.equal(r(H('Digit1'), 'Digit1'), 'skill1');
  assert.equal(r(H('ShiftLeft', 'Digit1'), 'Digit1'), 'skill1', 'Shift+1 is still skill 1 (bound by code)');
  assert.equal(r(H('ShiftRight'), 'ShiftRight'), 'dodge', 'either Shift dodges');
  assert.equal(r(H('KeyI'), 'KeyI'), 'bag', 'the alt slot works');
  assert.equal(r(H('Mouse0'), 'Mouse0'), 'attack');
  assert.equal(r(H('Ctrl', 'Mouse0'), 'Mouse0'), 'selectAimed', 'Ctrl+click beats click');
  assert.equal(r(H('ControlLeft', 'Mouse0'), 'Mouse0'), 'selectAimed', '(Ctrl by its key code too)');
  assert.equal(r(H('Meta', 'Mouse2'), 'Mouse2'), 'clearTarget', 'Cmd+right-click clears');
  assert.equal(r(H('Mouse2'), 'Mouse2'), null, 'a plain right click is unbound (camera drag)');
  assert.equal(r(H('Ctrl', 'ControlLeft'), 'ControlLeft'), null, 'a modifier alone triggers nothing');
  assert.equal(r(H('KeyW'), 'KeyW'), null, 'axis keys never trigger presses');
  assert.equal(r(H('KeyE'), 'KeyE'), 'turnRight', 'E turns...');
  assert.equal(r(H('KeyE'), 'KeyE', H('downedAlly')), 'revive', '...and revives when a downed ally is in reach');
  assert.equal(r(H('Escape'), 'Escape'), 'menu');
  // the pad's modifier layer
  assert.equal(r(H('X'), 'X', undefined, 'pad'), 'skill1');
  assert.equal(r(H('LB', 'X'), 'X', undefined, 'pad'), 'teamBurst', 'LB+X beats X');
  assert.equal(r(H('LB', 'RT'), 'RT', undefined, 'pad'), 'attack', 'no LB binding: the plain one still works');
  assert.equal(r(H('LB'), 'LB', undefined, 'pad'), null, 'LB alone does nothing');
  assert.equal(r(H('Down'), 'Down', undefined, 'pad'), 'interact');
  assert.equal(r(H('Down'), 'Down', H('downedAlly'), 'pad'), 'revive');
  // two-key chord, either order
  const Z = { ...K, cover: ['KeyZ+KeyX', null] };
  assert.equal(resolve(Z, H('KeyZ', 'KeyX'), { code: 'KeyX' })?.action, 'cover');
  assert.equal(resolve(Z, H('KeyZ', 'KeyX'), { code: 'KeyZ' })?.action, 'cover');
  assert.equal(resolve(Z, H('KeyX'), { code: 'KeyX' }), null);
  ok('resolve: codes not characters, alt slots, Ctrl/Cmd chords beat plain clicks, contexts, the pad LB layer, two-key chords');
}

// ---- held, armed, axes, labels ----
{
  assert.ok(bindingHeld('Ctrl+Mouse0', H('ControlRight', 'Mouse0')));
  assert.ok(!bindingHeld('Ctrl+Mouse0', H('Mouse0')));
  assert.ok(bindingArmed('Ctrl+Mouse0', H('Ctrl')), 'Ctrl down arms Ctrl+click (hover preview)');
  assert.ok(!bindingArmed('Mouse0', H('Ctrl')));
  assert.deepEqual(axisFromKeys('KeyW,KeyA,KeyS,KeyD', H('KeyW', 'KeyD')), { x: 1, y: 1 });
  assert.deepEqual(axisFromKeys('KeyW,KeyA,KeyS,KeyD', H('KeyA', 'KeyD', 'KeyS')), { x: 0, y: -1 });
  assert.deepEqual(actionsOn(DEFAULTS.kbm, 'KeyE').map(o => o.action).sort(), ['revive', 'turnRight']);
  assert.equal(bindingLabel('KeyW,KeyA,KeyS,KeyD'), 'WASD');
  assert.equal(bindingLabel('Ctrl+Mouse0'), 'Ctrl+Click');
  assert.equal(bindingLabel(null), 'Not bound');
  assert.equal(keyName('Digit4'), '4'); assert.equal(keyName('ShiftLeft'), 'Shift'); assert.equal(keyName('KeyQ'), 'Q');
  assert.equal(normalize('Shift+Ctrl+KeyZ'), 'Ctrl+Shift+KeyZ');
  ok('held / armed chords, axes from keys, labels, normal form');
}

// ---- the check: reserved, fixed, chords, conflicts ----
{
  const K = DEFAULTS.kbm, P = DEFAULTS.pad;
  for (const b of RESERVED) assert.equal(check(K, 'kbm', 'jump', 0, b).error, 'reserved', `${b} is reserved`);
  assert.equal(check(K, 'kbm', 'jump', 0, 'Shift+Ctrl+KeyT').error, 'reserved', 'reserved in any modifier order');
  assert.equal(check(K, 'kbm', 'menu', 0, 'KeyM').error, 'fixed', 'the menu can\'t be rebound');
  assert.equal(check(K, 'kbm', 'jump', 0, 'Escape').error, 'fixed', 'Esc can\'t be taken');
  assert.equal(check(P, 'pad', 'jump', 0, 'Start').error, 'fixed', 'Start can\'t be taken');
  assert.equal(check(P, 'pad', 'chat', 0, 'A').error, 'kbmOnly');
  assert.equal(check(P, 'pad', 'jump', 1, 'B').error, 'noAlt');
  assert.equal(check(P, 'pad', 'jump', 0, 'LB').error, 'modifier', 'LB alone can\'t be bound');
  assert.equal(check(P, 'pad', 'jump', 0, 'RB+A').error, 'chord', 'only LB is a pad modifier');
  assert.equal(check(K, 'kbm', 'jump', 0, 'KeyW,KeyA,KeyS,KeyD').error, 'axis');
  assert.equal(check(K, 'kbm', 'move', 0, 'KeyW').error, 'axis');
  // chords without timing windows
  assert.equal(check(K, 'kbm', 'cover', 0, 'KeyR+KeyX').error, 'chord', 'R guards, so it can\'t be a chord member');
  assert.equal(check(K, 'kbm', 'cover', 0, 'Shift+KeyX').error, 'chord', 'Shift dodges, so no Shift chords');
  assert.ok(check(K, 'kbm', 'cover', 0, 'Ctrl+KeyZ').ok, 'Ctrl has no action: Ctrl+Z is fine');
  assert.ok(check(K, 'kbm', 'cover', 0, 'KeyZ+KeyX').ok, 'Z and X are free: Z+X is fine');
  const withChord = assign(K, 'kbm', 'cover', 0, 'KeyZ+KeyX').bindings;
  assert.equal(check(withChord, 'kbm', 'jump', 0, 'KeyZ').error, 'chord', 'Z is held for a chord: it can\'t get its own action');
  assert.ok(check(withChord, 'kbm', 'jump', 0, 'KeyX').ok, 'X (the chord\'s trigger) may keep an action of its own');
  assert.equal(check(K, 'kbm', 'jump', 0, 'Ctrl').error, 'chord', 'Ctrl is held for the select chords: no action of its own');
  // conflicts: one key per control and one control per key
  assert.deepEqual(check(K, 'kbm', 'jump', 0, 'KeyB').conflicts, [{ action: 'bag', slot: 0 }]);
  assert.deepEqual(check(K, 'kbm', 'jump', 0, 'KeyI').conflicts, [{ action: 'bag', slot: 1 }], 'alt slots are conflict-checked');
  assert.deepEqual(check(K, 'kbm', 'jump', 0, 'KeyW').conflicts, [{ action: 'move', slot: 0 }], 'a key inside the WASD axis');
  assert.deepEqual(check(K, 'kbm', 'move', 1, 'KeyI,KeyJ,KeyK,KeyL').conflicts.map(c => c.action).sort(), ['attack', 'bag', 'skillTree'], 'an axis over taken keys');
  assert.ok(check(K, 'kbm', 'jump', 0, 'KeyG').ok, 'a free key');
  assert.deepEqual(check(K, 'kbm', 'jump', 0, 'KeyE').conflicts, [{ action: 'turnRight', slot: 0 }], 'E is turn-right (revive overlays it, not jump)');
  assert.ok(check(K, 'kbm', 'revive', 0, 'KeyQ').ok, 'a context action shares keys freely');
  ok('check: reserved and fixed keys, kbm-only, pad slots and LB, axes, chord members, conflicts incl. alt slots and axis keys');
}

// ---- assigning: swap / unbind, saving only changes ----
{
  const K = DEFAULTS.kbm;
  const s = assign(K, 'kbm', 'jump', 0, 'KeyB', 'swap').bindings;
  assert.deepEqual([s.jump[0], s.bag[0]], ['KeyB', 'Space'], 'swap');
  const u = assign(K, 'kbm', 'jump', 0, 'KeyB', 'unbind').bindings;
  assert.deepEqual([u.jump[0], u.bag[0]], ['KeyB', null], 'unbind');
  assert.deepEqual(validate(s, 'kbm'), []); assert.deepEqual(validate(u, 'kbm'), []);
  assert.equal(assign(K, 'kbm', 'jump', 0, 'F5').bindings, K, 'a refused binding changes nothing');
  assert.equal(K.jump[0], 'Space', 'defaults untouched');
  const d = diff('kbm', s);
  assert.deepEqual(d, { jump: ['KeyB', null], bag: ['Space', 'KeyI'] }, 'only the changes are saved');
  assert.deepEqual(merged('kbm', d), s, 'and load back the same');
  assert.deepEqual(merged('kbm', { nope: ['KeyX'], menu: ['KeyM'], jump: 'bad' }), merged('kbm'), 'unknown, fixed and malformed entries dropped');
  assert.equal(merged('pad', { chat: ['A'] }).chat, undefined, 'no kbm-only actions on the pad');
  assert.deepEqual(merged('pad', { jump: ['B', 'Y'] }).jump, ['B', null], 'one slot on the pad');
  ok('assign with swap or unbind; only changes are saved; loading drops unknown, fixed and malformed entries');
}

// ---- saving and account sync (K2) ----
{
  // cleaning: only known, rebindable ids, [main, alt] strings, short access values; v kept (or set)
  const c = cleanControls({ v: 1, kbm: { jump: ['KeyB', null], nope: ['KeyX', null], menu: ['KeyM', null], bag: 'bad', skill1: [42, 'KeyZ', 'KeyY'] },
    pad: { jump: ['B', 'Y'], chat: ['A', null] }, access: { sens: 1.4, invertY: true, bad: { x: 1 }, s: 'x'.repeat(99) }, device: 'pad', quality: 'high' });
  assert.deepEqual(c, { v: 1, kbm: { jump: ['KeyB', null], skill1: [null, 'KeyZ'] }, pad: { jump: ['B', null] }, access: { sens: 1.4, invertY: true } });
  assert.equal(cleanControls(null), null); assert.equal(cleanControls([1]), null); assert.equal(cleanControls('x'), null);
  assert.equal(cleanControls({}).v, CONTROLS_V, 'v is set when missing');
  assert.ok(!('device' in c) && !('quality' in c), 'the device and graphics stay local');
  assert.equal(cleanControls({ v: 1, kbm: { jump: ['K'.repeat(65), null] } }).kbm.jump[0], null, 'over-long bindings dropped');
  assert.ok(CONTROLS_MAX_BYTES === 8192);
  ok('cleanControls keeps only known ids, two slots, short access values and v');

  // loading: a new action's default yields when a saved change took its key; refused saved bindings unbind
  const L = loadBindings('kbm', { jump: ['KeyF', null] }); // F was Interact's
  assert.equal(L.jump[0], 'KeyF'); assert.equal(L.interact[0], null, 'the default on a taken key is dropped');
  assert.deepEqual(validate(L, 'kbm'), []);
  assert.deepEqual(loadBindings('kbm', {}), merged('kbm'), 'no changes: the defaults');
  assert.deepEqual(loadBindings('kbm', { nope: ['KeyX', null] }), merged('kbm'), 'unknown ids dropped');
  assert.equal(loadBindings('kbm', { jump: ['F5', null] }).jump[0], null, 'a reserved key from a save is unbound');
  assert.equal(loadBindings('kbm', { jump: ['Escape', null] }).jump[0], null, 'Esc from a save is unbound');
  // a saved chord whose member has a default single action: the default yields
  const C = loadBindings('kbm', { teamBurst: ['KeyF+KeyG', null] });
  assert.equal(C.teamBurst[0], 'KeyF+KeyG'); assert.equal(C.interact[0], null);
  assert.equal(loadBindings('pad', { skill1: ['A', null] }).jump[0], null, 'pad: Jump yields A to the saved Skill 1');
  ok('loadBindings: saved changes win over defaults on the same key; refused saved bindings unbind');

  // login: the account copy wins when there is one, else the local copy uploads
  const local = { v: 1, kbm: { jump: ['KeyB', null] } }, server = { v: 1, kbm: { jump: ['KeyN', null] }, pad: {} };
  assert.deepEqual(syncPlan(local, server), { use: { v: 1, kbm: { jump: ['KeyN', null] }, pad: {} }, upload: null }, 'server wins');
  assert.deepEqual(syncPlan(local, null), { use: null, upload: { v: 1, kbm: { jump: ['KeyB', null] } } }, 'no server copy: local uploads');
  assert.deepEqual(syncPlan({ v: 1, kbm: { zzz: ['KeyQ', null] } }, null).upload, { v: 1, kbm: {} }, 'unknown ids are not uploaded');
  assert.deepEqual(syncPlan(null, null).upload, { v: CONTROLS_V }, 'nothing local: an empty copy uploads');
  ok('syncPlan: the account copy wins on login, else this browser uploads');
}

console.log(`controls: all ${n} checks passed`);
