// Client side of the talent trees (data and rules: shared/talents.js, server: server/talents.js).
// The Skill Tree window (K, the Skills button, F at a Skill Shrine) with three panes:
//   Progression  levels 1-20 on a track: skills, talent points, tier openings and floor milestones; class growth.
//   Talents      the class's three branches drawn as a star chart: hover for exact numbers, click to learn,
//                right-click to refund (at a Skill Shrine), Respec at a shrine.
//   Abilities    every skill with its mastery, its evolution branches and the talents that change it.
// Also: the unspent-points badge on the Skills chip, the one-time "talent point" tip, talent proc visuals,
// and the client-side bits of talent effects (move speed, skill cooldown display).
import { CLASSES, MAX_LEVEL, statsFor } from '/shared/data.js';
import { MASTERY, BRANCHES, masteryLevel, masteryProgress, activeBranch, skillName, skillDesc, masteryCd } from '/shared/mastery.js';
import {
  TALENTS, TREES, MILESTONES, pointsAt, levelForPoint, nodeDef, nodesOf, spentOf, branchSpent, spentAbove, spendBlock, refundBlock,
  talentTotals, nodeLines, effectText, nodesForSkill, STAT_TEXT,
} from '/shared/talents.js';
import { keyName, tapping } from '/keyname.js'; // prompts name the player's key on the active device

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = n => `#${n.toString(16).padStart(6, '0')}`;
const SERIF = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

