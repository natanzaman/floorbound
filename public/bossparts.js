// Breakable boss parts (docs/briefs/combat-quickwins.md 1, server/bossparts.js): a pip bar per part under the boss bar
// (grey once broken), a KNEELING line while the Colossus is down, and the callouts. From the snapshot (w.bp:
// [[boss id, [part health %...], kneel s left]]) and the `bpart` / `kneel` events.
import { BOSS_PARTS, PART } from '/shared/bossparts.js';

const CSS = `
#boss .bparts{display:flex;gap:6px;justify-content:center;margin-top:3px;font:700 10px/1.2 system-ui,sans-serif;letter-spacing:.04em}
#boss .bparts:empty{display:none}
#boss .bpart{min-width:74px;color:#fde68a}
#boss .bpart .pb{height:4px;border-radius:2px;background:rgba(0,0,0,.45);overflow:hidden;margin-top:1px}
#boss .bpart .pb div{height:100%;background:linear-gradient(90deg,#f59e0b,#fde047)}
#boss .bpart.broken{color:#9ca3af;text-decoration:line-through}
#boss .bpart.broken .pb div{background:#6b7280}
#boss .kneel{display:none;margin-top:3px;font-weight:800;letter-spacing:.08em;font-size:12px;color:#fca5a5;text-shadow:0 0 8px #ef4444}
#boss.kneeling .kneel{display:block}
`;

export function initBossParts({ state, mobs, fx, sfx, guide, callout }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const box = document.createElement('div'); box.className = 'bparts';
  const kneel = document.createElement('div'); kneel.className = 'kneel';
  document.getElementById('boss')?.append(box, kneel);
  let rows = new Map(); // boss id -> { pct: [...], kneel s, at }

  function snap(bp) {
    rows = new Map((bp || []).map(([id, pct, k]) => [id, { pct, k, at: performance.now() / 1000 }]));
  }

  /** The boss bar: pips for the boss shown there. */
  function bossBar(boss) {
    const r = boss && rows.get(boss.id), P = boss && BOSS_PARTS[boss.type];
    const html = r && P ? P.parts.map((pt, i) => `<div class="bpart ${r.pct[i] <= 0 ? 'broken' : ''}" title="Break it: hit it from its ${pt.name.toLowerCase()} side. Melee counts x${PART.meleeMul}, ranged x${PART.rangedMul}.">${pt.name.toUpperCase()}<div class="pb"><div style="width:${Math.max(0, r.pct[i])}%"></div></div></div>`).join('') : '';
    if (box.innerHTML !== html) box.innerHTML = html;
    const left = r ? r.k - (performance.now() / 1000 - r.at) : 0;
    document.getElementById('boss')?.classList.toggle('kneeling', left > 0);
    if (left > 0) { const t = `KNEELING · +${Math.round(((P?.all?.kneel?.taken || 1) - 1) * 100)}% DAMAGE · ${Math.ceil(left)} s`; if (kneel.textContent !== t) kneel.textContent = t; }
  }

  function near(e, r = 45) { return Math.hypot(e.x - state.x, e.z - state.z) < r; }

  function event(e) {
    if (e.t === 'bpart') {
      const m = mobs.get(e.id), pt = BOSS_PARTS[m?.type]?.parts[e.n];
      if (pt && near(e) && !state.spectator) { callout(pt.call, `${pt.sub} Bonus loot for the party.`, 2.6); guide.tip('bparts'); }
      fx.ring(e.x, e.z, 4, 0xfde047, 0.7); sfx.play('switch', { x: e.x, z: e.z }, 1.2);
      return true;
    }
    if (e.t === 'kneel') {
      const m = mobs.get(e.id), K = BOSS_PARTS[m?.type]?.all?.kneel;
      if (K && m && near({ x: m.tx, z: m.tz })) callout(K.call, K.sub, 2.6);
      if (m) { fx.ring(m.tx, m.tz, 5, 0xfca5a5, 0.8); sfx.play('boom', { x: m.tx, z: m.tz }, 1); }
      return true;
    }
    return false;
  }

  return { snap, bossBar, event };
}
