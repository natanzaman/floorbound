// Rescue mechanics (docs/ROADMAP.md J1): a boss traps one player and the others free them. Tuning shared by the server
// (server/rescue.js), the client (public/rescue.js) and the bots (shared/bots/rescue.js).
//
// Traps are boss team moves (shared/bossteam.js lists them in each boss's rotation; forceBossMove takes their names).
// A trap needs `minFree` free fighters (standing, not trapped) in the room, never picks the boss's current target, and
// releases harmlessly as soon as no free ally is left to rescue (solo, or a duo whose partner went down).
// The trapped player carries p.trap; bosses don't target trapped players (server/threat.js targetOf).
//
// Trap objects are mobs flagged `prop` (RESCUE_MOBS, appended to MOBS in data.js): they take hits and have an HP bar,
// but give no threat, XP, loot, posture or mastery, can't be taunted and never count as kills.
export const TRAP_MOVES = ['vines', 'pillar', 'crystal'];
export const TRAP_OF = { warden: 'vines', sovereign: 'pillar', colossus: 'crystal' }; // each boss's v1 trap

export const RESCUE = {
  minFree: 2,   // free fighters in the room before a trap can start (the victim is one of them)
  gap: 8,       // s between two team-scale mechanics on one boss (G4 moves, traps, Overload)
  ownHit: 0.25, // the trapped player's own hits on their trap object do this fraction (slowly freeing yourself)
  channel: 2,   // after a trap lands the boss's big telegraphed attacks wait this long (+ BOSSTEAM.channel): time to react
  // Hits it takes to break a trap object: hp = hits × the free allies' average attack × helpers^helpExp, where helpers
  // are the free allies other than the boss's target (so it reads the same at every level and party size). Hold E (vines): a partymate within `reach` m channels `hold` s (moving past `leash`, acting or
  // a heavy hit breaks it; the progress fades like a revive's).
  vines: {
    name: 'Thornbind', wind: 1.4, hits: 3, max: 14, tick: 0.5, dot: 0.018, // root + dot × max HP every tick
    hold: 1.5, reach: 2.6, leash: 3.6,
  },
  // Drowning Pillar: the victim is pinned in a column of moonlit water fed by an orb `src` m away. Breaking the orb
  // ends it; a Guardian body-blocks it by Covering the victim (ends it at once) or by guarding on the line between the
  // orb and the victim (no ticks while blocked; `block` s of it ends it).
  pillar: {
    name: 'Drowning Pillar', wind: 1.6, hits: 3.5, max: 12, tick: 0.5, dot: 0.026,
    src: [12, 17], block: 1.6, lane: 1.4, // lane: how close to the orb→victim line a guarding Guardian must stand (m)
  },
  // Storm crystal: the victim is encased (can't act, can't be hurt by the boss) inside a crystal; break it within `fuse`
  // s or it detonates, hitting every fighter in the room for `boom` × max HP (the victim too).
  crystal: {
    name: 'Storm Crystal', wind: 1.3, hits: 4, fuse: 8, boom: 0.32,
  },
};

// Prop mob types (appended to MOB_IDS / MOBS after Floor 3's, so earlier indices never move). hp is set per trap.
export const RESCUE_MOB_IDS = ['vine', 'tideorb', 'stormcrystal'];
export const HELP_EXP = 0.7;
const PROP = { atk: 0, speed: 0, aggro: 0, range: 0, atkCd: 99, xp: 0, prop: true, ai: 'propTick' };
export const RESCUE_MOBS = {
  vine: { ...PROP, name: 'Thornbind Vines', hp: 100, radius: 0.9, level: 10 },
  tideorb: { ...PROP, name: 'Drowning Orb', hp: 100, radius: 1.0, level: 18 },
  stormcrystal: { ...PROP, name: 'Storm Crystal', hp: 100, radius: 1.1, level: 30 },
};
export const PROP_OF = { vines: 'vine', pillar: 'tideorb', crystal: 'stormcrystal' };

// Snapshot rows (w.trap): [player id, kind index in TRAP_MOVES, s left, hold-E progress 0-1, freer id, prop mob id,
// blocked 0/1]. Read by the client and the bots.
export const readTraps = list => new Map((list || []).map(r => [r[0], { k: TRAP_MOVES[r[1]], left: r[2], prog: r[3], by: r[4], prop: r[5], blocked: !!r[6] }]));

// Bots by capability (shared/botskill.js): delay (s) before reacting to a trapped ally, and the chance a bot keeps
// hitting the boss instead of helping (decided once per trap).
export const BOT_RESCUE = {
  5: { delay: [0.2, 0.5], ignore: 0 },
  4: { delay: [0.5, 1.1], ignore: 0.1 },
  3: { delay: [1, 2], ignore: 0.25 },
  2: { delay: [1.8, 3.2], ignore: 0.45 },
  1: { delay: [2.8, 5], ignore: 0.65 },
};
