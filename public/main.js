// Floorbound browser client: networking, input, camera, entities and HUD.
import * as THREE from 'three';
import {
  CLASSES, CLASS_IDS, MOBS, MOB_IDS, PLAYER_SPEED, TICK_RATE, MAX_LEVEL,
  walkable, resolveCollision, inTown, inArena, areaName, angleTo,
} from '/shared/data.js';
import { createWorld, makePlayerModel, makeMobModel, Effects, loadAssets } from '/world.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------------- renderer & scene ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
const { sun, crystal, occluders, treeFader } = createWorld(scene);
const ray = new THREE.Raycaster();
let camCur = 11;
const fx = new Effects(scene);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------------- state ----------------
const state = {
  ws: null, myId: 0, seq: 0, x: 0, z: 0, face: 0, cls: 'swordsman', lvl: 1, hp: 1, maxHp: 1, xp: 0, next: 50,
  dead: false, party: 0, joined: false, yaw: 0, pitch: 0.5, camDist: 11,
  ready: [0, 0, 0, 0], lastPress: [0, 0, 0, 0], roster: new Map(), area: '', invite: null,
};
const players = new Map(); // id -> entity
const mobs = new Map();
let boss = null;

// ---------------- login ----------------
let chosen = localStorage.getItem('fb_cls') || 'swordsman';
$('name').value = localStorage.getItem('fb_name') || '';
function renderClasses() {
  $('classes').innerHTML = CLASS_IDS.map(id => {
    const c = CLASSES[id];
    const hex = '#' + c.color.toString(16).padStart(6, '0');
    return `<button class="cls ${id === chosen ? 'sel' : ''}" data-id="${id}"><span class="role"><span class="dot" style="background:${hex}"></span>${c.role}</span><b>${c.name}</b><p>${c.blurb}</p></button>`;
  }).join('');
  for (const b of document.querySelectorAll('.cls')) b.onclick = () => { chosen = b.dataset.id; renderClasses(); };
}
renderClasses();
$('enter').disabled = true;
const assetsReady = loadAssets(p => { $('enter').textContent = `Loading characters… ${Math.round(p * 100)}%`; })
  .catch(err => console.error('Model load failed, using block characters', err))
  .finally(() => { $('enter').textContent = 'Enter the Tower'; $('enter').disabled = false; });
$('enter').onclick = join;
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

async function join() {
  await assetsReady;
  if (state.ws) return;
  const name = $('name').value.trim() || `Hero${Math.floor(Math.random() * 900 + 100)}`;
  localStorage.setItem('fb_name', name); localStorage.setItem('fb_cls', chosen);
  state.cls = chosen;
  $('login-msg').textContent = 'Connecting…';
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', name, cls: chosen }));
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (state.joined) { log('Disconnected from the server. Refresh to reconnect.', 'sys'); banner('DISCONNECTED', 'Refresh the page to reconnect'); }
    else $('login-msg').textContent = 'Could not connect to the server.';
  };
}
const send = o => state.ws?.readyState === 1 && state.ws.send(JSON.stringify(o));

// ---------------- networking ----------------
function onMessage(msg) {
  if (msg.type === 'full') { $('login-msg').textContent = 'Server is full.'; return; }
  if (msg.type === 'welcome') {
    Object.assign(state, { myId: msg.id, x: msg.x, z: msg.z, seq: msg.seq, joined: true });
    $('login').classList.add('hidden'); $('hud').classList.remove('hidden');
    buildSkillBar();
    log('Welcome to Floorbound! Head north through the field and defeat the Horned Warden.', 'sys');
    log(isTouch ? 'Left side: move. Right side: drag to look. Buttons: attack and skills.' : 'WASD move · drag mouse to look · Space/J attack · 1 2 3 skills · Enter to chat', 'sys');
    return;
  }
  if (msg.type === 'roster') {
    state.roster = new Map(msg.players.map(p => [p.id, p]));
    for (const [id, e] of players) { const r = state.roster.get(id); if (r) e.name = r.name; }
    renderPlayers();
    return;
  }
  if (msg.type === 'snap') onSnapshot(msg);
}

