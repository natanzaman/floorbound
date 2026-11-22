// Skill mastery and evolutions. Shared by the server (gains, rules) and the client (Skills panel, names, cooldowns).
//
// Each class skill in slots 1-3 (not the basic attack) has its own MASTERY level 1-5, earned by USING IT WELL:
// damage and posture it deals, Breaks and Switches it sets up or lands, damage it prevents, healing it does
// (overheal doesn't count) and the extra damage allies deal while it buffs them. Whiffs give nothing.
// Mastery 2: -10% cooldown. Mastery 3: the skill EVOLVES into one of two branches (pick anywhere the first time,
// re-pick for free at a Skill Shrine in town). Mastery 4: +10% effect.
import { CLASSES } from './data.js';
import { LANCER_BRANCHES } from './classes/lancer.js';
import { BARD_BRANCHES } from './classes/bard.js';
import { RANGER_BRANCHES } from './classes/ranger.js';
import { BERSERKER_BRANCHES } from './classes/berserker.js';
import { SIG_EVOS, sigIdsOf } from './subclasses.js';

export const MASTERY = {
  max: 5,
  evolveAt: 3,
  // Cumulative points to REACH each level (index = level). One point ~ one "attack's worth" of value:
  // the amount divided by the user's attack power, so the pace doesn't change with level or gear.
  // Measured with the bot party from level 1 (test/team.js, MASTERY_LOG=60), which fights non-stop and uses skills on
  // cooldown: Ground Slam ~26 pts/min, Heal and Blessing ~17, Burst Combo ~15. With the downtime of normal play a skill
  // you use often reaches Mastery 3 (600) after roughly 30-45 min, Mastery 5 (4000) after a few hours.
  need: [0, 0, 150, 600, 1800, 4000],
  cd2: 0.9,  // Mastery 2+: cooldown x0.9
  pow4: 1.1, // Mastery 4+: damage, healing, shields and buffs x1.1
  // Points per "attack unit" (amount / the user's attack) for each kind of effective use.
  w: { dmg: 1, posture: 0.2, heal: 0.9, prevent: 1, buff: 1.2 },
  brk: [1, 3],  // flat points: the skill caused a Break (normal / elite, boss)
  setup: 1.5,   // a teammate landed a Switch on an enemy this skill broke
  sw: 1.5,      // the skill itself landed a Switch
  shrineUse: 3.4, // how close to a Skill Shrine you need to stand to re-pick
};

// Skill Shrines: one in each town (Town of Beginnings; Floor 2's Mirelight Camp). F to open the Skills panel; re-pick there.
export const SHRINES = [
  { floor: 1, x: -9, z: -6, name: 'Skill Shrine' },
  { floor: 2, x: 591, z: 2, name: 'Skill Shrine' },
  { floor: 3, x: 1191, z: 2, name: 'Skill Shrine' }, // Windbreak Camp
];
export const nearShrine = (x, z, pad = 0) => SHRINES.find(s => Math.hypot(x - s.x, z - s.z) < MASTERY.shrineUse + pad) || null;

