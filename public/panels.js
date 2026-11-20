// The panel registry (roadmap K): the windows the game opens over play, in one place.
//   register(id, { esc, onClose })  esc: Esc closes it (bag, players, ...); otherwise its own module handles Esc (Skill
//                          Tree, the bot wheel, the Game Menu). Every registered panel frees the cursor while it's open.
//                          onClose: called when close() hides it (its module's own close(): the Controls screen)
//   open(id) · close(id)   (close() with no id: every Esc-closable panel)
//   isOpen(id)             (no id: is any panel open)
//   top()                  the panel opened last that is still open (focus navigation, K1b)
// Panels show and hide by the 'hidden' class, as everywhere in the game; the registry watches it, so code that
// toggles the class directly still keeps the order right.
export function createPanels() {
  const reg = new Map(); // id -> { esc, onClose, el }
  const order = []; // ids, most recently opened last
  const shown = el => !!el && el.isConnected && !el.classList.contains('hidden');
  function el(id) { // (some panels are made later, by their modules)
    const r = reg.get(id);
    if (!r) return null;
    if (!r.el || !r.el.isConnected) {
      r.el = document.getElementById(id);
      if (r.el && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => { const i = order.indexOf(id); if (i >= 0) order.splice(i, 1); if (shown(r.el)) order.push(id); })
          .observe(r.el, { attributes: true, attributeFilter: ['class'] });
        if (shown(r.el)) order.push(id);
      }
    }
    return r.el;
  }
  return {
    register(id, { esc = false, onClose = null } = {}) { reg.set(id, { esc, onClose, el: null }); el(id); },
    isOpen(id) { return id ? shown(el(id)) : [...reg.keys()].some(k => shown(el(k))); },
    open(id) { el(id)?.classList.remove('hidden'); },
    close(id) {
      const hide = k => { const e = el(k); if (!e) return; const was = shown(e); e.classList.add('hidden'); if (was) reg.get(k).onClose?.(); };
      if (id) { hide(id); return; }
      for (const [k, r] of reg) if (r.esc) hide(k);
    },
    top() { for (const k of reg.keys()) el(k); for (let i = order.length - 1; i >= 0; i--) if (shown(el(order[i]))) return order[i]; return [...reg.keys()].find(k => shown(el(k))) || null; },
    ids: () => [...reg.keys()],
  };
}
