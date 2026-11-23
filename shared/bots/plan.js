// Bot plans (docs/briefs/bot-plans.md): a short list of steps a bot carries out one after another, each with an end
// condition and a time limit. A plan only decides what the bot is doing now, as an order does: every step drives
// b.cmd, so the brain's own fighting, dodging, potions, revives and rescues go on as before.
//
//   steps    goto <place> · come · follow [s] · wait [s] · guard [place] [s] · farm [monster] [count] · boss ·
//            attack (the player's locked target) · tend [s] · say <line> · emote <sit|bow|kneel|hop> [s] · skill <1-4> ·
//            sell (spare gear, at the merchant) · buy [count] (potions, at the merchant)
//   arrives  a /b chat line with several steps or arguments (parsePlan, through shared/bots/social.js parseBotChat),
//            the AI mind's intent (server/ai/intent.js `plan`), or b.setPlan(raw, { by, byName, at }) from code
//   cleaned  cleanPlan() is the only way a plan reaches a bot: unknown steps, places and monsters are dropped
//   ends     done, a step that cannot be done, PLAN_MAX seconds, a new order (brain.js command), /b cancel, or the
//            player who gave it leaving the party. A town raid's `defend` pauses it, and so does being down.
//            A last step of goto, or of wait / follow with no time, is kept as the bot's order: it stays there.
//
// This file is the menu, the parsing, the cleaning and the words: no bot code, so the client can load it (through
// shared/bots/social.js). The runner that drives a bot through a plan is shared/bots/planrun.js.
import { MOBS } from '../data.js';
import { WAYPOINTS } from '../floor2.js';
import { FLOOR_X } from '../floor3.js';
import { SMITH } from '../crafting.js';
import { MERCHANT, CONSUMABLES } from '../items.js';
import { HALL } from '../titles.js';
import { ACADEMY } from '../academyyard.js';
import { LIFE_HALL, COOK_FIRE, ALCH_BENCH, GARDEN } from '../life.js';
import { REGISTRAR } from '../guilds.js';

export const PLAN_STEPS_MAX = 8, PLAN_LOOPS_MAX = 5, PLAN_MAX = 30 * 60; // steps, repeats, seconds for a whole plan
export const REACH = 240; // s to get to a place before the plan stops
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined); // (never a key from the prototype: "constructor", "__proto__")

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
  emote: { label: 'Sit, bow, kneel or hop', secs: [1, 300, 4] },
  skill: { label: 'Use a skill', n: [1, 4, 1], limit: 10 },
  sell: { label: 'Sell spare gear at the merchant', limit: REACH + 90, hard: true, long: true },
  buy: { label: 'Buy potions at the merchant', n: [1, 10, 3], limit: REACH + 90, hard: true },
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

const norm = s => String(s ?? '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|to|at|a|an|of|for|some|my|your|go|goto|back|over|by|near|in|into|on)\b/g, ' ').replace(/\s+/g, ' ').trim();

// A place id from loose text ("the smith", "to the raid gate"), or ''.
export function placeOf(text) {
  const raw = String(text ?? '').toLowerCase().trim();
  if (own(PLACES, raw)) return raw;
  if (/^(me|you|here|my spot|your spot|this spot|my position)$/.test(raw.replace(/\b(to|at)\b/g, '').trim())) return 'here';
  const t = norm(text);
  if (!t) return '';
  if (own(PLACES, t)) return t;
  for (const [id, p] of Object.entries(PLACES)) if (p.words.includes(t)) return id;
  for (const [id, p] of Object.entries(PLACES)) if (p.words.some(w => w.length > 3 && new RegExp(`(^| )${w}( |$)`).test(t))) return id;
  return '';
}

// A monster kind from loose text ("boars", "dire wolves", "Mire Shieldback"), or ''. Never a boss, a prop, a duel
// stand-in, an Academy dummy or a labyrinth monster.
const singular = w => w.replace(/wolves$/, 'wolf').replace(/ies$/, 'y').replace(/(ch|sh|x|ss)es$/, '$1').replace(/([^s])s$/, '$1');
const mobKey = s => norm(s).split(' ').map(singular).join(' '); // "Warden's Hounds" and "wardens hound" are the same words
const FARMABLE = Object.entries(MOBS).filter(([, d]) => !d.boss && !d.prop && !d.duel && !d.academy && !d.lab).map(([id, d]) => [id, mobKey(d.name)]);
const BOSS_WORDS = new Set(Object.values(MOBS).filter(d => d.boss).flatMap(d => mobKey(d.name).split(' ')));
export function mobKind(text) {
  const t = mobKey(text);
  if (!t) return '';
  const hit = FARMABLE.find(([id]) => id === t.replace(/ /g, ''))
    || FARMABLE.find(([, name]) => name === t)
    || FARMABLE.find(([, name]) => name.endsWith(` ${t}`)); // "hounds", "shieldback"
  if (hit) return hit[0];
  if (t.split(' ').some(w => BOSS_WORDS.has(w))) return ''; // ("warden" is the boss, not its hounds)
  const some = FARMABLE.filter(([, name]) => ` ${name} `.includes(` ${t} `)); // a first word, when only one monster has it
  return some.length === 1 ? some[0][0] : '';
}
const ANY_MOB = /^(|any|anything|mob|monster|enemy|enemie|thing|stuff|kill|whatever)$/;
const POTION = /^((health|hp|healing|more) )?(potion|pot)$/; // (mobKey words: singular)

const int = (v, [lo, hi, def]) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : def; };
const line = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s/\\]+/, '').trim().slice(0, 120); // (never a slash command: no slash survives at the start, however many there were)
const LINKISH = /(https?:\/\/|www\.|\.(com|net|org|gg|io)\b)/i;

