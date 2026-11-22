// Talent trees: data and rules shared by the server (spending, effects) and the client (Skill Tree window).
//
// - 1 talent point per level from level 2 (19 at level 20). Spend them in your class's tree: 3 branches, 5 tiers.
// - Tier k opens once you have spent TALENTS.tiers[k] points in the tiers above it (0 / 3 / 6 / 10 / 14).
// - A node with `req` needs at least one rank in ANY of the listed nodes (the lines in the tree).
// - Nodes have 1-3 ranks; the bottom node of each branch is a KEYSTONE that changes how you play.
// - Spending works anywhere; refunds / a full respec are free but only at a Skill Shrine in town.
//
// A NEW CLASS = a new entry in TREES (same shape). Node ids must be unique across classes.
// Effects (per rank; the server multiplies by the rank):
//   { stat: 'atk' | 'hp' | 'crit' | 'haste' | 'dr' | 'sw' | 'posture' | 'heal' | 'speed' | 'dodge' | 'counter' | 'threat' | 'guard' | 'broken', v }
//   { sk: 'basic' | <skill id of slots 1-3>, cd | dmg | fin | radius | dur: v }   (percent; cd is negative = faster)
//   { aura: 'atk' | 'dr' | 'sw', v }   you and every ally within TALENTS.auraR metres (the strongest aura of a kind counts)
//   { key: '<id>' }                    a custom rule run by server/talents.js (keystones and a few special nodes)
// Optional node fields: desc (tooltip text for key rules), keystone, coop, icon, touches: ['basic' | skill id, ...]
//   (skills a key rule changes, so the Abilities pane lists the node under them; sk effects are found on their own).
// A class without an entry here simply has no tree yet (the window says so; nothing else changes).
import { CLASSES, MAX_LEVEL } from './data.js';
import { ruleText } from './effects.js';

export const TALENTS = {
  firstLevel: 2,                 // the first point comes at level 2
  tiers: [0, 3, 6, 10, 14],      // points needed in the tiers above before tier k opens
  auraR: 12,                     // aura radius (m)
  caps: { speed: 10, haste: 50, dr: 40, guard: 90 }, // totals (percent) after gear for haste/dr, guard = total block
};

export const pointsAt = lvl => Math.max(0, Math.min(MAX_LEVEL, lvl | 0) - (TALENTS.firstLevel - 1));
// The level that gives the n-th point (1-based).
export const levelForPoint = n => n + TALENTS.firstLevel - 1;

// What each stat means, for tooltips and the bonus summary.
export const STAT_TEXT = {
  atk: v => `+${v}% attack`,
  hp: v => `+${v}% max health`,
  crit: v => `+${v}% critical hit chance`,
  haste: v => `+${v}% cooldown speed (skills 1-3)`,
  dr: v => `${v}% less damage taken`,
  sw: v => `+${v}% Switch damage`,
  posture: v => `+${v}% posture damage`,
  heal: v => `+${v}% healing done`,
  speed: v => `+${v}% move speed`,
  dodge: v => `-${v}% dodge cooldown`,
  counter: v => `+${v}% counter damage (your hit right after a perfect dodge)`,
  threat: v => `+${v}% threat`,
  guard: v => `guarding blocks ${v}% more damage`,
  broken: v => `+${v}% damage to Broken enemies`,
};
const AURA_TEXT = { atk: 'deal', dr: 'take', sw: 'deal' };

