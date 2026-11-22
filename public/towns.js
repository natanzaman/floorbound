// Floor towns that grow, and their Stewards (docs/briefs/towns.md): the town boards (a post with a banner, the
// Steward's name over it), camp traders and gate waystones once built, the raid ward and raid HUD, and the Town panel
// (#town: Town, Election, Bounties, Steward; pad-driven via data-nav). The server decides everything (server/towns.js).
import * as THREE from 'three';
import { TOWNS, TOWN_FLOORS, BOARD, TRADER, STAGES, UNLOCKS, PROJECTS, projectOf, AGENDAS, AGENDA_IDS, RULE_TEXT, TAX, ELECTION, CITIZEN_DISCOUNT } from '/shared/towns.js';
import { MATS } from '/shared/crafting.js';
import { floorOf } from '/shared/floor2.js';
import { keyHtml, tapping } from '/keyname.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts });
const fmt = s => (s >= 172800 ? `${Math.round(s / 86400)} days` : s >= 3600 ? (s % 3600 < 30 ? `${Math.round(s / 3600)} hours` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`) : s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.max(0, Math.round(s))}s`);
const matName = id => MATS[id]?.name || id;
const TABS = [['town', 'Town'], ['vote', 'Election'], ['bounty', 'Bounties'], ['steward', 'Steward']];
const BANNER = { 1: 0x60a5fa, 2: 0x2dd4bf, 3: 0xa5b4fc };

function boardMesh(f) {
  const g = new THREE.Group(), wood = mat(0x7a4f2e);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), wood); post.position.y = 1.6; g.add(post);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.12), mat(0xd6b98c)); sign.position.set(0, 2.2, 0.15); g.add(sign);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.4), mat(BANNER[f], { side: THREE.DoubleSide, emissive: BANNER[f], emissiveIntensity: 0.25 })); flag.position.set(0.55, 3.2, 0); g.add(flag);
  g.position.set(TOWNS[f].board.x, 0, TOWNS[f].board.z);
  return g;
}
function stallMesh() {
  const g = new THREE.Group();
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1), mat(0x7a4f2e)); counter.position.y = 0.5; g.add(counter);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 1.6), mat(0xb45309)); roof.position.y = 2.4; g.add(roof);
  for (const x of [-1.2, 1.2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), mat(0x5b3a1e)); p.position.set(x, 1.2, -0.5); g.add(p); }
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), mat([0xfacc15, 0x86efac, 0xf87171][i])); c.position.set(-0.7 + i * 0.7, 1.15, 0); g.add(c); }
  return g;
}
function stoneMesh() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 2.4, 6), mat(0x64748b)); s.position.y = 1.2; g.add(s);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), mat(0x5eead4, { emissive: 0x14b8a6, emissiveIntensity: 1 })); gem.position.y = 2.7; g.add(gem);
  return g;
}
function wardMesh(f) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4, 6), mat(0x57534e)); pole.position.y = 2; g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.6), mat(BANNER[f], { side: THREE.DoubleSide, emissive: BANNER[f], emissiveIntensity: 0.3 })); flag.position.set(0.6, 3.1, 0); g.add(flag);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), mat(0x78716c)); st.position.set(Math.cos(a) * 1.3, 0.3, Math.sin(a) * 1.3); st.rotation.y = -a; g.add(st); }
  g.position.set(TOWNS[f].ward.x, 0, TOWNS[f].ward.z);
  return g;
}

