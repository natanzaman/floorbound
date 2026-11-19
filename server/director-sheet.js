// Cue sheets for the scene director (server/director.js): parsing, the format's vocabulary (verbs, landmarks, places,
// conditions), validation and the cue timeline. Pure: no game state here, so tests can use it on its own.
// The format (v1) is documented in docs/SCRIPT_BRIEF.md; Episode 1's sheet is docs/story/ep1-first-line.yaml.
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { CLASSES, MAX_LEVEL, MOBS, WORLD, GATE } from '../shared/data.js';
import { F2, GATE2, WAYSTONES } from '../shared/floor2.js';
import { MERCHANT } from '../shared/items.js';
import { SMITH } from '../shared/crafting.js';
import { SHRINES } from '../shared/mastery.js';
import { HALL } from '../shared/titles.js';
import { STYLES } from '../shared/styles.js';
import { TWIST_IDS } from '../shared/twists.js';

// ---------- places and landmarks ----------
// Where each scene's place is (actors not marked and far away are brought here), and its floor.
export const PLACES = {
  town: { at: [0, 6], floor: 1 },
  raid_gate: { at: [0, 150], floor: 1 },
  warden_arena: { at: [0, 172], floor: 1 },
  fields: { at: [0, 60], floor: 1 },
  mire: { at: [600, 60], floor: 2 },
  mire_camp: { at: [600, 5], floor: 2 },
  drowned_wood: { at: [600, 120], floor: 2 },
  sunken_gate: { at: [600, 150], floor: 2 },
  sovereign_lair: { at: [600, 175], floor: 2 },
};
// Absent actors wait out of view here.
export const PARK = { 1: [-66, -32], 2: [666, -28] };

// A spot `d` m in front of an object, toward a centre (town props face the plaza, Floor 2's face the camp fire).
const front = (o, d, c = [0, 0]) => {
  const dx = c[0] - o.x, dz = c[1] - o.z, L = Math.hypot(dx, dz) || 1;
  return [o.x + (dx / L) * d, o.z + (dz / L) * d];
};
// at: where actors stand; look: what they face when they arrive (the prop); ring: stand around `look` at this radius.
export const LANDMARKS = {
  town_square: { at: [0, 9], floor: 1 },
  fountain: { at: [0, 4.6], look: [0, 0], ring: 4.6, floor: 1 },
  merchant: { at: front(MERCHANT, 3.2), look: [MERCHANT.x, MERCHANT.z], floor: 1 },
  smith: { at: [3.2, -10.2], look: [SMITH.x, SMITH.z], floor: 1 }, // (the waystone stands right in front of the forge)
  skill_shrine: { at: front(SHRINES[0], 2.6), look: [SHRINES[0].x, SHRINES[0].z], floor: 1 },
  hall_of_clearers: { at: front(HALL, 3.6), look: [HALL.x, HALL.z], floor: 1 },
  waystone: { at: front(WAYSTONES[0], 2.6), look: [WAYSTONES[0].x, WAYSTONES[0].z], floor: 1 },
  north_road: { at: [0, 30], floor: 1 },
  raid_gate: { at: [0, 152], look: [0, GATE.z], floor: 1 },
  arena_edge: { at: [WORLD.arena.x, WORLD.arena.z - 20], look: [WORLD.arena.x, WORLD.arena.z], floor: 1 },
  arena_center: { at: [WORLD.arena.x, WORLD.arena.z], floor: 1 },
  mire_camp: { at: [F2.camp.x, F2.camp.z + 4], look: [F2.camp.x, F2.camp.z], floor: 2 },
  mire_shrine: { at: front(SHRINES[1], 2.6, [F2.camp.x, F2.camp.z]), look: [SHRINES[1].x, SHRINES[1].z], floor: 2 },
  drowned_wood: { at: [F2.x, 120], floor: 2 },
  sunken_gate: { at: [GATE2.x, 152], look: [GATE2.x, GATE2.z], floor: 2 },
  sovereign_court: { at: [F2.arena.x, F2.arena.z - 16], look: [F2.arena.x, F2.arena.z], floor: 2 },
};
export const BOSSES = { warden: 'warden', sovereign: 'sovereign' }; // name in a sheet -> mob type

