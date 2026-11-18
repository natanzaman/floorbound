// Bot capability levels (1-5): how human-like a bot plays. Applied per bot by the bot brain (shared/bots/) through a few
// small hooks (perceive, skillReady, aimNoise, sweepError, potionAt); a bot without `skill` (or skill 5) plays exactly
// as before: instant reactions, perfect-dodge timing, always parries, every skill on cooldown.
//
//   react        seconds between a telegraph (red circle / lane / wave / Horn Sweep / Break) arriving and the bot "seeing" it
//   fail         chance a telegraph is misjudged: half the time it's missed entirely (stands in it), otherwise seen late
//   late         extra delay (s) for a late reaction
//   sweepSlop    Horn Sweep roll / parry timing error (s, always early); a perfect dodge needs <= 0.05 s here, a clean dodge <= 0.27
//   sweepFail    chance the Horn Sweep timing is badly misjudged (rolls far too early or not at all)
//   notice       seconds before a ready skill (not the basic attack) gets pressed: slower rotations
//   gap          minimum seconds between two presses (any skill, including the basic attack)
//   noise        positioning error (m) while fighting
//   potAt        HP fraction to drink a potion at; potForget: chance (per ~4 s) of forgetting to
//   switchAware  chance a teammate's Break (the Switch window) is noticed
export const BOT_SKILL_DEFAULT = 4;
export const BOT_SKILLS = {
  5: { name: 'Perfect', desc: 'Instant reactions, perfect dodges, always parries, optimal rotations',
    react: [0, 0], fail: 0, late: [0, 0], sweepSlop: 0, sweepFail: 0, notice: [0, 0], gap: 0, noise: 0, potAt: 0.35, potForget: 0, switchAware: 1 },
  4: { name: 'Skilled', desc: '~0.2 s reactions, ~10% misjudged dodges, good rotations',
    react: [0.15, 0.25], fail: 0.1, late: [0.25, 0.5], sweepSlop: 0.1, sweepFail: 0.08, notice: [0.1, 0.5], gap: 0.05, noise: 0.6, potAt: 0.35, potForget: 0.05, switchAware: 0.9 },
  3: { name: 'Average', desc: '~0.3 s reactions, ~25% failed dodges, slower skills, forgets potions now and then',
    react: [0.25, 0.38], fail: 0.25, late: [0.3, 0.6], sweepSlop: 0.18, sweepFail: 0.2, notice: [0.5, 1.5], gap: 0.15, noise: 1.4, potAt: 0.3, potForget: 0.2, switchAware: 0.6 },
  2: { name: 'Casual', desc: '~0.45 s reactions, ~45% failed dodges, rarely Breaks/Switches, late potions',
    react: [0.38, 0.52], fail: 0.45, late: [0.35, 0.7], sweepSlop: 0.24, sweepFail: 0.4, notice: [1.2, 3], gap: 0.3, noise: 2.2, potAt: 0.2, potForget: 0.3, switchAware: 0.25 },
  1: { name: 'Novice', desc: '0.6 s+ reactions, mostly fails dodges, mashes the basic attack, stands in fire',
    react: [0.6, 0.85], fail: 0.7, late: [0.4, 0.8], sweepSlop: 0.3, sweepFail: 0.65, notice: [2.5, 6], gap: 0.45, noise: 3, potAt: 0.15, potForget: 0.5, switchAware: 0.08 },
};
export const BOT_SKILL_LEVELS = [1, 2, 3, 4, 5];

export const clampSkill = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : BOT_SKILL_DEFAULT; };
export const skillName = v => BOT_SKILLS[clampSkill(v)].name;
const prof = b => BOT_SKILLS[b.skill] || BOT_SKILLS[5];
const perfect = b => !b.skill || b.skill === 5;
const between = ([lo, hi], rng = Math.random) => lo + (hi - lo) * rng();

// Change a bot's level live (resets its pending perception queue and timers).
export function setSkill(b, v) { b.skill = clampSkill(v); b.sk = null; }
const st = b => (b.sk ||= { q: [], seen: [], next: 0, off: [0, 0], offT: -9, potT: -9, forget: false });

// ---------- perception ----------
// Events a capability level delays / may miss. 'tele' covers red circles, wedges, charge lanes and the Horn Sweep.
const PERCEIVED = new Set(['tele', 'pcancel', 'f2wave', 'quake', 'stagger', 'bt']); // bt: boss team mechanics (stack / spread / tether)