// One raw step ({ k | do, what | place | mob | text | pose, n | secs | slot }) → a clean one, or { error }.
function cleanStep(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const k = String(o.k ?? o.do ?? '').toLowerCase().trim();
  const S = own(STEPS, k);
  if (!S) return { error: `"${String(o.k ?? o.do ?? '').slice(0, 16)}" isn't a plan step` };
  const what = o.what ?? o.place ?? o.mob ?? o.text ?? o.pose ?? '';
  const num = o.n ?? o.secs ?? o.slot ?? 0;
  const secs = S.secs ? { secs: Number(num) > 0 ? int(num, S.secs) : 0 } : {}; // (0: the step's default)
  switch (k) {
    case 'goto': { const place = placeOf(what); if (!String(what).trim()) return { error: 'Go where? Name a place' }; return place && place !== 'spot' ? { k, place } : { error: `I don't know a place called "${String(what).slice(0, 20)}"` }; }
    case 'guard': { const place = norm(what) || String(what).trim() ? placeOf(what) : 'spot'; return place ? { k, place, ...secs } : { error: `I don't know a place called "${String(what).slice(0, 20)}"` }; }
    case 'farm': {
      const t = mobKey(what);
      const mob = ANY_MOB.test(t) ? '' : mobKind(what);
      if (!mob && !ANY_MOB.test(t)) return { error: `I don't know a monster called "${String(what).slice(0, 20)}"` };
      return { k, ...(mob ? { mob } : {}), n: int(num, S.n) };
    }
    case 'say': { const text = line(what); return text && !LINKISH.test(text) ? { k, text } : { error: 'nothing to say' }; }
    case 'emote': { const pose = String(what).toLowerCase().trim().replace(/^jump$/, 'hop'); return POSES.includes(pose) ? { k, pose, ...secs } : { error: `"${String(what).slice(0, 12)}" isn't a pose (sit, bow, kneel, hop)` }; }
    case 'skill': { const slot = Math.round(Number(num) || Number(String(what).replace(/\D/g, ''))); return slot >= 1 && slot <= 4 ? { k, slot } : { error: 'skills are 1 to 4' }; }
    case 'buy': { const t = mobKey(what); return !t || POTION.test(t) ? { k, n: int(num, S.n) } : { error: `I only buy ${CONSUMABLES.potion.name}s` }; }
    default: return { k, ...secs }; // come, follow, wait, boss, attack, tend, sell
  }
}

