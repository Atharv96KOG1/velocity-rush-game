/**
 * Racing-line follower. Looks ahead along the track by a speed-dependent
 * distance, steers toward that point, and picks a target speed from how
 * sharply the track bends further ahead.
 */
export class AIDriver {
  constructor(car, track, skill = 1) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.lane = (Math.random() - 0.5) * track.width * 0.4;
    this.laneTimer = 2 + Math.random() * 3;
    this.boostBias = 0.4 + Math.random() * 0.5;
    this.rubber = 1;
  }

  control(dt, others = []) {
    const c = this.car, t = this.track, N = t.N;
    const i = c.trackIndex < 0 ? t.nearest(c.pos.x, c.pos.z) : c.trackIndex;
    const spd = Math.max(0, c.fwdSpeed);

    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.lane = (Math.random() - 0.5) * t.width * 0.45;
      this.laneTimer = 3 + Math.random() * 4;
    }

    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;

    // Dodge a slower car right ahead by shifting lane.
    if (!this.noDodge) for (const o of others) {
      if (o === c || o.eliminated) continue;
      const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;
      const ahead = dx * fx + dz * fz, side = dx * rx + dz * rz;
      if (ahead > 0 && ahead < 14 && Math.abs(side) < 2.6 && o.fwdSpeed < spd + 2) {
        this.lane = THREE_clamp(this.lane + (side > 0 ? -1 : 1) * 3.5, -t.width * 0.35, t.width * 0.35);
        this.laneTimer = 1.5;
        break;
      }
    }

    const look = Math.max(3, Math.round((7 + spd * 0.42) / t.seg));
    const ti = t.wrap(i + look);
    const tx = t.px[ti] - t.tz[ti] * this.lane, tz = t.pz[ti] + t.tx[ti] * this.lane;
    const dx = tx - c.pos.x, dz = tz - c.pos.z;
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    const steer = THREE_clamp(-ang * 2.4, -1, 1);

    // Sharpest bend within the braking window decides the target speed.
    let bend = 0;
    const far = Math.round((15 + spd * 1.5) / t.seg), stepK = Math.max(1, Math.round(far / 8));
    for (let k = stepK; k <= far; k += stepK) {
      const j = t.wrap(i + k);
      const d = t.tx[i] * t.tx[j] + t.tz[i] * t.tz[j];
      bend = Math.max(bend, Math.acos(THREE_clamp(d, -1, 1)) * (1 - (k / far) * 0.35));
    }
    this.bend = bend;
    const skill = this.skill * this.rubber;
    const target = c.spec.maxSpeed * Math.min(1.05, skill) * (1 - Math.min(0.62, bend * 0.5)) * (0.95 + 0.05 * skill);

    const throttle = spd < target ? 1 : 0;
    const brake = spd > target + 3 ? Math.min(1, (spd - target) / 10) : 0;
    const nitro = bend < 0.12 && c.boost > this.boostBias * 0.6 && skill > 0.85;
    return { throttle, brake, steer, hand: false, nitro, reset: false, cam: false };
  }
}

function THREE_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
