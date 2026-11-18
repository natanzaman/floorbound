// In-process checks for the Ranger and Berserker (shared/classes/, server/classes-a.js), plus a save/load round trip
// through a real server + Postgres when DATABASE_URL is set.
// Usage: node test/classes-a.js        (DATABASE_URL=... PORT=3603 node test/classes-a.js for the persistence check)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { CLASSES, CLASS_IDS, SWITCH, angleTo, statsFor, paced } from '../shared/data.js';
import { MASTERY, BRANCHES, newMastery } from '../shared/mastery.js';
import { makeItem } from '../shared/items.js';
import { RECIPES, recipeName, SMITH } from '../shared/crafting.js';
import { RANGER_TUNE as RT } from '../shared/classes/ranger.js';
import { RAGE, BERSERKER_TUNE as BT } from '../shared/classes/berserker.js';

const realRandom = Math.random;
Math.random = () => 0.5; // no crits, no damage variance

const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = (t, f = () => true) => { flush(); return events.filter(e => e.t === t && f(e)); };
const clear = () => { flush(); events = []; };
function advance(dt) { // scheduled callbacks, arrows, traps, Rage (no mob AI, so mobs stay put)
  const end = g.time + dt;
  while (g.time < end - 1e-9) {
    const step = Math.min(0.05, end - g.time);
    g.time += step;
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateClassesA(step);
    g.updateMastery();
  }
}
let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

g.mobs.clear(); g.boss = null;
const ranger = g.addPlayer(null, 'Sylas', 'ranger');
const zerk = g.addPlayer(null, 'Bjorn', 'berserker');
const ally = g.addPlayer(null, 'Kael', 'swordsman');
const all = [ranger, zerk, ally];
for (const p of all) { p.lvl = 10; g.recompute(p); p.hp = p.maxHp; }
g.time = 100;
const X = 0, Z = 70; // open ground on the road north of town

function reset() {
  for (const m of g.mobs.values()) g.mobs.delete(m.id);
  g.scheduled = []; g.arrowList = []; g.trapList = [];
  for (const p of all) {
    Object.assign(p, { x: X, z: Z, face: 0, dead: false, cds: [0, 0, 0, 0], dr: { until: 0, v: 0 }, dmg: { until: 0, v: 0 }, cry: { until: 0, v: 0 }, iframeUntil: 0, airFrom: 0, airUntil: 0, counterUntil: 0, counterAt: -1, combo: 0, lastBasic: -9, rage: 0, rageAt: 0, brA: null, lsA: null });
    p.hp = p.maxHp;
    p.mastery = newMastery({}, p.cls);
  }
  g.time += 30; clear();
}
function wolf(x, z, hp = 5000) {
  const m = g.addMob('wolf', x, z);
  m.hp = m.maxHp = hp; m.sx = m.x; m.sz = m.z;
  return m;
}
const slotOf = (p, sk) => CLASSES[p.cls].skills.findIndex(s => s.id === sk);
const use = (p, sk) => g.useSkill(p, slotOf(p, sk), p.face);
const hits = (m, by) => ev('hit', e => e.id === m.id && (!by || e.by === by.id));
const dmgOn = (m, by) => hits(m, by).reduce((a, e) => a + e.a, 0);
const evolve = (p, sk, br) => { p.mastery[sk] = { pts: MASTERY.need[3], br }; };
const pts = (p, sk) => p.mastery[sk].pts;
const A = p => p.atk * g.dmgMult(p);

