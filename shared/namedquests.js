// The Named's requests and invitations (docs/ROADMAP.md I4): data and pure rules, shared by the server
// (server/namedquests.js), the client (public/namedquests.js: the request card and the outreach message) and tests.
//
// Requests: each Named offers you personal requests from templates that fit them (PERSONA): kill N of a mob from your
// floor and level range, bring N materials, or help in their boss fight. At most one active request per Named per
// player; a taken request lasts REQ.ttl (real time) and is saved per character. Rewards: friendship through the
// 'request' source (its own bounded cap, REQ.friendDaily a day per Named, outside the shared daily cap), gold, and now
// and then a rolled item (shared/loot.js). No keepsakes, escorts or spars in v1.
//
// Outreach: at Friend and above a Named may message you (when you're online and free) to invite you to a farm or a
// raid. At most one an hour per Named per player (OUTREACH.cd), one every OUTREACH.gap across all of them, none from a
// Named you turned down this session, none during a director show and none mid-boss. Cairn's raid whisper
// (server/named.js) is his only outreach.
//
// Phrasing: phraseRequest(def, req, player, moment) gives the canned line; I3 can swap in AI phrasing on the server
// (server/namedquests.js: quests.phraser), with the canned line as the fallback.
import { MOBS } from './data.js';
import { MATS } from './crafting.js';
import { tierAt, tierIndex } from './named.js';

export const REQ = {
  ttl: 24 * 3600,         // a taken request lasts this long (s, real time)
  offerLife: 2 * 3600,    // an untaken offer is replaced after this long (s): your floor and level move on
  friendDaily: 6,         // friendship from requests a day, per Named (after their rate), outside the shared daily cap
  turnInR: 12,            // hand materials over within this many metres of them (or while talking: I3)
  friend: { kill: 4, bring: 4, boss: 6 },   // base friendship per finished request (times the Named's 'request' rate)
  gold: { kill: 1, bring: 1.2, boss: 2 },   // times goldFor(level)
  item: { kill: 0.2, bring: 0.25, boss: 0.5 }, // chance of a rolled item
  table: { kill: ['field', 'mire', 'spire'], bring: ['field', 'mire', 'spire'], boss: ['elite', 'mireElite', 'spireRare'] }, // rarity table by floor
  dropAfter: 600,         // you dropped or let one expire: the next offer after this long (s)
};
export const goldFor = lvl => 15 + 4 * Math.max(1, lvl | 0);

// What each floor offers. kill: [mob, count]; bring: [material, count]; boss: the floor's boss; area: where they farm.
// (Summoned adds, rares and temporary mobs never count: the Warden's hounds and the Sovereign's thralls are left out.)
export const FLOOR_REQ = {
  1: { kill: [['boar', 10], ['spitter', 8], ['wolf', 8], ['alpha', 2]], bring: [['resin', 6], ['pelt', 6], ['tusk', 6], ['fang', 2]], boss: 'warden', area: 'the Verdant Field' },
  2: { kill: [['shieldback', 6], ['wisp', 6], ['lurker', 6], ['matron', 1]], bring: [['ess', 3], ['dust', 8], ['core', 1], ['horn', 3]], boss: 'sovereign', area: 'the Glimmering Mire' },
  3: { kill: [['ram', 5], ['harpy', 5], ['acolyte', 5], ['sentinel', 3]], bring: [['ess', 4], ['prism', 1], ['core', 2], ['dust', 10]], boss: 'colossus', area: 'the Windswept Steps' },
};
export const KILL_BAND = [-6, 3]; // a kill request's mob is within this many levels of yours (or the nearest there is)
export const BOSS_BAND = 3;       // a boss request only when you are at most this many levels under the boss

// Who asks for what. kinds: template weights; from: the least tier for an offer (boss help also needs the tier at which
// they party with you: def.trust.invite); every: seconds between offers; ask: the chance an offer appears when one is
// due (the loner rarely asks); mats: favourite materials (weighted up); killMult: counts asked (Tovin keeps score);
// outreach: whether they ever message you first.
export const PERSONA = {
  halvard: { kinds: { kill: 2, boss: 2, bring: 1 }, from: 'stranger', every: 2700, ask: 1, mats: ['tusk', 'core'], killMult: 1, outreach: true },
  maribel: { kinds: { bring: 4, kill: 1 }, from: 'stranger', every: 2700, ask: 1, mats: ['resin', 'pelt', 'ess', 'dust'], killMult: 1, outreach: true },
  tovin: { kinds: { kill: 5, boss: 1 }, from: 'stranger', every: 2700, ask: 1, mats: [], killMult: 1.5, outreach: true },
  sennet: { kinds: { boss: 3, kill: 1, bring: 1 }, from: 'stranger', every: 2700, ask: 1, mats: ['horn', 'core', 'prism'], killMult: 1, outreach: true },
  cairn: { kinds: { kill: 3, boss: 1 }, from: 'known', every: 4 * 3600, ask: 0.3, mats: [], killMult: 1, outreach: false },
};

