// Player-owned bots ("Bots in game"): the setups, behaviours, capability labels and premade loadouts.
// Shared by the server (server/playerbots.js applies them) and the client (public/playerbots.js shows them).
// Everything is derived from CLASSES / BRANCHES, so classes added later appear automatically.
import { CLASSES, MAX_LEVEL } from './data.js';
import { MASTERY, BRANCHES } from './mastery.js';
import { BOT_SKILLS, BOT_SKILL_DEFAULT } from './botskill.js';

export const PLAYER_BOT_MAX = 3; // per player (the server reads PLAYER_BOT_MAX from the environment)

// What an owner can tell a bot to do. `behaviour` / `follow` are the BotManager settings each one maps to:
// 'stay' is a follower with no one to follow, so it holds its ground and only fights what comes close.
export const MODES = {
  follow: { name: 'Follow me', doing: 'Following', behaviour: 'follow', follow: true },
  field: { name: 'Farm nearby', doing: 'Farming the field', behaviour: 'field' },
  warden: { name: 'Go to the Warden', doing: 'Heading for the Warden', behaviour: 'warden' },
  stay: { name: 'Stay here', doing: 'Holding position', behaviour: 'follow', follow: false },
};
export const MODE_IDS = Object.keys(MODES);

// Capability 1-5 with short labels (shared/botskill.js).
export const SKILL_LEVELS = Object.keys(BOT_SKILLS).map(Number).sort((a, b) => a - b).map(v => ({ v, name: BOT_SKILLS[v].name }));
export const SKILL_DEFAULT = BOT_SKILL_DEFAULT;

// Premade setups: one per class, labelled by its role ("Tank · Guardian"). Tank, Healer, Damage first.
const ROLE_ORDER = ['Tank', 'Healer', 'Damage'];
export function setups() {
  return Object.entries(CLASSES)
    .map(([cls, c]) => ({ cls, role: c.role || 'Damage', label: `${c.role || 'Damage'} · ${c.name}` }))
    .sort((a, b) => (ROLE_ORDER.indexOf(a.role) + 1 || 9) - (ROLE_ORDER.indexOf(b.role) + 1 || 9));
}

// ---------- premade loadout by level ----------
// Gear rarity (0 Common .. 3 Epic), mastery level of every skill (points = what reaching it takes), and whether
// skills come evolved (Mastery 3+, default branch below).
export const LOADOUT = [
  // [from level, rarity, mastery]
  [1, 0, 1],
  [5, 1, 1],
  [6, 1, 2],
  [10, 2, 3],
  [15, 3, 3],
  [18, 3, 4],
  [25, 3, 5], // Floor 3 (level cap 30)
];
const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic'];
export function loadoutFor(lvl) {
  lvl = Math.max(1, Math.min(MAX_LEVEL, lvl | 0 || 1));
  let row = LOADOUT[0];
  for (const r of LOADOUT) if (lvl >= r[0]) row = r;
  const [, rarity, mastery] = row;
  return { lvl, rarity, rarityName: RARITY_NAMES[rarity], mastery, evolved: mastery >= MASTERY.evolveAt };
}

// Charm by role: Damage dealers want crits, tanks and healers want their cooldowns back sooner.
export const charmFor = role => (role === 'Tank' || role === 'Healer' || role === 'Support' ? 'haste' : 'crit');

// The evolution a bot picks: chosen for how the bot brain plays each skill; any other skill takes its co-op branch
// (Break -> Switch / helping the party), else A.
const DEFAULT_BRANCH = {
  rush: 'B', whirl: 'A', burst: 'B',     // Shoulder Charge, Vortex, Finisher
  taunt: 'B', wall: 'B', gslam: 'A',     // War Cry, Iron Skin (bots move a lot), Quake
  heal: 'A', bless: 'A', sanct: 'A',     // Renew, Zeal, Haven (Consecrate would stop the healing)
};
export function defaultBranch(skId) {
  if (DEFAULT_BRANCH[skId]) return DEFAULT_BRANCH[skId];
  const b = BRANCHES[skId];
  if (!b) return null;
  return b.B?.coop && !b.A?.coop ? 'B' : 'A';
}

// Bot names: 2-16 letters, numbers, spaces, _ . - (same rule as the admin page's rename).
export const cleanBotName = n => String(n || '').replace(/[^\w \-.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
