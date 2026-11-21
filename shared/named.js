// The Named (docs/ROADMAP.md I): persistent characters who play the game like players do and whom players befriend.
// Data and pure rules, shared by the server (server/named.js), the client (public/named.js: the Friends tab) and tests.
//
// One entry per character:
//   { id, name, cls, style, group ('heroes' | 'loner'), role, look: { id (a look in shared/looks.js), color },
//     home: { floor, zone }, persona: '…' (I3 feeds it to the AI mind), blurb (one line, shown in the Friends tab),
//     trust: { rate: { source: multiplier }, daily: [cap per tier], loss: { downed }, invite: tier id, summon: tier id } }
//
// Friendship is per player and per Named, 0-100, in tiers (TIERS). Rules (contracts in docs/ROADMAP.md I):
//   gains   fighting within RULES.fightR m of them on a shared target, reviving them, healing or Covering them, real
//           help in their boss fight (at least RULES.bossShare of the damage or healing); later requests (I4) and talk (I3)
//   loss    only one: leaving them downed (they bleed out with you standing within RULES.downR m, in their party)
//   caps    one daily cap per Named (by your current tier with them), resetting at 10:00 UTC; talk has its own small cap
//           and can never cross a tier by itself; a tier, once reached, is never lost
//           finished requests (I4) have their own small cap instead (shared/namedquests.js REQ.friendDaily)
// The server keeps one record per (player, Named): { pts, day, got (gained today), chat (gained from talk today) }.
import { CLASSES, MAX_LEVEL } from './data.js';

export const NAMED_MAX = 5; // reserved slots, outside MAX_BOTS
export const NAMED_SKILL = 5; // bot capability (shared/botskill.js)
export const LEVEL_OFFSET = 2; // above the top players (admins can change it)
export const LEVEL_TOP = 3; // the top-N average
export const LEVEL_DAYS = 14; // of characters active in the last N days (admins' characters don't count)

export const TIERS = [
  { id: 'stranger', name: 'Stranger', at: 0 },
  { id: 'known', name: 'Known', at: 15 },
  { id: 'ally', name: 'Ally', at: 35 },
  { id: 'friend', name: 'Friend', at: 60 },
  { id: 'sworn', name: 'Sworn', at: 85 },
];
export const FRIEND_MAX = 100;
export const tierIndex = pts => { let i = 0; for (let k = 0; k < TIERS.length; k++) if (pts >= TIERS[k].at) i = k; return i; };
export const tierOf = pts => TIERS[tierIndex(pts)];
export const tierAt = id => Math.max(0, TIERS.findIndex(t => t.id === id));
// Progress through the current tier, 0-1 (the Friends tab's bar).
export function tierProgress(pts) {
  const i = tierIndex(pts), lo = TIERS[i].at, hi = TIERS[i + 1]?.at ?? FRIEND_MAX;
  return Math.max(0, Math.min(1, (pts - lo) / (hi - lo || 1)));
}

// Base points per source, before the character's own rate. Elites and rares count RULES.eliteMult kills.
export const GAINS = {
  fight: 0.5,    // a kill on a target you both fought, within RULES.fightR m of them
  revive: 4,     // you picked them up
  heal: 0.5,     // a heal on them worth at least RULES.healMin of their health (at most one per RULES.healGap s)
  cover: 1,      // you took a hit meant for them (Guardian Cover)
  boss: 8,       // real help in their boss fight: a kill
  bossTry: 3,    // … a wipe
  request: 1,    // I4 passes its own amounts
  chat: 1,       // I3 passes its own amounts (bounded below)
};
export const RULES = {
  fightR: 25, downR: 40, bossShare: 0.1, eliteMult: 3, healMin: 0.08, healGap: 6,
  chatDaily: 3,        // points a day from talk, per Named
  resetHourUTC: 10,    // the daily caps reset at 10:00 UTC
  partyIdle: 600,      // an invited Named goes home after this long with no fighting (s)
  summonCd: 600,       // a Sworn summon: first come, then this long before anyone can call them again (s)
  whisperCd: 3600,     // the loner's raid invite: at most one an hour per player (and none after a decline that session)
  bossFirst: [240, 420], // seconds of farming before their first boss attempt of a visit
  bossEvery: [900, 1500], // …and between attempts after that
  bossRetry: 180,      // a human was at the arena: look again after this long
  bossGiveUp: 360,     // heading for a boss that never started: back to farming
  linger: 8,           // seconds they stay after the last human leaves
  loadRetry: 5,        // a friendship load failed: try again after this long (s); nothing of theirs is saved until it's in
  holdIdle: 20,        // a boss's killing blow is held for the humans only while one of them hit it in the last this long (s)
  tagR: 60,            // a field mob a human damaged pays them in full on a Named's kill only within this range (m)
};

