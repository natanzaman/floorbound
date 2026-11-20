// Authoritative world simulation: players, mobs, the floor boss, combat, XP and parties.
import {
  WORLD, CLASSES, CLASS_IDS, MOBS, MOB_IDS, MAX_LEVEL, PARTY_MAX, PLAYER_SPEED, SPRINT_SPEED, DODGE, JUMP, SWITCH, BITE, PACK, THORN,
  GATE, WARDEN, inGateZone, crossesGate, RARE, PERFECT, GUARD, PACE, paced,
  inTown, inArena, walkable, resolveCollision, rng, angleTo, wrapAngle, xpToNext, statsFor,
} from '../shared/data.js';
import {
  CONSUMABLES, SHOP, MERCHANT, BAG_SIZE, SLOTS, lastAttackItem, gearStats, sellPrice, newInventory,
} from '../shared/items.js';
import { TITLES, newStats, meetsTitle } from '../shared/titles.js';
import { F2, crossesGate2, floorOf, inArena2 } from '../shared/floor2.js';
import { F2Methods } from './floor2.js';
import { F3, crossesGate3, inArena3 } from '../shared/floor3.js';
import { installFloor3, installFloor3Moves } from './floor3.js'; // Floor 3 — The Gale Spires
import crypto from 'node:crypto';
import { SmithMethods } from './smith.js';
import { GroundMethods } from './ground.js';
import { TwistMethods } from './twists.js';
import { SovTwistMethods } from './sovtwists.js';
import { installCombat } from './combat.js';
import { MasteryMethods } from './mastery.js';
import { MASTERY } from '../shared/mastery.js';
import { installClassesB } from './classes-b.js';
import { ClassesAMethods } from './classes-a.js';
import { installStyles } from './styles.js';
import { altStyle } from '../shared/styles.js';
import { installTalents } from './talents.js';
import { installPacing } from './pacing.js';
import { installNamed } from './named.js';
import { installTracking } from './trackgame.js';
import { installBell } from './bell.js';
import { installStaging } from './staging.js';
import { installCine } from './cine.js'; // cinematic camera state for filming (F4)
import { installPoses } from './poses.js';
import { installOpenings } from './openings.js'; // boss combos, after states, melee openings (J3)
import { installThreat } from './threat.js'; // visible threat, healer threat, Cover, flanking (G3)
import { installRevive } from './revive.js'; // downed + revive (G1)
import { installRescue } from './rescue.js'; // rescue traps: vines, Drowning Pillar, storm crystal (J1)
import { installBossTeam } from './bossteam.js'; // boss team mechanics: stack, spread, tether (G4)
import { installArenas } from './arenas.js'; // multi-area boss fights: the Colossus's fall to the Undercroft (J2)
import { installTeamplay } from './teamplay.js'; // skill combos + Team Burst + team stats (G2)
import { installMvp } from './mvp.js'; // post-fight MVP card (G5)
import { installLoot } from './loot.js';
import { installLooks } from './looks.js'; // character looks: setLook, w.looks (I2)
import { rollGear } from '../shared/loot.js'; // affixes, boss sets, loadouts, drop tables (H2)
import { BOT_COMMANDS, parseBotChat, botHelp } from '../shared/bots/social.js'; // party orders for bots (botCommand, /b chat)

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
// The Warden's own timer per move (a combo step pushes it back: server/openings.js bossCombo)
const WARDEN_TIMERS = { slam: 'slamT', quake: 'quakeT', charge: 'chargeT', spin: 'spinT', rock: 'rockT', hounds: 'houndT', sweep: 'sweepT' };

export class Game {
  constructor() {
    this.players = new Map();
    this.mobs = new Map();
    this.parties = new Map();
    this.zones = [];
    this.projectiles = [];
    this.scheduled = [];
    this.events = [];
    this.nextId = 1;
    this.time = 0;
    this.floorClears = 0;
    this.gate = { open: false, ready: new Set(), countAt: 0, emptySince: 0 };
    this.fight = null;   // the current Warden attempt, for tracking
    this.bossKnobs = process.env.BOSS_KNOBS ? JSON.parse(process.env.BOSS_KNOBS) : null; // testing aid (scripts/tuneboss.js): knob overrides per boss, e.g. {"colossus":{"pauseMul":1.2}}
    this.lfgT = 0;
    this.track = () => {}; // set by the server to record play events
    const rr = ([a, b]) => a + Math.random() * (b - a);
    this.rare = { mob: null, next: process.env.RARE_SOON ? RARE.soon : rr(RARE.first) }; // RARE_SOON is a testing aid
    this.spawnMobs();
    this.newTwist(); // Warden twist for the first fight
    this.initFloor2(); // Floor 2 — The Glimmering Mire (server/floor2.js)
    this.initFloor3(); // Floor 3 — The Gale Spires (server/floor3.js)
  }

  id() { return this.nextId++; }

  // ---------- setup ----------
  spawnMobs() {
    const r = rng(7);
    for (let i = 0; i < 14; i++) this.addMob('boar', -60 + r() * 120, 38 + r() * 55);
    for (let i = 0; i < 10; i++) this.addMob('wolf', -60 + r() * 120, 100 + r() * 45);
    this.boss = this.addMob('warden', WORLD.arena.x, WORLD.arena.z + 4);
    this.addMob('alpha', -38, 122); // each Alpha leads a pack in the wolf woods
    this.addMob('alpha', 38, 116);
    for (const [x, z] of [[-24, 58], [28, 70], [-48, 84], [46, 96], [-16, 132], [20, 140]]) this.addMob('spitter', x, z);
  }

  addMob(type, x, z) {
    const def = MOBS[type];
    [x, z] = resolveCollision(x, z, def.radius);
    const m = {
      id: this.id(), type, def, sx: x, sz: z, x, z, face: Math.random() * 6.28,
      hp: def.hp, maxHp: def.hp, dead: false, deadUntil: 0, threat: new Map(),
      atkT: 0, windupAt: 0, stunUntil: 0, wanderT: Math.random() * 4, wx: x, wz: z,
      contributors: new Set(), phase: 0, slamT: 0, spinT: 0, moving: false,
      staggerUntil: 0, staggerBy: 0, staggerCd: 0, switched: false, howlT: 0, frenzyUntil: 0, aimX: 0, aimZ: 0,
    };
    this.mobs.set(m.id, m);
    return m;
  }

  spawnPoint() {
    if (process.env.SPAWN_AT) { const [x, z] = process.env.SPAWN_AT.split(',').map(Number); return [x, z]; } // testing aid
    const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 3;
    return resolveCollision(Math.sin(a) * d, Math.cos(a) * d);
  }

