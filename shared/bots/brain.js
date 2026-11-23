// One brain per bot. Every bot is its own WebSocket client (like a real player) running its own decision loop on each
// snapshot: its own role (from its class plug-in, shared/bots/registry.js), behaviour, capability level
// (shared/botskill.js) and goal. Teamwork emerges from the party as seen in the snapshot, humans included:
//
//   cohesion  a follower stays near its anchor: a human in the party (the one who last gave an order, else the first),
//             else the party's bot leader (the tank, else the lowest id), and regroups after deaths;
//             a leader waits for its party, and everyone waits at the raid gate and readies once the party is there
//   assist    targets what the party is fighting: what's on a party member, what the anchor / a human is hitting or
//             has locked (`ptgt` events), Broken mobs to Switch, marked ones; it doesn't pull extra packs
//   roles     tank: peels and keeps threat; healer: heals the most hurt member (a "heal me" first) from behind the tank;
//             DPS: waits for the tank, flanks, Switches on anyone's Break; support: plays its kit near allies
//   commands  party members (and admins) order bots with /b chat lines or the command wheel (`botcmd` events):
//             follow, stay, come, attack (my target), farm, boss, ready, heal (me), potion, leave, status, cancel;
//             a plan is a list of steps run one after another (shared/bots/plan.js, planrun.js: b.plan, b.setPlan)
//   social    greetings, call-outs, thanks, wipes, kills, level-ups, rate-limited, party chat only (shared/bots/social.js)
//
// createBot() returns the bot object: b.configure({ behaviour, follow }), b.command({ k, by, byName, tgt }),
// b.setSkill(level), b.stop(); b.goal / b.cmd describe what it is doing (admin page).
import { MOBS, MOB_IDS, CLASS_IDS, PLAYER_SPEED, SPRINT_SPEED, inGateZone, inArena } from '../data.js';
import { WAYPOINTS, STAIRWAY, inGateZone2, inArena2, floorOf, floorUnlocked, waypointAwake } from '../floor2.js';
import { FLOOR_BOSS, FLOOR_X, inGateZone3, inArena3 } from '../floor3.js';
import { beamDodge, overloadTurn } from './floor3.js'; // Floor 3 reflexes: Tempest Beam jumps, Overload Breaks
import { arenaTurn } from './arenas.js'; // boss arenas' areas (J2): the fall, cover from the beam
import { applyArenaSnap } from '../arenas.js';
import { applyLabSnap, labAt, portOpen, labWords } from '../labyrinth.js'; // labyrinths: the gate's state, the levers
import { MASTERY, BRANCHES, masteryLevel } from '../mastery.js';
import { TREES, spendBlock, nodesOf } from '../talents.js';
import { perceive, potionAt, setSkill, clampSkill } from '../botskill.js';
import { DT, d2, useSkill, moveToward, evade, stepRoll, waveDodge, dodgeSpot, perilous, switchOpen, travelToBoss } from './motor.js';
import { brainFor, roleOf, runHooks } from './registry.js';
import { basicProfile } from './style.js';
import { STYLE_IDS } from '../styles.js';
import { say } from './social.js';
import { scriptTurn } from './script.js'; // the scene director's script layer (b.script; nothing without it)
import { readDowned, downedTurn, reviveTurn } from './revive.js'; // downed + revive (G1)
import { mechSpot } from './bossteam.js'; // boss team mechanics: stack, spread, tether (G4)
import { readRescue, rescueTurn, rescueTarget, propApproach } from './rescue.js'; // rescue traps: free trapped allies (J1)
import './classes.js'; // built-in class plug-ins (Guardian, Swordsman, Cleric, generic)
import './newclasses.js'; // Ranger, Berserker, Lancer, Bard
import { sigTurn } from './subclass.js'; // slot 5 (docs/briefs/subclasses.md)
import { BOT_SUB } from '../subclasses.js';
import { comboTurn, burstTurn, setupTurn, chainTurn } from './teamplay.js'; // combo payoffs + Team Burst (G2), setups for partners and skill chains
import { readOpenings, openingTurn, gustDodge } from './openings.js'; // boss openings, Gale Push (J3)
import { easeOff } from './threat.js'; // DPS ease off near 90% threat (J4)
import { inYard, ACADEMY } from '../academyyard.js'; // the Academy's trial yard: solo, so followers wait at the door
import { readParts, roleTurn, roleScore, wantsBreak } from './roles.js'; // boss parts, shields, flyers, casters (docs/briefs/combat-quickwins.md)
import { readDuels, foeMobs } from '../duels.js'; // duels: only my opponents' stand-ins are targets (server/duels.js)
import { rollPersonality, potionShift, backOffAt, tankWait, formation, isNeutral } from './personality.js'; // who the bot is (docs/briefs/personalities.md)
import { idleOk, idleBegin, idleMoved, idleHabits, idleEvent, afkNow } from './idle.js'; // idle habits by personality
import { planProgress } from './plan.js'; // plans: a list of steps (docs/briefs/bot-plans.md)
import { setPlan, endPlan, planTurn, planEvent, planNote } from './planrun.js'; // (the runner)
import { dayTurn, dayDied, dayChat, dayInvite, hasDay } from './day.js'; // a free bot's own day (docs/briefs/bot-days.md)

const BOSS_LVL = { 1: 5, 2: 15, 3: 25 }; // a leader levels on its floor's field until this, then goes for the boss
const floorFor = beh => (beh === 'floor3' ? 3 : beh === 'floor2' ? 2 : 0); // a behaviour's own floor (0: none)
const LEASH = 24; // a follower drops its target and regroups beyond this distance from its anchor (not in boss fights)
const byId = (a, c) => a.id - c.id;
const pct = p => p.hp / (p.maxHp || 1);
const inBossRoom = (x, z) => inArena(x, z) || inArena2(x, z) || inArena3(x, z);
const inAnyGate = (x, z) => inGateZone(x, z) || inGateZone2(x, z) || inGateZone3(x, z);

// peers: an optional shared Set of bot ids (bots started together that the server doesn't flag as bots, e.g. test/team.js
// and /bots.html connect as ordinary players).
// persona: an archetype id from shared/bots/personality.js, 'neutral' (none), or null (rolled from the name).
export function createBot({ url, WebSocket: WS = globalThis.WebSocket, cls, name, join = {}, behaviour = 'field', follow = '', skill = 5, floor = 1, branch = null, log = null, logEvents = false, quiet = false, peers = null, persona = null }) {
  const b = {
    cls, name, behaviour, follow: String(follow || ''), floor: floorFor(behaviour) || floor, branch, log, logEvents, quiet,
    id: 0, x: 0, z: 0, seq: 0, face: 0, t: 0, mobs: [], players: [], me: null, dead: false, hp: 1, maxHp: 1, party: 0,
    tele: [], cds: [0, 0, 0, 0, 0], dodgeCd: 0, roll: null, stag: {}, waves: [], orbs: [], pools: [], life: null, cons: null,
    names: new Map(),      // player id -> roster row { name, cls, bot }
    hits: new Map(),       // mob id -> Map(player id -> { first, last }): who is fighting what
    locks: new Map(),      // player id -> the mob they have locked (client `target` message -> `ptgt` events)
    seen: new Map(),       // player id -> { skill id: time last used } (from fx events)
    cmd: null, healFocus: null, goal: 'joining', tgtId: null, engAt: null, tauntT: -99, potT: -99, peers,
  };
  b.role = roleOf(cls);
  b.skill = clampSkill(skill); // capability level; 5 = perfect
  b.persona = rollPersonality(name, persona); // who it is (same name, same personality)
  b.setPersona = id => { b.persona = rollPersonality(b.personaName || b.name, id || null); b.idle = null; }; // (personaName: a resident's own name, kept through "Pip 2" and renames)
  b.send = o => b.ws.readyState === 1 && (b.ws.sendObj ? b.ws.sendObj(o) : b.ws.send(JSON.stringify(o))); // (sendObj: the server's in-process socket, server/localws.js)
  b.configure = o => configure(b, o);
  b.command = c => command(b, c);
  b.setPlan = (raw, o) => setPlan(b, raw, o, PLAN_API); // a list of steps (shared/bots/planrun.js); null when nothing in it is usable
  b.setSkill = v => setSkill(b, v);
  b.stop = () => b.ws.close();
  b.ws = new WS(url);
  b.ws.addEventListener('open', () => b.send({ type: 'join', name, cls, sub: BOT_SUB[cls], ...join })); // sub: its subclass from level 15 (an anonymous join: server/index.js)
  b.ws.addEventListener('close', () => { b.closed = true; b.goal = 'gone'; });
  b.ws.addEventListener('error', () => {}); // (Node's ws throws on an unhandled error event)
  b.ws.addEventListener('message', ev => {
    try { onMessage(b, ev.obj || JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())); } catch (err) { console.error(`bot ${b.name}`, err); } // (ev.obj: in process, already an object; read-only)
  });
  return b;
}

