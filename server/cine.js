// Cinematic camera and picture state for filming (docs/ROADMAP.md F4), mixed into Game (installCine in game.js).
// The scene director (F2) calls game.cine(op, data); each call becomes a `{ t: 'cine', op, ... }` event for clients
// (public/cine.js). The lasting parts (current shot, light, letterbox, clean feed, black screen, a title still on
// screen) are kept here and sent to a client when it joins: cineState() (server/index.js).
//   shot      { shot, target, from, secs }  target/from: { pid } | { mid } | { x, z } (or [x, z]); secs: move time, 0 = cut
//   slowmo    { secs, scale }               title { text, sub, secs }   fade { to: 'black' | 'in', secs }
//   letterbox { on }   clean { on }   light { light: 'eclipse' | 'day' | null }   reset (everything back to normal)
export const SHOTS = ['close_up', 'medium', 'wide', 'over_shoulder', 'follow', 'orbit', 'crane', 'free'];
export const CINE_OPS = ['shot', 'slowmo', 'title', 'fade', 'letterbox', 'clean', 'light', 'reset'];
const LIGHTS = ['eclipse', 'day'];

const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const r2 = v => Math.round(v * 100) / 100;
const flag = v => v === undefined || v === null ? true : !(v === false || v === 'off' || v === 0 || v === 'false');
const fresh = () => ({ shot: null, light: null, letterbox: false, clean: false, black: false, title: null });

const methods = {
  // A shot target as the client wants it: { pid } a player, { mid } a mob, { x, z } a point. The director resolves
  // names; plain names of players and 'warden' / 'sovereign' are resolved here too, as a convenience.
  cineTarget(t) {
    if (t === undefined || t === null || t === '') return null;
    if (Array.isArray(t) && t.length >= 2) return { x: r2(+t[0] || 0), z: r2(+t[1] || 0) };
    if (typeof t === 'object') {
      if (t.pid !== undefined) return { pid: +t.pid };
      if (t.mid !== undefined) return { mid: +t.mid };
      if (t.id !== undefined && t.x === undefined) return this.players.has(+t.id) ? { pid: +t.id } : this.mobs.has(+t.id) ? { mid: +t.id } : null;
      if (t.x !== undefined && t.z !== undefined) return { x: r2(+t.x || 0), z: r2(+t.z || 0) };
      return null;
    }
    if (typeof t === 'string') {
      const k = t.toLowerCase();
      for (const p of this.players.values()) if (p.name?.toLowerCase() === k) return { pid: p.id };
      for (const m of this.mobs.values()) if (!m.dead && m.type === k) return { mid: m.id };
    }
    return null;
  },

  // Returns false for an unknown op or shot, true otherwise.
  cine(op, data = {}) {
    if (!CINE_OPS.includes(op)) return false;
    if (data === null || typeof data !== 'object') data = op === 'light' ? { light: data } : {};
    const S = this.cineS ||= fresh();
    let ev;
    switch (op) {
      case 'shot': {
        const shot = data.shot || 'free';
        if (!SHOTS.includes(shot)) return false;
        const target = this.cineTarget(data.target), from = this.cineTarget(data.from);
        const secs = num(data.secs, 1.5, 0, 30);
        ev = { shot, ...(target ? { target } : {}), ...(from ? { from } : {}), secs };
        S.shot = shot === 'free' ? null : { ...ev, at: this.time };
        break;
      }
      case 'slowmo': ev = { secs: num(data.secs, 1, 0.1, 10), scale: num(data.scale, 0.35, 0.05, 1) }; break;
      case 'title': {
        const text = String(data.text ?? '').slice(0, 80), sub = data.sub ? String(data.sub).slice(0, 140) : '';
        ev = { text, ...(sub ? { sub } : {}), secs: num(data.secs, 3, 0.5, 30) };
        S.title = text ? { ...ev, until: this.time + ev.secs } : null;
        break;
      }
      case 'fade': {
        const to = data.to === 'black' || data.to === 'out' ? 'black' : 'in';
        ev = { to, secs: num(data.secs, 1, 0, 10) };
        S.black = to === 'black';
        break;
      }
      case 'letterbox': S.letterbox = flag(data.on); ev = { on: S.letterbox }; break;
      case 'clean': S.clean = flag(data.on); ev = { on: S.clean }; break;
      case 'light': {
        const v = data.light ?? data.to ?? data.set ?? data.k ?? data.mode ?? null;
        S.light = LIGHTS.includes(v) ? v : null;
        ev = { light: S.light };
        break;
      }
      case 'reset': this.cineS = fresh(); ev = {}; break;
    }
    this.events.push({ t: 'cine', op, ...ev });
    return true;
  },

  // What a joining client needs to pick up the picture as it is now (a title only while it's still showing).
  cineState() {
    const S = this.cineS ||= fresh();
    if (S.title && this.time >= S.title.until) S.title = null;
    const shot = S.shot ? (({ at, ...s }) => s)(S.shot) : null;
    const title = S.title ? { text: S.title.text, ...(S.title.sub ? { sub: S.title.sub } : {}), secs: r2(S.title.until - this.time) } : null;
    return { shot, light: S.light, letterbox: S.letterbox, clean: S.clean, black: S.black, title };
  },
};

export function installCine(Game) { Object.assign(Game.prototype, methods); }
