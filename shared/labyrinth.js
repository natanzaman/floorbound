// Labyrinths (plan: docs/briefs/labyrinths.md): one before each floor's boss, each with its own style, look, traps and
// events. A labyrinth is three LAYERS joined by thresholds: an Approach that teaches its rule, the Depths that test it
// (the floor's event, a two-place puzzle, a noise-hearing enemy), and the Heart, where a mini-boss keeps the key to the
// boss gate (needed once per character).
//
// Floor 1's is the Undercrypt, a true dungeon maze under the Verdant Field: the Catacombs, the Drowning Galleries and
// the Ossuary, with the Gravekeeper and the Horn Key.
//
// Each layer is a grid of cells in its own patch of its floor's coordinate space (Floor 1's sit east of the field,
// x 120..250, so floorOf() still says Floor 1). Stairs (teleports) join the field, the layers and the boss gate. Walls
// are grid edges: walkable() asks walkLab(), so players, client prediction, mobs and bots all collide with them. Mobs
// and bots steer with labSteer() (a next-hop table over the cells).
//
// Every layer rolls its walls, traps, mobs and loot from separate seeds (a new trap never reshuffles the mobs, and the
// walls can stay while the rest changes). `braid` opens that share of dead ends into loops.
//
// Runtime state that changes walkability (the portcullis) is module state, set by the server and by clients and bots
// from the snapshot (applyLabSnap), like shared/arenas.js. This module imports nothing, so shared/data.js can import it.

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// ---------- the labyrinths ----------
// Per labyrinth: name, keyName, key (the stat counting this floor's keys), entry (the stair in the field: x, z, use
// reach, clear: trees kept off it), exitTo (where the Heart's stair up leaves you: before the boss gate), use (reach of
// the stairs inside), layers.
// Per layer:
//   x0, z0, cols, rows, cell, wall, height   the grid (walls straddle cell edges: a corridor is cell - wall wide)
//   seeds { walls, traps, mobs, loot }       separate rolls · braid: share of dead ends opened into loops
//   start, end                               cells: where you arrive, where the way on is (a stair, or the portcullis)
//   hall                                     [i0, j0, i1, j1]: cells opened into one room (the Heart is all hall)
//   traps                                    spike plates: n, cycle (s), warn / up (s), dmg (fraction of max HP)
//   water                                    flooded cells: n, slow (speed multiplier), loud (wading is noise)
//   mobs                                     [[type, count]] spread over the layer's cells (not start / end / hall)
//   loot                                     chests: n, onPath (share on the main route), cd (s before you can loot one again)
//   breathe                                  the floor's event (Depths): every [a, b] s, softening to x `press` after
//                                            `pressAfter` s in the layer (rising pressure, reset when it empties),
//                                            secs of guttering, rise (+1 at full pressure) dead per person, cap, ttl
//   levers                                   the two-place puzzle: open (s the portcullis stays up), solo (extra s)
//   torches                                  wall torches you can light (they stay lit for `lit` s)
//   keeper                                   the Heart's mini-boss (a mob type)
export const LABS = {
  1: {
    floor: 1, id: 'undercrypt', name: 'The Undercrypt', keyName: 'Horn Key', key: 'lab1Keys',
    entry: { x: -17, z: 141, use: 3.0, clear: 5 },
    exitTo: { x: 0, z: 146 },
    use: 3.0,
    layers: [
      {
        id: 'catacombs', name: 'The Catacombs', x0: 120, z0: 20, cols: 5, rows: 5, cell: 10, wall: 2, height: 4.2,
        seeds: { walls: 1103, traps: 2207, mobs: 3301, loot: 4409 }, braid: 0.5,
        start: [2, 0], end: [2, 4],
        traps: { n: 5, cycle: 4.5, warn: 1.2, up: 1.0, dmg: 0.14 },
        mobs: [['ghoul', 6]], loot: { n: 3, onPath: 0.25, cd: 600 }, torches: { lit: 900 },
      },
      {
        id: 'galleries', name: 'The Drowning Galleries', x0: 120, z0: 90, cols: 7, rows: 7, cell: 10, wall: 2, height: 4.6,
        seeds: { walls: 5507, traps: 6619, mobs: 7723, loot: 8837 }, braid: 0.2,
        start: [3, 0], end: [3, 6],
        traps: { n: 7, cycle: 4.0, warn: 1.1, up: 1.0, dmg: 0.16 },
        water: { n: 9, slow: 0.8, loud: true },
        mobs: [['ghoul', 8], ['tombwarden', 3]], loot: { n: 5, onPath: 0.25, cd: 600 }, torches: { lit: 900 },
        breathe: { every: [70, 110], first: [40, 60], press: 0.45, pressAfter: 300, secs: 10, rise: 2, type: 'ghoul', cap: 9, ttl: 45 },
        levers: { open: 45, solo: 6 },
      },
      {
        id: 'ossuary', name: 'The Ossuary', x0: 210, z0: 20, cols: 3, rows: 3, cell: 12, wall: 2, height: 6,
        seeds: { walls: 9901, traps: 9902, mobs: 9903, loot: 9904 }, braid: 0,
        start: [1, 0], end: [1, 2], hall: [0, 0, 2, 2],
        mobs: [], keeper: 'gravekeeper',
      },
    ],
  },
  // Floor 2: the Weeping Thicket, a drowned forest east of the Mire. Its walls are root tangles and deep water, and the
  // tide redraws it: every `shift.every` s the water turns, opening one set of ways (low tide: mud paths) and closing
  // the other (high tide: root bridges and lily rafts). The Drowned Wood's event is the wisps: a true one drifts toward
  // the way on, false ones into dead ends where lurkers wait.
  2: {
    floor: 2, id: 'thicket', name: 'The Weeping Thicket', style: 'thicket', keyName: 'Tide Key', key: 'lab2Keys', lureName: 'reed whistle',
    entry: { x: 583, z: 141, use: 3.0, clear: 5 },
    exitTo: { x: 600, z: 146 },
    use: 3.0,
    layers: [
      {
        id: 'reedmarch', name: 'The Reedmarch', x0: 780, z0: 20, cols: 5, rows: 5, cell: 10, wall: 2.4, height: 5,
        seeds: { walls: 2111, traps: 2213, mobs: 2317, loot: 2419 }, braid: 0.4,
        start: [2, 0], end: [2, 4],
        traps: { n: 4, cycle: 5.0, warn: 1.3, up: 1.0, dmg: 0.12 },
        water: { n: 6, slow: 0.8, loud: true },
        shift: { every: 75, n: 2, names: ['Low tide', 'High tide'] },
        mobs: [['mirelurker', 6]], loot: { n: 3, onPath: 0.25, cd: 600 }, torches: { lit: 900 },
      },
      {
        id: 'drownedwood', name: 'The Drowned Wood', x0: 780, z0: 90, cols: 7, rows: 7, cell: 10, wall: 2.4, height: 6,
        seeds: { walls: 2531, traps: 2633, mobs: 2737, loot: 2839 }, braid: 0.15,
        start: [3, 0], end: [3, 6],
        traps: { n: 5, cycle: 4.5, warn: 1.2, up: 1.0, dmg: 0.14 },
        water: { n: 12, slow: 0.75, loud: true },
        shift: { every: 55, n: 4, names: ['Low tide', 'High tide'] },
        mobs: [['mirelurker', 8], ['mosshag', 3]], loot: { n: 5, onPath: 0.25, cd: 600 }, torches: { lit: 900 },
        breathe: { kind: 'wisps', every: [55, 85], first: [25, 40], press: 0.5, pressAfter: 300, secs: 12, rise: 2, type: 'mirelurker', cap: 9, ttl: 40, wisp: 30 },
        levers: { open: 45, solo: 6 },
      },
      {
        id: 'heartwillow', name: 'The Heartwillow', x0: 860, z0: 20, cols: 3, rows: 3, cell: 12, wall: 2.4, height: 7,
        seeds: { walls: 2941, traps: 2943, mobs: 2947, loot: 2953 }, braid: 0,
        start: [1, 0], end: [1, 2], hall: [0, 0, 2, 2],
        mobs: [], keeper: 'motherofmire',
      },
    ],
  },
  // Floor 3: the Windrift Causeways, floating isles above the Gale Spires. No walls: the gaps are drops, the ways are
  // narrow bridges (`bridge`: half their width), and some spans swing between two places on a clock (`shift`). The wind
  // turns every `wind.every` s: it pushes you along bridges and slows you against it. The Turning Isles' event is the
  // squall: lightning strikes marked on the ground near everyone.
  3: {
    floor: 3, id: 'causeways', name: 'The Windrift Causeways', style: 'causeway', keyName: 'Storm Key', key: 'lab3Keys', lureName: 'storm chime',
    entry: { x: 1183, z: 141, use: 3.0, clear: 5 },
    exitTo: { x: 1200, z: 146 },
    use: 3.0,
    layers: [
      {
        id: 'kitesteps', name: 'The Kite Steps', x0: 1300, z0: 20, cols: 5, rows: 5, cell: 12, wall: 4, height: 0, bridge: 1.6,
        seeds: { walls: 3121, traps: 3223, mobs: 3327, loot: 3429 }, braid: 0.4,
        start: [2, 0], end: [2, 4],
        traps: { n: 4, cycle: 5.0, warn: 1.3, up: 1.0, dmg: 0.12 },
        shift: { every: 40, n: 2, names: ['Spans east', 'Spans west'] },
        wind: { every: 30, push: 1.6, seed: 7 },
        mobs: [['stormharpy', 6]], loot: { n: 3, onPath: 0.25, cd: 600 }, torches: { lit: 900 },
      },
      {
        id: 'turningisles', name: 'The Turning Isles', x0: 1300, z0: 100, cols: 6, rows: 6, cell: 12, wall: 4, height: 0, bridge: 1.5,
        seeds: { walls: 3531, traps: 3633, mobs: 3737, loot: 3839 }, braid: 0.2,
        start: [2, 0], end: [3, 5],
        traps: { n: 5, cycle: 4.5, warn: 1.2, up: 1.0, dmg: 0.14 },
        shift: { every: 30, n: 4, names: ['Spans east', 'Spans west'] },
        wind: { every: 22, push: 2.2, seed: 11 },
        mobs: [['stormharpy', 7], ['kiterider', 3]], loot: { n: 5, onPath: 0.25, cd: 600 }, torches: { lit: 900 },
        breathe: { kind: 'squall', every: [50, 75], first: [25, 40], press: 0.5, pressAfter: 300, secs: 10, rise: 3, type: 'stormharpy', cap: 8, ttl: 40, strike: { r: 3.2, wind: 1.6, dmg: 0.16, gap: 0.9 } },
        levers: { open: 45, solo: 6 },
      },
      {
        id: 'eyespire', name: 'The Eye-Spire', x0: 1400, z0: 20, cols: 3, rows: 3, cell: 14, wall: 4, height: 0,
        seeds: { walls: 3941, traps: 3943, mobs: 3947, loot: 3953 }, braid: 0,
        start: [1, 0], end: [1, 2], hall: [0, 0, 2, 2],
        mobs: [], keeper: 'galematriarch',
      },
    ],
  },
};
export const LAB_FLOORS = Object.keys(LABS).map(Number);
export const LAYERS = LAB_FLOORS.flatMap(f => LABS[f].layers);