// ---------- the trees ----------
// x: column inside the branch (-1 left, 0 middle, 1 right); tier: 0-4. icon: a short glyph for the node.
export const TREES = {
  swordsman: {
    branches: [
      {
        id: 'blade', name: 'Blade', color: '#f87171', theme: 'Damage, crits and finishers',
        nodes: [
          { id: 'sw_edge', name: 'Keen Edge', icon: '⚔', tier: 0, x: -1, max: 3, fx: [{ stat: 'atk', v: 3 }] },
          { id: 'sw_precision', name: 'Precision', icon: '◎', tier: 0, x: 1, max: 3, fx: [{ stat: 'crit', v: 2 }] },
          { id: 'sw_finale', name: 'Finishing Flourish', icon: '✶', tier: 1, x: -1, max: 2, req: ['sw_edge'], fx: [{ sk: 'basic', fin: 20 }] },
          { id: 'sw_burst', name: 'Sword Art: Burst', icon: '✦', tier: 1, x: 1, max: 2, req: ['sw_precision'], fx: [{ sk: 'burst', dmg: 10 }, { sk: 'burst', cd: -6 }] },
          { id: 'sw_wide', name: 'Wide Arc', icon: '◌', tier: 2, x: 0, max: 2, req: ['sw_finale', 'sw_burst'], fx: [{ sk: 'whirl', radius: 12 }, { sk: 'whirl', dmg: 8 }] },
          { id: 'sw_instinct', name: 'Killer Instinct', icon: '☠', tier: 3, x: 0, max: 3, req: ['sw_wide'], fx: [{ stat: 'atk', v: 2 }, { stat: 'crit', v: 2 }] },
          { id: 'sw_exec', name: 'Executioner', icon: '⚚', tier: 4, x: 0, max: 1, keystone: true, req: ['sw_instinct'], fx: [{ key: 'exec' }], touches: ['rush'],
            desc: 'Your hits deal +35% damage to enemies below 35% health, and every kill resets Rush\'s cooldown: dash from one finish to the next.' },
        ],
      },
      {
        id: 'tempo', name: 'Tempo', color: '#22d3ee', theme: 'Dodges, speed, cooldowns, counters',
        nodes: [
          { id: 'sw_feet', name: 'Light Feet', icon: '➶', tier: 0, x: -1, max: 2, fx: [{ stat: 'speed', v: 4 }] },
          { id: 'sw_roll', name: 'Quick Roll', icon: '↻', tier: 0, x: 1, max: 3, fx: [{ stat: 'dodge', v: 7 }] },
          { id: 'sw_rush', name: 'Swift Rush', icon: '»', tier: 1, x: -1, max: 2, req: ['sw_feet'], fx: [{ sk: 'rush', cd: -12 }, { sk: 'rush', dmg: 10 }] },
          { id: 'sw_riposte', name: 'Riposte', icon: '⤺', tier: 1, x: 1, max: 3, req: ['sw_roll'], fx: [{ stat: 'counter', v: 15 }] },
          { id: 'sw_tempo', name: 'Battle Tempo', icon: '⧗', tier: 2, x: 0, max: 3, req: ['sw_rush', 'sw_riposte'], fx: [{ stat: 'haste', v: 3 }] },
          { id: 'sw_cyclone', name: 'Cyclone', icon: '❂', tier: 3, x: -1, max: 2, req: ['sw_tempo'], fx: [{ sk: 'whirl', cd: -10 }] },
          { id: 'sw_evasion', name: 'Evasion', icon: '◇', tier: 3, x: 1, max: 2, req: ['sw_tempo'], fx: [{ stat: 'dr', v: 4 }] },
          { id: 'sw_flow', name: 'Flowing Blade', icon: '∞', tier: 4, x: 0, max: 1, keystone: true, req: ['sw_cyclone', 'sw_evasion'], fx: [{ key: 'flow' }], touches: ['rush', 'whirl'],
            desc: 'Every dodge roll takes 1 s off your skill cooldowns, and a PERFECT dodge resets Rush and Whirl at once. Roll in, strike, roll out.' },
        ],
      },
      {
        id: 'link', name: 'Link', color: '#fbbf24', theme: 'Switch damage, set-ups, party buffs',
        nodes: [
          { id: 'sw_switch', name: 'Switch Training', icon: '⇄', tier: 0, x: -1, max: 3, fx: [{ stat: 'sw', v: 8 }] },
          { id: 'sw_pressure', name: 'Pressure', icon: '▼', tier: 0, x: 1, max: 3, fx: [{ stat: 'posture', v: 8 }] },
          { id: 'sw_opening', name: 'Opportunist', icon: '◈', tier: 1, x: -1, max: 2, req: ['sw_switch'], fx: [{ stat: 'broken', v: 8 }] },
          { id: 'sw_breaker', name: 'Breaker', icon: '✕', tier: 1, x: 1, max: 2, req: ['sw_pressure'], fx: [{ sk: 'burst', cd: -10 }] },
          { id: 'sw_rhythm', name: 'Battle Rhythm', icon: '♪', tier: 2, x: 0, max: 2, req: ['sw_opening', 'sw_breaker'], fx: [{ aura: 'atk', v: 3 }] },
          { id: 'sw_shared', name: 'Shared Opening', icon: '⚭', tier: 3, x: 0, max: 3, req: ['sw_rhythm'], fx: [{ stat: 'sw', v: 10 }, { stat: 'posture', v: 5 }] },
          { id: 'sw_relay', name: 'Relay Strike', icon: '⚡', tier: 4, x: 0, max: 1, keystone: true, coop: true, req: ['sw_shared'], fx: [{ key: 'relay' }], touches: ['burst'],
            desc: 'Landing a Switch gives you and every ally within 12 m +15% damage for 6 s and resets your Burst Combo: Break, Switch, Break again.' },
        ],
      },
    ],
    // Bots (shared/teambots.js) spend in this order, one rank per entry.
    bot: ['sw_edge', 'sw_edge', 'sw_edge', 'sw_precision', 'sw_precision', 'sw_precision', 'sw_burst', 'sw_burst', 'sw_finale', 'sw_finale',
      'sw_wide', 'sw_wide', 'sw_instinct', 'sw_instinct', 'sw_instinct', 'sw_exec', 'sw_switch', 'sw_switch', 'sw_switch',
      'sw_pressure', 'sw_pressure', 'sw_pressure', 'sw_opening', 'sw_opening', 'sw_breaker', 'sw_breaker', 'sw_rhythm', 'sw_rhythm', 'sw_shared'], // levels 21-30 (Floor 3)
  },

  guardian: {
    branches: [
      {
        id: 'bulwark', name: 'Bulwark', color: '#60a5fa', theme: 'Guard, parry, damage reduction',
        nodes: [
          { id: 'gu_plate', name: 'Plate Training', icon: '⛨', tier: 0, x: -1, max: 3, fx: [{ stat: 'hp', v: 4 }] },
          { id: 'gu_brace', name: 'Brace', icon: '▣', tier: 0, x: 1, max: 3, fx: [{ stat: 'dr', v: 3 }] },
          { id: 'gu_fortress', name: 'Fortress', icon: '▥', tier: 1, x: -1, max: 2, req: ['gu_plate'], fx: [{ sk: 'wall', dur: 20 }, { sk: 'wall', cd: -8 }] },
          { id: 'gu_guard', name: 'Stalwart Guard', icon: '⛉', tier: 1, x: 1, max: 2, req: ['gu_brace'], fx: [{ stat: 'guard', v: 8 }] },
          { id: 'gu_riposte', name: 'Shield Riposte', icon: '⤺', tier: 2, x: 0, max: 2, req: ['gu_fortress', 'gu_guard'], fx: [{ key: 'parryCounter' }, { stat: 'counter', v: 10 }],
            desc: 'A parry opens a counter window like a perfect dodge: your next hit deals +50% damage and double posture.' },
          { id: 'gu_endure', name: 'Endurance', icon: '✚', tier: 3, x: 0, max: 3, req: ['gu_riposte'], fx: [{ stat: 'hp', v: 4 }, { stat: 'dr', v: 2 }] },
          { id: 'gu_unbreak', name: 'Unbreakable', icon: '⬢', tier: 4, x: 0, max: 1, keystone: true, req: ['gu_endure'], fx: [{ key: 'unbreak' }],
            desc: 'Every parry restores 10% of your health and strikes the attacker back for 2x your attack (heavy posture). Stand in front and time your R.' },
        ],
      },
      {
        id: 'warlord', name: 'Warlord', color: '#ef4444', theme: 'Threat, taunts, posture damage',
        nodes: [
          { id: 'gu_menace', name: 'Menace', icon: '☗', tier: 0, x: -1, max: 3, fx: [{ stat: 'threat', v: 15 }] },
          { id: 'gu_crush', name: 'Crushing Blows', icon: '▼', tier: 0, x: 1, max: 3, fx: [{ stat: 'posture', v: 8 }] },
          { id: 'gu_provoke', name: 'Provoke', icon: '!', tier: 1, x: -1, max: 2, req: ['gu_menace'], fx: [{ sk: 'taunt', cd: -10 }, { sk: 'taunt', dur: 25 }] },
          { id: 'gu_quake', name: 'Earthshaker', icon: '◉', tier: 1, x: 1, max: 2, req: ['gu_crush'], fx: [{ sk: 'gslam', radius: 10 }, { sk: 'gslam', dmg: 10 }] },
          { id: 'gu_heavy', name: 'Heavy Bash', icon: '✊', tier: 2, x: 0, max: 2, req: ['gu_provoke', 'gu_quake'], fx: [{ sk: 'basic', dmg: 10 }, { sk: 'basic', fin: 15 }] },
          { id: 'gu_monger', name: 'Warmonger', icon: '⚔', tier: 3, x: 0, max: 3, req: ['gu_heavy'], fx: [{ stat: 'atk', v: 3 }, { stat: 'posture', v: 5 }] },
          { id: 'gu_jugg', name: 'Juggernaut', icon: '♜', tier: 4, x: 0, max: 1, keystone: true, req: ['gu_monger'], fx: [{ key: 'jugg' }], touches: ['taunt'],
            desc: 'Taunt (and its evolutions) fills 25% of every taunted enemy\'s posture (8% on bosses), and enemies attacking YOU take +40% posture from your hits. Hold aggro, then Break it.' },
        ],
      },
      {
        id: 'vanguard', name: 'Vanguard', color: '#34d399', theme: 'Shield-bash offense, protecting allies, Switch set-ups',
        nodes: [
          { id: 'gu_bashing', name: 'Shield Bash', icon: '⛊', tier: 0, x: -1, max: 3, fx: [{ sk: 'basic', dmg: 5 }] },
          { id: 'gu_cover', name: 'Cover', icon: '☂', tier: 0, x: 1, max: 3, fx: [{ aura: 'dr', v: 2 }] },
          { id: 'gu_setup', name: 'Set-Up', icon: '⤓', tier: 1, x: -1, max: 2, req: ['gu_bashing'], fx: [{ sk: 'gslam', cd: -10 }, { stat: 'posture', v: 5 }] },
          { id: 'gu_steadfast', name: 'Steadfast', icon: '⚓', tier: 1, x: 1, max: 2, req: ['gu_cover'], fx: [{ sk: 'wall', cd: -8 }, { stat: 'hp', v: 3 }] },
          { id: 'gu_partner', name: 'Switch Partner', icon: '⇄', tier: 2, x: 0, max: 2, req: ['gu_setup', 'gu_steadfast'], fx: [{ stat: 'sw', v: 10 }] },
          { id: 'gu_charge', name: 'Lead the Charge', icon: '➹', tier: 3, x: 0, max: 3, req: ['gu_partner'], fx: [{ stat: 'atk', v: 3 }, { stat: 'speed', v: 3 }] },
          { id: 'gu_rally', name: 'Rallying Bash', icon: '✺', tier: 4, x: 0, max: 1, keystone: true, coop: true, req: ['gu_charge'], fx: [{ key: 'rally' }], touches: ['basic'],
            desc: 'Your Bash finisher stuns for 0.8 s and fills 12% posture (4% on bosses). Whenever you Break an enemy, allies within 10 m get a shield worth 10% of their health for 5 s.' },
        ],
      },
    ],
    bot: ['gu_brace', 'gu_brace', 'gu_brace', 'gu_plate', 'gu_plate', 'gu_plate', 'gu_guard', 'gu_guard', 'gu_fortress', 'gu_fortress',
      'gu_riposte', 'gu_riposte', 'gu_endure', 'gu_endure', 'gu_endure', 'gu_unbreak', 'gu_menace', 'gu_menace', 'gu_menace',
      'gu_crush', 'gu_crush', 'gu_crush', 'gu_provoke', 'gu_provoke', 'gu_quake', 'gu_quake', 'gu_heavy', 'gu_heavy', 'gu_monger'], // levels 21-30 (Floor 3)
  },

  cleric: {
    branches: [
      {
        id: 'mercy', name: 'Mercy', color: '#86efac', theme: 'Healing and shields',
        nodes: [
          { id: 'cl_hands', name: 'Gentle Hands', icon: '✋', tier: 0, x: -1, max: 3, fx: [{ stat: 'heal', v: 5 }] },
          { id: 'cl_vigor', name: 'Vigor', icon: '♥', tier: 0, x: 1, max: 3, fx: [{ stat: 'hp', v: 4 }] },
          { id: 'cl_mend', name: 'Swift Mend', icon: '✚', tier: 1, x: -1, max: 2, req: ['cl_hands'], fx: [{ sk: 'heal', cd: -10 }] },
          { id: 'cl_wide', name: 'Wide Sanctuary', icon: '◯', tier: 1, x: 1, max: 2, req: ['cl_vigor'], fx: [{ sk: 'sanct', radius: 12 }, { sk: 'sanct', dur: 15 }] },
          { id: 'cl_devotion', name: 'Devotion', icon: '☀', tier: 2, x: 0, max: 2, req: ['cl_mend', 'cl_wide'], fx: [{ stat: 'heal', v: 5 }, { stat: 'haste', v: 3 }] },
          { id: 'cl_bloom', name: 'Lifebloom', icon: '❀', tier: 3, x: 0, max: 3, req: ['cl_devotion'], fx: [{ stat: 'heal', v: 6 }] },
          { id: 'cl_overflow', name: 'Overflow', icon: '❖', tier: 4, x: 0, max: 1, keystone: true, req: ['cl_bloom'], fx: [{ key: 'overflow' }], touches: ['heal', 'sanct'],
            desc: 'Overhealing from your heals becomes a shield on the target (up to 25% of their health, 6 s). Heal early: nothing is wasted.' },
        ],
      },
      {
        id: 'judgement', name: 'Judgement', color: '#fde047', theme: 'Smite, damage, interrupts',
        nodes: [
          { id: 'cl_zeal', name: 'Zealotry', icon: '⚔', tier: 0, x: -1, max: 3, fx: [{ stat: 'atk', v: 4 }] },
          { id: 'cl_insight', name: 'Insight', icon: '◎', tier: 0, x: 1, max: 3, fx: [{ stat: 'crit', v: 2 }] },
          { id: 'cl_searing', name: 'Searing Smite', icon: '☄', tier: 1, x: -1, max: 2, req: ['cl_zeal'], fx: [{ sk: 'basic', dmg: 12 }] },
          { id: 'cl_silence', name: 'Silence', icon: '▼', tier: 1, x: 1, max: 2, req: ['cl_insight'], fx: [{ stat: 'posture', v: 12 }] },
          { id: 'cl_hammer', name: 'Hammer of Light', icon: '⚒', tier: 2, x: 0, max: 2, req: ['cl_searing', 'cl_silence'], fx: [{ sk: 'basic', cd: -8 }] },
          { id: 'cl_verdict', name: 'Verdict', icon: '⚖', tier: 3, x: 0, max: 3, req: ['cl_hammer'], fx: [{ stat: 'broken', v: 6 }, { stat: 'atk', v: 2 }] },
          { id: 'cl_wrath', name: 'Wrath', icon: '✷', tier: 4, x: 0, max: 1, keystone: true, req: ['cl_verdict'], fx: [{ key: 'wrath' }], touches: ['basic'],
            desc: 'Smite pierces: the bolt flies 14 m and strikes every enemy in its path (70% damage after the first). Line them up.' },
        ],
      },
      {
        id: 'grace', name: 'Grace', color: '#c4b5fd', theme: 'Buffs, party support, cleansing, saving allies',
        nodes: [
          { id: 'cl_presence', name: 'Graceful Presence', icon: '☂', tier: 0, x: -1, max: 3, fx: [{ aura: 'dr', v: 2 }] },
          { id: 'cl_inspire', name: 'Inspire', icon: '✧', tier: 0, x: 1, max: 3, fx: [{ sk: 'bless', dur: 12 }] },
          { id: 'cl_cleanse', name: 'Cleansing Light', icon: '❄', tier: 1, x: -1, max: 1, req: ['cl_presence'], fx: [{ key: 'cleanse' }], touches: ['bless'],
            desc: 'Blessing (and Zeal, Aegis) also purifies the allies it touches for 3 s: immune to lingering ground hazards (mire pools, cracked ground, the Deluge).' },
          { id: 'cl_swift', name: 'Swift Blessing', icon: '⇡', tier: 1, x: 1, max: 2, req: ['cl_inspire'], fx: [{ sk: 'bless', cd: -10 }] },
          { id: 'cl_unity', name: 'Unity', icon: '⚭', tier: 2, x: 0, max: 2, req: ['cl_cleanse', 'cl_swift'], fx: [{ aura: 'sw', v: 10 }] },
          { id: 'cl_guiding', name: 'Guiding Light', icon: '✺', tier: 3, x: 0, max: 3, req: ['cl_unity'], fx: [{ stat: 'heal', v: 4 }, { stat: 'haste', v: 2 }] },
          { id: 'cl_spirit', name: 'Guardian Spirit', icon: '☥', tier: 4, x: 0, max: 1, keystone: true, coop: true, req: ['cl_guiding'], fx: [{ key: 'spirit' }],
            desc: 'Once every 60 s, an ally within 15 m (or you) who would be defeated is saved at 30% health instead.' },
        ],
      },
    ],
    bot: ['cl_hands', 'cl_hands', 'cl_hands', 'cl_vigor', 'cl_vigor', 'cl_vigor', 'cl_mend', 'cl_mend', 'cl_wide', 'cl_wide',
      'cl_devotion', 'cl_devotion', 'cl_bloom', 'cl_bloom', 'cl_bloom', 'cl_overflow', 'cl_presence', 'cl_presence', 'cl_presence',
      'cl_inspire', 'cl_inspire', 'cl_inspire', 'cl_cleanse', 'cl_swift', 'cl_swift', 'cl_unity', 'cl_unity', 'cl_guiding', 'cl_guiding'], // levels 21-30 (Floor 3)
  },

  // ---------- the newer classes (shared/classes/): same shape, keystones in server/talents.js ----------
  ranger: {
    branches: [
      {
        id: 'marksman', name: 'Marksman', color: '#2dd4bf', theme: 'Charged shots, piercing, crits, range',
        nodes: [
          { id: 'rg_aim', name: 'Steady Aim', icon: '◎', tier: 0, x: -1, max: 3, fx: [{ stat: 'crit', v: 2 }] },
          { id: 'rg_draw', name: 'Heavy Draw', icon: '➶', tier: 0, x: 1, max: 3, fx: [{ sk: 'basic', dmg: 5 }] },
          { id: 'rg_pierce', name: 'Penetrator', icon: '⇶', tier: 1, x: -1, max: 2, req: ['rg_aim'], fx: [{ sk: 'pierce', dmg: 10 }, { sk: 'pierce', cd: -6 }] },
          { id: 'rg_third', name: 'Broadhead', icon: '✶', tier: 1, x: 1, max: 2, req: ['rg_draw'], fx: [{ sk: 'basic', fin: 20 }] },
          { id: 'rg_focus', name: 'Focus', icon: '◉', tier: 2, x: 0, max: 2, req: ['rg_pierce', 'rg_third'], fx: [{ stat: 'atk', v: 3 }] },
          { id: 'rg_vital', name: 'Vital Shot', icon: '✚', tier: 3, x: -1, max: 2, req: ['rg_focus'], fx: [{ stat: 'crit', v: 2 }, { stat: 'broken', v: 5 }] },
          { id: 'rg_long', name: 'Longshot', icon: '⟶', tier: 3, x: 1, max: 2, req: ['rg_focus'], fx: [{ key: 'longshot' }], touches: ['basic', 'pierce'],
            desc: 'Arrows that fly more than 12 m before they hit deal +10% damage per rank.' },
          { id: 'rg_deadshot', name: 'Dead Shot', icon: '☩', tier: 4, x: 0, max: 1, keystone: true, req: ['rg_vital', 'rg_long'], fx: [{ key: 'deadshot' }], touches: ['pierce', 'basic'],
            desc: 'Piercing Shot (and its evolutions) always crits, and every critical hit from your other arrows takes 1 s off its cooldown.' },
        ],
      },
      {
        id: 'trapper', name: 'Trapper', color: '#a3e635', theme: 'Traps, slows, control',
        nodes: [
          { id: 'rg_spikes', name: 'Barbed Caltrops', icon: '⁂', tier: 0, x: -1, max: 3, fx: [{ sk: 'disengage', dmg: 12 }] },
          { id: 'rg_feet', name: 'Quick Feet', icon: '»', tier: 0, x: 1, max: 2, fx: [{ stat: 'speed', v: 4 }] },
          { id: 'rg_spread', name: 'Wide Spread', icon: '◌', tier: 1, x: -1, max: 2, req: ['rg_spikes'], fx: [{ sk: 'disengage', radius: 15 }, { sk: 'disengage', dur: 15 }] },
          { id: 'rg_tumble', name: 'Tumbler', icon: '↻', tier: 1, x: 1, max: 2, req: ['rg_feet'], fx: [{ sk: 'disengage', cd: -10 }, { stat: 'dodge', v: 6 }] },
          { id: 'rg_tangle', name: 'Tanglefoot', icon: '⌇', tier: 2, x: 0, max: 2, req: ['rg_spread', 'rg_tumble'], fx: [{ stat: 'posture', v: 6 }, { stat: 'dr', v: 2 }] },
          { id: 'rg_grounds', name: 'Hunting Grounds', icon: '⌂', tier: 3, x: -1, max: 3, req: ['rg_tangle'], fx: [{ stat: 'atk', v: 2 }, { stat: 'hp', v: 2 }] },
          { id: 'rg_pin', name: 'Pinning Arrow', icon: '⊥', tier: 3, x: 1, max: 1, req: ['rg_tangle'], fx: [{ key: 'pinshot' }], touches: ['basic'],
            desc: 'Your third (heavy) arrow slows its target by 30% for 2 s (half on bosses).' },
          { id: 'rg_mines', name: 'Minefield', icon: '✹', tier: 4, x: 0, max: 1, keystone: true, req: ['rg_grounds', 'rg_pin'], fx: [{ key: 'minefield' }], touches: ['disengage'],
            desc: 'Your caltrops and snares explode when they spring or run out: 1.5x attack to everything on them and a posture chunk (10%, 4% on bosses).' },
        ],
      },
      {
        id: 'packhunt', name: 'Pack Hunter', color: '#fbbf24', theme: 'Hunter\'s Mark, party bonuses, Switch',
        nodes: [
          { id: 'rg_pack', name: 'Pack Tactics', icon: '⇄', tier: 0, x: -1, max: 3, fx: [{ stat: 'sw', v: 8 }] },
          { id: 'rg_prey', name: 'Mark the Prey', icon: '◈', tier: 0, x: 1, max: 3, fx: [{ sk: 'mark', dur: 12 }] },
          { id: 'rg_exploit', name: 'Exploit', icon: '✕', tier: 1, x: -1, max: 2, req: ['rg_pack'], fx: [{ stat: 'broken', v: 8 }] },
          { id: 'rg_quickmark', name: 'Quick Mark', icon: '⇡', tier: 1, x: 1, max: 2, req: ['rg_prey'], fx: [{ sk: 'mark', cd: -10 }] },
          { id: 'rg_howl', name: 'Howl', icon: '♪', tier: 2, x: 0, max: 2, req: ['rg_exploit', 'rg_quickmark'], fx: [{ aura: 'atk', v: 3 }] },
          { id: 'rg_deep', name: 'Deep Mark', icon: '◆', tier: 3, x: -1, max: 2, req: ['rg_howl'], fx: [{ key: 'deepmark' }], touches: ['mark'],
            desc: 'Hunter\'s Mark (and Pack Hunter) gives the party +5% more damage per rank on the target.' },
          { id: 'rg_volley', name: 'Coordinated Volley', icon: '⚭', tier: 3, x: 1, max: 3, req: ['rg_howl'], fx: [{ stat: 'sw', v: 6 }, { stat: 'posture', v: 4 }] },
          { id: 'rg_leader', name: 'Pack Leader', icon: '♞', tier: 4, x: 0, max: 1, keystone: true, coop: true, req: ['rg_deep', 'rg_volley'], fx: [{ key: 'packlead' }], touches: ['mark', 'pierce'],
            desc: 'When anyone lands a Switch on an enemy you marked, the mark refreshes, your Piercing Shot is ready at once, and you and allies within 12 m of it deal +10% damage for 5 s.' },
        ],
      },
    ],
    bot: ['rg_aim', 'rg_aim', 'rg_aim', 'rg_draw', 'rg_draw', 'rg_draw', 'rg_pierce', 'rg_pierce', 'rg_third', 'rg_third',
      'rg_focus', 'rg_focus', 'rg_vital', 'rg_vital', 'rg_long', 'rg_long', 'rg_deadshot', 'rg_pack', 'rg_pack',
      'rg_pack', 'rg_prey', 'rg_prey', 'rg_prey', 'rg_exploit', 'rg_exploit', 'rg_quickmark', 'rg_quickmark', 'rg_howl', 'rg_howl'], // levels 21-30 (Floor 3)
  },

  berserker: {
    branches: [
      {
        id: 'carnage', name: 'Carnage', color: '#ef4444', theme: 'Rage damage, cleaves, executions',
        nodes: [
          { id: 'bz_brutal', name: 'Brutality', icon: '⚔', tier: 0, x: -1, max: 3, fx: [{ stat: 'atk', v: 3 }] },
          { id: 'bz_fury', name: 'Fury', icon: '♨', tier: 0, x: 1, max: 3, fx: [{ key: 'fury' }],
            desc: 'You build 10% more Rage per rank.' },
          { id: 'bz_cleave', name: 'Wide Cleave', icon: '◠', tier: 1, x: -1, max: 2, req: ['bz_brutal'], fx: [{ sk: 'cleave', radius: 12 }, { sk: 'cleave', dmg: 8 }] },
          { id: 'bz_heavy', name: 'Heavy Swings', icon: '⚒', tier: 1, x: 1, max: 2, req: ['bz_fury'], fx: [{ sk: 'basic', dmg: 8 }] },
          { id: 'bz_redmist', name: 'Red Mist', icon: '❂', tier: 2, x: 0, max: 2, req: ['bz_cleave', 'bz_heavy'], fx: [{ key: 'redmist' }],
            desc: 'Your hits deal up to +8% damage per rank at full Rage (scales with your Rage).' },
          { id: 'bz_savage', name: 'Savage Edge', icon: '◎', tier: 3, x: -1, max: 2, req: ['bz_redmist'], fx: [{ stat: 'crit', v: 3 }] },
          { id: 'bz_reaper', name: 'Reaper', icon: '☠', tier: 3, x: 1, max: 2, req: ['bz_redmist'], fx: [{ stat: 'broken', v: 6 }, { stat: 'atk', v: 2 }] },
          { id: 'bz_massacre', name: 'Massacre', icon: '✷', tier: 4, x: 0, max: 1, keystone: true, req: ['bz_savage', 'bz_reaper'], fx: [{ key: 'massacre' }], touches: ['cleave'],
            desc: 'Every kill grants 15 Rage and resets Cleave. Cleave (and its evolutions) deals +30% to enemies below 35% health.' },
        ],
      },
      {
        id: 'bloodlust', name: 'Bloodlust', color: '#be123c', theme: 'Lifesteal, sustain, Bloodrage',
        nodes: [
          { id: 'bz_thick', name: 'Thick Skin', icon: '♥', tier: 0, x: -1, max: 3, fx: [{ stat: 'hp', v: 4 }] },
          { id: 'bz_leech', name: 'Leech', icon: '⚕', tier: 0, x: 1, max: 3, fx: [{ key: 'leech' }],
            desc: 'Heal for 2% of the damage you deal per rank.' },
          { id: 'bz_scar', name: 'Scar Tissue', icon: '▣', tier: 1, x: -1, max: 2, req: ['bz_thick'], fx: [{ stat: 'dr', v: 3 }] },
          { id: 'bz_price', name: 'Blood Price', icon: '✦', tier: 1, x: 1, max: 2, req: ['bz_leech'], fx: [{ sk: 'bloodrage', cd: -10 }, { sk: 'bloodrage', dur: 15 }] },
          { id: 'bz_wind', name: 'Second Wind', icon: '❦', tier: 2, x: 0, max: 2, req: ['bz_scar', 'bz_price'], fx: [{ key: 'secondwind' }],
            desc: 'Below 35% health you take 6% less damage per rank.' },
          { id: 'bz_feast', name: 'Feast', icon: '✚', tier: 3, x: -1, max: 2, req: ['bz_wind'], fx: [{ stat: 'heal', v: 10 }, { stat: 'hp', v: 2 }] },
          { id: 'bz_thirst', name: 'Bloodthirst', icon: '⧗', tier: 3, x: 1, max: 2, req: ['bz_wind'], fx: [{ stat: 'haste', v: 4 }] },
          { id: 'bz_sanguine', name: 'Sanguine Frenzy', icon: '❖', tier: 4, x: 0, max: 1, keystone: true, req: ['bz_feast', 'bz_thirst'], fx: [{ key: 'sanguine' }], touches: ['bloodrage'],
            desc: 'While Bloodrage (or Frenzy) is on, every kill extends it by 1.5 s and your hits fill 25% more posture; when it ends you heal 15% of your health.' },
        ],
      },
      {
        id: 'warcry', name: 'Warcry', color: '#f59e0b', theme: 'Posture, staggers, team-ups, Switch set-ups',
        nodes: [
          { id: 'bz_bones', name: 'Bonebreaker', icon: '▼', tier: 0, x: -1, max: 3, fx: [{ stat: 'posture', v: 8 }] },
          { id: 'bz_shout', name: 'Battle Shout', icon: '⇄', tier: 0, x: 1, max: 3, fx: [{ stat: 'sw', v: 8 }] },
          { id: 'bz_quake', name: 'Earthquake', icon: '◉', tier: 1, x: -1, max: 2, req: ['bz_bones'], fx: [{ sk: 'leap', radius: 12 }, { sk: 'leap', cd: -8 }] },
          { id: 'bz_menace', name: 'Intimidate', icon: '☗', tier: 1, x: 1, max: 2, req: ['bz_shout'], fx: [{ stat: 'threat', v: 20 }, { stat: 'dr', v: 2 }] },
          { id: 'bz_roar', name: 'Rallying Roar', icon: '♪', tier: 2, x: 0, max: 2, req: ['bz_quake', 'bz_menace'], fx: [{ aura: 'atk', v: 3 }] },
          { id: 'bz_concuss', name: 'Concussive', icon: '✕', tier: 3, x: -1, max: 2, req: ['bz_roar'], fx: [{ stat: 'broken', v: 8 }] },
          { id: 'bz_shatter', name: 'Shatterpoint', icon: '⚡', tier: 3, x: 1, max: 3, req: ['bz_roar'], fx: [{ stat: 'posture', v: 5 }, { stat: 'sw', v: 5 }] },
          { id: 'bz_warcry', name: 'Warcry', icon: '✺', tier: 4, x: 0, max: 1, keystone: true, coop: true, req: ['bz_concuss', 'bz_shatter'], fx: [{ key: 'warcry' }], touches: ['leap'],
            desc: 'When you Break an enemy you roar: you and allies within 12 m deal +12% damage for 6 s, and Leap Slam is ready again (at most every 8 s).' },
        ],
      },
    ],
    bot: ['bz_brutal', 'bz_brutal', 'bz_brutal', 'bz_fury', 'bz_fury', 'bz_fury', 'bz_cleave', 'bz_cleave', 'bz_heavy', 'bz_heavy',
      'bz_redmist', 'bz_redmist', 'bz_savage', 'bz_savage', 'bz_reaper', 'bz_reaper', 'bz_massacre', 'bz_thick', 'bz_thick',
      'bz_thick', 'bz_leech', 'bz_leech', 'bz_leech', 'bz_scar', 'bz_scar', 'bz_price', 'bz_price', 'bz_wind', 'bz_wind'], // levels 21-30 (Floor 3)
  },

  lancer: {
    branches: [
      {
        id: 'dragoon', name: 'Dragoon', color: '#38bdf8', theme: 'Sky Lance, aerial strikes, posture',
        nodes: [
          { id: 'ln_wings', name: 'Dragon Wings', icon: '⌃', tier: 0, x: -1, max: 3, fx: [{ sk: 'skylance', cd: -6 }] },
          { id: 'ln_point', name: 'Spearpoint', icon: '▼', tier: 0, x: 1, max: 3, fx: [{ stat: 'posture', v: 8 }] },
          { id: 'ln_dive', name: 'Diving Strike', icon: '⤓', tier: 1, x: -1, max: 2, req: ['ln_wings'], fx: [{ sk: 'skylance', dmg: 12 }, { sk: 'skylance', radius: 10 }] },
          { id: 'ln_tip', name: 'Honed Tip', icon: '⟟', tier: 1, x: 1, max: 2, req: ['ln_point'], fx: [{ key: 'honedtip' }], touches: ['basic'],
            desc: 'Hits at the tip of your reach deal 10% more per rank (on top of the usual +30%).' },
          { id: 'ln_aerial', name: 'Aerial Poise', icon: '◇', tier: 2, x: 0, max: 2, req: ['ln_dive', 'ln_tip'], fx: [{ stat: 'atk', v: 3 }, { stat: 'dodge', v: 6 }] },
          { id: 'ln_impale', name: 'Impale', icon: '✕', tier: 3, x: -1, max: 2, req: ['ln_aerial'], fx: [{ stat: 'broken', v: 8 }] },
          { id: 'ln_drake', name: 'Drake\'s Fury', icon: '◎', tier: 3, x: 1, max: 2, req: ['ln_aerial'], fx: [{ stat: 'crit', v: 3 }] },
          { id: 'ln_dragoon', name: 'Dragoon', icon: '⚚', tier: 4, x: 0, max: 1, keystone: true, req: ['ln_impale', 'ln_drake'], fx: [{ key: 'dragoon' }], touches: ['skylance', 'basic'],
            desc: 'Every thrust that lands at the tip of your reach takes 0.5 s off Sky Lance, and Sky Lance (and its evolutions) fills 40% more posture.' },
        ],
      },
      {
        id: 'skirmish', name: 'Skirmisher', color: '#2dd4bf', theme: 'Lance Charge, mobility, reach',
        nodes: [
          { id: 'ln_stride', name: 'Long Stride', icon: '➶', tier: 0, x: -1, max: 2, fx: [{ stat: 'speed', v: 4 }] },
          { id: 'ln_light', name: 'Light Armour', icon: '↻', tier: 0, x: 1, max: 3, fx: [{ stat: 'dodge', v: 7 }] },
          { id: 'ln_momentum', name: 'Momentum', icon: '»', tier: 1, x: -1, max: 2, req: ['ln_stride'], fx: [{ sk: 'lcharge', cd: -10 }, { sk: 'lcharge', dmg: 10 }] },
          { id: 'ln_counter', name: 'Counter-Thrust', icon: '⤺', tier: 1, x: 1, max: 3, req: ['ln_light'], fx: [{ stat: 'counter', v: 15 }] },
          { id: 'ln_tempo', name: 'Skirmish', icon: '⧗', tier: 2, x: 0, max: 3, req: ['ln_momentum', 'ln_counter'], fx: [{ stat: 'haste', v: 3 }] },
          { id: 'ln_reach', name: 'Extended Reach', icon: '⟶', tier: 3, x: -1, max: 2, req: ['ln_tempo'], fx: [{ sk: 'basic', dmg: 8 }] },
          { id: 'ln_slip', name: 'Slip Away', icon: '◇', tier: 3, x: 1, max: 2, req: ['ln_tempo'], fx: [{ stat: 'dr', v: 3 }] },
          { id: 'ln_fade', name: 'Hit and Fade', icon: '∞', tier: 4, x: 0, max: 1, keystone: true, req: ['ln_reach', 'ln_slip'], fx: [{ key: 'fade' }], touches: ['lcharge', 'basic'],
            desc: 'Every dodge roll takes 1.5 s off Lance Charge and a perfect dodge resets it; your first thrust within 3 s of a charge deals +40%.' },
        ],
      },
      {
        id: 'phalanx', name: 'Phalanx', color: '#fbbf24', theme: 'Sweep, control, protecting allies, Switch',
        nodes: [
          { id: 'ln_line', name: 'Hold the Line', icon: '⛨', tier: 0, x: -1, max: 3, fx: [{ stat: 'hp', v: 4 }] },
          { id: 'ln_open', name: 'Lancer\'s Opening', icon: '⇄', tier: 0, x: 1, max: 3, fx: [{ stat: 'sw', v: 8 }] },
          { id: 'ln_sweep', name: 'Wide Sweep', icon: '◯', tier: 1, x: -1, max: 2, req: ['ln_line'], fx: [{ sk: 'lsweep', radius: 12 }, { sk: 'lsweep', cd: -8 }] },
          { id: 'ln_ward', name: 'Warding Reach', icon: '☂', tier: 1, x: 1, max: 2, req: ['ln_open'], fx: [{ aura: 'dr', v: 2 }] },
          { id: 'ln_trip', name: 'Trip', icon: '⌇', tier: 2, x: 0, max: 2, req: ['ln_sweep', 'ln_ward'], fx: [{ stat: 'posture', v: 6 }, { stat: 'threat', v: 15 }] },
          { id: 'ln_wall', name: 'Spear Wall', icon: '▥', tier: 3, x: -1, max: 2, req: ['ln_trip'], fx: [{ stat: 'dr', v: 3 }] },
          { id: 'ln_shared', name: 'Shared Opening', icon: '⚭', tier: 3, x: 1, max: 2, req: ['ln_trip'], fx: [{ aura: 'sw', v: 8 }] },
          { id: 'ln_phalanx', name: 'Phalanx', icon: '♜', tier: 4, x: 0, max: 1, keystone: true, coop: true, req: ['ln_wall', 'ln_shared'], fx: [{ key: 'phalanx' }], touches: ['lsweep'],
            desc: 'Sweep (and its evolutions) shields you and allies within 8 m for 12% of their health (5 s), and every enemy it hits that was after an ally turns on you.' },
        ],
      },
    ],
    bot: ['ln_wings', 'ln_wings', 'ln_wings', 'ln_point', 'ln_point', 'ln_point', 'ln_dive', 'ln_dive', 'ln_tip', 'ln_tip',
      'ln_aerial', 'ln_aerial', 'ln_impale', 'ln_impale', 'ln_drake', 'ln_drake', 'ln_dragoon', 'ln_open', 'ln_open',
      'ln_open', 'ln_line', 'ln_line', 'ln_line', 'ln_sweep', 'ln_sweep', 'ln_ward', 'ln_ward', 'ln_trip', 'ln_trip'], // levels 21-30 (Floor 3)
  },

  bard: {
    branches: [
      {
        id: 'maestro', name: 'Maestro', color: '#fbbf24', theme: 'Song duration and strength, Anthem',
        nodes: [
          { id: 'bd_breath', name: 'Breath Control', icon: '∿', tier: 0, x: -1, max: 3, fx: [{ sk: 'anthem', dur: 10 }] },
          { id: 'bd_voice', name: 'Resonant Voice', icon: '♫', tier: 0, x: 1, max: 3, fx: [{ key: 'voice' }], touches: ['anthem'],
            desc: 'Your songs are 5% stronger per rank (Anthem\'s haste, War March\'s damage, Lullaby\'s slow).' },
          { id: 'bd_tempo', name: 'Quick Tempo', icon: '⇡', tier: 1, x: -1, max: 2, req: ['bd_breath'], fx: [{ sk: 'anthem', cd: -10 }] },
          { id: 'bd_soothe', name: 'Soothing Song', icon: '✚', tier: 1, x: 1, max: 2, req: ['bd_voice'], fx: [{ key: 'soothe' }], touches: ['anthem'],
            desc: 'While you play Anthem (or War March), allies in the song heal 1% of their health per rank every second.' },
          { id: 'bd_chorus', name: 'Chorus', icon: '♪', tier: 2, x: 0, max: 2, req: ['bd_tempo', 'bd_soothe'], fx: [{ aura: 'atk', v: 3 }] },
          { id: 'bd_virtuoso', name: 'Virtuoso', icon: '⧗', tier: 3, x: -1, max: 2, req: ['bd_chorus'], fx: [{ stat: 'haste', v: 4 }] },
          { id: 'bd_power', name: 'Power Chord', icon: '⚡', tier: 3, x: 1, max: 2, req: ['bd_chorus'], fx: [{ stat: 'atk', v: 3 }, { stat: 'heal', v: 5 }] },
          { id: 'bd_maestro', name: 'Maestro', icon: '𝄞', tier: 4, x: 0, max: 1, keystone: true, req: ['bd_virtuoso', 'bd_power'], fx: [{ key: 'maestro' }], touches: ['anthem', 'basic'],
            desc: 'Every basic attack that lands while you play extends your song by 0.5 s (up to +6 s), and allies under your song deal +8% damage.' },
        ],
      },
      {
        id: 'discord', name: 'Discord', color: '#e879f9', theme: 'Discord stacks, debuffs, Breaks with Crescendo',
        nodes: [
          { id: 'bd_harsh', name: 'Dissonant Tones', icon: '▼', tier: 0, x: -1, max: 3, fx: [{ stat: 'posture', v: 8 }] },
          { id: 'bd_sharp', name: 'Sharp Notes', icon: '♯', tier: 0, x: 1, max: 3, fx: [{ sk: 'basic', dmg: 5 }] },
          { id: 'bd_chord', name: 'Harsh Chord', icon: '◠', tier: 1, x: -1, max: 2, req: ['bd_harsh'], fx: [{ sk: 'dissonance', dmg: 12 }, { sk: 'dissonance', cd: -8 }] },
          { id: 'bd_linger', name: 'Lingering Discord', icon: '∞', tier: 1, x: 1, max: 2, req: ['bd_sharp'], fx: [{ key: 'linger' }], touches: ['basic'],
            desc: 'Discord you apply lasts 1.5 s longer per rank.' },
          { id: 'bd_tension', name: 'Rising Tension', icon: '⤒', tier: 2, x: 0, max: 2, req: ['bd_chord', 'bd_linger'], fx: [{ sk: 'crescendo', cd: -8 }, { stat: 'broken', v: 6 }] },
          { id: 'bd_crack', name: 'Crack', icon: '◎', tier: 3, x: -1, max: 2, req: ['bd_tension'], fx: [{ stat: 'crit', v: 3 }] },
          { id: 'bd_resonance', name: 'Resonance', icon: '❂', tier: 3, x: 1, max: 2, req: ['bd_tension'], fx: [{ key: 'resonance' }],
            desc: 'Enemies take 2% more damage from you per rank for each Discord stack they carry.' },
          { id: 'bd_cacophony', name: 'Cacophony', icon: '✺', tier: 4, x: 0, max: 1, keystone: true, req: ['bd_crack', 'bd_resonance'], fx: [{ key: 'cacophony' }], touches: ['basic', 'crescendo'],
            desc: 'Your basic attacks also add a Discord stack to every enemy within 3 m of the one they hit, and Crescendo (and Grand Finale) needs one stack fewer to BREAK.' },
        ],
      },
      {
        id: 'harmony', name: 'Harmony', color: '#5eead4', theme: 'Shields, party sustain, haste',
        nodes: [
          { id: 'bd_ward', name: 'Warding Song', icon: '☂', tier: 0, x: -1, max: 3, fx: [{ aura: 'dr', v: 2 }] },
          { id: 'bd_life', name: 'Lifesong', icon: '♥', tier: 0, x: 1, max: 3, fx: [{ stat: 'heal', v: 6 }] },
          { id: 'bd_bulwark', name: 'Bulwark Chord', icon: '⛉', tier: 1, x: -1, max: 2, req: ['bd_ward'], fx: [{ key: 'crescshield' }], touches: ['crescendo'],
            desc: 'Crescendo\'s (and Encore\'s) shield is worth 5% more of each ally\'s health per rank.' },
          { id: 'bd_allegro', name: 'Allegro', icon: '⇶', tier: 1, x: 1, max: 2, req: ['bd_life'], fx: [{ stat: 'haste', v: 4 }] },
          { id: 'bd_unity', name: 'Unison', icon: '⚭', tier: 2, x: 0, max: 2, req: ['bd_bulwark', 'bd_allegro'], fx: [{ aura: 'sw', v: 8 }] },
          { id: 'bd_mend', name: 'Mending Notes', icon: '✚', tier: 3, x: -1, max: 2, req: ['bd_unity'], fx: [{ sk: 'crescendo', cd: -8 }, { stat: 'hp', v: 3 }] },
          { id: 'bd_swift', name: 'Swift Song', icon: '»', tier: 3, x: 1, max: 2, req: ['bd_unity'], fx: [{ stat: 'speed', v: 4 }] },
          { id: 'bd_symphony', name: 'Symphony', icon: '❖', tier: 4, x: 0, max: 1, keystone: true, coop: true, req: ['bd_mend', 'bd_swift'], fx: [{ key: 'symphony' }], touches: ['crescendo'],
            desc: 'When an ally within 12 m of you lands a Switch, they get a shield worth 8% of their health (6 s) and your Crescendo recharges 2 s faster.' },
        ],
      },
    ],
    bot: ['bd_ward', 'bd_ward', 'bd_ward', 'bd_life', 'bd_life', 'bd_life', 'bd_bulwark', 'bd_bulwark', 'bd_allegro', 'bd_allegro',
      'bd_unity', 'bd_unity', 'bd_mend', 'bd_mend', 'bd_swift', 'bd_swift', 'bd_symphony', 'bd_breath', 'bd_breath',
      'bd_breath', 'bd_voice', 'bd_voice', 'bd_voice', 'bd_tempo', 'bd_tempo', 'bd_soothe', 'bd_soothe', 'bd_chorus', 'bd_chorus'], // levels 21-30 (Floor 3)
  },
};

