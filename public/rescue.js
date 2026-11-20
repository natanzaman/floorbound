// Rescue traps on the client (docs/ROADMAP.md J1, server/rescue.js):
//  - makePropModel(type): the trap objects (world.js makeMobModel): a cage of thorn vines, the Drowning Pillar's orb on
//    its plinth, the storm crystal around its prisoner. They're ordinary mobs with an HP bar (hit them to break them).
//  - The telegraph ('trap'): a closing ring and a word over the victim. Landed ('trapon'): the pillar's column of
//    moonlit water and the beam from its orb (dim while a Guardian blocks it); vines and crystals are the props.
//  - You, trapped: a banner with the seconds left and what your party has to do; your movement is held (moveCap).
//  - Next to a partymate in vines: "Hold E to cut <name> free" (a revive in reach wins: usesE / revive.usesE first).
//  - A marker over every trapped partymate (everyone's for spectators), through walls, with the seconds left.
//  - The first three times each trap involves you: a callout; a one-time guide tip.
import * as THREE from 'three';
import { RESCUE, readTraps } from '/shared/rescue.js';
import { col, patterned, cue } from '/palette.js'; // telegraph colours, pattern cue, sound cue (Settings → Accessibility)
import { keyName } from '/keyname.js'; // prompts name the player's key on the active device

const PROMPTS = 3;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLOR_NAME = { vines: 'trapVines', pillar: 'trapPillar', crystal: 'trapCrystal' }, COLOR = k => col(COLOR_NAME[k]);
const WORD = { vines: ['THORNBIND', '#bef264'], pillar: ['PILLAR', '#bae6fd'], crystal: ['CRYSTAL', '#a5f3fc'] };

const CSS = `
#trapped { position: fixed; left: 50%; top: 18vh; transform: translateX(-50%); z-index: 6; pointer-events: none; text-align: center;
  padding: 10px 18px; border-radius: 12px; background: rgba(8,16,24,.78); border: 1px solid rgba(125,211,252,.55); text-shadow: 0 1px 3px #000; }
#trapped.vines { border-color: rgba(163,230,53,.6); }
#trapped .tp-title { font-size: 22px; font-weight: 800; letter-spacing: .12em; }
#trapped .tp-sub { font-size: 14px; max-width: min(420px, 86vw); opacity: .92; }
#trapped .tp-bar { width: 220px; height: 7px; border-radius: 4px; background: rgba(255,255,255,.18); overflow: hidden; margin: 6px auto 0; }
#trapped .tp-bar > div { height: 100%; background: #4ade80; transition: width .1s linear; }
#free-prompt { position: fixed; left: 50%; bottom: calc(max(14px, env(safe-area-inset-bottom)) + 150px); transform: translateX(-50%); z-index: 6;
  padding: 10px 18px; border-radius: 12px; background: rgba(12,22,8,.82); border: 1px solid rgba(163,230,53,.6); font-size: 16px; font-weight: 700;
  display: grid; justify-items: center; text-shadow: 0 1px 3px #000; pointer-events: auto; user-select: none; touch-action: none; }
#free-prompt b { color: #bef264; padding: 0 5px; border: 1px solid rgba(190,242,100,.7); border-radius: 4px; }
#free-prompt .fp-bar { width: 200px; height: 8px; border-radius: 4px; background: rgba(255,255,255,.18); overflow: hidden; margin-top: 4px; }
#free-prompt .fp-bar > div { height: 100%; background: #bef264; transition: width .1s linear; }
.tp-mark { position: absolute; left: 0; top: 0; display: grid; justify-items: center; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-shadow: 0 1px 3px #000; }
.tp-mark .ic { width: 26px; height: 26px; border-radius: 50%; display: grid; place-content: center; font-size: 15px; border: 2px solid currentColor; background: rgba(0,0,0,.45); }
.tp-mark.vines { color: #bef264; } .tp-mark.pillar { color: #7dd3fc; } .tp-mark.crystal { color: #67e8f9; }
.num.trap { color: #e0f2fe; font-size: 20px; letter-spacing: .06em; text-shadow: 0 0 12px #0ea5e9, 0 2px 4px #000; }
.num.trap.bad { color: #fca5a5; text-shadow: 0 0 12px #ef4444, 0 2px 4px #000; }
`;

