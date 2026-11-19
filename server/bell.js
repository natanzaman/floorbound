// The Tower Bell (ROADMAP F6): the first clear of a floor on this server rings a bell for everyone, on every floor.
// recordClear / recordClear2 ring it with { auto: true }; the scene director holds the automatic ring
// (game.bellAuto = false) and rings it by hand. Event: { t: 'bell', floor, n } (n = bells rung on this server so far).
import { bellBanner } from '../shared/bell.js';

export const BellMethods = {
  bellAuto: true, // instance assignment (game.bellAuto = false) shadows this default

  ringBell(floor, { auto = false } = {}) {
    floor = Math.max(1, floor | 0 || 1);
    if (auto && !this.bellAuto) return false;
    this.bellsRung = (this.bellsRung || 0) + 1;
    this.events.push({ t: 'bell', floor, n: this.bellsRung });
    const [title, line] = bellBanner(floor);
    this.sys(`${title[0]}${title.slice(1).toLowerCase()} tolls across the tower. ${line}`);
    return true;
  },
};

export function installBell(Game) {
  Object.assign(Game.prototype, BellMethods);
  // Testing aid (TEST_HOOKS=1 only): { type: 'test', clear: 1 | 2 | 3 } kills that floor's boss at once, credited to the
  // sender, with every player on the server as a fighter (a scripted clear for the bell and engraved-Hall checks).
  const handle = Game.prototype.handle;
  Game.prototype.handle = function (p, msg) {
    if (msg?.type === 'test' && process.env.TEST_HOOKS && [1, 2, 3].includes(msg.clear) && p) {
      const m = [...this.mobs.values()].find(m => m.type === ({ 1: 'warden', 2: 'sovereign', 3: 'colossus' })[msg.clear] && !m.dead);
      if (!m) return;
      for (const q of this.players.values()) m.contributors.add(q.id);
      return this.killMob(m, p);
    }
    return handle.call(this, p, msg);
  };
}
