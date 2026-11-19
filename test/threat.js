// In-process checks for team threat (server/threat.js, docs/ROADMAP.md G3): healer threat math, threat UI data in
// snapshots, Cover redirecting a hit, flank / Pincer angles, team stats.
// Usage: node test/threat.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WORLD, MOBS, GUARD } from '../shared/data.js';
import { THREAT, COVER, FLANK, fromBehind, apartAround } from '../shared/threat.js';
import { botCover, lostAggro, oppositeSpot } from '../shared/bots/threat.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const A = WORLD.arena;

function setup() {
  const g = new Game();
  g.setTwistOverride('off'); g.twist = null; g.twistW = null;
  const W = g.boss;
  const gu = g.addPlayer(null, 'Tank', 'guardian'), cl = g.addPlayer(null, 'Heals', 'cleric'), sw = g.addPlayer(null, 'Dps', 'swordsman');
  for (const p of [gu, cl, sw]) { p.lvl = 10; g.recompute(p); p.hp = p.maxHp; }
  const party = { id: g.id(), members: [gu.id, cl.id, sw.id] };
  g.parties.set(party.id, party);
  for (const p of [gu, cl, sw]) p.party = party.id;
  W.x = A.x; W.z = A.z + 4; W.face = 0; W.engaged = true; W.hp = W.maxHp = 1e7;
  gu.x = W.x; gu.z = W.z - 3; gu.face = 0;
  cl.x = W.x; cl.z = W.z - 8; cl.face = 0;
  sw.x = W.x + 3; sw.z = W.z; sw.face = -Math.PI / 2;
  g.time = 10; g.events = [];
  const stats = [];
  g.teamStat = (p, k, v = 1) => stats.push([p.id, k, v]); // G2 defines it; a recorder here
  return { g, W, gu, cl, sw, stats };
}
const tick = (g, dt = 0.05) => {
  g.time += dt;
  const due = g.scheduled.filter(s => s.at <= g.time); g.scheduled = g.scheduled.filter(s => s.at > g.time);
  for (const s of due) s.fn();
  for (const zn of g.zones) if (g.time >= zn.next) { zn.next = g.time + 0.5; g.zoneTick(zn); }
  g.zones = g.zones.filter(z => g.time < z.until);
};

// ---------- healer threat math ----------
{
  const { g, W, gu, cl, sw, stats } = setup();
  W.threat.set(gu.id, 100);
  gu.hp = gu.maxHp - 200;
  const got = g.healPlayer(gu, 150, cl, 'heal');
  assert.equal(got, 150);
  assert.ok(Math.abs(W.threat.get(cl.id) - 150 * THREAT.heal) < 1e-9, 'heal threat = 0.5 x the healing');
  const t0 = W.threat.get(cl.id);
  g.healPlayer(gu, 500, cl, 'heal'); // only 50 missing: 450 is overheal
  assert.ok(Math.abs(W.threat.get(cl.id) - t0 - 50 * THREAT.heal) < 1e-9, 'overheal adds none');
  g.healPlayer(gu, 100, cl, 'heal'); // full health: all overheal
  assert.ok(Math.abs(W.threat.get(cl.id) - t0 - 50 * THREAT.heal) < 1e-9);
  assert.deepEqual(stats.filter(s => s[1] === 'heal').map(s => s[2]), [150, 50], 'teamStat heal = effective healing');
  ok('healing adds 0.5x its effective amount as threat; overheal adds none');

  // split across every enemy fighting the party; an enemy not fighting it gets nothing
  const wolf = [...g.mobs.values()].find(m => m.type === 'alpha');
  wolf.x = cl.x + 4; wolf.z = cl.z; wolf.threat.clear(); wolf.threat.set(sw.id, 5);
  const boar = [...g.mobs.values()].find(m => m.type === 'boar');
  boar.x = cl.x - 4; boar.z = cl.z; boar.threat.clear(); // idle
  W.threat.delete(cl.id);
  gu.hp = gu.maxHp - 100;
  g.healPlayer(gu, 100, cl, 'heal');
  assert.ok(Math.abs(W.threat.get(cl.id) - 25) < 1e-9 && Math.abs(wolf.threat.get(cl.id) - 25) < 1e-9, 'split evenly');
  assert.ok(!boar.threat.has(cl.id), 'an idle enemy never notices');
  ok('heal threat is split across the enemies fighting the party');

  // shields: the damage a shield soaks counts like healing for its caster
  W.threat.delete(cl.id); wolf.threat.delete(cl.id);
  gu.shield = { hp: 80, max: 80, until: g.time + 8, by: cl.id };
  gu.hp = gu.maxHp;
  const left = g.absorbHit(gu, 60);
  assert.equal(left, 0);
  assert.ok(Math.abs(W.threat.get(cl.id) - 30 * THREAT.heal) < 1e-9 && Math.abs(wolf.threat.get(cl.id) - 30 * THREAT.heal) < 1e-9);
  ok('damage a shield soaks adds threat for whoever cast it');
}