function configure(b, o = {}) {
  if (o.behaviour) { b.behaviour = o.behaviour; b.floor = floorFor(o.behaviour) || 1; }
  if (o.follow !== undefined) b.follow = String(o.follow);
  b.tgtId = null; b.home = null; b.cmd = null; endPlan(b);
}

// ---------------- messages ----------------
function onMessage(b, msg) {
  if (msg.type === 'welcome') { Object.assign(b, { id: msg.id, x: msg.x, z: msg.z, seq: msg.seq }); b.peers?.add(msg.id); }
  if (msg.type === 'inv') { b.life = msg.life; b.cons = msg.cons; b.gold = msg.gold; b.bag = msg.bag; } // (gold and bag: a plan's sell and buy steps; read only)
  if (msg.type === 'roster') { b.roster = msg.players; b.names = new Map(msg.players.map(r => [r.id, r])); }
  if (msg.type === 'mastery') evolve(b, msg.m);
  if (msg.type === 'talents') spendTalent(b, msg);
  if (msg.type === 'path' && msg.cls && msg.cls !== b.cls) { b.cls = msg.cls; b.role = roleOf(msg.cls); } // graduated or changed class at the Academy (server/academy.js)
  if (msg.type === 'snap') onSnap(b, msg);
}

// Talents: spend the next unspent point along the class's `bot` path (one rank per round trip; the server answers with a new 'talents').
function spendTalent(b, msg) {
  if (msg.locked) return; // an Initiate (or a class trial): the tree opens at graduation
  const r = msg.r || {}, path = TREES[b.cls]?.bot || [], want = {};
  const sub = b.me?.sub; // a subclass's two nodes first, once there are points for them (shared/talents.js, docs/briefs/subclasses.md)
  if (sub) for (const n of nodesOf(b.cls)) if (n.sub === sub && (r[n.id] | 0) < n.max && !spendBlock(b.cls, r, (msg.pts | 0) + 1, n.id, sub)) { b.send({ type: 'talent', op: 'spend', id: n.id }); return; }
  for (const id of path) {
    want[id] = (want[id] || 0) + 1;
    if ((r[id] | 0) >= want[id]) continue;
    if (!spendBlock(b.cls, r, (msg.pts | 0) + 1, id)) { b.send({ type: 'talent', op: 'spend', id }); b.log?.(`[talent] ${b.name}: ${id}`); }
    return;
  }
}

// Evolve any skill that reached Mastery 3 (`branch` 'A' / 'B', random when unset).
function evolve(b, m) {
  b.mastery = m;
  for (const [sk, e] of Object.entries(m)) {
    if (e.br || masteryLevel(e.pts) < MASTERY.evolveAt || b.asked?.[sk]) continue;
    const br = b.branch === 'A' || b.branch === 'B' ? b.branch : Math.random() < 0.5 ? 'A' : 'B';
    (b.asked ||= {})[sk] = br;
    b.send({ type: 'evolve', sk, br });
    b.log?.(`[evolve] ${b.name}: ${sk} -> ${BRANCHES[sk]?.[br]?.name || br}`);
  }
}

// The world as bots read it, decoded once per snapshot and shared by every bot handed the same snapshot (the server's
// in-process bots all are: server/index.js parses the world once a tick). Read-only: per-bot notes live on the bot
// (a few per-snapshot marks, p.trap / p.downed / partyView's names, are the same for every bot, so sharing them is safe).
const DECODED = new WeakMap(); // w.mobs (the shared array) -> { mobs, players }
function decodeWorld(w) {
  let d = DECODED.get(w.mobs);
  if (d) return d;
  const th = new Map(w.th || []); // who a boss / elite is after (server/threat.js)
  const mobs = [];
  for (const m of w.mobs) {
    const type = MOB_IDS[m[1]], def = MOBS[type];
    if (def) mobs.push({ id: m[0], type, x: m[2], z: m[3], face: m[4], hp: m[5], maxHp: m[6], engaged: !!(m[7] & 2), enraged: !!(m[7] & 4), winding: !!(m[7] & 16), staggered: !!(m[7] & 32), marked: !!(m[7] & 256), def, tgt: th.get(m[0]) || 0 });
  }
  const players = w.players.map(p => ({ id: p[0], x: p[1], z: p[2], face: p[3], hp: p[4], maxHp: p[5], lvl: p[6], cls: CLASS_IDS[p[7]], party: p[8], dead: !!p[9], style: STYLE_IDS[p[11]] || null }));
  d = { mobs, players };
  DECODED.set(w.mobs, d);
  return d;
}

// What a bot can perceive, like a player on screen: mobs on its floor within AWARE m (about where the fog closes in),
// its floor's boss wherever it stands, and whatever it was told to attack or is already fighting.
export const AWARE = 120;
function perceivable(b, mobs) {
  const fl = floorOf(b.x), keep = b.cmd?.tgt, cur = b.tgtId, r2 = AWARE * AWARE, out = [];
  for (const m of mobs) {
    if (m.id === keep || m.id === cur) { out.push(m); continue; }
    if (floorOf(m.x) !== fl) continue;
    const dx = m.x - b.x, dz = m.z - b.z;
    if (m.def.boss || dx * dx + dz * dz <= r2) out.push(m);
  }
  return out;
}

function onSnap(b, msg) {
  b.dt = msg.dt || DT; b.t += b.dt; // (msg.dt: the server thinks this bot at 10 Hz while it's far from humans and fights, server/index.js)
  b.me = msg.me;
  b.cds = msg.me.cds.map((c, k) => (b.t - (b.pressed?.[k] || -9) < 0.3 ? Math.max(c, 0.2) : c));
  if (b.t - (b.dodgePressed || -9) > 0.3) b.dodgeCd = msg.me.dodge || 0;
  const world = decodeWorld(msg.w);
  b.mobs = perceivable(b, world.mobs);
  b.wasMobs = b.allMobs; // (the snapshot before: a monster that dies is already gone from this one)
  b.allMobs = world.mobs; // (every mob: orders and rescue props name a mob that may be out of sight)
  readDuel(b, msg.w.du); // duels: drop every stand-in but my live opponents' (b.duel: my duel while I'm still in it)
  const f2 = msg.w.f2, f3 = msg.w.f3, fl = floorOf(b.x), gate = fl === 3 ? f3?.gate : fl === 2 ? f2?.gate : msg.w.gate;
  b.gateOpen = !!gate?.[0];
  b.gateReady = gate?.[2] || 0;
  b.ovOn = !!f3?.ov; b.air = f3?.air || []; // Floor 3: the Colossus's Overload; harpies aloft
  applyLabSnap(msg.w.lb); // labyrinths: which gates are up (shared/labyrinth.js; a no-op inside the server)
  applyArenaSnap(f3?.ar); // boss arenas: which area (colliders, sludge, fire) (shared/arenas.js; a no-op inside the server)
  b.orbs = f2?.orbs || []; b.pools = f2?.pools || []; b.deluge = !!(f2?.del || f2?.dcall); // (dcall: the Deluge is being called: head in now)
  b.tb = msg.w.tb || null; // Team Burst gauges (server/teamplay.js teamSnap)
  b.players = world.players; // (shared by every bot on this snapshot: read-only, see decodeWorld)
  const mine = b.players.find(p => p.id === b.id);
  if (mine) {
    if (mine.party !== b.party) onPartyChange(b, mine.party);
    if (b.dead && !mine.dead) { b.tele = []; b.sweep = null; b.roll = null; } // respawned: regroup from town
    Object.assign(b, { hp: mine.hp, maxHp: mine.maxHp, dead: mine.dead, party: mine.party, style: mine.style }); // style: the equipped weapon's (shared/styles.js)
  }
  readDowned(b, msg.w.down); // downed players (p.downed, b.downed)
  readRescue(b, msg.w.trap); // trapped players (p.trap, b.trap)
  readOpenings(b, msg.w.op); // bosses' openings (J3)
  readParts(b, msg.w.bp); // boss parts (b.parts)
  for (const e of perceive(b, msg.w.events)) onEvent(b, e); // (reaction delays / misses below capability 5)
  if (b.t - (b.pruneT || 0) > 5) prune(b);
  think(b);
  if (!b.dead) b.send({ type: 'input', x: +b.x.toFixed(2), z: +b.z.toFixed(2), face: +b.face.toFixed(2), seq: b.seq });
}

