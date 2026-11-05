const RATE = 30;          // snapshots per second
const SECONDS = 8;        // how far back you can go
export const REWINDS = 3; // uses per race

const FIELDS = ['yaw', 'vx', 'vz', 'fwdSpeed', 'latSpeed', 'steerVis', 'lap', 'trackIndex', 'progress', 'boost',
  'finished', 'finishTime', 'driftScore', 'lapStart', 'bestLap', 'turbo', 'shield', 'ghost', 'stun', 'padBoost', 'stuck',
  'shockNitro', 'air', 'vy', 'airT', 'roll', 'pitch', 'visYaw', 'wreck', 'busted', 'bust',
  'manual', 'flipA', 'spinA', 'rollA', 'spinOut', 'mega', 'tiny'];

/** Ring buffer of race snapshots; holding the rewind key plays them back in reverse. */
export class Rewind {
  constructor(session) {
    this.s = session;
    this.buf = [];
    this.t = 0;
    this.left = REWINDS;
    this.active = false;
  }

  record(dt) {
    this.t += dt;
    if (this.t < 1 / RATE) return;
    this.t = 0;
    const s = this.s;
    this.buf.push({
      time: s.time,
      dnf: s.dnf,
      cars: s.cars.map(c => {
        const o = { x: c.pos.x, y: c.pos.y, z: c.pos.z, charge: c.power?.charge ?? 0 };
        for (const f of FIELDS) o[f] = c[f];
        return o;
      }),
    });
    if (this.buf.length > RATE * SECONDS) this.buf.shift();
  }

  /** Called every frame. Returns true while rewinding. */
  step(held, dt = 1 / 60) {
    if (!held) { this.active = false; this.needRelease = false; return false; }
    if (!this.active) {
      // A new rewind needs a fresh press, so holding Q past an empty buffer doesn't burn charges.
      if (this.needRelease || this.left <= 0 || this.buf.length < 5) return false;
      this.left--;
      this.active = true;
      this.acc = 0;
    }
    // Play back at 2x real time regardless of frame rate.
    this.acc += dt * RATE * 2;
    let snap = null;
    while (this.acc >= 1 && this.buf.length) { snap = this.buf.pop(); this.acc -= 1; }
    if (!snap && !this.buf.length) { this.active = false; this.needRelease = true; return false; }
    if (!snap) return true;
    const s = this.s;
    s.time = snap.time;
    s.dnf = snap.dnf;
    snap.cars.forEach((o, i) => {
      const c = s.cars[i];
      c.pos.set(o.x, o.y, o.z);
      for (const f of FIELDS) c[f] = o[f];
      if (c.power) c.power.charge = o.charge;
      c.drifting = false;
      c.driftCombo = 0;
    });
    if (s.recorder) {
      s.recorder.frames.length = Math.max(0, Math.floor(snap.time * 20)) * 3;
      s.recorder.t = snap.time;
    }
    return true;
  }
}