// ---------- verbs ----------
// who: 'actors' (cast members: an id, a list, or all), 'mob' (warden, sovereign or a spawn label), 'none' (the director).
// args: name -> kind (validated below). req: required args. api: the Game method it needs (F1/F3-F6, docs/ROADMAP.md).
const LOC = 'loc', TGT = 'tgt', MOB = 'mob', COND = 'cond', NUM = 'num', STR = 'str', BOOL = 'bool';
const en = (...v) => ({ enum: v });
export const MOVES = ['horn_sweep', 'slam', 'charge', 'quake', 'rockfall', 'tidal_wave', 'geyser', 'trident', 'deluge', 'meteor', 'spread', 'tether', 'hammerfall', 'lightning', 'gale_push', 'overload', 'tempest_beam', 'fall', 'vines', 'pillar', 'crystal']; // (meteor / spread / tether: team mechanics, server/bossteam.js; hammerfall to tempest_beam: the Storm Colossus, server/floor3.js; fall: a boss's fall to its next area, server/arenas.js; vines / pillar / crystal: rescue traps, server/rescue.js)
export const SHOTS = ['close_up', 'medium', 'wide', 'over_shoulder', 'follow', 'orbit', 'crane', 'pov', 'eyes', 'free']; // pov / eyes: a character's own view (F8)
export const EMOTES = ['cheer', 'block', 'cast', 'hit', 'die'];
export const VERBS = {
  // movement
  walk_to: { who: 'actors', req: ['to'], args: { to: LOC } },
  run_to: { who: 'actors', req: ['to'], args: { to: LOC } },
  follow: { who: 'actors', req: ['to'], args: { to: TGT, dist: NUM } },
  face: { who: 'actors', req: ['to'], args: { to: LOC } },
  hold: { who: 'actors', args: {} },
  dodge: { who: 'actors', args: { to: LOC, dir: en('left', 'right', 'back', 'forward') } },
  jump: { who: 'actors', args: {} },
  teleport: { who: 'actors', req: ['to'], args: { to: LOC } },
  // combat
  fight: { who: 'actors', req: ['target'], args: { target: MOB, until: COND } },
  skill: { who: 'actors', req: ['skill'], args: { skill: 'skill', target: TGT, until: COND } },
  guard: { who: 'actors', args: { on: BOOL } },
  parry: { who: 'actors', args: {} },
  use_item: { who: 'actors', args: { item: en('potion', 'tonic', 'draught') } },
  ready: { who: 'actors', args: {} },
  // body
  say: { who: 'actors', req: ['text'], args: { text: STR, ch: en('say', 'party') } },
  emote: { who: 'actors', req: ['anim'], args: { anim: en(...EMOTES) } },
  pose: { who: 'actors', req: ['k'], args: { k: en('kneel', 'sit', 'bow', 'none') }, api: 'setPose' },
  // lifecycle
  die: { who: 'actors', args: { respawn: BOOL }, api: 'scriptDeath' },
  revive: { who: 'actors', args: {}, api: 'scriptRevive' },
  wait: { who: 'none', args: { secs: NUM, until: COND } },
  // staging (F3)
  boss_move: { who: 'mob', req: ['move'], args: { move: en(...MOVES), target: TGT }, api: 'forceBossMove' },
  reserve_last_attack: { who: 'none', req: ['target'], args: { target: MOB, for: 'actor?' }, api: 'reserveLastAttack' },
  twists: { who: 'none', req: ['set'], args: { set: en('off', 'random', ...TWIST_IDS) }, api: 'setTwistOverride' },
  spawn: { who: 'none', req: ['type', 'at', 'label'], args: { type: en(...Object.keys(MOBS).filter(t => !MOBS[t].boss && !MOBS[t].prop)), at: LOC, label: STR }, api: 'spawnMob' },
  give_item: { who: 'actors', req: ['name'], args: { name: STR, slot: en('weapon', 'armor', 'charm'), desc: STR }, api: 'giveKeepsake' },
  protect: { who: 'actors', args: { min: NUM }, api: 'protect' },
  // picture (F4)
  camera: { who: 'none', req: ['shot'], args: { shot: en(...SHOTS), target: LOC, from: 'actor', secs: NUM }, api: 'cine' },
  slowmo: { who: 'none', args: { secs: NUM, scale: NUM }, api: 'cine' },
  title: { who: 'none', req: ['text'], args: { text: STR, sub: STR, secs: NUM }, api: 'cine' },
  fade: { who: 'none', req: ['to'], args: { to: en('in', 'black'), secs: NUM }, api: 'cine' },
  letterbox: { who: 'none', args: { on: BOOL }, api: 'cine' },
  clean: { who: 'none', args: { on: BOOL }, api: 'cine' },
  light: { who: 'none', req: ['to'], args: { to: en('day', 'eclipse') }, api: 'cine' },
  // world (F6)
  bell: { who: 'none', args: { floor: NUM }, api: 'ringBell' },
  // team (G5): show the last boss fight's MVP card to everyone (no card shows during a show otherwise)
  mvp: { who: 'none', args: { secs: NUM }, api: 'showMvp' },
};
export const CUE_FIELDS = new Set(['who', 'do', 'id', 'after', 'delay', 'hold']);
export const SCENE_FIELDS = new Set(['id', 'place', 'light', 'marks', 'absent', 'cues']);
export const TOP_FIELDS = new Set(['title', 'episode', 'cast', 'scenes']);
export const CAST_FIELDS = new Set(['id', 'name', 'class', 'style', 'level', 'skill']);

