// Level-1 social layer for bots: party orders (/b chat orders + the command wheel) and rate-limited chatter.
// Shared by the bot brain (shared/bots/brain.js), the server (validates `botcmd`) and the client's command wheel.

import { VOICE, chatScale } from './personality.js'; // chattiness and voice (docs/briefs/personalities.md)
import { parsePlan, isStepWord } from './plan.js'; // plans: several steps in one line (docs/briefs/bot-plans.md)

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
  setme: { label: 'Set me up', icon: '✦' },
  status: { label: 'Status', icon: '?' },
  leave: { label: 'Leave party', icon: '⨯', wheel: false },
  tend: { label: 'Tend my garden', icon: '❀', wheel: false }, // life classes: hold at the town garden (shared/life.js)
  cancel: { label: 'Cancel the plan', icon: '✕', wheel: false }, // drop the plan and the current order (shared/bots/plan.js)
};
export const BOT_COMMAND_IDS = Object.keys(BOT_COMMANDS);

// Chat orders: only lines starting with /b (or /bot, /bots) are orders; ordinary chat never is.
//   /b <order>          every bot in your party        /b <name>: <order>   one bot (also "/b <name> <order>")
//   /b help             lists the orders               aliases below: the first word of the order picks it
//   /b <step> then <step> ...   a plan (shared/bots/plan.js): also one step with arguments, "/b farm 10 boars"; a plain
//                               single order word stays the order it always was
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
  setme: ['setme', 'setup', 'set', 'combo', 'combos'],
  status: ['status', 'report', 'sitrep'],
  leave: ['leave', 'dismiss'],
  tend: ['tend', 'garden'],
  cancel: ['cancel', 'abort', 'nevermind'],
};
const ALIAS = new Map(Object.entries(BOT_ALIASES).flatMap(([cmd, words]) => words.map(w => [w, cmd])));
const ALL_WORDS = new Set(['all', 'bots', 'everyone', 'team', 'party']);
const PREFIX = /^\/(?:b|bot|bots)(?=\s|$)\s*([\s\S]*)$/i;
const word = s => s.toLowerCase().replace(/[^\w']/g, '');
const cleanName = s => String(s || '').replace(/[^\w \-.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

// Parse a chat line. Returns null when it isn't a /b line (ordinary chat: never an order), else one of
// { help: true } | { cmd, name } (name '' = every bot in your party) | { plan: { steps, loops }, name } | { error }.
export function parseBotChat(text) {
  const m = String(text || '').trim().match(PREFIX);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest || /^(help|\?|h)$/i.test(rest)) return { help: true };
  let name = '', order = rest;
  const colon = /^(say|tell|shout)\b/i.test(rest) ? -1 : rest.indexOf(':'); // (a line to say may hold a colon)
  if (colon >= 0) { name = rest.slice(0, colon); order = rest.slice(colon + 1); }
  else { // "/b Lyra heal": the words before the first order word are a name
    const words = rest.split(/\s+/);
    const i = words.findIndex(w => ALIAS.has(word(w)) || isStepWord(w));
    if (i > 0) { name = words.slice(0, i).join(' '); order = words.slice(i).join(' '); }
  }
  const cmd = ALIAS.get(word(order.trim().split(/\s+/)[0] || ''));
  const plan = parsePlan(order); // several steps, or one with arguments ("farm 10 boars"); a bare order word stays an order
  if (plan && !(plan.bare && cmd)) {
    name = cleanName(name);
    if (plan.error) return { error: plan.error };
    return { plan: { steps: plan.steps, loops: plan.loops }, name: ALL_WORDS.has(name.toLowerCase()) ? '' : name };
  }
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
  setme: ['Setting you up, {who}!', "I'll open it for you, {who}.", 'Watch for my setups, {who}!'],
  noTarget: ['Lock a target first (Tab), {who}.', "I can't see your target, {who}."],
  notFloor1: ["I'm not on Floor 1, {who}: the garden's in the Town of Beginnings.", "Can't tend the garden from here, {who}. Bring me to Floor 1."], // (/b tend off Floor 1)
  farm: ['Off to farm.', 'Farming time.'],
  boss: ['To the Warden!', "Let's do the boss.", 'Heading for the boss.'],
  ready: ['Ready!', 'Ready up!', 'Ready.'],
  notGate: ["I'm not at the gate yet.", 'Not at the gate.'],
  healOn: ['Got you, {who}.', 'Keeping you up, {who}.', 'Heals on you.'],
  notHealer: ["I can't heal, but I'll protect you.", 'Not a healer, sorry!'],
  potion: ['Drinking a potion.', 'Potion down.'],
  noPotion: ['Out of potions!', 'No potions left.'],
  leave: ['Heading off. Good luck!', 'Leaving the party. See you!'],
  cancel: ['Okay, dropping that.', 'Standing down.', 'Cancelled.'],
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

// A line in the bot's own voice (shared/bots/personality.js VOICE) about half the time, else the stock line.
export function voiced(b, key, vars = {}) {
  const own = !b.persona?.noVoice && VOICE[b.persona?.id]?.[key];
  if (own?.length && Math.random() < 0.5) return own[Math.floor(Math.random() * own.length)].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return pick(key, vars);
}

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
    if (Math.random() > p * (CHATTY[b.skill] ?? 1) * chatScale(b)) { s.cd[key] = b.t + cd / 3; return false; } // (personality: 0.35-1.4x)
    s.next = b.t + 6 + (5 - (b.skill || 5)) * 2;
    s.cd[key] = b.t + cd;
  }
  s.last = b.t;
  b.send({ type: 'chat', text: (text ?? voiced(b, key, { name: b.name, ...vars })).slice(0, 200), ch: ch || (b.party ? 'p' : 's') });
  b.lastSaid = { key, t: b.t };
  return true;
}
