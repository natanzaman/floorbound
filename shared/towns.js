// Floor towns that grow, and their Stewards (plan: docs/briefs/towns.md). Data and pure rules, shared by the server
// (server/towns.js), the client (public/towns.js) and tests. Every number marked "guess" is a first guess for the owner.
//
// Each floor's town is a node: Camp → Village → Town → City, by town XP (STAGES). XP comes from play on that floor
// (TXP: kills, gathering, crafting, turn-ins, labyrinth and boss clears, donations, raids); bots and the Named earn it
// at BOT_RATE, and a quiet trickle (TRICKLE) keeps towns growing slowly on days nobody logs in. Projects (PROJECTS) are
// the town's next buildings: citizens, bots and the treasury fund them with gold and materials (plain ids in MATS),
// and each finished one gives its unlock (UNLOCKS) while the town is at least at that project's stage.
// Citizenship: one home town per character (COOLDOWN to move). Raids (RAID) come every few real days. Each town has a
// Steward, chosen once a cycle (ELECTION) by its floor's rule: Floor 1 by vote, Floor 2 by contribution, Floor 3 by a
// duel tournament. Bots and the Named vote by plain rules (botVote); a bot Steward governs by its agenda (AGENDAS).
import { MATS } from './crafting.js';

export const DAY = 86400e3, HOUR = 3600e3;

// ---------- the towns ----------
// board: the town board (interact: the Town panel). ward: the raid front (a banner just outside the safe zone; raiders
// march on it). raidFrom: where raiders gather (x range, z). gate: the Town-stage shortcut by the raid gate.
// trader: where a camp's trader sets up once its project is built (Floor 1 has the Merchant already).
export const TOWNS = {
  1: { floor: 1, name: 'Town of Beginnings', rule: 'vote', board: { x: 5, z: 11 }, ward: { x: 0, z: 31 }, raidFrom: { x: [-18, 18], z: 54 }, gate: { x: 8, z: 132 }, trader: null },
  2: { floor: 2, name: 'Mirelight Camp', rule: 'contrib', board: { x: 607, z: 10 }, ward: { x: 600, z: 23 }, raidFrom: { x: [586, 614], z: 46 }, gate: { x: 608, z: 132 }, trader: { x: 593, z: -9 } },
  3: { floor: 3, name: 'Windbreak Camp', rule: 'duel', board: { x: 1194, z: 10 }, ward: { x: 1200, z: 23 }, raidFrom: { x: [1186, 1214], z: 46 }, gate: { x: 1208, z: 126 }, trader: { x: 1207, z: -9 } },
};
export const TOWN_FLOORS = [1, 2, 3];
export const BOARD = { r: 0.8, use: 3.4 };   // the board post's collision radius; how close to stand to use it
export const TRADER = { r: 1.6, use: 4.5 };  // a camp trader's stall (reach like the Merchant's)
export const GATE_STONE = { r: 0.7 };
export const nearBoard = (x, z, pad = 0) => TOWN_FLOORS.find(f => Math.hypot(x - TOWNS[f].board.x, z - TOWNS[f].board.z) < BOARD.use + pad) || 0;
export const RULE_TEXT = { vote: 'chosen by vote', contrib: 'chosen by contribution (most given to town projects this cycle)', duel: 'chosen by a duel tournament between the candidates' };

// ---------- stages and XP ----------
export const STAGES = [ // xp: town XP to reach it (guess)
  { id: 'camp', name: 'Camp', xp: 0 },
  { id: 'village', name: 'Village', xp: 1500 },
  { id: 'town', name: 'Town', xp: 6000 },
  { id: 'city', name: 'City', xp: 18000 },
];
export const STAGE_MAX = STAGES.length - 1;
export const stageOf = xp => { let s = 0; for (let i = 0; i < STAGES.length; i++) if (xp >= STAGES[i].xp) s = i; return s; };
export const stageName = s => STAGES[Math.max(0, Math.min(STAGE_MAX, s | 0))].name;
// { stage, into, need } for the XP bar (need 0 at the top stage)
export function stageProgress(xp) {
  const s = stageOf(xp), lo = STAGES[s].xp, hi = STAGES[s + 1]?.xp;
  return { stage: s, into: xp - lo, need: hi === undefined ? 0 : hi - lo };
}

