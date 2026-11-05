import * as THREE from 'three';
import { Car } from './car.js';
import { AIDriver } from './ai.js';
import { carById, TRACKS } from './data.js';
import { beep, audio } from './audio.js';
import { canvasTex, makeLabel, rng } from './env.js';
import { Smoke } from './common.js';

const GRAVITY = 24;          // arcade gravity, m/s²
const SLOWMO = 0.25;         // time scale during crash cam
const BUST_TIME = 2.2;       // seconds pinned by a cop before you're busted
const JUMP_SPEED = 11.5;     // take-off speed of the jump button, m/s (≈1 s of air)
const TRICK_RATE = 9.5;      // rad/s of flip / spin / roll while a key is held
const TAU = Math.PI * 2;
const MULTI = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];

/** Flying car parts after a crash. */
class Debris {
  constructor(scene, n = 70) {
    const geos = [new THREE.BoxGeometry(0.5, 0.12, 0.7), new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.BoxGeometry(0.9, 0.08, 0.25)];
    this.items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geos[i % 3], new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.4 }));
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.items.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 });
    }
    this.next = 0;
  }

  burst(p, count, color) {
    for (let k = 0; k < count; k++) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      it.m.position.set(p.x, p.y + 0.8, p.z);
      it.m.material.color.set(k % 3 === 0 ? 0x15161a : k % 3 === 1 ? color : 0x9fb3c8);
      it.v.set((Math.random() - 0.5) * 18, 5 + Math.random() * 9, (Math.random() - 0.5) * 18);
      it.w.set(Math.random() * 14, Math.random() * 14, Math.random() * 14);
      it.life = 2.2 + Math.random();
      it.m.scale.setScalar(1);
      it.m.visible = true;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.m.visible = false; continue; }
      it.v.y -= GRAVITY * dt;
      it.m.position.addScaledVector(it.v, dt);
      if (it.m.position.y < 0.1) {
        it.m.position.y = 0.1;
        it.v.y *= -0.35; it.v.x *= 0.6; it.v.z *= 0.6; it.w.multiplyScalar(0.6);
      }
      it.m.rotation.x += it.w.x * dt; it.m.rotation.y += it.w.y * dt; it.m.rotation.z += it.w.z * dt;
      if (it.life < 0.5) it.m.scale.setScalar(it.life * 2);
    }
  }
}

/** Ramp spots on the straights, kept clear of the start line and boost pads. */
function pickRamps(track, pads, count = 2) {
  // count: 2 on normal tracks, 3 on hard ones
  const N = track.N, w = Math.round(50 / track.seg), out = [];
  const cand = [];
  for (let i = 0; i < N; i++) {
    const j = track.wrap(i + w);
    cand.push({ i, b: 1 - (track.tx[i] * track.tx[j] + track.tz[i] * track.tz[j]) });
  }
  cand.sort((a, b) => a.b - b.b);
  const far = (a, b, d) => Math.min(Math.abs(a - b), N - Math.abs(a - b)) >= d;
  for (const c of cand) {
    if (out.length >= count) break;
    if (!far(c.i, 0, 70) || pads.some(p => !far(p.i, c.i, 40)) || out.some(r => !far(r.i, c.i, N / 4))) continue;
    out.push({ i: c.i, lat: out.length % 2 ? track.width * 0.2 : -track.width * 0.2, len: 9, h: 1.8, w: 6.5, twist: out.length === 1 });
  }
  return out;
}

/** Roadblocks: barrel stacks you can smash through, concrete blocks you can't. Deterministic per track. */
function pickObstacles(track, avoid, count) {
  const r = rng(track.N * 31 + 7), out = [], N = track.N;
  const far = (a, b, d) => Math.min(Math.abs(a - b), N - Math.abs(a - b)) >= d;
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const i = Math.floor(r() * N);
    if (!far(i, 0, 80) || avoid.some(a => !far(a, i, 22)) || out.some(o => !far(o.i, i, 28))) continue;
    out.push({ i, lat: [-0.3, 0, 0.3][Math.floor(r() * 3)] * track.width, kind: r() < 0.55 ? 'barrels' : 'block', down: 0 });
  }
  return out;
}

