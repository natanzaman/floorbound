// Bot personalities (docs/briefs/personalities.md): who a bot is, rolled once from its name so the same name always
// gets the same one. Every layer reads it in small, bounded ways: the fight brain (potions, backing off, waiting for
// the tank), movement (formation slot, a gentle weave and capped turning while calm), idle habits (shared/bots/idle.js),
// chat (shared/bots/social.js) and the AI mind's prompt (server/ai/prompt.js). Nothing here calls a model.
//
//   traits     0..1 each: aggression, caution, patience, sociability, chattiness, playfulness, curiosity
//   archetype  a starting point with its own voice (extra chat lines); a roll jitters every trait by up to ±JITTER
//   neutral    every trait 0.5, no habits, no voice: the old behaviour (BOT_PERSONA=0, or { persona: 'neutral' })

export const TRAITS = ['aggression', 'caution', 'patience', 'sociability', 'chattiness', 'playfulness', 'curiosity'];
export const JITTER = 0.15;

// w: how often a roll lands on it. desc: one line for the admin page and the AI prompt.
export const ARCHETYPES = {
  steady: { name: 'Steady', w: 3, desc: 'calm and dependable, plays it straight',
    t: { aggression: 0.5, caution: 0.55, patience: 0.65, sociability: 0.55, chattiness: 0.5, playfulness: 0.35, curiosity: 0.4 } },
  hothead: { name: 'Hothead', w: 2, desc: 'charges in, hates waiting, stays in fights too long',
    t: { aggression: 0.9, caution: 0.2, patience: 0.2, sociability: 0.5, chattiness: 0.6, playfulness: 0.5, curiosity: 0.4 } },
  careful: { name: 'Careful', w: 2, desc: 'cautious, drinks early, hangs back, waits for the tank',
    t: { aggression: 0.25, caution: 0.9, patience: 0.8, sociability: 0.5, chattiness: 0.4, playfulness: 0.25, curiosity: 0.35 } },
  chatterbox: { name: 'Chatterbox', w: 2, desc: 'friendly and talkative, sticks close to people',
    t: { aggression: 0.45, caution: 0.5, patience: 0.5, sociability: 0.9, chattiness: 0.95, playfulness: 0.6, curiosity: 0.5 } },
  joker: { name: 'Joker', w: 2, desc: 'playful, jokes around, hops about when bored',
    t: { aggression: 0.55, caution: 0.4, patience: 0.4, sociability: 0.7, chattiness: 0.75, playfulness: 0.95, curiosity: 0.6 } },
  quiet: { name: 'Quiet', w: 2, desc: 'says little, keeps a bit of distance, very focused',
    t: { aggression: 0.5, caution: 0.6, patience: 0.75, sociability: 0.25, chattiness: 0.15, playfulness: 0.15, curiosity: 0.3 } },
  explorer: { name: 'Explorer', w: 2, desc: 'curious, looks around a lot, drifts off to see things',
    t: { aggression: 0.45, caution: 0.45, patience: 0.55, sociability: 0.45, chattiness: 0.5, playfulness: 0.5, curiosity: 0.95 } },
};
export const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

export const NEUTRAL = Object.freeze({ id: 'neutral', name: 'Neutral', neutral: true, desc: 'no personality (old behaviour)',
  t: Object.freeze(Object.fromEntries(TRAITS.map(k => [k, 0.5]))) });

// Extra lines by voice (social.js picks one of these instead of the stock line about half the time).
export const VOICE = {
  hothead: {
    greet: ["Finally. Let's hit something.", "{name}. Point me at the big one."],
    wipe: ['We should have gone harder.', 'Again. Right now.'],
    bossKill: ['Too easy. Next!', "That's how it's done!"],
    levelUp: ['Level {n}. More!'],
    lowHp: ["I'm fine. Mostly.", 'Just a scratch!'],
  },
  careful: {
    greet: ['Hi, {name} here. Let me know the plan before we pull.', "{name}. I'll stay near the back."],
    wipe: ["Let's slow down next time.", 'Too greedy. Regroup and pot up.'],
    bossKill: ['Phew. Clean enough.', 'Good, nobody died. Mostly.'],
    lowHp: ['Backing off, low!', 'Need a sec, low HP.'],
  },
  chatterbox: {
    greet: ['Heyyy! {name} here, so glad to have company!', "Hi hi! {name}. This'll be fun."],
    wipe: ["Okay that was a disaster but I'm having fun.", 'Rough! Shake it off, we got this.'],
    bossKill: ['YES! GG everyone, that was amazing!', 'We did it!! GG GG'],
    levelUp: ['Level {n}! Look at me go.'],
    grats: ['Grats {who}!! Huge.', 'Nice one {who}!'],
  },
  joker: {
    greet: ['{name} has arrived. Try to contain your excitement.', 'Hey! I bring snacks and questionable decisions.'],
    wipe: ["I'm blaming the boar.", 'Tactical nap. Totally planned.'],
    bossKill: ['GG! It never stood a chance. Mostly.', 'Down! I want its horns as a hat.'],
    levelUp: ['Level {n}. Still bad at jumping.'],
    mateDown: ['{who}! Who said you could lie down?'],
  },
  quiet: {
    greet: ['Hi.', '{name}. Ready.'],
    wipe: ['Again.', 'Regroup.'],
    bossKill: ['gg', 'Done.'],
    levelUp: ['{n}.'],
    thanks: ['ty', 'Thanks.'],
  },
  explorer: {
    greet: ['Hey! {name} here. Have you seen the view from the east ridge?', "{name}. Let's go somewhere new."],
    wipe: ['Well, we learned something.', 'Noted. Different angle next time.'],
    bossKill: ['GG! Wonder what is up the next floor.', 'Nice! Onward, up the tower.'],
  },
};

