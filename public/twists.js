// Warden twists on the client: announce banner, raid-gate and boss-bar lines, cracked ground, Echo telegraphs,
// stone Thorn Totems and the Eclipse darkness. main.js calls into this from a few one-line hooks.
import * as THREE from 'three';
import { MOBS, inArena } from '/shared/data.js';
import { TWISTS, TOTEM, rewardText } from '/shared/twists.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STONE = new THREE.Color(0x8a8578);
// Eclipse: night sky and dark distance outside the chamber; the chamber itself only a little dimmer, with a cool
// moonlight fill so the fight stays readable. (Tune here.)
const DARK = { fog: new THREE.Color(0x14172b), bg: new THREE.Color(0x090b18), near: 34, far: 115, hemi: 0.7, sun: 0.8, fill: 0.4 };

export class TwistClient {
  constructor({ scene, fx, banner }) {
    Object.assign(this, { scene, fx, banner, id: null, dark: 0 });
    this.hemi = scene.children.find(o => o.isHemisphereLight);
    this.sun = scene.children.find(o => o.isDirectionalLight);
    this.fill = new THREE.AmbientLight(0x9fb2ff, 0); // moonlight fill, only during Eclipse
    scene.add(this.fill);
    this.base = {
      fog: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far,
      bg: scene.background?.isColor ? scene.background.clone() : null,
      hemi: this.hemi?.intensity ?? 1, sun: this.sun?.intensity ?? 1,
    };
  }

  get def() { return TWISTS[this.id] || null; }

  // every snapshot: the current twist (also for players who join mid-fight)
  snap(w) { if (w && 'twist' in w) this.id = w.twist || null; }

  // 'twist' event: a new Warden spawned with this twist
  announce(e) {
    this.id = e.id;
    const T = this.def;
    if (T) this.banner(`THE WARDEN STIRS · ${T.name.toUpperCase()}`, `${T.desc} Reward: ${rewardText(e.id)}`);
  }

  // Raid gate panel: twist name + description under the ready count.
  gateBox(el) {
    const T = this.def;
    if (!T) return;
    el.querySelector('.sub')?.insertAdjacentHTML('afterend',
      `<div class="twist" style="margin:-4px 0 8px;font-size:12px;line-height:1.35;max-width:300px">`
      + `<span style="color:${T.color};font-weight:800;letter-spacing:.12em">TWIST · ${esc(T.name.toUpperCase())}</span><br>`
      + `<span style="opacity:.85">${esc(T.desc)}</span><br><span style="color:#fde047;opacity:.9">Reward: ${esc(rewardText(this.id))}</span></div>`);
  }

  // Boss bar: one line under the phase line.
  bossLine(phaseEl) {
    let el = document.getElementById('boss-twist');
    if (!el) {
      el = document.createElement('div');
      el.id = 'boss-twist'; el.className = 'phase';
      el.style.cssText = 'margin-top:2px;letter-spacing:.08em;text-shadow:0 1px 2px #000';
      phaseEl.after(el);
    }
    const T = this.def, txt = T ? `TWIST · ${T.name.toUpperCase()} · ${T.short}` : '';
    if (el.dataset.t !== txt) { el.dataset.t = txt; el.textContent = txt; el.title = T?.desc || ''; el.style.color = T?.color || ''; }
  }

  // 'tele' events this module draws itself (true = handled, skip the default red telegraph)
  tele(e) {
    if (e.k === 'crack') { this.crack(e.x, e.z, e.r, e.d); return true; }
    if (e.k === 'echo') { this.echo(e.x, e.z, e.r, e.d); return true; }
    return false;
  }

  // Quaking: a dark, glowing cracked disc that hurts while it lasts.
  crack(x, z, r, life) {
    const fx = this.fx, g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), fx.fadeMat(0x1c1410, 0.55));
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r, 40), fx.fadeMat(0xf97316, 0.7));
    disc.rotation.x = edge.rotation.x = -Math.PI / 2; edge.position.y = 0.01;
    g.add(disc, edge);
    const glow = fx.fadeMat(0xfb923c, 0.85);
    for (let i = 0; i < 9; i++) { // jagged glowing fissures from the centre
      let a = (i / 9) * Math.PI * 2 + Math.random() * 0.4, px = 0, pz = 0;
      const segs = 3 + Math.floor(Math.random() * 2), step = (r * 0.95) / segs;
      for (let s = 0; s < segs; s++) {
        a += (Math.random() - 0.5) * 0.7;
        const nx = px + Math.sin(a) * step, nz = pz + Math.cos(a) * step;
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.16 * (1 - s / segs) + 0.05, step * 1.05), glow);
        seg.rotation.x = -Math.PI / 2; seg.rotation.z = -Math.atan2(nx - px, nz - pz) + Math.PI;
        seg.position.set((px + nx) / 2, 0.02, (pz + nz) / 2);
        g.add(seg); px = nx; pz = nz;
      }
    }
    g.position.set(x, 0.05, z);
    fx.add(g, life, (mesh, k) => {
      const fade = k > 0.85 ? (1 - k) / 0.15 : 1, pulse = 0.6 + 0.4 * Math.sin(performance.now() / 120);
      disc.material.opacity = 0.55 * fade; edge.material.opacity = 0.7 * fade * pulse; glow.opacity = 0.85 * fade * pulse;
    });
  }

  // Echo: a purple telegraph for the repeat strike.
  echo(x, z, r, life) {
    const fx = this.fx, g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.3, r, 48), fx.fadeMat(0xc084fc, 0.9));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), fx.fadeMat(0xa855f7, 0.32));
    edge.rotation.x = fill.rotation.x = -Math.PI / 2;
    g.add(edge, fill); g.position.set(x, 0.09, z);
    fx.add(g, life, (mesh, k) => { fill.scale.setScalar(Math.max(0.01, k)); });
  }

  // Thorn Totems are spitters inside the chamber: stone tint, rune collar, their own name.
  decorate(e) {
    if (e.type !== 'spitter' || !inArena(e.x, e.z)) return;
    e.def = { ...MOBS.spitter, ...TOTEM };
    for (const m of e.mats || []) if (m.color) m.color.lerp(STONE, 0.72);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x5f5b54, flatShading: true, roughness: 0.95 }));
    collar.position.y = 0.25; collar.castShadow = true;
    const rune = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: 0x84cc16 }));
    rune.rotation.x = Math.PI / 2; rune.position.y = 1.0;
    e.model.group.add(collar, rune);
  }

  // Eclipse: darken fog and lights while the camera's focus is in the chamber.
  frame(dt, x, z) {
    const want = this.id === 'eclipse' && inArena(x, z) ? 1 : 0;
    if (want === this.dark) return;
    this.dark += (want - this.dark) * Math.min(1, dt * 1.5);
    if (Math.abs(want - this.dark) < 0.005) this.dark = want;
    const d = this.dark, B = this.base, s = this.scene;
    s.fog.color.copy(B.fog).lerp(DARK.fog, d);
    s.fog.near = B.near + (DARK.near - B.near) * d;
    s.fog.far = B.far + (DARK.far - B.far) * d;
    if (B.bg && s.background?.isColor) s.background.copy(B.bg).lerp(DARK.bg, d);
    if (this.hemi) this.hemi.intensity = B.hemi + (DARK.hemi - B.hemi) * d;
    if (this.sun) this.sun.intensity = B.sun + (DARK.sun - B.sun) * d;
    this.fill.intensity = DARK.fill * d;
  }
}
