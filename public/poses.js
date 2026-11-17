// Poses (docs/ROADMAP.md F5): kneel, sit, bow. The server lists held poses in every snapshot (w.poses = [[id, k]], left
// out when nobody is posed) and announces changes ({ t: 'pose', id, k }); the rig eases into them (world.js setPose).
// Players use /kneel, /sit, /bow, /stand in chat (read by the server, server/poses.js).
import { JUMP } from '/shared/data.js';

export function snapPoses(list, players) {
  const held = new Map(list || []);
  for (const [id, e] of players) e.pose = held.get(id) || null;
  return held;
}

// Per frame (main.js animateEntity): hold the pose only while standing still and alive, so your own character stands up
// the moment you move, before the server's clear arrives.
export function poseFrame(e, a) { a.setPose(!e.dead && e.spd < 0.5 && !(e.jumpT < JUMP.time) ? e.pose : null); }
