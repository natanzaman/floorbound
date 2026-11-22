// Client side of the talent trees (data and rules: shared/talents.js, server: server/talents.js).
// The Path window (K, the Path button, F at a Skill Shrine; docs/briefs/path.md) with three tabs:
//   Path       your journey (Initiate, class, subclass, subclass II, crown), what is coming up, your build's identity
//              and your five skills.
//   Abilities  the skill bar on the left; the chosen skill on the right: what it does, its shape, its mastery track,
//              Base -> Evolved -> Awakened, and the talents that change it.
//   Talents    the class's tree drawn in its own shape (public/treeshapes.js). Clicks plan ranks (gold "+n"), right-click
//              takes a planned rank back (or refunds one at a Skill Shrine), Confirm sends the plan in one message.
// Also: the unspent-points badge on the Path button, the one-time "talent point" tip, talent proc visuals, and the
// client-side bits of talent effects (move speed, skill cooldown display).
import { CLASSES, MAX_LEVEL, statsFor } from '/shared/data.js';
import { MASTERY, BRANCHES, AWAKEN, masteryLevel, masteryProgress, activeBranch, skillName, skillDesc, masteryCd } from '/shared/mastery.js';
import {
  TALENTS, TREES, MILESTONES, pointsAt, levelForPoint, nodeDef, nodesOf, spentOf, branchSpent, spentAbove, spendBlock, refundBlock,
  talentTotals, nodeLines, effectText, nodesForSkill, STAT_TEXT, gateOf, BUILD_TAGS, TAG_TEXT, buildShape, buildTag, buildName, suggestOrder, planAlloc,
} from '/shared/talents.js';
import { SUBCLASSES, SPEC, subName } from '/shared/subclasses.js';
import { ruleText } from '/shared/effects.js';
import { WEAPONS } from '/shared/academy.js';
import { STYLES, CLASS_STYLES } from '/shared/styles.js';
import { VIEW, shapeOf, shortName, NODE_R, KEY_R } from '/treeshapes.js';
import { skillDiagram as diagram } from '/skillshapes.js';
import { keyName, tapping } from '/keyname.js'; // prompts name the player's key on the active device

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = n => `#${n.toString(16).padStart(6, '0')}`;
const SERIF = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';
const short = (s, n = 15) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

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
#talentsp h3, #talentsp h4, #talentsp .serif { font-family: ${SERIF}; font-weight: 600; letter-spacing: .01em; }
#talentsp .hd { display: flex; align-items: center; gap: 14px; padding: 12px 16px 10px; border-bottom: 1px solid rgba(255,255,255,.06); }
#talentsp .emb { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--cc) 40%, #1a2440), #0d1424 75%);
  border: 1.5px solid var(--cc); box-shadow: 0 0 18px color-mix(in srgb, var(--cc) 45%, transparent); }
#talentsp .emb svg { width: 24px; height: 24px; fill: none; stroke: var(--cc); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
#talentsp .who h3 { margin: 0; font-size: 20px; line-height: 1.1; }
#talentsp .who small { display: block; opacity: .75; font-size: 12px; margin-top: 2px; }
#talentsp .who small b { color: var(--cc); font-weight: 700; }
#talentsp .xpb { width: 170px; height: 4px; border-radius: 3px; background: rgba(255,255,255,.08); margin-top: 5px; overflow: hidden; }
#talentsp .xpb > i { display: block; height: 100%; background: var(--cc); }
#talentsp .tabs { display: flex; gap: 4px; margin-left: 22px; }
#talentsp .tabs button { background: transparent; border: 0; color: var(--ink); opacity: .6; font: 600 15px ${SERIF}; padding: 8px 12px 6px; border-bottom: 2px solid transparent; cursor: pointer; position: relative; }
#talentsp .tabs button:hover { opacity: .9; }
#talentsp .tabs button.on { opacity: 1; border-bottom-color: var(--cc); }
#talentsp .tabs button i { position: absolute; top: 2px; right: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--ember); box-shadow: 0 0 6px var(--ember); }
#talentsp .tabs button:focus-visible, #talentsp button:focus-visible { outline: 2px solid var(--cc); outline-offset: 2px; }
#talentsp .pts { margin-left: auto; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); font-weight: 700; white-space: nowrap; }
#talentsp .pts.has { border-color: var(--ember); color: var(--ember); box-shadow: 0 0 14px rgba(233,185,73,.25); }
#talentsp .x { background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
#talentsp .body { flex: 1; min-height: 0; position: relative; }
#talentsp .pane { position: absolute; inset: 0; overflow: auto; padding: 14px 16px; }
#talentsp .note { opacity: .72; font-size: 12px; line-height: 1.45; }
#talentsp .shrine-on { color: #c4b5fd; opacity: 1; }
#talentsp .card { background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 12px 14px; min-width: 0; }
#talentsp .card h3 { margin: 0 0 8px; font-size: 17px; }
#talentsp .plbl { font: 700 10.5px system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; opacity: .6; margin-bottom: 6px; }
#talentsp .btn { width: 100%; margin-top: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid #6d5bd0; background: rgba(124,58,237,.18); color: var(--ink); font-weight: 700; cursor: pointer; }
#talentsp .btn:disabled { opacity: .4; cursor: default; border-color: var(--line); background: transparent; }
#talentsp .btn.warn { border-color: #f59e0b; background: rgba(245,158,11,.18); }
#talentsp .btn.gold { border-color: var(--ember); background: rgba(233,185,73,.18); color: #fde68a; }
#talentsp .btn.ghost { border-color: var(--line); background: transparent; font-weight: 600; }
#talentsp .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#talentsp .row2 .btn { margin-top: 0; }

/* ---- Path tab ---- */
#talentsp .journey { position: relative; margin: 6px 10px 18px; height: 128px; }
#talentsp .journey .rail { position: absolute; left: 0; right: 0; top: 26px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.08); }
#talentsp .journey .rail > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: linear-gradient(90deg, color-mix(in srgb, var(--cc) 40%, transparent), var(--cc)); box-shadow: 0 0 10px var(--cc); }
#talentsp .journey .you { position: absolute; top: 12px; width: 2px; height: 30px; background: #fff; transform: translateX(-1px); border-radius: 1px; }
#talentsp .journey .you span { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); font: 700 10px system-ui; white-space: nowrap; color: #fff; }
#talentsp .st { position: absolute; top: 14px; width: 168px; transform: translateX(-50%); text-align: center; }
#talentsp .st.first { transform: none; text-align: left; } #talentsp .st.last { transform: translateX(-100%); text-align: right; }
#talentsp .st .gem { width: 26px; height: 26px; margin: 0 auto; transform: rotate(45deg); border: 2px solid #33405c; background: #111a2d; border-radius: 5px; display: grid; place-items: center; }
#talentsp .st.first .gem { margin: 0; } #talentsp .st.last .gem { margin: 0 0 0 auto; }
#talentsp .st .gem b { transform: rotate(-45deg); font: 700 10px system-ui; opacity: .8; }
#talentsp .st.done .gem { border-color: var(--cc); background: color-mix(in srgb, var(--cc) 30%, #111a2d); box-shadow: 0 0 12px color-mix(in srgb, var(--cc) 60%, transparent); }
#talentsp .st.next .gem { border-color: var(--ember); }
#talentsp .st h4 { margin: 8px 0 1px; font-size: 15px; }
#talentsp .st.done h4 { color: var(--cc); } #talentsp .st.next h4 { color: var(--ember); }
#talentsp .st p { margin: 0; font-size: 11.5px; line-height: 1.35; opacity: .72; }
#talentsp .pgrid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 14px; }
#talentsp .up { list-style: none; padding: 0; margin: 0; }
#talentsp .up li { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; border-top: 1px solid rgba(255,255,255,.05); font-size: 12.5px; line-height: 1.35; }
#talentsp .up li:first-child { border-top: 0; }
#talentsp .up li > i { flex: none; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; font-style: normal; font-size: 12px; border: 1.5px solid var(--line); }
#talentsp .up li > i.k { border-color: var(--ember); color: var(--ember); transform: rotate(45deg); border-radius: 4px; } #talentsp .up li > i.k > span { transform: rotate(-45deg); }
#talentsp .up li > i.e { border-color: #a78bfa; color: #c4b5fd; } #talentsp .up li > i.l { border-color: var(--cc); color: var(--cc); } #talentsp .up li > i.b { border-color: #f87171; color: #fca5a5; }
#talentsp .up li span small { display: block; opacity: .65; font-size: 11.5px; }
#talentsp .up li em { margin-left: auto; font-style: normal; opacity: .6; white-space: nowrap; padding-left: 8px; }
#talentsp .up li.go { cursor: pointer; } #talentsp .up li.go:hover { background: rgba(255,255,255,.03); }
#talentsp .build { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 12px; align-items: center; }
#talentsp .build svg { width: 170px; height: 150px; }
#talentsp .build svg text { font: 600 10px system-ui, sans-serif; fill: var(--ink); opacity: .7; }
#talentsp .bname { font: 600 22px ${SERIF}; color: var(--cc); line-height: 1.1; }
#talentsp .skl { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
#talentsp .skc { border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 8px 10px; background: rgba(0,0,0,.18); cursor: pointer; text-align: left; color: var(--ink); font: inherit; min-width: 0; }
#talentsp .skc:hover { border-color: color-mix(in srgb, var(--cc) 60%, transparent); }
#talentsp .skc .k { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 6px; border: 1px solid var(--line); font: 700 10.5px system-ui; margin-right: 6px; }
#talentsp .skc b { font: 600 14px ${SERIF}; }
#talentsp .skc small { display: block; font-size: 11px; opacity: .7; margin-top: 4px; }
#talentsp .skc .pips { display: flex; gap: 3px; margin-top: 6px; }
#talentsp .skc .pips i { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.08); }
#talentsp .skc .pips i.on { background: #a78bfa; } #talentsp .skc .pips i.pe { background: var(--ember); }
#talentsp .skc.locked { opacity: .5; }
#talentsp .stage { display: inline-block; padding: 1px 7px; border-radius: 999px; font: 700 10px system-ui; letter-spacing: .04em; border: 1px solid var(--line); }
#talentsp .stage.Evolved { border-color: #a78bfa; color: #c4b5fd; } #talentsp .stage.Awakened { border-color: var(--ember); color: var(--ember); }

