// Play tracking hooks on Game (installTracking near the end of game.js). Storage and queries: server/track.js.
//  - fightCtx(p): extra fields for a death row (boss floor, phase, Warden twist) when p dies in a boss fight; also
//    counts the death as a player or bot death for that fight.
//  - quitCtx(p): extra fields for session_end (zone, floor, class, style, party size, bots in the party).
//  - One 'fight' row per boss fight (both floors), whoever was in it (bots too): who fought (party key, classes,
//    humans vs bots), result, time, phase, twist, deaths split by players / bots. Wrapped around start/endFight(2).
// Bots' own rows are kept out of play tracking by BotManager (except deaths, recorded as 'bot_death').
import { inArena, areaName } from '../shared/data.js';
import { inArena2, floorOf } from '../shared/floor2.js';
import { defaultStyle } from '../shared/styles.js';

const who = p => ({ bot: !!p.bot, cls: p.cls, key: p.charId ? `c${p.charId}` : `s${p.sid}`, lvl: p.lvl });

const TrackMethods = {
  activeFightOf(p) {
    if (this.fight && this.boss && (this.fight.ids.has(p.id) || inArena(p.x, p.z))) return [1, this.fight, this.boss];
    if (this.fight2 && this.sovereign && (this.fight2.ids.has(p.id) || inArena2(p.x, p.z))) return [2, this.fight2, this.sovereign];
    return null;
  },
  fightCtx(p) {
    const a = this.activeFightOf(p);
    if (!a) return {};
    const [boss, f, m] = a;
    if (p.bot) f.bd = (f.bd || 0) + 1; else f.hd = (f.hd || 0) + 1;
    return { boss, phase: m.phase | 0, ...(boss === 1 && this.twist ? { twist: this.twist.id } : {}) };
  },
  quitCtx(p) { return p.quitAt || this.quitNow(p); },
  quitNow(p) {
    const pa = p.party && this.parties.get(p.party);
    const mates = pa ? pa.members.map(id => this.players.get(id)).filter(Boolean) : [];
    return { zone: areaName(p.x, p.z), floor: floorOf(p.x), cls: p.cls, style: p.style || defaultStyle(p.cls), party: mates.length || 1, pbots: mates.filter(q => q.bot).length };
  },
  trackFightStart(f) {
    if (f) f.who = [...f.ids].map(id => this.players.get(id)).filter(Boolean).map(who);
  },
  trackFight(floor, f, result, m) {
    if (!f) return;
    const w = f.who || [], hum = w.filter(x => !x.bot), bots = w.filter(x => x.bot);
    this.track(null, 'fight', {
      floor, result, secs: Math.round(this.time - f.start), phase: m.phase | 0, hpLeft: result === 'wipe' ? Math.round((m.hp / m.maxHp) * 100) : 0,
      ...(floor === 1 && this.twist ? { twist: this.twist.id } : {}),
      humans: hum.length, bots: bots.length, deaths: f.hd || 0, botDeaths: f.bd || 0,
      party: hum.map(x => x.key).sort(), cls: hum.map(x => x.cls).sort(), botCls: bots.map(x => x.cls).sort(),
      lvl: hum.length ? Math.round(hum.reduce((s, x) => s + x.lvl, 0) / hum.length) : Math.round(bots.reduce((s, x) => s + x.lvl, 0) / (bots.length || 1)),
    });
  },
};

export function installTracking(Game) {
  Object.assign(Game.prototype, TrackMethods);
  const P = Game.prototype;
  const rm = P.removePlayer; // removePlayer leaves the party before session_end: note the party first
  P.removePlayer = function (p, ...a) { try { p.quitAt = this.quitNow(p); } catch {} return rm.call(this, p, ...a); };
  for (const [floor, start, end, field] of [[1, 'startFight', 'endFight', 'fight'], [2, 'startFight2', 'endFight2', 'fight2']]) {
    const s = P[start], e = P[end];
    if (!s || !e) continue;
    P[start] = function (...a) { const r = s.apply(this, a); this.trackFightStart(this[field]); return r; };
    P[end] = function (result, m, ...a) { const f = this[field]; const r = e.call(this, result, m, ...a); if (f && !this[field]) this.trackFight(floor, f, result, m); return r; };
  }
}
