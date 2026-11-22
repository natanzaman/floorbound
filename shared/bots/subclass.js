// Bots and slot 5 (docs/briefs/subclasses.md): a specialised bot (me.sub in its snapshot) uses its subclass's signature
// skill when the data says it fits (SUBCLASSES[sub].skill.bot in shared/subclasses.js):
//   melee  the target is within `range` of us (its near edge)      ranged  the target is within `range`
//   crowd  2+ enemies within `range`, or a boss within it          party   a boss fight, or a party member under 60%
//   heal   2+ party members under 70%, or one under 40%            buff    once the fight is on (engaged), a boss or 2+ enemies
//   low    also when our own health is below this fraction (any use)
// Called from the brain's combat turn, after combos and setups and before the class plug-in. True: used this turn.
import { SPEC, sigOf } from '../subclasses.js';
import { useSkill } from './motor.js';

const SLOT = SPEC.slot;
const faceTo = (b, m) => Math.atan2(m.x - b.x, m.z - b.z);

export function sigTurn(b, tgt, ctx) {
  const sk = sigOf(b.me?.sub);
  if (!sk || !tgt || ctx.dodge || (b.cds[SLOT] || 0) > 0) return false;
  const B = sk.bot, d = ctx.d2(b.x, b.z, tgt.x, tgt.z) - tgt.def.radius, boss = !!tgt.def.boss;
  const near = r => b.mobs.filter(m => ctx.d2(m.x, m.z, b.x, b.z) - m.def.radius <= r).length;
  const hurt = f => ctx.party.all.filter(p => !p.dead && p.hp / p.maxHp < f).length;
  let go = false;
  if (B.use === 'melee') go = d <= B.range;
  else if (B.use === 'ranged') go = d <= B.range && (boss || tgt.winding || near(B.range) >= 2 || tgt.hp > tgt.maxHp * 0.3);
  else if (B.use === 'crowd') go = (boss && d <= B.range) || near(B.range) >= 2;
  else if (B.use === 'party') go = d <= B.range + 4 && (boss || hurt(0.6) >= 1);
  else if (B.use === 'heal') go = hurt(0.7) >= 2 || hurt(0.4) >= 1;
  else if (B.use === 'buff') go = b.engAt !== null && (boss || near(12) >= 2);
  if (!go && B.low && b.maxHp && d <= B.range) go = b.hp / b.maxHp < B.low;
  if (!go) return false;
  const face = faceTo(b, tgt);
  if (!useSkill(b, SLOT, face)) return false;
  b.face = face;
  return true;
}
