// Role-playing bot party, shared by the Node runner (test/team.js) and the in-browser page (/bots.html).
//
// Tank (Guardian)  leads, picks targets, opens with Taunt, keeps aggro, Shield Walls when low.
// DPS (Swordsman)  waits for the tank to grab aggro, then attacks from behind the target.
// Healer (Cleric)  hangs back behind the tank, heals whoever is hurt, buffs, smites when idle.
// Everyone dodge-rolls out of the boss's red circles and plays Break -> Switch.
// The Warden's perilous Horn Sweep: DPS and healer roll through it at the last moment (a perfect dodge), the tank parries it.
// A fresh (low-level) party warms up on boars before taking on wolves.
// Skill evolutions: when a skill reaches Mastery 3 the bot picks a branch (`branch`: 'A' / 'B', or random when unset).
// floor: 2 sends the party to Floor 2 (via a waystone once unlocked, or the Stairway after a Warden kill): they farm the
// Glimmering Mire until level 15, then take on the Drowned Sovereign (rolling through its Tidal Waves).
// Any set of roles works, including a single bot. Without a tank, or with a behaviour other than the classic
// progression ('auto' / 'floor2'), every bot runs the single-bot brain (actSolo): 'follow' a named player and fight
// alongside them, farm the 'field' near town, go fight the 'warden', or 'floor2'. Used by server/botmanager.js.
import { MOBS, MOB_IDS, PLAYER_SPEED, SPRINT_SPEED, DODGE, SWEEP, walkable, resolveCollision, inGateZone, inArena } from './data.js';
import { F2, WAYSTONES, STAIRWAY, SOVEREIGN, inGateZone2, inArena2, onFloor2, floorUnlocked } from './floor2.js';
import { MASTERY, BRANCHES, masteryLevel } from './mastery.js';
import { CLASS_BRAINS_B, TEAM_NAMES_B, botEventB } from './classes/bots-b.js';

export const TEAM_NAMES = { guardian: 'Brann', swordsman: 'Kael', cleric: 'Lyra' };
Object.assign(TEAM_NAMES, TEAM_NAMES_B); // Lancer, Bard (shared/classes/bots-b.js)

