// Floorbound browser client: networking, input, camera, entities and HUD.
import * as THREE from 'three';
import {
  CLASSES, CLASS_IDS, MOBS, MOB_IDS, PACE, PLAYER_SPEED, SPRINT_SPEED, SPRINT_AFTER, TICK_RATE, MAX_LEVEL, DODGE, JUMP,
  walkable, resolveCollision, inTown, inArena, areaName, angleTo, inGateZone,
} from '/shared/data.js';
import { airStep } from '/shared/data.js'; // jump air control
import { RARITY, CONSUMABLES, CONSUMABLE_IDS, SHOP, MERCHANT, SLOTS, statLabel, sellPrice } from '/shared/items.js';
import { TITLES, TITLE_BY_ID, DEFAULT_TITLE, HALL, titleProgress } from '/shared/titles.js';
import { Guide, STEPS as GUIDE_STEPS } from '/guide.js';
import { createWorld, makePlayerModel, makeMobModel, Effects, loadAssets } from '/world.js';
import { initLooks } from '/looks.js';
import { TwistClient } from '/twists.js';
import { Sound } from '/audio.js';
import { createSmith } from '/smith.js';
import { initGround } from '/ground.js';
import { MATS, MAT_IDS } from '/shared/crafting.js';
import { initCombat } from '/combat.js';
import { F2, inGateZone2, inArena2, onFloor2, floorOf, WAYSTONES } from '/shared/floor2.js';
import { initFloor2Client } from '/floor2client.js';
import { initFloor3Client } from '/floor3client.js';
import { initArenas } from '/arenas.js'; // multi-area boss fights: the Colossus's fall to the Undercroft (J2)
import { inArena3, inGateZone3, onFloor3 } from '/shared/floor3.js';
import { initMastery } from '/mastery.js';
import { initClassesB } from '/classes-b.js';
import { initClassesA } from '/classes-a.js';
import { initStyles } from '/styles.js';
import { initPlayerBots } from '/playerbots.js';
import { initNamed, talkTo } from '/named.js'; // the Friends tab: the Named and your friendship with them
import { snapPoses, poseFrame } from '/poses.js'; // kneel / sit / bow (F5)
import { initTalents } from '/talents.js';
import { initLoot } from '/loot.js'; // affixes, set progress, loadouts, item tooltips (H2)
import { initBotWheel } from '/botwheel.js';
import { initBell } from '/bell.js'; // the Tower Bell and the engraved Hall stones
import { initCine } from '/cine.js'; // film view camera, titles, fades, letterbox, light (F4)
import { initBubbles } from '/bubbles.js';
import { initThreat } from '/threat.js'; // who bosses target, threat meter, Cover, Pincer tags (G3)
import { initRevive } from '/revive.js'; // downed + revive (G1)
import { initBossTeam } from '/bossteam.js'; // boss team mechanics: STACK, SPREAD, tether (G4)
import { initTeamplay } from '/teamplay.js'; // combo counters, the Team Burst bar and sync window (G2)
import { initMvp } from '/mvp.js'; // the post-fight MVP card (G5)
import { Q, PRESETS, setLevel, startLevel, startAntialias } from '/quality.js'; // graphics quality: Low / Medium / High / Auto
import { SnapClock, Track, Correction } from '/shared/netsmooth.js'; // interpolation buffer, late snapshots, your own corrections
import { initPerf } from '/perf.js'; // the diagnostics overlay (F3), the ping chip, Auto quality
import { makeNetsim } from '/netsim.js'; // test-only bad network (?netsim=120,60,2)
import { initGameMenu } from '/gamemenu.js'; // the Game Menu (Esc / ☰)
import { createInput } from '/input.js'; // keys, mouse buttons (and pads, K1b) -> actions, by the bindings in shared/controls.js
import { createPanels } from '/panels.js'; // the panels that free the cursor / close on Esc
import { loadSettings, saveSettings as storeSettings, initSettingsPanel } from '/settings.js'; // fb_settings + fb_controls, the Settings panel

const sfx = new Sound();

const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const SPECTATE = QS.has('spectate');
const NOINTERP = QS.get('interp') === '0'; // the old smoothing (chase the newest snapshot), for comparisons
const netsim = makeNetsim(QS.get('netsim')); // test-only: delay / jitter / reorder what the server sends
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------- settings (camera, chat, graphics; public/settings.js) ----------
const settings = loadSettings();
const saveSettings = () => storeSettings(settings);
if (QS.get('quality')) settings.quality = QS.get('quality'); // (tests: ?quality=low)
const lastAuto = (() => { try { return localStorage.getItem('fb_autoq'); } catch { return null; } })(); // where Auto settled last time
setLevel(startLevel(settings.quality, { touch: isTouch, lastAuto }));
const MSAA = startAntialias(settings.quality, { touch: isTouch, lastAuto }); // chosen before the renderer exists (it can't change after)

// ---------------- renderer & scene ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: MSAA, powerPreference: 'high-performance' }); // (antialias: fixed until a reload)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
const { sun, crystal, occluders, treeFader, gate: gateMesh, root: floor1 } = createWorld(scene); // floor1: Floor 1-only scenery
const ray = new THREE.Raycaster();
let camCur = 11;
const fx = new Effects(scene);
const twists = new TwistClient({ scene, fx, banner: (t, s) => banner(t, s) }); // Warden twists
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
// Graphics quality (public/quality.js): pixel ratio, shadows, effect density, draw distance, far animation rate.
function applyQuality(level, over = null) { // over: Auto's overrides (public/quality.js AutoQuality.over)
  const hadShadows = renderer.shadowMap.enabled;
  setLevel(level, over);
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio, isTouch ? 1.5 : 2));
  resize();
  renderer.shadowMap.enabled = Q.shadows; sun.castShadow = Q.shadows;
  if (sun.shadow.mapSize.x !== Q.shadowSize) { sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  if (hadShadows !== Q.shadows) scene.traverse(o => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; }); // shaders with / without shadows
}
applyQuality(Q.level);

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
const cine = initCine({ camera, state, players, mobs, slowMotion: (a, b) => slowMotion(a, b), twists, occluders }); // public/cine.js
// Floor 2 — The Glimmering Mire (floor2client.js): world, waystones, Stairway, hazards and its events.
const f2 = initFloor2Client({
  scene, sun, occluders, fx, sfx, state, mobs, players, isTouch,
  send: o => send(o), banner: (a, b) => banner(a, b), callout: (a, b, c) => callout(a, b, c), floatNum: (...a) => floatNum(...a),
  log: (a, b) => log(a, b), shake: a => shake(a), project: (x, y, z) => project(x, y, z), hallOpen: () => !$('hall').classList.contains('hidden'),
});
// Floor 3 — The Gale Spires (floor3client.js): world, the Storm Gate, the Stairway from the Sunken Court, the Colossus's mechanics.
const f3 = initFloor3Client({
  scene, occluders, fx, sfx, state, mobs, players, isTouch, tip: id => guide.tip(id),
  send: o => send(o), banner: (a, b) => banner(a, b), callout: (a, b, c) => callout(a, b, c), floatNum: (...a) => floatNum(...a),
  log: (a, b) => log(a, b), shake: a => shake(a), project: (x, y, z) => project(x, y, z), hallOpen: () => !$('hall').classList.contains('hidden'),
});
// Boss arenas with areas (arenas.js): the fall, the lower area's look and rules (sludge, fire, pillars) for prediction.
const arenas = initArenas({ scene, fx, sfx, state, mobs, players, camera, views: { colossus: f3.world.arena }, tip: id => guide.tip(id),
  banner: (a, b) => banner(a, b), callout: (a, b, c) => callout(a, b, c), shake: a => shake(a) });

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
  .then(() => prewarm()).catch(err => console.warn('shader warm-up', err))
  .finally(() => { $('enter').disabled = false; addMerchant(); smith.addNpc(); if (SPECTATE) join({ type: 'spectate' }); else initLogin(); });
// Shader warm-up while the loading screen shows: compile the shaders of every effect, class and enemy type, for each
// floor's lighting (a floor's lamps and shrines change the light count, and every shader with it). Without this the
// first hit spark, a new enemy type or the first warp stalls a frame while shaders compile. One material of each is
// kept alive, so three.js never throws a shader away between fights (it deletes one when its last material goes).
const keepMats = [];
// And from then on: when the last material using a shader is disposed (an effect fading out, the last enemy of a type
// dying), that one material is kept instead, so the shader stays compiled for next time (a bounded set: one per shader).
const materialDispose = THREE.Material.prototype.dispose;
THREE.Material.prototype.dispose = function () {
  const progs = renderer.properties.get(this).programs;
  if (progs) for (const p of progs.values()) if (p.usedTimes <= 1) { keepMats.push(this); return; }
  return materialDispose.call(this);
};
async function prewarm() {
  const t0 = performance.now(), n0 = fx.list.length, dummy = new THREE.Object3D();
  fx.arc(0, 0, 0, 2, 1); fx.ring(0, 0, 2); fx.line(0, 0, 1, 1, 0xffffff); fx.zone(0, 0, 2, 1); fx.telegraph(0, 0, 2, 1); fx.wedge(0, 0, 0, 2, 1, 1);
  fx.aimLine(0, 0, 1, 1, 1); fx.lane(0, 0, 1, 1, 1, 1); fx.rock(0, 0, 1); fx.beam(0, 0, 0xffffff); fx.thorn(0, 0, 1, 1, 1); fx.heal(dummy);
  fx.shatter(0, 0, false); fx.shield(dummy, 1); fx.sparks(0, 1, 0, 4); fx.rareBeam(0, 0);
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); tex.needsUpdate = true;
  fx.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), 1); // aura motes
  const warm = fx.list.splice(n0);
  const models = [];
  for (const c of CLASS_IDS) try { models.push(makePlayerModel(c)); } catch {}
  for (const t of MOB_IDS) try { models.push(makeMobModel(t)); } catch {}
  for (const m of models) { m.group.position.set(0, -40, 0); scene.add(m.group); }
  const roots = [floor1, f2.world.root, f3.world.root], was = roots.map(r => r.visible);
  f3.world.arena?.warm(true); // the Undercroft, its fire and the falling debris are compiled with Floor 3's lights
  try {
    for (let i = 0; i < roots.length; i++) { // each floor's lights
      roots.forEach((r, j) => { r.visible = i === j; });
      await (renderer.compileAsync ? renderer.compileAsync(scene, camera) : renderer.compile(scene, camera));
    }
  } finally {
    roots.forEach((r, j) => { r.visible = was[j]; });
    f3.world.arena?.warm(false);
    for (const e of warm) { scene.remove(e.mesh); e.mesh.traverse(o => { if (o.material) keepMats.push(o.material); }); }
    for (const m of models) { scene.remove(m.group); m.group.traverse(o => { if (o.material) keepMats.push(o.material); }); }
  }
  console.log(`shaders warmed in ${Math.round(performance.now() - t0)} ms (${renderer.info.programs.length} shaders)`);
}
let merchantNpc = null;
function addMerchant() { // the shopkeeper stands behind the stall's counter, facing the plaza
  const m = makePlayerModel('cleric'), face = Math.atan2(-MERCHANT.x, -MERCHANT.z);
  m.cursor.visible = false; m.anim?.base(m.anim.idle);
  m.group.position.set(MERCHANT.x - Math.sin(face) * 0.3, 0, MERCHANT.z - Math.cos(face) * 0.3);
  m.group.rotation.y = face;
  for (const mt of m.mats || []) mt.color?.multiplyScalar(0.8);
  floor1.add(m.group); // hidden with the rest of the town while you're on Floor 2
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
  let rejoin = null;
  try { rejoin = JSON.parse(sessionStorage.getItem('fb_rejoin') || 'null'); sessionStorage.removeItem('fb_rejoin'); } catch {}
  if (rejoin && Date.now() - rejoin.t > 10 * 60e3) rejoin = null;
  if (!acct.cfg.accounts) {
    $('enter').textContent = 'Enter the Tower'; showPanel('create'); // anonymous mode
    if (rejoin?.msg?.cls) { state.cls = rejoin.msg.cls; join(rejoin.msg); }
    return;
  }
  if (!acct.token) return showAuth();
  await loadMe();
  const c = rejoin?.msg?.session === acct.token && acct.me?.characters?.find(x => x.id === rejoin.msg.character);
  if (c) { state.cls = c.cls; join({ type: 'join', session: acct.token, character: c.id }); } // back in after a server restart
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
  $('new-char').classList.toggle('hidden', characters.length >= (acct.cfg.maxCharacters || 8));
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
  const recv = data => { const t = performance.now(), msg = JSON.parse(data); netStats.parse(performance.now() - t, data.length); onMessage(msg, t); };
  ws.onmessage = netsim ? e => netsim.deliver(e.data, recv) : e => recv(e.data);
  ws.onclose = () => {
    if (state.ws !== ws) return; // replaced or denied
    if (state.joined) reconnect(joinMsg);
    else { state.ws = null; loginMsg('Could not connect to the server.'); }
  };
}
const send = o => state.ws?.readyState === 1 && state.ws.send(JSON.stringify(o));
// Lost the server (usually a deploy restarting it): cover the screen, wait until it answers again, then reload and
// rejoin with the same character (sessionStorage 'fb_rejoin', picked up by initLogin; good for 10 minutes).
function reconnect(joinMsg) {
  try { sessionStorage.setItem('fb_rejoin', JSON.stringify({ msg: joinMsg, t: Date.now() })); } catch {}
  let el = $('reconnect');
  if (!el) {
    el = document.createElement('div'); el.id = 'reconnect';
    el.innerHTML = '<div><b>Connection lost</b><span>The server is restarting (usually an update). Reconnecting…</span><button>Reload now</button></div>';
    el.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(el);
  }
  document.exitPointerLock?.();
  const t0 = Date.now();
  const poll = async () => {
    try { const r = await fetch('/api/config', { cache: 'no-store' }); if (r.ok && Date.now() - t0 > 1500) return location.reload(); } catch {}
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 1500);
}
const guide = new Guide({ el: $('guide'), tipEl: $('tip'), send });
const controlsText = () => isTouch ? 'Left side: move. Right side: drag to look. Buttons: attack, skills, dodge, jump and potion. ☰: the Game Menu.' : `WASD move (S back, A/D strafe) · mouse to look (click to capture, Esc frees it; Settings for classic) · Left click (or J) attack · 1 2 3 skills · K skill tree · Shift dodge · Space jump${state.cls === 'guardian' ? ' · R guard / parry · C cover an ally' : ''} · 4 5 6 items · B bag · F interact · P party · T Team Burst · V bot orders · Ctrl+click select · Esc menu · F3 performance`;
// Leave the game from the Game Menu: back to character select ('char'; anonymous: the name / class screen), signed out
// ('logout'), or out of the spectator view ('spectate'). A clean reload with no automatic rejoin; the server saves
// your character on disconnect, as when a tab closes. Asks first when leaving would cost you something.
async function leaveGame(kind) {
  if (kind !== 'spectate') {
    const me = players.get(state.myId), why = [];
    if (me?.downed && !state.dead) why.push("you're downed: you won't be revived");
    if (boss && (boss.engaged || boss.hp < boss.maxHp) && (inArena(state.x, state.z) || inArena2(state.x, state.z) || inArena3(state.x, state.z))) why.push('a boss fight is on');
    if (state.party) why.push("you'll leave your party");
    if (!state.charId) why.push("this character isn't saved (no account): it's gone once you leave");
    if (why.length && !confirm(`Leave now? ${why.join('; ')}.`)) return;
  }
  const ws = state.ws; state.ws = null; state.joined = false; // (no reconnect: ws.onclose ignores a replaced socket)
  try { sessionStorage.removeItem('fb_rejoin'); } catch {}
  if (kind === 'logout') { try { await api('/api/logout', { method: 'POST' }); } catch {} localStorage.removeItem('fb_session'); }
  ws?.close();
  location.href = location.pathname; // (drops ?spectate and friends)
}
const gmenu = initGameMenu({
  state, isTouch, guide, sfx, controls: () => esc(controlsText()), steps: () => GUIDE_STEPS.map(s => ({ title: esc(s.title), text: esc(s.text()) })),
  openSettings: () => settingsUi.open(),
  lockCursor: () => lockCursor(), leave: k => leaveGame(k), accounts: () => !!(acct.cfg.accounts && acct.token),
  checkAdmin: () => api('/api/admin/me').then(r => r.admin),
});
const wheel = initBotWheel({ send, state, players, log }); // orders for the bots in your party: hold V (public/botwheel.js)
const bubbles = initBubbles({ state, players, project, camera, layer: $('labels'), enabled: () => settings.bubbles !== false && !cine.film }); // speech bubbles over heads (public/bubbles.js); the film view uses subtitles
const ground = initGround({ scene, state, project, $ }); // items lying on the ground (public/ground.js)
const smith = createSmith({ scene: floor1, occluders, fx, sfx, send, state, project, log, guide, isTouch, makePlayerModel, $ }); // town Smith (public/smith.js)
// posture bars, perfect dodge / parry feedback, Guardian guard (R), Horn Sweep telegraph (public/combat.js)
const combat = initCombat({ state, players, mobs, fx, sfx, guide, send, floatNum, slowMotion, shake: a => shake(a), shakeNear: (...a) => shakeNear(...a), bossShot: (...a) => bossShot(...a), lockedMob: () => lockedMob(), nearestMob: r => nearestMob(r), callout: (a, b, c) => callout(a, b, c) });
// threat you can see (target marker, boss-bar name, meter), Guardian Cover (C), flank / Pincer tags (public/threat.js)
const threat = initThreat({ scene, state, players, mobs, fx, sfx, guide, send, floatNum, log: (a, b) => log(a, b), isTouch, $ });
// skill mastery + evolutions: Skills panel (K), Skill Shrines, evolved skill visuals (public/mastery.js)
const mastery = initMastery({
  state, players, mobs, fx, sfx, send, log, floatNum, project, isTouch, scene, floor1, $,
  banner: (a, b) => banner(a, b), shake: a => shake(a), playAnim: (...a) => playSkillAnim(...a),
  rebuildBar: () => { if (state.joined && !state.spectator && mastery.barChanged()) buildSkillBar(); },
});
// Lancer and Bard: rigs, skill visuals, songs, Discord marks, Anthem speed/haste, auto-aim (public/classes-b.js)
const classesB = initClassesB({ state, players, mobs, fx, sfx, mastery, combat, floatNum, shake: a => shake(a) });
// Ranger and Berserker: arrows, traps, marks, Rage bars, Bloodrage auras (public/classes-a.js)
const classesA = initClassesA({ scene, state, players, mobs, fx, sfx, floatNum, shake: a => shake(a), log: (a, b) => log(a, b), $ });
// weapon styles: held weapon models, styled basic attacks and their effects, bag text (public/styles.js)
const styles = initStyles({ state, players, fx, sfx, shake: a => shake(a), floatNum, rebuildBar: () => { if (state.joined && !state.spectator) buildSkillBar(); } });
const looks = initLooks({ players, mobs }); // character looks: the Named's own appearance, on any entity (public/looks.js)
// Players panel tabs + player-owned bots (public/playerbots.js)
const pbots = initPlayerBots({ $, send, state, players, log: (a, b) => log(a, b), sfx, rerender: () => { lobby.html = ''; renderPlayers(); } });
const friends = initNamed({ $, send, state, log: (a, b) => log(a, b), sfx, banner: (a, b) => banner(a, b) }); // public/named.js
// (the Friends tab is added on welcome, only when the server runs the Named: msg.named)
// talent trees + the Skill Tree window (K): progression track, talents, abilities (public/talents.js)
const talents = initTalents({ state, players, fx, sfx, send, floatNum, mastery, guide, isTouch, $ });
const loot = initLoot({ state, send, $, styleTitle: it => styles.title(it), fx, sfx, guide, players, floatNum: (...a) => floatNum(...a) });
// the Tower Bell (toll, sway, banner) and the engraved Hall stones (public/bell.js)
const bell = initBell({ scene, sfx, guide, banner: (a, b, c) => banner(a, b, c) });
// downed + revive: your downed overlay, "Hold E to revive", markers over downed partymates (public/revive.js)
const revive = initRevive({ state, players, send: o => send(o), project: (x, y, z) => project(x, y, z), layer: $('labels'), guide, sfx, fx, floatNum: (...a) => floatNum(...a), isTouch });
// boss team mechanics: the gold STACK circle, SPREAD rings, tether beams, first-time prompts (public/bossteam.js)
const bossTeam = initBossTeam({ state, players, fx, sfx, guide, callout: (a, b, c) => callout(a, b, c), floatNum: (...a) => floatNum(...a) });
// skill combos between players and the Team Burst: chain counters, setup hints, the party bar, T to sync (public/teamplay.js)
const teamplay = initTeamplay({ state, players, mobs, fx, sfx, floatNum, project, send, guide, isTouch, callout: (a, b, c) => callout(a, b, c), shake: a => shake(a), $ });
// the post-fight MVP card: every fighter's numbers and titles after a boss kill or wipe (public/mvp.js)
const mvp = initMvp({ state, guide });