// The two evolutions of every skill. coop: leans into Break -> Switch / helping the party. cd: cooldown multiplier.
export const BRANCHES = {
  // Swordsman
  rush: {
    A: { id: 'phantom', name: 'Phantom Rush', desc: 'Dash through enemies; an afterimage strikes the same path again about half a second later.' },
    B: { id: 'shoulder', name: 'Shoulder Charge', desc: 'Stop on the first enemy and slam it: heavy posture damage and a short stun. Sets up a Switch.', coop: 1 },
  },
  whirl: {
    A: { id: 'vortex', name: 'Vortex', desc: 'Pull enemies within 7 m in, then spin. Gathers a pack for your party.', coop: 1 },
    B: { id: 'bladering', name: 'Blade Ring', desc: 'A smaller ring of blades that spins with you for about 2 s while you keep moving.' },
  },
  burst: {
    A: { id: 'starburst', name: 'Starburst', desc: '6 hits and more total damage, but no Break posture.' },
    B: { id: 'finisher', name: 'Finisher', desc: '2 hits. On an enemy above 50% health the second fills its posture: instant BREAK for a Switch.', coop: 1 },
  },
  // Guardian
  taunt: {
    A: { id: 'challenge', name: 'Challenge', desc: 'Taunt one enemy: for 5 s it deals 30% less damage to everyone but you.', coop: 1 },
    B: { id: 'warcry', name: 'War Cry', desc: 'Wider taunt that drags enemies in; allies nearby deal 10% more damage for 6 s.', coop: 1 },
  },
  wall: {
    A: { id: 'bulwark', name: 'Bulwark', desc: 'Stand still: hits from the front are cut by 80%, and allies behind you take 60% less from them. Moving ends it.', coop: 1 },
    B: { id: 'ironskin', name: 'Iron Skin', desc: 'Move freely: 35% less damage for 6 s, and 30% of every hit is reflected back.' },
  },
  gslam: {
    A: { id: 'quake', name: 'Quake', desc: 'A bigger slam (7 m) that launches enemies into the air and stuns them longer.' },
    B: { id: 'seismic', name: 'Seismic Line', desc: 'A shockwave that travels 12 m forward, breaking and stunning everything in its path.', coop: 1 },
  },
  // Cleric
  heal: {
    A: { id: 'renew', name: 'Renew', desc: 'A smaller heal over 6 s, on the two most hurt allies at once.' },
    B: { id: 'miracle', name: 'Miracle', desc: 'A big heal that also purifies: immune to lingering ground hazards for 4 s. Longer cooldown.', cd: 2.5 },
  },
  bless: {
    A: { id: 'zeal', name: 'Zeal', desc: 'Allies deal 15% more damage and their skill cooldowns run 25% faster for 8 s.', coop: 1 },
    B: { id: 'aegis', name: 'Aegis', desc: 'Every ally nearby gets a shield that absorbs 25% of their health for 8 s, instead of a damage buff.' },
  },
  sanct: {
    A: { id: 'haven', name: 'Haven', desc: 'Allies inside take 25% less damage (a smaller heal).' },
    B: { id: 'consecrate', name: 'Consecrate', desc: 'Burns enemies inside and fills their posture so allies can Switch. No healing.', coop: 1 },
  },
};
Object.assign(BRANCHES, LANCER_BRANCHES, BARD_BRANCHES); // Lancer, Bard (shared/classes/)

Object.assign(BRANCHES, RANGER_BRANCHES, BERSERKER_BRANCHES); // Ranger and Berserker (shared/classes/)

Object.assign(BRANCHES, SIG_EVOS); // the signature skills' two forms (shared/subclasses.js; `sig: 1` on each form)
export const isSigForm = skId => !!BRANCHES[skId]?.A?.sig;

// The skills with a mastery record: slots 1-3, then the signature skill of each of the class's subclasses.
export const masterySkills = cls => [...(CLASSES[cls]?.skills || []).slice(1).map(s => s.id), ...sigIdsOf(cls)];

// Sanitise a saved mastery record for a class: { [skillId]: { pts, br } }.
export function newMastery(raw, cls, startLevel = 0) {
  const out = {};
  const floor = MASTERY.need[Math.max(0, Math.min(MASTERY.max, startLevel | 0))] || 0;
  for (const id of masterySkills(cls)) {
    const r = raw?.[id] || {};
    const pts = Math.max(floor, Number.isFinite(+r.pts) ? Math.max(0, +r.pts) : 0);
    out[id] = { pts: Math.round(pts * 100) / 100, br: r.br === 'A' || r.br === 'B' ? r.br : null };
  }
  return out;
}

export function masteryLevel(pts) {
  let l = 1;
  while (l < MASTERY.max && pts >= MASTERY.need[l + 1]) l++;
  return l;
}
// [level, points into this level, points this level needs] (span 0 at max)
export function masteryProgress(pts) {
  const l = masteryLevel(pts);
  if (l >= MASTERY.max) return [l, 0, 0];
  return [l, pts - MASTERY.need[l], MASTERY.need[l + 1] - MASTERY.need[l]];
}

