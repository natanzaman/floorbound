// Live bot editing for the admin page (installed on BotManager in server/botmanager.js):
//   edit(bid, { name, lvl, skill, behaviour, follow })  rename (unique), level (stats recomputed), capability 1-5,
//                                                       behaviour / follow target (a team's behaviour is the whole team's)
//   action(bid, act, body)                              teleport (to: player | town | gate), kill (stays down until revived),
//                                                       revive, heal, respawn (as another class: remove + re-add, same settings)
import { CLASSES, MAX_LEVEL, walkable, resolveCollision } from '../shared/data.js';
import { BOT_SKILLS } from '../shared/botskill.js';
import { floorOf } from '../shared/floor2.js';
import { BEHAVIOURS } from './botmanager.js';

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
      const lower = name.toLowerCase();
      if ([...g.players.values()].some(o => o !== p && o.name.toLowerCase() === lower)) throw new BotError('That name is taken.', 409);
    }
    if (body.lvl !== undefined) lvl = int(body.lvl, 1, MAX_LEVEL, 'Level');
    if (body.skill !== undefined) skill = int(body.skill, 1, 5, 'Capability');
    if (body.behaviour !== undefined && !BEHAVIOURS[body.behaviour]) throw new BotError('Unknown behaviour.');
    behaviour = body.behaviour ?? e.behaviour;
    if (body.follow !== undefined || body.behaviour !== undefined) {
      follow = behaviour === 'follow' ? this.findFollow(body.follow ?? e.follow).name : '';
    }

    if (name !== undefined && name !== p.name) { p.name = name; e.b.name = name; g.rosterDirty = true; }
    if (lvl !== undefined && lvl !== p.lvl) {
      p.lvl = lvl; p.xp = 0; e.lvl = lvl;
      p.stats.maxLvl = Math.max(p.stats.maxLvl || 1, lvl);
      g.recompute(p);
      if (!p.dead) p.hp = p.maxHp;
    }
    if (skill !== undefined) e.group.setSkill(e.b, skill);
    if (follow !== undefined && (behaviour !== e.behaviour || follow !== e.follow)) {
      const mates = e.team ? this.bots.filter(x => x.group === e.group) : [e]; // a team shares one brain
      e.group.configure({ behaviour, follow });
      for (const x of mates) {
        const xp = this.livePlayer(x);
        if (xp && x.behaviour === 'follow' && !x.team && xp.party) g.leaveParty(xp); // stop tagging along with the old player
        x.behaviour = behaviour; x.follow = follow; x.partied = false;
        if (xp && (behaviour === 'floor2' || behaviour === 'follow')) xp.stats.floor2 = 1; // waystones
      }
    }
    return this.view(e);
  },

  action(bid, act, body = {}) {
    const e = this.entry(bid), g = this.game;
    const p = this.live(e);
    switch (act) {
      case 'teleport': {
        if (p.dead) throw new BotError('Revive it first.');
        if (body.to === 'player') { this.catchUp(p, this.findPlayerAny(body.name)); break; }
        const [cx, cz, r] = body.to === 'town' ? [0, 0, 6] : body.to === 'gate' ? [0, 150, 3] : [];
        if (cx === undefined) throw new BotError('Teleport to a player, town or the gate.');
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
      case 'respawn': { // as another class: remove and re-add with the same name, level, capability, behaviour
        if (!CLASSES[body.cls]) throw new BotError('Pick a class.');
        const keep = { lvl: p.lvl, behaviour: e.behaviour, follow: e.follow, skill: e.b.skill };
        if (keep.behaviour === 'follow' && !this.realPlayers().some(o => o.name.toLowerCase() === keep.follow.toLowerCase())) keep.behaviour = 'field';
        const name = p.name;
        this.remove(e.bid);
        return this.start([body.cls], [name], keep)[0];
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
