// Warden twists: a random fight modifier rolled each time the Horned Warden spawns.
// Shared by the server (behaviour, rewards) and the client (banner, gate panel, boss bar, visuals).
// reward: { loot: extra Rare+ item rolls per player, gold: extra fraction of the Warden's gold drop }

export const TWISTS = {
  packmaster: {
    name: 'Packmaster', color: '#fb923c',
    desc: 'Hounds from the first second, up to 5 at once, and they frenzy on the Warden\'s howl.',
    short: 'Hounds from the start, up to 5, frenzied',
    reward: { loot: 1 },
    hounds0: { first: 4, every: 20, n: 2 },     // phase-1 hounds (before the usual phase-2 pack)
    hounds: { every: 18, n: 3, max: 5 },        // replaces WARDEN.hounds
    frenzy: { first: 10, every: 14, d: 5 },
  },
  twinhorns: {
    name: 'Twin Horns', color: '#fca5a5',
    desc: 'Horn charges come in pairs (the second re-aims at someone new) and start in phase 1.',
    short: 'Horn charges in pairs, from phase 1',
    reward: { gold: 0.5 },
    first: 7, gap: 0.15,                        // first charge (s after engage), pause between the pair
  },
  quaking: {
    name: 'Quaking', color: '#fbbf24',
    desc: 'Every ground slam leaves cracked ground for 6 s (standing in it hurts), and every Quake Ring volley has one more ring.',
    short: 'Slams crack the ground, one more Quake Ring',
    reward: { gold: 0.5 },
    crack: { d: 6, rk: 0.75, tick: 0.5, mult: 0.3 }, // duration, radius vs slam, tick, damage per tick (x Warden atk)
    rings: 1,                                   // extra Quake Rings per volley
  },
  thornbound: {
    name: 'Thornbound', color: '#a3e635',
    desc: 'The Warden raises Thorn Totems at the chamber edge. They shoot thorns until you break them.',
    short: 'Thorn Totems at the edge: break them',
    reward: { loot: 1 },
    totems: { first: 8, every: 24, n: 2, max: 3, life: 45, dist: 17.5 },
  },
  ironhide: {
    name: 'Ironhide', color: '#cbd5e1',
    desc: 'Takes 40% less damage unless Broken. Broken windows last longer: Break it, then Switch.',
    short: '40% less damage unless Broken',
    reward: { loot: 1 },
    taken: 0.6, breakBonus: 1.6,                // damage taken outside a Break; seconds added to each boss Break
  },
  berserk: {
    name: 'Berserk', color: '#f87171',
    desc: 'Enraged from the start: every phase-3 attack at once, but 25% less health.',
    short: 'Enraged from the start, 25% less health',
    reward: { loot: 1, gold: 0.5 },
    hp: 0.75,
  },
  eclipse: {
    name: 'Eclipse', color: '#a5b4fc',
    desc: 'The chamber goes dark and every telegraph gives 15% less warning.',
    short: 'Darkness, faster telegraphs',
    reward: { loot: 2, gold: 1 },
    wind: 0.85,
  },
  echo: {
    name: 'Echo', color: '#d8b4fe',
    desc: 'Every slam and rockfall strikes again in the same spot 1.5 s later.',
    short: 'Slams and rockfall strike twice',
    reward: { loot: 1 },
    delay: 1.5,
  },
};

export const TWIST_IDS = Object.keys(TWISTS);

// Thorn Totem (Thornbound): a stone-tinted Bramble Spitter that lives only in the chamber.
export const TOTEM = { name: 'Thorn Totem', hp: 110, hpPer: 35, atk: 9, speed: 0, aggro: 40, range: 20, atkCd: 2.8, xp: 10, radius: 0.9, level: 9, ranged: true };

export function rewardText(id) {
  const r = TWISTS[id]?.reward;
  if (!r) return '';
  const out = [];
  if (r.loot) out.push(`+${r.loot} loot roll${r.loot > 1 ? 's' : ''}`);
  if (r.gold) out.push(`+${Math.round(r.gold * 100)}% gold`);
  return out.join(', ');
}

// Pick a twist at random, never the same one twice in a row. `force` (WARDEN_TWIST) wins if valid.
export function rollTwist(prev, force) {
  if (force && TWISTS[force]) return force;
  const pool = TWIST_IDS.filter(id => id !== prev);
  return pool[Math.floor(Math.random() * pool.length)];
}
