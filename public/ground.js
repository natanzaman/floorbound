// Items lying on the ground: a small glowing gem per item, with a "F to pick up" label for the nearest one.
import * as THREE from 'three';
import { RARITY } from '/shared/items.js';

const REACH = 2.4;

export function initGround({ scene, state, project, $ }) {
  const items = new Map(); // id -> { mesh, x, z, r, name }
  const geo = new THREE.OctahedronGeometry(0.28, 0);
  const beamGeo = new THREE.CylinderGeometry(0.06, 0.12, 3, 8, 1, true);
  const lbl = document.createElement('div');
  lbl.className = 'lbl npc'; lbl.style.display = 'none';
  $('labels').appendChild(lbl);
  let t = 0;

  function add([id, x, z, r, name]) {
    const color = new THREE.Color(RARITY[r]?.color || '#e5e7eb');
    const g = new THREE.Group();
    const gem = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
    gem.position.y = 0.5; g.add(gem);
    if (r >= 2) {
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
      beam.position.y = 1.5; g.add(beam);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    items.set(id, { mesh: g, gem, x, z, r, name, seed: Math.random() * 6 });
  }

  function remove(id) {
    const e = items.get(id); if (!e) return;
    scene.remove(e.mesh);
    e.mesh.traverse(m => { if (m.material) m.material.dispose(); });
    items.delete(id);
  }

  return {
    set(list) {
      const seen = new Set();
      for (const row of list) { seen.add(row[0]); if (!items.has(row[0])) add(row); }
      for (const id of [...items.keys()]) if (!seen.has(id)) remove(id);
    },
    near() {
      let best = null, bd = REACH;
      for (const [id, e] of items) { const d = Math.hypot(e.x - state.x, e.z - state.z); if (d < bd) { bd = d; best = id; } }
      return best;
    },
    frame(dt, isTouch) {
      t += dt;
      for (const e of items.values()) { e.gem.rotation.y += dt * 1.5; e.gem.position.y = 0.5 + Math.sin(t * 2 + e.seed) * 0.08; }
      const id = state.joined && !state.dead ? this.near() : null;
      const e = id && items.get(id), p = e && project(e.x, 1.4, e.z);
      if (!p) { lbl.style.display = 'none'; return; }
      lbl.style.display = ''; lbl.style.left = `${p[0]}px`; lbl.style.top = `${p[1]}px`;
      const html = `<span style="color:${RARITY[e.r]?.color}">${e.name.replace(/</g, '&lt;')}</span><br><small>${isTouch ? 'tap Pick up' : 'press F to pick up'}</small>`;
      if (lbl.innerHTML !== html) lbl.innerHTML = html;
    },
  };
}