// Custom rule numbers (server/talents.js reads these; the descriptions above say the same).
export const KEYS = {
  exec: { below: 0.35, dmg: 0.35 },
  flow: { roll: 1, reset: ['rush', 'whirl'] },
  relay: { r: 12, dmg: 0.15, d: 6, reset: 'burst' },
  parryCounter: {},
  unbreak: { heal: 0.1, hit: 2 },
  jugg: { frac: [0.25, 0.08], posture: 0.4 },
  rally: { stun: 0.8, frac: [0.12, 0.04], r: 10, shield: 0.1, d: 5, every: 2 },
  overflow: { cap: 0.25, d: 6 },
  wrath: { range: 14, width: 1.2, after: 0.7 },
  cleanse: { d: 3 },
  spirit: { r: 15, hp: 0.3, cd: 60 },
  // Ranger
  longshot: { from: 12, dmg: 0.1 },                      // per rank
  deadshot: { refund: 1, sk: 'pierce' },
  pinshot: { slow: 0.3, d: 2 },
  minefield: { mult: 1.5, frac: [0.1, 0.04] },
  deepmark: { bonus: 0.05 },                             // per rank
  packlead: { r: 12, dmg: 0.1, d: 5, reset: 'pierce' },
  // Berserker
  fury: { rage: 0.1 },                                   // per rank
  redmist: { dmg: 0.08 },                                // per rank, at full Rage
  massacre: { rage: 15, reset: 'cleave', below: 0.35, dmg: 0.3 },
  leech: { ls: 0.02 },                                   // per rank
  secondwind: { below: 0.35, dr: 0.06 },                 // per rank
  sanguine: { ext: 1.5, posture: 0.25, heal: 0.15 },
  warcry: { r: 12, dmg: 0.12, d: 6, reset: 'leap', every: 8 },
  // Lancer
  honedtip: { mult: 0.1 },                               // per rank
  dragoon: { cdr: 0.5, posture: 0.4, sk: 'skylance' },
  fade: { roll: 1.5, sk: 'lcharge', window: 3, dmg: 0.4 },
  phalanx: { r: 8, shield: 0.12, d: 5 },
  // Bard
  voice: { pow: 0.05 },                                  // per rank
  soothe: { heal: 0.01 },                                // per rank, per second
  maestro: { ext: 0.5, max: 6, dmg: 0.08 },
  linger: { d: 1.5 },                                    // per rank
  resonance: { dmg: 0.02 },                              // per rank, per stack
  cacophony: { r: 3, need: 1 },
  crescshield: { shield: 0.05 },                         // per rank
  symphony: { r: 12, shield: 0.08, d: 6, cdr: 2, sk: 'crescendo' },
};

