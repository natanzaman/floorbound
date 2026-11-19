// Boss team mechanics (docs/ROADMAP.md G4): shared meteor (stack), spread markers, tether. They only appear while at least
// `min` fighters are alive in the boss room (a solo fight never sees them), never during a director show unless a cue
// forces one (forceBossMove 'meteor' | 'spread' | 'tether'), and are mixed into each boss's phase rotation.
// Damage is a fraction of the victim's max HP (before its own damage reduction), so it reads the same at every level.
// Server: server/bossteam.js. Client: public/bossteam.js. Bots: shared/bots/bossteam.js.
export const TEAM_MOVES = ['meteor', 'spread', 'tether'];

export const BOSSTEAM = {
  min: 2, // alive fighters in the room
  channel: 0.8, // while a meteor or spread is up, the boss's other telegraphed attacks wait until this long after it lands
  // Per boss: seconds between two team mechanics by phase, the first one after engaging, and which mechanics each phase
  // draws from (in turn, from a random start).
  warden: { every: [26, 22, 18], first: 16, moves: [['meteor', 'spread'], ['meteor', 'spread', 'tether'], ['meteor', 'spread', 'tether']] },
  sovereign: { every: [26, 22, 18], first: 14, moves: [['meteor', 'spread'], ['meteor', 'spread', 'tether'], ['meteor', 'spread', 'tether']] },
  colossus: { every: [28, 26, 22], first: 18, moves: [['meteor', 'spread'], ['meteor', 'spread', 'tether'], ['spread', 'tether']] }, // Floor 3
  // Shared meteor: a golden circle follows one fighter; when it lands, `total` (× each victim's max HP) is split between
  // everyone inside: per person = total / n^split (1 alone: near-lethal; 2: ~37%; 3: ~22%; 4: ~15%).
  // Rolling and jumping don't dodge it: stand in it together.
  meteor: { r: 3.6, wind: 4.5, total: 0.9, split: 1.3 },
  // Spread: `n` fighters (by party size) carry a marker; when it expires each one bursts in `r` m, hitting everyone ELSE
  // inside for `hit` × max HP (the carrier takes `self`). Overlapping carriers hit each other.
  spread: { r: 6, wind: 5.5, hit: 0.42, self: 0.06, n: f => (f >= 5 ? 3 : 2) },
  // Tether: two fighters are linked. After `grace` s it ticks `dmg` × max HP every `tick` s to both, until they are at
  // least `need` m apart (broken) or `max` s pass.
  tether: { need: 15, grace: 1.5, tick: 0.5, dmg: 0.035, max: 11 },
};
