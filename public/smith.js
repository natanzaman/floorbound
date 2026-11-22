// The town Smith: the forge and anvil, the smith NPC, the floating label and the #smith panel
// (Refine / Craft / Salvage / Reforge). The server validates every action (server/smith.js).
import * as THREE from 'three';
import { CLASSES } from '/shared/data.js';
import { RARITY, SLOTS, statLabel } from '/shared/items.js';
import {
  MATS, MAT_IDS, SMITH, nearSmithAt, refineCost, applyRefine, salvageYield, reforgeCost, RECIPES, recipeName, canAfford, REFINE_MAX,
} from '/shared/crafting.js';
import { STYLES } from '/shared/styles.js';
import { rerollCost, affixText, isTeamAffix } from '/shared/loot.js';
import { axHtml, setTagHtml } from '/loot.js';
import { keyHtml, tapping } from '/keyname.js'; // prompts name the player's key on the active device

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...opts });
const TABS = [['refine', 'Refine'], ['craft', 'Craft'], ['salvage', 'Salvage'], ['reforge', 'Reforge'], ['reroll', 'Affixes']];
const statsText = st => Object.entries(st || {}).map(([k, v]) => statLabel(k, v)).join(' · ');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Forge, anvil, quench barrel and a weapon rack, facing the plaza (same style as the merchant's stall).
function buildSmithy(scene, occluders) {
  const g = new THREE.Group();
  const stone = mat(0x6f6a73), dark = mat(0x3d3a42), iron = mat(0x4b5563, { metalness: 0.6, roughness: 0.45 }), wood = mat(0x7a4f2e);
  const coal = mat(0xf97316, { emissive: 0xff5a00, emissiveIntensity: 1.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.18, 4.2), dark); base.position.y = 0.09; g.add(base);
  // forge: brick hearth with glowing coals and a chimney
  const hearth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.6), stone); hearth.position.set(-1.9, 0.55, -0.9); g.add(hearth);
  const coals = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.1), coal); coals.position.set(-1.9, 1.14, -0.9); g.add(coals);
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.05, 0.8, 4), stone); hood.position.set(-1.9, 2.5, -0.9); hood.rotation.y = Math.PI / 4; g.add(hood);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), dark); chimney.position.set(-1.9, 3.45, -0.9); g.add(chimney);
  for (const [x, z] of [[-2.75, -0.25], [-1.05, -0.25], [-2.75, -1.55], [-1.05, -1.55]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), dark); p.position.set(x, 1.65, z); g.add(p); }
  // anvil on a stump
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.6, 10), wood); stump.position.set(0.6, 0.38, 0.9); g.add(stump);
  const anvil = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.4), iron); foot.position.y = 0.07;
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.26), iron); waist.position.y = 0.27;
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.36), iron); face.position.y = 0.5;
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 8), iron); horn.rotation.z = -Math.PI / 2; horn.position.set(0.66, 0.5, 0);
  anvil.add(foot, waist, face, horn); anvil.position.set(0.6, 0.68, 0.9); g.add(anvil);
  // quench barrel and a rack of blades
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 0.85, 12), wood); barrel.position.set(2.3, 0.6, 1.0); g.add(barrel);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 12), mat(0x2b5f86, { emissive: 0x0b2a44, emissiveIntensity: 0.4 })); water.position.set(2.3, 1.0, 1.0); g.add(water);
  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.2), wood); rack.position.set(2.2, 1.6, -1.4); g.add(rack);
  for (const x of [1.5, 2.9]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), wood); leg.position.set(x, 0.8, -1.4); g.add(leg); }
  for (let i = 0; i < 3; i++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.03), mat(0xcbd5e1, { metalness: 0.7, roughness: 0.3 })); blade.position.set(1.7 + i * 0.5, 1.25, -1.28); g.add(blade); }
  // a sign post with a hammer emblem
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), wood); post.position.set(-3.0, 1.3, 1.6); g.add(post);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.08), wood); sign.position.set(-2.55, 2.3, 1.6); g.add(sign);
  const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.1), mat(0xfbbf24, { emissive: 0xf59e0b, emissiveIntensity: 0.5 })); emblem.position.set(-2.55, 2.38, 1.65); g.add(emblem);
  g.position.set(SMITH.x, 0, SMITH.z);
  g.rotation.y = Math.atan2(-SMITH.x, -SMITH.z);
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  scene.add(g); occluders?.push(g); // the camera pulls in rather than clipping behind the forge
  g.updateMatrixWorld(true);
  const anvilPos = anvil.localToWorld(new THREE.Vector3(0, 0.62, 0));
  const forgePos = coals.localToWorld(new THREE.Vector3(0, 0.1, 0));
  return { g, coals, anvilPos, forgePos };
}

