// Boss tuning harness (docs/ROADMAP.md J3): runs bot parties against the Horned Warden, the Drowned Sovereign and the
// Storm Colossus through the existing bot boss runners (test/wardenskill.js, test/floor3boss.js), with the boss timing
// knobs of shared/bosstiming.js, and prints one table per boss: kill rate, kill time, downs / deaths, damage share by
// role, the opening time melee used, and how often each ability hit someone.
//
// Usage: node scripts/tuneboss.js [flags]
//   --boss warden,sovereign,colossus   bosses (default all three)
//   --party 3,6                         party sizes: 3 = guardian,swordsman,cleric; 6 = guardian,swordsman,berserker,ranger,bard,cleric
//   --skills 3,4,5                      bot capability levels (shared/botskill.js)
//   --runs 2                            fights per cell
//   --port 37400                        first port; each parallel job uses its own (port + job)
//   --jobs 2                            cells run at once (each is a server + its bots)
//   --set damageMul=1.1,pauseMul=1.2    knob overrides for every boss run (on top of the table's own knobs)
//   --sweep pauseMul=0.6:1.4:0.2        rerun every cell for each value of one knob; one row per value
//   --limit 360                         s per fight before it counts as a timeout
//   --json file                         also save every run's raw numbers
//   --from a.json,b.json                no fights: print the tables from saved --json files (cells with the same boss,
//                                       party, skill and knobs are pooled, e.g. two batches of the same table)
// Knobs (shared/bosstiming.js applyKnobs): damageMul (all boss damage), windupMul (telegraphs), gapMul (the gaps inside
// a combo and the close-range gap), pauseMul (after pauses: the openings), cooldownMul (ability / combo / team timers).
//
// What the runners add for it: TUNE_JSON=file (write every run's result), and on the server TUNE_STATS=1 (server/game.js:
// `[tune] use` / `[tune] hit` lines) and BOSS_KNOBS (the knob overrides, by boss).
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KNOB_KEYS } from '../shared/bosstiming.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Roles for the damage share: melee (inFlankReach fighters, the tank included), ranged, healer.
export const ROLE = { guardian: 'melee', swordsman: 'melee', berserker: 'melee', lancer: 'melee', ranger: 'ranged', bard: 'ranged', cleric: 'healer' };
const SLICE = 0.5; // opening time is counted in slices of this many s

/** Per-run tracking inside a runner (test/wardenskill.js, test/floor3boss.js): damage on the boss by class, downs and
 *  deaths by class, and the opening slices (w.op) in which a melee fighter hit the boss. snap(msg) once the fight is on;
 *  report(log) parses the server's `[tune]` lines (TUNE_STATS=1). */
export function tuneWatch(team, bossType) {
  const cls = id => team.find(b => b.id === id)?.cls;
  const dmg = {}, downs = {}, deaths = {}, cur = new Map(); // cur: boss id -> the opening it is in
  const open = { n: 0, secs: 0, slices: 0, used: 0, hits: 0 };
  const tl = { dmg: [], marks: [] }; let t0 = 0; // timeline (the raw JSON only): damage on the boss per s, and when phases / big moves came
  const MARK = { f2phase: 'phase', f3phase: 'phase', f3ov: 'overload', f3beam: 'beam', f2wave: 'wave', down: 'down', pdie: 'death' };
  const close = o => { open.used += o.used.size; };
  return {
    snap(msg) {
      const ids = new Set(msg.w.mobs.filter(m => m[1] === bossType).map(m => m[0]));
      const melee = new Set(), now = (t0 ||= Date.now(), Math.floor((Date.now() - t0) / 1000));
      for (const e of msg.w.events) {
        if (e.t === 'hit' && ids.has(e.id) && cls(e.by)) tl.dmg[now] = (tl.dmg[now] || 0) + e.a;
        if (MARK[e.t]) tl.marks.push([now, MARK[e.t] + (e.s ? ` ${e.s}` : e.n != null ? ` ${e.n}` : '')]);
        const c = cls(e.by ?? e.id);
        if (e.t === 'hit' && ids.has(e.id) && cls(e.by)) { dmg[cls(e.by)] = (dmg[cls(e.by)] || 0) + e.a; if (ROLE[cls(e.by)] === 'melee') melee.add(e.id); }
        if (e.t === 'down' && c) downs[c] = (downs[c] || 0) + 1;
        if (e.t === 'pdie' && c) deaths[c] = (deaths[c] || 0) + 1;
      }
      const ops = new Map((msg.w.op || []).filter(o => ids.has(o[0])).map(o => [o[0], o]));
      for (const [id, o] of cur) if (!ops.has(id)) { close(o); cur.delete(id); }
      for (const [id, [, , left, total]] of ops) {
        let o = cur.get(id);
        if (!o || o.total !== total || left > o.left + 0.05) { // a new opening
          if (o) close(o);
          o = { total, left, used: new Set() };
          cur.set(id, o);
          open.n++; open.secs += total; open.slices += Math.max(1, Math.round(total / SLICE));
        }
        o.left = left;
        if (melee.has(id)) { o.used.add(Math.min(Math.max(0, Math.round(o.total / SLICE) - 1), Math.floor((total - left) / SLICE))); open.hits++; }
      }
    },
    report(log) {
      for (const o of cur.values()) close(o);
      cur.clear();
      const uses = {}, hits = {};
      for (const [, , k] of log.matchAll(/\[tune\] use (\w+) (\w+)/g)) uses[k] = (uses[k] || 0) + 1;
      for (const [, src] of log.matchAll(/\[tune\] hit (.+)/g)) hits[src] = (hits[src] || 0) + 1;
      return { dmg, downs, deaths, open, uses, hits, tl: { dmg: Array.from(tl.dmg, v => Math.round(v || 0)), marks: tl.marks } };
    },
  };
}

