// Bot plans (docs/briefs/bot-plans.md): a short list of steps a bot carries out one after another, each with an end
// condition and a time limit. A plan only decides what the bot is doing now, as an order does: every step drives
// b.cmd, so the brain's own fighting, dodging, potions, revives and rescues go on as before.
//
//   steps    goto <place> · come · follow [s] · wait [s] · guard [place] [s] · farm [monster] [count] · boss ·
//            attack (the player's locked target) · tend [s] · say <line> · emote <sit|bow|kneel|hop> [s] · skill <1-4>
//   arrives  a /b chat line with several steps or arguments (parsePlan, through shared/bots/social.js parseBotChat),
//            the AI mind's intent (server/ai/intent.js `plan`), or b.setPlan(raw, { by, byName, at }) from code
//   cleaned  cleanPlan() is the only way a plan reaches a bot: unknown steps, places and monsters are dropped
//   ends     done, a step that cannot be done, PLAN_MAX seconds, a new order (brain.js command), /b cancel, or the
//            player who gave it leaving the party. A town raid's `defend` pauses it.
//
// Nothing here talks to the server by itself: the brain passes { command, say } to the runner.
import { MOBS } from '../data.js';
import { WAYPOINTS, floorOf, floorUnlocked } from '../floor2.js';
import { FLOOR_X } from '../floor3.js';
import { SMITH } from '../crafting.js';
import { MERCHANT } from '../items.js';
import { HALL } from '../titles.js';
import { ACADEMY } from '../academyyard.js';
import { LIFE_HALL, COOK_FIRE, ALCH_BENCH, GARDEN } from '../life.js';
import { REGISTRAR } from '../guilds.js';
import { useSkill, d2 } from './motor.js';

export const PLAN_STEPS_MAX = 8, PLAN_LOOPS_MAX = 5, PLAN_MAX = 30 * 60; // steps, repeats, seconds for a whole plan
const REACH = 240; // s to get to a place before the plan stops
const COME_R = 6;  // m: "back with the player" (a follower's own spot in the formation is up to 5 m off)

// secs / n: [min, max, default]. limit: s before the step gives up; hard: giving up stops the plan (else it moves on).
// long: worth a "Next: ..." line when it starts.
export const STEPS = {
  goto: { label: 'Go to a place', limit: REACH, hard: true, long: true },
  come: { label: 'Come to me', limit: 120, hard: true, long: true },
  follow: { label: 'Follow me', secs: [5, 900, 60], long: true },
  wait: { label: 'Wait here', secs: [1, 600, 20] },
  guard: { label: 'Guard a place', secs: [10, 900, 120], long: true },
  farm: { label: 'Farm monsters', n: [1, 50, 10], limit: 900, long: true },
  boss: { label: 'Do the boss', limit: 1200, hard: true, long: true },
  attack: { label: 'Attack my target', limit: 120 },
  tend: { label: 'Tend the garden', secs: [10, 900, 180], long: true },
  say: { label: 'Say a line' },
  emote: { label: 'Sit, bow, kneel or hop', secs: [1, 60, 4] },
  skill: { label: 'Use a skill', n: [1, 4, 1], limit: 10 },
};
export const STEP_IDS = Object.keys(STEPS);
export const POSES = ['sit', 'bow', 'kneel', 'hop'];

