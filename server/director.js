// The scene director (docs/ROADMAP.md F2): plays a cue sheet (YAML, format v1 in docs/SCRIPT_BRIEF.md) with bot actors
// inside the server, for filming. game.director = new Director(game, bots) (server/index.js):
//   load(yamlText) -> { ok, error?, errors, warnings, title, scenes }   validate() -> { errors, warnings }
//   run({ from, force }) -> status (from: scene id or 0-based index; force: run even with missing F3-F6 APIs, skipping those cues)
//   stop(reason?)                                                       status() -> what's running (admin page)
// Each cast member is a server bot (BotManager) with its exact name, class, level, weapon style and capability, all in one
// party. Their brains get a script layer (b.script, shared/bots/script.js): the director sets what each actor is doing
// (stand, walk, run, face, follow, fight), and a fight hands the turn back to the normal brain, focused on the target.
// The director ticks after every game.update (it wraps it), so it runs at the server's 20 Hz, in game time.
// It calls the other F modules only through the Shared contracts (forceBossMove, protect, cine, setPose, ringBell, ...),
// each guarded: validate() reports a verb whose API this server doesn't have.
// Safety for takes: actors are protected (never below 10% health unless a cue kills them), the automatic bell is held,
// twists follow the sheet; stop() (or an error in a cue) removes the actors and restores everything.
import { CLASSES, PLAYER_SPEED, JUMP, inGateZone, resolveCollision, walkable } from '../shared/data.js';
import { inGateZone2, floorOf } from '../shared/floor2.js';
import { makeItem } from '../shared/items.js';
import { MASTERY } from '../shared/mastery.js';
import { loadoutFor, charmFor, defaultBranch } from '../shared/playerbots.js';
import { existsSync } from 'node:fs';
import { parseSheet, validateSheet, Timeline, LANDMARKS, PLACES, PARK, BOSSES, VERBS, parseCond, sayHold, whoList, API_NAMES, voiceDir, voiceKey } from './director-sheet.js';

const VOICE_ROOT = new URL('../public/voice/', import.meta.url); // pre-made voice-over files (scripts/film/voices.mjs)

const WALK = 3.4, RUN = PLAYER_SPEED; // m/s (the client plays the walk cycle up to 3.5 m/s)
const PROTECT = 0.1; // actors never drop below 10% health unless a cue kills them
const SKILL_RANGE = { taunt: 7, gslam: 4.5, whirl: 3.5, rush: 7, smite: 9.5, heal: 14, bless: 14 };
const SELF_SKILLS = new Set(['wall', 'sanct', 'bless', 'taunt']);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ang = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const r2 = v => Math.round(v * 100) / 100;

export class Director {
  constructor(game, bots) {
    this.game = game; this.bots = bots;
    this.text = ''; this.sheet = null; this.state = 'idle'; this.lines = [];
    this.actors = new Map(); this.spawns = new Map(); this.seen = new WeakSet();
    const up = game.update.bind(game);
    game.update = dt => { up(dt); this.tick(); };
  }

  // ---------- loading and checking ----------
  load(text) {
    if (this.running) throw new Error('Stop the show first.');
    const r = parseSheet(text);
    this.text = String(text ?? '');
    if (r.error) { this.sheet = null; this.state = 'idle'; return { ok: false, error: r.error, errors: [{ scene: 0, cue: 0, msg: r.error }], warnings: [] }; }
    this.sheet = r.sheet; this.state = 'loaded';
    const v = this.validate();
    return { ok: !v.errors.length, ...v, title: this.sheet.title || '', scenes: (this.sheet.scenes || []).map((s, i) => s?.id || `#${i + 1}`) };
  }
  validate() { return validateSheet(this.sheet, { has: name => this.has(name) }); }
  has(name) { return typeof this.game[name] === 'function'; }
  get running() { return this.state === 'casting' || this.state === 'running'; }

  // ---------- running ----------
  run({ from = 0, force = false } = {}) {
    if (this.running) throw new Error('Already running.');
    if (!this.sheet) throw new Error('Load a sheet first.');
    const v = this.validate();
    const hard = v.errors.filter(e => !e.api), api = v.errors.filter(e => e.api);
    if (hard.length) throw new Error(`The sheet has ${hard.length} error${hard.length > 1 ? 's' : ''}: validate it first.`);
    if (api.length && !force) throw new Error(`${api.length} cue${api.length > 1 ? 's need' : ' needs'} a module this server doesn't have (${[...new Set(api.map(e => e.msg.match(/needs (\w+)\(/)?.[1]))].join(', ')}). Run with force to skip them.`);
    const scenes = this.sheet.scenes;
    const i = typeof from === 'string' && !/^\d+$/.test(from) ? scenes.findIndex(s => String(s.id) === from) : Number(from) | 0;
    if (i < 0 || i >= scenes.length) throw new Error(`No scene "${from}".`);
    const g = this.game;
    this.lines = []; this.spawns.clear(); this.actors.clear();
    this.fromScene = i; this.scene = null; this.t0 = g.time; this.force = !!force;
    this.checks = { scenes: [], deaths: [], unscripted: [], lastAttack: null, bells: 0, clears: 0 };
    this.saved = { bellAuto: g.bellAuto };
    if ('bellAuto' in g || this.has('ringBell')) g.bellAuto = false; // the director rings the bell by hand
    this.state = 'casting';
    this.log(`Casting ${this.sheet.cast.length} actors for "${this.sheet.title || 'untitled'}"${i ? ` from scene ${scenes[i].id}` : ''}.`);
    for (const c of this.sheet.cast) {
      const want = String(c.name);
      const name = this.bots.uniqueName(want);
      if (name !== want) this.log(`! The name ${want} is taken: ${c.id} plays as ${name}.`);
      const view = this.bots.start([c.class], [name], { lvl: c.level || 1, behaviour: 'follow', follow: '', skill: c.skill ?? 5 })[0];
      const e = this.bots.bots.find(x => x.bid === view.bid);
      e.b.quiet = true; e.b.script = { k: 'idle', goal: `Actor: ${c.id}` }; e.director = true;
      this.actors.set(String(c.id), { id: String(c.id), def: c, name, e, b: e.b, p: null, mode: { k: 'idle' }, dead: false });
    }
    this.castAt = g.time;
    return this.status();
  }

