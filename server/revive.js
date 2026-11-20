// Downed + revive (docs/ROADMAP.md G1). Mixed into Game by installRevive (after staging and bossteam, before talents).
//  - game.js damagePlayer calls goDown(p, src) at 0 HP: with a standing partymate within DOWNED.near (same floor) the
//    player goes downed (p.downed, still "alive": p.dead stays false, hp 0) instead of dying. Solo: killPlayer as before.
//  - A downed player crawls (onInput clamps to DOWNED.crawl), can't attack, dodge, jump, guard or drink, and bleeds out
//    (killPlayer) after DOWNED.secs. Hits on them take bleed time off. Bosses and their summons cut their threat (they
//    prefer standing players); other enemies keep attacking them.
//  - A partymate sends { type: 'revive', on: 1, id } (hold E) within DOWNED.reach to channel a revive (reviveTime, longer
//    for each earlier revive of that player this fight). Moving away, a heavy hit, or acting (skill, dodge, jump, guard,
//    potion) breaks it (the progress then fades unless someone resumes); a Cleric's Heal on the body speeds it (and doesn't break the Cleric's own channel). Done: up at
//    DOWNED.hp with a short i-frame, `revived` event, teamStat(reviver, 'revive').
//  - Nobody standing within DOWNED.keep (the whole party down): everyone downed bleeds out at once, a wipe as before.
//  - Film safety: no downed state while the director runs a show (game.allowDowned overrides); scriptDeath stays an
//    instant death and scriptRevive also stands a downed player up.
// Events: { t: 'down', id, src, d } · { t: 'rev', id, by, d } (channel started) / { t: 'rev', id, by, end: 1 } (stopped) ·
// { t: 'revived', id, by, x, z }. Snapshot: w.down = [[id, bleed s left, channel progress 0-1, reviver id]] (left out when empty).
import { CLASSES, DODGE, inTown } from '../shared/data.js';
import { floorOf } from '../shared/floor2.js';
import { DOWNED, reviveTime } from '../shared/revive.js';

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const methods = {
  standing(o) { return !!o && !o.dead && !o.downed; },
  // Standing partymates of p within r m on p's floor.
  standingMates(p, r) {
    const party = p.party && this.parties.get(p.party);
    if (!party) return [];
    const f = floorOf(p.x);
    return party.members.map(id => this.players.get(id)).filter(o => o && o !== p && this.standing(o) && floorOf(o.x) === f && dist(o, p) <= r);
  },
  // Heal targeting skips a downed player unless someone is reviving them (then a Heal speeds the channel).
  unhealable(o) { return !!o?.downed && !o.downed.by; },

  // game.js damagePlayer at 0 HP: go downed instead of dying? true = downed.
  goDown(p, src = '?') {
    if (p.dead || p.downed) return !!p.downed;
    if (this.director?.running && !this.allowDowned) return false; // film safety: a show's deaths stay deaths
    if (inTown(p.x, p.z) || !this.standingMates(p, DOWNED.near).length) return false;
    const t = this.time, fight = this.activeFightOf?.(p)?.[1] || null;
    const same = fight ? p.revFight === fight : t - (p.revT ?? -1e9) < DOWNED.fightGap;
    if (!same) p.reviveN = 0;
    p.revFight = fight;
    this.stopRevive(p);
    if (p.guarding) this.guard(p, false);
    this.clearPose?.(p);
    p.hp = 0; p.regenAcc = 0;
    p.downed = { at: t, until: t + DOWNED.secs, src, by: 0, prog: 0, need: reviveTime(p.reviveN | 0) };
    p.downs = (p.downs || 0) + 1;
    for (const m of this.mobs.values()) { // bosses (and their summons: hounds, totems) turn to the players still standing
      if ((m.def.boss || m.temp) && m.threat.has(p.id)) m.threat.set(p.id, m.threat.get(p.id) * DOWNED.bossThreat);
    }
    this.events.push({ t: 'down', id: p.id, src, d: DOWNED.secs, x: r2(p.x), z: r2(p.z) });
    this.sys(`${p.name} is down! Hold {key:revive} next to them to revive.`);
    return true;
  },

  // r starts reviving: id = the downed partymate (0: the nearest one in reach). Returns whether a channel is running.
  startRevive(r, id = 0) {
    if (!this.standing(r)) return false;
    let p = id ? this.players.get(id | 0) : null;
    if (!p) { // nearest downed partymate in reach
      let bd = DOWNED.reach;
      for (const o of this.players.values()) if (o.downed && !o.dead && o.party && o.party === r.party && o !== r && dist(o, r) <= bd) { bd = dist(o, r); p = o; }
    }
    if (!p || !p.downed || p.dead || p === r || !r.party || p.party !== r.party || dist(p, r) > DOWNED.reach) return false;
    if (r.reviving?.id === p.id) return true;
    if (p.downed.by && p.downed.by !== r.id) return false; // someone else is on it
    this.stopRevive(r);
    if (r.guarding) this.guard(r, false);
    this.clearPose?.(r);
    r.reviving = { id: p.id, at: this.time };
    const D = p.downed;
    D.by = r.id; D.need = reviveTime(p.reviveN | 0); // (progress from a broken channel carries over, decaying)
    this.events.push({ t: 'rev', id: p.id, by: r.id, d: r2(D.need) });
    return true;
  },

  // r stops reviving (released E, moved away, got hit hard, acted, or the target is gone).
  stopRevive(r) {
    const R = r?.reviving;
    if (!R) return;
    r.reviving = null;
    const p = this.players.get(R.id);
    if (p?.downed && p.downed.by === r.id) {
      p.downed.by = 0; // the progress so far decays (updateDowned) until someone resumes
      this.events.push({ t: 'rev', id: p.id, by: r.id, end: 1 });
    }
  },

  completeRevive(p, r) {
    const t = this.time;
    p.downed = null;
    p.hp = Math.max(1, Math.round(p.maxHp * DOWNED.hp));
    p.iframeUntil = t + DOWNED.iframe; p.perfectRoll = p.iframeUntil - DODGE.iframes; // (never a "perfect dodge")
    p.lastHurt = t; p.regenAcc = 0;
    p.reviveN = (p.reviveN | 0) + 1; p.revT = t;
    if (r) { r.reviving = null; r.revives = (r.revives || 0) + 1; }
    this.events.push({ t: 'revived', id: p.id, by: r?.id || 0, x: r2(p.x), z: r2(p.z) });
    if (r) this.sys(`${r.name} revived ${p.name}.`);
    if (r) this.teamStat?.(r, 'revive');
  },

  bleedOut(p) {
    const src = p.downed?.src || '?';
    if (p.downed?.by) this.stopRevive(this.players.get(p.downed.by));
    p.downed = null;
    this.killPlayer(p, src);
  },

  // Every tick, after the rest of update: bleed-out timers, channels, wipes.
  updateDowned(dt) {
    const t = this.time;
    for (const p of this.players.values()) {
      if (p.reviving && (!this.standing(p) || !this.players.get(p.reviving.id)?.downed)) this.stopRevive(p);
      const D = p.downed;
      if (!D) continue;
      if (p.dead) { p.downed = null; continue; } // died some other way (admin, script)
      p.hp = 0; p.regenAcc = 0; // no regeneration while down
      if (!this.standingMates(p, DOWNED.keep).length) { this.bleedOut(p); continue; } // the whole party is down: a wipe
      const r = D.by ? this.players.get(D.by) : null;
      if (D.by && !(this.standing(r) && r.reviving?.id === p.id && r.party === p.party && dist(r, p) <= DOWNED.leash)) {
        if (r) this.stopRevive(r); else { D.by = 0; this.events.push({ t: 'rev', id: p.id, by: 0, end: 1 }); }
      }
      if (D.by) {
        D.until += dt; // the bleed-out waits while someone is reviving
        D.prog += dt * (1 + (r?.tal?.stat.revive || 0) / 100); // stat.revive: gear (shared/loot.js)
        if (D.prog >= D.need) this.completeRevive(p, r);
      } else {
        D.prog = Math.max(0, D.prog - dt); // a broken channel's progress fades at the channel's own pace
        if (t >= D.until) this.bleedOut(p);
      }
    }
  },

  downSnap() {
    const out = [];
    for (const p of this.players.values()) {
      const D = p.downed;
      if (D) out.push([p.id, r1(Math.max(0, D.until - this.time)), D.by ? r2(Math.min(1, D.prog / D.need)) : 0, D.by || 0]);
    }
    return out.length ? out : undefined; // undefined: JSON.stringify leaves the key out
  },
};