// Places a step can name. r: the thing's own size (the bot stops just outside it). `camp` is this floor's waypoint;
// `here` is where the player stood when they gave the plan; `spot` is where the bot stands when the step starts.
const W = f => WAYPOINTS.find(w => w.floor === f);
export const PLACES = {
  well: { name: 'the well', floor: 1, x: W(1).x, z: W(1).z, r: W(1).r, words: ['well', 'fountain', 'town', 'town of beginnings', 'spawn', 'home'] },
  smith: { name: 'the smith', floor: 1, ...xzr(SMITH), words: ['smith', 'blacksmith', 'forge', 'anvil', 'smithy'] },
  merchant: { name: 'the merchant', floor: 1, ...xzr(MERCHANT), words: ['merchant', 'shop', 'store', 'vendor', 'trader'] },
  hall: { name: 'the Hall', floor: 1, ...xzr(HALL), words: ['hall', 'hall of titles', 'titles'] },
  academy: { name: 'the Academy', floor: 1, ...xzr(ACADEMY), words: ['academy', 'school'] },
  garden: { name: 'the garden', floor: 1, ...xzr(GARDEN), words: ['garden', 'farm plot', 'plots', 'crops'] },
  lifehall: { name: 'the Life Hall', floor: 1, ...xzr(LIFE_HALL), words: ['lifehall', 'life hall'] },
  fire: { name: 'the cooking fire', floor: 1, ...xzr(COOK_FIRE), words: ['fire', 'cooking fire', 'cookfire', 'kitchen'] },
  bench: { name: 'the alchemy bench', floor: 1, ...xzr(ALCH_BENCH), words: ['bench', 'alchemy bench', 'alchemy', 'alchemist'] },
  registrar: { name: 'the guild registrar', floor: 1, ...xzr(REGISTRAR), words: ['registrar', 'guild', 'guild registrar', 'guild hall'] },
  field: { name: 'the field', floor: 1, x: FLOOR_X[1], z: 60, r: 0, words: ['field', 'fields', 'meadow', 'verdant field'] },
  gate: { name: 'the raid gate', floor: 1, x: FLOOR_X[1], z: 134, r: 0, words: ['gate', 'raid gate', 'boss gate', 'chamber gate'] }, // (just short of the ready zone)
  camp2: { name: 'Mirelight Camp', floor: 2, x: W(2).x, z: W(2).z, r: W(2).r, words: ['mirelight', 'mirelight camp', 'mire camp', 'mire', 'floor 2', 'floor two'] },
  camp3: { name: 'Windbreak Camp', floor: 3, x: W(3).x, z: W(3).z, r: W(3).r, words: ['windbreak', 'windbreak camp', 'spire camp', 'floor 3', 'floor three'] },
  camp: { name: 'the waypoint', words: ['camp', 'waypoint', 'base'] },
  here: { name: 'your spot', words: ['here', 'me', 'my spot', 'this spot', 'my position', 'you'] },
  spot: { name: 'this spot', words: ['spot'] },
};
function xzr(o) { return { x: o.x, z: o.z, r: o.r || 0 }; }

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\b(the|to|at|a|an|of|for|some|my|your|go|goto|back|over|by|near|in|into|on)\b/g, ' ').replace(/\s+/g, ' ').trim();

// A place id from loose text ("the smith", "to the raid gate"), or ''.
export function placeOf(text) {
  const raw = String(text ?? '').toLowerCase().trim();
  if (PLACES[raw]) return raw;
  if (/^(me|you|here|my spot|your spot|this spot)$/.test(raw.replace(/\b(to|at)\b/g, '').trim())) return 'here';
  const t = norm(text);
  if (!t) return '';
  if (PLACES[t]) return t;
  for (const [id, p] of Object.entries(PLACES)) if (p.words.includes(t)) return id;
  for (const [id, p] of Object.entries(PLACES)) if (p.words.some(w => w.length > 3 && new RegExp(`(^| )${w}( |$)`).test(t))) return id;
  return '';
}

// A monster kind from loose text ("boars", "dire wolves", "Mire Shieldback"), or ''. Never a boss, a prop, a duel
// stand-in, an Academy dummy or a labyrinth monster.
const FARMABLE = Object.entries(MOBS).filter(([, d]) => !d.boss && !d.prop && !d.duel && !d.academy && !d.lab);
const singular = w => w.replace(/wolves$/, 'wolf').replace(/ies$/, 'y').replace(/(ch|sh|x|ss)es$/, '$1').replace(/([^s])s$/, '$1');
export function mobKind(text) {
  const t = norm(text).split(' ').map(singular).join(' ');
  if (!t) return '';
  const hit = FARMABLE.find(([id]) => id === t.replace(/ /g, ''))
    || FARMABLE.find(([, d]) => d.name.toLowerCase() === t)
    || FARMABLE.find(([, d]) => d.name.toLowerCase().split(' ').pop() === t)
    || FARMABLE.find(([, d]) => new RegExp(`(^| )${t.replace(/[^a-z0-9' ]/g, '')}( |$)`).test(d.name.toLowerCase()));
  return hit ? hit[0] : '';
}
const ANY_MOB = /^(|any|anything|mob|monster|enemy|enemie|thing|stuff|kill|whatever|xp|level)$/;