  stop(reason = 'Stopped.') {
    if (this.state === 'idle' || this.state === 'loaded' || this.state === 'stopped') return this.status();
    const g = this.game;
    this.log(reason);
    const tryIt = (what, fn) => { try { fn(); } catch (err) { console.error(`[director] stop: ${what}`, err); } };
    for (const a of this.actors.values()) {
      tryIt('pose', () => { if (a.p && this.has('setPose')) g.setPose(a.p, null); });
      tryIt('protect', () => { if (a.p && this.has('protect')) g.protect(a.p, 0); });
      tryIt('remove', () => this.bots.remove(a.e.bid));
    }
    tryIt('staging', () => { if (this.has('clearStaging')) g.clearStaging(); else { if (this.has('setTwistOverride')) g.setTwistOverride(null); } });
    tryIt('cine', () => this.resetCine());
    g.bellAuto = this.saved?.bellAuto ?? true;
    this.actors.clear(); this.spawns.clear(); this.scene = null;
    this.state = 'stopped';
    return this.status();
  }

  resetCine() {
    const g = this.game;
    if (!this.has('cine')) return;
    if (g.cine('reset', {}) !== false) return;
    for (const [op, d] of [['shot', { shot: 'free' }], ['letterbox', { on: false }], ['clean', { on: false }], ['light', { light: 'day' }], ['fade', { to: 'in', secs: 0.5 }]]) g.cine(op, d);
  }

  fail(err, where) {
    console.error(`[director] ${where}`, err);
    this.log(`! Error in ${where}: ${err.message}`);
    this.stop('Stopped after an error.');
    this.state = 'error'; this.error = `${where}: ${err.message}`;
  }

  log(text) {
    const g = this.game, t = this.t0 !== undefined ? Math.max(0, g.time - this.t0) : 0;
    this.lines.push({ t: r2(t), scene: this.scene?.sc.id ?? null, text });
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
    if (process.env.DIRECTOR_LOG) console.log(`[director ${t.toFixed(1)}] ${text}`);
  }

  // ---------- the tick (after every game.update) ----------
  tick() {
    if (!this.running) return;
    try {
      this.watch();
      if (this.state === 'casting') return this.casting();
      const S = this.scene, g = this.game;
      for (const a of this.actors.values()) this.drive(a);
      S.tl.step(g.time, i => this.startCue(i), i => this.cueDone(i));
      if (S.tl.over) {
        this.checks.scenes.push(S.sc.id);
        this.log(`Scene ${S.sc.id} finished (${(g.time - S.t0).toFixed(1)} s).`);
        if (S.i + 1 < this.sheet.scenes.length) this.startScene(S.i + 1);
        else { this.state = 'done'; this.log(`The end (${(g.time - this.t0).toFixed(1)} s). Stop the show to send the actors home.`); }
      }
      this.watch();
    } catch (err) { this.fail(err, this.scene ? `scene ${this.scene.sc.id}` : 'the director'); }
  }