// ---------- enemies (appended to MOBS / MOB_IDS in data.js) ----------
// lab: the floor whose labyrinth they live in (the leash and the steering stay inside it). hears: a noise-hearing enemy
// (dormant until a noise reaches it: wading, a torch lit, a fight, a lure).
export const LAB_MOB_IDS = ['ghoul', 'gravekeeper', 'tombwarden', 'mirelurker', 'mosshag', 'motherofmire', 'stormharpy', 'kiterider', 'galematriarch'];
export const LAB_MOBS = {
  ghoul: { name: 'Crypt Ghoul', hp: 150, atk: 13, speed: 5.6, aggro: 13, range: 2.0, atkCd: 1.3, xp: 45, radius: 0.8, level: 9, lab: 1 },
  gravekeeper: { name: 'The Gravekeeper', hp: 2200, atk: 24, posture: 900, speed: 3.8, aggro: 15, range: 3.0, atkCd: 2.0, xp: 450, radius: 1.5, level: 10, elite: true, lab: 1, respawn: 75 },
  tombwarden: { name: 'Tomb Warden', hp: 700, atk: 22, speed: 4.6, aggro: 0, range: 2.6, atkCd: 1.8, xp: 140, radius: 1.2, level: 10, lab: 1, hears: true, armor: 0.3 },
  // the Weeping Thicket (Floor 2)
  mirelurker: { name: 'Thicket Lurker', hp: 520, atk: 26, speed: 5.2, aggro: 13, range: 2.2, atkCd: 1.5, xp: 110, radius: 1.0, level: 15, lab: 2 },
  mosshag: { name: 'Moss Hag', hp: 1300, atk: 34, speed: 4.8, aggro: 0, range: 2.8, atkCd: 1.8, xp: 260, radius: 1.1, level: 16, lab: 2, hears: true },
  motherofmire: { name: 'The Mother of Mire', hp: 6200, atk: 40, posture: 2000, speed: 3.4, aggro: 16, range: 3.4, atkCd: 2.2, xp: 1100, radius: 2.0, level: 17, elite: true, lab: 2, respawn: 75 },
  // the Windrift Causeways (Floor 3)
  stormharpy: { name: 'Squall Harpy', hp: 1000, atk: 38, speed: 5.8, aggro: 14, range: 2.4, atkCd: 1.5, xp: 230, radius: 0.9, level: 24, lab: 3 },
  kiterider: { name: 'Kite Rider', hp: 2000, atk: 46, speed: 6.0, aggro: 0, range: 2.8, atkCd: 1.7, xp: 420, radius: 1.1, level: 25, lab: 3, hears: true },
  galematriarch: { name: 'The Gale Matriarch', hp: 12000, atk: 56, posture: 3600, speed: 4.4, aggro: 16, range: 3.2, atkCd: 2.0, xp: 2400, radius: 1.8, level: 26, elite: true, lab: 3, respawn: 75 },
};
export const LAB_BITE = { ghoul: [2.7, 0.7], gravekeeper: [3.8, 0.9], tombwarden: [3.4, 0.8], mirelurker: [2.8, 0.7], mosshag: [3.2, 0.8], motherofmire: [4.4, 0.9], stormharpy: [2.8, 0.7], kiterider: [3.2, 0.75], galematriarch: [4.0, 0.9] };