const int = (v, [lo, hi, def]) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : def; };
const line = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[/\\]+/, '').slice(0, 120); // (never a slash command)
const LINKISH = /(https?:\/\/|www\.|\.(com|net|org|gg|io)\b)/i;

// One raw step ({ k | do, what | place | mob | text | pose, n | secs | slot }) → a clean one, or { error }.
function cleanStep(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const k = String(o.k ?? o.do ?? '').toLowerCase().trim();
  const S = STEPS[k];
  if (!S) return { error: `"${String(o.k ?? o.do ?? '').slice(0, 16)}" isn't a plan step` };
  const what = o.what ?? o.place ?? o.mob ?? o.text ?? o.pose ?? '';
  const num = o.n ?? o.secs ?? o.slot ?? 0;
  const secs = S.secs ? { secs: Number(num) > 0 ? int(num, S.secs) : 0 } : {}; // (0: the step's default)
  switch (k) {
    case 'goto': { const place = placeOf(what); if (!String(what).trim()) return { error: 'Go where? Name a place' }; return place && place !== 'spot' ? { k, place } : { error: `I don't know a place called "${String(what).slice(0, 20)}"` }; }
    case 'guard': { const place = norm(what) || String(what).trim() ? placeOf(what) : 'spot'; return place ? { k, place, ...secs } : { error: `I don't know a place called "${String(what).slice(0, 20)}"` }; }
    case 'farm': {
      const t = norm(what).split(' ').map(singular).join(' ');
      const mob = ANY_MOB.test(t) ? '' : mobKind(what);
      if (!mob && !ANY_MOB.test(t)) return { error: `I don't know a monster called "${String(what).slice(0, 20)}"` };
      return { k, ...(mob ? { mob } : {}), n: int(num, S.n) };
    }
    case 'say': { const text = line(what); return text && !LINKISH.test(text) ? { k, text } : { error: 'nothing to say' }; }
    case 'emote': { const pose = String(what).toLowerCase().trim().replace(/^jump$/, 'hop'); return POSES.includes(pose) ? { k, pose, ...secs } : { error: `"${String(what).slice(0, 12)}" isn't a pose (sit, bow, kneel, hop)` }; }
    case 'skill': { const slot = Math.round(Number(num) || Number(String(what).replace(/\D/g, ''))); return slot >= 1 && slot <= 4 ? { k, slot } : { error: 'skills are 1 to 4' }; }
    default: return { k, ...secs }; // come, follow, wait, boss, attack, tend
  }
}

// Raw → { steps, loops, errors } (the only shape a bot takes), or null when no step survives.
export function cleanPlan(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.steps) ? raw.steps : [];
  const steps = [], errors = [];
  for (const r of list.slice(0, 24)) {
    const s = cleanStep(r);
    if (s.error) errors.push(s.error); else if (steps.length < PLAN_STEPS_MAX) steps.push(s);
  }
  if (!steps.length) return errors.length ? { steps, loops: 1, errors } : null;
  return { steps, loops: Math.min(PLAN_LOOPS_MAX, Math.max(1, Math.round(Number(raw?.loops) || 1))), errors };
}