function prune(b) {
  b.pruneT = b.t;
  const alive = new Set(b.mobs.map(m => m.id));
  for (const [id, h] of b.hits) {
    if (!alive.has(id)) { b.hits.delete(id); continue; }
    for (const [pid, x] of h) if (b.t - x.last > 20) h.delete(pid);
  }
  for (const id of Object.keys(b.stag)) if (b.stag[id].until < b.t) delete b.stag[id];
}

function onPartyChange(b, party) {
  b.wiped = false;
  if (party) b.greetAt = b.t + 0.8 + Math.random() * 2.2; // greet once the snapshot shows who's in it
  else { if (b.plan && !b.plan.adm) endPlan(b); if (b.cmd && !b.cmd.adm) b.cmd = null; }
  b.healFocus = null;
}

const nameOf = (b, id) => b.names.get(id)?.name || 'friend';
const isBot = (b, id) => !!b.names.get(id)?.bot || !!b.peers?.has(id);
const mateOf = (b, id) => !!b.party && b.players.some(p => p.id === id && p.party === b.party);

function onEvent(b, e) {
  const me = b.id, L = b.logEvents ? b.log : null;
  switch (e.t) {
    case 'tp': if (e.id === me) { b.x = e.x; b.z = e.z; b.seq = e.s; } break;
    case 'invite': if (e.to === me) onInvite(b, e); break;
    case 'stagger':
      b.stag[e.id] = { by: e.by, until: b.t + e.d };
      L?.(`[stagger] mob ${e.id} by ${e.by}`);
      if (e.by === me && b.party) say(b, 'break', { mob: mobName(b, e.id) }, { p: 0.35, cd: 25 });
      else if (mateOf(b, e.by) && !isBot(b, e.by)) say(b, 'switchIn', {}, { p: 0.3, cd: 25 });
      break;
    case 'switch':
      L?.(`[switch] mob ${e.id} by ${e.by}`);
      if (e.by !== me && mateOf(b, e.by) && (e.from === me || !isBot(b, e.by))) say(b, 'niceSwitch', { who: nameOf(b, e.by) }, { p: e.from === me ? 0.5 : 0.35, cd: 20 });
      break;
    case 'tele':
      if (e.k === 'sweep') { b.sweep = { at: b.t + e.d, id: e.follow }; L?.('[sweep] Horn Sweep incoming'); break; }
      b.tele.push({ x: e.x, z: e.z, r: e.r, until: b.t + e.d + 0.2, follow: e.follow, line: e.k === 'line' ? [e.x2, e.z2, e.w] : null });
      break;
    case 'pcancel': b.sweep = null; break;
    case 'perfect': case 'parry': L?.(`[${e.t}] by ${e.id}`); break;
    case 'stair': b.stair = { x: e.x, z: e.z, until: b.t + e.d, f: e.f || 2 }; break;
    case 'sys': if (!e.to) L?.(`[sys] ${e.text}`); break;
    case 'hit': {
      let h = b.hits.get(e.id); if (!h) b.hits.set(e.id, h = new Map());
      const x = h.get(e.by); if (x) x.last = b.t; else h.set(e.by, { first: b.t, last: b.t });
      if (b.plan?.st && (e.by === me || mateOf(b, e.by))) planEvent(b, e, { mob: mobOf(b, e.id), mateOf }); // (a farm step notes what our party hit)
      break;
    }
    case 'die': {
      const h = b.hits.get(e.id);
      if (e.b && h && [...h.keys()].some(id => id === me || mateOf(b, id))) say(b, 'bossKill', {}, { cd: 60 });
      if (b.plan) planEvent(b, e, { hits: h, mob: mobOf(b, e.id), mateOf });
      b.hits.delete(e.id);
      if (b.cmd?.k === 'attack' && b.cmd.tgt === e.id) b.cmd = b.cmd.prev || null;
      break;
    }
    case 'pdie': if (e.id !== me && mateOf(b, e.id) && !isBot(b, e.id)) say(b, 'mateDown', { who: nameOf(b, e.id) }, { p: 0.5, cd: 30 }); break;
    case 'lvl':
      if (e.id === me) {
        say(b, 'levelUp', { n: e.lvl }, { p: 0.4, cd: 90 });
        brainFor(b.cls).onLevel?.(b, e.lvl, ctxBase(b));
        runHooks('onLevel', b, e.lvl, ctxBase(b)); // talent trees / weapon styles spend points here
      } else if (mateOf(b, e.id) && !isBot(b, e.id)) say(b, 'grats', { who: nameOf(b, e.id) }, { p: 0.5, cd: 30 });
      break;
    case 'fx': {
      const who = e.k === 'heal' ? e.by : e.id;
      if (e.s && who) { let s = b.seen.get(who); if (!s) b.seen.set(who, s = {}); s[e.s] = b.t; }
      if (e.k === 'heal' && e.id === me && e.by && e.by !== me && mateOf(b, e.by) && pct(b) < 0.55) say(b, 'thanks', { who: nameOf(b, e.by) }, { p: 0.5, cd: 60 });
      break;
    }
    case 'ptgt': b.locks.set(e.id, e.m); break;
    case 'pjoin':
      if (e.id !== me && b.party && e.party === b.party && !isBot(b, e.id)) say(b, 'joinedHuman', { who: nameOf(b, e.id) }, { cd: 30 });
      break;
    case 'lab': if (e.s === 'lever') b.labLever = { l: e.l, k: e.k, by: e.by || 0, t: b.t }; break; // a labyrinth's lever turned (the `lever` plan step, leverHelp)
    case 'chat': onChat(b, e); break;
    case 'botcmd': onBotCmd(b, e); break;
  }
  idleEvent(b, e, { isBot, mateOf }); // bows to a human who joins, hops back at a partymate
  brainFor(b.cls).onEvent?.(b, e);
  runHooks('onEvent', b, e);
}
const mobName = (b, id) => b.mobs.find(m => m.id === id)?.def.name || 'it';
const mobOf = (b, id) => b.allMobs?.find(m => m.id === id) || b.wasMobs?.find(m => m.id === id); // (also one that died this snapshot)

// Party invites: bots form their own parties with each other; a human's invite wins over a bot-only party.
function onInvite(b, e) {
  const human = !isBot(b, e.from);
  const withHuman = b.party && b.players.some(p => p.party === b.party && p.id !== b.id && !isBot(b, p.id));
  if (b.party && (withHuman || !human)) {
    b.send({ type: 'decline' });
    if (human) say(b, 'busy', {}, { force: true, ch: 's', text: `Sorry ${nameOf(b, e.from)}, I'm already in a party.` });
    return;
  }
  if (!human && hasDay(b) && !b.peers?.has(e.from)) { // (never a teammate: a team forms as before) another bot asks a bot with a day of its own: it joins when it feels like company (shared/bots/day.js)
    const yes = dayInvite(b, e);
    if (Math.random() < 0.6) say(b, 'dayGroup', {}, { force: true, ch: 's', text: yes ? ['Sure.', 'Why not.', 'Let\'s go.'][Math.floor(Math.random() * 3)] : 'Not right now.' });
    if (!yes) return void b.send({ type: 'decline' });
  }
  b.send({ type: 'accept', from: e.from });
}