// ---------- a careless Cleric pulls the boss off a Guardian who isn't taunting ----------
function race(taunt) {
  const { g, W, gu, cl, sw } = setup();
  sw.x = 999; // out of it
  W.threat.set(gu.id, 1);
  let tankTop = 0, ticks = 0, pulledAt = null;
  for (let i = 0; i < 20 * 40; i++) {
    tick(g);
    if (i % 10 === 0) { gu.hp = Math.max(1, gu.hp - Math.round(gu.maxHp * 0.06)); cl.hp = Math.max(1, cl.hp - Math.round(cl.maxHp * 0.03)); g.cleanReset(gu); g.cleanReset(cl); } // the boss's hits (no clean bonus)
    if (Math.floor(i / 40) % 2 === 0) g.useSkill(gu, 0, 0); // bashes half the time (guarding / moving the rest)
    if (taunt) g.useSkill(gu, 1, 0);
    if (i > 60) { g.useSkill(cl, 1, 0); g.useSkill(cl, 3, 0); g.useSkill(cl, 0, 0); } // heal, Sanctuary, Smite on cooldown
    g.events = [];
    if (i > 60) { ticks++; if (g.threatTop(W)[0] === gu.id) tankTop++; else pulledAt ??= g.time - 10; }
  }
  return { tankTop: tankTop / ticks, pulledAt };
}
{
  const careless = race(false), held = race(true);
  assert.ok(careless.pulledAt !== null && careless.pulledAt < 30, `the Cleric pulls it (at ${careless.pulledAt?.toFixed(1)} s)`);
  assert.ok(careless.tankTop < 0.6, `the tank lost it most of the time (${(careless.tankTop * 100).toFixed(0)}% held)`);
  assert.ok(held.tankTop > 0.85, `a taunting Guardian holds it (${(held.tankTop * 100).toFixed(0)}%)`);
  ok(`careless Cleric pulls at ${careless.pulledAt.toFixed(1)} s off a non-taunting Guardian; a taunting one holds ${(held.tankTop * 100).toFixed(0)}% of the time`);
}