// ---------- class table, items, crafting ----------
{
  assert.deepEqual(CLASS_IDS.slice(0, 3), ['swordsman', 'guardian', 'cleric'], 'existing class indices unchanged');
  for (const id of ['ranger', 'berserker']) {
    const c = CLASSES[id];
    assert.ok(CLASS_IDS.includes(id) && c.role === 'Damage' && c.tag === 'dps' && c.blurb && c.skills.length === 4);
    assert.equal(c.skills[3].lvl, 3);
    for (const s of c.skills.slice(1)) assert.ok(BRANCHES[s.id]?.A && BRANCHES[s.id]?.B, `${s.id} has two branches`);
    assert.ok(c.skills.slice(1).some(s => BRANCHES[s.id].A.coop || BRANCHES[s.id].B.coop), `${id} has a co-op branch`);
    for (let r = 0; r < 4; r++) assert.ok(makeItem('weapon', r, id).name, 'weapon names per rarity');
    for (const rc of RECIPES.filter(rc => rc.cls)) assert.ok(!recipeName(rc, id).endsWith('Blade'), 'class recipe name');
  }
  assert.ok(statsFor('ranger', 10).maxHp < statsFor('swordsman', 10).maxHp, 'Ranger: low health');
  assert.equal(recipeName(RECIPES.find(r => r.id === 'tuskbreaker'), 'ranger'), 'Tuskbreaker Longbow');
  reset();
  Object.assign(zerk, { x: SMITH.x, z: SMITH.z + 3, gold: 9999 }); zerk.inv.mats = { tusk: 50, dust: 50, ess: 50 };
  g.handle(zerk, { type: 'smith', a: 'craft', id: 'tuskbreaker', cls: 'berserker' });
  const it = zerk.inv.bag.at(-1);
  assert.equal(it?.name, 'Tuskbreaker Greataxe'); assert.equal(it.cls, 'berserker');
  g.handle(zerk, { type: 'equip', u: it.u });
  assert.equal(zerk.inv.eq.weapon?.u, it.u, 'equips its class weapon');
  zerk.inv = { ...zerk.inv, eq: { weapon: null, armor: null, charm: null }, bag: [] }; g.recompute(zerk);
  ok('classes appended (indices kept), roles, branches, weapon names, class recipes craft and equip');
}

