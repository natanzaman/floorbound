// In-process checks for the rescue traps (server/rescue.js, docs/ROADMAP.md J1): the Warden's Thornbind vines, the
// Sovereign's Drowning Pillar and the Colossus's storm crystal. Each trap's free, fail and timeout paths; the release
// when no free ally is left; revive winning over freeing; the rules (2 free fighters, never the boss's target, one
// team-scale mechanic at a time with a gap, off during shows, forceBossMove); trap objects giving no threat, XP, loot,
// posture, mastery, kill or team-stat credit; target picks skipping trapped players; the rotation and the bots.
// Usage: node test/rescue.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WORLD, MOBS, MOB_IDS, CLASSES } from '../shared/data.js';
import { F2 } from '../shared/floor2.js';
import { F3 } from '../shared/floor3.js';
import { RESCUE, TRAP_MOVES, RESCUE_MOB_IDS, readTraps } from '../shared/rescue.js';
import { BOSSTEAM } from '../shared/bossteam.js';
import { MVP_TITLE, buildCard } from '../shared/mvp.js';
import { parseSheet, validateSheet } from '../server/director-sheet.js';
import { rescueTurn, readRescue, rescueTarget } from '../shared/bots/rescue.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const ROOM = { warden: WORLD.arena, sovereign: F2.arena, colossus: F3.arena };
const LVL = { warden: 10, sovereign: 18, colossus: 30 };

// A boss fight in progress: P0 (the first class) holds the boss; the rest stand around it. All in one party.
function setup(boss = 'warden', classes = ['guardian', 'swordsman', 'cleric']) {
  const g = quiet(() => new Game());
  g.twistW = null; g.twist = null;
  const A = ROOM[boss];
  const B = boss === 'warden' ? g.boss : boss === 'sovereign' ? g.sovereign : g.colossus;
  const ps = classes.map((c, i) => {
    const p = g.addPlayer(null, `P${i}`, c);
    p.lvl = LVL[boss]; g.recompute(p); p.hp = p.maxHp; p.x = A.x + i * 6 - 6; p.z = A.z - 6;
    return p;
  });
  for (const p of ps.slice(1)) { g.invite(ps[0], p.id); g.accept(p, ps[0].id); }
  g.time = 30; g.events = [];
  if (boss === 'colossus') { process.env.F3_TWIST = 'calm'; g.newTwist3(); quiet(() => g.engageColossus(B)); }
  else {
    B.engaged = true; B.phase = 0;
    const f = { start: g.time, ids: new Set(ps.map(p => p.id)), deaths: 0, hp: B.maxHp };
    if (boss === 'warden') g.fight = f; else g.fight2 = f;
  }
  B.x = A.x; B.z = A.z + 8;
  ps.forEach((p, i) => B.threat.set(p.id, i ? 10 : 1000));
  const stats = [];
  const ts = g.teamStat;
  g.teamStat = function (p, key, k = 1) { stats.push([p.id, key, k]); return ts?.call(this, p, key, k); };
  return { g, B, ps, stats, A };
}
// Time, scheduled callbacks and the rescue tick (no AI: nobody moves unless the test moves them).
function run(g, secs) {
  const end = g.time + secs;
  while (g.time < end - 1e-9) {
    g.time = Math.min(end, g.time + 0.05);
    const due = g.scheduled.filter(s => s.at <= g.time);
    g.scheduled = g.scheduled.filter(s => s.at > g.time);
    for (const s of due) s.fn();
    g.updateRescue(0.05);
    g.updateDowned?.(0.05);
  }
}
const ev = (g, t, f = () => true) => g.events.filter(e => e.t === t && f(e));
const prop = (g, p) => g.mobs.get(p.trap?.prop);
const lost = p => 1 - p.hp / p.maxHp;
const land = (g, B, k, v) => { assert.equal(g.forceBossMove(B, k, v.id), true, `${k} starts`); run(g, RESCUE[k].wind + 0.06); assert.ok(v.trap?.k === k, `${k} landed on ${v.name}`); return v.trap; };

