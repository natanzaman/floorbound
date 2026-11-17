// Client side of weapon styles (data: shared/styles.js, server: server/styles.js).
// - Swaps the held weapon on each character to match the style in its snapshot row ([11]).
// - Plays the styled basic attack: animation per combo step, distinct hit effects and sounds per style.
// - Tooltip / bag text, the merchant's alternate weapon, the local player's basic-attack cooldown and auto-aim range.
// main.js calls initStyles() once and routes snapshot rows (snap) and events (event) here.
import * as THREE from 'three';
import { STYLES, STYLE_IDS, altStyle, styleOf } from '/shared/styles.js';

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
    if (e.ev === 'cdr') { // Dual Blades: a Switch cut the cooldowns
      if (ent) floatNum(ent.model.group.position, 2.6, `−${e.a}s CD`, 'cdr');
      if (e.id === me) for (let i = 1; i < 4; i++) state.ready[i] = Math.max(performance.now(), (state.ready[i] || 0) - e.a * 1000);
      return true;
    }
    const S = STYLES[e.st], step = S?.basic?.steps[e.n];
    if (!step) return true;
    if (ent && !e.tw) {
      ent.swing = 0.3;
      const list = ANIM[e.st];
      if (list && ent.model.anim) { const [name, speed] = list[e.n % list.length]; ent.model.anim.shot(name, speed); }
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
  const basicCd = () => myBasic()?.cd ?? null;   // null: the class default
  const aim = () => myBasic()?.aim ?? null;

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
  function shopName(s, cls) {
    if (s.slot !== 'weapon') return null;
    const id = s.alt ? altStyle(cls) : null;
    return id ? `Uncommon ${STYLES[id].name} (${STYLES[id].passive})` : null;
  }
  const barNote = () => { const s = STYLES[state.style]; return s ? ` [${s.name}] ${s.def ? '' : s.desc}` : ''; };

  return { snap, event, basicCd, aim, tag, title, shopName, barNote };
}
