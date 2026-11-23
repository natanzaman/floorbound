// Residents (shared/residents.js, docs/briefs/bot-days.md "Residents"): the server's own bots, kept while at least one
// player is online. Each lives its own day (behaviour `own`): nobody's creation, anyone may invite one, and like any
// server bot an admin may remove one (it stays out RESIDENT_AWAY seconds, then comes back).
//
//   presence  a player online: the missing ones join, one every tick (no burst), on the floor most players are on, at
//             a share of the top online player's level, in that level's premade gear (server/playerbots.js
//             premadeOutfit). Nobody online for RESIDENT_GRACE seconds: they all leave, and nothing is saved.
//   who       its personality is rolled from its own name, even if that name was taken and it joined as "Pip 2".
//   counts    toward MAX_BOTS; with the bot limit reached a resident waits for a free slot.
import { RESIDENTS, RESIDENT_GRACE, RESIDENT_AWAY, residentCount, residentLevel } from '../shared/residents.js';
import { CLASSES, walkable, resolveCollision } from '../shared/data.js';
import { floorOf, WAYPOINTS } from '../shared/floor2.js';
import { rollPersonality } from '../shared/bots/personality.js';
import { daysEnabled } from '../shared/bots/day.js';
import { premadeOutfit } from './playerbots.js';

export class Residents {
  // opts (tests): n (how many), now, interval (ms between ticks; 0 = none, the test ticks), grace and away (s; also
  // RESIDENT_GRACE_S and RESIDENT_AWAY_S, for live tests)
  constructor(game, mgr, { n = residentCount(), now = Date.now, interval = 2000, grace = Number(process.env.RESIDENT_GRACE_S) || RESIDENT_GRACE, away = Number(process.env.RESIDENT_AWAY_S) || RESIDENT_AWAY } = {}) {
    this.game = game; this.mgr = mgr; this.now = now; this.grace = grace; this.away = away;
    this.list = RESIDENTS.slice(0, n).filter(r => CLASSES[r.cls]).map(def => ({ def, e: null, outAt: 0, placed: false }));
    this.emptyAt = 0;
    this.ours = false; // (true while we remove one ourselves: anything else removing one is an admin)
    game.residents = this;
    const remove = mgr.remove.bind(mgr), removeAll = mgr.removeAll.bind(mgr);
    mgr.remove = bid => { if (!this.ours) this.removedBy(e => e.bid === bid); return remove(bid); };
    mgr.removeAll = () => { this.removedBy(() => true); return removeAll(); };
    if (interval && this.list.length) { this.timer = setInterval(() => this.upkeep(), interval); this.timer.unref?.(); }
  }

  humans() { return this.mgr.realPlayers(); }
  live() { return this.list.filter(st => st.e && !st.e.b.closed && this.mgr.bots.includes(st.e)); }

  // An admin removed one (the Bots tab, or "remove all"): out for a while, then back.
  removedBy(match) {
    for (const st of this.list) if (st.e && match(st.e)) { st.e = null; st.placed = false; st.outAt = this.now(); }
  }

  upkeep() { try { this.tick(); } catch (e) { console.error('[residents]', e); } }
  tick() {
    const t = this.now(), hs = this.humans();
    for (const st of this.list) if (st.e && (st.e.b.closed || !this.mgr.bots.includes(st.e))) { st.e = null; st.placed = false; } // (its socket closed: it rejoins)
    if (!hs.length) {
      this.emptyAt ||= t;
      if (t - this.emptyAt >= this.grace * 1000) this.leaveAll();
      return;
    }
    this.emptyAt = 0;
    for (const st of this.list) if (st.e && !st.placed) this.settle(st, hs); // joined since the last tick: gear and a spot
    const next = this.list.find(st => !st.e && t - st.outAt >= this.away * 1000);
    if (next && this.mgr.count() < this.mgr.max) this.spawn(next, hs);
  }

  spawn(st, hs) {
    const d = st.def, top = Math.max(...hs.map(h => h.lvl || 1));
    const name = this.mgr.uniqueName(d.name); // (a player called Pip: this one joins as "Pip 2", with Pip's personality)
    const [view] = this.mgr.start([d.cls], [name], { lvl: residentLevel(top, d.share), behaviour: daysEnabled() ? 'own' : 'field', follow: '', skill: d.skill, join: { f2: 1, f3: 1 } });
    const e = this.mgr.bots.find(x => x.bid === view.bid);
    e.resident = d.name; e.creator = null; e.allow = [];
    e.b.persona = rollPersonality(d.name); // (its own, whatever name it joined under)
    st.e = e; st.placed = false; st.outAt = 0;
  }

  // In the world: the premade gear for its level, and a spot by the waypoint of the floor most players are on.
  settle(st, hs) {
    const p = this.mgr.livePlayer(st.e);
    if (!p) return;
    premadeOutfit(this.game, p);
    const n = {};
    for (const h of hs) n[floorOf(h.x)] = (n[floorOf(h.x)] || 0) + 1;
    const fl = +Object.keys(n).sort((a, b) => n[b] - n[a] || a - b)[0] || 1;
    const w = WAYPOINTS.find(x => x.floor === fl) || WAYPOINTS[0];
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 5;
      const [x, z] = resolveCollision(w.x + Math.sin(a) * r, w.z + Math.cos(a) * r);
      if (walkable(x, z, true)) { this.game.teleport(p, x, z); break; }
    }
    st.placed = true;
  }

  leaveAll() {
    this.ours = true;
    try { for (const st of this.list) if (st.e) { this.mgr.remove(st.e.bid); st.e = null; st.placed = false; } } finally { this.ours = false; }
    this.game.rosterDirty = true;
  }

  // For the admin page and tests: who is in, and who is out for a while.
  status() {
    const t = this.now();
    return this.list.map(st => ({ name: st.def.name, cls: st.def.cls, skill: st.def.skill, in: !!st.e, as: st.e?.b.name || '', away: st.outAt && !st.e ? Math.max(0, Math.ceil((this.away * 1000 - (t - st.outAt)) / 1000)) : 0 }));
  }
}

export const residentsOn = (env = process.env) => residentCount(env) > 0;
