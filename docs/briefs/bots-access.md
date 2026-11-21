# Bots in the list, free bots, access levels (`feat/bots`, 2026-11-20)

Owner asks (2026-11-20): every bot in the Players list with Invite; an add-to-party checkbox when creating a bot
(unticked: a free bot that keeps its creator's behaviour, else roams and farms); no 3-bot cap; account access
levels 1-5; who may control a bot (creator, access 3+, allow list, else anyone at the action's minimum);
despawn / respawn the Named (unique, rejoin the party they left); kick a bot from your party.

Lead's calls: `INVITE_NEEDS_TIER = false` in `shared/named.js` (list invites work for everyone; the tier gate is one
flag away; friendship otherwise unchanged); bot invites follow normal party rules (party size, the bot leaves its old
party or stops roaming).

## Data
- `accounts.access_level SMALLINT NOT NULL DEFAULT 1` (server/db.js, safe to run twice). Guests and anonymous players: 1.
  Admins (`is_admin` / `ADMIN_DISCORD_IDS`): effectively 5 (computed, not stored). `accountFromToken` returns it;
  the join sets `p.access`.
- `named_chars.allow JSONB` (the Named's allow lists survive a restart; `enabled` already does: despawned stays despawned).
- BotManager entries: `creator` (`{ charId, accountId, pid, name }` or null: the Named, test teams) and `allow` (lower-case
  names or character ids, empty = open). The Named's `allow` lives on their state (`st.allow`) and is mirrored on spawn.
- Player bots (`server/playerbots.js` rec): `partied` (follows its creator's party) replaces "always partied". A bot that
  leaves a party (kicked, `/b leave`, the party broke up) roams with mode `field`; `mode` is the creator's default.

## The rule (`shared/accesslevels.js`, pure, `test/accesslevels.js`)
`ACCESS = { overrideBots: 3 }`; `ACTION_MIN = { botCommand, botInvite, botKick, botDespawn, botRespawn, botAdd }`, all 1.
`canControlBot(actor, bot, action)` -> `{ ok, why }`, in order:
1. the bot's creator: yes;
2. access >= `ACCESS.overrideBots` (admins are 5): yes;
3. below the action's minimum: no;
4. allow list not empty: only if listed (name or character id);
5. empty list: yes.
Editing / dismissing a player bot (Bots tab) stays creator / admin, plus access >= 3 (`canManageBot`).

## Server
- `BotManager.controlBlock(actor, e|st, action)` and `game.botControl(actor, botPlayer, action)`; `game.invite` to a
  bot is gated too.
- `game.botCommand`: `/b <name>: order` reaches a free bot (no human in its party) you may control (`free: 1` on the
  event); party orders skip bots you may not order (`no: [ids]`); the brain honours both.
- `pbot` ops: `add` takes `party` (default true; no per-player cap, `MAX_BOTS` still applies); new `invite` / `kick`
  (`bid` or `named`) and `despawn` / `respawn` (`named`); `list` adds `named` rows and per-row `ctl` (invite / kick /
  despawn / respawn: ok or why) and `where` (your party / X's party / roaming / resting / despawned).
- Named: `despawnBy` / `respawnBy` (permission, never mid boss fight); `setEnabled(false)` remembers a human party,
  `setEnabled(true)` rejoins it through `wake(..., 'rejoin')` if it still exists with room (other Named in it are fine since 2026-11-21); admin
  `POST /api/admin/named/:id/allow`.
- Admin: `POST /api/admin/accounts/:id/access { level }` (live players updated), players list shows each account's
  level; `PATCH /api/admin/bots/:bid { allow }`; bot views carry `creator` and `allow`.

## Client
- `public/playerbots.js`: `listHtml()` / `bindList()` draw the Players tab's Bots section from the `pbot` list (polled
  while the panel is open): every bot and the Named, where they are, Invite / Kick / Despawn / Respawn. The Add form
  gets a "Join my party" checkbox; the "n/3" counter goes.
- `public/main.js`: the old roster-based Bots section is replaced by those two calls.
- `public/botwheel.js`: chips for your free bots (single-bot orders by name).
- `public/admin.js`: an Access column with a 1-5 select; bot cards show the creator and an allow-list field;
  `public/admin-named.js`: an allow-list field per Named.

## Tests
`test/accesslevels.js` (pure rule); `test/freebots.js` (server: unpartied bot, list invite / kick, no cap, free-bot
orders and allow lists, Named despawn / respawn rejoin, `INVITE_NEEDS_TIER`; with `DATABASE_URL` the access-level
migration, admin set, effective level and that a despawned Named stays so after a restart). Existing: playerbots,
adminbots, named, bots, admin.

## Security review fixes (2026-11-20)
Allow lists are `{ id, name }` entries of saved characters (`server/accounts.js` `resolveAllow`, unknown names refused;
`'creator'` = "Just me"); only `actor.charId` matches. Anonymous creators are never re-adopted by name. Creator-only
`pbot allow` op and row controls. Named despawn only unpartied or from your own party (access 3+ excepted). Grace removal
waits while a bot is in a human's party or a boss fight. Slim `rows` op (3 s poll). Kick refuses mid boss fight.
Admin-made bots show as server bots to players. `effective` access counts `ADMIN_DISCORD_IDS`. Bot PATCH on a Named
sets `st.allow`.