// Presence: who is simulated (each Named is a bot the free Render plan pays for in CPU). A group comes into the world
// when a human is in its home area (its home floor outside the town or camps) and stays while a human has been within
// `near` m of one of them in the last `idle` seconds (it follows them across floors as before); then it goes home. In a
// boss fight or a human's party it stays. An invite, a call or an accepted invitation wakes a resting group at once
// (for at least `wake` seconds). With few humans online at most cap[humans] Named at once, a party group (the
// Hearthward) counting as one: all of them or none. NAMED_PRESENCE=0 (and NAMED_ALWAYS=1) keep the old rule: present
// whenever a human is on their floor.
export const PRESENCE = { near: 60, idle: 180, wake: 300, cap: { 1: 2, 2: 3 } };

const HERO_TRUST = { rate: { fight: 1, revive: 1, heal: 1, cover: 1, boss: 1, bossTry: 1, request: 1, chat: 1 }, daily: [18, 18, 9, 8, 5], loss: { downed: 4 }, invite: 'ally', summon: 'sworn' };
// The loner: slow trust that grows mostly from fighting beside him; help he didn't ask for counts for little.
const LONER_TRUST = { rate: { fight: 1, revive: 0.5, heal: 0.25, cover: 0.5, boss: 1, bossTry: 1, request: 0.75, chat: 0.5 }, daily: [7, 7, 7, 6, 4], loss: { downed: 6 }, invite: 'friend', summon: 'sworn' };

export const GROUPS = {
  heroes: { name: 'The Hearthward', motto: 'A hundred bells, then home.', party: true },
  loner: { name: 'Alone', party: false },
};

