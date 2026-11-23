// Idle habits (docs/briefs/personalities.md): what a bot does with its hands when nothing needs doing, by personality
// (shared/bots/personality.js). Called from the brain's idle() only: no target, no dodge, not scripted, not in a duel
// or a boss room. Everything here is something a player can do too: turn to look, hop, /sit, /bow, stand still a while.
//
//   look   every few seconds turn to look at something: a nearby player (sociable) or a random direction (curious)
//   hop    playful bots hop now and then, and hop back when a human partymate hops next to them (once per 4 s)
//   sit    after waiting a while with nothing to do, sit (the server stands it up as soon as it moves)
//   bow    a sociable bot bows once to a human who joins its party, then straightens up
//   AFK    a free bot farming alone (never with a human in its party) sometimes stops for half a minute to two
//
// A neutral bot (BOT_PERSONA=0) does none of this.
import { traitOf, isNeutral } from './personality.js';
import { inArena } from '../data.js';
import { inArena2 } from '../floor2.js';
import { inArena3 } from '../floor3.js';

const inBossRoom = (x, z) => inArena(x, z) || inArena2(x, z) || inArena3(x, z);
const turnRate = b => 2.5 + traitOf(b, 'curiosity') * 2; // rad/s while looking around
const angDiff = (a, c) => Math.atan2(Math.sin(c - a), Math.cos(c - a));

const st = b => (b.idle ||= { seen: -9, still: 0, lookAt: null, lookT: 0, hopT: 0, hopAt: 0, lastHop: -9, standAt: 0, sit: false, sitT: 0, afkUntil: 0, afkT: 0, bowQ: [] });

// May habits run this turn? (the caller already knows there's no target and no dodge)
export function idleOk(b) {
  return !isNeutral(b) && !!b.me && !b.dead && !b.script && !b.duel && !b.trap && !b.roll && !b.tele?.length && !b.plan?.st?.pose && !inBossRoom(b.x, b.z); // (pose: a plan's emote step is holding one)
}

// The start of an idle turn: a fresh idle spell resets the clock. Returns the state.
export function idleBegin(b) {
  const s = st(b);
  if (b.t - s.seen > 0.25) { s.still = b.t; s.sit = false; s.lookAt = null; }
  s.seen = b.t;
  return s;
}

// Moved this turn: not still any more (and the server stood us up).
export function idleMoved(b) { const s = st(b); s.still = b.t; s.sit = false; }

// Free bots only: an AFK spell now? (s: the idle state). Rolls about once a minute.
export function afkNow(b, withHuman) {
  const s = st(b);
  if (isNeutral(b) || withHuman || b.cmd) { s.afkUntil = 0; return false; } // (a human or an order ends a break)
  if (b.t < s.afkUntil) { b.goal = 'AFK'; return true; }
  if (b.t > s.afkT) {
    s.afkT = b.t + 50 + Math.random() * 30;
    const p = 0.08 * (1 - traitOf(b, 'aggression')) * (0.5 + traitOf(b, 'curiosity'));
    if (Math.random() < p) { s.afkUntil = b.t + 30 + Math.random() * 90; b.goal = 'AFK'; return true; }
  }
  return false;
}

// Settled in place with nothing to do: look around, hop, sit, bow. P: the party view (brain.js partyView).
export function idleHabits(b, P) {
  if (!idleOk(b)) return;
  const s = st(b);
  const still = b.t - s.still;
  // bows owed to humans who joined (one at a time, once we've stood still a moment)
  if (s.bowQ.length && still > 0.6 && !s.sit) {
    const id = s.bowQ.shift(), p = P.all.find(q => q.id === id);
    if (p) { b.face = Math.atan2(p.x - b.x, p.z - b.z); b.send({ type: 'chat', text: '/bow' }); s.lookAt = b.face; s.lookT = b.t + 2.5; s.standAt = b.t + 1.5; return; }
  }
  if (s.standAt) { // a bow is a held pose: straighten up after a moment (and don't turn while bowed)
    if (b.t < s.standAt) return;
    s.standAt = 0; b.send({ type: 'chat', text: '/stand' });
  }
  // sit after a long wait (impatient bots sooner? no: restless ones fidget instead, calm ones sit)
  const sitAfter = 14 + (1 - traitOf(b, 'patience')) * 20 + traitOf(b, 'playfulness') * 10;
  if (!s.sit && still > sitAfter && b.t > s.sitT) {
    s.sitT = b.t + 20;
    if (Math.random() < 0.25 + traitOf(b, 'patience') * 0.5) { s.sit = true; b.send({ type: 'chat', text: '/sit' }); return; }
  }
  if (s.sit) return; // sitting: stay put, face where we sat
  // hop back at a partymate who hopped (idleEvent), or now and then
  if (s.hopAt && b.t >= s.hopAt) { const late = b.t - s.hopAt; s.hopAt = 0; if (late < 2) { b.send({ type: 'jump' }); s.lastHop = b.t; } } // (stale: too late, skip it)
  const play = traitOf(b, 'playfulness');
  if (play > 0.55 && b.t > s.hopT) {
    s.hopT = b.t + 6 + Math.random() * (30 - play * 20);
    if (Math.random() < play * 0.6) { b.send({ type: 'jump' }); s.lastHop = b.t; }
  }
  // look around
  if (b.t > s.lookT) {
    s.lookT = b.t + 2 + Math.random() * (9 - traitOf(b, 'curiosity') * 5);
    const near = P.all.filter(p => p.id !== b.id && !p.dead && Math.hypot(p.x - b.x, p.z - b.z) < 12);
    if (near.length && Math.random() < 0.2 + traitOf(b, 'sociability') * 0.4) {
      const p = near[Math.floor(Math.random() * near.length)];
      s.lookAt = Math.atan2(p.x - b.x, p.z - b.z) + (Math.random() * 2 - 1) * 0.3; // (roughly their way, not a stare)
    } else s.lookAt = b.face + (Math.random() * 2 - 1) * (0.6 + traitOf(b, 'curiosity') * 1.6);
  }
  if (s.lookAt != null) {
    const d = angDiff(b.face, s.lookAt), step = turnRate(b) * (b.dt || 0.05);
    b.face = Math.abs(d) <= step ? s.lookAt : b.face + Math.sign(d) * step;
  }
}

// Events: a human joining the party (bow), a partymate hopping next to us (hop back).
export function idleEvent(b, e, { isBot, mateOf }) {
  if (isNeutral(b) || b.script) return;
  const s = st(b);
  if (e.t === 'pjoin' && e.id !== b.id && b.party && e.party === b.party && !isBot(b, e.id) && traitOf(b, 'sociability') > 0.6 && Math.random() < 0.7) s.bowQ.push(e.id);
  if (e.t === 'jump' && e.id !== b.id && mateOf(b, e.id) && !isBot(b, e.id) && !b.tgtId && b.t - s.lastHop > 4 && !s.hopAt) { // (a human's hop only: bots don't ping-pong)
    const p = b.players.find(q => q.id === e.id);
    if (p && Math.hypot(p.x - b.x, p.z - b.z) < 10 && Math.random() < traitOf(b, 'playfulness') * 0.5) {
      s.hopT = b.t + 4; s.hopAt = b.t + 0.25 + Math.random() * 0.5; // (hops back on the next idle turn after that)
    }
  }
}
