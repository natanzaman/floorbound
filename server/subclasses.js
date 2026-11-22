// Subclasses (docs/briefs/subclasses.md), mixed into Game by installSubclasses(Game) near the end of game.js.
// Data and pure rules: shared/subclasses.js (the 14 subclasses, their signature skills, fees, the record) and the
// subclass talent nodes in shared/talents.js.
//
// State: p.path.subs[cls] (the subclass of each class you specialised), p.cds[4] (the signature skill's cooldown: slot 4,
// the 5th slot). Messages: { type: 'academy', op: 'specialise', sub } (at the Academy, level 15+, a graduate; a fee to
// change), op 'lectern'. Out: the `path` message carries `spec` (pathMsg wrapper), the snapshot's me.sub (bots), the
// roster's `sub` (nameplates, the Players list).
// Hooks: game.js useSkill hands slot 4 to useSignature. Wrappers below: initTalents / initPath (subclass nodes kept on
// load), swapClass (talents re-cleaned for the new class's subclass), setTalents, markPath (admin edits), talentStats
// (a hidden pick's borrowed tier), skillPow (a borrowed skill's power), rosterPath, pathMsg, meFor, academyOp, schedule.
import { CLASSES, wrapAngle, paced } from '../shared/data.js';
import { newTalents, talentTotals, TREES } from '../shared/talents.js';
import {
  SPEC, SUBCLASSES, HIDDEN, BOT_SUB, isSub, subsOf, subOf, specFee, specBlock, canFind, borrowFrom, borrowable, borrowedTotals,
} from '../shared/subclasses.js';
import { isInitiate } from '../shared/academy.js';
import { nearAcademy, nearLectern } from '../shared/academyyard.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = v => Math.round(v * 100) / 100;
const SLOT = SPEC.slot;

