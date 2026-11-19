// Bots and the rescue traps (docs/ROADMAP.md J1, server/rescue.js). Used by the bot brain (shared/bots/brain.js):
//   readRescue(b, w.trap)  marks trapped players (p.trap = { k, left, prog, by, prop, blocked }) and this bot (b.trap)
//   rescueTurn(b, P)       vines: this bot is the one to cut a partymate free: walk over, hold E (true = turn taken)
//   rescueTarget(b, P)     the trap object this bot should hit instead of its usual target (a vine, the pillar's orb,
//                          the storm crystal), or null
// Who helps: every bot that isn't trapped, down or the tank (the tank keeps the boss, unless nobody else is free). One
// bot (the closest; a healer last) holds E on vines; up to two break a pillar's orb; everyone breaks a storm crystal.
// Capability (BOT_RESCUE): the reaction delay, and how often a bot ignores a trap and keeps hitting the boss.
import { RESCUE, BOT_RESCUE, readTraps } from '../rescue.js';
import { clampSkill } from '../botskill.js';
import { SPRINT_SPEED } from '../data.js';
import { d2, moveToward, dodgeSpot, evade } from './motor.js';
import { say } from './social.js';

const prof = b => BOT_RESCUE[clampSkill(b.skill ?? 5)] || BOT_RESCUE[5];
const between = ([lo, hi]) => lo + (hi - lo) * Math.random();
const LINES = ['Hold on, {who}!', "I'll get you out, {who}.", 'Breaking you free, {who}!'];

export function readRescue(b, list) {
  const traps = readTraps(list);
  for (const p of b.players) p.trap = traps.get(p.id) || null;
  b.trap = traps.get(b.id) || null;
  b.traps = traps;
  const seen = (b.trapSeen ||= new Map()); // victim id -> { at: noticed (reaction delay), ignore, prop }
  for (const [id, tr] of traps) {
    const s = seen.get(id);
    if (!s || s.prop !== tr.prop) seen.set(id, { at: b.t + between(prof(b).delay), ignore: Math.random() < prof(b).ignore, prop: tr.prop });
  }
  for (const id of [...seen.keys()]) if (!traps.has(id)) seen.delete(id);
  if (b.freeing && !traps.has(b.freeing.id)) b.freeing = null;
}

// Party members who can help (standing, not trapped), with this bot's own view of itself.
const helpers = P => P.all.filter(p => !p.dead && !p.downed && !p.trap);
// Is this bot one of the helpers for this trap (by role and its place in line)?
function helps(b, P, vid, tr, max) {
  const s = b.trapSeen?.get(vid);
  if (!s || s.ignore || b.t < s.at || b.trap || b.dead || b.downed) return false;
  const free = helpers(P);
  const others = free.filter(p => p.role !== 'tank');
  if (b.role === 'tank' && others.length) return false; // the tank keeps the boss
  const victim = P.all.find(p => p.id === vid) || b.players.find(p => p.id === vid);
  const prop = b.mobs.find(m => m.id === tr.prop);
  const at = tr.k === 'pillar' ? prop : victim;
  if (!at) return false;
  const pool = (others.length ? others : free).filter(p => p.bot);
  const rank = p => (p.role === 'healer' ? 1 : 0);
  pool.sort((x, y) => rank(x) - rank(y) || d2(x.x, x.z, at.x, at.z) - d2(y.x, y.z, at.x, at.z) || x.id - y.id);
  const i = pool.findIndex(p => p.id === b.id);
  return i >= 0 && i < max;
}

// The partymate this bot is going to free, if any: [victim id, trap].
function job(b, P) {
  if (!b.traps?.size) return null;
  for (const [vid, tr] of b.traps) {
    if (vid === b.id || !P.all.some(p => p.id === vid)) continue; // our party's
    const max = tr.k === 'crystal' ? 9 : tr.k === 'pillar' ? 2 : 1;
    if (helps(b, P, vid, tr, max)) return [vid, tr];
  }
  return null;
}

// Release E (if held).
export function releaseFree(b) {
  if (b.freeing?.sent) b.send({ type: 'free', on: 0 });
  b.freeing = null;
}

// Vines: walk over to the trapped partymate and hold E. Other traps: nothing here (rescueTarget hits the object).
export function rescueTurn(b, P) {
  const j = job(b, P);
  if (!j || j[1].k !== 'vines' || b.downed?.by) { if (b.freeing) releaseFree(b); return false; }
  const [vid, tr] = j;
  if (tr.by && tr.by !== b.id) { if (b.freeing) releaseFree(b); return false; } // someone else has them
  const v = P.all.find(p => p.id === vid);
  if (!v) return false;
  if (b.freeing?.id !== vid) {
    releaseFree(b);
    b.freeing = { id: vid, sent: false, at: 0 };
    say(b, 'rescue', {}, { p: 0.4, cd: 30, text: LINES[Math.floor(Math.random() * LINES.length)].replace('{who}', b.names?.get(vid)?.name || 'friend') });
  }
  const F = b.freeing;
  b.goal = `Freeing ${b.names?.get(vid)?.name || 'a partymate'}`;
  const spot = dodgeSpot(b);
  if (spot) { if (F.sent) { b.send({ type: 'free', on: 0 }); F.sent = false; } evade(b, ...spot); return true; } // the red first
  const d = d2(b.x, b.z, v.x, v.z), R = RESCUE.vines.reach;
  if (d > R - 0.4) {
    if (F.sent) { b.send({ type: 'free', on: 0 }); F.sent = false; }
    moveToward(b, v.x, v.z, R - 0.9, d > 8 ? SPRINT_SPEED : undefined);
    return true;
  }
  b.face = Math.atan2(v.x - b.x, v.z - b.z);
  if (F.sent && tr.by !== b.id && b.t - F.at > 0.4) F.sent = false; // it broke: press again
  if (!F.sent) { b.send({ type: 'free', on: 1, id: vid }); F.sent = true; F.at = b.t; }
  return true;
}

// Get to a trap object fast (sprint), close enough that nothing (the boss) stands in a ranged attack's line; true =
// turn taken. Once there, the brain fights it from that spot (breakFrom).
export function propApproach(b, tgt, ranged) {
  const d = d2(b.x, b.z, tgt.x, tgt.z), want = tgt.def.radius + (ranged ? 2.4 : 1.2);
  if (d <= want + 0.8) return false;
  b.goal = `Breaking the ${tgt.def.name}`;
  moveToward(b, tgt.x, tgt.z, want, d > 5 ? SPRINT_SPEED : undefined);
  b.face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
  return true;
}

// The trap object to hit this turn instead of the usual target (the pillar's orb, the storm crystal), or null. (Vines:
// one bot holds E, rescueTurn.)
export function rescueTarget(b, P) {
  const j = job(b, P);
  if (!j || j[1].k === 'vines') return null;
  return b.mobs.find(x => x.id === j[1].prop) || null;
}
