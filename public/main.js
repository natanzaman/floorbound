// Floorbound browser client: networking, input, camera, entities and HUD.
import * as THREE from 'three';
import {
  CLASSES, CLASS_IDS, MOBS, MOB_IDS, PLAYER_SPEED, SPRINT_SPEED, SPRINT_AFTER, TICK_RATE, MAX_LEVEL, DODGE, JUMP,
  walkable, resolveCollision, inTown, inArena, areaName, angleTo, inGateZone,
} from '/shared/data.js';
import { RARITY, CONSUMABLES, CONSUMABLE_IDS, SHOP, MERCHANT, SLOTS, statLabel, sellPrice } from '/shared/items.js';
import { TITLES, TITLE_BY_ID, DEFAULT_TITLE, HALL, titleProgress } from '/shared/titles.js';
import { Guide } from '/guide.js';
import { createWorld, makePlayerModel, makeMobModel, Effects, loadAssets } from '/world.js';
import { TwistClient } from '/twists.js';
import { Sound } from '/audio.js';
import { createSmith } from '/smith.js';

const sfx = new Sound();

const $ = id => document.getElementById(id);
const SPECTATE = new URLSearchParams(location.search).has('spectate');
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
const { sun, crystal, occluders, treeFader, gate: gateMesh } = createWorld(scene);
const ray = new THREE.Raycaster();
let camCur = 11;
const fx = new Effects(scene);
const twists = new TwistClient({ scene, fx, banner: (t, s) => banner(t, s) }); // Warden twists
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
  gate: [0, 0, 0, 0], gateOpen: false, gold: 0, inv: null, ccd: {}, ccdReady: {}, meReady: 0, phase: 0, moved: 0, tonic: 0, draught: 0,
  ready: [0, 0, 0, 0], lastPress: [0, 0, 0, 0], dodgeReady: 0, dodgePress: 0, roll: null, moveDir: null, lastCombat: -1e9, speed: 0, lock: 0, focus: 0, jumpReady: 0, jumpPress: 0, roster: new Map(), area: '', invite: null,
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
  .finally(() => { $('enter').disabled = false; addMerchant(); smith.addNpc(); if (SPECTATE) join({ type: 'spectate' }); else initLogin(); });
let merchantNpc = null;
function addMerchant() { // the shopkeeper stands behind the stall's counter, facing the plaza
  const m = makePlayerModel('cleric'), face = Math.atan2(-MERCHANT.x, -MERCHANT.z);
  m.cursor.visible = false; m.anim?.base(m.anim.idle);
  m.group.position.set(MERCHANT.x - Math.sin(face) * 0.3, 0, MERCHANT.z - Math.cos(face) * 0.3);
  m.group.rotation.y = face;
  for (const mt of m.mats || []) mt.color?.multiplyScalar(0.8);
  scene.add(m.group);
  merchantNpc = m;
}
$('enter').onclick = () => onEnter();
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') onEnter(); });

