// Server-side bots, run inside the server process and managed from the admin page (/admin.html).
//
// Each bot is a real WebSocket connection to this server's own /ws (the `ws` package), driven by the brains in
// shared/teambots.js: a single bot (any class) with a behaviour, or a role-playing party (tank, DPS, healer).
// Bots join with a secret key generated at startup, so only this module can create them: the server marks them
// p.bot = true (shown in the roster, left out of the real-player lists), gives them their starting level, and never
// saves them (they're anonymous players).
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';
import { CLASSES, MAX_LEVEL, PARTY_MAX, areaName, walkable, resolveCollision } from '../shared/data.js';
import { floorOf } from '../shared/floor2.js';
import { clampSkill, skillName } from '../shared/botskill.js'; // capability levels 1-5
import { BotEditMethods } from './botedit.js'; // live edits + actions (admin page)

export const BEHAVIOURS = {
  follow: 'Follow a player (fight alongside, join their party)',
  field: 'Farm the field near town',
  warden: 'Go fight the Warden',
  floor2: 'Floor 2 (the Mire, then the Sovereign)',
  auto: 'Level up, then the Warden (classic party run)',
};
const NAMES = ['Rook', 'Wren', 'Tamsin', 'Orin', 'Sable', 'Dax', 'Mira', 'Corin', 'Ash', 'Nell', 'Vex', 'Juno', 'Pell', 'Iris', 'Bram', 'Cass', 'Edda', 'Fenn', 'Hale', 'Lark'];
const ROLES = ['guardian', 'swordsman', 'cleric'];
const TEAM = { guardian: 'Brann', swordsman: 'Kael', cleric: 'Lyra' };

export class BotManager {
  constructor(game, { url, max = Number(process.env.MAX_BOTS) || 30 } = {}) {
    this.game = game; this.url = url; this.max = max;
    this.key = crypto.randomBytes(18).toString('base64url'); // only this process knows it
    this.bots = []; // { bid, b (teambots bot), group, behaviour, follow, team, lvl, at }
    this.nextBid = 1; this.nextTeam = 1;
    this.joining = false;
    // Keep bots out of play tracking (sessions, deaths, ...): they're not players.
    const track = game.track;
    game.track = (p, ...a) => (p?.bot || this.joining ? undefined : track(p, ...a));
    this.timer = setInterval(() => this.upkeep(), 1000);
    this.timer.unref?.();
  }

  // ---------- server side of a bot's join ----------
  isBotJoin(msg) { return typeof msg.bot === 'string' && msg.bot.length === this.key.length && crypto.timingSafeEqual(Buffer.from(msg.bot), Buffer.from(this.key)); }

  addBotPlayer(ws, msg) {
    const g = this.game;
    this.joining = true;
    let p;
    try { p = g.addPlayer(ws, msg.name, msg.cls); } finally { this.joining = false; }
    p.bot = true;
    const lvl = Math.min(MAX_LEVEL, Math.max(1, msg.lvl | 0 || 1));
    p.lvl = lvl; p.xp = 0; p.lvlStart = lvl;
    p.stats.maxLvl = Math.max(p.stats.maxLvl, lvl);
    if (msg.f2) p.stats.floor2 = 1; // lets Floor 2 / follow bots use the waystones
    g.recompute(p); p.hp = p.maxHp;
    g.rosterDirty = true;
    return p;
  }

  // ---------- admin actions ----------
  count() { return this.bots.filter(e => !e.b.closed).length; }
  livePlayer(e) { const p = e.b.id && this.game.players.get(e.b.id); return p && p.bot ? p : null; }