// The Gravekeeper: swings its lantern-flail (a wide bite), and every so often rings its Grave Bell: a ring of force
// rolls out (jump it or roll through it, like the Warden's Quake Ring). At half health it calls up the dead, once.
export const KEEPER = {
  toll: { first: 6, every: 11, wind: 1.5, r: 15, band: 1.6, speed: 9, mult: 1.6 },
  call: { at: 0.5, n: 4, type: 'ghoul' },
};
// Per mini-boss (KEEPER above is the Gravekeeper's):
// The Mother of Mire dives under the water (takes `under` damage while down), ripples mark a spot under each fighter
// near her, and she bursts up there `wind` s later (step out of the ring); then she lies stranded for `strand` s
// (takes `stranded` damage). At half health she calls the tide early: lurkers surface.
// The Gale Matriarch marks a lane through one fighter and dives along it (`wind` s to step out of it), then perches
// for `perch` s (takes `perched` damage). Her gale pulls everyone toward the rim of the ring for `secs` s, and the
// rim's edge stings. At half health she calls harpies.
export const KEEPERS = {
  gravekeeper: { kind: 'toll', ...KEEPER, name: 'The Gravekeeper', calls: 'The Gravekeeper rings for the dead. They answer.' },
  motherofmire: {
    kind: 'dive', name: 'The Mother of Mire', calls: 'The Mother of Mire calls the tide early. Lurkers surface!',
    dive: { first: 6, every: 13, under: 0.15, wind: 1.7, r: 3.2, mult: 1.5, strand: 5, stranded: 1.5, reach: 18 },
    call: { at: 0.5, n: 4, type: 'mirelurker' },
  },
  galematriarch: {
    kind: 'lanes', name: 'The Gale Matriarch', calls: 'The Gale Matriarch shrieks. Harpies answer from the clouds!',
    lane: { first: 5, every: 11, wind: 1.4, len: 26, w: 1.8, mult: 1.5, perch: 5, perched: 1.6 },
    gale: { first: 16, every: 24, secs: 4, pull: 3.0, rim: 3.0, dmg: 0.05 },
    call: { at: 0.5, n: 3, type: 'stormharpy' },
  },
};
// Noise: how far each sound carries (m), how long a woken Tomb Warden stays up with nobody to fight (s).
// The lure (a bone rattle): thrown `throw` m ahead, rattles for `secs` s, heard `r` m away. Found in chests.
export const NOISE = { wade: 12, torch: 16, fight: 10, lure: 22, awake: 20 };
export const LURE = { throw: 11, secs: 8, start: 1, max: 3 };