  // saved = { charId, accountId, lvl, xp, gold, inv } for an account character; omitted for anonymous players (not saved)
  addPlayer(ws, name, cls, saved = null) {
    if (!CLASSES[cls]) cls = 'swordsman';
    name = String(name || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || `Player${this.nextId}`;
    const [x, z] = this.spawnPoint();
    const p = {
      id: this.id(), ws, name, cls, lvl: 1, xp: 0, x, z, face: 0, dead: false, respawnAt: 0,
      cds: [0, 0, 0, 0], dr: { until: 0, v: 0 }, dmg: { until: 0, v: 0 }, party: null,
      posSeq: 0, lastMoveT: this.time, lastHurt: -99, invite: null, dodgeCd: 0, rollUntil: 0, iframeUntil: 0, combo: 0, lastBasic: -9, jumpCd: 0, airFrom: 0, airUntil: 0,
      gold: 0, inv: newInventory(), consCd: {}, tonicUntil: 0, draughtUntil: 0, lfg: false,
      sid: crypto.randomBytes(6).toString('hex'), joinedAt: this.time, kills: 0, deaths: 0, switches: 0, trackN: 0,
    };
    p.lvl = Math.min(MAX_LEVEL, Math.max(1, Number(process.env.START_LEVEL) || 1)); // START_LEVEL is a testing aid
    if (saved) {
      p.charId = saved.charId; p.accountId = saved.accountId;
      p.lvl = Math.min(MAX_LEVEL, Math.max(1, saved.lvl | 0)); p.xp = Math.max(0, saved.xp | 0);
      p.gold = Math.max(0, saved.gold | 0);
      if (saved.inv && Array.isArray(saved.inv.bag) && saved.inv.eq && saved.inv.cons) p.inv = saved.inv;
    }
    p.lvlStart = p.lvl;
    p.stats = newStats(saved?.stats); // lifetime stats + titles (memory-only for anonymous players)
    p.stats.maxLvl = Math.max(p.stats.maxLvl, p.lvl);
    this.initMastery(p, saved?.mastery); // skill mastery + evolutions (server/mastery.js)
    this.initTalents(p, saved?.talents); // talent tree (server/talents.js)
    this.checkTitles(p);
    this.recompute(p);
    p.hp = p.maxHp;
    this.players.set(p.id, p);
    this.sys(`${p.name} the ${CLASSES[cls].name} entered the tower.`);
    this.track(p, 'session_start', { cls, lvl: p.lvl, anon: !saved, fresh: !!saved && p.lvl === 1 && p.xp === 0 });
    this.announceRareTo(p); // a late joiner still gets the banner/beam for a rare that's already out
    return p;
  }

  removePlayer(p) {
    this.leaveParty(p);
    this.gate.ready.delete(p.id);
    this.players.delete(p.id);
    this.sys(`${p.name} left.`);
    this.track(p, 'session_end', { secs: Math.round(this.time - p.joinedAt), kills: p.kills, deaths: p.deaths, lvl: p.lvl, lvlStart: p.lvlStart, switches: p.switches, gold: p.gold, ...this.quitCtx?.(p) });
  }

  // Base class stats plus equipped gear. Keeps the same health fraction.
  recompute(p) {
    const frac = p.maxHp ? p.hp / p.maxHp : 1;
    const base = statsFor(p.cls, p.lvl), g = gearStats(p.inv.eq);
    p.atk = base.atk * (1 + g.atk / 100);
    p.maxHp = Math.round(base.maxHp * (1 + g.hp / 100));
    p.crit = 0.1 + g.crit / 100;
    p.haste = Math.min(0.4, g.haste / 100);
    p.swPow = g.sw / 100;
    p.gearDr = Math.min(0.3, g.dr / 100);
    this.talentStats?.(p); // talent tree bonuses (server/talents.js)
    if (p.hp !== undefined) p.hp = Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * frac)));
  }

  // ---------- messaging helpers ----------
  sys(text, to) { this.events.push({ t: 'sys', text, to }); }
  schedule(delay, fn) { this.scheduled.push({ at: this.time + delay, fn }); }
  teleport(p, x, z) {
    p.x = x; p.z = z; p.posSeq++;
    this.events.push({ t: 'tp', id: p.id, x: r2(x), z: r2(z), s: p.posSeq });
  }

  // ---------- input ----------
  handle(p, msg) {
    switch (msg.type) {
      case 'input': return this.onInput(p, msg);
      case 'skill': p.healTid = msg.tid | 0; return this.useSkill(p, msg.slot | 0, msg.face); // tid: a heal's preferred target (bots)
      case 'dodge': return this.dodge(p, msg.face);
      case 'jump': return this.jump(p);
      case 'guard': return this.guard(p, msg.on);
      case 'chat': { // ch: 'p' party chat, 's' say (heard nearby); otherwise everyone
        const text = String(msg.text || '').slice(0, 200).trim();
        if (!text) return;
        const order = parseBotChat(text); // "/b <order>": a bot order, never chat (ordinary chat never orders bots)
        if (order) return this.botChat(p, order);
        const ch = msg.ch === 'p' && p.party ? { ch: 'p', party: p.party } : msg.ch === 's' ? { ch: 's', x: r2(p.x), z: r2(p.z) } : {};
        this.events.push({ t: 'chat', from: p.name, id: p.id, text, ...ch, ...(p.admin ? { adm: 1 } : {}) });
        return;
      }
      case 'target': { // the mob a player has locked (party bots assist it)
        const id = msg.id | 0;
        if (id !== (p.target || 0)) { p.target = id; this.events.push({ t: 'ptgt', id: p.id, m: id }); }
        return;
      }
      case 'botcmd': return this.botCommand(p, msg);
      case 'cover': return this.cover(p, msg.tid); // Guardian Cover (server/threat.js)
      case 'test': // testing aid (TEST_HOOKS=1 only): { hurt: fraction } sets your health, { xp } gives XP, for the bot tests
        if (process.env.TEST_HOOKS && msg.hurt > 0 && msg.hurt <= 1 && !p.dead) p.hp = Math.max(1, Math.round(p.maxHp * msg.hurt));
        if (process.env.TEST_HOOKS && msg.xp > 0) this.giveXp(p, Math.min(1e6, msg.xp | 0)); // { xp }: level up (bot level sync tests)
        return;
      case 'invite': return this.invite(p, msg.id);
      case 'ready': return this.toggleReady(p);
      case 'lfg': return this.toggleLfg(p);
      case 'use': return this.useItem(p, String(msg.id));
      case 'equip': return this.equip(p, msg.u | 0);
      case 'unequip': return this.unequip(p, String(msg.slot));
      case 'buy': return this.buy(p, msg.i | 0);
      case 'sell': return this.sell(p, msg.u | 0);
      case 'discard': return this.discard(p, msg.u | 0);
      case 'drop': return this.dropItem(p, msg.u | 0);
      case 'pickup': return this.pickUp(p, msg.id | 0);
      case 'dropStack': return this.dropStack(p, String(msg.kind), String(msg.id), msg.n | 0);
      case 'discardStack': return this.discardStack(p, String(msg.kind), String(msg.id), msg.n | 0);
      case 'title': return this.setTitle(p, msg.id);
      case 'smith': return this.smith(p, msg);
      case 'track': // the client's first-time guide reports progress
        if (msg.k === 'guide' && Number.isInteger(msg.step) && msg.step >= 0 && msg.step < 30 && p.trackN++ < 60) this.track(p, 'guide', { step: msg.step });
        return;
      case 'accept': return this.accept(p, msg.from);
      case 'decline': p.invite = null; return;
      case 'leave': return this.leaveParty(p);
      case 'warp': return this.warp(p, msg.f); // waystones and the Stairway (server/floor2.js)
      case 'evolve': return this.chooseBranch(p, String(msg.sk), String(msg.br)); // skill evolutions (server/mastery.js)
      case 'talent': return this.talentAction(p, msg); // talent tree: spend / refund / reset (server/talents.js)
    }
  }

  onInput(p, msg) {
    if (typeof msg.face === 'number' && isFinite(msg.face)) p.face = wrapAngle(msg.face);
    if (p.dead || msg.seq !== p.posSeq) return;
    let x = +msg.x, z = +msg.z;
    if (!isFinite(x) || !isFinite(z)) return;
    const dt = Math.min(0.5, this.time - p.lastMoveT);
    p.lastMoveT = this.time;
    const rolling = this.time < p.rollUntil + 0.15;
    const maxD = (rolling ? DODGE.dist / DODGE.time : SPRINT_SPEED) * dt * 1.3 + 0.35;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > maxD) { x = p.x + (dx / d) * maxD; z = p.z + (dz / d) * maxD; }
    if (!this.walk(x, z)) return;
    if (!this.gate.open && crossesGate(p.x, p.z, x, z)) return;
    if (!this.gate2.open && crossesGate2(p.x, p.z, x, z)) return;
    if (!this.gate3.open && crossesGate3(p.x, p.z, x, z)) return;
    p.x = x; p.z = z;
  }

  walk(x, z) { return walkable(x, z, !(x > F3.split ? this.gate3 : x > F2.split ? this.gate2 : this.gate).open); }

  // ---------- raid gate ----------
  toggleReady(p) {
    if (p.x > F3.split) return this.toggleReady3(p); // the Storm Gate (server/floor3.js)
    if (p.x > F2.split) return this.toggleReady2(p);
    const g = this.gate;
    if (p.dead || g.open || !inGateZone(p.x, p.z)) return;
    if (g.ready.has(p.id)) g.ready.delete(p.id);
    else { g.ready.add(p.id); this.track(p, 'gate_ready', {}); }
  }

  updateGate() {
    const g = this.gate, t = this.time;
    const waiting = [...this.players.values()].filter(p => !p.dead && inGateZone(p.x, p.z));
    for (const id of g.ready) if (!waiting.some(p => p.id === id)) g.ready.delete(id);
    if (!g.open) {
      // Everyone at the gate ready, OR someone has been ready for a while (so an idle player can't block the raid)
      if (!g.ready.size) g.firstReadyAt = 0; else if (!g.firstReadyAt) g.firstReadyAt = t;
      const allReady = waiting.length > 0 && (g.ready.size === waiting.length || (g.firstReadyAt && t - g.firstReadyAt >= GATE.force));
      if (allReady && !g.countAt) {
        g.countAt = t + GATE.count;
        this.events.push({ t: 'gate', s: 'count', d: GATE.count });
      } else if (!allReady && g.countAt) {
        g.countAt = 0;
        this.events.push({ t: 'gate', s: 'cancel' });
      }
      if (g.countAt && t >= g.countAt) {
        g.open = true; g.countAt = 0; g.ready.clear(); g.emptySince = 0;
        this.events.push({ t: 'gate', s: 'open' });
        this.sys('The raid gate rises. The Horned Warden awaits.');
      }
      return;
    }
    // Close again once the chamber is empty and the boss isn't fighting anyone.
    const inside = [...this.players.values()].some(p => !p.dead && (inArena(p.x, p.z) || (Math.abs(p.x) < 7 && p.z > GATE.band[0] - 1)));
    const busy = this.boss && !this.boss.dead && this.boss.threat.size > 0;
    if (inside || busy) { g.emptySince = 0; return; }
    if (!g.emptySince) g.emptySince = t;
    if (t - g.emptySince > 15) { g.open = false; g.emptySince = 0; this.events.push({ t: 'gate', s: 'close' }); }
  }

  // ---------- items ----------
  invFor(p) {
    return { type: 'inv', gold: p.gold, bag: p.inv.bag, eq: p.inv.eq, cons: p.inv.cons, mats: p.inv.mats || {},
      stats: { atk: Math.round(p.atk * 10) / 10, maxHp: p.maxHp, crit: Math.round(p.crit * 100), haste: Math.round(p.haste * 100), sw: Math.round(p.swPow * 100), dr: Math.round(p.gearDr * 100) },
      life: p.stats }; // lifetime stats, earned titles (life.titles) and life.activeTitle
  }
  invChanged(p) { p.invDirty = true; p.dirty = true; }

  // ---------- lifetime stats & titles ----------
  bumpStat(p, k, n = 1) { p.stats[k] = (p.stats[k] || 0) + n; p.dirty = true; this.checkTitles(p); }

  statKill(m, killer) {
    const s = killer.stats;
    s.kills++;
    if (m.type === 'boar') s.boarKills++;
    else if (m.type === 'wolf') s.wolfKills++;
    killer.dirty = true;
    this.checkTitles(killer);
  }

  // Award any newly met titles. With no active title yet, the first one earned is worn automatically.
  checkTitles(p) {
    const s = p.stats;
    let got = false;
    for (const t of TITLES) {
      if (s.titles.includes(t.id) || !meetsTitle(t, s)) continue;
      s.titles.push(t.id); got = true;
      this.events.push({ t: 'title', to: p.id, id: t.id, name: t.name });
      this.sys(`Title earned: ${t.name}`, p.id);
      this.track(p, 'title', { id: t.id });
      if (!s.activeTitle) { s.activeTitle = t.id; this.rosterDirty = true; }
    }
    if (got) { p.dirty = true; p.invDirty = true; }
  }

  setTitle(p, id) {
    id = id ? String(id) : null;
    if (id && !p.stats.titles.includes(id)) return;
    if (p.stats.activeTitle === id) return;
    p.stats.activeTitle = id;
    p.dirty = true; p.invDirty = true; this.rosterDirty = true;
  }

  // A Warden kill: stats/titles for everyone who fought, and a Hall of Clearers record (this.onClear, wired by the server).
  recordClear(m, killer) {
    const f = this.fight, first = !this.hadFirstClear;
    this.hadFirstClear = true;
    const party = [];
    for (const id of m.contributors) {
      const p = this.players.get(id);
      if (!p) continue;
      party.push({ name: p.name, cls: p.cls, lvl: p.lvl });
      p.stats.wardenKills++;
      if (first) p.stats.floorClearsFirst++;
      if (f && !f.pd?.get(p.id)) p.stats.flawlessWarden++;
      p.dirty = true;
      if (p !== killer) this.checkTitles(p);
    }
    this.bumpStat(killer, 'lastAttacks');
    if (first) this.ringBell(1, { auto: true }); // the Tower Bell (server/bell.js)
    this.onClear?.({ floor: 1, secs: f ? Math.round(this.time - f.start) : 0, players: party, lastAttack: killer.name, deaths: f?.deaths || 0, first });
  }

  giveItem(p, it) {
    if (p.inv.bag.length >= BAG_SIZE) {
      p.gold += sellPrice(it);
      this.sys(`Bag full: ${it.name} was sold for ${sellPrice(it)} gold.`, p.id);
      return false;
    }
    p.inv.bag.push(it);
    return true;
  }

  useItem(p, id) {
    const c = CONSUMABLES[id], t = this.time;
    if (!c || p.dead || !(p.inv.cons[id] > 0) || t < (p.consCd[id] || 0)) return;
    if (id === 'potion') {
      if (p.hp >= p.maxHp) return this.sys('Already at full health.', p.id);
      this.healPlayer(p, p.maxHp * 0.4);
      this.events.push({ t: 'fx', k: 'heal', s: 'potion', by: p.id, id: p.id, x: r2(p.x), z: r2(p.z) });
    } else if (id === 'tonic') {
      p.tonicUntil = t + 30; this.events.push({ t: 'buff', id: p.id, k: 'tonic', d: 30 });
    } else if (id === 'draught') {
      p.draughtUntil = t + 30; this.events.push({ t: 'buff', id: p.id, k: 'draught', d: 30 });
    }
    p.inv.cons[id]--;
    p.consCd[id] = t + c.cd;
    this.events.push({ t: 'drink', id: p.id, k: id });
    this.invChanged(p);
  }

  equip(p, u) {
    const i = p.inv.bag.findIndex(it => it.u === u);
    if (i < 0) return;
    const it = p.inv.bag[i];
    if (!SLOTS.includes(it.slot)) return;
    if (it.cls && it.cls !== p.cls) return this.sys(`Only a ${CLASSES[it.cls].name} can use that.`, p.id);
    p.inv.bag.splice(i, 1);
    const old = p.inv.eq[it.slot];
    if (old) p.inv.bag.splice(i, 0, old);
    p.inv.eq[it.slot] = it;
    this.recompute(p); this.invChanged(p);
    this.events.push({ t: 'equip', id: p.id });
  }

  unequip(p, slot) {
    const it = p.inv.eq[slot];
    if (!it) return;
    if (p.inv.bag.length >= BAG_SIZE) return this.sys('Your bag is full.', p.id);
    p.inv.eq[slot] = null; p.inv.bag.push(it);
    this.recompute(p); this.invChanged(p);
  }

  nearMerchant(p) { return !p.dead && Math.hypot(p.x - MERCHANT.x, p.z - MERCHANT.z) < MERCHANT.r + 1.5; }

  buy(p, i) {
    const s = SHOP[i];
    if (!s || !this.nearMerchant(p)) return;
    const price = s.kind === 'cons' ? CONSUMABLES[s.id].price : s.price;
    if (p.gold < price) return this.sys('Not enough gold.', p.id);
    if (s.kind === 'gear' && p.inv.bag.length >= BAG_SIZE) return this.sys('Your bag is full.', p.id);
    p.gold -= price;
    if (s.kind === 'cons') p.inv.cons[s.id] = (p.inv.cons[s.id] || 0) + 1;
    else p.inv.bag.push(rollGear(s.slot, 1, p.cls, Math.random, undefined, s.alt ? altStyle(p.cls) : undefined)); // alt: weapon styles
    this.events.push({ t: 'coin', id: p.id });
    this.invChanged(p);
  }

  // Throw away a bag item (anywhere; the client asks for a second click first).
  discard(p, u) {
    const i = p.inv.bag.findIndex(it => it.u === u);
    if (i < 0) return;
    if (p.inv.bag[i].ks) return this.sys('A keepsake stays with you.', p.id);
    const [it] = p.inv.bag.splice(i, 1);
    this.sys(`Discarded ${it.name}.`, p.id);
    this.track(p, 'discard', { r: it.r, slot: it.slot });
    this.invChanged(p);
  }

  sell(p, u) {
    if (!this.nearMerchant(p)) return;
    const i = p.inv.bag.findIndex(it => it.u === u);
    if (i < 0) return;
    if (p.inv.bag[i].ks) return this.sys("The merchant won't take a keepsake.", p.id);
    const [it] = p.inv.bag.splice(i, 1);
    p.gold += sellPrice(it);
    this.events.push({ t: 'coin', id: p.id });
    this.invChanged(p);
  }

  // Personal loot: dropLoot(p, m) lives in server/loot.js (data-driven tables in shared/loot.js).

  // ---------- party finder ----------
  toggleLfg(p) {
    const party = this.partyOf(p);
    if (party) {
      party.open = !party.open && party.members.length < PARTY_MAX;
      for (const id of party.members) this.sys(party.open ? `${p.name} opened the party to the party finder.` : 'The party is no longer recruiting.', id);
      return;
    }
    p.lfg = !p.lfg;
    this.sys(p.lfg ? 'Looking for a party… you\'ll be matched with other players automatically.' : 'Stopped looking for a party.', p.id);
  }

  matchParties() {
    const seekers = [...this.players.values()].filter(p => p.lfg && !p.party);
    for (const p of seekers) {
      if (!p.lfg || p.party) continue;
      let best = null;
      for (const party of this.parties.values()) {
        if (!party.open || party.members.length >= PARTY_MAX) continue;
        if (!best || party.members.length < best.members.length) best = party;
      }
      if (best) { this.joinParty(p, best, 'finder'); continue; }
      const other = seekers.find(o => o !== p && o.lfg && !o.party);
      if (!other) continue;
      const party = { id: this.id(), members: [other.id], open: true };
      this.parties.set(party.id, party);
      other.party = party.id; other.lfg = false;
      this.track(other, 'party_join', { via: 'finder', secs: Math.round(this.time - other.joinedAt) });
      this.joinParty(p, party, 'finder');
    }
  }

  joinParty(p, party, via) {
    if (party.members.length >= PARTY_MAX) return this.sys('That party is full.', p.id);
    if (p.party !== party.id) this.leaveParty(p);
    party.members.push(p.id);
    p.party = party.id; p.lfg = false;
    if (party.members.length >= PARTY_MAX) party.open = false;
    for (const id of party.members) this.sys(`${p.name} joined the party${via === 'finder' ? ' (party finder)' : ''}.`, id);
    this.events.push({ t: 'pjoin', id: p.id, party: party.id });
    this.track(p, 'party_join', { via, secs: Math.round(this.time - p.joinedAt), size: party.members.length });
  }

  // ---------- dodge roll ----------
  dodge(p, face) {
    if (p.dead || this.time < p.dodgeCd) return;
    if (typeof face !== 'number' || !isFinite(face)) face = p.face;
    p.dodgeCd = this.time + DODGE.cd;
    p.rollUntil = this.time + DODGE.time;
    p.iframeUntil = this.time + DODGE.iframes;
    p.face = wrapAngle(face);
    this.events.push({ t: 'roll', id: p.id, f: r2(p.face) });
  }

  jump(p) {
    const t = this.time;
    if (p.dead || t < p.jumpCd) return;
    p.jumpCd = t + JUMP.cd; p.airFrom = t + JUMP.airFrom; p.airUntil = t + JUMP.airTo;
    this.events.push({ t: 'jump', id: p.id });
  }

  // ---------- parties ----------
  partyOf(p) { return p.party ? this.parties.get(p.party) : null; }

  // An order for the bots in the sender's party (the command wheel). Admins can also order any bot by name.
  // Bots read it from the snapshot's events (shared/bots/brain.js) and check the party themselves.
  botCommand(p, msg) {
    const cmd = String(msg.cmd || '');
    let name = msg.name ? String(msg.name).slice(0, 16) : '';
    if (!BOT_COMMANDS[cmd]) return false;
    if (!p.party && !(p.admin && name)) { this.sys('Invite some bots into your party first.', p.id); return false; }
    if (name && p.party) { // a party member by full name, else by a unique start of it ("/b ly: heal" is Lyra)
      const lower = name.toLowerCase(), mates = this.partyOf(p).members.filter(id => id !== p.id).map(id => this.players.get(id)).filter(Boolean);
      const hit = mates.find(o => o.name.toLowerCase() === lower) || (c => (c.length === 1 ? c[0] : null))(mates.filter(o => o.name.toLowerCase().startsWith(lower)));
      if (hit) name = hit.name;
      else if (!p.admin) { this.sys(`No bot called "${name}" in your party.`, p.id); return false; }
    }
    this.events.push({ t: 'botcmd', by: p.id, byName: p.name, party: p.party || 0, cmd, ...(name ? { name } : {}), tgt: p.target || 0, ...(p.admin ? { adm: 1 } : {}) });
    return name || true;
  }

  // A /b chat line (shared/bots/social.js parseBotChat): help, an error, or an order. Never shown as chat.
  botChat(p, o) {
    if (o.help) { for (const line of botHelp()) this.sys(line, p.id); return; }
    if (o.error) return this.sys(o.error, p.id);
    const to = this.botCommand(p, o);
    if (to) this.sys(`Order to ${to === true ? 'your bots' : to}: ${BOT_COMMANDS[o.cmd].label}.`, p.id);
  }

  invite(p, targetId) {
    const t = this.players.get(targetId);
    if (!t || t === p) return;
    const party = this.partyOf(p);
    if (party && party.members.length >= PARTY_MAX) return this.sys('Your party is full.', p.id);
    if (t.party && t.party === p.party) return;
    t.invite = { from: p.id, at: this.time };
    this.events.push({ t: 'invite', to: t.id, from: p.id, name: p.name });
    this.sys(`Invited ${t.name} to your party.`, p.id);
  }

  accept(p, fromId) {
    const inviter = this.players.get(fromId);
    if (!inviter || !p.invite || p.invite.from !== fromId) return;
    p.invite = null;
    let party = this.partyOf(inviter);
    if (!party) {
      party = { id: this.id(), members: [inviter.id] };
      this.parties.set(party.id, party);
      inviter.party = party.id;
    }
    this.joinParty(p, party, 'invite');
  }

  leaveParty(p) {
    const party = this.partyOf(p);
    p.party = null;
    if (!party) return;
    party.members = party.members.filter(id => id !== p.id);
    for (const id of party.members) this.sys(`${p.name} left the party.`, id);
    if (party.members.length <= 1) {
      for (const id of party.members) { const m = this.players.get(id); if (m) m.party = null; }
      this.parties.delete(party.id);
    }
  }

  // ---------- skills ----------
  dmgMult(p) { return (this.time < p.dmg.until ? 1 + p.dmg.v : 1) * (this.time < p.tonicUntil ? 1.15 : 1) * (this.time < p.cry.until ? 1 + p.cry.v : 1); }

  useSkill(p, slot, face) {
    if (p.dead || p.guarding) return; // a guarding Guardian can't attack
    const sk = CLASSES[p.cls].skills[slot];
    if (!sk || p.lvl < sk.lvl || this.time < p.cds[slot]) return;
    if (typeof face === 'number' && isFinite(face)) p.face = wrapAngle(face);
    if (this.classSkillA?.(p, slot, sk)) return; // Ranger / Berserker skills (server/classes-a.js)
    // Skill mastery (server/mastery.js): S = the skill credited with mastery (not the basic attack), pow = Mastery 4's +10%,
    // and from Mastery 3 an evolved branch replaces the skill entirely.
    const S = slot > 0 ? sk.id : undefined, pow = slot > 0 ? this.skillPow(p, sk.id) : 1, br = slot > 0 ? this.branchOf(p, sk.id) : null;
    const cd = this.skillCd(p, sk, slot);
    if (this.useClassSkillB?.(p, sk, slot, { S, pow, br, cd })) return; // Lancer, Bard (server/classes-b.js)
    if (br) { if (this.useEvolved(p, sk, br, pow) !== false) p.cds[slot] = this.time + cd; return; }
    p.cds[slot] = this.time + cd;
    const atk = p.atk * this.dmgMult(p) * pow;
    const fx = (k, extra = {}) => this.events.push({ t: 'fx', k, s: sk.id, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), ...extra });
    const t = this.time;
    if (this.styleSkill(p, sk, slot, atk)) return; // weapon styles: the styled basic attack (server/styles.js)

    switch (sk.id) {
      case 'slash':
      case 'bash': {
        p.combo = t - p.lastBasic < 1.0 ? (p.combo + 1) % 3 : 0;
        p.lastBasic = t;
        const fin = p.combo === 2, threat = sk.id === 'bash' ? 2.5 : 1;
        fx('arc', { r: fin ? 3.5 : 3, n: p.combo, c: fin || sk.id === 'bash' ? 'gold' : undefined, fin: fin ? 1 : 0 });
        this.hitArc(p, fin ? 3.5 : 3, fin ? 1.3 : 1.05, atk * (fin ? 1.6 : 1), { threat, knock: fin ? 2 : 0.35, heavy: fin });
        break;
      }
      case 'rush': {
        let tx = p.x, tz = p.z;
        for (let i = 1, n = this.styleNum(p, 'rushSteps', 16); i <= n; i++) { // Rapier: a longer lunge
          const nx = p.x + Math.sin(p.face) * i * 0.5, nz = p.z + Math.cos(p.face) * i * 0.5;
          if (!this.walk(nx, nz)) break;
          [tx, tz] = resolveCollision(nx, nz);
        }
        fx('rush', { x2: r2(tx), z2: r2(tz) });
        this.hitLine(p, p.x, p.z, tx, tz, 1.8, atk * 1.6, { knock: 1.5, sk: S });
        this.teleport(p, tx, tz);
        break;
      }
      case 'whirl': fx('ring', { r: 4 }); this.hitCircle(p, p.x, p.z, 4, atk * 1.4, { knock: 1.2, sk: S }); break;
      case 'burst':
        for (let i = 0, nb = this.styleNum(p, 'burstHits', 4); i < nb; i++) { // Dual Blades: +2 hits
          this.schedule(i * paced(0.2), () => {
            if (p.dead || !this.players.has(p.id)) return;
            this.events.push({ t: 'fx', k: 'arc', s: 'burst', n: i, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), r: 3.2, c: i === nb - 1 ? 'gold' : undefined });
            this.hitArc(p, 3.2, 0.9, p.atk * this.dmgMult(p) * pow * (i === nb - 1 ? 1.6 : 0.9), i === nb - 1 ? { brk: true, knock: 2.5, heavy: true, sk: S } : { knock: 0.3, sk: S });
          });
        }
        break;
      case 'taunt': {
        const R = 8 * this.styleNum(p, 'tauntR', 1); // Spear & Shield: +30%
        fx('ring', { r: R, c: 'gold' });
        for (const m of this.mobs.values()) {
          if (!this.targetable(m) || dist(m, p) > R + m.def.radius) continue; // burrowed lurkers can't be taunted
          this.tauntMob(m, p, 'taunt'); // lock + cuts (server/threat.js)
        }
        this.hitCircle(p, p.x, p.z, R, atk * 0.5, { sk: S });
        p.dr = { until: t + 4, v: 0.3 * pow, by: p.id, sk: S };
        this.events.push({ t: 'buff', id: p.id, k: 'dr', d: 4 });
        break;
      }
      case 'wall': p.dr = { until: t + 4, v: Math.min(0.7, 0.6 * pow), by: p.id, sk: S }; this.events.push({ t: 'buff', id: p.id, k: 'wall', d: 4 }); fx('shield'); break;
      case 'gslam': { const R = 5 * this.styleNum(p, 'slamR', 1); fx('ring', { r: R, c: 'gold' }); this.hitCircle(p, p.x, p.z, R, atk * 1.3, { stun: 1.5, threat: 1.5, brk: true, knock: 2, heavy: true, sk: S }); break; } // Mace & Shield: +20% radius
      case 'smite': {
        const range = 10, dx = Math.sin(p.face), dz = Math.cos(p.face);
        let best = null, bestT = range;
        for (const m of this.mobs.values()) {
          if (!this.targetable(m)) continue; // the bolt flies over burrowed lurkers
          const vx = m.x - p.x, vz = m.z - p.z, along = vx * dx + vz * dz;
          if (along < 0 || along > range + m.def.radius) continue;
          const perp = Math.abs(vx * dz - vz * dx);
          if (perp < 1.2 + m.def.radius && along < bestT) { best = m; bestT = Math.max(0, along); }
        }
        fx('bolt', { x2: r2(p.x + dx * bestT), z2: r2(p.z + dz * bestT) });
        if (best) this.damageMob(best, p, atk * 1.1, { interrupt: best.windupAt > 0 });
        break;
      }
      case 'heal': {
        let target = p, low = p.hp / p.maxHp;
        const want = p.healTid && this.players.get(p.healTid); // a bot healer's pick (its party's most hurt / "heal me")
        if (want && !want.dead && dist(want, p) <= 15 && want.hp < want.maxHp) low = -1, target = want;
        for (const o of this.players.values()) {
          if (o.dead || this.unhealable?.(o) || dist(o, p) > 15 * this.styleNum(p, 'healR', 1)) continue; // Wand: +50% range; downed: only while being revived
          const f = o.hp / o.maxHp;
          if (f < low) { low = f; target = o; }
        }
        this.healPlayer(target, (target.maxHp * 0.3 + 10 + p.lvl * 2) * pow, p, S);
        this.events.push({ t: 'fx', k: 'heal', s: 'heal', by: p.id, id: target.id, x: r2(target.x), z: r2(target.z) });
        break;
      }
      case 'bless': {
        fx('ring', { r: 15, c: 'light' });
        for (const o of this.players.values()) {
          if (o.dead || dist(o, p) > 15) continue;
          o.dmg = { until: t + 8, v: 0.25 * pow, by: p.id, sk: S };
          this.events.push({ t: 'buff', id: o.id, k: 'bless', d: 8 });
        }
        break;
      }
      case 'sanct': {
        this.zones.push({ x: p.x, z: p.z, r: 6, until: t + 5, next: t, owner: p.id, sk: S, heal: 0.06 * pow });
        fx('zone', { r: 6, d: 5 });
        break;
      }
    }
  }

  // Can a player's attack touch this mob? Not when dead or burrowed (Floor 2's Bog Lurkers: m.hidden).
  targetable(m) { return !!m && !m.dead && !m.hidden; }

  inArc(p, m, range, half) {
    const d = dist(p, m);
    if (d > range + m.def.radius) return false;
    if (d < m.def.radius + 0.5) return true;
    return Math.abs(wrapAngle(angleTo(p.x, p.z, m.x, m.z) - p.face)) <= half;
  }

  hitArc(p, range, half, amount, opts) {
    for (const m of this.mobs.values()) if (this.targetable(m) && this.inArc(p, m, range, half)) this.damageMob(m, p, amount, opts);
  }

  hitCircle(p, x, z, r, amount, opts) {
    for (const m of this.mobs.values()) {
      if (this.targetable(m) && Math.hypot(m.x - x, m.z - z) <= r + m.def.radius) this.damageMob(m, p, amount, opts);
    }
  }

  hitLine(p, x0, z0, x1, z1, width, amount, opts) {
    const lx = x1 - x0, lz = z1 - z0, len2 = lx * lx + lz * lz || 1;
    for (const m of this.mobs.values()) {
      if (!this.targetable(m)) continue;
      const tt = Math.max(0, Math.min(1, ((m.x - x0) * lx + (m.z - z0) * lz) / len2));
      if (Math.hypot(m.x - (x0 + lx * tt), m.z - (z0 + lz * tt)) <= width + m.def.radius) this.damageMob(m, p, amount, opts);
    }
  }

  // sk: the skill (slots 1-3) credited with mastery for this hit; frac: an extra posture chunk [normal/elite, boss] (evolved skills).
  damageMob(m, p, base, { threat = 1, stun = 0, brk = false, interrupt = false, knock = 0, heavy = false, sk = null, frac = null } = {}) {
    if (!this.targetable(m)) return;
    if (m.def.f2 && (base = this.f2DamageMod(m, p, base)) <= 0) return; // Floor 2: shells, burrowed lurkers
    if (m.def.f3 && (base = this.f3DamageMod(m, p, base)) <= 0) return; // Floor 3: harpies aloft, armour, Wind Wards
    const t = this.time;
    p.lastCombat = t;
    const crit = Math.random() < (p.crit ?? 0.1);
    // Switch: a staggered enemy takes extra damage from anyone but the player who broke it
    let mult = 1, sw = 0;
    if (t < m.staggerUntil && p.id !== m.staggerBy) {
      if (!m.switched) { mult = SWITCH.first; sw = 1; m.switched = true; } else mult = SWITCH.follow;
      mult *= 1 + (p.swPow || 0);
    }
    mult *= this.twistTaken(m); // Warden twist (Ironhide)
    mult *= this.hitMultA?.(m, p, sw) ?? 1; // Hunter's Mark (server/classes-a.js)
    const counter = this.counterHit(p); // perfect-dodge counter window
    if (counter) mult *= PERFECT.dmg * this.styleNum(p, 'counterDmg', 1); // Rapier: stronger counters
    const amount = Math.max(1, Math.round(base * (0.9 + Math.random() * 0.2) * (crit ? 1.5 : 1) * mult));
    const dealt = Math.min(amount, Math.max(0, m.hp)); // overkill doesn't count toward mastery
    m.hp -= amount;
    if (m.hp <= 0 && this.lastAttackHeld(m, p)) m.hp = 1; // a reserved Last Attack (server/staging.js)
    if (sk) this.masteryGain(p, sk, dealt, 'dmg');
    this.bookBuffs(p, dealt); // Blessing / Zeal / War Cry mastery
    this.afterHitA?.(m, p, dealt, sw); // Rage, lifesteal, Mark mastery (server/classes-a.js)
    if (sw) {
      this.events.push({ t: 'switch', id: m.id, by: p.id, from: m.staggerBy, a: amount });
      const from = this.players.get(m.staggerBy);
      if (from) this.giveXp(from, 5); // a little thank-you for setting it up
      if (from && m.staggerSk) this.masteryGain(from, m.staggerSk, MASTERY.setup); // the skill that broke it set up a Switch
      if (sk) this.masteryGain(p, sk, MASTERY.sw);
      p.switches++;
      this.bumpStat(p, 'switches');
      this.styleOnSwitch(p); // Dual Blades: cooldowns
    }
    this.addThreat(m, p, amount * threat * (p.threatMult || 1)); // Spear & Shield: +threat; clean multiplier, locks (server/threat.js)
    m.contributors.add(p.id);
    if (stun && !m.def.boss) m.stunUntil = t + stun;
    if (stun && m.def.boss) m.stunUntil = Math.max(m.stunUntil, t + stun * 0.3);
    this.events.push({ t: 'hit', id: m.id, a: amount, c: crit ? 1 : 0, by: p.id, sw, h: heavy ? 1 : 0 });
    if (m.hp <= 0) return this.killMob(m, p);
    if (knock && !m.def.boss && !m.def.ranged) this.knockback(m, p, knock);
    this.addPosture(m, p, amount, { heavy, brk, interrupt, counter, sk, frac }); // full posture = BROKEN (see combat.js)
    this.twistAfterHit(m); // Warden twist (Ironhide: longer Broken windows)
  }

  knockback(m, p, dist) {
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
    for (let k = 4; k >= 1; k--) { // try the full push, then shorter ones if something is in the way
      let nx = m.x + (dx / d) * dist * (k / 4), nz = m.z + (dz / d) * dist * (k / 4);
      [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
      if (walkable(nx, nz) && Math.hypot(nx - WORLD.town.x, nz - WORLD.town.z) > WORLD.town.r + 2) { m.x = nx; m.z = nz; break; }
    }
    if (dist >= 1.5) m.windupAt = 0; // big hits interrupt small enemies' attacks
  }

  killMob(m, killer) {
    if (this.lastAttackHeld(m, killer)) { m.hp = Math.max(1, m.hp); return; } // reserved for someone else (server/staging.js)
    m.dead = true; m.hp = 0;
    m.deadUntil = m.staged ? Infinity : this.time + (m.def.boss ? 60 : m.def.elite ? 45 : 15); // staged spawns stay down
    this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: m.def.boss ? 1 : 0 });
    if (m.temp || m.rare) this.mobs.delete(m.id);
    if (!killer.kills++) this.track(killer, 'first_kill', { secs: Math.round(this.time - killer.joinedAt), mob: m.type });
    this.statKill(m, killer);
    if (m.def.f2boss) return this.killSovereign(m, killer);
    if (m.def.f3boss) return this.killColossus(m, killer); // server/floor3.js
    if (m.def.boss) {
      const names = [];
      for (const id of m.contributors) {
        const p = this.players.get(id);
        if (p) { names.push(p.name); this.giveXp(p, m.def.xp); this.dropLoot(p, m); }
      }
      this.twistKill(m); // Warden twist reward bonus
      const quiet = this.quietClear?.(m.contributors, 'the Horned Warden'); // the Named alone: one quiet line (server/named.js)
      // Last Attack Bonus: a unique reward for whoever landed the killing blow.
      if (this.giveItem(killer, lastAttackItem())) this.invChanged(killer);
      if (!quiet) {
        this.events.push({ t: 'la', id: killer.id, name: killer.name, x: r2(m.x), z: r2(m.z) });
        this.sys(`LAST ATTACK BONUS: ${killer.name} landed the final blow and earned the Horn of the Warden!`);
      }
      this.clearHounds(); this.clearQuakes();
      if (quiet) this.sys(quiet);
      else {
        this.floorClears++;
        this.events.push({ t: 'clear', names, n: this.floorClears });
        this.sys(`The Horned Warden has fallen! Floor 1 cleared by ${names.join(', ')}. The Stairway to Floor 2 has opened!`);
      }
      this.recordClear(m, killer);
      this.f2WardenKilled(m);
      this.endFight('kill', m);
      return;
    }
    if (m.rare) return this.killRare(m, killer);
    const party = this.partyOf(killer);
    const ids = party ? party.members : [killer.id];
    const recips = ids.map(id => this.players.get(id)).filter(p => p && !p.dead && dist(p, m) <= 30 && !p.named); // (the Named take no share: server/named.js)
    if (!recips.length) recips.push(killer);
    const share = Math.round((m.def.xp * (1 + 0.2 * (recips.length - 1))) / recips.length);
    for (const p of recips) { this.giveXp(p, share); this.dropLoot(p, m); }
  }

  startFight(m) {
    const ids = [...this.players.values()].filter(p => !p.dead && inArena(p.x, p.z)).map(p => p.id);
    this.fight = { start: this.time, ids: new Set(ids), deaths: 0, hp: m.maxHp };
    for (const id of ids) this.track(this.players.get(id), 'boss_start', { players: ids.length, hp: m.maxHp, twist: this.twist?.id });
  }

  endFight(result, m) {
    const f = this.fight;
    if (!f) return;
    this.fight = null;
    const data = { result, secs: Math.round(this.time - f.start), players: f.ids.size, deaths: f.deaths, hpLeft: result === 'wipe' ? Math.round((m.hp / m.maxHp) * 100) : 0, phase: m.phase, twist: this.twist?.id };
    let first = true;
    for (const id of f.ids) { const p = this.players.get(id); if (p) { this.track(p, 'boss_end', first ? data : { ...data, sys: 1 }); first = false; } }
  }

  clearHounds() {
    for (const h of [...this.mobs.values()]) {
      if (!h.temp) continue;
      if (!h.dead) this.events.push({ t: 'die', id: h.id, x: r2(h.x), z: r2(h.z), b: 0 });
      this.mobs.delete(h.id);
    }
  }

  giveXp(p, amount) {
    if (p.lvl >= MAX_LEVEL) return;
    p.xp += amount;
    this.events.push({ t: 'xp', to: p.id, a: amount });
    while (p.lvl < MAX_LEVEL && p.xp >= xpToNext(p.lvl)) {
      p.xp -= xpToNext(p.lvl);
      p.lvl++;
      this.recompute(p); p.hp = p.maxHp;
      this.events.push({ t: 'lvl', id: p.id, lvl: p.lvl });
      this.track(p, 'level', { lvl: p.lvl, secs: Math.round(this.time - p.joinedAt) });
      const unlocked = CLASSES[p.cls].skills.find(s => s.lvl === p.lvl);
      if (unlocked) this.sys(`New skill unlocked: ${unlocked.name}!`, p.id);
    }
    if (p.lvl >= MAX_LEVEL) p.xp = 0;
    p.dirty = true;
    if (p.lvl > p.stats.maxLvl) { p.stats.maxLvl = p.lvl; this.checkTitles(p); }
  }

  // sk: the healer's skill credited with mastery (overheal doesn't count). Returns the health actually restored.
  healPlayer(t, amount, by, sk) {
    if (t.dead) return 0;
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + Math.round(amount));
    if (t.hp > before) this.events.push({ t: 'heal', id: t.id, a: t.hp - before });
    if (by && this.boss && !this.boss.dead && this.boss.threat.size && inArena(t.x, t.z)) this.boss.contributors.add(by.id);
    if (by && sk && t.hp > before) this.masteryGain(by, sk, t.hp - before, 'heal');
    return t.hp - before;
  }

  // peril: a perilous attack (Horn Sweep): only dodge i-frames or a parry avoid it; no damage reduction, jumping doesn't help.
  damagePlayer(p, base, { ground = false, src = '?', peril = false, mob = null } = {}) {
    if (p.dead || inTown(p.x, p.z)) return;
    if (this.time < p.iframeUntil) { this.evadeHit(p, src, mob); return; } // may be a perfect dodge
    if (ground && !peril && this.time >= p.airFrom && this.time < p.airUntil) { this.events.push({ t: 'evade', id: p.id, to: p.id, k: 'jump' }); return; }
    if (!peril && this.purified(p, src, base)) return; // Miracle (server/mastery.js)
    const guard = this.guardHit(p, src, mob, peril); // Guardian guard / parry
    if (guard === 'parry') return;
    let amount;
    if (peril) amount = Math.round(base);
    else {
      const raw = base * (0.9 + Math.random() * 0.2);
      const mod = this.hitMods(p, raw, src, mob); // Challenge, Bulwark, Haven, Iron Skin (server/mastery.js)
      const skDr = this.time < p.dr.until ? p.dr.v : 0, haven = mod.haven ? mod.haven.dr : 0;
      const dr = Math.min(0.8, skDr + haven + (p.gearDr || 0) + (this.time < p.draughtUntil ? 0.15 : 0));
      const pre = raw * mod.mult;
      amount = Math.max(1, Math.round(pre * (1 - dr)));
      amount = this.hurtModA?.(p, amount) ?? amount; // Berserker: thin armour (server/classes-a.js)
      this.bookDr(p, pre, skDr, mod.haven, dr); // mastery for the damage Taunt / Shield Wall / Haven prevented
      if (mod.reflect) this.reflectHit(p, mod.attacker, raw);
    }
    if (guard) amount = Math.max(1, Math.round(amount * (1 - GUARD.dr)));
    if (!peril) amount = this.absorbHit(p, amount); // Aegis shields
    amount = this.talentHurt?.(p, amount, guard, peril) ?? amount; // talents: guard block, ally auras, Guardian Spirit (server/talents.js)
    amount = this.protectHit(p, amount); // protect(): a scripted health floor (server/staging.js)
    if (amount <= 0) { p.lastHurt = this.time; p.lastCombat = this.time; return; }
    p.hp -= amount;
    p.lastHurt = this.time; p.lastCombat = this.time;
    this.onHurtA?.(p, amount); // Berserker Rage (server/classes-a.js)
    this.events.push({ t: 'hurt', id: p.id, a: amount, ...(this.bigHit(src) ? { big: 1 } : {}) }); // big: the victim's client hit-stops
    if (p.hp <= 0 && !this.goDown?.(p, src)) this.killPlayer(p, src); // downed instead, with a partymate nearby (server/revive.js)
  }

  // A player's death (0 HP, or a downed player bleeding out): XP loss, stats, tracking, `pdie`; respawns in 4 s.
  killPlayer(p, src = '?') {
    p.hp = 0; p.dead = true; p.respawnAt = this.time + 4;
    p.xp = Math.max(0, p.xp - Math.round(xpToNext(p.lvl) * 0.1)); p.dirty = true;
    p.deaths++;
    if (this.fight?.ids.has(p.id)) this.fight.deaths++;
    if (this.fight && (this.fight.ids.has(p.id) || inArena(p.x, p.z))) (this.fight.pd ||= new Map()).set(p.id, (this.fight.pd.get(p.id) || 0) + 1); // for "Undying"
    this.bumpStat(p, 'deaths');
    const floor = floorOf(p.x); // the respawn point (and the stats page) depend on the floor you died on
    this.track(p, 'death', { cause: src, lvl: p.lvl, floor, area: (floor === 3 ? inArena3(p.x, p.z) : floor === 2 ? inArena2(p.x, p.z) : inArena(p.x, p.z)) ? 'arena' : p.z > 95 ? 'woods' : 'field', ...this.fightCtx?.(p) });
    this.events.push({ t: 'pdie', id: p.id, src, f: floor });
    this.sys(`${p.name} was defeated.`);
  }

  // ---------- simulation ----------
  update(dt) {
    this.time += dt;
    const t = this.time;

    const due = this.scheduled.filter(s => s.at <= t);
    this.scheduled = this.scheduled.filter(s => s.at > t);
    for (const s of due) s.fn();

    for (const p of this.players.values()) {
      if (p.dead) {
        if (t >= p.respawnAt) {
          p.dead = false; p.hp = p.maxHp;
          const [x, z] = this.respawnPoint(p) || this.spawnPoint(); // Floor 2 deaths return to its camp
          this.teleport(p, x, z);
        }
        continue;
      }
      const town = inTown(p.x, p.z);
      if (p.hp < p.maxHp && (town || t - p.lastHurt > 6)) {
        p.regenAcc = (p.regenAcc || 0) + p.maxHp * (town ? 0.1 : 0.02) * dt;
        if (p.regenAcc >= 1) { const a = Math.floor(p.regenAcc); p.regenAcc -= a; p.hp = Math.min(p.maxHp, p.hp + a); }
      }
      if (p.invite && t - p.invite.at > 30) p.invite = null;
    }

    for (const zn of this.zones) {
      if (t >= zn.next) { zn.next = t + 0.5; this.zoneTick(zn); } // Sanctuary, Haven, Consecrate (server/mastery.js)
    }
    this.zones = this.zones.filter(zn => t < zn.until);
    this.updateMastery(); // Renew, Bulwark, Aegis upkeep

    // Mob AI only where someone is (see activeFloors): elsewhere mobs stand still, but the dead still come back on time.
    const live = this.activeFloors();
    for (const m of [...this.mobs.values()]) {
      if (m.dead || live.has(floorOf(m.x))) this.updateMob(m, dt);
      else m.moving = false;
    }
    this.updateCombat(dt); // posture decay, Horn Sweep
    this.updateProjectiles(dt);
    this.updateClassesA?.(dt); // arrows, traps, Rage (server/classes-a.js)
    this.updateGate();
    this.updateGround();
    this.updateFloor2(dt);
    this.updateFloor3(dt);
    this.updateRare();
    if (t >= this.lfgT) { this.lfgT = t + 1; this.matchParties(); }

    // keep mobs from stacking: per floor (mobs on different floors never meet), and only where they move
    const byFloor = this._sepLists ||= { 1: [], 2: [], 3: [] };
    for (const k in byFloor) byFloor[k].length = 0;
    for (const m of this.mobs.values()) { const f = floorOf(m.x); if (!m.dead && !m.def.prop && live.has(f)) byFloor[f].push(m); } // (trap objects stay put: J1)
    for (const k in byFloor) {
      const list = byFloor[k];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dz = b.z - a.z, min = a.def.radius + b.def.radius;
        if (dx > min || dx < -min || dz > min || dz < -min) continue; // (cheap reject before the square root)
        const d = Math.hypot(dx, dz);
        if (d < min && d > 1e-3) {
          const push = (min - d) / 2, ux = dx / d, uz = dz / d;
          if (!a.def.boss) { a.x -= ux * push; a.z -= uz * push; }
          if (!b.def.boss) { b.x += ux * push; b.z += uz * push; }
        }
      }
    }
  }

  // The floors whose mobs are simulated this tick (the empty world was ~60% of the tick on the free plan's 0.15 vCPU):
  // a floor with a human on it (anywhere, town included), a server bot out of the safe zones (bot-only parties and
  // tests, farming bots, the Named, who only come out near humans), a boss mid-fight (a fight with only bots counts;
  // so does a wipe being reset), or anyone at all while a director show runs. Nobody human online and no bot out: no
  // mob AI anywhere, the world sleeps (respawn timers still run). WORLD_SLEEP=0: every floor, always (benchmarks).
  activeFloors() {
    const on = this._liveFloors ||= new Set();
    on.clear();
    if (process.env.WORLD_SLEEP === '0') { on.add(1); on.add(2); on.add(3); return on; }
    const show = !!this.director?.running;
    for (const p of this.players.values()) if (!p.bot || show || (!p.dead && !inTown(p.x, p.z))) on.add(floorOf(p.x));
    for (const b of [this.boss, this.sovereign, this.colossus]) if (b && !b.dead && (b.engaged || b.threat.size || b.hp < b.maxHp)) on.add(floorOf(b.x));
    return on;
  }

  validTarget(m, p) {
    if (!p || p.dead || inTown(p.x, p.z)) return false;
    if (m.def.boss || m.temp) return inArena(p.x, p.z); // the Warden and its hounds stay in the chamber
    return dist(m, p) < 40;
  }

  updateMob(m, dt) {
    if (m.def.ai) return this[m.def.ai](m, dt); // Floor 2 mobs run their own AI (server/floor2.js)
    const t = this.time, def = m.def;
    m.moving = false;
    if (m.dead) {
      if (t >= m.deadUntil) {
        Object.assign(m, { dead: false, hp: m.maxHp, x: m.sx, z: m.sz, phase: 0, windupAt: 0, stunUntil: 0 });
        m.threat.clear(); m.contributors.clear();
        if (def.boss) this.sys('The Horned Warden stirs again in its chamber.');
        if (def.boss) this.newTwist(); // a new Warden twist for every respawn
      }
      return;
    }

    for (const pid of [...m.threat.keys()]) if (!this.validTarget(m, this.players.get(pid))) m.threat.delete(pid);
    if (def.aggro > 0) {
      for (const p of this.players.values()) {
        if (!m.threat.has(p.id) && this.validTarget(m, p) && dist(m, p) <= def.aggro) m.threat.set(p.id, 1);
      }
    }
    if (!def.boss && Math.hypot(m.x - m.sx, m.z - m.sz) > 35) m.threat.clear();

    const target = this.targetOf(m); // the one target picker (server/threat.js)

    if (t < m.stunUntil) return;

    if (!target) {
      m.windupAt = 0;
      if (def.boss && (m.hp < m.maxHp || m.engaged)) { // everyone left or died: reset the fight
        this.endFight('wipe', m);
        m.hp = m.maxHp; m.phase = 0; m.contributors.clear(); this.clearHounds(); this.clearQuakes();
        this.twistReset(m); // Warden twist hazards
      }
      m.engaged = false;
      if (t >= m.wanderT) {
        m.wanderT = t + 3 + Math.random() * 4;
        const a = Math.random() * 6.28, d = Math.random() * (def.boss ? 2 : 6);
        m.wx = m.sx + Math.sin(a) * d; m.wz = m.sz + Math.cos(a) * d;
      }
      this.moveMob(m, m.wx, m.wz, def.speed * 0.35, dt, 0.3);
      return;
    }

    if (def.boss && !m.engaged) { // scale the boss to the group that walks in
      m.engaged = true;
      this.scaleWarden(m);
      this.bossTable(m, this.twistW || WARDEN, [...this.players.values()].filter(p => !p.dead && inArena(p.x, p.z)).length); // m.tm (server/openings.js)
      m.phase = 0; m.slamT = t + WARDEN.slam.first; m.busyUntil = 0; m.houndT = m.chargeT = m.spinT = m.rockT = Infinity;
      m.quakeT = t + m.tm.quake.first[0]; this.clearQuakes();
      this.twistEngage(m); // Warden twist setup (before startFight records the fight's health)
      this.startFight(m);
    }
    const enraged = def.boss && m.phase === 2;
    if (def.boss) { this.bossSpecials(m, target); if (t < m.busyUntil) return; }

    // finish a wind-up attack
    if (m.windupAt) {
      if (t >= m.windupAt) {
        m.windupAt = 0;
        if (def.boss) {
          for (const p of this.players.values()) {
            if (p.dead) continue;
            const d = dist(m, p);
            if (d <= def.range + 1 && Math.abs(wrapAngle(angleTo(m.x, m.z, p.x, p.z) - m.face)) < 1.3) this.damagePlayer(p, def.atk * (m.tm || this.twistW || WARDEN).cleave.mult, { src: 'warden cleave' }); // x the table's mult (damageMul)
          }
          this.events.push({ t: 'fx', k: 'marc', id: m.id, x: r2(m.x), z: r2(m.z), f: r2(m.face), r: def.range + 1 });
        } else if (def.ranged) {
          this.shootThorn(m);
        } else {
          this.bite(m);
        }
      }
      return;
    }

    const d = dist(m, target);
    m.face = angleTo(m.x, m.z, target.x, target.z);
    const frenzy = t < m.frenzyUntil;
    if (m.type === 'alpha' || def.howl) this.alphaHowl(m);
    if (d > def.range + 0.4) {
      this.moveMob(m, target.x, target.z, def.speed * (enraged ? 1.25 : 1) * (frenzy ? 1.3 : 1), dt, def.range);
    } else if (t >= m.atkT && (!def.boss || this.swingReady(m))) {
      const wind = def.boss ? (m.tm || this.twistW || WARDEN).cleave.wind : def.ranged ? THORN.wind : 0.45;
      m.windupAt = t + wind;
      if (def.boss) this.swingStart(m, wind); // no point-blank chaining (server/openings.js)
      const cd = def.boss ? (m.tm || this.twistW || WARDEN).cleave.cd * (enraged ? (m.tm || this.twistW || WARDEN).cleave.rage : 1) : def.atkCd; // the boss: its table's cd (cooldownMul)
      m.atkT = t + cd * (frenzy ? 0.7 : 1) + (def.boss ? wind - wind / PACE : 0); // the paced wind-up doesn't eat the rest
      const ev = { t: 'wind', id: m.id, d: wind, f: r2(m.face) };
      if (def.ranged) { m.aimX = target.x; m.aimZ = target.z; ev.ax = r2(target.x); ev.az = r2(target.z); }
      else if (BITE[m.type]) { ev.r = BITE[m.type][0]; ev.h = BITE[m.type][1]; }
      this.events.push(ev);
    }
  }

  // A wolf/boar bite: lunge forward and hit everyone in the wedge in front of it.
  bite(m) {
    const [reach, half] = BITE[m.type] || [m.def.range + 1, 0.6];
    let atk = m.def.atk;
    if (m.type === 'wolf' && this.alphaNear(m)) atk *= 1 + PACK.auraAtk; // the pack hits harder with its Alpha around
    let nx = m.x + Math.sin(m.face) * 1.0, nz = m.z + Math.cos(m.face) * 1.0;
    [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
    if (walkable(nx, nz) && Math.hypot(nx - WORLD.town.x, nz - WORLD.town.z) > WORLD.town.r + 2) { m.x = nx; m.z = nz; }
    this.events.push({ t: 'fx', k: 'marc', id: m.id, x: r2(m.x), z: r2(m.z), f: r2(m.face), r: reach * 0.8, small: 1 });
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = dist(m, p);
      if (d > reach + 0.4) continue;
      if (d > m.def.radius + 0.6 && Math.abs(wrapAngle(angleTo(m.x, m.z, p.x, p.z) - m.face)) > half) continue;
      this.damagePlayer(p, atk, { src: `${m.type} bite`, mob: m });
    }
  }

  alphaNear(m) {
    for (const a of this.mobs.values()) if (a.type === 'alpha' && !a.dead && dist(a, m) < PACK.auraRange) return true;
    return false;
  }

  alphaHowl(m) {
    const t = this.time;
    if (!m.howlT) m.howlT = t + 4;
    if (t < m.howlT) return;
    m.howlT = t + PACK.howlEvery;
    m.frenzyUntil = t + PACK.frenzy;
    let n = 0;
    for (const w of this.mobs.values()) {
      if (w.dead || w.type !== 'wolf' || dist(w, m) > PACK.howlRange) continue;
      w.frenzyUntil = t + PACK.frenzy; n++;
    }
    this.events.push({ t: 'howl', id: m.id, n, r: PACK.howlRange });
  }

  shootThorn(m) {
    const base = angleTo(m.x, m.z, m.aimX, m.aimZ), n = m.def.spread || 1; // Thornmother fires a fan
    const ttl = (m.def.range + 2) / THORN.speed, off = m.def.radius + 0.3;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * RARE.spreadAngle, ux = Math.sin(a), uz = Math.cos(a);
      const vx = ux * THORN.speed, vz = uz * THORN.speed;
      const pr = { id: this.id(), x: m.x + ux * off, z: m.z + uz * off, vx, vz, ttl, atk: m.def.atk };
      this.projectiles.push(pr);
      this.events.push({ t: 'proj', id: pr.id, by: m.id, x: r2(pr.x), z: r2(pr.z), vx: r2(vx), vz: r2(vz), ttl: r2(ttl) });
    }
  }

  // ---------- rare named spawns ----------
  updateRare() {
    const R = this.rare, t = this.time;
    const rr = ([a, b]) => a + Math.random() * (b - a);
    if (R.mob) {
      const m = R.mob;
      if (m.dead || !this.mobs.has(m.id)) { R.mob = null; R.next = t + rr(RARE.every); return; }
      if (m.threat.size) m.touchedAt = t;
      if (t - m.bornAt > RARE.despawn && !m.threat.size && t - (m.touchedAt || 0) > 5) {
        this.events.push({ t: 'rareGone', id: m.id, name: m.def.name, x: r2(m.x), z: r2(m.z) });
        this.sys(`${m.def.name} has slipped away into the wilds.`);
        this.mobs.delete(m.id);
        R.mob = null; R.next = t + rr(RARE.every);
      }
      return;
    }
    if (t < R.next) return;
    const all = Object.keys(RARE.spawns), floors = new Set([...this.players.values()].filter(p => !p.bot).map(p => floorOf(p.x)));
    const near = all.filter(k => floors.has(floorOf(RARE.spawns[k].x[0]))); // prefer a floor someone is on (Floor 3 has its own)
    const pool = near.length ? near : all, type = pool[Math.floor(Math.random() * pool.length)];
    const pos = this.rareSpot(type);
    if (!pos) { R.next = t + 5; return; }
    this.spawnRare(type, pos[0], pos[1]);
  }

  // A random walkable spot in the rare's biome, clear of town, trees and nearby players.
  rareSpot(type) {
    const s = RARE.spawns[type], rad = MOBS[type].radius;
    for (let i = 0; i < 40; i++) {
      let x = s.x[0] + Math.random() * (s.x[1] - s.x[0]), z = s.z[0] + Math.random() * (s.z[1] - s.z[0]);
      [x, z] = resolveCollision(x, z, rad);
      if (!walkable(x, z) || inTown(x, z) || Math.hypot(x - WORLD.town.x, z - WORLD.town.z) < WORLD.town.r + 8) continue;
      if (z < s.z[0] - 2 || z > s.z[1] + 2) continue;
      if ([...this.players.values()].some(p => !p.dead && Math.hypot(p.x - x, p.z - z) < 12)) continue;
      return [x, z];
    }
    return null;
  }

  spawnRare(type, x, z) {
    const m = this.addMob(type, x, z);
    m.rare = true; m.bornAt = this.time; m.touchedAt = 0;
    m.sx = m.x; m.sz = m.z;
    this.rare.mob = m;
    this.events.push({ t: 'rare', id: m.id, type, name: m.def.name, x: r2(m.x), z: r2(m.z) });
    this.sys(`${m.def.name} has been sighted in ${RARE.spawns[type].where}!`);
    return m;
  }

  // Re-send the current rare's announcement to one player (e.g. someone who joined after it spawned).
  announceRareTo(p) {
    const m = this.rare.mob;
    if (!m || m.dead || !this.mobs.has(m.id)) return;
    this.events.push({ t: 'rare', to: p.id, late: 1, id: m.id, type: m.type, name: m.def.name, x: r2(m.x), z: r2(m.z) });
    this.sys(`${m.def.name} is roaming ${RARE.spawns[m.type].where}!`, p.id);
  }

  // Everyone who damaged a rare gets XP and their own loot roll, party or not.
  killRare(m, killer) {
    const names = [];
    for (const id of m.contributors) {
      const p = this.players.get(id);
      if (!p) continue;
      names.push(p.name); this.giveXp(p, m.def.xp); this.dropLoot(p, m);
    }
    if (!names.length) { names.push(killer.name); this.giveXp(killer, m.def.xp); this.dropLoot(killer, m); }
    const others = names.filter(n => n !== killer.name);
    const who = `${killer.name}${others.length ? ` with ${others.join(', ')}` : ''}`;
    this.events.push({ t: 'rareDown', id: m.id, name: m.def.name, by: killer.id, who: killer.name, x: r2(m.x), z: r2(m.z) });
    this.sys(`${m.def.name} has been slain by ${who}!`);
    this.rare.mob = null;
    const rr = ([a, b]) => a + Math.random() * (b - a);
    this.rare.next = this.time + rr(RARE.every);
  }

  updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt; pr.z += pr.vz * dt; pr.ttl -= dt;
      if (resolveCollision(pr.x, pr.z, 0.1)[0] !== pr.x) pr.ttl = 0; // hit a tree or rock
      for (const p of this.players.values()) {
        if (p.dead || pr.ttl <= 0) continue;
        if (Math.hypot(p.x - pr.x, p.z - pr.z) < THORN.radius + 0.4) { this.damagePlayer(p, pr.atk, { src: 'spitter thorn' }); pr.ttl = 0; }
      }
      if (pr.ttl <= 0) this.events.push({ t: 'pend', id: pr.id, x: r2(pr.x), z: r2(pr.z) });
    }
    this.projectiles = this.projectiles.filter(pr => pr.ttl > 0);
  }

  // The Horned Warden: each phase ADDS attacks rather than just more health.
  bossSpecials(m, target) {
    const t = this.time, W = m.tm || this.twistW || WARDEN, f = m.hp / m.maxHp;
    const want = f < W.phases[1] ? 2 : f < W.phases[0] ? 1 : 0;
    while (m.phase < want) {
      m.phase++;
      this.events.push({ t: 'phase', id: m.id, n: m.phase });
      if (m.phase === 1) {
        this.sys('The Horned Warden howls for its hounds!');
        m.houndT = t + WARDEN.hounds.first; m.chargeT = t + WARDEN.charge.first; // (shared/bosstiming.js)
      } else {
        this.events.push({ t: 'enrage', id: m.id });
        this.sys('The Horned Warden is enraged! The ceiling is coming down.');
        m.spinT = t + WARDEN.spin.first; m.rockT = t + WARDEN.rock.first;
      }
      m.quakeT = Math.min(m.quakeT ?? Infinity, t + W.quake.first[m.phase]); // more rings, sooner
    }
    const fighters = [...this.players.values()].filter(p => !p.dead && inArena(p.x, p.z));
    const pick = () => fighters[Math.floor(Math.random() * fighters.length)] || target;
    // Combos (the table's sequences), and the after state that follows one: its own timers wait (server/openings.js)
    if (this.bossCombo(m, k => this.wardenMove(m, k, target, fighters, pick), WARDEN_TIMERS)) return;

    // Ground slam on a random fighter (jump or roll out); a bigger party gets one circle per W.slam.per fighters
    if (t >= m.slamT && t >= m.busyUntil) { m.slamT = t + W.slam.every[m.phase]; this.wardenMove(m, 'slam', target, fighters, pick); }
    // Quake Ring: shockwaves roll out from the Warden (jump the wavefront, roll through it, or be out of reach)
    if (t >= m.quakeT && t >= m.busyUntil && !m.windupAt) { m.quakeT = t + W.quake.every[m.phase]; this.wardenMove(m, 'quake', target, fighters, pick); }
    if (m.phase >= 1) {
      if (t >= m.houndT) { m.houndT = t + W.hounds.every; this.wardenMove(m, 'hounds', target, fighters, pick); } // hounds join the fight
      // Horn charge: a long red lane, then the Warden barrels down it
      if (t >= m.chargeT && t >= m.busyUntil && !m.windupAt) { m.chargeT = t + W.charge.every; this.wardenMove(m, 'charge', target, fighters, pick); }
    }
    if (m.phase >= 2) {
      if (t >= m.spinT && t >= m.busyUntil && this.closeReady(m, 'spin')) { m.spinT = t + W.spin.every; this.wardenMove(m, 'spin', target, fighters, pick); }
      if (t >= m.rockT) { m.rockT = t + W.rock.every; this.wardenMove(m, 'rock', target, fighters, pick); } // Rockfall: a circle under every fighter, plus strays
    }
    this.bossTeam?.(m, fighters); // team mechanics: shared meteor, spread, tether (server/bossteam.js)
    this.twistSpecials(m, pick); // Warden twist behaviour
  }

  /** One of the Warden's moves, now (its own timer or a combo step). Returns when it ends (absolute s). */
  wardenMove(m, k, target, fighters, pick) {
    const t = this.time, W = m.tm || this.twistW || WARDEN;
    if (k === 'slam') {
      const { r, wind } = W.slam, n = Math.max(1, Math.ceil(fighters.length / (W.slam.per || 99)));
      const vs = [...fighters].sort(() => Math.random() - 0.5).slice(0, n);
      for (const v of vs.length ? vs : [target]) this.circleAttack(m, v.x, v.z, r, wind, m.def.atk * W.slam.mult, 'warden slam', true);
      this.areaHold(m, t + wind);
      return t + wind;
    }
    if (k === 'quake') return this.quakeRing(m);
    if (k === 'charge') return this.hornCharge(m, pick());
    if (k === 'sweep') return this.hornSweep(m);
    if (k === 'hounds') {
      let alive = 0; for (const h of this.mobs.values()) if (h.temp && !h.totem && !h.dead) alive++; // (Thorn Totems don't count)
      for (let i = 0; i < W.hounds.n && alive < W.hounds.max; i++, alive++) {
        const a = Math.random() * Math.PI * 2;
        const h = this.addMob('hound', WORLD.arena.x + Math.sin(a) * 18, WORLD.arena.z + Math.cos(a) * 18);
        h.temp = true; h.sx = h.x; h.sz = h.z;
        const v = pick(); if (v) h.threat.set(v.id, 5);
        this.events.push({ t: 'fx', k: 'summon', x: r2(h.x), z: r2(h.z) });
      }
      return t;
    }
    if (k === 'spin') {
      const { r, wind } = W.spin;
      this.events.push({ t: 'tele', x: r2(m.x), z: r2(m.z), r, d: wind, follow: m.id });
      this.closeLanded(m, 'spin', t + wind);
      this.schedule(wind, () => {
        if (m.dead) return;
        this.events.push({ t: 'fx', k: 'boom', x: r2(m.x), z: r2(m.z), r });
        for (const p of this.players.values()) if (!p.dead && dist(p, m) <= r) this.damagePlayer(p, m.def.atk * W.spin.mult, { ground: true, src: 'warden spin' });
      });
      return t + wind;
    }
    if (k === 'rock') {
      const spots = fighters.map(p => [p.x, p.z]);
      for (let i = 0; i < W.rock.extra; i++) {
        const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 16;
        spots.push([WORLD.arena.x + Math.sin(a) * d, WORLD.arena.z + Math.cos(a) * d]);
      }
      for (const [x, z] of spots) this.circleAttack(m, x, z, W.rock.r, W.rock.wind, m.def.atk * W.rock.mult, 'rockfall', false, 'rock');
      this.areaHold(m, t + W.rock.wind);
      return t + W.rock.wind;
    }
    return t;
  }

  // Health from the party's weight (fighters weighted by role, then raised to hpExp: a full party with three damage
  // dealers and a Bard gets far more than twice the health a tank/damage/healer trio does, since talents, styles and
  // support buffs multiply), damage from the party size, and both from the party's average level above the Warden's.
  scaleWarden(m) {
    const W = this.director?.running ? { ...WARDEN, ...WARDEN.show } : WARDEN, ps = [...this.players.values()].filter(p => !p.dead && inArena(p.x, p.z)); // a show: its rehearsed scaling
    const weight = Math.max(0.5, ps.reduce((s, p) => s + (W.hpRole[CLASSES[p.cls]?.role] ?? 1), 0));
    const avg = ps.length ? ps.reduce((s, p) => s + p.lvl, 0) / ps.length : m.def.level, over = Math.max(0, avg - MOBS.warden.level);
    m.maxHp = m.hp = Math.round((W.hpBase + W.hpPer * Math.pow(weight, W.hpExp)) * (1 + W.hpLvl * over));
    const atk = (W.atk ?? MOBS.warden.atk) * (1 + W.atkLvl * over) * (1 + W.atkPer * Math.max(0, ps.length - 3));
    m.def = { ...MOBS.warden, atk: Math.round(atk * 10) / 10 };
  }

  circleAttack(m, x, z, r, wind, amount, src, ground, kind) {
    this.twistCircle(m, x, z, r, wind, amount, src, ground, kind); // Warden twist (Echo, Quaking)
    this.events.push({ t: 'tele', x: r2(x), z: r2(z), r, d: wind, k: kind });
    this.schedule(wind, () => {
      if (m.dead) return;
      this.events.push({ t: 'fx', k: kind === 'rock' ? 'rock' : 'boom', x: r2(x), z: r2(z), r });
      for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.z - z) <= r) this.damagePlayer(p, amount, { ground, src });
    });
  }

  hornCharge(m, v) {
    const W = (m.tm || this.twistW || WARDEN).charge, a = angleTo(m.x, m.z, v.x, v.z);
    let x2 = m.x + Math.sin(a) * W.len, z2 = m.z + Math.cos(a) * W.len;
    const ex = x2 - WORLD.arena.x, ez = z2 - WORLD.arena.z, ed = Math.hypot(ex, ez), maxR = WORLD.arena.r - 3;
    if (ed > maxR) { x2 = WORLD.arena.x + (ex / ed) * maxR; z2 = WORLD.arena.z + (ez / ed) * maxR; }
    const x0 = m.x, z0 = m.z;
    m.face = a; const end = this.bossAfter(m, W, this.time + W.wind); // + its after pause (shared/bosstiming.js)
    this.events.push({ t: 'tele', k: 'line', x: r2(x0), z: r2(z0), x2: r2(x2), z2: r2(z2), w: W.width, d: W.wind, id: m.id });
    const steps = W.steps;
    for (let i = 1; i <= steps; i++) {
      this.schedule(W.wind + i * paced(W.step), () => {
        if (m.dead) return;
        m.x = x0 + (x2 - x0) * (i / steps); m.z = z0 + (z2 - z0) * (i / steps); m.moving = true;
        if (i < steps) return;
        this.events.push({ t: 'fx', k: 'charge', id: m.id, x: r2(x0), z: r2(z0), x2: r2(x2), z2: r2(z2) });
        const lx = x2 - x0, lz = z2 - z0, len2 = lx * lx + lz * lz || 1;
        for (const p of this.players.values()) {
          if (p.dead) continue;
          const k = Math.max(0, Math.min(1, ((p.x - x0) * lx + (p.z - z0) * lz) / len2));
          if (Math.hypot(p.x - (x0 + lx * k), p.z - (z0 + lz * k)) <= W.width + 0.4) this.damagePlayer(p, m.def.atk * W.mult, { src: 'warden charge' });
        }
      });
    }
    this.twistCharge(m, v); // Warden twist (Twin Horns)
    return end;
  }

  moveMob(m, tx, tz, speed, dt, stopAt) {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d <= stopAt) return;
    speed *= this.mobSlowA?.(m) ?? 1; // caltrops (server/classes-a.js)
    const step = Math.min(d - stopAt, speed * dt);
    let nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
    [nx, nz] = resolveCollision(nx, nz, m.def.radius * 0.8);
    if (Math.hypot(nx - WORLD.town.x, nz - WORLD.town.z) < WORLD.town.r + 2) return;
    if ((m.def.boss || m.temp) && !inArena(nx, nz)) return;
    if (!walkable(nx, nz)) return;
    m.face = Math.atan2(dx, dz);
    m.x = nx; m.z = nz; m.moving = true;
  }

  // ---------- networking ----------
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      const party = this.partyOf(p);
      // Buff bits (HUD labels: public/main.js, public/mastery.js buffTags, public/classes-b.js): each buff has its own bit,
      // so a +damage or shield from another skill never shows under the wrong name (Crescendo isn't "Blessed").
      const t = this.time, dmgOn = t < p.dmg.until, zeal = p.dmg.zeal && dmgOn, cresc = p.dmg.cresc && dmgOn, sk = p.shield?.k;
      const buffs = (t < p.dr.until ? 1 : 0) | (dmgOn && !zeal && !cresc ? 2 : 0) | (p.lfg || party?.open ? 4 : 0) | (t < p.tonicUntil ? 8 : 0) | (t < p.draughtUntil ? 16 : 0)
        | (p.shield && !sk ? 32 : 0) | (p.bulwark ? 64 : 0) | (t < (p.iron?.until || 0) ? 128 : 0) | (p.renew ? 256 : 0) | (t < p.cry.until ? 512 : 0) | (zeal ? 1024 : 0) | (t < (p.purifyUntil || 0) ? 2048 : 0)
        | (cresc ? 4096 : 0) | (sk === 'cresc' ? 8192 : 0) | (sk === 'talent' ? 16384 : 0);
      players.push([p.id, r2(p.x), r2(p.z), r2(p.face), p.hp, p.maxHp, p.lvl, CLASS_IDS.indexOf(p.cls), p.party || 0, p.dead ? 1 : 0, buffs, this.styleIdx(p)]); // [11]: weapon style (shared/styles.js STYLE_IDS, -1 none)
    }
    const mobs = [], fl = [];
    for (const m of this.mobs.values()) {
      if (m.dead || m.hidden) continue; // burrowed lurkers are sent as w.f2.bur
      fl.push(floorOf(m.x));
      mobs.push([m.id, MOB_IDS.indexOf(m.type), r2(m.x), r2(m.z), r2(m.face), m.hp, m.maxHp, (m.moving ? 1 : 0) | (m.threat.size ? 2 : 0) | (m.phase >= 2 ? 4 : 0) | (this.time < m.stunUntil ? 8 : 0) | (m.windupAt ? 16 : 0) | (this.time < m.staggerUntil ? 32 : 0) | (this.time < m.frenzyUntil ? 64 : 0) | (this.time < (m.launchUntil || 0) ? 128 : 0) | (this.time < (m.weakUntil || 0) ? 256 : 0), this.posturePct(m)]);
    }
    const g = this.gate;
    const waiting = [...this.players.values()].filter(p => !p.dead && inGateZone(p.x, p.z)).length;
    const gate = [g.open ? 1 : 0, waiting, g.ready.size, g.countAt ? r1(Math.max(0, g.countAt - this.time)) : 0];
    // The mobs go in last-minute (one JSON array per floor, joined for the full world): browsers get only their floor's
    // (snapFor); spectators, the director's film view and the server's own bots get every floor (this string).
    const parts = [[], [], [], []];
    for (let i = 0; i < mobs.length; i++) parts[fl[i]].push(JSON.stringify(mobs[i]));
    const pre = JSON.stringify({ players, mobs: 0, gate, phase: this.boss?.phase || 0, twist: this.twist?.id || null, events: this.events, f2: this.f2Snap(), f3: this.f3Snap(), gi: this.groundSnap(), poses: this.posesSnap(), looks: this.looksSnap(), down: this.downSnap?.(), th: this.threatSnap(), tb: this.teamSnap(), trap: this.trapSnap?.(), op: this.openSnap() }); // poses: [[id, k]], only while any is held (server/poses.js); down: downed players (server/revive.js)
    const at = pre.indexOf('"mobs":0') + 7; // (the first "mobs" key: the players array before it holds only numbers)
    const head = pre.slice(0, at), tail = pre.slice(at + 1);
    this.snapParts = { head, tail, floors: parts.map(a => a.join(',')), byFloor: [] };
    this.events = [];
    return `${head}[${parts.slice(1).map(a => a.join(',')).filter(Boolean).join(',')}]${tail}`;
  }
  /** The last snapshot for a browser on `floor`: only that floor's mobs (bandwidth); the rest is the same. */
  snapFor(floor) {
    const S = this.snapParts;
    if (!S) return null;
    return S.byFloor[floor] ||= `${S.head}[${S.floors[floor] || ''}]${S.tail}`;
  }

  meFor(p) {
    return {
      xp: p.xp, next: xpToNext(p.lvl), lvl: p.lvl,
      cds: p.cds.map(c => Math.max(0, r2(c - this.time))),
      dodge: Math.max(0, r2(p.dodgeCd - this.time)),
      gold: p.gold, ready: this.gate.ready.has(p.id) || this.gate2.ready.has(p.id) || this.gate3.ready.has(p.id) ? 1 : 0,
      ccd: Object.fromEntries(Object.entries(p.consCd).map(([k, v]) => [k, Math.max(0, r1(v - this.time))])),
      tonic: Math.max(0, r1(p.tonicUntil - this.time)), draught: Math.max(0, r1(p.draughtUntil - this.time)),
    };
  }

  roster() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, cls: p.cls, title: p.stats?.activeTitle || null, ...(p.bot ? { bot: 1 } : {}) }));
  }
}