// ---------- data ----------
{
  for (const t of RESCUE_MOB_IDS) assert.ok(MOBS[t]?.prop && MOB_IDS.includes(t), `${t} is a prop mob`);
  assert.ok(MOB_IDS.indexOf(RESCUE_MOB_IDS[0]) > MOB_IDS.indexOf('colossus'), 'trap objects are appended after Floor 3 (indices never move)');
  for (const b of ['warden', 'sovereign', 'colossus']) assert.ok(BOSSTEAM[b].moves.every(l => l.some(k => TRAP_MOVES.includes(k))), `${b}: a trap in every phase's rotation`);
  const sheet = parseSheet(`title: t\ncast: [{ id: a, name: Ayla, class: swordsman, level: 10 }]\nscenes:\n  - id: s1\n    place: warden_arena\n    cues:\n      - { who: warden, do: boss_move, move: vines, target: a }\n      - { who: warden, do: boss_move, move: pillar }\n      - { who: warden, do: boss_move, move: crystal }\n`);
  assert.ok(sheet.sheet, sheet.error);
  assert.deepEqual(validateSheet(sheet.sheet).errors, []);
  ok('trap objects are prop mobs; each boss has its trap in every phase; the director knows the move names');
}

// ---------- Warden: Thornbind vines ----------
{
  const { g, B, ps, stats } = setup('warden');
  const v = ps[1], tr = land(g, B, 'vines', v);
  const tele = ev(g, 'trap')[0];
  assert.ok(tele && tele.k === 'vines' && tele.id === v.id && tele.d === RESCUE.vines.wind, 'telegraph first');
  const on = ev(g, 'trapon')[0];
  const vine = prop(g, v);
  assert.ok(on && vine && vine.type === 'vine' && on.prop === vine.id, 'a vine prop on the victim');
  assert.ok(Math.hypot(vine.x - v.x, vine.z - v.z) < 0.01 && vine.hp > 0 && vine.hp === vine.maxHp, 'with its own HP bar');
  // rooted: input, rolls and jumps don't move them
  const x0 = v.x, z0 = v.z;
  g.handle(v, { type: 'input', x: v.x + 0.5, z: v.z, face: 1, seq: v.posSeq });
  g.dodge(v, 0); g.jump(v);
  assert.ok(v.x === x0 && v.z === z0 && !(v.rollUntil > g.time), 'rooted: no walking, rolling or jumping');
  // damage over time
  const hp0 = v.hp; run(g, 2.1);
  assert.ok(v.hp < hp0, `light damage over time (${((hp0 - v.hp) / v.maxHp * 100).toFixed(1)}% in 2 s)`);
  // snapshot row
  const rows = readTraps(JSON.parse(g.snapshot()).trap);
  assert.equal(rows.get(v.id)?.k, 'vines'); assert.equal(rows.get(v.id)?.prop, vine.id);
  // free by hitting the vine (an ally): the prop breaks, the trap ends, credit
  const xp0 = ps[2].xp, kills0 = ps[2].stats.kills, m0 = JSON.stringify(ps[2].mastery);
  g.damageMob(vine, ps[2], vine.hp * 0.6, { sk: 1, heavy: true, brk: true });
  assert.ok(v.trap && vine.hp > 0, 'still trapped after a partial hit');
  assert.equal(vine.threat.size, 0, 'no threat on the vine'); assert.equal(vine.contributors.size, 0, 'no contributors');
  assert.ok(!vine.posture, 'no posture');
  g.damageMob(vine, ps[2], vine.maxHp, {});
  assert.equal(v.trap, null, 'freed');
  assert.ok(!g.mobs.has(vine.id), 'the vine is gone');
  const end = ev(g, 'trapend')[0];
  assert.ok(end.why === 'freed' && end.by === ps[2].id, 'trapend: freed by the hitter');
  assert.ok(stats.some(s => s[0] === ps[2].id && s[1] === 'rescue'), "teamStat(freer, 'rescue')");
  assert.ok(!stats.some(s => s[1] === 'dmg'), 'no team damage stat from the prop');
  assert.ok(ps[2].xp === xp0 && ps[2].stats.kills === kills0 && !ev(g, 'xp').length && !ev(g, 'loot').length, 'no XP, loot or kill');
  assert.equal(JSON.stringify(ps[2].mastery), m0, 'no mastery');
  ok('vines: telegraph, root, damage over time, a vine with its own HP bar; breaking it frees (credited, nothing else)');

  // free by holding E (1.5 s), on the next one
  g.events = []; B.btGapUntil = 0;
  const tr2 = land(g, B, 'vines', v);
  ps[2].x = v.x + 1.5; ps[2].z = v.z;
  g.handle(ps[2], { type: 'free', on: 1, id: v.id });
  assert.equal(tr2.by, ps[2].id, 'channel started');
  run(g, RESCUE.vines.hold - 0.3);
  assert.ok(v.trap, 'not yet');
  run(g, 0.4);
  assert.equal(v.trap, null, `held E ${RESCUE.vines.hold} s: free`);
  assert.ok(ev(g, 'trapend')[0].why === 'freed' && ev(g, 'trapend')[0].by === ps[2].id);
  // the channel breaks on stepping away (progress fades), and on acting
  g.events = []; B.btGapUntil = 0;
  const tr3 = land(g, B, 'vines', v);
  g.handle(ps[2], { type: 'free', on: 1, id: v.id }); run(g, 0.5);
  ps[2].x = v.x + 6; run(g, 0.1);
  assert.ok(!tr3.by && !ps[2].freeing, 'moving away breaks it');
  ps[2].x = v.x + 1.5; g.handle(ps[2], { type: 'free', on: 1, id: v.id }); run(g, 0.2); g.jump(ps[2]);
  assert.ok(!tr3.by, 'jumping breaks it');
  ok(`vines: a partymate holding E next to them frees them in ${RESCUE.vines.hold} s (moving away or acting breaks it)`);

  // timeout: nobody helps -> the vines wither, harmless apart from the ticks taken
  run(g, RESCUE.vines.max + 0.2);
  assert.equal(v.trap, null);
  assert.equal(ev(g, 'trapend')[0].why, 'timeout');
  assert.ok(!v.dead && !v.downed, 'survives the full duration from full health');
  assert.ok(!g.mobs.has(tr3.prop), 'the vine goes');
  ok(`vines: unhelped they wither after ${RESCUE.vines.max} s (timeout)`);

  // fail: the victim goes down -> the trap ends
  g.events = []; B.btGapUntil = 0; v.hp = v.maxHp;
  land(g, B, 'vines', v);
  v.iframeUntil = 0; g.damagePlayer(v, v.maxHp * 50, { peril: true, src: 'warden slam' });
  assert.ok(v.downed, 'downed (partymates near)');
  run(g, 0.1);
  assert.equal(v.trap, null); assert.equal(ev(g, 'trapend')[0].why, 'down');
  ok('vines: the victim going down ends the trap (fail); revive as usual');
}

