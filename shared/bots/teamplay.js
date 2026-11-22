// Bots and team combat (docs/ROADMAP.md G2): cash in partners' combo setups and join (or start) a Team Burst.
// Scaled by capability (shared/teamplay.js BOT_TEAM). Called from shared/bots/brain.js:
//   onEvent hook   'tsetup' / 'combo' / 'tbsync' / 'tburst' events (setups open on targets, windows)
//   comboTurn()    in act(), before the class plug-in: press the payoff skill on an open setup (true = it acted)
//   burstTurn()    in think(), each turn: join an open sync window, or start one when the gauge is full
//   setupTurn()    in act(), after comboTurn: open our setup for a partner who can pay it off (Set me up: always, for them)
//   chainTurn()    in act(), after setupTurn: keep our own skill chain going (shared/chains.js)
import { COMBOS, BOT_PAYOFF, BOT_SETUP, BOT_TEAM, BURST, SETUPS, canPay, combosOf } from '../teamplay.js';
import { CHAIN, BOT_CHAIN } from '../chains.js';
import { registerBotHook } from './registry.js';

const lvl = b => (b.skill >= 1 && b.skill <= 5 ? b.skill : 5);
const between = ([lo, hi]) => lo + (hi - lo) * Math.random();
const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

registerBotHook('onEvent', (b, e) => {
  if (e.t === 'tsetup') {
    if (e.by === b.id || !BOT_PAYOFF[b.cls]?.[e.k]) return;
    (b.tbSet ||= new Map()).set(e.id, { k: e.k, by: e.by, until: b.t + (e.d || 2.5), noticed: Math.random() < BOT_TEAM.notice[lvl(b)] });
  } else if (e.t === 'combo') {
    const s = b.tbSet?.get(e.id);
    if (s && COMBOS[e.k]?.setup === s.k) b.tbSet.delete(e.id); // spent by someone
    if (e.by === b.id) b.tbCombos = (b.tbCombos || 0) + 1;
  } else if (e.t === 'tburst') b.tbWin = null;
  else if (e.t === 'fx' && e.id === b.id && e.fin) b.finAt = b.t; // our basic finisher: a chain step
  else if (e.t === 'botcmd' && e.cmd === 'setme' && e.by && e.party && e.party === b.party && !e.no?.includes(b.id)
    && (!e.name || e.name.toLowerCase() === String(b.name).toLowerCase()) && e.by !== b.id) {
    b.setFor = { id: e.by, until: b.t + BOT_TEAM.setme };
  }
});

const RANGED_CLS = new Set(['ranger', 'cleric', 'bard']);
const alive = p => p && !p.dead && !p.downed;

// Open our setup on the target for a partner close enough to cash it in. Returns true when it acted.
export function setupTurn(b, tgt, ctx) {
  const S = BOT_SETUP[b.cls];
  if (!S || !tgt || ctx.dodge || tgt.def.prop || b.duel) return false;
  if (b.setFor && b.t > b.setFor.until) b.setFor = null;
  const ids = combosOf(S.k), mates = ctx.party?.mates || [];
  const fits = p => alive(p) && p.id !== b.id && ids.some(id => canPay(p.cls, id))
    && d2(p.x, p.z, tgt.x, tgt.z) - tgt.def.radius <= (RANGED_CLS.has(p.cls) ? BOT_TEAM.payerNearRanged : BOT_TEAM.payerNear);
  const asked = b.setFor ? mates.find(p => p.id === b.setFor.id) : null;
  const partner = asked && fits(asked) ? asked : !b.setFor ? mates.find(fits) : null;
  if (!partner) return false;
  if (!asked) { // not ordered: a roll every few seconds, by capability
    if (!b.setupRoll || b.t - b.setupRoll.at > BOT_TEAM.setupEvery) b.setupRoll = { at: b.t, ok: Math.random() < BOT_TEAM.setup[lvl(b)] };
    if (!b.setupRoll.ok) return false;
  }
  if (b.cds[S.slot] > 0 || d2(b.x, b.z, tgt.x, tgt.z) - tgt.def.radius > S.range) return false;
  const face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
  if (!ctx.useSkill(b, S.slot, face)) return false;
  b.face = face;
  if (b.setupRoll) b.setupRoll.ok = false; // one per roll
  if (SETUPS[S.k]?.call && b.t - (b.callAt ?? -99) >= (asked ? BOT_TEAM.setmeCall : BOT_TEAM.callEvery)) {
    b.callAt = b.t;
    b.send({ type: 'tcall', k: S.k });
  }
  return true;
}