// A say line's default hold: like a speech bubble, 1.6 s + 0.07 s per character, 2-5 s.
export const sayHold = text => Math.min(5, Math.max(2, 1.6 + 0.07 * String(text || '').length));

// Voice-over files for say lines (scripts/film/voices.mjs makes them): public/voice/<episode dir>/<key>.mp3, one per
// cast member and line. The key only depends on who says what, so the server can name the file without the voice map.
export const voiceDir = sheet => `ep${String(sheet?.episode ?? 'x').replace(/[^\w-]/g, '')}`;
export const voiceKey = (castId, text) => createHash('sha1').update(`${castId}\n${String(text)}`).digest('hex').slice(0, 12);

// ---------- conditions (`until`) ----------
// <target>_hp < N% (also <=, >, >=), <target>_dead, <target>_broken, gate_open, t > N (seconds into the scene).
// Returns { kind, target?, op?, v? } or null.
export function parseCond(s) {
  s = String(s ?? '').trim();
  let m;
  if ((m = s.match(/^(\w+?)_hp\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)\s*%$/))) return { kind: 'hp', target: m[1], op: m[2], v: +m[3] / 100 };
  if ((m = s.match(/^(\w+?)_(dead|broken)$/))) return { kind: m[2], target: m[1] };
  if (s === 'gate_open') return { kind: 'gate' };
  if ((m = s.match(/^t\s*(>=|>)\s*(\d+(?:\.\d+)?)$/))) return { kind: 't', v: +m[2] };
  return null;
}

// ---------- parsing ----------
export function parseSheet(text) {
  let doc;
  try { doc = YAML.parse(String(text ?? '')); } catch (e) { return { error: `YAML: ${e.message.split('\n')[0]}` }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'The sheet must be a YAML mapping with title, cast and scenes.' };
  return { sheet: doc };
}

const isXZ = v => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && isFinite(n));
export const whoList = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