// Town XP per deed (guess). A deed by a bot or one of the Named counts BOT_RATE of it.
export const TXP = {
  kill: 1, elite: 4, rare: 10, boss: 80, lab: 30,     // a field kill, an elite, a rare, a floor boss, a labyrinth keeper
  gather: 1, craft: 2, request: 10, bounty: 25,       // a gathering, a meal / brew / Smith job, a Named request, a bounty turn-in
  donate: 20,                                         // 1 XP per this much gold value donated
  raidWin: 150, raidWave: 50,                         // a defended raid: this + per wave beaten
};
export const BOT_RATE = 0.25;
// The quiet trickle (XP and treasury gold an hour), so towns grow slowly with nobody online. Bot citizens: the Named
// whose home it is, and the free bots seen living there this cycle. Caught up after a restart for at most catchUp.
export const TRICKLE = { xp: 4, xpPerBot: 1, gold: 2, goldPerBot: 1, pledge: 40, catchUp: 72 * HOUR }; // pledge: gold a day each bot or Named candidate gives (their contribution)

// Raids (PvE only). A raid falls due every `every` days (random in the range; the first one `first` after a town is
// made); it only starts while a human is on that floor, after a `warn`, and never during a director show. Waves of
// that floor's mobs (RAID_MOBS) march on the ward with ground telegraphs; defend it to the end to win. The ward falls
// or time runs out: town XP is lost (lossFrac of the current stage's band), never more than one stage, never below
// Camp. Nobody human on the floor for `abandon` s: the raid withdraws with no result and comes back `retry` later.
export const RAID = {
  every: [2.5, 4], first: [1, 2],   // days (guess)
  warn: 60, tele: 3, waves: 3, gap: 30, limit: 420, abandon: 60, retry: 6 * HOUR, // s (retry: ms)
  wardHp: 3000, wardHpPer: 1200,   // the ward's health: base + per human on the floor
  perWave: [4, 2],                  // raiders a wave: base + per human on the floor (bots don't add)
  wardDmg: 1.0, lossFrac: 0.12,
};
export const RAID_MOBS = {
  1: { mobs: ['boar', 'wolf', 'spitter'], elite: 'alpha' },
  2: { mobs: ['thrall', 'shieldback', 'wisp'], elite: 'matron' },
  3: { mobs: ['ram', 'acolyte', 'sentinel'], elite: 'sentinel' },
};
// XP lost to a failed raid: a share of the current stage's band, never below the stage under the current one.
export function raidLoss(xp) {
  const s = stageOf(xp), lo = STAGES[Math.max(0, s - 1)].xp, band = (STAGES[s + 1]?.xp ?? STAGES[s].xp * 1.5) - STAGES[s].xp;
  const want = Math.round(Math.max(100, band * RAID.lossFrac));
  return Math.max(0, Math.min(want, xp - lo));
}
export const raidWinXp = waves => TXP.raidWin + TXP.raidWave * waves;
export const raidWaveSize = humans => RAID.perWave[0] + RAID.perWave[1] * Math.max(1, humans);
export const wardHpFor = humans => RAID.wardHp + RAID.wardHpPer * Math.max(1, humans);