// ---------- geometry (built once per layer) ----------
const key = (i, j) => i + ',' + j;
for (const f of LAB_FLOORS) for (const [li, L] of LABS[f].layers.entries()) {
  L.floor = f; L.lab = LABS[f]; L.li = li; L.last = li === LABS[f].layers.length - 1;
  const { cols, rows } = L, n = cols * rows;
  L.w = cols * L.cell; L.d = rows * L.cell; L.h = L.wall / 2;
  const cid = (i, j) => j * cols + i, ci = c => [c % cols, (c / cols) | 0];
  const [a0, b0, a1, b1] = L.hall || [-1, -1, -2, -2];
  L.inHallCell = (i, j) => i >= a0 && i <= a1 && j >= b0 && j <= b1;
  const open = new Set(); // "i,j,E" (between i,j and i+1,j) and "i,j,N" (between i,j and i,j+1)
  const edge = (i, j, di, dj) => di < 0 ? `${i - 1},${j},E` : dj < 0 ? `${i},${j - 1},N` : di > 0 ? `${i},${j},E` : `${i},${j},N`;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const inGrid = (i, j) => i >= 0 && i < cols && j >= 0 && j < rows;
  // walls: a recursive backtracker (seed: walls), then the hall, then braiding
  let r = rng(L.seeds.walls);
  const seen = new Set([key(...L.start)]), stack = [L.start];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const next = DIRS.filter(([di, dj]) => inGrid(i + di, j + dj) && !seen.has(key(i + di, j + dj)));
    if (!next.length) { stack.pop(); continue; }
    const [di, dj] = next[Math.floor(r() * next.length)];
    open.add(edge(i, j, di, dj)); seen.add(key(i + di, j + dj)); stack.push([i + di, j + dj]);
  }
  for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) { if (i < a1) open.add(`${i},${j},E`); if (j < b1) open.add(`${i},${j},N`); }
  const degree = (i, j) => DIRS.filter(([di, dj]) => inGrid(i + di, j + dj) && open.has(edge(i, j, di, dj))).length;
  const keep = new Set([key(...L.start), key(...L.end)]); // (the stairs' cells may stay dead ends)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { // braid: open dead ends into loops, preferring another dead end
    if (keep.has(key(i, j)) || L.inHallCell(i, j) || degree(i, j) !== 1 || r() >= L.braid) continue;
    const shut = DIRS.filter(([di, dj]) => inGrid(i + di, j + dj) && !open.has(edge(i, j, di, dj)) && !L.inHallCell(i + di, j + dj));
    if (!shut.length) continue;
    const dead = shut.filter(([di, dj]) => degree(i + di, j + dj) === 1);
    const [di, dj] = (dead.length ? dead : shut)[Math.floor(r() * (dead.length ? dead : shut).length)];
    open.add(edge(i, j, di, dj));
  }
  L.open = open;
  // shifting ways (the tide, the swinging spans): closed edges that open on a clock, set 0 or set 1 at a time. Each
  // one is a real shortcut (its two cells are far apart through the maze), so the maze stays connected whatever the
  // phase and the clock changes which way is short.
  L.shiftEdges = new Map(); // edge -> set (0 / 1)
  if (L.shift) {
    const n0 = cols * rows, dist0 = (a, b) => { const d = new Int16Array(n0).fill(-1), q = [a]; d[a] = 0; while (q.length) { const c = q.shift(); const [ii, jj] = ci(c); for (const [di, dj] of DIRS) { const x = cid(ii + di, jj + dj); if (inGrid(ii + di, jj + dj) && open.has(edge(ii, jj, di, dj)) && d[x] < 0) { d[x] = d[c] + 1; q.push(x); } } } return d[b]; };
    const rs = rng(L.seeds.walls + 31), cand = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) for (const [di, dj] of [[1, 0], [0, 1]]) {
      const e = edge(i, j, di, dj);
      if (!inGrid(i + di, j + dj) || open.has(e) || L.inHallCell(i, j) || L.inHallCell(i + di, j + dj)) continue;
      if (key(i, j) === key(...L.end) || key(i + di, j + dj) === key(...L.end)) continue; // (never round the portcullis)
      const gain = dist0(cid(i, j), cid(i + di, j + dj));
      if (gain >= 4) cand.push({ e, score: gain + rs() * 3 });
    }
    cand.sort((a, b) => b.score - a.score);
    const used = new Set();
    for (const { e } of cand) {
      if (L.shiftEdges.size >= L.shift.n * 2) break;
      const [i, j] = e.split(',').map(Number); if (used.has(key(i, j))) continue; // (spread out: one per cell)
      used.add(key(i, j)); L.shiftEdges.set(e, L.shiftEdges.size % 2);
    }
  }

  const nbrs = c => {
    const [i, j] = ci(c), out = [];
    for (const [di, dj] of DIRS) if (inGrid(i + di, j + dj) && open.has(edge(i, j, di, dj))) out.push(cid(i + di, j + dj));
    return out;
  };
  L.nbrs = nbrs;
  const bfs = from => { const d = new Int16Array(n).fill(-1), q = [from]; d[from] = 0; while (q.length) { const c = q.shift(); for (const x of nbrs(c)) if (d[x] < 0) { d[x] = d[c] + 1; q.push(x); } } return d; };
  // next-hop table: L.next[from * n + to] = the neighbouring cell to step into (one per shift phase where ways shift)
  const hops = more => {
    const next = new Int16Array(n * n).fill(-1);
    const nb = c => { const out = nbrs(c), [i, j] = ci(c); for (const [di, dj] of DIRS) if (inGrid(i + di, j + dj) && more(edge(i, j, di, dj))) out.push(cid(i + di, j + dj)); return out; };
    for (let to = 0; to < n; to++) { const q = [to], got = new Uint8Array(n); got[to] = 1; while (q.length) { const c = q.shift(); for (const d of nb(c)) if (!got[d]) { got[d] = 1; next[d * n + to] = c; q.push(d); } } }
    return next;
  };
  L.next = hops(() => false);
  if (L.shiftEdges.size) L.nextBy = [0, 1].map(ph => hops(e => L.shiftEdges.get(e) === ph));
  // the main route: start -> end
  const sc = cid(...L.start), ec = cid(...L.end), dS = bfs(sc), path = [ec];
  while (path[0] !== sc) path.unshift(L.next[path[0] * n + sc]);
  L.path = path; L.onPath = new Set(path); L.distStart = dS;
  const center = c => [L.x0 + (ci(c)[0] + 0.5) * L.cell, L.z0 + (ci(c)[1] + 0.5) * L.cell];
  const free = c => !L.inHallCell(...ci(c)) && c !== sc && c !== ec;

  // the two-place puzzle: a split cell on the route, and two lever cells off it the SAME walk from the split, far apart
  if (L.levers) {
    let best = null;
    for (const s of path.slice(1, Math.max(2, Math.floor(path.length * 0.6)))) {
      const d = bfs(s);
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        if (!free(a) || !free(b) || L.onPath.has(a) || L.onPath.has(b) || d[a] !== d[b] || d[a] < 3) continue;
        const ab = bfs(a)[b], score = d[a] * 2 + ab;
        if (ab >= d[a] && (!best || score > best.score)) best = { s, a, b, d: d[a], ab, score };
      }
      if (best && best.d >= 4) break;
    }
    if (best) {
      L.leverCells = [best.a, best.b]; L.splitCell = best.s; L.leverWalk = best.ab * L.cell; // (m, cell to cell)
      L.leverList = [best.a, best.b].map((c, k) => { const [x, z] = center(c); return { k, c, x, z }; });
      // the portcullis: the edge into the end cell along the route
      const pe = path[path.length - 2], [pi, pj] = ci(pe), [ei, ej] = ci(ec);
      L.portEdge = edge(pi, pj, ei - pi, ej - pj);
    }
  }
  const taken = new Set([...(L.leverCells || [])]);

  // traps (seed: traps): spike plates on corridor cells, never on a lever
  r = rng(L.seeds.traps);
  const pool = []; for (let c = 0; c < n; c++) if (free(c) && !taken.has(c)) pool.push(c);
  const pick = (k, rr, ok = () => true) => { const out = []; let g = 0; while (out.length < k && g++ < 800) { const c = pool[Math.floor(rr() * pool.length)]; if (!out.includes(c) && ok(c)) out.push(c); } return out; };
  L.trapList = L.traps ? pick(L.traps.n, r).map((c, k) => { const [x, z] = center(c); return { k, c, x, z, half: (L.cell - L.wall) / 2 - 0.4, off: r() * L.traps.cycle }; }) : [];
  const trapCells = new Set(L.trapList.map(t => t.c));
  L.waterCells = new Set(L.water ? pick(L.water.n, r, c => !trapCells.has(c)) : []);
  // mobs (seed: mobs)
  r = rng(L.seeds.mobs);
  L.mobCells = L.mobs.flatMap(([type, k]) => pick(k, r, c => !trapCells.has(c) && dS[c] >= 2).map(c => [type, c]));
  // loot (seed: loot): chests weighted toward dead ends and side branches (the deepest dead ends get the better
  // chests), with `onPath` of them on the main route
  r = rng(L.seeds.loot);
  L.chestList = [];
  if (L.loot) {
    const onN = Math.max(0, Math.round(L.loot.n * L.loot.onPath));
    const offs = pool.filter(c => !L.onPath.has(c) && !trapCells.has(c)), ons = pool.filter(c => L.onPath.has(c) && !trapCells.has(c));
    const weight = c => (nbrs(c).length === 1 ? 4 : 1) * (1 + dS[c] / 4);
    const draw = (list, k) => { const out = []; for (let g = 0; g < 200 && out.length < k && list.length; g++) { const tot = list.reduce((s, c) => s + weight(c), 0); let x = r() * tot; const c = list.find(c => (x -= weight(c)) < 0) ?? list[0]; out.push(c); list.splice(list.indexOf(c), 1); } return out; };
    const cells = [...draw(offs, L.loot.n - onN), ...draw(ons, onN)];
    L.chestList = cells.map((c, k) => { const [x, z] = center(c); return { k, c, x, z, deep: nbrs(c).length === 1 && !L.onPath.has(c) && dS[c] >= 4 }; });
  }
  // torches: on walls along each cell's closed sides (seeded from the walls), one id each
  r = rng(L.seeds.walls + 17);
  L.torchList = [];
  if (L.torches) for (let c = 0; c < n; c++) {
    if (L.inHallCell(...ci(c)) || r() > 0.45) continue;
    const [i, j] = ci(c), [x, z] = center(c), sides = DIRS.filter(([di, dj]) => !inGrid(i + di, j + dj) || !open.has(edge(i, j, di, dj)));
    if (!sides.length) continue;
    const [di, dj] = sides[Math.floor(r() * sides.length)], o = L.cell / 2 - L.h - 0.15;
    L.torchList.push({ k: L.torchList.length, c, x: x + di * o, z: z + dj * o, nx: -di, nz: -dj });
  }
  L.center = center;
}