function onSnapshot({ me, w }) {
  state.xp = me.xp; state.next = me.next;
  if (me.lvl !== state.lvl) { state.lvl = me.lvl; buildSkillBar(me.lvl); }
  const now = performance.now();
  me.cds.forEach((c, i) => { if (now - state.lastPress[i] > 350) state.ready[i] = now + c * 1000; });

  // events first (they may reference mobs that are about to vanish)
  for (const e of w.events) handleEvent(e);

  const seen = new Set();
  for (const a of w.players) {
    const [id, x, z, face, hp, maxHp, lvl, ci, party, dead, buffs] = a;
    seen.add(id);
    let e = players.get(id);
    if (!e) e = addPlayerEntity(id, CLASS_IDS[ci], x, z);
    Object.assign(e, { tx: x, tz: z, tface: face, hp, maxHp, lvl, party, dead: !!dead, buffs });
    if (id === state.myId) {
      const wasDead = state.dead;
      Object.assign(state, { hp, maxHp, party, dead: !!dead });
      if (wasDead !== state.dead) $('dead').classList.toggle('hidden', !state.dead);
    }
  }
  for (const [id, e] of players) if (!seen.has(id)) { removeEntity(e); players.delete(id); }

  const seenM = new Set();
  for (const a of w.mobs) {
    const [id, ti, x, z, face, hp, maxHp, flags] = a;
    seenM.add(id);
    let e = mobs.get(id);
    if (!e) e = addMobEntity(id, MOB_IDS[ti], x, z, face);
    Object.assign(e, { tx: x, tz: z, tface: face, hp, maxHp, moving: flags & 1, engaged: flags & 2, enraged: flags & 4, stunned: flags & 8 });
  }
  for (const [id, e] of mobs) if (!seenM.has(id) && !e.dying) { removeEntity(e); mobs.delete(id); if (e === boss) boss = null; }
  renderPlayersThrottled();
}

