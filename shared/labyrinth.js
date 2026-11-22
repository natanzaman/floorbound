// Labyrinths (docs/briefs/labyrinths.md): one before each floor's boss, each with its own style, look, traps and events.
// Floor 1's is the Undercrypt, a true dungeon maze under the Verdant Field: torchlit stone corridors, spike plates, the
// crypt "breathing" (torches gutter and the dead rise), and the Gravekeeper in the Ossuary at its heart, who holds the
// Horn Key that opens the Chamber Gate.
//
// A labyrinth is a grid of cells in its own patch of its floor's coordinate space (Floor 1's sits at x 120..210, far
// east of the field, so floorOf() still says Floor 1). You go in and out by stairs (teleports). Walls are grid edges:
// walkable() asks walkLab(), so players, client prediction, mobs and bots all collide with them without knowing about
// labyrinths. Mobs and bots steer through it with labSteer() (a next-hop table over the cells).
//
// Data and helpers here; the server runs it (server/labyrinth.js), the client draws it (public/labyrinth.js).
// This module imports nothing, so shared/data.js can import it.

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// ---------- the labyrinths ----------
//   x0, z0       the grid's south-west corner · cols x rows cells of `cell` m, walls `wall` m thick (straddling the
//                cell edges, so a corridor is cell - wall wide) · seed, loops: the maze (a fraction of extra openings,
//                so it isn't a pure tree and a party can split up and meet again)
//   hall         [i0, j0, i1, j1]: cells opened into one room (the mini-boss's)
//   start, end   the cells with the stair down (in) and the stair up (out, to the boss gate)
//   entry        the stair in the field that leads down · back: where climbing back out of the start leaves you
//   exitTo       where the stair up at the end leaves you (in front of the boss gate)
//   traps        spike plates: n cells, cycle (s), warn / up (s) within it, dmg (fraction of max HP)
//   breathe      the floor's event: every [a, b] s while someone is inside, the torches gutter for `secs` s and `rise`
//                dead (type) climb out of the floor near each person inside (at most `cap` alive at once)
//   keeper       the mini-boss (a mob type) and its moves; key: the stat counting this floor's keys
export const LABS = {
  1: {
    floor: 1, id: 'undercrypt', name: 'The Undercrypt', hallName: 'The Ossuary', keyName: 'Horn Key',
    x0: 120, z0: 20, cols: 9, rows: 9, cell: 10, wall: 2, height: 4.2, seed: 1103, loops: 0.14,
    hall: [3, 3, 5, 5], start: [4, 0], end: [4, 8],
    entry: { x: -17, z: 141, r: 2.2, use: 3.0, clear: 5 },
    back: { x: -17, z: 136.5 },
    exitTo: { x: 0, z: 146 },
    use: 3.0, // reach of the stairs inside
    traps: { n: 10, cycle: 4.5, warn: 1.2, up: 1.0, dmg: 0.16 },
    breathe: { every: [70, 110], first: [45, 70], secs: 10, rise: 2, type: 'ghoul', cap: 8, ttl: 45 },
    mobs: [['ghoul', 14]], // field mobs, spread over the maze's cells (not the start, the end or the hall)
    keeper: 'gravekeeper', key: 'lab1Keys',
  },
};
export const LAB_FLOORS = Object.keys(LABS).map(Number);

// ---------- enemies (appended to MOBS / MOB_IDS in data.js) ----------
// lab: the floor whose labyrinth they live in (the leash and the steering stay inside it).
export const LAB_MOB_IDS = ['ghoul', 'gravekeeper'];
export const LAB_MOBS = {
  ghoul: { name: 'Crypt Ghoul', hp: 150, atk: 13, speed: 5.6, aggro: 13, range: 2.0, atkCd: 1.3, xp: 45, radius: 0.8, level: 9, lab: 1 },
  gravekeeper: { name: 'The Gravekeeper', hp: 2200, atk: 24, posture: 900, speed: 3.8, aggro: 15, range: 3.0, atkCd: 2.0, xp: 450, radius: 1.5, level: 10, elite: true, lab: 1, respawn: 75 },
};
export const LAB_BITE = { ghoul: [2.7, 0.7], gravekeeper: [3.8, 0.9] };

