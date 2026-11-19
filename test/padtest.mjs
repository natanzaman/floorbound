// Scripted controller "bots" (roadmap K4): plays the game through a fake standard pad only (navigator.getGamepads(),
// 17 buttons, 4 axes) and checks game state, not frame timing: positions, cooldowns, HP, the messages the client sends
// and what the server says back. Presses are held for N polled frames (__fb.input.frames).
//   1. main flow on the default layout: join by pad, move, camera, lock on / cycle / clear, attack, skills 1-3, dodge,
//      jump, guard, items, interact, Game Menu, Settings, Bag, Skill Tree, Players, close everything
//   2. the same flow on a rebound layout (input.setBinding with swaps; the script looks every button up in the bindings)
//   3. the modifier layer and chords: LB+X Team Burst, LB+Y bot wheel (hold) + right-stick pick, LB+A cover, LB+B select
//      aimed, LB+R3 clear, LB+Up / LB+Right panels, and LB alone does nothing
//   4. the Warden in a party with bots, fought on the pad, with a jump registered during a Quake Ring
// Then it prints a coverage table: each action of shared/controls.js and where it was verified on the pad.
// Not here (K4 part 2): rebinding through the Controls screen. Needs Playwright for Node (see test/keys.mjs).
// Usage: PORT=376xx node test/padtest.mjs      (uses PORT .. PORT+3; ONLY=1,2,3,4 picks sections)
import assert from 'node:assert/strict';
import { ACTIONS } from '../shared/controls.js';
import { openPad, startServer, Coverage, sleep, angDiff, BTN } from './padlib.mjs';
const { chromium } = await loadPW();
async function loadPW() { return import(process.env.PLAYWRIGHT || 'playwright'); }

const PORT = +(process.env.PORT || 37600);
const ONLY = (process.env.ONLY || '1,2,3,4').split(',').map(Number);
let n = 0;
const ok = (tag, name) => console.log(`  ok ${++n} - [${tag}] ${name}`);
const cov = new Coverage();
const errors = [];
let browser;
const servers = [];
const stopAll = async () => { await browser?.close(); for (const s of servers) s.stop(); };

