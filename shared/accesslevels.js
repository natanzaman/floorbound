// Access levels: a security / permission level per account (1-5), set by devs on the admin page. Never the character
// level. Everyone starts at 1 (guests and anonymous players too); admin accounts count as 5. Shared by the server
// (who may do what) and the admin page (labels).
//
// ACTION_MIN maps each gated action to the lowest access level that may do it. Every minimum is 1 for now: raising
// one later is a one-line change here. ACCESS holds named levels with a meaning of their own.
//
// Who may control a bot (command it, invite it, kick it from a party, despawn / respawn it): canControlBot below.
export const ACCESS_MIN = 1;
export const ACCESS_MAX = 5;
export const ACCESS_DEFAULT = 1;
export const ACCESS_ADMIN = 5; // what an admin account counts as

export const ACCESS = {
  overrideBots: 3, // controls (and manages) any bot, whatever its creator or allow list says
};

export const ACTION_MIN = {
  botAdd: 1,      // add a bot of your own (Players → Bots)
  botCommand: 1,  // give a bot an order (/b, the wheel, party frames)
  botInvite: 1,   // invite a bot into your party (the Players list, the Friends tab, a nameplate)
  botKick: 1,     // send a bot out of your party (back to roaming)
  botDespawn: 1,  // take one of the Named out of the world
  botRespawn: 1,  // bring one back
};
export const ACTION_LABEL = {
  botAdd: 'add bots', botCommand: 'give bots orders', botInvite: 'invite bots', botKick: 'kick bots from a party',
  botDespawn: 'despawn the Named', botRespawn: 'respawn the Named',
};

export const clampAccess = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(ACCESS_MAX, Math.max(ACCESS_MIN, n)) : ACCESS_DEFAULT; };
// A player's access level: admins 5, else the account's (anonymous players: 1).
export const accessOf = p => (p?.admin ? ACCESS_ADMIN : clampAccess(p?.access ?? ACCESS_DEFAULT));
// An unknown action is locked to the top level (a typo never opens anything up).
export const minAccess = action => ACTION_MIN[action] ?? ACCESS_MAX;

// An allow list: saved characters, as { id (the character id, a string), name (for display) }, at most 20. Names are
// resolved to character ids when a list is saved (server/accounts.js resolveAllow: an unknown name is refused), and only
// a saved character ever matches (by character id): a display name proves nothing, and anonymous or guest-less players
// never match. ALLOW_CREATOR ({ id: 'creator' }) alone is "Just me": nobody else matches, so only the creator (and
// access 3+) may control the bot. cleanAllow keeps well-formed entries (stored lists, client input after resolving).
export const ALLOW_MAX = 20;
export const ALLOW_CREATOR = 'creator';
export function cleanAllow(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const id = String(typeof v === 'object' && v ? v.id : v ?? '').trim();
    if (!(/^[1-9]\d{0,9}$/.test(id) || id === ALLOW_CREATOR) || out.some(a => a.id === id)) continue;
    const name = String((typeof v === 'object' && v?.name) || (id === ALLOW_CREATOR ? 'just the creator' : `#${id}`)).replace(/[^\w \-.#]/g, '').slice(0, 24);
    out.push({ id, name });
    if (out.length >= ALLOW_MAX) break;
  }
  return out;
}
// "anyone", "just the creator", or the names.
export const allowLabel = allow => (!allow?.length ? 'anyone' : allow.map(a => a.name).join(', '));

// Is `actor` (a player: { id, name, charId, accountId }) the bot's creator ({ charId, accountId, pid, name })?
// A saved character matches by character id; an anonymous creator by player id (re-adopted on reconnect by
// server/playerbots.js); a bot an admin added from the admin page by account.
export function isCreator(actor, creator) {
  if (!actor || !creator) return false;
  if (creator.charId) return actor.charId === creator.charId;
  if (creator.pid && actor.id === creator.pid) return true;
  return !!creator.accountId && actor.accountId === creator.accountId;
}
// Only a saved character matches, by character id (never by name).
export const onAllowList = (actor, allow) => !!actor?.charId && Array.isArray(allow) && allow.some(a => a?.id === String(actor.charId));

// The rule, in order: the creator always can; access >= ACCESS.overrideBots always can; below the action's minimum
// never; with an allow list, only those on it; with none (empty), anyone at the minimum.
// actor: a player ({ id, name, charId, accountId, access, admin }); bot: { creator (or null), allow (cleanAllow entries) }.
// Returns { ok, why } (why: a sentence for the player when refused).
export function canControlBot(actor, bot, action) {
  if (!actor) return { ok: false, why: 'Nobody to ask.' };
  if (isCreator(actor, bot?.creator)) return { ok: true, why: '' };
  const lvl = accessOf(actor);
  if (lvl >= ACCESS.overrideBots) return { ok: true, why: '' };
  const need = minAccess(action);
  if (lvl < need) return { ok: false, why: `You need access level ${need} to ${ACTION_LABEL[action] || action} (yours: ${lvl}).` };
  const allow = bot?.allow || [];
  if (allow.length && !onAllowList(actor, allow)) return { ok: false, why: `${bot?.name || 'That bot'} only takes orders from its creator and the players it allows.` };
  return { ok: true, why: '' };
}

// Managing a player-added bot (rename, skill, behaviour, dismiss: the Bots tab): its creator, or access >= overrideBots.
export const canManageBot = (actor, bot) => isCreator(actor, bot?.creator) || accessOf(actor) >= ACCESS.overrideBots;