function handleEvent(e) {
  const me = state.myId;
  switch (e.t) {
    case 'tp':
      if (e.id === me) { state.x = e.x; state.z = e.z; state.seq = e.s; }
      break;
    case 'fx': {
      const ent = players.get(e.id) || mobs.get(e.id);
      if (ent && players.has(e.id) && ['arc', 'rush', 'ring', 'bolt'].includes(e.k)) ent.swing = 0.3;
      if (e.s) playSkillAnim(players.get(e.k === 'heal' ? e.by : e.id), e.s, e.n);
      const ox = e.id === me ? state.x : e.x, oz = e.id === me ? state.z : e.z;
      if (e.k === 'arc') fx.arc(ox, oz, e.f, e.r, e.r > 3 ? 0.9 : 1.05, e.c === 'gold' ? 0xfde68a : 0xdbeafe);
      else if (e.k === 'ring') fx.ring(ox, oz, e.r, e.c === 'gold' ? 0xfbbf24 : e.c === 'light' ? 0xfef3c7 : 0xbfdbfe, e.r > 10 ? 0.6 : 0.35);
      else if (e.k === 'rush') fx.line(e.x, e.z, e.x2, e.z2, 0xbfdbfe, 1.4, 0.35);
      else if (e.k === 'bolt') { fx.line(ox, oz, e.x2, e.z2, 0xfde047, 0.22, 0.25, 1.3); fx.ring(e.x2, e.z2, 1.2, 0xfde047, 0.25); }
      else if (e.k === 'heal') { const t = players.get(e.id); if (t) fx.heal(t.model.group); }
      else if (e.k === 'zone') fx.zone(e.x, e.z, e.r, e.d);
      else if (e.k === 'marc') fx.arc(e.x, e.z, e.f, e.r, 1.3, 0xff4d4d);
      else if (e.k === 'boom') { fx.ring(e.x, e.z, e.r, 0xff7a2f, 0.5); shake(0.35); }
      break;
    }
    case 'wind': { const m = mobs.get(e.id); if (m) { m.wind = e.d; m.model.anim?.shot('2H_Melee_Attack_Chop', 1.4); } break; }
    case 'tele':
      fx.telegraph(e.x, e.z, e.r, e.d, e.follow ? () => mobs.get(e.follow)?.model.group.position : null);
      if (boss) bossShot(boss.id, e.follow ? '2H_Melee_Attack_Spin' : '2H_Melee_Attack_Slice', 1.2, Math.max(0, e.d - 0.55));
      break;
    case 'buff': {
      const p = players.get(e.id);
      if (!p) break;
      if (e.k === 'wall') fx.shield(p.model.group, e.d, 0x60a5fa);
      else if (e.k === 'dr') fx.shield(p.model.group, e.d, 0xfbbf24);
      else if (e.k === 'bless') fx.ring(p.model.group.position.x, p.model.group.position.z, 1.5, 0xfde68a, 0.6);
      break;
    }
    case 'hit': {
      const m = mobs.get(e.id);
      if (m) {
        m.flash = 0.08;
        const mine = e.by === me;
        floatNum(m.model.group.position, m.model.height * 0.7, e.c ? `${e.a}!` : `${e.a}`, e.c ? 'crit' : '', mine ? 1 : 0.55);
      }
      break;
    }
    case 'hurt': {
      const p = players.get(e.id);
      if (p) { p.flash = 0.15; const a = p.model.anim; if (a && !a.busy() && !a.dead) a.shot('Hit_A', 1.8);
        if (e.id === me) { floatNum(p.model.group.position, 2.2, `-${e.a}`, 'hurt'); shake(0.15); } }
      break;
    }
    case 'heal': {
      const p = players.get(e.id);
      if (p && (e.id === me || (state.party && p.party === state.party))) floatNum(p.model.group.position, 2.4, `+${e.a}`, 'heal');
      break;
    }
    case 'xp': if (e.to === me) { const p = players.get(me); if (p) floatNum(p.model.group.position, 2.9, `+${e.a} XP`, 'xp'); } break;
    case 'lvl': {
      const p = players.get(e.id);
      if (p) fx.ring(p.model.group.position.x, p.model.group.position.z, 3, 0xfde68a, 0.8);
      if (e.id === me) { banner(`LEVEL UP`, `You are now level ${e.lvl}`); buildSkillBar(e.lvl); }
      break;
    }
    case 'die': {
      const bm = mobs.get(e.id);
      if (bm?.model.anim && !bm.dying) { // the boss collapses first, then shatters
        bm.dying = true; bm.model.anim.die();
        setTimeout(() => {
          fx.shatter(bm.model.group.position.x, bm.model.group.position.z, true); shake(0.4);
          if (mobs.get(e.id) === bm) { removeEntity(bm); mobs.delete(e.id); if (boss === bm) boss = null; }
        }, 1700);
        break;
      }
      fx.shatter(e.x, e.z, !!e.b);
      const m = mobs.get(e.id);
      if (m) { removeEntity(m); mobs.delete(e.id); if (m === boss) boss = null; }
      break;
    }
    case 'pdie': { if (e.id === me) $('dead').classList.remove('hidden'); break; }
    case 'enrage': if (boss) bossShot(boss.id, 'Cheer', 1.2); banner('THE WARDEN IS ENRAGED', 'Watch for the spin — get out of the red circle'); break;
    case 'clear': banner('FLOOR 1 CLEARED', e.names.join(' · ')); break;
    case 'invite': if (e.to === me) showInvite(e.from, e.name); break;
    case 'chat': log(`${e.from}: ${e.text}`, e.id === me ? 'me' : ''); break;
    case 'sys': if (!e.to || e.to === me) log(e.text, 'sys'); break;
  }
}

// ---------------- character animation ----------------
const SKILL_ANIM = {
  slash: [['1H_Melee_Attack_Slice_Diagonal', 1.9], ['1H_Melee_Attack_Slice_Horizontal', 1.9], ['1H_Melee_Attack_Chop', 1.9]],
  rush: [['1H_Melee_Attack_Stab', 1.6]],
  whirl: [['2H_Melee_Attack_Spin', 1.5]],
  burst: [['1H_Melee_Attack_Slice_Diagonal', 2.6], ['1H_Melee_Attack_Slice_Horizontal', 2.6], ['1H_Melee_Attack_Chop', 2.6], ['1H_Melee_Attack_Stab', 1.8]],
  bash: [['1H_Melee_Attack_Chop', 1.7], ['1H_Melee_Attack_Slice_Diagonal', 1.7]],
  taunt: [['Cheer', 1.6]],
  wall: [['Block', 1]],
  gslam: [['2H_Melee_Attack_Chop', 1.6]],
  smite: [['Spellcast_Shoot', 1.8]],
  heal: [['Spellcast_Raise', 1.6]],
  bless: [['Spellcast_Long', 1.4]],
  sanct: [['Spellcast_Long', 1.4]],
};
function playSkillAnim(ent, skill, n) {
  const list = SKILL_ANIM[skill];
  if (!ent?.model.anim || !list) return;
  const i = n ?? (ent.combo = (ent.combo || 0) + 1);
  const [name, speed] = list[i % list.length];
  ent.model.anim.shot(name, speed);
}
const bossShot = (id, name, speed, delay = 0) => setTimeout(() => mobs.get(id)?.model.anim?.shot(name, speed), delay * 1000);