// ---------------------------------------------------------------------------------------------------------------
// Sections 1 and 2: the main flow. `tag` names the layout ('default' / 'rebound'); buttons come from the bindings.
// ---------------------------------------------------------------------------------------------------------------
async function mainFlow(tag, port, rebind) {
  const srv = await startServer(port); servers.push(srv);
  const P = await openPad(browser, srv.base, { onError: m => errors.push(`${tag}: ${m}`) });
  const { S, frames, mark, sent, press, tap, hold, ready, keepAlive, clearTarget } = P;
  const C = (action, how) => cov.mark(tag, action, how);
  if (rebind) {
    for (const [action, btn] of rebind) {
      const r = await S(([a, b]) => window.__fb.input.setBinding('pad', a, 0, b, 'swap'), [action, btn]);
      assert.ok(!r.error, `rebind ${action} -> ${btn}: ${r.error}`);
    }
  }
  const layout = await S(() => { const b = window.__fb.input.bindings('pad'); return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v[0]])); });
  if (rebind) for (const [action, btn] of rebind) assert.equal(layout[action], btn, `${action} is on ${btn} now`);
  if (rebind) assert.equal(await S(() => JSON.parse(localStorage.getItem('fb_controls')).pad.jump[0]), layout.jump, 'rebinding saved');

  // ---- join by pad ----
  await P.join(`Pad${tag[0]}`, 'guardian');
  assert.equal(await S(() => window.__fb.state.cls), 'guardian');
  ok(tag, 'joined by pad (character select: d-pad, A picks the class, A on Enter)');
  C('menu', 'Start opens / closes the Game Menu');

  // ---- move along a path (left stick), relative to the camera ----
  await clearTarget();
  const leg = async (ax, expectDir, label) => {
    const a = await P.st();
    await P.axes(ax); await frames(10); await P.axes([0, 0, 0, 0]); await frames(2);
    const b = await P.st();
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    assert.ok(d > 0.4, `${label}: moved (${d.toFixed(2)} m)`);
    const want = a.yaw + expectDir;
    assert.ok(angDiff(Math.atan2(dx, dz), want) < 0.35, `${label}: heading ${Math.atan2(dx, dz).toFixed(2)} vs ${want.toFixed(2)}`);
    return d;
  };
  await leg([0, 1, 0, 0], Math.PI, 'stick down (back)'); // (backwards first: the gate is ahead of the spawn)
  await leg([0, -1, 0, 0], 0, 'stick up (forward)');
  await leg([1, 0, 0, 0], -Math.PI / 2, 'stick right (strafe right)');
  await leg([-1, 0, 0, 0], Math.PI / 2, 'stick left (strafe left)');
  ok(tag, 'left stick walks a path: back, forward, right, left, relative to the camera');
  C('move', 'left stick: four legs, position and heading');

  // ---- camera: right stick turns and tilts ----
  {
    const a = await P.st();
    await P.axes([0, 0, 1, 0]); await frames(6); await P.axes([0, 0, 0, 0]); await frames(1);
    const b = await P.st();
    assert.ok(b.yaw < a.yaw - 0.05, 'right stick right turns right');
    await P.axes([0, 0, -1, 0]); await frames(8); await P.axes([0, 0, 0, 0]); await frames(1);
    const c = await P.st();
    assert.ok(c.yaw > b.yaw + 0.05, 'and left turns left');
    await P.axes([0, 0, 0, 1]); await frames(6); await P.axes([0, 0, 0, 0]); await frames(1);
    const d = await P.st();
    assert.notEqual(d.pitch, c.pitch, 'right stick down tilts the camera');
  }
  ok(tag, 'right stick turns the camera both ways and tilts it');
  C('look', 'right stick: yaw both ways, pitch');

  // ---- lock on, cycle, clear ----
  await keepAlive();
  await p_waitMob(P);
  await clearTarget();
  const lockKeys = await P.keys('lockNext');
  await tap('lockNext');
  const first = await S(() => window.__fb.state.lock);
  assert.ok(first > 0, `${lockKeys} locks on`);
  await tap('lockNext');
  const second = await S(() => window.__fb.state.lock);
  assert.notEqual(second, first, 'again: the next target (or none when only one is in reach)');
  if (!second) await tap('lockNext');
  assert.ok(await S(() => window.__fb.state.lock) > 0, 'locked on again');
  await tap('clearTarget');
  assert.equal(await S(() => window.__fb.state.lock), 0, 'the clear chord clears the target');
  ok(tag, 'lock on, cycle, clear target');
  C('lockNext', 'locks on / cycles'); C('clearTarget', 'clears');

  // ---- attack: held trigger swings, release stops ----
  await keepAlive(); await ready(0);
  let m = await mark();
  const stopAtk = await hold('attack'); await frames(4);
  assert.ok((await sent(m, 'skill')).some(o => o.slot === 0), 'holding attack swings');
  await stopAtk();
  await sleep(900); m = await mark(); await frames(3);
  assert.equal((await sent(m, 'skill')).length, 0, 'releasing stops');
  ok(tag, 'attack while held, stops on release');
  C('attack', 'hold sends basic attacks, release stops');

  // ---- skills 1-3 ----
  for (const slot of [1, 2, 3]) {
    await keepAlive(); await ready(slot); m = await mark();
    await tap(`skill${slot}`);
    assert.deepEqual((await sent(m, 'skill')).map(o => o.slot), [slot], `skill ${slot}`);
    assert.ok(await S(s => window.__fb.state.ready[s] > performance.now(), slot), `skill ${slot} is on cooldown`);
    C(`skill${slot}`, 'sends the skill, cooldown starts');
  }
  ok(tag, 'skills 1, 2, 3: each sends its slot and starts its cooldown');

  // ---- dodge, jump ----
  await p_clear(P);
  m = await mark(); await tap('dodge', 1);
  assert.equal((await sent(m, 'dodge')).length, 1, 'dodge sent');
  await P.p.waitForFunction(() => !window.__fb.state.roll, null, { timeout: 5000 });
  C('dodge', 'sends dodge, roll state');
  await P.p.waitForFunction(() => performance.now() > window.__fb.state.jumpReady, null, { timeout: 5000 });
  m = await mark(); await tap('jump', 1);
  assert.equal((await sent(m, 'jump')).length, 1, 'jump sent');
  assert.ok(await S(() => window.__fb.state.jumpPress > performance.now() - 400), 'jump state');
  C('jump', 'sends jump, airborne state');
  ok(tag, 'dodge and jump');

  if (rebind) { // the modifier layer survives a rebind: LB+X is still Team Burst although X is Jump now
    await P.p.waitForFunction(() => performance.now() > window.__fb.state.jumpReady, null, { timeout: 5000 });
    m = await mark(); await tap('teamBurst', 1);
    assert.equal((await sent(m, 'burst')).length, 1, 'LB+X: Team Burst'); assert.equal((await sent(m, 'jump')).length, 0, 'not the rebound jump');
    C('teamBurst', 'rebound: LB+X still Team Burst while X is jump');
  }

  // ---- guard ----
  m = await mark();
  const lower = await hold('guard'); await frames(3);
  assert.deepEqual((await sent(m, 'guard')).map(o => o.on), [true], 'guard up while held');
  await lower();
  assert.deepEqual((await sent(m, 'guard')).map(o => o.on), [true, false], 'guard down on release');
  ok(tag, 'guard while held (Guardian)');
  C('guard', 'hold raises, release lowers');

  // ---- items ----
  await S(() => window.__fb.send({ type: 'test', hurt: 0.5 }));
  await P.p.waitForFunction(() => window.__fb.state.hp < window.__fb.state.maxHp, null, { timeout: 5000 });
  m = await mark(); await tap('item1');
  assert.deepEqual((await sent(m, 'use')).map(o => o.id), ['potion'], 'potion');
  C('item1', 'drinks a potion');
  const inv = await S(() => window.__fb.state.inv.cons);
  for (const [a, id, name] of [['item2', 'tonic', 'Tonic'], ['item3', 'draught', 'Draught']]) {
    m = await mark(); await tap(a);
    if (inv[id] > 0) assert.deepEqual((await sent(m, 'use')).map(o => o.id), [id], `${a} uses ${id}`);
    else assert.match(await S(() => document.getElementById('log').lastElementChild?.textContent || ''), new RegExp(name, 'i'), `${a} tries the ${id}`);
    C(a, inv[id] > 0 ? `uses the ${id}` : `tries the ${id} (none left: log line)`);
  }
  ok(tag, 'items: potion, tonic, draught');

  // ---- interact (ready at the raid gate) ----
  assert.ok(await S(() => !window.__fb.state.gateOpen && Math.abs(window.__fb.state.x) < 12 && window.__fb.state.z > 138 && window.__fb.state.z < 158), 'in the gate zone');
  m = await mark(); await tap('interact');
  assert.equal((await sent(m, 'ready')).length, 1, 'interact readies at the gate');
  await tap('interact'); // (un-ready)
  ok(tag, 'interact readies at the raid gate');
  C('interact', 'ready / un-ready at the raid gate');

  // ---- menus ----
  await press(['Start'], 2);
  assert.ok(await P.isOpen('gamemenu'), 'Start opens the Game Menu');
  assert.equal((await P.cur()).key, 'BUTTON?a=resume');
  await press(['Down']); assert.equal((await P.cur()).key, 'BUTTON?a=settings');
  await press(['A']);
  assert.ok(await P.isOpen('settings'), 'A opens Settings');
  await P.goTo('INPUT?a=sens');
  const s0 = await S(() => +document.querySelector('#settings [data-a=sens]').value);
  await press(['Right']);
  assert.ok(Math.abs(await S(() => +document.querySelector('#settings [data-a=sens]').value) - (s0 + 0.1)) < 1e-6, 'Settings: the slider moved');
  await press(['Left']);
  await press(['B']);
  assert.ok(!(await P.isOpen('settings')) && await P.isOpen('gamemenu'), 'B backs out to the Game Menu');
  await P.p.waitForTimeout(450); await press(['Start'], 2);
  assert.ok(!(await P.isOpen('gamemenu')), 'Start closes it');
  ok(tag, 'Game Menu and Settings: open, navigate, change a slider, back out, close');
  await tap('bag');
  assert.ok(await P.isOpen('bag'), 'the Bag opens'); assert.equal((await P.cur()).layer, 'bag');
  await press(['Down']);
  await press(['B']); assert.ok(!(await P.isOpen('bag')), 'B closes the Bag');
  C('bag', 'opens, navigable, B closes');
  await tap('skillTree'); await frames(2);
  assert.ok(await S(() => !document.getElementById('talentsp').classList.contains('hidden')), 'Skill Tree opens');
  assert.equal((await P.cur()).layer, 'talentsp');
  await press(['B']); assert.ok(await S(() => document.getElementById('talentsp').classList.contains('hidden')), 'B closes it');
  C('skillTree', 'opens, navigable, B closes');
  await tap('players'); await frames(2);
  assert.ok(await P.visible('players'), 'Players opens');
  await press(['Start'], 2); assert.ok(!(await P.visible('players')), 'Start closes Players');
  assert.ok(!(await P.isOpen('gamemenu')), '(without the Game Menu)');
  C('players', 'opens, Start closes');
  assert.equal(await S(() => window.__fb.panels.isOpen()), false, 'everything is closed');
  ok(tag, 'Bag, Skill Tree and Players open by pad, navigate, close; nothing left open');

  // ---- revive: the context layer (a downed ally in reach). main.js sets the context every frame, so no ally is staged:
  // the live pad bindings are resolved with the context on and off instead ----
  {
    const t = (await P.keys('revive')).join('+');
    const r = await S(async () => {
      const { resolve } = await import('/shared/controls.js');
      const b = window.__fb.input.bindings('pad'), held = new Set();
      const on = resolve(b, held, { code: window.__fb.input.bindings('pad').revive[0] }, new Set(['downedAlly']), 'pad');
      const off = resolve(b, held, { code: window.__fb.input.bindings('pad').revive[0] }, new Set(), 'pad');
      return [on?.action, off?.action];
    });
    assert.equal(r[0], 'revive', `${t} with a downed ally in reach is revive`);
    assert.equal(r[1], 'interact', `${t} otherwise is interact`);
    C('revive', 'bindings resolve only (no downed ally staged): context on = revive, off = interact');
  }
  ok(tag, 'revive resolves on the pad when the downed-ally context is on');

  assert.deepEqual(errors.filter(e => e.startsWith(tag)), [], `${tag}: no page errors`);
  await P.p.close(); srv.stop();
}
const p_waitMob = P => P.p.waitForFunction(() => [...window.__fb.mobs.values()].some(e => !e.dying && !e.hidden && Math.hypot(e.x - window.__fb.state.x, e.z - window.__fb.state.z) < 22), null, { timeout: 30000 });
const p_clear = async P => { await P.clearTarget(); await P.keepAlive(); };