export function installRevive(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.down) { // testing aid: drop to 0 HP (secs: bleed-out, n: earlier revives this fight)
      const q = msg.id ? this.players.get(msg.id | 0) : p; // id: a partymate (your bot) instead of you
      if (q && !q.dead && (q === p || (q.party && q.party === p?.party))) {
        q.iframeUntil = 0;
        if (msg.n > 0) { q.reviveN = Math.min(20, msg.n | 0); q.revT = this.time; q.revFight = this.activeFightOf?.(q)?.[1] || null; }
        this.damagePlayer(q, q.maxHp * 100, { peril: true, src: 'test' });
        if (q.downed && msg.secs > 0) q.downed.until = this.time + Math.min(300, +msg.secs);
      }
    }
    if (msg?.type !== 'revive') return orig.call(this, p, msg);
    if (msg.on) this.startRevive(p, msg.id | 0); else this.stopRevive(p);
  });

  // Downed: a hit takes bleed time off (no damage). Standing: a heavy hit breaks your revive channel.
  wrap('damagePlayer', function (orig, p, base, opts = {}) {
    if (p.downed) {
      if (p.dead || inTown(p.x, p.z)) return;
      p.downed.until -= Math.min(DOWNED.hitBleedMax, Math.max(DOWNED.hitBleedMin, (DOWNED.hitBleed * (Number(base) || 0)) / (p.maxHp || 1)));
      p.lastHurt = this.time;
      return;
    }
    const hp0 = p.hp;
    const out = orig.call(this, p, base, opts);
    if (p.reviving && (p.dead || p.downed || hp0 - p.hp >= DOWNED.heavy * p.maxHp || (p.hp < hp0 && this.bigHit?.(opts.src)))) this.stopRevive(p);
    return out;
  });

  // Healing a downed player: no health; a Cleric's Heal (and its evolutions) speeds a running revive channel.
  wrap('healPlayer', function (orig, tg, amount, by, sk) {
    if (!tg.downed) return orig.call(this, tg, amount, by, sk);
    const D = tg.downed;
    if (D.by && by && by.cls === 'cleric' && sk === 'heal' && amount > 0) {
      D.prog = Math.min(D.need, D.prog + D.need * DOWNED.heal * Math.min(1, amount / (tg.maxHp * 0.3 || 1)));
    }
    return 0;
  });

  // Downed: no skills, rolls, jumps, guard or items. Reviving: any of them breaks the channel (except a Cleric's Heal).
  wrap('useSkill', function (orig, p, slot, ...a) {
    if (p.downed) return;
    if (p.reviving && CLASSES[p.cls]?.skills[slot | 0]?.id !== 'heal') this.stopRevive(p);
    return orig.call(this, p, slot, ...a);
  });
  for (const name of ['dodge', 'jump', 'useItem', 'warp', 'toggleReady']) {
    if (!P[name]) continue;
    wrap(name, function (orig, p, ...a) {
      if (p.downed) return;
      this.stopRevive(p);
      return orig.call(this, p, ...a);
    });
  }
  wrap('guard', function (orig, p, on, ...a) {
    if (on && p.downed) return;
    if (on) this.stopRevive(p);
    return orig.call(this, p, on, ...a);
  });

  // Crawling: a downed player moves at DOWNED.crawl at most.
  wrap('onInput', function (orig, p, msg) {
    if (p.downed && !p.dead && msg && msg.seq === p.posSeq) {
      const x = +msg.x, z = +msg.z, dt = Math.min(0.5, this.time - p.lastMoveT);
      const maxD = DOWNED.crawl * dt * 1.25 + 0.02, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (isFinite(d) && d > maxD) msg = { ...msg, x: p.x + (dx / d) * maxD, z: p.z + (dz / d) * maxD };
    }
    return orig.call(this, p, msg);
  });

  wrap('update', function (orig, dt, ...a) {
    const r = orig.call(this, dt, ...a);
    this.updateDowned(dt);
    return r;
  });

  // Heal / buff targeting (server/mastery.js): skip downed allies nobody is reviving.
  if (P.allyList) wrap('allyList', function (orig, p, r) { return orig.call(this, p, r).filter(o => !this.unhealable(o)); });
  if (P.mostHurt) wrap('mostHurt', function (orig, p, r) {
    const o = orig.call(this, p, r);
    if (!this.unhealable(o)) return o;
    let target = p, low = p.hp / p.maxHp;
    for (const q of this.allyList(p, r)) { const f = q.hp / q.maxHp; if (f < low) { low = f; target = q; } }
    return target;
  });

  // Boss team mechanics (G4, server/bossteam.js): markers, tethers and the 2+ alive check pick standing players only.
  if (P.btFighters) wrap('btFighters', function (orig, ...a) { return orig.apply(this, a).filter(p => !p.downed); });

  // Film safety: a scripted death is instant (never downed), and a scripted revive also stands a downed player up.
  if (P.scriptDeath) wrap('scriptDeath', function (orig, pp, ...a) {
    const p = this.playerRef(pp);
    if (p?.downed) { if (p.downed.by) this.stopRevive(this.players.get(p.downed.by)); p.downed = null; }
    if (p) this.stopRevive(p);
    return orig.call(this, pp, ...a);
  });
  if (P.scriptRevive) wrap('scriptRevive', function (orig, pp, ...a) {
    const p = this.playerRef(pp);
    if (p?.downed && !p.dead) {
      if (p.downed.by) this.stopRevive(this.players.get(p.downed.by));
      p.downed = null; p.hp = p.maxHp; p.lastHurt = this.time;
      this.events.push({ t: 'revived', id: p.id, by: 0, x: r2(p.x), z: r2(p.z) });
      return true;
    }
    return orig.call(this, pp, ...a);
  });
}
