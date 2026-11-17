// The Lancer: spear-and-reach frontline damage. Class data, tuning and evolutions, shared by server and client.
// Appended to CLASSES / CLASS_IDS in shared/data.js, BRANCHES in shared/mastery.js, WEAPON_NAMES in shared/items.js.
// Server side: server/classes-b.js. Client visuals: public/classes-b.js.

export const LANCER = {
  name: 'Lancer', role: 'Damage', hp: 105, atk: 11.5, color: 0x14b8a6,
  blurb: 'Spear and reach. Thrusts from range, charges through lines, leaps in to set up Switches.',
  skills: [
    { id: 'lthrust', name: 'Thrust', cd: 0.6, lvl: 1, desc: '3-hit spear combo along a long, narrow line; the third thrust reaches further and hits harder. Hits near the tip of your reach deal 30% more.' },
    { id: 'lcharge', name: 'Lance Charge', cd: 7, lvl: 1, desc: 'Dash up to 9 m along a line, striking everything in it. Stops short of walls and trees.' },
    { id: 'lsweep', name: 'Sweep', cd: 9, lvl: 1, desc: 'A low sweep around you that trips every enemy in 4.5 m: a short stagger and posture damage.' },
    { id: 'skylance', name: 'Sky Lance', cd: 14, lvl: 3, desc: 'Leap up and crash down on a spot up to 10 m away (marked for your allies): heavy posture damage to BREAK enemies and open a Switch. You are airborne while you fly.', brk: true },
  ],
};

// Numbers (damage multipliers are x attack power).
export const LANCE = {
  reach: 4.6, finReach: 5.4, width: 0.75, mult: 1.05, finMult: 1.6, // basic thrusts: a line in front of you
  sweetFrom: 2.4, sweetMult: 1.3,   // passive: an enemy whose near edge is 2.4 m+ away (near the spear tip) takes +30%
  charge: { len: 9, width: 1.5, mult: 1.5, knock: 1.0 },
  sweep: { r: 4.5, mult: 1.1, stun: 0.8, frac: [0.18, 0.05] },
  sky: { range: 10, fwd: 7, air: 0.7, r: 3.5, mult: 2.0, stun: 1.0 },
  // evolutions
  comet: { len: 13, r: 3.5, mult: 1.35, waveMult: 0.9, frac: [0.2, 0.07] },
  hitrun: { len: 6, back: 0.35, mult: 1.9 },
  cyclone: { r: 5.5, mult: 0.85, spins: 2, gap: 0.3 },
  hamstring: { r: 5, half: Math.PI / 2, mult: 1.0, stun: 1.6, slow: 0.5, slowFor: 4, frac: [0.3, 0.08] },
  meteor: { r: 5.5, mult: 2.3, stun: 0.6 },
  pin: { r: 1.8, mult: 2.4, frac: [1, 0.35], root: 3 },
};

export const LANCER_BRANCHES = {
  lcharge: {
    A: { id: 'comet', name: 'Comet Charge', desc: 'A longer charge (13 m) that ends in a shockwave: posture damage to everything around where you stop.', coop: 1 },
    B: { id: 'hitrun', name: 'Hit & Run', desc: 'A shorter, harder charge (6 m); a moment later you spring back to where you started.' },
  },
  lsweep: {
    A: { id: 'cyclone', name: 'Cyclone Sweep', desc: 'Two wide spins (5.5 m) for more damage, but no stagger.' },
    B: { id: 'hamstring', name: 'Hamstring', desc: 'A half-circle sweep in front: knocks enemies down for longer, slows them by 50% for 4 s and fills more posture.', coop: 1 },
  },
  skylance: {
    A: { id: 'meteor', name: 'Meteor Lance', desc: 'A wider crash (5.5 m) that deals more damage to everything, but no Break posture.' },
    B: { id: 'pinning', name: 'Pinning Lance', desc: 'Land on the enemy nearest the spot and pin it: a normal enemy is instantly BROKEN and rooted, a boss takes a huge posture chunk.', coop: 1 },
  },
};

export const LANCER_WEAPONS = ['Ash Spear', 'Tempered Pike', 'Galeglass Lance', 'Skyreaver'];