// ---------- unlocks and projects ----------
// An unlock is active when its project is built and the town is at least at that project's stage.
export const UNLOCKS = {
  trader: { name: 'Trader', desc: 'A trader keeps a stall in camp (the Merchant\'s wares).' },
  stock: { name: 'Better stock', desc: 'The merchant here sells Rare gear and Moonroot seeds.' },
  bounty: { name: 'Bounty board', desc: 'Three daily bounties on this floor\'s monsters, for gold and town XP.' },
  garden: { name: 'Irrigation', desc: 'Citizens\' garden crops grow 15% faster while they play.', mult: 1.15 },
  gate: { name: 'Gate waystone', desc: 'A waystone by the raid gate: warp there from any awake waypoint.' },
  plot: { name: 'Guild quarter', desc: 'A plot for a guild hall (guilds come later).', plots: 1 },
  discount: { name: 'Market square', desc: 'Everyone pays 5% less at this town\'s merchant and Smith.', pct: 0.05 },
};
// Per floor, in the default build order. stage: the stage needed to start it; cost: gold and materials (ids in MATS).
export const PROJECTS = {
  1: [
    { id: 'f1bounty', unlock: 'bounty', name: 'Bounty Board', stage: 0, cost: { gold: 300, mats: { copper: 10, tusk: 10 } } },
    { id: 'f1stock', unlock: 'stock', name: 'Merchant\'s Storeroom', stage: 1, cost: { gold: 600, mats: { iron: 10, wheat: 15, pelt: 10 } } },
    { id: 'f1garden', unlock: 'garden', name: 'Irrigation Ditches', stage: 1, cost: { gold: 400, mats: { meadowleaf: 15, copper: 8 } } },
    { id: 'f1gate', unlock: 'gate', name: 'Gate Road Waystone', stage: 2, cost: { gold: 900, mats: { iron: 15, silver: 5, horn: 3 } } },
    { id: 'f1plot', unlock: 'plot', name: 'Guild Quarter', stage: 2, cost: { gold: 1200, mats: { iron: 20, wheat: 20 } } },
    { id: 'f1market', unlock: 'discount', name: 'Market Square', stage: 3, cost: { gold: 2000, mats: { silver: 10, core: 2 } } },
  ],
  2: [
    { id: 'f2trader', unlock: 'trader', name: 'Trader\'s Raft', stage: 0, cost: { gold: 300, mats: { carp: 10, mireblossom: 8 } } },
    { id: 'f2bounty', unlock: 'bounty', name: 'Bounty Post', stage: 1, cost: { gold: 600, mats: { silver: 6, carp: 10 } } },
    { id: 'f2stock', unlock: 'stock', name: 'Swamp Stores', stage: 1, cost: { gold: 700, mats: { eel: 6, iron: 10 } } },
    { id: 'f2gate', unlock: 'gate', name: 'Boardwalk Waystone', stage: 2, cost: { gold: 1000, mats: { silver: 12, mireblossom: 15 } } },
    { id: 'f2plot', unlock: 'plot', name: 'Guild Stilts', stage: 2, cost: { gold: 1300, mats: { iron: 20, carp: 20 } } },
    { id: 'f2market', unlock: 'discount', name: 'Lantern Market', stage: 3, cost: { gold: 2200, mats: { silver: 20, eel: 10 } } },
  ],
  3: [
    { id: 'f3trader', unlock: 'trader', name: 'Trader\'s Windbreak', stage: 0, cost: { gold: 400, mats: { skyfin: 6, galebloom: 6 } } },
    { id: 'f3bounty', unlock: 'bounty', name: 'Bounty Cairn', stage: 1, cost: { gold: 700, mats: { stormite: 6, skyfin: 8 } } },
    { id: 'f3stock', unlock: 'stock', name: 'Spire Stores', stage: 1, cost: { gold: 800, mats: { stormite: 10, galebloom: 10 } } },
    { id: 'f3gate', unlock: 'gate', name: 'Aqueduct Waystone', stage: 2, cost: { gold: 1100, mats: { stormite: 15, silver: 8 } } },
    { id: 'f3plot', unlock: 'plot', name: 'Guild Terrace', stage: 2, cost: { gold: 1400, mats: { stormite: 20, iron: 15 } } },
    { id: 'f3market', unlock: 'discount', name: 'Sky Market', stage: 3, cost: { gold: 2400, mats: { stormite: 25, skyfin: 10 } } },
  ],
};
export const PROJECT_BY_ID = Object.fromEntries(Object.values(PROJECTS).flat().map(pr => [pr.id, pr]));
export const projectOf = id => (Object.hasOwn(PROJECT_BY_ID, id) ? PROJECT_BY_ID[id] : null);
// Gold value of a donated material (contribution and donation XP).
export const MAT_VALUE = { core: 25, horn: 15, prism: 30, ess: 10, fang: 8, eel: 8, silver: 8, stormite: 10, skyfin: 8, galebloom: 8 };
export const matValue = id => MAT_VALUE[id] ?? 5;
export const costValue = c => (c.gold || 0) + Object.entries(c.mats || {}).reduce((s, [k, v]) => s + matValue(k) * v, 0);
// What a project still needs, given what it has: { gold, mats }.
export function projectNeed(pr, given = {}) {
  const mats = {};
  for (const [k, v] of Object.entries(pr.cost.mats || {})) { const left = v - (given.mats?.[k] || 0); if (left > 0) mats[k] = left; }
  return { gold: Math.max(0, (pr.cost.gold || 0) - (given.gold || 0)), mats };
}
export const projectDone = (pr, given) => { const n = projectNeed(pr, given); return n.gold <= 0 && !Object.keys(n.mats).length; };
// Projects a town may start now: at its stage, not built yet.
export const openProjects = (f, stage, done = []) => (PROJECTS[f] || []).filter(pr => pr.stage <= stage && !done.includes(pr.id));
// The unlocks active in a town: built projects at or under its stage. -> { kind: project }
export function activeUnlocks(f, stage, done = []) {
  const out = {};
  for (const pr of PROJECTS[f] || []) if (done.includes(pr.id) && pr.stage <= stage) out[pr.unlock] = pr;
  return out;
}
// The guild hall plot slots a town offers (hook for guilds: guilds.plot, later).
export const plotSlots = (f, stage, done = []) => (activeUnlocks(f, stage, done).plot ? UNLOCKS.plot.plots : 0);