// ---------- rule riders (docs/briefs/path.md, Phase 3) ----------
// Every other plain stat node of a branch (2nd, 4th, ...) also carries a small, chancy rule (shared/effects.js) that
// fits the stat, so fewer nodes are a bare number. Ranks raise the rule's chance (talentTotals).
const RIDER = {
  atk: { on: 'crit', do: 'burn', v: 0.06, d: 2, ch: 0.06, icd: 1 },
  crit: { on: 'crit', do: 'mark', v: 0.05, d: 3, ch: 0.075, icd: 1 },
  hp: { on: 'kill', do: 'heal', v: 0.02, r: 0, ch: 0.125 },
  dr: { on: 'break', do: 'shield', v: 0.03, r: 0, d: 4, ch: 0.17 },
  posture: { on: 'hit', do: 'posture', frac: [0.03, 0.01], ch: 0.025, icd: 1 },
  heal: { on: 'heal', do: 'shield', v: 0.02, r: 0, to: 't', d: 4, ch: 0.06, icd: 2 },
  haste: { on: 'kill', do: 'cdcut', v: 0.5, ch: 0.17 },
  speed: { on: 'kill', do: 'dr', v: 0.1, d: 2, ch: 0.17 },
  sw: { on: 'switch', do: 'team', v: 0.03, r: 12, d: 4, ch: 0.17 },
  threat: { on: 'hit', do: 'slow', v: 0.15, d: 2, ch: 0.025, icd: 1 },
};
for (const tree of Object.values(TREES)) for (const b of tree.branches) {
  let k = 0;
  for (const n of b.nodes) {
    if (n.keystone || n.sub || n.fx.length !== 1 || !n.fx[0].stat || !RIDER[n.fx[0].stat]) continue;
    if (k++ % 2 === 0) continue;
    const e = n.fx[0];
    n.fx = [e, { rule: { ...RIDER[e.stat] } }];
  }
}

