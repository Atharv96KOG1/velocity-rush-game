import { audio } from './audio.js';

// Procedural synthwave: A minor, Am–F–C–G, 112 BPM. Layers fade in with intensity:
// pad + bass always; drums and arpeggio during races; the filter opens with speed.
const BPM = 112;
const STEP = 60 / BPM / 4;          // 16th note
const ROOTS = [45, 41, 48, 43];     // A2, F2, C3, G2 (MIDI)
const CHORDS = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor() {
    this.on = false;
    this.intensity = 0.3;
    this.speed = 0;
    this.step = 0;
    this.next = 0;
    this.timer = null;
    this.muted = false;
  }

  start() {
    const { ctx, master } = audio();
    if (!ctx || this.on) return;
    this.ctx = ctx;
    this.on = true;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.55;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2400;
    this.tone.connect(this.out).connect(master);
    // Feedback delay gives the arpeggio its echo.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(this.tone);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.1);
  }

  set(intensity, speed = 0) {
    this.intensity += (intensity - this.intensity) * 0.05;
    this.speed = speed;
    if (this.tone) this.tone.frequency.setTargetAtTime(1400 + this.intensity * 1600 + speed * 5000, this.ctx.currentTime, 0.2);
  }

  schedule() {
    while (this.next < this.ctx.currentTime + 0.12) {
      this.play(this.step, this.next);
      this.next += STEP;
      this.step = (this.step + 1) % 64;
    }
  }

  play(step, t) {
    const bar = Math.floor(step / 16), s = step % 16, root = ROOTS[bar], chord = CHORDS[bar], I = this.intensity;
    if (s === 0) for (const iv of chord) this.voice(hz(root + 12 + iv), t, STEP * 16, 'sawtooth', 0.025, 0.6, 900);
    if (s % 2 === 0) this.voice(hz(root + (s % 4 === 2 ? 12 : 0)), t, STEP * 1.8, 'sawtooth', 0.09 * (0.5 + I * 0.5), 0.005, 500 + I * 700);
    if (I > 0.55) {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.hit(t, 0.18, 1800, 0.15);
      if (s % 2 === 1) this.hit(t, 0.05, 7000, 0.03);
      const arp = [0, chord[1], chord[2], 12][s % 4] + (s >= 8 ? 12 : 0);
      this.voice(hz(root + 24 + arp), t, STEP * 0.9, 'square', 0.03 * I, 0.005, 3000, true);
    }
  }

  voice(f, t, dur, type, vol, attack, cutoff, echo = false) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 12;
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.tone);
    if (echo) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.tone);
    o.start(t);
    o.stop(t + 0.32);
  }

  hit(t, dur, hp, vol) {
    const c = this.ctx, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noise;
    f.type = 'highpass';
    f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(this.tone);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.02);
  }
}

export const music = new Music();