// ---------- chat: "/b farm 10 boars then go smith then come" ----------
const WORDS = {
  goto: ['go', 'goto', 'walk', 'run', 'head', 'travel', 'move'],
  come: ['come', 'regroup', 'rally', 'return'],
  follow: ['follow', 'f'],
  wait: ['wait', 'stay', 'hold', 'stop', 'halt'],
  guard: ['guard', 'defend', 'protect', 'watch'],
  farm: ['farm', 'grind', 'hunt', 'kill'],
  boss: ['boss', 'warden', 'sovereign', 'colossus', 'raid'],
  attack: ['attack', 'focus', 'assist', 'hit'],
  tend: ['tend', 'garden'],
  say: ['say', 'tell', 'shout'],
  emote: ['emote', 'sit', 'bow', 'kneel', 'hop', 'jump'],
  skill: ['skill', 'cast', 'use'],
};
const STEP_OF = new Map(Object.entries(WORDS).flatMap(([k, ws]) => ws.map(w => [w, k])));
const REPEAT = /^(?:repeat|loop|again)\s*(?:x\s*)?(\d+)?(?:\s*(?:x|times?))?$|^x\s*(\d+)$/i;
const word = s => String(s).toLowerCase().replace(/[^\w']/g, '');
export const isStepWord = w => STEP_OF.has(word(w)) || /^(repeat|loop)$/.test(word(w));
export const splitSteps = text => String(text || '').split(/\s*(?:;|>|→|,?\s*\b(?:and\s+)?then\b,?)\s*/i).map(s => s.trim()).filter(Boolean);

// A chat order → { steps, loops } | { error } | null (not plan-shaped at all: no step word first).
// bare: a single step with no arguments (the caller may treat it as the plain old order).
export function parsePlan(text) {
  const segs = splitSteps(text);
  if (!segs.length || !isStepWord(segs[0].split(/\s+/)[0])) return null;
  const raw = []; let loops = 1, bare = segs.length === 1;
  for (const seg of segs) {
    const rep = REPEAT.exec(seg);
    if (rep) { loops = Number(rep[1] || rep[2]) || 2; continue; }
    const words = seg.split(/\s+/), k = STEP_OF.get(word(words[0]));
    if (!k) return { error: `"${words[0].slice(0, 16)}" isn't a plan step. Type /b help for the list.` };
    let rest = words.slice(1).join(' ');
    if (k === 'say') { raw.push({ k, what: rest.replace(/^["'“”]+|["'“”]+$/g, '') }); bare = false; continue; }
    let n = 0;
    const time = /(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b/i.exec(rest);
    if (time && STEPS[k].secs) { n = Number(time[1]) * (/^m/i.test(time[2]) ? 60 : 1); rest = rest.replace(time[0], ' '); }
    else { const num = /\b(\d+)\b/.exec(rest); if (num) { n = Number(num[1]); rest = rest.replace(num[0], ' '); } }
    if (k === 'emote' && word(words[0]) !== 'emote') rest = `${word(words[0])} ${rest}`.trim().split(' ')[0]; // "sit 10"
    if (k === 'emote') rest = rest.trim().split(/\s+/)[0] || '';
    if (k === 'boss' || k === 'come' || k === 'attack' || k === 'tend' || k === 'follow' || k === 'wait' || k === 'skill') { if (k !== 'skill') rest = ''; }
    else if (norm(rest) || k === 'emote') bare = false;
    if (n) bare = false;
    raw.push({ k, what: rest.trim(), n });
  }
  if (!raw.length) return { error: 'A plan needs at least one step. Type /b help for the list.' };
  const plan = cleanPlan({ steps: raw, loops });
  if (!plan || plan.errors.length) return { error: `${plan?.errors[0] || 'That plan has no steps I know'}. Type /b help for the list.` };
  return { steps: plan.steps, loops: plan.loops, bare: bare && loops === 1 };
}

// Extra /b help lines (system lines for the player who asked).
export function planHelp() {
  return [
    'Plans: chain steps with "then", e.g. /b farm 10 boars then go smith then come. /b cancel stops one.',
    '  steps: go <place> · come · follow [30s] · wait [30s] · guard [place] [2m] · farm [monster] [count] · boss · attack · tend [3m] · say <line> · sit / bow / kneel / hop · skill <1-4> · repeat <n>',
    `  places: ${Object.entries(PLACES).filter(([id]) => id !== 'spot').map(([, p]) => p.words[0]).join(', ')}`,
  ];
}

// ---------- words ----------
const dur = s => (s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const mobName = (id, n) => { const nm = MOBS[id]?.name || id; return n === 1 ? nm : /s$/.test(nm) ? nm : `${nm}s`; };
export function stepText(s) {
  switch (s.k) {
    case 'goto': return `go to ${PLACES[s.place]?.name || s.place}`;
    case 'come': return 'come back to you';
    case 'follow': return s.secs ? `follow you for ${dur(s.secs)}` : 'follow you';
    case 'wait': return `wait ${dur(s.secs || STEPS.wait.secs[2])}`;
    case 'guard': return `guard ${PLACES[s.place]?.name || 'this spot'} for ${dur(s.secs || STEPS.guard.secs[2])}`;
    case 'farm': return s.mob ? `${s.n} ${mobName(s.mob, s.n)}` : `${s.n} kills in the field`;
    case 'boss': return 'the boss';
    case 'attack': return 'your target';
    case 'tend': return `tend the garden for ${dur(s.secs || STEPS.tend.secs[2])}`;
    case 'say': return `say "${s.text.length > 24 ? `${s.text.slice(0, 22)}…` : s.text}"`;
    case 'emote': return s.pose;
    case 'skill': return `skill ${s.slot}`;
  }
  return s.k;
}
export function planText(p) {
  if (!p?.steps?.length) return '';
  const body = p.steps.length === 1 ? stepText(p.steps[0]) : p.steps.map((s, i) => `${i + 1}) ${stepText(s)}`).join(' ');
  return `Plan: ${body}${p.loops > 1 ? ` (x${p.loops})` : ''}`.slice(0, 200);
}
// "step 2/3: 4/10 Forest Boars" (status line, goal text, admin page, the AI's prompt), or ''.
export function planProgress(b) {
  const p = b?.plan; if (!p) return '';
  const s = p.steps[p.i]; if (!s) return '';
  const what = s.k === 'farm' ? `${p.st?.kills || 0}/${s.n} ${s.mob ? mobName(s.mob, s.n) : 'kills'}` : stepText(s);
  return `step ${p.i + 1}/${p.steps.length}${p.loops > 1 ? ` (round ${p.loop + 1}/${p.loops})` : ''}: ${what}`;
}

// ---------- the runner ----------
// Take a plan. o: { by (player id, 0 = code / admin page), byName, adm (not a party order), at ([x, z] of that player),
// group (bot ids addressed), all, quiet (don't announce) }. api: { command, say } from the brain. Returns the clean
// plan, or null (nothing usable, or a scripted actor).
export function setPlan(b, raw, o = {}, api) {
  const c = cleanPlan(raw);
  if (!c?.steps.length || b.script || b.closed) return null;
  const group = o.group?.length ? o.group : [b.id];
  const first = group.filter(id => id === b.id || b.players?.some(p => p.id === id && !p.dead))[0] === b.id; // one bot speaks for a group
  b.plan = { steps: c.steps, loops: c.loops, loop: 0, i: 0, by: o.by || 0, byName: o.byName || '', adm: !!o.adm, at: Array.isArray(o.at) && Number.isFinite(+o.at[0]) && Number.isFinite(+o.at[1]) ? [+o.at[0], +o.at[1]] : null, group, all: group.length > 1, speak: first || group.length < 2, t0: b.t, st: null, pause: null };
  b.cmd = null; b.tgtId = null;
  if (o.by) b.lastCmdBy = o.by;
  if (!o.quiet) tell(b, api, planText(b.plan) + '.');
  return c;
}

// Drop the plan (and the order it was running, unless keep).
export function endPlan(b, keep = false) {
  const p = b.plan; if (!p) return;
  if (p.st?.pose && p.st.pose !== 'hop') b.send?.({ type: 'chat', text: '/stand' });
  b.plan = null;
  if (!b.cmd?.plan) return;
  if (keep) delete b.cmd.plan; else b.cmd = null;
}

const tell = (b, api, text) => { if (b.plan?.speak !== false) api?.say?.(b, 'plan', {}, { force: true, text: text.slice(0, 200) }); };
const who = p => p.byName || 'boss';
function stop(b, api, why) { tell(b, api, `Plan stopped: ${why}.`); endPlan(b); }

// Where a step's place is for this bot now: { x, z, r, floor, name } or null.
function resolve(b, p, id) {
  if (id === 'spot' || !id) return { x: b.x, z: b.z, r: 0, floor: floorOf(b.x), name: 'this spot' };
  if (id === 'here') { const [x, z] = p.at || [b.x, b.z]; return { x, z, r: 0, floor: floorOf(x), name: 'your spot' }; }
  if (id === 'camp') { const w = WAYPOINTS.find(w => w.floor === floorOf(b.x)) || WAYPOINTS[0]; return { x: w.x, z: w.z, r: w.r, floor: w.floor, name: w.name }; }
  const pl = PLACES[id];
  return pl ? { x: pl.x, z: pl.z, r: pl.r, floor: pl.floor, name: pl.name } : null;
}
const order = (p, b, more) => ({ by: p.by, byName: p.byName || 'admin', adm: p.adm || !p.by, at: b.t, plan: 1, ...more });
const hold = (b, p, pl, more = {}) => { b.cmd = order(p, b, { k: 'stay', x: pl.x, z: pl.z, stop: pl.r ? pl.r + 1.2 : 1.2, fl: pl.floor, ...more }); };
const arrived = (b, st) => floorOf(b.x) === st.fl && d2(b.x, b.z, st.x, st.z) <= st.stop + 1.3;

// Start step s. Returns a reason (string) when it cannot be done at all.
function begin(b, P, p, s, api) {
  const st = p.st = { t0: b.t };
  const give = (k, more = {}) => { api.command(b, { k, by: p.by, byName: p.byName, group: p.group, all: p.all, adm: p.adm, quiet: true, plan: 1, ...more }); if (b.cmd) b.cmd.plan = 1; };
  switch (s.k) {
    case 'goto': case 'guard': {
      const pl = resolve(b, p, s.place);
      if (!pl) return `I don't know that place`;
      if (pl.floor !== floorOf(b.x) && !floorUnlocked(b.life, pl.floor)) return `Floor ${pl.floor} is sealed for me`;
      Object.assign(st, { x: pl.x, z: pl.z, fl: pl.floor, stop: pl.r ? pl.r + 1.2 : 1.2, name: pl.name, at: null });
      hold(b, p, pl, s.k === 'guard' ? { guard: 1 } : {});
      return;
    }
    case 'come': case 'follow':
      if (!p.by) return 'nobody to go to';
      give(s.k);
      return;
    case 'wait': hold(b, p, { x: b.x, z: b.z, r: 0, floor: floorOf(b.x) }); return;
    case 'farm':
      give('farm');
      if (b.cmd && s.mob) b.cmd.mob = s.mob;
      st.kills = 0; st.seen = b.t;
      return;
    case 'boss': give('boss'); return;
    case 'attack': {
      const tgt = b.locks?.get(p.by) || 0;
      if (tgt) give('attack', { tgt });
      if (b.cmd?.k !== 'attack') { st.skip = true; api.say?.(b, 'noTarget', { who: who(p) }, { force: true }); }
      return;
    }
    case 'tend':
      if (floorOf(b.x) !== 1) return `the garden is on Floor 1`;
      hold(b, p, { x: GARDEN.x + 4, z: GARDEN.z + 3, r: 0, floor: 1 }, { tend: 1, stop: 0.8 });
      return;
    case 'say': api.say?.(b, 'plan', {}, { force: true, text: s.text }); return;
    case 'emote':
      hold(b, p, { x: b.x, z: b.z, r: 0, floor: floorOf(b.x) });
      st.pose = s.pose;
      b.send(s.pose === 'hop' ? { type: 'jump' } : { type: 'chat', text: `/${s.pose}` });
      return;
    case 'skill': return;
  }
}

// Is step s over? 'done', a reason (string: the plan stops) or null (still going).
function check(b, P, p, s) {
  const st = p.st, S = STEPS[s.k], t = b.t - st.t0;
  const secs = s.secs || S.secs?.[2] || 0;
  switch (s.k) {
    case 'goto':
      if (arrived(b, st)) return 'done';
      break;
    case 'guard':
      if (st.at == null) { if (arrived(b, st)) st.at = b.t; else if (t > REACH) return `I couldn't get to ${st.name}`; return null; }
      return b.t - st.at >= secs ? 'done' : null;
    case 'come': {
      const q = b.players?.find(q => q.id === p.by);
      if (!q) return `I can't find ${who(p)}`;
      if (floorOf(q.x) === floorOf(b.x) && d2(q.x, q.z, b.x, b.z) < COME_R) return 'done';
      break;
    }
    case 'follow':
      if (!s.secs && p.i === p.steps.length - 1 && p.loop === p.loops - 1) return 'keep'; // the last step: stays following
      return t >= secs ? 'done' : null;
    case 'wait': case 'tend': return t >= secs ? 'done' : null;
    case 'farm': {
      if (st.kills >= s.n) return 'done';
      if (s.mob) {
        const fl = floorOf(b.x);
        if ((b.allMobs || b.mobs || []).some(m => m.type === s.mob && floorOf(m.x) === fl)) st.seen = b.t;
        else if (b.t - st.seen > 90) return `there are no ${mobName(s.mob, 2)} on this floor`;
      }
      break;
    }
    case 'boss': if (st.bossDown) return 'done'; break;
    case 'attack': if (st.skip || b.cmd?.k !== 'attack') return 'done'; break;
    case 'say': return t >= 1.5 ? 'done' : null;
    case 'emote':
      if (t < (s.pose === 'hop' ? 1 : secs)) return null;
      if (s.pose !== 'hop') b.send({ type: 'chat', text: '/stand' });
      st.pose = null;
      return 'done';
    case 'skill': if (useSkill(b, s.slot, b.face)) return 'done'; break;
  }
  if (S.limit && t > S.limit) return S.hard ? ({ goto: `I couldn't get to ${st.name}`, come: `I couldn't reach ${who(p)}`, boss: 'the boss is still standing' })[s.k] : 'done';
  return null;
}

// Once per think turn, before the brain picks its mode. api: { command, say }.
export function planTurn(b, P, api) {
  const p = b.plan; if (!p) return;
  if (b.script) return endPlan(b);
  if (!p.adm && p.by && !P.all.some(q => q.id === p.by)) return endPlan(b); // the player who gave it left the party
  if (b.cmd?.defend) { p.pause ??= b.t; return; } // a town raid: the plan waits (brain.js 'release' puts our order back)
  if (p.pause != null) { const d = b.t - p.pause; p.pause = null; p.t0 += d; if (p.st) { p.st.t0 += d; if (p.st.at != null) p.st.at += d; if (p.st.seen != null) p.st.seen += d; } }
  if (b.dead) return;
  if (b.t - p.t0 > PLAN_MAX) return void stop(b, api, 'it took too long');
  for (let n = 0; n < 3; n++) { // (a few instant steps a turn at most)
    const s = p.steps[p.i];
    if (!p.st) {
      b.cmd = null;
      const why = begin(b, P, p, s, api);
      if (why) return void stop(b, api, why);
      if ((p.i > 0 || p.loop > 0) && STEPS[s.k].long) tell(b, api, `Next: ${stepText(s)}.`);
    } else if (!b.cmd && s.k !== 'attack' && s.k !== 'say' && s.k !== 'skill') { // our order was dropped (the brain lost sight of someone): give it again
      const was = p.st, why = begin(b, P, p, s, api);
      if (why) return void stop(b, api, why);
      p.st = { ...p.st, ...was }; // (its clock and counts carry on)
    }
    const r = check(b, P, p, s);
    if (!r) return;
    if (r !== 'done' && r !== 'keep') return void stop(b, api, r);
    p.st = null;
    if (++p.i >= p.steps.length) {
      if (++p.loop < p.loops) p.i = 0;
      else { tell(b, api, r === 'keep' ? `On you, ${who(p)}.` : `Plan done, ${who(p)}.`); return endPlan(b, r === 'keep'); }
    }
  }
}

// Brain events the plan counts: kills for a farm step, the boss going down. hits: who hit that mob (the b.hits entry;
// hits.kind: its monster kind, noted at the first hit).
export function planEvent(b, e, { hits, mateOf }) {
  const p = b.plan, st = p?.st, s = p && p.steps[p.i];
  if (!st || e.t !== 'die') return;
  const ours = !!hits && [...hits.keys()].some(id => id === b.id || mateOf(b, id));
  if (!ours) return;
  if (s.k === 'boss' && e.b) st.bossDown = true;
  if (s.k === 'farm' && !e.b && (!s.mob || hits.kind === s.mob)) st.kills++;
}
