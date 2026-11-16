// Titles: earned from lifetime per-character stats, shown under the name on nameplates and frames.
// Shared by the server (awarding) and the client (names, colours, requirements, progress).

// The Hall of Clearers: a stone board in the Town of Beginnings (mirrors the merchant at x:9).
export const HALL = { x: -9, z: 3, r: 3.5 };

export const STAT_KEYS = ['kills', 'boarKills', 'wolfKills', 'switches', 'deaths', 'wardenKills', 'lastAttacks', 'floorClearsFirst', 'flawlessWarden', 'maxLvl', 'floor2', 'sovereignKills'];

export function newStats(raw) {
  const s = {};
  for (const k of STAT_KEYS) s[k] = Math.max(0, Number(raw?.[k]) | 0);
  s.titles = Array.isArray(raw?.titles) ? raw.titles.filter(id => TITLE_BY_ID[id]) : [];
  s.activeTitle = raw?.activeTitle && s.titles.includes(raw.activeTitle) ? raw.activeTitle : null;
  return s;
}

// need: [stat key, amount]. "Newcomer" is the default (no title).
export const TITLES = [
  { id: 'veteran', name: 'Veteran', color: '#93c5fd', need: ['maxLvl', 10], req: 'Reach level 10' },
  { id: 'warden_slayer', name: 'Warden Slayer', color: '#f87171', need: ['wardenKills', 1], req: 'Help defeat the Horned Warden' },
  { id: 'last_attacker', name: 'Last Attacker', color: '#fbbf24', need: ['lastAttacks', 1], req: 'Land the Last Attack on the Warden' },
  { id: 'undying', name: 'Undying', color: '#f0abfc', need: ['flawlessWarden', 1], req: 'Defeat the Warden without dying in the fight' },
  { id: 'switch_master', name: 'Switch Master', color: '#67e8f9', need: ['switches', 50], req: 'Land 50 Switches' },
  { id: 'boarbane', name: 'Boarbane', color: '#fdba74', need: ['boarKills', 100], req: 'Slay 100 Forest Boars' },
  { id: 'wolfsbane', name: 'Wolfsbane', color: '#cbd5e1', need: ['wolfKills', 100], req: 'Slay 100 Dire Wolves' },
  { id: 'mirebreaker', name: 'Mirebreaker', color: '#5eead4', need: ['sovereignKills', 1], req: 'Help defeat the Drowned Sovereign (Floor 2)' },
  { id: 'frontliner', name: 'Frontliner', color: '#fde047', need: ['floorClearsFirst', 1], req: "Be part of the server's first-ever Floor 1 clear" },
];
export const TITLE_BY_ID = Object.fromEntries(TITLES.map(t => [t.id, t]));
export const DEFAULT_TITLE = 'Newcomer';

export const titleProgress = (t, s) => [Math.min(s?.[t.need[0]] || 0, t.need[1]), t.need[1]];
export const meetsTitle = (t, s) => (s?.[t.need[0]] || 0) >= t.need[1];