// ---------- validation ----------
// has(name): does this server have Game method `name` (F3-F6 APIs)? Problems: { scene, cue, msg } with 1-based indices
// (scene 0 / cue 0 = the sheet / the scene itself); api: true marks a verb whose module isn't on this server.
export function validateSheet(sheet, { has = () => true } = {}) {
  const errors = [], warnings = [];
  const err = (scene, cue, msg, extra) => errors.push({ scene, cue, msg, ...extra });
  const warn = (scene, cue, msg) => warnings.push({ scene, cue, msg });
  if (!sheet || typeof sheet !== 'object') { err(0, 0, 'No sheet loaded.'); return { errors, warnings }; }
  for (const k of Object.keys(sheet)) if (!TOP_FIELDS.has(k)) warn(0, 0, `Unknown top-level field "${k}" (ignored).`);
  if (!sheet.title) warn(0, 0, 'No title.');

  // cast
  const cast = new Map();
  if (!Array.isArray(sheet.cast) || !sheet.cast.length) err(0, 0, 'cast must be a list of actors.');
  for (const [i, a] of (Array.isArray(sheet.cast) ? sheet.cast : []).entries()) {
    const at = `cast[${i + 1}]`;
    if (!a || typeof a !== 'object') { err(0, 0, `${at} is not a mapping.`); continue; }
    for (const k of Object.keys(a)) if (!CAST_FIELDS.has(k)) warn(0, 0, `${at}: unknown field "${k}".`);
    const id = String(a.id ?? '');
    if (!/^[a-z][\w]*$/i.test(id)) err(0, 0, `${at}: id must be a word (letters, digits, _).`);
    else if (cast.has(id)) err(0, 0, `${at}: duplicate id "${id}".`);
    else if (id === 'all' || BOSSES[id] || id === 'prev') err(0, 0, `${at}: "${id}" is a reserved word.`);
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,14}[A-Za-z0-9]$/.test(String(a.name ?? ''))) err(0, 0, `${at}: name must be 2-16 letters, digits, spaces, _ . -`);
    if (!CLASSES[a.class]) err(0, 0, `${at}: unknown class "${a.class}" (one of ${Object.keys(CLASSES).join(', ')}).`);
    if (a.style !== undefined && a.style !== 'default') {
      if (!STYLES[a.style]) err(0, 0, `${at}: unknown weapon style "${a.style}".`);
      else if (CLASSES[a.class] && STYLES[a.style].cls !== a.class) err(0, 0, `${at}: style "${a.style}" belongs to ${STYLES[a.style].cls}, not ${a.class}.`);
    }
    if (a.level !== undefined && !(Number.isInteger(a.level) && a.level >= 1 && a.level <= MAX_LEVEL)) err(0, 0, `${at}: level must be 1-${MAX_LEVEL}.`);
    if (a.skill !== undefined && !(Number.isInteger(a.skill) && a.skill >= 1 && a.skill <= 5)) err(0, 0, `${at}: skill (capability) must be 1-5.`);
    if (id) cast.set(id, a);
  }
  if (!has('protect')) warn(0, 0, 'protect (F3) is missing on this server: actors can die during a take.');
  if (!has('clearStaging')) warn(0, 0, 'clearStaging (F3) is missing on this server: stop() cleans up what it can.');

  // spawn labels (anywhere in the sheet: a later scene can refer to an earlier spawn)
  const labels = new Set();
  const scenes = Array.isArray(sheet.scenes) ? sheet.scenes : [];
  if (!scenes.length) err(0, 0, 'scenes must be a non-empty list.');
  for (const sc of scenes) for (const c of Array.isArray(sc?.cues) ? sc.cues : []) if (c?.do === 'spawn' && c.label) labels.add(String(c.label));
  for (const l of labels) if (cast.has(l) || BOSSES[l] || LANDMARKS[l]) err(0, 0, `spawn label "${l}" clashes with an actor, boss or landmark name.`);

  const isActor = v => cast.has(String(v));
  const isMob = v => !!BOSSES[v] || labels.has(String(v));
  const checkLoc = (v, S, C, what) => {
    if (isXZ(v) || (typeof v === 'string' && (LANDMARKS[v] || isActor(v) || isMob(v)))) return true;
    err(S, C, `${what}: "${Array.isArray(v) ? `[${v}]` : v}" is not a landmark, actor, boss/spawn label or [x, z].`);
    return false;
  };
  const checkCond = (v, S, C) => {
    const c = parseCond(v);
    if (!c) return err(S, C, `until: can't read "${v}" (try warden_hp < 50%, warden_dead, warden_broken, gate_open, t > 10).`);
    if (c.target && !isActor(c.target) && !isMob(c.target)) err(S, C, `until: unknown target "${c.target}".`);
  };
  const sceneIds = new Set();

  scenes.forEach((sc, si) => {
    const S = si + 1;
    if (!sc || typeof sc !== 'object') return err(S, 0, 'Scene is not a mapping.');
    for (const k of Object.keys(sc)) if (!SCENE_FIELDS.has(k)) warn(S, 0, `Unknown scene field "${k}" (ignored).`);
    if (!sc.id) warn(S, 0, 'Scene has no id.');
    else if (sceneIds.has(String(sc.id))) err(S, 0, `Duplicate scene id "${sc.id}".`);
    sceneIds.add(String(sc.id));
    if (!PLACES[sc.place]) err(S, 0, `Unknown place "${sc.place}" (one of ${Object.keys(PLACES).join(', ')}).`);
    if (sc.light !== undefined && !['day', 'eclipse'].includes(sc.light)) err(S, 0, `light must be day or eclipse.`);
    if (sc.light !== undefined && !has('cine')) err(S, 0, 'light needs cine() (F4), missing on this server.', { api: true });
    const absent = whoList(sc.absent);
    for (const a of absent) if (!isActor(a)) err(S, 0, `absent: unknown actor "${a}".`);
    if (sc.marks !== undefined && (typeof sc.marks !== 'object' || Array.isArray(sc.marks))) err(S, 0, 'marks must be a mapping actor: landmark.');
    for (const [a, v] of Object.entries(sc.marks || {})) {
      if (!isActor(a)) err(S, 0, `marks: unknown actor "${a}".`);
      if (absent.includes(a)) warn(S, 0, `marks: "${a}" is also absent.`);
      if (typeof v === 'string' && isMob(v)) err(S, 0, `marks: ${a} can't be marked on a mob.`);
      else checkLoc(v, S, 0, `marks.${a}`);
      if (typeof v === 'string' && LANDMARKS[v] && PLACES[sc.place] && LANDMARKS[v].floor !== PLACES[sc.place].floor) warn(S, 0, `marks.${a}: ${v} is on another floor than ${sc.place}.`);
    }
    const cues = Array.isArray(sc.cues) ? sc.cues : [];
    if (!cues.length) err(S, 0, 'Scene has no cues.');
    const present = [...cast.keys()].filter(a => !absent.includes(a));
    const ids = new Map();
    cues.forEach((c, ci) => {
      const C = ci + 1;
      if (!c || typeof c !== 'object' || Array.isArray(c)) return err(S, C, 'Cue is not a mapping.');
      const V = VERBS[c.do];
      if (!V) return err(S, C, `Unknown verb "${c.do}".`);
      for (const k of Object.keys(c)) if (!CUE_FIELDS.has(k) && !(k in V.args)) warn(S, C, `${c.do}: unknown field "${k}" (ignored).`);
      for (const k of V.req || []) if (c[k] === undefined || c[k] === null || c[k] === '') err(S, C, `${c.do} needs "${k}".`);
      if (V.api && !has(V.api)) err(S, C, `${c.do} needs ${V.api}() (${apiOwner(V.api)}), missing on this server.`, { api: true });
      // timing
      if (c.id !== undefined) { if (ids.has(String(c.id))) err(S, C, `Duplicate cue id "${c.id}".`); ids.set(String(c.id), ci); }
      if (c.after !== undefined && c.after !== 'prev') {
        const j = ids.get(String(c.after));
        if (j === undefined) err(S, C, `after: no earlier cue with id "${c.after}" in this scene.`);
      }
      if (c.after === 'prev' && ci === 0) warn(S, C, 'after: prev on the first cue (starts with the scene).');
      for (const k of ['delay', 'hold']) if (c[k] !== undefined && !(typeof c[k] === 'number' && c[k] >= 0 && c[k] < 600)) err(S, C, `${k} must be seconds (0-600).`);
      // who
      const who = whoList(c.who);
      if (V.who === 'actors') {
        if (!who.length) err(S, C, `${c.do} needs who (an actor, a list, or all).`);
        for (const w of who) {
          if (w === 'all') { if (who.length > 1) err(S, C, 'who: all can\'t be mixed with names.'); continue; }
          if (!isActor(w)) err(S, C, `who: unknown actor "${w}".`);
          else if (absent.includes(w)) err(S, C, `who: ${w} is absent from this scene.`);
        }
      } else if (V.who === 'mob') {
        if (who.length !== 1 || !isMob(who[0])) err(S, C, `${c.do} needs who: warden, sovereign or a spawn label.`);
      } else if (who.length) warn(S, C, `${c.do} is a director cue: who is ignored.`);
      const actors = who.includes('all') ? present : who.filter(isActor);
      // args
      for (const [k, kind] of Object.entries(V.args)) {
        const v = c[k];
        if (v === undefined || v === null) continue;
        if (kind === LOC) checkLoc(v, S, C, k);
        else if (kind === TGT) { if (!isActor(v) && !isMob(v)) err(S, C, `${k}: "${v}" is not an actor, boss or spawn label.`); }
        else if (kind === MOB) { if (!isMob(v)) err(S, C, `${k}: "${v}" is not warden, sovereign or a spawn label.`); }
        else if (kind === 'actor' || kind === 'actor?') { if (!isActor(v)) err(S, C, `${k}: unknown actor "${v}".`); }
        else if (kind === COND) checkCond(v, S, C);
        else if (kind === NUM) { if (typeof v !== 'number' || !isFinite(v) || v < 0) err(S, C, `${k} must be a number.`); }
        else if (kind === BOOL) { if (typeof v !== 'boolean') err(S, C, `${k} must be true or false.`); }
        else if (kind === STR) { if (typeof v !== 'string' || !v.trim()) err(S, C, `${k} must be text.`); }
        else if (kind.enum) { if (!kind.enum.includes(v)) err(S, C, `${k}: "${v}" isn't one of ${kind.enum.join(', ')}.`); }
        else if (kind === 'skill') {
          for (const a of actors) {
            const cls = cast.get(a)?.class, skills = CLASSES[cls]?.skills || [];
            const ok = typeof v === 'number' ? Number.isInteger(v) && v >= 1 && v < skills.length : skills.some(s => s.id === v);
            if (!ok) err(S, C, `skill: ${a} (${cls}) has no skill "${v}" (${skills.slice(1).map(s => s.id).join(', ')} or slot 1-3).`);
            else {
              const sk = typeof v === 'number' ? skills[v] : skills.find(s => s.id === v);
              if ((cast.get(a)?.level || 1) < (sk.lvl || 1)) err(S, C, `skill: ${a} is level ${cast.get(a)?.level || 1}; ${sk.name} unlocks at ${sk.lvl}.`);
            }
          }
        }
      }
      if (c.do === 'wait' && c.secs === undefined && c.until === undefined) err(S, C, 'wait needs secs or until.');
      if (c.do === 'say' && typeof c.text === 'string' && c.text.length > 120) warn(S, C, 'say: a long line (bubbles read best under ~12 words).');
      if (c.do === 'face' && typeof c.to === 'string' && actors.length === 1 && c.to === actors[0]) err(S, C, `${actors[0]} can't face themself.`);
      if ((c.do === 'walk_to' || c.do === 'run_to' || c.do === 'follow') && typeof c.to === 'string' && actors.includes(c.to)) err(S, C, `${c.to} can't ${c.do} themself.`);
      if (c.do === 'guard' || c.do === 'parry') for (const a of actors) if (cast.get(a)?.class !== 'guardian') warn(S, C, `${c.do}: only a Guardian can guard (${a} is a ${cast.get(a)?.class}).`);
      if (c.do === 'camera' && c.shot === 'over_shoulder' && !c.from) err(S, C, 'camera over_shoulder needs from (an actor).');
      if (c.do === 'camera' && c.shot !== 'free' && c.target === undefined) err(S, C, `camera ${c.shot} needs a target.`);
      if (c.do === 'camera' && (c.shot === 'pov' || c.shot === 'eyes') && c.target !== undefined && !isActor(c.target)) err(S, C, `camera ${c.shot} needs an actor as target (whose view).`);
    });
  });
  return { errors, warnings };
}

