# Item cards: a cleaner bag, merchant and Smith (2026-11-22)

Owner's ask: "item cards should have minimal and easily understandable and readable stats/bonuses but only share the
larger info and details when hovered over." The game runs on phones too, so a tap does what a hover does.

## What changed
- **One card style everywhere** (`public/itemcard.js`): a slot icon in the rarity colour, the name, short stats
  ("+12% DMG · +3% Crit"), a bonus count ("+2 bonuses") and small badges (refine +N, set n/3, weapon style, "Lancer
  only", "new", ▲/▼ against what you wear). One main button (Equip, Use, Sell, Refine +1, Forge...).
- **Details on demand:** desktop hover shows the full card (stats, every affix, set bonuses, the style, and now
  "vs your <worn item>" with each stat's change). The ⋯ button, or a click / tap on the card, opens it in place with the
  same text plus the less common buttons (Carry as 2nd, Drop, Delete, Take off). One card open at a time. On touch the
  hover card is off; a tap opens the card.
- **Bag tabs:** Shop (only at the merchant, and it opens there), Gear (totals, equipped, bag), Supplies (consumables and
  materials), Build (sets and loadouts), Titles. Drop / Delete for stacks gained "Drop all" / "Delete all" buttons
  (phones have no Shift).
- **Merchant:** Buy and Sell lists on the Shop tab; selling no longer adds a gold button to every bag row.
- **Smith:** the same cards on every tab, the next refine level as a short line, costs on one line, shorter hints;
  hover and ⋯ details work there too.
- No server or data changes. Art style untouched (owner put looks on hold).

## Tests
- `node test/itemcards.mjs` (browser): tabs, cards, hover card with the comparison, ⋯ / tap, Equip, Use, Delete 1 asks
  twice, merchant buy and sell, Smith refine, phone tap.
- `node scripts/uishots.mjs` takes the screenshots (desktop and phone; `OUT=`, `TABS=`).

## Open for the owner
- Short stat names ("DMG", "HP", "Haste", "Switch"); the ▲/▼ number compares the main stat only (as before).
