// Client side of the boss team mechanics (docs/ROADMAP.md G4, server/bossteam.js): the gold STACK circle that follows
// the meteor's carrier, the violet SPREAD rings on marked players, and the tether beam (red while too close, green once
// far enough). A short prompt the first few times each one involves you, plus a one-time guide tip.
// main.js: const bossTeam = initBossTeam({...}); handleEvent: if (bossTeam.event(e)) return. (Meshes live in fx: no frame hook.)
import * as THREE from 'three';

const PROMPTS = 3; // times each prompt shows (per browser)

const CSS = `
.num.stack { color: #fde68a; font-size: 22px; letter-spacing: .08em; text-shadow: 0 0 12px #f59e0b, 0 2px 4px #000; }
.num.stack.bad { color: #fca5a5; text-shadow: 0 0 12px #ef4444, 0 2px 4px #000; }
.num.spread { color: #e9d5ff; font-size: 20px; letter-spacing: .06em; text-shadow: 0 0 12px #a855f7, 0 2px 4px #000; }
.num.tether { color: #bbf7d0; font-size: 18px; letter-spacing: .06em; text-shadow: 0 0 10px #22c55e, 0 2px 4px #000; }
`;

// A word on a sprite above a head ("STACK", "SPREAD"), drawn once per word and colour.
const LABELS = new Map();
function labelTex(text, color) {
  const key = `${text}|${color}`;
  if (LABELS.has(key)) return LABELS.get(key);
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 128, 34);
  g.fillStyle = color; g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  LABELS.set(key, tex);
  return tex;
}
function label(text, color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(text, color), transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(3.6, 0.9, 1); s.renderOrder = 10;
  return s;
}