export const OUTREACH = {
  cd: 3600,      // per Named per player (s)
  gap: 900,      // between any two messages to one player (s)
  settle: 120,   // not in a player's first two minutes online (s)
  every: 30,     // how often a player is considered (s)
  chance: 0.15,  // …and the chance a due message goes out then (about three minutes after it's allowed)
  ttl: 60,       // an unanswered message lapses after this long (s): it counts as sent, not as a "no"
  raid: 0.4,     // the chance it's a raid rather than a farm (when your level fits your floor's boss)
};

const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];
function weighted(entries, rnd) { // [[value, weight], …]
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [v, w] of entries) { x -= w; if (x < 0) return v; }
  return entries[entries.length - 1]?.[0];
}

// The kinds this Named could ask of you now (an empty list: nothing to offer).
export function kindsFor(def, { pts = 0, lvl = 1, floor = 1 } = {}) {
  const P = PERSONA[def?.id], F = FLOOR_REQ[floor] || FLOOR_REQ[1], ti = tierIndex(pts);
  if (!P || ti < tierAt(P.from)) return [];
  const out = [];
  for (const [k, w] of Object.entries(P.kinds)) {
    if (k === 'boss' && (ti < tierAt(def.trust.invite) || lvl < (MOBS[F.boss]?.level ?? 99) - BOSS_BAND)) continue; // (boss help means partying with them)
    if (k === 'bring' && !F.bring.length) continue;
    out.push([k, w]);
  }
  return out;
}

// A new request from a template, for this player now (null: none fits). Plain data: { k, n, mob | mat, floor, got: 0 }.
export function rollRequest(def, { pts = 0, lvl = 1, floor = 1 } = {}, rnd = Math.random) {
  const kinds = kindsFor(def, { pts, lvl, floor });
  if (!kinds.length) return null;
  const P = PERSONA[def.id], F = FLOOR_REQ[floor] ? floor : 1, T = FLOOR_REQ[F], k = weighted(kinds, rnd);
  if (k === 'kill') {
    const lv = m => MOBS[m]?.level ?? 0;
    let band = T.kill.filter(([m]) => lv(m) >= lvl + KILL_BAND[0] && lv(m) <= lvl + KILL_BAND[1]);
    if (!band.length) { const near = Math.min(...T.kill.map(([m]) => Math.abs(lv(m) - lvl))); band = T.kill.filter(([m]) => Math.abs(lv(m) - lvl) === near); }
    const [mob, n] = pick(band, rnd);
    return { k, mob, n: Math.max(1, Math.round(n * (MOBS[mob]?.elite ? 1 : P.killMult))), floor: F, got: 0 };
  }
  if (k === 'bring') {
    const [mat, n] = weighted(T.bring.map(e => [e, P.mats.includes(e[0]) ? 3 : 1]), rnd);
    return { k, mat, n, floor: F, got: 0 };
  }
  return { k: 'boss', mob: T.boss, n: 1, floor: F, got: 0 };
}

// What finishing it pays (before the friendship cap; item: whether one is rolled, and from which rarity table).
export function rewardFor(req, lvl, rnd = Math.random) {
  const fi = Math.max(0, Math.min(2, (req.floor | 0) - 1));
  return {
    friend: REQ.friend[req.k] ?? 0,
    gold: Math.round(goldFor(lvl) * (REQ.gold[req.k] ?? 1)),
    item: rnd() < (REQ.item[req.k] ?? 0) ? REQ.table[req.k]?.[fi] || 'field' : null,
  };
}