// ---------------- commands ----------------
// Party bots (and me) by id, for "all" orders and who answers them.
function partyBots(b) {
  const ids = b.players.filter(p => p.id === b.id || (b.party && p.party === b.party && isBot(b, p.id))).map(p => p.id);
  return ids.length ? ids.sort((x, y) => x - y) : [b.id];
}

// Chat is never an order (orders arrive as `botcmd` events: the wheel, or a /b line the server turned into one).
function onChat(b, e) {
  if (e.id === b.id) return;
  if (e.ch === 'p' && e.party === b.party) b.partyChatT = b.t; // someone just spoke: don't talk over them
  if (b.day && dayChat(b, e)) say(b, 'dayAsk', {}, { force: true, ch: 's', text: `Great, ${nameOf(b, e.id)}. Invite's out.` }); // a yes to "Anyone for wolves?"
}

// e.free: the server checked the sender may order this free bot by name; e.no: party bots the sender may not order.
function onBotCmd(b, e) {
  const mine = !!e.party && e.party === b.party;
  const named = !!e.name && e.name.toLowerCase() === b.name.toLowerCase();
  if (e.name && !named) return;
  if (e.no?.includes(b.id)) return;
  if (!mine && !((e.adm || e.free) && named)) return;
  if (e.tgt) b.locks.set(e.by, e.tgt);
  const group = named ? [b.id] : partyBots(b).filter(id => !e.no?.includes(id));
  if (e.cmd === 'plan') return void setPlan(b, e.plan, { by: e.by, byName: e.byName, adm: !mine, at: e.at, group }, PLAN_API); // a list of steps (the server cleaned it)
  command(b, { k: e.cmd, by: e.by, byName: e.byName, tgt: e.tgt || b.locks.get(e.by) || 0, group, all: group.length > 1, adm: !mine, x: e.x, z: e.z }); // (x, z: tend's garden)
}

// c: { k, by (player id, 0 = admin page), byName, tgt (mob id), group (bot ids addressed), all, adm }
function command(b, c) {
  const who = c.byName || 'you', group = c.group || [b.id];
  const first = group.filter(id => id === b.id || b.players.some(p => p.id === id && !p.dead))[0] === b.id; // one bot answers group orders
  const ack = (key, vars = {}, text = null) => !c.quiet && (first || !c.all) && say(b, key, { who, ...vars }, { force: true, text }); // (quiet: a plan's step, the plan speaks for itself)
  const base = { by: c.by || 0, byName: c.byName || 'admin', adm: !!c.adm, at: b.t };
  b.lastCmdBy = c.by || b.lastCmdBy;
  const drop = () => { if (b.plan && !c.plan) endPlan(b); }; // an order that takes effect ends the plan (status, potion, heal, ready, a raid and an order that can't be carried out don't)
  switch (c.k) {
    case 'cancel': drop(); b.cmd = null; b.tgtId = null; return ack('cancel');
    case 'follow': case 'come': {
      const target = c.by ? c.by : c.followId;
      if (!target) return;
      drop();
      b.cmd = { ...base, k: c.k, by: target, byName: c.byName || nameOf(b, target) };
      return ack(c.k);
    }
    case 'stay': drop(); b.cmd = { ...base, k: 'stay', x: b.x, z: b.z }; return ack('stay');
    case 'defend': b.cmd = { ...base, by: 0, k: 'stay', x: +c.x || b.x, z: +c.z || b.z, defend: 1, prev: b.cmd?.defend ? b.cmd.prev : b.cmd || null }; return say(b, 'defend', { who }, { force: true, text: `To the ward of ${c.byName || 'the town'}!` }); // a raid on a town (server/towns.js raidBots)
    case 'release': if (b.cmd?.defend) b.cmd = b.cmd.prev || null; return; // (back to the order it had before the raid)
    case 'tend': if (floorOf(b.x) !== 1) return ack('notFloor1'); drop(); b.cmd = { ...base, by: 0, k: 'stay', x: +c.x || b.x, z: +c.z || b.z, tend: 1 }; return ack('stay'); // hold at the garden (life classes: server/playerbots.js)
    case 'attack': {
      const m = b.mobs.find(m => m.id === c.tgt) || b.allMobs?.find(m => m.id === c.tgt && floorOf(m.x) === floorOf(b.x)); // (an order may name a mob out of sight)
      if (!m) return ack('noTarget');
      drop();
      b.cmd = { ...base, k: 'attack', tgt: m.id, prev: b.cmd?.k === 'attack' ? b.cmd.prev : b.cmd };
      b.tgtId = null;
      return ack('attack', { mob: m.def.name });
    }
    case 'farm': case 'boss': drop(); b.cmd = { ...base, k: c.k, group }; return ack(c.k);
    case 'ready':
      if (!b.gateOpen && inAnyGate(b.x, b.z)) {
        if (!b.me?.ready) { b.readyT = b.t; b.send({ type: 'ready' }); }
        return ack('ready');
      }
      return ack('notGate');
    case 'heal':
      if (b.role !== 'healer') return c.all ? undefined : ack('notHealer');
      if (c.by) b.healFocus = { id: c.by, until: b.t + 45 };
      return say(b, 'healOn', { who }, { force: true });
    case 'potion': return drink(b, true);
    case 'leave':
      say(b, 'leave', {}, { force: true });
      drop(); b.cmd = null; b.healFocus = null;
      return b.send({ type: 'leave' });
    case 'status': return say(b, 'status', {}, { force: true, text: statusText(b) });
    case 'setme': // (the setup itself: shared/bots/teamplay.js, for a partymate only)
      if (!c.by || c.by === b.id) return;
      return c.adm || !b.party ? ack('setme', {}, "Invite me to your party first, then I'll set you up.") : ack('setme');
  }
}

function statusText(b) {
  const pots = b.cons?.potion; // (a plan and its progress are in the goal)
  return `HP ${b.hp}/${b.maxHp} · Lv ${b.me?.lvl ?? '?'} · ${b.dead ? 'down' : b.goal}${pots !== undefined ? ` · ${pots} potion${pots === 1 ? '' : 's'}` : ''}`;
}
const PLAN_API = { command, say };

function drink(b, asked = false) {
  if (b.cons && !(b.cons.potion > 0)) {
    if (asked) return say(b, 'noPotion', {}, { force: true });
    return say(b, 'noPotion', {}, { cd: 90 });
  }
  if ((b.me?.ccd?.potion || 0) > 0 || b.dead) return false;
  b.potT = b.t;
  b.send({ type: 'use', id: 'potion' });
  if (asked) say(b, 'potion', {}, { force: true });
  return true;
}

// ---------------- the party as this bot sees it ----------------
function partyView(b) {
  const me = { ...(b.players.find(p => p.id === b.id) || { id: b.id, hp: b.hp, maxHp: b.maxHp, dead: b.dead, cls: b.cls }), x: b.x, z: b.z, face: b.face };
  const mates = b.party ? b.players.filter(p => p.party === b.party && p.id !== b.id) : [];
  for (const p of [me, ...mates]) {
    const r = b.names.get(p.id);
    p.name = p.id === b.id ? b.name : r?.name || '?';
    p.bot = p.id === b.id || isBot(b, p.id);
    p.role = p.id === b.id ? b.role : roleOf(p.cls);
  }
  const all = [me, ...mates], humans = mates.filter(p => !p.bot).sort(byId), bots = all.filter(p => p.bot).sort(byId);
  const tankFirst = list => list.find(p => p.role === 'tank') || list[0];
  return { me, mates, all, humans, bots, botLeader: tankFirst(bots) };
}