// ---------------------------------------------------------------------------------------------------------------
// Section 3: the modifier layer and chords (default layout), with bots in the party for the wheel.
// ---------------------------------------------------------------------------------------------------------------
async function chords(port) {
  const tag = 'chords';
  const srv = await startServer(port); servers.push(srv);
  const P = await openPad(browser, srv.base, { onError: m => errors.push(`${tag}: ${m}`) });
  const { S, frames, mark, sent, press, ready, keepAlive, clearTarget } = P;
  const C = (action, how) => cov.mark(tag, action, how);
  await P.join('Chords', 'guardian');
  try {
    await P.addBots(['swordsman', 'cleric'], 'stay', 3);
    assert.ok(await S(() => !!window.__fb.state.party), 'in a party with bots');
    await keepAlive();

    // LB alone does nothing (neither the press nor the release), and the modifier does not leak into the bare button
    await P.axes([0, 0, 0, 0]);
    let m = await mark();
    await press(['LB'], 3);
    const alone = (await S(m => window.__sent.slice(m).filter(o => !['input', 'target', 'ping'].includes(o.type)), m));
    assert.deepEqual(alone, [], `LB alone sends nothing (${JSON.stringify(alone)})`);
    assert.ok(!(await P.isOpen()) && !(await P.visible('botwheel')), 'and opens nothing');
    ok(tag, 'LB alone does nothing');

    // LB+X: Team Burst, not skill 1
    await ready(1); m = await mark();
    await press(['LB', 'X'], 2);
    assert.equal((await sent(m, 'burst')).length, 1, 'LB+X presses Team Burst');
    assert.equal((await sent(m, 'skill')).filter(o => o.slot === 1).length, 0, 'and is not skill 1');
    C('teamBurst', 'LB+X sends burst, not skill 1');
    // X alone is skill 1
    m = await mark(); await press(['X'], 2);
    assert.deepEqual((await sent(m, 'skill')).map(o => o.slot), [1], 'X alone: skill 1');
    ok(tag, 'LB+X is Team Burst, X alone is skill 1');

    // LB+A: Cover (Guardian), A alone jumps
    await P.p.waitForFunction(() => performance.now() > window.__fb.state.jumpReady, null, { timeout: 5000 });
    m = await mark(); await press(['LB', 'A'], 2);
    assert.equal((await sent(m, 'cover')).length, 1, 'LB+A covers');
    assert.equal((await sent(m, 'jump')).length, 0, 'and does not jump');
    C('cover', 'LB+A sends cover (Guardian), no jump');
    m = await mark(); await press(['A'], 1);
    assert.equal((await sent(m, 'jump')).length, 1, 'A alone jumps');
    ok(tag, 'LB+A is Cover (Guardian), A alone is jump');

    // LB+Y: the bot wheel while held; the right stick picks an order; releasing gives it
    await keepAlive(); await ready(2).catch(async e => { throw new Error(`skill 2 not ready: ${JSON.stringify(await S(() => ({ r: window.__fb.state.ready, now: performance.now() })))}`); });
    m = await mark();
    await P.btn('LB', true); await P.btn('Y', true); await frames(2);
    assert.ok(await P.visible('botwheel'), 'LB+Y (held) opens the bot wheel');
    assert.equal((await sent(m, 'skill')).length, 0, 'and is not skill 2');
    await P.p.waitForTimeout(400);
    await P.axes([0, 0, 0, -1]); await frames(3); // right stick up
    const pick = await S(() => document.querySelector('#botwheel .wcmd.pick')?.dataset.c || null);
    assert.ok(pick, 'the right stick points at an order');
    await P.axes([0, 0, 0, 0]); await frames(1);
    await P.btn('Y', false); await P.btn('LB', false); await frames(3);
    assert.ok(!(await P.visible('botwheel')), 'releasing gives the order and closes the wheel');
    const cmds = await sent(m, 'botcmd');
    assert.deepEqual(cmds.map(o => o.cmd), [pick], 'the picked order was sent');
    C('botWheel', `LB+Y hold, right stick picks "${pick}", release sends botcmd`);
    // held and released on nothing: cancels
    m = await mark();
    await P.btn('LB', true); await P.btn('Y', true); await frames(2); await P.p.waitForTimeout(450);
    await P.btn('Y', false); await P.btn('LB', false); await frames(3);
    assert.ok(!(await P.visible('botwheel')) && (await sent(m, 'botcmd')).length === 0, 'released on nothing: closed, no order');
    ok(tag, 'LB+Y holds the bot wheel, the right stick picks, release gives the order (or cancels)');

    // LB+B: select what you aim at (B alone is skill 3)
    await p_waitMob(P).catch(() => {});
    await clearTarget();
    {
      let got = 0; const mB = await mark();
      for (let i = 0; i < 16 && !got; i++) { // sweep the camera with the right stick until something is under the crosshair
        await keepAlive();
        await press(['LB', 'B'], 2);
        got = await S(() => window.__fb.state.lock || window.__fb.state.focus);
        if (!got) { await P.axes([1, 0, 1, 0].map((v, k) => (k === 2 ? 1 : 0))); await frames(5); await P.axes([0, 0, 0, 0]); await frames(1); }
      }
      assert.equal((await sent(mB, 'skill')).filter(o => o.slot === 3).length, 0, 'LB+B is not skill 3');
      assert.ok(got, 'LB+B selects what the crosshair is on');
    }
    C('selectAimed', 'LB+B selects the aimed target');
    await press(['LB', 'R3'], 2);
    assert.equal(await S(() => window.__fb.state.lock || window.__fb.state.focus), 0, 'LB+R3 clears');
    C('clearTarget', 'LB+R3 clears');
    await ready(3); m = await mark(); await press(['B'], 2);
    assert.deepEqual((await sent(m, 'skill')).map(o => o.slot), [3], 'B alone: skill 3');
    ok(tag, 'LB+B selects the aimed target, LB+R3 clears it, B alone is skill 3');

    // LB+Up: Skill Tree, LB+Right: Players (and the bare d-pad buttons are items)
    await press(['LB', 'Up'], 2); await frames(2);
    assert.ok(await S(() => !document.getElementById('talentsp').classList.contains('hidden')), 'LB+Up opens the Skill Tree');
    await press(['Start'], 2);
    await press(['LB', 'Right'], 2); await frames(2);
    assert.ok(await P.visible('players'), 'LB+Right opens Players');
    await press(['Start'], 2);
    await S(() => window.__fb.send({ type: 'test', hurt: 0.5 }));
    await P.p.waitForFunction(() => window.__fb.state.hp < window.__fb.state.maxHp, null, { timeout: 5000 });
    m = await mark(); await press(['Up'], 2);
    assert.deepEqual((await sent(m, 'use')).map(o => o.id), ['potion'], 'Up alone: potion');
    assert.ok(!(await P.visible('talentsp')), 'and no Skill Tree');
    C('skillTree', 'LB+Up opens'); C('players', 'LB+Right opens');
    ok(tag, 'LB+Up Skill Tree, LB+Right Players, bare Up is the potion');
    assert.deepEqual(errors.filter(e => e.startsWith(tag)), [], `${tag}: no page errors`);
  } finally { /* the bots go with the page */ }
  await P.p.close(); srv.stop();
}