// ---------------- entities ----------------
function makeLabel(cls) {
  const el = document.createElement('div');
  el.className = `lbl ${cls}`;
  el.innerHTML = `<div class="nm"></div><div class="bar"><div></div></div>`;
  $('labels').appendChild(el);
  return { el, nm: el.firstChild, fill: el.lastChild.firstChild, text: '', pct: -1 };
}

function addPlayerEntity(id, cls, x, z) {
  const model = makePlayerModel(cls);
  model.group.position.set(x, 0, z);
  let mats = model.mats;
  if (!mats) {
    mats = [];
    model.group.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.material = o.material.clone(); mats.push(o.material); } });
  }
  scene.add(model.group);
  const e = { id, kind: 'player', cls, model, mats, label: id === state.myId ? null : makeLabel('ally'), name: state.roster.get(id)?.name || '…', x, z, face: 0, tx: x, tz: z, tface: 0, walk: 0, swing: 0, flash: 0 };
  players.set(id, e);
  return e;
}

function addMobEntity(id, type, x, z, face) {
  const model = makeMobModel(type);
  model.group.position.set(x, 0, z);
  model.group.rotation.y = face;
  scene.add(model.group);
  const e = { id, kind: 'mob', type, def: MOBS[type], model, mats: model.mats, label: type === 'warden' ? null : makeLabel('mob'), x, z, face, tx: x, tz: z, tface: face, walk: 0, wind: 0, flash: 0 };
  mobs.set(id, e);
  if (type === 'warden') boss = e;
  return e;
}

function removeEntity(e) {
  scene.remove(e.model.group);
  e.model.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  e.label?.el.remove();
}

// ---------------- input ----------------
const keys = new Set();
const stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
let attackHeld = false;

addEventListener('keydown', e => {
  if (!state.joined) return;
  const chat = $('chat-input');
  if (document.activeElement === chat) {
    if (e.key === 'Enter') { const t = chat.value.trim(); if (t) send({ type: 'chat', text: t }); chat.value = ''; chat.blur(); }
    if (e.key === 'Escape') chat.blur();
    return;
  }
  if (e.key === 'Enter') { chat.focus(); e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === ' ' || k === 'j') { attackHeld = true; e.preventDefault(); }
  if (k === '1' || k === '2' || k === '3') useSkill(+k);
  if (k === 'p') $('players-btn').click();
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === ' ' || k === 'j') attackHeld = false;
});
addEventListener('blur', () => { keys.clear(); attackHeld = false; });

// camera drag (mouse + touch on the right/anywhere outside the stick)
const drag = { id: null, x: 0, y: 0 };
canvas.addEventListener('pointerdown', e => {
  if (drag.id !== null) return;
  drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== drag.id) return;
  const s = isTouch ? 0.008 : 0.005;
  state.yaw -= (e.clientX - drag.x) * s;
  state.pitch = Math.min(1.25, Math.max(0.12, state.pitch + (e.clientY - drag.y) * s));
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = e => { if (e.pointerId === drag.id) drag.id = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e => { state.camDist = Math.min(22, Math.max(5, state.camDist + e.deltaY * 0.01)); }, { passive: true });

// virtual joystick
const stickEl = $('stick'), knob = $('knob');
stickEl.addEventListener('pointerdown', e => {
  if (stick.active) return;
  Object.assign(stick, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 });
  stickEl.setPointerCapture(e.pointerId);
  knob.style.display = 'block'; knob.style.left = `${e.clientX}px`; knob.style.top = `${e.clientY}px`;
});
stickEl.addEventListener('pointermove', e => {
  if (e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
  const d = Math.hypot(dx, dy), max = 55;
  if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
  stick.dx = dx / max; stick.dy = dy / max;
});
const endStick = e => { if (e.pointerId === stick.id) { stick.active = false; stick.id = null; stick.dx = stick.dy = 0; knob.style.display = 'none'; } };
stickEl.addEventListener('pointerup', endStick);
stickEl.addEventListener('pointercancel', endStick);

// skill bar
function buildSkillBar(lvl = state.lvl) {
  const skills = CLASSES[state.cls].skills;
  const order = isTouch ? [1, 0, 2, 3] : [0, 1, 2, 3];
  $('skills').innerHTML = order.map(i => {
    const s = skills[i];
    const locked = lvl < s.lvl;
    return `<button class="sk s${i} ${i === 0 ? 'basic' : ''} ${locked ? 'locked' : ''}" data-slot="${i}" title="${s.name}: ${s.desc}${locked ? ` (unlocks at Lv ${s.lvl})` : ''}">
      <span class="key">${i === 0 ? (isTouch ? '' : 'SPC') : i}</span>${s.name}${locked ? `<br><small>Lv ${s.lvl}</small>` : ''}<span class="cd"></span><span class="cdt"></span></button>`;
  }).join('');
  for (const b of $('skills').children) {
    const slot = +b.dataset.slot;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); if (slot === 0) attackHeld = true; else useSkill(slot); });
    const up = () => { b.classList.remove('pressed'); if (slot === 0) attackHeld = false; };
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  }
}