/* ---- Talents tab ---- */
#talentsp .tgrid { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 14px; height: 100%; }
#talentsp .treewrap { display: flex; flex-direction: column; min-height: 0; }
#talentsp .bheads { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
#talentsp .bh { display: flex; align-items: baseline; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--bc) 45%, transparent); background: color-mix(in srgb, var(--bc) 8%, transparent); }
#talentsp .bh b { font: 600 14px ${SERIF}; color: var(--bc); }
#talentsp .bh span { font-size: 11.5px; opacity: .72; }
#talentsp .bh.mine { border-color: var(--ember); box-shadow: 0 0 10px rgba(233,185,73,.25); }
#talentsp .bh.mine em { font-style: normal; font-size: 10.5px; font-weight: 700; color: var(--ember); }
#talentsp .shapename { margin-left: auto; font: italic 600 13px ${SERIF}; opacity: .7; }
#talentsp svg.tree { flex: 1; min-height: 0; width: 100%; display: block; margin-top: 4px; }
#talentsp svg.tree .bd { fill: color-mix(in srgb, var(--cc) 7%, #0f1626); stroke: color-mix(in srgb, var(--cc) 28%, #1e2840); stroke-width: 2; }
#talentsp svg.tree .bd2 { stroke: color-mix(in srgb, var(--cc) 18%, #1a2338); fill: none; }
#talentsp svg.tree .bdc { fill: color-mix(in srgb, var(--cc) 45%, transparent); }
#talentsp .tn { cursor: pointer; }
#talentsp .tn .core { fill: #111a2d; stroke-width: 2; }
#talentsp .tn .halo { opacity: 0; }
#talentsp .tn .glyph { font-size: 15px; text-anchor: middle; dominant-baseline: central; fill: var(--ink); pointer-events: none; }
#talentsp .tn .nm { font: 600 10px system-ui, sans-serif; text-anchor: middle; fill: var(--ink); opacity: .85; pointer-events: none; paint-order: stroke; stroke: #0d1322; stroke-width: 3px; }
#talentsp .tn .rk { font: 700 9px system-ui, sans-serif; text-anchor: middle; fill: var(--ink); opacity: .7; pointer-events: none; paint-order: stroke; stroke: #0d1322; stroke-width: 3px; }
#talentsp .tn .arc { fill: none; stroke-width: 3; stroke-linecap: round; }
#talentsp .tn .plan { fill: var(--ember); } #talentsp .tn .plant { font: 800 10px system-ui; fill: #1a1406; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
#talentsp .tn .sug { fill: none; stroke: #fde68a; stroke-width: 1.6; stroke-dasharray: 3 4; opacity: .85; }
#talentsp .tn .sugn { font: 800 9px system-ui; fill: #fde68a; text-anchor: middle; pointer-events: none; }
#talentsp .tn.locked .core { stroke: #2b3550 !important; }
#talentsp .tn.locked .glyph { opacity: .3; } #talentsp .tn.locked .nm { opacity: .4; } #talentsp .tn.locked .rk { opacity: .3; }
#talentsp .tn.open .glyph { opacity: .75; }
#talentsp .tn.avail .halo { opacity: .5; animation: tn-pulse 2.2s ease-in-out infinite; }
#talentsp .tn.part .halo { opacity: .3; }
#talentsp .tn.max .halo { opacity: .65; }
#talentsp .tn.max .core { stroke: var(--ember) !important; }
#talentsp .tn.max .rk { fill: var(--ember); opacity: 1; }
#talentsp .tn.planned .core { stroke: var(--ember) !important; stroke-dasharray: 5 3; }
#talentsp .tn.subn .core { fill: #1b1708; }
#talentsp .tn:hover .core { stroke-width: 3; }
#talentsp .tn.hl .core { stroke: #fff !important; stroke-width: 3; }
#talentsp .tn.pop .halo { animation: tn-pop .7s ease-out 1; opacity: .9; }
#talentsp .edge { fill: none; stroke-width: 2.2; stroke-linecap: round; }
#talentsp .edge.off { stroke: #2a344c; stroke-dasharray: 3 5; }
#talentsp .edge.pl { stroke: var(--ember); stroke-dasharray: 6 4; stroke-opacity: .8; }
@keyframes tn-pulse { 50% { opacity: .15; } }
@keyframes tn-pop { 0% { transform: scale(.6); opacity: 1; } 100% { transform: scale(1.8); opacity: 0; } }
#talentsp .side { border-left: 1px solid rgba(255,255,255,.06); padding-left: 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
#talentsp .big { font: 600 40px/1 ${SERIF}; color: var(--ember); }
#talentsp .big.zero { color: var(--ink); opacity: .5; }
#talentsp .pbox { border: 1px dashed color-mix(in srgb, var(--ember) 55%, transparent); border-radius: 10px; padding: 10px; background: rgba(233,185,73,.05); }
#talentsp .pbox ol { margin: 4px 0 8px; padding-left: 18px; font-size: 12px; line-height: 1.5; }
#talentsp .ncard { border: 1px solid color-mix(in srgb, var(--bc, var(--line)) 50%, transparent); border-radius: 10px; padding: 10px 12px; background: rgba(0,0,0,.2); }
#talentsp .ncard h4 { margin: 0; font-size: 16px; color: var(--bc); }
#talentsp .ncard .one { margin: 4px 0 6px; font-size: 13px; line-height: 1.4; }
#talentsp .ncard .meta { font-size: 11px; opacity: .6; }
#talentsp .ncard .det { font-size: 12px; opacity: .8; line-height: 1.4; border-top: 1px solid rgba(255,255,255,.07); padding-top: 6px; margin-top: 6px; }
#talentsp .ncard .why { color: #fca5a5; font-size: 12px; margin-top: 6px; }
#talentsp .tiers { display: flex; gap: 4px; }
#talentsp .tiers span { flex: 1; text-align: center; font: 700 10.5px system-ui; padding: 4px 0; border-radius: 6px; border: 1px solid var(--line); opacity: .55; }
#talentsp .tiers span.on { border-color: var(--cc); opacity: 1; color: var(--cc); }
#talentsp .bon { list-style: none; padding: 0; margin: 0; }
#talentsp .bon li { padding: 3px 0 3px 10px; border-left: 2px solid var(--line); margin-bottom: 4px; font-size: 12px; line-height: 1.35; }
#talentsp .bon li.k { border-left-color: var(--ember); }
#talentsp details summary { cursor: pointer; font: 600 14px ${SERIF}; }
#talentsp .tog { display: flex; gap: 8px; align-items: center; font-size: 12.5px; cursor: pointer; }
#talentsp .tog i { width: 30px; height: 17px; border-radius: 9px; background: #2a344c; position: relative; flex: none; }
#talentsp .tog i::after { content: ''; position: absolute; left: 2px; top: 2px; width: 13px; height: 13px; border-radius: 50%; background: #9aa6bf; transition: left .15s; }
#talentsp .tog.on i { background: rgba(233,185,73,.5); } #talentsp .tog.on i::after { left: 15px; background: #fde68a; }
#talentsp .tt { position: absolute; z-index: 3; width: 270px; pointer-events: none; padding: 9px 11px; border-radius: 10px;
  background: rgba(8,12,24,.97); border: 1px solid color-mix(in srgb, var(--bc) 60%, transparent); box-shadow: 0 10px 30px rgba(0,0,0,.5); font-size: 12.5px; line-height: 1.4; }
#talentsp .tt h3 { margin: 0; font-size: 16px; color: var(--bc); }
#talentsp .tt .meta { opacity: .65; font-size: 11px; margin: 1px 0 5px; }
#talentsp .tt .why { color: #fca5a5; margin-top: 5px; }
#talentsp .tt .how { color: var(--ember); margin-top: 5px; font-size: 11.5px; }