// Each boss: its runner, extra env, the damage sources (damagePlayer src) of each ability (key as in [tune] use), and
// its own line of numbers from the runner's result.
const sum = (rs, f) => rs.reduce((s, r) => s + (f(r) || 0), 0);
const BOSSES = {
  warden: {
    runner: 'test/wardenskill.js', env: {},
    src: { swing: 'warden cleave', slam: 'warden slam', quake: 'warden quake', charge: 'warden charge', sweep: 'warden sweep', spin: 'warden spin', rock: 'rockfall' },
    extra: rs => { const j = sum(rs, r => r.quake?.jump) + sum(rs, r => r.quake?.roll), h = sum(rs, r => r.quake?.hit); return `rings cleared ${j + h ? Math.round((100 * j) / (j + h)) : '-'}%`; },
  },
  sovereign: {
    runner: 'test/wardenskill.js', env: { BOSS: 'sovereign' },
    src: { swing: 'sovereign trident', geyser: 'sovereign geyser', wave: 'tidal wave', volley: 'sovereign orb', pools: 'mire pool', deluge: 'the deluge' },
    extra: rs => `waves rolled ${sum(rs, r => r.wave?.roll)} hit ${sum(rs, r => r.wave?.hit)}`,
  },
  colossus: {
    runner: 'test/floor3boss.js', env: {},
    src: { swing: 'colossus hammerfall', strike: 'colossus lightning', gust: 'gale push', beam: 'tempest beam', overload: 'thunderclap' },
    extra: rs => `beam hit ${sum(rs, r => r.beam?.hit)}/${sum(rs, r => r.beam?.hit + r.beam?.jump + r.beam?.roll + r.beam?.cover)} · overloads stopped ${sum(rs, r => r.stop?.sw + r.stop?.burst + r.stop?.brk)}/${sum(rs, r => r.ov)}`,
  },
};
const PARTY = { 3: 'guardian,swordsman,cleric', 6: 'guardian,swordsman,berserker,ranger,bard,cleric' };

function parseArgs(argv) {
  const A = { boss: Object.keys(BOSSES), party: [3, 6], skills: [3, 4, 5], runs: 2, port: 37400, jobs: 2, set: {}, sweep: null, limit: null, json: null, from: null };
  const list = v => v.split(',').filter(Boolean);
  const knob = k => { if (!KNOB_KEYS.includes(k)) throw new Error(`unknown knob ${k} (knobs: ${KNOB_KEYS.join(' ')})`); return k; };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i], v = argv[i + 1];
    if (f === '--help' || f === '-h') { A.help = true; continue; }
    if (!f.startsWith('--') || v === undefined) throw new Error(`bad argument ${f}`);
    i++;
    if (f === '--boss') { A.boss = list(v); for (const b of A.boss) if (!BOSSES[b]) throw new Error(`unknown boss ${b}`); }
    else if (f === '--party') A.party = list(v).map(Number);
    else if (f === '--skills') A.skills = list(v).map(Number);
    else if (f === '--runs') A.runs = Number(v);
    else if (f === '--port') A.port = Number(v);
    else if (f === '--jobs') A.jobs = Math.max(1, Number(v));
    else if (f === '--limit') A.limit = Number(v);
    else if (f === '--json') A.json = v;
    else if (f === '--from') A.from = list(v);
    else if (f === '--set') for (const kv of list(v)) { const [k, x] = kv.split('='); A.set[knob(k)] = Number(x); }
    else if (f === '--sweep') {
      const [k, r] = v.split('='), [a, b, s] = r.split(':').map(Number);
      if (!(s > 0) || !(b >= a)) throw new Error('--sweep knob=from:to:step');
      const vals = []; for (let x = a; x <= b + 1e-9; x += s) vals.push(Math.round(x * 1000) / 1000);
      A.sweep = { k: knob(k), vals };
    } else throw new Error(`unknown flag ${f}`);
  }
  return A;
}

