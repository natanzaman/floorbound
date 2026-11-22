// Client side of weapon styles (data: shared/styles.js, server: server/styles.js).
// - Swaps the held weapon on each character to match the style in its snapshot row ([11]).
// - Plays the styled basic attack: animation per combo step, distinct hit effects and sounds per style.
// - Tooltip / bag text, the merchant's alternate weapon, the local player's basic-attack cooldown and auto-aim range.
// main.js calls initStyles() once and routes snapshot rows (snap) and events (event) here.
import * as THREE from 'three';
import { STYLES, STYLE_IDS, altStyle, styleOf } from '/shared/styles.js';
import { PACE } from '/shared/data.js';

const CSS = `
.sty { color: #fcd34d; font-weight: 700; }
.sty-p { display: block; color: #fde68a; opacity: .85; font-style: italic; }
.num.cdr { color: #93c5fd; font-size: 15px; font-weight: 800; }
`;

// Animation per combo step (KayKit knight animation set). Default styles keep main.js's SKILL_ANIM.
const ANIM = {
  dual: [['1H_Melee_Attack_Slice_Diagonal', 2.7], ['1H_Melee_Attack_Slice_Horizontal', 2.7], ['1H_Melee_Attack_Chop', 2.5], ['2H_Melee_Attack_Slice', 2.3]],
  rapier: [['1H_Melee_Attack_Stab', 2.3], ['1H_Melee_Attack_Stab', 2.0], ['1H_Melee_Attack_Stab', 1.5]],
  mace: [['1H_Melee_Attack_Chop', 1.45], ['1H_Melee_Attack_Slice_Diagonal', 1.4], ['2H_Melee_Attack_Chop', 1.35]],
  spear: [['1H_Melee_Attack_Stab', 1.9], ['1H_Melee_Attack_Stab', 1.7], ['1H_Melee_Attack_Stab', 1.3]],
  tome: [['1H_Melee_Attack_Chop', 1.9], ['1H_Melee_Attack_Slice_Horizontal', 1.9], ['2H_Melee_Attack_Chop', 1.6]],
  wand: [['Spellcast_Shoot', 2.6]],
  // newer classes: styles with their own basic attack (the others animate in public/classes-a.js / classes-b.js)
  daggers: [['1H_Melee_Attack_Slice_Diagonal', 2.8], ['1H_Melee_Attack_Stab', 2.8], ['1H_Melee_Attack_Slice_Horizontal', 2.8], ['1H_Melee_Attack_Stab', 2.3]],
  halberd: [['2H_Melee_Attack_Slice', 1.9], ['1H_Melee_Attack_Slice_Horizontal', 1.8], ['2H_Melee_Attack_Spin', 1.6]],
  drum: [['Spellcast_Raise', 2.2], ['Spellcast_Raise', 2.2], ['2H_Melee_Attack_Chop', 1.7]],
};