// ---------------- accounts: Discord / guest sign-in and character select ----------------
const acct = { cfg: { accounts: false }, token: localStorage.getItem('fb_session'), me: null };
const loginMsg = t => { $('login-msg').textContent = t || ''; };
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(acct.token ? { authorization: `Bearer ${acct.token}` } : {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || 'Something went wrong'), { status: r.status });
  return body;
}
function showPanel(id) { for (const p of ['auth', 'chars', 'create']) $(p).classList.toggle('hidden', p !== id); }
async function initLogin() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('session')) { acct.token = h.get('session'); localStorage.setItem('fb_session', acct.token); }
  if (h.get('signin')) loginMsg(h.get('signin') === 'cancelled' ? 'Discord sign-in was cancelled.' : 'Discord sign-in failed. Try again?');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  try { acct.cfg = await fetch('/api/config').then(r => r.json()); } catch {}
  if (!acct.cfg.accounts) { $('enter').textContent = 'Enter the Tower'; return showPanel('create'); } // anonymous mode
  if (!acct.token) return showAuth();
  await loadMe();
}
function showAuth() { $('discord-btn').classList.toggle('hidden', !acct.cfg.discord); showPanel('auth'); }
async function loadMe() {
  try {
    acct.me = await api('/api/me');
    renderChars();
    if (!acct.me.characters.length) showCreate(); else showPanel('chars');
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem('fb_session'); acct.token = null; showAuth(); } else loginMsg(e.message);
  }
}
function renderChars() {
  const { account, characters } = acct.me;
  $('acct-bar').innerHTML = account.discord
    ? `${account.avatar ? `<img src="${account.avatar}" alt="">` : ''}<span class="who">Signed in as <b>${esc(account.discord)}</b></span><button id="signout">Sign out</button>`
    : `<span class="who">Guest account: saved in this browser</span>${acct.cfg.discord ? '<button id="link-discord" class="link">Link Discord</button>' : ''}<button id="signout">Sign out</button>`;
  $('char-list').innerHTML = characters.map(c => {
    const k = CLASSES[c.cls], hex = '#' + k.color.toString(16).padStart(6, '0');
    return `<div class="char"><span class="dot" style="background:${hex}"></span><div class="info"><b>${esc(c.name)}</b><small>Lv ${c.lvl} ${k.name} · ${k.role}</small></div><button class="play" data-id="${c.id}">Play</button><button class="del" data-id="${c.id}" title="Delete">✕</button></div>`;
  }).join('');
  $('new-char').classList.toggle('hidden', characters.length >= (acct.cfg.maxCharacters || 4));
  for (const b of $('char-list').querySelectorAll('.play')) b.onclick = () => {
    const c = characters.find(x => x.id === +b.dataset.id);
    state.cls = c.cls;
    join({ type: 'join', session: acct.token, character: c.id });
  };
  for (const b of $('char-list').querySelectorAll('.del')) b.onclick = async () => {
    const c = characters.find(x => x.id === +b.dataset.id);
    if (!confirm(`Delete ${c.name} (Lv ${c.lvl} ${CLASSES[c.cls].name})? This can't be undone.`)) return;
    try { await api(`/api/characters/${c.id}`, { method: 'DELETE' }); await loadMe(); } catch (e) { loginMsg(e.message); }
  };
  const so = $('signout'); if (so) so.onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} localStorage.removeItem('fb_session'); acct.token = null; showAuth(); };
  const ld = $('link-discord'); if (ld) ld.onclick = () => { location.href = `/auth/discord?link=${encodeURIComponent(acct.token)}`; };
}
function showCreate() {
  $('name').value = ''; $('enter').textContent = 'Create character';
  $('create-back').classList.toggle('hidden', !acct.me?.characters.length);
  showPanel('create'); $('name').focus();
}
$('discord-btn').onclick = () => { location.href = '/auth/discord'; };
$('guest-btn').onclick = async () => {
  try { acct.token = (await api('/api/guest', { method: 'POST' })).token; localStorage.setItem('fb_session', acct.token); await loadMe(); } catch (e) { loginMsg(e.message); }
};
$('new-char').onclick = showCreate;
$('create-back').onclick = () => { loginMsg(''); showPanel('chars'); };
async function onEnter() {
  if (!acct.cfg.accounts) { // anonymous mode (local dev): pick a name and go
    const name = $('name').value.trim() || `Hero${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem('fb_name', name); localStorage.setItem('fb_cls', chosen);
    state.cls = chosen;
    return join({ type: 'join', name, cls: chosen });
  }
  try {
    const { character } = await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: $('name').value, cls: chosen }) });
    loginMsg('');
    await loadMe();
    state.cls = character.cls;
    join({ type: 'join', session: acct.token, character: character.id }); // jump straight in with the new character
  } catch (e) { loginMsg(e.message); }
}

async function join(joinMsg) {
  sfx.unlock();
  await assetsReady;
  if (state.ws) return;
  loginMsg('Connecting…');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify(joinMsg));
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (state.ws !== ws) return; // replaced or denied
    if (state.joined) { log('Disconnected from the server. Refresh to reconnect.', 'sys'); banner('DISCONNECTED', 'Refresh the page to reconnect'); }
    else { state.ws = null; loginMsg('Could not connect to the server.'); }
  };
}
const send = o => state.ws?.readyState === 1 && state.ws.send(JSON.stringify(o));
const guide = new Guide({ el: $('guide'), tipEl: $('tip'), send });
const smith = createSmith({ scene, occluders, fx, sfx, send, state, project, log, guide, isTouch, makePlayerModel, $ }); // town Smith (public/smith.js)

// ---------------- networking ----------------
function onMessage(msg) {
  if (msg.type === 'full') { $('login-msg').textContent = 'Server is full.'; return; }
  if (msg.type === 'denied') {
    const wasIn = state.joined;
    state.joined = false; const ws = state.ws; state.ws = null; ws?.close();
    if (msg.signedOut) { localStorage.removeItem('fb_session'); acct.token = null; }
    if (wasIn) { alert(msg.reason); location.reload(); return; }
    loginMsg(msg.reason);
    if (msg.signedOut) showAuth();
    return;
  }
  if (msg.type === 'welcome' && msg.spectator) {
    Object.assign(state, { spectator: true, joined: true, myId: -1 });
    guide.off = true;
    document.body.classList.add('spectator');
    $('login').classList.add('hidden'); $('hud').classList.remove('hidden');
    return;
  }
  if (msg.type === 'welcome') {
    Object.assign(state, { myId: msg.id, x: msg.x, z: msg.z, seq: msg.seq, joined: true });
    $('login').classList.add('hidden'); $('hud').classList.remove('hidden');
    buildSkillBar();
    guide.start(msg.charId ? `c${msg.charId}` : `anon_${state.cls}`, msg.lvl);
    log('Welcome to Floorbound! Head north through the field and defeat the Horned Warden.', 'sys');
    log(isTouch ? 'Left side: move. Right side: drag to look. Buttons: attack, skills, dodge, jump and potion.' : 'WASD move · right-drag or screen edge to look · Left click (or J) attack · 1 2 3 skills · Shift dodge · Space jump · 4 5 6 items · B bag · F interact · P party · Ctrl+click select', 'sys');
    log('Break an enemy (Ground Slam, Burst Combo finisher, or Smite during its wind-up), then a teammate hits it for a SWITCH: big bonus damage.', 'sys');
    return;
  }
  if (msg.type === 'roster') {
    state.roster = new Map(msg.players.map(p => [p.id, p]));
    for (const [id, e] of players) { const r = state.roster.get(id); if (r) e.name = r.name; }
    renderPlayers();
    return;
  }
  if (msg.type === 'inv') { state.inv = msg; state.gold = msg.gold; renderBag(); smith.render(); return; }
  if (msg.type === 'hall') { state.hallData = msg; renderHall(); return; }
  if (msg.type === 'snap') {
    const busy = msg.w.events.some(e => e.t === 'clear' || e.t === 'lvl');
    for (const e of msg.w.events) { // titles and the Hall of Clearers (kept out of handleEvent)
      if (e.t === 'title' && e.to === state.myId) titleBanner(e.name, busy ? 7000 : 0);
      if (e.t === 'clear' && !$('hall').classList.contains('hidden')) setTimeout(() => send({ type: 'hall' }), 400);
    }
  }
  if (msg.type === 'snap') onSnapshot(msg);
}

function onSnapshot({ me, w }) {
  const now = performance.now();
  if (me) {
    state.xp = me.xp; state.next = me.next;
    if (me.lvl !== state.lvl) { state.lvl = me.lvl; buildSkillBar(me.lvl); }
    me.cds.forEach((c, i) => { if (now - state.lastPress[i] > 350) state.ready[i] = now + c * 1000; });
    if (now - state.dodgePress > 350) state.dodgeReady = now + (me.dodge || 0) * 1000;
    state.gold = me.gold; state.meReady = me.ready; state.tonic = me.tonic; state.draught = me.draught;
    for (const id of CONSUMABLE_IDS) if (now - (state.ccdPress?.[id] || 0) > 350) state.ccdReady[id] = now + (me.ccd?.[id] || 0) * 1000;
  }
  if (w.gate) { state.gate = w.gate; state.gateOpen = !!w.gate[0]; gateMesh.set(state.gateOpen); }
  state.phase = w.phase || 0;
  twists.snap(w);

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
    Object.assign(e, { tx: x, tz: z, tface: face, hp, maxHp, moving: flags & 1, engaged: flags & 2, enraged: flags & 4, stunned: flags & 8, winding: flags & 16, staggered: flags & 32, frenzy: flags & 64 });
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
      const at = { x: e.x, z: e.z }, mineFx = e.id === me || e.by === me ? 1 : 0.6;
      if (e.k === 'arc' && !e.fin && e.c !== 'gold') sfx.play('swing', at, mineFx);
      else if (e.k === 'arc' || (e.k === 'ring' && e.c !== 'light')) sfx.play('swingHeavy', at, mineFx);
      else if (e.k === 'rush') sfx.play('roll', at, mineFx);
      else if (e.k === 'bolt') sfx.play('bolt', at, mineFx);
      else if (e.k === 'heal') sfx.play('heal', at, mineFx);
      else if (e.k === 'zone' || (e.k === 'ring' && e.c === 'light')) sfx.play('spell', at, mineFx);
      else if (e.k === 'shield') sfx.play('shield', at, mineFx);
      else if (e.k === 'marc') sfx.play(e.small ? 'swing' : 'swingHeavy', at, e.small ? 0.7 : 1.3);
      else if (e.k === 'boom') sfx.play('boom', at, 1.2);
      const ox = e.id === me ? state.x : e.x, oz = e.id === me ? state.z : e.z;
      if (e.k === 'arc') fx.arc(ox, oz, e.f, e.r, e.r > 3 ? 0.9 : 1.05, e.c === 'gold' ? 0xfde68a : 0xdbeafe);
      else if (e.k === 'ring') fx.ring(ox, oz, e.r, e.c === 'gold' ? 0xfbbf24 : e.c === 'light' ? 0xfef3c7 : 0xbfdbfe, e.r > 10 ? 0.6 : 0.35);
      else if (e.k === 'rush') fx.line(e.x, e.z, e.x2, e.z2, 0xbfdbfe, 1.4, 0.35);
      else if (e.k === 'bolt') { fx.line(ox, oz, e.x2, e.z2, 0xfde047, 0.22, 0.25, 1.3); fx.ring(e.x2, e.z2, 1.2, 0xfde047, 0.25); }
      else if (e.k === 'heal') { const t = players.get(e.id); if (t) fx.heal(t.model.group); }
      else if (e.k === 'zone') fx.zone(e.x, e.z, e.r, e.d);
      else if (e.k === 'marc') fx.arc(e.x, e.z, e.f, e.r, e.small ? 0.6 : 1.3, 0xff4d4d);
      else if (e.k === 'boom') { fx.ring(e.x, e.z, e.r, 0xff7a2f, 0.5); shake(0.35); }
      else if (e.k === 'rock') { fx.rock(e.x, e.z, e.r); setTimeout(() => { fx.ring(e.x, e.z, e.r, 0x9ca3af, 0.5); shake(0.2); sfx.play('boom', { x: e.x, z: e.z }, 0.7); }, 200); }
      else if (e.k === 'charge') { fx.line(e.x, e.z, e.x2, e.z2, 0xff7a2f, 4, 0.5, 0.5); shake(0.45); sfx.play('boom', { x: e.x2, z: e.z2 }, 1.3); }
      else if (e.k === 'summon') { fx.ring(e.x, e.z, 3, 0xff3b1f, 0.7); sfx.play('howl', { x: e.x, z: e.z }, 0.8); }
      break;
    }
    case 'jump': {
      const p = players.get(e.id);
      if (p && e.id !== me) { p.jumpT = 0; p.model.anim?.shot('Jump_Full_Short', 1.75); }
      break;
    }
    case 'proj': projFx.set(e.id, fx.thorn(e.x, e.z, e.vx, e.vz, e.ttl)); sfx.play('spit', { x: e.x, z: e.z }); break;
    case 'rare': { // a rare named enemy appeared somewhere on the floor
      fx.rareBeam(e.x, e.z, 7);
      sfx.play('rare', null, 0.9);
      const [dist, dir] = rareBearing(e.x, e.z);
      banner(`RARE · ${e.name.toUpperCase()}`, `Sighted ${dist} m ${dir}`);
      break;
    }
    case 'rareDown': {
      fx.shatter(e.x, e.z, true); fx.beam(e.x, e.z, 0xfbbf24, 3.5);
      const near = Math.hypot(e.x - state.x, e.z - state.z) < 45;
      if (near) slowMotion(0.6, 0.3);
      sfx.play('loot', { x: e.x, z: e.z }, 1.2);
      banner(`${e.name.toUpperCase()} SLAIN`, `by ${e.who}`);
      break;
    }
    case 'rareGone': fx.ring(e.x, e.z, 4, 0x9ca3af, 0.8); break;
    case 'pend': fx.end(projFx.get(e.id)); projFx.delete(e.id); fx.ring(e.x, e.z, 0.8, 0xd6c48a, 0.25); break;
    case 'howl': {
      if (Math.hypot(state.x - (mobs.get(e.id)?.x ?? 1e9), state.z - (mobs.get(e.id)?.z ?? 1e9)) < 25) guide.tip('howl');
      const m = mobs.get(e.id);
      if (m) {
        fx.ring(m.x, m.z, e.r, 0xff7a2f, 0.9); fx.ring(m.x, m.z, e.r * 0.5, 0xffb37a, 0.6);
        sfx.play('howl', m.model.group.position, 1.2);
        floatNum(m.model.group.position, m.model.height + 0.6, e.n ? `HOWL! Pack frenzy ×${e.n}` : 'HOWL!', 'crit');
      }
      break;
    }
    case 'roll': {
      const p = players.get(e.id);
      if (p) sfx.play('roll', p.model.group.position, e.id === me ? 1 : 0.6);
      if (e.id === me) guide.did('dodge');
      if (p) { p.model.anim?.shot('Dodge_Forward', 1.9); fx.ring(p.model.group.position.x, p.model.group.position.z, 1.2, 0xe5e7eb, 0.3); }
      break;
    }
    case 'evade': { const p = players.get(e.id); if (p && (e.id === me || state.spectator)) { floatNum(p.model.group.position, 2.4, e.k === 'jump' ? 'Jumped!' : 'Dodged!', 'evade'); sfx.play('evade', p.model.group.position); } break; }
    case 'stagger': {
      const m = mobs.get(e.id);
      if (!m) break;
      m.staggerT = e.d; m.staggerBy = e.by;
      if (Math.hypot(m.x - state.x, m.z - state.z) < 25) guide.tip('broken');
      fx.ring(m.x, m.z, m.def.radius + 2.5, 0xfacc15, 0.5);
      sfx.play('break', m.model.group.position);
      m.model.anim?.shot('Hit_B', 0.9);
      const who = players.get(e.by)?.name || 'Someone';
      if (state.spectator) callout(`${e.i ? 'INTERRUPT' : 'BREAK'}!`, `${who} broke the ${m.def.name} — Switch in!`, e.d);
      else if (e.by === me) callout(e.i ? 'INTERRUPT!' : 'BREAK!', 'Your teammate can Switch in', 1.2);
      else callout('SWITCH!', `${who} broke it — hit it now!`, e.d);
      break;
    }
    case 'switch': {
      if (e.by === me || e.from === me) guide.did('switch');
      const m = mobs.get(e.id);
      if (m) {
        floatNum(m.model.group.position, m.model.height * 0.85, `SWITCH! ${e.a}`, 'switch');
        fx.ring(m.x, m.z, m.def.radius + 4, 0xfde047, 0.6); fx.ring(m.x, m.z, m.def.radius + 1.5, 0xffffff, 0.4);
        shake(0.3); sfx.play('switch', m.model.group.position); hitStop = Math.max(hitStop, 0.14);
        const a = players.get(e.from)?.name, b = players.get(e.by)?.name;
        if (a && b) callout('SWITCH!', `${a} ⇄ ${b}`, 1.3);
      }
      break;
    }
    case 'wind': {
      const m = mobs.get(e.id);
      if (m) {
        m.wind = e.d; m.model.anim?.shot('2H_Melee_Attack_Chop', 1.4);
        if ((m.type === 'wolf' || m.type === 'alpha') && Math.random() < 0.4) sfx.play('growl', m.model.group.position, 0.7);
        if (e.r) fx.wedge(m.x, m.z, e.f, e.r, e.h, e.d);                 // bite wedge: step out of it
        if (e.ax !== undefined) fx.aimLine(m.x, m.z, e.ax, e.az, e.d);   // thorn shot: sidestep the line
        const near = Math.hypot(m.x - state.x, m.z - state.z) < 6;
        if (e.r && near) guide.tip('wedge');
        if (e.ax !== undefined && Math.hypot(e.ax - state.x, e.az - state.z) < 3) guide.tip('aim');
      }
      break;
    }
    case 'tele': {
      if (twists.tele(e)) break; // Warden twists: cracked ground, Echo strikes
      const mine = Math.hypot(e.x - state.x, e.z - state.z) < e.r + 2;
      if (e.k === 'line') {
        fx.lane(e.x, e.z, e.x2, e.z2, e.w, e.d);
        sfx.play('warn', { x: e.x, z: e.z }, 1.3);
        if (boss) { bossShot(boss.id, 'Cheer', 1.6); bossShot(boss.id, '2H_Melee_Attack_Stab', 1.4, Math.max(0, e.d - 0.2)); }
        guide.tip('lane');
        break;
      }
      fx.telegraph(e.x, e.z, e.r, e.d, e.follow ? () => mobs.get(e.follow)?.model.group.position : null);
      if (e.k === 'rock') { if (mine) { sfx.play('warn', { x: e.x, z: e.z }, 0.6); guide.tip('rock'); } break; }
      sfx.play('warn', { x: e.x, z: e.z });
      if (mine) guide.tip('slam');
      if (boss) bossShot(boss.id, e.follow ? '2H_Melee_Attack_Spin' : '2H_Melee_Attack_Slice', 1.2, Math.max(0, e.d - 0.55));
      break;
    }
    case 'buff': {
      const p = players.get(e.id);
      if (!p) break;
      if (e.k === 'wall') fx.shield(p.model.group, e.d, 0x60a5fa);
      else if (e.k === 'dr') fx.shield(p.model.group, e.d, 0xfbbf24);
      else if (e.k === 'bless') fx.ring(p.model.group.position.x, p.model.group.position.z, 1.5, 0xfde68a, 0.6);
      else if (e.k === 'tonic') fx.ring(p.model.group.position.x, p.model.group.position.z, 1.6, 0xfb923c, 0.6);
      else if (e.k === 'draught') fx.shield(p.model.group, 1.2, 0x4ade80);
      break;
    }
    case 'hit': {
      const m = mobs.get(e.id);
      if (m) hitJuice(m, e);
      if (m && !e.sw) {
        m.flash = 0.08;
        const mine = e.by === me || state.spectator;
        sfx.play(e.h ? 'hitHeavy' : e.c ? 'crit' : 'hit', m.model.group.position, e.by === me ? 1 : 0.55);
        if (e.by === me) {
          guide.did('hit');
          state.lastCombat = performance.now();
          hitStop = Math.max(hitStop, e.h ? 0.1 : e.c ? 0.07 : 0.04);
          if (e.h) shake(0.18);
          // knockback lands a little quicker than normal interpolation
          if (e.h && m.type !== 'warden') m.punch = 0.25;
        }
        floatNum(m.model.group.position, m.model.height * 0.7, e.c ? `${e.a}!` : `${e.a}`, e.c ? 'crit' : '', mine ? 1 : 0.55);
      }
      break;
    }
    case 'hurt': {
      const p = players.get(e.id);
      if (p) { p.flash = 0.15; const a = p.model.anim; if (a && !a.busy() && !a.dead) a.shot('Hit_A', 1.8);
        if (e.id === me) { state.lastCombat = performance.now(); sfx.play('hurt'); }
        if (e.id === me || state.spectator) floatNum(p.model.group.position, 2.2, `-${e.a}`, 'hurt'); if (e.id === me) shake(0.15); }
      break;
    }
    case 'heal': {
      const p = players.get(e.id);
      if (p && (state.spectator || e.id === me || (state.party && p.party === state.party))) floatNum(p.model.group.position, 2.4, `+${e.a}`, 'heal');
      break;
    }
    case 'xp': if (e.to === me) { const p = players.get(me); if (p) floatNum(p.model.group.position, 2.9, `+${e.a} XP`, 'xp'); if (e.a >= 10) guide.did('kill'); } break;
    case 'lvl': {
      const p = players.get(e.id);
      if (p) fx.ring(p.model.group.position.x, p.model.group.position.z, 3, 0xfde68a, 0.8);
      if (e.id === me) { banner(`LEVEL UP`, `You are now level ${e.lvl}`); buildSkillBar(e.lvl); sfx.play('levelup'); }
      break;
    }
    case 'die': {
      sfx.play('shatter', { x: e.x, z: e.z });
      if (e.b && Math.hypot(e.x - state.x, e.z - state.z) < 60) slowMotion(0.7, 0.3); // the Warden falls
      if (state.lock === e.id) state.lock = 0;
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
    case 'pdie': {
      if (e.id === me) {
        $('dead').innerHTML = `<div>You were defeated</div><small>${e.src && e.src !== '?' ? `by ${esc(e.src)} · ` : ''}returning to town…</small>`;
        $('dead').classList.remove('hidden');
      }
      break;
    }
    case 'phase':
      if (e.n === 1) { if (boss) { bossShot(boss.id, 'Cheer', 1.2); sfx.play('howl', boss.model.group.position, 1.3); } banner('THE HOUNDS ARE LOOSE', 'Phase 2: hounds and horn charges. Get out of the red lanes'); }
      break;
    case 'enrage': if (boss) { bossShot(boss.id, 'Cheer', 1.2); sfx.play('roar', boss.model.group.position, 1.4); } banner('THE WARDEN IS ENRAGED', 'Phase 3: spins and falling rocks. Keep moving'); break;
    case 'twist': twists.announce(e); updateGateBox(true); break;
    case 'la': {
      fx.beam(e.x, e.z, 0xfbbf24, 4.5); sfx.play('loot', { x: e.x, z: e.z }, 1.3);
      setTimeout(() => banner('LAST ATTACK BONUS', `${e.name} · Horn of the Warden`), 3400);
      break;
    }
    case 'clear': sfx.play('clear'); banner('FLOOR 1 CLEARED', e.names.join(' · ')); if (inArena(state.x, state.z)) guide.did('boss'); break;
    case 'forge': smith.onForge(e); break;
    case 'loot': {
      if (e.to !== me) break;
      const p = players.get(me);
      if (p && e.g) floatNum(p.model.group.position, 3.2, `+${e.g} gold`, 'gold');
      if (e.pot) log('Loot: Health Potion', 'r0');
      smith.onLoot(e);
      let best = -1;
      for (const it of e.items) { log(`Loot: ${it.name} (${RARITY[it.r].name})`, `r${it.r}`); best = Math.max(best, it.r); }
      if (best >= 0) {
        fx.beam(e.x, e.z, parseInt(RARITY[best].color.slice(1), 16), best >= 2 ? 3.5 : 1.6);
        if (p) floatNum(p.model.group.position, 3.6, e.items[0].name, `loot r${best}`);
        sfx.play('loot', { x: e.x, z: e.z }, best >= 2 ? 1 : 0.5);
        guide.tip('loot');
      } else if (e.g) sfx.play('coin', null, 0.5);
      break;
    }
    case 'drink': {
      const p = players.get(e.id);
      if (p) { p.model.anim?.shot('Spellcast_Raise', 2); if (e.id === me) sfx.play('drink'); }
      if (e.id === me) guide.did('bag');
      break;
    }
    case 'coin': if (e.id === me) sfx.play('coin'); break;
    case 'equip': if (e.id === me) sfx.play('shield', null, 0.5); break;
    case 'pjoin': if (e.id === me) { guide.did('party'); sfx.play('ui'); } break;
    case 'gate':
      if (e.s === 'count' && inGateZone(state.x, state.z)) { for (let i = 0; i < e.d; i++) setTimeout(() => sfx.play('tick'), i * 1000); }
      if (e.s === 'open') { sfx.play('gate', { x: 0, z: 161 }, 1.5); if (Math.abs(state.x) < 30 && state.z > 120) banner('THE RAID GATE OPENS', 'The Horned Warden awaits'); }
      break;
    case 'invite': if (e.to === me) showInvite(e.from, e.name); break;
    case 'chat': log(`${e.from}: ${e.text}`, e.id === me ? 'me' : ''); break;
    case 'sys': if (!e.to || e.to === me) log(e.text, 'sys'); break;
  }
}

// ---------------- character animation ----------------
const SKILL_ANIM = {
  slash: [['1H_Melee_Attack_Slice_Diagonal', 2.0], ['1H_Melee_Attack_Slice_Horizontal', 2.0], ['1H_Melee_Attack_Chop', 1.6]],
  rush: [['1H_Melee_Attack_Stab', 1.6]],
  whirl: [['2H_Melee_Attack_Spin', 1.5]],
  burst: [['1H_Melee_Attack_Slice_Diagonal', 2.6], ['1H_Melee_Attack_Slice_Horizontal', 2.6], ['1H_Melee_Attack_Chop', 2.6], ['1H_Melee_Attack_Stab', 1.8]],
  bash: [['1H_Melee_Attack_Slice_Diagonal', 1.8], ['1H_Melee_Attack_Slice_Horizontal', 1.8], ['Block_Attack', 1.5]],
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
  twists.decorate(e); // Thorn Totems
  if (type === 'warden') boss = e;
  if (e.def?.rare && e.label) { // gold "RARE" tag above a rare named enemy's name
    const tag = document.createElement('div');
    tag.textContent = '★ RARE ★';
    tag.style.cssText = 'font:800 11px/1 system-ui,sans-serif;letter-spacing:.14em;color:#fde047;text-shadow:0 0 6px #ef4444,0 1px 2px #000;text-align:center;margin-bottom:2px';
    e.label.el.insertBefore(tag, e.label.el.firstChild);
  }
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
  if (k === 'j') attackHeld = true;
  if (k === ' ') { e.preventDefault(); if (!e.repeat) jump(); }
  if (k === '1' || k === '2' || k === '3') useSkill(+k);
  if (k === 'shift' || k === 'k') dodge();
  if (k === 'tab') { e.preventDefault(); cycleLock(); }
  if (k === 'escape') { state.lock = 0; state.focus = 0; }
  if (k === 'p') $('players-btn').click();
  if (k === 'b' || k === 'i') toggleBag();
  if (k === 'f') interact();
  const ci = ['4', '5', '6'].indexOf(k);
  if (ci >= 0) useItem(CONSUMABLE_IDS[ci]);
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === 'j') attackHeld = false;
});
addEventListener('blur', () => { keys.clear(); attackHeld = false; });

// camera drag (mouse + touch on the right/anywhere outside the stick)
const drag = { id: null, x: 0, y: 0 };
let mouseAttack = false;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) { selectAt(e.clientX, e.clientY); return; }
    if (e.button === 0) { mouseAttack = true; attackHeld = true; return; }
    if (e.button !== 2) return;
  }
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
const endDrag = e => {
  if (e.pointerType === 'mouse' && e.button === 0 && mouseAttack) { mouseAttack = false; attackHeld = false; }
  if (e.pointerId === drag.id) drag.id = null;
};
addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0 && mouseAttack) { mouseAttack = false; attackHeld = false; } });
// screen-edge turning: park the cursor at the left/right edge to turn the camera that way
const EDGE_DELAY = 0.5; // seconds the cursor must rest at a screen edge before the camera turns
const mouse = { x: 0, y: 0, inside: false, onCanvas: false, edgeSide: 0, edgeSince: 0 };
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; mouse.onCanvas = e.target === canvas || e.target.closest?.('#labels'); });
document.documentElement.addEventListener('mouseleave', () => { mouse.inside = false; });
addEventListener('blur', () => { mouse.inside = false; mouseAttack = false; });
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
      <span class="key">${i === 0 ? (isTouch ? '' : 'CLICK') : i}</span>${s.name}${locked ? `<br><small>Lv ${s.lvl}</small>` : ''}<span class="cd"></span><span class="cdt"></span></button>`;
  }).join('') + `<button class="sk sd" data-slot="dodge" title="Dodge roll: dash and avoid damage"><span class="key">${isTouch ? '' : 'SHIFT'}</span>Dodge<span class="cd"></span><span class="cdt"></span></button>`
    + `<button class="sk sj" data-slot="jump" title="Jump: hop over the boss's ground slams"><span class="key">${isTouch ? '' : 'SPACE'}</span>Jump<span class="cd"></span><span class="cdt"></span></button>`
    + CONSUMABLE_IDS.map(id => `<button class="sk it2 ${id}" data-item="${id}" title="${CONSUMABLES[id].name}: ${CONSUMABLES[id].desc}"><span class="key">${isTouch ? '' : CONSUMABLES[id].key}</span>${CONSUMABLES[id].name.split(' ').pop()}<span class="cnt"></span><span class="cd"></span></button>`).join('')
    + `<button class="sk act" data-slot="act">Ready</button>`;
  for (const b of $('skills').children) {
    if (b.dataset.item || b.dataset.slot === 'act') {
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); if (b.dataset.item) useItem(b.dataset.item); else interact(); });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      continue;
    }
    if (b.dataset.slot === 'dodge' || b.dataset.slot === 'jump') {
      const act = b.dataset.slot === 'dodge' ? dodge : jump;
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); act(); });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      continue;
    }
    const slot = +b.dataset.slot;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); if (slot === 0) attackHeld = true; else useSkill(slot); });
    const up = () => { b.classList.remove('pressed'); if (slot === 0) attackHeld = false; };
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  }
}

