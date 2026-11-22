// The shape each skill is drawn as (the Path window's Abilities tab, the evolution moment): a player at the bottom,
// facing up, and what the skill reaches. Client only; a picture, not the rules (those live on the server).
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const SKILL_SHAPE = {
  slash: 'combo', bash: 'combo', chop: 'combo', lthrust: 'thrust', burst: 'combo',
  rush: 'dash', lcharge: 'dash', flashstep: 'dash', leap: 'zone', skylance: 'zone', wyverndive: 'zone', disengage: 'back',
  whirl: 'ring', lsweep: 'ring', gslam: 'ring', rampage: 'ring', conqroar: 'pull', taunt: 'pull',
  cleave: 'cone', dissonance: 'cone', rallycut: 'cone',
  pierce: 'line', judgeray: 'line', deadeye: 'line', spearwall: 'line',
  smite: 'bolt', shot: 'bolt', sonic: 'bolt', sirenwail: 'cone', mark: 'mark',
  wall: 'self', bloodrage: 'self', crimsonpact: 'self',
  bless: 'aura', anthem: 'aura', crescendo: 'aura', aegisline: 'aura', dawnburst: 'aura', encore: 'aura',
  heal: 'heal', sanct: 'zone', snarefield: 'zone',
};
export const SHAPE_WORD = { combo: 'Melee combo', thrust: 'Long, narrow line', dash: 'Dash through a line', zone: 'Lands on a spot', back: 'Leap back',
  ring: 'All around you', pull: 'Pulls enemies in', cone: 'Cone in front', line: 'Piercing line', bolt: 'Ranged bolt', mark: 'One target',
  self: 'On yourself', aura: 'You and allies nearby', heal: 'An ally' };

export function skillDiagram(id, col, cls = 'diag') {
  const k = SKILL_SHAPE[id] || 'combo', W = 190, H = 130, px = 95, py = 104;
  const me = `<circle cx="${px}" cy="${py}" r="7" fill="#e8e2d0"/><path d="M${px} ${py - 12} l-4 5 h8z" fill="#e8e2d0"/>`;
  const f = `fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"`;
  const foe = (x, y) => `<circle cx="${x}" cy="${y}" r="6" fill="#f87171" fill-opacity=".85"/>`;
  const g = {
    combo: `<path d="M${px - 34} ${py - 22} Q${px} ${py - 60} ${px + 34} ${py - 22}" ${f} fill="none"/><path d="M${px - 26} ${py - 34} Q${px} ${py - 70} ${px + 26} ${py - 34}" stroke="${col}" stroke-width="2" fill="none" stroke-opacity=".6"/>${foe(px, py - 52)}`,
    thrust: `<rect x="${px - 7}" y="${py - 86}" width="14" height="74" rx="4" ${f}/>${foe(px, py - 60)}${foe(px, py - 80)}`,
    dash: `<rect x="${px - 12}" y="${py - 88}" width="24" height="76" rx="8" ${f} stroke-dasharray="5 4"/><circle cx="${px}" cy="${py - 92}" r="7" fill="none" stroke="#e8e2d0" stroke-dasharray="3 3"/>${foe(px - 4, py - 50)}${foe(px + 5, py - 70)}`,
    line: `<rect x="${px - 6}" y="12" width="12" height="${py - 24}" rx="3" ${f}/>${foe(px, py - 40)}${foe(px, py - 72)}`,
    bolt: `<line x1="${px}" y1="${py - 14}" x2="${px}" y2="${py - 70}" stroke="${col}" stroke-width="2" stroke-dasharray="4 4"/><circle cx="${px}" cy="${py - 76}" r="7" ${f}/>${foe(px, py - 76)}`,
    cone: `<path d="M${px} ${py - 8} L${px - 62} ${py - 74} Q${px} ${py - 100} ${px + 62} ${py - 74} Z" ${f}/>${foe(px - 20, py - 60)}${foe(px + 24, py - 54)}`,
    ring: `<circle cx="${px}" cy="${py - 40}" r="44" ${f}/>${foe(px - 30, py - 60)}${foe(px + 34, py - 34)}${foe(px + 8, py - 76)}`,
    pull: `<circle cx="${px}" cy="${py - 40}" r="46" ${f} stroke-dasharray="5 4"/>${[[-36, -64], [38, -30], [10, -80]].map(([dx, dy]) => `${foe(px + dx, py + dy)}<line x1="${px + dx * 0.7}" y1="${py + dy * 0.7}" x2="${px + dx * 0.35}" y2="${py + dy * 0.35 - 20}" stroke="${col}" stroke-width="1.5"/>`).join('')}`,
    zone: `<path d="M${px} ${py - 10} Q${px + 40} ${py - 90} ${px} ${py - 70}" fill="none" stroke="#e8e2d0" stroke-dasharray="3 4"/><circle cx="${px}" cy="${py - 66}" r="30" ${f}/>${foe(px - 14, py - 72)}${foe(px + 16, py - 58)}`,
    back: `<path d="M${px} ${py - 8} L${px} ${py - 30}" stroke="#e8e2d0" stroke-dasharray="3 3"/><circle cx="${px}" cy="${py - 44}" r="22" ${f}/>${foe(px, py - 80)}`,
    mark: `${foe(px, py - 70)}<circle cx="${px}" cy="${py - 70}" r="16" fill="none" stroke="${col}" stroke-width="2"/><path d="M${px - 22} ${py - 70} h10 M${px + 12} ${py - 70} h10 M${px} ${py - 92} v10 M${px} ${py - 58} v10" stroke="${col}" stroke-width="2"/>`,
    self: `<circle cx="${px}" cy="${py - 4}" r="22" ${f}/>`,
    aura: `<circle cx="${px}" cy="${py - 34}" r="52" ${f}/><circle cx="${px - 36}" cy="${py - 46}" r="6" fill="#60a5fa"/><circle cx="${px + 30}" cy="${py - 62}" r="6" fill="#60a5fa"/><circle cx="${px + 34}" cy="${py - 18}" r="6" fill="#60a5fa"/>`,
    heal: `<line x1="${px}" y1="${py - 12}" x2="${px + 36}" y2="${py - 62}" stroke="${col}" stroke-width="2" stroke-dasharray="4 4"/><circle cx="${px + 40}" cy="${py - 68}" r="12" ${f}/><circle cx="${px + 40}" cy="${py - 68}" r="6" fill="#60a5fa"/><path d="M${px + 40} ${py - 92} v10 M${px + 35} ${py - 87} h10" stroke="${col}" stroke-width="2"/>`,
  }[k];
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" aria-label="${esc(SHAPE_WORD[k])}">${g}${me}<text x="8" y="${H - 8}">${esc(SHAPE_WORD[k])}</text></svg>`;
}
