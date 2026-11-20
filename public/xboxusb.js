// Wired Xbox pads on a Mac (WebUSB, Chrome / Edge): macOS has no driver for third-party wired Xbox One / Series pads
// (SCUF, PowerA, PDP...), so they never reach navigator.getGamepads() and their light keeps blinking. This opens one
// over WebUSB, wakes it (shared/gip.js powerOn) and reads its packets into a gamepad-like object that
// public/input.js readPads() lists next to the browser's own pads.
//   supported()           WebUSB is there (Chromium browsers on a secure page: https or localhost)
//   connect()             asks the browser for a pad (needs a click: the chooser lists GIP pads only); true when one opened
//   pads()                the open pads, as Gamepad-like objects (standard mapping)
// A pad allowed once reopens by itself on the next load and when it's plugged back in (navigator.usb getDevices / connect).
// Where an OS driver already holds the pad (Windows, Microsoft's own pads on a Mac) claiming fails: the browser has it anyway.
import { GIP_FILTER, powerOn, ackFor, parseGip, blankPad } from '/shared/gip.js';

const open = new Map(); // USBDevice -> { st, alive }
const starting = new Map(); // USBDevice -> the start in progress (load-time reopen, 'connect' and a click can overlap)
const gone = new WeakSet(); // unplugged devices (no retry after a read error)
const retriedAt = new WeakMap(); // USBDevice -> when a failed read loop last reopened it (once per 10 s)
const resetAt = new Map(); // vendor:product:serial -> when it was last reset
// A short log for checking a pad by hand (window.__xboxusb.log in the console): what was sent, read and failed.
const log = [];
const note = (...a) => { log.push(`${(performance.now() / 1000).toFixed(2)} ${a.join(' ')}`); if (log.length > 200) log.shift(); };
const hx = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');
if (typeof window !== 'undefined') window.__xboxusb = { log, pads: () => pads(), devices: () => [...open.keys()] };
const hex = n => n.toString(16).padStart(4, '0');
export const supported = () => typeof navigator !== 'undefined' && !!navigator.usb;
// Only a Mac needs it (Windows and Linux drive these pads themselves): the Controls screen offers "Connect it" there.
export const needed = () => supported() && /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
export const pads = () => [...open.values()].map(p => p.st);

function gipInterface(dev) {
  for (const itf of dev.configuration?.interfaces || []) for (const alt of itf.alternates) {
    if (alt.interfaceClass !== GIP_FILTER.classCode || alt.interfaceSubclass !== GIP_FILTER.subclassCode || alt.interfaceProtocol !== GIP_FILTER.protocolCode) continue;
    const inEp = alt.endpoints.find(e => e.direction === 'in'), outEp = alt.endpoints.find(e => e.direction === 'out');
    if (inEp && outEp) return { num: itf.interfaceNumber, alt: alt.alternateSetting, inEp: inEp.endpointNumber, outEp: outEp.endpointNumber, size: inEp.packetSize || 64 };
  }
  return null;
}

