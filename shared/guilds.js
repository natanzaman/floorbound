// Guilds (docs/briefs/guilds.md): data and pure rules, shared by the server (server/guilds.js) and the client
// (public/guilds.js). Ranks, permissions, name rules, weekly quests, guild levels and perks.

export const GUILD = {
  fee: 300,          // gold to found a guild
  maxMembers: 50,    // players, bots and the Named together
  vault: 20,         // vault slots at level 1 (perks add more)
  vaultMax: 40,
  botRate: 0.25,     // a bot's or one of the Named's quest progress counts this much (bots alone can't farm it)
  inviteFor: 60,     // s an invite waits
  botAnswer: [1, 2], // s before a bot or one of the Named answers an invite (they accept)
  goldMax: 10_000_000,
};

// Registrar: the door of the south-east house of the plaza in the Town of Beginnings (no new art; a label like the Smith's).
export const REGISTRAR = { x: 12.6, z: -9.5, r: 2.5 };
export const nearRegistrar = (x, z, pad = 1) => Math.hypot(x - REGISTRAR.x, z - REGISTRAR.z) < REGISTRAR.r + pad;

export const RANKS = [
  { id: 'member', name: 'Member' },
  { id: 'officer', name: 'Officer' },
  { id: 'leader', name: 'Leader' },
];
export const RANK = { member: 0, officer: 1, leader: 2 };
// The lowest rank that may do each action.
export const GUILD_PERMS = {
  invite: 1, kick: 1, withdraw: 1, take: 1,
  promote: 2, demote: 2, transfer: 2, disband: 2,
  deposit: 0, store: 0, chat: 0, leave: 0,
};
export const can = (rank, action) => (rank | 0) >= (GUILD_PERMS[action] ?? 99); // an unknown action: nobody

// Names: 3-20 characters, letters, digits, single spaces, ' and -; first and last a letter or digit. Tags: 2-4 letters.
export const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9'-]| (?! ))*[A-Za-z0-9]$/;
export function cleanGuildName(raw) {
  const s = String(raw ?? '').trim();
  if (s.length < 3 || s.length > 20) return { error: 'A guild name has 3 to 20 characters.' };
  if (!NAME_RE.test(s)) return { error: "A guild name uses letters, numbers, single spaces, ' and - (starting and ending with a letter or number)." };
  return { name: s };
}
export function cleanGuildTag(raw) {
  const s = String(raw ?? '').trim();
  if (!/^[A-Za-z]{2,4}$/.test(s)) return { error: 'A guild tag is 2 to 4 letters.' };
  return { tag: s.toUpperCase() };
}

// ---------- levels and perks ----------
// Guild XP needed for each level (index = level - 1).
export const GUILD_LEVELS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];
export const GUILD_MAX_LEVEL = GUILD_LEVELS.length;
export const guildLevel = xp => { let l = 1; for (let i = 0; i < GUILD_LEVELS.length; i++) if (xp >= GUILD_LEVELS[i]) l = i + 1; return l; };
export const nextLevelXp = lvl => GUILD_LEVELS[lvl] ?? null; // null: max level
// vault: + slots; xp: + XP share when grouped with a guildmate; quest: + quest rewards. Summed over the reached levels.
export const GUILD_PERKS = [
  { lvl: 2, vault: 5, text: '+5 vault slots' },
  { lvl: 3, xp: 0.05, text: '+5% XP when grouped with a guildmate' },
  { lvl: 4, quest: 0.1, text: '+10% guild quest rewards' },
  { lvl: 5, vault: 5, text: '+5 vault slots' },
  { lvl: 6, xp: 0.02, text: '+2% more XP with a guildmate (7%)' },
  { lvl: 7, quest: 0.15, text: '+15% more guild quest rewards (25%)' },
  { lvl: 8, vault: 5, text: '+5 vault slots' },
  { lvl: 9, xp: 0.03, text: '+3% more XP with a guildmate (10%)' },
  { lvl: 10, vault: 5, text: '+5 vault slots (40)' },
];
export function perksAt(lvl) {
  const out = { vault: GUILD.vault, xp: 0, quest: 0 };
  for (const p of GUILD_PERKS) if (lvl >= p.lvl) { out.vault += p.vault || 0; out.xp += p.xp || 0; out.quest += p.quest || 0; }
  out.vault = Math.min(GUILD.vaultMax, out.vault);
  out.xp = Math.round(out.xp * 1000) / 1000; out.quest = Math.round(out.quest * 1000) / 1000;
  return out;
}