// ---------- revive wins over freeing; own hits are weak ----------
{
  const { g, B, ps } = setup('warden', ['guardian', 'swordsman', 'cleric', 'ranger']);
  const v = ps[1];
  land(g, B, 'vines', v);
  const d = ps[3]; d.x = v.x + 2; d.z = v.z; d.iframeUntil = 0;
  g.damagePlayer(d, d.maxHp * 50, { peril: true, src: 'test' });
  assert.ok(d.downed);
  const r = ps[2]; r.x = v.x + 1.2; r.z = v.z + 0.5;
  g.handle(r, { type: 'free', on: 1, id: v.id });
  assert.ok(!r.freeing && r.reviving?.id === d.id, 'E with a downed partymate and a trapped one in reach: the revive wins');
  g.stopRevive(r); d.x = v.x + 20; g.startFree(r, v.id); assert.ok(r.freeing, 'nobody down in reach: E frees');
  d.x = v.x + 2;
  // a revive starting stops a freeing channel
  g.startRevive(r, d.id);
  assert.ok(!r.freeing && r.reviving, 'starting a revive drops the freeing channel');
  // own hits: a fraction
  const vine = prop(g, v), h0 = vine.hp;
  g.damageMob(vine, v, 100, {});
  assert.ok(h0 - vine.hp <= 100 * RESCUE.ownHit * 1.1 + 1, `the victim's own hits do ${RESCUE.ownHit * 100}%`);
  ok('revive wins over freeing (E starts the revive; a revive drops a freeing channel); own hits on the vine are weak');
}