// ---------------- networking ----------------
// Snapshots are drawn ~100 ms in the past, between the two around that moment (shared/netsmooth.js); the delay grows a
// little when they arrive unevenly. netStats: how long JSON parsing takes (the biggest message in the last 10 s).
const clock = new SnapClock();
const corr = new Correction(); // your own drawn position after a server correction (tp)
const netStats = { maxParse: 0, maxBytes: 0, t: 0, parse(ms, bytes) { const n = performance.now(); if (n - this.t > 10000) { this.t = n; this.maxParse = 0; this.maxBytes = 0; } this.maxParse = Math.max(this.maxParse, ms); this.maxBytes = Math.max(this.maxBytes, bytes); } };
const perf = initPerf({ renderer, clock, settings, save: saveSettings, applyQuality, isJoined: () => state.joined && !!state.ws });
perf.send = send;
function onMessage(msg, arrival = performance.now()) {
  if (msg.type === 'pong') { perf.pong(msg); return; }
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
    Object.assign(state, { myId: msg.id, x: msg.x, z: msg.z, seq: msg.seq, joined: true, aiOn: !!msg.ai, charId: msg.charId || 0 }); // ai: AI companions are on (H3); charId 0: anonymous (not saved)
    friends.on = !!msg.named; pbots.setTab(friends, friends.on); // the Friends tab only when the Named are on (NAMED_ENABLED=0: none)
    setTimeout(layoutChips, 50);
    $('login').classList.add('hidden'); $('hud').classList.remove('hidden');
    buildSkillBar();
    guide.start(msg.charId ? `c${msg.charId}` : `anon_${state.cls}`, msg.lvl);
    log('Welcome to Floorbound! Head north through the field and defeat the Horned Warden.', 'sys');
    log(controlsText(), 'sys');
    setTimeout(() => guide.tip('menu'), 30000); // where the Game Menu is
    log('Fill an enemy\'s yellow posture bar (heavy hits, Break skills, perfect dodges, parries) to BREAK it, then a teammate hits it for a SWITCH: big bonus damage.', 'sys');
    return;
  }
  if (msg.type === 'roster') {
    state.roster = new Map(msg.players.map(p => [p.id, p]));
    for (const [id, e] of players) { const r = state.roster.get(id); if (r) e.name = r.name; }
    if (!state.spectator && msg.players.some(p => p.named)) guide.tip('named'); // the Named are around (Friends tab)
    renderPlayers();
    return;
  }
  if (cine.onMessage(msg)) return; // the film picture as it is now (sent on join)
  if (msg.type === 'talents') state.talentAlloc = msg.r || {}; // (loadouts compare it)
  if (talents.onMessage(msg)) return; // talent tree (also keeps a copy of the mastery data)
  if (mastery.onMessage(msg)) return; // skill mastery
  if (pbots.onMessage(msg)) return; // player-owned bots (Players panel → Bots tab)
  if (friends.onMessage(msg)) return; // the Named (Players panel → Friends tab)
  if (msg.type === 'inv') { state.inv = msg; state.gold = msg.gold; renderBag(); smith.render(); return; }
  if (msg.type === 'hall') { state.hallData = msg; renderHall(); bell.hall(msg); return; }
  if (msg.type === 'snap') {
    const busy = msg.w.events.some(e => e.t === 'clear' || e.t === 'lvl');
    for (const e of msg.w.events) { // titles and the Hall of Clearers (kept out of handleEvent)
      if (e.t === 'title' && e.to === state.myId) titleBanner(e.name, busy ? 7000 : 0);
      if (e.t === 'clear' && !$('hall').classList.contains('hidden')) setTimeout(() => send({ type: 'hall' }), 400);
    }
  }
  if (msg.type === 'snap') onSnapshot(msg, arrival);
}

function onSnapshot({ st, me, w }, arrival) {
  const now = performance.now();
  const { stale } = clock.push(st ?? arrival, arrival); // (an old server without st: arrival time)
  const rt = clock.rt; // the moment being drawn now: a change to it fades in (Track.push)
  const sTime = st ?? arrival;
  if (stale) { // arrived after a newer one (only with ?netsim): its events still happen; positions fill the buffer
    for (const e of w.events) handleEvent(e);
    for (const a of w.players) players.get(a[0])?.track.push(sTime, a[1], a[2], a[3], rt);
    for (const a of w.mobs) mobs.get(a[0])?.track.push(sTime, a[2], a[3], a[4], rt);
    return;
  }
  teamplay.snap(w); // Team Burst gauges and sync windows
  if (me) {
    state.xp = me.xp; state.next = me.next;
    if (me.lvl !== state.lvl) { state.lvl = me.lvl; buildSkillBar(me.lvl); mastery.render(); }
    me.cds.forEach((c, i) => { if (now - state.lastPress[i] > 350) state.ready[i] = now + c * 1000; });
    if (now - state.dodgePress > 350) state.dodgeReady = now + (me.dodge || 0) * 1000;
    state.gold = me.gold; state.meReady = me.ready; state.tonic = me.tonic; state.draught = me.draught;
    for (const id of CONSUMABLE_IDS) if (now - (state.ccdPress?.[id] || 0) > 350) state.ccdReady[id] = now + (me.ccd?.[id] || 0) * 1000;
  }
  if (w.gi) ground.set(w.gi);
  if (w.gate) { state.gate = w.gate; state.gateOpen = !!w.gate[0]; gateMesh.set(state.gateOpen); }
  if (w.f2) f2.snap(w.f2); // on Floor 2, state.gate/gateOpen become Floor 2's gate
  if (w.f3) f3.snap(w.f3); // likewise Floor 3's Storm Gate
  if (w.f3) arenas.snap(w.f3.ar); // boss arenas: which area (and its colliders for prediction), the fall, fire
  state.phase = w.phase || 0;
  twists.snap(w);
  threat.snap(w, me); // boss / elite targets, my threat meter, Cover cooldown

  // events first (they may reference mobs that are about to vanish)
  for (const e of w.events) handleEvent(e);

  const seen = new Set();
  for (const a of w.players) {
    const [id, x, z, face, hp, maxHp, lvl, ci, party, dead, buffs] = a;
    seen.add(id);
    let e = players.get(id);
    if (!e) e = addPlayerEntity(id, CLASS_IDS[ci], x, z);
    Object.assign(e, { tx: x, tz: z, tface: face, hp, maxHp, lvl, party, dead: !!dead, buffs });
    if (id !== state.myId) e.track.push(sTime, x, z, face, rt);
    styles.snap(e, a[11], id === state.myId); // weapon style
    if (id === state.myId) {
      const wasDead = state.dead;
      Object.assign(state, { hp, maxHp, party, dead: !!dead });
      if (wasDead !== state.dead) $('dead').classList.toggle('hidden', !state.dead);
    }
  }
  for (const [id, e] of players) if (!seen.has(id)) { removeEntity(e); players.delete(id); }
  revive.snap(w.down); // downed players (public/revive.js)
  if (snapPoses(w.poses, players).has(state.myId)) guide.tip('poses'); // held poses (public/poses.js)

  const seenM = new Set();
  for (const a of w.mobs) {
    const [id, ti, x, z, face, hp, maxHp, flags, posture] = a;
    seenM.add(id);
    let e = mobs.get(id);
    if (!e) e = addMobEntity(id, MOB_IDS[ti], x, z, face);
    e.track.push(sTime, x, z, face, rt);
    Object.assign(e, { tx: x, tz: z, tface: face, hp, maxHp, moving: flags & 1, engaged: flags & 2, enraged: flags & 4, stunned: flags & 8, winding: flags & 16, staggered: flags & 32, frenzy: flags & 64, launched: flags & 128, posture: posture || 0 });
  }
  for (const [id, e] of mobs) if (!seenM.has(id) && !e.dying) { removeEntity(e); mobs.delete(id); if (e === boss) boss = null; }
  looks.snap(w.looks); // who wears a look (after the entities and their weapon styles are in step)
  renderPlayersThrottled();
}