  // Events of interest: actor deaths (scripted or not), the Last Attack, the bell, floor clears.
  watch() {
    const g = this.game;
    for (const e of g.events) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      if (e.t === 'pdie') {
        const a = [...this.actors.values()].find(x => x.p?.id === e.id);
        if (!a) continue;
        const scripted = !!a.dying || !!e.stay;
        this.checks.deaths.push({ id: a.id, scripted, t: r2(g.time - this.t0) });
        if (!scripted) { this.checks.unscripted.push(a.id); this.log(`! ${a.name} died (unscripted: ${e.src}).`); }
      } else if (e.t === 'la') {
        const a = [...this.actors.values()].find(x => x.p?.id === e.id);
        this.checks.lastAttack = { id: a?.id || null, name: e.name };
        this.log(`Last Attack: ${e.name}.`);
      } else if (e.t === 'bell') { this.checks.bells++; this.log(`The bell rings (floor ${e.floor}).`); }
      else if (e.t === 'clear') { this.checks.clears++; this.checks.clearNames = e.names || []; }
    }
  }

  // Waiting for every actor to join: then gear, party, protection, and the first scene.
  casting() {
    const g = this.game, list = [...this.actors.values()];
    for (const a of list) a.p = this.bots.livePlayer(a.e);
    if (list.some(a => !a.p)) {
      if (g.time - this.castAt > 15) throw new Error('Actors failed to join within 15 s.');
      return;
    }
    if (list.some(a => !a.b.id || !a.b.me)) return; // their brains have their first snapshot
    for (const a of list) this.outfit(a);
    const lead = list.find(a => CLASSES[a.def.class]?.role === 'Tank') || list[0];
    for (const a of list) if (a !== lead) this.bots.joinParty(a.p, lead.p);
    this.state = 'running';
    this.log(`Cast ready: ${list.map(a => `${a.name} (${a.def.class} ${a.p.lvl})`).join(', ')}.`);
    this.startScene(this.fromScene);
  }

  // An actor's kit: premade gear for its level (weapon in its style), mastery, talents; full health; no XP (levels hold).
  outfit(a) {
    const g = this.game, p = a.p, c = a.def, L = loadoutFor(p.lvl), role = CLASSES[p.cls]?.role || 'Damage', mid = () => 0.5;
    const style = c.style && c.style !== 'default' ? c.style : undefined;
    const make = (slot, kind, st) => {
      try { return makeItem(slot, L.rarity, p.cls, mid, kind, st); }
      catch { const it = makeItem(slot, L.rarity, 'swordsman', mid, kind); it.cls = p.cls; it.name = `${CLASSES[p.cls].name}'s Weapon`; return it; }
    };
    p.inv.eq = { ...p.inv.eq, weapon: make('weapon', undefined, style), armor: make('armor'), charm: make('charm', charmFor(role)) };
    const pts = MASTERY.need[L.mastery] || 0;
    for (const [sk, m] of Object.entries(p.mastery || {})) { m.pts = Math.max(m.pts || 0, pts); if (L.evolved && !m.br) m.br = defaultBranch(sk); }
    g.autoSpendTalents?.(p);
    g.recompute(p); p.hp = p.maxHp;
    p.invDirty = true; p.masteryDirty = true; p.masteryNow = true;
    p.pbOwned = true; // no XP: an actor keeps its level for the whole film (server/playerbots.js)
    if (this.has('protect')) g.protect(p, PROTECT);
    g.rosterDirty = true;
  }

  // ---------- scenes ----------
  startScene(i) {
    const g = this.game, sc = this.sheet.scenes[i];
    this.scene = { i, sc, t0: g.time, tl: new Timeline(sc.cues, g.time), rt: [] };
    this.log(`Scene ${sc.id} (${sc.place}${sc.light ? `, ${sc.light}` : ''}).`);
    if (sc.light && this.has('cine')) g.cine('light', { light: sc.light });
    const absent = new Set(whoList(sc.absent));
    const place = PLACES[sc.place];
    // absent actors: parked out of view (the dead stay where they lie)
    let k = 0;
    for (const a of this.actors.values()) {
      a.absent = absent.has(a.id);
      if (!a.absent || a.p.dead) continue;
      const [x, z] = PARK[place.floor];
      this.place(a, x + (k++) * 2, z);
      this.setMode(a, { k: 'idle' });
    }
    for (const a of this.actors.values()) {
      if (a.absent || a.p.dead) continue;
      if (this.has('setPose')) g.setPose(a.p, null);
      this.setMode(a, { k: 'idle' });
    }
    // marks: landmarks and points first, then marks on other actors, in a small fan per spot
    const marks = Object.entries(sc.marks || {}).filter(([id]) => this.actors.has(id) && !absent.has(id) && !this.actors.get(id).p.dead);
    for (const pass of [0, 1]) {
      const groups = new Map();
      for (const [id, v] of marks) {
        if ((typeof v === 'string' && this.actors.has(v)) !== (pass === 1)) continue;
        const key = JSON.stringify(v);
        if (!groups.has(key)) groups.set(key, { v, ids: [] });
        groups.get(key).ids.push(id);
      }
      for (const { v, ids } of groups.values()) {
        ids.forEach((id, n) => {
          const a = this.actors.get(id), spot = this.spot(v, n, ids.length, a);
          this.place(a, spot.x, spot.z);
          this.setMode(a, { k: 'idle', look: spot.look });
        });
      }
    }
    // anyone else far from this scene's place comes along
    for (const a of this.actors.values()) {
      if (a.absent || a.p.dead || marks.some(([id]) => id === a.id)) continue;
      if (floorOf(a.p.x) !== place.floor || Math.hypot(a.p.x - place.at[0], a.p.z - place.at[1]) > 80) {
        const s = this.spot(place.at, 0, 1, a);
        this.place(a, s.x, s.z);
      }
    }
  }

  // ---------- where things are ----------
  // A target in a sheet -> { kind: 'actor'|'mob'|'point', a?, m?, x, z } (or null).
  resolve(v) {
    const g = this.game;
    if (Array.isArray(v)) return { kind: 'point', x: +v[0], z: +v[1] };
    const s = String(v);
    if (this.actors.has(s)) { const a = this.actors.get(s); return a.p ? { kind: 'actor', a, x: a.p.x, z: a.p.z, id: a.p.id } : null; }
    const m = this.mob(s);
    if (m) return { kind: 'mob', m, x: m.x, z: m.z, id: m.id };
    const L = LANDMARKS[s];
    if (L) return { kind: 'point', x: L.at[0], z: L.at[1], look: L.look ? { x: L.look[0], z: L.look[1] } : null, ring: L.ring, lm: L };
    return null;
  }
  mob(name) {
    const g = this.game;
    if (name === 'warden') return g.boss || null;
    if (name === 'sovereign') return g.sovereign || [...g.mobs.values()].find(m => m.type === BOSSES.sovereign) || null;
    return this.spawns.get(name) || g.stagedMob?.(name) || null;
  }
  // F4 target shape: { pid } | { mid } | { x, z }
  cineTarget(v) {
    if (v === undefined || v === null) return undefined;
    const r = this.resolve(v);
    if (!r) return undefined;
    if (r.kind === 'actor') return { pid: r.id };
    if (r.kind === 'mob') return { mid: r.id };
    return r.look && !r.ring ? { x: r2(r.look.x), z: r2(r.look.z) } : { x: r2(r.x), z: r2(r.z) };
  }

  // Where actor number n of `count` stands for target v: a row facing a prop, a ring around a ring landmark (fountain),
  // an arc in front of an actor or mob, or a small circle around a point. { x, z, look }
  spot(v, n, count, a) {
    const r = this.resolve(v);
    if (!r) return { x: a.p.x, z: a.p.z, look: null };
    const from = a?.p || { x: r.x, z: r.z - 1 };
    let x = r.x, z = r.z, look = null;
    if (r.kind !== 'point') { // stand in front of them, in an arc
      const stop = r.kind === 'mob' ? r.m.def.radius + 1.6 : 1.7;
      const a0 = Math.atan2(from.x - r.x, from.z - r.z) + (n - (count - 1) / 2) * 0.55;
      x = r.x + Math.sin(a0) * stop; z = r.z + Math.cos(a0) * stop;
      look = { id: r.id };
    } else if (r.ring) { // around the prop
      const c = r.look, a0 = Math.atan2(r.x - c.x, r.z - c.z) + (n - (count - 1) / 2) * (count > 1 ? Math.min(0.8, (2 * Math.PI) / count) : 0);
      x = c.x + Math.sin(a0) * r.ring; z = c.z + Math.cos(a0) * r.ring;
      look = { x: c.x, z: c.z };
    } else if (r.look) { // a row facing the prop
      const dx = r.look.x - r.x, dz = r.look.z - r.z, L = Math.hypot(dx, dz) || 1, off = (n - (count - 1) / 2) * 1.5;
      x = r.x + (dz / L) * off; z = r.z - (dx / L) * off;
      if (count > 4 && n % 2) { x -= (dx / L) * 1.3; z -= (dz / L) * 1.3; }
      look = { x: r.look.x, z: r.look.z };
    } else if (count > 1) {
      const a0 = (n / count) * Math.PI * 2;
      x += Math.sin(a0) * 1.4; z += Math.cos(a0) * 1.4;
    }
    [x, z] = resolveCollision(x, z);
    if (!walkable(x, z, false)) { x = r.x; z = r.z; }
    return { x, z, look, dynamic: r.kind !== 'point', stop: r.kind === 'mob' ? r.m.def.radius + 1.6 : r.kind === 'actor' ? 1.7 : 0.35 };
  }

  place(a, x, z) {
    const g = this.game, p = a.p;
    g.teleport(p, x, z);
    a.b.x = x; a.b.z = z; a.b.roll = null; // (the bot also hears the tp event; this saves it a step toward the old spot)
  }

  // ---------- actor modes (what each actor is doing between cues) ----------
  // idle { look }: stand (facing look: { x, z } or { id }); move { dest, speed, stop }: walk/run, then idle;
  // follow { target, dist }; fight { mob, press? }: the normal brain, with an attack order on the mob.
  setMode(a, m) {
    const g = this.game, b = a.b;
    if (a.mode?.k === 'fight' && m.k !== 'fight' && b.cmd?.director) b.cmd = null;
    if (m.k !== 'idle' && a.guard) { a.guard = false; g.guard?.(a.p, false); }
    a.mode = m;
    if (m.k === 'fight') {
      b.cmd = { k: 'attack', tgt: m.mob.id, by: 0, byName: 'Director', adm: true, at: b.t, director: true };
      b.tgtId = null;
      b.script = { k: 'fight', goal: `Fighting ${m.mob.def.name}` };
    } else if (m.k === 'idle') b.script = { k: 'idle', face: this.faceFor(a, m.look), goal: `Actor: ${a.id}` };
    else b.script = { k: 'move', speed: m.speed, stop: m.stop, x: a.p.x, z: a.p.z, goal: `Actor: ${a.id}` };
    return m;
  }

  faceFor(a, look) {
    if (!look) return a.mode?.k === 'idle' && Number.isFinite(a.b.script?.face) ? a.b.script.face : a.p.face;
    const t = look.id !== undefined ? this.game.players.get(look.id) || this.game.mobs.get(look.id) : look;
    return t ? ang(a.p, t) : a.p.face;
  }

  // Every tick: keep moving targets up to date, arrive, unstick, keep fights pointed at their mob.
  drive(a) {
    const g = this.game, m = a.mode, s = a.b.script, p = a.p;
    if (!p || !g.players.has(p.id)) return;
    if (p.dead) return;
    if (m.k === 'idle') { if (m.look?.id !== undefined && s) s.face = this.faceFor(a, m.look); return; }
    if (m.k === 'fight') {
      if (m.mob.dead || !g.mobs.has(m.mob.id)) { this.setMode(a, { k: 'idle', look: null }); return; }
      if (!a.b.cmd || a.b.cmd.tgt !== m.mob.id) this.setMode(a, m);
      return;
    }
    if (m.k === 'move' || m.k === 'follow') {
      const tgt = m.k === 'follow' ? m.target : m.dest;
      let x = tgt.x, z = tgt.z;
      if (tgt.id !== undefined) { // a moving target: recompute the spot in front of it
        const o = g.players.get(tgt.id) || g.mobs.get(tgt.id);
        if (o) { const a0 = Math.atan2(p.x - o.x, p.z - o.z) + (tgt.off || 0); x = o.x + Math.sin(a0) * m.stop; z = o.z + Math.cos(a0) * m.stop; }
      }
      s.x = x; s.z = z; s.stop = m.k === 'follow' ? 0.6 : 0.3; s.speed = m.speed;
      const d = Math.hypot(p.x - x, p.z - z);
      if (m.k === 'follow') return;
      if (d <= 0.6) return this.arrive(a, m);
      // stuck (blocked, or pushing into something): count it as there after 2 s without progress
      if (!m.best || d < m.best - 0.15) { m.best = d; m.bestT = g.time; }
      else if (g.time - m.bestT > 2) { this.log(`! ${a.name} got stuck ${d.toFixed(1)} m short.`); this.arrive(a, m); }
      else if (g.time - m.t0 > m.limit) { this.log(`! ${a.name} took too long to arrive.`); this.arrive(a, m); }
    }
  }
  arrive(a, m) { m.arrived = true; this.setMode(a, { k: 'idle', look: m.look }); }

  // ---------- cues ----------
  cueWho(c) {
    const who = whoList(c.who);
    const list = who.includes('all') ? [...this.actors.values()].filter(a => !a.absent) : who.map(id => this.actors.get(id)).filter(Boolean);
    return list.filter(a => a.p && this.game.players.has(a.p.id));
  }

  startCue(i) {
    const g = this.game, c = this.scene.sc.cues[i], V = VERBS[c.do];
    const rt = this.scene.rt[i] = { c, t0: g.time, done: () => true };
    const label = `${c.do}${c.who !== undefined ? ` ${whoList(c.who).join('+')}` : ''}`;
    if (V.api && !this.has(V.api)) { this.log(`skip ${label}: no ${V.api}() on this server.`); return; }
    try {
      const fn = VERBS_RUN[c.do];
      const done = fn.call(this, c, this.cueWho(c), rt);
      rt.done = typeof done === 'function' ? done : () => true;
    } catch (err) { throw new Error(`cue ${i + 1} (${label}): ${err.message}`); }
  }

  cueDone(i) {
    const rt = this.scene.rt[i];
    if (!rt) return false;
    const g = this.game;
    if (rt.c.do !== 'say' && rt.c.hold !== undefined && g.time - rt.t0 < rt.c.hold) return false;
    if (rt.c.until !== undefined && !rt.slow && g.time - rt.t0 > 120) { rt.slow = true; this.log(`! ${rt.c.do} has waited 2 min for ${rt.c.until}.`); }
    let d;
    try { d = !!rt.done(); } catch (err) { throw new Error(`cue ${i + 1} (${rt.c.do}): ${err.message}`); }
    if (d && rt.c.until !== undefined) this.log(`${rt.c.do}${rt.c.who !== undefined ? ` ${whoList(rt.c.who).join('+')}` : ''}: ${rt.c.until} (${(g.time - rt.t0).toFixed(1)} s)`);
    return d;
  }

  cond(s) {
    const g = this.game, c = parseCond(s);
    if (!c) return () => true;
    if (c.kind === 'gate') {
      const f = PLACES[this.scene.sc.place]?.floor || 1;
      return () => (f === 2 ? g.gate2?.open : g.gate.open);
    }
    if (c.kind === 't') return () => g.time - this.scene.t0 > c.v;
    const get = () => (this.actors.has(c.target) ? this.actors.get(c.target).p : this.mob(c.target));
    if (c.kind === 'dead') return () => { const o = get(); return !o || !!o.dead; };
    if (c.kind === 'broken') return () => { const o = get(); return !!o && !o.dead && g.time < (o.staggerUntil || 0); };
    const cmp = { '<': (x, y) => x < y, '<=': (x, y) => x <= y, '>': (x, y) => x > y, '>=': (x, y) => x >= y }[c.op];
    return () => { const o = get(); return !!o && cmp(o.dead ? 0 : o.hp / (o.maxHp || 1), c.v); };
  }

  status() {
    const g = this.game, S = this.scene;
    const tl = S?.tl;
    return {
      state: this.state, title: this.sheet?.title || '', error: this.error || null, force: !!this.force,
      scenes: (Array.isArray(this.sheet?.scenes) ? this.sheet.scenes : []).map((s, i) => s?.id || `#${i + 1}`),
      // for the admin page's POV view links (F8): the names the actors really play under once cast (a taken name gets " 2")
      cast: this.actors.size ? [...this.actors.values()].map(a => a.name) : (Array.isArray(this.sheet?.cast) ? this.sheet.cast : []).map(c => c?.name).filter(Boolean),
      scene: S ? { i: S.i, id: S.sc.id, place: S.sc.place, secs: r2(g.time - S.t0), cues: S.sc.cues.length, done: tl.finishedAt.filter(t => t !== null).length } : null,
      elapsed: this.running || this.state === 'done' ? r2(g.time - this.t0) : 0,
      running: tl ? tl.running().map(i => { const c = S.sc.cues[i]; return { n: i + 1, do: c.do, who: c.who ?? null, id: c.id ?? null, secs: r2(g.time - tl.startedAt[i]), text: c.text || c.until || c.to || c.target || c.shot || '' }; }) : [],
      actors: [...this.actors.values()].map(a => ({ id: a.id, name: a.name, cls: a.def.class, pid: a.p?.id || 0, lvl: a.p?.lvl || 0, hp: a.p?.hp ?? 0, maxHp: a.p?.maxHp ?? 0, dead: !!a.p?.dead, absent: !!a.absent, doing: a.mode?.k || '' })),
      bosses: ['warden', 'sovereign', ...this.spawns.keys()].map(k => [k, this.mob(k)]).filter(([, m]) => m && S && floorOf(m.x) === (PLACES[S.sc.place]?.floor || 1))
        .map(([k, m]) => ({ id: k, name: m.def.name, hp: m.hp, maxHp: m.maxHp, dead: !!m.dead, phase: m.phase || 0, posture: Math.round(g.posturePct?.(m) ?? 0), broken: g.time < (m.staggerUntil || 0), engaged: !!m.threat?.size })),
      checks: this.checks || null,
      log: this.lines.slice(-60),
      apis: Object.fromEntries(API_NAMES.map(n => [n, this.has(n)])),
    };
  }
}

