// The structured output every provider must return: one "intent" per call. The schema is strict-mode friendly for all
// three APIs (every field required, no extra keys, enums for anything the game acts on). sanitizeIntent() is the only
// way model output reaches the game: unknown values become "keep", text is trimmed and length-capped.
export const ORDERS = ['none', 'follow', 'stay', 'come', 'attack', 'heal', 'potion', 'farm', 'boss', 'ready'];
export const STANCES = ['keep', 'balanced', 'defensive', 'aggressive'];

export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'One short chat line (max ~120 characters), or "" to stay quiet.' },
    order: { type: 'string', enum: ORDERS, description: 'A party order to follow now, only when a player asked for one; else "none".' },
    stance: { type: 'string', enum: STANCES, description: 'How carefully to fight from now on; "keep" leaves it as is.' },
    focus: { type: 'string', description: 'Name of the party member to look after (heal / stay near), "none" to clear, "" to keep.' },
    remember: { type: 'string', description: 'A short fact worth remembering about the player who spoke (max ~80 characters), or "".' },
  },
  required: ['say', 'order', 'stance', 'focus', 'remember'],
  additionalProperties: false,
};

const clean = (s, max) => String(s ?? '')
  .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
const LINKISH = /(https?:\/\/|www\.|\.(com|net|org|gg|io)\b)/i;

export function sanitizeIntent(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const low = v => String(v ?? '').trim().toLowerCase();
  let say = clean(o.say, 160);
  if (LINKISH.test(say)) say = ''; // no links in game chat
  if (/^(none|null|"")$/i.test(say)) say = '';
  return {
    say,
    order: ORDERS.includes(low(o.order)) ? low(o.order) : 'none',
    stance: STANCES.includes(low(o.stance)) ? low(o.stance) : 'keep',
    focus: clean(o.focus, 24),
    remember: LINKISH.test(String(o.remember || '')) ? '' : clean(o.remember, 100),
  };
}

// Parse a model's text as one JSON object (tolerates a ```json fence or text around the object).
export function parseJsonObject(text) {
  const s = String(text ?? '').trim();
  try { const v = JSON.parse(s); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { const v = JSON.parse(s.slice(a, b + 1)); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {} }
  return null;
}