// The Gravekeeper: swings its great lantern-flail (a wide bite), and every so often rings its Grave Bell: a ring of
// force rolls out (jump it or roll through it, like the Warden's Quake Ring). At half health it calls up the dead, once.
export const KEEPER = {
  toll: { first: 6, every: 11, wind: 1.5, r: 9, band: 1.6, speed: 9, mult: 1.6 }, // the ring: speed m/s, band: its width
  call: { at: 0.5, n: 4, type: 'ghoul' },
};

// ---------- geometry (built once per labyrinth) ----------
const key = (i, j) => i + ',' + j;
for (const L of Object.values(LABS)) {
  const r = rng(L.seed), { cols, rows } = L;
  L.w = cols * L.cell; L.d = rows * L.cell; L.h = L.wall / 2;
  const open = new Set(); // "i,j,E" (between i,j and i+1,j) and "i,j,N" (between i,j and i,j+1)
  const edge = (i, j, di, dj) => di < 0 ? `${i - 1},${j},E` : dj < 0 ? `${i},${j - 1},N` : di > 0 ? `${i},${j},E` : `${i},${j},N`;
  // recursive backtracker
  const seen = new Set([key(...L.start)]), stack = [L.start];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => i + di >= 0 && i + di < cols && j + dj >= 0 && j + dj < rows && !seen.has(key(i + di, j + dj)));
    if (!next.length) { stack.pop(); continue; }
    const [di, dj] = next[Math.floor(r() * next.length)];
    open.add(edge(i, j, di, dj)); seen.add(key(i + di, j + dj)); stack.push([i + di, j + dj]);
  }
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { // a few loops
    if (i < cols - 1 && r() < L.loops) open.add(`${i},${j},E`);
    if (j < rows - 1 && r() < L.loops) open.add(`${i},${j},N`);
  }
  const [a0, b0, a1, b1] = L.hall;
  for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) { if (i < a1) open.add(`${i},${j},E`); if (j < b1) open.add(`${i},${j},N`); }
  L.open = open;
  L.inHallCell = (i, j) => i >= a0 && i <= a1 && j >= b0 && j <= b1;

  // next-hop table: L.next[from * n + to] = the neighbouring cell to step into (BFS from every cell)
  const n = cols * rows, next = new Int16Array(n * n).fill(-1);
  const nbrs = c => {
    const i = c % cols, j = (c / cols) | 0, out = [];
    if (i < cols - 1 && open.has(`${i},${j},E`)) out.push(c + 1);
    if (i > 0 && open.has(`${i - 1},${j},E`)) out.push(c - 1);
    if (j < rows - 1 && open.has(`${i},${j},N`)) out.push(c + cols);
    if (j > 0 && open.has(`${i},${j - 1},N`)) out.push(c - cols);
    return out;
  };
  L.nbrs = nbrs;
  for (let to = 0; to < n; to++) { // BFS out from the target: the parent of each cell is its next hop towards it
    const q = [to], got = new Uint8Array(n); got[to] = 1;
    while (q.length) { const c = q.shift(); for (const d of nbrs(c)) if (!got[d]) { got[d] = 1; next[d * n + to] = c; q.push(d); } }
  }
  L.next = next;

  // spike plates and field-mob cells: seeded picks among the corridor cells
  const busy = c => { const i = c % cols, j = (c / cols) | 0; return L.inHallCell(i, j) || key(i, j) === key(...L.start) || key(i, j) === key(...L.end); };
  const pool = []; for (let c = 0; c < n; c++) if (!busy(c)) pool.push(c);
  const pick = (k, avoid = new Set()) => { const out = []; let guard = 0; while (out.length < k && guard++ < 500) { const c = pool[Math.floor(r() * pool.length)]; if (!out.includes(c) && !avoid.has(c)) out.push(c); } return out; };
  const tc = pick(L.traps.n);
  L.trapList = tc.map((c, k) => ({ k, c, x: L.x0 + ((c % cols) + 0.5) * L.cell, z: L.z0 + (((c / cols) | 0) + 0.5) * L.cell, half: (L.cell - L.wall) / 2 - 0.4, off: r() * L.traps.cycle }));
  L.mobCells = L.mobs.flatMap(([type, k]) => pick(k, new Set(tc)).map(c => [type, c]));
}