// Town Smith: refine, salvage, reforge, recipes (server/smith.js)
Object.assign(Game.prototype, SmithMethods);
Object.assign(Game.prototype, GroundMethods); // items on the ground (server/ground.js)
Object.assign(Game.prototype, TwistMethods); // Warden twists (server/twists.js)
Object.assign(Game.prototype, SovTwistMethods); // Sovereign twists (server/sovtwists.js)
installCombat(Game); // posture, perfect dodge, guard/parry, Horn Sweep (server/combat.js)
Object.assign(Game.prototype, MasteryMethods); // skill mastery + evolutions (server/mastery.js)
Object.assign(Game.prototype, F2Methods); // Floor 2 (server/floor2.js)
installFloor3(Game); // Floor 3 (server/floor3.js): its methods, plus travel / respawn / Sovereign-kill wrappers
installClassesB(Game); // Lancer, Bard skills + their hooks (server/classes-b.js)
Object.assign(Game.prototype, ClassesAMethods); // Ranger and Berserker (server/classes-a.js)
installStyles(Game); // weapon styles (server/styles.js)
installBell(Game); // the Tower Bell: ringBell, bellAuto (server/bell.js)
installCine(Game); // cine(op, data), cineState(): filming camera, titles, fades, light (server/cine.js)
installPoses(Game); // kneel / sit / bow: setPose, /kneel chat, cleared by moving or acting (server/poses.js)
installTracking(Game); // play-tracking hooks: boss fight rows, death / quit context (server/trackgame.js)
installThreat(Game); // threat you can see, healer threat, Cover, flanking (server/threat.js)
installOpenings(Game); // boss combos, after states, melee openings (server/openings.js); after the threat (wraps flankMult)
installStaging(Game); // staging hooks for the scene director: boss moves, reserved Last Attack, scripted deaths (server/staging.js)
installBossTeam(Game); // boss team mechanics (server/bossteam.js); after staging: adds meteor / spread / tether to forceBossMove
installFloor3Moves(Game); // the Storm Colossus's moves in forceBossMove, Floor 3 testing aids (server/floor3.js); after boss team mechanics
installRevive(Game); // downed + revive (server/revive.js); after staging and boss team mechanics
installArenas(Game); // multi-area boss fights (server/arenas.js); after revive (pauses bleed-out on landing) and the boss moves ('fall')
installTalents(Game); // talent trees: methods + wrappers around skills, damage, healing (server/talents.js)
installTeamplay(Game); // skill combos between players, the Team Burst gauge, teamStat() for the post-fight card (server/teamplay.js); after the talents
installMvp(Game); // the post-fight MVP card from the team stats, downs and deaths; in the fight's tracking row (server/mvp.js); after the team play
installLoot(Game); // loot and builds: drops from shared/loot.js, gear in p.tal, set rules, loadouts (server/loot.js); after the talents and team play
installLooks(Game); // character looks: setLook(entity, id), listed in snapshots as w.looks (server/looks.js)
installNamed(Game); // the Named: humans-first rules, friendship, invites by tier (server/named.js); a no-op without a NamedManager
installRescue(Game); // rescue traps (server/rescue.js); after the Named: its trap-object and crystal wrappers sit outside everyone's
installPacing(Game); // a skill's cooldown starts when its last hit lands (server/pacing.js); keep it last
if (process.env.TUNE_STATS) installTuneStats(Game); // testing aid (scripts/tuneboss.js): log boss moves used and hits taken; outermost