// ---------- runtime state (set by the server, and from the snapshot by clients and bots) ----------
// port: per layer with a portcullis, the time (server clock) it stays up until; lit: torch ids lit per layer.
const RUN = { portUp: {}, lit: {} };
export const labRun = RUN;
export function portOpen(L, t = RUN.now ?? 0) { return !L.portEdge || (RUN.portUp[L.id] || 0) > t; }

// ---------- helpers ----------
export const labAt = (x, z) => { // the layer (x, z) is in, or null
  for (const L of LAYERS) if (x >= L.x0 && x <= L.x0 + L.w && z >= L.z0 && z <= L.z0 + L.d) return L;
  return null;
};
export const inLab = (x, z) => !!labAt(x, z);
export const cellCenter = (L, c) => L.center(c);
export const cellOf = (L, x, z) => {
  const i = Math.min(L.cols - 1, Math.max(0, Math.floor((x - L.x0) / L.cell))), j = Math.min(L.rows - 1, Math.max(0, Math.floor((z - L.z0) / L.cell)));
  return j * L.cols + i;
};
export const startPoint = L => L.center(L.start[1] * L.cols + L.start[0]);
export const endPoint = L => L.center(L.end[1] * L.cols + L.end[0]);
export const hallCenter = L => [L.x0 + ((L.hall[0] + L.hall[2] + 1) / 2) * L.cell, L.z0 + ((L.hall[1] + L.hall[3] + 1) / 2) * L.cell];
export const inHall = (L, x, z) => {
  if (!L?.hall) return false;
  const [a0, b0, a1, b1] = L.hall, h = L.h;
  return x > L.x0 + a0 * L.cell + h && x < L.x0 + (a1 + 1) * L.cell - h && z > L.z0 + b0 * L.cell + h && z < L.z0 + (b1 + 1) * L.cell - h;
};
export const inWater = (L, x, z) => !!L?.waterCells?.size && L.waterCells.has(cellOf(L, x, z));
export const labSpeedAt = (x, z) => { const L = labAt(x, z); return L && inWater(L, x, z) ? L.water.slow : 1; };
export const layerName = L => L.name;

