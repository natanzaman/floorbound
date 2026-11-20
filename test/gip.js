// shared/gip.js: wired Xbox (GIP) packets -> a standard-mapping gamepad. Usage: node test/gip.js
import assert from 'node:assert/strict';
import { parseGip, blankPad, powerOn, ackFor } from '../shared/gip.js';
import { readButtons, readSticks } from '../shared/gamepad.js';

let n = 0; const ok = s => console.log(`  ok ${++n} - ${s}`);
const pkt = (f = 0, g = 0, lt = 0, rt = 0, lx = 0, ly = 0, rx = 0, ry = 0) => {
  const b = new Uint8Array(18); b[0] = 0x20; b[4] = f; b[5] = g;
  const w = (i, v) => { v &= 0xffff; b[i] = v & 0xff; b[i + 1] = v >> 8; };
  w(6, lt); w(8, rt); w(10, lx); w(12, ly); w(14, rx); w(16, ry); return b;
};

assert.deepEqual([...powerOn(3)], [0x05, 0x20, 3, 0x01, 0x00]);
ok('power-on packet');

const st = blankPad('SCUF (Vendor: 2e95)', 100);
assert.ok(parseGip(pkt(0x10 | 0x04, 0x10 | 0x01 | 0x80), st));
assert.deepEqual([...readButtons(st)].sort(), ['A', 'LB', 'R3', 'Start', 'Up'].sort());
parseGip(pkt(0x20 | 0x40 | 0x80 | 0x08, 0x20 | 0x40 | 0x02 | 0x04 | 0x08), st);
assert.deepEqual([...readButtons(st)].sort(), ['B', 'X', 'Y', 'View', 'RB', 'L3', 'Down', 'Left', 'Right'].sort());
ok('face, shoulder, menu, stick-click and d-pad bits land on the standard indices');

parseGip(pkt(0, 0, 1023, 300), st);
assert.deepEqual([...readButtons(st)], ['LT']);
assert.equal(st.buttons[7].value.toFixed(2), (300 / 1023).toFixed(2));
ok('triggers: 0..1023 -> 0..1 values (readButtons applies its own threshold)');

parseGip(pkt(0, 0, 0, 0, 32767, 32767, -32768, -32767), st);
const s = readSticks(st);
assert.ok(s.LS.x > 0.7 && s.LS.y < -0.7, 'left stick right + up (Gamepad y down)');
assert.ok(s.RS.x < -0.7 && s.RS.y > 0.7, 'right stick left + down');
parseGip(pkt(0, 0, 0, 0, 2000, -2000), st);
assert.deepEqual(readSticks(st).LS, { x: 0, y: 0 }, 'small values sit in the deadzone');
ok('sticks: signed 16-bit, y flipped, deadzone applies');

const guide = new Uint8Array([0x07, 0x30, 9, 0x02, 0x01, 0x5b]);
parseGip(guide, st); assert.ok(st.buttons[16].pressed);
assert.deepEqual([...ackFor(guide)].slice(0, 8), [0x01, 0x20, 9, 0x09, 0x00, 0x07, 0x20, 0x02]);
assert.equal(ackFor(pkt()), null);
assert.equal(parseGip(new Uint8Array([0x03, 0x20, 1, 4, 0x80, 0, 0, 0]), st), false);
ok('guide packet with its ack; status packets ignored');

console.log(`gip: all ${n} checks passed`);
