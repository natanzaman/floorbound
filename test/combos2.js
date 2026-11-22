// Combos 2.0 (docs/briefs/combos-visuals.md B-E): the full combo table, self-combos, bots opening setups (Set me up),
// bot call-outs, and class-flavoured Team Bursts. Usage: node test/combos2.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { angleTo, CLASSES } from '../shared/data.js';
import { COMBO, COMBOS, SETUPS, BURST, BURST_TRAITS, BURST_NAMES, BOT_SETUP, BOT_PAYOFF, BOT_TEAM, hitInfo, payoffFor, setupsOf, canPay, combosOf, setupOfClass, selfScaled, burstFlavor } from '../shared/teamplay.js';
import { setupTurn } from '../shared/bots/teamplay.js';
import { BOT_COMMANDS, parseBotChat } from '../shared/bots/social.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const CLS = Object.keys(CLASSES);

// ---------- the table ----------
{
  for (const cls of CLS) assert.ok(setupOfClass(cls), `${cls} opens a setup`);
  assert.equal(new Set(CLS.map(setupOfClass)).size, CLS.length, 'one setup each');
  // a pair "has a combo" when one opens a setup the other can pay, or one of them is the Bard (Chorus: anyone's Break)
  // or the Cleric (Sanctified Switch: anyone's Switch)
  const pays = (a, b) => combosOf(setupOfClass(a)).some(id => canPay(b, id));
  const missing = [];
  for (let i = 0; i < CLS.length; i++) for (let j = i + 1; j < CLS.length; j++) {
    const a = CLS[i], b = CLS[j];
    if (!(pays(a, b) || pays(b, a) || [a, b].includes('bard') || [a, b].includes('cleric'))) missing.push(`${a}+${b}`);
  }
  assert.deepEqual(missing, [], 'every pair of classes has a combo');
  for (const cls of CLS) assert.ok(Object.keys(COMBOS).some(id => canPay(cls, id)) || cls === 'guardian' && canPay('guardian', 'aftershock'), `${cls} pays something off`);
  ok('every class opens one setup and every pair of classes has at least one combo');
}
{
  assert.deepEqual(setupsOf(hitInfo('swordsman', 'rush')), ['stagger']);
  assert.deepEqual(setupsOf(hitInfo('berserker', 'leap', { heavy: true })), ['grounded']);
  assert.deepEqual(setupsOf(hitInfo('cleric', 'smite', { interrupt: true })), ['judged']);
  assert.deepEqual(setupsOf(hitInfo('cleric', 'smite')), [], 'Smite only judges when it interrupts');
  assert.deepEqual(setupsOf(hitInfo('bard', 'dissonance')), ['offbeat']);
  const at = (k, by = 1) => ({ [k]: { by, at: 10 } });
  assert.equal(payoffFor(at('stagger'), hitInfo('berserker', 'cleave', { heavy: true }), 2, 11)?.id, 'crosscut');
  assert.equal(payoffFor(at('grounded'), hitInfo('guardian', 'gslam', { heavy: true }), 2, 11)?.id, 'aftershock');
  assert.equal(payoffFor(at('judged'), hitInfo('swordsman', 'slash', { heavy: true }), 2, 11)?.id, 'verdict');
  assert.equal(payoffFor(at('judged'), hitInfo('ranger', 'shot', { heavy: true }), 2, 11), null, 'Verdict wants melee');
  assert.equal(payoffFor(at('offbeat'), hitInfo('ranger', 'pierce', { heavy: true }), 2, 11)?.id, 'downbeat');
  assert.equal(payoffFor(at('stun'), hitInfo('lancer', 'lthrust', { heavy: true }), 2, 11)?.id, 'execute', 'a Lancer Thrust finisher executes');
  assert.equal(payoffFor(at('mark'), hitInfo('swordsman', 'rush'), 2, 11)?.id, 'pin', 'a Swordsman Rush pins');
  ok('new setups (Staggered, Grounded, Judged, Off-beat) and payoffs (Cross Cut, Aftershock, Verdict, Downbeat, wider Execute and Pin)');
}
{
  const own = { launch: { by: 1, at: 10 } };
  const p = payoffFor(own, hitInfo('lancer', 'lthrust'), 1, 11);
  assert.equal(p?.id, 'skewer'); assert.equal(p.self, true, 'your own Thrust on your own launch: a self-combo');
  assert.equal(payoffFor(own, hitInfo('lancer', 'lthrust'), 1, 10.01), null, 'not the very hit that opened it');
  assert.equal(payoffFor(own, hitInfo('ranger', 'shot'), 2, 11)?.self, false, 'a partner pays it the normal way');
  const s = selfScaled(COMBOS.skewer);
  assert.ok(Math.abs(s.mult - (1 + (COMBOS.skewer.mult - 1) * COMBO.self)) < 1e-9 && s.frac[0] < COMBOS.skewer.frac[0], 'weaker');
  assert.equal(selfScaled(COMBOS.execute).crit, false, 'a self Execute does not force a crit');
  for (const c of Object.values(COMBOS)) if (c.on === 'hit') assert.ok(c.self?.length, `${c.name} has a self payoff`);
  ok('self-combos: your own setup, your own payoff, at reduced strength; partners first');
}
{
  assert.equal(Object.keys(BURST_NAMES).length, 28, '21 pairs + 7 solo');
  for (const a of CLS) { assert.ok(BURST_NAMES[a], a); for (const b of CLS) if (a !== b) assert.ok(BURST_NAMES[[a, b].sort().join('+')], `${a}+${b}`); }
  assert.deepEqual(burstFlavor(['ranger', 'lancer', 'ranger', 'bard']), { cls: ['ranger', 'lancer', 'bard'], pk: 'lancer+ranger', name: 'Rain of Spears' });
  assert.deepEqual(burstFlavor(['cleric']), { cls: ['cleric'], pk: 'cleric', name: 'Radiant Verdict' });
  for (const cls of CLS) assert.ok(BURST_TRAITS[cls]?.k, `${cls} trait`);
  ok('Team Burst names: every pair and every class alone; flavour = starter first, then the first other class');
}

