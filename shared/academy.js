// The Academy (docs/briefs/academy.md): Initiates and their weapons, the Initiate kit, class trials, drills, medals,
// class ranks, the hall heads and cohorts. Data and pure rules, shared by the server (server/academy.js), the client
// (public/academy.js, the creation screen) and the tests. The yard and its enemies: shared/academyyard.js.
import { CLASSES, MAX_LEVEL } from './data.js';
import { cleanSubs } from './subclasses.js'; // specialisation at level 15 (docs/briefs/subclasses.md)
export { ACADEMY, YARD, PENS, nearAcademy, penAt, inYard } from './academyyard.js';

// ---------- weapons ----------
// Order is the order on the creation screen (and the cohort tables); ids are saved in characters.path.weapon.
// base / style: the class and weapon style an Initiate fights with (so combat stays one code path).
// leads: the classes its trials open (in this order). Wand stays a Cleric weapon: the Wand is already a Cleric style
// (fast, long bolts that interrupt); the Bard has no wand-like style, so it is reached by trial, as from the staff.
export const WEAPON_IDS = ['sword', 'spear', 'bow', 'staff', 'wand'];
export const WEAPONS = {
  sword: { name: 'Sword', base: 'swordsman', style: 'sword', leads: ['swordsman', 'guardian', 'berserker'], blurb: 'Quick combos up close. The blade every school starts from.' },
  spear: { name: 'Spear', base: 'lancer', style: 'lance', leads: ['lancer', 'guardian'], blurb: 'Reach and thrusts: hit from where they can\'t hit back.' },
  bow: { name: 'Bow', base: 'ranger', style: 'longbow', leads: ['ranger'], blurb: 'Arrows from range. Keep your distance, pick your shots.' },
  staff: { name: 'Staff', base: 'cleric', style: 'staff', leads: ['cleric', 'bard'], blurb: 'Bolts that interrupt, and the first mending words.' },
  wand: { name: 'Wand', base: 'cleric', style: 'wand', leads: ['cleric', 'bard'], blurb: 'Fast, long bolts and a little healing. Light in the hand.' },
};
// Own-key lookups: ids come from clients and the database, and plain objects answer 'constructor' / 'toString' too.
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
export const isWeapon = w => own(WEAPONS, w);
export const isClass = c => own(CLASSES, c);
// A graduated character's weapon family (legacy characters, cohort picks).
export const CLASS_WEAPON = { swordsman: 'sword', guardian: 'sword', berserker: 'sword', lancer: 'spear', ranger: 'bow', cleric: 'staff', bard: 'staff' };
export const weaponOfClass = cls => (own(CLASS_WEAPON, cls) ? CLASS_WEAPON[cls] : 'sword');

// The weapon style granted at graduation: [class][the Initiate's weapon] (else the class default, '').
export const GRAD_STYLE = {
  swordsman: { sword: 'sword' }, guardian: { sword: 'shield', spear: 'spear' }, berserker: { sword: 'greataxe' },
  lancer: { spear: 'lance' }, ranger: { bow: 'longbow' }, cleric: { staff: 'staff', wand: 'wand' }, bard: {},
};
export const gradStyle = (cls, weapon) => (own(GRAD_STYLE, cls) && own(GRAD_STYLE[cls], weapon) ? GRAD_STYLE[cls][weapon] : '');

// ---------- the Initiate kit ----------
// pow: x attack and healing. lockedSlot: the level-3 skill stays shut until graduation. trialLvl: trials open.
export const INITIATE = { pow: 0.85, lockedSlot: 3, trialLvl: 5, gradRarity: 1 };
// Plain names for the base classes' first three skills while an Initiate (the full names come at graduation).
export const INITIATE_NAMES = {
  swordsman: { slash: 'Strike', rush: 'Lunge', whirl: 'Spin' },
  lancer: { lthrust: 'Jab', lcharge: 'Dash Strike', lsweep: 'Low Sweep' },
  ranger: { shot: 'Shot', pierce: 'Power Shot', disengage: 'Leap Back' },
  cleric: { smite: 'Bolt', heal: 'Mend', bless: 'Encourage' },
};
export const isInitiate = path => path?.stage === 'initiate';
export const initiateName = (cls, skId) => INITIATE_NAMES[cls]?.[skId] || null;
// What the HUD calls skill `i` of `cls` for this path (null: the normal name).
export function kitName(path, cls, i) {
  if (!isInitiate(path)) return null;
  const sk = CLASSES[cls]?.skills[i];
  return sk ? initiateName(cls, sk.id) || sk.name : null;
}
export const kitLocked = (path, slot) => isInitiate(path) && slot === INITIATE.lockedSlot;
export const pathLabel = (path, cls) => isInitiate(path) ? `Initiate · ${isWeapon(path.weapon) ? WEAPONS[path.weapon].name : 'Sword'}` : isClass(cls) ? CLASSES[cls].name : '';

