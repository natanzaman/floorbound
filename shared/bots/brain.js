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
//             follow, stay, come, attack (my target), farm, boss, ready, heal (me), potion, leave, status
//   social    greetings, call-outs, thanks, wipes, kills, level-ups, rate-limited, party chat only (shared/bots/social.js)
//
// createBot() returns the bot object: b.configure({ behaviour, follow }), b.command({ k, by, byName, tgt }),
// b.setSkill(level), b.stop(); b.goal / b.cmd describe what it is doing (admin page).
import { MOBS, MOB_IDS, CLASS_IDS, PLAYER_SPEED, SPRINT_SPEED, inGateZone, inArena } from '../data.js';
import { F2, WAYSTONES, STAIRWAY, inGateZone2, inArena2, onFloor2, floorUnlocked } from '../floor2.js';
import { MASTERY, BRANCHES, masteryLevel } from '../mastery.js';
import { TREES, spendBlock } from '../talents.js';
import { perceive, potionAt, setSkill, clampSkill } from '../botskill.js';
import { DT, d2, useSkill, moveToward, evade, stepRoll, waveDodge, dodgeSpot, perilous, switchOpen, travelToBoss } from './motor.js';
import { brainFor, roleOf, runHooks } from './registry.js';
import { basicProfile } from './style.js';
import { STYLE_IDS } from '../styles.js';
import { say } from './social.js';
import { scriptTurn } from './script.js'; // the scene director's script layer (b.script; nothing without it)
import { readDowned, downedTurn, reviveTurn } from './revive.js'; // downed + revive (G1)
import { mechSpot } from './bossteam.js'; // boss team mechanics: stack, spread, tether (G4)
import './classes.js'; // built-in class plug-ins (Guardian, Swordsman, Cleric, generic)
import './newclasses.js'; // Ranger, Berserker, Lancer, Bard

const F2_BOSS_LVL = 15;
const LEASH = 24; // a follower drops its target and regroups beyond this distance from its anchor (not in boss fights)
const byId = (a, c) => a.id - c.id;
const pct = p => p.hp / (p.maxHp || 1);
const inBossRoom = (x, z) => inArena(x, z) || inArena2(x, z);

// peers: an optional shared Set of bot ids (bots started together that the server doesn't flag as bots, e.g. test/team.js
// and /bots.html connect as ordinary players).
export function createBot({ url, WebSocket: WS = globalThis.WebSocket, cls, name, join = {}, behaviour = 'field', follow = '', skill = 5, floor = 1, branch = null, log = null, logEvents = false, quiet = false, peers = null }) {
  const b = {
    cls, name, behaviour, follow: String(follow || ''), floor: behaviour === 'floor2' ? 2 : floor, branch, log, logEvents, quiet,
    id: 0, x: 0, z: 0, seq: 0, face: 0, t: 0, mobs: [], players: [], me: null, dead: false, hp: 1, maxHp: 1, party: 0,
    tele: [], cds: [0, 0, 0, 0], dodgeCd: 0, roll: null, stag: {}, waves: [], orbs: [], pools: [], life: null, cons: null,
    names: new Map(),      // player id -> roster row { name, cls, bot }
    hits: new Map(),       // mob id -> Map(player id -> { first, last }): who is fighting what
    locks: new Map(),      // player id -> the mob they have locked (client `target` message -> `ptgt` events)
    seen: new Map(),       // player id -> { skill id: time last used } (from fx events)
    cmd: null, healFocus: null, goal: 'joining', tgtId: null, engAt: null, tauntT: -99, potT: -99, peers,
  };
  b.role = roleOf(cls);
  b.skill = clampSkill(skill); // capability level; 5 = perfect
  b.send = o => b.ws.readyState === 1 && b.ws.send(JSON.stringify(o));
  b.configure = o => configure(b, o);
  b.command = c => command(b, c);
  b.setSkill = v => setSkill(b, v);
  b.stop = () => b.ws.close();
  b.ws = new WS(url);
  b.ws.addEventListener('open', () => b.send({ type: 'join', name, cls, ...join }));
  b.ws.addEventListener('close', () => { b.closed = true; b.goal = 'gone'; });
  b.ws.addEventListener('error', () => {}); // (Node's ws throws on an unhandled error event)
  b.ws.addEventListener('message', ev => {
    try { onMessage(b, JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())); } catch (err) { console.error(`bot ${b.name}`, err); }
  });
  return b;
}