// ---------- in-process ----------
const g = new Game();
let events = [];
const flush = () => { events.push(...g.events); g.events = []; };
const ev = t => { flush(); return events.filter(e => e.t === t); };
const clear = () => { flush(); events = []; };
const X = 0, Z = 70;
const mk = (name, cls) => { const p = g.addPlayer(null, name, cls); p.x = X; p.z = Z - 2; p.lvl = 10; g.recompute(p); p.hp = p.maxHp; p.crit = 0; return p; };
g.time = 100;
let mob = null;
const freshMob = () => {
  if (mob) g.mobs.delete(mob.id);
  mob = g.addMob('wolf', X, Z + 1);
  mob.face = angleTo(mob.x, mob.z, X, Z - 2);
  mob.maxHp = mob.hp = 1e6; mob.posture = 0; mob.staggerUntil = 0; mob.stunUntil = 0; mob.def = { ...mob.def, posture: 1e9 };
  return mob;
};
const hitBy = (p, base, opts) => { flush(); const k = events.length; g.damageMob(mob, p, base, opts); flush(); return events.slice(k).find(e => e.t === 'hit' && e.by === p.id && e.id === mob.id); };
{ // a solo Lancer: Sky Lance, then its own Thrust: a self Skewer
  const lan = mk('Lan', 'lancer');
  freshMob(); clear();
  hitBy(lan, 50, { sk: 'skylance', heavy: true });
  g.time += 1;
  hitBy(lan, 100, { tsk: 'lthrust' });
  const c = ev('combo');
  assert.equal(c.length, 1); assert.equal(c[0].k, 'skewer'); assert.equal(c[0].self, 1); assert.equal(c[0].by, lan.id); assert.equal(c[0].from, lan.id);
  ok('a solo Lancer pays off its own launch (self Skewer, flagged self)');
}
{ // Swordsman Rush, then a Berserker Cleave: Cross Cut
  const swo = mk('Swo', 'swordsman'), ber = mk('Ber', 'berserker');
  freshMob(); clear();
  hitBy(swo, 50, { sk: 'rush' });
  assert.equal(ev('tsetup').at(-1)?.k, 'stagger');
  g.time += 1;
  const p0 = mob.posture;
  hitBy(ber, 100, { sk: 'cleave', heavy: true });
  assert.equal(ev('combo').at(-1)?.k, 'crosscut');
  assert.ok(mob.posture > p0);
  ok('Swordsman Rush -> Berserker Cleave: Cross Cut');
}
{ // Team Burst flavour: a Guardian + Cleric party fires Sanctum Wall: shields and heals the team
  const gua = mk('Gua', 'guardian'), cle = mk('Cle', 'cleric');
  const party = { id: g.id(), members: [gua.id, cle.id] }; g.parties.set(party.id, party); gua.party = cle.party = party.id;
  freshMob(); clear();
  cle.hp = Math.round(cle.maxHp * 0.5); const hp0 = cle.hp;
  const s = g.tbState(party.id); s.g = BURST.max;
  g.teamBurst(gua, mob.id); g.teamBurst(cle, mob.id);
  const b = ev('tburst').at(-1);
  assert.ok(b); assert.deepEqual(b.cls, ['guardian', 'cleric']); assert.equal(b.pk, 'cleric+guardian'); assert.equal(b.nm, 'Sanctum Wall');
  assert.ok(gua.shield?.hp > 0 && cle.shield?.hp > 0, 'aegis: a shield on the team');
  assert.ok(cle.hp > hp0, 'radiance: the team is healed');
  ok('class-flavoured Team Burst: the pair name, the traits (shield, heal)');
}
{ // Bard resonance: cooldowns back; Lancer impale roots
  const bar = mk('Bar', 'bard'), lan2 = mk('Lan2', 'lancer');
  const party = { id: g.id(), members: [bar.id, lan2.id] }; g.parties.set(party.id, party); bar.party = lan2.party = party.id;
  freshMob(); clear();
  lan2.cds[1] = g.time + 8;
  g.tbState(party.id).g = BURST.max;
  g.teamBurst(lan2, mob.id); g.teamBurst(bar, mob.id);
  assert.equal(ev('tburst').at(-1)?.nm, 'Spear Waltz');
  assert.ok(lan2.cds[1] < g.time + 8 - 1, 'resonance: cooldowns back');
  assert.ok(mob.stunUntil > g.time, 'impale: rooted');
  ok('Bard resonance gives cooldowns back; Lancer impale roots the target');
}
{ // tcall: bots only, throttled
  const human = mk('Hum', 'lancer'), bot = mk('Bot', 'lancer'); bot.bot = true;
  clear();
  g.handle(human, { type: 'tcall', k: 'launch' });
  assert.equal(ev('tcall').length, 0, 'players cannot shout as bots');
  g.handle(bot, { type: 'tcall', k: 'launch' }); g.handle(bot, { type: 'tcall', k: 'launch' });
  const c = ev('tcall');
  assert.equal(c.length, 1, 'throttled'); assert.equal(c[0].text, SETUPS.launch.call); assert.equal(c[0].id, bot.id);
  g.handle(bot, { type: 'tcall', k: 'nonsense' });
  assert.equal(ev('tcall').length, 1);
  ok('bot call-outs: bots only, a known setup, throttled');
}