function handleEvent(e) {
  const me = state.myId;
  if (e.t === 'cine' && (e.op === 'reset' || (e.op === 'fade' && e.to === 'black'))) sfx.hush(); // no voice-over under black or after a stop
  if (cine.event(e)) return; // shots, titles, fades, letterbox, clean feed, light
  if (arenas.event(e)) return; // the fall to a boss's lower area (arenas.js)
  if (f3.onEvent(e)) return; // Floor 3 (floor3client.js)
  f2.onEvent(e);
  if (bell.event(e)) return; // the Tower Bell
  if (bossTeam.event(e)) return; // boss team mechanics (stack / spread / tether)
  if (teamplay.event(e)) return; // combos, Team Burst
  if (mvp.event(e)) return; // the post-fight MVP card
  if (combat.event(e)) return; // perfect dodge, parry, guard, Horn Sweep
  if (threat.event(e)) return; // Cover, flank / Pincer tags
  if (talents.event(e)) return; // talent points, learned talents, talent procs
  if (loot.event(e)) return; // loadout swaps (H2)
  if (mastery.event(e)) return; // evolved skills, mastery level-ups, evolutions
  if (classesA.event(e)) return; // Ranger / Berserker
  if (styles.event(e)) return; // weapon styles: styled basic attacks
  if (revive.event(e)) return; // downed / revive
  switch (e.t) {
    case 'tp':
      if (e.id === me) { // the server moved you: the game position jumps, the drawn one slides there (or snaps if far)
        const g = players.get(me)?.model.group.position;
        corr.apply(g ? g.x : state.x, g ? g.z : state.z, e.x, e.z);
        state.x = e.x; state.z = e.z; state.seq = e.s;
      }
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
      else if (e.k === 'boom') { fx.ring(e.x, e.z, e.r, 0xff7a2f, 0.5); shakeNear(e.x, e.z, 0.35, e.r + 14); } // a stomp near you
      else if (e.k === 'rock') { fx.rock(e.x, e.z, e.r); setTimeout(() => { fx.ring(e.x, e.z, e.r, 0x9ca3af, 0.5); shakeNear(e.x, e.z, 0.2, e.r + 8); sfx.play('boom', { x: e.x, z: e.z }, 0.7); }, 200); }
      else if (e.k === 'charge') {
        fx.line(e.x, e.z, e.x2, e.z2, 0xff7a2f, 4, 0.5, 0.5); sfx.play('boom', { x: e.x2, z: e.z2 }, 1.3);
        const lx = e.x2 - e.x, lz = e.z2 - e.z, k = Math.max(0, Math.min(1, ((state.x - e.x) * lx + (state.z - e.z) * lz) / (lx * lx + lz * lz || 1)));
        shakeNear(e.x + lx * k, e.z + lz * k, 0.45, 18); // by how close the charge passed you
      }
      else if (e.k === 'summon') { fx.ring(e.x, e.z, 3, 0xff3b1f, 0.7); sfx.play('howl', { x: e.x, z: e.z }, 0.8); }
      break;
    }
    case 'jump': {
      const p = players.get(e.id);
      if (p && e.id !== me) { p.jumpT = 0; p.model.anim?.shot('Jump_Full_Short', 1.75); }
      break;
    }
    case 'proj': projFx.set(e.id, fx.thorn(e.x, e.z, e.vx, e.vz, e.ttl)); sfx.play('spit', { x: e.x, z: e.z }); break;
    case 'rare': { // a rare named enemy appeared somewhere on the floor (to: a late joiner's personal copy)
      if (e.to && e.to !== me) break;
      fx.rareBeam(e.x, e.z, 7);
      sfx.play('rare', null, 0.9);
      const [dist, dir] = rareBearing(e.x, e.z);
      banner(`RARE · ${e.name.toUpperCase()}`, floorOf(e.x) !== floorOf(state.x) ? `Sighted on Floor ${floorOf(e.x)}` : `${e.late ? 'Roaming' : 'Sighted'} ${dist} m ${dir}`);
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
    case 'evade': { const p = players.get(e.id); if (p && (e.to ?? e.id) === me) { floatNum(p.model.group.position, 2.4, e.k === 'jump' ? 'Jumped!' : 'Dodged!', 'evade'); sfx.play('evade', p.model.group.position); } break; } // your reaction: only you see it
    case 'stagger': {
      const m = mobs.get(e.id);
      if (!m) break;
      m.staggerT = e.d; m.staggerBy = e.by; m.model.anim?.cancelWindup?.(); // Broken: the wind-up is cancelled
      if (Math.hypot(m.x - state.x, m.z - state.z) < 25) guide.tip('broken');
      fx.ring(m.x, m.z, m.def.radius + 2.5, 0xfacc15, 0.5);
      sfx.play('break', m.model.group.position);
      m.model.anim?.shot('Hit_B', 0.9);
      const who = players.get(e.by)?.name || 'Someone';
      // shown above the enemy only (no full-screen announcement)
      floatNum(m.model.group.position, m.model.height + 0.6, e.by === me ? (e.i ? 'INTERRUPT!' : 'BREAK!') : `BROKEN · ${who}`, 'switch');
      break;
    }
    case 'switch': {
      if (e.by === me || e.from === me) guide.did('switch');
      const m = mobs.get(e.id);
      if (m) {
        const ours = e.by === me || e.from === me; // the Switch is a reaction: its text is for the two who made it
        if (ours) floatNum(m.model.group.position, m.model.height * 0.85, `SWITCH! ${e.a}`, 'switch');
        fx.ring(m.x, m.z, m.def.radius + 4, 0xfde047, 0.6); fx.ring(m.x, m.z, m.def.radius + 1.5, 0xffffff, 0.4);
        if (ours) shake(0.3);
        sfx.play('switch', m.model.group.position, ours ? 1 : 0.6);
      }
      break;
    }
    case 'wind': {
      const m = mobs.get(e.id);
      if (m) {
        m.wind = e.d;
        if (m.def?.boss && m.model.anim?.windup) m.model.anim.windup(m.type === 'sovereign' ? 'trident' : 'cleave', e.d); else m.model.anim?.shot('2H_Melee_Attack_Chop', m.def?.boss ? 1.4 / PACE : 1.4); // bosses: a readable wind-up pose (world.js WINDUPS)
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
        (mobs.get(e.id) || boss)?.model.anim?.windup?.('charge', e.d); // crouch, horns lowered
        guide.tip('lane');
        break;
      }
      fx.telegraph(e.x, e.z, e.r, e.d, e.follow ? () => mobs.get(e.follow)?.model.group.position : null);
      if (e.k === 'rock') { if (mine) { sfx.play('warn', { x: e.x, z: e.z }, 0.6); guide.tip('rock'); } break; }
      sfx.play('warn', { x: e.x, z: e.z });
      if (mine) guide.tip('slam');
      const tb = boss && !!boss.def.f2 === onFloor2(e.x) ? boss : [...mobs.values()].find(m => m.def?.boss && !!m.def.f2 === onFloor2(e.x) && !m.dying); // the boss on the telegraph's floor
      if (tb && e.k !== 'lurk' && e.k !== 'pool') {
        if (tb.def.f2 && e.k === 'geyser') tb.model.anim?.windup?.('geyser', e.d); // trident raised high, then driven down (world.js WINDUPS)
        else if (tb.def.f2) bossShot(tb.id, e.follow ? '2H_Melee_Attack_Spin' : '2H_Melee_Attack_Slice', 1.2 / PACE, Math.max(0, e.d - 0.55 * PACE));
        else tb.model.anim?.windup?.(e.follow ? 'spin' : 'slam', e.d); // the Warden rears up (slam) or winds round (spin)
      }
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
        sfx.play(e.h ? 'hitHeavy' : e.c ? 'crit' : 'hit', m.model.group.position, e.by === me ? 1 : 0.55);
        if (e.by === me) {
          guide.did('hit');
          state.lastCombat = performance.now();
          if (e.h) shake(0.18); // (no hit-stop on player hits: that's for a boss's big hit landing on you)
          // knockback lands a little quicker than normal interpolation
          if (e.h && m.type !== 'warden') m.punch = 0.25;
        }
        // your numbers full size; everyone else's small, dim and capped
        floatNum(m.model.group.position, m.model.height * 0.7, e.c ? `${e.a}!` : `${e.a}`, e.by === me ? (e.c ? 'crit' : '') : e.c ? 'other crit' : 'other');
      }
      break;
    }
    case 'hurt': {
      const p = players.get(e.id);
      if (p) { p.flash = 0.15; const a = p.model.anim; if (a && !a.busy() && !a.dead) a.shot('Hit_A', 1.8);
        if (e.id === me) { state.lastCombat = performance.now(); sfx.play('hurt'); }
        if (e.id === me) {
          floatNum(p.model.group.position, 2.2, `-${e.a}`, 'hurt');
          if (e.big) { hitStop = Math.max(hitStop, BIG_HIT_STOP); shake(0.3); } else shake(0.15);
        } else if (state.spectator) floatNum(p.model.group.position, 2.2, `-${e.a}`, 'other hurt');
      }
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
        const camp = WAYSTONES.find(w => w.floor === (e.f || floorOf(state.x)))?.name || 'town'; // Town of Beginnings / Mirelight Camp
        $('dead').innerHTML = `<div>You were defeated</div><small>${e.src && e.src !== '?' ? `by ${esc(e.src)} · ` : ''}${e.stay ? 'waiting to be revived' : `respawning at ${esc(camp)}…`}</small>`;
        $('dead').classList.remove('hidden');
      }
      break;
    }
    case 'phase':
      if (e.n === 1) { if (boss) { bossShot(boss.id, 'Cheer', 1.2); sfx.play('howl', boss.model.group.position, 1.3); } banner('THE HOUNDS ARE LOOSE', 'Phase 2: hounds, horn charges, Quake Rings in pairs. Get out of the red lanes'); }
      break;
    case 'enrage': if (boss) { bossShot(boss.id, 'Cheer', 1.2); sfx.play('roar', boss.model.group.position, 1.4); } banner('THE WARDEN IS ENRAGED', 'Phase 3: spins, falling rocks, triple Quake Rings. Keep moving'); break;
    case 'twist': twists.announce(e); updateGateBox(true); break;
    case 'twist2': twists.announce(e, true, onFloor2(state.x) && !state.spectator); updateGateBox(true); break; // the Sovereign's (Floor 2 only)
    case 'la': {
      fx.beam(e.x, e.z, 0xfbbf24, 4.5); sfx.play('loot', { x: e.x, z: e.z }, 1.3);
      setTimeout(() => banner('LAST ATTACK BONUS', `${e.name} · Horn of the Warden`), 3400);
      break;
    }
    case 'clear': sfx.play('clear'); banner('FLOOR 1 CLEARED', e.names.join(' · ')); if (inArena(state.x, state.z)) guide.did('boss'); break;
    case 'clear2': if (inArena2(state.x, state.z)) guide.did('boss'); break; // banner/sound in floor2client.js
    case 'clear3': if (inArena3(state.x, state.z)) guide.did('boss'); break; // banner/sound in floor3client.js
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
        loot.onLoot(e); // set pieces: a beam in the set's colour, set / affix tips
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
    case 'gdrop': if (e.id === me) sfx.play('ui'); break;
    case 'gpick': if (e.id === me) sfx.play('coin', null, 0.6); break;
    case 'equip': if (e.id === me) sfx.play('shield', null, 0.5); break;
    case 'pjoin': if (e.id === me) { guide.did('party'); sfx.play('ui'); } if (e.party && e.party === state.party && state.roster.get(e.id)?.bot) { guide.tip('bots'); if (state.aiOn) setTimeout(() => guide.tip('botmind'), 7000); } break;
    case 'gate':
      if (e.s === 'count' && inGateZone(state.x, state.z)) { for (let i = 0; i < e.d; i++) setTimeout(() => sfx.play('tick'), i * 1000); }
      if (e.s === 'open') { sfx.play('gate', { x: 0, z: 161 }, 1.5); if (Math.abs(state.x) < 30 && state.z > 120) banner('THE RAID GATE OPENS', 'The Horned Warden awaits'); }
      break;
    case 'invite': if (e.to === me) showInvite(e.from, e.name); break;
    case 'mind': if (bubbles.mind(e) && !state.spectator && !e.ch) guide.tip('botmind'); break; // an AI companion is thinking about a line said to it (H3)
    case 'chat': // ch 'p': party chat (only your party sees it), 's': say (heard within 40 m)
      if (bubbles.chat(e) && e.id !== me && !state.spectator) guide.tip('bubbles'); // a bubble over the speaker's head (same rules as the log)
      cine.say(e); // film view: a scripted line as a subtitle
      if (state.spectator && e.voice) sfx.voice(e.voice); // and its voice-over (spectators only, never players)
      if (e.ch === 'p') { if (state.party && e.party === state.party) log(`[Party] ${e.from}: ${e.text}`, e.id === me ? 'me party' : 'party'); break; }
      if (e.ch === 's') { if (state.spectator || Math.hypot(e.x - state.x, e.z - state.z) < 40) log(`${e.from} says: ${e.text}`, e.id === me ? 'me' : 'say'); break; }
      log(`${e.from}: ${e.text}`, e.id === me ? 'me' : ''); break;
    case 'sys': if (!e.to || e.to === me) log(e.text, 'sys'); break;
    case 'emote': { const p = players.get(e.id), x = EMOTES[e.a]; if (p?.model.anim && x && !p.model.anim.dead) p.model.anim.shot(x[0], x[1], { clamp: !!x[2] }); break; } // scene director (server/director.js)
  }
}
const EMOTES = { cheer: ['Cheer', 1.2], block: ['Block', 1, true], cast: ['Spellcast_Long', 1.2], hit: ['Hit_A', 1.2], die: ['Death_A', 1, true] };

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
  const basic = skill === CLASSES[ent.cls]?.skills[0].id; // basic attacks keep their rhythm: only skills run PACE x slower
  ent.model.anim.shot(name, basic ? speed : speed / PACE);
}
const bossShot = (id, name, speed, delay = 0) => setTimeout(() => mobs.get(id)?.model.anim?.shot(name, speed), delay * 1000);

// ---------------- entities ----------------
function makeLabel(cls) {
  const el = document.createElement('div');
  el.className = `lbl ${cls}`;
  el.innerHTML = `<div class="nm"></div><div class="bar"><div></div></div>`;
  el.style.left = '0'; el.style.top = '0';
  $('labels').appendChild(el);
  return { el, nm: el.firstChild, fill: el.lastChild.firstChild, text: '', pct: -1, shown: true, tr: '', side: '' };
}
// Show / hide a nameplate, touching the DOM only when it changes.
function setShown(L, on) { if (L.shown !== on) { L.shown = on; L.el.style.display = on ? '' : 'none'; } }

function addPlayerEntity(id, cls, x, z) {
  const model = makePlayerModel(cls);
  model.group.position.set(x, 0, z);
  let mats = model.mats;
  if (!mats) {
    mats = [];
    model.group.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.material = o.material.clone(); mats.push(o.material); } });
  }
  scene.add(model.group);
  const e = { id, kind: 'player', cls, model, mats, label: id === state.myId ? null : makeLabel('ally'), name: state.roster.get(id)?.name || '…', x, z, face: 0, tx: x, tz: z, tface: 0, walk: 0, swing: 0, flash: 0, track: new Track(), animAcc: 0 };
  players.set(id, e);
  return e;
}

