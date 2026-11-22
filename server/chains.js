// Skill chains (docs/briefs/combos-visuals.md A), mixed into Game by installChains (end of game.js, after the team play,
// before the duels and the pacing). Rules and tables: shared/chains.js.
//  - damageMob: a player's hit is a step (stepOf); a step that links raises the chain (event 'chain'), a named art adds a
//    posture chunk on that hit, x3+ takes CHAIN.refund s off the other skills' cooldowns, x4 completes the chain.
//    Every hit while the chain is live deals chainMult more. A combo's or the Team Burst's own damage (_tbIn) is never a step.
//  - useSkill: support skills (SUPPORT: no hit by design) are a step when used (their cooldown started).
//  - update: { t: 'chainEnd', id } once a chain of x2+ lapses.
// Events: { t: 'chain', id, n, k (art id or ''), nm (art name or ''), s (step: skill id or 'fin'), x, z }.
// Duels have no chains (PvP stays even): duel hits go through stand-ins outside this wrapper, and nothing in a duel is a step.
// A slot skill's hits are its step only within STEP_LAG s of the press (p.chPress), so zones and traps ticking on are not.
import { CLASSES } from '../shared/data.js';
import { CHAIN, SUPPORT, STEP_LAG, stepOf, chainStep, chainMult } from '../shared/chains.js';

const r2 = v => Math.round(v * 100) / 100;

const methods = {
  // A step landed (or a support skill was used): advance p's chain. m: the enemy hit (null for support skills).
  // Returns the link (or null). at: when the step happened (a weapon swap is booked at its own time once a hit proves it).
  chainNote(p, k, m = null, at = this.time) {
    const t = this.time, { c, link } = chainStep(p.chain || null, p.cls, k, at);
    p.chain = c;
    if (!link) return null;
    const art = link.art;
    this.events.push({ t: 'chain', id: p.id, n: link.n, k: art?.id || '', nm: art?.name || '', s: k, x: r2(p.x), z: r2(p.z) });
    this.teamStat?.(p, 'chain');
    if (link.n >= 3) for (let s = 1; s < 4; s++) { // the other skills come back sooner
      const id = CLASSES[p.cls]?.skills[s]?.id;
      if (id && id !== k && p.cds[s] > t) p.cds[s] = Math.max(t, p.cds[s] - CHAIN.refund);
    }
    if (link.n >= CHAIN.max) this.teamStat?.(p, 'chainDone');
    const frac = link.n >= CHAIN.max && art?.frac ? art.frac.map((v, i) => v + CHAIN.doneFrac[i]) : art?.frac || (link.n >= CHAIN.max ? CHAIN.doneFrac : null);
    if (frac && m && this.targetable(m)) this.addPosture(m, p, 0, { frac });
    return link;
  },
  updateChains() {
    const t = this.time;
    for (const p of this.players.values()) {
      const c = p.chain;
      if (!c || c.bn < 2 || c.endSent || t < c.until) continue;
      c.endSent = true;
      this.events.push({ t: 'chainEnd', id: p.id });
    }
  },
};

export function installChains(Game) {
  const P = Game.prototype;
  Object.assign(P, methods);
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig, ...a); }; };

  wrap('damageMob', function (orig, m, p, base, opts = {}) {
    if (!p?.cls || this._tbIn || !this.targetable(m)) return orig.call(this, m, p, base, opts);
    const t = this.time;
    let k = this.duelOf?.(p) ? null : stepOf(p.cls, opts.sk || opts.tsk || p._tsk, opts.heavy);
    if (k && k !== 'fin' && !(t - (p.chPress?.[k] ?? -99) <= STEP_LAG)) k = null; // a zone / trap / mine ticking on later
    const mul = chainMult(p.chain, t);
    const ev0 = this.events.length;
    const out = orig.call(this, m, p, base * mul, opts);
    if (!k && !p.swapPend) return out;
    let landed = false;
    for (let i = ev0; i < this.events.length; i++) { const e = this.events[i]; if (e.t === 'hit' && e.id === m.id && e.by === p.id) { landed = true; break; } }
    if (landed && p.swapPend) this.swapLanded?.(p, m); // a weapon swap before this hit (server/weaponswap.js)
    if (landed && k) this.chainNote(p, k, m);
    return out;
  });

  wrap('useSkill', function (orig, p, slot, face) {
    const sk = CLASSES[p?.cls]?.skills[slot | 0], before = p?.cds?.[slot];
    // The press time goes in before the skill runs: instant skills (Rush, Whirl, Ground Slam...) land their hits inside
    // useSkill itself, so the step check in damageMob must already see this press. Put back if the skill didn't fire.
    const prev = sk ? p.chPress?.[sk.id] : undefined;
    if (sk) (p.chPress ||= {})[sk.id] = this.time;
    const out = orig.call(this, p, slot, face);
    if (sk && p.cds[slot] !== before && !p.dead) { // it was used
      if (SUPPORT.has(sk.id) && !this.duelOf?.(p)) this.chainNote(p, sk.id, null);
    } else if (sk) {
      if (prev === undefined) delete p.chPress[sk.id]; else p.chPress[sk.id] = prev;
    }
    return out;
  });

  wrap('update', function (orig, dt) { const out = orig.call(this, dt); this.updateChains(); return out; });
}