// ---------- trap object models (world.js makeMobModel) ----------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
export function makePropModel(type) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const mats = [];
  const part = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); m.castShadow = true; if (!mats.includes(mat)) mats.push(mat); return m; };
  let height = 2;
  if (type === 'vine') { // Thornbind: thick thorny vines coiling up around the victim
    const vine = std(0x3f6b1f, { emissive: 0x0f2a05 }), thorn = std(0xd9c79a), dark = std(0x2a4a14);
    part(new THREE.CylinderGeometry(1.0, 1.25, 0.35, 10), dark, 0, 0.17, 0);
    for (let i = 0; i < 4; i++) {
      const coil = part(new THREE.TorusGeometry(0.78 - i * 0.06, 0.09, 6, 18), vine, 0, 0.45 + i * 0.42, 0);
      coil.rotation.x = Math.PI / 2 + (i % 2 ? 0.28 : -0.28); coil.rotation.y = i * 0.9;
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, x = Math.sin(a) * 0.82, z = Math.cos(a) * 0.82;
      const stalk = part(new THREE.CylinderGeometry(0.05, 0.11, 2.1, 6), vine, x, 1.05, z);
      stalk.rotation.z = Math.sin(a) * 0.12; stalk.rotation.x = -Math.cos(a) * 0.12;
      for (let t = 0; t < 3; t++) { const c = part(new THREE.ConeGeometry(0.05, 0.22, 4), thorn, x * 1.08, 0.5 + t * 0.6, z * 1.08); c.rotation.z = -Math.sin(a) * 1.4; c.rotation.x = Math.cos(a) * 1.4; }
    }
    height = 2.2;
  } else if (type === 'tideorb') { // the Drowning Pillar's source: a moonlit water orb over a sunken plinth
    const stone = std(0x4b5563), rim = std(0x1e3a5f, { emissive: 0x0b2440 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x38bdf8, emissiveIntensity: 1.4, roughness: 0.2 });
    part(new THREE.CylinderGeometry(0.75, 0.95, 1.1, 8), stone, 0, 0.55, 0);
    part(new THREE.TorusGeometry(0.62, 0.08, 6, 20), rim, 0, 1.12, 0).rotation.x = Math.PI / 2;
    const orb = part(new THREE.SphereGeometry(0.55, 18, 14), glow, 0, 2.1, 0);
    const halo = part(new THREE.TorusGeometry(0.85, 0.05, 6, 28), glow, 0, 2.1, 0);
    orb.userData.bob = true; halo.userData.spin = true;
    height = 2.8;
  } else { // storm crystal: a tall six-sided crystal around its prisoner, shards at the base
    const ice = new THREE.MeshStandardMaterial({ color: 0x9be7ff, emissive: 0x0e7490, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false });
    const shard = std(0x67e8f9, { emissive: 0x155e75 });
    part(new THREE.CylinderGeometry(1.05, 1.15, 2.4, 6), ice, 0, 1.2, 0);
    part(new THREE.ConeGeometry(1.05, 0.9, 6), ice, 0, 2.85, 0);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.3; const c = part(new THREE.ConeGeometry(0.22, 0.9, 5), shard, Math.sin(a) * 1.25, 0.35, Math.cos(a) * 1.25); c.rotation.z = Math.sin(a) * 0.5; c.rotation.x = -Math.cos(a) * 0.5; }
    height = 3.3;
  }
  const cursor = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  cursor.scale.y = 1.6; cursor.position.y = height + 0.35; g.add(cursor);
  return { group: g, body, legs: [], armR: null, cursor, mats, height };
}

// A word on a sprite above a head.
const LABELS = new Map();
function label(text, color) {
  const key = `${text}|${color}`;
  let tex = LABELS.get(key);
  if (!tex) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 64;
    const g = c.getContext('2d');
    g.font = '900 42px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 160, 34);
    g.fillStyle = color; g.fillText(text, 160, 34);
    LABELS.set(key, tex = new THREE.CanvasTexture(c));
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(4.4, 0.9, 1); s.renderOrder = 10;
  return s;
}

