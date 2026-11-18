// Team threat on the client (docs/ROADMAP.md G3; server rules: server/threat.js, tuning: shared/threat.js).
//  - Who a boss / elite is after: a red chevron over the target, a faint line from the enemy to them, and "→ Name" on
//    the boss bar. Snapshot `w.th` = [[mobId, targetId]].
//  - My threat meter under the boss bar: "You 62% of top", amber "about to pull" at ≥90%; the top sees the runner-up.
//    `me.th` = [bossId, myPct, nextPct].
//  - Cover (Guardian, C or the bar button): dash to the selected ally (else whoever needs it) and take their next hit.
//  - Flanking tags: "Pincer" (only to the two players in it), a small "Flank" the first few times.
import * as THREE from 'three';
import { THREAT, COVER } from '/shared/threat.js';

export function initThreat({ scene, state, players, mobs, fx, sfx, guide, send, floatNum, log, isTouch, $ }) {
  let th = new Map(), me = null, cov = 0, covAt = 0, flankShown = 0;
  const nameOf = id => state.roster.get(id)?.name || players.get(id)?.name || '?';

  // ---------- 3D: chevron over the target, a line from the enemy ----------
  const marks = new Map(); // mobId -> { chev, line }
  const chevGeo = new THREE.ConeGeometry(0.34, 0.62, 3);
  function mark(id) {
    let k = marks.get(id);
    if (k) return k;
    const chev = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.95, depthTest: false }));
    chev.rotation.x = Math.PI; chev.renderOrder = 11;
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 1), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35, depthWrite: false }));
    scene.add(chev, line);
    marks.set(id, k = { chev, line });
    return k;
  }
  function unmark(id) {
    const k = marks.get(id); if (!k) return;
    scene.remove(k.chev, k.line); k.chev.material.dispose(); k.line.geometry.dispose(); k.line.material.dispose();
    marks.delete(id);
  }

  function frame(now) {
    for (const id of [...marks.keys()]) if (!th.has(id)) unmark(id);
    for (const [mid, pid] of th) {
      const m = mobs.get(mid), p = players.get(pid);
      if (!m || m.dying || !p || p.dead) { unmark(mid); continue; }
      const k = mark(mid), mp = m.model.group.position, pp = p.model.group.position;
      const mine = pid === state.myId;
      k.chev.position.set(pp.x, (p.model.height || 2) + 1.05 + Math.sin(now / 180) * 0.08, pp.z);
      k.chev.scale.setScalar(m.def?.boss ? 1 : 0.75);
      k.chev.material.color.setHex(mine ? 0xf87171 : 0xef4444);
      const dx = pp.x - mp.x, dz = pp.z - mp.z, len = Math.hypot(dx, dz) || 0.1;
      k.line.position.set((pp.x + mp.x) / 2, 0.12, (pp.z + mp.z) / 2);
      k.line.rotation.y = Math.atan2(dx, dz); k.line.scale.z = len;
      k.line.visible = len < 40;
      k.line.material.opacity = mine ? 0.5 : 0.3;
    }
  }

  // ---------- boss bar: target name + my meter ----------
  let tgtEl = null, meterEl = null;
  function bossBar(boss) {
    const box = $('boss');
    if (!tgtEl) {
      tgtEl = document.createElement('div'); tgtEl.className = 'boss-tgt';
      box.querySelector('.boss-name').after(tgtEl);
      meterEl = document.createElement('div'); meterEl.className = 'threat-meter hidden';
      meterEl.innerHTML = '<div class="bar"><div></div></div><span></span>';
      box.querySelector('#boss-phase').before(meterEl);
    }
    const tid = boss && th.get(boss.id);
    const tt = tid ? `→ ${tid === state.myId ? 'YOU' : nameOf(tid)}` : '';
    if (tgtEl.textContent !== tt) tgtEl.textContent = tt;
    tgtEl.classList.toggle('me', tid === state.myId);
    const mine = me && boss && me[0] === boss.id && !state.spectator ? me : null;
    meterEl.classList.toggle('hidden', !mine);
    if (!mine) return;
    const [, pct, next] = mine, top = pct >= 100, warn = !top && pct >= THREAT.warn;
    meterEl.firstChild.firstChild.style.width = `${top ? 100 : pct}%`;
    meterEl.classList.toggle('warn', warn); meterEl.classList.toggle('top', top);
    const txt = top ? `You have its attention${next ? ` · next ${next}%` : ''}` : warn ? `You ${pct}% of top · about to pull!` : `You ${pct}% of top`;
    const span = meterEl.lastChild; if (span.textContent !== txt) span.textContent = txt;
    if (warn) guide.tip(state.cls === 'cleric' ? 'healthreat' : 'threat');
  }

  function snap(w, m) {
    th = new Map(w.th || []);
    if (m !== undefined) { me = m?.th || null; if (m && m.cov !== undefined) { cov = m.cov; covAt = performance.now(); } }
  }

  // ---------- Cover ----------
  const coverLeft = () => Math.max(0, cov - (performance.now() - covAt) / 1000);
  function cover() {
    if (state.cls !== 'guardian' || state.dead || !state.joined || state.spectator) return;
    if (coverLeft() > 0.15) return;
    send({ type: 'cover', tid: state.focus || 0 });
    cov = COVER.cd; covAt = performance.now(); // the server corrects it
    guide.tip('cover');
  }
  const coverButton = (cls, touch) => cls === 'guardian'
    ? `<button class="sk sc" data-slot="cover" title="Cover: dash to an ally (the one you selected, else whoever an enemy is after) and take their next hit. ${COVER.cd}s cooldown."><span class="key">${touch ? '' : 'C'}</span>Cover<span class="cd"></span><span class="cdt"></span></button>` : '';
  function bindCover(b) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('pressed'); cover(); });
    const up = () => b.classList.remove('pressed');
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  }
  function coverCd(btn) {
    const left = coverLeft();
    btn.querySelector('.cd').style.setProperty('--p', `${Math.min(100, (left / COVER.cd) * 100)}%`);
    btn.querySelector('.cdt').textContent = left > 0.3 ? left.toFixed(left < 3 ? 1 : 0) : '';
  }

  // ---------- events ----------
  function event(e) {
    const my = state.myId;
    switch (e.t) {
      case 'cover': {
        if (e.fail) { if (e.to === my) log(`No ally within ${COVER.range} m to Cover.`, 'sys'); return true; }
        fx.line(e.x, e.z, e.x2, e.z2, 0xfbbf24, 0.6, 0.35, 0.8);
        fx.ring(e.x2, e.z2, 2.2, 0xfbbf24, 0.4);
        const g = players.get(e.id), a = players.get(e.w);
        if (a) fx.shield(a.model.group, e.d || COVER.window, 0xfbbf24);
        if (g) sfx.play('roll', g.model.group.position, e.id === my ? 1 : 0.6);
        if (a && e.w === my) floatNum(a.model.group.position, 2.6, `Covered by ${nameOf(e.id)}`, 'evade');
        if (e.id === my) cov = Math.max(cov, COVER.cd - 0.05), covAt = performance.now();
        return true;
      }
      case 'covered': { // the Guardian took the hit: shown to the two of them
        const g = players.get(e.id);
        if (g && (e.id === my || e.w === my)) floatNum(g.model.group.position, 2.8, 'COVER!', 'cover');
        if (g) sfx.play('shield', g.model.group.position, 0.7);
        return true;
      }
      case 'flank': {
        if (e.to !== my) return true; // a reaction: only the players in it
        const p = players.get(my); if (!p) return true;
        if (e.k === 'pincer') { floatNum(p.model.group.position, 2.3, 'Pincer', 'pincer'); guide.tip('pincer'); }
        else if (flankShown++ < 4) { floatNum(p.model.group.position, 2.3, 'Flank', 'pincer'); guide.tip('flank'); }
        return true;
      }
    }
    return false;
  }

  function keydown(k, e) { if (k === 'c' && !e.repeat) { cover(); return true; } return false; }

  return { snap, frame, bossBar, event, keydown, coverButton, bindCover, coverCd, cover, get map() { return th; }, get me() { return me; } };
}