function addMobEntity(id, type, x, z, face) {
  const model = makeMobModel(type);
  model.group.position.set(x, 0, z);
  model.group.rotation.y = face;
  scene.add(model.group);
  const e = { id, kind: 'mob', type, def: MOBS[type], model, mats: model.mats, label: MOBS[type]?.boss ? null : makeLabel('mob'), x, z, face, tx: x, tz: z, tface: face, walk: 0, wind: 0, flash: 0, track: new Track(), animAcc: 0 };
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
// Keys and mouse buttons arrive as actions (public/input.js, bindings in shared/controls.js, by key code).
// The gate: nothing but the overlay before you join; under the Game Menu only Esc (no moving, attacking or hotkeys;
// the game itself keeps running).
const input = createInput({ isTouch, settings, save: saveSettings, notify: t => log(t, 'sys'),
  gate: a => a === 'perfOverlay' || (state.joined && (a === 'menu' || !gmenu.isOpen())) });
// The old key set, now a view of the input layer (revive.js reads keys.has('e'): the revive action).
const LEGACY_KEYS = { e: 'revive', q: 'turnLeft', j: 'attack', r: 'guard', v: 'botWheel' };
const keys = { has: k => (LEGACY_KEYS[k] ? input.held(LEGACY_KEYS[k]) : input.key(k.length === 1 ? `Key${k.toUpperCase()}` : k)), clear: () => input.reset() };
const panels = createPanels(); // Esc closes the first group; all of them free the cursor while open
for (const id of ['players', 'bag', 'hall', 'warp', 'smith', 'settings', 'skillsp']) panels.register(id, { esc: true });
for (const id of ['talentsp', 'botwheel', 'botmenu', 'gamemenu']) panels.register(id); // (they close themselves on Esc)
const stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
let attackHeld = false;

const onPress = (action, fn) => input.on(action, e => { if (e.down) fn(e); });
onPress('perfOverlay', () => { perf.toggle(); settingsUi.refresh(); }); // the diagnostics overlay
onPress('menu', () => { // Esc: close what's open, else clear the target, else the Game Menu
  if (gmenu.isOpen()) { if (!gmenu.justOpened()) gmenu.close(); return; }
  if (escBusy) { panels.close(); if (wheel.isOpen()) wheel.close(); return; }
  if (state.lock || state.focus) { state.lock = 0; state.focus = 0; return; }
  menuOpen();
});
onPress('chat', () => { freeCursor(); $('chat-input').focus(); });
$('chat-input').addEventListener('keydown', e => { // (typing: the input layer leaves these keys alone)
  const chat = e.target;
  if (e.key === 'Enter') { sendChat(chat.value); chat.value = ''; chat.blur(); }
  if (e.key === 'Escape') chat.blur();
});
input.on('attack', e => { attackHeld = e.down; });
onPress('jump', e => { if (!e.repeat) jump(); });
onPress('skill1', () => useSkill(1));
onPress('skill2', () => useSkill(2));
onPress('skill3', () => useSkill(3));
onPress('dodge', () => dodge());
onPress('skillTree', e => { if (!e.repeat) talents.toggle(); }); // Skill Tree window (public/talents.js)
input.on('guard', e => { if (!e.down) combat.guard(false); else if (!e.repeat) combat.guard(true); });
onPress('lockNext', () => cycleLock());
input.on('botWheel', e => { if (!e.down) wheel.keyup(); else if (!e.repeat) wheel.keydown(e.event); }); // bot command wheel
onPress('teamBurst', e => { if (!e.repeat) teamplay.press(); }); // Team Burst: start it (full bar) or join the sync window
onPress('players', () => $('players-btn').click());
onPress('bag', () => toggleBag());
onPress('interact', () => interact());
onPress('cover', e => { if (!e.repeat) threat.cover(); }); // Guardian Cover
['item1', 'item2', 'item3'].forEach((a, i) => onPress(a, () => useItem(CONSUMABLE_IDS[i])));
onPress('selectAimed', e => { if (locked()) selectAim(); else selectAt(e.event?.clientX ?? mouse.x, e.event?.clientY ?? mouse.y); }); // Ctrl+click: select (mouse look: what the crosshair is aimed at)
onPress('clearTarget', () => clearSelection()); // Ctrl+right-click: deselect
// Was something open when Esc went down? (Capture phase: before the panels' own Esc handlers close them.)
let escBusy = false;
addEventListener('keydown', e => { if (e.key === 'Escape') escBusy = e.cancelBubble || cursorPanelOpen() || wheel.isOpen() || talents.isOpen() || !!document.getElementById('mvp'); }, true);
function menuOpen() { keys.clear(); attackHeld = false; combat.guard(false); stick.active = false; stick.dx = stick.dy = 0; gmenu.open(); }
addEventListener('blur', () => { keys.clear(); attackHeld = false; combat.guard(false); });

// camera drag (mouse + touch on the right/anywhere outside the stick)
// (settings: loaded at the top, before the renderer)
const mouseLook = () => settings.camera === 'mouse' && !isTouch;
const locked = () => document.pointerLockElement === canvas;
function lockCursor() { if (mouseLook() && !locked() && state.joined && !state.spectator && input.device !== 'pad') try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {} }
let freeing = false; // we let the cursor go ourselves (a panel, chat): not the player's Esc
function freeCursor() { if (locked()) { freeing = true; document.exitPointerLock(); } }
document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('mlock', locked());
  if (locked()) return;
  const ours = freeing; freeing = false;
  // In mouse look the browser spends the first Esc on leaving pointer lock (the page may never see that keydown):
  // treat it as Esc. (Not when a panel freed it, the window lost focus, or the connection dropped.)
  if (!ours && state.joined && !cursorPanelOpen() && !gmenu.isOpen() && document.hasFocus() && !$('reconnect')) menuOpen();
});
addEventListener('mousemove', e => {
  if (!locked()) return;
  const s = 0.0024 * settings.sens;
  state.yaw -= e.movementX * s;
  state.pitch = Math.min(1.25, Math.max(0.12, state.pitch + e.movementY * s * (settings.invertY ? -1 : 1)));
});
// Panels need the cursor: free it whenever one is open.
const cursorPanelOpen = () => panels.isOpen();
// Top-right chips: lay them out right-to-left by their real widths, so a long gold count never overlaps a neighbour.
function layoutChips() {
  let right = 10;
  for (const id of ['menu-btn', 'players-btn', 'chat-btn', 'sound-btn', 'bag-btn', 'skills-btn', 'settings-btn']) {
    const el = $(id); if (!el || getComputedStyle(el).display === 'none') continue;
    el.style.right = `${right}px`; right += el.offsetWidth + 8;
  }
}
addEventListener('resize', layoutChips);
setTimeout(layoutChips, 0); setTimeout(layoutChips, 1500);

const settingsUi = initSettingsPanel({ el: $('settings'), settings, save: saveSettings, Q, PRESETS, perf, applyQuality, freeCursor, bubbles, sfx }); // public/settings.js
$('menu-btn').onclick = () => menuOpen(); // phones: the Game Menu
$('settings-btn').onclick = () => settingsUi.toggle();

const drag = { id: null, x: 0, y: 0 };
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') {
    if (input.device === 'pad') return; // under Controller the mouse is for menus: clicks on the game don't attack
    const hit = input.peek(e); // what this click is bound to
    if (hit?.binding.includes('+')) { input.mouseDown(e); return; } // chords first: Ctrl+click select, Ctrl+right-click clear
    if (e.button === 0 && mouseLook() && !locked()) { lockCursor(); return; } // the first click captures the cursor
    if (hit) { input.mouseDown(e); return; } // attack (released by the input layer on pointerup)
    if (locked()) return; // no right-drag needed while the camera follows the mouse
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
const endDrag = e => { if (e.pointerId === drag.id) drag.id = null; };
// screen-edge turning: park the cursor at the left/right edge to turn the camera that way
const EDGE_DELAY = 0.1; // seconds the cursor must rest at a screen edge before the camera turns
const mouse = { x: 0, y: 0, inside: false, onCanvas: false, edgeSide: 0, edgeSince: 0 };
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; mouse.onCanvas = e.target === canvas || e.target.closest?.('#labels'); });
document.documentElement.addEventListener('mouseleave', () => { mouse.inside = false; });
addEventListener('blur', () => { mouse.inside = false; });
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
  mastery.barChanged(); // remember the names/pips this bar was built with
  const order = isTouch ? [1, 0, 2, 3] : [0, 1, 2, 3];
  $('skills').innerHTML = order.map(i => {
    const s = skills[i];
    const locked = lvl < s.lvl, nm = mastery.name(i); // evolved name once a branch is active (public/mastery.js)
    return `<button class="sk s${i} ${i === 0 ? 'basic' : ''} ${locked ? 'locked' : ''} ${mastery.evoId(i) ? 'evolved' : ''}" data-slot="${i}" title="${esc(nm)}: ${esc(mastery.desc(i))}${i === 0 ? esc(styles.barNote()) : ''}${locked ? ` (unlocks at Lv ${s.lvl})` : ''}">
      <span class="key">${i === 0 ? (isTouch ? '' : 'CLICK') : i}</span>${mastery.pip(i)}${esc(nm)}${locked ? `<br><small>Lv ${s.lvl}</small>` : ''}<span class="cd"></span><span class="cdt"></span></button>`;
  }).join('') + `<button class="sk sd" data-slot="dodge" title="Dodge roll: dash and avoid damage"><span class="key">${isTouch ? '' : 'SHIFT'}</span>Dodge<span class="cd"></span><span class="cdt"></span></button>`
    + `<button class="sk sj" data-slot="jump" title="Jump: hop over the boss's ground slams"><span class="key">${isTouch ? '' : 'SPACE'}</span>Jump<span class="cd"></span><span class="cdt"></span></button>`
    + combat.guardButton(state.cls, isTouch)
    + threat.coverButton(state.cls, isTouch)
    + CONSUMABLE_IDS.map(id => `<button class="sk it2 ${id}" data-item="${id}" title="${CONSUMABLES[id].name}: ${CONSUMABLES[id].desc}"><span class="key">${isTouch ? '' : CONSUMABLES[id].key}</span>${CONSUMABLES[id].name.split(' ').pop()}<span class="cnt"></span><span class="cd"></span></button>`).join('')
    + `<button class="sk act" data-slot="act">Ready</button>`;
  for (const b of $('skills').children) {
    if (b.dataset.item || b.dataset.slot === 'act') {
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); if (b.dataset.item) useItem(b.dataset.item); else interact(); });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      continue;
    }
    if (b.dataset.slot === 'guard') { combat.bindGuardButton(b); continue; }
    if (b.dataset.slot === 'cover') { threat.bindCover(b); continue; }
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
// Dying enemies and burrowed Bog Lurkers (hidden: the server doesn't let anything hit them) can't be targeted.
const canTarget = m => !!m && !m.dying && !m.hidden;
const lockRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
lockRing.rotation.x = -Math.PI / 2; lockRing.visible = false; scene.add(lockRing);
// A bobbing arrow over the selected character's head (gold = enemy, green = ally).
const selArrow = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 4), new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false, transparent: true }));
selArrow.rotation.x = Math.PI; selArrow.renderOrder = 10; selArrow.visible = false; scene.add(selArrow);
let hovered = null; // what the mouse-look crosshair is over
function cycleLock() {
  const fy = state.yaw, fx0 = Math.sin(fy), fz0 = Math.cos(fy);
  const list = [...mobs.values()]
    .filter(m => canTarget(m) && Math.hypot(m.x - state.x, m.z - state.z) < 25)
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
  announceTarget();
}

// Ctrl/Cmd + click a character (enemy or ally) to select it and lock the camera on it;
// Ctrl/Cmd + click empty ground to clear the selection.
function selectAt(sx, sy) {
  const best = pickAt(sx, sy);
  if (!best) return; // clicking nothing keeps your selection (Ctrl+right-click clears it)
  state.lock = best?.kind === 'mob' ? best.ent.id : 0;
  state.focus = best?.kind === 'player' ? best.ent.id : 0;
  sfx.play('ui');
  announceTarget();
}
// Mouse look: the crosshair sits a little above centre (CROSS_Y), and you don't have to aim it exactly.
// 1) whatever is under the crosshair; else 2) whoever is closest to the direction the camera faces (within ~18°,
// up to 45 m), so far-away targets can be picked without tilting the camera up at them.
const CROSS_Y = 0.42;
function pickAim() {
  const direct = pickAt(innerWidth / 2, innerHeight * CROSS_Y);
  if (direct) return direct;
  let best = null, bs = Infinity;
  const consider = (ent, kind) => {
    const dx = ent.x - state.x, dz = ent.z - state.z, d = Math.hypot(dx, dz);
    if (d < 1 || d > 45) return;
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - state.yaw), Math.cos(Math.atan2(dx, dz) - state.yaw)));
    const cone = 0.32 + Math.min(0.25, 2 / d); // a wider cone for things close by
    if (ang > cone) return;
    const score = ang * 40 + d * 0.35 + (kind === 'player' ? 4 : 0); // enemies win ties
    if (score < bs) { bs = score; best = { ent, kind }; }
  };
  for (const m of mobs.values()) if (canTarget(m)) consider(m, 'mob');
  for (const p of players.values()) if (p.id !== state.myId && !p.dead) consider(p, 'player');
  return best;
}
function clearSelection() {
  if (!state.lock && !state.focus) return;
  state.lock = 0; state.focus = 0;
  sfx.play('ui');
  announceTarget();
}
function selectAim() {
  const best = pickAim();
  if (!best) return;
  state.lock = best?.kind === 'mob' ? best.ent.id : 0;
  state.focus = best?.kind === 'player' ? best.ent.id : 0;
  sfx.play('ui');
  announceTarget();
}
// What's on screen at (sx, sy)? Used by Ctrl+click and by the mouse-look crosshair preview.
function pickAt(sx, sy) {
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
  for (const m of mobs.values()) if (canTarget(m)) consider(m, 'mob');
  for (const p of players.values()) if (p.id !== state.myId && !p.dead) consider(p, 'player');
  return best;
}
// A short line under the boss bar saying what you just selected.
let selMsgT = 0;
function announceTarget() {
  const m = state.lock && mobs.get(state.lock), p = state.focus && players.get(state.focus);
  const el = $('selmsg');
  el.className = m ? 'foe' : p ? 'ally' : '';
  el.innerHTML = m ? `Target: <b>${esc(m.def.name)}</b> <small>Lv ${m.def.level ?? ''}</small>` : p ? `Following: <b>${esc(p.name)}</b> <small>Lv ${p.lvl ?? ''}</small>` : 'Target cleared';
  el.classList.add('show');
  clearTimeout(selMsgT); selMsgT = setTimeout(() => el.classList.remove('show'), 1800);
}
function focusedAlly() {
  const p = state.focus && players.get(state.focus);
  if (!p || Math.hypot(p.x - state.x, p.z - state.z) > 60) { state.focus = 0; return null; }
  return p;
}
function lockedMob() {
  const m = state.lock && mobs.get(state.lock);
  if (!canTarget(m) || Math.hypot(m.x - state.x, m.z - state.z) > 45) { state.lock = 0; return null; }
  return m;
}