// ---------- subclass nodes (docs/briefs/subclasses.md) ----------
// Two per subclass (shared/subclasses.js), in tier 2 of the branch it is built on, in the side columns under that
// branch's tier-1 nodes. Only that subclass can learn them (`sub`), and they never count toward a tier gate (so a change
// of subclass, which refunds them, can't shut a tier). { sk: 'sig' } effects aim at the signature skill (slot 5).
const SIGN = (dmg = true) => (dmg ? [{ sk: 'sig', dmg: 8 }, { sk: 'sig', cd: -6 }] : [{ sk: 'sig', cd: -8 }]);
const SUB_NODES = [
  // [class, branch, subclass, left node (x -1), right node (x 1)]
  ['swordsman', 'tempo', 'duelist', { id: 'sw_du_feint', name: 'Feint', icon: '⤺', max: 3, fx: [{ stat: 'counter', v: 10 }] }, { id: 'sw_du_sig', name: 'Flash Mastery', icon: '⚡', max: 2, fx: SIGN() }],
  ['swordsman', 'link', 'vanguard', { id: 'sw_va_point', name: 'Point of the Spear', icon: '⇄', max: 3, fx: [{ stat: 'sw', v: 8 }] }, { id: 'sw_va_sig', name: 'Rallying Mastery', icon: '✺', max: 2, fx: SIGN() }],
  ['guardian', 'bulwark', 'bulwark', { id: 'gu_bk_plate', name: 'Tower Plate', icon: '⛨', max: 3, fx: [{ stat: 'hp', v: 4 }] }, { id: 'gu_bk_sig', name: 'Aegis Mastery', icon: '⛉', max: 2, fx: SIGN(false) }],
  ['guardian', 'warlord', 'warlord', { id: 'gu_wl_iron', name: 'Iron Will', icon: '▼', max: 3, fx: [{ stat: 'posture', v: 6 }] }, { id: 'gu_wl_sig', name: 'Roar Mastery', icon: '☗', max: 2, fx: SIGN() }],
  ['cleric', 'mercy', 'lightbringer', { id: 'cl_lb_grace', name: 'Radiance', icon: '✚', max: 3, fx: [{ stat: 'heal', v: 5 }] }, { id: 'cl_lb_sig', name: 'Dawn Mastery', icon: '☀', max: 2, fx: SIGN(false) }],
  ['cleric', 'judgement', 'inquisitor', { id: 'cl_iq_zeal', name: 'Zealot', icon: '◎', max: 3, fx: [{ stat: 'crit', v: 2 }] }, { id: 'cl_iq_sig', name: 'Ray Mastery', icon: '⚚', max: 2, fx: SIGN() }],
  ['ranger', 'marksman', 'sharpshooter', { id: 'rg_ss_eye', name: 'Hawk Eye', icon: '◎', max: 3, fx: [{ stat: 'crit', v: 3 }] }, { id: 'rg_ss_sig', name: 'Deadeye Mastery', icon: '➶', max: 2, fx: SIGN() }],
  ['ranger', 'trapper', 'trapmaster', { id: 'rg_tm_stride', name: 'Light Stride', icon: '➹', max: 3, fx: [{ stat: 'speed', v: 3 }] }, { id: 'rg_tm_sig', name: 'Snare Mastery', icon: '⌗', max: 2, fx: SIGN() }],
  ['berserker', 'carnage', 'reaver', { id: 'bz_rv_edge', name: 'Reaver\'s Edge', icon: '⚔', max: 3, fx: [{ stat: 'atk', v: 3 }] }, { id: 'bz_rv_sig', name: 'Rampage Mastery', icon: '❂', max: 2, fx: SIGN() }],
  ['berserker', 'bloodlust', 'bloodknight', { id: 'bz_bk_vigor', name: 'Blood Vigor', icon: '✚', max: 3, fx: [{ stat: 'hp', v: 4 }] }, { id: 'bz_bk_sig', name: 'Pact Mastery', icon: '♥', max: 2, fx: SIGN() }],
  ['lancer', 'dragoon', 'dragoon', { id: 'ln_dg_talon', name: 'Talon', icon: '▼', max: 3, fx: [{ stat: 'posture', v: 6 }] }, { id: 'ln_dg_sig', name: 'Dive Mastery', icon: '➘', max: 2, fx: SIGN() }],
  ['lancer', 'phalanx', 'phalanx', { id: 'ln_ph_line', name: 'Spear Line', icon: '▣', max: 3, fx: [{ stat: 'dr', v: 2 }] }, { id: 'ln_ph_sig', name: 'Wall Mastery', icon: '⛊', max: 2, fx: SIGN() }],
  ['bard', 'maestro', 'virtuoso', { id: 'bd_vi_flourish', name: 'Flourish', icon: '⧗', max: 3, fx: [{ stat: 'haste', v: 3 }] }, { id: 'bd_vi_sig', name: 'Encore Mastery', icon: '♫', max: 2, fx: SIGN(false) }],
  ['bard', 'discord', 'siren', { id: 'bd_si_shrill', name: 'Shrill Note', icon: '▼', max: 3, fx: [{ stat: 'posture', v: 6 }] }, { id: 'bd_si_sig', name: 'Wail Mastery', icon: '♪', max: 2, fx: SIGN() }],
];
for (const [cls, bid, sub, a, b] of SUB_NODES) {
  const br = TREES[cls].branches.find(x => x.id === bid), side = x => br.nodes.find(n => n.tier === 1 && n.x === x).id;
  br.nodes.push({ ...a, tier: 2, x: -1, sub, req: [side(-1)] }, { ...b, tier: 2, x: 1, sub, req: [side(1)] });
}

