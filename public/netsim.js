// Test-only bad network: ?netsim=120,60,2 delays every message from the server by 120 ± 60 ms (kept in order, like
// TCP: a message never arrives before the one sent ahead of it) and holds 2% of them back 75 ms so the next overtakes
// them (out of order). Messages to the server are not delayed, so the ping readout shows about the first number.
// Off unless the URL asks for it.
export function makeNetsim(spec) {
  const m = /^(\d+)(?:,(\d+))?(?:,([\d.]+))?$/.exec(spec || '');
  if (!m) return null;
  const lat = +m[1], jit = +(m[2] || 0), reorder = +(m[3] || 0) / 100;
  let lastAt = 0;
  return {
    lat, jit, reorder,
    deliver(data, fn) {
      const now = performance.now();
      const at = Math.max(lastAt, now + lat + (Math.random() * 2 - 1) * jit);
      if (Math.random() < reorder) { setTimeout(() => fn(data), at - now + 75); return; } // the next one overtakes it
      lastAt = at;
      setTimeout(() => fn(data), at - now);
    },
  };
}