// ---------- helpers ----------
export const labAt = (x, z) => { // the labyrinth (x, z) is in, or null
  for (const f of LAB_FLOORS) { const L = LABS[f]; if (x >= L.x0 && x <= L.x0 + L.w && z >= L.z0 && z <= L.z0 + L.d) return L; }
  return null;
};
export const inLab = (x, z) => !!labAt(x, z);
export const cellCenter = (L, c) => [L.x0 + ((c % L.cols) + 0.5) * L.cell, L.z0 + (((c / L.cols) | 0) + 0.5) * L.cell];
export const cellOf = (L, x, z) => {
  const i = Math.min(L.cols - 1, Math.max(0, Math.floor((x - L.x0) / L.cell))), j = Math.min(L.rows - 1, Math.max(0, Math.floor((z - L.z0) / L.cell)));
  return j * L.cols + i;
};
export const startPoint = L => cellCenter(L, L.start[1] * L.cols + L.start[0]);
export const endPoint = L => cellCenter(L, L.end[1] * L.cols + L.end[0]);
export const hallCenter = L => [L.x0 + ((L.hall[0] + L.hall[2] + 1) / 2) * L.cell, L.z0 + ((L.hall[1] + L.hall[3] + 1) / 2) * L.cell];
export const inHall = (L, x, z) => {
  const [a0, b0, a1, b1] = L.hall, h = L.h;
  return x > L.x0 + a0 * L.cell + h && x < L.x0 + (a1 + 1) * L.cell - h && z > L.z0 + b0 * L.cell + h && z < L.z0 + (b1 + 1) * L.cell - h;
};

// Is (x, z) open floor in labyrinth L? Cells are open inside their walls; a side strip is open where its edge is open.
export function walkLab(L, x, z) {
  const lx = x - L.x0, lz = z - L.z0, C = L.cell, h = L.h;
  if (lx < h || lz < h || lx > L.w - h || lz > L.d - h) return false; // the outer wall
  if (inHall(L, x, z)) return true;
  const i = Math.floor(lx / C), j = Math.floor(lz / C), u = lx - i * C, v = lz - j * C;
  const west = u < h, east = u > C - h, south = v < h, north = v > C - h;
  if ((west || east) && (south || north)) return false; // the corner posts
  if (west) return L.open.has(`${i - 1},${j},E`);
  if (east) return L.open.has(`${i},${j},E`);
  if (south) return L.open.has(`${i},${j - 1},N`);
  if (north) return L.open.has(`${i},${j},N`);
  return true;
}

// Steering: heading for (tx, tz) from (x, z) inside labyrinth L, aim for the next cell's centre on the way instead
// (corridors are as wide as the cells' insides, so a straight line to a neighbour's centre never clips a corner).
export function labSteer(x, z, tx, tz) {
  const L = labAt(x, z);
  if (!L) return [tx, tz];
  const from = cellOf(L, x, z);
  if (labAt(tx, tz) !== L) return [tx, tz];
  const to = cellOf(L, tx, tz);
  if (from === to) return [tx, tz];
  const [fi, fj] = [from % L.cols, (from / L.cols) | 0], [ti, tj] = [to % L.cols, (to / L.cols) | 0];
  if (L.inHallCell(fi, fj) && L.inHallCell(ti, tj)) return [tx, tz]; // one open room
  const hop = L.next[from * L.cols * L.rows + to];
  return hop < 0 ? [tx, tz] : cellCenter(L, hop);
}

// Spike plates: 0 down, 1 warning (glow), 2 up, at game time t.
export function trapState(L, tr, t) {
  const T = L.traps, k = ((t + tr.off) % T.cycle + T.cycle) % T.cycle;
  return k < T.cycle - T.warn - T.up ? 0 : k < T.cycle - T.up ? 1 : 2;
}
export const onTrap = (tr, x, z) => Math.abs(x - tr.x) < tr.half && Math.abs(z - tr.z) < tr.half;

// Does this character hold floor f's key? A character who already beat that floor's boss counts (they found the way
// before labyrinths existed).
const BOSS_KILLS = { 1: 'wardenKills', 2: 'sovereignKills', 3: 'colossusKills' };
export const hasLabKey = (stats, f) => !LABS[f] || (stats?.[LABS[f].key] || 0) > 0 || (stats?.[BOSS_KILLS[f]] || 0) > 0;
