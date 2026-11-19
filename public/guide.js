// First-time player guide: a short step-by-step card plus one-time contextual tips.
// Progress is kept in this browser, per character, and reported to the server for play tracking.
import { COMBOS } from '/shared/teamplay.js'; // combo tips (G2)

const touch = () => document.body.classList.contains('touch');

export const STEPS = [ // (the Game Menu's Controls & guide lists them too)
  { id: 'move', title: 'Find your feet', text: () => touch() ? 'Drag on the left half of the screen to move. Drag on the right half to look around.' : 'Move with WASD (S walks backwards, A/D strafe). Click the game, then move the mouse to look around. Esc frees the cursor. Prefer right-drag? Change it in Settings.' },
  { id: 'hit', title: 'First strike', text: () => `Head north out of town and hit a Forest Boar. ${touch() ? 'Tap the big attack button' : 'Click (or press J)'} to attack; it aims at the nearest enemy.` },
  { id: 'dodge', title: 'Dodge', text: () => `A red shape on the ground means an attack is coming. ${touch() ? 'Tap Dodge' : 'Press Shift'} to roll through it: you can't be hit mid-roll.` },
  { id: 'kill', title: 'Defeat an enemy', text: () => 'Finish one off. Enemies drop gold, potions and sometimes gear.' },
  { id: 'bag', title: 'Your bag', text: () => touch() ? 'Tap Bag to equip gear. The red Potion button heals you.' : 'Press B to open your bag and equip gear. Press 4 to drink a Health Potion.' },
  { id: 'party', title: 'Find a party', text: () => `Floorbound is built for groups. ${touch() ? 'Tap Players' : 'Press P'} → Find party to be matched with other players, or invite someone.`, skip: 'Play solo for now' },
  { id: 'switch', title: 'Learn to Switch', text: () => 'At level 3 you unlock a Break skill. Break an enemy (it shows BROKEN), then a DIFFERENT teammate hits it for a SWITCH: 2.5× damage.', skip: 'Skip' },
  { id: 'gate', title: 'The Raid Gate', text: () => `At level 5 or so, follow the road north to the Raid Gate. Everyone there ${touch() ? 'taps Ready' : 'presses F'}; it opens after a 5-second countdown.` },
  { id: 'boss', title: 'Defeat the Horned Warden', text: () => `It gets nastier at 66% and 33% health. When it stomps, ${touch() ? 'Jump' : 'jump (Space)'} over the Quake Ring as it reaches you (or roll through it). Whoever lands the final blow earns the Last Attack Bonus.` },
];

