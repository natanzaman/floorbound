// Bot personalities (docs/briefs/personalities.md, shared/bots/personality.js + shared/bots/idle.js).
// Unit checks: the same name always rolls the same personality, traits stay in range, archetypes spread, a picked
// archetype keeps the name's jitter, BOT_PERSONA=0 / 'neutral' gives the old numbers, the brain's dials stay bounded,
// voices and chattiness, idle habits never run in a fight and do run when settled.
// Live (skip with NO_LIVE=1): a server on PORT (default 3741), a human standing still in town with a party of three
// personality bots, then another human with three neutral bots, LIVE_S seconds each (default 35): the personality bots
// look around (face changes while settled), keep their own formation spots, may hop or sit; the neutral ones never do.
// Usage: node test/personality.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { rollPersonality, ARCHETYPES, ARCHETYPE_IDS, TRAITS, NEUTRAL, describePersona, potionShift, backOffAt, tankWait, chatScale, formation, VOICE, JITTER } from '../shared/bots/personality.js';
import { idleOk, idleBegin, idleHabits, idleMoved, idleEvent, afkNow } from '../shared/bots/idle.js';
import { voiced, pick } from '../shared/bots/social.js';
import { startTeam } from '../shared/teambots.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }

// ---------- rolls ----------
const a1 = rollPersonality('Rook'), a2 = rollPersonality('rook'), c = rollPersonality('Wren');
ok(JSON.stringify(a1) === JSON.stringify(a2), 'the same name (any case) rolls the same personality');
ok(ARCHETYPES[a1.id] && ARCHETYPES[c.id], `rolls land on archetypes (Rook: ${a1.name}, Wren: ${c.name})`);
const counts = {};
let inRange = true, jitterOk = true;
for (let i = 0; i < 4000; i++) {
  const p = rollPersonality(`Bot${i}`);
  counts[p.id] = (counts[p.id] || 0) + 1;
  for (const k of TRAITS) {
    if (!(p.t[k] >= 0 && p.t[k] <= 1)) inRange = false;
    if (Math.abs(p.t[k] - ARCHETYPES[p.id].t[k]) > JITTER + 0.006) jitterOk = false;
  }
}
ok(inRange && jitterOk, `4000 rolls: every trait in 0..1, within ±${JITTER} of its archetype`);
const total = ARCHETYPE_IDS.reduce((s, k) => s + ARCHETYPES[k].w, 0);
ok(ARCHETYPE_IDS.every(k => Math.abs(counts[k] / 4000 - ARCHETYPES[k].w / total) < 0.03), `archetypes spread by weight: ${ARCHETYPE_IDS.map(k => `${k} ${counts[k]}`).join(', ')}`);
const j = rollPersonality('Rook', 'joker');
ok(j.id === 'joker' && j.t.playfulness >= 0.8 && JSON.stringify(rollPersonality('Rook', 'joker')) === JSON.stringify(j), 'a picked archetype is used, with the name\'s own (stable) jitter');
process.env.BOT_PERSONA = '0';
ok(rollPersonality('Rook') === NEUTRAL && rollPersonality('Rook', 'joker') === NEUTRAL, 'BOT_PERSONA=0: every bot neutral, even a picked archetype');
delete process.env.BOT_PERSONA;
ok(rollPersonality('Rook', 'neutral') === NEUTRAL && rollPersonality('Rook', 'nonsense').id in ARCHETYPES, "'neutral' gives the neutral profile; an unknown pick falls back to the roll");
ok(/^Joker: playful/.test(describePersona(j)) && describePersona(NEUTRAL).startsWith('Neutral'), `describePersona: "${describePersona(j)}"`);

// ---------- the brain's dials ----------
const bot = id => ({ persona: rollPersonality('X', id), t: 0, skill: 4 });
const neu = { persona: NEUTRAL };
ok(potionShift(neu) === 0 && backOffAt(neu) === 0.3 && tankWait(neu) === 1.2 && chatScale(neu) === 1 && formation(neu).r === 3 && formation(neu).ang === 0, 'neutral: the old numbers (potions, back-off 0.3, tank wait 1.2 s, chat x1, formation 3 m)');
ok(backOffAt(bot('hothead')) === 0.15 && backOffAt(bot('careful')) > 0.3 && potionShift(bot('careful')) > 0.04 && potionShift(bot('hothead')) < -0.03, 'a hothead backs off only below 15% HP; a careful bot backs off and drinks earlier');
ok(tankWait(bot('hothead')) < 1 && tankWait(bot('careful')) > 1.4, 'a hothead barely waits for the tank; a careful one waits longer');
ok(chatScale(bot('quiet')) < 0.6 && chatScale(bot('chatterbox')) > 1.2, 'a quiet bot chats under 0.6x, a chatterbox over 1.2x');
let dialsOk = true;
for (let i = 0; i < 500; i++) {
  const b = { persona: rollPersonality(`D${i}`) };
  if (Math.abs(potionShift(b)) > 0.081 || backOffAt(b) < 0.15 || backOffAt(b) > 0.361 || tankWait(b) < 0.6 || tankWait(b) > 1.8 || formation(b).r < 2.6 || formation(b).r > 4.6) dialsOk = false;
}
ok(dialsOk, '500 rolls: potion ±0.08, back-off 0.15-0.36, tank wait 0.6-1.8 s, formation 2.6-4.6 m');

