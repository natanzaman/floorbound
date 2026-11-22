// The Academy (docs/briefs/academy.md), mixed into Game by installAcademy(Game) near the end of game.js.
// Data and pure rules: shared/academy.js (weapons, kit, trials, drills, ranks, heads, cohorts) and shared/academyyard.js
// (the building, the pens, the training enemies).
//
// State: p.path (characters.path; null = a graduated character from before the Academy), p.trial (a running trial or
// drill), p.loan (a trial's loaned kit: the real class, mastery and talents while the trial runs; saves read it).
// Messages: { type: 'academy', op, ... } in (state, weapon, trial, drill, leave, graduate, change, talk, cohort);
// { type: 'path', ... } out (index.js sends it when p.pathDirty), me.ac in the snapshot while a trial runs.
// Hooks in game.js: initPath (addPlayer), pathStats (recompute), kitLocked (useSkill, the level-3 notice), classTitle
// (the join line), rosterPath (roster). Wrappers below: healPlayer, talentAction / talentsMsg / autoSpendTalents,
// giveXp, handle, update, meFor, validTarget, damageMob, damagePlayer, breakMob, killMob, chainNote, crescBurst,
// removePlayer.
import { CLASSES, MOBS, walkable, angleTo, resolveCollision } from '../shared/data.js';
import { makeItem, BAG_SIZE } from '../shared/items.js';
import { newTalents, talentTotals } from '../shared/talents.js';
import { STYLES } from '../shared/styles.js';
import {
  WEAPONS, INITIATE, TRIALS, DRILLS, DRILL_REWARD, REVIVE_SECS, REVIVE_R, HEAD_FRIENDSHIP, MEDALS, COHORT,
  isInitiate, pathLabel, medalFor, rankOf, rankName, changeFee, newPath, cleanPath, trialBlock, gradBlock, gradStyle,
  weaponOfClass, headLine, cohortClasses, isWeapon, isClass, isTrial, isDrill, headOf,
} from '../shared/academy.js';
import { PENS, ACADEMY, nearAcademy, penAt, penStart, penFar } from '../shared/academyyard.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const COUNTDOWN = 3, HOME_AFTER = 2.5;
const TOUGH = 999; // the health multiplier of training enemies that never fall (m.tough)
const WEAPON_CD = 5, TALK_CD = 4; // seconds between weapon changes (the armory) and between hall-head lines
const defOf = T => (T.kind === 'trial' ? TRIALS : DRILLS)[T.id];

