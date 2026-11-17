// In-process checks for the Warden's Quake Ring (jump over it or roll through it), the Warden's party/level scaling,
// the twists that touch it, and the bot motor's jump timing at each capability level.
// Usage: node test/warden3.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WARDEN, JUMP, MOBS, WORLD } from '../shared/data.js';
import { TWISTS } from '../shared/twists.js';
import { perceive } from '../shared/botskill.js';
import { quakeDodge } from '../shared/bots/motor.js';
import { runHooks } from '../shared/bots/registry.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const Q = WARDEN.quake;
const newGame = () => { const l = console.log; console.log = () => {}; try { return new Game(); } finally { console.log = l; } }; // (no twist log lines)

function setup() {
  const g = newGame();
  g.twistW = { ...WARDEN }; g.twist = null; // no twist unless a check sets one
  const b = g.boss;
  b.x = WORLD.arena.x; b.z = WORLD.arena.z; b.engaged = true; b.phase = 0;
  const p = g.addPlayer(null, 'Kael', 'guardian');
  p.maxHp = 5000; // survives a whole volley
  b.threat.set(p.id, 1);
  g.time = 20; g.events = [];
  return { g, b, p };
}
// one server tick: time, scheduled callbacks, Quake Rings (no AI, so nobody moves)
function tick(g) {
  g.time += 0.05;
  const due = g.scheduled.filter(s => s.at <= g.time);
  g.scheduled = g.scheduled.filter(s => s.at > g.time);
  for (const s of due) s.fn();
  g.updateQuakes();
}
const place = (g, p, d) => { p.x = g.boss.x + d; p.z = g.boss.z; p.hp = p.maxHp; p.dead = false; p.airFrom = p.airUntil = p.iframeUntil = 0; p.jumpCd = p.dodgeCd = 0; };
// when the wavefront (inner edge) of a ring launched now reaches distance d
const arrival = d => Q.wind + (d - Q.w) / Q.speed;
function runRing(g, secs = Q.wind + Q.max / Q.speed + 0.3, each = null) {
  const out = [], end = g.time + secs;
  while (g.time < end) { tick(g); each?.(); out.push(...g.events); g.events = []; }
  return out;
}

