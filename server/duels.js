// Duels (docs/briefs/duels.md; rules and numbers in shared/duels.js). Solo, or team: everyone in the challenger's
// party against everyone in the challenged player's party. Players, bots and the Named alike.
//   ask / accept / decline / yield   { type: 'duel', op, id | name, rule, team } or chat: /duel <name> [rule] [team],
//                   /duel accept | decline | cancel, /yield. A bot or one of the Named answers by itself (it accepts).
//   countdown → fight → result      a ring around the duel's centre (team duels line each side up first); out of
//                   it for DUEL.grace s = out. Out by the rule (First Strike, Half Health, Last Stand), by going down
//                   to a monster, leaving or yielding. A side with nobody left loses; the clock: decideOnTime.
//   stand-ins       each live fighter carries a "duelist" mob (shared/duels.js DUEL_MOBS) that follows them, so every
//                   attack (arcs, lines, arrows, zones, evolved skills) reaches an opponent the way it reaches a
//                   monster. A hit on one never runs the rest of damageMob (no threat, posture, mastery, loot, team
//                   stats): it becomes a damagePlayer on its owner (src 'duel'), so dodges, guards, parries, shields
//                   and damage reduction work as they do against monsters, scaled by DUEL.pvp. Nobody can drop
//                   below the rule's floor (1 health at least), so nobody dies or goes down to a duel hit.
//   during a duel   no healing from outside your side, no town regeneration; at the end everyone gets at least the
//                   health they started with back. Snapshot rows: w.du (shared/duels.js readDuels).
import { DUEL, DUEL_RULES, DUEL_RULE_IDS, DUEL_DEFAULT, decideOnTime, parseDuelChat, DUEL_HELP } from '../shared/duels.js';
import { walkable, resolveCollision, inArena } from '../shared/data.js';
import { floorOf, inArena2 } from '../shared/floor2.js';
import { inArena3 } from '../shared/floor3.js';

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inBossRoom = p => inArena(p.x, p.z) || inArena2(p.x, p.z) || inArena3(p.x, p.z);
class NoThreat extends Map { set() { return this; } }
class NoCredit extends Set { add() { return this; } }
const STATE = { count: 0, live: 1, done: 2 };
const OUT_TEXT = { rule: 'beaten', fell: 'went down', left: 'left', fled: 'left the ring', yield: 'yielded' };

