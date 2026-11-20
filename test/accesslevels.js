// Access levels and who may control a bot (shared/accesslevels.js): pure rules, no server.
//   the table (every action at 1 for now, unknown actions locked), clamping, admins count as 5, allow lists (cleaning,
//   names and character ids), and canControlBot in order: creator, access >= ACCESS.overrideBots, the action's minimum,
//   the allow list, else anyone; canManageBot (creator or access 3+).
// Usage: node test/accesslevels.js
import {
  ACCESS, ACTION_MIN, ACCESS_MIN, ACCESS_MAX, ACCESS_ADMIN, ALLOW_CREATOR, clampAccess, accessOf, minAccess, cleanAllow, isCreator, onAllowList,
  canControlBot, canManageBot,
} from '../shared/accesslevels.js';

let n = 0, failed = 0;
function ok(cond, what) { n++; if (cond) console.log(`  ok ${n} - ${what}`); else { failed++; console.log(`  NOT OK ${n} - ${what}`); } }

// the table
ok(ACCESS_MIN === 1 && ACCESS_MAX === 5 && ACCESS_ADMIN === 5 && ACCESS.overrideBots === 3, 'levels 1-5, admins 5, override bots at 3');
ok(Object.values(ACTION_MIN).every(v => v === 1) && ['botCommand', 'botInvite', 'botKick', 'botDespawn', 'botRespawn', 'botAdd'].every(k => ACTION_MIN[k] === 1), 'every gated bot action needs level 1 for now');
ok(minAccess('nope') === ACCESS_MAX, 'an unknown action is locked to the top level');
ok(clampAccess(0) === 1 && clampAccess(9) === 5 && clampAccess('3') === 3 && clampAccess(undefined) === 1 && clampAccess('x') === 1, 'clamped to 1-5 (junk: 1)');
ok(accessOf({}) === 1 && accessOf({ access: 4 }) === 4 && accessOf({ access: 1, admin: true }) === 5 && accessOf(null) === 1, 'a player: their account\'s level, anonymous 1, admins 5');

// allow lists: saved characters by id only (names are resolved server-side when a list is saved)
const A = (id, name) => ({ id: String(id), name });
ok(JSON.stringify(cleanAllow([A(12, 'Ann'), { id: '12' }, 'ann', { id: '0' }, { id: '-3' }, { id: ALLOW_CREATOR }, 40])) === JSON.stringify([A(12, 'Ann'), { id: ALLOW_CREATOR, name: 'just the creator' }, A(40, '#40')]), 'cleanAllow: character ids and "just the creator" only; names, 0 and junk dropped; no repeats');
ok(cleanAllow(Array.from({ length: 40 }, (_, i) => i + 1)).length === 20 && cleanAllow(null).length === 0 && cleanAllow('ann, bob').length === 0, 'at most 20; nothing or a plain string is empty');
ok(onAllowList({ name: 'Zed', charId: 12 }, [A(12, 'Ann')]) && !onAllowList({ name: 'Ann', charId: 0 }, [A(12, 'Ann')]) && !onAllowList({ name: 'Ann', charId: 13 }, [A(12, 'Ann')]), 'on the list by character id only: "Ann" by name (anonymous or another character) never matches');
ok(!onAllowList({ name: '12', charId: 0 }, [A(12, 'Ann')]) && !onAllowList({ name: 'x', charId: 0 }, [{ id: ALLOW_CREATOR }]), 'a player named "12" is not character 12; nobody matches "just the creator"');

// creators
const ann = { id: 7, name: 'Ann', charId: 40, accountId: 3, access: 1 }, bob = { id: 8, name: 'Bob', charId: 41, accountId: 4, access: 1 };
const anon = { id: 9, name: 'Cy', charId: 0, accountId: 0, access: 1 };
ok(isCreator(ann, { charId: 40, pid: 99 }) && !isCreator({ ...bob, id: 99 }, { charId: 40, pid: 99 }), 'a saved creator by character id (not the old player id)');
ok(isCreator(anon, { charId: 0, pid: 9 }) && !isCreator(bob, { charId: 0, pid: 9 }), 'an anonymous creator by player id');
ok(isCreator({ ...bob, charId: 0 }, { accountId: 4 }) && !isCreator(ann, { accountId: 4 }) && !isCreator(ann, null), 'an admin page bot by account; no creator: nobody');

// the rule, in order
const zed = { id: 10, name: 'Zed', charId: 77, accountId: 5, access: 1 };
const open = { creator: { charId: 40 }, allow: [], name: 'Rook' }, closed = { creator: { charId: 40 }, allow: [A(77, 'Zed')], name: 'Rook' }, mine = { creator: { charId: 40 }, allow: [{ id: ALLOW_CREATOR }], name: 'Rook' };
ok(canControlBot(ann, closed, 'botCommand').ok, '1. the creator always can (even off their own allow list)');
ok(canControlBot({ ...bob, access: 3 }, closed, 'botKick').ok && canControlBot({ ...bob, admin: true }, closed, 'botDespawn').ok, '2. access 3+ (admins: 5) always can');
ok(!canControlBot({ ...bob, access: 2 }, closed, 'botCommand').ok && /only takes orders/.test(canControlBot(bob, closed, 'botCommand').why), '4. with an allow list, others are refused (with a reason)');
ok(canControlBot(zed, closed, 'botInvite').ok && !canControlBot({ ...bob, name: 'Zed' }, closed, 'botInvite').ok && !canControlBot({ ...zed, charId: 0 }, closed, 'botInvite').ok, '4. …and the listed character is let in (not someone else named Zed, not an anonymous Zed)');
ok(canControlBot(ann, mine, 'botKick').ok && !canControlBot(zed, mine, 'botKick').ok && canControlBot({ ...zed, access: 3 }, mine, 'botKick').ok, '"Just me": the creator (and access 3+) only');
ok(['botCommand', 'botInvite', 'botKick', 'botDespawn', 'botRespawn'].every(a => canControlBot(bob, open, a).ok), '5. an empty list: anyone at the action\'s minimum (1 now)');
ok(canControlBot(bob, { creator: null, allow: [] }, 'botDespawn').ok && !canControlBot(bob, { creator: null, allow: [A(40, 'Ann')] }, 'botDespawn').ok && canControlBot(ann, { creator: null, allow: [A(40, 'Ann')] }, 'botDespawn').ok, 'the Named (no creator): the same rule');
// 3. raising a minimum is a one-line change
ACTION_MIN.botDespawn = 2;
const r = canControlBot(bob, open, 'botDespawn');
ok(!r.ok && /access level 2/.test(r.why) && canControlBot({ ...bob, access: 2 }, open, 'botDespawn').ok && canControlBot(ann, open, 'botDespawn').ok, '3. below the minimum: refused (the creator and higher levels still can)');
ok(!canControlBot(zed, closed, 'botDespawn').ok, '3. the minimum holds for the allow list too');
ACTION_MIN.botDespawn = 1;
ok(!canControlBot(null, open, 'botCommand').ok, 'nobody: no');

// managing (rename, skill, behaviour, dismiss)
ok(canManageBot(ann, open) && !canManageBot(bob, open) && canManageBot({ ...bob, access: 3 }, open) && canManageBot({ ...bob, admin: true }, open), 'managing a bot: its creator or access 3+ only (allow lists don\'t count)');

console.log(failed ? `\n${failed} FAILED of ${n}` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