export function createTowns({ scene, floor1, send, state, project, log, sfx, $, banner, callout, guide }) {
  const root = f => (f === 1 ? floor1 : scene);
  const boards = {}, traders = {}, stones = {}, wards = {};
  for (const f of TOWN_FLOORS) {
    root(f).add(boards[f] = boardMesh(f));
    root(f).add(wards[f] = wardMesh(f));
    if (TOWNS[f].trader) { const s = stallMesh(); s.position.set(TOWNS[f].trader.x, 0, TOWNS[f].trader.z); s.visible = false; root(f).add(traders[f] = s); }
    const st = stoneMesh(); st.position.set(TOWNS[f].gate.x, 0, TOWNS[f].gate.z); st.visible = false; root(f).add(stones[f] = st);
  }
  const panel = document.createElement('div'); panel.id = 'town'; panel.className = 'panel hidden'; panel.dataset.nav = 'town'; // (pad-driven: public/focusnav.js)
  $('bag').parentNode.appendChild(panel);
  const lbl = document.createElement('div'); lbl.className = 'lbl npc town'; lbl.style.display = 'none'; $('labels').appendChild(lbl);
  const tlbl = document.createElement('div'); tlbl.className = 'lbl npc town'; tlbl.style.display = 'none'; $('labels').appendChild(tlbl);
  const hud = document.createElement('div'); hud.id = 'raid-hud'; hud.className = 'hidden'; document.body.appendChild(hud);
  const ui = { tab: 'town', f: 1, data: null, at: 0, raid: null, rings: [], stand: { ag: 'build', plat: '' }, give: {} };

  const T = f => ui.data?.towns?.find(t => t.f === f) || null;
  const me = () => ui.data?.me || { home: 0, move: 0 };
  const since = () => (performance.now() - ui.at) / 1000;
  const isOpen = () => !panel.classList.contains('hidden');
  const boardNear = (pad = 0) => TOWN_FLOORS.find(f => Math.hypot(state.x - TOWNS[f].board.x, state.z - TOWNS[f].board.z) < BOARD.use + pad) || 0;
  const unl = (f, k) => !!T(f)?.unl?.includes(k);
  const traderNear = () => [2, 3].find(f => TOWNS[f].trader && unl(f, 'trader') && Math.hypot(state.x - TOWNS[f].trader.x, state.z - TOWNS[f].trader.z) < TRADER.use) || 0;
  const have = id => state.inv?.mats?.[id] || 0;

  function toggle(open = !isOpen(), f) {
    if (f) ui.f = f;
    panel.classList.toggle('hidden', !open);
    if (open !== ui.watch) { ui.watch = open; send({ type: 'town', op: 'state', watch: open ? 1 : 0 }); } // (an open panel gets every change)
    if (open) render();
  }

  // ---------- messages and events ----------
  function onMsg(m) { ui.data = m; ui.at = performance.now(); render(); refreshScenery(); }
  function refreshScenery() { for (const f of TOWN_FLOORS) { if (traders[f]) traders[f].visible = unl(f, 'trader'); stones[f].visible = unl(f, 'gate'); } }
  function onEvent(e) {
    if (e.t === 'traid') {
      if (e.s === 'warn' && floorOf(state.x) === e.f) { banner('RAID INCOMING', `${TOWNS[e.f].name}: defend the ward on the town's edge`); sfx.play('horn'); guide?.tip?.('raid'); }
      else if (e.s === 'tele') { for (const [x, z] of e.pts || []) ring(x, z, e.d || 3); if (floorOf(state.x) === e.f) callout?.(`WAVE ${e.wave}/${e.waves}`, 'raid'); }
      else if ((e.s === 'won' || e.s === 'lost') && floorOf(state.x) === e.f) banner(e.s === 'won' ? 'RAID BEATEN' : 'THE WARD FELL', `${TOWNS[e.f].name} ${e.s === 'won' ? 'gains' : 'loses'} ${Math.abs(Math.round(e.xp))} town XP`);
      return true;
    }
    if (e.t === 'townup') { banner(`${TOWNS[e.f].name.toUpperCase()}`, `has grown into a ${e.name}`); sfx.play('levelup'); return true; }
    if (e.t === 'townbuilt' || e.t === 'steward') { sfx.play('ui'); return true; }
    return false;
  }
  function ring(x, z, d) {
    const m = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 24), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.08, z); scene.add(m);
    ui.rings.push({ m, until: performance.now() + d * 1000 });
  }
  function snap(w) {
    const r = (w.tr || []).find(x => x[0] === floorOf(state.x));
    ui.raid = r ? { f: r[0], warn: !r[1], wave: r[2], waves: r[3], ward: r[4], left: r[5], n: r[6] } : null;
  }

  // ---------- the interact key ----------
  function interactKind() { if (state.dead || !state.joined || state.spectator) return null; return boardNear() ? 'town' : null; }
  function interact(k) { if (k !== 'town') return false; sfx.play('ui'); toggle(true, boardNear()); return true; }

  // ---------- the panel ----------
  const btn = (a, label, on, extra = '') => `<button data-a="${a}" ${extra} ${on ? '' : 'disabled'}>${label}</button>`;
  const costList = need => [need.gold ? `<span class="${(state.inv?.gold ?? 0) > 0 ? 'ok' : 'no'}">${need.gold} gold</span>` : '', ...Object.entries(need.mats || {}).map(([k, v]) => `<span class="${have(k) ? 'ok' : 'no'}" style="--c:${MATS[k]?.color || '#e5e7eb'}">${v} ${esc(matName(k))} <i>(${have(k)})</i></span>`)].filter(Boolean).join('');
  function tabTown(t, at) {
    const M = me(), home = M.home === t.f, stg = STAGES[t.stage];
    let h = `<div class="it on"><span class="nm"><b>${esc(t.name)} · ${esc(stg.name)}</b><small>${t.need ? `${t.into} / ${t.need} town XP to ${esc(STAGES[t.stage + 1].name)}` : 'The highest stage.'}</small>${t.need ? `<div class="lb"><div style="width:${Math.round((100 * t.into) / t.need)}%"></div></div>` : ''}<small>Citizens: ${t.cit.players} players, ${t.cit.bots} bots · Treasury ${t.treasury} gold · ${t.tax > 0 ? `Tax ${Math.round(t.tax * 100)}%` : t.tax < 0 ? `Steward's discount ${Math.round(-t.tax * 100)}%` : 'No tax'} · You pay ${Math.round(t.mul * 100)}%</small></span></div>`;
    if (t.msg) h += `<p class="hint pin">📌 ${t.steward ? `<b>${esc(t.steward.name)}</b>: ` : ''}${esc(t.msg)}</p>`;
    h += `<div class="it"><span class="nm"><b>${home ? 'You live here' : M.home ? `You live in ${esc(TOWNS[M.home].name)}` : 'You have no home town yet'}</b><small>${home ? `A citizen: ${Math.round(CITIZEN_DISCOUNT * 100)}% off at this town's merchant${t.f === 1 ? ' and Smith' : ''}, and a vote for its Steward.` : M.home && M.move > 0 ? `You can move again in ${fmt(M.move - since())}.` : 'Joining is free. One home town per character; 7 days between moves.'}</small></span>${home ? '' : btn('join', 'Join', at && !(M.home && M.move > since()))}</div>`;
    h += `<h4>Project</h4>`;
    if (t.cur) {
      const U = UNLOCKS[t.cur.unlock];
      h += `<div class="it"><span class="nm"><b>${esc(t.cur.name)}</b><small>${esc(U.desc)}</small><div class="cost">Still needs: ${costList(t.cur.need) || 'nothing'}</div></span></div>`;
      if (at) {
        const goldStep = Math.min(t.cur.need.gold, state.inv?.gold ?? 0, 100);
        h += `<div class="it"><span class="nm"><small>Give to the project (only what it still needs):</small></span><span class="btns">${btn('give', `${goldStep} gold`, goldStep > 0, `data-g="${goldStep}"`)}${Object.keys(t.cur.need.mats).map(k => btn('give', `${Math.min(have(k), t.cur.need.mats[k])} ${esc(matName(k))}`, have(k) > 0, `data-m="${k}" data-n="${Math.min(have(k), t.cur.need.mats[k])}"`)).join('')}</span></div>`;
      } else h += '<p class="hint">Give at the town board.</p>';
    } else h += `<div class="it empty"><span class="nm"><small>${t.open.length ? '' : t.stage < STAGES.length - 1 ? `Every project for a ${esc(stg.name)} is built: the next ones open when the town grows.` : 'Every project is built.'}</small></span></div>`;
    const built = (PROJECTS[t.f] || []).map(pr => { const done = t.done.includes(pr.id), live = t.unl.includes(pr.unlock) && done; return `<span class="${done ? (live ? 'ok' : 'no') : 'dim'}" title="${esc(UNLOCKS[pr.unlock].desc)}">${done ? '✔' : '·'} ${esc(pr.name)} <i>(${esc(STAGES[pr.stage].name)})</i></span>`; }).join('');
    h += `<div class="cost built">${built}</div>`;
    if (t.plots) h += `<p class="hint">Guild hall plots: ${t.plots} (for guilds, coming later).</p>`;
    const r = t.raid;
    h += `<h4>Raids</h4><p class="hint">${r.on ? '<b class="no">A raid is on now: defend the ward!</b>' : r.due > 0 ? `Scouts expect raiders in about ${fmt(r.due - since() > 7200 ? Math.round((r.due - since()) / 3600) * 3600 : r.due - since())}.` : 'Raiders are gathering: they strike when someone is on this floor.'} ${r.last ? `Last raid ${fmt(r.last.ago)} ago: ${r.last.won ? 'beaten' : 'the ward fell'} (${r.last.xp > 0 ? '+' : ''}${r.last.xp} XP).` : ''} Defend the ward on the town's edge when they come.</p>`;
    return h;
  }
  function tabVote(t, at) {
    const E = t.el, M = me(), home = M.home === t.f, why = t.why || '';
    let h = `<p class="hint">Steward: <b>${t.steward ? esc(t.steward.name) : 'nobody yet'}</b>${t.steward ? ` (${esc(AGENDAS[t.steward.ag]?.name || '')})` : ''}. ${esc(TOWNS[t.f].name)}'s Steward is ${esc(RULE_TEXT[t.rule])}. ${E.tour ? 'The tournament is on now.' : `This election closes in ${fmt(E.left - since())} (${E.voted} vote${E.voted === 1 ? '' : 's'} cast so far).`}</p>${why ? `<p class="hint"><b>${esc(why)}</b></p>` : ''}`;
    if (E.tour) h += `<div class="it"><span class="nm"><b>Tournament</b>${E.tour.map((rd, i) => `<small>Round ${i + 1}: ${rd.map(([a, b, w]) => `${esc(a)}${b ? ` vs ${esc(b)}` : ' (bye)'}${w ? ` → <b>${esc(w)}</b>` : ''}`).join(' · ')}</small>`).join('')}</span></div>`;
    h += E.cands.map(c => `<div class="it ${E.my === c.k ? 'on' : ''}"><span class="slot">${c.kind === 'player' ? 'player' : c.kind === 'named' ? 'Named' : 'citizen'}</span><span class="nm"><b>${esc(c.name)} <em>${esc(AGENDAS[c.ag]?.name || '')}</em>${E.my === c.k ? ' <em class="ok">your vote</em>' : ''}</b><small>"${esc(c.plat)}"</small>${t.rule === 'contrib' ? `<small>Given this cycle: ${c.c}</small>` : ''}</span>${btn('vote', E.my === c.k ? 'Voted' : 'Vote', at && !why && !E.tour && E.my !== c.k, `data-k="${esc(c.k)}"`)}</div>`).join('');
    const mine = E.cands.find(c => c.me);
    if (home && !E.tour && (!why || mine)) {
      h += `<h4>${mine ? 'Your candidacy' : 'Stand for Steward'}</h4><div class="it"><span class="nm"><small>Agenda:</small><span class="btns row">${AGENDA_IDS.map(a => `<button data-a="ag" data-ag="${a}" class="${ui.stand.ag === a ? 'on' : ''}" title="${esc(AGENDAS[a].line)}">${esc(AGENDAS[a].name)}</button>`).join('')}</span><input id="town-plat" maxlength="${ELECTION.platMax}" placeholder="${esc(AGENDAS[ui.stand.ag].line)}" value="${esc(ui.stand.plat)}"></span><span class="btns">${btn('stand', mine ? 'Update' : 'Stand', at)}${mine ? btn('withdraw', 'Withdraw', at) : ''}</span></div>`;
    }
    if (t.last) h += `<h4>Last result</h4><p class="hint"><b>${esc(t.last.name)}</b> won ${fmt(t.last.ago)} ago (${t.last.how === 'vote' ? 'by vote' : t.last.how === 'contrib' ? 'by contribution' : 'the duel tournament'}; ${t.last.voted} voted): ${t.last.tally.map(([n, v, c]) => `${esc(n)} ${v} vote${v === 1 ? '' : 's'}${t.rule === 'contrib' ? `, ${c} given` : ''}`).join(' · ')}</p>`;
    return h;
  }
  function tabBounty(t, at) {
    if (!t.bounty) return `<p class="hint">No bounty board here yet: it is one of ${esc(t.name)}'s projects.</p>`;
    let h = '<p class="hint">Three bounties a day (they change at 10:00 UTC). Kills on this floor count; claim at the board.</p>';
    h += t.bounty.map((b, i) => `<div class="it ${b.got ? 'on' : ''}"><span class="nm"><b>${b.n} ${esc(b.name)}</b><small>${b.got ? 'Claimed.' : `${Math.min(b.prog, b.n)} / ${b.n} · ${b.gold} gold`}</small><div class="lb"><div style="width:${Math.round((100 * Math.min(b.prog, b.n)) / b.n)}%"></div></div></span>${b.got ? '' : btn('claim', 'Claim', at && b.prog >= b.n, `data-i="${i}"`)}</div>`).join('');
    return h;
  }
  function tabSteward(t, at) {
    if (!t.steward?.me) return `<p class="hint">${t.steward ? `${esc(t.steward.name)} is the Steward. They choose the next project, set a small tax or discount (tax goes to the treasury, which funds projects) and pin a message.` : 'Nobody holds the office yet.'}</p>`;
    let h = '<p class="hint">You are the Steward. Your choices apply at once.</p><h4>Next project</h4>';
    h += t.open.map(id => { const pr = projectOf(id); return `<div class="it ${t.cur?.id === id ? 'on' : ''}"><span class="nm"><b>${esc(pr.name)}</b><small>${esc(UNLOCKS[pr.unlock].desc)}</small></span>${btn('sproj', t.cur?.id === id ? 'Current' : 'Build next', at && t.cur?.id !== id, `data-id="${id}"`)}</div>`; }).join('') || '<div class="it empty"><span class="nm"><small>No project can start at this stage.</small></span></div>';
    h += `<h4>Tax</h4><div class="it"><span class="nm"><small>${Math.round(TAX.min * 100)}% (a discount the treasury pays) to +${Math.round(TAX.max * 100)}% (to the treasury). Now: ${Math.round(t.tax * 100)}%.</small></span><span class="btns row">${btn('stax', '−1%', at && t.tax > TAX.min + 1e-9, 'data-d="-1"')}${btn('stax', '+1%', at && t.tax < TAX.max - 1e-9, 'data-d="1"')}</span></div>`;
    h += `<h4>Pinned message</h4><div class="it"><span class="nm"><input id="town-msg" maxlength="${ELECTION.msgMax}" value="${esc(t.msg)}"></span>${btn('smsg', 'Pin', at)}</div>`;
    return h;
  }
  function render() {
    if (!isOpen()) return;
    const t = T(ui.f), at = boardNear() === ui.f;
    if (document.activeElement?.closest?.('#town') && document.activeElement.tagName === 'INPUT') return; // (don't eat what's being typed)
    let h = `<div class="top"><span>${t ? esc(t.name.toUpperCase()) : 'TOWN'}${t?.steward ? ` <small>Steward ${esc(t.steward.name)}</small>` : ''}</span><button class="x" data-a="close">✕</button></div>`;
    h += `<div class="tabs">${TABS.map(([id, name]) => `<button data-a="tab" data-t="${id}" class="${ui.tab === id ? 'on' : ''}">${name}</button>`).join('')}</div>`;
    h += `<div class="tabs fl">${TOWN_FLOORS.map(f => `<button data-a="fl" data-f="${f}" class="${ui.f === f ? 'on' : ''}">Floor ${f}</button>`).join('')}</div>`;
    h += `<div class="body">${!t ? '<div class="it empty"><span class="nm"><small>…</small></span></div>' : { town: tabTown, vote: tabVote, bounty: tabBounty, steward: tabSteward }[ui.tab](t, at)}</div>`;
    const sc = panel.querySelector('.body')?.scrollTop || 0;
    if (ui.html !== h) { ui.html = h; panel.innerHTML = h; const body = panel.querySelector('.body'); if (body) body.scrollTop = sc; } // (compare with what was set: innerHTML reads back differently)
  }
  panel.addEventListener('input', e => { if (e.target.id === 'town-plat') ui.stand.plat = e.target.value; });
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = b.dataset.a, f = ui.f, t = T(f);
    sfx.play('ui');
    if (a === 'close') return toggle(false);
    if (a === 'tab') { ui.tab = b.dataset.t; return render(); }
    if (a === 'fl') { ui.f = +b.dataset.f; return render(); }
    if (a === 'ag') { ui.stand.ag = b.dataset.ag; return render(); }
    if (a === 'join') send({ type: 'town', op: 'join', f });
    if (a === 'give') send({ type: 'town', op: 'donate', f, ...(b.dataset.g ? { gold: +b.dataset.g } : { mats: { [b.dataset.m]: +b.dataset.n } }) });
    if (a === 'vote') send({ type: 'town', op: 'vote', f, k: b.dataset.k });
    if (a === 'stand') send({ type: 'town', op: 'stand', f, ag: ui.stand.ag, plat: panel.querySelector('#town-plat')?.value || '' });
    if (a === 'withdraw') send({ type: 'town', op: 'withdraw', f });
    if (a === 'claim') send({ type: 'town', op: 'claim', f, i: +b.dataset.i });
    if (a === 'sproj') send({ type: 'town', op: 'steward', f, project: b.dataset.id });
    if (a === 'stax' && t) send({ type: 'town', op: 'steward', f, tax: Math.round((t.tax + +b.dataset.d * TAX.step) * 100) / 100 });
    if (a === 'smsg') send({ type: 'town', op: 'steward', f, msg: panel.querySelector('#town-msg')?.value || '' });
  });

  // ---------- shops and waypoints ----------
  const shopFloor = () => (traderNear() || 1);
  const shopHas = s => !s.town || (s.town === shopFloor() && unl(s.town, 'stock'));
  const price = base => Math.max(1, Math.round(base * (T(shopFloor())?.mul ?? 1)));
  const smithGold = g => (g ? Math.max(1, Math.round(g * (T(1)?.mul ?? 1))) : g);
  // extra rows for the waypoint panel: each town's gate waystone, once built
  const warpRows = unlocked => TOWN_FLOORS.filter(f => unl(f, 'gate') && unlocked(f)).map(f => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)"><span><b>Floor ${f} — raid gate</b><br><small style="opacity:.7">${esc(TOWNS[f].name)}'s gate waystone</small></span><button data-g="${f}" style="padding:6px 14px;border-radius:7px;border:0;font-weight:800;background:linear-gradient(90deg,#0d9488,#2dd4bf)">Travel</button></div>`).join('');

  // ---------- every frame ----------
  let renderT = 0;
  function frame(dt) {
    const now = performance.now();
    ui.rings = ui.rings.filter(r => { if (now < r.until) { r.m.material.opacity = 0.4 + 0.4 * Math.abs(Math.sin(now / 150)); return true; } scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; });
    if (isOpen() && (renderT += dt) > 1) { renderT = 0; render(); }
    // raid HUD
    if (ui.watch && !isOpen()) { ui.watch = false; send({ type: 'town', op: 'state', watch: 0 }); } // (closed by Esc or the panel registry)
    const R = ui.raid;
    if (R) {
      const html = R.warn ? `<b>RAID</b> on ${esc(TOWNS[R.f].name)} in ${R.left}s · get to the ward` : `<b>RAID</b> wave ${R.wave}/${R.waves} · ward <span class="${R.ward < 35 ? 'no' : ''}">${R.ward}%</span> · ${R.n} raiders · ${fmt(R.left)}`;
      if (hud._h !== html) hud.innerHTML = hud._h = html;
      hud.classList.remove('hidden');
    } else hud.classList.add('hidden');
    if (!state.joined || state.spectator) { lbl.style.display = 'none'; tlbl.style.display = 'none'; return; }
    const f = floorOf(state.x), t = T(f), B = TOWNS[f]?.board;
    let shown = false;
    if (B && Math.hypot(state.x - B.x, state.z - B.z) < 22) {
      const sp = project(B.x, 4.2, B.z);
      if (sp) {
        const near = boardNear() === f;
        if (near) guide?.tip?.('town');
        const html = `Town Board · ${esc(STAGES[t?.stage ?? 0].name)}${t?.steward ? `<br><small>Steward ${esc(t.steward.name)}</small>` : ''}${near ? `<br><small>${tapping() ? 'tap Town' : `press ${keyHtml('interact')} for the town`}</small>` : ''}`;
        lbl.style.display = ''; lbl.style.left = `${sp[0]}px`; lbl.style.top = `${sp[1]}px`;
        if (lbl._h !== html) lbl.innerHTML = lbl._h = html;
        shown = true;
      }
    }
    if (!shown) lbl.style.display = 'none';
    // a camp trader's label (Floors 2 and 3, once built), or the ward's during a raid
    let tl = null;
    const tr = TOWNS[f]?.trader;
    if (tr && unl(f, 'trader') && Math.hypot(state.x - tr.x, state.z - tr.z) < 16) tl = { x: tr.x, z: tr.z, y: 3, html: `Trader${traderNear() ? `<br><small>${tapping() ? 'tap Trade' : `press ${keyHtml('interact')} to trade`}</small>` : ''}` };
    if (R && TOWNS[R.f]) tl = { x: TOWNS[R.f].ward.x, z: TOWNS[R.f].ward.z, y: 4.6, html: `The Ward<br><small>${R.ward}%</small>` };
    const sp = tl && project(tl.x, tl.y, tl.z);
    if (sp) { tlbl.style.display = ''; tlbl.style.left = `${sp[0]}px`; tlbl.style.top = `${sp[1]}px`; if (tlbl._h !== tl.html) tlbl.innerHTML = tlbl._h = tl.html; } else tlbl.style.display = 'none';
  }

  return { interactKind, interact, onMsg, onEvent, snap, frame, toggle, render, isOpen, traderNear, shopHas, price, smithGold, warpRows, data: () => ui.data };
}
