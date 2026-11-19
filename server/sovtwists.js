// Sovereign twists: a random fight modifier rolled each time the Drowned Sovereign rises, like the Warden's
// (server/twists.js). Game methods mixed into Game.prototype (server/game.js); server/floor2.js calls them from small hooks
// (spawn / respawn, engage, Tidal Wave, geyser landing, kill) and reads this.sovS, the Sovereign's attack table for the
// current twist. Coral Hide's armour shares the Warden's Ironhide hooks (server/twists.js twistTaken / twistAfterHit).
// The table lives in shared/floor2.js (SOV_TWISTS). SOVEREIGN_TWIST=<id> forces one (tests).
import { SOVEREIGN, SOV_TWISTS, SOV_TWIST_IDS } from '../shared/floor2.js';
import { DROPS, SLOTS, makeItem, rollRarity } from '../shared/items.js';
import { rewardText } from '../shared/twists.js';

const r2 = v => Math.round(v * 100) / 100;

export const SovTwistMethods = {
  // Roll (or force) the twist for the next Sovereign fight. setTwistOverride('off') (server/staging.js) turns it off too.
  newTwist2() {
    const prev = this.twist2?.id, force = process.env.SOVEREIGN_TWIST;
    const id = this.twistOverride === 'off' ? null : SOV_TWISTS[force] ? force : (pool => pool[Math.floor(Math.random() * pool.length)])(SOV_TWIST_IDS.filter(k => k !== prev));
    this.setTwist2(id);
    if (!id) return;
    const T = SOV_TWISTS[id];
    this.sys(`The Drowned Sovereign stirs · Twist: ${T.name}. ${T.desc} Reward: ${rewardText(id, SOV_TWISTS)}.`);
    if (!this.twist2Logged) { this.twist2Logged = true; console.log(`Sovereign twist: ${id}`); }
  },

  // Set the twist and build this fight's attack table (this.sovS).
  setTwist2(id) {
    const T = SOV_TWISTS[id], S = { ...SOVEREIGN };
    this.twist2 = T ? { id, name: T.name } : null;
    if (id === 'hightide') { const w = S.wave.every; S.wave = { ...S.wave, every: [w[1] * T.wave.p0, w[1] * T.wave.mult, w[2] * T.wave.mult].map(r2) }; }
    if (id === 'drownedhost') S.thralls = { ...S.thralls, ...T.thralls };
    if (id === 'moonless') for (const [k, v] of Object.entries(SOVEREIGN)) if (v && typeof v.wind === 'number') S[k] = { ...v, wind: r2(v.wind * T.wind) };
    this.sovS = S;
    this.events.push({ t: 'twist2', id: id || null });
  },

  // Engage (f2Sovereign): per-twist timers. A filmed director show fights without one (its rehearsed fight).
  twistEngage2(m) {
    if (this.director?.running && this.twist2) this.setTwist2(null);
    const id = this.twist2?.id, T = SOV_TWISTS[id], t = this.time;
    if (id === 'hightide') m.waveT = t + T.wave.first;
    if (id === 'drownedhost') m.thrallT = t + T.thralls.first;
  },

  // tidalWave: Riptide sends a second wall of water from the same spot.
  twistWave2(m, w) {
    if (this.twist2?.id !== 'riptide') return;
    const gap = SOV_TWISTS.riptide.gap, w2 = { ...w, id: this.id(), start: w.start + gap, r: 0, hit: new Set(), ev: new Set() };
    this.waves.push(w2);
    m.busyUntil = Math.max(m.busyUntil, this.time + (w.start - this.time) + gap + 0.3);
    const W = this.sovS.wave;
    this.events.push({ t: 'f2wave', id: w2.id, by: m.id, x: r2(w2.x), z: r2(w2.z), d: r2(w2.start - this.time), sp: W.speed, w: W.width, max: w2.max, n: 2 });
  },

  // A geyser landed (f2Circle): Brackish leaves a mire pool there.
  twistGeyser2(x, z) {
    if (this.twist2?.id !== 'brackish') return;
    const P = SOVEREIGN.pools, t = this.time;
    if (this.pools.length >= P.max + 2) this.pools.shift();
    this.pools.push({ id: this.id(), x, z, r: P.r * 0.8, armAt: t + 0.4, until: t + SOV_TWISTS.brackish.life, next: t + 0.4 });
  },

  // killSovereign: the twist's reward bonus for everyone who fought.
  twistKill2(m, ids) {
    const id = this.twist2?.id, T = SOV_TWISTS[id];
    if (!T) return;
    const R = T.reward, D = DROPS.sovereign;
    for (const pid of ids) {
      const p = this.players.get(pid);
      if (!p) continue;
      const items = [];
      for (let i = 0; i < (R.loot || 0); i++) { // TODO(H2): roll from the Sovereign's set table once shared/loot.js lands
        const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
        const it = makeItem(slot, rollRarity(D.table), p.cls, Math.random, undefined, 'roll');
        if (this.giveItem(p, it)) items.push({ name: it.name, r: it.r });
        if (it.r >= 2) this.track(p, 'loot', { r: it.r, slot, mob: 'sovereign', twist: id });
      }
      const gold = R.gold ? Math.round(((D.gold[0] + D.gold[1]) / 2) * R.gold) : 0;
      p.gold += gold;
      this.events.push({ t: 'loot', to: p.id, x: r2(m.x), z: r2(m.z), g: gold, items, pot: 0 });
      this.sys(`Twist bonus (${T.name}): ${[items.length && `+${items.length} item${items.length > 1 ? 's' : ''}`, gold && `+${gold} gold`].filter(Boolean).join(', ')}`, p.id);
      this.invChanged(p);
    }
  },
};
