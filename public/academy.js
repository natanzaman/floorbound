// The Academy (docs/briefs/academy.md), client side: the hall in the Town of Beginnings and its label, the yard's pens,
// the training enemies' looks (makeAcademyMob, for world.js), the Ward Post and the fallen dummy, the trial HUD, and the
// #academy panel (path, rank, trials, drills, armory, graduation, class change, the hall heads, classmates).
// The server decides everything (server/academy.js); the panel asks with { type: 'academy', op, ... }.
// Specialise (level 15+, server/subclasses.js): the subclasses of your class, the signature skill for slot 5 (sig()),
// subclass names on nameplates and the Players list; the lectern behind the hall (atLectern / readLectern).
import * as THREE from 'three';
import { CLASSES, CLASS_IDS } from '/shared/data.js';
import {
  ACADEMY, PENS, nearAcademy, WEAPONS, WEAPON_IDS, TRIALS, DRILLS, DRILL_IDS, DRILL_REWARD, MEDALS, MEDAL_COLORS, RANKS,
  INITIATE, HEADS, kitName, rankName, medalPoints, changeFee, trialBlock,
} from '/shared/academy.js';
import { YARD, LECTERN, nearLectern } from '/shared/academyyard.js';
import { SPEC, SUBCLASSES, subName, branchName } from '/shared/subclasses.js'; // specialisation (docs/briefs/subclasses.md)
import { keyHtml, tapping } from '/keyname.js';
import { buildName } from '/shared/talents.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...o });
const box = (w, h, d, color, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
const hex = c => '#' + c.toString(16).padStart(6, '0');
const headName = id => id ? id[0].toUpperCase() + id.slice(1) : '';
const medalDot = m => `<span class="md" style="--mc:${MEDAL_COLORS[m | 0]}" title="${m ? MEDALS[m] : 'No medal yet'}">${m ? MEDALS[m][0] : '·'}</span>`;

// ---------- the training enemies' looks (world.js makeMobModel) ----------
export function makeAcademyMob(type) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const legs = []; let armR = null, height = 1.9;
  const straw = 0xd6b56a, wood = 0x7a4f2e, stone = 0x8b8f99, cloth = 0x9f1d1d;
  if (type === 'tdummy' || type === 'tmover') { // a straw dummy on a post (a mover wears a blue sash)
    box(0.18, 1.1, 0.18, wood, 0, 0.55, 0, body);
    box(0.7, 0.85, 0.4, straw, 0, 1.45, 0, body);
    box(1.3, 0.14, 0.14, wood, 0, 1.6, 0, body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), mat(straw)); head.position.set(0, 2.05, 0); body.add(head);
    box(0.74, 0.16, 0.44, type === 'tmover' ? 0x2563eb : cloth, 0, 1.2, 0, body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 12), mat(0xb91c1c)); ring.position.set(0, 1.5, 0.22); body.add(ring); // the target mark
    height = 2.3;
  } else if (type === 'tgolem' || type === 'tcaster') { // stacked stone with a glowing rune (a caster's is violet)
    const rune = type === 'tcaster' ? 0xa855f7 : 0xfbbf24;
    legs.push(box(0.5, 0.9, 0.5, stone, -0.38, 0.45, 0, body), box(0.5, 0.9, 0.5, stone, 0.38, 0.45, 0, body));
    box(1.5, 1.2, 0.9, stone, 0, 1.5, 0, body);
    box(0.8, 0.6, 0.7, 0x9ca3af, 0, 2.4, 0, body);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: rune })); eye.position.set(0, 2.45, 0.36); body.add(eye);
    const glyph = new THREE.Mesh(new THREE.CircleGeometry(0.22, 6), new THREE.MeshBasicMaterial({ color: rune })); glyph.position.set(0, 1.55, 0.46); body.add(glyph);
    armR = new THREE.Group(); armR.position.set(0.95, 2.0, 0); body.add(armR);
    box(0.4, 1.2, 0.4, stone, 0, -0.5, 0, armR);
    const armL = new THREE.Group(); armL.position.set(-0.95, 2.0, 0); body.add(armL);
    box(0.4, 1.2, 0.4, stone, 0, -0.5, 0, armL);
    height = 2.9;
  } else { // twolf: a wolf of straw and cloth
    box(0.6, 0.6, 1.5, straw, 0, 0.95, 0, body);
    const head = box(0.48, 0.45, 0.6, 0xc8a55c, 0, 1.2, 0.95, body);
    box(0.26, 0.2, 0.3, wood, 0, -0.1, 0.42, head);
    for (const sx of [-1, 1]) box(0.12, 0.26, 0.08, wood, sx * 0.16, 0.32, -0.05, head);
    box(0.62, 0.14, 0.4, cloth, 0, 1.1, 0.4, body); // a red training collar
    for (const [x, z] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) legs.push(box(0.15, 0.7, 0.15, wood, x, 0.35, z, body));
    height = 1.8;
  }
  const cursor = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.2; g.add(cursor);
  const mats = [];
  g.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) mats.push(o.material); });
  return { group: g, body, legs, armR, cursor, mats, height };
}

