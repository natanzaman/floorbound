// The plan runner (docs/briefs/bot-plans.md): drives a bot through the steps of its plan. The menu, the parsing and
// the cleaning are shared/bots/plan.js. Nothing here talks to the server by itself: the brain passes { command, say }.
//
// Every step sets the bot's order (b.cmd, marked plan: 1), so the brain's own fighting, dodging, potions, revives and
// rescues go on as before. A town raid's `defend` pauses the plan, and so does being down or dead: the runner is not
// called then (or returns at once), and the gap is taken off every clock when it runs again.
import { MOBS } from '../data.js';
import { WAYPOINTS, floorOf, floorUnlocked } from '../floor2.js';
import { GARDEN } from '../life.js';
import { useSkill, d2 } from './motor.js';
import { STEPS, PLACES, PLAN_MAX, REACH, cleanPlan, planText, stepText, mobName } from './plan.js';

const COME_R = 6;  // m: "back with the player" (a follower's own spot in the formation is up to 5 m off)
const GAP = 1;     // s without a turn (down, dead, a raid) before the clocks are held back

// Take a plan. o: { by (player id, 0 = code / admin page), byName, adm (not a party order), at ([x, z] of that player),
// group (bot ids addressed), quiet (don't announce) }. api: { command, say } from the brain. Returns the clean plan, or
// null (nothing usable, or a scripted actor).
export function setPlan(b, raw, o = {}, api) {
  const c = cleanPlan(raw);
  if (!c?.steps.length || b.script || b.closed) return null;
  const group = o.group?.length ? o.group : [b.id];
  const first = group.filter(id => id === b.id || b.players?.some(p => p.id === id && !p.dead))[0] === b.id; // one bot speaks for a group
  endPlan(b);
  b.plan = { steps: c.steps, loops: c.loops, loop: 0, i: 0, by: o.by || 0, byName: o.byName || '', adm: !!o.adm, at: Array.isArray(o.at) && Number.isFinite(+o.at[0]) && Number.isFinite(+o.at[1]) ? [+o.at[0], +o.at[1]] : null, group, all: group.length > 1, speak: first || group.length < 2, t0: b.t, seen: b.t, st: null };
  b.cmd = null; b.tgtId = null; b.planNote = null;
  if (o.by) b.lastCmdBy = o.by;
  if (!o.quiet) tell(b, api, planText(b.plan) + '.');
  return c;
}

// Drop the plan (and the order it was running; keep: the order stays, as the bot's own from now on).
export function endPlan(b, keep = false) {
  const p = b.plan; if (!p) return;
  if (p.st?.pose && p.st.pose !== 'hop') b.send?.({ type: 'chat', text: '/stand' });
  b.plan = null;
  if (b.cmd?.prev?.plan) b.cmd.prev = null; // (a raid's defend order was keeping our step's order to go back to)
  if (!b.cmd?.plan) return;
  if (!keep) { b.cmd = null; return; }
  delete b.cmd.plan;
  if (b.cmd.k === 'stay') b.cmd.post = 1; // a place it was sent to: it holds there (server/botmanager.js never pulls it back to its player)
}

const tell = (b, api, text) => { if (b.plan?.speak !== false) api?.say?.(b, 'plan', {}, { force: true, text: text.slice(0, 200) }); };
const who = p => p.byName || 'boss';
// A plan that has to stop. One bot speaks for a group; another of the group says why it stopped a moment later, unless
// somebody in the party spoke meanwhile (the speaker stopping for the same reason, most often).
function stop(b, api, why) {
  const text = `Plan stopped: ${why}.`;
  if (b.plan?.speak === false) b.planNote = { at: b.t + 1 + Math.random() * 2, t: b.t, text };
  else tell(b, api, text);
  endPlan(b);
}
export function planNote(b, api) {
  const n = b.planNote; if (!n || b.t < n.at) return;
  b.planNote = null;
  if ((b.partyChatT ?? -99) < n.t) api?.say?.(b, 'plan', {}, { force: true, text: n.text });
}