function jump() {
  const now = performance.now();
  if (state.dead || revive.isDown() || !state.joined || state.spectator || state.roll || now < state.jumpReady || arenas.frozen()) return;
  state.jumpReady = now + JUMP.cd * 1000; state.jumpPress = now;
  state.air = { x: state.vel?.[0] || 0, z: state.vel?.[1] || 0 }; // take off with your running speed
  const me = players.get(state.myId);
  if (me) { me.jumpT = 0; me.model.anim?.shot('Jump_Full_Short', 1.75); }
  sfx.play('roll', null, 0.4);
  send({ type: 'jump' });
}

function dodge() {
  const now = performance.now();
  if (state.dead || revive.isDown() || !state.joined || state.spectator || state.roll || now < state.dodgeReady || arenas.frozen()) return;
  if (arenas.noDodge()) return; // no rolling in sludge
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
  const key = `${name}|${sub}|${pct}|${isMob}|${isMob ? `${t.posture}${t.staggered}` : ''}`;
  if (key === tfKey) return;
  tfKey = key;
  el.className = `frame ${isMob ? 'foe' : 'friend'}`;
  el.innerHTML = `<div class="row"><span>${esc(name)}</span><span class="sub">${sub}</span></div><div class="bar hp"><div style="width:${pct}%"></div><span>${t.hp} / ${t.maxHp}</span></div>${isMob ? combat.frameBar(t) : ''}`;
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
    if (!canTarget(m)) continue;
    const d = Math.hypot(m.x - state.x, m.z - state.z) - m.def.radius;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

function useSkill(slot) {
  if (state.dead || revive.isDown() || !state.joined || arenas.frozen()) return;
  const sk = CLASSES[state.cls].skills[slot];
  const now = performance.now();
  if (!sk || state.lvl < sk.lvl || now < state.ready[slot] || combat.guarding) return;
  const auto = ['slash', 'bash', 'rush', 'smite', 'burst'].includes(sk.id) || ['challenge', 'seismic'].includes(mastery.evoId(slot)); // aimed evolutions too
  const styAim = slot === 0 && styles.aim(); // a weapon style's own reach (Twin Daggers, Flute, ...)
  const aimA = slot === 0 && styles.ownsBasic() ? 0 : classesA.aimRange(sk.id, mastery.evoId(slot)); // Ranger / Berserker aimed skills
  if (auto || aimA || styAim) {
    const lm = lockedMob();
    const t = lm && Math.hypot(lm.x - state.x, lm.z - state.z) < Math.max(14, aimA + 4) ? lm : aimA ? classesA.pick(aimA, canTarget, nearestMob) : nearestMob((slot === 0 && styles.aim()) || (sk.id === 'smite' ? 11 : sk.id === 'rush' ? 9 : 6)); // (Ranger/Berserker aim; weapon styles: reach)
    if (t) state.face = angleTo(state.x, state.z, t.x, t.z);
    else if (aimA > 12) state.face = state.yaw; // nothing to aim at: shoot where the camera looks
  }
  classesB.aim(sk.id, lockedMob, nearestMob); // Lancer / Bard skills
  state.ready[slot] = now + ((slot === 0 && styles.basicCd(mastery.cd(0))) || mastery.cd(slot)) * 1000; // mastery and branch cooldowns, weapon styles (the server corrects it)
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
  if (mastery.near()) return 'shrine'; // Skill Shrine (public/mastery.js)
  if (ground.near()) return 'pickup';
  if (!state.gateOpen && (inGateZone(state.x, state.z) || inGateZone2(state.x, state.z) || inGateZone3(state.x, state.z))) return 'gate';
  return f3.interactKind() || f2.interactKind(); // waystones and the Stairways

}
function interact() {
  const k = interactKind();
  if (k === 'shop') { state.shopOpen = true; $('bag').classList.remove('hidden'); renderBag(); sfx.play('ui'); }
  else if (k === 'hall') { toggleHall(); sfx.play('ui'); }
  else if (k === 'smith') { smith.toggle(); sfx.play('ui'); }
  else if (k === 'shrine') talents.toggle();
  else if (k === 'pickup') { send({ type: 'pickup', id: ground.near() }); }
  else if (k === 'gate') { send({ type: 'ready' }); sfx.play('ui'); state.meReady = state.meReady ? 0 : 1; updateGateBox(true); }
  else if (!f3.interact(k)) f2.interact(k);
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
  const d2 = d.floors?.[2]; // Floor 2 — The Glimmering Mire
  if (d2) {
    h += '<h4>Server first clear · Floor 2</h4>';
    h += d2.first ? `<div class="first"><b>${hallParty(d2.first)}</b><small>${fmtDate(d2.first.at)} · ${fmtSecs(d2.first.secs)} · ${hallMeta(d2.first)}</small></div>` : '<div class="empty">The Drowned Sovereign still rules the Sunken Court.</div>';
    if (d2.fastest.length) h += '<h4>Fastest Floor 2 clears</h4>' + d2.fastest.map((r, i) => `<div class="row"><span class="n">${i + 1}</span><span class="t">${fmtSecs(r.secs)}</span><span class="who">${hallParty(r)}<small>${fmtDate(r.at)} · ${hallMeta(r)}</small></span></div>`).join('');
  }
  if (d.heroes?.length) { // clears by the Named alone: kept apart from the players' lists (server/hall.js)
    h += "<h4>Heroes' record</h4>" + d.heroes.map(r => `<div class="row"><span class="t">${fmtSecs(r.secs)}</span><span class="who">${hallParty(r)}<small>Floor ${r.floor} · ${ago(r.at)} · ${hallMeta(r)}</small></span></div>`).join('');
  }
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
  if (state.dead || revive.isDown() || !state.joined || !CONSUMABLES[id]) return;
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
loot.bindTips($('bag')); // item hover cards
$('skills-btn').onclick = () => talents.toggle(); // Skill Tree window (also K, or F at a Skill Shrine)

const statsText = it => Object.entries(it.st).map(([k, v]) => statLabel(k, v)).join(' · ');
function mainStat(it) { return it ? (it.st.atk ?? it.st.hp ?? Object.values(it.st).reduce((a, b) => a + b, 0)) : 0; }
const stackBtns = (kind, id) => `<button data-a="dropStack" data-k="${kind}" data-id="${id}" title="Drop 1 on the ground (Shift: the whole stack)">Drop</button><button class="del" data-a="discardStack" data-k="${kind}" data-id="${id}" title="Delete 1 (Shift: the whole stack)">Delete</button>`;
// A keepsake (story item, shared/items.js): its own colour, its line of text instead of stats, and no sell / drop / delete.
const keepsakeRow = (it, slotName, actions) => `<div class="it keepsake" title="${esc(it.desc || '')}"><span class="slot">${slotName}</span><span class="nm"><b class="r${it.r}">${esc(it.name)}</b><small class="ks-desc">${esc(it.desc || '')}</small><small>Keepsake · it stays with you</small></span>${actions}</div>`;
function renderBag() {
  const el = $('bag');
  if (el.classList.contains('hidden') || !state.inv) return;
  const inv = state.inv, near = nearMerchant();
  const shopping = near && state.shopOpen;
  const row = (it, slotName, actions) => it?.ks ? keepsakeRow(it, slotName, actions) : it
    ? `<div class="it" data-tu="${it.u}"><span class="slot">${slotName}</span><span class="nm"><b class="r${it.r}">${esc(it.name)}${loot.setTag(it)}</b><small>${statsText(it)}${styles.tag(it)}${loot.lines(it)}</small></span>${actions}</div>`
    : `<div class="it empty"><span class="slot">${slotName}</span><span class="nm"><small>Empty</small></span></div>`;
  let h = `<div class="top"><span>Bag <span class="gold">${inv.gold} gold</span></span><button class="x" data-a="close">✕</button></div>`;
  if (shopping) {
    h += `<div class="shop"><h4>Merchant</h4>${SHOP.map((s, i) => {
      const name = s.kind === 'cons' ? CONSUMABLES[s.id].name : styles.shopName(s, state.cls) || (s.slot === 'weapon' ? 'Uncommon weapon (your class)' : 'Uncommon armour');
      const desc = s.kind === 'cons' ? CONSUMABLES[s.id].desc : s.slot === 'weapon' ? '+7–9% damage' : '+8–12% max health';
      const price = s.kind === 'cons' ? CONSUMABLES[s.id].price : s.price;
      return `<div class="it"><span class="nm"><b>${name}</b><small>${desc}</small></span><button data-a="buy" data-i="${i}" ${inv.gold < price ? 'disabled style="opacity:.4"' : ''}>${price}g</button></div>`;
    }).join('')}</div>`;
  } else if (near) h += `<div class="it"><span class="nm"><small>You're at the merchant.</small></span><button data-a="shop">Trade</button></div>`;
  h += `<h4>Equipped</h4>${SLOTS.map(sl => row(inv.eq[sl], sl, inv.eq[sl] ? `<button data-a="unequip" data-s="${sl}">Remove</button>` : '')).join('')}`;
  const st = inv.stats;
  h += `<div class="stats"><span>Damage ${st.atk}</span><span>Health ${st.maxHp}</span><span>Crit ${st.crit}%</span><span>Cooldowns −${st.haste}%</span><span>Switch +${st.sw}%</span><span>Damage taken −${st.dr}%</span></div>`;
  h += loot.setsHtml(inv) + loot.loadoutsHtml(inv); // set progress and loadouts (public/loot.js)
  h += `<h4>Consumables</h4>${CONSUMABLE_IDS.map(id => `<div class="it"><span class="slot">${CONSUMABLES[id].key}</span><span class="nm"><b>${CONSUMABLES[id].name} ×${inv.cons[id] || 0}</b><small>${CONSUMABLES[id].desc}</small></span><button data-a="use" data-id="${id}" ${inv.cons[id] ? '' : 'disabled style="opacity:.4"'}>Use</button>${inv.cons[id] ? stackBtns('cons', id) : ''}</div>`).join('')}`;
  h += `<h4>Bag (${inv.bag.length}/24)</h4>`;
  h += inv.bag.length ? inv.bag.map(it => {
    const cur = inv.eq[it.slot], diff = Math.round((mainStat(it) - mainStat(cur)) * 10) / 10; // refined stats have one decimal
    const cmp = it.slot !== 'charm' && cur ? (diff > 0 ? ` <span class="up">▲${diff}</span>` : diff < 0 ? ` <span class="down">▼${-diff}</span>` : '') : !cur ? ' <span class="up">new</span>' : '';
    const usable = !it.cls || it.cls === state.cls;
    if (it.ks) return keepsakeRow(it, it.slot, `<button data-a="equip" data-u="${it.u}">Wear</button>`); // keepsakes: no sell, drop or delete
    return `<div class="it" data-tu="${it.u}"><span class="slot">${it.slot}</span><span class="nm"><b class="r${it.r}">${esc(it.name)}${loot.setTag(it)}${cmp}</b><small>${statsText(it)}${usable ? '' : ` · ${CLASSES[it.cls].name} only`}${styles.tag(it)}${loot.lines(it)}</small></span>${usable ? `<button data-a="equip" data-u="${it.u}">Equip</button>` : ''}${shopping ? `<button class="sell" data-a="sell" data-u="${it.u}">${sellPrice(it)}g</button>` : ''}<button data-a="drop" data-u="${it.u}" title="Drop on the ground for anyone to pick up">Drop</button><button class="del" data-a="discard" data-u="${it.u}" title="Delete for good">Delete</button></div>`;
  }).join('') : '<div class="it empty"><span class="nm"><small>Nothing yet. Enemies drop gear; the Warden always does.</small></span></div>';
  { // materials, each with Drop / Delete
    const have = inv.mats || {}, ids = MAT_IDS.filter(k => have[k] > 0);
    h += `<h4>Materials</h4>` + (ids.length ? ids.map(k => `<div class="it"><span class="slot" style="color:${MATS[k].color}">mat</span><span class="nm"><b>${esc(MATS[k].name)} ×${have[k]}</b><small>from ${esc(MATS[k].from)}</small></span>${stackBtns('mat', k)}</div>`).join('') + '<small class="mats-hint">Take them to the Smith in town (F) to refine or craft gear. Shift+click Drop/Delete to do the whole stack.</small>'
      : '<div class="it empty"><span class="nm"><small>None yet. Monsters drop materials for the Smith in town.</small></span></div>');
  }
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
  if (a === 'close') { $('bag').classList.add('hidden'); loot.hideTip(); return; }
  const lo = loot.click(b); // loadout buttons (public/loot.js)
  if (lo) { if (lo === 'render') renderBag(); sfx.play('ui'); return; }
  if (a === 'shop') { state.shopOpen = true; renderBag(); return; }
  if (a === 'buy') send({ type: 'buy', i: +b.dataset.i });
  if (a === 'sell') send({ type: 'sell', u: +b.dataset.u });
  if (a === 'equip') send({ type: 'equip', u: +b.dataset.u });
  if (a === 'drop') send({ type: 'drop', u: +b.dataset.u });
  if (a === 'dropStack') send({ type: 'dropStack', kind: b.dataset.k, id: b.dataset.id, n: e.shiftKey ? 9999 : 1 });
  if (a === 'discardStack') { // two clicks, like gear
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = e.shiftKey ? 'All?' : 'Sure?'; b.dataset.all = e.shiftKey ? 1 : ''; setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Delete'; }, 3000); return; }
    send({ type: 'discardStack', kind: b.dataset.k, id: b.dataset.id, n: b.dataset.all || e.shiftKey ? 9999 : 1 });
  }
  if (a === 'discard') { // two clicks: the first arms it
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Sure?'; setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Delete'; }, 3000); return; }
    send({ type: 'discard', u: +b.dataset.u });
  }
  if (a === 'unequip') send({ type: 'unequip', slot: b.dataset.s });
  if (a === 'use') useItem(b.dataset.id);
  if (a === 'title') send({ type: 'title', id: b.dataset.t || null });
  sfx.play('ui');
});

