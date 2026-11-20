// Boss team mechanics (docs/ROADMAP.md G4): shared meteor (stack), spread markers, tether. They only appear while at least
// `min` fighters are alive in the boss room (a solo fight never sees them), never during a director show unless a cue
// forces one (forceBossMove 'meteor' | 'spread' | 'tether'), and are mixed into each boss's phase rotation.
// Damage is a fraction of the victim's max HP (before its own damage reduction), so it reads the same at every level.
// Server: server/bossteam.js. Client: public/bossteam.js. Bots: shared/bots/bossteam.js.
// Each boss's rescue trap (J1, shared/rescue.js: 'vines', 'pillar', 'crystal') is drawn from the same lists.
import { TIMED, TEAM_TIMING } from './bosstiming.js';
export const TEAM_MOVES = ['meteor', 'spread', 'tether'];

// The numbers live in shared/bosstiming.js: the shared rules and moves in TEAM_TIMING, each boss's rotation in its table.
export const BOSSTEAM = {
  ...TEAM_TIMING.team, // min: alive fighters in the room; channel: while a meteor or spread is up, the boss's other telegraphed
  // attacks wait until this long after it lands; retry: s before a rotation blocked by a busy boss or too few fighters retries
  // Per boss: seconds between two team mechanics by phase, the first one after engaging, and which mechanics each phase
  // draws from (in turn, from a random start).
  warden: TIMED.warden.team,
  sovereign: TIMED.sovereign.team,
  colossus: TIMED.colossus.team, // Floor 3
  // Shared meteor: a golden circle follows one fighter; when it lands, `total` (× each victim's max HP) is split between
  // everyone inside: per person = total / n^split (1 alone: near-lethal; 2: ~37%; 3: ~22%; 4: ~15%).
  // Rolling and jumping don't dodge it: stand in it together.
  meteor: TEAM_TIMING.meteor,
  // Spread: `n` fighters (by party size) carry a marker; when it expires each one bursts in `r` m, hitting everyone ELSE
  // inside for `hit` × max HP (the carrier takes `self`). Overlapping carriers hit each other.
  spread: TEAM_TIMING.spread,
  // Tether: two fighters are linked. After `grace` s it ticks `dmg` × max HP every `tick` s to both, until they are at
  // least `need` m apart (broken) or `max` s pass.
  tether: TEAM_TIMING.tether,
};
