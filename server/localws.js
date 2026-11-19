// In-process "sockets" for the server's own bots (player-added, admin and the Named: server/botmanager.js).
//
// A server-run bot used to be a real WebSocket client of its own server: every tick the server JSON-serialised the
// snapshot for it, pushed it through the loopback socket, and the bot JSON-parsed it again. Here the bot and the server
// share a pair of tiny socket objects instead, with the same faces the two sides already use:
//   client side (shared/bots/brain.js)  new hub.WebSocket(url): readyState, send(str), sendObj(o), close(),
//                                       addEventListener('open' | 'message' | 'close' | 'error'); a message event
//                                       carries the message object as ev.obj (ev.data is its JSON, made on demand)
//   server side (server/index.js)       the connection handler gets ws with on('message' | 'close'), send(str),
//                                       close(), readyState and ws.local = true: a message is the object itself (no
//                                       JSON.parse), and ws.deliver(obj) hands an object over without serialising
//                                       (the per-tick snapshot)
// Both directions are queued and flushed in a microtask, in order, so nothing re-enters the game in the middle of a
// tick: a bot reads its snapshot right after the tick, as it would from the network, and its input is handled before
// the next one. Objects handed over are shared, not copied: the server builds them fresh per message (the world part
// of a snapshot is one parsed copy shared by every local bot of the tick), and bots treat messages as read-only
// (BOT_FREEZE=1 deep-freezes what is delivered, so a test catches any bot that writes into one).
// External bot runners (test harnesses, /bots.html, teambots by URL) keep using the real WebSocket path.

const OPEN = 1, CLOSING = 2, CLOSED = 3;

function makeQueue() { // a FIFO flushed in one microtask
  const q = [];
  let armed = false;
  const flush = () => { armed = false; for (let i = 0; i < q.length; i++) { try { q[i](); } catch (e) { console.error('[localws]', e); } } q.length = 0; };
  return fn => { q.push(fn); if (!armed) { armed = true; queueMicrotask(flush); } };
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k in o) deepFreeze(o[k]); }
  return o;
}

export function makeLocalHub(onConnection, { freeze = process.env.BOT_FREEZE === '1' } = {}) {
  const later = makeQueue();
  const stats = { open: 0 };

  class ServerEnd {
    constructor(client) { this.client = client; this.local = true; this.readyState = OPEN; this.ls = { message: [], close: [] }; }
    on(type, fn) { (this.ls[type] ||= []).push(fn); return this; }
    once(type, fn) { const w = (...a) => { this.ls[type] = this.ls[type].filter(f => f !== w); fn(...a); }; return this.on(type, w); }
    emit(type, ...a) { for (const fn of [...(this.ls[type] || [])]) fn(...a); }
    send(str) { // the rare messages (inventory, roster, replies…): parsed once for the bot
      if (this.readyState !== OPEN) return;
      const obj = JSON.parse(typeof str === 'string' ? str : String(str));
      later(() => this.client.receive(freeze ? deepFreeze(obj) : obj));
    }
    deliver(obj) { if (this.readyState === OPEN) later(() => this.client.receive(freeze ? deepFreeze(obj) : obj)); }
    close() { if (this.readyState >= CLOSING) return; this.readyState = CLOSING; later(() => this.client.shut()); }
    shut() { if (this.readyState === CLOSED) return; this.readyState = CLOSED; stats.open--; this.emit('close', 1000, ''); }
  }

  class LocalWebSocket {
    constructor(url) {
      this.url = url; this.readyState = 0; this.ls = { open: [], message: [], close: [], error: [] };
      later(() => {
        if (this.readyState !== 0) return; // closed before it opened
        this.server = new ServerEnd(this); stats.open++;
        this.readyState = OPEN;
        onConnection(this.server);
        this.emit('open', { type: 'open' });
      });
    }
    addEventListener(type, fn) { (this.ls[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.ls[type] = (this.ls[type] || []).filter(f => f !== fn); }
    emit(type, ev) { for (const fn of [...(this.ls[type] || [])]) { try { fn(ev); } catch (e) { console.error('[localws]', e); } } }
    send(str) { this.sendObj(JSON.parse(typeof str === 'string' ? str : String(str))); }
    sendObj(o) { // the 20 Hz input as is (server/game.js onInput checks every field); anything else goes through JSON, exactly as on the wire (NaN → null, undefined dropped)
      if (this.readyState !== OPEN) return;
      const s = this.server, msg = o?.type === 'input' ? o : JSON.parse(JSON.stringify(o));
      later(() => { if (s.readyState === OPEN) s.emit('message', msg, false); });
    }
    receive(obj) { if (this.readyState === OPEN) this.emit('message', { type: 'message', obj, get data() { return JSON.stringify(obj); } }); }
    close() {
      if (this.readyState >= CLOSING) return;
      const was = this.readyState;
      this.readyState = CLOSING;
      later(() => { if (was === OPEN) this.server.shut(); this.shut(); });
    }
    shut() { if (this.readyState === CLOSED) return; this.readyState = CLOSED; if (this.server && this.server.readyState !== CLOSED) this.server.shut(); this.emit('close', { type: 'close', code: 1000 }); }
  }
  LocalWebSocket.local = true;
  return { WebSocket: LocalWebSocket, stats, freeze };
}