// Who leads and how this bot plays this turn: { mode: 'lead' | 'follow' | 'stay' | 'attack', anchor, beh }.
function decideMode(b, P) {
  const c = b.cmd, find = id => P.all.find(p => p.id === id) || b.players.find(p => p.id === id);
  if (c && !c.adm && c.by && !P.all.some(p => p.id === c.by)) b.cmd = null; // the commander left the party
  if (b.cmd) {
    const k = b.cmd.k, by = find(b.cmd.by);
    if (k === 'stay') return { mode: 'stay', anchor: null };
    if (k === 'attack') {
      if (b.mobs.some(m => m.id === b.cmd.tgt)) return { mode: 'attack', anchor: by && !by.dead ? by : null };
      b.cmd = b.cmd.prev || null;
      return decideMode(b, P);
    }
    if ((k === 'follow' || k === 'come') && by) {
      if (k === 'come' && d2(by.x, by.z, b.x, b.z) < 4) b.cmd.k = 'follow'; // arrived: keep following
      return { mode: 'follow', anchor: by };
    }
    if (k === 'farm' || k === 'boss') {
      const grp = P.bots.filter(p => b.cmd.group?.includes(p.id));
      const lead = grp.find(p => p.role === 'tank') || grp[0] || P.me;
      const beh = k === 'farm' ? 'field' : 'warden';
      return lead.id === b.id ? { mode: 'lead', beh } : { mode: 'follow', anchor: lead, beh };
    }
    b.cmd = null;
  }
  if (P.humans.length) return { mode: 'follow', anchor: P.humans.find(h => h.id === b.lastCmdBy) || P.humans[0] };
  if (b.behaviour === 'follow') { const f = followed(b); if (f) return { mode: 'follow', anchor: f }; }
  if (b.party && P.botLeader && P.botLeader.id !== b.id) return { mode: 'follow', anchor: P.botLeader };
  return { mode: 'lead', beh: b.behaviour === 'own' ? (hasDay(b) ? 'idle' : 'field') : b.behaviour }; // (own: its day's plans do the work; between two it stands about. BOT_DAYS=0: the field)
}

function followed(b) { // the player named by the 'follow' behaviour, as seen in the last snapshot
  if (!b.follow) return null;
  const want = b.follow.toLowerCase(), r = (b.roster || []).find(r => !r.bot && r.name.toLowerCase() === want);
  const p = r && b.players.find(p => p.id === r.id);
  return p ? { ...p, name: r.name, bot: false, role: roleOf(p.cls) } : null;
}

// ---------------- the loop ----------------
function think(b) {
  if (!b.trap) return thinkFree(b);
  // trapped (J1): rooted where we are; vines / pillar: still fight in place; encased in a crystal: nothing to do
  const x = b.x, z = b.z;
  if (b.trap.k !== 'crystal') thinkFree(b);
  else b.goal = 'Encased: waiting to be broken out';
  b.x = x; b.z = z;
}
function thinkFree(b) {
  if (!b.me) return;
  if (b.script && scriptTurn(b)) return; // a scripted actor (server/director.js): its scripted action this turn
  const P = partyView(b);
  social(b, P);
  if (b.dead) { b.goal = 'down'; dayDied(b); return; }
  if (downedTurn(b, P)) return; // downed: crawl to help
  if (arenaTurn(b, moveToward)) return; // a boss arena: frozen through the fall, cover from the Tempest Beam
  if (b.healFocus && (b.healFocus.until < b.t || !P.all.some(p => p.id === b.healFocus.id))) b.healFocus = null;
  leverHelp(b, P); // a labyrinth's two levers: take the one our player is not at
  dayTurn(b, P, PLAN_API); // a free bot's own day picks its next plan (shared/bots/day.js)
  if (b.planNote) planNote(b, PLAN_API);
  if (b.plan) planTurn(b, P, PLAN_API); // a plan's step sets the order (shared/bots/planrun.js)
  const M = decideMode(b, P);
  if (M.anchor && inYard(M.anchor.x, M.anchor.z) && !inYard(b.x, b.z)) M.anchor = { ...M.anchor, x: ACADEMY.x + 6, z: ACADEMY.z + 2, face: 0 }; // (a class trial: wait outside)
  b.mode = M.mode;
  b.anchor = M.anchor ? { id: M.anchor.id, name: M.anchor.name, bot: !!M.anchor.bot } : null;
  upkeep(b, P, M);
  burstTurn(b, P); // join / start a Team Burst
  if (duelWait(b)) return; // a duel's countdown: into the ring, face them
  if (stepRoll(b) || perilous(b) || waveDodge(b) || beamDodge(b) || gustDodge(b) || (!b.duel && travel(b, M))) return;
  if (reviveTurn(b, P)) return; // a partymate is down and it's our job to pick them up
  if (rescueTurn(b, P)) return; // a partymate is caught in vines and it's our job to cut them free
  act(b, P, M);
}

// A labyrinth's two levers have to turn within seconds of each other (server/labyrinth.js labAct). When this bot's one
// player stands at a lever, or has just turned one, one bot of the party goes to work the other by itself (the `lever`
// plan step, shared/bots/planrun.js). An order or a plan comes first, and two players work them together.
const LEVER_NEAR = 3.2, LEVER_STAND = 1.5, LEVER_AGAIN = 45, LEVER_WAIT = 90; // m, s, s, s
function leverHelp(b, P) {
  if (!P.humans.length || b.plan || b.script || (b.cmd && b.cmd.k !== 'follow' && b.cmd.k !== 'come') || b.t - (b.leverT ?? -99) < LEVER_AGAIN) return;
  const L = labAt(b.x, b.z);
  if (!L?.leverList || portOpen(L)) { b.leverAt = null; return; }
  const inL = p => !p.dead && labAt(p.x, p.z) === L, hs = P.humans.filter(inL);
  if (hs.length !== 1) return;
  const h = hs[0], lv = L.leverList.find(lv => d2(lv.x, lv.z, h.x, h.z) < LEVER_NEAR);
  const ev = b.labLever, turned = !!ev && ev.l === L.id && ev.by === h.id && b.t - ev.t < 3;
  if (!lv) b.leverAt = null; else if (b.leverAt?.k !== lv.k) b.leverAt = { k: lv.k, t: b.t };
  if (!turned && !(lv && b.t - b.leverAt.t > LEVER_STAND)) return;
  const helper = P.bots.filter(inL).sort((u, v) => (u.role === 'healer') - (v.role === 'healer') || u.id - v.id)[0]; // (the healer stays with the player when another bot can go)
  if (helper?.id !== b.id) return;
  b.leverT = b.t; b.leverAt = null;
  if (setPlan(b, [{ k: 'lever', n: LEVER_WAIT }], { by: h.id, byName: h.name, quiet: true }, PLAN_API)) say(b, 'plan', {}, { force: true, text: `I'll get the other ${labWords(L).lever.toLowerCase()}, ${h.name}.` });
}

function social(b, P) {
  if (b.greetAt && b.t > b.greetAt) {
    b.greetAt = 0;
    if (P.humans.length) say(b, 'greet', { role: b.role }, { force: true });
  }
  const allDown = !!b.party && P.all.length > 1 && P.all.every(p => p.dead);
  if (allDown && !b.wiped) { b.wiped = true; say(b, 'wipe', {}, { p: 0.8, cd: 60 }); }
  if (!allDown) b.wiped = false;
}

function upkeep(b, P, M) {
  // Raid gate: ready up once the party is all at the gate (with humans: once someone readied, or when ordered).
  if (!b.script && !b.gateOpen && inAnyGate(b.x, b.z) && !b.me.ready && b.t - (b.readyT || -9) > 1) { // (scripted actors ready only when told)
    const there = P.all.filter(p => !p.dead).every(p => inAnyGate(p.x, p.z));
    const ordered = b.cmd?.k === 'boss';
    if (there && (!P.humans.length || ordered || b.gateReady > 0)) { b.readyT = b.t; b.send({ type: 'ready' }); }
    else if (!there) say(b, 'gateWait', {}, { p: 0.5, cd: 90 });
  }
  const potAt = potionAt(b); // (0: forgot this time)
  if (!b.rev && potAt > 0 && b.hp / b.maxHp < potAt + potionShift(b) && b.t - b.potT > 10) { if (!drink(b)) b.potT = b.t; }
  if (b.hp / b.maxHp < backOffAt(b) && b.tgtId && b.t - (b.lowT || -99) > 20) {
    b.lowT = b.t;
    say(b, 'lowHp', {}, { p: 0.7, cd: 25 });
    if (b.role !== 'tank' && b.role !== 'healer' && P.all.some(p => p.role === 'healer' && !p.dead && p.id !== b.id)) b.backOff = b.t + 1.2;
  }
}

