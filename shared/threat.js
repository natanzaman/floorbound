// Team threat (docs/ROADMAP.md G3): tuning for visible threat, healer threat, the Guardian's Cover and flanking.
// Server rules: server/threat.js. Client HUD: public/threat.js. Bot use: shared/bots/threat.js.
import { angleTo, wrapAngle } from './data.js';

export const THREAT = {
  heal: 0.5,   // threat per point of effective healing (or damage a shield soaked), split across the enemies fighting the party; overheal adds none
  warn: 90,    // the meter turns to "about to pull" at this % of the top threat
  saveWin: 3,  // s: a hit that would have downed someone within this long after a heal (or soaked by a shield) counts as a save
};

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
  dmg: { back: 1.1, pincer: 1.2 },     // damage multipliers (a Pincer replaces the back bonus)
  posture: { back: 1.15, pincer: 1.3 }, // extra posture from the hit's damage
  tagEvery: 2,           // s: at most one Pincer tag per player this often
  backTagEvery: 6,       // s: the subtler Flank tag
};

// Bearing of point (x, z) around mob m, relative to where the mob faces (0 = in front, ±π = right behind).
export const bearing = (m, x, z) => wrapAngle(angleTo(m.x, m.z, x, z) - (m.face || 0));
export const fromBehind = (m, x, z) => Math.abs(bearing(m, x, z)) >= Math.PI - FLANK.back;
// Angle between two points around the mob's centre (0..π).
export const apartAround = (m, a, b) => Math.abs(wrapAngle(angleTo(m.x, m.z, a.x, a.z) - angleTo(m.x, m.z, b.x, b.z)));
export const inFlankReach = (m, p) => Math.hypot(p.x - m.x, p.z - m.z) <= (m.def?.radius || 1) + FLANK.reach;
