// The Tower Bell and the engraved Hall (ROADMAP F6), client side.
// - bell events ({ t: 'bell', floor, n }): a deep toll (audio.js 'bell'), a slow camera sway and the banner,
//   for everyone on every floor; held a few seconds when it comes with a clear, so the clear gets its moment.
// - the engraved stones: the Hall of Clearers tablet in town (built in world.js) and a small stone by Mirelight Camp's
//   Skill Shrine (built here) carry the names of their floor's latest clear on a carved canvas face, redrawn whenever
//   a 'hall' message arrives (the server sends one on join and after every clear). Their backs carry the motto.
import * as THREE from 'three';
import { HALL_STONES } from '/shared/titles.js';
import { bellBanner, BELL_MOTTO } from '/shared/bell.js';

const SWAY_SECS = 9;
const FONT = "'Cinzel', 'Trajan Pro', Georgia, 'DejaVu Serif', 'Times New Roman', serif";

// A stone surface: base colour with speckle and a soft vignette.
function stoneCanvas(w, h, base, seed) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < w * h / 18; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.05 + rnd() * 0.08})` : `rgba(255,255,255,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  return [c, g];
}

// Letters cut into the stone: a dark upper-left wall, a lit lower-right lip, then the fill (gold leaf or shadowed stone).
function carve(g, text, x, y, px, { fill = 'gold', spacing = 0.12, weight = 700 } = {}) {
  g.font = `${weight} ${px}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(px * spacing)}px`;
  const d = Math.max(1, px / 26);
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillText(text, x + d, y + d);
  g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillText(text, x - d * 0.8, y - d * 0.8);
  if (fill === 'gold') {
    const gr = g.createLinearGradient(0, y - px / 2, 0, y + px / 2);
    gr.addColorStop(0, '#8a6414'); gr.addColorStop(0.45, '#e9c15a'); gr.addColorStop(1, '#a87a1c');
    g.fillStyle = gr;
  } else g.fillStyle = fill;
  g.fillText(text, x, y);
}

function rule(g, x0, x1, y) {
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x0, y - 1.5, x1 - x0, 2);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0, y + 0.5, x1 - x0, 1.5);
}

// The face of a stone: "FLOOR N", a rule, then the names of the latest clear (blank stone when there's none).
function drawFace(tex, floor, rec, base) {
  const [c, g] = stoneCanvas(512, 512, base, 7 + floor);
  carve(g, `FLOOR ${floor}`, 256, 50, 30, { spacing: 0.3 });
  rule(g, 150, 362, 84);
  const names = (rec?.players || []).map(p => String(p.name || '').toUpperCase()).filter(Boolean);
  if (names.length) {
    const shown = names.slice(0, 10), cols = shown.length > 6 ? 2 : 1, rows = Math.ceil(shown.length / cols);
    const px = cols === 2 ? 34 : shown.length > 4 ? 42 : 48, step = Math.min(70, 360 / rows);
    shown.forEach((nm, i) => {
      const col = cols === 2 ? i % 2 : 0, row = cols === 2 ? Math.floor(i / 2) : i;
      let size = px;
      g.font = `700 ${size}px ${FONT}`;
      const maxW = cols === 2 ? 220 : 440;
      while (size > 18 && g.measureText(nm).width * 1.12 > maxW) { size -= 2; g.font = `700 ${size}px ${FONT}`; }
      carve(g, nm, cols === 2 ? 138 + col * 236 : 256, 120 + step / 2 + row * step, size, { spacing: 0.08 });
    });
    if (names.length > shown.length) carve(g, `AND ${names.length - shown.length} MORE`, 256, 486, 20, { spacing: 0.2 });
  }
  tex.image = c; tex.needsUpdate = true;
}

function drawMotto(base) {
  const [c, g] = stoneCanvas(512, 256, base, 99);
  const [a, b] = BELL_MOTTO.split('. ').map((s, i) => (i ? s : `${s}.`));
  let px = 46;
  g.font = `700 ${px}px ${FONT}`;
  while (px > 20 && g.measureText(a).width * 1.18 > 460) { px -= 2; g.font = `700 ${px}px ${FONT}`; }
  carve(g, a, 256, 96, px, { fill: 'rgba(40,36,48,0.85)', spacing: 0.14 });
  carve(g, b, 256, 166, px, { fill: 'rgba(40,36,48,0.85)', spacing: 0.14 });
  return c;
}

const canvasTex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const plane = (w, h, tex) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }));