// names: optional name per role; join: extra fields for the join message (e.g. the server's bot key and a level).
export function startTeam({ url, WebSocket: WS = globalThis.WebSocket, roles = ['guardian', 'swordsman', 'cleric'], suffix = '', inviteHumans = false, log = () => {}, floor = 1, branch = null, names = null, join = {}, behaviour = 'auto', follow = '' }) {
  if (behaviour === 'floor2') floor = 2;
  const ROSTER = roles.map((c, i) => [c, names?.[i] || TEAM_NAMES[c] + suffix]);
  const DT = 0.05;
  const send = (b, o) => b.ws.readyState === 1 && b.ws.send(JSON.stringify(o));
  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  const team = ROSTER.map(([cls, name], i) => {
    const b = { i, cls, name, id: 0, x: 0, z: 0, seq: 0, face: 0, t: 0, mobs: [], players: [], me: null, dead: false, hp: 1, maxHp: 1, tele: [], fresh: false, cds: [0, 0, 0, 0], dodgeCd: 0, roll: null, stag: {}, waves: [], orbs: [], pools: [], life: null };
    b.ws = new WS(url);
    b.ws.addEventListener('open', () => send(b, { type: 'join', name, cls, ...join }));
    b.ws.addEventListener('close', () => { b.closed = true; if (team.every(x => x.closed)) { clearInterval(formParty); clearInterval(inviteLoop); } });
    b.ws.addEventListener('error', () => {}); // (Node's ws throws on an unhandled error event)
    b.ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.type === 'welcome') Object.assign(b, { id: msg.id, x: msg.x, z: msg.z, seq: msg.seq });
      if (msg.type === 'inv') b.life = msg.life;
      if (msg.type === 'mastery') { // evolve any skill that reached Mastery 3
        b.mastery = msg.m;
        for (const [sk, e] of Object.entries(msg.m)) {
          if (e.br || masteryLevel(e.pts) < MASTERY.evolveAt || b.asked?.[sk]) continue;
          const br = branch === 'A' || branch === 'B' ? branch : Math.random() < 0.5 ? 'A' : 'B';
          (b.asked ||= {})[sk] = br;
          send(b, { type: 'evolve', sk, br });
          log(`[evolve] ${b.name}: ${sk} -> ${BRANCHES[sk][br].name}`);
        }
      }
      if (msg.type === 'roster') b.roster = msg.players;
      if (msg.type !== 'snap') return;
      b.t += DT;
      b.me = msg.me;
      b.cds = msg.me.cds.map((c, k) => (b.t - (b.pressed?.[k] || -9) < 0.3 ? Math.max(c, 0.2) : c));
      if (b.t - (b.dodgePressed || -9) > 0.3) b.dodgeCd = msg.me.dodge || 0;
      b.mobs = msg.w.mobs.map(m => ({ id: m[0], type: MOB_IDS[m[1]], x: m[2], z: m[3], hp: m[5], maxHp: m[6], engaged: !!(m[7] & 2), enraged: !!(m[7] & 4), winding: !!(m[7] & 16), staggered: !!(m[7] & 32), def: MOBS[MOB_IDS[m[1]]] }));
      const f2 = msg.w.f2;
      b.gateOpen = onFloor2(b.x) ? !!f2?.gate?.[0] : !!msg.w.gate?.[0];
      b.orbs = f2?.orbs || []; b.pools = f2?.pools || []; b.deluge = !!f2?.del;
      b.players = msg.w.players.map(p => ({ id: p[0], x: p[1], z: p[2], hp: p[4], maxHp: p[5], party: p[8], dead: !!p[9] }));
      const mine = b.players.find(p => p.id === b.id);
      if (mine) Object.assign(b, { hp: mine.hp, maxHp: mine.maxHp, dead: mine.dead, party: mine.party });
      for (const e of msg.w.events) {
        if (e.t === 'tp' && e.id === b.id) { b.x = e.x; b.z = e.z; b.seq = e.s; }
        if (e.t === 'invite' && e.to === b.id) send(b, { type: 'accept', from: e.from });
        if (e.t === 'stagger') b.stag[e.id] = { by: e.by, until: b.t + e.d };
        if (b.i === 0 && (e.t === 'switch' || e.t === 'stagger')) log(`[${e.t}] mob ${e.id} by ${e.by}`);
        if (e.t === 'tele' && e.k === 'sweep') { b.sweep = { at: b.t + e.d, id: e.follow }; if (b.i === 0) log(`[sweep] Horn Sweep incoming`); continue; }
        if (e.t === 'pcancel') b.sweep = null;
        if (b.i === 0 && (e.t === 'perfect' || e.t === 'parry')) log(`[${e.t}] by ${e.id}`);
        if (e.t === 'tele') b.tele.push({ x: e.x, z: e.z, r: e.r, until: b.t + e.d + 0.2, follow: e.follow, line: e.k === 'line' ? [e.x2, e.z2, e.w] : null });
        if (b.i === 0 && e.t === 'sys' && !e.to) log(`[sys] ${e.text}`);
        if (e.t === 'f2wave') b.waves.push({ x: e.x, z: e.z, start: b.t + e.d, sp: e.sp, w: e.w, max: e.max });
        if (e.t === 'stair') b.stair = { x: e.x, z: e.z, until: b.t + e.d };
        botEventB(b, e); // Lancer / Bard bots (Discord stacks)
      }
      b.fresh = true;
      tick();
    });
    return b;
  });
  const tank = team.find(b => b.cls === 'guardian'), dps = team.find(b => b.cls === 'swordsman'), healer = team.find(b => b.cls === 'cleric');
  const invited = new Set();

  // The tank forms the party once everyone is in.
  const formParty = setInterval(() => {
    if (!tank) return clearInterval(formParty);
    if (!team.every(b => b.id || b.closed)) return;
    clearInterval(formParty);
    for (const b of team) if (b !== tank && b.id) { send(tank, { type: 'invite', id: b.id }); invited.add(b.id); }
  }, 100);
  // ...and, if asked, any human who shows up gets an invite too.
  const inviteLoop = setInterval(() => {
    if (!inviteHumans || !tank) return;
    for (const p of tank.players) if (!invited.has(p.id) && !team.some(b => b.id === p.id)) { invited.add(p.id); send(tank, { type: 'invite', id: p.id }); }
  }, 1000);

  function useSkill(b, slot, face) {
    if (b.cds[slot] > 0 || (slot === 3 && b.me.lvl < 3)) return false;
    send(b, { type: 'skill', slot, face: face ?? b.face });
    b.cds[slot] = 1; (b.pressed ||= [])[slot] = b.t;
    return true;
  }

  // Roll out of danger if the dodge is ready; otherwise just run.
  function evade(b, tx, tz) {
    if (b.roll) return;
    if (b.dodgeCd <= 0 && !waveSoon(b, 1.4)) {
      const dir = Math.atan2(tx - b.x, tz - b.z);
      b.roll = { left: DODGE.time, dir }; b.face = dir;
      b.dodgeCd = DODGE.cd; b.dodgePressed = b.t;
      send(b, { type: 'dodge', face: dir });
    } else moveToward(b, tx, tz);
  }

  function stepRoll(b) {
    if (!b.roll) return false;
    const step = Math.min(b.roll.left, DT) * (DODGE.dist / DODGE.time);
    b.roll.left -= DT;
    const [nx, nz] = resolveCollision(b.x + Math.sin(b.roll.dir) * step, b.z + Math.cos(b.roll.dir) * step);
    if (walkable(nx, nz, !b.gateOpen)) { b.x = nx; b.z = nz; }
    if (b.roll.left <= 0) b.roll = null;
    return true;
  }

  // Is the target broken by a teammate (i.e. it's my turn to Switch in)?
  const switchOpen = (b, m) => m?.staggered && b.stag[m.id] && b.stag[m.id].by !== b.id && b.stag[m.id].until > b.t;

  function moveToward(b, tx, tz, stop = 0.4, speed = PLAYER_SPEED) {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d <= stop) return false;
    const step = Math.min(d - stop, speed * DT);
    let nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
    [nx, nz] = resolveCollision(nx, nz);
    if (!walkable(nx, nz, !b.gateOpen)) return false;
    b.x = nx; b.z = nz; b.face = Math.atan2(dx, dz);
    return true;
  }

  // Floor 2: seconds until the next Tidal Wave reaches us (Infinity if none).
  function waveEta(b) {
    let best = Infinity;
    for (const w of b.waves) {
      const r = (b.t - w.start) * w.sp, d = d2(b.x, b.z, w.x, w.z);
      if (r - w.w > d) continue; // already past us
      best = Math.min(best, (d - r - w.w) / w.sp);
    }
    return best;
  }
  const waveSoon = (b, secs) => waveEta(b) < secs;
  // Roll INTO the wave just before it arrives: the i-frames carry us through.
  function waveDodge(b) {
    b.waves = b.waves.filter(w => (b.t - w.start) * w.sp < w.max);
    const eta = waveEta(b);
    if (eta > 0.22 || eta < -0.08 || b.roll || b.dodgeCd > 0) return false;
    const w = b.waves.find(w => { const r = (b.t - w.start) * w.sp; return r - w.w <= d2(b.x, b.z, w.x, w.z); });
    const dir = Math.atan2(w.x - b.x, w.z - b.z);
    b.roll = { left: DODGE.time, dir }; b.face = dir;
    b.dodgeCd = DODGE.cd; b.dodgePressed = b.t;
    send(b, { type: 'dodge', face: dir });
    return true;
  }

  // Point just outside any active telegraph circle we're standing in, or null.
  function dodgeSpot(b) {
    b.tele = b.tele.filter(t => t.until > b.t);
    if (onFloor2(b.x)) { // Floor 2 hazards: homing orbs, mire pools, the Deluge
      for (const [, ox, oz] of b.orbs) {
        const d = d2(b.x, b.z, ox, oz);
        if (d < 2.6) { const ux = (b.x - ox) / (d || 1), uz = (b.z - oz) / (d || 1); return [b.x - uz * 4, b.z + ux * 4]; }
      }
      for (const [, px, pz, r] of b.pools) {
        const d = d2(b.x, b.z, px, pz);
        if (d < r + 0.8) { const ux = d > 0.1 ? (b.x - px) / d : 1, uz = d > 0.1 ? (b.z - pz) / d : 0; return [px + ux * (r + 2), pz + uz * (r + 2)]; }
      }
      const A = F2.arena, dc = d2(b.x, b.z, A.x, A.z);
      if (b.deluge && inArena2(b.x, b.z) && dc > SOVEREIGN.deluge.r - 1) return [A.x + ((b.x - A.x) / dc) * 11, A.z + ((b.z - A.z) / dc) * 11];
    }
    for (const t of b.tele) {
      if (t.line) { // the Warden's charge lane: step sideways out of it
        const [x2, z2, w] = t.line, lx = x2 - t.x, lz = z2 - t.z, len = Math.hypot(lx, lz) || 1;
        const k = Math.max(0, Math.min(1, ((b.x - t.x) * lx + (b.z - t.z) * lz) / (len * len)));
        const px = t.x + lx * k, pz = t.z + lz * k, off = Math.hypot(b.x - px, b.z - pz);
        if (off < w + 1.2) {
          let nx = -lz / len, nz = lx / len;
          if ((b.x - px) * nx + (b.z - pz) * nz < 0) { nx = -nx; nz = -nz; }
          return [px + nx * (w + 3), pz + nz * (w + 3)];
        }
        continue;
      }
      let cx = t.x, cz = t.z;
      if (t.follow) { const m = b.mobs.find(m => m.id === t.follow); if (m) { cx = m.x; cz = m.z; } }
      const d = d2(b.x, b.z, cx, cz);
      if (d < t.r + 1.2) {
        const ux = d > 0.1 ? (b.x - cx) / d : 1, uz = d > 0.1 ? (b.z - cz) / d : 0;
        return [cx + ux * (t.r + 2.2), cz + uz * (t.r + 2.2)];
      }
    }
    return null;
  }

  // Horn Sweep (perilous): returns true when it takes over this bot's turn.
  function perilous(b) {
    const s = b.sweep;
    if (!s) return false;
    const left = s.at - b.t, m = b.mobs.find(m => m.id === s.id);
    if (left < -0.3 || !m) { // over: let go of the guard
      b.sweep = null;
      if (b.guardOn) { b.guardOn = false; send(b, { type: 'guard', on: false }); }
      return false;
    }
    if (left <= 0) return !!b.guardOn;
    const d = d2(b.x, b.z, m.x, m.z), away = Math.atan2(b.x - m.x, b.z - m.z);
    if (d > SWEEP.r + 1.5) return left < 1; // outside: don't walk in
    if (b.cls === 'guardian') { // parry: face it and raise the shield just before it lands
      if (left > 0.12) return false;
      b.face = Math.atan2(m.x - b.x, m.z - b.z);
      if (!b.guardOn) { b.guardOn = true; send(b, { type: 'guard', on: true }); }
      return true;
    }
    if (b.dodgeCd <= left - 0.1) { // roll through it at the last moment
      if (left > 0.15) return false;
      evade(b, b.x + Math.sin(away) * 5, b.z + Math.cos(away) * 5);
      return true;
    }
    moveToward(b, m.x + Math.sin(away) * (SWEEP.r + 2.5), m.z + Math.cos(away) * (SWEEP.r + 2.5)); // no roll: run out
    return true;
  }

  // Progression: boars until level 3, wolves until level 5, then the Warden.
  // Floor 2: farm the Mire until level 15, then the Sovereign.
  // b: the bot choosing (the tank by default); minBoss: the level to go for the boss at (0 = straight away).
  const F2_BOSS_LVL = 15;
  function pickTankTarget(b = tank, minBoss) {
    const lvl = b.me?.lvl || 1, f2 = onFloor2(b.x);
    minBoss ??= f2 ? F2_BOSS_LVL : 5;
    const boss = b.mobs.find(m => m.type === (f2 ? 'sovereign' : 'warden'));
    if (boss && b.z > 162 && lvl >= minBoss) return boss;
    const want = lvl >= minBoss ? null : f2 ? 'mire' : lvl < 3 ? 'boar' : 'wolf';
    let best = null, bd = 1e9;
    for (const m of b.mobs) {
      if (m.def.boss || onFloor2(m.x) !== f2) continue;
      const d = d2(m.x, m.z, b.x, b.z);
      const hunt = want === 'mire' ? m.type !== 'thrall' : m.type === want; // what we're farming right now
      const threat = m.engaged && d < 15;           // anything that's attacking us
      const inWay = want === null && d < 15 && (f2 || m.type === 'wolf' || m.engaged); // on the road to the boss
      if (!(hunt || threat || inWay)) continue;
      const score = d - (threat ? 100 : 0);
      if (score < bd) { bd = score; best = m; }
    }
    return best;
  }

  let targetId = null, engagedAt = null;

  function actTank() {
    const tgt = pickTankTarget();
    if (tgt?.id !== targetId) { targetId = tgt?.id ?? null; engagedAt = null; }
    const dodge = dodgeSpot(tank);
    const ox = onFloor2(tank.x) ? F2.x : 0; // Floor 2 mirrors Floor 1's layout, 600 m east
    if (!tgt && (tank.me?.lvl || 1) < (ox ? F2_BOSS_LVL : 5)) { moveToward(tank, ox, ox ? 70 : 60); return; } // nothing to farm nearby: head into the field
    if (!tgt) return travelToBoss(tank);
    const reach = tgt.def.radius + 1.6;
    const d = d2(tank.x, tank.z, tgt.x, tgt.z);
    if (dodge) evade(tank, ...dodge);
    else moveToward(tank, tgt.x, tgt.z, reach - 0.3);
    const face = Math.atan2(tgt.x - tank.x, tgt.z - tank.z);
    tank.face = dodge ? tank.face : face;
    if (d < 8.5 && engagedAt === null) { useSkill(tank, 1, face); engagedAt = tank.t; } // open with Taunt
    if (d < reach + 1.2) {
      if (engagedAt === null) engagedAt = tank.t;
      if (tank.hp / tank.maxHp < 0.6 || (tgt.enraged && dodge)) useSkill(tank, 2, face); // Shield Wall
      if (switchOpen(tank, tgt)) { useSkill(tank, 0, face); return; } // Switch in with Bash
      if (!tgt.staggered && useSkill(tank, 3, face)) return; // Ground Slam breaks it for Kael
      if (tank.t - engagedAt > 4) useSkill(tank, 1, face); // re-Taunt on cooldown
      useSkill(tank, 0, face);                       // Bash
    }
  }

  // Travel: get onto the road, then up to the chamber (waiting at the raid gate while it's shut).
  function travelToBoss(b) {
    const ox = onFloor2(b.x) ? F2.x : 0;
    if (!b.gateOpen && b.z > 120) { moveToward(b, ox, 154); return; } // wait at the raid gate
    if (b.z < 150 && Math.abs(b.x - ox) > 3) moveToward(b, ox, Math.min(150, b.z + 6));
    else if (b.z < 162) moveToward(b, ox, 172);
    else moveToward(b, ox, 182);
  }

  function currentTarget(b) { return targetId ? b.mobs.find(m => m.id === targetId) : null; }

  // Warden twist (Thornbound): a Thorn Totem is a spitter inside the chamber; the DPS breaks it first.
  const totemFor = b => b.mobs.filter(m => m.type === 'spitter' && inArena(m.x, m.z)).sort((a, c) => d2(a.x, a.z, b.x, b.z) - d2(c.x, c.z, b.x, b.z))[0];

  function actDps() {
    const tgt = (engagedAt !== null && totemFor(dps)) || currentTarget(dps);
    const dodge = dodgeSpot(dps);
    if (dodge) { evade(dps, ...dodge); return; }
    if (!tgt) { moveToward(dps, tank.x - 2.5, tank.z - 2.5, 1.2); return; }
    const ready = engagedAt !== null && tank.t - engagedAt > 1.2; // let the tank grab aggro first
    // stand on the far side of the target from the tank, out of its frontal swing
    const tx = tgt.x - tank.x, tz = tgt.z - tank.z, tl = Math.hypot(tx, tz) || 1;
    const reach = tgt.def.radius + 1.3;
    const spot = ready ? [tgt.x + (tx / tl) * reach, tgt.z + (tz / tl) * reach] : [tank.x - (tx / tl) * 4, tank.z - (tz / tl) * 4];
    moveToward(dps, spot[0], spot[1], 0.5);
    if (!ready) return;
    const face = Math.atan2(tgt.x - dps.x, tgt.z - dps.z);
    dps.face = face;
    const d = d2(dps.x, dps.z, tgt.x, tgt.z);
    if (d > reach + 1.6) return;
    const crowd = dps.mobs.filter(m => d2(m.x, m.z, dps.x, dps.z) < 4.5 + m.def.radius).length;
    if (switchOpen(dps, tgt) && useSkill(dps, 3, face)) return;            // Switch in with Burst Combo
    if (!tgt.staggered && tank.cds[3] > 6 && useSkill(dps, 3, face)) return; // or Burst to break it for Brann
    if ((crowd >= 2 || tgt.def.boss) && useSkill(dps, 2, face)) return; // Whirl
    useSkill(dps, 0, face);                                                 // Slash
  }

  function actHealer() {
    const tgt = currentTarget(healer);
    const dodge = dodgeSpot(healer);
    const mates = healer.players.filter(p => p.party && p.party === healer.party && !p.dead);
    const hurt = mates.filter(p => p.hp / p.maxHp < 0.78 && d2(p.x, p.z, healer.x, healer.z) < 15);
    const low = mates.filter(p => p.hp / p.maxHp < 0.7).length;
    if (dodge) evade(healer, ...dodge);
    else if (tgt) { // behind the tank, facing the fight
      const tx = tank.x - tgt.x, tz = tank.z - tgt.z, tl = Math.hypot(tx, tz) || 1;
      moveToward(healer, tank.x + (tx / tl) * 5.5, tank.z + (tz / tl) * 5.5, 0.6);
    } else moveToward(healer, tank.x - 3.5, tank.z - 4, 1.2);
    const face = tgt ? Math.atan2(tgt.x - healer.x, tgt.z - healer.z) : healer.face;
    if (tgt) healer.face = face;
    if (tgt?.winding && !tgt.staggered && d2(healer.x, healer.z, tgt.x, tgt.z) < 11 && useSkill(healer, 0, face)) return; // Smite interrupt
    if (hurt.length && useSkill(healer, 1, face)) return;                       // Heal
    if (low >= 1 && tgt?.def.boss && useSkill(healer, 3, face)) return; // Sanctuary
    if (tgt && engagedAt !== null && useSkill(healer, 2, face)) return;          // Blessing
    if (tgt && engagedAt !== null && tank.t - engagedAt > 0.8 && d2(healer.x, healer.z, tgt.x, tgt.z) < 11) useSkill(healer, 0, face); // Smite
  }

  function upkeep(b) {
    if (b.dead || !b.me) return;
    if (!b.gateOpen && (inGateZone(b.x, b.z) || inGateZone2(b.x, b.z)) && !b.me.ready && b.t - (b.readyT || -9) > 1) { b.readyT = b.t; send(b, { type: 'ready' }); }
    if (b.hp / b.maxHp < 0.35 && b.t - (b.potT || -99) > 10) { b.potT = b.t; send(b, { type: 'use', id: 'potion' }); }
  }

  // Getting to Floor 2: the Stairway right after a Warden kill, otherwise the town waystone (once unlocked).
  function travel(b) {
    if (floor !== 2 || onFloor2(b.x) || !floorUnlocked(b.life, 2)) return false;
    const warp = () => { if (b.t - (b.warpT || -9) > 1) { b.warpT = b.t; send(b, { type: 'warp', f: 2 }); } };
    if (b.stair && b.stair.until > b.t + 2 && b.z > 150) {
      if (!moveToward(b, b.stair.x, b.stair.z, 1.2) || d2(b.x, b.z, b.stair.x, b.stair.z) < STAIRWAY.use - 0.5) warp();
      return true;
    }
    if (b.z > 150 && !b.gateOpen) return false; // shut in the chamber: wait for the next Stairway
    const w = WAYSTONES[0];
    if (b.z > 20 && Math.abs(b.x) > 3) moveToward(b, 0, b.z - 6); // back to the road, then south to town
    else if (!moveToward(b, w.x, w.z + 2.4, 0.3) || d2(b.x, b.z, w.x, w.z) < 3) warp();
    return true;
  }

  // ---------- single-bot brain (any class) ----------
  const classic = behaviour === 'auto' || behaviour === 'floor2'; // the role-playing party brain (needs a tank)
  function followed(b) { // the player we follow (from the roster by name), as seen in the last snapshot
    if (!follow) return null;
    const want = follow.toLowerCase(), r = (b.roster || []).find(r => !r.bot && r.name.toLowerCase() === want);
    return r ? b.players.find(p => p.id === r.id) || null : null;
  }
  function fieldSpot(b) { // wander between random spots in the field (boar meadow first)
    if (!b.home || d2(b.x, b.z, b.home[0], b.home[1]) < 4 || b.t > b.homeUntil) {
      const low = (b.me?.lvl || 1) < 3;
      b.home = [-50 + Math.random() * 100, low ? 40 + Math.random() * 50 : 45 + Math.random() * 90];
      b.homeUntil = b.t + 25;
    }
    return b.home;
  }
  function nearest(b, list, score) {
    let best = null, bd = 1e9;
    for (const m of list) { const s = score(m); if (s !== null && s < bd) { bd = s; best = m; } }
    return best;
  }
  function soloTarget(b) {
    const f2 = onFloor2(b.x), lvl = b.me?.lvl || 1;
    const here = b.mobs.filter(m => onFloor2(m.x) === f2);
    const threat = r => nearest(b, here, m => { const d = d2(m.x, m.z, b.x, b.z); return !m.def.boss && m.engaged && d < r ? d : null; });
    if (behaviour === 'follow') {
      const a = followed(b);
      if (!a || a.dead) return threat(6);
      const bossFight = inArena(a.x, a.z) || inArena2(a.x, a.z);
      return nearest(b, here, m => {
        if (m.def.boss && !bossFight) return null;
        const da = d2(m.x, m.z, a.x, a.z);
        if (da > 14 || !(m.engaged || m.hp < m.maxHp || da < 6 || m.def.boss)) return null;
        return d2(m.x, m.z, b.x, b.z);
      });
    }
    if (behaviour === 'field') {
      if (f2) return threat(10);
      return nearest(b, here, m => {
        const d = d2(m.x, m.z, b.x, b.z), fight = m.engaged && d < 12;
        if (m.def.boss || m.z > 150 || d > 30) return null;
        if (!fight && ((lvl < 3 && m.type !== 'boar') || (lvl < 6 && m.type === 'alpha'))) return null;
        return d - (fight ? 100 : 0);
      });
    }
    return pickTankTarget(b, behaviour === 'warden' ? 0 : undefined);
  }
  function soloIdle(b) {
    if (behaviour === 'follow') {
      const a = followed(b);
      if (!a) return;
      const d = d2(a.x, a.z, b.x, b.z);
      if (d > 3.5) moveToward(b, a.x, a.z, 3, d > 8 ? SPRINT_SPEED : PLAYER_SPEED);
      return;
    }
    if (behaviour === 'field') { const [x, z] = fieldSpot(b); moveToward(b, x, z, 1); return; }
    const f2 = onFloor2(b.x), lvl = b.me?.lvl || 1;
    if (behaviour !== 'warden' && lvl < (f2 ? F2_BOSS_LVL : 5)) { moveToward(b, f2 ? F2.x : 0, f2 ? 70 : 60); return; }
    travelToBoss(b);
  }
  function soloHeal(b) { // Cleric: heal the party, the player we follow, or ourselves
    const a = followed(b);
    const mates = b.players.filter(p => !p.dead && (p.id === b.id || p.id === a?.id || (b.party && p.party === b.party)));
    const hurt = mates.filter(p => p.hp / p.maxHp < 0.78 && d2(p.x, p.z, b.x, b.z) < 15);
    if (hurt.length && useSkill(b, 1, b.face)) return true;
    const boss = b.mobs.find(m => m.id === b.tgtId)?.def.boss;
    return !!(boss && mates.some(p => p.hp / p.maxHp < 0.7) && useSkill(b, 3, b.face)); // Sanctuary
  }
  function actSolo(b) {
    const tgt = soloTarget(b);
    if ((tgt?.id ?? null) !== b.tgtId) { b.tgtId = tgt?.id ?? null; b.tauntT = -99; }
    const dodge = dodgeSpot(b);
    if (dodge) evade(b, ...dodge);
    if (b.cls === 'cleric' && soloHeal(b)) return;
    if (!tgt) { if (!dodge) soloIdle(b); return; }
    if (CLASS_BRAINS_B[b.cls]) return CLASS_BRAINS_B[b.cls](brainCtx, b, tgt, dodge); // Lancer, Bard
    const ranged = b.cls === 'cleric', reach = ranged ? 8 : tgt.def.radius + 1.5;
    if (!dodge) moveToward(b, tgt.x, tgt.z, reach - 0.4);
    const face = Math.atan2(tgt.x - b.x, tgt.z - b.z), d = d2(b.x, b.z, tgt.x, tgt.z);
    if (!dodge) b.face = face;
    if (ranged) { // Cleric: interrupt wind-ups with Smite, bless, then Smite
      if (d > 11) return;
      if (tgt.winding && !tgt.staggered && useSkill(b, 0, face)) return;
      if (useSkill(b, 2, face)) return;
      useSkill(b, 0, face);
      return;
    }
    if (b.cls === 'guardian') {
      if (d < 8.5 && b.t - b.tauntT > 6 && useSkill(b, 1, face)) { b.tauntT = b.t; return; } // Taunt (pull it off the player)
    }
    if (d > reach + 1.2) return;
    if (b.cls === 'guardian') {
      if (b.hp / b.maxHp < 0.6) useSkill(b, 2, face);                          // Shield Wall
      if (switchOpen(b, tgt)) { useSkill(b, 0, face); return; }               // Switch in with Bash
      if (!tgt.staggered && useSkill(b, 3, face)) return;                      // Ground Slam
      useSkill(b, 0, face);
      return;
    }
    const crowd = b.mobs.filter(m => d2(m.x, m.z, b.x, b.z) < 4.5 + m.def.radius).length;
    if (switchOpen(b, tgt) && useSkill(b, 3, face)) return;                   // Switch in with Burst Combo
    if (!tgt.staggered && useSkill(b, 3, face)) return;                        // or Burst to break it
    if ((crowd >= 2 || tgt.def.boss) && useSkill(b, 2, face)) return;          // Whirl
    useSkill(b, 0, face);                                                      // Slash
  }

  // Lancer / Bard brains (shared/classes/bots-b.js), and party members beyond tank / DPS / healer in the classic run.
  const brainCtx = { useSkill, moveToward, switchOpen, d2, anchor: b => (classic && tank && tank !== b && !tank.dead ? tank : followed(b)) };
  function actExtra(b) {
    if (!CLASS_BRAINS_B[b.cls]) return actSolo(b);
    const tgt = engagedAt !== null ? currentTarget(b) : null, dodge = dodgeSpot(b);
    if (dodge) evade(b, ...dodge);
    if (!tgt) { if (!dodge) moveToward(b, tank.x - 3, tank.z - 3.5, 1.2); return; }
    CLASS_BRAINS_B[b.cls](brainCtx, b, tgt, dodge);
  }

  function tick() {
    if (!team.every(b => b.fresh || b.closed)) return;
    for (const b of team) b.fresh = false;
    for (const b of team) upkeep(b);
    const turn = b => !b.closed && !b.dead && !stepRoll(b) && !perilous(b) && !waveDodge(b) && !travel(b);
    if (classic && tank && !tank.closed) {
      if (turn(tank)) actTank();
      if (dps && turn(dps)) actDps();
      if (healer && turn(healer)) actHealer();
      for (const b of team) if (b !== tank && b !== dps && b !== healer && turn(b)) actExtra(b);
    } else for (const b of team) if (turn(b)) actSolo(b);
    for (const b of team) if (!b.dead) send(b, { type: 'input', x: +b.x.toFixed(2), z: +b.z.toFixed(2), face: +b.face.toFixed(2), seq: b.seq });
  }

  return {
    team,
    stop() { clearInterval(formParty); clearInterval(inviteLoop); for (const b of team) b.ws.close(); },
    drop(b) { b.ws.close(); }, // disconnect one bot; the rest carry on
  };

}
