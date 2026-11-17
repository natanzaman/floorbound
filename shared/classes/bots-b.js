// Bot brains for the Lancer and the Bard, used by shared/teambots.js (single bots, and extra members of a party).
// ctx: helpers from startTeam { useSkill, moveToward, switchOpen, d2, anchor(b) -> the player/bot to stay near or null }.
// Each brain gets the bot b, its target tgt and dodge (a spot to roll to, or null; when set the bot is already evading).
import { LANCE } from './lancer.js';
import { SONG } from './bard.js';

export const TEAM_NAMES_B = { lancer: 'Rook', bard: 'Wren' };

// Move to a point `keep` metres from the target's centre, on the side we're on (back off if too close).
function holdRange(ctx, b, tgt, keep, side = null) {
  const sx = side ? side.x : b.x, sz = side ? side.z : b.z;
  const d = ctx.d2(sx, sz, tgt.x, tgt.z) || 1;
  const spot = [tgt.x + ((sx - tgt.x) / d) * keep, tgt.z + ((sz - tgt.z) / d) * keep];
  ctx.moveToward(b, spot[0], spot[1], 0.35);
}

export const CLASS_BRAINS_B = {
  // Lancer: fights at the tip of its spear (the +30% sweet spot), charges to close gaps, Sky Lance to Break.
  lancer(ctx, b, tgt, dodge) {
    const { useSkill, switchOpen, d2 } = ctx;
    const edge = d2(b.x, b.z, tgt.x, tgt.z) - tgt.def.radius, want = LANCE.reach - 0.9;
    if (!dodge) {
      if (edge > want + 0.4 || edge < LANCE.sweetFrom) holdRange(ctx, b, tgt, tgt.def.radius + want);
      b.face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
    }
    const face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
    if (edge > 5.5 && edge < LANCE.charge.len && useSkill(b, 1, face)) return; // Lance Charge: close the gap
    if (edge > LANCE.reach + 0.4) return;
    const crowd = b.mobs.filter(m => d2(m.x, m.z, b.x, b.z) < LANCE.sweep.r + m.def.radius).length;
    if (switchOpen(b, tgt) && useSkill(b, 3, face)) return;                       // Sky Lance into a teammate's Break
    if (!tgt.staggered && edge > 2 && useSkill(b, 3, face)) return;                 // ...or to Break it ourselves
    if ((crowd >= 2 || (tgt.winding && !tgt.def.boss)) && edge < LANCE.sweep.r && useSkill(b, 2, face)) return; // Sweep
    useSkill(b, 0, face);                                                           // Thrust
  },

  // Bard: hangs back at 7-9 m, Dissonance on wind-ups, songs when allies are near, Crescendo to cash in Discord.
  bard(ctx, b, tgt, dodge) {
    const { useSkill, d2 } = ctx;
    const allies = b.players.filter(p => p.id !== b.id && !p.dead && d2(p.x, p.z, b.x, b.z) < SONG.anthem.r);
    const edge = d2(b.x, b.z, tgt.x, tgt.z) - tgt.def.radius, a = ctx.anchor(b);
    if (!dodge) {
      if (edge > 9 || edge < 6) holdRange(ctx, b, tgt, tgt.def.radius + 7.5, a && d2(a.x, a.z, tgt.x, tgt.z) > 3 ? a : null); // behind our front line
      b.face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
    }
    const face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
    if (tgt.winding && !tgt.staggered && edge < SONG.dissonance.r - 0.5 && useSkill(b, 2, face)) return; // interrupt
    const discord = b.discord?.[tgt.id], stacks = discord && discord.until > b.t ? discord.n : 0;
    if (edge < SONG.crescendo.er - 1 && stacks >= (tgt.def.boss ? 5 : 3) && useSkill(b, 3, face)) return; // cash in for a Break
    if (allies.length && edge < 12 && useSkill(b, 1, face)) return;                   // Anthem for the party
    if (allies.length && tgt.def.boss && b.hp / b.maxHp < 0.6 && useSkill(b, 3, face)) return; // Crescendo shields when it's rough
    const cone = b.mobs.filter(m => d2(m.x, m.z, b.x, b.z) < SONG.dissonance.r + m.def.radius).length;
    if (cone >= 2 && useSkill(b, 2, face)) return;                                   // Dissonance on a pack that got close
    if (edge < SONG.bolt.range - 0.8) useSkill(b, 0, face);                          // Sonic Bolt
  },
};

// The bard bot tracks Discord stacks from the server's events.
export function botEventB(b, e) {
  if (e.t === 'fx' && e.k === 'cb' && e.ev === 'discord') (b.discord ||= {})[e.m] = { n: e.n, until: b.t + (e.d || 0) };
}
