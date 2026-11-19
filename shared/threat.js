// Team threat (docs/ROADMAP.md G3): tuning for visible threat, healer threat, the Guardian's Cover and flanking.
// Server rules: server/threat.js. Client HUD: public/threat.js. Bot use: shared/bots/threat.js.
import { angleTo, wrapAngle } from './data.js';

export const THREAT = {
  heal: 0.5,   // threat per point of effective healing (or damage a shield soaked), split across the enemies fighting the party; overheal adds none
  warn: 90,    // the meter turns to "about to pull" at this % of the top threat
  saveWin: 3,  // s: a hit that would have downed someone within this long after a heal (or soaked by a shield) counts as a save
};

// Taunt locks (docs/ROADMAP.md J4). On a taunt of mob m by T:
//   R = max(best non-taunter threat/s on m over the last `window` s, atkMul × the highest fighter's attack); L = Lmul × R
//   every entry ×= L / max(top, 1); then T = L, everyone else = min(v, cut × L); everyone's clean multiplier resets
//   m.lock = { by: T, L, until }: the target is T and T's entry stays at L; others build normally.
//   Lock end: T = handover × L, the target becomes the highest entry (a tie goes to T). It ends early (no handover) if T
//   is dead, downed, trapped or out of the room. A re-taunt by anyone does the same from the current values.
export const TAUNT = {
  lock: { taunt: 6, warcry: 6, challenge: 8 }, // s, × the Provoke talent's duration bonus
  cdGap: 3,      // s: a lock never lasts longer than the taunt's cooldown minus this
  window: 6,     // s of threat history for R
  atkMul: 2,     // R's floor: this × the highest fighter's attack
  Lmul: 24,      // L = Lmul × R
  cut: 0.5,      // everyone else: at most this × L
  handover: 0.9, // the taunter's entry when the lock ends
  meterMax: 150, // during a lock the meter shows v / L, up to this %
};

// Clean-damage multiplier: one per player, on damage threat against bosses and elites (not heal threat).
//   mult = min(max, 1 + per × cleanSecs); cleanSecs only advances while the player damaged a boss / elite in the last
//   `recent` s. Reset to 0 on any HP or shield loss (not evaded / parried / Covered hits), a taunt, being downed, or the
//   end of the fight.
export const CLEAN = { per: 0.05, max: 2.5, recent: 3 };
export const cleanMult = secs => Math.min(CLEAN.max, 1 + CLEAN.per * Math.max(0, secs));

// Cover (Guardian, C): dash to an ally and take the next hit meant for them.
export const COVER = {
  range: 8,    // m: how far the dash reaches (to an ally within this)
  window: 1.5, // s: how long the Guardian stands in for them
  cd: 12,      // s
  stand: 1.1,  // m: where the Guardian lands, this far from the ally toward the threat
  leash: 6,    // m: the hit is only taken while the Guardian is still this close to the ally
};

// Flanking: hits from an enemy's back 120°, and Pincers (a party member on the opposite side).
export const FLANK = {
  back: Math.PI / 3,     // half-angle of the back cone (120° in all)
  apart: (2 * Math.PI) / 3, // 120°: how far apart around the enemy two attackers must be for a Pincer
  reach: 6,              // m beyond the enemy's radius: attacker and partner must both be this close (melee-ish range)
  dmg: { back: 1.08, pincer: 1.15 },     // damage multipliers (a Pincer replaces the back bonus)
  posture: { back: 1.12, pincer: 1.2 }, // extra posture from the hit's damage
  tagEvery: 2,           // s: at most one Pincer tag per player this often
  backTagEvery: 6,       // s: the subtler Flank tag
};

// Bearing of point (x, z) around mob m, relative to where the mob faces (0 = in front, ±π = right behind).
export const bearing = (m, x, z) => wrapAngle(angleTo(m.x, m.z, x, z) - (m.face || 0));
export const fromBehind = (m, x, z) => Math.abs(bearing(m, x, z)) >= Math.PI - FLANK.back;
// Angle between two points around the mob's centre (0..π).
export const apartAround = (m, a, b) => Math.abs(wrapAngle(angleTo(m.x, m.z, a.x, a.z) - angleTo(m.x, m.z, b.x, b.z)));
export const inFlankReach = (m, p) => Math.hypot(p.x - m.x, p.z - m.z) <= (m.def?.radius || 1) + FLANK.reach;
