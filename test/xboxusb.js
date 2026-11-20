// public/xboxusb.js (wired Xbox pads on a Mac over WebUSB) and public/keyname.js against fakes, in Node: no overlapping
// opens of one pad (load-time reopen + a click), pad indexes are reused safely, a stuck read endpoint gives up and
// reopens once, an unplugged pad isn't reopened; key names on a touch device and on a pad with an unbound action.
// Usage: node test/xboxusb.js
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/').href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/Users') ? next(${JSON.stringify(root)} + (s.startsWith('/shared/') ? s.slice(1) : 'public' + s), c) : next(s, c); }`)}`);

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);
const tick = ms => new Promise(r => setTimeout(r, ms));

// ---- a fake navigator.usb with one GIP pad per device; each I/O step takes 5 ms ----
const events = [];
globalThis.dispatchEvent = e => events.push(e.type);
globalThis.window = globalThis;
const listeners = {};
function fakeDevice(serial) {
  const d = {
    vendorId: 0x2e95, productId: 0x0504, serialNumber: serial, productName: 'Controller', manufacturerName: 'Microsoft',
    opened: false, configuration: null, reading: 0, maxReading: 0, queue: [], stallNext: 0, closed: 0,
    async open() { await tick(5); d.opened = true; },
    async close() { await tick(1); d.opened = false; d.closed++; },
    async selectConfiguration() { await tick(5); d.configuration = { interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0xff, interfaceSubclass: 0x47, interfaceProtocol: 0xd0, endpoints: [{ direction: 'in', endpointNumber: 2, packetSize: 64 }, { direction: 'out', endpointNumber: 2 }] }] }] }; },
    async claimInterface() { await tick(5); },
    async reset() { await tick(5); },
    async transferOut() { return { status: 'ok' }; },
    async clearHalt() { await tick(1); },
    async transferIn() {
      d.reading++; d.maxReading = Math.max(d.maxReading, d.reading);
      try {
        while (!d.queue.length && !d.stallNext && !d.unplugged) await tick(2);
        if (d.unplugged) throw new Error('The device was disconnected.');
        if (d.stallNext) { d.stallNext--; return { status: 'stall' }; }
        const b = d.queue.shift();
        return { status: 'ok', data: new DataView(b.buffer) };
      } finally { d.reading--; }
    },
  };
  return d;
}
const dev1 = fakeDevice('A'), dev2 = fakeDevice('B');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'MacIntel', usb: {
  getDevices: async () => [dev1],
  requestDevice: async () => dev1,
  addEventListener: (t, fn) => { listeners[t] = fn; },
} } });

const usb = await import('../public/xboxusb.js');
assert.ok(usb.supported() && usb.needed(), 'WebUSB on a Mac: offered');

// 1. load-time reopen (getDevices) and a click on "Connect it" for the same pad overlap: one open, one read loop
const clicked = usb.connect();
assert.equal(await clicked, true);
await tick(30);
assert.equal(usb.pads().length, 1, 'one pad listed');
assert.equal(dev1.maxReading, 1, 'one read loop on the endpoint');
const input = new Uint8Array(18); input[0] = 0x20; input[4] = 0x10; // (A down)
dev1.queue.push(input); await tick(10);
assert.equal(usb.pads()[0].buttons[0].pressed, true, 'the listed pad gets the packet');
ok("a click while the pad is still reopening doesn't open it twice (one read loop, packets reach the listed pad)");

// 2. indexes: a second pad gets the next free index; the first unplugged and back takes the free one, never a twin
listeners.connect({ device: dev2 }); await tick(40);
const idx = () => usb.pads().map(p => p.index).sort();
assert.deepEqual(idx(), [100, 101]);
dev1.unplugged = true; listeners.disconnect({ device: dev1 }); await tick(10);
assert.deepEqual(idx(), [101], 'pad 1 gone');
dev1.unplugged = false; listeners.connect({ device: dev1 }); await tick(40);
assert.deepEqual(idx(), [100, 101], 'pad 1 back on a free index, not a copy of pad 2');
ok('pad indexes: next free one, no two pads share an index after an unplug and replug');

// 3. a stuck endpoint (stall after stall) gives up, closes and reopens once; an unplugged pad isn't reopened
const closedBefore = dev2.closed;
dev2.stallNext = 50; await tick(40);
assert.ok(dev2.stallNext > 0 && dev2.stallNext < 50, 'stopped clearing the stall after a few tries');
assert.ok(dev2.closed > closedBefore, 'closed the stuck pad');
dev2.stallNext = 0; await tick(600);
assert.deepEqual(idx(), [100, 101], 'and reopened it');
let opens = 0; const o1 = dev1.open; dev1.open = async () => { opens++; return o1(); };
dev1.unplugged = true; await tick(5); listeners.disconnect({ device: dev1 }); await tick(700); // (the read fails before the disconnect event)
assert.deepEqual(idx(), [101], 'an unplugged pad stays closed');
assert.equal(opens, 0, 'and is never reopened');
ok('a stuck read endpoint gives up, closes and reopens once; an unplugged pad is not reopened');

// 4. keyname: a phone back on "Keyboard & Mouse" after a pad still taps; a pad with nothing bound names no key
const K = await import('../public/keyname.js');
const fake = { device: 'kbm', label: a => (fake.device === 'pad' ? (a === 'interact' ? 'D-pad ↓' : 'Not bound') : 'F') };
K.setKeySource(fake, true);
assert.equal(K.tapping(), true, 'touch device on kbm: tap');
fake.device = 'pad';
assert.equal(K.tapping(), false, 'touch device on a pad: name the button');
assert.equal(K.keyName('interact'), 'D-pad ↓');
assert.equal(K.keyName('jump'), 'Jump (unbound)', 'unbound on the pad: no keyboard key');
assert.equal(K.keyText('Hold {key:interact} here'), 'Hold D-pad ↓ here');
K.setKeySource(fake, false); fake.device = 'kbm';
assert.equal(K.tapping(), false, 'desktop: never tap');
ok('key names: touch devices tap unless on a pad; an unbound pad action names no keyboard key; server tokens');

console.log(`xboxusb: all ${n} checks passed`);
process.exit(0);
