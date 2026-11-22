// Duels on the client (docs/briefs/duels.md; server/duels.js, rules in shared/duels.js).
//   challenge(id)   the "Duel" picker: rule (First Strike / Half Health / Last Stand) and Solo or Team; Send.
//   duelask event   someone challenged you: Accept / Decline (also /duel accept, /duel decline).
//   snap(w.du)      the duels on; a ring on the ground around each one on your floor; while you fight, the duel bar
//                   (rule, clock, both sides' health) and your live opponents' stand-ins (main.js only draws those:
//                   showMob). Opponents' name plates turn red (isFoe).
//   event(e)        countdown, FIGHT!, out of the ring, out, VICTORY / DEFEAT / DRAW.
import * as THREE from 'three';
import { DUEL, DUEL_RULES, DUEL_RULE_IDS, DUEL_DEFAULT, readDuels, foeMobs } from '/shared/duels.js';
import { floorOf } from '/shared/floor2.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = `
#duel-pick, #duel-in { position: absolute; top: 28%; left: 50%; transform: translateX(-50%); padding: 14px 18px; text-align: center; z-index: 30;
  background: rgba(15,20,35,.92); border: 1px solid rgba(248,113,113,.5); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.5); min-width: 260px; max-width: calc(100vw - 32px); }
#duel-pick h3, #duel-in h3 { margin: 0 0 8px; font-size: 16px; letter-spacing: .08em; color: #fca5a5; }
#duel-pick .dp-rules { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-bottom: 6px; }
#duel-pick button, #duel-in button { padding: 7px 12px; border-radius: 6px; border: 1px solid rgba(160,200,255,.35); background: rgba(120,170,255,.15); color: #fff; font-size: 13px; cursor: pointer; }
#duel-pick .dp-rules button.on, #duel-pick .dp-kind button.on { background: rgba(248,113,113,.35); border-color: #f87171; }
#duel-pick .dp-desc, #duel-in .di-desc { font-size: 12px; opacity: .75; margin: 4px 0 10px; }
#duel-pick .dp-kind { display: flex; gap: 6px; justify-content: center; margin-bottom: 10px; }
#duel-pick .dp-kind button[disabled] { opacity: .4; cursor: default; }
#duel-pick .dp-go, #duel-in .di-yes { background: rgba(248,113,113,.4); border-color: #f87171; font-weight: 700; }
#duel-pick .dp-btns, #duel-in .di-btns { display: flex; gap: 8px; justify-content: center; }
#duel-hud { position: absolute; top: 58px; left: 50%; transform: translateX(-50%); pointer-events: none; text-align: center; z-index: 5;
  background: rgba(15,20,35,.75); border: 1px solid rgba(248,113,113,.45); border-radius: 8px; padding: 6px 12px; font-size: 12px; min-width: 240px; max-width: calc(100vw - 32px); }