// ---------- prices ----------
// Steward tax (+) or discount (-) at the town's merchant / Smith, within limits; a citizen's discount; the market's.
export const TAX = { min: -0.05, max: 0.10, step: 0.01 };
export const CITIZEN_DISCOUNT = 0.05;
export const PRICE_FLOOR = 0.8; // never below 80% of the list price
export const clampTax = v => Math.max(TAX.min, Math.min(TAX.max, Math.round((Number(v) || 0) / TAX.step) * TAX.step));
// The price multiplier at town f for a buyer (citizen of f or not), and the share that is tax (to the treasury) or
// subsidy (from the treasury: a Steward's discount is paid by the town while the treasury holds it).
export function priceMul({ tax = 0, citizen = false, market = 0, subsidyOk = true } = {}) {
  const t = tax < 0 && !subsidyOk ? 0 : tax;
  return Math.max(PRICE_FLOOR, 1 + t - (citizen ? CITIZEN_DISCOUNT : 0) - market);
}

// ---------- citizenship ----------
export const COOLDOWN = 7 * DAY; // between moves (the first home has none)
export const newCitizen = (raw = null) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const home = TOWN_FLOORS.includes(r.home | 0) ? r.home | 0 : 0;
  const bounty = r.bounty && typeof r.bounty === 'object' ? { day: r.bounty.day | 0, f: {} } : { day: 0, f: {} };
  for (const f of TOWN_FLOORS) {
    const b = r.bounty?.f?.[f];
    if (b && Array.isArray(b.prog)) bounty.f[f] = { prog: b.prog.slice(0, 3).map(v => Math.max(0, v | 0)), got: (b.got || []).slice(0, 3).map(v => (v ? 1 : 0)) };
  }
  return { home, moved: Math.max(0, +r.moved || 0), given: Math.max(0, +r.given || 0), bounty };
};
// '' or why not (now: ms)
export function moveBlock(c, f, now) {
  if (!TOWNS[f]) return 'No such town.';
  if (c.home === f) return `You already live in ${TOWNS[f].name}.`;
  if (c.home && now - c.moved < COOLDOWN) return `You can move again in ${fmtWait(COOLDOWN - (now - c.moved))}.`;
  return '';
}
export function fmtWait(ms) {
  const h = ms / HOUR;
  return h >= 48 ? `${Math.ceil(h / 24)} days` : h >= 1 ? `${Math.ceil(h)} hours` : `${Math.max(1, Math.ceil(ms / 60e3))} minutes`;
}

// ---------- bounties ----------
// Three a day per town (from the day, the same for everyone), once the bounty board is built.
export const BOUNTY_POOL = {
  1: [{ mob: 'boar', n: 12, gold: 60 }, { mob: 'wolf', n: 10, gold: 70 }, { mob: 'spitter', n: 6, gold: 70 }, { mob: 'alpha', n: 1, gold: 90 }, { mob: 'ironboar', n: 2, gold: 90 }],
  2: [{ mob: 'shieldback', n: 6, gold: 110 }, { mob: 'wisp', n: 6, gold: 110 }, { mob: 'lurker', n: 6, gold: 120 }, { mob: 'bulwark', n: 2, gold: 130 }, { mob: 'hexer', n: 2, gold: 130 }],
  3: [{ mob: 'ram', n: 6, gold: 160 }, { mob: 'harpy', n: 6, gold: 160 }, { mob: 'acolyte', n: 5, gold: 170 }, { mob: 'sentinel', n: 3, gold: 190 }, { mob: 'harrier', n: 2, gold: 180 }],
};
export const BOUNTY_N = 3;
export const BOUNTY_RESET_UTC = 10; // the same reset hour as the Named's daily caps
export const bountyDay = (now = Date.now()) => Math.floor((now - BOUNTY_RESET_UTC * HOUR) / DAY);
export function bountiesFor(f, day) {
  const pool = BOUNTY_POOL[f] || [], out = [], idx = pool.map((_, i) => i);
  let s = (day * 2654435761 + f * 40503) >>> 0;
  while (out.length < Math.min(BOUNTY_N, pool.length)) { s = (s * 1664525 + 1013904223) >>> 0; const k = s % idx.length; out.push(pool[idx.splice(k, 1)[0]]); }
  return out;
}