// `look` is I2's: look.id names the character's look in shared/looks.js (game.setLook(p, def.look.id) puts it on, see
// server/looks.js; lookSwatch(def.look.id) in public/looks.js draws its badge); look.color is the plain portrait colour.
export const NAMED = [
  {
    id: 'halvard', name: 'Halvard', cls: 'guardian', style: 'shield', group: 'heroes', role: 'Tank',
    look: { id: 'halvard', color: 0xe0a53a },
    home: { floor: 1, zone: 'the Verdant Field' },
    blurb: 'Captain of the Hearthward. Counts heads before every pull.',
    persona: 'Halvard, captain and shield of the Hearthward. Steady, dry-humoured, plain-spoken. Counts heads before every pull and again after. Hates leaving anyone behind; forgives mistakes, not carelessness. Wants every one of his four to walk out of the tower.',
    trust: HERO_TRUST,
  },
  {
    id: 'maribel', name: 'Maribel', cls: 'cleric', style: 'staff', group: 'heroes', role: 'Healer',
    look: { id: 'maribel', color: 0x7fd6a4 },
    home: { floor: 1, zone: 'the Verdant Field' },
    blurb: 'The Hearthward\'s healer. Remembers who skipped their potions.',
    persona: 'Maribel, healer of the Hearthward. Warm, bossy, quick to laugh. Scolds people who skip their potions and remembers who did. Hums when she is nervous. Believes nobody climbs alone, and says so often.',
    trust: HERO_TRUST,
  },
  {
    id: 'tovin', name: 'Tovin', cls: 'ranger', style: 'longbow', group: 'heroes', role: 'Damage',
    look: { id: 'tovin', color: 0x4fc3d9 },
    home: { floor: 1, zone: 'the Verdant Field' },
    blurb: 'The Hearthward\'s archer. Keeps score of everything.',
    persona: 'Tovin, archer of the Hearthward. Cheerful show-off who keeps score of every kill and loses count on purpose when a friend is behind. Talks too much before a fight and not at all during one. Wants his name carved somewhere it will last.',
    trust: HERO_TRUST,
  },
  {
    id: 'sennet', name: 'Sennet', cls: 'lancer', style: 'halberd', group: 'heroes', role: 'Damage',
    look: { id: 'sennet', color: 0xb18cf2 },
    home: { floor: 1, zone: 'the Verdant Field' },
    blurb: 'The Hearthward\'s lancer. Writes every boss pattern in a notebook.',
    persona: 'Sennet, lancer of the Hearthward. Quiet, exact, a little shy. Studies every boss and writes its patterns in a notebook she lets nobody read. Speaks in short, careful sentences; warms slowly, then completely.',
    trust: HERO_TRUST,
  },
  {
    id: 'cairn', name: 'Cairn', cls: 'lancer', style: 'glaive', group: 'loner', role: 'Damage', // (his look's lantern glaive: shared/looks.js)
    look: { id: 'cairn', color: 0xd8ff5a },
    home: { floor: 1, zone: 'the far side of the Verdant Field' },
    blurb: 'Hunts alone. Trusts what you do, not what you say.',
    persona: 'Cairn, a hunter who climbs alone. Says little and means all of it. Wherever someone fell he stacks a small pile of stones before moving on. Slow to trust: he respects people who fight beside him without asking for anything, and turns down every party until he calls someone a friend.',
    trust: LONER_TRUST,
  },
];
// Canned lines (I3's AI replaces them when it's on). {who}: the player, {tier}: the tier they need.
const LINES = {
  heroes: {
    refuse: ["We don't know you well enough yet, {who}. Fight beside us a while.", 'Not yet, {who}. Earn it in the field first.'],
    busy: ['Bad timing, {who}. Ask me after this.', "I'm in the middle of something, {who}."],
    join: ['With you, {who}.', "Right. Let's go, {who}."],
    called: ['You called, {who}. Here.', 'On my way was the easy part. What do you need, {who}?'],
    home: ["Quiet out here. I'm heading back to the others.", 'Back to the Hearthward for me. Call if you need us.'],
    downed: ['You were right there, {who}.'],
  },
  loner: {
    refuse: ['No.', 'I hunt alone.', "Don't ask me that again."],
    busy: ['Later.'],
    join: ['Fine. Keep up.'],
    called: ['You called. I came.'],
    home: ["We're done here."],
    downed: ['Noted, {who}.'],
    raid: ["I'm going for the boss. Come if you want, {who}. I won't ask twice."],
  },
};
export function namedLine(def, key, vars = {}, rnd = Math.random) {
  const list = def?.lines?.[key] || LINES[def?.group]?.[key] || [];
  const t = list[Math.floor(rnd() * list.length)] || '';
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export const NAMED_BY_ID = Object.fromEntries(NAMED.map(n => [n.id, n]));
export const NAMED_IDS = NAMED.map(n => n.id);
export const namedIn = group => NAMED.filter(n => n.group === group);
export const lookColor = n => n?.look?.color ?? CLASSES[n?.cls]?.color ?? 0x94a3b8;

// Names nobody else may take (character creation, anonymous joins).
const RESERVED = new Set(NAMED.map(n => n.name.toLowerCase()));
export const isNamedName = name => RESERVED.has(String(name || '').trim().toLowerCase());
export const namedByName = name => NAMED.find(n => n.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

// ---------- friendship (pure) ----------
const r2 = v => Math.round(v * 100) / 100;
export const newFriendship = () => ({ pts: 0, day: 0, got: 0, chat: 0 });
// The day a moment belongs to: days roll over at RULES.resetHourUTC.
export const dayKey = (now = Date.now()) => Math.floor((now - RULES.resetHourUTC * 3600000) / 86400000);
export const nextReset = (now = Date.now()) => (dayKey(now) + 1) * 86400000 + RULES.resetHourUTC * 3600000;
function roll(rec, now) { const d = dayKey(now); if (rec.day !== d) { rec.day = d; rec.got = 0; rec.chat = 0; } }
export const dailyCap = (def, pts) => def.trust.daily[tierIndex(pts)] ?? 0;
// What's left of today's cap for this record.
export function dailyLeft(rec, def, now = Date.now()) {
  const day = dayKey(now), got = rec.day === day ? rec.got : 0;
  return Math.max(0, r2(dailyCap(def, rec.pts) - got));
}

// Add `base` points from `source` (a GAINS key), scaled by the character's rate and cut to the daily cap. A negative
// base (I3's bounded nudges) takes points but never a tier. Returns { d (applied), pts, tier (index), up (a new tier) }.
export function gainFriendship(rec, def, source, base, now = Date.now()) {
  roll(rec, now);
  const was = tierIndex(rec.pts);
  let d = base * (def.trust.rate[source] ?? 1);
  if (d < 0) d = Math.max(d, TIERS[was].at - rec.pts); // (a tier is never lost)
  else if (source === 'request') d = Math.min(d, FRIEND_MAX - rec.pts); // (I4: its own bounded cap, server/namedquests.js)
  else {
    d = Math.min(d, Math.max(0, dailyCap(def, rec.pts) - rec.got), FRIEND_MAX - rec.pts);
    if (source === 'chat') { // talk: its own small cap, and never across a tier by itself
      const next = TIERS[was + 1]?.at ?? FRIEND_MAX + 1;
      d = Math.max(0, Math.min(d, RULES.chatDaily - rec.chat, next - 0.01 - rec.pts));
      rec.chat = r2(rec.chat + d);
    }
    rec.got = r2(rec.got + d);
  }
  rec.pts = r2(Math.max(0, Math.min(FRIEND_MAX, rec.pts + d)));
  const tier = tierIndex(rec.pts);
  return { d: r2(d), pts: rec.pts, tier, up: tier > was };
}

// The only loss: you left them downed. Never below the tier you hold.
export function loseFriendship(rec, def, kind = 'downed') {
  const was = tierIndex(rec.pts), want = def.trust.loss[kind] ?? 0;
  const d = -Math.min(want, rec.pts - TIERS[was].at);
  rec.pts = r2(rec.pts + d);
  return { d: r2(d), pts: rec.pts, tier: was, up: false };
}

// Invites (owner decision 2026-11-20): anyone may invite any of the Named, from the Players list's Bots section or the
// Friends tab; their other rules stay (busy, party full; several may join one party: owner 2026-11-21).
// INVITE_NEEDS_TIER = true brings back the old gate (each one's trust.invite tier: a Hero from Ally, the loner from
// Friend). Friendship is otherwise unchanged, and a Sworn call (canSummon) keeps its tier. (inviteGate: the live switch, which tests flip.)
export const INVITE_NEEDS_TIER = false;
export const inviteGate = { needsTier: INVITE_NEEDS_TIER };
export const canInvite = (def, pts) => !inviteGate.needsTier || tierIndex(pts) >= tierAt(def.trust.invite);
export const canSummon = (def, pts) => tierIndex(pts) >= tierAt(def.trust.summon);

// ---------- level ----------
// The top-N average of the given levels (players active lately, admins left out), plus the offset; never above the cap
// and never below what they already are.
export function namedLevel(levels, { offset = LEVEL_OFFSET, cap = MAX_LEVEL, floor = 1 } = {}) {
  const top = [...levels].filter(l => l > 0).sort((a, b) => b - a).slice(0, LEVEL_TOP);
  const base = (top.length ? Math.round(top.reduce((s, l) => s + l, 0) / top.length) : 1) + offset; // (nobody to follow yet: level 1 + the offset)
  return Math.max(1, Math.min(cap, Math.max(floor | 0, base)));
}

// "While you were away": a short line per group from how long they were gone and what changed (no simulation).
const AWAY = {
  heroes: ['kept to the field and mended their gear', 'ran drills at the raid gate', 'argued over the map by the fountain', 'hunted wolves until dusk'],
  loner: ['walked the far side of the field', 'left another small pile of stones by the road', 'was seen at the raid gate, alone', 'spoke to nobody'],
};
export function awayLine(group, secs, { lvlFrom = 0, lvlTo = 0 } = {}) {
  if (!(secs >= 1800)) return '';
  const h = secs / 3600, span = h < 1.5 ? 'the last hour' : h < 36 ? `the last ${Math.round(h)} hours` : `the last ${Math.round(h / 24)} days`;
  const list = AWAY[group] || AWAY.heroes, did = list[Math.floor(secs / 600) % list.length];
  const who = group === 'heroes' ? GROUPS.heroes.name : NAMED.find(n => n.group === group)?.name || 'They';
  const grew = lvlTo > lvlFrom ? ` and ${group === 'heroes' ? 'are' : 'is'} now level ${lvlTo}` : '';
  return `While you were away (${span}): ${who} ${did}${grew}.`;
}