export function initRescue({ state, players, mobs, send, project, layer, guide, sfx, fx, floatNum, callout, isTouch, revive, keyLabel = () => 'E' }) { // keyLabel(action): the key the prompt names (input.label)
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const banner = document.createElement('div'); banner.id = 'trapped'; banner.className = 'hidden';
  banner.innerHTML = '<div class="tp-title"></div><div class="tp-sub"></div><div class="tp-bar"><div></div></div>';
  document.body.appendChild(banner);
  const prompt = document.createElement('div'); prompt.id = 'free-prompt'; prompt.className = 'hidden';
  document.body.appendChild(prompt);
  let touchHeld = false, sent = 0, sentAt = 0, lastPrompt = '', lastBanner = '';
  prompt.addEventListener('pointerdown', e => { touchHeld = true; e.preventDefault(); });
  for (const k of ['pointerup', 'pointercancel', 'pointerleave']) prompt.addEventListener(k, () => { touchHeld = false; });
  const markers = new Map(), live = new Map();
  const me = () => state.myId;
  const ent = id => players.get(id);
  const posOf = id => ent(id)?.model?.group.position || (id === me() ? { x: state.x, z: state.z } : null);
  const name = id => (id === me() ? 'you' : state.roster?.get?.(id)?.name || ent(id)?.name || 'a partymate');
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  const mine = id => id === me() || (!!state.party && ent(id)?.party === state.party);
  let traps = new Map();

  function add(key, mesh, life, update) {
    fx.add(mesh, life, update);
    const entry = fx.list[fx.list.length - 1];
    end(key); live.set(key, entry);
  }
  function end(key) { const e = live.get(key); if (e) e.age = Math.max(e.age, e.life); live.delete(key); }

  function tell(k, title, sub, secs) {
    guide.tip(`trap_${k}`);
    const n = +(localStorage.getItem(`fb_trap_${k}`) || 0);
    if (n >= PROMPTS || state.spectator) return;
    try { localStorage.setItem(`fb_trap_${k}`, String(n + 1)); } catch {}
    callout(title, sub, secs);
  }

  // The telegraph: a ground ring closing on the victim, the trap's name over their head.
  function telegraph(e) {
    const color = COLOR(e.k), [word, wc] = WORD[e.k];
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), mat(color, 0.35)); fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02;
    const edge = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.6, 48), mat(color, 0.95)); edge.rotation.x = -Math.PI / 2; edge.position.y = 0.03;
    const closer = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), mat(0xffffff, 0.7)); closer.rotation.x = -Math.PI / 2; closer.position.y = 0.04;
    const tag = label(word, wc); tag.position.y = 4.4;
    g.add(fill, edge, closer, tag);
    if (patterned()) g.add(fx.dashes(1.6)); // colour-blind palettes: a dashed ring as well
    add(`tele:${e.id}`, g, e.d + 0.1, (m, k) => {
      const p = posOf(e.id); if (p) m.position.set(p.x, 0.1, p.z);
      fill.scale.setScalar(Math.max(0.01, k));
      closer.scale.setScalar(1.6 * (3 - 2 * k));
      tag.material.opacity = 0.7 + 0.3 * Math.sin(k * 30);
    });
  }

  // The Drowning Pillar: a column of moonlit water over the victim and a beam from its orb (dim while blocked).
  function pillar(e) {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.4, 26, 18, 1, true), mat(0x7dd3fc, 0.28));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 26, 14, 1, true), mat(0xe0f2fe, 0.22));
    col.position.y = core.position.y = 13;
    const pool = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.5, 32), mat(0x38bdf8, 0.5)); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.05;
    g.add(col, core, pool); g.position.set(e.x, 0, e.z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 8, 1, true), mat(0xbae6fd, 0.9));
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1, 10, 1, true), mat(0x38bdf8, 0.25));
    const link = new THREE.Group(); link.add(beam, glow); g.add(link);
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), a = new THREE.Vector3(e.sx - e.x, 2.1, e.sz - e.z), b = new THREE.Vector3(0, 1.3, 0);
    dir.subVectors(b, a); const len = dir.length(); dir.normalize();
    link.position.copy(a).add(b).multiplyScalar(0.5); link.quaternion.setFromUnitVectors(up, dir); link.scale.set(1, len, 1);
    let t = 0;
    add(`pil:${e.id}`, g, e.d + 0.5, (m, k, dt) => {
      t += dt || 0;
      const blocked = traps.get(e.id)?.blocked;
      col.material.opacity = 0.22 + 0.08 * Math.sin(t * 5); core.material.opacity = 0.18 + 0.1 * Math.sin(t * 7 + 1);
      col.rotation.y += (dt || 0) * 0.6;
      beam.material.color.setHex(blocked ? 0xfbbf24 : 0xbae6fd); glow.material.color.setHex(blocked ? 0xf59e0b : 0x38bdf8);
      beam.material.opacity = blocked ? 0.45 : 0.9; glow.material.opacity = (blocked ? 0.12 : 0.2) + 0.12 * Math.sin(t * 12);
    });
  }

  function event(e) {
    if (e.t === 'trap') {
      telegraph(e);
      sfx.play('warn', posOf(e.id) || undefined, 1);
      if (e.id === me()) cue(sfx, undefined, 1.2); // a trap targeting you
      const you = e.id === me(), who = name(e.id);
      if (e.k === 'vines') tell('vines', you ? 'THORNBIND ON YOU' : 'THORNBIND', you ? 'Vines will root you: your party cuts you free.' : `${who} is about to be rooted: hit the vines or hold ${keyName('revive')} next to them.`, e.d + 1);
      else if (e.k === 'pillar') tell('pillar', you ? 'DROWNING PILLAR ON YOU' : 'DROWNING PILLAR', you ? 'You will be pinned: your party breaks the glowing orb that feeds it.' : `Break the orb feeding ${who}'s pillar (a Guardian can block the beam).`, e.d + 1);
      else tell('crystal', you ? 'STORM CRYSTAL ON YOU' : 'STORM CRYSTAL', you ? 'You will be sealed in: your party has 8 s to break the crystal.' : `Break ${who}'s crystal in 8 s or it explodes on everyone!`, e.d + 1);
      return true;
    }
    if (e.t === 'trapon') {
      end(`tele:${e.id}`);
      if (e.k === 'pillar') pillar(e);
      fx.ring(e.x, e.z, 2.2, COLOR(e.k), 0.5);
      sfx.play(e.k === 'crystal' ? 'shatter' : 'hurt', { x: e.x, z: e.z }, 0.8);
      return true;
    }
    if (e.t === 'free') return true;
    if (e.t === 'trapend') {
      end(`tele:${e.id}`); end(`pil:${e.id}`);
      const p = posOf(e.id);
      if (e.why === 'freed') {
        if (p) floatNum(p, 2.8, 'FREED!', 'trap');
        if (e.by === me() && e.id !== me()) guide.did?.('rescue');
        sfx.play('heal', p ? { x: p.x, z: p.z } : undefined, e.id === me() || e.by === me() ? 1.1 : 0.7);
      } else if (e.why === 'boom') {
        if (p) floatNum(p, 2.8, 'CRYSTAL BURST!', 'trap bad');
        fx.ring(e.x, e.z, 10, 0x67e8f9, 0.7);
      } else if (e.why === 'alone' && e.id === me() && p) floatNum(p, 2.8, 'Released', 'trap');
      if (e.id === me()) sent = 0;
      return true;
    }
    return false;
  }

  function snap(list) {
    traps = readTraps(list);
    for (const [id, e] of players) e.trap = traps.get(id) || null;
    state.trap = state.spectator ? null : traps.get(me()) || null;
  }

  // The vines-trapped partymate you can free right now (nearest in reach), or null. A revive in reach comes first.
  function freeTarget() {
    if (!state.joined || state.spectator || state.dead || state.downed || state.trap || revive?.usesE()) return null;
    let best = null, bd = RESCUE.vines.reach;
    for (const p of players.values()) {
      if (p.trap?.k !== 'vines' || p.id === me() || p.dead) continue;
      if (p.trap.by && p.trap.by !== me()) continue;
      const d = Math.hypot(p.model.group.position.x - state.x, p.model.group.position.z - state.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function frame(keys, dt = 0.016) {
    // you, trapped
    const T = state.trap;
    banner.classList.toggle('hidden', !T);
    if (T) {
      const what = T.k === 'vines' ? ['THORNBIND', 'Rooted: your party hits the vines or holds E next to you.'] : T.k === 'pillar' ? ['DROWNING PILLAR', T.blocked ? 'A Guardian is blocking the beam!' : 'Pinned: your party breaks the glowing orb (or a Guardian blocks the beam).'] : ['ENCASED', 'Your party must break the crystal before it explodes.'];
      const html = `${what[0]} · ${Math.ceil(T.left)}s|${what[1]}|${T.k}`;
      if (html !== lastBanner) {
        lastBanner = html; banner.className = T.k;
        banner.querySelector('.tp-title').textContent = `${what[0]} · ${Math.ceil(T.left)}s`;
        banner.querySelector('.tp-sub').textContent = what[1];
      }
      banner.querySelector('.tp-bar').style.visibility = T.prog > 0 ? 'visible' : 'hidden';
      banner.querySelector('.tp-bar > div').style.width = `${Math.round(T.prog * 100)}%`;
    }
    // you, next to a partymate in vines: hold E
    const t = freeTarget();
    const typing = document.activeElement?.id === 'chat-input';
    const held = !!t && !typing && (keys.has('e') || touchHeld), now = performance.now();
    if (held) {
      if (sent !== t.id || (t.trap.by !== me() && now - sentAt > 400)) { send({ type: 'free', on: 1, id: t.id }); sent = t.id; sentAt = now; }
    } else if (sent) { send({ type: 'free', on: 0 }); sent = 0; }
    const ph = t ? `<div>${t.trap.by === me() ? 'Cutting' : isTouch ? 'Hold here to cut' : `Hold <b>${esc(keyLabel('revive'))}</b> to cut`} ${esc(name(t.id))} free</div><div class="fp-bar"><div style="width:${Math.round((t.trap.by === me() ? t.trap.prog : 0) * 100)}%"></div></div>` : '';
    if (ph !== lastPrompt) { lastPrompt = ph; prompt.innerHTML = ph; prompt.classList.toggle('hidden', !t); }
    // markers over trapped partymates (all of them for spectators), through walls
    const seen = new Set();
    for (const p of players.values()) {
      if (!p.trap || p.dead || p.id === me()) continue;
      if (!state.spectator && !mine(p.id)) continue;
      const g = p.model.group.position, sp = project(g.x, g.y + 3.6, g.z);
      if (!sp) continue;
      seen.add(p.id);
      let el = markers.get(p.id);
      if (!el) { el = document.createElement('div'); el.innerHTML = '<div class="ic"></div><div class="nm"></div>'; layer.appendChild(el); markers.set(p.id, el); }
      el.className = `tp-mark ${p.trap.k}`;
      el.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%)`;
      el.querySelector('.ic').textContent = p.trap.k === 'vines' ? '❦' : p.trap.k === 'pillar' ? '☾' : '◆';
      const nm = `${esc(name(p.id))} · ${Math.ceil(p.trap.left)}s`;
      if (el.querySelector('.nm').innerHTML !== nm) el.querySelector('.nm').innerHTML = nm;
    }
    for (const [id, el] of markers) if (!seen.has(id)) { el.remove(); markers.delete(id); }
    // the orb bobs, its halo turns
    for (const m of mobs.values()) {
      if (m.type !== 'tideorb' || !m.model) continue;
      m.model.group.traverse(o => { if (o.userData.bob) o.position.y = 2.1 + Math.sin(now / 400) * 0.15; if (o.userData.spin) o.rotation.x += dt * 1.5; });
    }
  }

  return {
    snap, event, frame,
    rooted: () => !!state.trap, // no walking or rolling (a jump in place is fine)
    encased: () => state.trap?.k === 'crystal', // no skills or items either
    usesE: () => !!freeTarget(),
    moveCap: want => (state.trap ? 0 : want),
  };
}
