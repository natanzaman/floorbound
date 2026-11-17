// Client side of skill mastery and evolutions (rules and names: shared/mastery.js, server: server/mastery.js):
// the Skills panel (K, or F at a Skill Shrine), the evolution prompt, level-up/evolve banners and sounds,
// the Skill Shrines in each town, skill bar names/cooldowns, and the visuals of the 18 evolved skills.
import * as THREE from 'three';
import { CLASSES } from '/shared/data.js';
import {
  MASTERY, BRANCHES, SHRINES, nearShrine, masteryLevel, masteryProgress, activeBranch, branchDef, skillName, skillDesc, masteryCd,
} from '/shared/mastery.js';

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#skillsp { position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 44px); left: 50%; transform: translateX(-50%); width: min(620px, 96vw);
  max-height: calc(100vh - 150px); overflow: auto; padding: 12px 14px; font-size: 13px; z-index: 4; }
#skillsp .top { display: flex; justify-content: space-between; align-items: center; font-weight: 800; font-size: 15px; letter-spacing: .1em; }
#skillsp .top small { font-weight: 600; letter-spacing: 0; opacity: .7; font-size: 12px; margin-left: 8px; }
#skillsp .x { padding: 2px 9px; border-radius: 6px; border: 1px solid rgba(160,200,255,.3); background: transparent; color: inherit; }
#skillsp .note { font-size: 12px; opacity: .8; margin: 6px 0 2px; }
#skillsp .note.shrine { color: #c4b5fd; opacity: 1; }
#skillsp .skill { border: 1px solid rgba(160,200,255,.18); border-radius: 10px; padding: 9px 10px; margin-top: 9px; background: rgba(255,255,255,.03); }
#skillsp .skill.locked { opacity: .5; }
#skillsp .head { display: flex; align-items: baseline; gap: 8px; }
#skillsp .head b { font-size: 15px; }
#skillsp .head .base { opacity: .6; font-size: 12px; }
#skillsp .lv { margin-left: auto; font-weight: 800; color: #fde68a; font-size: 12px; letter-spacing: .08em; white-space: nowrap; }
#skillsp .mbar { height: 6px; border-radius: 4px; background: rgba(0,0,0,.45); margin: 6px 0 3px; overflow: hidden; }
#skillsp .mbar > div { height: 100%; background: linear-gradient(90deg, #8b5cf6, #c4b5fd); }
#skillsp .mbar.max > div { background: linear-gradient(90deg, #f59e0b, #fde68a); }
#skillsp .prog { display: flex; justify-content: space-between; font-size: 11px; opacity: .75; }
#skillsp .ups { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 6px 0 2px; }
#skillsp .ups span { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(160,200,255,.2); opacity: .5; }
#skillsp .ups span.on { opacity: 1; border-color: rgba(253,230,138,.6); color: #fde68a; }
#skillsp .desc { font-size: 12px; opacity: .8; margin: 4px 0 0; }
.evo-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 7px; }
.evo-card { text-align: left; border: 1px solid rgba(160,200,255,.25); border-radius: 9px; padding: 7px 9px; background: rgba(10,16,34,.55); color: inherit; font: inherit; cursor: pointer; position: relative; }
.evo-card b { display: block; font-size: 13px; margin-bottom: 2px; }
.evo-card small { display: block; font-size: 11.5px; opacity: .8; line-height: 1.3; }
.evo-card .tag { position: absolute; top: 6px; right: 7px; font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #67e8f9; }
.evo-card .st { display: block; margin-top: 5px; font-size: 11px; font-weight: 700; color: #c4b5fd; }
.evo-card.on { border-color: #fde68a; background: rgba(253,230,138,.12); box-shadow: 0 0 0 1px rgba(253,230,138,.4) inset, 0 0 12px rgba(253,230,138,.18); }
.evo-card.on .st { color: #fde68a; }
.evo-card:disabled { cursor: default; }
.evo-card.dim { opacity: .45; }
.evo-card.pick:hover { border-color: #c4b5fd; background: rgba(139,92,246,.18); }
#evo-prompt { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); width: min(460px, 94vw); padding: 10px 12px; z-index: 5;
  border-color: rgba(196,181,253,.6); box-shadow: 0 0 24px rgba(139,92,246,.35); }
#evo-prompt .h { font-weight: 800; letter-spacing: .1em; color: #c4b5fd; font-size: 13px; display: flex; justify-content: space-between; }
#evo-prompt .h button { background: transparent; border: 0; color: inherit; opacity: .7; }
.touch #evo-prompt { bottom: auto; top: 70px; }
.sk .mpip { position: absolute; top: 3px; right: 5px; font-size: 9px; font-weight: 800; color: #c4b5fd; letter-spacing: .04em; }
.sk .mpip.evo { color: #fde68a; }
.sk .mpip.ready { color: #0b1020; background: #fde68a; border-radius: 4px; padding: 0 3px; animation: ms-pulse 1s ease-in-out infinite; }
.sk.evolved { border-color: rgba(196,181,253,.75); box-shadow: 0 0 10px rgba(139,92,246,.35) inset; }
@keyframes ms-pulse { 50% { opacity: .55; } }
.lbl.npc.shrine { color: #c4b5fd; }
.num.mastery { color: #c4b5fd; font-size: 15px; font-weight: 800; letter-spacing: .05em; text-shadow: 0 0 8px #7c3aed, 0 1px 2px #000; }
.num.absorb { color: #fde68a; font-size: 13px; }
#me-buffs span.evo { color: #c4b5fd; }
`;

export function initMastery(ctx) {
  const { state, players, mobs, fx, sfx, send, banner, log, floatNum, project, isTouch, shake, scene, floor1, $ } = ctx;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const panel = document.createElement('div'); panel.id = 'skillsp'; panel.className = 'panel hidden';
  const prompt = document.createElement('div'); prompt.id = 'evo-prompt'; prompt.className = 'panel hidden';
  $('bag').parentNode.append(panel, prompt);
  const lbls = SHRINES.map(() => { const l = document.createElement('div'); l.className = 'lbl npc shrine'; l.style.display = 'none'; $('labels').appendChild(l); return l; });

  const M = { data: null, promptSk: null, shrines: [], bar: '', snoozed: new Set() }; // snoozed: prompts dismissed with Later
  const skills = () => CLASSES[state.cls]?.skills || [];
  const entry = id => M.data?.[id] || null;
  const lvlOf = id => masteryLevel(entry(id)?.pts || 0);
  const isOpen = () => !panel.classList.contains('hidden');

  // ---------- sounds (same building blocks as audio.js) ----------
  const basePlay = sfx.play.bind(sfx);
  const EXTRA = {
    mastery: o => { [76, 79, 84].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.45, vol: 0.14, type: 'triangle', at: i * 0.07 })); sfx.tone(o, { f: NOTE(64), dur: 0.5, vol: 0.12, type: 'sine' }); },
    evolve: o => { // a rising shimmer and a chord
      sfx.noise(o, { dur: 0.9, vol: 0.18, type: 'highpass', f: 2000, to: 9000, attack: 0.2 });
      [60, 64, 67, 71, 74, 79].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.9, vol: 0.11, type: 'triangle', at: i * 0.06 }));
      sfx.tone(o, { f: NOTE(48), to: NOTE(55), dur: 1.0, vol: 0.2, type: 'sine' });
    },
    whoosh: o => { sfx.noise(o, { dur: 0.35, vol: 0.35, type: 'bandpass', f: 600, to: 3000, q: 0.7, attack: 0.02 }); },
    quake: o => { sfx.tone(o, { f: 60, to: 28, dur: 0.8, vol: 0.8 }); sfx.noise(o, { dur: 0.7, vol: 0.5, type: 'lowpass', f: 500, to: 120 }); },
    chime: o => { [88, 91].forEach((n, i) => sfx.tone(o, { f: NOTE(n), dur: 0.35, vol: 0.1, type: 'sine', at: i * 0.05 })); },
  };
  sfx.play = (name, pos, vol = 1) => {
    if (!EXTRA[name]) return basePlay(name, pos, vol);
    if (!sfx.ctx || !sfx.on) return;
    const o = sfx.out(vol, pos);
    if (o) EXTRA[name](o);
  };

  // ---------- Skill Shrines ----------
  function buildShrine(s) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x6b6478, roughness: 0.9, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3f3a4a, roughness: 0.9, flatShading: true });
    const glow = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, emissive: 0x7c3aed, emissiveIntensity: 1.3, roughness: 0.3, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.35, 8), dark); base.position.y = 0.17; g.add(base);
    const step = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.3, 8), stone); step.position.y = 0.5; g.add(step);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.6, 6), stone); pillar.position.y = 1.45; g.add(pillar);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 0.3, 8), dark); bowl.position.y = 2.35; g.add(bowl);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), glow); crystal.scale.y = 1.6; crystal.position.y = 3.3; g.add(crystal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 3.3; g.add(ring);
    const rune = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.1, 40), new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = 0.05; g.add(rune);
    const light = new THREE.PointLight(0xa78bfa, 6, 9, 2); light.position.y = 3.3; g.add(light);
    g.position.set(s.x, 0, s.z);
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    (s.floor === 1 ? floor1 : scene).add(g); // Floor 1's shrine hides with the rest of the town on Floor 2
    return { g, crystal, ring, rune };
  }
  for (const s of SHRINES) M.shrines.push(buildShrine(s));
  const near = () => !state.dead && state.joined && !state.spectator && !!nearShrine(state.x, state.z);

  // ---------- data ----------
  function onMessage(msg) {
    if (msg.type !== 'mastery') return false;
    M.data = msg.m;
    if (M.promptSk && entry(M.promptSk)?.br) hidePrompt();
    checkPrompt();
    ctx.rebuildBar(); // names, mastery pips
    render();
    return true;
  }
  // Skills that reached Mastery 3 (and are unlocked) but have no branch yet.
  const pending = () => skills().slice(1).filter(s => entry(s.id) && lvlOf(s.id) >= MASTERY.evolveAt && !entry(s.id).br && state.lvl >= s.lvl).map(s => s.id);
  function checkPrompt() { const p = pending().filter(id => !M.snoozed.has(id)); if (!M.promptSk && p.length && !isOpen()) showPrompt(p[0]); }
  // The skill bar asks for these.
  const skillAt = slot => skills()[slot];
  const name = slot => { const s = skillAt(slot); return slot > 0 ? skillName(s, entry(s.id)) : s.name; };
  const desc = slot => { const s = skillAt(slot); return slot > 0 ? skillDesc(s, entry(s.id)) : s.desc; };
  const cd = slot => { const s = skillAt(slot); return slot > 0 ? masteryCd(s, entry(s.id)) * (1 - (state.inv?.stats?.haste || 0) / 100) : s.cd; };
  const evoId = slot => { const s = skillAt(slot); return slot > 0 ? branchDef(s.id, activeBranch(entry(s.id)))?.id || null : null; };
  // HTML added inside a skill bar button: the mastery level pip.
  function pip(slot) {
    const s = skillAt(slot);
    if (!slot || !entry(s.id) || state.lvl < s.lvl) return '';
    const l = lvlOf(s.id), ready = pending().includes(s.id);
    return `<span class="mpip ${ready ? 'ready' : activeBranch(entry(s.id)) ? 'evo' : ''}">${ready ? 'EVOLVE' : `M${l}`}</span>`;
  }
  const barKey = () => skills().map((s, i) => `${name(i)}|${pip(i)}`).join(',');
  function barChanged() { const k = barKey(); if (k === M.bar) return false; M.bar = k; return true; }

  // ---------- Skills panel ----------
  function toggle(open = !isOpen()) {
    panel.classList.toggle('hidden', !open);
    if (open) { render(); hidePrompt(); sfx.play('ui'); }
  }
  function cards(s, e, l, atShrine) {
    const cur = activeBranch(e) || (l >= MASTERY.evolveAt ? e.br : null);
    return `<div class="evo-cards">${['A', 'B'].map(br => {
      const b = BRANCHES[s.id][br], on = cur === br;
      let st, can = false;
      if (l < MASTERY.evolveAt) st = `Evolves at Mastery ${MASTERY.evolveAt}`;
      else if (on) st = 'Active ✓';
      else if (!e.br) { st = 'Choose'; can = true; }
      else if (atShrine) { st = 'Switch to this (free)'; can = true; }
      else st = 'Switch at a Skill Shrine';
      return `<button class="evo-card ${on ? 'on' : ''} ${can ? 'pick' : ''} ${l < MASTERY.evolveAt ? 'dim' : ''}" data-sk="${s.id}" data-br="${br}" ${can ? '' : 'disabled'}>${b.coop ? '<span class="tag">CO-OP</span>' : ''}<b>${br} · ${esc(b.name)}</b><small>${esc(b.desc)}</small><span class="st">${st}</span></button>`;
    }).join('')}</div>`;
  }
  function render() {
    if (!isOpen()) return;
    const atShrine = near();
    let h = `<div class="top"><span>SKILLS<small>Mastery and evolutions</small></span><button class="x" data-a="close">✕</button></div>`;
    h += atShrine ? '<div class="note shrine">You are at a Skill Shrine: change any evolution for free.</div>'
      : '<div class="note">Skills gain mastery when they land: damage, posture, Breaks and Switches, healing, damage prevented, buffed allies. Whiffs give nothing. At Mastery 3 a skill evolves; change your pick at a Skill Shrine in town.</div>';
    if (!M.data) h += '<div class="note">…</div>';
    else for (const s of skills().slice(1)) {
      const e = entry(s.id) || { pts: 0, br: null }, locked = state.lvl < s.lvl;
      const [l, into, span] = masteryProgress(e.pts);
      const evoName = skillName(s, e);
      h += `<div class="skill ${locked ? 'locked' : ''}"><div class="head"><b>${esc(evoName)}</b>${evoName !== s.name ? `<span class="base">${esc(s.name)}</span>` : ''}<span class="lv">${locked ? `UNLOCKS AT LV ${s.lvl}` : `MASTERY ${l}${l >= MASTERY.max ? ' · MAX' : ''}`}</span></div>`;
      h += `<div class="mbar ${span ? '' : 'max'}"><div style="width:${span ? Math.min(100, (100 * into) / span) : 100}%"></div></div>`;
      h += `<div class="prog"><span>${span ? `${Math.floor(into)} / ${span} to Mastery ${l + 1}` : 'Mastered'}</span><span>${Math.floor(e.pts)} total</span></div>`;
      h += `<div class="ups">${[[2, '-10% cooldown'], [3, 'Evolution'], [4, '+10% effect'], [5, 'Mastered']].map(([n, t]) => `<span class="${l >= n ? 'on' : ''}">M${n} · ${t}</span>`).join('')}</div>`;
      h += `<p class="desc">${esc(skillDesc(s, e))}</p>`;
      h += cards(s, e, locked ? 0 : l, atShrine) + '</div>';
    }
    panel.innerHTML = h;
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.a === 'close') { toggle(false); return; }
    if (b.dataset.sk) { send({ type: 'evolve', sk: b.dataset.sk, br: b.dataset.br }); sfx.play('ui'); }
  });

  // ---------- evolution prompt (Mastery 3 reached) ----------
  function showPrompt(skId) {
    const s = skills().find(x => x.id === skId); if (!s) return;
    M.promptSk = skId;
    prompt.innerHTML = `<div class="h"><span>${esc(s.name).toUpperCase()} CAN EVOLVE</span><button data-a="later">Later${isTouch ? '' : ' (K to view)'}</button></div>${cards(s, entry(skId), MASTERY.evolveAt, false)}`;
    prompt.classList.remove('hidden');
  }
  function hidePrompt() { M.promptSk = null; prompt.classList.add('hidden'); }
  prompt.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.a === 'later') { M.snoozed.add(M.promptSk); hidePrompt(); checkPrompt(); return; }
    if (b.dataset.sk) { send({ type: 'evolve', sk: b.dataset.sk, br: b.dataset.br }); sfx.play('ui'); }
  });

  // ---------- persistent buff visuals (Bulwark wall, Aegis bubble, Iron Skin) ----------
  const auras = new Map(); // `${id}:${kind}` -> { mesh, until }
  function aura(id, kind, secs, make) {
    endAura(id, kind);
    const p = players.get(id); if (!p) return;
    const mesh = make(); p.model.group.add(mesh);
    auras.set(`${id}:${kind}`, { mesh, until: performance.now() + secs * 1000, id });
  }
  function endAura(id, kind) {
    const a = auras.get(`${id}:${kind}`); if (!a) return;
    a.mesh.parent?.remove(a.mesh); a.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    auras.delete(`${id}:${kind}`);
  }
  const glass = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  const makers = {
    bulwark: () => { // a tall translucent tower-shield wall in front
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 2.6, 24, 1, true, -0.85, 1.7), glass(0x60a5fa, 0.3));
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.12, 2.12, 0.1, 24, 1, true, -0.85, 1.7), glass(0xfde68a, 0.9)); rim.position.y = 1.3;
      const rim2 = rim.clone(); rim2.material = rim.material.clone(); rim2.position.y = -1.3;
      g.add(wall, rim, rim2); g.position.y = 1.3; return g;
    },
    aegis: () => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), glass(0xfde68a, 0.22)); m.position.y = 1.1; const w = new THREE.Mesh(new THREE.IcosahedronGeometry(1.27, 1), new THREE.MeshBasicMaterial({ color: 0xfbbf24, wireframe: true, transparent: true, opacity: 0.45 })); m.add(w); return m; },
    iron: () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), new THREE.MeshBasicMaterial({ color: 0x9ca3af, wireframe: true, transparent: true, opacity: 0.4 })); m.position.y = 1.1; return m; },
  };

  // ---------- evolved skill visuals ----------
  function ghost(x0, z0, x1, z1, color) { // an afterimage capsule gliding down the dash path
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.0, 4, 10), glass(color, 0.55));
    m.position.set(x0, 1.0, z0);
    fx.add(m, 0.28, (mesh, k) => { mesh.position.set(x0 + (x1 - x0) * k, 1.0, z0 + (z1 - z0) * k); mesh.material.opacity = 0.55 * (1 - k * 0.6); });
  }
  function shrinkRing(x, z, r, color, life) { // a ring that closes in (Vortex)
    const m = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), glass(color, 0.85));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.3, z);
    fx.add(m, life, (mesh, k) => { mesh.scale.setScalar(Math.max(0.3, r * (1 - k))); mesh.rotation.z += 0.2; mesh.material.opacity = 0.85 * (1 - k * 0.5); });
  }
  function bladeRing(id, r) { // blades orbiting the player for the whole Blade Ring
    const p = players.get(id); if (!p) return;
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 1.1), new THREE.MeshBasicMaterial({ color: 0xbfdbfe }));
      const a = (i / 6) * Math.PI * 2;
      b.position.set(Math.cos(a) * r, 1.0, Math.sin(a) * r); b.rotation.y = -a;
      g.add(b);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.15, r, 48), glass(0x93c5fd, 0.45)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; g.add(ring);
    fx.add(g, 1.6, (mesh, k, dt) => {
      const pp = p.model.group.position; mesh.position.set(pp.x, 0, pp.z); mesh.rotation.y += dt * 9;
      ring.material.opacity = 0.45 * (1 - k);
    });
  }
  function riseRings(obj, color) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 24), glass(color, 0.9));
      m.rotation.x = -Math.PI / 2;
      fx.add(m, 1.1, (mesh, k) => { const kk = Math.max(0, k - i * 0.18); mesh.position.set(obj.position.x, 0.2 + kk * 2.6, obj.position.z); mesh.material.opacity = 0.9 * (1 - kk); });
    }
  }

  function evoFx(e) {
    const me = state.myId, p = players.get(e.id), mine = e.id === me || e.by === me ? 1 : 0.6;
    const ox = e.id === me && !['seismic', 'phantom2'].includes(e.ev) ? state.x : e.x, oz = e.id === me && !['seismic', 'phantom2'].includes(e.ev) ? state.z : e.z;
    const at = { x: e.x, z: e.z };
    if (p && e.s) { p.swing = 0.3; ctx.playAnim(players.get(['renew', 'miracle'].includes(e.ev) ? e.by : e.id), e.s, e.n); }
    switch (e.ev) {
      case 'phantom':
        fx.line(e.x, e.z, e.x2, e.z2, 0xa78bfa, 1.5, 0.45); ghost(e.x, e.z, e.x2, e.z2, 0xc4b5fd); sfx.play('whoosh', at, mine); break;
      case 'phantom2': // the afterimage strikes again
        fx.line(e.x, e.z, e.x2, e.z2, 0xe9d5ff, 1.1, 0.35, 1.3); ghost(e.x, e.z, e.x2, e.z2, 0x8b5cf6);
        for (let i = 1; i <= 4; i++) fx.sparks(e.x + (e.x2 - e.x) * i / 5, 1.2, e.z + (e.z2 - e.z) * i / 5, 5, 0xc4b5fd, 0.25, 5);
        sfx.play('swing', at, mine); break;
      case 'shoulder': {
        fx.line(e.x, e.z, e.x2, e.z2, 0xfb923c, 1.8, 0.3); sfx.play('roll', at, mine);
        const m = mobs.get(e.m);
        if (m) { fx.ring(m.x, m.z, m.def.radius + 1.6, 0xf97316, 0.4); fx.sparks(m.x, 1.3, m.z, 14, 0xfdba74, 0.32, 9); shake(e.id === me ? 0.3 : 0.1); sfx.play('hitHeavy', m.model.group.position, mine); }
        break;
      }
      case 'vortex': shrinkRing(ox, oz, e.r, 0x22d3ee, 0.35); shrinkRing(ox, oz, e.r * 0.7, 0x67e8f9, 0.3); sfx.play('whoosh', at, mine); break;
      case 'vortex2': fx.ring(ox, oz, e.r, 0x22d3ee, 0.4); fx.ring(ox, oz, e.r * 0.6, 0xa5f3fc, 0.3); sfx.play('swingHeavy', at, mine); break;
      case 'bladering': if (!e.n) bladeRing(e.id, e.r); sfx.play('swing', at, mine * 0.8); break;
      case 'starburst': {
        const fin = e.n === 5;
        fx.arc(ox, oz, e.f + (e.n % 2 ? 0.35 : -0.35), e.r, 0.9, fin ? 0xfde68a : e.n % 2 ? 0x7dd3fc : 0xe0f2ff);
        if (fin) { fx.ring(ox, oz, 3.5, 0xfde68a, 0.35); fx.sparks(ox + Math.sin(e.f) * 2, 1.4, oz + Math.cos(e.f) * 2, 12, 0xfef9c3, 0.3, 9); }
        sfx.play(fin ? 'swingHeavy' : 'swing', at, mine); break;
      }
      case 'finisher':
        fx.arc(ox, oz, e.f, e.r, e.n ? 1.2 : 0.9, e.n ? 0xef4444 : 0xfca5a5);
        if (e.n) { fx.ring(ox + Math.sin(e.f) * 2, oz + Math.cos(e.f) * 2, 2.6, 0xdc2626, 0.4); shake(e.id === me ? 0.25 : 0.1); }
        sfx.play(e.n ? 'swingHeavy' : 'swing', at, mine); break;
      case 'challenge': {
        fx.line(ox, oz, e.x2, e.z2, 0xef4444, 0.35, 0.5, 1.6);
        const m = mobs.get(e.m);
        if (m) { fx.ring(m.x, m.z, m.def.radius + 1.2, 0xef4444, 0.7); floatNum(m.model.group.position, m.model.height + 0.3, 'CHALLENGED', 'crit', mine); }
        sfx.play('swingHeavy', at, mine); break;
      }
      case 'warcry': fx.ring(ox, oz, e.r, 0xf97316, 0.7); fx.ring(ox, oz, e.r * 0.55, 0xfdba74, 0.5); shake(e.id === me ? 0.2 : 0.05); sfx.play('roar', at, 0.8 * mine); break;
      case 'bulwark': sfx.play('shield', at, mine); break;
      case 'ironskin': fx.sparks(ox, 1.2, oz, 14, 0xd1d5db, 0.25, 6); sfx.play('shield', at, mine); break;
      case 'quake':
        fx.ring(ox, oz, e.r, 0xa16207, 0.6); fx.ring(ox, oz, e.r * 0.6, 0xfbbf24, 0.45);
        for (let i = 0; i < 5; i++) { const a = Math.random() * 6.28, d = 1.5 + Math.random() * (e.r - 2); fx.sparks(ox + Math.sin(a) * d, 0.3, oz + Math.cos(a) * d, 6, 0xa8a29e, 0.35, 6); }
        shake(e.id === me ? 0.5 : 0.2); sfx.play('quake', at, mine); break;
      case 'seismic': {
        fx.line(e.x, e.z, e.x2, e.z2, 0xf59e0b, 2.6, 0.5, 0.15); fx.ring(e.x2, e.z2, 1.9, 0xfbbf24, 0.4);
        fx.sparks(e.x2, 0.4, e.z2, 8, 0xd6b38a, 0.33, 6);
        shake(e.id === me ? 0.2 : 0.05); sfx.play(e.n ? 'boom' : 'quake', { x: e.x2, z: e.z2 }, 0.6 * mine); break;
      }
      case 'renew': { const t = players.get(e.id); if (t) riseRings(t.model.group, 0x5eead4); sfx.play('heal', at, mine); break; }
      case 'miracle': { const t = players.get(e.id); if (t) { fx.beam(e.x, e.z, 0xfef3c7, 1.3); fx.heal(t.model.group); riseRings(t.model.group, 0xfde68a); } sfx.play('chime', at, mine); sfx.play('heal', at, mine); break; }
      case 'zeal': fx.ring(ox, oz, e.r, 0xfb923c, 0.6); fx.ring(ox, oz, 3, 0xfdba74, 0.4); sfx.play('spell', at, mine); break;
      case 'aegis': fx.ring(ox, oz, e.r, 0xfbbf24, 0.6); fx.ring(ox, oz, 2.5, 0xfef08a, 0.4); sfx.play('shield', at, mine); break;
      case 'haven': fx.zone(e.x, e.z, e.r, e.d, 0x60a5fa); fx.ring(e.x, e.z, e.r, 0x93c5fd, 0.6); sfx.play('spell', at, mine); break;
      case 'consecrate': fx.zone(e.x, e.z, e.r, e.d, 0xf59e0b); fx.ring(e.x, e.z, e.r, 0xfde047, 0.6); sfx.play('spell', at, mine); break;
    }
  }

  // ---------- events ----------
  function event(e) {
    const me = state.myId;
    switch (e.t) {
      case 'fx': if (e.k !== 'evo') return false; evoFx(e); return true;
      case 'mlvl': {
        if (e.to !== me) return true;
        const s = skills().find(x => x.id === e.sk); if (!s) return true;
        const p = players.get(me);
        if (p) { fx.ring(p.model.group.position.x, p.model.group.position.z, 2.4, 0xa78bfa, 0.7); floatNum(p.model.group.position, 3.0, `${s.name} · Mastery ${e.lvl}`, 'mastery'); }
        if (e.evo) { banner('SKILL CAN EVOLVE', `${s.name} reached Mastery ${e.lvl} · choose its evolution`); sfx.play('evolve'); }
        else { banner('MASTERY UP', `${skillName(s, entry(s.id))} · Mastery ${e.lvl}${e.lvl === 2 ? ' · -10% cooldown' : e.lvl === 4 ? ' · +10% effect' : e.lvl === 5 ? ' · Mastered' : ''}`); sfx.play('mastery'); }
        return true;
      }
      case 'evolve': {
        const p = players.get(e.id);
        if (p) { fx.beam(p.model.group.position.x, p.model.group.position.z, 0xa78bfa, 1.6); fx.ring(p.model.group.position.x, p.model.group.position.z, 3, 0xc4b5fd, 0.8); }
        if (e.to === me) { banner(e.first ? 'SKILL EVOLVED' : 'EVOLUTION CHANGED', e.name); sfx.play('evolve'); if (M.promptSk === e.sk) hidePrompt(); }
        return true;
      }
      case 'buff': {
        if (e.k === 'bulwark') { if (e.end) endAura(e.id, 'bulwark'); else aura(e.id, 'bulwark', e.d, makers.bulwark); return true; }
        if (e.k === 'aegis') { if (e.end) endAura(e.id, 'aegis'); else aura(e.id, 'aegis', e.d, makers.aegis); return true; }
        if (e.k === 'iron') { aura(e.id, 'iron', e.d, makers.iron); return true; }
        const p = players.get(e.id); if (!p) return ['cry', 'zeal', 'renew', 'purify'].includes(e.k);
        const g = p.model.group.position;
        if (e.k === 'cry') { fx.ring(g.x, g.z, 1.6, 0xf97316, 0.6); return true; }
        if (e.k === 'zeal') { fx.ring(g.x, g.z, 1.6, 0xfb923c, 0.6); fx.sparks(g.x, 1.4, g.z, 6, 0xfdba74, 0.22, 4); return true; }
        if (e.k === 'renew') return true;
        if (e.k === 'purify') { fx.shield(p.model.group, e.d, 0xfef3c7); return true; }
        return false;
      }
      case 'absorb': { const p = players.get(e.id); if (p && (e.id === me || state.spectator || (state.party && p.party === state.party))) floatNum(p.model.group.position, 2.3, `(${e.a} absorbed)`, 'absorb'); return true; }
      case 'block': { const p = players.get(e.id); if (p && e.id === me) floatNum(p.model.group.position, 2.5, 'Blocked', 'evade'); return true; }
      case 'evade': if (e.k !== 'purify') return false; { const p = players.get(e.id); if (p && (e.id === me || state.spectator)) floatNum(p.model.group.position, 2.4, 'Purified', 'evade'); } return true;
    }
    return false;
  }

  // ---------- per frame ----------
  let lblT = 0;
  function frame(dt, now) {
    for (const s of M.shrines) { s.crystal.rotation.y += dt * 1.2; s.crystal.position.y = 3.3 + Math.sin(now / 600) * 0.12; s.ring.rotation.z += dt * 0.8; s.rune.rotation.z -= dt * 0.2; }
    for (const [k, a] of auras) if (now > a.until || !players.has(a.id)) { const [id, kind] = k.split(':'); endAura(+id, kind); }
    if (!state.joined || state.spectator) return;
    SHRINES.forEach((s, i) => {
      const l = lbls[i], sp = project(s.x, 4.4, s.z), d = Math.hypot(state.x - s.x, state.z - s.z);
      if (sp && d < 22) {
        l.style.display = ''; l.style.left = `${sp[0]}px`; l.style.top = `${sp[1]}px`;
        const html = `Skill Shrine${d < MASTERY.shrineUse ? `<br><small>${isTouch ? 'tap Skills' : 'press F for skills'}</small>` : ''}`;
        if (l.innerHTML !== html) l.innerHTML = html;
      } else l.style.display = 'none';
    });
    if (now - lblT > 400) {
      lblT = now;
      if (isOpen()) { const n = near(); if (n !== M.wasNear) { M.wasNear = n; render(); } }
      if (state.lvl !== M.lvl) { M.lvl = state.lvl; checkPrompt(); ctx.rebuildBar(); } // a skill unlocked by levelling may be ready to evolve
    }
  }
  // Quake: launched enemies hop into the air (mob flag 128)
  function lift(e, dt) {
    if (e.launched && !(e.liftT >= 0)) e.liftT = 0;
    if (!(e.liftT >= 0)) return;
    e.liftT += dt;
    const k = Math.min(1, e.liftT / 0.8);
    e.model.group.position.y = 4 * 1.4 * k * (1 - k);
    if (k >= 1 && !e.launched) e.liftT = -1;
    else if (k >= 1) e.liftT = 0.8;
  }

  // Buff tags for the HUD (snapshot buff bits 32+).
  const buffTags = b => `${b & 32 ? '<span class="evo">Aegis</span>' : ''}${b & 64 ? '<span class="evo">Bulwark</span>' : ''}${b & 128 ? '<span class="evo">Iron Skin</span>' : ''}${b & 256 ? '<span class="evo">Renew</span>' : ''}${b & 512 ? '<span class="evo">War Cry</span>' : ''}${b & 1024 ? '<span class="evo">Zeal</span>' : ''}${b & 2048 ? '<span class="evo">Purified</span>' : ''}`;

  return { onMessage, event, toggle, isOpen, near, frame, lift, name, desc, cd, pip, evoId, barChanged, buffTags, render };
}