// TUNE_STATS: `[tune] use <boss> <move>` when a boss starts a move (its table key; 'swing' = its basic swing), and
// `[tune] hit <src>` when a damagePlayer call took HP (dodged / absorbed calls are not hits). scripts/tuneboss.js reads them.
function installTuneStats(G) {
  const P = G.prototype, use = (m, k) => console.log(`[tune] use ${m?.type} ${k}`);
  const wrap = (name, key) => { const orig = P[name]; P[name] = function (m, ...a) { const k = key(m, ...a); if (k) use(m, k); return orig.call(this, m, ...a); }; };
  wrap('swingStart', () => 'swing');
  wrap('quakeRing', () => 'quake'); wrap('hornCharge', () => 'charge'); wrap('hornSweep', () => 'sweep');
  wrap('wardenMove', (m, k) => (['slam', 'spin', 'rock'].includes(k) ? k : null)); // (quake, charge, sweep: counted above)
  wrap('sovMove', (m, k) => (['geyser', 'volley', 'pools'].includes(k) ? k : null)); wrap('tidalWave', () => 'wave'); wrap('callDeluge', () => 'deluge');
  wrap('lightningStrikes', () => 'strike'); wrap('galePush', () => 'gust'); wrap('tempestBeam', () => 'beam'); wrap('startOverload', () => 'overload');
  const hurt = P.damagePlayer;
  P.damagePlayer = function (p, base, opts = {}) {
    const hp = p.hp, r = hurt.call(this, p, base, opts);
    if (p.hp < hp) console.log(`[tune] hit ${opts.src || '?'}`);
    return r;
  };
}
