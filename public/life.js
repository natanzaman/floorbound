// Life classes (plan: docs/briefs/life-classes.md): the gathering spots, the town's Life Hall, cooking fire, alchemy
// bench and garden (simple markers: graphics are on hold), the prompts, the gathering bar and the Life panel (#life:
// Skills, Garden, Cooking, Alchemy, Meals). The server decides everything (server/life.js); this only draws and asks.
import * as THREE from 'three';
import {
  LIFE_SKILLS, LIFE_SKILL_IDS, LIFE_MAX, lifeProgress, SPOTS, SPOT_TYPES, SPOT_KINDS, nearSpot, STATIONS, LIFE_HALL, COOK_FIRE,
  ALCH_BENCH, GARDEN, TILE_OFFSETS, PLOT_TILES, CROPS, CROP_IDS, LIFE_RECIPES, STATION_OF, FOODS, foodText, nearStation,
} from '/shared/life.js';
import { MATS } from '/shared/crafting.js';
import { CONSUMABLES } from '/shared/items.js';
import { keyHtml, tapping } from '/keyname.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts });
const TABS = [['skills', 'Skills'], ['garden', 'Garden'], ['cook', 'Cooking'], ['brew', 'Alchemy'], ['meals', 'Meals']];
const STATION_TAB = { hall: 'skills', garden: 'garden', cook: 'cook', brew: 'brew' };
const fmt = s => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.max(0, Math.round(s))}s`);
const matName = id => MATS[id]?.name || CONSUMABLES[id]?.name || id;

// ---------- scenery (simple shapes) ----------
function spotMesh(s) {
  const T = SPOT_TYPES[s.type], col = new THREE.Color(MATS[T.yields[0][0]]?.color || '#fff'), g = new THREE.Group();
  if (T.kind === 'herb') {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26, c = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 5), mat(i % 2 ? 0x3f8f46 : col, i % 2 ? {} : { emissive: col, emissiveIntensity: 0.35 }));
      c.position.set(Math.cos(a) * 0.45, 0.35, Math.sin(a) * 0.45); g.add(c);
    }
  } else if (T.kind === 'ore') {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), mat(0x6b6f76)); rock.position.y = 0.45; rock.scale.set(1.2, 0.8, 1); g.add(rock);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), mat(col, { emissive: col, emissiveIntensity: 0.5 })); c.position.set(-0.4 + i * 0.4, 0.85 + (i % 2) * 0.1, 0.35); g.add(c); }
  } else {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), mat(0x2b6ea3, { emissive: 0x0b2a44, emissiveIntensity: 0.5 })); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04; g.add(pool);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 20), mat(0x8a8d91)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), mat(0xef4444, { emissive: 0x7f1d1d })); bob.position.set(0.5, 0.1, 0.2); g.add(bob); g.userData.bob = bob;
  }
  if (T.rare) { const glow = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 4, 20), mat(0xfde68a, { emissive: 0xfbbf24, emissiveIntensity: 1 })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.1; g.add(glow); }
  g.position.set(s.x, 0, s.z);
  return g;
}

function buildTown(root) {
  const wood = mat(0x7a4f2e), stone = mat(0x6f6a73), out = {};
  { // the Life Hall: a small open booth with a green roof and a sign
    const g = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 3), stone); floor.position.y = 0.08; g.add(floor);
    for (const [x, z] of [[-1.6, -1.3], [1.6, -1.3], [-1.6, 1.3], [1.6, 1.3]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), wood); p.position.set(x, 1.3, z); g.add(p); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.3, 4), mat(0x2f7d4a)); roof.position.y = 3.2; roof.rotation.y = Math.PI / 4; g.add(roof);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.6), wood); desk.position.set(0, 0.55, 0.6); g.add(desk);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.2), mat([0x86efac, 0xcbd5e1, 0x7dd3fc, 0xfacc15][i])); b.position.set(-0.7 + i * 0.46, 1.18, 0.6); g.add(b); }
    g.position.set(LIFE_HALL.x, 0, LIFE_HALL.z); g.rotation.y = Math.atan2(-LIFE_HALL.x, -LIFE_HALL.z);
    root.add(g); out.hall = g;
  }
  { // the cooking fire: a ring of stones, a flame and a pot on a tripod
    const g = new THREE.Group();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone); s.position.set(Math.cos(a) * 0.75, 0.15, Math.sin(a) * 0.75); g.add(s); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 6), mat(0xf97316, { emissive: 0xff5a00, emissiveIntensity: 1.4 })); flame.position.y = 0.5; g.add(flame); out.flame = flame;
    for (let i = 0; i < 3; i++) { const a = i * 2.09, l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 4), wood); l.position.set(Math.cos(a) * 0.5, 0.9, Math.sin(a) * 0.5); l.lookAt(0, 3, 0); l.rotateX(Math.PI / 2); g.add(l); }
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat(0x27272a, { metalness: 0.5 })); pot.position.y = 1.15; g.add(pot);
    g.position.set(COOK_FIRE.x, 0, COOK_FIRE.z); root.add(g);
  }
  { // the alchemy bench: a table of bottles
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1), wood); top.position.y = 0.95; g.add(top);
    for (const [x, z] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), wood); l.position.set(x, 0.45, z); g.add(l); }
    [0xef4444, 0xc084fc, 0x22c55e, 0x38bdf8].forEach((c, i) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.4, 8), mat(c, { emissive: c, emissiveIntensity: 0.4 })); b.position.set(-0.75 + i * 0.5, 1.21, 0); g.add(b); });
    g.position.set(ALCH_BENCH.x, 0, ALCH_BENCH.z); g.rotation.y = Math.atan2(-ALCH_BENCH.x, -ALCH_BENCH.z); root.add(g);
  }
  { // the garden: soil tiles in a low fence; each tile's crop (your own) is a cone that grows
    const g = new THREE.Group();
    out.crops = [];
    TILE_OFFSETS.forEach(([dx, dz]) => {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.8), mat(0x5b3a1e)); soil.position.set(dx, 0.06, dz); g.add(soil);
      const crop = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 6), mat(0x4ade80)); crop.position.set(dx, 0, dz); crop.visible = false; g.add(crop);
      out.crops.push(crop);
    });
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), wood); p.position.set(Math.cos(a) * 3.6, 0.35, Math.sin(a) * 3.1); g.add(p); }
    g.position.set(GARDEN.x, 0, GARDEN.z); root.add(g);
  }
  return out;
}

export function createLife({ scene, floor1, send, state, project, log, sfx, guide, $, openPanel }) {
  const town = buildTown(floor1);
  const spotMeshes = SPOTS.map(s => { const m = spotMesh(s); m.visible = false; scene.add(m); return m; });
  const panel = document.createElement('div'); panel.id = 'life'; panel.className = 'panel hidden'; panel.dataset.nav = 'life'; // (pad-driven: public/focusnav.js)
  $('bag').parentNode.appendChild(panel);
  const lbl = document.createElement('div'); lbl.className = 'lbl npc life'; lbl.style.display = 'none'; $('labels').appendChild(lbl);
  const bar = document.createElement('div'); bar.id = 'life-bar'; bar.className = 'hidden'; document.body.appendChild(bar);
  const ui = { tab: 'skills', t: 0, data: null, at: 0, guided: false };

  const L = () => ui.data;
  const since = () => (performance.now() - ui.at) / 1000;
  const lvlOf = id => lifeProgress(L()?.skills?.[id] || 0).lvl;
  const knows = id => !!L()?.learned?.includes(id);
  const have = id => state.inv?.mats?.[id] || 0;
  const isOpen = () => !panel.classList.contains('hidden');
  const spotLeft = id => Math.max(0, (L()?.spots?.[id] || 0) - since());
  const fishing = () => L()?.act?.k === 'fish';

  function toggle(open = !isOpen(), tab) {
    if (tab) ui.tab = tab;
    panel.classList.toggle('hidden', !open);
    if (open) { openPanel?.(); render(); }
  }

  // ---------- prompts and the interact key ----------
  function interactKind() {
    if (state.dead || !state.joined || state.spectator) return null;
    if (L()?.act) return fishing() ? 'life-hook' : null;
    const s = nearSpot(state.x, state.z);
    if (s) return 'life-spot';
    for (const k of Object.keys(STATIONS)) if (nearStation(k, state.x, state.z)) return `life-${k}`;
    return null;
  }
  function interact(k) {
    if (!k?.startsWith('life-')) return false;
    sfx.play('ui');
    if (k === 'life-hook') send({ type: 'life', a: 'hook' });
    else if (k === 'life-spot') { const s = nearSpot(state.x, state.z); if (s) send({ type: 'life', a: 'gather', id: s.id }); }
    else toggle(true, STATION_TAB[k.slice(5)]);
    return true;
  }
  const actLabel = k => ({ 'life-hook': 'Strike', 'life-spot': SPOT_KINDS[SPOT_TYPES[nearSpot(state.x, state.z)?.type]?.kind]?.verb?.replace(/^./, c => c.toUpperCase()) || 'Gather', 'life-hall': 'Learn', 'life-garden': 'Garden', 'life-cook': 'Cook', 'life-brew': 'Brew' }[k] || 'Use');

  // ---------- messages ----------
  function onMsg(m) {
    const was = ui.data?.act;
    ui.data = m; ui.at = performance.now();
    if (was && !m.act) bar.classList.add('hidden');
    render(); renderBar();
  }
  function onEvent(e) {
    if (e.t === 'lifebite' && e.to === state.myId) { sfx.play('ui'); renderBar(); }
    else if (e.t === 'lifelvl' && e.to === state.myId) { sfx.play('levelup'); log(`${LIFE_SKILLS[e.sk]?.name || e.sk} reached level ${e.lvl}.`, 'mat'); }
  }

  // ---------- the gathering bar ----------
  function renderBar() {
    const a = L()?.act;
    if (!a) { bar.classList.add('hidden'); return; }
    const K = SPOT_KINDS[a.k], tap = tapping() ? 'tap Strike' : `press ${keyHtml('interact')}`;
    let h;
    if (a.k === 'fish') h = a.bite ? `<b class="bite">A BITE! ${tap}</b>` : '<b>Fishing…</b> <small>wait for the bite (moving stops it)</small>';
    else { const f = a.secs ? Math.min(1, 1 - Math.max(0, a.left - since()) / a.secs) : 1; h = `<b>${K.doing}…</b><div class="lb"><div style="width:${Math.round(f * 100)}%"></div></div>`; }
    if (bar.innerHTML !== h) bar.innerHTML = h;
    bar.classList.remove('hidden');
  }

  // ---------- the panel ----------
  const btn = (a, label, on, extra = '') => `<button data-a="${a}" ${extra} ${on ? '' : 'disabled'}>${label}</button>`;
  const costHtml = m => Object.entries(m).map(([k, v]) => `<span class="${have(k) >= v ? 'ok' : 'no'}" style="--c:${MATS[k]?.color || '#e5e7eb'}">${v} ${esc(matName(k))} <i>(${have(k)})</i></span>`).join('');
  function tabSkills() {
    const at = nearStation('hall', state.x, state.z);
    let h = `<p class="hint">Life skills level 1–${LIFE_MAX} by doing them, beside your combat class. ${at ? 'Learning is free.' : 'Learn them at the Life Hall in the Town of Beginnings (free).'}</p>`;
    h += LIFE_SKILL_IDS.map(id => {
      const S = LIFE_SKILLS[id], pr = lifeProgress(L()?.skills?.[id] || 0), k = knows(id);
      const fill = pr.need ? Math.round(100 * pr.into / pr.need) : 100;
      return `<div class="it"><span class="slot" style="color:${S.color}">${S.kind}</span><span class="nm"><b style="color:${S.color}">${S.name} ${k ? `<em>Lv ${pr.lvl}</em>` : '<em class="no">not learned</em>'}</b><small>${esc(S.desc)}</small>${k ? `<div class="lb"><div style="width:${fill}%"></div></div><small>${pr.need ? `${pr.into} / ${pr.need} XP` : 'Mastered'}</small>` : ''}</span>${!k ? btn('learn', 'Learn', at, `data-id="${id}"`) : ''}</div>`;
    }).join('');
    return h;
  }
  function tabGarden() {
    const at = nearStation('garden', state.x, state.z), plot = L()?.plot || [];
    let h = `<p class="hint">Your own plot of ${PLOT_TILES} tiles in the town garden: crops grow in real time, even while you're away. Your bots tend it if they're in town by the garden (or ordered: /b tend), and it grows faster.${L()?.tend ? ' <b class="ok">A bot is tending it now.</b>' : ''}${at ? '' : ' Go to the garden to plant and harvest.'}</p>`;
    const seeds = CROP_IDS.filter(c => have(CROPS[c].seed) > 0 && lvlOf('farmer') >= CROPS[c].lvl);
    h += plot.map((t, i) => {
      if (!t) return `<div class="it"><span class="slot">Tile ${i + 1}</span><span class="nm"><b>Empty</b><small>${knows('farmer') ? (seeds.length ? 'Plant:' : 'No seeds you can plant. The merchant sells them.') : 'Learn Farmer at the Life Hall.'}</small></span><span class="btns">${seeds.map(c => btn('plant', `${esc(matName(CROPS[c].seed))} (${have(CROPS[c].seed)})`, at, `data-tile="${i}" data-seed="${CROPS[c].seed}"`)).join('')}</span></div>`;
      const left = Math.max(0, t.left - since()), ripe = left <= 0;
      return `<div class="it"><span class="slot">Tile ${i + 1}</span><span class="nm"><b>${esc(matName(t.c))} ${ripe ? '<em class="ok">ripe</em>' : ''}</b><small>${ripe ? 'Ready to harvest.' : `Ripe in ${fmt(left)}`}</small></span><span class="btns">${ripe ? btn('harvest', 'Harvest', at, `data-tile="${i}"`) : btn('uproot', 'Clear', at, `data-tile="${i}" class="del"`)}</span></div>`;
    }).join('');
    h += `<small class="mats-hint">${CROP_IDS.map(c => `${esc(matName(c))}: Farmer ${CROPS[c].lvl}, ${fmt(CROPS[c].grow / 1000)}`).join(' · ')}</small>`;
    return h;
  }
  function tabMake(skill) {
    const st = STATION_OF[skill], at = nearStation(st, state.x, state.z), S = LIFE_SKILLS[skill], lv = lvlOf(skill);
    let h = `<p class="hint">${esc(S.desc)} ${knows(skill) ? `You are ${S.name} level ${lv}.` : `Learn ${S.name} at the Life Hall first.`}${at ? '' : ` Stand at the ${esc(STATIONS[st].name.toLowerCase())} in town to make these.`}</p>`;
    h += LIFE_RECIPES.filter(r => r.skill === skill).map(r => {
      const outs = [...Object.entries(r.out.mats || {}), ...Object.entries(r.out.cons || {})];
      const name = outs.map(([k, v]) => `${v > 1 ? `${v}× ` : ''}${esc(matName(k))}`).join(' + ');
      const desc = outs.map(([k]) => (FOODS[k] ? foodText(k) : CONSUMABLES[k]?.desc || '')).filter(Boolean).join(' ');
      const can = at && knows(skill) && lv >= r.lvl && Object.entries(r.mats).every(([k, v]) => have(k) >= v);
      return `<div class="it"><span class="slot">Lv ${r.lvl}</span><span class="nm"><b class="${lv >= r.lvl ? '' : 'no'}">${name}</b><small>${esc(desc)}</small><div class="cost">${costHtml(r.mats)}</div></span>${btn('make', skill === 'cook' ? 'Cook' : 'Brew', can, `data-id="${r.id}"`)}</div>`;
    }).join('');
    return h;
  }
  function tabMeals() {
    const f = L()?.food, left = f ? Math.max(0, f.left - since()) : 0;
    let h = `<p class="hint">One meal at a time: eating another replaces it. Meals count down only while you play.</p>`;
    h += f && left > 0 ? `<div class="it on"><span class="slot">now</span><span class="nm"><b>${esc(matName(f.id))}</b><small>${esc(foodText(f.id))} · ${fmt(left)} left</small></span></div>` : '<div class="it empty"><span class="nm"><small>No meal buff right now.</small></span></div>';
    const foods = Object.keys(FOODS).filter(id => have(id) > 0);
    h += foods.length ? foods.map(id => `<div class="it"><span class="slot">meal</span><span class="nm"><b>${esc(matName(id))} ×${have(id)}</b><small>${esc(foodText(id))}</small></span>${btn('eat', 'Eat', !state.dead, `data-id="${id}"`)}</div>`).join('')
      : '<div class="it empty"><span class="nm"><small>No meals. Cook them at the fire in town.</small></span></div>';
    return h;
  }
  function render() {
    if (!isOpen()) return;
    let h = `<div class="top"><span>LIFE SKILLS</span><button class="x" data-a="close">✕</button></div>`;
    h += `<div class="tabs">${TABS.map(([id, name]) => `<button data-a="tab" data-t="${id}" class="${ui.tab === id ? 'on' : ''}">${name}</button>`).join('')}</div>`;
    h += `<div class="body">${!L() ? '<div class="it empty"><span class="nm"><small>…</small></span></div>' : { skills: tabSkills, garden: tabGarden, cook: () => tabMake('cook'), brew: () => tabMake('alchemist'), meals: tabMeals }[ui.tab]()}</div>`;
    const sc = panel.querySelector('.body')?.scrollTop || 0;
    if (panel.innerHTML !== h) { panel.innerHTML = h; const body = panel.querySelector('.body'); if (body) body.scrollTop = sc; }
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = b.dataset.a;
    sfx.play('ui');
    if (a === 'close') return toggle(false);
    if (a === 'tab') { ui.tab = b.dataset.t; return render(); }
    if (a === 'learn' || a === 'make' || a === 'eat') send({ type: 'life', a, id: b.dataset.id });
    if (a === 'plant') send({ type: 'life', a, tile: +b.dataset.tile, seed: b.dataset.seed });
    if (a === 'harvest' || a === 'uproot') send({ type: 'life', a, tile: +b.dataset.tile });
  });

  // ---------- every frame ----------
  let renderT = 0;
  function frame(dt) {
    ui.t += dt;
    if (isOpen() && state.dead) toggle(false);
    if (town.flame) town.flame.scale.y = 1 + Math.sin(ui.t * 9) * 0.12;
    const px = state.x, pz = state.z;
    for (let i = 0; i < SPOTS.length; i++) {
      const s = SPOTS[i], m = spotMeshes[i], d = Math.abs(s.x - px) + Math.abs(s.z - pz);
      m.visible = d < 140;
      if (m.visible) { const gone = spotLeft(s.id) > 0; m.scale.setScalar(gone ? 0.6 : 1); if (m.userData.bob) m.userData.bob.position.y = 0.1 + (fishing() && L().act.id === s.id && L().act.bite ? Math.abs(Math.sin(ui.t * 20)) * -0.08 : Math.sin(ui.t * 2) * 0.03); }
    }
    const plot = L()?.plot || [];
    town.crops.forEach((c, i) => {
      const t = plot[i];
      c.visible = !!t;
      if (!t) return;
      const g = Math.min(1, t.g + (since() * 1000) / (CROPS[t.c]?.grow || 1)), h = 0.25 + g * 0.9;
      c.scale.set(0.5 + g * 0.6, h, 0.5 + g * 0.6); c.position.y = h / 2 + 0.1;
      c.material.color.set(g >= 1 ? (MATS[t.c]?.color || '#facc15') : '#4ade80');
    });
    if (L()?.act) renderBar();
    if (isOpen() && (renderT += dt) > 1) { renderT = 0; render(); } // timers tick
    if (!state.joined || state.spectator) { lbl.style.display = 'none'; return; }
    // the floating label: the nearest spot or station within reach of a prompt
    let best = null, bd = 16;
    for (const s of SPOTS) { const d = Math.hypot(s.x - px, s.z - pz); if (d < bd) { bd = d; best = { s }; } }
    for (const [k, st] of Object.entries(STATIONS)) { const d = Math.hypot(st.x - px, st.z - pz); if (d < bd) { bd = d; best = { k, st }; } }
    if (!best) { lbl.style.display = 'none'; return; }
    const tap = v => (tapping() ? `tap ${v}` : `press ${keyHtml('interact')} to ${v.toLowerCase()}`);
    let html, x, z, y = 2.2;
    if (best.s) {
      const s = best.s, T = SPOT_TYPES[s.type], K = SPOT_KINDS[T.kind], sk = LIFE_SKILLS[K.skill];
      x = s.x; z = s.z;
      let sub = '';
      if (bd < 3.2) {
        const left = spotLeft(s.id);
        sub = !knows(K.skill) ? `Learn ${sk.name} at the Life Hall` : lvlOf(K.skill) < T.lvl ? `Needs ${sk.name} ${T.lvl}` : left > 0 ? `Gathered · back in ${fmt(left)}` : tap(K.verb.replace(/^./, c => c.toUpperCase()));
        if (!ui.guided) { ui.guided = true; guide?.tip?.('life'); }
      }
      html = `${esc(T.name)}${sub ? `<br><small>${sub}</small>` : ''}`;
    } else {
      const { k, st } = best; x = st.x; z = st.z; y = k === 'hall' ? 4.2 : 2.6;
      html = `${esc(st.name)}${nearStation(k, px, pz) ? `<br><small>${tap({ hall: 'Learn', garden: 'Garden', cook: 'Cook', brew: 'Brew' }[k])}</small>` : ''}`;
    }
    const sp = project(x, y, z);
    if (!sp) { lbl.style.display = 'none'; return; }
    lbl.style.display = ''; lbl.style.left = `${sp[0]}px`; lbl.style.top = `${sp[1]}px`;
    if (lbl.innerHTML !== html) lbl.innerHTML = html;
  }

  // A meal row's Eat button in the bag (public/main.js materials section).
  const isFood = id => !!FOODS[id];
  return { interactKind, interact, actLabel, onMsg, onEvent, frame, toggle, render, isOpen, isFood, foodText };
}
