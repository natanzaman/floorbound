// Graceful shutdown for deploys. Render sends SIGTERM to the old instance once the new one is serving (zero-downtime
// deploy), then SIGKILL after maxShutdownDelaySeconds (render.yaml, up to 300). On SIGTERM we warn everyone, let a
// running boss fight finish (at most HOLD_MS: 4 minutes on Render, so we exit before the SIGKILL), save every
// character and exit. Clients reconnect on their own (public/main.js), to the new instance.
import { inArena } from '../shared/data.js';
import { inArena2 } from '../shared/floor2.js';

export const UPDATE_MSG = "Update incoming: you'll reconnect in a moment.";
// How long a boss fight may hold a shutdown: 4 minutes on Render (RENDER=true there), none elsewhere (local servers
// and test harnesses stop at once after saving); SHUTDOWN_HOLD_MS overrides either.
export const HOLD_MS = process.env.SHUTDOWN_HOLD_MS !== undefined && process.env.SHUTDOWN_HOLD_MS !== '' ? Number(process.env.SHUTDOWN_HOLD_MS) || 0 : process.env.RENDER ? 240000 : 0;

// A boss fight with real players in it: the Warden or the Sovereign engaged (or its gate open) with a player in the arena.
export function bossFightLive(game) {
  const humans = [...game.players.values()].filter(p => !p.bot && !p.dead);
  const fight = (boss, gate, inRoom) => !!boss && !boss.dead && (boss.threat?.size > 0 || gate?.open) && humans.some(p => inRoom(p.x, p.z));
  return fight(game.boss, game.gate, inArena) || fight(game.sovereign, game.gate2, inArena2);
}

// Drains, then resolves (the caller exits). notify(text) tells everyone; save() saves every character.
export async function drain({ game, notify, save, holdMs = HOLD_MS, pollMs = 1000, log = console.log }) {
  const t0 = Date.now();
  notify(UPDATE_MSG);
  let held = false;
  while (bossFightLive(game) && Date.now() - t0 < holdMs) {
    if (!held) { held = true; log(`shutdown: a boss fight is on, waiting (up to ${Math.round(holdMs / 1000)} s)`); notify('A boss fight is on: the update waits until it ends.'); }
    await new Promise(r => setTimeout(r, pollMs));
  }
  if (held) notify(bossFightLive(game) ? 'Out of time: updating now.' : 'Fight over: updating now.');
  await save();
  return { held, waited: Date.now() - t0 };
}
