// Enemies that force a role (docs/briefs/combat-quickwins.md 2). Appended to MOBS / MOB_IDS in shared/data.js after
// every other table (append only, never reorder: the index is wire format). No imports (data.js imports this).
//   plate: damage taken is cut by this share until its posture Breaks; while Broken it takes x plateBroken (Ironhide Boar).
//   shell / shellArc / shieldBreak: a front shield (server/floor2.js f2DamageMod) over shellArc radians either side of
//     its facing; a Break drops the shield for shieldBreak s (Mire Bulwark).
//   aloft / swoopHit: a flyer (the harpy AI) that takes x aloft from close hits while it hovers; swoopHit: close hits
//     land fully during its swoop and from a jumping attacker (Gale Harrier).
//   caster: channels a heal on its allies (server/mobroles.js f2Hexer, HEXER); interrupting it stuns it (Mire Hexer).
//   look / lookScale / lookTint: the client draws this existing model, scaled and tinted (no new art).
export const ROLE_MOB_IDS = ['ironboar', 'bulwark', 'hexer', 'harrier'];
export const ROLE_MOBS = {
  ironboar: { name: 'Ironhide Boar', hp: 300, atk: 11, speed: 4.0, aggro: 9, range: 1.9, atkCd: 1.8, xp: 55, radius: 1.0, level: 5, plate: 0.7, plateBroken: 1.25,
    look: 'boar', lookScale: 1.25, lookTint: 0x9ca3af },
  bulwark: { name: 'Mire Bulwark', hp: 900, atk: 28, speed: 3.2, aggro: 10, range: 2.6, atkCd: 2.2, xp: 130, radius: 1.3, level: 14, f2: true, ai: 'f2Brute',
    shell: 0.15, shellArc: 1.3, shieldBreak: 6, turn: 1.3, look: 'shieldback', lookScale: 1.15, lookTint: 0x94a3b8 },
  hexer: { name: 'Mire Hexer', hp: 420, atk: 22, speed: 3.4, aggro: 15, range: 13, atkCd: 3.6, xp: 120, radius: 0.8, level: 14, f2: true, ai: 'f2Hexer', ranged: true, caster: true,
    look: 'thrall', lookScale: 0.95, lookTint: 0xc084fc },
  harrier: { name: 'Gale Harrier', hp: 640, atk: 32, speed: 6.0, aggro: 16, range: 2.4, atkCd: 1.6, xp: 230, radius: 0.85, level: 23, f3: true, ai: 'f3Harpy', fly: true,
    aloft: 0, swoopHit: true, look: 'harpy', lookScale: 0.9, lookTint: 0x7dd3fc },
};
export const ROLE_BITE = { ironboar: [2.8, 0.75], bulwark: [3.2, 0.8] }; // [reach, half-angle]

// Floor 1's field (Floors 2 and 3: F2_SPAWNS / F3_SPAWNS): [type, count, x range, z range]
export const F1_ROLE_SPAWNS = [['ironboar', 3, [-50, 50], [70, 92]]];

// The Mire Hexer: keeps its distance, throws a hex circle, and every `every` s channels a heal (`channel` s, a ring
// telegraph of radius r) that restores `heal` of max health to every other mob within r. Interrupted (stunned, Broken,
// an interrupting hit, a knock-back that cancels wind-ups, or `breakHits` hits during the channel): stunned `stun` s.
export const HEXER = { keep: [7, 12], leash: 24, every: 10, first: 3, channel: 2.4, r: 12, heal: 0.25, breakHits: 3, stun: 2.5, boltWind: 1.4, boltR: 2.4, boltMult: 1.3 };