let obstacleKit = null;
function obstacleMesh(track, o) {
  obstacleKit ??= {
    barrel: new THREE.CylinderGeometry(0.45, 0.45, 1.1, 14),
    barrelMat: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3, map: canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#e63946'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#f1f1f1'; g.fillRect(0, h * 0.3, w, h * 0.14); g.fillRect(0, h * 0.62, w, h * 0.14);
    }) }),
    block: new THREE.BoxGeometry(2.6, 1.15, 1.1),
    blockMat: new THREE.MeshStandardMaterial({ roughness: 0.9, map: canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd166';
      for (let x = -h; x < w; x += 28) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 14, h); g.lineTo(x + 14 + h * 0.6, h * 0.4); g.lineTo(x + h * 0.6, h * 0.4); g.fill(); }
    }) }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa020).multiplyScalar(4), toneMapped: false }),
    lampGeo: new THREE.SphereGeometry(0.12, 8, 6),
  };
  const K = obstacleKit, g = new THREE.Group(), i = o.i;
  g.position.set(track.px[i] - track.tz[i] * o.lat, 0, track.pz[i] + track.tx[i] * o.lat);
  g.rotation.y = Math.atan2(track.tx[i], track.tz[i]);
  if (o.kind === 'barrels') {
    for (const [x, z] of [[-0.55, 0], [0.55, 0], [0, 0.85]]) {
      const b = new THREE.Mesh(K.barrel, K.barrelMat);
      b.position.set(x, 0.55, z);
      b.castShadow = true;
      g.add(b);
    }
  } else {
    const b = new THREE.Mesh(K.block, K.blockMat);
    b.position.y = 0.58;
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    for (const x of [-1, 1]) {
      const l = new THREE.Mesh(K.lampGeo, K.lamp);
      l.position.set(x, 1.25, 0);
      g.add(l);
    }
  }
  o.mesh = g;
  o.x = g.position.x;
  o.z = g.position.z;
  return g;
}

function rampMesh(track, r, tex) {
  const { len: L, h: H, w: W } = r, hw = W / 2;
  // Wedge: low edge facing the cars, lip at the far end.
  const v = [
    -hw, 0, 0, hw, 0, 0, -hw, H, L, hw, H, L,   // top slope
    -hw, 0, 0, -hw, H, L, -hw, 0, L,           // left side
    hw, 0, 0, hw, H, L, hw, 0, L,              // right side
    -hw, 0, L, hw, 0, L, -hw, H, L, hw, H, L,  // back
  ];
  const uv = [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0.1, 1, 0.1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 2, 1, 1, 2, 3, 4, 5, 6, 7, 9, 8, 10, 12, 11, 11, 12, 13]);
  g.computeVertexNormals();
  const grp = new THREE.Group();
  const i = r.i;
  grp.position.set(track.px[i] - track.tz[i] * r.lat, 0.04, track.pz[i] + track.tx[i] * r.lat);
  grp.rotation.y = Math.atan2(track.tx[i], track.tz[i]);
  const ramp = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }));
  ramp.castShadow = ramp.receiveShadow = true;
  grp.add(ramp);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, 0.2), new THREE.MeshBasicMaterial({ color: r.twist ? 0xc77dff : 0x08d9d6 }));
  lip.position.set(0, H + 0.05, L);
  grp.add(lip);
  // Glowing posts either side of the lip so the ramp reads from a distance.
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, H + 1.4, 0.25), new THREE.MeshBasicMaterial({ color: r.twist ? 0xc77dff : 0x08d9d6 }));
    post.position.set(sx * (hw + 0.3), (H + 1.4) / 2, L);
    grp.add(post);
  }
  return grp;
}

/**
 * Asphalt-style action for offline races: ramps and stunts, takedowns with a
 * slow-motion crash cam, shockwave nitro, police pursuit, countdown flyby and dust.
 */
