// Per-class bot brains: a small plug-in registry used by the per-bot brain (shared/bots/brain.js).
//
// The brain does everything that is the same for every class: perception (capability levels), dodging, party
// cohesion, target choice, commands and chatter. A class plug-in only plays its kit against the target it is given:
//
//   registerClassBrain('ranger', {
//     role: 'dps',              // 'tank' | 'dps' | 'healer' | 'support' (default: from CLASSES[cls].role)
//     name: 'Sylas',            // default bot name for this class (teams, admin presets)
//     parry: false,             // true: parries the Horn Sweep with guard (Guardian) instead of rolling through it
//     combat(b, tgt, ctx) {},   // one turn against tgt: move + press skills. Return false to fall back to the generic brain.
//     idle(b, ctx) {},          // optional: a turn with no target (after moving): heals, buffs, songs
//     onEvent(b, e) {},         // optional: every snapshot event this bot perceives (class resources: Rage, Discord...)
//     onLevel(b, lvl, ctx) {},  // optional: this bot levelled up
//   });
//
// ctx (built fresh each turn by the brain):
//   basic                    the bot's basic attack with its weapon style: { kind, reach, sweet, min, half } (shared/bots/style.js)
//   useSkill(b, slot, face, tid?)  press a skill (capability cadence applied; false if on cooldown / not unlocked / not yet noticed)
//   moveToward(b, x, z, stop?, speed?)   walk (capability positioning noise applied); true if it moved
//   switchOpen(b, mob)       a party member (or anyone else) Broke this mob: Switch in now
//   d2(ax, az, bx, bz)       distance
//   dodge                    a spot the bot is already rolling/running to (don't move this turn), or null
//   ready                    the party's tank has held this target for a moment (DPS: go in now); true without a tank
//   anchor                   who to stand relative to: the party's tank on this target, else the leader / followed player, or null
//   tank                     the party's tank (any member, human or bot) or null
//   leader                   the party leader (human first), or null when this bot leads
//   party                    { mates, humans, all } party members as seen in the snapshot (player rows + name/bot/role)
//   hurt                     party members (and me) under 78% HP within 15 m, most hurt first
//   healFocus                a player a "heal me" command asked us to keep up, or null
//   engaged                  seconds since this bot engaged its current target (null before)
//   say(key, text, opts)     rate-limited party chatter
//
// Hooks for systems built elsewhere (talent trees, weapon styles): registerBotHook('onLevel', (b, lvl, ctx) => {...}).
import { CLASSES } from '../data.js';

const BRAINS = new Map();
const HOOKS = { onLevel: [], onJoin: [], onEvent: [] };

export function registerClassBrain(cls, spec) { BRAINS.set(cls, { ...spec }); return spec; }
export function registerBotHook(name, fn) { (HOOKS[name] ||= []).push(fn); }
export function runHooks(name, ...args) { for (const fn of HOOKS[name] || []) { try { fn(...args); } catch (err) { console.error(`bot hook ${name}`, err); } } }

// The plug-in for a class (the generic fallback when none is registered).
export function brainFor(cls) { return BRAINS.get(cls) || BRAINS.get('*') || {}; }
export function hasBrain(cls) { return BRAINS.has(cls); }

const ROLE = { Tank: 'tank', Damage: 'dps', Healer: 'healer', Support: 'support' };
export function roleOf(cls) { return BRAINS.get(cls)?.role || ROLE[CLASSES[cls]?.role] || 'dps'; }
export function defaultName(cls) { return BRAINS.get(cls)?.name || CLASSES[cls]?.name || 'Bot'; }