// ---------- verbs: each returns a done() check (or nothing: instant) ----------
const moveVerb = speed => function (c, actors) {
  const g = this.game, modes = actors.map((a, n) => {
    if (a.p.dead) return null;
    const sp = this.spot(c.to, n, actors.length, a);
    const r = this.resolve(c.to);
    const dest = sp.dynamic ? { id: r.id, x: sp.x, z: sp.z, off: (n - (actors.length - 1) / 2) * 0.55 } : { x: sp.x, z: sp.z };
    const d = Math.hypot(a.p.x - sp.x, a.p.z - sp.z);
    return this.setMode(a, { k: 'move', dest, speed, stop: sp.stop, look: sp.look, t0: g.time, limit: d / speed * 2 + 6 });
  }).filter(Boolean);
  return () => modes.every(m => m.arrived || actors.find(a => a.mode === m) === undefined);
};

const VERBS_RUN = {
  walk_to: moveVerb(WALK),
  run_to: moveVerb(RUN),
  follow(c, actors) {
    for (const a of actors) {
      const r = this.resolve(c.to);
      if (!r || a.p.dead) continue;
      this.setMode(a, { k: 'follow', target: { id: r.id, x: r.x, z: r.z }, speed: RUN, stop: Number(c.dist) || 2.5 });
    }
  },
  face(c, actors) {
    const r = this.resolve(c.to);
    if (!r) return;
    const look = r.id !== undefined ? { id: r.id } : r.look && !r.ring ? r.look : { x: r.x, z: r.z };
    for (const a of actors) if (!a.p.dead) this.setMode(a, { k: 'idle', look });
  },
  hold(c, actors) { for (const a of actors) if (!a.p.dead) this.setMode(a, { k: 'idle', look: null }); },
  teleport(c, actors) {
    actors.forEach((a, n) => {
      if (a.p.dead) return;
      const sp = this.spot(c.to, n, actors.length, a);
      this.place(a, sp.x, sp.z);
      this.setMode(a, { k: 'idle', look: sp.look });
    });
  },
  dodge(c, actors) {
    for (const a of actors) {
      if (a.p.dead) continue;
      if (a.mode.k !== 'idle') this.setMode(a, { k: 'idle', look: null });
      let dir = a.p.face;
      if (c.to !== undefined) { const r = this.resolve(c.to); if (r) dir = ang(a.p, r); }
      else dir += { left: Math.PI / 2, right: -Math.PI / 2, back: Math.PI, forward: 0 }[c.dir || 'back'];
      (a.b.script.once ||= []).push({ k: 'dodge', dir });
    }
    const t0 = this.game.time;
    return () => this.game.time - t0 > 0.45;
  },
  jump(c, actors) {
    for (const a of actors) if (!a.p.dead) (a.b.script.once ||= []).push({ k: 'jump' });
    const t0 = this.game.time;
    return () => this.game.time - t0 > JUMP.time;
  },
  fight(c, actors) {
    const m = this.mob(c.target);
    if (!m || m.dead) { this.log(`! fight: ${c.target} isn't there.`); return; }
    for (const a of actors) if (!a.p.dead) this.setMode(a, { k: 'fight', mob: m });
    if (c.until === undefined) return;
    const until = this.cond(c.until);
    return () => until() || m.dead;
  },
  skill(c, actors) {
    const g = this.game;
    const jobs = actors.filter(a => !a.p.dead).map(a => {
      const skills = CLASSES[a.p.cls].skills;
      const slot = typeof c.skill === 'number' ? c.skill : skills.findIndex(s => s.id === c.skill);
      const sk = skills[slot];
      const tgt = c.target !== undefined ? this.resolve(c.target) : null;
      const prev = a.mode;
      let set = null;
      if (tgt?.kind === 'mob' && (c.until !== undefined || !SELF_SKILLS.has(sk.id) || sk.id === 'taunt')) set = this.setMode(a, { k: 'fight', mob: tgt.m }); // close in (the brain fights meanwhile)
      return { a, slot, sk, tgt, prev, set, pressed: 0 };
    });
    const until = c.until !== undefined ? this.cond(c.until) : null;
    const t0 = g.time;
    const press = j => {
      const p = j.a.p;
      if (p.dead || g.time < p.cds[j.slot] || p.lvl < (j.sk.lvl || 1)) return false;
      if (j.tgt) {
        const o = j.tgt.kind === 'mob' ? j.tgt.m : j.tgt.kind === 'actor' ? j.tgt.a.p : j.tgt;
        const reach = (SKILL_RANGE[j.sk.id] ?? (CLASSES[p.cls].role === 'Healer' || ['ranger', 'bard'].includes(p.cls) ? 9 : 3)) + (o.def?.radius || 0);
        if (j.tgt.kind === 'mob' && dist(p, o) > reach) return false;
        p.face = ang(p, o);
        if (j.tgt.kind === 'actor') p.healTid = o.id;
      }
      if (p.guarding) g.guard(p, false);
      const before = p.cds[j.slot];
      g.useSkill(p, j.slot, p.face);
      if (p.cds[j.slot] === before) return false;
      j.pressed++;
      return true;
    };
    return () => {
      for (const j of jobs) {
        if (until || !j.pressed) press(j);
        if (!until && j.pressed && j.set && j.a.mode === j.set) { this.setMode(j.a, j.prev.k === 'fight' && j.prev.mob.dead ? { k: 'idle' } : j.prev); j.set = null; } // back to what it was doing (unless a later cue changed it)
      }
      if (until) return until();
      if (jobs.every(j => j.pressed || j.a.p.dead)) return true;
      if (g.time - t0 > 20) { this.log(`! skill ${c.skill}: not pressed after 20 s, moving on.`); return true; }
      return false;
    };
  },
  guard(c, actors) {
    const on = c.on !== false;
    for (const a of actors) {
      if (a.p.dead) continue;
      if (on) this.setMode(a, { k: 'idle', look: null });
      this.game.guard?.(a.p, on); a.guard = on && !!a.p.guarding;
    }
  },
  parry(c, actors) {
    const g = this.game;
    for (const a of actors) { if (a.p.dead) continue; this.setMode(a, { k: 'idle', look: null }); g.guard?.(a.p, false); g.guard?.(a.p, true); }
    const t0 = g.time;
    return () => {
      if (g.time - t0 < 0.4) return false;
      for (const a of actors) if (!a.guard && a.p.guarding) g.guard(a.p, false);
      return true;
    };
  },
  use_item(c, actors) { for (const a of actors) if (!a.p.dead) this.game.handle(a.p, { type: 'use', id: c.item || 'potion' }); },
  ready(c, actors) {
    const g = this.game;
    for (const a of actors) {
      const p = a.p;
      if (p.dead) continue;
      const two = floorOf(p.x) === 2;
      if (!(two ? inGateZone2(p.x, p.z) : inGateZone(p.x, p.z))) { this.log(`! ${a.name} isn't at a raid gate: can't ready.`); continue; }
      if (!(two ? g.gate2 : g.gate).ready.has(p.id)) g.toggleReady(p);
    }
  },
  say(c, actors) {
    const g = this.game;
    const t0 = g.time, hold = c.hold ?? sayHold(c.text);
    for (const a of actors) {
      if (a.p.dead && actors.length > 1) continue;
      g.handle(a.p, { type: 'chat', text: String(c.text), ch: c.ch === 'party' ? 'p' : 's' });
      // the line as a cue: its hold (bubbles, film subtitles) and its voice-over file when one has been made
      const e = g.events.at(-1);
      if (e?.t !== 'chat' || e.id !== a.p.id) continue;
      e.hold = hold;
      const voice = `${voiceDir(this.sheet)}/${voiceKey(a.id, e.text)}`;
      if (existsSync(new URL(`${voice}.mp3`, VOICE_ROOT))) e.voice = voice;
    }
    this.log(`${actors.map(a => a.name).join(', ')}: ${c.text}`);
    return () => g.time - t0 >= hold;
  },
  emote(c, actors) { for (const a of actors) this.game.events.push({ t: 'emote', id: a.p.id, a: c.anim }); },
  pose(c, actors) { for (const a of actors) if (!a.p.dead) this.game.setPose(a.p, c.k === 'none' ? null : c.k); },
  die(c, actors) {
    const g = this.game;
    for (const a of actors) {
      if (a.p.dead) continue;
      a.dying = true;
      if (this.has('protect')) g.protect(a.p, 0);
      this.setMode(a, { k: 'idle', look: null });
      g.scriptDeath(a.p, { respawn: c.respawn === true, src: 'the script' });
      this.watch(); // (counts the pdie it just pushed as scripted)
      a.dying = false; a.scriptedDead = true;
      this.log(`${a.name} falls (scripted).`);
    }
  },
  revive(c, actors) {
    const g = this.game;
    for (const a of actors) {
      if (!a.p.dead) continue;
      g.scriptRevive(a.p); a.scriptedDead = false;
      if (this.has('protect')) g.protect(a.p, PROTECT);
      this.setMode(a, { k: 'idle', look: null });
    }
  },
  wait(c) {
    const g = this.game, t0 = g.time, until = c.until !== undefined ? this.cond(c.until) : null;
    return () => (c.secs === undefined || g.time - t0 >= c.secs) && (!until || until());
  },
  boss_move(c) {
    const g = this.game, m = this.mob(whoList(c.who)[0]);
    if (!m || m.dead) { this.log(`! boss_move: ${c.who} isn't there.`); return; }
    const t = c.target !== undefined ? this.resolve(c.target) : null;
    const ok = g.forceBossMove(m, c.move, t?.kind === 'actor' ? t.id : null);
    if (!ok) { this.log(`! boss_move ${c.move} didn't start.`); return; }
    this.log(`${m.def.name}: ${c.move}${t ? ` at ${c.target}` : ''}.`);
    const t0 = g.time;
    return () => { // done once the move has landed: no wind-up, Horn Sweep or busy time left (capped at 8 s)
      if (g.time - t0 < 0.3) return false;
      return m.dead || g.time - t0 > 8 || !(m.sweepPending || m.windupAt || g.time < (m.busyUntil || 0) || m.charging);
    };
  },
  reserve_last_attack(c) {
    const m = this.mob(c.target), a = c.for !== undefined && c.for !== null ? this.actors.get(String(c.for)) : null;
    if (!m) { this.log(`! reserve_last_attack: ${c.target} isn't there.`); return; }
    this.game.reserveLastAttack(m, a?.p?.id ?? null);
  },
  twists(c) { this.game.setTwistOverride(c.set === 'random' ? null : c.set); },
  spawn(c) {
    const r = this.resolve(c.at);
    if (!r) return;
    const m = this.game.spawnMob(c.type, r.x, r.z, { label: String(c.label) });
    if (m) this.spawns.set(String(c.label), m);
  },
  give_item(c, actors) { for (const a of actors) this.game.giveKeepsake(a.p, { name: c.name, slot: c.slot || 'charm', desc: c.desc || '' }); },
  protect(c, actors) { for (const a of actors) this.game.protect(a.p, c.min ?? PROTECT); },
  camera(c) { this.game.cine('shot', { shot: c.shot, target: this.cineTarget(c.target), from: this.cineTarget(c.from), ...(c.secs !== undefined ? { secs: c.secs } : {}) }); },
  slowmo(c) { return this.timedCine('slowmo', { secs: c.secs ?? 1, scale: c.scale ?? 0.35 }, c.secs ?? 1); },
  title(c) { return this.timedCine('title', { text: c.text, sub: c.sub, secs: c.secs ?? 3 }, c.secs ?? 3); },
  fade(c) { return this.timedCine('fade', { to: c.to, secs: c.secs ?? 1 }, c.secs ?? 1); },
  letterbox(c) { this.game.cine('letterbox', { on: c.on !== false }); },
  clean(c) { this.game.cine('clean', { on: c.on !== false }); },
  light(c) { this.game.cine('light', { light: c.to }); },
  bell(c) { this.game.ringBell(c.floor ?? 1, { auto: false }); },
  mvp(c) { if (!this.game.showMvp({ secs: c.secs })) this.log('! mvp: no boss fight has ended yet.'); },
};
Director.prototype.timedCine = function (op, data, secs) {
  const g = this.game, t0 = g.time;
  g.cine(op, data);
  return () => g.time - t0 >= secs;
};