export const AcademyMethods = {
  // ---------- the path ----------
  initPath(p, raw) {
    let path = cleanPath(raw);
    if (!path && isWeapon(this.joinWeapon)) path = newPath(this.joinWeapon); // an anonymous Initiate (index.js)
    p.path = path;
    if (!isInitiate(path)) return;
    const W = WEAPONS[path.weapon];
    if (p.cls !== W.base) this.swapClass(p, W.base, path.keep[W.base]); // (an admin edit, a stale row)
    if (!path.armed && this.armWith(p, W.base, 0, W.style)) { path.armed = 1; p.dirty = true; }
    p.pathDirty = true;
  },
  pathStats(p) { if (isInitiate(p.path) && !p.loan) p.atk *= INITIATE.pow; },
  kitLocked(p, slot) { return isInitiate(p.path) && !p.loan && slot === INITIATE.lockedSlot; },
  classTitle(p) { return isInitiate(p.path) && !p.loan ? pathLabel(p.path, p.cls) : CLASSES[p.cls]?.name; },
  rankOfP(p) { return rankOf(p.path, p.stats); },
  rosterPath(p) {
    const out = {};
    if (isInitiate(p.path)) out.ini = p.path.weapon;
    const rk = this.rankOfP(p);
    if (rk) out.rk = rk;
    return out;
  },
  // The `path` message: what the client shows (HUD names, the Academy panel). Mastery / talents kept per class: names only.
  pathMsg(p) {
    const P = p.path;
    return {
      type: 'path', cls: p.cls, ini: isInitiate(P) && !p.loan ? 1 : 0, loan: p.loan ? 1 : 0, rank: this.rankOfP(p), lvl: p.lvl,
      path: P ? { stage: P.stage, weapon: P.weapon, trials: P.trials, drills: P.drills, kept: Object.keys(P.keep), cohort: P.cohort, enrolled: P.enrolled } : null,
      trial: p.trial ? { kind: p.trial.kind, id: p.trial.id } : null,
    };
  },
  markPath(p) { p.pathDirty = true; p.dirty = true; this.rosterDirty = true; },
  // A legacy character's first Academy action: a graduated path record for its class.
  ensurePath(p) { if (!p.path) { p.path = newPath(weaponOfClass(p.cls), 'class'); p.path.armed = 1; } return p.path; },

  // Switch p's class in place: skills, mastery and talents (the given ones, else fresh), stats. The caller recomputes.
  swapClass(p, cls, kept = null) {
    p.cls = cls;
    this.initMastery(p, kept?.mastery || null);
    p.talents = newTalents(kept?.talents || null, cls, p.lvl); p.tal = talentTotals(cls, p.talents); p.talentsDirty = true;
    p.cds = [0, 0, 0, 0, 0]; p.combo = 0; p.chain = null;
    p.masteryDirty = p.masteryNow = true;
  },
  // Weapons the Academy hands out are tagged `ac`: worth nothing, never sold, salvaged, dropped or worked by the Smith
  // (shared/items.js sellPrice, shared/crafting.js, server/game.js sell, server/ground.js, server/smith.js). One that is
  // swapped out goes back to the Academy (it is not bagged), so switching weapon or class mints nothing of value.
  acFit(cls, style) { const st = style && !STYLES[style]?.def ? style : ''; return it => it?.slot === 'weapon' && it.cls === cls && (it.style || '') === st; },
  // Is there room to arm cls / style? (What is worn goes to the bag unless it is an Academy weapon; nothing is ever sold.)
  canArm(p, cls, style, fresh = false) {
    const fit = this.acFit(cls, style), worn = p.inv.eq.weapon;
    if (!fresh && fit(worn)) return true;
    if (!worn || worn.ac) return true;
    if (!fresh && p.inv.bag.some(fit)) return true; // (a swap: the worn one takes its place in the bag)
    return p.inv.bag.length < BAG_SIZE;
  },
  // Equip a weapon of `cls` (rarity, style): the worn one if it fits, else one from the bag, else a new one (an Academy
  // weapon unless `keep`: the graduation weapon is yours). Returns the weapon, or null when the bag has no room.
  armWith(p, cls, rarity, style, fresh = false, keep = false) {
    if (!this.canArm(p, cls, style, fresh)) return null;
    const fit = this.acFit(cls, style);
    if (!fresh && fit(p.inv.eq.weapon)) return p.inv.eq.weapon;
    const i = fresh ? -1 : p.inv.bag.findIndex(fit);
    let it;
    if (i >= 0) it = p.inv.bag.splice(i, 1)[0];
    else { it = makeItem('weapon', rarity, cls, () => 0.5, undefined, style || undefined); if (!keep) { it.ac = 1; it.name = `Academy ${it.name}`; } }
    const old = p.inv.eq.weapon;
    p.inv.eq.weapon = it;
    if (old && !old.ac) p.inv.bag.push(old);
    this.invChanged(p);
    return it;
  },

  // The 2nd weapon after a class or weapon change: an Academy weapon goes back (never kept), another class's spare moves
  // to the bag (it stays put if the bag is full; the swap then says why).
  tidySpare(p) {
    const w2 = p.inv?.eq?.weapon2;
    if (!w2) return;
    if (w2.ac) p.inv.eq.weapon2 = null;
    else if (w2.cls && w2.cls !== p.cls && p.inv.bag.length < BAG_SIZE) { p.inv.bag.push(w2); p.inv.eq.weapon2 = null; }
    else return;
    this.invChanged(p);
  },

  // ---------- graduation and class changes ----------
  // Graduate an Initiate into cls (checks done by the caller): keep the Initiate class's mastery, open the class, grant
  // the matching weapon, full names and power, the level-3 skill, the talent tree with every banked point.
  graduate(p, cls, { quiet = false } = {}) {
    const path = this.ensurePath(p), old = p.cls;
    path.keep[old] = { mastery: p.mastery, talents: p.talents };
    path.stage = 'class';
    const kept = path.keep[cls]; delete path.keep[cls];
    this.swapClass(p, cls, kept);
    this.armWith(p, cls, INITIATE.gradRarity, gradStyle(cls, path.weapon), true, true); // (yours to keep: not an Academy weapon)
    this.tidySpare(p);
    this.recompute(p); p.hp = p.maxHp;
    this.markPath(p);
    this.events.push({ t: 'grad', id: p.id, to: p.id, cls });
    if (!quiet) this.sys(`${p.name} graduated from the Academy as a ${CLASSES[cls].name}!`);
    this.track?.(p, 'graduate', { cls, weapon: path.weapon, lvl: p.lvl });
    if (!p.bot) this.academyBots?.graduateCohort?.(p);
  },
  // A graduate changes class for gold: this class's mastery and talents are kept for later, the new one's come back.
  changeClass(p, cls) {
    const path = this.ensurePath(p), old = p.cls, fee = changeFee(p.lvl);
    p.gold -= fee;
    path.keep[old] = { mastery: p.mastery, talents: p.talents };
    const kept = path.keep[cls]; delete path.keep[cls];
    this.swapClass(p, cls, kept);
    this.armWith(p, cls, 0, gradStyle(cls, path.weapon));
    this.tidySpare(p);
    this.recompute(p); p.hp = p.maxHp;
    this.markPath(p);
    this.events.push({ t: 'grad', id: p.id, to: p.id, cls, change: 1 });
    this.sys(`${p.name} is a ${CLASSES[cls].name} now.`);
    this.track?.(p, 'class_change', { from: old, cls, fee });
  },
  // An Initiate's armory: another weapon, free. The old base class's mastery is kept; the new one's comes back.
  changeWeapon(p, w) {
    const path = p.path, W = WEAPONS[w];
    if (path.weapon === w) return;
    path.weapon = w;
    if (p.cls !== W.base) {
      path.keep[p.cls] = { mastery: p.mastery, talents: {} };
      const kept = path.keep[W.base]; delete path.keep[W.base];
      this.swapClass(p, W.base, kept);
    }
    this.armWith(p, W.base, 0, W.style);
    this.tidySpare(p);
    this.recompute(p);
    this.markPath(p);
    this.sys(`You take up the ${W.name}.`, p.id);
  },

  // ---------- messages ----------
  academyAction(p, msg) {
    try { return this.academyOp(p, msg); }
    catch (e) { console.error('academy action failed', e); } // (a bad message never takes the server down)
  },
  academyOp(p, msg) {
    if (!p || !msg) return;
    const op = String(msg.op || '');
    if (op === 'leave') { if (p.trial) this.academyEnd(p, 'quit'); return; }
    if (op === 'state') { p.pathDirty = true; if (nearAcademy(p.x, p.z, 2) && !p.dead) this.enrol(p); return; } // (the path message only: no roster, no save)
    if (p.dead) return;
    if (!nearAcademy(p.x, p.z, 1.5)) return this.sys('Do that at the Academy, in the Town of Beginnings.', p.id);
    if (p.trial) return this.sys('Finish your trial first.', p.id);
    if (p.duel) return this.sys('Not during a duel.', p.id);
    const path = p.path, t = this.time;
    if (op === 'weapon') {
      const w = String(msg.w || '');
      if (!isWeapon(w)) return;
      if (!isInitiate(path)) return this.sys('Only Initiates change weapon at the armory. Graduates change class instead.', p.id);
      if (path.weapon === w) return;
      if (t < (p.acWeaponAt || 0)) return this.sys(`The armory is still fetching your last weapon (${Math.ceil(p.acWeaponAt - t)} s).`, p.id);
      const W = WEAPONS[w];
      if (!this.canArm(p, W.base, W.style)) return this.sys('Your bag is full: make room for the weapon in your hands first.', p.id);
      p.acWeaponAt = t + WEAPON_CD;
      return this.changeWeapon(p, w);
    }
    if (op === 'trial') { const id = String(msg.id || ''); return isTrial(id) ? this.academyStart(p, 'trial', id) : undefined; }
    if (op === 'drill') { const id = String(msg.id || ''); return isDrill(id) ? this.academyStart(p, 'drill', id) : undefined; }
    if (op === 'graduate' || op === 'change') {
      const cls = String(msg.cls || '');
      if (!isClass(cls)) return;
      const why = gradBlock(path || { trials: {} }, cls, p.cls, p.lvl, p.gold);
      if (why) return this.sys(why, p.id);
      if (isInitiate(path) !== (op === 'graduate')) return;
      const style = gradStyle(cls, path?.weapon || weaponOfClass(p.cls));
      if (!this.canArm(p, cls, style, op === 'graduate')) return this.sys('Your bag is full: make room for the weapon in your hands first.', p.id);
      return op === 'graduate' ? this.graduate(p, cls) : this.changeClass(p, cls);
    }
    if (op === 'talk') {
      const id = headOf(String(msg.cls || ''));
      if (!id || t < (p.acTalkAt || 0)) return;
      p.acTalkAt = t + TALK_CD;
      p.talkN = (p.talkN || 0) + 1;
      const name = id[0].toUpperCase() + id.slice(1);
      this.events.push({ t: 'chat', from: name, id: 0, text: headLine(id, p.talkN + p.id), ch: 's', x: r2(ACADEMY.x), z: r2(ACADEMY.z), head: 1 });
      return;
    }
    if (op === 'cohort') {
      if (!this.academyBots) return this.sys('Classmates are not available here.', p.id);
      if (t < (p.acCohortAt || 0)) return;
      p.acCohortAt = t + TALK_CD;
      const added = this.academyBots.addCohort(this.ensurePath(p), p);
      this.sys(added.length ? `Your classmates ${added.join(' and ')} join you.` : 'Your classmates are already here.', p.id);
      this.markPath(p);
    }
  },
  // First Academy visit as an Initiate: enrolled, and two classmates join (cohorts).
  enrol(p) {
    const path = p.path;
    if (!isInitiate(path) || path.enrolled || p.bot) return;
    path.enrolled = 1;
    this.markPath(p);
    const added = this.academyBots?.addCohort(path, p) || [];
    this.sys(`Welcome to the Academy.${added.length ? ` Your classmates ${added.join(' and ')} enrol with you.` : ''}`, p.id);
  },
  // A cohort bot: an Initiate with its weapon (server/playerbots.js upkeep), or graduated into its class.
  cohortSetup(b, c) {
    if (c.cls) { if (b.cls !== c.cls || isInitiate(b.path)) { b.path = newPath(c.weapon, 'class'); b.path.armed = 1; this.swapClass(b, c.cls, null); this.autoSpendTalents?.(b); this.recompute(b); b.hp = b.maxHp; b.pathDirty = true; this.rosterDirty = true; } return; }
    if (isInitiate(b.path)) return;
    b.path = newPath(c.weapon); b.path.armed = 1; b.path.enrolled = 1;
    const W = WEAPONS[c.weapon];
    if (b.cls !== W.base) this.swapClass(b, W.base, null);
    b.talents = {}; b.tal = talentTotals(b.cls, {}); b.talentsDirty = true;
    this.recompute(b); b.hp = b.maxHp;
    b.pathDirty = true; this.rosterDirty = true;
  },

  // ---------- trials and drills ----------
  academyStart(p, kind, id) {
    const trial = kind === 'trial', def = trial ? (isTrial(id) ? TRIALS[id] : null) : (isDrill(id) ? DRILLS[id] : null);
    if (!def) return;
    if (trial) { const why = trialBlock(p.path, id, p.lvl); if (why) return this.sys(why, p.id); }
    const pens = (this.acPens ||= new Map());
    const pen = PENS.find(q => !pens.has(q.i));
    if (!pen) return this.sys('Every training pen is in use. Try again in a minute.', p.id);
    pens.set(pen.i, p.id);
    const t = this.time;
    const T = p.trial = { kind, id, pen, t0: t + COUNTDOWN, until: t + COUNTDOWN + def.secs, score: 0, hits: 0, mobs: new Set(), spawned: false, ward: 100, wx: pen.cx, wz: pen.z0 + 12, base: p.perfects || 0, rev: 0, endAt: 0 };
    if (trial) {
      p.loan = { cls: p.cls, mastery: p.mastery, talents: p.talents };
      this.swapClass(p, id, null);
      p.talents = {}; p.tal = talentTotals(id, {});
    }
    this.recompute(p); p.hp = p.maxHp; p.cds = [0, 0, 0, 0, 0];
    const [x, z] = penStart(pen);
    p.face = 0;
    this.teleport(p, x, z);
    this.markPath(p);
    this.events.push({ t: 'trial', to: p.id, id: p.id, op: 'start', k: kind, tid: id, n: def.name, goal: def.goal, secs: def.secs, cd: COUNTDOWN });
    this.track?.(p, 'academy_start', { kind, id });
  },
  // One training enemy for T: health (and posture) scaled to the trialist's attack; `extra` sets fields on the mob.
  acSpawn(p, T, type, x, z, hpMul, extra = {}, defExtra = {}) {
    const m = this.addMob(type, x, z);
    m.def = { ...MOBS[type], ...defExtra };
    m.trial = p.id; m.sx = m.x; m.sz = m.z;
    m.hp = m.maxHp = Math.max(20, Math.round(hpMul * p.atk));
    if (hpMul >= TOUGH) m.tough = true;
    Object.assign(m, extra);
    T.mobs.add(m.id);
    return m;
  },
  acSpawnAll(p, T) {
    const pen = T.pen, [fx, fz] = penFar(pen), cx = pen.cx, K = defOf(T).kind;
    const tough = TOUGH;
    if (K === 'break') this.acSpawn(p, T, 'tgolem', fx, fz, 30);
    else if (K === 'hold') for (const dx of [-10, 0, 10]) this.acSpawn(p, T, 'twolf', cx + dx, fz, tough, { sx: T.wx, sz: T.wz }); // (they amble to the Ward Post; they never fall, so the hold is about threat, not killing)
    else if (K === 'fell') for (const [ox, oz] of [[-7, 0], [-5.5, 1.5], [-8.5, 1.5], [7, -4], [5.5, -2.5], [8.5, -2.5]]) this.acSpawn(p, T, 'tdummy', cx + ox, fz + oz, 6);
    else if (K === 'tip') for (const dx of [-6, -2, 2, 6]) this.acSpawn(p, T, 'tdummy', cx + dx, fz, tough, { adv: 1.4 });
    else if (K === 'movers') for (let i = 0; i < 3; i++) this.acMover(p, T, i);
    else if (K === 'mend' || K === 'buff') { if (K === 'buff') for (const dx of [-4, 4]) this.acSpawn(p, T, 'tdummy', cx + dx, fz, tough); T.nextBlow = this.time + 7; }
    else if (K === 'dodge') this.acSpawn(p, T, 'tgolem', cx, fz, tough);
    else if (K === 'punish') this.acSpawn(p, T, 'tgolem', cx, fz, tough, {}, { posture: Math.round(10 * p.atk) });
    else if (K === 'windup') { this.acSpawn(p, T, 'tgolem', cx, fz, tough); for (const dx of [-8, 8]) this.acSpawn(p, T, 'twolf', cx + dx, fz, tough, {}, { aggro: 40 }); }
    else if (K === 'interrupt') this.acSpawn(p, T, 'tcaster', cx, fz, tough);
    else if (K === 'revive') { for (const dx of [-9, 9]) this.acSpawn(p, T, 'twolf', cx + dx, fz, tough, {}, { aggro: 40, atkCd: 2.2 }); this.acFallen(T); }
    else if (K === 'chain') for (const dx of [-3, 0, 3]) this.acSpawn(p, T, 'tdummy', cx + dx, fz - 4, tough);
  },
  acMover(p, T, i) {
    const pen = T.pen, z = pen.z0 + 14 + i * 5;
    this.acSpawn(p, T, 'tmover', pen.cx, z, 3, { ax: pen.cx, mt: i * 1.7, amp: 11, msp: 0.45 + i * 0.18, slot: i });
  },
  acFallen(T) { const pen = T.pen; T.fx = pen.x0 + 6 + Math.random() * (pen.x1 - pen.x0 - 12); T.fz = pen.z0 + 9 + Math.random() * 10; T.rev = 0; },
  // The custom AI of dummies, movers and advancing dummies (shared/academyyard.js ai: 'academyMobAI').
  academyMobAI(m, dt) {
    m.moving = false;
    if (m.dead) return;
    const p = this.players.get(m.trial);
    if (!p) return;
    if (m.type === 'tmover') {
      m.mt += dt;
      const nx = m.ax + Math.sin(m.mt * m.msp * Math.PI) * m.amp;
      m.face = nx > m.x ? Math.PI / 2 : -Math.PI / 2;
      m.x = nx; m.moving = true;
    } else if (m.adv) {
      m.face = angleTo(m.x, m.z, p.x, p.z);
      const d = dist(m, p);
      if (d > 1.3 + m.def.radius && this.time >= (m.stunUntil || 0)) {
        let nx = m.x + Math.sin(m.face) * m.adv * dt, nz = m.z + Math.cos(m.face) * m.adv * dt;
        [nx, nz] = resolveCollision(nx, nz, m.def.radius);
        if (walkable(nx, nz)) { m.x = nx; m.z = nz; m.moving = true; }
      }
    }
  },

  // Once a tick: the countdown, scoring, the Ward Post, the end.
  updateAcademy(dt) {
    if (!this.acPens?.size) return;
    const t = this.time;
    for (const pid of [...this.acPens.values()]) {
      const p = this.players.get(pid), T = p?.trial;
      if (!T) { for (const [k, v] of this.acPens) if (v === pid) this.acPens.delete(k); continue; }
      if (T.endAt) { if (t >= T.endAt) this.academyHome(p); continue; }
      if (p.dead) { this.academyEnd(p, 'fail', 'You fell.'); continue; }
      if (!penAt(p.x, p.z)) { this.academyEnd(p, 'quit'); continue; }
      if (t < T.t0) continue;
      if (!T.spawned) { T.spawned = true; this.acSpawnAll(p, T); }
      const K = defOf(T).kind;
      if (K === 'hold') {
        for (const id of T.mobs) {
          const m = this.mobs.get(id);
          if (m && !m.dead && !m.threat.has(p.id) && Math.hypot(m.x - T.wx, m.z - T.wz) < 4) T.ward -= 4 * dt;
        }
        T.score = Math.max(0, Math.round(T.ward));
      } else if (K === 'mend') {
        T.ward -= 4.5 * dt;
        if (t >= T.nextBlow) { T.nextBlow = t + 7; T.ward -= 18; this.events.push({ t: 'fx', k: 'ring', s: '', id: p.id, x: r2(T.wx), z: r2(T.wz), f: 0, r: 2, c: 'red' }); }
        T.score = Math.max(0, Math.round(T.ward));
      } else if (K === 'buff') {
        const near = Math.hypot(p.x - T.wx, p.z - T.wz) <= 12;
        if (near && p.song && p.song.kind !== 'lullaby' && t < p.song.until) T.acc = (T.acc || 0) + dt;
        if (near && t < (T.crescUntil || 0)) T.acc = (T.acc || 0) + 2 * dt;
        T.score = Math.floor(T.acc || 0);
      } else if (K === 'dodge') T.score = (p.perfects || 0) - T.base;
      else if (K === 'windup') T.score = T.hits;
      else if (K === 'revive') {
        if (Math.hypot(p.x - T.fx, p.z - T.fz) <= REVIVE_R) T.rev += dt; else T.rev = Math.max(0, T.rev - dt);
        if (T.rev >= REVIVE_SECS) { T.score++; this.events.push({ t: 'fx', k: 'heal', s: '', by: p.id, id: p.id, x: r2(T.fx), z: r2(T.fz) }); this.acFallen(T); }
      }
      if (T.ward <= 0 && (K === 'hold' || K === 'mend')) { T.ward = 0; this.academyEnd(p, 'fail', 'The Ward Post fell.'); continue; }
      if (t >= T.until) {
        const timed = K === 'break' || K === 'fell'; // a goal you finish (else the clock ends it)
        if (timed) this.academyEnd(p, 'fail', 'Time.'); else this.academyEnd(p, 'done');
      }
    }
  },
  // The goal met (or the clock ran out on a scored one): medal, records, rewards; fail / quit: nothing.
  academyEnd(p, result, why = '', forceMedal = 0) {
    const T = p.trial;
    if (!T || T.endAt) return;
    const def = defOf(T), path = this.ensurePath(p);
    const medal = forceMedal || (result === 'done' ? medalFor(def, T.score, true) : 0);
    if (forceMedal) T.score = def.tiers[forceMedal - 1];
    T.endAt = this.time + HOME_AFTER; T.medal = medal;
    for (const id of T.mobs) { const m = this.mobs.get(id); if (m) { this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: 0 }); this.mobs.delete(id); } }
    T.mobs.clear();
    const book = T.kind === 'trial' ? path.trials : path.drills, best = book[T.id] | 0;
    if (medal > best) book[T.id] = medal;
    const lines = [];
    if (medal && T.kind === 'drill') { // one-time rewards per tier
      for (let k = 1; k <= medal; k++) {
        if ((path.paid[T.id] | 0) >= k) continue;
        const R = DRILL_REWARD[k];
        p.gold += R.gold || 0;
        for (const [c, n] of Object.entries(R.cons || {})) p.inv.cons[c] = (p.inv.cons[c] | 0) + n;
        lines.push(`${MEDALS[k]} reward: ${R.gold} gold${R.cons ? ` and ${Object.entries(R.cons).map(([c, n]) => `${n} ${c}`).join(', ')}` : ''}`);
        path.paid[T.id] = k;
      }
      if (lines.length) this.invChanged(p);
    }
    if (medal && T.kind === 'trial' && medal > best && headOf(T.id)) this.addFriendship?.(p, headOf(T.id), HEAD_FRIENDSHIP * (medal - best), 'request'); // the hall's head saw it
    if (p.loan) this.acRestore(p);
    const unit = def.unit || '';
    const scoreText = def.low && def.unit === 's' ? `${r1(this.time - T.t0)} s` : `${T.score}${unit}`;
    this.events.push({ t: 'trial', to: p.id, id: p.id, op: 'end', k: T.kind, tid: T.id, n: def.name, medal, result, why, sc: scoreText, pass: T.kind === 'trial' && medal > 0 ? 1 : 0 });
    if (medal) this.sys(`${def.name}: ${MEDALS[medal]} (${scoreText}).${T.kind === 'trial' && isInitiate(path) ? ` You may graduate as a ${CLASSES[T.id].name} at the Academy.` : ''}${lines.length ? ' ' + lines.join('; ') + '.' : ''}`, p.id);
    else if (result !== 'gone') this.sys(`${def.name}: ${result === 'quit' ? 'left' : `not passed${why ? ` (${why})` : ''}`}.`, p.id);
    this.markPath(p);
    this.track?.(p, 'academy_end', { kind: T.kind, id: T.id, result, medal, score: T.score });
  },
  acRestore(p) {
    const L = p.loan; p.loan = null;
    p.cls = L.cls; this.initMastery(p, null); p.mastery = L.mastery; p.talents = L.talents; p.tal = talentTotals(p.cls, p.talents);
    p.cds = [0, 0, 0, 0, 0]; p.chain = null; p.talentsDirty = true; p.masteryDirty = p.masteryNow = true;
    this.recompute(p);
  },
  // Out of the pen, back at the Academy's door.
  academyHome(p) {
    const T = p.trial;
    p.trial = null;
    if (T) for (const [k, v] of this.acPens) if (v === p.id) this.acPens.delete(k);
    if (!p.dead && penAt(p.x, p.z)) { p.hp = p.maxHp; this.teleport(p, ACADEMY.x + 4.5, ACADEMY.z + 1); }
    this.markPath(p);
  },
};

