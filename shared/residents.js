// Residents (docs/briefs/bot-days.md, "Residents"; owner 2026-11-23: six, shown to him first): bots the server keeps
// while at least one player is online, so a world nobody has added bots to still has people living their own days in
// it. Fixed names, so fixed personalities (shared/bots/personality.js rolls them from the name: the table below is what
// that roll gives), mixed classes, a fixed skill level (shared/botskill.js: 2 Casual, 3 Average, 4 Skilled) and a share
// of the online players' top level. Each lives its own day (behaviour `own`, shared/bots/day.js): they are not a party,
// though the sociable ones team up with another free bot now and then. Anyone may invite one.
//   On by default only on Render (RENDER is set there; server/shutdown.js does the same), so test and local servers
//   stay as they were. RESIDENTS=<n> keeps the first n anywhere (at most the table's length); RESIDENTS=0 turns them off.

// share: of the top online player's level (rounded, at least 1), so the six are spread below the players.
export const RESIDENTS = [
  { name: 'Marlo', cls: 'guardian', skill: 3, share: 1.0 },    // Steady: calm, dependable, plays it straight
  { name: 'Gideon', cls: 'cleric', skill: 3, share: 0.9 },     // Chatterbox: talks a lot, sticks close to people
  { name: 'Talia', cls: 'lancer', skill: 3, share: 0.85 },     // Explorer: curious, drifts off to look at things
  { name: 'Pip', cls: 'berserker', skill: 2, share: 0.75 },    // Hothead: charges in, hates waiting
  { name: 'Rosalind', cls: 'bard', skill: 2, share: 0.65 },    // Joker: playful, hops about when bored
  { name: 'Brenna', cls: 'ranger', skill: 2, share: 0.55 },    // Quiet: says little, keeps her distance, very patient
];

export const RESIDENT_GRACE = 60;   // s with no player online before they leave the world (a quick reconnect keeps them)
export const RESIDENT_AWAY = 1800;  // s a resident an admin removed stays out before it comes back

// How many the server keeps: RESIDENTS if given (0 = none), else all six on Render and none elsewhere.
export function residentCount(env = process.env) {
  const v = env.RESIDENTS, def = env.RENDER ? RESIDENTS.length : 0;
  const n = v === undefined || v === '' ? def : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(RESIDENTS.length, Math.floor(n))) : def;
}

// A resident's level from the top online player's: spread below it, at least 1.
export const residentLevel = (top, share) => Math.max(1, Math.round((top || 1) * share));

export const isResidentName = n => RESIDENTS.some(r => r.name.toLowerCase() === String(n || '').toLowerCase());