const CSS = `
#talentsp { --cc: #60a5fa; --ink: #e8e2d0; --ember: #e9b949; --line: #33405c; --slate: #0f1626; --raised: #172036;
  position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 48px); left: 50%; transform: translateX(-50%);
  width: min(1180px, 97vw); height: min(780px, calc(100vh - 70px)); z-index: 20; display: flex; flex-direction: column;
  background-color: #0d1322; background-image: radial-gradient(120% 60% at 50% -10%, color-mix(in srgb, var(--cc) 14%, transparent), transparent 60%);
  border: 1px solid color-mix(in srgb, var(--cc) 40%, #2a3550); border-radius: 14px; color: var(--ink);
  box-shadow: 0 24px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03) inset; font-size: 13px; overflow: hidden; user-select: none; }
#talentsp.hidden { display: none; }
#tflash { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); max-width: 70%; padding: 8px 14px; border-radius: 10px; background: #2a1414; border: 1px solid #f87171; color: #fecaca; font: 600 13px system-ui; pointer-events: none; opacity: 0; transition: opacity .2s; z-index: 60; }
#tflash.on { opacity: 1; } #tflash.off { opacity: 0; }
body.tree-open #rare-hint { display: none !important; } /* the rare-enemy pointer sits over the window's tabs */
#talentsp h3, #talentsp .serif { font-family: ${SERIF}; font-weight: 600; letter-spacing: .01em; }
#talentsp .hd { display: flex; align-items: center; gap: 14px; padding: 12px 16px 10px; border-bottom: 1px solid rgba(255,255,255,.06); }
#talentsp .emb { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font: 600 20px ${SERIF};
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--cc) 70%, white), var(--cc) 55%, color-mix(in srgb, var(--cc) 40%, black));
  color: #0d1424; box-shadow: 0 0 18px color-mix(in srgb, var(--cc) 55%, transparent); flex: none; }
#talentsp .who h3 { margin: 0; font-size: 20px; line-height: 1.1; }
#talentsp .who small { display: block; opacity: .7; font-size: 12px; margin-top: 2px; }
#talentsp .xpb { width: 150px; height: 4px; border-radius: 3px; background: rgba(255,255,255,.08); margin-top: 5px; overflow: hidden; }
#talentsp .xpb > i { display: block; height: 100%; background: var(--cc); }
#talentsp .tabs { display: flex; gap: 4px; margin-left: 22px; }
#talentsp .tabs button { background: transparent; border: 0; color: var(--ink); opacity: .6; font: 600 15px ${SERIF}; padding: 8px 12px 6px; border-bottom: 2px solid transparent; cursor: pointer; }
#talentsp .tabs button:hover { opacity: .9; }
#talentsp .tabs button.on { opacity: 1; border-bottom-color: var(--cc); }
#talentsp .tabs button:focus-visible, #talentsp button:focus-visible { outline: 2px solid var(--cc); outline-offset: 2px; }
#talentsp .pts { margin-left: auto; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); font-weight: 700; white-space: nowrap; }
#talentsp .pts.has { border-color: var(--ember); color: var(--ember); box-shadow: 0 0 14px rgba(233,185,73,.25); }
#talentsp .x { background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
#talentsp .body { flex: 1; min-height: 0; position: relative; }
#talentsp .pane { position: absolute; inset: 0; overflow: auto; padding: 14px 16px; }
#talentsp .note { opacity: .72; font-size: 12px; line-height: 1.45; }
#talentsp .shrine-on { color: #c4b5fd; opacity: 1; }

/* ---- talents ---- */
#talentsp .tgrid { display: grid; grid-template-columns: minmax(0, 1fr) 262px; gap: 14px; height: 100%; }
#talentsp .treewrap { display: flex; flex-direction: column; min-height: 0; }
#talentsp .bheads { display: grid; grid-template-columns: 5.8% repeat(3, 1fr); }
#talentsp .bh { padding: 0 10px 6px; border-bottom: 2px solid color-mix(in srgb, var(--bc) 55%, transparent); margin: 0 8px; }
#talentsp .bh h3 { margin: 0; font-size: 18px; color: var(--bc); display: flex; justify-content: space-between; align-items: baseline; }
#talentsp .bh h3 span { font: 600 12px system-ui, sans-serif; color: var(--ink); opacity: .75; }
#talentsp .bh p { margin: 2px 0 0; font-size: 12px; opacity: .65; }
#talentsp svg.tree { flex: 1; min-height: 0; width: 100%; display: block; }
#talentsp .tn { cursor: pointer; }
#talentsp .tn .core { fill: #111a2d; stroke-width: 2; }
#talentsp .tn .halo { opacity: 0; }
#talentsp .tn .glyph { font-size: 18px; text-anchor: middle; dominant-baseline: central; fill: var(--ink); pointer-events: none; }
#talentsp .tn .rk { font: 700 10.5px system-ui, sans-serif; text-anchor: middle; fill: var(--ink); opacity: .75; pointer-events: none; }
#talentsp .tn .arc { fill: none; stroke-width: 3; stroke-linecap: round; }
#talentsp .tn.locked .core { stroke: #2b3550 !important; }
#talentsp .tn.locked .glyph { opacity: .3; }
#talentsp .tn.locked .rk { opacity: .35; }
#talentsp .tn.open .glyph { opacity: .75; }
#talentsp .tn.avail .halo { opacity: .55; animation: tn-pulse 2.2s ease-in-out infinite; }
#talentsp .tn.part .halo { opacity: .35; }
#talentsp .tn.max .halo { opacity: .7; }
#talentsp .tn.max .core { stroke: var(--ember) !important; }
#talentsp .tn.max .rk { fill: var(--ember); opacity: 1; }
#talentsp .tn:hover .core { stroke-width: 3; }
#talentsp .tn.hl .core { stroke: #fff !important; stroke-width: 3; }
#talentsp .tn.pop .halo { animation: tn-pop .7s ease-out 1; opacity: .9; }
#talentsp .edge { fill: none; stroke-width: 2; }
#talentsp .edge.off { stroke: #29334b; stroke-dasharray: 4 5; }
#talentsp .gate { stroke: rgba(255,255,255,.06); stroke-dasharray: 2 6; }
#talentsp .tier { font: 600 12px ${SERIF}; fill: var(--ink); opacity: .55; }
#talentsp .tier.lock { opacity: .35; }
#talentsp .tier small, #talentsp .tsub { font: 500 10px system-ui, sans-serif; fill: var(--ink); opacity: .5; }
@keyframes tn-pulse { 50% { opacity: .18; } }
@keyframes tn-pop { 0% { transform: scale(.6); opacity: 1; } 100% { transform: scale(1.8); opacity: 0; } }
#talentsp .side { border-left: 1px solid rgba(255,255,255,.06); padding-left: 14px; overflow: auto; }
#talentsp .big { font: 600 44px/1 ${SERIF}; color: var(--ember); }
#talentsp .big.zero { color: var(--ink); opacity: .5; }
#talentsp .side h4 { font: 600 14px ${SERIF}; margin: 16px 0 6px; }
#talentsp .bon { list-style: none; padding: 0; margin: 0; }
#talentsp .bon li { padding: 3px 0 3px 10px; border-left: 2px solid var(--bc, var(--line)); margin-bottom: 4px; font-size: 12px; line-height: 1.35; }
#talentsp .bon li.k { border-left-color: var(--ember); }
#talentsp .btn { width: 100%; margin-top: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid #6d5bd0; background: rgba(124,58,237,.18); color: var(--ink); font-weight: 700; cursor: pointer; }
#talentsp .btn:disabled { opacity: .4; cursor: default; border-color: var(--line); background: transparent; }
#talentsp .btn.warn { border-color: #f59e0b; background: rgba(245,158,11,.18); }
#talentsp .legend { display: grid; grid-template-columns: auto 1fr; gap: 5px 8px; align-items: center; font-size: 11.5px; opacity: .8; }
#talentsp .tt { position: absolute; z-index: 3; width: 290px; pointer-events: none; padding: 10px 12px; border-radius: 10px;
  background: rgba(8,12,24,.97); border: 1px solid color-mix(in srgb, var(--bc) 60%, transparent); box-shadow: 0 10px 30px rgba(0,0,0,.5); font-size: 12.5px; line-height: 1.4; }
#talentsp .tt h3 { margin: 0; font-size: 17px; color: var(--bc); }
#talentsp .tt .meta { opacity: .65; font-size: 11.5px; margin: 1px 0 6px; }
#talentsp .tt .cur { margin: 4px 0; }
#talentsp .tt .nx { margin: 6px 0 0; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.08); opacity: .85; }
#talentsp .tt .nx b, #talentsp .tt .cur b { font-size: 11px; opacity: .7; display: block; font-weight: 600; }
#talentsp .tt .why { color: #fca5a5; margin-top: 6px; }
#talentsp .tt .how { color: var(--ember); margin-top: 6px; font-size: 11.5px; }
#talentsp .tt .kd { color: #f5e7c0; }

/* ---- progression ---- */
#talentsp .track { position: relative; display: grid; grid-template-columns: repeat(${MAX_LEVEL}, 1fr); margin: 4px 4px 0; }
#talentsp .rail { position: absolute; left: 2.5%; right: 2.5%; top: 150px; height: 3px; background: rgba(255,255,255,.08); border-radius: 2px; }
#talentsp .rail > i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--cc) 50%, transparent), var(--cc)); border-radius: 2px; box-shadow: 0 0 10px var(--cc); }
#talentsp .lv { display: flex; flex-direction: column; align-items: center; cursor: pointer; position: relative; }
#talentsp .marks { height: 132px; display: flex; flex-direction: column-reverse; align-items: center; gap: 4px; padding-bottom: 6px; }
#talentsp .mk { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; border: 1.5px solid; background: #111a2d; }
#talentsp .mk.sk { border-color: var(--cc); color: var(--cc); }
#talentsp .mk.ms { border-color: var(--ember); color: var(--ember); border-radius: 6px; }
#talentsp .mk.ti { border-color: #a78bfa; color: #c4b5fd; border-radius: 4px; transform: rotate(45deg); }
#talentsp .mk.ti > span { transform: rotate(-45deg); }
#talentsp .dot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 600 12px ${SERIF}; background: #111a2d; border: 2px solid #2b3550; position: relative; z-index: 1; }
#talentsp .lv.past .dot { border-color: color-mix(in srgb, var(--cc) 70%, transparent); background: color-mix(in srgb, var(--cc) 22%, #111a2d); }
#talentsp .lv.cur .dot { border-color: #fff; background: var(--cc); color: #0d1424; box-shadow: 0 0 16px var(--cc); transform: scale(1.18); }
#talentsp .lv.sel .dot { outline: 2px solid var(--ember); outline-offset: 3px; }
#talentsp .pt { margin-top: 8px; width: 9px; height: 9px; transform: rotate(45deg); border: 1.5px solid var(--ember); }
#talentsp .lv.past .pt, #talentsp .lv.cur .pt { background: var(--ember); }
#talentsp .lv:hover .dot { border-color: var(--ember); }
#talentsp .pgrid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; margin-top: 18px; }
#talentsp .card { background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 12px 14px; }
#talentsp .card h3 { margin: 0 0 8px; font-size: 18px; }
#talentsp .kv { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
#talentsp .kv div { background: rgba(0,0,0,.25); border-radius: 8px; padding: 6px 8px; }
#talentsp .kv b { display: block; font: 600 19px ${SERIF}; }
#talentsp .kv span { font-size: 11px; opacity: .65; }
#talentsp .un { list-style: none; padding: 0; margin: 0; }
#talentsp .un li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; font-size: 12.5px; line-height: 1.35; }
#talentsp .un li .mk { flex: none; width: 20px; height: 20px; font-size: 10.5px; }
#talentsp .un li em { font-style: normal; opacity: .6; margin-left: auto; white-space: nowrap; padding-left: 8px; }
#talentsp svg.growth { width: 100%; height: 190px; display: block; }
#talentsp svg.growth text { font: 500 10.5px system-ui, sans-serif; fill: var(--ink); opacity: .6; }

/* ---- abilities ---- */
#talentsp .ab { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 16px; padding: 12px 14px; margin-bottom: 10px; border-radius: 12px; background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.06); }
#talentsp .ab.locked { opacity: .55; }
#talentsp .ab .key { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--line); font-size: 11px; font-weight: 700; margin-right: 6px; vertical-align: 2px; }
#talentsp .ab h3 { display: inline; margin: 0; font-size: 18px; }
#talentsp .ab .base { opacity: .55; font-size: 12px; margin-left: 6px; }
#talentsp .ab .d { font-size: 12px; opacity: .78; line-height: 1.4; margin: 6px 0; }
#talentsp .ab .cdl { font-size: 12px; }
#talentsp .ab .cdl s { opacity: .5; }
#talentsp .path { display: flex; align-items: flex-start; margin: 2px 0 8px; }
#talentsp .step { flex: 1; position: relative; text-align: center; font-size: 11px; line-height: 1.25; opacity: .55; padding: 0 3px; }
#talentsp .step::before { content: ''; position: absolute; top: 8px; left: -50%; right: 50%; height: 2px; background: #2b3550; }
#talentsp .step:first-child::before { display: none; }
#talentsp .step i { display: block; width: 16px; height: 16px; margin: 0 auto 4px; border-radius: 50%; border: 2px solid #2b3550; background: #111a2d; position: relative; }
#talentsp .step.done { opacity: 1; }
#talentsp .step.done i { border-color: var(--cc); background: var(--cc); box-shadow: 0 0 8px var(--cc); }
#talentsp .step.done::before { background: var(--cc); }
#talentsp .step.evostep i { border-radius: 3px; transform: rotate(45deg) scale(.9); }
#talentsp .step.now { opacity: 1; }
#talentsp .step.now i { border-color: var(--ember); }
#talentsp .mbar { height: 5px; border-radius: 3px; background: rgba(0,0,0,.4); overflow: hidden; margin: 0 0 3px; }
#talentsp .mbar > i { display: block; height: 100%; background: linear-gradient(90deg, #8b5cf6, #c4b5fd); }
#talentsp .mprog { display: flex; justify-content: space-between; font-size: 11px; opacity: .65; margin-bottom: 8px; }
#talentsp .evos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#talentsp .evo { text-align: left; border: 1px solid #2b3550; border-radius: 9px; padding: 7px 9px; background: rgba(10,16,34,.6); color: var(--ink); font: inherit; font-size: 12px; cursor: default; }
#talentsp .evo b { font: 600 14px ${SERIF}; display: block; }
#talentsp .evo small { display: block; opacity: .75; line-height: 1.3; margin-top: 2px; }
#talentsp .evo .st { display: block; margin-top: 4px; font-size: 11px; font-weight: 700; color: #c4b5fd; }
#talentsp .evo.on { border-color: var(--ember); background: rgba(233,185,73,.1); }
#talentsp .evo.on .st { color: var(--ember); }
#talentsp .evo.can { cursor: pointer; }
#talentsp .evo.can:hover { border-color: #c4b5fd; background: rgba(139,92,246,.16); }
#talentsp .evo.dim { opacity: .5; }
#talentsp .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
#talentsp .chip2 { border: 1px solid color-mix(in srgb, var(--bc) 55%, transparent); color: var(--ink); background: color-mix(in srgb, var(--bc) 8%, transparent); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
#talentsp .chip2.off { opacity: .5; border-style: dashed; }
#talentsp .chip2 b { color: var(--bc); font-weight: 700; }
#talentsp .sub { font: 600 13px ${SERIF}; margin: 8px 0 2px; opacity: .85; }

#skills-btn { overflow: visible; }
#skills-btn .tpip { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #e9b949; color: #1a1406; font: 800 11px/18px system-ui, sans-serif; text-align: center; box-shadow: 0 0 10px rgba(233,185,73,.7); animation: tn-pip 1.6s ease-in-out infinite; }
@keyframes tn-pip { 50% { box-shadow: 0 0 2px rgba(233,185,73,.3); } }
.num.talent { color: #e9b949; font-size: 15px; font-weight: 800; text-shadow: 0 0 8px #b45309, 0 1px 2px #000; }
@media (prefers-reduced-motion: reduce) { #talentsp .tn.avail .halo, #skills-btn .tpip { animation: none; } #talentsp .tn.pop .halo { animation: none; } }
@media (max-width: 760px) {
  #talentsp .tgrid, #talentsp .pgrid, #talentsp .ab { grid-template-columns: 1fr; }
  #talentsp .side { border-left: 0; padding-left: 0; }
  #talentsp .tabs { margin-left: 0; } #talentsp .who small, #talentsp .xpb { display: none; }
}
`;