// ---------- medals ----------
export const MEDALS = ['', 'Bronze', 'Silver', 'Gold'];
export const MEDAL_COLORS = ['#94a3b8', '#d97706', '#cbd5e1', '#facc15'];
// tiers: [bronze, silver, gold] thresholds; low: a lower score is better (seconds, hits taken).
// A low score earns a medal only when the goal was met (done); a high score needs the threshold reached.
export function medalFor(def, score, done = true) {
  if (!def || !done || !Number.isFinite(score)) return 0;
  let m = 0;
  def.tiers.forEach((t, i) => { if (def.low ? score <= t : score >= t) m = i + 1; });
  return m;
}

// ---------- class trials ----------
// One per class, solo, in a yard pen, with that class's full kit loaned. kind: how server/academy.js runs and scores it.
// secs: the time limit. unit: the score's unit (panel, HUD).
export const TRIALS = {
  swordsman: { name: 'The Golem Break', kind: 'break', secs: 45, low: true, tiers: [45, 30, 20], unit: 's', goal: 'Break the Training Golem, then bring it down. Burst Combo fills its posture fast.' },
  guardian: { name: 'The Long Hold', kind: 'hold', secs: 30, tiers: [50, 75, 90], unit: '%', goal: 'Three Training Wolves go for the Ward Post. Hold them on you for 30 s: any wolf nobody holds gnaws it. Taunt!' },
  berserker: { name: 'The Woodpile', kind: 'fell', secs: 40, n: 6, low: true, tiers: [40, 30, 20], unit: 's', goal: 'Fell all six Training Dummies. They stand in clusters: hit them together.' },
  lancer: { name: 'The Spear\'s Tip', kind: 'tip', secs: 30, tiers: [8, 12, 16], unit: ' hits', goal: 'Dummies step in on you. Land hits at the tip of your reach (2.4 m and further): step back, then thrust.' },
  ranger: { name: 'The Running Mark', kind: 'movers', secs: 30, tiers: [5, 8, 11], unit: ' down', goal: 'Targets strafe across the pen. Bring down as many as you can in 30 s.' },
  cleric: { name: 'The Vigil', kind: 'mend', secs: 30, tiers: [1, 50, 70], unit: '%', goal: 'The Ward Post takes blows for 30 s. Your heals mend it (stay within 15 m). Keep it standing.' },
  bard: { name: 'The Chorus', kind: 'buff', secs: 30, tiers: [14, 22, 30], unit: ' pts', goal: 'Keep the Ward Post buffed for 30 s: a song on it scores 1 a second, a Crescendo 2 a second (within 12 m).' },
};

export const isTrial = id => own(TRIALS, id);

// ---------- drills (open to everyone, graduated or not; your own kit) ----------
export const DRILL_IDS = ['dodge', 'punish', 'windup', 'interrupt', 'revive', 'chain'];
export const DRILLS = {
  dodge: { name: 'Perfect Dodge', kind: 'dodge', secs: 40, tiers: [3, 5, 8], unit: ' perfect', goal: 'The golem swings slowly. Roll into the swing at the last moment: a perfect dodge.' },
  punish: { name: 'Break, then Switch', kind: 'punish', secs: 45, tiers: [1, 2, 3], unit: ' Breaks', goal: 'Fill the golem\'s posture to BREAK it, then hit it while it\'s Broken. In a party that hit is the Switch.' },
  windup: { name: 'Read the Wind-up', kind: 'windup', secs: 30, low: true, tiers: [4, 2, 0], unit: ' hits', goal: 'Stand your ground beside a golem and two wolves for 30 s. Step out of every red telegraph. Fewer hits taken is better.' },
  interrupt: { name: 'Interrupt the Cast', kind: 'interrupt', secs: 40, tiers: [2, 4, 6], unit: ' stopped', goal: 'The caster channels a long cast. A big hit (a knockback, Smite, Dissonance) mid cast stops it.' },
  revive: { name: 'Revive Under Fire', kind: 'revive', secs: 45, tiers: [2, 3, 4], unit: ' revived', goal: 'Stand by the fallen dummy for 3 s to revive it while wolves harass you. Getting hit starts the 3 s again.' },
  chain: { name: 'Skill Chain', kind: 'chain', secs: 40, tiers: [2, 3, 4], unit: '', goal: 'Link your skills on the dummies: a skill, then another, before the chain lapses. Your best chain counts (x2, x3, x4).' },
};
export const isDrill = id => own(DRILLS, id);
// One-time rewards per drill medal tier (each tier pays once; reaching gold first pays all three).
export const DRILL_REWARD = [null, { gold: 25 }, { gold: 50, cons: { tonic: 1 } }, { gold: 100, cons: { draught: 1 } }];
export const REVIVE_SECS = 3, REVIVE_R = 2.6;

