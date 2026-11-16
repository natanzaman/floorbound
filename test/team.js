// Run a role-playing bot party against a server from Node.
// Usage: node test/team.js [url=ws://localhost:3000/ws]
//        ROLES=guardian,cleric node test/team.js   (leave a slot open for a human DPS; the tank invites them)
import WebSocket from 'ws';
import { startTeam } from '../shared/teambots.js';

startTeam({
  url: process.argv[2] || 'ws://localhost:3000/ws',
  WebSocket,
  roles: (process.env.ROLES || 'guardian,swordsman,cleric').split(','),
  inviteHumans: !!process.env.ROLES,
  log: console.log,
});