// ---------- elections ----------
export const ELECTION = { days: 7, candMax: 8, platMax: 90, msgMax: 120, minLvl: 5 }; // minLvl: to vote or stand (guess)
export const AGENDAS = {
  build: { name: 'Build', line: 'Build the next project fast.', prefer: ['trader', 'bounty', 'stock', 'garden', 'plot', 'gate', 'discount'], cheapest: true, tax: 0.05,
    msgs: ['Every coin goes to the next building. Bring ore.', 'Donate at the board: the next project is close.'] },
  defend: { name: 'Defend', line: 'Keep the walls strong against raids.', prefer: ['gate', 'bounty', 'trader', 'stock', 'plot', 'garden', 'discount'], tax: 0.03,
    msgs: ['Raiders come every few days. Be here when they do.', 'Hold the ward. Nobody gets left outside.'] },
  trade: { name: 'Trade', line: 'Lower prices at the market.', prefer: ['trader', 'stock', 'discount', 'bounty', 'garden', 'plot', 'gate'], tax: -0.03,
    msgs: ['Cheaper stock for citizens. Buy local.', 'The market is open. Trade here, not elsewhere.'] },
};
export const AGENDA_IDS = Object.keys(AGENDAS);
export const agendaOf = ag => (Object.hasOwn(AGENDAS, ag) ? AGENDAS[ag] : AGENDAS.build);
// Bot and Named candidates per town (1-2), with their agenda; npc: a citizen of the town who isn't a live bot.
export const BOT_CANDIDATES = {
  1: [{ key: 'n:halvard', named: 'halvard', ag: 'defend' }, { key: 'npc:odessa', name: 'Odessa', ag: 'build', title: 'the Quartermaster' }],
  2: [{ key: 'n:tovin', named: 'tovin', ag: 'trade' }, { key: 'npc:brannoc', name: 'Brannoc', ag: 'defend', title: 'the Ferryman' }],
  3: [{ key: 'n:sennet', named: 'sennet', ag: 'build' }, { key: 'n:cairn', named: 'cairn', ag: 'defend' }],
};
// The Named's home towns (they are citizens there) and how they lean when they vote.
export const NAMED_HOMES = { halvard: 1, maribel: 1, tovin: 2, sennet: 3, cairn: 3 };
export const NAMED_LEANS = { halvard: 'defend', maribel: 'build', tovin: 'trade', sennet: 'build', cairn: 'defend' };
export const LONERS = { cairn: 6 }; // the loner only votes when someone scores at least this with him
// Platforms when the AI mind is off (or out of budget): one line per agenda.
export const PLATFORMS = {
  build: ['Walls before words. I\'ll fund every project we can lift.', 'Give me a year and this camp gets a skyline.', 'Stone, timber, ore. Bring it and I\'ll build it.'],
  defend: ['Nobody gets left at the stop. The ward holds while I\'m here.', 'Raids come. We\'ll be ready when they do.', 'Every citizen home by dark. That\'s the whole platform.'],
  trade: ['Cheaper stock for citizens, and a market worth the walk.', 'Fair prices, full shelves, honest scales.', 'Let the coin flow and the town grows with it.'],
};
export const platformFor = (ag, seed = 0) => { const L = Object.hasOwn(PLATFORMS, ag) ? PLATFORMS[ag] : PLATFORMS.build; return L[Math.abs(seed | 0) % L.length]; };
export const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
export const hashStr = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const leanOf = name => AGENDA_IDS[hashStr(name) % AGENDA_IDS.length];

