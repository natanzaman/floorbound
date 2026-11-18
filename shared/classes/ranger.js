// Ranger: ranged damage with a bow. Class data, tuning and evolution branches.
// Appended to CLASSES / CLASS_IDS by shared/data.js and to BRANCHES by shared/mastery.js; server side in
// server/classes-a.js, client visuals in public/classes-a.js, bot brain in shared/classes/bots-a.js.
// (No imports here, so data.js can pull this in without a cycle.)

export const RANGER = {
  name: 'Ranger', role: 'Damage', tag: 'dps', hp: 82, atk: 11.5, color: 0x14b8a6,
  blurb: 'Bow and arrows from range. Marks prey for the party, but fragile and weak up close.',
  skills: [
    { id: 'shot', name: 'Shot', cd: 0.6, lvl: 1, desc: 'Fire an arrow at your target (or straight ahead); it hits the first enemy in its way. Every third arrow hits harder. Weak at point-blank range.' },
    { id: 'pierce', name: 'Piercing Shot', cd: 7, lvl: 1, desc: 'Draw for half a second, then loose an arrow that pierces every enemy in a line, with heavy posture damage.' },
    { id: 'disengage', name: 'Disengage', cd: 9, lvl: 1, desc: 'Leap 7 m backwards and fire, leaving caltrops that slow enemies by 50% for 5 s.' },
    { id: 'mark', name: "Hunter's Mark", cd: 16, lvl: 3, desc: 'Mark an enemy for 10 s: your whole party deals 15% more damage to it, and Switches on it hit 30% harder.' },
  ],
};

// Use times here (draws, rain delay / spacing) are base values: the server applies x PACE (shared/data.js paced()) where it
// uses them (server/classes-a.js), since this file can't import data.js.
export const RANGER_TUNE = {
  // Arrows are real projectiles: they fly at `speed` m/s, steer gently toward the target picked when fired
  // (`homing` rad/s), and hit the first enemy in their path. Point-blank: x`close[2]` within close[0] m, full damage from close[1] m.
  arrow: { speed: 38, range: 24, cone: 0.4, radius: 0.35, homing: 6, mult: [1, 1, 1.5], close: [3, 7, 0.6], combo: 1.4 },
  pierce: { draw: 0.45, speed: 60, range: 26, radius: 0.7, mult: 1.9, frac: [0.3, 0.1] },
  disengage: { dist: 7, mult: 1.2, trap: { r: 3, dur: 5, slow: 0.5, bossSlow: 0.75, tick: 0.5, dmg: 0.12 } },
  mark: { dur: 10, range: 28, bonus: 0.15, sw: 1.3 },
  // evolutions
  rain: { range: 18, ahead: 12, r: 4.5, delay: 0.6, ticks: 5, every: 0.3, mult: 0.45, frac: [0.05, 0.015] },
  sniper: { draw: 1.1, speed: 70, range: 32, mult: 4.2, frac: [0.65, 0.22] },
  snare: { hop: 4, r: 2.4, arm: 0.4, dur: 8, root: 2.5, max: 3, mult: 0.8, frac: [0.3, 0.1] },
  tumble: { dist: 9, n: 3, spread: 0.2, mult: 0.9 },
  pack: { n: 3, r: 9, dur: 8, bonus: 0.1, sw: 1.2 },
  deadeye: { dur: 6, self: 0.2 },
};

export const RANGER_BRANCHES = {
  pierce: {
    A: { id: 'rainofarrows', name: 'Rain of Arrows', desc: 'Loose a volley into the air: arrows rain on an area 4.5 m wide for about 2 s, chipping posture on everything inside.', coop: 1 },
    B: { id: 'snipershot', name: 'Sniper Shot', desc: 'A long 1.4 s draw, then one huge arrow (no pierce) with massive posture damage. Longer cooldown.', cd: 1.3 },
  },
  disengage: {
    A: { id: 'snaretrap', name: 'Snare Trap', desc: 'Hop back 4 m and leave a snare: the first enemies to step in are rooted for 2.5 s and lose posture. Sets up a Switch.', coop: 1 },
    B: { id: 'tumblevolley', name: 'Tumble Volley', desc: 'Leap 9 m backwards and fire a fan of 3 arrows. No caltrops.' },
  },
  mark: {
    A: { id: 'packhunter', name: 'Pack Hunter', desc: 'The mark spreads to up to 3 enemies close together: +10% party damage and stronger Switches on each, for 8 s.', coop: 1 },
    B: { id: 'deadeye', name: 'Deadeye', desc: 'A personal mark for 6 s: your own arrows on it always crit and deal 20% more. No party bonus.' },
  },
};

export const RANGER_WEAPONS = ['Hunting Bow', 'Ashwood Longbow', 'Galeshot Bow', 'Skyreaver'];
export const RANGER_CRAFT = 'Longbow'; // recipe names: "Tuskbreaker Longbow", "Warden-Forged Longbow"
