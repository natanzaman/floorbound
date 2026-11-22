// The shape each class's talent tree is drawn in (docs/briefs/path.md). Client only: the rules (3 branches, 5 tiers,
// keystones, shared/talents.js) are the same for every class; only where the nodes sit and the picture behind them
// change. Row 5 holds a subclass's Crown, beyond the keystones; Subclass II sits beside its branch's keystone (tier 4).
//
// Each shape: name, blurb, sigil (an SVG path in a 24x24 box for the window header), backdrop (SVG drawn behind the
// tree in the VIEW box) and pos(bi, nd) -> [x, y] for branch index bi (0-2) and a node { tier (0-5), x (-1, 0, 1) }.
// A node is a circle (R; keystones KR) with its short name under it, LABEL.max characters at most: layouts keep those
// boxes apart (checked by test/path.js for every class, subclass and the later nodes).
export const VIEW = { w: 960, h: 620 };
export const NODE_R = 17, KEY_R = 21;
export const LABEL = { max: 14, perChar: 5.6, h: 14 };
export const shortName = s => (s.length > LABEL.max ? `${s.slice(0, LABEL.max - 1).trimEnd()}…` : s);
// The box a node and its label take: [x0, y0, x1, y1].
export function nodeBox(x, y, nd) {
  const R = nd.keystone ? KEY_R : NODE_R, hw = Math.max(R + 2, (shortName(nd.name).length * LABEL.perChar) / 2);
  return [x - hw, y - R - 2, x + hw, y + R + LABEL.h + 2];
}
const CX = VIEW.w / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const deg = d => (d * Math.PI) / 180;
const X = nd => nd.x || 0;
// A point on a quadratic curve and its unit normal (pointing left of the direction of travel).
function bez(t, [ax, ay], [bx, by], [cx, cy]) {
  const u = 1 - t, x = u * u * ax + 2 * u * t * bx + t * t * cx, y = u * u * ay + 2 * u * t * by + t * t * cy;
  const dx = 2 * u * (bx - ax) + 2 * t * (cx - bx), dy = 2 * u * (by - ay) + 2 * t * (cy - by), l = Math.hypot(dx, dy) || 1;
  return [x, y, dy / l, -dx / l];
}