// ---------- Ranger ----------
{ // arrows: real travel time, hit the first enemy in the path
  reset();
  const a = wolf(X, Z + 12), b = wolf(X, Z + 16);
  use(ranger, 'shot');
  assert.equal(ev('aproj', e => e.by === ranger.id).length, 1, 'an arrow is fired');
  advance(0.15);
  assert.equal(hits(a).length, 0, 'not there yet after 0.15 s');
  advance(0.4);
  assert.equal(hits(a, ranger).length, 1, 'hits the first wolf');
  assert.equal(hits(b).length, 0, 'stops on the first enemy');
  assert.equal(ev('apend', e => e.h === 1).length, 1);
  assert.equal(dmgOn(a, ranger), Math.round(A(ranger) * RT.arrow.mult[0]));
  assert.equal(g.arrowList.length, 0);
  ok('Shot: a real projectile with travel time; hits the first enemy in its path');
}
{ // 3-shot rhythm and point-blank falloff
  reset();
  const far = wolf(X, Z + 12);
  const got = [];
  for (let i = 0; i < 3; i++) { ranger.cds[0] = 0; clear(); use(ranger, 'shot'); advance(0.5); got.push(dmgOn(far, ranger)); }
  assert.equal(got[0], got[1]);
  assert.equal(got[2], Math.round(A(ranger) * RT.arrow.mult[2]), 'third arrow hits harder');
  reset();
  const near = wolf(X, Z + 2.2);
  use(ranger, 'shot'); advance(0.3);
  assert.equal(dmgOn(near, ranger), Math.round(A(ranger) * RT.arrow.close[2]), 'point-blank: 60%');
  ok('Shot: every third arrow hits harder; point-blank arrows are weak');
}
{ // arrows home in on the target picked when fired, and trees stop them
  reset();
  const m = wolf(X + 4, Z + 14);
  ranger.face = angleTo(X, Z, m.x, m.z) + 0.25; // a little off
  use(ranger, 'shot'); advance(0.8);
  assert.equal(hits(m, ranger).length, 1, 'homes in');
  ok('Shot: aims at the enemy in front (cone) and steers onto it');
}
{ // Piercing Shot: draw, then pierce a line with heavy posture damage
  reset();
  const ms = [wolf(X, Z + 5), wolf(X, Z + 10), wolf(X, Z + 15)];
  const before = pts(ranger, 'pierce');
  use(ranger, 'pierce');
  advance(0.3);
  assert.equal(ev('hit').length, 0, 'still drawing');
  advance(0.8);
  for (const m of ms) assert.equal(hits(m, ranger).length, 1, 'pierces every wolf in the line');
  const cap = g.postureCap(ms[1]);
  assert.ok(ms[1].posture >= RT.pierce.frac[0] * cap, 'heavy posture damage');
  assert.ok(pts(ranger, 'pierce') > before, 'mastery credit');
  ok('Piercing Shot: a 0.45 s draw, then pierces everything in the line with heavy posture damage; mastery');
}
{ // Disengage: leap back, fire, caltrops slow
  reset();
  const m = wolf(X, Z + 1.5);
  use(ranger, 'disengage');
  assert.ok(Math.abs(ranger.z - (Z - RT.disengage.dist)) < 0.6, 'leapt back ~7 m');
  assert.equal(ev('tp', e => e.id === ranger.id).length, 1);
  advance(0.5);
  assert.ok(hits(m, ranger).length >= 1, 'fired (and caltrops bite)');
  assert.equal(g.mobSlowA(m), RT.disengage.trap.slow, 'slowed inside the caltrops');
  const x0 = m.x, z0 = m.z;
  g.moveMob(m, m.x + 50, m.z, 10, 0.1, 0);
  assert.ok(Math.abs(Math.hypot(m.x - x0, m.z - z0) - 0.5) < 0.05, 'moves at half speed');
  const before = pts(ranger, 'disengage');
  advance(1.5);
  assert.ok(pts(ranger, 'disengage') > before, 'caltrops credit mastery');
  m.x += 20; advance(0.4);
  assert.equal(g.mobSlowA(m), 1, 'not slowed once out');
  advance(6);
  assert.equal(g.trapList.length, 0, 'caltrops expire');
  ok('Disengage: leaps 7 m back and fires; caltrops slow enemies by 50% and tick damage; mastery');
}
{ // Hunter's Mark: party damage bonus and stronger Switches
  reset(); ranger.lvl = 10;
  const marked = wolf(X, Z + 6), plain = wolf(X + 8, Z + 6);
  ranger.face = 0; use(ranger, 'mark');
  assert.equal(ev('markA', e => e.id === marked.id).length, 1);
  const hit = m => { clear(); g.damageMob(m, ally, 100); return dmgOn(m, ally); };
  assert.equal(hit(plain), 100);
  assert.equal(hit(marked), Math.round(100 * (1 + RT.mark.bonus)), 'party deals +15%');
  const before = pts(ranger, 'mark');
  for (const m of [marked, plain]) { m.staggerUntil = g.time + 2; m.staggerBy = zerk.id; m.switched = false; }
  assert.equal(hit(plain), Math.round(100 * SWITCH.first));
  assert.equal(hit(marked), Math.round(100 * SWITCH.first * (1 + RT.mark.bonus) * RT.mark.sw), 'stronger Switch');
  assert.ok(pts(ranger, 'mark') >= before + MASTERY.setup, 'the mark is credited for the Switch and the bonus');
  g.time += RT.mark.dur + 0.1;
  assert.equal(hit(marked), 100, 'expires');
  ok("Hunter's Mark: +15% party damage on the target, Switches on it 30% stronger; mastery; expires");
}