// ---------- Sovereign: Drowning Pillar ----------
{
  const { g, B, ps, A, stats } = setup('sovereign');
  const v = ps[2], tr = land(g, B, 'pillar', v);
  const orb = prop(g, v), on = ev(g, 'trapon')[0];
  const d = Math.hypot(orb.x - v.x, orb.z - v.z);
  assert.ok(orb.type === 'tideorb' && d >= RESCUE.pillar.src[0] - 0.5 && Math.hypot(orb.x - A.x, orb.z - A.z) < A.r, `the orb is elsewhere in the room (${d.toFixed(1)} m away)`);
  assert.ok(on.sx === Math.round(orb.x * 100) / 100, 'trapon carries the source');
  const hp0 = v.hp; run(g, 1.1); assert.ok(v.hp < hp0, 'ticks damage');
  // break the orb
  g.damageMob(orb, ps[1], orb.maxHp + 5, {});
  assert.equal(v.trap, null); assert.equal(ev(g, 'trapend')[0].why, 'freed');
  assert.ok(stats.some(s => s[0] === ps[1].id && s[1] === 'rescue'));
  ok('pillar: pins the victim, ticks damage, fed by an orb elsewhere in the room; breaking the orb frees them');

  // a Guardian guarding on the orb->victim line blocks the ticks and breaks it
  g.events = []; B.btGapUntil = 0; v.hp = v.maxHp;
  const tr2 = land(g, B, 'pillar', v), orb2 = prop(g, v), gd = ps[0];
  gd.x = (orb2.x + v.x) / 2; gd.z = (orb2.z + v.z) / 2; g.guard(gd, true);
  const hp1 = v.hp; run(g, 0.6);
  assert.ok(tr2.blocked && v.hp === hp1, 'blocked: no ticks');
  run(g, RESCUE.pillar.block);
  assert.equal(v.trap, null); assert.ok(ev(g, 'trapend')[0].why === 'freed' && ev(g, 'trapend')[0].by === gd.id, 'the Guardian body-blocked it');
  g.guard(gd, false);
  // off the line: not blocked
  g.events = []; B.btGapUntil = 0;
  const tr3 = land(g, B, 'pillar', v), orb3 = prop(g, v);
  gd.x = v.x + (v.x - orb3.x) * 0.5 + 4; gd.z = v.z + 4; g.guard(gd, true); run(g, 0.6);
  assert.ok(!tr3.blocked, 'guarding off the line does nothing');
  g.guard(gd, false);
  // Cover on the victim: ends it at once
  g.events = [];
  v.cover = { by: gd.id, until: g.time + 1.5 }; run(g, 0.1);
  assert.equal(v.trap, null); assert.ok(ev(g, 'trapend')[0].by === gd.id, 'a Guardian Covering the victim breaks it');
  ok(`pillar: a Guardian guarding on the line blocks it (${RESCUE.pillar.block} s breaks it), or Covering the victim`);

  // timeout and fail
  g.events = []; B.btGapUntil = 0; v.hp = v.maxHp;
  land(g, B, 'pillar', v); run(g, RESCUE.pillar.max + 0.2);
  assert.equal(ev(g, 'trapend')[0].why, 'timeout'); assert.ok(!v.dead && !v.downed && lost(v) > 0.4, `drains away after ${RESCUE.pillar.max} s, having hurt (${(lost(v) * 100).toFixed(0)}%)`);
  g.events = []; B.btGapUntil = 0; v.hp = Math.round(v.maxHp * 0.05);
  land(g, B, 'pillar', v); run(g, 1.2);
  assert.ok(v.downed, 'low health: the pillar downs them'); assert.equal(ev(g, 'trapend')[0].why, 'down');
  ok('pillar: timeout (drains away) and fail (the victim goes down)');
}

// ---------- Colossus: storm crystal ----------
{
  const { g, B, ps, stats } = setup('colossus');
  const v = ps[1], tr = land(g, B, 'crystal', v);
  const cr = prop(g, v);
  assert.ok(cr.type === 'stormcrystal' && tr.until - g.time <= RESCUE.crystal.fuse, 'a crystal on them with a fuse');
  // encased: can't act, the boss can't hurt them
  const hp0 = v.hp, cd0 = JSON.stringify(v.cds);
  g.damagePlayer(v, 500, { src: 'hammerfall', mob: B });
  g.useSkill(v, 0, 0); g.guard(v, true);
  assert.ok(v.hp === hp0 && JSON.stringify(v.cds) === cd0 && !v.guarding, "encased: can't act or be hurt");
  // break it
  g.damageMob(cr, ps[2], cr.maxHp * 0.5, {}); g.damageMob(cr, ps[0], cr.maxHp, {});
  assert.equal(v.trap, null); assert.ok(ev(g, 'trapend')[0].why === 'freed' && ev(g, 'trapend')[0].by === ps[0].id);
  assert.ok(stats.some(s => s[1] === 'rescue'));
  ok("crystal: encased (can't act, the boss can't hurt them); breaking the crystal frees them");

  // fail: the fuse runs out -> it detonates on the room (everyone, the victim too)
  g.events = []; B.btGapUntil = 0;
  for (const p of ps) p.hp = p.maxHp;
  land(g, B, 'crystal', v); run(g, RESCUE.crystal.fuse + 0.1);
  assert.equal(ev(g, 'trapend')[0].why, 'boom');
  for (const p of ps) assert.ok(lost(p) > RESCUE.crystal.boom * 0.6, `${p.name} hit by the detonation (${(lost(p) * 100).toFixed(0)}%)`);
  ok(`crystal: unbroken after ${RESCUE.crystal.fuse} s it detonates on the whole party (fail / timeout)`);
}