// ---------------------------------------------------------------------------------------------------------------
// Section 4: the Warden in a party with bots, fought on the pad, jumping a Quake Ring.
// ---------------------------------------------------------------------------------------------------------------
async function warden(port) {
  const tag = 'warden';
  const srv = await startServer(port); servers.push(srv);
  const P = await openPad(browser, srv.base, { onError: m => errors.push(`${tag}: ${m}`) });
  const { S, frames, mark, sent, press, keepAlive } = P;
  const C = (action, how) => cov.mark(tag, action, how);
  await P.join('Wardenpad', 'guardian');
  try {
    await P.addBots(['swordsman', 'cleric', 'ranger'], 'warden', 2);
    ok(tag, 'in a party with three bots');
    // ready at the gate by pad; the bots ready themselves
    await keepAlive();
    for (let i = 0; i < 40 && !(await S(() => window.__fb.state.gateOpen)); i++) {
      if (!(await S(() => window.__fb.state.meReady))) await P.tap('interact');
      await P.p.waitForTimeout(500);
    }
    await P.p.waitForFunction(() => window.__fb.state.gateOpen, null, { timeout: 60000 });
    ok(tag, 'the raid gate opened (readied by pad)');
    await P.p.waitForFunction(() => [...window.__fb.mobs.values()].some(e => /Horned Warden/.test(e.def?.name)), null, { timeout: 30000 });
    const boss = () => S(() => { const e = [...window.__fb.mobs.values()].find(e => /Horned Warden/.test(e.def?.name)); return e ? { id: e.id, x: e.x, z: e.z, hp: e.hp, maxHp: e.maxHp ?? e.def.hp, dead: e.dying } : null; });
    const faceTo = async (x, z) => { // right stick until the camera looks at (x, z)
      for (let i = 0; i < 12; i++) {
        const s = await P.st(); const want = Math.atan2(x - s.x, z - s.z);
        const diff = Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw));
        if (Math.abs(diff) < 0.25) return;
        await P.axes([0, 0, diff > 0 ? -1 : 1, 0]); await frames(Math.abs(diff) > 1 ? 4 : 1); await P.axes([0, 0, 0, 0]); await frames(1);
      }
    };
    // walk to the Warden with the stick
    for (let i = 0; i < 60; i++) {
      const b = await boss(), s = await P.st();
      if (!b) break;
      if (Math.hypot(b.x - s.x, b.z - s.z) < 5.5) break;
      await keepAlive(); await faceTo(b.x, b.z);
      await P.axes([0, -1, 0, 0]); await frames(6); await P.axes([0, 0, 0, 0]); await frames(1);
    }
    { const b = await boss(), s = await P.st(); assert.ok(Math.hypot(b.x - s.x, b.z - s.z) < 9, `reached the Warden (${Math.hypot(b.x - s.x, b.z - s.z).toFixed(1)} m)`); }
    C('move', 'left stick across the arena to the boss');
    ok(tag, 'walked to the Warden on the left stick, camera on the right');

    // lock on with R3 (cycle until it is the Warden)
    for (let i = 0; i < 8; i++) { const b = await boss(); if (b && (await S(() => window.__fb.state.lock)) === b.id) break; await P.tap('lockNext'); }
    assert.equal(await S(() => window.__fb.state.lock), (await boss()).id, 'locked on the Warden');
    ok(tag, 'R3 locked on the Warden');

    // the fight
    const hp0 = (await boss()).hp;
    let attempts = 0, jumped = 0, hits0 = 0;
    const stopAtk = await P.hold('attack');
    const t0 = Date.now(), LIMIT = +(process.env.FIGHT_SECS || 240) * 1000;
    let seenQuakes = 0, nextSkill = 1;
    const jumpAction = (await P.keys('jump'))[0];
    const floatJumped = () => S(() => window.__fb.floatLog.filter(f => /Jumped!/.test(f.text)).length);
    while (Date.now() - t0 < LIMIT) {
      const s = await P.st(), b = await boss();
      if (!b || b.dead) break;
      if (s.dead) { await P.p.waitForTimeout(1000); continue; }
      if (s.hp < s.maxHp * 0.5) await keepAlive(); // (test aid: stay up so the ring can be jumped)
      const d = Math.hypot(b.x - s.x, b.z - s.z);
      if (s.lock !== b.id) await P.tap('lockNext', 1);
      if (d > 6) { await faceTo(b.x, b.z); await P.axes([0, -1, 0, 0]); await frames(3); await P.axes([0, 0, 0, 0]); }
      // a Quake Ring was announced: jump when its wavefront gets to us (jump = the airborne window 0.08-0.58 s after take-off)
      const qs = await S(() => window.__quakes.splice(0));
      for (const q of qs) {
        seenQuakes++;
        const now = await S(() => performance.now());
        const dist = Math.hypot(q.x - s.x, q.z - s.z);
        if (dist > q.max) continue;
        const front = q.at + q.d * 1000 + (dist / q.sp) * 1000;
        const wait = front - 330 - now - 60; // aim the take-off 0.33 s before the front arrives (the middle of the window), less a poll
        if (wait < -150) continue;
        attempts++;
        await P.btn(jumpAction, false);
        await S(([ms, i]) => new Promise(r => setTimeout(() => { const b = window.__pad.pad.buttons[i]; b.pressed = true; b.value = 1; setTimeout(() => { b.pressed = false; b.value = 0; r(); }, 120); }, Math.max(0, ms))), [wait, BTN[jumpAction]]);
      }
      if (qs.length) { await P.p.waitForTimeout(1500); jumped = await floatJumped(); }
      if (jumped >= 1 && Date.now() - t0 > 20000 && attempts >= 1) break;
      // skills when they are ready
      const sk = await S(() => window.__fb.state.ready.map(r => performance.now() > r));
      for (const k of [1, 2, 3]) if (sk[k]) { await P.tap(`skill${k}`, 1); break; }
      await frames(2);
    }
    await stopAtk();
    const bAfter = await boss();
    const hpNow = bAfter ? bAfter.hp : 0;
    assert.ok(!bAfter || bAfter.dead || hpNow < hp0, `the pad did damage (${hp0} -> ${hpNow})`);
    assert.ok(seenQuakes >= 1, `the Warden threw a Quake Ring (${seenQuakes} seen)`);
    jumped = await floatJumped();
    const log = srv.log();
    const qlog = k => (log.match(new RegExp(`\\[quake\\] ${k}`, 'g')) || []).length;
    assert.ok(jumped >= 1, `a jump registered during a Quake Ring ("Jumped!" shown to me ${jumped}x, ${attempts} timed jumps, rings: ${qlog('evade jump')} jumped / ${qlog('evade roll')} rolled / ${qlog('hit')} hit by anyone)`);
    C('attack', 'RT held on the Warden: boss HP down'); C('jump', 'Quake Ring: "Jumped!" registered'); C('lockNext', 'R3 locks the Warden');
    C('skill1', 'used in the fight'); C('skill2', 'used in the fight'); C('skill3', 'used in the fight');
    console.log(`  warden: boss HP ${hp0} -> ${hpNow}, rings seen ${seenQuakes}, timed jumps ${attempts}, "Jumped!" ${jumped}, server: ${qlog('evade jump')} jumped / ${qlog('evade roll')} rolled / ${qlog('hit')} hit (all players)`);
    ok(tag, `fought the Warden on the pad with bots; a jump registered during a Quake Ring (${jumped}x)`);
    assert.deepEqual(errors.filter(e => e.startsWith(tag)), [], `${tag}: no page errors`);
  } finally { /* the bots go with the page */ }
  await P.p.close(); srv.stop();
}