// ---------- Berserker ----------
{ // Rage: from dealing and taking damage, decays out of combat; thin armour
  reset();
  const m = wolf(X, Z + 2);
  use(zerk, 'chop');
  const dealt = dmgOn(m, zerk);
  assert.ok(Math.abs(zerk.rage - Math.min(RAGE.hitCap, (dealt / zerk.atk) * RAGE.hit)) < 1e-6, 'Rage from dealing damage');
  const r0 = zerk.rage;
  const hp0 = zerk.hp, hpA = ally.hp;
  g.damagePlayer(zerk, 50, { src: 'wolf bite' }); g.damagePlayer(ally, 50, { src: 'wolf bite' });
  assert.equal(hp0 - zerk.hp, Math.round(50 * BT.taken), 'takes 10% more damage');
  assert.equal(hpA - ally.hp, 50);
  assert.ok(Math.abs(zerk.rage - r0 - ((hp0 - zerk.hp) / zerk.maxHp) * RAGE.hurt) < 1e-6, 'Rage from taking damage');
  advance(RAGE.decayAfter - 0.5);
  assert.ok(zerk.rage > r0, 'no decay while fighting');
  advance(3);
  assert.ok(zerk.rage < r0, 'decays out of combat');
  assert.ok(ev('rageA', e => e.l.some(x => x[0] === zerk.id)).length >= 1, 'broadcast to clients');
  ok('Rage: built by dealing and taking damage, decays out of combat, broadcast; the Berserker takes +10% damage');
}
{ // Axe Chop: slow heavy combo, big posture
  reset();
  const m = wolf(X, Z + 2), s = wolf(X + 30, Z + 2);
  use(zerk, 'chop');
  const posZ = m.posture;
  assert.ok(Math.abs(zerk.cds[0] - g.time - CLASSES.berserker.skills[0].cd) < 1e-9);
  g.damageMob(s, ally, dmgOn(m, zerk)); // the same damage from a normal hit
  assert.ok(posZ > s.posture * 1.9, 'chops fill posture twice as fast');
  ok('Axe Chop: heavy hits (double posture), 0.85 s rhythm');
}
{ // Cleave scales with Rage
  reset();
  const m = wolf(X, Z + 2.5);
  use(zerk, 'cleave'); const low = dmgOn(m, zerk);
  zerk.cds[1] = 0; zerk.rage = 100; clear();
  use(zerk, 'cleave'); const high = dmgOn(m, zerk);
  assert.equal(low, Math.round(A(zerk) * BT.cleave.mult));
  assert.equal(high, Math.round(A(zerk) * (BT.cleave.mult + BT.cleave.rage)), 'double at full Rage');
  assert.ok(pts(zerk, 'cleave') > 0);
  ok('Cleave: wide arc, damage x2 at full Rage; mastery');
}
{ // Leap Slam: telegraphed landing, teleport, knock-up/stagger
  reset();
  const m = wolf(X, Z + 8);
  use(zerk, 'leap');
  const tele = ev('fx', e => e.k === 'ca' && e.v === 'leap')[0];
  assert.ok(tele && tele.r === BT.leap.r && tele.d === paced(BT.leap.delay), 'landing ring telegraphed');
  assert.ok(zerk.airUntil > g.time, 'airborne');
  advance(0.3);
  assert.equal(hits(m).length, 0, 'not landed yet');
  advance(0.5); // the paced leap lands at 0.715 s
  assert.ok(Math.abs(zerk.z - (Z + 8 - m.def.radius - 0.8)) < 0.6 && Math.abs(zerk.x - X) < 0.3, 'landed next to the target');
  assert.equal(hits(m, zerk).length, 1);
  assert.ok(m.stunUntil > g.time && m.launchUntil > g.time, 'staggered and knocked up');
  assert.ok(pts(zerk, 'leap') > 0);
  ok('Leap Slam: telegraphed landing ring, airborne leap onto the target, stagger + knock-up; mastery');
}
{ // Bloodrage: needs Rage; lifesteal, haste, costs health
  reset(); zerk.rage = 10;
  use(zerk, 'bloodrage');
  assert.equal(zerk.cds[3], 0, 'refused under 20 Rage (no cooldown)');
  assert.ok(!zerk.brA);
  zerk.rage = 80; const hp0 = zerk.hp;
  use(zerk, 'bloodrage');
  assert.equal(zerk.rage, 0, 'spends all Rage');
  assert.equal(hp0 - zerk.hp, Math.round(zerk.maxHp * BT.bloodrage.hp), 'costs 10% health');
  const dur = BT.bloodrage.dur[0] + (BT.bloodrage.dur[1] - BT.bloodrage.dur[0]) * 0.8;
  assert.ok(Math.abs(zerk.brA.until - g.time - dur) < 1e-6, 'lasts longer with more Rage');
  const m = wolf(X, Z + 2);
  zerk.hp = 50; clear();
  use(zerk, 'chop');
  assert.equal(zerk.hp, 50 + Math.round(dmgOn(m, zerk) * BT.bloodrage.ls), 'lifesteal');
  assert.ok(Math.abs(zerk.cds[0] - g.time - CLASSES.berserker.skills[0].cd * BT.bloodrage.haste) < 1e-9, 'faster swings');
  m.windupAt = g.time + 0.4; zerk.cds[0] = 0; use(zerk, 'chop');
  assert.equal(m.windupAt, 0, 'cuts through wind-ups');
  assert.ok(pts(zerk, 'bloodrage') > 0, 'mastery from the lifesteal');
  advance(dur + 0.1);
  assert.ok(!zerk.brA, 'ends');
  ok('Bloodrage: needs 20 Rage, spends it all + 10% health; lifesteal, 40% faster swings, interrupts; mastery');
}

