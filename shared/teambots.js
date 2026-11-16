// Role-playing bot party, shared by the Node runner (test/team.js) and the in-browser page (/bots.html).
//
// Tank (Guardian)  leads, picks targets, opens with Taunt, keeps aggro, Shield Walls when low.
// DPS (Swordsman)  waits for the tank to grab aggro, then attacks from behind the target.
// Healer (Cleric)  hangs back behind the tank, heals whoever is hurt, buffs, smites when idle.
// Everyone dodge-rolls out of the boss's red circles and plays Break -> Switch.
// The Warden's perilous Horn Sweep: DPS and healer roll through it at the last moment (a perfect dodge), the tank parries it.
// A fresh (low-level) party warms up on boars before taking on wolves.
import { MOBS, MOB_IDS, PLAYER_SPEED, DODGE, SWEEP, walkable, resolveCollision, inGateZone } from './data.js';

export const TEAM_NAMES = { guardian: 'Brann', swordsman: 'Kael', cleric: 'Lyra' };

export function startTeam({ url, WebSocket: WS = globalThis.WebSocket, roles = ['guardian', 'swordsman', 'cleric'], suffix = '', inviteHumans = false, log = () => {} }) {
  const ROSTER = roles.map(c => [c, TEAM_NAMES[c] + suffix]);
  const DT = 0.05;
  const send = (b, o) => b.ws.readyState === 1 && b.ws.send(JSON.stringify(o));
  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  const team = ROSTER.map(([cls, name], i) => {
    const b = { i, cls, name, id: 0, x: 0, z: 0, seq: 0, face: 0, t: 0, mobs: [], players: [], me: null, dead: false, hp: 1, maxHp: 1, tele: [], fresh: false, cds: [0, 0, 0, 0], dodgeCd: 0, roll: null, stag: {} };
    b.ws = new WS(url);
    b.ws.addEventListener('open', () => send(b, { type: 'join', name, cls }));
    b.ws.addEventListener('close', () => { b.closed = true; });
    b.ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.type === 'welcome') Object.assign(b, { id: msg.id, x: msg.x, z: msg.z, seq: msg.seq });
      if (msg.type !== 'snap') return;
      b.t += DT;
      b.me = msg.me;
      b.cds = msg.me.cds.map((c, k) => (b.t - (b.pressed?.[k] || -9) < 0.3 ? Math.max(c, 0.2) : c));
      if (b.t - (b.dodgePressed || -9) > 0.3) b.dodgeCd = msg.me.dodge || 0;
      b.mobs = msg.w.mobs.map(m => ({ id: m[0], type: MOB_IDS[m[1]], x: m[2], z: m[3], hp: m[5], maxHp: m[6], engaged: !!(m[7] & 2), enraged: !!(m[7] & 4), winding: !!(m[7] & 16), staggered: !!(m[7] & 32), def: MOBS[MOB_IDS[m[1]]] }));
      b.gateOpen = !!msg.w.gate?.[0];
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
    if (!tank || !team.every(b => b.id)) return;
    clearInterval(formParty);
    for (const b of team) if (b !== tank) { send(tank, { type: 'invite', id: b.id }); invited.add(b.id); }
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
    if (b.dodgeCd <= 0) {
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

  function moveToward(b, tx, tz, stop = 0.4) {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d <= stop) return false;
    const step = Math.min(d - stop, PLAYER_SPEED * DT);
    let nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
    [nx, nz] = resolveCollision(nx, nz);
    if (!walkable(nx, nz, !b.gateOpen)) return false;
    b.x = nx; b.z = nz; b.face = Math.atan2(dx, dz);
    return true;
  }

  // Point just outside any active telegraph circle we're standing in, or null.
  function dodgeSpot(b) {
    b.tele = b.tele.filter(t => t.until > b.t);
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
  function pickTankTarget() {
    const lvl = tank.me?.lvl || 1;
    const boss = tank.mobs.find(m => m.type === 'warden');
    if (boss && tank.z > 162 && lvl >= 5) return boss;
    const want = lvl < 3 ? 'boar' : lvl < 5 ? 'wolf' : null;
    let best = null, bd = 1e9;
    for (const m of tank.mobs) {
      if (m.type === 'warden') continue;
      const d = d2(m.x, m.z, tank.x, tank.z);
      const hunt = m.type === want;                 // what we're farming right now
      const threat = m.engaged && d < 15;           // anything that's attacking us
      const inWay = want === null && d < 15 && (m.type === 'wolf' || m.engaged); // on the road to the boss
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
    if (!tgt && (tank.me?.lvl || 1) < 5) { moveToward(tank, 0, 60); return; } // nothing to farm nearby: head into the field
    if (!tgt) { // travel: get onto the road, then up to the chamber
      if (!tank.gateOpen && tank.z > 120) { moveToward(tank, 0, 154); return; } // wait at the raid gate
      if (tank.z < 150 && Math.abs(tank.x) > 3) moveToward(tank, 0, Math.min(150, tank.z + 6));
      else if (tank.z < 162) moveToward(tank, 0, 172);
      else moveToward(tank, 0, 182);
      return;
    }
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

  function currentTarget(b) { return targetId ? b.mobs.find(m => m.id === targetId) : null; }

  function actDps() {
    const tgt = currentTarget(dps);
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
    if ((crowd >= 2 || tgt.type === 'warden') && useSkill(dps, 2, face)) return; // Whirl
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
    if (low >= 1 && tgt?.type === 'warden' && useSkill(healer, 3, face)) return; // Sanctuary
    if (tgt && engagedAt !== null && useSkill(healer, 2, face)) return;          // Blessing
    if (tgt && engagedAt !== null && tank.t - engagedAt > 0.8 && d2(healer.x, healer.z, tgt.x, tgt.z) < 11) useSkill(healer, 0, face); // Smite
  }

  function upkeep(b) {
    if (b.dead || !b.me) return;
    if (!b.gateOpen && inGateZone(b.x, b.z) && !b.me.ready && b.t - (b.readyT || -9) > 1) { b.readyT = b.t; send(b, { type: 'ready' }); }
    if (b.hp / b.maxHp < 0.35 && b.t - (b.potT || -99) > 10) { b.potT = b.t; send(b, { type: 'use', id: 'potion' }); }
  }

  function tick() {
    if (!team.every(b => b.fresh || b.closed)) return;
    for (const b of team) b.fresh = false;
    for (const b of team) upkeep(b);
    if (tank && !tank.dead && !stepRoll(tank) && !perilous(tank)) actTank();
    if (dps && !dps.dead && !stepRoll(dps) && !perilous(dps)) actDps();
    if (healer && !healer.dead && !stepRoll(healer) && !perilous(healer)) actHealer();
    for (const b of team) if (!b.dead) send(b, { type: 'input', x: +b.x.toFixed(2), z: +b.z.toFixed(2), face: +b.face.toFixed(2), seq: b.seq });
  }

  return {
    team,
    stop() { clearInterval(formParty); clearInterval(inviteLoop); for (const b of team) b.ws.close(); },
  };

}