export function createSmith({ scene, occluders, fx, sfx, send, state, project, log, guide, isTouch, makePlayerModel, $ }) {
  const world = buildSmithy(scene, occluders);
  const panel = document.createElement('div'); panel.id = 'smith'; panel.className = 'panel hidden';
  $('bag').parentNode.appendChild(panel);
  const lbl = document.createElement('div'); lbl.id = 'smith-lbl'; lbl.className = 'lbl npc smith'; lbl.style.display = 'none';
  $('labels').appendChild(lbl);
  const ui = { tab: 'refine', confirm: 0, npc: null, hammerT: 2, t: 0 };

  const near = () => !state.dead && nearSmithAt(state.x, state.z, 1);
  const isOpen = () => !panel.classList.contains('hidden');
  const mats = () => state.inv?.mats || {};
  const gold = () => state.inv?.gold ?? state.gold ?? 0;

  function addNpc() { // the smith stands behind the anvil, facing the plaza
    const m = makePlayerModel('guardian'), face = world.g.rotation.y;
    m.cursor.visible = false; m.anim?.base(m.anim.idle);
    const p = world.g.localToWorld(new THREE.Vector3(0.6, 0, 0.05));
    m.group.position.set(p.x, 0, p.z); m.group.rotation.y = face;
    for (const mt of m.mats || []) mt.color?.multiplyScalar(0.75);
    scene.add(m.group);
    ui.npc = m;
  }

  function toggle(open = !isOpen()) {
    panel.classList.toggle('hidden', !open);
    if (open) { ui.confirm = 0; render(); }
  }

  // ---------- panel ----------
  const costHtml = cost => {
    if (!cost) return '';
    const have = mats(), g = gold();
    const parts = Object.entries(cost.mats || {}).map(([k, v]) => `<span class="${(have[k] || 0) >= v ? 'ok' : 'no'}" style="--c:${MATS[k].color}">${v} ${MATS[k].name} <i>(${have[k] || 0})</i></span>`);
    parts.unshift(`<span class="${g >= cost.gold ? 'ok' : 'no'} g">${cost.gold}g</span>`);
    return `<div class="cost">${parts.join('')}</div>`;
  };
  const yieldHtml = out => `<div class="cost">${Object.entries(out).map(([k, v]) => `<span class="ok" style="--c:${MATS[k].color}">+${v} ${MATS[k].name}</span>`).join('')}</div>`;
  const btn = (a, label, enabled, extra = '') => `<button data-a="${a}" ${extra} ${enabled ? '' : 'disabled'}>${label}</button>`;
  const usable = it => !it.cls || it.cls === state.cls;
  const gear = (bagOnly = false) => {
    const inv = state.inv; if (!inv) return [];
    const out = bagOnly ? [] : SLOTS.filter(s => inv.eq[s]).map(s => ({ it: inv.eq[s], eq: s }));
    return out.concat(inv.bag.map(it => ({ it, eq: null })));
  };
  const itemHead = (it, eq) => `<span class="slot">${eq ? `${eq}<br><em>worn</em>` : it.slot}</span><span class="nm"><b class="r${it.r}">${esc(it.name)}${setTagHtml(it, state.inv?.eq)}</b><small>${statsText(it.st)}${usable(it) ? '' : ` · ${CLASSES[it.cls]?.name || ''} only`}${axHtml(it, state.cls)}</small>`;

  function matsStrip() {
    const have = mats();
    return `<div class="mats">${MAT_IDS.filter(k => !MATS[k].life || have[k]).map(k => `<span class="${have[k] ? '' : 'zero'}" title="${esc(MATS[k].name)}: from ${esc(MATS[k].from)}" style="--c:${MATS[k].color}"><i></i>${esc(MATS[k].name)} <b>${have[k] || 0}</b></span>`).join('')}</div>`;
  }

  function tabRefine() {
    const list = gear().filter(({ it }) => !it.ks); // keepsakes are never refined
    if (!list.length) return '<div class="it empty"><span class="nm"><small>No gear to refine yet.</small></span></div>';
    return `<p class="hint">Each level adds +10% of the item's base stats, up to +${REFINE_MAX}. Weapons take Tusks and Fangs, armour Pelts, charms Resin; +4 and +5 need Horn Shards. Refining never fails.</p>` + list.map(({ it, eq }) => {
      const cost = refineCost(it), ok = usable(it);
      let next = '';
      if (cost) { const nx = applyRefine({ ...it, st: { ...it.st }, b: it.b ? { ...it.b } : undefined, lv: (it.lv || 0) + 1 }); next = `<small class="next">→ +${nx.lv}: ${statsText(nx.st)}</small>`; }
      return `<div class="it">${itemHead(it, eq)}${next}${cost ? costHtml(cost) : '<small class="max">Fully refined</small>'}</span>${cost && ok ? btn('refine', `+${(it.lv || 0) + 1}`, canAfford(gold(), mats(), cost), `data-u="${it.u}"`) : ''}</div>`;
    }).join('');
  }

  function tabCraft() {
    return '<p class="hint">Named gear with fixed, top-of-range stats. Weapons are forged for your class.</p>' + RECIPES.filter(rc => !rc.style || STYLES[rc.style]?.cls === state.cls).map(rc => { // weapon-style recipes: your class only
      const cost = { gold: rc.gold, mats: rc.mats }, can = canAfford(gold(), mats(), cost) && state.inv && state.inv.bag.length < 24;
      return `<div class="it recipe"><span class="slot">${rc.slot}<br><em class="r${rc.r}">${RARITY[rc.r].name}</em></span><span class="nm"><b class="r${rc.r}">${esc(recipeName(rc, state.cls))}</b><small>${statsText(rc.st)}</small><small class="desc">${esc(rc.desc)}</small>${costHtml(cost)}</span>${btn('craft', 'Forge', can, `data-id="${rc.id}"`)}</div>`;
    }).join('');
  }

  function tabSalvage() {
    const list = gear(true).filter(({ it }) => !it.ks);
    if (!list.length) return '<div class="it empty"><span class="nm"><small>Your bag is empty. Salvage breaks bag items down into Dust (Common), Essence (Uncommon/Rare) or Prism (Epic).</small></span></div>';
    return '<p class="hint">Break bag items down for Dust (Common), Essence (Uncommon, Rare) or Prism (Epic). Refined items give back half their Tusks, Pelts or Resin.</p>' + list.map(({ it }) => {
      const out = salvageYield(it), sure = ui.confirm === it.u;
      return `<div class="it">${itemHead(it)}${out ? yieldHtml(out) : '<small class="max">Can\'t be salvaged</small>'}</span>${out ? btn('salvage', sure ? 'Sure?' : 'Salvage', true, `data-u="${it.u}" class="${sure ? 'warn' : 'sell'}"`) : ''}</div>`;
    }).join('');
  }

  function tabReforge() {
    const list = gear().filter(({ it }) => reforgeCost(it, 'stats'));
    if (!list.length) return '<div class="it empty"><span class="nm"><small>Nothing to reforge. Crafted and Last Attack items are fixed.</small></span></div>';
    return '<p class="hint">Reroll an item\'s stats within its rarity range, or give a charm a different affix. Keeps its refine level.</p>' + list.map(({ it, eq }) => {
      const ok = usable(it), cs = reforgeCost(it, 'stats'), ca = reforgeCost(it, 'affix');
      const b1 = ok ? btn('reforge', 'Reroll', canAfford(gold(), mats(), cs), `data-u="${it.u}" data-m="stats"`) : '';
      const b2 = ok && ca ? btn('reforge', 'New affix', canAfford(gold(), mats(), ca), `data-u="${it.u}" data-m="affix"`) : '';
      return `<div class="it">${itemHead(it, eq)}<small class="lbl2">Reroll</small>${costHtml(cs)}${ca ? `<small class="lbl2">New affix</small>${costHtml(ca)}` : ''}</span><span class="btns">${b1}${b2}</span></div>`;
    }).join('');
  }

  // Reroll one affix (shared/loot.js rerollCost): it becomes a different affix, the others stay.
  function tabReroll() {
    const list = gear().filter(({ it }) => rerollCost(it));
    if (!list.length) return '<div class="it empty"><span class="nm"><small>No gear with affixes. Uncommon and better drops roll 1–3 bonus stats; Epic set pieces roll 2.</small></span></div>';
    return '<p class="hint">Reroll ONE affix into a different one (the item keeps its other affixes, stats and refine level). Set pieces cost double.</p>' + list.map(({ it, eq }) => {
      const cost = rerollCost(it), ok = usable(it), can = canAfford(gold(), mats(), cost);
      const rows = it.ax.map((a, i) => `<div class="axrow"><span class="ax-l${isTeamAffix(a) ? ' team' : ''}">${esc(affixText(a, state.cls))}</span>${ok ? btn('reroll', 'Reroll', can, `data-u="${it.u}" data-i="${i}"`) : ''}</div>`).join('');
      return `<div class="it" data-tu="${it.u}"><span class="slot">${eq ? `${eq}<br><em>worn</em>` : it.slot}</span><span class="nm"><b class="r${it.r}">${esc(it.name)}${setTagHtml(it, state.inv?.eq)}</b><small>${statsText(it.st)}</small>${rows}${costHtml(cost)}</span></div>`;
    }).join('');
  }

  function render() {
    if (!isOpen() || !state.inv) return;
    let h = `<div class="top"><span>THE SMITH <span class="gold">${gold()} gold</span></span><button class="x" data-a="close">✕</button></div>`;
    h += matsStrip();
    h += `<div class="tabs">${TABS.map(([id, name]) => `<button data-a="tab" data-t="${id}" class="${ui.tab === id ? 'on' : ''}">${name}</button>`).join('')}</div>`;
    h += `<div class="body">${{ refine: tabRefine, craft: tabCraft, salvage: tabSalvage, reforge: tabReforge, reroll: tabReroll }[ui.tab]()}</div>`;
    const sc = panel.querySelector('.body')?.scrollTop || 0;
    panel.innerHTML = h;
    const body = panel.querySelector('.body'); if (body) body.scrollTop = sc;
  }

  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = b.dataset.a;
    sfx.play('ui');
    if (a === 'close') return toggle(false);
    if (a === 'tab') { ui.tab = b.dataset.t; ui.confirm = 0; return render(); }
    const u = +b.dataset.u;
    if (a === 'refine') send({ type: 'smith', a: 'refine', u });
    if (a === 'reforge') send({ type: 'smith', a: 'reforge', u, mode: b.dataset.m });
    if (a === 'reroll') send({ type: 'smith', a: 'reroll', u, i: +b.dataset.i });
    if (a === 'craft') send({ type: 'smith', a: 'craft', id: b.dataset.id, cls: state.cls });
    if (a === 'salvage') {
      const it = state.inv?.bag.find(x => x.u === u);
      if (it && (it.r >= 2 || it.lv) && ui.confirm !== u) { ui.confirm = u; return render(); } // Rare+ or refined: confirm first
      ui.confirm = 0;
      send({ type: 'smith', a: 'salvage', u });
    }
  });

  // Materials section for the bag panel.
  function matsHtml(inv) {
    const have = inv?.mats || {}, ids = MAT_IDS.filter(k => have[k] > 0);
    return `<h4>Materials</h4>${ids.length ? `<div class="mats">${ids.map(k => `<span title="from ${esc(MATS[k].from)}" style="--c:${MATS[k].color}"><i></i>${esc(MATS[k].name)} <b>${have[k]}</b></span>`).join('')}</div><small class="mats-hint">Take them to the Smith in town (F) to refine or craft gear.</small>`
      : '<div class="it empty"><span class="nm"><small>None yet. Monsters drop materials for the Smith in town.</small></span></div>'}`;
  }

  // Loot lines for materials (from the 'loot' event).
  function onLoot(e) {
    const got = Object.entries(e.mats || {}).filter(([, v]) => v > 0);
    if (!got.length) return;
    log(`Materials: ${got.map(([k, v]) => `${MATS[k]?.name || k} ×${v}`).join(', ')}`, 'mat');
    guide.tip('mats');
  }

  function burst(big) {
    const p = world.anvilPos;
    fx.sparks(p.x, p.y, p.z, big ? 28 : 8, 0xffb347, big ? 0.28 : 0.18, big ? 8 : 5);
    if (big) { fx.sparks(p.x, p.y, p.z, 12, 0xfff3c4, 0.2, 10); setTimeout(() => fx.sparks(p.x, p.y, p.z, 16, 0xff7a2a, 0.24, 7), 280); }
  }

  // A forge event: sparks at the anvil for everyone nearby, the clang for whoever's close.
  function onForge(e) {
    const mine = e.id === state.myId, d = Math.hypot(state.x - SMITH.x, state.z - SMITH.z);
    if (!mine && d > 40) return;
    burst(true);
    ui.npc?.anim?.shot('2H_Melee_Attack_Chop', 1.4);
    sfx.play('forge', mine ? null : { x: SMITH.x, z: SMITH.z }, mine ? 1 : 0.6);
    if (mine && e.a !== 'salvage') ui.flash = 0.6;
  }

  // Called every frame: label, NPC, coal flicker, auto-close when walking away.
  function frame(dt) {
    ui.t += dt;
    ui.npc?.anim?.update(dt);
    world.coals.material.emissiveIntensity = 1.2 + Math.sin(ui.t * 7) * 0.15 + Math.sin(ui.t * 13.7) * 0.1 + (ui.flash > 0 ? ui.flash * 2 : 0);
    if (ui.flash > 0) ui.flash -= dt;
    if (!state.joined || state.spectator) { lbl.style.display = 'none'; return; }
    const d = Math.hypot(state.x - SMITH.x, state.z - SMITH.z);
    if (d < 30 && (ui.hammerT -= dt) < 0) { ui.hammerT = 3.5 + Math.random() * 3; if (!ui.npc?.anim?.busy()) { ui.npc?.anim?.shot('2H_Melee_Attack_Chop', 1.1); setTimeout(() => burst(false), 380); } }
    const sp = project(SMITH.x, 4.2, SMITH.z);
    if (sp && d < 22) {
      lbl.style.display = ''; lbl.style.left = `${sp[0]}px`; lbl.style.top = `${sp[1]}px`;
      const html = `Smith${d < SMITH.r + 1 ? `<br><small>${tapping() ? 'tap Forge' : `press ${keyHtml('interact')} to forge`}</small>` : ''}`;
      if (lbl.innerHTML !== html) lbl.innerHTML = html;
    } else lbl.style.display = 'none';
    if (isOpen() && (d > SMITH.r + 6 || state.dead)) toggle(false);
  }

  return { near, toggle, render, matsHtml, onLoot, onForge, frame, addNpc, isOpen };
}
