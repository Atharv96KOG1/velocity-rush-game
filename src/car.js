import * as THREE from 'three';

const WHEEL_R = 0.38;

// Shared geometry: every car uses the same smooth body, only the paint differs.
let GEO = null;
function carGeometry() {
  if (GEO) return GEO;
  const extrude = (pts, depth, bevel) => {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 4) shape.quadraticCurveTo(p[0], p[1], p[2], p[3]);
      else shape.lineTo(p[0], p[1]);
    }
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10 });
    // Shape x is the car's length; the extrusion becomes its width.
    g.translate(0, 0, -depth / 2).rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  };
  // Side profile (length, height): low nose, raked windscreen, fastback roof, ducktail.
  const body = extrude([
    [-2.22, 0.3], [2.12, 0.3], [2.3, 0.42, 2.26, 0.62], [2.2, 0.72], [1.25, 0.88],
    [0.85, 1.05, 0.45, 1.27], [-0.4, 1.33, -0.85, 1.27], [-1.6, 0.98], [-2.26, 0.92], [-2.34, 0.62],
  ], 1.74, 0.11);
  const glass = extrude([
    [-1.66, 0.97], [-0.88, 1.31], [0.5, 1.32], [1.3, 0.9], [-1.66, 0.9],
  ], 1.84, 0.1);
  GEO = {
    body, glass,
    splitter: new THREE.BoxGeometry(2.0, 0.08, 0.5),
    diffuser: new THREE.BoxGeometry(1.7, 0.16, 0.3),
    skirt: new THREE.BoxGeometry(0.12, 0.14, 2.4),
    wing: new THREE.BoxGeometry(2.05, 0.06, 0.42),
    post: new THREE.BoxGeometry(0.08, 0.26, 0.16),
    mirror: new THREE.BoxGeometry(0.22, 0.12, 0.16),
    head: new THREE.BoxGeometry(0.46, 0.09, 0.08),
    tail: new THREE.BoxGeometry(1.7, 0.07, 0.06),
    tyre: new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 22).rotateZ(Math.PI / 2),
    rim: new THREE.CylinderGeometry(0.25, 0.25, 0.36, 10).rotateZ(Math.PI / 2),
    spoke: new THREE.BoxGeometry(0.37, 0.4, 0.06),
    flame: new THREE.ConeGeometry(0.18, 1.1, 10).rotateX(-Math.PI / 2),
  };
  return GEO;
}

export function buildCarMesh(color) {
  const G = carGeometry();
  const group = new THREE.Group();
  const chassis = new THREE.Group();
  group.add(chassis);

  // Clear-coated paint reflects the scene environment map.
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  const add = (geo, mat, x, y, z, parent = chassis) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  add(G.body, paint, 0, 0, 0);
  add(G.glass, glass, 0, 0, 0);
  add(G.splitter, dark, 0, 0.3, 2.1);
  add(G.diffuser, dark, 0, 0.36, -2.25);
  for (const s of [-1, 1]) {
    add(G.skirt, dark, s * 0.98, 0.34, 0);
    add(G.post, dark, s * 0.62, 1.05, -1.95);
    add(G.mirror, paint, s * 1.02, 0.98, 0.95);
  }
  add(G.wing, paint, 0, 1.2, -2.0);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2.5 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1030, emissiveIntensity: 1.4 });
  for (const s of [-1, 1]) add(G.head, headMat, s * 0.62, 0.64, 2.32);
  add(G.tail, tailMat, 0, 0.8, -2.38);

  // Wheels: pivot (steering yaw) > spin (roll) > tyre, rim and spokes.
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd4, metalness: 1, roughness: 0.22 });
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.38], [0.95, 1.38], [-0.95, -1.38], [0.95, -1.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(G.tyre, dark, 0, 0, 0, spin);
    add(G.rim, rimMat, 0, 0, 0, spin);
    for (let k = 0; k < 3; k++) add(G.spoke, dark, 0, 0, 0, spin).rotation.x = (k * Math.PI) / 3;
    group.add(pivot);
    wheels.push({ pivot, spin, front: z > 0 });
  }

  const flame = new THREE.Mesh(G.flame, new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.85 }));
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

    this.draft = false;   // in another car's slipstream (set by StyleTracker)
    this.padBoost = 0;    // seconds of boost-pad thrust left
    this.gripMul = 1;     // weather: wet roads lower grip
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
    if (this.nitroOn) this.boost = Math.max(0, this.boost - dt * 0.3 / (1 + ((s.nitroMul ?? 1) - 1) * 0.5));
    this.padBoost = Math.max(0, this.padBoost - dt);
    const maxV = s.maxSpeed * (0.4 + 0.6 * sf) + (this.nitroOn ? 16 : 0) + (this.turbo > 0 ? 25 : 0) + (this.draft ? 6 : 0) + (this.padBoost > 0 ? 20 : 0) - (this.stun > 0 ? s.maxSpeed * 0.5 : 0);

    if (c.throttle > 0 && fwd < maxV) {
      const r = Math.max(0, fwd) / maxV;
      fwd += c.throttle * (s.accel + (this.nitroOn ? 18 : 0) + (this.turbo > 0 ? 34 : 0) + (this.draft ? 7 : 0) + (this.padBoost > 0 ? 30 : 0)) * (1 - r * r) * dt;
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

    const grip = s.grip * this.gripMul * (c.hand ? 0.3 : 1) * (0.55 + 0.45 * sf);
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
      this.boost = Math.min(1, this.boost + dt * 0.2 * (s.id === 'kaze' ? 1.5 : 1) * (s.nitroMul ?? 1));
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
    const fire = this.nitroOn || this.turbo > 0 || this.padBoost > 0;
    p.flame.visible = fire;
    if (fire) {
      p.flame.scale.setScalar((this.turbo > 0 ? 1.6 : 0.8) + Math.random() * 0.5);
      p.flame.material.color.set(this.turbo > 0 ? 0xffb703 : 0x66d9ff);
    }
    p.tailMat.emissiveIntensity = this.braking ? 4 : 1.2;
  }
}