// A camp's stone (Floors 2 and 3): a smaller tablet by the camp shrine, in the floor's colours.
const CAMP_LOOK = { 2: { stone: 0x55666a, dark: 0x34413f, crest: 0x5eead4, cx: 600, base: '#4b5a5e', backBase: '#55666a' }, 3: { stone: 0xb9ad98, dark: 0x7a6f5e, crest: 0x7dd3fc, cx: 1200, base: '#8a7f6c', backBase: '#9c9078' } };
function buildCampStone(scene, s) {
  if (!s) return null;
  const L = CAMP_LOOK[s.floor] || CAMP_LOOK[2];
  const g = new THREE.Group(); g.name = `hall_of_clearers_${s.floor}`;
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...o });
  const stone = mat(L.stone), dark = mat(L.dark);
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(2.6, 0.25, 1.4), dark, 0, 0.12, 0);
  add(new THREE.BoxGeometry(2.1, 0.4, 0.9), stone, 0, 0.45, 0);
  add(new THREE.BoxGeometry(1.9, 2.1, 0.34), stone, 0, 1.7, 0);
  add(new THREE.BoxGeometry(2.1, 0.16, 0.5), dark, 0, 2.82, 0);
  const crest = add(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: L.crest }), 0, 3.15, 0);
  g.position.set(s.x, 0, s.z);
  g.rotation.y = Math.atan2(L.cx - s.x, 0 - s.z); // faces the campfire
  g.userData = { crest, faceW: 1.55, faceY: 1.7, faceZ: 0.175, backW: 1.6, backY: 1.85, backZ: -0.175, base: L.base, backBase: L.backBase };
  scene.add(g);
  return g;
}

export function initBell({ scene, sfx, banner, guide }) {
  const stones = new Map(); // floor -> { group, tex, key }
  const town = scene.getObjectByName('hall_of_clearers');
  if (town) Object.assign(town.userData, { faceW: 1.96, faceY: 2.15, faceZ: 0.256, backW: 2.2, backY: 2.3, backZ: -0.206, base: '#3f3c48', backBase: '#8d8a96' });
  const camp = buildCampStone(scene, HALL_STONES.find(s => s.floor === 2)), camp3 = buildCampStone(scene, HALL_STONES.find(s => s.floor === 3));
  for (const [floor, group] of [[1, town], [2, camp], [3, camp3]]) {
    if (!group) continue;
    const u = group.userData;
    const tex = canvasTex(document.createElement('canvas'));
    drawFace(tex, floor, null, u.base);
    const face = plane(u.faceW, u.faceW, tex); face.position.set(0, u.faceY, u.faceZ); group.add(face);
    const back = plane(u.backW, u.backW / 2, canvasTex(drawMotto(u.backBase)));
    back.material.emissiveIntensity = 0.05;
    back.position.set(0, u.backY, u.backZ); back.rotation.y = Math.PI; group.add(back);
    stones.set(floor, { group, tex, key: '' });
  }

  // Keep the faces in step with the Hall (latest clear per floor).
  function hall(msg) {
    const latest = { 1: msg?.recent?.[0] || null, 2: msg?.floors?.[2]?.recent?.[0] || null };
    for (const [floor, st] of stones) {
      const rec = latest[floor], key = rec ? `${rec.at}|${rec.players.map(p => p.name).join(',')}` : '';
      if (key === st.key) continue;
      st.key = key; drawFace(st.tex, floor, rec, st.group.userData.base);
    }
  }

  let lastClear = -1e9, swayAt = -1e9, glowUntil = 0;
  function ring(floor) {
    sfx.play('bell', null, 1);
    banner(...bellBanner(floor), true); // next up, ahead of level-ups and titles
    guide?.tip('bell');
    swayAt = performance.now();
    glowUntil = swayAt + 6000;
  }
  function event(e) {
    if (e.t === 'clear' || e.t === 'clear2') { lastClear = performance.now(); return false; }
    if (e.t !== 'bell') return false;
    const fresh = performance.now() - lastClear < 1500; // rung by the clear itself: let the kill and its banner land first
    setTimeout(() => ring(e.floor), fresh ? 3500 : 0);
    return true;
  }

  // Slow camera sway after a toll, applied around the render and undone after it (whoever placed the camera).
  const saved = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  let swaying = false;
  function before(camera, now = performance.now()) {
    const t = (now - swayAt) / 1000;
    for (const [, st] of stones) { // the crests flare with the toll
      const cr = st.group.userData.crest; if (!cr) continue;
      const k = now < glowUntil ? 1 + 0.9 * Math.exp(-t / 1.6) : 1;
      cr.scale.setScalar(k);
    }
    swaying = t >= 0 && t < SWAY_SECS;
    if (!swaying) return;
    const amp = Math.min(1, t / 0.8) * Math.exp(-t / 3.2);
    saved.p.copy(camera.position); saved.q.copy(camera.quaternion);
    const w = (2 * Math.PI) / 3.2;
    camera.rotateZ(0.03 * amp * Math.sin(w * t));
    camera.rotateX(0.012 * amp * Math.sin(w * t * 0.5 + 0.7)); // a slow nod, as if looking up
    camera.translateX(0.22 * amp * Math.sin(w * t + 0.4));
    camera.translateY(0.1 * amp * Math.sin(w * t * 2));
  }
  function after(camera) {
    if (!swaying) return;
    camera.position.copy(saved.p); camera.quaternion.copy(saved.q);
  }

  return { hall, event, ring, before, after, stones };
}