/* ---- Abilities tab ---- */
#talentsp .agrid { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 16px; height: 100%; }
#talentsp .alist { display: flex; flex-direction: column; gap: 6px; overflow: auto; }
#talentsp .ai { display: flex; gap: 10px; align-items: center; text-align: left; padding: 9px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.06); background: rgba(255,255,255,.02); color: var(--ink); font: inherit; cursor: pointer; }
#talentsp .ai.on { border-color: var(--cc); background: color-mix(in srgb, var(--cc) 10%, transparent); }
#talentsp .ai.locked { opacity: .5; }
#talentsp .ai .k { display: inline-grid; place-items: center; min-width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--line); font: 700 11px system-ui; flex: none; }
#talentsp .ai b { font: 600 14.5px ${SERIF}; display: block; }
#talentsp .ai small { font-size: 11px; opacity: .65; }
#talentsp .adet { overflow: auto; padding-right: 4px; }
#talentsp .adet h3 { margin: 0; font-size: 24px; }
#talentsp .adet .one { font-size: 14px; margin: 4px 0 10px; line-height: 1.4; }
#talentsp .ahead { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 14px; align-items: start; }
#talentsp .diag { width: 190px; height: 130px; border-radius: 10px; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.06); }
#talentsp .diag text { font: 600 10px system-ui; fill: var(--ink); opacity: .65; }
#talentsp .facts { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; }
#talentsp .facts span { padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); }
#talentsp .facts s { opacity: .5; }
#talentsp .strip { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 6px; align-items: stretch; margin: 12px 0; }
#talentsp .strip > i { align-self: center; opacity: .4; font-style: normal; }
#talentsp .sc { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: rgba(0,0,0,.2); min-width: 0; }
#talentsp .sc .plbl { margin-bottom: 2px; }
#talentsp .sc b { font: 600 14px ${SERIF}; display: block; }
#talentsp .sc small { display: block; font-size: 11.5px; opacity: .72; line-height: 1.35; margin-top: 2px; }
#talentsp .sc.on { border-color: var(--cc); } #talentsp .sc.ev.on { border-color: #a78bfa; } #talentsp .sc.aw.on { border-color: var(--ember); box-shadow: 0 0 12px rgba(233,185,73,.2); }
#talentsp .sc.dim { opacity: .5; }
#talentsp .mtrack { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin: 6px 0 2px; }
#talentsp .mtrack div { text-align: center; font-size: 11px; line-height: 1.25; opacity: .5; }
#talentsp .mtrack div i { display: block; height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); margin-bottom: 4px; overflow: hidden; }
#talentsp .mtrack div i > u { display: block; height: 100%; background: linear-gradient(90deg, #8b5cf6, #c4b5fd); }
#talentsp .mtrack div.done { opacity: 1; } #talentsp .mtrack div.done i { background: #8b5cf6; } #talentsp .mtrack div.now { opacity: 1; }
#talentsp .mtrack div.ev.done i { background: var(--ember); }
#talentsp .evos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#talentsp .evo { text-align: left; border: 1px solid #2b3550; border-radius: 9px; padding: 7px 9px; background: rgba(10,16,34,.6); color: var(--ink); font: inherit; font-size: 12px; cursor: default; }
#talentsp .evo b { font: 600 14px ${SERIF}; display: block; }
#talentsp .evo small { display: block; opacity: .75; line-height: 1.3; margin-top: 2px; }
#talentsp .evo .st2 { display: block; margin-top: 4px; font-size: 11px; font-weight: 700; color: #c4b5fd; }
#talentsp .evo.on { border-color: var(--ember); background: rgba(233,185,73,.1); }
#talentsp .evo.on .st2 { color: var(--ember); }
#talentsp .evo.can { cursor: pointer; }
#talentsp .evo.can:hover { border-color: #c4b5fd; background: rgba(139,92,246,.16); }
#talentsp .evo.dim { opacity: .5; }
#talentsp .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#talentsp .chip2 { border: 1px solid color-mix(in srgb, var(--bc) 55%, transparent); color: var(--ink); background: color-mix(in srgb, var(--bc) 8%, transparent); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
#talentsp .chip2.off { opacity: .5; border-style: dashed; }
#talentsp .chip2 b { color: var(--bc); font-weight: 700; }
#talentsp .sub { font: 600 13px ${SERIF}; margin: 12px 0 2px; opacity: .85; }
#talentsp .wst { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; margin-top: 6px; }

#lvlup { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); z-index: 7; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 8px;
  animation: lv-in .45s ease-out; color: #e8e2d0; text-shadow: 0 2px 8px #000; }