// ---------- Subclass II (level 22) and the Crown (level 30) (docs/briefs/path.md, Phase 3) ----------
// Three more nodes per subclass in its branch: two at tier 4 beside the branch's keystone (x -1 / 1, `lvl` 22) and the
// Crown in a row of its own below (tier 5, `lvl` 30, a keystone). Like the first two they need the subclass and never
// count toward a tier gate; they need the tier-4 gate themselves. `rule` effects: shared/effects.js (server/effects.js).
const RU = (on, d, o = {}) => ({ rule: { on, do: d, ...o } });
export const SUB2 = { lvl: 22, crownLvl: MAX_LEVEL };
const SUB2_NODES = [
  // [class, branch, subclass, II left, II right, Crown]
  ['swordsman', 'tempo', 'duelist',
    { id: 'sw_du_riposte', name: 'Cut and Turn', icon: '↺', max: 2, fx: [{ stat: 'counter', v: 8 }, RU('crit', 'cdcut', { v: 0.5, icd: 2, ch: 0.5 })] },
    { id: 'sw_du_blur', name: 'Blur', icon: '≋', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('cast', 'dr', { v: 0.2, d: 2, sk: 'sig' })] },
    { id: 'sw_du_crown', name: 'Crown: Untouchable', icon: '♛', max: 1, keystone: 1, desc: 'Every kill takes 3 s off your skills, and your critical hits mark their target (+10% damage taken, 4 s).', fx: [RU('kill', 'cdcut', { v: 3, icd: 1 }), RU('crit', 'mark', { v: 0.1, d: 4, icd: 1 })] }],
  ['swordsman', 'link', 'vanguard',
    { id: 'sw_va_banner', name: 'Banner Bearer', icon: '⚑', max: 2, fx: [{ stat: 'sw', v: 6 }, RU('switch', 'team', { v: 0.05, r: 12, d: 5 })] },
    { id: 'sw_va_cleaver', name: 'Opening Cleave', icon: '⚔', max: 1, fx: [{ sk: 'sig', dmg: 8 }, RU('hit', 'posture', { frac: [0.08, 0.03], sk: 'sig', icd: 1 })] },
    { id: 'sw_va_crown', name: 'Crown: The First Blade', icon: '♛', max: 1, keystone: 1, coop: 1, desc: 'Each Break you cause rallies the party: +10% damage for 5 s within 12 m, and a shield of 5% of max health.', fx: [RU('break', 'team', { v: 0.1, r: 12, d: 5 }), RU('break', 'shield', { v: 0.05, r: 12, d: 5 })] }],
  ['guardian', 'bulwark', 'bulwark',
    { id: 'gu_bk_bastion', name: 'Living Bastion', icon: '⛨', max: 2, fx: [{ stat: 'dr', v: 2 }, RU('break', 'shield', { v: 0.05, r: 0, d: 5 })] },
    { id: 'gu_bk_vigil', name: 'Vigil', icon: '⛉', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('cast', 'heal', { v: 0.06, r: 10, sk: 'sig' })] },
    { id: 'gu_bk_crown', name: 'Crown: The Unmoving', icon: '♛', max: 1, keystone: 1, coop: 1, desc: 'Using any skill shields you and allies within 8 m for 4% of max health (once every 4 s); kills shield you for 6%.', fx: [RU('cast', 'shield', { v: 0.04, r: 8, d: 5, icd: 4 }), RU('kill', 'shield', { v: 0.06, r: 0, d: 5, icd: 2 })] }],
  ['guardian', 'warlord', 'warlord',
    { id: 'gu_wl_dread', name: 'Dread', icon: '☗', max: 2, fx: [{ stat: 'posture', v: 5 }, RU('hit', 'slow', { v: 0.2, d: 2, ch: 0.15 })] },
    { id: 'gu_wl_command', name: 'Command', icon: '⚑', max: 1, fx: [{ sk: 'sig', dmg: 8 }, RU('cast', 'team', { v: 0.08, r: 12, d: 6, sk: 'sig' })] },
    { id: 'gu_wl_crown', name: 'Crown: Conqueror', icon: '♛', max: 1, keystone: 1, desc: 'Every Break you cause stuns the enemy 1 s longer and takes 2 s off your skills.', fx: [RU('break', 'stun', { d: 1 }), RU('break', 'cdcut', { v: 2 })] }],
  ['cleric', 'mercy', 'lightbringer',
    { id: 'cl_lb_halo', name: 'Halo', icon: '◯', max: 2, fx: [{ stat: 'heal', v: 4 }, RU('heal', 'shield', { v: 0.03, r: 0, to: 't', d: 4, icd: 3 })] },
    { id: 'cl_lb_zenith', name: 'Zenith', icon: '☀', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('cast', 'cdcut', { v: 2, sk: 'sig' })] },
    { id: 'cl_lb_crown', name: 'Crown: Sunrise', icon: '♛', max: 1, keystone: 1, coop: 1, desc: 'Your heals also give the party +6% damage for 5 s within 12 m (once every 3 s), and each kill heals you and allies within 12 m for 4%.', fx: [RU('heal', 'team', { v: 0.06, r: 12, d: 5, icd: 3 }), RU('kill', 'heal', { v: 0.04, r: 12, icd: 2 })] }],
  ['cleric', 'judgement', 'inquisitor',
    { id: 'cl_iq_brand', name: 'Brand', icon: '✶', max: 2, fx: [{ stat: 'crit', v: 2 }, RU('crit', 'burn', { v: 0.1, d: 3, icd: 1 })] },
    { id: 'cl_iq_sentence', name: 'Sentence', icon: '⚚', max: 1, fx: [{ sk: 'sig', dmg: 8 }, RU('hit', 'mark', { v: 0.08, d: 4, sk: 'sig' })] },
    { id: 'cl_iq_crown', name: 'Crown: Final Judgement', icon: '♛', max: 1, keystone: 1, desc: 'Your critical hits burst around the target for 50% attack (once a second), and kills take 2 s off your skills.', fx: [RU('crit', 'burst', { mult: 0.5, r: 3, icd: 1 }), RU('kill', 'cdcut', { v: 2, icd: 1 })] }],
  ['ranger', 'marksman', 'sharpshooter',
    { id: 'rg_ss_steady', name: 'Eagle Focus', icon: '◎', max: 2, fx: [{ stat: 'crit', v: 2 }, RU('crit', 'mark', { v: 0.06, d: 3, icd: 1 })] },
    { id: 'rg_ss_breath', name: 'Held Breath', icon: '➶', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('crit', 'cdcut', { v: 1, sk: 'sig' })] },
    { id: 'rg_ss_crown', name: 'Crown: One Arrow', icon: '♛', max: 1, keystone: 1, desc: 'Kills refund 3 s of your skills; your critical hits break 8% of the target\'s posture (3% bosses).', fx: [RU('kill', 'cdcut', { v: 3, icd: 1 }), RU('crit', 'posture', { frac: [0.08, 0.03], icd: 0.5 })] }],
  ['ranger', 'trapper', 'trapmaster',
    { id: 'rg_tm_caltrops', name: 'Caltrops', icon: '⌗', max: 2, fx: [{ stat: 'speed', v: 2 }, RU('hit', 'slow', { v: 0.2, d: 2, ch: 0.15 })] },
    { id: 'rg_tm_springs', name: 'Spring Net', icon: '⇲', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('cast', 'pull', { r: 8, v: 1.5, sk: 'sig' })] },
    { id: 'rg_tm_crown', name: 'Crown: The Killing Ground', icon: '♛', max: 1, keystone: 1, coop: 1, desc: 'Each Break you cause marks the enemy (+12% damage taken, 5 s) and slows enemies near it.', fx: [RU('break', 'mark', { v: 0.12, d: 5 }), RU('break', 'slow', { v: 0.4, d: 4 })] }],
  ['berserker', 'carnage', 'reaver',
    { id: 'bz_rv_frenzy', name: 'Bloodied Edge', icon: '⚔', max: 2, fx: [{ stat: 'atk', v: 2 }, RU('kill', 'rage', { v: 8 })] },
    { id: 'bz_rv_storm', name: 'Axe Storm', icon: '❂', max: 1, fx: [{ sk: 'sig', dmg: 8 }, RU('kill', 'cdcut', { v: 2, sk: 'sig' })] },
    { id: 'bz_rv_crown', name: 'Crown: The Red Harvest', icon: '♛', max: 1, keystone: 1, desc: 'Each kill bursts around the fallen for 60% attack (once a second) and gives 10 Rage.', fx: [RU('kill', 'burst', { mult: 0.6, r: 4, icd: 1 }), RU('kill', 'rage', { v: 10 })] }],
  ['berserker', 'bloodlust', 'bloodknight',
    { id: 'bz_bk_thirst', name: 'Thirst', icon: '♥', max: 2, fx: [{ stat: 'hp', v: 3 }, RU('crit', 'heal', { v: 0.02, r: 0, icd: 1 })] },
    { id: 'bz_bk_oath', name: 'Blood Oath', icon: '✚', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('cast', 'dr', { v: 0.2, d: 3, sk: 'sig' })] },
    { id: 'bz_bk_crown', name: 'Crown: Crimson Lord', icon: '♛', max: 1, keystone: 1, desc: 'Each kill heals you for 6% of max health; Breaks you cause shield you for 8%.', fx: [RU('kill', 'heal', { v: 0.06, r: 0 }), RU('break', 'shield', { v: 0.08, r: 0, d: 5 })] }],
  ['lancer', 'dragoon', 'dragoon',
    { id: 'ln_dg_updraft', name: 'Updraft', icon: '↟', max: 2, fx: [{ stat: 'posture', v: 5 }, RU('break', 'cdcut', { v: 1.5 })] },
    { id: 'ln_dg_wings', name: 'Wings', icon: '➘', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('hit', 'stun', { d: 0.5, sk: 'sig', icd: 1 })] },
    { id: 'ln_dg_crown', name: 'Crown: Skyfall', icon: '♛', max: 1, keystone: 1, desc: 'Every Break you cause bursts for 80% attack around the enemy; kills take 2 s off your skills.', fx: [RU('break', 'burst', { mult: 0.8, r: 4 }), RU('kill', 'cdcut', { v: 2, icd: 1 })] }],
  ['lancer', 'phalanx', 'phalanx',
    { id: 'ln_ph_shieldwall', name: 'Shieldwall', icon: '▣', max: 2, fx: [{ stat: 'dr', v: 2 }, RU('switch', 'shield', { v: 0.04, r: 8, d: 5 })] },
    { id: 'ln_ph_brace', name: 'Brace', icon: '⛊', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('cast', 'shield', { v: 0.05, r: 8, d: 5, sk: 'sig' })] },
    { id: 'ln_ph_crown', name: 'Crown: The Living Wall', icon: '♛', max: 1, keystone: 1, coop: 1, desc: 'Using any skill gives you and allies within 8 m 10% less damage taken for 3 s (once every 5 s); Breaks pull enemies in.', fx: [RU('cast', 'dr', { v: 0.1, d: 3, icd: 5 }), RU('break', 'pull', { r: 7, v: 1.5 })] }],
  ['bard', 'maestro', 'virtuoso',
    { id: 'bd_vi_tempo', name: 'Rubato', icon: '⧗', max: 2, fx: [{ stat: 'haste', v: 2 }, RU('switch', 'cdcut', { v: 1 })] },
    { id: 'bd_vi_bravo', name: 'Bravo', icon: '♫', max: 1, fx: [{ sk: 'sig', cd: -8 }, RU('cast', 'heal', { v: 0.05, r: 14, sk: 'sig' })] },
    { id: 'bd_vi_crown', name: 'Crown: Magnum Opus', icon: '♛', max: 1, keystone: 1, coop: 1, desc: 'Using any skill gives the party within 14 m +5% damage for 5 s (once every 4 s); kills take 1.5 s off your skills.', fx: [RU('cast', 'team', { v: 0.05, r: 14, d: 5, icd: 4 }), RU('kill', 'cdcut', { v: 1.5, icd: 1 })] }],
  ['bard', 'discord', 'siren',
    { id: 'bd_si_echo', name: 'Echo', icon: '▼', max: 2, fx: [{ stat: 'posture', v: 5 }, RU('hit', 'mark', { v: 0.05, d: 3, ch: 0.15 })] },
    { id: 'bd_si_shriek', name: 'Shriek', icon: '♪', max: 1, fx: [{ sk: 'sig', dmg: 8 }, RU('hit', 'stun', { d: 0.6, sk: 'sig', icd: 1 })] },
    { id: 'bd_si_crown', name: 'Crown: Song of Ruin', icon: '♛', max: 1, keystone: 1, desc: 'Each Break you cause marks the enemy (+12% damage taken, 5 s) and slows those around it by 40%.', fx: [RU('break', 'mark', { v: 0.12, d: 5 }), RU('break', 'slow', { v: 0.4, d: 4 })] }],
];
for (const [cls, bid, sub, a, b, c] of SUB2_NODES) {
  const br = TREES[cls].branches.find(x => x.id === bid), t3 = br.nodes.filter(n => n.tier === 3 && !n.sub).map(n => n.id);
  br.nodes.push({ ...a, tier: 4, x: -1, sub, lvl: SUB2.lvl, req: t3 }, { ...b, tier: 4, x: 1, sub, lvl: SUB2.lvl, req: t3 },
    { ...c, tier: 5, x: 0, sub, lvl: SUB2.crownLvl, req: [a.id, b.id] });
}

