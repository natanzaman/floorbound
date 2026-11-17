// In-process checks for who sees combat text and who gets a hit-stop (docs/ROADMAP.md A):
//  - reactions a player performs carry `to: <that player>` (only their client shows the text);
//  - statuses/effects on a target carry no `to` (everyone sees them);
//  - a boss's big hit tags the victim's `hurt` event `big` (only that client hit-stops); nothing else does.
// Usage: node test/feeltext.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { BIG_HITS } from '../server/combat.js';
import { angleTo } from '../shared/data.js';

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
function advance(dt) {
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
// What a client shows for a reaction event: the same rule as public/main.js / combat.js (`(e.to ?? e.id) === me`).
const showsReaction = (e, me) => (e.to ?? e.id) === me;

const wolf = g.addMob('wolf', 0, 70);
const sword = g.addPlayer(null, 'Kael', 'swordsman');
const tank = g.addPlayer(null, 'Brann', 'guardian');
for (const p of [sword, tank]) { p.x = 0; p.z = 67; p.face = angleTo(p.x, p.z, wolf.x, wolf.z); }
g.time = 10; clear();
Math.random = () => 0.5; // no crits, no damage variance

// ---------- reactions: tagged to the player who performed them ----------
{ // Jumped! (airborne over a ground attack)
  sword.airFrom = g.time - 0.1; sword.airUntil = g.time + 0.3;
  g.damagePlayer(sword, 30, { ground: true, src: 'warden quake' });
  const [e] = ev('evade');
  assert.equal(e.k, 'jump'); assert.equal(e.to, sword.id);
  assert.ok(showsReaction(e, sword.id) && !showsReaction(e, tank.id), 'only the jumper sees "Jumped!"');
  sword.airFrom = sword.airUntil = 0;
  ok('"Jumped!" is tagged to the jumper only');
}
{ // PERFECT, then a plain Dodged! during the same roll, then the COUNTER hit
  clear();
  g.dodge(sword, 0); advance(0.1);
  g.damagePlayer(sword, 30, { src: 'wolf bite' });
  g.damagePlayer(sword, 30, { src: 'wolf bite' });
  const [pf] = ev('perfect'), [dg] = ev('evade');
  assert.equal(pf.to, sword.id); assert.equal(dg.to, sword.id);
  assert.ok(!showsReaction(pf, tank.id) && !showsReaction(dg, tank.id));
  g.damageMob(wolf, sword, 10, {});
  const [ct] = ev('counter');
  assert.equal(ct.to, sword.id); assert.equal(ct.by, sword.id);
  ok('PERFECT, Dodged! and COUNTER are tagged to the dodger only');
}
{ // PARRY!
  clear(); advance(2);
  g.guard(tank, true);
  g.damagePlayer(tank, 30, { src: 'wolf bite' });
  const [pr] = ev('parry');
  assert.ok(pr, 'parried'); assert.equal(pr.to, tank.id);
  assert.ok(showsReaction(pr, tank.id) && !showsReaction(pr, sword.id));
  g.guard(tank, false);
  ok('PARRY! is tagged to the Guardian only');
}
{ // talent procs on self
  clear();
  g.tproc(sword, 'flow');
  const [tp] = ev('tproc');
  assert.equal(tp.to, sword.id);
  ok('talent procs are tagged to the player who procced');
}

// ---------- effects on a target: no `to`, everyone sees them ----------
{
  clear(); advance(2);
  g.breakMob(wolf, sword);
  const [st] = ev('stagger');
  assert.equal(st.by, sword.id); assert.equal(st.to, undefined, 'BROKEN is for everyone');
  g.damageMob(wolf, tank, 10, {});
  const [sw] = ev('switch');
  assert.ok(sw, 'teammate switched in');
  assert.equal(sw.to, undefined); assert.equal(sw.by, tank.id); assert.equal(sw.from, sword.id); // client: text for by/from only, rings for all
  ok('Break (stagger) and Switch carry no `to`; Switch names both players');
}

// ---------- hit-stop: only a boss's big hit, only on its victim ----------
{
  const hurt = src => { clear(); sword.hp = sword.maxHp; sword.dead = false; sword.iframeUntil = 0; g.damagePlayer(sword, 20, { src }); return ev('hurt')[0]; };
  for (const src of BIG_HITS) {
    const e = hurt(src);
    assert.ok(e, src); assert.equal(e.big, 1, `${src} is a big hit`); assert.equal(e.id, sword.id);
  }
  assert.equal(hurt('warden slam echo').big, 1, 'a twist echo counts as the original');
  for (const src of ['wolf bite', 'warden cleave', 'spitter thorn', 'mire pool', 'the deluge', 'sovereign orb', 'cracked ground']) assert.equal(hurt(src).big, undefined, `${src} is not big`);
  for (const k of ['warden slam', 'warden charge', 'warden sweep', 'warden quake', 'rockfall', 'sovereign trident', 'sovereign geyser', 'tidal wave']) assert.ok(BIG_HITS.has(k), k);
  ok('big boss hits tag the victim\'s hurt event `big`; ordinary hits don\'t');

  clear(); // player hits on enemies never carry a hit-stop tag
  g.damageMob(wolf, sword, 10, {});
  assert.ok(ev('hit').every(e => e.big === undefined));
  ok('player hits carry no hit-stop tag');
}

console.log(`feeltext: ${n} checks passed`);