// ---------- lock-on ----------
const lockRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
lockRing.rotation.x = -Math.PI / 2; lockRing.visible = false; scene.add(lockRing);
function cycleLock() {
  const fy = state.yaw, fx0 = Math.sin(fy), fz0 = Math.cos(fy);
  const list = [...mobs.values()]
    .filter(m => !m.dying && Math.hypot(m.x - state.x, m.z - state.z) < 25)
    .map(m => {
      const dx = m.x - state.x, dz = m.z - state.z, d = Math.hypot(dx, dz) || 1;
      return { m, score: d * (1.6 - (dx * fx0 + dz * fz0) / d) }; // prefer close and in front of the camera
    })
    .sort((a, b) => a.score - b.score).map(o => o.m);
  if (!list.length) { state.lock = 0; return; }
  const i = list.findIndex(m => m.id === state.lock);
  state.lock = i === -1 ? list[0].id : (i + 1 < list.length ? list[i + 1].id : 0);
  state.focus = 0;
  sfx.play('ui');
}

// Ctrl/Cmd + click a character (enemy or ally) to select it and lock the camera on it;
// Ctrl/Cmd + click empty ground to clear the selection.
function selectAt(sx, sy) {
  let best = null, bd = Infinity;
  const consider = (ent, kind) => {
    const g = ent.model.group.position, h = ent.model.height;
    const top = project(g.x, g.y + h, g.z), bot = project(g.x, g.y, g.z);
    if (!top || !bot) return;
    const hpx = Math.max(24, bot[1] - top[1]), wpx = Math.max(22, hpx * 0.45);
    const cx = (top[0] + bot[0]) / 2, cy = (top[1] + bot[1]) / 2;
    if (Math.abs(sx - cx) > wpx || sy < top[1] - 14 || sy > bot[1] + 10) return;
    const d = Math.hypot(sx - cx, sy - cy) + Math.hypot(g.x - state.x, g.z - state.z) * 0.5; // nearer wins ties
    if (d < bd) { bd = d; best = { ent, kind }; }
  };
  for (const m of mobs.values()) if (!m.dying) consider(m, 'mob');
  for (const p of players.values()) if (p.id !== state.myId && !p.dead) consider(p, 'player');
  state.lock = best?.kind === 'mob' ? best.ent.id : 0;
  state.focus = best?.kind === 'player' ? best.ent.id : 0;
  sfx.play('ui');
}
function focusedAlly() {
  const p = state.focus && players.get(state.focus);
  if (!p || Math.hypot(p.x - state.x, p.z - state.z) > 60) { state.focus = 0; return null; }
  return p;
}
function lockedMob() {
  const m = state.lock && mobs.get(state.lock);
  if (!m || m.dying || Math.hypot(m.x - state.x, m.z - state.z) > 35) { state.lock = 0; return null; }
  return m;
}