// ---------- lookups ----------
const NODE = new Map(); // id -> { ...node, cls, branch }
for (const [cls, tree] of Object.entries(TREES)) {
  for (const b of tree.branches) for (const n of b.nodes) NODE.set(n.id, { ...n, cls, branch: b.id });
}
export const nodeDef = id => NODE.get(id) || null;
export const treeOf = cls => TREES[cls] || null;
export const nodesOf = cls => (TREES[cls]?.branches || []).flatMap(b => b.nodes.map(n => NODE.get(n.id))); // with .cls and .branch
export const spentOf = alloc => Object.values(alloc || {}).reduce((a, r) => a + (r | 0), 0);
export const branchSpent = (alloc, cls, bid) => (TREES[cls]?.branches.find(b => b.id === bid)?.nodes || []).reduce((a, n) => a + (alloc?.[n.id] | 0), 0);
// Points spent in the tiers above tier k.
// (Subclass nodes never count toward a gate.)
export const spentAbove = (alloc, cls, tier) => nodesOf(cls).reduce((a, n) => a + (n.tier < tier && !n.sub ? alloc?.[n.id] | 0 : 0), 0);
// Can this node be learned with this subclass (shared/subclasses.js)? Nodes without `sub` are open to everyone.
export const subOk = (n, sub) => !n?.sub || n.sub === sub;
// The points a node's tier needs above it (row 5, the Crown, has the last tier's gate).
export const gateOf = n => TALENTS.tiers[Math.min(n.tier, TALENTS.tiers.length - 1)];
// The skill key used by effects: 'basic' for slot 0, else the skill id.
export const skKey = (cls, skId) => (CLASSES[cls]?.skills[0]?.id === skId ? 'basic' : skId);
export const skillLabel = (cls, key) => (key === 'basic' ? CLASSES[cls]?.skills[0]?.name : key === 'sig' ? 'Signature skill' : CLASSES[cls]?.skills.find(s => s.id === key)?.name) || key;

// Why a node can't take another rank right now (null = it can). Checks rank, prerequisites, tier gate and points.
// sub: the character's subclass for this class (subclass nodes need it).
export function spendBlock(cls, alloc, lvl, id, sub = null) {
  const n = NODE.get(id);
  if (!n || n.cls !== cls) return 'Not in your tree.';
  if (!subOk(n, sub)) return 'Opens with that specialisation (the Academy, level 15).';
  const r = alloc?.[id] | 0;
  if (r >= n.max) return 'Already at max rank.';
  if (n.lvl && (lvl | 0) < n.lvl) return `Opens at level ${n.lvl}.`;
  if (spentOf(alloc) >= pointsAt(lvl)) return 'No talent points left (1 per level).';
  if (spentAbove(alloc, cls, n.tier) < gateOf(n)) return `Needs ${gateOf(n)} points in the tiers above (${spentAbove(alloc, cls, n.tier)} so far).`;
  if (n.req?.length && !n.req.some(q => (alloc?.[q] | 0) > 0)) return `Needs a point in ${n.req.map(q => NODE.get(q)?.name).join(' or ')}.`;
  return null;
}