#lvlup.out { opacity: 0; transition: opacity .6s; }
@keyframes lv-in { from { opacity: 0; transform: translate(-50%, 12px) scale(.94); } }
#lvlup .k0 { font: 700 12px system-ui, sans-serif; letter-spacing: .32em; color: #e9b949; }
#lvlup .n { font: 600 64px/1 ${SERIF}; color: #fde68a; text-shadow: 0 0 24px rgba(233,185,73,.5), 0 2px 8px #000; }
#lvlup .t { font: 600 19px ${SERIF}; color: var(--cc, #93c5fd); }
#lvlup ul { list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 6px; min-width: 340px; }
#lvlup li { padding: 7px 12px; border-radius: 10px; background: rgba(13,19,34,.88); border: 1px solid #2a3550; font: 600 13.5px system-ui, sans-serif; text-shadow: none; }
#lvlup li b { color: #e9b949; margin-right: 6px; } #lvlup li.g { border-color: #8a6d2a; }
#lvlup .hint { font: 700 13px system-ui, sans-serif; color: #fde68a; margin-top: 4px; }
#skills-btn { overflow: visible; }
#skills-btn .tpip { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #e9b949; color: #1a1406; font: 800 11px/18px system-ui, sans-serif; text-align: center; box-shadow: 0 0 10px rgba(233,185,73,.7); animation: tn-pip 1.6s ease-in-out infinite; }
@keyframes tn-pip { 50% { box-shadow: 0 0 2px rgba(233,185,73,.3); } }
.num.talent { color: #e9b949; font-size: 15px; font-weight: 800; text-shadow: 0 0 8px #b45309, 0 1px 2px #000; }
@media (prefers-reduced-motion: reduce) { #talentsp .tn.avail .halo, #skills-btn .tpip { animation: none; } #talentsp .tn.pop .halo { animation: none; } }
@media (max-width: 760px) {
  #talentsp .tgrid, #talentsp .pgrid, #talentsp .agrid, #talentsp .ahead, #talentsp .build { grid-template-columns: 1fr; }
  #talentsp .skl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #talentsp .side { border-left: 0; padding-left: 0; }
  #talentsp .tabs { margin-left: 0; } #talentsp .who small, #talentsp .xpb { display: none; }
  #talentsp .st p { display: none; }
}
`;

export function initTalents(ctx) {
  const { state, players, fx, sfx, send, floatNum, mastery, guide, isTouch, $ } = ctx;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const panel = document.createElement('div'); panel.id = 'talentsp'; panel.className = 'hidden'; panel.dataset.nav = 'skilltree'; // (controller focus navigation)
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Path');
  $('bag').parentNode.append(panel);

  let sugOn = true; try { sugOn = localStorage.getItem('fb_tsug') !== '0'; } catch {}
  const S = { r: {}, pr: {}, pc: null, pm: false, pts: 0, m: null, tab: 'path', sel: null, hover: null, flash: null, flashT: 0, confirmT: 0, near: false, key: '', plan: [], sug: sugOn, ab: 1 };
  let viewCls = null; // an Initiate's plan view: the class being planned (asPlan)
  const cls = () => viewCls || state.cls;
  const spec = () => state.academy?.spec || null;
  // Your subclass (the Academy's Specialise, docs/briefs/subclasses.md): its nodes show in its branch; another's never do.
  const sub = () => spec()?.sub || null;
  const shown = nd => !nd.sub || nd.sub === sub();
  const tree = () => TREES[cls()];
  const free = () => Math.max(0, S.pts - spentOf(S.r));
  const left = () => Math.max(0, free() - S.plan.length); // after the plan
  const eff = () => (S.plan.length && planAlloc(cls(), S.r, state.lvl, S.plan, sub()).alloc) || S.r; // the tree as planned
  const totals = () => talentTotals(cls(), S.r);
  const isOpen = () => !panel.classList.contains('hidden');
  const ini = () => !!state.academy?.ini;
  const subBranch = () => SUBCLASSES[sub()]?.branch || null;
  const title = () => (ini() ? 'Initiate' : subName(sub()) || CLASSES[cls()]?.name || '');
  // An Initiate plans the first talents of a class their weapon leads to (server/academy.js talentPlan). While planning,
  // the Talents tab draws that class's tree with the saved plan as its ranks: asPlan swaps the view in for one call.
  const leads = () => WEAPONS[state.academy?.path?.weapon]?.leads || [];
  const planMode = () => S.locked && ini() && !state.academy?.loan && leads().length > 0;
  const planCls = () => (leads().includes(S.pc) ? S.pc : leads()[0]);
  function asPlan(fn) {
    if (!planMode() || S.pm) return fn();
    const r = S.r, lk = S.locked;
    viewCls = planCls(); S.r = S.pr[viewCls] || {}; S.locked = false; S.pm = true;
    try { return fn(); } finally { viewCls = null; S.r = r; S.locked = lk; S.pm = false; }
  }

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
    if (msg.type === 'mastery') { S.m = msg.m; if (isOpen() && S.tab !== 'talents') render(); return false; } // mastery.js handles it too
    if (msg.type !== 'talents') return false;
    S.r = msg.r || {}; S.pts = msg.pts | 0; S.locked = !!msg.locked; // locked: an Initiate (the tree opens at graduation, points bank up) or a class trial
    S.pr = msg.plan || {}; // an Initiate's saved plans
    clearTimeout(S.waitT);
    if (S.sent) { S.plan = []; S.sent = false; } // the confirmed plan came back as the tree
    else S.plan = asPlan(() => keepValid(S.plan));
    badge();
    if (free() > 0 && !S.locked) firstTip();
    if (isOpen()) render();
    return true;
  }
  // The longest prefix-free subset of a plan that still works, in order (after a refund, a level, a change of class).
  function keepValid(ids) {
    const out = [];
    for (const id of ids) if (!planAlloc(cls(), S.r, state.lvl, [...out, id], sub()).error) out.push(id);
    return out;
  }
  function firstTip() {
    if (!guide || guide.seen?.has('talent')) return;
    guide.seen.add('talent');
    try { localStorage.setItem('fb_tips', JSON.stringify([...guide.seen])); } catch {}
    const el = guide.tipEl; if (!el) return;
    el.textContent = `You earned a talent point! ${tapping() ? 'Tap Path' : `Press ${keyName('skillTree')}`} to open your Path.`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(firstTip.t); firstTip.t = setTimeout(() => el.classList.remove('show'), 7000);
  }
  function badge() {
    const b = $('skills-btn'); if (!b) return;
    let pip = b.querySelector('.tpip');
    const n = S.locked ? 0 : free(); // (banked points of an Initiate: no badge)
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
    if (e.t === 'fxr') { // a rule fired (an awakening or a rule talent, server/effects.js): a small mark where it happened
      const COL = { burn: 0xf97316, slow: 0x60a5fa, stun: 0xfde047, posture: 0xe5e7eb, mark: 0xf43f5e, burst: 0xf59e0b, pull: 0xa78bfa, shield: 0xfbbf24, heal: 0x4ade80, team: 0xfbbf24, cdcut: 0x22d3ee, dr: 0x94a3b8, rage: 0xdc2626 };
      const col = COL[e.k] || 0xffffff, mine = e.id === me;
      if (e.r) fx.ring(e.x, e.z, e.r, col, 0.45); else fx.sparks(e.x, 1.2, e.z, mine ? 8 : 4, col, 0.2, 4);
      if (mine && e.k === 'cdcut') { const p = players.get(me); if (p) floatNum(p.model.group.position, 2.9, 'Cooldowns', 'talent'); }
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
  const evolvable = () => CLASSES[cls()]?.skills.findIndex((s, i) => i && S.m?.[s.id] && !S.m[s.id].br && masteryLevel(S.m[s.id].pts) >= MASTERY.evolveAt && state.lvl >= s.lvl);
  function toggle(open = !isOpen(), tab) {
    if (tab) S.tab = tab;
    else if (open) {
      const ev = evolvable();
      if (ev > 0) { S.tab = 'abilities'; S.ab = ev; } // an evolution waits
      else if (free() > 0 && !S.locked) S.tab = 'talents'; // points wait
    }
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
    const c = CLASSES[cls()], col = hex(c.color), shape = shapeOf(cls());
    panel.style.setProperty('--cc', col);
    S.near = !!mastery.near();
    const n = free(), xpPct = state.lvl >= MAX_LEVEL ? 100 : Math.min(100, (100 * (state.xp || 0)) / (state.next || 1));
    const me = state.roster?.get?.(state.myId)?.name || '';
    const ac = state.academy, wpn = WEAPONS[ac?.path?.weapon]?.name;
    const role = ini() ? `Initiate · ${esc(wpn || 'Sword')}` : sub() ? `<b>${esc(subName(sub()))}</b> · ${esc(c.name)}` : spec()?.sig ? `<b>Specialised</b> · ${esc(c.name)}` : `<b>${esc(c.name)}</b>`;
    const dots = { talents: n && !S.locked, abilities: evolvable() > 0 };
    const pv = S.tab === 'talents' && planMode() ? asPlan(() => ({ n: free(), k: S.plan.length, left: left() })) : null; // an Initiate planning: the plan's count
    const pill = pv ? (pv.k ? `${pv.k} planned · ${pv.left} left` : `${pv.n} point${pv.n === 1 ? '' : 's'} banked`) : S.locked ? `${n} point${n === 1 ? '' : 's'} banked` : S.plan.length ? `${S.plan.length} planned · ${left()} left` : n ? `${n} talent point${n > 1 ? 's' : ''} to spend` : `${spentOf(S.r)} / ${S.pts} points spent`;
    panel.innerHTML = `<div class="hd">
        <div class="emb" aria-hidden="true" title="${esc(shape.name)}"><svg viewBox="0 0 24 24"><path d="${shape.sigil}"/></svg></div>
        <div class="who"><h3>${esc(me || 'Your Path')}</h3><small>${role} · Level ${state.lvl}</small><div class="xpb" title="${state.lvl >= MAX_LEVEL ? 'Max level' : `${state.xp} / ${state.next} XP`}"><i style="width:${xpPct}%"></i></div></div>
        <nav class="tabs" role="tablist">${[['path', 'Path'], ['abilities', 'Abilities'], ['talents', 'Talents']].map(([k, t]) => `<button role="tab" aria-selected="${S.tab === k}" class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${t}${dots[k] ? '<i></i>' : ''}</button>`).join('')}</nav>
        <span class="pts ${(n && !S.locked) || S.plan.length ? 'has' : ''}">${pill}</span>
        <button class="x" data-a="close" title="Close (Esc)">✕</button>
      </div><div class="body"><div class="pane">${S.tab === 'path' ? pathTab() : S.tab === 'abilities' ? abilities() : asPlan(talents)}</div><div class="tt" hidden></div></div>`;
  }

  // ===================================================== Path tab =====================================================
  function levelInfo(L) { // what a level brings
    const c = CLASSES[cls()], out = [];
    for (const [i, s] of c.skills.entries()) if (s.lvl === L && L > 1) out.push({ k: 'l', g: String(i), t: `${s.name} unlocks`, d: s.desc });
    for (let k = 1; k < TALENTS.tiers.length; k++) if (levelForPoint(TALENTS.tiers[k] + 1) === L) out.push({ k: 'l', g: String(k + 1), t: `Talent tier ${k + 1} can open${k === TALENTS.tiers.length - 1 ? ': keystones' : ''}` });
    for (const m of MILESTONES) if (m.lvl === L) out.push({ k: /boss/i.test(m.text) ? 'b' : 'l', g: /boss/i.test(m.text) ? '☠' : '★', t: m.text });
    return out;
  }
  function stations() {
    const c = CLASSES[cls()], L = state.lvl, sp = spec(), sn = subName(sub()) || (sp?.sig ? 'Specialised' : '');
    const wpn = WEAPONS[state.academy?.path?.weapon]?.name || 'weapon';
    const graduated = !ini();
    return [
      { lvl: 1, name: 'Initiate', done: true, text: graduated ? 'Your first weapon and its basic skills.' : `Your ${wpn.toLowerCase()}: basic attacks and two skills.` },
      { lvl: 5, name: graduated ? c.name : 'Class', done: graduated, text: graduated ? `Graduated: the full ${c.name} kit and its talent tree.` : 'Pass a class trial at the Academy: a full kit and a talent tree.' },
      { lvl: SPEC.lvl, name: sn || 'Subclass', done: !!sp?.sig, text: sp?.sig ? `${sp.sig.name}, your signature skill, and two talents in your tree.` : 'Specialise at the Academy: a signature skill and two talents.' },
      { lvl: 22, name: sn ? `${sn} II` : 'Subclass II', done: !!sub() && L >= 22, text: 'Two more talents for your subclass.' },
      { lvl: MAX_LEVEL, name: 'Crown', done: !!sub() && L >= MAX_LEVEL, text: 'Your subclass\'s crowning talent.' },
    ];
  }
  function pathTab() {
    const L = state.lvl, st = stations(), x = l => ((l - 1) / (MAX_LEVEL - 1)) * 100;
    const frac = L >= MAX_LEVEL ? 0 : Math.min(1, (state.xp || 0) / (state.next || 1));
    const nextI = st.findIndex(s => !s.done);
    const journey = `<div class="plbl">Your journey</div><div class="journey"><div class="rail"><i style="width:${x(L + frac)}%"></i></div>
      ${st.map((s, i) => `<div class="st ${s.done ? 'done' : ''} ${i === nextI ? 'next' : ''} ${i === st.length - 1 ? 'last' : i === 0 ? 'first' : ''}" style="left:${x(s.lvl)}%"><div class="gem"><b>${s.lvl}</b></div><h4>${esc(s.name)}</h4><p>${esc(s.text)}</p></div>`).join('')}
      <div class="you" style="left:${x(Math.min(MAX_LEVEL, L + frac))}%"><span>Lv ${L}</span></div></div>`;
    return `${journey}<div class="pgrid"><div class="card"><h3>Coming up</h3>${comingUp()}</div><div class="card"><h3>Your build</h3>${buildCard()}</div></div>
      <div class="skl">${skillCards()}</div>`;
  }
  function comingUp() {
    const L = state.lvl, items = [], c = CLASSES[cls()];
    const n = left();
    if (!S.locked && n > 0) items.push({ k: 'k', g: n, t: `${n} talent point${n > 1 ? 's' : ''} to spend`, d: 'Plan them on the Talents tab, then confirm.', go: 'talents' });
    if (!S.locked && tree()) { // the nearest keystone
      const a = eff(), ks = nodesOf(cls()).filter(nd => nd.keystone && shown(nd) && !(a[nd.id] > 0));
      const open = ks.find(nd => !spendBlock(cls(), a, MAX_LEVEL, nd.id, sub())); // its tier and line are met (points aside)
      if (open) items.push({ k: 'k', g: '◆', t: `Keystone in reach: ${open.name}`, d: open.desc, go: open.id });
      else if (ks.length) {
        const need = TALENTS.tiers[TALENTS.tiers.length - 1] - spentAbove(a, cls(), TALENTS.tiers.length - 1);
        if (need > 0) items.push({ k: 'k', g: '◆', t: `${need} more point${need > 1 ? 's' : ''} open your keystones`, d: ks.map(k => k.name).join(' · '), go: 'talents' });
      }
    }
    if (S.m) for (const [i, s] of c.skills.entries()) { // a skill near its evolution
      if (!i || state.lvl < s.lvl) continue;
      const e = S.m[s.id]; if (!e) continue;
      const l = masteryLevel(e.pts);
      if (l >= MASTERY.evolveAt && !e.br) items.push({ k: 'e', g: '✦', t: `${s.name} can evolve now`, d: 'Pick one of two forms on the Abilities tab.', go: `ab${i}` });
      else if (l === MASTERY.evolveAt - 1 && masteryProgress(e.pts)[1] >= 0.4 * masteryProgress(e.pts)[2]) { const [, into, span] = masteryProgress(e.pts); items.push({ k: 'e', g: '✦', t: `${s.name}: ${Math.floor((100 * into) / (span || 1))}% to its evolution`, d: 'Mastery rises as you use it well.', go: `ab${i}` }); }
    }
    if (L < MAX_LEVEL) {
      const nx = levelInfo(L + 1);
      items.push({ k: 'l', g: L + 1, t: `Level ${L + 1}: +1 talent point${nx.length ? `. ${nx.map(i => i.t).join('. ')}` : ''}`, d: `${Math.max(0, (state.next || 0) - (state.xp || 0))} XP to go.` });
    }
    const boss = MILESTONES.find(m => m.lvl > L && /boss/i.test(m.text));
    if (boss) items.push({ k: 'b', g: '☠', t: boss.text, w: `level ${boss.lvl}` });
    const st = stations().find(s => !s.done);
    if (st) items.push({ k: 'l', g: '◇', t: `${st.name}: ${st.text}`, w: `level ${st.lvl}` });
    return `<ul class="up">${items.slice(0, 6).map(i => `<li class="${i.go ? 'go' : ''}" ${i.go ? `data-go="${esc(i.go)}"` : ''}><i class="${i.k}"><span>${esc(i.g)}</span></i><span>${esc(i.t)}${i.d ? `<small>${esc(i.d)}</small>` : ''}</span>${i.w ? `<em>${esc(i.w)}</em>` : ''}</li>`).join('')}</ul>`;
  }
  function radar(shape, size = 150, col = 'var(--cc)') {
    const cx = size / 2 + 10, cy = size / 2, R = size / 2 - 22, ang = i => -Math.PI / 2 + (i * 2 * Math.PI) / BUILD_TAGS.length;
    const pt = (i, f) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f];
    let g = '';
    for (const f of [0.33, 0.66, 1]) g += `<polygon points="${BUILD_TAGS.map((_, i) => pt(i, f).join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,.08)"/>`;
    const poly = BUILD_TAGS.map((t, i) => pt(i, Math.max(0.12, shape[t] || 0)).join(',')).join(' ');
    g += `<polygon points="${poly}" fill="${col}" fill-opacity=".28" stroke="${col}" stroke-width="2"/>`;
    g += BUILD_TAGS.map((t, i) => { const [x, y] = pt(i, 1.22); return `<text x="${x}" y="${y + 3}" text-anchor="middle">${TAG_TEXT[t].axis}</text>`; }).join('');
    return `<svg viewBox="0 0 ${size + 20} ${size}" aria-label="Build shape">${g}</svg>`;
  }
  function buildCard() {
    const a = eff(), tag = buildTag(cls(), a), shape = buildShape(cls(), a);
    if (S.locked) return `<p class="note">Your build takes shape when your talent tree opens at graduation. Your points are banked until then${planMode() ? ': plan them on the Talents tab' : ''}.</p>`;
    return `<div class="build">${radar(shape)}<div><div class="bname">${esc(buildName(tag, title()))}</div>
      <p class="note" style="margin:6px 0 0">${tag ? esc(TAG_TEXT[tag].line) : 'Spend 3 talent points and your build gets a name.'}</p>
      ${S.plan.length ? '<p class="note" style="color:var(--ember);opacity:1">Includes your planned points.</p>' : ''}</div></div>`;
  }
  function skillRows() { // [slot, def, mastery entry or null]; slot 4: the signature skill
    const c = CLASSES[cls()], rows = c.skills.map((s, i) => [i, s, i ? (S.m?.[s.id] || { pts: 0, br: null }) : null]);
    const sg = spec()?.sig;
    if (sg && !ini()) { // a subclass's own signature skill earns mastery and evolves (shared/subclasses.js SIG_EVOS); a borrowed one doesn't
      const own = SUBCLASSES[sub()]?.skill.id === sg.id ? SUBCLASSES[sub()].skill : null;
      rows.push([4, own ? { ...own, sig: true } : { id: sg.id, name: sg.name, desc: sg.desc, cd: sg.cd, lvl: SPEC.lvl, sig: true }, own ? S.m?.[own.id] || { pts: 0, br: null } : null]);
    }
    return rows;
  }
  const stageOf = (slot, s, e) => (!slot || !e ? 'Base' : masteryLevel(e.pts) >= MASTERY.max ? 'Awakened' : activeBranch(e) ? 'Evolved' : 'Base');
  function skillCards() {
    return skillRows().map(([slot, s, e]) => {
      const locked = state.lvl < s.lvl, l = e ? masteryLevel(e.pts) : 0, stg = stageOf(slot, s, e);
      const nm = e ? skillName(s, e) : s.name;
      return `<button class="skc ${locked ? 'locked' : ''}" data-go="ab${slot}"><span class="k">${slot === 0 ? (isTouch ? 'Atk' : '⚔') : slot === 4 ? 'G' : slot}</span><b>${esc(short(nm, 18))}</b>
        <small>${locked ? `Unlocks at level ${s.lvl}` : slot === 0 ? 'Basic attack' : e ? `Mastery ${l} <span class="stage ${stg}">${stg}</span>` : 'Signature skill'}</small>
        ${e ? `<div class="pips">${[1, 2, 3, 4, 5].map(k => `<i class="${l >= k ? (k === MASTERY.evolveAt ? 'pe' : 'on') : ''}"></i>`).join('')}</div>` : ''}</button>`;
    }).join('');
  }

  // =================================================== Talents tab ====================================================
  function nodeState(nd, a) {
    const r = a[nd.id] | 0, p = r - (S.r[nd.id] | 0);
    if (r >= nd.max) return `max${p ? ' planned' : ''}`;
    const why = spendBlock(cls(), a, state.lvl, nd.id, sub());
    if (!why || /No talent points/.test(why)) return `${r ? 'part ' : ''}${why || S.locked ? 'open' : 'avail'}${p ? ' planned' : ''}`;
    if (r) return `part${p ? ' planned' : ''}`;
    const gated = (nd.lvl && state.lvl < nd.lvl) || spentAbove(a, cls(), nd.tier) < gateOf(nd) || (nd.req?.length && !nd.req.some(q => a[q] > 0));
    return gated ? 'locked' : 'open';
  }
  // The next ranks the suggested path asks for, as { id: order (1..3) }.
  function suggested(a) {
    if (!S.sug || S.locked) return {};
    const want = {}, out = {}; let k = 0;
    for (const id of suggestOrder(cls(), sub(), subBranch())) {
      want[id] = (want[id] | 0) + 1;
      if ((a[id] | 0) < want[id] && !(id in out)) { const nd = nodeDef(id); if (!nd || !shown(nd)) continue; out[id] = ++k; if (k >= 3) break; }
    }
    return out;
  }
  function talents() {
    const t = tree(); if (!t) return '<p class="note">No talent tree for this class yet.</p>';
    const shape = shapeOf(cls()), a = eff(), sugg = suggested(a), mine = subBranch();
    let svg = `<svg class="tree" viewBox="0 0 ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Talent tree, drawn as ${esc(shape.name)}">
      <defs><filter id="tglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs><g class="bdg">${shape.backdrop()}</g>`;
    const R = nd => (nd.keystone ? KEY_R : NODE_R);
    t.branches.forEach((b, bi) => { // edges first, nodes on top
      for (const nd of b.nodes.filter(shown)) for (const q of nd.req || []) {
        const pq = b.nodes.find(x => x.id === q); if (!pq || !shown(pq)) continue;
        const [x1, y1] = shape.pos(bi, pq), [x2, y2] = shape.pos(bi, nd), len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len, r1 = R(pq) + 4, r2 = R(nd) + 6;
        const d = `M${(x1 + ux * r1).toFixed(1)},${(y1 + uy * r1).toFixed(1)} L${(x2 - ux * r2).toFixed(1)},${(y2 - uy * r2).toFixed(1)}`;
        const on = S.r[q] > 0, lit = on && S.r[nd.id] > 0, pl = !lit && a[q] > 0 && a[nd.id] > 0;
        svg += pl ? `<path class="edge pl" d="${d}"/>` : on ? `<path class="edge" d="${d}" stroke="${b.color}" stroke-opacity="${lit ? 0.95 : 0.45}"${lit ? ` style="filter:drop-shadow(0 0 4px ${b.color})"` : ''}/>` : `<path class="edge off" d="${d}"/>`;
      }
    });
    const now = performance.now();
    t.branches.forEach((b, bi) => {
      for (const nd of b.nodes.filter(shown)) {
        const [x, y] = shape.pos(bi, nd), r = a[nd.id] | 0, p = r - (S.r[nd.id] | 0), st = nodeState(nd, a), Rr = R(nd);
        const pop = S.flash === nd.id && now - S.flashT < 900 ? ' pop' : '', hl = S.sel === nd.id ? ' hl' : '';
        const frac = r / nd.max, circ = 2 * Math.PI * (Rr + 4);
        const core = nd.keystone
          ? `<rect class="core" x="${-Rr * 0.78}" y="${-Rr * 0.78}" width="${Rr * 1.56}" height="${Rr * 1.56}" rx="4" transform="rotate(45)" stroke="${b.color}"/><rect x="${-Rr}" y="${-Rr}" width="${Rr * 2}" height="${Rr * 2}" rx="6" transform="rotate(45)" fill="none" stroke="${b.color}" stroke-opacity=".35"/>`
          : `<circle class="core" r="${Rr}" stroke="${nd.sub ? '#e9b949' : b.color}"/>${r ? `<circle class="arc" r="${Rr + 4}" stroke="${p && p === r ? '#e9b949' : b.color}" stroke-dasharray="${circ * frac} ${circ}" transform="rotate(-90)"/>` : ''}`;
        const sg = sugg[nd.id] ? `<circle class="sug" r="${Rr + 9}"/><text class="sugn" x="${-Rr - 6}" y="${-Rr + 2}">${sugg[nd.id]}</text>` : '';
        const plan = p > 0 ? `<circle class="plan" cx="${Rr * 0.8}" cy="${-Rr * 0.8}" r="9"/><text class="plant" x="${Rr * 0.8}" y="${-Rr * 0.8}">+${p}</text>` : '';
        svg += `<g class="tn ${st}${pop}${hl}${nd.sub ? ' subn' : ''}" data-id="${nd.id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc(nd.name)}, rank ${r} of ${nd.max}${p ? `, ${p} planned` : ''}">
          <circle class="halo" r="${Rr + 8}" fill="${nd.sub ? '#e9b949' : b.color}" filter="url(#tglow)"/>${sg}${core}
          <text class="glyph" y="1"${nd.keystone ? ' style="font-size:17px"' : ''}>${esc(nd.icon || '•')}</text>
          <text class="nm" y="${Rr + 12}">${esc(shortName(nd.name))}</text><text class="rk" x="${-Rr * 0.95}" y="${Rr * 0.95}">${r}/${nd.max}</text>${plan}</g>`;
      }
    });
    svg += '</svg>';
    const heads = `<div class="bheads">${t.branches.map(b => `<div class="bh ${b.id === mine ? 'mine' : ''}" style="--bc:${b.color}" title="${esc(b.theme)}"><b>${esc(b.name)}</b><span>${branchSpent(a, cls(), b.id)} pts</span>${b.id === mine ? `<em>${esc(subName(sub()))}</em>` : ''}</div>`).join('')}
      <span class="shapename" title="${esc(shape.blurb)}">${esc(shape.name)}</span></div>`;
    return `<div class="tgrid"><div class="treewrap">${heads}${svg}</div>${side(a)}</div>`;
  }
  function nodeCard(id, a) {
    const nd = nodeDef(id); if (!nd) return '';
    const b = tree().branches.find(x => x.id === nd.branch), r = a[id] | 0, p = r - (S.r[id] | 0);
    const lines = nodeLines(cls(), nd, Math.max(1, Math.min(nd.max, r + (r < nd.max ? 1 : 0))));
    const one = nd.desc || lines[0] || '';
    const why = r >= nd.max ? null : spendBlock(cls(), a, state.lvl, id, sub());
    return `<div class="ncard" style="--bc:${b.color}"><h4>${esc(nd.name)}</h4><div class="meta">${nd.keystone ? 'Keystone' : `Rank ${r} of ${nd.max}${p ? ` (${p} planned)` : ''}`} · ${esc(b.name)} · tier ${nd.tier + 1}${nd.sub ? ` · ${esc(subName(nd.sub))}` : ''}${nd.coop ? ' · co-op' : ''}</div>
      <div class="one">${esc(one)}</div>
      ${lines.filter(l => l !== one).length ? `<div class="det">${r && r < nd.max ? '<b>Next rank: </b>' : ''}${lines.filter(l => l !== one).map(esc).join('<br>')}</div>` : ''}
      ${why && !S.locked ? `<div class="why">${esc(why)}</div>` : ''}</div>`;
  }
  function side(a) {
    const T = totals(), spent = spentOf(S.r), confirm = performance.now() - S.confirmT < 4000;
    const lines = [];
    for (const [k, v] of Object.entries(T.stat)) if (v && STAT_TEXT[k]) lines.push(`<li>${esc(STAT_TEXT[k](v))}</li>`);
    for (const [sk, m] of Object.entries(T.sk)) for (const kk of ['dmg', 'fin', 'cd', 'radius', 'dur']) if (m[kk]) lines.push(`<li>${esc(effectText(cls(), { sk, [kk]: m[kk] }))}</li>`);
    for (const [au, v] of Object.entries(T.aura)) lines.push(`<li>${esc(effectText(cls(), { aura: au, v }))}</li>`);
    for (const nd of nodesOf(cls())) if (S.r[nd.id] && nd.fx.some(e => e.key)) lines.push(`<li class="k"><b>${esc(nd.name)}</b>: ${esc(nd.desc)}</li>`);
    const tiers = TALENTS.tiers.map((need, k) => `<span class="${spentAbove(a, cls(), k) >= need ? 'on' : ''}" title="Tier ${k + 1}: ${need} points in the tiers above">${k === TALENTS.tiers.length - 1 ? '◆' : `T${k + 1}`}</span>`).join('');
    let top;
    const picker = S.pm ? `<div class="pbox"><div class="plbl">Plan for a class</div><div class="row2">${leads().map(c => `<button class="btn ${c === cls() ? 'gold' : 'ghost'}" data-pc="${c}">${esc(CLASSES[c].name)}</button>`).join('')}</div>
      <div class="note" style="margin-top:6px">Your tree opens when you graduate. Plan it now: the plan for the class you graduate as is spent then.</div></div>` : '';
    if (S.locked) top = `<div class="pbox"><b>${free()} point${free() === 1 ? '' : 's'} banked</b><div class="note">Your talent tree opens when you graduate at the Academy. Look around: this is what your class can grow into.</div></div>`;
    else if (S.plan.length) {
      const counts = {}; for (const id of S.plan) counts[id] = (counts[id] | 0) + 1;
      top = `<div class="pbox"><div class="plbl" style="color:var(--ember);opacity:1">Your plan</div><ol>${Object.entries(counts).map(([id, k]) => `<li>${esc(nodeDef(id)?.name)}${k > 1 ? ` ×${k}` : ''}</li>`).join('')}</ol>
        <div class="row2"><button class="btn gold" data-a="confirm">${S.pm ? 'Save to plan' : `Confirm ${S.plan.length}`}</button><button class="btn ghost" data-a="undo">Undo</button></div>
        <div class="note" style="margin-top:6px">${left()} point${left() === 1 ? '' : 's'} left. ${isTouch ? 'Tap' : 'Right-click'} a planned node to take a rank back.</div></div>`;
    } else if (S.pm) top = `<div><div class="big ${free() ? '' : 'zero'}">${free()}</div><div class="note">banked point${free() === 1 ? '' : 's'} left to plan.${spent ? ` ${spent} planned for the ${esc(CLASSES[cls()].name)}.` : ''}</div></div>`;
    else top = `<div><div class="big ${free() ? '' : 'zero'}">${free()}</div><div class="note">point${free() === 1 ? '' : 's'} to spend. ${spent} of ${S.pts} spent.${free() ? ` ${isTouch ? 'Tap' : 'Click'} nodes to plan, then confirm.` : state.lvl < MAX_LEVEL ? ` The next comes at level ${state.lvl + 1}.` : ''}</div></div>`;
    const sel = S.sel || S.hover;
    if (S.pm) return `<aside class="side">${picker}${top}
      ${sel ? nodeCard(sel, a) : '<div class="note">Point at a node to read it. A short line first, then the numbers.</div>'}
      <div><div class="plbl">Tiers open</div><div class="tiers">${tiers}</div></div>
      <button class="btn ${confirm ? 'warn' : ''}" data-a="clearplan" ${spent ? '' : 'disabled'}>${confirm ? 'Click again to clear this plan' : 'Clear this plan'}</button>
    </aside>`;
    return `<aside class="side">${top}
      ${sel ? nodeCard(sel, a) : '<div class="note">Point at a node to read it. A short line first, then the numbers.</div>'}
      <div><div class="plbl">Tiers open</div><div class="tiers">${tiers}</div></div>
      <label class="tog ${S.sug ? 'on' : ''}" data-a="sug"><i></i>Suggested path${subBranch() ? `: ${esc(subName(sub()))} first` : ''}</label>
      <details ${lines.length && lines.length < 6 ? 'open' : ''}><summary>Your bonuses (${lines.length})</summary>${lines.length ? `<ul class="bon">${lines.join('')}</ul>` : '<div class="note">Nothing learned yet.</div>'}</details>
      <button class="btn ${confirm ? 'warn' : ''}" data-a="respec" ${S.near && spent ? '' : 'disabled'}>${confirm ? 'Click again to refund every point' : 'Respec: refund all points'}</button>
      <div class="note ${S.near ? 'shrine-on' : ''}">${S.near ? 'You are at a Skill Shrine: respec and refunds are free here.' : 'Refunds are free at a Skill Shrine in town.'}</div>
    </aside>`;
  }

  // ----- tooltip (short; the side card has the details) -----
  const tip = () => panel.querySelector('.tt');
  function hideTip() { const t = tip(); if (t) t.hidden = true; if (S.hover) { S.hover = null; refreshSide(); } }
  function showTip(id, ev) { return asPlan(() => showTip0(id, ev)); }
  function showTip0(id, ev) {
    const nd = nodeDef(id), t = tip(); if (!nd || !t) return;
    const a = eff(), b = tree().branches.find(x => x.id === nd.branch), r = a[id] | 0, p = r - (S.r[id] | 0);
    const why = r >= nd.max ? null : spendBlock(cls(), a, state.lvl, id, sub());
    const one = nd.desc || nodeLines(cls(), nd, Math.max(1, Math.min(nd.max, r + 1)))[0] || '';
    t.style.setProperty('--bc', b.color);
    t.innerHTML = `<h3>${esc(nd.name)}</h3><div class="meta">${nd.keystone ? 'Keystone' : `Rank ${r} of ${nd.max}`}${p ? `, ${p} planned` : ''}</div><div>${esc(one)}</div>
      ${why && !S.locked ? `<div class="why">${esc(why)}</div>` : ''}
      ${!why && !S.locked && r < nd.max ? `<div class="how">${isTouch ? 'Tap' : 'Click'} to plan a rank.</div>` : ''}
      ${p ? `<div class="how">Right-click to take a planned rank back.</div>` : ''}`;
    t.hidden = false; S.hover = id;
    place(ev); refreshSide();
  }
  function refreshSide() { return asPlan(refreshSide0); }
  function refreshSide0() { // only the node card changes on hover
    if (S.tab !== 'talents' || S.sel) return;
    const el = panel.querySelector('.side'); if (!el) return;
    const a = eff(), card = el.querySelector('.ncard, .side > .note');
    if (!card) return;
    const html = S.hover ? nodeCard(S.hover, a) : '<div class="note">Point at a node to read it. A short line first, then the numbers.</div>';
    const tmp = document.createElement('div'); tmp.innerHTML = html; card.replaceWith(tmp.firstElementChild);
  }
  function place(ev) {
    const t = tip(); if (!t || t.hidden) return;
    const box = panel.querySelector('.body').getBoundingClientRect();
    let x = ev.clientX - box.left + 18, y = ev.clientY - box.top + 14;
    if (x + 280 > box.width) x = ev.clientX - box.left - 288;
    const h = t.offsetHeight || 120;
    if (y + h > box.height) y = Math.max(4, box.height - h - 6);
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  }

  // ================================================== Abilities tab ===================================================
  function abilities() {
    const rows = skillRows(), col = hex(CLASSES[cls()].color);
    if (!rows.some(r => r[0] === S.ab)) S.ab = 1;
    const list = rows.map(([slot, s, e]) => {
      const locked = state.lvl < s.lvl, stg = stageOf(slot, s, e), nm = e ? skillName(s, e) : s.name;
      const ready = e && !e.br && masteryLevel(e.pts) >= MASTERY.evolveAt && !locked;
      return `<button class="ai ${S.ab === slot ? 'on' : ''} ${locked ? 'locked' : ''}" data-ab="${slot}"><span class="k">${slot === 0 ? (isTouch ? 'Atk' : '⚔') : slot === 4 ? 'G' : slot}</span><span><b>${esc(nm)}</b><small>${locked ? `Level ${s.lvl}` : slot === 0 ? 'Basic attack' : !e ? 'Signature skill' : `${slot === 4 ? 'Signature · ' : ''}Mastery ${masteryLevel(e.pts)} · ${stg}`}${ready ? ' · <span style="color:var(--ember)">can evolve</span>' : ''}</small></span></button>`;
    }).join('');
    const row = rows.find(r => r[0] === S.ab);
    return `<div class="agrid"><div class="alist">${list}<p class="note" style="margin-top:6px">Every ability grows three ways: mastery from using it well, an evolution at Mastery ${MASTERY.evolveAt}, and talents.</p></div>
      <div class="adet">${detail(row, col)}</div></div>`;
  }
  function detail([slot, s, e], col) {
    const T = totals(), haste = (state.inv?.stats?.haste || 0) / 100, locked = state.lvl < s.lvl;
    const key = slot === 0 ? 'basic' : slot === 4 ? 'sig' : s.id;
    const nm = e ? skillName(s, e) : s.name, desc = e ? skillDesc(s, e) : s.desc;
    const baseCd = e ? masteryCd(s, e) : s.cd, m = T.sk[key];
    const cdNow = baseCd * (m?.cd ? Math.max(0.4, 1 + m.cd / 100) : 1) * (slot ? 1 - haste : 1);
    const one = desc.split(/(?<=[.:])\s/)[0];
    let h = `<div class="ahead"><div><div class="plbl">${slot === 0 ? 'Basic attack' : slot === 4 ? `Signature skill · ${esc(subName(sub()) || 'Specialised')}` : `Skill ${slot}`}</div>
        <h3>${esc(nm)}</h3>${nm !== s.name ? `<div class="note">${esc(s.name)}, evolved</div>` : ''}<div class="one">${esc(one)}</div>
        ${desc !== one ? `<p class="note" style="margin:0 0 8px">${esc(desc.slice(one.length).trim())}</p>` : ''}
        <div class="facts"><span>Cooldown ${Math.abs(cdNow - s.cd) > 0.01 ? `<s>${s.cd.toFixed(2)} s</s> ` : ''}<b>${cdNow.toFixed(2)} s</b></span>${locked ? `<span>Unlocks at level ${s.lvl}</span>` : ''}${e ? `<span>Mastery ${masteryLevel(e.pts)}</span>` : ''}</div></div>
        ${diagram(s.id, col)}</div>`;
    if (e && BRANCHES[s.id]) {
      const l = locked ? 0 : masteryLevel(e.pts), [ml, into, span] = masteryProgress(e.pts), br = activeBranch(e);
      const steps = [[1, 'Mastery 1', 'Learned'], [2, 'Mastery 2', '-10% cooldown'], [3, 'Mastery 3', br ? BRANCHES[s.id][br].name : 'Evolves'], [4, 'Mastery 4', '+10% effect'], [5, 'Mastery 5', 'Awakens']];
      h += `<div class="sub">Mastery</div><div class="mtrack">${steps.map(([n, a, b]) => `<div class="${l >= n ? 'done' : ''} ${n === ml + 1 ? 'now' : ''} ${n === MASTERY.evolveAt ? 'ev' : ''}"><i>${n === ml + 1 && span ? `<u style="width:${Math.min(100, (100 * into) / span)}%"></u>` : ''}</i>${a}<br><span style="opacity:.75">${esc(b)}</span></div>`).join('')}</div>
        <div class="note">${span ? `${Math.floor(into)} / ${span} to Mastery ${ml + 1}. Land hits, finish fights and avoid damage to raise it.` : 'Fully mastered.'}</div>`;
      const evolved = !!br, awake = l >= MASTERY.max;
      h += `<div class="strip"><div class="sc on"><div class="plbl">Base</div><b>${esc(s.name)}</b><small>${esc(s.desc.split(/(?<=\.)\s/)[0])}</small></div><i>→</i>
        <div class="sc ev ${evolved ? 'on' : 'dim'}"><div class="plbl">Evolved · M${MASTERY.evolveAt}</div><b>${evolved ? esc(BRANCHES[s.id][br].name) : 'One of two forms'}</b><small>${evolved ? esc(BRANCHES[s.id][br].desc) : `Choose at Mastery ${MASTERY.evolveAt}, below.`}</small></div><i>→</i>
        <div class="sc aw ${awake ? 'on' : 'dim'}"><div class="plbl">Awakened · M${MASTERY.max}</div><b>${awake ? 'Awakened' : 'Awakening'}</b><small>${esc(awakenText(s, e, br))}</small></div></div>
        <div class="evos">${['A', 'B'].map(k => evoCard(s, e, k, l)).join('')}</div>`;
    } else if (slot === 0) {
      const ids = CLASS_STYLES[cls()] || [];
      if (ids.length) h += `<div class="sub">Weapon styles</div><div class="note">Your basic attack follows the weapon you hold. Each style changes its rhythm.</div><div class="wst">${ids.map(id => `<div class="sc"><b>${esc(STYLES[id].name)}${STYLES[id].def ? ' <span class="stage">starter</span>' : ''}</b><small>${esc(STYLES[id].desc)}</small>${STYLES[id].passive ? `<small style="color:#fde68a">${esc(STYLES[id].passive)}</small>` : ''}</div>`).join('')}</div>`;
    }
    if (slot === 4) h += sigDetail(s, e);
    const nodes = nodesForSkill(cls(), key).filter(shown);
    h += `<div class="sub">Talents that change it</div><div class="chips">${nodes.length ? nodes.map(nd => {
      const b = tree().branches.find(x => x.id === nd.branch), r = S.r[nd.id] | 0;
      return `<button class="chip2 ${r ? '' : 'off'}" style="--bc:${b.color}" data-goto="${nd.id}" title="${esc(nodeLines(cls(), nd, Math.max(1, r)).join(' / '))}"><b>${esc(nd.name)}</b> ${r}/${nd.max}</button>`;
    }).join('') : '<span class="note">None in this tree.</span>'}</div>`;
    return h;
  }
  // Hooks for later phases (signature mastery, awakenings) live here so the tab draws the same either way.
  const awakenText = (s, e, br) => { // the active form's awakening (shared/mastery.js AWAKEN), else both
    const A = AWAKEN[s.id]; if (!A) return `At Mastery ${MASTERY.max} your evolved form gains one more rule.`;
    return br ? ruleText(A[br]) : `Each form gains one more rule at Mastery ${MASTERY.max}.`;
  };
  const sigDetail = (s, e) => `<p class="note" style="margin-top:10px">Your signature skill sits on ${keyName('skill4')}. It comes from your specialisation at the Academy${e ? ' and earns mastery like your other skills' : ''}.</p>`;
  function evoCard(s, e, k, l) {
    const b = BRANCHES[s.id][k], cur = l >= MASTERY.evolveAt ? e.br : null, on = cur === k;
    let st, can = false;
    if (l < MASTERY.evolveAt) st = `Evolves at Mastery ${MASTERY.evolveAt}`;
    else if (on) st = 'Active';
    else if (!e.br) { st = 'Choose this evolution'; can = true; }
    else if (S.near) { st = 'Switch to this (free here)'; can = true; }
    else st = 'Switch at a Skill Shrine';
    return `<button class="evo ${on ? 'on' : ''} ${can ? 'can' : ''} ${l < MASTERY.evolveAt ? 'dim' : ''}" ${can ? `data-sk="${s.id}" data-br="${k}"` : 'disabled'}><b>${k}: ${esc(b.name)}${b.coop ? ' <span style="font:600 10px system-ui;color:#67e8f9">co-op</span>' : ''}</b><small>${esc(b.desc)}</small>${AWAKEN[s.id]?.[k] ? `<small style="color:#c4b5fd">M${MASTERY.max}: ${esc(ruleText(AWAKEN[s.id][k]))}</small>` : ''}<span class="st2">${st}</span></button>`;
  }

  // ---------- input ----------
  panel.addEventListener('click', ev => {
    const t = ev.target;
    const tab = t.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; S.sel = null; hideTip(); render(); sfx.play('ui'); return; }
    const a = t.closest('[data-a]')?.dataset.a;
    if (a === 'close') return toggle(false);
    if (a === 'respec') {
      if (performance.now() - S.confirmT < 4000) { S.confirmT = 0; S.plan = []; send({ type: 'talent', op: 'reset' }); }
      else { S.confirmT = performance.now(); render(); }
      return;
    }
    if (a === 'confirm') return confirmPlan();
    if (a === 'clearplan') {
      if (performance.now() - S.confirmT < 4000) { S.confirmT = 0; S.plan = []; send({ type: 'talent', op: 'plan', cls: planCls(), clear: 1 }); }
      else { S.confirmT = performance.now(); render(); }
      return;
    }
    const pc = t.closest('[data-pc]')?.dataset.pc; if (pc) { if (pc !== planCls()) { S.pc = pc; S.plan = []; S.sel = null; sfx.play('ui'); render(); } return; }
    if (a === 'undo') { S.plan = []; sfx.play('ui'); render(); return; }
    if (a === 'sug') { ev.preventDefault(); S.sug = !S.sug; try { localStorage.setItem('fb_tsug', S.sug ? '1' : '0'); } catch {} render(); return; }
    const nd = t.closest('.tn'); if (nd) { S.sel = nd.dataset.id; plan(nd.dataset.id); return; }
    const ab = t.closest('[data-ab]'); if (ab) { S.ab = +ab.dataset.ab; render(); return; }
    const go = t.closest('[data-go]')?.dataset.go;
    if (go) { if (go.startsWith('ab')) { S.tab = 'abilities'; S.ab = +go.slice(2); } else { S.tab = 'talents'; S.sel = nodeDef(go) ? go : null; } render(); return; }
    const gt = t.closest('[data-goto]'); if (gt) { S.tab = 'talents'; S.sel = gt.dataset.goto; render(); return; }
    const evo = t.closest('.evo.can'); if (evo) { send({ type: 'evolve', sk: evo.dataset.sk, br: evo.dataset.br }); sfx.play('ui'); }
  });
  function plan(id) { asPlan(() => plan0(id)); render(); } // (render outside the plan view: the header is the player's)
  function plan0(id) {
    if (S.locked) { sfx.play('ui'); return flash('Your talent tree opens when you graduate at the Academy. Your points are banked.'); }
    const res = planAlloc(cls(), S.r, state.lvl, [...S.plan, id], sub());
    if (res.error) { sfx.play('ui'); return flash(res.error.replace(/^[^:]+: /, '')); } // say why (tier gate, missing line, no points, max rank)
    S.plan.push(id); S.flash = id; S.flashT = performance.now(); sfx.play('ui');
  }
  function unplan(id) { const r = asPlan(() => unplan0(id)); if (r) render(); return r; }
  function unplan0(id) {
    const i = S.plan.lastIndexOf(id); if (i < 0) return false;
    S.plan.splice(i, 1); S.plan = keepValid(S.plan); sfx.play('ui');
    return true;
  }
  function confirmPlan() {
    if (!S.plan.length) return;
    if (state.ws?.readyState !== 1) return flash('Not connected to the server.');
    if (planMode()) send({ type: 'talent', op: 'plan', cls: planCls(), ids: S.plan }); // an Initiate's plan: saved, spent at graduation
    else send({ type: 'talent', op: 'spendMany', ids: S.plan }); // (send returns nothing useful once connected)
    S.sent = true;
    clearTimeout(S.waitT);
    S.waitT = setTimeout(() => { S.sent = false; flash('No answer from the server. If this keeps happening, reload the page.'); }, 2500);
  }
  // A short message over the bottom of the window (blocked clicks, server replies).
  function flash(text) {
    let el = document.getElementById('tflash');
    if (!el) { el = document.createElement('div'); el.id = 'tflash'; document.body.appendChild(el); }
    el.textContent = text; el.classList.remove('off'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(flash.t); flash.t = setTimeout(() => el.classList.replace('on', 'off'), 2600);
  }
  panel.addEventListener('keydown', ev => {
    const nd = ev.target.closest?.('.tn');
    if (nd && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); S.sel = nd.dataset.id; plan(nd.dataset.id); }
    else if (nd && (ev.key === 'Backspace' || ev.key === 'Delete')) { ev.preventDefault(); unplan(nd.dataset.id); }
  });
  panel.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const nd = ev.target.closest('.tn'); if (!nd) return;
    if (unplan(nd.dataset.id)) return; // a planned rank goes back first
    if (!S.near) return;
    if (!refundBlock(cls(), S.r, nd.dataset.id, sub())) send({ type: 'talent', op: 'refund', id: nd.dataset.id });
  });
  panel.addEventListener('mousemove', ev => {
    const nd = ev.target.closest?.('.tn');
    if (!nd) { if (S.hover) hideTip(); return; }
    if (S.hover !== nd.dataset.id) showTip(nd.dataset.id, ev); else place(ev);
  });
  panel.addEventListener('mouseleave', hideTip);
  panel.addEventListener('focusin', ev => { const nd = ev.target.closest?.('.tn'); if (nd) { const r = nd.getBoundingClientRect(); showTip(nd.dataset.id, { clientX: r.right, clientY: r.top }); } });

  // ---------- the level-up moment ----------
  // What a new level brought: points, tier openings, skills, subclass stations, health and attack. Out of combat it shows
  // as a card for 4 s; in a fight the caller shows one line (returns false).
  function levelUp(lvl) {
    const c = CLASSES[cls()]; if (!c) return false;
    const gains = [];
    if (pointsAt(lvl) > pointsAt(lvl - 1)) gains.push({ h: `<b>+${pointsAt(lvl) - pointsAt(lvl - 1)}</b>talent point${S.locked ? ' (banked until you graduate)' : ''}` });
    for (const i of levelInfo(lvl)) gains.push({ h: esc(i.t), g: i.k !== 'b' });
    const sn = subName(sub());
    if (sn && lvl === 22) gains.push({ h: `<b>+2</b>${esc(sn)} talents grew on your tree`, g: true });
    if (sn && lvl === MAX_LEVEL) gains.push({ h: `<b>◆</b>Your ${esc(sn)} crown grew on your tree`, g: true });
    const a = statsFor(cls(), lvl - 1), b = statsFor(cls(), lvl);
    gains.push({ h: `<b>↑</b>Health ${a.maxHp} → ${b.maxHp} · attack ${a.atk.toFixed(1)} → ${b.atk.toFixed(1)}` });
    if (performance.now() - state.lastCombat < 4000) return false;
    let el = document.getElementById('lvlup');
    if (!el) { el = document.createElement('div'); el.id = 'lvlup'; $('bag').parentNode.append(el); }
    el.style.setProperty('--cc', hex(c.color));
    el.className = '';
    el.innerHTML = `<div class="k0">LEVEL UP</div><div class="n">${lvl}</div><div class="t">${esc(title())}${sn && lvl >= 22 ? (lvl >= MAX_LEVEL ? ' · Crowned' : ' II') : ''}</div>
      <ul>${gains.slice(0, 5).map(g => `<li class="${g.g ? 'g' : ''}">${g.h}</li>`).join('')}</ul>
      ${!S.locked && free() ? `<div class="hint">${tapping() ? 'Tap Path to spend it' : `${keyName('skillTree')}: open your Path to spend it`}</div>` : ''}`;
    clearTimeout(levelUp.t); clearTimeout(levelUp.t2);
    levelUp.t = setTimeout(() => el.classList.add('out'), 4000);
    levelUp.t2 = setTimeout(() => el.remove(), 4700);
    return true;
  }

  // ---------- per frame ----------
  let t0 = 0;
  function frame(now) {
    if (now - t0 < 300) return;
    t0 = now;
    if (!state.joined || state.spectator) return;
    const key = `${state.lvl}|${!!mastery.near()}|${S.confirmT ? Math.floor((now - S.confirmT) / 4000) : 0}`;
    if (key !== S.key) { S.key = key; badge(); if (isOpen() && !S.hover) render(); }
  }

  return { onMessage, event, toggle, isOpen, frame, speedMult, render, free, levelUp, plan: () => [...S.plan] };
}