function nearestMob(range) {
  let best = null, bd = range;
  for (const m of mobs.values()) {
    const d = Math.hypot(m.x - state.x, m.z - state.z) - m.def.radius;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

function useSkill(slot) {
  if (state.dead || !state.joined) return;
  const sk = CLASSES[state.cls].skills[slot];
  const now = performance.now();
  if (!sk || state.lvl < sk.lvl || now < state.ready[slot]) return;
  const auto = ['slash', 'bash', 'rush', 'smite', 'burst'].includes(sk.id);
  if (auto) {
    const t = nearestMob(sk.id === 'smite' ? 11 : sk.id === 'rush' ? 9 : 6);
    if (t) state.face = angleTo(state.x, state.z, t.x, t.z);
  }
  state.ready[slot] = now + sk.cd * 1000;
  state.lastPress[slot] = now;
  send({ type: 'skill', slot, face: state.face });
}

// ---------------- HUD ----------------
const logEl = $('log');
function log(text, cls = '') {
  const d = document.createElement('div');
  d.className = cls; d.textContent = text;
  logEl.appendChild(d);
  while (logEl.children.length > (isTouch ? 5 : 30)) logEl.firstChild.remove();
}
let bannerT = 0;
function banner(title, sub = '') {
  $('banner').innerHTML = `${title}${sub ? `<small>${sub.replace(/</g, '&lt;')}</small>` : ''}`;
  $('banner').classList.add('show');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => $('banner').classList.remove('show'), 3200);
}
let areaT = 0;
function showArea(name) {
  $('area').textContent = name; $('area').classList.add('show');
  clearTimeout(areaT); areaT = setTimeout(() => $('area').classList.remove('show'), 2600);
}

$('chat-btn').onclick = () => { const t = prompt('Say something'); if (t && t.trim()) send({ type: 'chat', text: t.trim() }); };
$('players-btn').onclick = () => { $('players').classList.toggle('hidden'); renderPlayers(); };
function renderPlayers() {
  if ($('players').classList.contains('hidden')) return;
  const rows = [];
  for (const [id, r] of state.roster) {
    if (id === state.myId) continue;
    const p = players.get(id);
    const inParty = state.party && p?.party === state.party;
    rows.push(`<div class="p"><span>${esc(r.name)} <small style="opacity:.6">Lv ${p?.lvl ?? 1} ${CLASSES[r.cls].name}</small></span>${inParty ? '<small>Party</small>' : `<button data-inv="${id}">Invite</button>`}</div>`);
  }
  $('players').innerHTML = `<b>Online (${state.roster.size})</b>${rows.join('') || '<div style="opacity:.6;font-size:13px;padding:6px 0">Nobody else yet. Share the link with friends!</div>'}${state.party ? '<button class="leave">Leave party</button>' : ''}`;
  for (const b of $('players').querySelectorAll('[data-inv]')) b.onclick = () => { send({ type: 'invite', id: +b.dataset.inv }); b.textContent = 'Sent'; b.disabled = true; };
  const lv = $('players').querySelector('.leave'); if (lv) lv.onclick = () => send({ type: 'leave' });
}
let rpT = 0;
function renderPlayersThrottled() { const n = performance.now(); if (n - rpT > 1000) { rpT = n; renderPlayers(); } }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showInvite(from, name) {
  const el = $('invite');
  el.innerHTML = `<div><b>${esc(name)}</b> invited you to a party</div><button id="acc">Accept</button><button id="dec">Decline</button>`;
  el.classList.remove('hidden');
  $('acc').onclick = () => { send({ type: 'accept', from }); el.classList.add('hidden'); };
  $('dec').onclick = () => { send({ type: 'decline' }); el.classList.add('hidden'); };
  setTimeout(() => el.classList.add('hidden'), 25000);
}

function setBar(el, pct, wrap) {
  el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (wrap) { wrap.classList.toggle('low', pct < 25); wrap.classList.toggle('mid', pct >= 25 && pct < 50); }
}

let hudT = 0;
function updateHud(now) {
  if (now - hudT < 100) return; hudT = now;
  const name = state.roster.get(state.myId)?.name || '';
  $('me-name').textContent = name;
  $('me-lvl').textContent = `Lv ${state.lvl} ${CLASSES[state.cls].name}`;
  const pct = (state.hp / state.maxHp) * 100;
  setBar($('me-hp'), pct, $('me-hp').parentElement);
  $('me-hp-text').textContent = `${state.hp} / ${state.maxHp}`;
  setBar($('me-xp'), state.lvl >= MAX_LEVEL ? 100 : (state.xp / state.next) * 100);
  const me = players.get(state.myId);
  const b = me?.buffs || 0;
  $('me-buffs').innerHTML = `${b & 1 ? '<span>Guarded</span>' : ''}${b & 2 ? '<span>Blessed</span>' : ''}`;

  // party frames
  const mates = state.party ? [...players.values()].filter(p => p.party === state.party && p.id !== state.myId) : [];
  $('party').innerHTML = mates.map(p => {
    const pc = (p.hp / p.maxHp) * 100;
    return `<div class="frame ${p.dead ? 'dead' : ''}"><div class="row" style="font-size:12px;margin:0"><span>${esc(p.name)}</span><span style="opacity:.7">Lv ${p.lvl}</span></div><div class="bar hp ${pc < 25 ? 'low' : pc < 50 ? 'mid' : ''}"><div style="width:${pc}%"></div></div></div>`;
  }).join('');

  // boss bar
  const showBoss = boss && (boss.engaged || boss.hp < boss.maxHp) && state.z > 120;
  $('boss').classList.toggle('hidden', !showBoss);
  if (showBoss) { setBar($('boss-hp'), (boss.hp / boss.maxHp) * 100); $('boss').classList.toggle('enraged', !!boss.enraged); }

  // cooldowns
  for (const btn of $('skills').children) {
    const slot = +btn.dataset.slot, sk = CLASSES[state.cls].skills[slot];
    const left = Math.max(0, state.ready[slot] - now) / 1000;
    btn.querySelector('.cd').style.setProperty('--p', `${Math.min(100, (left / sk.cd) * 100)}%`);
    btn.querySelector('.cdt').textContent = left > 0.3 && slot > 0 ? left.toFixed(left < 3 ? 1 : 0) : '';
  }

  const a = areaName(state.x, state.z);
  if (a !== state.area) { state.area = a; showArea(a + (inTown(state.x, state.z) ? ' — Safe Zone' : '')); }
}

// floating numbers
const nums = [];
function floatNum(pos, h, text, cls, opacity = 1) {
  if (nums.length > 40) nums.shift().el.remove();
  const el = document.createElement('div');
  el.className = `num ${cls}`; el.textContent = text; el.style.opacity = opacity;
  $('labels').appendChild(el);
  nums.push({ el, x: pos.x + (Math.random() - 0.5) * 0.8, y: h, z: pos.z, age: 0, opacity });
}

// ---------------- main loop ----------------
const v3 = new THREE.Vector3();
let shakeAmt = 0;
const shake = a => { shakeAmt = Math.max(shakeAmt, a); };
let sendT = 0, last = performance.now();

function project(x, y, z) {
  v3.set(x, y, z).project(camera);
  if (v3.z > 1) return null;
  return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight];
}