// ---------- voices ----------
const jb = { name: 'Pip', persona: rollPersonality('Pip', 'joker') };
const lines = new Set(Array.from({ length: 200 }, () => voiced(jb, 'wipe', { name: 'Pip' })));
ok(VOICE.joker.wipe.some(l => lines.has(l)) && [...lines].some(l => !VOICE.joker.wipe.includes(l)), 'a joker mixes its own wipe lines with the stock ones');
const nv = { name: 'Pip', persona: { ...rollPersonality('Pip', 'joker'), noVoice: true } };
ok(Array.from({ length: 100 }, () => voiced(nv, 'wipe', {})).every(l => !VOICE.joker.wipe.includes(l)), 'noVoice (the Named): stock lines only');
ok(typeof pick('greet', { role: 'tank', name: 'A' }) === 'string', 'stock pick still works');

// ---------- idle habits on a stand-in bot ----------
function fake(id) {
  const sent = [];
  return { sent, b: { name: 'Sim', persona: id ? rollPersonality('Sim', id) : NEUTRAL, me: { lvl: 5 }, t: 0, dt: 0.05, x: 0, z: 30, face: 0, dead: false, tele: [], players: [], send: m => sent.push(m) } };
}
const P = { all: [{ id: 2, x: 2, z: 32, dead: false }], humans: [{ id: 2 }] };
{
  const { b, sent } = fake('joker');
  let faces = new Set();
  for (let i = 0; i < 3200; i++) { b.t = i * 0.05; idleBegin(b); idleHabits(b, P); faces.add(b.face.toFixed(2)); if (b.idle.sit) idleMoved(b); } // 160 s settled (stood up again whenever it sits)
  ok(faces.size > 10, `settled 160 s: a joker looks around (${faces.size} different facings)`);
  ok(sent.some(m => m.type === 'jump'), `a joker hops when idle (${sent.filter(m => m.type === 'jump').length} hops in 160 s)`);
  console.log(`  (sat after a long wait: ${sent.some(m => m.text === '/sit') ? 'yes' : 'not this time, it is random'})`);
  const before = sent.length;
  b.tele = [{ x: 0, z: 30, r: 3 }];
  for (let i = 0; i < 200; i++) { b.t = 80 + i * 0.05; idleBegin(b); idleHabits(b, P); }
  ok(sent.length === before && !idleOk(b), 'nothing while a telegraph is down');
  b.tele = []; b.duel = { id: 1 };
  ok(!idleOk(b), 'nothing in a duel'); b.duel = null;
  b.script = {}; ok(!idleOk(b), 'nothing for a scripted actor'); b.script = null;
  b.x = 0; b.z = 200; // (the Warden's arena)
  ok(!idleOk(b), 'nothing in a boss room');
}
{
  // hop-back: only at a human's hop, at most once per 4 s, and never bot-to-bot ping-pong
  const { b, sent } = fake('joker');
  b.players = [{ id: 2, x: 2, z: 32 }, { id: 3, x: 1, z: 31 }];
  const helpers = { isBot: (_, id) => id === 3, mateOf: () => true };
  let hops = 0;
  for (let i = 0; i < 1200; i++) {
    b.t = i * 0.05; b.idle && (b.idle.hopT = 1e9); // (its own random hops off: count answers only)
    if (i % 10 === 0) idleEvent(b, { t: 'jump', id: 3 }, helpers); // a bot hopping every 0.5 s
    idleBegin(b); idleHabits(b, P);
  }
  hops = sent.filter(m => m.type === 'jump').length;
  ok(hops === 0, 'never hops back at a bot (no ping-pong between bots)');
  for (let i = 1200; i < 2400; i++) {
    b.t = i * 0.05;
    if (i % 10 === 0) idleEvent(b, { t: 'jump', id: 2 }, helpers); // a human hopping every 0.5 s for 60 s
    idleBegin(b); idleHabits(b, P); if (b.idle.sit) idleMoved(b); // (kept standing: a seated bot doesn't hop)
  }
  hops = sent.filter(m => m.type === 'jump').length;
  ok(hops > 0 && hops <= 15, `hops back at a human at most once per 4 s (${hops} in 60 s)`);
}
{
  // a bow straightens up after a moment
  const { b, sent } = fake('chatterbox');
  b.persona = { ...b.persona, t: { ...b.persona.t, sociability: 1 } };
  b.party = 7;
  for (let k = 0; k < 20 && !b.idle?.bowQ.length; k++) idleEvent(b, { t: 'pjoin', id: 2, party: 7 }, { isBot: () => false, mateOf: () => true });
  for (let i = 0; i < 100; i++) { b.t = i * 0.05; idleBegin(b); idleHabits(b, P); }
  const bow = sent.findIndex(m => m.text === '/bow'), stand = sent.findIndex(m => m.text === '/stand');
  ok(bow >= 0 && stand > bow, 'bows to a human who joins, then straightens up');
}
{
  const { b, sent } = fake(null);
  for (let i = 0; i < 1600; i++) { b.t = i * 0.05; idleBegin(b); idleHabits(b, P); }
  ok(sent.length === 0 && b.face === 0 && !idleOk(b), 'a neutral bot does nothing extra (no hops, sits or looking around)');
  ok(!afkNow(b, false), 'a neutral bot never goes AFK');
}
{
  let afk = 0;
  for (let k = 0; k < 200; k++) {
    const { b } = fake('explorer');
    for (let i = 0; i < 1200 * 10; i += 20) { b.t = i * 0.05; if (afkNow(b, false)) { afk++; break; } } // 10 min each
  }
  const { b } = fake('explorer');
  let withHuman = false;
  for (let i = 0; i < 12000; i += 20) { b.t = i * 0.05; if (afkNow(b, true)) withHuman = true; }
  ok(afk > 5 && afk < 150 && !withHuman, `AFK: ${afk} of 200 free explorers took a break within 10 min; never with a human in the party`);
}
{
  const { b, sent } = fake('steady');
  idleBegin(b); b.t = 30; idleBegin(b); // a fresh spell after a gap: the clock restarts
  b.t = 30.05; idleBegin(b); idleMoved(b);
  ok(b.idle.still === b.t && !b.idle.sit, 'moving resets the still clock and stands the bot up');
  void sent;
}