// ---------- scenery ----------
function buildHall(scene, occluders) { // a small stone hall with a slate roof, a door to the square and a crest
  const g = new THREE.Group();
  const stoneC = 0xb8b2a4, trim = 0x6b5b45, roofC = 0x3f4a5c;
  box(6.2, 3.4, 5.2, stoneC, 0, 1.7, 0, g);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.6, 2.2, 4, 1), mat(roofC)); roof.position.y = 4.5; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.85); roof.castShadow = true; g.add(roof);
  box(1.6, 2.4, 0.2, 0x3b2a1a, 0, 1.2, 2.62, g); // door
  for (const sx of [-1, 1]) { box(0.5, 3.6, 0.5, trim, sx * 2.9, 1.8, 2.45, g); box(0.9, 0.9, 0.1, 0x93c5fd, sx * 1.9, 2.2, 2.62, g); } // pillars, windows
  box(6.6, 0.4, 0.6, trim, 0, 3.55, 2.45, g); // lintel
  const crest = new THREE.Mesh(new THREE.CircleGeometry(0.55, 6), mat(0xe9b949, { emissive: 0xb45309, emissiveIntensity: 0.5 })); crest.position.set(0, 3.0, 2.73); g.add(crest);
  const sword = box(0.08, 0.9, 0.04, 0xe5e7eb, 0, 3.0, 2.76, g); sword.rotation.z = 0.5;
  const staff = box(0.06, 0.9, 0.04, 0x7a4f2e, 0, 3.0, 2.76, g); staff.rotation.z = -0.5;
  box(3.2, 0.2, 1.6, 0x8b8f99, 0, 0.1, 3.4, g); // the step
  // two straw dummies by the door
  for (const sx of [-1, 1]) { const d = makeAcademyMob('tdummy'); d.cursor.visible = false; d.group.position.set(sx * 3.9, 0, 3.6); d.group.scale.setScalar(0.8); g.add(d.group); }
  g.position.set(ACADEMY.x, 0, ACADEMY.z);
  g.rotation.y = Math.atan2(-ACADEMY.x, -ACADEMY.z); // the door faces the square
  scene.add(g); occluders?.push(g);
  return g;
}
function buildLectern(scene) { // a dusty reading stand against the hall's back wall, an open book on it
  const g = new THREE.Group(), wood = 0x5b3a22;
  box(0.16, 1.05, 0.16, wood, 0, 0.52, 0, g);
  box(0.6, 0.06, 0.45, wood, 0, 0.02, 0, g);
  const top = box(0.75, 0.06, 0.55, wood, 0, 1.08, 0, g); top.rotation.x = -0.35;
  const book = box(0.6, 0.05, 0.42, 0xe7dcc0, 0, 1.13, 0.02, g); book.rotation.x = -0.35;
  g.position.set(LECTERN.x, 0, LECTERN.z);
  g.rotation.y = Math.atan2(LECTERN.x, LECTERN.z); // (faces away from the hall)
  scene.add(g);
  return g;
}
function buildYard(scene) { // each pen: sand floor, a low stone wall round it, posts at the corners
  const g = new THREE.Group(), S = YARD.size;
  const floorM = mat(0xc9b48a), wallM = mat(0x8d8577), postM = mat(0x6b4f33);
  for (const pen of PENS) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(S + 4, S + 4), floorM); f.rotation.x = -Math.PI / 2; f.position.set(pen.cx, 0.02, pen.cz); f.receiveShadow = true; g.add(f);
    for (const [w, d, x, z] of [[S + 4, 1, pen.cx, pen.z0 - 1], [S + 4, 1, pen.cx, pen.z1 + 1], [1, S + 4, pen.x0 - 1, pen.cz], [1, S + 4, pen.x1 + 1, pen.cz]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, YARD.wall, d), wallM); m.position.set(x, YARD.wall / 2, z); m.castShadow = true; g.add(m);
    }
    for (const [x, z] of [[pen.x0 - 1, pen.z0 - 1], [pen.x1 + 1, pen.z0 - 1], [pen.x0 - 1, pen.z1 + 1], [pen.x1 + 1, pen.z1 + 1]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, YARD.wall + 1.2, 1.4), postM); p.position.set(x, (YARD.wall + 1.2) / 2, z); g.add(p);
    }
  }
  scene.add(g);
  return g;
}
function buildPost() { // the Ward Post: a padded post with a banner
  const g = new THREE.Group();
  box(0.35, 2.2, 0.35, 0x7a4f2e, 0, 1.1, 0, g);
  box(0.9, 1.0, 0.5, 0xd6b56a, 0, 1.6, 0, g);
  box(0.06, 1.2, 0.9, 0x2563eb, 0.5, 1.7, 0, g);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.6, 32), new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  g.visible = false;
  return g;
}
function buildFallen() { // the fallen dummy, lying down, with a revive ring
  const g = new THREE.Group();
  const d = makeAcademyMob('tdummy'); d.cursor.visible = false; d.group.rotation.z = Math.PI / 2; d.group.position.y = 0.3; g.add(d.group);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.6, 40), new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  g.visible = false;
  return g;
}