export class Action {
  constructor(s) {
    this.s = s;
    this.timeScale = 1;
    this.slow = 0;
    this.crashCam = null;
    this.debris = new Debris(s.scene);
    const dust = new THREE.Color(s.theme.ground).lerp(new THREE.Color(0xffffff), 0.35);
    this.dust = new Smoke(s.scene, 140, dust.getHex());

    const tex = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#1a1b22'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd166';
      for (let k = -h; k < w + h; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 16, 0); g.lineTo(k + 16 - h, h); g.lineTo(k - h, h); g.fill(); }
    });
    tex.repeat.set(2, 2);
    const hard = !!TRACKS[s.cfg.track]?.hard;
    this.ramps = s.solo ? [] : pickRamps(s.track, s.pads, hard ? 3 : 2);
    for (const r of this.ramps) s.scene.add(rampMesh(s.track, r, tex));
    this.obstacles = s.solo ? [] : pickObstacles(s.track, [...s.pads.map(p => p.i), ...this.ramps.map(r => r.i)], hard ? 14 : 5);
    for (const o of this.obstacles) s.scene.add(obstacleMesh(s.track, o));

    this.cops = [];
    if (s.cfg.police && !s.solo) this.spawnCops(s.cfg.difficulty > 1 ? 3 : 2);
    this.taps = new Map();
  }

  // ---------- Police ----------

  spawnCops(n) {
    const s = this.s, t = s.track, spec = { ...carById('phantom'), id: 'cop', name: 'Police', maxSpeed: 76, accel: 30, grip: 7.8, handling: 2.7 };
    for (let k = 0; k < n; k++) {
      const car = new Car(spec, { name: 'Police', color: 0x0d0f14 });
      car.isCop = true;
      const bar = [0xff1030, 0x1060ff].map((c, j) => {
        // Over-bright, un-tonemapped colour so the bloom pass makes the lightbar glow.
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.38), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(5), toneMapped: false }));
        m.position.set(j ? 0.34 : -0.34, 1.47, -0.4);
        car.parts.chassis.add(m);
        return m;
      });
      car.lightbar = bar;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 1.6), new THREE.MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.4 }));
      stripe.position.set(0, 0.7, -0.1);
      car.parts.chassis.add(stripe);
      const label = makeLabel('POLICE', '#ff5a6e', true);
      label.position.y = 2.7;
      car.mesh.add(label);
      const i = t.wrap(-40 - k * 9), side = (k % 2 ? 1 : -1) * t.width * 0.2;
      car.place(t.px[i] - t.tz[i] * side, t.pz[i] + t.tx[i] * side, Math.atan2(t.tx[i], t.tz[i]));
      car.trackIndex = t.nearest(car.pos.x, car.pos.z);
      car.ai = new AIDriver(car, t, 1.05);
      car.ai.cap = 1.3;
      // Online, the host drives the police; clients just follow their synced state.
      car.id = 'cop' + k;
      car.remote = !!s.net && !s.authority;
      s.byId?.set(car.id, car);
      car.hold = 0;
      s.scene.add(car.mesh);
      this.cops.push(car);
    }
    const { ctx, master } = audio();
    if (ctx) {
      this.siren = ctx.createOscillator();
      this.siren.type = 'triangle';
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.siren.connect(this.sirenGain).connect(master);
      this.siren.start();
    }
    s.hud.msg('🚨 POLICE ARE ON THE TRACK', 3, null, '#ff5a6e');
  }

  copControl(cop, dt) {
    const s = this.s;
    if (s.state !== 'race' || s.time < 2 || cop.hold > 0) return { throttle: 0, brake: 1, steer: 0, hand: false, nitro: false };
    // Chase the nearest human by track progress.
    let target = null, best = Infinity;
    for (const h of s.humans) {
      if (h.finished || h.eliminated || h.wreck > 0) continue;
      const gap = h.progress - cop.progress;
      if (Math.abs(gap) < Math.abs(best)) { best = gap; target = h; }
    }
    const metres = best * s.track.seg;
    if (target && metres < -15) {
      // The human is behind: ease off and drift into their lane to block them.
      cop.ai.skill = metres < -120 ? 0.5 : 0.72;
      s.track.measure(target.pos.x, target.pos.z, target.trackIndex);
      cop.ai.lane = Math.max(-s.track.width * 0.35, Math.min(s.track.width * 0.35, s.track.lat));
      cop.ai.laneTimer = 1;
    } else cop.ai.skill = metres > 150 ? 1.3 : metres > 40 ? 1.18 : 1.08;
    const c = cop.ai.control(dt, s.cars);
    if (!target) return c;
    const dx = target.pos.x - cop.pos.x, dz = target.pos.z - cop.pos.z, d = Math.hypot(dx, dz);
    const fx = Math.sin(cop.yaw), fz = Math.cos(cop.yaw);
    if (d < 32 && dx * fx + dz * fz > 0) {
      // Close enough: aim straight at the target and ram.
      const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
      return { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -ang * 3)), hand: false, nitro: cop.boost > 0.3 };
    }
    return { ...c, nitro: c.nitro || (best * s.track.seg > 80 && cop.boost > 0.2) };
  }

  // ---------- Per-step hooks ----------

  /** Adjusts a car's controls: busted cars are frozen; a quick double-tap of nitro fires a shockwave. */
  filter(car, c) {
    car.rawInput = c;
    if (car.busted > 0) return { throttle: 0, brake: 1, steer: 0, hand: false, nitro: false };
    const s = this.s;
    if (s.state !== 'race') return c;
    if (car.isHuman) {
      const tp = this.taps.get(car) ?? { prev: false, at: -9, jump: false };
      if (c.jump && !tp.jump && !car.air && car.pos.y < 0.25 && car.wreck <= 0) this.jump(car);
      tp.jump = c.jump;
      // In the air the keys drive tricks, not the wheels.
      if (car.air) { this.taps.set(car, tp); return { ...c, steer: 0, hand: false, throttle: 0, brake: 0 }; }
      if (c.nitro && !tp.prev) {
        if (s.time - tp.at < 0.32 && car.boost >= 0.4) this.shockwave(car);
        tp.at = s.time;
      }
      tp.prev = c.nitro;
      this.taps.set(car, tp);
    } else {
      if (car.ai) this.dodge(car);
      if (car.boost > 0.7 && (car.ai?.bend ?? 1) < 0.08 && Math.random() < 0.002) this.shockwave(car);
    }
    return c;
  }

  jump(car) {
    car.air = true;
    car.airT = 0;
    car.vy = JUMP_SPEED;
    car.airDur = (2 * JUMP_SPEED) / GRAVITY;
    this.startTricks(car);
    for (let k = 0; k < 5; k++) this.dust.emit(car.pos.x, car.pos.y, car.pos.z, 1.2);
    beep(420, 0.12, 'triangle', 0.15);
  }

  startTricks(car) {
    car.manual = car.isHuman;
    car.flipA = car.spinA = car.rollA = 0;
    // Keys already held at take-off (usually the gas) don't count until released,
    // so holding W through a jump no longer starts an accidental flip.
    const c = car.rawInput ?? {};
    car.trickLock = { flip: (c.throttle ?? 0) > 0 || (c.brake ?? 0) > 0, turn: (c.steer ?? 0) !== 0 };
  }

  shockwave(car, fromNet = false) {
    const s = this.s;
    if (!fromNet) s.net?.send({ t: 'sw', id: car.id });
    car.shockNitro = 1.8;
    car.boost = Math.max(0, car.boost - 0.3);
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    s.fx.rings.emit(car.pos.x - fx * 2, car.pos.y, car.pos.z - fz * 2, 0xc77dff, 16, 0.5);
    s.fx.rings.emit(car.pos.x - fx * 2, car.pos.y, car.pos.z - fz * 2, 0xffffff, 9, 0.35);
    s.fx.sparks.emit(car.pos.x - fx * 2.5, car.pos.y + 0.5, car.pos.z - fz * 2.5, 50, 0xc77dff, 10, 2);
    if (car.isHuman && !fromNet) {
      s.style.event(car, 'SHOCKWAVE NITRO', 150, '#c77dff');
      car.cam.shake = Math.max(car.cam.shake, 0.7);
      beep(70, 0.5, 'sawtooth', 0.35);
    }
  }

  groundAt(car) {
    let g = 0;
    const t = this.s.track;
    for (const r of this.ramps) {
      const i = r.i, cx = t.px[i] - t.tz[i] * r.lat, cz = t.pz[i] + t.tx[i] * r.lat;
      const dx = car.pos.x - cx, dz = car.pos.z - cz;
      const along = dx * t.tx[i] + dz * t.tz[i], side = -dx * t.tz[i] + dz * t.tx[i];
      if (along >= 0 && along <= r.len && Math.abs(side) <= r.w / 2 + 0.3) {
        g = Math.max(g, r.h * along / r.len);
        car.lastRamp = r;
      }
    }
    return g;
  }

  /** Vertical motion: climb ramps, fly off the lip, land with style. */
  air(car, dt) {
    const g = this.groundAt(car);
    if (car.air) {
      car.vy -= GRAVITY * dt;
      car.pos.y += car.vy * dt;
      car.airT += dt;
      if (car.manual) {
        // Player tricks: W/S flip, A/D spin, drift + A/D barrel roll.
        const c = car.rawInput ?? {}, lock = car.trickLock;
        let flip = (c.throttle ?? 0) - (c.brake ?? 0), turn = c.steer ?? 0;
        if (lock.flip) { if (flip === 0) lock.flip = false; else flip = 0; }
        if (lock.turn) { if (turn === 0) lock.turn = false; else turn = 0; }
        car.flipA += flip * TRICK_RATE * dt;
        if (c.hand) car.rollA += turn * TRICK_RATE * dt;
        else car.spinA += turn * TRICK_RATE * dt;
        // Auto-level: with no trick key held, each axis settles on the nearest whole turn.
        const settle = (a, active) => (active ? a : a + (Math.round(a / TAU) * TAU - a) * Math.min(1, dt * 7));
        car.flipA = settle(car.flipA, flip !== 0);
        car.spinA = settle(car.spinA, turn !== 0 && !c.hand);
        car.rollA = settle(car.rollA, turn !== 0 && c.hand);
        car.pitch = car.flipA + Math.max(-0.35, Math.min(0.3, -car.vy * 0.02));
        car.visYaw = car.spinA;
        car.roll = car.rollA;
      } else {
        const k = Math.min(1, car.airT / car.airDur);
        if (car.stunt === 'roll') car.roll = k * TAU * car.stuntDir;
        else if (car.stunt === 'spin') car.visYaw = k * TAU * car.stuntDir;
        car.pitch = Math.max(-0.35, Math.min(0.3, -car.vy * 0.02));
      }
      if (car.pos.y <= g) this.land(car, g);
      return;
    }
    if (g >= car.pos.y - 0.05) {
      car.vy = (g - car.pos.y) / dt;
      car.pos.y = g;
      car.pitch = g > 0 ? -Math.atan2(car.lastRamp.h, car.lastRamp.len) : 0;
    } else if (car.pos.y > 0.3) {
      // The ground fell away: we just left the lip.
      car.air = true;
      car.airT = 0;
      car.vy = Math.min(14, car.vy * 1.35 + 2);
      car.airDur = (2 * car.vy) / GRAVITY + 0.3;
      // Ramps give clean jumps: no automatic rolls or spins. Players add their own tricks.
      car.stunt = null;
      this.startTricks(car);
      // Stunt ramps throw players higher so there's time for tricks.
      if (car.manual && car.lastRamp?.twist) { car.vy += 3; car.airDur = (2 * car.vy) / GRAVITY + 0.3; }
    } else {
      car.pos.y = 0;
      car.vy = 0;
    }
  }

  land(car, g) {
    const s = this.s, impact = -car.vy;
    car.pos.y = g;
    car.vy = 0;
    car.air = false;
    car.roll = 0;
    car.visYaw = 0;
    car.pitch = 0;
    if (car.manual) { this.landTricks(car, impact); return; }
    if (impact > 6) {
      s.fx.sparks.emit(car.pos.x, car.pos.y + 0.2, car.pos.z, 30, 0xffd27a, 8, 2);
      for (let k = 0; k < 6; k++) this.dust.emit(car.pos.x, car.pos.y, car.pos.z, 1.6);
      if (car.cam) car.cam.shake = Math.max(car.cam.shake, Math.min(1, impact / 14));
    }
    if (!car.isHuman) return;
    const big = car.airT > 0.75;
    if (car.stunt === 'roll') s.style.event(car, 'BARREL ROLL', 350, '#c77dff');
    else if (car.stunt === 'spin') s.style.event(car, 'FLAT SPIN 360', 300, '#c77dff');
    if (big) s.style.event(car, `BIG AIR ${car.airT.toFixed(1)}s`, 200, '#08d9d6');
    if (car.stunt || big) { car.boost = Math.min(1, car.boost + 0.25); beep(900, 0.15, 'triangle', 0.2); }
  }

  /** Scores player tricks; landing far from wheels-down wrecks the car. */
  landTricks(car, impact) {
    const s = this.s;
    car.manual = false;
    const part = a => { const turns = Math.round(a / TAU); return { turns: Math.abs(turns), off: Math.abs(a - turns * TAU), dir: Math.sign(a) }; };
    const f = part(car.flipA), sp = part(car.spinA), r = part(car.rollA);
    if (f.off > 0.9 || r.off > 0.9 || sp.off > 1.1) {
      // Still rotating at touchdown: lose speed, no points, but keep racing.
      car.vx *= 0.55; car.vz *= 0.55;
      s.hud.msg('SLOPPY LANDING', 1.5, car.player, '#ff6fa8');
      s.fx.sparks.emit(car.pos.x, car.pos.y + 0.2, car.pos.z, 40, 0xffd27a, 9, 3);
      car.cam.shake = Math.max(car.cam.shake, 0.7);
      return;
    }
    if (f.turns + sp.turns + r.turns === 0 && car.airT > 0.4) s.style.event(car, 'PERFECT LANDING', 80, '#3ddc84');
    if (impact > 6) {
      s.fx.sparks.emit(car.pos.x, car.pos.y + 0.2, car.pos.z, 30, 0xffd27a, 8, 2);
      for (let k = 0; k < 6; k++) this.dust.emit(car.pos.x, car.pos.y, car.pos.z, 1.6);
      car.cam.shake = Math.max(car.cam.shake, Math.min(1, impact / 14));
    }
    let tricks = 0;
    const name = (n, label) => `${MULTI[Math.min(n, 4)]}${label}`;
    if (f.turns) { tricks += f.turns; s.style.event(car, name(f.turns, f.dir > 0 ? 'FRONT FLIP' : 'BACKFLIP'), 300 * f.turns, '#c77dff'); }
    if (sp.turns) { tricks += sp.turns; s.style.event(car, `${sp.turns * 360} SPIN`, 220 * sp.turns, '#c77dff'); }
    if (r.turns) { tricks += r.turns; s.style.event(car, name(r.turns, 'BARREL ROLL'), 320 * r.turns, '#c77dff'); }
    if (car.airT > 0.9) s.style.event(car, `BIG AIR ${car.airT.toFixed(1)}s`, 200, '#08d9d6');
    if (tricks >= 2) s.hud.center('INSANE!', 1, car.player);
    if (tricks) {
      car.boost = Math.min(1, car.boost + 0.2 * tricks);
      beep(900 + tricks * 120, 0.18, 'triangle', 0.2);
    }
  }

  // ---------- Crashes ----------

  onHit(a, b, v) {
    const s = this.s, now = s.time;
    a.lastHit = { by: b, t: now };
    b.lastHit = { by: a, t: now };
    if (v < 17 || Math.random() < 0.4) return;
    // The slower car (or the one that isn't shielded) loses the exchange.
    let victim = a.fwdSpeed < b.fwdSpeed ? a : b;
    if (victim.shield > 0) victim = victim === a ? b : a;
    if (victim.shield > 0) return;
    this.wreck(victim, victim === a ? b : a);
  }

  onWall(car, vn) {
    const s = this.s;
    const pushed = car.lastHit && s.time - car.lastHit.t < 1.5;
    if ((pushed && vn > 12) || vn > 27) this.wreck(car, pushed ? car.lastHit.by : null);
  }

  /** Only a car's owner decides it's wrecked; online, the owner broadcasts it to everyone else. */
  wreck(v, by, fromNet = false) {
    const s = this.s;
    if (v.wreck > 0 || v.eliminated) return;
    if (!fromNet && (v.remote || v.ghost > 0 || s.state !== 'race' || v.finished)) return;
    if (!fromNet) s.net?.send({ t: 'wk', id: v.id, by: by?.id ?? null });
    v.wreck = v.isCop ? 5 : 2.6;
    v.wv = { x: v.vx * 0.55, z: v.vz * 0.55, y: 7 + Math.random() * 4, rx: (Math.random() - 0.5) * 9, ry: (Math.random() - 0.5) * 6, rz: (Math.random() - 0.5) * 9 };
    v.vx = v.vz = v.fwdSpeed = v.latSpeed = 0;
    v.air = false;
    v.pos.y = Math.max(v.pos.y, 0);
    this.debris.burst(v.pos, 14, v.color);
    s.fx.sparks.emit(v.pos.x, v.pos.y + 0.8, v.pos.z, 120, 0xff8c42, 14, 8);
    s.fx.rings.emit(v.pos.x, v.pos.y, v.pos.z, 0xff6b35, 10, 0.5);
    for (let k = 0; k < 10; k++) s.smoke.emit(v.pos.x, v.pos.y + 0.5, v.pos.z, 2);

    const p1 = s.humans[0];
    if (by?.isHuman) {
      s.style.event(by, v.isCop ? 'COP TAKEDOWN' : 'TAKEDOWN', v.isCop ? 600 : 400, '#ff2e63');
      by.boost = Math.min(1, by.boost + 0.3);
      s.hud.center(v.isCop ? 'COP DOWN!' : 'TAKEDOWN!', 1.2, by.player);
    }
    if (v.isHuman) {
      s.hud.center('WRECKED', 1.4, v.player);
      setTimeout(() => { if (v.wreck > 0) s.hud.msg('RESPAWNING…', 1.2, v.player, '#ffd166'); }, 1300);
    }
    beep(55, 0.6, 'sawtooth', 0.35);
    const near = Math.hypot(v.pos.x - p1.pos.x, v.pos.z - p1.pos.z) < 60;
    // Slow motion is local-only: online it would desync this client from the others.
    if (!s.net && (v.isHuman || by?.isHuman || near)) {
      this.slow = 1.1;
      if (s.humans.length === 1) this.crashCam = { car: v, t: 0, a: p1.yaw + Math.PI * 0.6 };
    }
  }

  respawn(car) {
    const s = this.s, t = s.track;
    car.wreck = 0;
    car.roll = car.pitch = car.visYaw = 0;
    // A remote car's owner respawns it; we just stop the tumble and resume following its state.
    if (car.remote) { car.blink = 2; return; }
    if (car.isCop) {
      // Cops come back behind whoever they were chasing.
      const h = s.humans[0];
      const i = t.wrap(h.trackIndex - 70);
      car.place(t.px[i], t.pz[i], Math.atan2(t.tx[i], t.tz[i]));
      car.trackIndex = i;
    } else s.resetCar(car);
    // Back on the road facing forward, with a running start and a moment of invulnerability.
    const i = t.wrap(car.trackIndex), sp = car.isCop ? 30 : 24;
    car.vx = t.tx[i] * sp; car.vz = t.tz[i] * sp; car.fwdSpeed = sp;
    car.ghost = 2;
    car.blink = 2;
    car.lastHit = null;
    if (car.isHuman) { s.hud.center('GO!', 0.8, car.player); beep(880, 0.2, 'triangle', 0.2); }
  }

  /** Respawned cars blink while they can't be hit. Runs after camera culling. */
  blinkCars(dt) {
    const on = Math.floor(performance.now() / 90) % 2 === 0;
    for (const c of [...this.s.cars, ...this.cops]) {
      if (!(c.blink > 0)) continue;
      c.blink -= dt;
      if (c.mesh.visible) c.mesh.visible = c.blink <= 0 || on;
    }
  }

  collideObstacles(dt) {
    const s = this.s, R = 2.4;
    for (const o of this.obstacles) {
      if (o.down > 0) { o.down -= dt; if (o.down <= 0) o.mesh.visible = true; continue; }
      for (const c of [...s.cars, ...this.cops]) {
        if (c.remote || c.wreck > 0 || c.eliminated || c.pos.y > 1.1 || c.ghost > 0) continue;
        const dx = c.pos.x - o.x, dz = c.pos.z - o.z, d = Math.hypot(dx, dz);
        if (d >= R || d < 1e-3) continue;
        const nx = dx / d, nz = dz / d, vn = -(c.vx * nx + c.vz * nz);
        if (o.kind === 'barrels') {
          // Smash straight through, scattering barrels, at the cost of speed.
          o.down = 8;
          o.mesh.visible = false;
          this.debris.burst({ x: o.x, y: 0, z: o.z }, 9, 0xe63946);
          s.fx.sparks.emit(o.x, 0.8, o.z, 30, 0xffd27a, 8, 4);
          c.vx *= 0.6; c.vz *= 0.6;
          if (c.cam) c.cam.shake = Math.max(c.cam.shake, 0.6);
          if (c.isHuman) { s.hud.popup(c.player, 'BARRELS!', '#ff6fa8'); beep(140, 0.25, 'square', 0.2); }
          break;
        }
        c.pos.x += nx * (R - d); c.pos.z += nz * (R - d);
        if (vn > 22) { this.wreck(c, null); continue; }
        if (vn > 0) { c.vx += nx * vn * 1.5; c.vz += nz * vn * 1.5; c.vx *= 0.8; c.vz *= 0.8; }
        if (vn > 6) {
          s.fx.sparks.emit(c.pos.x - nx * 1.2, 0.7, c.pos.z - nz * 1.2, 25, 0xffd27a, 7, 3);
          if (c.cam) c.cam.shake = Math.max(c.cam.shake, Math.min(0.9, vn / 20));
        }
      }
    }
  }

  /** AI drivers swerve around roadblocks they can see coming. */
  dodge(car) {
    const t = this.s.track;
    for (const o of this.obstacles) {
      if (o.down > 0) continue;
      let di = o.i - car.trackIndex;
      if (di < -t.N / 2) di += t.N;
      if (di < 3 || di * t.seg > 45) continue;
      if (Math.abs(car.ai.lane - o.lat) < 4) {
        car.ai.lane = Math.max(-t.width * 0.38, Math.min(t.width * 0.38, o.lat + (o.lat > 0 || (o.lat === 0 && car.ai.lane < 0) ? -5.5 : 5.5)));
        car.ai.laneTimer = 2;
      }
    }
  }

  // ---------- Per-step update (cops, wrecks, busts) ----------

  update(dt, counting) {
    const s = this.s;
    for (const car of [...s.cars, ...this.cops]) {
      if (!s.powers && car.ghost > 0) car.ghost = Math.max(0, car.ghost - dt);
      car.busted = Math.max(0, (car.busted ?? 0) - dt);
      if (car.wreck > 0) {
        const w = car.wv;
        car.wreck -= dt;
        w.y -= GRAVITY * dt;
        car.pos.x += w.x * dt; car.pos.z += w.z * dt; car.pos.y += w.y * dt;
        if (car.pos.y < 0) { car.pos.y = 0; w.y *= -0.3; w.x *= 0.5; w.z *= 0.5; w.rx *= 0.5; w.rz *= 0.5; }
        const m = car.mesh;
        m.position.copy(car.pos);
        m.rotation.x += w.rx * dt; m.rotation.y += w.ry * dt; m.rotation.z += w.rz * dt;
        if (car.wreck <= 0) this.respawn(car);
      }
    }

    this.collideObstacles(dt);

    for (const cop of this.cops) {
      cop.hold = Math.max(0, cop.hold - dt);
      if (cop.wreck > 0) continue;
      if (cop.remote) { s.followNet(cop, dt); continue; }
      this.dodge(cop);
      const c = counting ? { throttle: 0, brake: 1, steer: 0 } : this.copControl(cop, dt);
      cop.update(dt, c);
      s.constrain(cop);
      this.air(cop, dt);
      s.unstick(cop, dt, counting);
    }

    // Busted: pinned slow next to a cop.
    if (!this.cops.length) return;
    for (const h of s.humans) {
      if (h.finished || h.eliminated || h.wreck > 0 || h.busted > 0) continue;
      const pinned = h.speed < 7 && this.cops.some(c => !c.wreck && Math.hypot(c.pos.x - h.pos.x, c.pos.z - h.pos.z) < 7);
      h.bust = Math.max(0, (h.bust ?? 0) + (pinned ? dt : -dt * 0.6));
      if (h.bust >= BUST_TIME) {
        h.bust = 0;
        h.busted = 3;
        h.vx = h.vz = 0;
        s.hud.center('BUSTED', 2, h.player);
        s.hud.msg('🚨 HELD FOR 3 SECONDS', 2.5, h.player, '#ff5a6e');
        for (const c of this.cops) c.hold = 4;
        beep(880, 0.25, 'square', 0.25);
        setTimeout(() => beep(660, 0.25, 'square', 0.25), 260);
      }
    }
  }

  // ---------- Per-frame presentation ----------

  frame(dt) {
    const s = this.s;
    this.slow = Math.max(0, this.slow - dt);
    this.timeScale = this.slow > 0 ? SLOWMO : Math.min(1, this.timeScale + dt * 3);
    this.debris.update(dt * this.timeScale);
    this.dust.update(dt);

    for (const car of [...s.cars, ...this.cops]) {
      if (car.eliminated || car.wreck > 0 || car.air) continue;
      if (car.surface < 1 && car.speed > 9 && Math.random() < 0.6) {
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), side = Math.random() < 0.5 ? -1 : 1;
        this.dust.emit(car.pos.x - fx * 1.8 - fz * side, car.pos.y, car.pos.z - fz * 1.8 + fx * side, 1.3);
      }
    }

    // Cops: flashing lightbars, siren follows the nearest cop.
    const flash = Math.floor(performance.now() / 140) % 2;
    let nearest = Infinity;
    const p1 = s.humans[0];
    for (const cop of this.cops) {
      if (cop.wreck <= 0) cop.syncMesh();
      cop.lightbar[0].visible = flash === 0;
      cop.lightbar[1].visible = flash === 1;
      nearest = Math.min(nearest, Math.hypot(cop.pos.x - p1.pos.x, cop.pos.z - p1.pos.z));
    }
    if (this.siren) {
      const { ctx } = audio(), tt = ctx.currentTime;
      this.siren.frequency.setTargetAtTime(760 + Math.sin(tt * 4) * 220, tt, 0.05);
      this.sirenGain.gain.setTargetAtTime(s.state === 'race' ? Math.max(0, 1 - nearest / 140) * 0.09 : 0, tt, 0.1);
    }

    // Countdown flyby: sweep from the front of the grid round to the chase position.
    if (s.state === 'countdown' && s.clock > 0.5) {
      const t = 1 - Math.min(1, (s.clock - 0.5) / 3.1), e = t * t * (3 - 2 * t);
      for (const h of s.humans) {
        const a = h.yaw + Math.PI + (1 - e) * Math.PI * 1.15, r = 15 - 7.5 * e, y = 7 - 4.6 * e;
        const cam = h.cam.camera;
        cam.position.set(h.pos.x + Math.sin(a) * r, h.pos.y + y, h.pos.z + Math.cos(a) * r);
        cam.lookAt(h.pos.x, h.pos.y + 1, h.pos.z);
      }
    }

    // Crash cam: orbit the wreck in slow motion.
    const cc = this.crashCam;
    if (cc) {
      cc.t += dt;
      if (this.slow <= 0 || cc.car.wreck <= 0) this.crashCam = null;
      else {
        const cam = p1.cam.camera, p = cc.car.mesh.position, a = cc.a + cc.t * 0.9;
        cam.position.set(p.x + Math.sin(a) * 8, p.y + 2.6, p.z + Math.cos(a) * 8);
        cam.lookAt(p.x, p.y + 0.8, p.z);
      }
    }
  }

  onNet(m) {
    const car = this.s.byId?.get(m.id);
    if (!car) return;
    if (m.t === 'wk') this.wreck(car, this.s.byId.get(m.by) ?? null, true);
    else if (m.t === 'sw') this.shockwave(car, true);
  }

  hudLines(h) {
    const out = [];
    if (this.cops.length) out.push(h.busted > 0 ? '🚨 BUSTED' : h.bust > 0.2 ? `🚨 BUST ${'█'.repeat(Math.ceil((h.bust / BUST_TIME) * 5))}${'░'.repeat(5 - Math.ceil((h.bust / BUST_TIME) * 5))}` : '🚨 PURSUIT');
    return out;
  }

  markers() {
    const flash = Math.floor(performance.now() / 200) % 2;
    return this.cops.filter(c => !c.wreck).map(c => ({ x: c.pos.x, z: c.pos.z, r: 4.5, color: flash ? '#ff1030' : '#1060ff' }));
  }

  dispose() {
    this.siren?.stop();
    this.dust.dispose();
  }
}