// ---------- class rank ----------
// pts: medal points (bronze 1, silver 2, gold 3; the best medal per trial and per drill). floors: floor bosses beaten
// (the Warden, the Sovereign, the Colossus: any kill counts).
export const RANKS = [
  { id: 'novice', name: 'Novice', pts: 0, floors: 0 },
  { id: 'adept', name: 'Adept', pts: 6, floors: 0 },
  { id: 'expert', name: 'Expert', pts: 16, floors: 1 },
  { id: 'master', name: 'Master', pts: 30, floors: 3 },
];
export const medalPoints = path => [...Object.values(path?.trials || {}), ...Object.values(path?.drills || {})].reduce((s, m) => s + (m | 0), 0);
export const floorsBeaten = stats => ((stats?.wardenKills | 0) > 0) + ((stats?.sovereignKills | 0) > 0) + ((stats?.colossusKills | 0) > 0);
export function rankOf(path, stats) {
  const pts = medalPoints(path), fl = floorsBeaten(stats);
  let r = 0;
  RANKS.forEach((k, i) => { if (pts >= k.pts && fl >= k.floors) r = i; });
  return r;
}
export const rankName = i => RANKS[i]?.name || RANKS[0].name;

// ---------- changing class (graduates) ----------
export const CHANGE_FEE = { base: 100, perLvl: 20 };
export const changeFee = lvl => CHANGE_FEE.base + CHANGE_FEE.perLvl * Math.max(1, Math.min(MAX_LEVEL, lvl | 0));

// ---------- the hall heads (the Named) ----------
export const HEADS = { swordsman: 'halvard', guardian: 'halvard', cleric: 'maribel', bard: 'maribel', ranger: 'tovin', lancer: 'sennet', berserker: 'cairn' };
export const headOf = cls => (own(HEADS, cls) ? HEADS[cls] : null);
export const HEAD_FRIENDSHIP = 2; // x the medal, when you pass that head's class trial
export const HEAD_LINES = {
  halvard: ['Shield up before you need it. Not after.', 'A blade is for the space between their swings. Learn the space.', 'Hold the line long enough and the line holds you.'],
  maribel: ['Heal early. A full bar forgives; an empty one doesn\'t.', 'Songs or salves, it is the same work: keep them standing.', 'Watch the healthiest one too. They are the next to fall.'],
  tovin: ['Breathe out, then loose. Every time.', 'If they reach you, you stood in the wrong place.', 'Mark the big one. Let the party do the rest.'],
  sennet: ['The tip is where the spear lives. Keep them there.', 'Step back is a strike too, if you mean it.', 'Reach is a promise: you hit first.'],
  cairn: ['Hit it until it stops. Then hit the next one.', 'Rage is just a bill. Pay it on their side.', 'They taught me nothing here. Learn more than I did.'],
};
export const headLine = (named, i) => { const L = own(HEAD_LINES, named) ? HEAD_LINES[named] : []; return L.length ? L[Math.abs(i | 0) % L.length] : ''; };

// ---------- cohorts (bot classmates) ----------
export const COHORT_MAX = 2;
export const COHORT = { sword: ['spear', 'staff'], spear: ['sword', 'staff'], bow: ['sword', 'staff'], staff: ['sword', 'spear'], wand: ['sword', 'spear'] };
export const COHORT_NAMES = ['Wren', 'Ossian', 'Lark', 'Tamsy', 'Brice', 'Ilsa', 'Fenn', 'Corra', 'Juniper', 'Rowan', 'Edda', 'Pim'];
const ROLE_NEEDS = ['Tank', 'Healer', 'Support', 'Damage'];
// The classes the cohort's bots graduate into: the roles the player's class lacks (Tank, then Healer), each from a class
// that bot's weapon leads to; a bot that fills no missing role takes its weapon's first class.
export function cohortClasses(playerCls, botWeapons) {
  const have = new Set([CLASSES[playerCls]?.role || 'Damage']), out = botWeapons.map(() => null);
  for (const role of ROLE_NEEDS) {
    if (have.has(role)) continue;
    const i = botWeapons.findIndex((w, k) => !out[k] && WEAPONS[w]?.leads.some(c => CLASSES[c]?.role === role));
    if (i < 0) continue;
    out[i] = WEAPONS[botWeapons[i]].leads.find(c => CLASSES[c]?.role === role);
    have.add(role);
  }
  return out.map((c, i) => c || WEAPONS[botWeapons[i]]?.leads[0] || 'swordsman');
}