const CSS = `
#academy { position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 44px); left: 50%; transform: translateX(-50%); width: min(560px, calc(94vw / var(--ui-scale))); max-height: calc(100vh / var(--ui-scale) - 140px); display: flex; flex-direction: column; padding: 12px 14px; font-size: 13px; z-index: 3; border-color: rgba(233,185,73,.55); }
#academy.hidden { display: none; }
#academy .top { display: flex; justify-content: space-between; align-items: center; font-weight: 800; font-size: 16px; letter-spacing: .1em; color: #fde68a; }
#academy .x { padding: 2px 9px; border-radius: 6px; border: 1px solid rgba(160,200,255,.3); background: transparent; }
#academy .body { overflow: auto; min-height: 0; flex: 1; }
#academy .me { display: flex; gap: 10px; align-items: center; margin: 6px 0 4px; padding: 8px 10px; border-radius: 10px; background: rgba(233,185,73,.08); border: 1px solid rgba(233,185,73,.25); }
#academy .me b { font-size: 15px; } #academy .me small { opacity: .75; display: block; }
#academy .rank { margin-left: auto; text-align: right; } #academy .rank b { color: #fde68a; }
#academy h4 { margin: 12px 0 5px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #fcd34d; opacity: .9; }
#academy .row { display: flex; gap: 8px; align-items: center; padding: 6px 4px; border-bottom: 1px solid rgba(255,255,255,.06); }
#academy .row .nm { flex: 1; min-width: 0; } #academy .row .nm small { display: block; opacity: .65; font-size: 11px; line-height: 1.3; }
#academy .row button, #academy .wpns button { padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(233,185,73,.45); background: rgba(233,185,73,.1); font-size: 12px; font-weight: 700; white-space: nowrap; }
#academy .row button.go { background: rgba(34,197,94,.18); border-color: rgba(34,197,94,.6); }
#academy .row button.warn { background: rgba(239,68,68,.22); border-color: rgba(239,68,68,.7); }
#academy button:disabled { opacity: .4; }
#academy .wpns { display: flex; flex-wrap: wrap; gap: 6px; } #academy .wpns button.on { background: rgba(233,185,73,.35); border-color: #fde68a; }
#academy .md, #trialhud .md { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--mc); color: #111; font-size: 10px; font-weight: 900; margin-right: 6px; flex: none; }
#academy .note { font-size: 11px; opacity: .6; margin: 4px 0; }
#trialhud { position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 64px); left: 50%; transform: translateX(-50%); z-index: 4; min-width: 240px; padding: 8px 14px; border-radius: 12px; background: rgba(15,18,30,.82); border: 1px solid rgba(233,185,73,.55); text-align: center; font: 600 13px/1.35 system-ui, sans-serif; color: #f8fafc; pointer-events: auto; }
#trialhud.hidden { display: none; }
#trialhud .t { font-weight: 800; letter-spacing: .08em; color: #fde68a; }
#trialhud .big { font-size: 26px; font-weight: 900; }
#trialhud .bar { height: 7px; border-radius: 4px; background: rgba(255,255,255,.12); overflow: hidden; margin: 4px 0; } #trialhud .bar i { display: block; height: 100%; background: #60a5fa; }
#trialhud .tiers { display: flex; justify-content: center; gap: 10px; font-size: 11px; opacity: .8; }
#trialhud button { margin-top: 4px; padding: 3px 10px; border-radius: 7px; border: 1px solid rgba(255,255,255,.3); background: transparent; font-size: 11px; }
.lbl.npc.academy { color: #fde68a; }
#academy .spec { margin: 4px 0; } #academy .spec .sig { display: block; font-size: 11px; color: #fde68a; opacity: .9; margin-top: 2px; }
#academy .row.on { background: rgba(233,185,73,.1); border-radius: 8px; }
#academy .hb { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
#create .wpn { text-align: left; } #create .wpn .leads { display: block; font-size: 11px; opacity: .7; margin-top: 3px; }
#create .dev-cls h5 { margin: 10px 0 4px; font-size: 11px; opacity: .6; font-weight: 600; letter-spacing: .04em; }
`;

