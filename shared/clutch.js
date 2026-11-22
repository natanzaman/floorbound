// Clutch moments (docs/briefs/combat-quickwins.md 4). Shared by the server (server/clutch.js) and the client
// (public/clutch.js).
//   LAST_STAND: a hit that would down or kill you within `after` s of your last perfect dodge or parry leaves you at
//     `hp` HP with `invuln` s in which nothing hurts you. Once per boss fight; outside one, once per `fieldCd` s.
//     Never in duels or during a director show.
//   FINISHER: a floor boss killed by a Team Burst or the Last Attack: everyone in that fight sees `secs` s of slow motion
//     at x`scale` (visual only: the server never slows), unless Reduce motion is on.
export const LAST_STAND = { after: 10, hp: 1, invuln: 1.5, fieldCd: 90 };
export const FINISHER = { secs: 0.8, scale: 0.25 };

/** May a Last Stand save p now? s: { now, clutchAt, usedFight, usedAt, fight } (fight: the boss fight object or null). */
export function lastStandReady({ now, clutchAt, usedFight, usedAt, fight }) {
  if (!(now - (clutchAt ?? -1e9) <= LAST_STAND.after)) return false;
  if (fight) return usedFight !== fight;
  return now - (usedAt ?? -1e9) >= LAST_STAND.fieldCd;
}