let gateKey = '';
function updateGateBox(force) {
  const el = $('gatebox');
  const [open, waiting, ready, count] = state.gate;
  const show = !state.spectator && !state.dead && !open && (inGateZone(state.x, state.z) || inGateZone2(state.x, state.z) || inGateZone3(state.x, state.z));
  const key = `${show}|${waiting}|${ready}|${Math.ceil(count)}|${state.meReady}`;
  if (key === gateKey && !force) return;
  gateKey = key;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const gate2 = onFloor2(state.x) || onFloor3(state.x);
  el.innerHTML = `<b>${onFloor3(state.x) ? 'THE STORM GATE' : gate2 ? 'THE SUNKEN GATE' : 'RAID GATE'}</b><div class="sub">${onFloor3(state.x) ? f3.gateText() : f2.gateText()} · ${ready}/${waiting} ready${waiting > 1 ? '' : ' (solo)'}${ready && ready < waiting && !count ? '<br>Opens 20 s after the first ready, even if not everyone is' : ''}</div>`
    + (count > 0 ? `<div class="count">${Math.ceil(count)}</div>` : '')
    + `<button class="${state.meReady ? 'on' : ''}">${state.meReady ? 'Ready ✓' : `Ready${isTouch ? '' : ' (F)'}`}</button>`;
  if (!onFloor3(state.x)) twists.gateBox(el, onFloor2(state.x)); // the twist of the boss behind this gate (the Warden's, or the Sovereign's on Floor 2)
  el.querySelector('button').onclick = interact;
}

// ---------------- HUD ----------------
const logEl = $('log');
let hudParty = '';
// Party frames: click a bot's frame for its own orders, or "All bots" for orders to every bot (V still opens the wheel).
$('party').addEventListener('pointerdown', e => {
  const all = e.target.closest('#bots-btn'), one = e.target.closest('.frame[data-bot]');
  if (!all && !one) return;
  e.preventDefault(); e.stopPropagation();
  const el = all || one;
  if (wheel.menuOpen()) wheel.closeMenu(); else wheel.menu(el.getBoundingClientRect(), all ? '' : one.dataset.bot);
});
function log(text, cls = '') {
  const d = document.createElement('div');
  d.className = cls; d.textContent = text;
  logEl.appendChild(d);
  while (logEl.children.length > (isTouch ? 5 : 30)) logEl.firstChild.remove();
}
let bannerT = 0;
// Banners queue up so two at once (e.g. a rare sighting and a title) don't overwrite each other.
const bannerQ = []; let bannerBusy = false;
function banner(title, sub = '', first = false) { // first: jump the queue (the Tower Bell)
  if (bannerQ.some(b => b[0] === title && b[1] === sub)) return;
  bannerQ[first ? 'unshift' : 'push']([title, sub]);
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
$('chat-btn').onclick = () => { const t = prompt('Say something (/p party, /s nearby, /b bot orders: /b help, /sit /kneel /bow /stand)'); if (t) sendChat(t); };
// Chat channels: "/p text" party, "/s text" say (nearby); anything else goes to everyone ("/b ..." bot orders: the server
// reads them, shared/bots/social.js parseBotChat; they never show as chat).
function sendChat(raw) {
  let t = String(raw || '').trim(), ch;
  const m = t.match(/^\/(p|party|s|say)\s+([\s\S]*)$/i);
  if (m) { ch = m[1][0].toLowerCase(); t = m[2].trim(); }
  if (t) send({ type: 'chat', text: t, ...(ch ? { ch } : {}) });
}
$('players-btn').onclick = () => { $('players').classList.toggle('hidden'); lobby.html = ''; renderPlayers(); };
function renderPlayers() {
  if ($('players').classList.contains('hidden')) return;
  const nNamed = [...state.roster.values()].filter(r => r.named).length; // the Named have the Friends tab (public/named.js)
  const nBots = [...state.roster.values()].filter(r => r.bot && !r.named).length, nReal = state.roster.size - nBots - nNamed;
  if (pbots.tab !== 'players') return pbots.render($('players'), nReal, nBots); // Bots / Friends tab (public/playerbots.js)
  const rows = [], botRows = [];
  let online = 0;
  // A bot that's in a party with a real player declines invites, so say so instead of offering a button.
  const humanParty = pid => pid && [...state.roster].some(([i, x]) => !x.bot && players.get(i)?.party === pid);
  for (const [id, r] of state.roster) {
    if (r.named) continue;
    if (r.bot) { // bots get their own section (managing them is on the Bots tab)
      const p = players.get(id);
      const inParty = state.party && p?.party === state.party;
      const right = inParty ? '<small>Party</small>' : humanParty(p?.party) ? '<small style="opacity:.6">In a party</small>' : `<button data-inv="${id}">Invite</button>`;
      botRows.push(`<div class="p"><span>${looks.swatch(id)}${esc(r.name)} <small style="opacity:.6">Lv ${p?.lvl ?? 1} ${CLASSES[r.cls].name}</small><span class="tag">BOT</span></span>${right}</div>`);
      continue;
    }
    online++;
    if (id === state.myId) continue;
    const p = players.get(id);
    const inParty = state.party && p?.party === state.party;
    const lfgTag = (p?.buffs || 0) & 4 ? '<span class="tag">LFG</span>' : '';
    const pf = p ? floorOf(p.tx ?? p.x) : 1, floorTag = pf > 1 ? `<span class="tag f2">F${pf}</span>` : '';
    rows.push(`<div class="p"><span>${looks.swatch(id)}${esc(r.name)} <small style="opacity:.6">Lv ${p?.lvl ?? 1} ${CLASSES[r.cls].name}</small>${lfgTag}${floorTag}${titleTag(r.title)}</span>${inParty ? '<small>Party</small>' : `<button data-inv="${id}">Invite</button>`}</div>`);
  }
  const meE = players.get(state.myId), seeking = !!((meE?.buffs || 0) & 4);
  const lfgBtn = `<button class="lfg ${seeking ? 'on' : ''}">${state.party ? (seeking ? 'Recruiting via party finder ✓' : 'Recruit with party finder') : seeking ? 'Searching for a party… (cancel)' : 'Find party'}</button>`;
  // Bots (collapsed) and recently seen offline characters (GET /api/lobby, refreshed at most every 30 s)
  if (acct.cfg.accounts && !state.spectator && Date.now() - (lobby.at || 0) > 30000) { lobby.at = Date.now(); fetch('/api/lobby').then(r => r.json()).then(b => { lobby.offline = b.offline || []; renderPlayers(); }).catch(() => {}); }
  const onlineNames = new Set([...state.roster.values()].map(r => r.name.toLowerCase()));
  const offline = (lobby.offline || []).filter(o => !onlineNames.has(o.name.toLowerCase()));
  const offHtml = offline.length ? `<details class="sect" ${lobby.offOpen !== false ? 'open' : ''} data-sect="off"><summary><b>Offline (${offline.length})</b> <small style="opacity:.6">last 30 days</small></summary>${offline.map(o => `<div class="p off"><span>${esc(o.name)} <small style="opacity:.6">Lv ${o.lvl} ${CLASSES[o.cls]?.name || ''}</small></span><small style="opacity:.55">${seenAgo(o.seen)}</small></div>`).join('')}</details>` : '';
  const botHtml = botRows.length ? `<details class="sect" ${lobby.botOpen !== false ? 'open' : ''} data-sect="bots"><summary><b>Bots (${botRows.length})</b> <small style="opacity:.6">invite to your party</small></summary>${botRows.join('')}</details>` : '';
  const html = `${pbots.tabsHtml(nReal, nBots)}${lfgBtn}<b>Online (${online})</b>${rows.join('') || '<div style="opacity:.6;font-size:13px;padding:6px 0">Nobody else yet. Share the link with friends!</div>'}${botHtml}${offHtml}${state.party ? '<button class="leave">Leave party</button>' : ''}`;
  if (html === lobby.html) return; // unchanged: keep the DOM (buttons stay clickable)
  $('players').innerHTML = lobby.html = html;
  pbots.bindTabs($('players'));
  for (const d of $('players').querySelectorAll('details[data-sect]')) d.ontoggle = () => { if (d.dataset.sect === 'bots') lobby.botOpen = d.open; else lobby.offOpen = d.open; };
  $('players').querySelector('.lfg').onclick = () => { send({ type: 'lfg' }); sfx.play('ui'); setTimeout(renderPlayers, 150); };
  for (const b of $('players').querySelectorAll('[data-inv]')) b.onclick = () => { send({ type: 'invite', id: +b.dataset.inv }); b.textContent = 'Sent'; b.disabled = true; };
  const lv = $('players').querySelector('.leave'); if (lv) lv.onclick = () => send({ type: 'leave' });
}
const lobby = { at: 0, offline: [], offOpen: true, html: '' }; // Players panel: offline list + which sections are open
const seenAgo = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
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
  const w = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  if (el._w !== w) { el._w = w; el.style.width = w; }
  if (wrap) { wrap.classList.toggle('low', pct < 25); wrap.classList.toggle('mid', pct >= 25 && pct < 50); }
}
// The HUD only touches the DOM when a value changes (cached on the element).
const setText = (el, t) => { if (el && el._t !== t) { el._t = t; el.textContent = t; } };
const setHtml = (el, h) => { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } };
const setVar = (el, k, v) => { if (el && el['_' + k] !== v) { el['_' + k] = v; el.style.setProperty(k, v); } };

let hudT = 0;
function updateHud(now) {
  if (now - hudT < 100) return; hudT = now;
  const name = state.roster.get(state.myId)?.name || '';
  const meHtml = `${esc(name)}${titleTag(state.roster.get(state.myId)?.title)}`;
  if ($('me-name').innerHTML !== meHtml) $('me-name').innerHTML = meHtml;
  setText($('me-lvl'), `Lv ${state.lvl} ${CLASSES[state.cls].name}`);
  const pct = (state.hp / state.maxHp) * 100;
  setBar($('me-hp'), pct, $('me-hp').parentElement);
  setText($('me-hp-text'), `${state.hp} / ${state.maxHp}`);
  setBar($('me-xp'), state.lvl >= MAX_LEVEL ? 100 : (state.xp / state.next) * 100);
  const me = players.get(state.myId);
  const b = me?.buffs || 0;
  setHtml($('me-buffs'), `${b & 1 ? '<span>Guarded</span>' : ''}${b & 2 ? '<span>Blessed</span>' : ''}${mastery.buffTags(b)}${state.tonic > 0 ? `<span>Tonic ${Math.ceil(state.tonic)}s</span>` : ''}${state.draught > 0 ? `<span>Ironbark ${Math.ceil(state.draught)}s</span>` : ''}`);

  // party frames
  const mates = state.spectator ? [...players.values()] : state.party ? [...players.values()].filter(p => p.party === state.party && p.id !== state.myId) : [];
  const partyHtml = teamplay.partyBar() + mates.map(p => {
    const pc = (p.hp / p.maxHp) * 100, bot = state.roster.get(p.id)?.bot;
    const nm = state.roster.get(p.id)?.name || p.name;
    return `<div class="frame ${p.dead ? 'dead' : ''} ${p.downed ? 'downed' : ''} ${bot && !state.spectator ? 'botf' : ''}" ${bot && !state.spectator ? `data-bot="${esc(nm)}" title="Click for ${esc(nm)}'s orders"` : ''}><div class="row" style="font-size:12px;margin:0"><span>${bot && !state.spectator ? '<span class="bcmd">⌘</span> ' : ''}${looks.swatch(p.id, 14)}${esc(p.name)}${bot ? ' <small class="bottag">BOT</small>' : ''}${titleTag(state.roster.get(p.id)?.title)}${state.spectator ? ` <small style="opacity:.75;font-weight:600">${CLASSES[p.cls].name} · ${CLASSES[p.cls].role}</small>` : ''}${p.downed ? ` <b class="dtag">${p.downed.by ? 'REVIVING' : 'DOWNED'}</b>` : ''}</span><span style="opacity:.7">Lv ${p.lvl}</span></div><div class="bar hp ${pc < 25 ? 'low' : pc < 50 ? 'mid' : ''}"><div style="width:${pc}%"></div></div>${classesA.frameBar(p)}</div>`;
  }).join('') + (!state.spectator && mates.some(p => state.roster.get(p.id)?.bot) ? `<button id="bots-btn" class="pbtn" title="Orders for all your bots (or hold V for the wheel)">⌘ All bots <small>V</small></button>` : '');
  if (partyHtml !== hudParty) { hudParty = partyHtml; $('party').innerHTML = partyHtml; }

  // boss bar (the boss of the floor you're on)
  const onF2 = onFloor2(state.x), onF3 = onFloor3(state.x), bossOf = m => !!m.def?.f2 === onF2 && !!m.def?.f3 === onF3; // the boss of your floor
  if (!boss || !bossOf(boss)) boss = [...mobs.values()].find(m => m.def?.boss && bossOf(m) && !m.dying) || null;
  const showBoss = boss && (boss.engaged || boss.hp < boss.maxHp) && state.z > 120;
  $('boss').classList.toggle('hidden', !showBoss);
  if (showBoss) {
    setBar($('boss-hp'), (boss.hp / boss.maxHp) * 100); $('boss').classList.toggle('enraged', !!boss.enraged);
    const bn = $('boss').querySelector('.boss-name'); if (bn.textContent !== boss.def.name) bn.textContent = boss.def.name;
    combat.bossBar(boss);
    threat.bossBar(boss); // who it's after, my threat meter
    setText($('boss-phase'), onF3 ? f3.phaseText() : onF2 ? f2.phaseText() : ['PHASE 1 · CLEAVE & SLAM', 'PHASE 2 · HOUNDS & HORN CHARGE', 'PHASE 3 · ENRAGED · ROCKFALL'][state.phase] || '');
    if (!onF3) twists.bossLine($('boss-phase'), onF2); // the Warden's twist, or the Sovereign's on Floor 2
  }

  // items, raid gate, merchant, guide
  { const gt = `${state.gold}g`; if ($('gold-chip').textContent !== gt) { $('gold-chip').textContent = gt; layoutChips(); } }
  updateGateBox();
  const near = nearMerchant();
  if (near !== state.wasNear) { state.wasNear = near; if (!near) state.shopOpen = false; renderBag(); }
  if (loot.canSwap() !== state.wasTown) { state.wasTown = loot.canSwap(); renderBag(); } // loadout swaps: town only
  if (!state.dead && state.hp / state.maxHp < 0.35 && state.hp > 0) guide.tip('lowhp');
  if (inArena(state.x, state.z) || inArena2(state.x, state.z) || inArena3(state.x, state.z)) guide.did('gate');

  // cooldowns
  for (const btn of $('skills').children) {
    if (btn.dataset.item) {
      const id = btn.dataset.item, n = state.inv?.cons?.[id] || 0, left = Math.max(0, (state.ccdReady[id] || 0) - now) / 1000;
      setText(btn._cnt ||= btn.querySelector('.cnt'), `×${n}`);
      btn.classList.toggle('none', n === 0);
      setVar(btn._cd ||= btn.querySelector('.cd'), '--p', `${Math.min(100, (left / CONSUMABLES[id].cd) * 100).toFixed(1)}%`);
      continue;
    }
    if (btn.dataset.slot === 'guard') { btn.classList.toggle('on', combat.guarding); continue; }
    if (btn.dataset.slot === 'cover') { threat.coverCd(btn); continue; }
    if (btn.dataset.slot === 'act') { const a = interactKind(); btn.classList.toggle('on', !!a); setText(btn, a === 'shop' ? 'Trade' : a === 'hall' ? 'Read' : a === 'smith' ? 'Forge' : a === 'shrine' ? 'Skills' : a === 'pickup' ? 'Pick up' : a === 'warp' || a === 'stair' ? 'Warp' : state.meReady ? 'Unready' : 'Ready'); continue; }
    const isDodge = btn.dataset.slot === 'dodge', isJump = btn.dataset.slot === 'jump';
    const slot = +btn.dataset.slot, sk = isDodge ? { cd: DODGE.cd } : isJump ? { cd: JUMP.cd } : { cd: mastery.cd(slot) }; // mastery/branch cooldowns
    const left = Math.max(0, (isDodge ? state.dodgeReady : isJump ? state.jumpReady : state.ready[slot]) - now) / 1000;
    setVar(btn._cd ||= btn.querySelector('.cd'), '--p', `${Math.min(100, (left / sk.cd) * 100).toFixed(1)}%`);
    setText(btn._cdt ||= btn.querySelector('.cdt'), left > 0.3 && slot > 0 && !isDodge && !isJump ? left.toFixed(left < 3 ? 1 : 0) : '');
  }

  const fightingBoss = boss && (boss.engaged || boss.hp < boss.maxHp) && state.z > 150;
  sfx.setMood(inTown(state.x, state.z) ? 'town' : fightingBoss ? 'boss' : onFloor2(state.x) ? 'mire' : 'field');
  const a = areaName(state.x, state.z);
  if (a !== state.area) { state.area = a; showArea(a + (inTown(state.x, state.z) ? ' — Safe Zone' : '')); }
}

