// Life classes (plan: docs/briefs/life-classes.md): life skills, gathering spots, the garden plot, cooking, alchemy,
// meals. Data in shared/life.js. Mixed into Game by installLife (see the end of game.js).
//
// Client message: { type: 'life', a, ... }
//   learn { id }              at the Life Hall: learn a life skill (free)
//   gather { id }             at a spot: start gathering (herb / ore: a short channel; fish: wait for the bite)
//   hook                      strike while fishing (in the bite window)
//   cancel                    stop the current gathering
//   plant { tile, seed }      at the garden: plant a seed in an empty tile of your own plot
//   harvest { tile? }         at the garden: harvest one ripe tile, or every ripe one
//   uproot { tile }           at the garden: clear a tile (the crop is lost)
//   make { id }               at the cooking fire / alchemy bench: cook or brew one recipe
//   eat { id }                eat a meal (anywhere): its buff replaces the one you had
// Server → client: { type: 'life', ... } (lifeMsg) whenever p.lifeDirty; results as system lines.
//
// Spots deplete per player (p.life.spots: when each is ready again, wall-clock ms), so nobody (no bot, no other player)
// can take your spot. Crops grow in wall-clock time (lifeNow(): Date.now() + a test skew, or an injected clock).
// Meals count down only while you're online (game time).
import {
  LIFE_SKILLS, LIFE_MATS, SPOT_BY_ID, SPOT_TYPES, SPOT_KINDS, SPOT_USE, STACK_MAX, FOODS, foodText, CROPS, PLOT_TILES,
  TEND, GARDEN, LIFE_RECIPE_BY_ID, STATION_OF, STATIONS, DOUBLE_AT, XP_SMITH, LIFE_XP, LIFE_MAX,
  newLife, knows, lifeLevel, rollSpot, nearStation, tileGrowth, tileLeft, cropOfSeed,
} from '../shared/life.js';
import { MATS } from '../shared/crafting.js';
import { CONSUMABLES } from '../shared/items.js';
import { floorOf } from '../shared/floor2.js';

const PAD = 1.5; // extra reach the server allows for lag
const HOOK_SLACK = 0.35; // s past the bite window a strike still counts (the round trip)
const MOVE_CANCEL = 1.2; // m: walking this far stops gathering
const MSG_GAP = 0.12; // s: life messages closer together than this are dropped (rate limit)
const matName = id => MATS[id]?.name || id;
const listText = o => Object.entries(o).map(([k, v]) => `${v} ${matName(k)}`).join(', ');

// The saved record (characters.life). (spots: at most one timer per spot, so it never grows past SPOTS.length)
export function lifeRecord(p) {
  const L = p.life;
  if (!L) return null;
  const spots = L.spots;
  return { skills: L.skills, learned: L.learned, plot: L.plot, food: L.food ? { id: L.food.id, left: Math.max(0, Math.round(L.food.left)) } : null, spots };
}