// ---------- bots ----------
{
  assert.ok(BOT_COMMANDS.setme && parseBotChat('/b setme').cmd === 'setme' && parseBotChat('/b setup').cmd === 'setme');
  for (const [cls, S] of Object.entries(BOT_SETUP)) assert.ok(SETUPS[S.k].hit.some(r => r.cls === cls), `${cls}'s setup skill opens its own setup`);
  for (const [cls, row] of Object.entries(BOT_PAYOFF)) for (const k of Object.keys(row)) assert.ok(combosOf(k).some(id => canPay(cls, id)), `${cls} pays ${k}`);
  const sent = [], used = [];
  const mate = { id: 2, cls: 'ranger', x: 0, z: 10, dead: false };
  const b = { id: 1, cls: 'lancer', skill: 5, t: 10, x: 0, z: 0, face: 0, cds: [0, 0, 0, 0], send: m => sent.push(m) };
  const tgt = { id: 9, x: 0, z: 2, def: { radius: 0.6 } };
  const ctx = { dodge: null, party: { mates: [mate] }, useSkill: (bb, slot) => { used.push(slot); return true; } };
  const orig = BOT_TEAM.setup; BOT_TEAM.setup = [0, 1, 1, 1, 1, 1];
  try {
    assert.equal(setupTurn(b, tgt, ctx), true); assert.deepEqual(used, [BOT_SETUP.lancer.slot], 'a Lancer bot Sweeps for its Ranger');
    assert.equal(sent.at(-1)?.type, 'tcall'); assert.equal(sent.at(-1).k, 'launch');
    BOT_TEAM.setup = [0, 0, 0, 0, 0, 0];
    b.t = 20; b.setupRoll = null;
    assert.equal(setupTurn(b, tgt, ctx), false, 'unordered: capability roll');
    b.setFor = { id: 2, until: 60 }; // Set me up
    assert.equal(setupTurn(b, tgt, ctx), true, 'ordered: always');
    mate.cls = 'guardian'; b.t = 21;
    assert.equal(setupTurn(b, tgt, ctx), false, 'nothing to open for a class that cannot pay it');
  } finally { BOT_TEAM.setup = orig; }
  ok('bots open their setup for a partner who can pay it, call it out, and always do so under Set me up');
}
console.log(`combos2: ${n} checks passed`);
process.exit(0);