// ---------- the ring itself ----------
{
  const { g, b, p } = setup();
  place(g, p, 6);
  g.quakeRing(b, 1);
  const tele = g.events.filter(e => e.t === 'quake');
  assert.equal(tele.length, 1);
  assert.equal(tele[0].d, Q.wind); assert.equal(tele[0].max, Q.max); assert.equal(tele[0].sp, Q.speed);
  assert.ok(b.busyUntil >= g.time + Q.wind, 'the Warden stands still while it winds up');
  g.events = [];
  const evs = runRing(g);
  assert.ok(p.hp < p.maxHp, 'grounded = hit');
  assert.equal(evs.filter(e => e.t === 'hurt' && e.id === p.id).length, 1, 'one hit per ring');
  assert.equal(g.quakes.length, 0, 'the ring is gone once it reaches its full radius');
  ok('grounded at the wavefront: hit once; telegraph event carries wind-up, speed and reach');
}
{
  const { g, b, p } = setup();
  place(g, p, 6);
  const t0 = g.time;
  g.quakeRing(b, 1); g.events = [];
  const at = t0 + arrival(6) - 0.25; // jump ~0.25 s before the wavefront arrives: airborne as it passes
  let jumped = false;
  const evs = runRing(g, undefined, () => { if (!jumped && g.time >= at) { jumped = true; g.jump(p); } });
  assert.equal(p.hp, p.maxHp, 'airborne at the wavefront = no damage');
  const ev = evs.filter(e => e.t === 'evade' && e.id === p.id);
  assert.equal(ev.length, 1); assert.equal(ev[0].k, 'jump', '"Jumped!" feedback');
  ok('airborne as the wavefront passes: no damage, "Jumped!"');
}
{
  const { g, b, p } = setup();
  place(g, p, 9);
  const t0 = g.time;
  g.quakeRing(b, 1); g.events = [];
  const at = t0 + arrival(9) - JUMP.airTo - 0.15; // jumped too early: already landed when it arrives
  let jumped = false;
  runRing(g, undefined, () => { if (!jumped && g.time >= at) { jumped = true; g.jump(p); } });
  assert.ok(p.hp < p.maxHp, 'landed before the wavefront = hit');
  ok('a jump that lands before the wavefront arrives is hit');
}
{
  const { g, b, p } = setup();
  place(g, p, 7);
  const t0 = g.time;
  g.quakeRing(b, 1); g.events = [];
  const at = t0 + arrival(7) - 0.1; // roll just before it arrives: i-frames
  let rolled = false;
  const evs = runRing(g, undefined, () => { if (!rolled && g.time >= at) { rolled = true; g.dodge(p, 0); p.x = b.x + 7; p.z = b.z; } }); // (rolls in place here)
  assert.equal(p.hp, p.maxHp, 'rolling through = no damage');
  assert.equal(evs.filter(e => (e.t === 'evade' || e.t === 'perfect') && e.id === p.id).length, 1, 'Dodged! / PERFECT feedback');
  ok('rolling through the wavefront (i-frames): no damage');
}
{
  const { g, b, p } = setup();
  place(g, p, Q.max + Q.w + 0.3);
  g.quakeRing(b, 1); g.events = [];
  const evs = runRing(g);
  assert.equal(p.hp, p.maxHp, 'out of reach = no damage');
  assert.equal(evs.filter(e => (e.t === 'hurt' || e.t === 'evade') && e.id === p.id).length, 0);
  ok(`beyond the ring's reach (${Q.max} m): never touched`);
}
{
  const { g, b, p } = setup();
  place(g, p, 4);
  g.quakeRing(b, 3);
  assert.deepEqual(g.events.filter(e => e.t === 'quake').map(e => e.i), [0, 1, 2]);
  g.events = [];
  const evs = runRing(g, Q.wind + 2 * Q.gap + Q.max / Q.speed + 0.3);
  assert.equal(evs.filter(e => e.t === 'hurt' && e.id === p.id).length, 3, 'each ring hits once');
  ok('a volley of 3 rings, gap apart: each ring hits a grounded player once');
}
{
  const { g, b, p } = setup();
  place(g, p, 6);
  g.quakeRing(b, 1); g.events = [];
  b.engaged = false; // wipe reset
  tick(g); g.clearQuakes();
  b.engaged = true;
  const evs = runRing(g);
  assert.equal(p.hp, p.maxHp); assert.equal(evs.filter(e => e.t === 'hurt').length, 0);
  ok('a wipe clears pending rings');
}

// ---------- in the rotation, twists ----------
{
  const { g, b, p } = setup();
  place(g, p, 6);
  b.engaged = false; b.hp = b.maxHp;
  g.updateMob(b, 0.05); // engage
  assert.ok(b.engaged && Math.abs(b.quakeT - (g.time + Q.first[0])) < 1e-6, 'first ring scheduled on engage');
  g.time = b.quakeT; b.busyUntil = 0; b.slamT = Infinity; b.windupAt = 0; g.events = [];
  g.bossSpecials(b, p);
  assert.equal(g.events.filter(e => e.t === 'quake').length, Q.rings[0]);
  assert.ok(b.quakeT > g.time + Q.every[0] - 1e-6);
  b.hp = Math.floor(b.maxHp * 0.2); g.time += 0.05; g.events = [];
  g.bossSpecials(b, p); // drops to phase 3
  assert.equal(b.phase, 2);
  assert.ok(b.quakeT <= g.time + Q.first[2] + 1e-6, 'a new phase brings the next volley sooner');
  g.time = b.quakeT; b.busyUntil = 0; b.windupAt = 0; b.slamT = b.spinT = b.rockT = b.chargeT = b.houndT = Infinity; g.events = [];
  g.bossSpecials(b, p);
  assert.equal(g.events.filter(e => e.t === 'quake').length, Q.rings[2], 'more rings per volley later');
  ok(`in the rotation from the start; ${Q.rings.join('/')} rings per volley by phase`);
}
{
  const g = newGame();
  g.twist = { id: 'x' };
  process.env.WARDEN_TWIST = 'quaking'; g.newTwist();
  assert.deepEqual(g.twistW.quake.rings, Q.rings.map(r => r + TWISTS.quaking.rings));
  process.env.WARDEN_TWIST = 'eclipse'; g.newTwist();
  assert.ok(Math.abs(g.twistW.quake.wind - Q.wind * TWISTS.eclipse.wind) < 0.01);
  delete process.env.WARDEN_TWIST;
  ok('twists: Quaking adds a ring per volley, Eclipse shortens its wind-up');
}