// Floors 2 and 3: the Stairway right after a boss kill (Warden: up to Floor 2; Sovereign: up to Floor 3), otherwise this
// floor's waypoint, its town centrepiece (once unlocked). Goes when the bot leads a run on a higher floor, or when its anchor is up there.
function travel(b, M) {
  const own = floorFor(M.beh) || (M.beh === b.behaviour ? floorFor(b.behaviour) : 0);
  const c = b.cmd; // a plan's place (also one it was left waiting at), or its player, on another floor (down to Floor 1 too)
  const post = M.mode === 'stay' && (c?.plan || c?.post) ? c.fl || 0 : c?.plan && M.mode === 'follow' && M.anchor && (c.k === 'come' || c.k === 'follow') ? floorOf(M.anchor.x) : 0;
  const want = post || (M.mode === 'lead' ? own : M.anchor ? floorOf(M.anchor.x) : 0), here = floorOf(b.x);
  if ((want < 2 && !post) || here === want || !floorUnlocked(b.life, want)) return false;
  if (M.mode === 'lead' && here > want) return false; // already above the run's floor (e.g. a Floor 2 bot up on Floor 3)
  b.goal = `Travelling to Floor ${want}`;
  const warp = () => { if (b.t - (b.warpT || -9) > 1) { b.warpT = b.t; b.send({ type: 'warp', f: want }); } };
  if (b.stair && b.stair.f === want && b.stair.until > b.t + 2 && b.z > 150 && floorOf(b.stair.x) === here) {
    if (!moveToward(b, b.stair.x, b.stair.z, 1.2) || d2(b.x, b.z, b.stair.x, b.stair.z) < STAIRWAY.use - 0.5) warp();
    return true;
  }
  if (b.z > 150 && !b.gateOpen) return false; // shut in the chamber: wait for the next Stairway
  const w = WAYPOINTS.find(w => w.floor === here) || WAYPOINTS[0], ox = FLOOR_X[here] ?? 0;
  if (!waypointAwake(w, b.life)) return false; // (dormant for this bot: Floor 1's well until Floor 2 is unlocked; the same check as the warp)
  if (b.z > 20 && Math.abs(b.x - ox) > 3) { moveToward(b, ox, b.z - 6); return true; } // back to the road, then south to the camp
  // the near side of the centrepiece: just outside its collision ring (r + 0.8), inside its use distance (R + 0.45 < use)
  const dx = b.x - w.x, dz = b.z - w.z, L = Math.hypot(dx, dz), ux = L > 0.01 ? dx / L : 0, uz = L > 0.01 ? dz / L : 1, R = w.r + 0.8;
  if (!moveToward(b, w.x + ux * R, w.z + uz * R, 0.3) || L < R + 0.45) warp();
  return true;
}

// Context handed to class plug-ins (see shared/bots/registry.js).
function ctxBase(b) {
  return { basic: basicProfile(b.cls, b.style), useSkill, moveToward, switchOpen, d2, dodge: null, ready: true, anchor: null, tank: null, leader: null, party: { mates: [], humans: [], all: [] }, hurt: [], healFocus: null, engaged: null, mayBreak: true, peel: false, say: (k, v, o) => say(b, k, v, o) };
}

function act(b, P, M) {
  let tgt = b.duel ? duelFoe(b) : (!b.trap && rescueTarget(b, P)) || chooseTarget(b, P, M); // a duel: only my opponents; a trap object to break first (J1)
  const anchor = M.anchor && !M.anchor.dead ? M.anchor : null;
  // cohesion: too far from the anchor, drop the fight and regroup (but never walk out of a boss fight)
  if (anchor && !b.duel && M.mode !== 'stay' && d2(anchor.x, anchor.z, b.x, b.z) > LEASH && !(tgt?.def.boss && inBossRoom(b.x, b.z)) && M.mode !== 'attack') tgt = null;
  if ((tgt?.id ?? null) !== b.tgtId) {
    if (tgt?.def.boss && M.mode === 'lead' && b.party) say(b, 'pull', { mob: tgt.def.name.replace(/^The /, '') }, { cd: 120 });
    b.tgtId = tgt?.id ?? null; b.engAt = null;
  }
  let dodge = dodgeSpot(b);
  if (dodge) evade(b, ...dodge);
  else if ((dodge = mechSpot(b))) moveToward(b, dodge[0], dodge[1], 0.3); // stack / spread / tether: walk there, still fighting
  const brain = brainFor(b.cls);
  const ctx = makeCtx(b, P, M, tgt, dodge);
  b.goal = goalText(b, P, M, tgt);
  if (!tgt) {
    if (!dodge) idle(b, P, M);
    brain.idle?.(b, ctx);
    return;
  }
  if (b.engAt === null && (d2(b.x, b.z, tgt.x, tgt.z) < tgt.def.radius + 3 || b.hits.get(tgt.id)?.has(b.id))) b.engAt = b.t;
  if (b.backOff > b.t && !dodge) { // low: step out of the fight for a moment
    const a = Math.atan2(b.x - tgt.x, b.z - tgt.z);
    moveToward(b, b.x + Math.sin(a) * 3, b.z + Math.cos(a) * 3, 0.2, SPRINT_SPEED);
    return;
  }
  if (!dodge && tgt.def.prop) { // a trap object (J1): sprint over, then hit it from there (the class brain doesn't walk us off)
    if (propApproach(b, tgt, ctx.basic.kind === 'ranged')) return;
    const x = b.x, z = b.z, face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
    if (!brain.combat || brain.combat(b, tgt, ctx) === false) brainFor('*').combat(b, tgt, ctx);
    b.x = x; b.z = z; b.face = face;
    useSkill(b, 0, face); // (no-op while on cooldown)
    b.goal = `Breaking the ${tgt.def.name}`;
    return;
  }
  if (!dodge && overloadTurn(b, tgt)) return; // Floor 3: the Colossus is Overloading: Break it
  if (!dodge && openingTurn(b, tgt, ctx)) return; // a boss opening: melee in, then out before it closes (J3)
  if (comboTurn(b, tgt, ctx)) return; // a partner's combo setup on the target: cash it in
  if (easeOff(b, tgt, ctx)) b.easeT = b.t; // near 90% threat: keep position, hold attacks (skill 4+)
  else if (setupTurn(b, tgt, ctx) || chainTurn(b, tgt, ctx)) return; // open our setup for a partner (Set me up); keep our skill chain going
  if (b.easeT !== b.t && sigTurn(b, tgt, ctx)) return; // slot 5: a subclass's signature skill (shared/bots/subclass.js)
  const fight = () => { if (!brain.combat || brain.combat(b, tgt, ctx) === false) brainFor('*').combat(b, tgt, ctx); };
  if (b.easeT !== b.t && roleTurn(b, tgt, ctx, fight)) return; // melee: a boss part's arc, or round a shield (shared/bots/roles.js)
  fight();
}

function makeCtx(b, P, M, tgt, dodge) {
  const ctx = ctxBase(b);
  const alive = P.all.filter(p => !p.dead && !p.downed);
  const tank = alive.find(p => p.role === 'tank' && p.id !== b.id) || null;
  const tankOn = tgt && tank && d2(tank.x, tank.z, tgt.x, tgt.z) < 12 ? tank : null;
  const hTank = tgt && tankOn ? b.hits.get(tgt.id)?.get(tankOn.id) : null;
  ctx.dodge = dodge;
  ctx.tank = tank;
  ctx.leader = M.mode === 'lead' ? null : M.anchor || null;
  ctx.anchor = tankOn || (M.anchor && !M.anchor.dead && M.anchor.id !== b.id ? M.anchor : null);
  ctx.ready = b.role === 'tank' || !tankOn || (!!hTank && b.t - hTank.first > tankWait(b)); // (patience: 0.6-1.8 s)
  if (tgt?.def.prop) { ctx.ready = true; ctx.anchor = null; } // a trap object (J1): straight at it
  ctx.party = { mates: P.mates, humans: P.humans, all: P.all };
  ctx.hurt = [...P.all.filter(p => p.downed?.by && d2(p.x, p.z, b.x, b.z) < 15), // a body being revived: a Heal speeds it up
    ...alive.filter(p => pct(p) < 0.78 && d2(p.x, p.z, b.x, b.z) < 15).sort((x, y) => pct(x) - pct(y))];
  ctx.healFocus = b.healFocus ? alive.find(p => p.id === b.healFocus.id) || null : null;
  ctx.engaged = b.engAt === null ? null : b.t - b.engAt;
  if (tank && tgt) { // the tank's Ground Slam: Break it ourselves only while that's on cooldown (or the tank isn't Breaking)
    const slam = b.seen.get(tank.id)?.gslam, held = b.hits.get(tgt.id)?.get(tank.id);
    ctx.mayBreak = slam !== undefined ? b.t - slam < 6 || b.t - slam > 16 : !held || b.t - held.first > 8;
  }
  if (b.ovMob && tgt?.id === b.ovMob) ctx.mayBreak = true; // Overload (Floor 3): everyone Breaks
  if (wantsBreak(tgt)) ctx.mayBreak = true; // armour and shields that Break (shared/bots/roles.js)
  ctx.peel = b.role === 'tank' && b.mobs.some(m => m.engaged && !m.def.boss && d2(m.x, m.z, b.x, b.z) < 8 + m.def.radius
    && alive.some(p => p.id !== b.id && p.role !== 'tank' && d2(p.x, p.z, m.x, m.z) < m.def.radius + 2.5));
  return ctx;
}