// ---------- evolutions ----------
{
  const evoFx = { rainofarrows: 'rain', snipershot: 'draw', snaretrap: 'snare', tumblevolley: 'tumble', packhunter: 'mark', deadeye: 'mark',
    whirlingaxe: 'whirl', executioner: 'execute', earthshatter: 'leap', pounce: 'pounce', frenzy: 'roar', warblood: 'warblood' };
  const seen = new Set();
  for (const p of [ranger, zerk]) {
    for (const s of CLASSES[p.cls].skills.slice(1)) {
      for (const br of ['A', 'B']) {
        reset(); evolve(p, s.id, br); p.rage = 60;
        wolf(X, Z + 3); wolf(X + 1.5, Z + 6); ally.hp = 40;
        assert.doesNotThrow(() => { use(p, s.id); advance(2.5); });
        const id = BRANCHES[s.id][br].id;
        assert.ok(ev('fx', e => e.k === 'ca' && e.v === evoFx[id]).length, `${id} emits its visual`);
        assert.ok(p.cds[slotOf(p, s.id)] > 0, `${id} went on cooldown`);
        seen.add(id);
      }
    }
  }
  assert.equal(seen.size, 12);
  ok('all 12 evolutions run without throwing, emit their visual and go on cooldown');
}
{ // Rain of Arrows vs Sniper Shot
  reset(); evolve(ranger, 'pierce', 'A');
  const m = wolf(X, Z + 12), m2 = wolf(X + 2.5, Z + 13);
  use(ranger, 'pierce'); advance(2.5);
  assert.equal(hits(m, ranger).length, RT.rain.ticks, 'Rain: every tick hits');
  assert.equal(hits(m2, ranger).length, RT.rain.ticks, 'Rain: an area');
  reset(); evolve(ranger, 'pierce', 'B');
  const a = wolf(X, Z + 8), b = wolf(X, Z + 14);
  use(ranger, 'pierce'); advance(0.9);
  assert.equal(hits(a).length, 0, 'Sniper: long draw');
  advance(0.8); // the paced draw looses at 1.43 s
  assert.equal(dmgOn(a, ranger), Math.round(A(ranger) * RT.sniper.mult), 'Sniper: one huge hit');
  assert.equal(hits(b).length, 0, 'Sniper: no pierce');
  assert.ok(ranger.cds[1] - g.time > CLASSES.ranger.skills[1].cd * MASTERY.cd2, 'Sniper: longer cooldown');
  ok('Rain of Arrows hits an area over time; Sniper Shot: long draw, one huge non-piercing hit, longer cooldown');
}
{ // Snare Trap roots; Tumble Volley fires a fan
  reset(); evolve(ranger, 'disengage', 'A');
  ranger.face = Math.PI; // facing south: the hop goes north... the snare stays where we stood
  use(ranger, 'disengage');
  const m = wolf(X, Z);
  advance(0.6);
  assert.ok(m.stunUntil > g.time + 1.5, 'Snare: rooted');
  assert.ok(m.posture > 0 && hits(m, ranger).length === 1, 'Snare: hit + posture');
  assert.equal(g.trapList.length, 0, 'Snare: sprung once');
  reset(); evolve(ranger, 'disengage', 'B');
  use(ranger, 'disengage');
  assert.ok(Math.abs(ranger.z - (Z - RT.tumble.dist)) < 0.6, 'Tumble: 9 m');
  assert.equal(ev('aproj', e => e.by === ranger.id).length, RT.tumble.n, 'Tumble: a fan of 3');
  assert.equal(g.trapList.length, 0, 'Tumble: no caltrops');
  ok('Snare Trap: roots and staggers what steps in; Tumble Volley: 9 m leap and a 3-arrow fan, no caltrops');
}
{ // Pack Hunter spreads; Deadeye is personal and always crits
  reset(); evolve(ranger, 'mark', 'A');
  const ms = [wolf(X, Z + 8), wolf(X + 3, Z + 9), wolf(X - 3, Z + 9), wolf(X + 30, Z + 9)];
  use(ranger, 'mark');
  assert.deepEqual(ms.map(m => !!m.markA), [true, true, true, false], 'Pack Hunter: 3 nearby enemies');
  clear(); g.damageMob(ms[1], ally, 100);
  assert.equal(dmgOn(ms[1], ally), Math.round(100 * (1 + RT.pack.bonus)));
  reset(); evolve(ranger, 'mark', 'B');
  const t = wolf(X, Z + 12);
  use(ranger, 'mark');
  clear(); g.damageMob(t, ally, 100);
  assert.equal(dmgOn(t, ally), 100, 'Deadeye: no party bonus');
  clear(); ranger.cds[0] = 0; use(ranger, 'shot'); advance(0.6);
  const h = hits(t, ranger)[0];
  assert.equal(h.c, 1, 'Deadeye: always crits');
  assert.equal(h.a, Math.round(A(ranger) * (1 + RT.deadeye.self) * 1.5));
  ok('Pack Hunter marks 3 enemies (+10% party damage); Deadeye: your own arrows always crit, +20%, no party bonus');
}
{ // Whirling Axe vs Executioner
  reset(); evolve(zerk, 'cleave', 'A');
  const behind = wolf(X, Z - 3);
  use(zerk, 'cleave'); advance(0.5);
  assert.equal(hits(behind, zerk).length, BT.whirlaxe.hits, 'Whirling Axe: 360°, twice');
  reset(); evolve(zerk, 'cleave', 'B'); zerk.rage = 50;
  const lo = wolf(X - 0.5, Z + 2.5), hi = wolf(X + 0.5, Z + 2.5);
  lo.hp = lo.maxHp * 0.2;
  use(zerk, 'cleave');
  assert.ok(zerk.rage <= 50 - BT.executioner.cost + 2 * RAGE.hitCap + 1e-9 && zerk.rage < 50, 'Executioner spends 30 Rage (then the two hits build some back)');
  assert.equal(dmgOn(lo, zerk), Math.round(A(zerk) * (BT.executioner.mult + BT.executioner.rage * 0.5) * BT.executioner.lowMult), 'double on low health');
  assert.equal(dmgOn(hi, zerk), Math.round(A(zerk) * (BT.executioner.mult + BT.executioner.rage * 0.5)));
  ok('Whirling Axe: two 360° sweeps; Executioner: narrow, spends 30 Rage, double damage under 35% health');
}
{ // Earthshatter breaks; Pounce is instant
  reset(); evolve(zerk, 'leap', 'A');
  const m = wolf(X, Z + 7, 110);
  use(zerk, 'leap'); advance(1.1); // the paced Earthshatter lands at 1.04 s
  assert.ok(ev('stagger', e => e.id === m.id).length === 1, 'Earthshatter: BREAKS');
  reset(); evolve(zerk, 'leap', 'B');
  const t = wolf(X, Z + 11);
  use(zerk, 'leap');
  assert.ok(Math.abs(zerk.z - (Z + 11 - t.def.radius - 0.8)) < 0.6 && hits(t, zerk).length === 1, 'Pounce: instant');
  assert.ok(zerk.rage >= BT.pounce.rage, 'Pounce: +20 Rage');
  reset(); evolve(zerk, 'leap', 'B');
  use(zerk, 'leap');
  assert.equal(zerk.cds[2], 0, 'Pounce needs a target');
  ok('Earthshatter: bigger landing that Breaks; Pounce: instant leap onto the target, +20 Rage');
}
{ // Frenzy keeps Rage; Warblood heals and shares lifesteal
  reset(); evolve(zerk, 'bloodrage', 'A'); zerk.rage = 40;
  use(zerk, 'bloodrage');
  assert.equal(zerk.rage, 40, 'Frenzy keeps Rage');
  wolf(X, Z + 2); zerk.cds[0] = 0; use(zerk, 'chop');
  assert.ok(Math.abs(zerk.cds[0] - g.time - CLASSES.berserker.skills[0].cd * BT.frenzy.haste) < 1e-9, 'Frenzy: twice as fast');
  reset(); evolve(zerk, 'bloodrage', 'B'); zerk.rage = 50; zerk.hp = 40; ally.hp = 30;
  use(zerk, 'bloodrage');
  assert.equal(zerk.hp, 40 + Math.round(zerk.maxHp * BT.warblood.heal * 50), 'Warblood: self heal');
  const m = wolf(X, Z + 2);
  clear(); g.damageMob(m, ally, 100);
  assert.equal(ally.hp, 30 + Math.round(100 * BT.warblood.ls), 'Warblood: allies heal from their damage');
  assert.ok(pts(zerk, 'bloodrage') > 0, 'credited to the Berserker');
  ok('Frenzy: keeps Rage, attacks twice as fast; Warblood: heals you and gives allies lifesteal (credited)');
}