// ---------- low-poly weapons (Three.js geometry, flat-shaded like the KayKit pack) ----------
// Built in the hand slot's frame, matching the KayKit 1H_Sword: grip at the origin, blade along +y, ~1.8 units long.
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.25, flatShading: true, ...o });
function part(geo, m, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z); mesh.rotation.set(rx, 0, rz); mesh.castShadow = true;
  return mesh;
}
const BUILD = {
  rapier() {
    const g = new THREE.Group(), steel = mat(0xe5e7eb, { metalness: 0.6, roughness: 0.35 }), gold = mat(0xd4a32a, { metalness: 0.6 }), grip = mat(0x5b3a24);
    g.add(part(new THREE.CylinderGeometry(0.018, 0.045, 1.75, 4), steel, 0, 1.15, 0));         // needle blade
    g.add(part(new THREE.SphereGeometry(0.17, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, 0.18, 0, Math.PI)); // cup guard
    g.add(part(new THREE.BoxGeometry(0.46, 0.05, 0.05), gold, 0, 0.24, 0));                  // quillons
    g.add(part(new THREE.TorusGeometry(0.12, 0.022, 4, 10, Math.PI), gold, 0, 0.1, 0.09, 0, Math.PI / 2)); // knuckle bow
    g.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.4, 6), grip, 0, -0.05, 0));
    g.add(part(new THREE.SphereGeometry(0.075, 6, 4), gold, 0, -0.28, 0));
    return g;
  },
  mace(tint = 0x9ca3af, s = 1) {
    const g = new THREE.Group(), steel = mat(tint, { metalness: 0.55, roughness: 0.4 }), wood = mat(0x6b4a2b), band = mat(0x3f3f46);
    g.add(part(new THREE.CylinderGeometry(0.055, 0.065, 1.25, 6), wood, 0, 0.35, 0));
    g.add(part(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 6), band, 0, -0.2, 0));
    g.add(part(new THREE.IcosahedronGeometry(0.24 * s, 0), steel, 0, 1.1, 0));
    for (let i = 0; i < 6; i++) { // flanges
      const a = (i / 6) * Math.PI * 2, f = part(new THREE.BoxGeometry(0.05, 0.42 * s, 0.2 * s), steel, Math.cos(a) * 0.2 * s, 1.1, Math.sin(a) * 0.2 * s);
      f.rotation.y = -a; g.add(f);
    }
    g.add(part(new THREE.ConeGeometry(0.07 * s, 0.22 * s, 5), steel, 0, 1.42 * (0.85 + 0.15 * s), 0));
    return g;
  },
  spear() {
    const g = new THREE.Group(), wood = mat(0x7c5a3a), steel = mat(0xd1d5db, { metalness: 0.6, roughness: 0.35 }), cloth = mat(0xb91c1c);
    g.add(part(new THREE.CylinderGeometry(0.045, 0.05, 3.3, 6), wood, 0, 0.6, 0));            // shaft: -1.05 .. 2.25
    g.add(part(new THREE.ConeGeometry(0.13, 0.55, 4), steel, 0, 2.52, 0));                   // leaf tip
    g.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 6), steel, 0, 2.2, 0));
    g.add(part(new THREE.BoxGeometry(0.34, 0.04, 0.06), steel, 0, 2.27, 0));                 // lugs
    g.add(part(new THREE.ConeGeometry(0.09, 0.3, 4), cloth, 0, 2.0, 0, Math.PI));            // pennant tuft
    g.add(part(new THREE.ConeGeometry(0.06, 0.16, 5), steel, 0, -1.12, 0, Math.PI));         // butt spike
    return g;
  },
  // ---------- newer classes ----------
  crossbow() { // a stocked crossbow held like a sword: the stock along +y, the prod across near the top
    const g = new THREE.Group(), wood = mat(0x6b4226), steel = mat(0x9ca3af, { metalness: 0.6, roughness: 0.4 }), str = mat(0xe7e5e4);
    g.add(part(new THREE.BoxGeometry(0.13, 1.25, 0.16), wood, 0, 0.35, 0));                  // stock
    g.add(part(new THREE.BoxGeometry(1.1, 0.07, 0.08), steel, 0, 0.88, 0));                 // prod
    g.add(part(new THREE.BoxGeometry(0.02, 0.02, 0.02), str, 0, 0.88, 0));
    const string = part(new THREE.CylinderGeometry(0.008, 0.008, 1.08, 3), str, 0, 0.62, 0, 0, Math.PI / 2); g.add(string);
    g.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 4), steel, 0, 0.75, 0.09));    // a loaded bolt
    g.add(part(new THREE.ConeGeometry(0.05, 0.12, 4), steel, 0, 1.15, 0.09));
    return g;
  },
  dagger(tint = 0xd1d5db) {
    const g = new THREE.Group(), steel = mat(tint, { metalness: 0.65, roughness: 0.3 }), grip = mat(0x3f2a1d), brass = mat(0xb8860b, { metalness: 0.6 });
    const blade = part(new THREE.ConeGeometry(0.08, 0.75, 4), steel, 0, 0.62, 0); blade.scale.z = 0.35; g.add(blade);
    g.add(part(new THREE.BoxGeometry(0.3, 0.05, 0.07), brass, 0, 0.24, 0));
    g.add(part(new THREE.CylinderGeometry(0.04, 0.045, 0.3, 6), grip, 0, 0.06, 0));
    return g;
  },
  warhammer() {
    const g = new THREE.Group(), steel = mat(0x78716c, { metalness: 0.55, roughness: 0.45 }), wood = mat(0x5b3a24), band = mat(0xb45309, { metalness: 0.5 });
    g.add(part(new THREE.CylinderGeometry(0.06, 0.07, 2.0, 6), wood, 0, 0.6, 0));            // haft
    g.add(part(new THREE.BoxGeometry(0.75, 0.42, 0.42), steel, 0, 1.65, 0));                // head
    g.add(part(new THREE.BoxGeometry(0.12, 0.5, 0.5), band, 0.38, 1.65, 0));                // striking faces
    g.add(part(new THREE.BoxGeometry(0.12, 0.5, 0.5), band, -0.38, 1.65, 0));
    g.add(part(new THREE.ConeGeometry(0.1, 0.3, 4), steel, 0, 2.0, 0));                      // top spike
    g.add(part(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6), band, 0, -0.35, 0));         // pommel band
    return g;
  },
  polearm(kind) { // Halberd: an axe blade and a back hook; Glaive: a long curved blade on an even longer haft
    const g = new THREE.Group(), wood = mat(0x6b4a2b), steel = mat(0xe2e8f0, { metalness: 0.65, roughness: 0.3 }), trim = mat(kind === 'glaive' ? 0x7c3aed : 0xb91c1c);
    const len = kind === 'glaive' ? 4.2 : 3.6, top = len - 1.1;
    g.add(part(new THREE.CylinderGeometry(0.05, 0.06, len, 6), wood, 0, len / 2 - 1.1, 0));
    g.add(part(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 6), trim, 0, top - 0.1, 0));
    if (kind === 'glaive') {
      const blade = part(new THREE.CylinderGeometry(0.02, 0.14, 1.1, 4, 1), steel, 0.08, top + 0.55, 0, 0, -0.18); blade.scale.z = 0.25; g.add(blade);
      g.add(part(new THREE.ConeGeometry(0.06, 0.25, 4), steel, 0.2, top + 1.15, 0, 0, -0.3));
    } else {
      g.add(part(new THREE.ConeGeometry(0.09, 0.6, 4), steel, 0, top + 0.35, 0));          // spike
      const axe = part(new THREE.BoxGeometry(0.55, 0.5, 0.04), steel, 0.3, top + 0.0, 0); g.add(axe); // axe blade
      g.add(part(new THREE.ConeGeometry(0.06, 0.3, 4), steel, -0.2, top - 0.02, 0, 0, Math.PI / 2)); // back hook
    }
    g.add(part(new THREE.ConeGeometry(0.06, 0.18, 5), steel, 0, -1.18, 0, Math.PI));
    return g;
  },
  drum() { // a frame drum on the off arm, a beater in the hand (built here: the beater)
    const g = new THREE.Group(), wood = mat(0x7c2d12), head = mat(0xf5deb3, { roughness: 0.9, metalness: 0 });
    g.add(part(new THREE.CylinderGeometry(0.035, 0.04, 0.9, 6), wood, 0, 0.35, 0));
    g.add(part(new THREE.SphereGeometry(0.11, 8, 6), head, 0, 0.85, 0));
    return g;
  },
  drumBody() {
    const g = new THREE.Group(), wood = mat(0x9a3412), skin = mat(0xfde9c4, { roughness: 0.95, metalness: 0 }), gold = mat(0xe8b04a, { metalness: 0.6 });
    g.add(part(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 16, 1, true), wood, 0, 0, 0, Math.PI / 2));
    g.add(part(new THREE.CircleGeometry(0.42, 16), skin, 0, 0, 0.171));
    g.add(part(new THREE.CircleGeometry(0.42, 16), skin, 0, 0, -0.171, Math.PI));
    for (const z of [-0.15, 0.15]) g.add(part(new THREE.TorusGeometry(0.43, 0.025, 4, 18), gold, 0, 0, z));
    return g;
  },
  flute() {
    const g = new THREE.Group(), wood = mat(0xc08a4b, { metalness: 0.1 }), dark = mat(0x3b2412);
    g.add(part(new THREE.CylinderGeometry(0.04, 0.045, 1.25, 8), wood, 0, 0.45, 0));
    for (let i = 0; i < 5; i++) g.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6), dark, 0, 0.35 + i * 0.13, 0.04, Math.PI / 2));
    g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), dark, 0, 1.06, 0));
    return g;
  },
};
// Same frame as the KayKit 1H_Sword in handslot.r (turned 180 degrees about y).
function inHand(slot, obj) {
  obj.quaternion.set(0, -1, 0, 0); obj.position.set(0, 0.033, 0);
  obj.userData.style = 1;
  slot.add(obj);
  return obj;
}