// ---------------- duels ----------------
// The snapshot's duels (shared/duels.js): b.duel = my duel while I'm in it and it's on; b.foes = my live opponents'
// stand-in mob ids. Every other stand-in leaves b.mobs (a duel between others is none of my business).
function readDuel(b, rows) {
  const duels = rows ? readDuels(rows) : [];
  b.foes = foeMobs(duels, b.id);
  b.duel = duels.find(d => d.state < 2 && d.fighters.some(f => f.id === b.id && !f.out)) || null;
  if (rows) b.mobs = b.mobs.filter(m => !m.def.duel || b.foes.has(m.id));
  else if (b.mobs.some(m => m.def.duel)) b.mobs = b.mobs.filter(m => !m.def.duel);
}
function duelFoe(b) { return nearest(b.mobs, m => (b.foes.has(m.id) ? d2(m.x, m.z, b.x, b.z) : null)); }
// Countdown (or the moment before the stand-ins show): stay well inside the ring, face the nearest opponent.
function duelWait(b) {
  const d = b.duel;
  if (d?.state === 1 && duelFoe(b) && d2(b.x, b.z, d.x, d.z) > d.r - 3) { moveToward(b, d.x, d.z, 1); b.goal = 'Duelling: back into the ring'; return true; }
  if (!d || (d.state === 1 && duelFoe(b))) return false;
  if (d2(b.x, b.z, d.x, d.z) > d.r * 0.6) moveToward(b, d.x, d.z, 1);
  const me = d.fighters.find(f => f.id === b.id), foe = b.players.filter(p => d.fighters.some(f => f.id === p.id && f.side !== me?.side && !f.out))
    .sort((u, v) => d2(u.x, u.z, b.x, b.z) - d2(v.x, v.z, b.x, b.z))[0];
  if (foe) b.face = Math.atan2(foe.x - b.x, foe.z - b.z);
  b.goal = d.state === 0 ? 'Duel: waiting for FIGHT' : 'Duelling';
  return true;
}

// ---------------- targets ----------------
function chooseTarget(b, P, M) {
  const fl = floorOf(b.x), here = b.mobs.filter(m => floorOf(m.x) === fl);
  if (M.mode === 'attack') return here.find(m => m.id === b.cmd.tgt) || null;
  if (M.mode === 'stay') { // only what comes to us
    const c = b.cmd;
    if (c.defend || c.guard) return nearest(here, m => { if (m.def.boss || (c.guard && m.def.prop)) return null; const d = d2(m.x, m.z, c.x, c.z); return d < (c.defend ? 22 : 14) ? d2(m.x, m.z, b.x, b.z) : null; }); // a town's raid: anything near the ward; a plan's guard step: anything near the post
    return nearest(here, m => { const d = d2(m.x, m.z, b.x, b.z); return m.engaged && (d < m.def.radius + 3 || d2(m.x, m.z, c.x, c.z) < 7) ? d : null; });
  }
  if (M.mode === 'lead') {
    const t = leadTarget(b, M.beh, here);
    if (t?.def.boss || !b.party) return t;
    return assistTarget(b, P, null, here, t) || t; // a leader still helps a teammate in trouble
  }
  return assistTarget(b, P, M.anchor, here, null);
}

function nearest(list, score) {
  let best = null, bd = 1e9;
  for (const m of list) { const s = score(m); if (s !== null && s < bd) { bd = s; best = m; } }
  return best;
}

// Follower targeting: what the party is fighting. Never starts a fight on its own (no extra packs).
function assistTarget(b, P, anchor, here, leading) {
  const t = b.t, alive = P.all.filter(p => !p.dead), ax = anchor?.x ?? b.x, az = anchor?.z ?? b.z;
  const mates = new Set(P.all.map(p => p.id)), bossRoom = inBossRoom(ax, az) || inBossRoom(b.x, b.z), ranged = basicProfile(b.cls, b.style).kind === 'ranged';
  return nearest(here, m => {
    const dMe = d2(m.x, m.z, b.x, b.z);
    if (d2(m.x, m.z, ax, az) > 18 && dMe > 8) return null;
    const h = b.hits.get(m.id);
    let partyHit = false, focus = false;
    if (h) for (const [pid, x] of h) {
      if (!mates.has(pid) || t - x.last > 4) continue;
      if (pid !== b.id) partyHit = true;
      if (anchor && pid === anchor.id && t - x.last < 3) focus = true;
    }
    if (!focus) focus = P.humans.some(hm => b.locks.get(hm.id) === m.id && (m.engaged || partyHit));
    const onMate = m.engaged && alive.some(p => d2(p.x, p.z, m.x, m.z) < m.def.radius + 3);
    const totem = b.role !== 'healer' && m.type === 'spitter' && inArena(m.x, m.z) && bossRoom;
    const mine = h?.has(b.id) && t - h.get(b.id).last < 4;
    if (!(focus || partyHit || onMate || totem || mine || m.id === leading?.id)) return null;
    if (m.def.boss && !(focus || partyHit || (m.engaged && bossRoom))) return null;
    let s = dMe;
    if (focus) s -= 60;
    if (onMate) s -= b.role === 'tank' && alive.some(p => p.role !== 'tank' && d2(p.x, p.z, m.x, m.z) < m.def.radius + 3) ? 70 : 30;
    if (partyHit) s -= 25;
    if (totem) s -= 80;
    if (m.marked) s -= 15;
    if (b.role !== 'healer' && switchOpen(b, m)) s -= 30;
    if (m.id === b.tgtId) s -= 10;
    s += roleScore(b, m, ranged); // flyers, casters mid-heal (shared/bots/roles.js)
    if (leading && m.id !== leading.id && !onMate) return null; // a leader only switches to help someone
    return s;
  });
}

// Leader targeting by behaviour (the classic progression and the single-bot behaviours).
// Progression: boars until level 3, wolves until level 5, then the Warden. Floor 2: the Mire until 15, then the Sovereign.
function pickProgress(b, here, minBoss) {
  const lvl = b.me?.lvl || 1, fl = floorOf(b.x), f2 = fl > 1; // (f2: any floor above the first)
  minBoss ??= BOSS_LVL[fl];
  if (b.noBoss) minBoss = 99; // told to keep to the field (the Named, server/named.js)
  const boss = here.find(m => m.type === FLOOR_BOSS[fl]);
  if (boss && b.z > 162 && lvl >= minBoss) return boss;
  const want = lvl >= minBoss ? null : f2 ? 'mire' : lvl < 3 ? 'boar' : 'wolf';
  return nearest(here, m => {
    if (m.def.boss) return null;
    const d = d2(m.x, m.z, b.x, b.z);
    const hunt = want === 'mire' ? m.type !== 'thrall' : m.type === want;
    const threat = m.engaged && d < 15;
    const inWay = want === null && d < 15 && (f2 || m.type === 'wolf' || m.engaged);
    if (!(hunt || threat || inWay)) return null;
    return d - (threat ? 100 : 0);
  });
}