// ---------- the path record (characters.path) ----------
// { stage: 'initiate' | 'class', weapon, trials: { cls: medal }, drills: { id: medal }, keep: { cls: { mastery, talents } },
//   cohort: [bot names], armed (the starter weapon was given), enrolled (first Academy visit done), paid: { drill: medal paid },
//   subs: { cls: subclass id } (shared/subclasses.js: specialised at level 15, per class) }
export function newPath(weapon, stage = 'initiate') {
  return { stage, weapon: isWeapon(weapon) ? weapon : 'sword', trials: {}, drills: {}, keep: {}, cohort: [], armed: 0, enrolled: 0, paid: {}, gear: {} };
}
const medalMap = (raw, ok) => {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) { const m = Math.max(0, Math.min(3, v | 0)); if (ok(k) && m) out[k] = m; }
  return out;
};
// Anything from the database or the admin page: a clean path, or null (no path: a graduated legacy character).
export function cleanPath(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = newPath(raw.weapon, raw.stage === 'initiate' ? 'initiate' : 'class');
  p.trials = medalMap(raw.trials, isTrial);
  p.drills = medalMap(raw.drills, isDrill);
  p.paid = medalMap(raw.paid, isDrill);
  if (raw.keep && typeof raw.keep === 'object' && !Array.isArray(raw.keep)) {
    for (const [cls, v] of Object.entries(raw.keep)) if (isClass(cls) && v && typeof v === 'object') p.keep[cls] = { mastery: v.mastery && typeof v.mastery === 'object' ? v.mastery : null, talents: v.talents && typeof v.talents === 'object' ? v.talents : null };
  }
  p.cohort = Array.isArray(raw.cohort) ? raw.cohort.filter(s => typeof s === 'string').map(s => s.slice(0, 16)).slice(0, COHORT_MAX) : [];
  p.armed = raw.armed ? 1 : 0; p.enrolled = raw.enrolled ? 1 : 0;
  if (raw.gear && typeof raw.gear === 'object' && !Array.isArray(raw.gear)) for (const [w, u] of Object.entries(raw.gear)) if (isWeapon(w) && Number.isInteger(u)) p.gear[w] = u;
  const subs = cleanSubs(raw.subs); if (Object.keys(subs).length) p.subs = subs; // (absent until a first specialisation)
  return p;
}

// Why `cls`'s trial is shut for this character (null: open). path null counts as graduated.
export function trialBlock(path, cls, lvl) {
  if (!isTrial(cls) || !isClass(cls)) return 'No such trial.';
  if (isInitiate(path)) {
    if ((lvl | 0) < INITIATE.trialLvl) return `Class trials open at level ${INITIATE.trialLvl}.`;
    if (!isWeapon(path.weapon) || !WEAPONS[path.weapon].leads.includes(cls)) return `The ${isWeapon(path.weapon) ? WEAPONS[path.weapon].name : 'weapon'} doesn't lead to the ${CLASSES[cls].name}. Change weapon at the armory.`;
  }
  return null;
}
// Why you can't graduate into / change to `cls` now (null: you can).
export function gradBlock(path, cls, curCls, lvl, gold) {
  if (!isClass(cls)) return 'No such class.';
  if (!(own(path?.trials || {}, cls) && path.trials[cls] > 0)) return `Pass the ${CLASSES[cls].name} trial first.`;
  if (isInitiate(path)) return isWeapon(path.weapon) && WEAPONS[path.weapon].leads.includes(cls) ? null : 'That class isn\'t on your weapon\'s path.';
  if (cls === curCls) return `You are already a ${CLASSES[cls].name}.`;
  if ((gold | 0) < changeFee(lvl)) return `Changing class costs ${changeFee(lvl)} gold.`;
  return null;
}