// One reaction outcome for a telegraph: { drop } (missed), or { delay } in seconds. Exported for the unit test.
export function reaction(level, rng = Math.random) {
  const P = BOT_SKILLS[clampSkill(level)];
  const delay = between(P.react, rng);
  if (P.fail && rng() < P.fail) return rng() < 0.5 ? { drop: true, fail: true } : { delay: delay + between(P.late, rng), fail: true };
  return { delay };
}

// Filter one snapshot's events through the bot's reactions. Returns the events to handle now: ones it doesn't delay,
// plus delayed ones that are now due (their `d`, the time left until they land, shortened by the delay).
export function perceive(b, events) {
  if (perfect(b) && !b.sk?.q.length) return events;
  const s = st(b), P = prof(b), now = [];
  const batch = events.some(e => PERCEIVED.has(e.t)) ? between(P.react) : 0; // one glance per snapshot
  for (const e of events) {
    if (!PERCEIVED.has(e.t) || perfect(b)) { now.push(e); continue; }
    if (e.t === 'stagger') { if (Math.random() < P.switchAware) s.q.push({ at: b.t + batch, e, delay: batch }); continue; }
    if (e.t === 'pcancel' || (e.t === 'tele' && e.k === 'sweep')) { s.q.push({ at: b.t + batch, e, delay: batch }); continue; } // timing errors: sweepError
    const r = reaction(b.skill);
    if (r.drop) continue;
    s.q.push({ at: b.t + r.delay, e, delay: r.delay });
  }
  if (s.q.length) {
    s.q.sort((a, c) => a.at - c.at);
    while (s.q.length && s.q[0].at <= b.t + 1e-9) {
      const { e, delay } = s.q.shift();
      now.push(typeof e.d === 'number' ? { ...e, d: e.d - delay } : e);
    }
  }
  return now;
}

// Horn Sweep timing error for this sweep (seconds early; Infinity-like = never reacts). Cached on the sweep object.
export function sweepError(b, s) {
  if (s.err !== undefined) return s.err;
  const P = prof(b);
  if (perfect(b)) s.err = 0;
  else if (Math.random() < P.sweepFail) s.err = Math.random() < 0.5 ? -9 : 0.3 + Math.random() * 0.35; // frozen, or panicked far too early
  else s.err = Math.random() * P.sweepSlop;
  return s.err;
}

// Quake Ring jump/roll timing error (seconds; + = early, - = late; -9 = frozen, never reacts). Cached on the ring.
// Uses the Horn Sweep profile, both ways and a bit wider: a jump has to cover the whole wavefront.
export function quakeError(b, q) {
  if (q.err !== undefined) return q.err;
  const P = prof(b);
  if (perfect(b)) q.err = 0;
  else if (Math.random() < P.sweepFail) q.err = Math.random() < 0.5 ? -9 : 0.3 + Math.random() * 0.35;
  else q.err = (Math.random() * 2 - 1) * P.sweepSlop * 1.2;
  return q.err;
}

// ---------- actions ----------
// May the bot press this skill now? Basic attack (slot 0): only the press gap. Other skills: noticed some time after
// the bot first wanted them while ready.
export function skillReady(b, slot) {
  if (perfect(b)) return true;
  const s = st(b), P = prof(b);
  if (b.t < s.next) return false;
  if (slot > 0) {
    s.seen[slot] ??= b.t + between(P.notice);
    if (b.t < s.seen[slot]) return false;
  }
  return true;
}
// Called after a press went out.
export function pressed(b, slot) {
  if (perfect(b)) return;
  const s = st(b), P = prof(b);
  s.next = b.t + P.gap * (0.6 + Math.random() * 0.8);
  s.seen[slot] = undefined;
}

// Positioning error while fighting (an offset that drifts every few seconds).
export function aimNoise(b, tx, tz) {
  if (perfect(b)) return [tx, tz];
  const P = prof(b);
  if (!P.noise || !b.mobs?.some(m => Math.hypot(m.x - b.x, m.z - b.z) < 15)) return [tx, tz];
  const s = st(b);
  if (b.t > s.offT) {
    const a = Math.random() * Math.PI * 2, r = P.noise * Math.sqrt(Math.random());
    s.off = [Math.sin(a) * r, Math.cos(a) * r]; s.offT = b.t + 2 + Math.random() * 3;
  }
  return [tx + s.off[0], tz + s.off[1]];
}

// HP fraction at which the bot drinks a potion right now (0 = it forgot).
export function potionAt(b) {
  const P = prof(b);
  if (perfect(b)) return P.potAt;
  const s = st(b);
  if (b.t > s.potT) { s.potT = b.t + 4; s.forget = Math.random() < P.potForget; }
  return s.forget ? 0 : P.potAt;
}
