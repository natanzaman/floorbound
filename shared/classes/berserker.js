// Berserker: two-handed axe brawler fuelled by Rage. Class data, tuning and evolution branches.
// Appended to CLASSES / CLASS_IDS by shared/data.js and to BRANCHES by shared/mastery.js; server side in
// server/classes-a.js, client visuals in public/classes-a.js, bot brain in shared/classes/bots-a.js.

export const BERSERKER = {
  name: 'Berserker', role: 'Damage', tag: 'dps', hp: 125, atk: 11, color: 0xdc2626,
  blurb: 'Two-handed axe. Builds Rage from every blow dealt and taken. No guard, thin armour.',
  skills: [
    { id: 'chop', name: 'Axe Chop', cd: 0.85, lvl: 1, desc: 'Slow, heavy 3-hit axe combo with big posture damage; the third swing knocks back. Builds Rage.' },
    { id: 'cleave', name: 'Cleave', cd: 6, lvl: 1, desc: 'A wide axe sweep in front of you. Deals up to double damage at full Rage.' },
    { id: 'leap', name: 'Leap Slam', cd: 10, lvl: 1, desc: 'Leap onto your target (up to 10 m) and slam down: damage, a stagger and posture damage in a 3.5 m ring. Airborne while you leap.' },
    { id: 'bloodrage', name: 'Bloodrage', cd: 20, lvl: 3, desc: 'Spend all your Rage (20+) and 10% of your health: for 3-8 s (more Rage, longer) heal for 25% of the damage you deal, attack 40% faster, and your hits cut through enemy wind-ups.' },
  ],
};

// Rage: 0-100. Dealing damage builds `hit` per attack's worth of damage (at most `hitCap` per hit); taking damage builds
// `hurt` x the fraction of max health lost. After `decayAfter` s out of combat it drains `decay` per second.
export const RAGE = { max: 100, hit: 4.5, hitCap: 10, hurt: 120, decayAfter: 4, decay: 12 };

export const BERSERKER_TUNE = {
  taken: 1.1, // thin armour: takes 10% more damage from every non-perilous hit
  chop: { r: 3.4, half: 1.1, mult: [1.35, 1.35, 2.2], combo: 1.3, fin: { knock: 2.5, frac: [0.12, 0.04] } },
  cleave: { r: 4.2, half: 1.6, mult: 1.3, rage: 1.3 },        // x(mult + rage * rage/100)
  leap: { range: 10, ahead: 8, delay: 0.55, r: 3.5, mult: 1.7, stun: 0.9, frac: [0.3, 0.1] },
  bloodrage: { min: 20, hp: 0.1, dur: [3, 8], ls: 0.25, haste: 0.6 }, // haste: basic attack cooldown x0.6
  // evolutions
  whirlaxe: { r: 4.5, hits: 2, gap: 0.35, mult: 0.85, rage: 0.6 },
  executioner: { r: 4, half: 0.6, mult: 1.4, rage: 1.4, low: 0.35, lowMult: 2, cost: 30 },
  earthshatter: { delay: 0.8, r: 5.5, mult: 1.5, stun: 1.3 },
  pounce: { range: 12, mult: 2.4, rage: 20, frac: [0.2, 0.06] },
  frenzy: { dur: 6, hp: 0.15, haste: 0.5 },
  warblood: { min: 20, heal: 0.006, r: 10, dur: 6, ls: 0.12 }, // heal: max health per Rage point spent
};

export const BERSERKER_BRANCHES = {
  cleave: {
    A: { id: 'whirlingaxe', name: 'Whirling Axe', desc: 'Spin with the axe out: two full 360° sweeps around you. Scales less with Rage.' },
    B: { id: 'executioner', name: 'Executioner', desc: 'A narrow, crushing chop that spends 30 Rage: double damage to enemies under 35% health.' },
  },
  leap: {
    A: { id: 'earthshatter', name: 'Earthshatter', desc: 'A higher leap and a bigger landing (5.5 m) that BREAKS posture and stuns longer. Sets up a Switch.', coop: 1 },
    B: { id: 'pounce', name: 'Pounce', desc: 'No wind-up: pounce straight onto your target (12 m) for a heavy single hit and +20 Rage. Shorter cooldown.', cd: 0.7 },
  },
  bloodrage: {
    A: { id: 'frenzy', name: 'Frenzy', desc: 'Keep your Rage: 6 s of attacks twice as fast, for 15% of your health. No lifesteal.' },
    B: { id: 'warblood', name: 'Warblood', desc: 'Spend all your Rage (20+) to heal yourself (0.6% health per point), and allies within 10 m heal for 12% of their damage for 6 s.', coop: 1 },
  },
};

export const BERSERKER_WEAPONS = ['Woodcutter Axe', 'Bearded Greataxe', 'Ravager', 'Worldsplitter'];
export const BERSERKER_CRAFT = 'Greataxe'; // recipe names: "Tuskbreaker Greataxe", "Warden-Forged Greataxe"