/** Run one cell: `runs` fights of `boss` with the party at `skill`, knobs on top. Resolves to the runner's results. */
function runCell(c, port, A) {
  return new Promise(resolve => {
    const file = path.join(os.tmpdir(), `tuneboss-${process.pid}-${port}.json`);
    const B = BOSSES[c.boss];
    const env = { ...process.env, ...B.env, BOT_SKILL: String(c.skill), RUNS: String(A.runs), PORT: String(port), ROLES: PARTY[c.party] || c.party, TUNE_JSON: file, TUNE_STATS: '1', BOSS_KNOBS: JSON.stringify({ [c.boss]: c.knobs }) };
    if (A.limit) env.LIMIT = String(A.limit);
    const ch = spawn(process.execPath, [path.join(root, B.runner)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
    ch.on('close', code => {
      let rs = [];
      try { rs = JSON.parse(readFileSync(file, 'utf8')); rmSync(file); } catch { console.error(`  (no results from ${c.boss} party ${c.party} skill ${c.skill}, exit ${code})\n${out.slice(-600)}`); }
      resolve(rs);
    });
  });
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const avg = (a, d = 0) => (a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(d) : '-');
const pad = (s, n) => String(s).padEnd(n);

/** One row of numbers from a cell's runs. */
function summarise(boss, rs) {
  const n = rs.length || 1, wins = rs.filter(r => r.result === 'kill'), T = rs.map(r => r.tune || {});
  const role = { melee: 0, ranged: 0, healer: 0 }, mDeaths = sum(T, t => Object.entries(t.deaths || {}).filter(([c]) => ROLE[c] === 'melee').reduce((s, [, v]) => s + v, 0));
  for (const t of T) for (const [c, v] of Object.entries(t.dmg || {})) role[ROLE[c] || 'ranged'] += v;
  const tot = role.melee + role.ranged + role.healer, O = { n: sum(T, t => t.open?.n), secs: sum(T, t => t.open?.secs), slices: sum(T, t => t.open?.slices), used: sum(T, t => t.open?.used) };
  const secs = wins.map(r => r.secs);
  return {
    n: rs.length, kills: `${wins.length}/${rs.length}`, time: wins.length ? `${avg(secs)}s (${Math.min(...secs)}-${Math.max(...secs)})` : '-',
    downs: (sum(rs, r => r.downs) / n).toFixed(1), deaths: (sum(rs, r => r.deaths) / n).toFixed(1), mDeaths: (mDeaths / n).toFixed(1),
    share: `${pct(role.melee, tot)}/${pct(role.ranged, tot)}/${pct(role.healer, tot)}`,
    open: `${pct(O.used, O.slices)} of ${(O.secs / n).toFixed(0)}s (${(O.n / n).toFixed(1)}x)`,
    extra: BOSSES[boss].extra(rs), T,
  };
}

/** Ability rows: uses, players hit and hits per use, per cell. */
function abilityTable(boss, cells) {
  const S = BOSSES[boss].src, keys = Object.keys(S), lines = [];
  lines.push(`  ${pad('ability (hits/uses per fight)', 32)}${cells.map(c => pad(c.label, 16)).join('')}`);
  for (const k of keys) {
    const row = cells.map(c => { const n = c.sum.n || 1, u = sum(c.sum.T, t => t.uses?.[k]), h = sum(c.sum.T, t => t.hits?.[S[k]]); return pad(u || h ? `${(h / n).toFixed(1)}/${(u / n).toFixed(1)}${u ? ` (${(h / u).toFixed(2)})` : ''}` : '-', 16); });
    lines.push(`  ${pad(`${k} (${S[k]})`, 32)}${row.join('')}`);
  }
  const other = {};
  for (const c of cells) for (const t of c.sum.T) for (const [src, v] of Object.entries(t.hits || {})) if (!Object.values(S).includes(src)) other[src] = (other[src] || 0) + v;
  const runs = cells.reduce((s, c) => s + c.sum.n, 0) || 1;
  if (Object.keys(other).length) lines.push(`  other hits per fight: ${Object.entries(other).sort((a, b) => b[1] - a[1]).map(([s, v]) => `${s} ${(v / runs).toFixed(1)}`).join(', ')}`);
  return lines.join('\n');
}

function printBoss(boss, cells, A) {
  const head = ['party', 'skill', ...(A.sweep ? [A.sweep.k] : []), 'n', 'kills', 'kill time', 'downs', 'deaths', 'melee deaths', 'dmg melee/rng/heal', 'opening used', boss === 'warden' ? 'quake' : boss === 'sovereign' ? 'tidal wave' : 'beam / overload'];
  const rows = cells.map(c => [c.party, c.skill, ...(A.sweep ? [c.knobs[A.sweep.k]] : []), c.sum.n, c.sum.kills, c.sum.time, c.sum.downs, c.sum.deaths, c.sum.mDeaths, c.sum.share, c.sum.open, c.sum.extra]);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)) + 2);
  const knobs = Object.keys(A.set).length ? ` · knobs ${Object.entries(A.set).map(([k, v]) => `${k}=${v}`).join(' ')}` : '';
  console.log(`\n== ${boss}${knobs} (per fight; kill time over kills; opening used: share of ${SLICE}s opening slices with a melee hit on the boss, of the opening s per fight)`);
  console.log(head.map((h, i) => pad(h, w[i])).join(''));
  for (const r of rows) console.log(r.map((v, i) => pad(v, w[i])).join(''));
  console.log(abilityTable(boss, cells));
}

