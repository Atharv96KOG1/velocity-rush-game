// Engine and UI sounds are synthesized with WebAudio, so the game ships with no audio files.
let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.3;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export const audio = () => ({ ctx, master });

export function beep(freq = 660, dur = 0.15, type = 'square', vol = 0.25) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(ctx.currentTime + dur + 0.02);
}

export class EngineSound {
  constructor() {
    this.ok = !!ctx;
    if (!this.ok) return;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.filter);
    this.sub.connect(this.filter);
    this.filter.connect(this.gain).connect(master);
    this.osc.start();
    this.sub.start();
  }

  update(speedRatio, throttle, nitro) {
    if (!this.ok) return;
    // Fake a 6-speed gearbox: rpm climbs within each gear band then drops on shift.
    const r = Math.max(0, Math.min(1.25, speedRatio));
    const gears = 6;
    const g = Math.min(gears - 1, Math.floor(r * gears));
    const within = r * gears - g;
    const rpm = 0.25 + within * 0.65 + g * 0.03;
    const f = 38 + rpm * 120;
    const t = ctx.currentTime;
    this.osc.frequency.setTargetAtTime(f, t, 0.04);
    this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.filter.frequency.setTargetAtTime(500 + throttle * 1400 + (nitro ? 900 : 0), t, 0.06);
    this.gain.gain.setTargetAtTime(0.05 + throttle * 0.07, t, 0.08);
  }

  stop() {
    if (!this.ok) return;
    const t = ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, t, 0.05);
    this.osc.stop(t + 0.3);
    this.sub.stop(t + 0.3);
    this.ok = false;
  }
}