function jump() {
  const now = performance.now();
  if (state.dead || !state.joined || state.spectator || state.roll || now < state.jumpReady) return;
  state.jumpReady = now + JUMP.cd * 1000; state.jumpPress = now;
  const me = players.get(state.myId);
  if (me) { me.jumpT = 0; me.model.anim?.shot('Jump_Full_Short', 1.75); }
  sfx.play('roll', null, 0.4);
  send({ type: 'jump' });
}

function dodge() {
  const now = performance.now();
  if (state.dead || !state.joined || state.spectator || state.roll || now < state.dodgeReady) return;
  const dir = state.moveDir ?? state.face;
  state.roll = { left: DODGE.time, dir };
  state.face = dir;
  state.dodgeReady = now + DODGE.cd * 1000; state.dodgePress = now;
  send({ type: 'dodge', face: dir });
}

let tfKey = '';
function updateTargetFrame(t, isMob) {
  const el = $('target');
  if (!t) { if (tfKey) { el.classList.add('hidden'); tfKey = ''; } return; }
  const name = isMob ? t.def.name : t.name;
  const sub = isMob ? `Lv ${t.def.level}${t.def.elite ? ' · Elite' : t.def.boss ? ' · Boss' : ''}${t.staggered ? ' · BROKEN' : ''}` : `Lv ${t.lvl} · ${CLASSES[t.cls].name}`;
  const pct = Math.max(0, Math.round((t.hp / t.maxHp) * 100));
  const key = `${name}|${sub}|${pct}|${isMob}`;
  if (key === tfKey) return;
  tfKey = key;
  el.className = `frame ${isMob ? 'foe' : 'friend'}`;
  el.innerHTML = `<div class="row"><span>${esc(name)}</span><span class="sub">${sub}</span></div><div class="bar hp"><div style="width:${pct}%"></div><span>${t.hp} / ${t.maxHp}</span></div>`;
}