// ---------- auto-release: no free ally left ----------
{
  for (const [boss, k] of [['warden', 'vines'], ['sovereign', 'pillar'], ['colossus', 'crystal']]) {
    const { g, B, ps } = setup(boss, ['guardian', 'swordsman']);
    const v = ps[1];
    land(g, B, k, v);
    const hp0 = v.hp;
    ps[0].iframeUntil = 0; quiet(() => g.killPlayer(ps[0], 'test'));
    run(g, 0.1);
    assert.equal(v.trap, null, `${k}: released`); assert.equal(ev(g, 'trapend')[0].why, 'alone');
    assert.ok(v.hp >= hp0 - 1, `${k}: harmlessly (no detonation)`);
  }
  // a downed partner counts as not free
  const { g, B, ps } = setup('warden', ['guardian', 'swordsman', 'cleric']);
  land(g, B, 'vines', ps[1]);
  ps[2].x = ps[0].x + 1; for (const p of [ps[0]]) { p.iframeUntil = 0; g.damagePlayer(p, p.maxHp * 50, { peril: true }); }
  assert.ok(ps[0].downed);
  ps[2].iframeUntil = 0; quiet(() => g.killPlayer(ps[2], 'test'));
  run(g, 0.1);
  assert.equal(ev(g, 'trapend')[0]?.why, 'alone', 'duo whose partner is down: released');
  ok('no free ally left (solo, or the partner down or dead): every trap releases harmlessly');
}

// ---------- rules ----------
{
  // solo: never; two free fighters needed
  const { g, B, ps } = setup('warden', ['swordsman']);
  assert.equal(g.forceBossMove(B, 'vines', ps[0].id), false, 'solo: no trap even when forced');
  for (let i = 0; i < 200 * 20; i++) { g.time += 0.05; g.bossTeam(B, g.btFighters(B)); }
  assert.equal(ev(g, 'trap').length, 0, 'solo: none in the rotation');
  // never the boss's target
  const s = setup('warden', ['guardian', 'swordsman', 'cleric']);
  for (let i = 0; i < 40; i++) {
    s.g.btActive = []; s.B.btGapUntil = 0; for (const p of s.ps) p.trap = null;
    assert.equal(s.g.trapStart(s.B, 'vines'), true);
  }
  const picked = ev(s.g, 'trap').map(e => e.id);
  assert.ok(!picked.includes(s.ps[0].id) && picked.includes(s.ps[1].id) && picked.includes(s.ps[2].id), 'never the boss\'s current target (either of the others)');
  // with two free fighters, the target is the one who stays free
  const d = setup('warden', ['guardian', 'ranger']);
  assert.equal(d.g.trapStart(d.B, 'vines'), true); assert.equal(ev(d.g, 'trap')[0].id, d.ps[1].id);
  // one at a time, then a gap
  assert.equal(d.g.forceBossMove(d.B, 'vines', d.ps[1].id), false, 'one trap per boss at a time');
  assert.ok(d.g.btBusy(d.B), 'busy while it runs');
  run(d.g, RESCUE.vines.wind + 0.1); d.g.damageMob(prop(d.g, d.ps[1]), d.ps[0], 1e5, {});
  assert.ok(d.g.btBusy(d.B) && d.B.btGapUntil >= d.g.time + RESCUE.gap - 0.01, `then a ${RESCUE.gap} s gap before the next team mechanic`);
  d.g.events = [];
  for (let i = 0; i < (RESCUE.gap - 1) * 20; i++) { d.g.time += 0.05; d.B.btT = 0; d.g.bossTeam(d.B, d.g.btFighters(d.B)); }
  assert.equal(ev(d.g, 'bt').length + ev(d.g, 'trap').length, 0, 'nothing in the gap');
  // director show: none naturally; a cue can force one
  const f = setup('sovereign', ['guardian', 'swordsman', 'cleric']);
  f.g.director = { running: true };
  for (let i = 0; i < 120 * 20; i++) { f.g.time += 0.05; f.g.bossTeam(f.B, f.g.btFighters(f.B)); }
  assert.equal(ev(f.g, 'trap').length + ev(f.g, 'bt').length, 0, 'none during a show');
  assert.equal(f.g.forceBossMove(f.B, 'pillar', f.ps[0].id), true, 'forceBossMove may even aim at the boss\'s target');
  // G4 moves pick free players only; a trapped player isn't the boss's target
  run(f.g, RESCUE.pillar.wind + 0.1);
  assert.ok(f.ps[0].trap && !f.g.btFighters(f.B).includes(f.ps[0]), 'trapped players are out of G4 picks');
  const th = JSON.parse(f.g.snapshot()).th || [];
  assert.ok(!th.some(r => r[1] === f.ps[0].id), 'the boss turns away from a trapped player (threat marker)');
  assert.notEqual(f.g.threatTop(f.B)?.[0], f.ps[0].id); assert.notEqual(f.g.topThreat(f.B), f.ps[0].id);
  ok('rules: 2 free fighters; never the boss\'s target; one at a time + gap; none in shows (forceBossMove works); trapped players are never targets');
}