// Where a step's place is for this bot now: { x, z, r, floor, name } or null.
function resolve(b, p, id) {
  if (id === 'spot' || !id) return { x: b.x, z: b.z, r: 0, floor: floorOf(b.x), name: 'this spot' };
  if (id === 'here') { const [x, z] = p.at || [b.x, b.z]; return { x, z, r: 0, floor: floorOf(x), name: 'your spot' }; }
  if (id === 'camp') { const w = WAYPOINTS.find(w => w.floor === floorOf(b.x)) || WAYPOINTS[0]; return { x: w.x, z: w.z, r: w.r, floor: w.floor, name: w.name }; }
  const pl = Object.hasOwn(PLACES, id) ? PLACES[id] : null;
  return pl ? { x: pl.x, z: pl.z, r: pl.r, floor: pl.floor, name: pl.name } : null;
}
const order = (p, b, more) => ({ by: p.by, byName: p.byName || 'admin', adm: p.adm || !p.by, at: b.t, plan: 1, ...more });
const hold = (b, p, pl, more = {}) => { b.cmd = order(p, b, { k: 'stay', x: pl.x, z: pl.z, stop: pl.r ? pl.r + 1.2 : 1.2, fl: pl.floor, ...more }); };
const arrived = (b, st) => floorOf(b.x) === st.fl && d2(b.x, b.z, st.x, st.z) <= st.stop + 1.3;
const isLast = p => p.i === p.steps.length - 1 && p.loop === p.loops - 1;

// Start step s. Returns a reason (string) when it cannot be done at all.
function begin(b, P, p, s, api) {
  const st = p.st = { t0: b.t };
  const give = (k, more = {}) => { api.command(b, { k, by: p.by, byName: p.byName, group: p.group, all: p.all, adm: p.adm, quiet: true, plan: 1, ...more }); if (b.cmd) b.cmd.plan = 1; };
  switch (s.k) {
    case 'goto': case 'guard': {
      const pl = resolve(b, p, s.place);
      if (!pl) return `I don't know that place`;
      if (pl.floor !== floorOf(b.x) && !floorUnlocked(b.life, pl.floor)) return `Floor ${pl.floor} is sealed for me`;
      Object.assign(st, { x: pl.x, z: pl.z, fl: pl.floor, stop: pl.r ? pl.r + 1.2 : 1.2, name: pl.name, at: null });
      hold(b, p, pl, s.k === 'guard' ? { guard: 1 } : {});
      return;
    }
    case 'come': case 'follow':
      if (!p.by) return 'nobody to go to';
      give(s.k);
      return;
    case 'wait': hold(b, p, { x: b.x, z: b.z, r: 0, floor: floorOf(b.x) }); return;
    case 'farm':
      give('farm');
      if (b.cmd && s.mob) b.cmd.mob = s.mob;
      st.kills = 0; st.seen = b.t;
      return;
    case 'boss': give('boss'); return;
    case 'attack': {
      const tgt = b.locks?.get(p.by) || 0;
      if (tgt) give('attack', { tgt });
      if (b.cmd?.k !== 'attack') { st.skip = true; if (p.speak) api.say?.(b, 'noTarget', { who: who(p) }, { force: true }); }
      return;
    }
    case 'tend':
      if (floorOf(b.x) !== 1) return `the garden is on Floor 1`;
      hold(b, p, { x: GARDEN.x + 4, z: GARDEN.z + 3, r: 0, floor: 1 }, { tend: 1, stop: 0.8 });
      return;
    case 'say': if (p.speak) api.say?.(b, 'plan', {}, { force: true, text: s.text }); return; // (one bot says it for a group)
    case 'emote':
      hold(b, p, { x: b.x, z: b.z, r: 0, floor: floorOf(b.x) });
      st.pose = s.pose;
      b.send(s.pose === 'hop' ? { type: 'jump' } : { type: 'chat', text: `/${s.pose}` });
      return;
    case 'skill': return;
  }
}

// Is step s over? 'done', 'keep' (the plan's last step, and its order stays), a reason (string: the plan stops) or
// null (still going).
function check(b, P, p, s) {
  const st = p.st, S = STEPS[s.k], t = b.t - st.t0;
  const secs = s.secs || S.secs?.[2] || 0;
  switch (s.k) {
    case 'goto':
      if (arrived(b, st)) return isLast(p) ? 'keep' : 'done'; // the last step: it stays there
      break;
    case 'guard':
      if (st.at == null) { if (arrived(b, st)) st.at = b.t; else if (t > REACH) return `I couldn't get to ${st.name}`; return null; }
      return b.t - st.at >= secs ? 'done' : null;
    case 'come': {
      const q = b.players?.find(q => q.id === p.by);
      if (!q) return `I can't find ${who(p)}`;
      if (floorOf(q.x) === floorOf(b.x) && d2(q.x, q.z, b.x, b.z) < COME_R) return 'done';
      break;
    }
    case 'follow': case 'wait':
      if (!s.secs && isLast(p)) return 'keep'; // the last step, no time given: stays following / waiting
      return t >= secs ? 'done' : null;
    case 'tend': return t >= secs ? 'done' : null;
    case 'farm': {
      if (st.kills >= s.n) return 'done';
      if (s.mob) {
        const fl = floorOf(b.x);
        if ((b.allMobs || b.mobs || []).some(m => m.type === s.mob && floorOf(m.x) === fl)) st.seen = b.t;
        else if (b.t - st.seen > 90) return `there are no ${mobName(s.mob, 2)} on this floor`;
      }
      break;
    }
    case 'boss': if (st.bossDown) return 'done'; break;
    case 'attack': if (st.skip || b.cmd?.k !== 'attack') return 'done'; break;
    case 'say': return t >= 1.5 ? 'done' : null;
    case 'emote':
      if (t < (s.pose === 'hop' ? 1 : secs)) return null;
      if (s.pose !== 'hop') b.send({ type: 'chat', text: '/stand' });
      st.pose = null;
      return 'done';
    case 'skill': if (useSkill(b, s.slot, b.face)) return 'done'; break;
  }
  if (S.limit && t > S.limit) return S.hard ? ({ goto: `I couldn't get to ${st.name}`, come: `I couldn't reach ${who(p)}`, boss: 'the boss is still standing' })[s.k] : 'done';
  return null;
}