export function initTalents(ctx) {
  const { state, players, fx, sfx, send, floatNum, mastery, guide, isTouch, $ } = ctx;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const panel = document.createElement('div'); panel.id = 'talentsp'; panel.className = 'hidden'; panel.dataset.nav = 'skilltree'; // (controller focus navigation)
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Skill Tree');
  $('bag').parentNode.append(panel);

  const S = { r: {}, pts: 0, m: null, tab: 'talents', sel: null, hover: null, flash: null, flashT: 0, confirmT: 0, near: false, key: '' };
  const cls = () => state.cls;
  const tree = () => TREES[cls()];
  const free = () => Math.max(0, S.pts - spentOf(S.r));
  const totals = () => talentTotals(cls(), S.r);
  const isOpen = () => !panel.classList.contains('hidden');

  // ---------- client-side effects ----------
  const speedMult = () => 1 + (totals().stat.speed || 0) / 100; // the server allows the extra speed
  { // skill cooldowns shown on the bar (the server is authoritative and corrects the timers)
    const base = mastery.cd;
    mastery.cd = slot => {
      const s = CLASSES[cls()]?.skills[slot], m = s && totals().sk[slot === 0 ? 'basic' : s.id];
      return base(slot) * (m?.cd ? Math.max(0.4, 1 + m.cd / 100) : 1);
    };
  }

  // ---------- messages ----------
  function onMessage(msg) {
    if (msg.type === 'mastery') { S.m = msg.m; if (isOpen() && S.tab === 'abilities') render(); return false; } // mastery.js handles it too
    if (msg.type !== 'talents') return false;
    S.r = msg.r || {}; S.pts = msg.pts | 0;
    clearTimeout(S.waitT);
    badge();
    if (free() > 0) firstTip();
    if (isOpen()) render();
    return true;
  }
  function firstTip() {
    if (!guide || guide.seen?.has('talent')) return;
    guide.seen.add('talent');
    try { localStorage.setItem('fb_tips', JSON.stringify([...guide.seen])); } catch {}
    const el = guide.tipEl; if (!el) return;
    el.textContent = `You earned a talent point! ${tapping() ? 'Tap Skills' : `Press ${keyName('skillTree')}`} to open your Skill Tree.`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(firstTip.t); firstTip.t = setTimeout(() => el.classList.remove('show'), 7000);
  }
  function badge() {
    const b = $('skills-btn'); if (!b) return;
    let pip = b.querySelector('.tpip');
    const n = free();
    if (!n) { pip?.remove(); return; }
    if (!pip) { pip = document.createElement('span'); pip.className = 'tpip'; b.appendChild(pip); }
    pip.textContent = n; pip.title = `${n} talent point${n > 1 ? 's' : ''} to spend`;
  }

  // ---------- events ----------
  function event(e) {
    const me = state.myId;
    if (e.t === 'tpoint') {
      if (e.to !== me) return true;
      const p = players.get(me);
      if (p) floatNum(p.model.group.position, 3.3, `+${e.got} Talent Point${e.got > 1 ? 's' : ''}`, 'talent');
      return true;
    }
    if (e.t === 'talent') {
      if (e.to !== me) return true;
      if (e.op === 'spend') { S.flash = e.n; S.flashT = performance.now(); sfx.play(e.k ? 'evolve' : 'mastery'); }
      else sfx.play('ui');
      const p = players.get(me);
      if (p && e.k) fx.beam(p.model.group.position.x, p.model.group.position.z, 0xe9b949, 1.4);
      return true;
    }
    if (e.t === 'tproc') {
      const p = players.get(e.id), mine = e.id === me || e.by === me;
      const pos = p?.model.group.position;
      const say = { flow: 'Flow', relay: 'Relay Strike', spirit: 'Saved', unbreak: 'Unbreakable', exec: 'Rush ready', rally: 'Rally',
        minefield: 'Boom', packlead: 'Pack Leader', massacre: 'Massacre', sanguine: 'Sanguine', warcry: 'Warcry', fade: 'Charge ready',
        phalanx: 'Phalanx', symphony: 'Symphony', rampart: 'Rampart', undertow: 'Undertow', stormcall: 'Stormcall' }[e.k]; // (rampart, undertow, stormcall: set bonuses, shared/loot.js)
      const notes = q => fx.sparks(q.x, 2.2, q.z, 3, 0xfbbf24, 0.12, 2);
      const RING = { relay: 0xfbbf24, rally: 0x34d399, packlead: 0xfbbf24, warcry: 0xf59e0b, phalanx: 0xfbbf24, rampart: 0xf59e0b, undertow: 0x22d3ee }; // co-op keystones: their reach
      if (RING[e.k]) { fx.ring(e.x, e.z, e.r, RING[e.k], 0.6); fx.ring(e.x, e.z, e.r * 0.5, 0xfef3c7, 0.4); }
      else if (e.k === 'minefield') { fx.ring(e.x, e.z, e.r, 0xa3e635, 0.45); fx.sparks(e.x, 0.4, e.z, 16, 0xd9f99d, 0.25, 7); sfx.play('boom', { x: e.x, z: e.z }, mine ? 0.6 : 0.3); }
      else if (e.k === 'maestro') { if (pos) notes(pos); return true; } // frequent: a small flourish only
      else if (e.k === 'spirit') fx.beam(e.x, e.z, 0xc4b5fd, 1.6);
      else if (pos) fx.ring(pos.x, pos.z, 2, e.k === 'flow' ? 0x22d3ee : 0x60a5fa, 0.45);
      if (pos && (mine || e.k === 'spirit')) floatNum(pos, 3.1, say, 'talent'); // your procs only for you (`to`); Guardian Spirit's save for all
      if (mine) sfx.play(e.k === 'spirit' ? 'evolve' : 'chime');
      return true;
    }
    return false;
  }

  // ---------- open / close ----------
  function toggle(open = !isOpen(), tab) {
    if (tab) S.tab = tab;
    else if (open && S.m && CLASSES[cls()]?.skills.slice(1).some(s => S.m[s.id] && !S.m[s.id].br && masteryLevel(S.m[s.id].pts) >= MASTERY.evolveAt && state.lvl >= s.lvl)) S.tab = 'abilities'; // an evolution waits
    panel.classList.toggle('hidden', !open);
    document.body.classList.toggle('tree-open', open);
    if (open) { S.sel = null; render(); sfx.play('ui'); }
    else hideTip();
  }
  addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { toggle(false); } });

  // ---------- render ----------
  function render() {
    if (!isOpen() || !state.cls) return;
    S.hover = null; // the tooltip is rebuilt; the next mouse move shows it again
    const c = CLASSES[cls()], col = hex(c.color);
    panel.style.setProperty('--cc', col);
    S.near = !!mastery.near();
    const n = free(), xpPct = state.lvl >= MAX_LEVEL ? 100 : Math.min(100, (100 * (state.xp || 0)) / (state.next || 1));
    panel.innerHTML = `<div class="hd">
        <div class="emb" aria-hidden="true">${esc(c.name[0])}</div>
        <div class="who"><h3>Skill Tree</h3><small>Level ${state.lvl} ${esc(c.name)}, ${esc(c.role.toLowerCase())}</small><div class="xpb" title="${state.lvl >= MAX_LEVEL ? 'Max level' : `${state.xp} / ${state.next} XP`}"><i style="width:${xpPct}%"></i></div></div>
        <nav class="tabs" role="tablist">${[['progression', 'Progression'], ['talents', 'Talents'], ['abilities', 'Abilities']].map(([k, t]) => `<button role="tab" aria-selected="${S.tab === k}" class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</nav>
        <span class="pts ${n ? 'has' : ''}">${n ? `${n} talent point${n > 1 ? 's' : ''} to spend` : `${spentOf(S.r)} / ${S.pts} points spent`}</span>
        <button class="x" data-a="close" title="Close (Esc)">✕</button>
      </div><div class="body"><div class="pane">${S.tab === 'progression' ? progression() : S.tab === 'abilities' ? abilities() : talents()}</div><div class="tt" hidden></div></div>`;
  }

  // ----- Talents pane -----
  const W = 960, GUT = 56, COLW = (W - GUT) / 3, DX = 80, Y0 = 46, DY = 110;
  const pos = (bi, nd) => [GUT + COLW * bi + COLW / 2 + nd.x * DX, Y0 + nd.tier * DY];
  function nodeState(nd) {
    const r = S.r[nd.id] | 0;
    if (r >= nd.max) return 'max';
    const why = spendBlock(cls(), S.r, state.lvl, nd.id);
    if (!why) return r ? 'part avail' : 'avail';
    if (r) return 'part';
    const gated = spentAbove(S.r, cls(), nd.tier) < TALENTS.tiers[nd.tier] || (nd.req?.length && !nd.req.some(q => S.r[q] > 0));
    return gated ? 'locked' : 'open';
  }
  function talents() {
    const t = tree(); if (!t) return '<p class="note">No talent tree for this class yet.</p>';
    const H = Y0 + 4 * DY + 48;
    let svg = `<svg class="tree" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet" role="group" aria-label="Talent tree">
      <defs><filter id="tglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>`;
    for (let k = 0; k < TALENTS.tiers.length; k++) { // tier rows and their gates
      const y = Y0 + k * DY, need = TALENTS.tiers[k], have = spentAbove(S.r, cls(), k), open = have >= need;
      if (k) svg += `<line class="gate" x1="${GUT - 6}" x2="${W - 8}" y1="${y - DY / 2}" y2="${y - DY / 2}"/>`;
      svg += `<text class="tier ${open ? '' : 'lock'}" x="6" y="${y - 2}">Tier ${k + 1}</text><text class="tsub" x="6" y="${y + 13}">${k === 0 ? 'open' : open ? 'open' : `${have}/${need} above`}</text>`;
    }
    t.branches.forEach((b, bi) => { // edges first, nodes on top
      for (const nd of b.nodes) for (const q of nd.req || []) {
        const pq = b.nodes.find(x => x.id === q); if (!pq) continue;
        const [x1, y1] = pos(bi, pq), [x2, y2] = pos(bi, nd), on = S.r[q] > 0, lit = on && S.r[nd.id] > 0;
        const d = `M${x1},${y1 + 28} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2 - (nd.keystone ? 34 : 28)}`;
        svg += on ? `<path class="edge" d="${d}" stroke="${b.color}" stroke-opacity="${lit ? 0.95 : 0.4}"${lit ? ` style="filter:drop-shadow(0 0 4px ${b.color})"` : ''}/>` : `<path class="edge off" d="${d}"/>`;
      }
    });
    const now = performance.now();
    t.branches.forEach((b, bi) => {
      for (const nd of b.nodes) {
        const [x, y] = pos(bi, nd), r = S.r[nd.id] | 0, st = nodeState(nd);
        const pop = S.flash === nd.id && now - S.flashT < 900 ? ' pop' : '', hl = S.sel === nd.id ? ' hl' : '';
        const R = nd.keystone ? 30 : 24, frac = r / nd.max, circ = 2 * Math.PI * (R + 5);
        const shape = nd.keystone
          ? `<rect class="core" x="${-R * 0.78}" y="${-R * 0.78}" width="${R * 1.56}" height="${R * 1.56}" rx="5" transform="rotate(45)" stroke="${b.color}"/><rect x="${-R * 0.98}" y="${-R * 0.98}" width="${R * 1.96}" height="${R * 1.96}" rx="7" transform="rotate(45)" fill="none" stroke="${b.color}" stroke-opacity=".35"/>`
          : `<circle class="core" r="${R}" stroke="${b.color}"/>${r ? `<circle class="arc" r="${R + 5}" stroke="${b.color}" stroke-dasharray="${circ * frac} ${circ}" transform="rotate(-90)"/>` : ''}`;
        svg += `<g class="tn ${st}${pop}${hl}" data-id="${nd.id}" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="${esc(nd.name)}, rank ${r} of ${nd.max}">
          <circle class="halo" r="${R + 8}" fill="${b.color}" filter="url(#tglow)"/>${shape}
          <text class="glyph" y="1"${nd.keystone ? ' style="font-size:22px"' : ''}>${esc(nd.icon || '•')}</text>
          <text class="rk" y="${R + 17}">${r}/${nd.max}</text></g>`;
      }
    });
    svg += '</svg>';
    const heads = `<div class="bheads"><div></div>${t.branches.map(b => `<div class="bh" style="--bc:${b.color}"><h3>${esc(b.name)}<span>${branchSpent(S.r, cls(), b.id)} pts</span></h3><p>${esc(b.theme)}</p></div>`).join('')}</div>`;
    return `<div class="tgrid"><div class="treewrap">${heads}${svg}</div>${side()}</div>`;
  }
  function side() {
    const n = free(), T = totals(), spent = spentOf(S.r);
    const next = state.lvl < MAX_LEVEL ? `The next point comes at level ${state.lvl + 1}.` : 'All 19 points earned.';
    const lines = [];
    for (const [k, v] of Object.entries(T.stat)) if (v && STAT_TEXT[k]) lines.push(`<li>${esc(STAT_TEXT[k](v))}</li>`);
    for (const [sk, m] of Object.entries(T.sk)) for (const kk of ['dmg', 'fin', 'cd', 'radius', 'dur']) if (m[kk]) lines.push(`<li>${esc(effectText(cls(), { sk, [kk]: m[kk] }))}</li>`);
    for (const [a, v] of Object.entries(T.aura)) lines.push(`<li>${esc(effectText(cls(), { aura: a, v }))}</li>`);
    for (const nd of nodesOf(cls())) if (S.r[nd.id] && nd.fx.some(e => e.key)) lines.push(`<li class="k"><b>${esc(nd.name)}</b>: ${esc(nd.desc)}</li>`);
    const confirm = performance.now() - S.confirmT < 4000;
    return `<aside class="side">
      <div class="big ${n ? '' : 'zero'}">${n}</div><div class="note">point${n === 1 ? '' : 's'} to spend. ${spent} of ${S.pts} spent. ${next}</div>
      <button class="btn ${confirm ? 'warn' : ''}" data-a="respec" ${S.near && spent ? '' : 'disabled'}>${confirm ? 'Click again to refund every point' : 'Respec: refund all points'}</button>
      <div class="note ${S.near ? 'shrine-on' : ''}" style="margin-top:6px">${S.near ? 'You are at a Skill Shrine: respec and right-click refunds are free here.' : 'Learning works anywhere. Refunds are free at a Skill Shrine in town (by the Hall of Clearers, or in Mirelight Camp).'}</div>
      <h4>Your bonuses</h4>${lines.length ? `<ul class="bon">${lines.join('')}</ul>` : '<div class="note">Nothing learned yet. Click a glowing node in tier 1 to start.</div>'}
      <h4>Reading the tree</h4>
      <div class="legend">${legendDot('#9fb4d8', 'glow')}Can learn now${legendDot('#9fb4d8', 'arc')}Learned, more ranks to go${legendDot('#e9b949', 'max')}Max rank${legendDot('#2b3550', '')}Locked by its tier or a line above</div>
      <p class="note" style="margin-top:8px">Each tier opens after ${TALENTS.tiers.slice(1).join(', ')} points in the tiers above. A line means the node needs a point in a node it hangs from. The diamond at the bottom of each branch is its keystone.</p>
    </aside>`;
  }

  function legendDot(c, k) {
    return `<svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">${k === 'glow' ? `<circle r="10" fill="${c}" opacity=".45" filter="url(#tglow2)"/>` : ''}<circle r="7" fill="#111a2d" stroke="${c}" stroke-width="2"/>${k === 'arc' ? `<circle r="9.5" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="20 60" transform="rotate(-90)"/>` : ''}${k === 'max' ? `<circle r="9.5" fill="none" stroke="${c}" stroke-width="2"/>` : ''}<defs><filter id="tglow2"><feGaussianBlur stdDeviation="2"/></filter></defs></svg>`;
  }

  // ----- tooltip -----
  const tip = () => panel.querySelector('.tt');
  function hideTip() { const t = tip(); if (t) t.hidden = true; S.hover = null; }
  function showTip(id, ev) {
    const nd = nodeDef(id), t = tip(); if (!nd || !t) return;
    const b = tree().branches.find(x => x.id === nd.branch), r = S.r[id] | 0;
    const why = r >= nd.max ? null : spendBlock(cls(), S.r, state.lvl, id);
    const cur = r ? nodeLines(cls(), nd, r) : null, nxt = r < nd.max ? nodeLines(cls(), nd, r + 1) : null;
    const refund = r && S.near ? refundBlock(cls(), S.r, id) : 'x';
    t.style.setProperty('--bc', b.color);
    t.innerHTML = `<h3>${esc(nd.name)}</h3><div class="meta">${nd.keystone ? 'Keystone' : `Rank ${r} of ${nd.max}`}, ${esc(b.name)} tier ${nd.tier + 1}${nd.coop ? ', co-op' : ''}</div>
      ${cur ? `<div class="cur"><b>Now</b>${cur.map(l => `<div class="${nd.desc && l === nd.desc ? 'kd' : ''}">${esc(l)}</div>`).join('')}</div>` : ''}
      ${nxt ? `<div class="${cur ? 'nx' : 'cur'}"><b>${r ? 'Next rank' : 'Rank 1'}</b>${nxt.map(l => `<div class="${nd.desc && l === nd.desc ? 'kd' : ''}">${esc(l)}</div>`).join('')}</div>` : ''}
      ${why && r < nd.max ? `<div class="why">${esc(why)}</div>` : ''}
      ${!why && r < nd.max ? `<div class="how">${isTouch ? 'Tap' : 'Click'} to learn.</div>` : ''}
      ${r && !refund ? `<div class="how">Right-click to refund a rank.</div>` : ''}`;
    t.hidden = false; S.hover = id;
    place(ev);
  }
  function place(ev) {
    const t = tip(); if (!t || t.hidden) return;
    const box = panel.querySelector('.body').getBoundingClientRect();
    let x = ev.clientX - box.left + 18, y = ev.clientY - box.top + 14;
    if (x + 300 > box.width) x = ev.clientX - box.left - 308;
    const h = t.offsetHeight || 150;
    if (y + h > box.height) y = Math.max(4, box.height - h - 6);
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  }

  // ----- Progression pane -----
  function levelInfo(L) {
    const c = CLASSES[cls()], out = [];
    for (const [i, s] of c.skills.entries()) if (s.lvl === L) out.push({ k: 'sk', g: i === 0 ? '⚔' : String(i), t: `${s.name} unlocked${i === 0 ? ' (basic attack)' : ` (skill ${i})`}`, d: s.desc });
    for (let k = 1; k < TALENTS.tiers.length; k++) if (levelForPoint(TALENTS.tiers[k] + 1) === L) out.push({ k: 'ti', g: String(k + 1), t: `Talent tier ${k + 1} can open${k === TALENTS.tiers.length - 1 ? ': keystones' : ''}`, d: `Your ${TALENTS.tiers[k] + 1}th point can go into tier ${k + 1} once ${TALENTS.tiers[k]} points sit in the tiers above.` });
    for (const m of MILESTONES) if (m.lvl === L) out.push({ k: 'ms', g: '★', t: m.text });
    return out;
  }
  function progression() {
    const L = state.lvl, frac = L >= MAX_LEVEL ? 0 : Math.min(1, (state.xp || 0) / (state.next || 1));
    const railPct = Math.min(100, ((L - 1 + frac) / (MAX_LEVEL - 1)) * 100);
    let cols = '';
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const info = levelInfo(l), cl = l < L ? 'past' : l === L ? 'cur' : '';
      cols += `<div class="lv ${cl} ${S.sel === l ? 'sel' : ''}" data-lv="${l}" data-nav="lv${l}" title="Level ${l}">
        <div class="marks">${info.slice(0, 4).map(i => `<span class="mk ${i.k}" title="${esc(i.t)}"><span>${esc(i.g)}</span></span>`).join('')}</div>
        <div class="dot">${l}</div>${l >= TALENTS.firstLevel ? `<div class="pt" title="+1 talent point"></div>` : '<div style="height:17px"></div>'}</div>`;
    }
    const track = `<div class="track"><div class="rail" style="top:${132 + 13}px"><i style="width:${railPct}%"></i></div>${cols}</div>`;
    const sel = S.sel || L, st = statsFor(cls(), sel), info = levelInfo(sel);
    const tiersOpen = TALENTS.tiers.filter(n => pointsAt(sel) > n).length;
    const detail = `<div class="card"><h3>Level ${sel}${sel === L ? ', where you are' : sel < L ? ', behind you' : ''}</h3>
      <div class="kv"><div><b>${st.maxHp}</b><span>base health</span></div><div><b>${st.atk.toFixed(1)}</b><span>base attack</span></div>
      <div><b>${pointsAt(sel)}</b><span>talent points</span></div><div><b>${tiersOpen}</b><span>tiers reachable</span></div></div>
      ${info.length ? `<ul class="un">${info.map(i => `<li><span class="mk ${i.k}"><span>${esc(i.g)}</span></span><span>${esc(i.t)}${i.d ? `<br><span class="note">${esc(i.d)}</span>` : ''}</span></li>`).join('')}</ul>` : `<p class="note">${sel >= TALENTS.firstLevel ? 'One more talent point and a little more health and attack.' : 'Your journey starts here.'}</p>`}
      <p class="note" style="margin-top:8px">Gear adds to these numbers (see the bag). Skills also grow on their own: mastery rises by using them well, at any level (Abilities).</p></div>`;
    const upcoming = [];
    for (let l = L + 1; l <= MAX_LEVEL && upcoming.length < 6; l++) for (const i of levelInfo(l)) if (upcoming.length < 6) upcoming.push({ ...i, l });
    const next = `<div class="card"><h3>Coming up</h3>${upcoming.length ? `<ul class="un">${upcoming.map(i => `<li><span class="mk ${i.k}"><span>${esc(i.g)}</span></span><span>${esc(i.t)}</span><em>level ${i.l}</em></li>`).join('')}</ul>` : '<p class="note">You have reached the top of the track.</p>'}
      ${growth()}</div>`;
    return `${track}<div class="pgrid">${detail}${next}</div>`;
  }
  function growth() { // base health and attack per level, with the talent points as steps
    const Wd = 520, Hd = 170, P = 26, xs = l => P + ((l - 1) / (MAX_LEVEL - 1)) * (Wd - P * 2);
    const hp = l => statsFor(cls(), l).maxHp, atk = l => statsFor(cls(), l).atk;
    const hpMax = hp(MAX_LEVEL);
    const ys = (v, mx) => Hd - 24 - (v / mx) * (Hd - 44);
    let ph = '', bars = '';
    for (let l = 1; l <= MAX_LEVEL; l++) {
      ph += `${l === 1 ? 'M' : 'L'}${xs(l).toFixed(1)},${ys(hp(l), hpMax).toFixed(1)}`;
      const n = pointsAt(l), bh = (n / pointsAt(MAX_LEVEL)) * 34;
      bars += `<rect x="${xs(l) - 4}" y="${Hd - 24 - bh}" width="8" height="${bh}" rx="2" fill="#e9b949" opacity="${l <= state.lvl ? 0.45 : 0.15}"/>`;
    }
    const cx = xs(state.lvl), col = hex(CLASSES[cls()].color);
    return `<svg class="growth" viewBox="0 0 ${Wd} ${Hd}" aria-label="Health and attack by level">${bars}
      <path d="${ph}" fill="none" stroke="${col}" stroke-width="2.5"/>
      <line x1="${cx}" x2="${cx}" y1="22" y2="${Hd - 22}" stroke="#fff" stroke-opacity=".3"/>
      <circle cx="${cx}" cy="${ys(hp(state.lvl), hpMax)}" r="4.5" fill="${col}" stroke="#fff" stroke-width="1.5"/>
      <text x="${Math.min(cx + 8, Wd - 150)}" y="${ys(hp(state.lvl), hpMax) - 10}" style="opacity:.95">${hp(state.lvl)} health, ${atk(state.lvl).toFixed(1)} attack</text>
      <text x="${P}" y="${Hd - 6}">Lv 1</text><text x="${Wd - P - 26}" y="${Hd - 6}">Lv ${MAX_LEVEL}</text>
      <text x="${P}" y="12" style="fill:${col};opacity:1">base health ${hp(1)} to ${hpMax}</text><text x="${P + 170}" y="12" style="fill:#e9b949;opacity:.9">talent points 0 to ${pointsAt(MAX_LEVEL)}</text></svg>`;
  }

  // ----- Abilities pane -----
  function abilities() {
    const c = CLASSES[cls()], T = totals(), haste = (state.inv?.stats?.haste || 0) / 100;
    let h = `<p class="note" style="margin:0 0 10px">Every ability grows three ways: it unlocks at a level, its mastery rises as you use it well (evolving at Mastery ${MASTERY.evolveAt} into one of two branches), and talents sharpen it. ${S.near ? '<span class="shrine-on">You are at a Skill Shrine: changing an evolution is free here.</span>' : 'Your first evolution pick works anywhere; changing it needs a Skill Shrine.'}</p>`;
    c.skills.forEach((s, slot) => {
      const key = slot === 0 ? 'basic' : s.id, e = slot ? (S.m?.[s.id] || { pts: 0, br: null }) : null, locked = state.lvl < s.lvl;
      const nm = slot ? skillName(s, e) : s.name, l = slot ? masteryLevel(e.pts) : 0;
      const baseCd = slot ? masteryCd(s, e) : s.cd, m = T.sk[key];
      const cdNow = baseCd * (m?.cd ? Math.max(0.4, 1 + m.cd / 100) : 1) * (slot ? 1 - haste : 1);
      h += `<div class="ab ${locked ? 'locked' : ''}"><div>
          <span class="key">${slot === 0 ? (isTouch ? 'Atk' : 'Click') : slot}</span><h3>${esc(nm)}</h3>${nm !== s.name ? `<span class="base">${esc(s.name)}</span>` : ''}
          <p class="d">${esc(slot ? skillDesc(s, e) : s.desc)}</p>
          <div class="cdl">Cooldown ${Math.abs(cdNow - s.cd) > 0.01 ? `<s>${s.cd.toFixed(2)} s</s> ` : ''}<b>${cdNow.toFixed(2)} s</b></div>
          <div class="note">${locked ? `Unlocks at level ${s.lvl}.` : slot ? `Mastery ${l}${l >= MASTERY.max ? ', mastered' : ''}.` : 'Basic attack: no mastery, shaped by talents.'}</div></div><div>`;
      if (slot) {
        const [ml, into, span] = masteryProgress(e.pts), br = activeBranch(e);
        const steps = [[0, `Level ${s.lvl}`, 'Unlocked', state.lvl >= s.lvl], [2, 'Mastery 2', '-10% cooldown', l >= 2], [3, 'Mastery 3', br ? BRANCHES[s.id][br].name : 'Evolves', l >= 3], [4, 'Mastery 4', '+10% effect', l >= 4], [5, 'Mastery 5', 'Mastered', l >= 5]];
        h += `<div class="path">${steps.map(([n, a, b, done]) => `<div class="step ${done ? 'done' : ''} ${n === 3 ? 'evostep' : ''} ${!done && (n === ml + 1 || (n === 0 && locked)) ? 'now' : ''}"><i></i>${esc(a)}<br><span style="opacity:.75">${esc(b)}</span></div>`).join('')}</div>
          <div class="mbar"><i style="width:${span ? Math.min(100, (100 * into) / span) : 100}%"></i></div>
          <div class="mprog"><span>${span ? `${Math.floor(into)} / ${span} to Mastery ${ml + 1}` : 'Mastered'}</span><span>${Math.floor(e.pts)} mastery points</span></div>`;
        if (BRANCHES[s.id]) h += `<div class="evos">${['A', 'B'].map(k => evoCard(s, e, k, locked ? 0 : l)).join('')}</div>`;
      }
      const nodes = nodesForSkill(cls(), key);
      h += `<div class="sub">Talents that change it</div><div class="chips">${nodes.length ? nodes.map(nd => {
        const b = tree().branches.find(x => x.id === nd.branch), r = S.r[nd.id] | 0;
        return `<button class="chip2 ${r ? '' : 'off'}" style="--bc:${b.color}" data-goto="${nd.id}" title="${esc(nodeLines(cls(), nd, Math.max(1, r)).join(' / '))}"><b>${esc(nd.name)}</b> ${r}/${nd.max}</button>`;
      }).join('') : '<span class="note">None in this tree.</span>'}</div></div></div>`;
    });
    return h;
  }
  function evoCard(s, e, k, l) {
    const b = BRANCHES[s.id][k], cur = l >= MASTERY.evolveAt ? e.br : null, on = cur === k;
    let st, can = false;
    if (l < MASTERY.evolveAt) st = `Evolves at Mastery ${MASTERY.evolveAt}`;
    else if (on) st = 'Active';
    else if (!e.br) { st = 'Choose this evolution'; can = true; }
    else if (S.near) { st = 'Switch to this (free here)'; can = true; }
    else st = 'Switch at a Skill Shrine';
    return `<button class="evo ${on ? 'on' : ''} ${can ? 'can' : ''} ${l < MASTERY.evolveAt ? 'dim' : ''}" ${can ? `data-sk="${s.id}" data-br="${k}"` : 'disabled'}><b>${k}: ${esc(b.name)}${b.coop ? ' <span style="font:600 10px system-ui;color:#67e8f9">co-op</span>' : ''}</b><small>${esc(b.desc)}</small><span class="st">${st}</span></button>`;
  }

  // ---------- input ----------
  panel.addEventListener('click', ev => {
    const t = ev.target;
    const tab = t.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; S.sel = null; hideTip(); render(); sfx.play('ui'); return; }
    const a = t.closest('[data-a]')?.dataset.a;
    if (a === 'close') return toggle(false);
    if (a === 'respec') {
      if (performance.now() - S.confirmT < 4000) { S.confirmT = 0; send({ type: 'talent', op: 'reset' }); }
      else { S.confirmT = performance.now(); render(); }
      return;
    }
    const nd = t.closest('.tn'); if (nd) { spend(nd.dataset.id); return; }
    const lv = t.closest('[data-lv]'); if (lv) { S.sel = +lv.dataset.lv; render(); return; }
    const go = t.closest('[data-goto]'); if (go) { S.tab = 'talents'; S.sel = go.dataset.goto; render(); return; }
    const evo = t.closest('.evo.can'); if (evo) { send({ type: 'evolve', sk: evo.dataset.sk, br: evo.dataset.br }); sfx.play('ui'); }
  });
  function spend(id) {
    const why = spendBlock(cls(), S.r, state.lvl, id);
    if (why) { sfx.play('ui'); return flash(why); } // say why (tier gate, missing line, no points, max rank)
    if (!send({ type: 'talent', op: 'spend', id })) return flash('Not connected to the server.');
    clearTimeout(S.waitT);
    S.waitT = setTimeout(() => flash('No answer from the server. If this keeps happening, reload the page.'), 2500);
  }
  // A short message over the bottom of the window (blocked clicks, server replies).
  function flash(text) {
    let el = document.getElementById('tflash');
    if (!el) { el = document.createElement('div'); el.id = 'tflash'; document.body.appendChild(el); }
    el.textContent = text; el.classList.remove('off'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(S.flashT); S.flashT = setTimeout(() => el.classList.replace('on', 'off'), 2600);
  }
  panel.addEventListener('keydown', ev => { const nd = ev.target.closest?.('.tn'); if (nd && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); spend(nd.dataset.id); } });
  panel.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const nd = ev.target.closest('.tn'); if (!nd) return;
    if (!S.near) return;
    if (!refundBlock(cls(), S.r, nd.dataset.id)) send({ type: 'talent', op: 'refund', id: nd.dataset.id });
  });
  panel.addEventListener('mousemove', ev => {
    const nd = ev.target.closest?.('.tn');
    if (!nd) { if (S.hover) hideTip(); return; }
    if (S.hover !== nd.dataset.id) showTip(nd.dataset.id, ev); else place(ev);
  });
  panel.addEventListener('mouseleave', hideTip);
  panel.addEventListener('focusin', ev => { const nd = ev.target.closest?.('.tn'); if (nd) { const r = nd.getBoundingClientRect(); showTip(nd.dataset.id, { clientX: r.right, clientY: r.top }); } });

  // ---------- per frame ----------
  let t0 = 0;
  function frame(now) {
    if (now - t0 < 300) return;
    t0 = now;
    if (!state.joined || state.spectator) return;
    const key = `${state.lvl}|${!!mastery.near()}|${S.confirmT ? Math.floor((now - S.confirmT) / 4000) : 0}`;
    if (key !== S.key) { S.key = key; badge(); if (isOpen() && !S.hover) render(); }
  }

  return { onMessage, event, toggle, isOpen, frame, speedMult, render, free };
}