// ---------- Overload waits for a trap; the Colossus's rotation draws the crystal ----------
{
  const { g, B, ps } = setup('colossus');
  B.phase = 1; land(g, B, 'crystal', ps[1]);
  B.ovT = 0; g.startOverload(B, ps);
  assert.ok(!B.ov && B.ovT > g.time, 'Overload waits while a trap runs');
  g.forceBossMove(B, 'overload'); assert.ok(B.ov, 'a forced Overload still goes');
  ok('the Colossus: Overload waits for a running trap (a cue can still force it)');
}

// ---------- prop exclusions: taunts, threat UI, kills, the Named, loot, MVP ----------
{
  const { g, B, ps } = setup('warden');
  const v = ps[1]; land(g, B, 'vines', v);
  const vine = prop(g, v), gd = ps[0];
  gd.x = vine.x + 1; gd.z = vine.z; gd.lvl = 10; g.recompute(gd);
  const tauntSlot = CLASSES.guardian.skills.findIndex(sk => sk.id === 'taunt');
  gd.cds = gd.cds.map(() => 0); g.useSkill(gd, tauntSlot, 0); // Taunt right next to the vine
  vine.threat.set(gd.id, 9999); vine.contributors.add(gd.id);
  assert.equal(vine.threat.size + vine.contributors.size, 0, "a prop's threat and credit ignore writes (taunts can't stick)");
  g.healPlayer(v, 50, ps[2], null); g.addThreatHeal?.(ps[2], 50);
  assert.equal(vine.threat.size, 0, 'no heal threat');
  const snap = JSON.parse(g.snapshot());
  assert.ok(!(snap.th || []).some(r => r[0] === vine.id), 'no threat marker on a prop');
  const row = snap.mobs.find(r => r[0] === vine.id);
  assert.ok(row && !(row[7] & 2), 'shown as a mob with an HP bar, never "engaged"');
  let named = 0; g.named = { onMobDead: () => named++, humanIn: () => true, stOf: () => null };
  g.damageMob(vine, gd, 1e5, {});
  assert.equal(named, 0, "the Named's kill hooks never see it");
  assert.ok(!ev(g, 'xp').length && !ev(g, 'la').length && !ev(g, 'loot').length && !ev(g, 'clear').length, 'no XP, loot or clear');
  g.named = null;
  const card = buildCard({ boss: 'warden', floor: 1, result: 'kill', secs: 60, rows: [{ id: 1, name: 'A', rescue: 2, dmg: 10 }, { id: 2, name: 'B', dmg: 100 }] });
  assert.ok(card.rows.find(r => r.id === 1).titles.includes('rescuer') && MVP_TITLE.rescuer.name === 'Rescuer', 'MVP card: "Rescuer" title');
  ok('trap objects: no threat (taunts, heal threat), no threat marker, no kill / XP / loot / Named hooks; MVP "Rescuer" title');
}

