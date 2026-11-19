// Live bot editing for the admin page (installed on BotManager in server/botmanager.js):
//   edit(bid, { name, lvl, skill, behaviour, follow })  rename (unique), level (stats recomputed), capability 1-5,
//                                                       behaviour / follow target; only ever this one bot (own brain)
//   action(bid, act, body)                              teleport (to: player | town | gate | camp2 | gate2 | camp3 | gate3), kill (stays down until revived),
//                                                       revive, heal, respawn (as another class: same bot id, settings, party,
//                                                       owner link and orders), command ({ cmd, name }: a party order from the
//                                                       admin, see shared/bots/social.js), look ({ look }: wear a
//                                                       look from shared/looks.js, or none)
//   setLevel(e, lvl)                                    a bot's level (stats, talents re-checked; player-added bots: server/playerbots.js)
// A bot is linked to the party it serves (owner decision, docs/ROADMAP.md): none of these leave it detached. An edit keeps
// it in its party (a new follow target outside it moves it straight into theirs); Respawn as… rejoins the same party.
import { CLASSES, MAX_LEVEL, PARTY_MAX, walkable, resolveCollision } from '../shared/data.js';
import { BOT_SKILLS } from '../shared/botskill.js';
import { floorOf } from '../shared/floor2.js';
import { BEHAVIOURS } from './botmanager.js';
import { BOT_COMMANDS } from '../shared/bots/social.js';
import { isLook } from '../shared/looks.js';