export const LifeMethods = {
  lifeNow() { return (this.lifeClock ? this.lifeClock() : Date.now()) + (this.lifeSkew || 0); },
  lifeRand() { return (this.lifeRnd || Math.random)(); },
  lifeOf(p) { return (p.life ||= newLife()); },
  lifeTouched(p) { p.lifeDirty = true; p.dirty = true; },

  lifeMsg(p) {
    const L = this.lifeOf(p), now = this.lifeNow(), a = p.lifeAct;
    const spots = {};
    for (const [k, v] of Object.entries(L.spots)) if (v > now) spots[k] = Math.ceil((v - now) / 1000);
    return {
      type: 'life', skills: L.skills, learned: L.learned, spots,
      plot: L.plot.map(t => (t ? { c: t.c, g: Math.round(tileGrowth(t, now) * 1000) / 1000, left: Math.ceil(tileLeft(t, now) / 1000) } : null)),
      food: L.food ? { id: L.food.id, left: Math.ceil(L.food.left / 1000) } : null,
      act: a ? { k: a.k, id: a.id, secs: a.secs || 0, left: a.until ? Math.max(0, Math.round((a.until - this.time) * 10) / 10) : 0, bite: !!a.bitten } : null,
      tend: !!p.lifeTended,
    };
  },

  lifeXp(p, skill, n) {
    const L = this.lifeOf(p);
    if (!LIFE_SKILLS[skill] || !(n > 0)) return;
    const before = lifeLevel(L.skills[skill]);
    L.skills[skill] = Math.min(LIFE_XP[LIFE_MAX], (L.skills[skill] || 0) + n);
    const after = lifeLevel(L.skills[skill]);
    if (after > before) {
      this.sys(`${LIFE_SKILLS[skill].name} level ${after}!`, p.id);
      this.events.push({ t: 'lifelvl', to: p.id, sk: skill, lvl: after });
      this.track(p, 'life_level', { skill, lvl: after });
    }
    this.lifeTouched(p);
  },

  // Room for n more of a life material (a stack stops at STACK_MAX).
  lifeRoom(p, id, n) { return !LIFE_MATS[id] || (this.matsOf(p)[id] || 0) + n <= STACK_MAX; },
  lifeFull(p, out) { return Object.keys(out).find(k => !this.lifeRoom(p, k, out[k])) || null; },

  lifeAction(p, msg) {
    if (!p || p.dead || !msg) return false;
    if (this.time - (p.lifeMsgT ?? -9) < MSG_GAP && msg.a !== 'hook') return false; // rate limit (a strike always gets through)
    p.lifeMsgT = this.time;
    switch (msg.a) {
      case 'learn': return this.lifeLearn(p, String(msg.id || ''));
      case 'gather': return this.lifeGather(p, String(msg.id || ''));
      case 'hook': return this.lifeHook(p);
      case 'cancel': if (p.lifeAct) { p.lifeAct = null; this.lifeTouched(p); } return true;
      case 'plant': return this.lifePlant(p, msg.tile | 0, String(msg.seed || ''));
      case 'harvest': return this.lifeHarvest(p, msg.tile == null ? -1 : msg.tile | 0);
      case 'uproot': return this.lifeUproot(p, msg.tile | 0);
      case 'make': return this.lifeMake(p, String(msg.id || ''));
      case 'eat': return this.lifeEat(p, String(msg.id || ''));
    }
    return false;
  },

  lifeLearn(p, id) {
    const L = this.lifeOf(p), S = LIFE_SKILLS[id];
    if (!S || !nearStation('hall', p.x, p.z, PAD)) return false;
    if (knows(L, id)) { this.sys(`You already know ${S.name}.`, p.id); return false; }
    L.learned.push(id);
    this.sys(`You learned ${S.name}. ${S.desc}`, p.id);
    this.track(p, 'life_learn', { skill: id });
    this.lifeTouched(p);
    return true;
  },

  lifeGather(p, id) {
    const s = SPOT_BY_ID[id], T = SPOT_TYPES[s?.type], K = SPOT_KINDS[T?.kind];
    if (!s || !K || p.lifeAct) return false;
    if (Math.hypot(p.x - s.x, p.z - s.z) > SPOT_USE + PAD) return false;
    const L = this.lifeOf(p), sk = LIFE_SKILLS[K.skill];
    if (!knows(L, K.skill)) { this.sys(`Learn ${sk.name} at the Life Hall in the Town of Beginnings first.`, p.id); return false; }
    if (lifeLevel(L.skills[K.skill]) < T.lvl) { this.sys(`${T.name} needs ${sk.name} level ${T.lvl}.`, p.id); return false; }
    const now = this.lifeNow();
    if ((L.spots[id] || 0) > now) { this.sys(`You've taken what's here. It's back in ${Math.ceil((L.spots[id] - now) / 1000)} s.`, p.id); return false; }
    const first = T.yields[0][0];
    if (!this.lifeRoom(p, first, 1)) { this.sys(`You can't carry more ${matName(first)} (${STACK_MAX}).`, p.id); return false; }
    const t = this.time, act = { k: T.kind, id, at: t, x: p.x, z: p.z };
    if (T.kind === 'fish') { act.biteAt = t + K.bite[0] + this.lifeRand() * (K.bite[1] - K.bite[0]); act.secs = 0; }
    else { act.secs = K.secs; act.until = t + K.secs; }
    p.lifeAct = act;
    this.clearPose?.(p);
    this.lifeTouched(p);
    return true;
  },

  lifeHook(p) {
    const a = p.lifeAct;
    if (!a || a.k !== 'fish') return false;
    const K = SPOT_KINDS.fish;
    if (this.time < a.biteAt) { this.lifeEnd(p, 'Too soon: the fish got away.'); return false; }
    if (this.time > a.biteAt + K.window + HOOK_SLACK) { this.lifeEnd(p, 'Too late: the fish got away.'); return false; }
    this.lifeDone(p);
    return true;
  },

  lifeEnd(p, why) { p.lifeAct = null; if (why) this.sys(why, p.id); this.lifeTouched(p); },

  // A gather finished: roll the yield, start the spot's cooldown (yours only), XP.
  lifeDone(p) {
    const a = p.lifeAct, s = SPOT_BY_ID[a.id], T = SPOT_TYPES[s.type], K = SPOT_KINDS[T.kind];
    p.lifeAct = null;
    const L = this.lifeOf(p), lvl = lifeLevel(L.skills[K.skill]);
    const got = rollSpot(s.type, lvl, () => this.lifeRand());
    for (const k of Object.keys(got)) got[k] = Math.max(0, Math.min(got[k], STACK_MAX - (this.matsOf(p)[k] || 0)));
    for (const k of Object.keys(got)) if (!got[k]) delete got[k];
    this.giveMats(p, got);
    L.spots[a.id] = this.lifeNow() + K.respawn * 1000;
    this.sys(Object.keys(got).length ? `${T.name}: ${listText(got)}.` : `${T.name}: nothing this time.`, p.id);
    this.events.push({ t: 'lifegot', id: p.id, k: T.kind, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10 });
    this.lifeXp(p, K.skill, T.xp);
    this.invChanged(p);
    this.lifeTouched(p);
  },

  lifePlant(p, tile, seed) {
    if (!nearStation('garden', p.x, p.z, PAD) || tile < 0 || tile >= PLOT_TILES) return false;
    const L = this.lifeOf(p), c = cropOfSeed(seed), C = CROPS[c];
    if (!C) return false;
    if (!knows(L, 'farmer')) { this.sys('Learn Farmer at the Life Hall first.', p.id); return false; }
    if (lifeLevel(L.skills.farmer) < C.lvl) { this.sys(`${matName(c)} needs Farmer level ${C.lvl}.`, p.id); return false; }
    if (L.plot[tile]) { this.sys('Something already grows there.', p.id); return false; }
    if (!((this.matsOf(p)[seed] || 0) > 0)) { this.sys(`You have no ${matName(seed)}.`, p.id); return false; }
    this.matsOf(p)[seed]--;
    L.plot[tile] = { c, at: this.lifeNow(), boost: 0 };
    this.sys(`Planted ${matName(c)}. Ripe in ${Math.round(C.grow / 60000)} min.`, p.id);
    this.invChanged(p); this.lifeTouched(p);
    return true;
  },

  lifeHarvest(p, tile) {
    if (!nearStation('garden', p.x, p.z, PAD)) return false;
    const L = this.lifeOf(p), now = this.lifeNow();
    const tiles = tile >= 0 ? [tile] : L.plot.map((_, i) => i);
    let n = 0;
    for (const i of tiles) {
      const t = L.plot[i], C = CROPS[t?.c];
      if (!C || tileGrowth(t, now) < 1) continue;
      const lvl = lifeLevel(L.skills.farmer);
      const got = { [t.c]: C.yield[0] + Math.floor(this.lifeRand() * (C.yield[1] - C.yield[0] + 1)) + Math.floor(Math.max(0, lvl - C.lvl) / 3) };
      if (this.lifeRand() < C.seedBack) got[C.seed] = 1;
      const full = this.lifeFull(p, got);
      if (full) { this.sys(`You can't carry more ${matName(full)} (${STACK_MAX}): the crop stays in the ground.`, p.id); break; }
      this.giveMats(p, got);
      L.plot[i] = null;
      this.sys(`Harvested ${listText(got)}.`, p.id);
      this.lifeXp(p, 'farmer', C.xp);
      n++;
    }
    if (!n) { if (tile >= 0 || !L.plot.some(t => t && tileGrowth(t, now) >= 1)) this.sys('Nothing is ripe yet.', p.id); return false; }
    this.invChanged(p); this.lifeTouched(p);
    return true;
  },

  lifeUproot(p, tile) {
    if (!nearStation('garden', p.x, p.z, PAD)) return false;
    const L = this.lifeOf(p);
    if (!L.plot[tile]) return false;
    L.plot[tile] = null;
    this.sys('You cleared the tile.', p.id);
    this.lifeTouched(p);
    return true;
  },

  lifeMake(p, id) {
    const rc = LIFE_RECIPE_BY_ID[id];
    if (!rc || !nearStation(STATION_OF[rc.skill], p.x, p.z, PAD)) return false;
    const L = this.lifeOf(p), S = LIFE_SKILLS[rc.skill], lvl = lifeLevel(L.skills[rc.skill]);
    if (!knows(L, rc.skill)) { this.sys(`Learn ${S.name} at the Life Hall first.`, p.id); return false; }
    if (lvl < rc.lvl) { this.sys(`That needs ${S.name} level ${rc.lvl}.`, p.id); return false; }
    const have = this.matsOf(p);
    if (!Object.entries(rc.mats).every(([k, v]) => (have[k] || 0) >= v)) { this.sys('Not enough materials.', p.id); return false; }
    const mul = lvl >= rc.lvl + DOUBLE_AT && this.lifeRand() < 0.25 ? 2 : 1;
    const outMats = Object.fromEntries(Object.entries(rc.out.mats || {}).map(([k, v]) => [k, v * mul]));
    const full = this.lifeFull(p, outMats);
    if (full) { this.sys(`You can't carry more ${matName(full)} (${STACK_MAX}).`, p.id); return false; }
    for (const [k, v] of Object.entries(rc.mats)) have[k] -= v;
    this.giveMats(p, outMats);
    const cons = {};
    for (const [k, v] of Object.entries(rc.out.cons || {})) if (CONSUMABLES[k]) { p.inv.cons[k] = (p.inv.cons[k] || 0) + v * mul; cons[k] = v * mul; }
    const made = [...Object.entries(outMats).map(([k, v]) => `${v} ${matName(k)}`), ...Object.entries(cons).map(([k, v]) => `${v} ${CONSUMABLES[k].name}`)].join(', ');
    this.sys(`${rc.skill === 'cook' ? 'Cooked' : 'Brewed'} ${made}${mul > 1 ? ' (a double batch!)' : ''}.`, p.id);
    const st = STATIONS[STATION_OF[rc.skill]];
    this.events.push({ t: 'lifemade', id: p.id, k: rc.skill, x: st.x, z: st.z });
    this.track(p, 'life_make', { id, skill: rc.skill });
    this.lifeXp(p, rc.skill, rc.xp);
    this.invChanged(p); this.lifeTouched(p);
    return true;
  },

  lifeEat(p, id) {
    const F = FOODS[id];
    if (!F || !((this.matsOf(p)[id] || 0) > 0)) return false;
    const L = this.lifeOf(p);
    this.matsOf(p)[id]--;
    L.food = { id, left: F.secs * 1000 };
    this.recompute(p);
    this.sys(`You ate ${matName(id)}: ${foodText(id)}.`, p.id);
    this.invChanged(p); this.lifeTouched(p);
    return true;
  },

  foodFx(p, k) { const f = p.life?.food; return (f && FOODS[f.id]?.fx[k]) || 0; },

  // Per tick: gathering (finish, the bite, interruptions); once a second: meals; every TEND.every s: tending bots.
  lifeTick(dt) {
    const t = this.time;
    for (const p of this.players.values()) {
      const a = p.lifeAct;
      if (!a) continue;
      if (p.dead || Math.hypot(p.x - a.x, p.z - a.z) > MOVE_CANCEL) { this.lifeEnd(p, p.dead ? null : 'You stopped.'); continue; }
      if (p.lastHurt > a.at) { this.lifeEnd(p, 'Interrupted!'); continue; }
      if (a.until && t >= a.until) { this.lifeDone(p); continue; }
      if (a.k === 'fish') {
        if (!a.bitten && t >= a.biteAt) { a.bitten = true; this.events.push({ t: 'lifebite', to: p.id }); this.lifeTouched(p); }
        if (t > a.biteAt + SPOT_KINDS.fish.window + HOOK_SLACK) this.lifeEnd(p, 'Too late: the fish got away.');
      }
    }
    this.lifeAcc = (this.lifeAcc || 0) + dt;
    if (this.lifeAcc >= 1) {
      const step = this.lifeAcc; this.lifeAcc = 0;
      for (const p of this.players.values()) {
        const f = p.life?.food;
        if (!f) continue;
        f.left -= step * 1000;
        if (f.left <= 0) { p.life.food = null; this.recompute(p); this.sys('Your meal wore off.', p.id); this.lifeTouched(p); continue; }
        const regen = FOODS[f.id].fx.regen;
        if (regen && !p.dead && !p.downed && p.hp < p.maxHp) {
          p.foodAcc = (p.foodAcc || 0) + p.maxHp * regen / 100 * step;
          if (p.foodAcc >= 1) { const n = Math.floor(p.foodAcc); p.foodAcc -= n; p.hp = Math.min(p.maxHp, p.hp + n); }
        }
      }
    }
    this.tendAcc = (this.tendAcc || 0) + dt;
    if (this.tendAcc >= TEND.every) { const step = this.tendAcc; this.tendAcc = 0; this.lifeTend(step); }
  },

  // A player's own bots near the garden (ordered to tend it, or just idling there) speed their creator's crops up.
  lifeTend(step) {
    const tenders = new Map(); // creator player id -> a bot
    for (const b of this.players.values()) {
      if (!b.bot || !b.pbOwner || b.dead || floorOf(b.x) !== 1) continue;
      if (Math.hypot(b.x - GARDEN.x, b.z - GARDEN.z) > TEND.reach) continue;
      tenders.set(b.pbOwner, b);
    }
    const now = this.lifeNow();
    for (const p of this.players.values()) {
      if (p.bot || !p.life) continue;
      const was = !!p.lifeTended, on = tenders.has(p.id);
      p.lifeTended = on;
      if (on) for (const tile of p.life.plot) if (tile && tileGrowth(tile, now) < 1) { tile.boost = (tile.boost || 0) + step * 1000 * (TEND.mult - 1); p.dirty = true; }
      if (on !== was || (on && p.life.plot.some(Boolean))) p.lifeDirty = true;
    }
  },
};