// Once per think turn, before the brain picks its mode. api: { command, say }.
export function planTurn(b, P, api) {
  const p = b.plan; if (!p) return;
  if (b.script) return endPlan(b);
  if (!p.adm && p.by && !P.all.some(q => q.id === p.by)) return endPlan(b); // the player who gave it left the party
  if (b.cmd?.defend || b.dead) return; // a town raid (brain.js 'release' puts our order back), or dead: the plan waits
  const gap = b.t - p.seen; p.seen = b.t;
  if (gap > GAP) { p.t0 += gap; const st = p.st; if (st) { st.t0 += gap; if (st.at != null) st.at += gap; if (st.seen != null) st.seen += gap; } } // (its clocks waited too)
  if (b.t - p.t0 > PLAN_MAX) return void stop(b, api, 'it took too long');
  for (let n = 0; n < 3; n++) { // (a few instant steps a turn at most)
    const s = p.steps[p.i];
    if (!p.st) {
      b.cmd = null;
      const why = begin(b, P, p, s, api);
      if (why) return void stop(b, api, why);
      if ((p.i > 0 || p.loop > 0) && STEPS[s.k].long) tell(b, api, `Next: ${stepText(s)}.`);
    } else if (!b.cmd && s.k !== 'attack' && s.k !== 'say' && s.k !== 'skill') { // our order was dropped (the brain lost sight of someone): give it again
      const was = p.st, why = begin(b, P, p, s, api);
      if (why) return void stop(b, api, why);
      p.st = { ...p.st, ...was }; // (its clock and counts carry on)
    }
    const r = check(b, P, p, s);
    if (!r) return;
    if (r !== 'done' && r !== 'keep') return void stop(b, api, r);
    p.st = null;
    if (++p.i >= p.steps.length) {
      if (++p.loop < p.loops) p.i = 0;
      else { tell(b, api, r !== 'keep' ? `Plan done, ${who(p)}.` : s.k === 'follow' ? `On you, ${who(p)}.` : `Plan done, ${who(p)}. I'll wait here.`); return endPlan(b, r === 'keep'); }
    }
  }
}

// Brain events the plan counts: our party's kills for a farm step, the boss going down. A raid's kills are not the
// plan's. e: a 'hit' or a 'die'; mob: that monster as last seen ({ type }, or undefined); hits: who hit it (the brain's
// b.hits entry, which forgets monsters out of sight: the step keeps its own note of what our party hit, and when).
export function planEvent(b, e, { hits = null, mob = null, mateOf }) {
  const p = b.plan, st = p?.st, s = p && p.steps[p.i];
  if (!st || (s.k !== 'farm' && s.k !== 'boss') || b.cmd?.defend) return;
  const us = id => id === b.id || mateOf(b, id);
  if (e.t === 'hit') {
    if (e.prop || e.du || !us(e.by)) return;
    const m = (st.mine ||= new Map());
    if (m.size > 300) m.clear();
    m.set(e.id, { kind: mob?.type || m.get(e.id)?.kind || '', t: b.t });
    return;
  }
  if (e.t !== 'die') return;
  const rec = st.mine?.get(e.id);
  const ours = (!!rec && b.t - rec.t < 30) || (!!hits && [...hits.entries()].some(([id, h]) => us(id) && !(b.t - h.last > 30))); // (a monster we tapped long ago and a stranger finished is theirs)
  const kind = rec?.kind || hits?.kind || mob?.type || '';
  st.mine?.delete(e.id);
  if (s.k === 'boss' && e.b && (ours || (Number.isFinite(e.x) && floorOf(e.x) === floorOf(b.x)))) st.bossDown = true;
  if (s.k === 'farm' && ours && !e.b && !MOBS[kind]?.prop && (!s.mob || kind === s.mob)) st.kills++;
}