// ---------- scripted deaths clear a trap ----------
{
  const { g, B, ps } = setup('warden');
  land(g, B, 'vines', ps[1]);
  g.scriptDeath(ps[1], { respawn: false });
  assert.equal(ps[1].trap, null); assert.equal(ev(g, 'trapend')[0].why, 'off');
  ok('film safety: scriptDeath clears a trap');
}

// ---------- bots ----------
{
  const mk = (id, cls, role, x, z) => ({ id, cls, role, x, z, hp: 100, maxHp: 100, party: 1, dead: false, bot: true });
  const bot = (id, cls, role, x, z, players, mobs) => ({ id, cls, role, x, z, t: 10, skill: 5, party: 1, players, mobs, tele: [], sent: [], send(o) { this.sent.push(o); }, names: new Map() });
  const tank = mk(1, 'guardian', 'tank', 0, 5), dps = mk(2, 'swordsman', 'dps', 0, 0), dps2 = mk(4, 'ranger', 'dps', -3, 0), vic = mk(3, 'cleric', 'healer', 4, 0);
  const players = [tank, dps, vic, dps2], P = { all: players, mates: players };
  const view = b => ({ all: players.map(p => (p.id === b.id ? { ...p, x: b.x, z: b.z } : p)) });
  // vines: the closest non-tank bot holds E; the tank keeps the boss
  const vineRow = [[3, 0, 10, 0, 0, 50, 0]], vineMobs = [{ id: 50, type: 'vine', x: 4, z: 0, hp: 50, maxHp: 50, def: MOBS.vine }];
  const b = bot(2, 'swordsman', 'dps', 3, 0, players, vineMobs); readRescue(b, vineRow); b.t += 1;
  assert.equal(rescueTurn(b, view(b)), true, 'the closest dps bot takes the vines');
  assert.ok(b.sent.some(o => o.type === 'free' && o.on === 1 && o.id === 3), 'next to the vines: holds E');
  const b2 = bot(4, 'ranger', 'dps', -3, 0, players, vineMobs); readRescue(b2, vineRow); b2.t += 1;
  assert.equal(rescueTurn(b2, view(b2)), false, 'only one holds E');
  const bt = bot(1, 'guardian', 'tank', 0, 5, players, vineMobs); readRescue(bt, vineRow); bt.t += 1;
  assert.equal(rescueTurn(bt, view(bt)), false, 'the tank keeps the boss');
  // reaction delay: not yet noticed
  const b3 = bot(2, 'swordsman', 'dps', 3, 0, players, vineMobs); b3.skill = 1; readRescue(b3, vineRow);
  assert.equal(rescueTurn(b3, view(b3)), false, 'a low-capability bot reacts late');
  // crystal: everyone but the tank hits it
  const crRow = [[3, 2, 6, 0, 0, 60, 0]], crMobs = [{ id: 60, type: 'stormcrystal', x: 4, z: 0, hp: 90, maxHp: 90, def: MOBS.stormcrystal }];
  for (const [id, cls, role, x, z] of [[2, 'swordsman', 'dps', 0, 0], [4, 'ranger', 'dps', -3, 0]]) {
    const c = bot(id, cls, role, x, z, players, crMobs); readRescue(c, crRow); c.t += 1;
    assert.equal(rescueTarget(c, view(c))?.id, 60, `${cls} breaks the crystal`);
  }
  const ct = bot(1, 'guardian', 'tank', 0, 5, players, crMobs); readRescue(ct, crRow); ct.t += 1;
  assert.equal(rescueTarget(ct, view(ct)), null, 'not the tank');
  // duo: the tank is the only one free -> it helps
  const duo = [mk(1, 'guardian', 'tank', 0, 5), mk(3, 'ranger', 'dps', 4, 0)];
  const cd = bot(1, 'guardian', 'tank', 0, 5, duo, crMobs); readRescue(cd, crRow); cd.t += 1;
  assert.equal(rescueTarget(cd, { all: duo })?.id, 60, 'a tank alone with the victim breaks it');
  void P;
  ok('bots: one holds E on vines, everyone but the tank breaks a crystal (the tank too when alone); capability delays');
}

console.log(`rescue: ${n} checks passed`);