export const DuelMethods = {
  duelMap() { return (this.duels ||= new Map()); },
  duelOf(p) { return p?.duel ? this.duelMap().get(p.duel) || null : null; },
  // The live duel a stand-in or player is fighting in, with both fighters' rows (null: no such hit counts).
  duelPair(a, v) {
    const d = this.duelOf(v);
    if (!d || d.state !== 'live' || !a || a.duel !== d.id) return null;
    const fa = d.f.get(a.id), fv = d.f.get(v.id);
    if (!fa || !fv || fa.out || fv.out || fa.side === fv.side) return null;
    return { d, fa, fv };
  },

  // ---------- challenge ----------
  findByName(name) {
    const lower = String(name || '').trim().toLowerCase();
    if (!lower) return null;
    const all = [...this.players.values()];
    return all.find(o => o.name.toLowerCase() === lower) || (c => (c.length === 1 ? c[0] : null))(all.filter(o => o.name.toLowerCase().startsWith(lower)));
  },
  // Each side: the player, or for a team duel everyone in their party who can fight here (same floor, up, free).
  duelSide(p, team) {
    const party = team ? this.partyOf(p) : null;
    if (!party) return [p];
    const fl = floorOf(p.x);
    const list = party.members.map(id => this.players.get(id)).filter(o => o && (o === p || (!o.dead && !o.downed && !o.trap && floorOf(o.x) === fl && !this.duelOf(o) && !inBossRoom(o))));
    return [p, ...list.filter(o => o !== p)];
  },
  // Why c can't duel t right now ('' = they can).
  duelBlock(c, t, team) {
    if (!c || !t) return 'They are not here any more.';
    if (c === t) return 'You can\'t duel yourself.';
    if (this.duelOf(c)) return 'You are already in a duel.';
    if (this.duelOf(t)) return `${t.name} is already in a duel.`;
    if (c.dead || c.downed) return 'You are down right now.';
    if (t.dead || t.downed) return `${t.name} is down right now.`;
    if (c.trap || t.trap) return 'Not while someone is trapped.';
    if (floorOf(c.x) !== floorOf(t.x) || dist(c, t) > DUEL.askRange) return `Get closer to ${t.name} (within ${DUEL.askRange} m) to duel.`;
    if (inBossRoom(c) || inBossRoom(t)) return 'No duels in a boss room.';
    if (team && c.party && c.party === t.party) return `You and ${t.name} are in the same party: a team duel needs two parties (or duel solo).`;
    return '';
  },
  duelAsk(p, { id = 0, name = '', rule = DUEL_DEFAULT, team = false } = {}) {
    if (!p) return false;
    const t = id ? this.players.get(id | 0) : this.findByName(name);
    if (!t) { this.sys(name ? `Nobody called "${String(name).slice(0, 16)}" is here.` : 'Challenge whom? /duel <name>', p.id); return false; }
    rule = DUEL_RULES[rule] ? rule : DUEL_DEFAULT; team = !!team;
    const why = this.duelBlock(p, t, team);
    if (why) { this.sys(why, p.id); return false; }
    t.duelAsk = { from: p.id, rule, team, at: this.time };
    const R = DUEL_RULES[rule], kind = team ? 'team duel' : 'duel';
    this.events.push({ t: 'duelask', to: t.id, from: p.id, name: p.name, rule, team: team ? 1 : 0 });
    this.sys(`You challenged ${t.name} to a ${kind} (${R.name}).`, p.id);
    this.sys(`${p.name} challenges you to a ${kind} (${R.name}: ${R.desc}). /duel accept or /duel decline.`, t.id);
    if (t.bot) { // bots and the Named answer by themselves: they accept
      const [lo, hi] = DUEL.botAnswer;
      this.schedule(lo + Math.random() * (hi - lo), () => { if (t.duelAsk?.from === p.id && this.players.get(t.id) === t) this.duelAccept(t); });
    }
    return true;
  },
  duelAccept(t) {
    const ask = t?.duelAsk;
    if (!ask || this.time - ask.at > DUEL.askFor) { if (t) { t.duelAsk = null; this.sys('No duel challenge to accept.', t.id); } return false; }
    t.duelAsk = null;
    const c = this.players.get(ask.from);
    const why = this.duelBlock(c, t, ask.team);
    if (why) { this.sys(c ? `The duel with ${c.name} can't start right now.` : why, t.id); if (c) this.sys(`The duel with ${t.name} can't start: ${why}`, c.id); return false; }
    return this.duelStart(c, t, ask.rule, ask.team);
  },
  duelDecline(t) {
    const ask = t?.duelAsk;
    if (!ask) return false;
    t.duelAsk = null;
    const c = this.players.get(ask.from);
    if (c) this.sys(`${t.name} declined your duel.`, c.id);
    this.sys('Duel declined.', t.id);
    return true;
  },
  duelCancel(c) { // take back a challenge you sent
    let n = 0;
    for (const o of this.players.values()) if (o.duelAsk?.from === c.id) { o.duelAsk = null; n++; this.events.push({ t: 'duelask', to: o.id, from: c.id, off: 1 }); this.sys(`${c.name} took back the duel challenge.`, o.id); }
    this.sys(n ? 'Challenge taken back.' : 'You have no challenge out.', c.id);
  },
  duelYield(p) {
    const d = this.duelOf(p);
    if (!d || d.state === 'done') { if (p.duelAsk) return this.duelDecline(p); this.sys('You are not in a duel.', p.id); return false; }
    const f = d.f.get(p.id);
    if (!f || f.out) { this.sys('You are already out of this duel.', p.id); return false; }
    this.duelOut(d, f, 'yield');
    return true;
  },

  // ---------- start ----------
  duelStart(c, t, rule, team) {
    const sides = [this.duelSide(c, team), this.duelSide(t, team)];
    const fl = floorOf(c.x);
    for (const [k, side] of sides.entries()) { // party members on another floor or busy sit it out
      const lead = k ? t : c, party = team ? this.partyOf(lead) : null;
      if (party) for (const id of party.members) { const o = this.players.get(id); if (o && !side.includes(o)) this.sys(`You sit this duel out (${o.dead || o.downed ? 'down' : floorOf(o.x) !== fl ? 'another floor' : 'busy'}).`, o.id); }
    }
    let x = (c.x + t.x) / 2, z = (c.z + t.z) / 2;
    const ax = t.x - c.x, az = t.z - c.z, L = Math.hypot(ax, az) || 1, ux = ax / L, uz = az / L;
    const isTeam = sides[0].length + sides[1].length > 2;
    const r = isTeam ? DUEL.ring.team : DUEL.ring.solo, now = this.time;
    const d = {
      id: this.id(), rule, team: isTeam, state: 'count', at: now, liveAt: now + DUEL.count, endAt: now + DUEL.count + (isTeam ? DUEL.time.team : DUEL.time.solo),
      x, z, r, floor: fl, f: new Map(), won: null, doneAt: 0, names: [c.name, t.name],
    };
    this.duelMap().set(d.id, d);
    for (const [side, list] of sides.entries()) {
      list.forEach((o, k) => {
        o.duelAsk = null;
        d.f.set(o.id, { id: o.id, side, mob: 0, out: false, why: '', by: 0, hp0: o.hp, outT: 0, name: o.name });
        o.duel = d.id;
        // too far from the centre (team duels gather everyone): line up on your side, facing the other
        if (dist(o, d) > r - 3) {
          const sgn = side ? 1 : -1, off = (k - (list.length - 1) / 2) * 2.2;
          let [px, pz] = resolveCollision(x + ux * DUEL.spread * sgn - uz * off, z + uz * DUEL.spread * sgn + ux * off, 0.5);
          if (!walkable(px, pz)) [px, pz] = [side ? t.x : c.x, side ? t.z : c.z];
          this.teleport(o, px, pz);
        }
      });
    }
    const R = DUEL_RULES[rule], vs = isTeam ? `${sides[0].map(o => o.name).join(', ')} vs ${sides[1].map(o => o.name).join(', ')}` : `${c.name} vs ${t.name}`;
    this.events.push({ t: 'duel', s: 'start', id: d.id, rule, team: isTeam ? 1 : 0, d: DUEL.count, vs });
    for (const id of d.f.keys()) this.sys(`Duel! ${vs} (${R.name}). Stay inside the ring.`, id);
    return d;
  },

  // ---------- stand-ins ----------
  duelTick(m) { m.moving = false; return false; }, // (updateMob; updateDuels keeps them on their owners)
  duelProxy(d, f, p) {
    let m = f.mob ? this.mobs.get(f.mob) : null;
    if (!m) {
      m = this.addMob('duelist', p.x, p.z);
      Object.assign(m, { threat: new NoThreat(), contributors: new NoCredit(), duelOf: p.id, duelId: d.id });
      f.mob = m.id;
    }
    m.x = p.x; m.z = p.z; m.face = p.face; m.hp = Math.max(1, p.hp); m.maxHp = p.maxHp; m.dead = false; m.hidden = false;
    m.stunUntil = 0; m.staggerUntil = 0; m.windupAt = 0;
    return m;
  },
  dropProxy(f) {
    if (!f.mob) return;
    this.mobs.delete(f.mob);
    f.mob = 0;
  },
  // Can the player acting right now (this._duelAtk, set around useSkill) target this stand-in? Outside a skill press
  // (projectiles in flight, traps): yes, and duelHit sorts it out.
  duelTargetable(m) {
    const a = this._duelAtk, v = this.players.get(m.duelOf);
    if (!v) return false;
    return !a || !!this.duelPair(a, v);
  },

  // ---------- hits ----------
  // A hit on a stand-in: damage to its owner when the attacker is a live opponent, nothing otherwise.
  duelHit(m, p, base, opts = {}) {
    const v = this.players.get(m.duelOf), pair = v && this.duelPair(p, v);
    if (!pair || p.dead || v.dead) return;
    const { d, fv } = pair, R = DUEL_RULES[d.rule];
    const crit = Math.random() < (p.crit ?? 0.1), counter = this.counterHit?.(p);
    const amount = Math.max(1, Math.round((Number(base) || 0) * DUEL.pvp * (crit ? 1.5 : 1) * (counter ? 1.5 : 1)));
    p.lastCombat = this.time;
    const hp0 = v.hp;
    this.damagePlayer(v, amount, { src: 'duel', duel: p });
    const lost = hp0 - v.hp;
    if (lost <= 0) return;
    this.events.push({ t: 'hit', id: m.id, a: lost, c: crit ? 1 : 0, by: p.id, sw: 0, h: opts.heavy ? 1 : 0, du: 1 });
    if (R.first || v.hp <= this.duelFloor(v, R)) this.duelOut(d, fv, 'rule', p);
  },
  duelFloor(p, R) { return Math.max(1, Math.ceil(p.maxHp * (R.floor || 0))); },

  // ---------- every tick ----------
  updateDuels() {
    const D = this.duelMap();
    if (!D.size) return;
    const t = this.time;
    for (const d of [...D.values()]) {
      if (d.state === 'done') { if (t - d.doneAt > DUEL.linger) D.delete(d.id); continue; }
      if (d.state === 'count' && t >= d.liveAt) {
        d.state = 'live';
        this.events.push({ t: 'duel', s: 'fight', id: d.id });
      }
      for (const f of d.f.values()) {
        if (f.out) continue;
        const p = this.players.get(f.id);
        if (!p || p.duel !== d.id) { this.duelOut(d, f, 'left'); continue; }
        if (p.dead || p.downed) { this.duelOut(d, f, 'fell'); continue; }
        if (floorOf(p.x) !== d.floor) { this.duelOut(d, f, 'fled'); continue; }
        if (dist(p, d) > d.r) {
          if (!f.outT) { f.outT = t; this.events.push({ t: 'duel', s: 'ring', id: d.id, pid: p.id, d: DUEL.grace }); this.sys(`Back inside the ring or you forfeit (${DUEL.grace} s)!`, p.id); }
          else if (t - f.outT >= DUEL.grace) { this.duelOut(d, f, 'fled'); continue; }
        } else f.outT = 0;
        if (d.state === 'live') this.duelProxy(d, f, p);
      }
      if (d.state === 'done') continue; // (a duelOut above may have ended it)
      if (t >= d.endAt) {
        const R = DUEL_RULES[d.rule];
        const sides = [0, 1].map(s => [...d.f.values()].filter(f => f.side === s).map(f => { const p = this.players.get(f.id); return { out: f.out || !p, hp: p ? Math.max(0, p.hp - this.duelFloor(p, R) + 1) : 0, maxHp: p ? Math.max(1, p.maxHp - this.duelFloor(p, R) + 1) : 1 }; }));
        this.duelEnd(d, decideOnTime(sides), 'time');
      }
    }
  },
  duelOut(d, f, why, by = null) {
    if (f.out || d.state === 'done') return;
    f.out = true; f.why = why; f.by = by?.id || 0;
    this.dropProxy(f);
    this.events.push({ t: 'duel', s: 'out', id: d.id, pid: f.id, why, by: f.by });
    const text = `${f.name} ${why === 'rule' && by ? `was beaten by ${by.name}` : OUT_TEXT[why] || 'is out'}.`;
    for (const id of d.f.keys()) this.sys(text, id);
    const left = [0, 1].map(s => [...d.f.values()].some(o => o.side === s && !o.out));
    if (!left[0] || !left[1]) this.duelEnd(d, left[0] ? 0 : left[1] ? 1 : -1, why);
  },
  duelEnd(d, won, why) {
    if (d.state === 'done') return;
    d.state = 'done'; d.won = won; d.doneAt = this.time;
    const R = DUEL_RULES[d.rule], side = s => [...d.f.values()].filter(f => f.side === s);
    for (const f of d.f.values()) {
      this.dropProxy(f);
      const p = this.players.get(f.id);
      if (!p || p.duel !== d.id) continue;
      p.duel = null;
      if (!p.dead) p.hp = Math.max(1, Math.min(p.maxHp, Math.max(p.hp, f.hp0))); // the health you came in with
      this.bumpStat?.(p, 'duels');
      if (won === f.side) this.bumpStat?.(p, 'duelWins');
    }
    const who = s => (d.team ? `${side(s)[0]?.name}'s side` : side(s)[0]?.name || '?');
    const text = won < 0 ? `The duel between ${who(0)} and ${who(1)} ended in a draw${why === 'time' ? ' (time)' : ''}.`
      : `${who(won)} won a ${d.team ? 'team ' : ''}duel against ${who(1 - won)} (${R.name}${why === 'time' ? ', on time' : ''}).`;
    this.events.push({ t: 'duel', s: 'end', id: d.id, won, why, text, win: won < 0 ? [] : side(won).map(f => f.id) });
    this.sys(text);
    const tp = this.players.get(side(0)[0]?.id) || this.players.get(side(1)[0]?.id);
    if (tp) this.track?.(tp, 'duel', { rule: d.rule, team: d.team ? 1 : 0, n: d.f.size, won, why, secs: Math.round(this.time - d.at) });
  },

  duelsSnap() {
    const D = this.duels;
    if (!D?.size) return undefined; // (JSON.stringify leaves the key out)
    const t = this.time, out = [];
    for (const d of D.values()) {
      const left = d.state === 'count' ? d.liveAt - t : d.state === 'live' ? d.endAt - t : 0;
      out.push([d.id, DUEL_RULE_IDS.indexOf(d.rule), STATE[d.state], r1(Math.max(0, left)), r2(d.x), r2(d.z), d.r,
        [...d.f.values()].map(f => [f.id, f.side, f.mob || 0, f.out ? 1 : 0]), d.state === 'done' ? d.won : null]);
    }
    return out;
  },
};