// The request's goal in a few plain words (the card's title and the toast).
export function goalText(req) {
  if (!req) return '';
  if (req.k === 'kill') return `Defeat ${req.n} ${mobName(req.mob, req.n)}`;
  if (req.k === 'bring') return `Bring ${req.n} ${MATS[req.mat]?.name || req.mat}`;
  if (req.k === 'boss') return `Help them fell ${(MOBS[req.mob]?.name || 'the floor boss').replace(/^The /, 'the ')}`;
  return '';
}
// A mob's name, plural for more than one ("Dire Wolves", "Will-o'-Wisps").
export function mobName(id, n = 1) {
  const name = MOBS[id]?.name || id || '';
  if (n === 1 || /s$/.test(name)) return name;
  return /Wolf$/.test(name) ? name.replace(/Wolf$/, 'Wolves') : /[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`;
}
export const progressOf = req => (req ? Math.max(0, Math.min(1, (req.got || 0) / (req.n || 1))) : 0);

// ---------- canned lines (I3 may swap in AI phrasing; these stay the fallback) ----------
// Moments: offer (the request card), done (finished), expired, farm / raid (outreach), declined (a polite "another
// time"). {who}: the player, {n}, {mob}, {mat}, {boss}, {area}: the request's or the message's details.
const LINES = {
  halvard: {
    kill: ['{who}. The {mobs} are pressing on the road. Thin them out: {n} should do it.', 'Count me {n} {mobs}, {who}. Fewer of them, fewer of us hurt.'],
    bring: ['Our gear is held together with hope, {who}. {n} {mat} would mend it properly.'],
    boss: ['We go for {boss} soon. I want you on the line with us, {who}.', 'Stand with us against {boss}, {who}. I count better with you in the room.'],
    done: ['Good work, {who}. That is how it is done.', 'Counted and confirmed. Thank you, {who}.'],
    farm: ['{who}, we could use another blade out in {area}. Coming?'],
    raid: ['{who}. We are going up against {boss}. Walk with me?'],
  },
  maribel: {
    bring: ['{who}! I am out of {mat} again. {n} would keep my salves going. Please?', 'Could you bring me {n} {mat}, {who}? Somebody skipped their potions and I am running low.'],
    kill: ['The {mobs} keep sending me patients. Deal with {n} of them, {who}?'],
    done: ['Oh, perfect. You are a treasure, {who}.', 'Thank you, {who}! Now drink your potions.'],
    farm: ['{who}, come hunt with me in {area}? I will keep you standing.'],
    raid: ['We are trying {boss}, {who}. I would feel better with you there.'],
  },
  tovin: {
    kill: ['Bet you cannot drop {n} {mobs} before I do, {who}. Go!', '{who}! Score check: {n} {mobs}. I will be counting.'],
    boss: ['{boss}, {who}. Me, you, a lot of arrows. Help me get my name on the wall?'],
    done: ['Ha! Not bad, {who}. I make it a draw. Probably.', 'That is a proper score, {who}. Well shot.'],
    farm: ['{who}! Race you through {area}. Loser buys.'],
    raid: ['{boss} time, {who}. You in?'],
  },
  sennet: {
    boss: ['I am studying {boss}. Fight it with me, {who}. I need to see it again.', '{who}. Help me with {boss}. I will write you into the notes.'],
    kill: ['{n} {mobs}, {who}. I am testing a pattern.'],
    bring: ['Could you find {n} {mat}, {who}? For an experiment.'],
    done: ['Thank you, {who}. Noted.', 'That helps. Thank you, {who}.'],
    farm: ['{who}. I am going to {area}. You can come.'],
    raid: ['{boss}, {who}. Come and watch it with me.'],
  },
  cairn: {
    kill: ['{n} {mobs}. If you are going that way.', 'The {mobs}. {n}. Do not tell me about it.'],
    boss: ['{boss}. Be there.'],
    done: ['Good.', 'Noted, {who}.'],
  },
  heroes: { // fallback for any Hero
    expired: ['Never mind that request, {who}. It kept.'],
    declined: ['Another time then, {who}.', 'No trouble, {who}. Another time.'],
  },
  loner: { expired: ['Forget it.'], declined: ['Fine.'] },
};
const KIND_TEXT = { kill: 'kill', bring: 'bring', boss: 'boss' };

// The canned line for a request or an outreach moment. req: a request ({ k, n, mob, mat }) or an outreach
// ({ k: 'farm' | 'raid', boss, area }); moment: 'offer' (the default: the request's own kind), 'done', 'expired',
// 'declined', or 'farm' / 'raid'.
export function phraseRequest(def, req, player, moment = 'offer', rnd = Math.random) {
  const key = moment === 'offer' ? KIND_TEXT[req?.k] || req?.k : moment;
  const list = LINES[def?.id]?.[key] || LINES[def?.group]?.[key] || [];
  const vars = {
    who: player?.name || 'friend', n: req?.n ?? '', mob: mobName(req?.mob, 1), mobs: mobName(req?.mob, req?.n ?? 2), mat: MATS[req?.mat]?.name || '',
    boss: (MOBS[req?.boss || (req?.k === 'boss' ? req.mob : '')]?.name || 'the floor boss').replace(/^The /, 'the '), area: req?.area || 'the field',
  };
  if (!list.length) return moment === 'offer' ? goalText(req) : '';
  return pick(list, rnd).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
