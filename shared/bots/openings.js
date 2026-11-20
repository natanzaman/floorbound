// Bots and the boss timing tables (docs/ROADMAP.md J3, shared/bosstiming.js):
//  - Openings (w.op): melee bots move in when a boss's opening starts and step back out just before it ends (the boss's
//    next move comes right after). The tank stays on it. Capability (shared/botskill.js) delays noticing it.
//  - Gale Push (the Colossus's cone, f3fx 'gust'): read its avoidability from the table (roll / outrange): walk out of the
//    cone's side when there is time, roll out when it is close, or roll through it as it lands (the i-frames cover the
//    safe window). Capability delays or misses the telegraph, like any other.
import { DODGE, PLAYER_SPEED, wrapAngle } from '../data.js';
import { COLOSSUS, F3 } from '../floor3.js';
import { AFTER_STATES, safeWindow } from '../bosstiming.js';
import { BOT_SKILLS, reaction } from '../botskill.js';
import { registerBotHook } from './registry.js';
import { d2, moveToward, evade } from './motor.js';

const react = b => { const r = BOT_SKILLS[b.skill]?.react || [0, 0]; return (r[0] + r[1]) / 2; };

registerBotHook('onEvent', (b, e) => {
  if (e.t !== 'f3fx' || e.k !== 'gust') return;
  const r = b.skill && b.skill < 5 ? reaction(b.skill) : { delay: 0 };
  if (r.drop) return; // misjudged: stands in it
  const G = COLOSSUS.gust, [land] = safeWindow({ ...G, wind: e.d ?? G.wind }); // when the cone lands (s from now)
  (b.gusts ||= []).push({ id: e.id, x: e.x, z: e.z, f: e.f, r: e.r ?? G.r, h: e.h ?? G.half, at: b.t + land, seeAt: b.t + r.delay, avoid: G.avoid.by });
});

/** The bosses' openings from the snapshot (w.op: [[id, state index, s left, s total]]) into b.openings. */
export function readOpenings(b, op) {
  const next = new Map();
  for (const [id, si, left] of op || []) {
    const was = b.openings?.get(id);
    next.set(id, { state: AFTER_STATES[si], end: b.t + left, seeAt: was ? was.seeAt : b.t + react(b) });
  }
  b.openings = next;
}

/** The opening on boss `tgt` this bot has noticed, or null. */
export function openingOn(b, tgt) {
  const o = tgt && b.openings?.get(tgt.id);
  return o && b.t >= o.seeAt && b.t < o.end ? o : null;
}

// A spot pulled inside the Eye of the Storm (the arena radius - 1): never run out of the fight.
function inArena(x, z) {
  const A = F3.arena, d = d2(x, z, A.x, A.z), max = A.r - 1;
  return d <= max ? [x, z] : [A.x + ((x - A.x) / d) * max, A.z + ((z - A.z) / d) * max];
}

// Is this bot standing in a Gale Push cone?
function inGust(b, g, radius) {
  const d = d2(b.x, b.z, g.x, g.z);
  if (d > g.r + 1.1) return false;
  return d <= radius + 1.2 || Math.abs(wrapAngle(Math.atan2(b.x - g.x, b.z - g.z) - g.f)) <= g.h + 0.15;
}

/** Get out of a Gale Push. True while it takes the bot's turn. */
export function gustDodge(b) {
  if (!b.gusts?.length) return false;
  b.gusts = b.gusts.filter(g => g.at > b.t - 0.1);
  for (const g of b.gusts) {
    const left = g.at - b.t;
    if (b.t < g.seeAt || left < -0.05) continue;
    const radius = b.mobs.find(m => m.id === g.id)?.def.radius ?? 2.6;
    if (!inGust(b, g, radius)) continue;
    // outrange: off the cone's nearer side (at least clear of its core), or straight out past its reach; both kept
    // inside the arena. Near the wall, straight out can end up still in the cone: then the side.
    const a = Math.atan2(b.x - g.x, b.z - g.z), side = wrapAngle(a - g.f) >= 0 ? 1 : -1, d = d2(b.x, b.z, g.x, g.z);
    const ea = g.f + side * (g.h + 0.5), er = Math.max(d, radius + 2.4);
    const off = inArena(g.x + Math.sin(ea) * er, g.z + Math.cos(ea) * er), out = inArena(g.x + Math.sin(a) * (g.r + 2), g.z + Math.cos(a) * (g.r + 2));
    const outSafe = !inGust({ x: out[0], z: out[1] }, g, radius);
    const spot = !outSafe || d2(b.x, b.z, ...off) <= d2(b.x, b.z, ...out) ? off : out, far = d2(b.x, b.z, ...spot);
    const roll = g.avoid.includes('roll') && b.dodgeCd <= 0 && !b.roll;
    if (g.avoid.includes('outrange') && far / PLAYER_SPEED < left - 0.15) { moveToward(b, spot[0], spot[1], 0.2); return true; }
    if (roll && far <= DODGE.dist) { evade(b, spot[0], spot[1]); return true; } // a roll carries us out
    if (roll && left <= DODGE.iframes - 0.12) { evade(b, spot[0], spot[1]); return true; } // through it: i-frames as it lands
    moveToward(b, spot[0], spot[1], 0.2);
    return true;
  }
  return false;
}

/** Melee (not the tank): in when the target boss opens up, out just before the opening ends. True if it took the turn
 *  (moving, or holding back as it closes); false: the class brain plays on (ctx.ready is set during an opening: go in now). */
export function openingTurn(b, tgt, ctx) {
  const o = tgt?.def?.boss && openingOn(b, tgt);
  if (!o || b.role === 'tank' || ctx.basic.kind === 'ranged') return false;
  const reach = tgt.def.radius + Math.max(1, ctx.basic.reach - 1.4), d = d2(b.x, b.z, tgt.x, tgt.z);
  const leave = 0.35 + react(b); // step out this long before it ends
  if (o.end - b.t <= leave) {
    if (d > tgt.def.radius + 4.5) { b.goal = 'Waiting out the closing opening'; return true; } // far enough: hold (don't walk in)
    const a = Math.atan2(b.x - tgt.x, b.z - tgt.z);
    moveToward(b, tgt.x + Math.sin(a) * (tgt.def.radius + 5), tgt.z + Math.cos(a) * (tgt.def.radius + 5), 0.2);
    b.goal = 'Stepping out before the opening closes';
    return true;
  }
  ctx.ready = true; // the opening is the moment: no waiting on the tank
  if (d > reach + 0.4 && !ctx.dodge) { moveToward(b, tgt.x, tgt.z, reach); b.face = Math.atan2(tgt.x - b.x, tgt.z - b.z); b.goal = 'In for the opening'; return true; }
  return false;
}