// ---------------------------------------------------------------------------------------------------------------
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  if (ONLY.includes(1)) await mainFlow('default', PORT);
  // rebound layout: swaps keep one control per button (jump <-> skill1, attack <-> guard, dodge <-> skill3, item1 <-> item2)
  if (ONLY.includes(2)) await mainFlow('rebound', PORT + 1, [['jump', 'X'], ['attack', 'LT'], ['dodge', 'B'], ['item1', 'Left']]);
  if (ONLY.includes(3)) await chords(PORT + 2);
  if (ONLY.includes(4)) await warden(PORT + 3);

  // ---- coverage ----
  console.log('\nCoverage: each action of shared/controls.js, verified on the pad');
  console.log('action'.padEnd(14) + 'default'.padEnd(10) + 'rebound'.padEnd(10) + 'chords'.padEnd(9) + 'warden'.padEnd(9) + 'note');
  const unverified = [];
  for (const a of ACTIONS) {
    const m = cov.by.get(a.id);
    const col = t => (m?.has(t) ? 'yes' : '-');
    let note = '';
    if (a.kbmOnly) note = 'keyboard & mouse only (no pad binding)';
    else if (a.id === 'revive') note = m?.get('default') || '';
    else if (a.id === 'menu') note = 'Start: Game Menu / closes panels (default, rebound)';
    if (a.id === 'menu') for (const t of ['default', 'rebound']) cov.mark(t, 'menu', 'Start');
    const mm = cov.by.get(a.id);
    const c = t => (mm?.has(t) ? 'yes' : '-');
    console.log(a.id.padEnd(14) + c('default').padEnd(10) + c('rebound').padEnd(10) + c('chords').padEnd(9) + c('warden').padEnd(9) + note);
    if (!a.kbmOnly && !mm) unverified.push(a.id);
  }
  if (ONLY.length === 4) assert.deepEqual(unverified, [], 'every pad action verified');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\npadtest: all ${n} checks passed (sections ${ONLY.join(',')})`);
} finally { await stopAll(); }
process.exit(0);