export class BotError extends Error { constructor(msg, code = 400) { super(msg); this.name = 'BotError'; this.code = code; } }
const int = (v, lo, hi, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new BotError(`${what} must be a whole number from ${lo} to ${hi}.`);
  return n;
};
const cleanName = n => String(n || '').replace(/[^\w \-.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

export const BotEditMethods = {
  entry(bid) {
    const e = this.bots.find(e => e.bid === Number(bid) && !e.b.closed);
    if (!e) throw new BotError('No such bot.', 404);
    return e;
  },
  live(e) {
    const p = this.livePlayer(e);
    if (!p) throw new BotError('That bot is still joining.', 409);
    return p;
  },
  findFollow(name) {
    const t = this.realPlayers().find(p => p.name.toLowerCase() === String(name || '').toLowerCase());
    if (!t) throw new BotError('Pick an online player to follow.');
    return t;
  },

  edit(bid, body = {}) {
    const e = this.entry(bid), g = this.game;
    const p = this.live(e);
    // validate everything first, so a bad field changes nothing
    let name, lvl, skill, behaviour, follow;
    if (body.name !== undefined) {
      name = cleanName(body.name);
      if (name.length < 2) throw new BotError('Bot names are 2-16 letters, numbers, spaces, _ . -');
      if (this.nameReserved?.(name) && !e.named) throw new BotError(`${name} is one of the Named: pick another name.`, 409);
      const lower = name.toLowerCase();
      if ([...g.players.values()].some(o => o !== p && o.name.toLowerCase() === lower)) throw new BotError('That name is taken.', 409);
    }
    const rec = this.ownedRec?.(e.bid); // a player-added bot (server/playerbots.js)
    if (body.lvl !== undefined) {
      lvl = int(body.lvl, 1, MAX_LEVEL, 'Level');
      if (rec && lvl !== p.lvl) throw new BotError(`${p.name} was added by ${rec.ownerName} and levels with them.`);
    }
    if (body.skill !== undefined) skill = int(body.skill, 1, 5, 'Capability');
    if (body.behaviour !== undefined && !BEHAVIOURS[body.behaviour]) throw new BotError('Unknown behaviour.');
    behaviour = body.behaviour ?? e.behaviour;
    let target = null, moving = false;
    if (body.follow !== undefined || body.behaviour !== undefined) {
      target = behaviour === 'follow' ? this.findFollow(body.follow ?? e.follow) : null;
      follow = target ? target.name : '';
      const party = g.partyOf(p);
      moving = !!target && (!party || !party.members.includes(target.id)); // follow someone outside its party: it moves to theirs
      if (moving && rec) throw new BotError(`${p.name} serves ${rec.ownerName}'s party. Pick someone in it, or dismiss the bot.`);
      const tp = moving && g.partyOf(target);
      if (tp && tp.members.length >= PARTY_MAX) throw new BotError(`${target.name}'s party is full.`, 409);
    }

    if (name !== undefined && name !== p.name) { p.name = name; e.b.name = name; g.rosterDirty = true; }
    if (lvl !== undefined) this.setLevel(e, lvl);
    if (skill !== undefined) e.b.setSkill(skill);
    if (follow !== undefined && (behaviour !== e.behaviour || follow !== e.follow)) { // this bot only: one brain per bot
      e.b.configure({ behaviour, follow });
      e.behaviour = behaviour; e.follow = follow; e.partied = true;
      if (behaviour === 'floor2' || behaviour === 'floor3' || behaviour === 'follow') p.stats.floor2 = 1; // waystones
      if (behaviour === 'floor3' || behaviour === 'follow') p.stats.floor3 = 1;
      if (moving) this.joinParty(p, target); // straight from one party into the other (never left without one)
      // In a party with a player the bot serves that party (it follows them): the matching order makes the new
      // behaviour hold, the same way a player-added bot's mode does (server/playerbots.js setMode).
      const k = { follow: 'follow', field: 'farm', warden: 'boss' }[behaviour];
      if (k && p.party && (k !== 'follow' || target)) {
        try { e.b.command({ k, by: target?.id || 0, byName: target?.name || 'Admin', followId: target?.id, adm: true, group: [p.id] }); } catch (err) { console.error('bot order', err); }
      }
      if (rec) { // the owner's Bots tab shows the matching mode
        const mode = behaviour === 'follow' ? (follow.toLowerCase() === rec.ownerName.toLowerCase() ? 'follow' : null) : { field: 'field', warden: 'warden' }[behaviour];
        if (mode) rec.mode = mode;
      }
    }
    return this.view(e);
  },

  // A bot's level: stats recomputed (healed to full), talents re-checked (the bot spends new points itself), and a
  // level-up event (the bot's own level-up hooks and the ring effect). Returns true when it changed.
  setLevel(e, lvl) {
    const g = this.game, p = this.live(e);
    lvl = Math.min(MAX_LEVEL, Math.max(1, lvl | 0));
    if (lvl === p.lvl) return false;
    const up = lvl > p.lvl;
    p.lvl = lvl; p.xp = 0; e.lvl = lvl;
    p.stats.maxLvl = Math.max(p.stats.maxLvl || 1, lvl);
    if (p.talents && g.setTalents) g.setTalents(p, p.talents); // (a level down past its points: a free reset)
    g.recompute(p);
    if (!p.dead) p.hp = p.maxHp;
    if (up) g.events.push({ t: 'lvl', id: p.id, lvl });
    g.rosterDirty = true;
    return true;
  },

  // Respawn as another class: the same bot id (owner link and slot), name, level, capability, behaviour, team; it
  // rejoins the party it was in and picks its orders back up (reattach, from upkeep, once the new connection is in).
  respawn(e, cls) {
    const g = this.game, p = this.live(e), b = e.b, party = g.partyOf(p);
    const keep = { lvl: p.lvl, behaviour: e.behaviour, follow: e.follow, skill: b.skill };
    if (keep.behaviour === 'follow' && keep.follow && !this.realPlayers().some(o => o.name.toLowerCase() === keep.follow.toLowerCase())) { keep.behaviour = 'field'; keep.follow = ''; }
    const carry = {
      party: party?.id || 0, mates: party ? party.members.filter(id => id !== p.id) : [], oldId: p.id, until: Date.now() + 30000,
      cmd: b.cmd ? { ...b.cmd } : null, lastCmdBy: b.lastCmdBy || 0,
      healFocus: b.healFocus && b.healFocus.until > b.t ? { id: b.healFocus.id, left: b.healFocus.until - b.t } : null,
    };
    const i = this.bots.indexOf(e);
    e.group.drop(b);
    this.bots = this.bots.filter(x => x !== e);
    const view = this.start([cls], [p.name], keep, e.team, e.bid)[0];
    const ne = this.bots.find(x => x.bid === e.bid && x.b !== b);
    Object.assign(ne, { partied: e.partied, carry, look: e.look }); // (its look goes back on in upkeep)
    this.bots.splice(this.bots.indexOf(ne), 1); this.bots.splice(Math.max(0, i), 0, ne); // same place in the list
    return view;
  },

  // Once a second for a respawned bot: back into its old party (or with its old party mates, a player first, if that
  // party broke up when the old one left), then its orders. Gives up after 30 s.
  reattach(e, p) {
    const c = e.carry, g = this.game;
    if (Date.now() > c.until) { e.carry = null; return; }
    if (!p) return;
    if (c.party && !p.party) {
      const party = g.parties.get(c.party);
      if (party && party.members.some(id => c.mates.includes(id))) { if (party.members.length < PARTY_MAX) g.joinParty(p, party, 'invite'); }
      else {
        const mates = c.mates.map(id => g.players.get(id)).filter(Boolean);
        const t = mates.find(o => !o.bot) || mates[0];
        if (t) this.joinParty(p, t);
      }
      if (!p.party) return; // (full for now: try again)
    }
    if (e.b.party !== (p.party || 0)) return; // its brain sees the party first (a party change clears its orders)
    const b = e.b, swap = ids => ids?.map(id => (id === c.oldId ? p.id : id));
    if (c.cmd) b.cmd = { ...c.cmd, at: b.t, ...(c.cmd.group ? { group: swap(c.cmd.group) } : {}) };
    if (c.healFocus) b.healFocus = { id: c.healFocus.id, until: b.t + c.healFocus.left };
    if (c.lastCmdBy) b.lastCmdBy = c.lastCmdBy;
    for (const o of this.bots) if (o.b.cmd?.group?.includes(c.oldId)) o.b.cmd.group = swap(o.b.cmd.group); // teammates' group orders
    e.carry = null;
  },

  action(bid, act, body = {}) {
    const e = this.entry(bid), g = this.game;
    const p = this.live(e);
    switch (act) {
      case 'teleport': {
        if (p.dead) throw new BotError('Revive it first.');
        if (body.to === 'player') { this.catchUp(p, this.findPlayerAny(body.name)); break; }
        const [cx, cz, r] = ({ town: [0, 0, 6], gate: [0, 150, 3], camp2: [600, 3, 4], gate2: [600, 150, 3], camp3: [1200, 3, 4], gate3: [1200, 150, 3] })[body.to] || [];
        if (cx === undefined) throw new BotError('Teleport to a player, a town / camp or a raid gate.');
        if (cx > 300) { p.stats.floor2 = 1; if (cx > 900) p.stats.floor3 = 1; } // (it can use the waystones from there)
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * r;
          const [x, z] = resolveCollision(cx + Math.sin(a) * d, cz + Math.cos(a) * d);
          if (walkable(x, z, true)) { g.teleport(p, x, z); return this.view(e); }
        }
        g.teleport(p, cx, cz);
        break;
      }
      case 'kill': {
        if (p.dead) throw new BotError('Already down.');
        p.hp = 0; p.dead = true; p.respawnAt = Infinity; // stays down until revived
        g.events.push({ t: 'pdie', id: p.id, src: 'an admin', f: floorOf(p.x) });
        break;
      }
      case 'revive': {
        if (!p.dead) throw new BotError('It is not down.');
        p.dead = false; p.hp = p.maxHp; p.respawnAt = 0;
        g.teleport(p, p.x, p.z); // re-sync the bot's position
        break;
      }
      case 'heal': {
        if (p.dead) throw new BotError('Revive it first.');
        p.hp = p.maxHp;
        break;
      }
      case 'respawn': { // as another class (see respawn above)
        if (!CLASSES[body.cls]) throw new BotError('Pick a class.');
        return this.respawn(e, body.cls);
      }
      case 'command': { // an order, as if from its party (admins can order any bot)
        const cmd = String(body.cmd || '');
        if (!BOT_COMMANDS[cmd]) throw new BotError(`Unknown command. Try: ${Object.keys(BOT_COMMANDS).join(', ')}.`);
        if (p.dead) throw new BotError('Revive it first.');
        let t = null;
        if (cmd === 'follow' || cmd === 'come' || cmd === 'heal') t = this.findPlayerAny(body.name);
        if (cmd === 'attack') throw new BotError('Attack orders come from a player with a target locked.');
        e.b.command({ k: cmd, by: t?.id || 0, byName: t?.name || 'Admin', followId: t?.id, adm: true, group: [e.b.id] });
        break;
      }
      case 'look': { // wear a look from shared/looks.js (or none): a preview for any bot
        const id = body.look || null;
        if (id && !isLook(id)) throw new BotError('Unknown look.');
        g.setLook(p, id); e.look = id;
        break;
      }
      default: throw new BotError('Unknown action.', 404);
    }
    return this.view(e);
  },

  findPlayerAny(name) { // any online player (bots included) by name
    const t = [...this.game.players.values()].find(o => o.name.toLowerCase() === String(name || '').toLowerCase());
    if (!t) throw new BotError('No player online by that name.');
    if (t.dead) throw new BotError(`${t.name} is down right now.`);
    return t;
  },

  skillTable() { return Object.fromEntries(Object.entries(BOT_SKILLS).map(([k, v]) => [k, { name: v.name, desc: v.desc }])); },
};