const TIPS = {
  wedge: 'Red wedge: a bite is coming. Step out of it or roll.',
  aim: 'Something is aiming down that red line. Sidestep it.',
  slam: 'Red circle: a ground slam (the Warden rears up, axe overhead). Roll out, or jump just as it lands: you can steer in the air.',
  lane: 'Charge lane! Get out sideways, fast.',
  rock: 'Rockfall: a circle drops under everyone. Keep moving.',
  bt_stack: 'STACK: a shared meteor follows one player (gold circle). Everyone inside splits the hit: alone it nearly kills, three or more barely hurt. Rolling won\'t dodge it.',
  bt_spread: 'SPREAD: marked players (violet ring) burst when it runs out, hurting everyone else inside. Marked? Move away from your party. Not marked? Stay out of the rings.',
  bt_tether: 'Tether: a beam links two players and hurts both until they are 15 m apart (it turns green). Run away from each other to snap it.',
  quake: 'Quake Ring! A shockwave rolls out from the Warden: jump just as it reaches you, roll through it, or stand outside the amber circle.',
  lowhp: 'Low health! Drink a potion (4) or back off; you heal out of combat.',
  broken: 'BROKEN: the next hit from a different player is a SWITCH for 2.5× damage.',
  loot: 'You found gear! Open your bag (B) to equip it.',
  howl: 'The Alpha howled: nearby wolves are frenzied. Back off or burst them down.',
  mats: 'Materials! Take them to the Smith in town to refine or craft gear.',
  affix: 'Bonus stats! Uncommon and better gear rolls 1-3 affixes (the blue lines): crit, haste, skill damage, combo damage, faster revives... Hover an item in the bag to compare. The Smith can reroll one affix.',
  setpiece: 'A SET PIECE! Each boss drops its own 2-3 piece set (better odds if you land the Last Attack). Wear 2 or 3 pieces for set bonuses: your bag shows the progress.',
  loadout: 'Loadouts: save up to 3 builds (gear, weapon style, talents) in your bag and swap them in town or at a camp, out of combat.',
  posture: 'Yellow bar = posture. Every hit fills it; heavy finishers, Break skills, perfect dodges and parries fill it fast. When it\'s full the enemy is BROKEN.',
  perfect: 'PERFECT dodge! Rolling just before a hit lands staggers the attacker\'s posture, and your next hit does +50% damage.',
  peril: 'Orange = perilous: dodge through it or parry (Guardian R). Shields won\'t save you.',
  rguard: 'R is the Guardian\'s guard: hold it to block, tap it just before a hit to parry.',
  bell: 'The Tower Bell: someone cleared a floor for the first time on this server. One bell per floor; a hundred bells and the tower lets you go. Their names are carved on the Hall of Clearers stone in town.',
  named: 'The Named live in this tower too: the Hearthward (a party of four) and Cairn, who hunts alone. You meet them out in the field (invite or call one and they come to you). Fight beside them, revive or heal them and they warm to you: Players → Friends shows where you stand. Talk to them too: say their name nearby ("Cairn, rough day?") or press Talk (@name works from anywhere). They remember you, and a good talk helps a little. Allies can invite a Hero; Sworn friends can call one. They ask favours too: take one from their card for gold and friendship.',
  bubbles: 'Chat lines pop up as speech bubbles over the speaker\'s head: /s is heard nearby, /p by your party. Settings turns bubbles off; the chat log keeps everything.',
  botmind: 'Talk to bots by name in chat: "Lyra, hang back and heal me". They answer in a speech bubble (the dots mean they\'re thinking) and remember how you like to play. /b orders still work as before.',
  bots: 'Bots in your party take orders: hold V for the order wheel, or type /b stay, /b follow, /b Lyra: heal (one bot). /b help lists them all; ordinary chat never gives orders.',
  poses: 'Posed! Chat /kneel, /sit or /bow to strike a pose, /stand (or just move, attack, dodge or jump) to get up.',
  threat: 'Threat: the red arrow (and "→ name" on the boss bar) shows who the boss is after. Your bar under it is your threat vs the top; amber means you are about to pull it off your tank. Ease off for a moment.',
  healthreat: 'Healing builds threat too (half the healing, shared across the enemies in the fight). Heal hard and the boss comes for you: let your Guardian Taunt it back.',
  cover: 'Cover (C): dash to an ally (the one you selected, else whoever needs it) and take their next hit, braced like a guard. Perilous hits still need a dodge or parry.',
  pincer: 'Pincer! You and a partymate are on opposite sides of the enemy: both of you deal +15% damage and more posture.',
  flank: 'Flank: hitting an enemy from behind deals +8% damage and more posture. Get a partymate on its other side for a Pincer.',
  downed: 'Downed! You have 15 s before you bleed out. Crawl toward your party: a partymate holds E next to you to revive you.',
  revive: 'A partymate is down! Stand next to them and hold E to revive them (a Cleric\'s Heal speeds it up). Moving away or a heavy hit breaks it.',
  combo: 'COMBO! One player sets up (launch, stun, Mark, Discord, Sanctuary), a partner pays it off within 2.5 s. Combos chain on a target and fill the Team Burst bar.',
  tbfull: () => `Team Burst ready! ${touch() ? 'Tap the bar' : 'Press T'} to start a 3 s sync window: every partner who joins makes the finisher bigger (solo works too, weaker).`,
  // Floor 3 — The Gale Spires (public/floor3client.js)
  f3air: 'Gale Harpies aloft take only a third of melee damage: shoot them from range, or hit them hard when they land after a dive (grounded: +25%).',
  f3armor: 'Spire Sentinels are armoured: most damage bounces off until you BREAK them (fill the posture bar). A cracked shell takes full damage for 8 s. Jump or roll its stomp.',
  f3ward: 'A Storm Acolyte is channelling a Wind Ward (the swirling ring): interrupt it with a stun, a Break, Smite or 3 quick hits, or every enemy near it gets a shield.',
  f3ram: 'Crag Ram lane! It charges through and throws you back. Sidestep, roll, or (Guardian) hold guard facing it to stop it dead and stun it.',
  f3gust: 'Gale Push: a cone of wind in front of the Colossus. Get behind or beside it, or roll through it, or it throws you across the plateau.',
  f3overload: 'OVERLOAD: the Colossus kneels and charges the storm. Its guard is open: BREAK it, then a different player hits it (a Switch), or fire a Team Burst. Stop it and it is Grounded (+30% damage); fail and Thunderclap hits everyone for over half their health.',
  f3beam: 'Tempest Beam: the Colossus plants its sword and a beam sweeps all the way round. Jump (Space) just as it reaches you, or roll through it. Down in the Undercroft, a great rune-ringed pillar between you and the Colossus blocks it.',
  f3fall: 'The plateau is cracking under the Colossus! In a moment everyone falls into the hall below (no fall damage). You land, catch your breath, and it drops in after you: get clear of where it lands.',
  f3under: 'The Undercroft: thick SLUDGE slows you hard and you can\'t roll in it; FIRE spreads across the floor in patterns (a glowing ring warns you first); the great rune-ringed pillars block the Tempest Beam. Walls and pillars block you too.',
  f3fire: 'Fire is about to break out where the rings glow. Step out before they burn: standing in the flames hurts several times a second.',
  f3sludge: 'Stuck in sludge: it slows you to under half speed and you can\'t roll. Wade out (or jump) before a big hit lands.',
  mvp: 'That was the post-fight card: everyone in the fight sees it after a boss kill or wipe. Titles go to whoever led: Lifeline for revives, Wall for tanking, Conductor for combos, Last Word for the Last Attack...',
  menu: () => `${touch() ? 'Tap ☰' : 'Press Esc'} for the Game Menu: Settings (graphics quality too), controls, change character, log out. The game keeps running while it's open.`,
  tbsync: () => `A partner started a TEAM BURST: ${touch() ? 'tap the prompt' : 'press T'} now to join it. More joiners, bigger burst.`,
  ...Object.fromEntries(Object.entries(COMBOS).map(([k, c]) => [`combo_${k}`, c.tip])),
};