let calloutT = 0;
function callout(title, sub, secs) {
  const el = $('callout');
  el.innerHTML = `${title}<small>${esc(sub)}</small>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(calloutT); calloutT = setTimeout(() => el.classList.remove('show'), Math.max(900, secs * 1000));
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
    const lm = lockedMob();
    const t = lm && Math.hypot(lm.x - state.x, lm.z - state.z) < 14 ? lm : nearestMob(sk.id === 'smite' ? 11 : sk.id === 'rush' ? 9 : 6);
    if (t) state.face = angleTo(state.x, state.z, t.x, t.z);
  }
  state.ready[slot] = now + sk.cd * 1000;
  state.lastPress[slot] = now;
  send({ type: 'skill', slot, face: state.face });
}

// ---------------- items, merchant, raid gate ----------------
const nearMerchant = () => !state.dead && Math.hypot(state.x - MERCHANT.x, state.z - MERCHANT.z) < MERCHANT.r + 1;
function interactKind() {
  if (state.dead || !state.joined || state.spectator) return null;
  if (nearMerchant()) return 'shop';
  if (nearHall()) return 'hall';
  if (smith.near()) return 'smith';
  if (!state.gateOpen && inGateZone(state.x, state.z)) return 'gate';
  return null;
}
function interact() {
  const k = interactKind();
  if (k === 'shop') { state.shopOpen = true; $('bag').classList.remove('hidden'); renderBag(); sfx.play('ui'); }
  else if (k === 'hall') { toggleHall(); sfx.play('ui'); }
  else if (k === 'smith') { smith.toggle(); sfx.play('ui'); }
  else if (k === 'gate') { send({ type: 'ready' }); sfx.play('ui'); state.meReady = state.meReady ? 0 : 1; updateGateBox(true); }
}

// ---------------- titles & Hall of Clearers ----------------
const titleTag = id => { const t = TITLE_BY_ID[id]; return t ? `<small class="ttl" style="color:${t.color}">${t.name}</small>` : ''; };
let titleAt = 0;
function titleBanner(name, delay = 0) { // queue so several titles (e.g. after a Warden kill) each get their moment
  const now = performance.now();
  titleAt = Math.max(now + delay, titleAt + 3400);
  setTimeout(() => { banner('TITLE EARNED', name); sfx.play('levelup'); }, titleAt - now);
}
const nearHall = () => !state.dead && Math.hypot(state.x - HALL.x, state.z - HALL.z) < HALL.r + 1;
function toggleHall(open = $('hall').classList.contains('hidden')) {
  $('hall').classList.toggle('hidden', !open);
  if (open) { renderHall(); send({ type: 'hall' }); }
}
const fmtSecs = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : fmtDate(iso);
}
const hallParty = r => r.players.map(p => `<span title="Lv${p.lvl} ${CLASSES[p.cls]?.name || ''}">${esc(p.name)}</span>`).join(', ') || '—';
const hallMeta = r => `${esc(r.lastAttack || '?')} took the Last Attack · ${r.deaths} death${r.deaths === 1 ? '' : 's'}`;
function renderHall() {
  const el = $('hall');
  if (el.classList.contains('hidden')) return;
  const d = state.hallData;
  let h = `<div class="top"><span>HALL OF CLEARERS</span><button class="x" data-a="close">✕</button></div>`;
  if (!d) { el.innerHTML = `${h}<div class="empty">Reading the stone…</div>`; return; }
  h += '<h4>Server first clear · Floor 1</h4>';
  h += d.first ? `<div class="first"><b>${hallParty(d.first)}</b><small>${fmtDate(d.first.at)} · ${fmtSecs(d.first.secs)} · ${hallMeta(d.first)}</small></div>`
    : '<div class="empty">No one has cleared Floor 1 yet. The first names carved here could be yours.</div>';
  h += '<h4>Fastest clears</h4>';
  h += d.fastest.length ? d.fastest.map((r, i) => `<div class="row"><span class="n">${i + 1}</span><span class="t">${fmtSecs(r.secs)}</span><span class="who">${hallParty(r)}<small>${fmtDate(r.at)} · ${hallMeta(r)}</small></span></div>`).join('') : '<div class="empty">No clears yet.</div>';
  h += '<h4>Recent clears</h4>';
  h += d.recent.length ? d.recent.map(r => `<div class="row"><span class="t">${fmtSecs(r.secs)}</span><span class="who">${hallParty(r)}<small>${ago(r.at)} · ${hallMeta(r)}</small></span></div>`).join('') : '<div class="empty">No clears yet.</div>';
  el.innerHTML = h;
}
$('hall').addEventListener('click', e => { if (e.target.closest('[data-a="close"]')) { toggleHall(false); sfx.play('ui'); } });
// The board's floating label (called every frame), and close the panel when walking away.
function updateHallLabel() {
  const hl = $('hall-lbl'), hp = project(HALL.x, 5.4, HALL.z), hd = Math.hypot(state.x - HALL.x, state.z - HALL.z);
  if (hp && hd < 22) { hl.style.display = ''; hl.style.left = `${hp[0]}px`; hl.style.top = `${hp[1]}px`; const html = `Hall of Clearers${hd < HALL.r + 1 ? `<br><small>${isTouch ? 'tap Read' : 'press F to read'}</small>` : ''}`; if (hl.innerHTML !== html) hl.innerHTML = html; }
  else hl.style.display = 'none';
  if (hd > HALL.r + 7 && !$('hall').classList.contains('hidden')) toggleHall(false);
}
function useItem(id) {
  if (state.dead || !state.joined || !CONSUMABLES[id]) return;
  const now = performance.now();
  if (!(state.inv?.cons?.[id] > 0)) { log(`No ${CONSUMABLES[id].name}s left. The merchant in town sells them.`, 'sys'); return; }
  if (now < (state.ccdReady[id] || 0)) return;
  if (id === 'potion' && state.hp >= state.maxHp) { log('Already at full health.', 'sys'); return; }
  state.ccdReady[id] = now + CONSUMABLES[id].cd * 1000; (state.ccdPress ||= {})[id] = now;
  send({ type: 'use', id });
}
function toggleBag() {
  const el = $('bag');
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) { state.shopOpen = nearMerchant(); renderBag(); guide.did('bag'); sfx.play('ui'); }
}
$('bag-btn').onclick = toggleBag;

const statsText = it => Object.entries(it.st).map(([k, v]) => statLabel(k, v)).join(' · ');
function mainStat(it) { return it ? (it.st.atk ?? it.st.hp ?? Object.values(it.st).reduce((a, b) => a + b, 0)) : 0; }
function renderBag() {
  const el = $('bag');
  if (el.classList.contains('hidden') || !state.inv) return;
  const inv = state.inv, near = nearMerchant();
  const shopping = near && state.shopOpen;
  const row = (it, slotName, actions) => it
    ? `<div class="it"><span class="slot">${slotName}</span><span class="nm"><b class="r${it.r}">${esc(it.name)}</b><small>${statsText(it)}</small></span>${actions}</div>`
    : `<div class="it empty"><span class="slot">${slotName}</span><span class="nm"><small>Empty</small></span></div>`;
  let h = `<div class="top"><span>Bag <span class="gold">${inv.gold} gold</span></span><button class="x" data-a="close">✕</button></div>`;
  if (shopping) {
    h += `<div class="shop"><h4>Merchant</h4>${SHOP.map((s, i) => {
      const name = s.kind === 'cons' ? CONSUMABLES[s.id].name : s.slot === 'weapon' ? 'Uncommon weapon (your class)' : 'Uncommon armour';
      const desc = s.kind === 'cons' ? CONSUMABLES[s.id].desc : s.slot === 'weapon' ? '+7–9% damage' : '+8–12% max health';
      const price = s.kind === 'cons' ? CONSUMABLES[s.id].price : s.price;
      return `<div class="it"><span class="nm"><b>${name}</b><small>${desc}</small></span><button data-a="buy" data-i="${i}" ${inv.gold < price ? 'disabled style="opacity:.4"' : ''}>${price}g</button></div>`;
    }).join('')}</div>`;
  } else if (near) h += `<div class="it"><span class="nm"><small>You're at the merchant.</small></span><button data-a="shop">Trade</button></div>`;
  h += `<h4>Equipped</h4>${SLOTS.map(sl => row(inv.eq[sl], sl, inv.eq[sl] ? `<button data-a="unequip" data-s="${sl}">Remove</button>` : '')).join('')}`;
  const st = inv.stats;
  h += `<div class="stats"><span>Damage ${st.atk}</span><span>Health ${st.maxHp}</span><span>Crit ${st.crit}%</span><span>Cooldowns −${st.haste}%</span><span>Switch +${st.sw}%</span><span>Damage taken −${st.dr}%</span></div>`;
  h += `<h4>Consumables</h4>${CONSUMABLE_IDS.map(id => `<div class="it"><span class="slot">${CONSUMABLES[id].key}</span><span class="nm"><b>${CONSUMABLES[id].name} ×${inv.cons[id] || 0}</b><small>${CONSUMABLES[id].desc}</small></span><button data-a="use" data-id="${id}" ${inv.cons[id] ? '' : 'disabled style="opacity:.4"'}>Use</button></div>`).join('')}`;
  h += `<h4>Bag (${inv.bag.length}/24)</h4>`;
  h += inv.bag.length ? inv.bag.map(it => {
    const cur = inv.eq[it.slot], diff = Math.round((mainStat(it) - mainStat(cur)) * 10) / 10; // refined stats have one decimal
    const cmp = it.slot !== 'charm' && cur ? (diff > 0 ? ` <span class="up">▲${diff}</span>` : diff < 0 ? ` <span class="down">▼${-diff}</span>` : '') : !cur ? ' <span class="up">new</span>' : '';
    const usable = !it.cls || it.cls === state.cls;
    return `<div class="it"><span class="slot">${it.slot}</span><span class="nm"><b class="r${it.r}">${esc(it.name)}${cmp}</b><small>${statsText(it)}${usable ? '' : ` · ${CLASSES[it.cls].name} only`}</small></span>${usable ? `<button data-a="equip" data-u="${it.u}">Equip</button>` : ''}${shopping ? `<button class="sell" data-a="sell" data-u="${it.u}">${sellPrice(it)}g</button>` : ''}</div>`;
  }).join('') : '<div class="it empty"><span class="nm"><small>Nothing yet. Enemies drop gear; the Warden always does.</small></span></div>';
  h += smith.matsHtml(inv);
  h += renderTitles(inv.life);
  el.innerHTML = h;
}
// Titles section of the bag: earned ones can be worn (shown under your name), locked ones show the requirement.
function renderTitles(life) {
  if (!life) return '';
  const earned = TITLES.filter(t => life.titles.includes(t.id)), locked = TITLES.filter(t => !life.titles.includes(t.id));
  const wear = (id, on) => `<button data-a="title" data-t="${id || ''}" ${on ? 'disabled' : ''}>${on ? 'Worn ✓' : 'Wear'}</button>`;
  let h = `<h4>Titles (${earned.length}/${TITLES.length})</h4><div class="titles">`;
  h += `<div class="it ${!life.activeTitle ? 'on' : ''}"><span class="nm"><b>${DEFAULT_TITLE}</b><small>No title shown</small></span>${wear(null, !life.activeTitle)}</div>`;
  h += earned.map(t => `<div class="it ${life.activeTitle === t.id ? 'on' : ''}"><span class="nm"><b style="color:${t.color}">${t.name}</b><small>${t.req}</small></span>${wear(t.id, life.activeTitle === t.id)}</div>`).join('');
  h += locked.map(t => { const [have, need] = titleProgress(t, life); return `<div class="it locked"><span class="nm"><b>${t.name}</b><small>${t.req}</small></span>${need > 1 ? `<span class="prog">${have}/${need}</span>` : ''}</div>`; }).join('');
  return `${h}</div>`;
}
$('bag').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const a = b.dataset.a;
  if (a === 'close') { $('bag').classList.add('hidden'); return; }
  if (a === 'shop') { state.shopOpen = true; renderBag(); return; }
  if (a === 'buy') send({ type: 'buy', i: +b.dataset.i });
  if (a === 'sell') send({ type: 'sell', u: +b.dataset.u });
  if (a === 'equip') send({ type: 'equip', u: +b.dataset.u });
  if (a === 'unequip') send({ type: 'unequip', slot: b.dataset.s });
  if (a === 'use') useItem(b.dataset.id);
  if (a === 'title') send({ type: 'title', id: b.dataset.t || null });
  sfx.play('ui');
});

