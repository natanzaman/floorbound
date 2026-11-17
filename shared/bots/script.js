// The script layer of a bot's brain, for the scene director (server/director.js, docs/ROADMAP.md F2).
//
// The director sets b.script on its actor bots; the brain (shared/bots/brain.js think()) calls scriptTurn first and
// skips its own turn when it returns true. Without b.script nothing here runs: normal bots are untouched.
//
//   b.script = {
//     k: 'idle' | 'move' | 'fight',   idle: stand (and face); move: walk/run to (x, z) and stop within `stop`;
//                                     fight: return false, so the normal brain plays (the director points it at the
//                                     cue's target with an attack order, b.cmd)
//     x, z, stop, speed,              move target (the director updates them each tick for moving targets)
//     face,                           angle to face while standing (or after arriving), or null
//     once: [{ k: 'dodge', dir } | { k: 'jump' }],   one-off actions, done in order (a roll takes over its turns)
//     goal,                           what the admin page shows
//   }
// Scripted bots never wander, never chatter on their own (b.quiet) and never ready up unless told (the brain skips its
// raid-gate ready check while b.script is set); in a fight cue their dodging works as usual.
import { JUMP, DODGE } from '../data.js';
import { moveToward, stepRoll, d2 } from './motor.js';

export function scriptTurn(b) {
  const s = b.script;
  if (!s) return false;
  if (b.dead) { b.goal = 'down'; return true; }
  if (stepRoll(b)) return true; // finishing a roll
  if (s.once?.length) {
    const a = s.once.shift();
    if (a.k === 'dodge') { roll(b, a.dir ?? b.face); return true; }
    if (a.k === 'jump') { b.airUntil = (b.clock ? b.clock() : performance.now() / 1000) + JUMP.time; b.send({ type: 'jump' }); }
  }
  if (s.k === 'fight') return false; // the normal brain plays, focused on the cue's target
  b.goal = s.goal || 'Acting';
  b.tgtId = null;
  if (s.k === 'move' && Number.isFinite(s.x) && Number.isFinite(s.z) && d2(b.x, b.z, s.x, s.z) > (s.stop ?? 0.4)) {
    if (moveToward(b, s.x, s.z, s.stop ?? 0.4, s.speed)) return true;
  }
  if (Number.isFinite(s.face)) b.face = s.face;
  return true;
}

function roll(b, dir) {
  if (b.dodgeCd > 0) return;
  b.roll = { left: DODGE.time, dir }; b.face = dir;
  b.dodgeCd = DODGE.cd; b.dodgePressed = b.t;
  b.send({ type: 'dodge', face: dir });
  stepRoll(b);
}