export function installDuels(Game) {
  const P = Game.prototype;
  Object.assign(P, DuelMethods);
  const wrap = (name, fn) => { const orig = P[name]; if (!orig) return; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // A stand-in takes no part in the rest of damageMob: duelHit decides.
  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    if (m?.def?.duel) return this.duelHit(m, p, base, opts);
    return orig.call(this, m, p, base, opts);
  });
  // Duel hits never take a fighter below the rule's floor (1 health at least: no deaths, no downs).
  wrap('damagePlayer', function (orig, p, base, opts = {}) {
    if (!opts?.duel || !p) return orig.call(this, p, base, opts);
    const d = this.duelOf(p), was = p.protectFrac;
    if (d) p.protectFrac = Math.max(was || 0, DUEL_RULES[d.rule].floor || 1e-9);
    try { return orig.call(this, p, base, opts); } finally { p.protectFrac = was; }
  });
  wrap('attackerOf', function (orig, p, src, mob) { return src === 'duel' ? null : orig.call(this, p, src, mob); }); // (a perfect dodge or parry against a duelist breaks no monster's posture)
  wrap('targetable', function (orig, m) { return m?.def?.duel ? !!m && !m.dead && this.duelTargetable(m) : orig.call(this, m); });
  wrap('useSkill', function (orig, p, ...a) {
    const prev = this._duelAtk;
    this._duelAtk = p;
    try { return orig.call(this, p, ...a); } finally { this._duelAtk = prev; }
  });
  // Only your own side (or you) can heal you mid-duel.
  wrap('healPlayer', function (orig, tg, amount, by, sk) {
    const d = this.duelOf(tg);
    if (d && d.state !== 'done' && by && by !== tg) { const fb = d.f.get(by.id), ft = d.f.get(tg.id); if (!fb || !ft || fb.side !== ft.side) return 0; }
    return orig.call(this, tg, amount, by, sk);
  });
  wrap('update', function (orig, ...a) { const out = orig.apply(this, a); this.updateDuels(); return out; });
  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'duel' && p) {
      const op = String(msg.op || '');
      if (op === 'ask') return this.duelAsk(p, { id: msg.id | 0, name: msg.name, rule: String(msg.rule || DUEL_DEFAULT), team: !!msg.team });
      if (op === 'accept') return this.duelAccept(p);
      if (op === 'decline') return this.duelDecline(p);
      if (op === 'cancel') return this.duelCancel(p);
      if (op === 'yield') return this.duelYield(p);
      return;
    }
    const c = msg?.type === 'chat' && p ? parseDuelChat(msg.text) : null;
    if (c) { // (never shown as chat)
      if (c.op === 'help') { for (const line of DUEL_HELP) this.sys(line, p.id); return; }
      if (c.op === 'ask') return this.duelAsk(p, c);
      return this.handle(p, { type: 'duel', op: c.op });
    }
    return orig.call(this, p, msg);
  });
}
