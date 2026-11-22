// Duels (docs/briefs/duels.md): solo or team PvP between characters, bots and the Named included. Nobody dies in a
// duel: a duelist is "out" when the rule says so, and everyone gets back the health they started with at the end.
// The server (server/duels.js) puts a stand-in "duelist" mob on each fighter so every attack in the game can hit an
// opponent the way it hits a monster; the client and the bots only ever see their own opponents' stand-ins.

// Win rules. floor: the health fraction you're out at (0: at 1 health, never 0); first: any hit that takes health
// puts you out (a dodge, parry or shield that stops it all doesn't count).
export const DUEL_RULES = {
  first: { name: 'First Strike', floor: 0, first: true, desc: 'The first clean hit wins.' },
  half: { name: 'Half Health', floor: 0.5, desc: 'Out at half health.' },
  last: { name: 'Last Stand', floor: 0, desc: 'Out at 1 health. Nobody dies.' },
};
export const DUEL_RULE_IDS = ['first', 'half', 'last'];
export const DUEL_DEFAULT = 'half';

export const DUEL = {
  askRange: 30,       // m: how near you must be to challenge someone (same floor)
  askFor: 30,         // s: a challenge waits this long for an answer
  askGap: 4,          // s: between two challenges from one player
  botAnswer: [1, 2.5],// s: a bot or one of the Named answers after this long
  count: 3,           // s: the countdown (no hits count until FIGHT)
  time: { solo: 120, team: 180 }, // s: then the duel ends on the clock (see decideOnTime)
  ring: { solo: 22, team: 32 },   // m: the duel ring's radius around its centre
  grace: 2,           // s: outside the ring this long and you're out (forfeit)
  spread: 7,          // m: team duels: each side lines up this far from the centre
  pvp: 0.25,          // player damage against a player, vs its damage against a monster
  linger: 4,          // s: the result stays on screen
};

// The stand-in mob (appended to MOBS / MOB_IDS after the trap objects, so earlier indices never move).
export const DUEL_MOB_IDS = ['duelist'];
export const DUEL_MOBS = {
  duelist: { name: 'Duelist', hp: 100, atk: 0, speed: 0, aggro: 0, range: 0, atkCd: 99, xp: 0, radius: 0.55, level: 1, duel: true, ai: 'duelTick' },
};

// The clock ran out: the side with more fighters still in wins; level on that, the higher share of health left (of
// the health above the rule's floor); level on that too: a draw. sides: [[{ hp, maxHp, out }], [...]].
export function decideOnTime(sides, floor = 0) {
  const inN = s => s.filter(f => !f.out).length;
  const [a, b] = sides.map(inN);
  if (a !== b) return a > b ? 0 : 1;
  const share = s => { const live = s.filter(f => !f.out); return live.length ? live.reduce((t, f) => t + Math.max(0, f.hp / f.maxHp - floor), 0) / live.length : 0; };
  const [ha, hb] = sides.map(share);
  if (Math.abs(ha - hb) < 0.01) return -1;
  return ha > hb ? 0 : 1;
}

// Snapshot rows (w.du): [duel id, rule index, state (0 countdown, 1 fighting, 2 over), s left, centre x, centre z,
// ring r, [[player id, side 0/1, stand-in mob id, out 0/1], ...], winning side (-1 draw, null while on)].
export function readDuels(list) {
  return (list || []).map(r => ({
    id: r[0], rule: DUEL_RULE_IDS[r[1]], state: r[2], left: r[3], x: r[4], z: r[5], r: r[6],
    fighters: r[7].map(f => ({ id: f[0], side: f[1], mob: f[2], out: !!f[3] })), won: r[8] ?? null,
  }));
}
// Who I'm fighting: the stand-in mob ids of my live opponents (empty when I'm in no live duel).
export function foeMobs(duels, me) {
  const out = new Set();
  for (const d of duels) {
    const mine = d.fighters.find(f => f.id === me);
    if (!mine || mine.out || d.state !== 1) continue;
    for (const f of d.fighters) if (f.side !== mine.side && !f.out && f.mob) out.add(f.mob);
  }
  return out;
}
// "/duel Name", "/duel Name team last", "/duel accept" ... → { op, name, rule, team } (null: not a duel command).
export function parseDuelChat(text) {
  const m = String(text || '').trim().match(/^\/(duel|yield|forfeit)\b\s*(.*)$/i);
  if (!m) return null;
  if (m[1].toLowerCase() !== 'duel') return { op: 'yield' };
  const words = m[2].trim().split(/\s+/).filter(Boolean);
  const head = (words[0] || '').toLowerCase();
  if (!words.length || head === 'help') return { op: 'help' };
  if (['accept', 'yes', 'decline', 'no', 'yield', 'forfeit', 'cancel'].includes(head)) return { op: head === 'yes' ? 'accept' : head === 'no' ? 'decline' : head === 'forfeit' ? 'yield' : head };
  let rule = DUEL_DEFAULT, team = false;
  const rest = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (DUEL_RULE_IDS.includes(lw)) rule = lw;
    else if (lw === 'team') team = true;
    else if (lw === 'solo') team = false;
    else rest.push(w);
  }
  return { op: 'ask', name: rest.join(' '), rule, team };
}
export const DUEL_HELP = [
  'Duels: /duel <name> challenges someone nearby (Half Health). Add first, half or last for the rule, and team for a party vs party duel.',
  'First Strike: the first clean hit wins. Half Health: out at half health. Last Stand: out at 1 health. Nobody dies, and everyone gets their health back after.',
  '/duel accept, /duel decline, /yield to give up. Stay inside the ring or you forfeit.',
];
