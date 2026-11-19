// Boss team mechanics (docs/ROADMAP.md G4): shared meteor (stack), spread markers and tether, for the Warden and the
// Drowned Sovereign. Tuning in shared/bossteam.js. Mixed into Game (installBossTeam, after installStaging: it extends
// forceBossMove with 'meteor', 'spread', 'tether'). The bosses call bossTeam(m, fighters) from their rotations
// (game.js bossSpecials, floor2.js sovereignSpecials); nothing happens with fewer than BOSSTEAM.min fighters alive in
// the room, or while the director runs a show (only a cue's forceBossMove starts one then).
//
// Events: { t: 'bt', k: 'stack', id, r, d, boss } · { t: 'bt', k: 'spread', ids, r, d, boss } ·
//         { t: 'bt', k: 'tether', a, b, need, d, g, boss } (bots perceive these with their capability delays), and
//         { t: 'btend', k, ... } when each one resolves (stack: x, z, n; spread: ids, clean; tether: a, b, ok).
import { BOSSTEAM, TEAM_MOVES } from '../shared/bossteam.js';
import { inArena } from '../shared/data.js';
import { inArena2 } from '../shared/floor2.js';
import { inArena3 } from '../shared/floor3.js';

const r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const methods = {
  btRoom(m) { return m.type === 'colossus' ? inArena3 : m.type === 'sovereign' ? inArena2 : inArena; },
  btFighters(m) { const ring = this.btRoom(m); return [...this.players.values()].filter(p => !p.dead && ring(p.x, p.z)); },
  btFight(m) { return m.type === 'colossus' ? this.fight3 : m.type === 'sovereign' ? this.fight2 : this.fight; },
  btLive(m, key) { return !m.dead && m.engaged && this.btFight(m) === key; }, // still the same fight

  // A team-mechanic hit: a fraction of the victim's max HP through the normal damage rules (shields, damage reduction,
  // guard, protect), except that a roll's i-frames don't dodge it (it's about where you stand).
  btHit(p, frac, src) {
    if (!(frac > 0) || p.dead) return;
    const keep = p.iframeUntil;
    p.iframeUntil = 0;
    try { this.damagePlayer(p, frac * p.maxHp, { src }); } finally { if (keep > this.time && !p.dead) p.iframeUntil = keep; }
  },

  // ---------- the rotation (called every tick while the boss is fighting) ----------
  bossTeam(m, fighters) {
    const C = BOSSTEAM[m.type];
    if (!C) return;
    const t = this.time, key = this.btFight(m);
    if (m.btKey !== key) { m.btKey = key; m.btT = t + C.first; m.btI = Math.floor(Math.random() * 3); } // a new fight
    if (t < m.btT) return;
    fighters ||= this.btFighters(m);
    if (fighters.length < BOSSTEAM.min || this.director?.running || (this.btActive || []).some(a => a.m === m)) { m.btT = t + 2; return; }
    const list = C.moves[m.phase] || C.moves[0];
    m.btT = t + C.every[m.phase];
    this.btStart(m, list[m.btI++ % list.length], fighters, null);
  },

  // Start one now. forced: a target player id (or null). Returns false when it can't (a tether needs two fighters).
  btStart(m, k, fighters, targetId) {
    fighters = (fighters || this.btFighters(m)).filter(p => !p.dead);
    if (!fighters.length) return false;
    const first = targetId != null ? fighters.find(p => p.id === (targetId | 0)) : null;
    if (k === 'meteor') return this.btMeteor(m, first || fighters[Math.floor(Math.random() * fighters.length)]);
    if (k === 'spread') {
      const n = Math.min(fighters.length, BOSSTEAM.spread.n(fighters.length));
      const rest = shuffle(fighters.filter(p => p !== first));
      return this.btSpread(m, (first ? [first, ...rest] : rest).slice(0, n));
    }
    if (k === 'tether') {
      if (fighters.length < 2) return false;
      const a = first || fighters[Math.floor(Math.random() * fighters.length)];
      const b = fighters.filter(p => p !== a).sort((x, y) => dist(x, a) - dist(y, a))[0]; // its nearest partymate: the one in trouble
      return this.btTether(m, a, b);
    }
    return false;
  },

  // The boss channels a meteor or spread: its own circles, lanes, spins, rocks, Horn Sweep (Sovereign: geysers, waves,
  // volleys) wait until it has landed, so the mechanic reads clearly and standing in the right place is the whole job.
  // (Quake Rings and basic swings go on: you can jump or take a swing where you stand.)
  btChannel(m, secs) {
    const until = this.time + secs + BOSSTEAM.channel;
    for (const k of ['slamT', 'chargeT', 'spinT', 'rockT', 'sweepT', 'geyserT', 'waveT', 'volleyT', 'strikeT', 'gustT', 'beamT', 'ovT']) if (typeof m[k] === 'number' && m[k] < until) m[k] = until;
  },

  btAdd(a) { (this.btActive ||= []).push(a); return a; },
  btDone(a) { this.btActive = (this.btActive || []).filter(x => x !== a); },

  // ---------- shared meteor (stack) ----------
  btMeteor(m, v) {
    const M = BOSSTEAM.meteor, key = this.btFight(m);
    const a = this.btAdd({ k: 'meteor', m, id: v.id });
    this.events.push({ t: 'bt', k: 'stack', id: v.id, r: M.r, d: M.wind, boss: m.id });
    this.btChannel(m, M.wind);
    this.schedule(M.wind, () => {
      this.btDone(a);
      const p = this.players.get(a.id);
      if (!p || !this.btLive(m, key)) { this.events.push({ t: 'btend', k: 'stack', id: a.id, n: 0, off: 1 }); return; }
      const x = p.x, z = p.z, ring = this.btRoom(m);
      const inside = [...this.players.values()].filter(q => !q.dead && !q.downed && ring(q.x, q.z) && Math.hypot(q.x - x, q.z - z) <= M.r);
      const n = inside.length;
      this.events.push({ t: 'fx', k: 'boom', x: r2(x), z: r2(z), r: M.r });
      this.events.push({ t: 'btend', k: 'stack', id: a.id, x: r2(x), z: r2(z), r: M.r, n });
      for (const q of inside) {
        this.btHit(q, M.total / Math.pow(n, M.split), 'meteor');
        if (n >= 2) this.teamStat?.(q, 'mechanic');
      }
    });
    return true;
  },

  // ---------- spread markers ----------
  btSpread(m, carriers) {
    const S = BOSSTEAM.spread, key = this.btFight(m), ids = carriers.map(p => p.id);
    const a = this.btAdd({ k: 'spread', m, ids });
    this.events.push({ t: 'bt', k: 'spread', ids, r: S.r, d: S.wind, boss: m.id });
    this.btChannel(m, S.wind);
    this.schedule(S.wind, () => {
      this.btDone(a);
      if (!this.btLive(m, key)) { this.events.push({ t: 'btend', k: 'spread', ids, clean: [], off: 1 }); return; }
      const ring = this.btRoom(m);
      const cs = ids.map(id => this.players.get(id)).filter(p => p && !p.dead && !p.downed); // a downed carrier's marker fizzles
      const live = [...this.players.values()].filter(q => !q.dead && !q.downed && ring(q.x, q.z));
      const hits = new Map(live.map(q => [q, cs.filter(c => c !== q && dist(c, q) <= S.r).length])); // decide first, then hurt
      const clean = cs.filter(c => !live.some(q => q !== c && dist(c, q) <= S.r));
      for (const c of cs) this.events.push({ t: 'fx', k: 'boom', x: r2(c.x), z: r2(c.z), r: S.r });
      this.events.push({ t: 'btend', k: 'spread', ids, clean: clean.map(c => c.id) });
      for (const [q, h] of hits) this.btHit(q, h * S.hit + (cs.includes(q) ? S.self : 0), 'spread');
      for (const c of clean) this.teamStat?.(c, 'mechanic');
    });
    return true;
  },

  // ---------- tether ----------
  btTether(m, pa, pb) {
    const T = BOSSTEAM.tether, key = this.btFight(m), t0 = this.time;
    const a = this.btAdd({ k: 'tether', m, a: pa.id, b: pb.id });
    this.events.push({ t: 'bt', k: 'tether', a: pa.id, b: pb.id, need: T.need, d: T.max, g: T.grace, boss: m.id });
    const end = (ok, extra = {}) => { this.btDone(a); this.events.push({ t: 'btend', k: 'tether', a: pa.id, b: pb.id, ok: ok ? 1 : 0, ...extra }); };
    const step = () => {
      const A = this.players.get(pa.id), B = this.players.get(pb.id);
      if (!this.btLive(m, key)) return end(false, { off: 1 });
      if (!A || !B || A.dead || B.dead || A.downed || B.downed) return end(false, { off: 1 }); // either end down: the tether breaks
      if (dist(A, B) >= T.need) { this.teamStat?.(A, 'mechanic'); this.teamStat?.(B, 'mechanic'); return end(true); }
      if (this.time - t0 >= T.max - 1e-6) return end(false);
      if (this.time - t0 >= T.grace - 1e-6) { this.btHit(A, T.dmg, 'tether'); this.btHit(B, T.dmg, 'tether'); }
      this.schedule(T.tick, step);
    };
    this.schedule(T.tick, step);
    return true;
  },
};

export function installBossTeam(Game) {
  Object.assign(Game.prototype, methods);
  // forceBossMove (server/staging.js) gains the team moves: start one now, aimed at the target (the meteor's carrier,
  // the first spread marker, one end of the tether). Works for the Warden and the Sovereign, solo included (except a
  // tether, which needs two fighters).
  const base = Game.prototype.forceBossMove;
  Game.prototype.forceBossMove = function (mob, move, targetId) {
    if (!TEAM_MOVES.includes(move)) return base.call(this, mob, move, targetId);
    const m = this.mobRef(mob);
    if (!m || m.dead || !BOSSTEAM[m.type]) return false;
    return this.btStart(m, move, null, targetId ?? null);
  };
}
