// Built-in class plug-ins for the bot brain: Guardian (tank), Swordsman (DPS), Cleric (healer), and a generic fallback
// ('*') for any class without its own plug-in. See shared/bots/registry.js for the interface.
import { registerClassBrain } from './registry.js';

const faceTo = (b, m) => Math.atan2(m.x - b.x, m.z - b.z);

// Guardian: opens with Taunt, peels mobs off the party, Ground Slam to Break, Bash to Switch, Shield Wall when low.
registerClassBrain('guardian', {
  role: 'tank', name: 'Brann', parry: true,
  combat(b, tgt, ctx) {
    const { useSkill, moveToward, switchOpen, d2, dodge } = ctx;
    const reach = tgt.def.radius + 1.6, d = d2(b.x, b.z, tgt.x, tgt.z), face = faceTo(b, tgt);
    if (!dodge) { moveToward(b, tgt.x, tgt.z, reach - 0.3); b.face = face; }
    if (d < 8.5 && b.engAt === null) { if (useSkill(b, 1, face)) b.tauntT = b.t; b.engAt = b.t; } // open with Taunt
    if (ctx.peel && b.t - (b.tauntT ?? -99) > 2 && useSkill(b, 1, face)) { b.tauntT = b.t; return true; } // pull it off a teammate
    if (d < reach + 1.2) {
      if (b.engAt === null) b.engAt = b.t;
      if (b.hp / b.maxHp < 0.6 || (tgt.enraged && dodge)) useSkill(b, 2, face); // Shield Wall
      if (switchOpen(b, tgt)) { useSkill(b, 0, face); return true; }           // Switch in with Bash
      if (!tgt.staggered && useSkill(b, 3, face)) return true;                  // Ground Slam: Break it for the DPS
      if (b.t - b.engAt > 4 && useSkill(b, 1, face)) b.tauntT = b.t;            // keep threat: re-Taunt on cooldown
      useSkill(b, 0, face);                                                     // Bash
    }
    return true;
  },
});

// Swordsman: waits for the tank to hold the target, flanks it (far side from the tank), Switches in with Burst Combo,
// or Bursts to Break it while the tank's Ground Slam is down; Whirl into crowds and bosses.
registerClassBrain('swordsman', {
  role: 'dps', name: 'Kael',
  combat(b, tgt, ctx) {
    const { useSkill, moveToward, switchOpen, d2, dodge, anchor } = ctx;
    if (dodge) return true;
    const reach = tgt.def.radius + 1.3;
    if (anchor) {
      const tx = tgt.x - anchor.x, tz = tgt.z - anchor.z, tl = Math.hypot(tx, tz) || 1;
      const spot = ctx.ready ? [tgt.x + (tx / tl) * reach, tgt.z + (tz / tl) * reach] : [anchor.x - (tx / tl) * 4, anchor.z - (tz / tl) * 4];
      moveToward(b, spot[0], spot[1], 0.5);
    } else moveToward(b, tgt.x, tgt.z, reach - 0.4);
    if (!ctx.ready) return true;
    const face = faceTo(b, tgt), d = d2(b.x, b.z, tgt.x, tgt.z);
    b.face = face;
    if (d > reach + 1.6) return true;
    const crowd = b.mobs.filter(m => d2(m.x, m.z, b.x, b.z) < 4.5 + m.def.radius).length;
    if (switchOpen(b, tgt) && useSkill(b, 3, face)) return true;                // Switch in with Burst Combo
    if (!tgt.staggered && ctx.mayBreak && useSkill(b, 3, face)) return true;    // or Burst to Break it for the tank
    if ((crowd >= 2 || tgt.def.boss) && useSkill(b, 2, face)) return true;      // Whirl
    useSkill(b, 0, face);                                                       // Slash
    return true;
  },
});

// Cleric: stays behind the front line, heals the most hurt party member (a "heal me" request first), interrupts
// wind-ups with Smite, Blessing once the fight is on, Sanctuary in boss fights, Smite when idle.
function clericHeal(b, ctx, face) {
  const f = ctx.healFocus;
  if (f && f.hp / f.maxHp < 0.92 && ctx.d2(f.x, f.z, b.x, b.z) < 15 && ctx.useSkill(b, 1, face, f.id)) return true;
  const h = ctx.hurt[0];
  return !!(h && ctx.useSkill(b, 1, face, h.id));
}
registerClassBrain('cleric', {
  role: 'healer', name: 'Lyra',
  combat(b, tgt, ctx) {
    const { useSkill, moveToward, d2, dodge } = ctx;
    const front = ctx.tank && ctx.tank.id !== b.id ? ctx.tank : ctx.anchor;
    const f = ctx.healFocus;
    if (!dodge) {
      if (f && d2(f.x, f.z, b.x, b.z) > 11) moveToward(b, f.x, f.z, 6);       // keep the "heal me" player in range
      else if (front) { // behind the front line, facing the fight
        const tx = front.x - tgt.x, tz = front.z - tgt.z, tl = Math.hypot(tx, tz) || 1;
        moveToward(b, front.x + (tx / tl) * 5.5, front.z + (tz / tl) * 5.5, 0.6);
      } else moveToward(b, tgt.x, tgt.z, 7.6);
    }
    const face = faceTo(b, tgt), d = d2(b.x, b.z, tgt.x, tgt.z);
    if (!dodge) b.face = face;
    if (tgt.winding && !tgt.staggered && d < 11 && useSkill(b, 0, face)) return true;          // Smite interrupt
    if (clericHeal(b, ctx, face)) return true;                                                  // Heal
    const low = ctx.party.all.filter(p => !p.dead && p.hp / p.maxHp < 0.7).length;
    if (low >= 1 && tgt.def.boss && useSkill(b, 3, face)) return true;                         // Sanctuary
    if (ctx.ready && b.engAt !== null && useSkill(b, 2, face)) return true;                     // Blessing
    if (ctx.ready && d < 11) useSkill(b, 0, face);                                              // Smite
    return true;
  },
  idle(b, ctx) { clericHeal(b, ctx, b.face); },
});

// Any other class until it gets its own plug-in: walk in, basic attack, other skills when ready.
registerClassBrain('*', {
  combat(b, tgt, ctx) {
    const { useSkill, moveToward, switchOpen, d2, dodge } = ctx;
    const reach = tgt.def.radius + 1.5, face = faceTo(b, tgt);
    if (!dodge) { moveToward(b, tgt.x, tgt.z, reach - 0.4); b.face = face; }
    if (d2(b.x, b.z, tgt.x, tgt.z) > reach + 1.2) return true;
    for (const slot of [3, 2, 1]) if ((!tgt.staggered || switchOpen(b, tgt)) && useSkill(b, slot, face)) return true;
    useSkill(b, 0, face);
    return true;
  },
});
