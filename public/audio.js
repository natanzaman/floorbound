// Procedural sound effects and music with the Web Audio API: no audio files needed.
// Sounds are placed in the world: quieter with distance from the listener.

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = localStorage.getItem('fb_sound') !== 'off';
    this.listener = { x: 0, z: 0 };
    this.mood = null; this.nextBar = 0; this.bar = 0;
    this.offset = 0; // seconds added to every scheduled sound (used for offline rendering)
  }

  // Browsers only allow audio after a user gesture; call this from a click/tap.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.build(new AC());
      setInterval(() => this.schedule(), 120);
    }
    this.ctx.resume?.();
  }

  // Wire up the mixer on a context (a live AudioContext, or an OfflineAudioContext for recording).
  build(c) {
    {
      this.ctx = c;
      this.master = c.createGain(); this.master.gain.value = this.on ? 0.7 : 0;
      const comp = c.createDynamicsCompressor();
      this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
      this.music = c.createGain(); this.music.gain.value = 0.28; this.music.connect(this.master);
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
  }

  toggle() {
    this.on = !this.on;
    localStorage.setItem('fb_sound', this.on ? 'on' : 'off');
    if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.7 : 0, this.ctx.currentTime, 0.05);
    return this.on;
  }

  // ---------- building blocks ----------
  out(vol, pos) {
    const g = this.ctx.createGain();
    let v = vol;
    if (pos) v *= Math.max(0, 1 - Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z) / 45);
    g.gain.value = v;
    g.connect(this.sfx);
    return v > 0.002 ? g : null;
  }

  tone(dest, { f = 440, to, type = 'sine', dur = 0.2, vol = 0.3, at = 0, attack = 0.005 }) {
    const c = this.ctx, t = c.currentTime + this.offset + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dest, { dur = 0.2, vol = 0.3, type = 'bandpass', f = 1000, to, q = 1, at = 0, attack = 0.005 }) {
    const c = this.ctx, t = c.currentTime + this.offset + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // ---------- effects ----------
  play(name, pos, vol = 1) {
    if (!this.ctx || !this.on) return;
    const o = this.out(vol, pos);
    if (!o) return;
    const j = 0.9 + Math.random() * 0.2; // slight pitch variety
    switch (name) {
      case 'swing': this.noise(o, { dur: 0.16, vol: 0.35, f: 2400 * j, to: 500, q: 1.4 }); break;
      case 'swingHeavy': this.noise(o, { dur: 0.26, vol: 0.5, f: 1600 * j, to: 260, q: 1.2 }); break;
      case 'hit':
        this.tone(o, { f: 170 * j, to: 60, dur: 0.12, vol: 0.5, type: 'sine' });
        this.noise(o, { dur: 0.06, vol: 0.35, type: 'highpass', f: 1800 });
        break;
      case 'hitHeavy':
        this.tone(o, { f: 120 * j, to: 40, dur: 0.25, vol: 0.7 });
        this.noise(o, { dur: 0.16, vol: 0.5, type: 'lowpass', f: 2200, to: 300 });
        break;
      case 'crit':
        this.play('hit', pos, vol);
        this.noise(o, { dur: 0.035, vol: 0.55, type: 'highpass', f: 5200, attack: 0.001 }); // bright transient "tick"
        this.tone(o, { f: 2600 * j, to: 1700, dur: 0.07, vol: 0.2, type: 'square', attack: 0.001 });
        this.tone(o, { f: 1400 * j, to: 900, dur: 0.22, vol: 0.22, type: 'triangle' });
        this.tone(o, { f: 2100 * j, dur: 0.3, vol: 0.08, type: 'sine', at: 0.02 }); // ring-out
        break;
      case 'rare': // a horn call: something big has appeared
        [57, 64, 69].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.7, vol: 0.2, type: 'sawtooth', at: i * 0.22, attack: 0.04 }));
        this.tone(o, { f: NOTE(45), dur: 1.4, vol: 0.25, type: 'triangle', attack: 0.08 });
        this.noise(o, { dur: 1.0, vol: 0.12, type: 'lowpass', f: 500, to: 2000, attack: 0.2 });
        break;
      case 'break':
        this.tone(o, { f: 320, dur: 0.6, vol: 0.25, type: 'square' });
        this.tone(o, { f: 477, dur: 0.5, vol: 0.18, type: 'square' });
        this.noise(o, { dur: 0.3, vol: 0.4, type: 'highpass', f: 3000 });
        break;
      case 'switch':
        this.play('hitHeavy', pos, vol);
        [0, 0.06, 0.12].forEach((at, i) => this.tone(o, { f: NOTE(76 + i * 4), dur: 0.45, vol: 0.22, type: 'triangle', at }));
        break;
      case 'roll': this.noise(o, { dur: 0.28, vol: 0.3, type: 'lowpass', f: 300, to: 1100, attack: 0.04 }); break;
      case 'evade': this.tone(o, { f: 900, to: 1800, dur: 0.15, vol: 0.15, type: 'triangle' }); break;
      case 'hurt':
        this.tone(o, { f: 240 * j, to: 110, dur: 0.16, vol: 0.3, type: 'sawtooth' });
        this.noise(o, { dur: 0.1, vol: 0.3, type: 'lowpass', f: 900 });
        break;
      case 'heal': [72, 76, 79].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.5, vol: 0.14, type: 'sine', at: i * 0.07, attack: 0.02 })); break;
      case 'spell': this.tone(o, { f: 300, to: 900, dur: 0.3, vol: 0.18, type: 'triangle' }); this.noise(o, { dur: 0.3, vol: 0.12, f: 2500, q: 4 }); break;
      case 'bolt': this.tone(o, { f: 1200, to: 300, dur: 0.18, vol: 0.2, type: 'square' }); break;
      case 'shield': this.tone(o, { f: 220, dur: 0.5, vol: 0.2, type: 'triangle', attack: 0.03 }); this.tone(o, { f: 330, dur: 0.5, vol: 0.12, type: 'triangle', attack: 0.03 }); break;
      case 'shatter':
        this.noise(o, { dur: 0.5, vol: 0.4, type: 'highpass', f: 2500, to: 6000 });
        [88, 91, 95].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.3, vol: 0.08, type: 'sine', at: i * 0.04 }));
        break;
      case 'levelup': [60, 64, 67, 72, 76].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.5, vol: 0.18, type: 'triangle', at: i * 0.09 })); break;
      case 'roar':
        this.tone(o, { f: 90, to: 55, dur: 1.2, vol: 0.5, type: 'sawtooth', attack: 0.1 });
        this.noise(o, { dur: 1.2, vol: 0.4, type: 'lowpass', f: 600, to: 200, attack: 0.1 });
        break;
      case 'boom':
        this.tone(o, { f: 70, to: 30, dur: 0.8, vol: 0.8 });
        this.noise(o, { dur: 0.7, vol: 0.6, type: 'lowpass', f: 900, to: 120 });
        break;
      case 'warn': this.tone(o, { f: 520, dur: 0.12, vol: 0.12, type: 'square' }); this.tone(o, { f: 520, dur: 0.12, vol: 0.12, type: 'square', at: 0.18 }); break;
      case 'spit': this.noise(o, { dur: 0.12, vol: 0.3, f: 1200, to: 400, q: 2 }); this.tone(o, { f: 500, to: 200, dur: 0.1, vol: 0.15, type: 'square' }); break;
      case 'howl':
        this.tone(o, { f: 330, to: 620, dur: 0.6, vol: 0.22, type: 'sawtooth', attack: 0.1 });
        this.tone(o, { f: 620, to: 420, dur: 0.9, vol: 0.18, type: 'sawtooth', at: 0.55 });
        break;
      case 'growl': this.tone(o, { f: 110 * j, to: 80, dur: 0.35, vol: 0.18, type: 'sawtooth' }); break;
      case 'step': this.noise(o, { dur: 0.05, vol: 0.06, type: 'lowpass', f: 500 }); break;
      case 'ui': this.tone(o, { f: 880, dur: 0.06, vol: 0.08, type: 'triangle' }); break;
      case 'coin': [84, 91].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.18, vol: 0.1, type: 'square', at: i * 0.06 })); break;
      case 'forge': // anvil clang: a hammer strike with inharmonic ringing, twice
        [0, 0.3].forEach((at, h) => { this.noise(o, { dur: 0.06, vol: 0.45 - h * 0.15, type: 'highpass', f: 2500, at }); [1, 2.76, 5.4].forEach((m, i) => this.tone(o, { f: 760 * j * m, dur: 1.1 - i * 0.3, vol: (0.17 - h * 0.05) / (i + 1), type: 'sine', at })); });
        break;
      case 'loot': [72, 79, 84, 88].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.4, vol: 0.13, type: 'triangle', at: i * 0.07 })); break;
      case 'drink': this.noise(o, { dur: 0.25, vol: 0.15, type: 'lowpass', f: 700, to: 300 }); this.tone(o, { f: NOTE(76), to: NOTE(83), dur: 0.3, vol: 0.1, type: 'sine', at: 0.15 }); break;
      case 'gate': this.tone(o, { f: 70, to: 50, dur: 1.6, vol: 0.3, type: 'sawtooth', attack: 0.1 }); this.noise(o, { dur: 1.6, vol: 0.2, type: 'lowpass', f: 300 }); break;
      case 'tick': this.tone(o, { f: 660, dur: 0.08, vol: 0.12, type: 'square' }); break;
      case 'clear': [60, 64, 67, 72, 67, 72, 76, 79].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.6, vol: 0.16, type: 'triangle', at: i * 0.12 })); break;
      case 'bell': this.bell(o); break; // the Tower Bell (ROADMAP F6)
    }
  }

  // The Tower Bell: one deep toll from far above. A church bell's partials (hum, prime, tierce, quint, nominal and
  // the upper ring), each a slightly detuned pair so it beats and wobbles, each with its own long exponential decay
  // (the hum outlasts everything); a clapper strike on top, all sent through a big synthetic hall reverb.
  bell(dest) {
    const c = this.ctx, t = c.currentTime + this.offset + 0.02, f0 = 55; // hum at A1: a huge bell
    const wet = this.bellVerb(), dry = c.createGain(); dry.gain.value = 0.75;
    const send = c.createGain(); send.gain.value = 0.55;
    dry.connect(dest); send.connect(wet).connect(dest);
    const bus = c.createGain(); bus.connect(dry); bus.connect(send);
    // [ratio to the hum, level, decay time constant (s), beat (Hz)]
    const P = [[1, 0.42, 9, 0.11], [2.0, 0.34, 6.5, 0.23], [2.38, 0.36, 5.2, 0.37], [3.02, 0.14, 3.6, 0.5], [4.0, 0.4, 4.2, 0.61],
      [5.03, 0.17, 2.6, 0.8], [5.35, 0.12, 2.2, 1.1], [6.03, 0.1, 1.7, 1.3], [8.12, 0.07, 1.1, 1.9], [10.3, 0.05, 0.7, 2.6], [12.7, 0.035, 0.45, 3.1]];
    for (const [r, v, tau, beat] of P) {
      for (const k of [-1, 1]) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f0 * r + k * beat / 2;
        o.detune.setValueAtTime(-6, t); o.detune.linearRampToValueAtTime(0, t + 0.25); // the strike bends the pitch a hair
        const att = r > 6 ? 0.002 : 0.006 + 0.004 * (1 / r);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v * 0.5, t + att);
        g.gain.setTargetAtTime(0, t + att, tau);
        const end = t + Math.min(26, tau * 4.5);
        o.connect(g).connect(bus); o.start(t); o.stop(end);
      }
    }
    this.noise(bus, { dur: 0.09, vol: 0.5, type: 'bandpass', f: 1800, to: 700, q: 0.8, at: 0.02 }); // clapper on bronze
    this.noise(bus, { dur: 0.35, vol: 0.35, type: 'lowpass', f: 220, to: 80, at: 0.02 }); // the thud through the frame
    if (this.music) { // the score holds its breath
      const m = this.music.gain, base = 0.28;
      m.cancelScheduledValues(t); m.setTargetAtTime(base * 0.2, t, 0.25); m.setTargetAtTime(base, t + 7, 2.5);
    }
  }

  bellVerb() { // a long, dark stereo hall (impulse made once per context, a fresh convolver per toll)
    const c = this.ctx;
    if (this.verbIr?.sampleRate !== c.sampleRate || this.verbCtx !== c) {
      const len = Math.floor(c.sampleRate * 5.5), ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.18; d[i] = lp * Math.exp(-i / (c.sampleRate * 1.4)) * (i < c.sampleRate * 0.03 ? i / (c.sampleRate * 0.03) : 1); }
      }
      this.verbIr = ir; this.verbCtx = c;
    }
    const v = c.createConvolver(); v.buffer = this.verbIr;
    return v;
  }

  // ---------- music: a small generative score per area ----------
  setMood(mood) { this.mood = mood; }

  schedule() {
    if (!this.ctx || !this.mood) return;
    const c = this.ctx, barLen = this.mood === 'boss' ? 1.6 : 2.4;
    if (this.nextBar < c.currentTime) this.nextBar = c.currentTime + 0.1;
    while (this.nextBar < c.currentTime + 0.5) {
      this.playBar(this.mood, this.nextBar, barLen, this.bar++);
      this.nextBar += barLen;
    }
  }

  playBar(mood, t0, len, bar) {
    const c = this.ctx, m = this.music;
    const PROG = {
      town: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],   // C Am F G
      field: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],  // Am F C G
      boss: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]],   // Am F Dm E
      mire: [[57, 60, 64], [55, 58, 62], [53, 57, 60], [52, 55, 59]],   // Am Gm F Em (Floor 2)
    }[mood];
    const chord = PROG[bar % 4];
    const pad = (n, vol) => {
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = mood === 'boss' ? 'sawtooth' : 'triangle'; o.frequency.value = NOTE(n) / (mood === 'boss' ? 2 : 1);
      f.type = 'lowpass'; f.frequency.value = mood === 'boss' ? 900 : 1400;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.3);
      o.connect(f).connect(g).connect(m); o.start(t0); o.stop(t0 + len + 0.4);
    };
    chord.forEach(n => pad(n, mood === 'boss' ? 0.07 : 0.06));
    // bass
    const bo = c.createOscillator(), bg = c.createGain();
    bo.type = 'sine'; bo.frequency.value = NOTE(chord[0] - 24);
    bg.gain.setValueAtTime(0.0001, t0); bg.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + len * (mood === 'boss' ? 0.5 : 0.95));
    bo.connect(bg).connect(m); bo.start(t0); bo.stop(t0 + len);
    // melody / arpeggio
    const steps = mood === 'boss' ? 8 : mood === 'field' ? 6 : 4;
    for (let i = 0; i < steps; i++) {
      if (mood !== 'boss' && Math.random() < 0.35) continue;
      const n = chord[(i + bar) % 3] + 12 + (Math.random() < 0.2 ? 12 : 0);
      const at = t0 + (i * len) / steps;
      const o = c.createOscillator(), g = c.createGain();
      o.type = mood === 'boss' ? 'square' : 'sine'; o.frequency.value = NOTE(n);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(mood === 'boss' ? 0.035 : 0.06, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len / steps * 1.6);
      o.connect(g).connect(m); o.start(at); o.stop(at + len / steps * 2);
    }
    // drums for the boss fight
    if (mood === 'boss') {
      for (let i = 0; i < 4; i++) {
        const at = t0 + (i * len) / 4;
        const k = c.createOscillator(), kg = c.createGain();
        k.frequency.setValueAtTime(140, at); k.frequency.exponentialRampToValueAtTime(40, at + 0.15);
        kg.gain.setValueAtTime(0.5, at); kg.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
        k.connect(kg).connect(m); k.start(at); k.stop(at + 0.25);
        if (i % 2) { // snare
          const s = c.createBufferSource(); s.buffer = this.noiseBuf;
          const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
          const sg = c.createGain(); sg.gain.setValueAtTime(0.18, at); sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
          s.connect(f).connect(sg).connect(m); s.start(at); s.stop(at + 0.2);
        }
      }
    }
  }
}