export function initBossTeam({ state, players, fx, sfx, guide, callout, floatNum }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const live = new Map(); // key -> fx entry (to end early)
  const me = () => state.myId;
  const ent = id => players.get(id);
  const posOf = id => ent(id)?.model?.group.position || (id === me() ? { x: state.x, z: state.z } : null);
  const nameOf = id => (id === me() ? 'you' : state.roster?.get?.(id)?.name || ent(id)?.name || 'a partymate');
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  const flat = m => { m.rotation.x = -Math.PI / 2; return m; };

  function add(key, mesh, life, update) {
    fx.add(mesh, life, update);
    const entry = fx.list[fx.list.length - 1];
    if (key) { end(key); live.set(key, entry); }
    return entry;
  }
  function end(key) { const e = live.get(key); if (e) e.age = Math.max(e.age, e.life); live.delete(key); }

  function prompt(k, title, sub, secs) {
    const n = +(localStorage.getItem(`fb_bt_${k}`) || 0);
    guide.tip(`bt_${k}`);
    if (n >= PROMPTS || state.spectator) return;
    try { localStorage.setItem(`fb_bt_${k}`, String(n + 1)); } catch {}
    callout(title, sub, secs);
  }

  // A ground circle following a player: a fill growing to the edge as it lands, a closing ring, a word above the head.
  function marker(key, id, r, life, color, word, wordColor) {
    const g = new THREE.Group();
    const base = flat(new THREE.Mesh(new THREE.CircleGeometry(r, 56), mat(color, 0.14)));
    const edge = flat(new THREE.Mesh(new THREE.RingGeometry(r - 0.45, r, 64), mat(color, 0.95)));
    const fill = flat(new THREE.Mesh(new THREE.CircleGeometry(r, 56), mat(color, 0.38)));
    const closer = flat(new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), mat(0xffffff, 0.7)));
    base.position.y = 0; fill.position.y = 0.006; edge.position.y = 0.01; closer.position.y = 0.014;
    const tag = label(word, wordColor); tag.position.y = 4.4; // above the nameplate
    g.add(base, fill, edge, closer, tag);
    const p0 = posOf(id); if (p0) g.position.set(p0.x, 0.1, p0.z);
    return add(key, g, life, (m, k) => {
      const p = posOf(id); if (p) m.position.set(p.x, 0.1, p.z);
      fill.scale.setScalar(Math.max(0.01, k * k * (3 - 2 * k)));
      closer.scale.setScalar(r * (1.5 - 0.5 * k)); closer.material.opacity = 0.3 + 0.6 * k;
      edge.material.opacity = 0.6 + 0.35 * Math.sin(k * (12 + 20 * k));
      tag.material.opacity = 0.75 + 0.25 * Math.sin(k * 30);
      const s = 1 + 0.12 * Math.sin(k * 18); tag.scale.set(3.6 * s, 0.9 * s, 1);
    });
  }

  // The tether: a glowing beam between the two ends; red while they're too close, green once they're far enough.
  function tether(e) {
    const key = `te:${e.a}:${e.b}`;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 8, 1, true), mat(0xef4444, 0.95));
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 10, 1, true), mat(0xef4444, 0.25));
    const g = new THREE.Group(); g.add(beam, glow);
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), red = new THREE.Color(0xef4444), green = new THREE.Color(0x22c55e);
    let t = 0;
    add(key, g, e.d + 0.3, (m, k, dt) => {
      t += dt || 0;
      const a = posOf(e.a), b = posOf(e.b);
      if (!a || !b) { m.visible = false; return; }
      m.visible = true;
      const ax = a.x, az = a.z, bx = b.x, bz = b.z, d = Math.hypot(bx - ax, bz - az) || 0.01;
      m.position.set((ax + bx) / 2, 1.3, (az + bz) / 2);
      dir.set(bx - ax, 0, bz - az).normalize(); m.quaternion.setFromUnitVectors(up, dir);
      m.scale.set(1, d, 1);
      const far = Math.min(1, d / e.need), c = far >= 1 ? green : red;
      beam.material.color.copy(c); glow.material.color.copy(c);
      const pulse = t > e.g ? 0.5 + 0.5 * Math.sin(t * 14) : 0.3; // ticking: pulses fast
      glow.material.opacity = 0.15 + 0.25 * pulse; glow.scale.set(1 + 0.6 * pulse * (1 - far), 1, 1 + 0.6 * pulse * (1 - far));
    });
  }

  function event(e) {
    if (e.t === 'bt') {
      const mine = e.k === 'stack' ? true : e.k === 'spread' ? e.ids.includes(me()) : e.a === me() || e.b === me();
      if (e.k === 'stack') {
        marker(`st:${e.id}`, e.id, e.r, e.d, 0xfbbf24, 'STACK', '#fde68a');
        sfx.play('warn', posOf(e.id) || undefined, 1.1);
        if (e.id === me()) prompt('stack', 'STACK ON YOU', 'A shared meteor: gather your party in the gold circle. Alone it nearly kills you.', e.d);
        else prompt('stack', 'STACK', `Get in the gold circle with ${nameOf(e.id)}: the hit is split between everyone inside.`, e.d);
      } else if (e.k === 'spread') {
        for (const id of e.ids) marker(`sp:${id}`, id, e.r, e.d, 0xa855f7, 'SPREAD', '#e9d5ff');
        sfx.play('warn', undefined, 0.8);
        if (mine) prompt('spread', 'SPREAD: YOU ARE MARKED', `Move away from everyone: you burst in ${e.r} m.`, e.d);
        else prompt('spread', 'SPREAD', 'Stay out of the violet rings: each marked player bursts.', e.d);
      } else if (e.k === 'tether') {
        tether(e);
        if (mine) prompt('tether', 'TETHERED', `To ${nameOf(e.a === me() ? e.b : e.a)}: get ${e.need} m apart to snap it.`, Math.min(e.d, 4));
        else guide.tip('bt_tether');
      }
      return true;
    }
    if (e.t === 'btend') {
      if (e.k === 'stack') {
        end(`st:${e.id}`);
        const p = posOf(e.id);
        if (p && e.n && !e.off) {
          floatNum(p, 2.6, e.n >= 2 ? `STACKED ×${e.n}` : 'ALONE!', e.n >= 2 ? 'stack' : 'stack bad');
          fx.ring(e.x, e.z, e.r, 0xfbbf24, 0.6); fx.ring(e.x, e.z, e.r * 0.6, 0xfff7d6, 0.45);
        }
      } else if (e.k === 'spread') {
        for (const id of e.ids) {
          end(`sp:${id}`);
          const p = posOf(id);
          if (p && !e.off) fx.ring(p.x, p.z, 6, 0xa855f7, 0.5);
        }
        if (e.clean?.includes(me())) floatNum(posOf(me()), 2.6, 'CLEAN', 'spread');
      } else if (e.k === 'tether') {
        end(`te:${e.a}:${e.b}`);
        if (e.ok) for (const id of [e.a, e.b]) { const p = posOf(id); if (p && (id === me() || e.a === me() || e.b === me())) floatNum(p, 2.6, 'SNAPPED', 'tether'); }
      }
      return true;
    }
    return false;
  }

  return { event };
}