// What each style shows: hide/show named attachments of the class rig, add extra meshes. Default styles: the rig as built.
const MODEL = {
  dual(r) { // a second sword in the off hand (a mirror of the borrowed main-hand one)
    const main = r.R.getObjectByName('1H_Sword');
    if (!main || !r.L) return;
    const off = main.clone(); off.position.set(0, 0.017, 0); off.quaternion.identity(); off.userData.style = 1;
    r.L.add(off); r.extra.push(off);
  },
  rapier(r) { r.hideR(); r.extra.push(inHand(r.R, BUILD.rapier())); },
  mace(r) { r.hideR(); r.show('Badge_Shield', false); r.show('Round_Shield', true); r.extra.push(inHand(r.R, BUILD.mace())); },
  spear(r) { r.hideR(); r.show('Badge_Shield', false); r.show('Rectangle_Shield', true); r.extra.push(inHand(r.R, BUILD.spear())); },
  tome(r) { r.hideR(); r.show('Spellbook', true); r.extra.push(inHand(r.R, BUILD.mace(0xe7c66a, 0.8))); },
  wand(r) { r.hideR(); r.show('1H_Wand', true); },
  // newer classes (their default weapons: the bow from public/classes-a.js, the axe of the barbarian rig, the spear and
  // lyre from public/classes-b.js)
  crossbow(r) { r.hideL(); r.extra.push(inHand(r.R, BUILD.crossbow())); },
  daggers(r) {
    r.hideL(); r.extra.push(inHand(r.R, BUILD.dagger()));
    if (r.L) { const off = BUILD.dagger(0xa7f3d0); off.position.set(0, 0.017, 0); off.userData.style = 1; r.L.add(off); r.extra.push(off); }
  },
  twinaxes(r) { r.hideR(); r.show('1H_Axe', true); r.show('1H_Axe_Offhand', true); },
  warhammer(r) { r.hideR(); r.extra.push(inHand(r.R, BUILD.warhammer())); },
  halberd(r) { r.hideR(); r.extra.push(inHand(r.R, BUILD.polearm('halberd'))); },
  glaive(r) { r.hideR(); r.extra.push(inHand(r.R, BUILD.polearm('glaive'))); },
  drum(r) {
    r.hideR(); r.extra.push(inHand(r.R, BUILD.drum()));
    if (r.L) { const d = BUILD.drumBody(); d.position.set(0, 0.25, 0.1); d.userData.style = 1; r.L.add(d); r.extra.push(d); }
  },
  flute(r) { r.hideR(); r.extra.push(inHand(r.R, BUILD.flute())); },
};

