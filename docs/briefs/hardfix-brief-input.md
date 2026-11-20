# Brief: hard-review fixes, input/UI findings 2-7 of docs/briefs/reviews/hard-input.md
Worktree: /Users/natanzamanzadeh/floorbound/.claude/worktrees/parallel-worktree-tasks-0648c6/wt/hardfix-input (branch feat/hardfix-input from ee48bb1). Do NOT commit. Another implementer edits public/controlsync.js and test/controlsync.js in this worktree at the same time: do not touch those.
Read: /Users/natanzamanzadeh/floorbound/.claude/worktrees/parallel-worktree-tasks-0648c6/docs/briefs/reviews/hard-input.md findings 2-7 (+ "Known open items").
Do (regression test first for each, see it fail, then fix):
2. toggle bot wheel on pad: second press issues the hovered order (else closes); fix the toggle-mode hint text in botwheel.js:28. Test in test/padtest.mjs or a smaller browser test.
3. synthetic pad releases (blur / setDevice / padFound -> releasePad) must CLOSE the wheel without an order (decision: no unconfirmed order on alt-tab; reverses the chat-1 K1b choice). Mark them { down:false, cancel:true }.
4. binding a key that is part of an axis (W of WASD): the conflict prompt names the whole axis ("WASD on Move"). Test the prompt text (test/controls.js if the text comes from shared/controls.js, else controlsui.mjs).
5. public/input.js access(): normalizeAccess on stored access (sens/padSens clamped). Test in test/access.js or controls.js.
6. padLost closes the "Controller detected" toast; a notify() never leaves pendingAsk set (clear it on overwrite or don't overwrite while an ask is pending).
7. test/padsmoke.mjs:79 ready() timeout 20000 -> 60000.
Also: panels close -> call controlsUi.close() (tidy, harmless today).
Files you may edit: public/main.js, public/input.js, public/botwheel.js, public/controlsui.js, public/panels.js (if that is where panels live), shared/controls.js, test/controls.js, test/access.js, test/padsmoke.mjs, test/padtest.mjs, test/padlib.mjs, test/controlsui.mjs, test/padnav.mjs, a new test/wheel.mjs if needed.
Run (ports 37920-37949, browser tests one at a time): node test/controls.js, gamepad.js, focusnav.js, access.js; PORT=.. node test/keys.mjs, padsmoke.mjs, padnav.mjs, controlsui.mjs, access.mjs, padtest.mjs (padtest/padsmoke time out under load: rerun alone). Report: changes file:line, result lines copied, not verified, open questions.