// Raw → { steps, loops, errors } (the only shape a bot takes), or null when no step survives. strict (the AI mind's
// plans): stop at the first step that isn't usable, so a plan is never carried out with a hole in the middle.
export function cleanPlan(raw, { strict = false } = {}) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.steps) ? raw.steps : [];
  const steps = [], errors = [];
  for (const r of list.slice(0, 24)) {
    const s = cleanStep(r);
    if (s.error) { errors.push(s.error); if (strict) break; } else if (steps.length < PLAN_STEPS_MAX) steps.push(s);
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
  sell: ['sell'],
  buy: ['buy', 'restock'],
};
const STEP_OF = new Map(Object.entries(WORDS).flatMap(([k, ws]) => ws.map(w => [w, k])));
const REPEAT = /^(?:repeat|loop|again)\s*(?:x\s*)?(\d+)?(?:\s*(?:x|times?))?$|^x\s*(\d+)$/i;
const word = s => String(s).toLowerCase().replace(/[^\w']/g, '');
export const isStepWord = w => STEP_OF.has(word(w)) || /^(repeat|loop|again|x\d+)$/.test(word(w));
export const isSayWord = w => STEP_OF.get(word(w)) === 'say';

// A line → its steps. ";" and ">" always split. "then" splits too, and so does "and" before a step word ("go smith and
// come"); inside a line to say they only split when a step word follows ("say see you then" stays whole).
export function splitSteps(text) {
  const out = [];
  for (const chunk of String(text || '').split(/\s*[;>→]\s*/)) {
    const words = chunk.trim().split(/\s+/).filter(Boolean);
    let cur = [];
    const push = () => { if (cur.length) out.push(cur.join(' ').replace(/,+$/, '')); cur = []; };
    const saying = () => cur.length > 0 && isSayWord(cur[0]);
    const splitsAt = j => !saying() || (j + 1 < words.length && isStepWord(words[j + 1])); // would the "then" at j split?
    for (let i = 0; i < words.length; i++) {
      const w = words[i].toLowerCase().replace(/^,+|,+$/g, ''), next = words[i + 1];
      if (!cur.length && (w === 'then' || w === 'and')) continue;
      if (w === 'and' && next && /^then,?$/i.test(next) && splitsAt(i + 1)) continue; // "and then"
      if (w === 'then' && splitsAt(i)) { push(); continue; }
      if (w === 'and' && !saying() && next && isStepWord(next)) { push(); continue; }
      cur.push(words[i]);
    }
    push();
  }
  return out;
}

// "90", "2m", "1m30s", "2 min" out of a step's words → { secs, left }.
const TIME = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;
function takeTime(rest) {
  let secs = 0;
  const left = rest.replace(TIME, (_, v, u) => { secs += Number(v) * (/^h/i.test(u) ? 3600 : /^m/i.test(u) ? 60 : 1); return ' '; });
  if (secs) return { secs: Math.round(secs), left };
  const num = /\b(\d+)\b/.exec(rest);
  return num ? { secs: Number(num[1]), left: rest.replace(num[0], ' ') } : { secs: 0, left: rest };
}

// A chat order → { steps, loops, bare } | { error, soft } | null (not plan-shaped at all: no step word first).
// bare: a single step with no arguments, and soft: a single step whose words mean nothing to a plan and hold no
// number ("farm here", "kill it"): the caller keeps the plain old order for both.
export function parsePlan(text) {
  const segs = splitSteps(text);
  if (!segs.length || !isStepWord(segs[0].split(/\s+/)[0])) return null;
  const raw = []; let loops = 1, bare = segs.length === 1, counted = false;
  for (const seg of segs) {
    const rep = REPEAT.exec(seg);
    if (rep) { loops = Number(rep[1] || rep[2]) || 2; continue; }
    const words = seg.split(/\s+/), first = word(words[0]), k = STEP_OF.get(first);
    if (!k) return { error: `"${words[0].slice(0, 16)}" isn't a plan step. Type /b help for the list.` };
    let rest = words.slice(1).join(' '), n = 0;
    switch (k) {
      case 'say': rest = rest.replace(/^["'“”]+|["'“”]+$/g, ''); bare = false; break;
      case 'goto': if (norm(rest)) bare = false; break; // (no number: "go floor 2" is a place)
      case 'guard': {
        const t = rest.replace(TIME, ' ') !== rest ? takeTime(rest) : null, end = /^(.*?)\s*\b(\d+)\s*$/.exec(rest);
        if (t) { n = t.secs; rest = t.left; } else if (end && (!norm(end[1]) || placeOf(end[1]))) { n = Number(end[2]); rest = end[1]; } // ("guard floor 2" is a place, "guard here 60" a time)
        if (norm(rest)) bare = false;
        break;
      }
      case 'farm': {
        const num = /\b(\d+)\b/.exec(rest);
        if (num) { n = Number(num[1]); rest = rest.replace(num[0], ' '); }
        if (first === 'kill' && !n) rest = ''; // "kill it", "kill the boar": the old attack order (a count makes it a hunt)
        else if (!ANY_MOB.test(mobKey(rest))) bare = false; // ("farm mobs" with no count is the plain farm order, with no end)
        break;
      }
      case 'emote': {
        const t = takeTime(rest); n = t.secs;
        rest = (first === 'emote' ? t.left.trim().split(/\s+/)[0] : first) || '';
        bare = false;
        break;
      }
      case 'follow': case 'wait': case 'tend': n = takeTime(rest).secs; rest = ''; break;
      case 'skill': { const num = /\d+/.exec(rest); n = num ? Number(num[0]) : 0; rest = ''; bare = false; break; }
      case 'sell': rest = ''; bare = false; break; // ("sell loot", "sell everything": it sells what it doesn't wear)
      case 'buy': { const num = /\b(\d+)\b/.exec(rest); if (num) { n = Number(num[1]); rest = rest.replace(num[0], ' '); } bare = false; break; }
      default: rest = ''; // come, boss, attack
    }
    if (n) { bare = false; counted = true; }
    raw.push({ k, what: rest.trim(), n });
  }
  if (!raw.length) return { error: 'A plan needs at least one step. Type /b help for the list.' };
  const plan = cleanPlan({ steps: raw, loops });
  if (!plan || plan.errors.length) return { error: `${plan?.errors[0] || 'That plan has no steps I know'}. Type /b help for the list.`, soft: segs.length === 1 && !counted };
  return { steps: plan.steps, loops: plan.loops, bare: bare && loops === 1 };
}

// Extra /b help lines (system lines for the player who asked).
export function planHelp() {
  return [
    'Plans: chain steps with "then", e.g. /b farm 10 boars then go smith then come. /b cancel stops one. A plan that ends with "go <place>" or "wait" leaves the bot there.',
    '  steps: go <place> · come · follow [30s] · wait [30s] · guard [place] [2m] · farm [monster] [count] · boss · attack · tend [3m] · say <line> · sit / bow / kneel / hop · skill <1-4> · sell · buy [3] potions · repeat <n>',
    `  places: ${Object.entries(PLACES).filter(([id]) => id !== 'spot').map(([, p]) => p.words[0]).join(', ')}`,
  ];
}

// ---------- words ----------
const dur = s => (s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const plural = nm => (/s$/.test(nm) ? nm : /wolf$/i.test(nm) ? nm.replace(/f$/, 'ves') : /[^aeiou]y$/i.test(nm) ? nm.replace(/y$/, 'ies') : /(ch|sh|x)$/i.test(nm) ? `${nm}es` : `${nm}s`);
export const mobName = (id, n) => { const nm = MOBS[id]?.name || id; return n === 1 ? nm : plural(nm); };
// last: the plan's final step (a goto, or a wait with no time, is then where the bot stays).
export function stepText(s, last = false) {
  switch (s.k) {
    case 'goto': return `go to ${PLACES[s.place]?.name || s.place}${last ? ' and wait there' : ''}`;
    case 'come': return 'come back to you';
    case 'follow': return s.secs ? `follow you for ${dur(s.secs)}` : 'follow you';
    case 'wait': return last && !s.secs ? 'wait there' : `wait ${dur(s.secs || STEPS.wait.secs[2])}`;
    case 'guard': return `guard ${PLACES[s.place]?.name || 'this spot'} for ${dur(s.secs || STEPS.guard.secs[2])}`;
    case 'farm': return s.mob ? `${s.n} ${mobName(s.mob, s.n)}` : `${s.n} kills in the field`;
    case 'boss': return 'the boss';
    case 'attack': return 'your target';
    case 'tend': return `tend the garden for ${dur(s.secs || STEPS.tend.secs[2])}`;
    case 'say': return `say "${s.text.length > 24 ? `${s.text.slice(0, 22)}…` : s.text}"`;
    case 'emote': return s.pose;
    case 'skill': return `skill ${s.slot}`;
    case 'sell': return 'sell my spare gear';
    case 'buy': return `buy ${s.n} potion${s.n === 1 ? '' : 's'}`;
  }
  return s.k;
}
export function planText(p) {
  if (!p?.steps?.length) return '';
  const end = p.steps.length - 1;
  const body = end === 0 ? stepText(p.steps[0], true) : p.steps.map((s, i) => `${i + 1}) ${stepText(s, i === end)}`).join(' ');
  return `Plan: ${body}${p.loops > 1 ? ` (x${p.loops})` : ''}`.slice(0, 200);
}
// "step 2/3: 4/10 Forest Boars" (status line, goal text, admin page, the AI's prompt), or ''.
export function planProgress(b) {
  const p = b?.plan; if (!p) return '';
  const s = p.steps[p.i]; if (!s) return '';
  const what = s.k === 'farm' ? `${p.st?.kills || 0}/${s.n} ${s.mob ? mobName(s.mob, s.n) : 'kills'}` : stepText(s);
  return `step ${p.i + 1}/${p.steps.length}${p.loops > 1 ? ` (round ${p.loop + 1}/${p.loops})` : ''}: ${what}`;
}
