// Downed + revive (docs/ROADMAP.md G1): tuning shared by the server (server/revive.js), the client (public/revive.js)
// and the bots (shared/bots/revive.js).
//
// At 0 HP in a party with a standing partymate within `near` m you go DOWNED for `secs` s instead of dying: you crawl,
// can't act, and bleed out (a normal death) when the time runs out. A partymate holds E within `reach` m for a
// `channel` s revive (longer for each earlier revive of you in the same fight); you get up at `hp` of your health with
// `iframe` s of invulnerability. Solo (no standing partymate near) you die as before; the whole party down is a wipe.
export const DOWNED = {
  secs: 15,        // bleed-out time
  near: 40,        // a standing partymate within this (m, same floor) when you drop: downed instead of dead
  keep: 60,        // no standing partymate within this any more: everyone downed bleeds out at once (wipe / abandoned)
  crawl: 1.2,      // crawl speed (m/s)
  reach: 2.6,      // a reviver starts the channel within this (m) of the body
  leash: 3.6,      // ...and breaks it by moving further than this
  channel: 2.5,    // base revive channel (s)
  extra: 0.5,      // each earlier revive of the same player in this fight adds this much of `channel`
  fightGap: 30,    // s without taking damage before the next drop counts as a new fight (the count resets)
  hp: 0.35,        // revived at this fraction of max HP
  iframe: 1.2,     // s of invulnerability after getting up
  heal: 0.4,       // a Cleric Heal on the downed ally during the channel: this fraction of the channel done at once
  heavy: 0.12,     // the reviver loses the channel to a hit of at least this fraction of their max HP (or a boss big hit)
  hitBleed: 4,     // a hit on a downed player takes (hit / max HP) × this many seconds off the bleed-out,
  hitBleedMin: 0.25, hitBleedMax: 1.5, // ...within these bounds (s)
  bossThreat: 0.2, // going down cuts your threat on bosses (and their hounds) to this fraction: they prefer standing players
};

// Revive time for a player already revived n times this fight.
export const reviveTime = (n = 0) => DOWNED.channel * (1 + DOWNED.extra * Math.max(0, n));

// Bots by capability level (shared/botskill.js): delay (s) before a bot reacts to a partymate going down, and the
// chance it ignores telegraphs while channelling (keeps reviving inside a red circle).
export const BOT_REVIVE = {
  5: { delay: [0.1, 0.3], careless: 0 },
  4: { delay: [0.4, 0.9], careless: 0.08 },
  3: { delay: [0.8, 1.8], careless: 0.2 },
  2: { delay: [1.5, 3], careless: 0.4 },
  1: { delay: [2.5, 5], careless: 0.65 },
};