let gateKey = '';
function updateGateBox(force) {
  const el = $('gatebox');
  const [open, waiting, ready, count] = state.gate;
  const show = !state.spectator && !state.dead && !open && inGateZone(state.x, state.z);
  const key = `${show}|${waiting}|${ready}|${Math.ceil(count)}|${state.meReady}`;
  if (key === gateKey && !force) return;
  gateKey = key;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = `<b>RAID GATE</b><div class="sub">The Horned Warden · ${ready}/${waiting} ready${waiting > 1 ? '' : ' (solo)'}${ready && ready < waiting && !count ? '<br>Opens 20 s after the first ready, even if not everyone is' : ''}</div>`
    + (count > 0 ? `<div class="count">${Math.ceil(count)}</div>` : '')
    + `<button class="${state.meReady ? 'on' : ''}">${state.meReady ? 'Ready ✓' : `Ready${isTouch ? '' : ' (F)'}`}</button>`;
  twists.gateBox(el);
  el.querySelector('button').onclick = interact;
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
// Banners queue up so two at once (e.g. a rare sighting and a title) don't overwrite each other.
const bannerQ = []; let bannerBusy = false;
function banner(title, sub = '') {
  if (bannerQ.some(b => b[0] === title && b[1] === sub)) return;
  bannerQ.push([title, sub]);
  if (!bannerBusy) nextBanner();
}
function nextBanner() {
  const b = bannerQ.shift();
  if (!b) { bannerBusy = false; return; }
  bannerBusy = true;
  const [title, sub] = b;
  $('banner').innerHTML = `${title}${sub ? `<small>${sub.replace(/</g, '&lt;')}</small>` : ''}`;
  $('banner').classList.add('show');
  clearTimeout(bannerT);
  const hold = bannerQ.length ? 2200 : 3200;
  bannerT = setTimeout(() => { $('banner').classList.remove('show'); setTimeout(nextBanner, 350); }, hold);
}
let areaT = 0;
function showArea(name) {
  $('area').textContent = name; $('area').classList.add('show');
  clearTimeout(areaT); areaT = setTimeout(() => $('area').classList.remove('show'), 2600);
}

$('sound-btn').textContent = sfx.on ? 'Sound on' : 'Sound off';
$('sound-btn').onclick = () => { sfx.unlock(); $('sound-btn').textContent = sfx.toggle() ? 'Sound on' : 'Sound off'; };
$('lock-btn').onpointerdown = e => { e.preventDefault(); cycleLock(); };
canvas.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
$('chat-btn').onclick = () => { const t = prompt('Say something'); if (t && t.trim()) send({ type: 'chat', text: t.trim() }); };
$('players-btn').onclick = () => { $('players').classList.toggle('hidden'); renderPlayers(); };
function renderPlayers() {
  if ($('players').classList.contains('hidden')) return;
  const rows = [];
  for (const [id, r] of state.roster) {
    if (id === state.myId) continue;
    const p = players.get(id);
    const inParty = state.party && p?.party === state.party;
    const lfgTag = (p?.buffs || 0) & 4 ? '<span class="tag">LFG</span>' : '';
    rows.push(`<div class="p"><span>${esc(r.name)} <small style="opacity:.6">Lv ${p?.lvl ?? 1} ${CLASSES[r.cls].name}</small>${lfgTag}</span>${inParty ? '<small>Party</small>' : `<button data-inv="${id}">Invite</button>`}</div>`);
  }
  const meE = players.get(state.myId), seeking = !!((meE?.buffs || 0) & 4);
  const lfgBtn = `<button class="lfg ${seeking ? 'on' : ''}">${state.party ? (seeking ? 'Recruiting via party finder ✓' : 'Recruit with party finder') : seeking ? 'Searching for a party… (cancel)' : 'Find party'}</button>`;
  $('players').innerHTML = `${lfgBtn}<b>Online (${state.roster.size})</b>${rows.join('') || '<div style="opacity:.6;font-size:13px;padding:6px 0">Nobody else yet. Share the link with friends!</div>'}${state.party ? '<button class="leave">Leave party</button>' : ''}`;
  $('players').querySelector('.lfg').onclick = () => { send({ type: 'lfg' }); sfx.play('ui'); setTimeout(renderPlayers, 150); };
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
  const meHtml = `${esc(name)}${titleTag(state.roster.get(state.myId)?.title)}`;
  if ($('me-name').innerHTML !== meHtml) $('me-name').innerHTML = meHtml;
  $('me-lvl').textContent = `Lv ${state.lvl} ${CLASSES[state.cls].name}`;
  const pct = (state.hp / state.maxHp) * 100;
  setBar($('me-hp'), pct, $('me-hp').parentElement);
  $('me-hp-text').textContent = `${state.hp} / ${state.maxHp}`;
  setBar($('me-xp'), state.lvl >= MAX_LEVEL ? 100 : (state.xp / state.next) * 100);
  const me = players.get(state.myId);
  const b = me?.buffs || 0;
  $('me-buffs').innerHTML = `${b & 1 ? '<span>Guarded</span>' : ''}${b & 2 ? '<span>Blessed</span>' : ''}`;

  // party frames
  const mates = state.spectator ? [...players.values()] : state.party ? [...players.values()].filter(p => p.party === state.party && p.id !== state.myId) : [];
  $('party').innerHTML = mates.map(p => {
    const pc = (p.hp / p.maxHp) * 100;
    return `<div class="frame ${p.dead ? 'dead' : ''}"><div class="row" style="font-size:12px;margin:0"><span>${esc(p.name)}${titleTag(state.roster.get(p.id)?.title)}${state.spectator ? ` <small style="opacity:.75;font-weight:600">${CLASSES[p.cls].name} · ${CLASSES[p.cls].role}</small>` : ''}</span><span style="opacity:.7">Lv ${p.lvl}</span></div><div class="bar hp ${pc < 25 ? 'low' : pc < 50 ? 'mid' : ''}"><div style="width:${pc}%"></div></div></div>`;
  }).join('');

  // boss bar
  const showBoss = boss && (boss.engaged || boss.hp < boss.maxHp) && state.z > 120;
  $('boss').classList.toggle('hidden', !showBoss);
  if (showBoss) {
    setBar($('boss-hp'), (boss.hp / boss.maxHp) * 100); $('boss').classList.toggle('enraged', !!boss.enraged);
    $('boss-phase').textContent = ['PHASE 1 · CLEAVE & SLAM', 'PHASE 2 · HOUNDS & HORN CHARGE', 'PHASE 3 · ENRAGED · ROCKFALL'][state.phase] || '';
    twists.bossLine($('boss-phase'));
  }

  // items, raid gate, merchant, guide
  $('gold-chip').textContent = `${state.gold}g`;
  $('me-buffs').innerHTML += `${state.tonic > 0 ? `<span>Tonic ${Math.ceil(state.tonic)}s</span>` : ''}${state.draught > 0 ? `<span>Ironbark ${Math.ceil(state.draught)}s</span>` : ''}`;
  updateGateBox();
  const near = nearMerchant();
  if (near !== state.wasNear) { state.wasNear = near; if (!near) state.shopOpen = false; renderBag(); }
  if (!state.dead && state.hp / state.maxHp < 0.35 && state.hp > 0) guide.tip('lowhp');
  if (inArena(state.x, state.z)) guide.did('gate');

  // cooldowns
  for (const btn of $('skills').children) {
    if (btn.dataset.item) {
      const id = btn.dataset.item, n = state.inv?.cons?.[id] || 0, left = Math.max(0, (state.ccdReady[id] || 0) - now) / 1000;
      btn.querySelector('.cnt').textContent = `×${n}`;
      btn.classList.toggle('none', n === 0);
      btn.querySelector('.cd').style.setProperty('--p', `${Math.min(100, (left / CONSUMABLES[id].cd) * 100)}%`);
      continue;
    }
    if (btn.dataset.slot === 'act') { const a = interactKind(); btn.classList.toggle('on', !!a); btn.textContent = a === 'shop' ? 'Trade' : a === 'hall' ? 'Read' : a === 'smith' ? 'Forge' : state.meReady ? 'Unready' : 'Ready'; continue; }
    const isDodge = btn.dataset.slot === 'dodge', isJump = btn.dataset.slot === 'jump';
    const slot = +btn.dataset.slot, sk = isDodge ? { cd: DODGE.cd } : isJump ? { cd: JUMP.cd } : CLASSES[state.cls].skills[slot];
    const left = Math.max(0, (isDodge ? state.dodgeReady : isJump ? state.jumpReady : state.ready[slot]) - now) / 1000;
    btn.querySelector('.cd').style.setProperty('--p', `${Math.min(100, (left / sk.cd) * 100)}%`);
    btn.querySelector('.cdt').textContent = left > 0.3 && slot > 0 && !isDodge && !isJump ? left.toFixed(left < 3 ? 1 : 0) : '';
  }

  const fightingBoss = boss && (boss.engaged || boss.hp < boss.maxHp) && state.z > 150;
  sfx.setMood(inTown(state.x, state.z) ? 'town' : fightingBoss ? 'boss' : 'field');
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

// ---------------- juice: hit sparks, flinch, killing-blow slow motion ----------------
const FLINCH_T = 0.1;
function hitJuice(m, e) {
  const g = m.model.group.position, big = m.type === 'warden';
  const by = players.get(e.by)?.model.group.position;
  let dx = 0, dz = 0;
  if (by) { dx = g.x - by.x; dz = g.z - by.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d; }
  // sparks on the side of the enemy facing the attacker
  const r = m.def.radius * 0.8, y = Math.min(m.model.height * 0.55, big ? 3.2 : 2.2);
  const n = e.h ? 10 : e.c ? 9 : 6, color = e.c || e.sw ? 0xfde68a : e.h ? 0xffd9a0 : 0xffffff;
  fx.sparks(g.x - dx * r, y, g.z - dz * r, n, color, e.h || e.c ? 0.3 : 0.2, e.h ? 10 : 7);
  if (e.c) fx.sparks(g.x - dx * r, y, g.z - dz * r, 4, 0xffffff, 0.42, 4);
  // flinch: non-boss enemies squash and get shoved back; the boss barely reacts
  m.flinch = FLINCH_T;
  m.flinchAmt = big ? 0.03 : e.h ? 0.16 : 0.12;
  m.flinchPush = big ? 0 : e.h ? 0.35 : 0.22;
  m.flinchX = dx; m.flinchZ = dz;
}

// Slow down visual time (animation and effects only; input and movement keep real time).
let slowMo = 0, slowMoScale = 1, slowMoLen = 1;
function slowMotion(secs, scale) {
  slowMo = slowMoLen = secs; slowMoScale = scale;
  shake(0.45); hitStop = 0;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function rareBearing(x, z) { // +z is north (towards the Warden); screen-right at the default camera is -x, so east is -x
  const dx = x - state.x, dz = z - state.z, d = Math.round(Math.hypot(dx, dz));
  const a = Math.atan2(-dx, dz); // 0 = north, +pi/2 = east
  return [d, COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]];
}

let rareHintEl = null, rareHintT = 0;
function updateRareHint(now) { // a small HUD line pointing at a live rare: "Old Tusk · 84 m north"
  if (now - rareHintT < 150) return; rareHintT = now;
  let rare = null;
  for (const m of mobs.values()) if (m.def?.rare && !m.dying) { rare = m; break; }
  if (!rareHintEl) {
    rareHintEl = document.createElement('div');
    rareHintEl.id = 'rare-hint';
    rareHintEl.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:6;pointer-events:none;font:700 13px/1.2 system-ui,sans-serif;color:#fde68a;background:rgba(40,8,8,.72);border:1px solid rgba(251,191,36,.55);border-radius:999px;padding:4px 12px;text-shadow:0 1px 2px #000;white-space:nowrap;display:none';
    document.body.appendChild(rareHintEl);
  }
  if (!rare || !state.joined) { rareHintEl.style.display = 'none'; return; }
  const [d, dir] = rareBearing(rare.x, rare.z);
  const rel = Math.atan2(rare.x - state.x, rare.z - state.z) - state.yaw;
  const deg = Math.round((-Math.atan2(Math.sin(rel), Math.cos(rel)) * 180) / Math.PI);
  const hp = Math.round((rare.hp / rare.maxHp) * 100);
  rareHintEl.innerHTML = `<span style="display:inline-block;transform:rotate(${deg}deg);color:#f87171">▲</span> <b style="color:#fbbf24">RARE</b> ${esc(rare.def.name)} · ${d < 6 ? 'here' : `${d} m ${dir}`}${hp < 100 ? ` · ${hp}%` : ''}`;
  rareHintEl.style.display = '';
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
  if (e.jumpT !== undefined && e.jumpT < JUMP.time) {
    e.jumpT += dt;
    const jk = Math.min(1, e.jumpT / JUMP.time);
    g.position.y = 4 * JUMP.height * jk * (1 - jk);
  } else g.position.y = 0;
  if (e.punch > 0) e.punch -= dt;
  const kk = e.punch > 0 ? Math.min(1, dt * 22) : k;
  if (Math.hypot(tx - px, tz - pz) > 15) g.position.set(tx, 0, tz);
  else if (e.punch > 0) { g.position.x += (tx - px) * kk; g.position.z += (tz - pz) * kk; }
  else if (!(e.punch > 0)) { g.position.x += (tx - px) * k; g.position.z += (tz - pz) * k; }
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
    a.update(hitStop > 0 ? dt * 0.08 : dt);
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
  if (e.kind === 'mob') { // dizzy ring over a broken (staggered) enemy
    if (e.staggered && !e.dizzy) {
      e.dizzy = new THREE.Mesh(new THREE.TorusGeometry(e.def.radius * 0.6 + 0.3, 0.07, 6, 24), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
      e.dizzy.rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), e.dizzy.material);
        const a = (i / 4) * Math.PI * 2, r = e.def.radius * 0.6 + 0.3;
        st.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); e.dizzy.add(st);
      }
      g.add(e.dizzy);
    }
    if (e.dizzy) {
      e.dizzy.visible = !!e.staggered;
      e.dizzy.position.y = m.height + 0.1; e.dizzy.rotation.z += dt * 4;
      if (!m.anim) m.body.rotation.z = e.staggered ? Math.sin(performance.now() / 90) * 0.15 : 0;
    }
  }
  if (e.flash > 0) e.flash -= dt;
  if (e.flinch !== undefined) { // hit flinch: quick squash plus a small shove away from the attacker (visual only)
    e.flinch = Math.max(0, e.flinch - dt);
    const fk = e.flinch / FLINCH_T, amt = (e.flinchAmt || 0) * fk;
    g.scale.set(1 + amt * 0.5, 1 - amt, 1 + amt * 0.5);
    if (!m.anim && m.body) {
      const r = g.rotation.y, push = amt * (e.flinchPush || 0) / 0.12, dx = e.flinchX || 0, dz = e.flinchZ || 0;
      m.body.position.x = (dx * Math.cos(r) - dz * Math.sin(r)) * push;
      m.body.position.z = (dx * Math.sin(r) + dz * Math.cos(r)) * push;
    }
    if (e.flinch <= 0) { g.scale.set(1, 1, 1); if (m.body && !m.anim) { m.body.position.x = 0; m.body.position.z = 0; } e.flinch = undefined; }
  }
  const enr = e.kind === 'mob' && e.enraged ? (m.anim ? 0.12 : 0.3) + Math.sin(performance.now() / 120) * (m.anim ? 0.06 : 0.15)
    : e.kind === 'mob' && e.frenzy ? 0.1 + Math.sin(performance.now() / 90) * 0.06 : 0;
  const glow = e.flash > 0 ? (e.type === 'warden' ? 0.18 : 0.35) : enr;
  for (const mt of e.mats) { mt.emissive.setHex(e.flash > 0 && !enr ? 0xffffff : 0xff2200); mt.emissiveIntensity = glow; }

  if (e.label) {
    const p = project(g.position.x, g.position.y + m.height + 0.55, g.position.z);
    const d = Math.hypot(g.position.x - state.x, g.position.z - state.z);
    if (!p || d > 45 || (e.kind === 'player' && e.dead)) { e.label.el.style.display = 'none'; return; }
    e.label.el.style.display = '';
    e.label.el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%)`;
    e.label.el.style.left = '0'; e.label.el.style.top = '0';
    const txt = e.kind === 'mob' ? `<span class="lv">Lv${e.def.level}</span>${e.def.name}${e.staggered ? ' <b class="brk">BROKEN</b>' : ''}` : `<span class="lv">Lv${e.lvl}</span>${esc(e.name)}${state.spectator ? ` · ${CLASSES[e.cls].role}` : ''}${titleTag(state.roster.get(e.id)?.title)}`;
    if (txt !== e.label.text) { e.label.text = txt; e.label.nm.innerHTML = txt; }
    const pct = Math.round((e.hp / e.maxHp) * 100);
    if (pct !== e.label.pct) { e.label.pct = pct; e.label.fill.style.width = `${pct}%`; }
    if (e.kind === 'player') e.label.el.className = `lbl ${state.party && e.party === state.party ? 'party' : 'ally'}`;
    else if (e.def.elite && !e.label.el.classList.contains('elite')) e.label.el.classList.add('elite');
  }
}

// Spectator camera: frame the whole group, side-on to the fight so roles are readable.
const spec = { x: 0, z: 30, vx: 0, vz: 0, init: false };
function spectatorCamera(dt) {
  const alive = [...players.values()].filter(p => !p.dead);
  if (!alive.length) return [spec.x, spec.z];
  let ax = 0, az = 0;
  for (const p of alive) { ax += p.model.group.position.x; az += p.model.group.position.z; }
  ax /= alive.length; az /= alive.length;
  let foe = null, fd = 16;
  for (const m of mobs.values()) { const d = Math.hypot(m.x - ax, m.z - az); if (d < fd + (m.type === 'warden' ? 10 : 0)) { fd = d; foe = m; } }
  if (foe) { ax = ax * 0.6 + foe.x * 0.4; az = az * 0.6 + foe.z * 0.4; }
  if (!spec.init) { Object.assign(spec, { x: ax, z: az, init: true }); state.yaw = 0; }
  const k = Math.min(1, dt * 2.5);
  const px = spec.x, pz = spec.z;
  spec.x += (ax - spec.x) * k; spec.z += (az - spec.z) * k;
  spec.vx += ((spec.x - px) / Math.max(dt, 1e-3) - spec.vx) * Math.min(1, dt * 2);
  spec.vz += ((spec.z - pz) / Math.max(dt, 1e-3) - spec.vz) * Math.min(1, dt * 2);
  let want = state.yaw;
  if (foe) {
    const tank = alive.find(p => p.cls === 'guardian') || alive[0];
    want = Math.atan2(foe.x - tank.model.group.position.x, foe.z - tank.model.group.position.z) + 1.1; // three-quarter side view
    const off = Math.hypot(spec.x - 0, spec.z - 190);
    if (inArena(spec.x, spec.z) && off > 5) { // near the wall: shoot from the middle of the arena outward
      const out = Math.atan2(spec.x - 0, spec.z - 190), d = Math.atan2(Math.sin(want - out), Math.cos(want - out));
      want = out + Math.max(-0.6, Math.min(0.6, d));
    }
  } else if (Math.hypot(spec.vx, spec.vz) > 1.5) want = Math.atan2(spec.vx, spec.vz);
  const dy = Math.atan2(Math.sin(want - state.yaw), Math.cos(want - state.yaw));
  state.yaw += dy * Math.min(1, dt * 0.9);
  const big = foe?.type === 'warden';
  state.camDist += ((big ? 19 : foe ? 14 : 13) - state.camDist) * Math.min(1, dt * 1.5);
  state.pitch += ((big ? 0.62 : 0.5) - state.pitch) * Math.min(1, dt * 1.5);
  state.x = spec.x; state.z = spec.z;
  return [spec.x, spec.z];
}

let hitStop = 0;
const projFx = new Map(); // thorn id -> effect
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  hitStop = Math.max(0, hitStop - dt);
  slowMo = Math.max(0, slowMo - dt);
  const vdt = slowMo > 0 ? dt * slowMoScale : dt; // visual dt: animation and effects only
  const lm = state.joined && !state.spectator ? lockedMob() : null;
  const la = !lm && state.joined && !state.spectator ? focusedAlly() : null;
  const sel = lm || la;
  if (state.joined && !state.spectator && !isTouch && mouse.inside && mouse.onCanvas && drag.id === null && document.activeElement !== $('chat-input')) {
    const edge = Math.max(40, innerWidth * 0.06);
    const side = mouse.x < edge ? 1 : mouse.x > innerWidth - edge ? -1 : 0;
    if (side !== mouse.edgeSide) { mouse.edgeSide = side; mouse.edgeSince = now; }
    const held = (now - mouse.edgeSince) / 1000 - EDGE_DELAY; // turn only after the cursor rests there for a moment
    if (side && held > 0) {
      const depth = side > 0 ? 1 - mouse.x / edge : 1 - (innerWidth - mouse.x) / edge;
      state.yaw += side * dt * 2.4 * Math.max(0.25, depth) * Math.min(1, held / 0.3); // ease in over 0.3 s
    }
  } else mouse.edgeSide = 0;
  if (sel) { // ease the camera round to keep the selected character in view
    const gp = sel.model.group.position;
    if (Math.hypot(gp.x - state.x, gp.z - state.z) > 1.5) {
      const want = Math.atan2(gp.x - state.x, gp.z - state.z);
      state.yaw += Math.atan2(Math.sin(want - state.yaw), Math.cos(want - state.yaw)) * Math.min(1, dt * 3);
    }
    lockRing.visible = true; lockRing.position.set(gp.x, 0.12, gp.z);
    lockRing.material.color.setHex(lm ? 0xfbbf24 : 0x4ade80);
    lockRing.scale.setScalar(lm ? lm.def.radius + 0.6 : 0.9); lockRing.rotation.z += dt * 1.5;
  } else lockRing.visible = false;
  updateTargetFrame(sel, !!lm);

  if (state.joined && !state.dead && !state.spectator) {
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
    state.moveDir = null;
    if (mag > 0.08) {
      const fy = state.yaw;
      const mx = Math.sin(fy) * iz - Math.cos(fy) * ix, mz = Math.cos(fy) * iz + Math.sin(fy) * ix;
      state.moveDir = Math.atan2(mx, mz);
    }
    if (state.roll) {
      const step = Math.min(state.roll.left, dt) * (DODGE.dist / DODGE.time);
      state.roll.left -= dt;
      let [nx, nz] = resolveCollision(state.x + Math.sin(state.roll.dir) * step, state.z + Math.cos(state.roll.dir) * step);
      if (walkable(nx, nz, !state.gateOpen)) { state.x = nx; state.z = nz; }
      if (state.roll.left <= 0) state.roll = null;
    } else if (mag > 0.08) {
      const fy = state.yaw;
      const fwd = [Math.sin(fy), Math.cos(fy)], right = [-Math.cos(fy), Math.sin(fy)];
      let mx = fwd[0] * iz + right[0] * ix, mz = fwd[1] * iz + right[1] * ix;
      const ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
      const sprint = performance.now() - state.lastCombat > SPRINT_AFTER * 1000;
      const want = (sprint ? SPRINT_SPEED : PLAYER_SPEED) * mag;
      state.speed += (want - state.speed) * Math.min(1, dt * (want > state.speed ? 3 : 10));
      const step = state.speed * dt;
      let nx = state.x + mx * step, nz = state.z + mz * step;
      [nx, nz] = resolveCollision(nx, nz);
      const gc = !state.gateOpen;
      if (!walkable(nx, nz, gc)) { // slide along the boundary
        if (walkable(nx, state.z, gc)) nz = state.z; else if (walkable(state.x, nz, gc)) nx = state.x; else { nx = state.x; nz = state.z; }
      }
      state.moved += Math.hypot(nx - state.x, nz - state.z);
      if (state.moved > 10) guide.did('move');
      state.x = nx; state.z = nz;
      state.face = Math.atan2(mx, mz);
    } else state.speed = 0;
    if (attackHeld && !state.roll) useSkill(0);
  }

  if (state.joined && !state.spectator && now - sendT >= 1000 / TICK_RATE) {
    sendT = now;
    send({ type: 'input', x: +state.x.toFixed(2), z: +state.z.toFixed(2), face: +state.face.toFixed(2), seq: state.seq });
  }

  for (const e of players.values()) animateEntity(e, e.id === state.myId ? dt : vdt); // your own character stays responsive
  for (const e of mobs.values()) animateEntity(e, vdt);
  fx.update(vdt);
  crystal.rotation.y += vdt;
  gateMesh.update(vdt);
  if (merchantNpc?.anim) merchantNpc.anim.update(vdt);
  smith.frame(vdt);
  if (state.joined && !state.spectator) {
    const ml = $('merchant-lbl'), mp = project(MERCHANT.x, 3.6, MERCHANT.z), md = Math.hypot(state.x - MERCHANT.x, state.z - MERCHANT.z);
    if (mp && md < 20) { ml.style.display = ''; ml.style.left = `${mp[0]}px`; ml.style.top = `${mp[1]}px`; ml.innerHTML = `Merchant${md < MERCHANT.r + 1 ? `<br><small>${isTouch ? 'tap Trade' : 'press F to trade'}</small>` : ''}`; }
    else ml.style.display = 'none';
    updateHallLabel();
  }

  // camera
  const me = players.get(state.myId);
  let cx = me ? me.model.group.position.x : 0, cz = me ? me.model.group.position.z : 30;
  if (state.spectator) [cx, cz] = spectatorCamera(dt);
  const cp = state.pitch;
  // pull the camera in when a wall or pillar is between it and the player
  const dir = new THREE.Vector3(-Math.sin(state.yaw) * Math.cos(cp), Math.sin(cp), -Math.cos(state.yaw) * Math.cos(cp));
  ray.set(new THREE.Vector3(cx, 1.6, cz), dir); ray.far = state.camDist;
  const hit = ray.intersectObjects(occluders, true)[0];
  const allowed = hit ? Math.max(2, hit.distance - 0.6) : state.camDist;
  camCur += (allowed - camCur) * Math.min(1, dt * (allowed < camCur ? 20 : 3));
  const cd = camCur * (slowMo > 0 ? 1 - 0.22 * Math.sin(Math.PI * (1 - slowMo / slowMoLen)) : 1); // killing-blow zoom
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
  twists.frame(vdt, cx, cz); // Eclipse darkness
  sfx.listener.x = cx; sfx.listener.z = cz;

  // floating numbers
  for (let i = nums.length - 1; i >= 0; i--) {
    const n = nums[i]; n.age += vdt;
    if (n.age > 0.9) { n.el.remove(); nums.splice(i, 1); continue; }
    const p = project(n.x, n.y + n.age * 1.6, n.z);
    if (!p) { n.el.style.display = 'none'; continue; }
    n.el.style.display = '';
    n.el.style.left = `${p[0]}px`; n.el.style.top = `${p[1]}px`;
    n.el.style.opacity = String(n.opacity * (1 - Math.max(0, n.age - 0.5) / 0.4));
  }

  if (state.joined) updateHud(now);
  updateRareHint(now);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// handy for debugging from the console
window.__fb = { state, players, mobs, banner, sfx, project };