function start(dev) {
  if (open.has(dev)) return Promise.resolve(true);
  if (!starting.has(dev)) starting.set(dev, doStart(dev).finally(() => starting.delete(dev)));
  return starting.get(dev);
}
const freeIndex = () => { const used = new Set(pads().map(p => p.index)); let i = 100; while (used.has(i)) i++; return i; };
async function doStart(dev) {
  gone.delete(dev);
  try {
    if (!dev.opened) await dev.open();
    if (!dev.configuration) await dev.selectConfiguration(1);
    const g = gipInterface(dev);
    if (!g) { await dev.close().catch(() => {}); return false; }
    await dev.claimInterface(g.num);
    // A pad only listens to the wake-up after it has announced itself (packet 0x02), which it does once, right after
    // it's plugged in: by the time the page opens it, that's long gone. A USB reset makes it announce again
    // (seen on a SCUF 2e95:0504: no packets at all before the reset, input right after). Once per pad per 10 s, in
    // case the reset shows up as unplug + plug (the connect listener would land here again).
    const key = `${dev.vendorId}:${dev.productId}:${dev.serialNumber || ''}`;
    if (!(Date.now() - (resetAt.get(key) || 0) < 10000)) {
      resetAt.set(key, Date.now());
      try { await dev.reset(); note('reset'); } catch (e) { note('reset failed', e.message); }
      if (!dev.opened) await dev.open();
      if (!dev.configuration) await dev.selectConfiguration(1);
      await dev.claimInterface(g.num).catch(e => note('reclaim', e.message));
    }
    const name = (dev.productName && dev.productName !== 'Controller' ? dev.productName : `${dev.manufacturerName || 'Xbox'} controller`).trim();
    const p = { st: blankPad(`${name} (Xbox wired USB, Vendor: ${hex(dev.vendorId)} Product: ${hex(dev.productId)})`, freeIndex()), alive: true, seq: 0, inputs: 0 };
    open.set(dev, p);
    note('opened', dev.manufacturerName, dev.productName, hex(dev.vendorId), hex(dev.productId), JSON.stringify(g));
    const send = bytes => dev.transferOut(g.outEp, bytes).then(r => note('out', r.status, hx(bytes))).catch(e => note('out failed', hx(bytes), e.message));
    p.wake = async () => { p.woken = true; for (const pk of initPackets(p)) await send(pk); };
    setTimeout(() => { if (p.alive && !p.woken) p.wake(); }, 1000); // (no announce: wake it anyway)
    dispatchEvent(new Event('gamepadconnected'));
    (async () => { // the read loop: one packet per transfer, until the pad goes away
      let stalls = 0, failed = false;
      while (p.alive) {
        let r;
        try { r = await dev.transferIn(g.inEp, g.size); } catch (e) { note('in failed', e.message); failed = true; break; }
        if (r.status === 'stall') { if (++stalls > 5) { note('stalled'); failed = true; break; } await dev.clearHalt('in', g.inEp).catch(() => {}); continue; }
        stalls = 0;
        if (!r.data) continue;
        const b = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        if (b[0] !== 0x20 || p.inputs++ < 3) note('in', hx(b));
        const ack = ackFor(b); if (ack) send(ack);
        if (b[0] === 0x02) p.wake(); // (the pad announced itself: wake it)
        parseGip(b, p.st);
      }
      // A read that failed while the pad is still plugged in (a glitch, a stuck endpoint): close it and reopen it once.
      // (closed before it's unlisted, so a "Connect it" click in between can't have its fresh start closed under it)
      const retry = failed && !gone.has(dev) && !(Date.now() - (retriedAt.get(dev) || 0) < 10000);
      if (retry) { retriedAt.set(dev, Date.now()); await dev.close().catch(() => {}); }
      stop(dev);
      if (retry) setTimeout(() => { if (!gone.has(dev) && !open.has(dev) && !starting.has(dev)) start(dev); }, 500);
    })();
    return true;
  } catch (e) {
    console.warn('wired Xbox pad: could not open it', e); note('open failed', e.message);
    try { await dev.close(); } catch {}
    return false;
  }
}
// The wake-up, as the Linux xpad driver sends it: power on, then the One S init (harmless on other pads).
function initPackets(p) {
  const q = () => (p.seq++) & 0xff;
  return [powerOn(q()), new Uint8Array([0x05, 0x20, q(), 0x0f, 0x06])];
}
function stop(dev) {
  const p = open.get(dev);
  if (!p) return;
  p.alive = false; p.st.connected = false; open.delete(dev);
  dispatchEvent(new Event('gamepaddisconnected'));
}

export async function connect() {
  if (!supported()) return false;
  let dev;
  try { dev = await navigator.usb.requestDevice({ filters: [GIP_FILTER] }); } catch { return false; } // (the chooser was closed)
  return start(dev);
}

if (supported()) {
  navigator.usb.getDevices().then(ds => ds.forEach(start)).catch(() => {});
  navigator.usb.addEventListener('connect', e => start(e.device));
  navigator.usb.addEventListener('disconnect', e => { gone.add(e.device); stop(e.device); });
}