// ---------------- floating combat text (docs/ROADMAP.md A) ----------------
// Nothing piles up: texts on one entity form a stack. A new one starts at the bottom and pushes the live ones up by
// its height (they keep their order, so nothing crosses as they rise and fade); a repeat of a live text on that
// entity ("Jumped!" again) bumps one label ("Jumped! ×3") instead. A stack taller than FT.stack drops its oldest.
// Who sees what is decided by the callers: your own reactions (events tagged `to`) only for you, effects on a target
// for everyone, other players' damage numbers small and dim ('other'), at most FT.otherCap of them alive at once.
const FT = { max: 32, life: 0.75, longLife: 1.05, rise: 1.3, gap: 2, side: 10, stack: 140, merge: 0.5, pop: 0.12, otherCap: 4 };
const FT_LONG = new Set(['switch', 'perfect', 'parry', 'crit', 'loot', 'mastery', 'talent', 'counter']);
const nums = [], floatLog = [], numSize = new Map(); // floatLog: the last texts shown (window.__fb.floatLog, for tests)
function floatNum(pos, h, text, cls = '', opacity = 1) {
  const kind = cls.split(' ')[0], numeric = /^[-+(]?\d/.test(text);
  const here = nums.filter(n => n.anchor === pos);
  const twin = !numeric && here.find(n => n.text === text && n.cls === cls && n.age < n.life * FT.merge);
  if (twin) { // merge the repeat
    twin.count++; twin.el.textContent = `${text} ×${twin.count}`; twin.age = Math.min(twin.age, 0.06); twin.pop = 0;
    logFloat(text, cls, twin.count);
    return;
  }
  if (kind === 'other' && nums.reduce((s, n) => s + (n.kind === 'other'), 0) >= FT.otherCap) return;
  while (nums.length >= FT.max) drop(nums[0]);
  const el = document.createElement('div');
  el.className = `num ${cls}`; el.textContent = text; el.style.opacity = 0;
  $('labels').appendChild(el);
  // (measuring forces a page layout: once per style and length, then cached)
  const sk = `${cls}|${text.length}`;
  let sz = numSize.get(sk);
  if (!sz) { sz = [el.offsetHeight || 22, el.offsetWidth || 30]; if (numSize.size > 400) numSize.clear(); numSize.set(sk, sz); }
  const [ht, wd] = sz;
  const low = here.length ? here[here.length - 1] : null; // the newest live text: the bottom of the stack
  if (low) {
    const push = (ht + low.ht) / 2 + FT.gap;
    for (const n of here) n.dyTo += push;
    for (const n of here) if (n.dyTo > FT.stack) drop(n); // too tall: the oldest give way
  }
  const life = FT_LONG.has(kind) ? FT.longLife : FT.life;
  if (kind === 'other') opacity *= 0.55;
  nums.push({ el, anchor: pos, x: pos.x, y: low ? low.y : h, z: pos.z, age: 0, pop: 0, life, opacity, dy: 0, dyTo: 0, lift: 0, ht, wd,
    dx: low ? (low.dx > 0 ? -FT.side : FT.side) : 0, text, cls, kind, count: 1 }); // one base height per stack; alternate sides a little
  logFloat(text, cls, 1);
}
function logFloat(text, cls, n) { floatLog.push({ text, cls, n, at: Math.round(performance.now()) }); if (floatLog.length > 150) floatLog.shift(); }
function drop(n) { n.el.remove(); const i = nums.indexOf(n); if (i >= 0) nums.splice(i, 1); }
function drawFloats(dt, vdt) {
  const placed = []; // screen rects already drawn this frame, oldest first: a newer text that would cover one moves up
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i]; n.age += vdt; n.pop += vdt;
    if (n.age > n.life) { n.el.remove(); nums.splice(i--, 1); continue; }
    n.dy += (n.dyTo - n.dy) * Math.min(1, dt * 30); // a quick slide when pushed up
    const k = n.age / n.life, ease = 1 - Math.pow(1 - k, 3); // rise fast, then settle
    const p = project(n.x, n.y + ease * FT.rise, n.z);
    if (!p) { n.el.style.display = 'none'; continue; }
    // texts on different entities can still meet on screen: lift this one clear of any drawn before it
    const x = p[0] + n.dx, hw = n.wd / 2, hh = n.ht / 2;
    n.lift *= 1 - Math.min(1, dt * 4); // settle back down once there's room
    let y = p[1] - n.dy - n.lift;
    for (let moved = true, guard = 0; moved && guard < 8; guard++) {
      moved = false;
      for (const r of placed) if (Math.abs(x - r.x) < hw + r.hw && Math.abs(y - r.y) < hh + r.hh) { y = r.y - r.hh - hh - FT.gap; moved = true; }
    }
    n.lift = p[1] - n.dy - y;
    placed.push({ x, y, hw: hw * 1.1, hh: hh * 1.1 }); // (a little margin for the pop-in scale)
    n.el.style.display = '';
    n.el.style.left = `${x}px`; n.el.style.top = `${y}px`;
    n.el.style.transform = `translate(-50%, -50%) scale(${n.pop < FT.pop ? 1.3 - (0.3 * n.pop) / FT.pop : 1})`;
    n.el.style.opacity = String(n.opacity * (k < 0.65 ? 1 : (1 - k) / 0.35));
  }
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
  for (const m of mobs.values()) if (m.def?.rare && !m.dying && floorOf(m.x) === floorOf(state.x)) { rare = m; break; } // only point at a rare on your floor
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
// A shake that fades with distance: full at the spot, 40% at r, nothing beyond (stomps, rockfall, Quake Rings).
const shakeNear = (x, z, a, r) => { const d = Math.hypot(x - state.x, z - state.z); if (d < r && !state.dead) shake(a * (1 - (0.6 * d) / r)); };
// Hit-stop: a boss's big hit landed on YOU (a `hurt` event tagged big). Only this client freezes; never on your own hits.
const BIG_HIT_STOP = 0.075;
let sendT = 0, last = performance.now();

function project(x, y, z) {
  v3.set(x, y, z).project(camera);
  if (v3.z > 1) return null;
  return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight];
}