// Is (x, z) open floor in layer L? Cells are open inside their walls; a side strip is open where its edge is open
// (and, for the portcullis edge, while it's up).
export function walkLab(L, x, z) {
  const lx = x - L.x0, lz = z - L.z0, C = L.cell, h = L.h;
  if (lx < h || lz < h || lx > L.w - h || lz > L.d - h) return false; // the outer wall
  if (inHall(L, x, z)) return true;
  const i = Math.floor(lx / C), j = Math.floor(lz / C), u = lx - i * C, v = lz - j * C;
  const west = u < h, east = u > C - h, south = v < h, north = v > C - h;
  if ((west || east) && (south || north)) return false; // the corner posts
  const e = west ? `${i - 1},${j},E` : east ? `${i},${j},E` : south ? `${i},${j - 1},N` : north ? `${i},${j},N` : null;
  if (!e) return true;
  if (L.bridge && Math.abs(west || east ? v - C / 2 : u - C / 2) > L.bridge) return false; // (a bridge: narrow, the rest is a drop)
  if (e === L.portEdge && !portOpen(L)) return edgeSide(L, e, x, z) === 0 ? false : L.open.has(e);
  const sh = L.shiftEdges.get(e);
  if (sh !== undefined) return sh === shiftPhase(L) || edgeSide(L, e, x, z) !== 0; // (shut: only its middle band blocks)
  return L.open.has(e);
}

