// Jump air control: the shared air step (momentum, weaker steering, never faster than on the ground), client
// prediction against the server's movement check (no clamping = no rubber-banding while airborne), and the bot motor
// (slower while airborne, steers out of a telegraph mid-jump without changing when the Quake Ring reaches it).
// Usage: node test/aircontrol.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { JUMP, PLAYER_SPEED, SPRINT_SPEED, WORLD, airStep } from '../shared/data.js';
import { moveToward, quakeDodge, DT } from '../shared/bots/motor.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const newGame = () => { const l = console.log; console.log = () => {}; try { return new Game(); } finally { console.log = l; } };

// ---------- the air step ----------
{
  const v = { x: 0, z: 7 };
  airStep(v, 0, 0, 7, 0.1);
  assert.deepEqual(v, { x: 0, z: 7 }, 'no input: keep drifting');
  for (let i = 0; i < 20; i++) airStep(v, 0, 1, 7, 1 / 60);
  assert.ok(Math.abs(v.z - 7) < 1e-9, 'holding forward keeps your takeoff speed');
  const s = { x: 0, z: 0 };
  for (let i = 0; i < 39; i++) airStep(s, 1, 0, 7, 1 / 60); // a whole jump from standing, steering right
  assert.ok(s.x > 0 && s.x <= 7 * JUMP.air + 1e-9, `standing jump: steer up to ${JUMP.air} x ground speed (${s.x.toFixed(2)})`);
  const t = { x: 0, z: 7 };
  for (let i = 0; i < 6; i++) airStep(t, 0, -1, 7, 1 / 60); // reverse for 0.1 s
  assert.ok(t.z > 0, 'a reversal in the air takes time (weaker than on the ground, where it is instant)');
  const f = { x: 0, z: 10 };
  for (let i = 0; i < 60; i++) airStep(f, 1, 0, 7, 1 / 60);
  assert.ok(Math.hypot(f.x, f.z) <= 7 + 1e-9, 'never faster than your ground speed now');
  ok('air step: momentum, weaker steering, capped at ground speed');
}

// ---------- client prediction vs the server ----------
// Run, jump, then steer hard (sideways, then back) in the air, the way public/main.js predicts it, and send the
// position at 20 Hz. The server must accept every input as is: any clamp would snap the player back (rubber-band).
for (const [speed, label] of [[PLAYER_SPEED, 'combat speed'], [SPRINT_SPEED, 'sprinting']]) {
  const g = newGame();
  const p = g.addPlayer(null, 'Hopper', 'swordsman');
  g.teleport(p, 0, 60); g.events = [];
  const c = { x: p.x, z: p.z, vel: [0, speed], air: null, seq: p.posSeq };
  const fps = 60, dt = 1 / fps;
  let clamped = 0, sent = 0, maxErr = 0, airborneSends = 0;
  for (let f = 0; f < fps * 3; f++) {
    const t = f * dt;
    if (f % 54 === 30) { c.air = { x: c.vel[0], z: c.vel[1] }; c.jumpAt = t; g.handle(p, { type: 'jump' }); } // jump every 0.9 s
    const airborne = c.air && t - c.jumpAt < JUMP.time;
    if (c.air && !airborne) { c.vel = [c.air.x, c.air.z]; c.air = null; }
    if (airborne) {
      const k = t - c.jumpAt, [dx, dz] = k < 0.3 ? [1, 0] : [0, -1]; // steer right, then try to turn back
      airStep(c.air, dx, dz, speed, dt);
      c.x += c.air.x * dt; c.z += c.air.z * dt;
    } else { c.vel = [0, speed]; c.z += speed * dt; }
    g.time += dt;
    if (f % 3 === 0) {
      const x = +c.x.toFixed(2), z = +c.z.toFixed(2);
      g.onInput(p, { x, z, face: 0, seq: c.seq }); sent++;
      if (airborne) airborneSends++;
      const err = Math.hypot(p.x - x, p.z - z);
      maxErr = Math.max(maxErr, err);
      if (err > 1e-6) clamped++;
    }
  }
  assert.ok(airborneSends > 15, 'several inputs were sent mid-air');
  assert.equal(clamped, 0, `${clamped}/${sent} inputs clamped by the server (max error ${maxErr.toFixed(3)} m)`);
  ok(`prediction: ${label}, steering in the air, the server takes every position as sent (${airborneSends} airborne inputs)`);
}

// ---------- the bot motor ----------
{
  const clockAt = { t: 100 };
  const bot = () => ({ x: 0, z: 60, t: 0, face: 0, gateOpen: true, skill: 5, tele: [], mobs: [], orbs: [], pools: [], quakes: [], clock: () => clockAt.t, send: () => {} });
  const a = bot(), b = bot();
  b.airUntil = clockAt.t + 0.5;
  moveToward(a, 0, 80); moveToward(b, 0, 80);
  const da = a.z - 60, db = b.z - 60;
  assert.ok(Math.abs(db / da - JUMP.air) < 1e-6, `airborne bots move at ${JUMP.air} x speed (${db.toFixed(3)} vs ${da.toFixed(3)})`);
  ok('bot motor: slower while airborne');

  // A Quake Ring from the arena centre; the bot jumps it while standing in a rockfall circle and drifts out sideways.
  const A = WORLD.arena, c = bot();
  c.x = A.x + 6; c.z = A.z; c.skill = 5;
  c.quakes = [{ x: A.x, z: A.z, start: clockAt.t + 0.1, sp: 9, w: 0.55, max: 15 }];
  c.tele = [{ x: c.x, z: c.z + 1, r: 3.2, until: 99 }];
  let jumped = false;
  c.send = m => { if (m.type === 'jump') jumped = true; };
  const r0 = Math.hypot(c.x - A.x, c.z - A.z);
  for (let i = 0; i < 20; i++) { clockAt.t += DT; c.t += DT; quakeDodge(c); }
  assert.ok(jumped, 'it jumped the ring');
  const r1 = Math.hypot(c.x - A.x, c.z - A.z), moved = Math.hypot(c.x - (A.x + 6), c.z - A.z);
  assert.ok(moved > 1, `it kept moving in the air (${moved.toFixed(2)} m)`);
  assert.ok(Math.abs(r1 - r0) < 0.35, `sideways to the ring, so the wavefront still passes under it on time (radius ${r0.toFixed(2)} -> ${r1.toFixed(2)})`);
  assert.ok(c.z < A.z, 'away from the telegraph centre');
  ok('bot motor: steers out of a telegraph mid-jump, along the ring');
}

console.log(`aircontrol: ${n} checks passed`);
