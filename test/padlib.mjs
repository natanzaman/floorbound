// Shared helpers for the scripted-controller tests (roadmap K4): a server per run, a page with a fake standard pad
// (17 buttons, 4 axes, through navigator.getGamepads()), sent / received message capture, and "press by action" helpers
// that look the button up in input.bindings('pad'), so the same script drives the default and a rebound layout.
// Every press is held for N polled frames (__fb.input.frames), never for milliseconds. Needs Playwright for Node.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Start: 9, L3: 10, R3: 11, Up: 12, Down: 13, Left: 14, Right: 15 };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const loadPlaywright = () => import(process.env.PLAYWRIGHT || 'playwright');

// A game server on its own port: START_LEVEL 10 at the raid gate, test hooks on, no database, no Named.
export async function startServer(port, env = {}) {
  const srv = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: '', START_LEVEL: '10', SPAWN_AT: '0,150', TEST_HOOKS: '1', NAMED_ENABLED: '0', QUAKE_STATS: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  for (let k = 0; k < 150 && !/running on|listening|localhost:\d+/i.test(log); k++) await sleep(100);
  return { srv, port, base: `http://localhost:${port}`, log: () => log, stop: () => srv.kill() };
}

// A page with the fake pad and message capture. Returns the helper bundle P.
export async function openPad(browser, base, { onError } = {}) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => onError?.(e.message));
  await p.addInitScript(() => {
    window.__sent = []; window.__quakes = []; window.__pbot = null;
    const ws = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { try { window.__sent.push(JSON.parse(d)); } catch {} return ws.call(this, d); };
    const W = window.WebSocket; // what the server tells us: the Quake Rings (event 'quake': d = seconds until the ring starts rolling)
    window.WebSocket = class extends W {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', ev => { try { const m = JSON.parse(ev.data); if (m.type === 'pbot') window.__pbot = m; for (const e of m.w?.events || []) if (e.t === 'quake') window.__quakes.push({ ...e, at: performance.now() }); } catch {} });
      }
    };
    const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    window.__pad = { on: false, pad };
    navigator.getGamepads = () => [window.__pad.on ? pad : null, null, null, null];
  });
  await p.goto(`${base}/?quality=low`);
  await p.waitForFunction(() => window.__fb?.input && !document.getElementById('enter').disabled, null, { timeout: 60000 });

  const S = (fn, arg) => p.evaluate(fn, arg);
  const P = { p, S };
  P.frames = k => S(k => new Promise(r => { const end = window.__fb.input.frames + k; const f = () => (window.__fb.input.frames >= end ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), k);
  P.mark = () => S(() => window.__sent.length);
  P.sent = (m, type) => S(([m, t]) => window.__sent.slice(m).filter(o => o.type === t), [m, type]);
  P.btn = (name, down, value = 1) => S(([i, d, v]) => { const b = window.__pad.pad.buttons[i]; b.pressed = d; b.value = d ? v : 0; }, [BTN[name], down, value]);
  P.axes = a => S(a => { window.__pad.pad.axes = a; }, a);
  P.press = async (names, k = 2) => { for (const nm of names) await P.btn(nm, true); await P.frames(k); for (const nm of [...names].reverse()) await P.btn(nm, false); await P.frames(2); };
  P.cur = () => S(() => window.__fb.nav.current());
  P.isOpen = id => S(id => window.__fb.panels.isOpen(id), id);
  P.visible = id => S(id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); }, id);
  P.keepAlive = () => S(() => window.__fb.send({ type: 'test', hurt: 1 })); // (wolves bite: top up between checks)
  P.ready = slot => p.waitForFunction(s => performance.now() > window.__fb.state.ready[s] + 50, slot, { timeout: 60000 });
  P.clearTarget = () => S(() => { window.__fb.state.lock = 0; window.__fb.state.focus = 0; });
  P.st = () => S(() => { const s = window.__fb.state; return { x: s.x, z: s.z, yaw: s.yaw, pitch: s.pitch, hp: s.hp, maxHp: s.maxHp, lock: s.lock, moveDir: s.moveDir, dead: s.dead }; });
  P.goTo = async (key, dir = 'Down', max = 30) => { // d-pad until the focus is on key
    for (let i = 0; i < max; i++) { if ((await P.cur()).key === key) return; await P.press([dir], 1); }
    assert.equal((await P.cur()).key, key, `reached ${key} with ${dir}`);
  };
  // the pad as the game has it set up: which button(s) an action uses (a chord is ['LB', 'X'])
  P.keys = action => S(a => (window.__fb.input.bindings('pad')[a]?.[0] || '').split('+').filter(Boolean), action);
  P.tap = async (action, k = 2) => { const t = await P.keys(action); assert.ok(t.length, `${action} is bound on the pad`); await P.press(t, k); return t; };
  P.hold = async action => { const t = await P.keys(action); assert.ok(t.length, `${action} is bound on the pad`); for (const nm of t) await P.btn(nm, true, 1); return async () => { for (const nm of [...t].reverse()) await P.btn(nm, false); await P.frames(2); }; };
  P.plugIn = async () => { // plug the pad in and answer the "Controller detected" prompt with A (it is swallowed)
    await S(() => { window.__pad.on = true; const e = new Event('gamepadconnected'); e.gamepad = window.__pad.pad; dispatchEvent(e); });
    await P.frames(2); await P.press(['A'], 2);
    assert.equal(await S(() => window.__fb.input.device), 'pad', 'A on the prompt switches to Controller');
    await P.frames(2);
  };
  // character select by pad: the name is typed for it (a pad can't type), the class card by d-pad + A, Enter by A
  P.join = async (name, cls = 'guardian') => {
    await P.plugIn();
    assert.equal((await P.cur()).layer, 'login', 'character select is driven by the pad');
    await S(n => { document.getElementById('name').value = n; }, name);
    await P.press(['Down']);
    await P.goTo(`BUTTON?id=${cls}`, 'Right', 8).catch(() => P.goTo(`BUTTON?id=${cls}`, 'Left', 8));
    await P.press(['A']);
    assert.ok(await S(c => document.querySelector(`.cls[data-id=${c}]`).classList.contains('sel'), cls), `A picks ${cls}`);
    await P.goTo('#enter');
    await P.press(['A']);
    await p.waitForFunction(() => window.__fb?.state?.joined && window.__fb.state.inv, null, { timeout: 60000 });
    await P.frames(2);
  };
  // player-owned server bots (the Players panel's Bots tab is mouse-only): added by message, in your party, in a mode
  P.addBots = async (roles, mode = 'follow', skill = 5) => {
    for (const cls of roles) { await S(c => window.__fb.send({ type: 'pbot', op: 'add', cls: c.cls, skill: c.skill }), { cls, skill }); await sleep(400); }
    await p.waitForFunction(n => window.__pbot?.list?.mine >= n, roles.length, { timeout: 30000 });
    const mine = await S(() => window.__pbot.list.bots.filter(b => b.mine).map(b => b.bid));
    if (mode !== 'follow') for (const bid of mine) { await S(([b, m]) => window.__fb.send({ type: 'pbot', op: 'edit', bid: b, mode: m }), [bid, mode]); await sleep(200); }
    await p.waitForFunction(n => window.__fb.state.party && [...window.__fb.players.values()].filter(q => q.party === window.__fb.state.party && q.id !== window.__fb.state.myId).length >= n, roles.length, { timeout: 60000 });
    return mine;
  };
  return P;
}

// What each action did, for the coverage table: cov.set(action, 'how it was checked').
export class Coverage {
  constructor() { this.by = new Map(); }
  mark(tag, action, how) { const m = this.by.get(action) || new Map(); m.set(tag, how); this.by.set(action, m); }
  has(action) { return this.by.has(action); }
}
