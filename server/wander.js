// The unlisted specialisation (docs/briefs/subclasses.md, "The hidden path"). Server only: nothing here may move into
// shared/ or public/, so the browser never loads its rules or its name. server/subclasses.js uses it.
// Record: path.found (1 once found at the lectern), path.subs[cls] = WANDER.id, path.wb = { cls: { c, sk, br } }.
import { CLASSES } from '../shared/data.js';
import { TREES } from '../shared/talents.js';
import { SPEC, specFee, subOf } from '../shared/subclasses.js';

const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export const WANDER = { id: 'wanderer', name: 'Your Own Road', lvl: 15, trials: 2, pow: 0.8, tierPow: 0.8 };

// The skills it may take from another class: that class's two level-1 skills (never the basic attack or the level-3 one).
export const borrowable = cls => (CLASSES[cls]?.skills || []).filter((s, i) => i >= 1 && i <= 2).map(s => s.id);
// Classes whose trial this path has passed (medal > 0).
export const passedTrials = path => Object.entries(path?.trials || {}).filter(([, m]) => (m | 0) > 0).map(([c]) => c);
const graduate = path => !!path && path.stage !== 'initiate';
// Does the lectern answer this character? A graduate, level 15+, two different class trials passed.
export const canFind = (path, lvl) => graduate(path) && (lvl | 0) >= WANDER.lvl && passedTrials(path).length >= WANDER.trials;
// The classes it may borrow from: any other class whose trial was passed.
export const borrowFrom = (path, cls) => passedTrials(path).filter(c => c !== cls && own(CLASSES, c));

const okBorrow = (cls, b) => !!b && own(CLASSES, b.c) && b.c !== cls && borrowable(b.c).includes(b.sk) && !!TREES[b.c]?.branches.some(x => x.id === b.br);
// One borrow record per class: { c: other class, sk: one of its borrowable skills, br: a branch id of its tree }.
export function cleanBorrow(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [cls, b] of Object.entries(raw)) {
      if (!own(CLASSES, cls) || !b || typeof b !== 'object') continue;
      const r = { c: String(b.c || ''), sk: String(b.sk || ''), br: String(b.br || '') };
      if (okBorrow(cls, r)) out[cls] = r;
    }
  }
  return out;
}

// After shared cleanPath (which knows nothing of this): put the found flag, the borrow records and the picks back.
export function keepWander(raw, path) {
  if (!path || !raw || typeof raw !== 'object') return path;
  if (raw.found) path.found = 1;
  const wb = cleanBorrow(raw.wb);
  if (Object.keys(wb).length) path.wb = wb;
  if (raw.subs && typeof raw.subs === 'object') for (const [cls, id] of Object.entries(raw.subs)) if (id === WANDER.id && own(CLASSES, cls) && wb[cls]) (path.subs ||= {})[cls] = id;
  return path;
}

// Why this character can't take it now (null: it can). Not found yet: the same answer as any unknown id.
export function wanderBlock(path, cls, lvl, gold, b, unknown) {
  if (!path?.found || !graduate(path)) return unknown;
  if ((lvl | 0) < SPEC.lvl) return `Specialisation opens at level ${SPEC.lvl}.`;
  if (!okBorrow(cls, b) || !borrowFrom(path, cls).includes(b.c)) return 'Choose a skill and a branch from a class whose trial you passed.';
  const cur = subOf(path, cls), old = path.wb?.[cls];
  if (cur === WANDER.id && old && old.c === b.c && old.sk === b.sk && old.br === b.br) return 'You already walk that path.';
  if (cur && (gold | 0) < specFee(lvl)) return `Changing specialisation costs ${specFee(lvl)} gold.`;
  return null;
}

// The borrowed talent effects: the first tier of the chosen branch at full rank, at WANDER.tierPow (talentTotals' shape).
export function borrowedTotals(b) {
  const T = { stat: {}, sk: {}, aura: {} };
  const br = b && TREES[b.c]?.branches.find(x => x.id === b.br);
  if (!br) return T;
  const k = WANDER.tierPow;
  for (const n of br.nodes) {
    if (n.tier !== 0 || n.sub) continue;
    for (const e of n.fx) {
      const v = x => Math.round(x * n.max * k * 100) / 100;
      if (e.stat) T.stat[e.stat] = (T.stat[e.stat] || 0) + v(e.v);
      else if (e.aura) T.aura[e.aura] = (T.aura[e.aura] || 0) + v(e.v);
      else if (e.sk) { const m = (T.sk[e.sk] ||= {}); for (const q of ['cd', 'dmg', 'fin', 'radius', 'dur']) if (e[q]) m[q] = (m[q] || 0) + v(e[q]); }
    }
  }
  return T;
}