// ---------- threat UI data in snapshots ----------
{
  const { g, W, gu, cl, sw } = setup();
  W.threat.set(gu.id, 1000); W.threat.set(cl.id, 620); W.threat.set(sw.id, 930);
  const alpha = [...g.mobs.values()].find(m => m.type === 'alpha');
  alpha.threat.clear(); alpha.threat.set(sw.id, 7);
  const boar = [...g.mobs.values()].find(m => m.type === 'boar');
  boar.threat.clear(); boar.threat.set(cl.id, 3);
  const w = JSON.parse(g.snapshot());
  const th = new Map(w.th);
  assert.equal(th.get(W.id), gu.id, 'the boss targets the top threat');
  assert.equal(th.get(alpha.id), sw.id, 'elites too');
  assert.ok(!th.has(boar.id), 'plain mobs are not sent');
  assert.deepEqual(g.meFor(cl).th, [W.id, 62, 0, 10, 0, 0], 'the Cleric is at 62% of top');
  const swMe = g.meFor(sw).th;
  assert.ok(swMe[1] === 93 && swMe[1] >= THREAT.warn, '93%: about to pull');
  assert.deepEqual(g.meFor(gu).th, [W.id, 100, 93, 10, 0, 0], 'the top sees the runner-up');
  assert.ok(typeof g.meFor(gu).cov === 'number' && g.meFor(cl).cov === undefined, 'Cover cooldown only for Guardians');
  sw.dead = true;
  assert.deepEqual(g.meFor(gu).th, [W.id, 100, 62, 10, 0, 0], 'the dead do not count');
  W.threat.clear(); alpha.threat.clear();
  const w2 = JSON.parse(g.snapshot());
  assert.equal(w2.th, undefined, 'nothing engaged: no th');
  assert.equal(g.meFor(gu).th, undefined);
  ok('snapshot th = [[boss/elite, target]]; me.th = [boss, my % of top, runner-up %, mult×10, lockSecs, lockBy]');
}

// ---------- Cover ----------
{
  const { g, W, gu, cl, sw, stats } = setup();
  W.threat.set(gu.id, 10); W.threat.set(cl.id, 50); // the boss is after the Cleric
  gu.x = W.x - 4; gu.z = W.z - 4; cl.x = W.x + 2; cl.z = W.z - 6; // 6 m apart
  const random = Math.random; Math.random = () => 0.5; // no damage spread / crits
  try {
    assert.equal(g.cover(cl), false, 'only Guardians Cover');
    assert.equal(g.cover(gu, cl.id), true);
    const ev = g.events.find(e => e.t === 'cover');
    assert.ok(ev && ev.w === cl.id, 'cover event');
    assert.ok(Math.hypot(gu.x - cl.x, gu.z - cl.z) < COVER.stand + 0.3, 'dashed next to the ally');
    assert.ok(Math.hypot(gu.x - W.x, gu.z - W.z) < Math.hypot(cl.x - W.x, cl.z - W.z), '...between them and the boss');
    assert.equal(g.cover(gu, cl.id), false, 'on cooldown');
    const ch = cl.hp, gh = gu.hp;
    g.damagePlayer(cl, 100, { src: 'warden cleave', mob: W });
    assert.equal(cl.hp, ch, 'the ally takes nothing');
    const expect = Math.round(100 * (1 - GUARD.dr) * (1 - (gu.gearDr || 0)));
    assert.ok(Math.abs(gh - gu.hp - expect) <= 1, `the Guardian takes it braced (${gh - gu.hp} ~ ${expect})`);
    assert.ok(g.events.some(e => e.t === 'covered' && e.id === gu.id && e.w === cl.id));
    assert.ok(stats.some(s => s[0] === gu.id && s[1] === 'cover'));
    g.damagePlayer(cl, 100, { src: 'warden cleave', mob: W });
    assert.ok(cl.hp < ch, 'only the next hit');
    ok('Cover: dash to the ally, take their next hit braced like a guard, then it ends; cooldown');

    // the window expires; perilous hits can't be covered; a save
    g.time += COVER.cd + 1; cl.hp = cl.maxHp; gu.hp = gu.maxHp;
    assert.equal(g.cover(gu, cl.id), true);
    g.time += COVER.window + 0.05;
    let h = cl.hp; g.damagePlayer(cl, 50, { src: 'warden cleave', mob: W });
    assert.ok(cl.hp < h, `expires after ${COVER.window} s`);
    g.time += COVER.cd + 1; cl.hp = cl.maxHp;
    g.cover(gu, cl.id);
    h = cl.hp; g.damagePlayer(cl, 40, { src: 'warden sweep', peril: true, mob: W });
    assert.ok(cl.hp < h && cl.cover, 'a perilous hit goes through (dodge or parry those)');
    cl.hp = 30; const gh2 = gu.hp; stats.length = 0;
    g.damagePlayer(cl, 60, { src: 'warden cleave', mob: W });
    assert.ok(cl.hp === 30 && gu.hp < gh2 && stats.some(s => s[0] === gu.id && s[1] === 'save'), 'a covered hit that would have downed them is a save');
    ok('Cover lasts 1.5 s, never covers perilous hits, and a lethal covered hit counts as a save');

    // nobody in reach
    g.time += COVER.cd + 1; cl.x = gu.x + 20; sw.x = gu.x + 30; g.events = [];
    assert.equal(g.cover(gu), false);
    assert.ok(g.events.some(e => e.t === 'cover' && e.fail && e.to === gu.id), 'told there is nobody to cover');
    ok('Cover needs an ally within 8 m');
  } finally { Math.random = random; }
}