// ---------- weekly quests ----------
// kind kill: { mobs?: [types], floor?: n, rare?: true } (the killer's kill); lab: a labyrinth keeper falls; boss: a
// floor boss falls with a member in the fight; switch: a member lands a Switch with a guildmate in their party.
export const GUILD_QUESTS = [
  { id: 'boars', kind: 'kill', mobs: ['boar'], n: 60, name: 'Boar Cull', desc: 'Defeat 60 Forest Boars', xp: 60, gold: 150 },
  { id: 'wolves', kind: 'kill', mobs: ['wolf', 'alpha'], n: 50, name: 'Wolf Season', desc: 'Defeat 50 wolves (Alphas count)', xp: 70, gold: 170 },
  { id: 'spitters', kind: 'kill', mobs: ['spitter'], n: 20, name: 'Spit and Polish', desc: 'Defeat 20 Bramble Spitters', xp: 60, gold: 150 },
  { id: 'hunt', kind: 'kill', n: 300, name: 'The Long Hunt', desc: 'Defeat 300 monsters anywhere', xp: 100, gold: 250 },
  { id: 'mire', kind: 'kill', floor: 2, n: 100, name: 'Into the Mire', desc: 'Defeat 100 monsters on Floor 2', xp: 110, gold: 280 },
  { id: 'gale', kind: 'kill', floor: 3, n: 100, name: 'Over the Spires', desc: 'Defeat 100 monsters on Floor 3', xp: 130, gold: 320 },
  { id: 'rare', kind: 'kill', rare: true, n: 2, name: 'Rare Game', desc: 'Defeat 2 rare named enemies', xp: 90, gold: 220 },
  { id: 'lab', kind: 'lab', n: 2, name: 'Keys of the Deep', desc: 'Clear a labyrinth (defeat its keeper) twice', xp: 120, gold: 300 },
  { id: 'boss', kind: 'boss', n: 1, name: 'Floor Breakers', desc: 'Beat a floor boss with a guildmate in the fight', xp: 150, gold: 400 },
  { id: 'switch', kind: 'switch', n: 25, name: 'Switch!', desc: 'Land 25 Switches in a party with a guildmate', xp: 90, gold: 220 },
];
export const QUEST_BY_ID = Object.fromEntries(GUILD_QUESTS.map(q => [q.id, q]));
export const QUESTS_PER_WEEK = 3;

// Weeks start Monday 00:00 UTC (1970-01-01 was a Thursday).
export const weekOf = ms => Math.floor((ms / 86400000 + 3) / 7);
export const weekStart = week => (week * 7 - 3) * 86400000;

// The week's quests for a guild: QUESTS_PER_WEEK different ones, at most one per kind until the kinds run out,
// from a seed of (guild id, week). Deterministic.
export function drawQuests(gid, week) {
  let s = ((gid | 0) * 2654435761 + (week | 0) * 40503 + 12345) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pool = [...GUILD_QUESTS], out = [], kinds = new Set();
  while (out.length < QUESTS_PER_WEEK && pool.length) {
    const fresh = pool.filter(q => !kinds.has(q.kind)), from = fresh.length ? fresh : pool;
    const q = from[Math.floor(rnd() * from.length)];
    pool.splice(pool.indexOf(q), 1); kinds.add(q.kind);
    out.push({ id: q.id, got: 0, done: false });
  }
  return out;
}

// Does this event count toward this quest? ev: { kind, mob, floor, rare }
export function questMatches(q, ev) {
  if (!q || q.kind !== ev.kind) return false;
  if (q.kind !== 'kill') return true;
  if (q.mobs && !q.mobs.includes(ev.mob)) return false;
  if (q.floor && q.floor !== ev.floor) return false;
  if (q.rare && !ev.rare) return false;
  return true;
}
// A quest's reward with the guild's quest perk.
export const questReward = (q, lvl) => { const b = 1 + perksAt(lvl).quest; return { xp: Math.round(q.xp * b), gold: Math.round(q.gold * b) }; };