function configure(b, o = {}) {
  if (o.behaviour) { b.behaviour = o.behaviour; b.floor = o.behaviour === 'floor2' ? 2 : 1; }
  if (o.follow !== undefined) b.follow = String(o.follow);
  b.tgtId = null; b.home = null; b.cmd = null;
}

// ---------------- messages ----------------
function onMessage(b, msg) {
  if (msg.type === 'welcome') { Object.assign(b, { id: msg.id, x: msg.x, z: msg.z, seq: msg.seq }); b.peers?.add(msg.id); }
  if (msg.type === 'inv') { b.life = msg.life; b.cons = msg.cons; }
  if (msg.type === 'roster') { b.roster = msg.players; b.names = new Map(msg.players.map(r => [r.id, r])); }
  if (msg.type === 'mastery') evolve(b, msg.m);
  if (msg.type === 'talents') spendTalent(b, msg);
  if (msg.type === 'snap') onSnap(b, msg);
}

// Talents: spend the next unspent point along the class's `bot` path (one rank per round trip; the server answers with a new 'talents').
function spendTalent(b, msg) {
  const r = msg.r || {}, path = TREES[b.cls]?.bot || [], want = {};
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

function onSnap(b, msg) {
  b.t += DT;
  b.me = msg.me;
  b.cds = msg.me.cds.map((c, k) => (b.t - (b.pressed?.[k] || -9) < 0.3 ? Math.max(c, 0.2) : c));
  if (b.t - (b.dodgePressed || -9) > 0.3) b.dodgeCd = msg.me.dodge || 0;
  b.mobs = msg.w.mobs.map(m => ({ id: m[0], type: MOB_IDS[m[1]], x: m[2], z: m[3], hp: m[5], maxHp: m[6], engaged: !!(m[7] & 2), enraged: !!(m[7] & 4), winding: !!(m[7] & 16), staggered: !!(m[7] & 32), marked: !!(m[7] & 256), def: MOBS[MOB_IDS[m[1]]] })).filter(m => m.def);
  const th = new Map(msg.w.th || []); for (const m of b.mobs) m.tgt = th.get(m.id) || 0; // who a boss / elite is after (server/threat.js)
  const f2 = msg.w.f2, onF2 = onFloor2(b.x);
  b.gateOpen = onF2 ? !!f2?.gate?.[0] : !!msg.w.gate?.[0];
  b.gateReady = (onF2 ? f2?.gate?.[2] : msg.w.gate?.[2]) || 0;
  b.orbs = f2?.orbs || []; b.pools = f2?.pools || []; b.deluge = !!f2?.del;
  b.players = msg.w.players.map(p => ({ id: p[0], x: p[1], z: p[2], face: p[3], hp: p[4], maxHp: p[5], lvl: p[6], cls: CLASS_IDS[p[7]], party: p[8], dead: !!p[9], style: STYLE_IDS[p[11]] || null }));
  const mine = b.players.find(p => p.id === b.id);
  if (mine) {
    if (mine.party !== b.party) onPartyChange(b, mine.party);
    if (b.dead && !mine.dead) { b.tele = []; b.sweep = null; b.roll = null; } // respawned: regroup from town
    Object.assign(b, { hp: mine.hp, maxHp: mine.maxHp, dead: mine.dead, party: mine.party, style: mine.style }); // style: the equipped weapon's (shared/styles.js)
  }
  readDowned(b, msg.w.down); // downed players (p.downed, b.downed)
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
  else if (b.cmd && !b.cmd.adm) b.cmd = null;
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
    case 'f2wave': b.waves.push({ x: e.x, z: e.z, start: b.t + e.d, sp: e.sp, w: e.w, max: e.max }); break;
    case 'stair': b.stair = { x: e.x, z: e.z, until: b.t + e.d }; break;
    case 'sys': if (!e.to) L?.(`[sys] ${e.text}`); break;
    case 'hit': {
      let h = b.hits.get(e.id); if (!h) b.hits.set(e.id, h = new Map());
      const x = h.get(e.by); if (x) x.last = b.t; else h.set(e.by, { first: b.t, last: b.t });
      break;
    }
    case 'die': {
      const h = b.hits.get(e.id);
      if (e.b && h && [...h.keys()].some(id => id === me || mateOf(b, id))) say(b, 'bossKill', {}, { cd: 60 });
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
    case 'chat': onChat(b, e); break;
    case 'botcmd': onBotCmd(b, e); break;
  }
  brainFor(b.cls).onEvent?.(b, e);
  runHooks('onEvent', b, e);
}
const mobName = (b, id) => b.mobs.find(m => m.id === id)?.def.name || 'it';

// Party invites: bots form their own parties with each other; a human's invite wins over a bot-only party.
function onInvite(b, e) {
  const human = !isBot(b, e.from);
  const withHuman = b.party && b.players.some(p => p.party === b.party && p.id !== b.id && !isBot(b, p.id));
  if (b.party && (withHuman || !human)) {
    b.send({ type: 'decline' });
    if (human) say(b, 'busy', {}, { force: true, ch: 's', text: `Sorry ${nameOf(b, e.from)}, I'm already in a party.` });
    return;
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
}

function onBotCmd(b, e) {
  const mine = !!e.party && e.party === b.party;
  const named = !!e.name && e.name.toLowerCase() === b.name.toLowerCase();
  if (e.name && !named) return;
  if (!mine && !(e.adm && named)) return;
  if (e.tgt) b.locks.set(e.by, e.tgt);
  const group = named ? [b.id] : partyBots(b);
  command(b, { k: e.cmd, by: e.by, byName: e.byName, tgt: e.tgt || b.locks.get(e.by) || 0, group, all: group.length > 1, adm: !mine });
}

// c: { k, by (player id, 0 = admin page), byName, tgt (mob id), group (bot ids addressed), all, adm }
function command(b, c) {
  const who = c.byName || 'you', group = c.group || [b.id];
  const first = group.filter(id => id === b.id || b.players.some(p => p.id === id && !p.dead))[0] === b.id; // one bot answers group orders
  const ack = (key, vars = {}, text = null) => (first || !c.all) && say(b, key, { who, ...vars }, { force: true, text });
  const base = { by: c.by || 0, byName: c.byName || 'admin', adm: !!c.adm, at: b.t };
  b.lastCmdBy = c.by || b.lastCmdBy;
  switch (c.k) {
    case 'follow': case 'come': {
      const target = c.by ? c.by : c.followId;
      if (!target) return;
      b.cmd = { ...base, k: c.k, by: target, byName: c.byName || nameOf(b, target) };
      return ack(c.k);
    }
    case 'stay': b.cmd = { ...base, k: 'stay', x: b.x, z: b.z }; return ack('stay');
    case 'attack': {
      const m = b.mobs.find(m => m.id === c.tgt);
      if (!m) return ack('noTarget');
      b.cmd = { ...base, k: 'attack', tgt: m.id, prev: b.cmd?.k === 'attack' ? b.cmd.prev : b.cmd };
      b.tgtId = null;
      return ack('attack', { mob: m.def.name });
    }
    case 'farm': case 'boss': b.cmd = { ...base, k: c.k, group }; return ack(c.k);
    case 'ready':
      if (!b.gateOpen && (inGateZone(b.x, b.z) || inGateZone2(b.x, b.z))) {
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
      b.cmd = null; b.healFocus = null;
      return b.send({ type: 'leave' });
    case 'status': return say(b, 'status', {}, { force: true, text: statusText(b) });
  }
}

function statusText(b) {
  const pots = b.cons?.potion;
  return `HP ${b.hp}/${b.maxHp} · Lv ${b.me?.lvl ?? '?'} · ${b.dead ? 'down' : b.goal}${pots !== undefined ? ` · ${pots} potion${pots === 1 ? '' : 's'}` : ''}`;
}

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
  return { mode: 'lead', beh: b.behaviour };
}

function followed(b) { // the player named by the 'follow' behaviour, as seen in the last snapshot
  if (!b.follow) return null;
  const want = b.follow.toLowerCase(), r = (b.roster || []).find(r => !r.bot && r.name.toLowerCase() === want);
  const p = r && b.players.find(p => p.id === r.id);
  return p ? { ...p, name: r.name, bot: false, role: roleOf(p.cls) } : null;
}

// ---------------- the loop ----------------
function think(b) {
  if (!b.me) return;
  if (b.script && scriptTurn(b)) return; // a scripted actor (server/director.js): its scripted action this turn
  const P = partyView(b);
  social(b, P);
  if (b.dead) { b.goal = 'down'; return; }
  if (downedTurn(b, P)) return; // downed: crawl to help
  if (b.healFocus && (b.healFocus.until < b.t || !P.all.some(p => p.id === b.healFocus.id))) b.healFocus = null;
  const M = decideMode(b, P);
  b.mode = M.mode;
  b.anchor = M.anchor ? { id: M.anchor.id, name: M.anchor.name, bot: !!M.anchor.bot } : null;
  upkeep(b, P, M);
  if (stepRoll(b) || perilous(b) || waveDodge(b) || travel(b, M)) return;
  if (reviveTurn(b, P)) return; // a partymate is down and it's our job to pick them up
  act(b, P, M);
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
  if (!b.script && !b.gateOpen && (inGateZone(b.x, b.z) || inGateZone2(b.x, b.z)) && !b.me.ready && b.t - (b.readyT || -9) > 1) { // (scripted actors ready only when told)
    const zone = (x, z) => inGateZone(x, z) || inGateZone2(x, z);
    const there = P.all.filter(p => !p.dead).every(p => zone(p.x, p.z));
    const ordered = b.cmd?.k === 'boss';
    if (there && (!P.humans.length || ordered || b.gateReady > 0)) { b.readyT = b.t; b.send({ type: 'ready' }); }
    else if (!there) say(b, 'gateWait', {}, { p: 0.5, cd: 90 });
  }
  if (!b.rev && b.hp / b.maxHp < potionAt(b) && b.t - b.potT > 10) { if (!drink(b)) b.potT = b.t; }
  if (b.hp / b.maxHp < 0.3 && b.tgtId && b.t - (b.lowT || -99) > 20) {
    b.lowT = b.t;
    say(b, 'lowHp', {}, { p: 0.7, cd: 25 });
    if (b.role !== 'tank' && b.role !== 'healer' && P.all.some(p => p.role === 'healer' && !p.dead && p.id !== b.id)) b.backOff = b.t + 1.2;
  }
}

// Floor 2: the Stairway right after a Warden kill, otherwise the town waystone (once unlocked). Goes when the bot
// leads a Floor 2 run, or when its anchor is on Floor 2.
function travel(b, M) {
  const want2 = M.mode === 'lead' ? M.beh === 'floor2' || b.floor === 2 && M.beh === b.behaviour : !!M.anchor && onFloor2(M.anchor.x);
  if (!want2 || onFloor2(b.x) || !floorUnlocked(b.life, 2)) return false;
  b.goal = 'Travelling to Floor 2';
  const warp = () => { if (b.t - (b.warpT || -9) > 1) { b.warpT = b.t; b.send({ type: 'warp', f: 2 }); } };
  if (b.stair && b.stair.until > b.t + 2 && b.z > 150) {
    if (!moveToward(b, b.stair.x, b.stair.z, 1.2) || d2(b.x, b.z, b.stair.x, b.stair.z) < STAIRWAY.use - 0.5) warp();
    return true;
  }
  if (b.z > 150 && !b.gateOpen) return false; // shut in the chamber: wait for the next Stairway
  const w = WAYSTONES[0];
  if (b.z > 20 && Math.abs(b.x) > 3) moveToward(b, 0, b.z - 6); // back to the road, then south to town
  else if (!moveToward(b, w.x, w.z + 2.4, 0.3) || d2(b.x, b.z, w.x, w.z) < 3) warp();
  return true;
}

// Context handed to class plug-ins (see shared/bots/registry.js).
function ctxBase(b) {
  return { basic: basicProfile(b.cls, b.style), useSkill, moveToward, switchOpen, d2, dodge: null, ready: true, anchor: null, tank: null, leader: null, party: { mates: [], humans: [], all: [] }, hurt: [], healFocus: null, engaged: null, mayBreak: true, peel: false, say: (k, v, o) => say(b, k, v, o) };
}

function act(b, P, M) {
  let tgt = chooseTarget(b, P, M);
  const anchor = M.anchor && !M.anchor.dead ? M.anchor : null;
  // cohesion: too far from the anchor, drop the fight and regroup (but never walk out of a boss fight)
  if (anchor && M.mode !== 'stay' && d2(anchor.x, anchor.z, b.x, b.z) > LEASH && !(tgt?.def.boss && inBossRoom(b.x, b.z)) && M.mode !== 'attack') tgt = null;
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
  if (!brain.combat || brain.combat(b, tgt, ctx) === false) brainFor('*').combat(b, tgt, ctx);
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
  ctx.ready = b.role === 'tank' || !tankOn || (!!hTank && b.t - hTank.first > 1.2);
  ctx.party = { mates: P.mates, humans: P.humans, all: P.all };
  ctx.hurt = [...P.all.filter(p => p.downed?.by && d2(p.x, p.z, b.x, b.z) < 15), // a body being revived: a Heal speeds it up
    ...alive.filter(p => pct(p) < 0.78 && d2(p.x, p.z, b.x, b.z) < 15).sort((x, y) => pct(x) - pct(y))];
  ctx.healFocus = b.healFocus ? alive.find(p => p.id === b.healFocus.id) || null : null;
  ctx.engaged = b.engAt === null ? null : b.t - b.engAt;
  if (tank && tgt) { // the tank's Ground Slam: Break it ourselves only while that's on cooldown (or the tank isn't Breaking)
    const slam = b.seen.get(tank.id)?.gslam, held = b.hits.get(tgt.id)?.get(tank.id);
    ctx.mayBreak = slam !== undefined ? b.t - slam < 6 || b.t - slam > 16 : !held || b.t - held.first > 8;
  }
  ctx.peel = b.role === 'tank' && b.mobs.some(m => m.engaged && !m.def.boss && d2(m.x, m.z, b.x, b.z) < 8 + m.def.radius
    && alive.some(p => p.id !== b.id && p.role !== 'tank' && d2(p.x, p.z, m.x, m.z) < m.def.radius + 2.5));
  return ctx;
}

// ---------------- targets ----------------
function chooseTarget(b, P, M) {
  const f2 = onFloor2(b.x), here = b.mobs.filter(m => onFloor2(m.x) === f2);
  if (M.mode === 'attack') return here.find(m => m.id === b.cmd.tgt) || null;
  if (M.mode === 'stay') { // only what comes to us
    const c = b.cmd;
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
  const mates = new Set(P.all.map(p => p.id)), bossRoom = inBossRoom(ax, az) || inBossRoom(b.x, b.z);
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
    if (leading && m.id !== leading.id && !onMate) return null; // a leader only switches to help someone
    return s;
  });
}

// Leader targeting by behaviour (the classic progression and the single-bot behaviours).
// Progression: boars until level 3, wolves until level 5, then the Warden. Floor 2: the Mire until 15, then the Sovereign.
function pickProgress(b, here, minBoss) {
  const lvl = b.me?.lvl || 1, f2 = onFloor2(b.x);
  minBoss ??= f2 ? F2_BOSS_LVL : 5;
  const boss = here.find(m => m.type === (f2 ? 'sovereign' : 'warden'));
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
  const lvl = b.me?.lvl || 1, f2 = onFloor2(b.x);
  const threat = r => nearest(here, m => { const d = d2(m.x, m.z, b.x, b.z); return !m.def.boss && m.engaged && d < r ? d : null; });
  if (beh === 'follow') return threat(6);
  if (beh === 'field') {
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
  if (M.mode === 'stay') { moveToward(b, b.cmd.x, b.cmd.z, 0.8); return; }
  const a = M.anchor;
  if (M.mode !== 'lead' && a) {
    if (a.dead) return; // hold here until they're back
    // formation: fan out behind the anchor
    const flock = P.bots.filter(p => p.id !== a.id).map(p => p.id);
    const k = Math.max(0, flock.indexOf(b.id)), n = Math.max(1, flock.length);
    const ang = (a.face || 0) + Math.PI + (k - (n - 1) / 2) * 0.8, r = 3 + (k % 2) * 0.6;
    const sx = a.x + Math.sin(ang) * r, sz = a.z + Math.cos(ang) * r, dA = d2(a.x, a.z, b.x, b.z);
    if (dA > 5 || d2(sx, sz, b.x, b.z) > 1.5) moveToward(b, sx, sz, 0.6, dA > 9 ? SPRINT_SPEED : PLAYER_SPEED);
    return;
  }
  // leading: wait for bot teammates that fell behind (e.g. respawned in town), up to 20 s at a time
  const behind = P.mates.some(p => p.bot && !p.dead && onFloor2(p.x) === onFloor2(b.x) && d2(p.x, p.z, b.x, b.z) > 20);
  if (behind && !inBossRoom(b.x, b.z)) {
    b.waitFrom ??= b.t;
    if (b.t - b.waitFrom < 20) return;
  } else b.waitFrom = null;
  const beh = M.beh, f2 = onFloor2(b.x), lvl = b.me?.lvl || 1;
  if (beh === 'follow') return;
  if (beh === 'field') { const [x, z] = fieldSpot(b); moveToward(b, x, z, 1); return; }
  if (beh !== 'warden' && lvl < (f2 ? F2_BOSS_LVL : 5)) { moveToward(b, f2 ? F2.x : 0, f2 ? 70 : 60); return; } // into the field
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
  const fight = tgt ? `Fighting ${tgt.def.name}` : '';
  if (M.mode === 'stay') return `${fight || 'Holding position'}${b.cmd?.byName ? ` (${b.cmd.byName}'s order)` : ''}`;
  if (M.mode === 'attack') return `Attacking ${tgt?.def.name || 'target'} (${b.cmd.byName}'s order)`;
  if (M.mode === 'follow') return fight ? `${fight} with ${M.anchor.name}` : M.anchor.dead ? `Waiting for ${M.anchor.name}` : `Following ${M.anchor.name}`;
  if (fight) return fight;
  const gate = !b.gateOpen && (inGateZone(b.x, b.z) || inGateZone2(b.x, b.z));
  if (b.waitFrom != null && b.t - b.waitFrom < 20) return 'Waiting for the party';
  if (M.beh === 'field') return 'Farming the field';
  if (M.beh === 'follow') return `Looking for ${b.follow || 'a player'}`;
  if (M.beh !== 'warden' && (b.me?.lvl || 1) < (onFloor2(b.x) ? F2_BOSS_LVL : 5)) return 'Levelling up';
  return gate ? 'Waiting at the raid gate' : onFloor2(b.x) ? 'Heading to the Sovereign' : 'Heading to the Warden';
}
