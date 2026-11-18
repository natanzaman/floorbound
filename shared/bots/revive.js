// Bots and downed + revive (docs/ROADMAP.md G1, server/revive.js). Used by the bot brain (shared/bots/brain.js):
//   readDowned(b, w.down)  marks downed players in b.players (p.downed = { left, prog, by }) and b.downed (this bot)
//   downedTurn(b, P)       this bot is down: crawl to the nearest standing partymate (true = turn taken)
//   reviveTurn(b, P)       a partymate is down and this bot is the one to go: walk over, hold the revive (true = turn taken)
// Who goes (every bot works it out the same way, one reviver per body): the party's Cleric (healer) within 20 m first,
// then the closest bot that isn't the tank, then the tank. Capability (BOT_REVIVE) sets the reaction delay and how often
// the bot keeps channelling inside a telegraph instead of stepping out.
import { DOWNED, BOT_REVIVE } from '../revive.js';
import { clampSkill } from '../botskill.js';
import { CLASSES, SPRINT_SPEED, walkable, resolveCollision } from '../data.js';
import { DT, d2, moveToward, dodgeSpot, evade, useSkill } from './motor.js';
import { say } from './social.js';

const prof = b => BOT_REVIVE[clampSkill(b.skill ?? 5)] || BOT_REVIVE[5];
const between = ([lo, hi]) => lo + (hi - lo) * Math.random();
const LINES = ['Hang on, {who}!', 'Got you, {who}.', 'Picking {who} up!', 'Up you get, {who}.'];

export function readDowned(b, list) {
  const down = new Map((list || []).map(r => [r[0], { left: r[1], prog: r[2], by: r[3] }]));
  for (const p of b.players) p.downed = down.get(p.id) || null;
  b.downed = down.get(b.id) || null;
  const seen = (b.downSeen ||= new Map()); // body id -> when this bot noticed it (after its reaction delay)
  for (const id of down.keys()) if (!seen.has(id)) seen.set(id, b.t + between(prof(b).delay));
  for (const id of [...seen.keys()]) if (!down.has(id)) seen.delete(id);
  if (b.rev && !down.has(b.rev.id)) b.rev = null; // revived (or bled out)
}

// Let go of E (if held).
export function release(b) {
  if (b.rev?.sent) b.send({ type: 'revive', on: 0 });
  b.rev = null;
}

// Straight-line step without the capability aim noise (the last couple of metres to a body).
function stepTo(b, x, z, stop, speed) {
  const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz);
  if (d <= stop) return false;
  const k = Math.min(d - stop, speed * DT) / d;
  const [nx, nz] = resolveCollision(b.x + dx * k, b.z + dz * k);
  if (!walkable(nx, nz, !b.gateOpen)) return moveToward(b, x, z, stop, speed);
  b.x = nx; b.z = nz; b.face = Math.atan2(dx, dz);
  return true;
}

export function downedTurn(b, P) {
  if (!b.downed) return false;
  if (b.rev) b.rev = null; // (the server already stopped any channel of ours)
  b.goal = b.downed.by ? 'Downed: being revived' : 'Downed: waiting for a revive';
  if (b.downed.by) return true; // hold still for the reviver
  const help = P.mates.filter(p => !p.dead && !p.downed).sort((x, y) => d2(x.x, x.z, b.x, b.z) - d2(y.x, y.z, b.x, b.z))[0];
  if (help && d2(help.x, help.z, b.x, b.z) > 1.6) stepTo(b, help.x, help.z, 1.4, DOWNED.crawl);
  return true;
}

// Which body (if any) this bot should revive: assign standing party bots to bodies in id order.
function assignment(b, P) {
  const downs = P.all.filter(p => p.downed && !p.dead && p.id !== b.id).sort((x, y) => x.id - y.id);
  if (!downs.length) return null;
  const busy = new Set(downs.map(d => d.downed.by).filter(Boolean));
  const bots = P.all.filter(p => p.bot && !p.dead && !p.downed);
  for (const d of downs) {
    if (d.downed.by) { if (d.downed.by === b.id) return d; continue; } // someone is already on it
    const near = bots.filter(p => !busy.has(p.id) && d2(p.x, p.z, d.x, d.z) < 35);
    if (!near.length) continue;
    const dist = p => d2(p.x, p.z, d.x, d.z);
    const rank = p => (p.role === 'healer' && dist(p) < 20 ? 0 : p.role === 'tank' ? 2 : 1);
    near.sort((x, y) => rank(x) - rank(y) || dist(x) - dist(y) || x.id - y.id);
    busy.add(near[0].id);
    if (near[0].id === b.id) return d;
  }
  return null;
}

export function reviveTurn(b, P) {
  if (b.dead || b.downed) return false;
  const d = assignment(b, P);
  if (!d || (b.rev?.id !== d.id && b.t < (b.downSeen?.get(d.id) ?? 0))) { if (b.rev) release(b); return false; } // not ours, or not noticed yet
  if (b.rev?.id !== d.id) {
    release(b);
    b.rev = { id: d.id, sent: false, at: 0, careless: Math.random() < prof(b).careless };
    say(b, 'revive', {}, { p: 0.5, cd: 30, text: LINES[Math.floor(Math.random() * LINES.length)].replace('{who}', b.names?.get(d.id)?.name || 'friend') });
  }
  const R = b.rev;
  b.goal = `Reviving ${b.names?.get(d.id)?.name || 'a partymate'}`;
  const spot = dodgeSpot(b);
  if (spot && !R.careless) { // step out of the red first (lets go of E)
    if (R.sent) { b.send({ type: 'revive', on: 0 }); R.sent = false; }
    evade(b, ...spot);
    return true;
  }
  const dist = d2(b.x, b.z, d.x, d.z);
  if (dist > DOWNED.reach - 0.5) {
    if (R.sent) { b.send({ type: 'revive', on: 0 }); R.sent = false; }
    if (dist > 4) moveToward(b, d.x, d.z, DOWNED.reach - 0.9, dist > 9 ? SPRINT_SPEED : undefined);
    else stepTo(b, d.x, d.z, DOWNED.reach - 0.9, SPRINT_SPEED);
    return true;
  }
  b.face = Math.atan2(d.x - b.x, d.z - b.z);
  if (R.sent && d.downed.by !== b.id && b.t - R.at > 0.4) R.sent = false; // the channel broke (hit, moved): press again
  if (!R.sent) { b.send({ type: 'revive', on: 1, id: d.id }); R.sent = true; R.at = b.t; }
  else if (d.downed.by === b.id && CLASSES[b.cls]?.skills[1]?.id === 'heal') useSkill(b, 1, b.face, d.id); // a Cleric's Heal speeds its own channel
  return true;
}