export class Guide {
  constructor({ el, tipEl, send }) {
    this.el = el; this.tipEl = tipEl; this.send = send;
    this.key = null; this.step = 0; this.off = false;
    try { this.seen = new Set(JSON.parse(localStorage.getItem('fb_tips') || '[]')); } catch { this.seen = new Set(); }
  }

  start(charKey, lvl) {
    this.key = `fb_guide_${charKey}`;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch {}
    if (saved) { this.step = saved.step | 0; this.off = !!saved.off; }
    else { this.step = lvl >= 5 ? 4 : lvl >= 3 ? 3 : 0; this.off = false; } // veterans skip the basics
    this.render();
  }

  save() { try { localStorage.setItem(this.key, JSON.stringify({ step: this.step, off: this.off })); } catch {} }

  get current() { return STEPS[this.step]?.id; }

  // Called with things the player did; advances the card when it matches the current step.
  did(id) {
    const i = STEPS.findIndex(s => s.id === id);
    if (i < 0 || i < this.step) return;
    if (i > this.step && !(id === 'party' || id === 'switch' || id === 'boss' || id === 'gate')) return; // basics happen in order
    this.advance(i + 1);
  }

  advance(to) {
    this.step = Math.max(this.step, to);
    this.send({ type: 'track', k: 'guide', step: this.step });
    this.save();
    this.el.classList.add('done');
    setTimeout(() => { this.el.classList.remove('done'); this.render(); }, 700);
  }

  render() {
    const s = STEPS[this.step];
    if (this.off || !s) { this.el.classList.add('hidden'); return; }
    this.el.classList.remove('hidden');
    this.el.innerHTML = `<div class="g-head"><span>NEW ADVENTURER · ${this.step + 1}/${STEPS.length}</span><button class="g-x" title="Hide tips">✕</button></div>
      <b>${s.title}</b><div>${s.text()}</div>${s.skip ? `<button class="g-skip">${s.skip}</button>` : ''}`;
    this.el.querySelector('.g-x').onclick = () => { this.off = true; this.save(); this.render(); };
    const sk = this.el.querySelector('.g-skip');
    if (sk) sk.onclick = () => this.advance(this.step + 1);
  }

  // One-time contextual tip.
  tip(id) {
    if (this.off || this.seen.has(id) || !TIPS[id]) return;
    this.seen.add(id);
    try { localStorage.setItem('fb_tips', JSON.stringify([...this.seen])); } catch {}
    this.tipEl.textContent = typeof TIPS[id] === 'function' ? TIPS[id]() : TIPS[id];
    this.tipEl.classList.remove('show'); void this.tipEl.offsetWidth; this.tipEl.classList.add('show');
    clearTimeout(this.tipT); this.tipT = setTimeout(() => this.tipEl.classList.remove('show'), 6500);
  }
}