#duel-hud .dh-top { font-weight: 800; letter-spacing: .08em; color: #fca5a5; margin-bottom: 4px; }
#duel-hud .dh-sides { display: flex; gap: 14px; justify-content: center; align-items: flex-start; }
#duel-hud .dh-side { display: flex; flex-direction: column; gap: 3px; min-width: 90px; }
#duel-hud .dh-vs { font-weight: 800; opacity: .6; align-self: center; }
#duel-hud .dh-f { text-align: left; }
#duel-hud .dh-f.out { opacity: .45; text-decoration: line-through; }
#duel-hud .dh-f.me b { color: #86efac; }
#duel-hud .dh-bar { height: 4px; background: rgba(255,255,255,.15); border-radius: 2px; overflow: hidden; position: relative; }
#duel-hud .dh-bar i { position: absolute; inset: 0 auto 0 0; background: #4ade80; }
#duel-hud .dh-side.foe .dh-bar i { background: #f87171; }
#duel-hud .dh-bar s { position: absolute; top: 0; bottom: 0; width: 1px; background: #fde68a; }
.lbl.foe .nm { color: #fca5a5 !important; }
.lbl.foe .bar > div { background: #ef4444 !important; }
`;

export function initDuels({ state, players, scene, send, sfx, callout, banner, tip = () => {} }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const pick = document.createElement('div'); pick.id = 'duel-pick'; pick.className = 'hidden';
  const inc = document.createElement('div'); inc.id = 'duel-in'; inc.className = 'hidden';
  const hud = document.createElement('div'); hud.id = 'duel-hud'; hud.className = 'hidden';
  document.body.append(pick, inc, hud);
  for (const el of [pick, inc]) el.addEventListener('keydown', e => e.stopPropagation()); // (no moving while choosing)

  let duels = [], foes = new Set(), foePlayers = new Set(), mine = null, ask = null, incT = 0;
  const rings = new Map(); // duel id -> ground ring
  const sel = { id: 0, rule: DUEL_DEFAULT, team: false };
  const nameOf = id => state.roster.get(id)?.name || players.get(id)?.name || '?';

  // ---------- the challenge picker ----------
  function drawPick() {
    const t = players.get(sel.id);
    const both = !!(state.party && t?.party && t.party !== state.party);
    if (!both) sel.team = false;
    const R = DUEL_RULES[sel.rule];
    pick.innerHTML = `<h3>DUEL ${esc(nameOf(sel.id).toUpperCase())}</h3>
      <div class="dp-rules">${DUEL_RULE_IDS.map(r => `<button data-r="${r}" class="${r === sel.rule ? 'on' : ''}">${DUEL_RULES[r].name}</button>`).join('')}</div>
      <div class="dp-desc">${esc(R.desc)} Nobody dies, and everyone gets their health back after.</div>
      <div class="dp-kind"><button data-k="solo" class="${sel.team ? '' : 'on'}">Solo</button><button data-k="team" class="${sel.team ? 'on' : ''}" ${both ? '' : 'disabled'} title="${both ? 'Your whole party against theirs' : 'You both need a party (two different ones)'}">Party vs party</button></div>
      <div class="dp-btns"><button class="dp-go">Challenge</button><button class="dp-no">Cancel</button></div>`;
  }
  pick.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.r) { sel.rule = b.dataset.r; drawPick(); }
    else if (b.dataset.k) { sel.team = b.dataset.k === 'team'; drawPick(); }
    else if (b.classList.contains('dp-go')) { send({ type: 'duel', op: 'ask', id: sel.id, rule: sel.rule, team: sel.team ? 1 : 0 }); pick.classList.add('hidden'); sfx?.play('ui'); }
    else if (b.classList.contains('dp-no')) pick.classList.add('hidden');
  });
  function challenge(id) {
    if (!id || id === state.myId) return;
    sel.id = id;
    drawPick();
    pick.classList.remove('hidden');
    sfx?.play('ui');
  }

  // ---------- an incoming challenge ----------
  function showAsk(e) {
    ask = e;
    const R = DUEL_RULES[e.rule] || DUEL_RULES[DUEL_DEFAULT];
    inc.innerHTML = `<h3>${e.team ? 'TEAM DUEL' : 'DUEL'}</h3><div><b>${esc(e.name)}</b> challenges you${e.team ? ' (your whole party against theirs)' : ''}</div>
      <div class="di-desc">${esc(R.name)}: ${esc(R.desc)}</div><div class="di-btns"><button class="di-yes">Accept</button><button class="di-no">Decline</button></div><div class="di-desc" style="margin:8px 0 0">or chat /duel accept (Esc frees the mouse)</div>`;
    inc.classList.remove('hidden');
    clearTimeout(incT); incT = setTimeout(() => inc.classList.add('hidden'), DUEL.askFor * 1000);
    sfx?.play('cue');
  }
  inc.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    send({ type: 'duel', op: b.classList.contains('di-yes') ? 'accept' : 'decline' });
    inc.classList.add('hidden'); ask = null;
  });

  // ---------- snapshots ----------
  function snap(rows) {
    duels = readDuels(rows);
    foes = foeMobs(duels, state.myId);
    const withMe = duels.filter(d => d.fighters.some(f => f.id === state.myId));
    mine = withMe.find(d => d.state < 2) || withMe[0] || null; // (a new duel over the last one's lingering result)
    foePlayers = new Set();
    if (mine && mine.state < 2) { const me = mine.fighters.find(f => f.id === state.myId); for (const f of mine.fighters) if (f.side !== me.side) foePlayers.add(f.id); }
    // rings: every duel on my floor
    const here = new Set();
    for (const d of duels) {
      if (d.state === 2 || floorOf(d.x) !== floorOf(state.x)) continue;
      here.add(d.id);
      let r = rings.get(d.id);
      if (!r) {
        r = new THREE.Mesh(new THREE.RingGeometry(d.r - 0.25, d.r, 96), new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
        r.rotation.x = -Math.PI / 2; r.position.set(d.x, 0.06, d.z); r.renderOrder = 2;
        scene.add(r); rings.set(d.id, r);
      }
      r.material.color.setHex(d.state === 0 ? 0xfbbf24 : 0xf87171);
    }
    for (const [id, r] of rings) if (!here.has(id)) { scene.remove(r); r.geometry.dispose(); r.material.dispose(); rings.delete(id); }
    drawHud();
  }
  function drawHud() {
    if (!mine) { if (!hud.classList.contains('hidden')) hud.classList.add('hidden'); return; }
    const R = DUEL_RULES[mine.rule], me = mine.fighters.find(f => f.id === state.myId);
    const clock = mine.state === 0 ? `starts in ${Math.ceil(mine.left)}` : mine.state === 1 ? `${Math.floor(mine.left / 60)}:${String(Math.floor(mine.left % 60)).padStart(2, '0')}` : mine.won === null ? '' : mine.won < 0 ? 'draw' : mine.won === me.side ? 'won' : 'lost';
    const side = s => mine.fighters.filter(f => f.side === s).map(f => {
      const p = players.get(f.id), pct = p ? Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100)) : 0;
      return `<div class="dh-f ${f.out ? 'out' : ''} ${f.id === state.myId ? 'me' : ''}"><b>${esc(nameOf(f.id))}</b><div class="dh-bar"><i style="width:${pct.toFixed(0)}%"></i>${R.floor ? `<s style="left:${R.floor * 100}%"></s>` : ''}</div></div>`;
    }).join('');
    const mySide = me?.side ?? 0;
    const html = `<div class="dh-top">${mine.state === 2 ? 'DUEL OVER' : 'DUEL'} · ${esc(R.name)} · ${clock}</div><div class="dh-sides"><div class="dh-side">${side(mySide)}</div><div class="dh-vs">VS</div><div class="dh-side foe">${side(1 - mySide)}</div></div>`;
    if (hud._h !== html) { hud._h = html; hud.innerHTML = html; }
    hud.classList.remove('hidden');
  }

  // ---------- events ----------
  function event(e) {
    const me = state.myId;
    if (e.t === 'duelask') {
      if (e.to !== me) return true;
      if (e.off) { if (ask?.from === e.from) { inc.classList.add('hidden'); ask = null; } return true; }
      showAsk(e);
      return true;
    }
    if (e.t !== 'duel') return false;
    const d = duels.find(x => x.id === e.id), inIt = !!d?.fighters.some(f => f.id === me);
    if (e.s === 'start') {
      inc.classList.add('hidden'); pick.classList.add('hidden'); ask = null;
      if (inIt) { // (main.js reads w.du before the events: d is known)
        banner(e.team ? 'TEAM DUEL' : 'DUEL', `${e.vs} · ${DUEL_RULES[e.rule]?.name || ''}`);
        tip('duel');
        for (let i = 0; i < e.d; i++) setTimeout(() => { callout(String(e.d - i), 'Get ready', 0.9); sfx?.play('tick'); }, i * 1000);
      }
      return true;
    }
    if (!inIt) return true; // other people's duels: the chat lines say enough
    if (e.s === 'fight') { callout('FIGHT!', DUEL_RULES[d.rule]?.desc || '', 1.2); sfx?.play('gate', null, 0.6); }
    else if (e.s === 'ring' && e.pid === me) { callout('BACK INSIDE THE RING', `or you forfeit in ${e.d} s`, 1.6); sfx?.play('warn'); }
    else if (e.s === 'out' && e.pid === me) callout('OUT', e.why === 'yield' ? 'You yielded' : e.why === 'fled' ? 'You left the ring' : e.by ? `Beaten by ${nameOf(e.by)}` : '', 1.6);
    else if (e.s === 'end') {
      const f = d?.fighters.find(x => x.id === me);
      const won = e.won >= 0 && f && f.side === e.won;
      callout(e.won < 0 ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT', e.why === 'time' ? 'Time' : '', 2.2);
      sfx?.play(won ? 'clear' : e.won < 0 ? 'ui' : 'shatter', null, 0.7);
    }
    return true;
  }

  return {
    challenge, snap, event,
    // main.js: only draw a duel stand-in that is one of my live opponents (everyone else's are none of my business)
    showMob: id => foes.has(id),
    ownerOf: mob => { for (const d of duels) { const f = d.fighters.find(x => x.mob === mob); if (f) return f.id; } return 0; },
    isFoe: id => foePlayers.has(id),
    busy: () => !pick.classList.contains('hidden') || !inc.classList.contains('hidden'),
    inDuel: () => !!mine && mine.state < 2 && !!mine.fighters.find(f => f.id === state.myId && !f.out),
  };
}