// The side strip (x, z) is in, as an edge id, or null (inside a cell, a hall, or a corner post).
export function stripEdge(L, x, z) {
  const lx = x - L.x0, lz = z - L.z0, C = L.cell, h = L.h;
  if (inHall(L, x, z)) return null;
  const i = Math.floor(lx / C), j = Math.floor(lz / C), u = lx - i * C, v = lz - j * C;
  const west = u < h, east = u > C - h, south = v < h, north = v > C - h;
  if ((west || east) && (south || north)) return null;
  return west ? `${i - 1},${j},E` : east ? `${i},${j},E` : south ? `${i},${j - 1},N` : north ? `${i},${j},N` : null;
}
// Is edge e shut right now (a portcullis down, a shifting way in its other phase)?
export function edgeShut(L, e, t) {
  if (e === L.portEdge) return !portOpen(L, t);
  const sh = L.shiftEdges.get(e);
  return sh !== undefined && sh !== shiftPhase(L, t);
}
// The edges that open and shut (for pushing people out of a shutting one's band).
export const gatedEdges = L => (L.gated ||= [...(L.portEdge ? [L.portEdge] : []), ...L.shiftEdges.keys()]);

// The shift clock: phase 0 or 1 at time t (server clock), and seconds until it turns.
export const shiftPhase = (L, t = RUN.now ?? 0) => L.shift ? Math.floor(t / L.shift.every) % 2 : 0;
export const shiftLeft = (L, t = RUN.now ?? 0) => L.shift ? L.shift.every - (t % L.shift.every) : 0;

// The wind (Floor 3): a direction [dx, dz] (unit), turning every `wind.every` s; null where there is none.
const WIND_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export function windAt(L, t = RUN.now ?? 0) {
  if (!L?.wind) return null;
  const k = Math.floor(t / L.wind.every), h = ((k + L.wind.seed) * 2654435761) >>> 0;
  return WIND_DIRS[(h >>> 7) % 4];
}
export const windLeft = (L, t = RUN.now ?? 0) => L?.wind ? L.wind.every - (t % L.wind.every) : 0;
export const onBridge = (L, x, z) => !!L?.bridge && !!stripEdge(L, x, z);

// The shut portcullis is a thin line, not the whole 2 m gateway, so nobody standing in the gateway when it drops is
// frozen there: portSide() says which side of it (x, z) is (-1 / +1), or 0 inside the bars' band (PORT_BAND m each way).
export const PORT_BAND = 0.45;
export function edgeSide(L, e, x, z) {
  const [i, j, d] = e.split(','), C = L.cell;
  const off = d === 'E' ? x - (L.x0 + (+i + 1) * C) : z - (L.z0 + (+j + 1) * C);
  return Math.abs(off) < PORT_BAND ? 0 : Math.sign(off);
}
export const portSide = (L, x, z) => L.portEdge ? edgeSide(L, L.portEdge, x, z) : 1;
// A point just off edge e on side s (for pushing people and mobs out of its band when it shuts).
export function edgeOff(L, e, x, z, s) {
  const [i, j, d] = e.split(','), C = L.cell, k = PORT_BAND + 0.35;
  return d === 'E' ? [L.x0 + (+i + 1) * C + s * k, z] : [x, L.z0 + (+j + 1) * C + s * k];
}
export const portOff = (L, x, z, s) => edgeOff(L, L.portEdge, x, z, s);

