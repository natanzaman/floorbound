// Run a role-playing bot party against a server from Node.
// Usage: node test/team.js [url=ws://localhost:3000/ws]
//        ROLES=guardian,cleric node test/team.js   (leave a slot open for a human DPS; the tank invites them)
//        FLOOR=2 node test/team.js                  (go to Floor 2 once unlocked; farm the Mire, then the Sovereign)
//        BRANCH=A node test/team.js                 (skill evolutions: always branch A / B; random when unset)
//        MASTERY_LOG=60 node test/team.js           (print each bot's mastery points every 60 s)
//        BOT_SKILL=3 node test/team.js              (capability 1-5, shared/botskill.js; default 5 = perfect)
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';

const { team } = startTeam({
  url: process.argv[2] || 'ws://localhost:3000/ws',
  WebSocket,
  roles: (process.env.ROLES || 'guardian,swordsman,cleric').split(','),
  inviteHumans: !!process.env.ROLES,
  floor: Number(process.env.FLOOR) || 1, // FLOOR=2: travel to Floor 2 and fight there
  branch: process.env.BRANCH || null,
  skill: Number(process.env.BOT_SKILL) || 5, // human-like bots for boss tuning (5 = perfect)
  log: console.log,
});
if (process.env.MASTERY_LOG) {
  const t0 = Date.now();
  setInterval(() => {
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    for (const b of team) if (b.mastery) console.log(`[mastery ${mins}m] ${b.name}: ${Object.entries(b.mastery).map(([k, e]) => `${k} ${e.pts.toFixed(0)}${e.br ? `(${e.br})` : ''}`).join(' · ')}`);
  }, Number(process.env.MASTERY_LOG) * 1000);
}