export function installLife(Game) {
  const P = Game.prototype;
  Object.assign(P, LifeMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('addPlayer', function (orig, ws, name, cls, saved = null) { // (before recompute's food: the record is read first)
    const p = orig.call(this, ws, name, cls, saved);
    p.life = newLife(saved?.life);
    if (p.life.food) { this.recompute(p); p.hp = p.maxHp; }
    return p;
  });
  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'life') return this.lifeAction(p, msg);
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.life) { // testing aid: { life: { skip: ms, tp: [x, z] } }
      const L = msg.life;
      if (+L.skip > 0) { this.lifeSkew = (this.lifeSkew || 0) + Math.min(30 * 86400e3, +L.skip); for (const q of this.players.values()) q.lifeDirty = true; }
      if (Array.isArray(L.tp)) this.teleport(p, +L.tp[0] || 0, +L.tp[1] || 0);
      return;
    }
    return orig.call(this, p, msg);
  });
  wrap('update', function (orig, dt, ...a) { const r = orig.call(this, dt, ...a); this.lifeTick(dt); return r; });
  wrap('recompute', function (orig, p, ...a) { // a meal's max health
    const r = orig.call(this, p, ...a);
    const hp = this.foodFx(p, 'hp');
    if (hp) {
      const frac = p.hp !== undefined && p.maxHp ? p.hp / p.maxHp : 1;
      p.maxHp = Math.round(p.maxHp * (1 + hp / 100));
      if (p.hp !== undefined) p.hp = Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * frac)));
    }
    return r;
  });
  wrap('dmgMult', function (orig, p, ...a) { const d = this.foodFx(p, 'dmg'); return orig.call(this, p, ...a) * (d ? 1 + d / 100 : 1); });
  const pm = P.postureMul;
  P.postureMul = function (p, m) { const v = this.foodFx(p, 'posture'); return (pm ? pm.call(this, p, m) : 1) * (v ? 1 + v / 100 : 1); };
  wrap('forged', function (orig, p, a, it) { const r = orig.call(this, p, a, it); if (p && !p.bot) this.lifeXp(p, 'smith', XP_SMITH[a] || 0); return r; });
}