export function createAcademy({ scene, occluders, state, send, project, sfx, banner, callout, log, $, tip = () => {} }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  buildHall(scene, occluders);
  buildYard(scene);
  buildLectern(scene);
  const post = buildPost(), fallen = buildFallen(); scene.add(post, fallen);
  const panel = document.createElement('div'); panel.id = 'academy'; panel.className = 'panel hidden'; panel.dataset.nav = 'academy';
  $('bag').parentNode.appendChild(panel);
  const hud = document.createElement('div'); hud.id = 'trialhud'; hud.className = 'hidden';
  $('hud').appendChild(hud);
  const lbl = document.createElement('div'); lbl.className = 'lbl npc academy'; lbl.style.display = 'none';
  $('labels').appendChild(lbl);
  const postLbl = document.createElement('div'); postLbl.className = 'lbl npc'; postLbl.style.display = 'none';
  $('labels').appendChild(postLbl);
  const ui = { confirm: '', html: '', ac: null, hb: { c: 0, s: 0, b: 0 } };

  const A = () => state.academy || null; // the last `path` message
  const ini = () => !!A()?.ini;
  const inTrial = () => !!ui.ac; // a trial or drill is running (me.ac): interact opens the panel with Leave (pad-reachable)
  const near = () => !state.dead && !state.spectator && (nearAcademy(state.x, state.z, 0.5) || inTrial());
  const isOpen = () => !panel.classList.contains('hidden');
  function toggle(open = !isOpen()) {
    panel.classList.toggle('hidden', !open);
    if (open) { ui.confirm = ''; ui.html = ''; send({ type: 'academy', op: 'state' }); render(); sfx?.play('ui'); }
  }

  // ---------- HUD helpers for main.js ----------
  const kitPath = () => (ini() ? { stage: 'initiate' } : null);
  const name = i => kitName(kitPath(), state.cls, i); // an Initiate's plain skill names (null: the normal ones)
  const locked = i => ini() && i === INITIATE.lockedSlot;
  const spec = () => A()?.spec || null; // specialisation (server/subclasses.js specMsg)
  const label = () => (ini() ? `Initiate · ${WEAPONS[A().path?.weapon]?.name || ''}` : subName(spec()?.sub) || CLASSES[state.cls]?.name || '');
  // Roster rows: "Initiate · Sword", else the subclass (or class) with its rank from Adept up.
  const rosterLabel = r => (r?.ini ? `Initiate · ${WEAPONS[r.ini]?.name || ''}` : `${r?.rk ? `${rankName(r.rk)} ` : ''}${buildName(r?.bt, subName(r?.sub) || CLASSES[r?.cls]?.name || '')}`); // "Swift Duelist": the build's leading tag (docs/briefs/path.md)
  const plateTag = r => {
    if (r?.ini) return ' <small class="ttl" style="color:#fde68a">Initiate</small>';
    const t = [r?.rk ? rankName(r.rk) : '', subName(r?.sub)].filter(Boolean).join(' ');
    return t ? ` <small class="ttl" style="color:#fde68a">${esc(t)}</small>` : '';
  };
  // Slot 5 (main.js): the signature skill { id, name, desc, cd, aim, anim }, or null before a specialisation.
  const sig = () => (!ini() && !A()?.loan ? spec()?.sig || null : null);
  const SIG_ANIM = Object.fromEntries(Object.values(SUBCLASSES).map(S => [S.skill.id, S.skill.anim]));
  const sigAnim = id => SIG_ANIM[id] || null;
  const atLectern = () => !state.dead && !state.spectator && state.joined && !inTrial() && nearLectern(state.x, state.z);
  const readLectern = () => { send({ type: 'academy', op: 'lectern' }); sfx?.play('ui'); };

  // ---------- the panel ----------
  function render() {
    if (!isOpen()) return;
    const a = A(), P = a?.path, lvl = state.lvl || 1, gold = state.inv?.gold ?? state.gold ?? 0;
    let h = `<div class="top"><span>THE ACADEMY</span><button class="x" data-a="close" data-nav="back">✕</button></div><div class="body">`;
    if (!a) { panel.innerHTML = h + '<p class="note">Opening the doors…</p></div>'; return; }
    if (inTrial()) { // in the yard: only the goal and a way out
      const ac = ui.ac;
      h += `<h4>${esc(ac.n || '')}</h4><p class="note">Bronze / Silver / Gold: ${(ac.tiers || []).join(' / ')}${esc(ac.u || '')}. Walking out of the pen leaves it too.</p>
        <div class="row"><span class="nm"><b>Give up</b><small>No medal; you go back to the Academy's door.</small></span><button class="warn" data-a="leave">Leave the ${esc(ac.k === 'drill' ? 'drill' : 'trial')}</button></div></div>`;
      if (h !== ui.html) panel.innerHTML = ui.html = h;
      return;
    }
    const rk = a.rank | 0, pts = medalPoints(P), nextR = RANKS[rk + 1];
    h += `<div class="me"><div><b>${esc(label())}</b><small>Level ${lvl}${P?.stage === 'initiate' ? ` · trials open at level ${INITIATE.trialLvl}` : ''}</small></div>
      <div class="rank"><small>Class rank</small><b>${esc(rankName(rk))}</b><small>${pts} medal pts${nextR ? ` · ${esc(nextR.name)} at ${nextR.pts}${nextR.floors ? ` + ${nextR.floors} floor${nextR.floors > 1 ? 's' : ''}` : ''}` : ''}</small></div></div>`;
    if (a.trial) h += `<p class="note">A ${a.trial.kind} is running.</p>`;
    if (ini()) {
      h += `<h4>Armory: your weapon</h4><div class="wpns">${WEAPON_IDS.map(w => `<button data-a="weapon" data-w="${w}" class="${P?.weapon === w ? 'on' : ''}" title="${esc(WEAPONS[w].blurb)}">${esc(WEAPONS[w].name)}</button>`).join('')}</div>
        <p class="note">Free while you are an Initiate. Your weapon decides which trials you can take: ${esc(WEAPONS[P.weapon].leads.map(c => CLASSES[c].name).join(', '))}.</p>`;
    }
    const classes = ini() ? WEAPONS[P.weapon].leads : CLASS_IDS;
    h += '<h4>Class trials</h4>';
    for (const cls of classes) {
      const T = TRIALS[cls], m = P?.trials?.[cls] | 0, why = trialBlock(ini() ? P : null, cls, lvl), cur = !ini() && state.cls === cls;
      let act = `<button data-a="trial" data-id="${cls}" ${why || a.trial ? 'disabled' : ''} title="${esc(why || 'A loaned kit: try the class before you commit')}">Take trial</button>`;
      if (m && ini()) act += ui.confirm === cls ? `<button class="warn" data-a="graduate" data-id="${cls}">Confirm: become a ${esc(CLASSES[cls].name)}</button>` : `<button class="go" data-a="askgrad" data-id="${cls}">Graduate</button>`;
      else if (m && !cur) { const fee = changeFee(lvl); act += ui.confirm === cls ? `<button class="warn" data-a="change" data-id="${cls}">Confirm (${fee}g)</button>` : `<button data-a="askchange" data-id="${cls}" ${gold < fee ? 'disabled' : ''} title="Mastery and talents stay with each class">Change class · ${fee}g</button>`; }
      h += `<div class="row">${medalDot(m)}<span class="nm"><b style="color:${hex(CLASSES[cls].color)}">${esc(CLASSES[cls].name)}</b> · ${esc(T.name)}${cur ? ' <small style="display:inline">(your class)</small>' : ''}<small>${esc(T.goal)} Bronze / Silver / Gold: ${T.tiers.join(' / ')}${esc(T.unit)}.</small></span>${act}</div>`;
    }
    h += specHtml(a, lvl, gold);
    h += `<h4>Drills</h4><p class="note">Open to everyone. Each medal pays once: ${DRILL_REWARD.slice(1).map((r, i) => `${MEDALS[i + 1]} ${r.gold}g${r.cons ? ' + ' + Object.keys(r.cons).join(', ') : ''}`).join(' · ')}.</p>`;
    for (const id of DRILL_IDS) {
      const D = DRILLS[id], m = P?.drills?.[id] | 0;
      h += `<div class="row">${medalDot(m)}<span class="nm"><b>${esc(D.name)}</b><small>${esc(D.goal)} ${D.tiers.join(' / ')}${esc(D.unit)}.</small></span><button data-a="drill" data-id="${id}" ${a.trial ? 'disabled' : ''}>Start</button></div>`;
    }
    h += '<h4>The halls</h4>';
    const heads = [...new Set(classes.map(c => HEADS[c]).filter(Boolean))];
    for (const id of heads) h += `<div class="row"><span class="nm"><b>${esc(headName(id))}</b><small>Heads the ${esc(classes.filter(c => HEADS[c] === id).map(c => CLASSES[c].name).join(' and '))} hall.</small></span><button data-a="talk" data-id="${classes.find(c => HEADS[c] === id)}">Talk</button></div>`;
    if (P?.enrolled || P?.cohort?.length) h += `<h4>Classmates</h4><div class="row"><span class="nm">${esc((P.cohort || []).join(', ') || 'None yet')}<small>Your two bot classmates level with you and graduate with you.</small></span><button data-a="cohort">Call them</button></div>`;
    h += '</div>';
    if (h !== ui.html) { panel.innerHTML = ui.html = h; }
  }
  // ---------- Specialise (level 15+) ----------
  function specHtml(a, lvl, gold) {
    const S = a.spec;
    if (ini() || !S) return '';
    if (lvl < S.lvl) return `<h4>Specialise</h4><p class="note">At level ${S.lvl} you choose one of your class's two specialisations: two new talents and a signature skill for a 5th slot.</p>`;
    let h = `<h4>Specialise</h4><p class="note">${S.sub ? `Changing costs ${S.fee}g.` : 'Your first choice is free.'} Each one adds two talents to its branch of your tree and a signature skill (slot 5, ${tapping() ? 'its button' : keyHtml('skill4')}).</p>`;
    for (const id of S.opts) {
      const D = SUBCLASSES[id], cur = S.sub === id, sk = D.skill;
      let act = '';
      if (!cur) act = ui.confirm === `s:${id}` ? `<button class="warn" data-a="spec" data-id="${id}">Confirm${S.sub ? ` (${S.fee}g)` : ''}</button>` : `<button class="go" data-a="askspec" data-id="${id}" ${S.sub && gold < S.fee ? 'disabled' : ''}>${S.sub ? `Change · ${S.fee}g` : 'Specialise'}</button>`;
      h += `<div class="row spec ${cur ? 'on' : ''}"><span class="nm"><b>${esc(D.name)}</b> · ${esc(branchName(D.cls, D.branch))} branch${cur ? ' <small style="display:inline">(yours)</small>' : ''}<small>${esc(D.blurb)}</small><span class="sig">${esc(sk.name)} (${sk.cd} s): ${esc(sk.desc)}</span></span>${act}</div>`;
    }
    const H = S.hid; // (an extra row the server sends to some characters: every word of it comes from the server)
    if (H && H.from?.length) {
      const hb = ui.hb, F = H.from[hb.c % H.from.length], sk = F.skills[hb.s % F.skills.length], br = F.branches[hb.b % F.branches.length];
      const cur = H.on && H.on.c === F.cls && H.on.sk === sk.id && H.on.br === br.id;
      h += `<div class="row spec ${H.on ? 'on' : ''}"><span class="nm"><b>${esc(H.name)}</b>${H.on ? ' <small style="display:inline">(yours)</small>' : ''}<small>${esc(H.text)}</small>
        <span class="hb"><button data-a="hb" data-k="c">${esc(F.name)} ▸</button><button data-a="hb" data-k="s">${esc(sk.name)} ▸</button><button data-a="hb" data-k="b">${esc(br.name)} ▸</button></span></span>
        ${cur ? '' : ui.confirm === 'h' ? `<button class="warn" data-a="hid" data-c="${F.cls}" data-s="${sk.id}" data-b="${br.id}">Confirm${S.sub || H.on ? ` (${S.fee}g)` : ''}</button>` : `<button class="go" data-a="askhid" ${(S.sub || H.on) && gold < S.fee ? 'disabled' : ''}>Choose</button>`}</div>`;
    }
    return h;
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const a = b.dataset.a, id = b.dataset.id;
    sfx?.play('ui');
    if (a === 'close') return toggle(false);
    if (a === 'leave') { send({ type: 'academy', op: 'leave' }); return toggle(false); }
    if (a === 'askgrad' || a === 'askchange') { ui.confirm = id; return render(); }
    if (a === 'askspec') { ui.confirm = `s:${id}`; return render(); }
    if (a === 'askhid') { ui.confirm = 'h'; return render(); }
    if (a === 'hb') { const k = b.dataset.k; ui.hb[k]++; if (k === 'c') ui.hb.s = ui.hb.b = 0; ui.confirm = ''; return render(); }
    ui.confirm = '';
    if (a === 'weapon') send({ type: 'academy', op: 'weapon', w: b.dataset.w });
    else if (a === 'trial' || a === 'drill') send({ type: 'academy', op: a, id });
    else if (a === 'graduate' || a === 'change') send({ type: 'academy', op: a, cls: id });
    else if (a === 'talk') send({ type: 'academy', op: 'talk', cls: id });
    else if (a === 'cohort') send({ type: 'academy', op: 'cohort' });
    else if (a === 'spec') send({ type: 'academy', op: 'specialise', sub: id });
    else if (a === 'hid') send({ type: 'academy', op: 'specialise', sub: state.academy?.spec?.hid?.id, borrow: { c: b.dataset.c, sk: b.dataset.s, br: b.dataset.b } });
    render();
  });
  hud.addEventListener('click', e => { if (e.target.closest('[data-a=leave]')) send({ type: 'academy', op: 'leave' }); });

  // ---------- messages, events, the snapshot ----------
  function onMessage(msg) {
    if (msg.type !== 'path') return false;
    state.academy = msg;
    if (!ini() && msg.spec && !msg.spec.sub && (state.lvl | 0) >= msg.spec.lvl) tip('spec'); // a graduate who can specialise
    ui.html = '';
    render();
    return true;
  }
  function event(e) {
    if (e.t === 'trial' && e.id === state.myId) {
      if (e.op === 'start') { toggle(false); banner(e.n.toUpperCase(), e.goal); sfx?.play('ui'); tip('trial'); }
      else if (e.op === 'end') {
        if (e.medal) { banner(`${MEDALS[e.medal].toUpperCase()} MEDAL`, `${e.n}: ${e.sc}${e.pass ? ' · trial passed' : ''}`); sfx?.play('levelup'); }
        else if (e.result !== 'quit') callout(`${e.n}: not passed`, e.why || '', 'warn');
      } else if (e.op === 'open') { banner('CLASS TRIALS OPEN', 'Visit the Academy in the Town of Beginnings'); tip('academy'); }
      return true;
    }
    if (e.t === 'spec' && e.id === state.myId) {
      if (e.found) { banner('A NEW CHOICE', 'Open the Academy\'s Specialise section'); sfx?.play('levelup'); }
      else { banner(String(e.n || e.hn || '').toUpperCase(), e.n ? 'Your signature skill is in slot 5; two new talents wait in your tree' : e.hs || ''); sfx?.play('levelup'); } // (hn / hs: the server's words for a pick it never lists)
      return true;
    }
    if (e.t === 'grad' && e.id === state.myId) {
      banner(e.change ? 'NEW CLASS' : 'GRADUATED', `You are a ${CLASSES[e.cls]?.name || ''}${e.change ? '' : ': full skills, full power, your talent tree is open'}`);
      sfx?.play('levelup');
      return true;
    }
    return false;
  }
  function snapMe(me) { ui.ac = me?.ac || null; }

  // ---------- every frame ----------
  function frame() {
    const lp = project(ACADEMY.x, 5.6, ACADEMY.z), d = Math.hypot(state.x - ACADEMY.x, state.z - ACADEMY.z);
    if (lp && d < 24 && state.joined) {
      lbl.style.display = ''; lbl.style.left = `${lp[0]}px`; lbl.style.top = `${lp[1]}px`;
      const html = `The Academy${near() ? `<br><small>${tapping() ? 'tap Enter' : `press ${keyHtml('interact')} to enter`}</small>` : ''}`;
      if (lbl.innerHTML !== html) lbl.innerHTML = html;
    } else lbl.style.display = 'none';
    if (isOpen() && !near()) toggle(false);
    const ac = ui.ac;
    post.visible = !!(ac && ac.w !== undefined); fallen.visible = !!(ac && ac.fx !== undefined);
    if (post.visible) post.position.set(ac.wx, 0, ac.wz);
    if (fallen.visible) fallen.position.set(ac.fx, 0, ac.fz);
    const pp = post.visible ? project(ac.wx, 3.2, ac.wz) : fallen.visible ? project(ac.fx, 1.6, ac.fz) : null;
    if (pp) {
      postLbl.style.display = ''; postLbl.style.left = `${pp[0]}px`; postLbl.style.top = `${pp[1]}px`;
      const html = post.visible ? `Ward Post <b>${ac.w}%</b>` : `Fallen dummy ${Math.round((ac.rv || 0) * 100)}%`;
      if (postLbl.innerHTML !== html) postLbl.innerHTML = html;
    } else postLbl.style.display = 'none';
    hud.classList.toggle('hidden', !ac);
    if (ac) {
      const tiers = ac.tiers.map((t, i) => `<span>${medalDot(i + 1)}${t}${esc(ac.u)}</span>`).join('');
      const main = ac.cd > 0 ? `<div class="big">${Math.ceil(ac.cd)}</div>` : `<div class="big">${ac.low && ac.u === 's' ? ac.el.toFixed(0) + ' s' : `${ac.sc}${esc(ac.u)}`}</div><div>${Math.ceil(ac.left)} s left</div>`;
      const bar = ac.w !== undefined ? `<div class="bar"><i style="width:${ac.w}%"></i></div>` : ac.rv !== undefined ? `<div class="bar"><i style="width:${Math.round(ac.rv * 100)}%;background:#86efac"></i></div>` : '';
      const html = `<div class="t">${esc(ac.n.toUpperCase())}</div>${main}${bar}<div class="tiers">${tiers}</div><button data-a="leave">Leave</button>`;
      if (hud._h !== html) { hud._h = html; hud.innerHTML = html; }
    }
  }

  return { near, inTrial, toggle, isOpen, render, onMessage, event, snapMe, frame, name, locked, label, rosterLabel, plateTag, sig, sigAnim, atLectern, readLectern, spec };
}

// ---------- the creation screen: weapon cards ----------
export function weaponCards(chosen) {
  return WEAPON_IDS.map(w => {
    const W = WEAPONS[w];
    return `<button class="cls wpn ${w === chosen ? 'sel' : ''}" data-w="${w}"><span class="role">Initiate</span><b>${esc(W.name)}</b><p>${esc(W.blurb)}<span class="leads">Leads to: ${esc(W.leads.map(c => CLASSES[c].name).join(', '))}</span></p></button>`;
  }).join('');
}