const SHAPES = {
  swordsman: {
    name: 'The Blade', blurb: 'Grows from the hilt to the tip. The keystones sit near the point.',
    sigil: 'M12 2v14M8 16h8M12 16v5M10 21h4M12 2l2 3h-4z',
    pos: (bi, nd) => (nd.tier >= 5 ? [CX, 50] : [CX + (bi - 1) * (292 - nd.tier * 8) + X(nd) * (90 - nd.tier * 2), 566 - nd.tier * 103]), // the crown: the tip
    backdrop: () => `<polygon points="480,6 892,150 892,560 68,560 68,150" class="bd"/>
      <line x1="480" y1="40" x2="480" y2="552" class="bd2" stroke-width="10"/>
      <rect x="30" y="562" width="900" height="22" rx="11" class="bd"/><rect x="456" y="584" width="48" height="32" rx="6" class="bd"/>`,
  },
  guardian: {
    name: 'The Shield', blurb: 'Hangs from the top and narrows to the point, where the crown stands guard.',
    sigil: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
    pos: (bi, nd) => (nd.tier >= 5 ? [CX, 566] : [CX + (bi - 1) * (292 - nd.tier * 10) + X(nd) * (90 - nd.tier * 3), 52 + nd.tier * 104]), // the crown: the point
    backdrop: () => `<path d="M480 6 L900 30 L890 300 Q850 500 480 616 Q110 500 70 300 L60 30 Z" class="bd"/>
      <path d="M480 30 L480 600" class="bd2" stroke-width="6"/><path d="M80 40 L880 40" class="bd2" stroke-width="3"/>`,
  },
  cleric: {
    name: 'The Halo', blurb: 'Rings of light around a burning centre: the closer to the centre, the stronger the vow.',
    sigil: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
    pos: (bi, nd) => {
      if (nd.tier >= 5) return [CX, 328]; // the crown: the centre itself
      const r = [308, 252, 198, 144, 84][nd.tier], spread = [12, 15, 19, 26, 46][nd.tier];
      const a = deg(-90 + (bi - 1) * 120 + X(nd) * spread);
      return [CX + Math.cos(a) * r * 1.5, 328 + Math.sin(a) * r];
    },
    backdrop: () => [308, 252, 198, 144, 84].map((r, i) => `<ellipse cx="480" cy="328" rx="${r * 1.5}" ry="${r}" class="${i % 2 ? 'bd2' : 'bd'}" fill="none" stroke-width="${i ? 2 : 3}"/>`).join('')
      + '<circle cx="480" cy="328" r="44" class="bdc" opacity=".3"/><circle cx="480" cy="328" r="28" class="bdc" opacity=".5"/>',
  },
  ranger: {
    name: 'The Bow', blurb: 'A bow drawn to the sky: Marksman and Trapper bend the limbs, Pack Hunter flies with the arrow.',
    sigil: 'M2 9c5 6 15 6 20 0M2 9l10 9 10-9M12 18V2M9 5l3-3 3 3',
    pos: (bi, nd) => {
      if (nd.tier >= 5) return [CX, 34]; // the crown: the arrowhead
      if (bi === 2) return [CX + X(nd) * 84, 540 - nd.tier * 100]; // the arrow, nock to head
      const t = [0.0, 0.33, 0.56, 0.74, 0.9][nd.tier]; // the limbs, from the grip out to the tips
      const [x, y, nx, ny] = bez(t, [318, 486], [110, 486], [112, 64]), side = bi === 0 ? 1 : -1; // (bi 1 mirrors bi 0)
      const off = X(nd) * [66, 66, 66, 60, 66][nd.tier];
      return [CX + side * (x + nx * off - CX), y + ny * off];
    },
    backdrop: () => `<path d="M112 64 Q110 486 318 486 L642 486 Q850 486 848 64" class="bd" fill="none" stroke-width="18"/>
      <path d="M112 64 L480 604 L848 64" class="bd2" fill="none" stroke-width="2"/>
      <line x1="480" y1="596" x2="480" y2="30" class="bd2" stroke-width="8"/><path d="M462 32 L480 2 L498 32 Z" class="bd"/>
      <path d="M468 590 l-14 18 M492 590 l14 18" class="bd2" stroke-width="5"/>`,
  },
  berserker: {
    name: 'The Axe', blurb: 'Climbs the haft, then splits into two blades: carnage on one edge, bloodlust on the other.',
    sigil: 'M12 3v19M12 5C7 3 4 6 4 10s3 6 8 4M12 5c5-2 8 1 8 5s-3 6-8 4',
    pos: (bi, nd) => {
      if (bi === 2) return [CX + X(nd) * 92, 580 - nd.tier * 64]; // the haft
      const s = bi === 0 ? -1 : 1, t = nd.tier;
      if (t === 5) return [CX + s * 350, 66]; // the crown: the blade's top horn
      if (t === 4) return [CX + s * 418, 196 + X(nd) * 74]; // the edge: keystone and Subclass II
      return [CX + s * (104 + t * 76), 196 + X(nd) * 56];
    },
    backdrop: () => `<line x1="480" y1="60" x2="480" y2="612" class="bd2" stroke-width="24"/>
      <path d="M480 120 Q300 40 110 70 Q60 200 110 330 Q300 350 480 280 Z" class="bd"/><path d="M480 120 Q660 40 850 70 Q900 200 850 330 Q660 350 480 280 Z" class="bd"/>`,
  },
  lancer: {
    name: 'The Spear', blurb: 'Leans forward like a thrust, with a wing for the Dragoon.',
    sigil: 'M3 21L19 5M15 4l6-1-1 6M9 11c-1-4 2-7 6-7',
    pos: (bi, nd) => {
      if (nd.tier >= 5) return [900, 214]; // the crown: the spearhead
      const s = 0.06 + nd.tier * 0.19, bx = lerp(70, 900, s), by = lerp(376, 204, s); // along the shaft
      const side = (bi - 1) * 164 + X(nd) * (nd.tier >= 4 ? 60 : 55); // across it (down-right is +)
      return [bx + 0.278 * side, by + 0.961 * side];
    },
    backdrop: () => `<line x1="30" y1="400" x2="880" y2="218" class="bd2" stroke-width="14"/>
      <path d="M870 200 L956 200 L880 250 Z" class="bd"/>
      <path d="M300 300 Q360 60 640 40 Q520 160 470 250 Z" class="bd"/>`,
  },
  bard: {
    name: 'The Lyre', blurb: 'Each branch is a string and each talent a note, played upward to the crossbar.',
    sigil: 'M6 3c-2 8 0 15 4 18h4c4-3 6-10 4-18M5 4h14M10 4v17M14 4v17',
    pos: (bi, nd) => (nd.tier >= 5 ? [CX, 54] : [CX + (bi - 1) * (300 - nd.tier * 6) + X(nd) * 92, 566 - nd.tier * 102]), // the crown: the crossbar
    backdrop: () => `<path d="M110 30 Q40 380 330 606 L630 606 Q920 380 850 30" class="bd" fill="none" stroke-width="20"/>
      <line x1="96" y1="30" x2="864" y2="30" class="bd" stroke-width="18"/>
      <line x1="180" y1="34" x2="200" y2="600" class="bd2" stroke-width="2"/><line x1="480" y1="34" x2="480" y2="600" class="bd2" stroke-width="2"/><line x1="780" y1="34" x2="760" y2="600" class="bd2" stroke-width="2"/>`,
  },
};

// A plain grid for a class without a shape (never shown today: every class has one).
const GRID = { name: 'The Tree', blurb: '', sigil: 'M12 3v18M5 8h14M5 16h14', backdrop: () => '', pos: (bi, nd) => [CX + (bi - 1) * 300 + X(nd) * 92, 56 + nd.tier * 102] };

export const shapeOf = cls => SHAPES[cls] || GRID;