export function installAcademy(Game) {
  const P = Game.prototype;
  Object.assign(P, AcademyMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'academy') return this.academyAction(p, msg);
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.trialWin && p?.trial) { // testing aid: finish the running trial / drill with that medal
      const m = Math.max(1, Math.min(3, msg.trialWin | 0));
      return this.academyEnd(p, 'done', '', m);
    }
    return orig.call(this, p, msg);
  });
  wrap('update', function (orig, dt) { const r = orig.call(this, dt); this.updateAcademy(dt); return r; });
  wrap('meFor', function (orig, p) {
    const me = orig.call(this, p), T = p.trial;
    if (T && !T.endAt) {
      const def = defOf(T), t = this.time;
      me.ac = { k: T.kind, id: T.id, n: def.name, cd: Math.max(0, r1(T.t0 - t)), left: Math.max(0, r1(T.until - Math.max(t, T.t0))), sc: T.score, u: def.unit || '', low: def.low ? 1 : 0, tiers: def.tiers, el: Math.max(0, r1(t - T.t0)) };
      if (['hold', 'mend', 'buff'].includes(def.kind)) Object.assign(me.ac, { w: Math.max(0, Math.round(T.ward)), wx: T.wx, wz: T.wz });
      if (def.kind === 'revive' && T.fx !== undefined) Object.assign(me.ac, { fx: r2(T.fx), fz: r2(T.fz), rv: r2(T.rev / REVIVE_SECS) });
    }
    return me;
  });
  // Training enemies only ever go for their trialist.
  wrap('validTarget', function (orig, m, p) { if (m.trial) return !!p && p.id === m.trial && !p.dead && !!p.trial; return orig.call(this, m, p); });
  // An Initiate's healing is x0.85 too; in the Vigil, your heals also mend the Ward Post.
  wrap('healPlayer', function (orig, tg, amount, by, sk) {
    if (by && isInitiate(by.path) && !by.loan) amount *= INITIATE.pow;
    const T = by?.trial;
    if (T && !T.endAt && TRIALS[T.id]?.kind === 'mend' && T.kind === 'trial' && this.time >= T.t0 && Math.hypot(by.x - T.wx, by.z - T.wz) <= 15) T.ward = Math.min(100, T.ward + (amount / Math.max(1, by.maxHp)) * 100);
    return orig.call(this, tg, amount, by, sk);
  });
  wrap('damageMob', function (orig, m, p, base, opts) {
    if (!m) return orig.call(this, m, p, base, opts);
    if (m.trial && p?.id !== m.trial) return; // a trial is solo: classmates (and anyone else) can't hurt its enemies
    const T = m.trial && p?.trial;
    if (!T) return orig.call(this, m, p, base, opts);
    const K = defOf(T).kind, t = this.time, wind = m.windupAt, broken = t < m.staggerUntil;
    const r = orig.call(this, m, p, base, opts);
    if (K === 'interrupt' && wind && !m.windupAt && !m.dead) { T.score++; this.events.push({ t: 'fx', k: 'ring', s: '', id: m.id, x: r2(m.x), z: r2(m.z), f: 0, r: 2, c: 'gold' }); }
    if (K === 'punish' && broken && T.pending) { T.pending = false; T.score++; }
    if (m.tough && m.hp < m.maxHp * 0.1) m.hp = m.maxHp; // (the tough training enemies never fall)
    return r;
  });
  // The Lancer trial counts the spear's own tip-of-reach hits (spearLine's sweet spot), nothing else (no areas, no DoTs).
  if (P.spearLine) wrap('spearLine', function (orig, p, ...a) {
    const tip = orig.call(this, p, ...a), T = p?.trial;
    if (T && !T.endAt && T.spawned && defOf(T).kind === 'tip') for (const id of tip) if (this.mobs.get(id)?.trial === p.id) T.score++;
    return tip;
  });
  wrap('breakMob', function (orig, m, p, ...a) {
    const r = orig.call(this, m, p, ...a);
    const T = m.trial && p?.trial;
    if (T && m.trial === p.id) { const K = defOf(T).kind; if (K === 'break') T.broke = true; if (K === 'punish') T.pending = true; }
    return r;
  });
  wrap('killMob', function (orig, m, killer) {
    if (!m.trial) return orig.call(this, m, killer);
    if (m.tough) { m.hp = m.maxHp; m.dead = false; return; } // (never falls, whatever the hit)
    const p0 = this.players.get(m.trial);
    if (p0?.trial && defOf(p0.trial).kind === 'break' && !p0.trial.broke) { m.hp = 1; return; } // (Break it first)
    m.dead = true; m.hp = 0;
    this.events.push({ t: 'die', id: m.id, x: r2(m.x), z: r2(m.z), b: 0 });
    this.mobs.delete(m.id);
    const p = this.players.get(m.trial), T = p?.trial;
    if (!T || T.endAt) return;
    T.mobs.delete(m.id);
    const K = defOf(T).kind;
    if (K === 'break') { T.score = r1(this.time - T.t0); this.academyEnd(p, 'done'); }
    else if (K === 'fell') { if (![...T.mobs].some(id => this.mobs.has(id))) { T.score = r1(this.time - T.t0); this.academyEnd(p, 'done'); } else T.score = TRIALS.berserker.n - T.mobs.size; }
    else if (K === 'movers') { T.score++; const slot = m.slot; this.schedule(1, () => { if (p.trial === T && !T.endAt) this.acMover(p, T, slot); }); }
  });
  wrap('damagePlayer', function (orig, p, ...a) {
    const hp = p.hp, r = orig.call(this, p, ...a);
    const T = p.trial;
    if (T && p.hp < hp && !T.endAt) { T.hits++; if (defOf(T).kind === 'revive') T.rev = 0; }
    return r;
  });
  wrap('chainNote', function (orig, p, ...a) {
    const link = orig.call(this, p, ...a), T = p.trial;
    if (link && T && !T.endAt && defOf(T).kind === 'chain') T.score = Math.max(T.score, link.n);
    return link;
  });
  if (P.crescBurst) wrap('crescBurst', function (orig, p, kind, ...a) {
    const r = orig.call(this, p, kind, ...a), T = p.trial;
    if (T && !T.endAt && defOf(T).kind === 'buff' && kind !== 'finale' && Math.hypot(p.x - T.wx, p.z - T.wz) <= 12) T.crescUntil = this.time + 6;
    return r;
  });
  wrap('removePlayer', function (orig, p, ...a) {
    if (p.trial) { this.academyEnd(p, 'gone'); this.academyHome(p); }
    return orig.call(this, p, ...a);
  });
  // The talent tree: locked while an Initiate (points bank up), and off during a trial.
  wrap('talentAction', function (orig, p, msg) {
    if (p.loan) return this.sys('Talents are off during a class trial.', p.id);
    if (isInitiate(p.path)) return this.sys('Your talent tree opens when you graduate at the Academy. Your points are banked.', p.id);
    return orig.call(this, p, msg);
  });
  wrap('talentsMsg', function (orig, p) { const m = orig.call(this, p); if (isInitiate(p.path) || p.loan) m.locked = 1; return m; });
  if (P.autoSpendTalents) wrap('autoSpendTalents', function (orig, p, ...a) { if (isInitiate(p.path)) return; return orig.call(this, p, ...a); });
  wrap('giveXp', function (orig, p, amount) {
    const before = p?.lvl;
    const r = orig.call(this, p, amount);
    if (p && isInitiate(p.path) && before < INITIATE.trialLvl && p.lvl >= INITIATE.trialLvl && !p.bot) {
      this.sys(`Level ${INITIATE.trialLvl}: your class trials are open. Visit the Academy in the Town of Beginnings.`, p.id);
      this.events.push({ t: 'trial', to: p.id, id: p.id, op: 'open' });
    }
    return r;
  });
}

// Rank names for the Hall: each player's rank carved next to their name in a clear record (index.js game.onClear).
export function carveRanks(game, rec) {
  if (!rec?.players) return rec;
  const byName = new Map([...game.players.values()].map(p => [p.name, p]));
  return { ...rec, players: rec.players.map(e => { const p = byName.get(e.name); const rk = p ? rankOf(p.path, p.stats) : 0; return rk ? { ...e, rk: rankName(rk) } : e; }) };
}
export { COHORT, cohortClasses };
