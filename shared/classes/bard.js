// The Battle Bard: ranged support. Songs that speed the party up, chords that slow and interrupt enemies,
// and Discord: every sonic bolt leaves a stack that makes the enemy take more posture damage, which Crescendo
// cashes in for a BREAK (a co-op Switch set-up). Class data, tuning and evolutions, shared by server and client.
// Server side: server/classes-b.js. Client visuals: public/classes-b.js.

export const BARD = {
  name: 'Bard', role: 'Support', hp: 90, atk: 9.5, color: 0xa855f7,
  blurb: 'Battle songs: speeds up the party, slows and interrupts enemies, sets up Breaks with Discord.',
  skills: [
    { id: 'sonic', name: 'Sonic Bolt', cd: 0.7, lvl: 1, desc: 'A short-range bolt of sound (11 m). Each hit adds a Discord stack (up to 5, 6 s): the enemy takes 10% more posture damage per stack.' },
    { id: 'anthem', name: 'Anthem', cd: 18, lvl: 1, desc: 'Play for 8 s: you and allies within 12 m of you move 20% faster and attack 20% faster (other skills recharge 15% faster).' },
    { id: 'dissonance', name: 'Dissonance', cd: 10, lvl: 1, desc: 'A harsh chord in a 7 m cone: slows enemies by 40% for 4 s and INTERRUPTS wind-ups (big posture damage to anything mid-attack). Adds a Discord stack.' },
    { id: 'crescendo', name: 'Crescendo', cd: 22, lvl: 3, desc: 'A song that builds for 3 s, then bursts: allies within 12 m get a shield (20% health) and +15% damage for 6 s; enemies within 8 m with 3+ Discord stacks (5 for a boss) are BROKEN.', brk: true },
  ],
};

// Numbers (damage multipliers are x attack power).
export const SONG = {
  bolt: { speed: 24, range: 11, radius: 0.55, mult: 0.95 },
  discord: { max: 5, dur: 6, posture: 0.1 },                 // +10% posture gain per stack
  anthem: { r: 12, dur: 8, speed: 0.2, haste: 0.2, skillHaste: 0.15, tick: 0.5, credit: 0.15 },
  dissonance: { r: 7, half: 0.7, mult: 0.9, slow: 0.4, slowFor: 4 },
  crescendo: { build: 3, r: 12, er: 8, shield: 0.2, dmg: 0.15, dur: 6, mult: 1.2, need: [3, 5], frac: [0.08, 0.03] },
  // evolutions
  warmarch: { dmg: 0.12 },
  lullaby: { r: 10, slow: 0.35, every: 2 },
  shatter: { r: 10, half: 0.38, mult: 1.1, stacks: 2 },
  feedback: { r: 5, mult: 0.8, knock: 2.5, slow: 0.4, slowFor: 3 },
  finale: { build: 1.5, er: 10, mult: 1.8, need: [3, 4] },
  encore: { build: 3, shield: 0.3, dmg: 0.2, dur: 10, heal: 0.15 },
};

export const BARD_BRANCHES = {
  anthem: {
    A: { id: 'warmarch', name: 'War March', desc: 'A marching song: allies near you deal 12% more damage for 8 s instead of moving and attacking faster.', coop: 1 },
    B: { id: 'lullaby', name: 'Lullaby', desc: 'A drowsy song: enemies within 10 m of you move 35% slower for 8 s and gain a Discord stack every 2 s. No ally buff.' },
  },
  dissonance: {
    A: { id: 'shatter', name: 'Shattering Chord', desc: 'A narrow 10 m beam of sound: more damage and 2 Discord stacks, still interrupts, but no slow.', coop: 1 },
    B: { id: 'feedback', name: 'Feedback', desc: 'A 5 m blast all around you that hurls enemies away and slows them. Still interrupts.' },
  },
  crescendo: {
    A: { id: 'finale', name: 'Grand Finale', desc: 'Builds in 1.5 s and bursts on enemies within 10 m: big damage, and 3+ Discord stacks (4 for a boss) BREAK them. No shield or buff.', coop: 1 },
    B: { id: 'encore', name: 'Encore', desc: 'A longer song for the party: a bigger shield (30%), +20% damage for 10 s and a 15% heal. No damage or Break.' },
  },
};

export const BARD_WEAPONS = ['Pine Lute', 'Maple Lyre', 'Resonant Harp', 'Song of Dawn'];
