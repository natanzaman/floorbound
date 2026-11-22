// The effect library (docs/briefs/path.md, Phase 3): small, data-driven rules that awakenings (Mastery 5, in
// shared/mastery.js AWAKEN), rule talent nodes and the subclass's later nodes (shared/talents.js, `{ rule: ... }`) share.
// server/effects.js runs them; the client reads the text. One rule:
//   { on, do, ...numbers, ch (chance 0-1, default 1), icd (s between two procs of this rule for one player, default 0) }
// on (when it fires):
//   'cast'   the skill was used (awakenings: that skill; talents: `sk` narrows it to one skill key, 'sig' for slot 5)
//   'hit'    a hit of that skill lands (awakenings) / any hit lands (talents, `sk` narrows it)
//   'crit' 'kill' 'break' 'switch'  your critical hit, a kill, a Break you cause, a Switch you land
//   'heal'   you heal someone (the amount restored)
// do (what it does; numbers x attack power where there is damage):
//   burn   { v: x atk per second, d }      on the target (burn, burst: 60% on a boss; mark: half)           slow { v: 0-1, d }    stun { d } (bosses 30%)
//   posture{ frac: [normal, boss] }        mark { v: +taken, d }    burst{ mult, r } around the target
//   pull   { r, v: metres }  enemies near the target toward it      shield { v: x max hp, r (0: you), d, to: 't' (the one healed) }
//   heal   { v: x max hp, r (0: you) }      team { v: +damage, r, d } (you and allies)
//   cdcut  { v: s off skills 1-3 }         dr   { v: less damage, d } (you)          rage { v } (Berserker)
export const FX_KINDS = ['burn', 'slow', 'stun', 'posture', 'mark', 'burst', 'pull', 'shield', 'heal', 'team', 'cdcut', 'dr', 'rage'];
export const FX_ON = ['cast', 'hit', 'crit', 'kill', 'break', 'switch', 'heal'];
export const FX_MAX = { burn: 0.6, mult: 2.5, shield: 0.3, heal: 0.25, team: 0.2, cdcut: 4, dr: 0.4, mark: 0.25 }; // (test/path.js keeps the data under these)

const pct = v => `${Math.round(v * 100)}%`;
const ON_TEXT = { cast: 'When you use it', hit: 'Its hits', crit: 'Your critical hits', kill: 'Each kill', break: 'Each Break you cause', switch: 'Each Switch you land', heal: 'Your heals' };
const near = r => (r ? `you and allies within ${r} m` : 'you');
const DO_TEXT = {
  burn: e => `burn the target for ${pct(e.v)} attack a second for ${e.d} s (less on bosses)`,
  slow: e => `slow the target by ${pct(e.v)} for ${e.d} s`,
  stun: e => `stun the target for ${e.d} s`,
  posture: e => `break ${pct(e.frac[0])} more of its posture (${pct(e.frac[1])} on bosses)`,
  mark: e => `mark the target: it takes ${pct(e.v)} more damage for ${e.d} s (half on bosses)`,
  burst: e => `burst around the target for ${pct(e.mult)} attack (${e.r} m; less around a boss)`,
  pull: e => `pull enemies within ${e.r} m toward the target`,
  shield: e => `shield ${e.to === 't' ? 'the one healed' : near(e.r)} for ${pct(e.v)} of max health (${e.d} s)`,
  heal: e => `heal ${near(e.r)} for ${pct(e.v)} of max health`,
  team: e => `give you and allies within ${e.r} m +${pct(e.v)} damage for ${e.d} s`,
  cdcut: e => `take ${e.v} s off your skill cooldowns`,
  dr: e => `you take ${pct(e.v)} less damage for ${e.d} s`,
  rage: e => `gain ${e.v} Rage`,
};
// One line of text for a rule ("Your critical hits: 25% chance to burn the target ...").
export function ruleText(e) {
  if (!e || !DO_TEXT[e.do]) return '';
  const ch = e.ch && e.ch < 1 ? `${pct(e.ch)} chance to ` : '';
  const icd = e.icd ? ` (at most once every ${e.icd} s)` : '';
  return `${e.text || ON_TEXT[e.on] || 'Then'}: ${ch}${DO_TEXT[e.do](e)}${icd}.`;
}
export const cleanRule = e => !!e && FX_ON.includes(e.on) && FX_KINDS.includes(e.do);
