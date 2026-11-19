// Post-fight MVP card (docs/ROADMAP.md G5): the card's stats, its fun titles and the pure builder shared by the server
// (server/mvp.js builds and sends it), the client (public/mvp.js draws it), the stats page and test/mvp.js.
// Stats come from the per-fight team counters (teamStat keys, docs/ROADMAP.md "Shared contracts for G") plus `down` and
// `death` (server/mvp.js).

// The card's stats, in display order. big: shown as a number with a bar against the party's best; the rest are counts
// shown when non-zero. one: the name for a count of 1. short: a short label.
export const MVP_STATS = [
  { k: 'dmg', name: 'Damage', short: 'Dmg', big: true },
  { k: 'heal', name: 'Healing', short: 'Heal', big: true },
  { k: 'tanked', name: 'Tanked', short: 'Tank', big: true },
  { k: 'switch', name: 'Switches', one: 'Switch', short: 'Switch' },
  { k: 'break', name: 'Breaks', one: 'Break', short: 'Break' },
  { k: 'combo', name: 'Combos', one: 'Combo', short: 'Combo' },
  { k: 'setup', name: 'Setups', one: 'Setup', short: 'Setup' },
  { k: 'burst', name: 'Team Bursts', one: 'Team Burst', short: 'Burst' },
  { k: 'revive', name: 'Revives', one: 'Revive', short: 'Revive' },
  { k: 'save', name: 'Saves', one: 'Save', short: 'Save' },
  { k: 'cover', name: 'Covers', one: 'Cover', short: 'Cover' },
  { k: 'flank', name: 'Pincers', one: 'Pincer', short: 'Pincer' },
  { k: 'mechanic', name: 'Mechanics', one: 'Mechanic', short: 'Mech' },
  { k: 'lastAttack', name: 'Last Attack', short: 'LA' },
  { k: 'down', name: 'Downs', one: 'Down', short: 'Down', bad: true },
  { k: 'death', name: 'Deaths', one: 'Death', short: 'Death', bad: true },
];
export const MVP_KEYS = MVP_STATS.map(s => s.k);

// Titles. Each goes to the one fighter with the highest score (ties: the higher MVP score), if that score is at least
// `min`; to spread them around, a fighter who already holds a title passes it to the best fighter without one who
// scores at least SHARE of the top (not for `exact` titles). 'each' titles go to every fighter that qualifies. A
// fighter can hold several; the first in this list is their headline. why(r): the line under the title.
const n = v => Math.round(v || 0);
const pl = (v, one, many = `${one}s`) => `${n(v)} ${n(v) === 1 ? one : many}`;
const k = v => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(n(v)));
export const MVP_TITLES = [
  { k: 'lastword', name: 'Last Word', exact: true, score: r => r.lastAttack, min: 1, why: () => 'landed the Last Attack' },
  { k: 'lifeline', name: 'Lifeline', score: r => 2 * r.revive + r.save, min: 1, why: r => [r.revive && pl(r.revive, 'revive'), r.save && pl(r.save, 'save')].filter(Boolean).join(', ') },
  { k: 'wall', name: 'Wall', score: r => r.tanked, min: 1, why: r => `tanked ${k(r.tanked)}` },
  { k: 'conductor', name: 'Conductor', score: r => r.combo + 0.5 * r.setup, min: 1, why: r => [r.combo && pl(r.combo, 'combo'), r.setup && pl(r.setup, 'setup')].filter(Boolean).join(', ') },
  { k: 'breaker', name: 'Breaker', score: r => r.break + 0.25 * r.switch, min: 1, why: r => [r.break && pl(r.break, 'Break'), r.switch && pl(r.switch, 'Switch', 'Switches')].filter(Boolean).join(', ') },
  { k: 'flanker', name: 'Flanker', score: r => r.flank, min: 2, why: r => pl(r.flank, 'Pincer') },
  { k: 'mender', name: 'Mender', score: r => r.heal, min: 1, why: r => `healed ${k(r.heal)}` },
  { k: 'bodyguard', name: 'Bodyguard', score: r => r.cover, min: 1, why: r => pl(r.cover, 'Cover') },
  { k: 'clockwork', name: 'Clockwork', score: r => r.mechanic, min: 2, why: r => `${pl(r.mechanic, 'mechanic')} done right` },
  { k: 'heavy', name: 'Heavy Hitter', score: r => r.dmg, min: 1, why: r => `${k(r.dmg)} damage` },
  { k: 'unshakable', name: 'Unshakable', each: true, ok: (r, c) => c.rows.length >= 2 && !r.down && !r.death && r.dmg + r.heal + r.tanked > 0, why: () => 'never went down' },
];
export const SHARE = 0.85;
export const MVP_TITLE = Object.fromEntries(MVP_TITLES.map(t => [t.k, t]));
export const FALLBACK_TITLE = { k: 'steady', name: 'Steady Hand', why: () => 'there for the team' };