// Per-frame drawing state (set at the top of frame()): the snapshot moment drawn (null: not yet / ?interp=0), how far
// visual time lags it (slow motion and hit-stop freeze characters, then they catch up), the camera frustum (off-screen
// characters animate at a lower rate) and how many characters are moving / guessing / waiting (the overlay).
let drawT = null, frameNo = 0;
const SMP = {}, frustum = new THREE.Frustum(), frM4 = new THREE.Matrix4(), frSphere = new THREE.Sphere();
const entStats = { interp: 0, extrap: 0, hold: 0 };
// Drawn at any distance (up to the fog), whatever the quality's character draw distance: bosses, your party, and
// anyone in the boss arena you're in (their telegraphs are effects, never culled).
function keepDrawn(e) {
  if (e.def?.boss) return true;
  if (e.kind === 'player' && state.party && e.party === state.party) return true;
  const x = state.x, z = state.z;
  return (inArena(x, z) && inArena(e.x, e.z)) || (inArena2(x, z) && inArena2(e.x, e.z)) || (inArena3(x, z) && inArena3(e.x, e.z));
}
function animateEntity(e, dt) {
  const g = e.model.group;
  const self = e.id === state.myId && e.kind === 'player';
  if (self) { e.x = state.x; e.z = state.z; e.tface = state.face; }
  const k = Math.min(1, dt * (self ? 25 : 12));
  const px = g.position.x, pz = g.position.z;
  const tx = self ? e.x : e.tx, tz = self ? e.z : e.tz;
  let smp = null;
  if (!self && drawT !== null) { smp = e.track.sample(drawT, last, SMP); if (smp) { e.tface = smp.f; entStats[smp.mode]++; } }
  const jumpTime = e.jumpDur ?? JUMP.time; // Sky Lance's hop lasts its whole flight
  if (e.jumpT !== undefined && e.jumpT < jumpTime) {
    e.jumpT += dt;
    const jk = Math.min(1, e.jumpT / jumpTime);
    g.position.y = 4 * JUMP.height * jk * (1 - jk);
  } else { g.position.y = 0; e.jumpDur = undefined; }
  if (e.kind === 'mob') mastery.lift(e, dt); // Quake launches enemies
  g.position.y += arenas.lift(e); // falling into a boss's lower area, the boss dropping in (arenas.js)
  if (e.punch > 0) e.punch -= dt;
  const kk = e.punch > 0 ? Math.min(1, dt * 22) : k;
  if (self) { g.position.x = state.x + corr.x; g.position.z = state.z + corr.z; } // a server correction slides out (Correction)
  else if (smp) { g.position.x = smp.x; g.position.z = smp.z; } // between the snapshots around the moment drawn (Track)
  else if (Math.hypot(tx - px, tz - pz) > 15) g.position.set(tx, 0, tz); // (?interp=0: chase the newest snapshot)
  else if (e.punch > 0) { g.position.x += (tx - px) * kk; g.position.z += (tz - pz) * kk; }
  else if (!(e.punch > 0)) { g.position.x += (tx - px) * k; g.position.z += (tz - pz) * k; }
  if (!self) { e.x = g.position.x; e.z = g.position.z; }
  // Far characters: past the fog they're invisible anyway, so they leave the scene (no animation, no draw); off screen
  // or beyond Q.animNear they animate every few frames (public/quality.js).
  const cdist = Math.hypot(g.position.x - camera.position.x, g.position.z - camera.position.z);
  if (!self && cdist > (state.spectator || keepDrawn(e) ? scene.fog.far * Q.fog + 8 : Math.min(scene.fog.far * Q.fog + 8, Q.charDist))) {
    if (!e.culled) { e.culled = true; scene.remove(g); if (e.label) setShown(e.label, false); }
    return;
  }
  if (e.culled) { e.culled = false; scene.add(g); }
  // shadows only from characters near the camera (each caster is another draw in the shadow pass); bosses always
  const cast = self || !!e.def?.boss || cdist < Q.charShadow + (e.cast === false ? 0 : 2); // (2 m of hysteresis)
  if (cast !== (e.cast ?? true)) { e.cast = cast; g.traverse(o => { if (!o.isMesh) return; o.userData.cast ??= o.castShadow; o.castShadow = cast && o.userData.cast; }); }
  frSphere.center.set(g.position.x, g.position.y + 1, g.position.z); frSphere.radius = Math.max(2, e.model.height || 2);
  const onScreen = frustum.intersectsSphere(frSphere), lod = !self && (!onScreen || cdist > Q.animNear);
  const speed = Math.hypot(g.position.x - px, g.position.z - pz) / Math.max(dt, 1e-3);
  let df = e.tface - g.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df));
  g.rotation.y += df * Math.min(1, dt * 14);

  const m = e.model;
  e.spd = (e.spd || 0) + (speed - (e.spd || 0)) * Math.min(1, dt * 10);
  if (m.anim) {
    const a = m.anim, isP = e.kind === 'player';
    if (isP && e.dead && !a.dead) a.die();
    else if (isP && !e.dead && a.dead) a.revive();
    if (isP && speed > 0.5) { // moving away from where we face = walking backwards
      const rel = Math.atan2(g.position.x - px, g.position.z - pz) - g.rotation.y;
      e.back = (e.back || 0) + ((Math.cos(rel) < -0.35 ? 1 : 0) - (e.back || 0)) * Math.min(1, dt * 12);
    } else if (isP && e.spd < 0.5) e.back = 0;
    const dirSign = isP && e.back > 0.5 ? -1 : 1;
    if (isP && e.downed && !e.dead) a.base('Idle', 0.25); // downed: the slumped pose below, crawling
    else if (e.spd > (isP ? 3.5 : 4.6)) a.base(dirSign < 0 ? 'Walking_A' : 'Running_A', 0.2, dirSign * Math.max(0.7, e.spd / (isP ? (dirSign < 0 ? 4.5 : 6.5) : 5.5)));
    else if (e.spd > 0.5) a.base('Walking_A', 0.2, dirSign * (isP ? 1.2 : Math.max(0.6, e.spd / 3.5)));
    else a.base(a.posed ? 'Idle' : a.idle, 0.25); // a held pose is tuned over the plain Idle
    if (isP && e.downed && !e.dead) a.setPose('downed'); // downed: slumped on the knees (public/revive.js)
    else if (isP) poseFrame(e, a);
    const adt = (hitStop > 0 ? dt * 0.08 : dt) + e.animAcc;
    if (lod && (frameNo + e.id) % (onScreen ? Q.animEvery : 6)) e.animAcc = adt; // far / off screen: skip this frame, keep the time
    else { a.update(adt); e.animAcc = 0; }
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
  looks.frame(e, dt); // a look's cloth, lantern and aura (public/looks.js)
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
    if (!p || d > 45 || (e.kind === 'player' && e.dead)) { setShown(e.label, false); return; }
    setShown(e.label, true);
    const tr = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -100%)`;
    if (tr !== e.label.tr) { e.label.tr = tr; e.label.el.style.transform = tr; }
    const txt = e.kind === 'mob' ? `<span class="lv">Lv${e.def.level}</span>${looks.plate(e, e.def.name)}${e.staggered ? ' <b class="brk">BROKEN</b>' : ''}` : `<span class="lv">Lv${e.lvl}</span>${looks.plate(e, `${esc(e.name)}${state.spectator ? ` · ${CLASSES[e.cls].role}` : ''}${titleTag(state.roster.get(e.id)?.title)}`)}`;
    if (txt !== e.label.text) { e.label.text = txt; e.label.nm.innerHTML = txt; }
    const pct = Math.round((e.hp / e.maxHp) * 100);
    if (pct !== e.label.pct) { e.label.pct = pct; e.label.fill.style.width = `${pct}%`; }
    if (e.kind === 'mob') combat.label(e); // posture bar
    if (e.kind === 'player') { const c = state.party && e.party === state.party ? 'party' : 'ally'; if (c !== e.label.side) { e.label.side = c; e.label.el.classList.toggle('party', c === 'party'); e.label.el.classList.toggle('ally', c === 'ally'); } }
    else if (e.def.elite && !e.label.el.classList.contains('elite')) e.label.el.classList.add('elite');
    const isSel = (e.kind === 'mob' ? state.lock : state.focus) === e.id;
    e.label.el.classList.toggle('sel', !!isSel);
    const nm = e.kind === 'player' && !state.spectator && isSel && d <= 20 ? state.roster.get(e.id)?.named : null; // a selected Named close by: Talk (I3)
    if (nm && !e.label.talk) { const b = e.label.talk = document.createElement('button'); b.className = 'talk'; b.textContent = 'Talk'; b.onclick = ev => { ev.stopPropagation(); talkTo(e.name, send); }; e.label.el.appendChild(b); }
    if (e.label.talk) e.label.talk.style.display = nm ? '' : 'none';
    e.label.el.classList.toggle('hov', !isSel && hovered === e);
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
  for (const m of mobs.values()) { const d = Math.hypot(m.x - ax, m.z - az); if (d < fd + (m.def?.boss ? 10 : 0)) { fd = d; foe = m; } }
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
  const big = !!foe?.def?.boss;
  state.camDist += ((big ? 19 : foe ? 14 : 13) - state.camDist) * Math.min(1, dt * 1.5);
  state.pitch += ((big ? 0.62 : 0.5) - state.pitch) * Math.min(1, dt * 1.5);
  state.x = spec.x; state.z = spec.z;
  return [spec.x, spec.z];
}

let hitStop = 0;
let sentLock = 0; // the locked mob last reported to the server (`target`)
const projFx = new Map(); // thorn id -> effect
let visLag = 0; // ms the drawn characters lag the snapshot clock (slow motion / hit-stop), eased back to 0 afterwards
const camDir = new THREE.Vector3(), camFrom = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now(), gap = now - last;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  hitStop = Math.max(0, hitStop - dt);
  slowMo = Math.max(0, slowMo - dt);
  const vdt = hitStop > 0 ? 0 : slowMo > 0 ? dt * slowMoScale : dt; // visual dt: animation and effects only (frozen during a hit-stop)
  // the moment drawn for everyone else: ~100 ms behind the newest snapshot (shared/netsmooth.js)
  const rt = NOINTERP ? null : clock.renderTime(now);
  if (vdt < dt) visLag = Math.min(600, visLag + (dt - vdt) * 1000); else visLag *= Math.exp(-dt / 0.25);
  drawT = rt === null ? null : rt - visLag;
  frameNo++; entStats.interp = entStats.extrap = entStats.hold = 0;
  frustum.setFromProjectionMatrix(frM4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); // (last frame's camera)
  corr.step(dt * 1000);
  input.tick(); input.setContext('downedAlly', !!state.joined && revive.usesE()); // (pads polled here from K1b; E revives instead of turning)
  const lm = state.joined && !state.spectator ? lockedMob() : null;
  const la = !lm && state.joined && !state.spectator ? focusedAlly() : null;
  const sel = lm || la;
  if (state.joined && !state.spectator && (state.lock || 0) !== sentLock) { sentLock = state.lock || 0; send({ type: 'target', id: sentLock }); } // party bots assist your target
  if (cursorPanelOpen()) freeCursor();
  if (settings.camera === 'classic' && state.joined && !state.spectator && !isTouch && mouse.inside && mouse.onCanvas && drag.id === null && document.activeElement !== $('chat-input')) {
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
    selArrow.visible = true; selArrow.material.color.setHex(lm ? 0xfbbf24 : 0x4ade80);
    selArrow.position.set(gp.x, gp.y + sel.model.height + 2.3 + Math.sin(now / 180) * 0.15, gp.z); selArrow.rotation.y += dt * 2.5;
  } else { lockRing.visible = false; selArrow.visible = false; }
  // Mouse look: preview what Ctrl+click would select under the crosshair.
  // Hold Ctrl to preview what a click would select (crosshair in mouse look, cursor otherwise).
  const ctrlHeld = input.armed('selectAimed'); // (Ctrl / Cmd down)
  hovered = !ctrlHeld || !state.joined || state.spectator ? null : locked() ? pickAim()?.ent || null : mouse.inside ? pickAt(mouse.x, mouse.y)?.ent || null : null;
  $('crosshair').className = hovered ? (hovered.kind === 'mob' ? 'foe' : 'ally') : '';
  updateTargetFrame(sel, !!lm);

  if (state.joined && !state.dead && !state.spectator && !arenas.frozen()) { // (frozen: falling / landing in a boss arena)
    // movement input
    let ix = 0, iz = 0;
    const typing = document.activeElement === $('chat-input') || gmenu.isOpen(); // (the Game Menu blocks movement too)
    if (!typing) {
      const mv = input.axis('move'); ix += mv.x; iz += mv.y;
      if (input.held('turnLeft')) state.yaw += dt * 2;
      if (input.held('turnRight')) state.yaw -= dt * 2; // (not while E revives: a downed partymate in reach)
    }
    if (stick.active && !gmenu.isOpen()) { ix += stick.dx; iz -= stick.dy; }
    const mag = Math.min(1, Math.hypot(ix, iz));
    state.moveDir = null;
    if (mag > 0.08) {
      const fy = state.yaw;
      const mx = Math.sin(fy) * iz - Math.cos(fy) * ix, mz = Math.cos(fy) * iz + Math.sin(fy) * ix;
      state.moveDir = Math.atan2(mx, mz);
    }
    const airborne = state.air && performance.now() - state.jumpPress < JUMP.time * 1000;
    if (state.air && (!airborne || state.roll)) { state.speed = Math.hypot(state.air.x, state.air.z); state.air = null; } // landed (or rolled)
    if (state.roll) {
      const step = Math.min(state.roll.left, dt) * (DODGE.dist / DODGE.time);
      state.roll.left -= dt;
      let [nx, nz] = resolveCollision(state.x + Math.sin(state.roll.dir) * step, state.z + Math.cos(state.roll.dir) * step);
      if (walkable(nx, nz, !state.gateOpen)) { state.x = nx; state.z = nz; }
      if (state.roll.left <= 0) state.roll = null;
    } else if (airborne) { // in the air: keep your momentum, steer a little weaker than on the ground (shared airStep)
      let dx = 0, dz = 0;
      if (mag > 0.08) { const fy = state.yaw; dx = Math.sin(fy) * iz - Math.cos(fy) * ix; dz = Math.cos(fy) * iz + Math.sin(fy) * ix; const l = Math.hypot(dx, dz); dx /= l; dz /= l; }
      const sprint = performance.now() - state.lastCombat > SPRINT_AFTER * 1000 && !combat.guarding;
      airStep(state.air, dx, dz, (sprint ? SPRINT_SPEED : PLAYER_SPEED) * mag * combat.speedMult() * talents.speedMult() * arenas.speedMult(), dt);
      let [nx, nz] = resolveCollision(state.x + state.air.x * dt, state.z + state.air.z * dt);
      const gc = !state.gateOpen;
      if (!walkable(nx, nz, gc)) { if (walkable(nx, state.z, gc)) nz = state.z; else if (walkable(state.x, nz, gc)) nx = state.x; else { nx = state.x; nz = state.z; } }
      state.x = nx; state.z = nz;
      if (mag > 0.08) state.face = state.yaw;
    } else if (mag > 0.08) {
      const fy = state.yaw;
      const fwd = [Math.sin(fy), Math.cos(fy)], right = [-Math.cos(fy), Math.sin(fy)];
      let mx = fwd[0] * iz + right[0] * ix, mz = fwd[1] * iz + right[1] * ix;
      const ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
      const sprint = performance.now() - state.lastCombat > SPRINT_AFTER * 1000 && !combat.guarding;
      const want = revive.crawlCap((sprint ? SPRINT_SPEED : PLAYER_SPEED) * mag * combat.speedMult() * talents.speedMult() * arenas.speedMult(), mag); // (sludge: arenas.js) // half speed while guarding; talents can add move speed; downed: crawl
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
      state.x = nx; state.z = nz; state.vel = [mx * state.speed, mz * state.speed]; // (the momentum a jump carries)
      state.face = state.yaw; // keep looking where the camera looks: S walks backwards, A/D strafe (also under camera lock)
    } else { state.speed = 0; state.vel = null; }
    if (attackHeld && !state.roll && !gmenu.isOpen()) useSkill(0);
    combat.frame(); // guarding: face the enemy, drop the guard on a roll
  }

  if (state.joined && !state.spectator && now - sendT >= 1000 / TICK_RATE) {
    sendT = now;
    send({ type: 'input', x: +state.x.toFixed(2), z: +state.z.toFixed(2), face: +state.face.toFixed(2), seq: state.seq });
  }

  for (const e of players.values()) animateEntity(e, e.id === state.myId ? dt : vdt); // your own character stays responsive
  threat.frame(now); // threat markers follow the animated models
  for (const e of mobs.values()) animateEntity(e, vdt);
  fx.update(vdt);
  crystal.rotation.y += vdt;
  gateMesh.update(vdt);
  f2.update(vdt);
  f3.update(vdt);
  arenas.frame(vdt);
  if (merchantNpc?.anim) merchantNpc.anim.update(vdt);
  smith.frame(vdt);
  ground.frame(vdt, isTouch);
  mastery.frame(vdt, now); // Skill Shrines, evolved-skill auras
  classesA.frame(vdt, now); // arrows, marks, Rage bars
  talents.frame(now); // Skill Tree window refresh, unspent-points badge
  if (state.joined && !state.spectator) {
    const ml = $('merchant-lbl'), mp = project(MERCHANT.x, 3.6, MERCHANT.z), md = Math.hypot(state.x - MERCHANT.x, state.z - MERCHANT.z);
    if (mp && md < 20) {
      ml.style.display = ''; ml.style.left = `${mp[0]}px`; ml.style.top = `${mp[1]}px`;
      const html = `Merchant${md < MERCHANT.r + 1 ? `<br><small>${isTouch ? 'tap Trade' : 'press F to trade'}</small>` : ''}`;
      if (ml.innerHTML !== html) ml.innerHTML = html;
    } else if (ml.style.display !== 'none') ml.style.display = 'none';
    updateHallLabel();
  }

  // camera
  const me = players.get(state.myId);
  let cx = me ? me.model.group.position.x : 0, cz = me ? me.model.group.position.z : 30;
  if (state.spectator) [cx, cz] = spectatorCamera(dt);
  const cp = state.pitch;
  // pull the camera in when a wall or pillar is between it and the player
  const dir = camDir.set(-Math.sin(state.yaw) * Math.cos(cp), Math.sin(cp), -Math.cos(state.yaw) * Math.cos(cp));
  ray.set(camFrom.set(cx, 1.6, cz), dir); ray.far = state.camDist;
  const hit = ray.intersectObjects(occluders, true)[0];
  const allowed = hit ? Math.max(2, hit.distance - 0.6) : state.camDist;
  camCur += (allowed - camCur) * Math.min(1, dt * (allowed < camCur ? 20 : 3));
  const cd = camCur * (slowMo > 0 ? 1 - 0.22 * Math.sin(Math.PI * (1 - slowMo / slowMoLen)) : 1); // killing-blow zoom
  shakeAmt = Math.max(0, shakeAmt - dt);
  const sx = (Math.random() - 0.5) * shakeAmt, sy = (Math.random() - 0.5) * shakeAmt;
  const ly = arenas.camLift(); // (falling with your character)
  camera.position.set(cx - Math.sin(state.yaw) * Math.cos(cp) * cd + sx, 1.6 + ly + Math.sin(cp) * cd + sy, cz - Math.cos(state.yaw) * Math.cos(cp) * cd);
  camera.lookAt(cx, 1.6 + ly, cz);
  const cf = cine.frame(dt, cx, cz); if (cf) [cx, cz] = cf; // film view: the director's shot takes over
  if (!state.joined) { // slow orbit behind the login screen
    state.yaw += dt * 0.08;
    camera.position.set(Math.sin(state.yaw) * 40, 22, 30 + Math.cos(state.yaw) * 40);
    camera.lookAt(0, 2, 30);
  }
  sun.position.set(cx + 30, 60, cz - 20); sun.target.position.set(cx, 0, cz);
  floor1.visible = floorOf(cx) === 1; // Floor 1's town, field, chamber and skyline (incl. the tower spire) aren't drawn from Floors 2 and 3
  if (state.joined) treeFader.update(dt, camera.position, cx, cz);
  twists.frame(vdt, cx, cz); // Eclipse darkness
  sfx.listener.x = cx; sfx.listener.z = cz;

  drawFloats(dt, vdt);
  bubbles.frame();
  revive.frame(keys); // downed overlay, revive prompt, downed markers
  teamplay.frame(); // combo chain counters over targets

  if (state.joined) updateHud(now);
  updateRareHint(now);
  bell.before(camera); // the Tower Bell's camera sway, undone after the render
  const fogN = scene.fog.near, fogF = scene.fog.far; // draw distance (graphics quality): scaled for the render only
  scene.fog.near *= Q.fog; scene.fog.far *= Q.fog;
  renderer.render(scene, camera);
  scene.fog.near = fogN; scene.fog.far = fogF;
  bell.after(camera);
  perf.frame(now, gap, performance.now() - t0, entStats);
}
requestAnimationFrame(frame);

// handy for debugging from the console
window.__fb = { input, panels, state, players, mobs, looks, banner, sfx, project, floatLog, cine, camera, bubbles, threat, mvp, send: m => send(m), renderer, scene, perf, clock, netStats, Q, applyQuality };