  uniqueName(base) {
    const taken = new Set([...this.game.players.values()].map(p => p.name.toLowerCase()));
    for (const e of this.bots) if (!e.b.closed) taken.add(e.b.name.toLowerCase());
    if (base && !taken.has(base.toLowerCase())) return base;
    if (base) { for (let i = 2; i < 100; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`; }
    const free = NAMES.filter(n => !taken.has(n.toLowerCase()));
    if (free.length) return free[Math.floor(Math.random() * free.length)];
    for (let i = 2; ; i++) { const n = `${NAMES[i % NAMES.length]} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  }

  // opts: { cls, name, lvl, behaviour, follow, skill (capability 1-5, default 4) }
  add({ cls, name, lvl, behaviour = 'field', follow = '', skill } = {}) {
    if (!CLASSES[cls]) throw new Error('Pick a class.');
    if (!BEHAVIOURS[behaviour]) throw new Error('Unknown behaviour.');
    if (behaviour === 'follow' && !this.realPlayers().some(p => p.name.toLowerCase() === String(follow).toLowerCase())) throw new Error('Pick an online player to follow.');
    if (this.count() + 1 > this.max) throw new Error(`Bot limit reached (${this.max}).`);
    name = String(name || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16);
    return this.start([cls], [this.uniqueName(name)], { lvl, behaviour, follow: String(follow || ''), skill })[0];
  }

  addTeam({ lvl, behaviour = 'auto', follow = '', skill } = {}) {
    if (!BEHAVIOURS[behaviour]) throw new Error('Unknown behaviour.');
    if (behaviour === 'follow' && !this.realPlayers().some(p => p.name.toLowerCase() === String(follow).toLowerCase())) throw new Error('Pick an online player to follow.');
    if (this.count() + 3 > this.max) throw new Error(`Bot limit reached (${this.max}).`);
    const n = this.nextTeam++, suffix = n > 1 ? ` ${n}` : '';
    return this.start(ROLES, ROLES.map(c => this.uniqueName(TEAM[c] + suffix)), { lvl, behaviour, follow: String(follow || ''), skill }, n);
  }

  start(roles, names, { lvl, behaviour, follow, skill }, team = 0) {
    lvl = Math.min(MAX_LEVEL, Math.max(1, lvl | 0 || 1));
    skill = clampSkill(skill); // (default 4: Skilled)
    const url = typeof this.url === 'function' ? this.url() : this.url;
    const group = startTeam({
      url, WebSocket, roles, names, behaviour, follow, skill,
      join: { bot: this.key, lvl, f2: behaviour === 'floor2' || behaviour === 'follow' ? 1 : 0 },
    });
    const out = group.team.map(b => ({ bid: this.nextBid++, b, group, behaviour, follow, team, lvl, at: Date.now() }));
    this.bots.push(...out);
    return out.map(e => this.view(e));
  }

  remove(bid) {
    const e = this.bots.find(e => e.bid === bid);
    if (!e) return false;
    e.group.drop(e.b);
    this.bots = this.bots.filter(x => x !== e);
    return true;
  }

  removeAll() {
    const n = this.count();
    for (const e of this.bots) e.group.drop(e.b);
    this.bots = [];
    return n;
  }

  realPlayers() { return [...this.game.players.values()].filter(p => !p.bot); }

  view(e) {
    const p = this.livePlayer(e), g = this.game;
    const party = p?.party ? g.parties.get(p.party) : null;
    return {
      bid: e.bid, id: e.b.id || 0, name: p?.name || e.b.name, cls: e.b.cls, lvl: p?.lvl ?? e.lvl, hp: p?.hp ?? 0, maxHp: p?.maxHp ?? 0,
      dead: !!p?.dead, area: p ? areaName(p.x, p.z) : 'joining…', floor: p ? floorOf(p.x) : 0,
      party: party ? party.members.filter(id => id !== p.id).map(id => g.players.get(id)?.name).filter(Boolean) : [],
      behaviour: e.behaviour, follow: e.follow, team: e.team, skill: e.b.skill, skillName: skillName(e.b.skill), status: e.b.closed ? 'gone' : p ? 'online' : 'joining', since: e.at,
    };
  }

  list() { return this.bots.map(e => this.view(e)); }

  // ---------- once a second: prune, and keep followers with their player ----------
  upkeep() {
    const g = this.game;
    this.bots = this.bots.filter(e => !(e.b.closed && Date.now() - e.at > 3000));
    for (const e of this.bots) {
      if (e.behaviour !== 'follow') continue;
      const p = this.livePlayer(e);
      const t = p && this.realPlayers().find(o => o.name.toLowerCase() === e.follow.toLowerCase());
      if (!p || !t || p.dead || t.dead) continue;
      if (!e.partied && !(p.party && p.party === t.party)) this.joinParty(p, t), e.partied = true; // once: they can leave it
      if (floorOf(p.x) !== floorOf(t.x) || Math.hypot(p.x - t.x, p.z - t.z) > 45) this.catchUp(p, t);
    }
  }

  // Join the followed player's party (same as accepting an invite from them).
  joinParty(p, t) {
    const g = this.game;
    let party = g.partyOf(t);
    if (party && party.members.length >= PARTY_MAX) return;
    if (!party) {
      party = { id: g.id(), members: [t.id] };
      g.parties.set(party.id, party);
      t.party = party.id;
    }
    g.joinParty(p, party, 'invite');
  }

  // Too far behind (or on another floor): appear next to the player.
  catchUp(p, t) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const [x, z] = resolveCollision(t.x + Math.sin(a) * 2.5, t.z + Math.cos(a) * 2.5);
      if (walkable(x, z, true)) return this.game.teleport(p, x, z);
    }
    this.game.teleport(p, t.x, t.z);
  }
}
Object.assign(BotManager.prototype, BotEditMethods); // edit(bid, ...), action(bid, act, ...) (server/botedit.js)
