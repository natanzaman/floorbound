// Enemies that force a role (docs/briefs/combat-quickwins.md 2, server/mobroles.js): the tags and telegraphs of the
// Ironhide Boar's plate, the Mire Bulwark's shield, and the Mire Hexer's heal channel ({ t: 'mrole', k, id, ... }).
// Also the weapon swap's sound and tip ('wswap'). The Gale Harrier reuses the harpy's ALOFT tag (public/floor3client.js); models: world.js lookAlike.

export function initMobRoles({ state, mobs, fx, sfx, guide, floatNum }) {
  const last = new Map(); // mob id -> when its last tag showed (ms)
  const tag = (m, text, cls = 'evade', ms = 350) => {
    const now = performance.now();
    if (!m || now - (last.get(m.id) || 0) < ms) return;
    last.set(m.id, now); floatNum(m.model.group.position, m.model.height + 0.3, text, cls);
  };
  const near = (x, z, r) => Math.hypot(x - state.x, z - state.z) < r;

  function event(e) {
    if (e.t === 'wswap') { if (e.id === state.myId) { sfx.play('ui', null, 0.8); guide.tip('wswap'); } return true; } // a weapon swap (server/weaponswap.js)
    if (e.t !== 'mrole') return false;
    const m = mobs.get(e.id), at = { x: e.x, z: e.z };
    switch (e.k) {
      case 'plate': if (e.to === state.myId) { tag(m, 'ARMOURED'); guide.tip('plate'); } break;
      case 'cracked': fx.shatter?.(e.x, e.z, false); sfx.play('switch', at, 0.9); tag(m, 'PLATE CRACKED', 'crit', 0); break;
      case 'shieldDown': fx.shatter?.(e.x, e.z, true); sfx.play('shield', at, 1); tag(m, 'SHIELD DOWN', 'crit', 0); if (near(e.x, e.z, 25)) guide.tip('bulwark'); break;
      case 'chan': // the Hexer's heal channel: interrupt it
        fx.telegraph(e.x, e.z, e.r, e.d, () => mobs.get(e.id)?.model.group.position);
        sfx.play('spell', at, 0.8); tag(m, 'MENDING: INTERRUPT!', 'crit', 0);
        if (near(e.x, e.z, 25)) guide.tip('hexer');
        break;
      case 'mend': fx.ring(e.x, e.z, e.r, 0x86efac, 0.8); sfx.play('spell', at, 1.1); break;
      case 'interrupt': fx.ring(e.x, e.z, 1.6, 0xfde047, 0.4); tag(m, 'INTERRUPTED · STUNNED', 'switch', 0); sfx.play('shield', at, 0.6); break;
    }
    return true;
  }
  return { event };
}