// ---------- live ----------
if (process.env.NO_LIVE) { console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed (live part skipped)`); process.exit(failed ? 1 : 0); }
const PORT = Number(process.env.PORT) || 3741, LIVE_S = Number(process.env.LIVE_S) || 35;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const env = { ...process.env, PORT: String(PORT), DATABASE_URL: '', NAMED_ENABLED: '0', AI_PROVIDER: '' };
const srv = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
const stop = code => { try { srv.kill(); } catch {} process.exit(code); };
try {
  for (let i = 0; i < 150; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(200); } } // (up once it answers)
  const url = `ws://localhost:${PORT}/ws`;
  function human(name) {
    const h = { name, id: 0, events: [], snaps: [], ws: new WebSocket(url) };
    h.ws.on('open', () => h.ws.send(JSON.stringify({ type: 'join', name, cls: 'swordsman' })));
    h.ws.on('message', d => {
      const m = JSON.parse(d.toString());
      if (m.type === 'welcome') h.id = m.id;
      if (m.type === 'snap') { h.last = m; for (const e of m.w.events || []) { h.events.push(e); if (e.t === 'invite' && e.to === h.id) h.ws.send(JSON.stringify({ type: 'accept', from: e.from })); } }
    });
    return h;
  }
  const mk = (names, personas) => {
    const { team } = startTeam({ url, WebSocket, roles: ['guardian', 'ranger', 'cleric'], names, inviteHumans: true, behaviour: 'follow', skill: 4 });
    team.forEach((b, i) => b.setPersona(personas[i]));
    return team;
  };
  // one human and one team at a time (bots on plain sockets look human to each other's hosts)
  async function round(hName, names, personas) {
    const h = human(hName);
    await sleep(800);
    const team = mk(names, personas), faces = new Map(), t0 = Date.now();
    while (Date.now() - t0 < LIVE_S * 1000) {
      await sleep(250);
      for (const b of team) { const s = faces.get(b.name) || new Set(); if (Date.now() - t0 > 12000 && b.mode === 'follow' && !b.tgtId && b.party) s.add(b.face.toFixed(2)); faces.set(b.name, s); } // (from 12 s in: settled in formation)
    }
    const ids = new Set(team.map(b => b.id)), mine = t => h.events.filter(e => e.t === t && ids.has(e.id));
    console.log(`  live: ${team.map(b => `${b.name} ${b.persona.name} anchor ${b.anchor?.name} facings ${faces.get(b.name).size}`).join(' · ')}; hops ${mine('jump').length}, poses ${mine('pose').map(e => e.k).join(' ') || 'none'}`);
    const r = { team, faces, inParty: team.every(b => b.party && b.anchor?.name === hName), hops: mine('jump').length, poses: mine('pose').length };
    for (const b of team) b.stop();
    h.ws.close();
    await sleep(500);
    return r;
  }
  const A = await round('Alice', ['Pip', 'Ode', 'Mae'], ['joker', 'explorer', 'careful']);
  const B = await round('Bert', ['Tam', 'Rue', 'Kit'], ['neutral', 'neutral', 'neutral']);
  ok(A.inParty && B.inParty, 'each team joined its human and follows them');
  ok(A.team.filter(b => A.faces.get(b.name).size > 4).length >= 2, 'personality bots look around while the party waits');
  ok(B.team.every(b => B.faces.get(b.name).size <= 3), 'neutral bots stand facing one way');
  ok(B.hops === 0 && B.poses === 0, 'neutral bots never hop or sit');
} catch (err) { console.error(err); failed++; }
console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
stop(failed ? 1 : 0);