function animateEntity(e, dt) {
  const g = e.model.group;
  const self = e.id === state.myId && e.kind === 'player';
  if (self) { e.x = state.x; e.z = state.z; e.tface = state.face; }
  const k = Math.min(1, dt * (self ? 25 : 12));
  const px = g.position.x, pz = g.position.z;
  const tx = self ? e.x : e.tx, tz = self ? e.z : e.tz;
  if (Math.hypot(tx - px, tz - pz) > 15) g.position.set(tx, 0, tz);
  else { g.position.x += (tx - px) * k; g.position.z += (tz - pz) * k; }
  if (!self) { e.x = g.position.x; e.z = g.position.z; }
  const speed = Math.hypot(g.position.x - px, g.position.z - pz) / Math.max(dt, 1e-3);
  let df = e.tface - g.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df));
  g.rotation.y += df * Math.min(1, dt * 14);

  const m = e.model;
  e.spd = (e.spd || 0) + (speed - (e.spd || 0)) * Math.min(1, dt * 10);
  if (m.anim) {
    const a = m.anim, isP = e.kind === 'player';
    if (isP && e.dead && !a.dead) a.die();
    else if (isP && !e.dead && a.dead) a.revive();
    if (e.spd > (isP ? 3.5 : 4.6)) a.base('Running_A', 0.2, Math.max(0.7, e.spd / (isP ? 6.5 : 5.5)));
    else if (e.spd > 0.5) a.base('Walking_A', 0.2, isP ? 1.2 : Math.max(0.6, e.spd / 3.5));
    else a.base(a.idle, 0.25);
    a.update(dt);
    if (isP) m.cursor.material.color.setHex(state.party && e.party === state.party && !self ? 0xa78bfa : 0x4ade80);
    else m.cursor.rotation.y += dt * 2;
    m.cursor.visible = !(isP && e.dead);
  } else {
  e.walk += dt * Math.min(speed, 8) * 2.2;
  const swingAmt = speed > 0.5 ? Math.sin(e.walk) : 0;
  if (e.kind === 'player') {
    m.legL.rotation.x = swingAmt * 0.7; m.legR.rotation.x = -swingAmt * 0.7;
    m.armL.rotation.x = -swingAmt * 0.5;
    if (e.swing > 0) { e.swing -= dt; const s = 1 - e.swing / 0.3; m.armR.rotation.x = -2.4 + s * 3.2; m.armR.rotation.z = -0.4 + s * 0.8; }
    else { m.armR.rotation.x = swingAmt * 0.5; m.armR.rotation.z = 0; }
    m.body.position.y = Math.abs(swingAmt) * 0.06;
    m.cursor.material.color.setHex(state.party && e.party === state.party && !self ? 0xa78bfa : 0x4ade80);
    g.visible = !e.dead;
  } else {
    m.legs.forEach((l, i) => { l.rotation.x = (i % 2 ? 1 : -1) * swingAmt * 0.6; });
    if (e.wind > 0) {
      e.wind -= dt;
      if (m.armR) m.armR.rotation.x = -2.2 * Math.min(1, (0.6 - e.wind) * 4);
      else m.body.rotation.x = -0.25;
    } else {
      if (m.armR) m.armR.rotation.x += (0.2 * swingAmt - m.armR.rotation.x) * Math.min(1, dt * 10);
      m.body.rotation.x += (0 - m.body.rotation.x) * Math.min(1, dt * 12);
    }
    m.cursor.rotation.y += dt * 2;
    m.body.position.y = e.stunned ? Math.sin(performance.now() / 60) * 0.05 : 0;
  }
  }
  if (e.flash > 0) e.flash -= dt;
  const enr = e.kind === 'mob' && e.enraged ? (m.anim ? 0.12 : 0.3) + Math.sin(performance.now() / 120) * (m.anim ? 0.06 : 0.15) : 0;
  const glow = e.flash > 0 ? (e.type === 'warden' ? 0.18 : 0.35) : enr;
  for (const mt of e.mats) { mt.emissive.setHex(e.flash > 0 && !enr ? 0xffffff : 0xff2200); mt.emissiveIntensity = glow; }

  if (e.label) {
    const p = project(g.position.x, m.height + 0.55, g.position.z);
    const d = Math.hypot(g.position.x - state.x, g.position.z - state.z);
    if (!p || d > 45 || (e.kind === 'player' && e.dead)) { e.label.el.style.display = 'none'; return; }
    e.label.el.style.display = '';
    e.label.el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%)`;
    e.label.el.style.left = '0'; e.label.el.style.top = '0';
    const txt = e.kind === 'mob' ? `<span class="lv">Lv${e.def.level}</span>${e.def.name}` : `<span class="lv">Lv${e.lvl}</span>${esc(e.name)}`;
    if (txt !== e.label.text) { e.label.text = txt; e.label.nm.innerHTML = txt; }
    const pct = Math.round((e.hp / e.maxHp) * 100);
    if (pct !== e.label.pct) { e.label.pct = pct; e.label.fill.style.width = `${pct}%`; }
    if (e.kind === 'player') e.label.el.className = `lbl ${state.party && e.party === state.party ? 'party' : 'ally'}`;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;

  if (state.joined && !state.dead) {
    // movement input
    let ix = 0, iz = 0;
    const typing = document.activeElement === $('chat-input');
    if (!typing) {
      if (keys.has('w') || keys.has('arrowup')) iz += 1;
      if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
      if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
      if (keys.has('d') || keys.has('arrowright')) ix += 1;
      if (keys.has('q')) state.yaw += dt * 2;
      if (keys.has('e')) state.yaw -= dt * 2;
    }
    if (stick.active) { ix += stick.dx; iz -= stick.dy; }
    const mag = Math.min(1, Math.hypot(ix, iz));
    if (mag > 0.08) {
      const fy = state.yaw;
      const fwd = [Math.sin(fy), Math.cos(fy)], right = [-Math.cos(fy), Math.sin(fy)];
      let mx = fwd[0] * iz + right[0] * ix, mz = fwd[1] * iz + right[1] * ix;
      const ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
      const step = PLAYER_SPEED * mag * dt;
      let nx = state.x + mx * step, nz = state.z + mz * step;
      [nx, nz] = resolveCollision(nx, nz);
      if (!walkable(nx, nz)) { // slide along the boundary
        if (walkable(nx, state.z)) nz = state.z; else if (walkable(state.x, nz)) nx = state.x; else { nx = state.x; nz = state.z; }
      }
      state.x = nx; state.z = nz;
      state.face = Math.atan2(mx, mz);
    }
    if (attackHeld) useSkill(0);
  }

  if (state.joined && now - sendT >= 1000 / TICK_RATE) {
    sendT = now;
    send({ type: 'input', x: +state.x.toFixed(2), z: +state.z.toFixed(2), face: +state.face.toFixed(2), seq: state.seq });
  }

  for (const e of players.values()) animateEntity(e, dt);
  for (const e of mobs.values()) animateEntity(e, dt);
  fx.update(dt);
  crystal.rotation.y += dt;

  // camera
  const me = players.get(state.myId);
  const cx = me ? me.model.group.position.x : 0, cz = me ? me.model.group.position.z : 30;
  const cp = state.pitch;
  // pull the camera in when a wall or pillar is between it and the player
  const dir = new THREE.Vector3(-Math.sin(state.yaw) * Math.cos(cp), Math.sin(cp), -Math.cos(state.yaw) * Math.cos(cp));
  ray.set(new THREE.Vector3(cx, 1.6, cz), dir); ray.far = state.camDist;
  const hit = ray.intersectObjects(occluders, true)[0];
  const allowed = hit ? Math.max(2, hit.distance - 0.6) : state.camDist;
  camCur += (allowed - camCur) * Math.min(1, dt * (allowed < camCur ? 20 : 3));
  const cd = camCur;
  shakeAmt = Math.max(0, shakeAmt - dt);
  const sx = (Math.random() - 0.5) * shakeAmt, sy = (Math.random() - 0.5) * shakeAmt;
  camera.position.set(cx - Math.sin(state.yaw) * Math.cos(cp) * cd + sx, 1.6 + Math.sin(cp) * cd + sy, cz - Math.cos(state.yaw) * Math.cos(cp) * cd);
  camera.lookAt(cx, 1.6, cz);
  if (!state.joined) { // slow orbit behind the login screen
    state.yaw += dt * 0.08;
    camera.position.set(Math.sin(state.yaw) * 40, 22, 30 + Math.cos(state.yaw) * 40);
    camera.lookAt(0, 2, 30);
  }
  sun.position.set(cx + 30, 60, cz - 20); sun.target.position.set(cx, 0, cz);
  if (state.joined) treeFader.update(dt, camera.position, cx, cz);

  // floating numbers
  for (let i = nums.length - 1; i >= 0; i--) {
    const n = nums[i]; n.age += dt;
    if (n.age > 0.9) { n.el.remove(); nums.splice(i, 1); continue; }
    const p = project(n.x, n.y + n.age * 1.6, n.z);
    if (!p) { n.el.style.display = 'none'; continue; }
    n.el.style.display = '';
    n.el.style.left = `${p[0]}px`; n.el.style.top = `${p[1]}px`;
    n.el.style.opacity = String(n.opacity * (1 - Math.max(0, n.age - 0.5) / 0.4));
  }

  if (state.joined) updateHud(now);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// handy for debugging from the console
window.__fb = { state, players, mobs };