// FNV-1a of the name, then mulberry32: a small seeded random, the same sequence for the same name.
export function seedOf(s) {
  let h = 0x811c9dc5;
  for (const c of String(s || '').toLowerCase()) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp01 = v => Math.min(1, Math.max(0, v));

export function personaEnabled() {
  try { return typeof process === 'undefined' || !/^(0|false|off|no)$/i.test(String(process.env?.BOT_PERSONA ?? '')); } catch { return true; }
}

// One personality: a fixed archetype (id) or a weighted pick from the name's seed, with jittered traits.
export function rollPersonality(name, archetype = null) {
  if (archetype === 'neutral' || !personaEnabled()) return NEUTRAL; // (BOT_PERSONA=0 wins over any pick: tuning runs)
  const r = rng(seedOf(name));
  let id = ARCHETYPES[archetype] ? archetype : null;
  const total = ARCHETYPE_IDS.reduce((s, k) => s + ARCHETYPES[k].w, 0);
  let x = r() * total; // (always drawn, so a fixed archetype still gets the name's own jitter)
  if (!id) for (const k of ARCHETYPE_IDS) { x -= ARCHETYPES[k].w; if (x < 0) { id = k; break; } }
  id ||= 'steady';
  const A = ARCHETYPES[id];
  const t = Object.fromEntries(TRAITS.map(k => [k, +clamp01(A.t[k] + (r() * 2 - 1) * JITTER).toFixed(2)]));
  return { id, name: A.name, desc: A.desc, t, phase: r() * Math.PI * 2, slot: r() * 2 - 1 };
}

export const traitOf = (b, k) => b?.persona?.t?.[k] ?? 0.5;
export const isNeutral = b => !b?.persona || !!b.persona.neutral;

// "Joker (playful, jokes around, hops about when bored)", with the traits that stand out.
export function describePersona(p) {
  if (!p || p.neutral) return 'Neutral (no personality)';
  const hi = TRAITS.filter(k => p.t[k] >= 0.75), lo = TRAITS.filter(k => p.t[k] <= 0.25);
  const more = [...hi.map(k => `high ${k}`), ...lo.map(k => `low ${k}`)].join(', ');
  return `${p.name}: ${p.desc}${more ? ` (${more})` : ''}`;
}

// ---------- the numbers the brain reads (each one 0.5-neutral: a neutral bot gets the old value) ----------
export const potionShift = b => (traitOf(b, 'caution') - 0.5) * 0.16;                  // ±0.08 HP
export function backOffAt(b) {                                                           // HP fraction to step out at (old: 0.3)
  if (isNeutral(b)) return 0.3;
  if (traitOf(b, 'aggression') > 0.75) return 0.15;
  return 0.2 + traitOf(b, 'caution') * 0.16;
}
export const tankWait = b => (isNeutral(b) ? 1.2 : 0.6 + traitOf(b, 'patience') * 1.2);  // s a DPS lets the tank hold it first
export const chatScale = b => (isNeutral(b) ? 1 : 0.35 + traitOf(b, 'chattiness') * 1.05); // x the chance to chat
export function formation(b) {                                                           // { r, ang } offset in the anchor's wake
  if (isNeutral(b)) return { r: 3, ang: 0 };
  return { r: 2.6 + (1 - traitOf(b, 'sociability')) * 2, ang: (b.persona.slot || 0) * 0.35 };
}
