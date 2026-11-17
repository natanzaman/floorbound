// Level-1 social layer for bots: party orders (/b chat orders + the command wheel) and rate-limited chatter.
// Shared by the bot brain (shared/bots/brain.js), the server (validates `botcmd`) and the client's command wheel.

// Command ids, in command-wheel order. `wheel: false` ones are chat / menu only.
export const BOT_COMMANDS = {
  follow: { label: 'Follow me', icon: '➜' },
  stay: { label: 'Hold here', icon: '■' },
  come: { label: 'Regroup', icon: '◎' },
  attack: { label: 'Attack my target', icon: '⚔' },
  heal: { label: 'Heal me', icon: '✚' },
  farm: { label: 'Go farm', icon: '❦' },
  boss: { label: 'Do the boss', icon: '♛' },
  ready: { label: 'Ready up', icon: '✔' },
  potion: { label: 'Use potion', icon: '⚗' },
  status: { label: 'Status', icon: '?' },
  leave: { label: 'Leave party', icon: '⨯', wheel: false },
};
export const BOT_COMMAND_IDS = Object.keys(BOT_COMMANDS);

// Chat orders: only lines starting with /b (or /bot, /bots) are orders; ordinary chat never is.
//   /b <order>          every bot in your party        /b <name>: <order>   one bot (also "/b <name> <order>")
//   /b help             lists the orders               aliases below: the first word of the order picks it
export const BOT_ALIASES = {
  follow: ['follow', 'f'],
  stay: ['stay', 'hold', 'wait', 'stop', 'halt'],
  come: ['come', 'regroup', 'rally', 'here'],
  attack: ['attack', 'kill', 'focus', 'assist', 'hit'],
  heal: ['heal', 'heals'],
  farm: ['farm', 'grind', 'hunt'],
  boss: ['boss', 'warden', 'sovereign', 'raid'],
  ready: ['ready'],
  potion: ['potion', 'pot', 'drink'],
  status: ['status', 'report', 'sitrep'],
  leave: ['leave', 'dismiss'],
};
const ALIAS = new Map(Object.entries(BOT_ALIASES).flatMap(([cmd, words]) => words.map(w => [w, cmd])));
const ALL_WORDS = new Set(['all', 'bots', 'everyone', 'team', 'party']);
const PREFIX = /^\/(?:b|bot|bots)(?=\s|$)\s*([\s\S]*)$/i;
const word = s => s.toLowerCase().replace(/[^\w']/g, '');
const cleanName = s => String(s || '').replace(/[^\w \-.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

// Parse a chat line. Returns null when it isn't a /b line (ordinary chat: never an order), else one of
// { help: true } | { cmd, name } (name '' = every bot in your party) | { error }.
export function parseBotChat(text) {
  const m = String(text || '').trim().match(PREFIX);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest || /^(help|\?|h)$/i.test(rest)) return { help: true };
  let name = '', order = rest;
  const colon = rest.indexOf(':');
  if (colon >= 0) { name = rest.slice(0, colon); order = rest.slice(colon + 1); }
  else { // "/b Lyra heal": the words before the first order word are a name
    const words = rest.split(/\s+/);
    const i = words.findIndex(w => ALIAS.has(word(w)));
    if (i > 0) { name = words.slice(0, i).join(' '); order = words.slice(i).join(' '); }
  }
  const cmd = ALIAS.get(word(order.trim().split(/\s+/)[0] || ''));
  if (!cmd) return { error: `"${order.trim().slice(0, 24) || rest.slice(0, 24)}" isn't a bot order. Type /b help for the list.` };
  name = cleanName(name);
  if (ALL_WORDS.has(name.toLowerCase())) name = '';
  return { cmd, name };
}

// The /b help listing (system lines for the player who asked).
export function botHelp() {
  return [
    'Bot orders: /b <order> for every bot in your party, /b <name>: <order> for one (also V, the command wheel).',
    ...Object.entries(BOT_COMMANDS).map(([id, c]) => `  /b ${id}: ${c.label}${BOT_ALIASES[id].length > 1 ? ` (also ${BOT_ALIASES[id].slice(1, 3).join(', ')})` : ''}`),
  ];
}

// ---------- chatter ----------
// Lines by situation; {name} = the bot, {who} = the other player, {mob} = a mob name, {n} = a number.
export const LINES = {
  greet: {
    tank: ["Hey! {name} here, I'll keep them off you.", "{name} reporting. I'll hold their attention.", "Hi all, {name}. I'll take the hits."],
    healer: ["Hey! {name} here, I'll keep you alive.", "{name} here, heals on me.", "Hi! {name}. Stay near me and you'll be fine."],
    dps: ["Hey! {name} here, ready to hit things.", "{name} joining. Point me at something.", "Yo, {name}. Let's go."],
    support: ["Hey! {name} here, I'll keep the songs coming.", "{name} joining, buffs incoming."],
  },
  follow: ['On you, {who}.', 'Following.', 'Right behind you.'],
  stay: ['Holding here.', 'Staying put.', 'Holding position.'],
  come: ['On my way!', 'Coming!', 'Regrouping.'],
  attack: ['On it: {mob}!', 'Attacking {mob}.', 'Focusing {mob}.'],
  noTarget: ['Lock a target first (Tab), {who}.', "I can't see your target, {who}."],
  farm: ['Off to farm.', 'Farming time.'],
  boss: ['To the Warden!', "Let's do the boss.", 'Heading for the boss.'],
  ready: ['Ready!', 'Ready up!', 'Ready.'],
  notGate: ["I'm not at the gate yet.", 'Not at the gate.'],
  healOn: ['Got you, {who}.', 'Keeping you up, {who}.', 'Heals on you.'],
  notHealer: ["I can't heal, but I'll protect you.", 'Not a healer, sorry!'],
  potion: ['Drinking a potion.', 'Potion down.'],
  noPotion: ['Out of potions!', 'No potions left.'],
  leave: ['Heading off. Good luck!', 'Leaving the party. See you!'],
  pull: ['Pulling the {mob} in 3...', 'Pulling {mob}, get ready!', 'Engaging the {mob}.'],
  lowHp: ['Low HP, backing off!', "I'm low!", 'Need a heal!'],
  thanks: ['Thanks, {who}!', 'Thanks for the heal, {who}.', 'Ty {who}!'],
  break: ['Broken! Switch!', '{mob} is Broken, switch in!', 'Break! Go go!'],
  niceSwitch: ['Nice Switch!', 'Great Switch, {who}!', 'Clean Switch!'],
  switchIn: ['Switching in!', 'On your Break!'],
  wipe: ['Wipe... regroup and go again.', 'Ouch. Regroup in town.', "That didn't go well. Again!"],
  bossKill: ['GG! We got it!', 'Down it goes! GG', 'Nice work everyone!'],
  levelUp: ['Level {n}!', 'Ding! Level {n}.', 'Level {n}, getting stronger.'],
  grats: ['Grats {who}!', 'Gz {who}!', 'Nice, {who}!'],
  mateDown: ['{who} is down!', 'Lost {who}!'],
  gateWait: ['Waiting at the gate for everyone.', 'At the gate. Ready when you are.'],
  joinedHuman: ['Hey {who}!', 'Welcome, {who}.'],
};
export const pick = (key, vars = {}) => {
  let list = LINES[key] || [key];
  if (!Array.isArray(list)) list = list[vars.role] || Object.values(list)[0]; // by role (greetings)
  return list[Math.floor(Math.random() * list.length)].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
};

// How chatty a bot is by capability (1-5): sloppier players chat less about tactics.
const CHATTY = { 1: 0.4, 2: 0.55, 3: 0.75, 4: 0.9, 5: 1 };

// Rate-limited party chatter. key: a LINES key (and the cooldown bucket); p: chance; cd: seconds before this key again.
// force: replies to orders (always said; orders come at human pace). Never global chat: party chat, or say chat
// (heard nearby) when not in a party.
export function say(b, key, vars = {}, { p = 1, cd = 20, force = false, text = null, ch = null } = {}) {
  if (!b.me || b.closed) return false;
  const s = (b.talk ||= { next: 0, cd: {}, last: -9 });
  if (!force) {
    if (b.t - s.last < 0.8) return false;
    if (b.quiet || b.t < s.next || b.t < (s.cd[key] || 0)) return false;
    if (b.t - (b.partyChatT ?? -99) < 3) return false; // someone else just spoke
    if (Math.random() > p * (CHATTY[b.skill] ?? 1)) { s.cd[key] = b.t + cd / 3; return false; }
    s.next = b.t + 6 + (5 - (b.skill || 5)) * 2;
    s.cd[key] = b.t + cd;
  }
  s.last = b.t;
  b.send({ type: 'chat', text: (text ?? pick(key, { name: b.name, ...vars })).slice(0, 200), ch: ch || (b.party ? 'p' : 's') });
  b.lastSaid = { key, t: b.t };
  return true;
}