// ---------- the 14 signature skills ----------
// this = the game, p = the user, c = { n: the skill's numbers, atk(): attack power now, alive() }. Return false when
// nothing happened (no cooldown). Hits carry no mastery skill (signature skills have no mastery); talent effects on
// 'sig' reach them through p._tsk (server/talents.js).
const SIGS = {
  flashstep(p, c) { // Duelist: blink to the target (i-frames), cutting through what is in the way, then three quick cuts
    const N = c.n, x0 = p.x, z0 = p.z, s = this.skySpot(p, N.len, N.len); // (to the target's near edge, else straight ahead)
    p.face = s.face;
    const [tx, tz] = this.lanceDash(p, Math.hypot(s.x - x0, s.z - z0));
    p.iframeUntil = Math.max(p.iframeUntil || 0, this.time + N.iframes);
    this.sigFx(p, 'rush', { x2: r2(tx), z2: r2(tz) });
    this.hitLine(p, x0, z0, tx, tz, N.width, c.atk() * N.line, { knock: 0.6 });
    this.teleport(p, tx, tz);
    for (let i = 0; i < N.cuts; i++) {
      this.schedule(paced(N.gap) * (i + 1), () => {
        if (!c.alive()) return;
        const last = i === N.cuts - 1;
        this.sigFx(p, 'arc', { r: N.r, n: i, ...(last ? { c: 'gold', fin: 1 } : {}) });
        this.hitArc(p, N.r, N.half, c.atk() * N.cut * (last ? 1.4 : 1), { heavy: last, knock: last ? 1.2 : 0.2 });
      });
    }
  },
  rallycut(p, c) { // Vanguard: a heavy posture cut, and a party damage rally
    const N = c.n;
    this.sigFx(p, 'arc', { r: N.r, c: 'gold', fin: 1 });
    this.hitArc(p, N.r, N.half, c.atk() * N.mult, { heavy: true, frac: N.frac, knock: 1 });
    this.sigFx(p, 'ring', { r: N.allyR, c: 'gold' });
    for (const o of this.players.values()) if (!o.dead && dist(o, p) <= N.allyR) { this.teamBuff(o, N.dmg, N.d); this.events.push({ t: 'buff', id: o.id, k: 'bless', d: N.d }); }
  },
  aegisline(p, c) { // Bulwark Knight: damage reduction for you and the line
    const N = c.n, t = this.time;
    this.sigFx(p, 'ring', { r: N.r, c: 'gold' });
    this.sigFx(p, 'shield');
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > N.r) continue;
      const v = o === p ? N.self : N.ally;
      if (t < (o.dr?.until || 0) && o.dr.v >= v) continue; // a stronger one already holds
      o.dr = { until: t + N.d, v, by: p.id };
      this.events.push({ t: 'buff', id: o.id, k: o === p ? 'wall' : 'dr', d: N.d });
    }
  },
  conqroar(p, c) { // Warlord: taunt everything nearby, stagger and posture
    const N = c.n;
    this.sigFx(p, 'ring', { r: N.r, c: 'gold' });
    for (const m of this.mobs.values()) if (this.targetable(m) && dist(m, p) <= N.r + m.def.radius) this.tauntMob(m, p, 'taunt');
    this.hitCircle(p, p.x, p.z, N.r, c.atk() * N.mult, { stun: N.stun, frac: N.frac, threat: 2, heavy: true });
  },
  dawnburst(p, c) { // Lightbringer: a big party heal
    const N = c.n, k = 1 + (p.tal?.stat?.heal || 0) / 100;
    this.sigFx(p, 'ring', { r: N.r, c: 'light' });
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > N.r || this.unhealable?.(o)) continue;
      this.healPlayer(o, (o.maxHp * N.frac + N.flat + p.lvl * N.perLvl) * k, p, null);
      this.events.push({ t: 'fx', k: 'heal', by: p.id, id: o.id, x: r2(o.x), z: r2(o.z) });
    }
  },
  judgeray(p, c) { // Inquisitor: a piercing ray that interrupts
    const N = c.n, x2 = p.x + Math.sin(p.face) * N.len, z2 = p.z + Math.cos(p.face) * N.len;
    this.sigFx(p, 'bolt', { x2: r2(x2), z2: r2(z2), pierce: 1 });
    for (const m of [...this.mobs.values()]) {
      if (!this.targetable(m) || !onLine(p.x, p.z, x2, z2, m, N.width)) continue;
      this.damageMob(m, p, c.atk() * N.mult, { interrupt: m.windupAt > 0, frac: N.frac, heavy: true });
    }
  },
  deadeye(p, c) { // Sharpshooter: a drawn, piercing shot (the line shows during the draw)
    const N = c.n, draw = paced(N.draw), face = p.face;
    const x2 = () => p.x + Math.sin(face) * N.len, z2 = () => p.z + Math.cos(face) * N.len;
    this.sigFx(p, 'rush', { x2: r2(x2()), z2: r2(z2()) }); // the telegraph: where it will fly
    this.schedule(draw, () => {
      if (!c.alive()) return;
      const ex = x2(), ez = z2();
      this.sigFx(p, 'bolt', { x2: r2(ex), z2: r2(ez), pierce: 1 });
      for (const m of [...this.mobs.values()]) if (this.targetable(m) && onLine(p.x, p.z, ex, ez, m, N.width)) this.damageMob(m, p, c.atk() * N.mult, { heavy: true, frac: N.frac, knock: 0.8 });
    });
  },
  snarefield(p, c) { // Trapmaster: hold and slow everything in a circle ahead
    const N = c.n, s = this.skySpot(p, N.range, N.fwd);
    this.sigFx(p, 'ring', { id: 0, by: p.id, x: r2(s.x), z: r2(s.z), r: N.r }); // (id 0: drawn at the spot, not on you)
    this.sigFx(p, 'zone', { x: r2(s.x), z: r2(s.z), r: N.r, d: 1.2 });
    for (const m of [...this.mobs.values()]) {
      if (!this.targetable(m) || Math.hypot(m.x - s.x, m.z - s.z) > N.r + m.def.radius) continue;
      this.damageMob(m, p, c.atk() * N.mult, { stun: N.stun });
      if (!m.dead) this.slowMob(m, N.slow, N.slowFor);
    }
  },
  rampage(p, c) { // Reaver: three spins
    const N = c.n;
    for (let i = 0; i < N.spins; i++) {
      const go = () => {
        if (!c.alive()) return;
        const last = i === N.spins - 1;
        this.sigFx(p, 'ring', { r: N.r, ...(last ? { c: 'gold' } : {}) });
        this.hitCircle(p, p.x, p.z, N.r, c.atk() * N.mult * (last ? N.last : 1), { knock: last ? 1.5 : 0.3, heavy: last });
      };
      if (i === 0) go(); else this.schedule(paced(N.gap) * i, go);
    }
  },
  crimsonpact(p, c) { // Blood Knight: a heavy cleave that heals
    const N = c.n, hp0 = new Map();
    for (const m of this.mobs.values()) if (this.targetable(m)) hp0.set(m.id, m.hp);
    this.sigFx(p, 'arc', { r: N.r, c: 'gold', fin: 1 });
    this.hitArc(p, N.r, N.half, c.atk() * N.mult, { heavy: true, knock: 1 });
    let dealt = 0;
    for (const [id, h] of hp0) { const m = this.mobs.get(id); dealt += Math.max(0, h - Math.max(0, m && !m.dead ? m.hp : 0)); }
    if (dealt > 0) this.healPlayer(p, Math.min(p.maxHp * N.cap, dealt * N.leech), p, null);
  },
  wyverndive(p, c) { // Dragoon: leap onto the target and crash down
    const N = c.n, s = this.skySpot(p, N.range, N.fwd), t = this.time, air = paced(N.air);
    p.face = s.face; p.airFrom = t; p.airUntil = t + air;
    this.sigFx(p, 'rush', { x2: r2(s.x), z2: r2(s.z) });
    this.sigFx(p, 'ring', { id: 0, by: p.id, x: r2(s.x), z: r2(s.z), r: N.r }); // where it lands (id 0: drawn at the spot, for your allies)
    this.schedule(air, () => {
      if (!c.alive()) return;
      this.teleport(p, s.x, s.z);
      this.sigFx(p, 'ring', { r: N.r, c: 'gold' });
      this.hitCircle(p, s.x, s.z, N.r, c.atk() * N.mult, { heavy: true, stun: N.stun, knock: N.knock, frac: N.frac, threat: 1.5 });
    });
  },
  spearwall(p, c) { // Phalanx: a frontal stun and a guard for the line
    const N = c.n, t = this.time;
    this.sigFx(p, 'arc', { r: N.r, c: 'gold', fin: 1 });
    this.hitArc(p, N.r, N.half, c.atk() * N.mult, { knock: N.knock, stun: N.stun, heavy: true });
    this.sigFx(p, 'ring', { r: N.allyR, c: 'gold' });
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > N.allyR || (t < (o.dr?.until || 0) && o.dr.v >= N.dr)) continue;
      o.dr = { until: t + N.d, v: N.dr, by: p.id };
      this.events.push({ t: 'buff', id: o.id, k: 'dr', d: N.d });
    }
  },
  encore(p, c) { // Virtuoso: cooldowns back and a damage buff for the party
    const N = c.n, t = this.time;
    this.sigFx(p, 'ring', { r: N.r, c: 'light' });
    for (const o of this.players.values()) {
      if (o.dead || dist(o, p) > N.r) continue;
      for (let i = 1; i < 4; i++) if (o.cds[i] > t) o.cds[i] = Math.max(t, o.cds[i] - N.cut); // (never the signature slot)
      this.teamBuff(o, N.dmg, N.d);
      this.events.push({ t: 'buff', id: o.id, k: 'bless', d: N.d });
    }
  },
  sirenwail(p, c) { // Siren: interrupt and slow everything around
    const N = c.n;
    this.sigFx(p, 'ring', { r: N.r });
    for (const m of [...this.mobs.values()]) {
      if (!this.targetable(m) || dist(m, p) > N.r + m.def.radius) continue;
      this.damageMob(m, p, c.atk() * N.mult, { interrupt: m.windupAt > 0, frac: N.frac });
      if (!m.dead) this.slowMob(m, N.slow, N.slowFor);
    }
  },
};
export const SIG_FNS = SIGS; // (tests: every signature skill has its code)
function onLine(x0, z0, x1, z1, m, width) {
  const lx = x1 - x0, lz = z1 - z0, len2 = lx * lx + lz * lz || 1;
  const tt = Math.max(0, Math.min(1, ((m.x - x0) * lx + (m.z - z0) * lz) / len2));
  return Math.hypot(m.x - (x0 + lx * tt), m.z - (z0 + lz * tt)) <= width + m.def.radius;
}