export function initStyles(ctx) {
  const { state, players, fx, sfx, shake, floatNum, rebuildBar } = ctx;
  const css = document.createElement('style'); css.textContent = CSS; document.head.appendChild(css);

  // ---------- weapon models ----------
  function setModel(e, id) {
    const root = e.model?.root;
    if (!root) return;
    const R = root.getObjectByName('handslotr'), L = root.getObjectByName('handslotl');
    if (!R) return;
    if (!e.styleBase) e.styleBase = [...R.children, ...(L?.children || [])].filter(o => !o.isBone).map(o => [o, o.visible]);
    for (const o of e.styleExtra || []) o.parent?.remove(o); // (geometry is per-entity; removeEntity disposes the rest)
    for (const [o, v] of e.styleBase) o.visible = v;
    const r = {
      R, L, extra: [],
      hideR() { for (const o of R.children) if (!o.isBone && !o.userData.style) o.visible = false; },
      hideL() { for (const o of L?.children || []) if (!o.isBone && !o.userData.style) o.visible = false; },
      show(name, on) { const o = root.getObjectByName(name); if (o) o.visible = on; },
    };
    MODEL[id]?.(r);
    e.styleExtra = r.extra;
  }

  // A snapshot row's style index for a player entity (mine: the local player).
  function snap(e, idx, mine) {
    const id = STYLE_IDS[idx];
    const want = id && STYLES[id].cls === e.cls ? id : null;
    if (e.style === want) return;
    e.style = want;
    if (want || e.styleBase) setModel(e, want);
    if (mine) { state.style = want; rebuildBar?.(); }
  }

  // ---------- the styled basic attack ----------
  const fwd = f => [Math.sin(f), Math.cos(f)];
  function event(e) {
    if (e.t !== 'fx' || e.k !== 'sty') return false;
    const me = state.myId, mine = e.id === me || e.by === me ? 1 : 0.6;
    const ent = players.get(e.id);
    if (e.ev === 'heal' || e.ev === 'aid') { // Mace & Tome heal on hit, Wand: healing the ally who Broke the enemy
      const t = players.get(e.id), g = t?.model.group.position;
      const x = g ? g.x : e.x, z = g ? g.z : e.z;
      fx.sparks(x, 1.4, z, e.ev === 'aid' ? 12 : 7, e.ev === 'aid' ? 0xa5f3fc : 0x86efac, 0.2, 4);
      fx.ring(x, z, e.ev === 'aid' ? 1.4 : 0.9, e.ev === 'aid' ? 0x67e8f9 : 0x4ade80, 0.35);
      if (e.ev === 'aid') sfx.play('heal', { x, z }, mine * 0.6);
      return true;
    }
    if (e.ev === 'mark') { // Twin Daggers: a hit marked the enemy
      fx.sparks(e.x, 1.4, e.z, 8, 0x2dd4bf, 0.2, 4);
      if (e.id === me) sfx.play('ui', { x: e.x, z: e.z }, 0.8);
      return true;
    }
    if (e.ev === 'reset') { // Twin Daggers: a kill readied Disengage
      if (ent && (e.to ?? e.id) === me) floatNum(ent.model.group.position, 2.6, 'Disengage ready', 'cdr'); // a proc: only for you
      if (e.id === me) state.ready[2] = performance.now();
      return true;
    }
    if (e.ev === 'cdr') { // Dual Blades: a Switch cut the cooldowns
      if (ent && (e.to ?? e.id) === me) floatNum(ent.model.group.position, 2.6, `−${e.a}s CD`, 'cdr');
      if (e.id === me) for (let i = 1; i < 4; i++) state.ready[i] = Math.max(performance.now(), (state.ready[i] || 0) - e.a * 1000);
      return true;
    }
    const S = STYLES[e.st], step = S?.basic?.steps[e.n];
    if (!step) return true;
    if (ent && !e.tw) {
      ent.swing = 0.3;
      const list = ANIM[e.st];
      if (list && ent.model.anim) { const [name, speed] = list[e.n % list.length]; ent.model.anim.shot(name, speed); } // basic-attack combo: not slowed by PACE
    }
    const ox = e.id === me ? state.x : e.x, oz = e.id === me ? state.z : e.z, at = { x: ox, z: oz };
    const [dx, dz] = fwd(e.f);
    switch (e.st) {
      case 'dual': {
        const off = e.tw ? -0.35 : e.n % 2 ? 0.3 : -0.3;
        fx.arc(ox, oz, e.f + off, e.r, e.h, e.fin ? 0xfde68a : 0xbfe3ff);
        if (e.fin) fx.arc(ox, oz, e.f - off, e.r * 0.92, e.h, 0xfef3c7);
        sfx.play(e.fin ? 'swingHeavy' : 'swing', at, mine * (e.tw ? 0.8 : 1));
        break;
      }
      case 'rapier': case 'spear': { // a thrust line, sparks at the tip
        const len = e.r, x2 = ox + dx * len, z2 = oz + dz * len;
        const rap = e.st === 'rapier';
        fx.line(ox + dx * 0.6, oz + dz * 0.6, x2, z2, rap ? 0xf8fafc : 0xfde68a, (rap ? 0.16 : 0.32) * (e.fin ? 1.8 : 1), rap ? 0.18 : 0.26, 1.15);
        fx.sparks(x2, 1.15, z2, e.fin ? 10 : 5, rap ? 0xe0f2fe : 0xfcd34d, 0.18, 5);
        if (e.fin) fx.ring(x2, z2, rap ? 0.9 : 1.3, rap ? 0xe0f2fe : 0xfbbf24, 0.3);
        sfx.play(e.fin ? 'swingHeavy' : 'swing', at, mine * (rap ? 0.85 : 1));
        break;
      }
      case 'mace': { // heavy blunt arcs; the finisher sends a shockwave ring out in front
        fx.arc(ox, oz, e.f, e.r, e.h, e.fin ? 0xf97316 : 0xfb923c);
        fx.sparks(ox + dx * e.r * 0.7, 0.5, oz + dz * e.r * 0.7, 6, 0xa8a29e, 0.2, 4); // dust kicked up by the blow
        if (e.fin) {
          const cx = ox + dx * 1.8, cz = oz + dz * 1.8;
          fx.ring(cx, cz, 3.2, 0xf59e0b, 0.45); fx.ring(cx, cz, 1.8, 0xfef3c7, 0.3);
          fx.sparks(cx, 0.4, cz, 14, 0xfdba74, 0.25, 6);
          if (e.id === me) shake(0.22);
          sfx.play('boom', at, mine * 0.7);
        }
        sfx.play('swingHeavy', at, mine);
        break;
      }
      case 'tome': { // golden arcs; the third blow is a shockwave all around (Smite)
        if (e.fin) {
          fx.ring(ox, oz, e.r, 0xfde047, 0.45); fx.ring(ox, oz, e.r * 0.6, 0xfffbeb, 0.3);
          fx.sparks(ox, 0.5, oz, 16, 0xfde047, 0.22, 7);
          if (e.id === me) shake(0.18);
          sfx.play('bolt', at, mine);
        } else {
          fx.arc(ox, oz, e.f, e.r, e.h, 0xfacc15);
          fx.sparks(ox + dx * e.r * 0.7, 1.0, oz + dz * e.r * 0.7, 5, 0xfef9c3, 0.16, 4); // motes of light
        }
        sfx.play(e.fin ? 'swingHeavy' : 'swing', at, mine);
        break;
      }
      case 'daggers': { // quick crossing teal slashes; the 4th is a pair of stabs
        const off = e.tw ? 0.35 : e.n % 2 ? -0.25 : 0.25;
        fx.arc(ox, oz, e.f + off, e.r, e.h * 0.8, e.fin ? 0x5eead4 : 0xccfbf1);
        if (e.fin) fx.sparks(ox + dx * e.r * 0.8, 1.1, oz + dz * e.r * 0.8, 6, 0x99f6e4, 0.16, 5);
        sfx.play('swing', at, mine * (e.tw ? 0.7 : 0.9));
        break;
      }
      case 'halberd': { // a wide sweeping arc with a steel edge; the third is a broad spin
        fx.arc(ox, oz, e.f, e.r, e.h, e.fin ? 0xfca5a5 : 0xe2e8f0);
        fx.arc(ox, oz, e.f, e.r * 0.75, e.h, 0xb91c1c);
        for (const id of e.tip || []) { fx.sparks(ox + dx * e.r * 0.85, 1.2, oz + dz * e.r * 0.85, 4, 0xfecaca, 0.2, 5); break; }
        sfx.play(e.fin ? 'swingHeavy' : 'swing', at, mine);
        break;
      }
      case 'drum': { // a ring of sound around the drummer; the third beat is a big boom
        fx.ring(ox, oz, e.r, e.fin ? 0xf59e0b : 0xfdba74, e.fin ? 0.45 : 0.3);
        fx.ring(ox, oz, e.r * 0.55, 0xfde68a, 0.25);
        fx.sparks(ox, 0.3, oz, e.fin ? 14 : 6, 0xfcd34d, 0.2, 6);
        if (e.fin && e.id === me) shake(0.12);
        sfx.play(e.fin ? 'boom' : 'hitHeavy', at, mine * (e.fin ? 0.6 : 0.7));
        break;
      }
      case 'wand': { // a quick thin violet bolt
        fx.line(ox + dx * 0.7, oz + dz * 0.7, e.x2, e.z2, 0xc4b5fd, 0.12, 0.2, 1.3);
        fx.ring(e.x2, e.z2, 0.8, 0xa78bfa, 0.22);
        fx.sparks(e.x2, 1.2, e.z2, 5, 0xddd6fe, 0.16, 4);
        sfx.play('bolt', at, mine * 0.7);
        break;
      }
    }
    return true;
  }

  // ---------- the local player's basic attack ----------
  const myBasic = () => STYLES[state.style]?.basic || null;
  // null: the class default. base: the class basic's cooldown now (styles that only scale it: Crossbow, Twin Axes, ...)
  const basicCd = base => myBasic()?.cd ?? (base && STYLES[state.style]?.mods?.basicCd ? base * STYLES[state.style].mods.basicCd : null);
  const aim = () => myBasic()?.aim ?? STYLES[state.style]?.mods?.aim ?? null;

  // ---------- text ----------
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Bag / tooltip line for an item: the style name, and its passive and skill tweak.
  function tag(it) {
    if (it?.slot !== 'weapon' || !it.cls) return '';
    const s = STYLES[styleOf(it, it.cls)];
    if (!s) return '';
    return ` · <span class="sty" title="${esc(s.desc)}">${esc(s.name)}</span>${s.def ? '' : `<span class="sty-p">${esc(s.passive)} ${esc(s.tweak)}</span>`}`;
  }
  const title = it => { const s = it?.slot === 'weapon' && it.cls ? STYLES[styleOf(it, it.cls)] : null; return s ? `${s.name}: ${s.desc}${s.def ? '' : ` Passive: ${s.passive} ${s.tweak}`}` : ''; };
  // A short badge for a weapon's style on an item card (public/itemcard.js); the default style shows none.
  const styleName = it => { const s = it?.slot === 'weapon' && it.cls ? STYLES[styleOf(it, it.cls)] : null; return s && !s.def ? s.name : ''; };
  // A shop line's weapon style (the alternate style of your class), or null: { name, passive, desc }.
  function shopStyle(s, cls) {
    if (s.slot !== 'weapon') return null;
    const id = s.alt ? altStyle(cls) : null;
    return id ? STYLES[id] : null;
  }
  const barNote = () => { const s = STYLES[state.style]; return s ? ` [${s.name}] ${s.def ? '' : s.desc}` : ''; };

  const ownsBasic = () => !!myBasic(); // the style replaces the class's basic attack (Twin Daggers, Halberd, War Drum, ...)

  return { snap, event, basicCd, aim, ownsBasic, tag, title, styleName, shopStyle, barNote };
}
