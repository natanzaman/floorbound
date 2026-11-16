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
        this.tone(o, { f: 1400 * j, to: 900, dur: 0.18, vol: 0.18, type: 'triangle' });
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
      case 'clear': [60, 64, 67, 72, 67, 72, 76, 79].forEach((n, i) => this.tone(o, { f: NOTE(n), dur: 0.6, vol: 0.16, type: 'triangle', at: i * 0.12 })); break;
    }
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