function leadTarget(b, beh, here) {
  const lvl = b.me?.lvl || 1, f2 = floorOf(b.x) > 1;
  const threat = r => nearest(here, m => { const d = d2(m.x, m.z, b.x, b.z); return !m.def.boss && m.engaged && d < r ? d : null; });
  if (beh === 'follow') return threat(6);
  if (beh === 'idle') return threat(8); // between two goals of its day: only what attacks it
  if (beh === 'field') {
    const kind = b.cmd?.k === 'farm' && b.cmd.mob; // a plan's farm step: that kind of monster only (and what attacks us)
    if (kind) return threat(8) || nearest(here, m => (m.type === kind && !inBossRoom(m.x, m.z) ? d2(m.x, m.z, b.x, b.z) : null));
    if (f2) return threat(10);
    return nearest(here, m => {
      const d = d2(m.x, m.z, b.x, b.z), fight = m.engaged && d < 12;
      if (m.def.boss || m.z > 150 || d > 30) return null;
      if (!fight && ((lvl < 3 && m.type !== 'boar') || (lvl < 6 && m.type === 'alpha'))) return null;
      return d - (fight ? 100 : 0);
    });
  }
  return pickProgress(b, here, beh === 'warden' ? 0 : undefined);
}

// ---------------- moving without a target ----------------
function idle(b, P, M) {
  const calm = idleOk(b), s = calm ? idleBegin(b) : null; // personality habits (shared/bots/idle.js)
  const walk = (x, z, stop, speed) => { if (calm) b.calmT = b.t; const moved = moveToward(b, x, z, stop, speed); if (moved && s) idleMoved(b); return moved; }; // (calm: a weave, capped turning)
  if (M.mode === 'stay') { if (!walk(b.cmd.x, b.cmd.z, b.cmd.stop ?? 0.8, d2(b.cmd.x, b.cmd.z, b.x, b.z) > 12 && b.cmd.plan ? SPRINT_SPEED : PLAYER_SPEED) && calm) idleHabits(b, P); return; } // (stop: a plan's place has its own size)
  const a = M.anchor;
  if (M.mode !== 'lead' && a) {
    if (a.dead) { if (calm) idleHabits(b, P); return; } // hold here until they're back
    // formation: fan out behind the anchor (each personality keeps its own spot and distance, drifting a little)
    const flock = P.bots.filter(p => p.id !== a.id).map(p => p.id);
    const k = Math.max(0, flock.indexOf(b.id)), n = Math.max(1, flock.length), F = formation(b);
    const drift = isNeutral(b) ? 0 : Math.sin(b.t * 0.15 + (b.persona.phase || 0)) * 0.25;
    const ang = (a.face || 0) + Math.PI + (k - (n - 1) / 2) * 0.8 + F.ang + drift, r = F.r + (k % 2) * 0.6;
    const sx = a.x + Math.sin(ang) * r, sz = a.z + Math.cos(ang) * r, dA = d2(a.x, a.z, b.x, b.z);
    if (s?.sit && dA <= Math.max(6, F.r + 2.6)) return idleHabits(b, P); // sitting: stay down until the anchor walks off
    if (dA > Math.max(5, F.r + 1.6) || d2(sx, sz, b.x, b.z) > 1.5) walk(sx, sz, 0.6, dA > 9 ? SPRINT_SPEED : PLAYER_SPEED);
    else if (calm) idleHabits(b, P);
    return;
  }
  // leading: wait for bot teammates that fell behind (e.g. respawned in town), up to 20 s at a time
  const behind = P.mates.some(p => p.bot && !p.dead && floorOf(p.x) === floorOf(b.x) && d2(p.x, p.z, b.x, b.z) > 20);
  if (behind && !inBossRoom(b.x, b.z)) {
    b.waitFrom ??= b.t;
    if (b.t - b.waitFrom < 20) { if (calm) idleHabits(b, P); return; }
  } else b.waitFrom = null;
  const beh = M.beh, fl = floorOf(b.x), lvl = b.me?.lvl || 1;
  if (beh === 'follow' || beh === 'idle') { if (calm) idleHabits(b, P); return; }
  if (beh === 'field') {
    if (calm && afkNow(b, P.humans.length > 0)) { idleHabits(b, P); return; } // a free bot farming alone: a short break now and then
    const kind = b.cmd?.k === 'farm' && b.cmd.mob, far = kind && nearest(b.allMobs || [], m => (m.type === kind && floorOf(m.x) === fl && !inBossRoom(m.x, m.z) ? d2(m.x, m.z, b.x, b.z) : null));
    if (far) { walk(far.x, far.z, 8, SPRINT_SPEED); return; } // a plan's farm step: over to where that kind lives
    const [x, z] = fieldSpot(b); walk(x, z, 1); return;
  }
  if (beh !== 'warden' && (b.noBoss || lvl < BOSS_LVL[fl])) { walk(FLOOR_X[fl], fl > 1 ? 70 : 60); return; } // into the field
  travelToBoss(b);
}

function fieldSpot(b) { // wander between random spots in the field (boar meadow first)
  if (!b.home || d2(b.x, b.z, b.home[0], b.home[1]) < 4 || b.t > b.homeUntil) {
    const low = (b.me?.lvl || 1) < 3;
    b.home = [-50 + Math.random() * 100, low ? 40 + Math.random() * 50 : 45 + Math.random() * 90];
    b.homeUntil = b.t + 25;
  }
  return b.home;
}

function goalText(b, P, M, tgt) {
  if (b.plan?.day && !b.duel) { // its own day: what and why ("Hunting Forest Boars (4/12): levelling up")
    const s = b.plan.steps[b.plan.i], d = b.day, n = s?.k === 'farm' ? ` (${b.plan.st?.kills || 0}/${s.n})` : '';
    return `${tgt ? `Fighting ${tgt.def.name} · ` : ''}${d?.text || 'Plan'}${n}${d?.why ? `: ${d.why}` : ''}`;
  }
  if (b.cmd?.day && b.day?.text && !b.duel) return `${tgt ? `Fighting ${tgt.def.name} · ` : ''}${b.day.text}${b.day.why ? `: ${b.day.why}` : ''}`; // helping a player: its own choice, nobody's order
  const plan = b.plan ? planProgress(b) : '';
  if (plan && !b.duel) return `${tgt ? `Fighting ${tgt.def.name}` : 'Plan'} (${plan})`;
  if (b.duel) return `Duelling ${tgt ? b.names.get(b.duel.fighters.find(f => f.mob === tgt.id)?.id)?.name || 'an opponent' : ''}`.trim();
  const fight = tgt ? `Fighting ${tgt.def.name}` : '';
  if (M.mode === 'stay') return `${fight || 'Holding position'}${b.cmd?.byName ? ` (${b.cmd.byName}'s order)` : ''}`;
  if (M.mode === 'attack') return `Attacking ${tgt?.def.name || 'target'} (${b.cmd.byName}'s order)`;
  if (M.mode === 'follow') return fight ? `${fight} with ${M.anchor.name}` : M.anchor.dead ? `Waiting for ${M.anchor.name}` : `Following ${M.anchor.name}`;
  if (fight) return fight;
  const gate = !b.gateOpen && inAnyGate(b.x, b.z);
  if (b.waitFrom != null && b.t - b.waitFrom < 20) return 'Waiting for the party';
  if (b.idle && b.t < b.idle.afkUntil && M.mode === 'lead' && !P.humans.length) return 'AFK';
  if (M.beh === 'field') return 'Farming the field';
  if (M.beh === 'idle') return 'Deciding what to do next';
  if (M.beh === 'follow') return `Looking for ${b.follow || 'a player'}`;
  if (M.beh !== 'warden' && b.noBoss) return floorOf(b.x) > 1 ? 'Hunting the field' : 'Farming the field';
  if (M.beh !== 'warden' && (b.me?.lvl || 1) < BOSS_LVL[floorOf(b.x)]) return 'Levelling up';
  const boss = ({ 1: 'Warden', 2: 'Sovereign', 3: 'Colossus' })[floorOf(b.x)];
  if (inBossRoom(b.x, b.z) && !b.mobs.some(m => m.def.boss && floorOf(m.x) === floorOf(b.x))) return `Waiting for the ${boss} to rise`; // killed: it respawns here
  return gate ? 'Waiting at the raid gate' : `Heading to the ${boss}`;
}
