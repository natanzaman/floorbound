// The Tower Bell (ROADMAP F6): one bell per floor, rung for everyone on every floor the first time that floor is
// cleared on this server. Words for its banner, shared by the client and the tests. Stones live in shared/titles.js.

export const FLOOR_COUNT = 100; // "A HUNDRED BELLS. THEN HOME."
export const BELL_MOTTO = 'A HUNDRED BELLS. THEN HOME.';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

// 0..100 in words: 99 -> "ninety-nine".
export function numberWords(n) {
  n = Math.max(0, Math.min(FLOOR_COUNT, Math.round(n)));
  if (n === 100) return 'one hundred';
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

// 1..100 as an ordinal: 1 -> "first", 21 -> "twenty-first", 100 -> "hundredth".
export function ordinalWords(n) {
  if (Math.round(n) >= 100) return 'hundredth';
  const w = numberWords(n), i = w.lastIndexOf('-'), last = w.slice(i + 1);
  const ord = ORD[last] || (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return w.slice(0, i + 1) + ord;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// The banner: ["THE FIRST BELL", "Floor 1 has been cleared. Ninety-nine to go."]
export function bellBanner(floor) {
  const left = FLOOR_COUNT - floor;
  return [`THE ${ordinalWords(floor).toUpperCase()} BELL`,
    `Floor ${floor} has been cleared. ${left > 0 ? `${cap(numberWords(left))} to go.` : 'Then home.'}`];
}