// ---------- flanking / Pincer ----------
{
  const m = { x: 0, z: 0, face: 0, def: MOBS.warden }; // faces +z
  const at = deg => ({ x: Math.sin((deg * Math.PI) / 180) * 3, z: Math.cos((deg * Math.PI) / 180) * 3 });
  assert.equal(fromBehind(m, at(0).x, at(0).z), false, 'in front');
  assert.equal(fromBehind(m, at(90).x, at(90).z), false, 'side');
  assert.equal(fromBehind(m, at(119).x, at(119).z), false, 'just outside the back 120°');
  assert.equal(fromBehind(m, at(121).x, at(121).z), true);
  assert.equal(fromBehind(m, at(180).x, at(180).z), true, 'right behind');
  assert.equal(fromBehind(m, at(-125).x, at(-125).z), true);
  assert.ok(Math.abs(apartAround(m, at(0), at(180)) - Math.PI) < 1e-9 && apartAround(m, at(10), at(-110)) >= FLANK.apart);
  assert.ok(apartAround(m, at(0), at(100)) < FLANK.apart);
  ok('back 120° and 120°-apart angles');

  const { g, W, gu, sw, cl, stats } = setup();
  W.x = 0; W.z = 160; W.face = 0; W.threat.set(gu.id, 100);
  const put = (p, deg, r = 3.5) => { p.x = W.x + Math.sin((deg * Math.PI) / 180) * r; p.z = W.z + Math.cos((deg * Math.PI) / 180) * r; };
  put(gu, 0); put(cl, 0, 30); put(sw, 90);
  const random = Math.random; Math.random = () => 0.5;
  const hit = p => { const h = W.hp; g.damageMob(W, p, 100); return h - W.hp; };
  try {
    assert.equal(hit(sw), 100, 'from the side: no bonus');
    put(sw, 160);
    assert.equal(hit(sw), Math.round(100 * FLANK.dmg.pincer), 'opposite the tank: Pincer');
    const tags = g.events.filter(e => e.t === 'flank' && e.k === 'pincer');
    assert.deepEqual(tags.map(e => e.to).sort(), [gu.id, sw.id].sort(), 'the Pincer tag goes to the two of them only');
    assert.ok(stats.filter(s => s[1] === 'flank').length === 2);
    assert.equal(hit(gu), Math.round(100 * FLANK.dmg.pincer), 'the tank in front gets the Pincer too');
    g.events = [];
    hit(sw);
    assert.ok(!g.events.some(e => e.t === 'flank'), 'tags are throttled');
    put(gu, 0, 20); // the tank steps away: just a back hit
    assert.equal(hit(sw), Math.round(100 * FLANK.dmg.back), 'from behind alone: +10%');
    put(gu, 60); put(sw, 150); // only 90° apart, and sw is behind
    assert.equal(hit(sw), Math.round(100 * FLANK.dmg.back));
    const stranger = g.addPlayer(null, 'Stranger', 'lancer');
    put(gu, 0, 20); put(stranger, 0);
    assert.equal(hit(sw), Math.round(100 * FLANK.dmg.back), 'a Pincer needs a party member');
    stranger.x = 999;
    put(sw, 180, 20);
    assert.equal(hit(sw), 100, 'out of melee reach: no flank');
    // posture: a Pincer also adds posture
    put(gu, 0); put(sw, 180); W.posture = 0; W.staggerUntil = 0;
    g.damageMob(W, sw, 100); const pp = W.posture;
    put(sw, 90); W.posture = 0;
    g.damageMob(W, sw, 100);
    assert.ok(pp > W.posture * FLANK.dmg.pincer * 1.05, `more posture in a Pincer (${pp.toFixed(1)} vs ${W.posture.toFixed(1)})`);
  } finally { Math.random = random; }
  ok('flank +10%, Pincer +20% (and posture) for both, tagged only to them; party members only, melee reach');
}

