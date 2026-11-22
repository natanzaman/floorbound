# Guilds (owner request, approved 2026-11-22)

Sized for a handful of friends plus the game's many bots and the Named. One guild per character.

## Rules (data and pure rules in `shared/guilds.js`)
- **Create:** name 3-20 characters (letters, digits, single spaces, `'` and `-`; starts and ends with a letter or digit),
  tag 2-4 letters (stored upper case), both unique ignoring case, fee `GUILD.fee` gold (300). From the Guild tab of the
  Players window, or the **Guild Registrar** in the Town of Beginnings (the door of the house south-east of the Smith's forge,
  `REGISTRAR` (6.3, -15.7), at least 6 m from every other town prompt: Life Hall, Academy, garden, cooking fire, alchemy
  bench, Smith, Shrine, merchant, Hall; the door is the station, "press F" like the Smith; it opens the Guild tab). With a database, a human needs a saved character.
- **Ranks:** Leader / Officer / Member. Who may do what: `GUILD_PERMS` (invite, kick a lower rank, withdraw gold, take
  from the vault: Officer+; promote, demote, transfer leadership, disband: Leader; deposit, store in the vault, chat,
  leave: everyone). The Leader can't leave while others remain (transfer first, or disband). Only a human with a saved
  character (or anyone, without a database) can be Leader.
- **Invites:** like party invites (a card with Accept / Decline, 60 s). Bots and the Named answer by themselves (accept
  after 1-2 s). Inviting a bot needs `canControlBot(..., 'guildInvite')` (shared/accesslevels.js); one of the Named also
  needs the party-invite friendship rule (`canInvite`, today always open: `INVITE_NEEDS_TIER = false`). The Named can be
  invited while resting (they join by name).
- **Members are kept by key:** `c:<charId>` (players, persisted), `n:<namedId>` (the Named, persisted), `s:<playerId>`
  (bots and anonymous players: session-only; they drop out when they leave the world). Max `GUILD.maxMembers` (50).
- **Chat:** `/g text` (or `/guild text`): `{ type: 'gchat' }` sent only to the guild's online players (not in the
  shared snapshot); guild notices (joins, quests, levels, withdrawals) go the same way (`{ type: 'gchat', sys: 1 }`).
  The tag shows as `[TAG]` on nameplates, in the Players list, the HUD name and the Hall of Clearers.
- **Bank:** gold (anyone deposits, Officer+ withdraws) and a vault of bag items (`GUILD.vault` = 20 slots, +perks, max
  40; keepsakes stay with you). Everything happens in the single-threaded game loop, so a move is all-or-nothing in
  memory: the item leaves the bag and enters the vault (or the other way) in one step, by vault slot id (`v`), so two
  players taking the same item at once: the first gets it, the second is told it's gone. Persisted in one Postgres
  transaction (guild row + that character's gold and bag) built from a snapshot taken at the move. The job enters both
  the guild write queue and the character's save lock (`accounts.charLock`, which loads, admin edits and deletes also
  go through) at the move itself; a character save and a debounced guild save also copy their values when asked for.
  So a save asked for before the move writes the state before it and lands first, one asked for after it waits for the
  transaction: no save can commit one side of a move alone, and a crash can't duplicate gold or items. At most
  `GUILD.bankOps` (40) bank moves and `GUILD.inviteOps` (8) invites per player per 10 s.
- **Fair credit:** Academy trial and training enemies, summons and adds (`m.temp`), labyrinth risers (`m.labTemp`) and
  duel stand-ins count for no guild quest.
- **Deleted characters** (by their owner or an admin) leave their guild as if they had left: a player heir takes the
  lead, and a guild with no player left is no more. Loading the guilds applies the same rule (and drops stored quest
  ids the table no longer has).
- **Weekly quests:** 3 a week (Monday 00:00 UTC), drawn from `GUILD_QUESTS` with a seed of (guild id, week). Kinds: kill
  (by mob type, floor, or rares), lab (defeat a labyrinth keeper), boss (a floor boss falls with a member of the guild in the fight),
  switch (land a Switch with a guildmate in your party). Members' actions count; a bot's or one of the Named's count
  `GUILD.botRate` (0.25), so bots alone can't farm it quickly. Done: guild XP and gold into the bank.
- **Guild level 1-10** from guild XP (`GUILD_LEVELS`); perks from `GUILD_PERKS`: vault slots, +XP when grouped with a
  guildmate (5% → 10%), bigger quest rewards.
- **Disband:** the Leader (the vault must be empty; the bank's gold goes to the Leader) or an admin (`/admin.html`,
  Players tab → Guilds card; the bank and vault go with it).
- **Later (Phase 5 floor towns):** `guilds.plot` (JSONB, null) holds a guild hall plot; nothing uses it yet.

## Wire
- Client → server `{ type: 'guild', op, ... }`: `view`, `create {name, tag}`, `invite {name | pid | named}`,
  `accept {gid}`, `decline {gid}`, `leave`, `kick {key}`, `promote {key}`, `demote {key}`, `transfer {key}`, `disband`,
  `deposit {gold}`, `withdraw {gold}`, `store {u}`, `take {v}`. Chat `{ type: 'chat', ch: 'g', text }`.
- Server → client: `{ type: 'guild', op, ok, msg | error, view }` (view: the guild as you see it, or invites and the fee
  when you have none), `{ type: 'gchat', from, id, tag, text }` (or `{ sys: 1, tag, text }`: a notice); event `ginvite { to, gid, name, tag, from }`; roster rows
  carry `g` (the tag); Hall rows' players carry `g`.

## DB (`server/db.js`, safe to run twice)
- `guilds (id INT PK, name, tag, xp, gold, vault JSONB, vseq, quests JSONB, plot JSONB, created_at, updated_at)`,
  unique `lower(name)`, `lower(tag)`.
- `guild_members (member TEXT PK, guild_id → guilds ON DELETE CASCADE, char_id → characters ON DELETE CASCADE,
  named_id, rank, name, cls, joined_at)`. Session members are never written.
- All guilds load at start (a handful); ids are handed out in memory. Writes go through one queue (newest state wins).
  A guild left without a leader on load (its leader's character deleted) gets one (highest rank, oldest); an empty
  guild is deleted. Without `DATABASE_URL` guilds live in memory for the server's session.

## Files
`shared/guilds.js` (data, validation, quests, levels, perks), `server/guilds.js` (installGuilds on Game.prototype +
makeGuildStore), `public/guilds.js` (Guild tab, invite card, registrar label, `/g`), `public/admin-guilds.js` (admin
card), hooks in `server/index.js` (store, hall tags), `server/admin.js` (routes), `server/accounts.js` (charLock),
`server/db.js` (tables, `tx`), `shared/accesslevels.js` (`guildInvite`), `public/main.js` (tab, chat, plates, Hall).

## Testing aids
`TEST_HOOKS=1`: `{ type: 'test', gold: n }` (spending money), `{ type: 'test', guildEv: { kind, mob, floor, n } }`
(counts toward this week's quests).

## Tests
`node test/guilds.js`: pure rules, in process (create, ranks, invites incl. bots / the Named, chat, bank and vault
races, quests and the bot rate, levels and perks, Hall tags) and, with `DATABASE_URL`, a real server: create over the
wire, deposits / withdrawals racing, the vault, quest progress, everything still there after a restart.
`python3 test/guilds.py` (browser, no database): the Registrar, the tab, found, the invite card, `/g`, tags, bank,
vault, leave.