const OWNERS = { forceBossMove: 'F3', reserveLastAttack: 'F3', scriptDeath: 'F3', scriptRevive: 'F3', protect: 'F3', setTwistOverride: 'F3', spawnMob: 'F3', giveKeepsake: 'F3', clearStaging: 'F3', cine: 'F4', setPose: 'F5', ringBell: 'F6', showMvp: 'G5' };
export const apiOwner = name => OWNERS[name] || '?';
export const API_NAMES = Object.keys(OWNERS);

// ---------- the cue timeline ----------
// A cue starts together with the previous cue; `after: prev` when the previous one finishes; `after: <id>` when that
// cue finishes; `delay` waits that long after the trigger. step() starts and finishes cues (start(i), done(i) -> bool)
// until nothing changes, so chains of instant cues resolve in one tick. The scene is over when every cue has finished.
export class Timeline {
  constructor(cues, t0 = 0) {
    this.cues = cues.map(c => ({ after: c.after, delay: Number(c.delay) || 0, id: c.id === undefined ? null : String(c.id) }));
    this.t0 = t0;
    this.startedAt = cues.map(() => null);
    this.finishedAt = cues.map(() => null);
    this.byId = new Map(this.cues.map((c, i) => [c.id, i]).filter(([id]) => id !== null));
  }
  trigger(i) {
    if (i === 0) return this.t0;
    const c = this.cues[i];
    if (c.after === 'prev') return this.finishedAt[i - 1];
    if (c.after !== undefined && c.after !== null) { const j = this.byId.get(String(c.after)); return j === undefined || j >= i ? null : this.finishedAt[j]; }
    return this.startedAt[i - 1];
  }
  step(now, start, done) {
    for (let changed = true, guard = 0; changed && guard < 1000; guard++) {
      changed = false;
      for (let i = 0; i < this.cues.length; i++) {
        if (this.startedAt[i] === null) {
          const tr = this.trigger(i);
          if (tr === null || now + 1e-9 < tr + this.cues[i].delay) continue;
          this.startedAt[i] = now; changed = true;
          start(i);
        }
        if (this.finishedAt[i] === null && done(i)) { this.finishedAt[i] = now; changed = true; }
      }
    }
  }
  get over() { return this.finishedAt.every(t => t !== null); }
  running() { return this.cues.map((_, i) => i).filter(i => this.startedAt[i] !== null && this.finishedAt[i] === null); }
}
