// Wired Xbox One / Series pads speak GIP (the Xbox "Gaming Input Protocol") over USB, not HID. Windows has the driver;
// macOS (and Chrome on it) only drives Microsoft's own pads, so a wired SCUF, PowerA, PDP... never shows up in
// navigator.getGamepads() there. public/xboxusb.js opens such a pad with WebUSB; this file is the DOM-free part:
//   GIP_FILTER            the USB interface a GIP pad has (vendor class 0xff, subclass 0x47, protocol 0xd0)
//   powerOn(seq)          the packet that wakes the pad (its light goes from blinking to solid)
//   ackFor(bytes)         the acknowledgement a packet asks for (flag 0x10), else null
//   parseGip(bytes, st)   updates st (a gamepad-like state) from one packet; true when it changed buttons or sticks
//   blankPad(id, index)   a gamepad-like object in the standard mapping (PAD_BUTTONS order), as readPads() returns
// Layout from the Linux xpad driver (drivers/input/joystick/xpad.c, xpadone_process_packet).
export const GIP_FILTER = { classCode: 0xff, subclassCode: 0x47, protocolCode: 0xd0 };
export const GIP = { ANNOUNCE: 0x02, STATUS: 0x03, GUIDE: 0x07, INPUT: 0x20 };

export const powerOn = seq => new Uint8Array([0x05, 0x20, seq & 0xff, 0x01, 0x00]);
export function ackFor(b) {
  if (!b || b.length < 4 || !(b[1] & 0x10)) return null;
  return new Uint8Array([0x01, 0x20, b[2], 0x09, 0x00, b[0], 0x20, b[3], 0x00, 0x00, 0x00, 0x00, 0x00]);
}

export function blankPad(id, index) {
  return { id, index, mapping: 'standard', connected: true, timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
}
const set = (st, i, on, value = on ? 1 : 0) => { const b = st.buttons[i]; b.pressed = b.touched = !!on; b.value = value; };
const s16 = (b, i) => { const v = b[i] | (b[i + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const stick = v => Math.max(-1, Math.min(1, v / 32767));

// Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12-15 d-pad, 16 Guide.
export function parseGip(b, st) {
  if (!b || !b.length) return false;
  if (b[0] === GIP.GUIDE && b.length >= 5) { set(st, 16, b[4] & 0x01); st.timestamp++; return true; }
  if (b[0] !== GIP.INPUT || b.length < 18) return false;
  const f = b[4], g = b[5];
  set(st, 9, f & 0x04); set(st, 8, f & 0x08);
  set(st, 0, f & 0x10); set(st, 1, f & 0x20); set(st, 2, f & 0x40); set(st, 3, f & 0x80);
  set(st, 12, g & 0x01); set(st, 13, g & 0x02); set(st, 14, g & 0x04); set(st, 15, g & 0x08);
  set(st, 4, g & 0x10); set(st, 5, g & 0x20); set(st, 10, g & 0x40); set(st, 11, g & 0x80);
  const lt = Math.min(1, u16(b, 6) / 1023), rt = Math.min(1, u16(b, 8) / 1023);
  set(st, 6, lt > 0.1, lt); set(st, 7, rt > 0.1, rt);
  // GIP sticks: y up is positive; the Gamepad API has y down.
  st.axes[0] = stick(s16(b, 10)); st.axes[1] = -stick(s16(b, 12)); st.axes[2] = stick(s16(b, 14)); st.axes[3] = -stick(s16(b, 16));
  st.timestamp++;
  return true;
}
