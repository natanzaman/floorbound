// Post-fight MVP card (docs/ROADMAP.md G5), mixed into Game by installMvp (end of game.js, after the team play).
//  - When a boss fight ends (the Warden's or the Sovereign's, kill or wipe), its per-fight team counters (teamStat,
//    server/teamplay.js: f.team) become a card (shared/mvp.js buildCard): each fighter's damage, healing, damage tanked,
//    Switches, Breaks, combos, Team Bursts, revives, saves, Covers, Pincers, mechanics, Last Attack, downs and deaths,
//    with fun titles and an MVP. Event { t: 'mvp', ids, d, card }: every fighter (ids) sees the same card after d s.
//  - Also counted here: `down` (goDown) and `death` (killPlayer) per fighter.
//  - A director show (F2) gets no card unless a cue asks for it: the card is still built (and tracked) and kept as
//    game.lastCard; showMvp({ secs }) (director verb `mvp`) sends it to everyone, spectators included (all: 1).
//  - The tracking row of the fight (server/trackgame.js 'fight') carries a compact copy (mvpCard caches it on the fight).
// TEST_HOOKS { type: 'test', mvpCard } sends a given card to that player (screenshots).
import { buildCard, compactCard } from '../shared/mvp.js';

export const MVP = { delay: { kill: 5, wipe: 3 }, minSecs: 5 }; // seconds before the card shows; shorter fights get none

const meta = p => ({ name: p.name, cls: p.cls, bot: !!p.bot, lvl: p.lvl });

const methods = {
  // The card for fight f (built once, cached on it), or null when nobody really fought.
  mvpCard(floor, f, result, m) {
    if (!f) return null;
    if (f.card !== undefined) return f.card;
    const ids = new Set([...(f.ids || []), ...(f.team?.keys() || [])]);
    const rows = [];
    for (const id of ids) {
      const p = this.players.get(id), info = p ? meta(p) : f.meta?.get(id);
      if (!info) continue;
      rows.push({ id, ...info, ...(f.team?.get(id) || {}) });
    }
    const secs = Math.round(this.time - f.start);
    if (!rows.length || !rows.some(r => r.dmg > 0) || secs < MVP.minSecs) return (f.card = null);
    return (f.card = buildCard({ boss: m?.def?.name || (floor === 3 ? 'The Storm Colossus' : floor === 2 ? 'The Drowned Sovereign' : 'The Horned Warden'), floor, result, secs, rows }));
  },
  mvpCompact(f) { return f?.card ? compactCard(f.card) : undefined; },
  // A fight ended: send its card to the fighters (not during a show).
  mvpEnd(floor, f, result, m) {
    const card = this.mvpCard(floor, f, result, m);
    if (!card) return;
    this.lastCard = card;
    if (this.director?.running) return; // film safety: only a cue shows it
    this.events.push({ t: 'mvp', ids: card.rows.map(r => r.id), d: MVP.delay[result] ?? 3, card });
  },
  // Director verb `mvp`: show the last fight's card to everyone (the film view too).
  showMvp({ secs } = {}) {
    if (!this.lastCard) return false;
    this.events.push({ t: 'mvp', ids: this.lastCard.rows.map(r => r.id), all: 1, d: 0, ...(secs ? { secs } : {}), card: this.lastCard });
    return true;
  },
};

export function installMvp(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; if (orig) P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  // Remember who was in the fight (a fighter who logs off before the end keeps their row).
  wrap('teamStat', function (orig, p, key, n) {
    const out = orig.call(this, p, key, n);
    const f = p && this.teamFightOf(p);
    if (f && !(f.meta ||= new Map()).has(p.id)) f.meta.set(p.id, meta(p));
    return out;
  });
  wrap('goDown', function (orig, p, ...a) {
    const out = orig.call(this, p, ...a);
    if (out && p.downed?.at === this.time) this.teamStat(p, 'down');
    return out;
  });
  wrap('killPlayer', function (orig, p, ...a) {
    if (p && !p.dead) this.teamStat(p, 'death');
    return orig.call(this, p, ...a);
  });
  for (const [floor, start, end, field] of [[1, 'startFight', 'endFight', 'fight'], [2, 'startFight2', 'endFight2', 'fight2'], [3, 'startFight3', 'endFight3', 'fight3']]) {
    wrap(start, function (orig, ...a) {
      const out = orig.apply(this, a), f = this[field];
      if (f) { f.meta = new Map(); for (const id of f.ids) { const p = this.players.get(id); if (p) f.meta.set(id, meta(p)); } }
      return out;
    });
    wrap(end, function (orig, result, m, ...a) {
      const f = this[field];
      const out = orig.call(this, result, m, ...a);
      if (f && !this[field]) this.mvpEnd(floor, f, result, m);
      return out;
    });
  }
  wrap('handle', function (orig, p, msg) {
    if (msg?.type === 'test' && process.env.TEST_HOOKS && msg.mvpCard && p) {
      this.events.push({ t: 'mvp', ids: [p.id], d: 0, card: msg.mvpCard });
      return;
    }
    return orig.call(this, p, msg);
  });
}
