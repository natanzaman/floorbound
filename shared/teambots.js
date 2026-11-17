// Bot teams, shared by the Node runner (test/team.js), the in-browser page (/bots.html) and server/botmanager.js.
//
// Every bot has its OWN brain (shared/bots/brain.js): its own connection, role (from its class plug-in,
// shared/bots/registry.js + shared/bots/classes.js), behaviour, capability level (shared/botskill.js) and goal.
// startTeam() only creates bots and puts them into one party: the tank (else the first bot) invites the others.
// Party teamwork (cohesion, assist, roles, Switch co-op, raid-gate ready checks) emerges from the party as each bot sees
// it in the snapshot, real players included; party members command bots in chat or with the command wheel.
//
// Behaviours (per bot): 'auto' level up (boars, wolves) then the Warden; 'field' farm near town; 'warden' straight to
// the Warden; 'floor2' to Floor 2 (Mire, then the Sovereign); 'follow' a named player (fight alongside them).
// In a party, the leader's behaviour sets the course: a human in the party leads; otherwise the tank (or the first bot).
import { createBot } from './bots/brain.js';
import { defaultName, registerClassBrain, registerBotHook } from './bots/registry.js';

export { createBot, registerClassBrain, registerBotHook };
export const TEAM_NAMES = { guardian: 'Brann', swordsman: 'Kael', cleric: 'Lyra' };

// names: optional name per role; join: extra fields for the join message (e.g. the server's bot key and a level);
// skill: capability 1-5 (or one per role); inviteHumans: the host also invites any human who shows up.
export function startTeam({ url, WebSocket, roles = ['guardian', 'swordsman', 'cleric'], suffix = '', inviteHumans = false, log = () => {}, floor = 1, branch = null, names = null, join = {}, behaviour = 'auto', follow = '', skill = 5 }) {
  const peers = new Set(); // the server only flags its own bots: teammates know each other
  const team = roles.map((cls, i) => {
    const b = createBot({ peers,
      url, WebSocket, cls, name: names?.[i] || (TEAM_NAMES[cls] || defaultName(cls)) + suffix, join, behaviour, follow,
      skill: Array.isArray(skill) ? skill[i] : skill, floor, branch, log, logEvents: i === 0,
    });
    b.i = i;
    return b;
  });
  const host = team.find(b => b.role === 'tank') || team[0];
  const invited = new Set();
  const formParty = team.length > 1 && setInterval(() => { // once everyone is in
    if (!team.every(b => b.id || b.closed)) return;
    clearInterval(formParty);
    for (const b of team) if (b !== host && b.id && !b.closed) { invited.add(b.id); host.send({ type: 'invite', id: b.id }); }
  }, 100);
  const inviteLoop = inviteHumans && setInterval(() => {
    if (host.closed) return;
    for (const p of host.players) if (!invited.has(p.id) && !team.some(b => b.id === p.id) && !host.names.get(p.id)?.bot && !peers.has(p.id)) { invited.add(p.id); host.send({ type: 'invite', id: p.id }); }
  }, 1000);
  const stopTimers = () => { clearInterval(formParty); clearInterval(inviteLoop); };
  for (const b of team) b.ws.addEventListener('close', () => { if (team.every(x => x.closed)) stopTimers(); });
  return {
    team,
    stop() { stopTimers(); for (const b of team) b.stop(); },
    drop(b) { b.stop(); },                       // disconnect one bot; the rest carry on
    setSkill(b, v) { b.setSkill(v); },           // one bot's capability level
    configure(o = {}) { for (const b of team) b.configure(o); }, // behaviour / follow for every bot of this group
  };
}