// Keep our own chain going: right after a step (a skill press or a basic finisher), press another chain skill.
export function chainTurn(b, tgt, ctx) {
  const list = BOT_CHAIN[b.cls];
  if (!list || !tgt || ctx.dodge || tgt.def.prop) return false;
  let last = -1, at = b.finAt ?? -99;
  for (let s = 1; s < 4; s++) { const p = b.pressed?.[s] ?? -99; if (p > at) { at = p; last = s; } }
  if (b.t - at > CHAIN.window * 0.7 || b.t - at < 0.25) return false;
  if (b.chainRoll?.at !== at) b.chainRoll = { at, ok: Math.random() < BOT_CHAIN.chance[lvl(b)] };
  if (!b.chainRoll.ok) return false;
  const d = d2(b.x, b.z, tgt.x, tgt.z) - tgt.def.radius;
  for (const o of list) {
    if (o.slot === last || b.cds[o.slot] > 0 || d > o.range) continue;
    const face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
    if (!ctx.useSkill(b, o.slot, face)) continue;
    b.face = face; b.chainRoll.ok = false;
    return true;
  }
  return false;
}

// A partner's setup on our target that our class can cash in: press the payoff skill.
export function comboTurn(b, tgt, ctx) {
  const s = b.tbSet?.get(tgt?.id);
  if (!s) return false;
  if (s.until < b.t) { b.tbSet.delete(tgt.id); return false; }
  const pay = BOT_PAYOFF[b.cls]?.[s.k];
  if (!pay || !s.noticed || ctx.dodge) return false;
  if (d2(b.x, b.z, tgt.x, tgt.z) - tgt.def.radius > pay.range) return false;
  const face = Math.atan2(tgt.x - b.x, tgt.z - b.z);
  if (!ctx.useSkill(b, pay.slot, face)) return false;
  b.face = face;
  return true;
}

// The Team Burst: join an open window (chance + delay by capability), or start one with a full gauge while fighting
// (a human in the party gets BOT_TEAM.startWait s to start it first).
export function burstTurn(b, P) {
  if (b.dead || b.downed || !b.me) return;
  const key = b.party || b.id, row = b.tb?.find(r => r[0] === key), s = lvl(b);
  const sync = row?.[2] || 0, ids = row?.[3] || [];
  const press = () => { if (b.t - (b.tbPress || -9) > 0.5) { b.tbPress = b.t; b.send({ type: 'burst', m: b.tgtId || 0 }); } };
  if (sync > 0) {
    b.tbFull = null;
    if (ids.includes(b.id)) return;
    b.tbWin ||= { join: Math.random() < BOT_TEAM.join[s], at: b.t + between(BOT_TEAM.joinDelay[s]) };
    if (b.tbWin.join && b.t >= b.tbWin.at) press();
    return;
  }
  b.tbWin = null;
  if (!row || row[1] < BURST.max) { b.tbFull = null; return; }
  const tgt = b.tgtId != null && b.mobs.find(m => m.id === b.tgtId);
  if (!tgt || d2(b.x, b.z, tgt.x, tgt.z) - tgt.def.radius > 10) return;
  b.tbFull ||= { at: b.t, wait: P?.humans?.length ? BOT_TEAM.startWait : between(BOT_TEAM.joinDelay[s]) };
  const big = tgt.def.boss || tgt.def.elite;
  if (b.t - b.tbFull.at >= b.tbFull.wait + (big ? 0 : 8)) press(); // saved for a boss / elite unless it sits full a while
}
