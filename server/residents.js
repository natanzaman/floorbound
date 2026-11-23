// Residents (shared/residents.js, docs/briefs/bot-days.md "Residents"): the server's own bots, kept while at least one
// player is online. Each lives its own day (behaviour `own`): nobody's creation, anyone may invite one, and like any
// server bot an admin may remove one (it stays out RESIDENT_AWAY seconds, then comes back).
//
//   presence  a player online: the missing ones join, one every tick (no burst), on the floor most players are on, at
//             a share of the top online player's level, in that level's premade gear (server/playerbots.js
//             premadeOutfit). Nobody online for RESIDENT_GRACE seconds: they all leave, and nothing is saved.
//   who       its personality is rolled from its own name, even if that name was taken and it joined as "Pip 2".
//   counts    toward MAX_BOTS, leaving RESIDENT_RESERVE slots to the players' own bots; a resident waits for a free slot.
//   parked    while a director show is filmed (as the Named): they all leave, and come back after it.
//   tracked   by bid, so an admin's "Respawn as…" (server/botedit.js, same bid, new entry) keeps it a resident.
import { RESIDENTS, RESIDENT_GRACE, RESIDENT_AWAY, RESIDENT_REJOIN, RESIDENT_RESERVE, residentCount, residentLevel } from '../shared/residents.js';
import { CLASSES, walkable, resolveCollision } from '../shared/data.js';
import { floorOf, WAYPOINTS } from '../shared/floor2.js';
import { rollPersonality } from '../shared/bots/personality.js';
import { daysEnabled } from '../shared/bots/day.js';
import { premadeOutfit } from './playerbots.js';

export class Residents {
  // opts (tests): n (how many), now, interval (ms between ticks; 0 = none, the test ticks), grace and away (s; also
  // RESIDENT_GRACE_S and RESIDENT_AWAY_S, for live tests)
  constructor(game, mgr, { n = residentCount(), now = Date.now, interval = 2000, grace = envS('RESIDENT_GRACE_S', RESIDENT_GRACE), away = envS('RESIDENT_AWAY_S', RESIDENT_AWAY) } = {}) {
    this.game = game; this.mgr = mgr; this.now = now; this.grace = grace; this.away = away;
    // per resident: e (its BotManager entry, looked up by bid each tick), back (no rejoin before this time), geared and
    // placed (its premade gear on; set down by the players' waypoint)
    this.list = RESIDENTS.slice(0, n).filter(r => CLASSES[r.cls]).map(def => ({ def, bid: 0, e: null, back: 0, geared: false, placed: false }));
    this.emptyAt = 0;
    this.ours = false; // (true while we remove one ourselves: anything else removing one is an admin)
    game.residents = this;
    const remove = mgr.remove.bind(mgr), removeAll = mgr.removeAll.bind(mgr);
    mgr.remove = bid => { if (!this.ours) this.removedBy(e => e.bid === bid); return remove(bid); };
    mgr.removeAll = () => { this.removedBy(() => true); return removeAll(); };
    if (interval && this.list.length) { this.timer = setInterval(() => this.upkeep(), interval); this.timer.unref?.(); }
  }

  humans() { return this.mgr.realPlayers(); }
  out(st, wait = 0) { st.bid = 0; st.e = null; st.geared = st.placed = false; st.back = wait ? this.now() + wait * 1000 : 0; }

  // An admin removed one (the Bots tab, or "remove all"): out for a while, then back.
  removedBy(match) {
    for (const st of this.list) if (st.e && match(st.e)) this.out(st, this.away);
  }

  // Each tick: find each one's entry by its bid (a respawn swaps the entry: gear goes on again, it stays where it is);
  // one whose socket closed rejoins after RESIDENT_REJOIN (a join that keeps failing does not spin).
  refresh() {
    for (const st of this.list) {
      if (!st.bid) continue;
      const e = this.mgr.bots.find(x => x.bid === st.bid && !x.b.closed);
      if (!e) { this.out(st, RESIDENT_REJOIN); continue; }
      if (e !== st.e) { if (st.e) st.geared = false; st.e = e; e.resident = st.def.name; }
    }
  }

  upkeep() { try { this.tick(); } catch (e) { console.error('[residents]', e); } }
  tick() {
    const t = this.now(), hs = this.humans();
    this.refresh();
    if (this.game.director?.running) return this.leaveAll(); // a show is being filmed (server/named.js parks the Named too)
    if (!hs.length) {
      this.emptyAt ||= t;
      if (t - this.emptyAt >= this.grace * 1000) this.leaveAll();
      return;
    }
    this.emptyAt = 0;
    for (const st of this.list) if (st.e && (!st.geared || !st.placed)) { // joined (or respawned) since the last tick
      try { this.settle(st, hs); } catch (err) { st.geared = st.placed = true; console.error('[residents] settle', st.def.name, err); } // (one bad settle never holds up the rest)
    }
    const next = this.list.find(st => !st.e && t >= st.back);
    if (next && this.mgr.count() < this.mgr.max - RESIDENT_RESERVE) this.spawn(next, hs);
  }

  spawn(st, hs) {
    const d = st.def, top = Math.max(...hs.map(h => h.lvl || 1));
    const name = this.mgr.uniqueName(d.name); // (a player called Pip: this one joins as "Pip 2", with Pip's personality)
    const [view] = this.mgr.start([d.cls], [name], { lvl: residentLevel(top, d.share), behaviour: daysEnabled() ? 'own' : 'field', follow: '', skill: d.skill, join: { f2: 1, f3: 1 } });
    const e = this.mgr.bots.find(x => x.bid === view.bid);
    e.resident = d.name; e.creator = null; e.allow = [];
    e.b.personaName = d.name; e.b.persona = rollPersonality(d.name); // (its own, whatever name it joined under; a rename keeps it: brain.js setPersona)
    st.bid = e.bid; st.e = e; st.geared = st.placed = false; st.back = 0;
  }

  // In the world: the premade gear for its level, and (once) a spot by the waypoint of the floor most players are on.
  settle(st, hs) {
    const p = this.mgr.livePlayer(st.e);
    if (!p) return;
    if (!st.geared) { st.geared = true; premadeOutfit(this.game, p); }
    if (st.placed) return;
    st.placed = true;
    const n = {};
    for (const h of hs) n[floorOf(h.x)] = (n[floorOf(h.x)] || 0) + 1;
    const fl = +Object.keys(n).sort((a, b) => n[b] - n[a] || a - b)[0] || 1;
    const w = WAYPOINTS.find(x => x.floor === fl) || WAYPOINTS[0];
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 5;
      const [x, z] = resolveCollision(w.x + Math.sin(a) * r, w.z + Math.cos(a) * r);
      if (walkable(x, z, true)) { this.game.teleport(p, x, z); break; }
    }
  }

  leaveAll() {
    this.ours = true;
    let any = false;
    try { for (const st of this.list) if (st.bid) { any = true; this.mgr.remove(st.bid); this.out(st); } } finally { this.ours = false; }
    if (any) this.game.rosterDirty = true;
  }

  // For the admin page and tests: who is in, and who is out for a while.
  status() {
    const t = this.now();
    return this.list.map(st => ({ name: st.def.name, cls: st.def.cls, skill: st.def.skill, in: !!st.e, as: st.e?.b.name || '', away: !st.e && st.back > t ? Math.ceil((st.back - t) / 1000) : 0 }));
  }
}

export const residentsOn = (env = process.env) => residentCount(env) > 0;
function envS(k, def) { const v = process.env[k]; return v === undefined || v === '' || !Number.isFinite(Number(v)) ? def : Math.max(0, Number(v)); } // (0 allowed)