const HID_NAME = 'Your Own Road'; // (the hidden pick's name on screen: sent only to a character who found it)
export const SubclassMethods = {
  // ---------- the record ----------
  // The subclass in force (null: none, a trial's loan, an Initiate). The hidden pick counts as HIDDEN.id.
  subOfP(p) {
    if (!p?.path || p.loan || isInitiate(p.path)) return null;
    const s = subOf(p.path, p.cls);
    if (s === HIDDEN.id) return p.path.found && p.path.wb?.[p.cls] ? s : null;
    return isSub(s) && SUBCLASSES[s].cls === p.cls ? s : null;
  },
  // The skill in the 5th slot (null: none yet). A hidden pick's is the borrowed skill, at HIDDEN.pow.
  sigDef(p) {
    const s = this.subOfP(p);
    if (!s || p.lvl < SPEC.lvl) return null;
    if (s !== HIDDEN.id) return SUBCLASSES[s].skill;
    const b = p.path.wb[p.cls], sk = CLASSES[b.c]?.skills.find(x => x.id === b.sk);
    return sk ? { id: sk.id, key: sk.id, name: sk.name, cd: sk.cd, desc: sk.desc, lvl: SPEC.lvl, borrow: b.c } : null;
  },
  // A skill slot's definition: 0-3 the class's, 4 the signature (or borrowed) skill.
  skillAt(p, slot) { return (slot | 0) === SLOT ? this.sigDef(p) : CLASSES[p?.cls]?.skills[slot | 0]; },
  sigFx(p, k, extra = {}) {
    this.events.push({ t: 'fx', k, s: this._sigId || undefined, id: p.id, x: r2(p.x), z: r2(p.z), f: r2(p.face), ...extra });
  },

  // ---------- using slot 5 (from game.js useSkill) ----------
  useSignature(p, face) {
    const sk = this.sigDef(p);
    if (!sk || p.dead || this.time < (p.cds[SLOT] || 0)) return;
    if (typeof face === 'number' && isFinite(face)) p.face = wrapAngle(face);
    if (sk.borrow) return this.useBorrowed(p, sk, face);
    const fn = SIGS[sk.id];
    if (!fn) return;
    const mods = p.tal?.sk?.sig || {}, cd = sk.cd * (1 - (p.haste || 0)) * Math.max(0.4, 1 + (mods.cd || 0) / 100);
    const c = { id: sk.id, n: sk.n, atk: () => p.atk * this.dmgMult(p), alive: () => !p.dead && this.players.has(p.id) };
    const prev = this._sigId; this._sigId = sk.id;
    try { if (fn.call(this, p, c) === false) return; } finally { this._sigId = prev; }
    p.cds[SLOT] = this.time + cd;
  },
  // A hidden pick's borrowed skill: the other class's own code runs with that class in place for the moment, its
  // cooldown kept in slot 5, at HIDDEN.pow (skillPow wrapper). The real class, its cooldown in that slot and its state come back.
  useBorrowed(p, sk, face) {
    const other = sk.borrow, i = CLASSES[other].skills.findIndex(x => x.id === sk.id);
    if (i < 1) return;
    const real = p.cls, saved = p.cds[i], prevB = p._borrowing;
    p.cls = other; p.cds[i] = 0; p._borrowing = true;
    let until = 0;
    try { this.useSkill(p, i, face); until = p.cds[i]; }
    finally { p.cls = real; p.cds[i] = saved; p._borrowing = prevB; }
    if (until > this.time) p.cds[SLOT] = until;
  },

  // ---------- choosing (the Academy panel) ----------
  specialise(p, sub, borrow = null, { free = false } = {}) {
    const path = this.ensurePath(p), cur = subOf(path, p.cls), fee = cur && !free ? specFee(p.lvl) : 0;
    p.gold -= fee;
    (path.subs ||= {})[p.cls] = sub;
    if (sub === HIDDEN.id) (path.wb ||= {})[p.cls] = { c: borrow.c, sk: borrow.sk, br: borrow.br };
    p.cds[SLOT] = this.time + SPEC.cdOnPick;
    this.specRefresh(p);
    this.markPath(p);
    const name = sub === HIDDEN.id ? null : SUBCLASSES[sub].name;
    this.events.push({ t: 'spec', id: p.id, to: p.id, sub: name ? sub : '', n: name || '', ...(name ? {} : { hn: HID_NAME, hs: 'A borrowed skill is in slot 5' }) });
    if (name) this.sys(`${p.name} specialised as a ${name}!`);
    else this.sys('You choose your own road.', p.id);
    this.track?.(p, 'specialise', { cls: p.cls, sub, fee, lvl: p.lvl });
  },
  // Talents and stats after a change of subclass (or an admin edit): the other subclass's nodes come back as points.
  specRefresh(p) {
    if (!p?.talents) return;
    const sub = this.subOfP(p), next = newTalents(p.talents, p.cls, p.lvl, sub);
    if (JSON.stringify(next) !== JSON.stringify(p.talents)) { p.talents = next; p.talentsDirty = true; }
    p.tal = talentTotals(p.cls, p.talents);
    if (p.inv) this.recompute(p);
  },
  // A premade bot or one of the Named at level 15+: its subclass, free, anywhere (never the hidden pick).
  botSpecialise(b, sub = BOT_SUB[b?.cls]) {
    if (!b || b.lvl < SPEC.lvl || !isSub(sub) || SUBCLASSES[sub].cls !== b.cls || isInitiate(b.path)) return false;
    const path = this.ensurePath(b);
    if (subOf(path, b.cls) === sub) return false;
    (path.subs ||= {})[b.cls] = sub;
    this.specRefresh(b);
    b.pathDirty = true; this.rosterDirty = true;
    return true;
  },

  // The `spec` part of the path message: what the Specialise section shows.
  specMsg(p) {
    const P = p.path, sub = this.subOfP(p), sig = this.sigDef(p);
    const out = { lvl: SPEC.lvl, fee: specFee(p.lvl), sub: sub === HIDDEN.id ? '' : sub || '', opts: subsOf(p.cls) };
    if (sig) out.sig = { id: sig.id, name: sig.name, desc: sig.borrow ? `${sig.desc} (Borrowed from the ${CLASSES[sig.borrow].name}: ${Math.round(HIDDEN.pow * 100)}% power.)` : sig.desc, cd: sig.cd, aim: sig.aim || 0, anim: sig.anim || sig.id };
    if (P?.found && !isInitiate(P)) { // (only once found: the client holds no text for it)
      const from = borrowFrom(P, p.cls).map(c => ({ cls: c, name: CLASSES[c].name, skills: borrowable(c).map(id => ({ id, name: CLASSES[c].skills.find(s => s.id === id).name })), branches: (TREES[c]?.branches || []).map(b => ({ id: b.id, name: b.name })) }));
      out.hid = { id: HIDDEN.id, name: HID_NAME, on: sub === HIDDEN.id ? P.wb[p.cls] : null, from,
        text: `Keep your class and take one skill (slot 5) and the first tier of one talent branch from another class whose trial you passed, at ${Math.round(HIDDEN.pow * 100)}% power. No signature skill.` };
    }
    return out;
  },

  // ---------- the lectern behind the Academy ----------
  lecternAct(p) {
    if (p.dead || !nearLectern(p.x, p.z, 0.8)) return;
    const t = this.time;
    if (t < (p.lecternAt || 0)) return;
    p.lecternAt = t + 3;
    const say = text => this.sys(text, p.id);
    if (!canFind(p.path, p.lvl)) return say('A dusty lectern. The book on it is too faded to read.');
    if (p.path.found) return say('The margins are full of your own notes now.');
    p.path.found = 1;
    this.markPath(p);
    say('Under the dust, a page in many hands: "One tree is a habit, not a law. Walk where you have already walked." A new choice waits in your Specialise section.');
    this.events.push({ t: 'spec', id: p.id, to: p.id, found: 1 });
    this.track?.(p, 'lectern', { cls: p.cls, lvl: p.lvl });
  },

  academySpecOp(p, msg) {
    const op = String(msg.op || '');
    if (op === 'lectern') return this.lecternAct(p);
    if (p.dead || p.trial || p.duel) return;
    const sub = String(msg.sub || '');
    const borrow = sub === HIDDEN.id && msg.borrow && typeof msg.borrow === 'object' ? { c: String(msg.borrow.c || ''), sk: String(msg.borrow.sk || ''), br: String(msg.borrow.br || '') } : null;
    const why = specBlock(p.path || { stage: 'class', trials: {} }, p.cls, p.lvl, sub, p.gold, { borrow }); // (no path: graduated before the Academy)
    if (why) return this.sys(why, p.id);
    this.specialise(p, sub, borrow);
  },
};