// A bot or Named voter's pick among the candidates, by plain rules: the agenda it leans to, friendship (the Named:
// friendship points with a player candidate), party time together this cycle (rapport, seconds), its creator, and
// what each candidate gave the town. voter: { key, lean, named?, creator?, fr: { candKey: pts }, rap: { candKey: s },
// min (loners: no vote unless someone reaches it) }. cands: [{ key, ag, contrib, at }]. -> candidate key or ''.
export const VOTE = { agenda: 3, frPer: 10, rapPer: 600, rapMax: 6, creator: 8, contribPer: 250, contribMax: 4 };
export function voteScore(v, c) {
  if (c.key === v.key) return 100; // a candidate votes for itself
  return (c.ag === v.lean ? VOTE.agenda : 0) + (v.fr?.[c.key] || 0) / VOTE.frPer + Math.min(VOTE.rapMax, (v.rap?.[c.key] || 0) / VOTE.rapPer)
    + (v.creator && v.creator === c.key ? VOTE.creator : 0) + Math.min(VOTE.contribMax, (c.contrib || 0) / VOTE.contribPer);
}
export function botVote(v, cands) {
  let best = null, bs = -1;
  for (const c of cands) {
    const s = voteScore(v, c);
    if (s > bs || (s === bs && best && ((c.contrib || 0) > (best.contrib || 0) || ((c.contrib || 0) === (best.contrib || 0) && (c.at || 0) < (best.at || 0))))) { best = c; bs = s; }
  }
  if (!best || (v.min && bs < v.min)) return '';
  return best.key;
}
// Count votes: { candKey: n }. Ties are broken by contribution, then who stood first.
export function tally(votes, cands) {
  const t = Object.fromEntries(cands.map(c => [c.key, 0]));
  for (const k of Object.values(votes)) if (Object.hasOwn(t, k)) t[k]++;
  return t;
}
const byContribThenAt = (a, b) => (b.contrib || 0) - (a.contrib || 0) || (a.at || 0) - (b.at || 0);
// The winner by the floor's rule (Floor 3's duel tournament is run by the server: this only seeds it).
export function pickByVote(cands, t) { return [...cands].sort((a, b) => (t[b.key] || 0) - (t[a.key] || 0) || byContribThenAt(a, b))[0]?.key || ''; }
export function pickByContrib(cands, t = {}) { return [...cands].sort((a, b) => byContribThenAt(a, b) || (t[b.key] || 0) - (t[a.key] || 0))[0]?.key || ''; }
// Single elimination: seeds by votes then contribution; a bye for the top seeds when the count isn't a power of two.
// -> rounds: [[[keyA, keyB | ''], ...], ...] (only the first round is filled; winners fill the next).
export function seedBracket(cands, t = {}) {
  const seeds = [...cands].sort((a, b) => (t[b.key] || 0) - (t[a.key] || 0) || byContribThenAt(a, b)).map(c => c.key);
  let size = 1; while (size < seeds.length) size *= 2;
  const first = [];
  for (let i = 0; i < size / 2; i++) first.push([seeds[i] || '', seeds[size - 1 - i] || '']);
  return first.filter(m => m[0] || m[1]);
}
// A match nobody can fight (both away): decided on paper, by level, what they gave and a fixed coin (never random:
// a restart gives the same result). a, b: { key, lvl, contrib }.
export function paperDuel(a, b, seed = 0) {
  const r = c => (c.lvl || 1) + (c.contrib || 0) / 200 + (hashStr(`${c.key}:${seed}`) % 100) / 100;
  return r(a) >= r(b) ? a.key : b.key;
}
// A bot Steward's choices by its agenda: the next project, the tax, the pinned message.
export function stewardProject(ag, open) {
  const A = agendaOf(ag);
  if (!open.length) return '';
  if (A.cheapest) return [...open].sort((a, b) => costValue(a.cost) - costValue(b.cost))[0].id;
  return [...open].sort((a, b) => A.prefer.indexOf(a.unlock) - A.prefer.indexOf(b.unlock))[0].id;
}
export const stewardTax = ag => clampTax(agendaOf(ag).tax);
export const stewardMsg = (ag, n = 0) => { const L = agendaOf(ag).msgs; return L[Math.abs(n) % L.length]; };

// The materials a donation may name: every known material id.
export const isMat = id => Object.hasOwn(MATS, id);
