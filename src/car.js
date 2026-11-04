import * as THREE from 'three';

const WHEEL_R = 0.38;

export function buildCarMesh(color) {
  const group = new THREE.Group();
  const chassis = new THREE.Group();
  group.add(chassis);

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x16222e, metalness: 0.9, roughness: 0.08 });
  const add = (geo, mat, x, y, z, parent = chassis) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(2.0, 0.5, 4.4), paint, 0, 0.58, 0);               // body
  add(new THREE.BoxGeometry(1.9, 0.18, 1.5), paint, 0, 0.88, 1.35);           // hood bulge
  add(new THREE.BoxGeometry(1.6, 0.5, 2.0), glass, 0, 1.06, -0.35);           // cabin
  add(new THREE.BoxGeometry(1.5, 0.08, 1.7), paint, 0, 1.34, -0.4);           // roof
  add(new THREE.BoxGeometry(2.05, 0.22, 4.5), dark, 0, 0.36, 0);              // skirts
  add(new THREE.BoxGeometry(2.1, 0.08, 0.45), paint, 0, 1.18, -2.05);         // spoiler wing
  add(new THREE.BoxGeometry(0.1, 0.35, 0.2), dark, -0.7, 0.98, -2.0);
  add(new THREE.BoxGeometry(0.1, 0.35, 0.2), dark, 0.7, 0.98, -2.0);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1030, emissiveIntensity: 1.2 });
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.5, 0.14, 0.06), headMat, s * 0.62, 0.66, 2.21);
    add(new THREE.BoxGeometry(0.55, 0.12, 0.06), tailMat, s * 0.6, 0.68, -2.21);
  }

  // Wheels: pivot (steering yaw) > spin (roll) > tyre mesh.
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 18).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 8).rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc6, metalness: 0.9, roughness: 0.25 });
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.38], [0.95, 1.38], [-0.95, -1.38], [0.95, -1.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(tyre, dark, 0, 0, 0, spin);
    add(rimGeo, rimMat, 0, 0, 0, spin);
    group.add(pivot);
    wheels.push({ pivot, spin, front: z > 0 });
  }

  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.1, 10).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.85 }));
  flame.position.set(0, 0.45, -2.75);
  flame.visible = false;
  chassis.add(flame);

  return { group, chassis, wheels, flame, tailMat };
}

/**
 * Arcade car model: velocity is split into forward/lateral components in the
 * car's frame; grip bleeds lateral speed, the handbrake lowers grip to drift.
 * Forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw); +steer turns left.
 */
export class Car {
  constructor(spec, { name = spec.name, team = null, human = false, color = spec.color, player = -1 } = {}) {
    this.spec = spec;
    this.name = name;
    this.team = team;
    this.isHuman = human;
    this.player = player;
    this.color = color;
    const built = buildCarMesh(color);
    this.mesh = built.group;
    this.parts = built;

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.vx = 0; this.vz = 0;
    this.fwdSpeed = 0; this.latSpeed = 0;
    this.steerVis = 0;
    this.pitch = 0; this.roll = 0;
    this.surface = 1;
    this.boost = 0.35;
    this.nitroOn = false;
    this.drifting = false;
    this.driftScore = 0;
    this.driftCombo = 0;
    this.braking = false;
    this.spin = 0;

    // Race bookkeeping (owned by sessions).
    this.trackIndex = -1;
    this.lap = 0;
    this.progress = 0;
    this.position = 1;
    this.finished = false;
    this.finishTime = 0;
    this.lapStart = 0;
    this.bestLap = null;
    this.eliminated = false;
    this.stuck = 0;

    // Super power state (timers in seconds, driven by PowerSystem).
    this.power = null;
    this.turbo = 0; this.shield = 0; this.ghost = 0; this.stun = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get kmh() { return Math.round(Math.abs(this.fwdSpeed) * 3.6); }

  place(x, z, yaw, y = 0) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.vx = this.vz = this.fwdSpeed = this.latSpeed = 0;
    this.steerVis = 0;
  }