export function installSubclasses(Game) {
  const P = Game.prototype;
  Object.assign(P, SubclassMethods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // Loading: talents are read before the path (game.js addPlayer), so the subclass's nodes are kept once it is known.
  wrap('initTalents', function (orig, p, raw) { p._talRaw = raw; return orig.call(this, p, raw); });
  wrap('initPath', function (orig, p, ...a) {
    const r = orig.call(this, p, ...a);
    const raw = p._talRaw; delete p._talRaw;
    if (this.joinSub && !p.charId) this.botSpecialise(p, this.joinSub); // an anonymous join with a subclass (index.js: bot runners, tests)
    const sub = this.subOfP(p);
    if (sub && raw) { p.talents = newTalents(raw, p.cls, p.lvl, sub); p.tal = talentTotals(p.cls, p.talents); }
    return r;
  });
  // A class change (graduation, the Academy, a trial's loan ending): the new class's subclass nodes stay.
  wrap('swapClass', function (orig, p, cls, kept = null) {
    const r = orig.call(this, p, cls, kept);
    const sub = this.subOfP(p);
    if (sub && kept?.talents) { p.talents = newTalents(kept.talents, cls, p.lvl, sub); p.tal = talentTotals(cls, p.talents); }
    while (p.cds.length <= SLOT) p.cds.push(0);
    return r;
  });
  wrap('setTalents', function (orig, p, alloc) { p.talents = newTalents(alloc, p.cls, p.lvl, this.subOfP(p)); this.talentsUpdated(p); });
  wrap('markPath', function (orig, p) { const r = orig.call(this, p); this.specRefresh(p); return r; });
  // A hidden pick's borrowed tier, merged into the totals each recompute (p.tal is rebuilt first: server/loot.js).
  wrap('talentStats', function (orig, p) {
    if (p?.tal && !p.tal._wb && this.subOfP(p) === HIDDEN.id) {
      const B = borrowedTotals(p.path.wb[p.cls]), T = p.tal;
      for (const [k, v] of Object.entries(B.stat)) T.stat[k] = (T.stat[k] || 0) + v;
      for (const [k, v] of Object.entries(B.aura)) T.aura[k] = (T.aura[k] || 0) + v;
      for (const [key, m] of Object.entries(B.sk)) { const o = (T.sk[key] ||= {}); for (const [k, v] of Object.entries(m)) o[k] = (o[k] || 0) + v; }
      T._wb = 1;
    }
    return orig.call(this, p);
  });
  wrap('skillPow', function (orig, p, ...a) { const v = orig.call(this, p, ...a); return p?._borrowing ? v * HIDDEN.pow : v; });
  // A signature skill's delayed hits keep its fx name.
  wrap('schedule', function (orig, delay, fn) {
    const id = this._sigId;
    if (!id) return orig.call(this, delay, fn);
    return orig.call(this, delay, () => { const prev = this._sigId; this._sigId = id; try { return fn(); } finally { this._sigId = prev; } });
  });
  wrap('rosterPath', function (orig, p) {
    const out = orig.call(this, p), s = this.subOfP(p);
    if (s && s !== HIDDEN.id && p.lvl >= SPEC.lvl) out.sub = s; // (the hidden pick shows the class)
    return out;
  });
  // Levelling changes the fee and, at SPEC.lvl, opens the section: send the path again (and say so once).
  wrap('giveXp', function (orig, p, ...a) {
    const was = p.lvl, r = orig.call(this, p, ...a);
    if (p.lvl !== was && !p.bot && !isInitiate(p.path)) {
      p.pathDirty = true;
      if (was < SPEC.lvl && p.lvl >= SPEC.lvl && !this.subOfP(p)) this.sys(`Level ${SPEC.lvl}: you can specialise. Visit the Academy (Specialise) to pick a subclass and its signature skill.`, p.id);
    }
    return r;
  });
  wrap('pathMsg', function (orig, p) { const m = orig.call(this, p); m.spec = this.specMsg(p); return m; });
  wrap('meFor', function (orig, p) {
    const me = orig.call(this, p), s = this.subOfP(p);
    if (s && s !== HIDDEN.id && p.lvl >= SPEC.lvl) me.sub = s; // (bots: which signature skill slot 5 holds)
    return me;
  });
  wrap('academyOp', function (orig, p, msg) {
    const op = String(msg?.op || '');
    if (op === 'lectern') return this.academySpecOp(p, msg);
    if (op === 'specialise') {
      if (!p || p.dead) return;
      if (!nearAcademy(p.x, p.z, 1.5)) return this.sys('Do that at the Academy, in the Town of Beginnings.', p.id);
      return this.academySpecOp(p, msg);
    }
    return orig.call(this, p, msg);
  });
}