// ---------- party / level scaling ----------
{
  const scale = (classes, lvl = 10) => {
    const g = newGame();
    classes.forEach((c, i) => { const p = g.addPlayer(null, `P${i}`, c); p.lvl = lvl; p.x = WORLD.arena.x + i; p.z = WORLD.arena.z - 6; });
    g.scaleWarden(g.boss);
    return { hp: g.boss.maxHp, atk: g.boss.def.atk };
  };
  const trio = ['guardian', 'swordsman', 'cleric'], six = ['guardian', 'ranger', 'berserker', 'lancer', 'bard', 'cleric'];
  const solo = scale(['swordsman']), t = scale(trio), f = scale(six), hi = scale(trio, 15), low = scale(trio, 6);
  assert.equal(solo.hp, Math.round(WARDEN.hpBase + WARDEN.hpPer * Math.pow(WARDEN.hpRole.Damage, WARDEN.hpExp)));
  assert.ok(f.hp > 3 * t.hp, 'a full party (three damage dealers and a Bard) gets more than 3x the health of a trio');
  assert.ok(scale(['swordsman', 'swordsman', 'swordsman']).hp > t.hp, 'damage dealers weigh more than a tank or healer');
  assert.ok(f.atk > t.atk, 'a bigger party: harder hits');
  assert.ok(hi.hp > t.hp && hi.atk > t.atk, 'an over-levelled party: more health and damage');
  assert.equal(low.hp, t.hp); assert.equal(low.atk, MOBS.warden.atk);
  assert.equal(t.atk, MOBS.warden.atk, 'the shared mob table is untouched');
  ok(`scaling: solo ${solo.hp} HP, trio ${t.hp}, full party of six ${f.hp} (atk ${f.atk}); trio at Lv 15 ${hi.hp} HP, atk ${hi.atk}`);
}

// ---------- bots: jump (or roll) the wavefront, by capability ----------
// A bot fights a fresh ring at a random distance: snapshots go through perceive() and the motor's onEvent hook, the
// bot's 'jump' / 'dodge' messages are applied between ticks (as the server does). Returns the fraction of rings cleared.
function botTrials(skill, trials) {
  let cleared = 0;
  for (let k = 0; k < trials; k++) {
    const { g, b, p } = setup();
    const d = 3 + Math.random() * (Q.max - 4);
    place(g, p, d);
    const bot = { t: g.time, clock: () => bot.t, x: p.x, z: p.z, skill, roll: null, dodgeCd: 0, quakes: [], send: m => { if (m.type === 'jump') g.jump(p); if (m.type === 'dodge') g.dodge(p, m.face); } };
    g.quakeRing(b, 1);
    const end = g.time + Q.wind + Q.max / Q.speed + 0.5;
    while (g.time < end) {
      for (const e of perceive(bot, g.events)) runHooks('onEvent', bot, e);
      g.events = [];
      if (bot.roll) { bot.roll.left -= 0.05; if (bot.roll.left <= 0) bot.roll = null; } // (rolls in place)
      bot.dodgeCd = Math.max(0, bot.dodgeCd - 0.05);
      quakeDodge(bot);
      tick(g); bot.t = g.time;
    }
    if (p.hp === p.maxHp) cleared++;
  }
  return cleared / trials;
}
{
  const rate = Object.fromEntries([5, 4, 3, 1].map(s => [s, botTrials(s, s === 5 ? 60 : 200)]));
  assert.equal(rate[5], 1, 'capability 5 clears every ring');
  assert.ok(rate[4] >= 0.8 && rate[4] < 1, `capability 4 clears most (${rate[4]})`);
  assert.ok(rate[3] < rate[4] && rate[3] < 0.85, `capability 3 is hit more often (${rate[3]})`);
  assert.ok(rate[1] < 0.6, `capability 1 is hit often (${rate[1]})`);
  ok(`bots jump the wavefront: cleared ${Object.entries(rate).reverse().map(([s, r]) => `skill ${s} ${Math.round(r * 100)}%`).join(', ')}`);
}

console.log(`all ${n} checks passed`);
process.exit(0);