// Steering: heading for (tx, tz) from (x, z) inside layer L, aim for the next cell's centre on the way instead
// (corridors are as wide as the cells' insides, so a straight line to a neighbour's centre never clips a corner).
export function labSteer(x, z, tx, tz) {
  const L = labAt(x, z);
  if (!L || labAt(tx, tz) !== L) return [tx, tz];
  const from = cellOf(L, x, z), to = cellOf(L, tx, tz);
  if (from === to) return [tx, tz];
  const [fi, fj] = [from % L.cols, (from / L.cols) | 0], [ti, tj] = [to % L.cols, (to / L.cols) | 0];
  if (L.inHallCell(fi, fj) && L.inHallCell(ti, tj)) return [tx, tz]; // one open room
  const hop = (L.nextBy ? L.nextBy[shiftPhase(L)] : L.next)[from * L.cols * L.rows + to];
  if (hop < 0) return [tx, tz];
  const [hx, hz] = L.center(hop);
  if (L.bridge) { // a narrow bridge: line up with it first (from this side of the gap), then cross
    const [cx, cz] = L.center(from), dx = Math.sign(hx - cx), dz = Math.sign(hz - cz);
    const lat = dx ? z - cz : x - cx, along = dx ? (x - cx) * dx : (z - cz) * dz;
    if (Math.abs(lat) > L.bridge * 0.5 && along < L.cell / 2 - L.h - 0.2) return [cx + dx * (L.cell / 2 - L.h - 0.6), cz + dz * (L.cell / 2 - L.h - 0.6)];
  }
  return [hx, hz];
}

// Spike plates: 0 down, 1 warning (glow), 2 up, at game time t.
export function trapState(L, tr, t) {
  const T = L.traps, k = ((t + tr.off) % T.cycle + T.cycle) % T.cycle;
  return k < T.cycle - T.warn - T.up ? 0 : k < T.cycle - T.up ? 1 : 2;
}
export const onTrap = (tr, x, z) => Math.abs(x - tr.x) < tr.half && Math.abs(z - tr.z) < tr.half;

// The levers' window: how long the first pull waits for the second. With one person it's the real walk between them
// at running speed (+ `solo` s); with two or more it's short (they're meant to pull together).
// The labyrinth's names for its bits (the lure, the levers, the torches), per floor.
export const LAB_WORDS = {
  1: { lure: 'bone rattle', lever: 'Bone lever', torch: 'Torch', chest: 'Chest', deep: 'Gilded chest', gate: 'portcullis', event: 'THE CRYPT BREATHES' },
  2: { lure: 'reed whistle', lever: 'Sluice wheel', torch: 'Glowcap lantern', chest: 'Mossy chest', deep: 'Sunken coffer', gate: 'root gate', event: 'THE WISPS RISE' },
  3: { lure: 'storm chime', lever: 'Wind shrine', torch: 'Beacon', chest: 'Sky chest', deep: 'Stormglass coffer', gate: 'wind wall', event: 'THE SQUALL' },
};
export const labWords = L => LAB_WORDS[L?.floor || 1];

export const leverWindow = (L, people, speed = 10) => people <= 1 ? L.leverWalk / speed * 1.25 + L.levers.solo : 6;

// The stairs of a labyrinth, by kind: 'in' (field -> first layer's start), 'down' (a layer's end -> the next one's
// start), 'up' (a layer's start -> back: the previous layer's end, or the field), 'out' (the Heart's end -> the boss gate).
const STAIRS = new Map(); // (fixed per labyrinth: built once)
export function stairsOf(lab) {
  if (STAIRS.has(lab)) return STAIRS.get(lab);
  const out = [{ kind: 'in', x: lab.entry.x, z: lab.entry.z, r: lab.entry.use, L: null, to: lab.layers[0] }];
  lab.layers.forEach((L, i) => {
    const [sx, sz] = startPoint(L), [ex, ez] = endPoint(L);
    out.push({ kind: 'up', x: sx, z: sz - L.cell * 0.25, r: lab.use, L, to: lab.layers[i - 1] || null });
    out.push({ kind: L.last ? 'out' : 'down', x: ex, z: ez + L.cell * 0.15, r: lab.use, L, to: lab.layers[i + 1] || null });
  });
  STAIRS.set(lab, out);
  return out;
}

// Does this character hold floor f's key? A character who already beat that floor's boss counts (they found the way
// before labyrinths existed).
const BOSS_KILLS = { 1: 'wardenKills', 2: 'sovereignKills', 3: 'colossusKills' };
export const hasLabKey = (stats, f) => !LABS[f] || (stats?.[LABS[f].key] || 0) > 0 || (stats?.[BOSS_KILLS[f]] || 0) > 0;

// The snapshot's labyrinth part: [server time, [[layer id, portcullis up-until, lit torch ids, guttering s]]]
export function applyLabSnap(lb) {
  if (!lb) return;
  RUN.now = lb[0];
  for (const [id, port, lit] of lb[1] || []) { RUN.portUp[id] = port; RUN.lit[id] = lit; }
}