// ---------- tanked / heal saves ----------
{
  const { g, W, gu, cl, sw, stats } = setup();
  W.threat.set(gu.id, 100); W.threat.set(sw.id, 10);
  const random = Math.random; Math.random = () => 0.5;
  try {
    g.damagePlayer(gu, 50, { src: 'warden cleave', mob: W });
    g.damagePlayer(sw, 50, { src: 'warden cleave', mob: W });
    const tanked = stats.filter(s => s[1] === 'tanked');
    assert.ok(tanked.length === 1 && tanked[0][0] === gu.id && tanked[0][2] > 0, 'only the top threat books "tanked"');
    sw.hp = 40; g.healPlayer(sw, 60, cl, 'heal'); // 100 now
    g.damagePlayer(sw, 70 / (1 - (sw.gearDr || 0)), { src: 'warden cleave', mob: W });
    assert.ok(!sw.dead && stats.some(s => s[0] === cl.id && s[1] === 'save'), 'a heal that kept them up through the next hit is a save');
  } finally { Math.random = random; }
  ok('teamStat: tanked (damage taken as top threat), save (heal that kept someone up)');
}

// ---------- bots ----------
{
  const sent = [];
  const warden = { id: 9, x: 0, z: 10, winding: true, tgt: 2, def: MOBS.warden };
  const b = { id: 1, cls: 'guardian', skill: 5, t: 50, x: 0, z: 3, dead: false, me: { cov: 0 }, mobs: [warden], tele: [], send: o => sent.push(o) };
  const mate = { id: 2, x: 2, z: 6, hp: 40, maxHp: 100, dead: false };
  const ctx = { party: { all: [{ id: 1, x: 0, z: 3, hp: 100, maxHp: 100 }, mate] } };
  assert.equal(botCover(b, ctx), true);
  assert.deepEqual(sent[0], { type: 'cover', tid: 2 }, 'Covers the hurt ally the winding boss is after');
  b.t += 5; sent.length = 0; mate.hp = 80;
  assert.equal(botCover(b, ctx), false, 'not when they are healthy');
  mate.hp = 40; warden.tgt = 1; b.players = [{ id: 1, x: 0, z: 3 }, mate];
  assert.equal(botCover(b, ctx), true, 'in the swing aimed at the tank');
  b.t += 5; sent.length = 0; mate.x = 0; mate.z = 16; // behind the boss
  assert.equal(botCover(b, ctx), false, 'not behind it');
  mate.x = 2; mate.z = 6; warden.tgt = 2; warden.winding = false;
  assert.equal(botCover(b, ctx), false, 'not without a big hit coming');
  b.tele = [{ x: 2, z: 6, r: 3, until: b.t + 0.8 }];
  assert.equal(botCover(b, ctx), true, 'a telegraph under them counts');
  b.t += 5; b.me.cov = 4; assert.equal(botCover(b, ctx), false, 'on cooldown');
  assert.equal(lostAggro(b, warden, ctx), true, 'the boss turned on a mate: Taunt it back');
  warden.tgt = 1; assert.equal(lostAggro(b, warden, ctx), false);
  const [x, z] = oppositeSpot({ x: 0, z: 0 }, { x: 0, z: -3 }, 4);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(z - 4) < 1e-9, 'the far side from the tank');
  ok('bots: Guardian Covers a hurt ally under a big hit, re-Taunts, melee takes the far side');
}

console.log(`threat: ${n} passed`);