// ---------- persistence round trip (needs DATABASE_URL) ----------
async function persistence() {
  if (!process.env.DATABASE_URL) { console.log('  skip - persistence (set DATABASE_URL to run it)'); return; }
  const port = Number(process.env.PORT) || 3603, base = `http://localhost:${port}`;
  const start = env => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; if (/running on/.test(out)) resolve(proc); });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', c => reject(new Error(`server exited ${c}: ${out}`)));
    setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 10000);
  });
  const stop = proc => new Promise(r => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(); });
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) }).then(r => r.json());
  const session = (token, id, onMsg) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', session: token, character: id })));
    ws.on('message', raw => { const msg = JSON.parse(raw); if (onMsg(msg, ws)) resolve(ws); });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });
  let srv = await start({ MASTERY: '3' });
  try {
    const { token } = await post('/api/guest');
    const tag = Math.floor(realRandom() * 1e6);
    const { character: rc } = await post('/api/characters', { name: `Rng${tag}`, cls: 'ranger' }, token);
    const { character: bc } = await post('/api/characters', { name: `Brs${tag}`, cls: 'berserker' }, token);
    assert.ok(rc?.id && bc?.id && rc.cls === 'ranger' && bc.cls === 'berserker', 'characters created');
    for (const [c, sk] of [[rc, 'pierce'], [bc, 'leap']]) {
      let me = 0, cls = null;
      const ws = await session(token, c.id, (msg, ws) => {
        if (msg.type === 'welcome') me = msg.id;
        if (msg.type === 'snap' && me && !cls) { const row = msg.w.players.find(r => r[0] === me); if (row) cls = CLASS_IDS[row[7]]; }
        if (msg.type === 'mastery' && !msg.m[sk].br) ws.send(JSON.stringify({ type: 'evolve', sk, br: 'B' }));
        return cls && msg.type === 'mastery' && msg.m[sk]?.br === 'B';
      });
      assert.equal(cls, c.cls, 'the snapshot resolves the class through CLASS_IDS');
      ws.send(JSON.stringify({ type: 'skill', slot: 1, face: 0 })); // use a skill live (no errors)
      await new Promise(r => setTimeout(r, 300));
      await new Promise(r => { ws.on('close', r); ws.close(); });
    }
    await new Promise(r => setTimeout(r, 500)); // the save on disconnect
    await stop(srv);
    srv = await start({ MASTERY: '' });
    for (const [c, sk, keys] of [[rc, 'pierce', ['pierce', 'disengage', 'mark']], [bc, 'leap', ['cleave', 'leap', 'bloodrage']]]) {
      let got = null, lvl = 0;
      const ws = await session(token, c.id, msg => { if (msg.type === 'welcome') lvl = msg.lvl; if (msg.type === 'mastery') { got = msg.m; return true; } return false; });
      ws.close();
      assert.deepEqual(Object.keys(got), keys, `${c.cls} skills`);
      assert.equal(got[sk].br, 'B', 'branch saved');
      assert.equal(got[sk].pts, MASTERY.need[3], 'mastery saved');
      assert.equal(lvl, c.lvl, 'level loaded');
    }
    ok('persistence: Ranger and Berserker characters (guest account) save and load class, level, mastery and branches');
  } finally { await stop(srv); }
}

await persistence();
Math.random = realRandom;
console.log(`all ${n} checks passed`);
process.exit(0);