/** --from: pool the saved cells by boss, party, skill and knobs, then print them like a run. */
function printSaved(A) {
  const by = new Map();
  for (const f of A.from) for (const c of JSON.parse(readFileSync(f, 'utf8'))) {
    const key = JSON.stringify([c.boss, c.party, c.skill, c.knobs]);
    if (by.has(key)) by.get(key).rs.push(...c.rs); else by.set(key, { ...c, rs: [...c.rs] });
  }
  const cells = [...by.values()].sort((a, b) => a.party - b.party || a.skill - b.skill);
  for (const c of cells) c.sum = summarise(c.boss, c.rs);
  const keys = cells.flatMap(c => Object.keys(c.knobs)), k = [...new Set(keys)].find(x => new Set(cells.map(c => c.knobs[x])).size > 1);
  A.sweep = k ? { k } : null; A.set = k ? {} : cells[0]?.knobs || {};
  for (const boss of Object.keys(BOSSES)) if (cells.some(c => c.boss === boss)) printBoss(boss, cells.filter(c => c.boss === boss), A);
}

async function main() {
  const A = parseArgs(process.argv.slice(2));
  if (A.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]); return; }
  if (A.from) return printSaved(A);
  const cells = [];
  for (const boss of A.boss) for (const party of A.party) for (const skill of A.skills) for (const v of A.sweep ? A.sweep.vals : [null]) {
    const knobs = { ...A.set, ...(A.sweep ? { [A.sweep.k]: v } : {}) };
    cells.push({ boss, party, skill, knobs, label: `${party}p s${skill}${A.sweep ? ` ${A.sweep.k.replace('Mul', '')}${v}` : ''}` });
  }
  console.error(`tuneboss: ${cells.length} cells x ${A.runs} runs, ${A.jobs} at a time, ports ${A.port}-${A.port + A.jobs - 1}`);
  let next = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(A.jobs, cells.length) }, async (_, j) => {
    while (next < cells.length) {
      const c = cells[next++];
      c.rs = await runCell(c, A.port + j, A);
      c.sum = summarise(c.boss, c.rs);
      console.error(`  done ${c.boss} ${c.label}: ${c.sum.kills} kills, ${c.sum.time} (${Math.round((Date.now() - t0) / 1000)}s in)`);
    }
  }));
  for (const boss of A.boss) printBoss(boss, cells.filter(c => c.boss === boss), A);
  if (A.json) writeFileSync(A.json, JSON.stringify(cells.map(({ sum: s, ...c }) => c), null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(e => { console.error(e.message); process.exit(1); });