  update(dt, c) {
    const s = this.spec, sf = this.ghost > 0 ? 1 : this.surface;
    if (this.stun > 0) c = { ...c, throttle: 0, nitro: false, steer: c.steer * 0.4 };

    // Steering first, so the existing velocity becomes partly lateral and grip decides how much survives.
    this.steerVis += (c.steer - this.steerVis) * Math.min(1, dt * 9);
    const prevFwd = this.fwdSpeed;
    const speedR = Math.min(1, Math.abs(prevFwd) / s.maxSpeed);
    const low = Math.min(1, Math.abs(prevFwd) / 7);
    const turn = this.steerVis * s.handling * low * (1 - 0.42 * speedR) * (c.hand ? 1.2 : 1) * (prevFwd < -0.5 ? -1 : 1);
    this.yaw += turn * dt;

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -fz, rz = fx;
    let fwd = this.vx * fx + this.vz * fz;
    let lat = this.vx * rx + this.vz * rz;

    this.nitroOn = c.nitro && this.boost > 0.01 && c.throttle > 0 && fwd > 3;
    if (this.nitroOn) this.boost = Math.max(0, this.boost - dt * 0.3);
    const maxV = s.maxSpeed * (0.4 + 0.6 * sf) + (this.nitroOn ? 16 : 0) + (this.turbo > 0 ? 25 : 0) - (this.stun > 0 ? s.maxSpeed * 0.5 : 0);

    if (c.throttle > 0 && fwd < maxV) {
      const r = Math.max(0, fwd) / maxV;
      fwd += c.throttle * (s.accel + (this.nitroOn ? 18 : 0) + (this.turbo > 0 ? 34 : 0)) * (1 - r * r) * dt;
    }
    this.braking = c.brake > 0 && fwd > 1;
    if (c.brake > 0) {
      if (fwd > 1) fwd -= 42 * c.brake * dt;
      else if (fwd > -15) fwd -= 12 * c.brake * dt;
    }
    if (fwd > maxV) fwd -= (fwd - maxV) * 1.5 * dt;
    fwd -= fwd * (0.06 + (1 - sf) * 1.1) * dt;
    if (!c.throttle && !c.brake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 2.5 * dt);
    if (c.hand) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 5 * dt);

    const grip = s.grip * (c.hand ? 0.3 : 1) * (0.55 + 0.45 * sf);
    lat *= Math.exp(-grip * dt);
    // Cap the slip angle so drifts stay controllable instead of spinning out.
    if (fwd > 5) {
      const maxLat = fwd * 0.65;
      if (Math.abs(lat) > maxLat) lat = Math.sign(lat) * maxLat;
    }

    this.drifting = Math.abs(lat) > 3.5 && Math.abs(fwd) > 12;
    if (this.drifting) {
      const pts = Math.abs(lat) * dt * 14;
      this.driftScore += pts;
      this.driftCombo += pts;
      this.boost = Math.min(1, this.boost + dt * 0.2 * (s.id === 'kaze' ? 1.5 : 1));
    } else {
      this.driftCombo = Math.max(0, this.driftCombo - dt * 600);
    }
    // Slow trickle of nitro while flat out on the road.
    if (c.throttle && sf === 1 && speedR > 0.85) this.boost = Math.min(1, this.boost + dt * 0.02);

    this.vx = fx * fwd + rx * lat;
    this.vz = fz * fwd + rz * lat;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.fwdSpeed = fwd;
    this.latSpeed = lat;
    this.spin += (fwd * dt) / WHEEL_R;
  }

  syncMesh() {
    const m = this.mesh;
    m.position.copy(this.pos);
    m.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    const p = this.parts;
    p.chassis.rotation.z = THREE.MathUtils.clamp(this.latSpeed * 0.012, -0.08, 0.08);
    p.chassis.rotation.x = this.braking ? 0.025 : 0;
    for (const w of p.wheels) {
      w.spin.rotation.x = this.spin;
      if (w.front) w.pivot.rotation.y = this.steerVis * 0.45;
    }
    const fire = this.nitroOn || this.turbo > 0;
    p.flame.visible = fire;
    if (fire) {
      p.flame.scale.setScalar((this.turbo > 0 ? 1.6 : 0.8) + Math.random() * 0.5);
      p.flame.material.color.set(this.turbo > 0 ? 0xffb703 : 0x66d9ff);
    }
    p.tailMat.emissiveIntensity = this.braking ? 4 : 1.2;
  }
}
