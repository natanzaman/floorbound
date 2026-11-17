// Speech bubbles (docs/ROADMAP.md F1): the pure logic in public/bubbles.js, fed with real chat events from the server.
//  - duration: ~1.6 s + 0.07 s per character, clamped to 2–5 s (a director `hold` wins);
//  - one bubble per speaker: a new line replaces the old one; bubbles expire after fade in + hold + fade out;
//  - who sees what: say (/s) within 40 m, party chat to the party, global to everyone, spectators everything, /b never.
// Usage: node test/bubbles.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { bubbleDuration, bubbleVisible, bubbleAlpha, bubbleScale, BubbleStore, SAY_RANGE, FADE_IN, FADE_OUT } from '../public/bubbles.js';

// ---- duration
assert.equal(bubbleDuration(''), 2);
assert.equal(bubbleDuration('Bram!'), 2); // 1.95 → 2
assert.ok(Math.abs(bubbleDuration('x'.repeat(20)) - 3.0) < 1e-9);
assert.equal(bubbleDuration('x'.repeat(200)), 5);
assert.equal(bubbleDuration('Every second.', 2.5), 2.5); // a director hold wins
assert.equal(bubbleDuration('hi', 30), 10);
assert.equal(bubbleDuration('x'.repeat(20), 0), 3.0 + 0 * 1); // no hold: by length
console.log('duration ok');

// ---- alpha and expiry
const store = new BubbleStore();
const b = store.say(7, 'Then I come to you.', 100);
assert.equal(bubbleAlpha(b, 100), 0);
assert.equal(bubbleAlpha(b, 100 + FADE_IN + 0.5), 1);
assert.ok(bubbleAlpha(b, 100 + FADE_IN + b.hold + FADE_OUT / 2) > 0 && bubbleAlpha(b, 100 + FADE_IN + b.hold + FADE_OUT / 2) < 1);
assert.equal(store.active(100 + FADE_IN + b.hold + FADE_OUT + 0.01).length, 0, 'expired bubble dropped');
console.log('fade/expiry ok');

// ---- replace: one per speaker
const s2 = new BubbleStore();
s2.say(1, 'first line', 0); s2.say(2, 'someone else', 0);
const r = s2.say(1, 'second line', 1);
assert.equal(s2.active(1).length, 2);
assert.equal(s2.get(1).text, 'second line');
assert.equal(r.n, 2);
assert.equal(bubbleAlpha(r, 1), 1, 'a replacement while visible does not fade in again');
assert.ok(s2.active(1 + r.hold).some(x => x.id === 1), 'the timer restarts with the new line');
console.log('replace ok');

// ---- scale
assert.equal(bubbleScale(3), 1);
assert.equal(bubbleScale(500), 0.8);
console.log('scale ok');

// ---- who sees what, with real server chat events
const g = new Game();
const a = g.addPlayer(null, 'Corvin', 'swordsman');
const c = g.addPlayer(null, 'Bram', 'guardian');
const far = g.addPlayer(null, 'Juno', 'ranger');
a.x = 0; a.z = 30; c.x = 5; c.z = 30; far.x = 0; far.z = 30 + SAY_RANGE + 10;
g.handle(a, { type: 'invite', id: c.id }); g.handle(c, { type: 'accept', from: a.id });
assert.ok(a.party && a.party === c.party, 'party formed');
const say = (p, text, ch) => { g.events = []; g.handle(p, { type: 'chat', text, ...(ch ? { ch } : {}) }); return g.events.find(e => e.t === 'chat'); };
const view = p => ({ spectator: false, party: p.party || 0, x: p.x, z: p.z });
const spectator = { spectator: true, party: 0, x: 999, z: 999 };

const s = say(a, 'Raid gate.', 's');
assert.equal(s.ch, 's');
assert.ok(bubbleVisible(s, view(a)), 'speaker sees own say');
assert.ok(bubbleVisible(s, view(c)), 'nearby hears say');
assert.ok(!bubbleVisible(s, view(far)), 'far away does not');
assert.ok(bubbleVisible(s, spectator), 'spectator sees say');

const pc = say(c, 'Stay behind my shield.', 'p');
assert.equal(pc.ch, 'p');
assert.ok(bubbleVisible(pc, view(a)) && bubbleVisible(pc, view(c)), 'party sees party chat');
assert.ok(!bubbleVisible(pc, view(far)), 'outsider does not see party chat');
assert.ok(bubbleVisible(pc, spectator), 'spectator sees party chat');

const gl = say(far, 'Anyone selling bolts?');
assert.ok(!gl.ch && bubbleVisible(gl, view(a)) && bubbleVisible(gl, view(far)) && bubbleVisible(gl, spectator), 'global seen by all');

assert.equal(say(a, '/b follow'), undefined, '/b orders are never chat events');
assert.ok(!bubbleVisible({ t: 'chat', id: 1, text: '/b attack' }, spectator), '/b never bubbles');
assert.ok(!bubbleVisible({ t: 'sys', id: 1, text: 'hello' }, spectator), 'only chat events');

// a director-style say line pushed straight into the events (F2 contract) reaches a spectator
assert.ok(bubbleVisible({ t: 'chat', id: c.id, from: 'Bram', text: 'Then I come to you.', ch: 's', x: 5, z: 30, hold: 3 }, spectator));
console.log('who-sees-what ok');
console.log('bubbles: all ok');
process.exit(0);