// MVP score: the shares of the party's damage, healing and damage tanked, plus the team plays. Deaths cost a little.
export function mvpScore(r, tot) {
  const sh = key => (tot[key] > 0 ? r[key] / tot[key] : 0);
  return sh('dmg') + 0.8 * sh('heal') + 0.7 * sh('tanked') + 0.05 * (r.combo + r.setup + r.break + r.switch + r.burst)
    + 0.2 * r.revive + 0.12 * r.save + 0.06 * r.cover + 0.02 * r.flank + 0.05 * r.mechanic + 0.15 * r.lastAttack - 0.08 * r.death;
}

// rows: [{ id, name, cls, bot, lvl, ...stats }] -> the card: { boss, floor, result, secs, rows (best first, each with
// score, titles: [title keys], top: [stat keys it led]), mvp: id, tot }.
export function buildCard({ boss, floor, result, secs, rows }) {
  rows = rows.map(r => { const o = { ...r }; for (const key of MVP_KEYS) o[key] = Math.max(0, Math.round(+o[key] || 0)); o.titles = []; o.top = []; return o; });
  const tot = Object.fromEntries(MVP_KEYS.map(key => [key, rows.reduce((s, r) => s + r[key], 0)]));
  for (const r of rows) r.score = Math.round(mvpScore(r, tot) * 1000) / 1000;
  rows.sort((a, b) => b.score - a.score || b.dmg - a.dmg);
  // Humans first: with anyone else in the fight, the Named (rows with `named`, shared/named.js) take a title or the MVP only when no human (else no other fighter) earns it.
  const mixed = rows.some(r => r.named) && rows.some(r => !r.named), humans = rows.filter(r => !r.bot && !r.named);
  const first = !mixed ? rows : humans.length ? humans : rows.filter(r => !r.named);
  const card = { boss, floor, result, secs, rows, tot, mvp: first[0]?.id ?? 0 };
  for (const t of MVP_TITLES) {
    if (t.each) { for (const r of rows) if (t.ok(r, card)) r.titles.push(t.k); continue; }
    let best = null, bs = 0;
    for (const r of first) { const s = t.score(r); if (s > bs + 1e-9) { best = r; bs = s; } } // rows are best-first: ties keep the higher MVP
    if (mixed && (!best || bs < t.min)) { best = null; bs = 0; for (const r of rows) { const s = t.score(r); if (s > bs + 1e-9) { best = r; bs = s; } } }
    if (!best || bs < t.min) continue;
    if (best.titles.length && !t.exact) { // spread: the best fighter still without a title, if close enough
      const alt = (best.named ? rows : first).filter(r => !r.titles.length && t.score(r) >= Math.max(t.min, bs * SHARE)).sort((x, y) => t.score(y) - t.score(x))[0];
      if (alt) best = alt;
    }
    best.titles.push(t.k);
  }
  for (const s of MVP_STATS) { // who led each stat (a highlight on the card; not when a third of the party ties for it)
    if (s.bad || rows.length < 2) continue;
    const m = Math.max(0, ...rows.map(r => r[s.k])), lead = rows.filter(r => r[s.k] === m);
    if (m > 0 && lead.length <= Math.max(1, Math.floor(rows.length / 3))) for (const r of lead) r.top.push(s.k);
  }
  return card;
}
// A title's line for a row.
export function titleLine(key, r) {
  const t = MVP_TITLE[key] || FALLBACK_TITLE;
  return { name: t.name, why: t.why(r) || '' };
}
export const headline = r => titleLine(r.titles?.[0] || 'steady', r);

// The compact copy kept in the fight's tracking row (server/trackgame.js): names, classes, bots, non-zero stats, titles.
export function compactCard(card) {
  return {
    mvp: card.rows.find(r => r.id === card.mvp)?.name || null,
    rows: card.rows.map(r => {
      const s = {};
      for (const key of MVP_KEYS) if (r[key]) s[key] = r[key];
      return { n: r.name, c: r.cls, ...(r.bot ? { b: 1 } : {}), s, t: r.titles };
    }),
  };
}

export const fmtSecs = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