// Is a whole allocation legal (ranks, prerequisites, tier gates, total vs level)? Returns an error string or null.
export function allocError(cls, alloc, lvl, sub = null) {
  for (const [id, r] of Object.entries(alloc || {})) {
    const n = NODE.get(id);
    if (!n || n.cls !== cls) return `${id} is not a ${CLASSES[cls]?.name || cls} talent.`;
    if (r && !subOk(n, sub)) return `${n.name} needs its specialisation.`;
    if (!Number.isInteger(r) || r < 0 || r > n.max) return `${n.name}: rank must be 0..${n.max}.`;
    if (!r) continue;
    if (spentAbove(alloc, cls, n.tier) < gateOf(n)) return `${n.name} needs ${gateOf(n)} points in the tiers above it.`;
    if (n.lvl && lvl !== undefined && (lvl | 0) < n.lvl) return `${n.name} opens at level ${n.lvl}.`;
    if (n.req?.length && !n.req.some(q => (alloc[q] | 0) > 0)) return `${n.name} needs a point in ${n.req.map(q => NODE.get(q)?.name).join(' or ')}.`;
  }
  if (lvl !== undefined && spentOf(alloc) > pointsAt(lvl)) return `${spentOf(alloc)} points spent but level ${lvl} only gives ${pointsAt(lvl)}.`;
  return null;
}

// Can one rank of `id` be taken back without breaking the rest of the tree?
export function refundBlock(cls, alloc, id, sub = null) {
  if (!(alloc?.[id] > 0)) return 'No points in it.';
  const next = { ...alloc, [id]: alloc[id] - 1 };
  if (!next[id]) delete next[id];
  const err = allocError(cls, next, undefined, sub);
  return err ? `Other talents depend on it (${err})` : null;
}

// Sanitise a saved record: { nodeId: rank } for this class and level. Anything illegal -> a clean (free) reset.
// sub: the subclass (its nodes are kept; another subclass's are dropped, their points free again).
export function newTalents(raw, cls, lvl, sub = null) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, r] of Object.entries(raw)) {
      const n = NODE.get(id);
      if (!n || n.cls !== cls || !subOk(n, sub)) continue;
      const v = Math.max(0, Math.min(n.max, Math.floor(+r) || 0));
      if (v) out[id] = v;
    }
  }
  return allocError(cls, out, lvl, sub) ? {} : out;
}

// Sum every effect of an allocation: { stat: {atk: 6, ...}, sk: { basic: {cd, dmg, fin, radius, dur}, rush: {...} }, aura: {...}, keys: {exec: 1} }.
export function talentTotals(cls, alloc) {
  const T = { stat: {}, sk: {}, aura: {}, keys: {}, rules: [] };
  for (const n of nodesOf(cls)) {
    const r = alloc?.[n.id] | 0;
    if (!r) continue;
    for (const e of n.fx) {
      if (e.stat) T.stat[e.stat] = (T.stat[e.stat] || 0) + e.v * r;
      else if (e.sk) { const m = (T.sk[e.sk] ||= {}); for (const k of ['cd', 'dmg', 'fin', 'radius', 'dur']) if (e[k]) m[k] = (m[k] || 0) + e[k] * r; }
      else if (e.aura) T.aura[e.aura] = (T.aura[e.aura] || 0) + e.v * r;
      else if (e.key) T.keys[e.key] = r;
      else if (e.rule) T.rules.push({ ...e.rule, id: `${n.id}:${n.fx.indexOf(e)}`, ...(e.rule.ch ? { ch: Math.min(1, e.rule.ch * r) } : {}) }); // (shared/effects.js; ranks raise the chance)
    }
  }
  if (T.stat.speed) T.stat.speed = Math.min(TALENTS.caps.speed, T.stat.speed);
  return T;
}

// Human text for one effect at a rank (0 rank -> per-rank value).
export function effectText(cls, e, rank = 1) {
  const r = Math.max(1, rank);
  if (e.stat) return STAT_TEXT[e.stat](e.v * r);
  if (e.aura) return `you and allies within ${TALENTS.auraR} m ${AURA_TEXT[e.aura]} ${e.aura === 'dr' ? `${e.v * r}% less damage` : e.aura === 'sw' ? `+${e.v * r}% Switch damage` : `+${e.v * r}% damage`}`;
  if (e.sk) {
    const nm = skillLabel(cls, e.sk) + (e.sk === 'basic' ? ' (basic attack)' : '');
    if (e.cd) return `${nm}: ${e.cd * r}% cooldown`;
    if (e.dmg) return `${nm}: +${e.dmg * r}% damage`;
    if (e.fin) return `${nm}: finisher (3rd hit) +${e.fin * r}% damage`;
    if (e.radius) return `${nm}: +${e.radius * r}% radius`;
    if (e.dur) return `${nm}: lasts +${e.dur * r}% longer`;
  }
  return '';
}
// Lines describing a node at a rank (keystones/special nodes use their desc).
export function nodeLines(cls, n, rank) {
  const lines = [];
  if (n.desc) lines.push(n.desc);
  for (const e of n.fx) if (!e.key && !(e.rule && n.desc)) lines.push(e.rule ? ruleText(e.rule.ch ? { ...e.rule, ch: Math.min(1, e.rule.ch * Math.max(1, rank)) } : e.rule) : effectText(cls, e, rank));
  return lines;
}

// Talent nodes that touch a skill (for the Abilities pane). key: 'basic' or a skill id.
export function nodesForSkill(cls, key) {
  return nodesOf(cls).filter(n => n.touches?.includes(key) || n.fx.some(e => e.sk === key));
}

// Level milestones for the Progression track (besides skills, points and tiers, which come from the data).
export const MILESTONES = [
  { lvl: 5, text: 'Wolf Woods and the Raid Gate' },
  { lvl: 10, text: 'The Horned Warden (boss, Lv 10): beat it to unlock Floor 2' },
  { lvl: 11, text: 'Floor 2: the Glimmering Mire (Lv 11-18)' },
  { lvl: 15, text: 'The Drowned Sovereign (party Lv 15+)' },
  { lvl: 21, text: 'Floor 3: the Gale Spires (Lv 21-28)' },
  { lvl: 25, text: 'The Storm Colossus (party Lv 25+)' },
  { lvl: MAX_LEVEL, text: 'Max level' },
];

// ---------- build identity (docs/briefs/path.md) ----------
// Every effect leans toward one of five tags; the summed shape names the build ("Swift Duelist"). Keystones and other
// custom rules take their branch's tag. Used by the Path window and the Players list (the roster's `bt`).
export const BUILD_TAGS = ['power', 'tempo', 'guard', 'team', 'control'];
export const TAG_TEXT = {
  power: { axis: 'Power', word: 'Fierce', line: 'Hit hard and finish what you start.' },
  tempo: { axis: 'Tempo', word: 'Swift', line: 'Roll in, strike, roll out. Never where the blow lands.' },
  guard: { axis: 'Guard', word: 'Stalwart', line: 'Hold the line and outlast whatever comes.' },
  team: { axis: 'Team', word: 'Rallying', line: 'Every ally near you fights better.' },
  control: { axis: 'Control', word: 'Tactical', line: 'Set the fight\'s pace: Breaks, slows and openings.' },
};
const STAT_TAG = { atk: 'power', crit: 'power', broken: 'power', haste: 'tempo', speed: 'tempo', dodge: 'tempo', counter: 'tempo',
  hp: 'guard', dr: 'guard', guard: 'guard', threat: 'guard', sw: 'team', heal: 'team', posture: 'control' };
const SK_TAG = { dmg: 'power', fin: 'power', cd: 'tempo', radius: 'control', dur: 'control' };
export const BRANCH_TAG = {
  blade: 'power', tempo: 'tempo', link: 'team', bulwark: 'guard', warlord: 'control', vanguard: 'team',
  mercy: 'team', judgement: 'power', grace: 'team', marksman: 'power', trapper: 'control', packhunt: 'team',
  carnage: 'power', bloodlust: 'guard', warcry: 'control', dragoon: 'power', skirmish: 'tempo', phalanx: 'control',
  maestro: 'team', discord: 'control', harmony: 'team',
};
// The tags one node adds per rank (a node with several effects splits its weight).
const RULE_TAG = { burn: 'power', burst: 'power', mark: 'power', rage: 'power', cdcut: 'tempo', slow: 'control', stun: 'control', posture: 'control', pull: 'control', shield: 'guard', dr: 'guard', heal: 'team', team: 'team' };
export function nodeTags(n) {
  const out = {}, fx = n?.fx || [];
  for (const e of fx) {
    const t = e.key || e.proc ? BRANCH_TAG[n.branch] : e.rule ? RULE_TAG[e.rule.do] : e.stat ? STAT_TAG[e.stat] : e.aura ? 'team' : e.sk ? SK_TAG[Object.keys(SK_TAG).find(k => e[k])] : null;
    if (t) out[t] = (out[t] || 0) + 1 / fx.length;
  }
  if (n?.keystone) for (const t of Object.keys(out)) out[t] *= 2; // a keystone says a lot about a build
  return out;
}
// { power, tempo, guard, team, control } as fractions of the largest (0..1); all 0 with nothing spent.
export function buildShape(cls, alloc) {
  const s = Object.fromEntries(BUILD_TAGS.map(t => [t, 0]));
  for (const n of nodesOf(cls)) {
    const r = alloc?.[n.id] | 0;
    if (r) for (const [t, w] of Object.entries(nodeTags(n))) s[t] += w * r;
  }
  const top = Math.max(...Object.values(s));
  if (top > 0) for (const t of BUILD_TAGS) s[t] = Math.round((s[t] / top) * 100) / 100;
  return s;
}
// The leading tag, or null below 3 points spent.
export function buildTag(cls, alloc) {
  if (spentOf(alloc) < 3) return null;
  const s = buildShape(cls, alloc);
  return BUILD_TAGS.reduce((a, t) => (s[t] > s[a] ? t : a), BUILD_TAGS[0]);
}
// "Swift Duelist" (title = the subclass name, else the class name).
export const buildName = (tag, title) => (tag && TAG_TEXT[tag] ? `${TAG_TEXT[tag].word} ${title}` : title);

// ---------- suggested path (the Talents tab's toggle) ----------
// One entry per rank: the subclass's branch first (its own nodes included, tier by tier), then the class's bot order.
export function suggestOrder(cls, sub = null, subBranch = null) {
  const t = TREES[cls]; if (!t) return [];
  const out = [], has = {};
  const add = n => { while ((has[n.id] | 0) < n.max) { out.push(n.id); has[n.id] = (has[n.id] | 0) + 1; } };
  const b = subBranch && t.branches.find(x => x.id === subBranch);
  if (b) for (const n of [...b.nodes].filter(n => subOk(n, sub)).sort((p, q) => p.tier - q.tier || p.x - q.x)) add(n);
  for (const id of t.bot || []) { const n = NODE.get(id); if (n && (has[id] | 0) < n.max) { out.push(id); has[id] = (has[id] | 0) + 1; } }
  return out;
}

// ---------- plan, then confirm ----------
// The allocation after taking ranks `ids` in order, or an error string for the first one that can't be taken.
export function planAlloc(cls, alloc, lvl, ids, sub = null) {
  const next = { ...(alloc || {}) };
  for (const id of ids || []) {
    const why = spendBlock(cls, next, lvl, String(id), sub);
    if (why) return { error: `${NODE.get(String(id))?.name || id}: ${why}` };
    next[id] = (next[id] | 0) + 1;
  }
  return { alloc: next };
}