// The active branch ('A' / 'B') of a skill, or null (not chosen, or below Mastery 3).
export function activeBranch(entry) {
  if (!entry?.br || masteryLevel(entry.pts) < MASTERY.evolveAt) return null;
  return entry.br;
}
export const branchDef = (skId, br) => (br ? BRANCHES[skId]?.[br] || null : null);

// Name shown on the skill bar: the evolved name once a branch is active.
export function skillName(sk, entry) {
  const b = branchDef(sk.id, activeBranch(entry));
  return b ? b.name : sk.name;
}
export function skillDesc(sk, entry) {
  const b = branchDef(sk.id, activeBranch(entry));
  return b ? b.desc : sk.desc;
}

// Base cooldown after mastery and branch (before gear haste and buffs).
export function masteryCd(sk, entry) {
  if (!entry) return sk.cd;
  const l = masteryLevel(entry.pts);
  return sk.cd * (l >= 2 ? MASTERY.cd2 : 1) * (branchDef(sk.id, activeBranch(entry))?.cd || 1);
}
export const masteryPow = entry => (entry && masteryLevel(entry.pts) >= 4 ? MASTERY.pow4 : 1);


// ---------- awakenings (Mastery 5; docs/briefs/path.md, Phase 3) ----------
// At Mastery 5 the chosen form gains one more rule (shared/effects.js; server/effects.js runs it): 'cast' fires once
// per use, 'hit' on that skill's hits (most have an icd so a multi-hit skill can't chain them), 'heal' on its heals.
const W = (on, d, o = {}) => ({ on, do: d, ...o });
export const AWAKEN = {
  // Swordsman
  rush: { A: W('hit', 'mark', { v: 0.12, d: 4, icd: 1 }), B: W('hit', 'stun', { d: 0.6, icd: 1 }) },
  whirl: { A: W('cast', 'pull', { r: 9, v: 2 }), B: W('hit', 'slow', { v: 0.3, d: 2 }) },
  burst: { A: W('hit', 'burn', { v: 0.15, d: 3, icd: 2 }), B: W('break', 'team', { v: 0.1, r: 12, d: 5 }) },
  // Guardian
  taunt: { A: W('cast', 'dr', { v: 0.2, d: 5 }), B: W('cast', 'team', { v: 0.06, r: 12, d: 6 }) },
  wall: { A: W('cast', 'shield', { v: 0.08, r: 8, d: 6 }), B: W('cast', 'heal', { v: 0.1, r: 0 }) },
  gslam: { A: W('hit', 'posture', { frac: [0.1, 0.03] }), B: W('hit', 'slow', { v: 0.35, d: 3 }) },
  // Cleric
  heal: { A: W('heal', 'shield', { v: 0.06, r: 0, to: 't', d: 6, icd: 2 }), B: W('cast', 'cdcut', { v: 2 }) },
  bless: { A: W('cast', 'cdcut', { v: 1.5 }), B: W('cast', 'heal', { v: 0.06, r: 12 }) },
  sanct: { A: W('cast', 'dr', { v: 0.15, d: 6 }), B: W('hit', 'mark', { v: 0.1, d: 3, icd: 1 }) },
  // Lancer
  lcharge: { A: W('hit', 'burst', { mult: 0.6, r: 3, icd: 1 }), B: W('cast', 'dr', { v: 0.2, d: 3 }) },
  lsweep: { A: W('cast', 'pull', { r: 7, v: 1.5 }), B: W('hit', 'mark', { v: 0.1, d: 4, icd: 0.5 }) },
  skylance: { A: W('hit', 'posture', { frac: [0.12, 0.04], icd: 1 }), B: W('hit', 'stun', { d: 0.8, icd: 1 }) },
  // Bard
  anthem: { A: W('cast', 'team', { v: 0.05, r: 14, d: 8 }), B: W('cast', 'heal', { v: 0.05, r: 14 }) },
  dissonance: { A: W('hit', 'posture', { frac: [0.08, 0.03], icd: 0.5 }), B: W('hit', 'slow', { v: 0.3, d: 3 }) },
  crescendo: { A: W('hit', 'burst', { mult: 0.8, r: 3.5, icd: 1 }), B: W('cast', 'cdcut', { v: 2 }) },
  // Ranger
  pierce: { A: W('hit', 'burn', { v: 0.1, d: 3, icd: 0.5 }), B: W('crit', 'cdcut', { v: 1.5, icd: 2, text: 'Its critical hits' }) },
  disengage: { A: W('hit', 'stun', { d: 0.8, icd: 1 }), B: W('cast', 'dr', { v: 0.25, d: 2 }) },
  mark: { A: W('cast', 'team', { v: 0.06, r: 12, d: 6 }), B: W('hit', 'mark', { v: 0.08, d: 6 }) },
  // Berserker
  cleave: { A: W('hit', 'slow', { v: 0.25, d: 2 }), B: W('kill', 'rage', { v: 15, text: 'Each kill it lands' }) },
  leap: { A: W('hit', 'stun', { d: 0.5, icd: 0.5 }), B: W('hit', 'heal', { v: 0.04, r: 0, icd: 1 }) },
  bloodrage: { A: W('cast', 'cdcut', { v: 2 }), B: W('cast', 'heal', { v: 0.05, r: 12 }) },
  // Signature skills
  flashstep: { A: W('hit', 'mark', { v: 0.1, d: 4, icd: 1 }), B: W('cast', 'cdcut', { v: 2 }) },
  rallycut: { A: W('break', 'team', { v: 0.08, r: 12, d: 5, text: 'A Break it causes' }), B: W('cast', 'shield', { v: 0.06, r: 16, d: 6 }) },
  aegisline: { A: W('cast', 'heal', { v: 0.1, r: 0 }), B: W('cast', 'heal', { v: 0.06, r: 14 }) },
  conqroar: { A: W('hit', 'mark', { v: 0.1, d: 5 }), B: W('cast', 'shield', { v: 0.1, r: 0, d: 6 }) },
  dawnburst: { A: W('cast', 'shield', { v: 0.08, r: 12, d: 6 }), B: W('cast', 'team', { v: 0.06, r: 18, d: 6 }) },
  judgeray: { A: W('hit', 'burn', { v: 0.2, d: 3 }), B: W('hit', 'slow', { v: 0.3, d: 3 }) },
  deadeye: { A: W('crit', 'burst', { mult: 1.2, r: 3, text: 'Its critical hits' }), B: W('hit', 'mark', { v: 0.12, d: 4 }) },
  snarefield: { A: W('hit', 'burn', { v: 0.12, d: 3 }), B: W('cast', 'pull', { r: 8, v: 2 }) },
  rampage: { A: W('cast', 'dr', { v: 0.2, d: 3 }), B: W('kill', 'cdcut', { v: 3, icd: 4, text: 'A kill it lands' }) },
  crimsonpact: { A: W('cast', 'shield', { v: 0.08, r: 0, d: 6 }), B: W('hit', 'burn', { v: 0.2, d: 3, icd: 0.5 }) },
  wyverndive: { A: W('hit', 'burn', { v: 0.15, d: 3 }), B: W('cast', 'dr', { v: 0.25, d: 2 }) },
  spearwall: { A: W('cast', 'heal', { v: 0.06, r: 8 }), B: W('hit', 'mark', { v: 0.1, d: 4 }) },
  encore: { A: W('cast', 'shield', { v: 0.06, r: 14, d: 6 }), B: W('cast', 'heal', { v: 0.06, r: 14 }) },
  sirenwail: { A: W('hit', 'mark', { v: 0.1, d: 4 }), B: W('hit', 'posture', { frac: [0.08, 0.03] }) },
};
// The awakening of a skill's active form, once it reaches Mastery 5 (null otherwise).
export function awakening(skId, entry) {
  const br = activeBranch(entry);
  return br && masteryLevel(entry.pts) >= MASTERY.max ? AWAKEN[skId]?.[br] || null : null;
}

// Short list of the automatic upgrades a level grants (for the panel).
export const UPGRADES = [
  [2, '-10% cooldown'],
  [3, 'Evolves: choose a branch'],
  [4, '+10% effect'],
  [5, 'Mastered'],
];
